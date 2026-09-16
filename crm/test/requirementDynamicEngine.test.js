'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { JsonRepository } = require('../src/data/repository');
const { V2ConfigService } = require('../src/services/v2ConfigService');
const { V2FormRegistryService } = require('../src/services/v2FormRegistryService');
const { V2DependencyService } = require('../src/services/v2DependencyService');
const { V2ScoringService } = require('../src/services/v2ScoringService');
const { V2LeadService } = require('../src/services/v2LeadService');
const { V2TransactionService } = require('../src/services/v2TransactionService');
const { V2RequirementService } = require('../src/services/v2RequirementService');
const { SmartMatchService } = require('../src/services/smartMatchService');

function makeStack() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-req-dyn-'));
  const repo = new JsonRepository(path.join(dir, 'db.json'));
  const cfg = new V2ConfigService(repo);
  const reg = new V2FormRegistryService(repo, cfg);
  const dep = new V2DependencyService(repo, reg);
  const scoring = new V2ScoringService(repo, dep);
  const leadSvc = new V2LeadService(repo, scoring);
  const txnSvc = new V2TransactionService(repo);
  const reqSvc = new V2RequirementService(repo, scoring);
  cfg.seedConfigIfEmpty();
  reg.seedFormRegistryIfEmpty();
  dep.seedDependencyConfigIfEmpty();
  scoring.seedScoringConfigIfEmpty();
  return { repo, cfg, reg, dep, scoring, leadSvc, txnSvc, reqSvc };
}

function createLeadTxn(stack, transactionType = 'Rent', leadExtras = {}) {
  const lead = stack.leadSvc.createLead({
    ClientName: 'Dynamic Lead',
    PrimaryMobile: String(Date.now() + Math.floor(Math.random() * 100000)),
    ...leadExtras
  }, { userId: 'U1' });
  assert.equal(lead.ok, true, lead.error);
  const txn = stack.txnSvc.createTransaction(lead.data.LeadID, { TransactionType: transactionType }, { userId: 'U1' });
  assert.equal(txn.ok, true, txn.error);
  return { lead: lead.data, txn: txn.data };
}

test('requirement creation auto-prefills lead budget, location, property type, and contact fields', () => {
  const stack = makeStack();
  const { lead, txn } = createLeadTxn(stack, 'Rent', {
    RequirementProfile: {
      BudgetMax: 60000,
      Location1: 'Vesu',
      PropertyType: 'Office',
      RequirementType: 'Rent'
    },
    Email: 'lead@example.com'
  });

  const created = stack.reqSvc.createRequirement(txn.TransactionID, {
    LeadID: lead.LeadID,
    Category: 'Commercial'
  }, { userId: 'U1' });

  assert.equal(created.ok, true, created.error);
  assert.equal(created.data.BudgetMax, 60000);
  assert.equal(created.data.Location1, 'Vesu');
  assert.equal(created.data.SubCategory, 'Office');
  assert.equal(created.data.PropertyType, 'Office');
  assert.equal(created.data.TransactionType, 'Rent');
  assert.equal(created.data.ContactMobile, lead.PrimaryMobile);
  assert.equal(created.data.ContactEmail, 'lead@example.com');
});

test('commercial office dependency flow only reveals count questions after yes/no parent answers', () => {
  const stack = makeStack();
  const base = stack.dep.evaluateContext({
    transactionType: 'Rent',
    category: 'Commercial',
    subCategory: 'Office',
    fields: {}
  });
  assert.equal(base.ok, true);
  assert.equal(base.fields.SeatingRequired, 'RELEVANT');
  assert.equal(base.fields.SeatingCapacity, 'HIDDEN');
  assert.equal(base.fields.CabinCount, 'HIDDEN');

  const answered = stack.dep.evaluateContext({
    transactionType: 'Rent',
    category: 'Commercial',
    subCategory: 'Office',
    fields: {
      SeatingRequired: { state: 'KNOWN', value: true },
      CabinsRequired: { state: 'KNOWN', value: false }
    }
  });
  assert.equal(answered.fields.SeatingCapacity, 'RELEVANT');
  assert.equal(answered.fields.CabinCount, 'NOT_RELEVANT');
});

