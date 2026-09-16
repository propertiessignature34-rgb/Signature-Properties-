'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

test('legacy inventory routes require authentication', async () => {
  const server = await startServer(makeDbFile());

  try {
    const list = await requestJson(server.baseUrl, '/api/inventory');
    assert.equal(list.response.status, 401);

    const create = await requestJson(server.baseUrl, '/api/inventory', {
      method: 'POST',
      body: { PropertyID: 'UNAUTHORIZED-PROPERTY' }
    });
    assert.equal(create.response.status, 401);
  } finally {
    await stopServer(server.child);
  }
});

test('administrator inventory creation ignores client-supplied tenant metadata', async () => {
  const server = await startServer(makeDbFile());

  try {
    const create = await requestJson(server.baseUrl, '/api/inventory', {
      method: 'POST',
      headers: adminHeaders(),
      body: {
        PropertyID: 'PROP-SECURITY-001',
        Project: 'Authorized Inventory',
        CompanyID: 'ATTACKER-COMPANY',
        BrokerageID: 'ATTACKER-BROKERAGE'
      }
    });
    assert.equal(create.response.status, 200);
    assert.equal(create.payload.ok, true);
    assert.equal(create.payload.data.CompanyID, 'COMP-DEFAULT');
    assert.equal(create.payload.data.BrokerageID, 'BRK-DEFAULT');

    const list = await requestJson(server.baseUrl, '/api/inventory', {
      headers: adminHeaders()
    });
    assert.equal(list.response.status, 200);
    assert.ok(list.payload.data.some((property) => property.PropertyID === 'PROP-SECURITY-001'));
  } finally {
    await stopServer(server.child);
  }
});