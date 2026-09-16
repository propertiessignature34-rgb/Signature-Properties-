'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BrochureCsvImportService } = require('../src/services/brochureCsvImportService');

function makeRepository(projectIds = []) {
  let db = {
    BuilderProjects: projectIds.map((ProjectID) => ({
      ProjectID,
      ProjectName: `Existing ${ProjectID}`,
      BrochureUrl: `https://legacy.example.com/${ProjectID}.pdf`,
      Brochures: []
    }))
  };
  return {
    read() { return JSON.parse(JSON.stringify(db)); },
    write(next) { db = JSON.parse(JSON.stringify(next)); },
    snapshot() { return JSON.parse(JSON.stringify(db)); }
  };
}

test('valid CSV previews explicit rows without starting an import', () => {
  const repository = makeRepository(['BLDP-001', 'BLDP-002']);
  const calls = [];
  const service = new BrochureCsvImportService(repository, {
    importer: {
      async importExplicitBrochure(input) {
        calls.push(input);
        return { ok: true, data: { idempotent: false } };
      }
    }
  });

  const out = service.preview(Buffer.from([
    'ProjectID,ProjectName,BrochureURL',
    'BLDP-001,One,https://cdn.example.com/one.pdf',
    'BLDP-002,Two,https://cdn.example.com/two.pdf'
  ].join('\n')), 'brochures.csv');

  assert.equal(out.ok, true);
  assert.equal(out.data.totalRows, 2);
  assert.equal(out.data.validCount, 2);
  assert.equal(out.data.invalidCount, 0);
  assert.equal(out.data.rows[0].status, 'VALID');
  assert.equal(calls.length, 0);
});

test('CSV validation reports missing projects, invalid URLs, missing IDs, and duplicate IDs', () => {
  const service = new BrochureCsvImportService(makeRepository(['BLDP-001']));
  const out = service.preview(Buffer.from([
    'ProjectID,ProjectName,BrochureURL',
    'BLDP-MISSING,Missing,https://cdn.example.com/missing.pdf',
    'BLDP-001,Bad URL,http://cdn.example.com/bad.pdf',
    ',No ID,https://cdn.example.com/no-id.pdf',
    'BLDP-001,Duplicate One,https://cdn.example.com/one.pdf',
    'BLDP-001,Duplicate Two,https://cdn.example.com/two.pdf'
  ].join('\n')), 'brochures.csv');

  assert.equal(out.ok, true);
  assert.equal(out.data.validCount, 0);
  assert.equal(out.data.invalidCount, 5);
  assert.match(out.data.rows[0].errors.join(' '), /ProjectID not found/);
  assert.match(out.data.rows[1].errors.join(' '), /HTTPS URL/);
  assert.match(out.data.rows[2].errors.join(' '), /ProjectID is required/);
  assert.match(out.data.rows[3].errors.join(' '), /Duplicate ProjectID/);
  assert.match(out.data.rows[4].errors.join(' '), /Duplicate ProjectID/);
  assert.match(out.data.errorReport, /BLDP-MISSING/);
});

test('CSV commit processes rows independently, reuses Task 11 importer, and never discovers URLs', async () => {
  const repository = makeRepository(['BLDP-001', 'BLDP-002', 'BLDP-003']);
  const calls = [];
  const service = new BrochureCsvImportService(repository, {
    importer: {
      async importExplicitBrochure(input) {
        calls.push(input);
        if (input.projectId === 'BLDP-002') {
          return { ok: false, statusCode: 422, error: 'BROCHURE_IMPORT_FAILED', data: { failure: 'HTTP 403' } };
        }
        if (input.projectId === 'BLDP-003') {
          return { ok: true, data: { idempotent: true } };
        }
        return { ok: true, data: { idempotent: false } };
      }
    }
  });
  const csv = Buffer.from([
    'ProjectID,ProjectName,BrochureURL',
    'BLDP-001,One,https://csv.example.com/one.pdf',
    'BLDP-002,Two,https://csv.example.com/two.pdf',
    'BLDP-003,Three,https://csv.example.com/three.pdf'
  ].join('\n'));

  const noConfirm = await service.importCsv(csv, 'brochures.csv', { userId: 'USR-ADMIN' });
  assert.equal(noConfirm.ok, false);
  assert.equal(calls.length, 0);

  const out = await service.importCsv(csv, 'brochures.csv', {
    userId: 'USR-ADMIN',
    confirmed: true
  });

  assert.equal(out.ok, true);
  assert.equal(out.data.successCount, 1);
  assert.equal(out.data.idempotentCount, 1);
  assert.equal(out.data.failedCount, 1);
  assert.equal(out.data.invalidCount, 0);
  assert.deepEqual(calls.map((call) => [call.projectId, call.brochureUrl]), [
    ['BLDP-001', 'https://csv.example.com/one.pdf'],
    ['BLDP-002', 'https://csv.example.com/two.pdf'],
    ['BLDP-003', 'https://csv.example.com/three.pdf']
  ]);
  assert.equal(out.data.rows[1].status, 'FAILED');
  assert.match(out.data.rows[1].error, /HTTP 403/);
});