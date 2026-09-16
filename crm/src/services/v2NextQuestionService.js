/**
 * PHASE 11 — Next Question Engine
 *
 * Identifies the most useful unanswered questions for the agent to ask the
 * client during a conversation, based on the current Requirement state.
 *
 * ─── Pipeline ────────────────────────────────────────────────────────────────
 *   FormRegistry → resolved field list for T/C/SC
 *         ↓
 *   DependencyEngine → per-field relevance state (RELEVANT/NOT_RELEVANT/HIDDEN/VISIBLE)
 *         ↓
 *   NextQuestionEngine → candidates = RELEVANT|VISIBLE ∩ UNKNOWN
 *         ↓
 *   Ranked questions (CORE → IMPORTANT → OPTIONAL, then DisplayOrder)
 *         ↓
 *   Top N questions with explanation
 *
 * ─── Cardinal rules ──────────────────────────────────────────────────────────
 * 1. Only fields whose dependency state is RELEVANT or VISIBLE are candidates.
 * 2. Only UNKNOWN fields are candidates (KNOWN / NOT_APPLICABLE are excluded).
 * 3. UNKNOWN ≠ NO. The engine never infers a value from absence.
 * 4. The engine is 100% READ-ONLY. It never mutates any Requirement record.
 * 5. One FieldKey → one recommended question (deduplication).
 * 6. This engine does NOT block Requirement creation/PATCH.
 *    Its role is recommendation, not validation.
 * 7. FormVersion of the stored Requirement is respected for context resolution.
 *
 * ─── Ranking ─────────────────────────────────────────────────────────────────
 * Primary:   Tier  (CORE=1 > IMPORTANT=2 > OPTIONAL=3)
 * Secondary: DisplayOrder (ascending — lower = more important within tier)
 * Tertiary:  FieldConfigID (stable tiebreaker for determinism)
 *
 * ─── Reason generation ───────────────────────────────────────────────────────
 * Each recommended question carries an explainable reason derived from:
 *  - Section (Budget, Location, Property, Extras…)
 *  - Tier (CORE, IMPORTANT, OPTIONAL)
 *  - Current known fields (how many already captured)
 *  - TransactionType + Category context
 * No black-box scoring. Every reason string is traceable to a config rule.
 */

'use strict';

// ── Tier rank map (lower number = higher priority) ────────────────────────────
const TIER_RANK = { CORE: 1, IMPORTANT: 2, OPTIONAL: 3 };

// ── Section-based reason templates ───────────────────────────────────────────
const SECTION_REASON = {
  transaction: 'Clarifies the core transaction intent for this requirement.',
  budget:      'Helps define the financial scope and narrows candidate property results.',
  location:    'Captures location preference — critical for shortlisting.',
  property:    'Describes the desired property characteristics for this {category} requirement.',
  extras:      'Provides additional preference detail that improves match quality.',
  default:     'This information helps build a more complete requirement profile.'
};

// ── Tier-based supplementary context ─────────────────────────────────────────
const TIER_SUPPLEMENT = {
  CORE:      'This is a core field with high impact on search accuracy.',
  IMPORTANT: 'This significantly refines the property recommendation.',
  OPTIONAL:  'Nice to capture; improves recommendation precision.'
};

// ── V2NextQuestionService ──────────────────────────────────────────────────────

class V2NextQuestionService {
  /**
   * @param {object} repository         — JsonRepository
   * @param {object} dependencyService  — V2DependencyService (Phase 10)
   * @param {object} configService      — V2ConfigService (Phase 8)
   */
  constructor(repository, dependencyService, configService) {
    if (!repository)        throw new Error('V2NextQuestionService requires a repository');
    if (!dependencyService) throw new Error('V2NextQuestionService requires a dependencyService');
    if (!configService)     throw new Error('V2NextQuestionService requires a configService');

    this.repository  = repository;
    this.depSvc      = dependencyService;
    this.configSvc   = configService;
  }

  // ── Primary API ───────────────────────────────────────────────────────────

