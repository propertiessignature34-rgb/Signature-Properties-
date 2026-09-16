const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

const TEST_ADMIN_USER = {
  UserID: 'USR-SYSTEM-ADMIN',
  Name: 'System Administrator',
  Role: 'ADMIN',
  Status: 'Active',
  Permissions: ['*'],
  CompanyID: 'COMP-DEFAULT',
  BrokerageID: 'BRK-DEFAULT'
};

const TEST_MANAGER_USER = {
  UserID: 'USR-SYSTEM-MANAGER',
  Name: 'System Manager',
  Role: 'MANAGER',
  Status: 'Active',
  Permissions: ['REPORTS_VIEW', 'DASHBOARD_VIEW'],
  CompanyID: 'COMP-DEFAULT',
  BrokerageID: 'BRK-DEFAULT'
};

function makeDbFile(prefix = 'sig-admin-test-') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'sig-realty-db.json');
}

function readDbFileSafe(dbFile) {
  try {
    return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  } catch (_) {
    return {};
  }
}

function ensureSeededUsers(dbFile) {
  const db = readDbFileSafe(dbFile);
  db.Users = Array.isArray(db.Users) ? db.Users : [];
  const now = new Date().toISOString();
  const ensureUser = (user) => {
    if (db.Users.some((row) => String(row?.UserID || '') === user.UserID)) return;
    db.Users.push({ ...user, CreatedAt: now, UpdatedAt: now });
  };
  ensureUser(TEST_ADMIN_USER);
  ensureUser(TEST_MANAGER_USER);
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function toHeaderEntries(input) {
  if (!input) return [];
  if (typeof Headers !== 'undefined' && input instanceof Headers) {
    return Array.from(input.entries());
  }
  return Object.entries(input);
}

function toHeaderObjectAndLookup(input) {
  const entries = toHeaderEntries(input);
  const headers = Object.fromEntries(entries);
  const lookup = Object.fromEntries(entries.map(([name, value]) => [String(name).toLowerCase(), value]));
  return { headers, lookup };
}

function cloneHeaders(input) {
  if (typeof Headers !== 'undefined' && input instanceof Headers) {
    return new Headers(input);
  }
  return { ...(input || {}) };
}

function readHeaderLookup(headers) {
  const entries = toHeaderEntries(headers);
  return Object.fromEntries(entries.map(([name, value]) => [String(name).toLowerCase(), value]));
}

function setHeader(headers, name, value) {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.set(name, value);
    return;
  }
  headers[name] = value;
}

