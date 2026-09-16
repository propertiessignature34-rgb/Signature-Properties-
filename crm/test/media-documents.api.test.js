const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { JsonRepository } = require('../src/data/repository');
const { V2Router } = require('../src/api/v2Router');
const { makeDbFile, requestJson, startServer, stopServer } = require('./admin-test-utils');
const { __test: serverTest } = require('../server');

function authHeaders(extra = {}) {
  return {
    'x-user-id': 'USR-SYSTEM-ADMIN',
    'x-user-role': 'ADMIN',
    'x-company-id': 'COMP-DEFAULT',
    'x-brokerage-id': 'BRK-DEFAULT',
    'x-test-session-auth': '1',
    ...extra
  };
}

function mediaPayload(overrides = {}) {
  return {
    EntityType: 'PROPERTY',
    EntityID: 'PROP-API-1',
    PropertyID: 'PROP-API-1',
    Title: 'API image',
    MediaType: 'IMAGE',
    StorageProvider: 'TEST_PROVIDER',
    StoragePath: '/tmp/media-1.jpg',
    MimeType: 'image/jpeg',
    SizeBytes: 1024,
    Checksum: 'abc123',
    Visibility: 'PUBLIC',
    ...overrides
  };
}

function documentPayload(overrides = {}) {
  return {
    EntityType: 'PROPERTY',
    EntityID: 'PROP-API-2',
    PropertyID: 'PROP-API-2',
    Title: 'API document',
    DocumentType: 'PROPERTY_DOCUMENT',
    StorageProvider: 'TEST_PROVIDER',
    StoragePath: '/tmp/doc-1.pdf',
    MimeType: 'application/pdf',
    SizeBytes: 2048,
    Checksum: 'doc123',
    Visibility: 'PUBLIC',
    ...overrides
  };
}

function makeRuntime(repository) {
  return {
    repository,
    resolveAuthenticatedActor(request = {}) {
      const headers = request.headers || {};
      const userId = headers['x-user-id'];
      if (!userId) return { ok: false, statusCode: 401, error: 'Unauthorized' };
      return {
        ok: true,
        actor: {
          userId,
          role: String(headers['x-user-role'] || 'AGENT').toUpperCase(),
          companyId: headers['x-company-id'] || '',
          brokerageId: headers['x-brokerage-id'] || '',
          permissions: ['*'],
          user: null
        }
      };
    }
  };
}

function makeRequest(pathname, { method = 'GET', headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [JSON.stringify(body)];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = pathname;
  req.headers = { host: '127.0.0.1', ...headers };
  if (body !== undefined && !req.headers['content-type']) req.headers['content-type'] = 'application/json';
  return req;
}

function makeResponse() {
  let statusCode = null;
  let responseHeaders = {};
  const chunks = [];
  let resolveEnd;
  const ended = new Promise((resolve) => { resolveEnd = resolve; });
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      callback();
    }
  });
  res.writeHead = (code, headers = {}) => {
    statusCode = code;
    responseHeaders = headers;
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
      return {
        statusCode,
        headers: responseHeaders,
        payload: bodyBuffer.length ? JSON.parse(bodyBuffer.toString('utf8')) : null
      };
    }
  };
}

async function callApiDirect(repository, pathname, options = {}) {
  const runtime = makeRuntime(repository);
  const v2Router = new V2Router(repository, (req) => {
    const auth = runtime.resolveAuthenticatedActor({ headers: req.headers || {} });
    return auth.ok ? auth.actor : null;
  });
  serverTest.setRuntimeForTest(runtime, v2Router);
  const req = makeRequest(pathname, options);
  const response = makeResponse();
  let thrown = null;
  try {
    await serverTest.handleApi(req, response.res, new URL(req.url, `http://${req.headers.host}`));
  } catch (error) {
    thrown = error;
    response.res.end();
  } finally {
    serverTest.setRuntimeForTest(null);
  }
  await response.ended;
  if (thrown) throw thrown;
  return response.snapshot();
}

test('create media via API', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload()
    });
    assert.equal(response.response.status, 201);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.MediaType, 'IMAGE');
    assert.equal(response.payload.data.Visibility, 'PUBLIC');
    assert.equal(response.payload.data.StoragePath, undefined);
  } finally {
    await stopServer(child);
  }
});

test('get media via API', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const created = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload({ Title: 'Media lookup' })
    });
    const response = await requestJson(baseUrl, `/api/media/${created.payload.data.MediaID}`, {
      headers: authHeaders()
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.Title, 'Media lookup');
    assert.equal(response.payload.data.StoragePath, undefined);
  } finally {
    await stopServer(child);
  }
});

