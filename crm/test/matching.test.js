const test = require('node:test');
const assert = require('node:assert/strict');
const { MatchingEngine } = require('../src/services/matchingEngine');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeRequirement(overrides = {}) {
  return {
    RequirementID: 'REQ-TST-001',
    LeadID: 'LEAD-TST-001',
    TransactionID: 'TXN-TST-001',
    TransactionType: 'Purchase',
    Category: 'Residential',
    SubCategory: '2-3 BHK',
    PropertyType: 'Apartment',
    BudgetMin: 10000000,
    BudgetMax: 20000000,
    Location1: 'Bengaluru East',
    Location2: 'Whitefield',
    Location3: 'ITPL',
    BHKMin: 2,
    BHKMax: 3,
    AreaMin: 1300,
    AreaMax: 1700,
    Possession: 'Ready',
    Urgency: 'High',
    SpecialNotes: 'Need immediate shortlist',
    Status: 'Active',
    ...overrides
  };
}

function makeProperty(overrides = {}) {
  return {
    PropertyID: 'PROP-TST-001',
    TransactionType: 'Sale',
    Category: 'Residential',
    SubCategory: 'Apartment',
    PropertyType: 'Apartment',
    Project: 'Azure Crest',
    Location: 'Bengaluru East',
    City: 'Bengaluru',
    BHK: 3,
    Area: 1450,
    Price: 15000000,
    Possession: 'Ready',
    Status: 'Available',
    ...overrides
  };
}

test('transaction compatibility evaluates sale to sale as matched', () => {
  const engine = new MatchingEngine();
  const result = engine.evaluateTransaction('sale', 'sale');

  assert.equal(result.status, 'matched');
  assert.equal(result.score, 100);
});

test('category compatibility normalizes casing', () => {
  const engine = new MatchingEngine();
  const result = engine.evaluateCategory('Residential', 'residential');

  assert.equal(result.status, 'matched');
  assert.equal(result.score, 100);
});

test('property type compatibility normalizes apartment synonyms', () => {
  const engine = new MatchingEngine();
  const result = engine.evaluatePropertyType('Flat', 'Apartment');

  assert.equal(result.status, 'matched');
  assert.equal(result.score, 100);
});

test('budget compatibility is matched when property price is inside the range', () => {
  const engine = new MatchingEngine();
  const result = engine.evaluateBudget(makeRequirement(), makeProperty());

  assert.equal(result.status, 'matched');
  assert.equal(result.score, 100);
});

test('location compatibility supports exact and city level matching', () => {
  const engine = new MatchingEngine();
  const exact = engine.evaluateLocation(makeRequirement(), makeProperty());
  const cityLevel = engine.evaluateLocation(
    makeRequirement({ Location1: 'Vesu, Surat', Location2: 'Adajan, Surat' }),
    makeProperty({ Location: 'Adajan', City: 'Surat' })
  );

  assert.equal(exact.status, 'matched');
  assert.equal(exact.score, 100);
  assert.equal(cityLevel.status, 'partial');
  assert.ok(cityLevel.score > 0);
});

test('bhk compatibility matches within range', () => {
  const engine = new MatchingEngine();
  const result = engine.evaluateBhk(makeRequirement(), makeProperty());

  assert.equal(result.status, 'matched');
  assert.equal(result.score, 100);
});

test('area compatibility matches within range', () => {
  const engine = new MatchingEngine();
  const result = engine.evaluateArea(makeRequirement(), makeProperty());

  assert.equal(result.status, 'matched');
  assert.equal(result.score, 100);
});

test('score calculation uses weighted criteria and explanation', () => {
  const engine = new MatchingEngine();
  const result = engine.calculateMatch(makeRequirement(), makeProperty());

  assert.equal(typeof result.score, 'number');
  assert.ok(result.score >= 90);
  assert.equal(result.matchLevel, 'Excellent');
  assert.ok(result.explanation.includes('Excellent match'));
  assert.ok(result.scoreBreakdown.transaction);
  assert.ok(result.scoreBreakdown.location);
});

