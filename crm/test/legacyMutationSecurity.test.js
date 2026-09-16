'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

const protectedRoutes = [
  ['/api/negotiations', 'GET'],
  ['/api/tokens', 'GET'],
  ['/api/deals', 'GET'],
  ['/api/commission', 'GET'],
  ['/api/closing/DEAL-1', 'GET'],
  ['/api/broker/share', 'POST']
];

test('legacy CRM and financial routes reject unauthenticated access', async () => {
  const server = await startServer(makeDbFile());

  try {
    for (const [route, method] of protectedRoutes) {
      const result = await requestJson(server.baseUrl, route, {
        method,
        body: method === 'POST' ? { requirementId: 'REQ-1', brokerId: 'BRK-1' } : undefined
      });
      assert.equal(result.response.status, 401, `${method} ${route} must require authentication`);
    }
  } finally {
    await stopServer(server.child);
  }
});

test('administrator can still read protected legacy route families', async () => {
  const server = await startServer(makeDbFile());

  try {
    for (const route of ['/api/negotiations', '/api/tokens', '/api/deals', '/api/commission']) {
      const result = await requestJson(server.baseUrl, route, { headers: adminHeaders() });
      assert.equal(result.response.status, 200, `GET ${route} should remain available to administrators`);
    }
  } finally {
    await stopServer(server.child);
  }
});