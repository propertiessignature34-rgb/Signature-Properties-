/**
 * PHASE 9 — Form Registry Service + Dynamic SubCategory Engine
 *
 * Responsibilities:
 *   1. DB-backed FormRegistry (seeded from static V2FormRegistry; fallback to static)
 *   2. Dynamic SubCategory resolution: derived from FormRegistry, not a hardcoded list
 *   3. resolveFormConfig: given T/C/SC, return merged config (form + fields + questions + dependencies)
 *
 * Architecture:
 *   FormRegistry (T/C/SC → form metadata + version)
 *     ↓ enriched by
 *   FieldConfig (per-field: type, options, tier, question labels) via V2ConfigService
 *     ↓ combined into
 *   resolvedFormConfig (single object the frontend/agent can consume without branching)
 *
 * Safety rules (unchanged from Phase 7):
 *   - FormVersion is immutable once stored on a Requirement.
 *   - ABSENT FIELD = UNKNOWN. Never a validation error.
 *   - FormRegistry defines "what CAN be captured", not "what MUST be captured".
 *   - No automatic migration of historical Requirements.
 */

'use strict';

const {
  V2FormRegistry: STATIC_FORM_REGISTRY,
  FORM_REGISTRY_VERSION
} = require('../data/v2Config');

// ── Static SubCategory definitions ─────────────────────────────────────────────
// Canonical list per category; kept in sync with V2FormRegistry.
// Frontend MUST NOT hardcode these — always request from API.
const STATIC_SUBCATEGORY_CONFIG = {
  Residential: ['Flat', 'Villa', 'Row House', 'Bungalow', 'Penthouse', 'Studio', 'Plot'],
  Commercial:  ['Office', 'Shop', 'Showroom', 'Warehouse'],
  Industrial:  ['Factory', 'Warehouse', 'Shed', 'Industrial Plot'],
  Land:        ['Residential Plot', 'Commercial Plot', 'Agricultural Land'],
  Agriculture: ['Agricultural Land', 'Farm House', 'Orchard']
};

// ── V2FormRegistryService ──────────────────────────────────────────────────────

class V2FormRegistryService {
  constructor(repository, configService) {
    if (!repository)    throw new Error('V2FormRegistryService requires a repository');
    if (!configService) throw new Error('V2FormRegistryService requires a configService');
    this.repository = repository;
    this.configSvc  = configService;
  }

  // ── Seed ──────────────────────────────────────────────────────────────────

  /**
   * Write FormRegistry records to DB if the collection is empty.
   * Idempotent: safe to call on every startup.
   */
  seedFormRegistryIfEmpty() {
    const db = this.repository.read();
    let changed = false;

    if (!Array.isArray(db.V2FormRegistry)) {
      db.V2FormRegistry = [];
      changed = true;
    }

    const existing = Array.isArray(db.V2FormRegistry) ? db.V2FormRegistry : [];
    const staticRows = this._buildDbFormRegistry();
    const byKey = new Map(existing.map((row) => [row.FormKey, row]));
    const merged = staticRows.map((row) => ({ ...byKey.get(row.FormKey), ...row }));
    const knownKeys = new Set(staticRows.map((row) => row.FormKey));
    const extras = existing.filter((row) => row && row.FormKey && !knownKeys.has(row.FormKey));
    const nextRows = [...merged, ...extras];

    if (JSON.stringify(nextRows) !== JSON.stringify(existing)) {
      db.V2FormRegistry = nextRows;
      changed = true;
    }

    if (changed) this.repository.write(db);

    return { seeded: changed, count: db.V2FormRegistry.length };
  }

