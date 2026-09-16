'use strict';

process.env.LEAD_V2_ENABLED = 'true';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-req-lost-'));
  return path.join(dir, 'test.json');
}

function makeStack(dbFile) {
  const { JsonRepository } = require('../src/data/repository');
  const { V2ConfigService } = require('../src/services/v2ConfigService');
  const { V2FormRegistryService } = require('../src/services/v2FormRegistryService');
  const { V2DependencyService } = require('../src/services/v2DependencyService');
  const { V2ScoringService } = require('../src/services/v2ScoringService');
  const { V2LeadService } = require('../src/services/v2LeadService');
  const { V2TransactionService } = require('../src/services/v2TransactionService');
  const { V2RequirementService } = require('../src/services/v2RequirementService');
  const { V2Router } = require('../src/api/v2Router');

  const repo = new JsonRepository(dbFile || makeTempDb());
  const cfg = new V2ConfigService(repo);
  const reg = new V2FormRegistryService(repo, cfg);
  const dep = new V2DependencyService(repo, reg);
  const scoring = new V2ScoringService(repo, dep);
  const leadSvc = new V2LeadService(repo, scoring);
  const txnSvc = new V2TransactionService(repo);
  const reqSvc = new V2RequirementService(repo, scoring);
  const router = new V2Router(repo);

  cfg.seedConfigIfEmpty();
  reg.seedFormRegistryIfEmpty();
  dep.seedDependencyConfigIfEmpty();
  scoring.seedScoringConfigIfEmpty();

  return { repo, leadSvc, txnSvc, reqSvc, router };
}

async function handle(router, method, pathname, body) {
  const url = new URL(`http://localhost${pathname}`);
  const capture = { statusCode: null, body: null };
  const req = { method, headers: { 'x-user-id': 'U1', 'x-user-role': 'AGENT' } };
  const res = {
    writeHead(code) { capture.statusCode = code; },
    end(payload) {
      try { capture.body = JSON.parse(payload); } catch { capture.body = payload; }
    }
  };
  const result = await router.handle(req, res, url, body || {});
  return result && result.statusCode != null ? result : capture;
}

function seedChain(stack, { leadStatus = 'Contacted' } = {}) {
  const leadRes = stack.leadSvc.createLead({
    ClientName: 'Req Lost Client',
    PrimaryMobile: String(7000000000 + Math.floor(Math.random() * 1000000)),
    ClientStatus: leadStatus
  }, { userId: 'U1' });
  assert.equal(leadRes.ok, true, leadRes.error);
  const leadId = leadRes.data.LeadID;

  const txnRes = stack.txnSvc.createTransaction(leadId, { TransactionType: 'Purchase', TransactionStatus: 'Open' }, { userId: 'U1' });
  assert.equal(txnRes.ok, true, txnRes.error);
  const txnId = txnRes.data.TransactionID;

  const reqRes = stack.reqSvc.createRequirement(txnId, {
    LeadID: leadId,
    Category: 'Residential',
    SubCategory: 'Flat',
    RequirementStatus: 'Active',
    BudgetMin: 5000000,
    BudgetMax: 10000000,
    Location1: 'Vesu'
  }, { userId: 'U1' });
  assert.equal(reqRes.ok, true, reqRes.error);

  return { leadId, txnId, reqId: reqRes.data.RequirementID };
}

function assertWorkspaceCollections(data) {
  const keys = ['transactions', 'requirements', 'activities', 'followUps', 'timeline', 'documents', 'siteVisits', 'negotiations', 'deals', 'commissions', 'payments'];
  for (const key of keys) {
    assert.equal(Array.isArray(data[key]), true, `${key} must be an array`);
  }
}

describe('workspace shape normalization for legacy/partial data', () => {
  test('workspace survives missing/null/malformed collections', async () => {
    const stack = makeStack();
    const { leadId } = seedChain(stack);
    const db = stack.repo.read();
    delete db.Requirements;
    db.RequirementHistory = null;
    db.Activities = { bad: true };
    db.Timeline = 'bad';
    db.FollowUps = null;
    db.SiteVisits = { legacy: true };
    db.Negotiations = 101;
    db.Deals = null;
    db.Documents = 'bad';
    db.Matches = { bad: true };
    db.Shortlists = null;
    stack.repo.write(db);

    const res = await handle(stack.router, 'GET', `/api/v2/clients/${leadId}/workspace`);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assertWorkspaceCollections(res.body.data);
    assert.equal(res.body.data.requirements.length, 0);
  });
});

