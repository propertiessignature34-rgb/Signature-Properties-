'use strict';

const { parse: csvParse } = require('csv-parse/sync');
const readXlsxFile = require('read-excel-file/node');
const objectStorage = require('./objectStorageService');
const { downloadMediaSafely } = require('./safeUrlDownloader');
const crypto = require('node:crypto');

const MEDIA_MIME_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
  pdf: 'application/pdf'
};
const MEDIA_FIELD = { photo: 'Photos', video: 'Videos', brochure: 'Brochures' };
const STORAGE_BUCKET = objectStorage.BUCKET_NAME || 'signature_objects';
const URL_IMPORT_LIMITS = {
  brochure: { kind: 'pdf', maxBytes: 20 * 1024 * 1024, field: 'Brochures', contentType: 'application/pdf' },
  photo: { kind: 'image', maxBytes: 12 * 1024 * 1024, field: 'Photos' }
};

function checksumOf(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function filenameFromUrl(sourceUrl, kind, mediaId) {
  let candidate = '';
  try {
    candidate = decodeURIComponent(new URL(sourceUrl).pathname.split('/').pop() || '');
  } catch (_) {}
  candidate = candidate.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(0, 100);
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(candidate);
  if (!candidate || !hasExtension) candidate = `${mediaId}.${kind === 'pdf' ? 'pdf' : 'jpg'}`;
  return candidate;
}

/**
 * BuilderProjectService — Surat builder project master data.
 *
 * Separate from Inventory (which holds broker-sellable listings). A Builder
 * Project is project-level info (project name, builder, location, unit
 * configs, price range, possession) that brokers can browse/share, added
 * either manually or via bulk CSV/Excel upload. No RERA validation or
 * area allow-list — RERA Number is a free, optional field.
 */

const COLUMN_ALIASES = {
  ProjectName:    ['projectname', 'project name', 'project'],
  BuilderName:    ['buildername', 'builder name', 'builder'],
  DeveloperName:  ['developername', 'developer name'],
  PromoterName:   ['promotername', 'promoter name'],
  Location1:      ['location', 'location1', 'locality', 'area'],
  Locality:       ['locality'],
  Area:           ['area'],
  Address:        ['address', 'fulladdress', 'projectaddress'],
  City:           ['city'],
  State:          ['state'],
  Pincode:        ['pincode', 'postal code', 'postalcode', 'zip'],
  Latitude:       ['latitude', 'lat'],
  Longitude:      ['longitude', 'lng', 'lon'],
  MapUrl:         ['map url', 'mapurl', 'location map', 'location url'],
  RERANumber:     ['reranumber', 'rera number', 'rera no', 'rera'],
  ReraUrl:        ['rera url', 'reraurl', 'rera link'],
  ProjectStatus:  ['projectstatus', 'project status', 'status'],
  PossessionStatus:['possessionstatus', 'possession status'],
  Category:       ['category', 'property category', 'propertycategory'],
  UnitType:       ['unittype', 'unit type', 'configuration', 'bhk', 'config'],
  UnitCount:      ['unitcount', 'unit count', 'totalunits', 'total units', 'units', 'no of units'],
  CarpetAreaSqft: ['carpetarea', 'carpet area', 'carpet area sqft', 'carpetareasqft'],
  CarpetAreaRange:['carpet area range', 'carpetarearange'],
  BuiltUpAreaRange:['built-up area range', 'builtup area range', 'builtuparearange'],
  SaleableAreaRange:['saleable area range', 'saleablearearange', 'super built-up area'],
  PriceMin:       ['pricemin', 'price min', 'startingprice', 'starting price'],
  PriceMax:       ['pricemax', 'price max'],
  StartingPrice:  ['starting price', 'startingprice'],
  PricePerSqft:   ['price per sqft', 'pricepersqft', 'price/sqft', 'ppsf'],
  PossessionDate: ['possessiondate', 'possession date', 'possession'],
  Amenities:      ['amenities'],
  BrochureUrl:    ['brochureurl', 'brochure url', 'brochure'],
  SourceUrl:      ['sourceurl', 'source url', 'project url', 'detail url'],
  SourceProjectID:['sourceprojectid', 'source project id', 'karma project id', 'project id'],
  AreaRange:      ['arearange', 'area range', 'carpet area range'],
  ProjectArea:    ['project area', 'land area', 'plot area'],
  TotalTowers:    ['towers', 'tower count', 'buildings', 'building count'],
  TotalFloors:    ['floors', 'floor count'],
  PriceText:      ['price', 'price range', 'pricetext', 'price text'],
  Notes:          ['description', 'project description', 'notes'],
  Overview:       ['overview'],
  Description:    ['description'],
  Highlights:     ['highlights', 'project highlights'],
  Specifications: ['specifications', 'specification'],
  PhotoUrls:      ['photo urls', 'photos', 'image urls', 'project images'],
  FloorPlanUrls:  ['floor plan urls', 'floor plans', 'floorplans', 'unit plans'],
  SitePlanUrls:   ['site plan urls', 'site plans', 'layout plans', 'master plans']
};

const STATUS_MAP = {
  'new': 'New Launch', 'new launch': 'New Launch', 'launching soon': 'New Launch', 'pre launch': 'New Launch',
  'ongoing': 'Under Construction', 'under construction': 'Under Construction', 'in progress': 'Under Construction', 'active': 'Under Construction',
  'ready': 'Ready to Move', 'ready to move': 'Ready to Move', 'possession given': 'Ready to Move',
  'completed': 'Completed', 'occupied': 'Completed', 'oc received': 'Completed'
};

function normalizeStatus(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return STATUS_MAP[key] || (key ? 'Under Construction' : 'Under Construction');
}

function normalizeConfig(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase().replace(/BEDROOM(S)?/g, 'BHK').replace(/(\d)\s*-?\s*(BHK|RK)/g, '$1 $2').replace(/\s+/g, ' ');
  const m = s.match(/(\d+(?:\.\d+)?)\s*(BHK|RK)/);
  if (m) return `${m[1]} ${m[2]}`;
  return s || null;
}

function normalizeKeyPart(value) {
  return String(value || '').trim().toLowerCase().replace(/\b(\d+)\s*-?\s*bhk\b/g, '$1 bhk').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanText(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&#8377;?/g, '₹').replace(/\s+/g, ' ').trim();
}

function splitList(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(String(value || '').includes('|') ? '|' : ',').map((s) => cleanText(s)).filter(Boolean);
}

function mergeUnique(existing, incoming, normalizer = (v) => cleanText(v).toLowerCase()) {
  const out = [];
  const seen = new Set();
  for (const value of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const cleaned = cleanText(value);
    const key = normalizer(cleaned);
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function validateAddressQuality(existing, incoming) {
  const ex = String(existing || '').trim();
  const inc = String(incoming || '').trim();
  if (!ex && inc) return inc;
  if (!inc) return ex;
  const commaCount = (str) => (str.match(/,/g) || []).length;
  const exDetail = commaCount(ex);
  const incDetail = commaCount(inc);
  if (exDetail > incDetail) return ex;
  if (ex.length > inc.length * 1.2) return ex;
  if (inc.length > ex.length * 1.2) return inc;
  return ex;
}

function isValidImportedRera(value) {
  const text = cleanText(value);
  return text.length <= 30 && /^[A-Z0-9][A-Z0-9\/-]*$/i.test(text) && /[A-Z0-9]{3,}/i.test(text);
}

function isPossessionStatus(value) {
  return /^(?:under construction|ready to move|completed|new launch|possession given|oc received)$/i.test(cleanText(value));
}

function parseAreaRange(raw) {
  const text = cleanText(raw);
  if (!text) return null;
  const range = text.match(/(\d[\d,.]*)\s*(?:-|to)\s*(\d[\d,.]*)\s*(?:sq\.?\s*ft\.?|sqft|square feet)?/i);
  if (range) return { min: parseNum(range[1]), max: parseNum(range[2]), raw: text };
  const single = text.match(/(\d[\d,.]*)\s*(?:sq\.?\s*ft\.?|sqft|square feet)/i);
  if (single) return { min: parseNum(single[1]), max: parseNum(single[1]), raw: text };
  return { raw: text };
}

function parsePriceToken(value, unit) {
  const n = parseNum(value);
  if (n == null) return null;
  const u = String(unit || '').toLowerCase();
  if (u === 'cr' || u === 'crore') return Math.round(n * 10000000);
  if (u === 'lakh' || u === 'lac') return Math.round(n * 100000);
  return n;
}

function parsePriceRange(raw) {
  const text = cleanText(raw);
  if (!text) return null;
  if (/price\s+on\s+request/i.test(text)) return { raw: 'Price on Request' };
  const tokens = Array.from(text.matchAll(/(?:₹\s*)?(\d[\d,.]*(?:\.\d+)?)\s*(lakh|lac|cr|crore)/gi));
  if (!tokens.length) return { raw: text };
  const values = tokens.map((m) => parsePriceToken(m[1], m[2])).filter((v) => v != null);
  if (!values.length) return { raw: text };
  return { min: Math.min(...values), max: values.length > 1 ? Math.max(...values) : null, raw: text };
}

function hasRangeValue(range) {
  return !!(range && (range.min != null || range.max != null || range.raw));
}

function normalizeRera(value) {
  const text = cleanText(value).replace(/^(rera\s+number|rera\s+no\.?|registration\s+no\.?|real\s+estate\s+regulatory\s+authority|rera)\s*[:-]?\s*/i, '').trim();
  if (!text || /^coming soon\.?$/i.test(text)) return null;
  return text.toUpperCase();
}

function extractKarmaProjectId(row = {}) {
  const explicit = String(row.SourceProjectID || '').trim();
  if (explicit) return explicit;
  return String(row.SourceUrl || '').match(/\/Projects\/ProjectDetail\/(\d+)/i)?.[1] || null;
}

function mergeMediaUrls(existing, incomingUrls, kind, repo, projectId, userId) {
  const existingList = Array.isArray(existing) ? existing : [];
  const seen = new Set(existingList.map((m) => String(m.SourceUrl || m.OriginalUrl || m.Url || '').toLowerCase()).filter(Boolean));
  const out = existingList.slice();
  for (const url of splitList(incomingUrls).slice(0, kind === 'floorplan' ? 8 : 12)) {
    const key = String(url).toLowerCase();
    if (!/^https?:\/\//i.test(url) || seen.has(key)) continue;
    seen.add(key);
    const mediaId = repo.createId('MED');
    out.push({
      MediaID: mediaId,
      Filename: `${kind}-${mediaId}`,
      Url: url,
      SourceUrl: url,
      Source: 'KarmaGroupScrape',
      UploadedAt: new Date().toISOString(),
      UploadedBy: userId || 'system'
    });
  }
  return out;
}

function stableJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => item && typeof item === 'object' ? Object.keys(item).sort().reduce((out, key) => { out[key] = item[key]; return out; }, {}) : item));
  if (value && typeof value === 'object') return JSON.stringify(Object.keys(value).sort().reduce((out, key) => { out[key] = value[key]; return out; }, {}));
  return JSON.stringify(value ?? null);
}

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return stableJson(a || []) === stableJson(b || []);
  if (a && typeof a === 'object' || b && typeof b === 'object') return stableJson(a || null) === stableJson(b || null);
  return cleanText(a) === cleanText(b);
}

function assignIfChanged(target, field, value, changedFields) {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value) && !value.length) return false;
  if (!sameValue(target[field], value)) {
    target[field] = value;
    changedFields.add(field);
    return true;
  }

  return false;
}

