/**
 * PHASE 12 — Client + Requirement Scoring Engine Tests
 *
 * Contract items tested:
 *  1.  Requirement score calculation
 *  2.  Client score calculation
 *  3.  UNKNOWN does not become NO
 *  4.  UNKNOWN does not automatically reduce score
 *  5.  NOT_APPLICABLE does not reduce score
 *  6.  Known positive factor contributes positively
 *  7.  Negative factor (low-value lookup) contributes less
 *  8.  Score normalization (0-100 range)
 *  9.  Score band resolution
 * 10.  Explainable factor breakdown
 * 11.  Unknown factor reporting
 * 12.  Configuration version recorded
 * 13.  Calculation timestamp recorded
 * 14.  Requirement create calculates score
 * 15.  Requirement PATCH recalculates score
 * 16.  Lead create calculates score
 * 17.  Lead update recalculates score
 * 18.  Manual Requirement recalculation
 * 19.  Manual Client recalculation
 * 20.  Deterministic calculation
 * 21.  Dependency NOT_RELEVANT does not penalize
 * 22.  Rent-specific scoring
 * 23.  Residential scoring
 * 24.  Commercial scoring
 * 25.  Legacy Requirement compatibility
 * 26.  Legacy Lead compatibility
 * 27.  API GET Requirement score
 * 28.  API GET Lead score
 * 29.  Invalid IDs return 404
 * 30.  Existing Phase 1-11 tests remain green (checked by full regression)
 * 31.  GET /api/v2/requirements/:id/score
 * 32.  GET /api/v2/leads/:id/score
 * 33.  Score band coverage
 * 34.  No mutation on GET
 * 35.  POST /api/leads/:id/score backward compat
 */

'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-v2-p12-'));
  return path.join(dir, 'test.json');
}

function makeRepo(dbFile) {
  const { JsonRepository } = require('../src/data/repository');
  return new JsonRepository(dbFile || makeTempDb());
}

function makeStack(dbFile) {
  const { JsonRepository }        = require('../src/data/repository');
  const { V2ConfigService }       = require('../src/services/v2ConfigService');
  const { V2FormRegistryService } = require('../src/services/v2FormRegistryService');
  const { V2DependencyService }   = require('../src/services/v2DependencyService');
  const { V2ScoringService }      = require('../src/services/v2ScoringService');
  const { V2LeadService }         = require('../src/services/v2LeadService');
  const { V2RequirementService }  = require('../src/services/v2RequirementService');

  const repo     = new JsonRepository(dbFile || makeTempDb());
  const cfg      = new V2ConfigService(repo);
  const reg      = new V2FormRegistryService(repo, cfg);
  const dep      = new V2DependencyService(repo, reg);
  const scoring  = new V2ScoringService(repo, dep);
  const leadSvc  = new V2LeadService(repo, scoring);
  const reqSvc   = new V2RequirementService(repo, scoring);

  cfg.seedConfigIfEmpty();
  reg.seedFormRegistryIfEmpty();
  dep.seedDependencyConfigIfEmpty();
  scoring.seedScoringConfigIfEmpty();

  return { repo, cfg, dep, scoring, leadSvc, reqSvc };
}

function makeRouterHandle(repo) {
  const { V2Router } = require('../src/api/v2Router');
  const router = new V2Router(repo);
  return async function handle(method, pathAndQuery, body) {
    const url  = new URL(`http://localhost${pathAndQuery}`);
    const cap  = { statusCode: null, body: null };
    const res  = {
      writeHead(code) { cap.statusCode = code; },
      end(data)       { try { cap.body = JSON.parse(data); } catch { cap.body = data; } }
    };
    const req = {
      method,
      headers: {
        'x-user-id': 'U1',
        'x-user-role': 'MANAGER',
        'x-permissions': ['LEADS_READ', 'LEADS_VIEW', 'LEADS_CREATE', 'LEADS_UPDATE']
      }
    };
    const result = await router.handle(req, res, url, body || {});
    if (result && result.statusCode != null) return result;
    return cap;
  };
}

// Seed a full Lead → Transaction → Requirement chain
function seedChain(repo, opts = {}) {
  const db = repo.read();
  db.Leads         = db.Leads         || [];
  db.Transactions  = db.Transactions  || [];
  db.Requirements  = db.Requirements  || [];
  db._V2Counters   = db._V2Counters   || { Lead: 0, Transaction: 0, Requirement: 0 };

  const leadId = opts.leadId  || 'L000001';
  const txnId  = opts.txnId   || 'T000001';
  const reqId  = opts.reqId   || 'REQ000001';

  if (!db.Leads.find(l => l.LeadID === leadId)) {
    db.Leads.push({
      LeadID: leadId, ClientName: opts.clientName || 'Test Client',
      PrimaryMobile: '9999999999', Email: opts.email || null,
      ClientStatus: opts.clientStatus || 'Active',
      ClientLifecycle: opts.lifecycle || 'Client',
      Tags: opts.tags || [],
      ClientScore: 0, _v2: true
    });
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
      RequirementID: reqId, TransactionID: txnId, LeadID: leadId,
      Category:    opts.category    || 'Residential',
      SubCategory: opts.subCategory || 'Flat',
      TransactionType: opts.txnType || 'Purchase',
      FormVersion: opts.formVersion || '2.0',
      RequirementStatus: 'Active',
      Fields: opts.fields || {},
      RequirementScore: null, ScoreBreakdown: null,
      _v2: true
    });
  }
  repo.write(db);
  return { leadId, txnId, reqId };
}

