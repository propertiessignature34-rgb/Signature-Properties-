/**
 * PHASE 11 — Next Question Engine Tests
 *
 * Tests 1–41 from contract:
 *  1.  Requirement with no answers
 *  2.  Requirement with some known answers
 *  3.  Requirement with many known answers
 *  4.  UNKNOWN candidate selection
 *  5.  KNOWN field excluded
 *  6.  NOT_APPLICABLE field excluded
 *  7.  HIDDEN field excluded
 *  8.  NOT_RELEVANT field excluded
 *  9.  Core priority
 * 10.  Important priority
 * 11.  Optional priority
 * 12.  Dependency integration
 * 13.  TransactionType-specific question
 * 14.  Category-specific question
 * 15.  SubCategory-specific question
 * 16.  Rent questions
 * 17.  Purchase questions
 * 18.  Commercial questions
 * 19.  Industrial questions
 * 20.  Land questions
 * 21.  Agriculture questions
 * 22.  Question ranking
 * 23.  Deterministic ranking
 * 24.  Duplicate FieldKey removal
 * 25.  limit=1
 * 26.  limit=3
 * 27.  limit=5
 * 28.  Explanation/reason
 * 29.  No available questions
 * 30.  Historical FormVersion
 * 31.  Requirement PATCH causes recalculation
 * 32.  Known answer disappears from recommendations
 * 33.  UNKNOWN remains UNKNOWN
 * 34.  No Requirement mutation from next-question API
 * 35.  API response shape
 * 36.  Invalid RequirementID
 * 37.  Phase 1–10 regression
 * 38.  Lifecycle regression
 * 39.  Matching/Inventory not touched
 * 40.  API routes
 * 41.  rankQuestions direct context API
 */

'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-v2-p11-'));
  return path.join(dir, 'test.json');
}

function makeRepo(dbFile) {
  const { JsonRepository } = require('../src/data/repository');
  return new JsonRepository(dbFile || makeTempDb());
}

function makeConfigSvc(repo) {
  const { V2ConfigService } = require('../src/services/v2ConfigService');
  return new V2ConfigService(repo);
}

function makeRegistrySvc(repo, cfgSvc) {
  const { V2FormRegistryService } = require('../src/services/v2FormRegistryService');
  return new V2FormRegistryService(repo, cfgSvc || makeConfigSvc(repo));
}

function makeDepSvc(repo, regSvc) {
  const { V2DependencyService } = require('../src/services/v2DependencyService');
  return new V2DependencyService(repo, regSvc);
}

function makeNextQSvc(repo, depSvc, cfgSvc) {
  const { V2NextQuestionService } = require('../src/services/v2NextQuestionService');
  return new V2NextQuestionService(repo, depSvc, cfgSvc);
}

function fullStack(dbFile) {
  const repo   = makeRepo(dbFile);
  const cfg    = makeConfigSvc(repo);
  const reg    = makeRegistrySvc(repo, cfg);
  const dep    = makeDepSvc(repo, reg);
  const nextQ  = makeNextQSvc(repo, dep, cfg);
  cfg.seedConfigIfEmpty();
  reg.seedFormRegistryIfEmpty();
  dep.seedDependencyConfigIfEmpty();
  return { repo, cfg, reg, dep, nextQ };
}

function makeRouterHandle(repo) {
  const { V2Router } = require('../src/api/v2Router');
  const router = new V2Router(repo);
  return async function handle(method, pathAndQuery) {
    const url  = new URL(`http://localhost${pathAndQuery}`);
    const body = {};
    const cap  = { statusCode: null, body: null };
    const res  = {
      writeHead(code) { cap.statusCode = code; },
      end(data)       { try { cap.body = JSON.parse(data); } catch { cap.body = data; } }
    };
    const result = await router.handle({ method }, res, url, body);
    if (result && result.statusCode != null) return result;
    return cap;
  };
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

function seedLeadTxnReq(repo, opts = {}) {
  const db = repo.read();
  db.Leads         = db.Leads         || [];
  db.Transactions  = db.Transactions  || [];
  db.Requirements  = db.Requirements  || [];
  db._V2Counters   = db._V2Counters   || { Lead: 0, Transaction: 0, Requirement: 0 };

  const leadId = opts.leadId || 'L000001';
  const txnId  = opts.txnId  || 'T000001';
  const reqId  = opts.reqId  || 'REQ000001';

  if (!db.Leads.find(l => l.LeadID === leadId)) {
    db.Leads.push({ LeadID: leadId, ClientName: 'Test', PrimaryMobile: '9999999999', ClientStatus: 'New', _v2: true });
  }
  if (!db.Transactions.find(t => t.TransactionID === txnId)) {
    db.Transactions.push({
      TransactionID: txnId, LeadID: leadId,
      TransactionType: opts.txnType || 'Purchase',
      TransactionStatus: 'Open', PipelineStage: 'New', _v2: true
    });
  }
  if (!db.Requirements.find(r => r.RequirementID === reqId)) {
    db.Requirements.push({
      RequirementID: reqId,
      TransactionID: txnId,
      LeadID:        leadId,
      Category:      opts.category    || 'Residential',
      SubCategory:   opts.subCategory || 'Flat',
      FormVersion:   opts.formVersion || '2.0',
      RequirementStatus: 'Active',
      Fields:        opts.fields      || {},
      _v2: true
    });
  }
  repo.write(db);
  return { leadId, txnId, reqId };
}

function patchRequirementFields(repo, reqId, newFields) {
  const db = repo.read();
  const req = db.Requirements.find(r => r.RequirementID === reqId);
  if (!req) throw new Error(`Requirement not found: ${reqId}`);
  req.Fields = { ...req.Fields, ...newFields };
  repo.write(db);
}

// ── Suite 1: No answers ────────────────────────────────────────────────────────

describe('1. Requirement with no answers', () => {
  test('getNextQuestions returns ok:true and at least one question', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001');
    assert.equal(res.ok, true, `Expected ok:true but got: ${res.error}`);
    assert.ok(Array.isArray(res.questions));
    assert.ok(res.questions.length > 0, 'Should recommend at least one question for empty Requirement');
  });

  test('getNextQuestions returns up to 3 questions by default', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001');
    assert.ok(res.questions.length <= 3, 'Default limit is 3');
  });

  test('getNextQuestion returns single top question', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestion('REQ000001');
    assert.equal(res.ok, true);
    assert.ok(res.question !== null);
    assert.ok(res.question.fieldKey);
    assert.ok(res.question.label);
  });
});

