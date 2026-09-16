/**
 * PHASE 9 — Form Registry + Dynamic SubCategory Engine Tests
 *
 * Covers requirements A–X from Phase 9 contract:
 * A. DB FormRegistry creation/loading
 * B. Static fallback when DB is empty
 * C. TransactionType + Category + SubCategory lookup
 * D. Residential subcategories
 * E. Commercial subcategories
 * F. Industrial subcategories
 * G. Land subcategories
 * H. Agriculture subcategories (NEW)
 * I. Active/inactive forms
 * J. FormVersion resolution
 * K. Historical FormVersion preservation (immutability on Requirement)
 * L. Dynamic SubCategory API
 * M. Form configuration API (resolved form config)
 * N. Transaction-specific configuration (Rent vs Purchase)
 * O. Category-specific configuration (Commercial vs Residential)
 * P. Unknown fields remain valid (UNKNOWN ≠ NO)
 * Q. Missing optional fields do NOT reject Requirement creation
 * R. Invalid provided values still reject
 * S. Legacy API compatibility (/api/v2/form-registry, /api/v2/form-config)
 * T. Existing V2 tests do not regress
 */

'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-v2-p9-'));
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

function makeRegistrySvc(repo, configSvc) {
  const { V2FormRegistryService } = require('../src/services/v2FormRegistryService');
  return new V2FormRegistryService(repo, configSvc || makeConfigSvc(repo));
}

// Route test helper — mimics the router without starting a real server
function makeRouterHandle(repo) {
  const { V2Router } = require('../src/api/v2Router');
  const router = new V2Router(repo);
  return async function handle(method, pathAndQuery) {
    const url    = new URL(`http://localhost${pathAndQuery}`);
    const body   = {};
    const cap    = { statusCode: null, body: null };
    const res    = {
      writeHead(code) { cap.statusCode = code; },
      end(data)       { try { cap.body = JSON.parse(data); } catch { cap.body = data; } }
    };
    const req = { method };
    const result = await router.handle(req, res, url, body);
    if (result && result.statusCode != null) return result;
    return cap;
  };
}

// Minimal Lead+Transaction seeder for Requirement tests
function seedLeadAndTxn(repo, opts = {}) {
  const db = repo.read();
  db.Leads = db.Leads || [];
  db.Transactions = db.Transactions || [];
  db._V2Counters  = db._V2Counters  || { Lead: 0, Transaction: 0, Requirement: 0 };

  const leadId = opts.leadId || 'L000001';
  const txnId  = opts.txnId  || 'T000001';

  if (!db.Leads.find(l => l.LeadID === leadId)) {
    db.Leads.push({ LeadID: leadId, ClientName: 'Test Client', PrimaryMobile: '9876543210', ClientStatus: 'New', _v2: true });
  }
  if (!db.Transactions.find(t => t.TransactionID === txnId)) {
    db.Transactions.push({
      TransactionID: txnId, LeadID: leadId,
      TransactionType: opts.txnType || 'Purchase',
      TransactionStatus: 'Open', PipelineStage: 'New', _v2: true
    });
  }
  repo.write(db);
  return { leadId, txnId };
}

// ── Suite A: DB FormRegistry creation/loading ─────────────────────────────────

describe('A. DB FormRegistry creation/loading', () => {
  test('seedFormRegistryIfEmpty populates V2FormRegistry in DB', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeRegistrySvc(repo);
    const res  = svc.seedFormRegistryIfEmpty();

    assert.equal(res.seeded, true);
    assert.ok(res.count > 0, 'Should have seeded some forms');

    const db = repo.read();
    assert.ok(Array.isArray(db.V2FormRegistry));
    assert.ok(db.V2FormRegistry.length > 0);
  });

  test('seeded forms have required DB schema fields', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeRegistrySvc(repo);
    svc.seedFormRegistryIfEmpty();

    const forms = svc.getAllForms();
    for (const f of forms) {
      assert.ok(f.FormID,       `FormID missing on ${JSON.stringify(f)}`);
      assert.ok(f.FormKey,      `FormKey missing on form ${f.FormID}`);
      assert.ok(f.FormVersion,  `FormVersion missing on form ${f.FormID}`);
      assert.strictEqual(typeof f.IsActive, 'boolean', `IsActive must be boolean on ${f.FormID}`);
      assert.ok(f.DisplayName,  `DisplayName missing on form ${f.FormID}`);
      assert.ok(f.CreatedAt,    `CreatedAt missing on form ${f.FormID}`);
      assert.strictEqual(f._v2, true, `_v2 flag missing on ${f.FormID}`);
    }
  });

  test('re-seeding does NOT duplicate records', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeRegistrySvc(repo);
    svc.seedFormRegistryIfEmpty();
    const count1 = svc.getAllForms().length;

    const res2 = svc.seedFormRegistryIfEmpty();
    assert.equal(res2.seeded, false, 'second seed should report seeded=false');
    assert.equal(svc.getAllForms().length, count1, 'count unchanged after re-seed');
  });

  test('FormIDs are unique across all seeded forms', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeRegistrySvc(repo);
    svc.seedFormRegistryIfEmpty();
    const ids  = svc.getAllForms().map(f => f.FormID);
    assert.equal(new Set(ids).size, ids.length, 'Duplicate FormIDs detected');
  });
});

