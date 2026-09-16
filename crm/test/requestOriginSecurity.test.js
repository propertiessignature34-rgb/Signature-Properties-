'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

test('cross-site state-changing API requests are rejected before mutation handling', async () => {
  const server = await startServer(makeDbFile(), {
    env: { STORAGE_SIGNING_SECRET: 'origin-test-secret' }
  });

  try {
    const crossSite = await requestJson(server.baseUrl, '/api/v2/storage/signed-url', {
      method: 'POST',
      headers: {
        ...adminHeaders(),
        Origin: 'https://attacker.example'
      },
      body: { key: 'builder-projects/BLD-1/brochures/a.pdf' }
    });

    assert.equal(crossSite.response.status, 403);
    assert.equal(crossSite.payload.error, 'CSRF_ORIGIN_MISMATCH');
  } finally {
    await stopServer(server.child);
  }
});

test('same-origin mutation requests remain supported', async () => {
  const server = await startServer(makeDbFile(), {
    env: { STORAGE_SIGNING_SECRET: 'origin-test-secret' }
  });

  try {
    const sameOrigin = await requestJson(server.baseUrl, '/api/v2/storage/signed-url', {
      method: 'POST',
      headers: {
        ...adminHeaders(),
        Origin: server.baseUrl
      },
      body: { key: 'builder-projects/BLD-1/brochures/a.pdf' }
    });

    assert.equal(sameOrigin.response.status, 200);
    assert.equal(sameOrigin.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});

test('fetch metadata also blocks cross-site mutations when Origin is absent', async () => {
  const server = await startServer(makeDbFile(), {
    env: { STORAGE_SIGNING_SECRET: 'origin-test-secret' }
  });

  try {
    const crossSite = await requestJson(server.baseUrl, '/api/v2/storage/signed-url', {
      method: 'POST',
      headers: {
        ...adminHeaders(),
        'Sec-Fetch-Site': 'cross-site'
      },
      body: { key: 'builder-projects/BLD-1/brochures/a.pdf' }
    });

    assert.equal(crossSite.response.status, 403);
    assert.equal(crossSite.payload.error, 'CSRF_ORIGIN_MISMATCH');
  } finally {
    await stopServer(server.child);
  }
});