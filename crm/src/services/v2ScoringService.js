/**
 * PHASE 12 — V2 Scoring Service
 *
 * Provides configurable, explainable scoring for:
 *   A. Requirement (RequirementScore)
 *   B. Client/Lead  (ClientScore)
 *
 * ─── Cardinal rules ──────────────────────────────────────────────────────────
 * 1. UNKNOWN ≠ NO.  UNKNOWN fields are excluded from scoring (no penalty).
 * 2. Rules come from DB (V2ScoringConfig) with static fallback.
 * 3. Score is normalized: earned / maxApplicable * 100 (UNKNOWN excluded
 *    from BOTH numerator and denominator).
 * 4. Every factor is explainable: label + reason + state + contribution.
 * 5. This service is READ-ONLY in calculateRequirement/ClientScore.
 *    recalculate* methods write back to DB.
 * 6. No hardcoded business rule logic inside this service —
 *    all rules come from V2ScoringConfig / static seed.
 *
 * ─── Normalization ───────────────────────────────────────────────────────────
 *   effectiveMax = sum of `weight` for KNOWN applicable factors
 *   rawScore     = sum of earned contributions for KNOWN applicable factors
 *   score        = round(rawScore / effectiveMax * 100), capped at 100
 *   If effectiveMax = 0 → score = 0
 *
 * ─── Field sources ───────────────────────────────────────────────────────────
 *   v2Field   — read from requirement.Fields[key]  (three-state map)
 *   flatField — read from requirement[key] or lead[key] directly
 *   computed  — derived value (hasPhone, transactionCount, etc.)
 */

'use strict';

const {
  SCORING_CONFIG_VERSION,
  STATIC_SCORE_BANDS,
  STATIC_REQUIREMENT_SCORING_RULES,
  STATIC_CLIENT_SCORING_RULES
} = require('../data/v2ScoringConfig');

// ── Field value helper ────────────────────────────────────────────────────────

function v2FieldValue(fieldsMap, key) {
  const entry = fieldsMap && fieldsMap[key];
  if (!entry) return { state: 'UNKNOWN', value: undefined };
  return entry;
}

// ── V2ScoringService ──────────────────────────────────────────────────────────

class V2ScoringService {
  /**
   * @param {object} repository        — JsonRepository
   * @param {object} dependencyService — V2DependencyService (Phase 10), optional
   */
  constructor(repository, dependencyService) {
    if (!repository) throw new Error('V2ScoringService requires a repository');
    this.repository = repository;
    this.depSvc     = dependencyService || null;
  }

  // ── Configuration seeding ─────────────────────────────────────────────────

  /**
   * Seed the DB with static scoring config if not already seeded.
   * Idempotent — safe to call on every startup.
   */
  seedScoringConfigIfEmpty() {
    const db = this.repository.read();
    if (!Array.isArray(db.V2ScoringConfig) || db.V2ScoringConfig.length === 0) {
      const now = new Date().toISOString();
      const seed = [
        ...STATIC_REQUIREMENT_SCORING_RULES,
        ...STATIC_CLIENT_SCORING_RULES
      ].map((r) => ({ ...r, createdAt: now, updatedAt: now }));
      db.V2ScoringConfig = seed;
      this.repository.write(db);
      return { seeded: true, count: seed.length };
    }
    return { seeded: false, count: db.V2ScoringConfig.length };
  }

  // ── Configuration readers ─────────────────────────────────────────────────

  getScoringRules(entityType) {
    const db   = this.repository.read();
    const rows = Array.isArray(db.V2ScoringConfig) && db.V2ScoringConfig.length > 0
      ? db.V2ScoringConfig
      : [...STATIC_REQUIREMENT_SCORING_RULES, ...STATIC_CLIENT_SCORING_RULES];

    return rows.filter((r) => r.entityType === entityType && r.active !== false);
  }

  getScoreBands() {
    const db = this.repository.read();
    return (Array.isArray(db.V2ScoreBands) && db.V2ScoreBands.length > 0)
      ? db.V2ScoreBands
      : STATIC_SCORE_BANDS;
  }

  resolveScoreBand(score) {
    const bands = this.getScoreBands();
    const band  = bands.find((b) => score >= b.min && score <= b.max);
    return band ? band.label : 'Unknown';
  }

  // ── Requirement scoring ───────────────────────────────────────────────────

