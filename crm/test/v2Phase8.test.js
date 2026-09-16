/**
 * PHASE 8 — Configuration Engine Tests
 *
 * Covers:
 *   1. V2ConfigService: instantiation, seed, idempotency
 *   2. getFieldConfig: all records, category filter, tier filter, scope (null = universal)
 *   3. getQuestionConfig: ordering, context filters
 *   4. resolveFieldsForContext: correct set for known contexts
 *   5. getFieldConfigById / getFieldConfigByKey
 *   6. Static fallback: returns static config when DB has no V2FieldConfig
 *   7. V2Router API routes: /api/v2/config/fields, /api/v2/config/questions, /api/v2/config/scoring, /api/v2/config/workflows
 *   8. Regression: all original 77 tests continue to pass (tested via node invocation in shell)
 */

'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-v2-p8-test-'));
  return path.join(dir, 'test.json');
}

function makeRepo(dbFile) {
  const { JsonRepository } = require('../src/data/repository');
  return new JsonRepository(dbFile);
}

function makeConfigSvc(repo) {
  const { V2ConfigService } = require('../src/services/v2ConfigService');
  return new V2ConfigService(repo);
}

// Build a minimal V2Router-like helper for route testing without starting a server
function makeRouterHandle(repo) {
  const { V2Router } = require('../src/api/v2Router');
  const router = new V2Router(repo);

  // Returns { statusCode, body } for a given method+path+searchParams
  return async function handle(method, pathAndQuery) {
    const url  = new URL(`http://localhost${pathAndQuery}`);
    const body = {};
    const captured = { statusCode: null, body: null };
    const res = {
      writeHead(code)  { captured.statusCode = code; },
      end(data)        { try { captured.body = JSON.parse(data); } catch { captured.body = data; } }
    };
    const req = { method };

    const result = await router.handle(req, res, url, body);
    if (result && result.handled !== false) {
      // router returned { statusCode, body } directly
      return { statusCode: result.statusCode, body: result.body };
    }
    return captured;
  };
}

// ── Suite 1: V2ConfigService — construction ────────────────────────────────────

