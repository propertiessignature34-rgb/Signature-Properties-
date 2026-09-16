const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { apiFetchAuth } = require('./admin-test-utils');
const apiFetch = (url, options = {}) => apiFetchAuth(url, { ...options, useDefaultAuth: true });

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-commission-api-')), 'sig-realty-db.json');
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = http.createServer(() => {});
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

async function startServer(dbPath) {
  const port = await findFreePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), SIG_REALTY_DB_FILE: dbPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const output = [];
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${port}`;
  const timeout = Date.now() + 15000;
  while (Date.now() < timeout) {
    if (child.exitCode !== null) break;
    try {
      const res = await apiFetch(`${baseUrl}/health`);
      if (res.ok) return { child, baseUrl };
    } catch (_) {
      // keep retrying until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  child.kill('SIGTERM');
  await once(child, 'exit');
  throw new Error(`Server failed to start. Logs:\n${output.join('')}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
}

async function createDealViaApi(baseUrl, suffix = 'CA01') {
  const leadRes = await apiFetch(`${baseUrl}/api/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientName: `Commission API Lead ${suffix}`,
      city: 'Bengaluru',
      phone: `+91 9666600${suffix}`,
      email: `commission.api.${suffix}@example.com`,
      leadStatus: 'Active',
      assignedAgentId: 'USR-0001'
    })
  });
  assert.equal(leadRes.status, 200);
  const lead = await leadRes.json();

  const reqRes = await apiFetch(`${baseUrl}/api/leads/${lead.data.LeadID}/requirements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      transactionId: `TXN-CA-${suffix}`,
      transactionType: 'Purchase',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      budgetMin: 10000000,
      budgetMax: 20000000,
      location1: `Commission API Location ${suffix}`,
      location2: `Commission API East ${suffix}`,
      location3: `Commission API District ${suffix}`,
      bhkMin: 2,
      bhkMax: 3,
      areaMin: 1200,
      areaMax: 1700,
      possession: 'Ready',
      urgency: 'High',
      specialNotes: 'Commission API fixture',
      formType: 'residential'
    })
  });
  assert.equal(reqRes.status, 200);
  const requirement = await reqRes.json();

  const invRes = await apiFetch(`${baseUrl}/api/inventory`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      transactionType: 'Sale',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      project: `Commission API Project ${suffix}`,
      location: `Commission API Location ${suffix}`,
      city: 'Bengaluru',
      bhk: 3,
      area: 1450,
      price: 16500000,
      possession: 'Ready',
      status: 'Available'
    })
  });
  assert.equal(invRes.status, 200);
  const property = await invRes.json();

  const matchRes = await apiFetch(`${baseUrl}/api/matching/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requirementId: requirement.data.RequirementID })
  });
  assert.equal(matchRes.status, 200);
  const matchRun = await matchRes.json();
  const match = matchRun.data.matches.find((item) => item.PropertyID === property.data.PropertyID);
  assert.ok(match);

  const negRes = await apiFetch(`${baseUrl}/api/negotiations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      LeadID: lead.data.LeadID,
      RequirementID: requirement.data.RequirementID,
      TransactionID: requirement.data.TransactionID,
      PropertyID: property.data.PropertyID,
      MatchID: match.MatchID,
      AskingPrice: 16500000,
      CurrentOffer: 16100000,
      AgreedPrice: 16100000,
      Status: 'AGREED'
    })
  });
  assert.equal(negRes.status, 200);
  const negotiation = await negRes.json();

  const tokenRes = await apiFetch(`${baseUrl}/api/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      NegotiationID: negotiation.data.NegotiationID,
      LeadID: lead.data.LeadID,
      RequirementID: requirement.data.RequirementID,
      PropertyID: property.data.PropertyID,
      TokenAmount: 700000,
      Status: 'PAID'
    })
  });
  assert.equal(tokenRes.status, 200);
  const token = await tokenRes.json();

  const dealRes = await apiFetch(`${baseUrl}/api/deals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      LeadID: lead.data.LeadID,
      RequirementID: requirement.data.RequirementID,
      PropertyID: property.data.PropertyID,
      MatchID: match.MatchID,
      NegotiationID: negotiation.data.NegotiationID,
      TokenID: token.data.TokenID,
      FinalPrice: 16100000,
      Brokerage: 322000,
      Status: 'COMPLETED'
    })
  });
  assert.equal(dealRes.status, 200);
  const deal = await dealRes.json();

  return { lead, requirement, property, negotiation, token, deal };
}