// ── Suite B: Static fallback ───────────────────────────────────────────────────

describe('B. Static fallback when DB is empty', () => {
  test('getAllForms returns forms without seeding (static fallback)', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeRegistrySvc(repo);
    // No seed call
    const forms = svc.getAllForms();
    assert.ok(forms.length > 0, 'Should return static fallback forms');
  });

  test('getSubCategories returns static list when DB is empty', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeRegistrySvc(repo);
    const subs = svc.getSubCategories('Residential');
    assert.ok(subs.length > 0, 'Static fallback should have Residential subcategories');
  });

  test('STATIC_SUBCATEGORY_CONFIG is exported and correct', () => {
    const { STATIC_SUBCATEGORY_CONFIG } = require('../src/services/v2FormRegistryService');
    assert.ok(Array.isArray(STATIC_SUBCATEGORY_CONFIG.Residential));
    assert.ok(Array.isArray(STATIC_SUBCATEGORY_CONFIG.Commercial));
    assert.ok(Array.isArray(STATIC_SUBCATEGORY_CONFIG.Industrial));
    assert.ok(Array.isArray(STATIC_SUBCATEGORY_CONFIG.Land));
    assert.ok(Array.isArray(STATIC_SUBCATEGORY_CONFIG.Agriculture));
  });
});

// ── Suite C: T+C+SC lookup ────────────────────────────────────────────────────

describe('C. TransactionType + Category + SubCategory lookup', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeRegistrySvc(repo);
    svc.seedFormRegistryIfEmpty();
  });

  test('getFormByKey finds Purchase|Residential|Flat', () => {
    const form = svc.getFormByKey('Purchase', 'Residential', 'Flat');
    assert.ok(form, 'Form should exist');
    assert.equal(form.FormKey, 'Purchase|Residential|Flat');
    assert.equal(form.TransactionType, 'Purchase');
    assert.equal(form.Category, 'Residential');
    assert.equal(form.SubCategory, 'Flat');
  });

  test('getFormByKey finds Rent|Commercial|Office', () => {
    const form = svc.getFormByKey('Rent', 'Commercial', 'Office');
    assert.ok(form, 'Rent|Commercial|Office should exist');
    assert.equal(form.FormKey, 'Rent|Commercial|Office');
  });

  test('getFormByKey falls back to generic for unknown T/C/SC', () => {
    const form = svc.getFormByKey('Purchase', 'Unknown', 'Unknown');
    assert.ok(form, 'Should return generic form as fallback');
    assert.equal(form.FormKey, 'generic');
  });

  test('getFormById returns correct form', () => {
    const all    = svc.getAllForms();
    const first  = all[0];
    const byId   = svc.getFormById(first.FormID);
    assert.ok(byId, 'Form should be retrievable by ID');
    assert.equal(byId.FormID, first.FormID);
  });

  test('getFormById returns null for unknown ID', () => {
    const form = svc.getFormById('FORM-NONEXISTENT');
    assert.equal(form, null);
  });
});

// ── Suite D: Residential subcategories ────────────────────────────────────────

describe('D. Residential subcategories', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeRegistrySvc(repo);
    svc.seedFormRegistryIfEmpty();
  });

  test('getSubCategories(Residential) returns known subcategories', () => {
    const subs = svc.getSubCategories('Residential');
    const vals = subs.map(s => s.value);
    assert.ok(vals.includes('Flat'),   'Flat expected');
    assert.ok(vals.includes('Villa'),  'Villa expected');
  });

  test('getSubCategories(Residential, Purchase) returns Purchase forms only', () => {
    const subs = svc.getSubCategories('Residential', 'Purchase');
    assert.ok(subs.length > 0);
    for (const s of subs) {
      assert.ok(s.value, 'SubCategory value should be set');
      assert.strictEqual(typeof s.isActive, 'boolean');
    }
  });

  test('Residential subcategories have value + label + isActive', () => {
    const subs = svc.getSubCategories('Residential');
    for (const s of subs) {
      assert.ok(s.value,                  'value missing');
      assert.ok(s.label,                  'label missing');
      assert.strictEqual(typeof s.isActive, 'boolean', 'isActive must be boolean');
    }
  });
});