describe('V2ConfigService: construction', () => {
  test('does not require a JSON file when Mongo is enabled but not initialized yet', () => {
    const originalEnv = { ...process.env };
    try {
      process.env.STORAGE_MODE = 'mongo';
      process.env.MONGO_URL = 'mongodb://localhost:27017/signature_properties';
      process.env.MONGO_DB = 'signature_properties';

      delete require.cache[require.resolve('../src/data/mongoStore')];
      delete require.cache[require.resolve('../src/data/repository')];

      const { JsonRepository } = require('../src/data/repository');
      const missingDbFile = path.join(os.tmpdir(), `sig-mongo-preinit-${Date.now()}.json`);
      const repo = new JsonRepository(missingDbFile);
      const { V2ConfigService } = require('../src/services/v2ConfigService');
      const svc = new V2ConfigService(repo);

      const result = svc.seedConfigIfEmpty();
      assert.equal(result.seeded, true);
      assert.ok(result.fieldConfigCount > 0);
      assert.ok(result.questionConfigCount > 0);
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) delete process.env[key];
      }
      Object.assign(process.env, originalEnv);
      delete require.cache[require.resolve('../src/data/mongoStore')];
      delete require.cache[require.resolve('../src/data/repository')];
    }
  });

  test('V2Router startup succeeds in mongo mode with a missing JSON file', () => {
    const originalEnv = { ...process.env };
    try {
      process.env.STORAGE_MODE = 'mongo';
      process.env.MONGO_URL = 'mongodb://localhost:27017/signature_properties';
      process.env.MONGO_DB = 'signature_properties';
      process.env.SIG_REALTY_DB_FILE = '/tmp/nonexistent-test-file.json';

      delete require.cache[require.resolve('../src/data/mongoStore')];
      delete require.cache[require.resolve('../src/data/repository')];
      delete require.cache[require.resolve('../src/api/v2Router')];

      const { JsonRepository } = require('../src/data/repository');
      const repo = new JsonRepository(process.env.SIG_REALTY_DB_FILE);
      const { V2Router } = require('../src/api/v2Router');
      const router = new V2Router(repo);

      assert.ok(router);
      assert.ok(router.configSvc);
      assert.ok(router.registrySvc);
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) delete process.env[key];
      }
      Object.assign(process.env, originalEnv);
      delete require.cache[require.resolve('../src/data/mongoStore')];
      delete require.cache[require.resolve('../src/data/repository')];
      delete require.cache[require.resolve('../src/api/v2Router')];
    }
  });

  test('Mongo init is single-flight and logs sanitized connection errors', async () => {
    const originalEnv = { ...process.env };
    const mongoModulePath = require.resolve('mongodb');
    const mongoStorePath = require.resolve('../src/data/mongoStore');
    const originalMongoModule = require.cache[mongoModulePath];
    const originalFsWriteSync = fs.writeSync;
    const writes = [];
    let rejectConnect;
    let connectCalls = 0;

    class FakeMongoClient {
      constructor() {}
      connect() {
        connectCalls += 1;
        return new Promise((resolve, reject) => { rejectConnect = reject; });
      }
    }

    try {
      process.env.STORAGE_MODE = 'mongo';
      process.env.MONGO_URL = 'mongodb+srv://actualUser:actualPassword@example.mongodb.net/signature_properties';
      process.env.MONGO_DB = 'signature_properties';

      delete require.cache[mongoStorePath];
      require.cache[mongoModulePath] = { exports: { MongoClient: FakeMongoClient } };
      fs.writeSync = function writeSync(fd, data, position, encoding) {
        if (fd === 2) {
          writes.push(String(data));
          return String(data).length;
        }
        return originalFsWriteSync.call(fs, fd, data, position, encoding);
      };

      const mongoStore = require('../src/data/mongoStore');
      const first = mongoStore.initMongo('/tmp/should-not-be-read.json');
      const second = mongoStore.initMongo('/tmp/should-not-be-read.json');

      assert.equal(mongoStore.stats().initAttempts, 1);
      assert.equal(mongoStore.stats().clientCreations, 1);
      assert.equal(connectCalls, 1);

      const tlsCause = Object.assign(new Error('tls alert for mongodb+srv://actualUser:actualPassword@example.mongodb.net/signature_properties'), {
        code: 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR',
        library: 'SSL routines',
        reason: 'tlsv1 alert internal error'
      });
      const networkCause = Object.assign(new Error('failed for mongodb+srv://actualUser:actualPassword@example.mongodb.net/signature_properties'), {
        name: 'MongoNetworkError',
        cause: tlsCause
      });
      rejectConnect(Object.assign(new Error('failed for mongodb+srv://actualUser:actualPassword@example.mongodb.net/signature_properties'), {
        name: 'MongoServerSelectionError',
        code: 'TLS_ERROR',
        reason: { type: 'ReplicaSetNoPrimary', code: 80 },
        cause: networkCause
      }));

      const results = await Promise.allSettled([first, second]);
      assert.equal(results[0].status, 'rejected');
      assert.equal(results[1].status, 'rejected');

      const stderr = writes.join('');
      assert.match(stderr, /\[mongo\] initialization failed/);
      assert.match(stderr, /MongoServerSelectionError/);
      assert.match(stderr, /TLS_ERROR/);
      assert.match(stderr, /ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR/);
      assert.doesNotMatch(stderr, /actualUser/);
      assert.doesNotMatch(stderr, /actualPassword/);
    } finally {
      fs.writeSync = originalFsWriteSync;
      for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) delete process.env[key];
      }
      Object.assign(process.env, originalEnv);
      delete require.cache[mongoStorePath];
      if (originalMongoModule) {
        require.cache[mongoModulePath] = originalMongoModule;
      } else {
        delete require.cache[mongoModulePath];
      }
    }
  });

  test('instantiates with a repository', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeConfigSvc(repo);
    assert.ok(svc);
  });

  test('throws without a repository', () => {
    const { V2ConfigService } = require('../src/services/v2ConfigService');
    assert.throws(() => new V2ConfigService(null), /requires a repository/);
  });

  test('exposes REQUIRED_MODE, FIELD_TIER, SECTION static constants', () => {
    const { V2ConfigService } = require('../src/services/v2ConfigService');
    assert.ok(V2ConfigService.REQUIRED_MODE.CREATE_CORE);
    assert.ok(V2ConfigService.FIELD_TIER.CORE);
    assert.ok(V2ConfigService.SECTION.BUDGET);
  });
});