test('resolved forms stay property-type specific across acceptance paths', () => {
  const stack = makeStack();
  const office = stack.reg.resolveFormConfig('Rent', 'Commercial', 'Office').fields.map((field) => field.FieldKey);
  const shop = stack.reg.resolveFormConfig('Rent', 'Commercial', 'Shop').fields.map((field) => field.FieldKey);
  const warehouse = stack.reg.resolveFormConfig('Rent', 'Commercial', 'Warehouse').fields.map((field) => field.FieldKey);
  const flat = stack.reg.resolveFormConfig('Rent', 'Residential', 'Flat').fields.map((field) => field.FieldKey);
  const land = stack.reg.resolveFormConfig('Buy', 'Land', 'Commercial Plot').fields.map((field) => field.FieldKey);

  assert.ok(office.includes('SeatingRequired'));
  assert.ok(office.includes('CabinsRequired'));
  assert.ok(!office.includes('DisplayWindowRequired'));

  assert.ok(shop.includes('DisplayWindowRequired'));
  assert.ok(shop.includes('FrontageFeet'));
  assert.ok(!shop.includes('SeatingRequired'));

  assert.ok(warehouse.includes('ClearHeightFeet'));
  assert.ok(warehouse.includes('LoadingDockRequired'));
  assert.ok(!warehouse.includes('ConferenceRoomRequired'));

  assert.ok(flat.includes('BHKMin'));
  assert.ok(flat.includes('CarpetAreaMin'));
  assert.ok(!flat.includes('LoadingDockRequired'));

  assert.ok(land.includes('PlotAreaMin'));
  assert.ok(land.includes('AreaUnit'));
  assert.ok(land.includes('TitleClear'));
});

test('requirement stores structured area fields and must/preferred/flexible priorities', () => {
  const stack = makeStack();
  const { lead, txn } = createLeadTxn(stack, 'Rent');
  const created = stack.reqSvc.createRequirement(txn.TransactionID, {
    LeadID: lead.LeadID,
    Category: 'Commercial',
    SubCategory: 'Office',
    BudgetMax: 60000,
    Location1: 'Vesu',
    RequiredAreaMin: 1000,
    RequiredAreaMax: 1500,
    Furnishing: 'Furnished',
    SeatingRequired: true,
    SeatingCapacity: 25,
    CabinsRequired: true,
    CabinCount: 3,
    ParkingRequired: true,
    ParkingCarCount: 5,
    FieldPriorities: {
      Location1: 'MUST_HAVE',
      SeatingCapacity: 'MUST_HAVE',
      CabinCount: 'PREFERRED',
      ParkingCarCount: 'FLEXIBLE'
    }
  }, { userId: 'U1' });

  assert.equal(created.ok, true, created.error);
  assert.equal(created.data.Fields.RequiredAreaMin.value, 1000);
  assert.equal(created.data.Fields.RequiredAreaMax.value, 1500);
  assert.equal(created.data.Fields.SeatingCapacity.priority, 'MUST_HAVE');
  assert.equal(created.data.Fields.CabinCount.priority, 'PREFERRED');
  assert.equal(created.data.Fields.ParkingCarCount.priority, 'FLEXIBLE');
  assert.equal(created.data.FieldPriorities.Location1, 'MUST_HAVE');
});

test('smart match ranks structured office inventory higher than weak mismatches', () => {
  const stack = makeStack();
  const { lead, txn } = createLeadTxn(stack, 'Rent');
  const req = stack.reqSvc.createRequirement(txn.TransactionID, {
    LeadID: lead.LeadID,
    TransactionType: 'Rent',
    Category: 'Commercial',
    SubCategory: 'Office',
    BudgetMax: 60000,
    Location1: 'Vesu',
    RequiredAreaMin: 1000,
    RequiredAreaMax: 1500,
    Furnishing: 'Furnished',
    SeatingRequired: true,
    SeatingCapacity: 25,
    CabinsRequired: true,
    CabinCount: 3,
    ParkingRequired: true,
    ParkingCarCount: 5,
    FieldPriorities: {
      Location1: 'MUST_HAVE',
      SeatingCapacity: 'MUST_HAVE',
      CabinCount: 'PREFERRED'
    }
  }, { userId: 'U1' });
  assert.equal(req.ok, true, req.error);

  const db = stack.repo.read();
  db.Inventory.push({
    PropertyID: 'INV-STRONG',
    Category: 'Commercial',
    SubCategory: 'Office',
    ListingFor: 'Rent',
    AskingPrice: 55000,
    Location1: 'Vesu',
    CarpetArea: 1250,
    Furnishing: 'Furnished',
    SeatingCapacity: 30,
    CabinCount: 3,
    ParkingCarCount: 6,
    ListingStatus: 'Available'
  });
  db.Inventory.push({
    PropertyID: 'INV-WEAK',
    Category: 'Commercial',
    SubCategory: 'Office',
    ListingFor: 'Rent',
    AskingPrice: 55000,
    Location1: 'Adajan',
    CarpetArea: 700,
    Furnishing: 'Unfurnished',
    SeatingCapacity: 15,
    CabinCount: 1,
    ParkingCarCount: 1,
    ListingStatus: 'Available'
  });
  stack.repo.write(db);

  const result = new SmartMatchService(stack.repo).matchByRequirementId(req.data.RequirementID, { limit: 10, minScore: 0 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.matches[0].PropertyID, 'INV-STRONG');
  assert.ok(result.data.matches[0].Score > result.data.matches[1].Score);
  assert.ok(result.data.matches[0].Score >= 80);
  assert.ok(result.data.matches[1].Score < 60);
});
