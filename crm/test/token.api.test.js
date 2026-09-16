const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { apiFetchAuth } = require('./admin-test-utils');

const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-token-api-')), 'sig-realty-db.json');
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

  throw new Error(`Token API server did not start at ${BASE_URL}`);
}

async function requestJson(method, route, payload) {
  const response = await apiFetch(`${BASE_URL}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
    body: payload ? JSON.stringify(payload) : undefined
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { status: response.status, body };
}

async function createNegotiationFixture(suffix = 'A01') {
  const lead = await requestJson('POST', '/api/leads', {
    clientName: `Token API Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 9333300${suffix}`,
    email: `token.api.${suffix}@example.com`,
    leadStatus: 'Active',
    assignedAgentId: 'USR-0001'
  });
  assert.equal(lead.status >= 200 && lead.status < 300, true);

  const requirement = await requestJson('POST', '/api/requirements', {
    leadId: lead.body.data.LeadID,
    transactionId: `TXN-TOKEN-API-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 20000000,
    location1: `Token API Location ${suffix}`,
    location2: `Token API East ${suffix}`,
    location3: `Token API District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1200,
    areaMax: 1800,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Token API fixture',
    formType: 'residential'
  });
  assert.equal(requirement.status >= 200 && requirement.status < 300, true);

  const property = await requestJson('POST', '/api/inventory', {
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `Token API Project ${suffix}`,
    location: `Token API Location ${suffix}`,
    city: 'Bengaluru',
    bhk: 3,
    area: 1550,
    price: 16000000,
    possession: 'Ready',
    status: 'Available'
  });
  assert.equal(property.status >= 200 && property.status < 300, true);

  const run = await requestJson('POST', '/api/matching/run', {
    requirementId: requirement.body.data.RequirementID
  });
  assert.equal(run.status >= 200 && run.status < 300, true);
  const match = run.body.data.matches.find((item) => item.PropertyID === property.body.data.PropertyID);
  assert.ok(match);

  const negotiation = await requestJson('POST', '/api/negotiations', {
    LeadID: lead.body.data.LeadID,
    RequirementID: requirement.body.data.RequirementID,
    TransactionID: requirement.body.data.TransactionID,
    PropertyID: property.body.data.PropertyID,
    MatchID: match.MatchID,
    AskingPrice: 16000000,
    CurrentOffer: 15800000,
    AgreedPrice: 15800000,
    Status: 'AGREED',
    Notes: 'Token API negotiation fixture'
  });
  assert.equal(negotiation.status >= 200 && negotiation.status < 300, true);

  return {
    leadId: lead.body.data.LeadID,
    requirementId: requirement.body.data.RequirementID,
    propertyId: property.body.data.PropertyID,
    negotiationId: negotiation.body.data.NegotiationID
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
  if (serverProcess && serverProcess.exitCode === null && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await delay(300);
  }
  if (fs.existsSync(DB_FILE)) {
    fs.unlinkSync(DB_FILE);
  }
});

test('POST /api/tokens creates token and GET /api/tokens lists it', async () => {
  const fixture = await createNegotiationFixture('201');

  const created = await requestJson('POST', '/api/tokens', {
    NegotiationID: fixture.negotiationId,
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    TokenAmount: 600000,
    PaidAmount: 250000,
    PaymentMode: 'NEFT',
    Reference: 'TOK-API-201',
    Status: 'PENDING'
  });

  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true);
  assert.ok(created.body.data.TokenID);

  const listed = await requestJson('GET', '/api/tokens');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.ok, true);
  assert.ok(Array.isArray(listed.body.data));
  assert.ok(listed.body.data.some((item) => item.TokenID === created.body.data.TokenID));
});

test('POST /api/tokens returns 400 for missing fields and invalid status', async () => {
  const missing = await requestJson('POST', '/api/tokens', {
    LeadID: 'LEAD-MISSING',
    RequirementID: 'REQ-MISSING',
    PropertyID: 'PROP-MISSING'
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.ok, false);
  assert.equal(missing.body.error, 'Missing required token fields');

  const fixture = await createNegotiationFixture('202');
  const invalid = await requestJson('POST', '/api/tokens', {
    NegotiationID: fixture.negotiationId,
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    TokenAmount: 700000,
    Status: 'REQUESTED'
  });

  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.ok, false);
  assert.equal(invalid.body.error, 'Invalid token status');
});

test('POST /api/tokens blocks duplicate active tokens for same requirement and property', async () => {
  const fixture = await createNegotiationFixture('203');

  const first = await requestJson('POST', '/api/tokens', {
    NegotiationID: fixture.negotiationId,
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    TokenAmount: 500000,
    Status: 'PENDING'
  });
  assert.equal(first.status, 200);

  const duplicate = await requestJson('POST', '/api/tokens', {
    NegotiationID: fixture.negotiationId,
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    TokenAmount: 550000,
    Status: 'PAID'
  });

  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.ok, false);
  assert.equal(duplicate.body.error, 'Duplicate active token already exists for this requirement and property');

  await delay(10);
  const listed = await requestJson('GET', '/api/tokens');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.filter((item) => item.RequirementID === fixture.requirementId && item.PropertyID === fixture.propertyId).length, 1);
});
