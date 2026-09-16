'use strict';

const crypto = require('crypto');
const objectStorage = require('./objectStorageService');
const { openPdfStreamSafely, downloadMediaSafely, assertPublicHttpUrl, DEFAULT_MAX_BYTES } = require('./safeUrlDownloader');

const DEFAULT_LISTING_URL = process.env.KARMA_GROUP_LISTING_URL || 'https://karmagroup.co.in/Projects/Index/102';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 8;
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 12;
const DEFAULT_MAX_REQUESTS = 40;
const TRANSIENT_MAX_RETRIES = 2;
const BROCHURE_DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const BROCHURE_HARD_MAX_BYTES = 300 * 1024 * 1024;
const IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const KARMA_PROJECT_LIST_URL = 'https://karmagroup.co.in/Projects/ProjectList';
const KARMA_CATEGORY_FILTERS = [
  { id: '1', sourceCategory: 'Residential Projects', category: 'Residential' },
  { id: '2', sourceCategory: 'Commercial Projects', category: 'Commercial' },
  { id: '3', sourceCategory: 'Industrial Plots', category: 'Industrial' },
  { id: '4', sourceCategory: 'Club Membership', category: 'Commercial' },
  { id: '6', sourceCategory: 'Land Projects', category: 'Land' },
  { id: '10', sourceCategory: 'Pre-Lease Properties', category: 'Commercial' },
  { id: '11', sourceCategory: 'Textile Commercial', category: 'Commercial' },
  { id: '12', sourceCategory: 'Industrial Projects', category: 'Industrial' }
];

const STAGE_ORDER = {
  discovery: 1,
  'detail-fetch': 2,
  'download-open': 3,
  'download-stream': 4,
  'storage-upload': 5,
  'media-storage': 6,
  'project-mutation': 7,
  complete: 8,
  error: 9
};

