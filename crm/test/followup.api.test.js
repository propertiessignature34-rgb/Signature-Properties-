const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHeaders, makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');

const DB_FILE = makeDbFile('sig-followup-api-');

let server;

test.before(async () => {
  server = await startServer(DB_FILE);
});

test.after(async () => {
  await stopServer(server?.child);
});

test('follow-up API creates and lists follow-ups for a lead', async () => {
  const lead = await requestJson(server.baseUrl, '/api/leads', {
    method: 'POST',
    headers: adminHeaders(),
    body: { ClientName: 'Follow-up API Lead', Phone: '+91 90000 00003' }
  });
  assert.equal(lead.response.status, 200);
  const leadId = lead.payload.data.LeadID;

  const created = await requestJson(server.baseUrl, '/api/followups', {
    method: 'POST',
    headers: adminHeaders(),
    body: {
      leadId,
      relatedEntityType: 'Lead',
      relatedEntityId: leadId,
      activityType: 'FOLLOW_UP',
      dueDate: '2026-08-20',
      priority: 'High',
      status: 'PENDING',
      notes: 'Follow-up test note',
      assignedUser: 'USR-0001'
    }
  });

  assert.equal(created.response.ok, true);
  assert.equal(created.payload.ok, true);
  assert.ok(created.payload.data.FollowUpID);

  const list = await requestJson(server.baseUrl, `/api/followups?leadId=${encodeURIComponent(leadId)}`, {
    headers: adminHeaders()
  });
  assert.equal(list.response.ok, true);
  assert.equal(list.payload.ok, true);
  assert.ok(list.payload.data.some((item) => item.Notes === 'Follow-up test note'));
});
