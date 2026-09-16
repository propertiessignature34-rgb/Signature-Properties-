const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { AuthService } = require('../src/services/authService');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeActor(overrides = {}) {
  const baseUser = {
    UserID: 'USR-0001',
    Name: 'System Admin',
    Status: 'Active',
    Role: 'ADMIN',
    Permissions: ['*']
  };
  const user = { ...baseUser, ...(overrides.user || {}) };
  const userId = overrides.userId || overrides.userID || user.UserID;
  return {
    userId,
    userID: userId,
    role: overrides.role || user.Role,
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    permissions: ['*'],
    user,
    ...overrides,
    userId,
    userID: userId,
    user: { ...user, ...(overrides.user || {}) },
    role: overrides.role || user.Role
  };
}

function persistUser(repository, user) {
  const db = repository.read();
  db.Users = Array.isArray(db.Users) ? db.Users : [];
  db.Users.push(user);
  repository.write(db);
}

test('ADMIN allowed', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor();
  const result = auth.requirePermission(actor, 'LEADS_READ');
  assert.equal(result.ok, true);
});

test('MANAGER allowed where permitted', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor({ userId: 'USR-0002', userID: 'USR-0002', role: 'MANAGER', permissions: ['LEADS_READ', 'LEADS_CREATE', 'REQUIREMENTS_READ'], user: { UserID: 'USR-0002', Name: 'Manager', Status: 'Active', Role: 'MANAGER', Permissions: ['LEADS_READ', 'LEADS_CREATE', 'REQUIREMENTS_READ'] } });
  assert.equal(auth.requirePermission(actor, 'LEADS_READ').ok, true);
  assert.equal(auth.requirePermission(actor, 'REQUIREMENTS_READ').ok, true);
  assert.equal(auth.requirePermission(actor, 'USER_READ').ok, false);
});

test('AGENT allowed where permitted', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor({ userId: 'USR-0003', userID: 'USR-0003', role: 'AGENT', permissions: ['LEADS_READ', 'LEADS_CREATE', 'SITE_VISIT_CREATE'], user: { UserID: 'USR-0003', Name: 'Agent', Status: 'Active', Role: 'AGENT', Permissions: ['LEADS_READ', 'LEADS_CREATE', 'SITE_VISIT_CREATE'] } });
  assert.equal(auth.requirePermission(actor, 'LEADS_CREATE').ok, true);
  assert.equal(auth.requirePermission(actor, 'SITE_VISIT_CREATE').ok, true);
  assert.equal(auth.requirePermission(actor, 'USER_READ').ok, false);
});

test('BROKER allowed where permitted', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor({ role: 'BROKER', permissions: ['NEGOTIATION_READ', 'NEGOTIATION_UPDATE', 'TOKEN_READ'], user: { UserID: 'USR-2001', Name: 'Broker', Status: 'Active', Role: 'BROKER', Permissions: ['NEGOTIATION_READ', 'NEGOTIATION_UPDATE', 'TOKEN_READ'] } });
  assert.equal(auth.requirePermission(actor, 'NEGOTIATION_READ').ok, true);
  assert.equal(auth.requirePermission(actor, 'TOKEN_READ').ok, true);
  assert.equal(auth.requirePermission(actor, 'USER_READ').ok, false);
});

test('VIEWER read allowed', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor({ role: 'VIEWER', permissions: ['LEADS_READ', 'REQUIREMENTS_READ', 'INVENTORY_READ'], user: { UserID: 'USR-4001', Name: 'Viewer', Status: 'Active', Role: 'VIEWER', Permissions: ['LEADS_READ', 'REQUIREMENTS_READ', 'INVENTORY_READ'] } });
  assert.equal(auth.requirePermission(actor, 'LEADS_READ').ok, true);
  assert.equal(auth.requirePermission(actor, 'REQUIREMENTS_READ').ok, true);
});

test('VIEWER write denied', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor({ role: 'VIEWER', permissions: ['LEADS_READ'], user: { UserID: 'USR-4002', Name: 'Viewer', Status: 'Active', Role: 'VIEWER', Permissions: ['LEADS_READ'] } });
  assert.equal(auth.requirePermission(actor, 'LEADS_CREATE').ok, false);
  assert.equal(auth.requirePermission(actor, 'LEADS_UPDATE').ok, false);
});

test('unknown role denied', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor({ role: 'GHOST', permissions: ['LEADS_READ'], user: { UserID: 'USR-5001', Name: 'Ghost', Status: 'Active', Role: 'GHOST', Permissions: ['LEADS_READ'] } });
  assert.equal(auth.requirePermission(actor, 'LEADS_READ').ok, false);
});

