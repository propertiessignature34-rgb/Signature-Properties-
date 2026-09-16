const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE_URL = 'http://127.0.0.1:4175';
const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-shortlist-browser-')), 'sig-realty-db.json');

let browserServer;

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Shortlist server did not start at ${BASE_URL}`);
}

test.beforeAll(async () => {
  browserServer = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '4175', SIG_REALTY_DB_FILE: DB_FILE },
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

async function createFixture(page, suffix = 'A') {
  const city = `Shortlist Browser City ${suffix}`;
  const location = `Shortlist Browser Location ${suffix}`;

  const leadResponse = await page.request.post(`${BASE_URL}/api/leads`, {
    data: {
      clientName: `Shortlist Browser Lead ${suffix}`,
      city,
      phone: `+91 9222200${suffix}`,
      email: `shortlist.browser.${suffix}@example.com`,
      leadStatus: 'New',
      assignedAgentId: 'USR-0001'
    }
  });
  const leadPayload = await leadResponse.json();

  const requirementResponse = await page.request.post(`${BASE_URL}/api/requirements`, {
    data: {
      leadId: leadPayload.data.LeadID,
      transactionId: `TXN-SL-BROWSER-${suffix}`,
      transactionType: 'Purchase',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      budgetMin: 10000000,
      budgetMax: 20000000,
      location1: location,
      location2: `${location} Block B`,
      location3: `${location} District`,
      bhkMin: 3,
      bhkMax: 3,
      areaMin: 1300,
      areaMax: 1700,
      possession: 'Ready',
      urgency: 'High',
      specialNotes: 'shortlist browser fixture',
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
      project: `Shortlist Browser Crest ${suffix}`,
      location,
      city,
      bhk: 3,
      area: 1450,
      price: 15000000,
      possession: 'Ready',
      status: 'Available',
      ownerId: `OWN-SL-BROWSER-${suffix}`,
      brokerId: `BRO-SL-BROWSER-${suffix}`,
      builderId: `BUIL-SL-BROWSER-${suffix}`
    }
  });
  const propertyPayload = await propertyResponse.json();

  return {
    leadId: leadPayload.data.LeadID,
    requirementId: requirementPayload.data.RequirementID,
    requirementCode: requirementPayload.data.RequirementCode,
    propertyId: propertyPayload.data.PropertyID
  };
}

async function openMatchingForRequirement(page, fixture) {
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 10000 });
  await page.locator('#app-navigation .nav-link').nth(1).click();
  await page.locator('#app-content').waitFor({ state: 'attached', timeout: 5000 });
  await page.locator(`#app-content .open-lead[data-lead-id="${fixture.leadId}"]`).click();

  const row = page.locator('#app-content tbody tr').filter({ hasText: fixture.requirementCode }).first();
  await expect(row).toBeVisible();
  await page.evaluate((requirementId) => {
    if (typeof window.renderMatching === 'function') {
      window.renderMatching(requirementId);
    }
  }, fixture.requirementId);

  await page.locator('.matching-shell').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#runMatchingBtn').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#runMatchingBtn').click();
  await page.locator('.match-card').first().waitFor({ state: 'visible', timeout: 15000 });
}