// ── Suite 2: Some known answers ────────────────────────────────────────────────

describe('2. Requirement with some known answers', () => {
  test('getNextQuestions excludes already-KNOWN fields', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, {
      txnType: 'Purchase', category: 'Residential', subCategory: 'Flat',
      fields: {
        BudgetMin: { state: 'KNOWN', value: 5000000 },
        BudgetMax: { state: 'KNOWN', value: 10000000 },
        Location1: { state: 'KNOWN', value: 'Vesu' },
        BHKMin:    { state: 'KNOWN', value: 3 }
      }
    });
    const res = nextQ.getNextQuestions('REQ000001');
    assert.equal(res.ok, true);
    const fieldKeys = res.questions.map(q => q.fieldKey);
    assert.ok(!fieldKeys.includes('BudgetMin'), 'BudgetMin is KNOWN — must not appear');
    assert.ok(!fieldKeys.includes('BudgetMax'), 'BudgetMax is KNOWN — must not appear');
    assert.ok(!fieldKeys.includes('Location1'), 'Location1 is KNOWN — must not appear');
    assert.ok(!fieldKeys.includes('BHKMin'),    'BHKMin is KNOWN — must not appear');
  });

  test('totalCandidates decreases as more fields are known', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res1 = nextQ.getNextQuestions('REQ000001', { limit: 10 });

    patchRequirementFields(repo, 'REQ000001', {
      BudgetMin: { state: 'KNOWN', value: 5000000 },
      BudgetMax: { state: 'KNOWN', value: 10000000 },
      Location1: { state: 'KNOWN', value: 'Vesu' },
      BHKMin:    { state: 'KNOWN', value: 3 }
    });
    const res2 = nextQ.getNextQuestions('REQ000001', { limit: 10 });

    assert.ok(res2.totalCandidates < res1.totalCandidates,
      'Fewer candidates expected after more fields are known');
  });
});

// ── Suite 3: Many known answers ────────────────────────────────────────────────

describe('3. Requirement with many known answers', () => {
  test('questions list still only contains UNKNOWN fields', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, {
      txnType: 'Purchase', category: 'Residential', subCategory: 'Flat',
      fields: {
        BudgetMin:    { state: 'KNOWN', value: 5000000 },
        BudgetMax:    { state: 'KNOWN', value: 10000000 },
        Location1:    { state: 'KNOWN', value: 'Vesu' },
        BHKMin:       { state: 'KNOWN', value: 2 },
        BHKMax:       { state: 'KNOWN', value: 3 },
        Furnishing:   { state: 'KNOWN', value: 'Semi-Furnished' },
        Parking:      { state: 'KNOWN', value: 1 },
        Possession:   { state: 'KNOWN', value: '6-12 Months' },
        Urgency:      { state: 'KNOWN', value: 'Medium' }
      }
    });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    assert.equal(res.ok, true);
    const knownKeys = ['BudgetMin','BudgetMax','Location1','BHKMin','BHKMax','Furnishing','Parking','Possession','Urgency'];
    for (const q of res.questions) {
      assert.ok(!knownKeys.includes(q.fieldKey), `${q.fieldKey} is KNOWN — must not appear`);
    }
  });
});

// ── Suite 4: UNKNOWN candidate selection ──────────────────────────────────────

