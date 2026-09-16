'use strict';

const objectStorage = require('./objectStorageService');
const downloader = require('./safeUrlDownloader');

/**
 * BrochureMigrationService — controlled, batch-limited migration of
 * external BuilderProjects.BrochureUrl PDFs into the existing object
 * storage. Server-side only; never exposes storage credentials.
 *
 * Safety invariants (see project brief):
 *   - BrochureUrl is never cleared before a verified upload exists.
 *   - Only a bounded batch (default 3, hard max 5) is processed per call.
 *   - Storage key is deterministic per project → retries overwrite instead
 *     of creating duplicate objects/Brochures[] entries.
 *   - A single process-wide lock prevents overlapping batches (the Mongo
 *     backing store is a single `db_snapshot` document; concurrent writers
 *     would race).
 */

const DEFAULT_BATCH_SIZE = 3;
const MAX_BATCH_SIZE = 5;
const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB
const DOWNLOAD_TIMEOUT_MS = 20000;
// Hard ceiling per project: must exceed download timeout + Mongo socket
// timeout so a stalled GridFS op surfaces as a failure, not a hung request.
const MIGRATION_TIMEOUT_MS = 90000;
const MAX_RUN_HISTORY = 50;

let migrationLock = false; // module-level: one batch at a time, process-wide

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function safeFileNameFragment(name) {
  const cleaned = String(name || 'brochure').trim().toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.slice(0, 60) || 'brochure';
}

function sanitizeErrorMessage(message) {
  return String(message || 'Unknown error')
    .replace(/https?:\/\/\S+/gi, '[url-redacted]')
    .slice(0, 300);
}

function blankMigrationState() {
  return {
    status: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    completedAt: null,
    error: null,
    originalUrl: null,
    storageUrl: null,
    storageKey: null,
    size: null
  };
}

function readFirstBytes(stream, byteCount) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;
    const cleanup = () => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      cleanup();
      fn(value);
    };
    const onData = (chunk) => {
      const needed = byteCount - total;
      chunks.push(chunk.subarray(0, needed));
      total += Math.min(chunk.length, needed);
      if (total >= byteCount) {
        finish(resolve, Buffer.concat(chunks, total));
        stream.destroy();
      }
    };
    const onEnd = () => finish(resolve, Buffer.concat(chunks, total));
    const onError = (error) => finish(reject, error);
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}

class BrochureMigrationService {
  constructor(repository) {
    this.repo = repository;
  }

  _all(db) {
    db.BuilderProjects = db.BuilderProjects || [];
    return db.BuilderProjects;
  }

  _storageKeyFor(project) {
    const name = safeFileNameFragment(project.ProjectName || project.ProjectID);
    return `builder-projects/${project.ProjectID}/brochures/migrated-${name}.pdf`;
  }

  _isEligible(project) {
    if (!project || project.Active === false) return false;
    if (!project.BrochureUrl) return false;
    const mig = project.BrochureMigration;
    if (mig && mig.status === 'success') return false;
    return true;
  }

  // ── Stats (for admin UI / status endpoint) ──────────────────────────────
  getStats() {
    const db = this.repo.read();
    const rows = this._all(db).filter((p) => p.Active !== false && p.BrochureUrl);
    const countByStatus = (status) => rows.filter((p) => (p.BrochureMigration?.status || 'pending') === status).length;
    const successful = countByStatus('success');
    const failed = countByStatus('failed');
    const processing = countByStatus('processing');
    const totalEligible = rows.length;
    const pending = Math.max(totalEligible - successful - failed - processing, 0);
    const remaining = rows.filter((p) => this._isEligible(p)).length;
    return {
      ok: true,
      data: { totalEligible, pending, processing, successful, failed, skipped: 0, remaining }
    };
  }

  listRecentRuns(limit = 20) {
    const db = this.repo.read();
    const runs = (db._BrochureMigrationRuns || []).slice(0, Math.max(1, Number(limit) || 20));
    return { ok: true, data: runs };
  }

