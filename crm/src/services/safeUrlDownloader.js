'use strict';

/**
 * safeUrlDownloader — SSRF-hardened, bounded streaming download of a single
 * remote file (used by the brochure migration job). Node's built-in
 * http/https modules are used directly (not `fetch`) so we can supply a
 * custom `lookup` that validates the resolved IP *before* the socket
 * connects — this defeats DNS-rebinding as well as plain private-IP targets.
 *
 * Only http/https are allowed, redirects are followed manually (each hop is
 * re-validated), downloads are capped by both Content-Length and actual
 * bytes received, and a hard timeout aborts slow/hanging responses.
 */

const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const { Transform } = require('stream');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 180000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const HARD_MAX_BYTES = 300 * 1024 * 1024;
const MAX_REDIRECTS = 3;
let dnsLookup = dns.lookup;
const IMAGE_MIME_ALIASES = {
  'image/jpg': 'image/jpeg'
};
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Private / loopback / link-local / reserved ranges — never allowed as a
// migration download destination, even after following a redirect.
const blockList = new net.BlockList();
blockList.addSubnet('10.0.0.0', 8, 'ipv4');
blockList.addSubnet('172.16.0.0', 12, 'ipv4');
blockList.addSubnet('192.168.0.0', 16, 'ipv4');
blockList.addSubnet('127.0.0.0', 8, 'ipv4');
blockList.addSubnet('169.254.0.0', 16, 'ipv4');
blockList.addSubnet('0.0.0.0', 8, 'ipv4');
blockList.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT
blockList.addAddress('::1', 'ipv6');
blockList.addSubnet('fc00::', 7, 'ipv6');
blockList.addSubnet('fe80::', 10, 'ipv6');

function normalizeDnsRecord(record) {
  const address = typeof record === 'string' ? record : record?.address;
  const detectedFamily = net.isIP(address || '');
  const declaredFamily = typeof record === 'object' && record ? Number(record.family) : detectedFamily;
  if (!address || !detectedFamily || (declaredFamily !== 4 && declaredFamily !== 6) || declaredFamily !== detectedFamily) {
    throw new Error('DNS resolution returned an invalid address record');
  }
  return { address, family: detectedFamily, type: detectedFamily === 6 ? 'ipv6' : 'ipv4' };
}

function safeLookup(hostname, options, callback) {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    if (!list.length) return callback(new Error('DNS resolution returned no addresses'));
    let normalized;
    try {
      normalized = list.map(normalizeDnsRecord);
    } catch (error) {
      return callback(error);
    }
    for (const record of normalized) {
      if (blockList.check(record.address, record.type)) {
        return callback(new Error('Destination address is blocked (private/internal range)'));
      }
    }
    if (options?.all) {
      return callback(null, normalized.map(({ address, family }) => ({ address, family })));
    }
    return callback(null, normalized[0].address, normalized[0].family);
  });
}

function assertPublicHttpUrl(rawUrl, { allowPrivateNetworks = false } = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed');
  }
  if (allowPrivateNetworks) return parsed; // test-only escape hatch, never set by production code
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '0.0.0.0') {
    throw new Error('Destination host is blocked (private/internal range)');
  }
  if (net.isIP(hostname)) {
    const type = net.isIPv6(hostname) ? 'ipv6' : 'ipv4';
    if (blockList.check(hostname, type)) {
      throw new Error('Destination address is blocked (private/internal range)');
    }
  }
  return parsed;
}