test('missing permission denied', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor({ role: 'VIEWER', permissions: ['LEADS_READ'], user: { UserID: 'USR-6001', Name: 'Viewer', Status: 'Active', Role: 'VIEWER', Permissions: ['LEADS_READ'] } });
  assert.equal(auth.requirePermission(actor, 'LEADS_CREATE').ok, false);
});

test('unauthenticated denied', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  assert.equal(auth.requirePermission({}, 'LEADS_READ').ok, false);
});

test('disabled user denied', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor({ role: 'ADMIN', permissions: ['*'], user: { UserID: 'USR-7001', Name: 'Disabled Admin', Status: 'Disabled', Role: 'ADMIN', Permissions: ['*'] } });
  assert.equal(auth.requirePermission(actor, 'ADMIN_READ').ok, false);
});

test('spoofed role denied', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  persistUser(repository, { UserID: 'USR-8001', Name: 'Actual Agent', Status: 'Active', Role: 'AGENT', Permissions: ['LEADS_READ'] });
  const spoofed = { userId: 'USR-8001', role: 'ADMIN', permissions: ['*'] };
  assert.equal(auth.requirePermission(spoofed, 'USER_READ').ok, false);
});

test('spoofed permissions denied', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  persistUser(repository, { UserID: 'USR-9001', Name: 'Viewer', Status: 'Active', Role: 'VIEWER', Permissions: ['LEADS_READ'] });
  const spoofed = { userId: 'USR-9001', role: 'VIEWER', permissions: ['ADMIN_READ', 'USER_CREATE', 'USER_DELETE'] };
  assert.equal(auth.requirePermission(spoofed, 'ADMIN_READ').ok, false);
});

test('role escalation denied', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  persistUser(repository, { UserID: 'USR-1001', Name: 'Agent', Status: 'Active', Role: 'AGENT', Permissions: ['LEADS_READ'] });
  const escalated = { userId: 'USR-1001', role: 'ADMIN', permissions: ['*'] };
  assert.equal(auth.requirePermission(escalated, 'ADMIN_READ').ok, false);
});

test('cross-tenant + valid role denied', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor({ companyId: 'COMP-001', brokerageId: 'BRK-001', role: 'MANAGER', permissions: ['LEADS_READ'], user: { UserID: 'USR-1101', Name: 'Manager', Status: 'Active', Role: 'MANAGER', Permissions: ['LEADS_READ'] } });
  assert.equal(auth.requirePermission(actor, 'LEADS_READ', { companyId: 'COMP-999', brokerageId: 'BRK-999' }).ok, false);
});

test('admin-only endpoint denied for non-admin', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor({ role: 'AGENT', permissions: ['LEADS_READ'], user: { UserID: 'USR-1201', Name: 'Agent', Status: 'Active', Role: 'AGENT', Permissions: ['LEADS_READ'] } });
  assert.equal(auth.requirePermission(actor, 'ADMIN_READ').ok, false);
});

test('user-management endpoint denied for non-admin', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor({ role: 'MANAGER', permissions: ['USER_READ'], user: { UserID: 'USR-1301', Name: 'Manager', Status: 'Active', Role: 'MANAGER', Permissions: ['USER_READ'] } });
  assert.equal(auth.requirePermission(actor, 'USER_CREATE').ok, false);
});

test('audit endpoint restricted', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actor = makeActor({ role: 'AGENT', permissions: ['LEADS_READ'], user: { UserID: 'USR-1401', Name: 'Agent', Status: 'Active', Role: 'AGENT', Permissions: ['LEADS_READ'] } });
  assert.equal(auth.requirePermission(actor, 'AUDIT_READ').ok, false);
});

test('permission cannot be added from request payload', () => {
  const repository = new JsonRepository();
  const auth = new AuthService(repository);
  const actualActor = makeActor({ role: 'VIEWER', permissions: ['LEADS_READ'], user: { UserID: 'USR-1501', Name: 'Viewer', Status: 'Active', Role: 'VIEWER', Permissions: ['LEADS_READ'] } });
  const forgedRequest = {
    body: { role: 'ADMIN', permissions: ['ADMIN_READ', 'USER_CREATE', 'USER_DELETE'] },
    query: { role: 'ADMIN', permissions: 'ADMIN_READ,USER_CREATE,USER_DELETE' },
    headers: { 'x-user-role': 'ADMIN', 'x-user-permissions': 'ADMIN_READ,USER_CREATE,USER_DELETE' },
    actor: actualActor
  };
  const result = auth.requirePermission(forgedRequest.actor, 'ADMIN_READ');
  assert.equal(result.ok, false);
  assert.equal(auth.requirePermission(actualActor, 'LEADS_READ').ok, true);
});
