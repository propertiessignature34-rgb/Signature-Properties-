/**
 * PHASE 8 — V2 Configuration Engine
 *
 * Configuration-driven architecture for Lead Module V2.
 * All configuration entities are defined here and served via API.
 * Frontend executes config — NO hardcoded category branching in frontend.
 */

'use strict';

// ─── Entity Config ────────────────────────────────────────────────────────────

const EntityConfig = {
  Lead: {
    entityKey: 'Lead',
    displayName: 'Client',
    pluralName: 'Clients',
    idField: 'LeadID',
    statuses: ['New', 'Contacted', 'Follow-up', 'Qualified', 'Requirement Created', 'Site Visit', 'Negotiation', 'Won', 'Lost'],
    defaultStatus: 'New',
    lifecycles: ['Prospect', 'Client', 'Past Client', 'Inactive', 'Blacklisted'],
    defaultLifecycle: 'Prospect',
    immutableFields: ['LeadID', 'LegacyID', 'CreatedAt', 'CreatedBy']
  },
  Transaction: {
    entityKey: 'Transaction',
    displayName: 'Transaction',
    pluralName: 'Transactions',
    idField: 'TransactionID',
    types: ['Purchase', 'Sale', 'Rent', 'Rent Out', 'Lease', 'Lease Out'],
    statuses: ['Open', 'Active', 'Closed', 'Cancelled'],
    defaultStatus: 'Open',
    pipelineStages: ['New', 'Matching', 'Shortlisted', 'Site Visit', 'Negotiation', 'Token', 'Deal'],
    defaultStage: 'New',
    immutableFields: ['TransactionID', 'LeadID', 'LegacyID', 'CreatedAt', 'CreatedBy']
  },
  Requirement: {
    entityKey: 'Requirement',
    displayName: 'Requirement',
    pluralName: 'Requirements',
    idField: 'RequirementID',
    statuses: ['Draft', 'Active', 'Paused', 'Closed', 'Lost', 'Archived'],
    defaultStatus: 'Draft',
    pipelineStages: ['New', 'Matching', 'Shortlisted', 'Site Visit', 'Negotiation', 'Token', 'Deal'],
    defaultStage: 'New',
    immutableFields: ['RequirementID', 'LeadID', 'TransactionID', 'LegacyID', 'FormVersion', 'CreatedAt', 'CreatedBy']
  }
};

// ─── Tag System (PHASE 12) ────────────────────────────────────────────────────

const TagConfig = {
  availableTags: [
    { value: 'Investor',  label: 'Investor',  color: '#7c3aed' },
    { value: 'Buyer',     label: 'Buyer',     color: '#2563eb' },
    { value: 'Seller',    label: 'Seller',    color: '#16a34a' },
    { value: 'Tenant',    label: 'Tenant',    color: '#0891b2' },
    { value: 'Landlord',  label: 'Landlord',  color: '#b45309' },
    { value: 'Builder',   label: 'Builder',   color: '#dc2626' },
    { value: 'NRI',       label: 'NRI',       color: '#9333ea' },
    { value: 'Corporate', label: 'Corporate', color: '#0f766e' },
    { value: 'VIP',       label: 'VIP',       color: '#ca8a04' },
    { value: 'Hot',       label: 'Hot 🔥',   color: '#ef4444' },
    { value: 'Referral',  label: 'Referral',  color: '#6366f1' }
  ]
};

// ─── Scoring Config (PHASE 11) ────────────────────────────────────────────────

