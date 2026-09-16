const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-token-deal-int-')), 'sig-realty-db.json');
}

async function createLifecycleFixture(runtime, suffix = 'INT01') {
  const lead = await runtime.createLead({
    clientName: `TokenDeal Integration Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 9777700${suffix}`,
    email: `token.deal.integration.${suffix}@example.com`,
    leadStatus: 'Active',
    assignedAgentId: 'USR-0001'
  });
  assert.equal(lead.ok, true);

  const requirement = await runtime.createRequirement(lead.data.LeadID, `TXN-TD-${suffix}`, {
    leadId: lead.data.LeadID,
    transactionId: `TXN-TD-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 22000000,
    location1: `TokenDeal Location ${suffix}`,
    location2: `TokenDeal East ${suffix}`,
    location3: `TokenDeal District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1800,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Integration fixture',
    formType: 'residential'
  });
  assert.equal(requirement.ok, true);

  const property = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `TokenDeal Project ${suffix}`,
    location: `TokenDeal Location ${suffix}`,
    city: 'Bengaluru',
    bhk: 3,
    area: 1520,
    price: 16800000,
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
    AskingPrice: 16800000,
    CurrentOffer: 16400000,
    AgreedPrice: 16400000,
    Status: 'AGREED',
    Notes: 'TokenDeal integration negotiation'
  });
  assert.equal(negotiation.ok, true);

  return {
    leadId: lead.data.LeadID,
    requirementId: requirement.data.RequirementID,
    propertyId: property.data.PropertyID,
    negotiationId: negotiation.data.NegotiationID,
    agreedPrice: negotiation.data.AgreedPrice
  };
}

test('token then deal are reflected in lead workspace and summary metrics', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  const fixture = await createLifecycleFixture(runtime, '501');

  const token = await runtime.createToken({
    NegotiationID: fixture.negotiationId,
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    TokenAmount: 700000,
    Status: 'PENDING'
  });
  assert.equal(token.ok, true);

  const deal = await runtime.createDeal({
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    NegotiationID: fixture.negotiationId,
    TokenID: token.data.TokenID,
    FinalPrice: fixture.agreedPrice,
    Brokerage: 328000,
    Status: 'OPEN'
  });
  assert.equal(deal.ok, true);

  const workspace = await runtime.getLeadWorkspace(fixture.leadId);
  assert.equal(workspace.ok, true);
  assert.ok(workspace.data.tokens.some((row) => row.TokenID === token.data.TokenID));
  assert.ok(workspace.data.deals.some((row) => row.DealID === deal.data.DealID));

  const summary = await runtime.getReportSummary();
  assert.equal(summary.ok, true);
  assert.equal(summary.data.tokens >= 1, true);
  assert.equal(summary.data.deals >= 1, true);
  assert.equal(summary.data.revenue >= fixture.agreedPrice, true);
  assert.equal(summary.data.brokerage >= 328000, true);
});

test('token-deal flow survives runtime restart with preserved relationships', async () => {
  const dbFile = makeDbFile();
  const runtime = new SignatureRealtyRuntime(dbFile);
  const fixture = await createLifecycleFixture(runtime, '502');

  const token = await runtime.createToken({
    NegotiationID: fixture.negotiationId,
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    TokenAmount: 650000,
    Status: 'PAID'
  });
  assert.equal(token.ok, true);

  const deal = await runtime.createDeal({
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    NegotiationID: fixture.negotiationId,
    TokenID: token.data.TokenID,
    FinalPrice: fixture.agreedPrice,
    Brokerage: 300000,
    Status: 'OPEN'
  });
  assert.equal(deal.ok, true);

  const restarted = new SignatureRealtyRuntime(dbFile);
  const tokens = await restarted.listTokens({ LeadID: fixture.leadId });
  const deals = await restarted.listDeals({ LeadID: fixture.leadId });

  assert.equal(tokens.ok, true);
  assert.equal(deals.ok, true);
  assert.ok(tokens.data.some((row) => row.TokenID === token.data.TokenID));
  assert.ok(deals.data.some((row) => row.DealID === deal.data.DealID && row.TokenID === token.data.TokenID));

  fs.unlinkSync(dbFile);
});