  /**
   * Calculate a full explainable RequirementScore.
   * Read-only — does NOT write to DB.
   *
   * @param {object} requirement — Requirement record (with .Fields, .Category, etc.)
   * @returns RequirementScoreResult
   */
  calculateRequirementScore(requirement) {
    if (!requirement) return this._error('Requirement is required');

    const rules   = this.getScoringRules('Requirement');
    const context = {
      transactionType: this._resolveTransactionType(requirement),
      category:        requirement.Category    || null,
      subCategory:     requirement.SubCategory || null,
      fields:          requirement.Fields      || {}
    };

    // Get dependency states (optional — graceful if depSvc unavailable)
    const depStates = this._getDependencyStates(context);

    const factors             = [];
    const positiveContributions = [];
    const negativeContributions = [];
    const unknownFactors      = [];

    let rawScore    = 0;
    let effectiveMax = 0;

    for (const rule of rules) {
      // Check context applicability (category/transactionType filter)
      if (!this._ruleApplicable(rule, context)) continue;

      // Get field state from the requirement
      const { state, rawValue } = this._getFieldState(rule, requirement, context, depStates);

      const factorBase = {
        factorId:   rule.factorId,
        field:      rule.field,
        label:      rule.label,
        value:      rawValue,
        state,
        dependencyState: depStates[rule.field] || null
      };

      if (state === 'NOT_APPLICABLE' || state === 'NOT_RELEVANT') {
        // Excluded from calculation entirely
        continue;
      }

      if (state === 'UNKNOWN') {
        // UNKNOWN: excluded from both numerator and denominator (no penalty)
        const factor = {
          ...factorBase,
          contribution: 0,
          reason: `${rule.label}: relevant but not yet captured — no score contribution.`
        };
        factors.push(factor);
        unknownFactors.push({ factorId: rule.factorId, field: rule.field, label: rule.label, reason: factor.reason });
        continue;
      }

      // KNOWN — evaluate contribution
      const contribution = this._evalContribution(rule, rawValue);
      const maxContribution = rule.weight;

      effectiveMax += maxContribution;
      rawScore     += contribution;

      const reason = this._buildRequirementReason(rule, rawValue, contribution, maxContribution, context);
      const factor = { ...factorBase, contribution, reason };

      factors.push(factor);
      if (contribution > 0)  positiveContributions.push(factor);
      else                    negativeContributions.push(factor);
    }

    const score = effectiveMax > 0
      ? Math.round(Math.min((rawScore / effectiveMax) * 100, 100))
      : 0;

    const band          = this.resolveScoreBand(score);
    const calculatedAt  = new Date().toISOString();

    return {
      ok: true,
      score,
      band,
      factors,
      positiveContributions,
      negativeContributions,
      unknownFactors,
      calculationVersion: SCORING_CONFIG_VERSION,
      calculatedAt
    };
  }

  // ── Client scoring ────────────────────────────────────────────────────────

  /**
   * Calculate a full explainable ClientScore.
   * Read-only — does NOT write to DB.
   *
   * @param {object} lead      — Lead record
   * @param {number} txnCount  — number of transactions for this lead
   * @param {number} reqCount  — number of requirements for this lead
   * @returns ClientScoreResult
   */
  calculateClientScore(lead, txnCount = 0, reqCount = 0) {
    if (!lead) return this._error('Lead is required');

    const rules = this.getScoringRules('Client');

    // Computed values
    const computed = {
      hasPhone:         !!(lead.PrimaryMobile || lead.Phone),
      hasEmail:         !!(lead.Email),
      hasTags:          !!(lead.Tags && lead.Tags.length > 0),
      transactionCount: txnCount,
      requirementCount: reqCount
    };

    const factors               = [];
    const positiveContributions = [];
    const negativeContributions = [];
    const unknownFactors        = [];

    let rawScore    = 0;
    let effectiveMax = 0;

    for (const rule of rules) {
      const { state, rawValue } = this._getClientFieldState(rule, lead, computed);

      const factorBase = {
        factorId: rule.factorId,
        field:    rule.field,
        label:    rule.label,
        value:    rawValue,
        state,
        dependencyState: null
      };

      if (state === 'UNKNOWN') {
        const factor = {
          ...factorBase,
          contribution: 0,
          reason: `${rule.label}: not available — no score contribution.`
        };
        factors.push(factor);
        unknownFactors.push({ factorId: rule.factorId, field: rule.field, label: rule.label, reason: factor.reason });
        continue;
      }

      const contribution    = this._evalContribution(rule, rawValue);
      const maxContribution = rule.weight;

      effectiveMax += maxContribution;
      rawScore     += contribution;

      const reason = this._buildClientReason(rule, rawValue, contribution, maxContribution);
      const factor = { ...factorBase, contribution, reason };

      factors.push(factor);
      if (contribution > 0)  positiveContributions.push(factor);
      else                    negativeContributions.push(factor);
    }

    const score = effectiveMax > 0
      ? Math.round(Math.min((rawScore / effectiveMax) * 100, 100))
      : 0;

    const band         = this.resolveScoreBand(score);
    const calculatedAt = new Date().toISOString();

    return {
      ok: true,
      score,
      band,
      factors,
      positiveContributions,
      negativeContributions,
      unknownFactors,
      calculationVersion: SCORING_CONFIG_VERSION,
      calculatedAt
    };
  }

