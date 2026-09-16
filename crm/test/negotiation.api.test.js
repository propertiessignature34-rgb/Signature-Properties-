const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { apiFetchAuth } = require('./admin-test-utils');

const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-negotiation-api-')), 'sig-realty-db.json');
let PORT = 0;
let BASE_URL = '';
let serverProcess;
const apiFetch = (url, options = {}) => apiFetchAuth(url, { useDefaultAuth: true, ...options });

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close((error) => {
        if (error) return reject(error);
        if (!port) return reject(new Error('Could not allocate free port'));
        resolve(port);
      });
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (serverProcess && serverProcess.exitCode !== null) {
      throw new Error(`Server exited early with code ${serverProcess.exitCode}`);
    }

    try {
      const response = await apiFetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000), useDefaultAuth: false });
      if (response.ok) {
        return;
      }
    } catch {
      await delay(150);
    }
  }

  throw new Error(`Negotiation API server did not start at ${BASE_URL}`);
}

async function requestJson(pathname, options = {}) {
  const response = await apiFetch(`${BASE_URL}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(5000),
    ...options
  });

  const body = await response.json();
  return { response, body };
}

async function buildFixture() {
  const lead = await requestJson('/api/leads', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Negotiation API Lead',
      city: 'Bengaluru',
      phone: '+91 9000010001',
      email: 'negotiation.api.lead@example.com',
      leadStatus: 'New',
      assignedAgentId: 'USR-0001'
    })
  });
  assert.equal(lead.response.ok, true);

  const requirement = await requestJson('/api/requirements', {
    method: 'POST',
    body: JSON.stringify({
      leadId: lead.body.data.LeadID,
      transactionId: 'TXN-NEG-API-001',
      transactionType: 'Purchase',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      budgetMin: 10000000,
      budgetMax: 20000000,
      location1: 'Neg API City',
      location2: 'Neg API East',
      location3: 'Neg API District',
      bhkMin: 2,
      bhkMax: 3,
      areaMin: 1200,
      areaMax: 1700,
      possession: 'Ready',
      urgency: 'High',
      specialNotes: 'Negotiation API fixture',
      formType: 'residential'
    })
  });
  assert.equal(requirement.response.ok, true);

  const inventory = await requestJson('/api/inventory', {
    method: 'POST',
    body: JSON.stringify({
      transactionType: 'Sale',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      project: 'Negotiation API Crest',
      location: 'Neg API City',
      city: 'Bengaluru',
      bhk: 3,
      area: 1450,
      price: 15500000,
      possession: 'Ready',
      status: 'Available',
      ownerId: 'OWN-NEG-API',
      brokerId: 'BRO-NEG-API',
      builderId: 'BUIL-NEG-API'
    })
  });
  assert.equal(inventory.response.ok, true);

  const run = await requestJson('/api/matching/run', {
    method: 'POST',
    body: JSON.stringify({ requirementId: requirement.body.data.RequirementID })
  });
  assert.equal(run.response.ok, true);
  const match = run.body.data.matches.find((item) => item.PropertyID === inventory.body.data.PropertyID);
  assert.ok(match);

  const shortlist = await requestJson('/api/shortlist', {
    method: 'POST',
    body: JSON.stringify({
      requirementId: requirement.body.data.RequirementID,
      propertyId: inventory.body.data.PropertyID,
      matchId: match.MatchID,
      priority: 'High',
      notes: 'Negotiation API shortlist'
    })
  });
  assert.equal(shortlist.response.ok, true);

  const visit = await requestJson('/api/site-visits', {
    method: 'POST',
    body: JSON.stringify({
      leadId: lead.body.data.LeadID,
      requirementId: requirement.body.data.RequirementID,
      propertyId: inventory.body.data.PropertyID,
      matchId: match.MatchID,
      shortlistId: shortlist.body.data.ShortlistID,
      visitDate: '2026-12-05',
      visitTime: '11:15',
      duration: '90 mins',
      meetingPoint: 'Lobby',
      assignedAgentId: 'USR-0001',
      clientName: 'Negotiation API Lead',
      clientPhone: '+91 9000010001'
    })
  });
  assert.equal(visit.response.ok, true);

  return {
    leadId: lead.body.data.LeadID,
    requirementId: requirement.body.data.RequirementID,
    transactionId: requirement.body.data.TransactionID,
    propertyId: inventory.body.data.PropertyID,
    matchId: match.MatchID,
    shortlistId: shortlist.body.data.ShortlistID,
    siteVisitId: visit.body.data.VisitID
  };
}

test.before(async () => {
  PORT = await findFreePort();
  BASE_URL = `http://127.0.0.1:${PORT}`;

  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), SIG_REALTY_DB_FILE: DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.setEncoding('utf8');
  serverProcess.stderr.setEncoding('utf8');

  await waitForServer();
});

test.after(async () => {
  if (!serverProcess) return;
  if (serverProcess.exitCode === null && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await delay(300);
  }
});

