const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { JsonRepository } = require('../src/data/repository');
const { SignatureRealtyRuntime } = require('../src/runtime/app');
const { AuthService } = require('../src/services/authService');
const { __test: serverTest } = require('../server');
const { makeDbFile } = require('./admin-test-utils');

function seedAuthUser(repository, overrides = {}) {
  const db = repository.read();
  db.Users = db.Users || [];
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

function persistAuthExchangeState(repository, {
  state,
  redirectUri = '',
  nextPath = '/',
  browserFlowId = '',
  expiresAt,
  consumedAt = ''
} = {}) {
  repository.upsertAuthExchangeState({
    stateId: state,
    redirectUri,
    nextPath,
    browserFlowHash: browserFlowId ? crypto.createHash('sha256').update(browserFlowId).digest('hex') : '',
    authMode: redirectUri ? 'google_oauth_code' : 'provider_session',
    issuedAt: new Date().toISOString(),
    expiresAt: expiresAt || new Date(Date.now() + 60_000).toISOString(),
    consumedAt
  });
}

test('authentication context resolves trusted session and ignores client-supplied identity', () => {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  const auth = new AuthService(repository);
  seedAuthUser(repository);

  const token = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });

  const resolved = auth.resolveRequestContext({
    headers: {
      'x-session-token': token,
      'x-user-id': 'FAKE-USER',
      'x-company-id': 'FAKE-COMPANY',
      'x-brokerage-id': 'FAKE-BROKERAGE',
      'x-user-role': 'BROKER',
      'x-user-permissions': 'LEADS_CREATE'
    },
    query: {
      userId: 'FAKE-USER',
      companyId: 'FAKE-COMPANY',
      brokerageId: 'FAKE-BROKERAGE',
      role: 'BROKER',
      permissions: 'LEADS_CREATE'
    }
  });

  assert.equal(resolved.authenticated, true);
  assert.equal(resolved.actorId, 'USR-0001');
  assert.equal(resolved.companyId, 'COMP-001');
  assert.equal(resolved.brokerageId, 'BRK-001');
  assert.equal(resolved.role, 'ADMIN');
  assert.deepEqual(resolved.permissions, ['*']);
});

test('authentication rejects session tokens supplied in the URL query', () => {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  const auth = new AuthService(repository);
  seedAuthUser(repository);

  const token = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });

  const queryToken = auth.resolveRequestContext({
    pathname: '/api/leads',
    query: { token }
  });
  const querySessionToken = auth.resolveRequestContext({
    pathname: '/api/leads',
    query: { sessionToken: token }
  });

  assert.equal(queryToken.authenticated, false);
  assert.equal(queryToken.statusCode, 401);
  assert.equal(querySessionToken.authenticated, false);
  assert.equal(querySessionToken.statusCode, 401);
});

test('authentication denies missing, invalid, disabled and fake identity requests', () => {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  const runtime = new SignatureRealtyRuntime(dbFile);
  const auth = runtime.auth;
  seedAuthUser(repository);

  const missing = runtime.resolveAuthenticatedActor({});
  assert.equal(missing.ok, false);
  assert.equal(missing.statusCode, 401);

  const invalid = runtime.resolveAuthenticatedActor({
    headers: { 'x-session-token': 'INVALID_TOKEN' }
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.statusCode, 401);

  const token = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });

  repository.updateUserStatus('USR-0001', 'Inactive', { userId: 'USR-0001', role: 'ADMIN' });
  const disabled = auth.resolveRequestContext({ headers: { 'x-session-token': token } });
  assert.equal(disabled.authenticated, false);
  assert.equal(disabled.statusCode, 401);

  repository.updateUserStatus('USR-0001', 'Active', { userId: 'USR-0001', role: 'ADMIN' });
  const freshToken = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });

  const fakeUser = auth.resolveRequestContext({
    headers: {
      'x-session-token': freshToken,
      'x-user-id': 'FAKE-USER',
      'x-company-id': 'FAKE-COMPANY',
      'x-brokerage-id': 'FAKE-BROKERAGE',
      'x-user-role': 'BROKER',
      'x-user-permissions': 'LEADS_CREATE'
    }
  });
  assert.equal(fakeUser.authenticated, true);
  assert.equal(fakeUser.actorId, 'USR-0001');
  assert.equal(fakeUser.companyId, 'COMP-001');
  assert.equal(fakeUser.brokerageId, 'BRK-001');
  assert.equal(fakeUser.role, 'ADMIN');
});