test('match level mapping is deterministic', () => {
  const engine = new MatchingEngine();

  assert.equal(engine.getMatchLevel(95), 'Excellent');
  assert.equal(engine.getMatchLevel(80), 'Strong');
  assert.equal(engine.getMatchLevel(65), 'Possible');
  assert.equal(engine.getMatchLevel(45), 'Weak');
  assert.equal(engine.getMatchLevel(10), 'Poor');
});

test('unknown values remain unknown and do not auto-match', () => {
  const engine = new MatchingEngine();
  const result = engine.calculateMatch(
    makeRequirement({
      TransactionID: null,
      TransactionType: null,
      Category: null,
      SubCategory: null,
      PropertyType: null,
      BudgetMin: null,
      BudgetMax: null,
      Location1: null,
      Location2: null,
      Location3: null,
      BHKMin: null,
      BHKMax: null,
      AreaMin: null,
      AreaMax: null,
      SpecialNotes: null
    }),
    makeProperty({
      TransactionType: null,
      Category: null,
      SubCategory: null,
      PropertyType: null,
      BHK: null,
      Area: null,
      Price: null,
      Location: null,
      City: null,
      Project: null
    })
  );

  assert.equal(result.unknownCriteria.length, 6);
  assert.equal(result.scoreBreakdown.transaction.status, 'matched');
  assert.equal(result.scoreBreakdown.category.status, 'unknown');
  assert.equal(result.scoreBreakdown.propertyType.status, 'unknown');
  assert.equal(result.scoreBreakdown.budget.status, 'unknown');
  assert.equal(result.scoreBreakdown.location.status, 'unknown');
  assert.equal(result.scoreBreakdown.bhk.status, 'unknown');
  assert.equal(result.scoreBreakdown.area.status, 'unknown');
});

test('poor match stays below the strong threshold', () => {
  const engine = new MatchingEngine();
  const result = engine.calculateMatch(
    makeRequirement({
      RequirementID: 'REQ-POOR-001',
      LeadID: 'LEAD-POOR-001',
      TransactionType: 'Rent',
      Category: 'Industrial',
      PropertyType: 'Warehouse',
      BudgetMin: 500000,
      BudgetMax: 700000,
      Location1: 'Ahmedabad',
      Location2: 'Changodar',
      BHKMin: null,
      BHKMax: null,
      AreaMin: 5000,
      AreaMax: 7000
    }),
    makeProperty({
      TransactionType: 'Sale',
      Category: 'Residential',
      PropertyType: 'Apartment',
      Location: 'Bengaluru East',
      City: 'Bengaluru',
      Price: 15000000,
      BHK: 3,
      Area: 1450
    })
  );

  assert.ok(result.score <= 39);
  assert.equal(result.matchLevel, 'Poor');
});

test('invalid requirement returns an error', async () => {
  const runtime = new SignatureRealtyRuntime();
  const result = await runtime.runMatching('REQ-MISSING-001');

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Requirement not found');
});

test('zero match returns an empty result set', async () => {
  const runtime = new SignatureRealtyRuntime();
  const lead = await runtime.createLead({
    clientName: 'Zero Match Lead',
    city: 'Surat',
    phone: '+91 9000000001',
    email: 'zero.match@example.com',
    leadStatus: 'New',
    assignedAgentId: 'USR-0001'
  });

  const requirement = await runtime.createRequirement(lead.data.LeadID, 'TXN-0001', {
    leadId: lead.data.LeadID,
    transactionId: 'TXN-0001',
    transactionType: 'Rent',
    category: 'Industrial',
    subCategory: 'Warehouse',
    propertyType: 'Warehouse',
    budgetMin: 500000,
    budgetMax: 750000,
    location1: 'Nowhere Industrial Estate',
    location2: 'Phantom Road',
    location3: 'Ghost City',
    bhkMin: null,
    bhkMax: null,
    areaMin: 10000,
    areaMax: 12000,
    possession: 'Ready',
    urgency: 'Low',
    specialNotes: 'Zero match test',
    formType: 'industrial'
  });

  const run = await runtime.runMatching(requirement.data.RequirementID);
  assert.equal(run.ok, true);
  assert.equal(run.data.total, 0);
  assert.deepEqual(run.data.matches, []);
});

