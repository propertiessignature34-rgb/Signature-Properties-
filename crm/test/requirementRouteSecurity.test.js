'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

test('legacy requirement routes require authentication', async () => {
  const server = await startServer(makeDbFile());

  try {
    const list = await requestJson(server.baseUrl, '/api/requirements');
    assert.equal(list.response.status, 401);

    const create = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      body: { LeadID: 'LEAD-0001', Category: 'Residential' }
    });
    assert.equal(create.response.status, 401);
  } finally {
    await stopServer(server.child);
  }
});

test('administrator can create and read requirements with trusted tenant metadata', async () => {
  const server = await startServer(makeDbFile());

  try {
    const lead = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: adminHeaders(),
      body: { ClientName: 'Requirement Owner' }
    });
    assert.equal(lead.response.status, 200);

    const created = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      headers: adminHeaders(),
      body: {
        LeadID: lead.payload.data.LeadID,
        Category: 'Residential',
        TransactionType: 'Purchase'
      }
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.payload.ok, true);
    assert.equal(created.payload.data.CompanyID, 'COMP-DEFAULT');
    assert.equal(created.payload.data.BrokerageID, 'BRK-DEFAULT');
    assert.equal(created.payload.data.CreatedBy, 'USR-SYSTEM-ADMIN');

    const read = await requestJson(server.baseUrl, `/api/requirements/${created.payload.data.RequirementID}`, {
      headers: adminHeaders()
    });
    assert.equal(read.response.status, 200);
    assert.equal(read.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});