const ScoringConfig = {
  client: {
    version: '1.0',
    maxScore: 100,
    rules: [
      { field: 'ClientStatus',    weight: 20, scoring: { New: 5, Verified: 10, Active: 20, Inactive: 5, Blacklisted: 0 } },
      { field: 'ClientLifecycle', weight: 20, scoring: { Prospect: 5, Client: 20, 'Past Client': 10, Inactive: 3, Blacklisted: 0 } },
      { field: 'hasPhone',        weight: 15, scoring: { true: 15, false: 0 } },
      { field: 'hasEmail',        weight: 10, scoring: { true: 10, false: 0 } },
      { field: 'hasTags',         weight: 10, scoring: { true: 10, false: 0 } },
      { field: 'transactionCount', weight: 15, scoring: 'linear', maxValue: 3, maxScore: 15 },
      { field: 'requirementCount', weight: 10, scoring: 'linear', maxValue: 3, maxScore: 10 }
    ]
  },
  requirement: {
    version: '1.0',
    maxScore: 100,
    rules: [
      { field: 'hasBudget',     weight: 20, scoring: { true: 20, false: 0 } },
      { field: 'hasLocation',   weight: 20, scoring: { true: 20, false: 0 } },
      { field: 'hasCategory',   weight: 15, scoring: { true: 15, false: 0 } },
      { field: 'urgency',       weight: 20, scoring: { High: 20, Medium: 10, Low: 5 } },
      { field: 'completeness',  weight: 25, scoring: 'percent', maxScore: 25 }
    ]
  }
};

// ─── Workflow Config (PHASE 11) ───────────────────────────────────────────────

const WorkflowConfig = {
  leadStatus: {
    transitions: {
      New: ['Contacted', 'Lost'],
      Contacted: ['Follow-up', 'Qualified', 'Requirement Created', 'Site Visit', 'Negotiation', 'Won', 'Lost'],
      'Follow-up': ['Qualified', 'Requirement Created', 'Site Visit', 'Negotiation', 'Won', 'Lost'],
      Qualified: ['Requirement Created', 'Site Visit', 'Negotiation', 'Won', 'Lost'],
      'Requirement Created': ['Site Visit', 'Negotiation', 'Won', 'Lost'],
      'Site Visit': ['Negotiation', 'Won', 'Lost'],
      Negotiation: ['Won', 'Lost'],
      Won: [],
      Lost: ['Contacted']
    }
  },
  clientLifecycle: {
    transitions: {
      Prospect:     ['Client', 'Inactive', 'Blacklisted'],
      Client:       ['Past Client', 'Inactive', 'Blacklisted'],
      'Past Client': ['Client', 'Inactive', 'Blacklisted'],
      Inactive:     ['Client', 'Blacklisted'],
      Blacklisted:  []
    }
  },
  requirementStatus: {
    transitions: {
      Draft:    ['Active', 'Archived'],
      Active:   ['Paused', 'Closed', 'Lost', 'Archived'],
      Paused:   ['Active', 'Closed', 'Lost', 'Archived'],
      Closed:   ['Archived'],
      Lost:     ['Active', 'Paused', 'Archived'],
      Archived: []
    }
  },
  transactionStatus: {
    transitions: {
      Open:      ['Active', 'Closed', 'Cancelled'],
      Active:    ['Closed', 'Cancelled'],
      Closed:    [],
      Cancelled: []
    }
  },
  pipelineStage: {
    ordered: ['New', 'Matching', 'Shortlisted', 'Site Visit', 'Negotiation', 'Token', 'Deal']
  }
};

// ─── Column Config (PHASE 15) ─────────────────────────────────────────────────

