const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-negotiation-unit-')), 'sig-realty-db.json');
}

async function createFixture(runtime, suffix = '001') {
  const lead = await runtime.createLead({
    clientName: `Negotiation Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 9000100${suffix}`,
    email: `neg.lead.${suffix}@example.com`,
    leadStatus: 'Active',
    assignedAgentId: 'USR-0001'
  });
  assert.equal(lead.ok, true);

  const requirement = await runtime.createRequirement(lead.data.LeadID, `TXN-NEG-${suffix}`, {
    leadId: lead.data.LeadID,
    transactionId: `TXN-NEG-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 20000000,
    location1: `Negotiation City ${suffix}`,
    location2: `Negotiation East ${suffix}`,
    location3: `Negotiation District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1800,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Negotiation fixture',
    formType: 'residential'
  });
  assert.equal(requirement.ok, true);

  const property = await runtime.createInventoryProperty({
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `Negotiation Heights ${suffix}`,
    location: `Negotiation City ${suffix}`,
    city: 'Bengaluru',
    bhk: 3,
    area: 1500,
    price: 16000000,
    possession: 'Ready',
    status: 'Available'
  });
  assert.equal(property.ok, true);

  const run = await runtime.runMatching(requirement.data.RequirementID);
  assert.equal(run.ok, true);
  const match = run.data.matches.find((item) => item.PropertyID === property.data.PropertyID);
  assert.ok(match);

  const shortlist = await runtime.addToShortlist({
    requirementId: requirement.data.RequirementID,
    propertyId: property.data.PropertyID,
    matchId: match.MatchID,
    priority: 'High',
    notes: 'Negotiation fixture shortlist'
  });
  assert.equal(shortlist.ok, true);

  const visit = await runtime.createSiteVisit({
    LeadID: lead.data.LeadID,
    RequirementID: requirement.data.RequirementID,
    PropertyID: property.data.PropertyID,
    MatchID: match.MatchID,
    ShortlistID: shortlist.data.ShortlistID,
    VisitDate: '2026-12-01',
    VisitTime: '11:00',
    MeetingPoint: 'Lobby',
    AssignedAgentID: 'USR-0001',
    Notes: 'Negotiation fixture visit',
    Status: 'Scheduled'
  });
  assert.equal(visit.ok, true);

  return {
    leadId: lead.data.LeadID,
    requirementId: requirement.data.RequirementID,
    transactionId: requirement.data.TransactionID,
    propertyId: property.data.PropertyID,
    matchId: match.MatchID,
    shortlistId: shortlist.data.ShortlistID,
    siteVisitId: visit.data.VisitID
  };
}

test('negotiation create validates relationships and duplicate prevention', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  const fixture = await createFixture(runtime, '101');

  const created = await runtime.createNegotiation({
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    TransactionID: fixture.transactionId,
    PropertyID: fixture.propertyId,
    MatchID: fixture.matchId,
    ShortlistID: fixture.shortlistId,
    SiteVisitID: fixture.siteVisitId,
    AskingPrice: 16000000,
    InitialOffer: 15000000,
    CurrentOffer: 15200000,
    BrokerageType: 'PERCENT',
    BrokeragePercent: 1.5,
    Notes: 'Create negotiation test'
  });

  assert.equal(created.ok, true);
  assert.equal(created.data.Status, 'OPEN');
  assert.equal(created.data.BrokerageType, 'PERCENT');

  const duplicate = await runtime.createNegotiation({
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    TransactionID: fixture.transactionId,
    PropertyID: fixture.propertyId,
    MatchID: fixture.matchId,
    AskingPrice: 16000000
  });

  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, 'Duplicate active negotiation already exists for this lead/requirement/property/transaction');
});

