'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

test('sensitive inventory, duplicate review, and sheet routes reject unauthenticated callers', async () => {
  const server = await startServer(makeDbFile(), {
    env: { SHEET_SYNC_TOKEN: 'route-security-test-token' }
  });

  try {
    const inventory = await requestJson(server.baseUrl, '/api/v2/inventory', {
      method: 'POST',
      body: { Title: 'Unauthorized inventory write' }
    });
    assert.equal(inventory.response.status, 401);

    const duplicateMerge = await requestJson(server.baseUrl, '/api/v2/duplicates/merge', {
      method: 'POST',
      body: { sourceLeadId: 'LEAD-1', targetLeadId: 'LEAD-2' }
    });
    assert.equal(duplicateMerge.response.status, 401);

    const setup = await requestJson(server.baseUrl, '/api/sync/google-sheet/setup');
    assert.equal(setup.response.status, 401);

    const exportResponse = await requestJson(server.baseUrl, '/api/sync/google-sheet/export');
    assert.equal(exportResponse.response.status, 401);
  } finally {
    await stopServer(server.child);
  }
});

test('administrator can create V2 inventory and sheet setup never returns the sync token', async () => {
  const server = await startServer(makeDbFile(), {
    env: { SHEET_SYNC_TOKEN: 'route-security-test-token' }
  });

  try {
    const inventory = await requestJson(server.baseUrl, '/api/v2/inventory', {
      method: 'POST',
      headers: adminHeaders(),
      body: {
        Title: 'Authorized inventory property',
        Category: 'Residential',
        ListingFor: 'Sale'
      }
    });
    assert.equal(inventory.response.status, 201);
    assert.equal(inventory.payload.ok, true);
    assert.equal(inventory.payload.data.CreatedBy, 'USR-SYSTEM-ADMIN');

    const setup = await requestJson(server.baseUrl, '/api/sync/google-sheet/setup', {
      headers: adminHeaders()
    });
    assert.equal(setup.response.status, 200);
    assert.equal(setup.payload.ok, true);
    assert.equal(setup.payload.data.syncTokenConfigured, true);
    assert.equal(Object.prototype.hasOwnProperty.call(setup.payload.data, 'syncToken'), false);
    assert.equal(JSON.stringify(setup.payload).includes('route-security-test-token'), false);
  } finally {
    await stopServer(server.child);
  }
});