describe('requirement read/update shape safety', () => {
  test('GET/PATCH requirement works when RequirementHistory is null', async () => {
    const stack = makeStack();
    const { reqId } = seedChain(stack);
    const db = stack.repo.read();
    db.RequirementHistory = null;
    stack.repo.write(db);

    const patch = await handle(stack.router, 'PATCH', `/api/requirements/${reqId}`, { BudgetMax: 12000000 });
    assert.equal(patch.statusCode, 200, JSON.stringify(patch.body));
    assert.equal(patch.body.ok, true);
    assert.equal(Array.isArray(patch.body.data.history), true);
    assert.equal(patch.body.data.requirement.BudgetMax, 12000000);

    const get = await handle(stack.router, 'GET', `/api/requirements/${reqId}`);
    assert.equal(get.statusCode, 200, JSON.stringify(get.body));
    assert.equal(get.body.ok, true);
    assert.equal(Array.isArray(get.body.data.history), true);
    assert.ok(get.body.data.history.length >= 1, 'history should include update entry');
  });
});

describe('mark lost + reactivate requirement flow', () => {
  test('lost updates only target requirement, keeps client active, records activity/timeline', async () => {
    const stack = makeStack();
    const { leadId, txnId, reqId } = seedChain(stack, { leadStatus: 'Contacted' });
    const second = stack.reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      Category: 'Residential',
      SubCategory: 'Flat',
      RequirementStatus: 'Active',
      BudgetMax: 8000000,
      Location1: 'Adajan'
    }, { userId: 'U1' });
    assert.equal(second.ok, true, second.error);

    const lost = await handle(stack.router, 'PATCH', `/api/requirements/${reqId}`, {
      RequirementStatus: 'Lost',
      LostReason: 'Budget mismatch',
      LostNotes: 'Client paused search'
    });
    assert.equal(lost.statusCode, 200, JSON.stringify(lost.body));
    assert.equal(lost.body.ok, true);

    const target = stack.repo.readRequirement(reqId);
    const untouched = stack.repo.readRequirement(second.data.RequirementID);
    assert.equal(target.RequirementStatus || target.Status, 'Lost');
    assert.equal(target.LostReason, 'Budget mismatch');
    assert.equal(target.LostNotes, 'Client paused search');
    assert.equal(untouched.RequirementStatus || untouched.Status, 'Active');

    const client = await handle(stack.router, 'GET', `/api/v2/clients/${leadId}`);
    assert.equal(client.statusCode, 200, JSON.stringify(client.body));
    assert.notEqual(client.body.data.ClientStatus || client.body.data.LeadStatus, 'Lost');

    const ws = await handle(stack.router, 'GET', `/api/v2/clients/${leadId}/workspace`);
    assert.equal(ws.statusCode, 200, JSON.stringify(ws.body));
    assert.equal(ws.body.ok, true);
    assertWorkspaceCollections(ws.body.data);
    assert.ok(ws.body.data.activities.some((a) => String(a.Notes || '').includes('Requirement marked Lost')));
    assert.ok(ws.body.data.timeline.some((t) => t.EventType === 'REQUIREMENT_LOST' && t.EntityID === reqId));
  });

  test('reactivation works with optional notes omitted and preserves existing fields', async () => {
    const stack = makeStack();
    const { leadId, reqId } = seedChain(stack, { leadStatus: 'Contacted' });
    const before = stack.repo.readRequirement(reqId);

    const lost = await handle(stack.router, 'PATCH', `/api/requirements/${reqId}`, {
      RequirementStatus: 'Lost',
      LostReason: 'Testing'
    });
    assert.equal(lost.statusCode, 200, JSON.stringify(lost.body));
    assert.equal(lost.body.ok, true);

    const reactivated = await handle(stack.router, 'PATCH', `/api/requirements/${reqId}`, {
      RequirementStatus: 'Active'
    });
    assert.equal(reactivated.statusCode, 200, JSON.stringify(reactivated.body));
    assert.equal(reactivated.body.ok, true);

    const after = stack.repo.readRequirement(reqId);
    assert.equal(after.RequirementStatus || after.Status, 'Active');
    assert.equal(after.BudgetMax, before.BudgetMax, 'existing requirement fields must be preserved');
    assert.equal(after.Location1, before.Location1, 'existing requirement fields must be preserved');

    const client = await handle(stack.router, 'GET', `/api/v2/clients/${leadId}`);
    assert.equal(client.statusCode, 200, JSON.stringify(client.body));
    assert.notEqual(client.body.data.ClientStatus || client.body.data.LeadStatus, 'Lost');

    const ws = await handle(stack.router, 'GET', `/api/v2/clients/${leadId}/workspace`);
    assert.ok(ws.body.data.timeline.some((t) => t.EventType === 'REQUIREMENT_REACTIVATED' && t.EntityID === reqId));
  });
});