const ColumnConfig = {
  clientList: {
    version: '1.0',
    columns: [
      { key: 'ClientName',   label: 'Client Name',       sortable: true,  visible: true,  width: '200px' },
      { key: 'PrimaryMobile',label: 'Mobile',            sortable: false, visible: true,  width: '140px' },
      { key: 'ClientStatus', label: 'Status',            sortable: true,  visible: true,  width: '120px' },
      { key: 'ClientLifecycle', label: 'Lifecycle',      sortable: true,  visible: true,  width: '130px' },
      { key: 'Tags',         label: 'Tags',              sortable: false, visible: true,  width: '180px' },
      { key: 'requirementCount', label: 'Requirements',  sortable: true,  visible: true,  width: '110px' },
      { key: 'latestReqSummary', label: 'Latest Req',   sortable: false, visible: true,  width: '200px' },
      { key: 'budgetRange',  label: 'Budget',            sortable: false, visible: true,  width: '160px' },
      { key: 'location',     label: 'Location',          sortable: false, visible: true,  width: '140px' },
      { key: 'ClientScore',  label: 'Score',             sortable: true,  visible: true,  width: '80px' },
      { key: 'nextFollowUp', label: 'Follow-up',         sortable: true,  visible: true,  width: '130px' },
      { key: 'AssignedAgentID', label: 'Agent',          sortable: true,  visible: false, width: '120px' },
      { key: 'Source',       label: 'Source',            sortable: true,  visible: false, width: '120px' },
      { key: 'CreatedAt',    label: 'Created',           sortable: true,  visible: false, width: '120px' }
    ]
  },
  globalRequirements: {
    version: '1.0',
    columns: [
      { key: 'RequirementID',    label: 'Req ID',         sortable: true,  visible: true, width: '100px' },
      { key: 'clientName',       label: 'Client',         sortable: true,  visible: true, width: '180px' },
      { key: 'TransactionType',  label: 'Type',           sortable: true,  visible: true, width: '100px' },
      { key: 'Category',         label: 'Category',       sortable: true,  visible: true, width: '120px' },
      { key: 'SubCategory',      label: 'Sub Cat',        sortable: true,  visible: true, width: '120px' },
      { key: 'budgetRange',      label: 'Budget',         sortable: false, visible: true, width: '160px' },
      { key: 'Location1',        label: 'Location',       sortable: true,  visible: true, width: '140px' },
      { key: 'RequirementStatus',label: 'Status',         sortable: true,  visible: true, width: '110px' },
      { key: 'PipelineStage',    label: 'Stage',          sortable: true,  visible: true, width: '120px' },
      { key: 'Urgency',          label: 'Urgency',        sortable: true,  visible: true, width: '90px' },
      { key: 'RequirementScore', label: 'Score',          sortable: true,  visible: true, width: '80px' },
      { key: 'CreatedAt',        label: 'Created',        sortable: true,  visible: false, width: '120px' }
    ]
  }
};

// ─── V2 Form Registry (PHASE 9) ───────────────────────────────────────────────
// Registry key: TransactionType + Category + SubCategory
// Each entry is versioned and immutable once a Requirement is created.

const FORM_REGISTRY_VERSION = '2.0';

