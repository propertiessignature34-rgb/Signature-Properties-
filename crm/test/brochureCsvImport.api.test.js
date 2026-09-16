'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { JsonRepository } = require('../src/data/repository');
const objectStorage = require('../src/services/objectStorageService');
const downloader = require('../src/services/safeUrlDownloader');
const { makeDbFile } = require('./admin-test-utils');
const { __test: serverTest } = require('../server');

const PDF_BYTES = Buffer.from('%PDF-1.4\ncsv-api\n%%EOF');
const ORIGINAL_DOWNLOAD_MEDIA = downloader.downloadMediaSafely;

function makeFakeBucket() {
  const files = new Map();
  let nextId = 1;
  return {
    find(query = {}) {
      let rows = Array.from(files.values());
      if (query.filename) rows = rows.filter((file) => file.filename === query.filename);
      if (query['metadata.checksum']) rows = rows.filter((file) => file.metadata?.checksum === query['metadata.checksum']);
      if (query['metadata.mediaType']) rows = rows.filter((file) => file.metadata?.mediaType === query['metadata.mediaType']);
      return {
        sort() { return this; },
        async toArray() { return rows.slice().sort((a, b) => b.uploadDate - a.uploadDate); }
      };
    },
    openUploadStream(filename, uploadOptions = {}) {
      const chunks = [];
      const writable = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        }
      });
      writable.id = `CSV-GRIDFS-${nextId++}`;
      writable.on('finish', () => {
        const buffer = Buffer.concat(chunks);
        files.set(writable.id, {
          _id: writable.id,
          filename,
          length: buffer.length,
          metadata: uploadOptions.metadata || {},
          uploadDate: Date.now(),
          buffer
        });
      });
      return writable;
    },
    openDownloadStream(id) {
      const row = files.get(id);
      return Readable.from(row ? row.buffer : Buffer.alloc(0));
    },
    async delete(id) { files.delete(id); }
  };
}

function makeRuntime(repository, actor = { userId: 'USR-admin', role: 'ADMIN', permissions: ['*'] }) {
  return {
    repository,
    resolveAuthenticatedActor() {
      return { ok: true, actor };
    },
    requireAdminPermission(nextActor = {}, permission) {
      if (nextActor?.permissions?.includes('*')) return { ok: true, actor: nextActor };
      return { ok: false, statusCode: 403, error: 'Forbidden', actor: nextActor, permission };
    }
  };
}

function makeRequest(pathname, { method = 'POST', body } = {}) {
  const chunks = body === undefined ? [] : [JSON.stringify(body)];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = pathname;
  req.headers = { host: '127.0.0.1' };
  if (body !== undefined) req.headers['content-type'] = 'application/json';
  return req;
}

function makeResponse() {
  let statusCode = null;
  let headers = {};
  const chunks = [];
  let resolveEnd;
  const ended = new Promise((resolve) => { resolveEnd = resolve; });
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      callback();
    }
  });
  res.writeHead = (code, nextHeaders = {}) => {
    statusCode = code;
    headers = nextHeaders;
  };
  res.end = (chunk) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    resolveEnd();
  };
  return {
    res,
    ended,
    snapshot() {
      const bodyBuffer = Buffer.concat(chunks);
      const contentType = String(headers['Content-Type'] || '').toLowerCase();
      return {
        statusCode,
        headers,
        bodyBuffer,
        payload: contentType.includes('application/json') ? JSON.parse(bodyBuffer.toString('utf8')) : null
      };
    }
  };
}

async function callApi(pathname, options = {}) {
  const req = makeRequest(pathname, options);
  const response = makeResponse();
  await serverTest.handleApi(req, response.res, new URL(req.url, `http://${req.headers.host}`));
  await response.ended;
  return response.snapshot();
}

