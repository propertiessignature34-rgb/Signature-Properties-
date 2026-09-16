'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');

const { JsonRepository } = require('../src/data/repository');
const { V2Router } = require('../src/api/v2Router');
const { SignatureRealtyRuntime } = require('../src/runtime/app');
const { V2LeadService } = require('../src/services/v2LeadService');
const { V2TransactionService } = require('../src/services/v2TransactionService');
const { V2RequirementService } = require('../src/services/v2RequirementService');
const { V2FollowUpService } = require('../src/services/v2FollowUpService');
const { V2ActivityService } = require('../src/services/v2ActivityService');
const { SiteVisitBookingService } = require('../src/services/siteVisitBookingService');
const { STATIC_CLIENT_SCORING_RULES } = require('../src/data/v2ScoringConfig');
const { __test: serverTest } = require('../server');

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-lead-p0p1-'));
  return path.join(dir, 'sig-realty-db.json');
}

const OWNER = { userId: 'USR-OWNER', role: 'AGENT', companyId: 'COMP-A', brokerageId: 'BRK-A' };
const SAME_TENANT_OTHER = { userId: 'USR-SAME', role: 'AGENT', companyId: 'COMP-A', brokerageId: 'BRK-A' };
const MANAGER = { userId: 'USR-MGR', role: 'MANAGER', companyId: 'COMP-A', brokerageId: 'BRK-A' };
const OTHER_TENANT = { userId: 'USR-OTHER', role: 'AGENT', companyId: 'COMP-B', brokerageId: 'BRK-B' };

function actorHeaders(actor) {
  return {
    'x-user-id': actor.userId,
    'x-user-role': actor.role,
    'x-company-id': actor.companyId,
    'x-brokerage-id': actor.brokerageId
  };
}

function seedUser(repository, actor, extra = {}) {
  const db = repository.read();
  db.Users = db.Users || [];
  db.Users.push({
    UserID: actor.userId,
    Name: actor.userId,
    Email: `${actor.userId.toLowerCase()}@example.com`,
    Mobile: '+910000000000',
    Role: actor.role,
    Status: 'Active',
    Permissions: extra.permissions || [],
    CompanyID: actor.companyId,
    BrokerageID: actor.brokerageId,
    CreatedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString()
  });
  repository.write(db);
}

function makeRequest(pathname, { method = 'GET', headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [JSON.stringify(body)];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = pathname;
  req.headers = { host: '127.0.0.1', ...headers };
  if (body !== undefined && !req.headers['content-type']) req.headers['content-type'] = 'application/json';
  return req;
}

function makeResponse() {
  let statusCode = null;
  let responseHeaders = {};
  const chunks = [];
  let resolveEnd;
  const ended = new Promise((resolve) => { resolveEnd = resolve; });
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      callback();
    }
  });
  res.writeHead = (code, headers = {}) => {
    statusCode = code;
    responseHeaders = headers;
  };
  res.end = (chunk) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    resolveEnd();
  };
  return {
    res,
    ended,
    snapshot() {
      const bodyBuffer = Buffer.concat(chunks);
      return {
        statusCode,
        headers: responseHeaders,
        payload: bodyBuffer.length ? JSON.parse(bodyBuffer.toString('utf8')) : null
      };
    }
  };
}

function makeRuntime(dbFile) {
  const runtime = new SignatureRealtyRuntime(dbFile);
  runtime.resolveAuthenticatedActor = (request = {}) => {
    const headers = request.headers || {};
    const userId = String(headers['x-user-id'] || '').trim();
    if (!userId) return { ok: false, statusCode: 401, error: 'Unauthorized' };
    const user = runtime.repository.getUser(userId);
    if (!user) return { ok: false, statusCode: 401, error: 'Unauthorized' };
    return {
      ok: true,
      actor: {
        userId: user.UserID,
        userID: user.UserID,
        role: String(headers['x-user-role'] || user.Role || 'AGENT').trim().toUpperCase(),
        companyId: String(headers['x-company-id'] || user.CompanyID || '').trim(),
        brokerageId: String(headers['x-brokerage-id'] || user.BrokerageID || '').trim(),
        permissions: Array.isArray(user.Permissions) ? user.Permissions : [],
        user
      }
    };
  };
  return runtime;
}

