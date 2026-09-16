const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { AuthService } = require('../src/services/authService');
const { makeDbFile } = require('./admin-test-utils');

function makeUserRepository() {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  repository.createUser({
    UserID: 'USR-1001',
    Name: 'Tenant User',
    Role: 'AGENT',
    Email: 'tenant.user@example.com',
    Status: 'Active',
    Permissions: ['LEADS_READ'],
    CompanyID: 'COMP-1001',
    BrokerageID: 'BRK-1001'
  }, { userId: 'USR-0001', role: 'ADMIN' });

  repository.createUser({
    UserID: 'USR-1002',
    Name: 'Other Tenant User',
    Role: 'AGENT',
    Email: 'other.tenant@example.com',
    Status: 'Active',
    Permissions: ['LEADS_READ'],
    CompanyID: 'COMP-2001',
    BrokerageID: 'BRK-2001'
  }, { userId: 'USR-0001', role: 'ADMIN' });

  repository.createUser({
    UserID: 'USR-1003',
    Name: 'No Tenant User',
    Role: 'AGENT',
    Email: 'no.tenant@example.com',
    Status: 'Active',
    Permissions: ['LEADS_READ']
  }, { userId: 'USR-0001', role: 'ADMIN' });

  return repository;
}

test('tenant scope is trusted from the session and spoofed tenant headers are ignored', () => {
  const repository = makeUserRepository();
  const auth = new AuthService(repository);
  const token = auth.issueSession({
    userId: 'USR-1001',
    companyId: 'COMP-1001',
    brokerageId: 'BRK-1001',
    role: 'AGENT',
    permissions: ['LEADS_READ']
  });

  const resolved = auth.resolveRequestContext({
    headers: {
      'x-session-token': token,
      'x-company-id': 'COMP-SPOOF',
      'x-brokerage-id': 'BRK-SPOOF',
      'x-user-role': 'ADMIN',
      'x-user-permissions': 'LEADS_DELETE'
    }
  });

  assert.equal(resolved.authenticated, true);
  assert.equal(resolved.companyId, 'COMP-1001');
  assert.equal(resolved.brokerageId, 'BRK-1001');
  assert.equal(resolved.role, 'AGENT');
});

test('missing tenant context is rejected even for a valid account session', () => {
  const repository = makeUserRepository();
  const auth = new AuthService(repository);
  const token = auth.issueSession({
    userId: 'USR-1003',
    role: 'AGENT',
    permissions: ['LEADS_READ']
  });

  const resolved = auth.resolveRequestContext({
    headers: { 'x-session-token': token }
  });

  assert.equal(resolved.authenticated, false);
  assert.equal(resolved.statusCode, 403);
});

test('same-tenant access is allowed while cross-company and cross-brokerage access is denied', () => {
  const repository = makeUserRepository();
  const auth = new AuthService(repository);
  const actor = {
    userId: 'USR-1001',
    role: 'AGENT',
    companyId: 'COMP-1001',
    brokerageId: 'BRK-1001',
    user: repository.getUser('USR-1001')
  };

  const sameTenant = auth.requirePermission(actor, 'LEADS_READ', { companyId: 'COMP-1001', brokerageId: 'BRK-1001' });
  assert.equal(sameTenant.ok, true);

  const crossCompany = auth.requirePermission(actor, 'LEADS_READ', { companyId: 'COMP-9999', brokerageId: 'BRK-1001' });
  assert.equal(crossCompany.ok, false);
  assert.equal(crossCompany.statusCode, 403);

  const crossBrokerage = auth.requirePermission(actor, 'LEADS_READ', { companyId: 'COMP-1001', brokerageId: 'BRK-9999' });
  assert.equal(crossBrokerage.ok, false);
  assert.equal(crossBrokerage.statusCode, 403);

  const spoofedTenantFields = auth.requirePermission(actor, 'LEADS_READ', { companyId: 'COMP-SPOOF', brokerageId: 'BRK-SPOOF' });
  assert.equal(spoofedTenantFields.ok, false);
  assert.equal(spoofedTenantFields.statusCode, 403);
});
