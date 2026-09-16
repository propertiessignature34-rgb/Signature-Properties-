'use strict';
/**
 * PHASE 17 — Canonical V2 API + Backward Compatibility
 * Tests: canonical routes, legacy adapters, auth, feature flag, error contracts
 */
process.env.LEAD_V2_ENABLED = 'true';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

let _ctr = 7200000000;
function um() { return String(++_ctr); }

function makeStack() {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-p17-'));
  const file = path.join(dir, 'db.json');
  const { JsonRepository }        = require('../src/data/repository');
  const { V2ConfigService }       = require('../src/services/v2ConfigService');
  const { V2FormRegistryService } = require('../src/services/v2FormRegistryService');
  const { V2DependencyService }   = require('../src/services/v2DependencyService');
  const { V2ScoringService }      = require('../src/services/v2ScoringService');
  const { V2LeadService }         = require('../src/services/v2LeadService');
  const { V2TransactionService }  = require('../src/services/v2TransactionService');
  const { V2RequirementService }  = require('../src/services/v2RequirementService');
  const repo    = new JsonRepository(file);
  const cfg     = new V2ConfigService(repo);
  const reg     = new V2FormRegistryService(repo, cfg);
  const dep     = new V2DependencyService(repo, reg);
  const scoring = new V2ScoringService(repo, dep);
  const leadSvc = new V2LeadService(repo, scoring);
  const txnSvc  = new V2TransactionService(repo);
  const reqSvc  = new V2RequirementService(repo, scoring);
  cfg.seedConfigIfEmpty(); reg.seedFormRegistryIfEmpty(); dep.seedDependencyConfigIfEmpty(); scoring.seedScoringConfigIfEmpty();
  return { repo, leadSvc, txnSvc, reqSvc };
}

function makeHandle(repo, v2Enabled = true) {
  // Save and restore env flag per-test
  const prev = process.env.LEAD_V2_ENABLED;
  process.env.LEAD_V2_ENABLED = v2Enabled ? 'true' : 'false';
  const { V2Router } = require('../src/api/v2Router');
  const router = new V2Router(repo);
  const h = async (method, pathQ, body) => {
    const url = new URL(`http://localhost${pathQ}`);
    const req = { method, headers: { 'x-user-id': 'U1', 'x-user-role': 'AGENT' } };
    let cap = { statusCode: null, body: null };
    const res = { writeHead(c) { cap.statusCode = c; }, end(d) { try { cap.body = JSON.parse(d); } catch { cap.body = d; } } };
    const r = await router.handle(req, res, url, body || {});
    if (r && r.statusCode != null) return r;
    return cap;
  };
  // restore
  process.env.LEAD_V2_ENABLED = prev;
  return h;
}

function seed(stack, opts = {}) {
  const { leadSvc, txnSvc, reqSvc } = stack;
  const lr = leadSvc.createLead({ ClientName: opts.name || 'Test', PrimaryMobile: um() }, { userId: 'U1' });
  assert.equal(lr.ok, true, lr.error);
  const leadId = lr.data.LeadID;
  const tr = txnSvc.createTransaction(leadId, { TransactionType: 'Purchase' }, { userId: 'U1' });
  const txnId = tr.data.TransactionID;
  const rr = reqSvc.createRequirement(txnId, {
    LeadID: leadId, Category: 'Residential',
    Fields: { BudgetMax: { state: 'KNOWN', value: 10000000 } }
  }, { userId: 'U1' });
  return { leadId, txnId, reqId: rr.data.RequirementID };
}

// ── A. Canonical V2 Client routes ─────────────────────────────────────────────

