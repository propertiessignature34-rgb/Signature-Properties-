#!/usr/bin/env node
/**
 * Seed Surat-specific data:
 * - Adds Surat area options to Location1/2/3/AvoidLocations fields
 * - Adds new fields: RatePerSqFtMin/Max, SocietyName, RERANumber, CarpetArea, SuperBuiltUpArea
 * - Seeds 8 Surat sample leads with realistic requirements
 * - Adds Surat area to Masters config
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'sig-realty-db.json');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

// ── 1. Surat areas (35 real areas) ──────────────────────────────────────
const SURAT_AREAS = [
  'Vesu', 'Adajan', 'Piplod', 'Athwa', 'Pal', 'Katargam', 'City Light',
  'Rander', 'Sarthana', 'Varachha', 'Nanpura', 'Ghod Dod Road', 'Umra',
  'Bhatar', 'Palanpur Patiya', 'Dumas Road', 'Magdalla', 'VIP Road',
  'Parle Point', 'Althan', 'Anand Mahal Road', 'Bhimrad', 'Causeway Road',
  'Jahangirpura', 'Kadodara', 'Kamrej', 'LP Savani Road', 'New Textile Market',
  'Nikol', 'Puna', 'Rustampura', 'Salabatpura', 'Singanpore', 'Tapi Road',
  'Udhna'
].sort();

// ── 2. Update Location fields with Surat area options ─────────────────
db.V2FieldConfig = db.V2FieldConfig || [];
const locationKeys = ['Location1', 'Location2', 'Location3', 'AvoidLocations'];
db.V2FieldConfig.forEach(f => {
  if (locationKeys.includes(f.FieldKey)) {
    f.Options = SURAT_AREAS;
    f.FieldType = 'Autocomplete'; // text + suggestions (frontend renders datalist)
    if (f.FieldKey === 'Location1') f.Placeholder = 'e.g. Vesu, Adajan, Piplod';
  }
});

// ── 3. Add new Surat-specific fields ──────────────────────────────────
const newFields = [
  {
    FieldConfigID: 'FC-100', FieldKey: 'RatePerSqFtMin', FieldLabel: 'Rate/Sqft (Min)',
    QuestionLabel: 'Minimum rate per sq ft?', FieldType: 'Number', Section: 'Budget',
    Tier: 'IMPORTANT', RequiredMode: 'OPTIONAL', Options: [], DisplayOrder: 12,
    Placeholder: 'e.g. 5000', HelpText: 'Rate range per sq ft (Surat market unit)',
    Active: true, _v2: true
  },
  {
    FieldConfigID: 'FC-101', FieldKey: 'RatePerSqFtMax', FieldLabel: 'Rate/Sqft (Max)',
    QuestionLabel: 'Maximum rate per sq ft?', FieldType: 'Number', Section: 'Budget',
    Tier: 'IMPORTANT', RequiredMode: 'OPTIONAL', Options: [], DisplayOrder: 13,
    Placeholder: 'e.g. 8500', Active: true, _v2: true
  },
  {
    FieldConfigID: 'FC-102', FieldKey: 'SocietyName', FieldLabel: 'Society / Building',
    QuestionLabel: 'Konsi society ya building preferred hai?', FieldType: 'Autocomplete',
    Section: 'Location', Tier: 'OPTIONAL', RequiredMode: 'OPTIONAL', Options: [],
    DisplayOrder: 24, Placeholder: 'e.g. Silver Oak, Ratnakar Nine Square',
    Active: true, _v2: true
  },
  {
    FieldConfigID: 'FC-103', FieldKey: 'RERANumber', FieldLabel: 'RERA Number',
    QuestionLabel: 'RERA registration number?', FieldType: 'Text', Section: 'Legal',
    Tier: 'OPTIONAL', RequiredMode: 'OPTIONAL', Options: [], DisplayOrder: 50,
    Placeholder: 'PR/GJ/SURAT/…', HelpText: 'Gujarat RERA registration', Active: true, _v2: true
  },
  {
    FieldConfigID: 'FC-104', FieldKey: 'CarpetArea', FieldLabel: 'Carpet Area (sqft)',
    QuestionLabel: 'Carpet area kitna chahiye?', FieldType: 'Number', Section: 'Property',
    Tier: 'IMPORTANT', RequiredMode: 'OPTIONAL', Options: [], DisplayOrder: 30,
    Placeholder: 'e.g. 1250', Active: true, _v2: true
  },
  {
    FieldConfigID: 'FC-105', FieldKey: 'SuperBuiltUpArea', FieldLabel: 'Super Built-up Area (sqft)',
    QuestionLabel: 'Super built-up area?', FieldType: 'Number', Section: 'Property',
    Tier: 'OPTIONAL', RequiredMode: 'OPTIONAL', Options: [], DisplayOrder: 31,
    Placeholder: 'e.g. 1650', Active: true, _v2: true
  },
  {
    FieldConfigID: 'FC-106', FieldKey: 'LeadSource', FieldLabel: 'Lead Source',
    QuestionLabel: 'Kaha se aaya ye client?', FieldType: 'Select', Section: 'Client',
    Tier: 'IMPORTANT', RequiredMode: 'OPTIONAL',
    Options: ['Walk-in', 'Referral', 'WhatsApp', 'Facebook / Instagram', 'Google', '99Acres', 'MagicBricks', 'Housing.com', 'OLX', 'Newspaper Ad', 'Hoarding', 'Cold Call', 'Existing Client', 'Sub-broker', 'Other'],
    DisplayOrder: 5, Placeholder: 'Select source', Active: true, _v2: true
  },
];
// Only add if not already present
newFields.forEach(nf => {
  if (!db.V2FieldConfig.find(f => f.FieldKey === nf.FieldKey)) db.V2FieldConfig.push(nf);
});

// ── 4. Update Masters — add Surat locations master ────────────────────
db.Masters = db.Masters || [];
const suratMasterIdx = db.Masters.findIndex(m => m.type === 'SuratAreas');
const suratMaster = { type: 'SuratAreas', city: 'Surat', areas: SURAT_AREAS, updatedAt: new Date().toISOString() };
if (suratMasterIdx >= 0) db.Masters[suratMasterIdx] = suratMaster;
else db.Masters.push(suratMaster);

// ── 5. Seed Surat sample leads ────────────────────────────────────────
db.Leads = db.Leads || [];
db.Transactions = db.Transactions || [];
db.Requirements = db.Requirements || [];
db._V2Counters = db._V2Counters || { lead: 0, transaction: 0, requirement: 0 };

const now = () => new Date().toISOString();
const nextId = (prefix, counter) => {
  db._V2Counters[counter] = (db._V2Counters[counter] || 0) + 1;
  return `${prefix}${String(db._V2Counters[counter]).padStart(6, '0')}`;
};

const SURAT_LEADS = [
  { name: 'Jignesh Patel', mobile: '+91 98250 12345', email: 'jignesh.p@gmail.com',
    city: 'Surat', tags: ['Hot', 'Investor'], status: 'Active', source: 'Referral',
    txn: { type: 'Purchase', category: 'Residential', subCategory: 'Flat',
      budgetMin: 8500000, budgetMax: 12000000, bhk: '3 BHK', area: 'Vesu',
      area2: 'Piplod', rateMin: 7500, rateMax: 9500, society: 'Ratnakar Nine Square',
      carpet: 1350, urgency: '1-3 months' } },
  { name: 'Hitesh Shah', mobile: '+91 99244 55678', email: 'hitesh.shah@yahoo.in',
    city: 'Surat', tags: ['Hot'], status: 'Active', source: 'Walk-in',
    txn: { type: 'Purchase', category: 'Residential', subCategory: 'Flat',
      budgetMin: 5500000, budgetMax: 7500000, bhk: '2 BHK', area: 'Adajan',
      rateMin: 5500, rateMax: 7000, urgency: 'Immediate' } },
  { name: 'Priya Mehta', mobile: '+91 98795 33221', email: 'priya.m@outlook.com',
    city: 'Surat', tags: [], status: 'New', source: 'WhatsApp',
    txn: { type: 'Rent', category: 'Residential', subCategory: 'Flat',
      budgetMin: 18000, budgetMax: 28000, bhk: '2 BHK', area: 'City Light',
      area2: 'Athwa', urgency: '1 month' } },
  { name: 'Rakesh Desai', mobile: '+91 97123 44556', email: null,
    city: 'Surat', tags: ['Investor'], status: 'Verified', source: 'Existing Client',
    txn: { type: 'Purchase', category: 'Commercial', subCategory: 'Shop',
      budgetMin: 15000000, budgetMax: 25000000, area: 'Ghod Dod Road',
      rateMin: 12000, rateMax: 18000, urgency: '3-6 months' } },
  { name: 'Sneha Trivedi', mobile: '+91 98920 78901', email: 'sneha.t@gmail.com',
    city: 'Surat', tags: ['Hot', 'Family'], status: 'Active', source: '99Acres',
    txn: { type: 'Purchase', category: 'Residential', subCategory: 'Villa',
      budgetMin: 25000000, budgetMax: 40000000, bhk: '4 BHK', area: 'Vesu',
      society: 'Green Woods', carpet: 3200, urgency: '3-6 months' } },
  { name: 'Amit Bhagat', mobile: '+91 96011 22334', email: 'amit.b@rediff.com',
    city: 'Surat', tags: [], status: 'New', source: 'Facebook / Instagram',
    txn: { type: 'Rent', category: 'Residential', subCategory: 'Flat',
      budgetMin: 12000, budgetMax: 18000, bhk: '1 BHK', area: 'Katargam', urgency: 'Immediate' } },
  { name: 'Neha Sanghvi', mobile: '+91 98240 99887', email: 'neha.sanghvi@gmail.com',
    city: 'Surat', tags: ['Hot'], status: 'Active', source: 'Referral',
    txn: { type: 'Purchase', category: 'Residential', subCategory: 'Flat',
      budgetMin: 6500000, budgetMax: 8500000, bhk: '3 BHK', area: 'Pal',
      area2: 'Palanpur Patiya', rateMin: 5000, rateMax: 6500, urgency: '1-3 months' } },
  { name: 'Sunil Agrawal', mobile: '+91 94270 44112', email: null,
    city: 'Surat', tags: ['Investor', 'Repeat'], status: 'Verified', source: 'Sub-broker',
    txn: { type: 'Purchase', category: 'Land', subCategory: 'Commercial Plot',
      budgetMin: 30000000, budgetMax: 55000000, area: 'Kamrej', urgency: '6+ months' } },
];

// Only seed if leads count is minimal
const existingSuratLeads = db.Leads.filter(l => l.City === 'Surat').length;
if (existingSuratLeads < 5) {
  SURAT_LEADS.forEach((s, idx) => {
    const leadId = nextId('L', 'lead');
    const txnId = nextId('T', 'transaction');
    const reqId = nextId('R', 'requirement');

    // Lead
    db.Leads.push({
      LeadID: leadId, ClientName: s.name, PrimaryMobile: s.mobile, Email: s.email,
      City: s.city, ClientStatus: s.status, LeadStatus: s.status,
      ClientLifecycle: s.status === 'New' ? 'Prospect' : 'Client',
      Tags: s.tags, LeadSource: s.source,
      AssignedAgentID: 'USR-0001',
      CreatedAt: now(), UpdatedAt: now(), CreatedBy: 'USR-0001',
      _v2: true
    });

    // Transaction
    db.Transactions.push({
      TransactionID: txnId, LeadID: leadId,
      TransactionType: s.txn.type, Category: s.txn.category, SubCategory: s.txn.subCategory,
      Status: 'Active', PipelineStage: 'New',
      CreatedAt: now(), UpdatedAt: now(), CreatedBy: 'USR-0001',
      _v2: true
    });

    // Requirement
    const req = {
      RequirementID: reqId, LeadID: leadId, TransactionID: txnId,
      TransactionType: s.txn.type, Category: s.txn.category, SubCategory: s.txn.subCategory,
      BudgetMin: s.txn.budgetMin, BudgetMax: s.txn.budgetMax,
      Location1: s.txn.area, Location2: s.txn.area2 || null,
      Urgency: s.txn.urgency, RequirementStatus: 'Active',
      CreatedAt: now(), UpdatedAt: now(), CreatedBy: 'USR-0001',
      _v2: true, FormVersion: '2.0'
    };
    if (s.txn.bhk) req.BHK = s.txn.bhk;
    if (s.txn.rateMin) req.RatePerSqFtMin = s.txn.rateMin;
    if (s.txn.rateMax) req.RatePerSqFtMax = s.txn.rateMax;
    if (s.txn.society) req.SocietyName = s.txn.society;
    if (s.txn.carpet) req.CarpetArea = s.txn.carpet;
    db.Requirements.push(req);
  });
  console.log(`Seeded ${SURAT_LEADS.length} Surat leads with transactions + requirements`);
}

// ── 6. Save DB ────────────────────────────────────────────────────────
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log('DB updated successfully');
console.log(`- Surat areas configured on ${locationKeys.length} location fields (${SURAT_AREAS.length} areas)`);
console.log(`- New V2FieldConfig entries: ${newFields.length}`);
console.log(`- Total Leads now: ${db.Leads.length}`);
console.log(`- Total Requirements now: ${db.Requirements.length}`);