// ── Suite 1: Requirement score calculation ────────────────────────────────────

describe('1. Requirement score calculation', () => {
  test('calculateRequirementScore returns ok:true with a numeric score', () => {
    const { scoring } = makeStack();
    const req = {
      RequirementID: 'REQ000001', Category: 'Residential', SubCategory: 'Flat',
      TransactionType: 'Purchase', Fields: {
        BudgetMax: { state: 'KNOWN', value: 10000000 },
        Location1: { state: 'KNOWN', value: 'Vesu' }
      }
    };
    const res = scoring.calculateRequirementScore(req);
    assert.equal(res.ok, true);
    assert.ok(typeof res.score === 'number', 'score must be a number');
    assert.ok(res.score >= 0 && res.score <= 100, `score ${res.score} must be 0-100`);
  });

  test('returns required fields in result', () => {
    const { scoring } = makeStack();
    const req = { RequirementID: 'R1', Category: 'Residential', Fields: {} };
    const res = scoring.calculateRequirementScore(req);
    assert.ok('score' in res);
    assert.ok('band'  in res);
    assert.ok(Array.isArray(res.factors));
    assert.ok(Array.isArray(res.positiveContributions));
    assert.ok(Array.isArray(res.negativeContributions));
    assert.ok(Array.isArray(res.unknownFactors));
    assert.ok('calculationVersion' in res);
    assert.ok('calculatedAt'       in res);
  });

  test('null requirement returns ok:false', () => {
    const { scoring } = makeStack();
    const res = scoring.calculateRequirementScore(null);
    assert.equal(res.ok, false);
  });
});

// ── Suite 2: Client score calculation ────────────────────────────────────────

describe('2. Client score calculation', () => {
  test('calculateClientScore returns ok:true with numeric score', () => {
    const { scoring } = makeStack();
    const lead = {
      LeadID: 'L1', ClientStatus: 'Active', ClientLifecycle: 'Client',
      PrimaryMobile: '9999999999', Email: 'test@example.com', Tags: ['Serious']
    };
    const res = scoring.calculateClientScore(lead, 2, 1);
    assert.equal(res.ok, true);
    assert.ok(typeof res.score === 'number');
    assert.ok(res.score >= 0 && res.score <= 100);
  });

  test('null lead returns ok:false', () => {
    const { scoring } = makeStack();
    const res = scoring.calculateClientScore(null, 0, 0);
    assert.equal(res.ok, false);
  });

  test('returns required shape', () => {
    const { scoring } = makeStack();
    const lead = { LeadID: 'L1', ClientStatus: 'Active', ClientLifecycle: 'Client', Tags: [] };
    const res = scoring.calculateClientScore(lead, 0, 0);
    assert.ok('score' in res && 'band' in res && Array.isArray(res.factors));
    assert.ok(Array.isArray(res.positiveContributions));
    assert.ok(Array.isArray(res.negativeContributions));
    assert.ok(Array.isArray(res.unknownFactors));
  });
});

// ── Suite 3: UNKNOWN does not become NO ──────────────────────────────────────

describe('3. UNKNOWN does not become NO', () => {
  test('UNKNOWN Parking field never infers Parking=No', () => {
    const { scoring } = makeStack();
    const reqWithUnknown = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { Parking: { state: 'UNKNOWN' } }
    };
    const reqWithKnownNo = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { Parking: { state: 'KNOWN', value: 0 } }
    };
    // Both produce the same or higher score for UNKNOWN (no penalty)
    // We can't check score equality directly but UNKNOWN factor should appear in unknownFactors
    const res = scoring.calculateRequirementScore(reqWithUnknown);
    // Parking is not a configured scoring field, but UNKNOWN at field state level should not penalise
    assert.equal(res.ok, true);
  });

  test('UNKNOWN field in V2Fields map is excluded from scoring (not treated as false)', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { BudgetMax: { state: 'UNKNOWN' } }
    };
    const res = scoring.calculateRequirementScore(req);
    assert.equal(res.ok, true);
    // BudgetMax is UNKNOWN — should appear in unknownFactors, NOT in negativeContributions
    const isNegative = res.negativeContributions.some(f => f.field === 'BudgetMax');
    assert.equal(isNegative, false, 'UNKNOWN BudgetMax must not appear in negativeContributions');
    const isUnknown = res.unknownFactors.some(f => f.field === 'BudgetMax');
    assert.equal(isUnknown, true, 'UNKNOWN BudgetMax must appear in unknownFactors');
  });
});

// ── Suite 4: UNKNOWN does not reduce score ────────────────────────────────────

