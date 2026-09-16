'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const {
  KarmaGroupScraperService,
  normalizeUrl,
  rankMatches,
  parseProjectDetailHtml
} = require('../src/services/karmaGroupScraperService');

function makeRepo(seed = {}) {
  let db = JSON.parse(JSON.stringify(seed));
  let seq = 1;
  return {
    read() { return JSON.parse(JSON.stringify(db)); },
    write(next) { db = JSON.parse(JSON.stringify(next)); },
    createId(prefix) { const id = `${prefix}-${seq++}`; return id; },
    snapshot() { return JSON.parse(JSON.stringify(db)); }
  };
}

function createResponse(status, body, url) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    async text() { return body; }
  };
}

async function waitForCompletion(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = KarmaGroupScraperService.getStatus();
    if (status.data.status !== 'running') return status;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for scraper completion');
}

test.afterEach(() => {
  KarmaGroupScraperService.__resetForTests();
});

test('discoverCandidates follows pagination, dedupes, and normalizes URLs', async () => {
  const repo = makeRepo({ BuilderProjects: [] });
  const pages = new Map([
    ['https://karmagroup.co.in/projects', `
      <a href="/Projects/ProjectDetail/600" data-builder="Karma" data-location="Vesu">Alpha</a>
      <a href="/Projects/ProjectDetail/600/" data-builder="Karma" data-location="Vesu">Alpha</a>
      <a href="/projects?page=2">Next</a>
    `],
    ['https://karmagroup.co.in/projects?page=2', `
      <a href="/Projects/ProjectDetail/601" data-builder="Karma" data-location="Piplod">Beta</a>
      <a href="/Projects/ProjectDetail/602" data-builder="Karma" data-location="Adajan">Gamma</a>
    `]
  ]);

  const service = new KarmaGroupScraperService(repo, {
    listingUrl: 'https://karmagroup.co.in/projects',
    fetchImpl: async (url) => createResponse(200, pages.get(url) || '', url)
  });

  const out = await service.discoverCandidates({ maxPages: 5, maxRequests: 5 });
  assert.equal(out.ok, true);
  assert.equal(out.candidates.length, 3);
  assert.deepEqual(
    out.candidates.map((c) => c.sourceProjectID).sort(),
    ['600', '601', '602']
  );
  assert.equal(normalizeUrl('https://karmagroup.co.in/Projects/ProjectDetail/600/'), out.candidates[0].sourceUrl.includes('600') ? out.candidates[0].sourceUrl : out.candidates[1].sourceUrl);
});

test('category discovery posts all eight filters and returns unique source projects', async () => {
  const repo = makeRepo({ BuilderProjects: [] });
  const calls = [];
  const service = new KarmaGroupScraperService(repo, {
    useCategoryDiscovery: true,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body });
      const categoryId = new URLSearchParams(options.body).get('Filters[0][value]');
      return createResponse(200, `<a href="/Projects/ProjectDetail/${categoryId}0">Project ${categoryId}</a>`, url);
    }
  });
  const out = await service.discoverCandidates();
  assert.equal(out.candidates.length, 8);
  assert.equal(calls.length, 8);
  assert.ok(calls.every((call) => call.method === 'POST' && call.body.includes('PageSize=500')));
  assert.deepEqual(out.candidates.map((row) => row.sourceProjectID), ['10', '20', '30', '40', '60', '100', '110', '120']);
});

test('detail parser discovers project photos, floor plans and direct brochure paths', () => {
  const parsed = parseProjectDetailHtml(`
    <meta property="og:title" content="Media Project">
    <img src="/images/projects/55/main.jpg">
    <img data-src="/images/projects/55/Interior/living.webp">
    <img src="/images/projects/55/floorplan/plan.png">
    <a data-brochure="/images/projects/55/brochure.pdf">Brochure</a>
  `, 'https://karmagroup.co.in/Projects/ProjectDetail/55', { category: 'Commercial', sourceCategory: 'Commercial Projects' });
  assert.equal(parsed.photoUrls.length, 2);
  assert.equal(parsed.floorPlanUrls.length, 1);
  assert.equal(parsed.brochureUrl, 'https://karmagroup.co.in/images/projects/55/brochure.pdf');
  assert.equal(parsed.sourceCategory, 'Commercial Projects');
});

