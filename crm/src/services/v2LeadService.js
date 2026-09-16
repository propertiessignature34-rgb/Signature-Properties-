/**
 * PHASE 4 — V2 Lead Service
 * PHASE 5 — Duplicate Protection
 *
 * All Lead create/update operations MUST go through LeadService V2.
 * This service enforces:
 *   - V2 field schema
 *   - ClientStatus + ClientLifecycle (independent)
 *   - Duplicate detection before creation
 *   - Server-controlled audit fields
 *   - Backward-compatible response adapters
 */

'use strict';

const { IdEngine }      = require('../data/idEngine');
const { EntityConfig, WorkflowConfig, TagConfig, ScoringConfig } = require('../data/v2Config');

const LEAD_STATUS_ALIASES = {
  Verified: 'Contacted',
  Active: 'Qualified',
  Inactive: 'Lost',
  Blacklisted: 'Lost',
  Converted: 'Won'
};

// ─── Contact Normalization (PHASE 5) ──────────────────────────────────────────

function normalizePhone(raw) {
  if (!raw) return null;
  // Strip all non-digit chars except leading +
  const cleaned = String(raw).replace(/[\s\-().]/g, '');
  // Remove country code prefix to get 10-digit form for matching
  return cleaned.replace(/^\+91/, '').replace(/^0/, '').replace(/^\+/, '');
}

function normalizeEmail(raw) {
  if (!raw) return null;
  return String(raw).trim().toLowerCase();
}

function normalizeName(raw) {
  if (!raw) return null;
  return String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
}

// ─── V2 Lead Service ──────────────────────────────────────────────────────────

class V2LeadService {
  constructor(repository, scoringService) {
    if (!repository) throw new Error('V2LeadService requires a repository');
    this.repository = repository;
    this.scoringSvc = scoringService || null;
    this.idEngine   = new IdEngine(repository);
  }

  // ── Duplicate Detection ────────────────────────────────────────────────────

  /**
   * Check for duplicate leads by mobile / alternate mobile / WhatsApp / email.
   * Returns: { result: 'EXACT_MATCH'|'POSSIBLE_MATCH'|'NO_MATCH', candidates }
   */
  checkDuplicate(payload) {
    const mobile    = normalizePhone(payload.PrimaryMobile || payload.primaryMobile || payload.Phone || payload.phone);
    const altMobile = normalizePhone(payload.AlternateMobile || payload.alternateMobile);
    const whatsapp  = normalizePhone(payload.WhatsApp || payload.whatsapp);
    const email     = normalizeEmail(payload.Email || payload.email);
    const name      = normalizeName(payload.ClientName || payload.clientName);

    const db     = this.repository.read();
    const leads  = db.Leads || [];
    const exact  = [];
    const possible = [];

    for (const lead of leads) {
      const lMobile    = normalizePhone(lead.PrimaryMobile || lead.Phone);
      const lAlt       = normalizePhone(lead.AlternateMobile);
      const lWhatsapp  = normalizePhone(lead.WhatsApp);
      const lEmail     = normalizeEmail(lead.Email);
      const lName      = normalizeName(lead.ClientName);

      // Exact match: same primary mobile OR same email
      const phoneMatch = mobile && lMobile && mobile === lMobile;
      const emailMatch = email && lEmail && email === lEmail;
      const altMatch   = altMobile && (altMobile === lMobile || altMobile === lAlt);
      const waMatch    = whatsapp  && (whatsapp  === lMobile || whatsapp  === lWhatsapp);

      if (phoneMatch || emailMatch) {
        exact.push(this._maskCandidate(lead, 'EXACT_MATCH'));
        continue;
      }

      if (altMatch || waMatch) {
        possible.push(this._maskCandidate(lead, 'POSSIBLE_MATCH'));
        continue;
      }

      // Possible: same name + partial phone overlap
      if (name && lName && name === lName) {
        possible.push(this._maskCandidate(lead, 'POSSIBLE_MATCH'));
      }
    }

    if (exact.length > 0) {
      return { result: 'EXACT_MATCH', candidates: exact, possibleCandidates: possible };
    }
    if (possible.length > 0) {
      return { result: 'POSSIBLE_MATCH', candidates: possible };
    }
    return { result: 'NO_MATCH', candidates: [] };
  }

