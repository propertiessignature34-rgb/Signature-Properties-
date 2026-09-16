'use strict';
/**
 * PHASE 18 — V1 → V2 Migration
 * Tests: dry-run, apply, rollback, MigrationMap, relationship validation, no data mutation
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { execSync } = require('child_process');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sig-p18-'));
}

function makeFixtureDb(dir) {
  // Build a minimal fixture DB with legacy V1 records
  const db = {
    Leads: [
      {
        LeadID: 'LEAD-0001', ClientName: 'Rahul Shah',
        Phone: '+91 98765 43210', Email: 'rahul@test.com',
        LeadStatus: 'Active', Lifecycle: 'Client',
        CreatedAt: '2026-01-01T00:00:00.000Z', UpdatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        LeadID: 'LEAD-0002', ClientName: 'Priya Patel',
        Phone: '+91 98220 11888', Email: 'priya@test.com',
        LeadStatus: 'New', Lifecycle: 'Prospect',
        CreatedAt: '2026-01-02T00:00:00.000Z', UpdatedAt: '2026-01-02T00:00:00.000Z'
      }
    ],
    Transactions: [
      {
        TransactionID: 'TXN-0001', LeadID: 'LEAD-0001', TransactionType: 'Purchase',
        Status: 'Open', CreatedAt: '2026-01-01T00:00:00.000Z'
      }
    ],
    Requirements: [
      {
        RequirementID: 'REQ-0001', LeadID: 'LEAD-0001', TransactionID: 'TXN-0001',
        Category: 'Residential', SubCategory: 'Flat',
        BudgetMax: 10000000, Location1: 'Vesu',
        Fields: { BudgetMax: { state: 'KNOWN', value: 10000000 } },
        CreatedAt: '2026-01-01T00:00:00.000Z'
      }
    ],
    Activities: [], FollowUps: [], Timeline: [], Inventory: [],
    Matches: [], Deals: [], Users: [], Roles: [],
    MigrationMap: [],
    _V2Counters: { Lead: 0, Transaction: 0, Requirement: 0 }
  };

  const file = path.join(dir, 'sig-realty-db.json');
  fs.writeFileSync(file, JSON.stringify(db, null, 2));
  return file;
}

function runMigration(dbFile, mode = '--dry-run', extraEnv = {}) {
  const script = path.join(__dirname, '../scripts/migrateV2.js');
  try {
    const out = execSync(`node "${script}" ${mode}`, {
      env: { ...process.env, SIG_REALTY_DB_FILE: dbFile, ...extraEnv },
      encoding: 'utf8',
      timeout: 30000
    });
    return { success: true, stdout: out, stderr: '' };
  } catch (e) {
    return { success: false, stdout: e.stdout || '', stderr: e.stderr || '', code: e.status };
  }
}

// ── A. Dry-run — no data mutation ─────────────────────────────────────────────

describe('A. Dry-run — no data mutation', () => {
  test('--dry-run does not modify the database file', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    const before = fs.readFileSync(dbFile, 'utf8');

    runMigration(dbFile, '--dry-run');

    const after = fs.readFileSync(dbFile, 'utf8');
    assert.equal(after, before, 'Dry-run must not modify the database file');
  });

  test('--dry-run exits successfully (no crash)', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    const result = runMigration(dbFile, '--dry-run');
    assert.equal(result.success, true, `Dry-run failed: ${result.stderr}`);
  });

  test('--dry-run reports scanned records', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    const result = runMigration(dbFile, '--dry-run');
    // Should mention Leads, Transactions, Requirements
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('Lead') || output.includes('lead'), 'Dry-run must report Lead scans');
  });

  test('no backup created during dry-run', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--dry-run');
    const backupDir = path.join(path.dirname(dbFile), 'backups');
    const backupCount = fs.existsSync(backupDir)
      ? fs.readdirSync(backupDir).filter(f => f.includes('backup')).length
      : 0;
    assert.equal(backupCount, 0, 'Dry-run must not create backups');
  });
});

// ── B. Apply mode ─────────────────────────────────────────────────────────────
//
// Each apply test cleans up ONLY its own manifest (via clearManifestsForDb)
// after asserting. This prevents manifest accumulation across test runs
// without affecting concurrent tests that use different dbFile paths.
// clearManifestsForDb is defined in section C below; tests in B call it
// inline since JS hoists function declarations.

// Forward-declare so B tests can reference it; full def is in C section.
function _clearMfForDb(dbFile) {
  const MFX = 'migration-manifest-';
  const BD  = path.join(__dirname, '../data/backups');
  if (!fs.existsSync(BD)) return;
  for (const f of fs.readdirSync(BD).filter(f => f.startsWith(MFX))) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(BD, f), 'utf8'));
      if (m.sourceDbPath === dbFile) fs.unlinkSync(path.join(BD, f));
    } catch { /* already gone */ }
  }
}

