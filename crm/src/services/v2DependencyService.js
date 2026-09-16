/**
 * PHASE 10 — Dependency Engine
 *
 * Determines per-field dependency state (RELEVANT | NOT_RELEVANT | HIDDEN | VISIBLE)
 * based on TransactionType, Category, SubCategory, and previously-known field values.
 *
 * Architecture:
 *   FieldConfig    → "What fields exist?"
 *   FormRegistry   → "Which form applies to T/C/SC?"
 *   DependencyEngine → "Under the current context+answers, which fields are relevant?"
 *
 * Three layers must remain SEPARATE. This service owns only the third layer.
 *
 * ─── UNKNOWN behaviour ─────────────────────────────────────────────────────────
 * When a SourceField is UNKNOWN (absent, or state='UNKNOWN'):
 *   - EXISTS  → false (the value is not known, therefore cannot be said to exist)
 *   - NOT_EXISTS → true (value is not known yet)
 *   - All value-comparison operators (EQUALS, IN, GT, …) → false (rule does NOT fire)
 * This prevents a hidden UNKNOWN from accidentally suppressing or surfacing fields.
 *
 * ─── State precedence ──────────────────────────────────────────────────────────
 * When multiple rules target the same field, the highest-priority STATE wins:
 *   NOT_RELEVANT = 1  (strongest — field is irrelevant for this context)
 *   HIDDEN       = 2  (field exists but is hidden from view)
 *   RELEVANT     = 3  (agent should capture this)
 *   VISIBLE      = 4  (weakest hint — just show it)
 *
 * Priority of the RULE record (lower number = higher rule priority) is secondary
 * tiebreaker inside the same STATE.
 *
 * ─── Default when no rule matches ────────────────────────────────────────────
 *   - Field is in the resolved FormConfig for the given T/C/SC → RELEVANT
 *   - Field is NOT in the FormConfig (outside this context) → NOT_RELEVANT
 *
 * ─── FormVersion behaviour ───────────────────────────────────────────────────
 * When evaluating from a stored Requirement, the Requirement's FormVersion is
 * respected for FormConfig resolution (via FormRegistryService). Dependency rules
 * are always evaluated using the CURRENT active ruleset — stored rules are not
 * pinned per-Requirement (rules control relevance, not validity). If the active
 * ruleset is unavailable, fall back to static rules.
 *
 * ─── Safety rules inherited from Phase 7 ────────────────────────────────────
 * RELEVANT ≠ mandatory. Absent/UNKNOWN fields remain valid.
 * NOT_RELEVANT does NOT remove a field from an existing Requirement.
 * This service has NO write access to Requirement records.
 */

'use strict';

const {
  STATIC_DEPENDENCY_RULES,
  DEPENDENCY_CONFIG_VERSION,
  STATE,
  OP
} = require('../data/v2DependencyConfig');

// ── State precedence map ───────────────────────────────────────────────────────
const STATE_PRECEDENCE = {
  [STATE.NOT_RELEVANT]: 1,
  [STATE.HIDDEN]:       2,
  [STATE.RELEVANT]:     3,
  [STATE.VISIBLE]:      4
};

// ── V2DependencyService ────────────────────────────────────────────────────────

class V2DependencyService {
  constructor(repository, formRegistryService) {
    if (!repository)          throw new Error('V2DependencyService requires a repository');
    if (!formRegistryService) throw new Error('V2DependencyService requires a formRegistryService');
    this.repository = repository;
    this.registrySvc = formRegistryService;
  }

  // ── Seed ──────────────────────────────────────────────────────────────────