test('expired session is rejected even when client identity is spoofed', () => {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  const auth = new AuthService(repository);
  seedAuthUser(repository);

  const token = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });

  const session = auth.sessions.get(token);
  if (session) {
    session.expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
  }

  const expired = auth.resolveRequestContext({
    headers: {
      'x-session-token': token,
      'x-user-id': 'FAKE-USER',
      'x-company-id': 'FAKE-COMPANY',
      'x-brokerage-id': 'FAKE-BROKERAGE',
      'x-user-role': 'BROKER',
      'x-user-permissions': 'LEADS_CREATE'
    },
    query: {
      userId: 'FAKE-USER',
      companyId: 'FAKE-COMPANY',
      brokerageId: 'FAKE-BROKERAGE',
      role: 'BROKER',
      permissions: 'LEADS_CREATE'
    }
  });

  assert.equal(expired.authenticated, false);
  assert.equal(expired.statusCode, 401);
});

test('persisted sessions survive auth service restart and expired persisted sessions are deleted', () => {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  seedAuthUser(repository);

  const auth = new AuthService(repository);
  const token = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });

  const restarted = new AuthService(new JsonRepository(dbFile));
  const restored = restarted.resolveRequestContext({
    headers: { 'x-session-token': token },
    pathname: '/api/auth/me'
  });
  assert.equal(restored.authenticated, true);
  assert.equal(restored.userId, 'USR-0001');

  const expiredSession = restarted.repository.getSession(token);
  restarted.repository.upsertSession({
    ...expiredSession,
    expiresAt: new Date(Date.now() - 60 * 1000).toISOString()
  });
  restarted.sessions.delete(token);

  const expired = restarted.resolveRequestContext({
    headers: { 'x-session-token': token },
    pathname: '/api/auth/me'
  });
  assert.equal(expired.authenticated, false);
  assert.equal(expired.statusCode, 401);
  assert.equal(restarted.repository.getSession(token), null);
});

test('public route remains public and protected route enforces auth', () => {
  const repository = new JsonRepository(makeDbFile());
  const auth = new AuthService(repository);

  assert.equal(auth.isPublicRoute('/api/public/properties'), true);
  assert.equal(auth.isPublicRoute('/api/admin/overview'), false);
  assert.equal(auth.isPublicRoute('/api/reports/summary'), false);

  const publicResult = auth.resolveRequestContext({
    headers: {},
    pathname: '/api/public/properties'
  });
  assert.equal(publicResult.authenticated, true);
  assert.equal(publicResult.public, true);

  const protectedResult = auth.resolveRequestContext({
    headers: {},
    pathname: '/api/admin/overview'
  });
  assert.equal(protectedResult.authenticated, false);
  assert.equal(protectedResult.statusCode, 401);
});

test('Render port binding uses a single public listener on PORT', () => {
  const binding = serverTest.resolveServerBinding({
    NODE_ENV: 'production',
    PORT: '10000',
    API_PORT: '8001'
  });

  assert.equal(binding.publicHost, '0.0.0.0');
  assert.equal(binding.publicPort, 10000);
  assert.equal(binding.apiPort, 8001);
  assert.equal(binding.hasApiPort, true);
  assert.equal(binding.startsSeparateApiListener, false);
});

