'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const objectStorage = require('../src/services/objectStorageService');
const mongoStore = require('../src/data/mongoStore');

/**
 * Minimal in-memory fake of the GridFSBucket surface objectStorageService
 * actually uses (find/openUploadStream/openDownloadStream/delete). Lets us
 * unit-test the storage-key/dedup/streaming logic with zero network calls
 * and without touching any real MongoDB instance.
 */
function makeFakeBucket() {
  const files = new Map(); // _id -> { _id, filename, length, metadata, uploadDate, buffer }
  let nextId = 1;

  return {
    _files: files,
    _deletedIds: [],
    _failUploadOnce: false,
    find(query = {}) {
      let rows = Array.from(files.values());
      if (query.filename) rows = rows.filter((f) => f.filename === query.filename);
      return {
        sort() { return this; },
        limit() { return this; },
        async toArray() { return rows.slice().sort((a, b) => b.uploadDate - a.uploadDate); }
      };
    },
    openUploadStream(filename, options = {}) {
      const chunks = [];
      const id = nextId++;
      const writable = new Writable({
        write(chunk, enc, cb) {
          if (this._parent._failUploadOnce) {
            this._parent._failUploadOnce = false;
            cb(new Error('simulated upload failure'));
            return;
          }
          chunks.push(chunk);
          cb();
        }
      });
      writable.id = id;
      writable._parent = this;
      writable.on('finish', () => {
        const buffer = Buffer.concat(chunks);
        files.set(id, {
          _id: id,
          filename,
          length: buffer.length,
          metadata: options.metadata || {},
          uploadDate: Date.now(),
          buffer
        });
      });
      return writable;
    },
    openDownloadStream(id) {
      const file = files.get(id);
      if (!file) {
        const stream = new Readable({ read() {} });
        process.nextTick(() => stream.emit('error', new Error('FileNotFound')));
        return stream;
      }
      return Readable.from(file.buffer);
    },
    async delete(id) {
      this._deletedIds.push(id);
      files.delete(id);
    }
  };
}

test.beforeEach(() => objectStorage.__resetForTests());
test.after(() => objectStorage.__resetForTests());

test('initStorage resolves once a bucket is available', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const bucketName = await objectStorage.initStorage();
  assert.equal(bucketName, objectStorage.BUCKET_NAME);
});

test('initStorage throws a clear error when Mongo is not initialized', async () => {
  await assert.rejects(() => objectStorage.initStorage(), /Mongo connection is not initialized/);
});

test('putObject uploads and preserves content type + key as path', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const buffer = Buffer.from('%PDF-1.4 fake');
  const result = await objectStorage.putObject('builder-projects/P1/brochures/migrated-p1.pdf', buffer, 'application/pdf', 'brochure.pdf');
  assert.equal(result.path, 'builder-projects/P1/brochures/migrated-p1.pdf');
  assert.equal(result.contentType, 'application/pdf');
  assert.equal(result.size, buffer.length);
});

test('putObjectStream uploads streamed chunks and preserves content type + key as path', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const key = 'builder-projects/P1/brochures/migrated-streamed-p1.pdf';
  const readable = Readable.from([Buffer.from('%PDF-'), Buffer.from('1.4 streamed')]);
  const result = await objectStorage.putObjectStream(key, readable, 'application/pdf', 'brochure.pdf');
  assert.equal(result.path, key);
  assert.equal(result.contentType, 'application/pdf');
  assert.equal(result.size, '%PDF-1.4 streamed'.length);

  const out = await objectStorage.getObject(key);
  assert.equal(out.buffer.toString(), '%PDF-1.4 streamed');
});

test('putObjectStream cleans up a partial GridFS upload on stream failure', async () => {
  const bucket = makeFakeBucket();
  bucket._failUploadOnce = true;
  objectStorage.__setBucketForTests(bucket);
  const key = 'builder-projects/P1/brochures/migrated-fail-p1.pdf';

  await assert.rejects(
    () => objectStorage.putObjectStream(key, Readable.from([Buffer.from('%PDF-fail')]), 'application/pdf'),
    /simulated upload failure/
  );

  assert.deepEqual(bucket._deletedIds, [1], 'failed upload stream id must be deleted');
  assert.equal(await objectStorage.objectExists(key), false);
});

