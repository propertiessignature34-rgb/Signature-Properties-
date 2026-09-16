const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-token-unit-')), 'sig-realty-db.json');
}

async function createNegotiationFixture(runtime, suffix = 'T01') {
  const lead = await runtime.createLead({
    clientName: `Token Unit Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 9111100${suffix}`,
    email: `token.unit.${suffix}@example.com`,
    leadStatus: 'Active',
    assignedAgentId: 'USR-0001'
  });
  assert.equal(lead.ok, true);

  const requirement = await runtime.createRequirement(lead.data.LeadID, `TXN-TOKEN-${suffix}`, {
    leadId: lead.data.LeadID,
    transactionId: `TXN-TOKEN-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 20000000,
    location1: `Token Location ${suffix}`,
    location2: `Token East ${suffix}`,
    location3: `Token District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1700,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Token fixture',
    formType: 'residential'
  });
  assert.equal(requirement.ok, true);

  const property = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `Token Project ${suffix}`,
    location: `Token Location ${suffix}`,
    city: 'Bengaluru',
    bhk: 3,
    area: 1450,
    price: 15500000,
    possession: 'Ready',
    status: 'Available'
  });
  assert.equal(property.ok, true);

  const run = await runtime.runMatching(requirement.data.RequirementID);
  assert.equal(run.ok, true);
  const match = run.data.matches.find((item) => item.PropertyID === property.data.PropertyID);
  assert.ok(match);

  const negotiation = await runtime.createNegotiation({
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    TransactionID: requirement.data.TransactionID,
    PropertyID: property.data.PropertyID,
    MatchID: match.MatchID,
    AskingPrice: 15500000,
    CurrentOffer: 15200000,
    AgreedPrice: 15200000,
    Status: 'AGREED',
    Notes: 'Token unit negotiation'
  });
  assert.equal(negotiation.ok, true);

  return {
    leadId: lead.data.LeadID,
    requirementId: requirement.data.RequirementID,
    transactionId: requirement.data.TransactionID,
    propertyId: property.data.PropertyID,
    matchId: match.MatchID,
    negotiationId: negotiation.data.NegotiationID,
    agreedPrice: negotiation.data.AgreedPrice
  };
}

test('token creation persists with valid negotiation relationship and balance fields', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  const fixture = await createNegotiationFixture(runtime, '101');

  const token = await runtime.createToken({
    NegotiationID: fixture.negotiationId,
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    TokenAmount: 500000,
    PaidAmount: 200000,
    PaymentMode: 'UPI',
    Reference: 'TOK-REF-101',
    Status: 'PENDING'
  });

  assert.equal(token.ok, true);
  assert.ok(token.data.TokenID);
  assert.equal(token.data.NegotiationID, fixture.negotiationId);
  assert.equal(token.data.Status, 'PENDING');
  assert.equal(token.data.TokenAmount, 500000);
  assert.equal(token.data.PendingAmount, 500000);

  const listed = await runtime.listTokens({ LeadID: fixture.leadId });
  assert.equal(listed.ok, true);
  assert.ok(listed.data.some((row) => row.TokenID === token.data.TokenID));

  const timeline = await runtime.getTimeline(fixture.leadId);
  assert.equal(timeline.ok, true);
  assert.ok(timeline.data.some((row) => row.EntityType === 'Token' && row.EntityID === token.data.TokenID));
});

test('token creation rejects missing required fields and invalid status', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());

  const missing = await runtime.createToken({
    LeadID: 'LEAD-MISSING',
    RequirementID: 'REQ-MISSING',
    PropertyID: 'PROP-MISSING'
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'Missing required token fields');

  const fixture = await createNegotiationFixture(runtime, '102');
  const badStatus = await runtime.createToken({
    NegotiationID: fixture.negotiationId,
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    TokenAmount: 300000,
    Status: 'REQUESTED'
  });
  assert.equal(badStatus.ok, false);
  assert.equal(badStatus.error, 'Invalid token status');
});

test('token duplicate active prevention respects active statuses and restart persistence', async () => {
  const dbFile = makeDbFile();
  const runtime = new SignatureRealtyRuntime(dbFile);
  const fixture = await createNegotiationFixture(runtime, '103');

  const first = await runtime.createToken({
    NegotiationID: fixture.negotiationId,
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    TokenAmount: 400000,
    Status: 'PENDING'
  });
  assert.equal(first.ok, true);

  const duplicate = await runtime.createToken({
    NegotiationID: fixture.negotiationId,
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    TokenAmount: 450000,
    Status: 'PAID'
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, 'Duplicate active token already exists for this requirement and property');

  const restartRuntime = new SignatureRealtyRuntime(dbFile);
  const persisted = await restartRuntime.listTokens({ LeadID: fixture.leadId });
  assert.equal(persisted.ok, true);
  assert.equal(persisted.data.length, 1);
  assert.equal(persisted.data[0].TokenID, first.data.TokenID);

  fs.unlinkSync(dbFile);
});
