const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-closing-unit-')), 'sig-realty-db.json');
}

async function createCommissionFixture(runtime, suffix = 'CL01') {
  const lead = await runtime.createLead({
    clientName: `Closing Unit Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 9777700${suffix}`,
    email: `closing.unit.${suffix}@example.com`,
    leadStatus: 'Active',
    assignedAgentId: 'USR-0001'
  });
  assert.equal(lead.ok, true);

  const requirement = await runtime.createRequirement(lead.data.LeadID, `TXN-CL-${suffix}`, {
    leadId: lead.data.LeadID,
    transactionId: `TXN-CL-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 11000000,
    budgetMax: 22000000,
    location1: `Closing Unit Location ${suffix}`,
    location2: `Closing Unit East ${suffix}`,
    location3: `Closing Unit District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1800,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Closing unit fixture',
    formType: 'residential'
  });
  assert.equal(requirement.ok, true);

  const property = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `Closing Unit Project ${suffix}`,
    location: `Closing Unit Location ${suffix}`,
    city: 'Bengaluru',
    bhk: 3,
    area: 1500,
    price: 17300000,
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
    AskingPrice: 17300000,
    CurrentOffer: 16900000,
    AgreedPrice: 16900000,
    Status: 'AGREED'
  });
  assert.equal(negotiation.ok, true);

  const token = await runtime.createToken({
    NegotiationID: negotiation.data.NegotiationID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    TokenAmount: 800000,
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
    FinalPrice: negotiation.data.AgreedPrice,
    Brokerage: 338000,
    Status: 'COMPLETED'
  });
  assert.equal(deal.ok, true);

  const commission = await runtime.createCommission({
    DealID: deal.data.DealID,
    CommissionType: 'PERCENTAGE',
    BaseAmount: deal.data.FinalPrice,
    CommissionRate: 2,
    AgentSharePercent: 50,
    CompanySharePercent: 50,
    DueDate: '2027-01-30'
  });
  assert.equal(commission.ok, true);

  return {
    leadId: lead.data.LeadID,
    dealId: deal.data.DealID,
    commissionId: commission.data.CommissionID,
    gross: commission.data.GrossCommission
  };
}

test('closing start creates persistent checklist for a valid completed deal', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  const fixture = await createCommissionFixture(runtime, 'CL11');

  const started = await runtime.startClosing(fixture.dealId, { CreatedBy: 'USR-0001' });
  assert.equal(started.ok, true);
  assert.equal(started.data.Status, 'IN_PROGRESS');
  assert.equal(started.data.Checklist.length >= 10, true);

  const fetched = await runtime.getClosing(fixture.dealId);
  assert.equal(fetched.ok, true);
  assert.equal(fetched.data.ClosingID, started.data.ClosingID);
});

test('closing cannot complete until commission is settled and checklist is complete', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  const fixture = await createCommissionFixture(runtime, 'CL21');

  const started = await runtime.startClosing(fixture.dealId);
  assert.equal(started.ok, true);

  const completeBefore = await runtime.completeClosing(fixture.dealId);
  assert.equal(completeBefore.ok, false);
  assert.equal(completeBefore.error, 'Commission must be fully settled before closing completion');

  const paid = await runtime.recordCommissionPayment(fixture.commissionId, {
    Amount: fixture.gross,
    PaymentMode: 'UPI',
    PaymentID: 'PAY-CL-021'
  });
  assert.equal(paid.ok, true);
  assert.equal(paid.data.commission.Status, 'RECEIVED');

  const closingLoaded = await runtime.getClosing(fixture.dealId);
  assert.equal(closingLoaded.ok, true);

  for (const item of closingLoaded.data.Checklist) {
    const update = await runtime.updateClosingChecklist(fixture.dealId, {
      ItemKey: item.ItemKey,
      Status: 'COMPLETED',
      CompletedBy: 'USR-0001'
    });
    assert.equal(update.ok, true);
  }

  const completed = await runtime.completeClosing(fixture.dealId, { UpdatedBy: 'USR-0002' });
  assert.equal(completed.ok, true);
  assert.equal(completed.data.Status, 'COMPLETED');

  const closed = await runtime.closeDeal(fixture.dealId, { UpdatedBy: 'USR-0002' });
  assert.equal(closed.ok, true);
  assert.equal(closed.data.deal.Status, 'CLOSED');
  assert.equal(closed.data.closing.Status, 'CLOSED');
});

test('closing workflow and audit history persist across restart', async () => {
  const dbFile = makeDbFile();
  const runtime = new SignatureRealtyRuntime(dbFile);
  const fixture = await createCommissionFixture(runtime, 'CL31');

  const started = await runtime.startClosing(fixture.dealId);
  assert.equal(started.ok, true);

  const paid = await runtime.recordCommissionPayment(fixture.commissionId, {
    Amount: fixture.gross,
    PaymentMode: 'BANK_TRANSFER',
    PaymentID: 'PAY-CL-031'
  });
  assert.equal(paid.ok, true);

  for (const item of started.data.Checklist) {
    const update = await runtime.updateClosingChecklist(fixture.dealId, {
      ItemKey: item.ItemKey,
      Status: 'COMPLETED'
    });
    assert.equal(update.ok, true);
  }

  const completed = await runtime.completeClosing(fixture.dealId);
  assert.equal(completed.ok, true);
  const closed = await runtime.closeDeal(fixture.dealId);
  assert.equal(closed.ok, true);

  const restarted = new SignatureRealtyRuntime(dbFile);
  const closing = await restarted.getClosing(fixture.dealId);
  assert.equal(closing.ok, true);
  assert.equal(closing.data.Status, 'CLOSED');

  const history = await restarted.getClosingHistory(fixture.dealId);
  assert.equal(history.ok, true);
  assert.equal(history.data.length >= 3, true);

  fs.unlinkSync(dbFile);
});
