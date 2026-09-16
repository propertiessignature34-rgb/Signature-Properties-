'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { JsonRepository } = require('../src/data/repository');
const objectStorage = require('../src/services/objectStorageService');
const brochureExtractionService = require('../src/services/brochureExtractionService');
const { makeDbFile } = require('./admin-test-utils');
const { __test: serverTest } = require('../server');

const PDF_BYTES = Buffer.from('%PDF-1.4\n%manual brochure regression\n%%EOF');
const ORIGINAL_EXTRACT_BROCHURE = brochureExtractionService.extractBrochure;

function makeFakeBucket(options = {}) {
  const files = new Map();
  let nextId = 1;

  return {
    find(query = {}) {
      let rows = Array.from(files.values());
      if (query.filename) rows = rows.filter((file) => file.filename === query.filename);
      return {
        sort() { return this; },
        async toArray() { return rows.slice().sort((a, b) => b.uploadDate - a.uploadDate); }
      };
    },
    openUploadStream(filename, uploadOptions = {}) {
      const chunks = [];
      const writable = new Writable({
        write(chunk, _encoding, callback) {
          if (options.failUpload) {
            callback(new Error('simulated upload failure'));
            return;
          }
          chunks.push(Buffer.from(chunk));
          callback();
        }
      });
      writable.id = nextId++;
      writable.on('finish', () => {
        const buffer = Buffer.concat(chunks);
        files.set(writable.id, {
          _id: writable.id,
          filename,
          length: buffer.length,
          metadata: uploadOptions.metadata || {},
          uploadDate: Date.now(),
          buffer
        });
      });
      return writable;
    },
    openDownloadStream(id) {
      const file = files.get(id);
      if (!file) {
        const stream = new Readable({ read() {} });
        process.nextTick(() => stream.emit('error', new Error('FileNotFound')));
        return stream;
      }
      return Readable.from(file.buffer);
    },
    async delete(id) {
      files.delete(id);
    }
  };
}

function makeRuntime(repository) {
  return {
    repository,
    resolveAuthenticatedActor() {
      return { ok: true, actor: { userId: 'USR-test', role: 'ADMIN', permissions: ['*'] } };
    }
  };
}

function makeRequest(pathname, { method = 'POST', body } = {}) {
  const chunks = body === undefined ? [] : [JSON.stringify(body)];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = pathname;
  req.headers = { host: '127.0.0.1' };
  if (body !== undefined) req.headers['content-type'] = 'application/json';
  return req;
}

function makeResponse() {
  let statusCode = null;
  let headers = {};
  const chunks = [];
  let resolveEnd;
  const ended = new Promise((resolve) => { resolveEnd = resolve; });
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      callback();
    }
  });
  res.writeHead = (code, nextHeaders = {}) => {
    statusCode = code;
    headers = nextHeaders;
  };
  res.end = (chunk) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    resolveEnd();
  };
  return {
    res,
    ended,
    snapshot() {
      const bodyBuffer = Buffer.concat(chunks);
      let payload = null;
      const contentType = String(headers['Content-Type'] || headers['content-type'] || '').toLowerCase();
      if (bodyBuffer.length && contentType.includes('application/json')) {
        payload = JSON.parse(bodyBuffer.toString('utf8'));
      }
      return { statusCode, headers, bodyBuffer, payload };
    }
  };
}

async function callApi(pathname, options = {}) {
  const req = makeRequest(pathname, options);
  const response = makeResponse();
  await serverTest.handleApi(req, response.res, new URL(req.url, `http://${req.headers.host}`));
  await response.ended;
  return response.snapshot();
}

function brochureDataUri(buffer = PDF_BYTES) {
  return `data:application/pdf;base64,${buffer.toString('base64')}`;
}