async function callApi(runtime, pathname, options = {}) {
  const v2Router = new V2Router(runtime.repository, (req) => {
    const auth = runtime.resolveAuthenticatedActor({ headers: req.headers || {} });
    return auth.ok ? auth.actor : null;
  });
  serverTest.setRuntimeForTest(runtime, v2Router);
  const req = makeRequest(pathname, options);
  const response = makeResponse();
  let thrown = null;
  try {
    await serverTest.handleApi(req, response.res, new URL(req.url, `http://${req.headers.host}`));
  } catch (error) {
    thrown = error;
    response.res.end();
  } finally {
    serverTest.setRuntimeForTest(null);
  }
  await response.ended;
  if (thrown) throw thrown;
  return response.snapshot();
}

function seedFixture() {
  const dbFile = makeTempDb();
  const repository = new JsonRepository(dbFile);
  seedUser(repository, OWNER);
  seedUser(repository, SAME_TENANT_OTHER);
  seedUser(repository, MANAGER);
  seedUser(repository, OTHER_TENANT);

  const leadSvc = new V2LeadService(repository);
  const txnSvc = new V2TransactionService(repository);
  const reqSvc = new V2RequirementService(repository);

  const lead = leadSvc.createLead({
    ClientName: 'Owner Lead',
    PrimaryMobile: '9990000001',
    Email: 'owner.lead@example.com',
    City: 'Surat',
    ClientStatus: 'Negotiation',
    AssignedAgentID: OWNER.userId
  }, OWNER).data;

  const transaction = txnSvc.createTransaction(lead.LeadID, {
    TransactionType: 'Purchase'
  }, OWNER).data;

  const requirement = reqSvc.createRequirement(transaction.TransactionID, {
    Category: 'Residential',
    PropertyType: 'Apartment',
    SubCategory: 'Apartment',
    Location1: 'Vesu',
    BudgetMin: 10000000,
    BudgetMax: 15000000,
    BHKMin: 2,
    BHKMax: 3,
    FormType: 'residential'
  }, OWNER).data;

  repository.create('Inventory', {
    PropertyID: 'PROP-A',
    TransactionType: 'Purchase',
    Category: 'Residential',
    PropertyType: 'Apartment',
    Project: 'Visible Tower',
    Location: 'Vesu',
    City: 'Surat',
    BHK: 3,
    Area: 1450,
    Price: 14000000,
    Status: 'Available',
    CompanyID: OWNER.companyId,
    BrokerageID: OWNER.brokerageId
  });
  repository.create('Inventory', {
    PropertyID: 'PROP-B',
    TransactionType: 'Purchase',
    Category: 'Residential',
    PropertyType: 'Apartment',
    Project: 'Hidden Tower',
    Location: 'Vesu',
    City: 'Surat',
    BHK: 3,
    Area: 1500,
    Price: 14500000,
    Status: 'Available',
    CompanyID: OTHER_TENANT.companyId,
    BrokerageID: OTHER_TENANT.brokerageId
  });

  repository.createMatch({
    MatchID: 'MATCH-A',
    RequirementID: requirement.RequirementID,
    PropertyID: 'PROP-A',
    LeadID: lead.LeadID,
    Score: 91,
    MatchLevel: 'Strong',
    Status: 'Active'
  });
  repository.createMatch({
    MatchID: 'MATCH-B',
    RequirementID: requirement.RequirementID,
    PropertyID: 'PROP-B',
    LeadID: lead.LeadID,
    Score: 90,
    MatchLevel: 'Strong',
    Status: 'Active'
  });

  repository.createDocument({
    DocumentID: 'DOC-LEAD',
    EntityType: 'Lead',
    EntityID: lead.LeadID,
    CompanyID: OWNER.companyId,
    BrokerageID: OWNER.brokerageId,
    DocumentType: 'OTHER',
    Title: 'Lead note',
    StorageProvider: 'TEST_PROVIDER',
    StoragePath: '/tmp/lead.pdf',
    MimeType: 'application/pdf',
    SizeBytes: 1,
    Visibility: 'BROKER',
    UploadedBy: OWNER.userId
  });
  repository.createDocument({
    DocumentID: 'DOC-REQ',
    EntityType: 'Requirement',
    EntityID: requirement.RequirementID,
    CompanyID: OWNER.companyId,
    BrokerageID: OWNER.brokerageId,
    DocumentType: 'OTHER',
    Title: 'Requirement note',
    StorageProvider: 'TEST_PROVIDER',
    StoragePath: '/tmp/req.pdf',
    MimeType: 'application/pdf',
    SizeBytes: 1,
    Visibility: 'BROKER',
    UploadedBy: OWNER.userId
  });
  repository.createDocument({
    DocumentID: 'DOC-TXN',
    EntityType: 'Transaction',
    EntityID: transaction.TransactionID,
    CompanyID: OWNER.companyId,
    BrokerageID: OWNER.brokerageId,
    DocumentType: 'OTHER',
    Title: 'Transaction note',
    StorageProvider: 'TEST_PROVIDER',
    StoragePath: '/tmp/txn.pdf',
    MimeType: 'application/pdf',
    SizeBytes: 1,
    Visibility: 'BROKER',
    UploadedBy: OWNER.userId
  });

  return { dbFile, repository, lead, transaction, requirement };
}

