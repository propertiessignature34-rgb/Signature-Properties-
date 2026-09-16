'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const { JsonRepository } = require('../src/data/repository');
const { makeDbFile } = require('./admin-test-utils');
const { BrochureMigrationService } = require('../src/services/brochureMigrationService');
const objectStorage = require('../src/services/objectStorageService');
const downloader = require('../src/services/safeUrlDownloader');
const { downloadPdfSafely, openPdfStreamSafely } = require('../src/services/safeUrlDownloader');

const PDF_BYTES = Buffer.from('%PDF-1.4\n%mock brochure content\n%%EOF');

function seedProject(repository, overrides = {}) {
  const db = repository.read();
  const project = {
    ProjectID: repository.createId('BLDP'),
    ProjectName: 'Test Towers',
    BuilderName: 'Test Builder',
    Location1: 'Vesu',
    BrochureUrl: 'https://cdn.example.com/brochures/test-towers.pdf',
    Brochures: [],
    Active: true,
    CreatedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString(),
    ...overrides
  };
  db.BuilderProjects = db.BuilderProjects || [];
  db.BuilderProjects.push(project);
  repository.write(db);
  return project.ProjectID;
}

function withMockedDownloader(impl, fn) {
  const originalStream = downloader.openPdfStreamSafely;
  downloader.openPdfStreamSafely = impl;
  return Promise.resolve(fn()).finally(() => { downloader.openPdfStreamSafely = originalStream; });
}

function withMockedStorage(mock, fn) {
  const originalPut = objectStorage.putObject;
  const originalPutStream = objectStorage.putObjectStream;
  const originalGet = objectStorage.getObject;
  const originalGetInfo = objectStorage.getObjectInfo;
  const originalGetStream = objectStorage.getObjectStream;
  const originalDelete = objectStorage.deleteObject;
  const putObject = mock.putObject;
  const getObject = mock.getObject;
  if (putObject) objectStorage.putObject = putObject;
  if (putObject) objectStorage.putObjectStream = putObject;
  if (getObject) objectStorage.getObject = getObject;
  if (mock.putObjectStream) objectStorage.putObjectStream = mock.putObjectStream;
  if (mock.getObjectInfo) objectStorage.getObjectInfo = mock.getObjectInfo;
  if (mock.getObjectStream) objectStorage.getObjectStream = mock.getObjectStream;
  if (mock.deleteObject) objectStorage.deleteObject = mock.deleteObject;
  if (getObject) {
    objectStorage.getObjectInfo = mock.getObjectInfo || (async (fullPath) => {
      const obj = await getObject(fullPath);
      return { path: fullPath, key: fullPath, size: obj.size ?? obj.buffer.length, contentType: obj.contentType };
    });
    objectStorage.getObjectStream = mock.getObjectStream || (async (fullPath) => {
      const obj = await getObject(fullPath);
      return { stream: Readable.from(obj.buffer), size: obj.size ?? obj.buffer.length, contentType: obj.contentType };
    });
  }
  return Promise.resolve(fn()).finally(() => {
    objectStorage.putObject = originalPut;
    objectStorage.putObjectStream = originalPutStream;
    objectStorage.getObject = originalGet;
    objectStorage.getObjectInfo = originalGetInfo;
    objectStorage.getObjectStream = originalGetStream;
    objectStorage.deleteObject = originalDelete;
  });
}