test('media ingestion stores verified internal references and reuses them idempotently', async () => {
  const repo = makeRepo({ BuilderProjects: [] });
  const stored = new Map();
  const objectStorage = {
    BUCKET_NAME: 'signature_objects',
    async putObject(path, buffer, contentType) { stored.set(path, { buffer, contentType }); return { path, size: buffer.length }; },
    async getObjectInfo(path) { const row = stored.get(path); return row ? { path, size: row.buffer.length } : null; },
    async deleteObject(path) { stored.delete(path); }
  };
  const service = new KarmaGroupScraperService(repo, {
    ingestMedia: true,
    objectStorage,
    downloadMediaSafely: async (url, options) => ({
      ok: true,
      buffer: Buffer.from(options.kind === 'pdf' ? '%PDF-test' : 'image-test'),
      contentType: options.kind === 'pdf' ? 'application/pdf' : 'image/jpeg'
    })
  });
  const project = { ProjectID: 'BLDP-1', ProjectName: 'Stored Media', Photos: [], FloorPlans: [], Brochures: [] };
  const parsed = {
    photoUrls: ['https://karmagroup.co.in/images/projects/1/main.jpg'],
    floorPlanUrls: ['https://karmagroup.co.in/images/projects/1/floorplan/plan.jpg'],
    brochureUrl: 'https://karmagroup.co.in/images/projects/1/brochure.pdf'
  };
  const counters = { mediaDiscovered: 0, mediaStored: 0, mediaReused: 0, mediaFailed: 0, mediaBytesStored: 0 };
  await service._ingestProjectMedia(project, parsed, counters);
  assert.equal(stored.size, 3);
  assert.equal(counters.mediaStored, 3);
  assert.ok([...project.Photos, ...project.FloorPlans, ...project.Brochures].every((row) => row.Url.startsWith('/api/') && !row.SourceUrl && !row.OriginalUrl && row.verified));
  await service._ingestProjectMedia(project, parsed, counters);
  assert.equal(stored.size, 3);
  assert.equal(counters.mediaReused, 3);
});

test('detail fetch classifies stale HTTP and transient network failures correctly', async () => {
  const repo = makeRepo({ BuilderProjects: [] });
  const service = new KarmaGroupScraperService(repo, {
    fetchImpl: async (url) => {
      if (url.includes('stale')) return createResponse(500, '<html>error</html>', url);
      const err = new Error('socket timeout');
      err.code = 'ETIMEDOUT';
      throw err;
    }
  });

  const stale = await service._fetchAndParseDetail({ sourceUrl: 'https://karmagroup.co.in/Projects/ProjectDetail/stale' });
  assert.equal(stale.ok, false);
  assert.equal(stale.classification, 'STALE_DETAIL');

  const transient = await service._fetchAndParseDetail({ sourceUrl: 'https://karmagroup.co.in/Projects/ProjectDetail/network' });
  assert.equal(transient.ok, false);
  assert.equal(transient.classification, 'TRANSIENT_NETWORK_ERROR');
});