test('delete/archive media via API', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const created = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload({ Title: 'DELETE media' })
    });
    const response = await requestJson(baseUrl, `/api/media/${created.payload.data.MediaID}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.DeletedAt !== null, true);
  } finally {
    await stopServer(child);
  }
});

test('create document via API', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/documents', {
      method: 'POST',
      headers: authHeaders(),
      body: documentPayload({ Title: 'API deed' })
    });
    assert.equal(response.response.status, 201);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.DocumentType, 'PROPERTY_DOCUMENT');
    assert.equal(response.payload.data.StoragePath, undefined);
  } finally {
    await stopServer(child);
  }
});

test('get document via API', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const created = await requestJson(baseUrl, '/api/documents', {
      method: 'POST',
      headers: authHeaders(),
      body: documentPayload({ Title: 'Doc lookup' })
    });
    const response = await requestJson(baseUrl, `/api/documents/${created.payload.data.DocumentID}`, {
      headers: authHeaders()
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.Title, 'Doc lookup');
    assert.equal(response.payload.data.StoragePath, undefined);
  } finally {
    await stopServer(child);
  }
});

test('delete/archive document via API', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const created = await requestJson(baseUrl, '/api/documents', {
      method: 'POST',
      headers: authHeaders(),
      body: documentPayload({ Title: 'DELETE doc' })
    });
    const response = await requestJson(baseUrl, `/api/documents/${created.payload.data.DocumentID}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.data.DeletedAt !== null, true);
  } finally {
    await stopServer(child);
  }
});

test('invalid visibility rejected by media API', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload({ Visibility: 'TOP_SECRET' })
    });
    assert.equal(response.response.status, 400);
    assert.equal(response.payload.ok, false);
    assert.match(response.payload.error, /Invalid visibility/);
  } finally {
    await stopServer(child);
  }
});

test('missing auth rejected', async () => {
  const repository = new JsonRepository(makeDbFile('sig-media-auth-'));
  const response = await callApiDirect(repository, '/api/documents', {
    method: 'POST',
    body: documentPayload()
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.ok, false);
});

test('unauthorized tenant rejected for media', async () => {
  const repository = new JsonRepository(makeDbFile('sig-media-tenant-'));
  const created = await callApiDirect(repository, '/api/media', {
    method: 'POST',
    headers: authHeaders({ 'x-company-id': 'COMP-OTHER' }),
    body: mediaPayload({ Title: 'Foreign media' })
  });
  const response = await callApiDirect(repository, `/api/media/${created.payload.data.MediaID}`, {
    headers: authHeaders({ 'x-company-id': 'COMP-API' })
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.ok, false);
});

test('private media hidden from other user', async () => {
  const repository = new JsonRepository(makeDbFile('sig-private-media-'));
  const created = await callApiDirect(repository, '/api/media', {
    method: 'POST',
    headers: authHeaders({ 'x-user-id': 'USR-PRIVATE-1' }),
    body: mediaPayload({ Title: 'Private media', Visibility: 'PRIVATE' })
  });
  const response = await callApiDirect(repository, `/api/media/${created.payload.data.MediaID}`, {
    headers: authHeaders({ 'x-user-id': 'USR-OTHER-1' })
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.ok, false);
});

test('private document hidden from other user', async () => {
  const repository = new JsonRepository(makeDbFile('sig-private-doc-'));
  const created = await callApiDirect(repository, '/api/documents', {
    method: 'POST',
    headers: authHeaders({ 'x-user-id': 'USR-DOC-PRIVATE' }),
    body: documentPayload({ Title: 'Private doc', Visibility: 'PRIVATE' })
  });
  const response = await callApiDirect(repository, `/api/documents/${created.payload.data.DocumentID}`, {
    headers: authHeaders({ 'x-user-id': 'USR-DOC-OTHER' })
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.ok, false);
});

test('invalid entity rejected by media API', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload({ EntityType: 'USER' })
    });
    assert.equal(response.response.status, 400);
    assert.equal(response.payload.ok, false);
    assert.match(response.payload.error, /Invalid entity type/);
  } finally {
    await stopServer(child);
  }
});

test('invalid MIME rejected by document API', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/documents', {
      method: 'POST',
      headers: authHeaders(),
      body: documentPayload({ MimeType: 'not-valid' })
    });
    assert.equal(response.response.status, 400);
    assert.equal(response.payload.ok, false);
    assert.match(response.payload.error, /Invalid MIME type/);
  } finally {
    await stopServer(child);
  }
});

test('invalid size rejected by media API', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const response = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload({ SizeBytes: 0 })
    });
    assert.equal(response.response.status, 400);
    assert.equal(response.payload.ok, false);
    assert.match(response.payload.error, /Invalid size/);
  } finally {
    await stopServer(child);
  }
});

test('response DTOs do not expose private storage or tenant metadata', async () => {
  const dbFile = makeDbFile();
  const { child, baseUrl } = await startServer(dbFile);
  try {
    const media = await requestJson(baseUrl, '/api/media', {
      method: 'POST',
      headers: authHeaders(),
      body: mediaPayload({ Title: 'Sanitized media' })
    });
    const document = await requestJson(baseUrl, '/api/documents', {
      method: 'POST',
      headers: authHeaders(),
      body: documentPayload({ Title: 'Sanitized doc' })
    });
    assert.equal(media.response.status, 201);
    assert.equal(document.response.status, 201);
    assert.equal(media.payload.data.StoragePath, undefined);
    assert.equal(document.payload.data.StoragePath, undefined);
    assert.equal(media.payload.data.CompanyID, undefined);
    assert.equal(document.payload.data.CompanyID, undefined);
  } finally {
    await stopServer(child);
  }
});
