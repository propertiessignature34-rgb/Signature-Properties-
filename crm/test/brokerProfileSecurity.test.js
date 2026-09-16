'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

test('broker profile mutations require administrator permission', async () => {
  const server = await startServer(makeDbFile());

  try {
    const unauthenticated = await requestJson(server.baseUrl, '/api/v2/broker-profile', {
      method: 'PATCH',
      body: { Name: 'Unauthorized Update' }
    });
    assert.equal(unauthenticated.response.status, 401);

    const unauthorizedPhoto = await requestJson(server.baseUrl, '/api/v2/broker-profile/photo', {
      method: 'POST',
      body: { fileBase64: 'data:image/jpeg;base64,AA==' }
    });
    assert.equal(unauthorizedPhoto.response.status, 401);
  } finally {
    await stopServer(server.child);
  }
});

test('administrator can update broker profile details', async () => {
  const server = await startServer(makeDbFile());

  try {
    const response = await requestJson(server.baseUrl, '/api/v2/broker-profile', {
      method: 'PATCH',
      headers: adminHeaders(),
      body: { Name: 'Authorized Administrator' }
    });

    assert.equal(response.response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.Name, 'Authorized Administrator');
  } finally {
    await stopServer(server.child);
  }
});