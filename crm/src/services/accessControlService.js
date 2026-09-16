'use strict';

class AccessControlService {
  constructor(repository) {
    this.repository = repository;
  }

  _normalize(value) {
    return String(value || '').trim().toUpperCase();
  }

  _role(actor = {}) {
    return this._normalize(actor.role || 'AGENT') || 'AGENT';
  }

  _userId(actor = {}) {
    return String(actor.userId || actor.userID || actor.agentId || actor.agentID || '').trim();
  }

  _resolveUserTenant(userId) {
    const user = userId ? this.repository.getUser(String(userId).trim()) : null;
    if (!user) return null;
    return {
      companyId: String(user.CompanyID || user.CompanyId || '').trim(),
      brokerageId: String(user.BrokerageID || user.BrokerageId || '').trim()
    };
  }

  _resolveRecordTenant(record = {}, seen = new Set()) {
    if (!record || typeof record !== 'object') return null;
    const companyId = String(record.CompanyID || record.CompanyId || '').trim();
    const brokerageId = String(record.BrokerageID || record.BrokerageId || '').trim();
    if (companyId || brokerageId) {
      return { companyId, brokerageId };
    }

    const marker = [
      record.LeadID || '',
      record.RequirementID || '',
      record.TransactionID || '',
      record.PropertyID || '',
      record.ActivityID || '',
      record.FollowUpID || '',
      record.VisitID || '',
      record.VisitBookingID || ''
    ].join('|');
    if (marker && seen.has(marker)) return null;
    if (marker) seen.add(marker);

    if (record.LeadID) {
      const lead = this.repository.readLead(record.LeadID);
      const tenant = this._resolveRecordTenant(lead, seen);
      if (tenant?.companyId || tenant?.brokerageId) return tenant;
    }
    if (record.RequirementID) {
      const requirement = this.repository.readRequirement(record.RequirementID);
      const tenant = this._resolveRecordTenant(requirement, seen);
      if (tenant?.companyId || tenant?.brokerageId) return tenant;
    }
    if (record.TransactionID && typeof this.repository.getTransaction === 'function') {
      const transaction = this.repository.getTransaction(record.TransactionID);
      const tenant = this._resolveRecordTenant(transaction, seen);
      if (tenant?.companyId || tenant?.brokerageId) return tenant;
    }

    for (const userField of ['AssignedAgentID', 'CreatedBy', 'UpdatedBy', 'UploadedBy']) {
      const tenant = this._resolveUserTenant(record[userField]);
      if (tenant?.companyId || tenant?.brokerageId) return tenant;
    }

    return null;
  }

  _sameTenant(record = {}, actor = {}) {
    if (!record || typeof record !== 'object') return true;
    const actorCompany = String(actor.companyId || actor.companyID || '').trim();
    const actorBrokerage = String(actor.brokerageId || actor.brokerageID || '').trim();
    const resolvedTenant = this._resolveRecordTenant(record) || {};
    const recordCompany = String(resolvedTenant.companyId || '').trim();
    const recordBrokerage = String(resolvedTenant.brokerageId || '').trim();
    if (this._role(actor) !== 'ADMIN') {
      if (actorCompany && !recordCompany) return false;
      if (actorBrokerage && !recordBrokerage) return false;
    }
    if (actorCompany && recordCompany && actorCompany !== recordCompany) return false;
    if (actorBrokerage && recordBrokerage && actorBrokerage !== recordBrokerage) return false;
    return true;
  }

  _effectivePermissions(actor = {}) {
    const normalized = new Set();
    const role = this._role(actor);
    const user = this._userId(actor) ? this.repository.getUser(this._userId(actor)) : null;
    const fromActor = Array.isArray(actor.permissions) ? actor.permissions : [];
    const fromUser = Array.isArray(user?.Permissions) ? user.Permissions : [];
    const fromRole = Array.isArray(this.repository.getRole(role)?.Permissions) ? this.repository.getRole(role).Permissions : [];
    for (const value of [...fromActor, ...fromUser, ...fromRole]) {
      const item = this._normalize(value);
      if (item) normalized.add(item);
    }
    if (role === 'ADMIN') normalized.add('*');
    return normalized;
  }