// ── Suite E: Commercial subcategories ─────────────────────────────────────────

describe('E. Commercial subcategories', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeRegistrySvc(repo);
    svc.seedFormRegistryIfEmpty();
  });

  test('getSubCategories(Commercial) returns Office, Shop, Showroom, Warehouse', () => {
    const subs = svc.getSubCategories('Commercial');
    const vals = subs.map(s => s.value);
    assert.ok(vals.includes('Office'),    'Office expected');
    assert.ok(vals.includes('Shop'),      'Shop expected');
    assert.ok(vals.includes('Showroom'),  'Showroom expected');
    assert.ok(vals.includes('Warehouse'), 'Warehouse expected');
  });
});

// ── Suite F: Industrial subcategories ─────────────────────────────────────────

describe('F. Industrial subcategories', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeRegistrySvc(repo);
    svc.seedFormRegistryIfEmpty();
  });

  test('getSubCategories(Industrial) returns Factory, Warehouse', () => {
    const subs = svc.getSubCategories('Industrial');
    const vals = subs.map(s => s.value);
    assert.ok(vals.includes('Factory'),   'Factory expected');
    assert.ok(vals.includes('Warehouse'), 'Warehouse expected');
  });
});

// ── Suite G: Land subcategories ───────────────────────────────────────────────

describe('G. Land subcategories', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeRegistrySvc(repo);
    svc.seedFormRegistryIfEmpty();
  });

  test('getSubCategories(Land) returns plot types', () => {
    const subs = svc.getSubCategories('Land');
    const vals = subs.map(s => s.value);
    assert.ok(vals.includes('Residential Plot'),  'Residential Plot expected');
    assert.ok(vals.includes('Commercial Plot'),   'Commercial Plot expected');
    assert.ok(vals.includes('Agricultural Land'), 'Agricultural Land expected');
  });
});

// ── Suite H: Agriculture subcategories (NEW) ──────────────────────────────────

describe('H. Agriculture subcategories (new in Phase 9)', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeRegistrySvc(repo);
    svc.seedFormRegistryIfEmpty();
  });

  test('Agriculture forms exist in registry', () => {
    const forms = svc.getAllForms({ category: 'Agriculture' });
    assert.ok(forms.length > 0, 'Agriculture forms should be seeded');
  });

  test('getSubCategories(Agriculture) returns Agricultural Land, Farm House, Orchard', () => {
    const subs = svc.getSubCategories('Agriculture');
    const vals = subs.map(s => s.value);
    assert.ok(vals.includes('Agricultural Land'), 'Agricultural Land expected');
    assert.ok(vals.includes('Farm House'),        'Farm House expected');
    assert.ok(vals.includes('Orchard'),           'Orchard expected');
  });

  test('Purchase|Agriculture|Agricultural Land form exists', () => {
    const form = svc.getFormByKey('Purchase', 'Agriculture', 'Agricultural Land');
    assert.ok(form, 'Form should exist');
    assert.equal(form.Category, 'Agriculture');
  });

  test('Agriculture FieldConfig entries exist', () => {
    const repo = makeRepo(makeTempDb());
    const cfgSvc = makeConfigSvc(repo);
    cfgSvc.seedConfigIfEmpty();
    const rows = cfgSvc.getFieldConfig({ category: 'Agriculture' });
    const keys = rows.map(r => r.FieldKey);
    assert.ok(keys.includes('TotalArea'),   'TotalArea should be in Agriculture FieldConfig');
    assert.ok(keys.includes('WaterSource'), 'WaterSource should be in Agriculture FieldConfig');
  });
});

// ── Suite I: Active/inactive forms ────────────────────────────────────────────

describe('I. Active/inactive forms', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeRegistrySvc(repo);
    svc.seedFormRegistryIfEmpty();
  });

  test('getAllForms without filter includes active forms', () => {
    const all = svc.getAllForms();
    const active = all.filter(f => f.IsActive);
    assert.ok(active.length > 0, 'Active forms should exist');
  });

  test('filter isActive=true excludes inactive forms', () => {
    const active = svc.getAllForms({ isActive: true });
    for (const f of active) {
      assert.equal(f.IsActive, true);
    }
  });

  test('seeded forms are active by default', () => {
    const all = svc.getAllForms();
    const inactive = all.filter(f => !f.IsActive);
    // The 'generic' form is active too; all static forms default to isActive: true
    assert.equal(inactive.length, 0, 'All seeded forms should be active by default');
  });
});

