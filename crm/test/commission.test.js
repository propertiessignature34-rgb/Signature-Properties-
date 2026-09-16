const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-commission-unit-')), 'sig-realty-db.json');
}

async function createDealFixture(runtime, suffix = 'CU01') {
  const lead = await runtime.createLead({
    clientName: `Commission Unit Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 9888800${suffix}`,
    email: `commission.unit.${suffix}@example.com`,
    leadStatus: 'Active',
    assignedAgentId: 'USR-0001'
  });
  assert.equal(lead.ok, true);

  const requirement = await runtime.createRequirement(lead.data.LeadID, `TXN-CU-${suffix}`, {
    leadId: lead.data.LeadID,
    transactionId: `TXN-CU-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 11000000,
    budgetMax: 22000000,
    location1: `Commission Unit Location ${suffix}`,
    location2: `Commission Unit East ${suffix}`,
    location3: `Commission Unit District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1800,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Commission unit fixture',
    formType: 'residential'
  });
  assert.equal(requirement.ok, true);

  const property = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `Commission Unit Project ${suffix}`,
    location: `Commission Unit Location ${suffix}`,
    city: 'Bengaluru',
    bhk: 3,
    area: 1480,
    price: 17200000,
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
    AskingPrice: 17200000,
    CurrentOffer: 16800000,
    AgreedPrice: 16800000,
    Status: 'AGREED'
  });
  assert.equal(negotiation.ok, true);

  const token = await runtime.createToken({
    NegotiationID: negotiation.data.NegotiationID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    TokenAmount: 750000,
    Status: 'PENDING'
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
    Brokerage: 336000,
    Status: 'COMPLETED'
  });
  assert.equal(deal.ok, true);

  return {
    leadId: lead.data.LeadID,
    requirementId: requirement.data.RequirementID,
    propertyId: property.data.PropertyID,
    transactionId: requirement.data.TransactionID,
    negotiationId: negotiation.data.NegotiationID,
    tokenId: token.data.TokenID,
    dealId: deal.data.DealID,
    finalPrice: deal.data.FinalPrice
  };
}

test('commission calculation supports percentage and fixed modes deterministically', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());

  const pct = await runtime.calculateCommission({
    CommissionType: 'PERCENTAGE',
    BaseAmount: 15000000,
    CommissionRate: 2,
    AgentSharePercent: 40,
    CompanySharePercent: 50,
    ReferralSharePercent: 10,
    GSTRate: 18,
    TDSRate: 5
  });

  assert.equal(pct.ok, true);
  assert.equal(pct.data.GrossCommission, 300000);
  assert.equal(pct.data.AgentShareAmount, 120000);
  assert.equal(pct.data.CompanyShareAmount, 150000);
  assert.equal(pct.data.ReferralShareAmount, 30000);
  assert.equal(pct.data.GSTAmount, 54000);
  assert.equal(pct.data.TDSAmount, 15000);
  assert.equal(pct.data.NetPayable, 231000);

  const fixed = await runtime.calculateCommission({
    CommissionType: 'FIXED',
    FixedCommission: 250000,
    AgentSharePercent: 60,
    CompanySharePercent: 40,
    ReferralSharePercent: 0
  });

  assert.equal(fixed.ok, true);
  assert.equal(fixed.data.GrossCommission, 250000);
  assert.equal(fixed.data.AgentShareAmount, 150000);
  assert.equal(fixed.data.CompanyShareAmount, 100000);
  assert.equal(fixed.data.ReferralShareAmount, 0);
});

test('commission creation validates relationships and split percentages', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  const fixture = await createDealFixture(runtime, 'CU11');

  const badSplit = await runtime.createCommission({
    DealID: fixture.dealId,
    CommissionType: 'PERCENTAGE',
    BaseAmount: fixture.finalPrice,
    CommissionRate: 2,
    AgentSharePercent: 70,
    CompanySharePercent: 40,
    ReferralSharePercent: 0
  });
  assert.equal(badSplit.ok, false);
  assert.equal(badSplit.error, 'AgentSharePercent + ReferralSharePercent + CompanySharePercent cannot exceed 100');

  const created = await runtime.createCommission({
    DealID: fixture.dealId,
    TokenID: fixture.tokenId,
    NegotiationID: fixture.negotiationId,
    TransactionID: fixture.transactionId,
    LeadID: fixture.leadId,
    PropertyID: fixture.propertyId,
    AgentID: 'USR-0001',
    BrokerID: 'BRO-CU11',
    CommissionType: 'PERCENTAGE',
    CommissionBasis: 'DEAL_VALUE',
    BaseAmount: fixture.finalPrice,
    CommissionRate: 2,
    AgentSharePercent: 50,
    CompanySharePercent: 50,
    ReferralSharePercent: 0,
    DueDate: '2027-01-15'
  });

  assert.equal(created.ok, true);
  assert.equal(created.data.GrossCommission, 336000);
  assert.equal(created.data.PendingAmount, 336000);
  assert.equal(created.data.Status, 'PENDING');

  const history = await runtime.getCommissionHistory(created.data.CommissionID);
  assert.equal(history.ok, true);
  assert.equal(history.data.length >= 1, true);
  assert.equal(history.data[0].EntryType, 'COMMISSION_CREATED');
});