test('Render port binding falls back to the local development port when PORT is absent', () => {
  const binding = serverTest.resolveServerBinding({});

  assert.equal(binding.publicHost, '0.0.0.0');
  assert.equal(binding.publicPort, 3000);
  assert.equal(binding.apiPort, null);
  assert.equal(binding.hasApiPort, false);
  assert.equal(binding.startsSeparateApiListener, false);
});

test('cross-tenant access is denied by the auth context', () => {
  const dbFile = makeDbFile();
  const repository = new JsonRepository(dbFile);
  const auth = new AuthService(repository);
  seedAuthUser(repository);

  const token = auth.issueSession({
    userId: 'USR-0001',
    companyId: 'COMP-001',
    brokerageId: 'BRK-001',
    role: 'ADMIN',
    permissions: ['*']
  });

  const crossTenant = auth.resolveRequestContext({
    headers: {
      'x-session-token': token,
      'x-company-id': 'COMP-999',
      'x-brokerage-id': 'BRK-999'
    }
  });

  assert.equal(crossTenant.authenticated, true);
  assert.equal(crossTenant.companyId, 'COMP-001');
  assert.equal(crossTenant.brokerageId, 'BRK-001');
});

test('production auth startup requires a non-default state secret', () => {
  assert.doesNotThrow(() => serverTest.validateAuthStartupConfig({
    nodeEnv: 'test',
    authExchangeStateSecret: 'sig-realty-auth-state-dev-secret'
  }));
  assert.throws(() => serverTest.validateAuthStartupConfig({
    nodeEnv: 'production',
    authExchangeStateSecret: 'sig-realty-auth-state-dev-secret'
  }), /SIG_REALTY_AUTH_STATE_SECRET must be set to a non-default value in production/);
  assert.doesNotThrow(() => serverTest.validateAuthStartupConfig({
    nodeEnv: 'production',
    authExchangeStateSecret: 'prod-auth-secret-1234567890abcdef'
  }));
});

test('auth state timeout uses the safer default and accepts overrides', () => {
  assert.equal(serverTest.getAuthExchangeStateMaxAgeSeconds(null, {}), 15 * 60);
  assert.equal(serverTest.getAuthExchangeStateMaxAgeSeconds({
    getSettings: () => ({ Security: { AuthStateTimeoutMinutes: 20 } })
  }, {}), 20 * 60);
  assert.equal(serverTest.getAuthExchangeStateMaxAgeSeconds(null, {
    SIG_REALTY_AUTH_STATE_TIMEOUT_MINUTES: '25'
  }), 25 * 60);
});