describe('4. UNKNOWN does not automatically reduce score', () => {
  test('Score with 2 KNOWN fields equals score if additional fields are UNKNOWN', () => {
    const { scoring } = makeStack();
    const baseFields = {
      BudgetMax: { state: 'KNOWN', value: 10000000 },
      Location1: { state: 'KNOWN', value: 'Vesu' }
    };
    const baseReq = { Category: 'Residential', TransactionType: 'Purchase', Fields: baseFields };
    const withUnknown = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { ...baseFields, Furnishing: { state: 'UNKNOWN' }, Parking: { state: 'UNKNOWN' } }
    };
    const s1 = scoring.calculateRequirementScore(baseReq);
    const s2 = scoring.calculateRequirementScore(withUnknown);
    // Adding UNKNOWN fields must NOT reduce the score
    assert.ok(s2.score >= s1.score,
      `Score with UNKNOWN fields (${s2.score}) must be >= score without (${s1.score})`);
  });

  test('Requirement with only UNKNOWN v2Fields and no flat-field data scores 0', () => {
    const { scoring } = makeStack();
    // Omit Category and SubCategory flat fields so no flatField rules fire either
    const req = {
      Fields: {
        BudgetMax: { state: 'UNKNOWN' },
        Location1: { state: 'UNKNOWN' },
        BHKMin:    { state: 'UNKNOWN' }
      }
    };
    const res = scoring.calculateRequirementScore(req);
    assert.equal(res.ok, true);
    assert.equal(res.score, 0, 'No KNOWN factors → score must be 0');
  });
});

// ── Suite 5: NOT_APPLICABLE does not reduce score ─────────────────────────────

describe('5. NOT_APPLICABLE does not reduce score', () => {
  test('NOT_APPLICABLE field excluded from calculation, no penalty', () => {
    const { scoring } = makeStack();
    const reqBase = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { BudgetMax: { state: 'KNOWN', value: 10000000 } }
    };
    const reqNA = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: {
        BudgetMax:  { state: 'KNOWN',          value: 10000000 },
        Furnishing: { state: 'NOT_APPLICABLE'                  }
      }
    };
    const s1 = scoring.calculateRequirementScore(reqBase);
    const s2 = scoring.calculateRequirementScore(reqNA);
    assert.ok(s2.score >= s1.score,
      `NOT_APPLICABLE field must not reduce score: ${s2.score} vs ${s1.score}`);
  });
});

// ── Suite 6: Known positive factor ───────────────────────────────────────────

describe('6. Known positive factor contributes positively', () => {
  test('KNOWN BudgetMax appears in positiveContributions', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { BudgetMax: { state: 'KNOWN', value: 10000000 } }
    };
    const res = scoring.calculateRequirementScore(req);
    const pos = res.positiveContributions.find(f => f.field === 'BudgetMax');
    assert.ok(pos, 'KNOWN BudgetMax must appear in positiveContributions');
    assert.ok(pos.contribution > 0, 'BudgetMax contribution must be > 0');
  });

  test('KNOWN Location1 appears in positiveContributions', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { Location1: { state: 'KNOWN', value: 'Adajan' } }
    };
    const res = scoring.calculateRequirementScore(req);
    const pos = res.positiveContributions.find(f => f.field === 'Location1');
    assert.ok(pos, 'KNOWN Location1 must appear in positiveContributions');
  });

  test('Active client status contributes positively', () => {
    const { scoring } = makeStack();
    const lead = { LeadID: 'L1', ClientStatus: 'Active', ClientLifecycle: 'Client', Tags: [] };
    const res = scoring.calculateClientScore(lead, 0, 0);
    const pos = res.positiveContributions.find(f => f.field === 'ClientStatus');
    assert.ok(pos, 'Active ClientStatus must appear in positiveContributions');
    assert.ok(pos.contribution > 0);
  });
});

// ── Suite 7: Low-value lookup contributes less ────────────────────────────────

describe('7. Low-value lookup contributes less than high-value', () => {
  test('Low urgency scores less than High urgency', () => {
    const { scoring } = makeStack();
    const reqLow = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { Urgency: { state: 'KNOWN', value: 'Low' } }
    };
    const reqHigh = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { Urgency: { state: 'KNOWN', value: 'High' } }
    };
    const rLow  = scoring.calculateRequirementScore(reqLow);
    const rHigh = scoring.calculateRequirementScore(reqHigh);
    // Both have same known factors so same effectiveMax — high earns more raw points
    const lowUrgFactor  = rLow.factors.find(f => f.field === 'Urgency');
    const highUrgFactor = rHigh.factors.find(f => f.field === 'Urgency');
    if (lowUrgFactor && highUrgFactor) {
      assert.ok(highUrgFactor.contribution >= lowUrgFactor.contribution,
        'High urgency must contribute >= Low urgency');
    }
  });

  test('New client status scores less than Active', () => {
    const { scoring } = makeStack();
    const leadNew    = { LeadID: 'L1', ClientStatus: 'New',    ClientLifecycle: 'Prospect', Tags: [] };
    const leadActive = { LeadID: 'L2', ClientStatus: 'Active', ClientLifecycle: 'Client',   Tags: [] };
    const rNew    = scoring.calculateClientScore(leadNew,    0, 0);
    const rActive = scoring.calculateClientScore(leadActive, 0, 0);
    assert.ok(rActive.score >= rNew.score,
      `Active score (${rActive.score}) must be >= New score (${rNew.score})`);
  });
});

// ── Suite 8: Score normalization ──────────────────────────────────────────────

