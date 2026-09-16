'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { makeDbFile } = require('./admin-test-utils');
const { ProjectMediaCanaryMigrationService, checksumOf } = require('../src/services/projectMediaCanaryMigrationService');

const PDF_BYTES = Buffer.from('%PDF-1.7\n%canary brochure\n%%EOF');
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 4, 5]);

function seedProject(repository, overrides = {}) {
  const db = repository.read();
  const project = {
    ProjectID: repository.createId('BLDP'),
    ProjectName: 'Canary Tower',
    BuilderName: 'Canary Builder',
    Location1: 'Vesu',
    BrochureUrl: 'https://cdn.example.com/canary.pdf',
    Brochures: [],
    Photos: [{ MediaID: repository.createId('MED'), Filename: 'cover.png', Url: 'https://img.example.com/canary.png', SourceUrl: 'https://img.example.com/canary.png' }],
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

function makeDeps({ readBackMode = 'matching' } = {}) {
  const objectMap = new Map();
  const deps = {
    downloader: {
      async downloadMediaSafely(url, opts = {}) {
        if (String(url).includes('missing')) return { ok: false, error: 'HTTP 404' };
        if (opts.kind === 'pdf') return { ok: true, buffer: PDF_BYTES, contentType: 'application/pdf', size: PDF_BYTES.length };
        if (opts.kind === 'image') return { ok: true, buffer: PNG_BYTES, contentType: 'image/png', size: PNG_BYTES.length };
        return { ok: false, error: 'unsupported kind' };
      }
    },
    objectStorage: {
      BUCKET_NAME: 'signature_objects',
      async findLatestObjectByMetadata(filters = {}) {
        for (const [, value] of objectMap.entries()) {
          if (value.metadata?.checksum === filters.checksum && value.metadata?.mediaType === filters.mediaType) return { ...value };
        }
        return null;
      },
      async putObject(path, buffer, contentType, filename, options = {}) {
        const item = {
          path,
          key: path,
          fileId: `file-${objectMap.size + 1}`,
          size: buffer.length,
          contentType,
          filename,
          metadata: options.metadata || {},
          buffer: Buffer.from(buffer)
        };
        objectMap.set(path, item);
        return { path, key: path, fileId: item.fileId, size: buffer.length, contentType };
      },
      async getObjectInfo(path) {
        const item = objectMap.get(path);
        if (!item) return null;
        return { key: item.key, path: item.path, fileId: item.fileId, size: item.size, contentType: item.contentType, metadata: item.metadata };
      },
      async getObject(path) {
        const item = objectMap.get(path);
        if (!item) throw new Error('Not found');
        if (readBackMode === 'missing') throw new Error('Stored bytes are missing');
        if (readBackMode === 'corrupt') {
          return { buffer: Buffer.from('corrupted-gridfs-bytes'), contentType: item.contentType, size: item.size };
        }
        return { buffer: Buffer.from(item.buffer), contentType: item.contentType, size: item.size };
      },
      async deleteObject(path) {
        objectMap.delete(path);
      }
    }
  };
  return { ...deps, objectMap };
}

test('canary migration stores brochure + image metadata and preserves project identity/count', async () => {
  const repository = new JsonRepository(makeDbFile('sig-canary-media-'));
  const projectId = seedProject(repository);
  const deps = makeDeps();
  const svc = new ProjectMediaCanaryMigrationService(repository, deps);

  const before = repository.read();
  const beforeCount = (before.BuilderProjects || []).length;
  const out = await svc.migrateProject({ projectId, userId: 'USR-ADMIN' });
  assert.equal(out.ok, true);
  assert.equal(out.data.projectId, projectId);
  assert.equal(out.data.brochuresFound, 1);
  assert.equal(out.data.brochuresStored, 1);
  assert.equal(out.data.imagesFound, 1);
  assert.equal(out.data.imagesStored, 1);
  assert.equal(out.data.projectCountBefore, beforeCount);
  assert.equal(out.data.projectCountAfter, beforeCount);
  assert.equal(out.data.referencesUpdated, true);
  assert.equal(out.data.verified, true);

  const after = repository.read();
  const project = after.BuilderProjects.find((row) => row.ProjectID === projectId);
  assert.equal(project.ProjectID, projectId);
  assert.equal(project.BrochureUrl, 'https://cdn.example.com/canary.pdf');
  assert.equal(project.Brochures[0].originalUrl, 'https://cdn.example.com/canary.pdf');
  assert.equal(project.Brochures[0].downloadStatus, 'downloaded');
  assert.equal(project.Brochures[0].storageType, 'gridfs');
  assert.equal(project.Brochures[0].storageBucket, 'signature_objects');
  assert.equal(project.Brochures[0].verified, true);
  assert.equal(project.Brochures[0].checksum, checksumOf(PDF_BYTES));
  assert.match(project.Brochures[0].Url, new RegExp(`/api/v2/builder-projects/${projectId}/brochure$`));
  assert.equal(project.Photos[0].originalUrl, 'https://img.example.com/canary.png');
  assert.equal(project.Photos[0].downloadStatus, 'downloaded');
  assert.equal(project.Photos[0].mediaType, 'project_image');
  assert.equal(project.Photos[0].mimeType, 'image/png');
  assert.equal(project.Photos[0].checksum, checksumOf(PNG_BYTES));
  assert.equal(project.Photos[0].verified, true);
  assert.match(project.Photos[0].Url, new RegExp(`/api/v2/builder-projects/${projectId}/images/`));
});

test('canary migration fails verification on a mismatching stored checksum and leaves internal asset unset', async () => {
  const repository = new JsonRepository(makeDbFile('sig-canary-checksum-mismatch-'));
  const projectId = seedProject(repository);
  const svc = new ProjectMediaCanaryMigrationService(repository, makeDeps({ readBackMode: 'corrupt' }));

  const out = await svc.migrateProject({ projectId, userId: 'USR-ADMIN' });

  assert.equal(out.ok, false);
  assert.equal(out.statusCode, 422);
  assert.equal(out.data.failed, 2);
  assert.equal(out.data.verified, false);
  assert.equal(out.data.referencesUpdated, false);
  assert.equal(out.data.failures.length, 2);
  assert.match(out.data.failures[0].error, /SHA-256 mismatch/);
  assert.match(out.data.failures[1].error, /SHA-256 mismatch/);
  const project = repository.read().BuilderProjects.find((row) => row.ProjectID === projectId);
  assert.equal(project.Brochures.length, 0);
  assert.equal(project.BrochureUrl, 'https://cdn.example.com/canary.pdf');
  assert.equal(project.Photos[0].Url, 'https://img.example.com/canary.png');
  assert.equal(project.Photos[0].SourceUrl, 'https://img.example.com/canary.png');
});

test('canary migration fails verification when stored bytes are missing and preserves original URL', async () => {
  const repository = new JsonRepository(makeDbFile('sig-canary-missing-bytes-'));
  const projectId = seedProject(repository);
  const svc = new ProjectMediaCanaryMigrationService(repository, makeDeps({ readBackMode: 'missing' }));

  const out = await svc.migrateProject({ projectId, userId: 'USR-ADMIN' });

  assert.equal(out.ok, false);
  assert.equal(out.statusCode, 422);
  assert.equal(out.data.failed, 2);
  assert.equal(out.data.verified, false);
  assert.equal(out.data.referencesUpdated, false);
  assert.equal(out.data.failures.length, 2);
  assert.match(out.data.failures[0].error, /GridFS verification failed: unable to read stored bytes/);
  assert.match(out.data.failures[1].error, /GridFS verification failed: unable to read stored bytes/);
  const project = repository.read().BuilderProjects.find((row) => row.ProjectID === projectId);
  assert.equal(project.Brochures.length, 0);
  assert.equal(project.BrochureUrl, 'https://cdn.example.com/canary.pdf');
  assert.equal(project.Photos[0].Url, 'https://img.example.com/canary.png');
  assert.equal(project.Photos[0].SourceUrl, 'https://img.example.com/canary.png');
});

test('canary migration reuses duplicate checksum content and stays idempotent', async () => {
  const repository = new JsonRepository(makeDbFile('sig-canary-duplicate-'));
  const projectId = seedProject(repository);
  const deps = makeDeps();
  const svc = new ProjectMediaCanaryMigrationService(repository, deps);

  const first = await svc.migrateProject({ projectId, userId: 'USR-ADMIN' });
  assert.equal(first.ok, true);
  assert.equal(first.data.duplicatesReused, 0);

  const second = await svc.migrateProject({ projectId, userId: 'USR-ADMIN' });
  assert.equal(second.ok, true);
  assert.ok(second.data.duplicatesReused >= 2);

  const project = repository.read().BuilderProjects.find((row) => row.ProjectID === projectId);
  assert.equal(project.Brochures.length, 1);
  assert.equal(project.Photos.length, 1);
});

test('one failed media leaves all project references unchanged and cleans newly-created objects', async () => {
  const repository = new JsonRepository(makeDbFile('sig-canary-failure-'));
  const projectId = seedProject(repository, {
    BrochureUrl: 'https://cdn.example.com/missing.pdf',
    Photos: [{ MediaID: 'MED-PHOTO-1', Filename: 'cover.png', Url: 'https://img.example.com/canary.png', SourceUrl: 'https://img.example.com/canary.png' }]
  });
  const deps = makeDeps();
  const svc = new ProjectMediaCanaryMigrationService(repository, deps);
  const before = JSON.parse(JSON.stringify(repository.read().BuilderProjects[0]));

  const out = await svc.migrateProject({ projectId, userId: 'USR-ADMIN' });
  assert.equal(out.ok, false);
  assert.equal(out.statusCode, 422);
  assert.equal(out.data.failed, 1);
  assert.equal(out.data.imagesStored, 1);
  assert.equal(out.data.referencesUpdated, false);
  assert.deepEqual(out.data.cleanupFailures, []);

  const db = repository.read();
  assert.equal((db.BuilderProjects || []).length, 1);
  const project = db.BuilderProjects[0];
  assert.deepEqual(project, before);
  assert.equal(project.BrochureUrl, 'https://cdn.example.com/missing.pdf');
  assert.equal(project.Photos[0].Url, 'https://img.example.com/canary.png');
  assert.equal(project.Photos[0].SourceUrl, 'https://img.example.com/canary.png');
  assert.equal(deps.objectMap.size, 0);
});

test('failed canary never deletes a previously-stored object reused by the attempt', async () => {
  const repository = new JsonRepository(makeDbFile('sig-canary-existing-object-'));
  const projectId = seedProject(repository, {
    Photos: [{ MediaID: 'MED-PHOTO-1', Filename: 'missing.png', Url: 'https://img.example.com/missing.png', SourceUrl: 'https://img.example.com/missing.png' }]
  });
  const deps = makeDeps();
  const existing = await deps.objectStorage.putObject(
    'builder-projects/existing/brochures/existing.pdf',
    PDF_BYTES,
    'application/pdf',
    'existing.pdf',
    { metadata: { checksum: checksumOf(PDF_BYTES), mediaType: 'brochure' } }
  );
  const svc = new ProjectMediaCanaryMigrationService(repository, deps);

  const out = await svc.migrateProject({ projectId, userId: 'USR-ADMIN' });

  assert.equal(out.ok, false);
  assert.equal(out.data.referencesUpdated, false);
  assert.equal(deps.objectMap.has(existing.path), true);
  assert.equal(deps.objectMap.size, 1);
  const project = repository.read().BuilderProjects.find((row) => row.ProjectID === projectId);
  assert.equal(project.Brochures.length, 0);
  assert.equal(project.BrochureUrl, 'https://cdn.example.com/canary.pdf');
  assert.equal(project.Photos[0].Url, 'https://img.example.com/missing.png');
  assert.equal(project.Photos[0].SourceUrl, 'https://img.example.com/missing.png');
});

test('explicit brochure import downloads only the supplied URL and stores verified GridFS metadata', async () => {
  const repository = new JsonRepository(makeDbFile('sig-task11-explicit-'));
  const projectId = seedProject(repository, { BrochureUrl: 'https://legacy.example.com/original.pdf' });
  const deps = makeDeps();
  const svc = new ProjectMediaCanaryMigrationService(repository, deps);

  const out = await svc.importExplicitBrochure({
    projectId,
    brochureUrl: 'https://cdn.example.com/explicit.pdf',
    userId: 'USR-ADMIN'
  });

  assert.equal(out.ok, true);
  assert.equal(out.data.verified, true);
  assert.equal(out.data.referencesUpdated, true);
  assert.equal(out.data.reused, false);
  assert.equal(deps.objectMap.size, 1);

  const project = repository.read().BuilderProjects.find((row) => row.ProjectID === projectId);
  assert.equal(project.BrochureUrl, 'https://legacy.example.com/original.pdf');
  assert.equal(project.Brochures.length, 1);
  const brochure = project.Brochures[0];
  assert.equal(brochure.OriginalUrl, 'https://cdn.example.com/explicit.pdf');
  assert.equal(brochure.Source, 'manual-url');
  assert.equal(brochure.verified, true);
  assert.equal(brochure.storageBucket, 'signature_objects');
  assert.equal(brochure.checksum, checksumOf(PDF_BYTES));
  assert.equal(brochure.sizeBytes, PDF_BYTES.length);
  assert.match(brochure.Url, new RegExp(`/api/v2/builder-projects/${projectId}/brochure$`));

  const stored = deps.objectMap.get(brochure.StoragePath);
  assert.equal(stored.metadata.ProjectID, projectId);
  assert.equal(stored.metadata.OriginalUrl, 'https://cdn.example.com/explicit.pdf');
  assert.equal(stored.metadata.source, 'manual-url');
  assert.equal(stored.metadata.checksum, checksumOf(PDF_BYTES));
});

test('explicit brochure import leaves references unchanged when GridFS read-back checksum fails', async () => {
  const repository = new JsonRepository(makeDbFile('sig-task11-checksum-'));
  const projectId = seedProject(repository);
  const before = JSON.parse(JSON.stringify(repository.read().BuilderProjects[0]));
  const deps = makeDeps({ readBackMode: 'corrupt' });
  const svc = new ProjectMediaCanaryMigrationService(repository, deps);

  const out = await svc.importExplicitBrochure({
    projectId,
    brochureUrl: 'https://cdn.example.com/explicit.pdf',
    userId: 'USR-ADMIN'
  });

  assert.equal(out.ok, false);
  assert.equal(out.statusCode, 422);
  assert.equal(out.data.referencesUpdated, false);
  assert.equal(out.data.verified, false);
  assert.match(out.data.failure, /SHA-256 mismatch/);
  assert.deepEqual(repository.read().BuilderProjects[0], before);
  assert.equal(deps.objectMap.size, 0);
});

test('explicit brochure import does not bypass HTTP 403 and preserves the project', async () => {
  const repository = new JsonRepository(makeDbFile('sig-task11-403-'));
  const projectId = seedProject(repository);
  const before = JSON.parse(JSON.stringify(repository.read().BuilderProjects[0]));
  const deps = makeDeps();
  deps.downloader.downloadMediaSafely = async () => ({ ok: false, error: 'HTTP 403' });
  const svc = new ProjectMediaCanaryMigrationService(repository, deps);

  const out = await svc.importExplicitBrochure({
    projectId,
    brochureUrl: 'https://restricted.example.com/explicit.pdf',
    userId: 'USR-ADMIN'
  });

  assert.equal(out.ok, false);
  assert.equal(out.statusCode, 422);
  assert.match(out.data.failure, /HTTP 403/);
  assert.deepEqual(repository.read().BuilderProjects[0], before);
  assert.equal(deps.objectMap.size, 0);
});

test('repeating explicit brochure import is idempotent and never deletes verified media', async () => {
  const repository = new JsonRepository(makeDbFile('sig-task11-idempotent-'));
  const projectId = seedProject(repository);
  const deps = makeDeps();
  const svc = new ProjectMediaCanaryMigrationService(repository, deps);

  const first = await svc.importExplicitBrochure({
    projectId,
    brochureUrl: 'https://cdn.example.com/explicit.pdf',
    userId: 'USR-ADMIN'
  });
  assert.equal(first.ok, true);
  const projectAfterFirst = repository.read().BuilderProjects.find((row) => row.ProjectID === projectId);
  const storagePath = projectAfterFirst.Brochures[0].StoragePath;
  const storedBefore = deps.objectMap.get(storagePath);

  let downloadCalls = 0;
  deps.downloader.downloadMediaSafely = async () => {
    downloadCalls += 1;
    return { ok: false, error: 'HTTP 403' };
  };
  const second = await svc.importExplicitBrochure({
    projectId,
    brochureUrl: 'https://cdn.example.com/explicit.pdf',
    userId: 'USR-ADMIN'
  });

  assert.equal(second.ok, true);
  assert.equal(second.data.idempotent, true);
  assert.equal(second.data.reused, true);
  assert.equal(downloadCalls, 0);
  assert.equal(deps.objectMap.size, 1);
  assert.equal(deps.objectMap.has(storagePath), true);
  assert.equal(deps.objectMap.get(storagePath), storedBefore);
  assert.equal(repository.read().BuilderProjects.find((row) => row.ProjectID === projectId).Brochures.length, 1);
});
