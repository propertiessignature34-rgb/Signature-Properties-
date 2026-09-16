const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonRepository } = require('../src/data/repository');
const { JsonDatabaseAdapter } = require('../src/data/databaseAdapter');

function makeAdapter() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-production-db-'));
  const repository = new JsonRepository(path.join(directory, 'database.json'));
  return { adapter: new JsonDatabaseAdapter(repository, { profile: 'development' }), repository };
}

test('production-readiness adapter exposes schema, indexes, profile, and relationship validation', () => {
  const { adapter } = makeAdapter();

  const profile = adapter.getProfile();
  const schema = adapter.getSchema();
  const indexes = adapter.getIndexes();
  const integrity = adapter.validateRelationshipIntegrity();

  assert.equal(profile, 'development');
  assert.ok(schema && schema.entityDefinitions && schema.entityDefinitions.Leads);
  assert.ok(indexes.Leads.includes('LeadID'));
  assert.equal(integrity.ok, true);
});

test('production-readiness adapter supports backup and restore snapshots', () => {
  const { adapter, repository } = makeAdapter();
  repository.create('Leads', { LeadID: 'LEAD-DB-PROD', ClientName: 'Production Lead', City: 'Bengaluru', Phone: '99999', Email: 'prod@example.com', LeadStatus: 'Active' });

  const backup = adapter.backup({ label: 'before-restore' });
  assert.equal(backup.ok, true);

  repository.create('Leads', { LeadID: 'LEAD-DB-DELETE', ClientName: 'Temp Lead', City: 'Pune', Phone: '111', Email: 'temp@example.com', LeadStatus: 'New' });
  const restored = adapter.restore(backup.data.backupId, { confirm: 'RESTORE' });

  assert.equal(restored.ok, true);
  assert.equal(repository.read().Leads.some((lead) => lead.LeadID === 'LEAD-DB-PROD'), true);
  assert.equal(repository.read().Leads.some((lead) => lead.LeadID === 'LEAD-DB-DELETE'), false);
});