function toBulkCreatePayload(data) {
  return {
    ProjectName: data.ProjectName || 'Untitled Project',
    BuilderName: data.BuilderName || 'Unknown Builder',
    Location1: data.Location1 || 'Surat',
    Address: data.Address || null,
    RERANumber: data.RERANumber || null,
    Category: data.Category || 'Residential',
    ProjectStatus: data.ProjectStatus || 'Under Construction',
    ConfigDetails: Array.isArray(data.ConfigDetails) ? data.ConfigDetails : [],
    TotalUnits: data.TotalUnits || null,
    PriceMin: data.PriceMin || null,
    PriceMax: data.PriceMax || null,
    PossessionDate: data.PossessionDate || null,
    Amenities: Array.isArray(data.Amenities) ? data.Amenities : []
  };
}

test.beforeEach(() => {
  objectStorage.__resetForTests();
  brochureExtractionService.extractBrochure = ORIGINAL_EXTRACT_BROCHURE;
  serverTest.setRuntimeForTest(null);
});

test.afterEach(() => {
  objectStorage.__resetForTests();
  brochureExtractionService.extractBrochure = ORIGINAL_EXTRACT_BROCHURE;
  serverTest.setRuntimeForTest(null);
});

test('manual brochure upload stores brochure metadata and serves the uploaded PDF back', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const repository = new JsonRepository(makeDbFile('sig-brochure-upload-'));
  serverTest.setRuntimeForTest(makeRuntime(repository));

  const created = await callApi('/api/v2/builder-projects', {
    body: { ProjectName: 'Signature Heights', BuilderName: 'Signature Realty', Location1: 'Vesu' }
  });
  assert.equal(created.statusCode, 201);
  const projectId = created.payload.data.ProjectID;

  const upload = await callApi(`/api/v2/builder-projects/${projectId}/media`, {
    body: { kind: 'brochure', filename: 'signature-heights.pdf', fileBase64: brochureDataUri() }
  });
  assert.equal(upload.statusCode, 200);
  assert.equal(upload.payload.ok, true);
  assert.equal(upload.payload.data.Brochures.length, 1);
  assert.equal(upload.payload.data.Brochures[0].Filename, 'signature-heights.pdf');
  assert.equal(upload.payload.data.Brochures[0].UploadedBy, 'USR-test');
  assert.match(upload.payload.data.Brochures[0].StoragePath, new RegExp(`^builder-projects/${projectId}/brochures/`));

  const stored = repository.read().BuilderProjects.find((project) => project.ProjectID === projectId);
  assert.equal(stored.Brochures.length, 1);

  const mediaId = upload.payload.data.Brochures[0].MediaID;
  const fetched = await callApi(`/api/v2/builder-projects/media/${mediaId}`, { method: 'GET' });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.headers['Content-Type'], 'application/pdf');
  assert.equal(fetched.bodyBuffer.toString(), PDF_BYTES.toString());
});

test('manual brochure upload failure returns an error and does not persist brochure metadata', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket({ failUpload: true }));
  const repository = new JsonRepository(makeDbFile('sig-brochure-upload-fail-'));
  serverTest.setRuntimeForTest(makeRuntime(repository));

  const created = await callApi('/api/v2/builder-projects', {
    body: { ProjectName: 'Upload Failure Tower', BuilderName: 'Signature Realty', Location1: 'Vesu' }
  });
  assert.equal(created.statusCode, 201);
  const projectId = created.payload.data.ProjectID;

  const upload = await callApi(`/api/v2/builder-projects/${projectId}/media`, {
    body: { kind: 'brochure', filename: 'broken-brochure.pdf', fileBase64: brochureDataUri() }
  });
  assert.equal(upload.statusCode, 400);
  assert.equal(upload.payload.ok, false);
  assert.match(upload.payload.error, /Upload failed: simulated upload failure/);

  const stored = repository.read().BuilderProjects.find((project) => project.ProjectID === projectId);
  assert.deepEqual(stored.Brochures || [], []);
});