  /** Mask PII for duplicate candidate response */
  _maskCandidate(lead, matchType) {
    const phone = lead.PrimaryMobile || lead.Phone || '';
    const email = lead.Email || '';
    return {
      LeadID:        lead.LeadID,
      ClientName:    lead.ClientName,
      MaskedMobile:  phone ? phone.replace(/(\+?\d{2,3}?)(\d{3})\d{4}(\d{3})/, '$1$2****$3') : null,
      MaskedEmail:   email ? email.replace(/(.{2})[^@]*(@.*)/, '$1***$2') : null,
      ClientStatus:  lead.ClientStatus || lead.LeadStatus,
      AssignedAgentID: lead.AssignedAgentID,
      MatchType:     matchType
    };
  }

  // ── Create Lead ────────────────────────────────────────────────────────────

  /**
   * Create a new V2 Lead.
   * @param {object} payload - lead data
   * @param {object} actor   - { userId, role }
   * @param {object} options - { allowPossibleDuplicate: boolean }
   */
  createLead(payload, actor = {}, options = {}) {
    const now = new Date().toISOString();

    // Second duplicate check immediately before creation
    const dupCheck = this.checkDuplicate(payload);
    if (dupCheck.result === 'EXACT_MATCH') {
      return {
        ok: false,
        error: 'A lead with this mobile or email already exists',
        duplicateResult: 'EXACT_MATCH',
        candidates: dupCheck.candidates
      };
    }
    if (dupCheck.result === 'POSSIBLE_MATCH' && !options.allowPossibleDuplicate) {
      return {
        ok: false,
        error: 'Possible duplicate detected. Confirm to proceed.',
        duplicateResult: 'POSSIBLE_MATCH',
        candidates: dupCheck.candidates,
        requiresConfirmation: true
      };
    }

    const clientStatus    = this._validateStatus(payload.ClientStatus || payload.LeadStatus || payload.leadStatus || 'New');
    const clientLifecycle = this._validateLifecycle(payload.ClientLifecycle || payload.clientLifecycle || 'Prospect');
    const tags            = this._normalizeTags(payload.Tags || payload.tags || []);
    const source          = payload.Source || payload.source || payload.LeadSource || 'Manual';

    const leadId = this.idEngine.nextLeadId();

    const lead = {
      LeadID:           leadId,
      ClientName:       payload.ClientName || payload.clientName || null,
      PrimaryMobile:    payload.PrimaryMobile || payload.primaryMobile || payload.Phone || payload.phone || null,
      AlternateMobile:  payload.AlternateMobile || payload.alternateMobile || null,
      WhatsApp:         payload.WhatsApp || payload.whatsapp || null,
      Email:            payload.Email || payload.email || null,
      ClientStatus:     clientStatus,
      ClientLifecycle:  clientLifecycle,
      ClientScore:      0,
      Source:           source,
      LeadSource:       source,       // backward compat
      LeadStatus:       clientStatus, // backward compat
      Phone:            payload.Phone || payload.phone || payload.PrimaryMobile || payload.primaryMobile || null, // backward compat
      City:             payload.City || payload.city || null,
      RequirementProfile: payload.RequirementProfile || payload.requirementProfile || null,
      BudgetMax:        payload.BudgetMax || payload.budgetMax || payload.Budget || payload.budget || null,
      BudgetMin:        payload.BudgetMin || payload.budgetMin || null,
      Location1:        payload.Location1 || payload.location1 || payload.Location || payload.location || null,
      PropertyType:     payload.PropertyType || payload.propertyType || payload.SubCategory || payload.subCategory || null,
      RequirementType:  payload.RequirementType || payload.requirementType || payload.TransactionType || payload.transactionType || null,
      AssignedAgentID:  payload.AssignedAgentID || payload.assignedAgentId || actor.userId || 'USR-0001',
      CompanyID:        payload.CompanyID || payload.companyId || actor.companyId || actor.companyID || null,
      BrokerageID:      payload.BrokerageID || payload.brokerageId || actor.brokerageId || actor.brokerageID || null,
      Tags:             tags,
      Notes:            payload.Notes || payload.notes || '',
      CreatedBy:        actor.userId || 'system',
      CreatedAt:        now,
      UpdatedBy:        actor.userId || 'system',
      UpdatedAt:        now,
      Version:          1,
      RecordHash:       null,
      LegacyID:         payload.LegacyID || null,
      _v2:              true,
      ArchiveFlag:      false,
      last_activity_at: now
    };

    // Compute initial score
    this._applyClientScore(lead, 0, 0);
    lead.RecordHash  = this._hash(lead);

    const db = this.repository.read();
    db.Leads = db.Leads || [];
    db.Leads.push(lead);
    this.repository.write(db);

    // Timeline entry
    this.repository.addTimelineEntry(leadId, 'Lead', leadId, 'LEAD_CREATED', 'Client created', { ClientName: lead.ClientName, ClientStatus: lead.ClientStatus });

    return { ok: true, data: lead };
  }