  // ── Persistence helpers ───────────────────────────────────────────────────

  /**
   * Recalculate RequirementScore and persist it on the Requirement record.
   */
  recalculateRequirementScore(requirementId) {
    const db  = this.repository.read();
    const idx = (db.Requirements || []).findIndex((r) => r.RequirementID === requirementId);
    if (idx === -1) return { ok: false, error: `Requirement not found: ${requirementId}` };

    const req    = db.Requirements[idx];
    const result = this.calculateRequirementScore(req);
    if (!result.ok) return result;

    db.Requirements[idx] = {
      ...req,
      RequirementScore:          result.score,
      ScoreBreakdown:            result,
      ScoreCalculationVersion:   result.calculationVersion,
      ScoreCalculatedAt:         result.calculatedAt,
      UpdatedAt:                 result.calculatedAt
    };
    this.repository.write(db);

    return { ok: true, requirementId, ...result };
  }

  /**
   * Recalculate ClientScore and persist it on the Lead record.
   */
  recalculateClientScore(leadId) {
    const db  = this.repository.read();
    const idx = (db.Leads || []).findIndex((l) => l.LeadID === leadId);
    if (idx === -1) return { ok: false, error: `Lead not found: ${leadId}` };

    const lead     = db.Leads[idx];
    const txnCount = (db.Transactions || []).filter((t) => t.LeadID === leadId).length;
    const reqCount = (db.Requirements || []).filter((r) => r.LeadID === leadId).length;

    const result = this.calculateClientScore(lead, txnCount, reqCount);
    if (!result.ok) return result;

    db.Leads[idx] = {
      ...lead,
      ClientScore:                    result.score,
      ClientScoreBreakdown:           result,
      ClientScoreCalculationVersion:  result.calculationVersion,
      ClientScoreCalculatedAt:        result.calculatedAt,
      UpdatedAt:                      result.calculatedAt
    };
    this.repository.write(db);

    return { ok: true, leadId, ...result };
  }

  // ── Internal — context helpers ────────────────────────────────────────────

  _resolveTransactionType(requirement) {
    // RequirementService stores TransactionType derived from Transaction
    // but may also be on a flat field in older records
    if (requirement.TransactionType) return requirement.TransactionType;
    // Try to resolve from DB
    const db = this.repository.read();
    const txn = (db.Transactions || []).find((t) => t.TransactionID === requirement.TransactionID);
    return txn ? txn.TransactionType : null;
  }

  _getDependencyStates(context) {
    if (!this.depSvc) return {};
    try {
      const res = this.depSvc.evaluateContext(context);
      return res.ok ? res.fields : {};
    } catch (_) {
      return {};
    }
  }

  // ── Internal — rule applicability ─────────────────────────────────────────

  _ruleApplicable(rule, context) {
    if (!rule.applicableWhen) return true;
    const { transactionType, category } = rule.applicableWhen;
    if (transactionType && context.transactionType !== transactionType) return false;
    if (category       && context.category       !== category)       return false;
    return true;
  }

  // ── Internal — field state resolution ────────────────────────────────────

  /**
   * Determine the effective state of a scoring factor field in a Requirement.
   * Returns { state: 'KNOWN'|'UNKNOWN'|'NOT_APPLICABLE'|'NOT_RELEVANT', rawValue }
   */
  _getFieldState(rule, requirement, context, depStates) {
    const { field, fieldSource } = rule;

    // Check dependency state if we have it
    if (depStates[field] === 'NOT_RELEVANT' || depStates[field] === 'HIDDEN') {
      return { state: 'NOT_RELEVANT', rawValue: undefined };
    }

    if (fieldSource === 'v2Field') {
      const entry = v2FieldValue(context.fields, field);
      const state = entry.state || 'UNKNOWN';
      if (state === 'NOT_APPLICABLE') return { state: 'NOT_APPLICABLE', rawValue: undefined };
      if (state === 'UNKNOWN')        return { state: 'UNKNOWN', rawValue: undefined };
      return { state: 'KNOWN', rawValue: entry.value };
    }

    if (fieldSource === 'flatField') {
      const val = requirement[field];
      if (val === null || val === undefined || val === '') {
        return { state: 'UNKNOWN', rawValue: undefined };
      }
      return { state: 'KNOWN', rawValue: val };
    }

    // computed — not applicable for Requirement context (those are Client-side)
    return { state: 'UNKNOWN', rawValue: undefined };
  }

