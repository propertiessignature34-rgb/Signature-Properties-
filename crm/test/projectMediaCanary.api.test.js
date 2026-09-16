'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { JsonRepository } = require('../src/data/repository');
const objectStorage = require('../src/services/objectStorageService');
const downloader = require('../src/services/safeUrlDownloader');
const { makeDbFile } = require('./admin-test-utils');
const { __test: serverTest } = require('../server');

const PDF_BYTES = Buffer.from('%PDF-1.4\ncanary-api\n%%EOF');
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);

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
      writable.id = `GRIDFS-${nextId++}`;
      writable.on('finish', () => {
        files.set(writable.id, {
          _id: writable.id,
          filename,
          length: Buffer.concat(chunks).length,
          metadata: uploadOptions.metadata || {},
          uploadDate: Date.now(),
          buffer: Buffer.concat(chunks)
        });
      });
      return writable;
    },
    openDownloadStream(id) {
      const row = files.get(id);
      if (!row) {
        const stream = new Readable({ read() {} });
        process.nextTick(() => stream.emit('error', new Error('not found')));
        return stream;
      }
      return Readable.from(row.buffer);
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

function makeRequest(pathname, { method = 'GET', body } = {}) {
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
      let payload = null;
      const contentType = String(headers['Content-Type'] || headers['content-type'] || '').toLowerCase();
      if (bodyBuffer.length && contentType.includes('application/json')) payload = JSON.parse(bodyBuffer.toString('utf8'));
      return { statusCode, headers, payload, bodyBuffer };
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

function seedProject(repository) {
  const now = new Date().toISOString();
  const db = repository.read();
  db.BuilderProjects = db.BuilderProjects || [];
  db.BuilderProjects.push({
    ProjectID: 'BLDP-CANARY-1',
    ProjectName: 'Canary One',
    BuilderName: 'Builder',
    Location1: 'Surat',
    BrochureUrl: 'https://cdn.example.com/canary.pdf',
    Brochures: [],
    Photos: [{ MediaID: 'MED-CANARY-IMG-1', Filename: 'canary.png', Url: 'https://img.example.com/canary.png', SourceUrl: 'https://img.example.com/canary.png' }],
    Active: true,
    CreatedAt: now,
    UpdatedAt: now
  });
  repository.write(db);
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

const ORIGINAL_DOWNLOAD_MEDIA = downloader.downloadMediaSafely;

test('authorized targeted canary endpoint invokes one-project migration; bulk endpoint remains disabled', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const repository = new JsonRepository(makeDbFile('sig-canary-api-'));
  seedProject(repository);
  serverTest.setRuntimeForTest(makeRuntime(repository));

  downloader.downloadMediaSafely = async (_url, opts = {}) => {
    if (opts.kind === 'pdf') return { ok: true, buffer: PDF_BYTES, contentType: 'application/pdf', size: PDF_BYTES.length };
    if (opts.kind === 'image') return { ok: true, buffer: PNG_BYTES, contentType: 'image/png', size: PNG_BYTES.length };
    return { ok: false, error: 'bad kind' };
  };

  const migrate = await callApi('/api/v2/admin/brochure-migration/project/BLDP-CANARY-1', { method: 'POST', body: {} });
  assert.equal(migrate.statusCode, 200);
  assert.equal(migrate.payload.ok, true);
  assert.equal(migrate.payload.data.projectId, 'BLDP-CANARY-1');
  assert.equal(migrate.payload.data.projectCountBefore, 1);
  assert.equal(migrate.payload.data.projectCountAfter, 1);
  assert.equal(migrate.payload.data.verified, true);

  const migrated = repository.read().BuilderProjects.find((row) => row.ProjectID === 'BLDP-CANARY-1');
  assert.equal(migrated.ProjectID, 'BLDP-CANARY-1');
  assert.equal(migrated.Brochures.length, 1);
  assert.equal(migrated.Photos[0].downloadStatus, 'downloaded');

  const bulk = await callApi('/api/v2/admin/brochure-migration', { method: 'POST', body: {} });
  assert.equal(bulk.statusCode, 410);
  assert.equal(bulk.payload.error, 'AUTOMATIC_MEDIA_MIGRATION_DISABLED');
});

test('explicit admin brochure import stores bytes and internal brochure endpoint serves the verified PDF', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const repository = new JsonRepository(makeDbFile('sig-task11-api-'));
  seedProject(repository);
  serverTest.setRuntimeForTest(makeRuntime(repository));

  downloader.downloadMediaSafely = async (_url, opts = {}) => {
    assert.equal(opts.kind, 'pdf');
    return { ok: true, buffer: PDF_BYTES, contentType: 'application/pdf', size: PDF_BYTES.length };
  };

  const imported = await callApi('/api/v2/admin/brochure-import', {
    method: 'POST',
    body: {
      ProjectID: 'BLDP-CANARY-1',
      BrochureURL: 'https://cdn.example.com/explicit.pdf'
    }
  });
  assert.equal(imported.statusCode, 200);
  assert.equal(imported.payload.ok, true);
  assert.equal(imported.payload.data.verified, true);
  assert.equal(imported.payload.data.internalUrl, '/api/v2/builder-projects/BLDP-CANARY-1/brochure');

  const project = repository.read().BuilderProjects.find((row) => row.ProjectID === 'BLDP-CANARY-1');
  assert.equal(project.BrochureUrl, 'https://cdn.example.com/canary.pdf');
  assert.equal(project.Brochures[0].OriginalUrl, 'https://cdn.example.com/explicit.pdf');
  assert.equal(project.Brochures[0].verified, true);

  const served = await callApi('/api/v2/builder-projects/BLDP-CANARY-1/brochure', { method: 'GET' });
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers['Content-Type'], 'application/pdf');
  assert.deepEqual(served.bodyBuffer, PDF_BYTES);
});

