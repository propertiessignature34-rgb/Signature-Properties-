const test = require('node:test');
const assert = require('node:assert/strict');
const { BuilderProjectService } = require('../src/services/builderProjectService');

function makeService() {
  return new BuilderProjectService({
    read() { return { BuilderProjects: [] }; },
    write() {}
  });
}

test('parseBuffer keeps csv uploads working after async parser changes', async () => {
  const rows = await makeService().parseBuffer(Buffer.from('Project Name,Builder Name,Location\nSkyline,Acme Group,Vesu\n'), 'projects.csv');
  assert.deepEqual(rows, [{
    'Project Name': 'Skyline',
    'Builder Name': 'Acme Group',
    Location: 'Vesu'
  }]);
});

test('parseBuffer rejects legacy xls uploads with an actionable error', async () => {
  await assert.rejects(
    () => makeService().parseBuffer(Buffer.from('legacy'), 'projects.xls'),
    /Please upload \.xlsx or \.csv/
  );
});

test('commit parses an upload once and reuses the same rows for import', async () => {
  const db = { BuilderProjects: [] };
  const service = new BuilderProjectService({
    read() { return JSON.parse(JSON.stringify(db)); },
    write(next) { db.BuilderProjects = JSON.parse(JSON.stringify(next.BuilderProjects || [])); },
    createId(prefix) { return `${prefix}-000001`; }
  });
  let parseCalls = 0;
  service.parseBuffer = async () => {
    parseCalls += 1;
    return [{ 'Project Name': 'Skyline', 'Builder Name': 'Acme Group', Location: 'Vesu' }];
  };

  const result = await service.commit(Buffer.from('unused'), 'projects.xlsx', { userId: 'USR-1' });

  assert.equal(result.ok, true);
  assert.equal(parseCalls, 1);
  assert.equal(db.BuilderProjects.length, 1);
});

test('manual URL import stores verified PDF bytes and replaces the project asset URL with an internal URL', async () => {
  const db = {
    BuilderProjects: [{
      ProjectID: 'BLDP-1',
      ProjectName: 'Existing Project',
      Brochures: [],
      Photos: [],
      Active: true
    }]
  };
  const files = new Map();
  const pdf = Buffer.from('%PDF-1.7\nmanual\n%%EOF');
  const storage = {
    async putObject(path, buffer, contentType) {
      files.set(path, { buffer, contentType });
      return { path, fileId: 'gridfs-file-1' };
    },
    async getObjectInfo(path) {
      const file = files.get(path);
      return file ? { path, size: file.buffer.length, contentType: file.contentType } : null;
    },
    async getObject(path) {
      const file = files.get(path);
      return { buffer: file.buffer, contentType: file.contentType };
    },
    async deleteObject(path) {
      files.delete(path);
    },
    BUCKET_NAME: 'signature_objects'
  };
  const service = new BuilderProjectService({
    read() { return JSON.parse(JSON.stringify(db)); },
    write(next) { db.BuilderProjects = JSON.parse(JSON.stringify(next.BuilderProjects)); },
    createId(prefix) { return `${prefix}-000001`; }
  }, {
    objectStorage: storage,
    downloader: {
      async downloadMediaSafely(url, options) {
        assert.equal(url, 'https://cdn.example.com/manual.pdf');
        assert.equal(options.kind, 'pdf');
        return { ok: true, buffer: pdf, contentType: 'application/pdf', size: pdf.length };
      }
    }
  });

  const result = await service.importMediaFromUrl('BLDP-1', 'brochure', 'https://cdn.example.com/manual.pdf', 'USR-1');

  assert.equal(result.ok, true);
  assert.equal(result.imported.storageType, 'gridfs');
  assert.equal(result.imported.verified, true);
  assert.equal(result.imported.fileId, 'gridfs-file-1');
  assert.match(result.imported.Url, /^\/api\/v2\/builder-projects\/media\/MED-000001$/);
  assert.equal(db.BuilderProjects[0].Brochures[0].OriginalUrl, 'https://cdn.example.com/manual.pdf');
  assert.equal(db.BuilderProjects[0].Brochures[0].Url, result.imported.Url);
  assert.equal(db.BuilderProjects[0].Brochures[0].fileId, 'gridfs-file-1');
  assert.equal(files.size, 1);
});

test('manual brochure URL import leaves the project untouched when GridFS verification fails', async () => {
  const before = {
    ProjectID: 'BLDP-VERIFY-FAIL',
    ProjectName: 'Verification Failure Project',
    BrochureUrl: 'https://cdn.example.com/original.pdf',
    Brochures: [],
    Photos: [],
    Active: true
  };
  const db = { BuilderProjects: [before] };
  let deletedPath = null;
  const service = new BuilderProjectService({
    read() { return JSON.parse(JSON.stringify(db)); },
    write() { throw new Error('write must not be reached'); },
    createId(prefix) { return `${prefix}-VERIFY-1`; }
  }, {
    objectStorage: {
      async putObject(path) {
        return { path, fileId: 'gridfs-file-verify-fail' };
      },
      async getObjectInfo() {
        return { size: 1 };
      },
      async getObject() {
        return { buffer: Buffer.from('not-the-downloaded-pdf') };
      },
      async deleteObject(path) {
        deletedPath = path;
      },
      BUCKET_NAME: 'signature_objects'
    },
    downloader: {
      async downloadMediaSafely() {
        return {
          ok: true,
          buffer: Buffer.from('%PDF-1.7\nverified-source\n%%EOF'),
          contentType: 'application/pdf'
        };
      }
    }
  });

  const result = await service.importMediaFromUrl(
    'BLDP-VERIFY-FAIL',
    'brochure',
    'https://cdn.example.com/verification-fails.pdf',
    'USR-1'
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /GridFS verification failed/);
  assert.equal(deletedPath, 'builder-projects/BLDP-VERIFY-FAIL/brochures/MED-VERIFY-1-verification-fails.pdf');
  assert.deepEqual(db.BuilderProjects[0], before);
});