function fakeStorageBackend() {
  const store = new Map();
  const deleted = [];
  return {
    putObject: async (pathSuffix, input) => {
      const chunks = [];
      if (Buffer.isBuffer(input)) {
        chunks.push(input);
      } else {
        for await (const chunk of input) chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      store.set(pathSuffix, buffer);
      return { path: pathSuffix, size: buffer.length };
    },
    getObject: async (fullPath) => {
      if (!store.has(fullPath)) throw new Error('Download failed: HTTP 404');
      return { buffer: store.get(fullPath), contentType: 'application/pdf' };
    },
    getObjectInfo: async (fullPath) => {
      if (!store.has(fullPath)) return null;
      return { path: fullPath, key: fullPath, size: store.get(fullPath).length, contentType: 'application/pdf' };
    },
    getObjectStream: async (fullPath) => {
      if (!store.has(fullPath)) return null;
      return { stream: Readable.from(store.get(fullPath)), size: store.get(fullPath).length, contentType: 'application/pdf' };
    },
    deleteObject: async (fullPath) => {
      const existed = store.delete(fullPath);
      if (existed) deleted.push(fullPath);
      return { deleted: existed ? 1 : 0 };
    },
    store,
    deleted
  };
}

function pdfStreamResult(buffer = PDF_BYTES) {
  let size = 0;
  async function* chunks() {
    for (const chunk of [buffer.subarray(0, 7), buffer.subarray(7)]) {
      size += chunk.length;
      yield chunk;
    }
  }
  return { ok: true, stream: Readable.from(chunks()), contentType: 'application/pdf', getSize: () => size };
}

async function collectStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function withKeepAlive(promise, intervalMs = 10) {
  const ticker = setInterval(() => {}, intervalMs);
  try {
    return await promise;
  } finally {
    clearInterval(ticker);
  }
}

test('successful migration: downloads, uploads, verifies, preserves original URL', async () => {
  const repository = new JsonRepository(makeDbFile());
  const projectId = seedProject(repository);
  const backend = fakeStorageBackend();
  const svc = new BrochureMigrationService(repository);

  await withMockedDownloader(
    async () => pdfStreamResult(PDF_BYTES),
    () => withMockedStorage(backend, async () => {
      const out = await svc.runBatch({ batchSize: 3, userId: 'USR-TEST' });
      assert.equal(out.ok, true);
      assert.equal(out.data.processed, 1);
      assert.equal(out.data.successful, 1);
      assert.equal(out.data.failed, 0);
      assert.equal(out.data.results[0].persisted, true);
    })
  );

  const project = repository.read().BuilderProjects.find((p) => p.ProjectID === projectId);
  assert.equal(project.BrochureUrl, 'https://cdn.example.com/brochures/test-towers.pdf', 'original URL must never be cleared');
  assert.equal(project.BrochureMigration.status, 'success');
  assert.equal(project.BrochureMigration.originalUrl, project.BrochureUrl);
  assert.equal(project.Brochures.length, 1);
  assert.equal(project.Brochures[0].Source, 'migration');
  assert.equal(project.Brochures[0].OriginalUrl, project.BrochureUrl);
});

test('failed download: keeps original URL, marks failed, continues batch, remains retryable', async () => {
  const repository = new JsonRepository(makeDbFile());
  const idA = seedProject(repository);
  const idB = seedProject(repository);
  const svc = new BrochureMigrationService(repository);

  await withMockedDownloader(
    async () => ({ ok: false, error: 'HTTP 404' }),
    () => svc.runBatch({ batchSize: 5, userId: 'system' })
  ).then((out) => {
    assert.equal(out.ok, true);
    assert.equal(out.data.processed, 2);
    assert.equal(out.data.failed, 2);
  });

  const db = repository.read();
  for (const id of [idA, idB]) {
    const project = db.BuilderProjects.find((p) => p.ProjectID === id);
    assert.ok(project.BrochureUrl, 'BrochureUrl must remain intact on failure');
    assert.equal(project.BrochureMigration.status, 'failed');
    assert.equal(project.BrochureMigration.attempts, 1);
    assert.ok(project.BrochureMigration.error);
  }
});

test('timeout is treated as a failure, not a crash', async () => {
  const repository = new JsonRepository(makeDbFile());
  seedProject(repository);
  const svc = new BrochureMigrationService(repository);

  const out = await withMockedDownloader(
    async () => ({ ok: false, error: 'Request timed out' }),
    () => svc.runBatch({ batchSize: 1 })
  );
  assert.equal(out.data.failed, 1);
  assert.match(out.data.results[0].error, /timed out/i);
});

test('oversized file is rejected before upload', async () => {
  const repository = new JsonRepository(makeDbFile());
  seedProject(repository);
  const svc = new BrochureMigrationService(repository);
  let uploadCalled = false;

  const out = await withMockedDownloader(
    async () => ({ ok: false, error: 'Download exceeded max size of 20971520 bytes' }),
    () => withMockedStorage({ putObject: async () => { uploadCalled = true; return { path: 'x' }; } }, () => svc.runBatch({ batchSize: 1 }))
  );
  assert.equal(out.data.failed, 1);
  assert.equal(uploadCalled, false, 'must not upload when download was rejected for size');
});

test('invalid content type / non-PDF response is rejected', async () => {
  const repository = new JsonRepository(makeDbFile());
  seedProject(repository);
  const svc = new BrochureMigrationService(repository);

  const out = await withMockedDownloader(
    async () => ({ ok: false, error: 'Response failed PDF signature validation' }),
    () => svc.runBatch({ batchSize: 1 })
  );
  assert.equal(out.data.failed, 1);
  assert.match(out.data.results[0].error, /signature/i);
});

test('upload failure is caught and marked failed without throwing', async () => {
  const repository = new JsonRepository(makeDbFile());
  seedProject(repository);
  const svc = new BrochureMigrationService(repository);

  const out = await withMockedDownloader(
    async () => pdfStreamResult(PDF_BYTES),
    () => withMockedStorage({ putObject: async () => { throw new Error('Upload failed: HTTP 500'); } }, () => svc.runBatch({ batchSize: 1 }))
  );
  assert.equal(out.data.failed, 1);
  assert.match(out.data.results[0].error, /Upload failed/);
});

test('Mongo/repository persistence failure surfaces as an error, not silent data loss', async () => {
  const repository = new JsonRepository(makeDbFile());
  seedProject(repository);
  const svc = new BrochureMigrationService(repository);
  const originalWrite = repository.write.bind(repository);
  repository.write = () => { throw new Error('simulated persistence failure'); };

  await withMockedDownloader(
    async () => pdfStreamResult(PDF_BYTES),
    () => withMockedStorage(fakeStorageBackend(), async () => {
      await assert.rejects(() => svc.runBatch({ batchSize: 1 }), /simulated persistence failure/);
    })
  );

  repository.write = originalWrite;
});

test('retry after failure succeeds and does not duplicate Brochures[] entries (idempotent)', async () => {
  const repository = new JsonRepository(makeDbFile());
  const projectId = seedProject(repository);
  const svc = new BrochureMigrationService(repository);
  const backend = fakeStorageBackend();

  await withMockedDownloader(async () => ({ ok: false, error: 'HTTP 503' }), () => svc.runBatch({ batchSize: 1 }));
  let project = repository.read().BuilderProjects.find((p) => p.ProjectID === projectId);
  assert.equal(project.BrochureMigration.status, 'failed');

  await withMockedDownloader(
    async () => pdfStreamResult(PDF_BYTES),
    () => withMockedStorage(backend, () => svc.retryFailed({ batchSize: 1 }))
  );

  project = repository.read().BuilderProjects.find((p) => p.ProjectID === projectId);
  assert.equal(project.BrochureMigration.status, 'success');
  assert.equal(project.BrochureMigration.attempts, 2);
  assert.equal(project.Brochures.length, 1, 'no duplicate Brochures[] entries after retry');
});

test('idempotent second run: already-migrated project is skipped, no re-download, no duplicate objects', async () => {
  const repository = new JsonRepository(makeDbFile());
  const projectId = seedProject(repository);
  const svc = new BrochureMigrationService(repository);
  const backend = fakeStorageBackend();
  let downloadCount = 0;

  const trackedDownloader = async () => {
    downloadCount += 1;
    return pdfStreamResult(PDF_BYTES);
  };

  await withMockedDownloader(trackedDownloader, () => withMockedStorage(backend, () => svc.runBatch({ batchSize: 1 })));
  assert.equal(downloadCount, 1);

  // Second run: project is no longer "eligible" (status=success), so the batch
  // should find nothing left to process.
  const second = await withMockedDownloader(trackedDownloader, () => withMockedStorage(backend, () => svc.runBatch({ batchSize: 5 })));
  assert.equal(downloadCount, 1, 'must not re-download an already-migrated brochure');
  assert.equal(second.data.processed, 0);

  const project = repository.read().BuilderProjects.find((p) => p.ProjectID === projectId);
  assert.equal(project.Brochures.length, 1, 'no duplicate Brochures[] entries on idempotent re-run');
  assert.equal(backend.store.size, 1, 'no duplicate objects created in storage');
});

test('duplicate prevention: deterministic storage key stays stable across attempts', () => {
  const repository = new JsonRepository(makeDbFile());
  const projectId = seedProject(repository);
  const svc = new BrochureMigrationService(repository);
  const project = repository.read().BuilderProjects.find((p) => p.ProjectID === projectId);
  const keyA = svc._storageKeyFor(project);
  const keyB = svc._storageKeyFor(project);
  assert.equal(keyA, keyB);
  assert.match(keyA, new RegExp(`^builder-projects/${projectId}/brochures/migrated-`));
});

test('getStats reports totals/pending/successful/failed/remaining correctly', async () => {
  const repository = new JsonRepository(makeDbFile());
  seedProject(repository); // pending
  const failedId = seedProject(repository);
  const svc = new BrochureMigrationService(repository);

  await withMockedDownloader(async () => ({ ok: false, error: 'HTTP 500' }), () => svc.runBatch({ batchSize: 1 }));

  const stats = svc.getStats();
  assert.equal(stats.data.totalEligible, 2);
  assert.equal(stats.data.failed, 1);
  assert.equal(stats.data.pending, 1);
  assert.equal(stats.data.remaining, 2, 'failed items remain retryable and count as remaining');
  void failedId;
});

// ── stalled-migration timeout guard ─────────────────────────────────────

test('a stalled migration fails via timeout instead of hanging forever', async () => {
  const repository = new JsonRepository(makeDbFile());
  const projectId = seedProject(repository);
  const svc = new BrochureMigrationService(repository);

  const out = await withKeepAlive(withMockedDownloader(
    () => new Promise(() => {}), // never settles — simulates a stalled GridFS/download op
    () => svc.runBatch({ batchSize: 1, timeoutMs: 50 })
  ));

  assert.equal(out.ok, true);
  assert.equal(out.data.failed, 1);
  assert.match(out.data.results[0].error, /timed out/i);

  const project = repository.read().BuilderProjects.find((p) => p.ProjectID === projectId);
  assert.equal(project.BrochureMigration.status, 'failed');
  assert.equal(project.BrochureUrl, 'https://cdn.example.com/brochures/test-towers.pdf', 'original URL must survive a timeout');
  assert.equal((project.Brochures || []).length, 0, 'a timed-out migration must not add a Brochures[] entry');
});

test('migrationLock is released after a timeout and a subsequent migration can run', async () => {
  const repository = new JsonRepository(makeDbFile());
  const projectId = seedProject(repository);
  const svc = new BrochureMigrationService(repository);

  await withKeepAlive(withMockedDownloader(
    () => new Promise(() => {}),
    () => svc.runBatch({ batchSize: 1, timeoutMs: 50 })
  ));

  const second = await withMockedDownloader(
    async () => pdfStreamResult(PDF_BYTES),
    () => withMockedStorage(fakeStorageBackend(), () => svc.runBatch({ batchSize: 1, timeoutMs: 5000 }))
  );

  assert.equal(second.ok, true, 'the lock must be released so a later batch is not rejected');
  assert.equal(second.data.successful, 1);

  const project = repository.read().BuilderProjects.find((p) => p.ProjectID === projectId);
  assert.equal(project.BrochureMigration.status, 'success');
  assert.equal((project.Brochures || []).filter((b) => b.Source === 'migration').length, 1, 'no duplicate entry after timeout then retry');
});

test('a late-completing migration cannot commit state after the timeout already failed it', async () => {
  const repository = new JsonRepository(makeDbFile());
  const projectId = seedProject(repository);
  const svc = new BrochureMigrationService(repository);
  const backend = fakeStorageBackend();

  let releaseSlowDownload;
  const slowGate = new Promise((resolve) => { releaseSlowDownload = resolve; });

  const runPromise = withMockedDownloader(
    async () => { await slowGate; return pdfStreamResult(PDF_BYTES); },
    () => withMockedStorage(backend, async () => {
      const out = await svc.runBatch({ batchSize: 1, timeoutMs: 50 });
      releaseSlowDownload();          // let the abandoned run finish after the timeout
      await new Promise((r) => setTimeout(r, 100));
      return out;
    })
  );

  const out = await withKeepAlive(runPromise, 150);
  assert.equal(out.data.failed, 1, 'the batch must report the timeout failure');

  const project = repository.read().BuilderProjects.find((p) => p.ProjectID === projectId);
  assert.equal(project.BrochureMigration.status, 'failed', 'a late completion must not flip status to success');
  assert.equal(project.BrochureMigration.storageKey, null);
  assert.equal(project.BrochureMigration.storageUrl, null);
  assert.equal((project.Brochures || []).length, 0, 'a late completion must not append a Brochures[] entry');
  assert.equal(project.BrochureUrl, 'https://cdn.example.com/brochures/test-towers.pdf');
  assert.equal(backend.store.size, 0, 'a vetoed late upload must be cleaned up from storage');
});

// ── targeted single-project canary mode (projectId) ─────────────────────

test('targeted projectId selects exactly the requested project, ignoring other eligible candidates', async () => {
  const repository = new JsonRepository(makeDbFile());
  const zoverraId = seedProject(repository, { ProjectName: 'RAJHANS ZOVERRA', BrochureMigration: { status: 'failed', attempts: 3, error: 'Content-Length exceeds max' } });
  const nexoraId = seedProject(repository, { ProjectName: 'RAJHANS NEXORA' });
  const svc = new BrochureMigrationService(repository);
  const backend = fakeStorageBackend();

  const out = await withMockedDownloader(
    async () => pdfStreamResult(PDF_BYTES),
    () => withMockedStorage(backend, () => svc.runBatch({ batchSize: 1, projectId: nexoraId }))
  );

  assert.equal(out.ok, true);
  assert.equal(out.data.processed, 1);
  assert.equal(out.data.results.length, 1);
  assert.equal(out.data.results[0].projectId, nexoraId);

  const db = repository.read();
  const nexora = db.BuilderProjects.find((p) => p.ProjectID === nexoraId);
  const zoverra = db.BuilderProjects.find((p) => p.ProjectID === zoverraId);
  assert.equal(nexora.BrochureMigration.status, 'success');
  assert.equal(zoverra.BrochureMigration.status, 'failed', 'the failed project must never be selected when targeting another projectId');
  assert.equal(zoverra.BrochureMigration.attempts, 3, 'targeting another project must not touch the failed project at all');
});

test('failed RAJHANS ZOVERRA cannot be selected via batch mode when targeting NEXORA by projectId', async () => {
  const repository = new JsonRepository(makeDbFile());
  seedProject(repository, { ProjectName: 'RAJHANS ZOVERRA', BrochureMigration: { status: 'failed', attempts: 1, error: 'Content-Length exceeds max' } });
  const nexoraId = seedProject(repository, { ProjectName: 'RAJHANS NEXORA' });
  const svc = new BrochureMigrationService(repository);

  const out = await withMockedDownloader(
    async () => pdfStreamResult(PDF_BYTES),
    () => withMockedStorage(fakeStorageBackend(), () => svc.runBatch({ batchSize: 5, projectId: nexoraId }))
  );

  assert.equal(out.data.processed, 1);
  assert.equal(out.data.results[0].projectId, nexoraId);
});

test('missing projectId preserves existing batch behavior exactly', async () => {
  const repository = new JsonRepository(makeDbFile());
  const idA = seedProject(repository);
  const idB = seedProject(repository);
  const svc = new BrochureMigrationService(repository);

  const out = await withMockedDownloader(
    async () => pdfStreamResult(PDF_BYTES),
    () => withMockedStorage(fakeStorageBackend(), () => svc.runBatch({ batchSize: 5 }))
  );

  assert.equal(out.data.processed, 2);
  const processedIds = out.data.results.map((r) => r.projectId).sort();
  assert.deepEqual(processedIds, [idA, idB].sort());
});

test('invalid/nonexistent projectId is rejected with 404', async () => {
  const repository = new JsonRepository(makeDbFile());
  const svc = new BrochureMigrationService(repository);

  const out = await svc.runBatch({ batchSize: 1, projectId: 'BLDP-does-not-exist' });
  assert.equal(out.ok, false);
  assert.equal(out.statusCode, 404);
  assert.match(out.error, /not found/i);
});

test('inactive targeted project is rejected with 400', async () => {
  const repository = new JsonRepository(makeDbFile());
  const inactiveId = seedProject(repository, { Active: false });
  const svc = new BrochureMigrationService(repository);

  const out = await svc.runBatch({ batchSize: 1, projectId: inactiveId });
  assert.equal(out.ok, false);
  assert.equal(out.statusCode, 400);
  assert.match(out.error, /inactive/i);
});

test('targeted project with no external BrochureUrl is rejected with 400', async () => {
  const repository = new JsonRepository(makeDbFile());
  const noBrochureId = seedProject(repository, { BrochureUrl: null });
  const svc = new BrochureMigrationService(repository);

  const out = await svc.runBatch({ batchSize: 1, projectId: noBrochureId });
  assert.equal(out.ok, false);
  assert.equal(out.statusCode, 400);
  assert.match(out.error, /BrochureUrl/i);
});

test('targeted project already migrated successfully is skipped, not reprocessed', async () => {
  const repository = new JsonRepository(makeDbFile());
  const doneId = seedProject(repository, {
    BrochureMigration: { status: 'success', storageKey: 'builder-projects/x/brochures/migrated-x.pdf', storageUrl: '/api/v2/builder-projects/media/MED-1', size: 123 },
    Brochures: [{ MediaID: 'MED-1', Source: 'migration', StoragePath: 'builder-projects/x/brochures/migrated-x.pdf', Size: 123 }]
  });
  const svc = new BrochureMigrationService(repository);
  let downloadCalled = false;

  const out = await withMockedDownloader(async () => { downloadCalled = true; return pdfStreamResult(PDF_BYTES); }, () => svc.runBatch({ batchSize: 1, projectId: doneId }));

  assert.equal(out.ok, true);
  assert.equal(out.data.skipped, 1);
  assert.equal(out.data.processed, 0);
  assert.equal(downloadCalled, false, 'an already-migrated project must never be re-downloaded');
});

test('a second concurrent batch is rejected while one is in-flight (simple lock)', async () => {
  const repository = new JsonRepository(makeDbFile());
  seedProject(repository);
  seedProject(repository);
  const svc = new BrochureMigrationService(repository);

  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });

  const firstRun = withMockedDownloader(async () => {
    await gate;
    return { ok: false, error: 'HTTP 500' };
  }, () => svc.runBatch({ batchSize: 1 }));

  // give the first batch a tick to acquire the lock
  await new Promise((r) => setImmediate(r));
  const secondRun = svc.runBatch({ batchSize: 1 });
  const secondResult = await secondRun;
  assert.equal(secondResult.ok, false);
  assert.match(secondResult.error, /already running/i);

  releaseFirst();
  await firstRun;
});

