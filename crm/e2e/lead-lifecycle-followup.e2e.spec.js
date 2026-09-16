const { test, expect } = require('@playwright/test');

async function seedLeadWorkspace(request) {
  const createClient = await request.post('/api/v2/clients', {
    data: {
      ClientName: 'E2E Lead',
      PrimaryMobile: `9${Date.now().toString().slice(-9)}`
    }
  });
  expect(createClient.ok()).toBeTruthy();
  const client = await createClient.json();
  const leadId = client?.data?.LeadID;
  expect(leadId).toBeTruthy();

  const createTxn = await request.post(`/api/v2/clients/${leadId}/transactions`, {
    data: { TransactionType: 'Purchase' }
  });
  expect(createTxn.ok()).toBeTruthy();
  const txn = await createTxn.json();
  const txnId = txn?.data?.TransactionID;
  expect(txnId).toBeTruthy();

  const createReq = await request.post(`/api/v2/transactions/${txnId}/requirements`, {
    data: {
      LeadID: leadId,
      Category: 'Residential',
      SubCategory: 'Flat',
      TransactionType: 'Purchase',
      Fields: {
        BudgetMax: { state: 'KNOWN', value: 10000000 },
        Location1: { state: 'KNOWN', value: 'Vesu' }
      }
    }
  });
  expect(createReq.ok()).toBeTruthy();

  return leadId;
}

test('lead lifecycle + follow-up + lost flow persists in workspace', async ({ page, request }) => {
  test.setTimeout(60000);
  const leadId = await seedLeadWorkspace(request);
  await page.goto(`/client-workspace.html?id=${encodeURIComponent(leadId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#workspace')).toBeVisible({ timeout: 20000 });

  async function setLeadStatus(status) {
    await page.locator('button[onclick="openEditModal()"]').click();
    await page.locator('#edit-status').selectOption(status);
    if (status === 'Lost') {
      await page.locator('#edit-lost-reason').fill('Budget mismatch');
      await page.locator('#edit-lost-note').fill('Price too high');
    }
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.locator('#edit-modal')).toHaveClass(/hidden/);
  }

  await setLeadStatus('Contacted');
  await setLeadStatus('Follow-up');
  await setLeadStatus('Qualified');
  await page.reload();
  await expect(page.locator('#client-status-badge')).toContainText('Qualified');

  await page.locator('#sidebar-followups-card button').click();
  await page.locator('#fu-type').selectOption('Email');
  await page.locator('#fu-priority').selectOption('High');
  await page.locator('#fu-date').fill('2026-12-31');
  await page.locator('#fu-time').fill('17:30');
  await page.locator('#fu-notes').fill('test follow-up');
  await page.locator('#followup-modal button.btn-primary').click();
  await expect(page.locator('#followup-modal')).toHaveClass(/hidden/);

  await page.locator('#sidebar-followups-card button').click();
  await page.locator('#fu-type').selectOption('Call');
  await page.locator('#fu-priority').selectOption('Low');
  await page.locator('#fu-date').fill('2025-01-01');
  await page.locator('#fu-time').fill('09:00');
  await page.locator('#fu-notes').fill('past due check');
  await page.locator('#followup-modal button.btn-primary').click();
  await page.reload();

  await page.locator('#details-toggle').click();
  await page.locator('.tab[data-tab="followups"]').click();
  await expect(page.locator('#followups-list')).toContainText('Email');
  await expect(page.locator('#followups-list')).toContainText('test follow-up');
  await expect(page.locator('#followups-list')).toContainText('Overdue');

  await page.locator('.tab[data-tab="timeline"]').click();
  await expect(page.locator('#timeline-list')).toContainText('Follow-up scheduled');
  await expect(page.locator('#timeline-list')).toContainText('Lead status changed');

  await expect(page.locator('#btn-mark-lost')).toBeVisible();
  await page.locator('#btn-mark-lost').click();
  await expect(page.locator('#lead-lost-modal')).not.toHaveClass(/hidden/);
  await page.locator('#lead-lost-reason').fill('No response');
  await page.locator('#lead-lost-note').fill('Stopped answering calls');
  await page.locator('#lead-lost-modal button.btn-primary').click();
  await expect(page.locator('#lead-lost-modal')).toHaveClass(/hidden/);
  await page.reload();
  await expect(page.locator('#client-status-badge')).toContainText('Lost');

  await page.locator('#details-toggle').click();
  await page.locator('.tab[data-tab="transactions"]').click();
  await expect(page.locator('#transactions-list .txn-card').first()).toBeVisible();
  await expect(page.locator('#needs-list')).toContainText(/R\d{6}/);
});
