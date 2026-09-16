const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JsonRepository } = require('../src/data/repository');
const { AuthService, SESSION_COOKIE_NAME } = require('../src/services/authService');
const { makeDbFile, startServer, stopServer } = require('./admin-test-utils');

const DB_FILE = makeDbFile('sig-auth-session-flow-');

let provider;
let providerUrl;
let server;

function seedUser(dbFile = DB_FILE, overrides = {}) {
  const repository = new JsonRepository(dbFile);
  const db = repository.read();
  db.Users = Array.isArray(db.Users) ? db.Users.filter((user) => user.UserID !== 'USR-0001') : [];
  db.Users.push({
    UserID: 'USR-0001',
    Name: 'Auth Admin',
    Email: 'auth-admin@example.com',
    Mobile: '+910000000001',
    Role: 'ADMIN',
    Status: 'Active',
    Permissions: ['*'],
    CompanyID: 'COMP-001',
    BrokerageID: 'BRK-001',
    CreatedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString(),
    ...overrides
  });
  repository.write(db);
}

function startProviderStub() {
  provider = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/google/token') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const code = String(payload.get('code') || '').trim();
      if (code === 'valid-google-code') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'token-valid-google-code', token_type: 'Bearer', expires_in: 3600 }));
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad authorization code' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/google/userinfo') {
      const auth = String(req.headers.authorization || '').trim();
      if (auth.startsWith('Bearer ') && auth.endsWith('valid-google-code')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ email: 'auth-admin@example.com', name: 'Auth Admin', email_verified: true }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_token' }));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/auth/v1/env/oauth/session-data') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const sessionId = String(payload.session_id || '').trim();
    if (sessionId === 'valid-session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { email: 'auth-admin@example.com', name: 'Auth Admin' } }));
      return;
    }
    if (sessionId === 'inactive-session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { email: 'inactive@example.com', name: 'Inactive User' } }));
      return;
    }
    if (sessionId === 'bad-shape-session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { user: { name: 'Missing Email' } } }));
      return;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
  });
  return new Promise((resolve, reject) => {
    provider.listen(0, '127.0.0.1', () => {
      const address = provider.address();
      providerUrl = `http://127.0.0.1:${address.port}/auth/v1/env/oauth/session-data`;
      resolve();
    });
    provider.on('error', reject);
  });
}

async function stopProviderStub() {
  if (!provider) return;
  provider.close();
  await once(provider, 'close');
  provider = null;
}

async function request(route, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${server.baseUrl}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_) {
    payload = text;
  }
  return { response, payload, text };
}

function sessionCookieFrom(response) {
  const header = response.headers.get('set-cookie') || '';
  assert.match(header, new RegExp(`${SESSION_COOKIE_NAME}=`));
  assert.match(header, /Path=\//);
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Lax/i);
  assert.match(header, /Max-Age=\d+/);
  return header.split(';', 1)[0];
}

function authFlowCookieHeaderFrom(header) {
  const state = String(header || '').match(/sig_auth_state=[^;]+/i)?.[0];
  const next = String(header || '').match(/sig_auth_next=[^;]+/i)?.[0];
  return [state, next].filter(Boolean).join('; ');
}

function authStateFrom(response) {
  const payload = response.payload || response;
  const header = response.response.headers.get('set-cookie') || '';
  assert.match(header, /sig_auth_state=/);
  assert.match(header, /sig_auth_next=/);
  assert.match(header, /Path=\//);
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Lax/i);
  assert.equal(payload.ok, true);
  assert.match(String(payload.data?.state || ''), /^[a-f0-9]{48}\.\d+(?:\.[a-f0-9]{64}){1,2}$/);
  const signInUrl = new URL(payload.data.signInUrl);
  assert.equal(signInUrl.origin, 'https://auth.emergentagent.com');
  assert.equal(signInUrl.pathname, '/oauth/');
  const providerRedirect = new URL(signInUrl.searchParams.get('redirect'));
  assert.equal(providerRedirect.pathname, '/login.html');
  assert.equal(providerRedirect.searchParams.get('auth_state'), payload.data.state);
  return {
    cookie: authFlowCookieHeaderFrom(header),
    state: payload.data.state,
    browserFlowId: String(payload.data?.browserFlowId || '').trim(),
    redirectUri: String(payload.data?.redirectUri || '').trim()
  };
}

