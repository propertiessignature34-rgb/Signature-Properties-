const crypto = require('crypto');
const SESSION_COOKIE_NAME = 'sig_dashboard_session';
const DEFAULT_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const DIRECT_DASHBOARD_PRINCIPAL_ID = 'DIRECT_DASHBOARD';
const DIRECT_DASHBOARD_PRINCIPAL_TYPE = 'DIRECT_DASHBOARD';

const VALID_ROLES = new Set(['ADMIN', 'MANAGER', 'AGENT', 'BROKER', 'VIEWER']);
const ALL_PERMISSIONS = [
  'LEADS_READ', 'LEADS_CREATE', 'LEADS_UPDATE', 'LEADS_DELETE',
  'REQUIREMENTS_READ', 'REQUIREMENTS_CREATE', 'REQUIREMENTS_UPDATE', 'REQUIREMENTS_DELETE',
  'INVENTORY_READ', 'INVENTORY_CREATE', 'INVENTORY_UPDATE', 'INVENTORY_DELETE',
  'TRANSACTIONS_READ',
  'SEARCH_READ',
  'SITE_VISIT_READ', 'SITE_VISIT_CREATE', 'SITE_VISIT_UPDATE', 'SITE_VISIT_DELETE',
  'NEGOTIATION_READ', 'NEGOTIATION_UPDATE',
  'TOKEN_READ', 'TOKEN_CREATE', 'TOKEN_UPDATE',
  'DEAL_READ', 'DEAL_CREATE', 'DEAL_UPDATE',
  'COMMISSION_READ', 'COMMISSION_UPDATE',
  'MEDIA_READ', 'MEDIA_CREATE', 'MEDIA_DELETE',
  'DOCUMENT_READ', 'DOCUMENT_CREATE', 'DOCUMENT_DELETE',
  'BUILDER_PROJECTS_READ', 'BUILDER_PROJECTS_CREATE', 'BUILDER_PROJECTS_UPDATE', 'BUILDER_PROJECTS_DELETE',
  'BROKER_NETWORK_READ', 'BROKER_NETWORK_CREATE', 'BROKER_NETWORK_UPDATE', 'BROKER_NETWORK_DELETE', 'BROKER_NETWORK_ADMIN',
  'STORAGE_HEALTH_READ', 'STORAGE_OBJECT_READ',
  'USER_READ', 'USER_CREATE', 'USER_UPDATE', 'USER_DELETE',
  'ADMIN_READ', 'ADMIN_UPDATE',
  'REPORT_READ',
  'AUDIT_READ'
];

