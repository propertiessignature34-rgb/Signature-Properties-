const { TestStorageProvider } = require('./storageService');

const VALID_MEDIA_TYPES = new Set([
  'IMAGE',
  'VIDEO',
  'BROCHURE',
  'FLOOR_PLAN',
  'MASTER_PLAN',
  'VIRTUAL_TOUR',
  'CAD_REFERENCE',
  'OTHER'
]);

const VALID_STORAGE_PROVIDERS = new Set(['TEST_PROVIDER', 'LOCAL', 'S3', 'SUPABASE', 'GOOGLE_DRIVE']);
const VALID_ENTITY_TYPES = new Set(['BUILDER', 'PROJECT', 'PROPERTY']);
const VALID_VISIBILITY = new Set(['PUBLIC', 'BROKER', 'INTERNAL', 'PRIVATE']);

function normaliseVisibility(value) {
  const normalized = String(value || 'PRIVATE').trim().toUpperCase();
  return VALID_VISIBILITY.has(normalized) ? normalized : 'PRIVATE';
}

class MediaService {
  constructor(repository, storageProvider = null) {
    this.repository = repository;
    this.storageProvider = storageProvider || new TestStorageProvider();
  }

  ensureAccess(actor = {}, scope = {}) {
    const userId = String(actor.userId || actor.userID || '').trim();
    if (!userId) {
      return { ok: false, statusCode: 401, error: 'Unauthorized' };
    }

    const companyId = String(scope.companyId || scope.CompanyID || actor.companyId || actor.companyID || '').trim();
    const brokerageId = String(scope.brokerageId || scope.BrokerageID || actor.brokerageId || actor.brokerageID || '').trim();

    if (!companyId && !brokerageId) {
      return { ok: true, actor: { userId, companyId, brokerageId, role: String(actor.role || '').trim().toUpperCase() } };
    }

    return {
      ok: true,
      actor: { userId, companyId, brokerageId, role: String(actor.role || '').trim().toUpperCase() }
    };
  }

  validateMediaInput(payload = {}) {
    const entityType = String(payload.EntityType || payload.entityType || '').trim().toUpperCase();
    const entityId = String(payload.EntityID || payload.entityId || '').trim();
    const mediaType = String(payload.MediaType || payload.mediaType || '').trim().toUpperCase();
    const rawVisibility = String(payload.Visibility || payload.visibility || '').trim().toUpperCase();
    const visibility = normaliseVisibility(rawVisibility);
    const title = String(payload.Title || payload.title || '').trim();
    const storageProvider = String(payload.StorageProvider || payload.storageProvider || 'TEST_PROVIDER').trim().toUpperCase();
    const storagePath = String(payload.StoragePath || payload.storagePath || `/${entityType.toLowerCase()}/${entityId || 'item'}/media-${Date.now()}.bin`).trim();
    const mime = String(payload.MimeType || payload.mimeType || (mediaType === 'VIDEO' ? 'video/mp4' : 'image/jpeg')).trim();
    const explicitSize = payload.SizeBytes ?? payload.sizeBytes;
    const sizeBytes = Number(explicitSize ?? 1);

    if (!VALID_ENTITY_TYPES.has(entityType)) {
      return { ok: false, error: 'Invalid entity type' };
    }

    if (!entityId) {
      return { ok: false, error: 'Entity ID is required' };
    }

    if (!VALID_MEDIA_TYPES.has(mediaType)) {
      return { ok: false, error: 'Invalid media type' };
    }

    if (!title) {
      return { ok: false, error: 'Title is required' };
    }

    if (payload.Visibility !== undefined && payload.visibility === undefined && rawVisibility && !VALID_VISIBILITY.has(rawVisibility)) {
      return { ok: false, error: 'Invalid visibility' };
    }
    if (payload.Visibility !== undefined || payload.visibility !== undefined) {
      if (rawVisibility && !VALID_VISIBILITY.has(rawVisibility)) {
        return { ok: false, error: 'Invalid visibility' };
      }
    }

    if (!VALID_STORAGE_PROVIDERS.has(storageProvider)) {
      return { ok: false, error: 'Invalid storage provider' };
    }

    if (!storagePath) {
      return { ok: false, error: 'Storage path is required' };
    }

    if (!mime || mime.indexOf('/') === -1) {
      return { ok: false, error: 'Invalid MIME type' };
    }

    if (explicitSize !== undefined && (!Number.isFinite(sizeBytes) || sizeBytes <= 0)) {
      return { ok: false, error: 'Invalid size' };
    }

    return { ok: true, data: { entityType, entityId, mediaType, visibility, title, storageProvider, storagePath, mime, sizeBytes } };
  }

