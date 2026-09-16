#!/usr/bin/env node
'use strict';
/**
 * PHASE 18 — V1 → V2 Migration Script
 *
 * IMPORTANT:
 *   Default mode: DRY RUN. No data is written unless --apply is passed.
 *   Always creates a backup before writing.
 *   Migration is REVERSIBLE via the MigrationMap and backup.
 *
 * Usage:
 *   node scripts/migrateV2.js --dry-run          # inspect only (default)
 *   node scripts/migrateV2.js --apply            # actually migrate
 *   node scripts/migrateV2.js --rollback         # restore from latest backup
 *   node scripts/migrateV2.js --report           # print migration-report.json
 *
 * Safety:
 *   - Never modifies Inventory, Matching, Deal, Commission.
 *   - Never destroys legacy IDs.
 *   - Never migrates without a verified backup.
 *   - Partial failure → STOP (no partial commit).
 */

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

// ── Configuration ─────────────────────────────────────────────────────────────

const DB_FILE          = process.env.SIG_REALTY_DB_FILE
  || path.join(__dirname, '../data/sig-realty-db.json');
const BACKUP_DIR       = path.join(__dirname, '../data/backups');
const REPORT_FILE      = path.join(__dirname, '../data/migration-report.json');
const MIGRATION_VERSION = '18.0';
const MANIFEST_PREFIX  = 'migration-manifest-';

// ── CLI Args ──────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const DRY_RUN  = !args.includes('--apply');  // default is dry-run
const APPLY    = args.includes('--apply');
const ROLLBACK = args.includes('--rollback');
const REPORT   = args.includes('--report');

if (ROLLBACK) { doRollback(); process.exit(0); }
if (REPORT)   { doReport();   process.exit(0); }

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg)   { console.log(`[MIGRATE] ${msg}`); }
function warn(msg)  { console.warn(`[WARN]    ${msg}`); }
function error(msg) { console.error(`[ERROR]   ${msg}`); }

function readDb(file = DB_FILE) {
  if (!fs.existsSync(file)) {
    error(`Database file not found: ${file}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeDb(db, file = DB_FILE) {
  fs.writeFileSync(file, JSON.stringify(db, null, 2), 'utf8');
}

// ── Checksum ──────────────────────────────────────────────────────────────────

function sha256File(filePath) {
  const content = fs.readFileSync(filePath);
  return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
}

// ── Backup ────────────────────────────────────────────────────────────────────

function createBackup(db) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const runId = ts;
  const file = path.join(BACKUP_DIR, `sig-realty-db-backup-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(db, null, 2), 'utf8');
  const size = fs.statSync(file).size;
  log(`Backup created: ${file} (${size} bytes)`);
  return { path: file, timestamp: ts, size, runId };
}

/**
 * Write a migration manifest alongside the backup.
 * The manifest is the ONLY authoritative source for rollback selection.
 * Test/fixture backups have no manifest and are therefore never eligible.
 */
function createManifest(backupInfo) {
  const checksum = sha256File(backupInfo.path);
  const manifest = {
    runId:            backupInfo.runId,
    backupPath:       backupInfo.path,
    sourceDbPath:     DB_FILE,
    dbSizeBytes:      backupInfo.size,
    checksum,
    timestamp:        new Date().toISOString(),
    migrationVersion: MIGRATION_VERSION,
    environment:      process.env.NODE_ENV || 'production',
    hostname:         os.hostname(),
    context:          'production-apply'
  };
  const mFile = path.join(BACKUP_DIR, `${MANIFEST_PREFIX}${backupInfo.runId}.json`);
  fs.writeFileSync(mFile, JSON.stringify(manifest, null, 2), 'utf8');
  log(`Migration manifest created: ${mFile}`);
  return { manifestFile: mFile, manifest };
}

function verifyBackup(backupPath) {
  if (!fs.existsSync(backupPath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    return Array.isArray(parsed.Leads);
  } catch { return false; }
}

function normalizePhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/[^0-9]/g, '').slice(-10);
}

