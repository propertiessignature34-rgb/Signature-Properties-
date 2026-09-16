'use strict';

/**
 * Security regression tests for P0/P1 authentication and tenant-isolation fixes.
 *
 * Confirmed P0 — previously unauthenticated endpoints:
 *   P0-1  GET  /api/followups
 *   P0-2  POST /api/followups
 *   P0-3  GET  /api/calendar
 *
 * Confirmed P1 — previously unauthenticated endpoints:
 *   P1-1  GET  /api/transactions
 *   P1-2  GET  /api/search
 *   P1-3  GET  /api/brokers
 *
 * Confirmed P1 — missing tenant isolation on write endpoints:
 *   P1-4  PATCH  /api/leads/:id
 *   P1-5  PATCH  /api/requirements/:id
 *   P1-6  DELETE /api/requirements/:id
 *
 * Additional coverage:
 *   - Authenticated requests succeed after the fixes
 *   - Broker-network public share routes remain accessible without auth
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JsonRepository } = require('../src/data/repository');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

// ─────────────────────────────────────────────────────────────────────────────
// Test database helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a database with two users from different tenants.
 *
 * USR-TENANT-A  →  COMP-AAA / BRK-AAA  (email: tenant.a@example.com)
 * USR-TENANT-B  →  COMP-BBB / BRK-BBB  (email: tenant.b@example.com)
 *
 * Both users have full LEADS/REQUIREMENTS permissions so tests can focus on
 * the tenant-isolation check rather than on permission failures.
 *
 * Note: repository.createUser() does not persist CompanyID/BrokerageID, so we
 * write the user records directly into the database JSON file.  The repository
 * is only used to trigger ensureDatabase() so the file and schema exist first.
 */
function makeTenantDb() {
  const dbFile = makeDbFile();
  // Touch the db so ensureDatabase() runs and creates the initial schema
  new JsonRepository(dbFile);

  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const now = new Date().toISOString();
  raw.Users.push(
    {
      UserID: 'USR-TENANT-A',
      Name: 'Tenant A User',
      Mobile: '+910000000010',
      Role: 'AGENT',
      Email: 'tenant.a@example.com',
      Status: 'Active',
      Permissions: [
        'LEADS_READ', 'LEADS_CREATE', 'LEADS_UPDATE',
        'REQUIREMENTS_READ', 'REQUIREMENTS_CREATE', 'REQUIREMENTS_UPDATE', 'REQUIREMENTS_DELETE',
        'INVENTORY_READ',
        'TRANSACTIONS_READ',
        'SEARCH_READ',
        'BUILDER_PROJECTS_READ', 'BUILDER_PROJECTS_CREATE', 'BROKER_NETWORK_READ', 'BROKER_NETWORK_CREATE'
      ],
      CompanyID: 'COMP-AAA',
      BrokerageID: 'BRK-AAA',
      CreatedAt: now,
      UpdatedAt: now
    },
    {
      UserID: 'USR-TENANT-B',
      Name: 'Tenant B User',
      Mobile: '+910000000011',
      Role: 'AGENT',
      Email: 'tenant.b@example.com',
      Status: 'Active',
      Permissions: [
        'LEADS_READ', 'LEADS_UPDATE',
        'REQUIREMENTS_READ', 'REQUIREMENTS_UPDATE', 'REQUIREMENTS_DELETE',
        'BUILDER_PROJECTS_READ', 'BROKER_NETWORK_READ'
      ],
      CompanyID: 'COMP-BBB',
      BrokerageID: 'BRK-BBB',
      CreatedAt: now,
      UpdatedAt: now
    }
  );
  fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2));

  return dbFile;
}

// Identity headers for admin-test-utils → resolves to a real Google session.
// These users MUST have CompanyID/BrokerageID so resolveRequestContext passes.
const tenantAHeaders = { 'x-user-id': 'USR-TENANT-A', 'x-user-role': 'AGENT' };
const tenantBHeaders = { 'x-user-id': 'USR-TENANT-B', 'x-user-role': 'AGENT' };

/**
 * Stamp a CompanyID/BrokerageID directly onto an existing lead record.
 * createLead() does not store tenant fields, so we patch the file directly.
 */