// ── Suite 2: seedConfigIfEmpty ─────────────────────────────────────────────────

describe('V2ConfigService: seedConfigIfEmpty', () => {
  test('seeds FieldConfig and QuestionConfig into a fresh DB', () => {
    const repo   = makeRepo(makeTempDb());
    const svc    = makeConfigSvc(repo);
    const result = svc.seedConfigIfEmpty();

    assert.equal(result.seeded, true);
    assert.ok(result.fieldConfigCount > 0, 'FieldConfig should have rows');
    assert.ok(result.questionConfigCount > 0, 'QuestionConfig should have rows');
  });

  test('seed writes rows that persist in DB', () => {
    const dbFile = makeTempDb();
    const repo   = makeRepo(dbFile);
    const svc    = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();

    // Read DB directly
    const db = repo.read();
    assert.ok(Array.isArray(db.V2FieldConfig));
    assert.ok(db.V2FieldConfig.length > 0);
    assert.ok(Array.isArray(db.V2QuestionConfig));
    assert.ok(db.V2QuestionConfig.length > 0);
  });

  test('re-seeding does NOT duplicate records', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();
    const db1  = repo.read();
    const count1 = db1.V2FieldConfig.length;

    // Call again
    const result2 = svc.seedConfigIfEmpty();
    assert.equal(result2.seeded, false, 'second seed should not re-write');
    const db2    = repo.read();
    assert.equal(db2.V2FieldConfig.length, count1, 'count unchanged after second seed');
  });

  test('seeded FieldConfig rows have required schema fields', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();
    const rows = svc.getFieldConfig();

    for (const row of rows) {
      assert.ok(row.FieldConfigID,  `FieldConfigID missing on ${JSON.stringify(row)}`);
      assert.ok(row.FieldKey,       `FieldKey missing on ${row.FieldConfigID}`);
      assert.ok(row.FieldLabel,     `FieldLabel missing on ${row.FieldConfigID}`);
      assert.ok(row.QuestionLabel,  `QuestionLabel missing on ${row.FieldConfigID}`);
      assert.ok(row.FieldType,      `FieldType missing on ${row.FieldConfigID}`);
      assert.ok(row.Section,        `Section missing on ${row.FieldConfigID}`);
      assert.ok(row.Tier,           `Tier missing on ${row.FieldConfigID}`);
      assert.ok(row.RequiredMode,   `RequiredMode missing on ${row.FieldConfigID}`);
      assert.strictEqual(typeof row.DisplayOrder, 'number', `DisplayOrder not a number on ${row.FieldConfigID}`);
      assert.strictEqual(row._v2, true, `_v2 flag missing on ${row.FieldConfigID}`);
    }
  });
});

// ── Suite 3: getFieldConfig — unfiltered ──────────────────────────────────────

describe('V2ConfigService: getFieldConfig unfiltered', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();
  });

  test('returns an array', () => {
    assert.ok(Array.isArray(svc.getFieldConfig()));
  });

  test('returns all config rows (≥ 40 fields seeded)', () => {
    const rows = svc.getFieldConfig();
    assert.ok(rows.length >= 40, `Expected ≥40 FieldConfig rows, got ${rows.length}`);
  });

  test('includes common (null-scoped) fields like BudgetMin', () => {
    const rows = svc.getFieldConfig();
    const budgetMin = rows.find((r) => r.FieldKey === 'BudgetMin' && r.Category === null);
    assert.ok(budgetMin, 'BudgetMin common field should exist');
  });

  test('includes Residential-scoped BHKMin', () => {
    const rows = svc.getFieldConfig();
    const bhkMin = rows.find((r) => r.FieldKey === 'BHKMin' && r.Category === 'Residential');
    assert.ok(bhkMin, 'BHKMin Residential field should exist');
  });

  test('rows are sorted by DisplayOrder', () => {
    const rows = svc.getFieldConfig();
    for (let i = 1; i < rows.length; i++) {
      assert.ok(
        (rows[i].DisplayOrder || 99) >= (rows[i - 1].DisplayOrder || 99),
        `Row ${i} DisplayOrder ${rows[i].DisplayOrder} < Row ${i-1} DisplayOrder ${rows[i-1].DisplayOrder}`
      );
    }
  });
});

