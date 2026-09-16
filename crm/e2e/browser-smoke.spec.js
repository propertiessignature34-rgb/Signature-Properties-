const { test, expect } = require('@playwright/test');

test('Signature Properties real browser smoke and current requirements navigation', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load', timeout: 10000 });
  await page.screenshot({ path: 'test/e2e/screenshots/home.png', fullPage: true });

  await expect(page).toHaveTitle('Signature Properties — Dashboard');
  await expect((await page.locator('body').innerText()).length).toBeGreaterThan(1);

  await page.getByRole('link', { name: 'Requirements', exact: true }).click();
  await expect(page).toHaveTitle('All Requirements — Signature Properties');
  await expect(page.locator('#req-tbody')).toBeVisible();
  await expect(page.locator('#f-status')).toBeVisible();
});