function stampLeadTenant(dbFile, leadId, companyId, brokerageId) {
  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const idx = raw.Leads.findIndex((l) => l.LeadID === leadId);
  assert.notEqual(idx, -1, `Lead ${leadId} not found in db`);
  raw.Leads[idx].CompanyID = companyId;
  raw.Leads[idx].BrokerageID = brokerageId;
  fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2));
}

/**
 * Stamp a CompanyID/BrokerageID onto an existing requirement record.
 */
function stampRequirementTenant(dbFile, requirementId, companyId, brokerageId) {
  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const idx = raw.Requirements.findIndex((r) => r.RequirementID === requirementId);
  assert.notEqual(idx, -1, `Requirement ${requirementId} not found in db`);
  raw.Requirements[idx].CompanyID = companyId;
  raw.Requirements[idx].BrokerageID = brokerageId;
  fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// P0/P1 — Unauthenticated 401 gate tests
// ─────────────────────────────────────────────────────────────────────────────

test('P0-1: GET /api/followups returns 401 for unauthenticated request', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/followups');
    assert.equal(res.response.status, 401, 'Unauthenticated GET /api/followups must return 401');
    assert.equal(res.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P0-2: POST /api/followups returns 401 for unauthenticated request', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/followups', {
      method: 'POST',
      body: { Notes: 'test' }
    });
    assert.equal(res.response.status, 401, 'Unauthenticated POST /api/followups must return 401');
    assert.equal(res.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P0-3: GET /api/calendar returns 401 for unauthenticated request', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/calendar');
    assert.equal(res.response.status, 401, 'Unauthenticated GET /api/calendar must return 401');
    assert.equal(res.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P1-1: GET /api/transactions returns 401 for unauthenticated request', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/transactions');
    assert.equal(res.response.status, 401, 'Unauthenticated GET /api/transactions must return 401');
    assert.equal(res.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P1-2: GET /api/search returns 401 for unauthenticated request', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/search?q=test');
    assert.equal(res.response.status, 401, 'Unauthenticated GET /api/search must return 401');
    assert.equal(res.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P1-3: GET /api/brokers returns 401 for unauthenticated request', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/brokers');
    assert.equal(res.response.status, 401, 'Unauthenticated GET /api/brokers must return 401');
    assert.equal(res.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P0: sensitive CRM endpoint families return 401 without credentials', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const sensitiveRoutes = [
      '/api/v2/clients',
      '/api/leads',
      '/api/v2/followups',
      '/api/inventory',
      '/api/v2/requirements',
      '/api/v2/activities',
      '/api/v2/site-visits',
      '/api/v2/shortlists',
      '/api/v2/matches',
      '/api/v2/transactions',
      '/api/v2/documents',
      '/api/v2/builder-projects',
      '/api/v2/broker-network'
    ];
    for (const route of sensitiveRoutes) {
      const res = await requestJson(server.baseUrl, route);
      assert.equal(res.response.status, 401, `Unauthenticated ${route} must return 401`);
      assert.equal(res.payload?.ok, false, route);
    }
  } finally {
    await stopServer(server.child);
  }
});

test('P0: no-credential request cannot silently become ADMIN actor', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/v2/clients');
    assert.equal(res.response.status, 401);
    assert.equal(res.payload?.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Positive access tests — authenticated tenant-scoped user succeeds
// ─────────────────────────────────────────────────────────────────────────────

test('authenticated user can GET /api/followups after P0-1 fix', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/followups', { headers: tenantAHeaders });
    assert.equal(res.response.status, 200);
    assert.equal(res.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});

test('authenticated user can GET /api/calendar after P0-3 fix', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/calendar', { headers: tenantAHeaders });
    assert.equal(res.response.status, 200);
    assert.equal(res.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});

test('authenticated user can GET /api/transactions after P1-1 fix', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/transactions', { headers: tenantAHeaders });
    assert.equal(res.response.status, 200);
  } finally {
    await stopServer(server.child);
  }
});

test('authenticated user can GET /api/search after P1-2 fix', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/search?q=test', { headers: tenantAHeaders });
    assert.equal(res.response.status, 200);
  } finally {
    await stopServer(server.child);
  }
});

