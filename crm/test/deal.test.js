const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-deal-unit-')), 'sig-realty-db.json');
}

async function createNegotiationFixture(runtime, suffix = 'D01') {
  const lead = await runtime.createLead({
    clientName: `Deal Unit Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 9222200${suffix}`,
    email: `deal.unit.${suffix}@example.com`,
    leadStatus: 'Active',
    assignedAgentId: 'USR-0001'
  });
  assert.equal(lead.ok, true);

  const requirement = await runtime.createRequirement(lead.data.LeadID, `TXN-DEAL-${suffix}`, {
    leadId: lead.data.LeadID,
    transactionId: `TXN-DEAL-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 21000000,
    location1: `Deal Location ${suffix}`,
    location2: `Deal East ${suffix}`,
    location3: `Deal District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1750,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Deal fixture',
    formType: 'residential'
  });
  assert.equal(requirement.ok, true);

  const property = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `Deal Project ${suffix}`,
    location: `Deal Location ${suffix}`,
    city: 'Bengaluru',
    bhk: 3,
    area: 1500,
    price: 16500000,
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
    AskingPrice: 16500000,
    CurrentOffer: 16100000,
    AgreedPrice: 16100000,
    Status: 'AGREED',
    Notes: 'Deal unit negotiation'
  });
  assert.equal(negotiation.ok, true);

  return {
    leadId: lead.data.LeadID,
    requirementId: requirement.data.RequirementID,
    propertyId: property.data.PropertyID,
    negotiationId: negotiation.data.NegotiationID,
    matchId: match.MatchID,
    agreedPrice: negotiation.data.AgreedPrice
  };
}

async function createTokenFixture(runtime, suffix = 'D01') {
  const fixture = await createNegotiationFixture(runtime, suffix);
  const token = await runtime.createToken({
    NegotiationID: fixture.negotiationId,
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    MatchID: fixture.matchId,
    TokenAmount: 600000,
    Status: 'PENDING'
  });
  assert.equal(token.ok, true);

  return {
    ...fixture,
    tokenId: token.data.TokenID,
    tokenAmount: token.data.TokenAmount
  };
}

test('deal creation persists core fields and records timeline entry', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  const fixture = await createTokenFixture(runtime, '301');

  const deal = await runtime.createDeal({
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    NegotiationID: fixture.negotiationId,
    TokenID: fixture.tokenId,
    FinalPrice: fixture.agreedPrice,
    Brokerage: 320000,
    Buyer: fixture.leadId,
    Seller: 'Seller 301',
    Status: 'OPEN',
    Notes: 'Deal created in unit test'
  });

  assert.equal(deal.ok, true);
  assert.ok(deal.data.DealID);
  assert.equal(deal.data.TokenID, fixture.tokenId);
  assert.equal(deal.data.FinalPrice, fixture.agreedPrice);
  assert.equal(deal.data.Status, 'OPEN');

  const listed = await runtime.listDeals({ LeadID: fixture.leadId });
  assert.equal(listed.ok, true);
  assert.ok(listed.data.some((row) => row.DealID === deal.data.DealID));

  const timeline = await runtime.getTimeline(fixture.leadId);
  assert.equal(timeline.ok, true);
  assert.ok(timeline.data.some((row) => row.EntityType === 'Deal' && row.EntityID === deal.data.DealID));
});

test('deal creation rejects missing required identifiers', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());

  const missing = await runtime.createDeal({
    LeadID: 'LEAD-MISSING',
    RequirementID: 'REQ-MISSING',
    PropertyID: 'PROP-MISSING',
    NegotiationID: 'NEG-MISSING'
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'Missing required deal fields');
});

test('deal list and created data persist across runtime restart', async () => {
  const dbFile = makeDbFile();
  const runtime = new SignatureRealtyRuntime(dbFile);
  const fixture = await createTokenFixture(runtime, '302');

  const created = await runtime.createDeal({
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    NegotiationID: fixture.negotiationId,
    TokenID: fixture.tokenId,
    FinalPrice: fixture.agreedPrice,
    Brokerage: 300000,
    Status: 'OPEN'
  });
  assert.equal(created.ok, true);

  const restartRuntime = new SignatureRealtyRuntime(dbFile);
  const listed = await restartRuntime.listDeals({ LeadID: fixture.leadId });
  assert.equal(listed.ok, true);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].DealID, created.data.DealID);
  assert.equal(listed.data[0].TokenID, fixture.tokenId);

  fs.unlinkSync(dbFile);
});
