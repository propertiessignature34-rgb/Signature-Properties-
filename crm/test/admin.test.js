const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { makeDbFile } = require('./admin-test-utils');

test('admin repository exposes seeded control data', () => {
  const repository = new JsonRepository(makeDbFile());

  const overview = repository.getAdminOverview();
  assert.equal(overview.ok, true);
  assert.ok(overview.data.totalUsers >= 1);
  assert.equal(overview.data.adminUsers, 1);
  assert.equal(overview.data.activeUsers >= 1, true);

  const permissions = repository.getPermissions();
  const permissionCodes = permissions.map((item) => item.PermissionCode);
  assert.ok(permissionCodes.includes('ADMIN_VIEW'));
  assert.ok(permissionCodes.includes('SETTINGS_MANAGE'));
  assert.ok(permissionCodes.includes('BACKUP_MANAGE'));
});

test('admin repository persists users, roles, masters, and audit entries', () => {
  const repository = new JsonRepository(makeDbFile());
  const actor = { userId: 'USR-0001', role: 'ADMIN' };

  const createdUser = repository.createUser({
    Name: 'Admin Test User',
    Email: 'admin.test.user@example.com',
    Mobile: '+91 9000000999',
    Role: 'AGENT',
    Status: 'Active',
    Permissions: ['REPORTS_VIEW']
  }, actor);
  assert.equal(createdUser.ok, true);
  assert.equal(createdUser.data.Email, 'admin.test.user@example.com');

  const createdRole = repository.saveRole({
    Name: 'AUDITOR',
    Description: 'Audit-only access',
    Permissions: ['AUDIT_VIEW', 'HEALTH_VIEW']
  }, actor);
  assert.equal(createdRole.ok, true);
  assert.equal(createdRole.data.Name, 'AUDITOR');

  const createdMaster = repository.createMaster({
    MasterType: 'LeadSources',
    Value: 'Partner Referral',
    Label: 'Partner Referral'
  }, actor);
  assert.equal(createdMaster.ok, true);
  assert.equal(createdMaster.data.Value, 'Partner Referral');

  const users = repository.listUsers();
  assert.ok(users.some((user) => user.Email === 'admin.test.user@example.com'));
  assert.ok(repository.getRole('AUDITOR'));
  assert.ok(repository.listMasters({ masterType: 'LeadSources' }).some((master) => master.Value === 'Partner Referral'));

  const audit = repository.listAudit({ module: 'Users' });
  assert.ok(audit.some((entry) => entry.Action === 'USER_CREATED'));
});
