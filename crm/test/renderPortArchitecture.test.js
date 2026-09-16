const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const util = require('node:util');

const { JsonRepository } = require('../src/data/repository');
const serverModule = require('../server');
const { makeDbFile, startServer, stopServer } = require('./admin-test-utils');

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
  db.BuilderProjects = [
    {
      ProjectID: 'BLDP-EXISTING-001',
      ProjectName: 'Existing Builder Project',
      CompanyID: 'COMP-001',
      BrokerageID: 'BRK-001',
      CreatedAt: now,
      UpdatedAt: now
    }
  ];
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer(() => {});
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => {
        if (error) return reject(error);
        if (!port) return reject(new Error('Could not allocate free port'));
        resolve(port);
      });
    });
    probe.on('error', reject);
  });
}

test('resolveServerBinding keeps one public listener on Render PORT', () => {
  const binding = serverModule.__test.resolveServerBinding({
    PORT: '10000',
    API_PORT: '8001',
    NODE_ENV: 'production'
  });

  assert.equal(binding.publicHost, '0.0.0.0');
  assert.equal(binding.publicPort, 10000);
  assert.equal(binding.apiPort, 8001);
  assert.equal(binding.hasApiPort, true);
});

test('resolveServerBinding works when API_PORT is unset', () => {
  const binding = serverModule.__test.resolveServerBinding({
    PORT: '10000',
    NODE_ENV: 'production'
  });

  assert.equal(binding.publicHost, '0.0.0.0');
  assert.equal(binding.publicPort, 10000);
  assert.equal(binding.apiPort, null);
  assert.equal(binding.hasApiPort, false);
});

test('startPublicServerListener binds the real HTTP server to Number(PORT) on 0.0.0.0', () => {
  const listenCalls = [];
  const fakeServer = {
    listen(options, callback) {
      listenCalls.push(options);
      if (typeof callback === 'function') callback();
    },
    address() {
      return { address: '0.0.0.0', family: 'IPv4', port: 10000 };
    }
  };
  const originalConsoleLog = console.log;
  const startupLogs = [];
  console.log = (...args) => startupLogs.push(args.map((value) => (
    typeof value === 'string' ? value : util.inspect(value, { depth: null, breakLength: Infinity })
  )).join(' '));

  try {
    const listenOptions = serverModule.__test.startPublicServerListener(
      fakeServer,
      { PORT: '10000', NODE_ENV: 'production' },
      { allowProductionFallback: false }
    );

    assert.equal(listenCalls.length, 1);
    assert.deepEqual(listenCalls[0], { host: '0.0.0.0', port: 10000 });
    assert.equal(typeof listenCalls[0].port, 'number');
    assert.deepEqual(listenOptions, { host: '0.0.0.0', port: 10000 });
    assert.match(startupLogs.join('\n'), /listen:before/);
    assert.match(startupLogs.join('\n'), /listen:ready/);
    assert.match(startupLogs.join('\n'), /processPort: '10000'/);
    assert.match(startupLogs.join('\n'), /actualAddress: \{ address: '0\.0\.0\.0', family: 'IPv4', port: 10000 \}/);
    assert.match(startupLogs.join('\n'), /Signature Properties \(frontend\) running at http:\/\/0\.0\.0\.0:10000/);
  } finally {
    console.log = originalConsoleLog;
  }
});

test('normalizeServerAddress keeps diagnostics shape stable', () => {
  assert.deepEqual(
    serverModule.__test.normalizeServerAddress('/tmp/signature.sock'),
    { address: '/tmp/signature.sock', family: null, port: null }
  );
});

test('parseRequestUrl supports requests without Host header', () => {
  const url = serverModule.__test.parseRequestUrl({
    url: '/health',
    headers: {}
  });

  assert.equal(url.pathname, '/health');
});

test('parseRequestUrl falls back to root URL on malformed input', () => {
  const url = serverModule.__test.parseRequestUrl({
    url: 'http://[::1',
    headers: { host: 'bad host' }
  });

  assert.equal(url.pathname, '/');
});

