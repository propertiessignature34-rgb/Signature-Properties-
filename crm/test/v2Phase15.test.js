'use strict';
/**
 * PHASE 15 — Client List / Query View
 * Tests cover: canonical /api/v2/clients endpoints, need-based query,
 * deduplication, enrichment, and filter presets.
 */
process.env.LEAD_V2_ENABLED = 'true';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

let _ctr = 9100000000;
function um() { return String(++_ctr); }

function makeStack() {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-p15-'));
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

function makeHandle(repo) {
  const { V2Router } = require('../src/api/v2Router');
  const router = new V2Router(repo);
  return async (method, pathQ, body) => {
    const url = new URL(`http://localhost${pathQ}`);
    const req = { method, headers: { 'x-user-id': 'U1', 'x-user-role': 'AGENT' } };
    let cap = { statusCode: null, body: null };
    const res = { writeHead(c) { cap.statusCode = c; }, end(d) { try { cap.body = JSON.parse(d); } catch { cap.body = d; } } };
    const r = await router.handle(req, res, url, body || {});
    if (r && r.statusCode != null) return r;
    return cap;
  };
}

function seed(stack, overrides = {}) {
  const { leadSvc, txnSvc, reqSvc } = stack;
  const lr = leadSvc.createLead({
    ClientName: overrides.name || 'Test Client',
    PrimaryMobile: overrides.mobile || um(),
    ClientStatus: overrides.status || 'Contacted',
    Tags: overrides.tags || []
  }, { userId: 'U1' });
  assert.equal(lr.ok, true, lr.error);
  const leadId = lr.data.LeadID;
  if (overrides.noTxn) return { leadId };
  const tr = txnSvc.createTransaction(leadId, { TransactionType: overrides.txnType || 'Purchase' }, { userId: 'U1' });
  assert.equal(tr.ok, true, tr.error);
  const txnId = tr.data.TransactionID;
  if (overrides.noReq) return { leadId, txnId };
  const rr = reqSvc.createRequirement(txnId, {
    LeadID: leadId,
    Category: overrides.category || 'Residential',
    SubCategory: overrides.subCategory || 'Flat',
    TransactionType: overrides.txnType || 'Purchase',
    Fields: overrides.fields || {
      BudgetMax: { state: 'KNOWN', value: overrides.budget || 10000000 },
      Location1: { state: 'KNOWN', value: overrides.location || 'Vesu' }
    }
  }, { userId: 'U1' });
  assert.equal(rr.ok, true, rr.error);
  return { leadId, txnId, reqId: rr.data.RequirementID };
}

// ── A. GET /api/v2/clients ────────────────────────────────────────────────────

describe('A. GET /api/v2/clients', () => {
  test('returns ok:true and data array', async () => {
    const s = makeStack(); seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients');
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.data));
  });

  test('returns enriched client with _activeNeeds', async () => {
    const s = makeStack(); seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients');
    const clients = r.body.data;
    // At least one seeded client; look for one with needs
    const enriched = clients.find(c => c._activeNeeds != null);
    assert.ok(enriched, 'At least one client must be enriched with _activeNeeds');
  });

  test('returns _needSummaries array', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients');
    const c = r.body.data.find(x => x.LeadID === leadId);
    assert.ok(Array.isArray(c._needSummaries), '_needSummaries must be an array');
  });

  test('status filter narrows results', async () => {
    const s = makeStack();
    seed(s, { name: 'Contacted One', status: 'Contacted' });
    seed(s, { name: 'Lost One', status: 'Lost', lostReason: 'Budget mismatch' });
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients?status=Lost');
    const names = (r.body.data || []).map(c => c.ClientName || c.Name);
    assert.ok(names.some(n => n === 'Lost One'), 'Lost client must appear');
    const r2 = await h('GET', '/api/v2/clients?status=Contacted');
    const names2 = (r2.body.data || []).map(c => c.ClientName || c.Name);
    assert.ok(!names2.some(n => n === 'Lost One'), 'Lost client must not appear under Contacted filter');
  });

  test('search by name works', async () => {
    const s = makeStack();
    seed(s, { name: 'Dhruv Mehta' });
    seed(s, { name: 'Anjali Shah' });
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients?q=Dhruv');
    const names = (r.body.data || []).map(c => c.ClientName || c.Name || '');
    assert.ok(names.some(n => n.includes('Dhruv')), 'Search by name must return matching client');
  });
});

// ── B. POST /api/v2/clients ───────────────────────────────────────────────────

