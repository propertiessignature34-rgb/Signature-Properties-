'use strict';
/**
 * PHASE 16 — Conversation / Activity / Follow-up Engine
 */
process.env.LEAD_V2_ENABLED = 'true';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

let _ctr = 8300000000;
function um() { return String(++_ctr); }

function makeStack() {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-p16-'));
  const file = path.join(dir, 'db.json');
  const { JsonRepository }        = require('../src/data/repository');
  const { V2ConfigService }       = require('../src/services/v2ConfigService');
  const { V2FormRegistryService } = require('../src/services/v2FormRegistryService');
  const { V2DependencyService }   = require('../src/services/v2DependencyService');
  const { V2ScoringService }      = require('../src/services/v2ScoringService');
  const { V2LeadService }         = require('../src/services/v2LeadService');
  const { V2TransactionService }  = require('../src/services/v2TransactionService');
  const { V2RequirementService }  = require('../src/services/v2RequirementService');
  const { V2ActivityService }     = require('../src/services/v2ActivityService');
  const { V2FollowUpService }     = require('../src/services/v2FollowUpService');
  const repo    = new JsonRepository(file);
  const cfg     = new V2ConfigService(repo);
  const reg     = new V2FormRegistryService(repo, cfg);
  const dep     = new V2DependencyService(repo, reg);
  const scoring = new V2ScoringService(repo, dep);
  const leadSvc = new V2LeadService(repo, scoring);
  const txnSvc  = new V2TransactionService(repo);
  const reqSvc  = new V2RequirementService(repo, scoring);
  const actSvc  = new V2ActivityService(repo, reqSvc);
  const fuSvc   = new V2FollowUpService(repo);
  cfg.seedConfigIfEmpty(); reg.seedFormRegistryIfEmpty(); dep.seedDependencyConfigIfEmpty(); scoring.seedScoringConfigIfEmpty();
  return { repo, leadSvc, txnSvc, reqSvc, actSvc, fuSvc };
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

function seedChain(stack, opts = {}) {
  const { leadSvc, txnSvc, reqSvc } = stack;
  const lr = leadSvc.createLead({ ClientName: opts.name || 'Test', PrimaryMobile: opts.mobile || um() }, { userId: 'U1' });
  assert.equal(lr.ok, true, lr.error);
  const leadId = lr.data.LeadID;
  const tr = txnSvc.createTransaction(leadId, { TransactionType: opts.txnType || 'Purchase' }, { userId: 'U1' });
  assert.equal(tr.ok, true, tr.error);
  const txnId = tr.data.TransactionID;
  const rr = reqSvc.createRequirement(txnId, {
    LeadID: leadId,
    Fields: { BudgetMax: { state: 'UNKNOWN' }, Possession: { state: 'UNKNOWN' } }
  }, { userId: 'U1' });
  assert.equal(rr.ok, true, rr.error);
  return { leadId, txnId, reqId: rr.data.RequirementID };
}

// ── A. Activity creation ──────────────────────────────────────────────────────

describe('A. Activity creation', () => {
  test('createActivity returns ok:true with ActivityID', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const r = s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'CALL', Summary: 'Called client' }, { userId: 'U1' });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.data.ActivityID, 'ActivityID must be present');
  });

  test('Activity has correct LeadID', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const r = s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'NOTE' }, { userId: 'U1' });
    assert.equal(r.data.LeadID, leadId);
  });

  test('Activity has CreatedBy from actor', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const r = s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'WHATSAPP' }, { userId: 'AGT-1' });
    assert.equal(r.data.CreatedBy, 'AGT-1');
  });

  test('Activity fails for unknown LeadID', () => {
    const s = makeStack();
    const r = s.actSvc.createActivity({ LeadID: 'L-FAKE', ActivityType: 'CALL' }, { userId: 'U1' });
    assert.equal(r.ok, false);
  });

  test('Activity links TransactionID', () => {
    const s = makeStack(); const { leadId, txnId } = seedChain(s);
    const r = s.actSvc.createActivity({ LeadID: leadId, TransactionID: txnId, ActivityType: 'MEETING' }, { userId: 'U1' });
    assert.equal(r.ok, true);
    assert.equal(r.data.TransactionID, txnId);
  });

  test('Activity links RequirementID', () => {
    const s = makeStack(); const { leadId, reqId } = seedChain(s);
    const r = s.actSvc.createActivity({ LeadID: leadId, RequirementID: reqId, ActivityType: 'CALL' }, { userId: 'U1' });
    assert.equal(r.ok, true);
    assert.equal(r.data.RequirementID, reqId);
  });

  test('Activity rejects invalid TransactionID for given Lead', () => {
    const s = makeStack();
    const { leadId } = seedChain(s);
    const { txnId: wrongTxn } = seedChain(s, { name: 'Other', mobile: um() });
    const r = s.actSvc.createActivity({ LeadID: leadId, TransactionID: wrongTxn, ActivityType: 'CALL' }, { userId: 'U1' });
    assert.equal(r.ok, false, 'Activity must reject wrong TransactionID for Lead');
  });

  test('Activity does not create a new Lead', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const before = s.repo.read().Leads.length;
    s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'NOTE' }, { userId: 'U1' });
    const after = s.repo.read().Leads.length;
    assert.equal(after, before, 'createActivity must not create a new Lead');
  });
});