  /**
   * Seed V2DependencyConfig from static rules if the DB collection is empty.
   * Idempotent — safe to call on every startup.
   */
  seedDependencyConfigIfEmpty() {
    const db = this.repository.read();
    let changed = false;

    if (!Array.isArray(db.V2DependencyConfig)) {
      db.V2DependencyConfig = [];
      changed = true;
    }

    const existing = Array.isArray(db.V2DependencyConfig) ? db.V2DependencyConfig : [];
    const byId = new Map(existing.map((row) => [row.DependencyID, row]));
    const merged = STATIC_DEPENDENCY_RULES.map((row) => ({ ...byId.get(row.DependencyID), ...row }));
    const knownIds = new Set(STATIC_DEPENDENCY_RULES.map((row) => row.DependencyID));
    const extras = existing.filter((row) => row && row.DependencyID && !knownIds.has(row.DependencyID));
    const nextRows = [...merged, ...extras];

    if (JSON.stringify(nextRows) !== JSON.stringify(existing)) {
      db.V2DependencyConfig = nextRows;
      changed = true;
    }

    if (changed) this.repository.write(db);
    return { seeded: changed, count: db.V2DependencyConfig.length };
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * Return all active dependency rules from DB (falls back to static).
   * Filters: { transactionType, category, subCategory, targetField, isActive }
   */
  getDependencyRules(filters = {}) {
    const db = this.repository.read();
    let rows = (Array.isArray(db.V2DependencyConfig) && db.V2DependencyConfig.length > 0)
      ? db.V2DependencyConfig
      : STATIC_DEPENDENCY_RULES;

    // Active-only by default
    if (filters.isActive !== false) {
      rows = rows.filter((r) => r.IsActive !== false);
    }
    if (filters.transactionType) rows = rows.filter((r) => r.TransactionType === filters.transactionType);
    if (filters.category)        rows = rows.filter((r) => r.Category        === filters.category);
    if (filters.subCategory)     rows = rows.filter((r) => r.SubCategory     === filters.subCategory);
    if (filters.targetField)     rows = rows.filter((r) => r.TargetField     === filters.targetField);

    return rows;
  }

  /**
   * Return all rules that could apply to a given form context.
   * A rule applies if ALL its non-null context fields match.
   */
  getRulesForForm(txnType, category, subCategory) {
    const db = this.repository.read();
    const all = (Array.isArray(db.V2DependencyConfig) && db.V2DependencyConfig.length > 0)
      ? db.V2DependencyConfig
      : STATIC_DEPENDENCY_RULES;

    return all.filter((r) => {
      if (r.IsActive === false) return false;
      if (r.TransactionType !== null && r.TransactionType !== undefined && r.TransactionType !== txnType)    return false;
      if (r.Category        !== null && r.Category        !== undefined && r.Category        !== category)   return false;
      if (r.SubCategory     !== null && r.SubCategory     !== undefined && r.SubCategory     !== subCategory) return false;
      return true;
    });
  }

  // ── Operator evaluation ───────────────────────────────────────────────────

  /**
   * Evaluate a single operator against a source field state.
   *
   * @param {Object} fieldEntry  — { state: 'UNKNOWN'|'KNOWN'|'NOT_APPLICABLE', value: any }
   * @param {string} operator    — one of OP.*
   * @param {*}      expected    — the expected value (may be array for IN/NOT_IN)
   * @returns {boolean}
   */
  evaluateOperator(fieldEntry, operator, expected) {
    const state = fieldEntry ? fieldEntry.state : 'UNKNOWN';
    const value = fieldEntry ? fieldEntry.value : undefined;
    const isKnown = state === 'KNOWN';

    switch (operator) {
      case OP.EXISTS:
        // A field "exists" only when it is KNOWN with a non-null, non-empty value
        return isKnown && value !== null && value !== undefined && value !== '';

      case OP.NOT_EXISTS:
        // Inverse — true when UNKNOWN/absent or explicitly set to null/empty
        return !isKnown || value === null || value === undefined || value === '';

      case OP.EQUALS:
        if (!isKnown) return false;
        // Coerce for numeric comparisons
        return String(value) === String(expected);

      case OP.NOT_EQUALS:
        if (!isKnown) return false;
        return String(value) !== String(expected);

      case OP.IN: {
        if (!isKnown) return false;
        const list = Array.isArray(expected) ? expected.map(String) : [String(expected)];
        return list.includes(String(value));
      }

      case OP.NOT_IN: {
        if (!isKnown) return false;
        const list = Array.isArray(expected) ? expected.map(String) : [String(expected)];
        return !list.includes(String(value));
      }

      case OP.GREATER_THAN:
        if (!isKnown) return false;
        return Number(value) > Number(expected);

      case OP.GREATER_THAN_OR_EQUAL:
        if (!isKnown) return false;
        return Number(value) >= Number(expected);

      case OP.LESS_THAN:
        if (!isKnown) return false;
        return Number(value) < Number(expected);

      case OP.LESS_THAN_OR_EQUAL:
        if (!isKnown) return false;
        return Number(value) <= Number(expected);

      case OP.CONTAINS:
        if (!isKnown) return false;
        return String(value).includes(String(expected));

      case OP.NOT_CONTAINS:
        if (!isKnown) return false;
        return !String(value).includes(String(expected));

      default:
        // Unknown operator — conservative: rule does not fire
        return false;
    }
  }

  /**
   * Evaluate a single rule against the given context + field map.
   * Returns the ResultState if the rule fires, or null if it doesn't.
   */
  evaluateRule(rule, context) {
    const fields = context.fields || {};

    // If the rule has a field condition, evaluate it
    if (rule.SourceField) {
      const entry = fields[rule.SourceField] || null;
      const fired = this.evaluateOperator(entry, rule.Operator, rule.ExpectedValue);
      if (!fired) return null;
    }
    // Context-only rule (no SourceField) — already filtered by getRulesForForm, always fires
    return rule.ResultState;
  }

  // ── Core evaluation ───────────────────────────────────────────────────────

  /**
   * Resolve the dependency state for a single target field.
   *
   * @param {string}   targetField — the field key to evaluate
   * @param {Object[]} rules       — candidate rules (already filtered by form context)
   * @param {Object}   context     — { transactionType, category, subCategory, fields }
   * @param {Set}      formFieldKeys — set of field keys present in the resolved FormConfig
   * @returns {'RELEVANT'|'NOT_RELEVANT'|'HIDDEN'|'VISIBLE'}
   */
  resolveFieldState(targetField, rules, context, formFieldKeys) {
    const applicable = rules.filter((r) => r.TargetField === targetField);

    // Collect fired states with their precedence
    const fired = [];
    for (const r of applicable) {
      const state = this.evaluateRule(r, context);
      if (state !== null) {
        fired.push({ state, priority: r.Priority || 50, precedence: STATE_PRECEDENCE[state] || 99 });
      }
    }

    if (fired.length === 0) {
      // Default: field in FormConfig → RELEVANT; field outside → NOT_RELEVANT
      return formFieldKeys.has(targetField) ? STATE.RELEVANT : STATE.NOT_RELEVANT;
    }

    // Deterministic winner: lowest precedence number wins; ties broken by rule priority
    fired.sort((a, b) =>
      a.precedence !== b.precedence
        ? a.precedence - b.precedence
        : a.priority  - b.priority
    );

    return fired[0].state;
  }

  /**
   * Evaluate dependency states for ALL fields in the resolved FormConfig.
   *
   * @param {Object} context — { transactionType, category, subCategory, fields? }
   * @returns {{ [fieldKey: string]: string }}  — map of FieldKey → state
   */
  resolveAllFieldStates(context) {
    const { transactionType, category, subCategory } = context;
    const fields = context.fields || {};

    // 1. Get the resolved form config (field list for this T/C/SC)
    const formConfig = this.registrySvc.resolveFormConfig(transactionType, category, subCategory);
    const formFieldKeys = new Set((formConfig.fields || []).map((f) => f.FieldKey));

    // 2. Get all candidate rules for this form context
    const rules = this.getRulesForForm(transactionType, category, subCategory);

    // 3. Collect all unique TargetFields from rules + all FormConfig fields
    const allTargets = new Set([
      ...formFieldKeys,
      ...rules.map((r) => r.TargetField)
    ]);

    // 4. Resolve each field
    const result = {};
    for (const fk of allTargets) {
      result[fk] = this.resolveFieldState(fk, rules, context, formFieldKeys);
    }

    return result;
  }

  /**
   * Full dependency evaluation from a Requirement record.
   * Loads Requirement + Transaction, then calls resolveAllFieldStates.
   *
   * Returns { ok, context, fields } or { ok: false, error }.
   */
  evaluateDependencies(requirementId) {
    const db = this.repository.read();

    const req = (db.Requirements || []).find((r) => r.RequirementID === requirementId);
    if (!req) return { ok: false, error: `Requirement not found: ${requirementId}` };

    const txn = (db.Transactions || []).find((t) => t.TransactionID === req.TransactionID);
    if (!txn) return { ok: false, error: `Transaction not found for Requirement ${requirementId}` };

    const context = {
      transactionType: txn.TransactionType || null,
      category:        req.Category        || null,
      subCategory:     req.SubCategory     || null,
      fields:          req.Fields          || {}
    };

    const fieldStates = this.resolveAllFieldStates(context);

    return {
      ok:      true,
      context: {
        transactionType: context.transactionType,
        category:        context.category,
        subCategory:     context.subCategory,
        requirementId:   requirementId,
        formVersion:     req.FormVersion || null
      },
      fields: fieldStates
    };
  }

  /**
   * Evaluate from a raw context object (no DB lookup needed).
   * context: { transactionType, category, subCategory, fields? }
   */
  evaluateContext(context) {
    if (!context || typeof context !== 'object') {
      return { ok: false, error: 'context is required' };
    }
    const fieldStates = this.resolveAllFieldStates(context);
    return {
      ok:      true,
      context: {
        transactionType: context.transactionType || null,
        category:        context.category        || null,
        subCategory:     context.subCategory     || null
      },
      fields: fieldStates
    };
  }

  // ── Static constants ──────────────────────────────────────────────────────

  static get STATE()             { return STATE;             }
  static get OP()                { return OP;                }
  static get STATE_PRECEDENCE()  { return STATE_PRECEDENCE;  }
  static get CONFIG_VERSION()    { return DEPENDENCY_CONFIG_VERSION; }
}

module.exports = { V2DependencyService, STATE, OP, STATE_PRECEDENCE };
