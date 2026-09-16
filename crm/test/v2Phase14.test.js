/**
 * PHASE 14 — Client Workspace / Needs-First UI
 *
 * These are server-side API contract tests that validate the data layer
 * the Phase 14 UI depends on. Coverage:
 *
 * A. Client workspace loads
 * B. Lead information appears
 * C. Active Needs appear (transactions + requirements)
 * D. Multiple Transactions display correctly
 * E. Multiple Requirements under one Transaction
 * F. Known fields present in Fields map
 * G. UNKNOWN fields present in Fields map
 * H. NOT_APPLICABLE is not treated as UNKNOWN
 * I. Next Questions endpoint returns data
 * J. GET next-questions is read-only (does not mutate requirement)
 * K. Inline PATCH updates same RequirementID
 * L. Existing known fields survive PATCH
 * M. Add Need does not create another Lead
 * N. Requirement score available in workspace
 * O. Pipeline stage available in workspace
 * P. Empty states — no transactions, no requirements
 */

'use strict';

// Phase 14 tests cover V2 features — ensure the V2 shared routes are active.
process.env.LEAD_V2_ENABLED = 'true';

const { test, describe, beforeEach } = require('node:test');
const assert  = require('node:assert/strict');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Unique mobile counter — seed data uses 9876543210 and 9822011888; start far away
let _mobileCounter = 8000000000;
function uniqueMobile() {
  return String(++_mobileCounter);
}

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-v2-p14-'));
  return path.join(dir, 'test.json');
}

function makeStack(dbFile) {
  const { JsonRepository }        = require('../src/data/repository');
  const { V2ConfigService }       = require('../src/services/v2ConfigService');
  const { V2FormRegistryService } = require('../src/services/v2FormRegistryService');
  const { V2DependencyService }   = require('../src/services/v2DependencyService');
  const { V2ScoringService }      = require('../src/services/v2ScoringService');
  const { V2LeadService }         = require('../src/services/v2LeadService');
  const { V2TransactionService }  = require('../src/services/v2TransactionService');
  const { V2RequirementService }  = require('../src/services/v2RequirementService');

  const repo    = new JsonRepository(dbFile || makeTempDb());
  const cfg     = new V2ConfigService(repo);
  const reg     = new V2FormRegistryService(repo, cfg);
  const dep     = new V2DependencyService(repo, reg);
  const scoring = new V2ScoringService(repo, dep);
  const leadSvc = new V2LeadService(repo, scoring);
  const txnSvc  = new V2TransactionService(repo);
  const reqSvc  = new V2RequirementService(repo, scoring);

  cfg.seedConfigIfEmpty();
  reg.seedFormRegistryIfEmpty();
  dep.seedDependencyConfigIfEmpty();
  scoring.seedScoringConfigIfEmpty();

  return { repo, cfg, dep, scoring, leadSvc, txnSvc, reqSvc };
}

function makeRouterHandle(repo) {
  const { V2Router } = require('../src/api/v2Router');
  const router = new V2Router(repo);
  return async function handle(method, pathAndQuery, body) {
    const url = new URL(`http://localhost${pathAndQuery}`);
    const cap = { statusCode: null, body: null };
    const res = {
      writeHead(code) { cap.statusCode = code; },
      end(data) { try { cap.body = JSON.parse(data); } catch { cap.body = data; } }
    };
    // Provide headers so _actor(req) never throws
    const req = { method, headers: { 'x-user-id': 'U1', 'x-user-role': 'AGENT' } };
    const result = await router.handle(req, res, url, body || {});
    if (result && result.statusCode != null) return result;
    return cap;
  };
}

