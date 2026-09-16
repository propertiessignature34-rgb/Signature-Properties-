'use strict';
/**
 * Phase 16 — V2 Follow-up Service
 */

const VALID_STATUSES = new Set(['PENDING', 'COMPLETED', 'CANCELLED', 'OVERDUE']);
const CLOSED_STATUSES = new Set(['COMPLETED', 'CANCELLED']);
const ACTIVITY_TYPES = new Map([
  ['CALL', 'Call'],
  ['EMAIL', 'Email'],
  ['WHATSAPP', 'WhatsApp'],
  ['MEETING', 'Meeting'],
  ['VISIT', 'Visit'],
  ['SITE VISIT', 'Visit'],
  ['OTHER', 'Other']
]);

class V2FollowUpService {
  constructor(repo) {
    this.repo = repo;
  }

  createFollowUp(payload, actor = {}) {
    const db = this.repo.read();
    if (!payload.LeadID) return { ok: false, error: 'LeadID is required', code: 'VALIDATION_ERROR' };
    const lead = (db.Leads || []).find(l => l.LeadID === payload.LeadID);
    if (!lead) return { ok: false, error: 'Lead not found', code: 'LEAD_NOT_FOUND' };

    if (payload.RequirementID) {
      const req = (db.Requirements || []).find(r => r.RequirementID === payload.RequirementID);
      if (!req) return { ok: false, error: 'Requirement not found', code: 'NOT_FOUND' };
      if (req.LeadID !== payload.LeadID) return { ok: false, error: 'Requirement does not belong to this Lead', code: 'RELATIONSHIP_VIOLATION' };
    }

    const dueAt = this._resolveDueAt(payload);
    if (!dueAt) return { ok: false, error: 'DueAt is required', code: 'VALIDATION_ERROR' };
    if (!Number.isFinite(new Date(dueAt).getTime())) return { ok: false, error: 'DueAt must be a valid datetime', code: 'VALIDATION_ERROR' };

    const now = new Date().toISOString();
    const activityType = this._resolveActivityType(payload.ActivityType || payload.activityType || payload.Type || payload.type);
    const followUp = {
      FollowUpID: this.repo.createId('FU'),
      LeadID: payload.LeadID,
      TransactionID: payload.TransactionID || null,
      RequirementID: payload.RequirementID || null,
      ActivityID: payload.ActivityID || null,
      DueAt: dueAt,
      ActivityType: activityType,
      Priority: payload.Priority || payload.priority || 'Medium',
      Status: this._normalizeStatus(payload.Status || payload.status || 'PENDING'),
      AssignedUser: payload.AssignedUser || payload.assignedUser || payload.AssignedTo || payload.assignedTo || actor.userId || 'system',
      Notes: payload.Notes || payload.notes || '',
      CompanyID: lead.CompanyID || payload.CompanyID || payload.companyId || actor.companyId || actor.companyID || null,
      BrokerageID: lead.BrokerageID || payload.BrokerageID || payload.brokerageId || actor.brokerageId || actor.brokerageID || null,
      CreatedBy: actor.userId || 'system',
      CreatedAt: now,
      UpdatedAt: now
    };

    db.FollowUps = db.FollowUps || [];
    db.FollowUps.push(followUp);
    this._appendArtifacts(db, followUp, 'SCHEDULED', actor, { occurredAt: now });

    this.repo.write(db);
    return { ok: true, data: this._normalizeFollowUpShape(followUp) };
  }

