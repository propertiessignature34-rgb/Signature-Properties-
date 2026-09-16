const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-analytics-unit-')), 'sig-realty-db.json');
}

async function seed(runtime) {
  const lead = await runtime.createLead({
    clientName: 'Analytics Lead',
    city: 'Bengaluru',
    phone: '+91 7000000011',
    email: 'analytics.lead@example.com',
    leadStatus: 'Active',
    assignedAgentId: 'USR-5001',
    leadSource: 'MagicBricks'
  });
  assert.equal(lead.ok, true);

  const requirement = await runtime.createRequirement(lead.data.LeadID, 'TXN-AN-001', {
    leadId: lead.data.LeadID,
    transactionId: 'TXN-AN-001',
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 12000000,
    budgetMax: 18000000,
    location1: 'Whitefield',
    location2: 'Bengaluru East',
    location3: 'Karnataka',
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1100,
    areaMax: 1600,
    possession: 'Ready',
    urgency: 'High',
    formType: 'residential'
  });
  assert.equal(requirement.ok, true);

  const property = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: 'Analytics Towers',
    location: 'Whitefield',
    city: 'Bengaluru',
    bhk: 3,
    area: 1400,
    price: 16000000,
    possession: 'Ready',
    status: 'Available',
    builderId: 'BLD-AN-001'
  });
  assert.equal(property.ok, true);

  const matching = await runtime.runMatching(requirement.data.RequirementID);
  assert.equal(matching.ok, true);
  const match = matching.data.matches.find((item) => item.PropertyID === property.data.PropertyID);
  assert.ok(match);

  const shortlist = await runtime.addToShortlist({
    requirementId: requirement.data.RequirementID,
    propertyId: property.data.PropertyID,
    matchId: match.MatchID,
    priority: 'High',
    notes: 'analytics shortlist'
  });
  assert.equal(shortlist.ok, true);

  const siteVisit = await runtime.createSiteVisit({
    leadId: lead.data.LeadID,
    requirementId: requirement.data.RequirementID,
    propertyId: property.data.PropertyID,
    matchId: match.MatchID,
    shortlistId: shortlist.data.ShortlistID,
    visitDate: '2026-12-20',
    visitTime: '12:00',
    assignedAgentId: 'USR-5001'
  });
  assert.equal(siteVisit.ok, true);

  await runtime.confirmSiteVisit(siteVisit.data.VisitID);
  await runtime.completeSiteVisit(siteVisit.data.VisitID);

  const negotiation = await runtime.createNegotiation({
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    TransactionID: requirement.data.TransactionID,
    PropertyID: property.data.PropertyID,
    MatchID: match.MatchID,
    ShortlistID: shortlist.data.ShortlistID,
    SiteVisitID: siteVisit.data.VisitID,
    AskingPrice: 16000000,
    CurrentOffer: 15600000,
    AgreedPrice: 15600000,
    Status: 'COMPLETED',
    AssignedAgentID: 'USR-5001'
  });
  assert.equal(negotiation.ok, true);

  const token = await runtime.createToken({
    NegotiationID: negotiation.data.NegotiationID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    SiteVisitID: siteVisit.data.VisitID,
    ShortlistID: shortlist.data.ShortlistID,
    TokenAmount: 600000,
    PaidAmount: 600000,
    PendingAmount: 0,
    Status: 'PAID'
  });
  assert.equal(token.ok, true);

  const deal = await runtime.createDeal({
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    MatchID: match.MatchID,
    ShortlistID: shortlist.data.ShortlistID,
    SiteVisitID: siteVisit.data.VisitID,
    NegotiationID: negotiation.data.NegotiationID,
    TokenID: token.data.TokenID,
    FinalPrice: 15600000,
    Brokerage: 312000,
    Status: 'CLOSED'
  });
  assert.equal(deal.ok, true);

  const commission = await runtime.createCommission({
    DealID: deal.data.DealID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    AgentID: 'USR-5001',
    CommissionType: 'PERCENTAGE',
    BaseAmount: 15600000,
    CommissionRate: 2,
    AgentSharePercent: 50,
    CompanySharePercent: 50,
    DueDate: '2027-03-10'
  });
  assert.equal(commission.ok, true);

  const payment = await runtime.recordCommissionPayment(commission.data.CommissionID, {
    Amount: commission.data.GrossCommission,
    PaymentMode: 'BANK_TRANSFER',
    PaymentID: 'PAY-AN-001'
  });
  assert.equal(payment.ok, true);

  const closing = await runtime.startClosing(deal.data.DealID, { CreatedBy: 'USR-5001' });
  assert.equal(closing.ok, true);

  const loaded = await runtime.getClosing(deal.data.DealID);
  for (const item of loaded.data.Checklist) {
    const update = await runtime.updateClosingChecklist(deal.data.DealID, {
      ItemKey: item.ItemKey,
      Status: 'COMPLETED',
      CompletedBy: 'USR-5001'
    });
    assert.equal(update.ok, true);
  }

  const completed = await runtime.completeClosing(deal.data.DealID, { UpdatedBy: 'USR-5001' });
  assert.equal(completed.ok, true);
  const closed = await runtime.closeDeal(deal.data.DealID, { UpdatedBy: 'USR-5001' });
  assert.equal(closed.ok, true);
}

test('analytics endpoints return deterministic module aggregations', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  await seed(runtime);

  const requirements = await runtime.getRequirementsReport({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(requirements.ok, true);
  assert.equal(requirements.data.totalRequirements >= 1, true);
  assert.equal(requirements.data.byCategory.Residential >= 1, true);

  const inventory = await runtime.getInventoryReport({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(inventory.ok, true);
  assert.equal(inventory.data.totalInventory >= 1, true);
  assert.equal(inventory.data.averagePrice > 0, true);

  const matching = await runtime.getMatchingReport({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(matching.ok, true);
  assert.equal(matching.data.totalMatches >= 1, true);
  assert.equal(matching.data.averageMatchScore > 0, true);

  const deals = await runtime.getDealReport({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(deals.ok, true);
  assert.equal(deals.data.totalDeals >= 1, true);
  assert.equal(deals.data.financial.totalDealValue > 0, true);

  const commission = await runtime.getCommissionReport({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(commission.ok, true);
  assert.equal(commission.data.grossCommission > 0, true);
  assert.equal(commission.data.received > 0, true);
});

test('agent, source, location, builder and closing analytics expose performance rows', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  await seed(runtime);

  const agents = await runtime.getAgentsReport({ datePreset: 'thisyear', sortBy: 'HighestDeals' }, { role: 'ADMIN' });
  assert.equal(agents.ok, true);
  assert.equal(agents.data.leaderboard.length >= 1, true);
  assert.equal(agents.data.leaderboard[0].deals >= 1, true);

  const sources = await runtime.getSourcesReport({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(sources.ok, true);
  assert.equal(sources.data.sources.length >= 1, true);

  const locations = await runtime.getLocationsReport({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(locations.ok, true);
  assert.equal(locations.data.locations.length >= 1, true);

  const builders = await runtime.getBuildersReport({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(builders.ok, true);
  assert.equal(builders.data.builders.length >= 1, true);

  const closing = await runtime.getClosingReport({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(closing.ok, true);
  assert.equal(closing.data.closingStarted >= 1, true);
  assert.equal(closing.data.dealClosed >= 1, true);

  const financial = await runtime.getFinancialReport({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(financial.ok, true);
  assert.equal(financial.data.grossDealValue > 0, true);
  assert.equal(financial.data.commission >= 0, true);
});