test('shortlist full browser flow with API consistency, reload persistence, remove and re-add', async ({ page }) => {
  const fixture = await createFixture(page, '101');
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

  await openMatchingForRequirement(page, fixture);

  const targetCard = page.locator(`.match-card[data-property-id="${fixture.propertyId}"]`).first();
  await expect(targetCard).toBeVisible();

  const apiMatchesBeforeAdd = await page.request.get(`${BASE_URL}/api/requirements/${fixture.requirementId}/matches`);
  const apiMatchesPayload = await apiMatchesBeforeAdd.json();
  const apiMatch = apiMatchesPayload.data.matches.find((item) => item.PropertyID === fixture.propertyId);
  expect(apiMatch).toBeTruthy();

  await targetCard.locator('.add-shortlist-btn').click();
  await expect(targetCard.locator('.add-shortlist-btn')).toHaveText('✓ Shortlisted');

  const shortlistApiAfterAdd = await page.request.get(`${BASE_URL}/api/requirements/${fixture.requirementId}/shortlist?status=Active`);
  const shortlistApiPayload = await shortlistApiAfterAdd.json();
  expect(shortlistApiPayload.ok).toBeTruthy();
  expect(shortlistApiPayload.data.length).toBe(1);

  await page.locator('#openShortlist').click();
  await page.locator('h2', { hasText: 'Shortlist' }).waitFor({ state: 'visible', timeout: 5000 });

  const shortlistRow = page.locator(`#app-content tbody tr[data-property-id="${fixture.propertyId}"]`).first();
  await expect(shortlistRow).toBeVisible();

  const browserShortlistId = await shortlistRow.getAttribute('data-shortlist-id');
  const browserPropertyId = await shortlistRow.getAttribute('data-property-id');
  const browserMatchId = await shortlistRow.getAttribute('data-match-id');
  const browserPriority = await shortlistRow.getAttribute('data-priority');
  const browserStatus = await shortlistRow.getAttribute('data-status');

  expect(browserPropertyId).toBe(fixture.propertyId);
  expect(browserMatchId).toBe(apiMatch.MatchID);
  expect(browserStatus).toBe('Active');
  expect(browserPriority).toBe('Medium');

  const shortlistByIdResponse = await page.request.get(`${BASE_URL}/api/shortlist/${browserShortlistId}`);
  const shortlistByIdPayload = await shortlistByIdResponse.json();
  expect(shortlistByIdPayload.ok).toBeTruthy();
  expect(shortlistByIdPayload.data.ShortlistID).toBe(browserShortlistId);
  expect(shortlistByIdPayload.data.RequirementID).toBe(fixture.requirementId);
  expect(shortlistByIdPayload.data.PropertyID).toBe(browserPropertyId);
  expect(shortlistByIdPayload.data.MatchID).toBe(browserMatchId);
  expect(shortlistByIdPayload.data.Priority).toBe(browserPriority);
  expect(shortlistByIdPayload.data.Status).toBe(browserStatus);

  await page.reload({ waitUntil: 'load' });
  await page.locator('#app-navigation .nav-link').nth(6).click();
  await page.locator(`#app-content tbody tr[data-property-id="${fixture.propertyId}"]`).first().waitFor({ state: 'visible', timeout: 5000 });

  await page.locator('.remove-shortlist-btn').first().click();
  await expect(page.locator('#app-content')).toContainText('No shortlisted properties found.');

  await openMatchingForRequirement(page, fixture);
  const targetCardAgain = page.locator(`.match-card[data-property-id="${fixture.propertyId}"]`).first();
  const addBtnAgain = targetCardAgain.locator('.add-shortlist-btn');
  await addBtnAgain.click();
  await expect(addBtnAgain).toHaveText('✓ Shortlisted');

  await page.reload({ waitUntil: 'load' });
  await page.locator('#app-navigation .nav-link').nth(6).click();
  await page.locator(`#app-content tbody tr[data-property-id="${fixture.propertyId}"]`).first().waitFor({ state: 'visible', timeout: 5000 });

  const activeAfterReAdd = await page.request.get(`${BASE_URL}/api/requirements/${fixture.requirementId}/shortlist?status=Active`);
  const activeAfterReAddPayload = await activeAfterReAdd.json();
  expect(activeAfterReAddPayload.data.filter((item) => item.PropertyID === fixture.propertyId).length).toBe(1);

  expect(consoleErrors.length).toBe(0);
  expect(pageErrors.length).toBe(0);
});

test('shortlist responsive verification for 360/390/768/1024 with zero overflow and zero errors', async ({ browser }) => {
  const seedPage = await browser.newPage();
  const fixture = await createFixture(seedPage, '202');
  await seedPage.close();
  const viewports = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 }
  ];

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
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

    await openMatchingForRequirement(page, fixture);
    const card = page.locator(`.match-card[data-property-id="${fixture.propertyId}"]`).first();
    const button = card.locator('.add-shortlist-btn');
    if (await button.isEnabled()) {
      await button.click();
      await expect(button).toHaveText('✓ Shortlisted');
    }

    await page.locator('#openShortlist').click();

    const shortlistRow = page.locator(`#app-content tbody tr[data-property-id="${fixture.propertyId}"]`).first();
    const shortlistCard = page.locator(`#app-content .shortlist-mobile-card[data-property-id="${fixture.propertyId}"]`).first();

    if (viewport.width <= 768) {
      await shortlistCard.waitFor({ state: 'visible', timeout: 5000 });
    } else {
      await shortlistRow.waitFor({ state: 'visible', timeout: 5000 });
    }

    const state = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      text: document.querySelector('#app-content')?.innerText || ''
    }));
    const normalizedText = state.text.toLowerCase();

    expect(state.scrollWidth - state.clientWidth).toBe(0);
    expect(normalizedText.includes('shortlist')).toBeTruthy();
    expect(normalizedText.includes('score')).toBeTruthy();
    expect(normalizedText.includes('priority')).toBeTruthy();
    expect(normalizedText.includes('status')).toBeTruthy();

    const actionScope = viewport.width <= 768 ? shortlistCard : shortlistRow;
    await expect(actionScope.locator('.remove-shortlist-btn')).toBeVisible();
    await expect(actionScope.locator('.save-shortlist-btn')).toBeVisible();

    expect(consoleErrors.length).toBe(0);
    expect(pageErrors.length).toBe(0);

    await page.screenshot({ path: `test/e2e/screenshots/shortlist-${viewport.width}x${viewport.height}.png`, fullPage: true });
    await page.close();
  }
});
