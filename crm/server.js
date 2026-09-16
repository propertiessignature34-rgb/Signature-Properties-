require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const crypto = require('node:crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { SignatureRealtyRuntime } = require('./src/runtime/app');
const { V2Router } = require('./src/api/v2Router');
const { SESSION_COOKIE_NAME, getSessionMaxAgeSeconds } = require('./src/services/authService');
const mongoStore = require('./src/data/mongoStore');

const LOCAL_DEV_PORT = 3000;
const PUBLIC_HOST = '0.0.0.0';
const DEFAULT_MONGO_DB = 'signature_properties';
const SHUTDOWN_FORCE_EXIT_MS = 15 * 1000;
const ROOT = __dirname;
const AUTH_EXCHANGE_STATE_COOKIE_NAME = 'sig_auth_state';
const AUTH_NEXT_PATH_COOKIE_NAME = 'sig_auth_next';
const DEFAULT_AUTH_EXCHANGE_STATE_MAX_AGE_SECONDS = 60 * 15;
const DEFAULT_AUTH_EXCHANGE_STATE_SECRET = 'sig-realty-auth-state-dev-secret';
const AUTH_EXCHANGE_STATE_SECRET = String(process.env.SIG_REALTY_AUTH_STATE_SECRET || DEFAULT_AUTH_EXCHANGE_STATE_SECRET).trim();
const DEFAULT_AUTH_SIGN_IN_URL = 'https://auth.emergentagent.com/oauth/';
const DEFAULT_AUTH_SESSION_DATA_URL = 'https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data';
const DEFAULT_GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_GOOGLE_OAUTH_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const MAX_JSON_BODY_BYTES = Math.min(
  Math.max(Number(process.env.SIG_REALTY_MAX_JSON_BODY_BYTES) || 32 * 1024 * 1024, 1024),
  64 * 1024 * 1024
);
const API_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const API_RATE_LIMIT_MAX_REQUESTS = 240;
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const apiRateBuckets = new Map();
const HTML_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "form-action 'self'",
  'upgrade-insecure-requests'
].join('; ');
const activeSockets = new Set();
const recurringBackgroundTimers = new Set();
let runtime;
let v2Router;
let appServer;
let shutdownInProgress = false;
let shutdownCompleted = false;
let shutdownForceExitTimer = null;
let googleSheetSyncInterval = null;
let serverBinding = null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function parsePort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return null;
  }
  return parsed;
}

function buildSecurityHeaders({ includeCsp = false, includeCrossOriginOpenerPolicy = false } = {}) {
  const headers = {
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()'
  };
  if (includeCsp) {
    headers['Content-Security-Policy'] = HTML_CONTENT_SECURITY_POLICY;
  }
  if (includeCrossOriginOpenerPolicy) {
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
  }
  return headers;
}

function withSecurityHeaders(headers = {}, options = {}) {
  return {
    ...buildSecurityHeaders(options),
    ...headers
  };
}

function isProductionLikeRuntime(env = process.env) {
  const renderFlag = String(env.RENDER || '').trim().toLowerCase() === 'true';
  const renderServiceId = String(env.RENDER_SERVICE_ID || '').trim() !== '';
  const renderExternalUrl = String(env.RENDER_EXTERNAL_URL || '').trim() !== '';
  return renderFlag || renderServiceId || renderExternalUrl;
}

function resolveStorageMode(env = process.env) {
  if (isProductionLikeRuntime(env)) {
    return 'mongo';
  }
  const configured = String(env.STORAGE_MODE || '').trim().toLowerCase();
  return configured || 'json';
}

function enforceStorageRuntimeConfig(env = process.env) {
  const storageMode = resolveStorageMode(env);
  env.STORAGE_MODE = storageMode;
  if (!String(env.MONGO_DB || '').trim()) {
    env.MONGO_DB = DEFAULT_MONGO_DB;
  }
  if (isProductionLikeRuntime(env) && !String(env.MONGO_URL || '').trim()) {
    throw new Error('Production/Render requires MongoDB. Set MONGO_URL and keep STORAGE_MODE=mongo.');
  }
  return {
    storageMode,
    mongoDb: String(env.MONGO_DB || DEFAULT_MONGO_DB).trim()
  };
}

function registerRecurringBackgroundTimer(timer) {
  if (timer) {
    recurringBackgroundTimers.add(timer);
  }
  return timer;
}

function clearRecurringBackgroundTimers() {
  for (const timer of [...recurringBackgroundTimers]) {
    clearInterval(timer);
    clearTimeout(timer);
  }
  recurringBackgroundTimers.clear();
  googleSheetSyncInterval = null;
}

function resolveServerBinding(env = process.env, options = {}) {
  const allowProductionFallback = options.allowProductionFallback !== false;
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';
  const publicPortRaw = env.PORT;
  const hasPublicPort = publicPortRaw != null && String(publicPortRaw).trim() !== '';
  const publicPortFromEnv = parsePort(publicPortRaw);
  if (hasPublicPort && !publicPortFromEnv) {
    throw new Error(`Invalid PORT environment variable: ${publicPortRaw}`);
  }
  if (!publicPortFromEnv && isProduction && !allowProductionFallback) {
    throw new Error('PORT environment variable is required in production');
  }

  const publicPort = publicPortFromEnv || LOCAL_DEV_PORT;
  const apiPortRaw = env.API_PORT;
  const hasApiPort = apiPortRaw != null && String(apiPortRaw).trim() !== '';
  const apiPort = hasApiPort ? parsePort(apiPortRaw) : null;

  return {
    publicHost: PUBLIC_HOST,
    publicPort,
    apiPort,
    hasApiPort,
    startsSeparateApiListener: false
  };
}

function resolvePublicListenOptions(env = process.env, options = {}) {
  const binding = resolveServerBinding(env, options);
  return {
    host: binding.publicHost,
    port: binding.publicPort
  };
}

function buildListenDiagnostics(serverName, env, listenOptions) {
  return {
    serverName,
    processPort: env && env.PORT,
    resolvedPort: listenOptions.port,
    resolvedHost: listenOptions.host,
    listenArgs: [listenOptions]
  };
}

function normalizeServerAddress(address) {
  if (!address) return null;
  if (typeof address === 'string') {
    return {
      address,
      family: null,
      port: null
    };
  }
  return {
    address: address.address,
    family: address.family,
    port: address.port
  };
}

function parseRequestUrl(req) {
  const rawUrl = typeof req?.url === 'string' && req.url.trim() ? req.url : '/';
  const host = String(req?.headers?.host || '').trim();
  const baseCandidates = host ? [`http://${host}`, 'http://127.0.0.1'] : ['http://127.0.0.1'];
  for (const base of baseCandidates) {
    try {
      return new URL(rawUrl, base);
    } catch (_) {}
  }
  return new URL('/', 'http://127.0.0.1');
}

function startPublicServerListener(server, env = process.env, options = {}) {
  const listenOptions = resolvePublicListenOptions(env, options);
  const diagnostics = buildListenDiagnostics('frontend', env, listenOptions);
  const onReady = typeof options.onReady === 'function' ? options.onReady : null;
  console.log('[startup] listen:before', diagnostics);
  server.listen(listenOptions, () => {
    const address = typeof server.address === 'function' ? normalizeServerAddress(server.address()) : null;
    console.log('[startup] listen:ready', {
      ...diagnostics,
      actualAddress: address
    });
    console.log(`Signature Properties (frontend) running at http://${listenOptions.host}:${listenOptions.port}`);
    if (onReady) {
      onReady();
    }
  });
  return listenOptions;
}

function buildAuthRequest(req, url) {
  return {
    headers: req.headers || {},
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams.entries())
  };
}

function resolveLegacyHeaderActor(req) {
  const headers = req.headers || {};
  const preferredUserId = String(headers['x-user-id'] || headers['x-userid'] || '').trim();
  if (!preferredUserId) return null;

  const users = typeof runtime?.repository?.listUsers === 'function' ? (runtime.repository.listUsers() || []) : [];
  if (!users.length) return null;

  const user = users.find((item) => String(item?.UserID || '').trim() === preferredUserId);
  if (!user) return null;
  if (String(user?.Status || '').trim().toUpperCase() !== 'ACTIVE') return null;

  return {
    userId: String(user.UserID || '').trim(),
    role: String(user.Role || 'AGENT').trim().toUpperCase(),
    companyId: String(user.CompanyID || user.CompanyId || '').trim(),
    brokerageId: String(user.BrokerageID || user.BrokerageId || '').trim(),
    permissions: Array.isArray(user.Permissions) ? user.Permissions : [],
    user
  };
}

function resolveSessionActor(req, url) {
  const requestUrl = url || new URL(req.url, `http://${req.headers.host}`);
  const authResult = runtime?.resolveAuthenticatedActor?.(buildAuthRequest(req, requestUrl));
  if (authResult?.ok && authResult.actor?.userId) {
    return authResult.actor;
  }
  if (isExplicitTestRuntime() || isLoopbackRequest(req)) {
    return resolveLegacyHeaderActor(req);
  }
  return null;
}

function shapeActor(sessionActor) {
  if (!sessionActor) return null;
  return {
    userId: sessionActor.userId || '',
    role: String(sessionActor.role || 'AGENT').trim().toUpperCase(),
    companyId: sessionActor.companyId || '',
    brokerageId: sessionActor.brokerageId || '',
    permissions: Array.isArray(sessionActor.permissions) ? sessionActor.permissions : [],
    principalType: sessionActor.principalType || '',
    user: sessionActor.user || null
  };
}

function getReportActor(req, url) {
  return shapeActor(resolveSessionActor(req, url));
}

function getReportFilters(url) {
  return {
    datePreset: url.searchParams.get('datePreset') || undefined,
    dateFrom: url.searchParams.get('dateFrom') || undefined,
    dateTo: url.searchParams.get('dateTo') || undefined,
    agentId: url.searchParams.get('agentId') || undefined,
    transactionType: url.searchParams.get('transactionType') || undefined,
    category: url.searchParams.get('category') || undefined,
    location: url.searchParams.get('location') || undefined,
    leadSource: url.searchParams.get('leadSource') || undefined,
    builder: url.searchParams.get('builder') || undefined,
    project: url.searchParams.get('project') || undefined,
    dealStatus: url.searchParams.get('dealStatus') || undefined,
    commissionStatus: url.searchParams.get('commissionStatus') || undefined,
    sortBy: url.searchParams.get('sortBy') || undefined
  };
}

function getAdminActor(req) {
  return shapeActor(resolveSessionActor(req, new URL(req.url, `http://${req.headers.host}`)));
}

function getNetworkActor(req) {
  return shapeActor(resolveSessionActor(req, new URL(req.url, `http://${req.headers.host}`)));
}

function getAuthenticatedActor(req, url) {
  return shapeActor(resolveSessionActor(req, url || new URL(req.url, `http://${req.headers.host}`)));
}

function sendPermissionMissing(res, permission, statusCode = 403) {
  const normalized = String(permission || '').trim() || 'UNKNOWN_PERMISSION';
  sendJson(res, {
    ok: false,
    error: 'PERMISSION_MISSING',
    permission: normalized,
    message: `Permission missing: ${normalized}`
  }, statusCode);
}

function ensureAdminPermissionOrRespond(req, res, url, permission) {
  const actor = getAuthenticatedActor(req, url);
  const auth = runtime.requireAdminPermission(actor || {}, permission);
  if (!auth.ok) {
    const statusCode = auth.statusCode || 403;
    if (statusCode === 403 && actor?.userId) {
      sendPermissionMissing(res, permission, 403);
      return null;
    }
    sendJson(res, { ok: false, error: auth.error }, statusCode);
    return null;
  }
  return auth;
}

function ensurePermissionOrRespond(req, res, url, permission) {
  const actor = getAuthenticatedActor(req, url);
  if (!actor?.userId) {
    sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
    return null;
  }
  const { AccessControlService } = require('./src/services/accessControlService');
  const auth = new AccessControlService(runtime.repository).requirePermissions(actor, [permission]);
  if (!auth.ok) {
    if (auth.statusCode === 403) {
      sendPermissionMissing(res, permission, 403);
    } else {
      sendJson(res, { ok: false, error: auth.error || 'Unauthorized' }, auth.statusCode || 401);
    }
    return null;
  }
  return auth;
}

function rateLimitKey(req, url) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const address = forwarded || req.socket?.remoteAddress || 'unknown';
  return `${address}:${url.pathname}`;
}

function enforceApiRateLimit(req, res, url) {
  if (!url.pathname.startsWith('/api/') || url.pathname === '/health') return true;
  const now = Date.now();
  const key = rateLimitKey(req, url);
  const existing = apiRateBuckets.get(key);
  if (!existing || now - existing.startedAt >= API_RATE_LIMIT_WINDOW_MS) {
    if (apiRateBuckets.size > 5000) {
      for (const [bucketKey, bucket] of apiRateBuckets) {
        if (now - bucket.startedAt >= API_RATE_LIMIT_WINDOW_MS) apiRateBuckets.delete(bucketKey);
      }
    }
    apiRateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  existing.count += 1;
  if (existing.count <= API_RATE_LIMIT_MAX_REQUESTS) return true;
  sendJson(res, {
    ok: false,
    error: 'RATE_LIMITED',
    message: 'Too many requests. Please retry later.'
  }, 429, { 'Retry-After': String(Math.ceil((existing.startedAt + API_RATE_LIMIT_WINDOW_MS - now) / 1000)) });
  return false;
}

function getAuthorizedReportActor(req, res, url, permission = 'REPORTS_VIEW') {
  const actor = getReportActor(req, url);
  if (!actor?.userId) {
    sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
    return null;
  }
  if (permission && !runtime.repository.hasPermission(actor, permission)) {
    sendJson(res, { ok: false, error: 'Forbidden' }, 403);
    return null;
  }
  return actor;
}

function stripSensitiveMedia(row = {}) {
  if (!row || typeof row !== 'object') return row;
  const { StoragePath, ThumbnailPath, Checksum, UploadedBy, CompanyID, BrokerageID, ...safe } = row;
  return safe;
}

function stripSensitiveDocument(row = {}) {
  if (!row || typeof row !== 'object') return row;
  const { StoragePath, Checksum, UploadedBy, CompanyID, BrokerageID, ...safe } = row;
  return safe;
}

function isExplicitTestRuntime() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'test';
}

function isProductionRuntime(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function validateAuthStartupConfig(options = {}) {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const authExchangeStateSecret = String(options.authExchangeStateSecret ?? AUTH_EXCHANGE_STATE_SECRET).trim();
  const googleAuth = resolveGoogleOAuthConfig(options.env || process.env);
  if (!isProductionRuntime({ NODE_ENV: nodeEnv })) return;
  if (!authExchangeStateSecret || authExchangeStateSecret === DEFAULT_AUTH_EXCHANGE_STATE_SECRET) {
    throw new Error('SIG_REALTY_AUTH_STATE_SECRET must be set to a non-default value in production');
  }
  if (googleAuth.isMisconfigured) {
    throw new Error('Set both SIG_REALTY_GOOGLE_CLIENT_ID and SIG_REALTY_GOOGLE_CLIENT_SECRET to enable direct Google OAuth');
  }
}

function isLoopbackRequest(req = {}) {
  const host = String(req.headers?.host || '').split(':')[0].trim().toLowerCase();
  const remoteAddressRaw = String(req.socket?.remoteAddress || req.connection?.remoteAddress || '').trim().toLowerCase();
  const remoteAddress = remoteAddressRaw.startsWith('::ffff:') ? remoteAddressRaw.slice(7) : remoteAddressRaw;
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
  return loopbackHosts.has(host) && loopbackHosts.has(remoteAddress);
}

function isSecureRequest(req = {}) {
  const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').trim().toLowerCase();
  return forwardedProto === 'https' || !!req.socket?.encrypted;
}

function resolveRequestOrigin(req = {}) {
  const headers = req.headers || {};
  const configuredPublicOrigin = String(process.env.SIG_REALTY_PUBLIC_ORIGIN || '').trim().replace(/\/$/, '');
  const suppliedOrigin = String(headers.origin || headers.Origin || '').trim();
  const suppliedReferer = String(headers.referer || headers.Referer || '').trim();
  if (configuredPublicOrigin && (suppliedOrigin || suppliedReferer)) {
    try {
      const originValue = suppliedOrigin ? new URL(suppliedOrigin).origin : '';
      const refererValue = suppliedReferer ? new URL(suppliedReferer).origin : '';
      const headersAgree = !originValue || !refererValue || originValue === refererValue;
      if (headersAgree && (originValue === configuredPublicOrigin || refererValue === configuredPublicOrigin)) {
        return configuredPublicOrigin;
      }
    } catch (_) {}
  }
  const forwardedProto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const forwardedHost = String(headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || String(headers.host || '').trim();
  if (!host) return '';
  const protocol = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  return `${protocol}://${host}`;
}

function validateMutationRequestOrigin(req = {}, url) {
  if (!url?.pathname?.startsWith('/api/')) return null;
  if (!STATE_CHANGING_METHODS.has(String(req.method || '').toUpperCase())) return null;

  const headers = req.headers || {};
  const fetchSite = String(headers['sec-fetch-site'] || headers['Sec-Fetch-Site'] || '').trim().toLowerCase();
  if (fetchSite === 'cross-site') {
    return {
      code: 'CSRF_ORIGIN_MISMATCH',
      message: 'Cross-site state-changing requests are not allowed.'
    };
  }

  const expectedOrigin = resolveRequestOrigin(req);
  if (!expectedOrigin) return null;

  const suppliedOrigin = String(headers.origin || headers.Origin || '').trim();
  const suppliedReferer = String(headers.referer || headers.Referer || '').trim();
  for (const [headerName, value] of [['Origin', suppliedOrigin], ['Referer', suppliedReferer]]) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.origin !== expectedOrigin) {
        console.warn('[auth]', JSON.stringify({
          stage: 'csrf_origin_rejected',
          headerName,
          expectedOrigin,
          suppliedOrigin: parsed.origin
        }));
        return {
          code: 'CSRF_ORIGIN_MISMATCH',
          message: `${headerName} does not match the application origin.`
        };
      }
    } catch (_) {
      return {
        code: 'CSRF_ORIGIN_MISMATCH',
        message: `Invalid ${headerName} header.`
      };
    }
  }

  return null;
}

function sanitizeAuthNextPath(value) {
  try {
    const text = String(value || '').trim();
    if (!text || !text.startsWith('/') || text.startsWith('//')) return '/';
    const parsed = new URL(text, 'http://localhost');
    const normalizedPath = String(parsed.pathname || '').trim().toLowerCase();
    if (normalizedPath === '/login' || normalizedPath === '/login.html') return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_) {
    return '/';
  }
}

function safeSecretEquals(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left || ''));
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right || ''));
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getConfiguredTestSessionSecret() {
  return String(
    process.env.SIG_REALTY_TEST_SESSION_TOKEN ||
    process.env.AUTH_TEST_SECRET ||
    ''
  ).trim();
}

function normalizeMobile(value) {
  return String(value || '').replace(/\D/g, '');
}

function findLoginUser(payload = {}) {
  const email = String(payload.email || payload.Email || '').trim().toLowerCase();
  const userId = String(payload.userId || payload.UserID || payload.userID || '').trim();
  const mobile = normalizeMobile(payload.mobile || payload.Mobile || '');
  const users = typeof runtime?.repository?.listUsers === 'function' ? (runtime.repository.listUsers() || []) : [];
  return users.find((user) => {
    if (String(user?.Status || '').trim().toUpperCase() !== 'ACTIVE') return false;
    if (email && String(user.Email || '').trim().toLowerCase() === email) return true;
    if (userId && String(user.UserID || '').trim() === userId) return true;
    if (mobile && normalizeMobile(user.Mobile || '') === mobile) return true;
    return false;
  }) || null;
}

