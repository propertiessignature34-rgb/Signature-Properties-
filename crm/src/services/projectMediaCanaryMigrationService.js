'use strict';

const crypto = require('crypto');
const objectStorage = require('./objectStorageService');
const downloader = require('./safeUrlDownloader');

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const STORAGE_BUCKET = objectStorage.BUCKET_NAME || 'signature_objects';

function sanitizeErrorMessage(message) {
  return String(message || 'Unknown error').replace(/https?:\/\/\S+/gi, '[url-redacted]').slice(0, 320);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function uniqueUrls(values = []) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const url = String(raw || '').trim();
    if (!isHttpUrl(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

function pickOriginalUrl(item = {}) {
  return String(item.OriginalUrl || item.SourceUrl || item.Url || '').trim();
}

function safeName(name, fallback) {
  const cleaned = String(name || fallback || '').trim().replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(0, 120);
  return cleaned || fallback;
}

function extensionForMime(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized === 'application/pdf') return 'pdf';
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  return 'bin';
}

function checksumOf(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

class ProjectMediaCanaryMigrationService {
  constructor(repository, deps = {}) {
    this.repo = repository;
    this.objectStorage = deps.objectStorage || objectStorage;
    this.downloader = deps.downloader || downloader;
  }

  _all(db) {
    db.BuilderProjects = Array.isArray(db.BuilderProjects) ? db.BuilderProjects : [];
    return db.BuilderProjects;
  }

  _findProject(db, projectId) {
    return this._all(db).find((row) => row.ProjectID === projectId) || null;
  }

  _discoverBrochureUrls(project) {
    const fromTopLevel = project.BrochureUrl ? [project.BrochureUrl] : [];
    const fromList = (Array.isArray(project.Brochures) ? project.Brochures : []).map((item) => pickOriginalUrl(item));
    return uniqueUrls([...fromTopLevel, ...fromList]);
  }

  _discoverImageEntries(project) {
    const photos = Array.isArray(project.Photos) ? project.Photos : [];
    const discovered = photos.map((item) => ({ item, originalUrl: pickOriginalUrl(item) }))
      .filter((row) => isHttpUrl(row.originalUrl));
    const byUrl = new Map();
    for (const row of discovered) {
      const key = row.originalUrl.toLowerCase();
      if (!byUrl.has(key)) byUrl.set(key, row);
    }
    return Array.from(byUrl.values());
  }

  _ensureProjectMediaArrays(project) {
    project.Brochures = Array.isArray(project.Brochures) ? project.Brochures : [];
    project.Photos = Array.isArray(project.Photos) ? project.Photos : [];
  }

  async _resolveStoredObject({ projectId, originalUrl, mediaType, filenameHint, contentType, buffer, source }) {
    const checksum = checksumOf(buffer);
    const existing = await this.objectStorage.findLatestObjectByMetadata({ checksum, mediaType });
    if (existing && existing.path) {
      let readBack;
      try {
        readBack = await this.objectStorage.getObject(existing.path);
      } catch (error) {
        throw new Error(`GridFS verification failed: unable to read stored bytes for ${existing.path}: ${error.message}`);
      }
      if (!readBack?.buffer || !Buffer.isBuffer(readBack.buffer)) {
        throw new Error(`GridFS verification failed: stored bytes are missing for ${existing.path}`);
      }
      const storedChecksum = checksumOf(readBack.buffer);
      if (storedChecksum !== checksum) {
        throw new Error(`GridFS verification failed: SHA-256 mismatch (expected ${checksum}, got ${storedChecksum})`);
      }
      return {
        reused: true,
        stored: existing,
        checksum,
        sizeBytes: Number(existing.size || buffer.length) || buffer.length,
        contentType: existing.contentType || contentType,
        verified: true
      };
    }

    const ext = extensionForMime(contentType);
    const key = `builder-projects/${projectId}/${mediaType === 'brochure' ? 'brochures' : 'photos'}/${checksum.slice(0, 20)}-${safeName(filenameHint, `file.${ext}`)}`;
    let uploaded = null;
    try {
      uploaded = await this.objectStorage.putObject(key, buffer, contentType, filenameHint, {
        metadata: {
          projectId,
            ProjectID: projectId,
          mediaType,
          source,
          originalUrl,
            OriginalUrl: originalUrl,
          checksum,
          mimeType: contentType,
            fileName: filenameHint,
            sizeBytes: buffer.length,
            createdAt: new Date().toISOString()
        }
      });
      let readBack;
      try {
        readBack = await this.objectStorage.getObject(uploaded.path);
      } catch (error) {
        throw new Error(`GridFS verification failed: unable to read stored bytes for ${uploaded.path}: ${error.message}`);
      }
      if (!readBack?.buffer || !Buffer.isBuffer(readBack.buffer)) {
        throw new Error(`GridFS verification failed: stored bytes are missing for ${uploaded.path}`);
      }
      const storedChecksum = checksumOf(readBack.buffer);
      if (storedChecksum !== checksum) {
        throw new Error(`GridFS verification failed: SHA-256 mismatch (expected ${checksum}, got ${storedChecksum})`);
      }

      const storedInfo = await this.objectStorage.getObjectInfo(uploaded.path);
      return {
        reused: false,
        stored: storedInfo || { path: uploaded.path, key: uploaded.path, fileId: uploaded.fileId || null, size: uploaded.size || buffer.length, contentType },
        checksum,
        sizeBytes: uploaded.size || buffer.length,
        contentType,
        verified: true
      };
    } catch (error) {
      if (uploaded?.path && typeof this.objectStorage.deleteObject === 'function') {
        try { await this.objectStorage.deleteObject(uploaded.path); } catch (_) {}
      }
      throw error;
    }
  }

  async _migrateBrochure(project, originalUrl, userId, { source = 'karma' } = {}) {
    const now = new Date().toISOString();
    const filenameHint = safeName(`${project.ProjectName || project.ProjectID}-brochure.pdf`, 'brochure.pdf');

    try {
      const downloaded = await this.downloader.downloadMediaSafely(originalUrl, { kind: 'pdf', timeoutMs: DEFAULT_TIMEOUT_MS, maxBytes: MAX_PDF_BYTES });
      if (!downloaded.ok) {
        return { ok: false, mediaType: 'brochure', originalUrl, error: sanitizeErrorMessage(downloaded.error), lastAttemptAt: now };
      }

      const stored = await this._resolveStoredObject({
        projectId: project.ProjectID,
        originalUrl,
        mediaType: 'brochure',
        filenameHint,
        contentType: 'application/pdf',
        buffer: downloaded.buffer,
        source
      });
      const mediaId = this.repo.createId('MED');
      const internalUrl = `/api/v2/builder-projects/${encodeURIComponent(project.ProjectID)}/brochure`;

      const record = {
        MediaID: mediaId,
        brochureId: mediaId,
        projectId: project.ProjectID,
        Filename: filenameHint,
        fileName: filenameHint,
        Url: internalUrl,
        OriginalUrl: originalUrl,
        originalUrl,
        SourceUrl: originalUrl,
        Source: source,
        source,
        StoragePath: stored.stored.path,
        fileId: stored.stored.fileId || null,
        mimeType: 'application/pdf',
        sizeBytes: stored.sizeBytes,
        Size: stored.sizeBytes,
        checksum: stored.checksum,
        storageType: 'gridfs',
        storageBucket: STORAGE_BUCKET,
        stored: true,
        verified: true,
        downloadStatus: 'downloaded',
        uploadedAt: now,
        UploadedAt: now,
        lastAttemptAt: now,
        error: null,
        UploadedBy: userId || 'system'
      };

      return {
        ok: true,
        mediaType: 'brochure',
        originalUrl,
        bytesStored: stored.reused ? 0 : stored.sizeBytes,
        reused: stored.reused,
        storagePath: stored.stored.path,
        created: !stored.reused,
        record
      };
    } catch (error) {
      const errorMessage = sanitizeErrorMessage(error.message);
      return { ok: false, mediaType: 'brochure', originalUrl, error: errorMessage, lastAttemptAt: now };
    }
  }

  async _migrateProjectImage(project, imageEntry, userId) {
    const now = new Date().toISOString();
    const originalUrl = imageEntry.originalUrl;
    const current = { ...(imageEntry.item || {}) };
    const filenameHint = safeName(current.Filename || `${project.ProjectName || project.ProjectID}-photo`, 'photo.jpg');

    try {
      const downloaded = await this.downloader.downloadMediaSafely(originalUrl, { kind: 'image', timeoutMs: DEFAULT_TIMEOUT_MS, maxBytes: MAX_IMAGE_BYTES });
      if (!downloaded.ok) {
        current.downloadStatus = 'failed';
        current.verified = false;
        current.lastAttemptAt = now;
        current.error = sanitizeErrorMessage(downloaded.error);
        current.originalUrl = originalUrl;
        current.OriginalUrl = originalUrl;
        current.SourceUrl = originalUrl;
        return { ok: false, mediaType: 'project_image', originalUrl, error: current.error, lastAttemptAt: now };
      }

      const stored = await this._resolveStoredObject({
        projectId: project.ProjectID,
        originalUrl,
        mediaType: 'project_image',
        filenameHint,
        contentType: downloaded.contentType,
        buffer: downloaded.buffer,
        source: 'karma'
      });

      const mediaId = current.MediaID || this.repo.createId('MED');
      current.MediaID = mediaId;
      current.Url = `/api/v2/builder-projects/${encodeURIComponent(project.ProjectID)}/images/${encodeURIComponent(mediaId)}`;
      current.Filename = filenameHint;
      current.StoragePath = stored.stored.path;
      current.OriginalUrl = originalUrl;
      current.originalUrl = originalUrl;
      current.SourceUrl = originalUrl;
      current.Source = current.Source || 'karma';
      current.projectId = project.ProjectID;
      current.fileId = stored.stored.fileId || null;
      current.fileName = filenameHint;
      current.mimeType = downloaded.contentType;
      current.sizeBytes = stored.sizeBytes;
      current.checksum = stored.checksum;
      current.mediaType = 'project_image';
      current.storageType = 'gridfs';
      current.storageBucket = STORAGE_BUCKET;
      current.stored = true;
       current.verified = true;
      current.downloadStatus = 'downloaded';
      current.storedAt = now;
      current.uploadedAt = now;
      current.lastAttemptAt = now;
      current.error = null;
      current.UploadedAt = current.UploadedAt || now;
      current.UploadedBy = current.UploadedBy || userId || 'system';

      return {
        ok: true,
        mediaType: 'project_image',
        originalUrl,
        bytesStored: stored.reused ? 0 : stored.sizeBytes,
        reused: stored.reused,
        storagePath: stored.stored.path,
        created: !stored.reused,
        record: current
      };
    } catch (error) {
      current.downloadStatus = 'failed';
      current.verified = false;
      current.lastAttemptAt = now;
      current.error = sanitizeErrorMessage(error.message);
      current.originalUrl = current.originalUrl || originalUrl;
      current.OriginalUrl = current.OriginalUrl || originalUrl;
      current.SourceUrl = current.SourceUrl || originalUrl;
      return { ok: false, mediaType: 'project_image', originalUrl, error: current.error, lastAttemptAt: now };
    }
  }

  async _cleanupCreatedObjects(paths = []) {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    const failures = [];
    for (const path of uniquePaths) {
      if (typeof this.objectStorage.deleteObject !== 'function') {
        failures.push({ path, error: 'Object storage cleanup is unavailable' });
        continue;
      }
      try {
        await this.objectStorage.deleteObject(path);
      } catch (error) {
        failures.push({ path, error: sanitizeErrorMessage(error.message) });
      }
    }
    return failures;
  }

  async importExplicitBrochure({ projectId, brochureUrl, userId = 'system', source = 'manual-url' } = {}) {
    const normalizedProjectId = String(projectId || '').trim();
    const originalUrl = String(brochureUrl || '').trim();
    if (!normalizedProjectId) {
      return { ok: false, statusCode: 400, error: 'ProjectID is required' };
    }
    if (!originalUrl) {
      return { ok: false, statusCode: 400, error: 'BrochureURL is required' };
    }
    if (!/^https:\/\//i.test(originalUrl)) {
      return { ok: false, statusCode: 400, error: 'BrochureURL must be an https URL' };
    }

    const db = this.repo.read();
    const target = this._findProject(db, normalizedProjectId);
    if (!target) {
      return { ok: false, statusCode: 404, error: `Project not found: ${normalizedProjectId}` };
    }
    this._ensureProjectMediaArrays(target);

    const originalKey = originalUrl.toLowerCase();
    const existing = target.Brochures.find((row) =>
      row &&
      row.verified === true &&
      row.StoragePath &&
      String(row.OriginalUrl || row.originalUrl || row.SourceUrl || '').trim().toLowerCase() === originalKey
    );

    // A verified reference is reusable only after its stored bytes pass the
    // same checksum check used for newly downloaded objects.
    if (existing) {
      try {
        const readBack = await this.objectStorage.getObject(existing.StoragePath);
        const readBackChecksum = checksumOf(readBack?.buffer);
        if (readBack?.buffer && existing.checksum && readBackChecksum === existing.checksum) {
          return {
            ok: true,
            data: {
              projectId: normalizedProjectId,
              originalUrl,
              internalUrl: `/api/v2/builder-projects/${encodeURIComponent(normalizedProjectId)}/brochure`,
              referencesUpdated: false,
              reused: true,
              idempotent: true,
              verified: true,
              checksum: existing.checksum,
              storagePath: existing.StoragePath,
              mediaId: existing.MediaID || existing.brochureId || null
            }
          };
        }
      } catch (_) {
        // A stale/corrupt reference is not trusted. Download the explicit
        // URL again, but never delete the old object or reference here.
      }
    }

    const staged = await this._migrateBrochure(target, originalUrl, userId, { source });
    if (!staged.ok) {
      return {
        ok: false,
        statusCode: 422,
        error: 'BROCHURE_IMPORT_FAILED',
        data: {
          projectId: normalizedProjectId,
          originalUrl,
          referencesUpdated: false,
          verified: false,
          failure: staged.error
        }
      };
    }

    const createdPath = staged.created && staged.storagePath ? staged.storagePath : null;
    try {
      // Replace only an unverified/pending reference for the same explicit URL.
      // Previously verified objects are never deleted; a valid one returned
      // above before reaching this commit path.
      target.Brochures = target.Brochures.filter((row) =>
        String(row?.OriginalUrl || row?.originalUrl || row?.SourceUrl || '').trim().toLowerCase() !== originalKey
      );
      target.Brochures.unshift(staged.record);
      target.UpdatedAt = new Date().toISOString();
      this.repo.write(db);
    } catch (error) {
      if (createdPath) await this._cleanupCreatedObjects([createdPath]);
      return {
        ok: false,
        statusCode: 500,
        error: 'BROCHURE_PROJECT_REFERENCE_UPDATE_FAILED',
        data: {
          projectId: normalizedProjectId,
          originalUrl,
          referencesUpdated: false,
          verified: false,
          failure: sanitizeErrorMessage(error.message)
        }
      };
    }

    const verifyDb = this.repo.read();
    const verifyProject = this._findProject(verifyDb, normalizedProjectId);
    const committed = (verifyProject?.Brochures || []).find((row) =>
      row &&
      row.verified === true &&
      row.StoragePath === staged.record.StoragePath &&
      String(row.OriginalUrl || row.originalUrl || row.SourceUrl || '').trim().toLowerCase() === originalKey
    );
    if (!committed) {
      return {
        ok: false,
        statusCode: 500,
        error: 'BROCHURE_PROJECT_REFERENCE_VERIFICATION_FAILED',
        data: {
          projectId: normalizedProjectId,
          originalUrl,
          referencesUpdated: false,
          verified: false
        }
      };
    }

    return {
      ok: true,
      data: {
        projectId: normalizedProjectId,
        originalUrl,
        internalUrl: committed.Url,
        referencesUpdated: true,
        reused: Boolean(staged.reused),
        idempotent: false,
        verified: true,
        checksum: committed.checksum,
        storagePath: committed.StoragePath,
        mediaId: committed.MediaID || committed.brochureId || null
      }
    };
  }

  async migrateProject({ projectId, userId = 'system' } = {}) {
    const db = this.repo.read();
    const projects = this._all(db);
    const beforeCount = projects.length;
    const target = this._findProject(db, projectId);
    if (!target) return { ok: false, statusCode: 404, error: `Project not found: ${projectId}` };
    this._ensureProjectMediaArrays(target);

    const beforeProjectId = target.ProjectID;
    const brochureUrls = this._discoverBrochureUrls(target);
    const imageEntries = this._discoverImageEntries(target);
    const beforeImageOriginals = imageEntries.map((row) => row.originalUrl);

    let brochuresStored = 0;
    let imagesStored = 0;
    let duplicatesReused = 0;
    let bytesStored = 0;
    let failed = 0;
    const failures = [];
    const stagedBrochures = [];
    const stagedImages = [];
    const createdPaths = [];

    for (const url of brochureUrls) {
      const out = await this._migrateBrochure(target, url, userId);
      if (out.ok) {
        stagedBrochures.push(out);
        brochuresStored += 1;
        bytesStored += Number(out.bytesStored || 0);
        if (out.reused) duplicatesReused += 1;
        if (out.created && out.storagePath) createdPaths.push(out.storagePath);
      } else {
        failed += 1;
        failures.push({ mediaType: out.mediaType, originalUrl: out.originalUrl, error: out.error });
      }
    }

    for (const entry of imageEntries) {
      const out = await this._migrateProjectImage(target, entry, userId);
      if (out.ok) {
        stagedImages.push({ entry, ...out });
        imagesStored += 1;
        bytesStored += Number(out.bytesStored || 0);
        if (out.reused) duplicatesReused += 1;
        if (out.created && out.storagePath) createdPaths.push(out.storagePath);
      } else {
        failed += 1;
        failures.push({ mediaType: out.mediaType, originalUrl: out.originalUrl, error: out.error });
      }
    }

    const baseData = {
      projectId,
      projectCountBefore: beforeCount,
      projectCountAfter: beforeCount,
      brochuresFound: brochureUrls.length,
      brochuresStored,
      imagesFound: imageEntries.length,
      imagesStored,
      duplicatesReused,
      failed,
      failures,
      bytesStored
    };

    if (failed > 0) {
      const cleanupFailures = await this._cleanupCreatedObjects(createdPaths);
      return {
        ok: false,
        statusCode: 422,
        error: 'CANARY_MEDIA_REFERENCE_UPDATE_SKIPPED',
        data: {
          ...baseData,
          cleanupFailures,
          referencesUpdated: false,
          verified: false
        }
      };
    }

    for (const staged of stagedBrochures) {
      target.Brochures = target.Brochures.filter((row) =>
        String(row.OriginalUrl || row.SourceUrl || '').trim().toLowerCase() !== staged.originalUrl.toLowerCase()
      );
      target.Brochures.unshift(staged.record);
    }
    for (const staged of stagedImages) {
      const index = target.Photos.indexOf(staged.entry.item);
      if (index >= 0) target.Photos[index] = staged.record;
    }

    target.UpdatedAt = new Date().toISOString();
    this.repo.write(db);

    const verifyDb = this.repo.read();
    const afterProjects = this._all(verifyDb);
    const afterTarget = this._findProject(verifyDb, projectId);
    const afterCount = afterProjects.length;
    const afterImageOriginals = this._discoverImageEntries(afterTarget || {}).map((row) => row.originalUrl);
    const originalBrochureUrlsStillPresent = brochureUrls.every((url) =>
      (afterTarget.BrochureUrl === url) ||
      (afterTarget.Brochures || []).some((row) =>
        String(row.originalUrl || row.OriginalUrl || row.SourceUrl || '').trim().toLowerCase() === url.toLowerCase()
      )
    );
    const originalImageUrlsStillPresent = beforeImageOriginals.every((url) =>
      afterImageOriginals.some((afterUrl) => String(afterUrl || '').toLowerCase() === String(url || '').toLowerCase())
    );

    const brochureVerifications = await Promise.all(stagedBrochures.map((item) => this.objectStorage.getObjectInfo(item.storagePath)));
    const imageVerifications = await Promise.all(stagedImages.map((item) => this.objectStorage.getObjectInfo(item.storagePath)));
    const allBrochuresVerified = brochureVerifications.every(Boolean);
    const allImagesVerified = imageVerifications.every(Boolean);

    const verified = Boolean(
      afterCount === beforeCount &&
      String(afterTarget?.ProjectID || '') === String(beforeProjectId || '') &&
      failed === 0 &&
      originalBrochureUrlsStillPresent &&
      originalImageUrlsStillPresent &&
      (brochuresStored === 0 || allBrochuresVerified) &&
      (imagesStored === 0 || allImagesVerified)
    );

    return {
      ok: true,
      data: {
        ...baseData,
        projectCountAfter: afterCount,
        referencesUpdated: true,
        verified
      }
    };
  }

  async getProjectBrochureFile(projectId) {
    const db = this.repo.read();
    const project = this._findProject(db, projectId);
    if (!project) return { ok: false, statusCode: 404, error: 'Project not found' };
    const brochure = (project.Brochures || []).find((row) =>
      row.StoragePath &&
      row.verified === true &&
      String(row.downloadStatus || '').toLowerCase() === 'downloaded'
    );
    if (!brochure) return { ok: false, statusCode: 404, error: 'Stored brochure not found' };
    const out = await this.objectStorage.getObject(brochure.StoragePath);
    return { ok: true, buffer: out.buffer, contentType: 'application/pdf', size: Number(out.size || out.buffer?.length || 0) || undefined };
  }

  async getProjectImageFile(projectId, imageId) {
    const db = this.repo.read();
    const project = this._findProject(db, projectId);
    if (!project) return { ok: false, statusCode: 404, error: 'Project not found' };
    const image = (project.Photos || []).find((row) =>
      String(row.MediaID || '') === String(imageId || '') &&
      row.StoragePath &&
      String(row.downloadStatus || '').toLowerCase() === 'downloaded'
    );
    if (!image || !image.StoragePath) return { ok: false, statusCode: 404, error: 'Stored image not found' };
    const out = await this.objectStorage.getObject(image.StoragePath);
    return {
      ok: true,
      buffer: out.buffer,
      contentType: image.mimeType || out.contentType || 'application/octet-stream',
      size: Number(out.size || out.buffer?.length || 0) || undefined
    };
  }
}

module.exports = {
  ProjectMediaCanaryMigrationService,
  checksumOf
};