test('global search filters records from another tenant', async () => {
  const dbFile = makeTenantDb();
  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  raw.Leads.push(
    {
      LeadID: 'LEAD-SEARCH-A',
      ClientName: 'Tenant A Search Record',
      CompanyID: 'COMP-AAA',
      BrokerageID: 'BRK-AAA',
      CreatedBy: 'USR-TENANT-A'
    },
    {
      LeadID: 'LEAD-SEARCH-B',
      ClientName: 'Tenant B Search Secret',
      CompanyID: 'COMP-BBB',
      BrokerageID: 'BRK-BBB',
      CreatedBy: 'USR-TENANT-B'
    }
  );
  fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2));
  const server = await startServer(dbFile);

  try {
    const response = await requestJson(server.baseUrl, '/api/search?q=Tenant%20B%20Search%20Secret', {
      headers: tenantAHeaders
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.some((record) => record.LeadID === 'LEAD-SEARCH-B'), false);
  } finally {
    await stopServer(server.child);
  }
});

test('authenticated user can GET /api/brokers after P1-3 fix', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const res = await requestJson(server.baseUrl, '/api/brokers', { headers: tenantAHeaders });
    assert.equal(res.response.status, 200);
  } finally {
    await stopServer(server.child);
  }
});

test('legacy broker directory requires its read capability and returns only directory fields', async () => {
  const dbFile = makeTenantDb();
  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const tenantB = raw.Users.find((user) => user.UserID === 'USR-TENANT-B');
  tenantB.Permissions = tenantB.Permissions.filter((permission) => permission !== 'BROKER_NETWORK_READ');
  fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2));
  const server = await startServer(dbFile);
  try {
    const authorized = await requestJson(server.baseUrl, '/api/brokers', { headers: tenantAHeaders });
    assert.equal(authorized.response.status, 200);
    assert.equal(authorized.payload.ok, true);
    assert.ok(authorized.payload.data.length > 0);
    assert.deepEqual(Object.keys(authorized.payload.data[0]).sort(), [
      'BrokerID', 'BrokerName', 'BrokerType', 'Company', 'Status'
    ].sort());

    const unauthorized = await requestJson(server.baseUrl, '/api/brokers', { headers: tenantBHeaders });
    assert.equal(unauthorized.response.status, 403);
  } finally {
    await stopServer(server.child);
  }
});

test('internal owner, builder, and project lists stay within the caller tenant', async () => {
  const dbFile = makeTenantDb();
  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  raw.Owners.push(
    { OwnerID: 'OWN-TENANT-A', Name: 'Tenant A Owner', CompanyID: 'COMP-AAA', BrokerageID: 'BRK-AAA' },
    { OwnerID: 'OWN-TENANT-B', Name: 'Tenant B Owner', CompanyID: 'COMP-BBB', BrokerageID: 'BRK-BBB' }
  );
  raw.Builders.push(
    { BuilderID: 'BLD-TENANT-A', Name: 'Tenant A Builder', CompanyID: 'COMP-AAA', BrokerageID: 'BRK-AAA' },
    { BuilderID: 'BLD-TENANT-B', Name: 'Tenant B Builder', CompanyID: 'COMP-BBB', BrokerageID: 'BRK-BBB' }
  );
  raw.Projects.push(
    { ProjectID: 'PRJ-TENANT-A', ProjectName: 'Tenant A Project', CompanyID: 'COMP-AAA', BrokerageID: 'BRK-AAA' },
    { ProjectID: 'PRJ-TENANT-B', ProjectName: 'Tenant B Project', CompanyID: 'COMP-BBB', BrokerageID: 'BRK-BBB' }
  );
  fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2));
  const server = await startServer(dbFile);

  try {
    for (const [path, idField, foreignId] of [
      ['/api/owners', 'OwnerID', 'OWN-TENANT-B'],
      ['/api/builders', 'BuilderID', 'BLD-TENANT-B'],
      ['/api/projects', 'ProjectID', 'PRJ-TENANT-B']
    ]) {
      const response = await requestJson(server.baseUrl, path, { headers: tenantAHeaders });
      assert.equal(response.response.status, 200, path);
      assert.equal(response.payload.data.some((row) => row[idField] === foreignId), false, path);
    }
  } finally {
    await stopServer(server.child);
  }
});