describe('A. Canonical V2 Client Routes', () => {
  test('GET /api/v2/clients — 200 + ok:true', async () => {
    const s = makeStack(); seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients');
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.data));
  });

  test('POST /api/v2/clients — 201 + LeadID', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('POST', '/api/v2/clients', { ClientName: 'New', PrimaryMobile: um() });
    assert.ok(r.statusCode === 201 || r.statusCode === 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.data.LeadID);
  });

  test('GET /api/v2/clients/:id — 200 with client', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/clients/${leadId}`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.data.LeadID, leadId);
  });

  test('GET /api/v2/clients/:id — 404 for unknown', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients/L-GHOST');
    assert.equal(r.statusCode, 404);
    assert.equal(r.body.ok, false);
  });

  test('PATCH /api/v2/clients/:id — updates field', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('PATCH', `/api/v2/clients/${leadId}`, { ClientStatus: 'Contacted' });
    assert.equal(r.body.ok, true);
  });

  test('GET /api/v2/clients/:id/workspace — 200', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/clients/${leadId}/workspace`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
  });

  test('POST /api/v2/clients/:id/lost marks lead lost with reason', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('POST', `/api/v2/clients/${leadId}/lost`, { LostReason: 'Budget mismatch', LostNote: 'Out of range' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.data.ClientStatus, 'Lost');
    assert.equal(r.body.data.LostReason, 'Budget mismatch');
  });

  test('POST /api/v2/clients/:id/reactivate reactivates lost lead', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    await h('POST', `/api/v2/clients/${leadId}/lost`, { LostReason: 'Testing' });
    const r = await h('POST', `/api/v2/clients/${leadId}/reactivate`, { ClientStatus: 'Contacted' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.data.ClientStatus, 'Contacted');
  });

  test('GET /api/v2/clients/:id/transactions — 200', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/clients/${leadId}/transactions`);
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.body.data));
  });

  test('POST /api/v2/clients/check-duplicate — ok:true', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('POST', '/api/v2/clients/check-duplicate', { PrimaryMobile: um() });
    assert.equal(r.body.ok, true);
  });
});

// ── B. Canonical V2 Transaction routes ───────────────────────────────────────

describe('B. Canonical V2 Transaction Routes', () => {
  test('GET /api/v2/transactions/:id — 200', async () => {
    const s = makeStack(); const { txnId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/transactions/${txnId}`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.data.TransactionID, txnId);
  });

  test('GET /api/v2/transactions/:id — 404 for unknown', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/transactions/T-GHOST');
    assert.equal(r.statusCode, 404);
  });

  test('GET /api/v2/transactions/:id/requirements — 200 + array', async () => {
    const s = makeStack(); const { txnId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/transactions/${txnId}/requirements`);
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.body.data));
  });

  test('POST /api/v2/clients/:id/transactions — 201', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('POST', `/api/v2/clients/${leadId}/transactions`, { TransactionType: 'Rent' });
    assert.ok(r.statusCode === 201 || r.statusCode === 200);
    assert.equal(r.body.ok, true);
  });
});

// ── C. Canonical V2 Requirement routes ───────────────────────────────────────

describe('C. Canonical V2 Requirement Routes', () => {
  test('GET /api/v2/requirements/:id — 200', async () => {
    const s = makeStack(); const { reqId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/requirements/${reqId}`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.data.RequirementID, reqId);
  });

  test('GET /api/v2/requirements/:id — 404 for unknown', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/requirements/R-GHOST');
    assert.equal(r.statusCode, 404);
  });

  test('PATCH /api/v2/requirements/:id — 200', async () => {
    const s = makeStack(); const { reqId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('PATCH', `/api/v2/requirements/${reqId}`, { BudgetMax: 12000000 });
    assert.equal(r.body.ok, true);
  });

  test('GET /api/v2/requirements/:id/next-questions — 200', async () => {
    const s = makeStack(); const { reqId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/requirements/${reqId}/next-questions`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.questions));
  });

  test('GET /api/v2/requirements/:id/score — 200', async () => {
    const s = makeStack(); const { reqId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/requirements/${reqId}/score`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.ok(typeof r.body.score === 'number');
  });

  test('POST /api/v2/transactions/:id/requirements — 201', async () => {
    const s = makeStack(); const { leadId, txnId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('POST', `/api/v2/transactions/${txnId}/requirements`, {
      LeadID: leadId, Category: 'Residential'
    });
    assert.ok(r.statusCode === 201 || r.statusCode === 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.data.RequirementID);
  });
});

// ── D. Legacy Adapter Compatibility ──────────────────────────────────────────

describe('D. Legacy Adapter Compatibility (LEAD_V2_ENABLED=true)', () => {
  test('/api/leads — GET works', async () => {
    const s = makeStack(); seed(s);
    const h = makeHandle(s.repo, true);
    const r = await h('GET', '/api/leads');
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.data));
  });

  test('/api/leads — POST works', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo, true);
    const r = await h('POST', '/api/leads', { ClientName: 'Legacy', PrimaryMobile: um() });
    assert.equal(r.body.ok, true);
    assert.ok(r.body.data.LeadID);
  });

  test('/api/leads/:id — GET works', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo, true);
    const r = await h('GET', `/api/leads/${leadId}`);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.data.LeadID, leadId);
  });

  test('/api/leads/:id — PATCH works', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo, true);
    const r = await h('PATCH', `/api/leads/${leadId}`, { ClientStatus: 'Contacted' });
    assert.equal(r.body.ok, true);
  });

  test('/api/requirements — GET works', async () => {
    const s = makeStack(); seed(s);
    const h = makeHandle(s.repo, true);
    const r = await h('GET', '/api/requirements');
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.data));
  });

  test('/api/requirements/:id — PATCH works', async () => {
    const s = makeStack(); const { reqId } = seed(s);
    const h = makeHandle(s.repo, true);
    const r = await h('PATCH', `/api/requirements/${reqId}`, { BudgetMax: 9999999 });
    assert.equal(r.body.ok, true);
  });

  test('/api/clients/:id/workspace — GET works', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo, true);
    const r = await h('GET', `/api/clients/${leadId}/workspace`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
  });
});