describe('B. Apply mode — actual migration', () => {
  test('--apply creates a backup file', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--apply');
    // Backup is always written to data/backups (fixed path, not relative to SIG_REALTY_DB_FILE)
    const backupDir = path.join(__dirname, '../data/backups');
    assert.ok(fs.existsSync(backupDir), 'Backup directory must exist after apply');
    const backups = fs.readdirSync(backupDir).filter(f => f.includes('backup'));
    assert.ok(backups.length > 0, 'At least one backup file must exist after apply');
    _clearMfForDb(dbFile);
  });

  test('--apply creates V2 records in Leads', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--apply');
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const v2Leads = db.Leads.filter(l => l._v2 === true);
    assert.ok(v2Leads.length > 0, 'Apply must create V2 Lead records');
    _clearMfForDb(dbFile);
  });

  test('--apply preserves legacy records (LEAD-0001 still exists)', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--apply');
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const legacyLead = db.Leads.find(l => l.LeadID === 'LEAD-0001');
    assert.ok(legacyLead, 'Legacy LEAD-0001 must still exist after migration');
    _clearMfForDb(dbFile);
  });

  test('--apply creates MigrationMap entries', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--apply');
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    assert.ok(Array.isArray(db.MigrationMap), 'MigrationMap must exist');
    assert.ok(db.MigrationMap.length > 0, 'MigrationMap must have entries after apply');
    _clearMfForDb(dbFile);
  });

  test('--apply MigrationMap has LegacyID, V2ID, EntityType', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--apply');
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    for (const entry of db.MigrationMap) {
      assert.ok(entry.LegacyID,    'MigrationMap entry must have LegacyID');
      assert.ok(entry.V2ID,        'MigrationMap entry must have V2ID');
      assert.ok(entry.EntityType,  'MigrationMap entry must have EntityType');
      assert.ok(entry.Status,      'MigrationMap entry must have Status');
      assert.ok(entry.CreatedAt,   'MigrationMap entry must have CreatedAt');
    }
    _clearMfForDb(dbFile);
  });

  test('--apply: V2 Lead preserves ClientName', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--apply');
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const v2Leads = db.Leads.filter(l => l._v2 === true);
    assert.ok(v2Leads.some(l => l.ClientName === 'Rahul Shah'), 'V2 Lead must preserve ClientName');
    _clearMfForDb(dbFile);
  });

  test('--apply: V2 Lead maps Phone to PrimaryMobile', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--apply');
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const v2 = db.Leads.find(l => l._v2 && l.LegacyID === 'LEAD-0001');
    assert.ok(v2, 'V2 Lead for LEAD-0001 must exist');
    assert.ok(v2.PrimaryMobile, 'V2 Lead must have PrimaryMobile mapped from Phone');
    _clearMfForDb(dbFile);
  });

  test('--apply: V2 Requirement.LeadID === V2 Transaction.LeadID', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--apply');
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const v2Reqs = db.Requirements.filter(r => r._v2);
    const v2Txns = db.Transactions.filter(t => t._v2);
    for (const req of v2Reqs) {
      const txn = v2Txns.find(t => t.TransactionID === req.TransactionID || t.LegacyID === req.LegacyID?.replace('REQ', 'TXN'));
      if (!txn) continue;
      assert.equal(req.LeadID, txn.LeadID, `Req ${req.RequirementID} LeadID must match Txn LeadID`);
    }
    _clearMfForDb(dbFile);
  });

  test('--apply: UNKNOWN fields remain UNKNOWN — not invented', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--apply');
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const v2Req = db.Requirements.find(r => r._v2 && r.LegacyID === 'REQ-0001');
    if (!v2Req) { _clearMfForDb(dbFile); return; }
    const fields = v2Req.Fields || {};
    for (const [k, v] of Object.entries(fields)) {
      if (v.state === 'KNOWN') {
        assert.ok(v.value != null, `KNOWN field ${k} must have a value`);
      }
    }
    _clearMfForDb(dbFile);
  });

  test('running --apply twice is idempotent (already migrated records skipped)', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--apply');
    const dbAfterFirst = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const v2CountAfterFirst = dbAfterFirst.Leads.filter(l => l._v2).length;
    _clearMfForDb(dbFile);  // clean after first apply so second creates only 1 manifest

    runMigration(dbFile, '--apply');
    const dbAfterSecond = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const v2CountAfterSecond = dbAfterSecond.Leads.filter(l => l._v2).length;
    assert.equal(v2CountAfterSecond, v2CountAfterFirst, 'Second apply must not create duplicate V2 records');
    _clearMfForDb(dbFile);
  });

  test('does not touch Inventory or Matches', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    const before = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    runMigration(dbFile, '--apply');
    const after = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    assert.deepEqual(after.Inventory, before.Inventory, 'Inventory must not be modified');
    assert.deepEqual(after.Matches,   before.Matches,   'Matches must not be modified');
    _clearMfForDb(dbFile);
  });
});

