const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE_URL = 'http://127.0.0.1:4181';
const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-commission-closing-browser-')), 'sig-realty-db.json');
let browserServer;

test.setTimeout(90000);

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  throw new Error(`CommissionClosing browser server did not start at ${BASE_URL}`);
}

async function requestJson(request, method, route, data) {
  const response = await request.fetch(`${BASE_URL}${route}`, {
    method,
    data,
    headers: { 'Content-Type': 'application/json' }
  });
  const payload = await response.json();
  return { response, payload };
}

async function createDealFixture(request, suffix = 'E01') {
  const lead = await requestJson(request, 'POST', '/api/leads', {
    clientName: `CommissionClosing E2E Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 9333300${suffix}`,
    email: `commission.closing.e2e.${suffix}@example.com`,
    leadStatus: 'Active',
    assignedAgentId: 'USR-0001'
  });
  expect(lead.response.ok()).toBeTruthy();

  const requirement = await requestJson(request, 'POST', '/api/requirements', {
    leadId: lead.payload.data.LeadID,
    transactionId: `TXN-COMCLOSE-E2E-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 22000000,
    location1: `CommissionClosing E2E Location ${suffix}`,
    location2: `CommissionClosing E2E East ${suffix}`,
    location3: `CommissionClosing E2E District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1800,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'CommissionClosing E2E fixture',
    formType: 'residential'
  });
  expect(requirement.response.ok()).toBeTruthy();

  const property = await requestJson(request, 'POST', '/api/inventory', {
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `CommissionClosing E2E Project ${suffix}`,
    location: `CommissionClosing E2E Location ${suffix}`,
    city: 'Bengaluru',
    bhk: 3,
    area: 1500,
    price: 17600000,
    possession: 'Ready',
    status: 'Available'
  });
  expect(property.response.ok()).toBeTruthy();

  const matching = await requestJson(request, 'POST', '/api/matching/run', {
    requirementId: requirement.payload.data.RequirementID
  });
  expect(matching.response.ok()).toBeTruthy();

  const match = matching.payload.data.matches.find((item) => item.PropertyID === property.payload.data.PropertyID);
  expect(match).toBeTruthy();

  const negotiation = await requestJson(request, 'POST', '/api/negotiations', {
    LeadID: lead.payload.data.LeadID,
    RequirementID: requirement.payload.data.RequirementID,
    TransactionID: requirement.payload.data.TransactionID,
    PropertyID: property.payload.data.PropertyID,
    MatchID: match.MatchID,
    AskingPrice: 17600000,
    CurrentOffer: 17100000,
    AgreedPrice: 17100000,
    Status: 'AGREED',
    Notes: 'CommissionClosing E2E negotiation'
  });
  expect(negotiation.response.ok()).toBeTruthy();

  const token = await requestJson(request, 'POST', '/api/tokens', {
    NegotiationID: negotiation.payload.data.NegotiationID,
    LeadID: lead.payload.data.LeadID,
    RequirementID: requirement.payload.data.RequirementID,
    PropertyID: property.payload.data.PropertyID,
    TokenAmount: 900000,
    Status: 'PAID'
  });
  expect(token.response.ok()).toBeTruthy();

  const deal = await requestJson(request, 'POST', '/api/deals', {
    LeadID: lead.payload.data.LeadID,
    RequirementID: requirement.payload.data.RequirementID,
    PropertyID: property.payload.data.PropertyID,
    MatchID: match.MatchID,
    NegotiationID: negotiation.payload.data.NegotiationID,
    TokenID: token.payload.data.TokenID,
    FinalPrice: 17100000,
    Brokerage: 342000,
    Status: 'COMPLETED'
  });
  expect(deal.response.ok()).toBeTruthy();

  const commission = await requestJson(request, 'POST', '/api/commission', {
    DealID: deal.payload.data.DealID,
    NegotiationID: negotiation.payload.data.NegotiationID,
    TokenID: token.payload.data.TokenID,
    TransactionID: requirement.payload.data.TransactionID,
    LeadID: lead.payload.data.LeadID,
    PropertyID: property.payload.data.PropertyID,
    CommissionType: 'PERCENTAGE',
    BaseAmount: 17100000,
    CommissionRate: 2,
    AgentSharePercent: 50,
    CompanySharePercent: 50,
    DueDate: '2027-04-20'
  });
  expect(commission.response.ok()).toBeTruthy();

  return {
    leadId: lead.payload.data.LeadID,
    dealId: deal.payload.data.DealID,
    commissionId: commission.payload.data.CommissionID,
    commissionGross: commission.payload.data.GrossCommission
  };
}