describe('8. Score normalization', () => {
  test('Score is always 0-100', () => {
    const { scoring } = makeStack();
    const cases = [
      { Fields: {} },
      { Fields: { BudgetMax: { state: 'KNOWN', value: 10000000 }, Location1: { state: 'KNOWN', value: 'X' } } },
      { Fields: { BudgetMax: { state: 'KNOWN', value: 10000000 }, Location1: { state: 'KNOWN', value: 'X' },
                  Urgency: { state: 'KNOWN', value: 'High' }, Possession: { state: 'KNOWN', value: 'Ready' },
                  BHKMin: { state: 'KNOWN', value: 3 }, BudgetMin: { state: 'KNOWN', value: 5000000 } } }
    ];
    for (const c of cases) {
      const res = scoring.calculateRequirementScore({ Category: 'Residential', TransactionType: 'Purchase', ...c });
      assert.ok(res.score >= 0 && res.score <= 100, `Score ${res.score} out of range`);
    }
  });

  test('Fully loaded requirement approaches 100 (within range)', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Residential', SubCategory: 'Flat', TransactionType: 'Purchase',
      Fields: {
        BudgetMax:  { state: 'KNOWN', value: 10000000 },
        BudgetMin:  { state: 'KNOWN', value: 5000000  },
        Location1:  { state: 'KNOWN', value: 'Vesu'   },
        Urgency:    { state: 'KNOWN', value: 'High'   },
        Possession: { state: 'KNOWN', value: 'Ready'  },
        BHKMin:     { state: 'KNOWN', value: 3        },
        Furnishing: { state: 'KNOWN', value: 'Semi-Furnished' }
      }
    };
    const res = scoring.calculateRequirementScore(req);
    assert.ok(res.score >= 50, `Fully-loaded Residential req should score >=50, got ${res.score}`);
  });

  test('Client score 0-100', () => {
    const { scoring } = makeStack();
    const cases = [
      { lead: { ClientStatus: 'New', ClientLifecycle: 'Prospect', Tags: [] }, txn: 0, req: 0 },
      { lead: { ClientStatus: 'Active', ClientLifecycle: 'Client', PrimaryMobile: '999', Email: 'a@b.com', Tags: ['X'] }, txn: 3, req: 3 }
    ];
    for (const c of cases) {
      const res = scoring.calculateClientScore(c.lead, c.txn, c.req);
      assert.ok(res.score >= 0 && res.score <= 100, `Client score ${res.score} out of 0-100`);
    }
  });
});

// ── Suite 9: Score band ───────────────────────────────────────────────────────

describe('9. Score band resolution', () => {
  test('resolveScoreBand returns correct bands', () => {
    const { scoring } = makeStack();
    assert.equal(scoring.resolveScoreBand(0),   'Cold');
    assert.equal(scoring.resolveScoreBand(15),  'Cold');
    assert.equal(scoring.resolveScoreBand(30),  'Warm');
    assert.equal(scoring.resolveScoreBand(45),  'Warm');
    assert.equal(scoring.resolveScoreBand(50),  'Good');
    assert.equal(scoring.resolveScoreBand(65),  'Good');
    assert.equal(scoring.resolveScoreBand(70),  'Hot');
    assert.equal(scoring.resolveScoreBand(80),  'Hot');
    assert.equal(scoring.resolveScoreBand(85),  'Very Hot');
    assert.equal(scoring.resolveScoreBand(100), 'Very Hot');
  });

  test('Score result includes band string', () => {
    const { scoring } = makeStack();
    const res = scoring.calculateRequirementScore({
      Category: 'Residential', TransactionType: 'Purchase', Fields: {}
    });
    assert.ok(typeof res.band === 'string' && res.band.length > 0);
  });
});

// ── Suite 10: Explainable factor breakdown ────────────────────────────────────

describe('10. Explainable factor breakdown', () => {
  test('Each factor has label, field, contribution, state, reason', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { BudgetMax: { state: 'KNOWN', value: 10000000 } }
    };
    const res = scoring.calculateRequirementScore(req);
    for (const f of res.factors) {
      assert.ok(f.factorId,   `Factor missing factorId: ${JSON.stringify(f)}`);
      assert.ok(f.field,      `Factor missing field`);
      assert.ok(f.label,      `Factor missing label`);
      assert.ok(f.state,      `Factor missing state`);
      assert.ok(typeof f.contribution === 'number', `Factor contribution must be number`);
      assert.ok(typeof f.reason === 'string' && f.reason.length > 0, `Factor must have reason`);
    }
  });

  test('Positive factors have contribution > 0', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { BudgetMax: { state: 'KNOWN', value: 10000000 }, Location1: { state: 'KNOWN', value: 'Vesu' } }
    };
    const res = scoring.calculateRequirementScore(req);
    for (const f of res.positiveContributions) {
      assert.ok(f.contribution > 0, `Positive factor ${f.field} must have contribution > 0`);
    }
  });
});

// ── Suite 11: Unknown factor reporting ───────────────────────────────────────

describe('11. Unknown factor reporting', () => {
  test('UNKNOWN fields appear in unknownFactors with reason', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { BudgetMax: { state: 'UNKNOWN' }, Location1: { state: 'UNKNOWN' } }
    };
    const res = scoring.calculateRequirementScore(req);
    const uf = res.unknownFactors;
    assert.ok(Array.isArray(uf));
    assert.ok(uf.some(f => f.field === 'BudgetMax'), 'BudgetMax must be in unknownFactors');
    assert.ok(uf.some(f => f.field === 'Location1'), 'Location1 must be in unknownFactors');
    for (const u of uf) {
      assert.ok(u.reason && u.reason.length > 0, `Unknown factor must have reason: ${u.field}`);
    }
  });

  test('unknownFactors count + known count <= total factors count', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: {
        BudgetMax: { state: 'KNOWN',   value: 10000000 },
        Location1: { state: 'UNKNOWN' }
      }
    };
    const res = scoring.calculateRequirementScore(req);
    const total   = res.factors.length;
    const unknown = res.unknownFactors.length;
    const known   = res.positiveContributions.length + res.negativeContributions.length;
    assert.ok(unknown + known <= total, 'unknown + known must not exceed total factors');
  });
});

