'use strict';

/**
 * mongoStore — snapshot-based Mongo backing for JsonRepository.
 *
 * The existing repository interface is fully synchronous (read/write). We
 * preserve that by:
 *   1. Loading the entire DB snapshot from Mongo into an in-memory cache
 *      during an async pre-boot phase (initMongo()).
 *   2. Returning that cache from read() (deep-clone-per-call so mutations
 *      by callers don't sneak through until write() commits).
 *   3. Serializing writes into a background persist queue that upserts a
 *      single snapshot document `{ _id: "singleton" }` in the
 *      `db_snapshot` collection.
 *
 * A single-document snapshot keeps migration trivial (no per-collection
 * schema churn) and easily fits under the 16 MB BSON limit for realistic
 * broker CRM sizes (current DB is ~600 KB).
 *
 * Env:
 *   STORAGE_MODE = "mongo" | "json"                (default: json)
 *   MONGO_URL    = "mongodb://localhost:27017"     (required when mongo)
 *   MONGO_DB     = database name                   (default: signature_properties)
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');

function getStorageMode() {
  return String(process.env.STORAGE_MODE || 'json').trim().toLowerCase();
}

function getMongoUrl() {
  return String(process.env.MONGO_URL || '').trim();
}

function getMongoDb() {
  return String(process.env.MONGO_DB || 'signature_properties').trim();
}
const SNAP_COLL    = 'db_snapshot';
const SNAP_ID      = 'singleton';
const MONGO_SOCKET_TIMEOUT_MS  = 45000;
const MONGO_CONNECT_TIMEOUT_MS = 15000;

function redactMongoSecrets(value) {
  if (value == null) return value;
  let redacted = String(value);
  const mongoUrl = getMongoUrl();
  if (mongoUrl) {
    redacted = redacted.replace(mongoUrl, sanitizeMongoUrl(mongoUrl));
  }
  return redacted
    .replace(/(mongodb(?:\+srv)?:\/\/)([^:@/]+)(:[^@/]+)?@/gi, '$1[redacted]@');
}

function sanitizeMongoUrl(url) {
  if (!url) return '(not set)';
  try {
    const parsed = new URL(url);
    const username = parsed.username ? '[redacted]' : '';
    const password = parsed.password ? '[redacted]' : '';
    const auth = username || password ? `${username}:${password}@` : '';
    return `${parsed.protocol}//${auth}${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname || ''}`;
  } catch (error) {
    return url.replace(/(:\/\/)([^:@/]+)(:[^@/]+)?@/i, '$1[redacted]@').replace(/(mongodb\+srv:\/\/)([^:@/]+)(:[^@/]+)?@/i, '$1[redacted]@');
  }
}

function serializeMongoError(error) {
  const reason = error && error.reason;
  const cause = error && error.cause;
  const nestedCause = cause && cause.cause;
  return {
    name: redactMongoSecrets(error && error.name),
    message: redactMongoSecrets(error && error.message),
    code: error && error.code,
    codeName: redactMongoSecrets(error && error.codeName),
    reason: reason ? {
      name: redactMongoSecrets(reason.name),
      message: redactMongoSecrets(reason.message),
      code: reason.code,
      codeName: redactMongoSecrets(reason.codeName),
      type: redactMongoSecrets(reason.type)
    } : undefined,
    cause: cause ? {
      name: redactMongoSecrets(cause.name),
      message: redactMongoSecrets(cause.message),
      code: cause.code,
      codeName: redactMongoSecrets(cause.codeName),
      nestedCause: nestedCause ? {
        name: redactMongoSecrets(nestedCause.name),
        message: redactMongoSecrets(nestedCause.message),
        code: nestedCause.code,
        library: redactMongoSecrets(nestedCause.library),
        reason: redactMongoSecrets(nestedCause.reason)
      } : undefined
    } : undefined,
    stack: redactMongoSecrets(error && error.stack)
  };
}

function writeMongoStderr(line) {
  fs.writeSync(2, `${line}\n`);
}

function logMongoInitializationError(error) {
  const diagnostic = serializeMongoError(error);
  const lines = [
    '[mongo] initialization failed',
    `[mongo] error.name: ${diagnostic.name || '(unknown)'}`,
    `[mongo] error.message: ${diagnostic.message || '(none)'}`,
    `[mongo] error.code: ${diagnostic.code == null ? '(none)' : diagnostic.code}`,
    `[mongo] error.codeName: ${diagnostic.codeName || '(none)'}`,
    `[mongo] error.reason: ${diagnostic.reason ? JSON.stringify(diagnostic.reason) : '(none)'}`,
    `[mongo] error.cause: ${diagnostic.cause ? JSON.stringify(diagnostic.cause) : '(none)'}`,
    `[mongo] error.stack: ${diagnostic.stack || '(none)'}`
  ];
  for (const line of lines) {
    writeMongoStderr(line);
  }
}

let _client = null;
let _db = null;
let _cache = null;
let _initialized = false;
let _initPromise = null;
let _initAttempts = 0;
let _clientCreations = 0;
let _writeQueue = Promise.resolve();
let _lastWriteError = null;
let _writeStats = { successes: 0, failures: 0, lastWriteAt: null };
let _lastLocalWriteAt = 0;
let _pollTimer = null;
const POLL_INTERVAL_MS = 2000;

function isEnabled() {
  return getStorageMode() === 'mongo' && !!getMongoUrl();
}

function isInitialized() {
  return _initialized;
}

/**
 * Returns the already-connected Mongo `Db` handle (same client/connection
 * used for the db_snapshot document), or null if Mongo mode isn't
 * initialized. Lets other modules (e.g. GridFS object storage) reuse the
 * existing connection instead of opening a second MongoClient.
 */