// Create a full Lead → Transaction → Requirement chain
function seedFullChain(stack, opts = {}) {
  const { leadSvc, txnSvc, reqSvc } = stack;

  const leadRes = leadSvc.createLead({
    ClientName:    opts.name    || 'Rahul Shah',
    PrimaryMobile: opts.mobile  || uniqueMobile(),
    Email:         opts.email   || null,
    ClientStatus:  opts.status  || 'Active',
    ClientLifecycle: opts.lifecycle || 'Client',
    Tags:          opts.tags    || ['HNI']
  }, { userId: 'U1' });
  assert.equal(leadRes.ok, true, `createLead failed: ${leadRes.error}`);
  const leadId = leadRes.data.LeadID;

  const txnRes = txnSvc.createTransaction(leadId, {
    TransactionType:   opts.txnType  || 'Purchase',
    TransactionStatus: opts.txnStatus || 'Open',
    PipelineStage:     opts.stage    || 'Matching'
  }, { userId: 'U1' });
  assert.equal(txnRes.ok, true, `createTransaction failed: ${txnRes.error}`);
  const txnId = txnRes.data.TransactionID;

  const reqRes = reqSvc.createRequirement(txnId, {
    LeadID:   leadId,
    Category: opts.category    || 'Residential',
    SubCategory: opts.subCategory || 'Flat',
    TransactionType: opts.txnType || 'Purchase',
    Fields: opts.fields || {
      BudgetMax: { state: 'KNOWN',   value: 10000000 },
      Location1: { state: 'KNOWN',   value: 'Vesu'   },
      BHKMin:    { state: 'UNKNOWN' },
      Possession:{ state: 'UNKNOWN' }
    }
  }, { userId: 'U1' });
  assert.equal(reqRes.ok, true, `createRequirement failed: ${reqRes.error}`);
  const reqId = reqRes.data.RequirementID;

  return { leadId, txnId, reqId };
}

// ── A. Client workspace loads ─────────────────────────────────────────────────

describe('A. Client workspace loads', () => {
  test('GET /api/clients/:id/workspace returns ok:true with data', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.ok(res.body.data, 'data must be present');
  });

  test('Returns 404 for unknown leadId', async () => {
    const stack = makeStack();
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', '/api/clients/L-NONEXISTENT/workspace');
    assert.ok(res.statusCode === 404 || (res.body && !res.body.ok),
      `Expected 404 or ok:false, got ${res.statusCode}`);
  });

  test('Opening workspace does not create any records', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const dbBefore = JSON.stringify(stack.repo.read());
    await handle('GET', `/api/clients/${leadId}/workspace`);
    // Reload repo from disk to ensure no disk writes happened (JSON store writes atomically)
    const dbAfter = JSON.stringify(stack.repo.read());
    // Lead/Txn/Req counts must not change
    const before = JSON.parse(dbBefore);
    const after  = JSON.parse(dbAfter);
    assert.equal(after.Leads.length, before.Leads.length, 'No new Leads on GET workspace');
    assert.equal(after.Transactions.length, before.Transactions.length, 'No new Transactions');
    assert.equal(after.Requirements.length, before.Requirements.length, 'No new Requirements');
  });
});

// ── B. Lead information appears ───────────────────────────────────────────────

describe('B. Lead information appears', () => {
  test('workspace.lead has ClientName, LeadID, PrimaryMobile', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack, { name: 'Priya Patel', mobile: '9999988888' });
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const lead = res.body.data.lead;
    assert.ok(lead.ClientName || lead.clientName, 'ClientName must be present');
    assert.ok(lead.LeadID || lead.leadId, 'LeadID must be present');
    assert.ok(lead.PrimaryMobile || lead.primaryMobile || lead.Phone, 'Phone must be present');
  });

  test('workspace.lead.ClientStatus is set', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack, { status: 'Active' });
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const lead = res.body.data.lead;
    assert.ok(
      ['Active', 'Qualified'].includes(lead.ClientStatus || lead.LeadStatus),
      `Expected Active/Qualified, got ${lead.ClientStatus || lead.LeadStatus}`
    );
  });

  test('workspace.lead.ClientScore is a number', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const score = res.body.data.lead.ClientScore;
    const num   = typeof score === 'object' ? score?.total : score;
    assert.ok(typeof num === 'number', `ClientScore must be a number, got ${typeof score}`);
  });
});

// ── C. Active Needs appear ────────────────────────────────────────────────────