const ROLE_PERMISSIONS = {
  ADMIN: ALL_PERMISSIONS,
  MANAGER: [
    'LEADS_READ', 'LEADS_CREATE', 'LEADS_UPDATE',
    'REQUIREMENTS_READ', 'REQUIREMENTS_CREATE', 'REQUIREMENTS_UPDATE',
    'INVENTORY_READ', 'INVENTORY_CREATE', 'INVENTORY_UPDATE',
    'TRANSACTIONS_READ',
    'SEARCH_READ',
    'SITE_VISIT_READ', 'SITE_VISIT_CREATE', 'SITE_VISIT_UPDATE',
    'NEGOTIATION_READ', 'NEGOTIATION_UPDATE',
    'TOKEN_READ', 'TOKEN_CREATE', 'TOKEN_UPDATE',
    'DEAL_READ', 'DEAL_CREATE', 'DEAL_UPDATE',
    'COMMISSION_READ', 'COMMISSION_UPDATE',
    'MEDIA_READ', 'MEDIA_CREATE', 'MEDIA_DELETE',
    'DOCUMENT_READ', 'DOCUMENT_CREATE', 'DOCUMENT_DELETE',
    'BUILDER_PROJECTS_READ', 'BUILDER_PROJECTS_CREATE', 'BUILDER_PROJECTS_UPDATE', 'BUILDER_PROJECTS_DELETE',
    'BROKER_NETWORK_READ', 'BROKER_NETWORK_CREATE', 'BROKER_NETWORK_UPDATE', 'BROKER_NETWORK_DELETE', 'BROKER_NETWORK_ADMIN',
    'STORAGE_HEALTH_READ', 'STORAGE_OBJECT_READ',
    'REPORT_READ', 'AUDIT_READ'
  ],
  AGENT: [
    'LEADS_READ', 'LEADS_CREATE', 'LEADS_UPDATE',
    'REQUIREMENTS_READ', 'REQUIREMENTS_CREATE', 'REQUIREMENTS_UPDATE',
    'INVENTORY_READ',
    'TRANSACTIONS_READ',
    'SEARCH_READ',
    'SITE_VISIT_READ', 'SITE_VISIT_CREATE', 'SITE_VISIT_UPDATE',
    'NEGOTIATION_READ', 'NEGOTIATION_UPDATE',
    'TOKEN_READ', 'TOKEN_CREATE', 'TOKEN_UPDATE',
    'DEAL_READ', 'DEAL_CREATE', 'DEAL_UPDATE',
    'COMMISSION_READ', 'COMMISSION_UPDATE',
    'MEDIA_READ', 'MEDIA_CREATE', 'MEDIA_DELETE',
    'DOCUMENT_READ', 'DOCUMENT_CREATE', 'DOCUMENT_DELETE',
    'BUILDER_PROJECTS_READ', 'BROKER_NETWORK_READ', 'STORAGE_OBJECT_READ',
    'REPORT_READ'
  ],
  BROKER: [
    'NEGOTIATION_READ', 'NEGOTIATION_UPDATE',
    'TOKEN_READ', 'TOKEN_CREATE', 'TOKEN_UPDATE',
    'DEAL_READ', 'DEAL_CREATE', 'DEAL_UPDATE',
    'MEDIA_READ', 'MEDIA_CREATE', 'MEDIA_DELETE',
    'DOCUMENT_READ', 'DOCUMENT_CREATE', 'DOCUMENT_DELETE',
    'BROKER_NETWORK_READ', 'STORAGE_OBJECT_READ',
    'REPORT_READ'
  ],
  VIEWER: [
    'LEADS_READ',
    'REQUIREMENTS_READ',
    'INVENTORY_READ',
    'TRANSACTIONS_READ',
    'SEARCH_READ',
    'SITE_VISIT_READ',
    'NEGOTIATION_READ',
    'TOKEN_READ',
    'DEAL_READ',
    'COMMISSION_READ',
    'MEDIA_READ',
    'DOCUMENT_READ',
    'BUILDER_PROJECTS_READ',
    'BROKER_NETWORK_READ',
    'STORAGE_OBJECT_READ',
    'REPORT_READ'
  ]
};