function requestOnce(targetUrl, { timeoutMs, maxBytes, allowPrivateNetworks }) {
  const parsed = assertPublicHttpUrl(targetUrl, { allowPrivateNetworks });
  return new Promise((resolve, reject) => {
    const mod = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const req = mod.request(parsed, {
      method: 'GET',
      lookup: allowPrivateNetworks ? undefined : safeLookup,
      timeout: timeoutMs,
      headers: { 'User-Agent': 'SignatureRealty-BrochureMigration/1.0' }
    }, (res) => {
      const status = res.statusCode || 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return finish(resolve, { redirect: true, location: res.headers.location });
      }
      if (status !== 200) {
        res.resume();
        return finish(reject, new Error(`HTTP ${status}`));
      }

      const contentType = String(res.headers['content-type'] || '');
      const contentLength = Number(res.headers['content-length'] || 0);
      if (contentLength && contentLength > maxBytes) {
        res.destroy();
        return finish(reject, new Error(`Content-Length ${contentLength} exceeds max ${maxBytes} bytes`));
      }

      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          res.destroy();
          return finish(reject, new Error(`Download exceeded max size of ${maxBytes} bytes`));
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(resolve, { redirect: false, buffer: Buffer.concat(chunks), contentType }));
      res.on('error', (err) => finish(reject, err));
    });

    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', (err) => finish(reject, err));
    req.end();
  });
}

function requestStreamOnce(targetUrl, { timeoutMs, maxBytes, allowPrivateNetworks }) {
  const parsed = assertPublicHttpUrl(targetUrl, { allowPrivateNetworks });
  return new Promise((resolve, reject) => {
    const mod = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const headerTimer = setTimeout(() => req.destroy(new Error(`Request timed out before response after ${timeoutMs}ms`)), timeoutMs);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(headerTimer);
      fn(value);
    };

    const req = mod.request(parsed, {
      method: 'GET',
      lookup: allowPrivateNetworks ? undefined : safeLookup,
      headers: { 'User-Agent': 'SignatureRealty-BrochureMigration/1.0' }
    }, (res) => {
      clearTimeout(headerTimer);

      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return finish(resolve, { redirect: true, location: res.headers.location });
      }
      if (status !== 200) {
        res.resume();
        return finish(reject, new Error(`HTTP ${status}`));
      }

      const contentLength = Number(res.headers['content-length'] || 0);
      if (contentLength && contentLength > maxBytes) {
        res.destroy();
        return finish(reject, new Error(`Content-Length ${contentLength} exceeds max ${maxBytes} bytes`));
      }

      finish(resolve, { redirect: false, stream: res, request: req, contentLength });
    });

    req.on('error', (err) => finish(reject, err));
    req.end();
  });
}

