const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE_URL = 'http://127.0.0.1:4174';
const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-matching-browser-')), 'sig-realty-db.json');

let browserServer;

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  throw new Error(`Matching browser server did not start at ${BASE_URL}`);
}

test.beforeAll(async () => {
  browserServer = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '4174', SIG_REALTY_DB_FILE: DB_FILE },
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

async function createMatchingFixture(page, suffix) {
  const city = `Copilot City ${suffix}`;
  const location1 = `Copilot Tower ${suffix}`;
  const location2 = `Copilot Avenue ${suffix}`;
  const location3 = `Copilot District ${suffix}`;

  const leadResponse = await page.request.post(`${BASE_URL}/api/leads`, {
    data: {
      clientName: `Matching Browser Lead ${suffix}`,
      city,
      phone: `+91 9000001${suffix}`,
      email: `matching.browser.${suffix}@example.com`,
      leadStatus: 'New',
      assignedAgentId: 'USR-0001'
    }
  });
  const leadPayload = await leadResponse.json();

  const requirementResponse = await page.request.post(`${BASE_URL}/api/requirements`, {
    data: {
      leadId: leadPayload.data.LeadID,
      transactionId: `TXN-BROWSER-${suffix}`,
      transactionType: 'Purchase',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      budgetMin: 10000000,
      budgetMax: 20000000,
      location1,
      location2,
      location3,
      bhkMin: 2,
      bhkMax: 3,
      areaMin: 1300,
      areaMax: 1700,
      possession: 'Ready',
      urgency: 'High',
      specialNotes: 'Browser matching verification',
      formType: 'residential'
    }
  });
  const requirementPayload = await requirementResponse.json();

  const inventoryResponse = await page.request.post(`${BASE_URL}/api/inventory`, {
    data: {
      transactionType: 'Sale',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      project: `Browser Crest ${suffix}`,
      location: location1,
      city,
      bhk: 3,
      area: 1450,
      price: 15000000,
      possession: 'Ready',
      status: 'Available',
      ownerId: `OWN-BROWSER-${suffix}`,
      brokerId: `BRO-BROWSER-${suffix}`,
      builderId: `BUIL-BROWSER-${suffix}`
    }
  });
  const inventoryPayload = await inventoryResponse.json();

  return {
    leadId: leadPayload.data.LeadID,
    requirementId: requirementPayload.data.RequirementID,
    requirementCode: requirementPayload.data.RequirementCode,
    propertyId: inventoryPayload.data.PropertyID
  };
}

async function openMatchingScreen(page, leadId, requirementCode) {
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 10000 });
  await page.locator('#app-navigation .nav-link').nth(1).click();
  await page.locator('#app-content').waitFor({ state: 'attached', timeout: 5000 });

  await page.locator(`#app-content .open-lead[data-lead-id="${leadId}"]`).click();

  const targetRow = page.locator('#app-content tbody tr').filter({ hasText: requirementCode }).first();
  await expect(targetRow).toBeVisible();
  await targetRow.locator('button[title="Run Matching"]').click();
  await page.locator('#runMatchingBtn').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#runMatchingBtn').click();
}

test('matching screen runs against live data and renders persisted match cards', async ({ page }) => {
  const fixture = await createMatchingFixture(page, '101');
  await openMatchingScreen(page, fixture.leadId, fixture.requirementCode);

  await page.locator('.match-card').first().waitFor({ state: 'visible', timeout: 15000 });
  const firstCard = page.locator('.match-card').first();
  await expect(firstCard).toHaveAttribute('data-match-id', /MATCH-/);
  await expect(firstCard).toHaveAttribute('data-property-id', /PROP-/);
  await expect(firstCard).toHaveAttribute('data-level', /Excellent|Strong|Possible|Weak|Poor/);
  await expect(firstCard).toContainText('Matched Criteria');
  await expect(firstCard).toContainText('Excellent match');

  const apiMatchId = await firstCard.getAttribute('data-match-id');
  const apiLevel = await firstCard.getAttribute('data-level');
  const apiScore = await firstCard.getAttribute('data-score');

  await expect(firstCard.locator('.match-score-badge')).toContainText(apiScore);
  await expect(firstCard.locator('.match-level')).toContainText(apiLevel);
  await expect(page.locator('#matchingCount')).not.toHaveText('0');

  await page.screenshot({ path: 'test/e2e/screenshots/matching-desktop.png', fullPage: true, timeout: 15000 });

  const response = await page.request.get(`${BASE_URL}/api/matches/${apiMatchId}`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.ok).toBeTruthy();
  expect(payload.data.MatchID).toBe(apiMatchId);
  expect(payload.data.MatchLevel).toBe(apiLevel);
  expect(String(payload.data.Score)).toBe(apiScore);
  expect(payload.data.PropertyID).toBe(fixture.propertyId);
});

test('matching screen stays usable at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createMatchingFixture(page, '102');
  await openMatchingScreen(page, fixture.leadId, fixture.requirementCode);

  await page.locator('.match-card').first().waitFor({ state: 'visible', timeout: 15000 });
  await expect(page.locator('.matching-summary-grid')).toBeVisible();
  const actionCount = await page.locator('.matching-actions .btn').count();
  expect(actionCount).toBeGreaterThanOrEqual(3);

  const viewportState = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));

  expect(viewportState.scrollWidth).toBeLessThanOrEqual(viewportState.innerWidth);
  expect(viewportState.bodyScrollWidth).toBeLessThanOrEqual(viewportState.innerWidth);

  await page.screenshot({ path: 'test/e2e/screenshots/matching-mobile.png', fullPage: true, timeout: 15000 });
});
