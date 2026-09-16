const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

test('admin integration flow survives a server restart with persisted data', async () => {
  const dbFile = makeDbFile();
  let server = await startServer(dbFile);

  try {
    const user = await requestJson(server.baseUrl, '/api/admin/users', {
      method: 'POST',
      headers: adminHeaders(),
      body: {
        Name: 'Integration Admin User',
        Email: 'integration.admin.user@example.com',
        Mobile: '+91 9000000222',
        Role: 'MANAGER',
        Status: 'Active',
        Permissions: ['ADMIN_VIEW', 'AUDIT_VIEW']
      }
    });
    assert.equal(user.response.status, 200);

    const role = await requestJson(server.baseUrl, '/api/admin/roles', {
      method: 'POST',
      headers: adminHeaders(),
      body: {
        Name: 'COMPLIANCE',
        Description: 'Compliance and audit control',
        Permissions: ['AUDIT_VIEW', 'HEALTH_VIEW']
      }
    });
    assert.equal(role.response.status, 200);

    const master = await requestJson(server.baseUrl, '/api/admin/masters', {
      method: 'POST',
      headers: adminHeaders(),
      body: {
        MasterType: 'LeadSources',
        Value: 'Integration Referral',
        Label: 'Integration Referral'
      }
    });
    assert.equal(master.response.status, 200);

    const pipeline = await requestJson(server.baseUrl, '/api/admin/pipeline', {
      method: 'PATCH',
      headers: adminHeaders(),
      body: {
        modules: [
          { Module: 'Lead', Stages: ['New', 'Verified', 'Active'] },
          { Module: 'Deal', Stages: ['Open', 'Closed'] }
        ]
      }
    });
    assert.equal(pipeline.response.status, 200);

    const forms = await requestJson(server.baseUrl, '/api/admin/forms/residential', {
      method: 'PATCH',
      headers: adminHeaders(),
      body: {
        FormName: 'Residential Requirement',
        Fields: {
          title: { FieldLabel: 'Title', FieldType: 'text', Section: 'basic', Required: true, Active: true },
          notes: { FieldLabel: 'Notes', FieldType: 'textarea', Section: 'basic', Required: false, Active: true }
        }
      }
    });
    assert.equal(forms.response.status, 200);

    const backups = await requestJson(server.baseUrl, '/api/admin/backups', {
      method: 'POST',
      headers: adminHeaders(),
      body: { Label: 'integration snapshot' }
    });
    assert.equal(backups.response.status, 200);
    assert.equal(backups.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }

  server = await startServer(dbFile);
  try {
    const users = await requestJson(server.baseUrl, '/api/admin/users', { headers: adminHeaders() });
    assert.ok(users.payload.data.some((entry) => entry.Email === 'integration.admin.user@example.com'));

    const roles = await requestJson(server.baseUrl, '/api/admin/roles', { headers: adminHeaders() });
    assert.ok(roles.payload.data.some((entry) => entry.Name === 'COMPLIANCE'));

    const settings = await requestJson(server.baseUrl, '/api/admin/settings', { headers: adminHeaders() });
    assert.equal(settings.payload.data.CompanyName, 'Signature Realty');

    const masters = await requestJson(server.baseUrl, '/api/admin/masters?masterType=LeadSources', { headers: adminHeaders() });
    assert.ok(masters.payload.data.some((entry) => entry.Value === 'Integration Referral'));

    const forms = await requestJson(server.baseUrl, '/api/admin/forms', { headers: adminHeaders() });
    assert.ok(forms.payload.data.residential);

    const audit = await requestJson(server.baseUrl, '/api/admin/audit?module=Forms', { headers: adminHeaders() });
    assert.ok(audit.payload.data.some((entry) => entry.Action === 'FORM_UPDATED'));
  } finally {
    await stopServer(server.child);
  }
});