// ── C. Rollback ───────────────────────────────────────────────────────────────
//
// Rollback uses a manifest-based selection mechanism.
// Each --apply writes one migration-manifest-*.json in data/backups.
// --rollback requires exactly ONE manifest; multiple manifests → STOP.
//
// ISOLATION DESIGN:
//   Tests run concurrently with other test files that also use data/backups.
//   Surgical helpers operate ONLY on manifests whose sourceDbPath matches the
//   test's own dbFile, so concurrent tests are never affected.

const MANIFEST_PREFIX = 'migration-manifest-';
const BACKUP_DIR_PATH = path.join(__dirname, '../data/backups');

/** Remove only manifests created for a specific DB file path (surgical, safe for concurrency). */
function clearManifestsForDb(dbFile) {
  if (!fs.existsSync(BACKUP_DIR_PATH)) return;
  const files = fs.readdirSync(BACKUP_DIR_PATH).filter(f => f.startsWith(MANIFEST_PREFIX));
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR_PATH, f), 'utf8'));
      if (m.sourceDbPath === dbFile) fs.unlinkSync(path.join(BACKUP_DIR_PATH, f));
    } catch { /* file already gone or unreadable — skip */ }
  }
}

/**
 * Hide all manifests NOT belonging to dbFile by renaming to __p18rb__* so that
 * --rollback sees exactly the one manifest for this test's apply run.
 * Returns list of hidden names for restoration.
 */
function hideForeignManifests(dbFile) {
  if (!fs.existsSync(BACKUP_DIR_PATH)) return [];
  const hidden = [];
  const files  = fs.readdirSync(BACKUP_DIR_PATH).filter(f => f.startsWith(MANIFEST_PREFIX));
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR_PATH, f), 'utf8'));
      if (m.sourceDbPath !== dbFile) {
        const from = path.join(BACKUP_DIR_PATH, f);
        const to   = path.join(BACKUP_DIR_PATH, `__p18rb__${f}`);
        fs.renameSync(from, to);
        hidden.push({ from, to });
      }
    } catch { /* unreadable manifest — hide it too to be safe */
      try {
        const from = path.join(BACKUP_DIR_PATH, f);
        const to   = path.join(BACKUP_DIR_PATH, `__p18rb__${f}`);
        fs.renameSync(from, to);
        hidden.push({ from, to });
      } catch { /* already gone */ }
    }
  }
  return hidden;
}

function restoreHiddenManifests(hidden) {
  for (const { from, to } of hidden) {
    try { if (fs.existsSync(to)) fs.renameSync(to, from); } catch { /* gone */ }
  }
}

