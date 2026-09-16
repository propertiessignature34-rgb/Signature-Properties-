'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JsonRepository } = require('../src/data/repository');
const { makeDbFile, requestJson, startServer, stopServer, sessionHeaders, createSession } = require('./admin-test-utils');

test('builder project CRUD, cleanup, and unknown-builder flows work without scraper infrastructure', async () => {
  const dbFile = makeDbFile('sig-builder-projects-crud-');
  new JsonRepository(dbFile);
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const now = new Date().toISOString();
  db.Users = Array.isArray(db.Users) ? db.Users.filter((user) => user.UserID !== 'USR-BUILD-ADMIN') : [];
  db.Users.push({
    UserID: 'USR-BUILD-ADMIN',
    Name: 'Builder Admin',
    Mobile: '+910000000012',
    Role: 'ADMIN',
    Email: 'builder-admin@example.com',
    Status: 'Active',
    Permissions: ['*'],
    CompanyID: 'COMP-BUILD',
    BrokerageID: 'BRK-BUILD',
    CreatedAt: now,
    UpdatedAt: now
  });
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
  const { child, baseUrl } = await startServer(dbFile);

  try {
    const authHeaders = await sessionHeaders(baseUrl, { userId: 'USR-BUILD-ADMIN' });
    const authed = (route, options = {}) => requestJson(baseUrl, route, {
      ...options,
      headers: { ...(options.headers || {}), ...authHeaders }
    });

    const created = await authed('/api/v2/builder-projects', {
      method: 'POST',
      body: {
        ProjectName: 'Audit Heights',
        BuilderName: 'Acme Group',
        Location1: 'Vesu',
        Category: 'Residential',
        ProjectStatus: 'Under Construction'
      }
    });
    assert.equal(created.response.status, 201);
    const projectId = created.payload.data.ProjectID;

    const fetched = await authed(`/api/v2/builder-projects/${projectId}`);
    assert.equal(fetched.response.status, 200);
    assert.equal(fetched.payload.data.ProjectName, 'Audit Heights');

    const updated = await authed(`/api/v2/builder-projects/${projectId}`, {
      method: 'PATCH',
      body: {
        ProjectName: 'Audit Heights Phase 2',
        BuilderName: 'Acme Group',
        Location1: 'Adajan'
      }
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.payload.data.ProjectName, 'Audit Heights Phase 2');
    assert.equal(updated.payload.data.Location1, 'Adajan');

    await authed('/api/v2/builder-projects', {
      method: 'POST',
      body: { ProjectName: 'Acme One', BuilderName: 'Acme Group', Location1: 'Vesu' }
    });
    await authed('/api/v2/builder-projects', {
      method: 'POST',
      body: { ProjectName: 'Acme Two', BuilderName: 'Acme Builders', Location1: 'Vesu' }
    });

    const duplicates = await authed('/api/v2/builder-projects/duplicate-builders');
    assert.equal(duplicates.response.status, 200);
    assert.ok((duplicates.payload.data || []).some((group) =>
      group.variants.some((variant) => variant.name === 'Acme Group') &&
      group.variants.some((variant) => variant.name === 'Acme Builders')
    ));

    const merged = await authed('/api/v2/builder-projects/merge-builders', {
      method: 'POST',
      body: { canonicalName: 'Acme Group', variants: ['Acme Group', 'Acme Builders'] }
    });
    assert.equal(merged.response.status, 200);
    assert.ok(merged.payload.data.updated >= 1);

    const unknownCreated = await authed('/api/v2/builder-projects', {
      method: 'POST',
      body: { ProjectName: 'Mystery Plaza', BuilderName: 'Unknown Builder', Location1: 'Surat' }
    });
    assert.equal(unknownCreated.response.status, 201);
    const unknownId = unknownCreated.payload.data.ProjectID;

    const unknownList = await authed('/api/v2/builder-projects/unknown-builders');
    assert.equal(unknownList.response.status, 200);
    assert.ok((unknownList.payload.data || []).some((project) => project.ProjectID === unknownId));

    const assigned = await authed('/api/v2/builder-projects/bulk-assign-builder', {
      method: 'POST',
      body: { projectIds: [unknownId], builderName: 'Resolved Builders' }
    });
    assert.equal(assigned.response.status, 200);
    assert.equal(assigned.payload.data.updated, 1);

    const unknownListAfter = await authed('/api/v2/builder-projects/unknown-builders');
    assert.equal(unknownListAfter.response.status, 200);
    assert.equal((unknownListAfter.payload.data || []).some((project) => project.ProjectID === unknownId), false);

    const deleted = await authed(`/api/v2/builder-projects/${projectId}`, { method: 'DELETE' });
    assert.equal(deleted.response.status, 200);

    const listed = await authed('/api/v2/builder-projects');
    assert.equal(listed.response.status, 200);
    assert.equal((listed.payload.data || []).some((project) => project.ProjectID === projectId), false);
  } finally {
    await stopServer(child);
  }
});

test('builder project session access returns existing records without mutating stored ProjectID values', async () => {
  const dbFile = makeDbFile('sig-builder-projects-existing-');
  new JsonRepository(dbFile);
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const now = new Date().toISOString();
  db.Users.push({
    UserID: 'USR-BUILD-ADMIN-2',
    Name: 'Builder Admin 2',
    Mobile: '+910000000013',
    Role: 'ADMIN',
    Email: 'builder-admin-2@example.com',
    Status: 'Active',
    Permissions: ['*'],
    CompanyID: 'COMP-BUILD',
    BrokerageID: 'BRK-BUILD',
    CreatedAt: now,
    UpdatedAt: now
  });
  db.BuilderProjects = [{
    ProjectID: 'BLDP-EXISTING-001',
    ProjectName: 'Existing Tower',
    BuilderName: 'Existing Builders',
    Location1: 'Vesu',
    Category: 'Residential',
    ProjectStatus: 'Under Construction',
    Active: true,
    CreatedAt: now,
    UpdatedAt: now
  }];
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

  const before = JSON.parse(fs.readFileSync(dbFile, 'utf8')).BuilderProjects.map((row) => row.ProjectID);
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const session = await createSession(baseUrl, { userId: 'USR-BUILD-ADMIN-2' });
    const listed = await requestJson(baseUrl, '/api/v2/builder-projects', {
      headers: { cookie: session.cookie }
    });
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.count, 1);
    assert.equal(listed.payload.data[0].ProjectID, 'BLDP-EXISTING-001');

    const status = await requestJson(baseUrl, '/api/v2/builder-projects/scrape/status', {
      headers: { cookie: session.cookie }
    });
    assert.equal(status.response.status, 410);

    const after = JSON.parse(fs.readFileSync(dbFile, 'utf8')).BuilderProjects.map((row) => row.ProjectID);
    assert.deepEqual(after, before);
  } finally {
    await stopServer(child);
  }
});
