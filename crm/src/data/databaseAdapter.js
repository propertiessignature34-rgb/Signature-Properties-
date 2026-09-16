const crypto = require('node:crypto');
const { modelSchema } = require('./schema');

class DatabaseAdapter {
  get() {
    throw new Error('DatabaseAdapter.get() must be implemented');
  }

  list() {
    throw new Error('DatabaseAdapter.list() must be implemented');
  }

  find() {
    throw new Error('DatabaseAdapter.find() must be implemented');
  }

  insert() {
    throw new Error('DatabaseAdapter.insert() must be implemented');
  }

  update() {
    throw new Error('DatabaseAdapter.update() must be implemented');
  }

  delete() {
    throw new Error('DatabaseAdapter.delete() must be implemented');
  }

  count() {
    throw new Error('DatabaseAdapter.count() must be implemented');
  }

  transaction() {
    throw new Error('DatabaseAdapter.transaction() must be implemented');
  }

  getProfile() {
    throw new Error('DatabaseAdapter.getProfile() must be implemented');
  }

  getSchema() {
    throw new Error('DatabaseAdapter.getSchema() must be implemented');
  }

  getIndexes() {
    throw new Error('DatabaseAdapter.getIndexes() must be implemented');
  }

  validateRelationshipIntegrity() {
    throw new Error('DatabaseAdapter.validateRelationshipIntegrity() must be implemented');
  }

  backup() {
    throw new Error('DatabaseAdapter.backup() must be implemented');
  }

