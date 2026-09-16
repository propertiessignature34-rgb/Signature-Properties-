const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:4173';

test.setTimeout(60000);

async function createFixture(page, suffix = 'SV') {
  const city = `Site Visit Browser City ${suffix}`;
  const location = `Site Visit Browser Location ${suffix}`;

  const leadResponse = await page.request.post(`${BASE_URL}/api/leads`, {
    data: {
      clientName: `Site Visit Browser Lead ${suffix}`,
      city,
      phone: `+91 9333300${suffix}`,
      email: `sitevisit.browser.${suffix}@example.com`,
      leadStatus: 'New',
      assignedAgentId: 'USR-0001'
    }
  });
  const leadPayload = await leadResponse.json();

  const requirementResponse = await page.request.post(`${BASE_URL}/api/requirements`, {
    data: {
      leadId: leadPayload.data.LeadID,
      transactionId: `TXN-SV-BROWSER-${suffix}`,
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
      specialNotes: 'site visit browser fixture',
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
      project: `Site Visit Browser Crest ${suffix}`,
      location,
      city,
      bhk: 3,
      area: 1450,
      price: 15000000,
      possession: 'Ready',
      status: 'Available',
      ownerId: `OWN-SV-BROWSER-${suffix}`,
      brokerId: `BRO-SV-BROWSER-${suffix}`,
      builderId: `BUIL-SV-BROWSER-${suffix}`
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

async function openShortlistForFixture(page, fixture) {
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
  await page.locator('#runMatchingBtn').click();
  const card = page.locator(`.match-card[data-property-id="${fixture.propertyId}"]`).first();
  await expect(card).toBeVisible();
  const addShortlistButton = card.locator('.add-shortlist-btn');
  if (await addShortlistButton.isEnabled()) {
    await addShortlistButton.click();
  }
  await expect(addShortlistButton).toHaveText('✓ Shortlisted');

  await page.locator('#openShortlist').click();
  await page.locator('h2', { hasText: 'Shortlist' }).waitFor({ state: 'visible', timeout: 5000 });
  const desktopRow = page.locator(`#app-content tr[data-property-id="${fixture.propertyId}"]`).first();
  const mobileCard = page.locator(`#app-content .shortlist-mobile-card[data-property-id="${fixture.propertyId}"]`).first();

  if (await mobileCard.isVisible()) {
    return mobileCard;
  }

  await expect(desktopRow).toBeVisible();
  return desktopRow;
}

async function createVisitFromComposer(page) {
  const createVisitRequestPromise = page.waitForRequest((request) => request.url().includes('/api/site-visits') && request.method() === 'POST', { timeout: 10000 });
  const composerError = page.locator('#visitComposer .empty-state').first();

  await expect(page.locator('#site-visit-form input[name="visitDate"]')).not.toHaveValue('');
  await expect(page.locator('#site-visit-form input[name="visitTime"]')).not.toHaveValue('');
  await page.locator('#site-visit-form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  const requestOrError = await Promise.race([
    createVisitRequestPromise.then((request) => ({ kind: 'request', request })),
    composerError.waitFor({ state: 'visible', timeout: 10000 }).then(async () => ({ kind: 'error', message: await composerError.innerText() }))
  ]).catch(() => null);

  if (!requestOrError || requestOrError.kind !== 'request') {
    if (requestOrError && requestOrError.kind === 'error') {
      throw new Error(`Site visit create failed in UI: ${requestOrError.message}`);
    }
    throw new Error('No POST /api/site-visits request was sent from the composer');
  }

  const createVisitResponse = await requestOrError.request.response();
  expect(createVisitResponse).not.toBeNull();

  expect(createVisitResponse.ok()).toBeTruthy();
  const createVisitPayload = await createVisitResponse.json();
  expect(createVisitPayload.ok).toBeTruthy();
  return createVisitPayload;
}

async function getVisibleVisitScope(page, visitId) {
  const visibleScope = page.locator(`#app-content [data-visit-id="${visitId}"]:visible`).first();
  await expect(visibleScope).toBeVisible();
  return visibleScope;
}

test('site visit browser flow with API/DOM consistency and lifecycle transitions', async ({ page }) => {
  const fixture = await createFixture(page, '301');
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

  const shortlistRow = await openShortlistForFixture(page, fixture);
  const shortlistLeadId = await shortlistRow.getAttribute('data-lead-id');
  const shortlistMatchId = await shortlistRow.getAttribute('data-match-id');
  expect(Boolean(shortlistLeadId)).toBeTruthy();
  expect(Boolean(shortlistMatchId)).toBeTruthy();
  await shortlistRow.locator('.schedule-site-visit-btn').first().click();

  await page.locator('#site-visit-form').waitFor({ state: 'visible', timeout: 5000 });
  await page.fill('#site-visit-form input[name="visitDate"]', '2026-11-18');
  await page.fill('#site-visit-form input[name="visitTime"]', '10:30');
  await page.fill('#site-visit-form input[name="assignedAgentId"]', 'USR-0001');
  await page.fill('#site-visit-form textarea[name="notes"]', 'E2E walkthrough');
  const createVisitPayload = await createVisitFromComposer(page);

  const createError = page.locator('#visitComposer .empty-state').first();
  if (await createError.isVisible()) {
    throw new Error(`Site visit create failed in UI: ${await createError.innerText()}`);
  }

  const domVisitId = createVisitPayload.data.VisitID;
  const visitRow = await getVisibleVisitScope(page, domVisitId);
  await expect(visitRow).toBeVisible();

  const domPropertyId = await visitRow.getAttribute('data-property-id');
  const domStatusScheduled = await visitRow.getAttribute('data-status');
  const domVisitDate = await visitRow.getAttribute('data-visit-date');
  const domVisitTime = await visitRow.getAttribute('data-visit-time');

  const getScheduled = await page.request.get(`${BASE_URL}/api/site-visits/${domVisitId}`);
  const getScheduledPayload = await getScheduled.json();
  expect(getScheduledPayload.ok).toBeTruthy();
  expect(getScheduledPayload.data.VisitID).toBe(domVisitId);
  expect(getScheduledPayload.data.PropertyID).toBe(domPropertyId);
  expect(getScheduledPayload.data.Status).toBe(domStatusScheduled);
  expect(getScheduledPayload.data.VisitDate).toBe(domVisitDate);
  expect(getScheduledPayload.data.VisitTime).toBe(domVisitTime);

  await visitRow.locator('.visit-action[data-action="confirm"]').click();
  const confirmedRow = await getVisibleVisitScope(page, domVisitId);
  await expect(confirmedRow).toBeVisible();
  await expect(confirmedRow).toContainText('Confirmed');

  await confirmedRow.locator('.visit-action[data-action="complete"]').click();
  const completedRow = await getVisibleVisitScope(page, domVisitId);
  await expect(completedRow).toContainText('Completed');

  const getCompleted = await page.request.get(`${BASE_URL}/api/site-visits/${domVisitId}`);
  const getCompletedPayload = await getCompleted.json();
  expect(getCompletedPayload.ok).toBeTruthy();
  expect(getCompletedPayload.data.Status).toBe('Completed');

  expect(consoleErrors.length).toBe(0);
  expect(pageErrors.length).toBe(0);
});

test('site visit responsive proof for 360/390/768/1024', async ({ browser }) => {
  const viewports = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 }
  ];

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const fixture = await createFixture(page, `302-${viewport.width}`);
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

    const shortlistRow = await openShortlistForFixture(page, fixture);
    await shortlistRow.locator('.schedule-site-visit-btn').first().click();
    await page.locator('#site-visit-form').waitFor({ state: 'visible', timeout: 5000 });

    await page.fill('#site-visit-form input[name="visitDate"]', '2026-11-19');
    await page.fill('#site-visit-form input[name="visitTime"]', '09:45');
    await page.fill('#site-visit-form input[name="assignedAgentId"]', 'USR-0001');
      await expect(page.locator('#site-visit-form input[name="visitDate"]')).toBeVisible();
      await expect(page.locator('#site-visit-form input[name="visitTime"]')).toBeVisible();
      await expect(page.locator('#site-visit-form input[name="assignedAgentId"]')).toBeVisible();
      const createVisitPayload = await createVisitFromComposer(page);

    const createError = page.locator('#visitComposer .empty-state').first();
    if (await createError.isVisible()) {
      throw new Error(`Responsive create failed in UI: ${await createError.innerText()}`);
    }

      const visitLocator = await getVisibleVisitScope(page, createVisitPayload.data.VisitID);

    await expect(visitLocator).toBeVisible();

    const state = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      text: document.querySelector('#app-content')?.innerText || ''
    }));

    const normalizedText = state.text.toLowerCase();
    expect(state.scrollWidth - state.clientWidth).toBe(0);
    expect(normalizedText.includes('site visits')).toBeTruthy();
    expect(normalizedText.includes('date')).toBeTruthy();
    expect(normalizedText.includes('time')).toBeTruthy();
    expect(['scheduled', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'noshow'].some((value) => normalizedText.includes(value))).toBeTruthy();
    expect(normalizedText.includes('confirm')).toBeTruthy();

    const actionScope = visitLocator;
    await expect(actionScope.locator('.visit-action[data-action="confirm"]')).toBeVisible();
    await expect(actionScope.locator('.visit-action[data-action="complete"]')).toBeVisible();
    await expect(actionScope.locator('.visit-action[data-action="cancel"]')).toBeVisible();
    await expect(actionScope.locator('.visit-action[data-action="no-show"]')).toBeVisible();

    expect(consoleErrors.length).toBe(0);
    expect(pageErrors.length).toBe(0);

    await page.screenshot({ path: `test/e2e/screenshots/sitevisit-${viewport.width}x${viewport.height}.png`, fullPage: true });
    await page.close();
  }
});