test('project creation rejects a builder from another tenant', async () => {
  const dbFile = makeTenantDb();
  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  raw.Builders.push(
    { BuilderID: 'BLD-TENANT-A', Name: 'Tenant A Builder', CompanyID: 'COMP-AAA', BrokerageID: 'BRK-AAA' },
    { BuilderID: 'BLD-TENANT-B', Name: 'Tenant B Builder', CompanyID: 'COMP-BBB', BrokerageID: 'BRK-BBB' }
  );
  fs.writeFileSync(dbFile, JSON.stringify(raw, null, 2));
  const server = await startServer(dbFile);

  try {
    const sameTenant = await requestJson(server.baseUrl, '/api/projects', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ProjectName: 'Tenant A Project', BuilderID: 'BLD-TENANT-A' }
    });
    assert.equal(sameTenant.response.status, 201);

    const crossTenant = await requestJson(server.baseUrl, '/api/projects', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ProjectName: 'Cross Tenant Project', BuilderID: 'BLD-TENANT-B' }
    });
    assert.equal(crossTenant.response.status, 404);
  } finally {
    await stopServer(server.child);
  }
});

test('notification settings require administrator authorization', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const unauthenticated = await requestJson(server.baseUrl, '/api/notifications');
    assert.equal(unauthenticated.response.status, 401);

    const tenant = await requestJson(server.baseUrl, '/api/notifications', {
      headers: tenantAHeaders
    });
    assert.equal(tenant.response.status, 403);

    const admin = await requestJson(server.baseUrl, '/api/notifications', {
      headers: adminHeaders()
    });
    assert.equal(admin.response.status, 200);
    assert.equal(admin.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});

test('legacy users endpoint requires administrator authorization', async () => {
  const server = await startServer(makeTenantDb());
  try {
    const unauthenticated = await requestJson(server.baseUrl, '/api/users');
    assert.equal(unauthenticated.response.status, 401);

    const tenant = await requestJson(server.baseUrl, '/api/users', {
      headers: tenantAHeaders
    });
    assert.equal(tenant.response.status, 403);

    const admin = await requestJson(server.baseUrl, '/api/users', {
      headers: adminHeaders()
    });
    assert.equal(admin.response.status, 200);
    assert.equal(admin.payload.ok, true);
    assert.ok(Array.isArray(admin.payload.data));
  } finally {
    await stopServer(server.child);
  }
});