class AuthService {
  constructor(repository) {
    this.repository = repository;
    this.sessions = new Map();
    this.publicRoutePatterns = [/^\/api\/public\//i, /^\/health(?:\/|$)/i, /^\/favicon\./i];
  }

  normalizePermission(value) {
    return String(value || '').trim().toUpperCase();
  }

  normalizePermissions(list) {
    if (!Array.isArray(list)) return [];
    return Array.from(new Set(list.map((item) => this.normalizePermission(item)).filter(Boolean)));
  }

  normalizeTenantPair(companyId, brokerageId) {
    const normalizeIdentifier = typeof this.repository?.normalizeStoredIdentifier === 'function'
      ? (value) => this.repository.normalizeStoredIdentifier(value)
      : (value) => String(value || '').trim();
    const company = normalizeIdentifier(companyId);
    const brokerage = normalizeIdentifier(brokerageId);
    if (!company || !brokerage) return null;
    return { companyId: company, brokerageId: brokerage, key: `${company}::${brokerage}` };
  }

  describeTenantPair(pair = {}) {
    return `${pair.companyId || '∅'} / ${pair.brokerageId || '∅'}`;
  }

  getDirectDashboardTenantCollections() {
    return [
      'Leads',
      'Transactions',
      'Requirements',
      'Activities',
      'FollowUps',
      'Inventory',
      'Media',
      'Matches',
      'Properties',
      'Shortlists',
      'SiteVisits',
      'Negotiations',
      'Tokens',
      'Deals',
      'Payments',
      'Commission',
      'Closings',
      'Documents',
      'Owners',
      'Builders',
      'Projects',
      'Brokers',
      'BrokerShares',
      'BrokerSubmissions',
      'BuilderProjects'
    ];
  }

  buildTenantEvidenceSummary(pairs, incomplete, sourceLabel) {
    const candidates = Array.from(pairs.values()).map((entry) => ({
      companyId: entry.companyId,
      brokerageId: entry.brokerageId,
      occurrences: entry.occurrences,
      collections: Array.from(entry.collections).sort()
    })).sort((left, right) => right.occurrences - left.occurrences || left.companyId.localeCompare(right.companyId) || left.brokerageId.localeCompare(right.brokerageId));
    return {
      source: sourceLabel,
      candidates,
      incomplete
    };
  }

  collectActiveUserTenantEvidence() {
    const pairs = new Map();
    const incomplete = [];
    const users = this.repository && typeof this.repository.listUsers === 'function'
      ? (this.repository.listUsers() || [])
      : [];
    for (const user of users) {
      if (String(user?.Status || '').trim().toUpperCase() !== 'ACTIVE') continue;
      if (String(user?.UserID || '').trim() === 'USR-SYSTEM-ADMIN') continue;
      const rawCompanyId = user?.CompanyID || user?.CompanyId;
      const rawBrokerageId = user?.BrokerageID || user?.BrokerageId;
      const pair = this.normalizeTenantPair(rawCompanyId, rawBrokerageId);
      if (pair) {
        const existing = pairs.get(pair.key) || { companyId: pair.companyId, brokerageId: pair.brokerageId, occurrences: 0, collections: new Set(['Users']) };
        existing.occurrences += 1;
        existing.collections.add('Users');
        pairs.set(pair.key, existing);
        continue;
      }
      const companyId = String(rawCompanyId || '').trim();
      const brokerageId = String(rawBrokerageId || '').trim();
      if (!companyId && !brokerageId) continue;
      incomplete.push({
        collection: 'Users',
        recordId: String(user?.UserID || user?.Email || user?.Name || '').trim() || 'UNKNOWN',
        missing: [companyId ? null : 'CompanyID', brokerageId ? null : 'BrokerageID'].filter(Boolean)
      });
    }
    return this.buildTenantEvidenceSummary(pairs, incomplete, 'activeUsers');
  }

  collectCrmTenantEvidence() {
    const { AccessControlService } = require('./accessControlService');
    const accessSvc = new AccessControlService(this.repository);
    const pairs = new Map();
    const incomplete = [];
    const snapshot = this.repository && typeof this.repository.read === 'function' ? this.repository.read() : {};
    for (const collectionName of this.getDirectDashboardTenantCollections()) {
      const rows = snapshot?.[collectionName];
      if (!Array.isArray(rows) || !rows.length) continue;
      for (const row of rows) {
        const resolved = accessSvc._resolveRecordTenant(row) || {};
        const rawCompanyId = resolved.companyId ?? row?.CompanyID ?? row?.CompanyId;
        const rawBrokerageId = resolved.brokerageId ?? row?.BrokerageID ?? row?.BrokerageId;
        const pair = this.normalizeTenantPair(rawCompanyId, rawBrokerageId);
        if (pair) {
          const existing = pairs.get(pair.key) || { companyId: pair.companyId, brokerageId: pair.brokerageId, occurrences: 0, collections: new Set() };
          existing.occurrences += 1;
          existing.collections.add(collectionName);
          pairs.set(pair.key, existing);
          continue;
        }
        const companyId = String(rawCompanyId || '').trim();
        const brokerageId = String(rawBrokerageId || '').trim();
        if (!companyId && !brokerageId) continue;
        incomplete.push({
          collection: collectionName,
          recordId: String(
            row?.LeadID ||
            row?.TransactionID ||
            row?.RequirementID ||
            row?.ActivityID ||
            row?.FollowUpID ||
            row?.PropertyID ||
            row?.ShortlistID ||
            row?.VisitID ||
            row?.VisitBookingID ||
            row?.NegotiationID ||
            row?.TokenID ||
            row?.DealID ||
            row?.PaymentID ||
            row?.CommissionID ||
            row?.ClosingID ||
            row?.DocumentID ||
            row?.MediaID ||
            row?.ProjectID ||
            row?.BuilderID ||
            row?.BrokerID ||
            row?.BrokerShareID ||
            row?.SubmissionID ||
            ''
          ).trim() || 'UNKNOWN',
          missing: [companyId ? null : 'CompanyID', brokerageId ? null : 'BrokerageID'].filter(Boolean)
        });
      }
    }
    return this.buildTenantEvidenceSummary(pairs, incomplete, 'crmRecords');
  }

  buildDirectDashboardTenantDiagnostic(userEvidence, recordEvidence) {
    const reasons = [];
    if (recordEvidence.candidates.length > 1) {
      reasons.push(`ambiguous CRM tenant pairs: ${recordEvidence.candidates.map((pair) => this.describeTenantPair(pair)).join(', ')}`);
    } else if (recordEvidence.candidates.length === 0 && userEvidence.candidates.length > 1) {
      reasons.push(`multiple active user tenant pairs without a canonical CRM tenant: ${userEvidence.candidates.map((pair) => this.describeTenantPair(pair)).join(', ')}`);
    } else if (recordEvidence.candidates.length === 0 && userEvidence.candidates.length === 0) {
      reasons.push('no complete CompanyID/BrokerageID tenant pair found in CRM records or active non-system users');
    }
    if (recordEvidence.incomplete.length) {
      reasons.push(`incomplete CRM tenant fields on ${recordEvidence.incomplete.length} record(s)`);
    }
    if (userEvidence.incomplete.length) {
      reasons.push(`incomplete active user tenant fields on ${userEvidence.incomplete.length} user(s)`);
    }
    return {
      reason: reasons.join('; ') || 'canonical tenant scope could not be determined safely',
      crmCandidates: recordEvidence.candidates,
      activeUserCandidates: userEvidence.candidates,
      incompleteCrmRecords: recordEvidence.incomplete.slice(0, 10),
      incompleteUsers: userEvidence.incomplete.slice(0, 10)
    };
  }

  resolveDirectDashboardTenant() {
    const userEvidence = this.collectActiveUserTenantEvidence();
    const recordEvidence = this.collectCrmTenantEvidence();
    if (recordEvidence.candidates.length === 1) {
      return {
        ok: true,
        tenant: recordEvidence.candidates[0],
        source: 'crmRecords',
        evidence: { crmRecords: recordEvidence, activeUsers: userEvidence }
      };
    }
    if (recordEvidence.candidates.length === 0 && userEvidence.candidates.length === 1) {
      return {
        ok: true,
        tenant: userEvidence.candidates[0],
        source: 'activeUsers',
        evidence: { crmRecords: recordEvidence, activeUsers: userEvidence }
      };
    }
    if (
      recordEvidence.candidates.length === 0 &&
      userEvidence.candidates.length === 0 &&
      recordEvidence.incomplete.length === 0 &&
      userEvidence.incomplete.length === 0
    ) {
      const fallbackCompanyId = String(process.env.DIRECT_DASHBOARD_COMPANY_ID || '').trim();
      const fallbackBrokerageId = String(process.env.DIRECT_DASHBOARD_BROKERAGE_ID || '').trim();
      const fallbackPair = this.normalizeTenantPair(
        fallbackCompanyId,
        fallbackBrokerageId
      );
      if (fallbackPair) {
        return {
          ok: true,
          tenant: { ...fallbackPair, occurrences: 0, collections: [] },
          source: 'defaultFallback',
          evidence: { crmRecords: recordEvidence, activeUsers: userEvidence }
        };
      }
    }
    return {
      ok: false,
      statusCode: 503,
      error: 'Direct dashboard tenant scope is unavailable',
      details: this.buildDirectDashboardTenantDiagnostic(userEvidence, recordEvidence)
    };
  }

  getDirectDashboardPermissions() {
    const rolePermissions = this.repository && typeof this.repository.getRole === 'function'
      ? this.repository.getRole('MANAGER')?.Permissions
      : null;
    if (Array.isArray(rolePermissions) && rolePermissions.length) {
      return this.normalizePermissions(rolePermissions);
    }
    return this.normalizePermissions(ROLE_PERMISSIONS.MANAGER || []);
  }

  buildDirectDashboardIdentity() {
    const tenantResult = this.resolveDirectDashboardTenant();
    if (!tenantResult.ok) return tenantResult;
    const tenant = tenantResult.tenant;
    return {
      ok: true,
      source: tenantResult.source,
      evidence: tenantResult.evidence,
      identity: {
        principalType: DIRECT_DASHBOARD_PRINCIPAL_TYPE,
        userId: DIRECT_DASHBOARD_PRINCIPAL_ID,
        role: 'MANAGER',
        companyId: tenant.companyId,
        brokerageId: tenant.brokerageId,
        permissions: this.getDirectDashboardPermissions()
      }
    };
  }

  issueDirectDashboardSession() {
    const identityResult = this.buildDirectDashboardIdentity();
    if (!identityResult.ok) return identityResult;
    const token = this.issueSession(identityResult.identity);
    return {
      ok: true,
      token,
      source: identityResult.source,
      evidence: identityResult.evidence,
      actor: {
        userId: identityResult.identity.userId,
        role: identityResult.identity.role,
        companyId: identityResult.identity.companyId,
        brokerageId: identityResult.identity.brokerageId,
        permissions: identityResult.identity.permissions,
        principalType: identityResult.identity.principalType,
        user: null
      }
    };
  }

  getActorIdentity(actor = {}, context = {}) {
    const rawActor = actor && actor.actor ? actor.actor : actor;
    const user = rawActor && typeof rawActor === 'object' ? (rawActor.user || rawActor.account || null) : null;
    const userId = String(rawActor?.userId || rawActor?.userID || rawActor?.id || user?.UserID || context.userId || context.userID || '').trim();
    const repositoryUser = this.repository && typeof this.repository.getUser === 'function' ? this.repository.getUser(userId) : null;
    const userRecord = repositoryUser || user || null;
    const role = String((userRecord?.Role || rawActor?.role || context.role || '').trim() || '').toUpperCase();
    const companyId = String(
      rawActor?.companyId ||
      rawActor?.companyID ||
      user?.CompanyID ||
      user?.CompanyId ||
      userRecord?.CompanyID ||
      userRecord?.CompanyId ||
      context.companyId ||
      context.companyID ||
      ''
    ).trim();
    const brokerageId = String(
      rawActor?.brokerageId ||
      rawActor?.brokerageID ||
      user?.BrokerageID ||
      user?.BrokerageId ||
      userRecord?.BrokerageID ||
      userRecord?.BrokerageId ||
      context.brokerageId ||
      context.brokerageID ||
      ''
    ).trim();
    const identityPermissions = repositoryUser
      ? (Array.isArray(repositoryUser.Permissions) ? repositoryUser.Permissions : [])
      : Array.isArray(rawActor?.permissions)
        ? rawActor.permissions
        : Array.isArray(userRecord?.Permissions)
          ? userRecord.Permissions
          : [];
    const permissions = this.normalizePermissions(identityPermissions);
    const status = String(userRecord?.Status || rawActor?.status || context.status || '').trim().toUpperCase();
    const principalType = String(rawActor?.principalType || context.principalType || '').trim().toUpperCase();
    return { user: userRecord, userId, role, companyId, brokerageId, permissions, status, principalType };
  }

  isPublicRoute(pathname = '') {
    const normalized = String(pathname || '').trim();
    return this.publicRoutePatterns.some((pattern) => pattern.test(normalized));
  }

  issueSession(identity = {}) {
    const userId = String(identity.userId || identity.userID || '').trim();
    if (!userId) {
      throw new Error('userId is required to issue a session');
    }

    const user = this.repository && typeof this.repository.getUser === 'function' ? this.repository.getUser(userId) : null;
    const role = String(identity.role || user?.Role || 'AGENT').trim().toUpperCase();
    const companyId = String(identity.companyId || user?.CompanyID || user?.CompanyId || '').trim();
    const brokerageId = String(identity.brokerageId || user?.BrokerageID || user?.BrokerageId || '').trim();
    const permissions = Array.isArray(identity.permissions)
      ? identity.permissions
      : typeof identity.permissions === 'string'
        ? identity.permissions.split(',').map((item) => String(item).trim()).filter(Boolean)
        : Array.isArray(user?.Permissions)
          ? user.Permissions
          : [];

    const sessionId = crypto.randomBytes(24).toString('hex');
    const session = {
      sessionId,
      principalType: identity.principalType || '',
      userId,
      role,
      companyId,
      brokerageId,
      permissions: this.normalizePermissions(permissions),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + getSessionMaxAgeSeconds(this.repository) * 1000).toISOString()
    };

    if (this.repository && typeof this.repository.upsertSession === 'function') {
      this.repository.upsertSession(session);
    }
    this.sessions.set(sessionId, session);
    return sessionId;
  }

