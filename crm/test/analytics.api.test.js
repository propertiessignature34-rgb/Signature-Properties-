const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { apiFetchAuth } = require('./admin-test-utils');
const apiFetch = (url, options = {}) => apiFetchAuth(url, { ...options, useDefaultAuth: true });

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-analytics-api-')), 'sig-realty-db.json');
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(() => {});
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

async function startServer(dbPath) {
  const port = await findFreePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), SIG_REALTY_DB_FILE: dbPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const timeout = Date.now() + 15000;
  while (Date.now() < timeout) {
    if (child.exitCode !== null) break;
    try {
      const res = await apiFetch(`${baseUrl}/health`);
      if (res.ok) return { child, baseUrl };
    } catch (_) {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  child.kill('SIGTERM');
  await once(child, 'exit');
  throw new Error('Server failed to start');
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
}

async function post(baseUrl, route, payload) {
  const res = await apiFetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.equal(res.status, 200);
  return res.json();
}

async function seed(baseUrl) {
  const lead = await post(baseUrl, '/api/leads', {
    clientName: 'Analytics API Lead',
    city: 'Bengaluru',
    phone: '+91 8444400123',
    email: 'analytics.api@example.com',
    leadStatus: 'Active',
    assignedAgentId: 'USR-8201',
    leadSource: 'Housing'
  });

  const requirement = await post(baseUrl, '/api/requirements', {
    leadId: lead.data.LeadID,
    transactionId: 'TXN-AAPI-01',
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 21000000,
    location1: 'Whitefield',
    location2: 'Bengaluru East',
    location3: 'Karnataka',
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1100,
    areaMax: 1700,
    possession: 'Ready',
    urgency: 'High',
    formType: 'residential'
  });

  const property = await post(baseUrl, '/api/inventory', {
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: 'Analytics API Project',
    location: 'Whitefield',
    city: 'Bengaluru',
    bhk: 3,
    area: 1490,
    price: 17200000,
    possession: 'Ready',
    status: 'Available',
    builderId: 'BLD-AAPI-1'
  });

  const matching = await post(baseUrl, '/api/matching/run', { requirementId: requirement.data.RequirementID });
  const match = matching.data.matches.find((item) => item.PropertyID === property.data.PropertyID);
  assert.ok(match);

  const shortlist = await post(baseUrl, '/api/shortlist', {
    requirementId: requirement.data.RequirementID,
    propertyId: property.data.PropertyID,
    matchId: match.MatchID,
    priority: 'High'
  });

  const visit = await post(baseUrl, '/api/site-visits', {
    leadId: lead.data.LeadID,
    requirementId: requirement.data.RequirementID,
    propertyId: property.data.PropertyID,
    matchId: match.MatchID,
    shortlistId: shortlist.data.ShortlistID,
    visitDate: '2026-12-17',
    visitTime: '11:30',
    assignedAgentId: 'USR-8201'
  });

  await apiFetch(`${baseUrl}/api/site-visits/${visit.data.VisitID}/confirm`, { method: 'PATCH' });
  await apiFetch(`${baseUrl}/api/site-visits/${visit.data.VisitID}/complete`, { method: 'PATCH' });

  const negotiation = await post(baseUrl, '/api/negotiations', {
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    TransactionID: requirement.data.TransactionID,
    PropertyID: property.data.PropertyID,
    MatchID: match.MatchID,
    ShortlistID: shortlist.data.ShortlistID,
    SiteVisitID: visit.data.VisitID,
    AskingPrice: 17200000,
    CurrentOffer: 16800000,
    AgreedPrice: 16800000,
    Status: 'COMPLETED',
    AssignedAgentID: 'USR-8201'
  });

  const token = await post(baseUrl, '/api/tokens', {
    NegotiationID: negotiation.data.NegotiationID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    SiteVisitID: visit.data.VisitID,
    ShortlistID: shortlist.data.ShortlistID,
    TokenAmount: 700000,
    PaidAmount: 700000,
    PendingAmount: 0,
    Status: 'PAID'
  });

  const deal = await post(baseUrl, '/api/deals', {
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    MatchID: match.MatchID,
    ShortlistID: shortlist.data.ShortlistID,
    SiteVisitID: visit.data.VisitID,
    NegotiationID: negotiation.data.NegotiationID,
    TokenID: token.data.TokenID,
    FinalPrice: 16800000,
    Brokerage: 336000,
    Status: 'CLOSED'
  });

  const commission = await post(baseUrl, '/api/commission', {
    DealID: deal.data.DealID,
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    AgentID: 'USR-8201',
    CommissionType: 'PERCENTAGE',
    BaseAmount: 16800000,
    CommissionRate: 2,
    AgentSharePercent: 50,
    CompanySharePercent: 50
  });

  await post(baseUrl, `/api/commission/${commission.data.CommissionID}/payment`, {
    Amount: commission.data.GrossCommission,
    PaymentMode: 'UPI',
    PaymentID: 'PAY-AAPI-001'
  });

  await post(baseUrl, `/api/closing/${deal.data.DealID}/start`, {});
}

test('analytics API endpoints return expected shapes and values', async () => {
  const dbPath = makeDbFile();
  const { child, baseUrl } = await startServer(dbPath);

  try {
    await seed(baseUrl);

    const routes = [
      '/api/reports/requirements?datePreset=thisyear',
      '/api/reports/inventory?datePreset=thisyear',
      '/api/reports/matching?datePreset=thisyear',
      '/api/reports/shortlist?datePreset=thisyear',
      '/api/reports/site-visits?datePreset=thisyear',
      '/api/reports/negotiations?datePreset=thisyear',
      '/api/reports/tokens?datePreset=thisyear',
      '/api/reports/deals?datePreset=thisyear',
      '/api/reports/commission?datePreset=thisyear',
      '/api/reports/closing?datePreset=thisyear',
      '/api/reports/agents?datePreset=thisyear',
      '/api/reports/sources?datePreset=thisyear',
      '/api/reports/locations?datePreset=thisyear',
      '/api/reports/builders?datePreset=thisyear',
      '/api/reports/financial?datePreset=thisyear'
    ];

    for (const route of routes) {
      const res = await apiFetch(`${baseUrl}${route}`);
      assert.equal(res.status, 200);
      const payload = await res.json();
      assert.equal(payload.ok, true, route);
      assert.equal(Boolean(payload.data), true, route);
    }

    const commissionRes = await apiFetch(`${baseUrl}/api/reports/commission?datePreset=thisyear`);
    const commission = await commissionRes.json();
    assert.equal(commission.data.grossCommission > 0, true);
    assert.equal(commission.data.received > 0, true);

    const dealsRes = await apiFetch(`${baseUrl}/api/reports/deals?datePreset=thisyear`);
    const deals = await dealsRes.json();
    assert.equal(deals.data.totalDeals >= 1, true);
    assert.equal(deals.data.financial.totalDealValue > 0, true);
  } finally {
    await stopServer(child);
    fs.unlinkSync(dbPath);
  }
});