// ── E. Feature Flag: canonical /api/v2/* always active ────────────────────────

describe('E. Feature Flag — canonical /api/v2/* always active', () => {
  test('GET /api/v2/clients when LEAD_V2_ENABLED=false still returns 200', async () => {
    const s = makeStack();
    // temporarily disable
    const saved = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    const h = makeHandle(s.repo, false);
    process.env.LEAD_V2_ENABLED = saved;
    // Make a fresh router with flag false
    const { V2Router } = require('../src/api/v2Router');
    const router = new V2Router(s.repo);
    const origEnv = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    const url = new URL('http://localhost/api/v2/clients');
    const req = { method: 'GET', headers: { 'x-user-id': 'U1' } };
    let cap = { statusCode: null, body: null };
    const res = { writeHead(c) { cap.statusCode = c; }, end(d) { try { cap.body = JSON.parse(d); } catch { cap.body = d; } } };
    const r = await router.handle(req, res, url, {});
    process.env.LEAD_V2_ENABLED = origEnv;
    const result = (r && r.statusCode != null) ? r : cap;
    assert.equal(result.statusCode, 200, `Expected 200 even with flag off, got ${result.statusCode}`);
  });

  test('GET /api/v2/requirements/:id/score always active', async () => {
    const s = makeStack(); const { reqId } = seed(s);
    const { V2Router } = require('../src/api/v2Router');
    const router = new V2Router(s.repo);
    const origEnv = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    const url = new URL(`http://localhost/api/v2/requirements/${reqId}/score`);
    const req = { method: 'GET', headers: { 'x-user-id': 'U1' } };
    let cap = { statusCode: null, body: null };
    const res = { writeHead(c) { cap.statusCode = c; }, end(d) { try { cap.body = JSON.parse(d); } catch { cap.body = d; } } };
    const r = await router.handle(req, res, url, {});
    process.env.LEAD_V2_ENABLED = origEnv;
    const result = (r && r.statusCode != null) ? r : cap;
    assert.equal(result.statusCode, 200, 'Score route must work even with flag off');
  });

  test('LEAD_V2_ENABLED=false: /api/leads returns null (falls through to legacy)', async () => {
    const s = makeStack();
    const { V2Router } = require('../src/api/v2Router');
    const router = new V2Router(s.repo);
    const origEnv = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    const url = new URL('http://localhost/api/leads');
    const req = { method: 'GET', headers: {} };
    let cap = { statusCode: null, body: null };
    const res = { writeHead(c) { cap.statusCode = c; }, end(d) { try { cap.body = JSON.parse(d); } catch { cap.body = d; } } };
    const r = await router.handle(req, res, url, {});
    process.env.LEAD_V2_ENABLED = origEnv;
    // Should return null — falls through to legacy
    assert.equal(r, null, '/api/leads must fall through to legacy when V2 disabled');
  });
});

