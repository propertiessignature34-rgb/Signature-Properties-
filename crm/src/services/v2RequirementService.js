/**
 * PHASE 7 — V2 Requirement Service (Progressive Capture)
 *
 * Architecture rules:
 *  - Requirement.LeadID MUST equal Transaction.LeadID (enforced at creation)
 *  - Requirement MUST NOT copy Inventory/Property data
 *  - FormVersion is immutable once stored
 *  - RequirementStatus and PipelineStage are independent fields
 *  - Minimal creation is VALID — only TransactionType/Category/Location/Budget required
 *  - Unknown fields remain UNKNOWN — never treated as NO
 *  - Fields map tracks: UNKNOWN | KNOWN | NOT_APPLICABLE for every field
 *  - Same RequirementID is stable through all progressive updates
 */

'use strict';

const { IdEngine }     = require('../data/idEngine');
const { EntityConfig, WorkflowConfig, ScoringConfig, V2FormRegistry, FORM_REGISTRY_VERSION } = require('../data/v2Config');

const REQ_STATUSES    = EntityConfig.Requirement.statuses;
const PIPELINE_STAGES = EntityConfig.Requirement.pipelineStages;

// Fields tracked in the three-state Fields map.
// Values provided in a payload → KNOWN; explicit NOT_APPLICABLE; absent → UNKNOWN.
const TRACKED_FIELDS = [
  'TransactionType', 'Category', 'SubCategory', 'PropertyPreference', 'WhoIsSpeaking', 'ContactMobile', 'ContactEmail',
  'BudgetMin', 'BudgetMax', 'BudgetType', 'BudgetFlexibility',
  'Location1', 'Location2', 'Location3', 'AvoidLocations',
  'Possession', 'Urgency', 'MoveInDate', 'UseCase',
  'BHK', 'BHKMin', 'BHKMax', 'AreaMin', 'AreaMax',
  'RequiredAreaMin', 'RequiredAreaMax', 'CarpetAreaMin', 'CarpetAreaMax',
  'BuiltUpAreaMin', 'BuiltUpAreaMax', 'PlotAreaMin', 'PlotAreaMax', 'OpenAreaMin', 'OpenAreaMax',
  'AreaUnit', 'FrontageFeet', 'DepthFeet', 'RoadWidthFeet', 'CeilingHeightFeet', 'ClearHeightFeet',
  'Parking', 'ParkingRequired', 'ParkingCount', 'ParkingCarCount', 'ParkingBikeCount',
  'Furnishing', 'Facing', 'Floor', 'TotalFloors', 'FloorsCount',
  'Bathrooms', 'Balcony', 'PropertyAge', 'SocietyProject', 'Amenities',
  'GardenRequired', 'ServantRoomRequired', 'TerraceRequired', 'PoolRequired',
  'BusinessType', 'PowerLoad', 'PowerLoadKVA', 'FireNOC', 'FrontageWidth',
  'SeatingRequired', 'SeatingCapacity', 'CabinsRequired', 'CabinCount',
  'ConferenceRoomRequired', 'ConferenceRoomCount', 'ReceptionRequired', 'WaitingAreaRequired',
  'PantryRequired', 'ServerRoomRequired', 'MeetingRoomRequired', 'MeetingRoomCount',
  'ACRequired', 'PowerBackupRequired', 'InternetFiberRequired', 'FurnitureIncluded',
  'SignageRequired', 'MainRoadRequired', 'WashroomRequired', 'WashroomCount',
  'GroundFloorRequired', 'CornerUnitRequired', 'DisplayWindowRequired', 'FootfallPreference',
  'LoadingUnloadingRequired', 'LoadingDockRequired', 'ContainerMovementRequired', 'TruckAccessRequired',
  'CraneRequired', 'ParkingYardRequired',
  'LandType', 'TPScheme', 'Zone', 'Zoning', 'FSI', 'HighwayTouch', 'TitleClear', 'CornerPlot',
  'ZoneType', 'TransformerRequired', 'PollutionCategory', 'OfficeRequired', 'LabourAccommodationRequired',
  'TenantType', 'FamilyBachelor', 'FoodPreference', 'Pets', 'PetAllowed', 'PetsAllowed',
  'Deposit', 'SecurityDeposit', 'LeaseDuration', 'LockInPeriod', 'LeasePeriodMonths', 'EscalationPercent', 'GSTRequired'
];

const RESERVED_PAYLOAD_KEYS = new Set([
  'LeadID', 'leadId', 'TransactionID', 'transactionId', 'RequirementID', 'requirementId',
  'RequirementCode', 'RequirementStatus', 'requirementStatus', 'Status', 'status',
  'PipelineStage', 'pipelineStage', 'FormVersion', 'formVersion', 'FormKey', 'formKey',
  'Fields', 'fields', 'DynamicAttributes', 'dynamicAttributes', 'SpecialNotes', 'specialNotes',
  'Notes', 'notes', 'Preferences', 'preferences', 'AddPreferences', 'addPreferences',
  'LegacyID', 'FieldPriorities', 'fieldPriorities', 'CategorySpecificData', 'categorySpecificData'
]);

const FIELD_PRIORITY_VALUES = ['MUST_HAVE', 'PREFERRED', 'FLEXIBLE'];

// Fields that must remain non-negative when provided
const POSITIVE_NUMBER_FIELDS = [
  ...TRACKED_FIELDS.filter((key) => /(?:Min|Max|Count|Area|Width|Height|Load|Deposit|Percent|Duration|Period|Floor|Bathrooms|Balcony|BHK|FSI)$/i.test(key)),
  'BudgetMin', 'BudgetMax', 'PowerLoad', 'LeaseDuration'
];

// Valid field states
const FIELD_STATES = { UNKNOWN: 'UNKNOWN', KNOWN: 'KNOWN', NOT_APPLICABLE: 'NOT_APPLICABLE' };

