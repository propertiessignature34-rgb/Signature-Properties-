const { test, expect } = require('@playwright/test');

test('inventory page loads and shows real inventory data in the browser', async ({ page }) => {
  await page.goto('http://localhost:4173', { waitUntil: 'load', timeout: 10000 });

  await page.locator('#app-navigation .nav-link').nth(4).click();
  await page.locator('#app-content').waitFor({ state: 'attached', timeout: 3000 });

  await expect(page.locator('#app-content')).toContainText('Inventory');
  await expect(page.locator('#app-content')).toContainText('Property ID');
  await expect(page.locator('#app-content')).toContainText('Azure Crest');
});