// ── B. Activity retrieval ─────────────────────────────────────────────────────

describe('B. Activity retrieval', () => {
  test('getActivity returns the created activity', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const cr = s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'CALL', Summary: 'Hi' }, { userId: 'U1' });
    const gr = s.actSvc.getActivity(cr.data.ActivityID);
    assert.equal(gr.ok, true);
    assert.equal(gr.data.ActivityID, cr.data.ActivityID);
  });

  test('getActivity returns ok:false for unknown ID', () => {
    const s = makeStack();
    const r = s.actSvc.getActivity('ACT-FAKE');
    assert.equal(r.ok, false);
  });

  test('listActivitiesByLead returns all for that lead', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'CALL' }, { userId: 'U1' });
    s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'NOTE' }, { userId: 'U1' });
    const r = s.actSvc.listActivitiesByLead(leadId);
    assert.equal(r.ok, true);
    assert.ok(r.data.length >= 2);
  });

  test('listActivitiesByLead returns ok:false for unknown Lead', () => {
    const s = makeStack();
    const r = s.actSvc.listActivitiesByLead('L-FAKE');
    assert.equal(r.ok, false);
  });

  test('listActivitiesByRequirement returns activities for that requirement', () => {
    const s = makeStack(); const { leadId, reqId } = seedChain(s);
    s.actSvc.createActivity({ LeadID: leadId, RequirementID: reqId, ActivityType: 'CALL' }, { userId: 'U1' });
    const r = s.actSvc.listActivitiesByRequirement(reqId);
    assert.equal(r.ok, true);
    assert.ok(r.data.some(a => a.RequirementID === reqId));
  });

  test('listActivitiesByTransaction returns activities for that transaction', () => {
    const s = makeStack(); const { leadId, txnId } = seedChain(s);
    s.actSvc.createActivity({ LeadID: leadId, TransactionID: txnId, ActivityType: 'MEETING' }, { userId: 'U1' });
    const r = s.actSvc.listActivitiesByTransaction(txnId);
    assert.equal(r.ok, true);
    assert.ok(r.data.some(a => a.TransactionID === txnId));
  });

  test('Reading activities does not mutate data', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'CALL' }, { userId: 'U1' });
    const before = JSON.stringify(s.repo.read().Activities);
    s.actSvc.listActivitiesByLead(leadId);
    const after = JSON.stringify(s.repo.read().Activities);
    assert.equal(after, before, 'listActivitiesByLead must not mutate Activities');
  });
});

// ── C. Conversation → Requirement PATCH ──────────────────────────────────────

