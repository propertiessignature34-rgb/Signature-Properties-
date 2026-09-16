'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

test('legacy builder and project routes require authentication and permissions', async () => {
  const server = await startServer(makeDbFile());

  try {
    const builders = await requestJson(server.baseUrl, '/api/builders');
    assert.equal(builders.response.status, 401);

    const projects = await requestJson(server.baseUrl, '/api/projects', {
      method: 'POST',
      body: { ProjectName: 'Unauthorized Project' }
    });
    assert.equal(projects.response.status, 401);
  } finally {
    await stopServer(server.child);
  }
});

test('administrator can create legacy builder and project records', async () => {
  const server = await startServer(makeDbFile());

  try {
    const builder = await requestJson(server.baseUrl, '/api/builders', {
      method: 'POST',
      headers: adminHeaders(),
      body: { Name: 'Authorized Builder' }
    });
    assert.equal(builder.response.status, 201);
    assert.equal(builder.payload.data.CreatedBy, 'USR-SYSTEM-ADMIN');

    const project = await requestJson(server.baseUrl, '/api/projects', {
      method: 'POST',
      headers: adminHeaders(),
      body: { ProjectName: 'Authorized Project', Visibility: 'PUBLIC' }
    });
    assert.equal(project.response.status, 201);
    assert.equal(project.payload.data.CreatedBy, 'USR-SYSTEM-ADMIN');
  } finally {
    await stopServer(server.child);
  }
});