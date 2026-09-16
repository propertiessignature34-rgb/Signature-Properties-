const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonRepository } = require('../src/data/repository');
const { BrokerNetworkV2Service } = require('../src/services/brokerNetworkV2Service');

function makeNetwork() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-broker-network-'));
  const repository = new JsonRepository(path.join(directory, 'database.json'));
  const db = repository.read();
  db.BrokerNetworkContacts = db.BrokerNetworkContacts || [];
  db.Requirements = Array.isArray(db.Requirements) ? db.Requirements : [];
  db.Leads = Array.isArray(db.Leads) ? db.Leads : [];
  if (!db.Leads.some((row) => row.LeadID === 'LEAD-0001')) {
    db.Leads.push({ LeadID: 'LEAD-0001', ClientName: 'Broker Flow Lead', Status: 'Active' });
  }
  if (!db.Requirements.some((row) => row.RequirementID === 'REQ-0001')) {
    db.Requirements.push({
      RequirementID: 'REQ-0001',
      LeadID: 'LEAD-0001',
      TransactionType: 'Purchase',
      Category: 'Residential',
      SubCategory: 'Apartment',
      Fields: {}
    });
  }
  const now = new Date().toISOString();
  db.BrokerNetworkContacts.push(
    { NetworkBrokerID: 'BRO-A', Name: 'Originating Broker', Phone: '+919000000001', Active: true, AddedAt: now, UpdatedAt: now },
    { NetworkBrokerID: 'BRO-B', Name: 'Receiving Broker', Phone: '+919000000002', Active: true, AddedAt: now, UpdatedAt: now }
  );
  repository.write(db);
  return { repository, service: new BrokerNetworkV2Service(repository) };
}

test('creates unique share tokens and sanitized public requirement payload', () => {
  const { service } = makeNetwork();
  const first = service.share('REQ-0001', { brokerIds: ['BRO-B'], expiresInDays: 7, userId: 'BRO-A' });
  const second = service.share('REQ-0001', { brokerIds: ['BRO-B'], expiresInDays: 7, userId: 'BRO-A' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.data.shares[0].Token, second.data.shares[0].Token);

  const publicView = service.getPublicShareByToken(first.data.shares[0].Token);
  assert.equal(publicView.ok, true);
  assert.equal(publicView.data.Requirement.ClientName, undefined);
  assert.doesNotMatch(JSON.stringify(publicView.data.Requirement), /Rohan Verma|98765|rohan\.v@example\.com/i);
});

test('submitResponse creates network inventory and shortlist entries', () => {
  const { service, repository } = makeNetwork();
  const created = service.share('REQ-0001', { brokerIds: ['BRO-B'], expiresInDays: 7, userId: 'BRO-A' });
  const token = created.data.shares[0].Token;
  const shareId = created.data.shares[0].ShareID;

  const response = service.submitResponse(token, {
    Title: 'Broker B Project',
    BHK: '2',
    Location1: 'Bengaluru East',
    AskingPrice: 18000000,
    Notes: 'Matching unit'
  });
  assert.equal(response.ok, true);

  const db = repository.read();
  const inventory = (db.Inventory || []).filter((row) => row.NetworkShareID === shareId);
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].InventorySource, 'NetworkSubmission');
  const shortlists = (db.Shortlists || []).filter((row) => row.NetworkShareID === shareId);
  assert.equal(shortlists.length, 1);
});

test('invalid token is rejected and revoked share becomes inaccessible', () => {
  const { service } = makeNetwork();
  const created = service.share('REQ-0001', { brokerIds: ['BRO-B'], expiresInDays: 7, userId: 'BRO-A' });
  const share = created.data.shares[0];
  const bad = service.getPublicShareByToken('not-a-real-token');
  assert.equal(bad.ok, false);

  const revoked = service.revokeShare(share.ShareID);
  assert.equal(revoked.ok, true);
  const revokedPublic = service.getPublicShareByToken(share.Token);
  assert.equal(revokedPublic.ok, false);
  assert.equal(revokedPublic.code, 'REVOKED');
});

test('expired share token returns EXPIRED state', () => {
  const { service, repository } = makeNetwork();
  const created = service.share('REQ-0001', { brokerIds: ['BRO-B'], expiresInDays: 7, userId: 'BRO-A' });
  const share = created.data.shares[0];
  const db = repository.read();
  const target = (db.RequirementShares || []).find((row) => row.ShareID === share.ShareID);
  assert.ok(target, 'Expected share row to be persisted');
  target.ExpiresAt = new Date(Date.now() - 1000).toISOString();
  repository.write(db);
  const expiredPublic = service.getPublicShareByToken(share.Token);
  assert.equal(expiredPublic.ok, false);
  assert.equal(expiredPublic.code, 'EXPIRED');
});
