const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-reporting-int-')), 'sig-realty-db.json');
}

async function createDataset(runtime, suffix, options = {}) {
  const lead = await runtime.createLead({
    clientName: `Reporting Integration ${suffix}`,
    city: options.city || 'Bengaluru',
    phone: `+91 8777700${suffix}`,
    email: `reporting.integration.${suffix}@example.com`,
    leadStatus: options.leadStatus || 'Active',
    assignedAgentId: options.agentId || 'USR-9001',
    leadSource: options.source || 'Manual'
  });
  assert.equal(lead.ok, true);

  const requirement = await runtime.createRequirement(lead.data.LeadID, `TXN-RI-${suffix}`, {
    leadId: lead.data.LeadID,
    transactionId: `TXN-RI-${suffix}`,
    transactionType: options.transactionType || 'Purchase',
    category: options.category || 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 9000000,
    budgetMax: 19000000,
    location1: options.location || 'Whitefield',
    location2: 'Bengaluru East',
    location3: 'Karnataka',
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1000,
    areaMax: 1700,
    possession: 'Ready',
    urgency: options.urgency || 'High',
    formType: 'residential'
  });
  assert.equal(requirement.ok, true);

  const property = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: options.category || 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: options.project || `Project ${suffix}`,
    location: options.location || 'Whitefield',
    city: options.city || 'Bengaluru',
    bhk: 3,
    area: 1450,
    price: 15000000,
    possession: 'Ready',
    status: 'Available',
    builderId: options.builderId || 'BLD-9001'
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
    priority: 'High'
  });
  assert.equal(shortlist.ok, true);

  const siteVisit = await runtime.createSiteVisit({
    leadId: lead.data.LeadID,
    requirementId: requirement.data.RequirementID,
    propertyId: property.data.PropertyID,
    matchId: match.MatchID,
    shortlistId: shortlist.data.ShortlistID,
    visitDate: '2026-12-09',
    visitTime: '11:30',
    assignedAgentId: options.agentId || 'USR-9001'
  });
  assert.equal(siteVisit.ok, true);

  const negotiation = await runtime.createNegotiation({
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    TransactionID: requirement.data.TransactionID,
    PropertyID: property.data.PropertyID,
    MatchID: match.MatchID,
    ShortlistID: shortlist.data.ShortlistID,
    SiteVisitID: siteVisit.data.VisitID,
    AskingPrice: 15000000,
    CurrentOffer: 14700000,
    AgreedPrice: 14700000,
    Status: 'AGREED',
    AssignedAgentID: options.agentId || 'USR-9001'
  });
  assert.equal(negotiation.ok, true);

  const token = await runtime.createToken({
    NegotiationID: negotiation.data.NegotiationID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    SiteVisitID: siteVisit.data.VisitID,
    ShortlistID: shortlist.data.ShortlistID,
    TokenAmount: 500000,
    PaidAmount: 500000,
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
    FinalPrice: 14700000,
    Brokerage: 294000,
    Status: options.dealStatus || 'COMPLETED'
  });
  assert.equal(deal.ok, true);

  const commission = await runtime.createCommission({
    DealID: deal.data.DealID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    AgentID: options.agentId || 'USR-9001',
    CommissionType: 'PERCENTAGE',
    BaseAmount: 14700000,
    CommissionRate: 2,
    AgentSharePercent: 50,
    CompanySharePercent: 50
  });
  assert.equal(commission.ok, true);
}

test('reports center supports combined filters and persists analytics across restart', async () => {
  const dbFile = makeDbFile();
  const runtime = new SignatureRealtyRuntime(dbFile);

  await createDataset(runtime, 'RI11', { city: 'Bengaluru', category: 'Residential', source: 'Manual', agentId: 'USR-9101', project: 'Lake View' });
  await createDataset(runtime, 'RI12', { city: 'Mumbai', category: 'Commercial', source: 'Reference', agentId: 'USR-9102', project: 'Metro Hub', location: 'BKC' });

  const filtered = await runtime.getReportsCenter({
    datePreset: 'thisyear',
    agentId: 'USR-9101',
    category: 'Residential'
  }, { role: 'ADMIN' });

  assert.equal(filtered.ok, true);
  assert.equal(filtered.data.dashboard.executive.totalLeads, 1);
  assert.equal(filtered.data.leads.totalLeads, 1);
  assert.equal(filtered.data.inventory.totalInventory >= 1, true);
  assert.equal(filtered.data.deals.totalDeals, 1);

  const restarted = new SignatureRealtyRuntime(dbFile);
  const afterRestart = await restarted.getReportsCenter({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(afterRestart.ok, true);
  assert.equal(afterRestart.data.dashboard.executive.totalLeads >= 2, true);
  assert.equal(afterRestart.data.commission.grossCommission > 0, true);
  assert.equal(afterRestart.data.agents.leaderboard.length >= 2, true);

  fs.unlinkSync(dbFile);
});