const V2FormRegistry = {
  // ── Residential ─────────────────────────────────────────────────────────────
  'Purchase|Residential|Flat': buildResidentialForm('Purchase', 'Residential', 'Flat', ['1BHK', '2BHK', '3BHK', '4BHK', '5BHK+']),
  'Purchase|Residential|Villa': buildResidentialForm('Purchase', 'Residential', 'Villa', ['3BHK', '4BHK', '5BHK+']),
  'Purchase|Residential|Row House': buildResidentialForm('Purchase', 'Residential', 'Row House', ['2BHK', '3BHK', '4BHK']),
  'Purchase|Residential|Bungalow': buildResidentialForm('Purchase', 'Residential', 'Bungalow', ['3BHK', '4BHK', '5BHK+']),
  'Purchase|Residential|Penthouse': buildResidentialForm('Purchase', 'Residential', 'Penthouse', ['3BHK', '4BHK', '5BHK+']),
  'Purchase|Residential|Studio': buildResidentialForm('Purchase', 'Residential', 'Studio', ['Studio']),

  'Rent|Residential|Flat': buildResidentialForm('Rent', 'Residential', 'Flat', ['1BHK', '2BHK', '3BHK', '4BHK']),
  'Rent|Residential|Villa': buildResidentialForm('Rent', 'Residential', 'Villa', ['3BHK', '4BHK', '5BHK+']),
  'Rent|Residential|Row House': buildResidentialForm('Rent', 'Residential', 'Row House', ['2BHK', '3BHK']),
  'Rent|Residential|Bungalow': buildResidentialForm('Rent', 'Residential', 'Bungalow', ['3BHK', '4BHK', '5BHK+']),

  'Rent Out|Residential|Flat': buildResidentialForm('Rent Out', 'Residential', 'Flat', ['1BHK', '2BHK', '3BHK', '4BHK']),
  'Rent Out|Residential|Villa': buildResidentialForm('Rent Out', 'Residential', 'Villa', ['3BHK', '4BHK', '5BHK+']),

  'Sale|Residential|Flat': buildResidentialForm('Sale', 'Residential', 'Flat', ['1BHK', '2BHK', '3BHK', '4BHK', '5BHK+']),
  'Sale|Residential|Villa': buildResidentialForm('Sale', 'Residential', 'Villa', ['3BHK', '4BHK', '5BHK+']),
  'Sale|Residential|Row House': buildResidentialForm('Sale', 'Residential', 'Row House', ['2BHK', '3BHK', '4BHK']),
  'Sale|Residential|Bungalow': buildResidentialForm('Sale', 'Residential', 'Bungalow', ['3BHK', '4BHK', '5BHK+']),

  'Lease|Residential|Flat': buildResidentialForm('Lease', 'Residential', 'Flat', ['2BHK', '3BHK', '4BHK']),
  'Lease Out|Residential|Flat': buildResidentialForm('Lease Out', 'Residential', 'Flat', ['2BHK', '3BHK', '4BHK']),

  // ── Commercial ──────────────────────────────────────────────────────────────
  'Purchase|Commercial|Office': buildCommercialForm('Purchase', 'Commercial', 'Office'),
  'Purchase|Commercial|Shop': buildCommercialForm('Purchase', 'Commercial', 'Shop'),
  'Purchase|Commercial|Showroom': buildCommercialForm('Purchase', 'Commercial', 'Showroom'),
  'Purchase|Commercial|Warehouse': buildCommercialForm('Purchase', 'Commercial', 'Warehouse'),

  'Rent|Commercial|Office': buildCommercialForm('Rent', 'Commercial', 'Office'),
  'Rent|Commercial|Shop': buildCommercialForm('Rent', 'Commercial', 'Shop'),
  'Rent|Commercial|Showroom': buildCommercialForm('Rent', 'Commercial', 'Showroom'),
  'Rent|Commercial|Warehouse': buildCommercialForm('Rent', 'Commercial', 'Warehouse'),

  'Rent Out|Commercial|Office': buildCommercialForm('Rent Out', 'Commercial', 'Office'),
  'Rent Out|Commercial|Shop': buildCommercialForm('Rent Out', 'Commercial', 'Shop'),
  'Sale|Commercial|Office': buildCommercialForm('Sale', 'Commercial', 'Office'),
  'Sale|Commercial|Shop': buildCommercialForm('Sale', 'Commercial', 'Shop'),
  'Sale|Commercial|Showroom': buildCommercialForm('Sale', 'Commercial', 'Showroom'),
  'Sale|Commercial|Warehouse': buildCommercialForm('Sale', 'Commercial', 'Warehouse'),
  'Lease|Commercial|Office': buildCommercialForm('Lease', 'Commercial', 'Office'),
  'Lease|Commercial|Shop': buildCommercialForm('Lease', 'Commercial', 'Shop'),
  'Lease|Commercial|Showroom': buildCommercialForm('Lease', 'Commercial', 'Showroom'),
  'Lease|Commercial|Warehouse': buildCommercialForm('Lease', 'Commercial', 'Warehouse'),
  'Lease Out|Commercial|Office': buildCommercialForm('Lease Out', 'Commercial', 'Office'),
  'Lease Out|Commercial|Shop': buildCommercialForm('Lease Out', 'Commercial', 'Shop'),
  'Lease Out|Commercial|Showroom': buildCommercialForm('Lease Out', 'Commercial', 'Showroom'),
  'Lease Out|Commercial|Warehouse': buildCommercialForm('Lease Out', 'Commercial', 'Warehouse'),

  // ── Land ────────────────────────────────────────────────────────────────────
  'Purchase|Land|Residential Plot': buildLandForm('Purchase', 'Land', 'Residential Plot'),
  'Purchase|Land|Commercial Plot': buildLandForm('Purchase', 'Land', 'Commercial Plot'),
  'Purchase|Land|Agricultural Land': buildLandForm('Purchase', 'Land', 'Agricultural Land'),
  'Sale|Land|Residential Plot': buildLandForm('Sale', 'Land', 'Residential Plot'),
  'Sale|Land|Commercial Plot': buildLandForm('Sale', 'Land', 'Commercial Plot'),
  'Sale|Land|Agricultural Land': buildLandForm('Sale', 'Land', 'Agricultural Land'),
  'Lease|Land|Residential Plot': buildLandForm('Lease', 'Land', 'Residential Plot'),
  'Lease|Land|Commercial Plot': buildLandForm('Lease', 'Land', 'Commercial Plot'),
  'Lease|Land|Agricultural Land': buildLandForm('Lease', 'Land', 'Agricultural Land'),

  // ── Industrial ──────────────────────────────────────────────────────────────
  'Purchase|Industrial|Factory': buildIndustrialForm('Purchase', 'Industrial', 'Factory'),
  'Purchase|Industrial|Warehouse': buildIndustrialForm('Purchase', 'Industrial', 'Warehouse'),
  'Rent|Industrial|Factory': buildIndustrialForm('Rent', 'Industrial', 'Factory'),
  'Rent|Industrial|Warehouse': buildIndustrialForm('Rent', 'Industrial', 'Warehouse'),
  'Lease|Industrial|Factory': buildIndustrialForm('Lease', 'Industrial', 'Factory'),
  'Lease|Industrial|Warehouse': buildIndustrialForm('Lease', 'Industrial', 'Warehouse'),
  'Lease Out|Industrial|Factory': buildIndustrialForm('Lease Out', 'Industrial', 'Factory'),
  'Lease Out|Industrial|Warehouse': buildIndustrialForm('Lease Out', 'Industrial', 'Warehouse'),

  // ── Agriculture ─────────────────────────────────────────────────────────────
  'Purchase|Agriculture|Agricultural Land': buildAgricultureForm('Purchase', 'Agriculture', 'Agricultural Land'),
  'Purchase|Agriculture|Farm House':        buildAgricultureForm('Purchase', 'Agriculture', 'Farm House'),
  'Purchase|Agriculture|Orchard':           buildAgricultureForm('Purchase', 'Agriculture', 'Orchard'),
  'Sale|Agriculture|Agricultural Land':     buildAgricultureForm('Sale',     'Agriculture', 'Agricultural Land'),
  'Sale|Agriculture|Farm House':            buildAgricultureForm('Sale',     'Agriculture', 'Farm House'),
  'Lease|Agriculture|Agricultural Land':    buildAgricultureForm('Lease',    'Agriculture', 'Agricultural Land'),
  'Lease Out|Agriculture|Agricultural Land':buildAgricultureForm('Lease Out','Agriculture', 'Agricultural Land'),

  // Fallback generic
  'generic': buildGenericForm()
};

