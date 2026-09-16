const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, managerHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

test('admin API enforces auth and exposes control endpoints', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);

  try {
    const unauthorized = await requestJson(baseUrl, '/api/admin/overview');
    assert.equal(unauthorized.response.status, 401);

    const forbidden = await requestJson(baseUrl, '/api/admin/settings', { headers: managerHeaders() });
    assert.equal(forbidden.response.status, 403);

    const overview = await requestJson(baseUrl, '/api/admin/overview', { headers: adminHeaders() });
    assert.equal(overview.response.status, 200);
    assert.equal(overview.payload.ok, true);
    assert.ok(overview.payload.data.totalUsers >= 1);

    const users = await requestJson(baseUrl, '/api/admin/users', { headers: adminHeaders() });
    assert.equal(users.response.status, 200);
    assert.ok(Array.isArray(users.payload.data));

    const createdUser = await requestJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      headers: adminHeaders(),
      body: {
        Name: 'API Admin User',
        Email: 'api.admin.user@example.com',
        Mobile: '+91 9000000111',
        Role: 'AGENT',
        Status: 'Active',
        Permissions: ['REPORTS_VIEW']
      }
    });
    assert.equal(createdUser.response.status, 200);
    assert.equal(createdUser.payload.ok, true);

    const statusUpdate = await requestJson(baseUrl, `/api/admin/users/${createdUser.payload.data.UserID}/status`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: { status: 'Inactive' }
    });
    assert.equal(statusUpdate.response.status, 200);
    assert.equal(statusUpdate.payload.data.Status, 'Inactive');

    const settings = await requestJson(baseUrl, '/api/admin/settings', { headers: adminHeaders() });
    assert.equal(settings.response.status, 200);
    assert.equal(settings.payload.data.CompanyName, 'Signature Realty');

    const backupsBefore = await requestJson(baseUrl, '/api/admin/backups', { headers: adminHeaders() });
    const backupCountBefore = backupsBefore.payload.data.length;
    const backup = await requestJson(baseUrl, '/api/admin/backups', {
      method: 'POST',
      headers: adminHeaders(),
      body: { Label: 'api-backup' }
    });
    assert.equal(backup.response.status, 200);
    assert.equal(backup.payload.ok, true);

    const backupsAfter = await requestJson(baseUrl, '/api/admin/backups', { headers: adminHeaders() });
    assert.equal(backupsAfter.payload.data.length, backupCountBefore + 1);

    const restore = await requestJson(baseUrl, '/api/admin/restore', {
      method: 'POST',
      headers: adminHeaders(),
      body: { backupId: backup.payload.data.BackupID, confirm: 'RESTORE' }
    });
    assert.equal(restore.response.status, 200);
    assert.equal(restore.payload.data.Status, 'RESTORED');

    const health = await requestJson(baseUrl, '/api/admin/health', { headers: adminHeaders() });
    assert.equal(health.response.status, 200);
    assert.ok(['PASS', 'WARNING', 'ERROR'].includes(health.payload.data.status));

    const maintenance = await requestJson(baseUrl, '/api/admin/maintenance', { headers: adminHeaders() });
    assert.equal(maintenance.response.status, 200);
    assert.ok(typeof maintenance.payload.data.totalIssues === 'number');
  } finally {
    await stopServer(child);
  }
});