  updateFollowUp(followUpId, patch, actor = {}) {
    const db = this.repo.read();
    db.FollowUps = db.FollowUps || [];
    const idx = db.FollowUps.findIndex(f => f.FollowUpID === followUpId);
    if (idx === -1) return { ok: false, error: 'Follow-up not found', code: 'NOT_FOUND' };

    const fu = db.FollowUps[idx];
    const currentStatus = this._normalizeStatus(fu.Status);
    if (CLOSED_STATUSES.has(currentStatus)) return { ok: false, error: `Cannot update a ${currentStatus} follow-up`, code: 'INVALID_STATE' };

    const updates = { ...patch };
    delete updates.FollowUpID;
    delete updates.LeadID;
    delete updates.CreatedBy;
    delete updates.CreatedAt;

    const dueAt = this._resolveDueAt(updates);
    if (dueAt) updates.DueAt = dueAt;
    delete updates.DueDate;
    delete updates.dueDate;
    delete updates.Time;
    delete updates.time;
    delete updates.Date;
    delete updates.date;

    if (updates.ActivityType || updates.activityType || updates.Type || updates.type) {
      updates.ActivityType = this._resolveActivityType(updates.ActivityType || updates.activityType || updates.Type || updates.type);
    }
    delete updates.activityType;
    delete updates.Type;
    delete updates.type;

    if (updates.Status || updates.status) {
      updates.Status = this._normalizeStatus(updates.Status || updates.status);
      if (!VALID_STATUSES.has(updates.Status)) delete updates.Status;
    }
    delete updates.status;

    if (updates.AssignedTo && !updates.AssignedUser) updates.AssignedUser = updates.AssignedTo;
    if (updates.assignedTo && !updates.AssignedUser) updates.AssignedUser = updates.assignedTo;
    if (updates.Notes === undefined && updates.notes !== undefined) updates.Notes = updates.notes;
    delete updates.AssignedTo;
    delete updates.assignedTo;
    delete updates.notes;

    const nextDueAt = updates.DueAt || fu.DueAt;
    const dueChanged = !!(updates.DueAt && updates.DueAt !== fu.DueAt);
    const updated = {
      ...fu,
      ...updates,
      CompanyID: fu.CompanyID || actor.companyId || actor.companyID || null,
      BrokerageID: fu.BrokerageID || actor.brokerageId || actor.brokerageID || null,
      UpdatedAt: new Date().toISOString()
    };
    const changed = JSON.stringify(this._normalizeFollowUpShape(fu)) !== JSON.stringify(this._normalizeFollowUpShape(updated));
    if (!changed) {
      return { ok: true, data: this._normalizeFollowUpShape(fu) };
    }
    db.FollowUps[idx] = updated;
    if (dueChanged && nextDueAt) {
      this._appendArtifacts(db, updated, 'RESCHEDULED', actor, {
        previousDueAt: fu.DueAt || null,
        occurredAt: updated.UpdatedAt
      });
    }
    this.repo.write(db);
    return { ok: true, data: this._normalizeFollowUpShape(db.FollowUps[idx]) };
  }

  completeFollowUp(followUpId, actor = {}) {
    return this._transition(followUpId, 'COMPLETED', actor);
  }

  cancelFollowUp(followUpId, actor = {}) {
    return this._transition(followUpId, 'CANCELLED', actor);
  }

  getFollowUp(followUpId) {
    const db = this.repo.read();
    const fu = (db.FollowUps || []).find(f => f.FollowUpID === followUpId);
    if (!fu) return { ok: false, error: 'Follow-up not found', code: 'NOT_FOUND' };
    return { ok: true, data: this._normalizeFollowUpShape(fu) };
  }

  listFollowUps(filters = {}) {
    const db = this.repo.read();
    let fus = db.FollowUps || [];
    if (filters.LeadID) fus = fus.filter(f => f.LeadID === filters.LeadID);
    if (filters.TransactionID) fus = fus.filter(f => f.TransactionID === filters.TransactionID);
    if (filters.RequirementID) fus = fus.filter(f => f.RequirementID === filters.RequirementID);
    if (filters.AssignedUser || filters.AssignedTo) {
      const assigned = filters.AssignedUser || filters.AssignedTo;
      fus = fus.filter(f => (f.AssignedUser || f.AssignedTo) === assigned);
    }
    if (filters.Status) fus = fus.filter(f => this._normalizeStatus(f.Status) === this._normalizeStatus(filters.Status));

    const nowIso = new Date().toISOString();
    const normalized = fus.map((f) => this._normalizeFollowUpShape(f, nowIso));

    if (filters.preset === 'today') {
      const today = new Date();
      const y = today.getFullYear();
      const m = today.getMonth();
      const d = today.getDate();
      const start = new Date(y, m, d, 0, 0, 0, 0).getTime();
      const end = new Date(y, m, d, 23, 59, 59, 999).getTime();
      fus = normalized.filter((f) => {
        const due = new Date(f.dueAt).getTime();
        return due >= start && due <= end && !CLOSED_STATUSES.has(this._normalizeStatus(f.status));
      });
    } else if (filters.preset === 'overdue') {
      fus = normalized.filter((f) => f.status === 'OVERDUE');
    } else if (filters.preset === 'upcoming') {
      fus = normalized.filter((f) => new Date(f.dueAt).toISOString() >= nowIso && !CLOSED_STATUSES.has(this._normalizeStatus(f.status)));
    } else if (filters.preset === 'completed') {
      fus = normalized.filter((f) => this._normalizeStatus(f.status) === 'COMPLETED');
    } else {
      fus = normalized;
    }

    fus.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    const limit = filters.limit ? Math.min(Number(filters.limit), 200) : 100;
    return { ok: true, data: fus.slice(0, limit), total: fus.length };
  }

