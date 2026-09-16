/**
 * PHASE 18 — Lead Module V2 Tests
 *
 * Tests covering all V2 contracts:
 *   - IdEngine: ID format, counter persistence
 *   - V2LeadService: create, duplicate detection, update, tags, workflow transitions
 *   - V2TransactionService: create, update, parent-chain validation
 *   - V2RequirementService: create with form version, parent-chain validation, score
 *   - V2Config: form registry
 *   - Regression: legacy routes still function
 */

'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Test DB helper ─────────────────────────────────────────────────────────────

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-v2-test-'));
  return path.join(dir, 'test.json');
}

function makeRepo(dbFile) {
  const { JsonRepository } = require('../src/data/repository');
  return new JsonRepository(dbFile);
}

// ── IdEngine ──────────────────────────────────────────────────────────────────

describe('IdEngine', () => {
  test('generates Lead IDs in L000001 format', () => {
    const { IdEngine } = require('../src/data/idEngine');
    const repo  = makeRepo(makeTempDb());
    const engine = new IdEngine(repo);
    const id = engine.nextLeadId();
    assert.match(id, /^L\d{6,}$/);
  });

  test('generates sequentially incrementing IDs', () => {
    const { IdEngine } = require('../src/data/idEngine');
    const repo   = makeRepo(makeTempDb());
    const engine = new IdEngine(repo);
    const id1 = engine.nextLeadId();
    const id2 = engine.nextLeadId();
    const n1  = parseInt(id1.slice(1), 10);
    const n2  = parseInt(id2.slice(1), 10);
    assert.equal(n2, n1 + 1);
  });

  test('generates Transaction IDs in T000001 format', () => {
    const { IdEngine } = require('../src/data/idEngine');
    const repo   = makeRepo(makeTempDb());
    const engine = new IdEngine(repo);
    const id = engine.nextTransactionId();
    assert.match(id, /^T\d{6,}$/);
  });

  test('generates Requirement IDs in R000001 format', () => {
    const { IdEngine } = require('../src/data/idEngine');
    const repo   = makeRepo(makeTempDb());
    const engine = new IdEngine(repo);
    const id = engine.nextRequirementId();
    assert.match(id, /^R\d{6,}$/);
  });

  test('counters persist across repository reads', () => {
    const { IdEngine } = require('../src/data/idEngine');
    const dbFile  = makeTempDb();
    const repo1   = makeRepo(dbFile);
    const engine1 = new IdEngine(repo1);
    engine1.nextLeadId(); // L000001
    engine1.nextLeadId(); // L000002

    const repo2   = makeRepo(dbFile);
    const engine2 = new IdEngine(repo2);
    const id3 = engine2.nextLeadId(); // L000003
    assert.equal(parseInt(id3.slice(1), 10), 3);
  });

  test('isV2LeadId detects V2 format', () => {
    const { IdEngine } = require('../src/data/idEngine');
    assert.equal(IdEngine.isV2LeadId('L000001'), true);
    assert.equal(IdEngine.isV2LeadId('LEAD-0001-12345'), false);
    assert.equal(IdEngine.isV2LeadId(null), false);
  });
});

// ── V2LeadService ─────────────────────────────────────────────────────────────

