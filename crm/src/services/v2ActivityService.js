'use strict';
/**
 * Phase 16 — V2 Activity Service
 *
 * Canonical wrapper around the repository's activity primitives,
 * adding the full V2 activity model (RequirementID, ActivityDirection,
 * Outcome, NextAction, FollowUpDate, Version) and audit fields.
 *
 * Reading activities NEVER mutates data.
 * Creating an activity NEVER creates a new Lead or Requirement.
 */

const VALID_TYPES = new Set([
  'CALL', 'WHATSAPP', 'SMS', 'MEETING', 'SITE_VISIT', 'NOTE', 'EMAIL', 'OTHER'
]);
const VALID_DIRECTIONS = new Set(['INBOUND', 'OUTBOUND', '']);

class V2ActivityService {
  /**
   * @param {import('../data/repository').JsonRepository} repo
   * @param {import('./v2RequirementService').V2RequirementService} [reqSvc]  optional — used to PATCH requirement fields during conversation capture
   */
  constructor(repo, reqSvc = null) {
    this.repo   = repo;
    this.reqSvc = reqSvc;
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  /**
   * Record an activity (conversation, call, note…).
   *
   * payload:
   *   LeadID *          string
   *   TransactionID?    string
   *   RequirementID?    string
   *   ActivityType      CALL|WHATSAPP|SMS|MEETING|SITE_VISIT|NOTE|EMAIL|OTHER
   *   ActivityDirection INBOUND|OUTBOUND
   *   Summary?          string  — one-line description
   *   Details?          string  — free text
   *   Outcome?          string
   *   NextAction?       string
   *   FollowUpDate?     ISO string
   *   FieldUpdates?     { [fieldKey]: value }  — conversation-captured field changes
   *
   * actor: { userId, role }
   */
  createActivity(payload, actor = {}) {
    const db = this.repo.read();

    // Validate Lead exists
    const lead = (db.Leads || []).find(l => l.LeadID === payload.LeadID);
    if (!lead) {
      return { ok: false, error: 'Lead not found', code: 'LEAD_NOT_FOUND' };
    }

    // Validate TransactionID belongs to Lead (if provided)
    if (payload.TransactionID) {
      const txn = (db.Transactions || []).find(t => t.TransactionID === payload.TransactionID);
      if (!txn) return { ok: false, error: 'Transaction not found', code: 'TXN_NOT_FOUND' };
      if (txn.LeadID !== payload.LeadID) {
        return { ok: false, error: 'Transaction does not belong to this Lead', code: 'RELATIONSHIP_VIOLATION' };
      }
    }

    // Validate RequirementID belongs to Lead (if provided)
    if (payload.RequirementID) {
      const req = (db.Requirements || []).find(r => r.RequirementID === payload.RequirementID);
      if (!req) return { ok: false, error: 'Requirement not found', code: 'REQ_NOT_FOUND' };
      if (req.LeadID !== payload.LeadID) {
        return { ok: false, error: 'Requirement does not belong to this Lead', code: 'RELATIONSHIP_VIOLATION' };
      }
    }

    const actType = (payload.ActivityType || payload.activityType || 'NOTE').toUpperCase();
    if (!VALID_TYPES.has(actType)) {
      return { ok: false, error: `Invalid ActivityType: ${actType}`, code: 'INVALID_TYPE' };
    }

    const dir = (payload.ActivityDirection || payload.activityDirection || '').toUpperCase();
    if (dir && !VALID_DIRECTIONS.has(dir)) {
      return { ok: false, error: `Invalid ActivityDirection: ${dir}`, code: 'INVALID_DIRECTION' };
    }

    db.Activities = db.Activities || [];
    const eventKey = payload.DedupKey || payload.dedupKey || payload.EventKey || payload.eventKey || payload._eventKey || null;
    if (eventKey) {
      const dedupeCompanyId = String(lead.CompanyID || payload.CompanyID || payload.companyId || actor.companyId || actor.companyID || '').trim();
      const dedupeBrokerageId = String(lead.BrokerageID || payload.BrokerageID || payload.brokerageId || actor.brokerageId || actor.brokerageID || '').trim();
      const existing = db.Activities.find((row) =>
        row &&
        row._eventKey === eventKey &&
        row.LeadID === payload.LeadID &&
        String(row.CompanyID || '').trim() === dedupeCompanyId &&
        String(row.BrokerageID || '').trim() === dedupeBrokerageId
      );
      if (existing) {
        return { ok: true, deduped: true, data: existing, requirementPatch: null };
      }
    }
    const activity = {
      ActivityID:        this.repo.createId('ACT'),
      LeadID:            payload.LeadID,
      TransactionID:     payload.TransactionID     || null,
      RequirementID:     payload.RequirementID     || null,
      ActivityType:      actType,
      ActivityDirection: dir || null,
      Summary:           payload.Summary           || payload.summary  || '',
      Details:           payload.Details           || payload.details  || payload.Notes || payload.notes || '',
      Notes:             payload.Notes             || payload.notes || payload.Details || payload.details || '',
      Outcome:           payload.Outcome           || payload.outcome  || null,
      NextAction:        payload.NextAction        || payload.nextAction || null,
      FollowUpDate:      payload.FollowUpDate      || payload.followUpDate || null,
      CompanyID:         lead.CompanyID || payload.CompanyID || payload.companyId || actor.companyId || actor.companyID || null,
      BrokerageID:       lead.BrokerageID || payload.BrokerageID || payload.brokerageId || actor.brokerageId || actor.brokerageID || null,
      Version:           1,
      CreatedBy:         actor.userId              || 'system',
      CreatedAt:         new Date().toISOString(),
      UpdatedAt:         new Date().toISOString(),
      _eventKey:         eventKey
    };

    db.Activities.push(activity);

    // Update Lead's last_activity_at
    const leadIdx = db.Leads.findIndex(l => l.LeadID === payload.LeadID);
    if (leadIdx !== -1) {
      db.Leads[leadIdx].last_activity_at = activity.CreatedAt;
      db.Leads[leadIdx].UpdatedAt        = activity.CreatedAt;
    }

    // Timeline entry
    db.Timeline = db.Timeline || [];
    db.Timeline.push({
      TimelineID: this.repo.createId('TIM'),
      LeadID:     payload.LeadID,
      EntityType: 'Activity',
      EntityID:   activity.ActivityID,
      EventType:  actType,
      EventTitle: activity.Summary || actType,
      EventDate:  activity.CreatedAt,
      Payload:    { ActivityID: activity.ActivityID, ActivityType: actType, _eventKey: eventKey }
    });

    this.repo.write(db);

    // Optional: PATCH Requirement fields captured during conversation
    let reqPatchResult = null;
    if (payload.RequirementID && payload.FieldUpdates && Object.keys(payload.FieldUpdates).length > 0) {
      if (this.reqSvc) {
        reqPatchResult = this.reqSvc.updateRequirement(
          payload.RequirementID,
          payload.FieldUpdates,
          actor
        );
      }
    }

    return {
      ok:   true,
      data: activity,
      requirementPatch: reqPatchResult
    };
  }

  updateActivity(activityId, patch = {}, actor = {}) {
    const db = this.repo.read();
    db.Activities = db.Activities || [];
    const idx = db.Activities.findIndex((row) => row.ActivityID === activityId);
    if (idx === -1) return { ok: false, error: 'Activity not found', code: 'NOT_FOUND' };

    const existing = db.Activities[idx];
    const lead = (db.Leads || []).find((row) => row.LeadID === existing.LeadID);
    if (!lead) return { ok: false, error: 'Lead not found', code: 'LEAD_NOT_FOUND' };

    const nextTransactionId = patch.TransactionID !== undefined ? patch.TransactionID : existing.TransactionID;
    if (nextTransactionId) {
      const txn = (db.Transactions || []).find((row) => row.TransactionID === nextTransactionId);
      if (!txn) return { ok: false, error: 'Transaction not found', code: 'TXN_NOT_FOUND' };
      if (txn.LeadID !== existing.LeadID) return { ok: false, error: 'Transaction does not belong to this Lead', code: 'RELATIONSHIP_VIOLATION' };
      if ((lead.CompanyID && txn.CompanyID && txn.CompanyID !== lead.CompanyID) || (lead.BrokerageID && txn.BrokerageID && txn.BrokerageID !== lead.BrokerageID)) {
        return { ok: false, error: 'Transaction tenant mismatch', code: 'RELATIONSHIP_VIOLATION' };
      }
    }

    const nextRequirementId = patch.RequirementID !== undefined ? patch.RequirementID : existing.RequirementID;
    if (nextRequirementId) {
      const requirement = (db.Requirements || []).find((row) => row.RequirementID === nextRequirementId);
      if (!requirement) return { ok: false, error: 'Requirement not found', code: 'REQ_NOT_FOUND' };
      if (requirement.LeadID !== existing.LeadID) return { ok: false, error: 'Requirement does not belong to this Lead', code: 'RELATIONSHIP_VIOLATION' };
      if ((lead.CompanyID && requirement.CompanyID && requirement.CompanyID !== lead.CompanyID) || (lead.BrokerageID && requirement.BrokerageID && requirement.BrokerageID !== lead.BrokerageID)) {
        return { ok: false, error: 'Requirement tenant mismatch', code: 'RELATIONSHIP_VIOLATION' };
      }
    }

    const updated = {
      ...existing,
      TransactionID: nextTransactionId || null,
      RequirementID: nextRequirementId || null,
      Summary: patch.Summary !== undefined ? patch.Summary : (patch.summary !== undefined ? patch.summary : existing.Summary),
      Details: patch.Details !== undefined ? patch.Details : (patch.details !== undefined ? patch.details : (patch.Notes !== undefined ? patch.Notes : (patch.notes !== undefined ? patch.notes : existing.Details))),
      Notes: patch.Notes !== undefined ? patch.Notes : (patch.notes !== undefined ? patch.notes : (patch.Details !== undefined ? patch.Details : (patch.details !== undefined ? patch.details : existing.Notes))),
      Outcome: patch.Outcome !== undefined ? patch.Outcome : (patch.outcome !== undefined ? patch.outcome : existing.Outcome),
      NextAction: patch.NextAction !== undefined ? patch.NextAction : (patch.nextAction !== undefined ? patch.nextAction : existing.NextAction),
      FollowUpDate: patch.FollowUpDate !== undefined ? patch.FollowUpDate : (patch.followUpDate !== undefined ? patch.followUpDate : existing.FollowUpDate),
      UpdatedAt: new Date().toISOString(),
      UpdatedBy: actor.userId || existing.UpdatedBy || 'system',
      Version: Number(existing.Version || 1) + 1
    };

    db.Activities[idx] = updated;
    this.repo.write(db);
    return { ok: true, data: updated };
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  getActivity(activityId) {
    const db  = this.repo.read();
    const act = (db.Activities || []).find(a => a.ActivityID === activityId);
    if (!act) return { ok: false, error: 'Activity not found', code: 'NOT_FOUND' };
    return { ok: true, data: act };
  }

  listActivitiesByLead(leadId, opts = {}) {
    const db   = this.repo.read();
    const lead = (db.Leads || []).find(l => l.LeadID === leadId);
    if (!lead) return { ok: false, error: 'Lead not found', code: 'LEAD_NOT_FOUND' };

    let acts = (db.Activities || []).filter(a => a.LeadID === leadId);

    if (opts.ActivityType) {
      acts = acts.filter(a => a.ActivityType === opts.ActivityType.toUpperCase());
    }
    if (opts.RequirementID) {
      acts = acts.filter(a => a.RequirementID === opts.RequirementID);
    }
    if (opts.TransactionID) {
      acts = acts.filter(a => a.TransactionID === opts.TransactionID);
    }

    acts.sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());

    const limit = opts.limit ? Math.min(Number(opts.limit), 200) : 50;
    return { ok: true, data: acts.slice(0, limit), total: acts.length };
  }

  listActivitiesByRequirement(requirementId) {
    const db  = this.repo.read();
    const req = (db.Requirements || []).find(r => r.RequirementID === requirementId);
    if (!req) return { ok: false, error: 'Requirement not found', code: 'NOT_FOUND' };

    const acts = (db.Activities || [])
      .filter(a => a.RequirementID === requirementId)
      .sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());

    return { ok: true, data: acts };
  }

  listActivitiesByTransaction(transactionId) {
    const db  = this.repo.read();
    const txn = (db.Transactions || []).find(t => t.TransactionID === transactionId);
    if (!txn) return { ok: false, error: 'Transaction not found', code: 'NOT_FOUND' };

    const acts = (db.Activities || [])
      .filter(a => a.TransactionID === transactionId)
      .sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());

    return { ok: true, data: acts };
  }
}

module.exports = { V2ActivityService };
