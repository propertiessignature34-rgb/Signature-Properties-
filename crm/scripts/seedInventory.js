#!/usr/bin/env node
/**
 * Add Property/Inventory-specific fields to V2FieldConfig.
 * These are owner/listing-side fields that don't apply to requirements.
 */
const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, '..', 'data', 'sig-realty-db.json');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

db.V2FieldConfig = db.V2FieldConfig || [];
db.V2FieldConfig = db.V2FieldConfig.filter(f => f.EntityScope !== 'Property'); // clear & reseed

let counter = 300;
function pf(key, label, type, opts = {}) {
  counter++;
  return {
    FieldConfigID: `PF-${counter}`,
    FieldKey: key,
    FieldLabel: label,
    QuestionLabel: opts.question || label + '?',
    FieldType: type,
    Section: opts.section || 'Listing',
    Tier: opts.tier || 'OPTIONAL',
    RequiredMode: opts.required || 'OPTIONAL',
    Options: opts.options || [],
    DisplayOrder: opts.order || 50,
    EntityScope: 'Property',
    Category: opts.cat || null,
    SubCategory: opts.sub || null,
    Active: true,
    HelpText: opts.help || null,
    Placeholder: opts.placeholder || null,
    _v2: true
  };
}

const PROPERTY_FIELDS = [
  // Listing basics
  pf('Title',            'Property Title',       'Text',      { order: 1,  tier: 'IMPORTANT', section: 'Listing', placeholder: 'e.g. 3 BHK Flat in Ratnakar Nine Square, Vesu' }),
  pf('ListingFor',       'Listing For',          'Select',    { order: 2,  tier: 'CORE',      section: 'Listing', options: ['Sale', 'Rent', 'Lease', 'Rent + Sale'] }),
  pf('ListingStatus',    'Status',               'Select',    { order: 3,  section: 'Listing', options: ['Available', 'Under Offer', 'Reserved', 'Sold', 'Rented', 'Off-market', 'Expired'] }),
  pf('AvailableFrom',    'Available From',       'Date',      { order: 4,  section: 'Listing' }),
  pf('PropertyURL',      'Portal / Ad Link',     'Text',      { order: 5,  section: 'Listing', placeholder: 'https://99acres.com/…' }),
  pf('ExclusiveWithMe',  'Exclusive Mandate',    'Boolean',   { order: 6,  section: 'Listing', help: 'Is this property listed exclusively with me?' }),

  // Ownership
  pf('OwnerName',        'Owner Name',           'Text',      { order: 10, tier: 'IMPORTANT', section: 'Ownership' }),
  pf('OwnerMobile',      'Owner Mobile',         'Text',      { order: 11, tier: 'IMPORTANT', section: 'Ownership', placeholder: '+91 98765 43210' }),
  pf('OwnerType',        'Owner Type',           'Select',    { order: 12, section: 'Ownership', options: ['Direct Owner', 'Builder', 'Sub-broker', 'Investor', 'NRI Owner', 'Corporate'] }),
  pf('OwnerEmail',       'Owner Email',          'Text',      { order: 13, section: 'Ownership' }),
  pf('POA',              'Power of Attorney',    'Boolean',   { order: 14, section: 'Ownership' }),

  // Pricing
  pf('AskingPrice',      'Asking Price (₹)',     'Number',    { order: 20, tier: 'IMPORTANT', section: 'Pricing' }),
  pf('AskingRatePerSqFt','Rate per Sq Ft (₹)',   'Number',    { order: 21, section: 'Pricing' }),
  pf('MinPrice',         'Minimum Acceptable Price (₹)', 'Number', { order: 22, section: 'Pricing', help: 'Owner\'s lowest sell price — for negotiation reference' }),
  pf('MaintenanceMonthly','Maintenance / Month (₹)', 'Number', { order: 23, section: 'Pricing' }),
  pf('DepositMonths',    'Deposit (months of rent)', 'Number', { order: 24, section: 'Pricing', help: 'For Rent listings' }),
  pf('NegotiableMargin', 'Negotiable %',         'Number',    { order: 25, section: 'Pricing', placeholder: 'e.g. 5', help: 'Owner\'s flex on asking' }),

  // Meta
  pf('CommissionMode',   'Commission Mode',      'Select',    { order: 30, section: 'Commission', options: ['1% Buyer', '1% Seller', '1% Both', '2% Buyer', '2% Seller', '2% Both', 'Rent = 1 Month', 'Rent = 15 days', 'Fixed Fee', 'Other'] }),
  pf('CommissionAmount', 'Commission Amount (₹)','Number',    { order: 31, section: 'Commission' }),
  pf('ProjectName',      'Project Name',         'Text',      { order: 40, section: 'Project' }),
  pf('BuilderName',      'Builder Name',         'Text',      { order: 41, section: 'Project' }),
  pf('BuilderRERA',      'Builder RERA',         'Text',      { order: 42, section: 'Project' }),
  pf('ProjectPossession','Project Possession Date', 'Date',   { order: 43, section: 'Project' }),
  pf('ProjectStatus',    'Project Status',       'Select',    { order: 44, section: 'Project', options: ['Under Construction', 'Ready to Move', 'New Launch', 'Resale'] })
];

