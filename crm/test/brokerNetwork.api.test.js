const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, stopServer, requestJson, adminHeaders } = require('./admin-test-utils');

function makeDbFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-broker-network-api-')), 'database.json');
}

test('broker network V2 API shares sanitized requirements and handles public responses', async () => {
  const dbFile = makeDbFile();
  const server = await startServer(dbFile);
  try {
    const lead = await requestJson(server.baseUrl, '/api/leads', {
      method: 'POST',
      headers: adminHeaders(),
      body: {
        clientName: 'Broker Network API Lead',
        city: 'Bengaluru',
        phone: '+919100000001',
        email: 'broker-network-api@example.com',
        leadStatus: 'Active',
        assignedAgentId: 'USR-SYSTEM-ADMIN'
      }
    });
    assert.equal(lead.response.status, 200);

    const requirement = await requestJson(server.baseUrl, '/api/requirements', {
      method: 'POST',
      headers: adminHeaders(),
      body: {
        leadId: lead.payload.data.LeadID,
        transactionId: 'TXN-BN-API-01',
        transactionType: 'Purchase',
        category: 'Residential',
        subCategory: 'Apartment',
        propertyType: 'Apartment',
        budgetMin: 10000000,
        budgetMax: 21000000,
        location1: 'Bengaluru East',
        location2: 'Whitefield',
        location3: 'Karnataka',
        bhkMin: 2,
        bhkMax: 3,
        areaMin: 1000,
        areaMax: 1600,
        possession: 'Ready',
        urgency: 'High',
        formType: 'residential'
      }
    });
    assert.equal(requirement.response.status, 200);

    const broker = await requestJson(server.baseUrl, '/api/v2/broker-network', {
      method: 'POST',
      headers: adminHeaders(),
      body: { Name: 'Broker B', Phone: '+919000000002', TrustLevel: 'High' }
    });
    assert.equal(broker.response.status, 201);
    assert.equal(broker.payload.ok, true);

    const created = await requestJson(server.baseUrl, `/api/v2/requirements/${requirement.payload.data.RequirementID}/network-share`, {
      method: 'POST',
      headers: adminHeaders(),
      body: { brokerIds: [broker.payload.data.NetworkBrokerID], expiresInDays: 7 }
    });
    assert.equal(created.response.status, 201);
    const share = created.payload.data.shares[0];
    const token = share.Token;
    assert.ok(token);

    const publicView = await requestJson(server.baseUrl, `/api/v2/public/req/${token}`);
    assert.equal(publicView.response.status, 200);
    assert.equal(publicView.payload.data.Requirement.ClientName, undefined);
    assert.equal(publicView.payload.data.Requirement.Phone, undefined);
    assert.equal(publicView.payload.data.Requirement.Email, undefined);
    assert.doesNotMatch(JSON.stringify(publicView.payload), /Rohan Verma|98765|rohan\.v@example\.com|Need 2BHK/i);

    const submitted = await requestJson(server.baseUrl, `/api/v2/public/req/${token}/response`, {
      method: 'POST',
      body: { Title: 'Network Project', Location1: 'Bengaluru East', BHK: '2', AskingPrice: 18000000 }
    });
    assert.equal(submitted.response.status, 201);
    assert.equal(submitted.payload.ok, true);

    const shares = await requestJson(server.baseUrl, `/api/v2/requirements/${requirement.payload.data.RequirementID}/network-shares`, { headers: adminHeaders() });
    assert.equal(shares.response.status, 200);
    assert.ok(Array.isArray(shares.payload.data));
    assert.ok(shares.payload.data.some((row) => row.ShareID === share.ShareID));

    const revoked = await requestJson(server.baseUrl, `/api/v2/network-shares/${share.ShareID}/revoke`, {
      method: 'POST',
      headers: adminHeaders()
    });
    assert.equal(revoked.response.status, 200);

    const revokedPublic = await requestJson(server.baseUrl, `/api/v2/public/req/${token}`);
    assert.equal(revokedPublic.response.status, 410);
    assert.equal(revokedPublic.payload.code, 'REVOKED');

    const expiring = await requestJson(server.baseUrl, `/api/v2/requirements/${requirement.payload.data.RequirementID}/network-share`, {
      method: 'POST',
      headers: adminHeaders(),
      body: { brokerIds: [broker.payload.data.NetworkBrokerID], expiresInDays: 7 }
    });
    assert.equal(expiring.response.status, 201);
    const expiringShare = expiring.payload.data.shares[0];

    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const expiringRow = (db.RequirementShares || []).find((row) => row.ShareID === expiringShare.ShareID);
    assert.ok(expiringRow, 'Expected expiring share row to be persisted');
    expiringRow.ExpiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

    const expiredPublic = await requestJson(server.baseUrl, `/api/v2/public/req/${expiringShare.Token}`);
    assert.equal(expiredPublic.response.status, 410);
    assert.equal(expiredPublic.payload.code, 'EXPIRED');
  } finally {
    await stopServer(server.child);
  }
});

test('broker network API rejects guessed tokens and missing authentication', async () => {
  const server = await startServer(makeDbFile());
  try {
    const guessed = await requestJson(server.baseUrl, '/api/v2/public/req/not-a-real-token');
    assert.equal(guessed.response.status, 404);
    const unauthenticated = await requestJson(server.baseUrl, '/api/v2/requirements/REQ-0001/network-shares', { method: 'GET' });
    assert.equal(unauthenticated.response.status, 401);
  } finally {
    await stopServer(server.child);
  }
});