test('v2 client reads require auth and enforce tenant plus ownership', async () => {
  const { dbFile, lead } = seedFixture();
  const runtime = makeRuntime(dbFile);

  const unauthenticated = await callApi(runtime, '/api/v2/clients');
  assert.equal(unauthenticated.statusCode, 401);

  const ownerList = await callApi(runtime, '/api/v2/clients', { headers: actorHeaders(OWNER) });
  assert.equal(ownerList.statusCode, 200);
  assert.equal(ownerList.payload.count, 1);
  assert.equal(ownerList.payload.data[0].LeadID, lead.LeadID);

  const ownerDetail = await callApi(runtime, `/api/v2/clients/${lead.LeadID}`, { headers: actorHeaders(OWNER) });
  assert.equal(ownerDetail.statusCode, 200);

  const teammateDenied = await callApi(runtime, `/api/v2/clients/${lead.LeadID}`, { headers: actorHeaders(SAME_TENANT_OTHER) });
  assert.equal(teammateDenied.statusCode, 404);

  const wrongTenantDenied = await callApi(runtime, `/api/v2/clients/${lead.LeadID}`, { headers: actorHeaders(OTHER_TENANT) });
  assert.equal(wrongTenantDenied.statusCode, 404);

  const managerAllowed = await callApi(runtime, `/api/v2/clients/${lead.LeadID}`, { headers: actorHeaders(MANAGER) });
  assert.equal(managerAllowed.statusCode, 200);
});

test('workspace document loading stays scoped and missing legacy arrays do not crash', async () => {
  const { dbFile, repository, lead } = seedFixture();
  const db = repository.read();
  db.Activities = null;
  db.Timeline = null;
  db.Shortlists = null;
  db.SiteVisits = null;
  db.Payments = null;
  repository.write(db);

  const runtime = makeRuntime(dbFile);
  const allowed = await callApi(runtime, `/api/v2/clients/${lead.LeadID}/workspace`, { headers: actorHeaders(OWNER) });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.payload.data.documents.length, 3);
  assert.deepEqual(allowed.payload.data.documents.map((row) => row.DocumentID).sort(), ['DOC-LEAD', 'DOC-REQ', 'DOC-TXN']);
  assert.ok(Array.isArray(allowed.payload.data.activities));
  assert.ok(Array.isArray(allowed.payload.data.timeline));
  assert.ok(Array.isArray(allowed.payload.data.shortlist));
  assert.ok(Array.isArray(allowed.payload.data.siteVisits));
  assert.ok(Array.isArray(allowed.payload.data.payments));

  const denied = await callApi(runtime, `/api/v2/clients/${lead.LeadID}/workspace`, { headers: actorHeaders(OTHER_TENANT) });
  assert.equal(denied.statusCode, 404);
});

test('matching run enforces requirement access and filters inaccessible properties', async () => {
  const { dbFile, requirement } = seedFixture();
  const runtime = makeRuntime(dbFile);

  const owner = await callApi(runtime, '/api/matching/run', {
    method: 'POST',
    headers: actorHeaders(OWNER),
    body: { requirementId: requirement.RequirementID }
  });
  assert.equal(owner.statusCode, 200);
  assert.equal(owner.payload.data.matches.length, 1);
  assert.equal(owner.payload.data.matches[0].PropertyID, 'PROP-A');

  const teammateDenied = await callApi(runtime, '/api/matching/run', {
    method: 'POST',
    headers: actorHeaders(SAME_TENANT_OTHER),
    body: { requirementId: requirement.RequirementID }
  });
  assert.equal(teammateDenied.statusCode, 404);

  const wrongTenantDenied = await callApi(runtime, '/api/matching/run', {
    method: 'POST',
    headers: actorHeaders(OTHER_TENANT),
    body: { requirementId: requirement.RequirementID }
  });
  assert.equal(wrongTenantDenied.statusCode, 404);
});

