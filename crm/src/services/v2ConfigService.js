/**
 * PHASE 8 — V2 Configuration Engine
 */

'use strict';

const REQUIRED_MODE = {
  CREATE_CORE: 'CREATE_CORE',
  IMPORTANT: 'IMPORTANT',
  OPTIONAL: 'OPTIONAL',
  CONDITIONAL: 'CONDITIONAL'
};

const FIELD_TIER = {
  CORE: 'CORE',
  IMPORTANT: 'IMPORTANT',
  OPTIONAL: 'OPTIONAL'
};

const SECTION = {
  TRANSACTION: 'Transaction',
  BUDGET: 'Budget',
  LOCATION: 'Location',
  PROPERTY: 'Property',
  TIMING: 'Timing',
  EXTRAS: 'Extras',
  LEGAL: 'Legal',
  CLIENT: 'Client',
  DETAILS: 'Details'
};

function cfg(row) {
  return {
    FieldConfigID: row.FieldConfigID,
    FieldKey: row.FieldKey,
    FieldLabel: row.FieldLabel,
    QuestionLabel: row.QuestionLabel || row.FieldLabel,
    FieldType: row.FieldType || 'Text',
    Section: row.Section || SECTION.DETAILS,
    Tier: row.Tier || FIELD_TIER.OPTIONAL,
    RequiredMode: row.RequiredMode || REQUIRED_MODE.OPTIONAL,
    Options: Array.isArray(row.Options) ? row.Options : [],
    DisplayOrder: typeof row.DisplayOrder === 'number' ? row.DisplayOrder : 99,
    TransactionType: row.TransactionType !== undefined ? row.TransactionType : null,
    Category: row.Category !== undefined ? row.Category : null,
    SubCategory: row.SubCategory !== undefined ? row.SubCategory : null,
    Active: row.Active !== false,
    DefaultValue: row.DefaultValue ?? null,
    Validation: row.Validation ?? null,
    HelpText: row.HelpText ?? null,
    Placeholder: row.Placeholder ?? null,
    _v2: true
  };
}