function normalizeFieldPriority(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (FIELD_PRIORITY_VALUES.includes(normalized)) return normalized;
  if (normalized in { MUST: 1, REQUIRED: 1, MUST_HAVE: 1 }) return 'MUST_HAVE';
  if (normalized in { PREFERRED: 1, PREFERENCE: 1 }) return 'PREFERRED';
  if (normalized in { FLEXIBLE: 1, OPTIONAL: 1 }) return 'FLEXIBLE';
  return null;
}

function coerceFieldValueObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const hasState = value.state && Object.values(FIELD_STATES).includes(value.state);
  const hasValue = Object.prototype.hasOwnProperty.call(value, 'value');
  const priority = normalizeFieldPriority(value.priority || value.preference || value.matchPreference || value.flexibility);
  if (hasState) return { ...value, ...(priority ? { priority } : {}) };
  if (hasValue) return { state: value.value == null ? FIELD_STATES.UNKNOWN : FIELD_STATES.KNOWN, value: value.value, ...(priority ? { priority } : {}) };
  return null;
}

/**
 * Build a three-state Fields map entry.
 */
function makeFieldEntry(value) {
  if (value === null || value === undefined) return null;
  if (value === 'NOT_APPLICABLE' || value === '__NA__' || value === 'Not Required' || value === 'Not_Required') {
    return { state: FIELD_STATES.NOT_APPLICABLE };
  }
  if (value === 'UNKNOWN' || value === '__UNKNOWN__') {
    return { state: FIELD_STATES.UNKNOWN };
  }
  const structured = coerceFieldValueObject(value);
  if (structured) return structured;
  return { state: FIELD_STATES.KNOWN, value };
}

function applyFieldPriorities(fields, priorities) {
  if (!priorities || typeof priorities !== 'object') return fields;
  for (const [key, rawPriority] of Object.entries(priorities)) {
    const priority = normalizeFieldPriority(rawPriority);
    if (!priority) continue;
    const current = fields[key] || { state: FIELD_STATES.UNKNOWN };
    fields[key] = { ...current, priority };
  }
  return fields;
}

function eachPayloadField(payload, handler) {
  const seen = new Set();
  for (const key of TRACKED_FIELDS) {
    const lower = key.charAt(0).toLowerCase() + key.slice(1);
    const rawKey = payload[key] !== undefined ? key : payload[lower] !== undefined ? lower : null;
    if (!rawKey) continue;
    seen.add(key);
    handler(key, payload[rawKey]);
  }
  for (const [key, value] of Object.entries(payload || {})) {
    if (seen.has(key)) continue;
    if (RESERVED_PAYLOAD_KEYS.has(key)) continue;
    if (key.startsWith('_')) continue;
    handler(key, value);
  }
}

/**
 * Build the initial Fields map from a creation payload.
 */
function buildFieldsMap(payload) {
  const fields = {};

  if (payload.Fields && typeof payload.Fields === 'object') {
    for (const [k, v] of Object.entries(payload.Fields)) {
      const entry = makeFieldEntry(v);
      if (entry) fields[k] = entry;
    }
  }

  eachPayloadField(payload, (key, value) => {
    if (fields[key]) return;
    const entry = makeFieldEntry(value);
    if (entry) fields[key] = entry;
  });

  return applyFieldPriorities(fields, payload.FieldPriorities || payload.fieldPriorities || null);
}

/**
 * Merge a PATCH payload's Fields updates into an existing Fields map.
 */
function mergeFieldsMap(existing, patch) {
  const merged = { ...existing };

  if (patch.Fields && typeof patch.Fields === 'object') {
    for (const [k, v] of Object.entries(patch.Fields)) {
      const entry = makeFieldEntry(v);
      if (entry) merged[k] = entry;
    }
  }

  eachPayloadField(patch, (key, value) => {
    if (patch.Fields && patch.Fields[key] !== undefined) return;
    const entry = makeFieldEntry(value);
    if (entry) merged[key] = entry;
  });

  return applyFieldPriorities(merged, patch.FieldPriorities || patch.fieldPriorities || null);
}

function extractFieldPriorities(fieldsMap) {
  const out = {};
  for (const [key, entry] of Object.entries(fieldsMap || {})) {
    if (entry && entry.priority) out[key] = entry.priority;
  }
  return out;
}

/**
 * Extract a scalar value from the Fields map (returns raw value for KNOWN, null otherwise).
 */
function fieldValue(fieldsMap, key) {
  const entry = fieldsMap && fieldsMap[key];
  if (!entry || entry.state !== FIELD_STATES.KNOWN) return null;
  return entry.value !== undefined ? entry.value : null;
}

/**
 * Compute tiered completeness from Fields map.
 */
function computeCompleteness(fields) {
  const coreKeys = ['Category', 'BudgetMax', 'BudgetMin', 'Location1'];
  const importantKeys = ['SubCategory', 'Possession', 'Urgency'];

  const coreTotal = coreKeys.length;
  const coreDone = coreKeys.filter((k) => fields[k] && fields[k].state !== FIELD_STATES.UNKNOWN).length;

  const importantTotal = importantKeys.length;
  const importantDone = importantKeys.filter((k) => fields[k] && fields[k].state !== FIELD_STATES.UNKNOWN).length;

  const optionalAll = Array.from(new Set(TRACKED_FIELDS)).filter((k) => !coreKeys.includes(k) && !importantKeys.includes(k));
  const optionalDone = optionalAll.filter((k) => fields[k] && fields[k].state !== FIELD_STATES.UNKNOWN).length;

  return {
    core: `${coreDone}/${coreTotal}`,
    coreComplete: coreDone === coreTotal,
    important: `${importantDone}/${importantTotal}`,
    optional: `${optionalDone}/${optionalAll.length}`
  };
}

class V2RequirementService {
  constructor(repository, scoringService) {
    if (!repository) throw new Error('V2RequirementService requires a repository');
    this.repository = repository;
    this.scoringSvc = scoringService || null;
    this.idEngine   = new IdEngine(repository);
  }

  // ── Form Registry ──────────────────────────────────────────────────────────

