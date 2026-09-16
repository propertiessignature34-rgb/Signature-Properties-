'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const downloader = require('../src/services/safeUrlDownloader');

const PDF_BYTES = Buffer.from('%PDF-1.4\nstream\n%%EOF');

function lookupWith(records) {
  return (_hostname, _options, callback) => callback(null, records);
}

function lookupError(message) {
  return (_hostname, _options, callback) => callback(new Error(message));
}

function runSafeLookup(records, options = {}) {
  return new Promise((resolve, reject) => {
    downloader.safeLookup('cdn.example.com', options, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await fn(`http://127.0.0.1:${server.address().port}/file.pdf`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function drain(stream) {
  let bytes = 0;
  await pipeline(stream, new Writable({
    write(chunk, _enc, callback) {
      bytes += chunk.length;
      callback();
    }
  }));
  return bytes;
}

test.beforeEach(() => downloader.__resetForTests());
test.after(() => downloader.__resetForTests());

test('safeLookup accepts a normal public IPv4 DNS result', async () => {
  downloader.__setDnsLookupForTests(lookupWith([{ address: '8.8.8.8', family: 4 }]));
  assert.deepEqual(await runSafeLookup(), { address: '8.8.8.8', family: 4 });
});

test('safeLookup returns Node-compatible DNS record array when options.all is true', async () => {
  downloader.__setDnsLookupForTests(lookupWith([
    { address: '8.8.8.8', family: 4 },
    { address: '2001:4860:4860::8888', family: 6 }
  ]));
  const { address, family } = await runSafeLookup([], { all: true });
  assert.deepEqual(address, [
    { address: '8.8.8.8', family: 4 },
    { address: '2001:4860:4860::8888', family: 6 }
  ]);
  assert.equal(family, undefined);
});

test('safeLookup returns address/family callback shape when options.all is false', async () => {
  downloader.__setDnsLookupForTests(lookupWith([{ address: '8.8.4.4', family: 4 }]));
  assert.deepEqual(await runSafeLookup([], { all: false }), { address: '8.8.4.4', family: 4 });
});

test('safeLookup accepts a normal public IPv6 DNS result', async () => {
  downloader.__setDnsLookupForTests(lookupWith([{ address: '2001:4860:4860::8888', family: 6 }]));
  assert.deepEqual(await runSafeLookup(), { address: '2001:4860:4860::8888', family: 6 });
});

test('safeLookup rejects missing or undefined DNS addresses without calling BlockList', async () => {
  downloader.__setDnsLookupForTests(lookupWith([{ address: undefined, family: 4 }]));
  await assert.rejects(() => runSafeLookup(), /invalid address record/i);
});

test('safeLookup rejects mixed valid and malformed DNS result sets', async () => {
  downloader.__setDnsLookupForTests(lookupWith([
    { address: '8.8.8.8', family: 4 },
    { family: 6 }
  ]));
  await assert.rejects(() => runSafeLookup(), /invalid address record/i);
});

test('safeLookup keeps private IPv4 addresses blocked', async () => {
  downloader.__setDnsLookupForTests(lookupWith([{ address: '10.1.2.3', family: 4 }]));
  await assert.rejects(() => runSafeLookup(), /blocked/i);
});

test('safeLookup keeps private IPv6 addresses blocked', async () => {
  downloader.__setDnsLookupForTests(lookupWith([{ address: 'fc00::1234', family: 6 }]));
  await assert.rejects(() => runSafeLookup(), /blocked/i);
});

test('safeLookup blocks DNS rebinding answer sets containing a private address', async () => {
  downloader.__setDnsLookupForTests(lookupWith([
    { address: '8.8.8.8', family: 4 },
    { address: '169.254.169.254', family: 4 }
  ]));
  await assert.rejects(() => runSafeLookup(), /blocked/i);
});

test('safeLookup forwards DNS errors without allowing a connection', async () => {
  downloader.__setDnsLookupForTests(lookupError('DNS lookup failed'));
  await assert.rejects(() => runSafeLookup(), /DNS lookup failed/);
});

test('localhost remains blocked before DNS lookup', () => {
  assert.throws(() => downloader.assertPublicHttpUrl('https://localhost/brochure.pdf'), /blocked/i);
});

test('a public HTTPS brochure URL remains allowed before DNS resolution', () => {
  const url = downloader.assertPublicHttpUrl('https://cdn.example.com/brochure.pdf');
  assert.equal(url.hostname, 'cdn.example.com');
});

test('openPdfStreamSafely reaches the exact canary URL without an invalid IP callback error', async () => {
  const url = 'https://karmagroup.co.in/images/projects/769/639102094467578063.pdf';
  const out = await downloader.openPdfStreamSafely(url, { timeoutMs: 10000, maxBytes: 1024 });
  assert.notEqual(out.error, 'Invalid IP address: undefined');
  assert.equal(out.ok, false);
  assert.match(out.error, /Content-Length .* exceeds max|getaddrinfo ENOTFOUND/i);
});

test('openPdfStreamSafely completes normal multi-chunk streaming without timeout', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(PDF_BYTES.length) });
    res.write(PDF_BYTES.subarray(0, 8));
    setTimeout(() => res.end(PDF_BYTES.subarray(8)), 20);
  }, async (url) => {
    const out = await downloader.openPdfStreamSafely(url, { allowPrivateNetworks: true, timeoutMs: 200, maxBytes: 1024 });
    assert.equal(out.ok, true);
    assert.equal(await drain(out.stream), PDF_BYTES.length);
    assert.equal(out.getSize(), PDF_BYTES.length);
  });
});

