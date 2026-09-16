const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonRepository } = require('../src/data/repository');
const { JsonDatabaseAdapter } = require('../src/data/databaseAdapter');

function makeAdapter() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-database-adapter-'));
  const repository = new JsonRepository(path.join(directory, 'database.json'));
  return { adapter: new JsonDatabaseAdapter(repository), repository };
}

test('JSON adapter reads, lists, finds, counts, and preserves business IDs', () => {
  const { adapter } = makeAdapter();
  adapter.insert('Leads', { LeadID: 'LEAD-0001', ClientName: 'Lead One' });
  adapter.insert('Leads', { LeadID: 'LEAD-0002', ClientName: 'Lead Two' });
  const lead = adapter.get('Leads', 'LeadID', 'LEAD-0001');

  assert.equal(lead.LeadID, 'LEAD-0001');
  assert.ok(adapter.list('Leads').length >= 2);
  assert.equal(adapter.find('Leads', 'LeadID', 'LEAD-0001').LeadID, 'LEAD-0001');
  assert.equal(adapter.count('Leads'), adapter.list('Leads').length);
});

test('JSON adapter inserts and updates tenant-aware records', () => {
  const { adapter } = makeAdapter();
  const inserted = adapter.insert('Tasks', {
    TaskID: 'TASK-0001',
    Title: 'Verify tenant scope',
    Status: 'OPEN'
  }, { companyId: 'COMP-0001', brokerageId: 'BROKERAGE-0001' });

  assert.equal(inserted.companyId, 'COMP-0001');
  assert.equal(inserted.brokerageId, 'BROKERAGE-0001');
  assert.equal(adapter.count('Tasks', { companyId: 'COMP-0001' }), 1);
  assert.equal(adapter.count('Tasks', { companyId: 'COMP-OTHER' }), 0);

  const updated = adapter.update('Tasks', 'TaskID', 'TASK-0001', { Status: 'DONE' }, { companyId: 'COMP-0001' });
  assert.equal(updated.Status, 'DONE');
  assert.equal(adapter.find('Tasks', 'TaskID', 'TASK-0001', { companyId: 'COMP-OTHER' }), null);
});

test('JSON adapter filters by where values and supports deletion', () => {
  const { adapter } = makeAdapter();
  adapter.insert('Tasks', { TaskID: 'TASK-OPEN', Status: 'OPEN' });
  adapter.insert('Tasks', { TaskID: 'TASK-DONE', Status: 'DONE' });

  assert.equal(adapter.list('Tasks', { where: { Status: 'OPEN' } }).length, 1);
  assert.equal(adapter.delete('Tasks', 'TaskID', 'TASK-OPEN'), true);
  assert.equal(adapter.find('Tasks', 'TaskID', 'TASK-OPEN'), null);
  assert.equal(adapter.delete('Tasks', 'TaskID', 'TASK-MISSING'), false);
});

test('JSON adapter transaction rolls back writes after a failure', () => {
  const { adapter } = makeAdapter();

  assert.throws(() => {
    adapter.transaction((database) => {
      database.insert('Tasks', { TaskID: 'TASK-ROLLBACK', Status: 'OPEN' });
      throw new Error('abort transaction');
    });
  }, /abort transaction/);

  assert.equal(adapter.find('Tasks', 'TaskID', 'TASK-ROLLBACK'), null);
});