test('shortlist endpoints block IDOR across tenant and ownership boundaries', async () => {
  const { dbFile, requirement } = seedFixture();
  const runtime = makeRuntime(dbFile);

  const crossTenantProperty = await callApi(runtime, '/api/shortlist', {
    method: 'POST',
    headers: actorHeaders(OWNER),
    body: { requirementId: requirement.RequirementID, propertyId: 'PROP-B', matchId: 'MATCH-B', priority: 'High' }
  });
  assert.equal(crossTenantProperty.statusCode, 404);

  const created = await callApi(runtime, '/api/shortlist', {
    method: 'POST',
    headers: actorHeaders(OWNER),
    body: { requirementId: requirement.RequirementID, propertyId: 'PROP-A', matchId: 'MATCH-A', priority: 'High' }
  });
  assert.equal(created.statusCode, 200);
  const shortlistId = created.payload.data.ShortlistID;

  const ownerRead = await callApi(runtime, `/api/shortlist/${shortlistId}`, { headers: actorHeaders(OWNER) });
  assert.equal(ownerRead.statusCode, 200);

  const teammateDenied = await callApi(runtime, `/api/shortlist/${shortlistId}`, { headers: actorHeaders(SAME_TENANT_OTHER) });
  assert.equal(teammateDenied.statusCode, 404);

  const wrongTenantDenied = await callApi(runtime, `/api/shortlist/${shortlistId}`, { headers: actorHeaders(OTHER_TENANT) });
  assert.equal(wrongTenantDenied.statusCode, 404);
});

test('site visit bookings reject duplicates, allow legitimate repeats after completion, and refresh from canonical rows', async () => {
  const { dbFile, requirement } = seedFixture();
  const runtime = makeRuntime(dbFile);

  const created = await callApi(runtime, '/api/v2/site-visit-bookings', {
    method: 'POST',
    headers: actorHeaders(OWNER),
    body: { requirementId: requirement.RequirementID, propertyIds: ['PROP-A'], visitDate: '2026-10-02', visitTime: '11:00', notes: 'first visit' }
  });
  assert.equal(created.statusCode, 201);
  const bookingId = created.payload.data.VisitBookingID;

  const duplicate = await callApi(runtime, '/api/v2/site-visit-bookings', {
    method: 'POST',
    headers: actorHeaders(OWNER),
    body: { requirementId: requirement.RequirementID, propertyIds: ['PROP-A'], visitDate: '2026-10-02', visitTime: '11:00' }
  });
  assert.equal(duplicate.statusCode, 400);
  assert.equal(duplicate.payload.code, 'DUPLICATE_SITE_VISIT');

  const completed = await callApi(runtime, `/api/v2/site-visit-bookings/${bookingId}/complete`, {
    method: 'POST',
    headers: actorHeaders(OWNER)
  });
  assert.equal(completed.statusCode, 200);
  assert.equal(completed.payload.data.Status, 'Completed');

  const secondVisit = await callApi(runtime, '/api/v2/site-visit-bookings', {
    method: 'POST',
    headers: actorHeaders(OWNER),
    body: { requirementId: requirement.RequirementID, propertyIds: ['PROP-A'], visitDate: '2026-10-02', visitTime: '11:00', notes: 'repeat after completion' }
  });
  assert.equal(secondVisit.statusCode, 201);

  const cancelled = await callApi(runtime, `/api/v2/site-visit-bookings/${secondVisit.payload.data.VisitBookingID}/cancel`, {
    method: 'POST',
    headers: actorHeaders(OWNER)
  });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.payload.data.Status, 'Cancelled');

  const refreshed = await callApi(runtime, `/api/v2/site-visit-bookings?requirementId=${encodeURIComponent(requirement.RequirementID)}`, {
    headers: actorHeaders(OWNER)
  });
  assert.equal(refreshed.statusCode, 200);
  assert.equal(refreshed.payload.count, 2);
  assert.deepEqual(refreshed.payload.data.map((row) => row.Status).sort(), ['Cancelled', 'Completed']);

  const denied = await callApi(runtime, `/api/v2/site-visit-bookings/${bookingId}`, { headers: actorHeaders(OTHER_TENANT) });
  assert.equal(denied.statusCode, 404);
});