test('manual image URL import stores verified bytes, checksum, fileId, and original URL', async () => {
  const db = {
    BuilderProjects: [{
      ProjectID: 'BLDP-IMAGE-1',
      ProjectName: 'Image Import Project',
      Brochures: [],
      Photos: [],
      Active: true
    }]
  };
  const files = new Map();
  const image = Buffer.from('\x89PNG\r\n\x1a\nimage-bytes');
  const storage = {
    async putObject(path, buffer, contentType) {
      files.set(path, { buffer, contentType });
      return { path, fileId: 'gridfs-image-file-1' };
    },
    async getObjectInfo(path) {
      const file = files.get(path);
      return file ? { path, size: file.buffer.length, contentType: file.contentType } : null;
    },
    async getObject(path) {
      const file = files.get(path);
      return { buffer: Buffer.from(file.buffer), contentType: file.contentType };
    },
    async deleteObject(path) {
      files.delete(path);
    },
    BUCKET_NAME: 'signature_objects'
  };
  const service = new BuilderProjectService({
    read() { return JSON.parse(JSON.stringify(db)); },
    write(next) { db.BuilderProjects = JSON.parse(JSON.stringify(next.BuilderProjects)); },
    createId(prefix) { return `${prefix}-IMAGE-1`; }
  }, {
    objectStorage: storage,
    downloader: {
      async downloadMediaSafely(url, options) {
        assert.equal(url, 'https://cdn.example.com/project-image.png');
        assert.equal(options.kind, 'image');
        return { ok: true, buffer: image, contentType: 'image/png', size: image.length };
      }
    }
  });

  const result = await service.importMediaFromUrl(
    'BLDP-IMAGE-1',
    'photo',
    'https://cdn.example.com/project-image.png',
    'USR-1'
  );

  assert.equal(result.ok, true);
  assert.equal(result.imported.fileId, 'gridfs-image-file-1');
  assert.equal(result.imported.storageType, 'gridfs');
  assert.equal(result.imported.verified, true);
  assert.equal(result.imported.stored, true);
  assert.equal(result.imported.OriginalUrl, 'https://cdn.example.com/project-image.png');
  assert.match(result.imported.Url, /^\/api\/v2\/builder-projects\/media\/MED-IMAGE-1$/);
  assert.equal(db.BuilderProjects[0].Photos.length, 1);
  assert.equal(db.BuilderProjects[0].Photos[0].fileId, 'gridfs-image-file-1');
  assert.equal(db.BuilderProjects[0].Photos[0].OriginalUrl, 'https://cdn.example.com/project-image.png');
  assert.equal(db.BuilderProjects[0].Photos[0].checksum, result.imported.checksum);
  assert.equal(files.size, 1);
});

test('manual image URL import leaves the project untouched when GridFS verification fails', async () => {
  const before = {
    ProjectID: 'BLDP-IMAGE-FAIL',
    ProjectName: 'Image Verification Failure Project',
    Photos: [{ MediaID: 'MED-OLD', Url: 'https://cdn.example.com/old.png' }],
    Brochures: [],
    Active: true
  };
  const db = { BuilderProjects: [before] };
  let deletedPath = null;
  const service = new BuilderProjectService({
    read() { return JSON.parse(JSON.stringify(db)); },
    write() { throw new Error('write must not be reached'); },
    createId(prefix) { return `${prefix}-IMAGE-FAIL-1`; }
  }, {
    objectStorage: {
      async putObject(path) {
        return { path, fileId: 'gridfs-image-verify-fail' };
      },
      async getObjectInfo() {
        return { size: 1 };
      },
      async getObject() {
        return { buffer: Buffer.from('different-image-bytes') };
      },
      async deleteObject(path) {
        deletedPath = path;
      },
      BUCKET_NAME: 'signature_objects'
    },
    downloader: {
      async downloadMediaSafely() {
        return {
          ok: true,
          buffer: Buffer.from('\x89PNG\r\n\x1a\nverified-image'),
          contentType: 'image/png'
        };
      }
    }
  });

  const result = await service.importMediaFromUrl(
    'BLDP-IMAGE-FAIL',
    'photo',
    'https://cdn.example.com/image-verification-fails.png',
    'USR-1'
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /GridFS verification failed/);
  assert.equal(deletedPath, 'builder-projects/BLDP-IMAGE-FAIL/photos/MED-IMAGE-FAIL-1-image-verification-fails.png');
  assert.deepEqual(db.BuilderProjects[0], before);
});

test('manual URL import surfaces HTTP 403 and leaves the project untouched', async () => {
  const before = {
    ProjectID: 'BLDP-2',
    ProjectName: 'Untouched Project',
    Brochures: [],
    Photos: [],
    Active: true
  };
  const db = { BuilderProjects: [before] };
  const service = new BuilderProjectService({
    read() { return JSON.parse(JSON.stringify(db)); },
    write() { throw new Error('write must not be reached'); },
    createId() { throw new Error('id must not be allocated'); }
  }, {
    objectStorage: { async putObject() { throw new Error('storage must not be reached'); } },
    downloader: {
      async downloadMediaSafely() {
        return { ok: false, error: 'HTTP 403' };
      }
    }
  });

  const result = await service.importMediaFromUrl('BLDP-2', 'brochure', 'https://blocked.example.com/manual.pdf', 'USR-1');

  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 403/);
  assert.deepEqual(db.BuilderProjects[0], before);
});