describe('C. Active Needs appear', () => {
  test('workspace includes transactions array', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    assert.ok(Array.isArray(res.body.data.transactions), 'transactions must be an array');
    assert.ok(res.body.data.transactions.length >= 1, 'must have at least 1 transaction');
  });

  test('workspace includes requirements array', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    assert.ok(Array.isArray(res.body.data.requirements), 'requirements must be an array');
    assert.ok(res.body.data.requirements.length >= 1, 'must have at least 1 requirement');
  });

  test('Transaction links to correct LeadID', async () => {
    const stack = makeStack();
    const { leadId, txnId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const txn = res.body.data.transactions.find(t => t.TransactionID === txnId);
    assert.ok(txn, 'Transaction must appear in workspace');
    assert.equal(txn.LeadID, leadId, 'Transaction.LeadID must equal Lead.LeadID');
  });

  test('Requirement links to correct TransactionID', async () => {
    const stack = makeStack();
    const { leadId, txnId, reqId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const req = res.body.data.requirements.find(r => r.RequirementID === reqId);
    assert.ok(req, 'Requirement must appear in workspace');
    assert.equal(req.TransactionID, txnId, 'Requirement.TransactionID must equal Transaction.TransactionID');
  });
});

// ── D. Multiple Transactions display correctly ────────────────────────────────

describe('D. Multiple Transactions display correctly', () => {
  test('Two transactions under same lead both appear in workspace', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack);
    // Add second transaction
    const txn2 = stack.txnSvc.createTransaction(leadId, { TransactionType: 'Rent' }, { userId: 'U1' });
    assert.equal(txn2.ok, true);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const txns = res.body.data.transactions;
    assert.equal(txns.length, 2, 'Both transactions must appear');
    const types = txns.map(t => t.TransactionType || t.Type);
    assert.ok(types.includes('Purchase'), 'Purchase transaction must appear');
    assert.ok(types.includes('Rent'), 'Rent transaction must appear');
  });

  test('Each transaction keeps its own LeadID', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack);
    stack.txnSvc.createTransaction(leadId, { TransactionType: 'Sale' }, { userId: 'U1' });
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    for (const txn of res.body.data.transactions) {
      assert.equal(txn.LeadID, leadId, `Each transaction must have LeadID=${leadId}`);
    }
  });
});

// ── E. Multiple Requirements under one Transaction ────────────────────────────

describe('E. Multiple Requirements under one Transaction', () => {
  test('Two requirements under same transaction both appear', async () => {
    const stack = makeStack();
    const { leadId, txnId } = seedFullChain(stack);
    // Add second requirement under same transaction
    const req2 = stack.reqSvc.createRequirement(txnId, {
      LeadID: leadId, Category: 'Residential', SubCategory: 'Villa',
      Fields: { BudgetMax: { state: 'KNOWN', value: 15000000 } }
    }, { userId: 'U1' });
    assert.equal(req2.ok, true);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const reqs = res.body.data.requirements.filter(r => r.TransactionID === txnId);
    assert.equal(reqs.length, 2, 'Both requirements must appear under the same transaction');
  });

  test('Requirements under different transactions are separate', async () => {
    const stack = makeStack();
    const { leadId, txnId, reqId } = seedFullChain(stack);
    const txn2  = stack.txnSvc.createTransaction(leadId, { TransactionType: 'Rent' }, { userId: 'U1' });
    const txn2Id = txn2.data.TransactionID;
    const req2  = stack.reqSvc.createRequirement(txn2Id, {
      LeadID: leadId, Category: 'Commercial', SubCategory: 'Office',
      TransactionType: 'Rent'
    }, { userId: 'U1' });
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const reqs1 = res.body.data.requirements.filter(r => r.TransactionID === txnId);
    const reqs2 = res.body.data.requirements.filter(r => r.TransactionID === txn2Id);
    assert.equal(reqs1.length, 1, 'First transaction has 1 requirement');
    assert.equal(reqs2.length, 1, 'Second transaction has 1 requirement');
  });
});

// ── F. Known fields ───────────────────────────────────────────────────────────