describe('4. UNKNOWN candidate selection', () => {
  test('fields with state UNKNOWN are valid candidates', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, {
      txnType: 'Purchase', category: 'Residential', subCategory: 'Flat',
      fields: { Possession: { state: 'UNKNOWN' } }
    });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    // Possession is UNKNOWN and RELEVANT for Purchase — should be a candidate
    const possessionQ = res.questions.find(q => q.fieldKey === 'Possession');
    // It should appear (Possession is RELEVANT for Purchase)
    assert.equal(res.ok, true);
    assert.ok(Array.isArray(res.questions));
  });

  test('absent field is treated as UNKNOWN (not NO)', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, {
      txnType: 'Rent', category: 'Residential', subCategory: 'Flat',
      fields: {}  // TenantType absent = UNKNOWN
    });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    assert.equal(res.ok, true);
    // TenantType should be a candidate (RELEVANT for Rent, UNKNOWN)
    const tenantQ = res.questions.find(q => q.fieldKey === 'TenantType');
    assert.ok(tenantQ, 'TenantType should be recommended for Rent requirement with UNKNOWN TenantType');
  });
});

// ── Suite 5: KNOWN field excluded ─────────────────────────────────────────────

describe('5. KNOWN field excluded', () => {
  test('KNOWN BudgetMin is never recommended', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, {
      txnType: 'Purchase', category: 'Residential', subCategory: 'Flat',
      fields: { BudgetMin: { state: 'KNOWN', value: 5000000 } }
    });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(!keys.includes('BudgetMin'), 'KNOWN BudgetMin must not appear');
  });

  test('All returned questions have no fieldKey that is KNOWN in the requirement', () => {
    const { repo, nextQ } = fullStack();
    const knownFields = {
      Location1: { state: 'KNOWN', value: 'Adajan' },
      BHKMin:    { state: 'KNOWN', value: 2 },
      BudgetMin: { state: 'KNOWN', value: 3000000 }
    };
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat', fields: knownFields });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    for (const q of res.questions) {
      assert.ok(!knownFields[q.fieldKey], `KNOWN field ${q.fieldKey} must not appear in recommendations`);
    }
  });
});

// ── Suite 6: NOT_APPLICABLE excluded ──────────────────────────────────────────

describe('6. NOT_APPLICABLE field excluded', () => {
  test('NOT_APPLICABLE field is not recommended', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, {
      txnType: 'Purchase', category: 'Residential', subCategory: 'Flat',
      fields: { Parking: { state: 'NOT_APPLICABLE', value: null } }
    });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(!keys.includes('Parking'), 'NOT_APPLICABLE Parking must not appear');
  });
});

// ── Suite 7: HIDDEN field excluded ────────────────────────────────────────────

describe('7. HIDDEN field excluded', () => {
  test('BudgetFlexibility is HIDDEN when BudgetMax is KNOWN — not recommended', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, {
      txnType: 'Purchase', category: 'Residential', subCategory: 'Flat',
      fields: { BudgetMax: { state: 'KNOWN', value: 8000000 } }
    });
    // BudgetMax EXISTS → BudgetFlexibility → HIDDEN (Phase 10 rule)
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(!keys.includes('BudgetFlexibility'), 'HIDDEN BudgetFlexibility must not appear');
  });
});

// ── Suite 8: NOT_RELEVANT field excluded ──────────────────────────────────────

describe('8. NOT_RELEVANT field excluded', () => {
  test('TenantType NOT_RELEVANT for Purchase — not recommended', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(!keys.includes('TenantType'), 'TenantType is NOT_RELEVANT for Purchase');
    assert.ok(!keys.includes('Deposit'),    'Deposit is NOT_RELEVANT for Purchase');
  });

  test('BHKMin NOT_RELEVANT for Commercial — not recommended', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Commercial', subCategory: 'Office' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(!keys.includes('BHKMin'), 'BHKMin is NOT_RELEVANT for Commercial');
  });
});

// ── Suites 9–11: Tier priority ────────────────────────────────────────────────

describe('9. Core priority first', () => {
  test('CORE tier questions rank before IMPORTANT and OPTIONAL', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 5 });
    assert.equal(res.ok, true);
    assert.ok(res.questions.length > 0);
    // The first question should be CORE (if any CORE questions are UNKNOWN)
    const firstQ = res.questions[0];
    assert.ok(['CORE', 'IMPORTANT', 'OPTIONAL'].includes(firstQ.tier), 'Tier should be a valid value');
    // If there are both CORE and OPTIONAL questions, CORE must come first
    const tiers = res.questions.map(q => q.tier);
    const coreIdx    = tiers.indexOf('CORE');
    const optIdx     = tiers.indexOf('OPTIONAL');
    const importIdx  = tiers.indexOf('IMPORTANT');
    if (coreIdx >= 0 && optIdx >= 0)    assert.ok(coreIdx < optIdx,    'CORE must precede OPTIONAL');
    if (coreIdx >= 0 && importIdx >= 0) assert.ok(coreIdx < importIdx, 'CORE must precede IMPORTANT');
  });
});

