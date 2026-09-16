const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { apiFetchAuth } = require('./admin-test-utils');

const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-deal-api-')), 'sig-realty-db.json');
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

  throw new Error(`Deal API server did not start at ${BASE_URL}`);
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

async function createTokenFixture(suffix = 'A01') {
  const lead = await requestJson('POST', '/api/leads', {
    clientName: `Deal API Lead ${suffix}`,
    city: 'Bengaluru',
    phone: `+91 9555500${suffix}`,
    email: `deal.api.${suffix}@example.com`,
    leadStatus: 'Active',
    assignedAgentId: 'USR-0001'
  });
  assert.equal(lead.status >= 200 && lead.status < 300, true);

  const requirement = await requestJson('POST', '/api/requirements', {
    leadId: lead.body.data.LeadID,
    transactionId: `TXN-DEAL-API-${suffix}`,
    transactionType: 'Purchase',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 12000000,
    budgetMax: 22000000,
    location1: `Deal API Location ${suffix}`,
    location2: `Deal API East ${suffix}`,
    location3: `Deal API District ${suffix}`,
    bhkMin: 2,
    bhkMax: 3,
    areaMin: 1250,
    areaMax: 1800,
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Deal API fixture',
    formType: 'residential'
  });
  assert.equal(requirement.status >= 200 && requirement.status < 300, true);

  const property = await requestJson('POST', '/api/inventory', {
    transactionType: 'Sale',
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: `Deal API Project ${suffix}`,
    location: `Deal API Location ${suffix}`,
    city: 'Bengaluru',
    bhk: 3,
    area: 1480,
    price: 17000000,
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
    AskingPrice: 17000000,
    CurrentOffer: 16600000,
    AgreedPrice: 16600000,
    Status: 'AGREED',
    Notes: 'Deal API negotiation fixture'
  });
  assert.equal(negotiation.status >= 200 && negotiation.status < 300, true);

  const token = await requestJson('POST', '/api/tokens', {
    NegotiationID: negotiation.body.data.NegotiationID,
    LeadID: lead.body.data.LeadID,
    RequirementID: requirement.body.data.RequirementID,
    PropertyID: property.body.data.PropertyID,
    MatchID: match.MatchID,
    TokenAmount: 650000,
    Status: 'PENDING'
  });
  assert.equal(token.status, 200);

  return {
    leadId: lead.body.data.LeadID,
    requirementId: requirement.body.data.RequirementID,
    propertyId: property.body.data.PropertyID,
    negotiationId: negotiation.body.data.NegotiationID,
    tokenId: token.body.data.TokenID,
    agreedPrice: negotiation.body.data.AgreedPrice
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

test('POST /api/deals creates deal and GET /api/deals lists it', async () => {
  const fixture = await createTokenFixture('401');

  const created = await requestJson('POST', '/api/deals', {
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    NegotiationID: fixture.negotiationId,
    TokenID: fixture.tokenId,
    FinalPrice: fixture.agreedPrice,
    Brokerage: 330000,
    Buyer: fixture.leadId,
    Seller: 'Seller API 401',
    Status: 'OPEN',
    Notes: 'Deal API create'
  });

  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true);
  assert.ok(created.body.data.DealID);

  const listed = await requestJson('GET', '/api/deals');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.ok, true);
  assert.ok(Array.isArray(listed.body.data));
  assert.ok(listed.body.data.some((item) => item.DealID === created.body.data.DealID));
});

test('POST /api/deals returns 400 for missing required fields', async () => {
  const invalid = await requestJson('POST', '/api/deals', {
    LeadID: 'LEAD-MISSING',
    RequirementID: 'REQ-MISSING',
    PropertyID: 'PROP-MISSING',
    NegotiationID: 'NEG-MISSING'
  });

  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.ok, false);
  assert.equal(invalid.body.error, 'Missing required deal fields');
});

test('deal API data persists across server restart with same database file', async () => {
  const fixture = await createTokenFixture('402');

  const created = await requestJson('POST', '/api/deals', {
    LeadID: fixture.leadId,
    RequirementID: fixture.requirementId,
    PropertyID: fixture.propertyId,
    NegotiationID: fixture.negotiationId,
    TokenID: fixture.tokenId,
    FinalPrice: fixture.agreedPrice,
    Brokerage: 310000,
    Status: 'OPEN'
  });

  assert.equal(created.status, 200);
  const createdDealId = created.body.data.DealID;

  if (serverProcess && serverProcess.exitCode === null && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await delay(400);
  }

  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), SIG_REALTY_DB_FILE: DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.setEncoding('utf8');
  serverProcess.stderr.setEncoding('utf8');
  await waitForServer();

  const listedAfterRestart = await requestJson('GET', '/api/deals');
  assert.equal(listedAfterRestart.status, 200);
  assert.equal(listedAfterRestart.body.ok, true);
  assert.ok(listedAfterRestart.body.data.some((item) => item.DealID === createdDealId));
});