test('rankMatches returns auto-match for strong candidate and ambiguous when within 5 points', () => {
  const project = {
    ProjectID: 'BLDP-1',
    ProjectName: 'Karma Heights',
    BuilderName: 'Karma Group',
    Location1: 'Vesu',
    Category: 'Residential',
    SourceProjectID: '600',
    SourceUrl: 'https://karmagroup.co.in/Projects/ProjectDetail/600',
    RERANumber: 'PR/GJ/ABC/123'
  };

  const rankedStrong = rankMatches(project, [{
    projectName: 'Karma Heights', builderName: 'Karma Group', location: 'Vesu', category: 'Residential',
    sourceProjectID: '600', sourceUrl: 'https://karmagroup.co.in/Projects/ProjectDetail/600', RERA: 'PR/GJ/ABC/123'
  }]);
  assert.equal(rankedStrong.resolution, 'AUTO_MATCH');
  assert.ok(rankedStrong.best.score >= 85);

  const rankedAmbiguous = rankMatches(project, [
    { projectName: 'Karma Height', builderName: 'Karma', location: 'Vesu', sourceProjectID: '601', sourceUrl: 'https://karmagroup.co.in/Projects/ProjectDetail/601' },
    { projectName: 'Karma Heights Phase', builderName: 'Karma Group', location: 'Vesu', sourceProjectID: '602', sourceUrl: 'https://karmagroup.co.in/Projects/ProjectDetail/602' }
  ]);
  assert.equal(rankedAmbiguous.ambiguous, true);
});

test('canonical enrichment is bounded to top 3 candidates', async () => {
  const repo = makeRepo({ BuilderProjects: [] });
  const service = new KarmaGroupScraperService(repo, { fetchImpl: async () => createResponse(200, '', 'https://example.com') });
  let enrichmentCalls = 0;
  service._fetchAndParseDetail = async (candidate) => {
    enrichmentCalls += 1;
    return {
      ok: true,
      parsed: {
        ...candidate,
        sourceUrl: candidate.sourceUrl,
        projectName: candidate.projectName,
        builderName: candidate.builderName,
        location: candidate.location,
        category: candidate.category,
        RERA: candidate.RERA
      }
    };
  };

  const existing = {
    ProjectID: 'BLDP-1',
    ProjectName: 'Karma Heights',
    BuilderName: 'Karma Group',
    Location1: 'Vesu',
    Category: 'Residential',
    SourceProjectID: '600',
    SourceUrl: 'https://karmagroup.co.in/Projects/ProjectDetail/600'
  };

  const candidates = [1, 2, 3, 4, 5].map((n) => ({
    projectName: `Karma Heights ${n}`,
    builderName: 'Karma Group',
    location: 'Vesu',
    category: 'Residential',
    sourceProjectID: String(700 + n),
    sourceUrl: `https://karmagroup.co.in/Projects/ProjectDetail/${700 + n}`
  }));

  await service._resolveCanonicalCandidate(existing, candidates);
  assert.equal(enrichmentCalls <= 3, true);
});

test('targeted stale legacy page with ambiguous canonical match fails closed and preserves existing project', async () => {
  const original = {
    ProjectID: 'BLDP-600',
    ProjectName: 'Legacy Karma',
    BuilderName: 'Karma Group',
    Location1: 'Vesu',
    Address: 'Manual Address',
    SourceProjectID: '600',
    SourceUrl: 'https://karmagroup.co.in/Projects/ProjectDetail/600',
    RERANumber: 'PR/GJ/LEGACY/01',
    Amenities: ['Club House'],
    Active: true
  };

  const repo = makeRepo({ BuilderProjects: [original] });
  const pages = new Map([
    ['https://karmagroup.co.in/projects', `
      <a href="/Projects/ProjectDetail/901" data-builder="Karma Group" data-location="Vesu">Legacy Karma Prime</a>
      <a href="/Projects/ProjectDetail/902" data-builder="Karma Group" data-location="Vesu">Legacy Karma Grande</a>
    `],
    ['https://karmagroup.co.in/Projects/ProjectDetail/600', '<html>broken</html>'],
    ['https://karmagroup.co.in/Projects/ProjectDetail/901', '<h1>Legacy Karma Prime</h1><div>Location: Vesu</div><div>Builder: Karma Group</div>'],
    ['https://karmagroup.co.in/Projects/ProjectDetail/902', '<h1>Legacy Karma Grande</h1><div>Location: Vesu</div><div>Builder: Karma Group</div>']
  ]);

  const service = new KarmaGroupScraperService(repo, {
    listingUrl: 'https://karmagroup.co.in/projects',
    fetchImpl: async (url) => {
      if (url.endsWith('/600')) return createResponse(500, pages.get(url), url);
      return createResponse(200, pages.get(url) || '', url);
    }
  });

  const started = await service.startTargetedScrape({ projectId: 'BLDP-600', userId: 'USR-1' });
  assert.equal(started.statusCode, 202);
  const status = await waitForCompletion();
  assert.equal(status.data.classification, 'AMBIGUOUS_CANONICAL_MATCH');
  const snapshot = repo.snapshot();
  const after = snapshot.BuilderProjects.find((p) => p.ProjectID === 'BLDP-600');
  assert.equal(after.Address, 'Manual Address');
  assert.equal(after.SourceProjectID, '600');
});

