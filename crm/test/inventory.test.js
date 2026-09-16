const test = require('node:test');
const assert = require('node:assert/strict');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

test('inventory runtime can list and create properties', async () => {
  const runtime = new SignatureRealtyRuntime();
  const initial = await runtime.listInventory();

  assert.equal(initial.ok, true);
  assert.ok(Array.isArray(initial.data));

  const created = await runtime.createInventoryProperty({
    category: 'Residential',
    subCategory: 'Apartment',
    propertyType: 'Apartment',
    project: 'Orchid Residency',
    location: 'Sarjapur',
    area: 1800,
    price: 13500000,
    status: 'Available',
    ownerId: 'OWN-1003',
    brokerId: 'BRO-003',
    builderId: 'BUIL-303'
  });

  assert.equal(created.ok, true);
  assert.ok(created.data.PropertyID);

  const updated = await runtime.listInventory();
  assert.ok(updated.data.some((property) => property.Project === 'Orchid Residency'));
});