  revokeSession(sessionId) {
    const sessionKey = String(sessionId || '').trim();
    if (!sessionKey) return false;
    const removed = this.sessions.delete(sessionKey);
    const persistedRemoved = this.repository && typeof this.repository.deleteSession === 'function'
      ? this.repository.deleteSession(sessionKey)
      : false;
    return removed || persistedRemoved;
  }

  resolveRequestContext(request = {}) {
    const headers = request.headers || {};
    const pathname = request.pathname || '';

    if (this.isPublicRoute(pathname)) {
      return {
        authenticated: true,
        public: true,
        sessionId: null,
        actorId: null,
        userId: null,
        role: 'PUBLIC',
        companyId: null,
        brokerageId: null,
        permissions: [],
        user: null,
        principalType: '',
        statusCode: 200
      };
    }

    const authHeader = headers.authorization || headers.Authorization || '';
    const cookieHeader = headers.cookie || headers.Cookie || '';
    const rawCookieToken = String(cookieHeader)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((entry) => {
        const idx = entry.indexOf('=');
        return idx === -1 ? [entry, ''] : [entry.slice(0, idx), entry.slice(idx + 1)];
      })
      .find(([name]) => name === SESSION_COOKIE_NAME)?.[1] || '';
    let cookieToken = rawCookieToken;
    try {
      cookieToken = decodeURIComponent(rawCookieToken);
    } catch (_) {
      cookieToken = rawCookieToken;
    }
    const tokenFromHeader = String(authHeader).startsWith('Bearer ')
      ? String(authHeader).replace(/^Bearer\s+/i, '').trim()
      : headers['x-session-token'] || headers['x-sessiontoken'] || '';
    // Never accept session credentials from the URL. Query strings can be
    // persisted in browser history, proxy logs, analytics, and referrers.
    const token = cookieToken || tokenFromHeader || '';

    if (!token) {
      return { authenticated: false, statusCode: 401, error: 'Unauthorized', public: false };
    }

    let session = this.sessions.get(token);
    if (!session && this.repository && typeof this.repository.getSession === 'function') {
      session = this.repository.getSession(token);
      if (session?.sessionId) {
        this.sessions.set(session.sessionId, session);
      }
    }
    if (!session) {
      return { authenticated: false, statusCode: 401, error: 'Unauthorized', public: false };
    }

    const expiresAt = session.expiresAt ? new Date(session.expiresAt).getTime() : null;
    if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      this.revokeSession(token);
      return { authenticated: false, statusCode: 401, error: 'Session expired', public: false };
    }