  _transition(followUpId, targetStatus, actor = {}) {
    const db = this.repo.read();
    db.FollowUps = db.FollowUps || [];
    const idx = db.FollowUps.findIndex(f => f.FollowUpID === followUpId);
    if (idx === -1) return { ok: false, error: 'Follow-up not found', code: 'NOT_FOUND' };
    const fu = db.FollowUps[idx];
    const current = this._normalizeStatus(fu.Status);
    if (current === targetStatus) return { ok: false, error: `Follow-up already ${targetStatus.toLowerCase()}`, code: `ALREADY_${targetStatus}` };
    if (CLOSED_STATUSES.has(current)) return { ok: false, error: `Cannot transition from ${current}`, code: 'INVALID_STATE' };
    const now = new Date().toISOString();
    db.FollowUps[idx] = {
      ...fu,
      Status: targetStatus,
      UpdatedAt: now,
      ...(targetStatus === 'COMPLETED' ? { CompletedAt: now, CompletedBy: actor.userId || 'system' } : {}),
      ...(targetStatus === 'CANCELLED' ? { CancelledAt: now, CancelledBy: actor.userId || 'system' } : {})
    };
    this._appendArtifacts(db, db.FollowUps[idx], targetStatus, actor, { occurredAt: now });
    this.repo.write(db);
    return { ok: true, data: this._normalizeFollowUpShape(db.FollowUps[idx]) };
  }

  _appendArtifacts(db, followUp, transition, actor = {}, extra = {}) {
    if (!followUp) return;
    db.Activities = db.Activities || [];
    db.Timeline = db.Timeline || [];

    const key = this._artifactKey(followUp, transition, extra);
    const occurredAt = extra.occurredAt || followUp.UpdatedAt || followUp.CreatedAt || new Date().toISOString();
    const details = this._artifactDetails(followUp, transition, extra);

    const hasActivity = db.Activities.some((row) =>
      row &&
      row.LeadID === followUp.LeadID &&
      row.RequirementID === followUp.RequirementID &&
      row._transitionKey === key
    );
    if (!hasActivity) {
      db.Activities.push({
        ActivityID: this.repo.createId('ACT'),
        LeadID: followUp.LeadID,
        TransactionID: followUp.TransactionID,
        RequirementID: followUp.RequirementID,
        ActivityType: followUp.ActivityType,
        Notes: details.note,
        CreatedAt: occurredAt,
        CreatedBy: actor.userId || 'system',
        CompanyID: followUp.CompanyID || null,
        BrokerageID: followUp.BrokerageID || null,
        _transitionKey: key
      });
    }

    const hasTimeline = db.Timeline.some((row) =>
      row &&
      row.EntityType === 'FollowUp' &&
      row.EntityID === followUp.FollowUpID &&
      row.EventType === details.eventType &&
      row?.Payload?._transitionKey === key
    );
    if (!hasTimeline) {
      db.Timeline.push({
        TimelineID: this.repo.createId('TIM'),
        LeadID: followUp.LeadID,
        EntityType: 'FollowUp',
        EntityID: followUp.FollowUpID,
        EventType: details.eventType,
        EventTitle: details.title,
        EventDate: occurredAt,
        Payload: {
          followUpId: followUp.FollowUpID,
          dueAt: followUp.DueAt,
          previousDueAt: extra.previousDueAt || null,
          activityType: followUp.ActivityType,
          status: followUp.Status,
          changedBy: actor.userId || 'system',
          _transitionKey: key
        }
      });
    }
  }

  _artifactKey(followUp, transition, extra = {}) {
    const suffix = transition === 'RESCHEDULED'
      ? `${extra.previousDueAt || ''}|${followUp.DueAt || ''}`
      : transition === 'SCHEDULED'
        ? `${followUp.DueAt || ''}`
        : '';
    return `FOLLOWUP|${followUp.FollowUpID}|${transition}|${suffix}`;
  }

