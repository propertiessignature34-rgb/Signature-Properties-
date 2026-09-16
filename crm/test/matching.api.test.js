const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { apiFetchAuth } = require('./admin-test-utils');

const PORT = 4180;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-matching-api-')), 'sig-realty-db.json');
const apiFetch = (url, options = {}) => apiFetchAuth(url, { useDefaultAuth: true, ...options });

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await apiFetch(`${BASE_URL}/health`, { useDefaultAuth: false });
      if (response.ok) {
        return;
      }
    } catch (error) {
      await delay(200);
    }
  }
  throw new Error(`Server did not start at ${BASE_URL}`);
}

async function requestJson(pathname, options = {}) {
  const response = await apiFetch(`${BASE_URL}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  return { response, data };
}

let serverProcess;

test.before(async () => {
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
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
});

test('matching HTTP API runs, persists, and reuses the same match record', async () => {
  const lead = await requestJson('/api/leads', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'API Match Lead',
      city: 'Bengaluru',
      phone: '+91 9000000101',
      email: 'api.match.lead@example.com',
      leadStatus: 'New',
      assignedAgentId: 'USR-0001'
    })
  });
  assert.equal(lead.response.ok, true);

  const requirement = await requestJson('/api/requirements', {
    method: 'POST',
    body: JSON.stringify({
      leadId: lead.data.data.LeadID,
      transactionId: 'TXN-API-001',
      transactionType: 'Purchase',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      budgetMin: 10000000,
      budgetMax: 20000000,
      location1: 'Bengaluru East',
      location2: 'Whitefield',
      location3: 'ITPL',
      bhkMin: 2,
      bhkMax: 3,
      areaMin: 1300,
      areaMax: 1700,
      possession: 'Ready',
      urgency: 'High',
      specialNotes: 'API match verification',
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
      project: 'API Crest',
      location: 'Bengaluru East',
      city: 'Bengaluru',
      bhk: 3,
      area: 1450,
      price: 15000000,
      possession: 'Ready',
      status: 'Available',
      ownerId: 'OWN-API',
      brokerId: 'BRO-API',
      builderId: 'BUIL-API'
    })
  });
  assert.equal(inventory.response.ok, true);

  const run = await requestJson('/api/matching/run', {
    method: 'POST',
    body: JSON.stringify({ requirementId: requirement.data.data.RequirementID })
  });
  assert.equal(run.response.ok, true);
  assert.equal(run.data.ok, true);
  assert.ok(run.data.data.total >= 1);
  assert.ok(run.data.data.matches.some((item) => item.PropertyID === inventory.data.data.PropertyID));

  const matches = await requestJson(`/api/requirements/${requirement.data.data.RequirementID}/matches`);
  assert.equal(matches.response.ok, true);
  assert.equal(matches.data.ok, true);
  assert.ok(matches.data.data.matches.length >= 1);

  const firstMatch = matches.data.data.matches.find((item) => item.PropertyID === inventory.data.data.PropertyID);
  assert.ok(firstMatch);
  assert.equal(firstMatch.MatchLevel, 'Excellent');
  assert.equal(firstMatch.ScoreBreakdown.transaction.status, 'matched');
  assert.equal(firstMatch.ScoreBreakdown.location.status, 'matched');
  assert.equal(firstMatch.ScoreBreakdown.budget.status, 'matched');
  assert.ok(firstMatch.ScoreBreakdown.area.score >= 0);

  const byId = await requestJson(`/api/matches/${firstMatch.MatchID}`);
  assert.equal(byId.response.ok, true);
  assert.equal(byId.data.ok, true);
  assert.equal(byId.data.data.MatchID, firstMatch.MatchID);

  const runAgain = await requestJson('/api/matching/run', {
    method: 'POST',
    body: JSON.stringify({ requirementId: requirement.data.data.RequirementID })
  });
  assert.equal(runAgain.response.ok, true);
  assert.equal(runAgain.data.ok, true);

  const matchesAgain = await requestJson(`/api/requirements/${requirement.data.data.RequirementID}/matches`);
  const deduped = matchesAgain.data.data.matches.filter((item) => item.PropertyID === inventory.data.data.PropertyID);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].MatchID, firstMatch.MatchID);
});