test('getObject returns the uploaded buffer and content type', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const key = 'builder-projects/P2/brochures/migrated-p2.pdf';
  const buffer = Buffer.from('%PDF-1.4 hello world');
  await objectStorage.putObject(key, buffer, 'application/pdf');

  const out = await objectStorage.getObject(key);
  assert.equal(out.buffer.toString(), buffer.toString());
  assert.equal(out.contentType, 'application/pdf');
});

test('getObject on a missing key throws a clean not-found error', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  await assert.rejects(() => objectStorage.getObject('does/not/exist.pdf'), /404|not found/i);
});

test('objectExists reports true/false correctly', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const key = 'builder-projects/P3/brochures/migrated-p3.pdf';
  assert.equal(await objectStorage.objectExists(key), false);
  await objectStorage.putObject(key, Buffer.from('%PDF-1.4'), 'application/pdf');
  assert.equal(await objectStorage.objectExists(key), true);
});

test('deleteObject removes the object by exact key only', async () => {
  const bucket = makeFakeBucket();
  objectStorage.__setBucketForTests(bucket);
  const keyA = 'builder-projects/P4/brochures/migrated-p4.pdf';
  const keyB = 'builder-projects/P5/brochures/migrated-p5.pdf';
  await objectStorage.putObject(keyA, Buffer.from('%PDF-A'), 'application/pdf');
  await objectStorage.putObject(keyB, Buffer.from('%PDF-B'), 'application/pdf');

  const out = await objectStorage.deleteObject(keyA);
  assert.equal(out.deleted, 1);
  assert.equal(await objectStorage.objectExists(keyA), false);
  assert.equal(await objectStorage.objectExists(keyB), true, 'unrelated object must not be touched');
});

test('deterministic key: re-uploading the same key overwrites, no duplicates', async () => {
  const bucket = makeFakeBucket();
  objectStorage.__setBucketForTests(bucket);
  const key = 'builder-projects/P6/brochures/migrated-p6.pdf';

  await objectStorage.putObject(key, Buffer.from('%PDF-version-1'), 'application/pdf');
  await objectStorage.putObject(key, Buffer.from('%PDF-version-2-longer-body'), 'application/pdf');

  const filesWithKey = Array.from(bucket._files.values()).filter((f) => f.filename === key);
  assert.equal(filesWithKey.length, 1, 'must never accumulate duplicate GridFS documents for the same key');

  const out = await objectStorage.getObject(key);
  assert.equal(out.buffer.toString(), '%PDF-version-2-longer-body');
});

test('getObjectStream supports streaming (PDF viewing) without buffering the whole file up front', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const key = 'builder-projects/P7/brochures/migrated-p7.pdf';
  const buffer = Buffer.from('%PDF-1.4 streamed content');
  await objectStorage.putObject(key, buffer, 'application/pdf');

  const found = await objectStorage.getObjectStream(key);
  assert.ok(found);
  assert.equal(found.contentType, 'application/pdf');
  assert.equal(found.size, buffer.length);

  const chunks = [];
  for await (const chunk of found.stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), buffer.toString());
});

test('getObjectStream returns null for a missing key (caller maps to 404)', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const found = await objectStorage.getObjectStream('nope.pdf');
  assert.equal(found, null);
});

// ── Mongo client timeout configuration (bounds stalled GridFS ops) ────────

test('mongoStore exposes bounded socket/connect timeouts for stalled operations', () => {
  assert.equal(typeof mongoStore.MONGO_SOCKET_TIMEOUT_MS, 'number');
  assert.equal(typeof mongoStore.MONGO_CONNECT_TIMEOUT_MS, 'number');
  assert.ok(mongoStore.MONGO_SOCKET_TIMEOUT_MS >= 30000 && mongoStore.MONGO_SOCKET_TIMEOUT_MS <= 45000);
  assert.ok(mongoStore.MONGO_SOCKET_TIMEOUT_MS > mongoStore.MONGO_CONNECT_TIMEOUT_MS);
});

test('the MongoClient is constructed with socketTimeoutMS so GridFS cannot hang forever', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/data/mongoStore.js'), 'utf8');
  assert.match(source, /socketTimeoutMS:\s*MONGO_SOCKET_TIMEOUT_MS/);
  assert.match(source, /serverSelectionTimeoutMS:\s*15000/, 'serverSelectionTimeoutMS must remain unchanged');
});