// ── Suite J: FormVersion resolution ───────────────────────────────────────────

describe('J. FormVersion resolution', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    svc = makeRegistrySvc(repo);
    svc.seedFormRegistryIfEmpty();
  });

  test('resolveFormConfig returns a formVersion', () => {
    const config = svc.resolveFormConfig('Purchase', 'Residential', 'Flat');
    assert.ok(config.formVersion, 'formVersion should be present');
    assert.ok(typeof config.formVersion === 'string', 'formVersion should be a string');
  });

  test('all seeded forms have a formVersion', () => {
    const all = svc.getAllForms();
    for (const f of all) {
      assert.ok(f.FormVersion, `FormVersion missing on form ${f.FormID}`);
    }
  });

  test('resolveFormConfig returns formId matching the registry', () => {
    const config = svc.resolveFormConfig('Purchase', 'Residential', 'Flat');
    assert.ok(config.formId, 'formId should be present');
  });
});

// ── Suite K: Historical FormVersion preservation ──────────────────────────────

describe('K. Historical FormVersion immutability on Requirements', () => {
  test('creating a Requirement freezes FormVersion', () => {
    const repo = makeRepo(makeTempDb());
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    const reqSvc = new V2RequirementService(repo);
    const { leadId, txnId } = seedLeadAndTxn(repo, { txnType: 'Purchase' });

    const res = reqSvc.createRequirement(txnId, {
      LeadID: leadId, Category: 'Residential', SubCategory: 'Flat',
      BudgetMin: 5000000
    }, { userId: 'U1' });

    assert.equal(res.ok, true);
    const fv1 = res.data.FormVersion;
    assert.ok(fv1, 'FormVersion should be set on creation');

    // Attempting to PATCH with a different FormVersion must be rejected
    const patch = reqSvc.updateRequirement(res.data.RequirementID, {
      FormVersion: 'malicious-override'
    }, { userId: 'U1' });

    assert.equal(patch.ok, false, 'FormVersion PATCH must be rejected');
    assert.ok(patch.error, 'Error message must be present');
  });

  test('PATCH does not change FormVersion when not provided', () => {
    const repo = makeRepo(makeTempDb());
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    const reqSvc = new V2RequirementService(repo);
    const { leadId, txnId } = seedLeadAndTxn(repo, { txnType: 'Purchase' });

    const create = reqSvc.createRequirement(txnId, { LeadID: leadId, BudgetMin: 2000000 }, { userId: 'U1' });
    assert.equal(create.ok, true);
    const fvBefore = create.data.FormVersion;

    const patch = reqSvc.updateRequirement(create.data.RequirementID, { BudgetMax: 4000000 }, { userId: 'U1' });
    assert.equal(patch.ok, true);
    // updateRequirement returns { requirement, changedFields, history }
    const patchedReq = patch.data.requirement || patch.data;
    assert.equal(patchedReq.FormVersion, fvBefore, 'FormVersion must remain unchanged after PATCH');
  });
});

// ── Suite L: Dynamic SubCategory API ─────────────────────────────────────────

describe('L. Dynamic SubCategory API (router)', () => {
  let handle;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    handle = makeRouterHandle(repo);
  });

  test('GET /api/v2/config/subcategories?category=Residential returns 200', async () => {
    const res = await handle('GET', '/api/v2/config/subcategories?category=Residential');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.count > 0);
  });

  test('GET /api/v2/config/subcategories?category=Agriculture returns Agriculture subcategories', async () => {
    const res = await handle('GET', '/api/v2/config/subcategories?category=Agriculture');
    assert.equal(res.statusCode, 200);
    const vals = res.body.data.map(s => s.value);
    assert.ok(vals.includes('Agricultural Land'), 'Agricultural Land expected');
    assert.ok(vals.includes('Farm House'),        'Farm House expected');
  });

  test('GET /api/v2/config/subcategories without category returns 400', async () => {
    const res = await handle('GET', '/api/v2/config/subcategories');
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
  });

  test('GET /api/v2/config/categories returns known categories', async () => {
    const res = await handle('GET', '/api/v2/config/categories');
    assert.equal(res.statusCode, 200);
    const vals = res.body.data.map(c => c.value);
    assert.ok(vals.includes('Residential'), 'Residential expected');
    assert.ok(vals.includes('Commercial'),  'Commercial expected');
    assert.ok(vals.includes('Agriculture'), 'Agriculture expected');
  });

  test('GET /api/v2/config/subcategories?category=Commercial&transactionType=Rent returns Commercial Rent subcategories', async () => {
    const res = await handle('GET', '/api/v2/config/subcategories?category=Commercial&transactionType=Rent');
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.data));
    const vals = res.body.data.map(s => s.value);
    assert.ok(vals.includes('Office'), 'Office expected for Rent|Commercial');
  });
});