function pipeWithInactivityGuard(source, request, validator, timeoutMs, contentLength) {
  let sourceEnded = false;
  let terminal = false;
  let timer = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const fail = (error) => {
    if (terminal) return;
    terminal = true;
    clear();
    if (!source.destroyed) source.destroy(error);
    if (request && !request.destroyed) request.destroy(error);
    if (!validator.destroyed) validator.destroy(error);
  };
  const reset = () => {
    clear();
    timer = setTimeout(() => fail(new Error(`Brochure download inactive for ${timeoutMs}ms during download-stream`)), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  };

  reset();
  source.on('data', reset);
  source.once('end', () => {
    sourceEnded = true;
    terminal = true;
    clear();
  });
  source.once('aborted', () => fail(new Error('Brochure download aborted during download-stream')));
  source.once('error', (error) => fail(error));
  source.once('close', () => {
    if (sourceEnded || terminal) return;
    const expected = contentLength ? ` before ${contentLength} expected bytes completed` : '';
    fail(new Error(`Brochure download closed prematurely${expected} during download-stream`));
  });
  validator.once('error', (error) => {
    clear();
    if (!source.destroyed) source.destroy(error);
    if (request && !request.destroyed) request.destroy(error);
  });
  validator.once('close', clear);
  source.pipe(validator);
}

function createPdfValidationStream(maxBytes, observer) {
  let total = 0;
  let firstBytes = Buffer.alloc(0);
  let validated = false;

  const validator = new Transform({
    transform(chunk, enc, cb) {
      total += chunk.length;
      observer?.({ stage: validated ? 'download-progress' : 'download-first-byte', downloadedBytes: total });
      if (total > maxBytes) return cb(new Error(`Download exceeded max size of ${maxBytes} bytes`));

      if (validated) {
        this.push(chunk);
        return cb();
      }

      const needed = Math.min(5 - firstBytes.length, chunk.length);
      if (needed > 0) firstBytes = Buffer.concat([firstBytes, chunk.subarray(0, needed)]);
      if (firstBytes.length < 5) return cb();
      if (firstBytes.toString('latin1') !== '%PDF-') return cb(new Error('Response failed PDF signature validation'));

      validated = true;
      this.push(firstBytes);
      if (chunk.length > needed) this.push(chunk.subarray(needed));
      return cb();
    },
    flush(cb) {
      if (!validated) return cb(new Error(firstBytes.length ? 'Response failed PDF signature validation' : 'Empty response body'));
      observer?.({ stage: 'download-end', downloadedBytes: total });
      return cb();
    }
  });

  validator.getSize = () => total;
  return validator;
}

async function openPdfStreamSafely(rawUrl, opts = {}) {
  const timeoutMs = Math.min(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxBytes = Math.min(Number(opts.maxBytes) || DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
  const allowPrivateNetworks = opts.allowPrivateNetworks === true;
  const observer = typeof opts.observer === 'function' ? opts.observer : null;
  observer?.({ stage: 'download-open-start' });

  let current = rawUrl;
  try {
    assertPublicHttpUrl(current, { allowPrivateNetworks });
  } catch (e) {
    return { ok: false, error: e.message };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let result;
    try {
      result = await requestStreamOnce(current, { timeoutMs, maxBytes, allowPrivateNetworks });
    } catch (e) {
      observer?.({ stage: 'download-error', error: e.message });
      return { ok: false, error: e.message };
    }

    if (result.redirect) {
      if (hop === MAX_REDIRECTS) return { ok: false, error: 'Too many redirects' };
      let next;
      try {
        next = new URL(result.location, current).toString();
        assertPublicHttpUrl(next, { allowPrivateNetworks });
      } catch (e) {
        return { ok: false, error: `Invalid or blocked redirect target: ${e.message}` };
      }
      current = next;
      continue;
    }

    observer?.({ stage: 'download-response-start', contentLength: Number(result.contentLength || 0) || null });
    const validator = createPdfValidationStream(maxBytes, observer);
    pipeWithInactivityGuard(result.stream, result.request, validator, timeoutMs, Number(result.contentLength || 0));
    observer?.({ stage: 'download-open-end' });
    return { ok: true, stream: validator, contentType: 'application/pdf', contentLength: Number(result.contentLength || 0) || null, getSize: validator.getSize };
  }
  return { ok: false, error: 'Too many redirects' };
}

/**
 * Downloads a remote PDF with SSRF protection, size/time bounds and a
 * magic-byte signature check. Never throws — always resolves to
 * { ok, buffer?, contentType?, size?, error? }.
 */
async function downloadPdfSafely(rawUrl, opts = {}) {
  const timeoutMs = Math.min(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxBytes = Math.min(Number(opts.maxBytes) || DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
  const allowPrivateNetworks = opts.allowPrivateNetworks === true; // test-only, never set by the migration service

  let current = rawUrl;
  try {
    assertPublicHttpUrl(current, { allowPrivateNetworks });
  } catch (e) {
    return { ok: false, error: e.message };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let result;
    try {
      result = await requestOnce(current, { timeoutMs, maxBytes, allowPrivateNetworks });
    } catch (e) {
      return { ok: false, error: e.message };
    }

    if (result.redirect) {
      if (hop === MAX_REDIRECTS) return { ok: false, error: 'Too many redirects' };
      let next;
      try {
        next = new URL(result.location, current).toString();
        assertPublicHttpUrl(next, { allowPrivateNetworks });
      } catch (e) {
        return { ok: false, error: `Invalid or blocked redirect target: ${e.message}` };
      }
      current = next;
      continue;
    }

    const { buffer, contentType } = result;
    if (!buffer || !buffer.length) return { ok: false, error: 'Empty response body' };
    const looksLikePdf = buffer.slice(0, 5).toString('latin1') === '%PDF-';
    if (!looksLikePdf) return { ok: false, error: 'Response failed PDF signature validation' };
    void contentType; // content-type header is informational only; magic bytes are authoritative
    return { ok: true, buffer, contentType: 'application/pdf', size: buffer.length };
  }
  return { ok: false, error: 'Too many redirects' };
}

function normalizeMimeType(raw) {
  const normalized = String(raw || '').split(';')[0].trim().toLowerCase();
  if (!normalized) return '';
  return IMAGE_MIME_ALIASES[normalized] || normalized;
}

function detectImageMimeType(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) return 'image/png';
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString('ascii');
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  }
  return null;
}

async function downloadMediaSafely(rawUrl, opts = {}) {
  const timeoutMs = Math.min(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxBytes = Math.min(Number(opts.maxBytes) || DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
  const allowPrivateNetworks = opts.allowPrivateNetworks === true;
  const expectedKind = String(opts.kind || 'image').trim().toLowerCase();

  let current = rawUrl;
  try {
    assertPublicHttpUrl(current, { allowPrivateNetworks });
  } catch (e) {
    return { ok: false, error: e.message };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let result;
    try {
      result = await requestOnce(current, { timeoutMs, maxBytes, allowPrivateNetworks });
    } catch (e) {
      return { ok: false, error: e.message };
    }

    if (result.redirect) {
      if (hop === MAX_REDIRECTS) return { ok: false, error: 'Too many redirects' };
      let next;
      try {
        next = new URL(result.location, current).toString();
        assertPublicHttpUrl(next, { allowPrivateNetworks });
      } catch (e) {
        return { ok: false, error: `Invalid or blocked redirect target: ${e.message}` };
      }
      current = next;
      continue;
    }

    const { buffer, contentType } = result;
    if (!buffer || !buffer.length) return { ok: false, error: 'Empty response body' };

    if (expectedKind === 'pdf') {
      if (buffer.slice(0, 5).toString('latin1') !== '%PDF-') return { ok: false, error: 'Response failed PDF signature validation' };
      return { ok: true, buffer, contentType: 'application/pdf', size: buffer.length };
    }

    if (expectedKind === 'image') {
      const detected = detectImageMimeType(buffer);
      const headerMime = normalizeMimeType(contentType);
      if (!detected) return { ok: false, error: 'Response failed image signature validation' };
      if (!ALLOWED_IMAGE_MIME_TYPES.has(detected)) return { ok: false, error: `Unsupported image type: ${detected}` };
      if (headerMime && headerMime !== 'application/octet-stream' && !headerMime.startsWith('image/')) {
        return { ok: false, error: `Invalid image Content-Type: ${headerMime}` };
      }
      if (headerMime && headerMime.startsWith('image/') && normalizeMimeType(headerMime) !== detected && opts.allowImageHeaderMismatch !== true) {
        return { ok: false, error: `Image MIME mismatch: header=${headerMime} detected=${detected}` };
      }
      return { ok: true, buffer, contentType: detected, size: buffer.length };
    }

    return { ok: false, error: `Unsupported download kind: ${expectedKind}` };
  }
  return { ok: false, error: 'Too many redirects' };
}

function __setDnsLookupForTests(lookup) {
  dnsLookup = lookup;
}

function __resetForTests() {
  dnsLookup = dns.lookup;
}

module.exports = {
  downloadPdfSafely,
  downloadMediaSafely,
  openPdfStreamSafely,
  assertPublicHttpUrl,
  safeLookup,
  __setDnsLookupForTests,
  __resetForTests,
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS
};
