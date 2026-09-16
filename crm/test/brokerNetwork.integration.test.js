const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonRepository } = require('../src/data/repository');
const { BrokerNetworkV2Service } = require('../src/services/brokerNetworkV2Service');

function setup() {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sig-broker-network-integration-')), 'database.json');
  const repository = new JsonRepository(dbFile);
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
    { NetworkBrokerID: 'BRO-A', Name: 'Broker A', Phone: '+919000000001', Active: true, AddedAt: now, UpdatedAt: now },
    { NetworkBrokerID: 'BRO-B', Name: 'Broker B', Phone: '+919000000002', Active: true, AddedAt: now, UpdatedAt: now }
  );
  repository.write(db);
  return { dbFile, repository };
}

test('network share + public response flow persists after restart', () => {
  const { dbFile, repository } = setup();
  const first = new BrokerNetworkV2Service(repository);
  const created = first.share('REQ-0001', { brokerIds: ['BRO-B'], expiresInDays: 7, userId: 'BRO-A' });
  assert.equal(created.ok, true);
  assert.equal(created.data.count, 1);

  const share = created.data.shares[0];
  const publicView = first.getPublicShareByToken(share.Token);
  assert.equal(publicView.ok, true);
  assert.equal(publicView.data.Requirement.ClientName, undefined);

  const submitted = first.submitResponse(share.Token, {
    Title: 'B1 Project',
    Location1: 'Bengaluru East',
    BHK: '2',
    AskingPrice: 18500000
  });
  assert.equal(submitted.ok, true);
  assert.ok(submitted.data.NetworkResponseID);

  const restarted = new BrokerNetworkV2Service(new JsonRepository(dbFile));
  const shares = restarted.listSharesByRequirement('REQ-0001');
  assert.equal(shares.length, 1);
  assert.equal(shares[0].ShareID, share.ShareID);

  const db = restarted.repo.read();
  const networkInventory = (db.Inventory || []).filter((row) => row.NetworkShareID === share.ShareID);
  assert.equal(networkInventory.length, 1);
  assert.equal(networkInventory[0].InventorySource, 'NetworkSubmission');
});