  resolveFormKey(txnType, category, subCategory) {
    const key = `${txnType}|${category}|${subCategory}`;
    if (V2FormRegistry[key]) return key;
    const catKey = Object.keys(V2FormRegistry).find((k) => k.startsWith(`${txnType}|${category}|`));
    return catKey || 'generic';
  }

  getFormConfig(txnType, category, subCategory) {
    const key = this.resolveFormKey(txnType, category || '', subCategory || '');
    return V2FormRegistry[key] || V2FormRegistry.generic;
  }

  // ── Create Requirement ────────────────────────────────────────────────────

  /**
   * Create a requirement with minimal information.
   *
   * NOTHING is required except that the parent Transaction exists and
   * Requirement.LeadID === Transaction.LeadID.
   *
   * Any unset field remains UNKNOWN — not NO.
   *
   * Budget cross-field constraints (min ≤ max) are still enforced when both
   * are explicitly provided.  Provided Select/Number values are validated
   * against their configured options/constraints — but their absence is never
   * an error.
   */
  createRequirement(transactionId, payload, actor = {}) {
    // ── Parent chain validation (read DB once for checks) ─────────────────

    const dbCheck = this.repository.read();

    const transaction = (dbCheck.Transactions || []).find((t) => t.TransactionID === transactionId);
    if (!transaction) {
      return { ok: false, error: `Transaction not found: ${transactionId}` };
    }

    const leadId = payload.LeadID || payload.leadId || transaction.LeadID;

    if (leadId !== transaction.LeadID) {
      return { ok: false, error: `Requirement LeadID (${leadId}) must equal Transaction LeadID (${transaction.LeadID})` };
    }

    const lead = (dbCheck.Leads || []).find((l) => l.LeadID === leadId);
    if (!lead) return { ok: false, error: `Lead not found: ${leadId}` };

    const leadPrefill = this._deriveLeadRequirementPrefill(lead, transaction);
    const mergedPayload = this._mergeWithPrefill(leadPrefill, payload || {});

    // ── Derive TransactionType / Category / SubCategory ───────────────────

    const txnType = mergedPayload.TransactionType || mergedPayload.transactionType || transaction.TransactionType || transaction.Type || 'Purchase';
    const category = mergedPayload.Category || mergedPayload.category || null;
    const subCategory = mergedPayload.SubCategory || mergedPayload.subCategory || mergedPayload.PropertyType || mergedPayload.propertyType || null;

    // ── Resolve form and freeze FormVersion ───────────────────────────────

    const formKey = this.resolveFormKey(txnType, category || '', subCategory || '');
    const formConfig = V2FormRegistry[formKey] || V2FormRegistry.generic;
    const formVersion = formConfig.formVersion || FORM_REGISTRY_VERSION;

    // ── Status / stage validation ─────────────────────────────────────────

    const status = mergedPayload.RequirementStatus || mergedPayload.status || mergedPayload.Status || 'Draft';
    if (!REQ_STATUSES.includes(status)) {
      return { ok: false, error: `Invalid RequirementStatus. Must be one of: ${REQ_STATUSES.join(', ')}` };
    }

    const stage = mergedPayload.PipelineStage || mergedPayload.pipelineStage || 'New';
    if (!PIPELINE_STAGES.includes(stage)) {
      return { ok: false, error: `Invalid PipelineStage. Must be one of: ${PIPELINE_STAGES.join(', ')}` };
    }

    // ── Numeric convenience extraction ────────────────────────────────────

    const budgetMin = this._num(mergedPayload.BudgetMin ?? mergedPayload.budgetMin);
    const budgetMax = this._num(mergedPayload.BudgetMax ?? mergedPayload.budgetMax);
    const areaMin = this._num(mergedPayload.AreaMin ?? mergedPayload.areaMin ?? mergedPayload.RequiredAreaMin ?? mergedPayload.requiredAreaMin ?? mergedPayload.CarpetAreaMin ?? mergedPayload.carpetAreaMin ?? mergedPayload.BuiltUpAreaMin ?? mergedPayload.builtUpAreaMin);
    const areaMax = this._num(mergedPayload.AreaMax ?? mergedPayload.areaMax ?? mergedPayload.RequiredAreaMax ?? mergedPayload.requiredAreaMax ?? mergedPayload.CarpetAreaMax ?? mergedPayload.carpetAreaMax ?? mergedPayload.BuiltUpAreaMax ?? mergedPayload.builtUpAreaMax);

    // ── Value validation for provided fields only ─────────────────────────
    // (Absence is NEVER an error; only bad values are rejected)

    const valueCheck = this._validateProvidedValues(mergedPayload, formConfig, {
      budgetMin, budgetMax, areaMin, areaMax
    });
    if (!valueCheck.ok) return valueCheck;

    // ── Build three-state Fields map ──────────────────────────────────────

    // Ensure Category / TransactionType / SubCategory are captured in Fields map
    const augmented = { ...mergedPayload };
    if (category)    augmented.Category    = category;
    if (subCategory) augmented.SubCategory = subCategory;
    if (budgetMin !== null) augmented.BudgetMin = budgetMin;
    if (budgetMax !== null) augmented.BudgetMax = budgetMax;
    if (areaMin !== null)   augmented.AreaMin   = areaMin;
    if (areaMax !== null)   augmented.AreaMax   = areaMax;

    const fieldsMap = buildFieldsMap(augmented);

    // ── Generate ID (writes counter to DB) — do this BEFORE re-reading ───

    const reqId = this.idEngine.nextRequirementId();
    const now   = new Date().toISOString();

    const requirement = {
      RequirementID:      reqId,
      RequirementCode:    reqId,               // backward compat
      LeadID:             leadId,
      TransactionID:      transactionId,
      TransactionType:    txnType,
      RequirementStatus:  status,
      Status:             status,              // backward compat
      PipelineStage:      stage,
      Category:           category,
      SubCategory:        subCategory,

      // Three-state field store — canonical truth
      Fields:             fieldsMap,

      // Top-level flat fields — backward compat + quick read
      PropertyPreference: mergedPayload.PropertyPreference || mergedPayload.propertyPreference || mergedPayload.PropertyType || mergedPayload.propertyType || subCategory || null,
      PropertyType: mergedPayload.PropertyType || mergedPayload.propertyType || subCategory || null,
      WhoIsSpeaking: mergedPayload.WhoIsSpeaking || mergedPayload.whoIsSpeaking || lead.ClientName || null,
      ContactMobile: mergedPayload.ContactMobile || mergedPayload.contactMobile || lead.PrimaryMobile || lead.Phone || null,
      ContactEmail: mergedPayload.ContactEmail || mergedPayload.contactEmail || lead.Email || null,
      BudgetMin: budgetMin,
      BudgetMax: budgetMax,
      BudgetType: mergedPayload.BudgetType || mergedPayload.budgetType || null,
      BudgetFlexibility: mergedPayload.BudgetFlexibility || mergedPayload.budgetFlexibility || null,
      Location1: mergedPayload.Location1 || mergedPayload.location1 || null,
      Location2: mergedPayload.Location2 || mergedPayload.location2 || null,
      Location3: mergedPayload.Location3 || mergedPayload.location3 || null,
      AvoidLocations: mergedPayload.AvoidLocations || mergedPayload.avoidLocations || null,
      Possession: mergedPayload.Possession || mergedPayload.possession || null,
      Urgency: mergedPayload.Urgency || mergedPayload.urgency || null,
      MoveInDate: mergedPayload.MoveInDate || mergedPayload.moveInDate || null,
      BHKMin: this._num(mergedPayload.BHKMin ?? mergedPayload.bhkMin),
      BHKMax: this._num(mergedPayload.BHKMax ?? mergedPayload.bhkMax),
      AreaMin: areaMin,
      AreaMax: areaMax,
      FieldPriorities: extractFieldPriorities(fieldsMap),

      // Category-specific blob — optional, for convenience
      CategorySpecificData: this._extractCategoryData(mergedPayload, formConfig),

      // Free-form captures
      Preferences: this._normalisePreferences(mergedPayload.Preferences || mergedPayload.preferences),
      SpecialNotes: mergedPayload.SpecialNotes || mergedPayload.specialNotes || mergedPayload.Notes || mergedPayload.notes || null,
      DynamicAttributes: mergedPayload.DynamicAttributes || mergedPayload.dynamicAttributes || {},

      // Completeness tiers
      Completeness:       computeCompleteness(fieldsMap),

      // V2 scoring
      RequirementScore:   null,
      ScoreBreakdown:     null,

      // Form versioning — IMMUTABLE after creation
      FormVersion:        formVersion,
      FormKey:            formKey,
      CompanyID:         lead.CompanyID || transaction.CompanyID || mergedPayload.CompanyID || mergedPayload.companyId || actor.companyId || actor.companyID || null,
      BrokerageID:       lead.BrokerageID || transaction.BrokerageID || mergedPayload.BrokerageID || mergedPayload.brokerageId || actor.brokerageId || actor.brokerageID || null,

      // Audit
      CreatedBy:  actor.userId || 'system',
      CreatedAt:  now,
      UpdatedBy:  actor.userId || 'system',
      UpdatedAt:  now,
      Version:    1,
      LegacyID:   payload.LegacyID || null,
      _v2:        true
    };

    this._applyScore(requirement);

    // Re-read DB fresh so we do NOT overwrite the counter that idEngine just wrote
    const db = this.repository.read();
    db.Requirements = db.Requirements || [];
    db.Requirements.push(requirement);

    db.RequirementHistory = db.RequirementHistory || [];
    db.RequirementHistory.push({
      RequirementHistoryID: this.repository.createId('REQH'),
      RequirementID:        reqId,
      VersionNumber:        1,
      ChangedBy:            actor.userId || 'system',
      ChangedAt:            now,
      ChangeSummary:        'Requirement created',
      PreviousData:         null,
      NewData:              { Fields: fieldsMap, Category: category, TransactionType: txnType }
    });

    this.repository.write(db);
    this.repository.addTimelineEntry(
      leadId, 'Requirement', reqId, 'REQUIREMENT_CREATED',
      'Requirement created',
      { Category: category, RequirementStatus: status }
    );

    return { ok: true, data: requirement };
  }