  // ── Update Lead ────────────────────────────────────────────────────────────

  updateLead(leadId, payload, actor = {}) {
    const db = this.repository.read();
    db.Leads  = db.Leads || [];
    const idx = db.Leads.findIndex((l) => l.LeadID === leadId);
    if (idx === -1) return { ok: false, error: 'Lead not found' };

    const existing = db.Leads[idx];

    // Guard immutable fields
    if (payload.LeadID && payload.LeadID !== leadId) {
      return { ok: false, error: 'LeadID is immutable' };
    }

    const now = new Date().toISOString();

    // Status transitions
    let clientStatus = this._normalizeStatus(existing.ClientStatus || existing.LeadStatus || 'New');
    if (payload.ClientStatus || payload.LeadStatus || payload.leadStatus) {
      const next = this._normalizeStatus(payload.ClientStatus || payload.LeadStatus || payload.leadStatus);
      const valid = this._validateStatusTransition(clientStatus, next);
      if (!valid.ok) return valid;
      clientStatus = next;
    }

    let clientLifecycle = existing.ClientLifecycle || 'Prospect';
    if (payload.ClientLifecycle || payload.clientLifecycle) {
      const next = payload.ClientLifecycle || payload.clientLifecycle;
      const valid = this._validateLifecycleTransition(clientLifecycle, next);
      if (!valid.ok) return valid;
      clientLifecycle = next;
    }

    const tags   = payload.Tags || payload.tags ? this._normalizeTags(payload.Tags || payload.tags) : existing.Tags || [];
    const source = payload.Source || payload.source || payload.LeadSource || existing.Source || existing.LeadSource || 'Manual';
    const previousStatus = this._normalizeStatus(existing.ClientStatus || existing.LeadStatus || 'New');

    const updated = {
      ...existing,
      ClientName:      payload.ClientName || payload.clientName || existing.ClientName,
      PrimaryMobile:   payload.PrimaryMobile || payload.primaryMobile || payload.Phone || payload.phone || existing.PrimaryMobile,
      AlternateMobile: payload.AlternateMobile || payload.alternateMobile || existing.AlternateMobile,
      WhatsApp:        payload.WhatsApp || payload.whatsapp || existing.WhatsApp,
      Email:           payload.Email || payload.email || existing.Email,
      ClientStatus:    clientStatus,
      ClientLifecycle: clientLifecycle,
      Source:          source,
      LeadSource:      source,
      LeadStatus:      clientStatus,
      Phone:           payload.Phone || payload.phone || payload.PrimaryMobile || payload.primaryMobile || existing.Phone,
      City:            payload.City || payload.city || existing.City,
      RequirementProfile: payload.RequirementProfile || payload.requirementProfile || existing.RequirementProfile || null,
      BudgetMax:       payload.BudgetMax || payload.budgetMax || payload.Budget || payload.budget || existing.BudgetMax || null,
      BudgetMin:       payload.BudgetMin || payload.budgetMin || existing.BudgetMin || null,
      Location1:       payload.Location1 || payload.location1 || payload.Location || payload.location || existing.Location1 || null,
      PropertyType:    payload.PropertyType || payload.propertyType || payload.SubCategory || payload.subCategory || existing.PropertyType || null,
      RequirementType: payload.RequirementType || payload.requirementType || payload.TransactionType || payload.transactionType || existing.RequirementType || null,
      AssignedAgentID: payload.AssignedAgentID || payload.assignedAgentId || existing.AssignedAgentID,
      CompanyID: payload.CompanyID || payload.companyId || existing.CompanyID || actor.companyId || actor.companyID || null,
      BrokerageID: payload.BrokerageID || payload.brokerageId || existing.BrokerageID || actor.brokerageId || actor.brokerageID || null,
      Tags:            tags,
      Notes:           payload.Notes !== undefined ? payload.Notes : (payload.notes !== undefined ? payload.notes : existing.Notes),
      UpdatedBy:       actor.userId || 'system',
      UpdatedAt:       now,
      Version:         (existing.Version || 1) + 1
    };

    const wasLost = previousStatus === 'Lost';
    const isLost = clientStatus === 'Lost';
    if (isLost) {
      const lostReason = payload.LostReason || payload.lostReason || payload.LostStatusReason || existing.LostReason || null;
      const lostNote = payload.LostNote ?? payload.lostNote ?? payload.LostNotes ?? payload.LostRemark ?? existing.LostNote ?? null;
      if (!lostReason) return { ok: false, error: 'LostReason is required when marking lead as Lost' };
      updated.LostReason = lostReason;
      updated.LostNote = lostNote;
      updated.LostAt = existing.LostAt || now;
    } else if (wasLost && !isLost) {
      updated.ReactivatedAt = now;
    }

    const hasMeaningfulChange = [
      'ClientName', 'PrimaryMobile', 'AlternateMobile', 'WhatsApp', 'Email', 'ClientStatus', 'ClientLifecycle',
      'Source', 'LeadSource', 'LeadStatus', 'Phone', 'City', 'RequirementProfile', 'BudgetMax', 'BudgetMin',
      'Location1', 'PropertyType', 'RequirementType', 'AssignedAgentID', 'CompanyID', 'BrokerageID', 'Notes',
      'LostReason', 'LostNote', 'LostAt', 'ReactivatedAt'
    ].some((key) => JSON.stringify(existing[key] ?? null) !== JSON.stringify(updated[key] ?? null))
      || JSON.stringify(existing.Tags || []) !== JSON.stringify(updated.Tags || []);

    if (!hasMeaningfulChange) {
      return { ok: true, data: existing };
    }

    updated.RecordHash = this._hash(updated);

    db.Leads[idx] = updated;
    if (clientStatus !== previousStatus && typeof this.repository.appendLeadStatusTransitionArtifacts === 'function') {
      this.repository.appendLeadStatusTransitionArtifacts(db, {
        lead: updated,
        previousStatus,
        nextStatus: clientStatus,
        occurredAt: updated.UpdatedAt,
        actorUserId: actor.userId || 'system'
      });
    } else {
      this.repository.write(db);
      this.repository.addTimelineEntry(leadId, 'Lead', leadId, 'LEAD_UPDATED', 'Client updated', { ClientStatus: updated.ClientStatus, ClientLifecycle: updated.ClientLifecycle });
      return { ok: true, data: updated };
    }

    this.repository.write(db);

    return { ok: true, data: updated };
  }

