'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSignedObjectAccess,
  verifySignedObjectAccess
} = require('../src/services/storageAccessService');

const env = { STORAGE_SIGNING_SECRET: 'storage-access-test-secret' };

test('signed object URLs verify for the requested key until expiry', () => {
  const created = createSignedObjectAccess('builder-projects/BLD-1/brochures/a.pdf', {
    env,
    now: 1_000,
    expiresInSeconds: 60
  });
  assert.equal(created.ok, true);

  const parsed = new URL(`http://example.test${created.url}`);
  const valid = verifySignedObjectAccess('builder-projects/BLD-1/brochures/a.pdf', {
    env,
    now: 59_000,
    expiresAt: parsed.searchParams.get('expiresAt'),
    signature: parsed.searchParams.get('signature')
  });
  assert.equal(valid.ok, true);

  const expired = verifySignedObjectAccess('builder-projects/BLD-1/brochures/a.pdf', {
    env,
    now: 61_000,
    expiresAt: parsed.searchParams.get('expiresAt'),
    signature: parsed.searchParams.get('signature')
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'EXPIRED');
});

test('signed object URLs reject key tampering and cap their lifetime', () => {
  const created = createSignedObjectAccess('private/object.pdf', {
    env,
    now: 10_000,
    expiresInSeconds: 999999
  });
  const parsed = new URL(`http://example.test${created.url}`);
  assert.equal(Number(parsed.searchParams.get('expiresAt')), 10_000 + 3600 * 1000);

  const tampered = verifySignedObjectAccess('private/other.pdf', {
    env,
    now: 10_001,
    expiresAt: parsed.searchParams.get('expiresAt'),
    signature: parsed.searchParams.get('signature')
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.code, 'INVALID_SIGNATURE');
});

test('signed object access fails closed when no signing secret is configured', () => {
  const created = createSignedObjectAccess('private/object.pdf', {
    env: {},
    now: 10_000
  });
  assert.equal(created.ok, false);
  assert.equal(created.statusCode, 503);
});