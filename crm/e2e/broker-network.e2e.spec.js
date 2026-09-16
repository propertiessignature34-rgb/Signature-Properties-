const { test, expect } = require('@playwright/test');

let sessionHeaders = {};

test.beforeAll(async ({ request }) => {
  const secret = process.env.SIG_REALTY_TEST_SESSION_TOKEN || 'pw-e2e-secret';
  const resp = await request.post('/api/auth/test-session', {
    data: { secret, userId: 'USR-0001' }
  });
  const body = await resp.json();
  if (!resp.ok() || !body.data?.token) throw new Error(`test-session failed: ${JSON.stringify(body)}`);
  sessionHeaders = { 'x-session-token': body.data.token };
});

test('broker network share page is private, responsive, and accepts property submissions', async ({ page, request }) => {
  const broker = await request.post('/api/v2/broker-network', {
    headers: sessionHeaders,
    data: {
      Name: 'E2E Network Broker',
      Phone: '+919900001111',
      TrustLevel: 'High'
    }
  });
  expect(broker.status()).toBe(201);
  const brokerPayload = await broker.json();

  const created = await request.post('/api/v2/requirements/REQ-0001/network-share', {
    headers: sessionHeaders,
    data: {
      brokerIds: [brokerPayload.data.NetworkBrokerID],
      expiresInDays: 7
    }
  });
  expect(created.status()).toBe(201);
  const payload = await created.json();
  const token = payload.data.shares[0].Token;
  expect(token).toBeTruthy();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setExtraHTTPHeaders(sessionHeaders);

  for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`/share/req/${token}`);
    await expect(page.getByText('Requirement Details')).toBeVisible();
    await expect(page.getByText('Client ki personal details')).toBeVisible();
    await expect(page.getByText('Rohan Verma')).toHaveCount(0);
    await expect(page.getByText('rohan.v@example.com')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBeFalsy();
  }

  await page.fill('#f-title', 'E2E Network Project');
  await page.fill('#f-price', '18000000');
  await page.click('#submit-btn');
  await expect(page.locator('[data-testid="submit-success"]')).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