function getDb() {
  return _initialized ? _db : null;
}

/**
 * Async init — connect to Mongo, load the snapshot into memory. If Mongo
 * is empty, seed from the JSON file (if present) so the first-time
 * migration is transparent. Must be awaited before `.listen()` starts.
 */
async function initMongo(fallbackJsonPath) {
  if (!isEnabled()) return { skipped: true, reason: 'STORAGE_MODE!=mongo or missing MONGO_URL' };
  if (_initialized) return { skipped: true, reason: 'already initialized' };
  if (_initPromise) return _initPromise;

  _initPromise = initMongoOnce(fallbackJsonPath).catch((error) => {
    _initPromise = null;
    throw error;
  });
  return _initPromise;
}

async function initMongoOnce(fallbackJsonPath) {
  _initAttempts += 1;
  const mongoUrl = getMongoUrl();
  const mongoDb = getMongoDb();

  console.log('[mongo] initialization starting');
  console.log('[mongo] target URL:', sanitizeMongoUrl(mongoUrl));

  try {
    console.log('[mongo] connection attempt');
    _clientCreations += 1;
    const mongoOptions = {
      serverSelectionTimeoutMS: 15000,
      // Bounds an already-connected socket: without it a stalled GridFS
      // read/write can stay pending forever and never reject.
      socketTimeoutMS: MONGO_SOCKET_TIMEOUT_MS,
      connectTimeoutMS: MONGO_CONNECT_TIMEOUT_MS,
      retryWrites: true,
      readPreference: 'primary'
    };
    if (/^mongodb\+srv:/i.test(mongoUrl) || /[?&](?:tls|ssl)=true(?:&|$)/i.test(mongoUrl)) {
      mongoOptions.tls = true;
      mongoOptions.tlsAllowInvalidCertificates = false;
      mongoOptions.tlsAllowInvalidHostnames = false;
    }
    _client = new MongoClient(mongoUrl, mongoOptions);
    try {
      await _client.connect();
    } catch (error) {
      _lastWriteError = error;
      logMongoInitializationError(error);
      throw error;
    }
    console.log('[mongo] connection successful');
    _db = _client.db(mongoDb);
    console.log('[mongo] database selected:', mongoDb);

    const snap = await _db.collection(SNAP_COLL).findOne({ _id: SNAP_ID });
    if (snap && snap.payload) {
      _cache = snap.payload;
      _initialized = true;
      console.log('[mongo] initialization complete');
      startPolling();
      return { ok: true, source: 'mongo', size: JSON.stringify(_cache).length };
    }

    // Fresh install — start with empty cache; JsonRepository.ensureDatabase()
    // will populate seed collections into `write()` which we then persist.
    _cache = {};
    _initialized = true;
    console.log('[mongo] initialization complete');
    startPolling();
    return { ok: true, source: 'fresh', size: 0 };
  } catch (error) {
    _lastWriteError = error;
    if (!_client || _db) {
      logMongoInitializationError(error);
    }
    console.error('[mongo] target URL:', sanitizeMongoUrl(mongoUrl));
    throw error;
  }
}