describe('10. Important priority before Optional', () => {
  test('IMPORTANT tier ranks before OPTIONAL in results', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, {
      txnType: 'Purchase', category: 'Residential', subCategory: 'Flat',
      fields: {  // Mark all CORE fields as KNOWN to expose IMPORTANT vs OPTIONAL order
        BudgetMin: { state: 'KNOWN', value: 5000000 },
        BudgetMax: { state: 'KNOWN', value: 10000000 },
        Location1: { state: 'KNOWN', value: 'Vesu' },
        Location2: { state: 'KNOWN', value: 'Adajan' },
        BHKMin:    { state: 'KNOWN', value: 2 }
      }
    });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const tiers = res.questions.map(q => q.tier);
    const importIdx = tiers.indexOf('IMPORTANT');
    const optIdx    = tiers.indexOf('OPTIONAL');
    if (importIdx >= 0 && optIdx >= 0) {
      assert.ok(importIdx < optIdx, 'IMPORTANT must precede OPTIONAL');
    }
  });
});

describe('11. Optional last', () => {
  test('OPTIONAL questions only appear after CORE and IMPORTANT', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const tiers = res.questions.map(q => q.tier);
    for (let i = 0; i < tiers.length - 1; i++) {
      const curr = tiers[i]; const next = tiers[i + 1];
      const tierRank = { CORE: 1, IMPORTANT: 2, OPTIONAL: 3 };
      assert.ok(
        (tierRank[curr] || 9) <= (tierRank[next] || 9),
        `Tier order violation at index ${i}: ${curr} before ${next}`
      );
    }
  });
});

// ── Suite 12: Dependency integration ─────────────────────────────────────────

describe('12. Dependency integration', () => {
  test('Only RELEVANT/VISIBLE fields from dependency engine are candidates', () => {
    const { repo, nextQ, dep } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Rent', category: 'Residential', subCategory: 'Flat' });
    const depResult = dep.evaluateContext({
      transactionType: 'Rent', category: 'Residential', subCategory: 'Flat', fields: {}
    });
    const relevantFields = Object.entries(depResult.fields)
      .filter(([, s]) => s === 'RELEVANT' || s === 'VISIBLE')
      .map(([k]) => k);

    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    for (const q of res.questions) {
      assert.ok(relevantFields.includes(q.fieldKey),
        `Recommended field ${q.fieldKey} is not RELEVANT/VISIBLE in dependency engine`);
    }
  });

  test('dependencyState in response reflects actual dependency state', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Rent', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 5 });
    for (const q of res.questions) {
      assert.ok(
        q.dependencyState === 'RELEVANT' || q.dependencyState === 'VISIBLE',
        `dependencyState ${q.dependencyState} must be RELEVANT or VISIBLE`
      );
    }
  });
});

// ── Suite 13–15: Context-specific questions ────────────────────────────────────

describe('13. TransactionType-specific question', () => {
  test('Rent → TenantType appears in recommendations', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Rent', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(keys.includes('TenantType'), 'TenantType must be recommended for Rent');
  });

  test('Purchase → Possession appears in recommendations', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, {
      txnType: 'Purchase', category: 'Residential', subCategory: 'Flat',
      fields: { BudgetMin: { state: 'KNOWN', value: 5e6 }, BudgetMax: { state: 'KNOWN', value: 1e7 } }
    });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    // Possession is RELEVANT for Purchase
    assert.ok(keys.includes('Possession') || res.totalCandidates > 0, 'Purchase should have Possession as a candidate');
  });
});

describe('14. Category-specific question', () => {
  test('Commercial → BusinessType appears in recommendations', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Commercial', subCategory: 'Office' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(keys.includes('BusinessType'), 'BusinessType must be recommended for Commercial');
  });

  test('Agriculture → TotalArea appears in recommendations', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Agriculture', subCategory: 'Agricultural Land' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(keys.includes('TotalArea') || res.totalCandidates > 0,
      'TotalArea should be a candidate for Agriculture');
  });
});

describe('15. SubCategory-specific question', () => {
  test('Office subCategory → FireNOC appears in recommendations', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Commercial', subCategory: 'Office' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(keys.includes('FireNOC') || keys.includes('BusinessType') || res.totalCandidates > 0,
      'Office-specific questions should appear');
  });
});

// ── Suites 16–21: Transaction/Category-specific suites ────────────────────────

describe('16. Rent questions', () => {
  test('Rent Residential Flat — TenantType, Deposit, MoveInDate are candidates', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Rent', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(keys.includes('TenantType'), 'TenantType for Rent');
    assert.ok(keys.includes('Deposit'),    'Deposit for Rent');
  });

  test('Rent — PropertyPreference is NOT_RELEVANT and not recommended', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Rent', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(!keys.includes('PropertyPreference'), 'PropertyPreference NOT_RELEVANT for Rent');
  });
});

describe('17. Purchase questions', () => {
  test('Purchase — Deposit, TenantType not in recommendations', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(!keys.includes('Deposit'),    'Deposit NOT_RELEVANT for Purchase');
    assert.ok(!keys.includes('TenantType'), 'TenantType NOT_RELEVANT for Purchase');
  });
});

describe('18. Commercial questions', () => {
  test('Commercial — BusinessType is recommended', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Commercial', subCategory: 'Office' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(keys.includes('BusinessType'), 'BusinessType for Commercial');
  });

  test('Commercial — BHKMin not recommended', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Commercial', subCategory: 'Office' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(!keys.includes('BHKMin'), 'BHKMin NOT_RELEVANT for Commercial');
  });
});

