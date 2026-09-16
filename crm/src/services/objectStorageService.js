'use strict';

/**
 * Object storage client — MongoDB GridFS backend.
 *
 * Public interface is unchanged from the previous Emergent-proxy
 * implementation so existing callers (builder project media, broker
 * profile photo, brochure migration) keep working with no
 * changes: initStorage(), putObject(key, buffer, contentType) and
 * getObject(key) -> { buffer, contentType }.
 *
 * Reuses the already-connected Mongo `Db` from mongoStore (no second
 * MongoClient) and stores binaries in a dedicated `signature_objects`
 * GridFS bucket — completely separate from the `db_snapshot` document.
 */

const { GridFSBucket } = require('mongodb');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const mongoStore = require('../data/mongoStore');

const BUCKET_NAME = 'signature_objects';
const APP_NAME = 'signature-realty'; // kept for interface/backward-compat parity only

let bucket = null;
let bucketOverride = null; // test-only injection point, see __setBucketForTests()

function getBucket() {
  if (bucketOverride) return bucketOverride;
  if (bucket) return bucket;
  const db = mongoStore.getDb();
  if (!db) {
    throw new Error('Object storage unavailable: Mongo connection is not initialized (requires STORAGE_MODE=mongo)');
  }
  bucket = new GridFSBucket(db, { bucketName: BUCKET_NAME });
  return bucket;
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function findByKey(key) {
  const b = getBucket();
  return b.find({ filename: key }).sort({ uploadDate: -1 }).toArray();
}

// Kept for interface compatibility; validates the storage backend is reachable.
async function initStorage() {
  getBucket();
  return BUCKET_NAME;
}

/**
 * Uploads `buffer` under the deterministic logical `key`. Any prior file(s)
 * with the same key are removed first so retries/re-uploads overwrite
 * in place instead of accumulating duplicate GridFS documents.
 */
async function putObject(key, buffer, contentType, filename, options = {}) {
  return putObjectStream(key, Readable.from(buffer), contentType, filename, { ...options, size: buffer.length });
}

async function putObjectStream(key, readable, contentType, filename, options = {}) {
  const b = getBucket();
  const existing = await findByKey(key);
  for (const file of existing) {
    await b.delete(file._id); // deterministic key => at most one live copy
  }

  const uploadStream = b.openUploadStream(key, {
    metadata: {
      contentType: contentType || 'application/octet-stream',
      originalFilename: filename || key,
      uploadedAt: new Date().toISOString(),
      ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {})
    }
  });

  try {
    await pipeline(readable, uploadStream);
  } catch (error) {
    if (uploadStream.id) {
      try { await b.delete(uploadStream.id); } catch (_) {}
    }
    throw error;
  }

  const files = await findByKey(key);
  const file = files[0];
  const size = file?.length ?? options.size ?? null;
  return { path: key, key, size, contentType: contentType || 'application/octet-stream', fileId: file?._id ?? null };
}

/** Returns the full object as a buffer (existing callers' expected shape). */
async function getObject(key) {
  const files = await findByKey(key);
  if (!files.length) throw new Error(`Download failed: HTTP 404 (object not found: ${key})`);
  const file = files[0];
  const buffer = await streamToBuffer(getBucket().openDownloadStream(file._id));
  const contentType = (file.metadata && file.metadata.contentType) || 'application/octet-stream';
  return { buffer, contentType, size: file.length };
}

/** Returns a live download stream + metadata, for efficient HTTP serving (no full buffering). */
async function getObjectStream(key) {
  const files = await findByKey(key);
  if (!files.length) return null;
  const file = files[0];
  const contentType = (file.metadata && file.metadata.contentType) || 'application/octet-stream';
  return { stream: getBucket().openDownloadStream(file._id), contentType, size: file.length, filename: file.metadata?.originalFilename || key };
}

async function getObjectInfo(key) {
  const files = await findByKey(key);
  if (!files.length) return null;
  const file = files[0];
  return {
    key,
    path: key,
    contentType: (file.metadata && file.metadata.contentType) || 'application/octet-stream',
    size: file.length,
    filename: file.metadata?.originalFilename || key,
    uploadDate: file.uploadDate || null,
    fileId: file._id || null,
    metadata: file.metadata || {}
  };
}

async function findLatestObjectByMetadata(filters = {}) {
  const b = getBucket();
  const query = {};
  for (const [key, value] of Object.entries(filters || {})) {
    if (value == null || value === '') continue;
    query[`metadata.${key}`] = value;
  }
  if (!Object.keys(query).length) return null;
  const rows = await b.find(query).sort({ uploadDate: -1 }).toArray();
  if (!rows.length) return null;
  const row = rows[0];
  return {
    key: row.filename,
    path: row.filename,
    fileId: row._id || null,
    contentType: (row.metadata && row.metadata.contentType) || 'application/octet-stream',
    size: row.length,
    filename: row.metadata?.originalFilename || row.filename,
    uploadDate: row.uploadDate || null,
    metadata: row.metadata || {}
  };
}

async function objectExists(key) {
  const files = await findByKey(key);
  return files.length > 0;
}

async function deleteObject(key) {
  const b = getBucket();
  const files = await findByKey(key);
  for (const file of files) await b.delete(file._id);
  return { deleted: files.length };
}

// ── Test-only injection (never used by application code) ───────────────────
function __setBucketForTests(fakeBucket) {
  bucketOverride = fakeBucket;
}
function __resetForTests() {
  bucketOverride = null;
  bucket = null;
}

module.exports = {
  initStorage,
  putObject,
  putObjectStream,
  getObject,
  getObjectStream,
  getObjectInfo,
  findLatestObjectByMetadata,
  objectExists,
  deleteObject,
  APP_NAME,
  BUCKET_NAME,
  __setBucketForTests,
  __resetForTests
};