describe('B. POST /api/v2/clients (create)', () => {
  test('creates a new client and returns 201', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('POST', '/api/v2/clients', { ClientName: 'New Client', PrimaryMobile: um() });
    assert.ok(r.statusCode === 201 || r.statusCode === 200, `Expected 201, got ${r.statusCode}`);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.data.LeadID, 'Must return LeadID');
  });

  test('returns 409 on exact duplicate', async () => {
    const s = makeStack();
    const mobile = um();
    await makeHandle(s.repo)('POST', '/api/v2/clients', { ClientName: 'A', PrimaryMobile: mobile });
    const r2 = await makeHandle(s.repo)('POST', '/api/v2/clients', { ClientName: 'A', PrimaryMobile: mobile });
    assert.ok(r2.statusCode === 409 || !r2.body.ok, 'Exact duplicate must return 409 or ok:false');
  });

  test('does not create a transaction automatically', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    await h('POST', '/api/v2/clients', { ClientName: 'Solo Client', PrimaryMobile: um() });
    const db = s.repo.read();
    // A new client should have no transactions (seed data may have some)
    const newClient = db.Leads.find(l => l.ClientName === 'Solo Client');
    assert.ok(newClient, 'Client must be created');
    const txns = db.Transactions.filter(t => t.LeadID === newClient.LeadID);
    assert.equal(txns.length, 0, 'POST /api/v2/clients must not auto-create a transaction');
  });
});

// ── C. GET /api/v2/clients/:id ────────────────────────────────────────────────

describe('C. GET /api/v2/clients/:id', () => {
  test('returns single client by ID', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/clients/${leadId}`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.data.LeadID, leadId);
  });

  test('returns 404 for unknown ID', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients/L-NONEXISTENT');
    assert.equal(r.statusCode, 404);
    assert.equal(r.body.ok, false);
  });

  test('GET is read-only — no mutations', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    const before = JSON.stringify(s.repo.read().Leads);
    await h('GET', `/api/v2/clients/${leadId}`);
    const after = JSON.stringify(s.repo.read().Leads);
    assert.equal(after, before, 'GET must not mutate Leads');
  });
});

// ── D. PATCH /api/v2/clients/:id ─────────────────────────────────────────────

describe('D. PATCH /api/v2/clients/:id', () => {
  test('updates ClientStatus', async () => {
    const s = makeStack(); const { leadId } = seed(s, { status: 'New' });
    const h = makeHandle(s.repo);
    const r = await h('PATCH', `/api/v2/clients/${leadId}`, { ClientStatus: 'Contacted' });
    assert.ok(r.body.ok, `PATCH failed: ${r.body.error}`);
    const lead = s.repo.read().Leads.find(l => l.LeadID === leadId);
    assert.equal(lead.ClientStatus, 'Contacted');
  });

  test('LeadID is immutable after PATCH', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    await h('PATCH', `/api/v2/clients/${leadId}`, { LeadID: 'FAKE-ID' });
    const lead = s.repo.read().Leads.find(l => l.LeadID === leadId);
    assert.ok(lead, 'Original lead must still exist after attempted LeadID mutation');
  });
});

// ── E. GET /api/v2/clients/:id/transactions ──────────────────────────────────

describe('E. GET /api/v2/clients/:id/transactions', () => {
  test('returns transactions for client', async () => {
    const s = makeStack(); const { leadId, txnId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/clients/${leadId}/transactions`);
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.body.data));
    assert.ok(r.body.data.some(t => t.TransactionID === txnId));
  });

  test('POST creates transaction without new Lead', async () => {
    const s = makeStack(); const { leadId } = seed(s, { noTxn: true, noReq: true });
    const h = makeHandle(s.repo);
    const leadCountBefore = s.repo.read().Leads.length;
    const r = await h('POST', `/api/v2/clients/${leadId}/transactions`, { TransactionType: 'Rent' });
    assert.ok(r.body.ok, `POST /transactions failed: ${r.body.error}`);
    const leadCountAfter = s.repo.read().Leads.length;
    assert.equal(leadCountAfter, leadCountBefore, 'POST transaction must not create a new Lead');
  });
});

// ── F. GET /api/v2/clients/:id/workspace ─────────────────────────────────────