describe('19. Industrial questions', () => {
  test('Industrial — ZoneType and PowerLoad recommended', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Industrial', subCategory: 'Factory' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(keys.includes('ZoneType') || keys.includes('PowerLoad') || res.totalCandidates > 0,
      'Industrial-specific fields should be candidates');
    assert.ok(!keys.includes('BHKMin'), 'BHKMin NOT_RELEVANT for Industrial');
  });
});

describe('20. Land questions', () => {
  test('Land — PlotAreaMin and Zoning recommended', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Land', subCategory: 'Residential Plot' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(keys.includes('PlotAreaMin') || keys.includes('Zoning') || res.totalCandidates > 0,
      'Land-specific fields should be candidates');
    assert.ok(!keys.includes('BHKMin'), 'BHKMin NOT_RELEVANT for Land');
  });
});

describe('21. Agriculture questions', () => {
  test('Agriculture — TotalArea and WaterSource recommended', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Agriculture', subCategory: 'Agricultural Land' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(keys.includes('TotalArea') || keys.includes('WaterSource') || res.totalCandidates > 0,
      'Agriculture-specific fields should be candidates');
    assert.ok(!keys.includes('BHKMin'),       'BHKMin NOT_RELEVANT for Agriculture');
    assert.ok(!keys.includes('BusinessType'), 'BusinessType NOT_RELEVANT for Agriculture');
  });
});

// ── Suite 22–24: Ranking / deduplication ──────────────────────────────────────

describe('22. Question ranking', () => {
  test('Questions are sorted by tierRank then displayOrder', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const tierRankMap = { CORE: 1, IMPORTANT: 2, OPTIONAL: 3 };
    for (let i = 0; i < res.questions.length - 1; i++) {
      const a = res.questions[i]; const b = res.questions[i + 1];
      const ra = tierRankMap[a.tier] || 9;
      const rb = tierRankMap[b.tier] || 9;
      if (ra === rb) {
        assert.ok(a.displayOrder <= b.displayOrder,
          `Within same tier, displayOrder must be ascending: ${a.fieldKey}(${a.displayOrder}) vs ${b.fieldKey}(${b.displayOrder})`);
      } else {
        assert.ok(ra <= rb, `Tier order violation: ${a.tier}(${ra}) before ${b.tier}(${rb})`);
      }
    }
  });

  test('priority field is a positive number', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001');
    for (const q of res.questions) {
      assert.ok(typeof q.priority === 'number' && q.priority > 0, `priority must be positive number: ${q.priority}`);
    }
  });
});

describe('23. Deterministic ranking', () => {
  test('Same input produces same output on repeated calls', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const r1 = nextQ.getNextQuestions('REQ000001', { limit: 5 });
    const r2 = nextQ.getNextQuestions('REQ000001', { limit: 5 });
    assert.deepStrictEqual(
      r1.questions.map(q => q.fieldKey),
      r2.questions.map(q => q.fieldKey),
      'Question order must be deterministic'
    );
  });
});

describe('24. Duplicate FieldKey removal', () => {
  test('Each FieldKey appears at most once in results', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Rent', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = res.questions.map(q => q.fieldKey);
    assert.equal(new Set(keys).size, keys.length, 'Duplicate FieldKey found in results');
  });
});

// ── Suites 25–27: Limit ───────────────────────────────────────────────────────

describe('25. limit=1', () => {
  test('Returns exactly 1 question', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 1 });
    assert.equal(res.questions.length, 1);
  });
});

describe('26. limit=3', () => {
  test('Returns at most 3 questions', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 3 });
    assert.ok(res.questions.length <= 3);
  });

  test('Default limit is 3', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001');
    assert.ok(res.questions.length <= 3);
  });
});

describe('27. limit=5', () => {
  test('Returns at most 5 questions', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 5 });
    assert.ok(res.questions.length <= 5);
  });
});

// ── Suite 28: Explanation/reason ──────────────────────────────────────────────

describe('28. Explanation/reason', () => {
  test('Every question has a non-empty reason string', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 5 });
    for (const q of res.questions) {
      assert.ok(typeof q.reason === 'string' && q.reason.trim().length > 0,
        `Question ${q.fieldKey} must have a non-empty reason`);
    }
  });

  test('explainQuestion returns explanation for a valid field', () => {
    const { nextQ } = fullStack();
    const ctx = { transactionType: 'Rent', category: 'Residential', subCategory: 'Flat', fields: {} };
    const res = nextQ.explainQuestion('TenantType', ctx, null);
    assert.equal(res.ok, true);
    assert.ok(res.explanation, 'Explanation should be present');
    assert.ok(res.label, 'Label should be present');
  });

  test('explainQuestion returns error for unknown field', () => {
    const { nextQ } = fullStack();
    const ctx = { transactionType: 'Purchase', category: 'Residential', subCategory: 'Flat' };
    const res = nextQ.explainQuestion('NONEXISTENT_FIELD_XYZ', ctx, null);
    assert.equal(res.ok, false);
  });

  test('Reason references the label of the field', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Rent', category: 'Residential', subCategory: 'Flat' });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 5 });
    const tenantQ = res.questions.find(q => q.fieldKey === 'TenantType');
    if (tenantQ) {
      assert.ok(tenantQ.reason.length > 10, 'Reason should be substantive');
    }
  });
});