test('negotiation API supports create/read/update/actions/history and restart persistence', async () => {
  const fixture = await buildFixture();

  const created = await requestJson('/api/negotiations', {
    method: 'POST',
    body: JSON.stringify({
      leadId: fixture.leadId,
      requirementId: fixture.requirementId,
      transactionId: fixture.transactionId,
      propertyId: fixture.propertyId,
      matchId: fixture.matchId,
      shortlistId: fixture.shortlistId,
      siteVisitId: fixture.siteVisitId,
      askingPrice: 15500000,
      initialOffer: 14900000,
      currentOffer: 15100000,
      brokerageType: 'PERCENT',
      brokeragePercent: 2,
      notes: 'Negotiation API create'
    })
  });

  assert.equal(created.response.ok, true);
  assert.equal(created.body.ok, true);
  const negotiationId = created.body.data.NegotiationID;

  const duplicate = await requestJson('/api/negotiations', {
    method: 'POST',
    body: JSON.stringify({
      leadId: fixture.leadId,
      requirementId: fixture.requirementId,
      transactionId: fixture.transactionId,
      propertyId: fixture.propertyId,
      matchId: fixture.matchId,
      askingPrice: 15500000
    })
  });
  assert.equal(duplicate.response.ok, false);

  const byId = await requestJson(`/api/negotiations/${negotiationId}`);
  assert.equal(byId.response.ok, true);
  assert.equal(byId.body.data.NegotiationID, negotiationId);

  const patched = await requestJson(`/api/negotiations/${negotiationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ notes: 'Updated note' })
  });
  assert.equal(patched.response.ok, true);

  const offer = await requestJson(`/api/negotiations/${negotiationId}/offer`, {
    method: 'POST',
    body: JSON.stringify({ currentOffer: 15200000, notes: 'Offer made' })
  });
  assert.equal(offer.response.ok, true);
  assert.equal(offer.body.data.Status, 'OFFER_MADE');

  const counter = await requestJson(`/api/negotiations/${negotiationId}/counter`, {
    method: 'POST',
    body: JSON.stringify({ counterOffer: 15400000 })
  });
  assert.equal(counter.response.ok, true);
  assert.equal(counter.body.data.Status, 'COUNTER_OFFER');

  const accepted = await requestJson(`/api/negotiations/${negotiationId}/accept`, {
    method: 'POST',
    body: JSON.stringify({ agreedPrice: 15350000 })
  });
  assert.equal(accepted.response.ok, true);
  assert.equal(accepted.body.data.Status, 'AGREED');

  const agreed = await requestJson(`/api/negotiations/${negotiationId}/agree`, {
    method: 'POST',
    body: JSON.stringify({ agreedPrice: 15350000 })
  });
  assert.equal(agreed.response.ok, true);

  const token = await requestJson(`/api/negotiations/${negotiationId}/token`, {
    method: 'POST',
    body: JSON.stringify({ tokenAmount: 500000, tokenDate: '2026-12-06', paymentTerms: 'Balance in 30 days' })
  });
  assert.equal(token.response.ok, true);
  assert.equal(token.body.data.Status, 'TOKEN_RECEIVED');

  const agreement = await requestJson(`/api/negotiations/${negotiationId}/agreement`, {
    method: 'POST',
    body: JSON.stringify({ agreementDate: '2026-12-08' })
  });
  assert.equal(agreement.response.ok, true);
  assert.equal(agreement.body.data.Status, 'AGREEMENT_DONE');

  const registration = await requestJson(`/api/negotiations/${negotiationId}/registration`, {
    method: 'POST',
    body: JSON.stringify({ registrationDate: '2026-12-12' })
  });
  assert.equal(registration.response.ok, true);
  assert.equal(registration.body.data.Status, 'REGISTRATION_PENDING');

  const completed = await requestJson(`/api/negotiations/${negotiationId}/complete`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(completed.response.ok, true);
  assert.equal(completed.body.data.Status, 'COMPLETED');

  const invalidTransition = await requestJson(`/api/negotiations/${negotiationId}/offer`, {
    method: 'POST',
    body: JSON.stringify({ currentOffer: 15500000 })
  });
  assert.equal(invalidTransition.response.ok, false);

  const history = await requestJson(`/api/negotiations/${negotiationId}/history`);
  assert.equal(history.response.ok, true);
  assert.ok(history.body.data.length >= 6);

  serverProcess.kill('SIGTERM');
  await delay(700);

  PORT = await findFreePort();
  BASE_URL = `http://127.0.0.1:${PORT}`;
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), SIG_REALTY_DB_FILE: DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stdout.setEncoding('utf8');
  serverProcess.stderr.setEncoding('utf8');
  await waitForServer();

  const afterRestart = await requestJson(`/api/negotiations/${negotiationId}`);
  assert.equal(afterRestart.response.ok, true);
  assert.equal(afterRestart.body.data.Status, 'COMPLETED');

  const historyAfterRestart = await requestJson(`/api/negotiations/${negotiationId}/history`);
  assert.equal(historyAfterRestart.response.ok, true);
  assert.equal(historyAfterRestart.body.data.length, history.body.data.length);
});
