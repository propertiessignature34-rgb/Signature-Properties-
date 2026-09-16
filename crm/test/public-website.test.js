const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, requestJson, adminHeaders, makeDbFile } = require('./admin-test-utils');

test('public website exposes public inventory and projects without auth', async () => {
  const dbFile = makeDbFile();
  const server = await startServer(dbFile);

  try {
    const inventoryResponse = await requestJson(server.baseUrl, '/api/inventory', {
      method: 'POST',
      headers: adminHeaders(),
      body: {
        PropertyID: 'PROP-PUBLIC-001',
        Category: 'Residential',
        PropertyType: 'Apartment',
        Project: 'Nexus Heights',
        Location: 'Whitefield',
        City: 'Bengaluru',
        BHK: 2,
        Area: 1450,
        Price: 15000000,
        Status: 'Available',
        Visibility: 'PUBLIC'
      }
    });
    assert.equal(inventoryResponse.response.status, 200);

    const projectResponse = await requestJson(server.baseUrl, '/api/projects', {
      method: 'POST',
      headers: adminHeaders(),
      body: {
        ProjectID: 'PRJ-PUBLIC-001',
        BuilderID: 'BLD-001',
        ProjectName: 'Nexus Heights',
        Location: 'Whitefield',
        Visibility: 'PUBLIC'
      }
    });
    assert.equal(projectResponse.response.status, 201);

    const publicInventory = await requestJson(server.baseUrl, '/api/public/properties');
    assert.equal(publicInventory.response.status, 200);
    assert.ok(publicInventory.payload.data.some((item) => item.PropertyID === 'PROP-PUBLIC-001'));

    const publicProjects = await requestJson(server.baseUrl, '/api/public/projects');
    assert.equal(publicProjects.response.status, 200);
    assert.ok(publicProjects.payload.data.some((item) => item.ProjectID === 'PRJ-PUBLIC-001'));

    const publicHtml = await fetch(`${server.baseUrl}/public`);
    const html = await publicHtml.text();
    assert.equal(publicHtml.status, 200);
    assert.match(html, /Signature Realty|Nexus Heights/i);
  } finally {
    await stopServer(server.child);
  }
});
