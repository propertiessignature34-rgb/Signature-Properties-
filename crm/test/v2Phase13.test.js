'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { V2Router } = require('../src/api/v2Router');
const { V2QuickCaptureService } = require('../src/services/v2QuickCaptureService');
const { V2LeadService } = require('../src/services/v2LeadService');
const { makeDbFile, startServer, stopServer, requestJson, adminHeaders } = require('./admin-test-utils');

function actor() {
  return {
    userId: 'USR-SYSTEM-ADMIN',
    role: 'ADMIN',
    companyId: 'COMP-DEFAULT',
    brokerageId: 'BRK-DEFAULT',
    permissions: ['*']
  };
}

function payload(mobile = '+91 98765 43210') {
  return {
    client: { name: 'Quick Capture Client', primaryMobile: mobile, city: 'Surat' },
    transaction: { transactionType: 'Purchase' },
    requirement: {
      category: 'Residential',
      subCategory: 'Flat',
      locations: ['Vesu', 'Adajan'],
      budgetMin: 5000000,
      budgetMax: 8000000
    }
  };
}

function buildService(dbFile) {
  const repository = new JsonRepository(dbFile);
  const router = new V2Router(repository);
  return { repository, service: router.quickCaptureSvc };
}

test('Phase 13 quick capture creates Lead, Transaction, and Requirement atomically', () => {
  const { repository, service } = buildService(makeDbFile('sig-phase13-'));
  const result = service.capture(payload(), actor());

  assert.equal(result.ok, true, result.error);
  assert.ok(result.client.leadId);
  assert.ok(result.transaction.transactionId);
  assert.ok(result.requirement.requirementId);
  assert.equal(result.requirement.category, 'Residential');
  assert.deepEqual(result.requirement.locations, ['Vesu', 'Adajan']);
  assert.equal(result.requirement.budgetMin, 5000000);
  assert.equal(result.requirement.budgetMax, 8000000);
  assert.ok(Array.isArray(result.nextQuestions));

  const db = repository.read();
  assert.equal(db.Leads.filter((row) => row.LeadID === result.client.leadId).length, 1);
  assert.equal(db.Transactions.filter((row) => row.TransactionID === result.transaction.transactionId).length, 1);
  assert.equal(db.Requirements.filter((row) => row.RequirementID === result.requirement.requirementId).length, 1);
});

test('Phase 13 exact duplicate reuses the existing Lead and adds a new need', () => {
  const { repository, service } = buildService(makeDbFile('sig-phase13-duplicate-'));
  const first = service.capture(payload(), actor());
  const second = service.capture(payload(), actor());

  assert.equal(first.ok, true);
  assert.equal(second.ok, true, second.error);
  assert.equal(second.client.leadId, first.client.leadId);
  assert.equal(second.client.reused, true);
  assert.equal(repository.read().Leads.filter((row) => row._v2).length, 1);
  assert.equal(repository.read().Transactions.filter((row) => row.LeadID === first.client.leadId).length, 2);
});

test('Phase 13 possible duplicate requires an explicit action', () => {
  const { service } = buildService(makeDbFile('sig-phase13-possible-'));
  const first = service.capture(payload('+91 98765 43210'), actor());
  assert.equal(first.ok, true);

  const possible = service.capture({
    ...payload('+91 98765 43211'),
    client: { ...payload('+91 98765 43211').client, name: 'Quick Capture Client' }
  }, actor());
  assert.equal(possible.ok, false);
  assert.equal(possible.statusCode, 409);
  assert.equal(possible.requiresConfirmation, true);
  assert.equal(possible.duplicateResult, 'POSSIBLE_MATCH');
});

test('Phase 13 transaction failure rolls back the new Lead', () => {
  const dbFile = makeDbFile('sig-phase13-rollback-');
  const repository = new JsonRepository(dbFile);
  const leadService = new V2LeadService(repository);
  const service = new V2QuickCaptureService(
    repository,
    leadService,
    { createTransaction: () => ({ ok: false, error: 'injected failure' }) },
    { createRequirement: () => { throw new Error('must not be called'); } },
    null,
    null
  );
  const before = JSON.stringify(repository.read());
  const result = service.capture(payload(), actor());

  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.equal(JSON.stringify(repository.read()), before);
});

test('Phase 13 API requires auth and returns the atomic response', async () => {
  const dbFile = makeDbFile('sig-phase13-api-');
  const server = await startServer(dbFile);
  try {
    const unauthenticated = await requestJson(server.baseUrl, '/api/v2/quick-capture', {
      method: 'POST',
      body: payload()
    });
    assert.equal(unauthenticated.response.status, 401);

    const created = await requestJson(server.baseUrl, '/api/v2/quick-capture', {
      method: 'POST',
      headers: adminHeaders(),
      body: payload('+91 90000 00001')
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.ok, true);
    assert.ok(created.payload.client.leadId);
    assert.ok(created.payload.transaction.transactionId);
    assert.ok(created.payload.requirement.requirementId);
    assert.ok(created.payload.scores);
  } finally {
    await stopServer(server.child);
  }
});

test('Phase 13 duplicate preflight requires auth and lead-create permission', async () => {
  const dbFile = makeDbFile('sig-phase13-duplicate-auth-');
  const server = await startServer(dbFile);
  try {
    const unauthenticated = await requestJson(server.baseUrl, '/api/v2/clients/check-duplicate', {
      method: 'POST',
      body: { PrimaryMobile: '+91 90000 00002' }
    });
    assert.equal(unauthenticated.response.status, 401);

    const authenticated = await requestJson(server.baseUrl, '/api/v2/clients/check-duplicate', {
      method: 'POST',
      headers: adminHeaders(),
      body: { PrimaryMobile: '+91 90000 00002' }
    });
    assert.equal(authenticated.response.status, 200);
    assert.equal(authenticated.payload.ok, true);
    assert.equal(authenticated.payload.result, 'NO_MATCH');
  } finally {
    await stopServer(server.child);
  }
});

test('Phase 13 existing-client reuse respects agent record access', () => {
  const { service } = buildService(makeDbFile('sig-phase13-agent-access-'));
  const firstActor = {
    userId: 'USR-AGENT-ONE',
    role: 'AGENT',
    companyId: 'COMP-DEFAULT',
    brokerageId: 'BRK-DEFAULT',
    permissions: ['LEADS_CREATE', 'REQUIREMENTS_CREATE']
  };
  const secondActor = {
    ...firstActor,
    userId: 'USR-AGENT-TWO'
  };
  const first = service.capture(payload('+91 90000 00003'), firstActor);
  assert.equal(first.ok, true, first.error);

  const second = service.capture(payload('+91 90000 00003'), secondActor);
  assert.equal(second.ok, false);
  assert.equal(second.statusCode, 404);
  assert.equal(second.error, 'Client not found');
});