  async createMedia(payload = {}, actor = {}, context = {}) {
    const auth = this.ensureAccess(actor, context);
    if (!auth.ok) return auth;

    const validation = this.validateMediaInput(payload);
    if (!validation.ok) return validation;

    const record = this.repository.createMedia({
      EntityType: validation.data.entityType,
      EntityID: validation.data.entityId,
      PropertyID: payload.PropertyID || payload.propertyId || null,
      ProjectID: payload.ProjectID || payload.projectId || null,
      BuilderID: payload.BuilderID || payload.builderId || null,
      CompanyID: context.companyId || payload.CompanyID || payload.companyId || null,
      BrokerageID: context.brokerageId || payload.BrokerageID || payload.brokerageId || null,
      Title: validation.data.title,
      Description: payload.Description || payload.description || '',
      MediaType: validation.data.mediaType,
      StorageProvider: validation.data.storageProvider,
      StoragePath: validation.data.storagePath,
      ThumbnailPath: payload.ThumbnailPath || payload.thumbnailPath || '',
      MimeType: validation.data.mime,
      SizeBytes: validation.data.sizeBytes,
      Checksum: payload.Checksum || payload.checksum || '',
      Visibility: validation.data.visibility,
      UploadedBy: auth.actor.userId,
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString(),
      ArchivedAt: null,
      DeletedAt: null
    });

    return { ok: true, data: this.safeDto(record.data) };
  }

  async getMedia(mediaId, actor = {}, context = {}) {
    const auth = this.ensureAccess(actor, context);
    if (!auth.ok) return auth;

    const record = this.repository.getMedia(mediaId);
    if (!record) return { ok: false, error: 'Media not found' };
    if (record.DeletedAt) return { ok: false, error: 'Media deleted' };
    if (record.ArchivedAt) return { ok: false, error: 'Media archived' };

    if (record.Visibility === 'PRIVATE' && String(actor.userId || '').trim() !== String(record.UploadedBy || '').trim()) {
      return { ok: false, statusCode: 403, error: 'Forbidden' };
    }

    return { ok: true, data: this.safeDto(record) };
  }

  async listMedia(filters = {}, actor = {}, context = {}) {
    const auth = this.ensureAccess(actor, context);
    if (!auth.ok) return auth;

    const rows = this.repository.listMedia({
      EntityType: filters.EntityType,
      EntityID: filters.EntityID,
      BuilderID: filters.BuilderID,
      ProjectID: filters.ProjectID,
      PropertyID: filters.PropertyID,
      MediaType: filters.MediaType,
      Visibility: filters.Visibility,
      CompanyID: context.companyId || filters.CompanyID,
      BrokerageID: context.brokerageId || filters.BrokerageID,
      includeDeleted: false,
      includeArchived: false
    });

    return {
      ok: true,
      data: rows.map((row) => this.safeDto(row))
    };
  }

  async archiveMedia(mediaId, actor = {}, context = {}) {
    const auth = this.ensureAccess(actor, context);
    if (!auth.ok) return auth;
    const result = this.repository.archiveMedia(mediaId, { ArchivedAt: new Date().toISOString() });
    if (!result.ok) return result;
    return { ok: true, data: this.safeDto(result.data) };
  }

  async deleteMedia(mediaId, actor = {}, context = {}) {
    const auth = this.ensureAccess(actor, context);
    if (!auth.ok) return auth;
    const result = this.repository.deleteMedia(mediaId, { DeletedAt: new Date().toISOString() });
    if (!result.ok) return result;
    return { ok: true, data: this.safeDto(result.data) };
  }

  safeDto(row = {}) {
    const isPublic = String(row.Visibility || '').toUpperCase() === 'PUBLIC';
    const isBroker = String(row.Visibility || '').toUpperCase() === 'BROKER';
    const isInternal = String(row.Visibility || '').toUpperCase() === 'INTERNAL';

    const dto = {
      MediaID: row.MediaID,
      EntityType: row.EntityType,
      EntityID: row.EntityID,
      PropertyID: row.PropertyID,
      ProjectID: row.ProjectID,
      BuilderID: row.BuilderID,
      Title: row.Title,
      Description: row.Description,
      MediaType: row.MediaType,
      StorageProvider: row.StorageProvider,
      MimeType: row.MimeType,
      SizeBytes: row.SizeBytes,
      Checksum: row.Checksum,
      Visibility: row.Visibility,
      UploadedBy: isPublic || isBroker || isInternal ? row.UploadedBy || null : null,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt,
      ArchivedAt: row.ArchivedAt,
      DeletedAt: row.DeletedAt
    };

    if (!isPublic) {
      delete dto.StoragePath;
      delete dto.ThumbnailPath;
    }

    return dto;
  }
}

module.exports = {
  MediaService,
  VALID_MEDIA_TYPES,
  VALID_ENTITY_TYPES,
  VALID_VISIBILITY
};
