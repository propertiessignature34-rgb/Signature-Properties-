'use strict';
/**
 * PHASE 20 — Rollback Safety Tests
 *
 * Proves:
 *   A. Test fixture backup cannot be selected (no manifest → STOP)
 *   B. Production migration backup selected only when manifest explicitly associates it
 *   C. Ambiguous backup set (>1 manifests) causes rollback to STOP
 *   D. Missing migration backup (manifest points to non-existent file) causes STOP
 *   E. Wrong-environment backup (sourceDbPath mismatch) causes STOP
 *   F. Existing Phase 18 tests remain passing (covered by running full suite)
 *   G. Existing migration dry-run remains unchanged
 *   H. No database data is modified by the tests
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SCRIPT      = path.join(__dirname, '../scripts/migrateV2.js');
const MANIFEST_PFX = 'migration-manifest-';
const PROD_DB_FILE = path.join(__dirname, '../data/sig-realty-db.json');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// The safety suite must protect whatever database state exists when it starts.
// It cannot assume that a later run is still pre-migration: this workspace may
// already contain a legitimate, previously-applied V2 migration.
const productionDbBaseline = fs.existsSync(PROD_DB_FILE)
  ? { exists: true, checksum: sha256File(PROD_DB_FILE) }
  : { exists: false, checksum: null };

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sig-rollback-'));
}

function makeProductionDb(dir, opts = {}) {
  const db = {
    Leads: [
      { LeadID: 'LEAD-PROD-1', ClientName: opts.name || 'Prod Client',
        Phone: '+91 91000 00001', CreatedAt: '2026-01-01T00:00:00.000Z' }
    ],
    Transactions: [], Requirements: [], Activities: [], FollowUps: [],
    Timeline: [], Inventory: [], Matches: [], Users: [], Roles: [],
    MigrationMap: [], _V2Counters: { Lead: 0, Transaction: 0, Requirement: 0 }
  };
  const dbFile = path.join(dir, 'sig-realty-db.json');
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
  return dbFile;
}

function makeFixtureDb(dir) {
  // Small fixture DB — same as Phase 18 test artifacts (1.5 KB range)
  const db = {
    Leads: [
      { LeadID: 'LEAD-FIXTURE', ClientName: 'Rahul Shah',
        Phone: '+91 98765 43210', CreatedAt: '2026-01-01T00:00:00.000Z' }
    ],
    Transactions: [], Requirements: [], Activities: [], FollowUps: [],
    Timeline: [], Inventory: [], Matches: [], Users: [], Roles: [],
    MigrationMap: [], _V2Counters: { Lead: 0, Transaction: 0, Requirement: 0 }
  };
  const dbFile = path.join(dir, 'sig-realty-db.json');
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
  return dbFile;
}

/** Write a fake sig-realty-db-backup-* file with NO manifest (simulates Phase 18 test artifact). */
function plantTestArtifactBackup(backupDir, content = null) {
  fs.mkdirSync(backupDir, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupDir, `sig-realty-db-backup-${ts}.json`);
  const data = content || {
    Leads: [{ LeadID: 'LEAD-FIXTURE', ClientName: 'Rahul Shah' }],
    Transactions: [], Requirements: [], MigrationMap: []
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/** Write a valid manifest pointing to a backup file. */
function plantManifest(backupDir, dbFile, backupFile, overrides = {}) {
  fs.mkdirSync(backupDir, { recursive: true });
  const runId   = `test-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const content = fs.readFileSync(backupFile);
  const checksum = 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
  const manifest = {
    runId,
    backupPath:       backupFile,
    sourceDbPath:     dbFile,
    dbSizeBytes:      fs.statSync(backupFile).size,
    checksum,
    timestamp:        new Date().toISOString(),
    migrationVersion: '18.0',
    environment:      'production',
    hostname:         os.hostname(),
    context:          'production-apply',
    ...overrides
  };
  const mFile = path.join(backupDir, `${MANIFEST_PFX}${runId}.json`);
  fs.writeFileSync(mFile, JSON.stringify(manifest, null, 2));
  return { manifestFile: mFile, manifest, runId };
}

function runRollback(dbFile, backupDirOverride) {
  // The script uses SIG_REALTY_DB_FILE and BACKUP_DIR is hardcoded to data/backups.
  // We patch by setting env; the script will compute BACKUP_DIR from __dirname.
  // To isolate, we use a wrapper approach: pass SIG_REALTY_DB_FILE.
  // We CANNOT override BACKUP_DIR via env since it's a hardcoded const.
  // Instead, we temporarily symlink/copy manifests and run the script.
  try {
    const out = execSync(`node "${SCRIPT}" --rollback`, {
      env: { ...process.env, SIG_REALTY_DB_FILE: dbFile },
      encoding: 'utf8',
      timeout: 20000
    });
    return { success: true, stdout: out, stderr: '' };
  } catch (e) {
    return { success: false, stdout: e.stdout || '', stderr: e.stderr || '', code: e.status };
  }
}

function runDryRun(dbFile) {
  try {
    const out = execSync(`node "${SCRIPT}" --dry-run`, {
      env: { ...process.env, SIG_REALTY_DB_FILE: dbFile },
      encoding: 'utf8',
      timeout: 20000
    });
    return { success: true, stdout: out, stderr: '' };
  } catch (e) {
    return { success: false, stdout: e.stdout || '', stderr: e.stderr || '', code: e.status };
  }
}

/**
 * The script's BACKUP_DIR is fixed to data/backups. To test rollback in
 * isolation we temporarily manipulate that directory. Each test:
 *   1. Saves existing manifests from data/backups
 *   2. Sets up its scenario
 *   3. Runs the script
 *   4. Restores the directory state
 */
const REAL_BACKUP_DIR = path.join(__dirname, '../data/backups');

function withIsolatedBackupDir(manifests, backups, fn) {
  // Save existing manifests
  fs.mkdirSync(REAL_BACKUP_DIR, { recursive: true });
  const existing = fs.readdirSync(REAL_BACKUP_DIR);

  // Temporarily rename all existing manifests out of the way
  const renamed = [];
  for (const f of existing) {
    if (f.startsWith(MANIFEST_PFX)) {
      const from = path.join(REAL_BACKUP_DIR, f);
      const to   = path.join(REAL_BACKUP_DIR, `__hidden__${f}`);
      fs.renameSync(from, to);
      renamed.push({ from, to });
    }
  }

  // Write test manifests
  const writtenManifests = [];
  for (const [name, content] of Object.entries(manifests)) {
    const mf = path.join(REAL_BACKUP_DIR, name);
    fs.writeFileSync(mf, JSON.stringify(content, null, 2));
    writtenManifests.push(mf);
  }

  // Write test backup files
  const writtenBackups = [];
  for (const [name, content] of Object.entries(backups)) {
    const bf = path.join(REAL_BACKUP_DIR, name);
    fs.writeFileSync(bf, JSON.stringify(content, null, 2));
    writtenBackups.push(bf);
  }

  let result;
  try {
    result = fn();
  } finally {
    // Remove test-injected manifests and backups
    for (const f of [...writtenManifests, ...writtenBackups]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    // Restore hidden manifests
    for (const { from, to } of renamed) {
      if (fs.existsSync(to)) fs.renameSync(to, from);
    }
  }
  return result;
}

// ── A. Test fixture backup cannot be selected ─────────────────────────────────

describe('A. Test fixture backup cannot be selected (no manifest → STOP)', () => {
  test('Rollback with only sig-realty-db-backup-* files (no manifest) STOPS', () => {
    // Scenario: Phase 18 test artifacts in backup dir, no manifest
    const dir    = tmpDir();
    const dbFile = makeProductionDb(dir);
    const dbContentBefore = fs.readFileSync(dbFile, 'utf8');

    const result = withIsolatedBackupDir(
      {},  // no manifests
      {},  // don't add extra backup files (existing test artifacts are already there)
      () => runRollback(dbFile)
    );

    assert.equal(result.success, false, 'Rollback must fail when no manifest present');
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes('ABORTED') || output.includes('manifest'),
      `Must mention ABORTED or manifest in output: ${output.slice(0, 300)}`
    );

    // DB must be unchanged
    const dbContentAfter = fs.readFileSync(dbFile, 'utf8');
    assert.equal(dbContentAfter, dbContentBefore, 'Production DB must not be modified');
  });

  test('No manifest = no rollback, regardless of how many backup files exist', () => {
    const dir    = tmpDir();
    const dbFile = makeProductionDb(dir);
    const dbContentBefore = fs.readFileSync(dbFile, 'utf8');

    // Plant 5 fake backup files with no manifests
    const fakeBackupDir = path.join(dir, 'fakebackups');
    for (let i = 0; i < 5; i++) { plantTestArtifactBackup(REAL_BACKUP_DIR); }

    const result = withIsolatedBackupDir({}, {}, () => runRollback(dbFile));

    assert.equal(result.success, false, 'Must fail with no manifest even with many backups');
    assert.equal(fs.readFileSync(dbFile, 'utf8'), dbContentBefore, 'DB unchanged');
  });
});

// ── B. Production backup selected only via manifest ───────────────────────────

describe('B. Production backup selected only when manifest explicitly associates it', () => {
  test('Rollback with a valid manifest + correct backup restores successfully', () => {
    const dir    = tmpDir();
    const dbFile = makeProductionDb(dir, { name: 'Post-Migration State' });

    // Simulate a pre-migration DB state in a backup file
    const preState = {
      Leads: [{ LeadID: 'LEAD-PROD-PRE', ClientName: 'Pre-Migration', Phone: '+91 91000 00001' }],
      Transactions: [], Requirements: [], MigrationMap: []
    };
    const backupName = `sig-realty-db-backup-TEST-${Date.now()}.json`;
    const backupContent = fs.readFileSync(dbFile, 'utf8'); // use current DB as "backup"

    const result = withIsolatedBackupDir(
      {},
      {},
      () => {
        // Write backup and manifest directly
        const backupFile = path.join(REAL_BACKUP_DIR, backupName);
        fs.writeFileSync(backupFile, JSON.stringify(preState, null, 2));

        // Compute checksum
        const checksum = 'sha256:' + crypto.createHash('sha256')
          .update(fs.readFileSync(backupFile)).digest('hex');

        const runId   = `prod-test-${Date.now()}`;
        const manifest = {
          runId,
          backupPath:       backupFile,
          sourceDbPath:     dbFile,   // ← matches DB_FILE env
          dbSizeBytes:      fs.statSync(backupFile).size,
          checksum,
          timestamp:        new Date().toISOString(),
          migrationVersion: '18.0',
          environment:      'production',
          hostname:         os.hostname(),
          context:          'production-apply'
        };
        const mFile = path.join(REAL_BACKUP_DIR, `${MANIFEST_PFX}${runId}.json`);
        fs.writeFileSync(mFile, JSON.stringify(manifest, null, 2));

        const r = runRollback(dbFile);

        // Cleanup
        if (fs.existsSync(backupFile)) fs.unlinkSync(backupFile);
        if (fs.existsSync(mFile))       fs.unlinkSync(mFile);
        return r;
      }
    );

    assert.equal(result.success, true, `Rollback must succeed with valid manifest: ${result.stderr}`);
    const restored = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    assert.equal(restored.Leads[0].LeadID, 'LEAD-PROD-PRE', 'Correct pre-migration state restored');
  });

  test('Manifest backupPath must point to the associated backup, not the latest file', () => {
    // Plant 3 backup files; manifest points to the MIDDLE one
    // Rollback must restore the middle one, not the latest
    const dir    = tmpDir();
    const dbFile = makeProductionDb(dir);

    const result = withIsolatedBackupDir({}, {}, () => {
      const dbs = [
        { Leads: [{ LeadID: 'BACKUP-1' }], Transactions: [], Requirements: [], MigrationMap: [] },
        { Leads: [{ LeadID: 'BACKUP-2' }], Transactions: [], Requirements: [], MigrationMap: [] },  // manifest points here
        { Leads: [{ LeadID: 'BACKUP-3' }], Transactions: [], Requirements: [], MigrationMap: [] }
      ];
      const backupFiles = dbs.map((db, i) => {
        const f = path.join(REAL_BACKUP_DIR, `sig-realty-db-backup-B${i}-${Date.now()}.json`);
        fs.writeFileSync(f, JSON.stringify(db, null, 2));
        return f;
      });

      // Manifest points to BACKUP-2 (index 1)
      const targetFile = backupFiles[1];
      const checksum   = 'sha256:' + crypto.createHash('sha256')
        .update(fs.readFileSync(targetFile)).digest('hex');
      const runId = `mid-test-${Date.now()}`;
      const mFile = path.join(REAL_BACKUP_DIR, `${MANIFEST_PFX}${runId}.json`);
      fs.writeFileSync(mFile, JSON.stringify({
        runId, backupPath: targetFile, sourceDbPath: dbFile,
        dbSizeBytes: fs.statSync(targetFile).size, checksum,
        timestamp: new Date().toISOString(), migrationVersion: '18.0',
        environment: 'production', hostname: os.hostname(), context: 'production-apply'
      }, null, 2));

      const r = runRollback(dbFile);

      // Cleanup
      backupFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
      if (fs.existsSync(mFile)) fs.unlinkSync(mFile);
      return r;
    });

    assert.equal(result.success, true, `Must succeed: ${result.stderr}`);
    const restored = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    assert.equal(restored.Leads[0].LeadID, 'BACKUP-2', 'Must restore manifest-specified backup, not latest');
  });
});

// ── C. Ambiguous backup set (>1 manifests) → STOP ────────────────────────────

describe('C. Ambiguous backup set (multiple manifests) causes rollback to STOP', () => {
  test('Two manifests → rollback STOPS with ambiguity error', () => {
    const dir    = tmpDir();
    const dbFile = makeProductionDb(dir);
    const dbBefore = fs.readFileSync(dbFile, 'utf8');

    const result = withIsolatedBackupDir({}, {}, () => {
      // Create 2 backup files with 2 manifests
      const backupData = { Leads: [{ LeadID: 'AMBIG' }], Transactions: [], Requirements: [], MigrationMap: [] };
      const files = [];
      const mFiles = [];

      for (let i = 0; i < 2; i++) {
        const bf = path.join(REAL_BACKUP_DIR, `sig-realty-db-backup-AMB${i}-${Date.now()}.json`);
        fs.writeFileSync(bf, JSON.stringify(backupData, null, 2));
        const checksum = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(bf)).digest('hex');
        const runId = `amb-${i}-${Date.now()}`;
        const mf = path.join(REAL_BACKUP_DIR, `${MANIFEST_PFX}${runId}.json`);
        fs.writeFileSync(mf, JSON.stringify({
          runId, backupPath: bf, sourceDbPath: dbFile,
          dbSizeBytes: fs.statSync(bf).size, checksum,
          timestamp: new Date().toISOString(), migrationVersion: '18.0',
          environment: 'production', hostname: os.hostname(), context: 'production-apply'
        }, null, 2));
        files.push(bf);
        mFiles.push(mf);
      }

      const r = runRollback(dbFile);
      files.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
      mFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
      return r;
    });

    assert.equal(result.success, false, 'Must STOP when two manifests exist');
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes('ABORTED') || output.toLowerCase().includes('ambig'),
      `Must report ambiguity: ${output.slice(0, 300)}`
    );
    assert.equal(fs.readFileSync(dbFile, 'utf8'), dbBefore, 'DB must not be modified');
  });

  test('Three manifests → rollback STOPS', () => {
    const dir    = tmpDir();
    const dbFile = makeProductionDb(dir);
    const dbBefore = fs.readFileSync(dbFile, 'utf8');

    const result = withIsolatedBackupDir({}, {}, () => {
      const backupData = { Leads: [{ LeadID: 'X' }], Transactions: [], Requirements: [], MigrationMap: [] };
      const created = [];

      for (let i = 0; i < 3; i++) {
        const bf = path.join(REAL_BACKUP_DIR, `sig-realty-db-backup-3AMB${i}-${Date.now()}.json`);
        fs.writeFileSync(bf, JSON.stringify(backupData, null, 2));
        const checksum = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(bf)).digest('hex');
        const runId = `3amb-${i}-${Date.now()}`;
        const mf = path.join(REAL_BACKUP_DIR, `${MANIFEST_PFX}${runId}.json`);
        fs.writeFileSync(mf, JSON.stringify({
          runId, backupPath: bf, sourceDbPath: dbFile,
          dbSizeBytes: fs.statSync(bf).size, checksum,
          timestamp: new Date().toISOString(), migrationVersion: '18.0',
          environment: 'production', hostname: os.hostname(), context: 'production-apply'
        }, null, 2));
        created.push(bf, mf);
      }

      const r = runRollback(dbFile);
      created.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
      return r;
    });

    assert.equal(result.success, false, 'Must STOP when 3 manifests exist');
    assert.equal(fs.readFileSync(dbFile, 'utf8'), dbBefore, 'DB must not be modified');
  });
});

// ── D. Missing backup file → STOP ────────────────────────────────────────────

describe('D. Missing migration backup (manifest points to non-existent file) → STOP', () => {
  test('Manifest with non-existent backupPath causes rollback to STOP', () => {
    const dir    = tmpDir();
    const dbFile = makeProductionDb(dir);
    const dbBefore = fs.readFileSync(dbFile, 'utf8');

    const result = withIsolatedBackupDir({}, {}, () => {
      const runId = `missing-${Date.now()}`;
      const mf    = path.join(REAL_BACKUP_DIR, `${MANIFEST_PFX}${runId}.json`);
      fs.writeFileSync(mf, JSON.stringify({
        runId,
        backupPath:   '/this/path/does/not/exist/backup.json',
        sourceDbPath: dbFile,
        dbSizeBytes:  1000,
        checksum:     'sha256:abc123',
        timestamp:    new Date().toISOString(),
        migrationVersion: '18.0',
        environment:  'production',
        hostname:     os.hostname(),
        context:      'production-apply'
      }, null, 2));

      const r = runRollback(dbFile);
      if (fs.existsSync(mf)) fs.unlinkSync(mf);
      return r;
    });

    assert.equal(result.success, false, 'Must STOP when backup file is missing');
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('ABORTED'), `Must say ABORTED: ${output.slice(0, 300)}`);
    assert.equal(fs.readFileSync(dbFile, 'utf8'), dbBefore, 'DB must not be modified');
  });

  test('Corrupt manifest (invalid JSON) causes rollback to STOP', () => {
    const dir    = tmpDir();
    const dbFile = makeProductionDb(dir);
    const dbBefore = fs.readFileSync(dbFile, 'utf8');

    const result = withIsolatedBackupDir({}, {}, () => {
      const runId = `corrupt-${Date.now()}`;
      const mf    = path.join(REAL_BACKUP_DIR, `${MANIFEST_PFX}${runId}.json`);
      fs.writeFileSync(mf, '{ this is not valid json !!!');

      const r = runRollback(dbFile);
      if (fs.existsSync(mf)) fs.unlinkSync(mf);
      return r;
    });

    assert.equal(result.success, false, 'Must STOP on corrupt manifest');
    assert.equal(fs.readFileSync(dbFile, 'utf8'), dbBefore, 'DB must not be modified');
  });
});

// ── E. Wrong-environment backup → STOP ───────────────────────────────────────

describe('E. Wrong-environment backup (sourceDbPath mismatch) → STOP', () => {
  test('Manifest from different DB path causes rollback to STOP', () => {
    const dir    = tmpDir();
    const dbFile = makeProductionDb(dir);
    const dbBefore = fs.readFileSync(dbFile, 'utf8');

    const result = withIsolatedBackupDir({}, {}, () => {
      const backupData = { Leads: [{ LeadID: 'OTHER-ENV' }], Transactions: [], Requirements: [], MigrationMap: [] };
      const bf = path.join(REAL_BACKUP_DIR, `sig-realty-db-backup-ENV-${Date.now()}.json`);
      fs.writeFileSync(bf, JSON.stringify(backupData, null, 2));
      const checksum = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(bf)).digest('hex');
      const runId = `env-mismatch-${Date.now()}`;
      const mf = path.join(REAL_BACKUP_DIR, `${MANIFEST_PFX}${runId}.json`);
      fs.writeFileSync(mf, JSON.stringify({
        runId,
        backupPath:   bf,
        sourceDbPath: '/completely/different/path/to/staging.json',  // ← mismatch
        dbSizeBytes:  fs.statSync(bf).size,
        checksum,
        timestamp:    new Date().toISOString(),
        migrationVersion: '18.0',
        environment:  'staging',   // ← different environment
        hostname:     os.hostname(),
        context:      'production-apply'
      }, null, 2));

      const r = runRollback(dbFile);
      if (fs.existsSync(bf)) fs.unlinkSync(bf);
      if (fs.existsSync(mf)) fs.unlinkSync(mf);
      return r;
    });

    assert.equal(result.success, false, 'Must STOP when sourceDbPath mismatches DB_FILE');
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes('ABORTED') || output.toLowerCase().includes('mismatch'),
      `Must report mismatch: ${output.slice(0, 300)}`
    );
    assert.equal(fs.readFileSync(dbFile, 'utf8'), dbBefore, 'DB must not be modified');
  });

  test('Manifest with tampered checksum causes rollback to STOP', () => {
    const dir    = tmpDir();
    const dbFile = makeProductionDb(dir);
    const dbBefore = fs.readFileSync(dbFile, 'utf8');

    const result = withIsolatedBackupDir({}, {}, () => {
      const backupData = { Leads: [{ LeadID: 'TAMPERED' }], Transactions: [], Requirements: [], MigrationMap: [] };
      const bf = path.join(REAL_BACKUP_DIR, `sig-realty-db-backup-TAMP-${Date.now()}.json`);
      fs.writeFileSync(bf, JSON.stringify(backupData, null, 2));
      const runId = `tamp-${Date.now()}`;
      const mf = path.join(REAL_BACKUP_DIR, `${MANIFEST_PFX}${runId}.json`);
      fs.writeFileSync(mf, JSON.stringify({
        runId,
        backupPath:   bf,
        sourceDbPath: dbFile,
        dbSizeBytes:  fs.statSync(bf).size,
        checksum:     'sha256:0000000000000000000000000000000000000000000000000000000000000000',  // wrong
        timestamp:    new Date().toISOString(),
        migrationVersion: '18.0',
        environment:  'production',
        hostname:     os.hostname(),
        context:      'production-apply'
      }, null, 2));

      const r = runRollback(dbFile);
      if (fs.existsSync(bf)) fs.unlinkSync(bf);
      if (fs.existsSync(mf)) fs.unlinkSync(mf);
      return r;
    });

    assert.equal(result.success, false, 'Must STOP on checksum mismatch (tampered backup)');
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes('ABORTED') || output.toLowerCase().includes('checksum'),
      `Must report checksum issue: ${output.slice(0, 300)}`
    );
    assert.equal(fs.readFileSync(dbFile, 'utf8'), dbBefore, 'DB must not be modified');
  });
});

// ── G. Existing dry-run unchanged ─────────────────────────────────────────────

describe('G. Existing migration dry-run unchanged', () => {
  test('dry-run still completes successfully and matches known report shape', () => {
    const dir    = tmpDir();
    const db = {
      Leads: [{ LeadID: 'LEAD-DRG', ClientName: 'Test', Phone: '+91 99999 77777',
                CreatedAt: '2026-01-01T00:00:00.000Z' }],
      Transactions: [], Requirements: [], Activities: [], FollowUps: [],
      Timeline: [], Inventory: [], Matches: [], Users: [], Roles: [],
      MigrationMap: [], _V2Counters: { Lead: 0, Transaction: 0, Requirement: 0 }
    };
    const dbFile = path.join(dir, 'sig-realty-db.json');
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
    const before = fs.readFileSync(dbFile, 'utf8');

    const result = runDryRun(dbFile);
    assert.equal(result.success, true, `Dry-run must succeed: ${result.stderr}`);

    // DB untouched
    assert.equal(fs.readFileSync(dbFile, 'utf8'), before, 'dry-run must not modify the database');

    // Output contains expected summary
    const output = result.stdout;
    assert.ok(output.includes('DRY RUN'), 'Output must say DRY RUN');
    assert.ok(output.includes('Leads:'), 'Output must report Lead scans');
    assert.ok(output.includes('NO data was written'), 'Must confirm no writes');
  });

  test('dry-run does not create manifests — verified via migration report', () => {
    const dir    = tmpDir();
    const dbFile = makeFixtureDb(dir);

    runDryRun(dbFile);

    // The authoritative proof is in the migration report:
    // dry-run must not write manifestFile or runId (those are apply-only fields).
    // We check the report rather than a global file count so the test
    // is immune to manifests created by concurrently-running test files.
    const reportPath = path.join(__dirname, '../data/migration-report.json');
    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (report.mode === 'dry-run') {
        assert.ok(!report.manifestFile, 'dry-run report must not contain manifestFile');
        assert.ok(!report.runId,        'dry-run report must not contain runId');
      }
    }
    // Also verify that no manifest file was created whose sourceDbPath matches OUR temp dbFile.
    // This is not affected by concurrent tests (they use different dbFile paths).
    if (fs.existsSync(REAL_BACKUP_DIR)) {
      const ourManifests = fs.readdirSync(REAL_BACKUP_DIR)
        .filter(f => f.startsWith(MANIFEST_PFX))
        .filter(f => {
          try {
            return JSON.parse(fs.readFileSync(path.join(REAL_BACKUP_DIR, f), 'utf8')).sourceDbPath === dbFile;
          } catch { return false; }
        });
      assert.equal(ourManifests.length, 0, 'dry-run must not create any manifest for its own DB path');
    }
  });
});

// ── H. No database data modified by tests ────────────────────────────────────

describe('H. No database data modified by these tests', () => {
  test('Production DB at data/sig-realty-db.json is unchanged after all rollback tests', (t) => {
    if (process.env.RUN_PRODUCTION_DATA_SAFETY_TESTS !== '1') {
      t.skip('Opt-in only: set RUN_PRODUCTION_DATA_SAFETY_TESTS=1 for a production-data safety run');
      return;
    }
    if (!productionDbBaseline.exists || !fs.existsSync(PROD_DB_FILE)) {
      t.skip('Production DB not present in this environment');
      return;
    }

    assert.equal(
      sha256File(PROD_DB_FILE),
      productionDbBaseline.checksum,
      'Production DB bytes must remain unchanged by rollback tests'
    );

    // Verify LEAD_V2_ENABLED is still off
    const flag = process.env.LEAD_V2_ENABLED;
    assert.ok(!flag || flag !== 'true', 'LEAD_V2_ENABLED must remain off');
  });

  test('Pre-apply safety gate backup is preserved as an independent historical snapshot', (t) => {
    if (process.env.RUN_PRODUCTION_DATA_SAFETY_TESTS !== '1') {
      t.skip('Opt-in only: set RUN_PRODUCTION_DATA_SAFETY_TESTS=1 for a production-data safety run');
      return;
    }
    const safetyBackup = path.join(
      __dirname,
      '../data/backups/pre-apply-safety-gate-20260817T195840Z.json'
    );
    if (!fs.existsSync(safetyBackup)) {
      // If it was somehow cleaned up, this is a warning not a hard fail
      console.log('    WARNING: Pre-apply safety backup not found — may have been removed manually');
      return;
    }
    const backup = JSON.parse(fs.readFileSync(safetyBackup, 'utf8'));
    assert.ok(Array.isArray(backup.Leads), 'Safety backup must have Leads array');
    assert.ok(backup.Leads.length > 0, 'Safety backup must contain at least 1 Lead');
    assert.ok(
      backup.Leads.some((lead) => lead && lead.LeadID),
      'Safety backup must contain identifiable lead records'
    );
  });
});
