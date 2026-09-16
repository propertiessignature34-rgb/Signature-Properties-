const { TestStorageProvider } = require('./storageService');

const VALID_DOCUMENT_TYPES = new Set([
  'RERA',
  'SALE_DEED',
  'OWNERSHIP',
  'NOC',
  'APPROVAL',
  'AGREEMENT',
  'BUILDER_DOCUMENT',
  'PROJECT_DOCUMENT',
  'PROPERTY_DOCUMENT',
  'OTHER'
]);

const VALID_STORAGE_PROVIDERS = new Set(['TEST_PROVIDER', 'LOCAL', 'S3', 'SUPABASE', 'GOOGLE_DRIVE']);
const VALID_ENTITY_TYPES = new Set(['BUILDER', 'PROJECT', 'PROPERTY']);
const VALID_VISIBILITY = new Set(['PUBLIC', 'BROKER', 'INTERNAL', 'PRIVATE']);

function normaliseVisibility(value) {
  const normalized = String(value || 'PRIVATE').trim().toUpperCase();
  return VALID_VISIBILITY.has(normalized) ? normalized : 'PRIVATE';
}

class DocumentService {
  constructor(repository, storageProvider = null) {
    this.repository = repository;
    this.storageProvider = storageProvider || new TestStorageProvider();
  }

  ensureAccess(actor = {}, scope = {}) {
    const userId = String(actor.userId || actor.userID || '').trim();
    if (!userId) {
      return { ok: false, statusCode: 401, error: 'Unauthorized' };
    }

    return {
      ok: true,
      actor: {
        userId,
        companyId: String(scope.companyId || scope.CompanyID || actor.companyId || actor.companyID || '').trim(),
        brokerageId: String(scope.brokerageId || scope.BrokerageID || actor.brokerageId || actor.brokerageID || '').trim(),
        role: String(actor.role || '').trim().toUpperCase()
      }
    };
  }

