'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

test('owner master-data routes require authentication', async () => {
  const server = await startServer(makeDbFile());

  try {
    const list = await requestJson(server.baseUrl, '/api/owners');
    assert.equal(list.response.status, 401);

    const create = await requestJson(server.baseUrl, '/api/owners', {
      method: 'POST',
      body: { Name: 'Unauthenticated Owner', Mobile: '+91 90000 00000' }
    });
    assert.equal(create.response.status, 401);
  } finally {
    await stopServer(server.child);
  }
});

test('administrator can create and list owner master data', async () => {
  const server = await startServer(makeDbFile());

  try {
    const create = await requestJson(server.baseUrl, '/api/owners', {
      method: 'POST',
      headers: adminHeaders(),
      body: { Name: 'Authorized Owner', Mobile: '+91 90000 00001' }
    });
    assert.equal(create.response.status, 201);
    assert.equal(create.payload.ok, true);
    assert.equal(create.payload.data.CreatedBy, 'USR-SYSTEM-ADMIN');

    const list = await requestJson(server.baseUrl, '/api/owners', {
      headers: adminHeaders()
    });
    assert.equal(list.response.status, 200);
    assert.equal(list.payload.ok, true);
    assert.ok(list.payload.data.some((owner) => owner.Name === 'Authorized Owner'));
  } finally {
    await stopServer(server.child);
  }
});