test('runMatching persists unique match records and duplicate prevention is stable', async () => {
  const runtime = new SignatureRealtyRuntime();
  const lead = await runtime.createLead({
    clientName: 'Matching Persistence Lead',
    city: 'Bengaluru',
    phone: '+91 9000000002',
    email: 'matching.persistence@example.com',
    leadStatus: 'New',
    assignedAgentId: 'USR-0001'
  });

  const requirement = await runtime.createRequirement(lead.data.LeadID, 'TXN-0001', {
    leadId: lead.data.LeadID,
    transactionId: 'TXN-0001',
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 20000000,
    location1: 'Bengaluru East',
    location2: 'Whitefield',
    location3: 'ITPL',
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1300,
    areaMax: 1700,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Need strong match',
    formType: 'residential'
  });

  const createdProperty = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: 'Persistence Residency',
    location: 'Bengaluru East',
    city: 'Bengaluru',
    bhk: 3,
    area: 1450,
    price: 15000000,
    possession: 'Ready',
    status: 'Available',
    ownerId: 'OWN-PERSIST',
    brokerId: 'BRO-PERSIST',
    builderId: 'BUIL-PERSIST'
  });

  const firstRun = await runtime.runMatching(requirement.data.RequirementID);
  assert.equal(firstRun.ok, true);
  assert.ok(firstRun.data.matches.length >= 1);

  const persisted = await runtime.getMatches(requirement.data.RequirementID);
  assert.equal(persisted.ok, true);
  assert.ok(persisted.data.matches.length >= 1);

  const firstMatch = persisted.data.matches.find((item) => item.PropertyID === createdProperty.data.PropertyID);
  assert.ok(firstMatch);
  const firstMatchId = firstMatch.MatchID;
  const firstScore = firstMatch.Score;

  const duplicateRun = await runtime.runMatching(requirement.data.RequirementID);
  assert.equal(duplicateRun.ok, true);

  const afterDuplicate = await runtime.getMatches(requirement.data.RequirementID);
  const duplicateMatch = afterDuplicate.data.matches.find((item) => item.PropertyID === createdProperty.data.PropertyID);
  assert.ok(duplicateMatch);
  assert.equal(duplicateMatch.MatchID, firstMatchId);
  assert.equal(afterDuplicate.data.matches.filter((item) => item.PropertyID === createdProperty.data.PropertyID).length, 1);
  assert.equal(duplicateMatch.Score, firstScore);
});

test('recalculation updates the existing match score and preserves MatchID', async () => {
  const runtime = new SignatureRealtyRuntime();
  const lead = await runtime.createLead({
    clientName: 'Matching Recalc Lead',
    city: 'Bengaluru',
    phone: '+91 9000000003',
    email: 'matching.recalc@example.com',
    leadStatus: 'New',
    assignedAgentId: 'USR-0001'
  });

  const requirement = await runtime.createRequirement(lead.data.LeadID, 'TXN-0001', {
    leadId: lead.data.LeadID,
    transactionId: 'TXN-0001',
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 20000000,
    location1: 'Bengaluru East',
    location2: 'Whitefield',
    location3: 'ITPL',
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1300,
    areaMax: 1700,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Need score change',
    formType: 'residential'
  });

  const property = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: 'Recalc Residency',
    location: 'Bengaluru East',
    city: 'Bengaluru',
    bhk: 3,
    area: 1450,
    price: 15000000,
    possession: 'Ready',
    status: 'Available',
    ownerId: 'OWN-RECALC',
    brokerId: 'BRO-RECALC',
    builderId: 'BUIL-RECALC'
  });

  await runtime.runMatching(requirement.data.RequirementID);
  const before = await runtime.getMatches(requirement.data.RequirementID);
  const beforeMatch = before.data.matches.find((item) => item.PropertyID === property.data.PropertyID);
  assert.ok(beforeMatch);

  await runtime.repository.update('Inventory', 'PropertyID', property.data.PropertyID, { Price: 21000000 });
  await runtime.runMatching(requirement.data.RequirementID);

  const after = await runtime.getMatches(requirement.data.RequirementID);
  const afterMatch = after.data.matches.find((item) => item.PropertyID === property.data.PropertyID);
  assert.ok(afterMatch);
  assert.equal(afterMatch.MatchID, beforeMatch.MatchID);
  assert.notEqual(afterMatch.Score, beforeMatch.Score);
});