describe('F. GET /api/v2/clients/:id/workspace', () => {
  test('returns canonical workspace', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/clients/${leadId}/workspace`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.data.lead, 'must have lead');
    assert.ok(Array.isArray(r.body.data.transactions), 'must have transactions');
    assert.ok(Array.isArray(r.body.data.requirements), 'must have requirements');
    assert.ok(r.body.data.summary != null, 'must have summary');
  });
});

// ── G. POST /api/v2/clients/check-duplicate ──────────────────────────────────

describe('G. POST /api/v2/clients/check-duplicate', () => {
  test('returns EXACT_MATCH for known mobile', async () => {
    const s = makeStack();
    const mobile = um();
    s.leadSvc.createLead({ ClientName: 'Known', PrimaryMobile: mobile }, { userId: 'U1' });
    const h = makeHandle(s.repo);
    const r = await h('POST', '/api/v2/clients/check-duplicate', { PrimaryMobile: mobile });
    assert.equal(r.body.ok, true);
    assert.ok(r.body.duplicateResult === 'EXACT_MATCH' || r.body.result === 'EXACT_MATCH' ||
      r.body.data?.duplicateResult === 'EXACT_MATCH', `Expected EXACT_MATCH, got ${JSON.stringify(r.body)}`);
  });

  test('returns NO_MATCH for new mobile', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('POST', '/api/v2/clients/check-duplicate', { PrimaryMobile: um() });
    assert.equal(r.body.ok, true);
    const noMatch = r.body.duplicateResult === 'NO_MATCH' || r.body.result === 'NO_MATCH' ||
      r.body.data?.duplicateResult === 'NO_MATCH';
    assert.ok(noMatch, `Expected NO_MATCH, got ${JSON.stringify(r.body)}`);
  });
});

// ── H. Need-based query ───────────────────────────────────────────────────────

describe('H. Need-based query /api/v2/clients/query', () => {
  test('GET with transactionType=Purchase returns matching clients', async () => {
    const s = makeStack();
    seed(s, { name: 'Purchase Client', txnType: 'Purchase', budget: 10000000 });
    seed(s, { name: 'Rent Client',     txnType: 'Rent',     budget: 500000  });
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients/query?transactionType=Purchase');
    assert.equal(r.body.ok, true);
    const names = (r.body.data || []).map(c => c.ClientName || c.Name || '');
    assert.ok(names.some(n => n.includes('Purchase')), 'Purchase client must appear');
  });

  test('GET query returns CLIENT list — deduped by LeadID', async () => {
    const s = makeStack();
    // One client with 2 matching requirements
    const { leadId, txnId } = seed(s, { name: 'Multi-Need Client', location: 'Vesu' });
    s.reqSvc.createRequirement(txnId, {
      LeadID: leadId, Category: 'Residential', SubCategory: 'Villa',
      Fields: { Location1: { state: 'KNOWN', value: 'Vesu' } }
    }, { userId: 'U1' });
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients/query?location=Vesu');
    const ids = (r.body.data || []).map(c => c.LeadID);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, 'Client must appear only once even with multiple matching needs');
  });

  test('POST query body returns matching clients', async () => {
    const s = makeStack();
    seed(s, { name: 'Budget Match', budget: 15000000 });
    const h = makeHandle(s.repo);
    const r = await h('POST', '/api/v2/clients/query', { budgetMin: 10000000 });
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.data));
  });

  test('query result includes count', async () => {
    const s = makeStack(); seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/clients/query');
    assert.ok(typeof r.body.count === 'number', 'count must be a number');
  });
});

// ── I. /api/v2/transactions/:id ──────────────────────────────────────────────

describe('I. GET/PATCH /api/v2/transactions/:id', () => {
  test('GET returns transaction', async () => {
    const s = makeStack(); const { txnId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/transactions/${txnId}`);
    assert.ok(r.statusCode === 200 || r.body.ok, `Expected 200, got ${r.statusCode}`);
    const data = r.body.data || r.body;
    assert.ok(data.TransactionID === txnId || data === txnId, 'Must return correct TransactionID');
  });

  test('GET unknown transaction returns 404', async () => {
    const s = makeStack();
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/v2/transactions/T-NONEXISTENT');
    assert.equal(r.statusCode, 404);
  });
});

// ── J. /api/v2/requirements/:id ──────────────────────────────────────────────

describe('J. GET/PATCH /api/v2/requirements/:id', () => {
  test('GET returns requirement', async () => {
    const s = makeStack(); const { reqId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/requirements/${reqId}`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.data.RequirementID, reqId);
  });

  test('PATCH updates requirement', async () => {
    const s = makeStack(); const { reqId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('PATCH', `/api/v2/requirements/${reqId}`, { BudgetMax: 12000000 });
    assert.equal(r.body.ok, true);
    const req = s.repo.read().Requirements.find(x => x.RequirementID === reqId);
    const bmax = req.BudgetMax || req.Fields?.BudgetMax?.value;
    assert.equal(bmax, 12000000);
  });
});

// ── K. Backward compatibility: /api/leads still works ─────────────────────────

describe('K. Backward compatibility', () => {
  test('/api/leads returns data when V2 enabled', async () => {
    const s = makeStack(); seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', '/api/leads');
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.data));
  });

  test('/api/clients/:id/workspace still works', async () => {
    const s = makeStack(); const { leadId } = seed(s);
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/clients/${leadId}/workspace`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
  });
});
