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
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-closing-api-')), 'sig-realty-db.json');
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

async function createCommissionDeal(baseUrl, suffix = 'CLA01') {
  const leadRes = await apiFetch(`${baseUrl}/api/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientName: `Closing API Lead ${suffix}`,
      city: 'Bengaluru',
      phone: `+91 9555500${suffix}`,
      email: `closing.api.${suffix}@example.com`,
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
      transactionId: `TXN-CLA-${suffix}`,
      transactionType: 'Purchase',
      category: 'Residential',
      subCategory: 'Apartment',
      propertyType: 'Apartment',
      budgetMin: 10000000,
      budgetMax: 20000000,
      location1: `Closing API Location ${suffix}`,
      location2: `Closing API East ${suffix}`,
      location3: `Closing API District ${suffix}`,
      bhkMin: 2,
      bhkMax: 3,
      areaMin: 1200,
      areaMax: 1700,
      possession: 'Ready',
      urgency: 'High',
      specialNotes: 'Closing API fixture',
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
      project: `Closing API Project ${suffix}`,
      location: `Closing API Location ${suffix}`,
      city: 'Bengaluru',
      bhk: 3,
      area: 1470,
      price: 16600000,
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
      AskingPrice: 16600000,
      CurrentOffer: 16200000,
      AgreedPrice: 16200000,
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
      TokenAmount: 500000,
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
      FinalPrice: 16200000,
      Brokerage: 324000,
      Status: 'COMPLETED'
    })
  });
  assert.equal(dealRes.status, 200);
  const deal = await dealRes.json();

  const commRes = await apiFetch(`${baseUrl}/api/commission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      DealID: deal.data.DealID,
      LeadID: lead.data.LeadID,
      PropertyID: property.data.PropertyID,
      CommissionType: 'PERCENTAGE',
      BaseAmount: deal.data.FinalPrice,
      CommissionRate: 2,
      AgentSharePercent: 50,
      CompanySharePercent: 50
    })
  });
  assert.equal(commRes.status, 200);
  const commission = await commRes.json();

  return { lead, requirement, property, negotiation, token, deal, commission };
}

test('closing API supports start/checklist/history/complete/close lifecycle', async () => {
  const dbPath = makeDbFile();
  const { child, baseUrl } = await startServer(dbPath);

  try {
    const fixture = await createCommissionDeal(baseUrl, 'CLA11');

    const startRes = await apiFetch(`${baseUrl}/api/closing/${fixture.deal.data.DealID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ CreatedBy: 'USR-0001' })
    });
    assert.equal(startRes.status, 200);
    const started = await startRes.json();
    assert.equal(started.ok, true);

    const getRes = await apiFetch(`${baseUrl}/api/closing/${fixture.deal.data.DealID}`);
    assert.equal(getRes.status, 200);
    const fetched = await getRes.json();
    assert.equal(fetched.ok, true);

    const firstItem = fetched.data.Checklist[0];
    const checklistRes = await apiFetch(`${baseUrl}/api/closing/${fixture.deal.data.DealID}/checklist`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ItemKey: firstItem.ItemKey, Status: 'COMPLETED', CompletedBy: 'USR-0001' })
    });
    assert.equal(checklistRes.status, 200);

    const completeBeforePayRes = await apiFetch(`${baseUrl}/api/closing/${fixture.deal.data.DealID}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ UpdatedBy: 'USR-0002' })
    });
    assert.equal(completeBeforePayRes.status, 400);

    const payRes = await apiFetch(`${baseUrl}/api/commission/${fixture.commission.data.CommissionID}/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Amount: fixture.commission.data.GrossCommission, PaymentMode: 'BANK_TRANSFER', PaymentID: 'PAY-CLA-011' })
    });
    assert.equal(payRes.status, 200);

    const closingRefetchRes = await apiFetch(`${baseUrl}/api/closing/${fixture.deal.data.DealID}`);
    assert.equal(closingRefetchRes.status, 200);
    const closingRefetch = await closingRefetchRes.json();

    for (const item of closingRefetch.data.Checklist) {
      const updateRes = await apiFetch(`${baseUrl}/api/closing/${fixture.deal.data.DealID}/checklist`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ItemKey: item.ItemKey, Status: 'COMPLETED', CompletedBy: 'USR-0002' })
      });
      assert.equal(updateRes.status, 200);
    }

    const completeAfterRes = await apiFetch(`${baseUrl}/api/closing/${fixture.deal.data.DealID}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ UpdatedBy: 'USR-0002' })
    });
    assert.equal(completeAfterRes.status, 200);
    const completed = await completeAfterRes.json();
    assert.equal(completed.ok, true);
    assert.equal(completed.data.Status, 'COMPLETED');

    const closeRes = await apiFetch(`${baseUrl}/api/closing/${fixture.deal.data.DealID}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ UpdatedBy: 'USR-0002' })
    });
    assert.equal(closeRes.status, 200);
    const closed = await closeRes.json();
    assert.equal(closed.ok, true);
    assert.equal(closed.data.deal.Status, 'CLOSED');

    const historyRes = await apiFetch(`${baseUrl}/api/closing/${fixture.deal.data.DealID}/history`);
    assert.equal(historyRes.status, 200);
    const history = await historyRes.json();
    assert.equal(history.ok, true);
    assert.equal(history.data.length >= 3, true);
  } finally {
    await stopServer(child);
    fs.unlinkSync(dbPath);
  }
});

test('closing API validates state and returns expected codes for unknown deals', async () => {
  const dbPath = makeDbFile();
  const { child, baseUrl } = await startServer(dbPath);

  try {
    const getMissing = await apiFetch(`${baseUrl}/api/closing/DEAL-999999`);
    assert.equal(getMissing.status, 404);

    const startMissing = await apiFetch(`${baseUrl}/api/closing/DEAL-999999/start`, { method: 'POST' });
    assert.equal(startMissing.status, 400);

    const checklistMissing = await apiFetch(`${baseUrl}/api/closing/DEAL-999999/checklist`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ItemKey: 'agreement_signed', Status: 'COMPLETED' })
    });
    assert.equal(checklistMissing.status, 400);
  } finally {
    await stopServer(child);
    fs.unlinkSync(dbPath);
  }
});