  /**
   * Get the top ranked next questions for a given Requirement.
   *
   * @param {string} requirementId
   * @param {{ limit?: number }} options
   * @returns {{ ok, requirementId, questions, totalCandidates, context }}
   */
  getNextQuestions(requirementId, options = {}) {
    const limit = this._parseLimit(options.limit);

    // 1. Load Requirement + Transaction
    const load = this._loadRequirement(requirementId);
    if (!load.ok) return { ok: false, error: load.error };
    const { requirement, transaction } = load;

    // 2. Build evaluation context from stored Requirement
    const context = {
      transactionType: transaction.TransactionType || null,
      category:        requirement.Category        || null,
      subCategory:     requirement.SubCategory     || null,
      fields:          requirement.Fields          || {}
    };

    // 3. Get dependency states (RELEVANT / NOT_RELEVANT / HIDDEN / VISIBLE)
    const depResult = this.depSvc.evaluateContext(context);
    if (!depResult.ok) {
      return { ok: false, error: `Dependency evaluation failed: ${depResult.error}` };
    }
    const fieldStates = depResult.fields; // { FieldKey → 'RELEVANT'|'NOT_RELEVANT'|... }

    // 4. Get field metadata map (FieldKey → best-scoped FieldConfig entry)
    const fieldConfigMap = this._buildFieldConfigMap(context);

    // 5. Find candidates: dependency = RELEVANT|VISIBLE AND requirement = UNKNOWN
    const candidates = this._findCandidates(fieldStates, context.fields, fieldConfigMap);

    // 6. Rank candidates
    const ranked = this._rankCandidates(candidates);

    // 7. Deduplicate by FieldKey (already one per key, but guard anyway)
    const deduped = this._deduplicate(ranked);

    // 8. Trim to limit and build response questions
    const topN  = deduped.slice(0, limit);
    const questions = topN.map((c) => this._buildQuestion(c, context, requirement));

    return {
      ok:              true,
      requirementId,
      context: {
        transactionType: context.transactionType,
        category:        context.category,
        subCategory:     context.subCategory,
        formVersion:     requirement.FormVersion || null
      },
      questions,
      totalCandidates: deduped.length,
      reason: questions.length === 0
        ? 'No additional relevant unanswered questions are currently configured.'
        : null
    };
  }

  /**
   * Convenience: return only the single top question (or null).
   */
  getNextQuestion(requirementId) {
    const result = this.getNextQuestions(requirementId, { limit: 1 });
    if (!result.ok) return result;
    return {
      ok:            result.ok,
      requirementId: result.requirementId,
      question:      result.questions[0] || null,
      reason:        result.reason || null,
      context:       result.context
    };
  }

  /**
   * Rank a candidate list from scratch for a given context (no DB lookup).
   * Used for direct context evaluation and testing.
   *
   * @param {Object} context — { transactionType, category, subCategory, fields }
   * @param {{ limit?: number }} options
   * @returns {{ ok, questions, totalCandidates }}
   */
  rankQuestions(context, options = {}) {
    const limit = this._parseLimit(options.limit);
    if (!context || typeof context !== 'object') {
      return { ok: false, error: 'context is required' };
    }

    const enrichedContext = {
      ...context,
      fields: {
        ...(context.fields || {}),
        ...(context.transactionType ? { TransactionType: { state: 'KNOWN', value: context.transactionType } } : {}),
        ...(context.category ? { Category: { state: 'KNOWN', value: context.category } } : {}),
        ...(context.subCategory ? { SubCategory: { state: 'KNOWN', value: context.subCategory } } : {})
      }
    };

    const depResult = this.depSvc.evaluateContext(enrichedContext);
    if (!depResult.ok) {
      return { ok: false, error: `Dependency evaluation failed: ${depResult.error}` };
    }

    const fieldConfigMap = this._buildFieldConfigMap(enrichedContext);
    const candidates     = this._findCandidates(depResult.fields, enrichedContext.fields || {}, fieldConfigMap);
    const ranked         = this._rankCandidates(candidates);
    const deduped        = this._deduplicate(ranked);
    const topN           = deduped.slice(0, limit);
    const questions      = topN.map((c) => this._buildQuestion(c, enrichedContext, null));

    return {
      ok:              true,
      context: enrichedContext,
      questions,
      totalCandidates: deduped.length,
      reason: questions.length === 0
        ? 'No additional relevant unanswered questions are currently configured.'
        : null
    };
  }