function clearIfChanged(target, field, changedFields) {
  if (target[field] === null || target[field] === undefined || target[field] === '') return false;
  target[field] = null;
  changedFields.add(field);
  return true;
}

function normalizeSourceUrlKey(value) {
  const raw = cleanText(value).toLowerCase();
  if (!raw) return null;
  return raw.replace(/[?#].*$/, '').replace(/\/+$/, '');
}

function appendProvenance(current, source) {
  const parts = mergeUnique(String(current || '').split(',').map((s) => s.trim()).filter(Boolean), [source].filter(Boolean));
  return parts.join(',') || current || source || null;
}

function parseNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? null : n;
}

function parseIntSafe(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? null : n;
}

class BuilderProjectService {
  constructor(repository, deps = {}) {
    this.repo = repository;
    this.objectStorage = deps.objectStorage || objectStorage;
    this.downloader = deps.downloader || { downloadMediaSafely };
  }

  _all(db) {
    db.BuilderProjects = db.BuilderProjects || [];
    return db.BuilderProjects;
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────
  list({ q, location, status, category } = {}) {
    const db = this.repo.read();
    let rows = this._all(db).filter((p) => p.Active !== false);
    if (location) rows = rows.filter((p) => String(p.Location1 || '').toLowerCase() === String(location).toLowerCase());
    if (status) rows = rows.filter((p) => p.ProjectStatus === status);
    if (category) rows = rows.filter((p) => p.Category === category);
    if (q) {
      const qq = String(q).toLowerCase();
      rows = rows.filter((p) =>
        String(p.ProjectName || '').toLowerCase().includes(qq) ||
        String(p.BuilderName || '').toLowerCase().includes(qq) ||
        String(p.Location1 || '').toLowerCase().includes(qq));
    }
    rows = rows.slice().sort((a, b) => new Date(b.CreatedAt || 0) - new Date(a.CreatedAt || 0));
    return { ok: true, data: rows, count: rows.length };
  }

  get(id) {
    const db = this.repo.read();
    const row = this._all(db).find((p) => p.ProjectID === id);
    if (!row) return { ok: false, error: 'Project not found' };
    return { ok: true, data: row };
  }

  _normalizePayload(payload = {}) {
    const out = {};
    if (payload.ProjectName !== undefined) out.ProjectName = String(payload.ProjectName || '').trim() || null;
    if (payload.BuilderName !== undefined) out.BuilderName = String(payload.BuilderName || '').trim() || null;
    if (payload.DeveloperName !== undefined) out.DeveloperName = String(payload.DeveloperName || '').trim() || null;
    if (payload.PromoterName !== undefined) out.PromoterName = String(payload.PromoterName || '').trim() || null;
    if (payload.Location1 !== undefined) out.Location1 = String(payload.Location1 || '').trim() || null;
    if (payload.Locality !== undefined) out.Locality = String(payload.Locality || '').trim() || null;
    if (payload.Area !== undefined) out.Area = String(payload.Area || '').trim() || null;
    if (payload.Address !== undefined) out.Address = String(payload.Address || '').trim() || null;
    if (payload.City !== undefined) out.City = String(payload.City || '').trim() || null;
    if (payload.State !== undefined) out.State = String(payload.State || '').trim() || null;
    if (payload.Pincode !== undefined) out.Pincode = String(payload.Pincode || '').trim() || null;
    if (payload.Latitude !== undefined) out.Latitude = parseNum(payload.Latitude);
    if (payload.Longitude !== undefined) out.Longitude = parseNum(payload.Longitude);
    if (payload.MapUrl !== undefined) out.MapUrl = String(payload.MapUrl || '').trim() || null;
    if (payload.RERANumber !== undefined) out.RERANumber = String(payload.RERANumber || '').trim() || null;
    if (payload.ReraUrl !== undefined) out.ReraUrl = String(payload.ReraUrl || '').trim() || null;
    if (payload.ProjectStatus !== undefined) out.ProjectStatus = payload.ProjectStatus || 'Under Construction';
    if (payload.Category !== undefined) out.Category = payload.Category || 'Residential';
    if (payload.PossessionDate !== undefined) out.PossessionDate = payload.PossessionDate || null;
    if (payload.PossessionStatus !== undefined) out.PossessionStatus = payload.PossessionStatus || null;
    if (payload.TotalUnits !== undefined) out.TotalUnits = parseIntSafe(payload.TotalUnits);
    if (payload.TotalTowers !== undefined) out.TotalTowers = parseIntSafe(payload.TotalTowers);
    if (payload.TotalFloors !== undefined) out.TotalFloors = parseIntSafe(payload.TotalFloors);
    if (payload.ProjectArea !== undefined) out.ProjectArea = String(payload.ProjectArea || '').trim() || null;
    if (payload.Notes !== undefined) out.Notes = String(payload.Notes || '').trim() || null;
    if (payload.Overview !== undefined) out.Overview = String(payload.Overview || '').trim() || null;
    if (payload.Description !== undefined) out.Description = String(payload.Description || '').trim() || null;
    if (payload.Configurations !== undefined) {
      out.Configurations = Array.isArray(payload.Configurations)
        ? payload.Configurations.filter(Boolean)
        : String(payload.Configurations || '').split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (payload.Amenities !== undefined) {
      out.Amenities = Array.isArray(payload.Amenities)
        ? payload.Amenities.filter(Boolean)
        : String(payload.Amenities || '').split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (payload.Highlights !== undefined) {
      out.Highlights = Array.isArray(payload.Highlights)
        ? payload.Highlights.filter(Boolean)
        : splitList(payload.Highlights);
    }
    if (payload.Specifications !== undefined) {
      out.Specifications = Array.isArray(payload.Specifications)
        ? payload.Specifications.filter(Boolean)
        : splitList(payload.Specifications);
    }
    if (payload.BrochureUrl !== undefined) out.BrochureUrl = String(payload.BrochureUrl || '').trim() || null;
    if (payload.SourceUrl !== undefined) out.SourceUrl = String(payload.SourceUrl || '').trim() || null;
    if (payload.SourceProjectID !== undefined) out.SourceProjectID = String(payload.SourceProjectID || '').trim() || null;
    if (payload.AreaRange !== undefined) {
      out.AreaRange = payload.AreaRange || null;
    } else if (payload.CarpetAreaMin !== undefined || payload.CarpetAreaMax !== undefined) {
      out.AreaRange = { min: parseNum(payload.CarpetAreaMin), max: parseNum(payload.CarpetAreaMax) };
    }
    if (payload.CarpetAreaRange !== undefined) out.CarpetAreaRange = payload.CarpetAreaRange || null;
    if (payload.BuiltUpAreaRange !== undefined) out.BuiltUpAreaRange = payload.BuiltUpAreaRange || null;
    if (payload.SaleableAreaRange !== undefined) out.SaleableAreaRange = payload.SaleableAreaRange || null;
    if (payload.PriceRange !== undefined) {
      out.PriceRange = payload.PriceRange || null;
    } else if (payload.PriceMin !== undefined || payload.PriceMax !== undefined) {
      out.PriceRange = { min: parseNum(payload.PriceMin), max: parseNum(payload.PriceMax) };
    }
    if (payload.StartingPrice !== undefined) out.StartingPrice = parseNum(payload.StartingPrice);
    if (payload.PricePerSqft !== undefined) out.PricePerSqft = parseNum(payload.PricePerSqft);
    if (payload.Photos !== undefined) out.Photos = Array.isArray(payload.Photos) ? payload.Photos : [];
    if (payload.FloorPlans !== undefined) out.FloorPlans = Array.isArray(payload.FloorPlans) ? payload.FloorPlans : [];
    if (payload.SitePlans !== undefined) out.SitePlans = Array.isArray(payload.SitePlans) ? payload.SitePlans : [];
    if (payload.ConfigDetails !== undefined) {
      out.ConfigDetails = Array.isArray(payload.ConfigDetails)
        ? payload.ConfigDetails.filter((c) => c && String(c.Type || '').trim())
          .map((c) => ({ Type: String(c.Type).trim(), AreaSqft: c.AreaSqft != null && c.AreaSqft !== '' ? parseNum(c.AreaSqft) : null }))
        : [];
      out.Configurations = out.ConfigDetails.map((c) => c.Type);
      const areas = out.ConfigDetails.map((c) => c.AreaSqft).filter((a) => a != null);
      out.AreaRange = areas.length ? { min: Math.min(...areas), max: Math.max(...areas) } : null;
    }
    return out;
  }

  create(payload, userId = 'system') {
    const clean = this._normalizePayload(payload);
    if (!clean.ProjectName) return { ok: false, error: 'ProjectName is required' };
    if (!clean.BuilderName) return { ok: false, error: 'BuilderName is required' };
    if (!clean.Location1) return { ok: false, error: 'Location1 is required' };
    const db = this.repo.read();
    const now = new Date().toISOString();
    const row = {
      ProjectID: this.repo.createId('BLDP'),
      ProjectName: clean.ProjectName,
      BuilderName: clean.BuilderName,
      DeveloperName: clean.DeveloperName || clean.BuilderName || null,
      PromoterName: clean.PromoterName || clean.BuilderName || null,
      Location1: clean.Location1,
      Locality: clean.Locality || clean.Location1 || null,
      Area: clean.Area || clean.Locality || clean.Location1 || null,
      Address: clean.Address || null,
      City: clean.City || null,
      State: clean.State || null,
      Pincode: clean.Pincode || null,
      Latitude: clean.Latitude ?? null,
      Longitude: clean.Longitude ?? null,
      MapUrl: clean.MapUrl || null,
      RERANumber: clean.RERANumber || null,
      ReraUrl: clean.ReraUrl || null,
      ProjectStatus: clean.ProjectStatus || 'Under Construction',
      PossessionStatus: clean.PossessionStatus || null,
      Category: clean.Category || 'Residential',
      Configurations: clean.Configurations || [],
      ConfigDetails: clean.ConfigDetails || [],
      TotalUnits: clean.TotalUnits ?? null,
      TotalTowers: clean.TotalTowers ?? null,
      TotalFloors: clean.TotalFloors ?? null,
      ProjectArea: clean.ProjectArea || null,
      AreaRange: clean.AreaRange || null,
      CarpetAreaRange: clean.CarpetAreaRange || null,
      BuiltUpAreaRange: clean.BuiltUpAreaRange || null,
      SaleableAreaRange: clean.SaleableAreaRange || null,
      PriceRange: clean.PriceRange || null,
      StartingPrice: clean.StartingPrice ?? null,
      PricePerSqft: clean.PricePerSqft ?? null,
      PossessionDate: clean.PossessionDate || null,
      Amenities: clean.Amenities || [],
      Highlights: clean.Highlights || [],
      Specifications: clean.Specifications || [],
      Overview: clean.Overview || null,
      Description: clean.Description || null,
      BrochureUrl: clean.BrochureUrl || null,
      SourceUrl: clean.SourceUrl || null,
      SourceProjectID: clean.SourceProjectID || null,
      Photos: clean.Photos || [],
      FloorPlans: clean.FloorPlans || [],
      SitePlans: clean.SitePlans || [],
      Notes: clean.Notes || null,
      ImportedFrom: 'ManualEntry',
      Active: true,
      CreatedAt: now,
      UpdatedAt: now,
      CreatedBy: userId
    };
    this._all(db).push(row);
    this.repo.write(db);
    return { ok: true, data: row };
  }

  update(id, payload) {
    const db = this.repo.read();
    const row = this._all(db).find((p) => p.ProjectID === id);
    if (!row) return { ok: false, error: 'Project not found' };
    const clean = this._normalizePayload(payload);
    Object.assign(row, clean, { UpdatedAt: new Date().toISOString() });
    this.repo.write(db);
    return { ok: true, data: row };
  }

  remove(id) {
    const db = this.repo.read();
    const row = this._all(db).find((p) => p.ProjectID === id);
    if (!row) return { ok: false, error: 'Project not found' };
    row.Active = false;
    row.UpdatedAt = new Date().toISOString();
    this.repo.write(db);
    return { ok: true, data: { ProjectID: id, Active: false } };
  }

  // ── Bulk import (CSV/Excel) ─────────────────────────────────────────────
  async parseBuffer(fileBuffer, filename = '') {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.xls')) {
      throw new Error('Legacy .xls files are not supported. Please upload .xlsx or .csv.');
    }
    if (lower.endsWith('.xlsx')) {
      const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);
      const sheetRows = await readXlsxFile(buffer);
      if (!sheetRows.length) return [];
      const rows = [];
      const [headerRow, ...dataRows] = sheetRows;
      const headers = headerRow.map((value) => String(value == null ? '' : value).trim());
      for (const values of dataRows) {
        const record = {};
        headers.forEach((header, index) => {
          if (!header) return;
          const value = values[index];
          record[header] = value == null ? '' : value;
        });
        rows.push(record);
      }
      return rows;
    }
    const text = Buffer.isBuffer(fileBuffer) ? fileBuffer.toString('utf8') : String(fileBuffer);
    return csvParse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true, relax_quotes: true, bom: true });
  }

  _buildPreviewData(rows) {
    if (!rows.length) return null;
    const detected = this.detectColumnMap(rows[0]);
    const canonicalsFound = new Set(Object.values(detected));
    const missingRequired = ['ProjectName', 'BuilderName'].filter((r) => !canonicalsFound.has(r));
    const mapped = rows.map((r) => this.applyMap(r, detected));
    const agg = this.aggregate(mapped);
    return {
      totalRows: rows.length,
      detectedColumns: Object.keys(rows[0]),
      columnMap: detected,
      missingRequired,
      summary: { projects: agg.projects.length, missingName: agg.missingName.length },
      samples: { projects: agg.projects.slice(0, 30), missingName: agg.missingName.slice(0, 10) }
    };
  }

  // ── Builder name cleanup ─────────────────────────────────────────────────
  _normalizeBuilderKey(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/\b(group|builders?|developers?|infra(structure)?|realty|construction|constructions|pvt\.?|ltd\.?|llp|the)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  findDuplicateBuilderGroups() {
    const db = this.repo.read();
    const rows = this._all(db).filter((p) => p.Active !== false);
    const byKey = new Map();
    for (const p of rows) {
      const name = p.BuilderName || 'Unknown Builder';
      const key = this._normalizeBuilderKey(name) || name.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, new Map());
      const variants = byKey.get(key);
      variants.set(name, (variants.get(name) || 0) + 1);
    }
    const groups = [];
    for (const [key, variants] of byKey.entries()) {
      if (variants.size < 2) continue;
      const variantList = Array.from(variants.entries()).map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
      groups.push({ key, suggestedCanonical: variantList[0].name, variants: variantList });
    }
    groups.sort((a, b) => b.variants.reduce((s, v) => s + v.count, 0) - a.variants.reduce((s, v) => s + v.count, 0));
    return { ok: true, data: groups, count: groups.length };
  }

  mergeBuilderNames(canonicalName, variants) {
    if (!canonicalName || !Array.isArray(variants) || !variants.length) {
      return { ok: false, error: 'canonicalName and variants[] are required' };
    }
    const db = this.repo.read();
    const rows = this._all(db);
    let updated = 0;
    for (const p of rows) {
      if (variants.includes(p.BuilderName) && p.BuilderName !== canonicalName) {
        p.BuilderName = canonicalName;
        p.UpdatedAt = new Date().toISOString();
        updated += 1;
      }
    }
    this.repo.write(db);
    return { ok: true, data: { canonicalName, updated } };
  }

  detectColumnMap(sampleRow) {
    const headers = Object.keys(sampleRow || {});
    const map = {};
    for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
      const aliasSet = new Set(aliases.map((a) => a.toLowerCase().replace(/[\s_]/g, '')));
      const hit = headers.find((h) => aliasSet.has(String(h || '').toLowerCase().replace(/[\s_]/g, '')));
      if (hit) map[hit] = canonical;
    }
    return map;
  }

  applyMap(row, columnMap) {
    const out = {};
    for (const [source, canonical] of Object.entries(columnMap)) out[canonical] = row[source];
    return out;
  }

  _groupKey(r) {
    if (r.RERANumber) return 'rera:' + normalizeRera(r.RERANumber);
    const karmaProjectId = extractKarmaProjectId(r);
    if (karmaProjectId) return 'karma:' + String(karmaProjectId).trim().toLowerCase();
    const sourceUrl = normalizeSourceUrlKey(r.SourceUrl);
    if (sourceUrl) return 'sourceurl:' + sourceUrl;
    return 'name:' + [r.ProjectName, r.BuilderName, r.Location1].map(normalizeKeyPart).join('|');
  }

  _keysForProject(r) {
    const keys = new Set();
    if (r.RERANumber) keys.add('rera:' + normalizeRera(r.RERANumber));
    const karmaProjectId = extractKarmaProjectId(r);
    if (karmaProjectId) keys.add('karma:' + String(karmaProjectId).trim().toLowerCase());
    const sourceUrl = normalizeSourceUrlKey(r.SourceUrl);
    if (sourceUrl) keys.add('sourceurl:' + sourceUrl);
    keys.add('name:' + [r.ProjectName, r.BuilderName, r.Location1].map(normalizeKeyPart).join('|'));
    return Array.from(keys).filter((key) => !key.endsWith('||'));
  }

  aggregate(mappedRows) {
    const grouped = new Map();
    const missingName = [];
    for (const r of mappedRows) {
      const projectName = String(r.ProjectName || '').trim();
      if (!projectName) { missingName.push({ row: r, reason: 'Missing ProjectName' }); continue; }
      const key = this._groupKey(r);
      if (!grouped.has(key)) {
        grouped.set(key, {
          ProjectName: projectName,
          BuilderName: String(r.BuilderName || '').trim() || null,
          DeveloperName: String(r.DeveloperName || r.BuilderName || '').trim() || null,
          PromoterName: String(r.PromoterName || r.BuilderName || '').trim() || null,
          Location1: String(r.Location1 || '').trim() || null,
          Locality: String(r.Locality || '').trim() || null,
          Area: String(r.Area || '').trim() || null,
          Address: String(r.Address || '').trim() || null,
          City: String(r.City || '').trim() || null,
          State: String(r.State || '').trim() || null,
          Pincode: String(r.Pincode || '').trim() || null,
          Latitude: parseNum(r.Latitude),
          Longitude: parseNum(r.Longitude),
          MapUrl: String(r.MapUrl || '').trim() || null,
          RERANumber: normalizeRera(r.RERANumber),
          ReraUrl: String(r.ReraUrl || '').trim() || null,
          ProjectStatus: String(r.ProjectStatus || '').trim() ? normalizeStatus(r.ProjectStatus) : null,
          PossessionStatus: String(r.PossessionStatus || '').trim() || null,
          Category: String(r.Category || '').trim() || null,
          Configurations: new Set(),
          TotalUnits: 0,
          TotalTowers: parseIntSafe(r.TotalTowers),
          TotalFloors: parseIntSafe(r.TotalFloors),
          ProjectArea: String(r.ProjectArea || '').trim() || null,
          _AreaMin: null,
          _AreaMax: null,
          _AreaRaw: null,
          CarpetAreaRange: String(r.CarpetAreaRange || '').trim() || null,
          BuiltUpAreaRange: String(r.BuiltUpAreaRange || '').trim() || null,
          SaleableAreaRange: String(r.SaleableAreaRange || '').trim() || null,
          PriceRange: { min: parseNum(r.PriceMin), max: parseNum(r.PriceMax) },
          StartingPrice: parseNum(r.StartingPrice ?? r.PriceMin),
          PricePerSqft: parseNum(r.PricePerSqft),
          PossessionDate: r.PossessionDate ? String(r.PossessionDate).trim() : null,
          Amenities: splitList(r.Amenities),
          Highlights: splitList(r.Highlights),
          Specifications: splitList(r.Specifications),
          Overview: String(r.Overview || '').trim() || null,
          Description: String(r.Description || r.Notes || '').trim() || null,
          BrochureUrl: String(r.BrochureUrl || '').trim() || null,
          SourceUrl: String(r.SourceUrl || '').trim() || null,
          SourceProjectID: String(r.SourceProjectID || '').trim() || extractKarmaProjectId(r),
          Notes: String(r.Notes || '').trim() || null,
          PhotoUrls: splitList(r.PhotoUrls),
          FloorPlanUrls: splitList(r.FloorPlanUrls),
          SitePlanUrls: splitList(r.SitePlanUrls)
        });
      }
      const g = grouped.get(key);
      for (const cfg of splitList(r.UnitType)) {
        const cfgLabel = normalizeConfig(cfg);
        if (cfgLabel) g.Configurations.add(cfgLabel);
      }
      const units = parseIntSafe(r.UnitCount);
      if (units) g.TotalUnits += units;
      const parsedArea = parseAreaRange(r.AreaRange);
      if (parsedArea?.raw && (!g._AreaRaw || (parsedArea.min != null && parsedArea.max != null && parsedArea.min !== parsedArea.max))) g._AreaRaw = parsedArea.raw;
      if (parsedArea?.min != null || parsedArea?.max != null) {
        if (parsedArea.min != null && (g._AreaMin == null || parsedArea.min < g._AreaMin)) g._AreaMin = Math.round(parsedArea.min);
        if (parsedArea.max != null && (g._AreaMax == null || parsedArea.max > g._AreaMax)) g._AreaMax = Math.round(parsedArea.max);
      }
      const carpet = parseNum(r.CarpetAreaSqft);
      if (carpet) {
        if (g._AreaMin == null || carpet < g._AreaMin) g._AreaMin = Math.round(carpet);
        if (g._AreaMax == null || carpet > g._AreaMax) g._AreaMax = Math.round(carpet);
      }
      const parsedPrice = parsePriceRange(r.PriceText);
      if (parsedPrice && (parsedPrice.min != null || parsedPrice.max != null || !hasRangeValue(g.PriceRange))) g.PriceRange = parsedPrice;
      g.Amenities = mergeUnique(g.Amenities, splitList(r.Amenities));
      g.Highlights = mergeUnique(g.Highlights, splitList(r.Highlights));
      g.Specifications = mergeUnique(g.Specifications, splitList(r.Specifications));
      g.PhotoUrls = mergeUnique(g.PhotoUrls, splitList(r.PhotoUrls));
      g.FloorPlanUrls = mergeUnique(g.FloorPlanUrls, splitList(r.FloorPlanUrls));
      g.SitePlanUrls = mergeUnique(g.SitePlanUrls, splitList(r.SitePlanUrls));
      if (!g.DeveloperName && r.DeveloperName) g.DeveloperName = String(r.DeveloperName).trim();
      if (!g.PromoterName && r.PromoterName) g.PromoterName = String(r.PromoterName).trim();
      if (!g.Locality && r.Locality) g.Locality = String(r.Locality).trim();
      if (!g.Area && r.Area) g.Area = String(r.Area).trim();
      if (!g.City && r.City) g.City = String(r.City).trim();
      if (!g.State && r.State) g.State = String(r.State).trim();
      if (!g.Pincode && r.Pincode) g.Pincode = String(r.Pincode).trim();
      if (g.Latitude == null && parseNum(r.Latitude) != null) g.Latitude = parseNum(r.Latitude);
      if (g.Longitude == null && parseNum(r.Longitude) != null) g.Longitude = parseNum(r.Longitude);
      if (!g.MapUrl && r.MapUrl) g.MapUrl = String(r.MapUrl).trim();
      if (!g.ReraUrl && r.ReraUrl) g.ReraUrl = String(r.ReraUrl).trim();
      if (!g.PossessionStatus && r.PossessionStatus) g.PossessionStatus = String(r.PossessionStatus).trim();
      if (!g.ProjectArea && r.ProjectArea) g.ProjectArea = String(r.ProjectArea).trim();
      if (!g.CarpetAreaRange && r.CarpetAreaRange) g.CarpetAreaRange = String(r.CarpetAreaRange).trim();
      if (!g.BuiltUpAreaRange && r.BuiltUpAreaRange) g.BuiltUpAreaRange = String(r.BuiltUpAreaRange).trim();
      if (!g.SaleableAreaRange && r.SaleableAreaRange) g.SaleableAreaRange = String(r.SaleableAreaRange).trim();
      if (g.StartingPrice == null && parseNum(r.StartingPrice ?? r.PriceMin) != null) g.StartingPrice = parseNum(r.StartingPrice ?? r.PriceMin);
      if (g.PricePerSqft == null && parseNum(r.PricePerSqft) != null) g.PricePerSqft = parseNum(r.PricePerSqft);
      if (g.TotalTowers == null && parseIntSafe(r.TotalTowers) != null) g.TotalTowers = parseIntSafe(r.TotalTowers);
      if (g.TotalFloors == null && parseIntSafe(r.TotalFloors) != null) g.TotalFloors = parseIntSafe(r.TotalFloors);
      if (!g.Overview && r.Overview) g.Overview = String(r.Overview).trim();
      if (!g.Description && (r.Description || r.Notes)) g.Description = String(r.Description || r.Notes).trim();
      if (!g.Notes && r.Notes) g.Notes = String(r.Notes).trim();
    }
    const projects = Array.from(grouped.values()).map((g) => {
      const out = { ...g, Configurations: Array.from(g.Configurations).sort() };
      out.AreaRange = (g._AreaMin != null || g._AreaMax != null) ? { min: g._AreaMin, max: g._AreaMax, raw: g._AreaRaw || undefined } : (g._AreaRaw ? { raw: g._AreaRaw } : null);
      delete out._AreaMin; delete out._AreaMax;
      delete out._AreaRaw;
      return out;
    });
    return { projects, missingName };
  }

  async preview(fileBuffer, filename) {
    let rows;
    try { rows = await this.parseBuffer(fileBuffer, filename); }
    catch (e) { return { ok: false, error: `Parse failed: ${e.message}` }; }
    if (!rows.length) return { ok: false, error: 'Empty file' };

    return {
      ok: true,
      data: this._buildPreviewData(rows)
    };
  }

  async commit(fileBuffer, filename, options = {}) {
    let rows;
    try { rows = await this.parseBuffer(fileBuffer, filename); }
    catch (e) { return { ok: false, error: `Parse failed: ${e.message}` }; }
    if (!rows.length) return { ok: false, error: 'Empty file' };
    const previewData = this._buildPreviewData(rows);
    const mapped = rows.map((r) => this.applyMap(r, previewData.columnMap));
    const { projects } = this.aggregate(mapped);

    const db = this.repo.read();
    this._all(db);
    const byKey = new Map();
    for (const p of db.BuilderProjects) {
      for (const key of this._keysForProject(p)) byKey.set(key, p);
    }

    const now = new Date().toISOString();
    let inserted = 0, updated = 0;
    const insertedIds = [], updatedIds = [];

    for (const agg of projects) {
      const keys = this._keysForProject(agg);
      const existing = keys.map((key) => byKey.get(key)).find(Boolean);
      if (existing) {
        const changedFields = new Set();
        assignIfChanged(existing, 'ProjectStatus', agg.ProjectStatus, changedFields);
        assignIfChanged(existing, 'Category', agg.Category, changedFields);
        assignIfChanged(existing, 'BuilderName', agg.BuilderName, changedFields);
        assignIfChanged(existing, 'DeveloperName', agg.DeveloperName, changedFields);
        assignIfChanged(existing, 'PromoterName', agg.PromoterName, changedFields);
        assignIfChanged(existing, 'Location1', agg.Location1, changedFields);
        assignIfChanged(existing, 'Locality', agg.Locality, changedFields);
        assignIfChanged(existing, 'Area', agg.Area, changedFields);
        const qualityAddress = validateAddressQuality(existing.Address, agg.Address);
        assignIfChanged(existing, 'Address', qualityAddress, changedFields);
        assignIfChanged(existing, 'City', agg.City, changedFields);
        assignIfChanged(existing, 'State', agg.State, changedFields);
        assignIfChanged(existing, 'Pincode', agg.Pincode, changedFields);
        assignIfChanged(existing, 'Latitude', agg.Latitude, changedFields);
        assignIfChanged(existing, 'Longitude', agg.Longitude, changedFields);
        assignIfChanged(existing, 'MapUrl', agg.MapUrl, changedFields);
        if (agg.RERANumber) {
          if (isValidImportedRera(agg.RERANumber)) assignIfChanged(existing, 'RERANumber', agg.RERANumber, changedFields);
          else clearIfChanged(existing, 'RERANumber', changedFields);
        } else if (existing.RERANumber && !isValidImportedRera(existing.RERANumber)) {
          clearIfChanged(existing, 'RERANumber', changedFields);
        }
        assignIfChanged(existing, 'ReraUrl', agg.ReraUrl, changedFields);
        assignIfChanged(existing, 'TotalUnits', agg.TotalUnits || null, changedFields);
        assignIfChanged(existing, 'TotalTowers', agg.TotalTowers || null, changedFields);
        assignIfChanged(existing, 'TotalFloors', agg.TotalFloors || null, changedFields);
        assignIfChanged(existing, 'ProjectArea', agg.ProjectArea || null, changedFields);
        assignIfChanged(existing, 'AreaRange', hasRangeValue(agg.AreaRange) ? agg.AreaRange : null, changedFields);
        assignIfChanged(existing, 'CarpetAreaRange', agg.CarpetAreaRange || null, changedFields);
        assignIfChanged(existing, 'BuiltUpAreaRange', agg.BuiltUpAreaRange || null, changedFields);
        assignIfChanged(existing, 'SaleableAreaRange', agg.SaleableAreaRange || null, changedFields);
        assignIfChanged(existing, 'PriceRange', hasRangeValue(agg.PriceRange) ? agg.PriceRange : null, changedFields);
        assignIfChanged(existing, 'StartingPrice', agg.StartingPrice ?? null, changedFields);
        assignIfChanged(existing, 'PricePerSqft', agg.PricePerSqft ?? null, changedFields);
        if (agg.PossessionDate) {
          if (isPossessionStatus(agg.PossessionDate)) clearIfChanged(existing, 'PossessionDate', changedFields);
          else assignIfChanged(existing, 'PossessionDate', agg.PossessionDate, changedFields);
        } else if (isPossessionStatus(existing.PossessionDate)) {
          clearIfChanged(existing, 'PossessionDate', changedFields);
        }
        assignIfChanged(existing, 'PossessionStatus', agg.PossessionStatus || null, changedFields);
        assignIfChanged(existing, 'BrochureUrl', agg.BrochureUrl, changedFields);
        assignIfChanged(existing, 'SourceUrl', agg.SourceUrl, changedFields);
        assignIfChanged(existing, 'SourceProjectID', agg.SourceProjectID, changedFields);
        assignIfChanged(existing, 'Overview', agg.Overview, changedFields);
        assignIfChanged(existing, 'Description', agg.Description, changedFields);
        assignIfChanged(existing, 'Notes', agg.Notes, changedFields);

        const mergedConfigs = mergeUnique(existing.Configurations || [], agg.Configurations || [], (v) => normalizeConfig(v));
        assignIfChanged(existing, 'Configurations', mergedConfigs, changedFields);
        const mergedAmenities = mergeUnique(existing.Amenities || [], agg.Amenities || []);
        assignIfChanged(existing, 'Amenities', mergedAmenities, changedFields);
        const mergedHighlights = mergeUnique(existing.Highlights || [], agg.Highlights || []);
        assignIfChanged(existing, 'Highlights', mergedHighlights, changedFields);
        const mergedSpecifications = mergeUnique(existing.Specifications || [], agg.Specifications || []);
        assignIfChanged(existing, 'Specifications', mergedSpecifications, changedFields);
        const mergedPhotos = mergeMediaUrls(existing.Photos || [], agg.PhotoUrls, 'photo', this.repo, existing.ProjectID, options.userId || 'system');
        assignIfChanged(existing, 'Photos', mergedPhotos, changedFields);
        const mergedFloorPlans = mergeMediaUrls(existing.FloorPlans || [], agg.FloorPlanUrls, 'floorplan', this.repo, existing.ProjectID, options.userId || 'system');
        assignIfChanged(existing, 'FloorPlans', mergedFloorPlans, changedFields);
        const mergedSitePlans = mergeMediaUrls(existing.SitePlans || [], agg.SitePlanUrls, 'siteplan', this.repo, existing.ProjectID, options.userId || 'system');
        assignIfChanged(existing, 'SitePlans', mergedSitePlans, changedFields);

        const provenance = appendProvenance(existing.ImportedFrom, options.importedFrom || filename);
        assignIfChanged(existing, 'ImportedFrom', provenance, changedFields);
        existing.LastImportChangedFields = Array.from(changedFields).sort();
        if (changedFields.size) existing.UpdatedAt = now;
        updated += 1;
        updatedIds.push(existing.ProjectID);
        for (const key of this._keysForProject(existing)) byKey.set(key, existing);
      } else {
        const projectId = this.repo.createId('BLDP');
        const row = {
          ProjectID: projectId,
          ProjectName: agg.ProjectName,
          BuilderName: agg.BuilderName,
          DeveloperName: agg.DeveloperName || agg.BuilderName,
          PromoterName: agg.PromoterName || agg.BuilderName,
          Location1: agg.Location1,
          Locality: agg.Locality || agg.Location1,
          Area: agg.Area || agg.Locality || agg.Location1,
          Address: agg.Address,
          City: agg.City,
          State: agg.State,
          Pincode: agg.Pincode,
          Latitude: agg.Latitude ?? null,
          Longitude: agg.Longitude ?? null,
          MapUrl: agg.MapUrl || null,
          RERANumber: agg.RERANumber,
          ReraUrl: agg.ReraUrl || null,
          ProjectStatus: agg.ProjectStatus || 'Under Construction',
          PossessionStatus: agg.PossessionStatus || null,
          Category: agg.Category || 'Residential',
          Configurations: agg.Configurations,
          TotalUnits: agg.TotalUnits || null,
          TotalTowers: agg.TotalTowers || null,
          TotalFloors: agg.TotalFloors || null,
          ProjectArea: agg.ProjectArea || null,
          AreaRange: agg.AreaRange,
          CarpetAreaRange: agg.CarpetAreaRange || null,
          BuiltUpAreaRange: agg.BuiltUpAreaRange || null,
          SaleableAreaRange: agg.SaleableAreaRange || null,
          PriceRange: (agg.PriceRange && (agg.PriceRange.min != null || agg.PriceRange.max != null)) ? agg.PriceRange : null,
          StartingPrice: agg.StartingPrice ?? null,
          PricePerSqft: agg.PricePerSqft ?? null,
          PossessionDate: agg.PossessionDate,
          Amenities: agg.Amenities,
          Highlights: agg.Highlights || [],
          Specifications: agg.Specifications || [],
          Overview: agg.Overview || null,
          Description: agg.Description || null,
          BrochureUrl: agg.BrochureUrl || null,
          SourceUrl: agg.SourceUrl || null,
          SourceProjectID: agg.SourceProjectID || null,
          Photos: mergeMediaUrls([], agg.PhotoUrls, 'photo', this.repo, projectId, options.userId || 'system'),
          FloorPlans: mergeMediaUrls([], agg.FloorPlanUrls, 'floorplan', this.repo, projectId, options.userId || 'system'),
          SitePlans: mergeMediaUrls([], agg.SitePlanUrls, 'siteplan', this.repo, projectId, options.userId || 'system'),
          Brochures: [],
          Notes: agg.Notes || null,
          ImportedFrom: options.importedFrom || filename,
          LastImportChangedFields: [],
          Active: true,
          CreatedAt: now,
          UpdatedAt: now,
          CreatedBy: options.userId || 'system'
        };
        db.BuilderProjects.push(row);
        for (const key of this._keysForProject(row)) byKey.set(key, row);
        inserted += 1;
        insertedIds.push(row.ProjectID);
      }
    }

    db._BuilderProjectImports = db._BuilderProjectImports || [];
    const importRecord = {
      ImportID: this.repo.createId('BPIMP'),
      Filename: filename,
      RunAt: now,
      RunBy: options.userId || 'system',
      Inserted: inserted,
      Updated: updated,
      MissingName: previewData.summary.missingName,
      InsertedProjectIDs: insertedIds,
      UpdatedProjectIDs: updatedIds,
      ChangedFields: updatedIds.reduce((acc, id) => {
        const row = db.BuilderProjects.find((p) => p.ProjectID === id);
        acc[id] = row?.LastImportChangedFields || [];
        return acc;
      }, {})
    };
    db._BuilderProjectImports.unshift(importRecord);
    if (db._BuilderProjectImports.length > 100) db._BuilderProjectImports = db._BuilderProjectImports.slice(0, 100);

    this.repo.write(db);
    return { ok: true, data: importRecord };
  }

  listHistory(limit = 20) {
    const db = this.repo.read();
    const rows = (db._BuilderProjectImports || []).slice(0, limit);
    return { ok: true, data: rows, count: rows.length };
  }

  // ── Media (Photos / Videos / Brochures) ─────────────────────────────────
  async addMedia(id, kind, filename, fileBase64, userId = 'system') {
    const field = MEDIA_FIELD[kind];
    if (!field) return { ok: false, error: 'kind must be photo, video or brochure' };
    if (!fileBase64) return { ok: false, error: 'fileBase64 required' };
    const db = this.repo.read();
    const row = this._all(db).find((p) => p.ProjectID === id);
    if (!row) return { ok: false, error: 'Project not found' };

    let buffer;
    try { buffer = Buffer.from(String(fileBase64).replace(/^data:[^;]+;base64,/, ''), 'base64'); }
    catch (e) { return { ok: false, error: 'Bad base64 payload' }; }

    const ext = String(filename || '').split('.').pop().toLowerCase() || 'bin';
    const contentType = MEDIA_MIME_MAP[ext] || 'application/octet-stream';
    const mediaId = this.repo.createId('MED');
    const storagePath = `builder-projects/${id}/${field.toLowerCase()}/${mediaId}.${ext}`;

    let result;
    try { result = await objectStorage.putObject(storagePath, buffer, contentType); }
    catch (e) { return { ok: false, error: `Upload failed: ${e.message}` }; }

    row[field] = Array.isArray(row[field]) ? row[field] : [];
    const item = {
      MediaID: mediaId,
      Filename: String(filename || '').trim() || `${mediaId}.${ext}`,
      StoragePath: result.path,
      Url: `/api/v2/builder-projects/media/${mediaId}`,
      UploadedAt: new Date().toISOString(),
      UploadedBy: userId
    };
    row[field].push(item);
    row.UpdatedAt = new Date().toISOString();
    this.repo.write(db);
    return { ok: true, data: row };
  }

  /**
   * Import one manually supplied, legitimate public URL. This intentionally
   * does not retry 403s or attempt to evade access controls; the hardened
   * downloader rejects blocked/private targets and validates file signatures.
   */
  async importMediaFromUrl(id, kind, sourceUrl, userId = 'system') {
    const normalizedKind = String(kind || '').trim().toLowerCase();
    const config = URL_IMPORT_LIMITS[normalizedKind];
    if (!config) return { ok: false, error: 'kind must be photo or brochure' };

    const originalUrl = String(sourceUrl || '').trim();
    if (!/^https?:\/\//i.test(originalUrl)) {
      return { ok: false, error: 'sourceUrl must be an http(s) URL' };
    }

    const db = this.repo.read();
    const row = this._all(db).find((p) => p.ProjectID === id);
    if (!row) return { ok: false, error: 'Project not found' };

    const downloaded = await this.downloader.downloadMediaSafely(originalUrl, {
      kind: config.kind,
      timeoutMs: 20000,
      maxBytes: config.maxBytes
    });
    if (!downloaded.ok) {
      return { ok: false, error: `URL import failed: ${downloaded.error}` };
    }

    const mediaId = this.repo.createId('MED');
    const filename = filenameFromUrl(originalUrl, config.kind, mediaId);
    const storagePath = `builder-projects/${id}/${config.field.toLowerCase()}/${mediaId}-${filename}`;
    const checksum = checksumOf(downloaded.buffer);

    let stored;
    try {
      stored = await this.objectStorage.putObject(storagePath, downloaded.buffer, downloaded.contentType, filename, {
        metadata: {
          projectId: id,
          mediaType: normalizedKind === 'brochure' ? 'brochure' : 'project_image',
          source: 'manual-url',
          originalUrl,
          checksum,
          mimeType: downloaded.contentType,
          fileName: filename
        }
      });

      const info = await this.objectStorage.getObjectInfo(storagePath);
      const readBack = await this.objectStorage.getObject(storagePath);
      if (!info || Number(info.size) !== downloaded.buffer.length ||
          !readBack?.buffer || checksumOf(readBack.buffer) !== checksum) {
        throw new Error('GridFS verification failed');
      }
    } catch (error) {
      if (typeof this.objectStorage.deleteObject === 'function') {
        try { await this.objectStorage.deleteObject(storagePath); } catch (_) {}
      }
      return { ok: false, error: `URL import storage failed: ${error.message}` };
    }

    const now = new Date().toISOString();
    row[config.field] = Array.isArray(row[config.field]) ? row[config.field] : [];
    const item = {
      MediaID: mediaId,
      Filename: filename,
      fileName: filename,
      StoragePath: stored.path,
      Url: `/api/v2/builder-projects/media/${encodeURIComponent(mediaId)}`,
      OriginalUrl: originalUrl,
      originalUrl,
      SourceUrl: originalUrl,
      Source: 'ManualUrlImport',
      source: 'manual-url',
      UploadedAt: now,
      UploadedBy: userId,
      uploadedAt: now,
      mimeType: downloaded.contentType,
      sizeBytes: downloaded.buffer.length,
      Size: downloaded.buffer.length,
      fileId: stored.fileId == null ? null : String(stored.fileId),
      checksum,
      storageType: 'gridfs',
      storageBucket: STORAGE_BUCKET,
      stored: true,
      verified: true,
      downloadStatus: 'downloaded',
      lastAttemptAt: now,
      error: null
    };
    row[config.field].push(item);
    row.UpdatedAt = now;
    try {
      this.repo.write(db);
    } catch (error) {
      if (typeof this.objectStorage.deleteObject === 'function') {
        try { await this.objectStorage.deleteObject(storagePath); } catch (_) {}
      }
      return { ok: false, error: `Project update failed: ${error.message}` };
    }

    return { ok: true, data: row, imported: item };
  }

  removeMedia(id, mediaId) {
    const db = this.repo.read();
    const row = this._all(db).find((p) => p.ProjectID === id);
    if (!row) return { ok: false, error: 'Project not found' };
    for (const field of Object.values(MEDIA_FIELD)) {
      if (Array.isArray(row[field])) {
        const before = row[field].length;
        row[field] = row[field].filter((m) => m.MediaID !== mediaId);
        if (row[field].length !== before) {
          row.UpdatedAt = new Date().toISOString();
          this.repo.write(db);
          return { ok: true, data: row };
        }
      }
    }
    return { ok: false, error: 'Media not found' };
  }

  getMediaStoragePath(mediaId) {
    const db = this.repo.read();
    for (const p of this._all(db)) {
      for (const field of [...Object.values(MEDIA_FIELD), 'FloorPlans', 'SitePlans']) {
        const item = (p[field] || []).find((m) => m.MediaID === mediaId);
        if (item) return { ok: true, data: item };
      }
    }
    return { ok: false, error: 'Media not found' };
  }

  async getMediaFile(mediaId) {
    const found = this.getMediaStoragePath(mediaId);
    if (!found.ok) return found;
    try {
      const { buffer, contentType } = await objectStorage.getObject(found.data.StoragePath);
      return { ok: true, buffer, contentType: found.data.Filename?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : contentType };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Bulk-assign builder (fix "Unknown Builder") ─────────────────────────
  listUnknownBuilders() {
    const db = this.repo.read();
    const rows = this._all(db).filter((p) => p.Active !== false &&
      (!p.BuilderName || !p.BuilderName.trim() || p.BuilderName.trim() === 'Unknown Builder'));
    return { ok: true, data: rows, count: rows.length };
  }

  bulkAssignBuilder(projectIds, builderName) {
    if (!Array.isArray(projectIds) || !projectIds.length) return { ok: false, error: 'projectIds[] is required' };
    const name = String(builderName || '').trim();
    if (!name) return { ok: false, error: 'builderName is required' };
    const db = this.repo.read();
    const idSet = new Set(projectIds);
    let updated = 0;
    for (const p of this._all(db)) {
      if (idSet.has(p.ProjectID)) {
        p.BuilderName = name;
        p.UpdatedAt = new Date().toISOString();
        updated += 1;
      }
    }
    this.repo.write(db);
    return { ok: true, data: { builderName: name, updated } };
  }
}

module.exports = { BuilderProjectService };
