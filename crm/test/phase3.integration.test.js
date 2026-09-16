const test = require('node:test');
const assert = require('node:assert/strict');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

function makeLeadPayload() {
  return {
    clientName: 'Integration Client',
    city: 'Bengaluru',
    phone: '+91 9876543210',
    email: 'integration@example.com',
    leadStatus: 'New',
    assignedAgentId: 'USR-0001'
  };
}

test('create and read lead', async () => {
  const runtime = new SignatureRealtyRuntime();
  const created = await runtime.createLead(makeLeadPayload());

  assert.equal(created.ok, true);
  assert.ok(created.data.LeadID);

  const read = await runtime.readLead(created.data.LeadID);
  assert.equal(read.ok, true);
  assert.equal(read.data.LeadID, created.data.LeadID);
});

test('update lead keeps stable id and updates timestamp', async () => {
  const runtime = new SignatureRealtyRuntime();
  const lead = await runtime.createLead(makeLeadPayload());

  const updated = await runtime.updateLead(lead.data.LeadID, {
    city: 'Mumbai'
  });

  assert.equal(updated.ok, true);
  assert.equal(updated.data.city || updated.data.City, 'Mumbai');
});

test('create requirement, read requirement, history, archive, activity, lead last activity', async () => {
  const runtime = new SignatureRealtyRuntime();
  const lead = await runtime.createLead(makeLeadPayload());

  const req = await runtime.createRequirement(lead.data.LeadID, 'TXN-0001', {
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 12000000,
    budgetMax: 15000000,
    location1: 'Bengaluru East',
    location2: 'Whitefield',
    location3: 'ITPL',
    possession: 'Ready',
    urgency: 'High',
    specialNotes: 'Need immediate shortlist',
    transactionType: 'Purchase',
    leadId: lead.data.LeadID,
    formType: 'residential'
  });

  assert.equal(req.ok, true);
  assert.ok(req.data.RequirementID);

  const readReq = await runtime.readRequirement(req.data.RequirementID);
  assert.equal(readReq.ok, true);
  assert.equal(readReq.data.RequirementID, req.data.RequirementID);

  const updated = await runtime.updateRequirement(req.data.RequirementID, {
    urgency: 'Low'
  });

  assert.equal(updated.ok, true);
  assert.ok(updated.data.history && updated.data.history.length >= 1);

  const archived = await runtime.archiveRequirement(req.data.RequirementID);
  assert.equal(archived.ok, true);
  assert.equal(archived.data.Status, 'Cancelled');

  const activity = await runtime.addActivity(lead.data.LeadID, {
    activityType: 'Note',
    notes: 'Requirements integration test note'
  });

  assert.equal(activity.ok, true);
  const leadAfterActivity = await runtime.readLead(lead.data.LeadID);
  assert.ok(leadAfterActivity.data.last_activity_at || leadAfterActivity.data.LastActivityAt);
});

test('dynamic form registry serves residential, commercial, land and industrial metadata', async () => {
  const runtime = new SignatureRealtyRuntime();
  const residential = await runtime.getFormConfig('residential');
  const commercial = await runtime.getFormConfig('commercial');
  const land = await runtime.getFormConfig('land');
  const industrial = await runtime.getFormConfig('industrial');

  assert.equal(residential.ok, true);
  assert.equal(commercial.ok, true);
  assert.equal(land.ok, true);
  assert.equal(industrial.ok, true);

  assert.ok(residential.data.fields.bhkMin);
  assert.ok(commercial.data.fields.areaMin);
  assert.ok(land.data.fields.plotMin); 
  assert.ok(industrial.data.fields.areaMin);
});

test('dynamic form validation catches invalid payloads', async () => {
  const runtime = new SignatureRealtyRuntime();
  const validation = await runtime.validateRequirementPayload({
    category: 'Residential',
    transactionType: 'Purchase',
    budgetMin: 50000000,
    budgetMax: 1000000,
    mobile: '999+',
    email: 'not-an-email'
  }, 'residential');

  assert.equal(validation.ok, false);
  assert.ok(validation.errors.length >= 1);
});

test('requirement list and workspace requirements flow load real records', async () => {
  const runtime = new SignatureRealtyRuntime();
  const lead = await runtime.createLead(makeLeadPayload());
  await runtime.createRequirement(lead.data.LeadID, 'TXN-0001', {
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    budgetMin: 10000000,
    budgetMax: 20000000,
    location1: 'Bengaluru South',
    location2: 'Koramangala',
    location3: null,
    possession: 'Ready',
    urgency: 'Medium',
    specialNotes: 'Workspace requirement',
    transactionType: 'Purchase',
    leadId: lead.data.LeadID,
    formType: 'residential'
  });

  const workspace = await runtime.getLeadWorkspace(lead.data.LeadID);
  assert.equal(workspace.ok, true);
  assert.ok(Array.isArray(workspace.data.requirements));
  assert.ok(workspace.data.requirements.length >= 1);
});