// ── Suite 4: getFieldConfig — category filter ──────────────────────────────────

describe('V2ConfigService: getFieldConfig category filter', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();
  });

  test('Residential filter returns BHKMin', () => {
    const rows = svc.getFieldConfig({ category: 'Residential' });
    const bhkMin = rows.find((r) => r.FieldKey === 'BHKMin');
    assert.ok(bhkMin, 'BHKMin should be in Residential context');
  });

  test('Residential filter returns common BudgetMin (null-scoped)', () => {
    const rows = svc.getFieldConfig({ category: 'Residential' });
    const budgetMin = rows.find((r) => r.FieldKey === 'BudgetMin');
    assert.ok(budgetMin, 'BudgetMin should appear in Residential context');
  });

  test('Residential filter does NOT return Industrial ZoneType', () => {
    const rows = svc.getFieldConfig({ category: 'Residential' });
    const zoneType = rows.find((r) => r.FieldKey === 'ZoneType' && r.Category === 'Industrial');
    assert.ok(!zoneType, 'ZoneType (Industrial) should NOT appear in Residential context');
  });

  test('Commercial filter returns BusinessType', () => {
    const rows = svc.getFieldConfig({ category: 'Commercial' });
    const bt = rows.find((r) => r.FieldKey === 'BusinessType');
    assert.ok(bt, 'BusinessType should be in Commercial context');
  });

  test('Commercial filter does NOT return BHKMin', () => {
    const rows = svc.getFieldConfig({ category: 'Commercial' });
    const bhk = rows.find((r) => r.FieldKey === 'BHKMin');
    assert.ok(!bhk, 'BHKMin should NOT appear in Commercial context');
  });

  test('Land filter returns Zoning', () => {
    const rows = svc.getFieldConfig({ category: 'Land' });
    const z = rows.find((r) => r.FieldKey === 'Zoning');
    assert.ok(z, 'Zoning should be in Land context');
  });

  test('Industrial filter returns ZoneType', () => {
    const rows = svc.getFieldConfig({ category: 'Industrial' });
    const zt = rows.find((r) => r.FieldKey === 'ZoneType');
    assert.ok(zt, 'ZoneType should be in Industrial context');
  });
});

// ── Suite 5: getFieldConfig — tier filter ─────────────────────────────────────

describe('V2ConfigService: getFieldConfig tier filter', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();
  });

  test('tier=CORE returns only CORE rows', () => {
    const rows = svc.getFieldConfig({ tier: 'CORE' });
    assert.ok(rows.length > 0, 'CORE rows should exist');
    for (const r of rows) {
      assert.equal(r.Tier, 'CORE', `Expected Tier=CORE but got ${r.Tier} for ${r.FieldKey}`);
    }
  });

  test('tier=IMPORTANT returns only IMPORTANT rows', () => {
    const rows = svc.getFieldConfig({ tier: 'IMPORTANT' });
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.equal(r.Tier, 'IMPORTANT');
    }
  });

  test('tier=OPTIONAL returns only OPTIONAL rows', () => {
    const rows = svc.getFieldConfig({ tier: 'OPTIONAL' });
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.equal(r.Tier, 'OPTIONAL');
    }
  });

  test('CORE rows include BudgetMin, Location1, TransactionType', () => {
    const rows = svc.getFieldConfig({ tier: 'CORE' });
    const keys = rows.map((r) => r.FieldKey);
    assert.ok(keys.includes('BudgetMin'),      'BudgetMin should be CORE');
    assert.ok(keys.includes('Location1'),       'Location1 should be CORE');
    assert.ok(keys.includes('TransactionType'), 'TransactionType should be CORE');
  });
});

