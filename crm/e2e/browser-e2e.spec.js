const { test, expect } = require('@playwright/test');

async function openClients(page) {
  await page.goto('/', { waitUntil: 'load', timeout: 10000 });
  await page.getByRole('link', { name: 'Clients', exact: true }).click();
  await expect(page).toHaveTitle('Signature Properties — Clients');
  await page.locator('#clients-tbody').waitFor({ state: 'visible', timeout: 5000 });
}

async function openFirstClientWorkspace(page) {
  await openClients(page);
  const firstClient = page.locator('#clients-tbody .client-link').first();
  await expect(firstClient).toBeVisible({ timeout: 5000 });
  await firstClient.click();
  await expect(page).toHaveURL(/\/client-workspace\?id=/);
  await page.locator('#workspace').waitFor({ state: 'visible', timeout: 5000 });
}

test('dashboard navigation opens the current requirements view', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load', timeout: 10000 });
  await expect(page).toHaveTitle('Signature Properties — Dashboard');
  await page.screenshot({ path: 'test/e2e/screenshots/home.png', fullPage: true });

  await page.getByRole('link', { name: 'Requirements', exact: true }).click();
  await expect(page).toHaveTitle('All Requirements — Signature Properties');
  await page.locator('#req-tbody').waitFor({ state: 'visible', timeout: 5000 });
  await expect(page.locator('#f-status')).toBeVisible();
  await expect(page.locator('#f-urgency')).toBeVisible();
});

test('client list opens a workspace and returns to clients', async ({ page }) => {
  await openFirstClientWorkspace(page);
  await expect(page.getByRole('link', { name: /All Clients/ })).toBeVisible();
  await page.getByRole('link', { name: /All Clients/ }).click();
  await expect(page).toHaveTitle('Signature Properties — Clients');
  await expect(page.locator('#clients-tbody')).toBeVisible();
});

test('client workspace opens the new requirement flow', async ({ page }) => {
  await openFirstClientWorkspace(page);
  await page.getByRole('button', { name: '＋ New Requirement' }).first().click();
  await expect(page.locator('#add-need-modal')).toBeVisible();
  await expect(page.getByTestId('need-txn-type')).toHaveValue('Purchase');
  await page.getByTestId('need-category').selectOption({ label: 'Residential' });
  await expect(page.getByTestId('save-need-btn')).toBeVisible();
  await page.getByTestId('close-need-modal').click();
  await expect(page.locator('#add-need-modal')).toBeHidden();
});

test('requirements view exposes search and status filters', async ({ page }) => {
  await page.goto('/requirements-view', { waitUntil: 'load', timeout: 10000 });
  await expect(page).toHaveTitle('All Requirements — Signature Properties');
  await expect(page.locator('#search-input')).toBeVisible();
  await expect(page.locator('#f-status')).toBeVisible();
  await expect(page.locator('#f-stage')).toBeVisible();
  await expect(page.locator('#req-tbody')).toBeVisible();
});

test('protected client route redirects an unauthenticated browser to login', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/clients', { waitUntil: 'load', timeout: 10000 });
  await expect(page).toHaveURL(/\/login\.html\?next=/);
});