test('explicit brochure import requires BROCHURE_MIGRATION_MANAGE permission', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const repository = new JsonRepository(makeDbFile('sig-task11-auth-'));
  seedProject(repository);
  serverTest.setRuntimeForTest(makeRuntime(repository, { userId: 'USR-agent', role: 'AGENT', permissions: [] }));

  const imported = await callApi('/api/v2/admin/brochure-import', {
    method: 'POST',
    body: {
      ProjectID: 'BLDP-CANARY-1',
      BrochureURL: 'https://cdn.example.com/explicit.pdf'
    }
  });
  assert.equal(imported.statusCode, 403);
  assert.equal(imported.payload.error, 'PERMISSION_MISSING');
  assert.equal(imported.payload.permission, 'BROCHURE_MIGRATION_MANAGE');
});

test('canary admin endpoint keeps explicit permission missing contract', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const repository = new JsonRepository(makeDbFile('sig-canary-auth-'));
  seedProject(repository);
  serverTest.setRuntimeForTest(makeRuntime(repository, { userId: 'USR-agent', role: 'AGENT', permissions: [] }));

  const migrate = await callApi('/api/v2/admin/brochure-migration/project/BLDP-CANARY-1', { method: 'POST', body: {} });
  assert.equal(migrate.statusCode, 403);
  assert.equal(migrate.payload.error, 'PERMISSION_MISSING');
  assert.equal(migrate.payload.permission, 'BROCHURE_MIGRATION_MANAGE');
  assert.equal(migrate.payload.message, 'Permission missing: BROCHURE_MIGRATION_MANAGE');
});

test('internal project media endpoints require authenticated actor', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const repository = new JsonRepository(makeDbFile('sig-canary-media-auth-'));
  seedProject(repository);
  serverTest.setRuntimeForTest(makeRuntime(repository, { userId: '', role: '', permissions: [] }));

  const brochure = await callApi('/api/v2/builder-projects/BLDP-CANARY-1/brochure', { method: 'GET' });
  assert.equal(brochure.statusCode, 401);
  assert.equal(brochure.payload.error, 'Unauthorized');

  const image = await callApi('/api/v2/builder-projects/BLDP-CANARY-1/images/MED-CANARY-IMG-1', { method: 'GET' });
  assert.equal(image.statusCode, 401);
  assert.equal(image.payload.error, 'Unauthorized');
});