  // ── Update Requirement (Progressive PATCH) ────────────────────────────────

  /**
   * Progressively update a requirement.
   *
   * Every call merges new information into the same RequirementID.
   * The Fields map is merged — existing KNOWN/NOT_APPLICABLE states for
   * untouched fields are preserved.  Providing a value promotes a field
   * from UNKNOWN → KNOWN.  Providing NOT_APPLICABLE marks it explicitly.
   *
   * Immutable fields: RequirementID, LeadID, TransactionID, FormVersion.
   */
  updateRequirement(requirementId, payload, actor = {}) {
    const db = this.repository.read();
    db.Requirements = db.Requirements || [];
    const idx = db.Requirements.findIndex((r) => r.RequirementID === requirementId);
    if (idx === -1) return { ok: false, error: 'Requirement not found' };

    const existing = db.Requirements[idx];
    const now      = new Date().toISOString();

    // ── Guard immutable fields ────────────────────────────────────────────

    if (payload.RequirementID  && payload.RequirementID  !== requirementId)         return { ok: false, error: 'RequirementID is immutable' };
    if (payload.LeadID         && payload.LeadID         !== existing.LeadID)       return { ok: false, error: 'LeadID is immutable on a Requirement' };
    if (payload.TransactionID  && payload.TransactionID  !== existing.TransactionID) return { ok: false, error: 'TransactionID is immutable on a Requirement' };
    if (payload.FormVersion    && payload.FormVersion    !== existing.FormVersion)   return { ok: false, error: 'FormVersion is immutable' };

    // ── Status transition ─────────────────────────────────────────────────

    let status = existing.RequirementStatus || existing.Status || 'Draft';
    const previousStatus = status;
    const nextStatus = payload.RequirementStatus || payload.status || payload.Status;
    if (nextStatus && nextStatus !== status) {
      if (!REQ_STATUSES.includes(nextStatus)) {
        return { ok: false, error: `Invalid RequirementStatus: ${nextStatus}` };
      }
      const allowed = WorkflowConfig.requirementStatus.transitions[status] || [];
      if (!allowed.includes(nextStatus)) {
        return { ok: false, error: `RequirementStatus transition from '${status}' to '${nextStatus}' is not allowed` };
      }
      status = nextStatus;
    }

    // ── Pipeline stage — free movement ────────────────────────────────────

    let stage = existing.PipelineStage || 'New';
    const nextStage = payload.PipelineStage || payload.pipelineStage;
    if (nextStage) {
      if (!PIPELINE_STAGES.includes(nextStage)) return { ok: false, error: `Invalid PipelineStage: ${nextStage}` };
      stage = nextStage;
    }

    // ── Numeric extraction (provided values) ──────────────────────────────

    const nextCategory = payload.Category || payload.category || existing.Category;
    const nextSubCategory = payload.SubCategory || payload.subCategory || payload.PropertyType || payload.propertyType || existing.SubCategory;

    const budgetMin = payload.BudgetMin !== undefined ? this._num(payload.BudgetMin)
                    : payload.budgetMin !== undefined ? this._num(payload.budgetMin)
                    : existing.BudgetMin;
    const budgetMax = payload.BudgetMax !== undefined ? this._num(payload.BudgetMax)
                    : payload.budgetMax !== undefined ? this._num(payload.budgetMax)
                    : existing.BudgetMax;
    const areaMin = payload.AreaMin !== undefined ? this._num(payload.AreaMin)
                  : payload.areaMin !== undefined ? this._num(payload.areaMin)
                  : payload.RequiredAreaMin !== undefined ? this._num(payload.RequiredAreaMin)
                  : payload.requiredAreaMin !== undefined ? this._num(payload.requiredAreaMin)
                  : payload.CarpetAreaMin !== undefined ? this._num(payload.CarpetAreaMin)
                  : payload.carpetAreaMin !== undefined ? this._num(payload.carpetAreaMin)
                  : existing.AreaMin;
    const areaMax = payload.AreaMax !== undefined ? this._num(payload.AreaMax)
                  : payload.areaMax !== undefined ? this._num(payload.areaMax)
                  : payload.RequiredAreaMax !== undefined ? this._num(payload.RequiredAreaMax)
                  : payload.requiredAreaMax !== undefined ? this._num(payload.requiredAreaMax)
                  : payload.CarpetAreaMax !== undefined ? this._num(payload.CarpetAreaMax)
                  : payload.carpetAreaMax !== undefined ? this._num(payload.carpetAreaMax)
                  : existing.AreaMax;

    // ── Value validation (only for provided values) ───────────────────────

    const formConfig = this.getFormConfig(
      existing.TransactionType,
      nextCategory,
      nextSubCategory
    );
    const valueCheck = this._validateProvidedValues(payload, formConfig, {
      budgetMin, budgetMax, areaMin, areaMax
    });
    if (!valueCheck.ok) return valueCheck;

    // ── Merge Fields map ──────────────────────────────────────────────────

    const augmentedPatch = { ...payload };
    if (budgetMin !== null && payload.BudgetMin !== undefined) augmentedPatch.BudgetMin = budgetMin;
    if (budgetMax !== null && payload.BudgetMax !== undefined) augmentedPatch.BudgetMax = budgetMax;

    const newFieldsMap = mergeFieldsMap(existing.Fields || {}, augmentedPatch);

    // ── Track what changed for history ────────────────────────────────────

    const changedFields = this._diffFields(existing.Fields || {}, newFieldsMap);

    // ── Merge Preferences (additive) ──────────────────────────────────────

    let preferences = existing.Preferences || [];
    if (payload.Preferences !== undefined || payload.preferences !== undefined) {
      preferences = this._normalisePreferences(payload.Preferences || payload.preferences);
    }
    if (payload.AddPreferences || payload.addPreferences) {
      const toAdd = this._normalisePreferences(payload.AddPreferences || payload.addPreferences);
      for (const p of toAdd) {
        if (!preferences.includes(p)) preferences.push(p);
      }
    }

    // ── Merge DynamicAttributes ───────────────────────────────────────────

    const dynAttr = {
      ...(existing.DynamicAttributes || {}),
      ...(payload.DynamicAttributes || payload.dynamicAttributes || {})
    };

    // ── Build updated record ──────────────────────────────────────────────

    const updated = {
      ...existing,
      RequirementStatus:  status,
      Status:             status,
      PipelineStage:      stage,

      // Three-state Fields map (merged)
      Fields:             newFieldsMap,

      // Update flat top-level fields for backward compat
      Category: nextCategory,
      SubCategory: nextSubCategory,
      PropertyPreference: payload.PropertyPreference || payload.propertyPreference || payload.PropertyType || payload.propertyType || existing.PropertyPreference,
      PropertyType: payload.PropertyType || payload.propertyType || nextSubCategory || existing.PropertyType,
      WhoIsSpeaking: payload.WhoIsSpeaking || payload.whoIsSpeaking || existing.WhoIsSpeaking || null,
      ContactMobile: payload.ContactMobile !== undefined ? payload.ContactMobile : (payload.contactMobile !== undefined ? payload.contactMobile : existing.ContactMobile),
      ContactEmail: payload.ContactEmail !== undefined ? payload.ContactEmail : (payload.contactEmail !== undefined ? payload.contactEmail : existing.ContactEmail),
      BudgetMin: budgetMin,
      BudgetMax: budgetMax,
      BudgetType: payload.BudgetType || payload.budgetType || existing.BudgetType,
      BudgetFlexibility: payload.BudgetFlexibility || payload.budgetFlexibility || existing.BudgetFlexibility,
      Location1: payload.Location1 !== undefined ? payload.Location1 : (payload.location1 !== undefined ? payload.location1 : existing.Location1),
      Location2: payload.Location2 !== undefined ? payload.Location2 : (payload.location2 !== undefined ? payload.location2 : existing.Location2),
      Location3: payload.Location3 !== undefined ? payload.Location3 : (payload.location3 !== undefined ? payload.location3 : existing.Location3),
      AvoidLocations: payload.AvoidLocations !== undefined ? payload.AvoidLocations : (payload.avoidLocations !== undefined ? payload.avoidLocations : existing.AvoidLocations),
      Possession: payload.Possession || payload.possession || existing.Possession,
      Urgency: payload.Urgency || payload.urgency || existing.Urgency,
      MoveInDate: payload.MoveInDate || payload.moveInDate || existing.MoveInDate,
      BHKMin: this._num(payload.BHKMin ?? payload.bhkMin) ?? existing.BHKMin,
      BHKMax: this._num(payload.BHKMax ?? payload.bhkMax) ?? existing.BHKMax,
      AreaMin: areaMin,
      AreaMax: areaMax,
      FieldPriorities: extractFieldPriorities(newFieldsMap),
      CategorySpecificData: payload.CategorySpecificData || payload.categorySpecificData || this._extractCategoryData({ ...existing, ...payload }, formConfig),
      Preferences: preferences,
      SpecialNotes: payload.SpecialNotes !== undefined ? payload.SpecialNotes : (payload.specialNotes !== undefined ? payload.specialNotes : existing.SpecialNotes),
      DynamicAttributes: dynAttr,

      // Recomputed completeness
      Completeness:       computeCompleteness(newFieldsMap),

      // FormVersion immutable
      UpdatedBy:  actor.userId || 'system',
      UpdatedAt:  now,
      Version:    (existing.Version || 1) + 1
    };

    if (status === 'Lost') {
      const lostReason = payload.LostReason ?? payload.lostReason ?? existing.LostReason ?? null;
      const lostNotes = payload.LostNotes ?? payload.lostNotes ?? payload.LostNote ?? payload.lostNote ?? existing.LostNotes ?? existing.LostNote ?? null;
      if (!lostReason) return { ok: false, error: 'LostReason is required when marking requirement as Lost' };
      updated.LostReason = lostReason;
      updated.LostNotes = lostNotes;
      updated.LostNote = lostNotes;
      updated.LostAt = existing.LostAt || now;
    }
    if (payload.LostReason !== undefined || payload.lostReason !== undefined) {
      updated.LostReason = payload.LostReason ?? payload.lostReason ?? null;
    }
    if (payload.LostNotes !== undefined || payload.lostNotes !== undefined || payload.LostNote !== undefined || payload.lostNote !== undefined) {
      const note = payload.LostNotes ?? payload.lostNotes ?? payload.LostNote ?? payload.lostNote ?? null;
      updated.LostNotes = note;
      updated.LostNote = note;
    }
    if (previousStatus === 'Lost' && status !== 'Lost') {
      updated.ReactivatedAt = now;
      updated.LostReason = null;
      updated.LostNotes = null;
      updated.LostNote = null;
      updated.LostAt = null;
    }

    // Recompute score
    this._applyScore(updated);

    db.Requirements[idx] = updated;

    db.RequirementHistory = db.RequirementHistory || [];
    db.RequirementHistory.push({
      RequirementHistoryID: this.repository.createId('REQH'),
      RequirementID:        requirementId,
      VersionNumber:        updated.Version,
      ChangedBy:            actor.userId || 'system',
      ChangedAt:            now,
      ChangeSummary:        changedFields.length
        ? `Updated fields: ${changedFields.join(', ')}`
        : `Status: ${status}, Stage: ${stage}`,
      PreviousData: { Fields: existing.Fields || {}, Status: existing.RequirementStatus, PipelineStage: existing.PipelineStage },
      NewData:      { Fields: newFieldsMap, Status: status, PipelineStage: stage }
    });

    const statusChanged = previousStatus !== status;
    if (statusChanged && typeof this.repository.appendRequirementStatusTransitionArtifacts === 'function') {
      this.repository.appendRequirementStatusTransitionArtifacts(db, {
        requirement: updated,
        previousStatus,
        nextStatus: status,
        changedFields,
        occurredAt: now,
        actorUserId: actor.userId || 'system'
      });
    }

    this.repository.write(db);

    if (!statusChanged) {
      const timelineEventTitle = changedFields.length ? `Requirement updated: ${changedFields.join(', ')}` : 'Requirement updated';
      this.repository.addTimelineEntry(
        existing.LeadID, 'Requirement', requirementId, 'REQUIREMENT_UPDATED',
        timelineEventTitle,
        { RequirementStatus: status, previousStatus, PipelineStage: stage, changedFields, LostReason: updated.LostReason || null, LostNotes: updated.LostNotes || updated.LostNote || null }
      );
    }

    return {
      ok: true,
      data: {
        requirement: updated,
        changedFields,
        history: [db.RequirementHistory[db.RequirementHistory.length - 1]]
      }
    };
  }