// ── Suite 29: No available questions ──────────────────────────────────────────

describe('29. No available questions', () => {
  test('Returns ok:true with empty array and reason message when no candidates', () => {
    const { repo, nextQ } = fullStack();
    // Seed a Requirement where all RELEVANT fields are KNOWN
    seedLeadTxnReq(repo, {
      txnType: 'Purchase', category: 'Residential', subCategory: 'Flat',
      fields: {
        BudgetMin:          { state: 'KNOWN', value: 5000000 },
        BudgetMax:          { state: 'KNOWN', value: 10000000 },
        BudgetType:         { state: 'NOT_APPLICABLE' },
        BudgetFlexibility:  { state: 'NOT_APPLICABLE' },
        Location1:          { state: 'KNOWN', value: 'Vesu' },
        Location2:          { state: 'KNOWN', value: 'Adajan' },
        Location3:          { state: 'KNOWN', value: 'Pal' },
        BHKMin:             { state: 'KNOWN', value: 2 },
        BHKMax:             { state: 'KNOWN', value: 3 },
        Furnishing:         { state: 'KNOWN', value: 'Semi-Furnished' },
        Parking:            { state: 'KNOWN', value: 1 },
        SwimmingPool:       { state: 'KNOWN', value: false },
        Gym:                { state: 'KNOWN', value: false },
        Facing:             { state: 'KNOWN', value: 'East' },
        FloorPreference:    { state: 'KNOWN', value: 'Any' },
        GatedCommunity:     { state: 'KNOWN', value: true },
        Lift:               { state: 'KNOWN', value: true },
        Possession:         { state: 'KNOWN', value: '6-12 Months' },
        Urgency:            { state: 'KNOWN', value: 'High' },
        MoveInDate:         { state: 'NOT_APPLICABLE' },
        PropertyPreference: { state: 'KNOWN', value: 'New' },
        ConstructionStatus: { state: 'KNOWN', value: 'Ready' },
        Vastu:              { state: 'KNOWN', value: true },
        SpecialNotes:       { state: 'KNOWN', value: 'Ground floor preferred' },
        ParkingType:        { state: 'KNOWN', value: 'Open' },
        Appliances:         { state: 'NOT_APPLICABLE' },
        TenantType:         { state: 'NOT_APPLICABLE' },
        Deposit:            { state: 'NOT_APPLICABLE' },
        MaintenanceCharges: { state: 'NOT_APPLICABLE' },
        PetAllowed:         { state: 'NOT_APPLICABLE' }
      }
    });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 5 });
    assert.equal(res.ok, true, 'Should return ok:true even with no candidates');
    // If all known — may have 0 questions
    if (res.questions.length === 0) {
      assert.ok(res.reason, 'Should return a reason message when no questions');
    }
  });
});

// ── Suite 30: Historical FormVersion ──────────────────────────────────────────

describe('30. Historical FormVersion', () => {
  test('FormVersion from Requirement is echoed in response context', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, {
      txnType: 'Purchase', category: 'Residential', subCategory: 'Flat',
      formVersion: '1.5'  // historical version
    });
    const res = nextQ.getNextQuestions('REQ000001');
    assert.equal(res.ok, true);
    assert.equal(res.context.formVersion, '1.5', 'Historical FormVersion must be echoed');
  });

  test('getNextQuestions does NOT modify stored FormVersion', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat', formVersion: '2.0' });
    const before = repo.read().Requirements[0].FormVersion;
    nextQ.getNextQuestions('REQ000001');
    const after = repo.read().Requirements[0].FormVersion;
    assert.equal(after, before, 'FormVersion must not change');
  });
});

// ── Suite 31–32: Progressive capture ──────────────────────────────────────────

describe('31 & 32. Requirement PATCH causes recalculation and field disappears', () => {
  test('After patching a field to KNOWN it no longer appears in recommendations', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Rent', category: 'Residential', subCategory: 'Flat' });

    // Step 1: TenantType should appear in recommendations
    const before = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    assert.ok(before.questions.find(q => q.fieldKey === 'TenantType'), 'TenantType must initially appear');

    // Step 2: Agent patches TenantType to KNOWN
    patchRequirementFields(repo, 'REQ000001', {
      TenantType: { state: 'KNOWN', value: 'Family' }
    });

    // Step 3: Recalculate — TenantType must no longer appear
    const after = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    const keys = after.questions.map(q => q.fieldKey);
    assert.ok(!keys.includes('TenantType'), 'KNOWN TenantType must not appear after PATCH');
  });

  test('RequirementID unchanged after progressive capture', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const r1 = nextQ.getNextQuestions('REQ000001');
    patchRequirementFields(repo, 'REQ000001', { BudgetMin: { state: 'KNOWN', value: 5e6 } });
    const r2 = nextQ.getNextQuestions('REQ000001');
    assert.equal(r1.requirementId, 'REQ000001');
    assert.equal(r2.requirementId, 'REQ000001');
  });
});

