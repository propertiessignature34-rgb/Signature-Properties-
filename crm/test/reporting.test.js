const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-reporting-unit-')), 'sig-realty-db.json');
}

async function createLifecycle(runtime, suffix = 'RP01', overrides = {}) {
  const lead = await runtime.createLead({
    clientName: `Reporting Lead ${suffix}`,
    city: overrides.city || 'Bengaluru',
    phone: `+91 8111100${suffix}`,
    email: `reporting.${suffix}@example.com`,
    leadStatus: overrides.leadStatus || 'Active',
    assignedAgentId: overrides.agentId || 'USR-0001',
    leadSource: overrides.leadSource || 'Manual'
  });
  assert.equal(lead.ok, true);

  const requirement = await runtime.createRequirement(lead.data.LeadID, `TXN-RP-${suffix}`, {
    leadId: lead.data.LeadID,
    transactionId: `TXN-RP-${suffix}`,
    transactionType: overrides.transactionType || 'Purchase',
    category: overrides.category || 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 20000000,
    location1: overrides.location || `Location ${suffix}`,
    location2: `East ${suffix}`,
    location3: `District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1700,
    possession: 'Ready',
    urgency: overrides.urgency || 'High',
    specialNotes: 'Reporting fixture',
    formType: 'residential'
  });
  assert.equal(requirement.ok, true);

  const property = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: overrides.category || 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: overrides.project || `Reporting Project ${suffix}`,
    location: overrides.location || `Location ${suffix}`,
    city: overrides.city || 'Bengaluru',
    bhk: 3,
    area: 1450,
    price: overrides.price || 15500000,
    possession: 'Ready',
    status: overrides.inventoryStatus || 'Available',
    builderId: overrides.builderId || 'BLD-001'
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
    notes: 'Reporting shortlist'
  });
  assert.equal(shortlist.ok, true);

  const visit = await runtime.createSiteVisit({
    leadId: lead.data.LeadID,
    requirementId: requirement.data.RequirementID,
    propertyId: property.data.PropertyID,
    matchId: match.MatchID,
    shortlistId: shortlist.data.ShortlistID,
    visitDate: '2026-12-15',
    visitTime: '10:30',
    assignedAgentId: overrides.agentId || 'USR-0001'
  });
  assert.equal(visit.ok, true);

  const negotiation = await runtime.createNegotiation({
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    TransactionID: requirement.data.TransactionID,
    PropertyID: property.data.PropertyID,
    MatchID: match.MatchID,
    ShortlistID: shortlist.data.ShortlistID,
    SiteVisitID: visit.data.VisitID,
    AskingPrice: overrides.price || 15500000,
    CurrentOffer: 15100000,
    AgreedPrice: 15100000,
    Status: 'AGREED',
    AssignedAgentID: overrides.agentId || 'USR-0001'
  });
  assert.equal(negotiation.ok, true);

  const token = await runtime.createToken({
    NegotiationID: negotiation.data.NegotiationID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    SiteVisitID: visit.data.VisitID,
    ShortlistID: shortlist.data.ShortlistID,
    TokenAmount: 500000,
    PaidAmount: 300000,
    PendingAmount: 200000,
    Status: 'PARTIAL'
  });
  assert.equal(token.ok, true);

  const deal = await runtime.createDeal({
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    MatchID: match.MatchID,
    ShortlistID: shortlist.data.ShortlistID,
    SiteVisitID: visit.data.VisitID,
    NegotiationID: negotiation.data.NegotiationID,
    TokenID: token.data.TokenID,
    FinalPrice: 15100000,
    Brokerage: 302000,
    Status: overrides.dealStatus || 'COMPLETED'
  });
  assert.equal(deal.ok, true);

  const payment = await runtime.createPayment({
    DealID: deal.data.DealID,
    TokenID: token.data.TokenID,
    Amount: 200000,
    PaymentType: 'BROKERAGE',
    PaymentMode: 'UPI',
    Status: 'PAID'
  });
  assert.equal(payment.ok, true);

  const commission = await runtime.createCommission({
    DealID: deal.data.DealID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    AgentID: overrides.agentId || 'USR-0001',
    CommissionType: 'PERCENTAGE',
    BaseAmount: 15100000,
    CommissionRate: 2,
    AgentSharePercent: 50,
    CompanySharePercent: 50,
    DueDate: '2027-01-30'
  });
  assert.equal(commission.ok, true);

  const closing = await runtime.startClosing(deal.data.DealID, { CreatedBy: overrides.agentId || 'USR-0001' });
  assert.equal(closing.ok, true);

  return { lead, requirement, property, match, shortlist, visit, negotiation, token, deal, payment, commission, closing };
}

test('reporting dashboard and leads analytics are derived from persisted lifecycle data', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  await createLifecycle(runtime, 'RPT11', { leadSource: 'Manual', agentId: 'USR-0001', city: 'Bengaluru' });
  await createLifecycle(runtime, 'RPT12', { leadSource: 'Reference', agentId: 'USR-0002', city: 'Mumbai' });

  const dashboard = await runtime.getDashboardReport({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.data.executive.totalLeads >= 2, true);
  assert.equal(dashboard.data.pipeline.deal >= 2, true);
  assert.equal(dashboard.data.financial.grossBrokerage >= 604000, true);

  const leads = await runtime.getLeadsReport({ datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(leads.ok, true);
  assert.equal(leads.data.totalLeads >= 2, true);
  assert.equal(leads.data.sourceBreakdown.length >= 2, true);

  const funnel = leads.data.funnel;
  assert.equal(Array.isArray(funnel), true);
  assert.equal(funnel[0].stage, 'Lead');
  assert.equal(funnel[funnel.length - 1].stage, 'Completed');
});

test('date filter validation and agent-scoped permission behavior are enforced', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  await createLifecycle(runtime, 'RPT21', { agentId: 'USR-9001', leadSource: 'Instagram' });
  await createLifecycle(runtime, 'RPT22', { agentId: 'USR-9002', leadSource: 'Facebook' });

  const invalidRange = await runtime.getDashboardReport({ datePreset: 'custom', dateFrom: '2026-12-31', dateTo: '2026-01-01' }, { role: 'ADMIN' });
  assert.equal(invalidRange.ok, false);
  assert.equal(invalidRange.error.includes('Invalid date range'), true);

  const scoped = await runtime.getDashboardReport({ datePreset: 'thisyear' }, { role: 'AGENT', userId: 'USR-9001' });
  assert.equal(scoped.ok, true);
  assert.equal(scoped.data.executive.totalLeads, 1);

  const scopedLeads = await runtime.getLeadsReport({ datePreset: 'thisyear' }, { role: 'AGENT', userId: 'USR-9002' });
  assert.equal(scopedLeads.ok, true);
  assert.equal(scopedLeads.data.totalLeads, 1);
});

test('report export CSV uses filtered data and produces deterministic headers', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  await createLifecycle(runtime, 'RPT31', { leadSource: 'WhatsApp', agentId: 'USR-3001' });

  const exportResult = await runtime.exportReportCsv('agents', { datePreset: 'thisyear' }, { role: 'ADMIN' });
  assert.equal(exportResult.ok, true);
  assert.equal(exportResult.filename, 'agent-performance-report.csv');
  assert.equal(exportResult.data.startsWith('agentId,leads,requirements,matches,shortlists,siteVisits,negotiations,tokens,deals,completedDeals,grossBrokerage,receivedBrokerage,pendingBrokerage,conversionPercent'), true);
});
