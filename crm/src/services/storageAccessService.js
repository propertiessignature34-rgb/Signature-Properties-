'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 3600;

function signingSecret(env = process.env) {
  return String(env.STORAGE_SIGNING_SECRET || env.SESSION_SECRET || '').trim();
}

function encodeKey(key) {
  return Buffer.from(String(key), 'utf8').toString('base64url');
}

function signatureFor(key, expiresAt, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`v1\n${expiresAt}\n${key}`, 'utf8')
    .digest('base64url');
}

function clampTtl(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(30, Math.floor(requested)));
}

function createSignedObjectAccess(key, options = {}) {
  const normalizedKey = String(key || '').trim();
  const secret = signingSecret(options.env);
  if (!secret) return { ok: false, statusCode: 503, error: 'Storage signing is not configured' };
  if (!normalizedKey) return { ok: false, statusCode: 400, error: 'Object key is required' };

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const expiresAt = now + clampTtl(options.expiresInSeconds) * 1000;
  const signature = signatureFor(normalizedKey, expiresAt, secret);
  const encodedKey = encodeKey(normalizedKey);
  const url = `/api/v2/storage/object/${encodedKey}?expiresAt=${expiresAt}&signature=${encodeURIComponent(signature)}`;

  return { ok: true, key: normalizedKey, url, expiresAt };
}

function verifySignedObjectAccess(key, options = {}) {
  const normalizedKey = String(key || '').trim();
  const expiresAt = Number(options.expiresAt);
  const signature = String(options.signature || '');
  const secret = signingSecret(options.env);
  const now = Number.isFinite(options.now) ? options.now : Date.now();

  if (!secret || !normalizedKey || !Number.isSafeInteger(expiresAt) || !signature) {
    return { ok: false, code: 'INVALID_SIGNATURE', error: 'Invalid signed object URL' };
  }
  if (expiresAt <= now) {
    return { ok: false, code: 'EXPIRED', error: 'Signed object URL has expired' };
  }

  const expected = Buffer.from(signatureFor(normalizedKey, expiresAt, secret), 'utf8');
  const received = Buffer.from(signature, 'utf8');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, code: 'INVALID_SIGNATURE', error: 'Invalid signed object URL' };
  }

  return { ok: true, expiresAt };
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  createSignedObjectAccess,
  verifySignedObjectAccess
};