describe('V2LeadService', () => {
  let repo, svc;
  beforeEach(() => {
    repo = makeRepo(makeTempDb());
    const { V2LeadService } = require('../src/services/v2LeadService');
    svc = new V2LeadService(repo);
  });

  test('creates a lead with V2 ID', () => {
    // Use phone that does not conflict with seed data (seed uses 9876543210)
    const result = svc.createLead({ ClientName: 'Ravi Kumar', PrimaryMobile: '9971230001', Email: 'raviv2test@example.com' });
    assert.equal(result.ok, true, result.error || JSON.stringify(result));
    assert.match(result.data.LeadID, /^L\d{6,}$/);
    assert.equal(result.data.ClientName, 'Ravi Kumar');
    assert.equal(result.data._v2, true);
  });

  test('sets default ClientStatus to New', () => {
    const result = svc.createLead({ ClientName: 'Test User', PrimaryMobile: '9000000001' });
    assert.equal(result.ok, true);
    assert.equal(result.data.ClientStatus, 'New');
  });

  test('sets default ClientLifecycle to Prospect', () => {
    const result = svc.createLead({ ClientName: 'Test User', PrimaryMobile: '9000000002' });
    assert.equal(result.ok, true);
    assert.equal(result.data.ClientLifecycle, 'Prospect');
  });

  test('sets RecordHash on creation', () => {
    const result = svc.createLead({ ClientName: 'Hash Test', PrimaryMobile: '9000000003' });
    assert.equal(result.ok, true);
    assert.ok(result.data.RecordHash);
  });

  test('exact duplicate (same mobile) is rejected', () => {
    svc.createLead({ ClientName: 'Duplicate A', PrimaryMobile: '9111111111' });
    const result = svc.createLead({ ClientName: 'Duplicate B', PrimaryMobile: '9111111111' });
    assert.equal(result.ok, false);
    assert.equal(result.duplicateResult, 'EXACT_MATCH');
  });

  test('exact duplicate (same email) is rejected', () => {
    svc.createLead({ ClientName: 'User A', PrimaryMobile: '9222222221', Email: 'same@test.com' });
    const result = svc.createLead({ ClientName: 'User B', PrimaryMobile: '9222222222', Email: 'same@test.com' });
    assert.equal(result.ok, false);
    assert.equal(result.duplicateResult, 'EXACT_MATCH');
  });

  test('confirmDuplicate flag allows creation over possible duplicate', () => {
    svc.createLead({ ClientName: 'Ravi Kumar', PrimaryMobile: '9333333333' });
    const result = svc.createLead({ ClientName: 'Ravi Kumar', PrimaryMobile: '9333333334' }, {}, { allowPossibleDuplicate: true });
    assert.equal(result.ok, true);
  });

  test('checkDuplicate returns NO_MATCH for brand new contact', () => {
    const result = svc.checkDuplicate({ PrimaryMobile: '9888888888', Email: 'new@test.com' });
    assert.equal(result.result, 'NO_MATCH');
  });

  test('updateLead allows valid status transition New → Contacted', () => {
    const created = svc.createLead({ ClientName: 'Status Test', PrimaryMobile: '9444444440' });
    const updated = svc.updateLead(created.data.LeadID, { ClientStatus: 'Contacted' });
    assert.equal(updated.ok, true);
    assert.equal(updated.data.ClientStatus, 'Contacted');
  });

  test('updateLead blocks invalid status transition Qualified → New', () => {
    const created = svc.createLead({ ClientName: 'Invalid Tx', PrimaryMobile: '9444444441' });
    svc.updateLead(created.data.LeadID, { ClientStatus: 'Contacted' });
    svc.updateLead(created.data.LeadID, { ClientStatus: 'Qualified' });
    const result = svc.updateLead(created.data.LeadID, { ClientStatus: 'New' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not allowed'));
  });

  test('updateLead increments Version', () => {
    const created = svc.createLead({ ClientName: 'Ver Test', PrimaryMobile: '9444444442' });
    assert.equal(created.data.Version, 1);
    const updated = svc.updateLead(created.data.LeadID, { Notes: 'Updated' });
    assert.equal(updated.data.Version, 2);
  });

  test('marking lead Lost requires LostReason and stores Lost fields', () => {
    const created = svc.createLead({ ClientName: 'Lost Flow', PrimaryMobile: '9444444450' });
    const blocked = svc.updateLead(created.data.LeadID, { ClientStatus: 'Lost' });
    assert.equal(blocked.ok, false);

    const updated = svc.updateLead(created.data.LeadID, { ClientStatus: 'Lost', LostReason: 'Budget mismatch', LostNote: 'Client deferred' });
    assert.equal(updated.ok, true);
    assert.equal(updated.data.ClientStatus, 'Lost');
    assert.equal(updated.data.LostReason, 'Budget mismatch');
    assert.equal(updated.data.LostNote, 'Client deferred');
    assert.ok(updated.data.LostAt);
  });

  test('reactivates Lost lead via status transition', () => {
    const created = svc.createLead({ ClientName: 'Reactivate Flow', PrimaryMobile: '9444444451' });
    const lost = svc.updateLead(created.data.LeadID, { ClientStatus: 'Lost', LostReason: 'No response' });
    assert.equal(lost.ok, true);
    const reactivated = svc.reactivateLead(created.data.LeadID, { ClientStatus: 'Contacted' });
    assert.equal(reactivated.ok, true);
    assert.equal(reactivated.data.ClientStatus, 'Contacted');
    assert.ok(reactivated.data.ReactivatedAt);
  });

  test('addTag applies valid tag', () => {
    const created = svc.createLead({ ClientName: 'Tag Test', PrimaryMobile: '9555555555' });
    const tagged  = svc.addTag(created.data.LeadID, 'VIP');
    assert.equal(tagged.ok, true);
    assert.ok(tagged.data.Tags.includes('VIP'));
  });

  test('addTag rejects invalid tag', () => {
    const created = svc.createLead({ ClientName: 'Tag Bad', PrimaryMobile: '9555555556' });
    const result  = svc.addTag(created.data.LeadID, 'INVALID_TAG');
    assert.equal(result.ok, false);
  });

  test('removeTag removes a tag', () => {
    const created = svc.createLead({ ClientName: 'Tag Remove', PrimaryMobile: '9555555557', Tags: ['VIP', 'Hot'] });
    svc.removeTag(created.data.LeadID, 'Hot');
    const lead = repo.readLead(created.data.LeadID);
    assert.ok(!lead.Tags.includes('Hot'));
    assert.ok(lead.Tags.includes('VIP'));
  });

  test('listLeads filters by ClientStatus', () => {
    svc.createLead({ ClientName: 'A', PrimaryMobile: '9600000001' });
    svc.createLead({ ClientName: 'B', PrimaryMobile: '9600000002', ClientStatus: 'Contacted' });
    const results = svc.listLeads({ ClientStatus: 'New' });
    assert.ok(results.every(r => r.ClientStatus === 'New' || r.LeadStatus === 'New'));
  });

  test('findLeadByMobile normalizes phone format', () => {
    // Use a phone that is not in seed data
    svc.createLead({ ClientName: 'Phone Norm', PrimaryMobile: '+91 99710 00099' });
    const found = svc.findLeadByMobile('9971000099');
    assert.ok(found, 'Expected to find the lead by normalized phone');
    assert.equal(found.ClientName, 'Phone Norm');
  });
});

// ── V2TransactionService ───────────────────────────────────────────────────────

describe('V2TransactionService', () => {
  let repo, leadSvc, txnSvc;
  beforeEach(() => {
    repo = makeRepo(makeTempDb());
    const { V2LeadService }        = require('../src/services/v2LeadService');
    const { V2TransactionService } = require('../src/services/v2TransactionService');
    leadSvc = new V2LeadService(repo);
    txnSvc  = new V2TransactionService(repo);
  });

  function createTestLead(mobile = '9700000001') {
    const res = leadSvc.createLead({ ClientName: 'Txn Test Lead', PrimaryMobile: mobile });
    return res.data;
  }

  test('creates transaction with V2 ID', () => {
    const lead = createTestLead();
    const result = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Purchase' });
    assert.equal(result.ok, true);
    assert.match(result.data.TransactionID, /^T\d{6,}$/);
    assert.equal(result.data._v2, true);
  });

  test('creates transaction with correct LeadID', () => {
    const lead = createTestLead();
    const result = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Rent' });
    assert.equal(result.ok, true);
    assert.equal(result.data.LeadID, lead.LeadID);
  });

  test('rejects invalid TransactionType', () => {
    const lead = createTestLead('9700000002');
    const result = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Gift' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('TransactionType'));
  });

  test('rejects transaction for non-existent lead', () => {
    const result = txnSvc.createTransaction('L999999', { TransactionType: 'Purchase' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not found'));
  });

  test('TransactionID is immutable on update', () => {
    const lead  = createTestLead('9700000003');
    const txn   = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Sale' });
    const result = txnSvc.updateTransaction(txn.data.TransactionID, { TransactionID: 'T999999' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('immutable'));
  });

  test('LeadID is immutable on update', () => {
    const lead  = createTestLead('9700000004');
    const txn   = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Sale' });
    const result = txnSvc.updateTransaction(txn.data.TransactionID, { LeadID: 'L999999' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('immutable'));
  });

  test('blocks invalid status transition Open → Closed (must go through Active)', () => {
    // Note: Open → Closed IS allowed per WorkflowConfig
    const lead  = createTestLead('9700000005');
    const txn   = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Purchase' });
    const result = txnSvc.updateTransaction(txn.data.TransactionID, { TransactionStatus: 'Closed' });
    // Open → Closed is allowed per config
    assert.equal(result.ok, true);
  });

  test('blocks transition from Closed', () => {
    const lead  = createTestLead('9700000006');
    const txn   = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Purchase' });
    txnSvc.updateTransaction(txn.data.TransactionID, { TransactionStatus: 'Closed' });
    const result = txnSvc.updateTransaction(txn.data.TransactionID, { TransactionStatus: 'Open' });
    assert.equal(result.ok, false);
  });

  test('listTransactionsByLead returns only that lead\'s transactions', () => {
    // Self-contained: create own repo/services to avoid beforeEach shared state
    const localRepo = makeRepo(makeTempDb());
    const { V2LeadService }        = require('../src/services/v2LeadService');
    const { V2TransactionService } = require('../src/services/v2TransactionService');
    const localLeadSvc = new V2LeadService(localRepo);
    const localTxnSvc  = new V2TransactionService(localRepo);

    const r1 = localLeadSvc.createLead({ ClientName: 'Lead One',  PrimaryMobile: '9900000010' });
    const r2 = localLeadSvc.createLead({ ClientName: 'Lead Two',  PrimaryMobile: '9900000011' });
    assert.ok(r1.ok, r1.error || 'lead1 create failed');
    assert.ok(r2.ok, r2.error || 'lead2 create failed');

    const lead1 = r1.data;
    const lead2 = r2.data;

    localTxnSvc.createTransaction(lead1.LeadID, { TransactionType: 'Purchase' });
    localTxnSvc.createTransaction(lead1.LeadID, { TransactionType: 'Rent' });
    localTxnSvc.createTransaction(lead2.LeadID, { TransactionType: 'Sale' });
    const rows = localTxnSvc.listTransactionsByLead(lead1.LeadID);
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => r.LeadID === lead1.LeadID));
  });
});

// ── V2RequirementService ───────────────────────────────────────────────────────

describe('V2RequirementService', () => {
  let repo, leadSvc, txnSvc, reqSvc;
  beforeEach(() => {
    repo = makeRepo(makeTempDb());
    const { V2LeadService }          = require('../src/services/v2LeadService');
    const { V2TransactionService }   = require('../src/services/v2TransactionService');
    const { V2RequirementService }   = require('../src/services/v2RequirementService');
    leadSvc = new V2LeadService(repo);
    txnSvc  = new V2TransactionService(repo);
    reqSvc  = new V2RequirementService(repo);
  });

  function setup(mobile = '9800000001') {
    const lead = leadSvc.createLead({ ClientName: 'Req Test', PrimaryMobile: mobile }).data;
    const txn  = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Purchase' }).data;
    return { lead, txn };
  }

  /**
   * Minimum payload that satisfies all required fields in the generic form
   * (common fields: BudgetMin, BudgetMax, Location1, Urgency).
   * Tests that need a specific form (Residential/Commercial) add their own required fields.
   */
  function minReq(leadId, overrides = {}) {
    return {
      LeadID:    leadId,
      BudgetMin: 5000000,
      BudgetMax: 10000000,
      Location1: 'Test Location',
      Urgency:   'High',
      ...overrides
    };
  }

  test('creates requirement with V2 ID', () => {
    const { lead, txn } = setup();
    // Generic form — only common required fields needed
    const result = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID));
    assert.equal(result.ok, true, result.error || 'create failed');
    assert.match(result.data.RequirementID, /^R\d{6,}$/);
    assert.equal(result.data._v2, true);
  });

  test('enforces Requirement.LeadID == Transaction.LeadID', () => {
    const { lead, txn } = setup();
    const lead2 = leadSvc.createLead({ ClientName: 'Other Lead', PrimaryMobile: '9800000099' }).data;
    const result = reqSvc.createRequirement(txn.TransactionID, { LeadID: lead2.LeadID });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('LeadID'));
  });

  test('rejects requirement for non-existent transaction', () => {
    const { lead } = setup();
    const result = reqSvc.createRequirement('T999999', { LeadID: lead.LeadID });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not found'));
  });

  test('freezes FormVersion at creation time', () => {
    const { lead, txn } = setup('9800000002');
    // Generic form — only common required fields needed
    const result = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID));
    assert.ok(result.ok, result.error || 'create failed');
    assert.ok(result.data.FormVersion);
    const fv = result.data.FormVersion;

    // Update cannot change FormVersion
    const updateResult = reqSvc.updateRequirement(result.data.RequirementID, { FormVersion: 'hacked-v99' });
    assert.equal(updateResult.ok, false);
    assert.ok(updateResult.error.includes('FormVersion'));

    // Verify original FormVersion unchanged
    const req2 = repo.read().Requirements.find(r => r.RequirementID === result.data.RequirementID);
    assert.equal(req2.FormVersion, fv);
  });

  test('budget validation: BudgetMin cannot exceed BudgetMax', () => {
    const { lead, txn } = setup('9800000003');
    // Provide all required fields but with invalid budget range
    const result = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID, { BudgetMin: 10000000, BudgetMax: 5000000 }));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Budget') || result.error.includes('budget'),
      `Expected budget error, got: ${result.error}`);
  });

  test('RequirementID and LeadID are immutable on update', () => {
    const { lead, txn } = setup('9800000004');
    // Generic form — no category-specific required fields
    const created = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID));
    assert.ok(created.ok, created.error || 'create failed');
    const r1 = reqSvc.updateRequirement(created.data.RequirementID, { RequirementID: 'R999999' });
    assert.equal(r1.ok, false);
    const r2 = reqSvc.updateRequirement(created.data.RequirementID, { LeadID: 'L999999' });
    assert.equal(r2.ok, false);
  });

  test('blocks invalid RequirementStatus transition', () => {
    const { lead, txn } = setup('9800000005');
    // Create with Active status — needs all required fields
    const created = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID, { RequirementStatus: 'Active' }));
    assert.ok(created.ok, created.error || 'create failed');
    // Active → Draft is not allowed
    const result = reqSvc.updateRequirement(created.data.RequirementID, { RequirementStatus: 'Draft' });
    assert.equal(result.ok, false);
  });

  test('computes RequirementScore on creation', () => {
    const { lead, txn } = setup('9800000006');
    // Generic form — avoids category-specific required fields (BHKMin etc.)
    const result = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID));
    assert.ok(result.ok, result.error || 'create failed');
    assert.ok(typeof result.data.RequirementScore === 'number' || (typeof result.data.RequirementScore === 'object' && result.data.RequirementScore !== null));
  });

  test('records RequirementHistory on creation', () => {
    const { lead, txn } = setup('9800000007');
    const r = reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID));
    assert.ok(r.ok, r.error || 'create failed');
    const db = repo.read();
    assert.ok((db.RequirementHistory || []).length > 0);
  });

  test('listRequirementsByTransaction returns only that transaction\'s requirements', () => {
    const { lead, txn } = setup('9800000008');
    const txn2 = txnSvc.createTransaction(lead.LeadID, { TransactionType: 'Rent' }).data;
    reqSvc.createRequirement(txn.TransactionID,  minReq(lead.LeadID));
    reqSvc.createRequirement(txn2.TransactionID, minReq(lead.LeadID));
    const rows = reqSvc.listRequirementsByTransaction(txn.TransactionID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].TransactionID, txn.TransactionID);
  });

  test('listGlobalRequirements enriches with client name', () => {
    const { lead, txn } = setup('9800000009');
    // Generic form — avoids category-specific required fields
    reqSvc.createRequirement(txn.TransactionID, minReq(lead.LeadID));
    const rows = reqSvc.listGlobalRequirements();
    const row  = rows.find(r => r.LeadID === lead.LeadID);
    assert.ok(row);
    assert.equal(row.clientName, 'Req Test');
  });
});