test.beforeAll(async () => {
  browserServer = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '4181', SIG_REALTY_DB_FILE: DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  browserServer.stdout.setEncoding('utf8');
  browserServer.stderr.setEncoding('utf8');
  await waitForServer();
});

test.afterAll(async () => {
  if (browserServer && !browserServer.killed) {
    browserServer.kill('SIGTERM');
  }
});

test('commission and closing modules render and complete lifecycle from UI + APIs', async ({ page }) => {
  const fixture = await createDealFixture(page.request, '701');

  const startClosingRes = await requestJson(page.request, 'POST', `/api/closing/${fixture.dealId}/start`, {
    CreatedBy: 'USR-0001'
  });
  expect(startClosingRes.response.ok()).toBeTruthy();

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 12000 });

  await page.locator('#app-navigation .nav-link', { hasText: 'Commission' }).click();
  await expect(page.locator('#app-content').getByRole('heading', { name: 'Commission', exact: true })).toBeVisible();
  await expect(page.locator('#app-content .kpi-card .label', { hasText: 'Total Commission' })).toBeVisible();
  await expect(page.locator('#app-content .kpi-card .label', { hasText: 'Received' })).toBeVisible();

  const paymentRes = await requestJson(page.request, 'POST', `/api/commission/${fixture.commissionId}/payment`, {
    Amount: fixture.commissionGross,
    PaymentMode: 'BANK_TRANSFER',
    PaymentID: 'PAY-E2E-701'
  });
  expect(paymentRes.response.ok()).toBeTruthy();

  let closing = await requestJson(page.request, 'GET', `/api/closing/${fixture.dealId}`);
  expect(closing.response.ok()).toBeTruthy();

  for (const item of closing.payload.data.Checklist) {
    const updateRes = await requestJson(page.request, 'PATCH', `/api/closing/${fixture.dealId}/checklist`, {
      ItemKey: item.ItemKey,
      Status: 'COMPLETED',
      CompletedBy: 'USR-0002'
    });
    expect(updateRes.response.ok()).toBeTruthy();
  }

  const completeRes = await requestJson(page.request, 'POST', `/api/closing/${fixture.dealId}/complete`, {
    UpdatedBy: 'USR-0002'
  });
  expect(completeRes.response.ok()).toBeTruthy();

  const closeRes = await requestJson(page.request, 'POST', `/api/closing/${fixture.dealId}/close`, {
    UpdatedBy: 'USR-0002'
  });
  expect(closeRes.response.ok()).toBeTruthy();

  await page.locator('#app-navigation .nav-link', { hasText: 'Deal Center' }).click();
  await expect(page.locator('#app-content h2', { hasText: 'Deal Center' })).toBeVisible();

  await page.locator('#app-navigation .nav-link', { hasText: 'Commission' }).click();
  await expect(page.locator('#app-content').getByRole('heading', { name: 'Commission', exact: true })).toBeVisible();

  const ledgerSection = page.locator('#app-content .card-section').filter({ has: page.locator('h2', { hasText: 'Commission Ledger' }) });
  const commissionRow = ledgerSection.locator('tbody tr', { hasText: fixture.commissionId });
  await expect(commissionRow).toContainText('RECEIVED');

  closing = await requestJson(page.request, 'GET', `/api/closing/${fixture.dealId}`);
  expect(closing.response.ok()).toBeTruthy();
  expect(closing.payload.data.Status).toBe('CLOSED');
});