  markLeadLost(leadId, payload = {}, actor = {}) {
    const patch = {
      ClientStatus: 'Lost',
      LostReason: payload.LostReason || payload.lostReason || null,
      LostNote: payload.LostNote || payload.lostNote || null
    };
    return this.updateLead(leadId, patch, actor);
  }

  reactivateLead(leadId, payload = {}, actor = {}) {
    const targetStatus = this._normalizeStatus(payload.ClientStatus || payload.LeadStatus || payload.leadStatus || 'Contacted');
    if (targetStatus === 'Lost') return { ok: false, error: 'Reactivation target status cannot be Lost' };
    return this.updateLead(leadId, { ClientStatus: targetStatus }, actor);
  }

  // ── Score Recalculation ────────────────────────────────────────────────────

  recalculateScore(leadId) {
    const db    = this.repository.read();
    const leads = db.Leads || [];
    const idx   = leads.findIndex((l) => l.LeadID === leadId);
    if (idx === -1) return { ok: false, error: 'Lead not found' };

    const lead     = leads[idx];
    const txnCount = (db.Transactions || []).filter((t) => t.LeadID === leadId).length;
    const reqCount = (db.Requirements || []).filter((r) => r.LeadID === leadId).length;

    const updated = { ...lead };
    this._applyClientScore(updated, txnCount, reqCount);
    updated.UpdatedAt = new Date().toISOString();
    leads[idx]  = updated;
    db.Leads    = leads;
    this.repository.write(db);

    return { ok: true, data: { LeadID: leadId, ClientScore: updated.ClientScore } };
  }