  // ── Read Helpers ──────────────────────────────────────────────────────────

  getRequirement(requirementId) {
    const db  = this.repository.read();
    const row = (db.Requirements || []).find((r) => r.RequirementID === requirementId);
    if (!row) return { ok: false, error: 'Requirement not found' };
    const history = (db.RequirementHistory || []).filter((h) => h.RequirementID === requirementId);
    return { ok: true, data: { ...row, history } };
  }

  getFieldState(requirementId, fieldKey) {
    const db  = this.repository.read();
    const row = (db.Requirements || []).find((r) => r.RequirementID === requirementId);
    if (!row) return { ok: false, error: 'Requirement not found' };
    const entry = (row.Fields || {})[fieldKey];
    return {
      ok: true,
      fieldKey,
      state: entry ? entry.state : FIELD_STATES.UNKNOWN,
      value: entry && entry.state === FIELD_STATES.KNOWN ? entry.value : undefined
    };
  }

  listRequirementsByTransaction(transactionId) {
    const db   = this.repository.read();
    const rows = (db.Requirements || []).filter((r) => r.TransactionID === transactionId);
    return rows.sort((a, b) => new Date(b.UpdatedAt || b.CreatedAt).getTime() - new Date(a.UpdatedAt || a.CreatedAt).getTime());
  }