test('commission API supports calculate/create/list/summary/history/payment/status', async () => {
  const dbPath = makeDbFile();
  const { child, baseUrl } = await startServer(dbPath);

  try {
    const fixture = await createDealViaApi(baseUrl, 'CA11');

    const calcRes = await apiFetch(`${baseUrl}/api/commission/calculate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        CommissionType: 'PERCENTAGE',
        BaseAmount: fixture.deal.data.FinalPrice,
        CommissionRate: 2,
        AgentSharePercent: 50,
        CompanySharePercent: 50
      })
    });
    assert.equal(calcRes.status, 200);
    const calc = await calcRes.json();
    assert.equal(calc.ok, true);
    assert.equal(calc.data.GrossCommission, 322000);

    const createRes = await apiFetch(`${baseUrl}/api/commission`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        DealID: fixture.deal.data.DealID,
        NegotiationID: fixture.negotiation.data.NegotiationID,
        TokenID: fixture.token.data.TokenID,
        TransactionID: fixture.requirement.data.TransactionID,
        LeadID: fixture.lead.data.LeadID,
        PropertyID: fixture.property.data.PropertyID,
        CommissionType: 'PERCENTAGE',
        BaseAmount: fixture.deal.data.FinalPrice,
        CommissionRate: 2,
        AgentSharePercent: 50,
        CompanySharePercent: 50,
        DueDate: '2027-03-15'
      })
    });
    assert.equal(createRes.status, 200);
    const commission = await createRes.json();
    assert.equal(commission.ok, true);

    const listRes = await apiFetch(`${baseUrl}/api/commission?dealId=${encodeURIComponent(fixture.deal.data.DealID)}`);
    assert.equal(listRes.status, 200);
    const listed = await listRes.json();
    assert.equal(listed.ok, true);
    assert.equal(listed.data.length, 1);

    const byIdRes = await apiFetch(`${baseUrl}/api/commission/${commission.data.CommissionID}`);
    assert.equal(byIdRes.status, 200);
    const byId = await byIdRes.json();
    assert.equal(byId.ok, true);
    assert.equal(byId.data.CommissionID, commission.data.CommissionID);

    const payRes = await apiFetch(`${baseUrl}/api/commission/${commission.data.CommissionID}/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ PaymentID: 'PAY-CA-011', Amount: 200000, PaymentMode: 'UPI' })
    });
    assert.equal(payRes.status, 200);
    const payBody = await payRes.json();
    assert.equal(payBody.ok, true);
    assert.equal(payBody.data.commission.Status, 'PARTIAL');

    const statusRes = await apiFetch(`${baseUrl}/api/commission/${commission.data.CommissionID}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Status: 'OVERDUE', Reason: 'Amount reconciliation' })
    });
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.ok, true);
    assert.equal(statusBody.data.Status, 'OVERDUE');

    const paymentsRes = await apiFetch(`${baseUrl}/api/commission/${commission.data.CommissionID}/payments`);
    assert.equal(paymentsRes.status, 200);
    const payments = await paymentsRes.json();
    assert.equal(payments.ok, true);
    assert.equal(payments.data.length, 1);

    const historyRes = await apiFetch(`${baseUrl}/api/commission/${commission.data.CommissionID}/history`);
    assert.equal(historyRes.status, 200);
    const history = await historyRes.json();
    assert.equal(history.ok, true);
    assert.equal(history.data.length >= 3, true);

    const summaryRes = await apiFetch(`${baseUrl}/api/commission/summary`);
    assert.equal(summaryRes.status, 200);
    const summary = await summaryRes.json();
    assert.equal(summary.ok, true);
    assert.equal(summary.data.totalCommission >= 1, true);
  } finally {
    await stopServer(child);
    fs.unlinkSync(dbPath);
  }
});

test('commission API validates missing data and returns 404 for unknown commission', async () => {
  const dbPath = makeDbFile();
  const { child, baseUrl } = await startServer(dbPath);

  try {
    const badCreateRes = await apiFetch(`${baseUrl}/api/commission`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ CommissionType: 'PERCENTAGE', CommissionRate: 2 })
    });
    assert.equal(badCreateRes.status, 400);

    const badCalcRes = await apiFetch(`${baseUrl}/api/commission/calculate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ CommissionType: 'PERCENTAGE', AgentSharePercent: 120 })
    });
    assert.equal(badCalcRes.status, 400);

    const notFoundRes = await apiFetch(`${baseUrl}/api/commission/COM-999999`);
    assert.equal(notFoundRes.status, 404);

    const paymentNotFound = await apiFetch(`${baseUrl}/api/commission/COM-999999/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Amount: 1000, PaymentMode: 'UPI' })
    });
    assert.equal(paymentNotFound.status, 400);
  } finally {
    await stopServer(child);
    fs.unlinkSync(dbPath);
  }
});