// ── Suite 6: resolveFieldsForContext ──────────────────────────────────────────

describe('V2ConfigService: resolveFieldsForContext', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();
  });

  test('Purchase|Residential|Flat includes BHKMin and BudgetMin', () => {
    const fields = svc.resolveFieldsForContext('Purchase', 'Residential', 'Flat');
    const keys   = fields.map((f) => f.FieldKey);
    assert.ok(keys.includes('BHKMin'),    'BHKMin expected for Residential context');
    assert.ok(keys.includes('BudgetMin'), 'BudgetMin expected for all contexts');
  });

  test('Purchase|Residential|Flat does NOT include ZoneType', () => {
    const fields = svc.resolveFieldsForContext('Purchase', 'Residential', 'Flat');
    const keys   = fields.map((f) => f.FieldKey);
    const industrial = fields.filter((f) => f.Category === 'Industrial');
    assert.equal(industrial.length, 0, 'No Industrial-scoped fields in Residential context');
  });

  test('Purchase|Commercial|Office includes BusinessType and BudgetMin', () => {
    const fields = svc.resolveFieldsForContext('Purchase', 'Commercial', 'Office');
    const keys   = fields.map((f) => f.FieldKey);
    assert.ok(keys.includes('BusinessType'), 'BusinessType expected for Commercial');
    assert.ok(keys.includes('BudgetMin'),    'BudgetMin expected always');
  });

  test('Purchase|Land|Residential Plot includes Zoning and PlotAreaMin', () => {
    const fields = svc.resolveFieldsForContext('Purchase', 'Land', 'Residential Plot');
    const keys   = fields.map((f) => f.FieldKey);
    assert.ok(keys.includes('Zoning'),       'Zoning expected for Land');
    assert.ok(keys.includes('PlotAreaMin'),  'PlotAreaMin expected for Land');
  });

  test('returns active fields only', () => {
    const fields = svc.resolveFieldsForContext('Purchase', 'Residential', 'Flat');
    for (const f of fields) {
      assert.notEqual(f.Active, false, `Inactive field ${f.FieldKey} should not be returned`);
    }
  });
});

// ── Suite 7: getFieldConfigById / ByKey ───────────────────────────────────────

describe('V2ConfigService: getFieldConfigById / ByKey', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();
  });

  test('getFieldConfigById returns correct row', () => {
    const row = svc.getFieldConfigById('FC-001');
    assert.ok(row, 'FC-001 should exist');
    assert.equal(row.FieldKey, 'TransactionType');
  });

  test('getFieldConfigById returns null for unknown ID', () => {
    const row = svc.getFieldConfigById('FC-NONEXISTENT');
    assert.equal(row, null);
  });

  test('getFieldConfigByKey returns array', () => {
    const rows = svc.getFieldConfigByKey('BudgetMin');
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length > 0, 'BudgetMin should have at least one row');
  });

  test('getFieldConfigByKey for AreaMin returns multiple rows (one per category)', () => {
    const rows = svc.getFieldConfigByKey('AreaMin');
    // AreaMin exists for Residential, Commercial, Industrial
    assert.ok(rows.length >= 2, `Expected ≥2 AreaMin rows, got ${rows.length}`);
  });
});

// ── Suite 8: getQuestionConfig ─────────────────────────────────────────────────