// ── safeUrlDownloader: SSRF protection ───────────────────────────────────

test('SSRF: rejects loopback/private URLs by default', async () => {
  const targets = [
    'http://127.0.0.1/brochure.pdf',
    'http://localhost/brochure.pdf',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/brochure.pdf',
    'http://192.168.1.1/brochure.pdf'
  ];
  for (const url of targets) {
    const out = await downloadPdfSafely(url, { timeoutMs: 500 });
    assert.equal(out.ok, false, `expected ${url} to be blocked`);
    assert.match(out.error, /blocked|localhost/i);
  }
});

test('SSRF: rejects non-http(s) protocols', async () => {
  const out = await downloadPdfSafely('file:///etc/passwd', { timeoutMs: 500 });
  assert.equal(out.ok, false);
  assert.match(out.error, /http\/https/i);
});

// ── safeUrlDownloader: real HTTP behaviour against a local test server ───
// (uses the explicit, test-only allowPrivateNetworks escape hatch — never
// set by the migration service itself.)

test('downloadPdfSafely: happy path against a real local server', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end(PDF_BYTES);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const out = await downloadPdfSafely(`http://127.0.0.1:${port}/brochure.pdf`, { allowPrivateNetworks: true, timeoutMs: 2000 });
    assert.equal(out.ok, true);
    assert.equal(out.buffer.toString(), PDF_BYTES.toString());
  } finally {
    server.close();
  }
});