/**
 * Cross-replica sync: with 2+ app instances sharing one Mongo, each keeps
 * its own in-memory `_cache`. Poll Mongo every POLL_INTERVAL_MS and adopt
 * the snapshot only if it is newer than anything WE wrote recently, so we
 * never clobber our own in-flight write with a stale read from another
 * replica that hasn't caught up yet. Bounds cross-replica staleness to
 * ~POLL_INTERVAL_MS instead of "until this process restarts".
 */
function startPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(async () => {
    if (!_initialized || !_db) return;
    try {
      const snap = await _db.collection(SNAP_COLL).findOne({ _id: SNAP_ID }, { projection: { payload: 1, updatedAt: 1 } });
      if (snap && snap.payload && snap.updatedAt) {
        const snapTime = new Date(snap.updatedAt).getTime();
        if (snapTime > _lastLocalWriteAt) {
          _cache = snap.payload;
        }
      }
    } catch (e) {
      console.error('[mongoStore] poll refresh failed:', e.message);
    }
  }, POLL_INTERVAL_MS);
}

/**
 * Deep-clone the current cache and return it (mirrors JsonRepository.read()).
 * Mutations by callers stay in their local copy until write(db) commits.
 */
function read() {
  if (!_initialized) throw new Error('mongoStore.read() called before initMongo()');
  return JSON.parse(JSON.stringify(_cache));
}

/**
 * Replace the cache and enqueue a persist. Persist runs asynchronously
 * but is chained through _writeQueue so writes never race with each
 * other. Errors are surfaced through _lastWriteError and stats.
 */
function write(db) {
  if (!_initialized) throw new Error('mongoStore.write() called before initMongo()');
  _cache = db;
  _lastLocalWriteAt = Date.now();
  const snapshot = JSON.parse(JSON.stringify(db));
  _writeQueue = _writeQueue.then(async () => {
    try {
      await _db.collection(SNAP_COLL).replaceOne(
        { _id: SNAP_ID },
        { _id: SNAP_ID, payload: snapshot, updatedAt: new Date() },
        { upsert: true }
      );
      _writeStats.successes += 1;
      _writeStats.lastWriteAt = new Date();
      _lastWriteError = null;
    } catch (e) {
      _writeStats.failures += 1;
      _lastWriteError = e;
      console.error('[mongoStore] Write failed:', e.message);
    }
  });
}

/**
 * Await the next flush of the write queue. Call before graceful shutdown.
 */
async function flush() {
  await _writeQueue;
  return { ..._writeStats, lastError: _lastWriteError ? _lastWriteError.message : null };
}

function close() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  if (_client) {
    return _client.close();
  }
  return Promise.resolve();
}

function stats() {
  return {
    enabled: isEnabled(),
    initialized: _initialized,
    initializationInProgress: !!_initPromise && !_initialized,
    initAttempts: _initAttempts,
    clientCreations: _clientCreations,
    cacheSize: _cache ? JSON.stringify(_cache).length : 0,
    ..._writeStats,
    lastError: _lastWriteError ? _lastWriteError.message : null
  };
}

module.exports = {
  isEnabled,
  isInitialized,
  getDb,
  initMongo,
  read,
  write,
  flush,
  close,
  stats,
  MONGO_SOCKET_TIMEOUT_MS,
  MONGO_CONNECT_TIMEOUT_MS
};