test('negotiation action flow supports offer/counter/accept/agree/token/agreement/registration/complete', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  const fixture = await createFixture(runtime, '102');

  const created = await runtime.createNegotiation({
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    TransactionID: fixture.transactionId,
    PropertyID: fixture.propertyId,
    MatchID: fixture.matchId,
    ShortlistID: fixture.shortlistId,
    SiteVisitID: fixture.siteVisitId,
    AskingPrice: 16000000,
    InitialOffer: 14900000,
    CurrentOffer: 14900000,
    BrokerageType: 'PERCENT',
    BrokeragePercent: 2,
    Notes: 'Flow test'
  });
  assert.equal(created.ok, true);

  const offer = await runtime.makeNegotiationOffer(created.data.NegotiationID, { currentOffer: 15100000, notes: 'Client offer' });
  assert.equal(offer.ok, true);
  assert.equal(offer.data.Status, 'OFFER_MADE');

  const counter = await runtime.makeNegotiationCounterOffer(created.data.NegotiationID, { counterOffer: 15400000, notes: 'Owner counter' });
  assert.equal(counter.ok, true);
  assert.equal(counter.data.Status, 'COUNTER_OFFER');

  const accepted = await runtime.acceptNegotiationOffer(created.data.NegotiationID, { agreedPrice: 15300000, notes: 'Accepted' });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.Status, 'AGREED');
  assert.equal(accepted.data.AgreedPrice, 15300000);
  assert.equal(accepted.data.BrokerageAmount, 306000);

  const agreed = await runtime.markNegotiationAgreed(created.data.NegotiationID, { agreedPrice: 15300000 });
  assert.equal(agreed.ok, true);
  assert.equal(agreed.data.Status, 'AGREED');

  const token = await runtime.recordNegotiationToken(created.data.NegotiationID, {
    tokenAmount: 500000,
    tokenDate: '2026-12-02',
    paymentTerms: 'Balance in 30 days'
  });
  assert.equal(token.ok, true);
  assert.equal(token.data.Status, 'TOKEN_RECEIVED');

  const agreement = await runtime.markNegotiationAgreement(created.data.NegotiationID, { agreementDate: '2026-12-05' });
  assert.equal(agreement.ok, true);
  assert.equal(agreement.data.Status, 'AGREEMENT_DONE');

  const registration = await runtime.markNegotiationRegistration(created.data.NegotiationID, { registrationDate: '2026-12-10' });
  assert.equal(registration.ok, true);
  assert.equal(registration.data.Status, 'REGISTRATION_PENDING');

  const completed = await runtime.completeNegotiation(created.data.NegotiationID, {});
  assert.equal(completed.ok, true);
  assert.equal(completed.data.Status, 'COMPLETED');
  assert.ok(completed.data.ClosedAt);
});

test('negotiation rejects invalid transitions and invalid financial values', async () => {
  const runtime = new SignatureRealtyRuntime(makeDbFile());
  const fixture = await createFixture(runtime, '103');

  const created = await runtime.createNegotiation({
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    TransactionID: fixture.transactionId,
    PropertyID: fixture.propertyId,
    MatchID: fixture.matchId,
    AskingPrice: 16000000,
    InitialOffer: 14900000,
    CurrentOffer: 14900000
  });
  assert.equal(created.ok, true);

  const invalidNegative = await runtime.updateNegotiation(created.data.NegotiationID, { tokenAmount: -1 });
  assert.equal(invalidNegative.ok, false);
  assert.equal(invalidNegative.error, 'TokenAmount cannot be negative');

  const invalidComplete = await runtime.completeNegotiation(created.data.NegotiationID, {});
  assert.equal(invalidComplete.ok, false);
  assert.equal(invalidComplete.error.includes('Status transition'), true);
});

test('negotiation supports hold/resume/reject/cancel and history persistence across restart', async () => {
  const dbFile = makeDbFile();
  const runtime = new SignatureRealtyRuntime(dbFile);
  const fixture = await createFixture(runtime, '104');

  const created = await runtime.createNegotiation({
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    TransactionID: fixture.transactionId,
    PropertyID: fixture.propertyId,
    MatchID: fixture.matchId,
    AskingPrice: 16000000,
    InitialOffer: 15000000,
    CurrentOffer: 15000000,
    Notes: 'History test'
  });
  assert.equal(created.ok, true);

  const hold = await runtime.holdNegotiation(created.data.NegotiationID, { notes: 'Pending document' });
  assert.equal(hold.ok, true);
  assert.equal(hold.data.Status, 'ON_HOLD');

  const resume = await runtime.resumeNegotiation(created.data.NegotiationID, { resumeTo: 'NEGOTIATING', notes: 'Document received' });
  assert.equal(resume.ok, true);
  assert.equal(resume.data.Status, 'NEGOTIATING');

  const reject = await runtime.rejectNegotiationOffer(created.data.NegotiationID, { notes: 'Client withdrew' });
  assert.equal(reject.ok, true);
  assert.equal(reject.data.Status, 'FAILED');

  const cancelled = await runtime.cancelNegotiation(created.data.NegotiationID, { notes: 'Closing out' });
  assert.equal(cancelled.ok, false);

  const restarted = new SignatureRealtyRuntime(dbFile);
  const history = await restarted.getNegotiationHistory(created.data.NegotiationID);
  assert.equal(history.ok, true);
  assert.ok(history.data.length >= 4);
  assert.ok(history.data.some((item) => item.Action === 'NEGOTIATION_CREATED'));
  assert.ok(history.data.some((item) => item.Action === 'STATUS_CHANGED'));
});