function assertSecurityHeaders(headers, { html = false } = {}) {
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('permissions-policy'), 'camera=(), geolocation=(), microphone=()');
  if (html) {
    assert.equal(headers.get('cross-origin-opener-policy'), 'same-origin');
    const csp = String(headers.get('content-security-policy') || '');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /img-src 'self' data: blob:/);
    assert.match(csp, /connect-src 'self'/);
  } else {
    assert.equal(headers.get('cross-origin-opener-policy'), null);
  }
}

function createFetchResponse({ ok, status, payload }) {
  return {
    ok,
    status: status ?? (ok ? 200 : 500),
    async json() {
      return payload;
    }
  };
}

async function runLoginPageScript({ href, fetchHandlers, initializeStorage }) {
  const loginHtml = fs.readFileSync(path.join(__dirname, '..', 'login.html'), 'utf8');
  const script = loginHtml.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/i)?.[1];
  assert.ok(script, 'Expected inline login script');

  const statusEl = {
    textContent: '',
    className: '',
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
  const signInButton = {
    disabled: false,
    attributes: {},
    listeners: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    }
  };
  const locationUrl = new URL(href);
  let redirectTo = null;
  const location = {
    href: locationUrl.toString(),
    origin: locationUrl.origin,
    pathname: locationUrl.pathname,
    search: locationUrl.search,
    hash: locationUrl.hash,
    replace(value) {
      redirectTo = value;
    }
  };
  let fetchIndex = 0;
  const fetchLog = [];
  const makeStorage = () => {
    const store = new Map();
    return {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      }
    };
  };
  const sessionStorage = makeStorage();
  const localStorage = makeStorage();
  const context = {
    URL,
    URLSearchParams,
    Promise,
    window: { location, sessionStorage, localStorage },
    sessionStorage,
    localStorage,
    history: {
      replaceState(_state, _title, value) {
        const nextUrl = new URL(String(value || ''), location.origin);
        location.href = nextUrl.toString();
        location.pathname = nextUrl.pathname;
        location.search = nextUrl.search;
        location.hash = nextUrl.hash;
      }
    },
    document: {
      getElementById(id) {
        if (id === 'status') return statusEl;
        if (id === 'google-sign-in') return signInButton;
        return null;
      }
    },
    console: { info() {}, warn() {} },
    fetch(url, options) {
      fetchLog.push({ url, options });
      const handler = fetchHandlers[fetchIndex++];
      if (!handler) {
        throw new Error(`Unexpected fetch call for ${url}`);
      }
      return Promise.resolve(typeof handler === 'function' ? handler(url, options) : handler);
    },
    setTimeout(fn) {
      Promise.resolve().then(fn);
      return 0;
    },
    clearTimeout() {}
  };
  if (typeof initializeStorage === 'function') {
    initializeStorage(context);
  }

  vm.createContext(context);
  vm.runInContext(script, context);
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  return { redirectTo, statusEl, signInButton, fetchLog };
}

test.before(async () => {
  seedUser();
  await startProviderStub();
  server = await startServer(DB_FILE, {
    env: {
      SIG_REALTY_AUTH_SESSION_DATA_URL: providerUrl
    }
  });
});

test.after(async () => {
  await stopServer(server?.child);
  await stopProviderStub();
});