test('valid authenticated actor headers still work for sensitive CRM endpoints', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const routes = [
      '/api/v2/clients',
      '/api/leads',
      '/api/v2/followups',
      '/api/inventory',
      '/api/v2/builder-projects',
      '/api/v2/broker-network'
    ];
    for (const route of routes) {
      const res = await requestJson(server.baseUrl, route, { headers: tenantAHeaders });
      assert.equal(res.response.status, 200, route);
    }
  } finally {
    await stopServer(server.child);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-4 — Lead PATCH tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

test('P1-4: cross-tenant PATCH /api/leads/:id is rejected with 403', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    // Tenant A creates a lead
    const created = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'A Client', City: 'Mumbai', Phone: '9000000001', Email: 'aclient@example.com', assignedAgentId: 'USR-TENANT-A' }
    });
    assert.equal(created.response.status, 200, `Lead creation failed: ${JSON.stringify(created.payload)}`);
    const leadId = created.payload.data?.LeadID || created.payload.LeadID;
    assert.ok(leadId, 'Lead ID must be returned');

    // Stamp COMP-AAA ownership on the lead record
    stampLeadTenant(dbFile, leadId, 'COMP-AAA', 'BRK-AAA');

    // Tenant B (COMP-BBB) attempts PATCH — must be rejected
    const patch = await requestJson(server.baseUrl, `/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: tenantBHeaders,
      body: { ClientName: 'Hacked' }
    });
    assert.equal(patch.response.status, 403, 'Cross-tenant PATCH /api/leads/:id must return 403');
    assert.equal(patch.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P1-4: same-tenant PATCH /api/leads/:id succeeds with 200', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const created = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'A Client 2', City: 'Mumbai', Phone: '9000000002', Email: 'aclient2@example.com', assignedAgentId: 'USR-TENANT-A' }
    });
    assert.equal(created.response.status, 200, `Lead creation failed: ${JSON.stringify(created.payload)}`);
    const leadId = created.payload.data?.LeadID || created.payload.LeadID;
    assert.ok(leadId);

    stampLeadTenant(dbFile, leadId, 'COMP-AAA', 'BRK-AAA');

    // Same tenant A updates their own lead — must succeed
    const patch = await requestJson(server.baseUrl, `/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: tenantAHeaders,
      body: { City: 'Delhi' }
    });
    assert.equal(patch.response.status, 200, 'Same-tenant PATCH /api/leads/:id must return 200');
    assert.equal(patch.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-5 — Requirement PATCH tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

test('P1-5: cross-tenant PATCH /api/requirements/:id is rejected with 403', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    // Tenant A creates a lead and requirement
    const leadRes = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'Req Client', City: 'Pune', Phone: '9000000003', Email: 'rc@example.com', assignedAgentId: 'USR-TENANT-A' }
    });
    assert.equal(leadRes.response.status, 200);
    const leadId = leadRes.payload.data?.LeadID || leadRes.payload.LeadID;
    assert.ok(leadId);

    const reqRes = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { LeadID: leadId, TransactionType: 'Purchase', Category: 'Residential', BudgetMin: 5000000, BudgetMax: 10000000 }
    });
    assert.equal(reqRes.response.status, 200, `Requirement creation failed: ${JSON.stringify(reqRes.payload)}`);
    const requirementId = reqRes.payload.data?.RequirementID || reqRes.payload.RequirementID;
    assert.ok(requirementId, 'Requirement ID must be returned');

    // Stamp COMP-AAA ownership
    stampRequirementTenant(dbFile, requirementId, 'COMP-AAA', 'BRK-AAA');

    // Tenant B attempts PATCH — must be rejected
    const patch = await requestJson(server.baseUrl, `/api/requirements/${requirementId}`, {
      method: 'PATCH',
      headers: tenantBHeaders,
      body: { BudgetMax: 99999999 }
    });
    assert.equal(patch.response.status, 403, 'Cross-tenant PATCH /api/requirements/:id must return 403');
    assert.equal(patch.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('P1-5: same-tenant PATCH /api/requirements/:id succeeds with 200', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const leadRes = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'Req Client 2', City: 'Pune', Phone: '9000000004', Email: 'rc2@example.com', assignedAgentId: 'USR-TENANT-A' }
    });
    assert.equal(leadRes.response.status, 200);
    const leadId = leadRes.payload.data?.LeadID || leadRes.payload.LeadID;

    const reqRes = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { LeadID: leadId, TransactionType: 'Purchase', Category: 'Residential', BudgetMin: 5000000, BudgetMax: 10000000 }
    });
    assert.equal(reqRes.response.status, 200, `Requirement creation failed: ${JSON.stringify(reqRes.payload)}`);
    const requirementId = reqRes.payload.data?.RequirementID || reqRes.payload.RequirementID;
    assert.ok(requirementId);

    stampRequirementTenant(dbFile, requirementId, 'COMP-AAA', 'BRK-AAA');

    // Same tenant A updates their own requirement — must succeed
    const patch = await requestJson(server.baseUrl, `/api/requirements/${requirementId}`, {
      method: 'PATCH',
      headers: tenantAHeaders,
      body: { BudgetMax: 12000000 }
    });
    assert.equal(patch.response.status, 200, 'Same-tenant PATCH /api/requirements/:id must return 200');
    assert.equal(patch.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-6 — Requirement DELETE tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

test('P1-6: cross-tenant DELETE /api/requirements/:id is rejected with 403', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const leadRes = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'Del Client', City: 'Chennai', Phone: '9000000005', Email: 'del@example.com', assignedAgentId: 'USR-TENANT-A' }
    });
    assert.equal(leadRes.response.status, 200);
    const leadId = leadRes.payload.data?.LeadID || leadRes.payload.LeadID;

    const reqRes = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { LeadID: leadId, TransactionType: 'Purchase', Category: 'Residential', BudgetMin: 3000000, BudgetMax: 6000000 }
    });
    assert.equal(reqRes.response.status, 200, `Requirement creation failed: ${JSON.stringify(reqRes.payload)}`);
    const requirementId = reqRes.payload.data?.RequirementID || reqRes.payload.RequirementID;
    assert.ok(requirementId);

    stampRequirementTenant(dbFile, requirementId, 'COMP-AAA', 'BRK-AAA');

    // Tenant B attempts DELETE — must be rejected
    const del = await requestJson(server.baseUrl, `/api/requirements/${requirementId}`, {
      method: 'DELETE',
      headers: tenantBHeaders
    });
    assert.equal(del.response.status, 403, 'Cross-tenant DELETE /api/requirements/:id must return 403');
    assert.equal(del.payload.ok, false);

    // Requirement must still exist after the rejected delete
    const get = await requestJson(server.baseUrl, `/api/requirements/${requirementId}`, {
      headers: tenantAHeaders
    });
    assert.equal(get.response.status, 200, 'Requirement must still exist after a rejected cross-tenant delete');
  } finally {
    await stopServer(server.child);
  }
});