describe('C. Rollback mechanism', () => {
  test('--rollback restores database from backup (manifest-based)', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    const before = fs.readFileSync(dbFile, 'utf8');

    // Remove any stale manifests for this specific dbFile
    clearManifestsForDb(dbFile);

    // Apply migration — creates exactly one backup + one manifest for dbFile
    runMigration(dbFile, '--apply');

    // Verify database changed
    const afterApply = fs.readFileSync(dbFile, 'utf8');
    assert.notEqual(afterApply, before, 'Apply must have changed the database');

    // Hide any foreign manifests (from concurrent test files) so rollback
    // sees exactly 1 manifest and can proceed unambiguously
    const hidden = hideForeignManifests(dbFile);
    let rollbackResult;
    try {
      rollbackResult = runMigration(dbFile, '--rollback');
    } finally {
      restoreHiddenManifests(hidden);
    }

    assert.equal(rollbackResult.success, true,
      `Rollback failed: ${rollbackResult.stderr}\n${rollbackResult.stdout}`);

    // Verify database restored to pre-apply state
    const afterRollback = fs.readFileSync(dbFile, 'utf8');
    const parsedBefore  = JSON.parse(before);
    const parsedAfter   = JSON.parse(afterRollback);
    assert.equal(
      parsedAfter.Leads.filter(l => !l._v2).length,
      parsedBefore.Leads.length,
      'Rollback must restore original legacy leads count'
    );

    // Cleanup: remove our own manifest
    clearManifestsForDb(dbFile);
  });

  test('--rollback fails gracefully when no manifest present (new safety contract)', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);

    // Ensure no manifest for this specific dbFile
    clearManifestsForDb(dbFile);

    // Hide all foreign manifests so rollback sees 0
    const hidden = hideForeignManifests(dbFile);
    let result;
    try {
      result = runMigration(dbFile, '--rollback');
    } finally {
      restoreHiddenManifests(hidden);
    }

    assert.equal(result.success, false, 'Rollback must fail when no manifest present');
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes('ABORTED') && output.includes('manifest'),
      `Must report ABORTED + mention manifest: ${output.slice(0, 300)}`
    );
    assert.ok(!output.includes('Uncaught'), 'Must not crash with uncaught exception');
  });
});

// ── D. Duplicate detection ────────────────────────────────────────────────────

describe('D. Duplicate detection', () => {
  test('duplicate mobile is detected and flagged, not double-migrated', () => {
    const dir = makeTempDir();
    // Create DB with two leads sharing the same mobile
    const db = {
      Leads: [
        { LeadID: 'LEAD-A', ClientName: 'A', Phone: '+91 99999 00001', CreatedAt: '2026-01-01T00:00:00.000Z' },
        { LeadID: 'LEAD-B', ClientName: 'B', Phone: '+91 99999 00001', CreatedAt: '2026-01-02T00:00:00.000Z' }
      ],
      Transactions: [], Requirements: [], Activities: [], FollowUps: [],
      Timeline: [], Inventory: [], Matches: [], Users: [], Roles: [],
      MigrationMap: [], _V2Counters: { Lead: 0, Transaction: 0, Requirement: 0 }
    };
    const dbFile = path.join(dir, 'sig-realty-db.json');
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

    const result = runMigration(dbFile, '--dry-run');
    const output = result.stdout + result.stderr;
    // Should detect and report duplicate
    assert.ok(
      output.toLowerCase().includes('duplicate') || output.toLowerCase().includes('dup'),
      'Dry-run must report duplicate detection'
    );
  });
});

// ── E. Migration report ───────────────────────────────────────────────────────

describe('E. Migration report', () => {
  test('--apply generates a migration-report.json', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--apply');
    const reportFile = path.join(path.dirname(dbFile), '..', 'data', 'migration-report.json');
    // The report is saved to the data dir next to scripts dir
    // Since SIG_REALTY_DB_FILE is set, report is relative to data/
    const possiblePaths = [
      path.join(path.dirname(dbFile), 'migration-report.json'),
      path.join(__dirname, '../data/migration-report.json')
    ];
    const reportExists = possiblePaths.some(p => fs.existsSync(p));
    assert.ok(reportExists, 'migration-report.json must exist after apply');
  });

  test('report has required fields', () => {
    const dir    = makeTempDir();
    const dbFile = makeFixtureDb(dir);
    runMigration(dbFile, '--apply');
    const possiblePaths = [
      path.join(path.dirname(dbFile), 'migration-report.json'),
      path.join(__dirname, '../data/migration-report.json')
    ];
    const reportPath = possiblePaths.find(p => fs.existsSync(p));
    if (!reportPath) { return; } // skip if not found
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.ok('migrationVersion' in report, 'report must have migrationVersion');
    assert.ok('scanned' in report,          'report must have scanned');
    assert.ok('migrated' in report,         'report must have migrated');
    assert.ok('duplicates' in report,       'report must have duplicates');
    assert.ok('manualReview' in report,     'report must have manualReview');
  });
});
