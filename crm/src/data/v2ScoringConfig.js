/**
 * PHASE 12 — V2 Scoring Configuration (Static Seed Data)
 *
 * DB-backed pattern (same as FieldConfig/DependencyConfig):
 *  - Static data here is the seed / fallback.
 *  - V2ScoringService reads from DB first; falls back to these arrays.
 *  - No business logic lives here — only data.
 *
 * Rule schema fields:
 *  configId        — unique stable identifier (SC-REQ-001, SC-CLI-001, …)
 *  entityType      — 'Requirement' | 'Client'
 *  factorId        — stable logical ID for the scoring factor
 *  field           — field key (v2Field key, flat field key, or computed key)
 *  fieldSource     — 'v2Field' | 'flatField' | 'computed'
 *  label           — human-readable factor name
 *  description     — explanation shown in the factor breakdown
 *  weight          — maximum contribution to a raw score
 *  scoreType       — 'fieldPresent' | 'valueLookup' | 'linear' | 'boolean'
 *  lookupMap       — { value → contribution } for valueLookup scoreType
 *  maxValue        — cap value for linear scoring
 *  contribution    — fixed contribution for boolean scoreType
 *  applicableWhen  — { transactionType?, category? } context filter; null = always
 *  unknownBehavior — 'skip' (default) = UNKNOWN excluded from calculation entirely
 *  active          — boolean
 *  version         — config schema version
 *  _v2             — true
 *
 * Score bands schema:
 *  bandId, min, max, label, description
 */

'use strict';

const SCORING_CONFIG_VERSION = '2.0';

// ── Score Bands ───────────────────────────────────────────────────────────────

const STATIC_SCORE_BANDS = [
  { bandId: 'COLD',     min: 0,  max: 29,  label: 'Cold',     description: 'Low engagement or insufficient information to qualify.' },
  { bandId: 'WARM',     min: 30, max: 49,  label: 'Warm',     description: 'Some signals present — worth nurturing.' },
  { bandId: 'GOOD',     min: 50, max: 69,  label: 'Good',     description: 'Clear requirement signals — actively working.' },
  { bandId: 'HOT',      min: 70, max: 84,  label: 'Hot',      description: 'Strong, well-defined requirement — prioritise.' },
  { bandId: 'VERY_HOT', min: 85, max: 100, label: 'Very Hot', description: 'Highly qualified, actionable requirement — close focus.' }
];

// ── Requirement Scoring Rules ─────────────────────────────────────────────────