function seedProjects(repository) {
  const db = repository.read();
  db.BuilderProjects = ['BLDP-CSV-1', 'BLDP-CSV-2'].map((ProjectID) => ({
    ProjectID,
    ProjectName: ProjectID,
    BuilderName: 'CSV Builder',
    Location1: 'Surat',
    BrochureUrl: `https://legacy.example.com/${ProjectID}.pdf`,
    Brochures: [],
    Photos: [],
    Active: true
  }));
  repository.write(db);
}

function csvData(rows) {
  return Buffer.from([
    'ProjectID,ProjectName,BrochureURL',
    ...rows
  ].join('\n')).toString('base64');
}

test.beforeEach(() => {
  objectStorage.__resetForTests();
  serverTest.setRuntimeForTest(null);
});

test.afterEach(() => {
  objectStorage.__resetForTests();
  serverTest.setRuntimeForTest(null);
  downloader.downloadMediaSafely = ORIGINAL_DOWNLOAD_MEDIA;
});

test('CSV preview and confirmed commit use the Task 11 importer per row', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const repository = new JsonRepository(makeDbFile('sig-task12-api-'));
  seedProjects(repository);
  serverTest.setRuntimeForTest(makeRuntime(repository));
  const calls = [];
  downloader.downloadMediaSafely = async (url, opts = {}) => {
    calls.push(url);
    assert.equal(opts.kind, 'pdf');
    if (url.includes('forbidden')) return { ok: false, error: 'HTTP 403' };
    return { ok: true, buffer: PDF_BYTES, contentType: 'application/pdf', size: PDF_BYTES.length };
  };
  const fileBase64 = csvData([
    'BLDP-CSV-1,One,https://cdn.example.com/one.pdf',
    'BLDP-CSV-2,Two,https://cdn.example.com/forbidden.pdf'
  ]);

  const preview = await callApi('/api/v2/admin/brochure-import/csv/preview', {
    body: { filename: 'brochures.csv', fileBase64 }
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.payload.data.validCount, 2);
  assert.equal(calls.length, 0);

  const notConfirmed = await callApi('/api/v2/admin/brochure-import/csv/commit', {
    body: { filename: 'brochures.csv', fileBase64, confirmed: false }
  });
  assert.equal(notConfirmed.statusCode, 400);
  assert.equal(calls.length, 0);

  const committed = await callApi('/api/v2/admin/brochure-import/csv/commit', {
    body: { filename: 'brochures.csv', fileBase64, confirmed: true }
  });
  assert.equal(committed.statusCode, 200);
  assert.equal(committed.payload.data.successCount, 1);
  assert.equal(committed.payload.data.failedCount, 1);
  assert.equal(committed.payload.data.rows[0].status, 'SUCCESS');
  assert.equal(committed.payload.data.rows[1].status, 'FAILED');
  assert.match(committed.payload.data.rows[1].error, /HTTP 403/);
  assert.deepEqual(calls, [
    'https://cdn.example.com/one.pdf',
    'https://cdn.example.com/forbidden.pdf'
  ]);
  const db = repository.read();
  assert.equal(db.BuilderProjects.find((p) => p.ProjectID === 'BLDP-CSV-1').Brochures.length, 1);
  assert.deepEqual(db.BuilderProjects.find((p) => p.ProjectID === 'BLDP-CSV-2').Brochures, []);
});

test('CSV endpoints require BROCHURE_MIGRATION_MANAGE', async () => {
  const repository = new JsonRepository(makeDbFile('sig-task12-auth-'));
  seedProjects(repository);
  serverTest.setRuntimeForTest(makeRuntime(repository, { userId: 'USR-agent', role: 'AGENT', permissions: [] }));

  const response = await callApi('/api/v2/admin/brochure-import/csv/preview', {
    body: {
      filename: 'brochures.csv',
      fileBase64: csvData(['BLDP-CSV-1,One,https://cdn.example.com/one.pdf'])
    }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.error, 'PERMISSION_MISSING');
  assert.equal(response.payload.permission, 'BROCHURE_MIGRATION_MANAGE');
});