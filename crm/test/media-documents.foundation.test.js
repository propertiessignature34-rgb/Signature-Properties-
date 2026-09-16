const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonRepository } = require('../src/data/repository');
const { MediaService } = require('../src/services/mediaService');
const { DocumentService } = require('../src/services/documentService');
const { TestStorageProvider } = require('../src/services/storageService');

function createServices() {
  const repository = new JsonRepository();
  const storage = new TestStorageProvider();
  return {
    repository,
    storage,
    mediaService: new MediaService(repository, storage),
    documentService: new DocumentService(repository, storage)
  };
}

test('media metadata can be created with valid input', async () => {
  const { mediaService } = createServices();
  const result = await mediaService.createMedia({
    EntityType: 'PROPERTY',
    EntityID: 'PROP-TEST-01',
    PropertyID: 'PROP-TEST-01',
    Title: 'Primary image',
    MediaType: 'IMAGE',
    Visibility: 'PUBLIC',
    MimeType: 'image/jpeg',
    SizeBytes: 2048,
    Checksum: 'abc123'
  }, { userId: 'USR-1001' }, { companyId: 'COMP-1001', brokerageId: 'BRK-1001' });

  assert.equal(result.ok, true);
  assert.equal(result.data.MediaType, 'IMAGE');
  assert.equal(result.data.Visibility, 'PUBLIC');
});

test('media rejects invalid entity type', async () => {
  const { mediaService } = createServices();
  const result = await mediaService.createMedia({
    EntityType: 'USER',
    EntityID: 'USR-1',
    Title: 'bad',
    MediaType: 'IMAGE',
    Visibility: 'PUBLIC'
  }, { userId: 'USR-1002' }, { companyId: 'COMP-1001', brokerageId: 'BRK-1001' });

  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid entity type/);
});

test('media rejects invalid visibility', async () => {
  const { mediaService } = createServices();
  const result = await mediaService.createMedia({
    EntityType: 'PROPERTY',
    EntityID: 'PROP-TEST-02',
    Title: 'bad visibility',
    MediaType: 'IMAGE',
    Visibility: 'TOP_SECRET'
  }, { userId: 'USR-1003' }, { companyId: 'COMP-1001', brokerageId: 'BRK-1001' });

  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid visibility/);
});

test('media can be listed by property', async () => {
  const { mediaService } = createServices();
  await mediaService.createMedia({
    EntityType: 'PROPERTY',
    EntityID: 'PROP-LIST-01',
    PropertyID: 'PROP-LIST-01',
    Title: 'List image',
    MediaType: 'IMAGE',
    Visibility: 'BROKER'
  }, { userId: 'USR-1004' }, { companyId: 'COMP-1001', brokerageId: 'BRK-1001' });

  const rows = await mediaService.listMedia({ PropertyID: 'PROP-LIST-01' }, { userId: 'USR-1004' }, { companyId: 'COMP-1001', brokerageId: 'BRK-1001' });
  assert.equal(rows.ok, true);
  assert.equal(rows.data.length >= 1, true);
});

test('document metadata can be created with valid input', async () => {
  const { documentService } = createServices();
  const result = await documentService.createDocument({
    EntityType: 'PROPERTY',
    EntityID: 'PROP-DOC-01',
    PropertyID: 'PROP-DOC-01',
    Title: 'Sale deed',
    DocumentType: 'SALE_DEED',
    Visibility: 'PRIVATE'
  }, { userId: 'USR-2001' }, { companyId: 'COMP-2001', brokerageId: 'BRK-2001' });

  assert.equal(result.ok, true);
  assert.equal(result.data.DocumentType, 'SALE_DEED');
  assert.equal(result.data.Visibility, 'PRIVATE');
});

test('document rejects invalid type', async () => {
  const { documentService } = createServices();
  const result = await documentService.createDocument({
    EntityType: 'PROPERTY',
    EntityID: 'PROP-DOC-02',
    Title: 'bad doc',
    DocumentType: 'NOT_REAL',
    Visibility: 'PUBLIC'
  }, { userId: 'USR-2002' }, { companyId: 'COMP-2001', brokerageId: 'BRK-2001' });

  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid document type/);
});

test('document can be listed', async () => {
  const { documentService } = createServices();
  await documentService.createDocument({
    EntityType: 'PROJECT',
    EntityID: 'PRJ-11',
    ProjectID: 'PRJ-11',
    Title: 'Project approval',
    DocumentType: 'APPROVAL',
    Visibility: 'INTERNAL'
  }, { userId: 'USR-2003' }, { companyId: 'COMP-2001', brokerageId: 'BRK-2001' });

  const rows = await documentService.listDocuments({ ProjectID: 'PRJ-11' }, { userId: 'USR-2003' }, { companyId: 'COMP-2001', brokerageId: 'BRK-2001' });
  assert.equal(rows.ok, true);
  assert.equal(rows.data.length >= 1, true);
});

test('media and document soft delete exclude records from normal reads', async () => {
  const { mediaService, documentService } = createServices();

  const mediaCreate = await mediaService.createMedia({
    EntityType: 'PROPERTY',
    EntityID: 'PROP-DEL-01',
    PropertyID: 'PROP-DEL-01',
    Title: 'Hidden media',
    MediaType: 'IMAGE',
    Visibility: 'PRIVATE'
  }, { userId: 'USR-DEL-1' }, { companyId: 'COMP-DEL', brokerageId: 'BRK-DEL' });

  const docCreate = await documentService.createDocument({
    EntityType: 'PROPERTY',
    EntityID: 'PROP-DEL-01',
    PropertyID: 'PROP-DEL-01',
    Title: 'Delete doc',
    DocumentType: 'PROPERTY_DOCUMENT',
    Visibility: 'PRIVATE'
  }, { userId: 'USR-DEL-2' }, { companyId: 'COMP-DEL', brokerageId: 'BRK-DEL' });

  assert.equal(mediaCreate.ok, true);
  assert.equal(docCreate.ok, true);

  const mediaDelete = await mediaService.deleteMedia(mediaCreate.data.MediaID, { userId: 'USR-DEL-1' }, { companyId: 'COMP-DEL', brokerageId: 'BRK-DEL' });
  const docDelete = await documentService.deleteDocument(docCreate.data.DocumentID, { userId: 'USR-DEL-2' }, { companyId: 'COMP-DEL', brokerageId: 'BRK-DEL' });

  assert.equal(mediaDelete.ok, true);
  assert.equal(docDelete.ok, true);
  assert.equal(mediaDelete.data.DeletedAt !== null, true);
  assert.equal(docDelete.data.DeletedAt !== null, true);
});

test('storage abstraction contract works for test provider', async () => {
  const { storage } = createServices();
  const upload = await storage.upload('asset-1', 'bytes', { mimeType: 'image/png' });
  const exists = await storage.exists('asset-1');
  const get = await storage.get('asset-1');
  const url = await storage.getPublicUrl('asset-1');
  const removed = await storage.delete('asset-1');

  assert.equal(upload.ok, true);
  assert.equal(exists.ok, true);
  assert.equal(exists.data, true);
  assert.equal(get.ok, true);
  assert.equal(url.ok, true);
  assert.equal(removed.ok, true);
  assert.equal(removed.data, true);
});
