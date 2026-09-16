const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { makeDbFile } = require('./admin-test-utils');

test('system settings updates merge nested values and increment configuration history', () => {
  const repository = new JsonRepository(makeDbFile());
  const actor = { userId: 'USR-0001', role: 'ADMIN' };

  const before = repository.getSettings();
  const result = repository.updateSettings({
    CompanyName: 'Signature Realty Admin',
    NotificationSettings: { WhatsApp: true },
    Security: { LoginAttemptLimit: 7 },
    Business: { DefaultBrokeragePercent: 3 }
  }, actor);

  assert.equal(result.ok, true);
  assert.equal(result.data.CompanyName, 'Signature Realty Admin');
  assert.equal(result.data.NotificationSettings.WhatsApp, true);
  assert.equal(result.data.Security.LoginAttemptLimit, 7);
  assert.equal(result.data.Business.DefaultBrokeragePercent, 3);
  assert.equal(result.data.ConfigurationVersion, before.ConfigurationVersion + 1);

  const after = repository.getSettings();
  assert.equal(after.CompanyName, 'Signature Realty Admin');
  assert.equal(after.NotificationSettings.Email, before.NotificationSettings.Email);

  const snapshot = repository.read();
  assert.ok(snapshot.ConfigurationHistory.length >= 1);
  assert.equal(snapshot.ConfigurationHistory.at(-1).Scope, 'Settings');
});

test('notification settings helper writes through the settings record', () => {
  const repository = new JsonRepository(makeDbFile());
  const actor = { userId: 'USR-0001', role: 'ADMIN' };

  const result = repository.updateNotificationSettings({ Email: true, InApp: false }, actor);
  assert.equal(result.ok, true);
  assert.equal(result.data.NotificationSettings.Email, true);
  assert.equal(result.data.NotificationSettings.InApp, false);
  assert.equal(repository.getNotificationSettings().Email, true);
});