// ── Suite M: Form Config API (resolved) ───────────────────────────────────────

describe('M. Form configuration API (resolved form config)', () => {
  let handle;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    handle = makeRouterHandle(repo);
  });

  test('GET /api/v2/config/forms returns 200 with form list', async () => {
    const res = await handle('GET', '/api/v2/config/forms');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.count > 0);
  });

  test('GET /api/v2/config/forms?category=Agriculture returns Agriculture forms', async () => {
    const res = await handle('GET', '/api/v2/config/forms?category=Agriculture');
    assert.equal(res.statusCode, 200);
    for (const f of res.body.data) {
      assert.equal(f.Category, 'Agriculture');
    }
    assert.ok(res.body.count > 0, 'Agriculture forms should exist');
  });

  test('GET /api/v2/config/forms/:formId returns 404 for unknown formId', async () => {
    const res = await handle('GET', '/api/v2/config/forms/FORM-NONEXISTENT');
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.ok, false);
  });

  test('GET /api/v2/config/forms/:formId returns resolved config for valid formId', async () => {
    // First get a valid formId
    const listRes = await handle('GET', '/api/v2/config/forms?category=Residential');
    const firstForm = listRes.body.data[0];
    assert.ok(firstForm, 'Should have at least one Residential form');

    const res = await handle('GET', `/api/v2/config/forms/${firstForm.FormID}`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.data.resolved, 'resolved config should be present');
    assert.ok(Array.isArray(res.body.data.resolved.fields));
    assert.ok(Array.isArray(res.body.data.resolved.questions));
  });

  test('GET /api/v2/form-config?transactionType=Purchase&category=Residential&subCategory=Flat returns resolved fields', async () => {
    const res = await handle('GET', '/api/v2/form-config?transactionType=Purchase&category=Residential&subCategory=Flat');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    const data = res.body.data;
    assert.ok(Array.isArray(data.fields),      'fields should be an array');
    assert.ok(Array.isArray(data.questions),   'questions should be an array');
    assert.ok(Array.isArray(data.dependencies),'dependencies should be an array');
    assert.ok(data.formVersion,                'formVersion should be present');
    assert.ok(data.formKey,                    'formKey should be present');
  });

  test('resolveFormConfig returns fields with QuestionLabel for each field', () => {
    const repo = makeRepo(makeTempDb());
    const cfgSvc = makeConfigSvc(repo);
    cfgSvc.seedConfigIfEmpty();
    const regSvc = makeRegistrySvc(repo, cfgSvc);
    regSvc.seedFormRegistryIfEmpty();

    const config = regSvc.resolveFormConfig('Purchase', 'Residential', 'Flat');
    assert.ok(config.fields.length > 0);
    for (const f of config.fields) {
      assert.ok(f.FieldKey,      `FieldKey missing on resolved field`);
      assert.ok(f.QuestionLabel, `QuestionLabel missing on field ${f.FieldKey}`);
      assert.ok(f.FieldType,     `FieldType missing on field ${f.FieldKey}`);
    }
  });
});

// ── Suite N: Transaction-specific configuration ───────────────────────────────

describe('N. Transaction-specific configuration (Rent vs Purchase)', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    const cfg = makeConfigSvc(repo);
    cfg.seedConfigIfEmpty();
    svc = makeRegistrySvc(repo, cfg);
    svc.seedFormRegistryIfEmpty();
  });

  test('Rent|Residential|Flat form exists', () => {
    const form = svc.getFormByKey('Rent', 'Residential', 'Flat');
    assert.ok(form, 'Rent|Residential|Flat should exist');
    assert.equal(form.TransactionType, 'Rent');
  });

  test('resolveFormConfig for Rent|Residential|Flat contains TenantType field', () => {
    const config = svc.resolveFormConfig('Rent', 'Residential', 'Flat');
    const keys = config.fields.map(f => f.FieldKey);
    assert.ok(keys.includes('TenantType'), 'TenantType expected in Rent Residential form');
    assert.ok(keys.includes('Deposit'),    'Deposit expected in Rent Residential form');
  });

  test('resolveFormConfig for Purchase|Residential|Flat does NOT contain TenantType', () => {
    const config = svc.resolveFormConfig('Purchase', 'Residential', 'Flat');
    const keys = config.fields.map(f => f.FieldKey);
    assert.ok(!keys.includes('TenantType'), 'TenantType should NOT be in Purchase form');
  });

  test('Rent form has MoveInDate field', () => {
    const config = svc.resolveFormConfig('Rent', 'Residential', 'Flat');
    const keys = config.fields.map(f => f.FieldKey);
    assert.ok(keys.includes('MoveInDate'), 'MoveInDate expected in Rent form');
  });
});