test(`session exchange establishes real ${SESSION_COOKIE_NAME} and keeps API auth stable across reload-equivalent requests`, async () => {
  const loginState = authStateFrom(await request('/api/auth/login-state'));
  const exchange = await request('/api/auth/session-exchange', {
    method: 'POST',
    headers: { Cookie: loginState.cookie },
    body: { session_id: 'valid-session', state: loginState.state }
  });
  assert.equal(exchange.response.status, 200);
  assert.equal(exchange.payload.ok, true);
  assert.equal(exchange.payload.data.userId, 'USR-0001');
  const cookie = sessionCookieFrom(exchange.response);

  const me = await request('/api/auth/me', {
    headers: { Cookie: cookie }
  });
  assert.equal(me.response.status, 200);
  assert.equal(me.payload.ok, true);
  assert.equal(me.payload.data.userId, 'USR-0001');
  assert.equal(me.payload.data.role, 'ADMIN');

  const leads = await request('/api/leads', {
    headers: { Cookie: cookie }
  });
  assert.equal(leads.response.status, 200);
  assert.equal(leads.payload.ok, true);

  const requirements = await request('/api/requirements', {
    headers: { Cookie: cookie }
  });
  assert.equal(requirements.response.status, 200);
  assert.equal(requirements.payload.ok, true);

  const clients = await request('/api/v2/clients', {
    headers: { Cookie: cookie }
  });
  assert.equal(clients.response.status, 200);
  assert.equal(clients.payload.ok, true);

  const followups = await request('/api/v2/followups', {
    headers: { Cookie: cookie }
  });
  assert.equal(followups.response.status, 200);
  assert.equal(followups.payload.ok, true);

  const reloadMe = await request('/api/auth/me', {
    headers: { Cookie: cookie }
  });
  assert.equal(reloadMe.response.status, 200);
  assert.equal(reloadMe.payload.ok, true);

  const logout = await request('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  assert.equal(logout.response.status, 200);
  assert.equal(logout.payload.ok, true);

  const postLogout = await request('/api/auth/me', {
    headers: { Cookie: cookie }
  });
  assert.equal(postLogout.response.status, 401);
  assert.equal(postLogout.payload.ok, false);
  assert.equal(postLogout.payload.error, 'Unauthorized');
});

test(`persisted ${SESSION_COOKIE_NAME} remains valid after a full server restart`, async () => {
  const dbFile = makeDbFile('sig-auth-restart-');
  seedUser(dbFile);
  let restartableServer = await startServer(dbFile);
  try {
    const created = await fetch(`${restartableServer.baseUrl}/api/auth/test-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'USR-0001', secret: 'test-session-secret' })
    });
    const createdPayload = await created.json();
    assert.equal(created.status, 200);
    assert.equal(createdPayload.ok, true);
    const cookie = sessionCookieFrom(created);

    await stopServer(restartableServer.child);
    restartableServer = await startServer(dbFile);

    const me = await fetch(`${restartableServer.baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie }
    });
    const payload = await me.json();
    assert.equal(me.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.userId, 'USR-0001');
  } finally {
    await stopServer(restartableServer?.child);
  }
});

test('session exchange never redirects successful auth back to the login page', async () => {
  const loginState = authStateFrom(await request('/api/auth/login-state?next=%2Flogin.html%3Fnext%3D%252Fclients'));
  const exchange = await request('/api/auth/session-exchange', {
    method: 'POST',
    headers: { Cookie: loginState.cookie },
    body: { session_id: 'valid-session', state: loginState.state }
  });
  assert.equal(exchange.response.status, 200);
  assert.equal(exchange.payload.ok, true);
  assert.equal(exchange.payload.data.redirectTo, '/');
});

test('login callback waits for auth session confirmation and then redirects', async () => {
  const result = await runLoginPageScript({
    href: 'https://app.example.com/login.html?next=%2Fclients&code=valid-google-code&state=test-state',
    fetchHandlers: [
      (url, options) => {
        const payload = JSON.parse(String(options?.body || '{}'));
        assert.equal(payload.redirect_uri, 'https://app.example.com/login.html');
        assert.equal(payload.browser_flow_id, 'browser-flow-1');
        return createFetchResponse({
          ok: true,
          payload: { ok: true, data: { redirectTo: '/clients' } }
        });
      },
      createFetchResponse({
        ok: false,
        status: 401,
        payload: { ok: false, error: 'Unauthorized' }
      }),
      createFetchResponse({
        ok: true,
        payload: { ok: true, data: { userId: 'USR-0001' } }
      })
    ],
    initializeStorage(context) {
      context.sessionStorage.setItem('sig_auth_flow', JSON.stringify({ state: 'test-state', browserFlowId: 'browser-flow-1' }));
    }
  });

  assert.equal(result.redirectTo, '/clients');
  assert.equal(result.fetchLog.length, 3);
  assert.equal(result.fetchLog[1].url, '/api/auth/me');
  assert.equal(result.fetchLog[2].url, '/api/auth/me');
});

