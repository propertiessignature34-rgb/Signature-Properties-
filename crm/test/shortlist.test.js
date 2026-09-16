const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function setupRuntime(dbFile) {
  const { SignatureRealtyRuntime } = require('../src/runtime/app');
  return new SignatureRealtyRuntime(dbFile);
}

async function createMatchingFixture(runtime, suffix = 'A') {
  const lead = await runtime.createLead({
    clientName: `Shortlist Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 91111000${suffix}`,
    email: `shortlist.lead.${suffix}@example.com`,
    leadStatus: 'New',
    assignedAgentId: 'USR-0001'
  });

  const requirement = await runtime.createRequirement(lead.data.LeadID, `TXN-SL-${suffix}`, {
    leadId: lead.data.LeadID,
    transactionId: `TXN-SL-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 20000000,
    location1: `Shortlist City ${suffix}`,
    location2: `Shortlist Avenue ${suffix}`,
    location3: `Shortlist District ${suffix}`,
    bhkMin: 3,
    bhkMax: 3,
    areaMin: 1300,
    areaMax: 1700,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Shortlist test fixture',
    formType: 'residential'
  });

  const property = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `Shortlist Crest ${suffix}`,
    location: `Shortlist City ${suffix}`,
    city: `Shortlist City ${suffix}`,
    bhk: 3,
    area: 1450,
    price: 15000000,
    possession: 'Ready',
    status: 'Available',
    ownerId: `OWN-SL-${suffix}`,
    brokerId: `BRO-SL-${suffix}`,
    builderId: `BUIL-SL-${suffix}`
  });

  const matching = await runtime.runMatching(requirement.data.RequirementID);
  const match = matching.data.matches.find((item) => item.PropertyID === property.data.PropertyID);

  return {
    leadId: lead.data.LeadID,
    requirementId: requirement.data.RequirementID,
    propertyId: property.data.PropertyID,
    matchId: match.MatchID
  };
}

test('add shortlist persists requirement/property/match links', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-test-1-'));
  const dbFile = path.join(dbDir, 'db.json');
  const runtime = setupRuntime(dbFile);
  const fixture = await createMatchingFixture(runtime, '1');

  const added = await runtime.addToShortlist({
    requirementId: fixture.requirementId,
    propertyId: fixture.propertyId,
    matchId: fixture.matchId,
    priority: 'High',
    notes: 'Primary option'
  });

  assert.equal(added.ok, true);
  assert.equal(added.data.RequirementID, fixture.requirementId);
  assert.equal(added.data.PropertyID, fixture.propertyId);
  assert.equal(added.data.MatchID, fixture.matchId);
  assert.equal(added.data.Priority, 'High');
  assert.equal(added.data.Status, 'Active');
});

test('read shortlist by requirement returns enriched records', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-test-2-'));
  const dbFile = path.join(dbDir, 'db.json');
  const runtime = setupRuntime(dbFile);
  const fixture = await createMatchingFixture(runtime, '2');
  await runtime.addToShortlist({ requirementId: fixture.requirementId, propertyId: fixture.propertyId, matchId: fixture.matchId });

  const listed = await runtime.listShortlist({ requirementId: fixture.requirementId, status: 'Active' });
  assert.equal(listed.ok, true);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].PropertyID, fixture.propertyId);
  assert.equal(listed.data[0].MatchLevel, 'Excellent');
  assert.ok(listed.data[0].MatchScore >= 0);
});

test('persistence survives runtime reload', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-test-3-'));
  const dbFile = path.join(dbDir, 'db.json');
  const runtime1 = setupRuntime(dbFile);
  const fixture = await createMatchingFixture(runtime1, '3');
  const added = await runtime1.addToShortlist({ requirementId: fixture.requirementId, propertyId: fixture.propertyId, matchId: fixture.matchId });

  const runtime2 = setupRuntime(dbFile);
  const read = await runtime2.getShortlist(added.data.ShortlistID);
  assert.equal(read.ok, true);
  assert.equal(read.data.ShortlistID, added.data.ShortlistID);
  assert.equal(read.data.RequirementID, fixture.requirementId);
  assert.equal(read.data.PropertyID, fixture.propertyId);
});

test('duplicate prevention keeps one active logical shortlist', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-test-4-'));
  const dbFile = path.join(dbDir, 'db.json');
  const runtime = setupRuntime(dbFile);
  const fixture = await createMatchingFixture(runtime, '4');

  const first = await runtime.addToShortlist({ requirementId: fixture.requirementId, propertyId: fixture.propertyId, matchId: fixture.matchId });
  const second = await runtime.addToShortlist({ requirementId: fixture.requirementId, propertyId: fixture.propertyId, matchId: fixture.matchId });
  const listed = await runtime.listShortlist({ requirementId: fixture.requirementId, status: 'Active' });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyShortlisted, true);
  assert.equal(first.data.ShortlistID, second.data.ShortlistID);
  assert.equal(listed.data.filter((item) => item.PropertyID === fixture.propertyId).length, 1);
});

test('remove shortlist marks status removed and allows re-add', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-test-5-'));
  const dbFile = path.join(dbDir, 'db.json');
  const runtime = setupRuntime(dbFile);
  const fixture = await createMatchingFixture(runtime, '5');

  const first = await runtime.addToShortlist({ requirementId: fixture.requirementId, propertyId: fixture.propertyId, matchId: fixture.matchId });
  const removed = await runtime.removeFromShortlist(first.data.ShortlistID, 'tester');
  const second = await runtime.addToShortlist({ requirementId: fixture.requirementId, propertyId: fixture.propertyId, matchId: fixture.matchId });

  assert.equal(removed.ok, true);
  assert.equal(removed.data.Status, 'Removed');
  assert.ok(removed.data.RemovedAt);
  assert.equal(second.ok, true);
  assert.notEqual(second.data.ShortlistID, first.data.ShortlistID);

  const active = await runtime.listShortlist({ requirementId: fixture.requirementId, status: 'Active' });
  assert.equal(active.data.filter((item) => item.PropertyID === fixture.propertyId).length, 1);
});

test('priority and notes update works', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-test-6-'));
  const dbFile = path.join(dbDir, 'db.json');
  const runtime = setupRuntime(dbFile);
  const fixture = await createMatchingFixture(runtime, '6');
  const added = await runtime.addToShortlist({ requirementId: fixture.requirementId, propertyId: fixture.propertyId, matchId: fixture.matchId });

  const updated = await runtime.updateShortlist(added.data.ShortlistID, { priority: 'Low', notes: 'Keep as backup' });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.Priority, 'Low');
  assert.equal(updated.data.Notes, 'Keep as backup');
});

test('invalid requirement returns controlled error', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-test-7-'));
  const dbFile = path.join(dbDir, 'db.json');
  const runtime = setupRuntime(dbFile);

  const result = await runtime.addToShortlist({ requirementId: 'REQ-NOT-FOUND', propertyId: 'PROP-NOT-FOUND' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Requirement not found');
});

test('invalid property returns controlled error', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-test-8-'));
  const dbFile = path.join(dbDir, 'db.json');
  const runtime = setupRuntime(dbFile);
  const fixture = await createMatchingFixture(runtime, '8');

  const result = await runtime.addToShortlist({ requirementId: fixture.requirementId, propertyId: 'PROP-NOT-FOUND', matchId: fixture.matchId });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Property not found');
});

test('invalid match returns controlled error', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-test-9-'));
  const dbFile = path.join(dbDir, 'db.json');
  const runtime = setupRuntime(dbFile);
  const fixture = await createMatchingFixture(runtime, '9');

  const result = await runtime.addToShortlist({ requirementId: fixture.requirementId, propertyId: fixture.propertyId, matchId: 'MATCH-NOT-FOUND' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'No matching property found for this requirement');
});

test('empty shortlist returns controlled empty list', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-test-10-'));
  const dbFile = path.join(dbDir, 'db.json');
  const runtime = setupRuntime(dbFile);

  const listed = await runtime.listShortlist({ status: 'Active' });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.data, []);
});

test('invalid priority is rejected', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-test-11-'));
  const dbFile = path.join(dbDir, 'db.json');
  const runtime = setupRuntime(dbFile);
  const fixture = await createMatchingFixture(runtime, '11');

  const result = await runtime.addToShortlist({
    requirementId: fixture.requirementId,
    propertyId: fixture.propertyId,
    matchId: fixture.matchId,
    priority: 'Urgent'
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Invalid priority');
});
