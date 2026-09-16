const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { version: appVersion } = require('../../package.json');
const mongoStore = require('./mongoStore');

let globalIdCounter = 0;
const ARRAY_COLLECTION_KEYS = [
  'Users',
  'Roles',
  'Leads',
  'Transactions',
  'Requirements',
  'RequirementHistory',
  'Activities',
  'Timeline',
  'FollowUps',
  'Inventory',
  'Media',
  'Matches',
  'Properties',
  'Shortlists',
  'SiteVisits',
  'Negotiations',
  'NegotiationHistory',
  'Tokens',
  'Deals',
  'Payments',
  'Commission',
  'CommissionLedger',
  'Closings',
  'ClosingHistory',
  'Documents',
  'Owners',
  'Builders',
  'Projects',
  'Brokers',
  'BrokerShares',
  'BrokerSubmissions',
  'Permissions',
  'Audit',
  'Settings',
  'Masters',
  'PipelineConfig',
  'Notifications',
  'Backups',
  'ConfigurationHistory',
  'FormConfig',
  'FormRegistry',
  'Sessions',
  'AuthExchangeStates',
  'V2FieldConfig',
  'V2QuestionConfig',
  'V2FormRegistry',
  'V2DependencyConfig',
  'V2ScoringConfig'
];

class JsonRepository {
  constructor(dbFile = process.env.SIG_REALTY_DB_FILE || (() => {
    const args = process.argv || [];
    const isNodeTestRun = args.some((arg) => arg === '--test' || arg.includes('.test.js') || arg.includes('node:test'));
    if (isNodeTestRun) {
      const testDir = path.join(os.tmpdir(), 'sig-realty-test-db');
      fs.mkdirSync(testDir, { recursive: true });
      return path.join(testDir, `sig-realty-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    }
    return path.join(__dirname, '../../data/sig-realty-db.json');
  })()) {
    this.dbFile = dbFile;
    this._memoryDb = null;
    this.ensureDatabase();
  }

  createId(prefix) {
    const stamp = Date.now();
    const sequence = globalIdCounter++;
    return `${prefix}-${stamp}-${sequence}`;
  }

  ensureDatabase() {
    // Mongo mode with snapshot loaded — seed & return, no file work.
    if (mongoStore.isEnabled() && mongoStore.isInitialized()) {
      this.ensureStarterSeed();
      return;
    }
    // Mongo enabled but not yet initialized (pre-boot phase): keep an in-memory
    // shadow DB so startup seeding does not touch the JSON file before Mongo is ready.
    if (mongoStore.isEnabled()) {
      this._memoryDb = this._memoryDb || {};
      return;
    }
    const dir = path.dirname(this.dbFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.dbFile) || fs.statSync(this.dbFile).size === 0) {
      const initial = {
        Users: [],
        Roles: [],
        Leads: [],
        Transactions: [],
        Requirements: [],
        RequirementHistory: [],
        Activities: [],
        Timeline: [],
        FollowUps: [],
        Inventory: [],
        Media: [],
        Matches: [],
        Properties: [],
        Shortlists: [],
        SiteVisits: [],
        Negotiations: [],
        NegotiationHistory: [],
        Tokens: [],
        Deals: [],
        Payments: [],
        Commission: [],
        CommissionLedger: [],
        Closings: [],
        ClosingHistory: [],
        Documents: [],
        Owners: [],
        Builders: [],
        Projects: [],
        Brokers: [],
        BrokerShares: [],
        BrokerSubmissions: [],
        Permissions: [],
        Audit: [],
        Settings: [],
        Masters: [],
        PipelineConfig: [],
        Notifications: [],
        Backups: [],
        ConfigurationHistory: [],
        FormConfig: [],
        FormRegistry: [],
        Sessions: [],
        AuthExchangeStates: [],
        V2FieldConfig: [],
        V2QuestionConfig: [],
        V2FormRegistry: [],
        V2DependencyConfig: [],
        V2ScoringConfig: [],
        RequirementHistory: [],
        _V2Counters: { Lead: 0, Transaction: 0, Requirement: 0 }
      };

      fs.writeFileSync(this.dbFile, JSON.stringify(initial, null, 2));
    }

    this.ensureStarterSeed();
  }

  ensureStarterSeed() {
    const db = this.read();
    if (!Array.isArray(db.Users)) db.Users = [];
    if (!db.Users.some((user) => user.UserID === 'USR-SYSTEM-ADMIN')) {
      db.Users.push({
        UserID: 'USR-SYSTEM-ADMIN',
        Name: 'System Administrator',
        Role: 'ADMIN',
        Status: 'Active',
        Permissions: ['*'],
        CompanyID: 'COMP-DEFAULT',
        BrokerageID: 'BRK-DEFAULT',
        CreatedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString()
      });
      this.write(db);
    }
  }

  read() {
    if (mongoStore.isEnabled()) {
      if (mongoStore.isInitialized()) {
        return this.normalizeDbShape(mongoStore.read());
      }
      if (this._memoryDb) {
        return this.normalizeDbShape(JSON.parse(JSON.stringify(this._memoryDb)));
      }
      return this.normalizeDbShape({});
    }

    try {
      return this.normalizeDbShape(JSON.parse(fs.readFileSync(this.dbFile, 'utf8')));
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        throw error;
      }
      this.ensureDatabase();
      return this.normalizeDbShape(JSON.parse(fs.readFileSync(this.dbFile, 'utf8')));
    }
  }

  normalizeDbShape(rawDb) {
    const db = rawDb && typeof rawDb === 'object' && !Array.isArray(rawDb) ? rawDb : {};
    for (const key of ARRAY_COLLECTION_KEYS) {
      if (!Array.isArray(db[key])) db[key] = [];
    }
    if (!db._V2Counters || typeof db._V2Counters !== 'object' || Array.isArray(db._V2Counters)) {
      db._V2Counters = { Lead: 0, Transaction: 0, Requirement: 0 };
    } else {
      db._V2Counters.Lead = Number.isFinite(Number(db._V2Counters.Lead)) ? Number(db._V2Counters.Lead) : 0;
      db._V2Counters.Transaction = Number.isFinite(Number(db._V2Counters.Transaction)) ? Number(db._V2Counters.Transaction) : 0;
      db._V2Counters.Requirement = Number.isFinite(Number(db._V2Counters.Requirement)) ? Number(db._V2Counters.Requirement) : 0;
    }
    return db;
  }

  write(db) {
    if (mongoStore.isEnabled()) {
      if (mongoStore.isInitialized()) {
        mongoStore.write(db);
        return;
      }
      this._memoryDb = JSON.parse(JSON.stringify(db));
      return;
    }
    const dir = path.dirname(this.dbFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Node.js is single-threaded and all callers perform a fully synchronous
    // read → modify → write cycle with no intermediate awaits, so these
    // synchronous fs operations cannot be interleaved by another request
    // within the same process. The atomic tmp-file rename guarantees that a
    // partially-written file is never visible to a concurrent reader.
    const tempFile = `${this.dbFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
    fs.renameSync(tempFile, this.dbFile);
  }

  nextId(prefix, collection) {
    const rows = this.read()[collection] || [];
    const max = rows.reduce((acc, item) => {
      const id = Number(String(item[`${collection.includes('Lead') ? 'Lead' : collection}`] || '0'));
      return acc;
    }, 0);

    const next = rows.length + 1;
    return `${prefix}-${String(next).padStart(4, '0')}`;
  }

  list(collection) {
    const rows = this.read()[collection];
    return Array.isArray(rows) ? rows : [];
  }

  create(collection, row) {
    const db = this.read();
    db[collection] = db[collection] || [];
    db[collection].push(row);
    this.write(db);
    return row;
  }

  update(collection, idField, id, changes) {
    const db = this.read();
    const rows = db[collection] || (db[collection] = []);
    const index = rows.findIndex((row) => row[idField] === id);
    if (index === -1) return null;

    const updated = { ...rows[index], ...changes };
    rows[index] = updated;
    db[collection] = rows;
    this.write(db);
    return updated;
  }

  find(collection, idField, id) {
    const rows = this.list(collection);
    return rows.find((row) => row[idField] === id) || null;
  }

  updateBy(collection, predicate, updater) {
    const db = this.read();
    const rows = Array.isArray(db[collection]) ? db[collection] : [];
    const updatedRows = rows.map((row) => {
      if (predicate(row)) {
        return updater(row);
      }
      return row;
    });

    db[collection] = updatedRows;
    this.write(db);
  }

  delete(collection, idField, id) {
    const db = this.read();
    const rows = db[collection] || (db[collection] = []);
    const filtered = rows.filter((row) => row[idField] !== id);
    db[collection] = filtered;
    this.write(db);
    return true;
  }

  normalizeSessionRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const sessionId = String(record.sessionId || record.SessionID || '').trim();
    if (!sessionId) return null;
    return {
      sessionId,
      userId: String(record.userId || record.UserID || '').trim(),
      role: String(record.role || record.Role || '').trim().toUpperCase(),
      companyId: String(record.companyId || record.CompanyID || '').trim(),
      brokerageId: String(record.brokerageId || record.BrokerageID || '').trim(),
      permissions: Array.isArray(record.permissions)
        ? record.permissions
        : Array.isArray(record.Permissions)
          ? record.Permissions
          : [],
      principalType: String(record.principalType || record.PrincipalType || '').trim(),
      issuedAt: String(record.issuedAt || record.IssuedAt || '').trim(),
      expiresAt: String(record.expiresAt || record.ExpiresAt || '').trim()
    };
  }

  serializeSessionRecord(session) {
    const normalized = this.normalizeSessionRecord(session);
    if (!normalized) return null;
    return {
      SessionID: normalized.sessionId,
      UserID: normalized.userId,
      Role: normalized.role,
      CompanyID: normalized.companyId,
      BrokerageID: normalized.brokerageId,
      Permissions: normalized.permissions,
      PrincipalType: normalized.principalType,
      IssuedAt: normalized.issuedAt,
      ExpiresAt: normalized.expiresAt
    };
  }

  listSessions(options = {}) {
    const includeExpired = options?.includeExpired === true;
    const now = Date.now();
    const db = this.read();
    const rows = Array.isArray(db.Sessions) ? db.Sessions : [];
    const retainedRows = [];
    const sessions = [];
    let removed = 0;
    for (const row of rows) {
      const normalized = this.normalizeSessionRecord(row);
      if (!normalized) {
        removed += 1;
        continue;
      }
      const expiresAt = normalized.expiresAt ? new Date(normalized.expiresAt).getTime() : null;
      const expired = Number.isFinite(expiresAt) && expiresAt <= now;
      if (!expired) {
        retainedRows.push(row);
      } else if (!includeExpired) {
        removed += 1;
      }
      if (includeExpired || !expired) {
        sessions.push(normalized);
      }
    }
    if (!includeExpired && removed > 0) {
      db.Sessions = retainedRows;
      this.write(db);
    }
    return sessions;
  }

  getSession(sessionId) {
    const sessionKey = String(sessionId || '').trim();
    if (!sessionKey) return null;
    const session = this.normalizeSessionRecord(this.find('Sessions', 'SessionID', sessionKey));
    if (!session) return null;
    const expiresAt = session.expiresAt ? new Date(session.expiresAt).getTime() : null;
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      this.deleteSession(sessionKey);
      return null;
    }
    return session;
  }

  upsertSession(session) {
    const row = this.serializeSessionRecord(session);
    if (!row) {
      throw new Error('Valid session data is required');
    }
    const db = this.read();
    const rows = Array.isArray(db.Sessions) ? db.Sessions : [];
    const index = rows.findIndex((entry) => String(entry?.SessionID || '').trim() === row.SessionID);
    if (index === -1) rows.push(row);
    else rows[index] = row;
    db.Sessions = rows;
    this.write(db);
    return this.normalizeSessionRecord(row);
  }

  normalizeAuthExchangeStateRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const stateId = String(record.stateId || record.state || record.StateID || '').trim();
    if (!stateId) return null;
    return {
      stateId,
      redirectUri: String(record.redirectUri || record.RedirectURI || '').trim(),
      nextPath: String(record.nextPath || record.NextPath || '').trim() || '/',
      browserFlowHash: String(record.browserFlowHash || record.BrowserFlowHash || '').trim(),
      authMode: String(record.authMode || record.AuthMode || '').trim(),
      issuedAt: String(record.issuedAt || record.IssuedAt || '').trim(),
      expiresAt: String(record.expiresAt || record.ExpiresAt || '').trim(),
      consumedAt: String(record.consumedAt || record.ConsumedAt || '').trim()
    };
  }

  serializeAuthExchangeStateRecord(record) {
    const normalized = this.normalizeAuthExchangeStateRecord(record);
    if (!normalized) return null;
    return {
      StateID: normalized.stateId,
      RedirectURI: normalized.redirectUri,
      NextPath: normalized.nextPath,
      BrowserFlowHash: normalized.browserFlowHash,
      AuthMode: normalized.authMode,
      IssuedAt: normalized.issuedAt,
      ExpiresAt: normalized.expiresAt,
      ConsumedAt: normalized.consumedAt || null
    };
  }

  getAuthExchangeState(stateId, options = {}) {
    const stateKey = String(stateId || '').trim();
    if (!stateKey) return null;
    const includeExpired = options.includeExpired === true;
    const record = this.normalizeAuthExchangeStateRecord(this.find('AuthExchangeStates', 'StateID', stateKey));
    if (!record) return null;
    const expiresAt = record.expiresAt ? new Date(record.expiresAt).getTime() : null;
    if (!includeExpired && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      this.deleteAuthExchangeState(stateKey);
      return null;
    }
    return record;
  }

  upsertAuthExchangeState(record) {
    const row = this.serializeAuthExchangeStateRecord(record);
    if (!row) {
      throw new Error('Valid auth exchange state data is required');
    }
    const db = this.read();
    const rows = Array.isArray(db.AuthExchangeStates) ? db.AuthExchangeStates : [];
    const index = rows.findIndex((entry) => String(entry?.StateID || '').trim() === row.StateID);
    if (index === -1) rows.push(row);
    else rows[index] = row;
    db.AuthExchangeStates = rows;
    this.write(db);
    return this.normalizeAuthExchangeStateRecord(row);
  }

  deleteAuthExchangeState(stateId) {
    const stateKey = String(stateId || '').trim();
    if (!stateKey) return false;
    const db = this.read();
    const rows = Array.isArray(db.AuthExchangeStates) ? db.AuthExchangeStates : [];
    const filtered = rows.filter((row) => String(row?.StateID || '').trim() !== stateKey);
    const changed = filtered.length !== rows.length;
    if (changed) {
      db.AuthExchangeStates = filtered;
      this.write(db);
    }
    return changed;
  }

  markAuthExchangeStateConsumed(stateId, consumedAt = new Date().toISOString()) {
    const stateKey = String(stateId || '').trim();
    if (!stateKey) return null;
    const existing = this.getAuthExchangeState(stateKey, { includeExpired: true });
    if (!existing) return null;
    return this.upsertAuthExchangeState({
      ...existing,
      consumedAt: String(consumedAt || '').trim() || new Date().toISOString()
    });
  }

  consumeAuthExchangeState(stateId, consumedAt = new Date().toISOString()) {
    const stateKey = String(stateId || '').trim();
    if (!stateKey) return { ok: false, reason: 'missing' };
    const db = this.read();
    const rows = Array.isArray(db.AuthExchangeStates) ? db.AuthExchangeStates : [];
    const index = rows.findIndex((row) => String(row?.StateID || '').trim() === stateKey);
    if (index === -1) return { ok: false, reason: 'missing' };
    const existing = this.normalizeAuthExchangeStateRecord(rows[index]);
    if (!existing) return { ok: false, reason: 'missing' };
    const expiresAt = existing.expiresAt ? new Date(existing.expiresAt).getTime() : null;
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      db.AuthExchangeStates = rows.filter((row) => String(row?.StateID || '').trim() !== stateKey);
      this.write(db);
      return { ok: false, reason: 'expired' };
    }
    if (existing.consumedAt) {
      return { ok: false, reason: 'replayed', record: existing };
    }
    const updated = {
      ...rows[index],
      ConsumedAt: String(consumedAt || '').trim() || new Date().toISOString()
    };
    rows[index] = updated;
    db.AuthExchangeStates = rows;
    this.write(db);
    return { ok: true, record: this.normalizeAuthExchangeStateRecord(updated) };
  }

  deleteExpiredAuthExchangeStates(now = Date.now()) {
    const cutoff = Number(now);
    const db = this.read();
    const rows = Array.isArray(db.AuthExchangeStates) ? db.AuthExchangeStates : [];
    const filtered = rows.filter((row) => {
      const expiresAt = row?.ExpiresAt ? new Date(row.ExpiresAt).getTime() : null;
      return !(Number.isFinite(expiresAt) && expiresAt <= cutoff);
    });
    const removed = rows.length - filtered.length;
    if (removed > 0) {
      db.AuthExchangeStates = filtered;
      this.write(db);
    }
    return removed;
  }

  deleteSession(sessionId) {
    const sessionKey = String(sessionId || '').trim();
    if (!sessionKey) return false;
    const db = this.read();
    const rows = Array.isArray(db.Sessions) ? db.Sessions : [];
    const filtered = rows.filter((row) => String(row?.SessionID || '').trim() !== sessionKey);
    const changed = filtered.length !== rows.length;
    if (changed) {
      db.Sessions = filtered;
      this.write(db);
    }
    return changed;
  }

  deleteExpiredSessions(now = Date.now()) {
    const cutoff = Number(now);
    const db = this.read();
    const rows = Array.isArray(db.Sessions) ? db.Sessions : [];
    const filtered = rows.filter((row) => {
      const expiresAt = row?.ExpiresAt ? new Date(row.ExpiresAt).getTime() : null;
      return !(Number.isFinite(expiresAt) && expiresAt <= cutoff);
    });
    const removed = rows.length - filtered.length;
    if (removed > 0) {
      db.Sessions = filtered;
      this.write(db);
    }
    return removed;
  }

  createLead(payload) {
    const db = this.read();
    db.Leads = db.Leads || [];
    const leadSource = payload.leadSource || payload.LeadSource || payload.source || payload.Source || 'Manual';
    const lead = {
      LeadID: payload.LeadID || this.createId('LEAD'),
      ClientName: payload.clientName || payload.ClientName,
      City: payload.city || payload.City,
      Phone: payload.phone || payload.Phone,
      Email: payload.email || payload.Email,
      LeadStatus: payload.leadStatus || payload.LeadStatus || 'New',
      LeadSource: leadSource,
      Source: leadSource,
      AssignedAgentID: payload.assignedAgentId || payload.AssignedAgentID || 'USR-0001',
      CompanyID: payload.CompanyID || payload.CompanyId || null,
      BrokerageID: payload.BrokerageID || payload.BrokerageId || null,
      CreatedBy: payload.CreatedBy || payload.createdBy || null,
      CreatedAt: payload.createdAt || new Date().toISOString(),
      UpdatedAt: payload.updatedAt || new Date().toISOString(),
      last_activity_at: payload.last_activity_at || new Date().toISOString(),
      ArchiveFlag: false
    };

    db.Leads.push(lead);
    this.write(db);
    this.addTimelineEntry(lead.LeadID, 'Lead', lead.LeadID, 'LEAD_CREATED', 'Lead created', lead);
    return lead;
  }

  listLeads() {
    return this.list('Leads');
  }

  readLead(leadId) {
    return this.find('Leads', 'LeadID', leadId);
  }

  updateLead(leadId, payload) {
    const db = this.read();
    db.Leads = db.Leads || [];
    const leadIndex = db.Leads.findIndex((lead) => lead.LeadID === leadId);
    if (leadIndex === -1) return null;

    const existing = db.Leads[leadIndex];
    const updates = { ...payload };
    const leadSource = updates.leadSource || updates.LeadSource || updates.source || updates.Source || existing.LeadSource || existing.Source || 'Manual';

    const normalized = {
      ClientName: updates.clientName || updates.ClientName || existing.ClientName,
      City: updates.city || updates.City || existing.City,
      Phone: updates.phone || updates.Phone || existing.Phone,
      Email: updates.email || updates.Email || existing.Email,
      LeadStatus: updates.leadStatus || updates.LeadStatus || existing.LeadStatus,
      LeadSource: leadSource,
      Source: leadSource,
      AssignedAgentID: updates.assignedAgentId || updates.AssignedAgentID || existing.AssignedAgentID,
      UpdatedAt: new Date().toISOString(),
      ArchiveFlag: updates.archiveFlag !== undefined ? updates.archiveFlag : existing.ArchiveFlag
    };

    db.Leads[leadIndex] = { ...existing, ...normalized };
    this.write(db);

    return db.Leads[leadIndex];
  }

  createRequirement(payload) {
    const db = this.read();
    db.Requirements = db.Requirements || [];
    const requirement = {
      RequirementID: payload.RequirementID || this.createId('REQ'),
      RequirementCode: payload.RequirementCode || this.createId('REQ'),
      LeadID: payload.LeadID || payload.leadId,
      TransactionID: payload.TransactionID || payload.transactionId || 'TXN-0001',
      TransactionType: payload.TransactionType || payload.transactionType || 'Purchase',
      Category: payload.Category || payload.category,
      SubCategory: payload.SubCategory || payload.subCategory,
      PropertyType: payload.PropertyType || payload.propertyType,
      BudgetMin: payload.BudgetMin || payload.budgetMin,
      BudgetMax: payload.BudgetMax || payload.budgetMax,
      Location1: payload.Location1 || payload.location1,
      Location2: payload.Location2 || payload.location2,
      Location3: payload.Location3 || payload.location3 || null,
      BHKMin: payload.BHKMin || payload.bhkMin || null,
      BHKMax: payload.BHKMax || payload.bhkMax || null,
      AreaMin: payload.AreaMin || payload.areaMin || null,
      AreaMax: payload.AreaMax || payload.areaMax || null,
      Possession: payload.Possession || payload.possession,
      Urgency: payload.Urgency || payload.urgency,
      SpecialNotes: payload.SpecialNotes || payload.specialNotes,
      Status: payload.Status || payload.status || 'Active',
      CompanyID: payload.CompanyID || payload.CompanyId || null,
      BrokerageID: payload.BrokerageID || payload.BrokerageId || null,
      CreatedBy: payload.CreatedBy || payload.createdBy || null,
      CreatedAt: payload.CreatedAt || payload.createdAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || new Date().toISOString(),
      VersionNumber: 1
    };

    db.Requirements.push(requirement);
    this.write(db);
    this.addTimelineEntry(requirement.LeadID, 'Requirement', requirement.RequirementID, 'REQUIREMENT_CREATED', 'Requirement created', requirement);

    return requirement;
  }

  listRequirementsByLead(leadId) {
    const db = this.read();
    return db.Requirements.filter((row) => row.LeadID === leadId);
  }

  readRequirement(requirementId) {
    const db = this.read();
    return db.Requirements.find((row) => row.RequirementID === requirementId) || null;
  }

  updateRequirement(requirementId, changes) {
    const db = this.read();
    db.Requirements = db.Requirements || [];
    db.RequirementHistory = db.RequirementHistory || [];
    db.Activities = db.Activities || [];
    db.Timeline = db.Timeline || [];
    const previous = db.Requirements.find((row) => row.RequirementID === requirementId);
    if (!previous) return null;

    const requirements = db.Requirements;
    const index = requirements.findIndex((row) => row.RequirementID === requirementId);
    const previousSnapshot = { ...previous };

    const updated = {
      ...previous,
      ...changes,
      UpdatedAt: new Date().toISOString()
    };
    if (changes.RequirementStatus !== undefined && changes.Status === undefined) {
      updated.Status = changes.RequirementStatus;
    }
    if (changes.Status !== undefined && changes.RequirementStatus === undefined) {
      updated.RequirementStatus = changes.Status;
    }
    const previousStatus = String(previous.RequirementStatus || previous.Status || '').trim();
    const nextStatus = String(updated.RequirementStatus || updated.Status || '').trim();

    requirements[index] = updated;

    const history = {
      RequirementHistoryID: this.createId('REQH'),
      RequirementID: requirementId,
      VersionNumber: Number(previous.VersionNumber || 1) + 1,
      ChangedBy: 'system',
      ChangedAt: new Date().toISOString(),
      ChangeSummary: 'Requirement updated',
      PreviousData: previousSnapshot,
      NewData: updated
    };

    db.RequirementHistory.push(history);

    if (nextStatus && previousStatus !== nextStatus) {
      this.appendRequirementStatusTransitionArtifacts(db, {
        requirement: updated,
        previousStatus,
        nextStatus,
        changedFields: [],
        occurredAt: updated.UpdatedAt,
        actorUserId: 'system'
      });
    }
    this.write(db);

    return { requirement: updated, history };
  }

  appendRequirementStatusTransitionArtifacts(db, {
    requirement,
    previousStatus,
    nextStatus,
    changedFields = [],
    occurredAt = new Date().toISOString(),
    actorUserId = 'system'
  }) {
    if (!requirement || !nextStatus || previousStatus === nextStatus) return;

    db.Activities = db.Activities || [];
    db.Timeline = db.Timeline || [];

    const requirementId = requirement.RequirementID || null;
    const fromStatus = previousStatus || null;
    const toStatus = nextStatus || null;
    const transitionKey = `${requirementId || ''}|${fromStatus || ''}|${toStatus || ''}|${occurredAt}`;

    let activityNote = `Requirement status changed: ${previousStatus || 'Unknown'} → ${nextStatus}`;
    let eventType = 'REQUIREMENT_STATUS_CHANGED';
    let eventTitle = `Requirement status changed to ${nextStatus}`;
    if (nextStatus === 'Lost') {
      activityNote = `Requirement marked Lost${requirement.LostReason ? `: ${requirement.LostReason}` : ''}${requirement.LostNotes ? ` — ${requirement.LostNotes}` : ''}`;
      eventType = 'REQUIREMENT_LOST';
      eventTitle = 'Requirement marked Lost';
    } else if (previousStatus === 'Lost') {
      activityNote = `Requirement reactivated to ${nextStatus}`;
      eventType = 'REQUIREMENT_REACTIVATED';
      eventTitle = 'Requirement reactivated';
    }

    const hasActivity = db.Activities.some((row) =>
      row &&
      row.RequirementID === requirementId &&
      row.ActivityType === 'Requirement' &&
      row._transitionKey === transitionKey
    );
    if (!hasActivity) {
      db.Activities.push({
        ActivityID: this.createId('ACT'),
        LeadID: requirement.LeadID || null,
        TransactionID: requirement.TransactionID || null,
        RequirementID: requirementId,
        ActivityType: 'Requirement',
        Notes: activityNote,
        CreatedAt: occurredAt,
        _transitionKey: transitionKey
      });
    }

    const hasTimeline = db.Timeline.some((row) =>
      row &&
      row.EntityType === 'Requirement' &&
      row.EntityID === requirementId &&
      row.EventType === eventType &&
      row?.Payload?._transitionKey === transitionKey
    );
    if (!hasTimeline) {
      db.Timeline.push({
        TimelineID: this.createId('TIM'),
        LeadID: requirement.LeadID || null,
        EntityType: 'Requirement',
        EntityID: requirementId,
        EventType: eventType,
        EventTitle: eventTitle,
        EventDate: occurredAt,
        Payload: {
          RequirementID: requirementId,
          fromStatus,
          toStatus,
          LostReason: requirement.LostReason || null,
          LostNotes: requirement.LostNotes || requirement.LostNote || null,
          changedFields,
          changedBy: actorUserId || 'system',
          _transitionKey: transitionKey
        }
      });
    }
  }

  appendLeadStatusTransitionArtifacts(db, {
    lead,
    previousStatus,
    nextStatus,
    occurredAt = new Date().toISOString(),
    actorUserId = 'system'
  }) {
    if (!lead || !nextStatus || previousStatus === nextStatus) return;

    db.Activities = db.Activities || [];
    db.Timeline = db.Timeline || [];

    const leadId = lead.LeadID || null;
    const transitionKey = `${leadId || ''}|${previousStatus || ''}|${nextStatus || ''}`;
    let eventType = 'LEAD_STATUS_CHANGED';
    let eventTitle = `Lead status changed to ${nextStatus}`;
    let activityNote = `Lead status changed: ${previousStatus || 'Unknown'} → ${nextStatus}`;

    if (nextStatus === 'Lost') {
      eventType = 'LEAD_LOST';
      eventTitle = 'Lead marked Lost';
      activityNote = `Lead marked Lost${lead.LostReason ? `: ${lead.LostReason}` : ''}${lead.LostNote ? ` — ${lead.LostNote}` : ''}`;
    } else if (previousStatus === 'Lost') {
      eventType = 'LEAD_REACTIVATED';
      eventTitle = 'Lead reactivated';
      activityNote = `Lead reactivated: Lost → ${nextStatus}`;
    } else if (nextStatus === 'Won') {
      eventType = 'LEAD_WON';
      eventTitle = 'Lead marked Won';
      activityNote = 'Lead marked Won';
    }

    const hasActivity = db.Activities.some((row) =>
      row &&
      row.LeadID === leadId &&
      row.ActivityType === 'Lead' &&
      row._transitionKey === transitionKey
    );
    if (!hasActivity) {
      db.Activities.push({
        ActivityID: this.createId('ACT'),
        LeadID: leadId,
        ActivityType: 'Lead',
        Notes: activityNote,
        CreatedAt: occurredAt,
        CreatedBy: actorUserId || 'system',
        _transitionKey: transitionKey
      });
    }

    const hasTimeline = db.Timeline.some((row) =>
      row &&
      row.EntityType === 'Lead' &&
      row.EntityID === leadId &&
      row.EventType === eventType &&
      row?.Payload?._transitionKey === transitionKey
    );
    if (!hasTimeline) {
      db.Timeline.push({
        TimelineID: this.createId('TIM'),
        LeadID: leadId,
        EntityType: 'Lead',
        EntityID: leadId,
        EventType: eventType,
        EventTitle: eventTitle,
        EventDate: occurredAt,
        Payload: {
          fromStatus: previousStatus || null,
          toStatus: nextStatus || null,
          LostReason: lead.LostReason || null,
          LostNote: lead.LostNote || null,
          changedBy: actorUserId || 'system',
          _transitionKey: transitionKey
        }
      });
    }
  }

  archiveRequirement(requirementId) {
    const db = this.read();
    db.Requirements = db.Requirements || [];
    const requirement = db.Requirements.find((row) => row.RequirementID === requirementId);
    if (!requirement) return null;

    requirement.Status = 'Cancelled';
    requirement.UpdatedAt = new Date().toISOString();
    this.write(db);
    return requirement;
  }

  duplicateRequirement(requirementId) {
    const db = this.read();
    db.Requirements = db.Requirements || [];
    const req = db.Requirements.find((row) => row.RequirementID === requirementId);
    if (!req) return null;

    const dup = {
      ...req,
      RequirementID: this.createId('REQ'),
      RequirementCode: `${req.RequirementCode}-COPY`,
      Status: 'Active',
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
      VersionNumber: 1
    };

    db.Requirements.push(dup);
    this.write(db);
    return dup;
  }

  createActivity(leadId, payload) {
    const db = this.read();
    db.Activities = db.Activities || [];
    db.Timeline = db.Timeline || [];
    const activity = {
      ActivityID: this.createId('ACT'),
      LeadID: leadId,
      TransactionID: payload.TransactionID || null,
      ActivityType: payload.activityType || payload.ActivityType || 'Note',
      Notes: payload.notes || payload.Notes || '',
      CreatedAt: new Date().toISOString()
    };

    db.Activities.push(activity);

    const lead = db.Leads.find((row) => row.LeadID === leadId);
    if (lead) {
      lead.last_activity_at = activity.CreatedAt;
      lead.UpdatedAt = activity.CreatedAt;
    }

    db.Timeline.push({
      TimelineID: this.createId('TIM'),
      LeadID: leadId,
      EntityType: 'Activity',
      EntityID: activity.ActivityID,
      EventType: activity.ActivityType,
      EventTitle: activity.ActivityType,
      EventDate: activity.CreatedAt,
      Payload: activity
    });

    this.write(db);
    return activity;
  }

  getLeadActivities(leadId) {
    const db = this.read();
    return db.Activities.filter((row) => row.LeadID === leadId);
  }

  requirementHistory(requirementId) {
    const db = this.read();
    return db.RequirementHistory.filter((row) => row.RequirementID === requirementId);
  }

  listMatches(requirementId = null) {
    const db = this.read();
    db.Matches = db.Matches || [];
    if (requirementId) {
      return db.Matches.filter((m) => m.RequirementID === requirementId).sort((a, b) => b.Score - a.Score);
    }
    return db.Matches.sort((a, b) => b.Score - a.Score);
  }

  getMatch(matchId) {
    const db = this.read();
    db.Matches = db.Matches || [];
    return db.Matches.find((m) => m.MatchID === matchId) || null;
  }

  createMatch(payload) {
    const db = this.read();
    db.Matches = db.Matches || [];
    const match = {
      MatchID: payload.MatchID || this.createId('MATCH'),
      RequirementID: payload.RequirementID || payload.requirementId,
      PropertyID: payload.PropertyID || payload.propertyId,
      LeadID: payload.LeadID || payload.leadId,
      Score: payload.Score || payload.score || 0,
      MatchLevel: payload.MatchLevel || payload.matchLevel || 'Weak',
      MatchedCriteria: payload.MatchedCriteria || payload.matchedCriteria || [],
      FailedCriteria: payload.FailedCriteria || payload.failedCriteria || [],
      UnknownCriteria: payload.UnknownCriteria || payload.unknownCriteria || [],
      ScoreBreakdown: payload.ScoreBreakdown || payload.scoreBreakdown || {},
      Explanation: payload.Explanation || payload.explanation || '',
      Status: payload.Status || payload.status || 'Active',
      AlgorithmVersion: payload.AlgorithmVersion || payload.algorithmVersion || 'matching-v1',
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    };

    db.Matches.push(match);
    this.write(db);
    this.addTimelineEntry(match.LeadID, 'Match', match.MatchID, 'MATCH_FOUND', 'Match found', match);
    return match;
  }

  updateMatch(matchId, changes) {
    const db = this.read();
    db.Matches = db.Matches || [];
    const index = db.Matches.findIndex((m) => m.MatchID === matchId);
    if (index === -1) return null;

    const updated = { ...db.Matches[index], ...changes, UpdatedAt: new Date().toISOString() };
    db.Matches[index] = updated;
    this.write(db);
    return updated;
  }

  isValidSiteVisitStatus(status) {
    return ['Scheduled', 'Confirmed', 'Rescheduled', 'Completed', 'Cancelled', 'NoShow'].includes(status);
  }

  isAllowedSiteVisitTransition(currentStatus, nextStatus) {
    const transitions = {
      Scheduled: ['Confirmed', 'Rescheduled', 'Cancelled', 'NoShow'],
      Confirmed: ['Completed', 'Rescheduled', 'Cancelled', 'NoShow'],
      Rescheduled: ['Confirmed', 'Rescheduled', 'Cancelled', 'NoShow'],
      Completed: [],
      Cancelled: [],
      NoShow: []
    };
    return transitions[currentStatus]?.includes(nextStatus) || false;
  }

  listSiteVisits() {
    const db = this.read();
    db.SiteVisits = db.SiteVisits || [];
    return {
      ok: true,
      data: db.SiteVisits.slice().sort((a, b) => {
        const aKey = `${a.VisitDate || ''} ${a.VisitTime || ''}`;
        const bKey = `${b.VisitDate || ''} ${b.VisitTime || ''}`;
        return bKey.localeCompare(aKey);
      })
    };
  }

  getSiteVisit(visitId) {
    const db = this.read();
    db.SiteVisits = db.SiteVisits || [];
    const visit = db.SiteVisits.find((row) => row.VisitID === visitId) || null;
    return visit ? { ok: true, data: visit } : { ok: false, error: 'Site visit not found' };
  }

  findActiveSiteVisit(leadId, requirementId, propertyId, visitDate, visitTime) {
    const db = this.read();
    db.SiteVisits = db.SiteVisits || [];
    return db.SiteVisits.find((row) => row.LeadID === leadId && row.RequirementID === requirementId && row.PropertyID === propertyId && row.VisitDate === visitDate && row.VisitTime === visitTime && ['Scheduled', 'Confirmed', 'Rescheduled'].includes(row.Status)) || null;
  }

  createSiteVisit(payload = {}) {
    const db = this.read();
    db.SiteVisits = db.SiteVisits || [];

    const leadId = payload.LeadID || payload.leadId || null;
    const requirementId = payload.RequirementID || payload.requirementId || null;
    const propertyId = payload.PropertyID || payload.propertyId || null;
    const matchId = payload.MatchID || payload.matchId || null;
    const shortlistId = payload.ShortlistID || payload.shortlistId || null;
    const visitDate = payload.VisitDate || payload.visitDate || null;
    const visitTime = payload.VisitTime || payload.visitTime || null;

    if (!leadId || !requirementId || !propertyId || !matchId || !visitDate || !visitTime) {
      return { ok: false, error: 'Missing required site visit fields' };
    }

    const lead = this.readLead(leadId);
    if (!lead) {
      return { ok: false, error: 'Lead not found' };
    }

    const requirement = this.readRequirement(requirementId);
    if (!requirement) {
      return { ok: false, error: 'Requirement not found' };
    }

    const property = this.find('Inventory', 'PropertyID', propertyId);
    if (!property) {
      return { ok: false, error: 'Property not found' };
    }

    const match = this.getMatch(matchId);
    if (!match) {
      return { ok: false, error: 'Match not found' };
    }

    if (match.RequirementID !== requirementId || match.PropertyID !== propertyId) {
      return { ok: false, error: 'Match relationship is invalid' };
    }

    if (shortlistId) {
      const shortlist = this.getShortlist(shortlistId);
      if (!shortlist) {
        return { ok: false, error: 'Shortlist not found' };
      }
      if (shortlist.RequirementID !== requirementId || shortlist.PropertyID !== propertyId) {
        return { ok: false, error: 'Shortlist relationship is invalid' };
      }
    }

    const duplicate = this.findActiveSiteVisit(leadId, requirementId, propertyId, visitDate, visitTime);
    if (duplicate) {
      return { ok: false, error: 'Duplicate active site visit already exists for this lead, requirement, property, date and time' };
    }

    const requestedStatus = payload.Status || payload.status || 'Scheduled';
    if (!this.isValidSiteVisitStatus(requestedStatus)) {
      return { ok: false, error: 'Invalid site visit status' };
    }

    const visit = {
      VisitID: payload.VisitID || this.createId('VISIT'),
      LeadID: leadId,
      TransactionID: requirement.TransactionID || null,
      RequirementID: requirementId,
      PropertyID: propertyId,
      MatchID: matchId,
      ShortlistID: shortlistId || null,
      VisitDate: visitDate,
      VisitTime: visitTime,
      Duration: payload.Duration || payload.duration || '60 mins',
      MeetingPoint: payload.MeetingPoint || payload.meetingPoint || '',
      AssignedAgentID: payload.AssignedAgentID || payload.assignedAgentId || null,
      ClientName: payload.ClientName || payload.clientName || lead.ClientName || null,
      ClientPhone: payload.ClientPhone || payload.clientPhone || null,
      Notes: payload.Notes || payload.notes || '',
      Status: requestedStatus,
      CreatedAt: payload.CreatedAt || payload.createdAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || new Date().toISOString()
    };

    db.SiteVisits.push(visit);
    this.write(db);
    this.addTimelineEntry(leadId, 'SiteVisit', visit.VisitID, 'SITE_VISIT_SCHEDULED', 'Site visit scheduled', visit);
    return { ok: true, data: visit };
  }

  updateSiteVisit(visitId, changes = {}) {
    const db = this.read();
    db.SiteVisits = db.SiteVisits || [];
    const index = db.SiteVisits.findIndex((row) => row.VisitID === visitId);
    if (index === -1) {
      return { ok: false, error: 'Site visit not found' };
    }

    const existing = db.SiteVisits[index];
    const nextStatus = changes.Status || changes.status || existing.Status;
    if (nextStatus === existing.Status) {
      return { ok: false, error: `Status transition from ${existing.Status} to ${nextStatus} is not allowed` };
    }
    if (!this.isAllowedSiteVisitTransition(existing.Status, nextStatus)) {
      return { ok: false, error: `Status transition from ${existing.Status} to ${nextStatus} is not allowed` };
    }

    const updated = {
      ...existing,
      VisitDate: changes.VisitDate || changes.visitDate || existing.VisitDate,
      VisitTime: changes.VisitTime || changes.visitTime || existing.VisitTime,
      Duration: changes.Duration || changes.duration || existing.Duration,
      MeetingPoint: changes.MeetingPoint || changes.meetingPoint || existing.MeetingPoint,
      AssignedAgentID: changes.AssignedAgentID || changes.assignedAgentId || existing.AssignedAgentID,
      ClientName: changes.ClientName || changes.clientName || existing.ClientName,
      ClientPhone: changes.ClientPhone || changes.clientPhone || existing.ClientPhone,
      Notes: changes.Notes || changes.notes || existing.Notes,
      Status: nextStatus,
      UpdatedAt: new Date().toISOString()
    };

    db.SiteVisits[index] = updated;
    this.write(db);
    return { ok: true, data: updated };
  }

  rescheduleSiteVisit(visitId, payload = {}) {
    const next = {
      VisitDate: payload.VisitDate || payload.visitDate || null,
      VisitTime: payload.VisitTime || payload.visitTime || null,
      Duration: payload.Duration || payload.duration || null,
      MeetingPoint: payload.MeetingPoint || payload.meetingPoint || null,
      Notes: payload.Notes || payload.notes || null,
      Status: 'Rescheduled'
    };
    return this.updateSiteVisit(visitId, next);
  }

  confirmSiteVisit(visitId) {
    return this.updateSiteVisit(visitId, { Status: 'Confirmed' });
  }

  completeSiteVisit(visitId) {
    return this.updateSiteVisit(visitId, { Status: 'Completed' });
  }

  cancelSiteVisit(visitId) {
    return this.updateSiteVisit(visitId, { Status: 'Cancelled' });
  }

  markSiteVisitNoShow(visitId) {
    return this.updateSiteVisit(visitId, { Status: 'NoShow' });
  }

  deleteMatch(matchId) {
    const db = this.read();
    db.Matches = db.Matches || [];
    const filtered = db.Matches.filter((m) => m.MatchID !== matchId);
    db.Matches = filtered;
    this.write(db);
    return true;
  }

  findMatchByRequirementAndProperty(requirementId, propertyId) {
    const db = this.read();
    db.Matches = db.Matches || [];
    return db.Matches.find((m) => m.RequirementID === requirementId && m.PropertyID === propertyId) || null;
  }

  listShortlists(filters = {}) {
    const db = this.read();
    db.Shortlists = db.Shortlists || [];

    const status = filters.status || null;
    const requirementId = filters.requirementId || null;
    const leadId = filters.leadId || null;

    return db.Shortlists
      .filter((item) => {
        if (status && item.Status !== status) return false;
        if (requirementId && item.RequirementID !== requirementId) return false;
        if (leadId && item.LeadID !== leadId) return false;
        return true;
      })
      .sort((a, b) => {
        const aTime = new Date(a.CreatedAt || 0).getTime();
        const bTime = new Date(b.CreatedAt || 0).getTime();
        return bTime - aTime;
      });
  }

  getShortlist(shortlistId) {
    const db = this.read();
    db.Shortlists = db.Shortlists || [];
    return db.Shortlists.find((item) => item.ShortlistID === shortlistId) || null;
  }

  findActiveShortlist(requirementId, propertyId) {
    const db = this.read();
    db.Shortlists = db.Shortlists || [];
    return db.Shortlists.find((item) => item.RequirementID === requirementId && item.PropertyID === propertyId && item.Status === 'Active') || null;
  }

  createShortlist(payload) {
    const db = this.read();
    db.Shortlists = db.Shortlists || [];

    const shortlist = {
      ShortlistID: payload.ShortlistID || this.createId('SL'),
      RequirementID: payload.RequirementID,
      LeadID: payload.LeadID,
      PropertyID: payload.PropertyID,
      MatchID: payload.MatchID || null,
      Status: payload.Status || 'Active',
      Priority: payload.Priority || 'Medium',
      Notes: payload.Notes || '',
      CreatedBy: payload.CreatedBy || 'system',
      RemovedAt: payload.RemovedAt || null,
      RemovedBy: payload.RemovedBy || null,
      CreatedAt: payload.CreatedAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || new Date().toISOString()
    };

    db.Shortlists.push(shortlist);
    this.write(db);
    this.addTimelineEntry(shortlist.LeadID, 'Shortlist', shortlist.ShortlistID, 'SHORTLISTED', 'Property shortlisted', shortlist);
    return shortlist;
  }

  updateShortlist(shortlistId, changes) {
    const db = this.read();
    db.Shortlists = db.Shortlists || [];
    const index = db.Shortlists.findIndex((item) => item.ShortlistID === shortlistId);
    if (index === -1) return null;

    const updated = {
      ...db.Shortlists[index],
      ...changes,
      UpdatedAt: new Date().toISOString()
    };

    db.Shortlists[index] = updated;
    this.write(db);
    return updated;
  }

  removeShortlist(shortlistId, removedBy = 'system') {
    const shortlist = this.getShortlist(shortlistId);
    if (!shortlist) return null;

    return this.updateShortlist(shortlistId, {
      Status: 'Removed',
      RemovedAt: new Date().toISOString(),
      RemovedBy: removedBy
    });
  }

  addTimelineEntry(leadId, entityType, entityId, eventType, eventTitle, payload = {}) {
    const db = this.read();
    db.Timeline = db.Timeline || [];
    const item = {
      TimelineID: this.createId('TIM'),
      LeadID: leadId,
      EntityType: entityType,
      EntityID: entityId,
      EventType: eventType,
      EventTitle: eventTitle,
      EventDate: new Date().toISOString(),
      Payload: payload
    };
    db.Timeline.push(item);
    this.write(db);
    return item;
  }

  normalizeNegotiationStatus(status) {
    const raw = String(status || '').trim().toUpperCase();
    const aliases = {
      ACCEPTED: 'AGREED',
      REJECTED: 'FAILED',
      WITHDRAWN: 'CANCELLED',
      EXPIRED: 'FAILED'
    };
    return aliases[raw] || raw;
  }

  isValidNegotiationStatus(status) {
    return [
      'OPEN',
      'OFFER_MADE',
      'COUNTER_OFFER',
      'NEGOTIATING',
      'AGREED',
      'TOKEN_PENDING',
      'TOKEN_RECEIVED',
      'AGREEMENT_PENDING',
      'AGREEMENT_DONE',
      'REGISTRATION_PENDING',
      'COMPLETED',
      'CANCELLED',
      'FAILED',
      'ON_HOLD'
    ].includes(this.normalizeNegotiationStatus(status));
  }

  isNegotiationTerminalStatus(status) {
    return ['COMPLETED', 'CANCELLED', 'FAILED'].includes(this.normalizeNegotiationStatus(status));
  }

  getNegotiationTransitions() {
    return {
      OPEN: ['OFFER_MADE', 'COUNTER_OFFER', 'NEGOTIATING', 'AGREED', 'ON_HOLD', 'FAILED', 'CANCELLED'],
      OFFER_MADE: ['COUNTER_OFFER', 'NEGOTIATING', 'AGREED', 'ON_HOLD', 'FAILED', 'CANCELLED'],
      COUNTER_OFFER: ['OFFER_MADE', 'NEGOTIATING', 'AGREED', 'ON_HOLD', 'FAILED', 'CANCELLED'],
      NEGOTIATING: ['OFFER_MADE', 'COUNTER_OFFER', 'AGREED', 'ON_HOLD', 'FAILED', 'CANCELLED'],
      AGREED: ['TOKEN_PENDING', 'TOKEN_RECEIVED', 'ON_HOLD', 'FAILED', 'CANCELLED'],
      TOKEN_PENDING: ['TOKEN_RECEIVED', 'ON_HOLD', 'FAILED', 'CANCELLED'],
      TOKEN_RECEIVED: ['AGREEMENT_PENDING', 'AGREEMENT_DONE', 'ON_HOLD', 'FAILED', 'CANCELLED'],
      AGREEMENT_PENDING: ['AGREEMENT_DONE', 'ON_HOLD', 'FAILED', 'CANCELLED'],
      AGREEMENT_DONE: ['REGISTRATION_PENDING', 'ON_HOLD', 'FAILED', 'CANCELLED'],
      REGISTRATION_PENDING: ['COMPLETED', 'ON_HOLD', 'FAILED', 'CANCELLED'],
      ON_HOLD: ['OPEN', 'OFFER_MADE', 'COUNTER_OFFER', 'NEGOTIATING', 'AGREED', 'TOKEN_PENDING', 'TOKEN_RECEIVED', 'AGREEMENT_PENDING', 'AGREEMENT_DONE', 'REGISTRATION_PENDING', 'FAILED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
      FAILED: []
    };
  }

  canTransitionNegotiation(fromStatus, toStatus) {
    const current = this.normalizeNegotiationStatus(fromStatus);
    const next = this.normalizeNegotiationStatus(toStatus);
    if (current === next) return true;
    const allowed = this.getNegotiationTransitions()[current] || [];
    return allowed.includes(next);
  }

  toMoney(value) {
    if (value === undefined || value === null || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return NaN;
    return Math.round(numeric * 100) / 100;
  }

  validateNonNegativeMoney(label, value, { required = false } = {}) {
    const money = this.toMoney(value);
    if (money === null) {
      if (required) return { ok: false, error: `${label} is required` };
      return { ok: true, value: null };
    }
    if (Number.isNaN(money)) return { ok: false, error: `${label} must be a valid number` };
    if (money < 0) return { ok: false, error: `${label} cannot be negative` };
    return { ok: true, value: money };
  }

  appendNegotiationHistory(db, negotiation, entry) {
    db.NegotiationHistory = db.NegotiationHistory || [];
    const timestamp = entry.Timestamp || new Date().toISOString();
    const item = {
      NegotiationHistoryID: this.createId('NEGH'),
      NegotiationID: negotiation.NegotiationID,
      Action: entry.Action,
      PreviousStatus: entry.PreviousStatus || null,
      NewStatus: entry.NewStatus || null,
      PreviousOffer: entry.PreviousOffer ?? null,
      NewOffer: entry.NewOffer ?? null,
      User: entry.User || 'system',
      Timestamp: timestamp,
      Notes: entry.Notes || ''
    };

    db.NegotiationHistory.push(item);
    negotiation.History = negotiation.History || [];
    negotiation.History.push({
      Step: item.Action,
      Status: item.NewStatus || negotiation.Status,
      Price: item.NewOffer,
      EventDate: item.Timestamp,
      Notes: item.Notes,
      PreviousStatus: item.PreviousStatus,
      PreviousOffer: item.PreviousOffer,
      User: item.User
    });
    return item;
  }

  recalculateBrokerage(negotiation) {
    const brokerageType = String(negotiation.BrokerageType || '').toUpperCase();
    const agreedPrice = this.toMoney(negotiation.AgreedPrice);
    const percent = this.toMoney(negotiation.BrokeragePercent);
    const amount = this.toMoney(negotiation.BrokerageAmount);

    if (brokerageType === 'PERCENT') {
      if (agreedPrice !== null && percent !== null) {
        negotiation.BrokerageAmount = this.toMoney((agreedPrice * percent) / 100);
      }
      return;
    }

    if (brokerageType === 'FIXED') {
      negotiation.BrokerageAmount = amount ?? 0;
      return;
    }

    if (percent !== null && agreedPrice !== null) {
      negotiation.BrokerageType = 'PERCENT';
      negotiation.BrokerageAmount = this.toMoney((agreedPrice * percent) / 100);
    } else if (amount !== null) {
      negotiation.BrokerageType = 'FIXED';
      negotiation.BrokerageAmount = amount;
    }
  }

  validateNegotiationRelationships(db, payload = {}) {
    const leadId = payload.LeadID || payload.leadId;
    const requirementId = payload.RequirementID || payload.requirementId;
    const propertyId = payload.PropertyID || payload.propertyId;
    const matchId = payload.MatchID || payload.matchId || null;
    const shortlistId = payload.ShortlistID || payload.shortlistId || null;
    const siteVisitId = payload.SiteVisitID || payload.siteVisitId || null;

    if (!leadId || !requirementId || !propertyId) {
      return { ok: false, error: 'Missing required negotiation fields' };
    }

    const lead = (db.Leads || []).find((item) => item.LeadID === leadId);
    if (!lead) return { ok: false, error: 'Lead not found' };

    const requirement = (db.Requirements || []).find((item) => item.RequirementID === requirementId);
    if (!requirement) return { ok: false, error: 'Requirement not found' };
    if (requirement.LeadID !== leadId) return { ok: false, error: 'Requirement does not belong to lead' };

    const property = (db.Inventory || []).find((item) => item.PropertyID === propertyId);
    if (!property) return { ok: false, error: 'Property not found' };

    let match = null;
    if (matchId) {
      match = (db.Matches || []).find((item) => item.MatchID === matchId);
      if (!match) return { ok: false, error: 'Match not found' };
      if (match.RequirementID !== requirementId || match.PropertyID !== propertyId) {
        return { ok: false, error: 'Match relationship is invalid' };
      }
    }

    let shortlist = null;
    if (shortlistId) {
      shortlist = (db.Shortlists || []).find((item) => item.ShortlistID === shortlistId);
      if (!shortlist) return { ok: false, error: 'Shortlist not found' };
      if (shortlist.RequirementID !== requirementId || shortlist.PropertyID !== propertyId || shortlist.LeadID !== leadId) {
        return { ok: false, error: 'Shortlist relationship is invalid' };
      }
    }

    let siteVisit = null;
    if (siteVisitId) {
      siteVisit = (db.SiteVisits || []).find((item) => item.VisitID === siteVisitId);
      if (!siteVisit) return { ok: false, error: 'Site visit not found' };
      if (siteVisit.RequirementID !== requirementId || siteVisit.PropertyID !== propertyId || siteVisit.LeadID !== leadId) {
        return { ok: false, error: 'Site visit relationship is invalid' };
      }
    }

    return { ok: true, lead, requirement, property, match, shortlist, siteVisit };
  }

  isValidTokenStatus(status) {
    return ['PENDING', 'PARTIAL', 'PAID', 'CANCELLED', 'REFUNDED', 'EXPIRED'].includes(status);
  }

  listNegotiations(filters = {}) {
    const db = this.read();
    db.Negotiations = db.Negotiations || [];
    return db.Negotiations.filter((row) => {
      if (filters.NegotiationID && row.NegotiationID !== filters.NegotiationID) return false;
      if (filters.LeadID && row.LeadID !== filters.LeadID) return false;
      if (filters.RequirementID && row.RequirementID !== filters.RequirementID) return false;
      if (filters.TransactionID && row.TransactionID !== filters.TransactionID) return false;
      if (filters.PropertyID && row.PropertyID !== filters.PropertyID) return false;
      if (filters.Status && row.Status !== filters.Status) return false;
      return true;
    }).sort((a, b) => new Date(b.UpdatedAt || b.CreatedAt).getTime() - new Date(a.UpdatedAt || a.CreatedAt).getTime());
  }

  listNegotiationHistory(negotiationId) {
    const db = this.read();
    db.NegotiationHistory = db.NegotiationHistory || [];
    return db.NegotiationHistory
      .filter((row) => row.NegotiationID === negotiationId)
      .sort((a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime());
  }

  getNegotiation(negotiationId) {
    const db = this.read();
    db.Negotiations = db.Negotiations || [];
    return db.Negotiations.find((row) => row.NegotiationID === negotiationId) || null;
  }

  createNegotiation(payload = {}) {
    const db = this.read();
    db.Negotiations = db.Negotiations || [];
    db.NegotiationHistory = db.NegotiationHistory || [];

    const validation = this.validateNegotiationRelationships(db, payload);
    if (!validation.ok) return validation;

    const leadId = payload.LeadID || payload.leadId;
    const requirementId = payload.RequirementID || payload.requirementId;
    const propertyId = payload.PropertyID || payload.propertyId;
    const transactionId = payload.TransactionID || payload.transactionId || validation.requirement.TransactionID || null;

    const status = this.normalizeNegotiationStatus(payload.Status || payload.status || 'OPEN');
    if (!this.isValidNegotiationStatus(status)) return { ok: false, error: 'Invalid negotiation status' };

    const id = payload.NegotiationID || this.createId('NEG');
    const activeDuplicate = db.Negotiations.find((row) => {
      return row.LeadID === leadId
        && row.RequirementID === requirementId
        && row.PropertyID === propertyId
        && row.TransactionID === transactionId
        && row.NegotiationID !== id
        && !this.isNegotiationTerminalStatus(row.Status);
    });
    if (activeDuplicate) {
      return { ok: false, error: 'Duplicate active negotiation already exists for this lead/requirement/property/transaction' };
    }

    const askingPriceCheck = this.validateNonNegativeMoney('AskingPrice', payload.AskingPrice ?? payload.askingPrice);
    if (!askingPriceCheck.ok) return { ok: false, error: askingPriceCheck.error };
    const initialOfferCheck = this.validateNonNegativeMoney('InitialOffer', payload.InitialOffer ?? payload.initialOffer ?? payload.ClientOffer ?? payload.clientOffer);
    if (!initialOfferCheck.ok) return { ok: false, error: initialOfferCheck.error };
    const currentOfferCheck = this.validateNonNegativeMoney('CurrentOffer', payload.CurrentOffer ?? payload.currentOffer ?? payload.OwnerOffer ?? payload.ownerOffer);
    if (!currentOfferCheck.ok) return { ok: false, error: currentOfferCheck.error };
    const counterOfferCheck = this.validateNonNegativeMoney('CounterOffer', payload.CounterOffer ?? payload.counterOffer);
    if (!counterOfferCheck.ok) return { ok: false, error: counterOfferCheck.error };
    const finalOfferCheck = this.validateNonNegativeMoney('FinalOffer', payload.FinalOffer ?? payload.finalOffer ?? payload.FinalPrice ?? payload.finalPrice);
    if (!finalOfferCheck.ok) return { ok: false, error: finalOfferCheck.error };
    const agreedPriceCheck = this.validateNonNegativeMoney('AgreedPrice', payload.AgreedPrice ?? payload.agreedPrice ?? payload.FinalPrice ?? payload.finalPrice);
    if (!agreedPriceCheck.ok) return { ok: false, error: agreedPriceCheck.error };
    const tokenAmountCheck = this.validateNonNegativeMoney('TokenAmount', payload.TokenAmount ?? payload.tokenAmount);
    if (!tokenAmountCheck.ok) return { ok: false, error: tokenAmountCheck.error };
    const brokeragePercentCheck = this.validateNonNegativeMoney('BrokeragePercent', payload.BrokeragePercent ?? payload.brokeragePercent);
    if (!brokeragePercentCheck.ok) return { ok: false, error: brokeragePercentCheck.error };
    const brokerageAmountCheck = this.validateNonNegativeMoney('BrokerageAmount', payload.BrokerageAmount ?? payload.brokerageAmount ?? payload.Brokerage ?? payload.brokerage);
    if (!brokerageAmountCheck.ok) return { ok: false, error: brokerageAmountCheck.error };

    const now = new Date().toISOString();
    const negotiation = {
      NegotiationID: id,
      LeadID: leadId,
      RequirementID: requirementId,
      TransactionID: transactionId,
      PropertyID: propertyId,
      MatchID: payload.MatchID || payload.matchId || null,
      ShortlistID: payload.ShortlistID || payload.shortlistId || null,
      SiteVisitID: payload.SiteVisitID || payload.siteVisitId || null,
      AskingPrice: askingPriceCheck.value,
      InitialOffer: initialOfferCheck.value,
      CurrentOffer: currentOfferCheck.value,
      CounterOffer: counterOfferCheck.value,
      FinalOffer: finalOfferCheck.value,
      AgreedPrice: agreedPriceCheck.value,
      BrokerageType: (payload.BrokerageType || payload.brokerageType || '').toUpperCase() || null,
      BrokeragePercent: brokeragePercentCheck.value,
      BrokerageAmount: brokerageAmountCheck.value,
      BrokeragePayer: payload.BrokeragePayer || payload.brokeragePayer || null,
      TokenAmount: tokenAmountCheck.value,
      TokenDate: payload.TokenDate || payload.tokenDate || null,
      PaymentTerms: payload.PaymentTerms || payload.paymentTerms || null,
      PossessionDate: payload.PossessionDate || payload.possessionDate || null,
      AgreementDate: payload.AgreementDate || payload.agreementDate || null,
      RegistrationDate: payload.RegistrationDate || payload.registrationDate || null,
      SpecialTerms: payload.SpecialTerms || payload.specialTerms || null,
      Notes: payload.Notes || payload.notes || '',
      AssignedAgentID: payload.AssignedAgentID || payload.assignedAgentId || validation.requirement.AssignedAgentID || 'USR-0001',
      CreatedBy: payload.CreatedBy || payload.createdBy || 'system',
      UpdatedBy: payload.UpdatedBy || payload.updatedBy || payload.CreatedBy || payload.createdBy || 'system',
      Status: status,
      ClosedAt: null,
      History: [],
      CreatedAt: payload.CreatedAt || payload.createdAt || now,
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || now
    };

    this.recalculateBrokerage(negotiation);
    this.appendNegotiationHistory(db, negotiation, {
      Action: 'NEGOTIATION_CREATED',
      PreviousStatus: null,
      NewStatus: status,
      PreviousOffer: null,
      NewOffer: negotiation.CurrentOffer ?? negotiation.InitialOffer ?? negotiation.CounterOffer ?? negotiation.FinalOffer ?? negotiation.AgreedPrice ?? null,
      User: negotiation.CreatedBy,
      Notes: negotiation.Notes,
      Timestamp: now
    });

    // Persist initial offer progression when create payload already contains staged values.
    const offerStages = [
      { action: 'OFFER_CREATED', value: negotiation.InitialOffer },
      { action: 'OFFER_UPDATED', value: negotiation.CurrentOffer },
      { action: 'COUNTER_OFFER_CREATED', value: negotiation.CounterOffer },
      { action: 'AGREED_PRICE_SET', value: negotiation.AgreedPrice ?? negotiation.FinalOffer }
    ];

    let previousOfferForCreate = null;
    for (const stage of offerStages) {
      if (stage.value === null || stage.value === undefined) continue;
      if (previousOfferForCreate === null) {
        previousOfferForCreate = stage.value;
        continue;
      }
      if (stage.value === previousOfferForCreate) continue;

      this.appendNegotiationHistory(db, negotiation, {
        Action: stage.action,
        PreviousStatus: status,
        NewStatus: status,
        PreviousOffer: previousOfferForCreate,
        NewOffer: stage.value,
        User: negotiation.CreatedBy,
        Notes: negotiation.Notes,
        Timestamp: now
      });

      previousOfferForCreate = stage.value;
    }

    db.Negotiations.push(negotiation);
    this.write(db);
    this.addTimelineEntry(leadId, 'Negotiation', negotiation.NegotiationID, 'NEGOTIATION_STARTED', 'Negotiation started', negotiation);
    return { ok: true, data: negotiation };
  }

  updateNegotiation(negotiationId, changes = {}) {
    const db = this.read();
    db.Negotiations = db.Negotiations || [];
    db.NegotiationHistory = db.NegotiationHistory || [];
    const index = db.Negotiations.findIndex((row) => row.NegotiationID === negotiationId);
    if (index === -1) return { ok: false, error: 'Negotiation not found' };

    const existing = db.Negotiations[index];
    const now = new Date().toISOString();
    const next = { ...existing };

    const fields = [
      ['AskingPrice', 'askingPrice'],
      ['InitialOffer', 'initialOffer'],
      ['CurrentOffer', 'currentOffer'],
      ['CounterOffer', 'counterOffer'],
      ['FinalOffer', 'finalOffer'],
      ['AgreedPrice', 'agreedPrice'],
      ['TokenAmount', 'tokenAmount'],
      ['BrokeragePercent', 'brokeragePercent'],
      ['BrokerageAmount', 'brokerageAmount'],
      ['Brokerage', 'brokerage']
    ];

    for (const [field, alt] of fields) {
      const incoming = changes[field] ?? changes[alt];
      if (incoming !== undefined) {
        const check = this.validateNonNegativeMoney(field, incoming);
        if (!check.ok) return { ok: false, error: check.error };
        if (field === 'Brokerage') {
          next.BrokerageAmount = check.value;
        } else {
          next[field] = check.value;
        }
      }
    }

    const plainFields = [
      ['TransactionID', 'transactionId'],
      ['MatchID', 'matchId'],
      ['ShortlistID', 'shortlistId'],
      ['SiteVisitID', 'siteVisitId'],
      ['BrokerageType', 'brokerageType'],
      ['BrokeragePayer', 'brokeragePayer'],
      ['PaymentTerms', 'paymentTerms'],
      ['PossessionDate', 'possessionDate'],
      ['AgreementDate', 'agreementDate'],
      ['RegistrationDate', 'registrationDate'],
      ['SpecialTerms', 'specialTerms'],
      ['Notes', 'notes'],
      ['TokenDate', 'tokenDate'],
      ['AssignedAgentID', 'assignedAgentId'],
      ['UpdatedBy', 'updatedBy']
    ];

    for (const [field, alt] of plainFields) {
      const incoming = changes[field] ?? changes[alt];
      if (incoming !== undefined) {
        next[field] = field === 'BrokerageType' && incoming
          ? String(incoming).toUpperCase()
          : incoming;
      }
    }

    const incomingStatus = changes.Status !== undefined || changes.status !== undefined
      ? this.normalizeNegotiationStatus(changes.Status || changes.status)
      : existing.Status;

    if (!this.isValidNegotiationStatus(incomingStatus)) {
      return { ok: false, error: 'Invalid negotiation status' };
    }

    if (!this.canTransitionNegotiation(existing.Status, incomingStatus)) {
      return { ok: false, error: `Status transition from ${existing.Status} to ${incomingStatus} is not allowed` };
    }

    if (incomingStatus !== existing.Status && this.isNegotiationTerminalStatus(incomingStatus)) {
      next.ClosedAt = now;
    }

    next.Status = incomingStatus;
    next.UpdatedAt = now;
    next.UpdatedBy = next.UpdatedBy || 'system';
    this.recalculateBrokerage(next);

    if ((next.AgreedPrice !== null && next.AgreedPrice !== undefined) && (next.FinalOffer === null || next.FinalOffer === undefined)) {
      next.FinalOffer = next.AgreedPrice;
    }

    const previousOffer = existing.CurrentOffer ?? existing.CounterOffer ?? existing.FinalOffer ?? existing.AgreedPrice ?? existing.InitialOffer ?? null;
    const newOffer = next.CurrentOffer ?? next.CounterOffer ?? next.FinalOffer ?? next.AgreedPrice ?? next.InitialOffer ?? null;

    if (previousOffer !== newOffer) {
      this.appendNegotiationHistory(db, next, {
        Action: 'OFFER_UPDATED',
        PreviousStatus: existing.Status,
        NewStatus: incomingStatus,
        PreviousOffer: previousOffer,
        NewOffer: newOffer,
        User: next.UpdatedBy,
        Notes: next.Notes,
        Timestamp: now
      });
    }

    if (incomingStatus !== existing.Status) {
      this.appendNegotiationHistory(db, next, {
        Action: 'STATUS_CHANGED',
        PreviousStatus: existing.Status,
        NewStatus: incomingStatus,
        PreviousOffer: previousOffer,
        NewOffer: newOffer,
        User: next.UpdatedBy,
        Notes: next.Notes,
        Timestamp: now
      });
    }

    db.Negotiations[index] = next;
    this.write(db);
    this.addTimelineEntry(next.LeadID, 'Negotiation', next.NegotiationID, incomingStatus === existing.Status ? 'NEGOTIATION_UPDATED' : 'NEGOTIATION_STATUS_CHANGED', `Negotiation ${incomingStatus}`, next);
    return { ok: true, data: next };
  }

  makeNegotiationOffer(negotiationId, payload = {}) {
    const offer = payload.CurrentOffer ?? payload.currentOffer ?? payload.InitialOffer ?? payload.initialOffer;
    const validation = this.validateNonNegativeMoney('CurrentOffer', offer, { required: true });
    if (!validation.ok) return { ok: false, error: validation.error };
    return this.updateNegotiation(negotiationId, {
      CurrentOffer: validation.value,
      InitialOffer: payload.InitialOffer ?? payload.initialOffer ?? validation.value,
      Status: 'OFFER_MADE',
      UpdatedBy: payload.updatedBy || payload.UpdatedBy || 'system',
      Notes: payload.notes ?? payload.Notes
    });
  }

  makeNegotiationCounterOffer(negotiationId, payload = {}) {
    const offer = payload.CounterOffer ?? payload.counterOffer;
    const validation = this.validateNonNegativeMoney('CounterOffer', offer, { required: true });
    if (!validation.ok) return { ok: false, error: validation.error };
    return this.updateNegotiation(negotiationId, {
      CounterOffer: validation.value,
      CurrentOffer: validation.value,
      Status: 'COUNTER_OFFER',
      UpdatedBy: payload.updatedBy || payload.UpdatedBy || 'system',
      Notes: payload.notes ?? payload.Notes
    });
  }

  acceptNegotiationOffer(negotiationId, payload = {}) {
    const agreedPrice = payload.AgreedPrice ?? payload.agreedPrice ?? payload.FinalOffer ?? payload.finalOffer;
    const validation = this.validateNonNegativeMoney('AgreedPrice', agreedPrice, { required: false });
    if (!validation.ok) return { ok: false, error: validation.error };
    return this.updateNegotiation(negotiationId, {
      AgreedPrice: validation.value,
      FinalOffer: validation.value,
      Status: 'AGREED',
      UpdatedBy: payload.updatedBy || payload.UpdatedBy || 'system',
      Notes: payload.notes ?? payload.Notes
    });
  }

  rejectNegotiationOffer(negotiationId, payload = {}) {
    return this.updateNegotiation(negotiationId, {
      Status: 'FAILED',
      UpdatedBy: payload.updatedBy || payload.UpdatedBy || 'system',
      Notes: payload.notes ?? payload.Notes ?? 'Offer rejected'
    });
  }

  holdNegotiation(negotiationId, payload = {}) {
    return this.updateNegotiation(negotiationId, {
      Status: 'ON_HOLD',
      UpdatedBy: payload.updatedBy || payload.UpdatedBy || 'system',
      Notes: payload.notes ?? payload.Notes
    });
  }

  resumeNegotiation(negotiationId, payload = {}) {
    const db = this.read();
    db.Negotiations = db.Negotiations || [];
    const row = db.Negotiations.find((item) => item.NegotiationID === negotiationId);
    if (!row) return { ok: false, error: 'Negotiation not found' };
    if (this.normalizeNegotiationStatus(row.Status) !== 'ON_HOLD') {
      return { ok: false, error: 'Only ON_HOLD negotiations can be resumed' };
    }

    const targetStatus = this.normalizeNegotiationStatus(payload.resumeTo || payload.ResumeTo || 'NEGOTIATING');
    return this.updateNegotiation(negotiationId, {
      Status: targetStatus,
      UpdatedBy: payload.updatedBy || payload.UpdatedBy || 'system',
      Notes: payload.notes ?? payload.Notes
    });
  }

  markNegotiationAgreed(negotiationId, payload = {}) {
    return this.acceptNegotiationOffer(negotiationId, payload);
  }

  recordNegotiationToken(negotiationId, payload = {}) {
    const tokenAmountCheck = this.validateNonNegativeMoney('TokenAmount', payload.TokenAmount ?? payload.tokenAmount, { required: true });
    if (!tokenAmountCheck.ok) return { ok: false, error: tokenAmountCheck.error };
    return this.updateNegotiation(negotiationId, {
      TokenAmount: tokenAmountCheck.value,
      TokenDate: payload.TokenDate || payload.tokenDate || new Date().toISOString(),
      PaymentTerms: payload.PaymentTerms || payload.paymentTerms || null,
      Status: 'TOKEN_RECEIVED',
      UpdatedBy: payload.updatedBy || payload.UpdatedBy || 'system',
      Notes: payload.notes ?? payload.Notes
    });
  }

  markNegotiationAgreement(negotiationId, payload = {}) {
    return this.updateNegotiation(negotiationId, {
      AgreementDate: payload.AgreementDate || payload.agreementDate || new Date().toISOString(),
      Status: 'AGREEMENT_DONE',
      UpdatedBy: payload.updatedBy || payload.UpdatedBy || 'system',
      Notes: payload.notes ?? payload.Notes
    });
  }

  markNegotiationRegistration(negotiationId, payload = {}) {
    return this.updateNegotiation(negotiationId, {
      RegistrationDate: payload.RegistrationDate || payload.registrationDate || new Date().toISOString(),
      Status: 'REGISTRATION_PENDING',
      UpdatedBy: payload.updatedBy || payload.UpdatedBy || 'system',
      Notes: payload.notes ?? payload.Notes
    });
  }

  completeNegotiation(negotiationId, payload = {}) {
    return this.updateNegotiation(negotiationId, {
      ClosedAt: payload.ClosedAt || payload.closedAt || new Date().toISOString(),
      Status: 'COMPLETED',
      UpdatedBy: payload.updatedBy || payload.UpdatedBy || 'system',
      Notes: payload.notes ?? payload.Notes
    });
  }

  cancelNegotiation(negotiationId, payload = {}) {
    return this.updateNegotiation(negotiationId, {
      ClosedAt: payload.ClosedAt || payload.closedAt || new Date().toISOString(),
      Status: 'CANCELLED',
      UpdatedBy: payload.updatedBy || payload.UpdatedBy || 'system',
      Notes: payload.notes ?? payload.Notes ?? 'Cancelled'
    });
  }

  getNegotiationHistory(negotiationId) {
    const negotiation = this.getNegotiation(negotiationId);
    if (!negotiation) return { ok: false, error: 'Negotiation not found' };
    return { ok: true, data: this.listNegotiationHistory(negotiationId) };
  }

  listTokens(filters = {}) {
    const db = this.read();
    db.Tokens = db.Tokens || [];
    return db.Tokens.filter((row) => {
      if (filters.LeadID && row.LeadID !== filters.LeadID) return false;
      if (filters.RequirementID && row.RequirementID !== filters.RequirementID) return false;
      if (filters.PropertyID && row.PropertyID !== filters.PropertyID) return false;
      if (filters.Status && row.Status !== filters.Status) return false;
      return true;
    }).sort((a, b) => new Date(b.TokenDate || b.CreatedAt).getTime() - new Date(a.TokenDate || a.CreatedAt).getTime());
  }

  getToken(tokenId) {
    const db = this.read();
    db.Tokens = db.Tokens || [];
    return db.Tokens.find((row) => row.TokenID === tokenId) || null;
  }

  createToken(payload = {}) {
    const db = this.read();
    db.Tokens = db.Tokens || [];
    const leadId = payload.LeadID || payload.leadId;
    const requirementId = payload.RequirementID || payload.requirementId;
    const propertyId = payload.PropertyID || payload.propertyId;
    const negotiationId = payload.NegotiationID || payload.negotiationId;
    if (!leadId || !requirementId || !propertyId || !negotiationId) {
      return { ok: false, error: 'Missing required token fields' };
    }

    if (db.Tokens.some((row) => row.LeadID === leadId && row.RequirementID === requirementId && row.PropertyID === propertyId && ['PENDING', 'PARTIAL', 'PAID'].includes(row.Status))) {
      return { ok: false, error: 'Duplicate active token already exists for this requirement and property' };
    }

    const status = payload.Status || payload.status || 'PENDING';
    if (!this.isValidTokenStatus(status)) return { ok: false, error: 'Invalid token status' };

    const token = {
      TokenID: payload.TokenID || this.createId('TOK'),
      NegotiationID: negotiationId,
      LeadID: leadId,
      RequirementID: requirementId,
      PropertyID: propertyId,
      SiteVisitID: payload.SiteVisitID || payload.siteVisitId || null,
      TokenAmount: payload.TokenAmount ?? payload.tokenAmount ?? 0,
      PaidAmount: payload.PaidAmount ?? payload.paidAmount ?? 0,
      PendingAmount: payload.PendingAmount ?? payload.pendingAmount ?? (payload.TokenAmount ?? payload.tokenAmount ?? 0),
      PaymentMode: payload.PaymentMode || payload.paymentMode || 'UPI',
      Reference: payload.Reference || payload.reference || '',
      TokenDate: payload.TokenDate || payload.tokenDate || new Date().toISOString(),
      Notes: payload.Notes || payload.notes || '',
      Status: status,
      CreatedAt: payload.CreatedAt || payload.createdAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || new Date().toISOString()
    };

    db.Tokens.push(token);
    this.write(db);
    this.addTimelineEntry(leadId, 'Token', token.TokenID, 'TOKEN_CREATED', 'Token created', token);
    return { ok: true, data: token };
  }

  listDeals(filters = {}) {
    const db = this.read();
    db.Deals = db.Deals || [];
    return db.Deals.filter((row) => {
      if (filters.LeadID && row.LeadID !== filters.LeadID) return false;
      if (filters.RequirementID && row.RequirementID !== filters.RequirementID) return false;
      if (filters.PropertyID && row.PropertyID !== filters.PropertyID) return false;
      if (filters.Status && row.Status !== filters.Status) return false;
      return true;
    }).sort((a, b) => new Date(b.CreatedAt || b.AgreementDate).getTime() - new Date(a.CreatedAt || a.AgreementDate).getTime());
  }

  getDeal(dealId) {
    const db = this.read();
    db.Deals = db.Deals || [];
    return db.Deals.find((row) => row.DealID === dealId) || null;
  }

  createDeal(payload = {}) {
    const db = this.read();
    db.Deals = db.Deals || [];
    const leadId = payload.LeadID || payload.leadId;
    const requirementId = payload.RequirementID || payload.requirementId;
    const propertyId = payload.PropertyID || payload.propertyId;
    const negotiationId = payload.NegotiationID || payload.negotiationId;
    const tokenId = payload.TokenID || payload.tokenId;

    if (!leadId || !requirementId || !propertyId || !negotiationId || !tokenId) {
      return { ok: false, error: 'Missing required deal fields' };
    }

    const deal = {
      DealID: payload.DealID || this.createId('DEAL'),
      LeadID: leadId,
      RequirementID: requirementId,
      PropertyID: propertyId,
      MatchID: payload.MatchID || payload.matchId || null,
      ShortlistID: payload.ShortlistID || payload.shortlistId || null,
      SiteVisitID: payload.SiteVisitID || payload.siteVisitId || null,
      NegotiationID: negotiationId,
      TokenID: tokenId,
      FinalPrice: payload.FinalPrice ?? payload.finalPrice ?? 0,
      Brokerage: payload.Brokerage ?? payload.brokerage ?? 0,
      Buyer: payload.Buyer || payload.buyer || leadId,
      Seller: payload.Seller || payload.seller || '',
      AgreementDate: payload.AgreementDate || payload.agreementDate || null,
      RegistrationDate: payload.RegistrationDate || payload.registrationDate || null,
      PossessionDate: payload.PossessionDate || payload.possessionDate || null,
      ClosingDate: payload.ClosingDate || payload.closingDate || null,
      Status: payload.Status || payload.status || 'OPEN',
      Notes: payload.Notes || payload.notes || '',
      CreatedAt: payload.CreatedAt || payload.createdAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || new Date().toISOString()
    };

    db.Deals.push(deal);
    this.write(db);
    this.addTimelineEntry(leadId, 'Deal', deal.DealID, 'DEAL_CREATED', 'Deal created', deal);
    return { ok: true, data: deal };
  }

  listPayments(filters = {}) {
    const db = this.read();
    db.Payments = db.Payments || [];
    return db.Payments.filter((row) => {
      const dealId = filters.DealID || filters.dealId;
      const tokenId = filters.TokenID || filters.tokenId;
      const commissionId = filters.CommissionID || filters.commissionId;
      if (dealId && row.DealID !== dealId) return false;
      if (tokenId && row.TokenID !== tokenId) return false;
      if (commissionId && row.CommissionID !== commissionId) return false;
      return true;
    }).sort((a, b) => new Date(b.PaymentDate || b.CreatedAt).getTime() - new Date(a.PaymentDate || a.CreatedAt).getTime());
  }

  createPayment(payload = {}) {
    const db = this.read();
    db.Payments = db.Payments || [];
    const payment = {
      PaymentID: payload.PaymentID || this.createId('PAY'),
      DealID: payload.DealID || payload.dealId || null,
      TokenID: payload.TokenID || payload.tokenId || null,
      CommissionID: payload.CommissionID || payload.commissionId || null,
      Amount: payload.Amount ?? payload.amount ?? 0,
      PaymentType: payload.PaymentType || payload.paymentType || 'Booking',
      PaymentMode: payload.PaymentMode || payload.paymentMode || 'UPI',
      Reference: payload.Reference || payload.reference || '',
      PaymentDate: payload.PaymentDate || payload.paymentDate || new Date().toISOString(),
      Status: payload.Status || payload.status || 'PAID',
      Notes: payload.Notes || payload.notes || '',
      CreatedAt: payload.CreatedAt || payload.createdAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || new Date().toISOString()
    };
    db.Payments.push(payment);
    this.write(db);
    this.addTimelineEntry((db.Leads || []).find((lead) => (lead.LeadID === (db.Deals || []).find((deal) => deal.DealID === payment.DealID)?.LeadID))?.LeadID || null, 'Payment', payment.PaymentID, 'PAYMENT_RECEIVED', 'Payment received', payment);
    return { ok: true, data: payment };
  }

  listCommissions(filters = {}) {
    const db = this.read();
    db.Commission = db.Commission || [];
    return db.Commission.filter((row) => {
      const dealId = filters.DealID || filters.dealId;
      const leadId = filters.LeadID || filters.leadId;
      const status = filters.Status || filters.status;
      const agentId = filters.AgentID || filters.agentId;
      const brokerId = filters.BrokerID || filters.brokerId;
      if (dealId && row.DealID !== dealId) return false;
      if (leadId && row.LeadID !== leadId) return false;
      if (status && row.Status !== status) return false;
      if (agentId && row.AgentID !== agentId) return false;
      if (brokerId && row.BrokerID !== brokerId) return false;
      return true;
    }).sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());
  }

  getCommission(commissionId) {
    const db = this.read();
    db.Commission = db.Commission || [];
    return db.Commission.find((row) => row.CommissionID === commissionId) || null;
  }

  toPercent(value) {
    if (value === undefined || value === null || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return NaN;
    return Math.round(numeric * 10000) / 10000;
  }

  validatePercent(label, value, { required = false } = {}) {
    const percent = this.toPercent(value);
    if (percent === null) {
      if (required) return { ok: false, error: `${label} is required` };
      return { ok: true, value: null };
    }
    if (Number.isNaN(percent)) return { ok: false, error: `${label} must be a valid number` };
    if (percent < 0) return { ok: false, error: `${label} cannot be negative` };
    if (percent > 100) return { ok: false, error: `${label} cannot exceed 100` };
    return { ok: true, value: percent };
  }

  getCommissionStatusTransitions() {
    return {
      PENDING: ['PARTIAL', 'RECEIVED', 'OVERDUE', 'CANCELLED'],
      PARTIAL: ['PARTIAL', 'RECEIVED', 'OVERDUE', 'CANCELLED'],
      OVERDUE: ['PARTIAL', 'RECEIVED', 'CANCELLED'],
      RECEIVED: [],
      CANCELLED: []
    };
  }

  canTransitionCommissionStatus(fromStatus, toStatus) {
    if (fromStatus === toStatus) return true;
    const allowed = this.getCommissionStatusTransitions()[fromStatus] || [];
    return allowed.includes(toStatus);
  }

  resolveCommissionContext(db, payload = {}) {
    const dealId = payload.DealID || payload.dealId;
    if (!dealId) return { ok: false, error: 'DealID is required' };

    const deal = (db.Deals || []).find((row) => row.DealID === dealId);
    if (!deal) return { ok: false, error: 'Deal not found' };

    const leadId = payload.LeadID || payload.leadId || deal.LeadID;
    const requirementId = payload.RequirementID || payload.requirementId || deal.RequirementID;
    const propertyId = payload.PropertyID || payload.propertyId || deal.PropertyID;
    const negotiationId = payload.NegotiationID || payload.negotiationId || deal.NegotiationID || null;
    const tokenId = payload.TokenID || payload.tokenId || deal.TokenID || null;

    const requirement = requirementId ? (db.Requirements || []).find((row) => row.RequirementID === requirementId) : null;
    const transactionId = payload.TransactionID || payload.transactionId || deal.TransactionID || requirement?.TransactionID || null;
    const negotiation = negotiationId ? (db.Negotiations || []).find((row) => row.NegotiationID === negotiationId) : null;
    const token = tokenId ? (db.Tokens || []).find((row) => row.TokenID === tokenId) : null;

    if (!leadId || !(db.Leads || []).some((row) => row.LeadID === leadId)) {
      return { ok: false, error: 'Lead relationship is invalid' };
    }
    if (!requirementId || !requirement) {
      return { ok: false, error: 'Requirement relationship is invalid' };
    }
    if (!propertyId || !(db.Inventory || []).some((row) => row.PropertyID === propertyId)) {
      return { ok: false, error: 'Property relationship is invalid' };
    }
    if (tokenId && !token) {
      return { ok: false, error: 'Token relationship is invalid' };
    }
    if (negotiationId && !negotiation) {
      return { ok: false, error: 'Negotiation relationship is invalid' };
    }

    return {
      ok: true,
      context: {
        deal,
        leadId,
        requirementId,
        propertyId,
        tokenId,
        negotiationId,
        transactionId,
        agentId: payload.AgentID || payload.agentId || deal.AssignedAgentID || negotiation?.AssignedAgentID || 'USR-0001',
        brokerId: payload.BrokerID || payload.brokerId || null,
        referralId: payload.ReferralID || payload.referralId || null
      }
    };
  }

  calculateCommission(payload = {}, existing = null) {
    const commissionType = String(payload.CommissionType || payload.commissionType || existing?.CommissionType || 'PERCENTAGE').toUpperCase();
    const commissionBasis = String(payload.CommissionBasis || payload.commissionBasis || existing?.CommissionBasis || 'DEAL_VALUE').toUpperCase();
    const baseAmountCheck = this.validateNonNegativeMoney('BaseAmount', payload.BaseAmount ?? payload.baseAmount ?? existing?.BaseAmount ?? payload.FinalPrice ?? payload.finalPrice, { required: commissionType === 'PERCENTAGE' });
    if (!baseAmountCheck.ok) return { ok: false, error: baseAmountCheck.error };

    const rateCheck = this.validatePercent('CommissionRate', payload.CommissionRate ?? payload.commissionRate ?? payload.CommissionPercent ?? payload.commissionPercent ?? existing?.CommissionRate, { required: commissionType === 'PERCENTAGE' });
    if (!rateCheck.ok) return { ok: false, error: rateCheck.error };

    const fixedCheck = this.validateNonNegativeMoney('FixedCommission', payload.FixedCommission ?? payload.fixedCommission ?? existing?.FixedCommission, { required: commissionType === 'FIXED' });
    if (!fixedCheck.ok) return { ok: false, error: fixedCheck.error };

    let grossAmount;
    if (commissionType === 'FIXED') {
      grossAmount = fixedCheck.value;
    } else {
      grossAmount = this.toMoney((baseAmountCheck.value * rateCheck.value) / 100);
    }

    const explicitAmountCheck = this.validateNonNegativeMoney('CommissionAmount', payload.CommissionAmount ?? payload.commissionAmount ?? existing?.CommissionAmount);
    if (!explicitAmountCheck.ok) return { ok: false, error: explicitAmountCheck.error };
    if (explicitAmountCheck.value !== null) {
      grossAmount = explicitAmountCheck.value;
    }

    const agentShareRateCheck = this.validatePercent('AgentSharePercent', payload.AgentSharePercent ?? payload.agentSharePercent ?? existing?.AgentSharePercent);
    if (!agentShareRateCheck.ok) return { ok: false, error: agentShareRateCheck.error };
    const referralShareRateCheck = this.validatePercent('ReferralSharePercent', payload.ReferralSharePercent ?? payload.referralSharePercent ?? existing?.ReferralSharePercent);
    if (!referralShareRateCheck.ok) return { ok: false, error: referralShareRateCheck.error };
    const companyShareRateCheck = this.validatePercent('CompanySharePercent', payload.CompanySharePercent ?? payload.companySharePercent ?? existing?.CompanySharePercent);
    if (!companyShareRateCheck.ok) return { ok: false, error: companyShareRateCheck.error };

    const shareTotal = (agentShareRateCheck.value || 0) + (referralShareRateCheck.value || 0) + (companyShareRateCheck.value || 0);
    if (shareTotal > 100) return { ok: false, error: 'AgentSharePercent + ReferralSharePercent + CompanySharePercent cannot exceed 100' };

    const agentShareAmount = this.toMoney((grossAmount * (agentShareRateCheck.value || 0)) / 100);
    const referralShareAmount = this.toMoney((grossAmount * (referralShareRateCheck.value || 0)) / 100);
    const companyShareAmount = this.toMoney((grossAmount * (companyShareRateCheck.value || 0)) / 100);

    const gstAmountCheck = this.validateNonNegativeMoney('GSTAmount', payload.GSTAmount ?? payload.gstAmount ?? existing?.GSTAmount);
    if (!gstAmountCheck.ok) return { ok: false, error: gstAmountCheck.error };
    const tdsAmountCheck = this.validateNonNegativeMoney('TDSAmount', payload.TDSAmount ?? payload.tdsAmount ?? existing?.TDSAmount);
    if (!tdsAmountCheck.ok) return { ok: false, error: tdsAmountCheck.error };
    const otherDeductionCheck = this.validateNonNegativeMoney('OtherDeductions', payload.OtherDeductions ?? payload.otherDeductions ?? existing?.OtherDeductions);
    if (!otherDeductionCheck.ok) return { ok: false, error: otherDeductionCheck.error };

    const gstRateCheck = this.validatePercent('GSTRate', payload.GSTRate ?? payload.gstRate ?? existing?.GSTRate);
    if (!gstRateCheck.ok) return { ok: false, error: gstRateCheck.error };
    const tdsRateCheck = this.validatePercent('TDSRate', payload.TDSRate ?? payload.tdsRate ?? existing?.TDSRate);
    if (!tdsRateCheck.ok) return { ok: false, error: tdsRateCheck.error };

    const gstAmount = gstAmountCheck.value ?? this.toMoney((grossAmount * (gstRateCheck.value || 0)) / 100) ?? 0;
    const tdsAmount = tdsAmountCheck.value ?? this.toMoney((grossAmount * (tdsRateCheck.value || 0)) / 100) ?? 0;
    const otherDeductions = otherDeductionCheck.value || 0;

    const deductionsTotal = this.toMoney(gstAmount + tdsAmount + otherDeductions);
    const netPayable = this.toMoney(grossAmount - deductionsTotal);
    if (netPayable < 0) return { ok: false, error: 'NetPayable cannot be negative' };

    return {
      ok: true,
      data: {
        CommissionType: commissionType,
        CommissionBasis: commissionBasis,
        CommissionRate: rateCheck.value,
        FixedCommission: fixedCheck.value,
        BaseAmount: baseAmountCheck.value,
        CommissionAmount: grossAmount,
        GrossCommission: grossAmount,
        BrokerageSide: payload.BrokerageSide || payload.brokerageSide || existing?.BrokerageSide || 'BOTH',
        BuyerSide: this.validateNonNegativeMoney('BuyerSide', payload.BuyerSide ?? payload.buyerSide ?? existing?.BuyerSide).value || 0,
        SellerSide: this.validateNonNegativeMoney('SellerSide', payload.SellerSide ?? payload.sellerSide ?? existing?.SellerSide).value || 0,
        RentLeaseBrokerage: this.validateNonNegativeMoney('RentLeaseBrokerage', payload.RentLeaseBrokerage ?? payload.rentLeaseBrokerage ?? existing?.RentLeaseBrokerage).value || 0,
        AgentSharePercent: agentShareRateCheck.value || 0,
        CompanySharePercent: companyShareRateCheck.value || 0,
        ReferralSharePercent: referralShareRateCheck.value || 0,
        AgentShareAmount: agentShareAmount,
        CompanyShareAmount: companyShareAmount,
        ReferralShareAmount: referralShareAmount,
        GSTRate: gstRateCheck.value || 0,
        GSTAmount: gstAmount,
        TDSRate: tdsRateCheck.value || 0,
        TDSAmount: tdsAmount,
        OtherDeductions: otherDeductions,
        DeductionsTotal: deductionsTotal,
        NetPayable: netPayable
      }
    };
  }

  appendCommissionLedger(db, commission, entry = {}) {
    db.CommissionLedger = db.CommissionLedger || [];
    const item = {
      LedgerID: this.createId('LED'),
      CommissionID: commission.CommissionID,
      DealID: commission.DealID,
      TokenID: commission.TokenID || null,
      NegotiationID: commission.NegotiationID || null,
      TransactionID: commission.TransactionID || null,
      LeadID: commission.LeadID,
      PropertyID: commission.PropertyID,
      EntryType: entry.EntryType || 'COMMISSION_UPDATED',
      EntryDate: entry.EntryDate || new Date().toISOString(),
      EntryValue: this.toMoney(entry.EntryValue ?? commission.PendingAmount ?? 0),
      Status: entry.Status || commission.Status,
      Notes: entry.Notes || '',
      PaymentID: entry.PaymentID || null,
      Payload: entry.Payload || null
    };
    db.CommissionLedger.push(item);
    return item;
  }

  listCommissionHistory(commissionId) {
    const db = this.read();
    db.CommissionLedger = db.CommissionLedger || [];
    return db.CommissionLedger
      .filter((row) => row.CommissionID === commissionId)
      .sort((a, b) => new Date(a.EntryDate).getTime() - new Date(b.EntryDate).getTime());
  }

  listCommissionPayments(commissionId) {
    return this.listPayments({ CommissionID: commissionId });
  }

  deriveCommissionStatus(commission) {
    if (commission.Status === 'CANCELLED') return 'CANCELLED';
    const pending = this.toMoney(commission.PendingAmount ?? 0) || 0;
    const received = this.toMoney(commission.ReceivedAmount ?? 0) || 0;

    if (pending <= 0) return 'RECEIVED';
    if (received > 0 && pending > 0) return 'PARTIAL';

    if (commission.DueDate) {
      const dueDate = new Date(commission.DueDate).getTime();
      if (Number.isFinite(dueDate) && dueDate < Date.now()) return 'OVERDUE';
    }

    return 'PENDING';
  }

  createCommission(payload = {}) {
    const db = this.read();
    db.Commission = db.Commission || [];

    const contextCheck = this.resolveCommissionContext(db, payload);
    if (!contextCheck.ok) return { ok: false, error: contextCheck.error };
    const context = contextCheck.context;

    if (db.Commission.some((row) => row.DealID === context.deal.DealID && row.Status !== 'CANCELLED')) {
      return { ok: false, error: 'Active commission already exists for this deal' };
    }

    const calc = this.calculateCommission({ ...payload, FinalPrice: context.deal.FinalPrice });
    if (!calc.ok) return calc;

    const receivedCheck = this.validateNonNegativeMoney('ReceivedAmount', payload.ReceivedAmount ?? payload.receivedAmount ?? payload.Received ?? payload.received);
    if (!receivedCheck.ok) return { ok: false, error: receivedCheck.error };
    const gross = calc.data.GrossCommission;
    const receivedAmount = receivedCheck.value || 0;
    if (receivedAmount > gross) {
      return { ok: false, error: 'ReceivedAmount cannot exceed gross commission' };
    }

    const pendingAmount = this.toMoney(gross - receivedAmount);
    const now = new Date().toISOString();

    const commission = {
      CommissionID: payload.CommissionID || this.createId('COM'),
      DealID: context.deal.DealID,
      TokenID: context.tokenId,
      NegotiationID: context.negotiationId,
      TransactionID: context.transactionId,
      LeadID: context.leadId,
      RequirementID: context.requirementId,
      PropertyID: context.propertyId,
      AgentID: context.agentId,
      BrokerID: context.brokerId,
      ReferralID: context.referralId,
      DueDate: payload.DueDate || payload.dueDate || null,
      ReceivedDate: payload.ReceivedDate || payload.receivedDate || null,
      PaymentReference: payload.PaymentReference || payload.paymentReference || '',
      Notes: payload.Notes || payload.notes || '',
      ...calc.data,
      GrossBrokerage: calc.data.GrossCommission,
      ReceivedAmount: receivedAmount,
      PendingAmount: pendingAmount,
      Received: receivedAmount,
      Pending: pendingAmount,
      Status: 'PENDING',
      CreatedAt: payload.CreatedAt || payload.createdAt || now,
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || now
    };

    const manualStatus = payload.Status || payload.status;
    if (manualStatus) {
      const normalizedStatus = String(manualStatus).toUpperCase();
      if (!Object.keys(this.getCommissionStatusTransitions()).includes(normalizedStatus)) {
        return { ok: false, error: 'Invalid commission status' };
      }
      commission.Status = normalizedStatus;
    } else {
      commission.Status = this.deriveCommissionStatus(commission);
    }

    db.Commission.push(commission);
    this.appendCommissionLedger(db, commission, {
      EntryType: 'COMMISSION_CREATED',
      EntryValue: commission.GrossCommission,
      Status: commission.Status,
      Notes: commission.Notes,
      Payload: { commissionSnapshot: commission }
    });
    this.write(db);
    this.addTimelineEntry(commission.LeadID, 'Commission', commission.CommissionID, 'COMMISSION_CREATED', 'Commission generated', commission);
    return { ok: true, data: commission };
  }

  updateCommissionStatus(commissionId, payload = {}) {
    const db = this.read();
    db.Commission = db.Commission || [];
    const index = db.Commission.findIndex((row) => row.CommissionID === commissionId);
    if (index === -1) return { ok: false, error: 'Commission not found' };

    const current = db.Commission[index];
    const nextStatus = String(payload.Status || payload.status || '').toUpperCase();
    if (!nextStatus || !Object.keys(this.getCommissionStatusTransitions()).includes(nextStatus)) {
      return { ok: false, error: 'Invalid commission status' };
    }

    if (!this.canTransitionCommissionStatus(current.Status, nextStatus)) {
      return { ok: false, error: `Status transition from ${current.Status} to ${nextStatus} is not allowed` };
    }

    const next = {
      ...current,
      Status: nextStatus,
      UpdatedAt: new Date().toISOString(),
      Notes: payload.Notes ?? payload.notes ?? current.Notes
    };
    if (nextStatus === 'RECEIVED' && !next.ReceivedDate) {
      next.ReceivedDate = new Date().toISOString();
    }

    db.Commission[index] = next;
    this.appendCommissionLedger(db, next, {
      EntryType: 'COMMISSION_STATUS_CHANGED',
      EntryValue: next.PendingAmount,
      Status: next.Status,
      Notes: payload.Notes || payload.notes || ''
    });
    this.write(db);
    this.addTimelineEntry(next.LeadID, 'Commission', next.CommissionID, 'COMMISSION_STATUS_CHANGED', `Commission ${next.Status}`, next);
    return { ok: true, data: next };
  }

  recordCommissionPayment(commissionId, payload = {}) {
    const db = this.read();
    db.Commission = db.Commission || [];
    db.Payments = db.Payments || [];

    const index = db.Commission.findIndex((row) => row.CommissionID === commissionId);
    if (index === -1) return { ok: false, error: 'Commission not found' };

    const commission = db.Commission[index];
    if (commission.Status === 'CANCELLED' || commission.Status === 'RECEIVED') {
      return { ok: false, error: `Cannot record payment for commission in ${commission.Status} status` };
    }

    const amountCheck = this.validateNonNegativeMoney('Amount', payload.Amount ?? payload.amount, { required: true });
    if (!amountCheck.ok) return { ok: false, error: amountCheck.error };
    if (amountCheck.value <= 0) return { ok: false, error: 'Amount must be greater than zero' };

    const pendingAmount = this.toMoney(commission.PendingAmount || 0);
    if (amountCheck.value > pendingAmount) {
      return { ok: false, error: 'Payment amount cannot exceed pending balance' };
    }

    const requestedPaymentId = payload.PaymentID || payload.paymentId;
    if (requestedPaymentId && db.Payments.some((row) => row.PaymentID === requestedPaymentId)) {
      return { ok: false, error: 'Duplicate payment ID already exists' };
    }

    const mode = String(payload.PaymentMode || payload.paymentMode || 'OTHER').toUpperCase();
    const allowedModes = ['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER'];
    if (!allowedModes.includes(mode)) {
      return { ok: false, error: 'Invalid payment mode' };
    }

    const payment = {
      PaymentID: requestedPaymentId || this.createId('PAY'),
      DealID: commission.DealID,
      TokenID: commission.TokenID || null,
      CommissionID: commission.CommissionID,
      NegotiationID: commission.NegotiationID || null,
      Amount: amountCheck.value,
      PaymentType: 'COMMISSION',
      PaymentMode: mode,
      Reference: payload.Reference || payload.reference || payload.ReferenceNumber || payload.referenceNumber || '',
      ReferenceNumber: payload.ReferenceNumber || payload.referenceNumber || payload.Reference || payload.reference || '',
      ReceivedBy: payload.ReceivedBy || payload.receivedBy || 'system',
      Notes: payload.Notes || payload.notes || '',
      PaymentDate: payload.PaymentDate || payload.paymentDate || new Date().toISOString(),
      Status: 'PAID',
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    };

    const nextReceived = this.toMoney((commission.ReceivedAmount || 0) + payment.Amount);
    const nextPending = this.toMoney((commission.GrossCommission || 0) - nextReceived);

    const nextCommission = {
      ...commission,
      ReceivedAmount: nextReceived,
      PendingAmount: nextPending,
      Received: nextReceived,
      Pending: nextPending,
      ReceivedDate: nextPending === 0 ? payment.PaymentDate : commission.ReceivedDate,
      PaymentReference: payment.ReferenceNumber || payment.Reference,
      UpdatedAt: new Date().toISOString()
    };
    nextCommission.Status = this.deriveCommissionStatus(nextCommission);

    db.Payments.push(payment);
    db.Commission[index] = nextCommission;

    this.appendCommissionLedger(db, nextCommission, {
      EntryType: nextCommission.Status === 'RECEIVED' ? 'COMMISSION_FULLY_RECEIVED' : 'COMMISSION_PARTIAL_PAYMENT',
      EntryValue: payment.Amount,
      Status: nextCommission.Status,
      Notes: payment.Notes,
      PaymentID: payment.PaymentID,
      Payload: { payment }
    });
    this.appendCommissionLedger(db, nextCommission, {
      EntryType: 'COMMISSION_PAYMENT_RECEIVED',
      EntryValue: payment.Amount,
      Status: nextCommission.Status,
      Notes: payment.Notes,
      PaymentID: payment.PaymentID
    });

    this.write(db);
    this.addTimelineEntry(nextCommission.LeadID, 'Commission', nextCommission.CommissionID, 'COMMISSION_PAYMENT_RECEIVED', 'Commission payment received', { commission: nextCommission, payment });
    return { ok: true, data: { commission: nextCommission, payment } };
  }

  getClosingDefaultChecklist() {
    return [
      'TOKEN_VERIFIED',
      'AGREEMENT_COMPLETED',
      'REGISTRATION_COMPLETED',
      'SALE_DEED_VERIFIED',
      'BUYER_PAYMENT_VERIFIED',
      'SELLER_PAYMENT_VERIFIED',
      'BROKERAGE_AGREEMENT_VERIFIED',
      'COMMISSION_GENERATED',
      'COMMISSION_SETTLED',
      'DOCUMENTS_ARCHIVED'
    ].map((key) => ({
      ItemKey: key,
      Label: key.replace(/_/g, ' '),
      Status: 'PENDING',
      CompletedBy: null,
      CompletedAt: null,
      Notes: ''
    }));
  }

  appendClosingHistory(db, closing, entry = {}) {
    db.ClosingHistory = db.ClosingHistory || [];
    const row = {
      ClosingHistoryID: this.createId('CLH'),
      ClosingID: closing.ClosingID,
      DealID: closing.DealID,
      LeadID: closing.LeadID,
      EventType: entry.EventType || 'CLOSING_UPDATED',
      EventDate: entry.EventDate || new Date().toISOString(),
      Actor: entry.Actor || 'system',
      Notes: entry.Notes || '',
      Payload: entry.Payload || null
    };
    db.ClosingHistory.push(row);
    return row;
  }

  getClosing(dealId) {
    const db = this.read();
    db.Closings = db.Closings || [];
    return db.Closings.find((row) => row.DealID === dealId) || null;
  }

  listClosingHistory(dealId) {
    const db = this.read();
    const closing = (db.Closings || []).find((row) => row.DealID === dealId);
    if (!closing) return [];
    db.ClosingHistory = db.ClosingHistory || [];
    return db.ClosingHistory
      .filter((row) => row.ClosingID === closing.ClosingID)
      .sort((a, b) => new Date(a.EventDate).getTime() - new Date(b.EventDate).getTime());
  }

  startClosing(dealId, payload = {}) {
    const db = this.read();
    db.Closings = db.Closings || [];

    const deal = (db.Deals || []).find((row) => row.DealID === dealId);
    if (!deal) return { ok: false, error: 'Deal not found' };

    if (db.Closings.some((row) => row.DealID === dealId && row.Status !== 'CANCELLED')) {
      return { ok: false, error: 'Closing already started for this deal' };
    }

    const closing = {
      ClosingID: this.createId('CLS'),
      DealID: deal.DealID,
      TokenID: deal.TokenID || null,
      NegotiationID: deal.NegotiationID || null,
      TransactionID: deal.TransactionID || null,
      LeadID: deal.LeadID,
      RequirementID: deal.RequirementID,
      PropertyID: deal.PropertyID,
      Status: 'IN_PROGRESS',
      Checklist: this.getClosingDefaultChecklist(),
      StartedAt: new Date().toISOString(),
      CompletedAt: null,
      ClosedAt: null,
      Notes: payload.Notes || payload.notes || '',
      CreatedBy: payload.CreatedBy || payload.createdBy || 'system',
      UpdatedBy: payload.CreatedBy || payload.createdBy || 'system',
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    };

    db.Closings.push(closing);
    this.appendClosingHistory(db, closing, {
      EventType: 'CLOSING_STARTED',
      Actor: closing.CreatedBy,
      Notes: closing.Notes,
      Payload: { checklistCount: closing.Checklist.length }
    });
    this.write(db);
    this.addTimelineEntry(closing.LeadID, 'Closing', closing.ClosingID, 'CLOSING_STARTED', 'Closing started', closing);
    return { ok: true, data: closing };
  }

  updateClosingChecklist(dealId, payload = {}) {
    const db = this.read();
    db.Closings = db.Closings || [];
    const index = db.Closings.findIndex((row) => row.DealID === dealId);
    if (index === -1) return { ok: false, error: 'Closing not found' };

    const closing = db.Closings[index];
    if (closing.Status === 'CLOSED') {
      return { ok: false, error: 'Cannot update checklist for closed deal' };
    }

    const itemKey = payload.ItemKey || payload.itemKey;
    if (!itemKey) return { ok: false, error: 'ItemKey is required' };

    const checklist = closing.Checklist || [];
    const itemIndex = checklist.findIndex((row) => row.ItemKey === itemKey);
    if (itemIndex === -1) return { ok: false, error: 'Checklist item not found' };

    const status = String(payload.Status || payload.status || '').toUpperCase();
    if (!['PENDING', 'COMPLETED'].includes(status)) {
      return { ok: false, error: 'Checklist status must be PENDING or COMPLETED' };
    }

    const now = new Date().toISOString();
    checklist[itemIndex] = {
      ...checklist[itemIndex],
      Status: status,
      CompletedBy: status === 'COMPLETED' ? (payload.CompletedBy || payload.completedBy || 'system') : null,
      CompletedAt: status === 'COMPLETED' ? now : null,
      Notes: payload.Notes ?? payload.notes ?? checklist[itemIndex].Notes
    };

    closing.Checklist = checklist;
    closing.UpdatedAt = now;
    closing.UpdatedBy = payload.UpdatedBy || payload.updatedBy || 'system';

    this.appendClosingHistory(db, closing, {
      EventType: 'CLOSING_CHECKLIST_UPDATED',
      Actor: closing.UpdatedBy,
      Notes: checklist[itemIndex].Notes,
      Payload: { item: checklist[itemIndex] }
    });

    db.Closings[index] = closing;
    this.write(db);
    return { ok: true, data: closing };
  }

  validateClosingCompleteness(db, closing) {
    const commission = (db.Commission || []).find((row) => row.DealID === closing.DealID);
    if (!commission) {
      return { ok: false, error: 'Commission is required before closing completion' };
    }
    if (commission.Status !== 'RECEIVED') {
      return { ok: false, error: 'Commission must be fully settled before closing completion' };
    }

    const checklist = closing.Checklist || [];
    const incomplete = checklist.find((item) => item.Status !== 'COMPLETED');
    if (incomplete) {
      return { ok: false, error: `Checklist item ${incomplete.ItemKey} is incomplete` };
    }

    return { ok: true };
  }

  completeClosing(dealId, payload = {}) {
    const db = this.read();
    db.Closings = db.Closings || [];
    const index = db.Closings.findIndex((row) => row.DealID === dealId);
    if (index === -1) return { ok: false, error: 'Closing not found' };

    const closing = db.Closings[index];
    if (closing.Status === 'CLOSED') return { ok: false, error: 'Deal is already closed' };

    const validation = this.validateClosingCompleteness(db, closing);
    if (!validation.ok) return validation;

    const now = new Date().toISOString();
    closing.Status = 'COMPLETED';
    closing.CompletedAt = now;
    closing.UpdatedAt = now;
    closing.UpdatedBy = payload.UpdatedBy || payload.updatedBy || 'system';
    closing.Notes = payload.Notes ?? payload.notes ?? closing.Notes;
    db.Closings[index] = closing;

    this.appendClosingHistory(db, closing, {
      EventType: 'CLOSING_COMPLETED',
      Actor: closing.UpdatedBy,
      Notes: closing.Notes
    });

    this.write(db);
    this.addTimelineEntry(closing.LeadID, 'Closing', closing.ClosingID, 'CLOSING_COMPLETED', 'Closing completed', closing);
    return { ok: true, data: closing };
  }

  closeDeal(dealId, payload = {}) {
    const db = this.read();
    db.Deals = db.Deals || [];
    db.Closings = db.Closings || [];

    const dealIndex = db.Deals.findIndex((row) => row.DealID === dealId);
    if (dealIndex === -1) return { ok: false, error: 'Deal not found' };

    const closingIndex = db.Closings.findIndex((row) => row.DealID === dealId);
    if (closingIndex === -1) return { ok: false, error: 'Closing not found' };

    const closing = db.Closings[closingIndex];
    if (closing.Status !== 'COMPLETED') {
      return { ok: false, error: 'Closing must be completed before deal closure' };
    }

    const now = new Date().toISOString();
    const deal = {
      ...db.Deals[dealIndex],
      Status: 'CLOSED',
      ClosingDate: payload.ClosingDate || payload.closingDate || now,
      UpdatedAt: now,
      Notes: payload.Notes ?? payload.notes ?? db.Deals[dealIndex].Notes
    };
    db.Deals[dealIndex] = deal;

    closing.Status = 'CLOSED';
    closing.ClosedAt = now;
    closing.UpdatedAt = now;
    closing.UpdatedBy = payload.UpdatedBy || payload.updatedBy || 'system';
    db.Closings[closingIndex] = closing;

    this.appendClosingHistory(db, closing, {
      EventType: 'DEAL_CLOSED',
      Actor: closing.UpdatedBy,
      Notes: payload.Notes || payload.notes || ''
    });

    this.write(db);
    this.addTimelineEntry(deal.LeadID, 'Deal', deal.DealID, 'DEAL_CLOSED', 'Deal closed', deal);
    return { ok: true, data: { deal, closing } };
  }

  getCommissionSummary() {
    const commissions = this.listCommissions();
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    const quarterStartMonth = Math.floor(month / 3) * 3;
    const quarterStart = new Date(year, quarterStartMonth, 1);
    const yearStart = new Date(year, 0, 1);

    const amount = (rows, field) => this.toMoney(rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)) || 0;

    const byWindow = (rows, startDate) => rows.filter((row) => new Date(row.CreatedAt).getTime() >= startDate.getTime());

    const agentSummary = {};
    const brokerSummary = {};
    const dealSummary = {};

    for (const row of commissions) {
      const agentKey = row.AgentID || 'UNASSIGNED';
      const brokerKey = row.BrokerID || 'UNASSIGNED';

      if (!agentSummary[agentKey]) {
        agentSummary[agentKey] = { AgentID: agentKey, Gross: 0, Received: 0, Pending: 0 };
      }
      if (!brokerSummary[brokerKey]) {
        brokerSummary[brokerKey] = { BrokerID: brokerKey, Gross: 0, Received: 0, Pending: 0 };
      }
      if (!dealSummary[row.DealID]) {
        dealSummary[row.DealID] = { DealID: row.DealID, Commission: 0, Received: 0, Pending: 0 };
      }

      agentSummary[agentKey].Gross += Number(row.GrossCommission || 0);
      agentSummary[agentKey].Received += Number(row.ReceivedAmount || 0);
      agentSummary[agentKey].Pending += Number(row.PendingAmount || 0);

      brokerSummary[brokerKey].Gross += Number(row.GrossCommission || 0);
      brokerSummary[brokerKey].Received += Number(row.ReceivedAmount || 0);
      brokerSummary[brokerKey].Pending += Number(row.PendingAmount || 0);

      dealSummary[row.DealID].Commission += Number(row.GrossCommission || 0);
      dealSummary[row.DealID].Received += Number(row.ReceivedAmount || 0);
      dealSummary[row.DealID].Pending += Number(row.PendingAmount || 0);
    }

    const normalizeRows = (rows) => rows.map((row) => ({
      ...row,
      Gross: this.toMoney(row.Gross),
      Received: this.toMoney(row.Received),
      Pending: this.toMoney(row.Pending),
      Commission: this.toMoney(row.Commission)
    }));

    return {
      ok: true,
      data: {
        totalCommission: amount(commissions, 'GrossCommission'),
        received: amount(commissions, 'ReceivedAmount'),
        pending: amount(commissions, 'PendingAmount'),
        partial: commissions.filter((row) => row.Status === 'PARTIAL').length,
        overdue: commissions.filter((row) => row.Status === 'OVERDUE').length,
        cancelled: commissions.filter((row) => row.Status === 'CANCELLED').length,
        thisMonth: amount(byWindow(commissions, new Date(year, month, 1)), 'GrossCommission'),
        thisQuarter: amount(byWindow(commissions, quarterStart), 'GrossCommission'),
        thisYear: amount(byWindow(commissions, yearStart), 'GrossCommission'),
        byAgent: normalizeRows(Object.values(agentSummary)),
        byBroker: normalizeRows(Object.values(brokerSummary)),
        byDeal: normalizeRows(Object.values(dealSummary))
      }
    };
  }

  getKolkataDateKey(value) {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(parsed);
  }

  dateKeyToDateUtc(dateKey) {
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
    const [year, month, day] = dateKey.split('-').map((item) => Number(item));
    return new Date(Date.UTC(year, month - 1, day));
  }

  dateUtcToKey(dateUtc) {
    if (!(dateUtc instanceof Date) || Number.isNaN(dateUtc.getTime())) return null;
    return dateUtc.toISOString().slice(0, 10);
  }

  normalizeDatePreset(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const aliases = {
      today: 'today',
      yesterday: 'yesterday',
      last7days: 'last7days',
      'last-7-days': 'last7days',
      last_7_days: 'last7days',
      last30days: 'last30days',
      'last-30-days': 'last30days',
      last_30_days: 'last30days',
      thismonth: 'thismonth',
      lastmonth: 'lastmonth',
      thisquarter: 'thisquarter',
      thisyear: 'thisyear',
      custom: 'custom'
    };
    return aliases[normalized] || null;
  }

  getDateRangeFromPreset(filters = {}) {
    const preset = this.normalizeDatePreset(filters.datePreset || filters.range || filters.dateRange);
    const todayKey = this.getKolkataDateKey(new Date());
    const today = this.dateKeyToDateUtc(todayKey);

    if (!preset) {
      if (filters.dateFrom || filters.fromDate || filters.startDate || filters.dateTo || filters.toDate || filters.endDate) {
        const fromKey = String(filters.dateFrom || filters.fromDate || filters.startDate || '').slice(0, 10);
        const toKey = String(filters.dateTo || filters.toDate || filters.endDate || '').slice(0, 10);
        if (fromKey && toKey && fromKey > toKey) {
          return { ok: false, error: 'Invalid date range: dateFrom must be <= dateTo' };
        }
        return { ok: true, preset: 'custom', fromKey: fromKey || null, toKey: toKey || null };
      }
      return { ok: true, preset: null, fromKey: null, toKey: null };
    }

    if (!(today instanceof Date) || Number.isNaN(today.getTime())) {
      return { ok: false, error: 'Could not resolve timezone date context' };
    }

    const shift = (days) => {
      const next = new Date(today.getTime());
      next.setUTCDate(next.getUTCDate() + days);
      return next;
    };

    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    let fromDate = null;
    let toDate = today;

    if (preset === 'today') {
      fromDate = today;
    } else if (preset === 'yesterday') {
      fromDate = shift(-1);
      toDate = shift(-1);
    } else if (preset === 'last7days') {
      fromDate = shift(-6);
    } else if (preset === 'last30days') {
      fromDate = shift(-29);
    } else if (preset === 'thismonth') {
      fromDate = new Date(Date.UTC(y, m, 1));
    } else if (preset === 'lastmonth') {
      fromDate = new Date(Date.UTC(y, m - 1, 1));
      toDate = new Date(Date.UTC(y, m, 0));
    } else if (preset === 'thisquarter') {
      const quarterStartMonth = Math.floor(m / 3) * 3;
      fromDate = new Date(Date.UTC(y, quarterStartMonth, 1));
    } else if (preset === 'thisyear') {
      fromDate = new Date(Date.UTC(y, 0, 1));
    } else if (preset === 'custom') {
      const fromKey = String(filters.dateFrom || filters.fromDate || filters.startDate || '').slice(0, 10);
      const toKey = String(filters.dateTo || filters.toDate || filters.endDate || '').slice(0, 10);
      if (fromKey && toKey && fromKey > toKey) {
        return { ok: false, error: 'Invalid date range: dateFrom must be <= dateTo' };
      }
      return { ok: true, preset: 'custom', fromKey: fromKey || null, toKey: toKey || null };
    }

    return {
      ok: true,
      preset,
      fromKey: this.dateUtcToKey(fromDate),
      toKey: this.dateUtcToKey(toDate)
    };
  }

  withinDateRange(row, dateFields, range) {
    if (!range || (!range.fromKey && !range.toKey)) return true;
    const fields = Array.isArray(dateFields) ? dateFields : [dateFields];
    for (const field of fields) {
      const key = this.getKolkataDateKey(row?.[field]);
      if (!key) continue;
      if (range.fromKey && key < range.fromKey) continue;
      if (range.toKey && key > range.toKey) continue;
      return true;
    }
    return false;
  }

  normalizeArrayFilter(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (value === undefined || value === null || value === '') return [];
    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  equalsIgnoreCase(value, candidate) {
    return String(value || '').trim().toLowerCase() === String(candidate || '').trim().toLowerCase();
  }

  inFilterList(value, values) {
    if (!values || values.length === 0) return true;
    return values.some((item) => this.equalsIgnoreCase(value, item));
  }

  countBy(rows, mapper) {
    const bucket = {};
    for (const row of rows) {
      const key = mapper(row);
      const normalized = String(key || 'UNKNOWN').trim() || 'UNKNOWN';
      bucket[normalized] = (bucket[normalized] || 0) + 1;
    }
    return bucket;
  }

  sumBy(rows, mapper) {
    return this.toMoney(rows.reduce((sum, row) => sum + Number(mapper(row) || 0), 0)) || 0;
  }

  percent(part, total) {
    if (!total || total <= 0) return 0;
    return Math.round((part / total) * 10000) / 100;
  }

  normalizeRole(role) {
    return String(role || 'ADMIN').trim().toUpperCase();
  }

  scopeLeadIdsByRole(db, actor = {}) {
    const role = this.normalizeRole(actor.role);
    const userId = String(actor.userId || actor.userID || actor.agentId || actor.agentID || '').trim();
    if (role !== 'AGENT' || !userId) return null;
    return new Set((db.Leads || []).filter((lead) => lead.AssignedAgentID === userId).map((lead) => lead.LeadID));
  }

  collectReportingDataset(filters = {}, actor = {}) {
    const db = this.read();
    const range = this.getDateRangeFromPreset(filters);
    if (!range.ok) return range;

    const categoryFilter = this.normalizeArrayFilter(filters.category);
    const locationFilter = this.normalizeArrayFilter(filters.location);
    const sourceFilter = this.normalizeArrayFilter(filters.leadSource || filters.source);
    const transactionFilter = this.normalizeArrayFilter(filters.transactionType);
    const agentFilter = this.normalizeArrayFilter(filters.agentId || filters.agentID);
    const builderFilter = this.normalizeArrayFilter(filters.builder || filters.builderId || filters.builderID);
    const projectFilter = this.normalizeArrayFilter(filters.project);
    const dealStatusFilter = this.normalizeArrayFilter(filters.dealStatus);
    const commissionStatusFilter = this.normalizeArrayFilter(filters.commissionStatus);

    const scopedLeadIds = this.scopeLeadIdsByRole(db, actor);

    const leads = (db.Leads || []).filter((lead) => {
      if (scopedLeadIds && !scopedLeadIds.has(lead.LeadID)) return false;
      if (agentFilter.length && !this.inFilterList(lead.AssignedAgentID, agentFilter)) return false;
      if (sourceFilter.length && !this.inFilterList(lead.LeadSource || lead.Source || 'Manual', sourceFilter)) return false;
      if (locationFilter.length && !this.inFilterList(lead.City || lead.Location || '', locationFilter)) return false;
      return this.withinDateRange(lead, ['CreatedAt', 'UpdatedAt'], range);
    });

    const leadIdSet = new Set(leads.map((lead) => lead.LeadID));

    const requirements = (db.Requirements || []).filter((item) => {
      if (!leadIdSet.has(item.LeadID)) return false;
      if (transactionFilter.length && !this.inFilterList(item.TransactionType, transactionFilter)) return false;
      if (categoryFilter.length && !this.inFilterList(item.Category, categoryFilter)) return false;
      if (locationFilter.length && ![item.Location1, item.Location2, item.Location3].some((value) => this.inFilterList(value, locationFilter))) return false;
      return this.withinDateRange(item, ['CreatedAt', 'UpdatedAt'], range);
    });

    const requirementIdSet = new Set(requirements.map((item) => item.RequirementID));

    const inventory = (db.Inventory || []).filter((item) => {
      if (categoryFilter.length && !this.inFilterList(item.Category, categoryFilter)) return false;
      if (transactionFilter.length && !this.inFilterList(item.TransactionType, transactionFilter)) return false;
      if (locationFilter.length && ![item.Location, item.City].some((value) => this.inFilterList(value, locationFilter))) return false;
      if (builderFilter.length && !this.inFilterList(item.BuilderID, builderFilter)) return false;
      if (projectFilter.length && !this.inFilterList(item.Project, projectFilter)) return false;
      return this.withinDateRange(item, ['CreatedAt', 'UpdatedAt'], range);
    });

    const propertyIdSet = new Set(inventory.map((item) => item.PropertyID));

    const matches = (db.Matches || []).filter((item) => {
      if (!requirementIdSet.has(item.RequirementID)) return false;
      if (propertyIdSet.size && !propertyIdSet.has(item.PropertyID)) return false;
      return this.withinDateRange(item, ['CreatedAt', 'UpdatedAt'], range);
    });

    const matchIdSet = new Set(matches.map((item) => item.MatchID));

    const shortlists = (db.Shortlists || []).filter((item) => {
      if (!leadIdSet.has(item.LeadID)) return false;
      if (!requirementIdSet.has(item.RequirementID)) return false;
      if (propertyIdSet.size && !propertyIdSet.has(item.PropertyID)) return false;
      if (item.MatchID && matchIdSet.size && !matchIdSet.has(item.MatchID)) return false;
      return this.withinDateRange(item, ['CreatedAt', 'UpdatedAt'], range);
    });

    const shortlistIdSet = new Set(shortlists.map((item) => item.ShortlistID));

    const siteVisits = (db.SiteVisits || []).filter((item) => {
      if (!leadIdSet.has(item.LeadID)) return false;
      if (!requirementIdSet.has(item.RequirementID)) return false;
      if (propertyIdSet.size && !propertyIdSet.has(item.PropertyID)) return false;
      if (shortlistIdSet.size && item.ShortlistID && !shortlistIdSet.has(item.ShortlistID)) return false;
      if (agentFilter.length && !this.inFilterList(item.AssignedAgentID || item.AgentID, agentFilter)) return false;
      return this.withinDateRange(item, ['VisitDate', 'CreatedAt', 'UpdatedAt'], range);
    });

    const visitIdSet = new Set(siteVisits.map((item) => item.VisitID));

    const negotiations = (db.Negotiations || []).filter((item) => {
      if (!leadIdSet.has(item.LeadID)) return false;
      if (!requirementIdSet.has(item.RequirementID)) return false;
      if (propertyIdSet.size && !propertyIdSet.has(item.PropertyID)) return false;
      if (item.SiteVisitID && visitIdSet.size && !visitIdSet.has(item.SiteVisitID)) return false;
      if (agentFilter.length && !this.inFilterList(item.AssignedAgentID, agentFilter)) return false;
      return this.withinDateRange(item, ['CreatedAt', 'UpdatedAt'], range);
    });

    const negotiationIdSet = new Set(negotiations.map((item) => item.NegotiationID));

    const tokens = (db.Tokens || []).filter((item) => {
      if (!leadIdSet.has(item.LeadID)) return false;
      if (!requirementIdSet.has(item.RequirementID)) return false;
      if (propertyIdSet.size && !propertyIdSet.has(item.PropertyID)) return false;
      if (negotiationIdSet.size && !negotiationIdSet.has(item.NegotiationID)) return false;
      return this.withinDateRange(item, ['TokenDate', 'CreatedAt', 'UpdatedAt'], range);
    });

    const tokenIdSet = new Set(tokens.map((item) => item.TokenID));

    const deals = (db.Deals || []).filter((item) => {
      if (!leadIdSet.has(item.LeadID)) return false;
      if (!requirementIdSet.has(item.RequirementID)) return false;
      if (propertyIdSet.size && !propertyIdSet.has(item.PropertyID)) return false;
      if (tokenIdSet.size && !tokenIdSet.has(item.TokenID)) return false;
      if (negotiationIdSet.size && !negotiationIdSet.has(item.NegotiationID)) return false;
      if (dealStatusFilter.length && !this.inFilterList(item.Status, dealStatusFilter)) return false;
      return this.withinDateRange(item, ['CreatedAt', 'AgreementDate', 'RegistrationDate', 'ClosingDate', 'UpdatedAt'], range);
    });

    const dealIdSet = new Set(deals.map((item) => item.DealID));

    const payments = (db.Payments || []).filter((item) => {
      if (item.DealID && dealIdSet.size && !dealIdSet.has(item.DealID)) return false;
      return this.withinDateRange(item, ['PaymentDate', 'CreatedAt', 'UpdatedAt'], range);
    });

    const commissions = (db.Commission || []).filter((item) => {
      if (dealIdSet.size && !dealIdSet.has(item.DealID)) return false;
      if (commissionStatusFilter.length && !this.inFilterList(item.Status, commissionStatusFilter)) return false;
      if (agentFilter.length && !this.inFilterList(item.AgentID, agentFilter)) return false;
      return this.withinDateRange(item, ['CreatedAt', 'DueDate', 'ReceivedDate', 'UpdatedAt'], range);
    });

    const commissionIdSet = new Set(commissions.map((item) => item.CommissionID));

    const commissionLedger = (db.CommissionLedger || []).filter((item) => {
      if (commissionIdSet.size && !commissionIdSet.has(item.CommissionID)) return false;
      return this.withinDateRange(item, ['EntryDate'], range);
    });

    const closings = (db.Closings || []).filter((item) => {
      if (dealIdSet.size && !dealIdSet.has(item.DealID)) return false;
      return this.withinDateRange(item, ['StartedAt', 'CompletedAt', 'ClosedAt', 'CreatedAt', 'UpdatedAt'], range);
    });

    const closingIdSet = new Set(closings.map((item) => item.ClosingID));

    const closingHistory = (db.ClosingHistory || []).filter((item) => {
      if (closingIdSet.size && !closingIdSet.has(item.ClosingID)) return false;
      return this.withinDateRange(item, ['EventDate'], range);
    });

    const transactions = (db.Transactions || []).filter((item) => {
      if (!leadIdSet.has(item.LeadID)) return false;
      if (transactionFilter.length && !this.inFilterList(item.Type, transactionFilter)) return false;
      return this.withinDateRange(item, ['UpdatedAt', 'CreatedAt'], range);
    });

    return {
      ok: true,
      data: {
        filters: {
          ...filters,
          datePreset: range.preset,
          dateFrom: range.fromKey,
          dateTo: range.toKey
        },
        leads,
        requirements,
        inventory,
        matches,
        shortlists,
        siteVisits,
        negotiations,
        tokens,
        deals,
        payments,
        commissions,
        commissionLedger,
        closings,
        closingHistory,
        transactions
      }
    };
  }

  buildFunnelReport(dataset) {
    const stages = [
      { key: 'Lead', count: dataset.leads.length },
      { key: 'Requirement', count: dataset.requirements.length },
      { key: 'Match', count: dataset.matches.length },
      { key: 'Shortlist', count: dataset.shortlists.length },
      { key: 'Site Visit', count: dataset.siteVisits.length },
      { key: 'Negotiation', count: dataset.negotiations.length },
      { key: 'Token', count: dataset.tokens.length },
      { key: 'Deal', count: dataset.deals.length },
      { key: 'Completed', count: dataset.deals.filter((row) => ['COMPLETED', 'CLOSED'].includes(String(row.Status || '').toUpperCase())).length }
    ];

    const rows = stages.map((stage, index) => {
      const previous = index === 0 ? stage.count : stages[index - 1].count;
      const conversionPercent = index === 0 ? 100 : this.percent(stage.count, previous);
      const dropOffPercent = index === 0 ? 0 : this.percent(Math.max(previous - stage.count, 0), previous);
      return {
        stage: stage.key,
        count: stage.count,
        conversionPercent,
        dropOffPercent,
        averageTimeToNext: 'N/A'
      };
    });

    return rows;
  }

  getDashboardReport(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;

    const leadStatus = this.countBy(dataset.leads, (row) => String(row.LeadStatus || 'UNKNOWN').toUpperCase());
    const activeRequirements = dataset.requirements.filter((row) => ['ACTIVE', 'OPEN', 'NEW'].includes(String(row.Status || '').toUpperCase())).length;
    const matchedRequirementIds = new Set(dataset.matches.map((row) => row.RequirementID));
    const shortlistedRequirementIds = new Set(dataset.shortlists.map((row) => row.RequirementID));
    const hotLeadIds = new Set(dataset.requirements.filter((row) => ['HIGH', 'HOT'].includes(String(row.Urgency || '').toUpperCase())).map((row) => row.LeadID));
    const convertedLeadIds = new Set(dataset.deals.map((row) => row.LeadID));

    const inventoryByStatus = this.countBy(dataset.inventory, (row) => String(row.Status || 'UNKNOWN').toUpperCase());
    const underNegotiation = (inventoryByStatus.NEGOTIATION || 0) + (inventoryByStatus.NEGOTIATING || 0) + (inventoryByStatus.UNDER_NEGOTIATION || 0);
    const tokenized = (inventoryByStatus.TOKEN || 0) + (inventoryByStatus.TOKENIZED || 0) + (inventoryByStatus.BOOKED || 0);

    const grossBrokerage = this.sumBy(dataset.deals, (row) => row.Brokerage || 0);
    const receivedBrokerage = this.sumBy(dataset.payments.filter((row) => String(row.PaymentType || '').toUpperCase() !== 'COMMISSION'), (row) => row.Amount || 0);
    const pendingBrokerage = this.toMoney(Math.max(grossBrokerage - receivedBrokerage, 0)) || 0;

    const grossCommission = this.sumBy(dataset.commissions, (row) => row.GrossCommission || 0);
    const commissionReceived = this.sumBy(dataset.commissions, (row) => row.ReceivedAmount || 0);
    const commissionPending = this.sumBy(dataset.commissions, (row) => row.PendingAmount || 0);

    const openClosings = dataset.closings.filter((row) => !['CLOSED', 'CANCELLED'].includes(String(row.Status || '').toUpperCase())).length;
    const completedClosings = dataset.closings.filter((row) => ['COMPLETED', 'CLOSED'].includes(String(row.Status || '').toUpperCase())).length;
    const pendingDocuments = dataset.closings.filter((row) => (row.Checklist || []).some((item) => String(item.ItemKey || '').toUpperCase() === 'DOCUMENTS_ARCHIVED' && String(item.Status || '').toUpperCase() !== 'COMPLETED')).length;

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        executive: {
          totalLeads: dataset.leads.length,
          activeLeads: (leadStatus.ACTIVE || 0) + (leadStatus.VERIFIED || 0),
          hotLeads: hotLeadIds.size,
          newLeads: leadStatus.NEW || 0,
          convertedLeads: convertedLeadIds.size,
          inactiveLeads: leadStatus.INACTIVE || 0
        },
        requirements: {
          totalRequirements: dataset.requirements.length,
          activeRequirements,
          matchedRequirements: matchedRequirementIds.size,
          shortlistedRequirements: shortlistedRequirementIds.size
        },
        inventory: {
          totalProperties: dataset.inventory.length,
          available: inventoryByStatus.AVAILABLE || 0,
          underNegotiation,
          tokenized,
          sold: inventoryByStatus.SOLD || 0,
          rented: inventoryByStatus.RENTED || 0,
          leased: inventoryByStatus.LEASED || 0
        },
        pipeline: {
          matching: dataset.matches.length,
          shortlist: dataset.shortlists.length,
          siteVisit: dataset.siteVisits.length,
          negotiation: dataset.negotiations.length,
          token: dataset.tokens.length,
          deal: dataset.deals.length,
          completed: dataset.deals.filter((row) => ['COMPLETED', 'CLOSED'].includes(String(row.Status || '').toUpperCase())).length
        },
        financial: {
          grossBrokerage,
          receivedBrokerage,
          pendingBrokerage,
          commission: grossCommission,
          commissionReceived,
          commissionPending
        },
        closings: {
          openClosings,
          completedClosings,
          pendingDocuments
        }
      }
    };
  }

  getLeadAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;

    const statusCounts = this.countBy(dataset.leads, (row) => String(row.LeadStatus || 'UNKNOWN').toUpperCase());
    const dealsByLead = this.countBy(dataset.deals, (row) => row.LeadID);
    const brokerageByLead = {};
    for (const deal of dataset.deals) {
      brokerageByLead[deal.LeadID] = (brokerageByLead[deal.LeadID] || 0) + Number(deal.Brokerage || 0);
    }

    const sourceRows = {};
    const canonicalSources = ['Manual', 'Bulk', 'WhatsApp', 'Reference', 'MagicBricks', '99acres', 'Housing', 'Instagram', 'Facebook'];
    for (const lead of dataset.leads) {
      const source = String(lead.LeadSource || lead.Source || 'Manual');
      const sourceKey = canonicalSources.find((item) => this.equalsIgnoreCase(item, source)) || source;
      if (!sourceRows[sourceKey]) {
        sourceRows[sourceKey] = { leadSource: sourceKey, leads: 0, deals: 0, conversionPercent: 0, brokerageContribution: 0 };
      }
      sourceRows[sourceKey].leads += 1;
      sourceRows[sourceKey].deals += Number(dealsByLead[lead.LeadID] || 0) > 0 ? 1 : 0;
      sourceRows[sourceKey].brokerageContribution += Number(brokerageByLead[lead.LeadID] || 0);
    }

    const sourceBreakdown = Object.values(sourceRows).map((item) => ({
      ...item,
      conversionPercent: this.percent(item.deals, item.leads),
      brokerageContribution: this.toMoney(item.brokerageContribution) || 0
    })).sort((a, b) => b.leads - a.leads);

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        totalLeads: dataset.leads.length,
        newLeads: statusCounts.NEW || 0,
        verifiedLeads: statusCounts.VERIFIED || 0,
        activeLeads: statusCounts.ACTIVE || 0,
        inactiveLeads: statusCounts.INACTIVE || 0,
        blacklistedLeads: statusCounts.BLACKLISTED || 0,
        sourceBreakdown,
        funnel: this.buildFunnelReport(dataset)
      }
    };
  }

  getRequirementAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;
    const statusCounts = this.countBy(dataset.requirements, (row) => String(row.Status || 'UNKNOWN').toUpperCase());

    const budgetBuckets = {
      '<=50L': 0,
      '50L-1Cr': 0,
      '1Cr-2Cr': 0,
      '>2Cr': 0
    };
    for (const row of dataset.requirements) {
      const budget = Number(row.BudgetMax || row.BudgetMin || 0);
      if (budget <= 5000000) budgetBuckets['<=50L'] += 1;
      else if (budget <= 10000000) budgetBuckets['50L-1Cr'] += 1;
      else if (budget <= 20000000) budgetBuckets['1Cr-2Cr'] += 1;
      else budgetBuckets['>2Cr'] += 1;
    }

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        totalRequirements: dataset.requirements.length,
        activeRequirements: (statusCounts.ACTIVE || 0) + (statusCounts.OPEN || 0),
        archivedRequirements: (statusCounts.CANCELLED || 0) + (statusCounts.CLOSED || 0),
        hotRequirements: dataset.requirements.filter((row) => ['HIGH', 'HOT'].includes(String(row.Urgency || '').toUpperCase())).length,
        byTransactionType: this.countBy(dataset.requirements, (row) => row.TransactionType || 'UNKNOWN'),
        byCategory: this.countBy(dataset.requirements, (row) => row.Category || 'UNKNOWN'),
        budgetDistribution: budgetBuckets,
        locationDistribution: this.countBy(dataset.requirements, (row) => row.Location1 || row.Location2 || row.Location3 || 'UNKNOWN'),
        bhkDistribution: this.countBy(dataset.requirements, (row) => row.BHKMin || row.BHKMax || 'N/A'),
        areaDistribution: this.countBy(dataset.requirements, (row) => row.AreaMin || row.AreaMax || 'N/A')
      }
    };
  }

  getInventoryAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;
    const statusCounts = this.countBy(dataset.inventory, (row) => String(row.Status || 'UNKNOWN').toUpperCase());

    const prices = dataset.inventory.map((row) => Number(row.Price || 0)).filter((value) => Number.isFinite(value) && value > 0);
    const areas = dataset.inventory.map((row) => Number(row.Area || 0)).filter((value) => Number.isFinite(value) && value > 0);

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        totalInventory: dataset.inventory.length,
        available: statusCounts.AVAILABLE || 0,
        reserved: statusCounts.RESERVED || 0,
        negotiation: (statusCounts.NEGOTIATION || 0) + (statusCounts.NEGOTIATING || 0) + (statusCounts.UNDER_NEGOTIATION || 0),
        token: (statusCounts.TOKEN || 0) + (statusCounts.TOKENIZED || 0) + (statusCounts.BOOKED || 0),
        sold: statusCounts.SOLD || 0,
        rented: statusCounts.RENTED || 0,
        leased: statusCounts.LEASED || 0,
        inactive: statusCounts.INACTIVE || 0,
        byCategory: this.countBy(dataset.inventory, (row) => row.Category || 'UNKNOWN'),
        byPropertyType: this.countBy(dataset.inventory, (row) => row.PropertyType || 'UNKNOWN'),
        byLocation: this.countBy(dataset.inventory, (row) => row.Location || row.City || 'UNKNOWN'),
        byBuilder: this.countBy(dataset.inventory, (row) => row.BuilderID || 'UNASSIGNED'),
        byOwner: this.countBy(dataset.inventory, (row) => row.OwnerID || 'UNASSIGNED'),
        byAgent: this.countBy(dataset.inventory, (row) => row.BrokerID || 'UNASSIGNED'),
        averagePrice: prices.length ? this.toMoney(prices.reduce((sum, value) => sum + value, 0) / prices.length) : 0,
        minimumPrice: prices.length ? Math.min(...prices) : 0,
        maximumPrice: prices.length ? Math.max(...prices) : 0,
        averageArea: areas.length ? Math.round((areas.reduce((sum, value) => sum + value, 0) / areas.length) * 100) / 100 : 0
      }
    };
  }

  getMatchingAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;
    const scoreBuckets = {
      '90-100': 0,
      '80-89': 0,
      '70-79': 0,
      '60-69': 0,
      '<60': 0
    };

    for (const row of dataset.matches) {
      const score = Number(row.Score || 0);
      if (score >= 90) scoreBuckets['90-100'] += 1;
      else if (score >= 80) scoreBuckets['80-89'] += 1;
      else if (score >= 70) scoreBuckets['70-79'] += 1;
      else if (score >= 60) scoreBuckets['60-69'] += 1;
      else scoreBuckets['<60'] += 1;
    }

    const matchedRequirementIds = new Set(dataset.matches.map((row) => row.RequirementID));
    const shortlistedMatchIds = new Set(dataset.shortlists.map((row) => row.MatchID).filter(Boolean));
    const avgMatchScore = dataset.matches.length ? Math.round((dataset.matches.reduce((sum, row) => sum + Number(row.Score || 0), 0) / dataset.matches.length) * 100) / 100 : 0;

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        totalMatches: dataset.matches.length,
        strongMatches: dataset.matches.filter((row) => Number(row.Score || 0) >= 90 || this.equalsIgnoreCase(row.MatchLevel, 'Excellent') || this.equalsIgnoreCase(row.MatchLevel, 'Strong')).length,
        goodMatches: dataset.matches.filter((row) => Number(row.Score || 0) >= 80 && Number(row.Score || 0) < 90).length,
        weakMatches: dataset.matches.filter((row) => Number(row.Score || 0) < 70).length,
        noMatchRequirements: Math.max(dataset.requirements.length - matchedRequirementIds.size, 0),
        scoreDistribution: scoreBuckets,
        averageMatchScore: avgMatchScore,
        requirementToMatchPercent: this.percent(matchedRequirementIds.size, dataset.requirements.length),
        matchToShortlistPercent: this.percent(shortlistedMatchIds.size, dataset.matches.length)
      }
    };
  }

  getShortlistAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;
    const statusCounts = this.countBy(dataset.shortlists, (row) => String(row.Status || 'PENDING').toUpperCase());
    const shortlistIds = new Set(dataset.shortlists.map((row) => row.ShortlistID));

    const toSiteVisit = dataset.siteVisits.filter((row) => row.ShortlistID && shortlistIds.has(row.ShortlistID)).length;
    const toNegotiation = dataset.negotiations.filter((row) => row.ShortlistID && shortlistIds.has(row.ShortlistID)).length;
    const toToken = dataset.tokens.filter((row) => row.ShortlistID && shortlistIds.has(row.ShortlistID)).length;
    const toDeal = dataset.deals.filter((row) => row.ShortlistID && shortlistIds.has(row.ShortlistID)).length;

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        totalShortlisted: dataset.shortlists.length,
        activeShortlist: statusCounts.ACTIVE || 0,
        rejected: statusCounts.REJECTED || 0,
        converted: statusCounts.CONVERTED || 0,
        pending: statusCounts.PENDING || 0,
        conversion: {
          shortlistToSiteVisitPercent: this.percent(toSiteVisit, dataset.shortlists.length),
          shortlistToNegotiationPercent: this.percent(toNegotiation, dataset.shortlists.length),
          shortlistToTokenPercent: this.percent(toToken, dataset.shortlists.length),
          shortlistToDealPercent: this.percent(toDeal, dataset.shortlists.length)
        }
      }
    };
  }

  getSiteVisitAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;
    const statusCounts = this.countBy(dataset.siteVisits, (row) => String(row.Status || 'UNKNOWN').toUpperCase());
    const visitIdSet = new Set(dataset.siteVisits.map((row) => row.VisitID));

    const toNegotiation = dataset.negotiations.filter((row) => row.SiteVisitID && visitIdSet.has(row.SiteVisitID)).length;
    const toToken = dataset.tokens.filter((row) => row.SiteVisitID && visitIdSet.has(row.SiteVisitID)).length;
    const toDeal = dataset.deals.filter((row) => row.SiteVisitID && visitIdSet.has(row.SiteVisitID)).length;

    const byAgent = {};
    for (const visit of dataset.siteVisits) {
      const key = visit.AssignedAgentID || visit.AgentID || 'UNASSIGNED';
      if (!byAgent[key]) {
        byAgent[key] = { agentId: key, scheduled: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0 };
      }
      const status = String(visit.Status || '').toUpperCase();
      if (status === 'SCHEDULED') byAgent[key].scheduled += 1;
      if (status === 'CONFIRMED') byAgent[key].confirmed += 1;
      if (status === 'COMPLETED') byAgent[key].completed += 1;
      if (status === 'CANCELLED') byAgent[key].cancelled += 1;
      if (status === 'NOSHOW' || status === 'NO_SHOW') byAgent[key].noShow += 1;
    }

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        scheduled: statusCounts.SCHEDULED || 0,
        confirmed: statusCounts.CONFIRMED || 0,
        completed: statusCounts.COMPLETED || 0,
        cancelled: statusCounts.CANCELLED || 0,
        noShow: (statusCounts.NOSHOW || 0) + (statusCounts.NO_SHOW || 0),
        completionPercent: this.percent(statusCounts.COMPLETED || 0, dataset.siteVisits.length),
        cancellationPercent: this.percent(statusCounts.CANCELLED || 0, dataset.siteVisits.length),
        conversionToNegotiationPercent: this.percent(toNegotiation, dataset.siteVisits.length),
        conversionToTokenPercent: this.percent(toToken, dataset.siteVisits.length),
        conversionToDealPercent: this.percent(toDeal, dataset.siteVisits.length),
        byAgent: Object.values(byAgent)
      }
    };
  }

  getNegotiationAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;
    const statusCounts = this.countBy(dataset.negotiations, (row) => String(row.Status || 'UNKNOWN').toUpperCase());

    const discountRows = dataset.negotiations.filter((row) => Number(row.AskingPrice || 0) > 0 && Number(row.AgreedPrice || 0) > 0);
    const avgDiscount = discountRows.length
      ? Math.round((discountRows.reduce((sum, row) => sum + ((Number(row.AskingPrice || 0) - Number(row.AgreedPrice || 0)) / Number(row.AskingPrice || 1)) * 100, 0) / discountRows.length) * 100) / 100
      : 0;

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        totalNegotiations: dataset.negotiations.length,
        open: (statusCounts.OPEN || 0) + (statusCounts.NEGOTIATING || 0),
        offerMade: statusCounts.OFFER_MADE || 0,
        counterOffer: statusCounts.COUNTER_OFFER || 0,
        agreed: statusCounts.AGREED || 0,
        rejected: statusCounts.REJECTED || 0,
        cancelled: statusCounts.CANCELLED || 0,
        completed: statusCounts.COMPLETED || 0,
        financial: {
          originalPrice: this.sumBy(dataset.negotiations, (row) => row.AskingPrice || 0),
          clientOffer: this.sumBy(dataset.negotiations, (row) => row.InitialOffer || row.CurrentOffer || 0),
          ownerOffer: this.sumBy(dataset.negotiations, (row) => row.CurrentOffer || 0),
          counterOffer: this.sumBy(dataset.negotiations, (row) => row.CounterOffer || 0),
          agreedPrice: this.sumBy(dataset.negotiations, (row) => row.AgreedPrice || 0),
          averageDiscountPercent: avgDiscount
        },
        conversionToTokenPercent: this.percent(dataset.tokens.length, dataset.negotiations.length),
        conversionToDealPercent: this.percent(dataset.deals.length, dataset.negotiations.length)
      }
    };
  }

  getTokenAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;
    const statusCounts = this.countBy(dataset.tokens, (row) => String(row.Status || 'UNKNOWN').toUpperCase());

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        tokenCount: dataset.tokens.length,
        tokenAmount: this.sumBy(dataset.tokens, (row) => row.TokenAmount || 0),
        requested: statusCounts.REQUESTED || 0,
        partial: statusCounts.PARTIAL || 0,
        received: statusCounts.PAID || 0,
        failed: statusCounts.FAILED || 0,
        refunded: statusCounts.REFUNDED || 0,
        cancelled: statusCounts.CANCELLED || 0,
        financial: {
          totalTokenAmount: this.sumBy(dataset.tokens, (row) => row.TokenAmount || 0),
          receivedToken: this.sumBy(dataset.tokens, (row) => row.PaidAmount || 0),
          pendingToken: this.sumBy(dataset.tokens, (row) => row.PendingAmount || 0)
        },
        tokenToDealPercent: this.percent(dataset.deals.length, dataset.tokens.length)
      }
    };
  }

  getDealAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;
    const statusCounts = this.countBy(dataset.deals, (row) => String(row.Status || 'UNKNOWN').toUpperCase());
    const values = dataset.deals.map((row) => Number(row.FinalPrice || 0)).filter((value) => Number.isFinite(value) && value > 0);

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        totalDeals: dataset.deals.length,
        confirmed: statusCounts.CONFIRMED || 0,
        agreement: dataset.deals.filter((row) => Boolean(row.AgreementDate)).length,
        registration: dataset.deals.filter((row) => Boolean(row.RegistrationDate)).length,
        completed: (statusCounts.COMPLETED || 0) + (statusCounts.CLOSED || 0),
        cancelled: statusCounts.CANCELLED || 0,
        financial: {
          totalDealValue: values.reduce((sum, value) => sum + value, 0),
          averageDealValue: values.length ? this.toMoney(values.reduce((sum, value) => sum + value, 0) / values.length) : 0,
          highestDeal: values.length ? Math.max(...values) : 0,
          lowestDeal: values.length ? Math.min(...values) : 0
        },
        dealConversionPercent: this.percent(dataset.deals.length, dataset.leads.length)
      }
    };
  }

  getCommissionAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;
    const commissions = dataset.commissions;

    const byAgentMap = {};
    for (const row of commissions) {
      const key = row.AgentID || 'UNASSIGNED';
      if (!byAgentMap[key]) byAgentMap[key] = { agentId: key, gross: 0, received: 0, pending: 0 };
      byAgentMap[key].gross += Number(row.GrossCommission || 0);
      byAgentMap[key].received += Number(row.ReceivedAmount || 0);
      byAgentMap[key].pending += Number(row.PendingAmount || 0);
    }

    const byDay = {};
    const byMonth = {};
    const byQuarter = {};
    const byYear = {};
    for (const row of commissions) {
      const key = this.getKolkataDateKey(row.CreatedAt);
      if (!key) continue;
      const [year, month] = key.split('-');
      const quarter = `Q${Math.floor((Number(month) - 1) / 3) + 1}-${year}`;
      const monthKey = `${year}-${month}`;
      byDay[key] = (byDay[key] || 0) + Number(row.GrossCommission || 0);
      byMonth[monthKey] = (byMonth[monthKey] || 0) + Number(row.GrossCommission || 0);
      byQuarter[quarter] = (byQuarter[quarter] || 0) + Number(row.GrossCommission || 0);
      byYear[year] = (byYear[year] || 0) + Number(row.GrossCommission || 0);
    }

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        grossCommission: this.sumBy(commissions, (row) => row.GrossCommission || 0),
        received: this.sumBy(commissions, (row) => row.ReceivedAmount || 0),
        pending: this.sumBy(commissions, (row) => row.PendingAmount || 0),
        partial: commissions.filter((row) => String(row.Status || '').toUpperCase() === 'PARTIAL').length,
        overdue: commissions.filter((row) => String(row.Status || '').toUpperCase() === 'OVERDUE').length,
        cancelled: commissions.filter((row) => String(row.Status || '').toUpperCase() === 'CANCELLED').length,
        byAgent: Object.values(byAgentMap).map((row) => ({
          ...row,
          gross: this.toMoney(row.gross) || 0,
          received: this.toMoney(row.received) || 0,
          pending: this.toMoney(row.pending) || 0
        })),
        byCompany: [{
          company: 'SIGNATURE_REALTY',
          gross: this.sumBy(commissions, (row) => row.CompanyShareAmount || 0),
          received: this.sumBy(commissions, (row) => Math.min(Number(row.CompanyShareAmount || 0), Number(row.ReceivedAmount || 0))),
          pending: this.sumBy(commissions, (row) => Math.max(Number(row.CompanyShareAmount || 0) - Number(row.ReceivedAmount || 0), 0))
        }],
        timeSeries: {
          daily: byDay,
          monthly: byMonth,
          quarterly: byQuarter,
          yearly: byYear
        }
      }
    };
  }

  getClosingAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;

    const statusCounts = this.countBy(dataset.closings, (row) => String(row.Status || 'UNKNOWN').toUpperCase());
    const documentsPending = dataset.closings.filter((row) => (row.Checklist || []).some((item) => String(item.ItemKey || '').toUpperCase() === 'DOCUMENTS_ARCHIVED' && String(item.Status || '').toUpperCase() !== 'COMPLETED')).length;
    const commissionPending = dataset.closings.filter((row) => (row.Checklist || []).some((item) => String(item.ItemKey || '').toUpperCase() === 'COMMISSION_SETTLED' && String(item.Status || '').toUpperCase() !== 'COMPLETED')).length;

    const completedDurations = dataset.closings
      .map((row) => {
        const start = row.StartedAt ? new Date(row.StartedAt).getTime() : NaN;
        const end = row.ClosedAt ? new Date(row.ClosedAt).getTime() : (row.CompletedAt ? new Date(row.CompletedAt).getTime() : NaN);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
        return (end - start) / (1000 * 60 * 60 * 24);
      })
      .filter((value) => Number.isFinite(value));

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        closingStarted: dataset.closings.length,
        closingPending: dataset.closings.filter((row) => !['COMPLETED', 'CLOSED'].includes(String(row.Status || '').toUpperCase())).length,
        closingCompleted: (statusCounts.COMPLETED || 0) + (statusCounts.CLOSED || 0),
        documentsPending,
        commissionPending,
        dealClosed: dataset.deals.filter((row) => String(row.Status || '').toUpperCase() === 'CLOSED').length,
        closingCompletionRate: this.percent((statusCounts.COMPLETED || 0) + (statusCounts.CLOSED || 0), dataset.closings.length),
        averageClosingTimeDays: completedDurations.length ? Math.round((completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length) * 100) / 100 : 'N/A'
      }
    };
  }

  getAgentPerformanceAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;

    const rows = {};
    const getRow = (agentId) => {
      const key = agentId || 'UNASSIGNED';
      if (!rows[key]) {
        rows[key] = {
          agentId: key,
          leads: 0,
          requirements: 0,
          matches: 0,
          shortlists: 0,
          siteVisits: 0,
          negotiations: 0,
          tokens: 0,
          deals: 0,
          completedDeals: 0,
          grossBrokerage: 0,
          receivedBrokerage: 0,
          pendingBrokerage: 0,
          conversionPercent: 0
        };
      }
      return rows[key];
    };

    const leadToAgent = {};
    for (const lead of dataset.leads) {
      leadToAgent[lead.LeadID] = lead.AssignedAgentID || 'UNASSIGNED';
      getRow(leadToAgent[lead.LeadID]).leads += 1;
    }

    for (const req of dataset.requirements) getRow(leadToAgent[req.LeadID]).requirements += 1;
    for (const match of dataset.matches) {
      const leadId = (dataset.requirements.find((req) => req.RequirementID === match.RequirementID) || {}).LeadID;
      getRow(leadToAgent[leadId]).matches += 1;
    }
    for (const shortlist of dataset.shortlists) getRow(leadToAgent[shortlist.LeadID]).shortlists += 1;
    for (const visit of dataset.siteVisits) getRow(visit.AssignedAgentID || visit.AgentID || leadToAgent[visit.LeadID]).siteVisits += 1;
    for (const negotiation of dataset.negotiations) getRow(negotiation.AssignedAgentID || leadToAgent[negotiation.LeadID]).negotiations += 1;
    for (const token of dataset.tokens) getRow(leadToAgent[token.LeadID]).tokens += 1;
    for (const deal of dataset.deals) {
      const row = getRow(leadToAgent[deal.LeadID]);
      row.deals += 1;
      if (['COMPLETED', 'CLOSED'].includes(String(deal.Status || '').toUpperCase())) row.completedDeals += 1;
      row.grossBrokerage += Number(deal.Brokerage || 0);
    }

    const dealAgentMap = {};
    for (const deal of dataset.deals) {
      dealAgentMap[deal.DealID] = leadToAgent[deal.LeadID];
    }
    for (const payment of dataset.payments) {
      const agentId = dealAgentMap[payment.DealID];
      if (!agentId) continue;
      getRow(agentId).receivedBrokerage += Number(payment.Amount || 0);
    }

    for (const row of Object.values(rows)) {
      row.grossBrokerage = this.toMoney(row.grossBrokerage) || 0;
      row.receivedBrokerage = this.toMoney(row.receivedBrokerage) || 0;
      row.pendingBrokerage = this.toMoney(Math.max(row.grossBrokerage - row.receivedBrokerage, 0)) || 0;
      row.conversionPercent = this.percent(row.deals, row.leads);
    }

    const sortBy = String(filters.sortBy || 'HighestDeals').toLowerCase();
    const sorted = Object.values(rows).sort((a, b) => {
      if (sortBy === 'highestbrokerage') return b.grossBrokerage - a.grossBrokerage;
      if (sortBy === 'highestconversion') return b.conversionPercent - a.conversionPercent;
      if (sortBy === 'mostleads') return b.leads - a.leads;
      if (sortBy === 'mostsitevisits') return b.siteVisits - a.siteVisits;
      return b.deals - a.deals;
    });

    return { ok: true, data: { filters: dataset.filters, leaderboard: sorted } };
  }

  getSourcePerformanceAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;

    const leadsById = Object.fromEntries(dataset.leads.map((lead) => [lead.LeadID, lead]));
    const rows = {};
    const getSource = (leadId) => {
      const lead = leadsById[leadId];
      return lead ? (lead.LeadSource || lead.Source || 'Manual') : 'Manual';
    };

    const getRow = (source) => {
      const key = source || 'Manual';
      if (!rows[key]) {
        rows[key] = {
          source: key,
          leads: 0,
          requirements: 0,
          matches: 0,
          shortlists: 0,
          siteVisits: 0,
          negotiations: 0,
          tokens: 0,
          deals: 0,
          revenueBrokerage: 0,
          leadToDealPercent: 0,
          leadToRevenuePercent: 0
        };
      }
      return rows[key];
    };

    for (const lead of dataset.leads) getRow(getSource(lead.LeadID)).leads += 1;
    for (const req of dataset.requirements) getRow(getSource(req.LeadID)).requirements += 1;
    for (const match of dataset.matches) {
      const req = dataset.requirements.find((item) => item.RequirementID === match.RequirementID);
      getRow(getSource(req?.LeadID)).matches += 1;
    }
    for (const row of dataset.shortlists) getRow(getSource(row.LeadID)).shortlists += 1;
    for (const row of dataset.siteVisits) getRow(getSource(row.LeadID)).siteVisits += 1;
    for (const row of dataset.negotiations) getRow(getSource(row.LeadID)).negotiations += 1;
    for (const row of dataset.tokens) getRow(getSource(row.LeadID)).tokens += 1;
    for (const row of dataset.deals) {
      const target = getRow(getSource(row.LeadID));
      target.deals += 1;
      target.revenueBrokerage += Number(row.Brokerage || 0);
    }

    const totalBrokerage = Object.values(rows).reduce((sum, row) => sum + row.revenueBrokerage, 0);
    for (const row of Object.values(rows)) {
      row.revenueBrokerage = this.toMoney(row.revenueBrokerage) || 0;
      row.leadToDealPercent = this.percent(row.deals, row.leads);
      row.leadToRevenuePercent = this.percent(row.revenueBrokerage, totalBrokerage);
    }

    return { ok: true, data: { filters: dataset.filters, sources: Object.values(rows).sort((a, b) => b.leads - a.leads) } };
  }

  getLocationAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;

    const rows = {};
    const ensure = (location) => {
      const key = location || 'UNKNOWN';
      if (!rows[key]) {
        rows[key] = {
          location: key,
          leads: 0,
          requirements: 0,
          inventory: 0,
          matches: 0,
          deals: 0,
          averageDealValue: 0,
          brokerage: 0,
          _dealValues: []
        };
      }
      return rows[key];
    };

    const requirementById = Object.fromEntries(dataset.requirements.map((item) => [item.RequirementID, item]));
    const propertyById = Object.fromEntries(dataset.inventory.map((item) => [item.PropertyID, item]));

    for (const lead of dataset.leads) ensure(lead.City || 'UNKNOWN').leads += 1;
    for (const req of dataset.requirements) ensure(req.Location1 || req.Location2 || req.Location3 || 'UNKNOWN').requirements += 1;
    for (const property of dataset.inventory) ensure(property.Location || property.City || 'UNKNOWN').inventory += 1;
    for (const match of dataset.matches) {
      const req = requirementById[match.RequirementID];
      const location = req ? (req.Location1 || req.Location2 || req.Location3 || 'UNKNOWN') : 'UNKNOWN';
      ensure(location).matches += 1;
    }
    for (const deal of dataset.deals) {
      const property = propertyById[deal.PropertyID];
      const location = property ? (property.Location || property.City || 'UNKNOWN') : 'UNKNOWN';
      const row = ensure(location);
      row.deals += 1;
      row._dealValues.push(Number(deal.FinalPrice || 0));
      row.brokerage += Number(deal.Brokerage || 0);
    }

    const output = Object.values(rows).map((row) => ({
      location: row.location,
      leads: row.leads,
      requirements: row.requirements,
      inventory: row.inventory,
      matches: row.matches,
      deals: row.deals,
      averageDealValue: row._dealValues.length ? this.toMoney(row._dealValues.reduce((sum, value) => sum + value, 0) / row._dealValues.length) : 0,
      brokerage: this.toMoney(row.brokerage) || 0
    })).sort((a, b) => b.deals - a.deals);

    return { ok: true, data: { filters: dataset.filters, locations: output } };
  }

  getBuilderAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;

    const propertyById = Object.fromEntries(dataset.inventory.map((item) => [item.PropertyID, item]));
    const rows = {};
    const ensure = (builderId, projectName) => {
      const key = `${builderId || 'UNASSIGNED'}::${projectName || 'UNASSIGNED'}`;
      if (!rows[key]) {
        rows[key] = {
          builderId: builderId || 'UNASSIGNED',
          project: projectName || 'UNASSIGNED',
          projects: 0,
          inventory: 0,
          leads: 0,
          requirements: 0,
          matches: 0,
          siteVisits: 0,
          negotiations: 0,
          tokens: 0,
          deals: 0,
          completedDeals: 0,
          brokerage: 0
        };
      }
      return rows[key];
    };

    const leadSeen = new Set();
    const reqSeen = new Set();
    const projectSeen = new Set();

    for (const property of dataset.inventory) {
      const row = ensure(property.BuilderID, property.Project);
      row.inventory += 1;
      const projectKey = `${row.builderId}::${row.project}`;
      if (!projectSeen.has(projectKey)) {
        projectSeen.add(projectKey);
        row.projects += 1;
      }
    }

    for (const deal of dataset.deals) {
      const property = propertyById[deal.PropertyID];
      const row = ensure(property?.BuilderID, property?.Project);
      row.deals += 1;
      if (['COMPLETED', 'CLOSED'].includes(String(deal.Status || '').toUpperCase())) row.completedDeals += 1;
      row.brokerage += Number(deal.Brokerage || 0);

      if (!leadSeen.has(`${row.builderId}::${deal.LeadID}`)) {
        leadSeen.add(`${row.builderId}::${deal.LeadID}`);
        row.leads += 1;
      }
    }

    for (const req of dataset.requirements) {
      const relatedProperty = dataset.inventory.find((item) => [req.Location1, req.Location2, req.Location3].includes(item.Location));
      if (!relatedProperty) continue;
      const row = ensure(relatedProperty.BuilderID, relatedProperty.Project);
      const key = `${row.builderId}::${req.RequirementID}`;
      if (!reqSeen.has(key)) {
        reqSeen.add(key);
        row.requirements += 1;
      }
    }

    for (const match of dataset.matches) {
      const property = propertyById[match.PropertyID];
      ensure(property?.BuilderID, property?.Project).matches += 1;
    }
    for (const visit of dataset.siteVisits) {
      const property = propertyById[visit.PropertyID];
      ensure(property?.BuilderID, property?.Project).siteVisits += 1;
    }
    for (const negotiation of dataset.negotiations) {
      const property = propertyById[negotiation.PropertyID];
      ensure(property?.BuilderID, property?.Project).negotiations += 1;
    }
    for (const token of dataset.tokens) {
      const property = propertyById[token.PropertyID];
      ensure(property?.BuilderID, property?.Project).tokens += 1;
    }

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        builders: Object.values(rows).map((row) => ({
          ...row,
          brokerage: this.toMoney(row.brokerage) || 0
        })).sort((a, b) => b.deals - a.deals)
      }
    };
  }

  getFinancialAnalytics(filters = {}, actor = {}) {
    const collected = this.collectReportingDataset(filters, actor);
    if (!collected.ok) return collected;
    const dataset = collected.data;

    const grossDealValue = this.sumBy(dataset.deals, (row) => row.FinalPrice || 0);
    const grossBrokerage = this.sumBy(dataset.deals, (row) => row.Brokerage || 0);
    const receivedBrokerage = this.sumBy(dataset.payments.filter((row) => String(row.PaymentType || '').toUpperCase() !== 'COMMISSION'), (row) => row.Amount || 0);
    const pendingBrokerage = this.toMoney(Math.max(grossBrokerage - receivedBrokerage, 0)) || 0;
    const commission = this.sumBy(dataset.commissions, (row) => row.GrossCommission || 0);
    const commissionReceived = this.sumBy(dataset.commissions, (row) => row.ReceivedAmount || 0);
    const commissionPending = this.sumBy(dataset.commissions, (row) => row.PendingAmount || 0);

    return {
      ok: true,
      data: {
        filters: dataset.filters,
        grossDealValue,
        grossBrokerage,
        receivedBrokerage,
        pendingBrokerage,
        commission,
        commissionReceived,
        commissionPending
      }
    };
  }

  getReportsCenter(filters = {}, actor = {}) {
    const dashboard = this.getDashboardReport(filters, actor);
    if (!dashboard.ok) return dashboard;
    const leads = this.getLeadAnalytics(filters, actor);
    const requirements = this.getRequirementAnalytics(filters, actor);
    const inventory = this.getInventoryAnalytics(filters, actor);
    const matching = this.getMatchingAnalytics(filters, actor);
    const shortlist = this.getShortlistAnalytics(filters, actor);
    const siteVisits = this.getSiteVisitAnalytics(filters, actor);
    const negotiations = this.getNegotiationAnalytics(filters, actor);
    const tokens = this.getTokenAnalytics(filters, actor);
    const deals = this.getDealAnalytics(filters, actor);
    const commission = this.getCommissionAnalytics(filters, actor);
    const closing = this.getClosingAnalytics(filters, actor);
    const agents = this.getAgentPerformanceAnalytics(filters, actor);
    const sources = this.getSourcePerformanceAnalytics(filters, actor);
    const locations = this.getLocationAnalytics(filters, actor);
    const builders = this.getBuilderAnalytics(filters, actor);
    const financial = this.getFinancialAnalytics(filters, actor);

    return {
      ok: true,
      data: {
        filters: dashboard.data.filters,
        dashboard: dashboard.data,
        leads: leads.ok ? leads.data : null,
        requirements: requirements.ok ? requirements.data : null,
        inventory: inventory.ok ? inventory.data : null,
        matching: matching.ok ? matching.data : null,
        shortlist: shortlist.ok ? shortlist.data : null,
        siteVisits: siteVisits.ok ? siteVisits.data : null,
        negotiations: negotiations.ok ? negotiations.data : null,
        tokens: tokens.ok ? tokens.data : null,
        deals: deals.ok ? deals.data : null,
        commission: commission.ok ? commission.data : null,
        closing: closing.ok ? closing.data : null,
        agents: agents.ok ? agents.data : null,
        sources: sources.ok ? sources.data : null,
        locations: locations.ok ? locations.data : null,
        builders: builders.ok ? builders.data : null,
        financial: financial.ok ? financial.data : null
      }
    };
  }

  toCsv(rows = [], columns = []) {
    const header = columns.join(',');
    const lines = rows.map((row) => columns.map((key) => {
      const value = row?.[key];
      const raw = value === undefined || value === null ? '' : String(value);
      const escaped = raw.replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(','));
    return [header, ...lines].join('\n');
  }

  exportReportCsv(type, filters = {}, actor = {}) {
    const normalizedType = String(type || '').trim().toLowerCase();

    if (normalizedType === 'leads') {
      const report = this.getLeadAnalytics(filters, actor);
      if (!report.ok) return report;
      const rows = report.data.sourceBreakdown || [];
      return { ok: true, data: this.toCsv(rows, ['leadSource', 'leads', 'deals', 'conversionPercent', 'brokerageContribution']), filename: 'leads-report.csv' };
    }

    if (normalizedType === 'requirements') {
      const collected = this.collectReportingDataset(filters, actor);
      if (!collected.ok) return collected;
      const rows = collected.data.requirements || [];
      return { ok: true, data: this.toCsv(rows, ['RequirementID', 'LeadID', 'TransactionType', 'Category', 'PropertyType', 'BudgetMin', 'BudgetMax', 'Location1', 'Status', 'CreatedAt']), filename: 'requirements-report.csv' };
    }

    if (normalizedType === 'inventory') {
      const collected = this.collectReportingDataset(filters, actor);
      if (!collected.ok) return collected;
      const rows = collected.data.inventory || [];
      return { ok: true, data: this.toCsv(rows, ['PropertyID', 'TransactionType', 'Category', 'PropertyType', 'Project', 'Location', 'City', 'Price', 'Area', 'Status']), filename: 'inventory-report.csv' };
    }

    if (normalizedType === 'deals') {
      const collected = this.collectReportingDataset(filters, actor);
      if (!collected.ok) return collected;
      const rows = collected.data.deals || [];
      return { ok: true, data: this.toCsv(rows, ['DealID', 'LeadID', 'PropertyID', 'FinalPrice', 'Brokerage', 'Status', 'AgreementDate', 'RegistrationDate', 'ClosingDate']), filename: 'deals-report.csv' };
    }

    if (normalizedType === 'commission') {
      const collected = this.collectReportingDataset(filters, actor);
      if (!collected.ok) return collected;
      const rows = collected.data.commissions || [];
      return { ok: true, data: this.toCsv(rows, ['CommissionID', 'DealID', 'LeadID', 'CommissionType', 'GrossCommission', 'ReceivedAmount', 'PendingAmount', 'Status', 'DueDate', 'ReceivedDate']), filename: 'commission-report.csv' };
    }

    if (normalizedType === 'agents') {
      const report = this.getAgentPerformanceAnalytics(filters, actor);
      if (!report.ok) return report;
      const rows = report.data.leaderboard || [];
      return { ok: true, data: this.toCsv(rows, ['agentId', 'leads', 'requirements', 'matches', 'shortlists', 'siteVisits', 'negotiations', 'tokens', 'deals', 'completedDeals', 'grossBrokerage', 'receivedBrokerage', 'pendingBrokerage', 'conversionPercent']), filename: 'agent-performance-report.csv' };
    }

    return { ok: false, error: 'Unsupported export type' };
  }

  listFollowUps(filters = {}) {
    const db = this.read();
    db.FollowUps = db.FollowUps || [];
    return db.FollowUps.filter((row) => {
      if (filters.LeadID && row.LeadID !== filters.LeadID) return false;
      if (filters.RequirementID && row.RequirementID !== filters.RequirementID) return false;
      return true;
    }).sort((a, b) => new Date(a.DueDate || a.CreatedAt).getTime() - new Date(b.DueDate || b.CreatedAt).getTime());
  }

  createFollowUp(payload = {}) {
    const db = this.read();
    db.FollowUps = db.FollowUps || [];
    const followUp = {
      FollowUpID: payload.FollowUpID || this.createId('FU'),
      LeadID: payload.LeadID || payload.leadId || null,
      RequirementID: payload.RequirementID || payload.requirementId || null,
      RelatedEntityType: payload.RelatedEntityType || payload.relatedEntityType || 'Lead',
      RelatedEntityID: payload.RelatedEntityID || payload.relatedEntityId || null,
      ActivityType: payload.ActivityType || payload.activityType || 'FOLLOW_UP',
      DueDate: payload.DueDate || payload.dueDate || new Date().toISOString(),
      Priority: payload.Priority || payload.priority || 'Medium',
      Status: payload.Status || payload.status || 'PENDING',
      Notes: payload.Notes || payload.notes || '',
      AssignedUser: payload.AssignedUser || payload.assignedUser || 'system',
      CompanyID: payload.CompanyID || payload.CompanyId || null,
      BrokerageID: payload.BrokerageID || payload.BrokerageId || null,
      CreatedBy: payload.CreatedBy || payload.createdBy || null,
      CreatedAt: payload.CreatedAt || payload.createdAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || new Date().toISOString()
    };
    db.FollowUps.push(followUp);
    this.write(db);
    return { ok: true, data: followUp };
  }

  listMedia(filters = {}) {
    const db = this.read();
    db.Media = db.Media || [];
    return db.Media.filter((row) => {
      if (filters.EntityType && row.EntityType !== filters.EntityType) return false;
      if (filters.EntityID && row.EntityID !== filters.EntityID) return false;
      if (filters.BuilderID && row.BuilderID !== filters.BuilderID) return false;
      if (filters.ProjectID && row.ProjectID !== filters.ProjectID) return false;
      if (filters.PropertyID && row.PropertyID !== filters.PropertyID) return false;
      if (filters.MediaType && row.MediaType !== filters.MediaType) return false;
      if (filters.Visibility && row.Visibility !== filters.Visibility) return false;
      if (filters.CompanyID && row.CompanyID !== filters.CompanyID) return false;
      if (filters.BrokerageID && row.BrokerageID !== filters.BrokerageID) return false;
      if (!filters.includeDeleted && row.DeletedAt) return false;
      if (!filters.includeArchived && row.ArchivedAt) return false;
      return true;
    }).sort((a, b) => String(b.CreatedAt || '').localeCompare(String(a.CreatedAt || '')));
  }

  getMedia(mediaId) {
    const db = this.read();
    db.Media = db.Media || [];
    return db.Media.find((row) => row.MediaID === mediaId) || null;
  }

  createMedia(payload = {}) {
    const db = this.read();
    db.Media = db.Media || [];
    const media = {
      MediaID: payload.MediaID || this.createId('MEDIA'),
      EntityType: payload.EntityType || payload.entityType || 'PROPERTY',
      EntityID: payload.EntityID || payload.entityId || null,
      PropertyID: payload.PropertyID || payload.propertyId || null,
      ProjectID: payload.ProjectID || payload.projectId || null,
      BuilderID: payload.BuilderID || payload.builderId || null,
      CompanyID: payload.CompanyID || payload.companyId || null,
      BrokerageID: payload.BrokerageID || payload.brokerageId || null,
      Title: payload.Title || payload.title || '',
      Description: payload.Description || payload.description || '',
      MediaType: payload.MediaType || payload.mediaType || 'IMAGE',
      StorageProvider: payload.StorageProvider || payload.storageProvider || 'TEST_PROVIDER',
      StoragePath: payload.StoragePath || payload.storagePath || '',
      ThumbnailPath: payload.ThumbnailPath || payload.thumbnailPath || '',
      MimeType: payload.MimeType || payload.mimeType || 'application/octet-stream',
      SizeBytes: Number(payload.SizeBytes ?? payload.sizeBytes ?? 0),
      Checksum: payload.Checksum || payload.checksum || '',
      Visibility: payload.Visibility || payload.visibility || 'PRIVATE',
      UploadedBy: payload.UploadedBy || payload.uploadedBy || 'system',
      CreatedAt: payload.CreatedAt || payload.createdAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || new Date().toISOString(),
      ArchivedAt: payload.ArchivedAt || payload.archivedAt || null,
      DeletedAt: payload.DeletedAt || payload.deletedAt || null
    };
    db.Media.push(media);
    this.write(db);
    return { ok: true, data: media };
  }

  archiveMedia(mediaId, payload = {}) {
    const db = this.read();
    db.Media = db.Media || [];
    const index = db.Media.findIndex((row) => row.MediaID === mediaId);
    if (index === -1) return { ok: false, error: 'Media not found' };
    const archived = {
      ...db.Media[index],
      ArchivedAt: payload.ArchivedAt || payload.archivedAt || new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    };
    db.Media[index] = archived;
    this.write(db);
    return { ok: true, data: archived };
  }

  deleteMedia(mediaId, payload = {}) {
    const db = this.read();
    db.Media = db.Media || [];
    const index = db.Media.findIndex((row) => row.MediaID === mediaId);
    if (index === -1) return { ok: false, error: 'Media not found' };
    const deleted = {
      ...db.Media[index],
      DeletedAt: payload.DeletedAt || payload.deletedAt || new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    };
    db.Media[index] = deleted;
    this.write(db);
    return { ok: true, data: deleted };
  }

  listDocuments(filters = {}) {
    const db = this.read();
    db.Documents = db.Documents || [];
    return db.Documents.filter((row) => {
      if (filters.EntityType && row.EntityType !== filters.EntityType) return false;
      if (filters.EntityID && row.EntityID !== filters.EntityID) return false;
      if (filters.BuilderID && row.BuilderID !== filters.BuilderID) return false;
      if (filters.ProjectID && row.ProjectID !== filters.ProjectID) return false;
      if (filters.PropertyID && row.PropertyID !== filters.PropertyID) return false;
      if (filters.DocumentType && row.DocumentType !== filters.DocumentType) return false;
      if (filters.Visibility && row.Visibility !== filters.Visibility) return false;
      if (filters.CompanyID && row.CompanyID !== filters.CompanyID) return false;
      if (filters.BrokerageID && row.BrokerageID !== filters.BrokerageID) return false;
      if (!filters.includeDeleted && row.DeletedAt) return false;
      if (!filters.includeArchived && row.ArchivedAt) return false;
      return true;
    }).sort((a, b) => String(b.CreatedAt || '').localeCompare(String(a.CreatedAt || '')));
  }

  getDocument(documentId) {
    const db = this.read();
    db.Documents = db.Documents || [];
    return db.Documents.find((row) => row.DocumentID === documentId) || null;
  }

  createDocument(payload = {}) {
    const db = this.read();
    db.Documents = db.Documents || [];
    const document = {
      DocumentID: payload.DocumentID || this.createId('DOC'),
      EntityType: payload.EntityType || payload.entityType || 'PROPERTY',
      EntityID: payload.EntityID || payload.entityId || null,
      PropertyID: payload.PropertyID || payload.propertyId || null,
      ProjectID: payload.ProjectID || payload.projectId || null,
      BuilderID: payload.BuilderID || payload.builderId || null,
      CompanyID: payload.CompanyID || payload.companyId || null,
      BrokerageID: payload.BrokerageID || payload.brokerageId || null,
      DocumentType: payload.DocumentType || payload.documentType || 'OTHER',
      Title: payload.Title || payload.title || '',
      Description: payload.Description || payload.description || '',
      Status: payload.Status || payload.status || 'ACTIVE',
      StorageProvider: payload.StorageProvider || payload.storageProvider || 'TEST_PROVIDER',
      StoragePath: payload.StoragePath || payload.storagePath || '',
      MimeType: payload.MimeType || payload.mimeType || 'application/octet-stream',
      SizeBytes: Number(payload.SizeBytes ?? payload.sizeBytes ?? 0),
      Checksum: payload.Checksum || payload.checksum || '',
      Visibility: payload.Visibility || payload.visibility || 'PRIVATE',
      UploadedBy: payload.UploadedBy || payload.uploadedBy || 'system',
      CreatedAt: payload.CreatedAt || payload.createdAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || new Date().toISOString(),
      ArchivedAt: payload.ArchivedAt || payload.archivedAt || null,
      DeletedAt: payload.DeletedAt || payload.deletedAt || null
    };
    db.Documents.push(document);
    this.write(db);
    return { ok: true, data: document };
  }

  archiveDocument(documentId, payload = {}) {
    const db = this.read();
    db.Documents = db.Documents || [];
    const index = db.Documents.findIndex((row) => row.DocumentID === documentId);
    if (index === -1) return { ok: false, error: 'Document not found' };
    const archived = {
      ...db.Documents[index],
      ArchivedAt: payload.ArchivedAt || payload.archivedAt || new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    };
    db.Documents[index] = archived;
    this.write(db);
    return { ok: true, data: archived };
  }

  deleteDocument(documentId, payload = {}) {
    const db = this.read();
    db.Documents = db.Documents || [];
    const index = db.Documents.findIndex((row) => row.DocumentID === documentId);
    if (index === -1) return { ok: false, error: 'Document not found' };
    const deleted = {
      ...db.Documents[index],
      DeletedAt: payload.DeletedAt || payload.deletedAt || new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    };
    db.Documents[index] = deleted;
    this.write(db);
    return { ok: true, data: deleted };
  }

  listOwners() {
    const db = this.read();
    db.Owners = db.Owners || [];
    return db.Owners;
  }

  createOwner(payload = {}, actor = {}) {
    const db = this.read();
    db.Owners = db.Owners || [];
    const owner = {
      OwnerID: payload.OwnerID || this.createId('OWN'),
      Name: payload.Name || payload.name || '',
      Mobile: payload.Mobile || payload.mobile || '',
      Email: payload.Email || payload.email || '',
      Address: payload.Address || payload.address || '',
      Documents: payload.Documents || payload.documents || [],
      Properties: payload.Properties || payload.properties || [],
      ExpectedPrice: payload.ExpectedPrice ?? payload.expectedPrice ?? null,
      AskingPrice: payload.AskingPrice ?? payload.askingPrice ?? null,
      Brokerage: payload.Brokerage ?? payload.brokerage ?? 0,
      Notes: payload.Notes || payload.notes || '',
      CompanyID: actor.companyId || actor.companyID || null,
      BrokerageID: actor.brokerageId || actor.brokerageID || null,
      CreatedBy: actor.userId || actor.userID || null,
      CreatedAt: payload.CreatedAt || payload.createdAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || new Date().toISOString()
    };
    db.Owners.push(owner);
    this.write(db);
    return { ok: true, data: owner };
  }

  listBuilders() {
    const db = this.read();
    db.Builders = db.Builders || [];
    return db.Builders;
  }

  createBuilder(payload = {}, actor = {}) {
    const db = this.read();
    db.Builders = db.Builders || [];
    const builder = {
      BuilderID: payload.BuilderID || this.createId('BLD'),
      Name: payload.Name || payload.name || '',
      Mobile: payload.Mobile || payload.mobile || '',
      Email: payload.Email || payload.email || '',
      Projects: payload.Projects || payload.projects || [],
      CompanyID: actor.companyId || actor.companyID || null,
      BrokerageID: actor.brokerageId || actor.brokerageID || null,
      CreatedBy: actor.userId || actor.userID || null,
      CreatedAt: payload.CreatedAt || payload.createdAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || new Date().toISOString()
    };
    db.Builders.push(builder);
    this.write(db);
    return { ok: true, data: builder };
  }

  listProjects() {
    const db = this.read();
    db.Projects = db.Projects || [];
    return db.Projects;
  }

  createProject(payload = {}, actor = {}) {
    const db = this.read();
    db.Projects = db.Projects || [];
    const project = {
      ProjectID: payload.ProjectID || this.createId('PRJ'),
      BuilderID: payload.BuilderID || payload.builderId || null,
      ProjectName: payload.ProjectName || payload.projectName || '',
      RERA: payload.RERA || payload.rera || '',
      Location: payload.Location || payload.location || '',
      Possession: payload.Possession || payload.possession || '',
      Description: payload.Description || payload.description || '',
      Amenities: payload.Amenities || payload.amenities || [],
      Brochure: payload.Brochure || payload.brochure || '',
      FloorPlans: payload.FloorPlans || payload.floorPlans || [],
      Media: payload.Media || payload.media || [],
      VirtualTour: payload.VirtualTour || payload.virtualTour || '',
      Visibility: payload.Visibility || payload.visibility || 'PRIVATE',
      CompanyID: actor.companyId || actor.companyID || null,
      BrokerageID: actor.brokerageId || actor.brokerageID || null,
      CreatedBy: actor.userId || actor.userID || null,
      CreatedAt: payload.CreatedAt || payload.createdAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || payload.updatedAt || new Date().toISOString()
    };
    db.Projects.push(project);
    this.write(db);
    return { ok: true, data: project };
  }

  getTimeline(leadId) {
    const db = this.read();
    db.Timeline = db.Timeline || [];
    return db.Timeline.filter((row) => row.LeadID === leadId).sort((a, b) => new Date(b.EventDate).getTime() - new Date(a.EventDate).getTime());
  }

  safeClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  normalizeStoredIdentifier(value) {
    const trimmed = String(value ?? '').trim();
    const quoted = trimmed.match(/^(['"])(.*)\1$/);
    return quoted ? String(quoted[2] || '').trim() : trimmed;
  }

  normalizeUserRecord(user = {}) {
    if (!user || typeof user !== 'object') return user;
    const normalized = { ...user };
    const canonicalUserId = this.normalizeStoredIdentifier(user.UserID ?? user.userId ?? user.userID ?? user.id ?? '');
    if (canonicalUserId) normalized.UserID = canonicalUserId;

    const companyId = this.normalizeStoredIdentifier(user.CompanyID ?? user.CompanyId ?? '');
    if (companyId) normalized.CompanyID = companyId;

    const brokerageId = this.normalizeStoredIdentifier(user.BrokerageID ?? user.BrokerageId ?? '');
    if (brokerageId) normalized.BrokerageID = brokerageId;

    if (normalized.Email !== undefined) normalized.Email = String(normalized.Email || '').trim().toLowerCase();
    if (normalized.Mobile !== undefined) normalized.Mobile = String(normalized.Mobile || '').trim();
    if (normalized.Name !== undefined) normalized.Name = String(normalized.Name || '').trim();
    if (normalized.Role !== undefined) normalized.Role = String(normalized.Role || '').trim().toUpperCase();
    if (normalized.Status !== undefined) normalized.Status = String(normalized.Status || '').trim();
    if (normalized.Permissions !== undefined) {
      normalized.Permissions = Array.from(new Set((normalized.Permissions || []).map((item) => String(item).trim()).filter(Boolean)));
    }
    return normalized;
  }

  findUserIndexById(users = [], userId) {
    const requested = this.normalizeStoredIdentifier(userId);
    if (!requested) return -1;
    const matchIndex = users.findIndex((row) => this.normalizeStoredIdentifier(row?.UserID ?? row?.userId ?? row?.userID ?? row?.id ?? '') === requested);
    if (matchIndex !== -1) return matchIndex;
    if (!/^usr[-_]/i.test(requested)) return -1;
    const folded = requested.toUpperCase();
    return users.findIndex((row) => this.normalizeStoredIdentifier(row?.UserID ?? row?.userId ?? row?.userID ?? row?.id ?? '').toUpperCase() === folded);
  }

  ensureAdminCollections(db) {
    db.Users = (db.Users || []).map((user) => this.normalizeUserRecord(user));
    db.Roles = db.Roles || [];
    db.Permissions = db.Permissions || [];
    db.Audit = db.Audit || [];
    db.Settings = db.Settings || [];
    db.Masters = db.Masters || [];
    db.PipelineConfig = db.PipelineConfig || [];
    db.Notifications = db.Notifications || [];
    db.Backups = db.Backups || [];
    db.ConfigurationHistory = db.ConfigurationHistory || [];
    db.FormConfig = db.FormConfig || [];
    db.FormRegistry = db.FormRegistry || [];
    return db;
  }

  getPermissionCatalog() {
    return [
      { PermissionID: 'PERM-ADMIN-VIEW', PermissionCode: 'ADMIN_VIEW', Module: 'Admin', Action: 'VIEW', Scope: 'SYSTEM', Description: 'View admin center' },
      { PermissionID: 'PERM-USER-MANAGE', PermissionCode: 'USERS_MANAGE', Module: 'Users', Action: 'MANAGE', Scope: 'SYSTEM', Description: 'Manage users' },
      { PermissionID: 'PERM-ROLE-MANAGE', PermissionCode: 'ROLES_MANAGE', Module: 'Roles', Action: 'MANAGE', Scope: 'SYSTEM', Description: 'Manage roles' },
      { PermissionID: 'PERM-PERM-MANAGE', PermissionCode: 'PERMISSIONS_MANAGE', Module: 'Permissions', Action: 'MANAGE', Scope: 'SYSTEM', Description: 'Manage permissions' },
      { PermissionID: 'PERM-SETTINGS-MANAGE', PermissionCode: 'SETTINGS_MANAGE', Module: 'Settings', Action: 'MANAGE', Scope: 'SYSTEM', Description: 'Manage system settings' },
      { PermissionID: 'PERM-MASTERS-MANAGE', PermissionCode: 'MASTERS_MANAGE', Module: 'Masters', Action: 'MANAGE', Scope: 'SYSTEM', Description: 'Manage master data' },
      { PermissionID: 'PERM-BROCHURE-MIGRATION-MANAGE', PermissionCode: 'BROCHURE_MIGRATION_MANAGE', Module: 'BrochureMigration', Action: 'MANAGE', Scope: 'SYSTEM', Description: 'Run brochure object-storage migration batches' },
      { PermissionID: 'PERM-PIPELINE-MANAGE', PermissionCode: 'PIPELINE_MANAGE', Module: 'Pipeline', Action: 'MANAGE', Scope: 'SYSTEM', Description: 'Manage pipeline configuration' },
      { PermissionID: 'PERM-FORMS-MANAGE', PermissionCode: 'FORMS_MANAGE', Module: 'Forms', Action: 'MANAGE', Scope: 'SYSTEM', Description: 'Manage dynamic forms' },
      { PermissionID: 'PERM-NOTIFICATIONS-MANAGE', PermissionCode: 'NOTIFICATIONS_MANAGE', Module: 'Notifications', Action: 'MANAGE', Scope: 'SYSTEM', Description: 'Manage notifications' },
      { PermissionID: 'PERM-AUDIT-VIEW', PermissionCode: 'AUDIT_VIEW', Module: 'Audit', Action: 'VIEW', Scope: 'SYSTEM', Description: 'View audit logs' },
      { PermissionID: 'PERM-BACKUP-MANAGE', PermissionCode: 'BACKUP_MANAGE', Module: 'Backup', Action: 'MANAGE', Scope: 'SYSTEM', Description: 'Manage backup and restore' },
      { PermissionID: 'PERM-HEALTH-VIEW', PermissionCode: 'HEALTH_VIEW', Module: 'Health', Action: 'VIEW', Scope: 'SYSTEM', Description: 'View system health' },
      { PermissionID: 'PERM-MAINTENANCE-VIEW', PermissionCode: 'MAINTENANCE_VIEW', Module: 'Maintenance', Action: 'VIEW', Scope: 'SYSTEM', Description: 'View maintenance diagnostics' },
      { PermissionID: 'PERM-REPORTS-VIEW', PermissionCode: 'REPORTS_VIEW', Module: 'Reports', Action: 'VIEW', Scope: 'TEAM', Description: 'View reports' },
      { PermissionID: 'PERM-REPORTS-EXPORT', PermissionCode: 'REPORTS_EXPORT', Module: 'Reports', Action: 'EXPORT', Scope: 'TEAM', Description: 'Export reports' },
      { PermissionID: 'PERM-LEADS-MANAGE', PermissionCode: 'LEADS_MANAGE', Module: 'Leads', Action: 'MANAGE', Scope: 'TEAM', Description: 'Manage leads' },
      { PermissionID: 'PERM-LEADS-VIEW', PermissionCode: 'LEADS_VIEW', Module: 'Leads', Action: 'VIEW', Scope: 'TEAM', Description: 'View leads' },
      { PermissionID: 'PERM-LEADS-CREATE', PermissionCode: 'LEADS_CREATE', Module: 'Leads', Action: 'CREATE', Scope: 'TEAM', Description: 'Create leads' },
      { PermissionID: 'PERM-LEADS-EDIT', PermissionCode: 'LEADS_EDIT', Module: 'Leads', Action: 'EDIT', Scope: 'TEAM', Description: 'Edit leads' },
      { PermissionID: 'PERM-LEADS-EXPORT', PermissionCode: 'LEADS_EXPORT', Module: 'Leads', Action: 'EXPORT', Scope: 'TEAM', Description: 'Export leads' },
      { PermissionID: 'PERM-REQUIREMENTS-VIEW', PermissionCode: 'REQUIREMENTS_VIEW', Module: 'Requirements', Action: 'VIEW', Scope: 'TEAM', Description: 'View requirements' },
      { PermissionID: 'PERM-REQUIREMENTS-CREATE', PermissionCode: 'REQUIREMENTS_CREATE', Module: 'Requirements', Action: 'CREATE', Scope: 'TEAM', Description: 'Create requirements' },
      { PermissionID: 'PERM-REQUIREMENTS-EDIT', PermissionCode: 'REQUIREMENTS_EDIT', Module: 'Requirements', Action: 'EDIT', Scope: 'TEAM', Description: 'Edit requirements' },
      { PermissionID: 'PERM-INVENTORY-VIEW', PermissionCode: 'INVENTORY_VIEW', Module: 'Inventory', Action: 'VIEW', Scope: 'TEAM', Description: 'View inventory' },
      { PermissionID: 'PERM-MATCHING-VIEW', PermissionCode: 'MATCHING_VIEW', Module: 'Matching', Action: 'VIEW', Scope: 'TEAM', Description: 'View matching' },
      { PermissionID: 'PERM-SHORTLIST-VIEW', PermissionCode: 'SHORTLIST_VIEW', Module: 'Shortlist', Action: 'VIEW', Scope: 'TEAM', Description: 'View shortlist' },
      { PermissionID: 'PERM-SITE-VIEW', PermissionCode: 'SITE_VISIT_VIEW', Module: 'Site Visit', Action: 'VIEW', Scope: 'TEAM', Description: 'View site visits' },
      { PermissionID: 'PERM-NEGOTIATION-VIEW', PermissionCode: 'NEGOTIATION_VIEW', Module: 'Negotiation', Action: 'VIEW', Scope: 'TEAM', Description: 'View negotiations' },
      { PermissionID: 'PERM-TOKEN-VIEW', PermissionCode: 'TOKEN_VIEW', Module: 'Token', Action: 'VIEW', Scope: 'TEAM', Description: 'View tokens' },
      { PermissionID: 'PERM-DEAL-VIEW', PermissionCode: 'DEAL_VIEW', Module: 'Deal', Action: 'VIEW', Scope: 'TEAM', Description: 'View deals' },
      { PermissionID: 'PERM-COMMISSION-VIEW', PermissionCode: 'COMMISSION_VIEW', Module: 'Commission', Action: 'VIEW', Scope: 'TEAM', Description: 'View commissions' },
      { PermissionID: 'PERM-CLOSING-VIEW', PermissionCode: 'CLOSING_VIEW', Module: 'Closing', Action: 'VIEW', Scope: 'TEAM', Description: 'View closing workflow' }
    ];
  }

  getDefaultRoles() {
    return [
      { RoleID: 'ROLE-ADMIN', Name: 'ADMIN', Description: 'Full system access', Permissions: ['*'], Status: 'Active', SystemRole: true },
      { RoleID: 'ROLE-MANAGER', Name: 'MANAGER', Description: 'Team and business control', Permissions: ['ADMIN_VIEW', 'REPORTS_VIEW', 'REPORTS_EXPORT', 'LEADS_VIEW', 'LEADS_CREATE', 'LEADS_EDIT', 'LEADS_EXPORT', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_CREATE', 'REQUIREMENTS_EDIT', 'INVENTORY_VIEW', 'MATCHING_VIEW', 'SHORTLIST_VIEW', 'SITE_VISIT_VIEW', 'NEGOTIATION_VIEW', 'TOKEN_VIEW', 'DEAL_VIEW', 'COMMISSION_VIEW', 'CLOSING_VIEW', 'AUDIT_VIEW', 'HEALTH_VIEW', 'MAINTENANCE_VIEW'], Status: 'Active', SystemRole: true },
      { RoleID: 'ROLE-AGENT', Name: 'AGENT', Description: 'Operational access', Permissions: ['REPORTS_VIEW', 'LEADS_VIEW', 'LEADS_CREATE', 'LEADS_EDIT', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_CREATE', 'REQUIREMENTS_EDIT', 'INVENTORY_VIEW', 'MATCHING_VIEW', 'SHORTLIST_VIEW', 'SITE_VISIT_VIEW', 'NEGOTIATION_VIEW', 'TOKEN_VIEW', 'DEAL_VIEW'], Status: 'Active', SystemRole: true }
    ];
  }

  getDefaultSettingsValue() {
    return {
      CompanyName: 'Signature Realty',
      ApplicationName: 'Signature Realty OS',
      Timezone: 'Asia/Kolkata',
      DateFormat: 'YYYY-MM-DD',
      Currency: 'INR',
      DefaultCountry: 'India',
      DefaultState: 'Karnataka',
      DefaultCity: 'Bengaluru',
      DefaultPageSize: 25,
      SessionTimeoutMinutes: 60,
      CacheDurationMinutes: 15,
      ConfigurationVersion: 1,
      NotificationSettings: { InApp: true, Email: false, WhatsApp: false },
      Security: { SessionTimeoutMinutes: 60, LoginAttemptLimit: 5, LockoutDurationMinutes: 15 },
      Business: {
        DefaultBrokeragePercent: 2,
        DefaultCommissionPercent: 2,
        HotLeadThreshold: 75,
        LeadScoringThreshold: 60,
        TokenRules: { RequiredForAgreement: true },
        DealRules: { RequireCommissionBeforeClose: true },
        ClosingRules: { RequireChecklistCompletion: true },
        FollowUpDefaults: { DueInDays: 2 },
        PipelineStages: {
          Lead: ['New', 'Verified', 'Active', 'Inactive', 'Blacklisted'],
          Requirement: ['Active', 'Matched', 'On Hold', 'Closed', 'Cancelled'],
          Matching: ['Open', 'Matched'],
          Shortlist: ['Active', 'Removed'],
          SiteVisit: ['Scheduled', 'Confirmed', 'Rescheduled', 'Completed', 'Cancelled', 'NoShow'],
          Negotiation: ['OPEN', 'OFFER_MADE', 'COUNTER_OFFER', 'NEGOTIATING', 'AGREED', 'TOKEN_PENDING', 'TOKEN_RECEIVED', 'AGREEMENT_PENDING', 'AGREEMENT_DONE', 'REGISTRATION_PENDING', 'COMPLETED', 'CANCELLED', 'FAILED', 'ON_HOLD'],
          Token: ['PENDING', 'PARTIAL', 'PAID', 'CANCELLED', 'REFUNDED', 'EXPIRED'],
          Deal: ['OPEN', 'COMPLETED', 'CLOSED', 'CANCELLED'],
          Commission: ['PENDING', 'PARTIAL', 'RECEIVED', 'OVERDUE', 'CANCELLED'],
          Closing: ['IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED']
        }
      }
    };
  }

  getDefaultMasters() {
    return [
      { MasterID: 'MST-SOURCE-MANUAL', MasterType: 'LeadSources', Value: 'Manual', Label: 'Manual', Active: true, UsedCount: 0, Metadata: {} },
      { MasterID: 'MST-SOURCE-REFERENCE', MasterType: 'LeadSources', Value: 'Reference', Label: 'Reference', Active: true, UsedCount: 0, Metadata: {} },
      { MasterID: 'MST-CATEGORY-RES', MasterType: 'Categories', Value: 'Residential', Label: 'Residential', Active: true, UsedCount: 0, Metadata: {} },
      { MasterID: 'MST-CATEGORY-COM', MasterType: 'Categories', Value: 'Commercial', Label: 'Commercial', Active: true, UsedCount: 0, Metadata: {} },
      { MasterID: 'MST-TYPE-PURCHASE', MasterType: 'TransactionTypes', Value: 'Purchase', Label: 'Purchase', Active: true, UsedCount: 0, Metadata: {} },
      { MasterID: 'MST-TYPE-SALE', MasterType: 'TransactionTypes', Value: 'Sale', Label: 'Sale', Active: true, UsedCount: 0, Metadata: {} }
    ];
  }

  getDefaultPipelineConfig() {
    const settings = this.getDefaultSettingsValue();
    return settings.Business.PipelineStages;
  }

  getDefaultNotificationSettings() {
    return this.getDefaultSettingsValue().NotificationSettings;
  }

  getDefaultFormRegistrySnapshot() {
    const { formRegistry } = require('./schema');
    return this.safeClone(formRegistry);
  }

  getCurrentSettingsRecord() {
    const db = this.ensureAdminCollections(this.read());
    const record = db.Settings.find((row) => row.Key === 'global') || db.Settings[0] || null;
    if (record) return record;

    const created = {
      SettingsID: 'SETTINGS-DEFAULT',
      Key: 'global',
      Value: this.getDefaultSettingsValue(),
      Version: 1,
      UpdatedAt: new Date().toISOString()
    };
    db.Settings.push(created);
    this.write(db);
    return created;
  }

  getSettings() {
    const record = this.getCurrentSettingsRecord();
    return this.safeClone(record?.Value || this.getDefaultSettingsValue());
  }

  updateSettings(changes = {}, actor = {}) {
    const db = this.ensureAdminCollections(this.read());
    const current = db.Settings.find((row) => row.Key === 'global') || this.getCurrentSettingsRecord();
    const before = this.safeClone(current.Value || this.getDefaultSettingsValue());
    const next = {
      ...before,
      ...this.safeClone(changes),
      NotificationSettings: {
        ...before.NotificationSettings,
        ...(changes.NotificationSettings || {})
      },
      Security: {
        ...before.Security,
        ...(changes.Security || {})
      },
      Business: {
        ...before.Business,
        ...(changes.Business || {})
      }
    };
    next.ConfigurationVersion = Number(before.ConfigurationVersion || 1) + 1;
    const updated = {
      ...current,
      Value: next,
      Version: next.ConfigurationVersion,
      UpdatedAt: new Date().toISOString()
    };
    const index = db.Settings.findIndex((row) => row.Key === 'global');
    if (index === -1) {
      db.Settings.push(updated);
    } else {
      db.Settings[index] = updated;
    }

    db.ConfigurationHistory.push({
      ConfigurationHistoryID: this.createId('CONFH'),
      Scope: 'Settings',
      ScopeID: updated.SettingsID,
      Version: updated.Version,
      Before: before,
      After: next,
      CreatedAt: new Date().toISOString()
    });

    this.recordAudit(db, {
      action: 'SETTING_CHANGED',
      module: 'Settings',
      entityType: 'Settings',
      entityId: updated.SettingsID,
      before,
      after: next,
      actor,
      result: 'SUCCESS'
    });

    this.write(db);
    return { ok: true, data: this.safeClone(next) };
  }

  getRoles() {
    const db = this.ensureAdminCollections(this.read());
    if (!db.Roles.length) {
      db.Roles = this.getDefaultRoles().map((role) => ({
        ...role,
        CreatedAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString()
      }));
      this.write(db);
    }
    return db.Roles;
  }

  getRole(roleName) {
    const normalized = String(roleName || '').trim().toUpperCase();
    return this.getRoles().find((row) => String(row.Name || '').trim().toUpperCase() === normalized) || null;
  }

  saveRole(payload = {}, actor = {}) {
    const db = this.ensureAdminCollections(this.read());
    const name = String(payload.Name || payload.name || '').trim().toUpperCase();
    if (!name) return { ok: false, error: 'Role name is required' };
    const permissions = Array.from(new Set((payload.Permissions || payload.permissions || []).map((item) => String(item).trim()).filter(Boolean)));
    const description = payload.Description || payload.description || '';
    const isSystemRole = Boolean(payload.SystemRole || payload.systemRole || false);

    const existing = db.Roles.find((row) => String(row.Name || '').trim().toUpperCase() === name);
    const before = existing ? this.safeClone(existing) : null;
    const next = {
      RoleID: existing?.RoleID || this.createId('ROLE'),
      Name: name,
      Description: description,
      Permissions: permissions.length ? permissions : (existing?.Permissions || []),
      Status: payload.Status || payload.status || existing?.Status || 'Active',
      SystemRole: existing?.SystemRole ?? isSystemRole,
      CreatedAt: existing?.CreatedAt || new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    };

    if (existing) {
      Object.assign(existing, next);
    } else {
      db.Roles.push(next);
    }

    this.recordAudit(db, {
      action: existing ? 'ROLE_CHANGED' : 'ROLE_CREATED',
      module: 'Roles',
      entityType: 'Role',
      entityId: next.RoleID,
      before,
      after: next,
      actor,
      result: 'SUCCESS'
    });

    this.write(db);
    return { ok: true, data: this.safeClone(next) };
  }

  getPermissions() {
    const db = this.ensureAdminCollections(this.read());
    if (!db.Permissions.length) {
      db.Permissions = this.getPermissionCatalog().map((item) => ({ ...item, Active: true }));
      this.write(db);
    }
    return db.Permissions;
  }

  getUser(userId) {
    const db = this.ensureAdminCollections(this.read());
    const index = this.findUserIndexById(db.Users, userId);
    return index === -1 ? null : db.Users[index];
  }

  listUsers() {
    const db = this.ensureAdminCollections(this.read());
    return db.Users.slice().sort((a, b) => String(a.Name || '').localeCompare(String(b.Name || '')));
  }

  createUser(payload = {}, actor = {}) {
    const db = this.ensureAdminCollections(this.read());
    const name = String(payload.Name || payload.name || '').trim();
    const email = String(payload.Email || payload.email || '').trim().toLowerCase();
    const mobile = String(payload.Mobile || payload.mobile || '').trim();
    const role = String(payload.Role || payload.role || 'AGENT').trim().toUpperCase();
    const status = String(payload.Status || payload.status || 'Active').trim();
    const userId = this.normalizeStoredIdentifier(payload.UserID || payload.userId || payload.userID || '') || this.createId('USR');
    const companyId = this.normalizeStoredIdentifier(payload.CompanyID || payload.CompanyId || payload.companyId || payload.companyID || '');
    const brokerageId = this.normalizeStoredIdentifier(payload.BrokerageID || payload.BrokerageId || payload.brokerageId || payload.brokerageID || '');
    if (!name || !email) return { ok: false, error: 'Name and email are required' };
    if (db.Users.some((row) => String(row.Email || '').trim().toLowerCase() === email)) {
      return { ok: false, error: 'Email already exists' };
    }
    if (this.findUserIndexById(db.Users, userId) !== -1) {
      return { ok: false, error: 'UserID already exists' };
    }

    const user = {
      UserID: userId,
      Name: name,
      Mobile: mobile,
      Role: role,
      Email: email,
      Status: status,
      CompanyID: companyId || undefined,
      BrokerageID: brokerageId || undefined,
      Permissions: Array.from(new Set((payload.Permissions || payload.permissions || []).map((item) => String(item).trim()).filter(Boolean))),
      CreatedAt: payload.CreatedAt || new Date().toISOString(),
      UpdatedAt: payload.UpdatedAt || new Date().toISOString(),
      LastLoginAt: payload.LastLoginAt || null,
      DisabledAt: null,
      Notes: payload.Notes || payload.notes || ''
    };
    db.Users.push(this.normalizeUserRecord(user));

    this.recordAudit(db, {
      action: 'USER_CREATED',
      module: 'Users',
      entityType: 'User',
      entityId: user.UserID,
      before: null,
      after: user,
      actor,
      result: 'SUCCESS'
    });

    this.write(db);
    return { ok: true, data: this.safeClone(user) };
  }

  updateUser(userId, payload = {}, actor = {}) {
    const db = this.ensureAdminCollections(this.read());
    const index = this.findUserIndexById(db.Users, userId);
    if (index === -1) return { ok: false, error: 'User not found' };
    const existing = db.Users[index];
    const before = this.safeClone(existing);
    const updated = this.normalizeUserRecord({
      ...existing,
      Name: payload.Name || payload.name || existing.Name,
      Mobile: payload.Mobile || payload.mobile || existing.Mobile,
      Email: (payload.Email || payload.email || existing.Email || '').trim().toLowerCase(),
      Role: String(payload.Role || payload.role || existing.Role || 'AGENT').trim().toUpperCase(),
      Status: payload.Status || payload.status || existing.Status,
      CompanyID: payload.CompanyID ?? payload.CompanyId ?? payload.companyId ?? payload.companyID ?? existing.CompanyID ?? existing.CompanyId,
      BrokerageID: payload.BrokerageID ?? payload.BrokerageId ?? payload.brokerageId ?? payload.brokerageID ?? existing.BrokerageID ?? existing.BrokerageId,
      Permissions: payload.Permissions || payload.permissions ? Array.from(new Set((payload.Permissions || payload.permissions || []).map((item) => String(item).trim()).filter(Boolean))) : existing.Permissions || [],
      LastLoginAt: payload.LastLoginAt || payload.lastLoginAt || existing.LastLoginAt || null,
      UpdatedAt: new Date().toISOString(),
      Notes: payload.Notes || payload.notes || existing.Notes || ''
    });
    db.Users[index] = updated;

    this.recordAudit(db, {
      action: 'USER_UPDATED',
      module: 'Users',
      entityType: 'User',
      entityId: userId,
      before,
      after: updated,
      actor,
      result: 'SUCCESS'
    });

    this.write(db);
    return { ok: true, data: this.safeClone(updated) };
  }

  updateUserStatus(userId, status, actor = {}) {
    const db = this.ensureAdminCollections(this.read());
    const index = this.findUserIndexById(db.Users, userId);
    if (index === -1) return { ok: false, error: 'User not found' };
    const normalized = String(status || '').trim();
    if (!['Active', 'Inactive', 'Disabled', 'Invited'].includes(normalized)) {
      return { ok: false, error: 'Invalid user status' };
    }
    const existing = db.Users[index];
    const before = this.safeClone(existing);
    const updated = {
      ...existing,
      Status: normalized,
      DisabledAt: normalized === 'Inactive' || normalized === 'Disabled' ? new Date().toISOString() : null,
      UpdatedAt: new Date().toISOString()
    };
    db.Users[index] = updated;

    this.recordAudit(db, {
      action: normalized === 'Active' ? 'USER_ACTIVATED' : 'USER_DISABLED',
      module: 'Users',
      entityType: 'User',
      entityId: userId,
      before,
      after: updated,
      actor,
      result: 'SUCCESS'
    });

    this.write(db);
    return { ok: true, data: this.safeClone(updated) };
  }

  updateUserRole(userId, role, actor = {}) {
    return this.updateUser(userId, { Role: role }, actor);
  }

  updateUserPermissions(userId, permissions = [], actor = {}) {
    return this.updateUser(userId, { Permissions: permissions }, actor);
  }

  getMasterCatalog() {
    return ['LeadSources', 'Categories', 'Subcategories', 'PropertyTypes', 'BHK', 'Furnishing', 'TransactionTypes', 'RequirementStatuses', 'LeadStatuses', 'PropertyStatuses', 'DealStatuses', 'NegotiationStatuses', 'TokenStatuses', 'CommissionStatuses', 'ClosingStatuses', 'Locations', 'Builders', 'Projects'];
  }

  listMasters(filters = {}) {
    const db = this.ensureAdminCollections(this.read());
    const type = filters.masterType || filters.type || null;
    const active = filters.active;
    return db.Masters.filter((row) => {
      if (type && row.MasterType !== type) return false;
      if (active !== undefined && active !== null) {
        const desired = String(active).toLowerCase() !== 'false';
        if (Boolean(row.Active) !== desired) return false;
      }
      return true;
    }).sort((a, b) => String(a.MasterType || '').localeCompare(String(b.MasterType || '')) || String(a.Label || a.Value || '').localeCompare(String(b.Label || b.Value || '')));
  }

  createMaster(payload = {}, actor = {}) {
    const db = this.ensureAdminCollections(this.read());
    const masterType = String(payload.MasterType || payload.masterType || '').trim();
    const value = String(payload.Value || payload.value || '').trim();
    if (!masterType || !value) return { ok: false, error: 'MasterType and Value are required' };
    const duplicate = db.Masters.find((row) => row.MasterType === masterType && String(row.Value || '').trim().toLowerCase() === value.toLowerCase());
    if (duplicate) return { ok: false, error: 'Master value already exists' };

    const master = {
      MasterID: payload.MasterID || this.createId('MST'),
      MasterType: masterType,
      Value: value,
      Label: payload.Label || payload.label || value,
      Active: payload.Active !== undefined ? Boolean(payload.Active) : true,
      UsedCount: Number(payload.UsedCount || payload.usedCount || 0),
      Metadata: payload.Metadata || payload.metadata || {},
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    };
    db.Masters.push(master);

    this.recordAudit(db, {
      action: 'MASTER_UPDATED',
      module: 'Masters',
      entityType: 'Master',
      entityId: master.MasterID,
      before: null,
      after: master,
      actor,
      result: 'SUCCESS'
    });

    this.write(db);
    return { ok: true, data: this.safeClone(master) };
  }

  updateMaster(masterId, payload = {}, actor = {}) {
    const db = this.ensureAdminCollections(this.read());
    const index = db.Masters.findIndex((row) => row.MasterID === masterId);
    if (index === -1) return { ok: false, error: 'Master not found' };
    const existing = db.Masters[index];
    const before = this.safeClone(existing);
    const updated = {
      ...existing,
      Label: payload.Label || payload.label || existing.Label,
      Value: payload.Value || payload.value || existing.Value,
      Metadata: payload.Metadata || payload.metadata || existing.Metadata || {},
      Active: payload.Active !== undefined ? Boolean(payload.Active) : existing.Active,
      UpdatedAt: new Date().toISOString()
    };
    db.Masters[index] = updated;

    this.recordAudit(db, {
      action: 'MASTER_UPDATED',
      module: 'Masters',
      entityType: 'Master',
      entityId: masterId,
      before,
      after: updated,
      actor,
      result: 'SUCCESS'
    });

    this.write(db);
    return { ok: true, data: this.safeClone(updated) };
  }

  deactivateMaster(masterId, actor = {}) {
    return this.updateMaster(masterId, { Active: false }, actor);
  }

  getPipelineConfig() {
    const db = this.ensureAdminCollections(this.read());
    if (!db.PipelineConfig.length) {
      const defaults = this.getDefaultPipelineConfig();
      for (const [module, stages] of Object.entries(defaults)) {
        db.PipelineConfig.push({
          PipelineConfigID: this.createId('PLC'),
          Module: module,
          Stages: stages,
          Transitions: [],
          Version: 1,
          Active: true,
          CreatedAt: new Date().toISOString(),
          UpdatedAt: new Date().toISOString()
        });
      }
      this.write(db);
    }
    return db.PipelineConfig;
  }

  updatePipelineConfig(payload = {}, actor = {}) {
    const db = this.ensureAdminCollections(this.read());
    const updates = Array.isArray(payload.modules) ? payload.modules : (payload.modules ? [payload.modules] : []);
    const before = this.safeClone(db.PipelineConfig);
    if (updates.length === 0) {
      return { ok: false, error: 'modules required' };
    }

    const nextRows = [];
    for (const moduleConfig of updates) {
      const module = String(moduleConfig.Module || moduleConfig.module || '').trim();
      const stages = Array.isArray(moduleConfig.Stages || moduleConfig.stages) ? (moduleConfig.Stages || moduleConfig.stages).map((item) => String(item).trim()).filter(Boolean) : [];
      if (!module || stages.length === 0) {
        return { ok: false, error: 'Each module requires a name and at least one stage' };
      }
      if (new Set(stages.map((item) => item.toLowerCase())).size !== stages.length) {
        return { ok: false, error: 'Pipeline stages must be unique' };
      }
      nextRows.push({
        PipelineConfigID: moduleConfig.PipelineConfigID || this.createId('PLC'),
        Module: module,
        Stages: stages,
        Transitions: moduleConfig.Transitions || moduleConfig.transitions || [],
        Version: Number(moduleConfig.Version || moduleConfig.version || 1),
        Active: moduleConfig.Active !== undefined ? Boolean(moduleConfig.Active) : true,
        CreatedAt: moduleConfig.CreatedAt || new Date().toISOString(),
        UpdatedAt: new Date().toISOString()
      });
    }

    db.PipelineConfig = nextRows;
    this.recordAudit(db, {
      action: 'SETTING_CHANGED',
      module: 'Pipeline',
      entityType: 'PipelineConfig',
      entityId: 'pipeline',
      before,
      after: nextRows,
      actor,
      result: 'SUCCESS'
    });

    this.write(db);
    return { ok: true, data: this.safeClone(nextRows) };
  }

  getNotificationSettings() {
    const settings = this.getSettings();
    return this.safeClone(settings.NotificationSettings || this.getDefaultNotificationSettings());
  }

  updateNotificationSettings(changes = {}, actor = {}) {
    const current = this.getSettings();
    const next = {
      ...current,
      NotificationSettings: {
        ...current.NotificationSettings,
        ...changes
      }
    };
    return this.updateSettings(next, actor);
  }

  getFormRegistrySnapshot() {
    const db = this.ensureAdminCollections(this.read());
    const defaults = this.getDefaultFormRegistrySnapshot();
    const snapshot = { ...defaults };

    for (const row of db.FormRegistry) {
      if (!row || !row.FormType) continue;
      if (row.Active === false) continue;
      snapshot[String(row.FormType).toLowerCase()] = {
        formName: row.FormName || row.formName || row.FormType,
        entityType: row.EntityType || row.entityType || 'Requirement',
        category: row.Category || row.category || row.FormType,
        metadataVersion: row.MetadataVersion || row.metadataVersion || row.Version || 1,
        fields: this.safeClone(row.Fields || row.fields || {})
      };
    }

    return snapshot;
  }

  getFormRegistryRecords() {
    const db = this.ensureAdminCollections(this.read());
    return db.FormRegistry;
  }

  saveFormConfig(formType, payload = {}, actor = {}) {
    const db = this.ensureAdminCollections(this.read());
    const normalizedFormType = String(formType || payload.FormType || payload.formType || '').trim().toLowerCase();
    if (!normalizedFormType) return { ok: false, error: 'FormType is required' };
    const fields = payload.Fields || payload.fields || {};
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return { ok: false, error: 'Fields must be an object map' };
    }

    const existing = db.FormRegistry.find((row) => String(row.FormType || '').trim().toLowerCase() === normalizedFormType && row.Active !== false) || null;
    const before = existing ? this.safeClone(existing) : null;
    const next = {
      FormRegistryID: existing?.FormRegistryID || this.createId('FRG'),
      FormType: normalizedFormType,
      FormName: payload.FormName || payload.formName || existing?.FormName || normalizedFormType,
      EntityType: payload.EntityType || payload.entityType || existing?.EntityType || 'Requirement',
      Category: payload.Category || payload.category || existing?.Category || normalizedFormType,
      MetadataVersion: Number(payload.MetadataVersion || payload.metadataVersion || existing?.MetadataVersion || 1),
      Active: payload.Active !== undefined ? Boolean(payload.Active) : true,
      Fields: this.safeClone(fields),
      UpdatedAt: new Date().toISOString()
    };

    const existingIndex = db.FormRegistry.findIndex((row) => String(row.FormType || '').trim().toLowerCase() === normalizedFormType && row.Active !== false);
    if (existingIndex === -1) {
      db.FormRegistry.push(next);
    } else {
      db.FormRegistry[existingIndex] = next;
    }

    db.FormConfig.push({
      FormConfigID: this.createId('FCFG'),
      FormType: normalizedFormType,
      Version: next.MetadataVersion,
      FormRegistryID: next.FormRegistryID,
      Active: next.Active,
      Fields: this.safeClone(next.Fields),
      UpdatedAt: next.UpdatedAt
    });

    this.recordAudit(db, {
      action: 'FORM_UPDATED',
      module: 'Forms',
      entityType: 'FormRegistry',
      entityId: next.FormRegistryID,
      before,
      after: next,
      actor,
      result: 'SUCCESS'
    });

    this.write(db);
    return { ok: true, data: this.safeClone(next) };
  }

  updateFormField(formType, fieldId, changes = {}, actor = {}) {
    const snapshot = this.getFormRegistrySnapshot();
    const normalizedFormType = String(formType || '').trim().toLowerCase();
    const form = snapshot[normalizedFormType];
    if (!form) return { ok: false, error: 'Form config not found' };
    const fields = this.safeClone(form.fields || {});
    const existing = fields[fieldId] || null;
    if (!existing) return { ok: false, error: 'Field not found' };
    if (existing.SystemField || existing.systemField) {
      return { ok: false, error: 'System fields cannot be modified' };
    }
    const updated = { ...existing, ...changes };
    fields[fieldId] = updated;
    return this.saveFormConfig(normalizedFormType, { FormName: form.formName, EntityType: form.entityType, Category: form.category, MetadataVersion: Number(form.metadataVersion || 1) + 1, Fields: fields }, actor);
  }

  deactivateFormField(formType, fieldId, actor = {}) {
    return this.updateFormField(formType, fieldId, { Active: false }, actor);
  }

  reorderFormFields(formType, orderedFieldIds = [], actor = {}) {
    const snapshot = this.getFormRegistrySnapshot();
    const normalizedFormType = String(formType || '').trim().toLowerCase();
    const form = snapshot[normalizedFormType];
    if (!form) return { ok: false, error: 'Form config not found' };
    const fields = this.safeClone(form.fields || {});
    const existingIds = Object.keys(fields);
    if (orderedFieldIds.length !== existingIds.length) {
      return { ok: false, error: 'Field order must include every field' };
    }
    const reordered = {};
    for (const fieldId of orderedFieldIds) {
      if (!fields[fieldId]) return { ok: false, error: `Unknown field ${fieldId}` };
      reordered[fieldId] = fields[fieldId];
    }
    return this.saveFormConfig(normalizedFormType, { FormName: form.formName, EntityType: form.entityType, Category: form.category, MetadataVersion: Number(form.metadataVersion || 1) + 1, Fields: reordered }, actor);
  }

  recordAudit(db, entry = {}) {
    db.Audit = db.Audit || [];
    const actor = entry.actor || {};
    const user = this.getUser(actor.userId) || null;
    const row = {
      AuditID: this.createId('AUD'),
      Timestamp: entry.timestamp || new Date().toISOString(),
      UserID: actor.userId || actor.userID || 'system',
      UserName: user?.Name || actor.userName || null,
      Action: entry.action || entry.Action || 'UNKNOWN',
      Module: entry.module || entry.Module || 'System',
      EntityType: entry.entityType || entry.EntityType || null,
      EntityID: entry.entityId || entry.EntityID || null,
      Before: this.safeClone(entry.before ?? entry.Before ?? null),
      After: this.safeClone(entry.after ?? entry.After ?? null),
      IP: entry.ip || entry.IP || null,
      Device: entry.device || entry.Device || null,
      Result: entry.result || entry.Result || 'SUCCESS'
    };
    db.Audit.push(row);
    return row;
  }

  listAudit(filters = {}) {
    const db = this.ensureAdminCollections(this.read());
    const from = filters.dateFrom || filters.fromDate || null;
    const to = filters.dateTo || filters.toDate || null;
    return db.Audit.filter((row) => {
      if (filters.userId && row.UserID !== filters.userId) return false;
      if (filters.module && String(row.Module || '').toLowerCase() !== String(filters.module).toLowerCase()) return false;
      if (filters.action && String(row.Action || '').toLowerCase() !== String(filters.action).toLowerCase()) return false;
      if (filters.entityType && String(row.EntityType || '').toLowerCase() !== String(filters.entityType).toLowerCase()) return false;
      if (from && String(row.Timestamp || '') < from) return false;
      if (to && String(row.Timestamp || '') > to) return false;
      return true;
    }).sort((a, b) => String(b.Timestamp || '').localeCompare(String(a.Timestamp || '')));
  }

  hasPermission(actor = {}, permission) {
    if (!permission) return true;
    const normalizedPermission = String(permission).trim().toUpperCase();
    const user = actor.userId ? this.getUser(actor.userId) : null;
    const roleName = String(user?.Role || actor.role || 'AGENT').trim().toUpperCase();
    if (roleName === 'ADMIN') return true;

    const role = this.getRole(roleName);
    const rolePermissions = new Set((role?.Permissions || []).map((item) => String(item).trim().toUpperCase()));
    const userPermissions = new Set((user?.Permissions || []).map((item) => String(item).trim().toUpperCase()));
    if (rolePermissions.has('*') || userPermissions.has('*')) return true;
    if (rolePermissions.has(normalizedPermission) || userPermissions.has(normalizedPermission)) return true;
    return false;
  }

  getAdminOverview() {
    const db = this.ensureAdminCollections(this.read());
    const settings = this.getSettings();
    const backups = db.Backups || [];
    const audit = db.Audit || [];
    const users = db.Users || [];
    const leads = db.Leads || [];
    const requirements = db.Requirements || [];
    const inventory = db.Inventory || [];
    const deals = db.Deals || [];
    const commissions = db.Commission || [];

    const countByRole = (role) => users.filter((user) => String(user.Role || '').toUpperCase() === role).length;
    const activeUsers = users.filter((user) => String(user.Status || '').toUpperCase() === 'ACTIVE').length;

    return {
      ok: true,
      data: {
        totalUsers: users.length,
        activeUsers,
        inactiveUsers: users.length - activeUsers,
        adminUsers: countByRole('ADMIN'),
        managerUsers: countByRole('MANAGER'),
        agentUsers: countByRole('AGENT'),
        totalLeads: leads.length,
        activeLeads: leads.filter((lead) => ['ACTIVE', 'VERIFIED', 'NEW'].includes(String(lead.LeadStatus || '').toUpperCase())).length,
        inventory: inventory.length,
        requirements: requirements.length,
        deals: deals.length,
        pendingCommission: commissions.filter((row) => String(row.Status || '').toUpperCase() !== 'RECEIVED').length,
        system: {
          databaseStatus: 'OK',
          lastBackup: backups.length ? backups[backups.length - 1].CreatedAt : null,
          auditEvents: audit.length,
          configurationVersion: settings.ConfigurationVersion || 1,
          applicationVersion: appVersion
        }
      }
    };
  }

  getHealth() {
    const db = this.ensureAdminCollections(this.read());
    const requiredCollections = ['Users', 'Roles', 'Leads', 'Requirements', 'Inventory', 'Matches', 'Shortlists', 'SiteVisits', 'Negotiations', 'Tokens', 'Deals', 'Commission', 'Closings', 'Audit', 'Settings', 'Masters', 'PipelineConfig', 'Backups', 'FormConfig', 'FormRegistry'];
    const missingCollections = requiredCollections.filter((name) => !Object.prototype.hasOwnProperty.call(db, name));
    const settings = this.getSettings();
    const warnings = [];
    if (!settings.Timezone) warnings.push('Timezone not configured');
    if (!settings.Currency) warnings.push('Currency not configured');

    const writable = (() => {
      try {
        fs.accessSync(path.dirname(this.dbFile), fs.constants.W_OK);
        return true;
      } catch (_) {
        return false;
      }
    })();

    const checks = {
      databaseReadable: true,
      databaseWritable: writable,
      schemaValid: missingCollections.length === 0,
      requiredCollectionsPresent: missingCollections.length === 0,
      apiReachable: true,
      configurationValid: warnings.length === 0,
      authSubsystemAvailable: db.Users.length > 0 && db.Roles.length > 0,
      auditSubsystemAvailable: Array.isArray(db.Audit)
    };

    const problems = [
      ...missingCollections.map((item) => `Missing collection: ${item}`),
      ...warnings
    ];

    return {
      ok: true,
      data: {
        status: problems.length ? (missingCollections.length ? 'ERROR' : 'WARNING') : 'PASS',
        checks,
        issues: problems
      }
    };
  }

  buildMaintenanceIssues() {
    const db = this.ensureAdminCollections(this.read());
    const issues = [];
    const addIssue = (issueType, entity, id, severity, suggestedAction) => {
      issues.push({ issueType, entity, id, severity, suggestedAction });
    };

    const leadIds = new Set((db.Leads || []).map((row) => row.LeadID));
    const requirementIds = new Set((db.Requirements || []).map((row) => row.RequirementID));
    const propertyIds = new Set((db.Inventory || []).map((row) => row.PropertyID));
    const matchIds = new Set((db.Matches || []).map((row) => row.MatchID));
    const shortlistIds = new Set((db.Shortlists || []).map((row) => row.ShortlistID));
    const visitIds = new Set((db.SiteVisits || []).map((row) => row.VisitID));
    const negotiationIds = new Set((db.Negotiations || []).map((row) => row.NegotiationID));
    const tokenIds = new Set((db.Tokens || []).map((row) => row.TokenID));
    const dealIds = new Set((db.Deals || []).map((row) => row.DealID));
    const commissionIds = new Set((db.Commission || []).map((row) => row.CommissionID));

    for (const row of db.Requirements || []) {
      if (!leadIds.has(row.LeadID)) addIssue('ORPHAN_RECORD', 'Requirement', row.RequirementID, 'ERROR', 'Link requirement to an existing lead or archive it');
      if (!row.TransactionType) addIssue('MISSING_REQUIRED_FIELD', 'Requirement', row.RequirementID, 'WARNING', 'Populate transaction type');
    }
    for (const row of db.Inventory || []) {
      if (!row.PropertyID) addIssue('MISSING_REQUIRED_FIELD', 'Inventory', 'UNKNOWN', 'ERROR', 'Assign a property ID');
      if (!row.Status) addIssue('MISSING_REQUIRED_FIELD', 'Inventory', row.PropertyID, 'WARNING', 'Populate inventory status');
    }
    for (const row of db.Matches || []) {
      if (!requirementIds.has(row.RequirementID)) addIssue('BROKEN_RELATIONSHIP', 'Match', row.MatchID, 'ERROR', 'Link match to an existing requirement');
      if (!propertyIds.has(row.PropertyID)) addIssue('BROKEN_RELATIONSHIP', 'Match', row.MatchID, 'ERROR', 'Link match to an existing property');
    }
    for (const row of db.Shortlists || []) {
      if (!leadIds.has(row.LeadID)) addIssue('BROKEN_RELATIONSHIP', 'Shortlist', row.ShortlistID, 'ERROR', 'Link shortlist to an existing lead');
      if (!requirementIds.has(row.RequirementID)) addIssue('BROKEN_RELATIONSHIP', 'Shortlist', row.ShortlistID, 'ERROR', 'Link shortlist to an existing requirement');
      if (!propertyIds.has(row.PropertyID)) addIssue('BROKEN_RELATIONSHIP', 'Shortlist', row.ShortlistID, 'ERROR', 'Link shortlist to an existing property');
      if (row.MatchID && !matchIds.has(row.MatchID)) addIssue('BROKEN_RELATIONSHIP', 'Shortlist', row.ShortlistID, 'ERROR', 'Link shortlist to an existing match');
    }
    for (const row of db.SiteVisits || []) {
      if (!leadIds.has(row.LeadID)) addIssue('BROKEN_RELATIONSHIP', 'SiteVisit', row.VisitID, 'ERROR', 'Link site visit to an existing lead');
      if (!requirementIds.has(row.RequirementID)) addIssue('BROKEN_RELATIONSHIP', 'SiteVisit', row.VisitID, 'ERROR', 'Link site visit to an existing requirement');
      if (!propertyIds.has(row.PropertyID)) addIssue('BROKEN_RELATIONSHIP', 'SiteVisit', row.VisitID, 'ERROR', 'Link site visit to an existing property');
      if (row.MatchID && !matchIds.has(row.MatchID)) addIssue('BROKEN_RELATIONSHIP', 'SiteVisit', row.VisitID, 'ERROR', 'Link site visit to an existing match');
      if (row.ShortlistID && !shortlistIds.has(row.ShortlistID)) addIssue('BROKEN_RELATIONSHIP', 'SiteVisit', row.VisitID, 'ERROR', 'Link site visit to an existing shortlist');
    }
    for (const row of db.Negotiations || []) {
      if (!leadIds.has(row.LeadID)) addIssue('BROKEN_RELATIONSHIP', 'Negotiation', row.NegotiationID, 'ERROR', 'Link negotiation to an existing lead');
      if (!requirementIds.has(row.RequirementID)) addIssue('BROKEN_RELATIONSHIP', 'Negotiation', row.NegotiationID, 'ERROR', 'Link negotiation to an existing requirement');
      if (!propertyIds.has(row.PropertyID)) addIssue('BROKEN_RELATIONSHIP', 'Negotiation', row.NegotiationID, 'ERROR', 'Link negotiation to an existing property');
      if (row.MatchID && !matchIds.has(row.MatchID)) addIssue('BROKEN_RELATIONSHIP', 'Negotiation', row.NegotiationID, 'ERROR', 'Link negotiation to an existing match');
      if (row.ShortlistID && !shortlistIds.has(row.ShortlistID)) addIssue('BROKEN_RELATIONSHIP', 'Negotiation', row.NegotiationID, 'ERROR', 'Link negotiation to an existing shortlist');
      if (row.SiteVisitID && !visitIds.has(row.SiteVisitID)) addIssue('BROKEN_RELATIONSHIP', 'Negotiation', row.NegotiationID, 'ERROR', 'Link negotiation to an existing site visit');
    }
    for (const row of db.Tokens || []) {
      if (!negotiationIds.has(row.NegotiationID)) addIssue('BROKEN_RELATIONSHIP', 'Token', row.TokenID, 'ERROR', 'Link token to an existing negotiation');
      if (!leadIds.has(row.LeadID)) addIssue('BROKEN_RELATIONSHIP', 'Token', row.TokenID, 'ERROR', 'Link token to an existing lead');
      if (!requirementIds.has(row.RequirementID)) addIssue('BROKEN_RELATIONSHIP', 'Token', row.TokenID, 'ERROR', 'Link token to an existing requirement');
      if (!propertyIds.has(row.PropertyID)) addIssue('BROKEN_RELATIONSHIP', 'Token', row.TokenID, 'ERROR', 'Link token to an existing property');
    }
    for (const row of db.Deals || []) {
      if (!tokenIds.has(row.TokenID)) addIssue('BROKEN_RELATIONSHIP', 'Deal', row.DealID, 'ERROR', 'Link deal to an existing token');
      if (!leadIds.has(row.LeadID)) addIssue('BROKEN_RELATIONSHIP', 'Deal', row.DealID, 'ERROR', 'Link deal to an existing lead');
      if (!requirementIds.has(row.RequirementID)) addIssue('BROKEN_RELATIONSHIP', 'Deal', row.DealID, 'ERROR', 'Link deal to an existing requirement');
      if (!propertyIds.has(row.PropertyID)) addIssue('BROKEN_RELATIONSHIP', 'Deal', row.DealID, 'ERROR', 'Link deal to an existing property');
    }
    for (const row of db.Commission || []) {
      if (!dealIds.has(row.DealID)) addIssue('BROKEN_RELATIONSHIP', 'Commission', row.CommissionID, 'ERROR', 'Link commission to an existing deal');
    }
    for (const row of db.Closings || []) {
      if (!dealIds.has(row.DealID)) addIssue('BROKEN_RELATIONSHIP', 'Closing', row.ClosingID, 'ERROR', 'Link closing to an existing deal');
    }

    const userEmails = new Map();
    for (const user of db.Users || []) {
      if (!user.UserID) addIssue('MISSING_REQUIRED_FIELD', 'User', 'UNKNOWN', 'ERROR', 'Assign a user ID');
      if (!user.Name) addIssue('MISSING_REQUIRED_FIELD', 'User', user.UserID, 'WARNING', 'Populate user name');
      if (!user.Email) addIssue('MISSING_REQUIRED_FIELD', 'User', user.UserID, 'WARNING', 'Populate user email');
      const email = String(user.Email || '').trim().toLowerCase();
      if (email) {
        if (userEmails.has(email)) addIssue('DUPLICATE_RECORD', 'User', user.UserID, 'WARNING', 'Deduplicate user email addresses');
        userEmails.set(email, user.UserID);
      }
      if (!['ADMIN', 'MANAGER', 'AGENT'].includes(String(user.Role || '').toUpperCase())) addIssue('INVALID_STATUS', 'User', user.UserID, 'WARNING', 'Use a supported role');
      if (!['Active', 'Inactive', 'Disabled', 'Invited'].includes(String(user.Status || '').trim())) addIssue('INVALID_STATUS', 'User', user.UserID, 'WARNING', 'Use a supported user status');
    }

    return issues;
  }

  getMaintenanceReport() {
    const issues = this.buildMaintenanceIssues();
    return {
      ok: true,
      data: {
        totalIssues: issues.length,
        issues
      }
    };
  }

  createBackup(payload = {}, actor = {}) {
    const db = this.ensureAdminCollections(this.read());
    const snapshot = this.safeClone(db);
    const serialized = JSON.stringify(snapshot);
    const backup = {
      BackupID: payload.BackupID || this.createId('BKP'),
      CreatedAt: new Date().toISOString(),
      CreatedBy: payload.CreatedBy || payload.createdBy || actor.userId || 'system',
      Size: Buffer.byteLength(serialized, 'utf8'),
      Status: 'AVAILABLE',
      Checksum: crypto.createHash('sha256').update(serialized).digest('hex'),
      Label: payload.Label || payload.label || 'manual',
      Snapshot: snapshot
    };
    db.Backups.push(backup);
    this.recordAudit(db, {
      action: 'BACKUP_CREATED',
      module: 'Backup',
      entityType: 'Backup',
      entityId: backup.BackupID,
      before: null,
      after: { ...backup, Snapshot: undefined },
      actor,
      result: 'SUCCESS'
    });
    this.write(db);
    return { ok: true, data: { ...backup, Snapshot: undefined } };
  }

  listBackups() {
    const db = this.ensureAdminCollections(this.read());
    return db.Backups.map((row) => ({ ...row, Snapshot: undefined }));
  }

  getBackup(backupId) {
    const db = this.ensureAdminCollections(this.read());
    return db.Backups.find((row) => row.BackupID === backupId) || null;
  }

  validateSnapshot(snapshot) {
    const requiredCollections = ['Users', 'Roles', 'Leads', 'Requirements', 'Inventory', 'Matches', 'Shortlists', 'SiteVisits', 'Negotiations', 'Tokens', 'Deals', 'Commission', 'Closings', 'Audit', 'Settings', 'Masters', 'PipelineConfig', 'Backups', 'FormConfig', 'FormRegistry'];
    if (!snapshot || typeof snapshot !== 'object') return { ok: false, error: 'Invalid backup payload' };
    for (const collection of requiredCollections) {
      if (!Object.prototype.hasOwnProperty.call(snapshot, collection)) {
        return { ok: false, error: `Missing collection: ${collection}` };
      }
      if (!Array.isArray(snapshot[collection]) && collection !== 'Settings') {
        return { ok: false, error: `Invalid collection format: ${collection}` };
      }
    }
    return { ok: true };
  }

  restoreBackup(backupId, payload = {}, actor = {}) {
    const db = this.ensureAdminCollections(this.read());
    const backup = db.Backups.find((row) => row.BackupID === backupId);
    if (!backup) return { ok: false, error: 'Backup not found' };
    if (String(payload.confirm || payload.confirmation || '').trim().toUpperCase() !== 'RESTORE') {
      return { ok: false, error: 'Restore confirmation is required' };
    }

    const safety = this.createBackup({ Label: 'pre-restore safety' }, actor);
    if (!safety.ok) return safety;

    const validation = this.validateSnapshot(backup.Snapshot);
    if (!validation.ok) return validation;

    const restored = this.safeClone(backup.Snapshot);
    restored.Backups = db.Backups;
    restored.Settings = restored.Settings || [];
    restored.Roles = restored.Roles || [];
    restored.Users = restored.Users || [];
    restored.PipelineConfig = restored.PipelineConfig || [];
    restored.Notifications = restored.Notifications || [];
    restored.Masters = restored.Masters || [];
    restored.Audit = restored.Audit || [];
    restored.FormConfig = restored.FormConfig || [];
    restored.FormRegistry = restored.FormRegistry || [];

    this.write(restored);
    this.recordAudit(restored, {
      action: 'RESTORE_STARTED',
      module: 'Backup',
      entityType: 'Backup',
      entityId: backupId,
      before: null,
      after: { backupId },
      actor,
      result: 'SUCCESS'
    });
    this.write(restored);
    return { ok: true, data: { BackupID: backupId, Status: 'RESTORED' } };
  }

  getAdminSummaryCollections() {
    const db = this.ensureAdminCollections(this.read());
    return db;
  }
}

module.exports = { JsonRepository };