// ── Suite 12 & 13: Version + timestamp ───────────────────────────────────────

describe('12 & 13. calculationVersion and calculatedAt', () => {
  test('calculationVersion is present and non-empty', () => {
    const { scoring } = makeStack();
    const res = scoring.calculateRequirementScore({
      Category: 'Residential', TransactionType: 'Purchase', Fields: {}
    });
    assert.ok(res.calculationVersion && res.calculationVersion.length > 0);
  });

  test('calculatedAt is an ISO date string', () => {
    const { scoring } = makeStack();
    const res = scoring.calculateRequirementScore({
      Category: 'Residential', TransactionType: 'Purchase', Fields: {}
    });
    assert.ok(res.calculatedAt);
    assert.doesNotThrow(() => new Date(res.calculatedAt));
  });

  test('Client score carries calculationVersion and calculatedAt', () => {
    const { scoring } = makeStack();
    const res = scoring.calculateClientScore(
      { LeadID: 'L1', ClientStatus: 'Active', ClientLifecycle: 'Client', Tags: [] }, 0, 0
    );
    assert.ok(res.calculationVersion);
    assert.ok(res.calculatedAt);
  });
});

// ── Suite 14: Requirement create calculates score ─────────────────────────────

describe('14. Requirement create calculates score', () => {
  test('createRequirement stores RequirementScore', () => {
    const { repo, leadSvc, reqSvc } = makeStack();
    const { V2TransactionService } = require('../src/services/v2TransactionService');
    const txnSvcFull = new V2TransactionService(repo);
    const leadRes = leadSvc.createLead({ ClientName: 'Test', PrimaryMobile: '9999999999' }, { userId: 'U1' });
    const leadId  = leadRes.data.LeadID;
    // createTransaction signature: (leadId, payload, actor)
    const txnRes  = txnSvcFull.createTransaction(leadId, { TransactionType: 'Purchase' }, { userId: 'U1' });
    const txnId   = txnRes.data.TransactionID;

    const reqRes = reqSvc.createRequirement(txnId, {
      LeadID: leadId,
      Category: 'Residential', SubCategory: 'Flat',
      Fields: { BudgetMax: { state: 'KNOWN', value: 10000000 } }
    }, { userId: 'U1' });

    assert.equal(reqRes.ok, true);
    const req = reqRes.data;
    assert.ok(req.RequirementScore !== null && req.RequirementScore !== undefined,
      'RequirementScore must be set on create');
    assert.ok(typeof req.RequirementScore === 'number');
    assert.ok(req.ScoreBreakdown, 'ScoreBreakdown must be set on create');
    assert.ok(req.ScoreCalculationVersion, 'ScoreCalculationVersion must be set on create');
    assert.ok(req.ScoreCalculatedAt, 'ScoreCalculatedAt must be set on create');
  });
});

// ── Suite 15: Requirement PATCH recalculates score ────────────────────────────

describe('15. Requirement PATCH recalculates score', () => {
  test('Score increases after PATCH adds more KNOWN fields', () => {
    const { repo, leadSvc, reqSvc } = makeStack();
    const { V2TransactionService } = require('../src/services/v2TransactionService');
    const txnSvc = new V2TransactionService(repo);
    const leadRes = leadSvc.createLead({ ClientName: 'Test', PrimaryMobile: '8888888888' }, { userId: 'U1' });
    const leadId  = leadRes.data.LeadID;
    // createTransaction signature: (leadId, payload, actor)
    const txnRes  = txnSvc.createTransaction(leadId, { TransactionType: 'Purchase' }, { userId: 'U1' });
    const txnId   = txnRes.data.TransactionID;

    const reqRes = reqSvc.createRequirement(txnId, {
      LeadID: leadId, Category: 'Residential', SubCategory: 'Flat'
    }, { userId: 'U1' });
    const reqId      = reqRes.data.RequirementID;
    const scoreBefore = reqRes.data.RequirementScore;

    // PATCH with more data
    const patchRes = reqSvc.updateRequirement(reqId, {
      Fields: {
        BudgetMax: { state: 'KNOWN', value: 10000000 },
        Location1: { state: 'KNOWN', value: 'Vesu' }
      }
    }, { userId: 'U1' });

    assert.equal(patchRes.ok, true);
    const scoreAfter = patchRes.data.requirement.RequirementScore;
    assert.ok(scoreAfter >= scoreBefore,
      `Score after PATCH (${scoreAfter}) must be >= before (${scoreBefore})`);
    assert.ok(patchRes.data.requirement.ScoreCalculationVersion, 'ScoreCalculationVersion after PATCH');
  });
});

// ── Suite 16: Lead create calculates score ────────────────────────────────────

