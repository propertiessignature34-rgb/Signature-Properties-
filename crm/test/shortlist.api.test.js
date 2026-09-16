const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

const DB_FILE = makeDbFile('sig-shortlist-api-');

let server;

async function buildFixture() {
  const lead = await requestJson(server.baseUrl, '/api/leads', {
    method: 'POST',
    headers: adminHeaders(),
    body: {
      clientName: 'Shortlist API Lead',
      city: 'Bengaluru',
      phone: '+91 9000007001',
      email: 'shortlist.api.lead@example.com',
      leadStatus: 'New',
      assignedAgentId: 'USR-0001'
    }
  });

  const requirement = await requestJson(server.baseUrl, '/api/requirements', {
    method: 'POST',
    headers: adminHeaders(),
    body: {
      leadId: lead.payload.data.LeadID,
      transactionId: 'TXN-SL-API-001',
      transactionType: 'Purchase',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      budgetMin: 10000000,
      budgetMax: 20000000,
      location1: 'Shortlist API City',
      location2: 'Shortlist API Avenue',
      location3: 'Shortlist API District',
      bhkMin: 3,
      bhkMax: 3,
      areaMin: 1300,
      areaMax: 1700,
      possession: 'Ready',
      urgency: 'High',
      specialNotes: 'shortlist api fixture',
      formType: 'residential'
    }
  });

  const property = await requestJson(server.baseUrl, '/api/inventory', {
    method: 'POST',
    headers: adminHeaders(),
    body: {
      transactionType: 'Sale',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      project: 'Shortlist API Crest',
      location: 'Shortlist API City',
      city: 'Shortlist API City',
      bhk: 3,
      area: 1450,
      price: 15000000,
      possession: 'Ready',
      status: 'Available',
      ownerId: 'OWN-SL-API',
      brokerId: 'BRO-SL-API',
      builderId: 'BUIL-SL-API'
    }
  });

  const run = await requestJson(server.baseUrl, '/api/matching/run', {
    method: 'POST',
    headers: adminHeaders(),
    body: { requirementId: requirement.payload.data.RequirementID }
  });

  const match = run.payload.data.matches.find((item) => item.PropertyID === property.payload.data.PropertyID);

  return {
    requirementId: requirement.payload.data.RequirementID,
    propertyId: property.payload.data.PropertyID,
    matchId: match.MatchID
  };
}

test.before(async () => {
  server = await startServer(DB_FILE);
});

test.after(async () => {
  await stopServer(server?.child);
});

test('shortlist API supports add/list/update/remove/re-add/idempotency/restart persistence', async () => {
  const fixture = await buildFixture();

  const firstAdd = await requestJson(server.baseUrl, '/api/shortlist', {
    method: 'POST',
    headers: adminHeaders(),
    body: {
      requirementId: fixture.requirementId,
      propertyId: fixture.propertyId,
      matchId: fixture.matchId,
      priority: 'High',
      notes: 'primary shortlist'
    }
  });

  assert.equal(firstAdd.response.ok, true);
  assert.equal(firstAdd.payload.ok, true);
  assert.equal(firstAdd.payload.data.Status, 'Active');

  const secondAdd = await requestJson(server.baseUrl, '/api/shortlist', {
    method: 'POST',
    headers: adminHeaders(),
    body: {
      requirementId: fixture.requirementId,
      propertyId: fixture.propertyId,
      matchId: fixture.matchId,
      priority: 'Medium'
    }
  });

  assert.equal(secondAdd.response.ok, true);
  assert.equal(secondAdd.payload.ok, true);
  assert.equal(secondAdd.payload.alreadyShortlisted, true);
  assert.equal(secondAdd.payload.data.ShortlistID, firstAdd.payload.data.ShortlistID);

  const listActive = await requestJson(server.baseUrl, `/api/requirements/${fixture.requirementId}/shortlist?status=Active`, {
    headers: adminHeaders()
  });
  assert.equal(listActive.response.ok, true);
  assert.equal(listActive.payload.ok, true);
  assert.equal(listActive.payload.data.filter((item) => item.PropertyID === fixture.propertyId).length, 1);

  const shortlistId = firstAdd.payload.data.ShortlistID;
  const byId = await requestJson(server.baseUrl, `/api/shortlist/${shortlistId}`, {
    headers: adminHeaders()
  });
  assert.equal(byId.response.ok, true);
  assert.equal(byId.payload.ok, true);

  const updated = await requestJson(server.baseUrl, `/api/shortlist/${shortlistId}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: { priority: 'Low', notes: 'backup after review' }
  });
  assert.equal(updated.response.ok, true);
  assert.equal(updated.payload.data.Priority, 'Low');
  assert.equal(updated.payload.data.Notes, 'backup after review');

  const removed = await requestJson(server.baseUrl, `/api/shortlist/${shortlistId}/remove`, {
    method: 'POST',
    headers: adminHeaders(),
    body: { removedBy: 'api-test' }
  });
  assert.equal(removed.response.ok, true);
  assert.equal(removed.payload.data.Status, 'Removed');

  const reAdd = await requestJson(server.baseUrl, '/api/shortlist', {
    method: 'POST',
    headers: adminHeaders(),
    body: {
      requirementId: fixture.requirementId,
      propertyId: fixture.propertyId,
      matchId: fixture.matchId,
      priority: 'Medium',
      notes: 're-add flow'
    }
  });
  assert.equal(reAdd.response.ok, true);
  assert.equal(reAdd.payload.ok, true);
  assert.notEqual(reAdd.payload.data.ShortlistID, shortlistId);

  const beforeRestartId = reAdd.payload.data.ShortlistID;
  const beforeRestartScore = reAdd.payload.data.MatchScore;

  await stopServer(server.child);
  server = await startServer(DB_FILE);

  const afterRestart = await requestJson(server.baseUrl, `/api/shortlist/${beforeRestartId}`, {
    headers: adminHeaders()
  });
  assert.equal(afterRestart.response.ok, true);
  assert.equal(afterRestart.payload.ok, true);
  assert.equal(afterRestart.payload.data.ShortlistID, beforeRestartId);
  assert.equal(afterRestart.payload.data.PropertyID, fixture.propertyId);
  assert.equal(afterRestart.payload.data.MatchScore, beforeRestartScore);

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const stored = db.Shortlists.find((item) => item.ShortlistID === beforeRestartId);
  assert.ok(stored);
  assert.equal(stored.RequirementID, fixture.requirementId);
  assert.equal(stored.PropertyID, fixture.propertyId);
});

test('shortlist API invalid inputs are controlled', async () => {
  const invalidRequirement = await requestJson(server.baseUrl, '/api/shortlist', {
    method: 'POST',
    headers: adminHeaders(),
    body: { requirementId: 'REQ-NOT-FOUND', propertyId: 'PROP-XYZ' }
  });
  assert.equal(invalidRequirement.response.ok, false);
  assert.equal(invalidRequirement.payload.ok, false);

  const invalidPriority = await requestJson(server.baseUrl, '/api/shortlist', {
    method: 'POST',
    headers: adminHeaders(),
    body: { requirementId: 'REQ-NOT-FOUND', propertyId: 'PROP-XYZ', priority: 'Urgent' }
  });
  assert.equal(invalidPriority.response.ok, false);
  assert.equal(invalidPriority.payload.error, 'Not found');

  const invalidShortlist = await requestJson(server.baseUrl, '/api/shortlist/SL-NOT-FOUND', {
    headers: adminHeaders()
  });
  assert.equal(invalidShortlist.response.status, 404);
  assert.equal(invalidShortlist.payload.ok, false);
});