test('downloadPdfSafely: rejects a response over the size cap', async () => {
  const bigBody = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(2000, 65)]);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end(bigBody);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const out = await downloadPdfSafely(`http://127.0.0.1:${port}/brochure.pdf`, { allowPrivateNetworks: true, maxBytes: 100, timeoutMs: 2000 });
    assert.equal(out.ok, false);
    assert.match(out.error, /exceed/i);
  } finally {
    server.close();
  }
});

test('downloadPdfSafely: rejects a non-PDF body even with a pdf content-type header', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end('<html>not a pdf</html>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const out = await downloadPdfSafely(`http://127.0.0.1:${port}/brochure.pdf`, { allowPrivateNetworks: true, timeoutMs: 2000 });
    assert.equal(out.ok, false);
    assert.match(out.error, /signature/i);
  } finally {
    server.close();
  }
});

test('downloadPdfSafely: follows redirects up to the limit then gives up', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(302, { Location: req.url }); // infinite self-redirect
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const out = await downloadPdfSafely(`http://127.0.0.1:${port}/loop`, { allowPrivateNetworks: true, timeoutMs: 2000 });
    assert.equal(out.ok, false);
    assert.match(out.error, /redirect/i);
  } finally {
    server.close();
  }
});

test('downloadPdfSafely: times out on a slow/hanging server', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    // never write body / never end — simulate a hang
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const out = await downloadPdfSafely(`http://127.0.0.1:${port}/hang`, { allowPrivateNetworks: true, timeoutMs: 300 });
    assert.equal(out.ok, false);
    assert.match(out.error, /timed out/i);
  } finally {
    server.close();
  }
});