  // ── Tag Helpers ────────────────────────────────────────────────────────────

  addTag(leadId, tag, actor = {}) {
    const validTags = TagConfig.availableTags.map((t) => t.value);
    if (!validTags.includes(tag)) {
      return { ok: false, error: `Unknown tag: ${tag}. Valid tags: ${validTags.join(', ')}` };
    }
    const db  = this.repository.read();
    const idx = (db.Leads || []).findIndex((l) => l.LeadID === leadId);
    if (idx === -1) return { ok: false, error: 'Lead not found' };
    const lead = db.Leads[idx];
    const tags = Array.from(new Set([...(lead.Tags || []), tag]));
    db.Leads[idx] = { ...lead, Tags: tags, UpdatedAt: new Date().toISOString(), UpdatedBy: actor.userId || 'system' };
    this.repository.write(db);
    return { ok: true, data: { LeadID: leadId, Tags: tags } };
  }

  removeTag(leadId, tag, actor = {}) {
    const db  = this.repository.read();
    const idx = (db.Leads || []).findIndex((l) => l.LeadID === leadId);
    if (idx === -1) return { ok: false, error: 'Lead not found' };
    const lead = db.Leads[idx];
    const tags = (lead.Tags || []).filter((t) => t !== tag);
    db.Leads[idx] = { ...lead, Tags: tags, UpdatedAt: new Date().toISOString(), UpdatedBy: actor.userId || 'system' };
    this.repository.write(db);
    return { ok: true, data: { LeadID: leadId, Tags: tags } };
  }

  // ── List / Find Helpers ────────────────────────────────────────────────────

  listLeads(filters = {}) {
    const db    = this.repository.read();
    let rows    = db.Leads || [];

    if (filters.ClientStatus)   rows = rows.filter((r) => r.ClientStatus === filters.ClientStatus || r.LeadStatus === filters.ClientStatus);
    if (filters.ClientLifecycle) rows = rows.filter((r) => r.ClientLifecycle === filters.ClientLifecycle);
    if (filters.AssignedAgentID) rows = rows.filter((r) => r.AssignedAgentID === filters.AssignedAgentID);
    if (filters.tag)             rows = rows.filter((r) => (r.Tags || []).includes(filters.tag));
    if (filters.source)          rows = rows.filter((r) => (r.Source || r.LeadSource) === filters.source);
    if (filters.search) {
      const q = String(filters.search).toLowerCase();
      rows = rows.filter((r) => {
        const name  = String(r.ClientName || '').toLowerCase();
        const phone = String(r.PrimaryMobile || r.Phone || '').replace(/\s/g, '');
        const email = String(r.Email || '').toLowerCase();
        return name.includes(q) || phone.includes(q.replace(/\s/g, '')) || email.includes(q);
      });
    }

    return rows.sort((a, b) => new Date(b.UpdatedAt || b.CreatedAt).getTime() - new Date(a.UpdatedAt || a.CreatedAt).getTime());
  }

  findLeadByMobile(mobile) {
    const norm  = normalizePhone(mobile);
    if (!norm) return null;
    const leads = this.repository.read().Leads || [];
    return leads.find((l) => normalizePhone(l.PrimaryMobile || l.Phone) === norm
                          || normalizePhone(l.AlternateMobile) === norm
                          || normalizePhone(l.WhatsApp) === norm) || null;
  }

  // ── Validators ─────────────────────────────────────────────────────────────