  restore() {
    throw new Error('DatabaseAdapter.restore() must be implemented');
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function matchesTenant(row, options = {}) {
  if (options.companyId !== undefined && row.companyId !== options.companyId && row.CompanyID !== options.companyId) {
    return false;
  }

  if (options.brokerageId !== undefined && row.brokerageId !== options.brokerageId && row.BrokerageID !== options.brokerageId) {
    return false;
  }

  return true;
}

function matchesWhere(row, where = {}) {
  return Object.entries(where).every(([field, expected]) => {
    if (typeof expected === 'function') return expected(row[field], row);
    if (Array.isArray(expected)) return expected.includes(row[field]);
    return row[field] === expected;
  });
}

class JsonDatabaseAdapter extends DatabaseAdapter {
  constructor(repository, options = {}) {
    super();
    if (!repository || typeof repository.read !== 'function' || typeof repository.write !== 'function') {
      throw new TypeError('JsonDatabaseAdapter requires a JsonRepository-compatible instance');
    }
    this.repository = repository;
    this.profile = options.profile || process.env.NODE_ENV || 'development';
    this.schema = clone(modelSchema);
    this.indexes = {
      Users: ['UserID', 'Email', 'Role'],
      Roles: ['RoleID', 'Name'],
      Leads: ['LeadID', 'AssignedAgentID', 'LeadStatus'],
      Transactions: ['TransactionID', 'LeadID', 'Type'],
      Requirements: ['RequirementID', 'LeadID', 'TransactionID', 'Status'],
      RequirementHistory: ['RequirementHistoryID', 'RequirementID'],
      Inventory: ['PropertyID', 'Project', 'Location', 'OwnerID', 'BuilderID'],
      Matches: ['MatchID', 'RequirementID', 'PropertyID'],
      Shortlists: ['ShortlistID', 'RequirementID', 'PropertyID', 'LeadID'],
      SiteVisits: ['VisitID', 'LeadID', 'PropertyID'],
      Negotiations: ['NegotiationID', 'LeadID', 'PropertyID', 'Status'],
      Tokens: ['TokenID', 'NegotiationID', 'Status'],
      Deals: ['DealID', 'LeadID', 'PropertyID', 'Status'],
      Commission: ['CommissionID', 'DealID', 'Status'],
      Closings: ['ClosingID', 'DealID', 'Status'],
      FollowUps: ['FollowUpID', 'LeadID', 'RequirementID', 'Status'],
      Documents: ['DocumentID', 'EntityType', 'EntityID'],
      Media: ['MediaID', 'EntityType', 'EntityID'],
      Owners: ['OwnerID', 'Name', 'Mobile'],
      Builders: ['BuilderID', 'Name'],
      Projects: ['ProjectID', 'BuilderID', 'Location'],
      Settings: ['SettingsID', 'Key'],
      Masters: ['MasterID', 'MasterType', 'Value'],
      Backups: ['BackupID', 'CreatedAt', 'Label'],
      Audit: ['AuditID', 'UserID', 'Action', 'Timestamp']
    };
  }

  getProfile() {
    return this.profile;
  }

  getSchema() {
    return clone(this.schema);
  }

  getIndexes() {
    return clone(this.indexes);
  }

  getRelationshipMap() {
    return {
      Leads: ['Transactions', 'Requirements', 'FollowUps', 'SiteVisits', 'Negotiations', 'Deals'],
      Requirements: ['Matches', 'Shortlists', 'SiteVisits', 'Negotiations', 'Tokens', 'Commission', 'FollowUps'],
      Inventory: ['Matches', 'Shortlists', 'SiteVisits', 'Negotiations', 'Deals'],
      Owners: ['Inventory'],
      Builders: ['Projects', 'Inventory'],
      Projects: ['Inventory', 'Documents', 'Media'],
      Deals: ['Commission', 'Closings', 'Payments']
    };
  }

  validateRelationshipIntegrity() {
    const db = this.repository.read();
    const errors = [];
    const leadIds = new Set((db.Leads || []).map((row) => row.LeadID));
    const requirementIds = new Set((db.Requirements || []).map((row) => row.RequirementID));
    const inventoryIds = new Set((db.Inventory || []).map((row) => row.PropertyID));
    const builderIds = new Set((db.Builders || []).map((row) => row.BuilderID));
    const projectIds = new Set((db.Projects || []).map((row) => row.ProjectID));

    for (const row of db.Requirements || []) {
      if (row.LeadID && !leadIds.has(row.LeadID)) errors.push(`Requirement ${row.RequirementID} references missing LeadID ${row.LeadID}`);
      if (row.TransactionID && !(db.Transactions || []).some((item) => item.TransactionID === row.TransactionID)) errors.push(`Requirement ${row.RequirementID} references missing TransactionID ${row.TransactionID}`);
    }

    for (const row of db.Matches || []) {
      if (row.RequirementID && !requirementIds.has(row.RequirementID)) errors.push(`Match ${row.MatchID} references missing RequirementID ${row.RequirementID}`);
      if (row.PropertyID && !inventoryIds.has(row.PropertyID)) errors.push(`Match ${row.MatchID} references missing PropertyID ${row.PropertyID}`);
    }

    if ((db.Builders || []).length > 0) {
      for (const row of db.Projects || []) {
        if (row.BuilderID && !builderIds.has(row.BuilderID)) errors.push(`Project ${row.ProjectID} references missing BuilderID ${row.BuilderID}`);
      }

      for (const row of db.Inventory || []) {
        if (row.BuilderID && !builderIds.has(row.BuilderID)) errors.push(`Property ${row.PropertyID} references missing BuilderID ${row.BuilderID}`);
      }
    }

    if ((db.Projects || []).length > 0) {
      for (const row of db.Inventory || []) {
        const projectExists = !!row.Project && ((db.Projects || []).some((item) => item.ProjectName === row.Project || item.ProjectID === row.Project) || projectIds.has(row.Project));
        if (row.Project && !projectExists) {
          errors.push(`Property ${row.PropertyID} references missing project ${row.Project}`);
        }
      }
    }

    return { ok: errors.length === 0, errors };
  }

  backup(options = {}) {
    const db = this.repository.read();
    const backupId = this.repository.createId('BKP');
    const snapshot = clone(db);
    const backupRecord = {
      BackupID: backupId,
      Label: options.label || 'manual',
      CreatedAt: new Date().toISOString(),
      CreatedBy: options.createdBy || 'system',
      Status: 'READY',
      Size: JSON.stringify(snapshot).length,
      Checksum: crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
      Snapshot: snapshot
    };

    this.repository.create('Backups', backupRecord);
    return { ok: true, data: { backupId, backup: backupRecord } };
  }

  restore(backupId, options = {}) {
    const db = this.repository.read();
    const backup = (db.Backups || []).find((row) => row.BackupID === backupId);
    if (!backup) return { ok: false, error: 'Backup not found' };
    if (String(options.confirm || '').trim().toUpperCase() !== 'RESTORE') {
      return { ok: false, error: 'Restore confirmation is required' };
    }

    const snapshot = clone(backup.Snapshot || {});
    const restored = { ...db, ...snapshot };
    restored.Backups = db.Backups || [];
    this.repository.write(restored);
    return { ok: true, data: { BackupID: backupId, Status: 'RESTORED' } };
  }

  get(collection, idField, id, options = {}) {
    return this.find(collection, idField, id, options);
  }

  list(collection, options = {}) {
    return this.repository.list(collection).filter((row) => {
      return matchesTenant(row, options) && matchesWhere(row, options.where);
    });
  }

  find(collection, idField, id, options = {}) {
    return this.list(collection, options).find((row) => row[idField] === id) || null;
  }

  insert(collection, row, options = {}) {
    const record = { ...row };
    if (options.companyId !== undefined && record.companyId === undefined && record.CompanyID === undefined) {
      record.companyId = options.companyId;
    }
    if (options.brokerageId !== undefined && record.brokerageId === undefined && record.BrokerageID === undefined) {
      record.brokerageId = options.brokerageId;
    }
    return this.repository.create(collection, record);
  }

  update(collection, idField, id, changes, options = {}) {
    const existing = this.find(collection, idField, id, options);
    if (!existing) return null;
    return this.repository.update(collection, idField, id, changes);
  }

  delete(collection, idField, id, options = {}) {
    const existing = this.find(collection, idField, id, options);
    if (!existing) return false;
    this.repository.delete(collection, idField, id);
    return true;
  }

  count(collection, options = {}) {
    return this.list(collection, options).length;
  }

  transaction(work) {
    if (typeof work !== 'function') {
      throw new TypeError('DatabaseAdapter.transaction() requires a callback');
    }

    const snapshot = clone(this.repository.read());
    try {
      return work(this);
    } catch (error) {
      this.repository.write(snapshot);
      throw error;
    }
  }
}

module.exports = {
  DatabaseAdapter,
  JsonDatabaseAdapter
};