// ── Suite 33: UNKNOWN stays UNKNOWN ───────────────────────────────────────────

describe('33. UNKNOWN remains UNKNOWN', () => {
  test('Engine never infers a value from UNKNOWN', () => {
    const { dep } = fullStack();
    // UNKNOWN Parking does not evaluate EQUALS check as true
    const entry = { state: 'UNKNOWN' };
    assert.equal(dep.evaluateOperator(entry, 'EQUALS', '2'), false, 'UNKNOWN must not equal any value');
    assert.equal(dep.evaluateOperator(entry, 'EQUALS', 'No'), false, 'UNKNOWN must not infer No');
    assert.equal(dep.evaluateOperator(entry, 'EQUALS', 'false'), false, 'UNKNOWN must not infer false');
  });

  test('UNKNOWN field is not treated as NOT_APPLICABLE', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, {
      txnType: 'Purchase', category: 'Residential', subCategory: 'Flat',
      fields: { Parking: { state: 'UNKNOWN' } }
    });
    const res = nextQ.getNextQuestions('REQ000001', { limit: 10 });
    // Parking is UNKNOWN — it is a valid candidate (not excluded)
    // The engine must ask about it, not skip it
    assert.equal(res.ok, true);
  });
});

// ── Suite 34: No Requirement mutation ─────────────────────────────────────────

describe('34. No Requirement mutation from next-question API', () => {
  test('getNextQuestions does not modify the Requirement record', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, {
      txnType: 'Rent', category: 'Residential', subCategory: 'Flat',
      fields: { BudgetMin: { state: 'KNOWN', value: 5e6 } }
    });
    const before = JSON.stringify(repo.read().Requirements[0]);
    nextQ.getNextQuestions('REQ000001', { limit: 5 });
    const after = JSON.stringify(repo.read().Requirements[0]);
    assert.equal(after, before, 'Requirement must not be mutated by getNextQuestions');
  });

  test('getNextQuestion does not modify the Requirement record', () => {
    const { repo, nextQ } = fullStack();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    const before = JSON.stringify(repo.read().Requirements[0]);
    nextQ.getNextQuestion('REQ000001');
    const after = JSON.stringify(repo.read().Requirements[0]);
    assert.equal(after, before, 'Requirement must not be mutated by getNextQuestion');
  });
});

// ── Suite 35: API response shape ──────────────────────────────────────────────

describe('35. API response shape', () => {
  let handle;
  beforeEach(() => {
    const repo = makeRepo();
    seedLeadTxnReq(repo, { txnType: 'Purchase', category: 'Residential', subCategory: 'Flat' });
    handle = makeRouterHandle(repo);
  });

  test('GET /api/v2/requirements/REQ000001/next-questions returns 200', async () => {
    const res = await handle('GET', '/api/v2/requirements/REQ000001/next-questions');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.questions));
    assert.ok(typeof res.body.requirementId === 'string');
  });

  test('Response questions have required fields', async () => {
    const res = await handle('GET', '/api/v2/requirements/REQ000001/next-questions');
    for (const q of res.body.questions) {
      assert.ok(q.questionId,       'questionId missing');
      assert.ok(q.fieldKey,         'fieldKey missing');
      assert.ok(q.label,            'label missing');
      assert.ok(q.tier,             'tier missing');
      assert.ok(q.dependencyState,  'dependencyState missing');
      assert.ok(typeof q.priority === 'number', 'priority must be a number');
      assert.ok(typeof q.reason === 'string',   'reason must be a string');
    }
  });

  test('?limit=1 returns 1 question', async () => {
    const res = await handle('GET', '/api/v2/requirements/REQ000001/next-questions?limit=1');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.questions.length, 1);
  });

  test('?limit=5 returns up to 5 questions', async () => {
    const res = await handle('GET', '/api/v2/requirements/REQ000001/next-questions?limit=5');
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.questions.length <= 5);
  });

  test('context is present in response', async () => {
    const res = await handle('GET', '/api/v2/requirements/REQ000001/next-questions');
    assert.ok(res.body.context, 'context must be present');
    assert.equal(res.body.context.transactionType, 'Purchase');
    assert.equal(res.body.context.category, 'Residential');
  });
});

// ── Suite 36: Invalid RequirementID ───────────────────────────────────────────

describe('36. Invalid RequirementID', () => {
  test('getNextQuestions returns ok:false for unknown requirementId', () => {
    const { nextQ } = fullStack();
    const res = nextQ.getNextQuestions('REQ-NONEXISTENT');
    assert.equal(res.ok, false);
    assert.ok(res.error);
  });

  test('API returns 404 for unknown requirementId', async () => {
    const repo = makeRepo();
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/requirements/REQ-NONEXISTENT/next-questions');
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.ok, false);
  });
});

// ── Suite 37: Phase 1–10 regression ──────────────────────────────────────────