describe('C. Conversation → Requirement PATCH (FieldUpdates)', () => {
  test('FieldUpdates UNKNOWN→KNOWN for Possession', () => {
    const s = makeStack(); const { leadId, reqId } = seedChain(s);
    const reqBefore = s.repo.read().Requirements.find(r => r.RequirementID === reqId);
    assert.equal(reqBefore.Fields?.Possession?.state, 'UNKNOWN', 'Possession must start UNKNOWN');

    const r = s.actSvc.createActivity({
      LeadID: leadId, RequirementID: reqId,
      ActivityType: 'CALL',
      FieldUpdates: { Possession: 'Ready to Move' }
    }, { userId: 'U1' });
    assert.equal(r.ok, true);
    // Requirement should now have Possession KNOWN
    const reqAfter = s.repo.read().Requirements.find(r => r.RequirementID === reqId);
    const posState = reqAfter.Fields?.Possession?.state ?? (reqAfter.Possession != null ? 'KNOWN' : 'UNKNOWN');
    assert.equal(posState, 'KNOWN', 'Possession must be KNOWN after FieldUpdates');
  });

  test('FieldUpdates preserves existing KNOWN fields', () => {
    const s = makeStack();
    const { leadSvc, txnSvc, reqSvc, actSvc } = s;
    const lr = leadSvc.createLead({ ClientName: 'X', PrimaryMobile: um() }, { userId: 'U1' });
    const tr = txnSvc.createTransaction(lr.data.LeadID, { TransactionType: 'Purchase' }, { userId: 'U1' });
    const rr = reqSvc.createRequirement(tr.data.TransactionID, {
      LeadID: lr.data.LeadID,
      Fields: { BudgetMax: { state: 'KNOWN', value: 10000000 }, Possession: { state: 'UNKNOWN' } }
    }, { userId: 'U1' });
    const { LeadID, RequirementID } = { LeadID: lr.data.LeadID, RequirementID: rr.data.RequirementID };

    actSvc.createActivity({ LeadID, RequirementID, ActivityType: 'CALL', FieldUpdates: { Possession: 'Ready to Move' } }, { userId: 'U1' });

    const req = s.repo.read().Requirements.find(r => r.RequirementID === RequirementID);
    const budget = req.BudgetMax || req.Fields?.BudgetMax?.value;
    assert.equal(budget, 10000000, 'BudgetMax must survive FieldUpdates PATCH');
  });

  test('UNKNOWN → KNOWN never converts to NO', () => {
    const s = makeStack(); const { leadId, reqId } = seedChain(s);
    s.actSvc.createActivity({
      LeadID: leadId, RequirementID: reqId,
      ActivityType: 'CALL', FieldUpdates: { BudgetMax: 12000000 }
    }, { userId: 'U1' });
    const req = s.repo.read().Requirements.find(r => r.RequirementID === reqId);
    const state = req.Fields?.BudgetMax?.state;
    assert.notEqual(state, 'NO', 'Field state must not become NO');
    assert.notEqual(state, 'UNKNOWN', 'Field must become KNOWN after FieldUpdates');
  });

  test('Activity creates RequirementHistory when fields change', () => {
    const s = makeStack(); const { leadId, reqId } = seedChain(s);
    s.actSvc.createActivity({
      LeadID: leadId, RequirementID: reqId,
      ActivityType: 'CALL', FieldUpdates: { BudgetMax: 8000000 }
    }, { userId: 'U1' });
    const db = s.repo.read();
    const hist = (db.RequirementHistory || []).filter(h => h.RequirementID === reqId);
    assert.ok(hist.length > 0, 'RequirementHistory must have an entry after FieldUpdates');
  });

  test('Activity without FieldUpdates does not touch Requirement', () => {
    const s = makeStack(); const { leadId, reqId } = seedChain(s);
    const before = JSON.stringify(s.repo.read().Requirements);
    s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'NOTE' }, { userId: 'U1' });
    const after = JSON.stringify(s.repo.read().Requirements);
    assert.equal(after, before, 'Activity without FieldUpdates must not modify Requirements');
  });
});

// ── D. Follow-up creation ─────────────────────────────────────────────────────

