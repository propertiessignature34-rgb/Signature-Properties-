const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

const dbFile = makeDbFile('sig-sitevisit-api-');

let server;

test.before(async () => {
  const repository = new JsonRepository(dbFile);
  const seededLead = repository.createLead({ LeadID: 'LEAD-API-SITE', ClientName: 'Lina', City: 'Bengaluru', Phone: '+91 11111', Email: 'lina@test.com', LeadStatus: 'Active', assignedAgentId: 'USR-0001' });
  const seededRequirement = repository.createRequirement({ RequirementID: 'REQ-API-SITE', RequirementCode: 'REQ-API-SITE', LeadID: seededLead.LeadID, TransactionID: 'TXN-API-SITE', TransactionType: 'Purchase', Category: 'Residential', PropertyType: 'Apartment', BudgetMin: 12000000, BudgetMax: 15000000, Location1: 'Whitefield', Status: 'Active' });
  repository.create('Inventory', { PropertyID: 'PROP-API-SITE', TransactionType: 'Purchase', Category: 'Residential', PropertyType: 'Apartment', Project: 'Bay View', Location: 'Whitefield', City: 'Bengaluru', BHK: 2, Area: 1400, Price: 13500000, Status: 'Available', CompanyID: 'COMP-001', BrokerageID: 'BRK-001' });
  repository.createMatch({ MatchID: 'MATCH-API-SITE', RequirementID: seededRequirement.RequirementID, PropertyID: 'PROP-API-SITE', LeadID: seededLead.LeadID, Score: 92, MatchLevel: 'Strong', MatchedCriteria: ['Budget', 'Location'], FailedCriteria: [], UnknownCriteria: [], ScoreBreakdown: {}, Explanation: 'Strong fit', Status: 'Active' });
  server = await startServer(dbFile);
});

test.after(async () => {
  await stopServer(server?.child);
});

test('site visit API lifecycle works', async () => {
  const leadResp = await requestJson(server.baseUrl, '/api/leads', {
    method: 'POST',
    headers: adminHeaders(),
    body: { clientName: 'Lina', city: 'Bengaluru', phone: '+91 11111', email: 'lina@test.com', leadStatus: 'Active', assignedAgentId: 'USR-0001' }
  });
  const lead = leadResp.payload.data;

  const requirementResp = await requestJson(server.baseUrl, '/api/requirements', {
    method: 'POST',
    headers: adminHeaders(),
    body: { leadId: lead.LeadID, transactionType: 'Purchase', category: 'Residential', propertyType: 'Apartment', location1: 'Whitefield', budgetMin: 12000000, budgetMax: 15000000 }
  });
  const requirement = requirementResp.payload.data;

  const propertyResp = await requestJson(server.baseUrl, '/api/inventory', {
    method: 'POST',
    headers: adminHeaders(),
    body: { propertyId: 'PROP-API-TEST', transactionType: 'Purchase', category: 'Residential', propertyType: 'Apartment', project: 'Bay View', location: 'Whitefield', city: 'Bengaluru', bhk: 2, area: 1400, price: 13500000, status: 'Available' }
  });
  const property = propertyResp.payload.data;

  const matchResp = await requestJson(server.baseUrl, '/api/matching/run', {
    method: 'POST',
    headers: adminHeaders(),
    body: { requirementId: requirement.RequirementID }
  });
  const matchId = matchResp.payload.data?.matches?.find((item) => item.PropertyID === property.PropertyID)?.MatchID || null;

  const createResp = await requestJson(server.baseUrl, '/api/site-visits', {
    method: 'POST',
    headers: adminHeaders(),
    body: { leadId: lead.LeadID, requirementId: requirement.RequirementID, propertyId: property.PropertyID, matchId, visitDate: '2026-10-01', visitTime: '12:00', duration: '90 mins', meetingPoint: 'Lobby', assignedAgentId: 'USR-0001', clientName: 'Lina', clientPhone: '+91 11111', notes: 'API flow' }
  });
  assert.equal(createResp.payload.ok, true);

  const getResp = await requestJson(server.baseUrl, `/api/site-visits/${createResp.payload.data.VisitID}`, {
    headers: adminHeaders()
  });
  assert.equal(getResp.payload.ok, true);
  assert.equal(getResp.payload.data.VisitID, createResp.payload.data.VisitID);

  const listResp = await requestJson(server.baseUrl, '/api/site-visits', {
    headers: adminHeaders()
  });
  assert.equal(listResp.payload.ok, true);
  assert.equal(listResp.payload.data.length >= 1, true);

  const confirmResp = await requestJson(server.baseUrl, `/api/site-visits/${createResp.payload.data.VisitID}/confirm`, {
    method: 'PATCH',
    headers: adminHeaders()
  });
  assert.equal(confirmResp.payload.ok, true);
  assert.equal(confirmResp.payload.data.Status, 'Confirmed');

  const completeResp = await requestJson(server.baseUrl, `/api/site-visits/${createResp.payload.data.VisitID}/complete`, {
    method: 'PATCH',
    headers: adminHeaders()
  });
  assert.equal(completeResp.payload.ok, true);
  assert.equal(completeResp.payload.data.Status, 'Completed');
});