// ─── Form Builders ────────────────────────────────────────────────────────────

function buildCommonFields() {
  return {
    budgetMin: field('budgetMin', 'Budget Min', 'Number', true, 1, { validation: 'positive-number', budgetRole: 'min' }),
    budgetMax: field('budgetMax', 'Budget Max', 'Number', true, 2, { validation: 'positive-number', budgetRole: 'max' }),
    budgetType: field('budgetType', 'Budget Type', 'Select', false, 3, { options: ['All Inclusive', 'Base Price', 'Negotiable'] }),
    budgetFlexibility: field('budgetFlexibility', 'Budget Flexibility', 'Select', false, 4, { options: ['Strict', 'Slightly Flexible', 'Very Flexible'] }),
    location1: field('Location1', 'Primary Location', 'Text', true, 5),
    location2: field('Location2', 'Secondary Location', 'Text', false, 6),
    location3: field('Location3', 'Tertiary Location', 'Text', false, 7),
    avoidLocations: field('AvoidLocations', 'Avoid Locations', 'Text', false, 8),
    possession: field('Possession', 'Possession', 'Select', false, 9, { options: ['Ready', 'Ready to Move', '0-6 Months', '6-12 Months', '1-2 Years', '2-3 Years', '3+ Years'] }),
    urgency: field('Urgency', 'Urgency', 'Select', true, 10, { options: ['Immediate', 'High', 'Medium', 'Low'] }),
    moveInDate: field('MoveInDate', 'Move-in Date', 'Date', false, 11),
    preferences: field('Preferences', 'Additional Preferences', 'Textarea', false, 50)
  };
}

