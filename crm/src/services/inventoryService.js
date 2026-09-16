/**
 * Inventory (Property) Service
 * ==============================
 * CRUD for properties (units of listing). Photos stored as base64 data-URLs
 * decoded to /app/uploads/properties/<PropertyID>/ on disk and served under
 * /uploads/properties/<PropertyID>/<file>.
 *
 * A property is category-typed the same way as a requirement (Residential /
 * Commercial / Industrial / Land + SubCategory) so it can be matched against
 * client requirements via the existing matching engine.
 */
const fs   = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'properties');
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

class InventoryService {
  constructor(repository) { this.repository = repository; }

  _ensureDb() {
    const db = this.repository.read();
    db.Inventory    = db.Inventory    || [];
    db.Owners       = db.Owners       || [];
    db.Builders     = db.Builders     || [];
    db._V2Counters  = db._V2Counters  || {};
    db._V2Counters.Property = db._V2Counters.Property || 0;
    return db;
  }

  list(filter = {}) {
    const db = this._ensureDb();
    let items = db.Inventory.filter(p => !p._deleted);
    if (filter.q) {
      const q = String(filter.q).toLowerCase();
      items = items.filter(p =>
        (p.Title || '').toLowerCase().includes(q) ||
        (p.SocietyName || '').toLowerCase().includes(q) ||
        (p.Location1 || '').toLowerCase().includes(q) ||
        (p.Location  || '').toLowerCase().includes(q) ||
        (p.OwnerName || '').toLowerCase().includes(q) ||
        (p.BrokerName || '').toLowerCase().includes(q) ||
        (p.BuilderName || '').toLowerCase().includes(q) ||
        (p.PropertyID || '').toLowerCase().includes(q)
      );
    }
    if (filter.category) items = items.filter(p => p.Category === filter.category);
    if (filter.subCategory) items = items.filter(p => p.SubCategory === filter.subCategory);
    if (filter.transactionType) items = items.filter(p => (p.ListingFor || '').toLowerCase() === String(filter.transactionType).toLowerCase());
    if (filter.status) items = items.filter(p => p.ListingStatus === filter.status);
    if (filter.source) {
      // Auto-derive source if missing on legacy records
      items = items.filter(p => (p.InventorySource || _deriveInventorySource(p.OwnerType)) === filter.source);
    }
    items.sort((a,b) => new Date(b.UpdatedAt || 0) - new Date(a.UpdatedAt || 0));
    return items;
  }

  get(propertyId) {
    const db = this._ensureDb();
    return db.Inventory.find(p => p.PropertyID === propertyId && !p._deleted) || null;
  }