  _buildDbFormRegistry() {
    let idx = 1;
    return Object.keys(STATIC_FORM_REGISTRY).map((key) => {
      const form = STATIC_FORM_REGISTRY[key];
      return {
        FormID:               `FORM-${String(idx++).padStart(3, '0')}`,
        FormKey:              key,
        TransactionType:      form.transactionType || null,
        Category:             form.category        || null,
        SubCategory:          form.subCategory      || null,
        FormVersion:          form.formVersion      || FORM_REGISTRY_VERSION,
        IsActive:             form.isActive !== false,
        DisplayName:          form.formName          || key,
        Description:          null,
        ConfigurationVersion: form.formVersion      || FORM_REGISTRY_VERSION,
        CreatedAt:            '2026-01-01T00:00:00.000Z',
        UpdatedAt:            '2026-01-01T00:00:00.000Z',
        _v2:                  true
      };
    });
  }

  // ── Read — FormRegistry ────────────────────────────────────────────────────

  /**
   * List FormRegistry entries.
   * DB config has priority; falls back to static if DB collection is empty.
   *
   * Filters: { transactionType, category, subCategory, isActive }
   */
  getAllForms(filters = {}) {
    const db = this.repository.read();
    let rows = (Array.isArray(db.V2FormRegistry) && db.V2FormRegistry.length > 0)
      ? db.V2FormRegistry
      : this._buildDbFormRegistry();

    if (filters.transactionType !== undefined && filters.transactionType !== null) {
      rows = rows.filter((r) => r.TransactionType === filters.transactionType);
    }
    if (filters.category !== undefined && filters.category !== null) {
      rows = rows.filter((r) => r.Category === filters.category);
    }
    if (filters.subCategory !== undefined && filters.subCategory !== null) {
      rows = rows.filter((r) => r.SubCategory === filters.subCategory);
    }
    if (filters.isActive !== undefined) {
      rows = rows.filter((r) => r.IsActive === filters.isActive);
    }

    return rows;
  }

  /**
   * Get a single FormRegistry entry by FormID.
   */
  getFormById(formId) {
    const all = this.getAllForms();
    return all.find((r) => r.FormID === formId) || null;
  }

  /**
   * Get a FormRegistry entry by canonical key (TransactionType|Category|SubCategory).
   * Falls back to the 'generic' entry when no match is found.
   */
  getFormByKey(txnType, category, subCategory) {
    const key = this._makeKey(txnType, category, subCategory);
    const all = this.getAllForms();
    return all.find((r) => r.FormKey === key)
        || all.find((r) => r.FormKey === 'generic')
        || null;
  }

  // ── Read — SubCategories ───────────────────────────────────────────────────

  /**
   * Return the available SubCategories for a given Category (and optional TransactionType).
   * Derived from FormRegistry — zero hardcoded branching in the frontend.
   *
   * Example:
   *   getSubCategories('Residential')
   *   → [{ value: 'Flat', label: 'Flat', isActive: true }, ...]
   */
  getSubCategories(category, transactionType) {
    if (!category) return [];

    const filterArgs = { category, isActive: true };
    if (transactionType) filterArgs.transactionType = transactionType;

    const forms = this.getAllForms(filterArgs);

    // Collect unique, non-null SubCategories in registry order
    const seen   = new Set();
    const result = [];
    for (const f of forms) {
      if (f.SubCategory && !seen.has(f.SubCategory)) {
        seen.add(f.SubCategory);
        result.push({ value: f.SubCategory, label: f.SubCategory, isActive: f.IsActive });
      }
    }

    // Static fallback when DB is empty or no matching forms
    if (result.length === 0) {
      const staticList = STATIC_SUBCATEGORY_CONFIG[category] || [];
      return staticList.map((sc) => ({ value: sc, label: sc, isActive: true }));
    }

    return result;
  }

  /**
   * Return all known Categories (derived from FormRegistry, no hardcoded list).
   */
  getCategories() {
    const all = this.getAllForms({ isActive: true });
    const seen = new Set();
    const result = [];
    for (const f of all) {
      if (f.Category && !seen.has(f.Category)) {
        seen.add(f.Category);
        result.push({ value: f.Category, label: f.Category, isActive: true });
      }
    }
    return result;
  }