test('P1-6: same-tenant DELETE /api/requirements/:id succeeds', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const leadRes = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'Del Client 2', City: 'Chennai', Phone: '9000000006', Email: 'del2@example.com', assignedAgentId: 'USR-TENANT-A' }
    });
    assert.equal(leadRes.response.status, 200);
    const leadId = leadRes.payload.data?.LeadID || leadRes.payload.LeadID;

    const reqRes = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { LeadID: leadId, TransactionType: 'Purchase', Category: 'Residential', BudgetMin: 3000000, BudgetMax: 6000000 }
    });
    assert.equal(reqRes.response.status, 200, `Requirement creation failed: ${JSON.stringify(reqRes.payload)}`);
    const requirementId = reqRes.payload.data?.RequirementID || reqRes.payload.RequirementID;
    assert.ok(requirementId);

    stampRequirementTenant(dbFile, requirementId, 'COMP-AAA', 'BRK-AAA');

    // Same tenant A deletes their own requirement — must succeed
    const del = await requestJson(server.baseUrl, `/api/requirements/${requirementId}`, {
      method: 'DELETE',
      headers: tenantAHeaders
    });
    assert.equal(del.response.status, 200, 'Same-tenant DELETE /api/requirements/:id must return 200');
    assert.equal(del.payload.ok, true);
  } finally {
    await stopServer(server.child);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Broker-network public share routes must remain publicly accessible
// ─────────────────────────────────────────────────────────────────────────────

test('broker-network public share routes remain accessible without auth after security fixes', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    // Tenant A creates a lead and requirement that they own
    const leadRes = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ClientName: 'Share Test Client', City: 'Hyderabad', Phone: '9000000099', Email: 'sharetest@example.com', assignedAgentId: 'USR-TENANT-A' }
    });
    assert.equal(leadRes.response.status, 200);
    const leadId = leadRes.payload.data?.LeadID || leadRes.payload.LeadID;
    assert.ok(leadId);

    const reqRes = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { LeadID: leadId, TransactionType: 'Purchase', Category: 'Residential', BudgetMin: 5000000, BudgetMax: 10000000 }
    });
    assert.equal(reqRes.response.status, 200);
    const requirementId = reqRes.payload.data?.RequirementID || reqRes.payload.RequirementID;
    assert.ok(requirementId);

    // Tenant A creates a broker-network share for their own requirement
    const brokerRes = await requestJson(server.baseUrl, '/api/v2/broker-network', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { Name: 'Network Broker', Phone: '+919999999999', Agency: 'Network Realty' }
    });
    assert.equal(brokerRes.response.status, 201, `Broker creation failed: ${JSON.stringify(brokerRes.payload)}`);
    const brokerId = brokerRes.payload.data?.NetworkBrokerID;
    assert.ok(brokerId, 'Broker ID must be present');

    const shareRes = await requestJson(server.baseUrl, `/api/v2/requirements/${requirementId}/network-share`, {
      method: 'POST',
      headers: tenantAHeaders,
      body: { brokerIds: [brokerId], expiresInDays: 7 }
    });
    assert.equal(shareRes.response.status, 201, `Share creation failed: ${JSON.stringify(shareRes.payload)}`);
    const token = shareRes.payload.data?.shares?.[0]?.Token;
    assert.ok(token, 'Share token must be present');

    // Unauthenticated GET of the public share endpoint must return 200
    const publicRes = await requestJson(server.baseUrl, `/api/v2/public/req/${token}`);
    assert.equal(publicRes.response.status, 200, 'Public share route must be accessible without auth');
    assert.ok(publicRes.payload.ok !== false, 'Public share route must return a valid response');
  } finally {
    await stopServer(server.child);
  }
});