function generateV2LeadId(index) {
  return `L${String(index).padStart(6, '0')}`;
}
function generateV2TxnId(index) {
  return `T${String(index).padStart(6, '0')}`;
}
function generateV2ReqId(index) {
  return `R${String(index).padStart(6, '0')}`;
}

// ── Rollback ──────────────────────────────────────────────────────────────────
//
// SAFETY CONTRACT:
//   - Rollback ONLY uses a manifest written by --apply.
//   - Test/fixture backups have no manifest and are NEVER eligible.
//   - 0 manifests  → STOP (no guessing, no fallback).
//   - >1 manifests → STOP (ambiguous; cannot determine which run to undo).
//   - Manifest sourceDbPath must match current DB_FILE (environment check).
//   - Backup file must exist at the path recorded in the manifest.
//   - Backup checksum must match the manifest checksum (integrity check).
//   - Any single check failure → STOP with a clear error.

function doRollback() {
  if (!fs.existsSync(BACKUP_DIR)) {
    error('ROLLBACK ABORTED — no backup directory found.');
    error('No migration has been applied from this environment.');
    process.exit(1);
  }

  // Step 1: Find manifest files only — never raw backup filenames
  const manifestFiles = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith(MANIFEST_PREFIX) && f.endsWith('.json'))
    .sort();

  if (manifestFiles.length === 0) {
    error('ROLLBACK ABORTED — no migration manifest found.');
    error('Rollback requires a manifest created by --apply.');
    error('Test/fixture backups do not have manifests and cannot be used.');
    process.exit(1);
  }

  if (manifestFiles.length > 1) {
    error(`ROLLBACK ABORTED — ${manifestFiles.length} manifests found; ambiguous.`);
    error('Cannot determine which migration run to undo. Manifests present:');
    manifestFiles.forEach(f => error(`  ${path.join(BACKUP_DIR, f)}`));
    error('Remove all manifests except the one for the run you want to undo, then retry.');
    process.exit(1);
  }

  // Step 2: Read the single manifest
  const manifestPath = path.join(BACKUP_DIR, manifestFiles[0]);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    error(`ROLLBACK ABORTED — manifest is unreadable or corrupt: ${manifestPath}`);
    process.exit(1);
  }

  log(`Manifest: ${manifestPath}`);
  log(`  Run ID:    ${manifest.runId}`);
  log(`  Timestamp: ${manifest.timestamp}`);
  log(`  Source DB: ${manifest.sourceDbPath}`);
  log(`  Backup:    ${manifest.backupPath}`);

  // Step 3: Environment check — manifest must be for THIS DB_FILE
  if (!manifest.sourceDbPath || manifest.sourceDbPath !== DB_FILE) {
    error('ROLLBACK ABORTED — environment mismatch.');
    error(`  Manifest source DB : ${manifest.sourceDbPath}`);
    error(`  Current  DB_FILE   : ${DB_FILE}`);
    error('This manifest belongs to a different environment or DB path.');
    process.exit(1);
  }

  // Step 4: Backup file must exist
  if (!manifest.backupPath || !fs.existsSync(manifest.backupPath)) {
    error('ROLLBACK ABORTED — backup file referenced in manifest does not exist.');
    error(`  Expected: ${manifest.backupPath}`);
    process.exit(1);
  }

  // Step 5: Checksum integrity check
  if (manifest.checksum) {
    const actual = sha256File(manifest.backupPath);
    if (actual !== manifest.checksum) {
      error('ROLLBACK ABORTED — backup file checksum mismatch.');
      error(`  Manifest checksum : ${manifest.checksum}`);
      error(`  Actual checksum   : ${actual}`);
      error('Backup may be corrupted or tampered. Do not restore.');
      process.exit(1);
    }
    log('Checksum verified ✓');
  }

  // Step 6: Basic content check
  if (!verifyBackup(manifest.backupPath)) {
    error('ROLLBACK ABORTED — backup file is unreadable or missing Leads array.');
    process.exit(1);
  }

  // All checks passed — restore
  const db = readDb(manifest.backupPath);
  log(`Backup contains ${db.Leads.length} Leads, ${db.Requirements.length} Requirements.`);
  log('ROLLBACK: Restoring database from manifest-verified backup…');
  writeDb(db);
  log('ROLLBACK COMPLETE.');
}