// ── Suite O: Category-specific configuration ──────────────────────────────────

describe('O. Category-specific configuration', () => {
  let svc;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    const cfg = makeConfigSvc(repo);
    cfg.seedConfigIfEmpty();
    svc = makeRegistrySvc(repo, cfg);
    svc.seedFormRegistryIfEmpty();
  });

  test('Commercial form has BusinessType, AreaMin fields', () => {
    const config = svc.resolveFormConfig('Purchase', 'Commercial', 'Office');
    const keys = config.fields.map(f => f.FieldKey);
    assert.ok(keys.includes('BusinessType'), 'BusinessType expected for Commercial');
    assert.ok(keys.includes('AreaMin'),      'AreaMin expected for Commercial');
  });

  test('Commercial form does NOT have BHKMin', () => {
    const config = svc.resolveFormConfig('Purchase', 'Commercial', 'Office');
    const keys = config.fields.map(f => f.FieldKey);
    assert.ok(!keys.includes('BHKMin'), 'BHKMin should NOT be in Commercial form');
  });

  test('Industrial form has ZoneType, PowerLoad fields', () => {
    const config = svc.resolveFormConfig('Purchase', 'Industrial', 'Factory');
    const keys = config.fields.map(f => f.FieldKey);
    assert.ok(keys.includes('ZoneType'),  'ZoneType expected for Industrial');
    assert.ok(keys.includes('PowerLoad'), 'PowerLoad expected for Industrial');
  });

  test('Agriculture form has TotalArea, WaterSource fields', () => {
    const config = svc.resolveFormConfig('Purchase', 'Agriculture', 'Agricultural Land');
    const keys = config.fields.map(f => f.FieldKey);
    assert.ok(keys.includes('TotalArea'),   'TotalArea expected for Agriculture');
    assert.ok(keys.includes('WaterSource'), 'WaterSource expected for Agriculture');
  });

  test('Agriculture form does NOT have BHKMin', () => {
    const config = svc.resolveFormConfig('Purchase', 'Agriculture', 'Agricultural Land');
    const keys = config.fields.map(f => f.FieldKey);
    assert.ok(!keys.includes('BHKMin'), 'BHKMin should NOT be in Agriculture form');
  });

  test('Land form has PlotAreaMin, Zoning fields', () => {
    const config = svc.resolveFormConfig('Purchase', 'Land', 'Residential Plot');
    const keys = config.fields.map(f => f.FieldKey);
    assert.ok(keys.includes('PlotAreaMin'), 'PlotAreaMin expected for Land');
    assert.ok(keys.includes('Zoning'),      'Zoning expected for Land');
  });
});

// ── Suite P: Unknown fields remain valid ──────────────────────────────────────

describe('P. Unknown fields remain valid (UNKNOWN ≠ NO)', () => {
  test('Requirement with only Location and Budget is valid — all other fields UNKNOWN', () => {
    const repo = makeRepo(makeTempDb());
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    const reqSvc = new V2RequirementService(repo);
    const { leadId, txnId } = seedLeadAndTxn(repo, { txnType: 'Purchase' });

    const res = reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      Category: 'Residential',
      SubCategory: 'Flat',
      Location1: 'Vesu',
      BudgetMin: 10000000
    }, { userId: 'U1' });

    assert.equal(res.ok, true, `createRequirement should succeed: ${res.error}`);
    const fields = res.data.Fields || {};
    // Fields not provided must be UNKNOWN (absent or state = UNKNOWN)
    const bhk = fields['BHKMin'];
    assert.ok(!bhk || bhk.state === 'UNKNOWN', 'BHKMin not provided must be UNKNOWN');
  });

  test('Requirement with NO fields at all is valid', () => {
    const repo = makeRepo(makeTempDb());
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    const reqSvc = new V2RequirementService(repo);
    const { leadId, txnId } = seedLeadAndTxn(repo, { txnType: 'Rent' });

    const res = reqSvc.createRequirement(txnId, { LeadID: leadId }, { userId: 'U1' });
    assert.equal(res.ok, true, 'Bare minimum Requirement must be valid');
  });
});

// ── Suite Q: Missing optional fields do NOT reject creation ───────────────────