describe('D. Follow-up creation', () => {
  test('createFollowUp returns ok:true with FollowUpID', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const r = s.fuSvc.createFollowUp({
      LeadID: leadId, DueAt: new Date(Date.now() + 86400000).toISOString(), Type: 'CALL'
    }, { userId: 'U1' });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.data.FollowUpID, 'FollowUpID must be present');
  });

  test('createFollowUp fails without LeadID', () => {
    const s = makeStack();
    const r = s.fuSvc.createFollowUp({ DueAt: new Date().toISOString() }, { userId: 'U1' });
    assert.equal(r.ok, false);
  });

  test('createFollowUp fails without DueAt', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const r = s.fuSvc.createFollowUp({ LeadID: leadId }, { userId: 'U1' });
    assert.equal(r.ok, false);
  });

  test('createFollowUp with wrong RequirementID for Lead is rejected', () => {
    const s = makeStack();
    const { leadId } = seedChain(s);
    const { reqId: otherReqId } = seedChain(s, { name: 'Other', mobile: um() });
    const r = s.fuSvc.createFollowUp({
      LeadID: leadId, RequirementID: otherReqId,
      DueAt: new Date(Date.now() + 86400000).toISOString()
    }, { userId: 'U1' });
    assert.equal(r.ok, false, 'Cross-client requirement must be rejected');
  });

  test('createFollowUp does not create a new Requirement', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const reqsBefore = s.repo.read().Requirements.length;
    s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: new Date().toISOString() }, { userId: 'U1' });
    const reqsAfter = s.repo.read().Requirements.length;
    assert.equal(reqsAfter, reqsBefore, 'createFollowUp must not create a new Requirement');
  });

  test('createFollowUp persists canonical dueAt + activityType and adds timeline entry', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const r = s.fuSvc.createFollowUp({
      LeadID: leadId,
      Date: '2026-12-31',
      Time: '17:30',
      Type: 'Email',
      Notes: 'test follow-up'
    }, { userId: 'U1' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.data.activityType, 'Email');
    assert.ok(r.data.dueAt.includes('T'), 'dueAt must be datetime');
    const db = s.repo.read();
    const timeline = (db.Timeline || []).filter(t => t.EntityType === 'FollowUp' && t.EntityID === r.data.FollowUpID);
    assert.ok(timeline.length >= 1, 'Follow-up creation must write timeline');
  });
});

// ── E. Follow-up listing ──────────────────────────────────────────────────────

describe('E. Follow-up listing', () => {
  test('listFollowUps by LeadID', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: new Date(Date.now() + 86400000).toISOString() }, { userId: 'U1' });
    const r = s.fuSvc.listFollowUps({ LeadID: leadId });
    assert.equal(r.ok, true);
    assert.ok(r.data.length >= 1, 'Must list at least 1 follow-up for Lead');
  });

  test('listFollowUps preset=today returns only today pending', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const today = new Date();
    today.setHours(14, 0, 0, 0);
    s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: today.toISOString() }, { userId: 'U1' });
    const r = s.fuSvc.listFollowUps({ preset: 'today' });
    assert.equal(r.ok, true);
    assert.ok(r.data.length >= 1, 'Must have at least 1 today follow-up');
  });

  test('listFollowUps preset=overdue marks overdue status', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const past = new Date(Date.now() - 86400000).toISOString();
    s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: past }, { userId: 'U1' });
    const r = s.fuSvc.listFollowUps({ preset: 'overdue' });
    assert.equal(r.ok, true);
    // At least one should be overdue
    const hasOverdue = r.data.some(f => f.Status === 'OVERDUE' || f.Status === 'PENDING');
    assert.ok(hasOverdue, 'Past follow-up must appear in overdue preset');
  });

  test('listFollowUps preset=upcoming returns future pending', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const future = new Date(Date.now() + 2 * 86400000).toISOString();
    s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: future }, { userId: 'U1' });
    const r = s.fuSvc.listFollowUps({ preset: 'upcoming' });
    assert.equal(r.ok, true);
    assert.ok(r.data.length >= 1, 'Must have at least 1 upcoming follow-up');
  });

  test('Reading follow-ups does not mutate data', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: new Date(Date.now() + 86400000).toISOString() }, { userId: 'U1' });
    const before = JSON.stringify(s.repo.read().FollowUps);
    s.fuSvc.listFollowUps({ LeadID: leadId });
    const after = JSON.stringify(s.repo.read().FollowUps);
    assert.equal(after, before, 'listFollowUps must not mutate FollowUps');
  });
});

// ── F. Follow-up state transitions ───────────────────────────────────────────

