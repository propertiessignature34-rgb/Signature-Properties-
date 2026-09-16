'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

test('legacy transaction listing requires authentication', async () => {
  const server = await startServer(makeDbFile());

  try {
    const response = await requestJson(server.baseUrl, '/api/transactions');
    assert.equal(response.response.status, 401);
  } finally {
    await stopServer(server.child);
  }
});

test('administrator can read the transaction list', async () => {
  const server = await startServer(makeDbFile());

  try {
    const response = await requestJson(server.baseUrl, '/api/transactions', {
      headers: adminHeaders()
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.ok(Array.isArray(response.payload.data));
  } finally {
    await stopServer(server.child);
  }
});