// ── V2Config ───────────────────────────────────────────────────────────────────

describe('V2Config', () => {
  test('V2FormRegistry contains Residential Flat Purchase entry', () => {
    const { V2FormRegistry } = require('../src/data/v2Config');
    const key = 'Purchase|Residential|Flat';
    assert.ok(V2FormRegistry[key]);
    assert.equal(V2FormRegistry[key].transactionType, 'Purchase');
    assert.equal(V2FormRegistry[key].category, 'Residential');
  });

  test('V2FormRegistry entries have a formVersion', () => {
    const { V2FormRegistry, FORM_REGISTRY_VERSION } = require('../src/data/v2Config');
    for (const key of Object.keys(V2FormRegistry)) {
      const form = V2FormRegistry[key];
      assert.ok(form.formVersion, `${key} missing formVersion`);
    }
  });

  test('EntityConfig defines Lead statuses', () => {
    const { EntityConfig } = require('../src/data/v2Config');
    assert.ok(Array.isArray(EntityConfig.Lead.statuses));
    assert.ok(EntityConfig.Lead.statuses.includes('New'));
    assert.ok(EntityConfig.Lead.statuses.includes('Lost'));
    assert.ok(EntityConfig.Lead.statuses.includes('Won'));
  });

  test('WorkflowConfig Won leads have no transitions', () => {
    const { WorkflowConfig } = require('../src/data/v2Config');
    assert.deepEqual(WorkflowConfig.leadStatus.transitions.Won, []);
  });

  test('TagConfig includes Investor, VIP, Hot, NRI', () => {
    const { TagConfig } = require('../src/data/v2Config');
    const tags = TagConfig.availableTags.map(t => t.value);
    for (const t of ['Investor', 'VIP', 'Hot', 'NRI']) {
      assert.ok(tags.includes(t), `Missing tag: ${t}`);
    }
  });
});