test('full scrape updates non-destructively, dedupes arrays, and keeps project IDs stable', async () => {
  const existing = {
    ProjectID: 'BLDP-123',
    ProjectName: 'Karma Aura',
    BuilderName: 'Karma Group',
    Location1: 'Vesu',
    Address: 'Manual Address',
    SourceProjectID: '123',
    SourceUrl: 'https://karmagroup.co.in/Projects/ProjectDetail/123',
    Amenities: ['Gym'],
    Configurations: ['2 BHK'],
    Photos: [{ Url: 'https://cdn.example.com/a.jpg', SourceUrl: 'https://cdn.example.com/a.jpg' }],
    Active: true
  };

  const repo = makeRepo({ BuilderProjects: [existing] });
  const service = new KarmaGroupScraperService(repo, {
    listingUrl: 'https://karmagroup.co.in/projects',
    fetchImpl: async (url) => {
      if (url === 'https://karmagroup.co.in/projects') {
        return createResponse(200, '<a href="/Projects/ProjectDetail/123" data-builder="Karma Group" data-location="Vesu">Karma Aura</a>', url);
      }
      return createResponse(200, `
        <h1>Karma Aura</h1>
        <div>Builder: Karma Group</div>
        <div>Location: Vesu</div>
        <div>Amenities</div><ul><li>Gym</li><li>Pool</li></ul>
        <div>Configurations</div><ul><li>2 BHK</li><li>3 BHK</li></ul>
        <a href="https://cdn.example.com/a.jpg">photo</a>
        <a href="https://cdn.example.com/b.jpg">photo</a>
      `, url);
    }
  });

  const started = await service.startScrape({ limit: 10, userId: 'USR-1' });
  assert.equal(started.statusCode, 202);
  await waitForCompletion();

  const after = repo.snapshot().BuilderProjects.find((p) => p.ProjectID === 'BLDP-123');
  assert.ok(after);
  assert.equal(after.ProjectID, 'BLDP-123');
  assert.equal(after.Address, 'Manual Address');
  assert.ok((after.Amenities || []).includes('Gym'));
  assert.ok((after.Amenities || []).includes('Pool'));
  assert.deepEqual(after.Configurations.sort(), ['2 BHK', '3 BHK']);
  assert.equal((after.Photos || []).length, 2);
});

test('distinct Karma source project IDs never collapse on matching names and locations', async () => {
  const repo = makeRepo({ BuilderProjects: [] });
  const listingUrl = 'https://karmagroup.co.in/Projects/Index/102';
  const pages = new Map([
    [listingUrl, `
      <a href="/Projects/ProjectDetail/801">Twin Plaza</a>
      <a href="/Projects/ProjectDetail/802">Twin Plaza</a>
    `],
    ['https://karmagroup.co.in/Projects/ProjectDetail/801', '<meta property="og:title" content="Twin Plaza"><script>var location = {"Locality":"Vesu"};</script>'],
    ['https://karmagroup.co.in/Projects/ProjectDetail/802', '<meta property="og:title" content="Twin Plaza"><script>var location = {"Locality":"Vesu"};</script>']
  ]);
  const service = new KarmaGroupScraperService(repo, {
    listingUrl,
    ingestBrochures: false,
    fetchImpl: async (url) => createResponse(200, pages.get(url) || '', url)
  });

  await service.startScrape({ limit: 10, userId: 'USR-1' });
  await waitForCompletion();
  const rows = repo.snapshot().BuilderProjects;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.SourceProjectID).sort(), ['801', '802']);
});

