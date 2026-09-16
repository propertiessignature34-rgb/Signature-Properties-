'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

test('dashboard and lead routes require explicit permissions', async () => {
  const server = await startServer(makeDbFile());

  try {
    const dashboard = await requestJson(server.baseUrl, '/api/dashboard');
    assert.equal(dashboard.response.status, 401);

    const leads = await requestJson(server.baseUrl, '/api/leads');
    assert.equal(leads.response.status, 401);

    const create = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      body: { ClientName: 'Unauthenticated Lead' }
    });
    assert.equal(create.response.status, 401);
  } finally {
    await stopServer(server.child);
  }
});

test('administrator can read and create leads with trusted actor metadata', async () => {
  const server = await startServer(makeDbFile());

  try {
    const create = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: adminHeaders(),
      body: { ClientName: 'Authorized Lead', Phone: '+91 90000 00002' }
    });
    assert.equal(create.response.status, 200);
    assert.equal(create.payload.ok, true);
    assert.equal(create.payload.data.CreatedBy, 'USR-SYSTEM-ADMIN');
    assert.equal(create.payload.data.CompanyID, 'COMP-DEFAULT');
    assert.equal(create.payload.data.BrokerageID, 'BRK-DEFAULT');

    const list = await requestJson(server.baseUrl, '/api/leads', {
      headers: adminHeaders()
    });
    assert.equal(list.response.status, 200);
    assert.ok(list.payload.data.some((lead) => lead.LeadID === create.payload.data.LeadID));
  } finally {
    await stopServer(server.child);
  }
});