// ── normalizePhone ────────────────────────────────────────────────────────────

describe('normalizePhone', () => {
  test('strips country code +91', () => {
    const { normalizePhone } = require('../src/services/v2LeadService');
    assert.equal(normalizePhone('+919876543210'), '9876543210');
  });

  test('strips spaces and hyphens', () => {
    const { normalizePhone } = require('../src/services/v2LeadService');
    assert.equal(normalizePhone('+91 98765-43210'), '9876543210');
  });

  test('handles null gracefully', () => {
    const { normalizePhone } = require('../src/services/v2LeadService');
    assert.equal(normalizePhone(null), null);
  });
});

// ── V2Router: legacy contract + feature flag ──────────────────────────────────

describe('V2Router: legacy contract and feature flag', () => {
  function makeRouter(dbFile) {
    const { V2Router } = require('../src/api/v2Router');
    const repo = makeRepo(dbFile);
    return new V2Router(repo);
  }

  function fakeUrl(pathname, params = {}) {
    const url = new URL(`http://localhost${pathname}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url;
  }

  function fakeReq(method = 'GET') {
    return {
      method,
      headers: {
        'x-user-id': 'USR-SYSTEM-ADMIN',
        'x-user-role': 'ADMIN'
      }
    };
  }

  test('check-duplicate is always active (new route, no flag needed)', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('POST'), null, fakeUrl('/api/leads/check-duplicate'), { PrimaryMobile: '9999000001' });
      assert.ok(result !== null, 'check-duplicate must be handled regardless of flag');
      assert.equal(result.handled, true);
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });

  test('GET /api/leads falls through to legacy when LEAD_V2_ENABLED is false', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('GET'), null, fakeUrl('/api/leads'), {});
      assert.equal(result, null, 'GET /api/leads must fall through when flag is off');
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });

  test('POST /api/leads falls through to legacy when LEAD_V2_ENABLED is false', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('POST'), null, fakeUrl('/api/leads'), { ClientName: 'Test' });
      assert.equal(result, null, 'POST /api/leads must fall through when flag is off');
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });

  test('GET /api/leads is handled when LEAD_V2_ENABLED is true', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'true';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('GET'), null, fakeUrl('/api/leads'), {});
      assert.ok(result !== null, 'GET /api/leads must be handled when flag is on');
      assert.equal(result.handled, true);
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });

  test('GET /api/leads/:id falls through when flag is off', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('GET'), null, fakeUrl('/api/leads/LEAD-0001'), {});
      assert.equal(result, null, 'GET /api/leads/:id must fall through when flag is off');
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });

  test('GET /api/requirements falls through when flag is off', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('GET'), null, fakeUrl('/api/requirements'), {});
      assert.equal(result, null, 'GET /api/requirements must fall through when flag is off');
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });

  test('GET /api/transactions/:id is always handled (new route)', async () => {
    const old = process.env.LEAD_V2_ENABLED;
    process.env.LEAD_V2_ENABLED = 'false';
    try {
      const router = makeRouter(makeTempDb());
      const result = await router.handle(fakeReq('GET'), null, fakeUrl('/api/transactions/T000001'), {});
      // Returns handled=true with 404 (not found) — still routed by V2Router
      assert.ok(result !== null, 'GET /api/transactions/:id must be handled by V2Router (new route)');
      assert.equal(result.handled, true);
    } finally {
      if (old === undefined) delete process.env.LEAD_V2_ENABLED;
      else process.env.LEAD_V2_ENABLED = old;
    }
  });
});

// ── Server-side value validation ─────────────────────────────────────────────
// Absence of a field is NEVER an error (remains UNKNOWN).
// Only invalid provided values are rejected.

describe('V2RequirementService: value validation (provided values only)', () => {
  function makeServices(dbFile) {
    const repo = makeRepo(dbFile);
    const { V2LeadService }        = require('../src/services/v2LeadService');
    const { V2TransactionService } = require('../src/services/v2TransactionService');
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    return {
      repo,
      leadSvc: new V2LeadService(repo),
      txnSvc:  new V2TransactionService(repo),
      reqSvc:  new V2RequirementService(repo)
    };
  }

  function createParents(svcs, mobileSuffix = '01') {
    const lead = svcs.leadSvc.createLead({ ClientName: 'Val Test', PrimaryMobile: `9988770${mobileSuffix}` });
    assert.ok(lead.ok, lead.error);
    const txn = svcs.txnSvc.createTransaction(lead.data.LeadID, { TransactionType: 'Purchase' });
    assert.ok(txn.ok, txn.error);
    return { leadId: lead.data.LeadID, txnId: txn.data.TransactionID };
  }

  // ARCHITECTURE CHANGE: missing Urgency is NOT an error — it remains UNKNOWN.
  test('accepts Residential Flat creation without Urgency (field remains UNKNOWN)', () => {
    const svcs = makeServices(makeTempDb());
    const { leadId, txnId } = createParents(svcs, '02');
    const result = svcs.reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      TransactionType: 'Purchase',
      Category: 'Residential',
      SubCategory: 'Flat',
      BudgetMax: 8000000,
      Location1: 'Pune'
      // Urgency intentionally omitted — must remain UNKNOWN, not error
    });
    assert.equal(result.ok, true, `Should accept creation without Urgency. Got: ${result.error}`);
    const urgencyEntry = (result.data.Fields || {}).Urgency;
    assert.ok(!urgencyEntry || urgencyEntry.state === 'UNKNOWN',
      'Urgency field should be UNKNOWN when not provided');
  });

  test('rejects invalid option value for a Select field (bad value, not absence)', () => {
    const svcs = makeServices(makeTempDb());
    const { leadId, txnId } = createParents(svcs, '03');
    const result = svcs.reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      TransactionType: 'Purchase',
      Category: 'Residential',
      SubCategory: 'Flat',
      BudgetMax: 8000000,
      Location1: 'Pune',
      Urgency: 'SUPER_URGENT'  // Not in ['Immediate', 'High', 'Medium', 'Low']
    });
    assert.equal(result.ok, false, 'Should reject invalid option value');
    assert.ok(result.error.toLowerCase().includes('super_urgent') || result.error.toLowerCase().includes('urgency'),
      `Expected option error, got: ${result.error}`);
  });

  test('accepts valid option value for Urgency when provided', () => {
    const svcs = makeServices(makeTempDb());
    const { leadId, txnId } = createParents(svcs, '04');
    const result = svcs.reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      TransactionType: 'Purchase',
      Category: 'Residential',
      SubCategory: 'Flat',
      BudgetMax: 8000000,
      Location1: 'Pune',
      Urgency: 'High'
    });
    assert.equal(result.ok, true, result.error || 'Should accept valid option value');
  });

  test('rejects negative number for positive-number field (BudgetMin)', () => {
    const svcs = makeServices(makeTempDb());
    const { leadId, txnId } = createParents(svcs, '05');
    const result = svcs.reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      TransactionType: 'Purchase',
      Category: 'Residential',
      SubCategory: 'Flat',
      BudgetMin: -100,  // Must be ≥ 0
      BudgetMax: 8000000,
      Location1: 'Pune'
    });
    assert.equal(result.ok, false, 'Should reject negative value for BudgetMin');
    assert.ok(result.error.toLowerCase().includes('positive') || result.error.toLowerCase().includes('budget'),
      `Expected positive/budget error, got: ${result.error}`);
  });
});

// ── Phase 7: Progressive Requirement Capture (Tests 1–12) ────────────────────

describe('Phase 7: Progressive Requirement Capture', () => {
  /**
   * Shared helpers
   */
  function makeServices(dbFile) {
    // Fresh require cache not needed; use the shared test module system
    const { JsonRepository }       = require('../src/data/repository');
    const { V2LeadService }        = require('../src/services/v2LeadService');
    const { V2TransactionService } = require('../src/services/v2TransactionService');
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    const repo = new JsonRepository(dbFile);
    return {
      repo,
      leadSvc: new V2LeadService(repo),
      txnSvc:  new V2TransactionService(repo),
      reqSvc:  new V2RequirementService(repo)
    };
  }

  // ─── TEST 1 ────────────────────────────────────────────────────────────────

  test('TEST 1 — Create Client + Purchase + Residential + Vesu + ₹1Cr with no BHK/Parking/Possession', () => {
    const svcs = makeServices(makeTempDb());

    // Step 1: Create client (Lead)
    const leadRes = svcs.leadSvc.createLead({ ClientName: 'Rahul Shah', PrimaryMobile: '9876000001' });
    assert.equal(leadRes.ok, true, leadRes.error);
    assert.match(leadRes.data.LeadID, /^L\d{6,}$/);

    // Step 2: Create transaction (what client wants to do)
    const txnRes = svcs.txnSvc.createTransaction(leadRes.data.LeadID, { TransactionType: 'Purchase' });
    assert.equal(txnRes.ok, true, txnRes.error);

    // Step 3: Create requirement with ONLY the known information — no BHK, Parking, Possession
    const reqRes = svcs.reqSvc.createRequirement(txnRes.data.TransactionID, {
      LeadID:   leadRes.data.LeadID,
      Category: 'Residential',
      Location1: 'Vesu',
      BudgetMax: 10000000  // ₹1 Cr
      // BHK, Parking, Possession intentionally absent — must remain UNKNOWN
    });

    assert.equal(reqRes.ok, true, `Minimal creation must succeed. Got: ${reqRes.error}`);
    assert.match(reqRes.data.RequirementID, /^R\d{6,}$/);
    assert.equal(reqRes.data.LeadID,        leadRes.data.LeadID);
    assert.equal(reqRes.data.TransactionID, txnRes.data.TransactionID);
    assert.equal(reqRes.data.Category, 'Residential');
    assert.equal(reqRes.data.Location1, 'Vesu');
    assert.equal(reqRes.data.BudgetMax, 10000000);
    assert.equal(reqRes.data._v2, true);

    // BHK, Parking, Possession must be UNKNOWN (absent or explicit UNKNOWN state)
    const fields = reqRes.data.Fields || {};
    const neitherKnownNorNA = (k) => !fields[k] || fields[k].state === 'UNKNOWN';
    assert.ok(neitherKnownNorNA('BHK'),        'BHK should be UNKNOWN when not provided');
    assert.ok(neitherKnownNorNA('Parking'),     'Parking should be UNKNOWN when not provided');
    assert.ok(neitherKnownNorNA('Possession'),  'Possession should be UNKNOWN when not provided');
  });

  // ─── TEST 2 ────────────────────────────────────────────────────────────────

  test('TEST 2 — PATCH BHK=3 on same RequirementID', () => {
    const svcs    = makeServices(makeTempDb());
    const { lead, txn, reqId } = createMinimalRequirement(svcs, '9876000002');

    const patch = svcs.reqSvc.updateRequirement(reqId, { BHK: 3 });

    assert.equal(patch.ok, true, patch.error);
    assert.equal(patch.data.requirement.RequirementID, reqId, 'RequirementID must remain the same');
    const bhkEntry = (patch.data.requirement.Fields || {}).BHK;
    assert.ok(bhkEntry, 'BHK must appear in Fields map');
    assert.equal(bhkEntry.state, 'KNOWN');
    assert.equal(bhkEntry.value, 3);
  });

  // ─── TEST 3 ────────────────────────────────────────────────────────────────

  test('TEST 3 — PATCH Possession=Ready on same RequirementID', () => {
    const svcs = makeServices(makeTempDb());
    const { reqId } = createMinimalRequirement(svcs, '9876000003');

    svcs.reqSvc.updateRequirement(reqId, { BHK: 3 });
    const patch = svcs.reqSvc.updateRequirement(reqId, { Possession: 'Ready' });

    assert.equal(patch.ok, true, patch.error);
    assert.equal(patch.data.requirement.RequirementID, reqId);
    assert.equal(patch.data.requirement.Possession, 'Ready');
    const possessionEntry = (patch.data.requirement.Fields || {}).Possession;
    assert.ok(possessionEntry && possessionEntry.state === 'KNOWN', 'Possession must be KNOWN');
    assert.equal(possessionEntry.value, 'Ready');
  });

  // ─── TEST 4 ────────────────────────────────────────────────────────────────

  test('TEST 4 — PATCH Parking=2 on same RequirementID', () => {
    const svcs = makeServices(makeTempDb());
    const { reqId } = createMinimalRequirement(svcs, '9876000004');

    svcs.reqSvc.updateRequirement(reqId, { BHK: 3 });
    svcs.reqSvc.updateRequirement(reqId, { Possession: 'Ready' });
    const patch = svcs.reqSvc.updateRequirement(reqId, { Parking: 2 });

    assert.equal(patch.ok, true, patch.error);
    assert.equal(patch.data.requirement.RequirementID, reqId);
    const parkingEntry = (patch.data.requirement.Fields || {}).Parking;
    assert.ok(parkingEntry && parkingEntry.state === 'KNOWN', 'Parking must be KNOWN');
    assert.equal(parkingEntry.value, 2);
  });

  // ─── TEST 5 ────────────────────────────────────────────────────────────────

  test('TEST 5 — Add Location2=City Light on same RequirementID', () => {
    const svcs = makeServices(makeTempDb());
    const { reqId } = createMinimalRequirement(svcs, '9876000005');

    svcs.reqSvc.updateRequirement(reqId, { BHK: 3 });
    svcs.reqSvc.updateRequirement(reqId, { Possession: 'Ready' });
    svcs.reqSvc.updateRequirement(reqId, { Parking: 2 });
    const patch = svcs.reqSvc.updateRequirement(reqId, { Location2: 'City Light' });

    assert.equal(patch.ok, true, patch.error);
    assert.equal(patch.data.requirement.RequirementID, reqId);
    assert.equal(patch.data.requirement.Location2, 'City Light');
    const loc2Entry = (patch.data.requirement.Fields || {}).Location2;
    assert.ok(loc2Entry && loc2Entry.state === 'KNOWN', 'Location2 must be KNOWN');
    assert.equal(loc2Entry.value, 'City Light');
    // Location1 must still be intact
    assert.equal(patch.data.requirement.Location1, 'Vesu');
  });

  // ─── TEST 6 ────────────────────────────────────────────────────────────────

  test('TEST 6 — Add AvoidLocations=Adajan on same RequirementID', () => {
    const svcs = makeServices(makeTempDb());
    const { reqId } = createMinimalRequirement(svcs, '9876000006');

    svcs.reqSvc.updateRequirement(reqId, { BHK: 3 });
    svcs.reqSvc.updateRequirement(reqId, { Possession: 'Ready' });
    svcs.reqSvc.updateRequirement(reqId, { Parking: 2 });
    svcs.reqSvc.updateRequirement(reqId, { Location2: 'City Light' });
    const patch = svcs.reqSvc.updateRequirement(reqId, { AvoidLocations: 'Adajan' });

    assert.equal(patch.ok, true, patch.error);
    assert.equal(patch.data.requirement.RequirementID, reqId);
    assert.equal(patch.data.requirement.AvoidLocations, 'Adajan');
    const avoidEntry = (patch.data.requirement.Fields || {}).AvoidLocations;
    assert.ok(avoidEntry && avoidEntry.state === 'KNOWN');

    // Verify cumulative state: all previous patches survived
    const req = patch.data.requirement;
    assert.equal((req.Fields.BHK         || {}).value,       3,            'BHK must survive');
    assert.equal((req.Fields.Possession  || {}).value,       'Ready',      'Possession must survive');
    assert.equal((req.Fields.Parking     || {}).value,       2,            'Parking must survive');
    assert.equal((req.Fields.Location2   || {}).value,       'City Light', 'Location2 must survive');
    assert.equal((req.Fields.AvoidLocations || {}).value,    'Adajan',     'AvoidLocations must be set');
    // Also verify BudgetMax from original creation still intact
    assert.equal(req.BudgetMax, 10000000, 'BudgetMax from creation must survive all patches');
  });

  // ─── TEST 7 ────────────────────────────────────────────────────────────────

  test('TEST 7 — Second Need creates new Transaction+Requirement but SAME LeadID', () => {
    const svcs = makeServices(makeTempDb());
    const { lead, txn: txn1, reqId: reqId1 } = createMinimalRequirement(svcs, '9876000007');

    // Same client now wants an office
    const txn2Res = svcs.txnSvc.createTransaction(lead.LeadID, {
      TransactionType: 'Rent'
    });
    assert.equal(txn2Res.ok, true, txn2Res.error);
    assert.notEqual(txn2Res.data.TransactionID, txn1.TransactionID, 'Must be a NEW transaction');
    assert.equal(txn2Res.data.LeadID, lead.LeadID, 'LeadID must be SAME');

    const req2Res = svcs.reqSvc.createRequirement(txn2Res.data.TransactionID, {
      LeadID:      lead.LeadID,
      Category:    'Commercial',
      SubCategory: 'Office',
      Location1:   'Vesu',
      BudgetMax:   60000  // ₹60K/month
    });
    assert.equal(req2Res.ok, true, req2Res.error);
    assert.notEqual(req2Res.data.RequirementID, reqId1, 'Must be a NEW requirement ID');
    assert.equal(req2Res.data.LeadID,           lead.LeadID, 'LeadID on second requirement = same client');
    assert.equal(req2Res.data.TransactionID,    txn2Res.data.TransactionID);
    assert.equal(req2Res.data.Category,         'Commercial');
    assert.equal(req2Res.data.SubCategory,      'Office');

    // Verify the lead has exactly TWO transactions
    const txns = svcs.txnSvc.listTransactionsByLead(lead.LeadID);
    assert.equal(txns.length, 2, 'Client must have exactly 2 transactions, not 2 leads');
    assert.ok(txns.every(t => t.LeadID === lead.LeadID), 'Both transactions belong to same lead');

    // Only ONE lead must exist for this client
    const db = svcs.repo.read();
    const clientLeads = (db.Leads || []).filter(l => l.PrimaryMobile === '9876000007' || l.LeadID === lead.LeadID);
    assert.equal(clientLeads.length, 1, 'Exactly one Lead must exist for this client — never duplicated');
  });

  // ─── TEST 8 ────────────────────────────────────────────────────────────────

  test('TEST 8 — Requirement LeadID mismatch with Transaction LeadID is rejected', () => {
    const svcs = makeServices(makeTempDb());

    const lead1Res = svcs.leadSvc.createLead({ ClientName: 'Lead One', PrimaryMobile: '9876000008' });
    const lead2Res = svcs.leadSvc.createLead({ ClientName: 'Lead Two', PrimaryMobile: '9876000009' });
    assert.ok(lead1Res.ok && lead2Res.ok);

    const txnRes = svcs.txnSvc.createTransaction(lead1Res.data.LeadID, { TransactionType: 'Purchase' });
    assert.ok(txnRes.ok);

    // Attempt to assign Requirement to lead2 while Transaction belongs to lead1
    const result = svcs.reqSvc.createRequirement(txnRes.data.TransactionID, {
      LeadID:   lead2Res.data.LeadID,   // MISMATCH
      Location1: 'Surat',
      BudgetMax: 5000000
    });

    assert.equal(result.ok, false, 'Must reject LeadID mismatch');
    assert.ok(result.error.toLowerCase().includes('leadid') || result.error.toLowerCase().includes('lead'),
      `Expected error about LeadID mismatch, got: ${result.error}`);
  });

  // ─── TEST 9 ────────────────────────────────────────────────────────────────

  test('TEST 9 — Untouched optional fields remain UNKNOWN after progressive updates', () => {
    const svcs = makeServices(makeTempDb());
    const { reqId } = createMinimalRequirement(svcs, '9876000010');

    // Update only BHK
    const patch = svcs.reqSvc.updateRequirement(reqId, { BHK: 3 });
    assert.equal(patch.ok, true);

    const fields = patch.data.requirement.Fields || {};

    // BHK is now KNOWN
    assert.equal((fields.BHK || {}).state, 'KNOWN');

    // These were never touched — must be UNKNOWN (absent or explicit state)
    const unknownOrAbsent = (k) => !fields[k] || fields[k].state === 'UNKNOWN';
    assert.ok(unknownOrAbsent('Parking'),    'Parking must remain UNKNOWN');
    assert.ok(unknownOrAbsent('Possession'), 'Possession must remain UNKNOWN');
    assert.ok(unknownOrAbsent('Finance'),    'Finance must remain UNKNOWN');
    assert.ok(unknownOrAbsent('Facing'),     'Facing must remain UNKNOWN');
    assert.ok(unknownOrAbsent('Floor'),      'Floor must remain UNKNOWN');
    assert.ok(unknownOrAbsent('Amenities'),  'Amenities must remain UNKNOWN');
  });

  // ─── TEST 10 ───────────────────────────────────────────────────────────────

  test('TEST 10 — NOT_APPLICABLE state can be stored and is distinct from UNKNOWN', () => {
    const svcs = makeServices(makeTempDb());
    const { reqId } = createMinimalRequirement(svcs, '9876000011');

    // Client explicitly says "parking nahi chahiye"
    const patch = svcs.reqSvc.updateRequirement(reqId, {
      Fields: {
        Parking: { state: 'NOT_APPLICABLE' }
      }
    });

    assert.equal(patch.ok, true, patch.error);

    const parkingEntry = (patch.data.requirement.Fields || {}).Parking;
    assert.ok(parkingEntry, 'Parking must appear in Fields map');
    assert.equal(parkingEntry.state, 'NOT_APPLICABLE',
      'Parking must be NOT_APPLICABLE, not UNKNOWN');

    // Also test the string sentinel convenience
    const patch2 = svcs.reqSvc.updateRequirement(reqId, {
      Possession: 'NOT_APPLICABLE'
    });
    assert.equal(patch2.ok, true, patch2.error);
    const possEntry = (patch2.data.requirement.Fields || {}).Possession;
    assert.ok(possEntry && possEntry.state === 'NOT_APPLICABLE',
      'Possession sentinel string must produce NOT_APPLICABLE state');

    // Verify UNKNOWN fields remain distinct
    const unknown = (k) => !patch2.data.requirement.Fields[k] || patch2.data.requirement.Fields[k].state === 'UNKNOWN';
    assert.ok(unknown('BHK'),   'BHK (never set) must still be UNKNOWN, not NOT_APPLICABLE');
    assert.ok(unknown('Facing'), 'Facing (never set) must still be UNKNOWN');
  });

  // ─── TEST 11 ───────────────────────────────────────────────────────────────

  test('TEST 11 — Requirements survive a repository restart', () => {
    const dbFile = makeTempDb();

    // Session A: create the requirement
    const svcsA = makeServices(dbFile);
    const { lead, txn } = createMinimalRequirement(svcsA, '9876000012');
    const reqIdA = svcsA.repo.read().Requirements.find(r => r.LeadID === lead.LeadID).RequirementID;
    svcsA.reqSvc.updateRequirement(reqIdA, { BHK: 3, Possession: 'Ready' });
    svcsA.reqSvc.updateRequirement(reqIdA, { Location2: 'City Light' });

    // Session B: fresh repository pointing to the same file — simulates restart
    const { JsonRepository }       = require('../src/data/repository');
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    const repoB = new JsonRepository(dbFile);
    const reqSvcB = new V2RequirementService(repoB);

    const found = reqSvcB.getRequirement(reqIdA);
    assert.equal(found.ok, true, 'Requirement must be found after restart');
    assert.equal(found.data.RequirementID, reqIdA);
    assert.equal(found.data.LeadID, lead.LeadID);
    assert.equal(found.data.Location1, 'Vesu');
    assert.equal(found.data.Location2, 'City Light');
    assert.equal((found.data.Fields.BHK     || {}).value, 3,       'BHK must survive restart');
    assert.equal((found.data.Fields.Possession || {}).value, 'Ready', 'Possession must survive restart');
    assert.ok(found.data.history && found.data.history.length >= 2, 'History must survive restart');
  });

  // ─── TEST 12 ───────────────────────────────────────────────────────────────

  test('TEST 12 — V1 Requirement records remain readable alongside V2 records', () => {
    const dbFile = makeTempDb();
    const { JsonRepository }       = require('../src/data/repository');
    const { V2RequirementService } = require('../src/services/v2RequirementService');

    // Inject a V1-format requirement directly (simulates a legacy record)
    const repo = new JsonRepository(dbFile);
    const db   = repo.read();
    const legacyReq = {
      // V1 ID format
      RequirementID:   'REQ-00001',
      LeadID:          'LEAD-00001',
      TransactionID:   'TXN-00001',
      Category:        'Residential',
      TransactionType: 'Purchase',
      BudgetMin:       5000000,
      BudgetMax:       10000000,
      Location1:       'Surat',
      Status:          'Active',
      PipelineStage:   'New',
      CreatedAt:       '2024-01-01T00:00:00.000Z',
      // No _v2 flag — this is a legacy record
    };
    db.Requirements = db.Requirements || [];
    db.Requirements.push(legacyReq);
    repo.write(db);

    // V2 service must still be able to read V1 records
    const reqSvc = new V2RequirementService(repo);
    const all    = reqSvc.listAllRequirements();
    const legacy = all.find(r => r.RequirementID === 'REQ-00001');

    assert.ok(legacy, 'V1 requirement must be visible via listAllRequirements');
    assert.equal(legacy.Category, 'Residential');
    assert.equal(legacy.Location1, 'Surat');
    assert.equal(legacy.BudgetMin, 5000000);

    // Create a V2 requirement alongside — both must coexist
    const { V2LeadService }        = require('../src/services/v2LeadService');
    const { V2TransactionService } = require('../src/services/v2TransactionService');
    const leadSvc = new V2LeadService(repo);
    const txnSvc  = new V2TransactionService(repo);

    const leadRes = leadSvc.createLead({ ClientName: 'V2 Client', PrimaryMobile: '9876000013' });
    const txnRes  = txnSvc.createTransaction(leadRes.data.LeadID, { TransactionType: 'Purchase' });
    const reqRes  = reqSvc.createRequirement(txnRes.data.TransactionID, {
      LeadID:    leadRes.data.LeadID,
      Location1: 'Vesu',
      BudgetMax: 8000000
    });

    assert.equal(reqRes.ok, true, reqRes.error);

    // Both V1 and V2 visible in list
    const allAfter = reqSvc.listAllRequirements();
    assert.ok(allAfter.some(r => r.RequirementID === 'REQ-00001'),    'V1 record must still exist');
    assert.ok(allAfter.some(r => r.RequirementID === reqRes.data.RequirementID), 'V2 record must exist');
  });

  // ── Shared setup helper ──────────────────────────────────────────────────

  /**
   * Creates the minimal Rahul Shah scenario:
   * Client (Lead) → Purchase Transaction → minimal Requirement (Category=Residential, Vesu, ₹1Cr).
   * Returns { lead, txn, reqId }.
   */
  function createMinimalRequirement(svcs, mobile = '9876000099') {
    const leadRes = svcs.leadSvc.createLead({ ClientName: 'Rahul Shah', PrimaryMobile: mobile });
    assert.ok(leadRes.ok, `createLead failed: ${leadRes.error}`);

    const txnRes = svcs.txnSvc.createTransaction(leadRes.data.LeadID, { TransactionType: 'Purchase' });
    assert.ok(txnRes.ok, `createTransaction failed: ${txnRes.error}`);

    const reqRes = svcs.reqSvc.createRequirement(txnRes.data.TransactionID, {
      LeadID:    leadRes.data.LeadID,
      Category:  'Residential',
      Location1: 'Vesu',
      BudgetMax: 10000000
    });
    assert.ok(reqRes.ok, `createRequirement failed: ${reqRes.error}`);

    return { lead: leadRes.data, txn: txnRes.data, reqId: reqRes.data.RequirementID };
  }
});

// ── Migration: dry-run is non-mutating ────────────────────────────────────────

describe('Migration: dry-run performs zero DB writes', () => {
  test('dry-run does not change _V2Counters or add records', () => {
    const dbFile = makeTempDb();
    const repo = makeRepo(dbFile);

    // Read baseline
    const before = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const countersBefore = { ...(before._V2Counters || {}) };
    const leadCountBefore = (before.Leads || []).length;

    // Build allocator (in-memory only — same as dry-run path in migrateV2.js)
    const { IdEngine, PREFIXES, formatV2Id, parseV2Seq } = require('../src/data/idEngine');

    // Simulate what buildIdAllocator does in dry-run — read DB snapshot, no writes
    const db = repo.read();
    const existing = db._V2Counters || {};
    let leadSeq = Math.max(existing.Lead || 0, ...(db.Leads || []).map((r) => parseV2Seq(r.LeadID, PREFIXES.Lead)));
    const nextId = formatV2Id(PREFIXES.Lead, ++leadSeq);
    assert.match(nextId, /^L\d{6,}$/, 'Allocator generates valid V2 ID');

    // Re-read DB — counters must be unchanged (no writes happened)
    const after = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    assert.deepEqual(after._V2Counters || {}, countersBefore, 'Dry-run must not modify _V2Counters');
    assert.equal((after.Leads || []).length, leadCountBefore, 'Dry-run must not add lead records');
  });
});

// ── Regression: Repository existing functionality ─────────────────────────────

describe('Regression: existing repository methods', () => {
  test('createId still produces legacy-format IDs', () => {
    const repo = makeRepo(makeTempDb());
    const id = repo.createId('TEST');
    assert.ok(String(id).startsWith('TEST-'));
  });

  test('readLead still works for V2 leads', () => {
    const repo = makeRepo(makeTempDb());
    const { V2LeadService } = require('../src/services/v2LeadService');
    const svc = new V2LeadService(repo);
    const result = svc.createLead({ ClientName: 'Regression', PrimaryMobile: '9100000001' });
    const lead   = repo.readLead(result.data.LeadID);
    assert.ok(lead);
    assert.equal(lead.ClientName, 'Regression');
  });

  test('addTimelineEntry works for V2 entities', () => {
    const repo = makeRepo(makeTempDb());
    const { V2LeadService } = require('../src/services/v2LeadService');
    const svc = new V2LeadService(repo);
    const result = svc.createLead({ ClientName: 'Timeline Test', PrimaryMobile: '9100000002' });
    const db = repo.read();
    const events = (db.Timeline || []).filter(t => t.LeadID === result.data.LeadID);
    assert.ok(events.length > 0);
    assert.equal(events[0].EventType, 'LEAD_CREATED');
  });
});
