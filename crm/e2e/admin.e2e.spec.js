const { test, expect } = require('@playwright/test');

async function requestJson(request, method, route, data, headers = {}) {
  const response = await request.fetch(route, {
    method,
    data,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
  const payload = await response.json();
  return { response, payload };
}

async function openAdminPanel(page) {
  await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll('#app-navigation .nav-link'))
      .find((element) => String(element.textContent || '').includes('Admin Panel'));
    if (!link) {
      throw new Error('Admin Panel link not found');
    }
    link.click();
  });

  await expect(page.getByRole('heading', { name: 'Admin / Settings / System Control', exact: true })).toBeVisible({ timeout: 15000 });
}

test('admin control center renders real data and supports persisted mutations', async ({ page }) => {
  const headers = {
    'x-user-id': 'USR-0001',
    'x-user-role': 'ADMIN'
  };

  await requestJson(page.request, 'POST', '/api/admin/users', {
    Name: 'E2E Admin User',
    Email: 'e2e.admin.user@example.com',
    Mobile: '+91 9000000333',
    Role: 'AGENT',
    Status: 'Active',
    Permissions: ['REPORTS_VIEW']
  }, headers);

  await page.goto('/', { waitUntil: 'load', timeout: 12000 });
  await openAdminPanel(page);
  await expect(page.locator('.admin-hero')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#app-content')).toContainText('System Control Center');
  await expect(page.locator('#app-content')).toContainText('Admin / Settings / System Control', { timeout: 10000 });
  await expect(page.locator('#adminUserForm')).toBeVisible();
  await expect(page.locator('#adminBackupForm')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'System Health', exact: true })).toBeVisible();

  const newName = 'Browser Admin Explorer';
  const newEmail = 'browser.admin.explorer@example.com';
  await page.locator('#adminUserForm input[name="Name"]').fill(newName);
  await page.locator('#adminUserForm input[name="Email"]').fill(newEmail);
  await page.locator('#adminUserForm input[name="Mobile"]').fill('+91 9000000444');
  await page.locator('#adminUserForm select[name="Role"]').selectOption('MANAGER');
  await page.locator('#adminUserForm select[name="Status"]').selectOption('Active');
  await page.locator('#adminUserForm input[name="Permissions"]').fill('ADMIN_VIEW, AUDIT_VIEW');
  await page.locator('#adminUserForm button[type="submit"]').click();
  await expect(page.locator('#app-content')).toContainText(newName);
  await expect(page.locator('#app-content')).toContainText(newEmail);

  await page.locator('#adminSettingsForm input[name="CompanyName"]').fill('Browser Control Co');
  await page.locator('#adminSettingsForm button[type="submit"]').click();
  await expect(page.locator('#adminSettingsForm input[name="CompanyName"]')).toHaveValue('Browser Control Co');

  await page.locator('#adminBackupForm input[name="Label"]').fill('browser-backup');
  await page.locator('#adminBackupForm button[type="submit"]').click();
  await expect(page.locator('.admin-restore-btn')).toHaveCount(1);

  const state = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(state.scrollWidth - state.clientWidth).toBe(0);
});

test('admin control center stays usable across mobile and tablet viewports', async ({ browser }) => {
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
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await page.goto('/', { waitUntil: 'load', timeout: 12000 });
    await openAdminPanel(page);

    await expect(page.locator('#app-content')).toContainText('System Control Center');
    await expect(page.locator('.admin-shell')).toBeVisible();

    const state = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyText: document.body.innerText
    }));

    expect(state.scrollWidth - state.clientWidth).toBe(0);
    expect(state.bodyText.toLowerCase()).toContain('system control center');
    expect(state.bodyText).toContain('Audit Logs');

    expect(consoleErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
    await page.close();
  }
});