  /**
   * Generate an explanation for a specific question in context.
   */
  explainQuestion(fieldKey, context, requirement) {
    const fieldConfigMap = this._buildFieldConfigMap(context || {});
    const meta           = fieldConfigMap[fieldKey];
    if (!meta) return { ok: false, error: `No FieldConfig found for: ${fieldKey}` };

    const depResult = this.depSvc.evaluateContext(context || {});
    const depState  = depResult.ok ? (depResult.fields[fieldKey] || 'UNKNOWN') : 'UNKNOWN';

    return {
      ok:            true,
      fieldKey,
      label:         meta.QuestionLabel || meta.FieldLabel || fieldKey,
      dependencyState: depState,
      tier:          meta.Tier,
      section:       meta.Section,
      explanation:   this._buildReason(meta, context || {}, requirement)
    };
  }

  // ── Internal — loading ────────────────────────────────────────────────────

  _loadRequirement(requirementId) {
    const db  = this.repository.read();
    const req = (db.Requirements || []).find((r) => r.RequirementID === requirementId);
    if (!req) return { ok: false, error: `Requirement not found: ${requirementId}` };

    const txn = (db.Transactions || []).find((t) => t.TransactionID === req.TransactionID);
    if (!txn) return { ok: false, error: `Transaction not found for Requirement ${requirementId}` };

    return { ok: true, requirement: req, transaction: txn };
  }

  // ── Internal — field config ───────────────────────────────────────────────

  /**
   * Build a FieldKey → best-scoped FieldConfig map for the given context.
   * Context-specific entries (Category/TransactionType match) beat null-scoped ones.
   */
  _buildFieldConfigMap(context) {
    const { transactionType, category } = context;
    const allRows = this.configSvc.getFieldConfig();
    const map     = {};

    for (const fc of allRows) {
      if (!fc.Active) continue;
      const existing = map[fc.FieldKey];
      if (!existing) {
        map[fc.FieldKey] = fc;
        continue;
      }
      // Prefer context-specific over null-scoped
      const newCatMatch  = fc.Category        === category        && category        != null;
      const newTxnMatch  = fc.TransactionType === transactionType && transactionType != null;
      const oldCatMatch  = existing.Category        === category        && category        != null;

      if (newCatMatch && !oldCatMatch)         map[fc.FieldKey] = fc;
      else if (newCatMatch && newTxnMatch)      map[fc.FieldKey] = fc;
    }

    return map;
  }

  // ── Internal — candidate selection ───────────────────────────────────────

  /**
   * Find candidate fields: dependency state RELEVANT|VISIBLE, requirement state UNKNOWN.
   *
   * Exclusion criteria:
   *   - FieldKey already KNOWN or NOT_APPLICABLE in the requirement
   *   - Dependency state is NOT_RELEVANT or HIDDEN
   *   - No FieldConfig found (no question label available)
   */
  _findCandidates(fieldStates, requirementFields, fieldConfigMap) {
    const candidates = [];
    const seen       = new Set();

    for (const [fk, depState] of Object.entries(fieldStates)) {
      if (seen.has(fk)) continue;

      // Dependency filter
      if (depState !== 'RELEVANT' && depState !== 'VISIBLE') continue;

      // Requirement field state filter
      const fieldEntry = requirementFields[fk];
      const reqState   = fieldEntry ? fieldEntry.state : 'UNKNOWN';
      if (reqState === 'KNOWN' || reqState === 'NOT_APPLICABLE') continue;
      // reqState is UNKNOWN (absent or explicit UNKNOWN) — valid candidate

      // Must have FieldConfig metadata for a question label
      const meta = fieldConfigMap[fk];
      if (!meta) continue;

      seen.add(fk);
      candidates.push({
        fieldKey:       fk,
        depState,
        meta,
        tierRank:       TIER_RANK[meta.Tier] || 9,
        displayOrder:   meta.DisplayOrder    || 99,
        fieldConfigId:  meta.FieldConfigID   || ''
      });
    }

    return candidates;
  }

  // ── Internal — ranking ────────────────────────────────────────────────────