test('OAuth auth-state validation pins the redirect URI and reports exact rejection reasons', async () => {
  const repository = new JsonRepository(makeDbFile());
  const redirectUri = serverTest.resolveGoogleOAuthRedirectUrl({ headers: { host: 'app.example.com', 'x-forwarded-proto': 'https' } }, '/clients.html');
  assert.equal(redirectUri, 'https://app.example.com/login.html');

  const cookieMissingState = serverTest.issueAuthExchangeState(redirectUri, 60);
  persistAuthExchangeState(repository, {
    state: cookieMissingState,
    redirectUri,
    browserFlowId: 'browser-flow-cookie-missing'
  });
  const cookieMissing = await serverTest.consumeAuthExchangeState({}, cookieMissingState, redirectUri, { repository });
  assert.equal(cookieMissing.ok, false);
  assert.equal(cookieMissing.reason, 'cookie_missing');

  const cookieMismatchState = serverTest.issueAuthExchangeState(redirectUri, 60);
  persistAuthExchangeState(repository, {
    state: cookieMismatchState,
    redirectUri,
    browserFlowId: 'browser-flow-cookie-mismatch'
  });
  const cookieMismatch = await serverTest.consumeAuthExchangeState({
    cookie: 'sig_auth_state=wrong-state'
  }, cookieMismatchState, redirectUri, {
    repository,
    browserFlowId: 'browser-flow-cookie-mismatch'
  });
  assert.equal(cookieMismatch.ok, false);
  assert.equal(cookieMismatch.reason, 'cookie_mismatch');

  const expiredState = serverTest.issueAuthExchangeState(redirectUri, 0);
  persistAuthExchangeState(repository, {
    state: expiredState,
    redirectUri,
    browserFlowId: 'browser-flow-expired',
    expiresAt: new Date(Date.now() - 1_000).toISOString()
  });
  const expired = await serverTest.consumeAuthExchangeState({
    cookie: `sig_auth_state=${expiredState}`
  }, expiredState, redirectUri, {
    repository,
    browserFlowId: 'browser-flow-expired'
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'state_expired');

  const redirectMismatchState = serverTest.issueAuthExchangeState(redirectUri, 60);
  persistAuthExchangeState(repository, {
    state: redirectMismatchState,
    redirectUri,
    browserFlowId: 'browser-flow-redirect'
  });
  const redirectMismatch = await serverTest.consumeAuthExchangeState({
    cookie: `sig_auth_state=${redirectMismatchState}`
  }, redirectMismatchState, 'https://app.example.com/index.html', {
    repository,
    browserFlowId: 'browser-flow-redirect'
  });
  assert.equal(redirectMismatch.ok, false);
  assert.equal(redirectMismatch.reason, 'redirect_uri_mismatch');

  const signatureInvalidState = `${redirectMismatchState.slice(0, -1)}${redirectMismatchState.endsWith('0') ? '1' : '0'}`;
  const signatureInvalid = await serverTest.consumeAuthExchangeState({
    cookie: `sig_auth_state=${signatureInvalidState}`
  }, signatureInvalidState, redirectUri, {
    repository,
    browserFlowId: 'browser-flow-redirect'
  });
  assert.equal(signatureInvalid.ok, false);
  assert.equal(signatureInvalid.reason, 'signature_invalid');

  const replayState = serverTest.issueAuthExchangeState(redirectUri, 60);
  persistAuthExchangeState(repository, {
    state: replayState,
    redirectUri,
    browserFlowId: 'browser-flow-replay'
  });
  const firstConsume = await serverTest.consumeAuthExchangeState({}, replayState, redirectUri, {
    repository,
    browserFlowId: 'browser-flow-replay'
  });
  assert.equal(firstConsume.ok, true);
  const replay = await serverTest.consumeAuthExchangeState({}, replayState, redirectUri, {
    repository,
    browserFlowId: 'browser-flow-replay'
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, 'state_replayed');
});

test('createUser and updateUser persist canonical user identifiers and tenant scope', () => {
  const repository = new JsonRepository(makeDbFile());
  const created = repository.createUser({
    UserID: ' "USR-CANONICAL" ',
    Name: 'Canonical User',
    Email: 'canonical.user@example.com',
    Mobile: '+910000000009',
    Role: 'agent',
    Status: 'Active',
    Permissions: ['LEADS_READ'],
    CompanyID: ' COMP-009 ',
    BrokerageID: ' BRK-009 '
  }, { userId: 'USR-SYSTEM-ADMIN', role: 'ADMIN' });

  assert.equal(created.ok, true);
  assert.equal(created.data.UserID, 'USR-CANONICAL');
  assert.equal(created.data.CompanyID, 'COMP-009');
  assert.equal(created.data.BrokerageID, 'BRK-009');

  const fetched = repository.getUser(" 'USR-CANONICAL' ");
  assert.equal(fetched?.UserID, 'USR-CANONICAL');
  assert.equal(fetched?.CompanyID, 'COMP-009');
  assert.equal(fetched?.BrokerageID, 'BRK-009');

  const updated = repository.updateUser('usr-canonical', {
    CompanyID: ' COMP-010 ',
    BrokerageID: ' BRK-010 '
  }, { userId: 'USR-SYSTEM-ADMIN', role: 'ADMIN' });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.CompanyID, 'COMP-010');
  assert.equal(updated.data.BrokerageID, 'BRK-010');
  assert.equal(updated.data.BrokerageID, 'BRK-010');
});
