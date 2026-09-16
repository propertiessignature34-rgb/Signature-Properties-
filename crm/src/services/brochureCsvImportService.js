'use strict';

const { parse: csvParse } = require('csv-parse/sync');
const { ProjectMediaCanaryMigrationService } = require('./projectMediaCanaryMigrationService');

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const REQUIRED_COLUMNS = ['ProjectID', 'ProjectName', 'BrochureURL'];

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function makeErrorReport(rows = []) {
  const failed = rows.filter((row) => row.status === 'INVALID' || row.status === 'FAILED');
  const header = ['Row', 'ProjectID', 'ProjectName', 'BrochureURL', 'Status', 'Error'];
  const lines = [header.join(',')];
  for (const row of failed) {
    lines.push([
      row.rowNumber,
      row.ProjectID,
      row.ProjectName,
      row.BrochureURL,
      row.status,
      row.error || (Array.isArray(row.errors) ? row.errors.join('; ') : '')
    ].map(csvEscape).join(','));
  }
  return lines.join('\n');
}

class BrochureCsvImportService {
  constructor(repository, deps = {}) {
    this.repo = repository;
    this.importer = deps.importer || new ProjectMediaCanaryMigrationService(repository, deps.importerDeps);
  }

  _projectsById() {
    const db = this.repo.read();
    return new Map((Array.isArray(db.BuilderProjects) ? db.BuilderProjects : [])
      .filter((project) => project && project.ProjectID)
      .map((project) => [String(project.ProjectID), project]));
  }

  _parse(buffer, filename = 'brochure-import.csv') {
    if (!Buffer.isBuffer(buffer)) {
      return { ok: false, statusCode: 400, error: 'CSV content must be a buffer' };
    }
    if (buffer.length > MAX_CSV_BYTES) {
      return { ok: false, statusCode: 400, error: `CSV exceeds maximum size of ${MAX_CSV_BYTES} bytes` };
    }
    if (!/\.csv$/i.test(String(filename || ''))) {
      return { ok: false, statusCode: 400, error: 'Only .csv files are supported' };
    }

    let records;
    try {
      records = csvParse(buffer.toString('utf8'), {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: false,
        trim: true
      });
    } catch (error) {
      return { ok: false, statusCode: 400, error: `Invalid CSV: ${error.message}` };
    }
    if (!records.length) {
      return { ok: false, statusCode: 400, error: 'CSV is empty' };
    }

    const header = records[0].map((value) => String(value || '').trim());
    const normalized = new Map();
    for (let index = 0; index < header.length; index += 1) {
      const key = normalizeHeader(header[index]);
      if (!key || normalized.has(key)) {
        return { ok: false, statusCode: 400, error: `Duplicate or empty CSV header at column ${index + 1}` };
      }
      normalized.set(key, index);
    }
    const missingColumns = REQUIRED_COLUMNS.filter((column) => !normalized.has(normalizeHeader(column)));
    if (missingColumns.length) {
      return { ok: false, statusCode: 400, error: `Missing required CSV column(s): ${missingColumns.join(', ')}` };
    }

    const rows = records.slice(1).map((values, index) => ({
      rowNumber: index + 2,
      ProjectID: String(values[normalized.get('projectid')] || '').trim(),
      ProjectName: String(values[normalized.get('projectname')] || '').trim(),
      BrochureURL: String(values[normalized.get('brochureurl')] || '').trim()
    }));
    return { ok: true, filename, rows };
  }

  _validate(parsedRows) {
    const projectsById = this._projectsById();
    const occurrences = new Map();
    for (const row of parsedRows) {
      if (row.ProjectID) occurrences.set(row.ProjectID, (occurrences.get(row.ProjectID) || 0) + 1);
    }

    return parsedRows.map((row) => {
      const errors = [];
      if (!row.ProjectID) {
        errors.push('ProjectID is required');
      } else if (!projectsById.has(row.ProjectID)) {
        errors.push(`ProjectID not found: ${row.ProjectID}`);
      }
      if (row.ProjectID && occurrences.get(row.ProjectID) > 1) {
        errors.push(`Duplicate ProjectID: ${row.ProjectID}`);
      }
      if (!row.BrochureURL) {
        errors.push('BrochureURL is required');
      } else {
        try {
          const parsedUrl = new URL(row.BrochureURL);
          if (parsedUrl.protocol !== 'https:') errors.push('BrochureURL must be an HTTPS URL');
          if (!parsedUrl.hostname) errors.push('BrochureURL host is required');
        } catch (_) {
          errors.push('BrochureURL is invalid');
        }
      }

      return {
        ...row,
        status: errors.length ? 'INVALID' : 'VALID',
        errors
      };
    });
  }

  preview(buffer, filename = 'brochure-import.csv') {
    const parsed = this._parse(buffer, filename);
    if (!parsed.ok) return parsed;
    const rows = this._validate(parsed.rows);
    const validCount = rows.filter((row) => row.status === 'VALID').length;
    const invalidCount = rows.length - validCount;
    return {
      ok: true,
      data: {
        filename: parsed.filename,
        totalRows: rows.length,
        validCount,
        invalidCount,
        rows,
        errorReport: makeErrorReport(rows)
      }
    };
  }

  async importCsv(buffer, filename = 'brochure-import.csv', { userId = 'system', confirmed = false } = {}) {
    if (confirmed !== true) {
      return { ok: false, statusCode: 400, error: 'Explicit admin confirmation is required before import' };
    }
    const preview = this.preview(buffer, filename);
    if (!preview.ok) return preview;

    const rows = [];
    for (const row of preview.data.rows) {
      if (row.status !== 'VALID') {
        rows.push({ ...row });
        continue;
      }

      try {
        const result = await this.importer.importExplicitBrochure({
          projectId: row.ProjectID,
          brochureUrl: row.BrochureURL,
          userId,
          source: 'manual-csv'
        });
        if (result.ok) {
          rows.push({
            ...row,
            status: result.data?.idempotent ? 'IDEMPOTENT' : 'SUCCESS',
            errors: [],
            result: result.data
          });
        } else {
          rows.push({
            ...row,
            status: 'FAILED',
            errors: [],
            error: result.data?.failure || result.error || 'Brochure import failed',
            result: result.data || null
          });
        }
      } catch (error) {
        rows.push({
          ...row,
          status: 'FAILED',
          errors: [],
          error: String(error.message || error).slice(0, 320)
        });
      }
    }

    const successCount = rows.filter((row) => row.status === 'SUCCESS').length;
    const idempotentCount = rows.filter((row) => row.status === 'IDEMPOTENT').length;
    const failedCount = rows.filter((row) => row.status === 'FAILED').length;
    const invalidCount = rows.filter((row) => row.status === 'INVALID').length;
    return {
      ok: true,
      data: {
        filename: preview.data.filename,
        totalRows: rows.length,
        processedRows: successCount + idempotentCount + failedCount,
        successCount,
        idempotentCount,
        failedCount,
        invalidCount,
        rows,
        errorReport: makeErrorReport(rows)
      }
    };
  }
}

module.exports = {
  BrochureCsvImportService,
  MAX_CSV_BYTES,
  makeErrorReport
};