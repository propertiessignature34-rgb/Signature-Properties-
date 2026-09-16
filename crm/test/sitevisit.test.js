const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeTempDbPath() {
  return path.join(os.tmpdir(), `sig-sitevisit-unit-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

function createFixture(runtime) {
  const lead = runtime.repository.createLead({
    LeadID: 'LEAD-SITE-UNIT',
    ClientName: 'Asha Singh',
    City: 'Bengaluru',
    Phone: '+91 99999 11111',
    Email: 'asha@test.com',
    LeadStatus: 'Active'
  });

  const requirement = runtime.repository.createRequirement({
    RequirementID: 'REQ-SITE-UNIT',
    RequirementCode: 'REQ-SITE-UNIT',
    LeadID: lead.LeadID,
    TransactionID: 'TXN-SITE-UNIT',
    TransactionType: 'Purchase',
    Category: 'Residential',
    PropertyType: 'Apartment',
    BudgetMin: 12000000,
    BudgetMax: 15000000,
    Location1: 'Whitefield',
    Status: 'Active'
  });

  const property = runtime.repository.create('Inventory', {
    PropertyID: 'PROP-SITE-UNIT',
    TransactionType: 'Purchase',
    Category: 'Residential',
    PropertyType: 'Apartment',
    Project: 'Skyline Heights',
    Location: 'Whitefield',
    City: 'Bengaluru',
    BHK: 3,
    Area: 1800,
    Price: 14000000,
    Status: 'Available'
  });

  const match = runtime.repository.createMatch({
    MatchID: 'MATCH-SITE-UNIT',
    RequirementID: requirement.RequirementID,
    PropertyID: property.PropertyID,
    LeadID: lead.LeadID,
    Score: 92,
    MatchLevel: 'Strong',
    MatchedCriteria: ['Budget', 'Location'],
    FailedCriteria: [],
    UnknownCriteria: [],
    ScoreBreakdown: {},
    Explanation: 'Strong fit',
    Status: 'Active'
  });

  return { lead, requirement, property, match };
}

test('site visit create/read/list and duplicate prevention', async () => {
  const dbFile = makeTempDbPath();
  const runtime = new SignatureRealtyRuntime(dbFile);
  const fixture = createFixture(runtime);

  const first = await runtime.createSiteVisit({
    LeadID: fixture.lead.LeadID,
    RequirementID: fixture.requirement.RequirementID,
    PropertyID: fixture.property.PropertyID,
    MatchID: fixture.match.MatchID,
    VisitDate: '2026-09-15',
    VisitTime: '10:30',
    Duration: '90 mins',
    MeetingPoint: 'Lobby',
    AssignedAgentID: 'USR-0001',
    ClientName: 'Asha Singh',
    ClientPhone: '+91 99999 11111',
    Notes: 'Initial viewing',
    Status: 'Scheduled'
  });

  assert.equal(first.ok, true);
  assert.equal(first.data.Status, 'Scheduled');

  const read = await runtime.getSiteVisit(first.data.VisitID);
  assert.equal(read.ok, true);
  assert.equal(read.data.VisitID, first.data.VisitID);

  const list = await runtime.listSiteVisits();
  assert.equal(list.ok, true);
  assert.equal(list.data.length, 1);

  const duplicate = await runtime.createSiteVisit({
    LeadID: fixture.lead.LeadID,
    RequirementID: fixture.requirement.RequirementID,
    PropertyID: fixture.property.PropertyID,
    MatchID: fixture.match.MatchID,
    VisitDate: '2026-09-15',
    VisitTime: '10:30',
    Duration: '90 mins',
    MeetingPoint: 'Lobby',
    AssignedAgentID: 'USR-0001',
    ClientName: 'Asha Singh',
    ClientPhone: '+91 99999 11111',
    Notes: 'Initial viewing',
    Status: 'Scheduled'
  });

  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /Duplicate active site visit/i);

  fs.unlinkSync(dbFile);
});

test('site visit validates relationships and status transitions', async () => {
  const dbFile = makeTempDbPath();
  const runtime = new SignatureRealtyRuntime(dbFile);
  const fixture = createFixture(runtime);

  const invalidMatch = await runtime.createSiteVisit({
    LeadID: fixture.lead.LeadID,
    RequirementID: fixture.requirement.RequirementID,
    PropertyID: fixture.property.PropertyID,
    MatchID: 'MATCH-DOES-NOT-EXIST',
    VisitDate: '2026-09-16',
    VisitTime: '11:00',
    Duration: '60 mins',
    MeetingPoint: 'Gate',
    AssignedAgentID: 'USR-0001',
    ClientName: 'Asha Singh',
    ClientPhone: '+91 99999 11111',
    Notes: 'Bad match'
  });

  assert.equal(invalidMatch.ok, false);
  assert.match(invalidMatch.error, /Match not found/i);

  const valid = await runtime.createSiteVisit({
    LeadID: fixture.lead.LeadID,
    RequirementID: fixture.requirement.RequirementID,
    PropertyID: fixture.property.PropertyID,
    MatchID: fixture.match.MatchID,
    VisitDate: '2026-09-20',
    VisitTime: '14:30',
    Duration: '60 mins',
    MeetingPoint: 'Gate',
    AssignedAgentID: 'USR-0001',
    ClientName: 'Asha Singh',
    ClientPhone: '+91 99999 11111',
    Notes: 'Good visit'
  });

  assert.equal(valid.ok, true);

  const confirmed = await runtime.confirmSiteVisit(valid.data.VisitID);
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.Status, 'Confirmed');

  const invalidTransition = await runtime.confirmSiteVisit(valid.data.VisitID);
  assert.equal(invalidTransition.ok, false);
  assert.match(invalidTransition.error, /not allowed/i);

  const completed = await runtime.completeSiteVisit(valid.data.VisitID);
  assert.equal(completed.ok, true);
  assert.equal(completed.data.Status, 'Completed');

  fs.unlinkSync(dbFile);
});

test('site visit persists across runtime restarts', async () => {
  const dbFile = makeTempDbPath();
  const firstRuntime = new SignatureRealtyRuntime(dbFile);
  const fixture = createFixture(firstRuntime);

  const created = await firstRuntime.createSiteVisit({
    LeadID: fixture.lead.LeadID,
    RequirementID: fixture.requirement.RequirementID,
    PropertyID: fixture.property.PropertyID,
    MatchID: fixture.match.MatchID,
    VisitDate: '2026-09-25',
    VisitTime: '16:00',
    Duration: '120 mins',
    MeetingPoint: 'Reception',
    AssignedAgentID: 'USR-0001',
    ClientName: 'Asha Singh',
    ClientPhone: '+91 99999 11111',
    Notes: 'Persistence check'
  });

  const restartedRuntime = new SignatureRealtyRuntime(dbFile);
  const readAgain = await restartedRuntime.getSiteVisit(created.data.VisitID);

  assert.equal(readAgain.ok, true);
  assert.equal(readAgain.data.VisitID, created.data.VisitID);
  assert.equal(readAgain.data.LeadID, fixture.lead.LeadID);
  assert.equal(readAgain.data.RequirementID, fixture.requirement.RequirementID);
  assert.equal(readAgain.data.PropertyID, fixture.property.PropertyID);
  assert.equal(readAgain.data.MatchID, fixture.match.MatchID);
  assert.equal(readAgain.data.Status, 'Scheduled');

  fs.unlinkSync(dbFile);
});