PROPERTY_FIELDS.forEach(f => db.V2FieldConfig.push(f));

// ── Seed 8 sample Surat properties ─────────────────────────────────────
db.Inventory = db.Inventory || [];
db._V2Counters = db._V2Counters || {};
db._V2Counters.Property = db._V2Counters.Property || 0;
const now = () => new Date().toISOString();
const nextPropId = () => `PROP-${String(++db._V2Counters.Property).padStart(4,'0')}`;

const SAMPLE_PROPERTIES = [
  { Title: '3 BHK Flat in Ratnakar Nine Square, Vesu',
    Category: 'Residential', SubCategory: 'Flat', ListingFor: 'Sale', ListingStatus: 'Available',
    SocietyName: 'Ratnakar Nine Square', Location1: 'Vesu',
    OwnerName: 'Ashok Jariwala', OwnerMobile: '+91 98250 11111', OwnerType: 'Direct Owner',
    Fields: { AskingPrice: 12500000, AskingRatePerSqFt: 8500, CarpetArea: 1350, SuperBuiltUpArea: 1650, BHK: '3 BHK', Furnishing: 'Semi Furnished', Bathrooms: 3, Balconies: 2, Facing: 'East', Floor: '5th of 12', ParkingCarSlots: 2 } },
  { Title: '2 BHK Rent in City Light',
    Category: 'Residential', SubCategory: 'Flat', ListingFor: 'Rent', ListingStatus: 'Available',
    Location1: 'City Light', SocietyName: 'Sun Woods',
    OwnerName: 'Mehul Shah', OwnerMobile: '+91 99245 22222', OwnerType: 'Direct Owner',
    Fields: { AskingPrice: 22000, DepositMonths: 6, MaintenanceMonthly: 1500, CarpetArea: 950, BHK: '2 BHK', Furnishing: 'Fully Furnished' } },
  { Title: '4 BHK Villa on Dumas Road',
    Category: 'Residential', SubCategory: 'Villa', ListingFor: 'Sale', ListingStatus: 'Available',
    Location1: 'Dumas Road', SocietyName: 'Green Woods',
    OwnerName: 'Rakesh Patel', OwnerMobile: '+91 98795 33333', OwnerType: 'NRI Owner', POA: true,
    Fields: { AskingPrice: 35000000, AskingRatePerSqFt: 9500, CarpetArea: 3200, PlotArea: 2400, BHK: '4 BHK', Garden: true, SwimmingPool: true, ServantQuarter: true, Furnishing: 'Semi Furnished' } },
  { Title: 'Fully Furnished Office (4 Cabin + 20 Seats) — Ghod Dod Road',
    Category: 'Commercial', SubCategory: 'Office', ListingFor: 'Rent', ListingStatus: 'Available',
    Location1: 'Ghod Dod Road',
    OwnerName: 'Kunal Doshi', OwnerMobile: '+91 97123 44444', OwnerType: 'Direct Owner',
    Fields: { AskingPrice: 95000, CarpetAreaComm: 1400, BuiltUpAreaComm: 1650, FurnishingType: 'Fully Furnished', FloorNumber: '3rd', Cabins: 4, Workstations: 20, MeetingRooms: 2, ConferenceRoom: true, Pantry: true, ServerRoom: true, PowerLoadKVA: 30, ACType: 'VRV / VRF', ParkingCarSlots: 3, LiftAvailable: true } },
  { Title: 'Ground Floor Shop 25ft Frontage — Vesu Main Road',
    Category: 'Commercial', SubCategory: 'Shop', ListingFor: 'Rent', ListingStatus: 'Available',
    Location1: 'Vesu',
    OwnerName: 'Deepak Agrawal', OwnerMobile: '+91 98240 55555', OwnerType: 'Direct Owner',
    Fields: { AskingPrice: 55000, CarpetAreaComm: 550, FrontageWidth: 25, ShopDepth: 22, FloorNumber: 'Ground', Mezzanine: true, FacadeType: 'Glass Facade', FootfallEstimate: 'High' } },
  { Title: 'Textile Godown 5000 sqft — GIDC Sachin',
    Category: 'Industrial', SubCategory: 'Warehouse', ListingFor: 'Rent', ListingStatus: 'Available',
    Location1: 'Kadodara',
    OwnerName: 'Bipin Kothari', OwnerMobile: '+91 96011 66666', OwnerType: 'Direct Owner',
    Fields: { AskingPrice: 175000, IndPlotArea: 5000, IndBuiltUpArea: 4200, GIDCApproval: true, IndustryZone: 'GIDC Sachin', PowerLoadHP: 40, CeilingHeightInd: 22, LoadingBay: true, TruckAccess: 'Container (40ft)' } },
  { Title: 'NA Plot 12 Vigha — Kamrej',
    Category: 'Land', SubCategory: 'Residential Plot', ListingFor: 'Sale', ListingStatus: 'Available',
    Location1: 'Kamrej',
    OwnerName: 'Naresh Modi', OwnerMobile: '+91 94270 77777', OwnerType: 'Direct Owner',
    Fields: { AskingPrice: 45000000, LandAreaValue: 12, LandAreaUnit: 'Vigha', RatePerVigha: 3750000, NAOrder: true, LandCornerPlot: true, FrontRoadWidth: 40, TPScheme: 'TP 45' } },
  { Title: '5000 sqft Industrial Shed — GIDC Pandesara',
    Category: 'Industrial', SubCategory: 'Factory', ListingFor: 'Sale', ListingStatus: 'Available',
    Location1: 'Palanpur Patiya',
    OwnerName: 'Sameer Kapadia', OwnerMobile: '+91 98202 88888', OwnerType: 'Direct Owner',
    Fields: { AskingPrice: 28000000, IndPlotArea: 6000, IndBuiltUpArea: 5000, GIDCApproval: true, IndustryZone: 'GIDC Pandesara', PowerLoadHP: 100, PowerConnectionType: 'Three Phase HT', CeilingHeightInd: 26, IndustryType: 'Textile', ETP: true } }
];

const existingCount = db.Inventory.filter(p => (p.PropertyID||'').startsWith('PROP-') && !p._deleted).length;
if (existingCount < 5) {
  SAMPLE_PROPERTIES.forEach(s => {
    const id = nextPropId();
    db.Inventory.push({
      PropertyID: id, ...s,
      Photos: [], CreatedAt: now(), UpdatedAt: now(), CreatedBy: 'seed', _v2: true
    });
  });
}

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log(`Property fields added: ${PROPERTY_FIELDS.length}`);
console.log(`Sample properties seeded: ${SAMPLE_PROPERTIES.length}`);
console.log(`Total inventory: ${db.Inventory.filter(p => !p._deleted).length}`);