const COMMON_FIELDS = [
  cfg({ FieldConfigID: 'FC-001', FieldKey: 'TransactionType', FieldLabel: 'Transaction Type', QuestionLabel: 'Kya karna chahte hain?', FieldType: 'Select', Section: SECTION.TRANSACTION, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.CREATE_CORE, Options: ['Purchase', 'Sale', 'Rent', 'Rent Out', 'Lease', 'Lease Out'], DisplayOrder: 1, Placeholder: 'Select type' }),
  cfg({ FieldConfigID: 'FC-002', FieldKey: 'Category', FieldLabel: 'Category', QuestionLabel: 'Kaunse type ki property chahiye?', FieldType: 'Select', Section: SECTION.TRANSACTION, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.CREATE_CORE, Options: ['Residential', 'Commercial', 'Land', 'Industrial'], DisplayOrder: 2, Placeholder: 'Select category' }),
  cfg({ FieldConfigID: 'FC-003', FieldKey: 'SubCategory', FieldLabel: 'Property Type', QuestionLabel: 'Specifically kaunsa type?', FieldType: 'Select', Section: SECTION.TRANSACTION, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: [], DisplayOrder: 3, HelpText: 'Depends on Category', Placeholder: 'Select property type' }),
  cfg({ FieldConfigID: 'FC-004', FieldKey: 'WhoIsSpeaking', FieldLabel: 'Who Is Speaking', QuestionLabel: 'Abhi kis se baat ho rahi hai?', FieldType: 'Text', Section: SECTION.CLIENT, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.CREATE_CORE, DisplayOrder: 4, Placeholder: 'Client / spouse / manager / owner' }),
  cfg({ FieldConfigID: 'FC-005', FieldKey: 'ContactMobile', FieldLabel: 'Contact Mobile', QuestionLabel: 'Contact number kya hai?', FieldType: 'Text', Section: SECTION.CLIENT, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 5, Placeholder: 'Phone / WhatsApp' }),
  cfg({ FieldConfigID: 'FC-006', FieldKey: 'ContactEmail', FieldLabel: 'Contact Email', QuestionLabel: 'Email ID kya hai?', FieldType: 'Text', Section: SECTION.CLIENT, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 6, Placeholder: 'name@example.com' }),
  cfg({ FieldConfigID: 'FC-010', FieldKey: 'BudgetMin', FieldLabel: 'Budget Min', QuestionLabel: 'Budget minimum kitna hai?', FieldType: 'Number', Section: SECTION.BUDGET, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.CREATE_CORE, DisplayOrder: 10, Validation: 'positive-number', Placeholder: 'e.g. 5000000' }),
  cfg({ FieldConfigID: 'FC-011', FieldKey: 'BudgetMax', FieldLabel: 'Budget Max', QuestionLabel: 'Budget maximum kitna hai?', FieldType: 'Number', Section: SECTION.BUDGET, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.CREATE_CORE, DisplayOrder: 11, Validation: 'positive-number', Placeholder: 'e.g. 10000000' }),
  cfg({ FieldConfigID: 'FC-012', FieldKey: 'BudgetType', FieldLabel: 'Budget Type', QuestionLabel: 'Budget type kya hai?', FieldType: 'Select', Section: SECTION.BUDGET, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, Options: ['All Inclusive', 'Base Price', 'Negotiable'], DisplayOrder: 12 }),
  cfg({ FieldConfigID: 'FC-013', FieldKey: 'BudgetFlexibility', FieldLabel: 'Budget Flexibility', QuestionLabel: 'Budget mein kitni flexibility hai?', FieldType: 'Select', Section: SECTION.BUDGET, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, Options: ['Strict', 'Slightly Flexible', 'Very Flexible'], DisplayOrder: 13 }),
  cfg({ FieldConfigID: 'FC-020', FieldKey: 'Location1', FieldLabel: 'Primary Location', QuestionLabel: 'Kahan property chahiye?', FieldType: 'Text', Section: SECTION.LOCATION, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.CREATE_CORE, DisplayOrder: 20, Placeholder: 'e.g. Vesu, Adajan' }),
  cfg({ FieldConfigID: 'FC-021', FieldKey: 'Location2', FieldLabel: 'Secondary Location', QuestionLabel: 'Koi aur location acceptable hai?', FieldType: 'Text', Section: SECTION.LOCATION, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 21, Placeholder: 'e.g. Pal, Piplod' }),
  cfg({ FieldConfigID: 'FC-022', FieldKey: 'Location3', FieldLabel: 'Tertiary Location', QuestionLabel: 'Koi aur backup location?', FieldType: 'Text', Section: SECTION.LOCATION, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 22 }),
  cfg({ FieldConfigID: 'FC-023', FieldKey: 'AvoidLocations', FieldLabel: 'Avoid Locations', QuestionLabel: 'Kaunse areas avoid karne hain?', FieldType: 'Text', Section: SECTION.LOCATION, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 23 }),
  cfg({ FieldConfigID: 'FC-030', FieldKey: 'Possession', FieldLabel: 'Possession', QuestionLabel: 'Possession kab tak chahiye?', FieldType: 'Select', Section: SECTION.TIMING, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Ready', 'Ready to Move', '0-6 Months', '6-12 Months', '1-2 Years', '2-3 Years', '3+ Years'], DisplayOrder: 30 }),
  cfg({ FieldConfigID: 'FC-031', FieldKey: 'Urgency', FieldLabel: 'Urgency', QuestionLabel: 'Kitni jaldi chahiye?', FieldType: 'Select', Section: SECTION.TIMING, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Immediate', 'High', 'Medium', 'Low'], DisplayOrder: 31 }),
  cfg({ FieldConfigID: 'FC-032', FieldKey: 'MoveInDate', FieldLabel: 'Move-in Date', QuestionLabel: 'Kab move in karna hai?', FieldType: 'Date', Section: SECTION.TIMING, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 32 }),
  cfg({ FieldConfigID: 'FC-033', FieldKey: 'UseCase', FieldLabel: 'Use Case', QuestionLabel: 'Primary use case kya hai?', FieldType: 'Select', Section: SECTION.TRANSACTION, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.CONDITIONAL, Options: ['Self Use', 'Investment', 'Retail', 'Corporate Office', 'Managed Office', 'Storage', 'Logistics', 'Manufacturing', 'Residential Use'], DisplayOrder: 33, HelpText: 'Shown where relevant.' }),
  cfg({ FieldConfigID: 'FC-034', FieldKey: 'PropertyPreference', FieldLabel: 'Requirement For', QuestionLabel: 'Requirement kis purpose ke liye hai?', FieldType: 'Select', Section: SECTION.TRANSACTION, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Buy', 'Sell', 'Rent', 'Lease', 'Give on Rent', 'Give on Lease'], DisplayOrder: 34 })
];

const RESIDENTIAL_FIELDS = [
  cfg({ FieldConfigID: 'FC-040', FieldKey: 'BHKMin', FieldLabel: 'BHK Min', QuestionLabel: 'Minimum kitne BHK chahiye?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['1BHK', '2BHK', '3BHK', '4BHK', '5BHK+', 'Studio'], DisplayOrder: 40, Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-041', FieldKey: 'BHKMax', FieldLabel: 'BHK Max', QuestionLabel: 'Maximum kitne BHK chalenge?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['1BHK', '2BHK', '3BHK', '4BHK', '5BHK+', 'Studio'], DisplayOrder: 41, Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-042', FieldKey: 'AreaMin', FieldLabel: 'Area Min (sq.ft)', QuestionLabel: 'Minimum area kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 42, Category: 'Residential', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-043', FieldKey: 'AreaMax', FieldLabel: 'Area Max (sq.ft)', QuestionLabel: 'Maximum area kitna?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 43, Category: 'Residential', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-044', FieldKey: 'Furnishing', FieldLabel: 'Furnishing', QuestionLabel: 'Furnished ya unfurnished chahiye?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, Options: ['Unfurnished', 'Semi Furnished', 'Semi-Furnished', 'Furnished', 'Fully Furnished'], DisplayOrder: 44, Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-045', FieldKey: 'Facing', FieldLabel: 'Facing', QuestionLabel: 'Kaunsa facing chahiye?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, Options: ['East', 'West', 'North', 'South', 'North-East', 'North-West', 'South-East', 'South-West'], DisplayOrder: 45, Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-046', FieldKey: 'Floor', FieldLabel: 'Floor Preference', QuestionLabel: 'Kaunsa floor prefer karte hain?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, Options: ['Ground', 'Low (1-5)', 'Mid (6-15)', 'High (16+)', 'Any'], DisplayOrder: 46, Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-047', FieldKey: 'Parking', FieldLabel: 'Parking', QuestionLabel: 'Parking ki zaroorat hai?', FieldType: 'MultiSelect', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, Options: ['2 Wheeler', 'Car', 'No Preference'], DisplayOrder: 47, Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-048', FieldKey: 'Vastu', FieldLabel: 'Vastu Compliant', QuestionLabel: 'Vastu compliant chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 48, Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-049', FieldKey: 'GatedCommunity', FieldLabel: 'Gated Community', QuestionLabel: 'Gated community chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 49, Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-113', FieldKey: 'CarpetAreaMin', FieldLabel: 'Carpet Area Min (sq.ft)', QuestionLabel: 'Minimum carpet area kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 50, Category: 'Residential', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-114', FieldKey: 'CarpetAreaMax', FieldLabel: 'Carpet Area Max (sq.ft)', QuestionLabel: 'Maximum carpet area kitna?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 51, Category: 'Residential', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-115', FieldKey: 'BuiltUpAreaMin', FieldLabel: 'Built-up Area Min (sq.ft)', QuestionLabel: 'Minimum built-up area kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 52, Category: 'Residential', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-116', FieldKey: 'BuiltUpAreaMax', FieldLabel: 'Built-up Area Max (sq.ft)', QuestionLabel: 'Maximum built-up area kitna?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 53, Category: 'Residential', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-117', FieldKey: 'PlotAreaMin', FieldLabel: 'Plot Area Min (sq.ft)', QuestionLabel: 'Minimum plot area kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 54, Category: 'Residential', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-118', FieldKey: 'PlotAreaMax', FieldLabel: 'Plot Area Max (sq.ft)', QuestionLabel: 'Maximum plot area kitna?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 55, Category: 'Residential', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-119', FieldKey: 'Bathrooms', FieldLabel: 'Bathrooms', QuestionLabel: 'Kitne bathrooms chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 56, Category: 'Residential', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-120', FieldKey: 'Balcony', FieldLabel: 'Balcony', QuestionLabel: 'Balcony chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 57, Category: 'Residential', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-121', FieldKey: 'ParkingRequired', FieldLabel: 'Parking Required', QuestionLabel: 'Parking required hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 58, Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-122', FieldKey: 'ParkingCount', FieldLabel: 'Parking Count', QuestionLabel: 'Kitni parking chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 59, Category: 'Residential', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-123', FieldKey: 'PropertyAge', FieldLabel: 'Property Age', QuestionLabel: 'Property age preference kya hai?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, Options: ['New', '0-5 Years', '5-10 Years', '10+ Years', 'Any'], DisplayOrder: 60, Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-124', FieldKey: 'SocietyProject', FieldLabel: 'Society / Project', QuestionLabel: 'Koi specific society ya project hai?', FieldType: 'Text', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 61, Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-125', FieldKey: 'Amenities', FieldLabel: 'Amenities', QuestionLabel: 'Kaunsi amenities important hain?', FieldType: 'Textarea', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 62, Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-126', FieldKey: 'TotalFloors', FieldLabel: 'Total Floors', QuestionLabel: 'Building mein total floors kitne honi chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 63, Category: 'Residential', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-127', FieldKey: 'GardenRequired', FieldLabel: 'Garden', QuestionLabel: 'Garden chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 64, Category: 'Residential', SubCategory: 'Villa' }),
  cfg({ FieldConfigID: 'FC-128', FieldKey: 'FloorsCount', FieldLabel: 'Floors', QuestionLabel: 'Villa mein kitne floors chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 65, Category: 'Residential', SubCategory: 'Villa', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-129', FieldKey: 'ServantRoomRequired', FieldLabel: 'Servant Room', QuestionLabel: 'Servant room chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 66, Category: 'Residential', SubCategory: 'Villa' }),
  cfg({ FieldConfigID: 'FC-130', FieldKey: 'TerraceRequired', FieldLabel: 'Terrace', QuestionLabel: 'Terrace chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 67, Category: 'Residential', SubCategory: 'Villa' }),
  cfg({ FieldConfigID: 'FC-131', FieldKey: 'PoolRequired', FieldLabel: 'Pool', QuestionLabel: 'Pool chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 68, Category: 'Residential', SubCategory: 'Villa' })
];

const COMMERCIAL_FIELDS = [
  cfg({ FieldConfigID: 'FC-060', FieldKey: 'AreaMin', FieldLabel: 'Area Min (sq.ft)', QuestionLabel: 'Minimum area kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 40, Category: 'Commercial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-061', FieldKey: 'AreaMax', FieldLabel: 'Area Max (sq.ft)', QuestionLabel: 'Maximum area?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 41, Category: 'Commercial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-062', FieldKey: 'BusinessType', FieldLabel: 'Business Type', QuestionLabel: 'Business type kya hai?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Retail', 'Office', 'Hospitality', 'Healthcare', 'Education', 'IT/ITES', 'Other'], DisplayOrder: 24, Category: 'Commercial' }),
  cfg({ FieldConfigID: 'FC-063', FieldKey: 'PowerLoad', FieldLabel: 'Power Load (KW)', QuestionLabel: 'Power load kitna chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 43, Category: 'Commercial' }),
  cfg({ FieldConfigID: 'FC-064', FieldKey: 'FireNOC', FieldLabel: 'Fire NOC Required', QuestionLabel: 'Fire NOC required hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 44, Category: 'Commercial' }),
  cfg({ FieldConfigID: 'FC-065', FieldKey: 'FrontageWidth', FieldLabel: 'Frontage Width (ft)', QuestionLabel: 'Frontage width kitna chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 45, Category: 'Commercial' }),
  cfg({ FieldConfigID: 'FC-066', FieldKey: 'ParkingSlots', FieldLabel: 'Parking Slots', QuestionLabel: 'Kitne parking slots chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 46, Category: 'Commercial' }),
  cfg({ FieldConfigID: 'FC-067', FieldKey: 'LiftRequired', FieldLabel: 'Lift Required', QuestionLabel: 'Lift chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 47, Category: 'Commercial' }),
  cfg({ FieldConfigID: 'FC-133', FieldKey: 'RequiredAreaMin', FieldLabel: 'Required Area Min (sq.ft)', QuestionLabel: 'Minimum required area kitna hai?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.CREATE_CORE, DisplayOrder: 48, Category: 'Commercial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-134', FieldKey: 'RequiredAreaMax', FieldLabel: 'Required Area Max (sq.ft)', QuestionLabel: 'Maximum required area kitna hai?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.CREATE_CORE, DisplayOrder: 49, Category: 'Commercial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-135', FieldKey: 'CarpetAreaMin', FieldLabel: 'Carpet Area Min (sq.ft)', QuestionLabel: 'Minimum carpet area kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 50, Category: 'Commercial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-136', FieldKey: 'CarpetAreaMax', FieldLabel: 'Carpet Area Max (sq.ft)', QuestionLabel: 'Maximum carpet area kitna?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 51, Category: 'Commercial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-137', FieldKey: 'BuiltUpAreaMin', FieldLabel: 'Built-up Area Min (sq.ft)', QuestionLabel: 'Minimum built-up area kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 52, Category: 'Commercial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-138', FieldKey: 'BuiltUpAreaMax', FieldLabel: 'Built-up Area Max (sq.ft)', QuestionLabel: 'Maximum built-up area kitna?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 53, Category: 'Commercial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-139', FieldKey: 'Furnishing', FieldLabel: 'Furnishing', QuestionLabel: 'Furnished / semi furnished / unfurnished kya chahiye?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Unfurnished', 'Semi Furnished', 'Semi-Furnished', 'Furnished', 'Fully Furnished'], DisplayOrder: 54, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-140', FieldKey: 'SeatingRequired', FieldLabel: 'Seating Required', QuestionLabel: 'Seating required hai?', FieldType: 'Boolean', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 55, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-141', FieldKey: 'SeatingCapacity', FieldLabel: 'Seating Capacity', QuestionLabel: 'Kitni seating capacity chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 56, Category: 'Commercial', SubCategory: 'Office', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-142', FieldKey: 'CabinsRequired', FieldLabel: 'Cabins Required', QuestionLabel: 'Cabins required hain?', FieldType: 'Boolean', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 57, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-143', FieldKey: 'CabinCount', FieldLabel: 'Number of Cabins', QuestionLabel: 'Kitne cabins chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 58, Category: 'Commercial', SubCategory: 'Office', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-144', FieldKey: 'ConferenceRoomRequired', FieldLabel: 'Conference Room', QuestionLabel: 'Conference room chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 59, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-145', FieldKey: 'ConferenceRoomCount', FieldLabel: 'Conference Room Count', QuestionLabel: 'Kitne conference rooms chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 60, Category: 'Commercial', SubCategory: 'Office', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-146', FieldKey: 'ReceptionRequired', FieldLabel: 'Reception', QuestionLabel: 'Reception chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 61, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-147', FieldKey: 'WaitingAreaRequired', FieldLabel: 'Waiting Area', QuestionLabel: 'Waiting area chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 62, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-148', FieldKey: 'PantryRequired', FieldLabel: 'Pantry', QuestionLabel: 'Pantry chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 63, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-149', FieldKey: 'ServerRoomRequired', FieldLabel: 'Server Room', QuestionLabel: 'Server room chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 64, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-150', FieldKey: 'MeetingRoomRequired', FieldLabel: 'Meeting Room', QuestionLabel: 'Meeting room chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 65, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-151', FieldKey: 'MeetingRoomCount', FieldLabel: 'Meeting Room Count', QuestionLabel: 'Kitne meeting rooms chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 66, Category: 'Commercial', SubCategory: 'Office', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-152', FieldKey: 'ACRequired', FieldLabel: 'AC', QuestionLabel: 'AC chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 67, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-153', FieldKey: 'PowerBackupRequired', FieldLabel: 'Power Backup', QuestionLabel: 'Power backup chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 68, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-154', FieldKey: 'InternetFiberRequired', FieldLabel: 'Internet / Fiber', QuestionLabel: 'Internet ya fiber connectivity chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 69, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-155', FieldKey: 'FurnitureIncluded', FieldLabel: 'Furniture Included', QuestionLabel: 'Furniture included chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 70, Category: 'Commercial', SubCategory: 'Office' }),
  cfg({ FieldConfigID: 'FC-156', FieldKey: 'ParkingRequired', FieldLabel: 'Parking Required', QuestionLabel: 'Parking required hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 71, Category: 'Commercial' }),
  cfg({ FieldConfigID: 'FC-157', FieldKey: 'ParkingCarCount', FieldLabel: 'Parking Cars', QuestionLabel: 'Kitni car parking chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 72, Category: 'Commercial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-158', FieldKey: 'ParkingBikeCount', FieldLabel: 'Parking Bikes', QuestionLabel: 'Kitni bike parking chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 73, Category: 'Commercial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-159', FieldKey: 'SignageRequired', FieldLabel: 'Signage', QuestionLabel: 'Signage required hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 74, Category: 'Commercial' }),
  cfg({ FieldConfigID: 'FC-160', FieldKey: 'MainRoadRequired', FieldLabel: 'Main Road', QuestionLabel: 'Main road frontage chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 75, Category: 'Commercial' }),
  cfg({ FieldConfigID: 'FC-162', FieldKey: 'WashroomRequired', FieldLabel: 'Washroom', QuestionLabel: 'Washroom chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 76, Category: 'Commercial' }),
  cfg({ FieldConfigID: 'FC-163', FieldKey: 'WashroomCount', FieldLabel: 'Washroom Count', QuestionLabel: 'Kitne washrooms chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.CONDITIONAL, DisplayOrder: 77, Category: 'Commercial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-164', FieldKey: 'GroundFloorRequired', FieldLabel: 'Ground Floor Required', QuestionLabel: 'Ground floor required hai?', FieldType: 'Boolean', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 78, Category: 'Commercial', SubCategory: 'Shop' }),
  cfg({ FieldConfigID: 'FC-165', FieldKey: 'CornerUnitRequired', FieldLabel: 'Corner Unit', QuestionLabel: 'Corner unit chahiye?', FieldType: 'Boolean', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 79, Category: 'Commercial', SubCategory: 'Shop' }),
  cfg({ FieldConfigID: 'FC-166', FieldKey: 'DisplayWindowRequired', FieldLabel: 'Display Window', QuestionLabel: 'Display window chahiye?', FieldType: 'Boolean', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 80, Category: 'Commercial', SubCategory: 'Shop' }),
  cfg({ FieldConfigID: 'FC-167', FieldKey: 'FootfallPreference', FieldLabel: 'Footfall Preference', QuestionLabel: 'Footfall preference kya hai?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, Options: ['High', 'Medium', 'Low', 'Any'], DisplayOrder: 81, Category: 'Commercial', SubCategory: 'Shop' }),
  cfg({ FieldConfigID: 'FC-168', FieldKey: 'LoadingUnloadingRequired', FieldLabel: 'Loading / Unloading', QuestionLabel: 'Loading unloading access chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 82, Category: 'Commercial' }),
  cfg({ FieldConfigID: 'FC-169', FieldKey: 'CeilingHeightFeet', FieldLabel: 'Ceiling Height (ft)', QuestionLabel: 'Ceiling height kitni chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 83, Category: 'Commercial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-170', FieldKey: 'FrontageFeet', FieldLabel: 'Frontage (ft)', QuestionLabel: 'Frontage kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 84, Category: 'Commercial', SubCategory: 'Shop', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-171', FieldKey: 'DepthFeet', FieldLabel: 'Depth (ft)', QuestionLabel: 'Depth kitni chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 85, Category: 'Commercial', SubCategory: 'Shop', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-173', FieldKey: 'OpenAreaMin', FieldLabel: 'Open Area Min (sq.ft)', QuestionLabel: 'Minimum open area kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 86, Category: 'Commercial', SubCategory: 'Warehouse', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-174', FieldKey: 'OpenAreaMax', FieldLabel: 'Open Area Max (sq.ft)', QuestionLabel: 'Maximum open area kitna?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 87, Category: 'Commercial', SubCategory: 'Warehouse', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-175', FieldKey: 'ClearHeightFeet', FieldLabel: 'Clear Height (ft)', QuestionLabel: 'Clear height kitni chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 88, Category: 'Commercial', SubCategory: 'Warehouse', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-176', FieldKey: 'LoadingDockRequired', FieldLabel: 'Loading Dock', QuestionLabel: 'Loading dock chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 89, Category: 'Commercial', SubCategory: 'Warehouse' }),
  cfg({ FieldConfigID: 'FC-177', FieldKey: 'ContainerMovementRequired', FieldLabel: 'Container Movement', QuestionLabel: 'Container movement required hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 90, Category: 'Commercial', SubCategory: 'Warehouse' }),
  cfg({ FieldConfigID: 'FC-178', FieldKey: 'TruckAccessRequired', FieldLabel: 'Truck Access', QuestionLabel: 'Truck access chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 91, Category: 'Commercial', SubCategory: 'Warehouse' }),
  cfg({ FieldConfigID: 'FC-179', FieldKey: 'RoadWidthFeet', FieldLabel: 'Road Width (ft)', QuestionLabel: 'Road width kitni chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 92, Category: 'Commercial', SubCategory: 'Warehouse', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-180', FieldKey: 'CraneRequired', FieldLabel: 'Crane', QuestionLabel: 'Crane required hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 93, Category: 'Commercial', SubCategory: 'Warehouse' }),
  cfg({ FieldConfigID: 'FC-181', FieldKey: 'PowerLoadKVA', FieldLabel: 'Power Load (KVA)', QuestionLabel: 'Power load kitna chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 94, Category: 'Commercial', SubCategory: 'Warehouse', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-182', FieldKey: 'ParkingYardRequired', FieldLabel: 'Parking / Yard', QuestionLabel: 'Parking ya yard area chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 95, Category: 'Commercial', SubCategory: 'Warehouse' })
];

const LAND_FIELDS = [
  cfg({ FieldConfigID: 'FC-070', FieldKey: 'PlotAreaMin', FieldLabel: 'Plot Area Min (sq.ft)', QuestionLabel: 'Plot ka minimum area?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 40, Category: 'Land', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-071', FieldKey: 'PlotAreaMax', FieldLabel: 'Plot Area Max (sq.ft)', QuestionLabel: 'Plot ka maximum area?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 41, Category: 'Land', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-072', FieldKey: 'Zoning', FieldLabel: 'Zoning', QuestionLabel: 'Zoning kya chahiye?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Residential', 'Commercial', 'Mixed Use', 'Agricultural', 'Industrial'], DisplayOrder: 42, Category: 'Land' }),
  cfg({ FieldConfigID: 'FC-073', FieldKey: 'ApproachRoad', FieldLabel: 'Approach Road Width (ft)', QuestionLabel: 'Approach road ki width?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 43, Category: 'Land' }),
  cfg({ FieldConfigID: 'FC-074', FieldKey: 'WaterLine', FieldLabel: 'Water Line Available', QuestionLabel: 'Water line available hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 44, Category: 'Land' }),
  cfg({ FieldConfigID: 'FC-075', FieldKey: 'GasPipeline', FieldLabel: 'Gas Pipeline Available', QuestionLabel: 'Gas pipeline available hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 45, Category: 'Land' }),
  cfg({ FieldConfigID: 'FC-076', FieldKey: 'CornerPlot', FieldLabel: 'Corner Plot Preferred', QuestionLabel: 'Corner plot chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 46, Category: 'Land' }),
  cfg({ FieldConfigID: 'FC-183', FieldKey: 'LandType', FieldLabel: 'Land Type', QuestionLabel: 'Land type kya chahiye?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.CREATE_CORE, Options: ['Residential Plot', 'Commercial Plot', 'Agricultural Land', 'Industrial Land', 'Mixed Use'], DisplayOrder: 47, Category: 'Land' }),
  cfg({ FieldConfigID: 'FC-184', FieldKey: 'AreaUnit', FieldLabel: 'Area Unit', QuestionLabel: 'Area unit kya rakhna hai?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Sq.ft.', 'Sq.yd.', 'Acre', 'Vigha', 'Hectare'], DisplayOrder: 48, Category: 'Land' }),
  cfg({ FieldConfigID: 'FC-185', FieldKey: 'FrontageFeet', FieldLabel: 'Frontage (ft)', QuestionLabel: 'Frontage kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 49, Category: 'Land', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-186', FieldKey: 'DepthFeet', FieldLabel: 'Depth (ft)', QuestionLabel: 'Depth kitni chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 50, Category: 'Land', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-187', FieldKey: 'RoadWidthFeet', FieldLabel: 'Road Width (ft)', QuestionLabel: 'Road width kitni chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 51, Category: 'Land', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-188', FieldKey: 'TPScheme', FieldLabel: 'TP Scheme', QuestionLabel: 'Koi TP scheme preference hai?', FieldType: 'Text', Section: SECTION.LEGAL, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 52, Category: 'Land' }),
  cfg({ FieldConfigID: 'FC-189', FieldKey: 'Zone', FieldLabel: 'Zone', QuestionLabel: 'Zone kya chahiye?', FieldType: 'Select', Section: SECTION.LEGAL, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Residential', 'Commercial', 'Industrial', 'Agricultural', 'Mixed Use'], DisplayOrder: 53, Category: 'Land' }),
  cfg({ FieldConfigID: 'FC-190', FieldKey: 'FSI', FieldLabel: 'FSI', QuestionLabel: 'FSI requirement kya hai?', FieldType: 'Number', Section: SECTION.LEGAL, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 54, Category: 'Land', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-191', FieldKey: 'HighwayTouch', FieldLabel: 'Highway Touch', QuestionLabel: 'Highway touch chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 55, Category: 'Land' }),
  cfg({ FieldConfigID: 'FC-192', FieldKey: 'TitleClear', FieldLabel: 'Title Clear', QuestionLabel: 'Title clear hona zaroori hai?', FieldType: 'Boolean', Section: SECTION.LEGAL, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 56, Category: 'Land' })
];

const INDUSTRIAL_FIELDS = [
  cfg({ FieldConfigID: 'FC-080', FieldKey: 'AreaMin', FieldLabel: 'Area Min (sq.ft)', QuestionLabel: 'Minimum area kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 40, Category: 'Industrial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-081', FieldKey: 'AreaMax', FieldLabel: 'Area Max (sq.ft)', QuestionLabel: 'Maximum area?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 41, Category: 'Industrial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-082', FieldKey: 'ZoneType', FieldLabel: 'Zone Type', QuestionLabel: 'Industrial zone type kya chahiye?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Warehouse', 'Manufacturing', 'Logistics', 'Cold Storage', 'Data Center'], DisplayOrder: 42, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-083', FieldKey: 'PowerLoad', FieldLabel: 'Power Load (KW)', QuestionLabel: 'Power load kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 43, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-084', FieldKey: 'LoadingBay', FieldLabel: 'Loading Bay Required', QuestionLabel: 'Loading bay chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 44, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-085', FieldKey: 'CeilingHeight', FieldLabel: 'Ceiling Height (ft)', QuestionLabel: 'Ceiling height kitna chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 45, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-086', FieldKey: 'FlooringType', FieldLabel: 'Flooring Type', QuestionLabel: 'Flooring type kya chahiye?', FieldType: 'Select', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, Options: ['VDF', 'Epoxy', 'Tiles', 'Plain Cement', 'Any'], DisplayOrder: 46, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-193', FieldKey: 'BuiltUpAreaMin', FieldLabel: 'Built-up Area Min (sq.ft)', QuestionLabel: 'Minimum built-up area kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 47, Category: 'Industrial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-194', FieldKey: 'BuiltUpAreaMax', FieldLabel: 'Built-up Area Max (sq.ft)', QuestionLabel: 'Maximum built-up area kitna?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 48, Category: 'Industrial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-195', FieldKey: 'OpenAreaMin', FieldLabel: 'Open Area Min (sq.ft)', QuestionLabel: 'Minimum open area kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 49, Category: 'Industrial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-196', FieldKey: 'OpenAreaMax', FieldLabel: 'Open Area Max (sq.ft)', QuestionLabel: 'Maximum open area kitna?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 50, Category: 'Industrial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-197', FieldKey: 'PlotAreaMin', FieldLabel: 'Plot Area Min (sq.ft)', QuestionLabel: 'Minimum plot area kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 51, Category: 'Industrial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-198', FieldKey: 'PlotAreaMax', FieldLabel: 'Plot Area Max (sq.ft)', QuestionLabel: 'Maximum plot area kitna?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 52, Category: 'Industrial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-199', FieldKey: 'PowerLoadKVA', FieldLabel: 'Power Load (KVA)', QuestionLabel: 'Power load KVA mein kitna chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 53, Category: 'Industrial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-200', FieldKey: 'TransformerRequired', FieldLabel: 'Transformer', QuestionLabel: 'Transformer required hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 54, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-201', FieldKey: 'CraneRequired', FieldLabel: 'Crane', QuestionLabel: 'Crane required hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 55, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-202', FieldKey: 'LoadingDockRequired', FieldLabel: 'Loading Dock', QuestionLabel: 'Loading dock chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 56, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-203', FieldKey: 'ContainerMovementRequired', FieldLabel: 'Container Movement', QuestionLabel: 'Container movement required hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 57, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-204', FieldKey: 'RoadWidthFeet', FieldLabel: 'Road Width (ft)', QuestionLabel: 'Road width kitni chahiye?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 58, Category: 'Industrial', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-205', FieldKey: 'FireNOC', FieldLabel: 'Fire NOC', QuestionLabel: 'Fire NOC zaroori hai?', FieldType: 'Boolean', Section: SECTION.LEGAL, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 59, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-206', FieldKey: 'PollutionCategory', FieldLabel: 'Pollution Category', QuestionLabel: 'Pollution category kya chahiye?', FieldType: 'Select', Section: SECTION.LEGAL, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, Options: ['Green', 'Orange', 'Red', 'Any'], DisplayOrder: 60, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-207', FieldKey: 'OfficeRequired', FieldLabel: 'Office Required', QuestionLabel: 'Office space bhi chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 61, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-208', FieldKey: 'LabourAccommodationRequired', FieldLabel: 'Labour Accommodation', QuestionLabel: 'Labour accommodation chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 62, Category: 'Industrial' }),
  cfg({ FieldConfigID: 'FC-209', FieldKey: 'ClearHeightFeet', FieldLabel: 'Clear Height (ft)', QuestionLabel: 'Clear height kitni chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 63, Category: 'Industrial', Validation: 'positive-number' })
];

const RENT_AND_LEASE_FIELDS = [
  cfg({ FieldConfigID: 'FC-090', FieldKey: 'TenantType', FieldLabel: 'Tenant Type', QuestionLabel: 'Konsa tenant type chahiye?', FieldType: 'Select', Section: SECTION.EXTRAS, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Family', 'Bachelor', 'Company', 'Any'], DisplayOrder: 24, TransactionType: 'Rent' }),
  cfg({ FieldConfigID: 'FC-091', FieldKey: 'Deposit', FieldLabel: 'Security Deposit', QuestionLabel: 'Security deposit kitna hai?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 31, TransactionType: 'Rent', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-092', FieldKey: 'MaintenanceCharges', FieldLabel: 'Maintenance Charges', QuestionLabel: 'Maintenance charges kitne honge?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 32, TransactionType: 'Rent' }),
  cfg({ FieldConfigID: 'FC-093', FieldKey: 'PetAllowed', FieldLabel: 'Pets Allowed', QuestionLabel: 'Pets allowed hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 33, TransactionType: 'Rent' }),
  cfg({ FieldConfigID: 'FC-094', FieldKey: 'TenantType', FieldLabel: 'Tenant Type', QuestionLabel: 'Konsa tenant type accept karoge?', FieldType: 'Select', Section: SECTION.EXTRAS, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Family', 'Bachelor', 'Company', 'Any'], DisplayOrder: 24, TransactionType: 'Rent Out' }),
  cfg({ FieldConfigID: 'FC-095', FieldKey: 'Deposit', FieldLabel: 'Security Deposit', QuestionLabel: 'Security deposit kitna rakhna hai?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 31, TransactionType: 'Rent Out', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-096', FieldKey: 'MaintenanceCharges', FieldLabel: 'Maintenance Charges', QuestionLabel: 'Maintenance charges kya honge?', FieldType: 'Number', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 32, TransactionType: 'Rent Out' }),
  cfg({ FieldConfigID: 'FC-097', FieldKey: 'PetAllowed', FieldLabel: 'Pets Allowed', QuestionLabel: 'Pets allow karoge?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 33, TransactionType: 'Rent Out' }),
  cfg({ FieldConfigID: 'FC-210', FieldKey: 'LeaseDuration', FieldLabel: 'Lease Duration', QuestionLabel: 'Lease duration kitni chahiye?', FieldType: 'Select', Section: SECTION.TIMING, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['11 Months', '12 Months', '24 Months', '36 Months', '60+ Months'], DisplayOrder: 34, TransactionType: 'Lease' }),
  cfg({ FieldConfigID: 'FC-211', FieldKey: 'SecurityDeposit', FieldLabel: 'Security Deposit', QuestionLabel: 'Security deposit kitna hai?', FieldType: 'Number', Section: SECTION.BUDGET, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 35, TransactionType: 'Lease', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-212', FieldKey: 'LockInPeriod', FieldLabel: 'Lock-in Period (months)', QuestionLabel: 'Lock-in period kitna hai?', FieldType: 'Number', Section: SECTION.TIMING, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 36, TransactionType: 'Lease', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-213', FieldKey: 'LeasePeriodMonths', FieldLabel: 'Lease Period (months)', QuestionLabel: 'Lease period kitne months ka hai?', FieldType: 'Number', Section: SECTION.TIMING, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 37, TransactionType: 'Lease', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-214', FieldKey: 'EscalationPercent', FieldLabel: 'Escalation (%)', QuestionLabel: 'Escalation percentage kitni hai?', FieldType: 'Number', Section: SECTION.BUDGET, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 38, TransactionType: 'Lease', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-215', FieldKey: 'GSTRequired', FieldLabel: 'GST', QuestionLabel: 'GST applicable hai?', FieldType: 'Boolean', Section: SECTION.LEGAL, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 39, TransactionType: 'Lease' }),
  cfg({ FieldConfigID: 'FC-216', FieldKey: 'FoodPreference', FieldLabel: 'Food Preference', QuestionLabel: 'Food preference kya hai?', FieldType: 'Select', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, Options: ['Veg', 'Non-Veg', 'Any'], DisplayOrder: 40, TransactionType: 'Rent', Category: 'Residential' }),
  cfg({ FieldConfigID: 'FC-217', FieldKey: 'PetsAllowed', FieldLabel: 'Pets', QuestionLabel: 'Pets allowed hone chahiye?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 41, TransactionType: 'Rent', Category: 'Residential' })
];

const AGRICULTURE_FIELDS = [
  cfg({ FieldConfigID: 'FC-100', FieldKey: 'TotalArea', FieldLabel: 'Total Area (acres)', QuestionLabel: 'Total kitna area chahiye?', FieldType: 'Number', Section: SECTION.PROPERTY, Tier: FIELD_TIER.CORE, RequiredMode: REQUIRED_MODE.CREATE_CORE, DisplayOrder: 20, Category: 'Agriculture', Validation: 'positive-number' }),
  cfg({ FieldConfigID: 'FC-101', FieldKey: 'WaterSource', FieldLabel: 'Water Source', QuestionLabel: 'Paani ka source kya hai?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, Options: ['Well', 'Borewell', 'Canal', 'River', 'None'], DisplayOrder: 21, Category: 'Agriculture' }),
  cfg({ FieldConfigID: 'FC-102', FieldKey: 'SoilType', FieldLabel: 'Soil Type', QuestionLabel: 'Mitti ka type kya hai?', FieldType: 'Select', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, Options: ['Black', 'Red', 'Alluvial', 'Sandy', 'Loamy', 'Mixed'], DisplayOrder: 22, Category: 'Agriculture' }),
  cfg({ FieldConfigID: 'FC-103', FieldKey: 'ElectricityAvailable', FieldLabel: 'Electricity Available', QuestionLabel: 'Bijli available hai?', FieldType: 'Boolean', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 23, Category: 'Agriculture' }),
  cfg({ FieldConfigID: 'FC-104', FieldKey: 'RoadAccess', FieldLabel: 'Road Access', QuestionLabel: 'Seedha road access hai?', FieldType: 'Boolean', Section: SECTION.PROPERTY, Tier: FIELD_TIER.IMPORTANT, RequiredMode: REQUIRED_MODE.IMPORTANT, DisplayOrder: 24, Category: 'Agriculture' }),
  cfg({ FieldConfigID: 'FC-105', FieldKey: 'IrrigationAvailable', FieldLabel: 'Irrigation Available', QuestionLabel: 'Sinchai ki suvidha hai?', FieldType: 'Boolean', Section: SECTION.PROPERTY, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 25, Category: 'Agriculture' }),
  cfg({ FieldConfigID: 'FC-106', FieldKey: 'Fencing', FieldLabel: 'Fencing Available', QuestionLabel: 'Fencing hai?', FieldType: 'Boolean', Section: SECTION.EXTRAS, Tier: FIELD_TIER.OPTIONAL, RequiredMode: REQUIRED_MODE.OPTIONAL, DisplayOrder: 26, Category: 'Agriculture' })
];

const STATIC_FIELD_CONFIG = [
  ...COMMON_FIELDS,
  ...RESIDENTIAL_FIELDS,
  ...COMMERCIAL_FIELDS,
  ...LAND_FIELDS,
  ...INDUSTRIAL_FIELDS,
  ...RENT_AND_LEASE_FIELDS,
  ...AGRICULTURE_FIELDS
];

function sortFieldConfigRows(rows) {
  return rows.slice().sort((a, b) =>
    (a.DisplayOrder || 99) - (b.DisplayOrder || 99)
    || String(a.FieldConfigID || '').localeCompare(String(b.FieldConfigID || ''))
  );
}

function buildStaticQuestionConfig(fieldConfig) {
  const tierOrder = { [FIELD_TIER.CORE]: 1, [FIELD_TIER.IMPORTANT]: 2, [FIELD_TIER.OPTIONAL]: 3 };
  return fieldConfig
    .filter((f) => f.Active !== false)
    .slice()
    .sort((a, b) => ((tierOrder[a.Tier] || 3) * 1000 + (a.DisplayOrder || 99)) - ((tierOrder[b.Tier] || 3) * 1000 + (b.DisplayOrder || 99)))
    .map((f, idx) => ({
      QuestionConfigID: `Q-${String(idx + 1).padStart(3, '0')}`,
      FieldConfigID: f.FieldConfigID,
      FieldKey: f.FieldKey,
      QuestionLabel: f.QuestionLabel,
      FieldLabel: f.FieldLabel,
      TransactionType: f.TransactionType,
      Category: f.Category,
      SubCategory: f.SubCategory,
      FieldType: f.FieldType,
      Section: f.Section,
      Priority: f.Tier,
      Options: f.Options || [],
      DisplayOrder: (tierOrder[f.Tier] || 3) * 1000 + (f.DisplayOrder || 99),
      Active: true,
      _v2: true
    }))
}

class V2ConfigService {
  constructor(repository) {
    if (!repository) throw new Error('V2ConfigService requires a repository');
    this.repository = repository;
  }

  seedConfigIfEmpty() {
    const db = this.repository.read();
    let changed = false;

    if (!Array.isArray(db.V2FieldConfig)) {
      db.V2FieldConfig = [];
      changed = true;
    }
    if (!Array.isArray(db.V2QuestionConfig)) {
      db.V2QuestionConfig = [];
      changed = true;
    }

    const mergedFields = this._mergeStaticFieldConfig(db.V2FieldConfig || []);
    if (JSON.stringify(mergedFields) !== JSON.stringify(db.V2FieldConfig)) {
      db.V2FieldConfig = mergedFields;
      changed = true;
    }

    const rebuiltQuestions = buildStaticQuestionConfig(db.V2FieldConfig);
    if (JSON.stringify(rebuiltQuestions) !== JSON.stringify(db.V2QuestionConfig)) {
      db.V2QuestionConfig = rebuiltQuestions;
      changed = true;
    }

    if (changed) this.repository.write(db);

    return {
      seeded: changed,
      fieldConfigCount: db.V2FieldConfig.length,
      questionConfigCount: db.V2QuestionConfig.length
    };
  }

  _mergeStaticFieldConfig(existingRows) {
    if (!Array.isArray(existingRows) || existingRows.length === 0) return sortFieldConfigRows(STATIC_FIELD_CONFIG);
    const byId = new Map(existingRows.map((row) => [row.FieldConfigID, row]));
    const merged = STATIC_FIELD_CONFIG.map((row) => ({ ...byId.get(row.FieldConfigID), ...row }));
    const knownIds = new Set(STATIC_FIELD_CONFIG.map((row) => row.FieldConfigID));
    const extras = existingRows.filter((row) => row && row.FieldConfigID && !knownIds.has(row.FieldConfigID));
    return sortFieldConfigRows([...merged, ...extras]);
  }

  getFieldConfig(filters = {}) {
    const db = this.repository.read();
    let rows = (Array.isArray(db.V2FieldConfig) && db.V2FieldConfig.length > 0)
      ? db.V2FieldConfig
      : STATIC_FIELD_CONFIG;

    if (filters.transactionType !== undefined && filters.transactionType !== null) {
      rows = rows.filter((r) => r.TransactionType === null || r.TransactionType === filters.transactionType);
    }
    if (filters.category !== undefined && filters.category !== null) {
      rows = rows.filter((r) => r.Category === null || r.Category === filters.category);
    }
    if (filters.subCategory !== undefined && filters.subCategory !== null) {
      rows = rows.filter((r) => r.SubCategory === null || r.SubCategory === filters.subCategory);
    }
    if (filters.tier !== undefined && filters.tier !== null) {
      rows = rows.filter((r) => r.Tier === filters.tier);
    }
    if (filters.active !== undefined) {
      rows = rows.filter((r) => r.Active === filters.active);
    }

    return sortFieldConfigRows(rows);
  }

  getQuestionConfig(filters = {}) {
    const db = this.repository.read();
    let rows = (Array.isArray(db.V2QuestionConfig) && db.V2QuestionConfig.length > 0)
      ? db.V2QuestionConfig
      : buildStaticQuestionConfig((Array.isArray(db.V2FieldConfig) && db.V2FieldConfig.length > 0) ? db.V2FieldConfig : STATIC_FIELD_CONFIG);

    if (filters.transactionType !== undefined && filters.transactionType !== null) {
      rows = rows.filter((r) => r.TransactionType === null || r.TransactionType === filters.transactionType);
    }
    if (filters.category !== undefined && filters.category !== null) {
      rows = rows.filter((r) => r.Category === null || r.Category === filters.category);
    }
    if (filters.subCategory !== undefined && filters.subCategory !== null) {
      rows = rows.filter((r) => r.SubCategory === null || r.SubCategory === filters.subCategory);
    }
    if (filters.priority !== undefined && filters.priority !== null) {
      rows = rows.filter((r) => r.Priority === filters.priority);
    }
    if (filters.active !== undefined) {
      rows = rows.filter((r) => r.Active === filters.active);
    }

    return rows.slice().sort((a, b) => (a.DisplayOrder || 99) - (b.DisplayOrder || 99));
  }

  resolveFieldsForContext(transactionType, category, subCategory) {
    return this.getFieldConfig({
      transactionType: transactionType || null,
      category: category || null,
      subCategory: subCategory || null,
      active: true
    });
  }

  getFieldConfigById(id) {
    const db = this.repository.read();
    const rows = (Array.isArray(db.V2FieldConfig) && db.V2FieldConfig.length > 0) ? db.V2FieldConfig : STATIC_FIELD_CONFIG;
    return rows.find((r) => r.FieldConfigID === id) || null;
  }

  getFieldConfigByKey(fieldKey) {
    const db = this.repository.read();
    const rows = (Array.isArray(db.V2FieldConfig) && db.V2FieldConfig.length > 0) ? db.V2FieldConfig : STATIC_FIELD_CONFIG;
    return rows.filter((r) => r.FieldKey === fieldKey);
  }

  static get REQUIRED_MODE() { return REQUIRED_MODE; }
  static get FIELD_TIER() { return FIELD_TIER; }
  static get SECTION() { return SECTION; }
  static get STATIC_FIELD_CONFIG() { return STATIC_FIELD_CONFIG; }
}

module.exports = {
  V2ConfigService,
  REQUIRED_MODE,
  FIELD_TIER,
  SECTION,
  STATIC_FIELD_CONFIG,
  buildStaticQuestionConfig
};