    if (String(session.principalType || '').trim().toUpperCase() === DIRECT_DASHBOARD_PRINCIPAL_TYPE) {
      if (!session.companyId || !session.brokerageId) {
        return { authenticated: false, statusCode: 403, error: 'Tenant scope required', public: false };
      }
      return {
        authenticated: true,
        public: false,
        sessionId: token,
        actorId: session.userId,
        userId: session.userId,
        role: String(session.role || 'MANAGER').trim().toUpperCase(),
        companyId: String(session.companyId || '').trim(),
        brokerageId: String(session.brokerageId || '').trim(),
        permissions: this.normalizePermissions(session.permissions),
        user: null,
        principalType: DIRECT_DASHBOARD_PRINCIPAL_TYPE,
        statusCode: 200
      };
    }

    const user = this.repository && typeof this.repository.getUser === 'function' ? this.repository.getUser(session.userId) : null;
    if (!user) {
      this.revokeSession(token);
      return { authenticated: false, statusCode: 401, error: 'Unauthorized', public: false };
    }

    if (String(user.Status || '').trim().toUpperCase() !== 'ACTIVE') {
      this.revokeSession(token);
      return { authenticated: false, statusCode: 401, error: 'Unauthorized', public: false };
    }

    const role = String(session.role || user.Role || '').trim().toUpperCase() || 'AGENT';
    const companyId = String(session.companyId || user.CompanyID || user.CompanyId || '').trim();
    const brokerageId = String(session.brokerageId || user.BrokerageID || user.BrokerageId || '').trim();
    const permissions = Array.isArray(session.permissions) && session.permissions.length
      ? session.permissions
      : Array.isArray(user.Permissions)
        ? user.Permissions
        : [];