  // ── Resolved Form Config ───────────────────────────────────────────────────

  /**
   * Resolve the full configuration for a given T/C/SC context.
   *
   * Returns a single merged object:
   * {
   *   transactionType, category, subCategory,
   *   formVersion, formId, formKey, displayName, isActive,
   *   fields:      [ enriched FieldConfig entries ],
   *   questions:   [ QuestionConfig entries for context ],
   *   dependencies:[ cross-field constraint rules ],
   *   options:     { FieldKey → options[] }
   * }
   *
   * Historical FormVersion note:
   *   This method resolves the CURRENT active config.
   *   A stored Requirement's FormVersion must be preserved and not overwritten.
   *   Caller is responsible for not updating FormVersion on existing Requirements.
   */
  resolveFormConfig(txnType, category, subCategory) {
    // 1. Form metadata (DB or static fallback)
    const formMeta  = this.getFormByKey(txnType, category, subCategory);
    const formKey   = this._makeKey(txnType, category, subCategory);
    const staticForm = STATIC_FORM_REGISTRY[formKey] || STATIC_FORM_REGISTRY.generic;

    // 2. Build a FieldKey → FieldConfig metadata map
    const allFieldConfig  = this.configSvc.getFieldConfig();
    const fieldConfigMap  = {};
    for (const fc of allFieldConfig) {
      // When multiple FieldConfig rows share a FieldKey (e.g. AreaMin for Residential vs Commercial),
      // prefer the one whose Category matches our context over the null-scoped one.
      const existing = fieldConfigMap[fc.FieldKey];
      if (!existing) {
        fieldConfigMap[fc.FieldKey] = fc;
      } else {
        // Context-specific entry wins over null-scoped
        const fcCatMatch  = fc.Category === category;
        const fcTxnMatch  = fc.TransactionType === txnType;
        const existCatMatch = existing.Category === category;
        if (fcCatMatch && !existCatMatch) fieldConfigMap[fc.FieldKey] = fc;
        else if (fcCatMatch && fcTxnMatch) fieldConfigMap[fc.FieldKey] = fc;
      }
    }

    // 3. Resolve fields from the static form definition, enriched with FieldConfig metadata
    const rawFields     = Object.values(staticForm.fields || {});
    const resolvedFieldMap = new Map();
    const seenKeysLower = new Set();
    rawFields.forEach((f) => {
      const fKey = f.fieldId || f.FieldKey || f.id;
      if (seenKeysLower.has(fKey.toLowerCase())) return;
      seenKeysLower.add(fKey.toLowerCase());
      const meta = fieldConfigMap[fKey] || fieldConfigMap[Object.keys(fieldConfigMap).find(k => k.toLowerCase() === fKey.toLowerCase())] || {};
      // If V2FieldConfig meta has Options + Type=Autocomplete, promote FieldType to Autocomplete
      const metaOpts = Array.isArray(meta.Options) && meta.Options.length ? meta.Options : null;
      let fieldType = f.fieldType || meta.FieldType || 'Text';
      if (metaOpts && (meta.FieldType === 'Autocomplete' || fieldType === 'Text')) {
        fieldType = 'Autocomplete';
      }
      resolvedFieldMap.set(fKey, {
        FieldKey:      fKey,
        FieldLabel:    f.fieldLabel   || meta.FieldLabel   || fKey,
        QuestionLabel: meta.QuestionLabel || f.fieldLabel  || `What is ${fKey}?`,
        FieldType:     fieldType,
        Tier:          meta.Tier          || 'OPTIONAL',
        RequiredMode:  meta.RequiredMode  || 'OPTIONAL',
        Section:       meta.Section       || 'Property Details',
        Options:       metaOpts || (f.options || []),
        Validation:    f.validation   || meta.Validation   || null,
        DisplayOrder:  f.displayOrder || meta.DisplayOrder || 99,
        Required:      f.required     || false,
        Active:        f.active       !== false,
        HelpText:      meta.HelpText  || null,
        Placeholder:   meta.Placeholder || f.placeholder || null
      });
    });

    // 3b. Auto-include additional V2FieldConfig entries that match this context.
    // Rule: if a FieldConfig row's TransactionType/Category are null (global) OR match the current
    // form's context, AND the field is Active and not already included, add it.
    // This makes the form FULLY DYNAMIC — add rows to V2FieldConfig and they appear here.
    for (const fc of allFieldConfig) {
      if (fc.Active === false) continue;
      if (seenKeysLower.has(fc.FieldKey.toLowerCase())) continue;
      const txnMatch = !fc.TransactionType || fc.TransactionType === txnType;
      const catMatch = !fc.Category        || fc.Category        === category;
      const subMatch = !fc.SubCategory     || fc.SubCategory     === subCategory;
      if (txnMatch && catMatch && subMatch) {
        seenKeysLower.add(fc.FieldKey.toLowerCase());
        resolvedFieldMap.set(fc.FieldKey, {
          FieldKey:      fc.FieldKey,
          FieldLabel:    fc.FieldLabel   || fc.FieldKey,
          QuestionLabel: fc.QuestionLabel || fc.FieldLabel || `What is ${fc.FieldKey}?`,
          FieldType:     fc.FieldType    || 'Text',
          Tier:          fc.Tier          || 'OPTIONAL',
          RequiredMode:  fc.RequiredMode  || 'OPTIONAL',
          Section:       fc.Section       || 'Property Details',
          Options:       Array.isArray(fc.Options) ? fc.Options : [],
          Validation:    fc.Validation    || null,
          DisplayOrder:  fc.DisplayOrder  || 99,
          Required:      false,
          Active:        true,
          HelpText:      fc.HelpText      || null,
          Placeholder:   fc.Placeholder   || null
        });
      }
    }

    const resolvedFields = Array.from(resolvedFieldMap.values())
      .sort((a, b) => (a.DisplayOrder || 99) - (b.DisplayOrder || 99));

    // 4. Questions — QuestionConfig filtered for this context
    const questions = this.configSvc.getQuestionConfig({
      transactionType: txnType,
      category
    });

    // 5. Dependencies — from static form definition (cross-field constraints)
    const dependencies = (staticForm.dependencies || []).map((d) => ({
      field:        d.field,
      dependsOn:    d.dependsOn,
      rule:         d.rule,
      errorMessage: d.errorMessage
    }));

    // 6. Options map — convenience lookup for each field's option list
    const options = {};
    for (const f of resolvedFields) {
      if (Array.isArray(f.Options) && f.Options.length > 0) {
        options[f.FieldKey] = f.Options;
      }
    }

    return {
      transactionType:  txnType    || null,
      category:         category   || null,
      subCategory:      subCategory || null,
      formVersion:      formMeta ? formMeta.FormVersion : (staticForm.formVersion || FORM_REGISTRY_VERSION),
      formId:           formMeta ? formMeta.FormID  : (staticForm.formKey || 'generic'),
      formKey:          staticForm.formKey || 'generic',
      displayName:      formMeta ? formMeta.DisplayName : (staticForm.formName || 'Generic Form'),
      isActive:         formMeta ? formMeta.IsActive : true,
      fields:           resolvedFields,
      questions,
      dependencies,
      options
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _makeKey(txnType, category, subCategory) {
    if (!txnType || !category || !subCategory) return 'generic';
    return `${txnType}|${category}|${subCategory}`;
  }

  // ── Static constants ──────────────────────────────────────────────────────

  static get STATIC_SUBCATEGORY_CONFIG() { return STATIC_SUBCATEGORY_CONFIG; }
  static get STATIC_FORM_REGISTRY()      { return STATIC_FORM_REGISTRY;      }
}

module.exports = { V2FormRegistryService, STATIC_SUBCATEGORY_CONFIG };