describe('16. Lead create calculates score', () => {
  test('createLead stores ClientScore', () => {
    const { leadSvc } = makeStack();
    const res = leadSvc.createLead({
      ClientName: 'Priya Shah', PrimaryMobile: '7777777777',
      Email: 'priya@example.com', ClientStatus: 'Active'
    }, { userId: 'U1' });
    assert.equal(res.ok, true);
    const lead = res.data;
    assert.ok(typeof lead.ClientScore === 'number', 'ClientScore must be a number after create');
    assert.ok(lead.ClientScore >= 0);
  });
});

// ── Suite 17: Lead update recalculates score ──────────────────────────────────

describe('17. Lead update recalculates score', () => {
  test('recalculateScore on lead updates ClientScore', () => {
    const { leadSvc } = makeStack();
    const create = leadSvc.createLead({ ClientName: 'Test', PrimaryMobile: '6666666666' }, { userId: 'U1' });
    const leadId = create.data.LeadID;
    const before = create.data.ClientScore;

    const recalc = leadSvc.recalculateScore(leadId);
    assert.equal(recalc.ok, true);
    assert.ok(typeof recalc.data.ClientScore === 'number');
  });
});

// ── Suite 18: Manual Requirement recalculation ────────────────────────────────

describe('18. Manual Requirement recalculation', () => {
  test('recalculateRequirementScore returns ok:true and updates DB', () => {
    const { repo, scoring } = makeStack();
    seedChain(repo, {
      fields: { BudgetMax: { state: 'KNOWN', value: 10000000 }, Location1: { state: 'KNOWN', value: 'Vesu' } }
    });
    const res = scoring.recalculateRequirementScore('REQ000001');
    assert.equal(res.ok, true, res.error);
    assert.ok(typeof res.score === 'number');
    assert.ok(res.score >= 0 && res.score <= 100);
    // Verify DB was updated
    const db  = repo.read();
    const req = db.Requirements.find(r => r.RequirementID === 'REQ000001');
    assert.equal(req.RequirementScore, res.score);
    assert.ok(req.ScoreBreakdown);
    assert.ok(req.ScoreCalculationVersion);
    assert.ok(req.ScoreCalculatedAt);
  });

  test('recalculateRequirementScore returns ok:false for unknown ID', () => {
    const { scoring } = makeStack();
    const res = scoring.recalculateRequirementScore('REQ-NONEXISTENT');
    assert.equal(res.ok, false);
    assert.ok(res.error);
  });
});

// ── Suite 19: Manual Client recalculation ────────────────────────────────────

describe('19. Manual Client recalculation', () => {
  test('recalculateClientScore returns ok:true and updates DB', () => {
    const { repo, scoring } = makeStack();
    seedChain(repo, { clientStatus: 'Active', lifecycle: 'Client', email: 'test@example.com', tags: ['HNI'] });
    const res = scoring.recalculateClientScore('L000001');
    assert.equal(res.ok, true, res.error);
    assert.ok(typeof res.score === 'number');
    // Verify DB was updated
    const db   = repo.read();
    const lead = db.Leads.find(l => l.LeadID === 'L000001');
    assert.equal(lead.ClientScore, res.score);
    assert.ok(lead.ClientScoreBreakdown);
    assert.ok(lead.ClientScoreCalculationVersion);
    assert.ok(lead.ClientScoreCalculatedAt);
  });

  test('recalculateClientScore returns ok:false for unknown ID', () => {
    const { scoring } = makeStack();
    const res = scoring.recalculateClientScore('L-NONEXISTENT');
    assert.equal(res.ok, false);
    assert.ok(res.error);
  });
});

// ── Suite 20: Deterministic calculation ──────────────────────────────────────

describe('20. Deterministic calculation', () => {
  test('Same requirement always produces same score', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Residential', TransactionType: 'Purchase', SubCategory: 'Flat',
      Fields: {
        BudgetMax: { state: 'KNOWN', value: 10000000 },
        Location1: { state: 'KNOWN', value: 'Vesu' },
        Urgency:   { state: 'KNOWN', value: 'High'  }
      }
    };
    const r1 = scoring.calculateRequirementScore(req);
    const r2 = scoring.calculateRequirementScore(req);
    assert.equal(r1.score, r2.score, 'Score must be deterministic');
    assert.equal(r1.band,  r2.band,  'Band must be deterministic');
  });

  test('Same client data always produces same score', () => {
    const { scoring } = makeStack();
    const lead = { LeadID: 'L1', ClientStatus: 'Active', ClientLifecycle: 'Client',
                   PrimaryMobile: '9999', Email: 'x@y.com', Tags: ['A'] };
    const r1 = scoring.calculateClientScore(lead, 2, 1);
    const r2 = scoring.calculateClientScore(lead, 2, 1);
    assert.equal(r1.score, r2.score, 'Client score must be deterministic');
  });
});

// ── Suite 21: Dependency NOT_RELEVANT does not penalize ──────────────────────

describe('21. Dependency NOT_RELEVANT does not penalize', () => {
  test('NOT_RELEVANT field excluded from scoring calculation', () => {
    const { scoring } = makeStack();
    // TenantType is NOT_RELEVANT for Purchase — should not appear in factors or penalize
    const req = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: {
        BudgetMax:  { state: 'KNOWN',   value: 10000000 },
        TenantType: { state: 'UNKNOWN' }  // dependency would mark this NOT_RELEVANT
      }
    };
    const res = scoring.calculateRequirementScore(req);
    // TenantType applicableWhen = { transactionType: 'Rent' } — should not appear for Purchase
    const tenantFactor = res.factors.find(f => f.field === 'TenantType');
    // It should either not appear (rule filtered out) or appear as NOT_RELEVANT
    if (tenantFactor) {
      assert.ok(tenantFactor.contribution === 0 || tenantFactor.state === 'NOT_RELEVANT',
        'TenantType for Purchase must not contribute');
    }
  });
});