// Rent-specific fields — included in Rent / Rent Out forms only
function buildRentSpecificFields() {
  return {
    tenantType:         field('TenantType',         'Tenant Type',              'Select',  false, 30, { options: ['Family', 'Bachelor', 'Company', 'Any'] }),
    deposit:            field('Deposit',             'Security Deposit (months)', 'Number', false, 31, { validation: 'positive-number' }),
    maintenanceCharges: field('MaintenanceCharges',  'Maintenance Charges (₹/mo)', 'Number', false, 32),
    petAllowed:         field('PetAllowed',          'Pets Allowed',             'Boolean', false, 33)
  };
}

function buildResidentialForm(txnType, category, subCategory, bhkOptions) {
  const isRent = txnType === 'Rent' || txnType === 'Rent Out';
  return {
    formKey: `${txnType}|${category}|${subCategory}`,
    formVersion: FORM_REGISTRY_VERSION,
    formName: `${txnType} — ${category} — ${subCategory}`,
    transactionType: txnType,
    category,
    subCategory,
    isActive: true,
    fields: {
      ...buildCommonFields(),
      ...(isRent ? buildRentSpecificFields() : {}),
      bhkMin: field('BHKMin', 'BHK Min', 'Select', true, 20, { options: bhkOptions }),
      bhkMax: field('BHKMax', 'BHK Max', 'Select', true, 21, { options: bhkOptions }),
      areaMin: field('AreaMin', 'Area Min (sq.ft)', 'Number', false, 22, { validation: 'positive-number' }),
      areaMax: field('AreaMax', 'Area Max (sq.ft)', 'Number', false, 23, { validation: 'positive-number' }),
      furnishing: field('Furnishing', 'Furnishing', 'Select', false, 24, { options: ['Unfurnished', 'Semi Furnished', 'Fully Furnished'] }),
      facing: field('Facing', 'Facing', 'Select', false, 25, { options: ['East', 'West', 'North', 'South', 'North-East', 'North-West', 'South-East', 'South-West'] }),
      floor: field('Floor', 'Floor Preference', 'Select', false, 26, { options: ['Ground', 'Low (1-5)', 'Mid (6-15)', 'High (16+)', 'Any'] }),
      parking: field('Parking', 'Parking', 'MultiSelect', false, 27, { options: ['2 Wheeler', 'Car', 'No Preference'] }),
      vastu: field('Vastu', 'Vastu Compliant', 'Boolean', false, 28),
      gatedCommunity: field('GatedCommunity', 'Gated Community', 'Boolean', false, 29)
    },
    dependencies: [
      { field: 'BHKMax', dependsOn: 'BHKMin', rule: 'gte', errorMessage: 'BHK Max must be ≥ BHK Min' },
      { field: 'AreaMax', dependsOn: 'AreaMin', rule: 'gte', errorMessage: 'Area Max must be ≥ Area Min' },
      { field: 'budgetMax', dependsOn: 'budgetMin', rule: 'gte', errorMessage: 'Budget Max must be ≥ Budget Min' }
    ]
  };
}