    if (!companyId || !brokerageId) {
      return { authenticated: false, statusCode: 403, error: 'Tenant scope required', public: false };
    }

    return {
      authenticated: true,
      public: false,
      sessionId: token,
      actorId: user.UserID,
      userId: user.UserID,
      role,
      companyId,
      brokerageId,
      permissions: this.normalizePermissions(permissions),
      user,
      principalType: '',
      statusCode: 200
    };
  }

  requirePermission(actor = {}, permission, context = {}) {
    const permissionKey = this.normalizePermission(permission);
    if (!permissionKey) {
      return { ok: false, statusCode: 400, error: 'Permission is required' };
    }

    const rawActor = actor && actor.actor ? actor.actor : actor;
    const candidate = this.getActorIdentity(rawActor || {}, context);
    const userRecord = candidate.user;
    const isDirectDashboard = candidate.principalType === DIRECT_DASHBOARD_PRINCIPAL_TYPE;

    if (!candidate.userId || (!userRecord && !isDirectDashboard)) {
      return { ok: false, statusCode: 401, error: 'Unauthorized' };
    }

    if (userRecord && String(userRecord.Status || '').trim().toUpperCase() !== 'ACTIVE') {
      return { ok: false, statusCode: 401, error: 'Unauthorized' };
    }

    const role = String(userRecord?.Role || candidate.role || '').trim().toUpperCase();
    if (!VALID_ROLES.has(role)) {
      return { ok: false, statusCode: 403, error: 'Unknown role' };
    }

    const requestedCompanyId = String(context.companyId || context.companyID || '').trim();
    const requestedBrokerageId = String(context.brokerageId || context.brokerageID || '').trim();
    if ((requestedCompanyId || requestedBrokerageId) && (!candidate.companyId || !candidate.brokerageId)) {
      return { ok: false, statusCode: 403, error: 'Tenant scope required' };
    }
    if (requestedCompanyId && candidate.companyId && requestedCompanyId !== candidate.companyId) {
      return { ok: false, statusCode: 403, error: 'Cross-tenant access denied' };
    }
    if (requestedBrokerageId && candidate.brokerageId && requestedBrokerageId !== candidate.brokerageId) {
      return { ok: false, statusCode: 403, error: 'Cross-tenant access denied' };
    }

    const userPermissions = userRecord
      ? this.normalizePermissions(Array.isArray(userRecord.Permissions) ? userRecord.Permissions : [])
      : [];
    const actorPermissions = this.normalizePermissions(candidate.permissions);
    const rolePermissions = isDirectDashboard
      ? []
      : (ROLE_PERMISSIONS[role] || []).map((item) => this.normalizePermission(item));
    const effectivePermissions = new Set([...actorPermissions, ...userPermissions, ...rolePermissions]);

    if (role === 'ADMIN' || effectivePermissions.has('*') || effectivePermissions.has(permissionKey)) {
      return {
        ok: true,
        actor: {
          userId: candidate.userId,
          role,
          companyId: candidate.companyId,
          brokerageId: candidate.brokerageId,
          permissions: Array.from(effectivePermissions),
          principalType: isDirectDashboard ? DIRECT_DASHBOARD_PRINCIPAL_TYPE : ''
        }
      };
    }

    return { ok: false, statusCode: 403, error: 'Forbidden' };
  }
}

function getSessionMaxAgeSeconds(repository) {
  const settings = repository && typeof repository.getSettings === 'function' ? repository.getSettings() : null;
  const minutes = Number(settings?.Security?.SessionTimeoutMinutes ?? settings?.SessionTimeoutMinutes);
  if (Number.isFinite(minutes) && minutes > 0) return Math.floor(minutes * 60);
  return DEFAULT_SESSION_MAX_AGE_SECONDS;
}

module.exports = {
  AuthService,
  SESSION_COOKIE_NAME,
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  DIRECT_DASHBOARD_PRINCIPAL_ID,
  DIRECT_DASHBOARD_PRINCIPAL_TYPE,
  getSessionMaxAgeSeconds,
  VALID_ROLES,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS
};