test('commission payments support partial/full settlement and prevent overpay or duplicate IDs', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  const fixture = await createDealFixture(runtime, 'CU21');

  const commission = await runtime.createCommission({
    DealID: fixture.dealId,
    CommissionType: 'PERCENTAGE',
    BaseAmount: fixture.finalPrice,
    CommissionRate: 2,
    AgentSharePercent: 50,
    CompanySharePercent: 50
  });
  assert.equal(commission.ok, true);

  const first = await runtime.recordCommissionPayment(commission.data.CommissionID, {
    PaymentID: 'PAY-CU-001',
    Amount: 100000,
    PaymentMode: 'UPI',
    ReferenceNumber: 'REF-CU-001',
    ReceivedBy: 'USR-0001'
  });
  assert.equal(first.ok, true);
  assert.equal(first.data.commission.Status, 'PARTIAL');
  assert.equal(first.data.commission.ReceivedAmount, 100000);

  const duplicatePaymentId = await runtime.recordCommissionPayment(commission.data.CommissionID, {
    PaymentID: 'PAY-CU-001',
    Amount: 1000,
    PaymentMode: 'UPI'
  });
  assert.equal(duplicatePaymentId.ok, false);
  assert.equal(duplicatePaymentId.error, 'Duplicate payment ID already exists');

  const overpay = await runtime.recordCommissionPayment(commission.data.CommissionID, {
    Amount: 99999999,
    PaymentMode: 'BANK_TRANSFER'
  });
  assert.equal(overpay.ok, false);
  assert.equal(overpay.error, 'Payment amount cannot exceed pending balance');

  const second = await runtime.recordCommissionPayment(commission.data.CommissionID, {
    PaymentID: 'PAY-CU-002',
    Amount: 236000,
    PaymentMode: 'CHEQUE',
    ReferenceNumber: 'REF-CU-002',
    ReceivedBy: 'USR-0002'
  });
  assert.equal(second.ok, true);
  assert.equal(second.data.commission.Status, 'RECEIVED');
  assert.equal(second.data.commission.PendingAmount, 0);

  const invalidTransition = await runtime.updateCommissionStatus(commission.data.CommissionID, { Status: 'PENDING' });
  assert.equal(invalidTransition.ok, false);
  assert.equal(invalidTransition.error, 'Status transition from RECEIVED to PENDING is not allowed');

  const payments = await runtime.listCommissionPayments(commission.data.CommissionID);
  assert.equal(payments.ok, true);
  assert.equal(payments.data.length, 2);
});

test('commission ledger and payments persist across runtime restart', async () => {
  const dbFile = makeDbFile();
  const runtime = new SignatureRealtyRuntime(dbFile);
  const fixture = await createDealFixture(runtime, 'CU31');

  const commission = await runtime.createCommission({
    DealID: fixture.dealId,
    CommissionType: 'FIXED',
    FixedCommission: 300000,
    AgentSharePercent: 45,
    CompanySharePercent: 45,
    ReferralSharePercent: 10
  });
  assert.equal(commission.ok, true);

  const payment = await runtime.recordCommissionPayment(commission.data.CommissionID, {
    PaymentID: 'PAY-CU-031',
    Amount: 300000,
    PaymentMode: 'BANK_TRANSFER'
  });
  assert.equal(payment.ok, true);

  const restarted = new SignatureRealtyRuntime(dbFile);
  const listed = await restarted.listCommissions({ dealId: fixture.dealId });
  assert.equal(listed.ok, true);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].Status, 'RECEIVED');

  const history = await restarted.getCommissionHistory(commission.data.CommissionID);
  assert.equal(history.ok, true);
  assert.equal(history.data.length >= 3, true);

  fs.unlinkSync(dbFile);
});