describe('V2ConfigService: getQuestionConfig', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();
  });

  test('returns an array of questions', () => {
    const rows = svc.getQuestionConfig();
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length > 0);
  });

  test('each question has QuestionLabel and FieldKey', () => {
    const rows = svc.getQuestionConfig();
    for (const q of rows) {
      assert.ok(q.QuestionLabel, `QuestionLabel missing on ${q.QuestionConfigID}`);
      assert.ok(q.FieldKey,      `FieldKey missing on ${q.QuestionConfigID}`);
    }
  });

  test('CORE questions come before IMPORTANT, which come before OPTIONAL', () => {
    const rows = svc.getQuestionConfig();
    const tierRank = { CORE: 1, IMPORTANT: 2, OPTIONAL: 3 };
    for (let i = 1; i < rows.length; i++) {
      const prev = tierRank[rows[i - 1].Priority] || 3;
      const curr = tierRank[rows[i].Priority]     || 3;
      assert.ok(curr >= prev,
        `Question ${rows[i].QuestionConfigID} (${rows[i].Priority}) comes after a higher-priority question (${rows[i-1].Priority})`
      );
    }
  });

  test('priority filter returns only matching rows', () => {
    const core = svc.getQuestionConfig({ priority: 'CORE' });
    assert.ok(core.length > 0);
    for (const q of core) {
      assert.equal(q.Priority, 'CORE');
    }
  });

  test('category filter for Residential includes BHKMin question', () => {
    const rows  = svc.getQuestionConfig({ category: 'Residential' });
    const bhkQ  = rows.find((r) => r.FieldKey === 'BHKMin');
    assert.ok(bhkQ, 'BHKMin question should be in Residential context');
  });

  test('category filter for Commercial excludes BHKMin question', () => {
    const rows = svc.getQuestionConfig({ category: 'Commercial' });
    const bhkQ = rows.find((r) => r.FieldKey === 'BHKMin' && r.Category === 'Residential');
    assert.ok(!bhkQ, 'BHKMin (Residential) question should NOT appear in Commercial context');
  });
});

// ── Suite 9: Static fallback ───────────────────────────────────────────────────

describe('V2ConfigService: static fallback', () => {
  test('getFieldConfig returns static config when DB has no V2FieldConfig', () => {
    // Use repo with empty V2FieldConfig (no seed call)
    const repo = makeRepo(makeTempDb());
    const svc  = makeConfigSvc(repo);

    // Do NOT seed — DB has no V2FieldConfig
    const rows = svc.getFieldConfig();
    assert.ok(rows.length > 0, 'Should return static config as fallback');
  });

  test('getQuestionConfig returns static config when DB has no V2QuestionConfig', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeConfigSvc(repo);

    const rows = svc.getQuestionConfig();
    assert.ok(rows.length > 0, 'Should return static question config as fallback');
  });

  test('STATIC_FIELD_CONFIG has all required schema fields', () => {
    const { STATIC_FIELD_CONFIG } = require('../src/services/v2ConfigService');
    assert.ok(Array.isArray(STATIC_FIELD_CONFIG));
    assert.ok(STATIC_FIELD_CONFIG.length >= 40);
    for (const row of STATIC_FIELD_CONFIG) {
      assert.ok(row.FieldConfigID, `FieldConfigID missing`);
      assert.ok(row.FieldKey);
      assert.ok(row.Tier);
      assert.ok(row.RequiredMode);
    }
  });

  test('All RequiredMode values are valid', () => {
    const { STATIC_FIELD_CONFIG, REQUIRED_MODE } = require('../src/services/v2ConfigService');
    const validModes = new Set(Object.values(REQUIRED_MODE));
    for (const row of STATIC_FIELD_CONFIG) {
      assert.ok(validModes.has(row.RequiredMode),
        `Invalid RequiredMode '${row.RequiredMode}' on ${row.FieldConfigID}`);
    }
  });

  test('All Tier values are valid', () => {
    const { STATIC_FIELD_CONFIG, FIELD_TIER } = require('../src/services/v2ConfigService');
    const validTiers = new Set(Object.values(FIELD_TIER));
    for (const row of STATIC_FIELD_CONFIG) {
      assert.ok(validTiers.has(row.Tier),
        `Invalid Tier '${row.Tier}' on ${row.FieldConfigID}`);
    }
  });
});

// ── Suite 10: V2Router — new API routes ───────────────────────────────────────