test('follow-up lifecycle emits deterministic artifacts without duplication', () => {
  const { repository, lead, requirement } = seedFixture();
  const svc = new V2FollowUpService(repository);

  const created = svc.createFollowUp({
    LeadID: lead.LeadID,
    RequirementID: requirement.RequirementID,
    ActivityType: 'CALL',
    DueAt: '2026-10-03T09:00:00.000Z',
    Notes: 'initial follow-up'
  }, OWNER);
  assert.equal(created.ok, true);

  let db = repository.read();
  assert.equal(db.Activities.filter((row) => row._transitionKey === `FOLLOWUP|${created.data.id}|SCHEDULED|2026-10-03T09:00:00.000Z`).length, 1);
  assert.equal(db.Timeline.filter((row) => row.Payload?._transitionKey === `FOLLOWUP|${created.data.id}|SCHEDULED|2026-10-03T09:00:00.000Z`).length, 1);

  const noOp = svc.updateFollowUp(created.data.id, { DueAt: '2026-10-03T09:00:00.000Z' }, OWNER);
  assert.equal(noOp.ok, true);
  db = repository.read();
  assert.equal(db.Activities.filter((row) => row.LeadID === lead.LeadID).length, 1);

  const rescheduled = svc.updateFollowUp(created.data.id, { DueAt: '2026-10-04T10:00:00.000Z' }, OWNER);
  assert.equal(rescheduled.ok, true);
  db = repository.read();
  assert.equal(db.Activities.filter((row) => row._transitionKey === `FOLLOWUP|${created.data.id}|RESCHEDULED|2026-10-03T09:00:00.000Z|2026-10-04T10:00:00.000Z`).length, 1);

  const completed = svc.completeFollowUp(created.data.id, OWNER);
  assert.equal(completed.ok, true);
  const repeatComplete = svc.completeFollowUp(created.data.id, OWNER);
  assert.equal(repeatComplete.ok, false);

  const cancelledSource = svc.createFollowUp({
    LeadID: lead.LeadID,
    RequirementID: requirement.RequirementID,
    ActivityType: 'WHATSAPP',
    DueAt: '2026-10-05T09:00:00.000Z'
  }, OWNER);
  const cancelled = svc.cancelFollowUp(cancelledSource.data.id, OWNER);
  assert.equal(cancelled.ok, true);

  db = repository.read();
  assert.equal(db.Timeline.filter((row) => row.EventType === 'FOLLOWUP_COMPLETED').length, 1);
  assert.equal(db.Timeline.filter((row) => row.EventType === 'FOLLOWUP_CANCELLED').length, 1);
});

test('activity dedupe keys prevent duplicate initiated interactions and allow later CRM enrichment', () => {
  const { repository, lead, requirement } = seedFixture();
  const svc = new V2ActivityService(repository);

  const created = svc.createActivity({
    LeadID: lead.LeadID,
    RequirementID: requirement.RequirementID,
    ActivityType: 'CALL',
    Summary: 'Call initiated',
    DedupKey: 'CALL|INIT|1'
  }, OWNER);
  assert.equal(created.ok, true);

  const deduped = svc.createActivity({
    LeadID: lead.LeadID,
    RequirementID: requirement.RequirementID,
    ActivityType: 'CALL',
    Summary: 'Call initiated',
    DedupKey: 'CALL|INIT|1'
  }, OWNER);
  assert.equal(deduped.ok, true);
  assert.equal(deduped.deduped, true);
  assert.equal(deduped.data.ActivityID, created.data.ActivityID);

  const updated = svc.updateActivity(created.data.ActivityID, {
    Outcome: 'CONNECTED',
    Notes: 'Client answered and requested brochure',
    FollowUpDate: '2026-10-06T09:00:00.000Z'
  }, OWNER);
  assert.equal(updated.ok, true);
  assert.equal(updated.data.Outcome, 'CONNECTED');
  assert.equal(updated.data.Notes, 'Client answered and requested brochure');

  const db = repository.read();
  assert.equal(db.Activities.filter((row) => row._eventKey === 'CALL|INIT|1').length, 1);
  assert.equal(db.Timeline.filter((row) => row.Payload?._eventKey === 'CALL|INIT|1').length, 1);
});

