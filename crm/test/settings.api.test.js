const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

test('settings API persists admin configuration updates across restarts', async () => {
  const dbFile = makeDbFile();
  let server = await startServer(dbFile);

  try {
    const initial = await requestJson(server.baseUrl, '/api/admin/settings', { headers: adminHeaders() });
    assert.equal(initial.response.status, 200);
    assert.equal(initial.payload.data.CompanyName, 'Signature Realty');

    const updated = await requestJson(server.baseUrl, '/api/admin/settings', {
      method: 'PATCH',
      headers: adminHeaders(),
      body: {
        CompanyName: 'Signature Realty Systems',
        ApplicationName: 'Signature Realty Admin Suite',
        Timezone: 'Asia/Kolkata',
        Currency: 'INR',
        DefaultCountry: 'India',
        DefaultState: 'Karnataka',
        DefaultCity: 'Bengaluru',
        DefaultPageSize: 50,
        SessionTimeoutMinutes: 45,
        CacheDurationMinutes: 10,
        Business: {
          DefaultBrokeragePercent: 3,
          DefaultCommissionPercent: 4
        }
      }
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.payload.ok, true);
    assert.equal(updated.payload.data.CompanyName, 'Signature Realty Systems');
    assert.equal(updated.payload.data.Business.DefaultCommissionPercent, 4);
  } finally {
    await stopServer(server.child);
  }

  server = await startServer(dbFile);
  try {
    const persisted = await requestJson(server.baseUrl, '/api/admin/settings', { headers: adminHeaders() });
    assert.equal(persisted.response.status, 200);
    assert.equal(persisted.payload.data.CompanyName, 'Signature Realty Systems');
    assert.equal(persisted.payload.data.DefaultPageSize, 50);
    assert.equal(persisted.payload.data.Business.DefaultBrokeragePercent, 3);
  } finally {
    await stopServer(server.child);
  }
});