function hasHeader(headers, name) {
  const lookup = readHeaderLookup(headers);
  return lookup[String(name).toLowerCase()] !== undefined;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(() => {});
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('Could not allocate a free port'));
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function startServer(dbFile, options = {}) {
  ensureSeededUsers(dbFile);
  const port = options.port || await findFreePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      API_PORT: String(port),
      SIG_REALTY_DB_FILE: dbFile,
      SIG_REALTY_AUTH_STATE_SECRET: options.env?.SIG_REALTY_AUTH_STATE_SECRET || process.env.SIG_REALTY_AUTH_STATE_SECRET || 'test-auth-state-secret',
      SIG_REALTY_TEST_SESSION_TOKEN: options.env?.SIG_REALTY_TEST_SESSION_TOKEN || process.env.SIG_REALTY_TEST_SESSION_TOKEN || 'test-session-secret',
      ...(options.env || {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + (options.timeout || 15000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/public/properties`);
      if (response.ok) {
        return { child, baseUrl, port, getLogs: () => logs.join('') };
      }
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  child.kill('SIGTERM');
  await once(child, 'exit').catch(() => {});
  throw new Error(`Server failed to start\n${logs.join('')}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

async function requestJson(baseUrl, route, options = {}) {
  const headers = cloneHeaders(options.headers);
  let lookup = readHeaderLookup(headers);
  const legacyUserId = String(lookup['x-user-id'] || lookup['x-userid'] || '').trim();
  const hasSessionHeader = Boolean(lookup['x-session-token'] || lookup['x-sessiontoken'] || lookup.authorization || lookup.cookie);
  const wantsSessionAuth = options.sessionAuth === true || String(lookup['x-test-session-auth'] || '').trim() === '1';
  if (wantsSessionAuth && legacyUserId && !hasSessionHeader) {
    try {
      const session = await createSession(baseUrl, {
        userId: legacyUserId,
        secret: lookup['x-test-session-secret'] || process.env.SIG_REALTY_TEST_SESSION_TOKEN || 'test-session-secret'
      });
      setHeader(headers, 'x-session-token', session.token);
      if (session.cookie && !hasHeader(headers, 'cookie')) {
        setHeader(headers, 'Cookie', session.cookie);
      }
      lookup = readHeaderLookup(headers);
    } catch (_) {
      // Keep legacy headers as-is for tests that explicitly validate unauthorized behavior.
    }
  }
  const requestOptions = {
    method: options.method || 'GET',
    headers
  };

  if (options.body !== undefined) {
    requestOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    const hasContentType = Boolean(lookup['content-type']);
    if (!hasContentType) {
      setHeader(headers, 'Content-Type', 'application/json');
    }
  }

  const response = await fetch(`${baseUrl}${route}`, requestOptions);
  const payload = await response.json();
  return { response, payload };
}

function seedUsers() {}

async function createSession(baseUrl, { userId = 'USR-0001', secret = 'test-session-secret' } = {}) {
  const response = await fetch(`${baseUrl}/api/auth/test-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, secret })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok || !payload?.data?.token) {
    throw new Error(`Failed to create test session: ${JSON.stringify(payload)}`);
  }
  const cookie = String(response.headers.get('set-cookie') || '').split(';')[0] || '';
  return { token: payload.data.token, cookie, userId: payload.data.userId };
}

async function sessionHeaders(baseUrl, options = {}) {
  const session = await createSession(baseUrl, options);
  return { 'x-session-token': session.token };
}

function apiFetch(url, options = {}) {
  return fetch(url, options);
}

async function apiFetchAuth(url, options = {}) {
  const requestOptions = { ...options };
  const useDefaultAuth = requestOptions.useDefaultAuth === true;
  delete requestOptions.useDefaultAuth;
  const isHealthProbe = String(url).includes('/health');
  if (isHealthProbe) {
    return fetch(url, requestOptions);
  }
  const headers = cloneHeaders(requestOptions.headers);
  const lookup = readHeaderLookup(headers);
  const hasAuth = Boolean(
    lookup['x-user-id'] ||
    lookup['x-userid'] ||
    lookup['x-session-token'] ||
    lookup['x-sessiontoken'] ||
    lookup.authorization
  );
  if (useDefaultAuth && !hasAuth) {
    try {
      const target = new URL(String(url));
      const baseUrl = `${target.protocol}//${target.host}`;
      const session = await createSession(baseUrl, {
        userId: TEST_ADMIN_USER.UserID,
        secret: process.env.SIG_REALTY_TEST_SESSION_TOKEN || 'test-session-secret'
      });
      setHeader(headers, 'x-session-token', session.token);
      if (session.cookie && !hasHeader(headers, 'cookie')) {
        setHeader(headers, 'Cookie', session.cookie);
      }
    } catch (_) {
      setHeader(headers, 'x-user-id', TEST_ADMIN_USER.UserID);
      setHeader(headers, 'x-user-role', TEST_ADMIN_USER.Role);
    }
  }
  return fetch(url, { ...requestOptions, headers });
}

function adminHeaders(extra = {}) {
  return {
    'x-user-id': TEST_ADMIN_USER.UserID,
    'x-user-role': 'ADMIN',
    'x-test-session-auth': '1',
    ...extra
  };
}

function managerHeaders(extra = {}) {
  return {
    'x-user-id': TEST_MANAGER_USER.UserID,
    'x-user-role': 'MANAGER',
    'x-test-session-auth': '1',
    ...extra
  };
}

module.exports = {
  authenticateHeaders: async (_baseUrl, headers = {}) => headers,
  adminHeaders,
  createSession,
  managerHeaders,
  makeDbFile,
  requestJson,
  sessionHeaders,
  apiFetch,
  apiFetchAuth,
  seedUsers,
  startServer,
  stopServer
};