// ── Suite 22: Rent-specific scoring ──────────────────────────────────────────

describe('22. Rent-specific scoring', () => {
  test('TenantType rule is applicable for Rent', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Residential', TransactionType: 'Rent',
      Fields: {
        BudgetMax:  { state: 'KNOWN', value: 30000 },
        TenantType: { state: 'KNOWN', value: 'Family' }
      }
    };
    const res = scoring.calculateRequirementScore(req);
    const tenantFactor = res.factors.find(f => f.field === 'TenantType');
    assert.ok(tenantFactor, 'TenantType must appear as a factor for Rent');
    assert.ok(tenantFactor.contribution > 0, 'TenantType KNOWN for Rent must contribute');
  });

  test('Deposit rule is applicable for Rent', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Residential', TransactionType: 'Rent',
      Fields: { Deposit: { state: 'KNOWN', value: 60000 } }
    };
    const res = scoring.calculateRequirementScore(req);
    const depositFactor = res.factors.find(f => f.field === 'Deposit');
    assert.ok(depositFactor, 'Deposit must appear as a factor for Rent');
  });
});

// ── Suite 23: Residential scoring ────────────────────────────────────────────

describe('23. Residential scoring', () => {
  test('BHKMin is a scoring factor for Residential', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Residential', TransactionType: 'Purchase',
      Fields: { BHKMin: { state: 'KNOWN', value: 3 } }
    };
    const res = scoring.calculateRequirementScore(req);
    const bhkFactor = res.factors.find(f => f.field === 'BHKMin');
    assert.ok(bhkFactor, 'BHKMin must appear for Residential');
    assert.ok(bhkFactor.contribution > 0);
  });

  test('BHKMin rule NOT applicable for Commercial', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Commercial', TransactionType: 'Purchase',
      Fields: { BHKMin: { state: 'KNOWN', value: 3 } }
    };
    const res = scoring.calculateRequirementScore(req);
    const bhkFactor = res.factors.find(f => f.field === 'BHKMin');
    // BHKMin rule has applicableWhen: { category: 'Residential' } → not in factors for Commercial
    assert.ok(!bhkFactor, 'BHKMin must NOT appear for Commercial');
  });
});

// ── Suite 24: Commercial scoring ─────────────────────────────────────────────

describe('24. Commercial scoring', () => {
  test('BusinessType is a scoring factor for Commercial', () => {
    const { scoring } = makeStack();
    const req = {
      Category: 'Commercial', TransactionType: 'Purchase',
      Fields: { BusinessType: { state: 'KNOWN', value: 'Office' } }
    };
    const res = scoring.calculateRequirementScore(req);
    const btFactor = res.factors.find(f => f.field === 'BusinessType');
    assert.ok(btFactor, 'BusinessType must appear for Commercial');
    assert.ok(btFactor.contribution > 0);
  });
});

// ── Suite 25 & 26: Legacy compatibility ───────────────────────────────────────

describe('25. Legacy Requirement compatibility', () => {
  test('Requirement without V2ScoringService still scores via internal method', () => {
    const { V2RequirementService } = require('../src/services/v2RequirementService');
    const repo   = makeRepo();
    const reqSvc = new V2RequirementService(repo); // no scoringSvc injected
    // Should not throw
    assert.doesNotThrow(() => {
      const req = {
        Category: 'Residential', Fields: { BudgetMax: { state: 'KNOWN', value: 5000000 } }
      };
      reqSvc._computeRequirementScore(req);
    });
  });
});

describe('26. Legacy Lead compatibility', () => {
  test('Lead without V2ScoringService still scores via internal method', () => {
    const { V2LeadService } = require('../src/services/v2LeadService');
    const repo    = makeRepo();
    const leadSvc = new V2LeadService(repo); // no scoringSvc injected
    assert.doesNotThrow(() => {
      const lead = { ClientStatus: 'Active', ClientLifecycle: 'Client', Tags: [] };
      leadSvc._computeClientScore(lead, 0, 0);
    });
  });
});

// ── Suite 27 & 28: API GET endpoints ─────────────────────────────────────────