  // ── Batch execution ──────────────────────────────────────────────────────
  async runBatch({ batchSize = DEFAULT_BATCH_SIZE, userId = 'system', onlyFailed = false, projectId = null, timeoutMs = MIGRATION_TIMEOUT_MS } = {}) {
    const size = Math.max(1, Math.min(Number(batchSize) || DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE));
    const perProjectTimeoutMs = Math.max(1, Number(timeoutMs) || MIGRATION_TIMEOUT_MS);

    if (migrationLock) {
      return { ok: false, statusCode: 409, error: 'A brochure migration batch is already running. Try again shortly.' };
    }
    migrationLock = true;
    console.log('[migration] batch started');

    try {
      const db = this.repo.read();
      const all = this._all(db);
      let targets;

      if (projectId) {
        // Targeted single-project canary mode — never falls back to
        // candidates.slice(0, size); only the exact requested project runs.
        const project = all.find((p) => p.ProjectID === projectId);
        if (!project) {
          return { ok: false, statusCode: 404, error: `Project not found: ${projectId}` };
        }
        if (project.Active === false) {
          return { ok: false, statusCode: 400, error: `Project is inactive: ${projectId}` };
        }
        if (!project.BrochureUrl) {
          return { ok: false, statusCode: 400, error: `Project has no external BrochureUrl: ${projectId}` };
        }
        if (project.BrochureMigration?.status === 'success') {
          const remaining = all.filter((p) => this._isEligible(p)).length;
          const batchResult = {
            batchSize: 1, processed: 0, successful: 0, failed: 0, skipped: 1,
            remaining, results: [{ projectId, status: 'skipped', note: 'already migrated' }],
            runAt: new Date().toISOString(), runBy: userId
          };
          return { ok: true, data: batchResult };
        }
        targets = [project];
      } else {
        const candidates = all.filter((p) => (onlyFailed
          ? (p.Active !== false && p.BrochureUrl && p.BrochureMigration?.status === 'failed')
          : this._isEligible(p)));
        targets = candidates.slice(0, size);
      }

      const results = [];

      for (const project of targets) {
        project.BrochureMigration = project.BrochureMigration || blankMigrationState();
        const mig = project.BrochureMigration;
        mig.status = 'processing';
        mig.attempts = (mig.attempts || 0) + 1;
        mig.lastAttemptAt = new Date().toISOString();
        mig.originalUrl = project.BrochureUrl;

        let result;
        const guard = { cancelled: false };
        try {
          result = await withTimeout(
            this._migrateOne(project, userId, guard),
            perProjectTimeoutMs,
            `Migration timed out after ${perProjectTimeoutMs}ms`
          );
        } catch (error) {
          guard.cancelled = true; // veto any late commit from the abandoned run
          mig.status = 'failed';
          mig.error = sanitizeErrorMessage(error.message);
          console.log(`[migration] project=${project.ProjectID} stage=timeout-or-error error=${mig.error}`);
          result = { projectId: project.ProjectID, status: 'failed', error: mig.error };
        }
        results.push(result);
        console.log(`[migration] project=${project.ProjectID} status=${result.status}${result.error ? ` reason=${result.error}` : ''}`);
      }

      const successful = results.filter((r) => r.status === 'success').length;
      const failed = results.filter((r) => r.status === 'failed').length;
      const remaining = all.filter((p) => this._isEligible(p)).length;

      const batchResult = {
        batchSize: projectId ? targets.length : size,
        processed: results.length,
        successful,
        failed,
        skipped: 0,
        remaining,
        results,
        runAt: new Date().toISOString(),
        runBy: userId
      };

      db._BrochureMigrationRuns = db._BrochureMigrationRuns || [];
      db._BrochureMigrationRuns.unshift(batchResult);
      db._BrochureMigrationRuns = db._BrochureMigrationRuns.slice(0, MAX_RUN_HISTORY);

      console.log(`[migration] batch stage=persistence-start processed=${batchResult.processed}`);
      this.repo.write(db);
      console.log(`[migration] batch stage=persistence-queued processed=${batchResult.processed}`);

      // Verify persistence by reading the projects back (requirement #9).
      const verifyDb = this.repo.read();
      const verifyRows = this._all(verifyDb);
      for (const r of results) {
        const row = verifyRows.find((p) => p.ProjectID === r.projectId);
        r.persisted = r.status === 'success'
          ? !!(row && row.BrochureMigration?.status === 'success' && (row.Brochures || []).some((b) => b.Source === 'migration'))
          : !!(row && row.BrochureMigration?.status === 'failed');
      }

      console.log(`[migration] batch complete processed=${batchResult.processed} successful=${batchResult.successful} failed=${batchResult.failed} remaining=${batchResult.remaining}`);
      return { ok: true, data: batchResult };
    } finally {
      migrationLock = false;
    }
  }

  async retryFailed({ batchSize = DEFAULT_BATCH_SIZE, userId = 'system' } = {}) {
    return this.runBatch({ batchSize, userId, onlyFailed: true });
  }