test('activity dedupe keys do not cross-dedupe different leads', () => {
  const { repository, lead, requirement } = seedFixture();
  const svc = new V2ActivityService(repository);
  const otherLead = new V2LeadService(repository).createLead({
    ClientName: 'Other Lead',
    PrimaryMobile: '9990000099',
    Email: 'other.lead@example.com',
    AssignedAgentID: OWNER.userId
  }, OWNER).data;
  const otherTxn = new V2TransactionService(repository).createTransaction(otherLead.LeadID, {
    TransactionType: 'Purchase'
  }, OWNER).data;
  const otherReq = new V2RequirementService(repository).createRequirement(otherTxn.TransactionID, {
    Category: 'Residential',
    PropertyType: 'Apartment',
    SubCategory: 'Apartment',
    Location1: 'Adajan',
    BudgetMin: 5000000,
    BudgetMax: 7000000,
    FormType: 'residential'
  }, OWNER).data;

  const first = svc.createActivity({
    LeadID: lead.LeadID,
    RequirementID: requirement.RequirementID,
    ActivityType: 'CALL',
    Summary: 'Lead one',
    DedupKey: 'SHARED-EVENT'
  }, OWNER);
  const second = svc.createActivity({
    LeadID: otherLead.LeadID,
    RequirementID: otherReq.RequirementID,
    ActivityType: 'CALL',
    Summary: 'Lead two',
    DedupKey: 'SHARED-EVENT'
  }, OWNER);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.data.ActivityID, second.data.ActivityID);
});

test('legacy tenant-less lead access falls back to owner tenant without cross-tenant leakage', async () => {
  const { dbFile, repository, lead } = seedFixture();
  const db = repository.read();
  const leadIndex = db.Leads.findIndex((row) => row.LeadID === lead.LeadID);
  db.Leads[leadIndex].CompanyID = null;
  db.Leads[leadIndex].BrokerageID = null;
  repository.write(db);

  const runtime = makeRuntime(dbFile);
  const owner = await callApi(runtime, `/api/v2/clients/${lead.LeadID}`, { headers: actorHeaders(OWNER) });
  assert.equal(owner.statusCode, 200);

  const wrongTenant = await callApi(runtime, `/api/v2/clients/${lead.LeadID}`, { headers: actorHeaders(OTHER_TENANT) });
  assert.equal(wrongTenant.statusCode, 404);

  const managerOtherTenant = await callApi(runtime, `/api/v2/clients/${lead.LeadID}`, {
    headers: actorHeaders({ ...OTHER_TENANT, role: 'MANAGER' })
  });
  assert.equal(managerOtherTenant.statusCode, 404);
});

test('won transition emits a single lead artifact and scoring rules accept canonical plus legacy statuses', () => {
  const { repository, lead } = seedFixture();
  const svc = new V2LeadService(repository);

  const won = svc.updateLead(lead.LeadID, { ClientStatus: 'Won' }, OWNER);
  assert.equal(won.ok, true);
  const repeatWon = svc.updateLead(lead.LeadID, { ClientStatus: 'Won' }, OWNER);
  assert.equal(repeatWon.ok, true);

  const db = repository.read();
  assert.equal(db.Activities.filter((row) => row._transitionKey === `${lead.LeadID}|Negotiation|Won`).length, 1);
  assert.equal(db.Timeline.filter((row) => row.EventType === 'LEAD_WON' && row.Payload?._transitionKey === `${lead.LeadID}|Negotiation|Won`).length, 1);

  const statusRule = STATIC_CLIENT_SCORING_RULES.find((row) => row.factorId === 'F-CLI-STATUS');
  assert.ok(statusRule);
  for (const status of ['New', 'Contacted', 'Follow-up', 'Qualified', 'Requirement Created', 'Site Visit', 'Negotiation', 'Won', 'Lost', 'Verified', 'Active', 'Inactive', 'Converted']) {
    assert.notEqual(statusRule.lookupMap[status], undefined, `Missing scoring mapping for ${status}`);
  }
});
