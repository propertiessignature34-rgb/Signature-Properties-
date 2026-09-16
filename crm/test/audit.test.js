const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { makeDbFile } = require('./admin-test-utils');

test('admin mutations append audit entries and support filtering', () => {
  const repository = new JsonRepository(makeDbFile());
  const actor = { userId: 'USR-0001', role: 'ADMIN' };

  repository.updateSettings({ CompanyName: 'Audit Test Holdings' }, actor);
  repository.createUser({
    Name: 'Audit User',
    Email: 'audit.user@example.com',
    Role: 'AGENT',
    Status: 'Active'
  }, actor);

  const allAudit = repository.listAudit();
  assert.ok(allAudit.length >= 2);

  const userAudit = repository.listAudit({ module: 'Users' });
  assert.ok(userAudit.some((entry) => entry.Action === 'USER_CREATED'));

  const settingsAudit = repository.listAudit({ action: 'SETTING_CHANGED' });
  assert.ok(settingsAudit.some((entry) => entry.Module === 'Settings'));

  assert.equal(allAudit[0].Timestamp >= allAudit[1].Timestamp, true);
  assert.equal(allAudit[0].Result, 'SUCCESS');
});