  // ── Per-project migration ────────────────────────────────────────────────
  // `guard` lets a timed-out caller veto the final commit: Promise.race cannot
  // cancel in-flight work, so a late completion must not mutate project state.
  async _migrateOne(project, userId, guard = { cancelled: false }) {
    const projectId = project.ProjectID;
    const startedAt = Date.now();
    const originalUrl = project.BrochureUrl;
    const mig = project.BrochureMigration;
    const storageKey = this._storageKeyFor(project);

    // Idempotent short-circuit: this exact key is already a verified migration.
    const existingEntry = (project.Brochures || []).find((b) => b.StoragePath === storageKey && b.Source === 'migration');
    if (existingEntry && mig.status === 'success') {
      return { projectId, status: 'success', storageKey, size: existingEntry.Size || null, note: 'already migrated' };
    }

    let download;
    console.log(`[migration] project=${projectId} stage=download-start`);
    try {
      download = await downloader.openPdfStreamSafely(originalUrl, { timeoutMs: DOWNLOAD_TIMEOUT_MS, maxBytes: MAX_PDF_BYTES });
    } catch (e) {
      download = { ok: false, error: e.message };
    }
    if (!download.ok) {
      console.log(`[migration] project=${projectId} stage=download-failed elapsedMs=${Date.now() - startedAt}`);
      mig.status = 'failed';
      mig.error = sanitizeErrorMessage(download.error);
      return { projectId, status: 'failed', error: mig.error };
    }
    console.log(`[migration] project=${projectId} stage=download-ready elapsedMs=${Date.now() - startedAt}`);

    let uploadResult;
    console.log(`[migration] project=${projectId} stage=upload-start elapsedMs=${Date.now() - startedAt}`);
    try {
      uploadResult = await objectStorage.putObjectStream(storageKey, download.stream, 'application/pdf');
    } catch (e) {
      console.log(`[migration] project=${projectId} stage=upload-failed elapsedMs=${Date.now() - startedAt}`);
      mig.status = 'failed';
      mig.error = sanitizeErrorMessage(`Upload failed: ${e.message}`);
      return { projectId, status: 'failed', error: mig.error };
    }
    console.log(`[migration] project=${projectId} stage=upload-ready elapsedMs=${Date.now() - startedAt}`);

    // Verify without materializing the whole stored PDF back into memory.
    let stored;
    const downloadedSize = typeof download.getSize === 'function' ? download.getSize() : uploadResult.size;
    console.log(`[migration] project=${projectId} stage=verification-start elapsedMs=${Date.now() - startedAt}`);
    try {
      stored = await objectStorage.getObjectInfo(uploadResult.path);
      const storedStream = await objectStorage.getObjectStream(uploadResult.path);
      if (!stored || !storedStream) throw new Error('Uploaded object not found');
      const magic = await readFirstBytes(storedStream.stream, 5);
      if (magic.toString('latin1') !== '%PDF-') throw new Error('Uploaded object failed PDF signature validation');
    } catch (e) {
      console.log(`[migration] project=${projectId} stage=verification-failed elapsedMs=${Date.now() - startedAt}`);
      try { await objectStorage.deleteObject(uploadResult.path); } catch (_) {}
      mig.status = 'failed';
      mig.error = sanitizeErrorMessage(`Verification failed: ${e.message}`);
      return { projectId, status: 'failed', error: mig.error };
    }
    const verifiedOk = stored && stored.size > 0 && stored.size === downloadedSize;
    if (!verifiedOk) {
      console.log(`[migration] project=${projectId} stage=verification-invalid elapsedMs=${Date.now() - startedAt}`);
      try { await objectStorage.deleteObject(uploadResult.path); } catch (_) {}
      mig.status = 'failed';
      mig.error = 'Uploaded object failed verification (size/signature mismatch)';
      return { projectId, status: 'failed', error: mig.error };
    }
    console.log(`[migration] project=${projectId} stage=verification-ready elapsedMs=${Date.now() - startedAt}`);

    // ONLY after verification: append Brochures[] entry + flip migration state.
    // BrochureUrl is intentionally left untouched (fallback source-of-truth).
    if (guard.cancelled) {
      console.log(`[migration] project=${projectId} stage=cancelled-before-commit elapsedMs=${Date.now() - startedAt}`);
      try { await objectStorage.deleteObject(uploadResult.path); } catch (_) {}
      return { projectId, status: 'failed', error: 'Migration cancelled after timeout' };
    }

    const mediaId = this.repo.createId('MED');
    const storageUrl = `/api/v2/builder-projects/media/${mediaId}`;
    project.Brochures = Array.isArray(project.Brochures) ? project.Brochures : [];
    project.Brochures = project.Brochures.filter((b) => b.StoragePath !== storageKey); // replace prior attempt, no duplicates
    project.Brochures.push({
      MediaID: mediaId,
      Filename: `${project.ProjectName || projectId} brochure.pdf`,
      StoragePath: uploadResult.path,
      Url: storageUrl,
      Size: stored.size,
      OriginalUrl: originalUrl,
      Source: 'migration',
      UploadedAt: new Date().toISOString(),
      UploadedBy: userId
    });

    mig.status = 'success';
    mig.error = null;
    mig.storageUrl = storageUrl;
    mig.storageKey = uploadResult.path;
    mig.size = stored.size;
    mig.completedAt = new Date().toISOString();
    project.UpdatedAt = new Date().toISOString();
    console.log(`[migration] project=${projectId} stage=ready-to-persist elapsedMs=${Date.now() - startedAt}`);

    return { projectId, status: 'success', storageKey: uploadResult.path, storageUrl, size: stored.size };
  }
}

module.exports = { BrochureMigrationService, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE, MIGRATION_TIMEOUT_MS };