describe('V2Router Phase 8 routes', () => {
  let handle;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    handle = makeRouterHandle(repo);
  });

  test('GET /api/v2/config/fields returns 200 with ok:true', async () => {
    const res = await handle('GET', '/api/v2/config/fields');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.count > 0);
  });

  test('GET /api/v2/config/fields?category=Residential returns Residential fields', async () => {
    const res = await handle('GET', '/api/v2/config/fields?category=Residential');
    assert.equal(res.statusCode, 200);
    const keys = res.body.data.map((r) => r.FieldKey);
    assert.ok(keys.includes('BHKMin'), 'BHKMin expected for Residential');
    assert.ok(!res.body.data.some((r) => r.Category === 'Industrial'),
      'Industrial-scoped fields should not appear');
  });

  test('GET /api/v2/config/fields?tier=CORE returns only CORE fields', async () => {
    const res = await handle('GET', '/api/v2/config/fields?tier=CORE');
    assert.equal(res.statusCode, 200);
    for (const r of res.body.data) {
      assert.equal(r.Tier, 'CORE');
    }
  });

  test('GET /api/v2/config/questions returns 200 with ok:true', async () => {
    const res = await handle('GET', '/api/v2/config/questions');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.count > 0);
  });

  test('GET /api/v2/config/questions?category=Commercial returns Commercial questions', async () => {
    const res = await handle('GET', '/api/v2/config/questions?category=Commercial');
    assert.equal(res.statusCode, 200);
    const keys = res.body.data.map((q) => q.FieldKey);
    assert.ok(keys.includes('BusinessType'), 'BusinessType question expected for Commercial');
  });

  test('GET /api/v2/config/scoring returns 200 with ok:true', async () => {
    const res = await handle('GET', '/api/v2/config/scoring');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.data, 'ScoringConfig data should be present');
  });

  test('GET /api/v2/config/workflows returns 200 with ok:true', async () => {
    const res = await handle('GET', '/api/v2/config/workflows');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.data, 'WorkflowConfig data should be present');
  });

  test('GET /api/v2/config still works (unchanged, returns EntityConfig etc.)', async () => {
    const res = await handle('GET', '/api/v2/config');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.data.entityConfig, 'entityConfig should be present');
    assert.ok(res.body.data.workflowConfig, 'workflowConfig should be present');
  });
});

// ── Suite 11: V2ConfigService — combined category+tier filter ─────────────────

describe('V2ConfigService: combined filters', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();
  });

  test('category=Residential, tier=IMPORTANT returns BHKMin but not AreaMin', () => {
    const rows = svc.getFieldConfig({ category: 'Residential', tier: 'IMPORTANT' });
    const keys = rows.map((r) => r.FieldKey);
    assert.ok(keys.includes('BHKMin'),    'BHKMin (IMPORTANT) expected');
    assert.ok(!keys.includes('AreaMin'),  'AreaMin (OPTIONAL for Residential) should not be in IMPORTANT tier');
  });

  test('category=Land, tier=OPTIONAL returns CornerPlot', () => {
    const rows = svc.getFieldConfig({ category: 'Land', tier: 'OPTIONAL' });
    const keys = rows.map((r) => r.FieldKey);
    assert.ok(keys.includes('CornerPlot'), 'CornerPlot (OPTIONAL Land) expected');
  });
});

// ── Suite 12: FieldConfigID uniqueness ────────────────────────────────────────

describe('STATIC_FIELD_CONFIG integrity', () => {
  test('all FieldConfigIDs are unique', () => {
    const { STATIC_FIELD_CONFIG } = require('../src/services/v2ConfigService');
    const ids = STATIC_FIELD_CONFIG.map((r) => r.FieldConfigID);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, 'Duplicate FieldConfigIDs detected');
  });

  test('no null FieldKey exists', () => {
    const { STATIC_FIELD_CONFIG } = require('../src/services/v2ConfigService');
    for (const row of STATIC_FIELD_CONFIG) {
      assert.ok(row.FieldKey, `FieldKey is falsy on ${row.FieldConfigID}`);
    }
  });

  test('Tier is one of CORE | IMPORTANT | OPTIONAL on all rows', () => {
    const { STATIC_FIELD_CONFIG } = require('../src/services/v2ConfigService');
    const valid = new Set(['CORE', 'IMPORTANT', 'OPTIONAL']);
    for (const row of STATIC_FIELD_CONFIG) {
      assert.ok(valid.has(row.Tier), `Bad Tier ${row.Tier} on ${row.FieldConfigID}`);
    }
  });
});