test('login callback surfaces non-retryable auth confirmation errors without looping', async () => {
  const result = await runLoginPageScript({
    href: 'https://app.example.com/login.html?next=%2Fclients&code=valid-google-code&state=test-state',
    fetchHandlers: [
      (url, options) => {
        const payload = JSON.parse(String(options?.body || '{}'));
        assert.equal(payload.redirect_uri, 'https://app.example.com/login.html');
        assert.equal(payload.browser_flow_id, 'browser-flow-2');
        return createFetchResponse({
          ok: true,
          payload: { ok: true, data: { redirectTo: '/clients' } }
        });
      },
      createFetchResponse({
        ok: false,
        status: 500,
        payload: { ok: false, error: 'Unable to confirm your session right now.' }
      })
    ],
    initializeStorage(context) {
      context.sessionStorage.setItem('sig_auth_flow', JSON.stringify({ state: 'test-state', browserFlowId: 'browser-flow-2' }));
    }
  });

  assert.equal(result.redirectTo, null);
  assert.equal(result.fetchLog.length, 2);
  assert.equal(result.statusEl.textContent, 'Unable to confirm your session right now.');
  assert.equal(result.signInButton.disabled, false);
});

test('auth rejects no cookie, invalid cookie, unknown provider session, malformed provider session, and no-admin-fallback remains disabled', async () => {
  const noCookie = await request('/api/auth/me');
  assert.equal(noCookie.response.status, 401);
  assert.equal(noCookie.payload.error, 'Unauthorized');

  const spoofedHeaders = await request('/api/auth/me', {
    headers: { 'x-user-id': 'USR-0001' }
  });
  assert.equal(spoofedHeaders.response.status, 401);
  assert.equal(spoofedHeaders.payload.error, 'Unauthorized');

  const invalidCookie = await request('/api/auth/me', {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=INVALID_TOKEN` }
  });
  assert.equal(invalidCookie.response.status, 401);
  assert.equal(invalidCookie.payload.error, 'Unauthorized');

  const missingState = await request('/api/auth/session-exchange', {
    method: 'POST',
    body: { session_id: 'valid-session' }
  });
  assert.equal(missingState.response.status, 400);
  assert.equal(missingState.payload.error, 'Invalid auth state');

  const loginState = authStateFrom(await request('/api/auth/login-state'));
  const unknownProviderSession = await request('/api/auth/session-exchange', {
    method: 'POST',
    headers: { Cookie: loginState.cookie },
    body: { session_id: 'wrong-session', state: loginState.state }
  });
  assert.equal(unknownProviderSession.response.status, 401);
  assert.equal(unknownProviderSession.payload.error, 'Unauthorized');

  const malformedState = authStateFrom(await request('/api/auth/login-state'));
  const malformedProviderSession = await request('/api/auth/session-exchange', {
    method: 'POST',
    headers: { Cookie: malformedState.cookie },
    body: { session_id: 'bad-shape-session', state: malformedState.state }
  });
  assert.equal(malformedProviderSession.response.status, 502);
  assert.equal(malformedProviderSession.payload.error, 'Auth provider error: Auth provider response missing email');

  const auth = new AuthService(new JsonRepository(DB_FILE));
  const noFallback = auth.resolveRequestContext({ headers: {}, pathname: '/api/auth/me' });
  assert.equal(noFallback.authenticated, false);
  assert.equal(noFallback.statusCode, 401);
});

test('login bootstrap advertises configured Google sign-in initiation and safe next-path handling', async () => {
  const login = await request('/login.html');
  assert.equal(login.response.status, 200);
  assert.equal(login.response.headers.get('cache-control'), 'no-store');
  assertSecurityHeaders(login.response.headers, { html: true });
  assert.match(login.text, /Sign in with Google/);
  assert.match(login.text, /\/assets\/signature-mark\.svg/);
  assert.doesNotMatch(login.text, /static\.prod-images\.emergentagent\.com/);
  assert.match(login.text, /fetch\(`\/api\/auth\/login-state\?next=\$\{encodeURIComponent\(next\)\}`/);
  assert.match(login.text, /redirect_uri:/);
  assert.match(login.text, /const GOOGLE_REDIRECT_URI = window\.location\.origin \+ '\/login\.html'/);
  assert.match(login.text, /storeAuthFlowArtifacts\(payload\.data\.state, payload\.data\.browserFlowId\)/);
  assert.match(login.text, /browser_flow_id: storedFlow\?\.browserFlowId \|\| ''/);
  assert.match(login.text, /url\.searchParams\.delete\('code'\)/);
  assert.doesNotMatch(login.text, /redirectUrl\.searchParams\.set\('auth_state'/);
  assert.match(login.text, /setAttribute\('aria-live', kind === 'error' \? 'assertive' : 'polite'\)/);
  assert.match(login.text, /setAttribute\('role', kind === 'error' \? 'alert' : 'status'\)/);
  assert.match(login.text, /if \(signInButton\.disabled\) return;/);
  assert.match(login.text, /signInButton\.disabled = !!isBusy/);
  assert.match(login.text, /resolved\.origin !== window\.location\.origin/);
  assert.match(login.text, /!resolved\.pathname\.startsWith\('\/'\)/);
  assert.match(login.text, /normalizedPath === '\/login' \|\| normalizedPath === '\/login\.html'/);
  assert.match(login.text, /params\.get\('session_id'\)[\s\S]*hash\.get\('session_id'\)/);
  assert.match(login.text, /params\.get\('sessionId'\)[\s\S]*hash\.get\('sessionId'\)/);
  assert.match(login.text, /searchParams\.delete\('session_id'\)/);
  assert.match(login.text, /searchParams\.delete\('state'\)/);
  assert.match(login.text, /async function waitForAuthenticatedSession\(attempts = 8, delayMs = 250\)/);
  assert.match(login.text, /if \(r\.status === 401\) return \{ ok: false, retryable: true \};/);
  assert.match(login.text, /const confirmed = await waitForAuthenticatedSession\(\)/);
  assert.match(login.text, /Unable to start sign-in\. Please try again\./);
  assert.match(login.text, /Google sign-in is temporarily unavailable\. Please try again\./);
  assert.match(login.text, /we could not confirm your session\. Please try again\./);
});

test('login-state falls back to the trusted provider OAuth URL when env sign-in URL is misconfigured', async () => {
  const dbFile = makeDbFile('sig-auth-signin-url-');
  seedUser(dbFile);
  const fallbackServer = await startServer(dbFile, {
    env: {
      SIG_REALTY_AUTH_SIGN_IN_URL: 'https://evil.example.com/not-allowed',
      SIG_REALTY_AUTH_SESSION_DATA_URL: providerUrl
    }
  });
  try {
    const response = await fetch(`${fallbackServer.baseUrl}/api/auth/login-state`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    const signInUrl = new URL(payload.data.signInUrl);
    assert.equal(signInUrl.origin, 'https://auth.emergentagent.com');
    assert.equal(signInUrl.pathname, '/oauth/');
    const providerRedirect = new URL(signInUrl.searchParams.get('redirect'));
    assert.equal(providerRedirect.pathname, '/login.html');
    assert.equal(providerRedirect.searchParams.get('auth_state'), payload.data.state);
  } finally {
    await stopServer(fallbackServer.child);
  }
});

test('production-like login-state fails closed when direct Google OAuth is unavailable', async () => {
  const dbFile = makeDbFile('sig-auth-render-');
  seedUser(dbFile);
  const prodLikeServer = await startServer(dbFile, {
    env: {
      NODE_ENV: 'production',
      SIG_REALTY_AUTH_STATE_SECRET: 'production-auth-state-secret',
      SIG_REALTY_AUTH_SESSION_DATA_URL: providerUrl
    }
  });
  try {
    const response = await fetch(`${prodLikeServer.baseUrl}/api/auth/login-state`);
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, 'Google sign-in is not configured');
    assertSecurityHeaders(response.headers);
  } finally {
    await stopServer(prodLikeServer.child);
  }
});

test('direct Google OAuth mode can avoid Emergent sign-in URL and exchange auth code', async () => {
  const dbFile = makeDbFile('sig-auth-google-direct-');
  seedUser(dbFile);
  const googleServer = await startServer(dbFile, {
    env: {
      SIG_REALTY_GOOGLE_CLIENT_ID: 'google-client-id',
      SIG_REALTY_GOOGLE_CLIENT_SECRET: 'google-client-secret',
      SIG_REALTY_GOOGLE_AUTHORIZE_URL: providerUrl.replace('/auth/v1/env/oauth/session-data', '/google/authorize'),
      SIG_REALTY_GOOGLE_TOKEN_URL: providerUrl.replace('/auth/v1/env/oauth/session-data', '/google/token'),
      SIG_REALTY_GOOGLE_USERINFO_URL: providerUrl.replace('/auth/v1/env/oauth/session-data', '/google/userinfo')
    }
  });
  try {
    const loginStateResponse = await fetch(`${googleServer.baseUrl}/api/auth/login-state?next=%2Fclients.html`);
    const loginStatePayload = await loginStateResponse.json();
    assert.equal(loginStateResponse.status, 200);
    assert.equal(loginStatePayload.ok, true);
    assert.equal(loginStatePayload.data.authMode, 'google_oauth_code');
    assertSecurityHeaders(loginStateResponse.headers);
    assert.doesNotMatch(loginStatePayload.data.signInUrl, /auth\.emergentagent\.com/);
    const signInUrl = new URL(loginStatePayload.data.signInUrl);
    assert.equal(signInUrl.pathname, '/google/authorize');
    assert.equal(signInUrl.searchParams.get('client_id'), 'google-client-id');
    assert.equal(signInUrl.searchParams.get('response_type'), 'code');
    const redirectUri = String(signInUrl.searchParams.get('redirect_uri') || '').trim();
    assert.equal(redirectUri, `${googleServer.baseUrl}/login.html`);

    const authStateCookie = authFlowCookieHeaderFrom(loginStateResponse.headers.get('set-cookie') || '');
    const exchange = await fetch(`${googleServer.baseUrl}/api/auth/session-exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authStateCookie
      },
      body: JSON.stringify({
        code: 'valid-google-code',
        state: loginStatePayload.data.state,
        browser_flow_id: loginStatePayload.data.browserFlowId,
        redirect_uri: redirectUri
      })
    });
    const exchangePayload = await exchange.json();
    assert.equal(exchange.status, 200);
    assert.equal(exchangePayload.ok, true);
    assert.equal(exchangePayload.data.userId, 'USR-0001');
    assert.equal(exchangePayload.data.redirectTo, '/clients.html');
    assert.match(String(exchange.headers.get('set-cookie') || ''), new RegExp(`${SESSION_COOKIE_NAME}=`));

    const mismatchStateResponse = await fetch(`${googleServer.baseUrl}/api/auth/login-state?next=%2Fclients.html`);
    const mismatchStatePayload = await mismatchStateResponse.json();
    const mismatchCookie = authFlowCookieHeaderFrom(mismatchStateResponse.headers.get('set-cookie') || '');
    const wrongRedirectUrl = new URL(redirectUri);
    wrongRedirectUrl.pathname = '/index.html';
    const wrongRedirectUri = wrongRedirectUrl.toString();
    const mismatchedExchange = await fetch(`${googleServer.baseUrl}/api/auth/session-exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: mismatchCookie
      },
      body: JSON.stringify({
        code: 'valid-google-code',
        state: mismatchStatePayload.data.state,
        browser_flow_id: mismatchStatePayload.data.browserFlowId,
        redirect_uri: wrongRedirectUri
      })
    });
    const mismatchPayload = await mismatchedExchange.json();
    assert.equal(mismatchedExchange.status, 400);
    assert.equal(mismatchPayload.ok, false);
    assert.equal(mismatchPayload.error, 'Invalid auth state');
  } finally {
    await stopServer(googleServer.child);
  }
});

test('direct Google OAuth callback can succeed without auth-state cookie when browser flow binding matches', async () => {
  const dbFile = makeDbFile('sig-auth-google-cookieless-');
  seedUser(dbFile);
  const googleServer = await startServer(dbFile, {
    env: {
      SIG_REALTY_GOOGLE_CLIENT_ID: 'google-client-id',
      SIG_REALTY_GOOGLE_CLIENT_SECRET: 'google-client-secret',
      SIG_REALTY_GOOGLE_AUTHORIZE_URL: providerUrl.replace('/auth/v1/env/oauth/session-data', '/google/authorize'),
      SIG_REALTY_GOOGLE_TOKEN_URL: providerUrl.replace('/auth/v1/env/oauth/session-data', '/google/token'),
      SIG_REALTY_GOOGLE_USERINFO_URL: providerUrl.replace('/auth/v1/env/oauth/session-data', '/google/userinfo')
    }
  });
  try {
    const loginStateResponse = await fetch(`${googleServer.baseUrl}/api/auth/login-state?next=%2Fclients.html`);
    const loginStatePayload = await loginStateResponse.json();
    const exchange = await fetch(`${googleServer.baseUrl}/api/auth/session-exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: 'valid-google-code',
        state: loginStatePayload.data.state,
        browser_flow_id: loginStatePayload.data.browserFlowId,
        redirect_uri: loginStatePayload.data.redirectUri
      })
    });
    const exchangePayload = await exchange.json();
    assert.equal(exchange.status, 200);
    assert.equal(exchangePayload.ok, true);
    assert.equal(exchangePayload.data.redirectTo, '/clients.html');
  } finally {
    await stopServer(googleServer.child);
  }
});