  /**
   * Determine the effective state of a scoring factor field for a Client/Lead.
   */
  _getClientFieldState(rule, lead, computed) {
    const { field, fieldSource } = rule;

    if (fieldSource === 'computed') {
      const val = computed[field];
      if (val === null || val === undefined) return { state: 'UNKNOWN', rawValue: undefined };
      return { state: 'KNOWN', rawValue: val };
    }

    if (fieldSource === 'flatField') {
      const val = lead[field];
      if (val === null || val === undefined || val === '') {
        return { state: 'UNKNOWN', rawValue: undefined };
      }
      return { state: 'KNOWN', rawValue: val };
    }

    return { state: 'UNKNOWN', rawValue: undefined };
  }

  // ── Internal — contribution evaluation ────────────────────────────────────

  /**
   * Compute the contribution for a KNOWN field given its rule.
   */
  _evalContribution(rule, rawValue) {
    const { scoreType, lookupMap, weight, maxValue, contribution } = rule;

    if (scoreType === 'fieldPresent') {
      // Field is KNOWN → full contribution
      return contribution !== null && contribution !== undefined ? contribution : weight;
    }

    if (scoreType === 'valueLookup') {
      if (!lookupMap) return 0;
      const key = String(rawValue);
      return lookupMap[key] !== undefined ? lookupMap[key] : 0;
    }

    if (scoreType === 'boolean') {
      return rawValue ? (contribution !== null && contribution !== undefined ? contribution : weight) : 0;
    }

    if (scoreType === 'linear') {
      if (maxValue == null || maxValue === 0) return 0;
      const capped = Math.min(Number(rawValue) || 0, maxValue);
      return Math.round((capped / maxValue) * weight);
    }

    return 0;
  }

  // ── Internal — reason generation ──────────────────────────────────────────

  _buildRequirementReason(rule, rawValue, contribution, maxContribution, context) {
    const { label, description, scoreType, lookupMap } = rule;
    const ctxStr = [context.transactionType, context.category, context.subCategory]
      .filter(Boolean).join(' › ');

    if (contribution === maxContribution) {
      return `${label}: ${description}${ctxStr ? ` (${ctxStr})` : ''} — full contribution earned.`;
    }
    if (contribution === 0) {
      if (scoreType === 'valueLookup' && rawValue != null) {
        return `${label}: value "${rawValue}" does not earn score in the current configuration.`;
      }
      return `${label}: condition not met — no contribution.`;
    }
    if (scoreType === 'valueLookup' && lookupMap) {
      const max = Math.max(...Object.values(lookupMap));
      return `${label}: value "${rawValue}" contributes ${contribution} of ${max} possible points.`;
    }
    if (scoreType === 'linear') {
      return `${label}: ${rawValue} of ${rule.maxValue} maximum — partial contribution.`;
    }
    return `${label}: ${description} — contributes ${contribution} of ${maxContribution}.`;
  }

  _buildClientReason(rule, rawValue, contribution, maxContribution) {
    const { label, description, scoreType, lookupMap } = rule;

    if (contribution === maxContribution) {
      return `${label}: ${description} — full contribution earned.`;
    }
    if (contribution === 0) {
      if (scoreType === 'valueLookup' && rawValue != null) {
        return `${label}: value "${rawValue}" does not earn score in the current configuration.`;
      }
      return `${label}: condition not met — no contribution.`;
    }
    if (scoreType === 'valueLookup' && lookupMap) {
      const max = Math.max(...Object.values(lookupMap));
      return `${label}: "${rawValue}" contributes ${contribution} of ${max} possible points.`;
    }
    if (scoreType === 'linear') {
      return `${label}: ${rawValue} of ${rule.maxValue} maximum — partial contribution.`;
    }
    return `${label}: ${description} — contributes ${contribution} of ${maxContribution}.`;
  }

  // ── Internal — helpers ────────────────────────────────────────────────────

  _error(msg) {
    return { ok: false, error: msg };
  }
}

module.exports = { V2ScoringService, SCORING_CONFIG_VERSION };
