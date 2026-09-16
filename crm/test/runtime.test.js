const test = require('node:test');
const assert = require('node:assert/strict');
const { SignatureRealtyRuntime } = require('../src/runtime/app');

test('runtime exposes dashboard summary', async () => {
  const runtime = new SignatureRealtyRuntime();
  const summary = await runtime.dashboard();
  assert.equal(summary.ok, true);
  assert.ok(Number.isInteger(summary.data.totalLeads));
});

test('runtime exposes leads and requirements', async () => {
  const runtime = new SignatureRealtyRuntime();
  const leads = await runtime.leads();
  const requirements = await runtime.requirements();

  assert.equal(leads.ok, true);
  assert.equal(requirements.ok, true);
  assert.ok(Array.isArray(leads.data));
  assert.ok(Array.isArray(requirements.data));
});

test('matching returns rank output', async () => {
  const runtime = new SignatureRealtyRuntime();
  const result = await runtime.matching();

  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.data));
  if (result.data.length > 0) {
    assert.ok(result.data[0].MatchLevel !== undefined);
  }
});

test('dynamic form engine validates known form config', async () => {
  const runtime = new SignatureRealtyRuntime();
  const residential = await runtime.formConfig('residential');

  assert.equal(residential.formName, 'Residential Requirement Form');
  assert.ok(residential.fields.bhkMin);
});