test('direct Google OAuth rejects cookie mismatch and replay, and state survives a restart before callback', async () => {
  const dbFile = makeDbFile('sig-auth-google-restart-');
  seedUser(dbFile);
  let googleServer = await startServer(dbFile, {
    env: {
      SIG_REALTY_GOOGLE_CLIENT_ID: 'google-client-id',
      SIG_REALTY_GOOGLE_CLIENT_SECRET: 'google-client-secret',
      SIG_REALTY_GOOGLE_AUTHORIZE_URL: providerUrl.replace('/auth/v1/env/oauth/session-data', '/google/authorize'),
      SIG_REALTY_GOOGLE_TOKEN_URL: providerUrl.replace('/auth/v1/env/oauth/session-data', '/google/token'),
      SIG_REALTY_GOOGLE_USERINFO_URL: providerUrl.replace('/auth/v1/env/oauth/session-data', '/google/userinfo')
    }
  });
  try {
    const firstLoginStateResponse = await fetch(`${googleServer.baseUrl}/api/auth/login-state?next=%2Fclients.html`);
    const firstLoginStatePayload = await firstLoginStateResponse.json();
    const wrongCookie = authFlowCookieHeaderFrom(firstLoginStateResponse.headers.get('set-cookie') || '');

    const secondLoginStateResponse = await fetch(`${googleServer.baseUrl}/api/auth/login-state?next=%2Fclients.html`);
    const secondLoginStatePayload = await secondLoginStateResponse.json();
    const mismatchedExchange = await fetch(`${googleServer.baseUrl}/api/auth/session-exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: wrongCookie
      },
      body: JSON.stringify({
        code: 'valid-google-code',
        state: secondLoginStatePayload.data.state,
        browser_flow_id: secondLoginStatePayload.data.browserFlowId,
        redirect_uri: secondLoginStatePayload.data.redirectUri
      })
    });
    const mismatchPayload = await mismatchedExchange.json();
    assert.equal(mismatchedExchange.status, 400);
    assert.equal(mismatchPayload.error, 'Invalid auth state');

    await stopServer(googleServer.child);
    googleServer = await startServer(dbFile, {
      env: {
        SIG_REALTY_GOOGLE_CLIENT_ID: 'google-client-id',
        SIG_REALTY_GOOGLE_CLIENT_SECRET: 'google-client-secret',
        SIG_REALTY_GOOGLE_AUTHORIZE_URL: providerUrl.replace('/auth/v1/env/oauth/session-data', '/google/authorize'),
        SIG_REALTY_GOOGLE_TOKEN_URL: providerUrl.replace('/auth/v1/env/oauth/session-data', '/google/token'),
        SIG_REALTY_GOOGLE_USERINFO_URL: providerUrl.replace('/auth/v1/env/oauth/session-data', '/google/userinfo')
      }
    });

    const exchange = await fetch(`${googleServer.baseUrl}/api/auth/session-exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: 'valid-google-code',
        state: firstLoginStatePayload.data.state,
        browser_flow_id: firstLoginStatePayload.data.browserFlowId,
        redirect_uri: firstLoginStatePayload.data.redirectUri
      })
    });
    const exchangePayload = await exchange.json();
    assert.equal(exchange.status, 200);
    assert.equal(exchangePayload.ok, true);

    const replay = await fetch(`${googleServer.baseUrl}/api/auth/session-exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: 'valid-google-code',
        state: firstLoginStatePayload.data.state,
        browser_flow_id: firstLoginStatePayload.data.browserFlowId,
        redirect_uri: firstLoginStatePayload.data.redirectUri
      })
    });
    const replayPayload = await replay.json();
    assert.equal(replay.status, 400);
    assert.equal(replayPayload.error, 'Invalid auth state');
  } finally {
    await stopServer(googleServer?.child);
  }
});

test('expired session, inactive mapped user, and cross-tenant spoofing stay rejected or constrained', async () => {
  seedUser();
  const repository = new JsonRepository(DB_FILE);
  const auth = new AuthService(repository);
  const token = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });
  auth.sessions.get(token).expiresAt = new Date(Date.now() - 60_000).toISOString();
  const expired = auth.resolveRequestContext({
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    pathname: '/api/auth/me'
  });
  assert.equal(expired.authenticated, false);
  assert.equal(expired.statusCode, 401);

  const crossTenant = auth.resolveRequestContext({
    headers: {
      Cookie: `${SESSION_COOKIE_NAME}=${auth.issueSession({
        userId: 'USR-0001',
        companyId: 'COMP-001',
        brokerageId: 'BRK-001',
        role: 'ADMIN',
        permissions: ['*']
      })}`,
      'x-company-id': 'COMP-999',
      'x-brokerage-id': 'BRK-999'
    },
    pathname: '/api/auth/me'
  });
  assert.equal(crossTenant.authenticated, true);
  assert.equal(crossTenant.companyId, 'COMP-001');
  assert.equal(crossTenant.brokerageId, 'BRK-001');

  const mismatchedState = authStateFrom(await request('/api/auth/login-state'));
  const invalidState = await request('/api/auth/session-exchange', {
    method: 'POST',
    headers: { Cookie: mismatchedState.cookie },
    body: { session_id: 'valid-session', state: 'wrong-state' }
  });
  assert.equal(invalidState.response.status, 400);
  assert.equal(invalidState.payload.error, 'Invalid auth state');

  seedUser(DB_FILE, {
    UserID: 'USR-0009',
    Email: 'inactive@example.com',
    Name: 'Inactive User',
    Status: 'Inactive'
  });
  const inactiveState = authStateFrom(await request('/api/auth/login-state'));
  const inactiveExchange = await request('/api/auth/session-exchange', {
    method: 'POST',
    headers: { Cookie: inactiveState.cookie },
    body: { session_id: 'inactive-session', state: inactiveState.state }
  });
  assert.equal(inactiveExchange.response.status, 403);
  assert.equal(inactiveExchange.payload.error, 'This Google account is not authorized.');
});

test('index bootstrap waits for successful auth, avoids loops, and routes genuine auth failures to login', async () => {
  const dashboard = await request('/index.html');
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.response.headers.get('cache-control'), 'no-store');
  assert.match(dashboard.text, /async function bootstrapAuth\(\)/);
  assert.match(dashboard.text, /async function exchangeSessionFromCallback\(\)/);
  assert.match(dashboard.text, /search\.get\('session_id'\)[\s\S]*hash\.get\('session_id'\)/);
  assert.match(dashboard.text, /search\.get\('sessionId'\)[\s\S]*hash\.get\('sessionId'\)/);
  assert.match(dashboard.text, /searchParams\.delete\('session_id'\)/);
  assert.match(dashboard.text, /searchParams\.delete\('state'\)/);
  assert.match(dashboard.text, /if \(!me \|\| !me\.ok\)/);
  assert.match(dashboard.text, /window\.location\.replace\(`\/login\.html\?next=\$\{next\}&error=session_required`\)/);
  assert.match(dashboard.text, /exchange\.error === 'Invalid auth state'/);
  assert.match(dashboard.text, /auth_provider_unavailable/);
  assert.match(dashboard.text, /bootstrapAuth\(\)\.then\(\(authenticated\) => \{\s*if \(authenticated\) boot\(\);/);
  assert.doesNotMatch(dashboard.text, /boot\(\);[\s\S]*window\.location\.replace\(`\/login\.html\?next=/);
});

test('login page no longer auto-redirects back to dashboard while unauthenticated', async () => {
  const login = await request('/login.html');
  assert.equal(login.response.status, 200);
  assert.match(login.text, /function safeNextPath/);
  assert.doesNotMatch(login.text, /window\.location\.replace\('\/'\);/);
});