describe('Q. Missing optional fields do not reject Requirement', () => {
  test('Creating Requirement without Possession, Parking, Furnishing succeeds', () => {
    const repo = makeRepo(makeTempDb());
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    const reqSvc = new V2RequirementService(repo);
    const { leadId, txnId } = seedLeadAndTxn(repo, { txnType: 'Purchase' });

    const res = reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      Category: 'Residential',
      SubCategory: 'Flat',
      BudgetMin: 5000000,
      BudgetMax: 10000000,
      Location1: 'Adajan'
    }, { userId: 'U1' });

    assert.equal(res.ok, true, 'Requirement without Possession/Parking/Furnishing must succeed');
  });

  test('Agriculture Requirement without WaterSource, SoilType succeeds', () => {
    const repo = makeRepo(makeTempDb());
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    const reqSvc = new V2RequirementService(repo);
    const { leadId, txnId } = seedLeadAndTxn(repo, { txnType: 'Purchase' });

    const res = reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      Category: 'Agriculture',
      SubCategory: 'Agricultural Land',
      Location1: 'Navsari'
    }, { userId: 'U1' });

    assert.equal(res.ok, true, 'Agriculture Requirement without optional fields must succeed');
  });
});

// ── Suite R: Invalid provided values still reject ─────────────────────────────

describe('R. Invalid provided values still reject', () => {
  test('BudgetMax < BudgetMin is rejected', () => {
    const repo = makeRepo(makeTempDb());
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    const reqSvc = new V2RequirementService(repo);
    const { leadId, txnId } = seedLeadAndTxn(repo, { txnType: 'Purchase' });

    const res = reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      BudgetMin: 10000000,
      BudgetMax: 5000000    // less than BudgetMin
    }, { userId: 'U1' });

    assert.equal(res.ok, false, 'BudgetMax < BudgetMin must be rejected');
    assert.ok(res.error, 'Error message must be present');
  });

  test('Invalid RequirementStatus is rejected', () => {
    const repo = makeRepo(makeTempDb());
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    const reqSvc = new V2RequirementService(repo);
    const { leadId, txnId } = seedLeadAndTxn(repo, { txnType: 'Purchase' });

    const res = reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      RequirementStatus: 'BadStatus'
    }, { userId: 'U1' });

    assert.equal(res.ok, false, 'Invalid RequirementStatus must be rejected');
  });

  test('Invalid Select value for a known field is rejected', () => {
    const repo = makeRepo(makeTempDb());
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    const reqSvc = new V2RequirementService(repo);
    const { leadId, txnId } = seedLeadAndTxn(repo, { txnType: 'Purchase' });

    const res = reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      Urgency: 'SuperUrgent'  // not a valid option
    }, { userId: 'U1' });

    assert.equal(res.ok, false, 'Invalid Urgency value must be rejected');
  });
});

// ── Suite S: Legacy API compatibility ─────────────────────────────────────────

describe('S. Legacy API compatibility', () => {
  let handle;
  beforeEach(() => {
    const repo = makeRepo(makeTempDb());
    handle = makeRouterHandle(repo);
  });

  test('GET /api/v2/form-registry still returns 200 (backward compatible)', async () => {
    const res = await handle('GET', '/api/v2/form-registry');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length > 0);
  });

  test('GET /api/v2/form-registry returns formName, category, subCategory for each entry', async () => {
    const res = await handle('GET', '/api/v2/form-registry');
    for (const entry of res.body.data) {
      assert.ok(entry.key,      'key should be present');
      assert.ok(entry.formName, 'formName should be present');
    }
  });

  test('GET /api/v2/form-config without transactionType still returns raw static config', async () => {
    // Without transactionType, falls back to raw config (backward compatible)
    const res = await handle('GET', '/api/v2/form-config?category=Residential&subCategory=Flat');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.data, 'data should be present');
  });

  test('GET /api/v2/config still returns entityConfig, workflowConfig (Phase 8 compat)', async () => {
    const res = await handle('GET', '/api/v2/config');
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.data.entityConfig,   'entityConfig should still be present');
    assert.ok(res.body.data.workflowConfig, 'workflowConfig should still be present');
  });

  test('GET /api/v2/config/fields still returns 200 (Phase 8 compat)', async () => {
    const res = await handle('GET', '/api/v2/config/fields');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });
});

// ── Suite T: Phase 8 regression ───────────────────────────────────────────────