test('manual brochure upload validates that fileBase64 is required', async () => {
  objectStorage.__setBucketForTests(makeFakeBucket());
  const repository = new JsonRepository(makeDbFile('sig-brochure-upload-validate-'));
  serverTest.setRuntimeForTest(makeRuntime(repository));

  const created = await callApi('/api/v2/builder-projects', {
    body: { ProjectName: 'Validation Tower', BuilderName: 'Signature Realty', Location1: 'Vesu' }
  });
  assert.equal(created.statusCode, 201);

  const upload = await callApi(`/api/v2/builder-projects/${created.payload.data.ProjectID}/media`, {
    body: { kind: 'brochure', filename: 'missing.pdf' }
  });
  assert.equal(upload.statusCode, 400);
  assert.equal(upload.payload.ok, false);
  assert.match(upload.payload.error, /fileBase64 required/);
});

test('extract brochure route returns extracted structured brochure data', async () => {
  const repository = new JsonRepository(makeDbFile('sig-brochure-extract-'));
  serverTest.setRuntimeForTest(makeRuntime(repository));

  const extracted = {
    ProjectName: 'Brochure Heights',
    BuilderName: 'Brochure Builders',
    Location1: 'Adajan',
    Address: 'Adajan, Surat',
    RERANumber: 'PR/GJ/SURAT/123/2026',
    Category: 'Residential',
    ProjectStatus: 'Under Construction',
    TotalUnits: 48,
    PriceMin: 8500000,
    PriceMax: 12000000,
    PossessionDate: '2028-12-31',
    Amenities: ['Gym', 'Pool'],
    ConfigDetails: [{ Type: '2 BHK', AreaSqft: 1100 }]
  };
  let capturedFileBase64 = null;
  brochureExtractionService.extractBrochure = async (fileBase64) => {
    capturedFileBase64 = fileBase64;
    return extracted;
  };

  const response = await callApi('/api/v2/builder-projects/extract-brochure', {
    body: { filename: 'brochure.pdf', fileBase64: brochureDataUri() }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.deepEqual(response.payload.data, extracted);
  assert.equal(capturedFileBase64, brochureDataUri());
});

test('extract brochure route validates that fileBase64 is required', async () => {
  const repository = new JsonRepository(makeDbFile('sig-brochure-extract-validate-'));
  serverTest.setRuntimeForTest(makeRuntime(repository));

  const response = await callApi('/api/v2/builder-projects/extract-brochure', {
    body: { filename: 'brochure.pdf' }
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.ok, false);
  assert.match(response.payload.error, /fileBase64 required/);
});

test('extract brochure route returns 500 when extraction fails', async () => {
  const repository = new JsonRepository(makeDbFile('sig-brochure-extract-fail-'));
  serverTest.setRuntimeForTest(makeRuntime(repository));

  brochureExtractionService.extractBrochure = async () => {
    throw new Error('Extraction failed upstream');
  };

  const response = await callApi('/api/v2/builder-projects/extract-brochure', {
    body: { filename: 'brochure.pdf', fileBase64: brochureDataUri() }
  });
  assert.equal(response.statusCode, 500);
  assert.equal(response.payload.ok, false);
  assert.match(response.payload.error, /Extraction failed upstream/);
});

test('bulk-from-brochures workflow can extract multiple brochures and create projects from the extracted payloads', async () => {
  const repository = new JsonRepository(makeDbFile('sig-brochure-bulk-'));
  serverTest.setRuntimeForTest(makeRuntime(repository));

  const extractedQueue = [
    {
      ProjectName: 'Tower One',
      BuilderName: 'Builder Alpha',
      Location1: 'Vesu',
      Address: 'Vesu, Surat',
      RERANumber: 'PR/GJ/SURAT/ALPHA/2026',
      Category: 'Residential',
      ProjectStatus: 'New Launch',
      TotalUnits: 120,
      PriceMin: 9000000,
      PriceMax: 14000000,
      PossessionDate: '2029-03-31',
      Amenities: ['Gym'],
      ConfigDetails: [{ Type: '2 BHK', AreaSqft: 950 }, { Type: '3 BHK', AreaSqft: 1250 }]
    },
    {
      ProjectName: 'Commerce Square',
      BuilderName: null,
      Location1: null,
      Address: 'VIP Road, Surat',
      RERANumber: null,
      Category: 'Commercial',
      ProjectStatus: 'Ready to Move',
      TotalUnits: 16,
      PriceMin: 15000000,
      PriceMax: 18000000,
      PossessionDate: null,
      Amenities: ['Parking'],
      ConfigDetails: [{ Type: 'Office', AreaSqft: 800 }]
    }
  ];
  brochureExtractionService.extractBrochure = async () => {
    if (!extractedQueue.length) throw new Error('Unexpected extra extract-brochure call');
    const nextExtracted = extractedQueue[0];
    extractedQueue.splice(0, 1);
    return nextExtracted;
  };

  const extractedRows = [];
  for (let index = 0; index < 2; index += 1) {
    const extracted = await callApi('/api/v2/builder-projects/extract-brochure', {
      body: { filename: `brochure-${index + 1}.pdf`, fileBase64: brochureDataUri(Buffer.from(`${PDF_BYTES}\n${index}`)) }
    });
    assert.equal(extracted.statusCode, 200);
    extractedRows.push(extracted.payload.data);
  }

  for (const row of extractedRows) {
    const created = await callApi('/api/v2/builder-projects', { body: toBulkCreatePayload(row) });
    assert.equal(created.statusCode, 201);
    assert.equal(created.payload.ok, true);
  }

  const listed = await callApi('/api/v2/builder-projects', { method: 'GET' });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.payload.count, 2);

  const first = listed.payload.data.find((project) => project.ProjectName === 'Tower One');
  const second = listed.payload.data.find((project) => project.ProjectName === 'Commerce Square');
  assert.ok(first);
  assert.ok(second);
  assert.deepEqual(first.Configurations, ['2 BHK', '3 BHK']);
  assert.deepEqual(first.AreaRange, { min: 950, max: 1250 });
  assert.equal(second.BuilderName, 'Unknown Builder');
  assert.equal(second.Location1, 'Surat');
  assert.deepEqual(second.Configurations, ['Office']);
});

test('bulk-from-brochures workflow can still create valid projects when one extraction fails', async () => {
  const repository = new JsonRepository(makeDbFile('sig-brochure-bulk-partial-'));
  serverTest.setRuntimeForTest(makeRuntime(repository));

  const extractedQueue = [
    {
      ProjectName: null,
      BuilderName: null,
      Location1: null,
      Address: 'Surat',
      RERANumber: null,
      Category: null,
      ProjectStatus: null,
      TotalUnits: null,
      PriceMin: null,
      PriceMax: null,
      PossessionDate: null,
      Amenities: [],
      ConfigDetails: []
    },
    new Error('Gemini timeout')
  ];
  brochureExtractionService.extractBrochure = async () => {
    if (!extractedQueue.length) throw new Error('Unexpected extra extract-brochure call');
    const nextExtracted = extractedQueue[0];
    extractedQueue.splice(0, 1);
    if (nextExtracted instanceof Error) throw nextExtracted;
    return nextExtracted;
  };

  const extracted = await callApi('/api/v2/builder-projects/extract-brochure', {
    body: { filename: 'brochure-1.pdf', fileBase64: brochureDataUri(Buffer.from(`${PDF_BYTES}\na`)) }
  });
  assert.equal(extracted.statusCode, 200);

  const failed = await callApi('/api/v2/builder-projects/extract-brochure', {
    body: { filename: 'brochure-2.pdf', fileBase64: brochureDataUri(Buffer.from(`${PDF_BYTES}\nb`)) }
  });
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.payload.ok, false);
  assert.match(failed.payload.error, /Gemini timeout/);

  const created = await callApi('/api/v2/builder-projects', { body: toBulkCreatePayload(extracted.payload.data) });
  assert.equal(created.statusCode, 201);
  assert.equal(created.payload.data.ProjectName, 'Untitled Project');
  assert.equal(created.payload.data.BuilderName, 'Unknown Builder');
  assert.equal(created.payload.data.Location1, 'Surat');

  const listed = await callApi('/api/v2/builder-projects', { method: 'GET' });
  assert.equal(listed.payload.count, 1);
});
