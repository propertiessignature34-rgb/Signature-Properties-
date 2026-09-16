const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeDbFile(prefix) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'sig-db.json');
}

test('full lifecycle persists connected IDs and stages', async () => {
  const dbFile = makeDbFile('sig-lifecycle-');
  const runtime = new SignatureRealtyRuntime(dbFile);

  const lead = await runtime.createLead({
    clientName: 'Lifecycle Lead',
    city: 'Bengaluru',
    phone: '+91 9000000001',
    email: 'lifecycle@example.com',
    leadStatus: 'Active',
    assignedAgentId: 'USR-0001'
  });
  assert.equal(lead.ok, true);

  const requirement = await runtime.createRequirement(lead.data.LeadID, 'TXN-LIFE-01', {
    leadId: lead.data.LeadID,
    transactionId: 'TXN-LIFE-01',
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 12000000,
    budgetMax: 18000000,
    location1: 'Whitefield',
    location2: 'Bengaluru',
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1700,
    possession: 'Ready',
    urgency: 'High',
    formType: 'residential'
  });
  assert.equal(requirement.ok, true);

  const property = await runtime.createInventoryProperty({
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: 'Lifecycle Heights',
    location: 'Whitefield',
    city: 'Bengaluru',
    bhk: 3,
    area: 1500,
    price: 16000000,
    possession: 'Ready',
    status: 'Available'
  });
  assert.equal(property.ok, true);

  const match = await runtime.runMatching(requirement.data.RequirementID);
  assert.equal(match.ok, true);
  assert.ok(match.data.matches.length >= 1);
  const targetMatch = match.data.matches.find((item) => item.PropertyID === property.data.PropertyID);
  assert.ok(targetMatch);

  const shortlisted = await runtime.addToShortlist({
    requirementId: requirement.data.RequirementID,
    propertyId: property.data.PropertyID,
    matchId: targetMatch.MatchID,
    priority: 'High',
    notes: 'Primary choice'
  });
  assert.equal(shortlisted.ok, true);

  const siteVisit = await runtime.createSiteVisit({
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    MatchID: targetMatch.MatchID,
    ShortlistID: shortlisted.data.ShortlistID,
    VisitDate: '2026-10-20',
    VisitTime: '10:30',
    MeetingPoint: 'Lobby',
    AssignedAgentID: 'USR-0001',
    Notes: 'Initial viewing',
    Status: 'Scheduled'
  });
  assert.equal(siteVisit.ok, true);

  const negotiation = await runtime.createNegotiation({
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    MatchID: targetMatch.MatchID,
    ShortlistID: shortlisted.data.ShortlistID,
    SiteVisitID: siteVisit.data.VisitID,
    AskingPrice: 16000000,
    ClientOffer: 15000000,
    OwnerOffer: 15500000,
    CounterOffer: 15250000,
    FinalPrice: 15250000,
    Brokerage: 1.5,
    Notes: 'Counter accepted'
  });
  assert.equal(negotiation.ok, true);
  assert.ok(negotiation.data.History.length >= 2);

  const accepted = await runtime.updateNegotiation(negotiation.data.NegotiationID, { Status: 'ACCEPTED', FinalPrice: 15250000 });
  assert.equal(accepted.ok, true);

  const token = await runtime.createToken({
    NegotiationID: negotiation.data.NegotiationID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    SiteVisitID: siteVisit.data.VisitID,
    TokenAmount: 400000,
    PaidAmount: 400000,
    PaymentMode: 'UPI',
    Reference: 'REF-123',
    TokenDate: '2026-10-21'
  });
  assert.equal(token.ok, true);

  const deal = await runtime.createDeal({
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    MatchID: targetMatch.MatchID,
    ShortlistID: shortlisted.data.ShortlistID,
    SiteVisitID: siteVisit.data.VisitID,
    NegotiationID: negotiation.data.NegotiationID,
    TokenID: token.data.TokenID,
    FinalPrice: 15250000,
    Brokerage: 1.5,
    Buyer: lead.data.ClientName,
    Seller: 'Owner',
    AgreementDate: '2026-11-01',
    RegistrationDate: '2026-11-05',
    PossessionDate: '2027-01-10',
    ClosingDate: '2027-01-15'
  });
  assert.equal(deal.ok, true);

  const payment = await runtime.createPayment({
    DealID: deal.data.DealID,
    TokenID: token.data.TokenID,
    Amount: 500000,
    PaymentType: 'Booking',
    PaymentMode: 'UPI',
    Reference: 'PAY-001',
    PaymentDate: '2026-10-22',
    Status: 'PAID'
  });
  assert.equal(payment.ok, true);

  const commission = await runtime.createCommission({
    DealID: deal.data.DealID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    CommissionType: 'PERCENTAGE',
    CommissionBasis: 'DEAL_VALUE',
    BaseAmount: 15250000,
    CommissionRate: 1.5,
    AgentSharePercent: 60,
    CompanySharePercent: 40,
    ReferralSharePercent: 0,
    GSTRate: 0,
    TDSRate: 0,
    Status: 'PENDING'
  });
  assert.equal(commission.ok, true);

  const paymentHistory = await runtime.listPayments({ dealId: deal.data.DealID });
  assert.equal(paymentHistory.ok, true);
  assert.equal(paymentHistory.data.length, 1);

  const timeline = await runtime.getTimeline(lead.data.LeadID);
  assert.equal(timeline.ok, true);
  assert.ok(timeline.data.length >= 8);

  const workspace = await runtime.getLeadWorkspace(lead.data.LeadID);
  assert.equal(workspace.ok, true);
  assert.ok(Array.isArray(workspace.data.negotiations));
  assert.ok(Array.isArray(workspace.data.tokens));
  assert.ok(Array.isArray(workspace.data.deals));
  assert.ok(Array.isArray(workspace.data.payments));

  const report = await runtime.getReportSummary();
  assert.equal(report.ok, true);
  assert.ok(report.data.totalLeads >= 1);

  const search = await runtime.globalSearch('Lifecycle');
  assert.equal(search.ok, true);
  assert.ok(search.data.length >= 1);
});