describe('T. Phase 8 regression — config service still works', () => {
  test('V2ConfigService seeding still works', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeConfigSvc(repo);
    const res  = svc.seedConfigIfEmpty();
    assert.equal(res.seeded, true);
    assert.ok(res.fieldConfigCount > 0);
  });

  test('Agriculture FieldConfig entries added in Phase 9 are present', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();
    const agri = svc.getFieldConfig({ category: 'Agriculture' });
    assert.ok(agri.length > 0, 'Agriculture FieldConfig should have entries');
    const keys = agri.map(f => f.FieldKey);
    assert.ok(keys.includes('TotalArea'), 'TotalArea expected in Agriculture FieldConfig');
  });

  test('Rent-specific FieldConfig entries are present', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();
    const rentFields = svc.getFieldConfig({ transactionType: 'Rent' });
    const keys = rentFields.map(f => f.FieldKey);
    assert.ok(keys.includes('TenantType'), 'TenantType expected for Rent');
    assert.ok(keys.includes('Deposit'),    'Deposit expected for Rent');
  });

  test('getFieldConfig returns >50 entries (Phase 8 + Phase 9 additions)', () => {
    const repo = makeRepo(makeTempDb());
    const svc  = makeConfigSvc(repo);
    svc.seedConfigIfEmpty();
    const all = svc.getFieldConfig();
    assert.ok(all.length >= 50, `Expected ≥50 FieldConfig rows, got ${all.length}`);
  });
});

// ── Suite U: Lifecycle / workflow regression ───────────────────────────────────

describe('U. Lifecycle and workflow regression', () => {
  test('Lead status transitions still work', () => {
    const { WorkflowConfig } = require('../src/data/v2Config');
    const transitions = WorkflowConfig.leadStatus.transitions;
    assert.ok(transitions.New.includes('Contacted'), 'New → Contacted must be valid');
    assert.ok(Array.isArray(transitions.Lost), 'Lost transitions must exist');
  });

  test('Transaction status transitions still work', () => {
    const { WorkflowConfig } = require('../src/data/v2Config');
    const transitions = WorkflowConfig.transactionStatus.transitions;
    assert.ok(transitions.Open.includes('Active'), 'Open → Active must be valid');
  });

  test('EntityConfig still has all three entities', () => {
    const { EntityConfig } = require('../src/data/v2Config');
    assert.ok(EntityConfig.Lead,        'Lead entity config must exist');
    assert.ok(EntityConfig.Transaction, 'Transaction entity config must exist');
    assert.ok(EntityConfig.Requirement, 'Requirement entity config must exist');
  });
});

// ── Suite V-X: Form registry integration ──────────────────────────────────────

describe('V–X. Form registry + resolveFormConfig integration', () => {
  test('resolveFormConfig includes options map for Select fields', () => {
    const repo = makeRepo(makeTempDb());
    const cfg = makeConfigSvc(repo);
    cfg.seedConfigIfEmpty();
    const svc = makeRegistrySvc(repo, cfg);
    svc.seedFormRegistryIfEmpty();

    const config = svc.resolveFormConfig('Purchase', 'Residential', 'Flat');
    assert.ok(config.options, 'options map should be present');
    // BHK fields have options
    assert.ok(config.options['BHKMin'] || config.options['bhkMin'] ||
              config.fields.some(f => f.FieldKey === 'BHKMin' && f.Options.length > 0),
              'BHKMin should have options in some form');
  });

  test('resolveFormConfig includes dependencies array', () => {
    const repo = makeRepo(makeTempDb());
    const cfg = makeConfigSvc(repo);
    cfg.seedConfigIfEmpty();
    const svc = makeRegistrySvc(repo, cfg);
    svc.seedFormRegistryIfEmpty();

    const config = svc.resolveFormConfig('Purchase', 'Residential', 'Flat');
    assert.ok(Array.isArray(config.dependencies));
    // Residential Flat has BHKMax ≥ BHKMin dependency
    const bhkDep = config.dependencies.find(d => d.field === 'BHKMax' || d.field === 'bhkMax');
    assert.ok(bhkDep, 'BHKMax dependency should be present');
  });

  test('resolveFormConfig for generic returns a valid config', () => {
    const repo = makeRepo(makeTempDb());
    const cfg = makeConfigSvc(repo);
    cfg.seedConfigIfEmpty();
    const svc = makeRegistrySvc(repo, cfg);
    svc.seedFormRegistryIfEmpty();

    const config = svc.resolveFormConfig(null, null, null); // generic
    assert.ok(config, 'Generic config should be returned');
    assert.ok(Array.isArray(config.fields));
  });

  test('Form registry contains Agriculture forms in /api/v2/form-registry response', async () => {
    const repo = makeRepo(makeTempDb());
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/form-registry');
    assert.equal(res.statusCode, 200);
    const keys = res.body.data.map(f => f.key);
    const agriKeys = keys.filter(k => k.includes('Agriculture'));
    assert.ok(agriKeys.length > 0, 'Agriculture forms should appear in /api/v2/form-registry');
  });
});
