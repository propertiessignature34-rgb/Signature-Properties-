'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JsonRepository } = require('../src/data/repository');
const { makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

function makeDbWithUsers() {
  const dbFile = makeDbFile('sig-karma-scrape-api-');
  new JsonRepository(dbFile);
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const now = new Date().toISOString();
  db.Users.push(
    {
      UserID: 'USR-KARMA-ADMIN', Name: 'Karma Admin', Mobile: '+910000000013', Role: 'ADMIN',
      Email: 'karma-admin@example.com', Status: 'Active', Permissions: ['*'], CompanyID: 'COMP', BrokerageID: 'BRK', CreatedAt: now, UpdatedAt: now
    },
    {
      UserID: 'USR-KARMA-AGENT', Name: 'Karma Agent', Mobile: '+910000000014', Role: 'AGENT',
      Email: 'karma-agent@example.com', Status: 'Active', Permissions: ['LEADS_READ', 'BUILDER_PROJECTS_READ'], CompanyID: 'COMP', BrokerageID: 'BRK', CreatedAt: now, UpdatedAt: now
    }
  );
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
  return dbFile;
}

test('Karma scrape APIs are permanently disabled without attempting a job', async () => {
  const dbFile = makeDbWithUsers();
  const server = await startServer(dbFile, { env: { KARMA_GROUP_LISTING_URL: 'https://karmagroup.co.in/projects' } });
  try {
    const noAuth = await requestJson(server.baseUrl, '/api/v2/builder-projects/scrape/status');
    assert.equal(noAuth.response.status, 401);

    const agentOnly = await requestJson(server.baseUrl, '/api/v2/builder-projects/scrape/status', {
      headers: { 'x-user-id': 'USR-KARMA-AGENT', 'x-user-role': 'AGENT' }
    });
    assert.equal(agentOnly.response.status, 410);
    assert.equal(agentOnly.payload.error, 'KARMA_SCRAPING_DISABLED');

    const scrapeStartAgent = await requestJson(server.baseUrl, '/api/v2/builder-projects/scrape', {
      method: 'POST',
      headers: { 'x-user-id': 'USR-KARMA-AGENT', 'x-user-role': 'AGENT' },
      body: { limit: 1 }
    });
    assert.equal(scrapeStartAgent.response.status, 410);
    assert.equal(scrapeStartAgent.payload.error, 'KARMA_SCRAPING_DISABLED');

    const migrationStatsAgent = await requestJson(server.baseUrl, '/api/v2/admin/brochure-migration/stats', {
      headers: { 'x-user-id': 'USR-KARMA-AGENT', 'x-user-role': 'AGENT' }
    });
    assert.equal(migrationStatsAgent.response.status, 403);
    assert.equal(migrationStatsAgent.payload.error, 'PERMISSION_MISSING');
    assert.equal(migrationStatsAgent.payload.permission, 'BROCHURE_MIGRATION_MANAGE');
    assert.equal(migrationStatsAgent.payload.message, 'Permission missing: BROCHURE_MIGRATION_MANAGE');

    const adminStart = await requestJson(server.baseUrl, '/api/v2/builder-projects/scrape', {
      method: 'POST',
      headers: { 'x-user-id': 'USR-KARMA-ADMIN', 'x-user-role': 'ADMIN' },
      body: { limit: 1 }
    });
    assert.equal(adminStart.response.status, 410);
    assert.equal(adminStart.payload.error, 'KARMA_SCRAPING_DISABLED');
  } finally {
    await stopServer(server.child);
  }
});