  _artifactDetails(followUp, transition, extra = {}) {
    const dueLabel = this._formatDueAtLabel(followUp.DueAt);
    if (transition === 'COMPLETED') {
      return {
        eventType: 'FOLLOWUP_COMPLETED',
        title: `Follow-up completed — ${followUp.ActivityType}`,
        note: `Follow-up completed — ${followUp.ActivityType}${followUp.Notes ? ` — ${followUp.Notes}` : ''}`
      };
    }
    if (transition === 'CANCELLED') {
      return {
        eventType: 'FOLLOWUP_CANCELLED',
        title: `Follow-up cancelled — ${followUp.ActivityType}`,
        note: `Follow-up cancelled — ${followUp.ActivityType}${followUp.Notes ? ` — ${followUp.Notes}` : ''}`
      };
    }
    if (transition === 'RESCHEDULED') {
      return {
        eventType: 'FOLLOWUP_RESCHEDULED',
        title: `Follow-up rescheduled — ${followUp.ActivityType} — ${dueLabel}`,
        note: `Follow-up rescheduled — ${followUp.ActivityType} — ${dueLabel}${extra.previousDueAt ? ` (from ${this._formatDueAtLabel(extra.previousDueAt)})` : ''}${followUp.Notes ? ` — ${followUp.Notes}` : ''}`
      };
    }
    return {
      eventType: 'FOLLOWUP_SCHEDULED',
      title: `Follow-up scheduled — ${followUp.ActivityType} — ${dueLabel}`,
      note: `Follow-up scheduled — ${followUp.ActivityType} — ${dueLabel}${followUp.Notes ? ` — ${followUp.Notes}` : ''}`
    };
  }

  _resolveDueAt(payload = {}) {
    if (payload.DueAt || payload.dueAt) return payload.DueAt || payload.dueAt;
    const dueDate = payload.DueDate || payload.dueDate || payload.Date || payload.date || null;
    const dueTime = payload.Time || payload.time || null;
    if (!dueDate) return null;
    const parsed = new Date(`${dueDate}T${dueTime || '00:00'}:00`);
    if (!Number.isFinite(parsed.getTime())) return null;
    return parsed.toISOString();
  }

  _resolveActivityType(typeRaw) {
    const key = String(typeRaw || 'CALL').trim().toUpperCase().replace(/_/g, ' ');
    return ACTIVITY_TYPES.get(key) || 'Other';
  }

  _normalizeStatus(statusRaw) {
    const status = String(statusRaw || 'PENDING').trim().toUpperCase();
    if (status === 'DONE') return 'COMPLETED';
    return VALID_STATUSES.has(status) ? status : 'PENDING';
  }

  _formatDueAtLabel(dueAt) {
    const due = new Date(dueAt);
    const date = due.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = due.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${date} ${time}`;
  }

  _normalizeFollowUpShape(row, nowIso = new Date().toISOString()) {
    const dueAt = row.DueAt || this._resolveDueAt(row) || row.DueDate || row.dueDate || row.CreatedAt;
    const dueAtIso = Number.isFinite(new Date(dueAt).getTime()) ? new Date(dueAt).toISOString() : new Date(row.CreatedAt || Date.now()).toISOString();
    const normalizedStatus = this._normalizeStatus(row.Status || row.status);
    const overdue = !CLOSED_STATUSES.has(normalizedStatus) && dueAtIso < nowIso;
    const status = overdue ? 'OVERDUE' : normalizedStatus;
    const activityType = this._resolveActivityType(row.ActivityType || row.activityType || row.Type || row.type);
    const normalized = {
      id: row.FollowUpID,
      leadId: row.LeadID || null,
      transactionId: row.TransactionID || null,
      requirementId: row.RequirementID || null,
      activityId: row.ActivityID || null,
      dueAt: dueAtIso,
      activityType,
      priority: row.Priority || row.priority || 'Medium',
      status,
      notes: row.Notes || row.notes || '',
      assignedUser: row.AssignedUser || row.AssignedTo || row.assignedUser || row.assignedTo || 'system',
      createdBy: row.CreatedBy || 'system',
      createdAt: row.CreatedAt || null,
      updatedAt: row.UpdatedAt || null,
      completedAt: row.CompletedAt || null,
      completedBy: row.CompletedBy || null,
      cancelledAt: row.CancelledAt || null,
      cancelledBy: row.CancelledBy || null
    };
    return {
      ...normalized,
      FollowUpID: normalized.id,
      LeadID: normalized.leadId,
      TransactionID: normalized.transactionId,
      RequirementID: normalized.requirementId,
      ActivityID: normalized.activityId,
      DueAt: normalized.dueAt,
      ActivityType: normalized.activityType,
      Priority: normalized.priority,
      Status: normalized.status,
      Notes: normalized.notes,
      AssignedUser: normalized.assignedUser,
      AssignedTo: normalized.assignedUser,
      CreatedBy: normalized.createdBy,
      CreatedAt: normalized.createdAt,
      UpdatedAt: normalized.updatedAt,
      CompletedAt: normalized.completedAt,
      CompletedBy: normalized.completedBy,
      CancelledAt: normalized.cancelledAt,
      CancelledBy: normalized.cancelledBy
    };
  }
}

module.exports = { V2FollowUpService };