test('openPdfStreamSafely fails an inactive body and does not leave pipeline pending', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(PDF_BYTES.length + 1000) });
    res.write(PDF_BYTES.subarray(0, 8));
  }, async (url) => {
    const out = await downloader.openPdfStreamSafely(url, { allowPrivateNetworks: true, timeoutMs: 100, maxBytes: 4096 });
    assert.equal(out.ok, true);
    await assert.rejects(() => drain(out.stream), /inactive for 100ms during download-stream/);
  });
});

test('openPdfStreamSafely resets inactivity timeout when progress continues', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(PDF_BYTES.length) });
    let index = 0;
    const chunks = [PDF_BYTES.subarray(0, 5), PDF_BYTES.subarray(5, 12), PDF_BYTES.subarray(12)];
    const writeNext = () => {
      if (index >= chunks.length) return res.end();
      res.write(chunks[index]);
      index += 1;
      setTimeout(writeNext, 50);
    };
    writeNext();
  }, async (url) => {
    const out = await downloader.openPdfStreamSafely(url, { allowPrivateNetworks: true, timeoutMs: 120, maxBytes: 1024 });
    assert.equal(out.ok, true);
    assert.equal(await drain(out.stream), PDF_BYTES.length);
  });
});

test('openPdfStreamSafely propagates source socket errors to the returned stream', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(PDF_BYTES.length + 1000) });
    res.write(PDF_BYTES.subarray(0, 8));
    setTimeout(() => req.socket.destroy(new Error('synthetic socket failure')), 20);
  }, async (url) => {
    const out = await downloader.openPdfStreamSafely(url, { allowPrivateNetworks: true, timeoutMs: 500, maxBytes: 4096 });
    assert.equal(out.ok, true);
    await assert.rejects(() => drain(out.stream), /aborted|closed prematurely|socket hang up|synthetic/i);
  });
});

test('openPdfStreamSafely propagates aborted responses to the returned stream', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(PDF_BYTES.length + 1000) });
    res.write(PDF_BYTES.subarray(0, 8));
    setTimeout(() => res.destroy(), 20);
  }, async (url) => {
    const out = await downloader.openPdfStreamSafely(url, { allowPrivateNetworks: true, timeoutMs: 500, maxBytes: 4096 });
    assert.equal(out.ok, true);
    await assert.rejects(() => drain(out.stream), /aborted|closed prematurely|socket hang up/i);
  });
});

