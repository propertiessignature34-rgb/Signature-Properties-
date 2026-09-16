const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-comm-close-int-')), 'sig-realty-db.json');
}

async function setupCompleteDeal(runtime, suffix = 'CCI01') {
  const lead = await runtime.createLead({
    clientName: `CommClose Integration Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 9444400${suffix}`,
    email: `commclose.integration.${suffix}@example.com`,
    leadStatus: 'Active',
    assignedAgentId: 'USR-0001'
  });
  assert.equal(lead.ok, true);

  const requirement = await runtime.createRequirement(lead.data.LeadID, `TXN-CCI-${suffix}`, {
    leadId: lead.data.LeadID,
    transactionId: `TXN-CCI-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 21000000,
    location1: `CCI Location ${suffix}`,
    location2: `CCI East ${suffix}`,
    location3: `CCI District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1700,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Commission-Closing integration fixture',
    formType: 'residential'
  });
  assert.equal(requirement.ok, true);

  const property = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `CCI Project ${suffix}`,
    location: `CCI Location ${suffix}`,
    city: 'Bengaluru',
    bhk: 3,
    area: 1460,
    price: 16400000,
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
    AskingPrice: 16400000,
    CurrentOffer: 16000000,
    AgreedPrice: 16000000,
    Status: 'AGREED'
  });
  assert.equal(negotiation.ok, true);

  const token = await runtime.createToken({
    NegotiationID: negotiation.data.NegotiationID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    TokenAmount: 600000,
    Status: 'PAID'
  });
  assert.equal(token.ok, true);

  const deal = await runtime.createDeal({
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    MatchID: match.MatchID,
    NegotiationID: negotiation.data.NegotiationID,
    TokenID: token.data.TokenID,
    FinalPrice: 16000000,
    Brokerage: 320000,
    Status: 'COMPLETED'
  });
  assert.equal(deal.ok, true);

  return { lead, requirement, property, negotiation, token, deal };
}

test('commission and closing integration enforces settlement-before-close policy', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  const fixture = await setupCompleteDeal(runtime, 'CCI11');

  const commission = await runtime.createCommission({
    DealID: fixture.deal.data.DealID,
    LeadID: fixture.lead.data.LeadID,
    PropertyID: fixture.property.data.PropertyID,
    CommissionType: 'PERCENTAGE',
    BaseAmount: fixture.deal.data.FinalPrice,
    CommissionRate: 2,
    AgentSharePercent: 50,
    CompanySharePercent: 50
  });
  assert.equal(commission.ok, true);
  assert.equal(commission.data.GrossCommission, 320000);

  const started = await runtime.startClosing(fixture.deal.data.DealID);
  assert.equal(started.ok, true);

  const blocked = await runtime.completeClosing(fixture.deal.data.DealID);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'Commission must be fully settled before closing completion');

  const partialPay = await runtime.recordCommissionPayment(commission.data.CommissionID, {
    Amount: 120000,
    PaymentMode: 'UPI',
    PaymentID: 'PAY-CCI-011'
  });
  assert.equal(partialPay.ok, true);
  assert.equal(partialPay.data.commission.Status, 'PARTIAL');

  const stillBlocked = await runtime.completeClosing(fixture.deal.data.DealID);
  assert.equal(stillBlocked.ok, false);
  assert.equal(stillBlocked.error, 'Commission must be fully settled before closing completion');

  const fullPay = await runtime.recordCommissionPayment(commission.data.CommissionID, {
    Amount: 200000,
    PaymentMode: 'BANK_TRANSFER',
    PaymentID: 'PAY-CCI-012'
  });
  assert.equal(fullPay.ok, true);
  assert.equal(fullPay.data.commission.Status, 'RECEIVED');

  const loaded = await runtime.getClosing(fixture.deal.data.DealID);
  assert.equal(loaded.ok, true);

  for (const item of loaded.data.Checklist) {
    const update = await runtime.updateClosingChecklist(fixture.deal.data.DealID, {
      ItemKey: item.ItemKey,
      Status: 'COMPLETED',
      CompletedBy: 'USR-0001'
    });
    assert.equal(update.ok, true);
  }

  const completed = await runtime.completeClosing(fixture.deal.data.DealID);
  assert.equal(completed.ok, true);
  assert.equal(completed.data.Status, 'COMPLETED');

  const closed = await runtime.closeDeal(fixture.deal.data.DealID);
  assert.equal(closed.ok, true);
  assert.equal(closed.data.deal.Status, 'CLOSED');

  const summary = await runtime.getCommissionSummary();
  assert.equal(summary.ok, true);
  assert.equal(summary.data.received >= commission.data.GrossCommission, true);
  assert.equal(summary.data.pending, 0);

  const workspace = await runtime.getLeadWorkspace(fixture.lead.data.LeadID);
  assert.equal(workspace.ok, true);
  assert.equal(workspace.data.commissions.length >= 1, true);
  assert.equal(workspace.data.closings.length >= 1, true);
});