const STATIC_REQUIREMENT_SCORING_RULES = [
  // ── Budget signals ─────────────────────────────────────────────────────────
  {
    configId: 'SC-REQ-001', entityType: 'Requirement', factorId: 'F-REQ-BUDGET-MAX',
    field: 'BudgetMax', fieldSource: 'v2Field',
    label: 'Budget Maximum Defined',
    description: 'Client has defined a maximum budget — narrows candidate property results.',
    weight: 20, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 20,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-REQ-002', entityType: 'Requirement', factorId: 'F-REQ-BUDGET-MIN',
    field: 'BudgetMin', fieldSource: 'v2Field',
    label: 'Budget Minimum Defined',
    description: 'Client has defined a minimum budget — refines price range.',
    weight: 5, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 5,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },

  // ── Location signals ───────────────────────────────────────────────────────
  {
    configId: 'SC-REQ-003', entityType: 'Requirement', factorId: 'F-REQ-LOCATION',
    field: 'Location1', fieldSource: 'v2Field',
    label: 'Primary Location Defined',
    description: 'Client has specified at least one preferred location — critical for shortlisting.',
    weight: 20, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 20,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },

  // ── Urgency/Timeline ───────────────────────────────────────────────────────
  {
    configId: 'SC-REQ-004', entityType: 'Requirement', factorId: 'F-REQ-URGENCY',
    field: 'Urgency', fieldSource: 'v2Field',
    label: 'Urgency / Timeline',
    description: 'Client has indicated a timeline urgency — signals seriousness of intent.',
    weight: 15, scoreType: 'valueLookup',
    lookupMap: { Immediate: 15, High: 15, Medium: 10, Low: 5 },
    maxValue: null, contribution: null,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-REQ-005', entityType: 'Requirement', factorId: 'F-REQ-POSSESSION',
    field: 'Possession', fieldSource: 'v2Field',
    label: 'Possession Timeline Specified',
    description: 'Possession preference is defined — removes ambiguity about timing.',
    weight: 10, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 10,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },

  // ── Category / SubCategory ─────────────────────────────────────────────────
  {
    configId: 'SC-REQ-006', entityType: 'Requirement', factorId: 'F-REQ-CATEGORY',
    field: 'Category', fieldSource: 'flatField',
    label: 'Property Category Defined',
    description: 'Requirement has a category (Residential/Commercial/Land/Industrial/Agriculture).',
    weight: 10, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 10,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-REQ-007', entityType: 'Requirement', factorId: 'F-REQ-SUBCATEGORY',
    field: 'SubCategory', fieldSource: 'flatField',
    label: 'Sub-Category Defined',
    description: 'Requirement has a sub-category (Flat/Villa/Office/Factory/etc.).',
    weight: 5, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 5,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },

  // ── Residential-specific ───────────────────────────────────────────────────
  {
    configId: 'SC-REQ-008', entityType: 'Requirement', factorId: 'F-REQ-BHK',
    field: 'BHKMin', fieldSource: 'v2Field',
    label: 'BHK Requirement Defined',
    description: 'Minimum BHK is specified — essential for Residential shortlisting.',
    weight: 10, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 10,
    applicableWhen: { category: 'Residential' }, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-REQ-009', entityType: 'Requirement', factorId: 'F-REQ-FURNISHING',
    field: 'Furnishing', fieldSource: 'v2Field',
    label: 'Furnishing Preference',
    description: 'Furnishing preference is specified — filters ready-to-move properties.',
    weight: 5, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 5,
    applicableWhen: { category: 'Residential' }, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },

  // ── Rent-specific ──────────────────────────────────────────────────────────
  {
    configId: 'SC-REQ-010', entityType: 'Requirement', factorId: 'F-REQ-TENANT-TYPE',
    field: 'TenantType', fieldSource: 'v2Field',
    label: 'Tenant Type Specified',
    description: 'Tenant preference (Family/Bachelor/Company) defined — critical for Rent matching.',
    weight: 10, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 10,
    applicableWhen: { transactionType: 'Rent' }, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-REQ-011', entityType: 'Requirement', factorId: 'F-REQ-DEPOSIT',
    field: 'Deposit', fieldSource: 'v2Field',
    label: 'Deposit Preference',
    description: 'Deposit amount or preference specified for Rent.',
    weight: 5, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 5,
    applicableWhen: { transactionType: 'Rent' }, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },

  // ── Commercial-specific ────────────────────────────────────────────────────
  {
    configId: 'SC-REQ-012', entityType: 'Requirement', factorId: 'F-REQ-BUSINESS-TYPE',
    field: 'BusinessType', fieldSource: 'v2Field',
    label: 'Business Type Specified',
    description: 'Business type defined — essential for Commercial property matching.',
    weight: 10, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 10,
    applicableWhen: { category: 'Commercial' }, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-REQ-013', entityType: 'Requirement', factorId: 'F-REQ-AREA-COMMERCIAL',
    field: 'AreaMin', fieldSource: 'v2Field',
    label: 'Area Requirement Defined (Commercial)',
    description: 'Minimum area is specified — filters by commercial space size.',
    weight: 10, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 10,
    applicableWhen: { category: 'Commercial' }, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },

  // ── Industrial-specific ────────────────────────────────────────────────────
  {
    configId: 'SC-REQ-014', entityType: 'Requirement', factorId: 'F-REQ-ZONE-TYPE',
    field: 'ZoneType', fieldSource: 'v2Field',
    label: 'Zone Type Specified (Industrial)',
    description: 'Industrial zone type defined — critical for compliance matching.',
    weight: 10, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 10,
    applicableWhen: { category: 'Industrial' }, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-REQ-015', entityType: 'Requirement', factorId: 'F-REQ-POWER-LOAD',
    field: 'PowerLoad', fieldSource: 'v2Field',
    label: 'Power Load Requirement (Industrial)',
    description: 'Power load requirement specified — essential for Industrial/Commercial.',
    weight: 5, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 5,
    applicableWhen: { category: 'Industrial' }, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },

  // ── Land-specific ──────────────────────────────────────────────────────────
  {
    configId: 'SC-REQ-016', entityType: 'Requirement', factorId: 'F-REQ-PLOT-AREA',
    field: 'PlotAreaMin', fieldSource: 'v2Field',
    label: 'Plot Area Minimum (Land)',
    description: 'Minimum plot area defined — core Land requirement.',
    weight: 10, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 10,
    applicableWhen: { category: 'Land' }, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-REQ-017', entityType: 'Requirement', factorId: 'F-REQ-ZONING',
    field: 'Zoning', fieldSource: 'v2Field',
    label: 'Zoning Preference (Land)',
    description: 'Zoning type defined — guides land use compliance.',
    weight: 5, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 5,
    applicableWhen: { category: 'Land' }, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },

  // ── Agriculture-specific ───────────────────────────────────────────────────
  {
    configId: 'SC-REQ-018', entityType: 'Requirement', factorId: 'F-REQ-TOTAL-AREA',
    field: 'TotalArea', fieldSource: 'v2Field',
    label: 'Total Area Defined (Agriculture)',
    description: 'Total agricultural area requirement defined.',
    weight: 10, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 10,
    applicableWhen: { category: 'Agriculture' }, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-REQ-019', entityType: 'Requirement', factorId: 'F-REQ-WATER-SOURCE',
    field: 'WaterSource', fieldSource: 'v2Field',
    label: 'Water Source Preference (Agriculture)',
    description: 'Water source preference defined for agricultural land.',
    weight: 5, scoreType: 'fieldPresent',
    lookupMap: null, maxValue: null, contribution: 5,
    applicableWhen: { category: 'Agriculture' }, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  }
];