test('openPdfStreamSafely: streams a valid PDF without returning a full buffer', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.write(PDF_BYTES.subarray(0, 8));
    res.end(PDF_BYTES.subarray(8));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const out = await openPdfStreamSafely(`http://127.0.0.1:${port}/brochure.pdf`, { allowPrivateNetworks: true, timeoutMs: 2000 });
    assert.equal(out.ok, true);
    assert.equal(out.buffer, undefined, 'streaming API must not expose a full response buffer');
    const body = await collectStream(out.stream);
    assert.equal(body.toString(), PDF_BYTES.toString());
    assert.equal(out.getSize(), PDF_BYTES.length);
  } finally {
    server.close();
  }
});

test('openPdfStreamSafely: enforces max size while streaming', async () => {
  const bigBody = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(2000, 65)]);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end(bigBody);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const out = await openPdfStreamSafely(`http://127.0.0.1:${port}/brochure.pdf`, { allowPrivateNetworks: true, maxBytes: 100, timeoutMs: 2000 });
    assert.equal(out.ok, true);
    await assert.rejects(() => collectStream(out.stream), /exceeded max size/i);
  } finally {
    server.close();
  }
});

test('openPdfStreamSafely: rejects non-PDF magic bytes while streaming', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end('<html>not a pdf</html>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const out = await openPdfStreamSafely(`http://127.0.0.1:${port}/brochure.pdf`, { allowPrivateNetworks: true, timeoutMs: 2000 });
    assert.equal(out.ok, true);
    await assert.rejects(() => collectStream(out.stream), /signature validation/i);
  } finally {
    server.close();
  }
});

// ── admin permission enforcement (targeted + batch run share the same gate) ─

test('the brochure migration admin permission is enforced independently of role labels', () => {
  const repository = new JsonRepository(makeDbFile());
  assert.equal(repository.hasPermission({ userId: 'USR-0001', role: 'ADMIN' }, 'BROCHURE_MIGRATION_MANAGE'), true);
  assert.equal(repository.hasPermission({ userId: 'USR-0002', role: 'AGENT' }, 'BROCHURE_MIGRATION_MANAGE'), false);
  assert.equal(repository.hasPermission({ userId: 'USR-0002', role: 'MANAGER' }, 'BROCHURE_MIGRATION_MANAGE'), false);
});
