const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE_URL = 'http://127.0.0.1:4178';
const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-negotiation-browser-')), 'sig-realty-db.json');
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

  throw new Error(`Negotiation browser server did not start at ${BASE_URL}`);
}

async function createFixture(page, suffix = 'N01') {
  const location = `Negotiation Browser Location ${suffix}`;

  const leadResponse = await page.request.post(`${BASE_URL}/api/leads`, {
    data: {
      clientName: `Negotiation Browser Lead ${suffix}`,
      city: 'Bengaluru',
      phone: `+91 944440${suffix}`,
      email: `negotiation.browser.${suffix}@example.com`,
      leadStatus: 'Active',
      assignedAgentId: 'USR-0001'
    }
  });
  const leadPayload = await leadResponse.json();

  const requirementResponse = await page.request.post(`${BASE_URL}/api/requirements`, {
    data: {
      leadId: leadPayload.data.LeadID,
      transactionId: `TXN-NEG-BROWSER-${suffix}`,
      transactionType: 'Purchase',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      budgetMin: 10000000,
      budgetMax: 20000000,
      location1: location,
      location2: `${location} East`,
      location3: `${location} District`,
      bhkMin: 2,
      bhkMax: 3,
      areaMin: 1200,
      areaMax: 1700,
      possession: 'Ready',
      urgency: 'High',
      specialNotes: 'Negotiation browser fixture',
      formType: 'residential'
    }
  });
  const requirementPayload = await requirementResponse.json();

  const propertyResponse = await page.request.post(`${BASE_URL}/api/inventory`, {
    data: {
      transactionType: 'Sale',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      project: `Negotiation Browser Crest ${suffix}`,
      location,
      city: 'Bengaluru',
      bhk: 3,
      area: 1450,
      price: 15500000,
      possession: 'Ready',
      status: 'Available'
    }
  });
  const propertyPayload = await propertyResponse.json();

  const runResponse = await page.request.post(`${BASE_URL}/api/matching/run`, {
    data: { requirementId: requirementPayload.data.RequirementID }
  });
  const runPayload = await runResponse.json();
  const match = runPayload.data.matches.find((item) => item.PropertyID === propertyPayload.data.PropertyID);

  const shortlistResponse = await page.request.post(`${BASE_URL}/api/shortlist`, {
    data: {
      requirementId: requirementPayload.data.RequirementID,
      propertyId: propertyPayload.data.PropertyID,
      matchId: match.MatchID,
      priority: 'High',
      notes: 'Negotiation browser shortlist'
    }
  });
  const shortlistPayload = await shortlistResponse.json();

  const siteVisitResponse = await page.request.post(`${BASE_URL}/api/site-visits`, {
    data: {
      leadId: leadPayload.data.LeadID,
      requirementId: requirementPayload.data.RequirementID,
      propertyId: propertyPayload.data.PropertyID,
      matchId: match.MatchID,
      shortlistId: shortlistPayload.data.ShortlistID,
      visitDate: '2026-12-18',
      visitTime: '11:45',
      duration: '90 mins',
      meetingPoint: 'Lobby',
      assignedAgentId: 'USR-0001',
      clientName: `Negotiation Browser Lead ${suffix}`,
      clientPhone: `+91 944440${suffix}`
    }
  });
  const siteVisitPayload = await siteVisitResponse.json();

  return {
    leadId: leadPayload.data.LeadID,
    requirementId: requirementPayload.data.RequirementID,
    requirementCode: requirementPayload.data.RequirementCode,
    propertyId: propertyPayload.data.PropertyID,
    matchId: match.MatchID,
    shortlistId: shortlistPayload.data.ShortlistID,
    siteVisitId: siteVisitPayload.data.VisitID
  };
}

async function openShortlist(page, fixture) {
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 12000 });
  await page.locator('#app-navigation .nav-link').nth(1).click();
  await page.locator(`#app-content .open-lead[data-lead-id="${fixture.leadId}"]`).click();
  await page.evaluate((requirementId) => {
    if (typeof window.renderShortlist === 'function') {
      window.renderShortlist(requirementId);
    }
  }, fixture.requirementId);

  await page.locator('h2', { hasText: 'Shortlist' }).waitFor({ state: 'visible', timeout: 7000 });
}

async function clickWithDialogs(page, locator, answers = []) {
  let index = 0;
  const handler = async (dialog) => {
    const value = index < answers.length ? answers[index] : '';
    index += 1;
    await dialog.accept(value);
  };

  page.on('dialog', handler);
  await locator.click();
  page.off('dialog', handler);
}