  _hasAnyPermission(actor = {}, permissions = []) {
    const role = this._role(actor);
    if (role === 'ADMIN') return true;
    const effective = this._effectivePermissions(actor);
    if (effective.has('*')) return true;
    return permissions.some((permission) => {
      const normalized = this._normalize(permission);
      return normalized && (effective.has(normalized) || this.repository.hasPermission(actor, normalized));
    });
  }

  requirePermissions(actor = {}, permissions = []) {
    if (!this._userId(actor)) return { ok: false, statusCode: 401, error: 'Unauthorized' };
    if (!permissions.length) return { ok: true, actor };
    if (!this._hasAnyPermission(actor, permissions)) return { ok: false, statusCode: 403, error: 'Forbidden' };
    return { ok: true, actor };
  }

  canAccessLeadRecord(lead = {}, actor = {}) {
    if (!lead || typeof lead !== 'object') return false;
    if (!this._sameTenant(lead, actor)) return false;
    const role = this._role(actor);
    const userId = this._userId(actor);
    if (role === 'AGENT') {
      const assigned = String(lead.AssignedAgentID || '').trim();
      const createdBy = String(lead.CreatedBy || '').trim();
      if (assigned) return assigned === userId;
      if (createdBy) return createdBy === userId;
      return false;
    }
    return true;
  }

  authorizeLead(actor = {}, lead, options = {}) {
    const permissionCheck = options.skipPermission
      ? { ok: true, actor }
      : this.requirePermissions(actor, options.permissions || ['LEADS_VIEW', 'LEADS_READ']);
    if (!permissionCheck.ok) return permissionCheck;
    if (!lead) return { ok: false, statusCode: 404, error: 'Not found' };
    if (!this.canAccessLeadRecord(lead, actor)) {
      return { ok: false, statusCode: options.hideExistence === false ? 403 : 404, error: options.hideExistence === false ? 'Forbidden' : 'Not found' };
    }
    return { ok: true, actor, lead };
  }

  filterReadableLeads(rows = [], actor = {}) {
    return (Array.isArray(rows) ? rows : []).filter((row) => this.canAccessLeadRecord(row, actor));
  }

  authorizeTransaction(actor = {}, transaction, options = {}) {
    const permissionCheck = options.skipPermission
      ? { ok: true, actor }
      : this.requirePermissions(actor, options.permissions || ['LEADS_VIEW', 'LEADS_READ']);
    if (!permissionCheck.ok) return permissionCheck;
    if (!transaction) return { ok: false, statusCode: 404, error: 'Not found' };
    if (!this._sameTenant(transaction, actor)) {
      return { ok: false, statusCode: options.hideExistence === false ? 403 : 404, error: options.hideExistence === false ? 'Forbidden' : 'Not found' };
    }
    const lead = this.repository.readLead(transaction.LeadID);
    return this.authorizeLead(actor, lead, { skipPermission: true, hideExistence: options.hideExistence });
  }

  authorizeRequirement(actor = {}, requirement, options = {}) {
    const permissionCheck = options.skipPermission
      ? { ok: true, actor }
      : this.requirePermissions(actor, options.permissions || ['REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ']);
    if (!permissionCheck.ok) return permissionCheck;
    if (!requirement) return { ok: false, statusCode: 404, error: 'Not found' };
    if (!this._sameTenant(requirement, actor)) {
      return { ok: false, statusCode: options.hideExistence === false ? 403 : 404, error: options.hideExistence === false ? 'Forbidden' : 'Not found' };
    }
    const lead = this.repository.readLead(requirement.LeadID);
    return this.authorizeLead(actor, lead, { skipPermission: true, hideExistence: options.hideExistence });
  }

  authorizeProperty(actor = {}, property, options = {}) {
    const permissionCheck = options.skipPermission
      ? { ok: true, actor }
      : this.requirePermissions(actor, options.permissions || ['INVENTORY_VIEW', 'INVENTORY_READ', 'MATCHING_VIEW', 'SHORTLIST_VIEW', 'SITE_VISIT_VIEW']);
    if (!permissionCheck.ok) return permissionCheck;
    if (!property) return { ok: false, statusCode: 404, error: 'Not found' };
    if (!this._sameTenant(property, actor)) {
      return { ok: false, statusCode: options.hideExistence === false ? 403 : 404, error: options.hideExistence === false ? 'Forbidden' : 'Not found' };
    }
    return { ok: true, actor, property };
  }

