const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const serverModule = require('../server');
const { makeDbFile, startServer, stopServer } = require('./admin-test-utils');
const { JsonRepository } = require('../src/data/repository');

function seedDb(dbFile) {
  new JsonRepository(dbFile);
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const now = new Date().toISOString();
  db.Users = [
    {
      UserID: 'USR-0001',
      Name: 'Primary Agent',
      Mobile: '+910000000001',
      Role: 'AGENT',
      Email: 'agent@example.com',
      Status: 'Active',
      Permissions: ['*'],
      CompanyID: 'COMP-001',
      BrokerageID: 'BRK-001',
      CreatedAt: now,
      UpdatedAt: now
    }
  ];
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

test.afterEach(() => {
  serverModule.__test.resetShutdownStateForTest();
});

test('SIGTERM shutdown clears recurring timers', async () => {
  const timer = serverModule.__test.registerRecurringBackgroundTimer(setInterval(() => {}, 1000));
  serverModule.__test.setAppServerForTest({ listening: false });

  let exitCode = null;
  serverModule.__test.gracefulShutdown('SIGTERM', { exitFn: (code) => { exitCode = code; } });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(serverModule.__test.getRegisteredRecurringTimerCount(), 0);
  assert.equal(serverModule.__test.getGoogleSheetSyncInterval(), null);
  assert.equal(exitCode, 0);
  clearInterval(timer);
});

test('shutdown exits cleanly after server close', () => {
  serverModule.__test.setAppServerForTest({
    listening: true,
    closeAllConnections: () => {},
    closeIdleConnections: () => {},
    close(callback) { callback(); }
  });

  let exitCode = null;
  serverModule.__test.gracefulShutdown('SIGINT', { exitFn: (code) => { exitCode = code; }, forceExitAfterMs: 200 });
  assert.equal(exitCode, 0);
});

test('shutdown forced-exit fallback exists and triggers', async () => {
  serverModule.__test.setAppServerForTest({
    listening: true,
    closeAllConnections: () => {},
    closeIdleConnections: () => {},
    close() {}
  });

  let exitCode = null;
  serverModule.__test.gracefulShutdown('SIGTERM', { exitFn: (code) => { exitCode = code; }, forceExitAfterMs: 20 });
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(serverModule.__test.getShutdownForceExitMs(), 15000);
  assert.equal(exitCode, 1);
});

test('production cannot silently use JSON storage', () => {
  const env = {
    NODE_ENV: 'production',
    RENDER: 'true',
    STORAGE_MODE: 'json',
    MONGO_URL: 'mongodb://localhost:27017',
    MONGO_DB: ''
  };
  const config = serverModule.__test.enforceStorageRuntimeConfig(env);
  assert.equal(config.storageMode, 'mongo');
  assert.equal(env.STORAGE_MODE, 'mongo');
  assert.equal(env.MONGO_DB, 'signature_properties');
});

test('production startup fails with actionable error when MONGO_URL is missing', () => {
  const env = {
    NODE_ENV: 'production',
    RENDER: 'true',
    STORAGE_MODE: 'mongo',
    MONGO_URL: ''
  };
  assert.throws(
    () => serverModule.__test.enforceStorageRuntimeConfig(env),
    /Production\/Render requires MongoDB\. Set MONGO_URL and keep STORAGE_MODE=mongo\./
  );
});

test('/health remains available and fast', async () => {
  const dbFile = makeDbFile('sig-health-fast-');
  seedDb(dbFile);
  const server = await startServer(dbFile);

  try {
    const startedAt = Date.now();
    const response = await fetch(`${server.baseUrl}/health`);
    const elapsedMs = Date.now() - startedAt;
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true });
    assert.ok(elapsedMs < 2000);
  } finally {
    await stopServer(server.child);
  }
});