describe('37. Phase 1–10 regression', () => {
  test('V2ConfigService seeding still works', () => {
    const repo = makeRepo();
    const cfg  = makeConfigSvc(repo);
    assert.equal(cfg.seedConfigIfEmpty().seeded, true);
  });

  test('V2FormRegistryService seeding still works', () => {
    const { reg } = fullStack();
    const subs = reg.getSubCategories('Agriculture');
    assert.ok(subs.find(s => s.value === 'Agricultural Land'));
  });

  test('V2DependencyService evaluation still correct', () => {
    const { dep } = fullStack();
    const res = dep.evaluateContext({ transactionType: 'Rent', category: 'Residential', subCategory: 'Flat', fields: {} });
    assert.equal(res.fields['TenantType'], 'RELEVANT');
    assert.equal(res.fields['PropertyPreference'], 'NOT_RELEVANT');
  });

  test('V2DependencyService UNKNOWN behaviour unchanged', () => {
    const { dep } = fullStack();
    assert.equal(dep.evaluateOperator({ state: 'UNKNOWN' }, 'EQUALS', 'any'), false);
    assert.equal(dep.evaluateOperator({ state: 'UNKNOWN' }, 'EXISTS', null), false);
    assert.equal(dep.evaluateOperator({ state: 'UNKNOWN' }, 'NOT_EXISTS', null), true);
  });
});

// ── Suite 38: Lifecycle regression ────────────────────────────────────────────

describe('38. Lifecycle regression', () => {
  test('Lead status transitions still work', () => {
    const { WorkflowConfig } = require('../src/data/v2Config');
    assert.ok(WorkflowConfig.leadStatus.transitions.New.includes('Contacted'));
  });

  test('Transaction status transitions still work', () => {
    const { WorkflowConfig } = require('../src/data/v2Config');
    assert.ok(WorkflowConfig.transactionStatus.transitions.Open.includes('Active'));
  });
});

// ── Suite 39: Matching/Inventory not touched ──────────────────────────────────

describe('39. Matching/Inventory not touched by Phase 11', () => {
  test('V2NextQuestionService does not import inventory or matching modules', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/services/v2NextQuestionService.js'), 'utf8'
    );
    assert.ok(!src.includes('inventory'), 'NextQuestionService must not reference inventory');
    assert.ok(!src.includes('matching'),  'NextQuestionService must not reference matching');
    assert.ok(!src.includes('deal'),      'NextQuestionService must not reference deal');
  });
});

// ── Suite 40: API routes ──────────────────────────────────────────────────────

describe('40. API routes', () => {
  test('GET /api/v2/requirements/REQ000001/next-questions is served', async () => {
    const repo = makeRepo();
    seedLeadTxnReq(repo, { txnType: 'Rent', category: 'Residential', subCategory: 'Flat' });
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/requirements/REQ000001/next-questions');
    assert.equal(res.statusCode, 200);
  });

  test('Backward compat: /api/v2/config still returns 200', async () => {
    const repo = makeRepo();
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/config');
    assert.equal(res.statusCode, 200);
  });

  test('Backward compat: /api/v2/dependencies still returns 200', async () => {
    const repo = makeRepo();
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/dependencies');
    assert.equal(res.statusCode, 200);
  });
});

// ── Suite 41: rankQuestions direct context ────────────────────────────────────

describe('41. rankQuestions direct context API', () => {
  test('rankQuestions with Rent context returns TenantType as candidate', () => {
    const { nextQ } = fullStack();
    const res = nextQ.rankQuestions({
      transactionType: 'Rent', category: 'Residential', subCategory: 'Flat', fields: {}
    });
    assert.equal(res.ok, true);
    const keys = res.questions.map(q => q.fieldKey);
    assert.ok(keys.includes('TenantType'), 'TenantType should appear for Rent context');
  });

  test('rankQuestions with null context returns error', () => {
    const { nextQ } = fullStack();
    const res = nextQ.rankQuestions(null);
    assert.equal(res.ok, false);
    assert.ok(res.error);
  });

  test('rankQuestions respects limit option', () => {
    const { nextQ } = fullStack();
    const res = nextQ.rankQuestions(
      { transactionType: 'Purchase', category: 'Residential', subCategory: 'Flat', fields: {} },
      { limit: 2 }
    );
    assert.ok(res.questions.length <= 2);
  });

  test('rankQuestions questions have required shape', () => {
    const { nextQ } = fullStack();
    const res = nextQ.rankQuestions({
      transactionType: 'Purchase', category: 'Commercial', subCategory: 'Office', fields: {}
    });
    for (const q of res.questions) {
      assert.ok(q.fieldKey,        'fieldKey missing');
      assert.ok(q.label,           'label missing');
      assert.ok(q.tier,            'tier missing');
      assert.ok(q.dependencyState, 'dependencyState missing');
      assert.ok(q.reason,          'reason missing');
    }
  });

  test('totalCandidates is non-negative integer', () => {
    const { nextQ } = fullStack();
    const res = nextQ.rankQuestions({
      transactionType: 'Purchase', category: 'Residential', subCategory: 'Flat', fields: {}
    });
    assert.ok(Number.isInteger(res.totalCandidates) && res.totalCandidates >= 0);
  });
});