  validateDocumentInput(payload = {}) {
    const entityType = String(payload.EntityType || payload.entityType || '').trim().toUpperCase();
    const entityId = String(payload.EntityID || payload.entityId || '').trim();
    const documentType = String(payload.DocumentType || payload.documentType || '').trim().toUpperCase();
    const rawVisibility = String(payload.Visibility || payload.visibility || '').trim().toUpperCase();
    const visibility = normaliseVisibility(rawVisibility);
    const title = String(payload.Title || payload.title || '').trim();
    const storageProvider = String(payload.StorageProvider || payload.storageProvider || 'TEST_PROVIDER').trim().toUpperCase();
    const storagePath = String(payload.StoragePath || payload.storagePath || `/${entityType.toLowerCase()}/${entityId || 'item'}/document-${Date.now()}.bin`).trim();
    const mime = String(payload.MimeType || payload.mimeType || 'application/pdf').trim();
    const explicitSize = payload.SizeBytes ?? payload.sizeBytes;
    const sizeBytes = Number(explicitSize ?? 1);

    if (!VALID_ENTITY_TYPES.has(entityType)) {
      return { ok: false, error: 'Invalid entity type' };
    }

    if (!entityId) {
      return { ok: false, error: 'Entity ID is required' };
    }

    if (!VALID_DOCUMENT_TYPES.has(documentType)) {
      return { ok: false, error: 'Invalid document type' };
    }

    if (!title) {
      return { ok: false, error: 'Title is required' };
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

    return { ok: true, data: { entityType, entityId, documentType, visibility, title, storageProvider, storagePath, mime, sizeBytes } };
  }

  async createDocument(payload = {}, actor = {}, context = {}) {
    const auth = this.ensureAccess(actor, context);
    if (!auth.ok) return auth;

    const validation = this.validateDocumentInput(payload);
    if (!validation.ok) return validation;

    const record = this.repository.createDocument({
      EntityType: validation.data.entityType,
      EntityID: validation.data.entityId,
      PropertyID: payload.PropertyID || payload.propertyId || null,
      ProjectID: payload.ProjectID || payload.projectId || null,
      BuilderID: payload.BuilderID || payload.builderId || null,
      CompanyID: context.companyId || payload.CompanyID || payload.companyId || null,
      BrokerageID: context.brokerageId || payload.BrokerageID || payload.brokerageId || null,
      DocumentType: validation.data.documentType,
      Title: validation.data.title,
      Description: payload.Description || payload.description || '',
      Status: payload.Status || payload.status || 'ACTIVE',
      StorageProvider: validation.data.storageProvider,
      StoragePath: validation.data.storagePath,
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

  async getDocument(documentId, actor = {}, context = {}) {
    const auth = this.ensureAccess(actor, context);
    if (!auth.ok) return auth;

    const record = this.repository.getDocument(documentId);
    if (!record) return { ok: false, error: 'Document not found' };
    if (record.DeletedAt) return { ok: false, error: 'Document deleted' };
    if (record.ArchivedAt) return { ok: false, error: 'Document archived' };

    if (record.Visibility === 'PRIVATE' && String(actor.userId || '').trim() !== String(record.UploadedBy || '').trim()) {
      return { ok: false, statusCode: 403, error: 'Forbidden' };
    }

    return { ok: true, data: this.safeDto(record) };
  }

  async listDocuments(filters = {}, actor = {}, context = {}) {
    const auth = this.ensureAccess(actor, context);
    if (!auth.ok) return auth;

    const rows = this.repository.listDocuments({
      EntityType: filters.EntityType,
      EntityID: filters.EntityID,
      BuilderID: filters.BuilderID,
      ProjectID: filters.ProjectID,
      PropertyID: filters.PropertyID,
      DocumentType: filters.DocumentType,
      Visibility: filters.Visibility,
      CompanyID: context.companyId || filters.CompanyID,
      BrokerageID: context.brokerageId || filters.BrokerageID,
      includeDeleted: false,
      includeArchived: false
    });

    return { ok: true, data: rows.map((row) => this.safeDto(row)) };
  }

  async archiveDocument(documentId, actor = {}, context = {}) {
    const auth = this.ensureAccess(actor, context);
    if (!auth.ok) return auth;
    const result = this.repository.archiveDocument(documentId, { ArchivedAt: new Date().toISOString() });
    if (!result.ok) return result;
    return { ok: true, data: this.safeDto(result.data) };
  }

  async deleteDocument(documentId, actor = {}, context = {}) {
    const auth = this.ensureAccess(actor, context);
    if (!auth.ok) return auth;
    const result = this.repository.deleteDocument(documentId, { DeletedAt: new Date().toISOString() });
    if (!result.ok) return result;
    return { ok: true, data: this.safeDto(result.data) };
  }

  safeDto(row = {}) {
    const dto = {
      DocumentID: row.DocumentID,
      EntityType: row.EntityType,
      EntityID: row.EntityID,
      PropertyID: row.PropertyID,
      ProjectID: row.ProjectID,
      BuilderID: row.BuilderID,
      DocumentType: row.DocumentType,
      Title: row.Title,
      Description: row.Description,
      Status: row.Status,
      StorageProvider: row.StorageProvider,
      MimeType: row.MimeType,
      SizeBytes: row.SizeBytes,
      Checksum: row.Checksum,
      Visibility: row.Visibility,
      UploadedBy: row.Visibility === 'PUBLIC' || row.Visibility === 'BROKER' || row.Visibility === 'INTERNAL' ? row.UploadedBy || null : null,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt,
      ArchivedAt: row.ArchivedAt,
      DeletedAt: row.DeletedAt
    };

    if (String(row.Visibility || '').toUpperCase() !== 'PUBLIC') {
      delete dto.StoragePath;
    }

    return dto;
  }
}

module.exports = {
  DocumentService,
  VALID_DOCUMENT_TYPES,
  VALID_ENTITY_TYPES,
  VALID_VISIBILITY
};