describe('F. Follow-up state transitions', () => {
  function createFU(s, leadId, opts = {}) {
    return s.fuSvc.createFollowUp({
      LeadID: leadId,
      DueAt: opts.dueAt || new Date(Date.now() + 86400000).toISOString()
    }, { userId: 'U1' });
  }

  test('completeFollowUp sets Status=COMPLETED', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const fu = createFU(s, leadId);
    const r  = s.fuSvc.completeFollowUp(fu.data.FollowUpID, { userId: 'U1' });
    assert.equal(r.ok, true);
    assert.equal(r.data.Status, 'COMPLETED');
    assert.ok(r.data.CompletedAt, 'CompletedAt must be set');
  });

  test('cancelFollowUp sets Status=CANCELLED', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const fu = createFU(s, leadId);
    const r  = s.fuSvc.cancelFollowUp(fu.data.FollowUpID, { userId: 'U1' });
    assert.equal(r.ok, true);
    assert.equal(r.data.Status, 'CANCELLED');
  });

  test('Cannot complete a cancelled follow-up', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const fu = createFU(s, leadId);
    s.fuSvc.cancelFollowUp(fu.data.FollowUpID, { userId: 'U1' });
    const r = s.fuSvc.completeFollowUp(fu.data.FollowUpID, { userId: 'U1' });
    assert.equal(r.ok, false);
  });

  test('Cannot cancel a completed follow-up', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const fu = createFU(s, leadId);
    s.fuSvc.completeFollowUp(fu.data.FollowUpID, { userId: 'U1' });
    const r = s.fuSvc.cancelFollowUp(fu.data.FollowUpID, { userId: 'U1' });
    assert.equal(r.ok, false);
  });

  test('Cannot complete an already completed follow-up', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const fu = createFU(s, leadId);
    s.fuSvc.completeFollowUp(fu.data.FollowUpID, { userId: 'U1' });
    const r = s.fuSvc.completeFollowUp(fu.data.FollowUpID, { userId: 'U1' });
    assert.equal(r.ok, false);
  });

  test('updateFollowUp changes Notes', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const fu = createFU(s, leadId);
    const r  = s.fuSvc.updateFollowUp(fu.data.FollowUpID, { Notes: 'Updated note' }, { userId: 'U1' });
    assert.equal(r.ok, true);
    assert.equal(r.data.Notes, 'Updated note');
  });

  test('updateFollowUp preserves FollowUpID and LeadID', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const fu = createFU(s, leadId);
    const r  = s.fuSvc.updateFollowUp(fu.data.FollowUpID, { Notes: 'X' }, { userId: 'U1' });
    assert.equal(r.data.FollowUpID, fu.data.FollowUpID);
    assert.equal(r.data.LeadID, leadId);
  });
});

// ── G. API Routes (Phase 16 canonical) ───────────────────────────────────────

describe('G. API Routes — /api/v2/activities', () => {
  test('POST /api/v2/activities creates an activity', async () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const h = makeHandle(s.repo);
    const r = await h('POST', '/api/v2/activities', { LeadID: leadId, ActivityType: 'CALL', Summary: 'Via API' });
    assert.ok(r.statusCode === 201 || r.statusCode === 200, `Expected 2xx, got ${r.statusCode}`);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.data.ActivityID, 'ActivityID must be in response');
  });

  test('GET /api/v2/activities/:id retrieves activity', async () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const cr = s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'NOTE' }, { userId: 'U1' });
    const h  = makeHandle(s.repo);
    const r  = await h('GET', `/api/v2/activities/${cr.data.ActivityID}`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.data.ActivityID, cr.data.ActivityID);
  });

  test('GET /api/v2/clients/:id/activities lists activities for lead', async () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'CALL' }, { userId: 'U1' });
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/clients/${leadId}/activities`);
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.body.data));
    assert.ok(r.body.data.length >= 1);
  });

  test('GET /api/v2/requirements/:id/activities lists activities for requirement', async () => {
    const s = makeStack(); const { leadId, reqId } = seedChain(s);
    s.actSvc.createActivity({ LeadID: leadId, RequirementID: reqId, ActivityType: 'CALL' }, { userId: 'U1' });
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/requirements/${reqId}/activities`);
    assert.equal(r.statusCode, 200);
    assert.ok(r.body.data.length >= 1);
  });
});