test('real startup path binds /health on PORT=45678', async () => {
  const dbFile = makeDbFile('sig-render-real-port-');
  seedDb(dbFile);
  const server = await startServer(dbFile, {
    port: 45678,
    env: {
      NODE_ENV: 'production',
      API_PORT: ''
    }
  });

  try {
    const health = await fetch('http://127.0.0.1:45678/health');
    const body = await health.json();
    const logs = server.getLogs();

    assert.equal(server.port, 45678);
    assert.equal(health.status, 200);
    assert.deepEqual(body, { ok: true });
    assert.match(logs, /listen:before \{\s+serverName: 'frontend'/);
    assert.match(logs, /processPort: '45678'/);
    assert.match(logs, /resolvedPort: 45678/);
    assert.match(logs, /resolvedHost: '0\.0\.0\.0'/);
    assert.match(logs, /listen:ready \{/);
    assert.match(logs, /actualAddress: \{ address: '0\.0\.0\.0', family: 'IPv4', port: 45678 \}/);
    assert.match(logs, /Signature Properties \(frontend\) running at http:\/\/0\.0\.0\.0:45678/);
  } finally {
    await stopServer(server.child);
  }
});

test('production startup contract requires PORT when local fallback is disabled', () => {
  assert.throws(
    () => serverModule.__test.resolveServerBinding({ NODE_ENV: 'production', API_PORT: '8001' }, { allowProductionFallback: false }),
    /PORT environment variable is required in production/
  );
});

test('invalid PORT value is rejected', () => {
  assert.throws(
    () => serverModule.__test.resolveServerBinding({ PORT: 'abc', NODE_ENV: 'production' }),
    /Invalid PORT environment variable/
  );
});

test('invalid API_PORT value does not affect public Render binding', () => {
  const binding = serverModule.__test.resolveServerBinding({
    PORT: '10000',
    API_PORT: 'not-a-port',
    NODE_ENV: 'production'
  });

  assert.equal(binding.publicHost, '0.0.0.0');
  assert.equal(binding.publicPort, 10000);
  assert.equal(binding.apiPort, null);
  assert.equal(binding.hasApiPort, true);
});

test('Render startup keeps exactly one public listener when API_PORT is unset', async () => {
  const dbFile = makeDbFile('sig-render-port-');
  seedDb(dbFile);
  const server = await startServer(dbFile, {
    env: {
      NODE_ENV: 'production',
      API_PORT: ''
    }
  });

  try {
    const root = await fetch(`${server.baseUrl}/`, { redirect: 'manual' });
    const health = await fetch(`${server.baseUrl}/health`);
    const rootHtml = await root.text();
    assert.equal(root.status, 200);
    assert.equal(health.status, 200);
    assert.match(rootHtml, /Signature Properties/);
    assert.equal(root.headers.get('set-cookie'), null);

    const login = await fetch(`${server.baseUrl}/login`, { redirect: 'manual' });
    assert.equal(login.status, 302);
    assert.equal(login.headers.get('location'), '/login.html');

    const loginHtml = await fetch(`${server.baseUrl}/login.html`, { redirect: 'follow' });
    const loginHtmlText = await loginHtml.text();
    assert.equal(loginHtml.status, 200);
    assert.doesNotMatch(loginHtmlText, /name="pin"|Open Dashboard/i);

    const apiViaPublic = await fetch(`${server.baseUrl}/api/public/properties`);
    assert.equal(apiViaPublic.status, 200);

    const logs = server.getLogs();
    assert.match(logs, new RegExp(`Signature Properties \\(frontend\\) running at http://0\\.0\\.0\\.0:${server.port}`));
    assert.doesNotMatch(logs, /Signature Properties \(api\) running at http:\/\//);
  } finally {
    await stopServer(server.child);
  }
});

test('API_PORT explicitly set does not replace the public Render listener', async () => {
  const dbFile = makeDbFile('sig-render-single-port-');
  seedDb(dbFile);
  const apiPort = await findFreePort();
  const server = await startServer(dbFile, {
    env: {
      NODE_ENV: 'production',
      API_PORT: String(apiPort)
    }
  });

  try {
    const root = await fetch(`${server.baseUrl}/`, { redirect: 'manual' });
    const health = await fetch(`${server.baseUrl}/health`);
    const apiViaPublic = await fetch(`${server.baseUrl}/api/public/properties`);
    const logs = server.getLogs();

    assert.equal(root.status, 200);
    assert.equal(health.status, 200);
    assert.equal(apiViaPublic.status, 200);
    assert.notEqual(server.port, 8001);
    assert.notEqual(server.port, 10000);
    assert.notEqual(server.port, apiPort);
    assert.match(logs, new RegExp(`Signature Properties \\(frontend\\) running at http://0\\.0\\.0\\.0:${server.port}`));
    assert.match(logs, /API_PORT is set; ignoring separate API listener/);
    assert.doesNotMatch(logs, /Signature Properties \(api\) running at http:\/\//);
    assert.doesNotMatch(logs, /0\.0\.0\.0:8001/);
    assert.doesNotMatch(logs, /0\.0\.0\.0:10000/);
  } finally {
    await stopServer(server.child);
  }
});

test('invalid API_PORT still allows startup on public PORT', async () => {
  const dbFile = makeDbFile('sig-render-invalid-api-port-');
  seedDb(dbFile);
  const server = await startServer(dbFile, {
    env: {
      NODE_ENV: 'production',
      API_PORT: 'not-a-port'
    }
  });

  try {
    const health = await fetch(`${server.baseUrl}/health`);
    const root = await fetch(`${server.baseUrl}/`, { redirect: 'manual' });
    const logs = server.getLogs();

    assert.equal(health.status, 200);
    assert.equal(root.status, 200);
    assert.match(logs, new RegExp(`Signature Properties \\(frontend\\) running at http://0\\.0\\.0\\.0:${server.port}`));
    assert.match(logs, /API_PORT is set; ignoring separate API listener/);
    assert.doesNotMatch(logs, /Signature Properties \(api\) running at http:\/\//);
  } finally {
    await stopServer(server.child);
  }
});