test('invalid Karma status tokens are not accepted as Gujarat RERA identities', () => {
  const parsed = require('../src/services/karmaGroupScraperService').parseProjectDetailHtml(`
    <meta property="og:title" content="Status Token Project">
    <div>Real Estate Regulatory Authority :- BUC</div>
  `, 'https://karmagroup.co.in/Projects/ProjectDetail/900', {});
  assert.equal(parsed.RERA, null);
  assert.equal(parsed.sourceProjectID, '900');
});

test('Karma updates clear legacy invalid RERA tokens without touching valid Gujarat RERA values', () => {
  const repo = makeRepo({ BuilderProjects: [] });
  const service = new KarmaGroupScraperService(repo, { ingestBrochures: false });
  const invalid = { ImportedFrom: 'KarmaGroupScrape', RERANumber: 'BUC', ImportHistory: [] };
  const valid = { ImportedFrom: 'KarmaGroupScrape', RERANumber: 'PR/GJ/SURAT/VALID/123', ImportHistory: [] };
  const parsed = { sourceProjectID: '900', sourceUrl: 'https://karmagroup.co.in/Projects/ProjectDetail/900' };
  service._applyParsedProjectData(invalid, parsed);
  service._applyParsedProjectData(valid, parsed);
  assert.equal(invalid.RERANumber, null);
  assert.equal(valid.RERANumber, 'PR/GJ/SURAT/VALID/123');
});

test('brochure ingestion keeps external URL and writes deterministic GridFS key', async () => {
  const repo = makeRepo({ BuilderProjects: [] });
  const uploads = [];
  const service = new KarmaGroupScraperService(repo, {
    objectStorage: {
      async putObjectStream(path, stream) {
        await new Promise((resolve, reject) => {
          stream.on('error', reject);
          stream.on('data', () => {});
          stream.on('end', resolve);
        });
        uploads.push(path);
        return { path };
      }
    },
    openPdfStreamSafely: async (_url, { observer }) => {
      observer?.({ stage: 'download-response-start', contentLength: 8 });
      const stream = Readable.from([Buffer.from('%PDF-1.4')]);
      return { ok: true, stream };
    },
    fetchImpl: async (url) => createResponse(200, `
      <a href="/Projects/ProjectDetail/777" data-builder="Karma" data-location="Vesu">Karma PDF</a>
      ${url.endsWith('/777') ? '<h1>Karma PDF</h1><div>Builder: Karma</div><div>Location: Vesu</div><a href="https://karmagroup.co.in/docs/brochure.pdf">Brochure</a>' : ''}
    `, url)
  });

  const started = await service.startScrape({ limit: 1, userId: 'USR-1' });
  assert.equal(started.statusCode, 202);
  await waitForCompletion();

  const created = repo.snapshot().BuilderProjects[0];
  assert.equal(created.BrochureUrl, 'https://karmagroup.co.in/docs/brochure.pdf');
  assert.equal(uploads[0].startsWith(`builder-projects/${created.ProjectID}/brochures/`), true);
});

test('global lock returns 409 when second job starts while first is running', async () => {
  const repo = makeRepo({ BuilderProjects: [] });
  let release;
  const hold = new Promise((resolve) => { release = resolve; });

  const service = new KarmaGroupScraperService(repo, {
    fetchImpl: async (url) => {
      if (url === 'https://karmagroup.co.in/projects') {
        await hold;
        return createResponse(200, '<a href="/Projects/ProjectDetail/1">One</a>', url);
      }
      return createResponse(200, '<h1>One</h1>', url);
    }
  });

  const first = await service.startScrape({ limit: 1 });
  assert.equal(first.statusCode, 202);

  const second = await service.startTargetedScrape({ sourceUrl: 'https://karmagroup.co.in/Projects/ProjectDetail/1' });
  assert.equal(second.statusCode, 409);

  release();
  await waitForCompletion();
});