  authorizeTenantRecord(actor = {}, record, options = {}) {
    const permissionCheck = options.skipPermission
      ? { ok: true, actor }
      : this.requirePermissions(actor, options.permissions || []);
    if (!permissionCheck.ok) return permissionCheck;
    if (!record || !this._sameTenant(record, actor)) {
      return { ok: false, statusCode: options.hideExistence === false ? 403 : 404, error: options.hideExistence === false ? 'Forbidden' : 'Not found' };
    }
    return { ok: true, actor, record };
  }

  authorizeActivity(actor = {}, activity, options = {}) {
    const permissionCheck = options.skipPermission
      ? { ok: true, actor }
      : this.requirePermissions(actor, options.permissions || ['LEADS_VIEW', 'LEADS_READ']);
    if (!permissionCheck.ok) return permissionCheck;
    if (!activity) return { ok: false, statusCode: 404, error: 'Not found' };
    const lead = this.repository.readLead(activity.LeadID);
    return this.authorizeLead(actor, lead, { skipPermission: true, hideExistence: options.hideExistence });
  }

  authorizeFollowUp(actor = {}, followUp, options = {}) {
    const permissionCheck = options.skipPermission
      ? { ok: true, actor }
      : this.requirePermissions(actor, options.permissions || ['LEADS_VIEW', 'LEADS_READ']);
    if (!permissionCheck.ok) return permissionCheck;
    if (!followUp) return { ok: false, statusCode: 404, error: 'Not found' };
    const lead = this.repository.readLead(followUp.LeadID);
    return this.authorizeLead(actor, lead, { skipPermission: true, hideExistence: options.hideExistence });
  }

  authorizeSearchRecord(actor = {}, record, options = {}) {
    const permissionCheck = options.skipPermission
      ? { ok: true, actor }
      : this.requirePermissions(actor, options.permissions || ['SEARCH_READ']);
    if (!permissionCheck.ok) return permissionCheck;
    if (!record || !this._sameTenant(record, actor)) {
      return { ok: false, statusCode: options.hideExistence === false ? 403 : 404, error: options.hideExistence === false ? 'Forbidden' : 'Not found' };
    }

    if (record.LeadID) {
      const leadCheck = this.authorizeLead(actor, this.repository.readLead(record.LeadID), {
        skipPermission: true,
        hideExistence: options.hideExistence
      });
      if (!leadCheck.ok) return leadCheck;
    }
    if (record.RequirementID) {
      const requirementCheck = this.authorizeRequirement(actor, this.repository.readRequirement(record.RequirementID), {
        skipPermission: true,
        hideExistence: options.hideExistence
      });
      if (!requirementCheck.ok) return requirementCheck;
    }
    if (record.PropertyID) {
      const propertyCheck = this.authorizeProperty(actor, this.repository.find('Inventory', 'PropertyID', record.PropertyID), {
        skipPermission: true,
        hideExistence: options.hideExistence
      });
      if (!propertyCheck.ok) return propertyCheck;
    }
    return { ok: true, actor, record };
  }

  authorizeSiteVisitBooking(actor = {}, bookingId, options = {}) {
    const db = this.repository.read();
    const rows = (db.SiteVisits || []).filter((row) => row && row.VisitBookingID === bookingId);
    if (!rows.length) return { ok: false, statusCode: 404, error: 'Not found' };
    const lead = this.repository.readLead(rows[0].LeadID);
    const leadCheck = this.authorizeLead(actor, lead, {
      permissions: options.permissions || ['SITE_VISIT_VIEW', 'LEADS_VIEW', 'LEADS_READ'],
      hideExistence: options.hideExistence
    });
    if (!leadCheck.ok) return leadCheck;
    for (const row of rows) {
      if (!this._sameTenant(row, actor)) {
        return { ok: false, statusCode: options.hideExistence === false ? 403 : 404, error: options.hideExistence === false ? 'Forbidden' : 'Not found' };
      }
      const property = this.repository.find('Inventory', 'PropertyID', row.PropertyID);
      const propertyCheck = this.authorizeProperty(actor, property, {
        permissions: ['SITE_VISIT_VIEW', 'INVENTORY_VIEW', 'INVENTORY_READ'],
        hideExistence: options.hideExistence
      });
      if (!propertyCheck.ok) return propertyCheck;
    }
    return { ok: true, actor, rows, lead };
  }
}

module.exports = { AccessControlService };