  listRequirementsByLead(leadId) {
    const db   = this.repository.read();
    const rows = (db.Requirements || []).filter((r) => r.LeadID === leadId);
    return rows.sort((a, b) => new Date(b.UpdatedAt || b.CreatedAt).getTime() - new Date(a.UpdatedAt || a.CreatedAt).getTime());
  }

  listAllRequirements(filters = {}) {
    const db  = this.repository.read();
    let rows  = db.Requirements || [];
    if (filters.LeadID)            rows = rows.filter((r) => r.LeadID === filters.LeadID);
    if (filters.TransactionID)     rows = rows.filter((r) => r.TransactionID === filters.TransactionID);
    if (filters.RequirementStatus) rows = rows.filter((r) => (r.RequirementStatus || r.Status) === filters.RequirementStatus);
    if (filters.PipelineStage)     rows = rows.filter((r) => r.PipelineStage === filters.PipelineStage);
    if (filters.Category)          rows = rows.filter((r) => r.Category === filters.Category);
    if (filters.TransactionType)   rows = rows.filter((r) => r.TransactionType === filters.TransactionType);
    return rows.sort((a, b) => new Date(b.UpdatedAt || b.CreatedAt).getTime() - new Date(a.UpdatedAt || a.CreatedAt).getTime());
  }