test('public property/project endpoints remain public while dashboard API stays protected', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const publicProperties = await requestJson(server.baseUrl, '/api/public/properties');
    assert.equal(publicProperties.response.status, 200);
    assert.equal(publicProperties.payload.ok, true);

    const publicProjects = await requestJson(server.baseUrl, '/api/public/projects');
    assert.equal(publicProjects.response.status, 200);
    assert.equal(publicProjects.payload.ok, true);

    const dashboard = await requestJson(server.baseUrl, '/api/dashboard');
    assert.equal(dashboard.response.status, 401);
    assert.equal(dashboard.payload.ok, false);
  } finally {
    await stopServer(server.child);
  }
});

test('Phase 1: storage health and raw object access require explicit permissions', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const unauthenticated = await requestJson(server.baseUrl, '/api/v2/storage/health');
    assert.equal(unauthenticated.response.status, 401);

    const scopedUser = await requestJson(server.baseUrl, '/api/v2/storage/health', { headers: tenantAHeaders });
    assert.equal(scopedUser.response.status, 403);
    assert.equal(scopedUser.payload.permission, 'STORAGE_HEALTH_READ');

    const encodedKey = Buffer.from('private/object.pdf').toString('base64url');
    const object = await requestJson(server.baseUrl, `/api/v2/storage/object/${encodedKey}`, { headers: tenantAHeaders });
    assert.equal(object.response.status, 403);
    assert.equal(object.payload.permission, 'STORAGE_OBJECT_READ');
  } finally {
    await stopServer(server.child);
  }
});

test('Phase 1: Builder Project and Broker Network mutations require explicit permissions', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const builderMutation = await requestJson(server.baseUrl, '/api/v2/builder-projects', {
      method: 'POST',
      headers: tenantBHeaders,
      body: { ProjectName: 'Blocked Project', BuilderName: 'Blocked Builder' }
    });
    assert.equal(builderMutation.response.status, 403);
    assert.equal(builderMutation.payload.permission, 'BUILDER_PROJECTS_CREATE');

    const brokerMutation = await requestJson(server.baseUrl, '/api/v2/broker-network', {
      method: 'POST',
      headers: tenantBHeaders,
      body: { Name: 'Blocked Broker', Phone: '+919999999999' }
    });
    assert.equal(brokerMutation.response.status, 403);
    assert.equal(brokerMutation.payload.permission, 'BROKER_NETWORK_CREATE');
  } finally {
    await stopServer(server.child);
  }
});

test('Phase 1: oversized JSON bodies are rejected before route handling', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile, { env: { SIG_REALTY_MAX_JSON_BODY_BYTES: '1024' } });
  try {
    const response = await requestJson(server.baseUrl, '/api/v2/builder-projects', {
      method: 'POST',
      headers: tenantAHeaders,
      body: { ProjectName: 'x'.repeat(4000) }
    });
    assert.equal(response.response.status, 413);
    assert.equal(response.payload.error, 'PAYLOAD_TOO_LARGE');
  } finally {
    await stopServer(server.child);
  }
});

test('Phase 1: API rate limiting returns 429 after the per-key budget', async () => {
  const dbFile = makeTenantDb();
  const server = await startServer(dbFile);
  try {
    const headers = { 'x-forwarded-for': '198.51.100.44' };
    for (let i = 0; i < 240; i += 1) {
      const response = await requestJson(server.baseUrl, '/api/v2/config', { headers });
      assert.notEqual(response.response.status, 429, `request ${i + 1} was unexpectedly rate limited`);
    }
    const limited = await requestJson(server.baseUrl, '/api/v2/config', { headers });
    assert.equal(limited.response.status, 429);
    assert.equal(limited.payload.error, 'RATE_LIMITED');
    assert.ok(limited.response.headers.get('retry-after'));
  } finally {
    await stopServer(server.child);
  }
});