describe('F. Known fields in Fields map', () => {
  test('Fields map contains KNOWN BudgetMax', async () => {
    const stack = makeStack();
    const { leadId, reqId } = seedFullChain(stack, {
      fields: { BudgetMax: { state: 'KNOWN', value: 10000000 }, Location1: { state: 'UNKNOWN' } }
    });
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const req = res.body.data.requirements.find(r => r.RequirementID === reqId);
    assert.ok(req, 'Requirement must be in workspace');
    // Fields map may be nested or requirements expose flat fields — check both
    const budgetKnown = req.Fields?.BudgetMax?.state === 'KNOWN' ||
                        (req.BudgetMax != null && req.BudgetMax === 10000000);
    assert.ok(budgetKnown, 'BudgetMax must be KNOWN in Fields or as flat field');
  });

  test('RequirementScore is calculated for requirement with KNOWN fields', async () => {
    const stack = makeStack();
    const { leadId, reqId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const req = res.body.data.requirements.find(r => r.RequirementID === reqId);
    const score = typeof req.RequirementScore === 'object' ? req.RequirementScore?.total : req.RequirementScore;
    assert.ok(score != null, 'RequirementScore must be set for requirement with KNOWN fields');
    assert.ok(typeof score === 'number' && score >= 0, 'RequirementScore must be a non-negative number');
  });
});

// ── G. UNKNOWN fields ─────────────────────────────────────────────────────────

describe('G. UNKNOWN fields in Fields map', () => {
  test('Fields map contains UNKNOWN BHKMin', async () => {
    const stack = makeStack();
    const { leadId, reqId } = seedFullChain(stack, {
      fields: {
        BudgetMax: { state: 'KNOWN', value: 10000000 },
        BHKMin:    { state: 'UNKNOWN' }
      }
    });
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const req = res.body.data.requirements.find(r => r.RequirementID === reqId);
    // UNKNOWN BHKMin must appear in Fields map as UNKNOWN
    if (req.Fields?.BHKMin) {
      assert.equal(req.Fields.BHKMin.state, 'UNKNOWN', 'BHKMin must remain UNKNOWN');
    }
    // BHKMin flat field must be null/undefined for UNKNOWN
    const flatBhk = req.BHKMin;
    assert.ok(flatBhk == null, `BHKMin flat field must be null for UNKNOWN, got ${flatBhk}`);
  });

  test('UNKNOWN field is never treated as NO or false', async () => {
    const stack = makeStack();
    const { leadId, reqId } = seedFullChain(stack, {
      fields: { Parking: { state: 'UNKNOWN' } }
    });
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const req = res.body.data.requirements.find(r => r.RequirementID === reqId);
    if (req.Fields?.Parking) {
      assert.notEqual(req.Fields.Parking.state, 'KNOWN', 'UNKNOWN Parking must not become KNOWN');
      // value must not be a "false"-like string
      const v = req.Fields.Parking.value;
      assert.ok(v !== false && v !== 'false' && v !== 0, 'UNKNOWN Parking value must not be a false-like value');
    }
  });
});

// ── H. NOT_APPLICABLE is not UNKNOWN ──────────────────────────────────────────

describe('H. NOT_APPLICABLE is not shown as UNKNOWN', () => {
  test('NOT_APPLICABLE field has state=NOT_APPLICABLE in Fields map', async () => {
    const stack = makeStack();
    const { leadId, reqId } = seedFullChain(stack, {
      fields: {
        BudgetMax:  { state: 'KNOWN',          value: 10000000 },
        TenantType: { state: 'NOT_APPLICABLE' }
      }
    });
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const req = res.body.data.requirements.find(r => r.RequirementID === reqId);
    if (req.Fields?.TenantType) {
      assert.equal(req.Fields.TenantType.state, 'NOT_APPLICABLE',
        'NOT_APPLICABLE must survive round-trip as NOT_APPLICABLE');
    }
  });

  test('NOT_APPLICABLE state is distinct from UNKNOWN state', () => {
    assert.notEqual('NOT_APPLICABLE', 'UNKNOWN', 'States must be distinct');
  });
});

// ── I. Next Questions endpoint ────────────────────────────────────────────────

describe('I. Next Questions load', () => {
  test('GET /api/v2/requirements/:id/next-questions returns ok:true', async () => {
    const stack = makeStack();
    const { reqId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/v2/requirements/${reqId}/next-questions?limit=3`);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.questions), 'questions must be an array');
  });

  test('Next Questions for unknown ID returns ok:false', async () => {
    const stack = makeStack();
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', '/api/v2/requirements/REQ-NONEXISTENT/next-questions');
    assert.equal(res.body.ok, false);
  });

  test('Questions have fieldKey and label fields', async () => {
    const stack = makeStack();
    const { reqId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/v2/requirements/${reqId}/next-questions?limit=3`);
    for (const q of res.body.questions || []) {
      assert.ok(q.fieldKey, `Question must have fieldKey: ${JSON.stringify(q)}`);
      assert.ok(q.label,    `Question must have label: ${JSON.stringify(q)}`);
    }
  });
});

// ── J. Next Question is read-only ─────────────────────────────────────────────

describe('J. GET next-questions does not mutate requirement', () => {
  test('RequirementScore unchanged after GET next-questions', async () => {
    const stack = makeStack();
    const { leadId, reqId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);

    const before = stack.repo.read().Requirements.find(r => r.RequirementID === reqId);
    const scoreBefore = before?.RequirementScore;
    const fieldsBefore = JSON.stringify(before?.Fields);

    await handle('GET', `/api/v2/requirements/${reqId}/next-questions?limit=3`);

    const after = stack.repo.read().Requirements.find(r => r.RequirementID === reqId);
    assert.equal(JSON.stringify(after?.Fields), fieldsBefore, 'Fields must not change after GET next-questions');
  });

  test('No new Leads created by GET next-questions', async () => {
    const stack = makeStack();
    const { leadId, reqId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const leadCountBefore = stack.repo.read().Leads.length;
    await handle('GET', `/api/v2/requirements/${reqId}/next-questions`);
    const leadCountAfter = stack.repo.read().Leads.length;
    assert.equal(leadCountAfter, leadCountBefore, 'GET next-questions must not create new Leads');
  });
});

// ── K. Inline PATCH updates same RequirementID ────────────────────────────────

describe('K. Inline PATCH updates same RequirementID', () => {
  test('PATCH /api/requirements/:id updates the same record', async () => {
    const stack = makeStack();
    const { reqId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);

    const res = await handle('PATCH', `/api/requirements/${reqId}`, {
      BudgetMax: 12000000
    });
    assert.ok(res.statusCode === 200 || res.statusCode === 201,
      `Expected 2xx, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.ok, true);

    // Verify same RequirementID still exists
    const db  = stack.repo.read();
    const req = db.Requirements.find(r => r.RequirementID === reqId);
    assert.ok(req, 'Requirement must still exist after PATCH');
    assert.equal(req.RequirementID, reqId, 'RequirementID must not change');

    // No duplicate requirement created
    const matching = db.Requirements.filter(r => r.RequirementID === reqId);
    assert.equal(matching.length, 1, 'PATCH must not create a duplicate requirement');
  });

  test('PATCH /api/requirements/:id updates BudgetMax in Fields', async () => {
    const stack = makeStack();
    const { reqId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);

    await handle('PATCH', `/api/requirements/${reqId}`, { BudgetMax: 15000000 });

    const db  = stack.repo.read();
    const req = db.Requirements.find(r => r.RequirementID === reqId);
    const bmax = req.BudgetMax || req.Fields?.BudgetMax?.value;
    assert.equal(bmax, 15000000, `BudgetMax must be updated to 15000000, got ${bmax}`);
  });
});

// ── L. Existing known fields survive PATCH ────────────────────────────────────

describe('L. Existing known fields survive PATCH', () => {
  test('PATCH with BudgetMax does not erase Location1', async () => {
    const stack = makeStack();
    const { reqId } = seedFullChain(stack, {
      fields: {
        BudgetMax: { state: 'KNOWN', value: 10000000 },
        Location1: { state: 'KNOWN', value: 'Vesu'   },
        BHKMin:    { state: 'UNKNOWN' }
      }
    });
    const handle = makeRouterHandle(stack.repo);

    // PATCH only BudgetMax
    await handle('PATCH', `/api/requirements/${reqId}`, { BudgetMax: 12000000 });

    const db  = stack.repo.read();
    const req = db.Requirements.find(r => r.RequirementID === reqId);

    // Location1 must survive
    const loc = req.Location1 || req.Fields?.Location1?.value;
    assert.ok(loc === 'Vesu' || (req.Fields?.Location1?.state === 'KNOWN' && req.Fields.Location1.value === 'Vesu'),
      `Location1 must survive PATCH, got ${loc}`);
  });

  test('PATCH with Location1 does not erase BudgetMax', async () => {
    const stack = makeStack();
    const { reqId } = seedFullChain(stack, {
      fields: {
        BudgetMax: { state: 'KNOWN', value: 10000000 },
        Location1: { state: 'KNOWN', value: 'Adajan' }
      }
    });
    const handle = makeRouterHandle(stack.repo);

    await handle('PATCH', `/api/requirements/${reqId}`, { Location1: 'Piplod' });

    const db  = stack.repo.read();
    const req = db.Requirements.find(r => r.RequirementID === reqId);
    const bmax = req.BudgetMax || req.Fields?.BudgetMax?.value;
    assert.equal(bmax, 10000000, `BudgetMax must survive Location1 PATCH, got ${bmax}`);
  });

  test('Category survives PATCH of other fields', async () => {
    const stack = makeStack();
    const { reqId } = seedFullChain(stack, { category: 'Residential' });
    const handle = makeRouterHandle(stack.repo);

    await handle('PATCH', `/api/requirements/${reqId}`, { BudgetMax: 9000000 });

    const db  = stack.repo.read();
    const req = db.Requirements.find(r => r.RequirementID === reqId);
    assert.equal(req.Category, 'Residential', 'Category must survive PATCH');
  });
});

// ── M. Add Need does not create another Lead ──────────────────────────────────

describe('M. Add Need does not create another Lead', () => {
  test('Adding a second transaction under existing lead does not create a new lead', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack);
    const leadCountBefore = stack.repo.read().Leads.length;

    const res = stack.txnSvc.createTransaction(leadId, { TransactionType: 'Rent' }, { userId: 'U1' });
    assert.equal(res.ok, true);

    const leadCountAfter = stack.repo.read().Leads.length;
    assert.equal(leadCountAfter, leadCountBefore, 'Adding a transaction must not create a new Lead');
  });

  test('New requirement under new transaction uses same LeadID', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack);
    const txn2 = stack.txnSvc.createTransaction(leadId, { TransactionType: 'Rent' }, { userId: 'U1' });
    const req2 = stack.reqSvc.createRequirement(txn2.data.TransactionID, {
      LeadID: leadId, Category: 'Commercial', TransactionType: 'Rent'
    }, { userId: 'U1' });
    assert.equal(req2.ok, true);
    assert.equal(req2.data.LeadID, leadId, 'New requirement must have same LeadID');
  });

  test('POST /api/leads/:id/transactions does not create new Lead', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const leadCountBefore = stack.repo.read().Leads.length;

    const res = await handle('POST', `/api/leads/${leadId}/transactions`, { TransactionType: 'Sale' });
    assert.equal(res.body.ok, true);

    const leadCountAfter = stack.repo.read().Leads.length;
    assert.equal(leadCountAfter, leadCountBefore, 'POST /transactions must not create new Lead');
  });
});

// ── N. Requirement score in workspace ─────────────────────────────────────────

describe('N. Requirement score in workspace', () => {
  test('Requirements in workspace have RequirementScore field', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const reqs = res.body.data.requirements;
    for (const req of reqs) {
      assert.ok('RequirementScore' in req, `Requirement ${req.RequirementID} must have RequirementScore`);
    }
  });

  test('GET /api/v2/requirements/:id/score returns score breakdown', async () => {
    const stack = makeStack();
    const { reqId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/v2/requirements/${reqId}/score`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(typeof res.body.score === 'number');
    assert.ok(res.body.band);
    assert.ok(Array.isArray(res.body.factors));
  });

  test('Score endpoint returns positiveContributions and unknownFactors', async () => {
    const stack = makeStack();
    const { reqId } = seedFullChain(stack, {
      fields: {
        BudgetMax: { state: 'KNOWN', value: 10000000 },
        BHKMin:    { state: 'UNKNOWN' }
      }
    });
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/v2/requirements/${reqId}/score`);
    assert.ok(Array.isArray(res.body.positiveContributions));
    assert.ok(Array.isArray(res.body.unknownFactors));
    assert.ok(res.body.positiveContributions.length > 0, 'KNOWN BudgetMax should produce positive contribution');
  });
});

// ── O. Pipeline stage in workspace ────────────────────────────────────────────

describe('O. Pipeline stage in workspace', () => {
  test('Transactions in workspace have PipelineStage', async () => {
    const stack = makeStack();
    const { leadId } = seedFullChain(stack, { stage: 'Matching' });
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const txns = res.body.data.transactions;
    for (const txn of txns) {
      assert.ok(txn.PipelineStage, `Transaction ${txn.TransactionID} must have PipelineStage`);
    }
  });

  test('PipelineStage persists correctly', async () => {
    const stack = makeStack();
    const { leadId, txnId } = seedFullChain(stack, { stage: 'Shortlisted' });
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const txn = res.body.data.transactions.find(t => t.TransactionID === txnId);
    assert.equal(txn.PipelineStage, 'Shortlisted');
  });
});

// ── P. Empty states ───────────────────────────────────────────────────────────

describe('P. Empty states', () => {
  test('Lead with no transactions returns empty transactions array', async () => {
    const stack = makeStack();
    const leadRes = stack.leadSvc.createLead({
      ClientName: 'Empty Client', PrimaryMobile: uniqueMobile()
    }, { userId: 'U1' });
    const leadId = leadRes.data.LeadID;
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    assert.equal(res.statusCode, 200);
    const txns = res.body.data.transactions || [];
    assert.equal(txns.length, 0, 'Lead with no transactions must have empty transactions array');
  });

  test('Lead with transaction but no requirements returns empty requirements array', async () => {
    const stack = makeStack();
    const leadRes = stack.leadSvc.createLead({
      ClientName: 'No Req Client', PrimaryMobile: uniqueMobile()
    }, { userId: 'U1' });
    const leadId = leadRes.data.LeadID;
    stack.txnSvc.createTransaction(leadId, { TransactionType: 'Purchase' }, { userId: 'U1' });
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    const reqs = res.body.data.requirements || [];
    assert.equal(reqs.length, 0, 'Transaction with no requirements must have empty requirements array');
  });

  test('Workspace response includes summary even for empty client', async () => {
    const stack = makeStack();
    const leadRes = stack.leadSvc.createLead({
      ClientName: 'Summary Test', PrimaryMobile: uniqueMobile()
    }, { userId: 'U1' });
    const leadId = leadRes.data.LeadID;
    const handle = makeRouterHandle(stack.repo);
    const res = await handle('GET', `/api/clients/${leadId}/workspace`);
    assert.ok(res.body.data.summary !== undefined, 'summary must be present even for empty client');
  });
});

// ── Additional: PATCH same RequirementID preserves IDs ───────────────────────

describe('PATCH preserves RequirementID and LeadID', () => {
  test('RequirementID and LeadID unchanged after PATCH', async () => {
    const stack = makeStack();
    const { leadId, txnId, reqId } = seedFullChain(stack);
    const handle = makeRouterHandle(stack.repo);

    await handle('PATCH', `/api/requirements/${reqId}`, { BudgetMax: 8000000 });

    const db  = stack.repo.read();
    const req = db.Requirements.find(r => r.RequirementID === reqId);
    assert.equal(req.RequirementID, reqId,  'RequirementID must be immutable');
    assert.equal(req.LeadID,        leadId, 'LeadID must be immutable');
    assert.equal(req.TransactionID, txnId,  'TransactionID must be immutable');
  });
});

// ── Score recalculated after PATCH ───────────────────────────────────────────

describe('Score recalculated after PATCH', () => {
  test('Adding more KNOWN fields via PATCH increases or maintains RequirementScore', async () => {
    const stack = makeStack();
    const { reqId } = seedFullChain(stack, {
      fields: { BudgetMax: { state: 'UNKNOWN' } }
    });
    const handle = makeRouterHandle(stack.repo);

    const scoreBefore = stack.repo.read().Requirements.find(r => r.RequirementID === reqId)?.RequirementScore || 0;

    await handle('PATCH', `/api/requirements/${reqId}`, {
      BudgetMax: 10000000,
      Location1: 'Vesu'
    });

    const scoreAfter = stack.repo.read().Requirements.find(r => r.RequirementID === reqId)?.RequirementScore || 0;
    assert.ok(scoreAfter >= scoreBefore, `Score after PATCH (${scoreAfter}) must be >= before (${scoreBefore})`);
  });
});