test('openPdfStreamSafely rejects premature close before declared Content-Length completes', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(PDF_BYTES.length + 1000) });
    res.write(PDF_BYTES.subarray(0, 8));
    req.socket.end();
  }, async (url) => {
    const out = await downloader.openPdfStreamSafely(url, { allowPrivateNetworks: true, timeoutMs: 500, maxBytes: 4096 });
    assert.equal(out.ok, true);
    await assert.rejects(() => drain(out.stream), /closed prematurely|aborted/i);
  });
});

test('openPdfStreamSafely treats clean end and close as success', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(PDF_BYTES.length) });
    res.end(PDF_BYTES);
  }, async (url) => {
    const out = await downloader.openPdfStreamSafely(url, { allowPrivateNetworks: true, timeoutMs: 100, maxBytes: 1024 });
    assert.equal(out.ok, true);
    assert.equal(await drain(out.stream), PDF_BYTES.length);
  });
});

test('openPdfStreamSafely still rejects invalid PDF magic while streaming', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': '12' });
    res.end('not a pdf!!!');
  }, async (url) => {
    const out = await downloader.openPdfStreamSafely(url, { allowPrivateNetworks: true, timeoutMs: 200, maxBytes: 1024 });
    assert.equal(out.ok, true);
    await assert.rejects(() => drain(out.stream), /PDF signature validation/);
  });
});

test('openPdfStreamSafely still rejects oversized streamed content', async () => {
  await withServer((req, res) => {
    const body = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(200, 65)]);
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end(body);
  }, async (url) => {
    const out = await downloader.openPdfStreamSafely(url, { allowPrivateNetworks: true, timeoutMs: 200, maxBytes: 100 });
    assert.equal(out.ok, true);
    await assert.rejects(() => drain(out.stream), /exceeded max size/i);
  });
});

test('openPdfStreamSafely production-style stalled body fails within bounded time', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(4 * 1024 * 1024) });
    res.write(Buffer.from('%PDF-'));
    res.write(Buffer.alloc(256 * 1024, 65));
  }, async (url) => {
    const started = Date.now();
    const out = await downloader.openPdfStreamSafely(url, { allowPrivateNetworks: true, timeoutMs: 150, maxBytes: 8 * 1024 * 1024 });
    assert.equal(out.ok, true);
    await assert.rejects(() => drain(out.stream), /inactive for 150ms during download-stream/);
    assert.ok(Date.now() - started < 1500, 'stalled stream must not wait for the outer project watchdog');
  });
});

test('downloadMediaSafely accepts valid PNG image with image content-type', async () => {
  await withServer((req, res) => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
  }, async (url) => {
    const out = await downloader.downloadMediaSafely(url, { kind: 'image', allowPrivateNetworks: true, timeoutMs: 200, maxBytes: 1024 });
    assert.equal(out.ok, true);
    assert.equal(out.contentType, 'image/png');
  });
});

test('downloadMediaSafely can accept signature-valid image bytes when a trusted source mislabels the image header', async () => {
  await withServer((req, res) => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(png);
  }, async (url) => {
    const strict = await downloader.downloadMediaSafely(url, { kind: 'image', allowPrivateNetworks: true, timeoutMs: 200, maxBytes: 1024 });
    assert.equal(strict.ok, false);
    const trusted = await downloader.downloadMediaSafely(url, { kind: 'image', allowPrivateNetworks: true, allowImageHeaderMismatch: true, timeoutMs: 200, maxBytes: 1024 });
    assert.equal(trusted.ok, true);
    assert.equal(trusted.contentType, 'image/png');
  });
});

test('downloadMediaSafely rejects invalid image magic bytes', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.from('not-an-image'));
  }, async (url) => {
    const out = await downloader.downloadMediaSafely(url, { kind: 'image', allowPrivateNetworks: true, timeoutMs: 200, maxBytes: 1024 });
    assert.equal(out.ok, false);
    assert.match(out.error, /signature validation/i);
  });
});
