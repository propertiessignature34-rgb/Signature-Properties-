const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { makeDbFile } = require('./admin-test-utils');

test('backup creation and restore round-trip the admin state', () => {
  const repository = new JsonRepository(makeDbFile());
  const actor = { userId: 'USR-0001', role: 'ADMIN' };

  const originalSettings = repository.getSettings();
  const backup = repository.createBackup({ Label: 'pre-change snapshot' }, actor);
  assert.equal(backup.ok, true);
  assert.equal(backup.data.Status, 'AVAILABLE');
  assert.equal(backup.data.Snapshot, undefined);

  const changed = repository.updateSettings({ CompanyName: 'Backup Test Workspace' }, actor);
  assert.equal(changed.ok, true);
  assert.equal(repository.getSettings().CompanyName, 'Backup Test Workspace');

  const restore = repository.restoreBackup(backup.data.BackupID, { confirm: 'RESTORE' }, actor);
  assert.equal(restore.ok, true);
  assert.equal(restore.data.Status, 'RESTORED');
  assert.equal(repository.getSettings().CompanyName, originalSettings.CompanyName);

  const backups = repository.listBackups();
  assert.ok(backups.some((entry) => entry.BackupID === backup.data.BackupID));
});
