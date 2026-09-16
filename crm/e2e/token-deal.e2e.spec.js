const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE_URL = 'http://127.0.0.1:4179';
const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-token-deal-browser-')), 'sig-realty-db.json');
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

  throw new Error(`TokenDeal browser server did not start at ${BASE_URL}`);
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

async function createNegotiationFixture(request, suffix = 'E01') {
  const lead = await requestJson(request, 'POST', '/api/leads', {
    clientName: `TokenDeal E2E Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 9666600${suffix}`,
    email: `token.deal.e2e.${suffix}@example.com`,
    leadStatus: 'Active',
    assignedAgentId: 'USR-0001'
  });
  expect(lead.response.ok()).toBeTruthy();

  const requirement = await requestJson(request, 'POST', '/api/requirements', {
    leadId: lead.payload.data.LeadID,
    transactionId: `TXN-TOKEN-DEAL-E2E-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 11000000,
    budgetMax: 23000000,
    location1: `TokenDeal E2E Location ${suffix}`,
    location2: `TokenDeal E2E East ${suffix}`,
    location3: `TokenDeal E2E District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1800,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'TokenDeal E2E fixture',
    formType: 'residential'
  });
  expect(requirement.response.ok()).toBeTruthy();

  const property = await requestJson(request, 'POST', '/api/inventory', {
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `TokenDeal E2E Project ${suffix}`,
    location: `TokenDeal E2E Location ${suffix}`,
    city: 'Bengaluru',
    bhk: 3,
    area: 1490,
    price: 17500000,
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
    AskingPrice: 17500000,
    CurrentOffer: 17100000,
    AgreedPrice: 17100000,
    Status: 'AGREED',
    Notes: 'TokenDeal E2E negotiation'
  });
  expect(negotiation.response.ok()).toBeTruthy();

  return {
    leadId: lead.payload.data.LeadID,
    requirementId: requirement.payload.data.RequirementID,
    propertyId: property.payload.data.PropertyID,
    negotiationId: negotiation.payload.data.NegotiationID,
    agreedPrice: negotiation.payload.data.AgreedPrice
  };
}

test.beforeAll(async () => {
  browserServer = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '4179', SIG_REALTY_DB_FILE: DB_FILE },
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

test('token-deal API lifecycle works and deal center module renders', async ({ page }) => {
  const fixture = await createNegotiationFixture(page.request, '601');

  const tokenCreate = await requestJson(page.request, 'POST', '/api/tokens', {
    NegotiationID: fixture.negotiationId,
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    TokenAmount: 800000,
    Status: 'PENDING'
  });
  expect(tokenCreate.response.ok()).toBeTruthy();
  expect(tokenCreate.payload.ok).toBeTruthy();

  const tokenList = await requestJson(page.request, 'GET', '/api/tokens');
  expect(tokenList.response.ok()).toBeTruthy();
  expect(tokenList.payload.data.some((item) => item.TokenID === tokenCreate.payload.data.TokenID)).toBeTruthy();

  const dealCreate = await requestJson(page.request, 'POST', '/api/deals', {
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    NegotiationID: fixture.negotiationId,
    TokenID: tokenCreate.payload.data.TokenID,
    FinalPrice: fixture.agreedPrice,
    Brokerage: 342000,
    Status: 'OPEN'
  });
  expect(dealCreate.response.ok()).toBeTruthy();
  expect(dealCreate.payload.ok).toBeTruthy();

  const dealList = await requestJson(page.request, 'GET', '/api/deals');
  expect(dealList.response.ok()).toBeTruthy();
  expect(dealList.payload.data.some((item) => item.DealID === dealCreate.payload.data.DealID)).toBeTruthy();

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 12000 });
  await page.locator('#app-navigation .nav-link', { hasText: 'Deal Center' }).click();

  await expect(page.locator('#app-content h2', { hasText: 'Deal Center' })).toBeVisible();
  await expect(page.locator('#app-content .badge.green', { hasText: 'Token / Agreement / Registration' })).toBeVisible();
  await expect(page.locator('#app-content .report-box h3', { hasText: 'Active Deal' })).toBeVisible();
  await expect(page.locator('#app-content .report-box h3', { hasText: 'Token Amount' })).toBeVisible();
  await expect(page.locator('#app-content .report-box h3', { hasText: 'Commission' })).toBeVisible();
});