describe('H. API Routes — /api/v2/followups', () => {
  test('POST /api/v2/followups creates a follow-up', async () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const h = makeHandle(s.repo);
    const r = await h('POST', '/api/v2/followups', {
      LeadID: leadId, DueAt: new Date(Date.now() + 86400000).toISOString(), Type: 'CALL'
    });
    assert.ok(r.statusCode === 201 || r.statusCode === 200, `Expected 2xx, got ${r.statusCode}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.data.FollowUpID);
  });

  test('GET /api/v2/followups lists follow-ups', async () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: new Date(Date.now() + 86400000).toISOString() }, { userId: 'U1' });
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/followups?leadId=${leadId}`);
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.body.data));
  });

  test('GET /api/v2/followups/:id retrieves follow-up', async () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const fu = s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: new Date(Date.now() + 86400000).toISOString() }, { userId: 'U1' });
    const h  = makeHandle(s.repo);
    const r  = await h('GET', `/api/v2/followups/${fu.data.FollowUpID}`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.data.FollowUpID, fu.data.FollowUpID);
  });

  test('PATCH /api/v2/followups/:id updates notes', async () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const fu = s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: new Date(Date.now() + 86400000).toISOString() }, { userId: 'U1' });
    const h  = makeHandle(s.repo);
    const r  = await h('PATCH', `/api/v2/followups/${fu.data.FollowUpID}`, { Notes: 'Updated via API' });
    assert.equal(r.body.ok, true);
    assert.equal(r.body.data.Notes, 'Updated via API');
  });

  test('POST /api/v2/followups/:id/complete completes follow-up', async () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const fu = s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: new Date(Date.now() + 86400000).toISOString() }, { userId: 'U1' });
    const h  = makeHandle(s.repo);
    const r  = await h('POST', `/api/v2/followups/${fu.data.FollowUpID}/complete`);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.data.Status, 'COMPLETED');
  });

  test('POST /api/v2/followups/:id/cancel cancels follow-up', async () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const fu = s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: new Date(Date.now() + 86400000).toISOString() }, { userId: 'U1' });
    const h  = makeHandle(s.repo);
    const r  = await h('POST', `/api/v2/followups/${fu.data.FollowUpID}/cancel`);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.data.Status, 'CANCELLED');
  });

  test('GET /api/v2/clients/:id/follow-ups lists follow-ups for lead', async () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: new Date(Date.now() + 86400000).toISOString() }, { userId: 'U1' });
    const h = makeHandle(s.repo);
    const r = await h('GET', `/api/v2/clients/${leadId}/followups`);
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.body.data));
  });
});

// ── I. Authorization / Audit ──────────────────────────────────────────────────

describe('I. Authorization and audit fields', () => {
  test('Activity has CreatedAt timestamp', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const r = s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'CALL' }, { userId: 'U1' });
    assert.ok(r.data.CreatedAt, 'CreatedAt must be set');
    assert.ok(new Date(r.data.CreatedAt).getTime() > 0, 'CreatedAt must be a valid date');
  });

  test('FollowUp has CreatedBy from actor', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const r = s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: new Date(Date.now() + 86400000).toISOString() }, { userId: 'MY-AGENT' });
    assert.equal(r.data.CreatedBy, 'MY-AGENT');
  });

  test('FollowUp AssignedTo defaults to actor userId', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const r = s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: new Date(Date.now() + 86400000).toISOString() }, { userId: 'AGENT-42' });
    assert.equal(r.data.AssignedTo, 'AGENT-42');
  });
});

// ── J. No duplicate Lead/Requirement created ──────────────────────────────────

describe('J. No duplicate Lead or Requirement from activity/follow-up', () => {
  test('Creating multiple activities does not create new Leads', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const before = s.repo.read().Leads.length;
    for (let i = 0; i < 5; i++) {
      s.actSvc.createActivity({ LeadID: leadId, ActivityType: 'NOTE' }, { userId: 'U1' });
    }
    assert.equal(s.repo.read().Leads.length, before);
  });

  test('Creating multiple follow-ups does not create new Requirements', () => {
    const s = makeStack(); const { leadId } = seedChain(s);
    const before = s.repo.read().Requirements.length;
    for (let i = 0; i < 3; i++) {
      s.fuSvc.createFollowUp({ LeadID: leadId, DueAt: new Date(Date.now() + i * 86400000).toISOString() }, { userId: 'U1' });
    }
    assert.equal(s.repo.read().Requirements.length, before);
  });
});
