#!/usr/bin/env node
/**
 * Seed comprehensive V2FieldConfig entries for ALL 4 categories:
 *   Residential, Commercial, Industrial, Land
 *
 * Design principle: all fields tuned for Surat / Gujarat market
 *   (vigha, GIDC, Gujarat RERA, Surat area presets)
 *
 * The form registry already returns fields based on TransactionType/Category/SubCategory.
 * We add category-scoped (or global) fields — the frontend automatically renders them
 * because we made the form fully dynamic in Session 1.
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'sig-realty-db.json');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

db.V2FieldConfig = db.V2FieldConfig || [];

// ── Helper: create a field config row ────────────────────────────────
let counter = 200;  // avoid conflicts with existing FC-xxx IDs
function field(key, label, type, opts = {}) {
  counter++;
  return {
    FieldConfigID: `FC-${counter}`,
    FieldKey: key,
    FieldLabel: label,
    QuestionLabel: opts.question || label + '?',
    FieldType: type,
    Section: opts.section || 'Property',
    Tier: opts.tier || 'OPTIONAL',
    RequiredMode: opts.required || 'OPTIONAL',
    Options: opts.options || [],
    DisplayOrder: opts.order || 50,
    TransactionType: opts.txn || null,
    Category: opts.cat || null,
    SubCategory: opts.sub || null,
    Active: true,
    DefaultValue: null,
    Validation: opts.validation || null,
    HelpText: opts.help || null,
    Placeholder: opts.placeholder || null,
    _v2: true
  };
}

// ── RESIDENTIAL fields (all sub-categories) ───────────────────────────
const RESIDENTIAL = [
  // Villa / Bungalow / Row House specific
  field('PlotArea', 'Plot Area (sqft)', 'Number', { cat: 'Residential', question: 'Plot area kitna chahiye?', order: 34, section: 'Property', placeholder: 'e.g. 2400' }),
  field('BuiltUpArea', 'Built-up Area (sqft)', 'Number', { cat: 'Residential', order: 35 }),
  field('Garden', 'Garden', 'Boolean', { cat: 'Residential', question: 'Garden chahiye?', order: 60 }),
  field('SwimmingPool', 'Swimming Pool', 'Boolean', { cat: 'Residential', order: 61 }),
  field('ServantQuarter', 'Servant Quarter', 'Boolean', { cat: 'Residential', order: 62 }),
  field('BoundaryWall', 'Boundary Wall', 'Boolean', { cat: 'Residential', order: 63 }),
  field('CornerPlot', 'Corner Plot', 'Boolean', { cat: 'Residential', order: 64 }),
  field('MainRoadFacing', 'Main Road Facing', 'Boolean', { cat: 'Residential', order: 65 }),
  field('Balconies', 'Number of Balconies', 'Number', { cat: 'Residential', order: 45, placeholder: 'e.g. 2' }),
  field('Bathrooms', 'Number of Bathrooms', 'Number', { cat: 'Residential', order: 46 }),
  field('AgeOfProperty', 'Age of Property (years)', 'Select', {
    cat: 'Residential', order: 66,
    options: ['Under Construction', '0-1 years', '1-5 years', '5-10 years', '10+ years']
  }),
  field('OwnershipType', 'Ownership Type', 'Select', {
    cat: 'Residential', order: 67,
    options: ['Freehold', 'Leasehold', 'Cooperative Society', 'Power of Attorney']
  }),
  field('LoanApproved', 'Bank Loan Approved', 'Select', {
    cat: 'Residential', order: 68,
    options: ['SBI', 'HDFC', 'ICICI', 'Axis', 'LIC HFL', 'Kotak', 'Not Applicable']
  }),
  // Studio / PG specific
  field('KitchenType', 'Kitchen Type', 'Select', {
    cat: 'Residential', sub: 'Studio', order: 47,
    options: ['Kitchenette', 'Full Kitchen', 'None']
  }),
  field('PGSharingType', 'PG Sharing Type', 'Select', {
    cat: 'Residential', order: 48,
    options: ['Single Occupancy', 'Double Sharing', 'Triple Sharing']
  }),
  field('PGMealsIncluded', 'Meals Included', 'Boolean', { cat: 'Residential', order: 49 }),
];

// ── COMMERCIAL fields (Office, Shop, Warehouse, Showroom, Restaurant) ─
const COMMERCIAL = [
  // Common commercial
  field('BuiltUpAreaComm', 'Built-up Area (sqft)', 'Number', { cat: 'Commercial', order: 34, placeholder: 'e.g. 1500' }),
  field('CarpetAreaComm', 'Carpet Area (sqft)', 'Number', { cat: 'Commercial', order: 33 }),
  field('FurnishingType', 'Furnishing Type', 'Select', {
    cat: 'Commercial', order: 40, tier: 'IMPORTANT',
    question: 'Kaisa furnishing chahiye?',
    options: ['Bare Shell / Naked', 'Warm Shell / Semi Furnished', 'Fully Furnished', 'Plug & Play']
  }),
  field('FloorNumber', 'Floor Number', 'Select', {
    cat: 'Commercial', order: 41,
    options: ['Basement', 'Ground', 'Mezzanine', '1st', '2nd', '3rd', '4th', '5th+', 'Top Floor']
  }),
  field('LiftAvailable', 'Lift Available', 'Boolean', { cat: 'Commercial', order: 42 }),
  field('ParkingCarSlots', 'Car Parking Slots', 'Number', { cat: 'Commercial', order: 43 }),
  field('ParkingTwoWheeler', '2-Wheeler Parking Slots', 'Number', { cat: 'Commercial', order: 44 }),
  field('WashroomType', 'Washroom', 'Select', {
    cat: 'Commercial', order: 45,
    options: ['Common', 'Attached', 'Separate M/F', 'Not Available']
  }),
  field('PowerLoadKVA', 'Power Load (kVA)', 'Number', { cat: 'Commercial', order: 46, placeholder: 'e.g. 25' }),
  field('PowerBackup', 'Power Backup / Generator', 'Boolean', { cat: 'Commercial', order: 47 }),
  field('ACType', 'AC Type', 'Select', {
    cat: 'Commercial', order: 48,
    options: ['Central AC', 'Split AC', 'VRV / VRF', 'Cassette AC', 'Not Required', 'To Be Installed']
  }),
  field('CeilingHeightComm', 'Ceiling Height (feet)', 'Number', { cat: 'Commercial', order: 49, placeholder: 'e.g. 10' }),

  // OFFICE specific (Fully Furnished)
  field('Cabins', 'Cabins', 'Number', { cat: 'Commercial', sub: 'Office', order: 55, question: 'Kitne cabin chahiye?' }),
  field('Workstations', 'Workstations', 'Number', { cat: 'Commercial', sub: 'Office', order: 56, question: 'Kitni seating capacity chahiye?' }),
  field('MeetingRooms', 'Meeting Rooms', 'Number', { cat: 'Commercial', sub: 'Office', order: 57 }),
  field('ConferenceRoom', 'Conference Room', 'Boolean', { cat: 'Commercial', sub: 'Office', order: 58, question: 'Conference room chahiye?' }),
  field('ReceptionArea', 'Reception Area', 'Boolean', { cat: 'Commercial', sub: 'Office', order: 59 }),
  field('Pantry', 'Pantry', 'Boolean', { cat: 'Commercial', sub: 'Office', order: 60 }),
  field('ServerRoom', 'Server Room', 'Boolean', { cat: 'Commercial', sub: 'Office', order: 61 }),
  field('DirectorCabin', 'Director/MD Cabin', 'Boolean', { cat: 'Commercial', sub: 'Office', order: 62 }),
  field('NatureOfBusiness', 'Nature of Business', 'Select', {
    cat: 'Commercial', order: 63,
    options: ['IT / Software', 'Consultancy', 'CA / Legal', 'Doctor / Clinic', 'Import/Export', 'Trading', 'Manufacturing Office', 'Real Estate', 'Insurance', 'Coaching / Training', 'BPO / Call Center', 'Media / Marketing', 'Other']
  }),

  // SHOP specific
  field('FrontageWidth', 'Frontage Width (feet)', 'Number', { cat: 'Commercial', sub: 'Shop', order: 51, question: 'Frontage kitna chahiye?' }),
  field('ShopDepth', 'Shop Depth (feet)', 'Number', { cat: 'Commercial', sub: 'Shop', order: 52 }),
  field('FacadeType', 'Facade / Front Type', 'Select', {
    cat: 'Commercial', sub: 'Shop', order: 53,
    options: ['Glass Facade', 'Rolling Shutter', 'Both', 'Open Storefront']
  }),
  field('Mezzanine', 'Mezzanine', 'Boolean', { cat: 'Commercial', sub: 'Shop', order: 54 }),
  field('FootfallEstimate', 'Footfall Estimate', 'Select', {
    cat: 'Commercial', sub: 'Shop', order: 55,
    options: ['Low', 'Medium', 'High', 'Very High (Mall / Main Market)']
  }),
  field('ExistingBusiness', 'Existing Business at Location', 'Text', { cat: 'Commercial', sub: 'Shop', order: 56, placeholder: 'e.g. Restaurant, Boutique' }),

  // WAREHOUSE / GODOWN specific
  field('WhCeilingHeight', 'Warehouse Ceiling Height (feet)', 'Number', { cat: 'Commercial', sub: 'Warehouse', order: 51 }),
  field('LoadingBay', 'Loading Bay / Dock', 'Boolean', { cat: 'Commercial', sub: 'Warehouse', order: 52 }),
  field('TruckAccess', 'Truck Access', 'Select', {
    cat: 'Commercial', sub: 'Warehouse', order: 53,
    options: ['Container (40ft)', 'Container (20ft)', 'Small Truck (Tempo)', 'Both', 'None']
  }),
  field('FloorLoadCapacity', 'Floor Load Capacity (tons/sqm)', 'Number', { cat: 'Commercial', sub: 'Warehouse', order: 54 }),

  // SHOWROOM specific
  field('DisplayWindow', 'Display Windows', 'Number', { cat: 'Commercial', sub: 'Showroom', order: 51 }),
  field('StorageBackroom', 'Storage Back-room', 'Boolean', { cat: 'Commercial', sub: 'Showroom', order: 52 }),
];

// ── INDUSTRIAL fields (Factory, Godown, Cold Storage) ──────────────────
const INDUSTRIAL = [
  field('IndPlotArea', 'Plot Area (sqft / vigha)', 'Number', { cat: 'Industrial', order: 30, tier: 'IMPORTANT', help: '1 vigha = 17,424 sqft in Gujarat' }),
  field('IndBuiltUpArea', 'Built-up Area (sqft)', 'Number', { cat: 'Industrial', order: 31 }),
  field('GIDCApproval', 'GIDC Approved', 'Boolean', { cat: 'Industrial', order: 40, question: 'GIDC approved area me chahiye?', help: 'Gujarat Industrial Development Corporation' }),
  field('IndustryZone', 'Industry Zone', 'Select', {
    cat: 'Industrial', order: 41,
    options: ['GIDC Sachin', 'GIDC Palsana', 'GIDC Hojiwala', 'GIDC Pandesara', 'GIDC Ichhapore', 'Non-GIDC Industrial', 'Other']
  }),
  field('PowerLoadHP', 'Power Load (HP)', 'Number', { cat: 'Industrial', order: 42 }),
  field('PowerConnectionType', 'Power Connection', 'Select', {
    cat: 'Industrial', order: 43,
    options: ['Single Phase', 'Three Phase LT', 'Three Phase HT', 'Solar + Grid', 'To be applied']
  }),
  field('ETP', 'Effluent Treatment (ETP)', 'Boolean', { cat: 'Industrial', order: 44, help: 'Required for textile/chemical industries' }),
  field('BoilerAllowed', 'Boiler Allowed', 'Boolean', { cat: 'Industrial', order: 45 }),
  field('IndustryType', 'Type of Industry', 'Select', {
    cat: 'Industrial', order: 46,
    options: ['Textile', 'Diamond', 'Chemical', 'Pharma', 'Engineering', 'Food Processing', 'Plastic', 'Packaging', 'Warehouse only', 'Logistics', 'Other']
  }),
  field('WaterConnection', 'Water Connection', 'Select', {
    cat: 'Industrial', order: 47,
    options: ['Municipal', 'Borewell', 'Tanker', 'Both Municipal + Borewell']
  }),
  field('CeilingHeightInd', 'Shed Ceiling Height (feet)', 'Number', { cat: 'Industrial', order: 48 }),
  field('CraneAvailable', 'Overhead Crane', 'Boolean', { cat: 'Industrial', sub: 'Factory', order: 49 }),
  field('LabourQuarter', 'Labour Quarter Available', 'Boolean', { cat: 'Industrial', order: 50 }),
  field('ColdChambers', 'Cold Storage Chambers', 'Number', { cat: 'Industrial', sub: 'Cold Storage', order: 51 }),
  field('TempRange', 'Temperature Range', 'Select', {
    cat: 'Industrial', sub: 'Cold Storage', order: 52,
    options: ['Chiller (0 to 4°C)', 'Freezer (-18°C)', 'Deep Freezer (-25°C)', 'Multi-temp']
  }),
];

// ── LAND fields (Residential Plot, Commercial Plot, Agricultural, Industrial Plot, NA Plot) ─
const LAND = [
  field('LandAreaUnit', 'Area Unit', 'Select', {
    cat: 'Land', order: 25, tier: 'IMPORTANT',
    options: ['Square Feet', 'Square Meter', 'Square Yard', 'Vigha', 'Acre', 'Hectare'],
    help: 'Gujarat convention: Vigha (1 vigha = 17,424 sqft)'
  }),
  field('LandAreaValue', 'Total Area', 'Number', { cat: 'Land', order: 26, tier: 'IMPORTANT', question: 'Kitni area chahiye?' }),
  field('RatePerVigha', 'Rate per Vigha (₹)', 'Number', { cat: 'Land', order: 27 }),
  field('RatePerSqYard', 'Rate per Sq Yard (₹)', 'Number', { cat: 'Land', order: 28 }),
  field('FrontRoadWidth', 'Front Road Width (feet)', 'Number', { cat: 'Land', order: 30, question: 'Front road kitna wide?' }),
  field('LandCornerPlot', 'Corner Plot', 'Boolean', { cat: 'Land', order: 31 }),
  field('BoundaryFencing', 'Boundary Fencing', 'Boolean', { cat: 'Land', order: 32 }),
  field('LandZoning', 'Zoning', 'Select', {
    cat: 'Land', order: 33,
    options: ['R1 Residential', 'R2 Residential', 'Commercial', 'Mixed Use', 'Industrial', 'Agriculture', 'Green Zone', 'Special Reserve']
  }),
  field('TPScheme', 'TP Scheme', 'Text', { cat: 'Land', order: 34, help: 'Town Planning scheme number if applicable', placeholder: 'e.g. TP 45' }),
  field('NAOrder', 'NA (Non-Agricultural) Order', 'Boolean', { cat: 'Land', sub: 'NA Plot', order: 35, question: 'NA order approved hai?' }),
  field('NAOrderDate', 'NA Order Date', 'Date', { cat: 'Land', sub: 'NA Plot', order: 36 }),
  field('FSI', 'FSI (Floor Space Index)', 'Number', { cat: 'Land', order: 37, placeholder: 'e.g. 1.8' }),
  field('BuildingPermission', 'Building Permission Available', 'Boolean', { cat: 'Land', order: 38 }),
  // Agricultural specific
  field('SoilType', 'Soil Type', 'Select', {
    cat: 'Land', sub: 'Agricultural Land', order: 40,
    options: ['Black Cotton', 'Alluvial', 'Sandy', 'Red', 'Mixed']
  }),
  field('WaterSource', 'Water Source', 'MultiSelect', {
    cat: 'Land', sub: 'Agricultural Land', order: 41,
    options: ['Borewell', 'Well', 'Canal', 'River', 'Rainwater only', 'Tanker']
  }),
  field('ExistingCrops', 'Existing Crops', 'Text', { cat: 'Land', sub: 'Agricultural Land', order: 42, placeholder: 'e.g. Cotton, Sugarcane' }),
  field('IrrigationType', 'Irrigation Type', 'Select', {
    cat: 'Land', sub: 'Agricultural Land', order: 43,
    options: ['Drip', 'Sprinkler', 'Flood', 'Rain-fed', 'Mixed']
  }),
  field('FarmHouse', 'Farm House Existing', 'Boolean', { cat: 'Land', sub: 'Agricultural Land', order: 44 }),
];

// ── COMMON / GLOBAL fields applicable across categories ────────────────
const COMMON = [
  field('Purpose', 'Purpose', 'Select', {
    order: 3, tier: 'IMPORTANT',
    options: ['Self Use', 'Investment', 'Business Expansion', 'Rental Income', 'Resale']
  }),
  field('ClientType', 'Client Type', 'Select', {
    order: 4,
    options: ['Individual', 'HUF', 'Partnership', 'Pvt Ltd', 'LLP', 'Trust', 'NRI']
  }),
  field('GujaratRERA', 'Gujarat RERA Number', 'Text', {
    order: 55, section: 'Legal',
    placeholder: 'e.g. PR/GJ/SURAT/2024/12345',
    help: 'Gujarat RERA registration number'
  }),
  field('Priority', 'Priority', 'Select', {
    order: 4, tier: 'IMPORTANT',
    options: ['Hot 🔥', 'Warm', 'Cold', 'Nurture']
  }),
];

// ── Insert only if not already present (idempotent) ─────────────────
const existingKeys = new Set(db.V2FieldConfig.map(f => f.FieldKey));
const allNew = [...RESIDENTIAL, ...COMMERCIAL, ...INDUSTRIAL, ...LAND, ...COMMON];
let added = 0;
allNew.forEach(f => {
  // Dedup by (FieldKey + Category + SubCategory) so category-specific variants are OK
  const dupKey = `${f.FieldKey}|${f.Category||''}|${f.SubCategory||''}`;
  const already = db.V2FieldConfig.some(x => `${x.FieldKey}|${x.Category||''}|${x.SubCategory||''}` === dupKey);
  if (!already) { db.V2FieldConfig.push(f); added++; }
});

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log(`Total new V2FieldConfig entries added: ${added}`);
console.log(`Residential: ${RESIDENTIAL.length}`);
console.log(`Commercial:  ${COMMERCIAL.length}`);
console.log(`Industrial:  ${INDUSTRIAL.length}`);
console.log(`Land:        ${LAND.length}`);
console.log(`Common:      ${COMMON.length}`);
console.log(`DB now has ${db.V2FieldConfig.length} total V2FieldConfig entries`);