const STALE_STATUS = new Set([404, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNABORTED', 'ERR_TLS_CERT_ALTNAME_INVALID']);

const MATCH_WEIGHTS = {
  projectName: 35,
  builderName: 20,
  location: 20,
  sourceProjectID: 10,
  sourceUrl: 5,
  category: 5,
  metadata: 5
};

let activeJob = null;
let latestStatus = makeIdleStatus();

function nowIso() {
  return new Date().toISOString();
}

function makeIdleStatus() {
  return {
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    selectedProjectID: null,
    selectedProjectName: null,
    currentStage: null,
    contentLength: null,
    downloadedBytes: 0,
    uploadedBytes: null,
    uploadCompleted: false,
    throughput: null,
    lastProgressAt: null,
    elapsedMs: 0,
    terminalStage: null,
    error: null,
    classification: null,
    fallbackResolution: null,
    matchDiagnostics: null,
    result: null,
    mode: null
  };
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

function normalizeLoose(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeUrl(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    url.hash = '';
    if (!url.pathname) url.pathname = '/';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch (_) {
    return null;
  }
}

function extractProjectIdFromUrl(raw) {
  const normalized = normalizeUrl(raw) || String(raw || '');
  const match = normalized.match(/\/Projects\/ProjectDetail\/([^/?#]+)/i);
  return match ? String(match[1]).trim() : null;
}

function stripTags(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script(?:\s+[^>]*)?>/gi, ' ').replace(/<style[\s\S]*?<\/style(?:\s+[^>]*)?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSimilarity(a, b) {
  const aa = normalizeLoose(a);
  const bb = normalizeLoose(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  if (aa.includes(bb) || bb.includes(aa)) return 0.8;
  const aTokens = new Set(aa.split(' ').filter(Boolean));
  const bTokens = new Set(bb.split(' ').filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  let inter = 0;
  for (const token of aTokens) if (bTokens.has(token)) inter += 1;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union ? inter / union : 0;
}

function classificationFromError(error) {
  const statusCode = Number(error?.statusCode || 0);
  if (STALE_STATUS.has(statusCode)) return 'STALE_DETAIL';
  const code = String(error?.code || '').toUpperCase();
  if (TRANSIENT_CODES.has(code) || /timeout|socket|network|tls|dns/i.test(String(error?.message || ''))) {
    return 'TRANSIENT_NETWORK_ERROR';
  }
  return 'PARSING_OR_DATA_ERROR';
}

function isTransient(error) {
  const classification = classificationFromError(error);
  return classification === 'TRANSIENT_NETWORK_ERROR';
}

function isRetryableRequestError(error) {
  return isTransient(error) || new Set([500, 502, 503, 504]).has(Number(error?.statusCode || 0));
}

function isHttpError(error) {
  return typeof error?.statusCode === 'number' && error.statusCode >= 400;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeProjectName(name) {
  const raw = String(name || 'project').toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return (raw || 'project').slice(0, 80);
}

function mediaSourceKey(url) {
  return crypto.createHash('sha256').update(String(url || '')).digest('hex').slice(0, 24);
}

function extensionForContentType(contentType) {
  const value = String(contentType || '').toLowerCase();
  if (value === 'application/pdf') return 'pdf';
  if (value === 'image/png') return 'png';
  if (value === 'image/webp') return 'webp';
  if (value === 'image/gif') return 'gif';
  return 'jpg';
}

function filenameFromMediaUrl(url, fallback, contentType) {
  try {
    const raw = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    const clean = raw.replace(/[^\w.\- ]+/g, '-').slice(0, 120);
    if (clean) return clean;
  } catch (_) {}
  return `${fallback}.${extensionForContentType(contentType)}`;
}

function mergeUniqueStrings(existing, incoming) {
  const seen = new Set();
  const out = [];
  for (const value of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const cleaned = String(value || '').trim();
    const key = normalizeLoose(cleaned);
    if (!cleaned || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function mergeMediaByUrl(existing, incomingUrls) {
  const list = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(list.map((item) => normalizeUrl(item?.SourceUrl || item?.OriginalUrl || item?.Url || '')).filter(Boolean));
  for (const raw of (Array.isArray(incomingUrls) ? incomingUrls : [])) {
    const url = normalizeUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    list.push({
      MediaID: null,
      Filename: null,
      Url: url,
      SourceUrl: url,
      Source: 'KarmaGroupScrape',
      UploadedAt: nowIso(),
      UploadedBy: 'system'
    });
  }
  return list;
}

function pickNonEmpty(newValue, oldValue) {
  if (newValue == null) return oldValue;
  if (typeof newValue === 'string' && !newValue.trim()) return oldValue;
  if (Array.isArray(newValue) && newValue.length === 0) return oldValue;
  return newValue;
}

function normalizeCandidate(candidate = {}) {
  const sourceUrl = normalizeUrl(candidate.sourceUrl || candidate.SourceUrl || candidate.url || '');
  const sourceProjectID = String(candidate.sourceProjectID || candidate.SourceProjectID || extractProjectIdFromUrl(sourceUrl) || '').trim() || null;
  return {
    projectName: String(candidate.projectName || candidate.ProjectName || '').trim() || null,
    builderName: String(candidate.builderName || candidate.BuilderName || '').trim() || null,
    developer: String(candidate.developer || candidate.DeveloperName || '').trim() || null,
    promoter: String(candidate.promoter || candidate.PromoterName || '').trim() || null,
    location: String(candidate.location || candidate.Location1 || '').trim() || null,
    address: String(candidate.address || candidate.Address || '').trim() || null,
    category: String(candidate.category || candidate.Category || '').trim() || null,
    RERA: String(candidate.RERA || candidate.rera || candidate.RERANumber || '').trim() || null,
    sourceProjectID,
    sourceUrl,
    sourceCategory: String(candidate.sourceCategory || candidate.SourceCategory || candidate.metadata?.sourceCategory || '').trim() || null,
    metadata: candidate.metadata && typeof candidate.metadata === 'object' ? { ...candidate.metadata } : {}
  };
}

function toBuilderIdentity(project = {}) {
  return {
    ProjectID: project.ProjectID,
    ProjectName: String(project.ProjectName || '').trim(),
    BuilderName: String(project.BuilderName || '').trim(),
    Location1: String(project.Location1 || '').trim(),
    Category: String(project.Category || '').trim(),
    SourceProjectID: String(project.SourceProjectID || '').trim(),
    SourceUrl: normalizeUrl(project.SourceUrl || ''),
    RERANumber: String(project.RERANumber || '').trim(),
    Address: String(project.Address || '').trim()
  };
}

function scoreMatch(existing, candidate) {
  const e = toBuilderIdentity(existing);
  const c = normalizeCandidate(candidate);

  const projectNameScore = tokenSimilarity(e.ProjectName, c.projectName);
  const builderScore = tokenSimilarity(e.BuilderName, c.builderName || c.developer || c.promoter);
  const locationScore = tokenSimilarity(e.Location1, c.location || c.address);
  const sourceIdScore = e.SourceProjectID && c.sourceProjectID && normalizeLoose(e.SourceProjectID) === normalizeLoose(c.sourceProjectID) ? 1 : 0;
  const sourceUrlScore = e.SourceUrl && c.sourceUrl && normalizeUrl(e.SourceUrl) === normalizeUrl(c.sourceUrl) ? 1 : 0;
  const categoryScore = e.Category && c.category && normalizeLoose(e.Category) === normalizeLoose(c.category) ? 1 : 0;

  const sameRera = e.RERANumber && c.RERA && normalizeLoose(e.RERANumber) === normalizeLoose(c.RERA);
  const corroborated = (projectNameScore >= 0.4 || builderScore >= 0.4 || locationScore >= 0.4);
  const addressScore = tokenSimilarity(e.Address, c.address);
  const metadataScore = sameRera && corroborated ? 1 : Math.min(addressScore, 0.6);

  const score = (
    projectNameScore * MATCH_WEIGHTS.projectName +
    builderScore * MATCH_WEIGHTS.builderName +
    locationScore * MATCH_WEIGHTS.location +
    sourceIdScore * MATCH_WEIGHTS.sourceProjectID +
    sourceUrlScore * MATCH_WEIGHTS.sourceUrl +
    categoryScore * MATCH_WEIGHTS.category +
    metadataScore * MATCH_WEIGHTS.metadata
  );

  return {
    score: Math.round(score * 100) / 100,
    breakdown: {
      projectNameScore,
      builderScore,
      locationScore,
      sourceIdScore,
      sourceUrlScore,
      categoryScore,
      metadataScore,
      sameRera,
      corroborated
    }
  };
}

function rankMatches(existingProject, candidates) {
  const scored = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => {
      const scoring = scoreMatch(existingProject, candidate);
      return { candidate: normalizeCandidate(candidate), ...scoring };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0] || null;
  const second = scored[1] || null;
  const ambiguous = !!(best && second && Math.abs(best.score - second.score) <= 5);

  let resolution = 'UNRESOLVED';
  if (best) {
    if (ambiguous) resolution = 'AMBIGUOUS';
    else if (best.score >= 85) resolution = 'AUTO_MATCH';
    else if (best.score >= 70) resolution = 'ENRICHMENT_REQUIRED';
  }

  return { best, scored, ambiguous, resolution };
}

function updateStage(status, stage, patch = {}) {
  if (!status) return;
  const currentOrder = STAGE_ORDER[status.currentStage] || 0;
  const nextOrder = STAGE_ORDER[stage] || 0;
  if (nextOrder >= currentOrder) status.currentStage = stage;
  Object.assign(status, patch);
  status.lastProgressAt = nowIso();
  const startedAt = status.startedAt ? Date.parse(status.startedAt) : Date.now();
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  status.elapsedMs = elapsedMs;
  if (typeof status.downloadedBytes === 'number' && status.downloadedBytes > 0 && elapsedMs > 0) {
    status.throughput = Math.round((status.downloadedBytes * 1000) / elapsedMs);
  }
}

function sanitizeError(error) {
  const message = String(error?.message || error || 'Unknown error');
  return message.replace(/https?:\/\/\S+/gi, '[url-redacted]').slice(0, 300);
}

function parseListItems(htmlSection) {
  if (!htmlSection) return [];
  const matches = Array.from(String(htmlSection).matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi));
  return matches.map((m) => stripTags(m[1])).filter(Boolean);
}

function parseFieldFromLabel(html, labels = []) {
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*(?:<\\/[^>]+>\\s*)?(?:<[^>]+>\\s*)?[:\\-]?\\s*([^<\\n\\r]{2,240})`, 'i');
    const match = String(html || '').match(pattern);
    if (match) {
      const value = stripTags(match[1]);
      if (value) return value;
    }
  }
  return null;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractMetaContent(html, key) {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1]).trim();
  }
  return null;
}

function cleanScrapedField(value) {
  const cleaned = decodeHtmlEntities(stripTags(value || '')).replace(/^\s*[:\-]+\s*/, '').trim();
  if (!cleaned || cleaned.length > 240) return null;
  if (/[{};<>=]/.test(cleaned) || /form-submit|window\.|fetch\(|function\s*\(/i.test(cleaned)) return null;
  return cleaned;
}

function extractLocationRecord(html) {
  const match = String(html || '').match(/var\s+location\s*=\s*(\{[^;]+\})\s*;/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (_) { return null; }
}

function inferProjectCategory(projectName, description) {
  const text = normalizeLoose(`${projectName || ''} ${description || ''}`);
  if (/\b(industrial|warehouse|textile|business park|factory|logistics)\b/.test(text)) return 'Industrial';
  if (/\b(commercial|office|shop|showroom|market|business centre|business center)\b/.test(text)) return 'Commercial';
  if (/\b(plot|plots|land|farm)\b/.test(text) && !/\b(residential|apartment|bhk)\b/.test(text)) return 'Land';
  return 'Residential';
}

function inferProjectStatus(possession) {
  const value = normalizeLoose(possession);
  if (/ready to move|ready possession/.test(value)) return 'Ready to Move';
  if (/completed|complete/.test(value)) return 'Completed';
  if (/new launch|upcoming/.test(value)) return 'New Launch';
  return 'Under Construction';
}

function normalizeGujaratRera(value) {
  const cleaned = cleanScrapedField(value);
  return cleaned && /^PR\/GJ\//i.test(cleaned) ? cleaned : null;
}

function parseProjectDetailHtml(html, detailUrl, seed = {}) {
  const text = stripTags(html);
  const locationRecord = extractLocationRecord(html);
  const headingName = stripTags((String(html).match(/<h[1-4][^>]*class=["'][^"']*property-detail-head[^"']*["'][^>]*>([\s\S]*?)<\/h[1-4]>/i) || [])[1]);
  const titleName = extractMetaContent(html, 'og:title') || stripTags((String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]).split(/\s+-\s+Karma/i)[0];
  const projectName = cleanScrapedField(titleName) || cleanScrapedField(headingName) || cleanScrapedField(parseFieldFromLabel(html, ['Project Name'])) || cleanScrapedField(seed.projectName) || 'Unnamed Project';
  const builderName = cleanScrapedField(parseFieldFromLabel(html, ['Builder Name', 'Builder'])) || cleanScrapedField(seed.builderName);
  const developer = cleanScrapedField(parseFieldFromLabel(html, ['Developer Name', 'Developer'])) || cleanScrapedField(seed.developer);
  const promoter = cleanScrapedField(parseFieldFromLabel(html, ['Promoter Name', 'Promoter'])) || cleanScrapedField(seed.promoter);
  const venue = cleanScrapedField((String(html).match(/<span[^>]*class=["'][^"']*property-head-venue[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
  const location = cleanScrapedField(locationRecord?.Locality) || cleanScrapedField(seed.location) || 'Surat';
  const address = cleanScrapedField(locationRecord?.GoogleSearchText) || venue || cleanScrapedField(seed.address);
  const metaDescription = extractMetaContent(html, 'og:description') || extractMetaContent(html, 'description');
  const overviewDescription = cleanScrapedField((String(html).match(/<p[^>]*class=["'][^"']*subchild-content[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) || [])[1]);
  const description = overviewDescription || cleanScrapedField(metaDescription);
  const explicitCategory = cleanScrapedField(parseFieldFromLabel(html, ['Category', 'Property Type'])) || cleanScrapedField(seed.category);
  const category = explicitCategory || inferProjectCategory(projectName, description);
  const reraText = cleanScrapedField((String(html).match(/Real Estate Regulatory Authority\s*:\-?\s*([^<\r\n]*)/i) || [])[1]);
  const rera = normalizeGujaratRera(reraText) || normalizeGujaratRera(seed.RERA);
  const possession = cleanScrapedField((String(html).match(/<span[^>]*>\s*Possession\s*:\s*([\s\S]*?)<\/span>/i) || [])[1]) || cleanScrapedField(parseFieldFromLabel(html, ['Possession Date', 'Possession']));
  const totalUnits = cleanScrapedField(parseFieldFromLabel(html, ['Total Units', 'Units']));
  const projectStatus = inferProjectStatus(possession);
  const possessionStatus = possession;

  const mediaAttributes = Array.from(String(html || '').matchAll(/(?:src|href|data-src|data-brochure)\s*=\s*["']([^"']+)["']/gi)).map((match) => match[1]);
  const projectMediaUrls = Array.from(new Set(mediaAttributes.map((raw) => {
    try { return new URL(raw, detailUrl).toString(); } catch (_) { return null; }
  }).filter((url) => url && /\/images\/projects\//i.test(url))));
  const allAttributeUrls = Array.from(new Set(mediaAttributes.map((raw) => {
    try { return new URL(raw, detailUrl).toString(); } catch (_) { return null; }
  }).filter(Boolean)));
  const brochureUrl = projectMediaUrls.find((url) => /\.pdf(?:$|[?#])/i.test(url)) ||
    allAttributeUrls.find((url) => /\.pdf(?:$|[?#])/i.test(url) && !/terms?(?:%20|\s|[-_])*and(?:%20|\s|[-_])*conditions?/i.test(url)) || null;
  const preferredImageUrls = projectMediaUrls.length ? projectMediaUrls : allAttributeUrls;
  const allImageUrls = preferredImageUrls.filter((url) => /\.(?:png|jpe?g|webp|gif)(?:$|[?#])/i.test(url) && !/fav-icon|logo|icon|property_default/i.test(url));
  const floorPlanUrls = allImageUrls.filter((url) => /\/floorplans?\//i.test(url));
  const photoUrls = allImageUrls.filter((url) => !/\/floorplans?\//i.test(url));

  const amenitiesSection = (String(html).match(/Amenities[\s\S]{0,1500}/i) || [])[0] || '';
  const highlightsSection = (String(html).match(/Highlights[\s\S]{0,1500}/i) || [])[0] || '';
  const specificationsSection = (String(html).match(/Specifications?[\s\S]{0,1500}/i) || [])[0] || '';
  const configSection = (String(html).match(/Configurations?[\s\S]{0,1500}/i) || [])[0] || '';

  const configurations = mergeUniqueStrings(parseListItems(configSection), Array.from(text.matchAll(/\b\d+(?:\.\d+)?\s*(?:BHK|RK|Shop|Office)\b/gi)).map((m) => m[0]));

  return {
    projectName,
    builderName,
    developer,
    promoter,
    location,
    address,
    category,
    RERA: rera,
    sourceProjectID: extractProjectIdFromUrl(detailUrl) || seed.sourceProjectID,
    sourceUrl: normalizeUrl(detailUrl),
    sourceCategory: seed.sourceCategory || seed.metadata?.sourceCategory || null,
    possessionDate: possession && /\d{4}|\d{1,2}[\/-]\d{1,2}/.test(possession) ? possession : null,
    totalUnits: totalUnits ? Number(String(totalUnits).replace(/[^\d]/g, '')) || null : null,
    projectStatus,
    possessionStatus,
    overview: description,
    description,
    highlights: mergeUniqueStrings(seed.highlights || [], parseListItems(highlightsSection)),
    specifications: mergeUniqueStrings(seed.specifications || [], parseListItems(specificationsSection)),
    amenities: mergeUniqueStrings(seed.amenities || [], parseListItems(amenitiesSection)),
    nearbyLocations: parseListItems((String(html).match(/Nearby[\s\S]{0,1500}/i) || [])[0]),
    configurations,
    brochureUrl: brochureUrl || null,
    photoUrls,
    floorPlanUrls,
    metadata: {
      sourceTitle: stripTags((String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''),
      rawLength: String(html || '').length,
      extractedAt: nowIso()
    }
  };
}

async function runPool(items, concurrency, worker) {
  const max = Math.max(1, Math.min(Number(concurrency) || 1, MAX_CONCURRENCY));
  const pending = new Set();
  const results = [];
  for (const item of items) {
    const task = Promise.resolve().then(() => worker(item));
    results.push(task);
    pending.add(task);
    task.finally(() => pending.delete(task));
    if (pending.size >= max) await Promise.race(pending);
  }
  return Promise.all(results);
}

class KarmaGroupScraperService {
  constructor(repository, deps = {}) {
    this.repo = repository;
    this.fetchImpl = deps.fetchImpl || global.fetch;
    this.objectStorage = deps.objectStorage || objectStorage;
    this.openPdfStreamSafely = deps.openPdfStreamSafely || openPdfStreamSafely;
    this.downloadMediaSafely = deps.downloadMediaSafely || downloadMediaSafely;
    this.listingUrl = deps.listingUrl || DEFAULT_LISTING_URL;
    this.timeoutMs = Number(deps.timeoutMs || DEFAULT_TIMEOUT_MS);
    this.maxPages = Number(deps.maxPages || DEFAULT_MAX_PAGES);
    this.maxRequests = Number(deps.maxRequests || DEFAULT_MAX_REQUESTS);
    this.concurrency = Number(deps.concurrency || DEFAULT_CONCURRENCY);
    this.mediaConcurrency = Math.max(1, Math.min(4, Number(deps.mediaConcurrency || 2)));
    this.ingestBrochures = deps.ingestBrochures !== false;
    this.ingestMedia = deps.ingestMedia === true;
    this.useCategoryDiscovery = deps.useCategoryDiscovery === true;
  }

  static getStatus() {
    const base = latestStatus ? { ...latestStatus } : makeIdleStatus();
    if (base.startedAt && base.status === 'running') {
      base.elapsedMs = Date.now() - Date.parse(base.startedAt);
    }
    return { ok: true, data: base };
  }

  static isRunning() {
    return !!(activeJob && latestStatus.status === 'running');
  }

  static __resetForTests() {
    activeJob = null;
    latestStatus = makeIdleStatus();
  }

  async startScrape({ limit = DEFAULT_LIMIT, userId = 'system' } = {}) {
    if (KarmaGroupScraperService.isRunning()) {
      return { ok: false, statusCode: 409, error: 'A scraper job is already running.' };
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT));
    latestStatus = {
      ...makeIdleStatus(),
      status: 'running',
      mode: 'full',
      startedAt: nowIso(),
      currentStage: 'discovery',
      selectedProjectID: null,
      selectedProjectName: null
    };

    activeJob = this._runFullScrapeJob({ limit: safeLimit, userId })
      .catch((error) => {
        latestStatus.status = 'failed';
        latestStatus.error = sanitizeError(error);
        latestStatus.classification = classificationFromError(error);
        latestStatus.terminalStage = 'error';
        updateStage(latestStatus, 'error');
      })
      .finally(() => {
        latestStatus.finishedAt = nowIso();
        if (latestStatus.status === 'running') {
          latestStatus.status = 'completed';
          latestStatus.terminalStage = 'complete';
          updateStage(latestStatus, 'complete');
        }
        activeJob = null;
      });

    return { ok: true, statusCode: 202, data: { status: 'accepted', startedAt: latestStatus.startedAt, mode: 'full', limit: safeLimit } };
  }

  async startTargetedScrape({ projectId = null, sourceUrl = null, userId = 'system' } = {}) {
    if (KarmaGroupScraperService.isRunning()) {
      return { ok: false, statusCode: 409, error: 'A scraper job is already running.' };
    }
    if (!projectId && !sourceUrl) {
      return { ok: false, statusCode: 400, error: 'projectId or sourceUrl is required' };
    }

    latestStatus = {
      ...makeIdleStatus(),
      status: 'running',
      mode: 'targeted',
      startedAt: nowIso(),
      currentStage: 'detail-fetch',
      selectedProjectID: projectId || null,
      selectedProjectName: null
    };

    activeJob = this._runTargetedScrapeJob({ projectId, sourceUrl, userId })
      .catch((error) => {
        latestStatus.status = 'failed';
        latestStatus.error = sanitizeError(error);
        latestStatus.classification = classificationFromError(error);
        latestStatus.terminalStage = 'error';
        updateStage(latestStatus, 'error');
      })
      .finally(() => {
        latestStatus.finishedAt = nowIso();
        if (latestStatus.status === 'running') {
          latestStatus.status = 'completed';
          latestStatus.terminalStage = 'complete';
          updateStage(latestStatus, 'complete');
        }
        activeJob = null;
      });

    return {
      ok: true,
      statusCode: 202,
      data: { status: 'accepted', startedAt: latestStatus.startedAt, mode: 'targeted', projectId: projectId || null, sourceUrl: sourceUrl || null }
    };
  }

  async _requestText(url, options = {}) {
    if (typeof this.fetchImpl !== 'function') throw new Error('Fetch implementation unavailable');
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || this.timeoutMs));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    try {
      const response = await this.fetchImpl(url, {
        method: options.method || 'GET',
        redirect: 'follow',
        signal: controller.signal,
        body: options.body,
        headers: { 'User-Agent': 'SignatureProperties-KarmaScraper/1.0', ...(options.headers || {}) }
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.statusCode = response.status;
        error.bodyPreview = stripTags(text).slice(0, 300);
        throw error;
      }
      return { url: response.url || url, text, statusCode: response.status };
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout after ${timeoutMs}ms`);
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async _requestWithRetry(url, options = {}) {
    let attempt = 0;
    while (true) {
      try {
        return await this._requestText(url, options);
      } catch (error) {
        if (!isRetryableRequestError(error) || attempt >= TRANSIENT_MAX_RETRIES) throw error;
        attempt += 1;
        const backoff = Math.min(500 * (2 ** attempt), 3000) + Math.floor(Math.random() * 200);
        await wait(backoff);
      }
    }
  }

  _extractPaginationUrls(html, baseUrl) {
    const out = new Set();
    const matches = Array.from(String(html || '').matchAll(/<a[^>]+href\s*=\s*['"]([^'"]+)['"][^>]*>/gi));
    for (const match of matches) {
      const href = match[1];
      if (!/page=|p=|next|older/i.test(href)) continue;
      try {
        const absolute = new URL(href, baseUrl).toString();
        if (/karmagroup\.co\.in/i.test(absolute)) out.add(absolute);
      } catch (_) {}
    }
    return Array.from(out);
  }

  _extractCandidatesFromListing(html, baseUrl) {
    const links = Array.from(String(html || '').matchAll(/<a[^>]+href\s*=\s*['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi));
    const candidates = [];

    for (const link of links) {
      const href = link[1];
      if (!/\/Projects\/ProjectDetail\//i.test(href)) continue;
      let abs;
      try { abs = new URL(href, baseUrl).toString(); } catch (_) { continue; }
      const sourceUrl = normalizeUrl(abs);
      const sourceProjectID = extractProjectIdFromUrl(sourceUrl);
      const projectName = stripTags(link[2]) || null;
      if (!projectName || /^info$/i.test(projectName)) continue;
      const contextStart = Math.max(0, Number(link.index || 0) - 900);
      const contextEnd = Math.min(String(html).length, Number(link.index || 0) + 1200);
      const cardContext = String(html).slice(contextStart, contextEnd);
      const cardLocation = cleanScrapedField((cardContext.match(/<h6[^>]*class=["'][^"']*realtor-card-location[^"']*["'][^>]*>([\s\S]*?)<\/h6>/i) || [])[1]);
      const cardStatus = cleanScrapedField((cardContext.match(/<div[^>]*class=["'][^"']*realtor-badge[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1]);

      const tag = link[0];
      const candidate = normalizeCandidate({
        projectName,
        builderName: (tag.match(/data-builder\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null,
        developer: (tag.match(/data-developer\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null,
        promoter: (tag.match(/data-promoter\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null,
        location: (tag.match(/data-location\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || (cardLocation ? cardLocation.split(',')[0].trim() : null),
        address: (tag.match(/data-address\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null,
        category: (tag.match(/data-category\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null,
        RERA: (tag.match(/data-rera\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || null,
        sourceProjectID,
        sourceUrl,
        metadata: { discoveredFrom: baseUrl, listingStatus: cardStatus }
      });

      candidates.push(candidate);
    }

    const dedupe = new Map();
    for (const candidate of candidates) {
      const key = candidate.sourceProjectID || normalizeUrl(candidate.sourceUrl) || `${normalizeLoose(candidate.projectName)}|${normalizeLoose(candidate.location)}`;
      if (!dedupe.has(key)) dedupe.set(key, candidate);
    }

    return Array.from(dedupe.values());
  }

  async discoverCandidates({ maxPages = this.maxPages, maxRequests = this.maxRequests } = {}) {
    if (this.useCategoryDiscovery) return this.discoverCategoryCandidates();
    updateStage(latestStatus, 'discovery');
    const queue = [this.listingUrl];
    const visited = new Set();
    const allCandidates = [];
    let requests = 0;

    while (queue.length && visited.size < maxPages && requests < maxRequests) {
      const next = queue.shift();
      const normalized = normalizeUrl(next);
      if (!normalized || visited.has(normalized)) continue;
      visited.add(normalized);
      requests += 1;

      let page;
      try {
        page = await this._requestWithRetry(normalized);
      } catch (error) {
        if (isHttpError(error) && STALE_STATUS.has(Number(error.statusCode || 0))) continue;
        if (isTransient(error)) continue;
        throw error;
      }

      const candidates = this._extractCandidatesFromListing(page.text, page.url || normalized);
      allCandidates.push(...candidates);
      for (const paginationUrl of this._extractPaginationUrls(page.text, page.url || normalized)) {
        const normalizedPage = normalizeUrl(paginationUrl);
        if (normalizedPage && !visited.has(normalizedPage)) queue.push(normalizedPage);
      }
    }

    const dedupe = new Map();
    for (const candidate of allCandidates) {
      const key = candidate.sourceProjectID || normalizeUrl(candidate.sourceUrl) || `${normalizeLoose(candidate.projectName)}|${normalizeLoose(candidate.location)}`;
      if (!dedupe.has(key)) dedupe.set(key, candidate);
    }

    return { ok: true, candidates: Array.from(dedupe.values()), visitedPages: visited.size, requests };
  }

  async discoverCategoryCandidates() {
    const allCandidates = [];
    let requests = 0;
    for (const filter of KARMA_CATEGORY_FILTERS) {
      updateStage(latestStatus, 'discovery', { selectedProjectName: filter.sourceCategory });
      const body = new URLSearchParams();
      body.set('PageNumber', '1');
      body.set('PageSize', '500');
      body.set('Filters[0][field]', 'ItemCategory');
      body.set('Filters[0][value]', filter.id);
      const page = await this._requestWithRetry(KARMA_PROJECT_LIST_URL, {
        method: 'POST',
        body: body.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
      });
      requests += 1;
      const candidates = this._extractCandidatesFromListing(page.text, page.url || KARMA_PROJECT_LIST_URL);
      for (const candidate of candidates) {
        allCandidates.push(normalizeCandidate({
          ...candidate,
          category: filter.category,
          sourceCategory: filter.sourceCategory,
          metadata: { ...(candidate.metadata || {}), sourceCategory: filter.sourceCategory, categoryFilterId: filter.id }
        }));
      }
    }
    const dedupe = new Map();
    for (const candidate of allCandidates) {
      const key = candidate.sourceProjectID || candidate.sourceUrl;
      if (key && !dedupe.has(key)) dedupe.set(key, candidate);
    }
    return {
      ok: true,
      candidates: Array.from(dedupe.values()),
      visitedPages: KARMA_CATEGORY_FILTERS.length,
      requests
    };
  }

  async _fetchAndParseDetail(candidate, statusRef = latestStatus) {
    const normalized = normalizeCandidate(candidate);
    if (!normalized.sourceUrl) {
      const error = new Error('Missing sourceUrl');
      error.code = 'BAD_SOURCE_URL';
      throw error;
    }

    updateStage(statusRef, 'detail-fetch', {
      selectedProjectName: normalized.projectName || statusRef.selectedProjectName || null
    });

    let detail;
    try {
      detail = await this._requestWithRetry(normalized.sourceUrl);
    } catch (error) {
      const classification = classificationFromError(error);
      return { ok: false, classification, statusCode: error.statusCode || null, error: sanitizeError(error), detailUrl: normalized.sourceUrl, bodyPreview: error.bodyPreview || null };
    }

    const parsed = parseProjectDetailHtml(detail.text, detail.url || normalized.sourceUrl, normalized);
    return { ok: true, parsed };
  }

  _findExistingByIdentity(db, candidate) {
    db.BuilderProjects = db.BuilderProjects || [];
    const c = normalizeCandidate(candidate);
    const normalizedSourceUrl = normalizeUrl(c.sourceUrl || '');

    const bySourceProject = c.sourceProjectID
      ? db.BuilderProjects.find((row) => normalizeLoose(row.SourceProjectID) === normalizeLoose(c.sourceProjectID))
      : null;
    if (bySourceProject) return bySourceProject;

    const bySourceUrl = normalizedSourceUrl
      ? db.BuilderProjects.find((row) => normalizeUrl(row.SourceUrl || '') === normalizedSourceUrl)
      : null;
    if (bySourceUrl) return bySourceUrl;

    // A canonical source identity must never fall through to a loose
    // name/builder/location match. Karma can list distinct projects with the
    // same display name and locality; collapsing those records loses source IDs.
    if (c.sourceProjectID || normalizedSourceUrl) return null;

    const byRera = c.RERA ? db.BuilderProjects.find((row) => normalizeLoose(row.RERANumber) === normalizeLoose(c.RERA)) : null;
    if (byRera) return byRera;

    return db.BuilderProjects.find((row) => (
      normalizeLoose(row.ProjectName) === normalizeLoose(c.projectName) &&
      normalizeLoose(row.BuilderName) === normalizeLoose(c.builderName) &&
      normalizeLoose(row.Location1) === normalizeLoose(c.location)
    )) || null;
  }

  async _resolveCanonicalCandidate(existingProject, discoveredCandidates) {
    const ranked = rankMatches(existingProject, discoveredCandidates);
    latestStatus.matchDiagnostics = ranked.scored.slice(0, 5).map((item) => ({
      projectName: item.candidate.projectName,
      sourceProjectID: item.candidate.sourceProjectID,
      sourceUrl: item.candidate.sourceUrl,
      score: item.score,
      breakdown: item.breakdown
    }));

    if (ranked.resolution === 'AUTO_MATCH' && ranked.best) {
      return { ok: true, candidate: ranked.best.candidate, diagnostics: latestStatus.matchDiagnostics, resolution: 'AUTO_MATCH' };
    }

    if (!ranked.best || ranked.resolution === 'UNRESOLVED') {
      return {
        ok: false,
        classification: 'AMBIGUOUS_CANONICAL_MATCH',
        diagnostics: latestStatus.matchDiagnostics,
        fallbackResolution: { resolution: ranked.resolution, reason: 'No confident canonical match from public listing.' }
      };
    }

    const topForEnrichment = ranked.scored.slice(0, 3);
    const enrichedCandidates = [];
    for (const entry of topForEnrichment) {
      const detail = await this._fetchAndParseDetail(entry.candidate);
      if (detail.ok) {
        enrichedCandidates.push(normalizeCandidate({ ...entry.candidate, ...detail.parsed }));
      } else {
        enrichedCandidates.push(entry.candidate);
      }
    }

    const reranked = rankMatches(existingProject, enrichedCandidates);
    const rerankedDiagnostics = reranked.scored.slice(0, 5).map((item) => ({
      projectName: item.candidate.projectName,
      sourceProjectID: item.candidate.sourceProjectID,
      sourceUrl: item.candidate.sourceUrl,
      score: item.score,
      breakdown: item.breakdown
    }));
    latestStatus.matchDiagnostics = rerankedDiagnostics;

    if (reranked.resolution === 'AUTO_MATCH' && reranked.best) {
      return {
        ok: true,
        candidate: reranked.best.candidate,
        diagnostics: rerankedDiagnostics,
        resolution: 'AUTO_MATCH_AFTER_ENRICHMENT'
      };
    }

    return {
      ok: false,
      classification: 'AMBIGUOUS_CANONICAL_MATCH',
      diagnostics: rerankedDiagnostics,
      fallbackResolution: {
        resolution: reranked.resolution,
        reason: 'Current public candidates remained ambiguous after enrichment.'
      }
    };
  }

  async _ingestBrochure(project, brochureUrl, statusRef = latestStatus) {
    const normalizedBrochure = normalizeUrl(brochureUrl || '');
    if (!normalizedBrochure) return { ok: false, error: 'Invalid brochure URL' };
    try {
      assertPublicHttpUrl(normalizedBrochure);
    } catch (error) {
      return { ok: false, error: sanitizeError(error) };
    }

    const maxBytes = Math.min(BROCHURE_DEFAULT_MAX_BYTES, BROCHURE_HARD_MAX_BYTES, Number(process.env.BUILDER_PROJECT_BROCHURE_MAX_BYTES || BROCHURE_DEFAULT_MAX_BYTES));
    updateStage(statusRef, 'download-open', {
      contentLength: null,
      downloadedBytes: 0,
      uploadedBytes: null,
      uploadCompleted: false
    });

    const streamResult = await this.openPdfStreamSafely(normalizedBrochure, {
      timeoutMs: this.timeoutMs,
      maxBytes,
      observer: (event) => {
        if (event?.stage === 'download-response-start') {
          updateStage(statusRef, 'download-open', { contentLength: event.contentLength || null });
        } else if (event?.stage === 'download-first-byte' || event?.stage === 'download-progress') {
          updateStage(statusRef, 'download-stream', {
            downloadedBytes: typeof event.downloadedBytes === 'number' ? event.downloadedBytes : statusRef.downloadedBytes
          });
        }
      }
    });

    if (!streamResult.ok) return { ok: false, error: sanitizeError(streamResult.error) };

    updateStage(statusRef, 'storage-upload', { uploadedBytes: null });

    const storageKey = `builder-projects/${project.ProjectID}/brochures/${safeProjectName(project.ProjectName)}.pdf`;
    let upload;
    try {
      upload = await this.objectStorage.putObjectStream(storageKey, streamResult.stream, 'application/pdf', `${project.ProjectName || project.ProjectID}.pdf`);
    } catch (error) {
      return { ok: false, error: `Upload failed: ${sanitizeError(error)}` };
    }

    const mediaId = this.repo.createId('MED');
    project.Brochures = Array.isArray(project.Brochures) ? project.Brochures : [];
    project.Brochures = project.Brochures.filter((row) => normalizeUrl(row?.OriginalUrl || row?.SourceUrl || '') !== normalizedBrochure);
    project.Brochures.push({
      MediaID: mediaId,
      Filename: `${project.ProjectName || project.ProjectID}.pdf`,
      StoragePath: upload.path,
      Url: `/api/v2/builder-projects/media/${mediaId}`,
      Source: 'KarmaGroupScrape',
      OriginalUrl: normalizedBrochure,
      UploadedAt: nowIso(),
      UploadedBy: 'system'
    });

    updateStage(statusRef, 'storage-upload', { uploadCompleted: true, uploadedBytes: null });
    return { ok: true, storagePath: upload.path };
  }

  async _ingestOneProjectMedia(project, sourceUrl, field, mediaType) {
    const sourceKey = mediaSourceKey(sourceUrl);
    project[field] = Array.isArray(project[field]) ? project[field] : [];
    const existing = project[field].find((row) => row?.SourceKey === sourceKey && row?.StoragePath && row?.verified === true);
    if (existing) return { ok: true, reused: true, bytesStored: 0, record: existing };

    const downloaded = await this.downloadMediaSafely(sourceUrl, {
      kind: mediaType === 'brochure' ? 'pdf' : 'image',
      timeoutMs: Math.max(this.timeoutMs, 30000),
      maxBytes: mediaType === 'brochure' ? BROCHURE_HARD_MAX_BYTES : IMAGE_MAX_BYTES,
      allowImageHeaderMismatch: mediaType !== 'brochure'
    });
    if (!downloaded.ok) return { ok: false, sourceKey, mediaType, error: sanitizeError(downloaded.error) };

    const extension = extensionForContentType(downloaded.contentType);
    const filename = filenameFromMediaUrl(sourceUrl, `${mediaType}-${sourceKey}`, downloaded.contentType);
    const storageFolder = mediaType === 'brochure' ? 'brochures' : (mediaType === 'floor_plan' ? 'floor-plans' : 'photos');
    const storagePath = `builder-projects/${project.ProjectID}/${storageFolder}/${sourceKey}.${extension}`;
    const stored = await this.objectStorage.putObject(storagePath, downloaded.buffer, downloaded.contentType, filename, {
      metadata: { projectId: project.ProjectID, mediaType, source: 'KarmaGroupScrape', sourceKey }
    });
    const info = await this.objectStorage.getObjectInfo(storagePath);
    if (!info || Number(info.size) !== downloaded.buffer.length) {
      try { await this.objectStorage.deleteObject(storagePath); } catch (_) {}
      return { ok: false, sourceKey, mediaType, error: 'GridFS size verification failed' };
    }

    const mediaId = this.repo.createId('MED');
    const internalUrl = mediaType === 'brochure'
      ? `/api/v2/builder-projects/${encodeURIComponent(project.ProjectID)}/brochure`
      : (mediaType === 'project_image'
        ? `/api/v2/builder-projects/${encodeURIComponent(project.ProjectID)}/images/${encodeURIComponent(mediaId)}`
        : `/api/v2/builder-projects/media/${encodeURIComponent(mediaId)}`);
    const record = {
      MediaID: mediaId,
      Filename: filename,
      StoragePath: stored.path,
      Url: internalUrl,
      Source: 'KarmaGroupScrape',
      SourceKey: sourceKey,
      mimeType: downloaded.contentType,
      sizeBytes: downloaded.buffer.length,
      storageType: 'gridfs',
      storageBucket: this.objectStorage.BUCKET_NAME || 'signature_objects',
      stored: true,
      verified: true,
      downloadStatus: 'downloaded',
      UploadedAt: nowIso(),
      UploadedBy: 'system'
    };
    project[field] = project[field].filter((row) => row?.SourceKey !== sourceKey);
    project[field].push(record);
    return { ok: true, reused: false, bytesStored: downloaded.buffer.length, record };
  }

  async _ingestProjectMedia(project, parsed, counters) {
    const queue = [
      ...(parsed.photoUrls || []).map((url) => ({ url, field: 'Photos', mediaType: 'project_image' })),
      ...(parsed.floorPlanUrls || []).map((url) => ({ url, field: 'FloorPlans', mediaType: 'floor_plan' })),
      ...(parsed.brochureUrl ? [{ url: parsed.brochureUrl, field: 'Brochures', mediaType: 'brochure' }] : [])
    ];
    counters.mediaDiscovered += queue.length;
    project.Photos = (Array.isArray(project.Photos) ? project.Photos : []).filter((row) => row?.StoragePath && row?.Url?.startsWith('/api/'));
    project.FloorPlans = (Array.isArray(project.FloorPlans) ? project.FloorPlans : []).filter((row) => row?.StoragePath && row?.Url?.startsWith('/api/'));
    project.Brochures = (Array.isArray(project.Brochures) ? project.Brochures : []).filter((row) => row?.StoragePath && row?.Url?.startsWith('/api/'));
    project.BrochureUrl = null;
    const failures = [];
    await runPool(queue, this.mediaConcurrency, async (item) => {
      try {
        updateStage(latestStatus, 'media-storage', { selectedProjectID: project.ProjectID, selectedProjectName: project.ProjectName });
        const result = await this._ingestOneProjectMedia(project, item.url, item.field, item.mediaType);
        if (result.ok) {
          if (result.reused) counters.mediaReused += 1;
          else counters.mediaStored += 1;
          counters.mediaBytesStored += Number(result.bytesStored || 0);
        } else {
          counters.mediaFailed += 1;
          failures.push({ sourceKey: result.sourceKey, mediaType: result.mediaType, error: result.error });
        }
      } catch (error) {
        counters.mediaFailed += 1;
        failures.push({ sourceKey: mediaSourceKey(item.url), mediaType: item.mediaType, error: sanitizeError(error) });
      }
    });
    project.MediaIngestion = {
      source: 'KarmaGroupScrape',
      discovered: queue.length,
      stored: queue.length - failures.length,
      failed: failures.length,
      failures: failures.slice(0, 25),
      completedAt: nowIso()
    };
  }

  _applyParsedProjectData(existing, parsed, options = {}) {
    const beforeSignature = JSON.stringify(existing);

    existing.ProjectName = pickNonEmpty(parsed.projectName, existing.ProjectName);
    existing.BuilderName = pickNonEmpty(parsed.builderName, existing.BuilderName);
    existing.DeveloperName = pickNonEmpty(parsed.developer, existing.DeveloperName);
    existing.PromoterName = pickNonEmpty(parsed.promoter, existing.PromoterName);
    existing.Address = pickNonEmpty(parsed.address, existing.Address);
    existing.Location1 = pickNonEmpty(parsed.location, existing.Location1);
    existing.Category = pickNonEmpty(parsed.category, existing.Category);
    existing.PossessionDate = pickNonEmpty(parsed.possessionDate, existing.PossessionDate);
    if (parsed.RERA) {
      existing.RERANumber = parsed.RERA;
    } else if (existing.ImportedFrom === 'KarmaGroupScrape' && existing.RERANumber && !normalizeGujaratRera(existing.RERANumber)) {
      existing.RERANumber = null;
    }
    existing.ProjectStatus = pickNonEmpty(parsed.projectStatus, existing.ProjectStatus);
    existing.PossessionStatus = pickNonEmpty(parsed.possessionStatus, existing.PossessionStatus);
    if (parsed.totalUnits != null && Number.isFinite(parsed.totalUnits)) existing.TotalUnits = parsed.totalUnits;

    existing.Amenities = mergeUniqueStrings(existing.Amenities || [], parsed.amenities || []);
    existing.Configurations = mergeUniqueStrings(existing.Configurations || [], parsed.configurations || []);
    existing.Highlights = mergeUniqueStrings(existing.Highlights || [], parsed.highlights || []);
    existing.Specifications = mergeUniqueStrings(existing.Specifications || [], parsed.specifications || []);

    existing.Overview = pickNonEmpty(parsed.overview, existing.Overview);
    existing.Description = pickNonEmpty(parsed.description, existing.Description);
    existing.Notes = pickNonEmpty(parsed.description, existing.Notes);

    if (!this.ingestMedia) {
      existing.Photos = mergeMediaByUrl(existing.Photos || [], parsed.photoUrls || []);
      existing.FloorPlans = mergeMediaByUrl(existing.FloorPlans || [], parsed.floorPlanUrls || []);
    }
    existing.SourceCategory = pickNonEmpty(parsed.sourceCategory, existing.SourceCategory);

    if (options.allowSourceIdentityUpdate !== false) {
      existing.SourceProjectID = pickNonEmpty(parsed.sourceProjectID, existing.SourceProjectID);
      existing.SourceUrl = pickNonEmpty(parsed.sourceUrl, existing.SourceUrl);
    }

    existing.ImportedFrom = pickNonEmpty('KarmaGroupScrape', existing.ImportedFrom);
    existing.ImportHistory = Array.isArray(existing.ImportHistory) ? existing.ImportHistory : [];
    existing.ImportHistory.unshift({
      ImportedAt: nowIso(),
      Source: 'KarmaGroupScrape',
      SourceUrl: parsed.sourceUrl || null,
      SourceProjectID: parsed.sourceProjectID || null,
      Stage: options.stage || 'detail-fetch'
    });
    existing.ImportHistory = existing.ImportHistory.slice(0, 100);
    existing.UpdatedAt = nowIso();

    return JSON.stringify(existing) !== beforeSignature;
  }

  _createProjectFromParsed(db, parsed, userId = 'system') {
    db.BuilderProjects = db.BuilderProjects || [];
    const projectId = this.repo.createId('BLDP');
    const row = {
      ProjectID: projectId,
      ProjectName: parsed.projectName || 'Unnamed Project',
      BuilderName: parsed.builderName || parsed.developer || parsed.promoter || 'Unknown Builder',
      DeveloperName: parsed.developer || parsed.builderName || 'Unknown Builder',
      PromoterName: parsed.promoter || parsed.builderName || 'Unknown Builder',
      Address: parsed.address || null,
      Location1: parsed.location || 'Surat',
      Category: parsed.category || 'Residential',
      Configurations: mergeUniqueStrings([], parsed.configurations || []),
      PossessionDate: parsed.possessionDate || null,
      RERANumber: parsed.RERA || null,
      ProjectStatus: parsed.projectStatus || 'Under Construction',
      PossessionStatus: parsed.possessionStatus || null,
      TotalUnits: parsed.totalUnits || null,
      Amenities: mergeUniqueStrings([], parsed.amenities || []),
      Highlights: mergeUniqueStrings([], parsed.highlights || []),
      Specifications: mergeUniqueStrings([], parsed.specifications || []),
      Overview: parsed.overview || null,
      Description: parsed.description || null,
      Notes: parsed.description || null,
      Photos: this.ingestMedia ? [] : mergeMediaByUrl([], parsed.photoUrls || []),
      FloorPlans: this.ingestMedia ? [] : mergeMediaByUrl([], parsed.floorPlanUrls || []),
      BrochureUrl: this.ingestMedia ? null : (parsed.brochureUrl || null),
      Brochures: [],
      SourceUrl: parsed.sourceUrl || null,
      SourceProjectID: parsed.sourceProjectID || null,
      SourceCategory: parsed.sourceCategory || null,
      ImportedFrom: 'KarmaGroupScrape',
      ImportHistory: [{ ImportedAt: nowIso(), Source: 'KarmaGroupScrape', SourceUrl: parsed.sourceUrl || null, SourceProjectID: parsed.sourceProjectID || null, Stage: 'create' }],
      Active: true,
      CreatedAt: nowIso(),
      UpdatedAt: nowIso(),
      CreatedBy: userId
    };
    db.BuilderProjects.push(row);
    return row;
  }

  async _processCandidate(db, candidate, counters, userId) {
    counters.scanned += 1;
    latestStatus.selectedProjectName = candidate.projectName || null;
    latestStatus.selectedProjectID = null;

    const detailResult = await this._fetchAndParseDetail(candidate, latestStatus);
    if (!detailResult.ok) {
      counters.failed += 1;
      if (detailResult.classification === 'TRANSIENT_NETWORK_ERROR') counters.transientFailures += 1;
      if (detailResult.classification === 'STALE_DETAIL') counters.staleDetailFailures += 1;
      return;
    }

    const parsed = detailResult.parsed;
    const existing = this._findExistingByIdentity(db, parsed);
    updateStage(latestStatus, 'project-mutation', {
      selectedProjectID: existing?.ProjectID || null,
      selectedProjectName: parsed.projectName || existing?.ProjectName || null
    });

    if (existing) {
      const changed = this._applyParsedProjectData(existing, parsed, { allowSourceIdentityUpdate: true, stage: 'update' });
      if (this.ingestMedia) {
        await this._ingestProjectMedia(existing, parsed, counters);
      } else if (parsed.brochureUrl && this.ingestBrochures) {
        existing.BrochureUrl = pickNonEmpty(parsed.brochureUrl, existing.BrochureUrl);
        const brochure = await this._ingestBrochure(existing, parsed.brochureUrl, latestStatus);
        if (!brochure.ok) {
          existing.Notes = mergeUniqueStrings([existing.Notes].filter(Boolean), [`Brochure ingest failed: ${brochure.error}`]).join(' | ').slice(0, 900);
        }
      }
      if (changed) counters.updated += 1;
      else counters.unchanged += 1;
      return;
    }

    const created = this._createProjectFromParsed(db, parsed, userId);
    latestStatus.selectedProjectID = created.ProjectID;
    if (this.ingestMedia) {
      await this._ingestProjectMedia(created, parsed, counters);
    } else if (parsed.brochureUrl && this.ingestBrochures) {
      const brochure = await this._ingestBrochure(created, parsed.brochureUrl, latestStatus);
      if (!brochure.ok) {
        created.Notes = mergeUniqueStrings([created.Notes].filter(Boolean), [`Brochure ingest failed: ${brochure.error}`]).join(' | ').slice(0, 900);
      }
    }
    counters.created += 1;
  }

  async _runFullScrapeJob({ limit, userId }) {
    const db = this.repo.read();
    db.BuilderProjects = db.BuilderProjects || [];

    const counters = {
      scanned: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      ambiguous: 0,
      transientFailures: 0,
      staleDetailFailures: 0,
      mediaDiscovered: 0,
      mediaStored: 0,
      mediaReused: 0,
      mediaFailed: 0,
      mediaBytesStored: 0
    };

    const discovery = await this.discoverCandidates({});
    const selected = discovery.candidates.slice(0, limit);

    await runPool(selected, this.concurrency, async (candidate) => {
      try {
        await this._processCandidate(db, candidate, counters, userId);
      } catch (error) {
        counters.failed += 1;
        const classification = classificationFromError(error);
        if (classification === 'TRANSIENT_NETWORK_ERROR') counters.transientFailures += 1;
        if (classification === 'STALE_DETAIL') counters.staleDetailFailures += 1;
      }
      if (counters.scanned % 20 === 0) this.repo.write(db);
    });

    this.repo.write(db);

    latestStatus.result = {
      ...counters,
      discoveredCandidates: discovery.candidates.length,
      visitedPages: discovery.visitedPages,
      requests: discovery.requests
    };
    latestStatus.classification = 'SUCCESS';
    updateStage(latestStatus, 'complete');
  }

  async _runTargetedScrapeJob({ projectId, sourceUrl, userId }) {
    const db = this.repo.read();
    db.BuilderProjects = db.BuilderProjects || [];

    const existing = projectId
      ? db.BuilderProjects.find((row) => row.ProjectID === String(projectId).trim())
      : db.BuilderProjects.find((row) => normalizeUrl(row.SourceUrl || '') === normalizeUrl(sourceUrl || ''));

    if (projectId && !existing) {
      throw Object.assign(new Error(`Project not found: ${projectId}`), { code: 'NOT_FOUND' });
    }

    const selectedProject = existing || null;
    latestStatus.selectedProjectID = selectedProject?.ProjectID || null;
    latestStatus.selectedProjectName = selectedProject?.ProjectName || null;

    const initialCandidate = normalizeCandidate({
      projectName: selectedProject?.ProjectName,
      builderName: selectedProject?.BuilderName,
      location: selectedProject?.Location1,
      category: selectedProject?.Category,
      RERA: selectedProject?.RERANumber,
      sourceProjectID: selectedProject?.SourceProjectID,
      sourceUrl: sourceUrl || selectedProject?.SourceUrl
    });

    let parsed = null;
    let fallbackResolution = null;

    if (initialCandidate.sourceUrl) {
      const initialDetail = await this._fetchAndParseDetail(initialCandidate, latestStatus);
      if (initialDetail.ok) {
        parsed = initialDetail.parsed;
      } else if (initialDetail.classification === 'STALE_DETAIL' && selectedProject) {
        const discovery = await this.discoverCandidates({});
        const matched = await this._resolveCanonicalCandidate(selectedProject, discovery.candidates);
        if (!matched.ok) {
          latestStatus.classification = matched.classification;
          latestStatus.fallbackResolution = matched.fallbackResolution;
          latestStatus.error = 'Legacy Karma page returned HTTP 500/404 and canonical candidates were ambiguous. Existing Builder Project was preserved.';
          latestStatus.result = {
            scanned: 1,
            created: 0,
            updated: 0,
            unchanged: 1,
            skipped: 1,
            failed: 0,
            ambiguous: 1,
            transientFailures: 0,
            staleDetailFailures: 1
          };
          this.repo.write(db);
          updateStage(latestStatus, 'complete');
          return;
        }

        const canonicalDetail = await this._fetchAndParseDetail(matched.candidate, latestStatus);
        if (!canonicalDetail.ok) {
          throw Object.assign(new Error(canonicalDetail.error || 'Canonical detail fetch failed'), {
            statusCode: canonicalDetail.statusCode,
            code: canonicalDetail.classification
          });
        }
        parsed = canonicalDetail.parsed;
        fallbackResolution = {
          mode: 'CANONICAL_FALLBACK',
          resolution: matched.resolution,
          previousSourceUrl: initialCandidate.sourceUrl,
          newSourceUrl: matched.candidate.sourceUrl,
          matchDiagnostics: matched.diagnostics
        };
      } else {
        throw Object.assign(new Error(initialDetail.error || 'Target detail fetch failed'), {
          statusCode: initialDetail.statusCode,
          code: initialDetail.classification
        });
      }
    }

    if (!parsed && sourceUrl) {
      const candidate = normalizeCandidate({ sourceUrl });
      const detail = await this._fetchAndParseDetail(candidate, latestStatus);
      if (!detail.ok) throw Object.assign(new Error(detail.error || 'Target detail fetch failed'), { statusCode: detail.statusCode, code: detail.classification });
      parsed = detail.parsed;
    }

    if (!parsed) {
      throw new Error('Unable to resolve canonical project detail from target request');
    }

    let targetProject = selectedProject || this._findExistingByIdentity(db, parsed);
    if (!targetProject) {
      targetProject = this._createProjectFromParsed(db, parsed, userId);
      latestStatus.selectedProjectID = targetProject.ProjectID;
    } else {
      this._applyParsedProjectData(targetProject, parsed, { allowSourceIdentityUpdate: true, stage: 'targeted-update' });
    }

    if (parsed.brochureUrl) {
      targetProject.BrochureUrl = pickNonEmpty(parsed.brochureUrl, targetProject.BrochureUrl);
      const brochure = await this._ingestBrochure(targetProject, parsed.brochureUrl, latestStatus);
      if (!brochure.ok) {
        targetProject.Notes = mergeUniqueStrings([targetProject.Notes].filter(Boolean), [`Brochure ingest failed: ${brochure.error}`]).join(' | ').slice(0, 900);
      }
    }

    this.repo.write(db);

    latestStatus.fallbackResolution = fallbackResolution;
    latestStatus.classification = fallbackResolution ? 'RECOVERED_CANONICAL' : 'SUCCESS';
    latestStatus.result = {
      scanned: 1,
      created: selectedProject ? 0 : 1,
      updated: selectedProject ? 1 : 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      ambiguous: 0,
      transientFailures: 0,
      staleDetailFailures: fallbackResolution ? 1 : 0
    };

    updateStage(latestStatus, 'complete');
  }
}

module.exports = {
  KarmaGroupScraperService,
  normalizeCandidate,
  normalizeUrl,
  rankMatches,
  parseProjectDetailHtml,
  classificationFromError,
  STALE_STATUS,
  TRANSIENT_CODES
};