// ── Client Scoring Rules ──────────────────────────────────────────────────────

const STATIC_CLIENT_SCORING_RULES = [
  {
    configId: 'SC-CLI-001', entityType: 'Client', factorId: 'F-CLI-STATUS',
    field: 'ClientStatus', fieldSource: 'flatField',
    label: 'Client Status',
    description: 'Active/Verified clients signal higher engagement and follow-through probability.',
    weight: 20, scoreType: 'valueLookup',
    lookupMap: {
      New: 5,
      Contacted: 10,
      'Follow-up': 12,
      Qualified: 20,
      'Requirement Created': 24,
      'Site Visit': 28,
      Negotiation: 32,
      Won: 35,
      Lost: 0,
      Verified: 10,
      Active: 20,
      Inactive: 0,
      Blacklisted: 0,
      Converted: 35
    },
    maxValue: null, contribution: null,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-CLI-002', entityType: 'Client', factorId: 'F-CLI-LIFECYCLE',
    field: 'ClientLifecycle', fieldSource: 'flatField',
    label: 'Client Lifecycle Stage',
    description: 'Current clients and past clients with reactivation signal higher conversion.',
    weight: 20, scoreType: 'valueLookup',
    lookupMap: { Prospect: 5, Client: 20, 'Past Client': 10, Inactive: 3, Blacklisted: 0 },
    maxValue: null, contribution: null,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-CLI-003', entityType: 'Client', factorId: 'F-CLI-PHONE',
    field: 'hasPhone', fieldSource: 'computed',
    label: 'Phone Available',
    description: 'A mobile number is available — enables direct agent contact.',
    weight: 15, scoreType: 'boolean',
    lookupMap: null, maxValue: null, contribution: 15,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-CLI-004', entityType: 'Client', factorId: 'F-CLI-EMAIL',
    field: 'hasEmail', fieldSource: 'computed',
    label: 'Email Available',
    description: 'An email address is captured — enables formal communication.',
    weight: 10, scoreType: 'boolean',
    lookupMap: null, maxValue: null, contribution: 10,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-CLI-005', entityType: 'Client', factorId: 'F-CLI-TAGS',
    field: 'hasTags', fieldSource: 'computed',
    label: 'Tags / Segments Present',
    description: 'Client has been tagged or segmented — indicates categorisation effort.',
    weight: 10, scoreType: 'boolean',
    lookupMap: null, maxValue: null, contribution: 10,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-CLI-006', entityType: 'Client', factorId: 'F-CLI-TXN-COUNT',
    field: 'transactionCount', fieldSource: 'computed',
    label: 'Number of Active Transactions',
    description: 'More transactions indicate higher engagement and purchase intent.',
    weight: 15, scoreType: 'linear',
    lookupMap: null, maxValue: 3, contribution: null,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  },
  {
    configId: 'SC-CLI-007', entityType: 'Client', factorId: 'F-CLI-REQ-COUNT',
    field: 'requirementCount', fieldSource: 'computed',
    label: 'Number of Requirements',
    description: 'Multiple requirements indicate an active search across property types.',
    weight: 10, scoreType: 'linear',
    lookupMap: null, maxValue: 3, contribution: null,
    applicableWhen: null, unknownBehavior: 'skip',
    active: true, version: SCORING_CONFIG_VERSION, _v2: true
  }
];

module.exports = {
  SCORING_CONFIG_VERSION,
  STATIC_SCORE_BANDS,
  STATIC_REQUIREMENT_SCORING_RULES,
  STATIC_CLIENT_SCORING_RULES
};
