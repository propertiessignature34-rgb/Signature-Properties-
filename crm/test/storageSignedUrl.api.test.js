'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

const adminHeaders = {
  'x-user-id': 'USR-SYSTEM-ADMIN',
  'x-user-role': 'ADMIN',
  'x-test-session-auth': '1'
};

test('storage signed URLs are permission-issued, bearer-valid, and fail closed when altered', async () => {
  const server = await startServer(makeDbFile(), {
    env: { STORAGE_SIGNING_SECRET: 'storage-route-test-secret' }
  });

  try {
    const unauthenticated = await requestJson(server.baseUrl, '/api/v2/storage/signed-url', {
      method: 'POST',
      body: { key: 'builder-projects/BLD-1/brochures/a.pdf' }
    });
    assert.equal(unauthenticated.response.status, 401);

    const issued = await requestJson(server.baseUrl, '/api/v2/storage/signed-url', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        key: 'builder-projects/BLD-1/brochures/a.pdf',
        expiresInSeconds: 60
      }
    });
    assert.equal(issued.response.status, 200);
    assert.equal(issued.payload.ok, true);
    assert.ok(issued.payload.url);
    assert.ok(issued.payload.expiresAt);

    const signedUrl = new URL(issued.payload.url, server.baseUrl);
    const bearerRead = await requestJson(server.baseUrl, `${signedUrl.pathname}${signedUrl.search}`);
    // The signature gate is passed; local JSON mode then correctly reports that
    // GridFS is unavailable instead of returning an authentication failure.
    assert.equal(bearerRead.response.status, 500);
    assert.notEqual(bearerRead.payload.error, 'Unauthorized');

    const tampered = await requestJson(
      server.baseUrl,
      `${signedUrl.pathname}?${new URLSearchParams({
        expiresAt: signedUrl.searchParams.get('expiresAt'),
        signature: `${signedUrl.searchParams.get('signature').slice(0, -1)}x`
      })}`
    );
    assert.equal(tampered.response.status, 401);
    assert.equal(tampered.payload.code, 'INVALID_SIGNATURE');

    const expired = await requestJson(
      server.baseUrl,
      `${signedUrl.pathname}?${new URLSearchParams({
        expiresAt: '1',
        signature: signedUrl.searchParams.get('signature')
      })}`
    );
    assert.equal(expired.response.status, 401);
    assert.equal(expired.payload.code, 'EXPIRED');
  } finally {
    await stopServer(server.child);
  }
});