function buildCommercialForm(txnType, category, subCategory) {
  const isRent = txnType === 'Rent' || txnType === 'Rent Out';
  return {
    formKey: `${txnType}|${category}|${subCategory}`,
    formVersion: FORM_REGISTRY_VERSION,
    formName: `${txnType} — ${category} — ${subCategory}`,
    transactionType: txnType,
    category,
    subCategory,
    isActive: true,
    fields: {
      ...buildCommonFields(),
      ...(isRent ? buildRentSpecificFields() : {}),
      areaMin: field('AreaMin', 'Area Min (sq.ft)', 'Number', true, 20, { validation: 'positive-number' }),
      areaMax: field('AreaMax', 'Area Max (sq.ft)', 'Number', true, 21, { validation: 'positive-number' }),
      businessType: field('BusinessType', 'Business Type', 'Select', true, 22, { options: ['Retail', 'Office', 'Hospitality', 'Healthcare', 'Education', 'IT/ITES', 'Other'] }),
      powerLoad: field('PowerLoad', 'Power Load (KW)', 'Number', false, 23),
      fireNoc: field('FireNOC', 'Fire NOC Required', 'Boolean', false, 24),
      frontageWidth: field('FrontageWidth', 'Frontage Width (ft)', 'Number', false, 25),
      parkingSlots: field('ParkingSlots', 'Parking Slots', 'Number', false, 26),
      liftRequired: field('LiftRequired', 'Lift Required', 'Boolean', false, 27)
    },
    dependencies: [
      { field: 'AreaMax', dependsOn: 'AreaMin', rule: 'gte', errorMessage: 'Area Max must be ≥ Area Min' },
      { field: 'budgetMax', dependsOn: 'budgetMin', rule: 'gte', errorMessage: 'Budget Max must be ≥ Budget Min' }
    ]
  };
}

function buildAgricultureForm(txnType, category, subCategory) {
  return {
    formKey: `${txnType}|${category}|${subCategory}`,
    formVersion: FORM_REGISTRY_VERSION,
    formName: `${txnType} — ${category} — ${subCategory}`,
    transactionType: txnType,
    category,
    subCategory,
    isActive: true,
    fields: {
      ...buildCommonFields(),
      totalArea:            field('TotalArea',            'Total Area (acres)',        'Number',  true,  20, { validation: 'positive-number' }),
      waterSource:          field('WaterSource',          'Water Source',             'Select',  false, 21, { options: ['Well', 'Borewell', 'Canal', 'River', 'None'] }),
      soilType:             field('SoilType',             'Soil Type',                'Select',  false, 22, { options: ['Black', 'Red', 'Alluvial', 'Sandy', 'Loamy', 'Mixed'] }),
      electricityAvailable: field('ElectricityAvailable', 'Electricity Available',    'Boolean', false, 23),
      roadAccess:           field('RoadAccess',           'Road Access',              'Boolean', false, 24),
      irrigationAvailable:  field('IrrigationAvailable',  'Irrigation Available',     'Boolean', false, 25),
      fencing:              field('Fencing',              'Fencing Available',        'Boolean', false, 26)
    },
    dependencies: [
      { field: 'budgetMax', dependsOn: 'budgetMin', rule: 'gte', errorMessage: 'Budget Max must be ≥ Budget Min' }
    ]
  };
}

function buildLandForm(txnType, category, subCategory) {
  return {
    formKey: `${txnType}|${category}|${subCategory}`,
    formVersion: FORM_REGISTRY_VERSION,
    formName: `${txnType} — ${category} — ${subCategory}`,
    transactionType: txnType,
    category,
    subCategory,
    isActive: true,
    fields: {
      ...buildCommonFields(),
      plotMin: field('PlotAreaMin', 'Plot Area Min (sq.yd)', 'Number', true, 20, { validation: 'positive-number' }),
      plotMax: field('PlotAreaMax', 'Plot Area Max (sq.yd)', 'Number', true, 21, { validation: 'positive-number' }),
      zoning: field('Zoning', 'Zoning', 'Select', true, 22, { options: ['Residential', 'Commercial', 'Mixed Use', 'Agricultural', 'Industrial'] }),
      approachRoad: field('ApproachRoad', 'Approach Road Width (ft)', 'Number', false, 23),
      waterLine: field('WaterLine', 'Water Line Available', 'Boolean', false, 24),
      gasPipeline: field('GasPipeline', 'Gas Pipeline Available', 'Boolean', false, 25),
      cornerPlot: field('CornerPlot', 'Corner Plot Preferred', 'Boolean', false, 26)
    },
    dependencies: [
      { field: 'PlotAreaMax', dependsOn: 'PlotAreaMin', rule: 'gte', errorMessage: 'Plot Max must be ≥ Plot Min' },
      { field: 'budgetMax', dependsOn: 'budgetMin', rule: 'gte', errorMessage: 'Budget Max must be ≥ Budget Min' }
    ]
  };
}