test.beforeAll(async () => {
  browserServer = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '4178', SIG_REALTY_DB_FILE: DB_FILE },
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

test('negotiation end-to-end flow from shortlist/site-visit to completion with persisted history', async ({ page }) => {
  const fixture = await createFixture(page, '401');
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await openShortlist(page, fixture);

  const startButton = page.locator(`.start-negotiation-btn[data-shortlist-id="${fixture.shortlistId}"]:visible`).first();
  await expect(startButton).toBeVisible();
  await startButton.click();

  await expect(page.locator('#negotiation-form')).toBeVisible();
  await page.fill('#negotiation-form input[name="askingPrice"]', '15500000');
  await page.fill('#negotiation-form input[name="initialOffer"]', '14900000');
  await page.fill('#negotiation-form input[name="currentOffer"]', '15100000');
  await page.fill('#negotiation-form input[name="brokeragePercent"]', '2');
  await page.fill('#negotiation-form textarea[name="notes"]', 'Negotiation E2E create');

  const createResponsePromise = page.waitForResponse((response) => response.url().includes('/api/negotiations') && response.request().method() === 'POST');
  await page.locator('#negotiation-form button[type="submit"]').click();
  const createResponse = await createResponsePromise;
  expect(createResponse.ok()).toBeTruthy();

  const createPayload = await createResponse.json();
  expect(createPayload.ok).toBeTruthy();
  const negotiationId = createPayload.data.NegotiationID;

  const row = page.locator(`tr[data-negotiation-id="${negotiationId}"]`).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('OPEN');

  await clickWithDialogs(page, row.locator('.neg-action-btn[data-action="offer"]').first(), ['15150000']);
  await expect(row).toContainText('OFFER_MADE');

  await clickWithDialogs(page, row.locator('.neg-action-btn[data-action="counter"]').first(), ['15350000']);
  await expect(row).toContainText('COUNTER_OFFER');

  await clickWithDialogs(page, row.locator('.neg-action-btn[data-action="accept"]').first(), ['15300000']);
  await expect(row).toContainText('AGREED');

  await clickWithDialogs(page, row.locator('.neg-action-btn[data-action="agree"]').first(), ['15300000']);
  await expect(row).toContainText('AGREED');

  await clickWithDialogs(page, row.locator('.neg-action-btn[data-action="token"]').first(), ['500000', '2026-12-20']);
  await expect(row).toContainText('TOKEN_RECEIVED');

  await row.locator('.neg-action-btn[data-action="agreement"]').first().click();
  await expect(row).toContainText('AGREEMENT_DONE');

  await row.locator('.neg-action-btn[data-action="registration"]').first().click();
  await expect(row).toContainText('REGISTRATION_PENDING');

  await row.locator('.neg-action-btn[data-action="complete"]').first().click();
  await expect(row).toContainText('COMPLETED');

  await row.locator('.neg-history-btn').first().click();
  await expect(page.locator('#negotiationHistoryPanel')).toContainText('STATUS_CHANGED');
  await expect(page.locator('#negotiationHistoryPanel')).toContainText('OFFER_UPDATED');

  const negotiationResponse = await page.request.get(`${BASE_URL}/api/negotiations/${negotiationId}`);
  const negotiationPayload = await negotiationResponse.json();
  expect(negotiationPayload.ok).toBeTruthy();
  expect(negotiationPayload.data.Status).toBe('COMPLETED');
  expect(negotiationPayload.data.AgreedPrice).toBe(15300000);
  expect(negotiationPayload.data.BrokerageAmount).toBe(306000);

  const historyResponse = await page.request.get(`${BASE_URL}/api/negotiations/${negotiationId}/history`);
  const historyPayload = await historyResponse.json();
  expect(historyPayload.ok).toBeTruthy();
  expect(historyPayload.data.length).toBeGreaterThanOrEqual(8);

  expect(consoleErrors.length).toBe(0);
  expect(pageErrors.length).toBe(0);
});

test('negotiation workspace responsive proof for 360/390/768/1024', async ({ browser }) => {
  const viewports = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 }
  ];

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const fixture = await createFixture(page, `402-${viewport.width}`);

    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await openShortlist(page, fixture);
    const startNegotiationButton = page.locator(`.start-negotiation-btn[data-shortlist-id="${fixture.shortlistId}"]:visible`).first();
    await expect(startNegotiationButton).toBeVisible();
    await startNegotiationButton.click();
    await expect(page.locator('#negotiation-form')).toBeVisible();

    await page.fill('#negotiation-form input[name="askingPrice"]', '15500000');
    await page.fill('#negotiation-form input[name="initialOffer"]', '14900000');
    await page.fill('#negotiation-form input[name="currentOffer"]', '15100000');
    await page.fill('#negotiation-form input[name="brokeragePercent"]', '2');

    const createResponsePromise = page.waitForResponse((response) => response.url().includes('/api/negotiations') && response.request().method() === 'POST');
    await page.locator('#negotiation-form button[type="submit"]').click();
    const createResponse = await createResponsePromise;
    expect(createResponse.ok()).toBeTruthy();

    const state = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));

    expect(state.scrollWidth - state.clientWidth).toBe(0);
    await expect(page.locator('h2', { hasText: 'Negotiation Workspace' })).toBeVisible();
    await expect(page.locator('.negotiation-status-grid')).toBeVisible();

    expect(consoleErrors.length).toBe(0);
    expect(pageErrors.length).toBe(0);

    await page.close();
  }
});