// ── Report ─────────────────────────────────────────────────────────────────────

function doReport() {
  if (!fs.existsSync(REPORT_FILE)) {
    console.log('No migration report found. Run migration first.');
    return;
  }
  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  console.log(JSON.stringify(report, null, 2));
}

// ── Main Migration ────────────────────────────────────────────────────────────

function run() {
  log(`=== Signature Realty V1→V2 Migration (version ${MIGRATION_VERSION}) ===`);
  log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY'}`);
  log('');

  const db = readDb();

  // ── Counters ──
  const report = {
    migrationVersion: MIGRATION_VERSION,
    mode:             DRY_RUN ? 'dry-run' : 'apply',
    timestamp:        new Date().toISOString(),
    backupPath:       null,
    scanned:          { leads: 0, transactions: 0, requirements: 0 },
    eligible:         { leads: 0, transactions: 0, requirements: 0 },
    migrated:         { leads: 0, transactions: 0, requirements: 0 },
    skipped:          { leads: 0, transactions: 0, requirements: 0 },
    duplicates:       [],
    relationshipErrors: [],
    fieldWarnings:    [],
    manualReview:     []
  };

  db.Leads        = db.Leads        || [];
  db.Transactions = db.Transactions || [];
  db.Requirements = db.Requirements || [];
  db.MigrationMap = db.MigrationMap || [];

  // ── Find already-migrated IDs ──
  const migratedLegacyIds = new Set(db.MigrationMap.map(m => m.LegacyID));

  // ── Index V2 IDs to generate new ones ──
  const existingV2LeadIds  = new Set(db.Leads.filter(l => l._v2).map(l => l.LeadID));
  const existingV2TxnIds   = new Set(db.Transactions.filter(t => t._v2).map(t => t.TransactionID));
  const existingV2ReqIds   = new Set(db.Requirements.filter(r => r._v2).map(r => r.RequirementID));

  let leadV2Counter = db.MigrationMap.filter(m => m.EntityType === 'Lead').length + 1;
  let txnV2Counter  = db.MigrationMap.filter(m => m.EntityType === 'Transaction').length + 1;
  let reqV2Counter  = db.MigrationMap.filter(m => m.EntityType === 'Requirement').length + 1;

  // ── Lead ID map: legacyId → v2Id (for relationship repair) ──
  const leadIdMap = {};
  const txnIdMap  = {};

  // Pre-populate from existing MigrationMap
  for (const m of db.MigrationMap) {
    if (m.EntityType === 'Lead')        leadIdMap[m.LegacyID] = m.V2ID;
    if (m.EntityType === 'Transaction') txnIdMap[m.LegacyID]  = m.V2ID;
  }

  // ── Duplicate detection index ──
  const seenMobiles = new Map();
  const seenEmails  = new Map();

  for (const lead of db.Leads) {
    if (lead._v2) {
      const m = normalizePhone(lead.PrimaryMobile || lead.Phone);
      const e = (lead.Email || '').toLowerCase();
      if (m) seenMobiles.set(m, lead.LeadID);
      if (e) seenEmails.set(e, lead.LeadID);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Migrate Leads
  // ──────────────────────────────────────────────────────────────────────────

  log('--- Scanning Leads ---');
  const newMigrationEntries = [];
  const newV2Leads = [];

  for (const lead of db.Leads) {
    report.scanned.leads++;

    // Already V2?
    if (lead._v2) {
      leadIdMap[lead.LeadID] = lead.LeadID;
      report.skipped.leads++;
      continue;
    }

    // Already migrated?
    if (migratedLegacyIds.has(lead.LeadID)) {
      const mapEntry = db.MigrationMap.find(m => m.LegacyID === lead.LeadID);
      if (mapEntry) leadIdMap[lead.LeadID] = mapEntry.V2ID;
      report.skipped.leads++;
      continue;
    }

    report.eligible.leads++;

    // Duplicate detection
    const mobile = normalizePhone(lead.PrimaryMobile || lead.Phone);
    const email  = (lead.Email || '').toLowerCase();

    if (mobile && seenMobiles.has(mobile)) {
      const dupOf = seenMobiles.get(mobile);
      report.duplicates.push({
        EntityType: 'Lead',
        LegacyID:   lead.LeadID,
        DuplicateOf: dupOf,
        Reason:     'Duplicate mobile'
      });
      report.manualReview.push({
        EntityType: 'Lead', LegacyID: lead.LeadID, Reason: 'Possible duplicate — same mobile as ' + dupOf
      });
      log(`  DUPLICATE: Lead ${lead.LeadID} (mobile ${mobile}) → same as ${dupOf}`);
      continue;
    }

    if (email && seenEmails.has(email)) {
      const dupOf = seenEmails.get(email);
      report.duplicates.push({
        EntityType: 'Lead',
        LegacyID:   lead.LeadID,
        DuplicateOf: dupOf,
        Reason:     'Duplicate email'
      });
      report.manualReview.push({
        EntityType: 'Lead', LegacyID: lead.LeadID, Reason: 'Possible duplicate — same email as ' + dupOf
      });
      continue;
    }

    // Generate V2 ID
    let v2Id;
    do { v2Id = generateV2LeadId(leadV2Counter++); }
    while (existingV2LeadIds.has(v2Id));
    existingV2LeadIds.add(v2Id);

    leadIdMap[lead.LeadID] = v2Id;
    if (mobile) seenMobiles.set(mobile, lead.LeadID);
    if (email)  seenEmails.set(email, lead.LeadID);

    // Field mapping
    const v2Lead = {
      ...lead,
      LeadID:         v2Id,
      LegacyID:       lead.LeadID,
      PrimaryMobile:  lead.PrimaryMobile || lead.Phone || null,
      ClientStatus:   lead.ClientStatus  || lead.LeadStatus || lead.Status || 'New',
      ClientLifecycle: lead.ClientLifecycle || lead.Lifecycle || 'Prospect',
      Source:         lead.Source || lead.LeadSource || null,
      _v2:            true,
      MigratedAt:     new Date().toISOString(),
      MigrationVersion: MIGRATION_VERSION
    };

    newV2Leads.push(v2Lead);
    newMigrationEntries.push({
      MigrationID:      require('crypto').randomUUID(),
      EntityType:       'Lead',
      LegacyID:         lead.LeadID,
      V2ID:             v2Id,
      Status:           'MIGRATED',
      Reason:           'Automatic migration',
      CreatedAt:        new Date().toISOString(),
      MigrationVersion: MIGRATION_VERSION
    });
    report.migrated.leads++;
    log(`  Lead: ${lead.LeadID} → ${v2Id} (${lead.ClientName || lead.Name || 'Unknown'})`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Migrate Transactions
  // ──────────────────────────────────────────────────────────────────────────

  log('--- Scanning Transactions ---');
  const newV2Txns = [];

  for (const txn of db.Transactions) {
    report.scanned.transactions++;

    if (txn._v2 || migratedLegacyIds.has(txn.TransactionID)) {
      txnIdMap[txn.TransactionID] = txn._v2 ? txn.TransactionID : (db.MigrationMap.find(m => m.LegacyID === txn.TransactionID)?.V2ID || txn.TransactionID);
      report.skipped.transactions++;
      continue;
    }

    report.eligible.transactions++;

    // Resolve parent LeadID
    const v2LeadId = leadIdMap[txn.LeadID] || txn.LeadID;
    const parentExists = db.Leads.some(l => l.LeadID === v2LeadId || l.LeadID === txn.LeadID) ||
                         newV2Leads.some(l => l.LeadID === v2LeadId);

    if (!parentExists) {
      report.relationshipErrors.push({
        EntityType: 'Transaction',
        LegacyID:   txn.TransactionID,
        Reason:     `Parent Lead ${txn.LeadID} not found`
      });
      report.manualReview.push({ EntityType: 'Transaction', LegacyID: txn.TransactionID, Reason: 'Broken Lead reference' });
      warn(`  Broken ref: Transaction ${txn.TransactionID} → Lead ${txn.LeadID} not found`);
      continue;
    }

    let v2Id;
    do { v2Id = generateV2TxnId(txnV2Counter++); }
    while (existingV2TxnIds.has(v2Id));
    existingV2TxnIds.add(v2Id);

    txnIdMap[txn.TransactionID] = v2Id;

    newV2Txns.push({
      ...txn,
      TransactionID:    v2Id,
      LegacyID:         txn.TransactionID,
      LeadID:           v2LeadId,
      _v2:              true,
      MigratedAt:       new Date().toISOString(),
      MigrationVersion: MIGRATION_VERSION
    });
    newMigrationEntries.push({
      MigrationID:      require('crypto').randomUUID(),
      EntityType:       'Transaction',
      LegacyID:         txn.TransactionID,
      V2ID:             v2Id,
      Status:           'MIGRATED',
      Reason:           'Automatic migration',
      CreatedAt:        new Date().toISOString(),
      MigrationVersion: MIGRATION_VERSION
    });
    report.migrated.transactions++;
    log(`  Transaction: ${txn.TransactionID} → ${v2Id}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Migrate Requirements
  // ──────────────────────────────────────────────────────────────────────────

  log('--- Scanning Requirements ---');
  const newV2Reqs = [];

  for (const req of db.Requirements) {
    report.scanned.requirements++;

    if (req._v2 || migratedLegacyIds.has(req.RequirementID)) {
      report.skipped.requirements++;
      continue;
    }

    report.eligible.requirements++;

    const v2LeadId = leadIdMap[req.LeadID] || req.LeadID;
    const v2TxnId  = txnIdMap[req.TransactionID] || req.TransactionID;

    // Relationship validation
    const leadOk = db.Leads.some(l => l.LeadID === v2LeadId || l.LeadID === req.LeadID) ||
                   newV2Leads.some(l => l.LeadID === v2LeadId);
    const txnOk  = db.Transactions.some(t => t.TransactionID === v2TxnId || t.TransactionID === req.TransactionID) ||
                   newV2Txns.some(t => t.TransactionID === v2TxnId);

    if (!leadOk || !txnOk) {
      report.relationshipErrors.push({
        EntityType: 'Requirement',
        LegacyID:   req.RequirementID,
        Reason:     !leadOk ? `Parent Lead ${req.LeadID} not found` : `Parent Transaction ${req.TransactionID} not found`
      });
      report.manualReview.push({ EntityType: 'Requirement', LegacyID: req.RequirementID, Reason: 'Broken relationship' });
      warn(`  Broken ref: Requirement ${req.RequirementID}`);
      continue;
    }

    // Verify LeadID === Transaction.LeadID
    const txnParent = [...db.Transactions, ...newV2Txns].find(t => t.TransactionID === v2TxnId || t.LegacyID === req.TransactionID);
    if (txnParent && txnParent.LeadID !== v2LeadId && txnParent.LeadID !== req.LeadID) {
      report.relationshipErrors.push({
        EntityType: 'Requirement',
        LegacyID:   req.RequirementID,
        Reason:     `Requirement.LeadID (${req.LeadID}) ≠ Transaction.LeadID (${txnParent.LeadID})`
      });
      report.manualReview.push({ EntityType: 'Requirement', LegacyID: req.RequirementID, Reason: 'LeadID mismatch with Transaction' });
      continue;
    }

    // Build Fields map from legacy flat fields
    const fields = req.Fields || {};
    const fieldWarning = [];

    // Preserve FormVersion if it exists; never invent one
    const formVersion = req.FormVersion || null;
    if (!formVersion) {
      fieldWarning.push('No FormVersion — migration version will be noted but not assigned');
    }

    // Warn on missing key fields
    if (!fields.BudgetMax && !req.BudgetMax && !req.Budget) {
      fieldWarning.push('BudgetMax is missing — will remain UNKNOWN');
    }

    if (fieldWarning.length > 0) {
      report.fieldWarnings.push({ RequirementID: req.RequirementID, warnings: fieldWarning });
    }

    let v2Id;
    do { v2Id = generateV2ReqId(reqV2Counter++); }
    while (existingV2ReqIds.has(v2Id));
    existingV2ReqIds.add(v2Id);

    newV2Reqs.push({
      ...req,
      RequirementID:    v2Id,
      LegacyID:         req.RequirementID,
      LeadID:           v2LeadId,
      TransactionID:    v2TxnId,
      Fields:           fields,  // UNKNOWN remains UNKNOWN — never invented
      FormVersion:      formVersion,
      _v2:              true,
      MigratedAt:       new Date().toISOString(),
      MigrationVersion: MIGRATION_VERSION
    });
    newMigrationEntries.push({
      MigrationID:      require('crypto').randomUUID(),
      EntityType:       'Requirement',
      LegacyID:         req.RequirementID,
      V2ID:             v2Id,
      Status:           'MIGRATED',
      Reason:           'Automatic migration',
      CreatedAt:        new Date().toISOString(),
      MigrationVersion: MIGRATION_VERSION
    });
    report.migrated.requirements++;
    log(`  Requirement: ${req.RequirementID} → ${v2Id}`);
  }

  // ── Print Summary ─────────────────────────────────────────────────────────

  log('');
  log('=== Migration Summary ===');
  log(`Leads:        scanned=${report.scanned.leads} eligible=${report.eligible.leads} migrated=${report.migrated.leads} skipped=${report.skipped.leads}`);
  log(`Transactions: scanned=${report.scanned.transactions} eligible=${report.eligible.transactions} migrated=${report.migrated.transactions} skipped=${report.skipped.transactions}`);
  log(`Requirements: scanned=${report.scanned.requirements} eligible=${report.eligible.requirements} migrated=${report.migrated.requirements} skipped=${report.skipped.requirements}`);
  log(`Duplicates:   ${report.duplicates.length}`);
  log(`Rel. Errors:  ${report.relationshipErrors.length}`);
  log(`Field Warns:  ${report.fieldWarnings.length}`);
  log(`Manual Review:${report.manualReview.length}`);
  log('');

  if (DRY_RUN) {
    log('DRY RUN complete — NO data was written.');
    log('Run with --apply to perform the actual migration.');
    report.mode = 'dry-run';
    saveReport(report);
    return;
  }

  // ── APPLY ──────────────────────────────────────────────────────────────────

  // Create and verify backup before ANY write
  log('Creating backup before apply…');
  const backup = createBackup(db);
  if (!verifyBackup(backup.path)) {
    error('Backup verification failed. Migration ABORTED.');
    process.exit(1);
  }
  // Write manifest — this is the ONLY token rollback will accept
  const { manifestFile } = createManifest(backup);
  log('Backup verified ✓');
  report.backupPath    = backup.path;
  report.manifestFile  = manifestFile;
  report.runId         = backup.runId;

  // Append V2 records (do NOT replace legacy records — they remain readable)
  db.Leads        = [...db.Leads,        ...newV2Leads];
  db.Transactions = [...db.Transactions, ...newV2Txns];
  db.Requirements = [...db.Requirements, ...newV2Reqs];
  db.MigrationMap = [...db.MigrationMap, ...newMigrationEntries];

  writeDb(db);
  log('Database updated ✓');
  log('Migration COMPLETE.');
  saveReport(report);
}

function saveReport(report) {
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
  log(`Migration report saved: ${REPORT_FILE}`);
}

// ── Run ───────────────────────────────────────────────────────────────────────

try {
  run();
} catch (e) {
  error(`Fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
}