// ── F. Error contract standardization ────────────────────────────────────────

describe('F. Error Contract', () => {
  test('404 for unknown client has ok:false', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients/L-NOTEXIST');
    assert.equal(r.statusCode, 404);
    assert.equal(r.body.ok, false);
  });

  test('404 for unknown requirement has ok:false', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/requirements/R-NOTEXIST');
    assert.equal(r.statusCode, 404);
    assert.equal(r.body.ok, false);
  });

  test('404 for unknown transaction has ok:false', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/transactions/T-NOTEXIST');
    assert.equal(r.statusCode, 404);
    assert.equal(r.body.ok, false);
  });

  test('Duplicate client returns 409', async () => {
    const s = makeStack();
    const mobile = um();
    const h = makeHandle(s.repo);
    await h('POST', '/api/v2/clients', { ClientName: 'First', PrimaryMobile: mobile });
    const r = await h('POST', '/api/v2/clients', { ClientName: 'Second', PrimaryMobile: mobile });
    assert.ok(r.statusCode === 409 || !r.body.ok, 'Duplicate must return 409 or ok:false');
  });

  test('No stack trace in error responses', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients/FAKE-ID');
    const bodyStr = JSON.stringify(r.body);
    assert.ok(!bodyStr.includes('at Object.'), 'Error must not expose stack trace');
    assert.ok(!bodyStr.includes('node_modules'), 'Error must not expose internal paths');
  });

  test('Success responses have ok:true', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/clients/${leadId}`);
    assert.equal(r.body.ok, true);
    assert.ok('data' in r.body, 'Success must have data field');
  });
});

// ── G. Immutability invariants ────────────────────────────────────────────────

describe('G. Immutability Invariants', () => {
  test('LeadID is immutable across PATCH', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    await h('PATCH', `/api/v2/clients/${leadId}`, { LeadID: 'FAKE', ClientStatus: 'Contacted' });
    const lead = s.repo.read().Leads.find(l => l.LeadID === leadId);
    assert.ok(lead, 'Original LeadID must still exist');
  });

  test('RequirementID is immutable across PATCH', async () => {
    const s = makeStack(); const { reqId } = seed(s);
    const h = makeHandle(s.repo);
    await h('PATCH', `/api/v2/requirements/${reqId}`, { RequirementID: 'FAKE' });
    const req = s.repo.read().Requirements.find(r => r.RequirementID === reqId);
    assert.ok(req, 'Original RequirementID must still exist');
  });

  test('TransactionID is immutable across PATCH', async () => {
    const s = makeStack(); const { txnId } = seed(s);
    const h = makeHandle(s.repo);
    await h('PATCH', `/api/v2/transactions/${txnId}`, { TransactionID: 'FAKE' });
    const txn = s.repo.read().Transactions.find(t => t.TransactionID === txnId);
    assert.ok(txn, 'Original TransactionID must still exist');
  });

  test('ONE CLIENT = ONE LEAD invariant: POST /api/v2/clients creates exactly 1 Lead', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const before = s.repo.read().Leads.length;
    await h('POST', '/api/v2/clients', { ClientName: 'Solo', PrimaryMobile: um() });
    const after = s.repo.read().Leads.length;
    assert.equal(after - before, 1, 'POST /api/v2/clients must create exactly 1 Lead');
  });
});

// ── H. Relationship validation ────────────────────────────────────────────────

describe('H. Relationship Validation', () => {
  test('Requirement.LeadID matches Transaction.LeadID', async () => {
    const s = makeStack(); const { leadId, txnId, reqId } = seed(s);
    const db  = s.repo.read();
    const txn = db.Transactions.find(t => t.TransactionID === txnId);
    const req = db.Requirements.find(r => r.RequirementID === reqId);
    assert.equal(txn.LeadID, req.LeadID, 'Requirement.LeadID must equal Transaction.LeadID');
    assert.equal(req.LeadID, leadId, 'Both must equal the client LeadID');
  });

  test('Requirement cannot be re-parented: PATCH LeadID is ignored', async () => {
    const s = makeStack();
    const { reqId, leadId } = seed(s);
    const { leadId: otherLeadId } = seed(s, { name: 'Other' });
    const h = makeHandle(s.repo);
    await h('PATCH', `/api/v2/requirements/${reqId}`, { LeadID: otherLeadId });
    const req = s.repo.read().Requirements.find(r => r.RequirementID === reqId);
    assert.equal(req.LeadID, leadId, 'Requirement.LeadID must not change via PATCH');
  });

  test('Transaction cannot be re-parented: PATCH LeadID is ignored', async () => {
    const s = makeStack();
    const { txnId, leadId } = seed(s);
    const { leadId: otherLeadId } = seed(s, { name: 'Other 2' });
    const h = makeHandle(s.repo);
    await h('PATCH', `/api/v2/transactions/${txnId}`, { LeadID: otherLeadId });
    const txn = s.repo.read().Transactions.find(t => t.TransactionID === txnId);
    assert.equal(txn.LeadID, leadId, 'Transaction.LeadID must not change via PATCH');
  });
});

// ── I. UNKNOWN ≠ NO invariant ─────────────────────────────────────────────────

describe('I. UNKNOWN ≠ NO Invariant', () => {
  test('UNKNOWN field is not converted to NO by PATCH', async () => {
    const s = makeStack();
    const { leadSvc, txnSvc, reqSvc } = s;
    const lr = leadSvc.createLead({ ClientName: 'T', PrimaryMobile: um() }, { userId: 'U1' });
    const tr = txnSvc.createTransaction(lr.data.LeadID, { TransactionType: 'Purchase' }, { userId: 'U1' });
    const rr = reqSvc.createRequirement(tr.data.TransactionID, {
      LeadID: lr.data.LeadID,
      Fields: { Parking: { state: 'UNKNOWN' } }
    }, { userId: 'U1' });
    const h = makeHandle(s.repo);
    await h('PATCH', `/api/v2/requirements/${rr.data.RequirementID}`, { BudgetMax: 5000000 });
    const req = s.repo.read().Requirements.find(r => r.RequirementID === rr.data.RequirementID);
    const parkingState = req.Fields?.Parking?.state;
    assert.notEqual(parkingState, 'NO', 'UNKNOWN must not become NO after PATCH');
  });

  test('KNOWN value survives PATCH of other field', async () => {
    const s = makeStack(); const { reqId } = seed(s, { name: 'Preserve Test' });
    // First confirm BudgetMax is KNOWN
    const req = s.repo.read().Requirements.find(r => r.RequirementID === reqId);
    assert.equal(req.Fields?.BudgetMax?.state, 'KNOWN', 'BudgetMax must start KNOWN');
    const h = makeHandle(s.repo);
    await h('PATCH', `/api/v2/requirements/${reqId}`, { BHKMin: 3 });
    const after = s.repo.read().Requirements.find(r => r.RequirementID === reqId);
    assert.equal(after.Fields?.BudgetMax?.state, 'KNOWN', 'BudgetMax KNOWN must survive PATCH of BHKMin');
  });
});