  /**
   * Sort candidates deterministically:
   * 1. tierRank   (CORE=1 first)
   * 2. displayOrder (ascending)
   * 3. fieldConfigId (stable string tiebreaker)
   */
  _rankCandidates(candidates) {
    return candidates.slice().sort((a, b) => {
      if (a.tierRank   !== b.tierRank)     return a.tierRank   - b.tierRank;
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return a.fieldConfigId.localeCompare(b.fieldConfigId);
    });
  }

  // ── Internal — deduplication ──────────────────────────────────────────────

  /**
   * Ensure each FieldKey appears at most once.
   * After sorting the list is already ordered by priority, so keep the first occurrence.
   */
  _deduplicate(ranked) {
    const seen = new Set();
    return ranked.filter((c) => {
      if (seen.has(c.fieldKey)) return false;
      seen.add(c.fieldKey);
      return true;
    });
  }

  // ── Internal — question shape ─────────────────────────────────────────────

  /**
   * Build the final question object for the API response.
   */
  _buildQuestion(candidate, context, requirement) {
    const { fieldKey, depState, meta } = candidate;
    return {
      questionId:      meta.FieldConfigID || `Q-${fieldKey.toUpperCase()}`,
      fieldKey,
      label:           meta.QuestionLabel || meta.FieldLabel || fieldKey,
      fieldType:       meta.FieldType     || 'Text',
      options:         Array.isArray(meta.Options) && meta.Options.length > 0 ? meta.Options : [],
      tier:            meta.Tier          || 'OPTIONAL',
      section:         meta.Section       || null,
      displayOrder:    meta.DisplayOrder  || 99,
      priority:        this._computePriority(meta),
      dependencyState: depState,
      reason:          this._buildReason(meta, context, requirement)
    };
  }

  /**
   * Numeric priority for the API response (100 = highest, 0 = lowest).
   * Derived from tier + displayOrder so consumers can sort easily.
   */
  _computePriority(meta) {
    const tierBase = { CORE: 90, IMPORTANT: 60, OPTIONAL: 30 }[meta.Tier] || 10;
    // Subtract a fraction of displayOrder so lower DisplayOrder → higher priority
    const orderPenalty = Math.min((meta.DisplayOrder || 0) * 0.5, 20);
    return Math.round(Math.max(tierBase - orderPenalty, 1));
  }

  /**
   * Generate a human-readable reason for why this question is recommended.
   */
  _buildReason(meta, context, requirement) {
    const { transactionType, category, subCategory } = context;
    const section    = (meta.Section || '').toLowerCase();
    const label      = meta.FieldLabel || meta.fieldKey || 'This field';

    // Count how many fields are already KNOWN in the current Requirement
    const fields     = (requirement && requirement.Fields) ? requirement.Fields : (context.fields || {});
    const knownCount = Object.values(fields).filter((f) => f && f.state === 'KNOWN').length;

    // Section-specific base reason
    let baseReason = SECTION_REASON.default;
    if (section.includes('budget'))   baseReason = SECTION_REASON.budget;
    else if (section.includes('location'))  baseReason = SECTION_REASON.location;
    else if (section.includes('transaction')) baseReason = SECTION_REASON.transaction;
    else if (section.includes('property'))  {
      baseReason = SECTION_REASON.property.replace('{category}', category || 'property');
    }
    else if (section.includes('extras'))    baseReason = SECTION_REASON.extras;

    // Context-specific augmentation
    const contextParts = [];
    if (transactionType) contextParts.push(transactionType);
    if (category)        contextParts.push(category);
    if (subCategory)     contextParts.push(subCategory);
    const contextStr = contextParts.length > 0 ? contextParts.join(' › ') : null;

    const tierNote  = TIER_SUPPLEMENT[meta.Tier] || TIER_SUPPLEMENT.OPTIONAL;
    const progress  = knownCount > 0
      ? `${knownCount} field${knownCount > 1 ? 's' : ''} already captured — `
      : '';

    const contextNote = contextStr
      ? ` Relevant for the current ${contextStr} context.`
      : '';

    return `${progress}${label}: ${baseReason}${contextNote} ${tierNote}`.trim();
  }

  // ── Internal — utilities ──────────────────────────────────────────────────

  _parseLimit(raw) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) return Math.min(n, 10); // hard cap at 10
    return 3; // default
  }
}

module.exports = { V2NextQuestionService };