function sessionCookieValue(req, token, { clear = false } = {}) {
  const parts = [`${SESSION_COOKIE_NAME}=${clear ? '' : encodeURIComponent(String(token || ''))}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (clear) {
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'Max-Age=0');
  } else {
    parts.push(`Max-Age=${getSessionMaxAgeSeconds(runtime?.repository)}`);
  }
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function getAuthExchangeStateMaxAgeSeconds(repository = runtime?.repository, env = process.env) {
  const settings = repository && typeof repository.getSettings === 'function' ? repository.getSettings() : null;
  const minutes = Number(
    env?.SIG_REALTY_AUTH_STATE_TIMEOUT_MINUTES ??
    settings?.Security?.AuthStateTimeoutMinutes ??
    settings?.AuthStateTimeoutMinutes
  );
  if (Number.isFinite(minutes) && minutes > 0) return Math.floor(minutes * 60);
  return DEFAULT_AUTH_EXCHANGE_STATE_MAX_AGE_SECONDS;
}

function setSessionCookie(res, req, token) {
  res.setHeader('Set-Cookie', sessionCookieValue(req, token));
}

function clearSessionCookie(res, req) {
  res.setHeader('Set-Cookie', sessionCookieValue(req, '', { clear: true }));
}

function buildAuthExchangeStateCookie(req, value, maxAgeSeconds = getAuthExchangeStateMaxAgeSeconds()) {
  const encoded = encodeURIComponent(String(value || ''));
  const parts = [`${AUTH_EXCHANGE_STATE_COOKIE_NAME}=${encoded}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  const age = Math.max(0, Number(maxAgeSeconds) || 0);
  parts.push(`Max-Age=${age}`);
  if (age <= 0) {
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function buildAuthNextPathCookie(req, value, maxAgeSeconds = getAuthExchangeStateMaxAgeSeconds()) {
  const encoded = encodeURIComponent(sanitizeAuthNextPath(value || '/'));
  const parts = [`${AUTH_NEXT_PATH_COOKIE_NAME}=${encoded}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  const age = Math.max(0, Number(maxAgeSeconds) || 0);
  parts.push(`Max-Age=${age}`);
  if (age <= 0) {
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function buildAuthFlowCookies(req, { state = '', nextPath = '/', maxAgeSeconds = getAuthExchangeStateMaxAgeSeconds() } = {}) {
  return [
    buildAuthExchangeStateCookie(req, state, maxAgeSeconds),
    buildAuthNextPathCookie(req, nextPath, maxAgeSeconds)
  ];
}

function appendSetCookie(headers = {}, values = []) {
  const nextValues = (Array.isArray(values) ? values : [values]).filter(Boolean);
  if (!nextValues.length) return headers;
  const current = headers['Set-Cookie'];
  return {
    ...headers,
    'Set-Cookie': Array.isArray(current) ? current.concat(nextValues) : current ? [current].concat(nextValues) : nextValues
  };
}

function normalizeAuthSignInUrl(value) {
  const fallback = new URL(DEFAULT_AUTH_SIGN_IN_URL);
  try {
    const parsed = new URL(String(value || '').trim() || fallback.toString());
    if (parsed.origin !== fallback.origin) {
      return fallback.toString();
    }
    if (!parsed.pathname || parsed.pathname === '/') {
      parsed.pathname = fallback.pathname;
    }
    return parsed.toString();
  } catch (_) {
    return fallback.toString();
  }
}

function resolveAuthSignInUrl(env = process.env) {
  return normalizeAuthSignInUrl(env.SIG_REALTY_AUTH_SIGN_IN_URL);
}

function normalizeAuthSessionDataUrl(rawUrl, { allowLoopback = false } = {}) {
  const fallback = new URL(DEFAULT_AUTH_SESSION_DATA_URL);
  try {
    const parsed = new URL(String(rawUrl || '').trim() || fallback.toString());
    const hostname = parsed.hostname.trim().toLowerCase();
    const isLoopbackHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (allowLoopback && isLoopbackHost) {
      return parsed.toString();
    }
    if (parsed.protocol !== fallback.protocol || hostname !== fallback.hostname) {
      return fallback.toString();
    }
    parsed.username = '';
    parsed.password = '';
    if (!parsed.pathname || parsed.pathname === '/') {
      parsed.pathname = fallback.pathname;
    }
    return parsed.toString();
  } catch (_) {
    return fallback.toString();
  }
}

function resolveAuthSessionDataUrl(env = process.env) {
  return normalizeAuthSessionDataUrl(env.SIG_REALTY_AUTH_SESSION_DATA_URL, {
    allowLoopback: !isProductionRuntime(env)
  });
}

function resolveGoogleOAuthConfig(env = process.env) {
  const clientId = String(env.SIG_REALTY_GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(env.SIG_REALTY_GOOGLE_CLIENT_SECRET || '').trim();
  const configured = Boolean(clientId || clientSecret);
  const enabled = Boolean(clientId && clientSecret);
  const isMisconfigured = configured && !enabled;
  return { configured, enabled, isMisconfigured, clientId, clientSecret };
}

function normalizeGoogleEndpointUrl(rawUrl, fallbackRawUrl, { allowLoopback = false } = {}) {
  const fallback = new URL(fallbackRawUrl);
  try {
    const parsed = new URL(String(rawUrl || '').trim() || fallback.toString());
    const hostname = parsed.hostname.trim().toLowerCase();
    const isLoopbackHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    parsed.username = '';
    parsed.password = '';
    if (allowLoopback && isLoopbackHost) {
      return parsed.toString();
    }
    if (parsed.protocol !== fallback.protocol || hostname !== fallback.hostname) {
      return fallback.toString();
    }
    if (!parsed.pathname || parsed.pathname === '/') {
      parsed.pathname = fallback.pathname;
    }
    return parsed.toString();
  } catch (_) {
    return fallback.toString();
  }
}

function resolveGoogleOAuthAuthorizeUrl(env = process.env) {
  return normalizeGoogleEndpointUrl(
    env.SIG_REALTY_GOOGLE_AUTHORIZE_URL,
    DEFAULT_GOOGLE_OAUTH_AUTHORIZE_URL,
    { allowLoopback: !isProductionRuntime(env) }
  );
}

function resolveGoogleOAuthTokenUrl(env = process.env) {
  return normalizeGoogleEndpointUrl(
    env.SIG_REALTY_GOOGLE_TOKEN_URL,
    DEFAULT_GOOGLE_OAUTH_TOKEN_URL,
    { allowLoopback: !isProductionRuntime(env) }
  );
}

function resolveGoogleOAuthUserInfoUrl(env = process.env) {
  return normalizeGoogleEndpointUrl(
    env.SIG_REALTY_GOOGLE_USERINFO_URL,
    DEFAULT_GOOGLE_OAUTH_USERINFO_URL,
    { allowLoopback: !isProductionRuntime(env) }
  );
}

function resolveGoogleOAuthScopes(env = process.env) {
  const fallback = 'openid email profile';
  const configured = String(env.SIG_REALTY_GOOGLE_SCOPES || '').trim();
  return configured || fallback;
}

function resolveGoogleOAuthRedirectUrl(req, nextPath = '/', env = process.env) {
  // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
  const origin = resolveRequestOrigin(req);
  if (!origin) return '';
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.pathname = '/login.html';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

function pickFirstString(...values) {
  for (const value of values.flat(Infinity)) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function signAuthExchangeState(payload) {
  return crypto
    .createHmac('sha256', AUTH_EXCHANGE_STATE_SECRET)
    .update(String(payload))
    .digest('hex');
}

function authStateContextHash(contextValue = '') {
  const raw = String(contextValue || '').trim();
  if (!raw) return '';
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function hashAuthBrowserFlowId(value = '') {
  return authStateContextHash(value);
}

function invalidAuthStateResult(reason) {
  return { ok: false, error: 'Invalid auth state', reason };
}

async function flushCriticalAuthStateWrite() {
  if (mongoStore.isEnabled() && mongoStore.isInitialized()) {
    await mongoStore.flush();
  }
}

async function persistAuthExchangeState(repository, record) {
  if (!repository || typeof repository.upsertAuthExchangeState !== 'function') {
    throw new Error('Auth exchange state persistence is unavailable');
  }
  if (typeof repository.deleteExpiredAuthExchangeStates === 'function') {
    repository.deleteExpiredAuthExchangeStates();
  }
  const saved = repository.upsertAuthExchangeState(record);
  await flushCriticalAuthStateWrite();
  return saved;
}

function buildAuthExchangeStateRecord({
  state,
  redirectUri = '',
  nextPath = '/',
  maxAgeSeconds = getAuthExchangeStateMaxAgeSeconds(),
  browserFlowId = '',
  authMode = ''
} = {}) {
  const issuedAt = new Date().toISOString();
  return {
    stateId: String(state || '').trim(),
    redirectUri: String(redirectUri || '').trim(),
    nextPath: sanitizeAuthNextPath(nextPath || '/'),
    browserFlowHash: hashAuthBrowserFlowId(browserFlowId),
    authMode: String(authMode || '').trim(),
    issuedAt,
    expiresAt: new Date(Date.now() + (Math.max(0, Number(maxAgeSeconds) || 0) * 1000)).toISOString(),
    consumedAt: ''
  };
}

function extractProviderSessionIdentity(payload = {}) {
  const data = payload && typeof payload === 'object' ? (payload.data || payload.session || payload.user || payload) : {};
  const user = data && typeof data === 'object'
    ? (data.user || data.account || data.profile || data.session || data)
    : {};
  const email = pickFirstString(
    payload.email,
    payload.userEmail,
    payload.user_email,
    data.email,
    data.userEmail,
    data.user_email,
    user.email,
    user.userEmail,
    user.user_email
  ).toLowerCase();
  const name = pickFirstString(
    payload.name,
    payload.userName,
    data.name,
    data.userName,
    user.name,
    user.fullName,
    user.displayName
  );
  return { email, name };
}

function findActiveUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || typeof runtime?.repository?.listUsers !== 'function') return null;
  return (runtime.repository.listUsers() || []).find((user) => (
    String(user?.Email || '').trim().toLowerCase() === normalized &&
    String(user?.Status || '').trim().toUpperCase() === 'ACTIVE'
  )) || null;
}

async function fetchAuthProviderSessionData(sessionId) {
  const response = await fetch(resolveAuthSessionDataUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ session_id: sessionId })
  });

  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (_) {
    payload = { ok: false, error: raw || 'Invalid auth provider response' };
  }

  if (!response.ok) {
    const error = pickFirstString(payload?.error, payload?.message, raw, 'Unauthorized');
    return { ok: false, statusCode: response.status, error, payload };
  }

  const identity = extractProviderSessionIdentity(payload);
  if (!identity.email) {
    return { ok: false, statusCode: 502, error: 'Auth provider response missing email', payload };
  }

  return { ok: true, payload, identity };
}

function extractJwtPayload(token) {
  try {
    const [, payload = ''] = String(token || '').split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    const decoded = Buffer.from(normalized + padding, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (_) {
    return null;
  }
}

async function fetchGoogleIdentityFromAuthCode(code, redirectUri) {
  const googleAuth = resolveGoogleOAuthConfig();
  if (!googleAuth.enabled) {
    return { ok: false, statusCode: 503, error: 'Direct Google OAuth is not configured' };
  }

  const tokenResponse = await fetch(resolveGoogleOAuthTokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams({
      code,
      client_id: googleAuth.clientId,
      client_secret: googleAuth.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString()
  });

  const rawTokenBody = await tokenResponse.text();
  let tokenPayload = {};
  try {
    tokenPayload = rawTokenBody ? JSON.parse(rawTokenBody) : {};
  } catch (_) {
    tokenPayload = {};
  }

  if (!tokenResponse.ok) {
    const providerError = pickFirstString(tokenPayload?.error_description, tokenPayload?.error, rawTokenBody, 'Unauthorized');
    return { ok: false, statusCode: 401, error: providerError };
  }

  const accessToken = String(tokenPayload.access_token || '').trim();
  const idToken = String(tokenPayload.id_token || '').trim();
  let identity = null;

  if (accessToken) {
    const userInfoResponse = await fetch(resolveGoogleOAuthUserInfoUrl(), {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json'
      }
    });
    const rawUserInfo = await userInfoResponse.text();
    let userInfoPayload = {};
    try {
      userInfoPayload = rawUserInfo ? JSON.parse(rawUserInfo) : {};
    } catch (_) {
      userInfoPayload = {};
    }

    if (!userInfoResponse.ok) {
      const providerError = pickFirstString(userInfoPayload?.error_description, userInfoPayload?.error, rawUserInfo, 'Unable to fetch Google profile');
      return { ok: false, statusCode: 502, error: providerError };
    }

    identity = {
      email: String(userInfoPayload.email || '').trim().toLowerCase(),
      name: pickFirstString(userInfoPayload.name, userInfoPayload.given_name, userInfoPayload.family_name),
      emailVerified: userInfoPayload.email_verified
    };
  } else if (idToken) {
    const claims = extractJwtPayload(idToken);
    identity = {
      email: String(claims?.email || '').trim().toLowerCase(),
      name: pickFirstString(claims?.name, claims?.given_name, claims?.family_name),
      emailVerified: claims?.email_verified
    };
  }

  if (!identity?.email) {
    return { ok: false, statusCode: 502, error: 'Google OAuth response missing email' };
  }
  if (identity.emailVerified === false) {
    return { ok: false, statusCode: 403, error: 'Google account email is not verified' };
  }

  return { ok: true, identity, payload: tokenPayload };
}

function parseCookies(headers = {}) {
  const cookieHeader = headers.cookie || headers.Cookie || '';
  return String(cookieHeader)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const idx = entry.indexOf('=');
      const key = idx === -1 ? entry : entry.slice(0, idx);
      const rawValue = idx === -1 ? '' : entry.slice(idx + 1);
      try {
        acc[key] = decodeURIComponent(rawValue);
      } catch (_) {
        acc[key] = rawValue;
      }
      return acc;
    }, {});
}

function issueAuthExchangeState(contextValue = '', maxAgeSeconds = getAuthExchangeStateMaxAgeSeconds()) {
  const nonce = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + (Math.max(0, Number(maxAgeSeconds) || 0) * 1000);
  const contextHash = authStateContextHash(contextValue);
  const payload = contextHash ? `${nonce}.${expiresAt}.${contextHash}` : `${nonce}.${expiresAt}`;
  return `${payload}.${signAuthExchangeState(payload)}`;
}

function validateAuthExchangeState(submittedState, contextValue = '') {
  const state = String(submittedState || '').trim();
  if (!state) return invalidAuthStateResult('state_missing');
  const parts = state.split('.');
  if (parts.length !== 4 && parts.length !== 3) {
    return invalidAuthStateResult('signature_invalid');
  }
  const [nonce, expiresAtRaw, maybeContextHash, maybeSignature] = parts;
  const signature = parts.length === 4 ? maybeSignature : maybeContextHash;
  const contextHash = parts.length === 4 ? maybeContextHash : '';
  const expiresAt = Number(expiresAtRaw);
  if (!nonce || !expiresAtRaw || !signature || !Number.isFinite(expiresAt)) {
    return invalidAuthStateResult('signature_invalid');
  }
  if (expiresAt <= Date.now()) {
    return invalidAuthStateResult('state_expired');
  }
  const expectedContextHash = authStateContextHash(contextValue);
  if (contextHash && contextHash !== expectedContextHash) {
    return invalidAuthStateResult('redirect_uri_mismatch');
  }
  if (!contextHash && expectedContextHash) {
    return invalidAuthStateResult('redirect_uri_mismatch');
  }
  const payload = contextHash
    ? `${nonce}.${expiresAtRaw}.${contextHash}`
    : `${nonce}.${expiresAtRaw}`;
  const expected = signAuthExchangeState(payload);
  const actualBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return invalidAuthStateResult('signature_invalid');
  }
  return { ok: true, state, expiresAt };
}

async function consumeAuthExchangeState(headers = {}, submittedState, contextValue = '', options = {}) {
  const validated = validateAuthExchangeState(submittedState, contextValue);
  if (!validated.ok) return validated;

  const repository = options.repository || runtime?.repository;
  if (!repository || typeof repository.getAuthExchangeState !== 'function') {
    return invalidAuthStateResult('signature_invalid');
  }
  if (typeof repository.deleteExpiredAuthExchangeStates === 'function') {
    repository.deleteExpiredAuthExchangeStates();
  }

  const persisted = repository.getAuthExchangeState(validated.state, { includeExpired: true });
  if (!persisted) {
    return invalidAuthStateResult('signature_invalid');
  }
  const persistedExpiresAt = persisted.expiresAt ? new Date(persisted.expiresAt).getTime() : null;
  if (Number.isFinite(persistedExpiresAt) && persistedExpiresAt <= Date.now()) {
    repository.deleteAuthExchangeState?.(validated.state);
    await flushCriticalAuthStateWrite();
    return invalidAuthStateResult('state_expired');
  }
  if (persisted.consumedAt) {
    return invalidAuthStateResult('state_replayed');
  }
  const expectedRedirectUri = String(persisted.redirectUri || '').trim();
  const actualRedirectUri = String(contextValue || '').trim();
  if ((expectedRedirectUri || actualRedirectUri) && expectedRedirectUri !== actualRedirectUri) {
    return invalidAuthStateResult('redirect_uri_mismatch');
  }

  const cookieState = String(parseCookies(headers)[AUTH_EXCHANGE_STATE_COOKIE_NAME] || '').trim();
  if (cookieState && cookieState !== validated.state) {
    return invalidAuthStateResult('cookie_mismatch');
  }
  const browserFlowId = String(
    options.browserFlowId ||
    options.browser_flow_id ||
    options.browserFlow ||
    ''
  ).trim();
  const browserFlowHash = hashAuthBrowserFlowId(browserFlowId);
  const browserFlowMatches = Boolean(
    persisted.browserFlowHash &&
    browserFlowHash &&
    safeSecretEquals(browserFlowHash, persisted.browserFlowHash)
  );
  if (!cookieState && !browserFlowMatches) {
    return invalidAuthStateResult('cookie_missing');
  }

  const consumeResult = typeof repository.consumeAuthExchangeState === 'function'
    ? repository.consumeAuthExchangeState(validated.state, new Date().toISOString())
    : { ok: false, reason: 'missing' };
  if (!consumeResult.ok) {
    await flushCriticalAuthStateWrite();
    if (consumeResult.reason === 'expired') {
      return invalidAuthStateResult('state_expired');
    }
    if (consumeResult.reason === 'replayed') {
      return invalidAuthStateResult('state_replayed');
    }
    return invalidAuthStateResult('signature_invalid');
  }
  await flushCriticalAuthStateWrite();
  return {
    ok: true,
    state: validated.state,
    nextPath: sanitizeAuthNextPath(consumeResult.record?.nextPath || persisted.nextPath || '/'),
    authMode: consumeResult.record?.authMode || persisted.authMode || '',
    redirectUri: expectedRedirectUri
  };
}

function sanitizeAuthLogValue(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function logAuthEvent(stage, details = {}) {
  const safeDetails = Object.entries(details).reduce((acc, [key, value]) => {
    if (value === undefined || value === null || value === '') return acc;
    acc[key] = typeof value === 'number' || typeof value === 'boolean'
      ? value
      : sanitizeAuthLogValue(value);
    return acc;
  }, {});
  console.info('[auth]', JSON.stringify({ stage, ...safeDetails }));
}

function tenantCheck(record = {}, actor = {}) {
  if (!record || typeof record !== 'object') return { ok: true };
  const actorHasTenantScope = Boolean(actor.companyId || actor.brokerageId);
  const recordCompany = record.CompanyID || record.CompanyId;
  const recordBrokerage = record.BrokerageID || record.BrokerageId;
  if (actorHasTenantScope && !recordCompany && !recordBrokerage) {
    return { ok: false, statusCode: 403, error: 'Tenant metadata required' };
  }
  if (actor.companyId && record.CompanyID && String(record.CompanyID) !== String(actor.companyId)) {
    return { ok: false, statusCode: 403, error: 'Forbidden' };
  }
  if (actor.brokerageId && record.BrokerageID && String(record.BrokerageID) !== String(actor.brokerageId)) {
    return { ok: false, statusCode: 403, error: 'Forbidden' };
  }
  return { ok: true };
}

// ── readJson helper (may be called before V2 dispatch) ──────────────────────
async function readJsonOnce(req) {
  if (req._parsedBody !== undefined) return req._parsedBody;
  const body = await readJson(req);
  req._parsedBody = body;
  return body;
}

function ensureDirectDashboardSession(req, res, url) {
  const actor = getAuthenticatedActor(req, url);
  if (actor?.userId) return { ok: true, actor };
  const session = runtime?.auth?.issueDirectDashboardSession?.();
  if (!session?.ok || !session.token) return session || { ok: false, statusCode: 503, error: 'Direct dashboard tenant scope is unavailable' };
  setSessionCookie(res, req, session.token);
  return { ok: true, actor: shapeActor(session.actor) };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const originError = validateMutationRequestOrigin(req, url);
  if (originError) {
    sendJson(res, { ok: false, error: originError.code, message: originError.message }, 403);
    return;
  }
  const isAuthSessionExchangePath = /^\/api\/auth\/session-exchange\/?$/i.test(pathname);

  try {
    // ── V2 Router — handled FIRST for V2-specific and enhanced routes ────────
    // Routes that need a body: pre-read once so V2 and legacy handlers share it
    const needsBody = ['POST', 'PATCH', 'PUT'].includes(req.method);
    let bodyForV2   = null;
    if (needsBody) {
      try {
        bodyForV2 = await readJsonOnce(req);
      } catch (error) {
        sendJson(res, { ok: false, error: error.statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'Invalid JSON body' }, error.statusCode || 400);
        return;
      }
    }
    const { AccessControlService } = require('./src/services/accessControlService');
    const accessSvc = new AccessControlService(runtime.repository);
    const isSensitiveV2Api = /^\/api\/v2\/(clients|requirements|followups|activities|site-visits|shortlists|matches|transactions|documents|builder-projects|broker-network|inventory|duplicates)(?:\/|$)/i.test(pathname);
    if (isSensitiveV2Api && !getAuthenticatedActor(req, url)) {
      sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      return;
    }
    const legacyCapability = (() => {
      if (pathname === '/api/broker/share') return 'BROKER_NETWORK_CREATE';
      if (/^\/api\/negotiations(?:\/|$)/i.test(pathname)) {
        return req.method === 'GET' ? 'NEGOTIATION_READ' : 'NEGOTIATION_UPDATE';
      }
      if (/^\/api\/tokens(?:\/|$)/i.test(pathname)) {
        return req.method === 'GET' ? 'TOKEN_READ' : 'TOKEN_CREATE';
      }
      if (/^\/api\/deals(?:\/|$)/i.test(pathname)) {
        return req.method === 'GET' ? 'DEAL_READ' : 'DEAL_CREATE';
      }
      if (/^\/api\/commission(?:\/|$)/i.test(pathname)) {
        return req.method === 'GET' ? 'COMMISSION_READ' : 'COMMISSION_UPDATE';
      }
      if (/^\/api\/closing(?:\/|$)/i.test(pathname)) {
        return req.method === 'GET' ? 'DEAL_READ' : 'DEAL_UPDATE';
      }
      return null;
    })();
    if (legacyCapability && !ensurePermissionOrRespond(req, res, url, legacyCapability)) return;

    // ── Smart Match V2 (dynamic scoring against inventory) ──────────────────
    // GET /api/v2/requirements/:id/matches?limit=10&minScore=40
    const matchV2 = pathname.match(/^\/api\/v2\/requirements\/([^\/]+)\/matches\/?$/i);
    if (matchV2 && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const requirement = runtime.repository.readRequirement(matchV2[1]);
      const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
        permissions: ['MATCHING_VIEW', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ']
      });
      if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
      const { SmartMatchService } = require('./src/services/smartMatchService');
      const svc = new SmartMatchService(runtime.repository);
      const opts = {
        limit:    Number(url.searchParams.get('limit')) || 20,
        minScore: url.searchParams.get('minScore') != null ? Number(url.searchParams.get('minScore')) : 40
      };
      const out = svc.matchByRequirementId(matchV2[1], opts);
      if (out.ok && out.data && Array.isArray(out.data.matches)) {
        out.data.matches = out.data.matches.filter((row) => {
          const property = runtime.repository.find('Inventory', 'PropertyID', row.PropertyID);
          return accessSvc.authorizeProperty(actor, property, {
            permissions: ['MATCHING_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
            hideExistence: true
          }).ok;
        });
        out.data.total = out.data.matches.length;
      }
      sendJson(res, out, out.ok ? 200 : 404);
      return;
    }

    // ── Shortlist V2 (property-level shortlist per requirement, notes-aware) ─
    // GET    /api/v2/shortlist/:reqId
    // POST   /api/v2/shortlist/:reqId/add          { propertyId, notes?, priority?, matchScore?, matchLevel? }
    // DELETE /api/v2/shortlist/:reqId/remove/:propId
    // PATCH  /api/v2/shortlist/:reqId/notes/:propId { notes }
    const slV2List   = pathname.match(/^\/api\/v2\/shortlist\/([^\/]+)\/?$/i);
    const slV2Add    = pathname.match(/^\/api\/v2\/shortlist\/([^\/]+)\/add\/?$/i);
    const slV2Remove = pathname.match(/^\/api\/v2\/shortlist\/([^\/]+)\/remove\/([^\/]+)\/?$/i);
    const slV2Notes  = pathname.match(/^\/api\/v2\/shortlist\/([^\/]+)\/notes\/([^\/]+)\/?$/i);
    if (slV2List || slV2Add || slV2Remove || slV2Notes) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const { ShortlistServiceV2 } = require('./src/services/shortlistServiceV2');
      const svc = new ShortlistServiceV2(runtime.repository);

      if (slV2List && req.method === 'GET') {
        const requirement = runtime.repository.readRequirement(slV2List[1]);
        const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
          permissions: ['SHORTLIST_VIEW', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ']
        });
        if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
        const status = url.searchParams.get('status') || 'Active';
        const rows = svc.list(slV2List[1], { status }).filter((row) => {
          const property = runtime.repository.find('Inventory', 'PropertyID', row.PropertyID);
          return accessSvc.authorizeProperty(actor, property, {
            permissions: ['SHORTLIST_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
            hideExistence: true
          }).ok;
        });
        sendJson(res, { ok: true, data: rows, count: rows.length });
        return;
      }

      if (slV2Add && req.method === 'POST') {
        const body = bodyForV2 || {};
        const requirement = runtime.repository.readRequirement(slV2Add[1]);
        const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
          permissions: ['SHORTLIST_VIEW', 'REQUIREMENTS_EDIT', 'REQUIREMENTS_UPDATE', 'LEADS_EDIT', 'LEADS_UPDATE']
        });
        if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
        const property = runtime.repository.find('Inventory', 'PropertyID', body.propertyId || body.PropertyID);
        const propertyAccess = accessSvc.authorizeProperty(actor, property, {
          permissions: ['SHORTLIST_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
          hideExistence: true
        });
        if (!propertyAccess.ok) { sendJson(res, { ok: false, error: propertyAccess.error }, propertyAccess.statusCode); return; }
        const out = svc.add(slV2Add[1], body);
        sendJson(res, out, out.ok ? (out.alreadyShortlisted ? 200 : 201) : 400);
        return;
      }

      if (slV2Remove && req.method === 'DELETE') {
        const requirement = runtime.repository.readRequirement(slV2Remove[1]);
        const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
          permissions: ['SHORTLIST_VIEW', 'REQUIREMENTS_EDIT', 'REQUIREMENTS_UPDATE', 'LEADS_EDIT', 'LEADS_UPDATE']
        });
        if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
        const property = runtime.repository.find('Inventory', 'PropertyID', slV2Remove[2]);
        const propertyAccess = accessSvc.authorizeProperty(actor, property, {
          permissions: ['SHORTLIST_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
          hideExistence: true
        });
        if (!propertyAccess.ok) { sendJson(res, { ok: false, error: propertyAccess.error }, propertyAccess.statusCode); return; }
        const out = svc.remove(slV2Remove[1], slV2Remove[2], actor.userId || 'system');
        sendJson(res, out, out.ok ? 200 : 404);
        return;
      }

      if (slV2Notes && req.method === 'PATCH') {
        const body = bodyForV2 || {};
        const requirement = runtime.repository.readRequirement(slV2Notes[1]);
        const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
          permissions: ['SHORTLIST_VIEW', 'REQUIREMENTS_EDIT', 'REQUIREMENTS_UPDATE', 'LEADS_EDIT', 'LEADS_UPDATE']
        });
        if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
        const property = runtime.repository.find('Inventory', 'PropertyID', slV2Notes[2]);
        const propertyAccess = accessSvc.authorizeProperty(actor, property, {
          permissions: ['SHORTLIST_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
          hideExistence: true
        });
        if (!propertyAccess.ok) { sendJson(res, { ok: false, error: propertyAccess.error }, propertyAccess.statusCode); return; }
        const out = svc.updateEntry(slV2Notes[1], slV2Notes[2], {
          notes: body.notes,
          priority: body.priority
        });
        sendJson(res, out, out.ok ? 200 : 404);
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    // ── Broker Network V2 (WhatsApp share flow) ─────────────────────────────
    // GET    /api/v2/broker-network                          — list brokers
    // POST   /api/v2/broker-network                          — add broker
    // PATCH  /api/v2/broker-network/:id                      — edit
    // DELETE /api/v2/broker-network/:id                      — remove
    // POST   /api/v2/requirements/:reqId/network-share       — { brokerIds[], message?, expiresInDays? }
    // GET    /api/v2/requirements/:reqId/network-shares      — list shares
    // POST   /api/v2/network-shares/:shareId/revoke
    // GET    /api/v2/public/req/:token                       — anonymized (NO auth)
    // POST   /api/v2/public/req/:token/response              — submit property (NO auth)
    if (/^\/api\/v2\/(broker-network(?:\/[^\/]+)?(?:\/[^\/]+)?|requirements\/[^\/]+\/network-shares?|network-shares\/[^\/]+\/revoke|public\/req\/[^\/]+(?:\/response)?)\/?$/i.test(pathname)) {
      const { BrokerNetworkV2Service } = require('./src/services/brokerNetworkV2Service');
      const svc = new BrokerNetworkV2Service(runtime.repository);
      const isPublicTokenPath = /^\/api\/v2\/public\/req\/[^\/]+(?:\/response)?\/?$/i.test(pathname);
      const actor = getAuthenticatedActor(req, url);
      if (!isPublicTokenPath && !actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      if (!isPublicTokenPath) {
        let brokerPermission = 'BROKER_NETWORK_READ';
        if (/\/commission-ledger(?:\/|$)/i.test(pathname)) {
          brokerPermission = req.method === 'GET' ? 'BROKER_NETWORK_ADMIN' : 'BROKER_NETWORK_ADMIN';
        } else if (/\/shares(?:\/|$)/i.test(pathname) || /\/revoke(?:\/|$)/i.test(pathname)) {
          brokerPermission = 'BROKER_NETWORK_ADMIN';
        } else if (req.method === 'POST') {
          brokerPermission = 'BROKER_NETWORK_CREATE';
        } else if (req.method === 'PATCH') {
          brokerPermission = 'BROKER_NETWORK_UPDATE';
        } else if (req.method === 'DELETE') {
          brokerPermission = 'BROKER_NETWORK_DELETE';
        }
        if (!ensurePermissionOrRespond(req, res, url, brokerPermission)) return;
      }

      // Broker registry CRUD
      if (/^\/api\/v2\/broker-network\/?$/i.test(pathname)) {
        if (req.method === 'GET') {
          const active = url.searchParams.get('active');
          const rows = svc.listBrokers({ active: active === 'true' ? true : active === 'false' ? false : undefined });
          sendJson(res, { ok: true, data: rows, count: rows.length });
          return;
        }
        if (req.method === 'POST') {
          const out = svc.createBroker(bodyForV2 || {});
          sendJson(res, out, out.ok ? 201 : 400);
          return;
        }
      }
      // Admin: list all shares (optional ?brokerId=)
      if (/^\/api\/v2\/broker-network\/shares\/?$/i.test(pathname) && req.method === 'GET') {
        const brokerId = url.searchParams.get('brokerId') || undefined;
        sendJson(res, svc.listAllShares({ brokerId }));
        return;
      }

      // Commission ledger
      if (/^\/api\/v2\/broker-network\/commission-ledger\/?$/i.test(pathname) && req.method === 'GET') {
        sendJson(res, svc.listCommissionLedger());
        return;
      }
      const ledgerPatch = pathname.match(/^\/api\/v2\/broker-network\/commission-ledger\/([^\/]+)\/?$/i);
      if (ledgerPatch && req.method === 'PATCH') {
        const out = svc.updateCommissionEntry(ledgerPatch[1], bodyForV2 || {});
        sendJson(res, out, out.ok ? 200 : 404);
        return;
      }

      const bnById = pathname.match(/^\/api\/v2\/broker-network\/([^\/]+)\/?$/i);
      if (bnById) {
        if (req.method === 'PATCH') {
          const out = svc.updateBroker(bnById[1], bodyForV2 || {});
          sendJson(res, out, out.ok ? 200 : 404);
          return;
        }
        if (req.method === 'DELETE') {
          const out = svc.deleteBroker(bnById[1]);
          sendJson(res, out, out.ok ? 200 : 404);
          return;
        }
      }

      // Share create
      const shareCreate = pathname.match(/^\/api\/v2\/requirements\/([^\/]+)\/network-share\/?$/i);
      if (shareCreate && req.method === 'POST') {
        const requirementAccess = accessSvc.authorizeRequirement(actor, runtime.repository.readRequirement(shareCreate[1]), {
          permissions: ['BROKER_NETWORK_CREATE', 'REQUIREMENTS_READ', 'LEADS_READ'],
          hideExistence: true
        });
        if (!requirementAccess.ok) { sendJson(res, { ok: false, error: requirementAccess.error }, requirementAccess.statusCode); return; }
        const body = bodyForV2 || {};
        const out = svc.share(shareCreate[1], {
          brokerIds: Array.isArray(body.brokerIds) ? body.brokerIds : [],
          message: body.message || '',
          expiresInDays: Number(body.expiresInDays) || 30,
          userId: actor.userId
        });
        sendJson(res, out, out.ok ? 201 : 400);
        return;
      }

      // List shares for a requirement
      const shareList = pathname.match(/^\/api\/v2\/requirements\/([^\/]+)\/network-shares\/?$/i);
      if (shareList && req.method === 'GET') {
        const requirementAccess = accessSvc.authorizeRequirement(actor, runtime.repository.readRequirement(shareList[1]), {
          permissions: ['BROKER_NETWORK_ADMIN', 'REQUIREMENTS_READ', 'LEADS_READ'],
          hideExistence: true
        });
        if (!requirementAccess.ok) { sendJson(res, { ok: false, error: requirementAccess.error }, requirementAccess.statusCode); return; }
        const rows = svc.listSharesByRequirement(shareList[1]);
        sendJson(res, { ok: true, data: rows, count: rows.length });
        return;
      }

      // Revoke
      const shareRevoke = pathname.match(/^\/api\/v2\/network-shares\/([^\/]+)\/revoke\/?$/i);
      if (shareRevoke && req.method === 'POST') {
        const db = runtime.repository.read();
        const share = (db.RequirementShares || []).find((row) => row.ShareID === shareRevoke[1]);
        const requirementAccess = accessSvc.authorizeRequirement(actor, share ? runtime.repository.readRequirement(share.RequirementID) : null, {
          permissions: ['BROKER_NETWORK_ADMIN', 'REQUIREMENTS_READ', 'LEADS_READ'],
          hideExistence: true
        });
        if (!requirementAccess.ok) { sendJson(res, { ok: false, error: requirementAccess.error }, requirementAccess.statusCode); return; }
        const out = svc.revokeShare(shareRevoke[1]);
        sendJson(res, out, out.ok ? 200 : 404);
        return;
      }

      // Public token endpoints (NO auth)
      const pubGet = pathname.match(/^\/api\/v2\/public\/req\/([^\/]+)\/?$/i);
      if (pubGet && req.method === 'GET') {
        const out = svc.getPublicShareByToken(pubGet[1]);
        const statusCode = out.ok
          ? 200
          : (out.code === 'REVOKED' || out.code === 'EXPIRED' ? 410 : 404);
        sendJson(res, out, statusCode);
        return;
      }
      const pubPost = pathname.match(/^\/api\/v2\/public\/req\/([^\/]+)\/response\/?$/i);
      if (pubPost && req.method === 'POST') {
        const out = svc.submitResponse(pubPost[1], bodyForV2 || {});
        sendJson(res, out, out.ok ? 201 : 400);
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    // ── Storage health (Mongo migration observability) ──────────────────────
    if (pathname === '/api/v2/storage/health' && req.method === 'GET') {
      if (!ensurePermissionOrRespond(req, res, url, 'STORAGE_HEALTH_READ')) return;
      try {
        const mongoStore = require('./src/data/mongoStore');
        sendJson(res, { ok: true, data: mongoStore.stats() });
      } catch (e) {
        sendJson(res, { ok: false, error: e.message }, 500);
      }
      return;
    }

    // ── Expiring raw object access ─────────────────────────────────────────
    // Authenticated callers with STORAGE_OBJECT_READ may mint a short-lived
    // bearer URL. Existing authenticated object requests remain supported.
    if (pathname === '/api/v2/storage/signed-url' && req.method === 'POST') {
      if (!ensurePermissionOrRespond(req, res, url, 'STORAGE_OBJECT_READ')) return;
      const body = bodyForV2 || {};
      const key = String(body.key || body.StoragePath || '').trim();
      if (!key || key.includes('..') || key.includes('\0')) {
        sendJson(res, { ok: false, error: 'Invalid object key' }, 400);
        return;
      }
      const { createSignedObjectAccess } = require('./src/services/storageAccessService');
      const signed = createSignedObjectAccess(key, {
        expiresInSeconds: body.expiresInSeconds
      });
      sendJson(res, signed, signed.ok ? 200 : (signed.statusCode || 500));
      return;
    }

    // ── Broker Profile (Digital Business Card) ──────────────────────────────
    // GET   /api/v2/broker-profile
    // PATCH /api/v2/broker-profile          { Name, Designation, Agency, Mobile, Email }
    // POST  /api/v2/broker-profile/photo    { fileBase64 }
    // GET   /api/v2/broker-profile/photo    — serves the uploaded photo bytes
    if (/^\/api\/v2\/broker-profile(\/.*)?$/i.test(pathname)) {
      const { BrokerProfileService } = require('./src/services/brokerProfileService');
      const svc = new BrokerProfileService(runtime.repository);

      if (/^\/api\/v2\/broker-profile\/photo\/?$/i.test(pathname)) {
        if (req.method === 'GET') {
          svc.getPhotoFile().then((out) => {
            if (!out.ok) { sendJson(res, out, 404); return; }
            res.writeHead(200, withSecurityHeaders({ 'Content-Type': out.contentType, 'Cache-Control': 'private, max-age=3600' }));
            res.end(out.buffer);
          }).catch((e) => sendJson(res, { ok: false, error: e.message }, 500));
          return;
        }
        if (req.method === 'POST') {
          if (!ensureAdminPermissionOrRespond(req, res, url, 'ADMIN_UPDATE')) return;
          const body = bodyForV2 || {};
          svc.updatePhoto(body.fileBase64)
            .then((out) => sendJson(res, out, out.ok ? 200 : 400))
            .catch((e) => sendJson(res, { ok: false, error: e.message }, 500));
          return;
        }
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }

      if (/^\/api\/v2\/broker-profile\/?$/i.test(pathname)) {
        if (req.method === 'GET') { sendJson(res, svc.getProfile()); return; }
        if (req.method === 'PATCH') {
          if (!ensureAdminPermissionOrRespond(req, res, url, 'ADMIN_UPDATE')) return;
          sendJson(res, svc.updateProfile(bodyForV2 || {}));
          return;
        }
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }
    }

    // ── Generic object storage streaming route (GridFS-backed) ──────────────
    // GET /api/v2/storage/object/:encodedKey — key is base64url(logical key),
    // e.g. Buffer.from(key).toString('base64url'). Public (media is meant to
    // be shareable, matching the existing builder-project media route).
    const storageObjectMatch = pathname.match(/^\/api\/v2\/storage\/object\/([^\/]+)\/?$/i);
    if (storageObjectMatch) {
      if (req.method !== 'GET') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
      let key;
      try {
        key = Buffer.from(decodeURIComponent(storageObjectMatch[1]), 'base64url').toString('utf8');
      } catch (e) {
        sendJson(res, { ok: false, error: 'Invalid object key' }, 400);
        return;
      }
      if (!key || key.includes('..') || key.includes('\0')) {
        sendJson(res, { ok: false, error: 'Invalid object key' }, 400);
        return;
      }
      const { verifySignedObjectAccess } = require('./src/services/storageAccessService');
      const signedAttempt = url.searchParams.has('expiresAt') || url.searchParams.has('signature');
      const signed = verifySignedObjectAccess(key, {
        expiresAt: url.searchParams.get('expiresAt'),
        signature: url.searchParams.get('signature')
      });
      if (!signed.ok && !signedAttempt) {
        if (!ensurePermissionOrRespond(req, res, url, 'STORAGE_OBJECT_READ')) return;
      } else if (!signed.ok) {
        const actor = getAuthenticatedActor(req, url);
        if (!actor?.userId) {
          sendJson(res, { ok: false, error: signed.error, code: signed.code }, 401);
          return;
        }
        if (!ensurePermissionOrRespond(req, res, url, 'STORAGE_OBJECT_READ')) return;
      }
      const { getObjectStream } = require('./src/services/objectStorageService');
      getObjectStream(key).then((found) => {
        if (!found) { sendJson(res, { ok: false, error: 'Not found' }, 404); return; }
        const cacheSeconds = signed.ok ? Math.max(1, Math.floor((signed.expiresAt - Date.now()) / 1000)) : 3600;
        const headers = withSecurityHeaders({ 'Content-Type': found.contentType, 'Cache-Control': `private, max-age=${cacheSeconds}` });
        if (Number.isFinite(found.size)) headers['Content-Length'] = found.size;
        res.writeHead(200, headers);
        found.stream.on('error', () => { try { res.destroy(); } catch (_) {} });
        found.stream.pipe(res);
      }).catch((e) => sendJson(res, { ok: false, error: e.message }, 500));
      return;
    }

    // CSV brochure import preview/commit. Preview is read-only; commit
    // requires explicit confirmation and calls the Task 11 importer once
    // per valid row. It never discovers URLs.
    const brochureCsvImportMatch = pathname.match(/^\/api\/v2\/admin\/brochure-import\/csv\/(preview|commit)\/?$/i);
    if (brochureCsvImportMatch) {
      if (req.method !== 'POST') {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }
      const auth = ensureAdminPermissionOrRespond(req, res, url, 'BROCHURE_MIGRATION_MANAGE');
      if (!auth) return;
      const body = bodyForV2 || {};
      if (!body.fileBase64) {
        sendJson(res, { ok: false, error: 'fileBase64 required' }, 400);
        return;
      }
      let buffer;
      try {
        buffer = Buffer.from(String(body.fileBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
      } catch (_) {
        sendJson(res, { ok: false, error: 'Bad base64 payload' }, 400);
        return;
      }
      const { BrochureCsvImportService } = require('./src/services/brochureCsvImportService');
      const csvService = new BrochureCsvImportService(runtime.repository);
      const isCommit = brochureCsvImportMatch[1].toLowerCase() === 'commit';
      const operation = isCommit
        ? csvService.importCsv(buffer, body.filename || 'brochure-import.csv', {
          userId: auth.actor?.userId || 'system',
          confirmed: body.confirmed === true
        })
        : csvService.preview(buffer, body.filename || 'brochure-import.csv');
      Promise.resolve(operation).then((out) => {
        sendJson(res, out, out.ok ? 200 : (out.statusCode || 400));
      }).catch((e) => sendJson(res, { ok: false, error: e.message }, 500));
      return;
    }

    // Explicit one-time brochure import. The caller supplies both the
    // project ID and the exact URL; this route never discovers URLs.
    const explicitBrochureImportMatch = pathname.match(/^\/api\/v2\/admin\/brochure-migration\/project\/([^\/]+)\/import\/?$/i);
    const explicitBrochureImportRoot = /^\/api\/v2\/admin\/brochure-import\/?$/i.test(pathname);
    if (explicitBrochureImportMatch || explicitBrochureImportRoot) {
      if (req.method !== 'POST') {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }
      const auth = ensureAdminPermissionOrRespond(req, res, url, 'BROCHURE_MIGRATION_MANAGE');
      if (!auth) return;
      const body = bodyForV2 || {};
      const projectId = explicitBrochureImportMatch
        ? decodeURIComponent(explicitBrochureImportMatch[1])
        : body.ProjectID;
      const { ProjectMediaCanaryMigrationService } = require('./src/services/projectMediaCanaryMigrationService');
      const canarySvc = new ProjectMediaCanaryMigrationService(runtime.repository);
      canarySvc.importExplicitBrochure({
        projectId,
        brochureUrl: body.BrochureURL,
        userId: auth.actor?.userId || 'system',
        source: 'manual-url'
      }).then((out) => {
        sendJson(res, out, out.ok ? 200 : (out.statusCode || 500));
      }).catch((e) => sendJson(res, { ok: false, error: e.message }, 500));
      return;
    }

    // Targeted brochure migration is admin-only and invokes the canary
    // service for exactly one explicitly supplied project. Bulk migration
    // remains disabled below.
    const brochureMigrationProjectMatch = pathname.match(/^\/api\/v2\/admin\/brochure-migration\/project\/([^\/]+)\/?$/i);
    if (brochureMigrationProjectMatch) {
      if (req.method !== 'POST') {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }
      const auth = ensureAdminPermissionOrRespond(req, res, url, 'BROCHURE_MIGRATION_MANAGE');
      if (!auth) return;
      const { ProjectMediaCanaryMigrationService } = require('./src/services/projectMediaCanaryMigrationService');
      const canarySvc = new ProjectMediaCanaryMigrationService(runtime.repository);
      const body = bodyForV2 || {};
      const operation = body.BrochureURL
        ? canarySvc.importExplicitBrochure({
          projectId: decodeURIComponent(brochureMigrationProjectMatch[1]),
          brochureUrl: body.BrochureURL,
          userId: auth.actor?.userId || 'system',
          source: 'manual-url'
        })
        : canarySvc.migrateProject({
          projectId: decodeURIComponent(brochureMigrationProjectMatch[1]),
          userId: auth.actor?.userId || 'system'
        });
      operation.then((out) => {
        sendJson(res, out, out.ok ? 200 : (out.statusCode || 500));
      }).catch((e) => sendJson(res, { ok: false, error: e.message }, 500));
      return;
    }

    // Automatic/bulk brochure migration remains disabled. It discovers URLs
    // from existing projects, so it must not be exposed as a bulk operation.
    if (/^\/api\/v2\/admin\/brochure-migration(\/.*)?$/i.test(pathname)) {
      const auth = ensureAdminPermissionOrRespond(req, res, url, 'BROCHURE_MIGRATION_MANAGE');
      if (!auth) return;
      sendJson(res, {
        ok: false,
        error: 'AUTOMATIC_MEDIA_MIGRATION_DISABLED',
        message: 'Automatic media migration is disabled. Supply a legitimate URL through the Builder Project manual URL import.'
      }, 410);
      return;
    }

    // ── Builder Projects (Surat builder project master data) ────────────────
    // GET    /api/v2/builder-projects?q=&location=&status=
    // POST   /api/v2/builder-projects                { ProjectName, BuilderName, Location1, ... }
    // GET    /api/v2/builder-projects/:id
    // PATCH  /api/v2/builder-projects/:id
    // DELETE /api/v2/builder-projects/:id
    // POST   /api/v2/builder-projects/import/preview  { filename, fileBase64 }
    // POST   /api/v2/builder-projects/import/commit   { filename, fileBase64 }
    // GET    /api/v2/builder-projects/import/history?limit=20
    if (/^\/api\/v2\/builder-projects(\/.*)?$/i.test(pathname)) {
      const { BuilderProjectService } = require('./src/services/builderProjectService');
      const svc = new BuilderProjectService(runtime.repository);
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }

      if (/^\/api\/v2\/builder-projects\/scrape\/status\/?$/i.test(pathname)) {
        if (req.method !== 'GET') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        if (!ensurePermissionOrRespond(req, res, url, 'BUILDER_PROJECTS_READ')) return;
        const { KarmaGroupScraperService } = require('./src/services/karmaGroupScraperService');
        sendJson(res, KarmaGroupScraperService.getStatus());
        return;
      }

      if (/^\/api\/v2\/builder-projects\/scrape\/karma-group\/?$/i.test(pathname)) {
        if (req.method !== 'POST') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        if (!ensurePermissionOrRespond(req, res, url, 'BUILDER_PROJECTS_CREATE')) return;
        const { KarmaGroupScraperService } = require('./src/services/karmaGroupScraperService');
        const scraper = new KarmaGroupScraperService(runtime.repository, {
          ingestBrochures: String(process.env.KARMA_SCRAPE_INGEST_BROCHURES || '').toLowerCase() === 'true',
          ingestMedia: String(process.env.KARMA_SCRAPE_INGEST_MEDIA || '').toLowerCase() === 'true',
          useCategoryDiscovery: true,
          concurrency: 4,
          mediaConcurrency: 2
        });
        const out = await scraper.startScrape({
          limit: Number(bodyForV2?.limit) || 1000,
          userId: actor.userId || 'system'
        });
        sendJson(res, out, out.ok ? 202 : (out.statusCode || 400));
        return;
      }

      const builderPermission = req.method === 'GET'
        ? 'BUILDER_PROJECTS_READ'
        : req.method === 'PATCH'
          ? 'BUILDER_PROJECTS_UPDATE'
          : req.method === 'DELETE'
            ? 'BUILDER_PROJECTS_DELETE'
            : 'BUILDER_PROJECTS_CREATE';
      if (!ensurePermissionOrRespond(req, res, url, builderPermission)) return;

      const brochureByProjectMatch = pathname.match(/^\/api\/v2\/builder-projects\/([^\/]+)\/brochure\/?$/i);
      if (brochureByProjectMatch) {
        if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
        const { ProjectMediaCanaryMigrationService } = require('./src/services/projectMediaCanaryMigrationService');
        const canarySvc = new ProjectMediaCanaryMigrationService(runtime.repository);
        canarySvc.getProjectBrochureFile(decodeURIComponent(brochureByProjectMatch[1])).then((out) => {
          if (!out.ok) { sendJson(res, out, out.statusCode || 404); return; }
          const headers = withSecurityHeaders({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, max-age=3600' });
          const contentLength = Number(out.size || out.buffer?.length || 0);
          if (Number.isFinite(contentLength) && contentLength > 0) headers['Content-Length'] = contentLength;
          res.writeHead(200, headers);
          res.end(req.method === 'HEAD' ? undefined : out.buffer);
        }).catch((e) => sendJson(res, { ok: false, error: e.message }, 500));
        return;
      }

      const imageByProjectMatch = pathname.match(/^\/api\/v2\/builder-projects\/([^\/]+)\/images\/([^\/]+)\/?$/i);
      if (imageByProjectMatch) {
        if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
        const { ProjectMediaCanaryMigrationService } = require('./src/services/projectMediaCanaryMigrationService');
        const canarySvc = new ProjectMediaCanaryMigrationService(runtime.repository);
        canarySvc.getProjectImageFile(decodeURIComponent(imageByProjectMatch[1]), decodeURIComponent(imageByProjectMatch[2])).then((out) => {
          if (!out.ok) { sendJson(res, out, out.statusCode || 404); return; }
          const headers = withSecurityHeaders({ 'Content-Type': out.contentType || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' });
          const contentLength = Number(out.size || out.buffer?.length || 0);
          if (Number.isFinite(contentLength) && contentLength > 0) headers['Content-Length'] = contentLength;
          res.writeHead(200, headers);
          res.end(req.method === 'HEAD' ? undefined : out.buffer);
        }).catch((e) => sendJson(res, { ok: false, error: e.message }, 500));
        return;
      }

      if (/^\/api\/v2\/builder-projects\/duplicate-builders\/?$/i.test(pathname)) {
        if (req.method !== 'GET') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        sendJson(res, svc.findDuplicateBuilderGroups());
        return;
      }

      if (/^\/api\/v2\/builder-projects\/merge-builders\/?$/i.test(pathname)) {
        if (req.method !== 'POST') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        const body = bodyForV2 || {};
        const out = svc.mergeBuilderNames(body.canonicalName, body.variants);
        sendJson(res, out, out.ok ? 200 : 400);
        return;
      }

      if (/^\/api\/v2\/builder-projects\/unknown-builders\/?$/i.test(pathname)) {
        if (req.method !== 'GET') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        sendJson(res, svc.listUnknownBuilders());
        return;
      }

      if (/^\/api\/v2\/builder-projects\/extract-brochure\/?$/i.test(pathname)) {
        if (req.method !== 'POST') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        const body = bodyForV2 || {};
        if (!body.fileBase64) { sendJson(res, { ok: false, error: 'fileBase64 required' }, 400); return; }
        const { extractBrochure } = require('./src/services/brochureExtractionService');
        extractBrochure(body.fileBase64)
          .then((data) => sendJson(res, { ok: true, data }))
          .catch((e) => sendJson(res, { ok: false, error: e.message }, 500));
        return;
      }

      if (/^\/api\/v2\/builder-projects\/bulk-assign-builder\/?$/i.test(pathname)) {
        if (req.method !== 'POST') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        const body = bodyForV2 || {};
        const out = svc.bulkAssignBuilder(body.projectIds, body.builderName);
        sendJson(res, out, out.ok ? 200 : 400);
        return;
      }

      // GET /api/v2/builder-projects/media/:mediaId — serves photo/video/brochure bytes
      const mediaFileMatch = pathname.match(/^\/api\/v2\/builder-projects\/media\/([^\/]+)\/?$/i);
      if (mediaFileMatch) {
        if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        svc.getMediaFile(mediaFileMatch[1]).then((out) => {
          if (!out.ok) { sendJson(res, out, 404); return; }
          res.writeHead(200, withSecurityHeaders({ 'Content-Type': out.contentType, 'Cache-Control': 'private, max-age=3600' }));
          res.end(req.method === 'HEAD' ? undefined : out.buffer);
        }).catch((e) => sendJson(res, { ok: false, error: e.message }, 500));
        return;
      }

      // POST /api/v2/builder-projects/:id/media { kind, filename, fileBase64 }
      const mediaUploadMatch = pathname.match(/^\/api\/v2\/builder-projects\/([^\/]+)\/media\/?$/i);
      if (mediaUploadMatch) {
        if (req.method !== 'POST') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        const body = bodyForV2 || {};
        svc.addMedia(mediaUploadMatch[1], body.kind, body.filename, body.fileBase64, actor?.userId || 'system')
          .then((out) => sendJson(res, out, out.ok ? 200 : 400))
          .catch((e) => sendJson(res, { ok: false, error: e.message }, 500));
        return;
      }

      // POST /api/v2/builder-projects/:id/media/import-url { kind, sourceUrl }
      // Only the supplied URL is fetched; 403 responses are surfaced as
      // failures and are never bypassed.
      const mediaUrlImportMatch = pathname.match(/^\/api\/v2\/builder-projects\/([^\/]+)\/media\/import-url\/?$/i);
      if (mediaUrlImportMatch) {
        if (req.method !== 'POST') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        const body = bodyForV2 || {};
        svc.importMediaFromUrl(
          decodeURIComponent(mediaUrlImportMatch[1]),
          body.kind,
          body.sourceUrl,
          actor.userId || 'system'
        ).then((out) => sendJson(res, out, out.ok ? 200 : 400))
          .catch((e) => sendJson(res, { ok: false, error: e.message }, 500));
        return;
      }

      // DELETE /api/v2/builder-projects/:id/media/:mediaId
      const mediaDeleteMatch = pathname.match(/^\/api\/v2\/builder-projects\/([^\/]+)\/media\/([^\/]+)\/?$/i);
      if (mediaDeleteMatch) {
        if (req.method !== 'DELETE') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        const out = svc.removeMedia(mediaDeleteMatch[1], mediaDeleteMatch[2]);
        sendJson(res, out, out.ok ? 200 : 404);
        return;
      }

      if (/^\/api\/v2\/builder-projects\/import\/(preview|commit)\/?$/i.test(pathname)) {
        if (req.method !== 'POST') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        const body = bodyForV2 || {};
        if (!body.fileBase64) { sendJson(res, { ok: false, error: 'fileBase64 required' }, 400); return; }
        let buffer;
        try {
          buffer = Buffer.from(String(body.fileBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
        } catch (e) {
          sendJson(res, { ok: false, error: 'Bad base64 payload' }, 400);
          return;
        }
        const filename = body.filename || 'upload.csv';
        if (/preview\/?$/i.test(pathname)) {
          const out = await svc.preview(buffer, filename);
          sendJson(res, out, out.ok ? 200 : 400);
          return;
        }
        const out = await svc.commit(buffer, filename, { userId: actor?.userId || 'system' });
        sendJson(res, out, out.ok ? 200 : 400);
        return;
      }

      if (/^\/api\/v2\/builder-projects\/import\/history\/?$/i.test(pathname)) {
        if (req.method !== 'GET') { sendJson(res, { ok: false, error: 'Method not supported' }, 405); return; }
        const limit = Number(url.searchParams.get('limit')) || 20;
        sendJson(res, svc.listHistory(limit));
        return;
      }

      const idMatch = pathname.match(/^\/api\/v2\/builder-projects\/([^\/]+)\/?$/i);
      if (idMatch) {
        const id = idMatch[1];
        if (req.method === 'GET') { const out = svc.get(id); sendJson(res, out, out.ok ? 200 : 404); return; }
        if (req.method === 'PATCH') { const out = svc.update(id, bodyForV2 || {}); sendJson(res, out, out.ok ? 200 : 400); return; }
        if (req.method === 'DELETE') { const out = svc.remove(id); sendJson(res, out, out.ok ? 200 : 404); return; }
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }

      if (/^\/api\/v2\/builder-projects\/?$/i.test(pathname)) {
        if (req.method === 'GET') {
          const out = svc.list({ q: url.searchParams.get('q'), location: url.searchParams.get('location'), status: url.searchParams.get('status'), category: url.searchParams.get('category') });
          sendJson(res, out);
          return;
        }
        if (req.method === 'POST') {
          const out = svc.create(bodyForV2 || {}, actor?.userId || 'system');
          sendJson(res, out, out.ok ? 201 : 400);
          return;
        }
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }

      sendJson(res, { ok: false, error: 'Not found' }, 404);
      return;
    }

    // ── Site Visit Bookings V2 (group N properties into one visit slot) ─────
    // POST   /api/v2/site-visit-bookings                { requirementId, propertyIds[], visitDate, visitTime, ... }
    // GET    /api/v2/site-visit-bookings?requirementId=X | ?leadId=X
    // GET    /api/v2/site-visit-bookings/:bookingId
    // PATCH  /api/v2/site-visit-bookings/:bookingId     { visitDate?, visitTime?, ... }
    // POST   /api/v2/site-visit-bookings/:bookingId/cancel
    // POST   /api/v2/site-visit-bookings/:bookingId/complete
    if (/^\/api\/v2\/site-visit-bookings(?:\/[^\/]*(?:\/(?:cancel|complete))?)?\/?$/i.test(pathname)) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const { SiteVisitBookingService } = require('./src/services/siteVisitBookingService');
      const svc = new SiteVisitBookingService(runtime.repository);

      // Collection routes
      if (/^\/api\/v2\/site-visit-bookings\/?$/i.test(pathname)) {
        if (req.method === 'GET') {
          const requirementId = url.searchParams.get('requirementId');
          const leadId = url.searchParams.get('leadId');
          if (!requirementId && !leadId) {
            sendJson(res, { ok: false, error: 'requirementId or leadId query required' }, 400);
            return;
          }
          if (requirementId) {
            const requirement = runtime.repository.readRequirement(requirementId);
            const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
              permissions: ['SITE_VISIT_VIEW', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ']
            });
            if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
          }
          if (leadId) {
            const lead = runtime.repository.readLead(leadId);
            const leadAccess = accessSvc.authorizeLead(actor, lead, {
              permissions: ['SITE_VISIT_VIEW', 'LEADS_VIEW', 'LEADS_READ']
            });
            if (!leadAccess.ok) { sendJson(res, { ok: false, error: leadAccess.error }, leadAccess.statusCode); return; }
          }
          const data = requirementId ? svc.listByRequirement(requirementId) : svc.listByLead(leadId);
          sendJson(res, { ok: true, data, count: data.length });
          return;
        }
        if (req.method === 'POST') {
          const payload = bodyForV2 || {};
          const requirement = runtime.repository.readRequirement(payload.requirementId || payload.RequirementID);
          const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
            permissions: ['SITE_VISIT_VIEW', 'REQUIREMENTS_EDIT', 'REQUIREMENTS_UPDATE', 'LEADS_EDIT', 'LEADS_UPDATE']
          });
          if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
          const propertyIds = Array.isArray(payload.propertyIds) ? payload.propertyIds : (Array.isArray(payload.PropertyIDs) ? payload.PropertyIDs : []);
          for (const propertyId of propertyIds) {
            const property = runtime.repository.find('Inventory', 'PropertyID', propertyId);
            const propertyAccess = accessSvc.authorizeProperty(actor, property, {
              permissions: ['SITE_VISIT_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
              hideExistence: true
            });
            if (!propertyAccess.ok) { sendJson(res, { ok: false, error: propertyAccess.error }, propertyAccess.statusCode); return; }
          }
          const out = svc.create(payload, actor);
          sendJson(res, out, out.ok ? 201 : 400);
          return;
        }
      }

      // Sub-resource: /:bookingId, /:bookingId/cancel, /:bookingId/complete
      const bookingMatch = pathname.match(/^\/api\/v2\/site-visit-bookings\/([^\/]+)(?:\/(cancel|complete))?\/?$/i);
      if (bookingMatch) {
        const [, bookingId, action] = bookingMatch;
        if (!action && req.method === 'GET') {
          const bookingAccess = accessSvc.authorizeSiteVisitBooking(actor, bookingId, { permissions: ['SITE_VISIT_VIEW', 'LEADS_VIEW', 'LEADS_READ'] });
          if (!bookingAccess.ok) { sendJson(res, { ok: false, error: bookingAccess.error }, bookingAccess.statusCode); return; }
          const out = svc.get(bookingId);
          sendJson(res, out, out.ok ? 200 : 404);
          return;
        }
        if (!action && req.method === 'PATCH') {
          const bookingAccess = accessSvc.authorizeSiteVisitBooking(actor, bookingId, { permissions: ['SITE_VISIT_VIEW', 'LEADS_EDIT', 'LEADS_UPDATE'] });
          if (!bookingAccess.ok) { sendJson(res, { ok: false, error: bookingAccess.error }, bookingAccess.statusCode); return; }
          const payload = bodyForV2 || {};
          const propertyIds = Array.isArray(payload.propertyIds) ? payload.propertyIds : (Array.isArray(payload.PropertyIDs) ? payload.PropertyIDs : []);
          for (const propertyId of propertyIds) {
            const property = runtime.repository.find('Inventory', 'PropertyID', propertyId);
            const propertyAccess = accessSvc.authorizeProperty(actor, property, {
              permissions: ['SITE_VISIT_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
              hideExistence: true
            });
            if (!propertyAccess.ok) { sendJson(res, { ok: false, error: propertyAccess.error }, propertyAccess.statusCode); return; }
          }
          const out = svc.update(bookingId, payload, actor);
          sendJson(res, out, out.ok ? 200 : 404);
          return;
        }
        if (action === 'cancel' && req.method === 'POST') {
          const bookingAccess = accessSvc.authorizeSiteVisitBooking(actor, bookingId, { permissions: ['SITE_VISIT_VIEW', 'LEADS_EDIT', 'LEADS_UPDATE'] });
          if (!bookingAccess.ok) { sendJson(res, { ok: false, error: bookingAccess.error }, bookingAccess.statusCode); return; }
          const out = svc.cancel(bookingId, actor);
          sendJson(res, out, out.ok ? 200 : 404);
          return;
        }
        if (action === 'complete' && req.method === 'POST') {
          const bookingAccess = accessSvc.authorizeSiteVisitBooking(actor, bookingId, { permissions: ['SITE_VISIT_VIEW', 'LEADS_EDIT', 'LEADS_UPDATE'] });
          if (!bookingAccess.ok) { sendJson(res, { ok: false, error: bookingAccess.error }, bookingAccess.statusCode); return; }
          const out = svc.complete(bookingId, actor);
          sendJson(res, out, out.ok ? 200 : 404);
          return;
        }
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    // ── Inventory / Property APIs ────────────────────────────────────────────
    const invMatch = pathname.match(/^\/api\/v2\/inventory(?:\/([^\/]+))?(?:\/(photos|photos\/[^\/]+))?\/?$/i);
    if (invMatch) {
      const { InventoryService } = require('./src/services/inventoryService');
      const svc = new InventoryService(runtime.repository);
      const [, propertyId, subRoute] = invMatch;
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const inventoryPermission = req.method === 'GET'
        ? 'INVENTORY_READ'
        : req.method === 'POST'
          ? (subRoute === 'photos' ? 'INVENTORY_UPDATE' : 'INVENTORY_CREATE')
          : req.method === 'PATCH'
            ? 'INVENTORY_UPDATE'
            : req.method === 'DELETE'
              ? 'INVENTORY_DELETE'
              : null;
      if (!inventoryPermission) {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }
      if (!ensurePermissionOrRespond(req, res, url, inventoryPermission)) return;

      // GET /api/v2/inventory
      if (!propertyId && !subRoute && req.method === 'GET') {
        const items = svc.list({
          q:               url.searchParams.get('q') || undefined,
          category:        url.searchParams.get('category') || undefined,
          subCategory:     url.searchParams.get('subCategory') || undefined,
          transactionType: url.searchParams.get('transactionType') || undefined,
          status:          url.searchParams.get('status') || undefined
        }).filter((property) => accessSvc.authorizeProperty(actor, property, {
          permissions: ['INVENTORY_READ'],
          hideExistence: true
        }).ok);
        sendJson(res, { ok: true, data: items, count: items.length });
        return;
      }

      // POST /api/v2/inventory (create)
      if (!propertyId && req.method === 'POST') {
        const body = bodyForV2 || {};
        const created = svc.create(body, actor);
        sendJson(res, { ok: true, data: created }, 201);
        return;
      }

      // GET /api/v2/inventory/:id
      if (propertyId && !subRoute && req.method === 'GET') {
        const p = svc.get(propertyId);
        if (!p) { sendJson(res, { ok: false, error: 'Property not found' }, 404); return; }
        const access = accessSvc.authorizeProperty(actor, p, { permissions: ['INVENTORY_READ'], hideExistence: true });
        if (!access.ok) { sendJson(res, { ok: false, error: access.error }, access.statusCode); return; }
        sendJson(res, { ok: true, data: p });
        return;
      }

      // PATCH /api/v2/inventory/:id
      if (propertyId && !subRoute && req.method === 'PATCH') {
        const existing = svc.get(propertyId);
        const access = accessSvc.authorizeProperty(actor, existing, { permissions: ['INVENTORY_UPDATE'], hideExistence: true });
        if (!access.ok) { sendJson(res, { ok: false, error: access.error }, access.statusCode); return; }
        const updated = svc.update(propertyId, bodyForV2 || {}, actor);
        if (!updated) { sendJson(res, { ok: false, error: 'Property not found' }, 404); return; }
        sendJson(res, { ok: true, data: updated });
        return;
      }

      // DELETE /api/v2/inventory/:id
      if (propertyId && !subRoute && req.method === 'DELETE') {
        const existing = svc.get(propertyId);
        const access = accessSvc.authorizeProperty(actor, existing, { permissions: ['INVENTORY_DELETE'], hideExistence: true });
        if (!access.ok) { sendJson(res, { ok: false, error: access.error }, access.statusCode); return; }
        const ok = svc.remove(propertyId);
        if (!ok) { sendJson(res, { ok: false, error: 'Property not found' }, 404); return; }
        sendJson(res, { ok: true, action: 'DELETED', propertyId });
        return;
      }

      // POST /api/v2/inventory/:id/photos — body: { photos: [dataUrl, ...] }
      if (propertyId && subRoute === 'photos' && req.method === 'POST') {
        const existing = svc.get(propertyId);
        const access = accessSvc.authorizeProperty(actor, existing, { permissions: ['INVENTORY_UPDATE'], hideExistence: true });
        if (!access.ok) { sendJson(res, { ok: false, error: access.error }, access.statusCode); return; }
        const body = bodyForV2 || {};
        const photosArr = Array.isArray(body.photos) ? body.photos : [];
        const photos = svc.uploadPhotos(propertyId, photosArr, actor);
        if (!photos) { sendJson(res, { ok: false, error: 'Property not found' }, 404); return; }
        sendJson(res, { ok: true, data: photos });
        return;
      }

      // DELETE /api/v2/inventory/:id/photos/:photoId
      const delPhotoMatch = pathname.match(/^\/api\/v2\/inventory\/([^\/]+)\/photos\/([^\/]+)\/?$/i);
      if (delPhotoMatch && req.method === 'DELETE') {
        const [, pid, phid] = delPhotoMatch;
        const existing = svc.get(pid);
        const access = accessSvc.authorizeProperty(actor, existing, { permissions: ['INVENTORY_DELETE'], hideExistence: true });
        if (!access.ok) { sendJson(res, { ok: false, error: access.error }, access.statusCode); return; }
        const ok = svc.deletePhoto(pid, phid);
        if (!ok) { sendJson(res, { ok: false, error: 'Photo or property not found' }, 404); return; }
        sendJson(res, { ok: true, action: 'DELETED', propertyId: pid, photoId: phid });
        return;
      }
    }

    // ── Duplicate Review APIs ────────────────────────────────────────────────
    // GET /api/v2/duplicates/pending — list all leads flagged as pending review
    if (/^\/api\/v2\/duplicates\/pending\/?$/i.test(pathname) && req.method === 'GET') {
      if (!ensureAdminPermissionOrRespond(req, res, url, 'ADMIN_READ')) return;
      const db = runtime.repository.read();
      const pending = (db.Leads || []).filter(l => l._reviewStatus === 'PENDING_DUP_MERGE');
      const enriched = pending.map(p => ({
        lead: p,
        candidates: (p._dupCandidates || []).map(id => (db.Leads || []).find(l => l.LeadID === id)).filter(Boolean),
        reason: p._reviewNote || 'Duplicate detected'
      }));
      sendJson(res, { ok: true, data: enriched, count: enriched.length });
      return;
    }

    // POST /api/v2/duplicates/keep-separate — clear pending flag on a lead (keep as new)
    if (/^\/api\/v2\/duplicates\/keep-separate\/?$/i.test(pathname) && req.method === 'POST') {
      if (!ensureAdminPermissionOrRespond(req, res, url, 'ADMIN_UPDATE')) return;
      const body = bodyForV2 || {};
      const leadId = String(body.leadId || '').trim();
      if (!leadId) { sendJson(res, { ok: false, error: 'leadId required' }, 400); return; }
      const db = runtime.repository.read();
      const lead = (db.Leads || []).find(l => l.LeadID === leadId);
      if (!lead) { sendJson(res, { ok: false, error: 'Lead not found' }, 404); return; }
      delete lead._reviewStatus;
      delete lead._dupCandidates;
      delete lead._reviewNote;
      lead.UpdatedAt = new Date().toISOString();
      runtime.repository.write(db);
      sendJson(res, { ok: true, action: 'KEPT_SEPARATE', leadId });
      return;
    }

    // POST /api/v2/duplicates/merge — merge source lead INTO target lead
    // Body: { sourceLeadId, targetLeadId, fieldOverrides: { <field>: 'source'|'target' } }
    // Requirements/Transactions of source are reassigned to target; source lead is deleted.
    if (/^\/api\/v2\/duplicates\/merge\/?$/i.test(pathname) && req.method === 'POST') {
      if (!ensureAdminPermissionOrRespond(req, res, url, 'ADMIN_UPDATE')) return;
      const body = bodyForV2 || {};
      const sourceLeadId = String(body.sourceLeadId || '').trim();
      const targetLeadId = String(body.targetLeadId || '').trim();
      const overrides    = body.fieldOverrides || {};
      if (!sourceLeadId || !targetLeadId) { sendJson(res, { ok: false, error: 'sourceLeadId & targetLeadId required' }, 400); return; }
      if (sourceLeadId === targetLeadId)  { sendJson(res, { ok: false, error: 'Cannot merge into self' }, 400); return; }
      const db = runtime.repository.read();
      const source = (db.Leads || []).find(l => l.LeadID === sourceLeadId);
      const target = (db.Leads || []).find(l => l.LeadID === targetLeadId);
      if (!source || !target) { sendJson(res, { ok: false, error: 'Lead(s) not found' }, 404); return; }

      // Apply per-field overrides ('source' means take from source; default keeps target)
      const mergeableFields = ['ClientName','PrimaryMobile','AlternateMobile','Email','WhatsApp','City','LeadSource','Notes','Tags','ClientStatus','Priority','ClientLifecycle','AssignedAgentID'];
      for (const f of mergeableFields) {
        const choice = overrides[f];
        if (choice === 'source' && source[f] != null && source[f] !== '') target[f] = source[f];
        else if (target[f] == null || target[f] === '') target[f] = source[f]; // fill blanks
      }
      target.UpdatedAt = new Date().toISOString();
      target._mergedFrom = [...(target._mergedFrom || []), sourceLeadId];

      // Reassign transactions + requirements
      (db.Transactions || []).forEach(t => { if (t.LeadID === sourceLeadId) t.LeadID = targetLeadId; });
      (db.Requirements || []).forEach(r => { if (r.LeadID === sourceLeadId) r.LeadID = targetLeadId; });
      (db.Activities   || []).forEach(a => { if (a.LeadID === sourceLeadId) a.LeadID = targetLeadId; });
      (db.FollowUps    || []).forEach(f => { if (f.LeadID === sourceLeadId) f.LeadID = targetLeadId; });

      // Remove source lead
      db.Leads = (db.Leads || []).filter(l => l.LeadID !== sourceLeadId);

      runtime.repository.write(db);
      sendJson(res, { ok: true, action: 'MERGED', sourceLeadId, targetLeadId });
      return;
    }

    // DELETE /api/v2/duplicates/:leadId — hard delete a pending-review lead (was spam)
    const delMatch = pathname.match(/^\/api\/v2\/duplicates\/([^\/]+)\/?$/i);
    if (delMatch && req.method === 'DELETE') {
      if (!ensureAdminPermissionOrRespond(req, res, url, 'ADMIN_UPDATE')) return;
      const leadId = decodeURIComponent(delMatch[1]);
      const db = runtime.repository.read();
      const lead = (db.Leads || []).find(l => l.LeadID === leadId);
      if (!lead) { sendJson(res, { ok: false, error: 'Lead not found' }, 404); return; }
      // Only allow delete on PENDING items to prevent accidental data loss
      if (lead._reviewStatus !== 'PENDING_DUP_MERGE') { sendJson(res, { ok: false, error: 'Only pending-review leads can be deleted here' }, 400); return; }
      db.Leads         = (db.Leads || []).filter(l => l.LeadID !== leadId);
      db.Transactions  = (db.Transactions || []).filter(t => t.LeadID !== leadId);
      db.Requirements  = (db.Requirements || []).filter(r => r.LeadID !== leadId);
      runtime.repository.write(db);
      sendJson(res, { ok: true, action: 'DELETED', leadId });
      return;
    }

    // ── Google Sheet Sync Webhook ────────────────────────────────────────────
    if (/^\/api\/sync\/google-sheet\/?$/i.test(pathname) && req.method === 'POST') {
      const { GoogleSheetSyncService } = require('./src/services/googleSheetSyncService');
      const svc = new GoogleSheetSyncService(runtime.repository);
      const configuredSyncToken = String(process.env.SHEET_SYNC_TOKEN || '').trim();
      if (!configuredSyncToken || configuredSyncToken === 'CHANGE_ME_SECRET') {
        sendJson(res, { ok: false, error: 'Sync token is not configured' }, 503);
        return;
      }
      const token = req.headers['x-sync-token'] || req.headers['X-Sync-Token'] || '';
      if (!svc.verifyToken(token)) {
        sendJson(res, { ok: false, error: 'Invalid sync token' }, 401);
        return;
      }
      const body = bodyForV2 || {};
      const tab  = String(body.tab || '').trim();
      const rows = Array.isArray(body.rows) ? body.rows : (body.row ? [body.row] : []);
      if (!tab || !rows.length) {
        sendJson(res, { ok: false, error: 'tab + rows[] required' }, 400);
        return;
      }
      const results = await svc.syncRows(tab, rows);
      const created = results.filter(r => r.action === 'CREATED').length;
      const updated = results.filter(r => r.action === 'UPDATED').length;
      const failed  = results.filter(r => !r.ok).length;
      sendJson(res, { ok: true, tab, summary: { created, updated, failed, total: results.length }, results }, 200);
      return;
    }

    // ── Simple sheet setup instructions endpoint ─────────────────────────────
    if (/^\/api\/sync\/google-sheet\/setup\/?$/i.test(pathname) && req.method === 'GET') {
      if (!ensureAdminPermissionOrRespond(req, res, url, 'ADMIN_READ')) return;
      const appUrl = String(process.env.APP_URL || '').trim() || `http://localhost:${process.env.PORT || 3000}`;
      sendJson(res, {
        ok: true,
        data: {
          webhookUrl: `${appUrl}/api/sync/google-sheet`,
          syncTokenConfigured: Boolean(String(process.env.SHEET_SYNC_TOKEN || '').trim() && String(process.env.SHEET_SYNC_TOKEN || '').trim() !== 'CHANGE_ME_SECRET'),
          instructions: 'Copy /app/scripts/apps-script-webhook.gs code and paste in your Google Sheet Extensions → Apps Script'
        }
      });
      return;
    }

    if (/^\/api\/sync\/google-sheet\/export\/?$/i.test(pathname) && req.method === 'GET') {
      if (!ensureAdminPermissionOrRespond(req, res, url, 'ADMIN_READ')) return;
      const leads = typeof runtime.repository.listLeads === 'function' ? runtime.repository.listLeads() : [];
      sendJson(res, { ok: true, data: leads });
      return;
    }

    const v2Result = await v2Router.handle(req, res, url, bodyForV2);
    if (v2Result && v2Result.handled) {
      sendJson(res, v2Result.body, v2Result.statusCode || 200);
      return;
    }
    // ── End V2 Router ─────────────────────────────────────────────────────────

    if (pathname === '/health' && req.method === 'GET') {
      sendJson(res, { ok: true });
      return;
    }

    if (pathname === '/api/auth/test-session' && req.method === 'POST') {
      if (!isExplicitTestRuntime() && !isLoopbackRequest(req)) {
        sendJson(res, { ok: false, error: 'Not found' }, 404);
        return;
      }
      const secret = getConfiguredTestSessionSecret();
      const body = bodyForV2 || {};
      const user = findLoginUser(body);
      if (!secret || !user || !safeSecretEquals(body.secret, secret)) {
        sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
        return;
      }
      const token = runtime.auth.issueSession({
        userId: user.UserID,
        companyId: user.CompanyID || user.CompanyId || '',
        brokerageId: user.BrokerageID || user.BrokerageId || '',
        role: user.Role || 'AGENT',
        permissions: Array.isArray(user.Permissions) ? user.Permissions : []
      });
      setSessionCookie(res, req, token);
      sendJson(res, { ok: true, data: { token, userId: user.UserID } });
      return;
    }

    if (pathname === '/api/auth/login-state' && req.method === 'GET') {
      const nextPath = sanitizeAuthNextPath(url?.searchParams?.get('next') || '/');
      const authStateMaxAgeSeconds = getAuthExchangeStateMaxAgeSeconds(runtime?.repository);
      const googleAuth = resolveGoogleOAuthConfig();
      if (!googleAuth.enabled && (isProductionLikeRuntime() || isProductionRuntime())) {
        logAuthEvent('login_state_rejected', { reason: 'google_oauth_not_configured', nextPath });
        sendJson(res, { ok: false, error: 'Google sign-in is not configured' }, 503);
        return;
      }
      let signInUrl = resolveAuthSignInUrl();
      let authMode = 'provider_session';
      let redirectUri = '';
      const browserFlowId = crypto.randomBytes(24).toString('hex');
      let state = issueAuthExchangeState('', authStateMaxAgeSeconds);
      const providerRedirectUri = resolveGoogleOAuthRedirectUrl(req, nextPath);
      if (!providerRedirectUri) {
        sendJson(res, { ok: false, error: 'Unable to start Google sign-in' }, 500);
        return;
      }
      const providerCallbackUrl = new URL(providerRedirectUri);
      providerCallbackUrl.searchParams.set('auth_state', state);
      const providerSignInUrl = new URL(signInUrl);
      providerSignInUrl.searchParams.set('redirect', providerCallbackUrl.toString());
      signInUrl = providerSignInUrl.toString();
      if (googleAuth.enabled) {
        redirectUri = resolveGoogleOAuthRedirectUrl(req, nextPath);
        if (!redirectUri) {
          sendJson(res, { ok: false, error: 'Unable to start Google sign-in' }, 500);
          return;
        }
        state = issueAuthExchangeState(redirectUri, authStateMaxAgeSeconds);
        const authorizeUrl = new URL(resolveGoogleOAuthAuthorizeUrl());
        authorizeUrl.searchParams.set('client_id', googleAuth.clientId);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('scope', resolveGoogleOAuthScopes());
        authorizeUrl.searchParams.set('state', state);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        signInUrl = authorizeUrl.toString();
        authMode = 'google_oauth_code';
      }
      await persistAuthExchangeState(runtime?.repository, buildAuthExchangeStateRecord({
        state,
        redirectUri,
        nextPath,
        maxAgeSeconds: authStateMaxAgeSeconds,
        browserFlowId,
        authMode
      }));
      const signInHost = (() => {
        try { return new URL(signInUrl).host; } catch (_) { return ''; }
      })();
      logAuthEvent('login_state_issued', { signInHost, authMode, nextPath });
      sendJson(
        res,
        { ok: true, data: { state, signInUrl, authMode, browserFlowId, redirectUri } },
        200,
        { 'Set-Cookie': buildAuthFlowCookies(req, { state, nextPath, maxAgeSeconds: authStateMaxAgeSeconds }) }
      );
      return;
    }

    if (isAuthSessionExchangePath && req.method === 'POST') {
      const body = await readJson(req);
      const sessionId = String(body?.session_id || body?.sessionId || '').trim();
      const authCode = String(body?.code || body?.authorization_code || body?.authorizationCode || '').trim();
      const redirectUri = authCode
        ? String(body?.redirect_uri || body?.redirectUri || '').trim() || resolveGoogleOAuthRedirectUrl(req)
        : '';
      const state = String(body?.state || '').trim();
      const browserFlowId = String(body?.browser_flow_id || body?.browserFlowId || '').trim();
      let nextPath = sanitizeAuthNextPath(parseCookies(req.headers || {})[AUTH_NEXT_PATH_COOKIE_NAME] || '/');
      if (!sessionId && !authCode) {
        logAuthEvent('session_exchange_rejected', { reason: 'missing_session_artifact' });
        sendJson(res, { ok: false, error: 'session_id or code is required' }, 400);
        return;
      }
      if (authCode && !redirectUri) {
        logAuthEvent('session_exchange_rejected', { reason: 'missing_redirect_uri' });
        sendJson(res, { ok: false, error: 'redirect_uri is required' }, 400);
        return;
      }
      const consumedState = await consumeAuthExchangeState(
        req.headers || {},
        state,
        authCode ? redirectUri : '',
        { repository: runtime?.repository, browserFlowId }
      );
      if (!consumedState.ok) {
        logAuthEvent('session_exchange_rejected', { reason: consumedState.reason || 'invalid_auth_state' });
        sendJson(
          res,
          { ok: false, error: consumedState.error },
          400,
          { 'Set-Cookie': buildAuthFlowCookies(req, { state: '', nextPath: '/', maxAgeSeconds: 0 }) }
        );
        return;
      }
      nextPath = sanitizeAuthNextPath(consumedState.nextPath || nextPath || '/');

      let remote;
      try {
        if (authCode) {
          remote = await fetchGoogleIdentityFromAuthCode(authCode, redirectUri);
        } else {
          remote = await fetchAuthProviderSessionData(sessionId);
        }
      } catch (error) {
        logAuthEvent('session_exchange_provider_unavailable', { statusCode: 502, error: error.message });
        sendJson(
          res,
          { ok: false, error: `Auth provider unavailable: ${error.message}` },
          502,
          { 'Set-Cookie': buildAuthFlowCookies(req, { state: '', nextPath: '/', maxAgeSeconds: 0 }) }
        );
        return;
      }

      if (!remote.ok) {
        const statusCode = remote.statusCode >= 500 ? 502 : remote.statusCode;
        const error = remote.statusCode >= 500
          ? `Auth provider error: ${remote.error}`
          : (remote.error || 'Unauthorized');
        logAuthEvent('session_exchange_provider_rejected', {
          statusCode,
          providerStatusCode: remote.statusCode,
          error
        });
        sendJson(
          res,
          { ok: false, error },
          statusCode,
          { 'Set-Cookie': buildAuthFlowCookies(req, { state: '', nextPath: '/', maxAgeSeconds: 0 }) }
        );
        return;
      }

      const user = findActiveUserByEmail(remote.identity.email);
      if (!user) {
        logAuthEvent('session_exchange_rejected', {
          reason: 'unauthorized_google_account',
          email: remote.identity.email
        });
        sendJson(
          res,
          { ok: false, error: 'This Google account is not authorized.' },
          403,
          { 'Set-Cookie': buildAuthFlowCookies(req, { state: '', nextPath: '/', maxAgeSeconds: 0 }) }
        );
        return;
      }

      const companyId = String(user.CompanyID || user.CompanyId || '').trim();
      const brokerageId = String(user.BrokerageID || user.BrokerageId || '').trim();
      if (!companyId || !brokerageId) {
        logAuthEvent('session_exchange_rejected', {
          reason: 'missing_tenant_scope',
          userId: user.UserID,
          email: remote.identity.email
        });
        sendJson(
          res,
          { ok: false, error: 'Tenant scope required' },
          403,
          { 'Set-Cookie': buildAuthFlowCookies(req, { state: '', nextPath: '/', maxAgeSeconds: 0 }) }
        );
        return;
      }

      const localSessionId = runtime.auth.issueSession({
        userId: user.UserID,
        role: user.Role,
        companyId,
        brokerageId,
        permissions: Array.isArray(user.Permissions) ? user.Permissions : []
      });
      logAuthEvent('session_exchange_succeeded', {
        userId: user.UserID,
        role: String(user.Role || '').trim().toUpperCase(),
        email: remote.identity.email
      });
      sendJson(res, {
        ok: true,
        data: {
          userId: user.UserID,
          role: String(user.Role || '').trim().toUpperCase(),
          name: user.Name || remote.identity.name || '',
          email: String(user.Email || '').trim().toLowerCase(),
          redirectTo: nextPath
        }
      }, 200, appendSetCookie({
        'Set-Cookie': sessionCookieValue(req, localSessionId)
      }, buildAuthFlowCookies(req, { state: '', nextPath: '/', maxAgeSeconds: 0 })));
      return;
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const context = runtime.auth.resolveRequestContext({
        headers: req.headers || {},
        pathname
      });
      if (!context.authenticated || context.public || !context.userId) {
        sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
        return;
      }
      const user = runtime.repository.getUser(context.userId);
      sendJson(res, {
        ok: true,
        data: {
          userId: context.userId,
          role: context.role,
          name: user?.Name || '',
          email: String(user?.Email || '').trim().toLowerCase()
        }
      });
      return;
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const context = runtime.auth.resolveRequestContext({
        headers: req.headers || {},
        pathname
      });
      if (context.authenticated && !context.public && context.sessionId) {
        runtime.auth.revokeSession(context.sessionId);
      }
      sendJson(res, { ok: true }, 200, {
        'Set-Cookie': sessionCookieValue(req, '', { clear: true })
      });
      return;
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      sendJson(res, { ok: false, error: 'Not found' }, 404);
      return;
    }

      if (pathname === '/api/public/properties' && req.method === 'GET') {
      const payload = await runtime.listPublicProperties();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/public/projects' && req.method === 'GET') {
      const payload = await runtime.listPublicProjects();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/dashboard') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      if (!ensurePermissionOrRespond(req, res, url, 'REPORT_READ')) return;
      const payload = await runtime.dashboard();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/leads' && req.method === 'POST') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      if (!ensurePermissionOrRespond(req, res, url, 'LEADS_CREATE')) return;
      const body = await readJson(req);
      const payload = await runtime.createLead({
        ...body,
        AssignedAgentID: body.AssignedAgentID || body.assignedAgentId || actor.userId,
        CompanyID: actor.companyId || actor.companyID || null,
        BrokerageID: actor.brokerageId || actor.brokerageID || null,
        CreatedBy: actor.userId
      });
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/leads' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      if (!ensurePermissionOrRespond(req, res, url, 'LEADS_READ')) return;
      const payload = await runtime.leads();
      if (payload?.ok && Array.isArray(payload.data)) {
        payload.data = accessSvc.filterReadableLeads(payload.data, actor);
      }
      sendJson(res, payload);
      return;
    }

    if (pathname.startsWith('/api/leads/')) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const match = pathname.match(/^\/api\/leads\/([^/]+)(?:\/([^/]+))?$/);

      if (!match) {
        sendJson(res, { ok: false, error: 'Bad lead path' }, 400);
        return;
      }

      const leadId = match[1];
      const subPath = match[2];
      const existingLead = await runtime.readLead(leadId);
      const leadPermission = req.method === 'PATCH' || (req.method === 'POST' && ['requirements', 'activity'].includes(subPath))
        ? 'LEADS_UPDATE'
        : 'LEADS_READ';
      const leadAccess = accessSvc.authorizeLead(actor, existingLead?.data, {
        permissions: [leadPermission],
        hideExistence: req.method === 'PATCH' ? false : true
      });
      if (!leadAccess.ok) {
        sendJson(res, { ok: false, error: leadAccess.error }, leadAccess.statusCode);
        return;
      }

      if (req.method === 'GET') {
        if (subPath === 'workspace') {
          const workspace = await runtime.getLeadWorkspace(leadId);
          sendJson(res, workspace);
          return;
        }

        if (subPath === 'requirements') {
          const payload = await runtime.getLeadRequirements(leadId);
          sendJson(res, payload);
          return;
        }

        if (subPath === 'activity') {
          const payload = await runtime.getLeadActivity(leadId);
          sendJson(res, payload);
          return;
        }

        const lead = await runtime.readLead(leadId);
        sendJson(res, lead);
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const existing = existingLead;
        if (!existing.ok) { sendJson(res, { ok: false, error: 'Lead not found' }, 404); return; }
        const scope = tenantCheck(existing.data, actor);
        if (!scope.ok) { sendJson(res, { ok: false, error: 'Forbidden' }, 403); return; }
        const payload = await runtime.updateLead(leadId, { ...body, params: { leadId } });
        sendJson(res, payload);
        return;
      }

      if (req.method === 'POST') {
        if (subPath === 'requirements') {
          const body = await readJson(req);
          const payload = await runtime.createRequirement(leadId, body.transactionId || 'TXN-0001', body);
          sendJson(res, payload);
          return;
        }

        if (subPath === 'activity') {
          const body = await readJson(req);
          const payload = await runtime.addActivity(leadId, body);
          sendJson(res, payload);
          return;
        }
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/transactions') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      if (!ensurePermissionOrRespond(req, res, url, 'TRANSACTIONS_READ')) return;
      const payload = await runtime.router.route('transactions', 'list');
      if (payload?.ok && Array.isArray(payload.data)) {
        payload.data = payload.data.filter((transaction) => accessSvc.authorizeTransaction(actor, transaction, {
          permissions: ['TRANSACTIONS_READ'],
          hideExistence: true
        }).ok);
      }
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/followups') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const followUpPermission = req.method === 'GET' ? 'LEADS_READ' : req.method === 'POST' ? 'LEADS_UPDATE' : null;
      if (!followUpPermission) {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }
      if (!ensurePermissionOrRespond(req, res, url, followUpPermission)) return;
      if (req.method === 'GET') {
        const leadId = url.searchParams.get('leadId') || url.searchParams.get('LeadID') || undefined;
        const requirementId = url.searchParams.get('requirementId') || url.searchParams.get('RequirementID') || undefined;
        const payload = await runtime.listFollowUps({
          LeadID: leadId,
          RequirementID: requirementId
        });
        if (payload?.ok && Array.isArray(payload.data)) {
          payload.data = payload.data.filter((followUp) => accessSvc.authorizeFollowUp(actor, followUp, {
            permissions: ['LEADS_READ'],
            hideExistence: true
          }).ok);
        }
        sendJson(res, payload);
        return;
      }

      if (req.method === 'POST') {
        const body = await readJson(req);
        const lead = runtime.repository.readLead(body.leadId || body.LeadID);
        const leadAccess = accessSvc.authorizeLead(actor, lead, {
          permissions: ['LEADS_UPDATE', 'LEADS_READ'],
          hideExistence: true
        });
        if (!leadAccess.ok) {
          sendJson(res, { ok: false, error: leadAccess.error }, leadAccess.statusCode);
          return;
        }
        if (body.requirementId || body.RequirementID) {
          const requirement = runtime.repository.readRequirement(body.requirementId || body.RequirementID);
          const requirementAccess = accessSvc.authorizeRequirement(actor, requirement, {
            permissions: ['REQUIREMENTS_READ', 'LEADS_READ'],
            hideExistence: true
          });
          if (!requirementAccess.ok) {
            sendJson(res, { ok: false, error: requirementAccess.error }, requirementAccess.statusCode);
            return;
          }
        }
        const payload = await runtime.createFollowUp({
          ...body,
          CompanyID: actor.companyId || actor.companyID || null,
          BrokerageID: actor.brokerageId || actor.brokerageID || null,
          CreatedBy: actor.userId,
          AssignedUser: body.AssignedUser || body.assignedUser || actor.userId
        });
        sendJson(res, payload, 201);
        return;
      }
    }

    if (pathname === '/api/inventory' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      if (!ensurePermissionOrRespond(req, res, url, 'INVENTORY_READ')) return;
      const payload = await runtime.listInventory();
      if (payload?.ok && Array.isArray(payload.data)) {
        payload.data = payload.data.filter((property) => accessSvc.authorizeProperty(actor, property, {
          permissions: ['INVENTORY_READ'],
          hideExistence: true
        }).ok);
      }
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/inventory' && req.method === 'POST') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      if (!ensurePermissionOrRespond(req, res, url, 'INVENTORY_CREATE')) return;
      const body = await readJson(req);
      const payload = await runtime.createInventoryProperty(body, actor);
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/requirements' && req.method === 'POST') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      if (!ensurePermissionOrRespond(req, res, url, 'REQUIREMENTS_CREATE')) return;
      const body = await readJson(req);
      const leadId = body.leadId || body.LeadID;
      const lead = runtime.repository.readLead(leadId);
      const leadAccess = accessSvc.authorizeLead(actor, lead, {
        permissions: ['REQUIREMENTS_CREATE', 'LEADS_READ'],
        hideExistence: true
      });
      if (!leadAccess.ok) {
        sendJson(res, { ok: false, error: leadAccess.error }, leadAccess.statusCode);
        return;
      }
      const payload = await runtime.createRequirement(
        leadId,
        body.transactionId || body.TransactionID || 'TXN-0001',
        {
          ...body,
          CompanyID: actor.companyId || actor.companyID || null,
          BrokerageID: actor.brokerageId || actor.brokerageID || null,
          CreatedBy: actor.userId
        }
      );
      sendJson(res, payload);
      return;
    }

    if (pathname.startsWith('/api/requirements/') && pathname.endsWith('/matches')) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const parts = pathname.split('/').filter(Boolean);
      const requirementId = parts[2];
      const requirement = runtime.repository.readRequirement(requirementId);
      const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
        permissions: ['MATCHING_VIEW', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ']
      });
      if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
      const payload = await runtime.getMatches(requirementId);
      if (payload.ok && Array.isArray(payload.data)) {
        payload.data = payload.data.filter((row) => {
          const property = runtime.repository.find('Inventory', 'PropertyID', row.PropertyID);
          return accessSvc.authorizeProperty(actor, property, {
            permissions: ['MATCHING_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
            hideExistence: true
          }).ok;
        });
      }
      sendJson(res, payload);
      return;
    }

    if (pathname.startsWith('/api/requirements/') && pathname.endsWith('/shortlist')) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const parts = pathname.split('/').filter(Boolean);
      const requirementId = parts[2];
      const requirement = runtime.repository.readRequirement(requirementId);
      const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
        permissions: ['SHORTLIST_VIEW', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ']
      });
      if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
      const status = url.searchParams.get('status') || undefined;
      const payload = await runtime.listShortlist({ requirementId, status });
      if (payload.ok && Array.isArray(payload.data)) {
        payload.data = payload.data.filter((row) => {
          const property = runtime.repository.find('Inventory', 'PropertyID', row.PropertyID);
          return accessSvc.authorizeProperty(actor, property, {
            permissions: ['SHORTLIST_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
            hideExistence: true
          }).ok;
        });
      }
      sendJson(res, payload);
      return;
    }

    if (pathname.startsWith('/api/requirements/')) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const match = pathname.match(/^\/api\/requirements\/([^/]+)(?:\/archive)?$/);
      if (!match) {
        sendJson(res, { ok: false, error: 'Bad requirements path' }, 400);
        return;
      }

      const requirementId = match[1];
      const existing = await runtime.readRequirement(requirementId);
      const requirementPermission = req.method === 'GET'
        ? 'REQUIREMENTS_READ'
        : req.method === 'DELETE'
          ? 'REQUIREMENTS_DELETE'
          : 'REQUIREMENTS_UPDATE';
      const requirementAccess = accessSvc.authorizeRequirement(actor, existing?.data, {
        permissions: [requirementPermission, 'LEADS_READ'],
        hideExistence: req.method === 'GET'
      });
      if (!requirementAccess.ok) {
        sendJson(res, { ok: false, error: requirementAccess.error }, requirementAccess.statusCode);
        return;
      }

      if (req.method === 'GET') {
        sendJson(res, existing);
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const payload = await runtime.updateRequirement(requirementId, body);
        sendJson(res, payload);
        return;
      }

      if (req.method === 'DELETE') {
        const payload = await runtime.deleteRequirement(requirementId);
        sendJson(res, payload);
        return;
      }

      if (req.method === 'POST' && pathname.endsWith('/archive')) {
        const payload = await runtime.archiveRequirement(requirementId);
        sendJson(res, payload);
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/forms' || pathname.startsWith('/api/forms/')) {
      const parts = pathname.split('/').filter(Boolean);
      const formType = parts[2] || 'residential';
      const config = await runtime.formConfig(formType);
      sendJson(res, { ok: true, data: config });
      return;
    }

    if (pathname === '/api/requirements' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      if (!ensurePermissionOrRespond(req, res, url, 'REQUIREMENTS_READ')) return;
      const payload = await runtime.requirements();
      if (payload?.ok && Array.isArray(payload.data)) {
        payload.data = payload.data.filter((requirement) => accessSvc.authorizeRequirement(actor, requirement, {
          permissions: ['REQUIREMENTS_READ', 'LEADS_READ'],
          hideExistence: true
        }).ok);
      }
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/matching/run' && req.method === 'POST') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const body = await readJson(req);
      const requirementId = body.requirementId || body.requirementID;
      if (!requirementId) {
        sendJson(res, { ok: false, error: 'requirementId required' }, 400);
        return;
      }
      const requirement = runtime.repository.readRequirement(requirementId);
      const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
        permissions: ['MATCHING_VIEW', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ']
      });
      if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
      const payload = await runtime.runMatching(requirementId);
      if (payload.ok && Array.isArray(payload.data?.matches)) {
        payload.data.matches = payload.data.matches.filter((row) => {
          const property = runtime.repository.find('Inventory', 'PropertyID', row.PropertyID);
          return accessSvc.authorizeProperty(actor, property, {
            permissions: ['MATCHING_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
            hideExistence: true
          }).ok;
        });
      }
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/matching') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const payload = await runtime.matching();
      if (payload.ok && Array.isArray(payload.data)) {
        payload.data = payload.data.filter((row) => {
          const requirement = runtime.repository.readRequirement(row.RequirementID);
          const requirementAccess = accessSvc.authorizeRequirement(actor, requirement, {
            permissions: ['MATCHING_VIEW', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ'],
            hideExistence: true
          });
          if (!requirementAccess.ok) return false;
          const property = runtime.repository.find('Inventory', 'PropertyID', row.PropertyID);
          return accessSvc.authorizeProperty(actor, property, {
            permissions: ['MATCHING_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
            hideExistence: true
          }).ok;
        });
      }
      sendJson(res, payload);
      return;
    }

    if (pathname.startsWith('/api/matches/')) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const matchId = pathname.split('/').pop();
      const payload = await runtime.getMatch(matchId);
      if (payload?.ok && payload.data) {
        const requirement = runtime.repository.readRequirement(payload.data.RequirementID);
        const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
          permissions: ['MATCHING_VIEW', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ']
        });
        if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
        const property = runtime.repository.find('Inventory', 'PropertyID', payload.data.PropertyID);
        const propertyAccess = accessSvc.authorizeProperty(actor, property, {
          permissions: ['MATCHING_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
          hideExistence: true
        });
        if (!propertyAccess.ok) { sendJson(res, { ok: false, error: propertyAccess.error }, propertyAccess.statusCode); return; }
      }
      sendJson(res, payload);
      return;
    }

    if (pathname === '/public' || pathname === '/public/') {
      const publicProperties = await runtime.listPublicProperties();
      const publicProjects = await runtime.listPublicProjects();
      const propertyCards = (publicProperties.data || []).slice(0, 12).map((property) => `
        <article class="card">
          <div class="eyebrow">${escapeHtml(property.PropertyType || 'Property')}</div>
          <h3>${escapeHtml(property.Project || property.PropertyID || 'Property')}</h3>
          <p>${escapeHtml(property.Location || 'Location unavailable')}</p>
          <div class="meta">₹${escapeHtml(Number(property.Price || 0).toLocaleString('en-IN'))}</div>
        </article>
      `).join('') || '<p class="empty">No public properties yet.</p>';

      const projectCards = (publicProjects.data || []).slice(0, 12).map((project) => `
        <article class="card">
          <div class="eyebrow">Project</div>
          <h3>${escapeHtml(project.ProjectName || project.ProjectID || 'Project')}</h3>
          <p>${escapeHtml(project.Location || 'Location unavailable')}</p>
          <div class="meta">${escapeHtml(project.BuilderID || 'Builder information unavailable')}</div>
        </article>
      `).join('') || '<p class="empty">No public projects yet.</p>';

      sendHtml(res, `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Signature Properties | Public Portfolio</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f5f7fb; color: #17212f; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 40px 20px 80px; }
    .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
    .brand { font-size: 2rem; font-weight: 700; }
    .subtitle { color: #52607a; margin-top: 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
    .card { background: #fff; border-radius: 16px; padding: 18px; box-shadow: 0 10px 25px rgba(17,24,39,0.06); }
    .eyebrow { text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; font-size: 11px; margin-bottom: 8px; }
    h3 { margin: 0 0 10px; font-size: 1.2rem; }
    p { margin: 0 0 10px; color: #475569; }
    .meta { color: #0f172a; font-weight: 600; }
    .empty { color: #64748b; }
    .section { margin-top: 36px; }
    .section h2 { margin: 0 0 18px; font-size: 1.4rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div>
        <div class="brand">Signature Properties</div>
        <div class="subtitle">Public portfolio</div>
      </div>
    </div>

    <section class="section">
      <h2>Public Properties</h2>
      <div class="grid">${propertyCards}</div>
    </section>

    <section class="section">
      <h2>Public Projects</h2>
      <div class="grid">${projectCards}</div>
    </section>
  </div>
</body>
</html>`);
      return;
    }

    if (pathname === '/api/broker/share') {
      if (req.method === 'POST') {
        const body = await readJson(req);
        const actor = getAuthenticatedActor(req, url);
        const requirementAccess = accessSvc.authorizeRequirement(actor, runtime.repository.readRequirement(body.requirementId), {
          permissions: ['BROKER_NETWORK_CREATE', 'REQUIREMENTS_READ', 'LEADS_READ'],
          hideExistence: true
        });
        if (!requirementAccess.ok) {
          sendJson(res, { ok: false, error: requirementAccess.error }, requirementAccess.statusCode);
          return;
        }
        const payload = await runtime.brokerShare(body.requirementId, body.brokerId);
        sendJson(res, { ok: true, data: payload });
      } else {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      }
      return;
    }

    if (pathname === '/api/site-visits' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const payload = await runtime.listSiteVisits();
      if (payload.ok && Array.isArray(payload.data)) {
        payload.data = payload.data.filter((row) => {
          const lead = runtime.repository.readLead(row.LeadID);
          const leadAccess = accessSvc.authorizeLead(actor, lead, {
            permissions: ['SITE_VISIT_VIEW', 'LEADS_VIEW', 'LEADS_READ'],
            hideExistence: true
          });
          if (!leadAccess.ok) return false;
          const property = runtime.repository.find('Inventory', 'PropertyID', row.PropertyID);
          return accessSvc.authorizeProperty(actor, property, {
            permissions: ['SITE_VISIT_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
            hideExistence: true
          }).ok;
        });
      }
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/site-visits' && req.method === 'POST') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const body = await readJson(req);
      const lead = runtime.repository.readLead(body.leadId || body.LeadID);
      const leadAccess = accessSvc.authorizeLead(actor, lead, {
        permissions: ['SITE_VISIT_VIEW', 'LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_READ']
      });
      if (!leadAccess.ok) { sendJson(res, { ok: false, error: leadAccess.error }, leadAccess.statusCode); return; }
      const requirement = runtime.repository.readRequirement(body.requirementId || body.RequirementID);
      const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
        permissions: ['SITE_VISIT_VIEW', 'REQUIREMENTS_EDIT', 'REQUIREMENTS_UPDATE', 'REQUIREMENTS_READ']
      });
      if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
      const property = runtime.repository.find('Inventory', 'PropertyID', body.propertyId || body.PropertyID);
      const propertyAccess = accessSvc.authorizeProperty(actor, property, {
        permissions: ['SITE_VISIT_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
        hideExistence: true
      });
      if (!propertyAccess.ok) { sendJson(res, { ok: false, error: propertyAccess.error }, propertyAccess.statusCode); return; }
      const payload = await runtime.createSiteVisit(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname.startsWith('/api/site-visits/')) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const visitId = pathname.split('/').filter(Boolean)[2];
      if (!visitId) {
        sendJson(res, { ok: false, error: 'Bad site visits path' }, 400);
        return;
      }
      const currentVisit = runtime.repository.getSiteVisit(visitId);
      const lead = currentVisit?.ok ? runtime.repository.readLead(currentVisit.data.LeadID) : null;
      const visitAccess = currentVisit?.ok && lead
        ? accessSvc.authorizeLead(actor, lead, {
            permissions: ['SITE_VISIT_VIEW', 'LEADS_VIEW', 'LEADS_READ'],
            hideExistence: true
          })
        : { ok: false, statusCode: 404, error: 'Not found' };
      if (!visitAccess.ok) { sendJson(res, { ok: false, error: visitAccess.error }, visitAccess.statusCode); return; }
      const property = runtime.repository.find('Inventory', 'PropertyID', currentVisit.data.PropertyID);
      const propertyAccess = accessSvc.authorizeProperty(actor, property, {
        permissions: ['SITE_VISIT_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
        hideExistence: true
      });
      if (!propertyAccess.ok) { sendJson(res, { ok: false, error: propertyAccess.error }, propertyAccess.statusCode); return; }

      if (req.method === 'GET') {
        sendJson(res, currentVisit, 200);
        return;
      }

      if (req.method === 'PATCH' && pathname.endsWith('/confirm')) {
        const payload = await runtime.confirmSiteVisit(visitId);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'PATCH' && pathname.endsWith('/reschedule')) {
        const body = await readJson(req);
        const payload = await runtime.rescheduleSiteVisit(visitId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'PATCH' && pathname.endsWith('/complete')) {
        const payload = await runtime.completeSiteVisit(visitId);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'PATCH' && pathname.endsWith('/cancel')) {
        const payload = await runtime.cancelSiteVisit(visitId);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'PATCH' && pathname.endsWith('/no-show')) {
        const payload = await runtime.markSiteVisitNoShow(visitId);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const payload = await runtime.updateSiteVisit(visitId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/shortlist' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const requirementId = url.searchParams.get('requirementId') || undefined;
      const leadId = url.searchParams.get('leadId') || undefined;
      const status = url.searchParams.get('status') || undefined;
      if (requirementId) {
        const requirement = runtime.repository.readRequirement(requirementId);
        const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
          permissions: ['SHORTLIST_VIEW', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ']
        });
        if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
      } else if (leadId) {
        const lead = runtime.repository.readLead(leadId);
        const leadAccess = accessSvc.authorizeLead(actor, lead, {
          permissions: ['SHORTLIST_VIEW', 'LEADS_VIEW', 'LEADS_READ']
        });
        if (!leadAccess.ok) { sendJson(res, { ok: false, error: leadAccess.error }, leadAccess.statusCode); return; }
      }
      const payload = await runtime.listShortlist({ requirementId, leadId, status });
      if (payload.ok && Array.isArray(payload.data)) {
        payload.data = payload.data.filter((row) => {
          const requirement = runtime.repository.readRequirement(row.RequirementID);
          const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
            permissions: ['SHORTLIST_VIEW', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ'],
            hideExistence: true
          });
          if (!reqAccess.ok) return false;
          const property = runtime.repository.find('Inventory', 'PropertyID', row.PropertyID);
          return accessSvc.authorizeProperty(actor, property, {
            permissions: ['SHORTLIST_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
            hideExistence: true
          }).ok;
        });
      }
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/shortlist' && req.method === 'POST') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const body = await readJson(req);
      const requirement = runtime.repository.readRequirement(body.requirementId || body.RequirementID);
      const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
        permissions: ['SHORTLIST_VIEW', 'REQUIREMENTS_EDIT', 'REQUIREMENTS_UPDATE', 'REQUIREMENTS_READ']
      });
      if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
      const property = runtime.repository.find('Inventory', 'PropertyID', body.propertyId || body.PropertyID);
      const propertyAccess = accessSvc.authorizeProperty(actor, property, {
        permissions: ['SHORTLIST_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
        hideExistence: true
      });
      if (!propertyAccess.ok) { sendJson(res, { ok: false, error: propertyAccess.error }, propertyAccess.statusCode); return; }
      const payload = await runtime.addToShortlist(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname.startsWith('/api/shortlist/')) {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      const shortlistId = pathname.split('/').filter(Boolean)[2];
      const shortlist = runtime.repository.getShortlist(shortlistId);
      const requirement = shortlist ? runtime.repository.readRequirement(shortlist.RequirementID) : null;
      const reqAccess = accessSvc.authorizeRequirement(actor, requirement, {
        permissions: ['SHORTLIST_VIEW', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ'],
        hideExistence: true
      });
      if (!reqAccess.ok) { sendJson(res, { ok: false, error: reqAccess.error }, reqAccess.statusCode); return; }
      const property = shortlist ? runtime.repository.find('Inventory', 'PropertyID', shortlist.PropertyID) : null;
      const propertyAccess = accessSvc.authorizeProperty(actor, property, {
        permissions: ['SHORTLIST_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
        hideExistence: true
      });
      if (!propertyAccess.ok) { sendJson(res, { ok: false, error: propertyAccess.error }, propertyAccess.statusCode); return; }

      if (req.method === 'GET') {
        const payload = await runtime.getShortlist(shortlistId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const payload = await runtime.updateShortlist(shortlistId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'POST' && pathname.endsWith('/remove')) {
        const body = await readJson(req);
        const payload = await runtime.removeFromShortlist(shortlistId, body.removedBy || body.RemovedBy || 'system');
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/negotiations' && req.method === 'GET') {
      const payload = await runtime.listNegotiations();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/negotiations' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await runtime.createNegotiation(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname.startsWith('/api/negotiations/')) {
      const negotiationId = pathname.split('/').filter(Boolean)[2];
      if (!negotiationId) {
        sendJson(res, { ok: false, error: 'Bad negotiation path' }, 400);
        return;
      }
      const action = pathname.split('/').filter(Boolean)[3] || null;
      if (req.method === 'GET') {
        if (action === 'history') {
          const payload = await runtime.getNegotiationHistory(negotiationId);
          sendJson(res, payload, payload.ok ? 200 : 404);
          return;
        }

        const payload = await runtime.getNegotiation(negotiationId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const payload = await runtime.updateNegotiation(negotiationId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'POST') {
        const body = await readJson(req);

        if (action === 'offer') {
          const payload = await runtime.makeNegotiationOffer(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'counter') {
          const payload = await runtime.makeNegotiationCounterOffer(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'accept') {
          const payload = await runtime.acceptNegotiationOffer(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'reject') {
          const payload = await runtime.rejectNegotiationOffer(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'hold') {
          const payload = await runtime.holdNegotiation(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'resume') {
          const payload = await runtime.resumeNegotiation(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'agree') {
          const payload = await runtime.markNegotiationAgreed(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'token') {
          const payload = await runtime.recordNegotiationToken(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'agreement') {
          const payload = await runtime.markNegotiationAgreement(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'registration') {
          const payload = await runtime.markNegotiationRegistration(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'complete') {
          const payload = await runtime.completeNegotiation(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (action === 'cancel') {
          const payload = await runtime.cancelNegotiation(negotiationId, body);
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/tokens' && req.method === 'GET') {
      const payload = await runtime.listTokens();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/tokens' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await runtime.createToken(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/deals' && req.method === 'GET') {
      const payload = await runtime.listDeals();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/deals' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await runtime.createDeal(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/commission' && req.method === 'GET') {
      const payload = await runtime.listCommissions();
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/commission' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await runtime.createCommission(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/commission/calculate' && req.method === 'POST') {
      const body = await readJson(req);
      const payload = await runtime.calculateCommission(body);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/commission/summary' && req.method === 'GET') {
      const payload = await runtime.getCommissionSummary();
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname.startsWith('/api/commission/')) {
      const parts = pathname.split('/').filter(Boolean);
      const commissionId = parts[2];
      const action = parts[3] || null;
      if (!commissionId) {
        sendJson(res, { ok: false, error: 'Bad commission path' }, 400);
        return;
      }

      if (req.method === 'GET' && !action) {
        const payload = await runtime.getCommission(commissionId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'GET' && action === 'payments') {
        const payload = await runtime.listCommissionPayments(commissionId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'GET' && action === 'history') {
        const payload = await runtime.getCommissionHistory(commissionId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'PATCH' && action === 'status') {
        const body = await readJson(req);
        const payload = await runtime.updateCommissionStatus(commissionId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'POST' && action === 'payment') {
        const body = await readJson(req);
        const payload = await runtime.recordCommissionPayment(commissionId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname.startsWith('/api/closing/')) {
      const parts = pathname.split('/').filter(Boolean);
      const dealId = parts[2];
      const action = parts[3] || null;
      if (!dealId) {
        sendJson(res, { ok: false, error: 'Bad closing path' }, 400);
        return;
      }

      if (req.method === 'GET' && !action) {
        const payload = await runtime.getClosing(dealId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'GET' && action === 'history') {
        const payload = await runtime.getClosingHistory(dealId);
        sendJson(res, payload, payload.ok ? 200 : 404);
        return;
      }

      if (req.method === 'POST' && action === 'start') {
        const body = await readJson(req);
        const payload = await runtime.startClosing(dealId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'PATCH' && action === 'checklist') {
        const body = await readJson(req);
        const payload = await runtime.updateClosingChecklist(dealId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'POST' && action === 'complete') {
        const body = await readJson(req);
        const payload = await runtime.completeClosing(dealId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      if (req.method === 'POST' && action === 'close') {
        const body = await readJson(req);
        const payload = await runtime.closeDeal(dealId, body);
        sendJson(res, payload, payload.ok ? 200 : 400);
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    if (pathname === '/api/brokers') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      if (req.method !== 'GET') {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }
      if (!ensurePermissionOrRespond(req, res, url, 'BROKER_NETWORK_READ')) return;
      const payload = await runtime.router.route('brokers', 'list');
      if (payload?.ok && Array.isArray(payload.data)) {
        payload.data = payload.data.map((broker) => ({
          BrokerID: broker.BrokerID,
          BrokerName: broker.BrokerName,
          BrokerType: broker.BrokerType,
          Company: broker.Company,
          Status: broker.Status
        }));
      }
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/calendar' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      if (!ensurePermissionOrRespond(req, res, url, 'LEADS_READ')) return;
      const followUps = await runtime.listFollowUps({});
      const events = (followUps.data || [])
        .filter((item) => accessSvc.authorizeFollowUp(actor, item, {
          permissions: ['LEADS_READ'],
          hideExistence: true
        }).ok)
        .map((item) => ({
        FollowUpID: item.FollowUpID,
        LeadID: item.LeadID,
        RequirementID: item.RequirementID,
        RelatedEntityType: item.RelatedEntityType,
        RelatedEntityID: item.RelatedEntityID,
        DueDate: item.DueDate,
        Priority: item.Priority,
        Status: item.Status,
        Notes: item.Notes,
        AssignedUser: item.AssignedUser,
        ActivityType: item.ActivityType
        }));
      sendJson(res, { ok: true, data: events });
      return;
    }

    if (pathname === '/api/notifications') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'PATCH') {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }
      if (!ensureAdminPermissionOrRespond(req, res, url, 'NOTIFICATIONS_MANAGE')) return;
      if (req.method === 'GET') {
        const payload = await runtime.getAdminNotifications(actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const payload = await runtime.updateAdminNotifications(body, actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }
    }

    if (pathname === '/api/owners') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
        return;
      }
      const ownerPermission = req.method === 'GET' ? 'INVENTORY_READ' : req.method === 'POST' ? 'INVENTORY_CREATE' : null;
      if (!ownerPermission) {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }
      if (!ensurePermissionOrRespond(req, res, url, ownerPermission)) return;

      if (req.method === 'GET') {
        const payload = await runtime.listOwners();
        if (payload?.ok && Array.isArray(payload.data)) {
          payload.data = payload.data.filter((owner) => accessSvc.authorizeTenantRecord(actor, owner, {
            permissions: ['INVENTORY_READ'],
            hideExistence: true
          }).ok);
        }
        sendJson(res, payload);
        return;
      }

      if (req.method === 'POST') {
        const body = await readJson(req);
        const payload = await runtime.createOwner(body, actor);
        sendJson(res, payload, payload.ok ? 201 : 400);
        return;
      }
    }

    if (pathname === '/api/builders') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
        return;
      }
      const builderPermission = req.method === 'GET' ? 'BUILDER_PROJECTS_READ' : req.method === 'POST' ? 'BUILDER_PROJECTS_CREATE' : null;
      if (!builderPermission) {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }
      if (!ensurePermissionOrRespond(req, res, url, builderPermission)) return;

      if (req.method === 'GET') {
        const payload = await runtime.listBuilders();
        if (payload?.ok && Array.isArray(payload.data)) {
          payload.data = payload.data.filter((builder) => accessSvc.authorizeTenantRecord(actor, builder, {
            permissions: ['BUILDER_PROJECTS_READ'],
            hideExistence: true
          }).ok);
        }
        sendJson(res, payload);
        return;
      }

      if (req.method === 'POST') {
        const body = await readJson(req);
        const payload = await runtime.createBuilder(body, actor);
        sendJson(res, payload, payload.ok ? 201 : 400);
        return;
      }
    }

    if (pathname === '/api/projects') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
        return;
      }
      const projectPermission = req.method === 'GET' ? 'BUILDER_PROJECTS_READ' : req.method === 'POST' ? 'BUILDER_PROJECTS_CREATE' : null;
      if (!projectPermission) {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }
      if (!ensurePermissionOrRespond(req, res, url, projectPermission)) return;

      if (req.method === 'GET') {
        const payload = await runtime.listProjects();
        if (payload?.ok && Array.isArray(payload.data)) {
          payload.data = payload.data.filter((project) => accessSvc.authorizeTenantRecord(actor, project, {
            permissions: ['BUILDER_PROJECTS_READ'],
            hideExistence: true
          }).ok);
        }
        sendJson(res, payload);
        return;
      }

      if (req.method === 'POST') {
        const body = await readJson(req);
        const builderId = body.BuilderID || body.builderId;
        if (builderId) {
          const builder = runtime.repository.find('Builders', 'BuilderID', builderId);
          if (builder) {
            const builderAccess = accessSvc.authorizeTenantRecord(actor, builder, {
              permissions: ['BUILDER_PROJECTS_CREATE'],
              hideExistence: true
            });
            if (!builderAccess.ok) {
              sendJson(res, { ok: false, error: builderAccess.error }, builderAccess.statusCode);
              return;
            }
          }
        }
        const payload = await runtime.createProject(body, actor);
        sendJson(res, payload, payload.ok ? 201 : 400);
        return;
      }
    }

    if (pathname === '/api/media' && req.method === 'POST') {
      const body = await readJson(req);
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }
      const service = new (require('./src/services/mediaService').MediaService)(runtime.repository);
      const result = await service.createMedia({
        ...body,
        CompanyID: actor.companyId,
        BrokerageID: actor.brokerageId
      }, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
      sendJson(res, result.ok ? { ok: true, data: stripSensitiveMedia(result.data) } : result, result.ok ? 201 : (result.statusCode || 400));
      return;
    }

    if (pathname.startsWith('/api/media/')) {
      const mediaId = pathname.split('/').filter(Boolean)[2];
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }

      if (req.method === 'GET') {
        const service = new (require('./src/services/mediaService').MediaService)(runtime.repository);
        const existing = runtime.repository.getMedia(mediaId);
        if (!existing) {
          sendJson(res, { ok: false, statusCode: 404, error: 'Media not found' }, 404);
          return;
        }
        const scope = tenantCheck(existing, actor);
        if (!scope.ok) {
          sendJson(res, { ok: false, statusCode: 403, error: 'Forbidden' }, 403);
          return;
        }
        const result = await service.getMedia(mediaId, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
        if (result.ok) {
          sendJson(res, { ok: true, data: stripSensitiveMedia(result.data) }, 200);
        } else {
          sendJson(res, result, result.statusCode || 404);
        }
        return;
      }

      if (req.method === 'DELETE') {
        const service = new (require('./src/services/mediaService').MediaService)(runtime.repository);
        const existing = runtime.repository.getMedia(mediaId);
        if (!existing) {
          sendJson(res, { ok: false, statusCode: 404, error: 'Media not found' }, 404);
          return;
        }
        const scope = tenantCheck(existing, actor);
        if (!scope.ok) {
          sendJson(res, { ok: false, statusCode: 403, error: 'Forbidden' }, 403);
          return;
        }
        const result = await service.deleteMedia(mediaId, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
        sendJson(res, result.ok ? { ok: true, data: stripSensitiveMedia(result.data) } : result, result.statusCode || (result.ok ? 200 : 400));
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    const mediaEntityMatch = pathname.match(/^\/api\/(builders|projects|properties)\/([^/]+)\/media$/);
    if (mediaEntityMatch && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }
      const entityType = mediaEntityMatch[1].toUpperCase();
      const entityId = mediaEntityMatch[2];
      const service = new (require('./src/services/mediaService').MediaService)(runtime.repository);
      const filters = {
        BuilderID: entityType === 'BUILDERS' ? entityId : undefined,
        ProjectID: entityType === 'PROJECTS' ? entityId : undefined,
        PropertyID: entityType === 'PROPERTIES' ? entityId : undefined,
        CompanyID: actor.companyId,
        BrokerageID: actor.brokerageId
      };
      const result = await service.listMedia(filters, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
      sendJson(res, { ok: true, data: (result.data || []).map(stripSensitiveMedia) }, 200);
      return;
    }

    if (pathname === '/api/documents' && req.method === 'POST') {
      const body = await readJson(req);
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }
      const service = new (require('./src/services/documentService').DocumentService)(runtime.repository);
      const result = await service.createDocument({
        ...body,
        CompanyID: actor.companyId,
        BrokerageID: actor.brokerageId
      }, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
      sendJson(res, result.ok ? { ok: true, data: stripSensitiveDocument(result.data) } : result, result.ok ? 201 : (result.statusCode || 400));
      return;
    }

    if (pathname.startsWith('/api/documents/')) {
      const documentId = pathname.split('/').filter(Boolean)[2];
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }

      if (req.method === 'GET') {
        const service = new (require('./src/services/documentService').DocumentService)(runtime.repository);
        const existing = runtime.repository.getDocument(documentId);
        if (!existing) {
          sendJson(res, { ok: false, statusCode: 404, error: 'Document not found' }, 404);
          return;
        }
        const scope = tenantCheck(existing, actor);
        if (!scope.ok) {
          sendJson(res, { ok: false, statusCode: 403, error: 'Forbidden' }, 403);
          return;
        }
        const result = await service.getDocument(documentId, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
        if (result.ok) {
          sendJson(res, { ok: true, data: stripSensitiveDocument(result.data) }, 200);
        } else {
          sendJson(res, result, result.statusCode || 404);
        }
        return;
      }

      if (req.method === 'DELETE') {
        const service = new (require('./src/services/documentService').DocumentService)(runtime.repository);
        const existing = runtime.repository.getDocument(documentId);
        if (!existing) {
          sendJson(res, { ok: false, statusCode: 404, error: 'Document not found' }, 404);
          return;
        }
        const scope = tenantCheck(existing, actor);
        if (!scope.ok) {
          sendJson(res, { ok: false, statusCode: 403, error: 'Forbidden' }, 403);
          return;
        }
        const result = await service.deleteDocument(documentId, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
        sendJson(res, result.ok ? { ok: true, data: stripSensitiveDocument(result.data) } : result, result.statusCode || (result.ok ? 200 : 400));
        return;
      }

      sendJson(res, { ok: false, error: 'Method not supported' }, 405);
      return;
    }

    const documentEntityMatch = pathname.match(/^\/api\/(builders|projects|properties)\/([^/]+)\/documents$/);
    if (documentEntityMatch && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }
      const entityType = documentEntityMatch[1].toUpperCase();
      const entityId = documentEntityMatch[2];
      const service = new (require('./src/services/documentService').DocumentService)(runtime.repository);
      const filters = {
        BuilderID: entityType === 'BUILDERS' ? entityId : undefined,
        ProjectID: entityType === 'PROJECTS' ? entityId : undefined,
        PropertyID: entityType === 'PROPERTIES' ? entityId : undefined,
        CompanyID: actor.companyId,
        BrokerageID: actor.brokerageId
      };
      const result = await service.listDocuments(filters, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
      sendJson(res, { ok: true, data: (result.data || []).map(stripSensitiveDocument) }, 200);
      return;
    }

    if (pathname === '/api/documents' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }
      const service = new (require('./src/services/documentService').DocumentService)(runtime.repository);
      const result = await service.listDocuments({ CompanyID: actor.companyId, BrokerageID: actor.brokerageId }, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
      sendJson(res, { ok: true, data: (result.data || []).map(stripSensitiveDocument) }, 200);
      return;
    }

    if (pathname === '/api/media' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, statusCode: 401, error: 'Unauthorized' }, 401);
        return;
      }
      const service = new (require('./src/services/mediaService').MediaService)(runtime.repository);
      const result = await service.listMedia({ CompanyID: actor.companyId, BrokerageID: actor.brokerageId }, actor, { companyId: actor.companyId, brokerageId: actor.brokerageId });
      sendJson(res, { ok: true, data: (result.data || []).map(stripSensitiveMedia) }, 200);
      return;
    }

    if (pathname.startsWith('/api/admin/')) {
      const parts = pathname.split('/').filter(Boolean);
      const resource = parts[2] || '';
      const subResource = parts[3] || '';
      const action = parts[4] || '';
      const actor = getAdminActor(req);

      if (resource === 'overview' && req.method === 'GET') {
        const payload = await runtime.getAdminOverview(actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      if (resource === 'users') {
        if (req.method === 'GET' && !subResource) {
          const payload = await runtime.listAdminUsers(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'POST' && !subResource) {
          const body = await readJson(req);
          const payload = await runtime.createAdminUser(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (subResource && req.method === 'PATCH' && action === 'status') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminUserStatus(subResource, body.status || body.Status, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (subResource && req.method === 'PATCH' && !action) {
          const body = await readJson(req);
          const payload = await runtime.updateAdminUser(subResource, body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'roles') {
        if (req.method === 'GET' && !subResource) {
          const payload = await runtime.listAdminRoles(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'POST' && !subResource) {
          const body = await readJson(req);
          const payload = await runtime.createAdminRole(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (subResource && req.method === 'PATCH') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminRole(subResource, body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'permissions' && req.method === 'GET') {
        const payload = await runtime.listAdminPermissions(actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      if (resource === 'settings') {
        if (req.method === 'GET') {
          const payload = await runtime.getAdminSettings(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'PATCH') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminSettings(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'masters') {
        if (req.method === 'GET' && !subResource) {
          const filters = { masterType: url.searchParams.get('masterType') || undefined, active: url.searchParams.get('active') || undefined };
          const payload = await runtime.getAdminMasters(filters, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'POST' && !subResource) {
          const body = await readJson(req);
          const payload = await runtime.createAdminMaster(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (subResource && req.method === 'PATCH') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminMaster(subResource, body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'pipeline') {
        if (req.method === 'GET') {
          const payload = await runtime.getAdminPipeline(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'PATCH') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminPipeline(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'forms') {
        if (req.method === 'GET' && !subResource) {
          const payload = await runtime.getAdminForms(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'PATCH' && subResource && action === 'fields') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminFormField(subResource, parts[5], body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'PATCH' && subResource) {
          const body = await readJson(req);
          const payload = await runtime.updateAdminForm(subResource, body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'notifications') {
        if (req.method === 'GET') {
          const payload = await runtime.getAdminNotifications(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'PATCH') {
          const body = await readJson(req);
          const payload = await runtime.updateAdminNotifications(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'audit' && req.method === 'GET') {
        const filters = { userId: url.searchParams.get('userId') || undefined, module: url.searchParams.get('module') || undefined, action: url.searchParams.get('action') || undefined, entityType: url.searchParams.get('entityType') || undefined, dateFrom: url.searchParams.get('dateFrom') || undefined, dateTo: url.searchParams.get('dateTo') || undefined };
        const payload = await runtime.getAdminAudit(filters, actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      if (resource === 'backups') {
        if (req.method === 'GET') {
          const payload = await runtime.getAdminBackups(actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }

        if (req.method === 'POST') {
          const body = await readJson(req);
          const payload = await runtime.createAdminBackup(body, actor);
          sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
          return;
        }
      }

      if (resource === 'restore' && req.method === 'POST') {
        const body = await readJson(req);
        const payload = await runtime.restoreAdminBackup(body.backupId, body, actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      if (resource === 'health' && req.method === 'GET') {
        const payload = await runtime.getAdminHealth(actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      if (resource === 'maintenance' && req.method === 'GET') {
        const payload = await runtime.getAdminMaintenance(actor);
        sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
        return;
      }

      sendJson(res, { ok: false, error: 'API not found' }, 404);
      return;
    }

    if (pathname === '/api/reports' && req.method === 'GET') {
      const filters = getReportFilters(url);
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getReportsCenter(filters, actor);
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/reports/dashboard' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getDashboardReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/leads' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getLeadsReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/requirements' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getRequirementsReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/inventory' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getInventoryReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/matching' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getMatchingReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/shortlist' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getShortlistReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/site-visits' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getSiteVisitReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/negotiations' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getNegotiationReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/tokens' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getTokenReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/deals' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getDealReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/commission' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getCommissionReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/closing' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getClosingReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/agents' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getAgentsReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/sources' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getSourcesReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/locations' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getLocationsReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/builders' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getBuildersReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/financial' && req.method === 'GET') {
      const actor = getAuthorizedReportActor(req, res, url);
      if (!actor) return;
      const payload = await runtime.getFinancialReport(getReportFilters(url), actor);
      sendJson(res, payload, payload.ok ? 200 : 400);
      return;
    }

    if (pathname === '/api/reports/export' && req.method === 'GET') {
      const type = url.searchParams.get('type') || '';
      const format = String(url.searchParams.get('format') || 'csv').toLowerCase();
      if (format !== 'csv') {
        sendJson(res, { ok: false, error: 'Only csv export is supported' }, 400);
        return;
      }

      const actor = getAuthorizedReportActor(req, res, url, 'REPORTS_EXPORT');
      if (!actor) return;
      const payload = await runtime.exportReportCsv(type, getReportFilters(url), actor);
      if (!payload.ok) {
        sendJson(res, payload, 400);
        return;
      }

      res.writeHead(200, withSecurityHeaders({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${payload.filename || 'report.csv'}"`,
        'Cache-Control': 'no-store'
      }));
      res.end(payload.data);
      return;
    }

    if (pathname === '/api/search' && req.method === 'GET') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) { sendJson(res, { ok: false, error: 'Unauthorized' }, 401); return; }
      if (!ensurePermissionOrRespond(req, res, url, 'SEARCH_READ')) return;
      const query = url.searchParams.get('q') || '';
      const payload = await runtime.globalSearch(query);
      if (payload?.ok && Array.isArray(payload.data)) {
        payload.data = payload.data.filter((record) => accessSvc.authorizeSearchRecord(actor, record, {
          permissions: ['SEARCH_READ'],
          hideExistence: true
        }).ok);
      }
      sendJson(res, payload);
      return;
    }

    if (pathname === '/api/users') {
      const actor = getAuthenticatedActor(req, url);
      if (!actor?.userId) {
        sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
        return;
      }
      if (req.method !== 'GET') {
        sendJson(res, { ok: false, error: 'Method not supported' }, 405);
        return;
      }
      if (!ensureAdminPermissionOrRespond(req, res, url, 'USERS_MANAGE')) return;
      const payload = await runtime.listAdminUsers(actor);
      sendJson(res, payload, payload.statusCode || (payload.ok ? 200 : 400));
      return;
    }

    sendJson(res, { ok: false, error: 'API not found' }, 404);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message || 'Error' }, error.statusCode || 500);
  }
}

async function readJson(req) {
  // If body was already parsed by the V2Router pre-read, return the cache.
  if (req._parsedBody !== undefined) return req._parsedBody;
  return new Promise((resolve, reject) => {
    let body = '';
    let bodyBytes = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > MAX_JSON_BODY_BYTES) {
        settled = true;
        const error = new Error('JSON body exceeds the configured limit');
        error.statusCode = 413;
        reject(error);
        req.pause();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!body) {
        req._parsedBody = {};
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(body);
        req._parsedBody = parsed;
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res, payload, statusCode = 200, extraHeaders = {}) {
  res.writeHead(statusCode, withSecurityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  }));
  res.end(JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sendHtml(res, body, statusCode = 200) {
  res.writeHead(statusCode, withSecurityHeaders({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  }, { includeCsp: true, includeCrossOriginOpenerPolicy: true }));
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Signature Properties Broker Network</title><style>body{margin:0;background:#f4f1ea;color:#17211b;font:16px Georgia,serif}main{max-width:720px;margin:0 auto;padding:32px 20px}.eyebrow{letter-spacing:.12em;text-transform:uppercase;font:12px Arial,sans-serif;color:#6d746e}.panel{background:#fffdf8;border:1px solid #d8d0c2;padding:24px;box-shadow:0 10px 30px #24352812}h1{font-size:clamp(28px,7vw,48px);line-height:1.05;margin:12px 0 24px}dl{display:grid;grid-template-columns:1fr 1fr;gap:14px;border-top:1px solid #e7e0d4;padding-top:18px}dt{font:11px Arial,sans-serif;text-transform:uppercase;color:#777}dd{margin:4px 0 0;font-size:19px}.privacy{background:#edf2e9;padding:12px;font:14px Arial,sans-serif;margin:22px 0}label{display:block;font:12px Arial,sans-serif;text-transform:uppercase;color:#555;margin-top:18px}input,button{box-sizing:border-box;width:100%;min-height:48px;margin-top:7px;padding:12px;border:1px solid #bcb5a8;font:16px Arial,sans-serif}button{background:#1f4d36;color:white;border-color:#1f4d36;cursor:pointer}#result{font:14px Arial,sans-serif;margin-top:14px}@media(max-width:480px){main{padding:20px 14px}.panel{padding:18px}dl{grid-template-columns:1fr}}</style></head><body>${body}</body></html>`);
}

appServer = http.createServer(async (req, res) => {
  const url = parseRequestUrl(req);

  if (!enforceApiRateLimit(req, res, url)) return;
  if (url.pathname.startsWith('/api/') && Number(req.headers['content-length'] || 0) > MAX_JSON_BODY_BYTES) {
    sendJson(res, { ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
    return;
  }

  if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  if (url.pathname === '/public' || url.pathname === '/public/') {
    const publicProperties = await runtime.listPublicProperties();
    const publicProjects = await runtime.listPublicProjects();
    const propertyCards = (publicProperties.data || []).slice(0, 12).map((property) => `
      <article class="card">
        <div class="eyebrow">${escapeHtml(property.PropertyType || 'Property')}</div>
        <h3>${escapeHtml(property.Project || property.PropertyID || 'Property')}</h3>
        <p>${escapeHtml(property.Location || 'Location unavailable')}</p>
        <div class="meta">₹${escapeHtml(Number(property.Price || 0).toLocaleString('en-IN'))}</div>
      </article>
    `).join('') || '<p class="empty">No public properties yet.</p>';

    const projectCards = (publicProjects.data || []).slice(0, 12).map((project) => `
      <article class="card">
        <div class="eyebrow">Project</div>
        <h3>${escapeHtml(project.ProjectName || project.ProjectID || 'Project')}</h3>
        <p>${escapeHtml(project.Location || 'Location unavailable')}</p>
        <div class="meta">${escapeHtml(project.BuilderID || 'Builder information unavailable')}</div>
      </article>
    `).join('') || '<p class="empty">No public projects yet.</p>';

    sendHtml(res, `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Signature Properties | Public Portfolio</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f5f7fb; color: #17212f; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 40px 20px 80px; }
    .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
    .brand { font-size: 2rem; font-weight: 700; }
    .subtitle { color: #52607a; margin-top: 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
    .card { background: #fff; border-radius: 16px; padding: 18px; box-shadow: 0 10px 25px rgba(17,24,39,0.06); }
    .eyebrow { text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; font-size: 11px; margin-bottom: 8px; }
    h3 { margin: 0 0 10px; font-size: 1.2rem; }
    p { margin: 0 0 10px; color: #475569; }
    .meta { color: #0f172a; font-weight: 600; }
    .empty { color: #64748b; }
    .section { margin-top: 36px; }
    .section h2 { margin: 0 0 18px; font-size: 1.4rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div>
        <div class="brand">Signature Properties</div>
        <div class="subtitle">Public portfolio</div>
      </div>
    </div>

    <section class="section">
      <h2>Public Properties</h2>
      <div class="grid">${propertyCards}</div>
    </section>

    <section class="section">
      <h2>Public Projects</h2>
      <div class="grid">${projectCards}</div>
    </section>
  </div>
</body>
</html>`);
    return;
  }

  // ── V2 page routing — extensionless URLs → .html files ─────────────────────
  const V2_ROUTES = {
    '/gethub':              '/gethub.html',
    '/clients':             '/clients.html',
    '/client-workspace':    '/client-workspace.html',
    '/requirements-view':   '/requirements-view.html',
    '/duplicates':          '/duplicates.html',
    '/inventory':           '/inventory.html',
    '/property-workspace':  '/property-workspace.html',
    '/builder-projects':    '/builder-projects.html',
    '/broker-network':      '/broker-network.html',
    '/calculators':         '/calculators.html',
    '/digital-card':        '/digital-card.html'
  };

  let filePath = url.pathname === '/' ? '/index.html'
    : /^\/share\/req\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ? '/share-req.html'
    : (V2_ROUTES[url.pathname] || url.pathname);

  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const publicPages = new Set(['/index.html', '/login.html', '/share-req.html', '/gethub']);
  if (url.pathname === '/login') {
    res.writeHead(302, withSecurityHeaders({ Location: '/login.html' }));
    res.end();
    return;
  }
  if (filePath.endsWith('.html') && !publicPages.has(requestPath)) {
    const actor = resolveSessionActor(req, url);
    if (!actor) {
      const next = encodeURIComponent(url.pathname + (url.search || ''));
      res.writeHead(302, withSecurityHeaders({ Location: `/login.html?next=${next}` }));
      res.end();
      return;
    }
  }

  filePath = path.normalize(filePath).replace(/^\.\.[\/\\]/, '');
  const resolvedPath = path.resolve(ROOT, `.${filePath}`);

  if (!resolvedPath.startsWith(ROOT)) {
    res.writeHead(403, withSecurityHeaders());
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolvedPath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, withSecurityHeaders());
        res.end('Not found');
      } else {
        res.writeHead(500, withSecurityHeaders());
        res.end('Server error');
      }
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const headers = {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
    };
    if (ext === '.html') {
      headers['Cache-Control'] = 'no-store';
    }
    res.writeHead(200, withSecurityHeaders(headers, {
      includeCsp: ext === '.html',
      includeCrossOriginOpenerPolicy: ext === '.html'
    }));
    res.end(content);
  });
});

appServer.on('connection', (socket) => {
  activeSockets.add(socket);
  socket.on('close', () => {
    activeSockets.delete(socket);
  });
});

function gracefulShutdown(signal, options = {}) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  shutdownCompleted = false;
  const exitFn = typeof options.exitFn === 'function' ? options.exitFn : (code) => process.exit(code);
  const forceExitAfterMs = Number.isInteger(options.forceExitAfterMs) && options.forceExitAfterMs > 0
    ? options.forceExitAfterMs
    : SHUTDOWN_FORCE_EXIT_MS;
  const completeShutdown = (code) => {
    if (shutdownCompleted) return;
    shutdownCompleted = true;
    if (shutdownForceExitTimer) {
      clearTimeout(shutdownForceExitTimer);
      shutdownForceExitTimer = null;
    }
    exitFn(code);
  };
  clearRecurringBackgroundTimers();

  for (const socket of [...activeSockets]) {
    if (!socket.destroyed) {
      socket.destroy();
    }
  }

  if (!appServer || !appServer.listening) {
    completeShutdown(0);
    return;
  }

  console.log(`Shutdown signal received (${signal}); closing HTTP server...`);

  shutdownForceExitTimer = setTimeout(() => {
    if (shutdownCompleted) return;
    console.error(`[shutdown] force exiting after ${forceExitAfterMs}ms`);
    completeShutdown(1);
  }, forceExitAfterMs);

  if (typeof appServer.closeAllConnections === 'function') {
    appServer.closeAllConnections();
  }
  if (typeof appServer.closeIdleConnections === 'function') {
    appServer.closeIdleConnections();
  }

  appServer.close((error) => {
    if (error) {
      console.error('[shutdown] server close failed:', error.message);
      completeShutdown(1);
      return;
    }
    completeShutdown(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

function redactStartupSecret(value) {
  if (value == null) return value;
  let redacted = String(value);
  if (process.env.MONGO_URL) {
    redacted = redacted.replace(process.env.MONGO_URL, '[redacted-mongo-url]');
  }
  return redacted.replace(/(mongodb(?:\+srv)?:\/\/)([^:@/]+)(:[^@/]+)?@/gi, '$1[redacted]@');
}

function writeStartupStderr(line) {
  fs.writeSync(2, `${line}\n`);
}

function logStartupFatal(error) {
  writeStartupStderr(`[startup] fatal.name: ${redactStartupSecret(error && error.name) || '(unknown)'}`);
  writeStartupStderr(`[startup] fatal.message: ${redactStartupSecret(error && error.message) || '(none)'}`);
  writeStartupStderr(`[startup] fatal.code: ${error && error.code == null ? '(none)' : error && error.code}`);
}

process.on('uncaughtException', (error) => {
  logStartupFatal(error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logStartupFatal(reason instanceof Error ? reason : new Error(String(reason)));
  process.exit(1);
});

async function startServer() {
  serverBinding = resolveServerBinding(process.env, { allowProductionFallback: false });
  shutdownInProgress = false;
  shutdownCompleted = false;
  clearRecurringBackgroundTimers();
  const storageConfig = enforceStorageRuntimeConfig(process.env);
  validateAuthStartupConfig();
  if (serverBinding.hasApiPort) {
    console.log('[startup] API_PORT is set; ignoring separate API listener to enforce single public HTTP server');
  }
  console.log('[startup] STORAGE_MODE=' + storageConfig.storageMode);
  // ── Optional Mongo pre-boot ──────────────────────────────────────────────
  try {
    const mongoStore = require('./src/data/mongoStore');
    if (mongoStore.isEnabled()) {
      console.log('[mongo] startup initialization requested');
      const fallbackJson = path.join(ROOT, 'data', 'sig-realty-db.json');
      const initRes = await mongoStore.initMongo(fallbackJson);
      console.log('[mongo] init result:', initRes);
      if (!mongoStore.isInitialized()) {
        throw new Error('Mongo storage initialization did not complete');
      }
    } else {
      console.log('[mongo] disabled (STORAGE_MODE=' + (process.env.STORAGE_MODE || 'json') + ')');
    }
  } catch (e) {
    console.error('[mongo] initialization failed:', e && e.message ? e.message : String(e));
    console.error('[mongo] Mongo mode is enabled but initialization failed; refusing JSON fallback.');
    throw e;
  }

  runtime = new SignatureRealtyRuntime();
  v2Router = new V2Router(runtime.repository, (req, url) => resolveSessionActor(req, url));

  try {
    if (runtime && runtime.repository && typeof runtime.repository.ensureStarterSeed === 'function') {
      runtime.repository.ensureStarterSeed();
      console.log('[startup] repository ready:', runtime.repository.constructor && runtime.repository.constructor.name);
    }
  } catch (e) {
    console.warn('[startup] ensureStarterSeed skipped:', e.message);
  }

  const syncGoogleSheet = async () => {
    try {
      const { GoogleSheetSyncService } = require('./src/services/googleSheetSyncService');
      const summary = await new GoogleSheetSyncService(runtime.repository).syncPublicSheet();
      if (Array.isArray(summary.tabErrors) && summary.tabErrors.length) {
        console.warn('[google-sheet] sync completed with download issues:', summary);
        return;
      }
      console.log('[google-sheet] sync:', summary);
    } catch (error) {
      console.error('[google-sheet] sync failed:', error.message);
    }
  };
  startPublicServerListener(appServer, process.env, {
    allowProductionFallback: false,
    onReady: () => {
      syncGoogleSheet();
      googleSheetSyncInterval = registerRecurringBackgroundTimer(setInterval(syncGoogleSheet, 5 * 60 * 1000));
    }
  });
}

function setRuntimeForTest(nextRuntime, nextV2Router = null) {
  runtime = nextRuntime;
  v2Router = nextV2Router;
}

if (require.main === module) {
  startServer().catch((e) => { logStartupFatal(e); process.exit(1); });
}

module.exports = {
  __test: {
    handleApi,
    sendJson,
    setRuntimeForTest,
    resolveSessionActor,
    getAuthenticatedActor,
    parsePort,
    resolveServerBinding,
    resolveAuthSignInUrl,
    resolveAuthSessionDataUrl,
    resolvePublicListenOptions,
    buildListenDiagnostics,
    normalizeServerAddress,
    parseRequestUrl,
    startPublicServerListener,
    resolveStorageMode,
    enforceStorageRuntimeConfig,
    isProductionLikeRuntime,
    gracefulShutdown,
    registerRecurringBackgroundTimer,
    clearRecurringBackgroundTimers,
    getGoogleSheetSyncInterval: () => googleSheetSyncInterval,
    getRegisteredRecurringTimerCount: () => recurringBackgroundTimers.size,
    getShutdownForceExitMs: () => SHUTDOWN_FORCE_EXIT_MS,
    setAppServerForTest: (server) => { appServer = server; },
    resetShutdownStateForTest: () => {
      shutdownInProgress = false;
      shutdownCompleted = false;
      if (shutdownForceExitTimer) {
        clearTimeout(shutdownForceExitTimer);
        shutdownForceExitTimer = null;
      }
      clearRecurringBackgroundTimers();
    },
    isProductionRuntime,
    validateAuthStartupConfig,
    getAuthExchangeStateMaxAgeSeconds,
    resolveGoogleOAuthRedirectUrl,
    issueAuthExchangeState,
    consumeAuthExchangeState,
    validateAuthExchangeState,
    hashAuthBrowserFlowId
  }
};