  _validateStatus(status) {
    const valid = EntityConfig.Lead.statuses;
    status = this._normalizeStatus(status);
    if (!valid.includes(status)) return valid[0];
    return status;
  }

  _validateLifecycle(lifecycle) {
    const valid = EntityConfig.Lead.lifecycles;
    if (!valid.includes(lifecycle)) return valid[0];
    return lifecycle;
  }

  _validateStatusTransition(from, to) {
    from = this._normalizeStatus(from);
    to = this._normalizeStatus(to);
    const allowed = WorkflowConfig.leadStatus.transitions[from] || [];
    if (!allowed.includes(to) && from !== to) {
      return { ok: false, error: `Lead status transition from '${from}' to '${to}' is not allowed` };
    }
    return { ok: true };
  }

  _normalizeStatus(status) {
    const value = String(status || '').trim();
    if (!value) return EntityConfig.Lead.defaultStatus || 'New';
    return LEAD_STATUS_ALIASES[value] || value;
  }

  _validateLifecycleTransition(from, to) {
    const allowed = WorkflowConfig.clientLifecycle.transitions[from] || [];
    if (!allowed.includes(to) && from !== to) {
      return { ok: false, error: `Client lifecycle transition from '${from}' to '${to}' is not allowed` };
    }
    return { ok: true };
  }

  _normalizeTags(tags) {
    if (!Array.isArray(tags)) tags = [];
    const valid = TagConfig.availableTags.map((t) => t.value);
    return tags.filter((t) => valid.includes(t));
  }

  // ── Scoring ────────────────────────────────────────────────────────────────

  /**
   * Apply scoring to a lead in-place.
   * Uses V2ScoringService if injected, falls back to legacy _computeClientScore.
   */
  _applyClientScore(lead, txnCount, reqCount) {
    if (this.scoringSvc) {
      const result = this.scoringSvc.calculateClientScore(lead, txnCount, reqCount);
      lead.ClientScore                   = result.ok ? result.score : 0;
      lead.ClientScoreBreakdown          = result.ok ? result      : null;
      lead.ClientScoreCalculationVersion = result.ok ? result.calculationVersion : null;
      lead.ClientScoreCalculatedAt       = result.ok ? result.calculatedAt       : null;
    } else {
      const score = this._computeClientScore(lead, txnCount, reqCount);
      lead.ClientScore = typeof score === 'object' ? score.total : score;
    }
  }

  _computeClientScore(lead, txnCount, reqCount) {
    const cfg   = ScoringConfig.client;
    let score   = 0;
    const breakdown = {};

    for (const rule of cfg.rules) {
      let pts = 0;
      if (rule.field === 'ClientStatus') {
        pts = rule.scoring[lead.ClientStatus] || 0;
      } else if (rule.field === 'ClientLifecycle') {
        pts = rule.scoring[lead.ClientLifecycle] || 0;
      } else if (rule.field === 'hasPhone') {
        pts = rule.scoring[String(!!(lead.PrimaryMobile || lead.Phone))] || 0;
      } else if (rule.field === 'hasEmail') {
        pts = rule.scoring[String(!!lead.Email)] || 0;
      } else if (rule.field === 'hasTags') {
        pts = rule.scoring[String(!!(lead.Tags && lead.Tags.length > 0))] || 0;
      } else if (rule.field === 'transactionCount') {
        pts = Math.min(rule.maxScore, Math.round((Math.min(txnCount, rule.maxValue) / rule.maxValue) * rule.maxScore));
      } else if (rule.field === 'requirementCount') {
        pts = Math.min(rule.maxScore, Math.round((Math.min(reqCount, rule.maxValue) / rule.maxValue) * rule.maxScore));
      }
      breakdown[rule.field] = pts;
      score += pts;
    }

    return { total: Math.min(score, cfg.maxScore), breakdown };
  }

  _hash(obj) {
    const { RecordHash: _rh, UpdatedAt: _ua, ...rest } = obj;
    const str = JSON.stringify(rest, Object.keys(rest).sort());
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16);
  }
}

module.exports = { V2LeadService, normalizePhone, normalizeEmail };