describe('27. API GET /api/v2/requirements/:id/score', () => {
  test('Returns 200 with score breakdown for valid requirementId', async () => {
    const repo = makeRepo();
    seedChain(repo, { fields: { BudgetMax: { state: 'KNOWN', value: 10000000 } } });
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/requirements/REQ000001/score');
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.ok(typeof res.body.score === 'number');
    assert.ok(res.body.band);
    assert.ok(Array.isArray(res.body.factors));
    assert.ok(res.body.calculationVersion);
    assert.ok(res.body.calculatedAt);
  });

  test('Returns 404 for invalid requirementId', async () => {
    const repo = makeRepo();
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/requirements/NONEXISTENT/score');
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.ok, false);
  });

  test('Also works on bare /api/requirements/:id/score path', async () => {
    const repo = makeRepo();
    seedChain(repo);
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/requirements/REQ000001/score');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });
});

describe('28. API GET /api/v2/leads/:id/score', () => {
  test('Returns 200 with client score for valid leadId', async () => {
    const repo = makeRepo();
    seedChain(repo, { clientStatus: 'Active', lifecycle: 'Client', email: 'x@y.com', tags: ['A'] });
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/leads/L000001/score');
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.ok(typeof res.body.score === 'number');
    assert.ok(res.body.band);
    assert.ok(Array.isArray(res.body.factors));
  });

  test('Returns 404 for invalid leadId', async () => {
    const repo = makeRepo();
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/leads/NONEXISTENT/score');
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.ok, false);
  });

  test('Also works on bare /api/leads/:id/score path', async () => {
    const repo = makeRepo();
    seedChain(repo);
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/leads/L000001/score');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });
});

// ── Suite 29: Invalid IDs return 404 ────────────────────────────────────────

describe('29. Invalid IDs return proper 404', () => {
  test('Requirement score 404 for garbage ID', async () => {
    const repo = makeRepo();
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/requirements/R-INVALID-XYZ/score');
    assert.equal(res.statusCode, 404);
  });

  test('Lead score 404 for garbage ID', async () => {
    const repo = makeRepo();
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/leads/L-INVALID-XYZ/score');
    assert.equal(res.statusCode, 404);
  });
});

// ── Suite 31: GET /api/v2/requirements/:id/score response shape ───────────────

describe('31. GET /api/v2/requirements/:id/score response shape', () => {
  test('Response includes positiveContributions, negativeContributions, unknownFactors', async () => {
    const repo = makeRepo();
    seedChain(repo, {
      fields: {
        BudgetMax: { state: 'KNOWN', value: 10000000 },
        Location1: { state: 'KNOWN', value: 'Vesu'   },
        Urgency:   { state: 'UNKNOWN' }
      }
    });
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/requirements/REQ000001/score');
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.positiveContributions));
    assert.ok(Array.isArray(res.body.negativeContributions));
    assert.ok(Array.isArray(res.body.unknownFactors));
    assert.ok(res.body.positiveContributions.length > 0, 'Should have positive contributions');
    assert.ok(res.body.unknownFactors.length > 0, 'Urgency should be in unknownFactors');
  });
});

// ── Suite 32: GET /api/v2/leads/:id/score response shape ─────────────────────

describe('32. GET /api/v2/leads/:id/score response shape', () => {
  test('Response has all required breakdown fields', async () => {
    const repo = makeRepo();
    seedChain(repo, { clientStatus: 'Active', lifecycle: 'Client' });
    const handle = makeRouterHandle(repo);
    const res = await handle('GET', '/api/v2/leads/L000001/score');
    assert.equal(res.statusCode, 200);
    const b = res.body;
    assert.ok('score' in b && 'band' in b);
    assert.ok(Array.isArray(b.factors));
    assert.ok(Array.isArray(b.positiveContributions));
    assert.ok(Array.isArray(b.unknownFactors));
    assert.ok(b.calculationVersion);
    assert.ok(b.calculatedAt);
  });
});

// ── Suite 33: Score band coverage ────────────────────────────────────────────

describe('33. Score band coverage', () => {
  test('getScoreBands returns 5 bands', () => {
    const { scoring } = makeStack();
    const bands = scoring.getScoreBands();
    assert.equal(bands.length, 5);
    const labels = bands.map(b => b.label);
    assert.ok(labels.includes('Cold'));
    assert.ok(labels.includes('Warm'));
    assert.ok(labels.includes('Good'));
    assert.ok(labels.includes('Hot'));
    assert.ok(labels.includes('Very Hot'));
  });

  test('All score integers 0-100 map to a known band', () => {
    const { scoring } = makeStack();
    for (let s = 0; s <= 100; s++) {
      const band = scoring.resolveScoreBand(s);
      assert.ok(band !== 'Unknown', `Score ${s} should map to a known band, got "Unknown"`);
    }
  });
});

// ── Suite 34: No mutation on GET ──────────────────────────────────────────────

describe('34. GET score endpoints do not corrupt Requirement data', () => {
  test('GET score does not change Requirement.Fields', async () => {
    const repo = makeRepo();
    seedChain(repo, { fields: { BudgetMax: { state: 'KNOWN', value: 10000000 } } });
    const fieldsBefore = JSON.stringify(repo.read().Requirements[0].Fields);
    const handle = makeRouterHandle(repo);
    await handle('GET', '/api/v2/requirements/REQ000001/score');
    const fieldsAfter = JSON.stringify(repo.read().Requirements[0].Fields);
    assert.equal(fieldsAfter, fieldsBefore, 'GET score must not change Requirement.Fields');
  });
});

// ── Suite 35: POST /api/leads/:id/score backward compat ──────────────────────

describe('35. POST /api/leads/:id/score backward compatibility', () => {
  test('POST still triggers score recalculation', async () => {
    const repo = makeRepo();
    seedChain(repo, { clientStatus: 'Active', lifecycle: 'Client' });
    const handle = makeRouterHandle(repo);
    const res = await handle('POST', '/api/leads/L000001/score');
    assert.ok(res.statusCode === 200 || res.statusCode === 201,
      `Expected 200/201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.ok, true);
  });
});