  /**
   * Global Requirement View — enriched with client name from Lead.
   * Queries Requirement records only — NOT a second Lead database.
   */
  listGlobalRequirements(filters = {}) {
    const db    = this.repository.read();
    const leads = db.Leads || [];
    const rows  = this.listAllRequirements(filters);

    return rows.map((req) => {
      const lead = leads.find((l) => l.LeadID === req.LeadID);
      return {
        ...req,
        clientName:    lead ? lead.ClientName : null,
        clientMobile:  lead ? (lead.PrimaryMobile || lead.Phone) : null,
        clientStatus:  lead ? (lead.ClientStatus  || lead.LeadStatus) : null,
        budgetRange:   this._formatBudget(req.BudgetMin, req.BudgetMax),
        transactionLink: req.TransactionID
      };
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _num(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  _mergeWithPrefill(prefill, payload) {
    const merged = { ...prefill };
    for (const [key, value] of Object.entries(payload || {})) {
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }

  _deriveLeadRequirementPrefill(lead, transaction) {
    const profile = lead.RequirementProfile || lead.requirementProfile || lead.PreferenceProfile || lead.preferenceProfile || {};
    const get = (...keys) => {
      for (const key of keys) {
        if (profile && profile[key] !== undefined && profile[key] !== null && profile[key] !== '') return profile[key];
        if (lead && lead[key] !== undefined && lead[key] !== null && lead[key] !== '') return lead[key];
      }
      return undefined;
    };
    const tx = get('RequirementType', 'requirementType', 'TransactionType', 'transactionType') || transaction.TransactionType || transaction.Type;
    const propertyType = get('PropertyType', 'propertyType', 'SubCategory', 'subCategory');
    return {
      TransactionType: tx,
      Category: get('Category', 'category'),
      SubCategory: propertyType,
      PropertyType: propertyType,
      BudgetMin: get('BudgetMin', 'budgetMin'),
      BudgetMax: get('BudgetMax', 'budgetMax', 'Budget'),
      Location1: get('Location1', 'location1', 'PreferredLocation', 'preferredLocation', 'Location', 'location'),
      Location2: get('Location2', 'location2'),
      Location3: get('Location3', 'location3'),
      WhoIsSpeaking: get('WhoIsSpeaking', 'whoIsSpeaking', 'ClientName', 'clientName'),
      ContactMobile: get('ContactMobile', 'contactMobile', 'PrimaryMobile', 'primaryMobile', 'Phone', 'phone', 'WhatsApp', 'whatsapp'),
      ContactEmail: get('ContactEmail', 'contactEmail', 'Email', 'email')
    };
  }

  /**
   * Validate values that ARE provided (absence is never an error).
   *
   * Checks:
   *  1. Budget cross-field (min ≤ max) when both present
   *  2. Area cross-field (min ≤ max) when both present
   *  3. Positive-number fields must be ≥ 0
   *  4. Select/MultiSelect values must be in configured options
   */
  _validateProvidedValues(payload, formConfig, { budgetMin, budgetMax, areaMin, areaMax } = {}) {
    // Cross-field range checks
    if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
      return { ok: false, error: 'BudgetMin must be ≤ BudgetMax' };
    }
    if (areaMin !== null && areaMax !== null && areaMin > areaMax) {
      return { ok: false, error: 'AreaMin must be ≤ AreaMax' };
    }

    // Positive-number checks for provided values
    const positiveKeys = new Set(POSITIVE_NUMBER_FIELDS);
    for (const key of Object.keys(payload || {})) {
      if (/(?:Min|Max|Count|Area|Width|Height|Load|Deposit|Percent|Duration|Period|Floor|Bathrooms|Balcony|BHK|FSI)$/i.test(key)) {
        positiveKeys.add(key);
      }
    }
    for (const key of positiveKeys) {
      const raw = payload[key] !== undefined ? payload[key] : payload[key.charAt(0).toLowerCase() + key.slice(1)];
      if (raw === undefined || raw === null || raw === '') continue;
      if (typeof raw === 'object' && raw.value !== undefined) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: `${key} must be a positive number` };
      }
    }

    // Option membership for Select/MultiSelect fields — only if a value is actually provided
    if (formConfig && formConfig.fields) {
      const catData = payload.CategorySpecificData || payload.categorySpecificData || {};
      const lookup = { ...payload, ...catData };
      const ciMap = {};
      for (const k of Object.keys(lookup)) ciMap[k.toLowerCase()] = lookup[k];

      for (const fieldKey of Object.keys(formConfig.fields)) {
        const f = formConfig.fields[fieldKey];
        const rawVal = lookup[f.fieldId || fieldKey] !== undefined
          ? lookup[f.fieldId || fieldKey]
          : ciMap[String(fieldKey).toLowerCase()];

        if (rawVal === undefined || rawVal === null || rawVal === '') continue;

        // Skip NOT_APPLICABLE sentinels — they are valid state values
        if (typeof rawVal === 'string' && (rawVal === 'NOT_APPLICABLE' || rawVal === '__NA__' || rawVal === 'Not Required')) continue;

        // Option-membership check only applies to string values.
        // Numeric values (e.g. Parking: 2 for "2 parking spaces") are stored as-is.
        if (typeof rawVal === 'string' &&
            (f.fieldType === 'Select' || f.fieldType === 'MultiSelect') &&
            Array.isArray(f.options) && f.options.length > 0) {
          if (f.fieldType === 'Select') {
            if (!f.options.includes(rawVal)) {
              return { ok: false, error: `Invalid value '${rawVal}' for ${f.fieldLabel || fieldKey}. Allowed: ${f.options.join(', ')}` };
            }
          } else {
            const vals = Array.isArray(rawVal) ? rawVal : String(rawVal).split(',').map((s) => s.trim());
            for (const v of vals) {
              if (!f.options.includes(v)) {
                return { ok: false, error: `Invalid value '${v}' for ${f.fieldLabel || fieldKey}. Allowed: ${f.options.join(', ')}` };
              }
            }
          }
        }
      }
    }

    return { ok: true };
  }

  _extractCategoryData(payload, formConfig) {
    const data = {};
    const skip = new Set([...RESERVED_PAYLOAD_KEYS, 'WhoIsSpeaking', 'whoIsSpeaking', 'ContactMobile', 'contactMobile', 'ContactEmail', 'contactEmail']);
    if (formConfig && formConfig.fields) {
      for (const fieldKey of Object.keys(formConfig.fields)) {
        const fieldId = formConfig.fields[fieldKey].fieldId || fieldKey;
        const val = payload[fieldId] !== undefined ? payload[fieldId] : payload[fieldKey];
        if (val !== undefined && !skip.has(fieldKey) && !skip.has(fieldId)) data[fieldId] = val;
      }
    }
    eachPayloadField(payload || {}, (key, value) => {
      if (!skip.has(key)) data[key] = value;
    });
    return data;
  }

  _normalisePreferences(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  }

  _formatBudget(min, max) {
    const fmt = (n) => {
      if (n === null || n === undefined) return null;
      if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
      if (n >= 1e5) return `₹${(n / 1e5).toFixed(0)} L`;
      return `₹${n.toLocaleString('en-IN')}`;
    };
    const fMin = fmt(min);
    const fMax = fmt(max);
    if (fMin && fMax) return `${fMin} – ${fMax}`;
    return fMin || fMax || null;
  }

  /**
   * Apply scoring to a requirement in-place.
   * Uses V2ScoringService if injected, falls back to legacy _computeRequirementScore.
   */
  _applyScore(req) {
    if (this.scoringSvc) {
      const result = this.scoringSvc.calculateRequirementScore(req);
      req.RequirementScore          = result.ok ? result.score : 0;
      req.ScoreBreakdown            = result.ok ? result      : null;
      req.ScoreCalculationVersion   = result.ok ? result.calculationVersion : null;
      req.ScoreCalculatedAt         = result.ok ? result.calculatedAt       : null;
    } else {
      const score = this._computeRequirementScore(req);
      req.RequirementScore = score.total;
      req.ScoreBreakdown   = score.breakdown;
    }
  }

  _computeRequirementScore(req) {
    const cfg   = ScoringConfig.requirement;
    let score   = 0;
    const breakdown = {};

    // Use Fields map when available; fall back to flat fields
    const fields = req.Fields || {};

    const hasBudget   = !!(fieldValue(fields, 'BudgetMin') || fieldValue(fields, 'BudgetMax') || req.BudgetMin || req.BudgetMax);
    const hasLocation = !!(fieldValue(fields, 'Location1') || req.Location1);
    const hasCategory = !!(req.Category);
    const urgency     = fieldValue(fields, 'Urgency') || req.Urgency;

    for (const rule of cfg.rules) {
      let pts = 0;
      if (rule.field === 'hasBudget')   pts = rule.scoring[String(hasBudget)]   || 0;
      if (rule.field === 'hasLocation') pts = rule.scoring[String(hasLocation)] || 0;
      if (rule.field === 'hasCategory') pts = rule.scoring[String(hasCategory)] || 0;
      if (rule.field === 'urgency') {
        const urgMap = { Immediate: 'High', High: 'High', Medium: 'Medium', Low: 'Low' };
        pts = rule.scoring[urgMap[urgency] || 'Low'] || rule.scoring.Low || 0;
      }
      if (rule.field === 'completeness') {
        const comp = computeCompleteness(fields);
        const [done, total] = comp.core.split('/').map(Number);
        const pct = total > 0 ? done / total : 0;
        pts = Math.round(pct * (rule.maxScore || 25));
      }
      breakdown[rule.field] = pts;
      score += pts;
    }

    return { total: Math.min(score, cfg.maxScore), breakdown };
  }

  /**
   * Return list of field keys that changed between two Fields maps.
   */
  _diffFields(oldFields, newFields) {
    const changed = new Set();
    for (const k of Object.keys(newFields)) {
      const oldEntry = oldFields[k];
      const newEntry = newFields[k];
      const oldStr = JSON.stringify(oldEntry);
      const newStr = JSON.stringify(newEntry);
      if (oldStr !== newStr) changed.add(k);
    }
    return [...changed];
  }
}

module.exports = { V2RequirementService, buildFieldsMap, mergeFieldsMap, computeCompleteness, FIELD_STATES, TRACKED_FIELDS };
