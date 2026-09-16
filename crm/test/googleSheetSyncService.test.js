const test = require('node:test');
const assert = require('node:assert/strict');
const { GoogleSheetSyncService } = require('../src/services/googleSheetSyncService');

function makeRepository(initial = {}) {
  let db = JSON.parse(JSON.stringify({
    Leads: [],
    Transactions: [],
    Requirements: [],
    _V2Counters: { Lead: 0, Transaction: 0, Requirement: 0 },
    ...initial
  }));
  return {
    readCount: 0,
    writeCount: 0,
    read() {
      this.readCount += 1;
      return JSON.parse(JSON.stringify(db));
    },
    write(next) {
      this.writeCount += 1;
      db = JSON.parse(JSON.stringify(next));
    },
    snapshot() { return JSON.parse(JSON.stringify(db)); }
  };
}

function row(name, phone, extra = {}) {
  return {
    'Lead ID': extra.legacyId || '',
    Name: name,
    Phone: phone,
    Email: extra.email || '',
    Source: extra.source || 'Website',
    Budget: extra.budget || '1 Cr',
    'Preferred Location': extra.location || 'Vesu',
    'Property Type': extra.category || 'Residential',
    ...extra.raw
  };
}

test('syncRows batches many Google Sheet rows into a single repository write', async () => {
  const repository = makeRepository();
  const service = new GoogleSheetSyncService(repository);
  const rows = [
    row('A Client', '+91 90000 00001'),
    row('B Client', '+91 90000 00002'),
    row('C Client', '+91 90000 00003')
  ];

  const results = await service.syncRows('Sale', rows);

  assert.equal(repository.readCount, 1, 'batch sync should clone the snapshot once');
  assert.equal(repository.writeCount, 1, 'batch sync should queue one snapshot write, not one per row');
  assert.deepEqual(results.map((r) => r.action), ['CREATED', 'CREATED', 'CREATED']);

  const db = repository.snapshot();
  assert.equal(db.Leads.length, 3);
  assert.equal(db.Transactions.length, 3);
  assert.equal(db.Requirements.length, 3);
});

test('syncRows updates existing leads in the same batch without duplicate records', async () => {
  const repository = makeRepository();
  const service = new GoogleSheetSyncService(repository);
  const rows = [
    row('First Name', '+91 90000 00004', { email: 'old@example.com' }),
    row('Updated Name', '+91 90000 00004', { email: 'new@example.com', location: 'Adajan' })
  ];

  const results = await service.syncRows('Rent', rows);

  assert.equal(repository.writeCount, 1);
  assert.deepEqual(results.map((r) => r.action), ['CREATED', 'UPDATED']);

  const db = repository.snapshot();
  assert.equal(db.Leads.length, 1);
  assert.equal(db.Transactions.length, 1);
  assert.equal(db.Requirements.length, 1);
  assert.equal(db.Leads[0].ClientName, 'Updated Name');
  assert.equal(db.Leads[0].Email, 'new@example.com');
  assert.equal(db.Requirements[0].Location1, 'Adajan');
});

test('_syncOneRow keeps single-row read/write behavior for direct callers', () => {
  const repository = makeRepository();
  const service = new GoogleSheetSyncService(repository);

  const result = service._syncOneRow('Comm', row('Single Client', '+91 90000 00005'));

  assert.equal(result.ok, true);
  assert.equal(result.action, 'CREATED');
  assert.equal(repository.readCount, 1);
  assert.equal(repository.writeCount, 1);
  assert.equal(repository.snapshot().Leads.length, 1);
});

test('syncPublicSheet continues past tab download failures and reports them', async () => {
  const repository = makeRepository();
  const dnsError = new Error('fetch failed');
  dnsError.cause = { code: 'ENOTFOUND' };
  const service = new GoogleSheetSyncService(repository, {
    fetchImpl: async (url) => {
      if (String(url).includes('gid=bad')) {
        throw dnsError;
      }
      return {
        ok: true,
        async text() {
          return 'Name,Phone\nReachable,+91 90000 00011\n';
        }
      };
    }
  });

  const summary = await service.syncPublicSheet({
    sheetId: 'sheet-1',
    tabs: { Broken: 'bad', Rent: 'ok' }
  });

  assert.equal(summary.created, 1);
  assert.equal(summary.ok, false);
  assert.equal(summary.updated, 0);
  assert.equal(summary.failed, 1);
  assert.equal(summary.total, 1);
  assert.deepEqual(summary.tabErrors, [{
    tab: 'Broken',
    error: 'Google Sheet download failed for Broken: could not resolve docs.google.com'
  }]);
  assert.equal(repository.snapshot().Leads.length, 1);

  await assert.rejects(
    () => service.downloadPublicSheetCsv('sheet-1', 'Broken', 'bad'),
    (error) => error.cause === dnsError
  );
});