function buildIndustrialForm(txnType, category, subCategory) {
  return {
    formKey: `${txnType}|${category}|${subCategory}`,
    formVersion: FORM_REGISTRY_VERSION,
    formName: `${txnType} — ${category} — ${subCategory}`,
    transactionType: txnType,
    category,
    subCategory,
    isActive: true,
    fields: {
      ...buildCommonFields(),
      areaMin: field('AreaMin', 'Area Min (sq.ft)', 'Number', true, 20, { validation: 'positive-number' }),
      areaMax: field('AreaMax', 'Area Max (sq.ft)', 'Number', true, 21, { validation: 'positive-number' }),
      zoneType: field('ZoneType', 'Zone Type', 'Select', true, 22, { options: ['Warehouse', 'Manufacturing', 'Logistics', 'Cold Storage', 'Data Center'] }),
      powerLoad: field('PowerLoad', 'Power Load (KW)', 'Number', true, 23),
      loadingBay: field('LoadingBay', 'Loading Bay Required', 'Boolean', false, 24),
      ceilingHeight: field('CeilingHeight', 'Ceiling Height (ft)', 'Number', false, 25),
      flooringType: field('FlooringType', 'Flooring Type', 'Select', false, 26, { options: ['VDF', 'Epoxy', 'Tiles', 'Plain Cement', 'Any'] })
    },
    dependencies: [
      { field: 'AreaMax', dependsOn: 'AreaMin', rule: 'gte', errorMessage: 'Area Max must be ≥ Area Min' },
      { field: 'budgetMax', dependsOn: 'budgetMin', rule: 'gte', errorMessage: 'Budget Max must be ≥ Budget Min' }
    ]
  };
}

function buildGenericForm() {
  return {
    formKey: 'generic',
    formVersion: FORM_REGISTRY_VERSION,
    formName: 'Generic Requirement Form',
    transactionType: null,
    category: null,
    subCategory: null,
    isActive: true,
    fields: buildCommonFields(),
    dependencies: [
      { field: 'budgetMax', dependsOn: 'budgetMin', rule: 'gte', errorMessage: 'Budget Max must be ≥ Budget Min' }
    ]
  };
}

function field(id, label, type, required, order, extra = {}) {
  return {
    fieldId: id,
    fieldLabel: label,
    fieldType: type,
    required: !!required,
    displayOrder: order,
    visible: true,
    active: true,
    ...extra
  };
}

// ─── Validation Config (PHASE 10) ─────────────────────────────────────────────

const ValidationConfig = {
  rules: {
    'positive-number': { type: 'number', min: 0, errorMessage: 'Must be a positive number' },
    'required-text':   { type: 'text', minLength: 1, errorMessage: 'This field is required' },
    'mobile':          { type: 'regex', pattern: '^[+]?[0-9]{10,15}$', errorMessage: 'Invalid mobile number' },
    'email':           { type: 'regex', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', errorMessage: 'Invalid email address' },
    'gte':             { type: 'cross-field', comparator: '>=', errorMessage: 'Value must be ≥ dependent field' }
  }
};

// ─── Source Options ───────────────────────────────────────────────────────────

const SourceOptions = [
  'Walk-in', 'Phone Enquiry', 'Website', 'Social Media', 'Facebook Ads',
  'Google Ads', 'Referral', 'Agent Referral', 'Builder Referral',
  'Property Portal', '99acres', 'MagicBricks', 'Housing.com',
  'NoBroker', 'WhatsApp', 'SMS Campaign', 'Email Campaign',
  'Exhibition', 'Newspaper Ad', 'Outdoor Hoarding', 'Manual', 'Other'
];

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  EntityConfig,
  TagConfig,
  ScoringConfig,
  WorkflowConfig,
  ColumnConfig,
  V2FormRegistry,
  ValidationConfig,
  SourceOptions,
  FORM_REGISTRY_VERSION
};