  create(payload, actor = {}) {
    const db = this._ensureDb();
    const id = payload.PropertyID || `PROP-${String(++db._V2Counters.Property).padStart(4, '0')}`;
    const now = new Date().toISOString();
    const inventorySource = payload.InventorySource || _deriveInventorySource(payload.OwnerType);
    const property = {
      PropertyID:     id,
      Title:          payload.Title || _autoTitle(payload),
      Category:       payload.Category || 'Residential',
      SubCategory:    payload.SubCategory || null,
      ListingFor:     payload.ListingFor || 'Sale',
      ListingStatus:  payload.ListingStatus || 'Available',
      InventorySource: inventorySource,   // 'Builder' | 'Own' | 'Broker'
      OwnerName:      payload.OwnerName || null,
      OwnerMobile:    payload.OwnerMobile || null,
      OwnerType:      payload.OwnerType || 'Direct Owner',
      ExclusiveWithMe:!!payload.ExclusiveWithMe,
      SocietyName:    payload.SocietyName || null,
      BuilderName:    payload.BuilderName || null,
      ProjectName:    payload.ProjectName || null,
      BrokerName:     payload.BrokerName || null,
      BrokerMobile:   payload.BrokerMobile || null,
      BrokerCommissionShare: payload.BrokerCommissionShare || null,
      Location1:      payload.Location1 || null,
      Location2:      payload.Location2 || null,
      Fields:         {},
      Photos:         [],
      CreatedAt:      now,
      UpdatedAt:      now,
      CreatedBy:      actor.userId || 'system',
      CompanyID:      actor.companyId || actor.companyID || null,
      BrokerageID:    actor.brokerageId || actor.brokerageID || null,
      _v2:            true
    };
    _copyDynamicFields(payload, property);
    db.Inventory.push(property);
    const dir = path.join(UPLOAD_ROOT, id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.repository.write(db);
    return property;
  }

  update(propertyId, payload, actor = {}) {
    const db = this._ensureDb();
    const p = db.Inventory.find(x => x.PropertyID === propertyId && !x._deleted);
    if (!p) return null;
    const keepKeys = new Set(['Photos', 'CreatedAt', 'CreatedBy', 'PropertyID', '_v2']);
    for (const [k, v] of Object.entries(payload || {})) {
      if (keepKeys.has(k)) continue;
      if (['Title','Category','SubCategory','ListingFor','ListingStatus','InventorySource','OwnerName','OwnerMobile','OwnerType','ExclusiveWithMe','SocietyName','BuilderName','ProjectName','BrokerName','BrokerMobile','BrokerCommissionShare','Location1','Location2','ProjectStatus','TotalUnits','PossessionDate','LandArea','NeedsReview','RERANumber','RERARegistrationDate','Configurations','AreaRange','Taluka','Village','BHK','CarpetArea','IsReraMaster','ImportedFrom','ImportedAt'].includes(k)) {
        p[k] = v;
      } else {
        p.Fields = p.Fields || {};
        p.Fields[k] = v;
      }
    }
    // Auto-derive InventorySource if OwnerType changed but source not set
    if (!p.InventorySource) p.InventorySource = _deriveInventorySource(p.OwnerType);
    p.UpdatedAt = new Date().toISOString();
    p.UpdatedBy = actor.userId || 'system';
    this.repository.write(db);
    return p;
  }

  remove(propertyId) {
    const db = this._ensureDb();
    const p = db.Inventory.find(x => x.PropertyID === propertyId);
    if (!p) return false;
    p._deleted = true;
    p.UpdatedAt = new Date().toISOString();
    this.repository.write(db);
    return true;
  }

  /**
   * Photos are POSTed as base64 data-URLs. We decode and write to disk under
   *   /app/uploads/properties/<PropertyID>/<timestamp>.<ext>
   * and store a lightweight {id, url, name} record on the property.
   */
  uploadPhotos(propertyId, photosArr, actor = {}) {
    const db = this._ensureDb();
    const p = db.Inventory.find(x => x.PropertyID === propertyId && !x._deleted);
    if (!p) return null;
    p.Photos = Array.isArray(p.Photos) ? p.Photos : [];
    const dir = path.join(UPLOAD_ROOT, propertyId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let idx = p.Photos.length;
    for (const item of photosArr) {
      const dataUrl = typeof item === 'string' ? item : item.dataUrl;
      if (!dataUrl || !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(dataUrl)) continue;
      const [meta, base64] = dataUrl.split(',');
      const ext = meta.match(/data:image\/(png|jpe?g|webp|gif)/)[1].replace('jpeg', 'jpg');
      const filename = `${Date.now()}-${idx++}.${ext}`;
      fs.writeFileSync(path.join(dir, filename), Buffer.from(base64, 'base64'));
      p.Photos.push({
        id: `PH-${Date.now()}-${idx}`,
        url: `/uploads/properties/${propertyId}/${filename}`,
        name: (typeof item === 'object' && item.name) || filename,
        uploadedAt: new Date().toISOString(),
        uploadedBy: actor.userId || 'system'
      });
    }
    p.UpdatedAt = new Date().toISOString();
    this.repository.write(db);
    return p.Photos;
  }

  deletePhoto(propertyId, photoId) {
    const db = this._ensureDb();
    const p = db.Inventory.find(x => x.PropertyID === propertyId && !x._deleted);
    if (!p) return false;
    const photo = (p.Photos || []).find(ph => ph.id === photoId);
    if (!photo) return false;
    // Remove file on disk
    try {
      const relPath = photo.url.replace(/^\/uploads\/properties\//, '');
      const absPath = path.join(UPLOAD_ROOT, relPath);
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    } catch(_) { /* ignore */ }
    p.Photos = p.Photos.filter(ph => ph.id !== photoId);
    p.UpdatedAt = new Date().toISOString();
    this.repository.write(db);
    return true;
  }
}

function _autoTitle(payload) {
  const parts = [
    payload.SubCategory,
    payload.BHK ? `${payload.BHK}` : null,
    payload.SubCategory && payload.Location1 ? 'in' : null,
    payload.Location1,
    payload.SocietyName ? `(${payload.SocietyName})` : null
  ].filter(Boolean);
  return parts.join(' ') || 'Untitled Property';
}

/**
 * Auto-derive InventorySource from OwnerType if not explicitly set.
 * Every property belongs to exactly one of three pools:
 *   Builder — new project stock coming from a builder
 *   Broker  — property shared with a sub-broker network
 *   Own     — everything else (direct owner, NRI, investor, corporate)
 */
function _deriveInventorySource(ownerType) {
  if (ownerType === 'Builder') return 'Builder';
  if (ownerType === 'Sub-broker') return 'Broker';
  return 'Own';
}

function _copyDynamicFields(payload, property) {
  const topLevelKeys = new Set(Object.keys(property));
  for (const [k, v] of Object.entries(payload)) {
    if (topLevelKeys.has(k)) continue;
    if (v === null || v === undefined || v === '') continue;
    property.Fields[k] = v;
  }
}

module.exports = { InventoryService, UPLOAD_ROOT };
