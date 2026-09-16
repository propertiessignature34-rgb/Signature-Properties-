/**
 * Google Sheets Sync Service
 *
 * Handles incoming webhooks from a Google Apps Script attached to a broker's
 * lead sheet. Each row-add/update event on the sheet POSTs to:
 *
 *   POST /api/sync/google-sheet
 *   Headers: X-Sync-Token: <shared secret>
 *   Body: {
 *     tab: 'Comm' | 'Sale' | 'Rent',
 *     rows: [ { <sheet-column-name>: <value>, ... } ]
 *   }
 *
 * Match strategy: existing lead is matched by normalised Phone.
 *   - If found → UPDATE the lead + add/update the requirement
 *   - If not   → CREATE a new lead + transaction + requirement
 *
 * Legacy IDs from the sheet (LEAD-0030, RENT-0003, SALE-0001) are preserved
 * in the `LegacyID` field of the lead.
 */

const { normalisePhoneKey } = require('./_phoneUtils');
const { parse } = require('csv-parse/sync');

const DEFAULT_PUBLIC_SHEET_ID = '1nkjzrMRDCMoWFnzxxovvxu-fzILv6Li-VfBY4VLr-QI';
const DEFAULT_PUBLIC_SHEET_TABS = {
  Comm: '1338146659',
  Sale: '606119692',
  Rent: '0'
};

// Column → V2 field mapping (single source of truth)
const COLUMN_MAP = {
  'Lead ID':               { field: 'LegacyID',           on: 'lead' },
  'Date':                  { field: 'CreatedAt',          on: 'lead',   parse: 'date' },
  'Name':                  { field: 'ClientName',         on: 'lead' },
  'Phone':                 { field: 'PrimaryMobile',      on: 'lead',   parse: 'phone' },
  'Email':                 { field: 'Email',              on: 'lead' },
  'Source':                { field: 'LeadSource',         on: 'lead' },
  'Client Type':           { field: 'ClientType',         on: 'lead' },
  'Assigned To':           { field: 'AssignedAgentID',    on: 'lead' },
  'Priority':              { field: 'Priority',           on: 'lead' },
  'Status':                { field: 'ClientStatus',       on: 'lead' },
  'Lead Score':            { field: 'ClientScore',        on: 'lead',   parse: 'number' },
  'Created By':            { field: 'CreatedBy',          on: 'lead' },

  // Transaction level
  'Transaction Type':      { field: 'TransactionType',    on: 'txn' },
  'Property Type':         { field: 'Category',           on: 'txn' },
  'Deal Type':             { field: 'DealType',           on: 'txn' },
  'Deal Value':            { field: 'DealValue',          on: 'txn',    parse: 'number' },
  'Token/Advance Amount':  { field: 'TokenAmount',        on: 'txn',    parse: 'number' },
  'Lost Reason':           { field: 'LostReason',         on: 'txn' },
  'Expected Close Date':   { field: 'ExpectedCloseDate',  on: 'txn',    parse: 'date' },

  // Requirement level
  'Budget':                { field: 'BudgetMax',          on: 'req',    parse: 'budget' },
  'Preferred Location':    { field: 'Location1',          on: 'req' },
  'BHK/Size':              { field: 'BHK',                on: 'req' },
  'Purpose':               { field: 'Purpose',            on: 'req' },
  'Furnishing':            { field: 'FurnishingType',     on: 'req' },
  'Possession Timeline':   { field: 'Possession',         on: 'req' },
  'Requirement':           { field: 'Preferences',        on: 'req' },
  'Specific Preference/Notes': { field: 'Preferences2',   on: 'req' },
  'Nature of Business':    { field: 'NatureOfBusiness',   on: 'req' },
  'Cabins':                { field: 'Cabins',             on: 'req',    parse: 'number' },
  'Workstations':          { field: 'Workstations',       on: 'req',    parse: 'number' },
  'Power Load':            { field: 'PowerLoadKVA',       on: 'req',    parse: 'number' },
  'Ceiling Height':        { field: 'CeilingHeightComm',  on: 'req',    parse: 'number' },
  'Shortlist 1':           { field: 'Shortlist1',         on: 'req' },
  'Shortlist 2':           { field: 'Shortlist2',         on: 'req' },
  'Shortlist 3':           { field: 'Shortlist3',         on: 'req' },

  // Follow-up level
  'Last Contact Date':     { field: 'LastContact',        on: 'lead',   parse: 'date' },
  'Next Follow-up Date':   { field: 'NextFollowUp',       on: 'lead',   parse: 'date' },
  'Site Visit Date':       { field: 'SiteVisitDate',      on: 'lead',   parse: 'date' },
  'Follow-up Status':      { field: 'FollowUpStatus',     on: 'lead' },
  'Remarks':               { field: 'Notes',              on: 'lead' }
};

// Tab → default TransactionType map (fallback if row doesn't have it)
const TAB_TXN_MAP = {
  'Comm':  'Rent',        // Commercial tab — mostly rent office/shop
  'Rent':  'Rent',
  'Sale':  'Purchase',
  'Purchase': 'Purchase'
};

// Tab → default Category map
const TAB_CATEGORY_MAP = {
  'Comm': 'Commercial',
  'Rent': 'Residential',   // Rent tab typically residential unless specified
  'Sale': 'Residential'    // Sale tab typically residential unless specified
};

function parseValue(raw, parse) {
  if (raw == null || raw === '' || raw === 'None' || raw === 'null') return null;
  const s = String(raw).trim();
  if (!s) return null;
  switch (parse) {
    case 'phone': {
      // Normalize to +91 XXXXX XXXXX
      const digits = s.replace(/\D/g, '');
      if (digits.length === 10) return `+91 ${digits.slice(0,5)} ${digits.slice(5)}`;
      if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2,7)} ${digits.slice(7)}`;
      return s;
    }
    case 'number': {
      const n = Number(s.replace(/[^\d.-]/g, ''));
      return isNaN(n) ? null : n;
    }
    case 'budget': {
      // Parse Indian shorthand: "2 Cr" → 20000000, "2L" → 200000, "50000" → 50000, "1.3" → 13000000 (assume Cr for <100)
      const trimmed = s.replace(/,/g, '').trim().toLowerCase();
      const numMatch = trimmed.match(/([\d.]+)\s*(cr|crore|l|lac|lakh|k|thousand)?/);
      if (!numMatch) return null;
      const n = parseFloat(numMatch[1]);
      const unit = numMatch[2] || '';
      if (unit.includes('cr') || unit.includes('crore')) return Math.round(n * 10000000);
      if (unit.includes('l') || unit.includes('lac') || unit.includes('lakh')) return Math.round(n * 100000);
      if (unit.includes('k') || unit.includes('thousand')) return Math.round(n * 1000);
      // Bare number: heuristic - if <= 100, treat as Cr; if <= 10000 treat as L; else raw
      if (n <= 20 && n >= 0.1) return Math.round(n * 10000000);           // 2 → 2 Cr
      if (n < 1000 && n > 20)  return Math.round(n * 100000);              // 50 → 50 L
      return Math.round(n);
    }
    case 'date': {
      // Accept: '11/07/2026', '2026-07-11', '2026-07-11 10:00'
      let d;
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s);
      else if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
        const [dd, mm, yyyy] = s.split(/[\/ ]/);
        d = new Date(`${yyyy}-${mm}-${dd}`);
      }
      return d && !isNaN(d.getTime()) ? d.toISOString() : null;
    }
    default: return s;
  }
}

class GoogleSheetSyncService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.syncToken  = options.syncToken || process.env.SHEET_SYNC_TOKEN || 'CHANGE_ME_SECRET';
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.fetchTimeoutMs = Number.isFinite(options.fetchTimeoutMs) && options.fetchTimeoutMs > 0 ? options.fetchTimeoutMs : 15000;
  }

  /**
   * Verify the shared-secret token sent by the Apps Script webhook.
   */
  verifyToken(token) {
    if (!this.syncToken || this.syncToken === 'CHANGE_ME_SECRET') return true; // dev mode
    return String(token || '').trim() === this.syncToken;
  }

  buildFetchFailureMessage(error) {
    const causeCode = String(error?.cause?.code || error?.code || '').trim().toUpperCase();
    if (error?.name === 'AbortError') {
      return `request timed out after ${this.fetchTimeoutMs}ms`;
    }
    if (causeCode === 'ENOTFOUND') {
      return 'could not resolve docs.google.com';
    }
    if (causeCode === 'EAI_AGAIN') {
      return 'DNS lookup for docs.google.com failed';
    }
    return String(error?.message || error || 'unknown fetch error').trim();
  }

  async downloadPublicSheetCsv(sheetId, tab, gid) {
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('fetch is not available in this runtime');
    }
    const exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    const requestOptions = {};
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      requestOptions.signal = AbortSignal.timeout(this.fetchTimeoutMs);
    }
    try {
      const response = await this.fetchImpl(exportUrl, requestOptions);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
      }
      return await response.text();
    } catch (error) {
      throw new Error(`Google Sheet download failed for ${tab}: ${this.buildFetchFailureMessage(error)}`, { cause: error });
    }
  }

  /**
   * Main entry — process an array of rows for a given tab.
   * Returns per-row result.
   */
  async syncRows(tab, rows) {
    const results = [];
    const db = this.repository.read();
    db.Leads         = db.Leads || [];
    db.Transactions  = db.Transactions || [];
    db.Requirements  = db.Requirements || [];
    db._V2Counters   = db._V2Counters || { Lead: 0, Transaction: 0, Requirement: 0 };

    for (const row of rows) {
      try {
        const r = this._syncOneRowInDb(db, tab, row);
        results.push(r);
      } catch (err) {
        results.push({ ok: false, error: err.message, row });
      }
    }
    this.repository.write(db);
    return results;
  }

  async syncPublicSheet(options = {}) {
    const sheetId = String(options.sheetId || process.env.GOOGLE_SHEET_ID || DEFAULT_PUBLIC_SHEET_ID).trim();
    const tabs = options.tabs || DEFAULT_PUBLIC_SHEET_TABS;
    if (!sheetId) throw new Error('Google Sheet ID is required');

    const summary = { ok: true, created: 0, updated: 0, failed: 0, total: 0, tabErrors: [] };
    for (const [tab, gid] of Object.entries(tabs)) {
      let csv;
      try {
        csv = await this.downloadPublicSheetCsv(sheetId, tab, gid);
      } catch (error) {
        summary.ok = false;
        summary.failed += 1;
        summary.tabErrors.push({ tab, error: error.message });
        continue;
      }
      const rows = parse(csv, { columns: true, skip_empty_lines: true, relax_column_count: true })
        .filter((row) => String(row.Phone || '').trim());
      const results = await this.syncRows(tab, rows);
      summary.created += results.filter((row) => row.action === 'CREATED').length;
      summary.updated += results.filter((row) => row.action === 'UPDATED').length;
      summary.failed += results.filter((row) => !row.ok).length;
      summary.total += rows.length;
    }
    return summary;
  }

  _syncOneRow(tab, row) {
    const db = this.repository.read();
    db.Leads         = db.Leads || [];
    db.Transactions  = db.Transactions || [];
    db.Requirements  = db.Requirements || [];
    db._V2Counters   = db._V2Counters || { Lead: 0, Transaction: 0, Requirement: 0 };
    const result = this._syncOneRowInDb(db, tab, row);
    this.repository.write(db);
    return result;
  }

  _syncOneRowInDb(db, tab, row) {
    // 1. Extract data grouped by target entity
    const leadData = {};
    const txnData  = {};
    const reqData  = {};

    for (const [colName, cfg] of Object.entries(COLUMN_MAP)) {
      const raw = row[colName];
      const parsed = parseValue(raw, cfg.parse);
      if (parsed === null || parsed === undefined) continue;
      const targetObj = cfg.on === 'lead' ? leadData : cfg.on === 'txn' ? txnData : reqData;
      targetObj[cfg.field] = parsed;
    }

    if (!leadData.PrimaryMobile) {
      return { ok: false, error: 'Missing Phone', legacyId: leadData.LegacyID };
    }

    // 2. Apply tab-level defaults for txn
    if (!txnData.TransactionType) txnData.TransactionType = TAB_TXN_MAP[tab] || 'Purchase';
    if (!txnData.Category)        txnData.Category        = TAB_CATEGORY_MAP[tab] || 'Residential';

    // 3. Find existing lead by phone
    const phoneKey = normalisePhoneKey(leadData.PrimaryMobile);
    let lead = db.Leads.find(l => normalisePhoneKey(l.PrimaryMobile || l.Phone) === phoneKey);

    let created = false;
    if (!lead) {
      // Create new
      const leadId = leadData.LegacyID
        ? leadData.LegacyID   // preserve sheet ID if provided
        : `L${String(++db._V2Counters.Lead).padStart(6,'0')}`;
      lead = {
        LeadID: leadId,
        LegacyID: leadData.LegacyID || null,
        City: 'Surat',
        AssignedAgentID: 'USR-0001',
        Tags: [],
        Notes: '',
        CreatedAt: leadData.CreatedAt || new Date().toISOString(),
        UpdatedAt: new Date().toISOString(),
        CreatedBy: 'GoogleSheetSync',
        _v2: true,
        _source: `GoogleSheet:${tab}`
      };
      db.Leads.push(lead);
      created = true;
    }

    // Merge lead data (never overwrite LeadID / CreatedAt on update)
    for (const [k, v] of Object.entries(leadData)) {
      if (['LeadID', 'CreatedAt'].includes(k)) continue;
      lead[k] = v;
    }
    lead.UpdatedAt = new Date().toISOString();
    lead._source   = `GoogleSheet:${tab}`;
    // Sheet Status → canonical V2 ClientStatus if not set
    if (leadData.ClientStatus && !['New', 'Contacted', 'Follow-up', 'Qualified', 'Requirement Created', 'Site Visit', 'Negotiation', 'Won', 'Lost'].includes(leadData.ClientStatus)) {
      const map = {
        'Telecalling': 'New',
        'Call Not Received': 'New',
        'Verified': 'Contacted',
        'Lost': 'Lost',
        'Deal Closed': 'Won'
      };
      lead.ClientStatus = map[leadData.ClientStatus] || 'New';
      lead.LeadStatus   = lead.ClientStatus;
    }

    // 4. Upsert transaction (one per lead per source tab)
    let txn = db.Transactions.find(t => t.LeadID === lead.LeadID && t._source === `GoogleSheet:${tab}`);
    if (!txn) {
      const txnId = `T${String(++db._V2Counters.Transaction).padStart(6,'0')}`;
      txn = {
        TransactionID: txnId,
        LeadID: lead.LeadID,
        Status: 'Active',
        PipelineStage: 'New',
        CreatedAt: new Date().toISOString(),
        CreatedBy: 'GoogleSheetSync',
        _v2: true,
        _source: `GoogleSheet:${tab}`
      };
      db.Transactions.push(txn);
    }
    Object.assign(txn, txnData);
    txn.UpdatedAt = new Date().toISOString();

    // 5. Upsert requirement (one per transaction)
    let req = db.Requirements.find(r => r.TransactionID === txn.TransactionID);
    if (!req) {
      const reqId = `R${String(++db._V2Counters.Requirement).padStart(6,'0')}`;
      req = {
        RequirementID: reqId,
        LeadID: lead.LeadID,
        TransactionID: txn.TransactionID,
        TransactionType: txn.TransactionType,
        Category: txn.Category,
        RequirementStatus: 'Active',
        FormVersion: '2.0',
        CreatedAt: new Date().toISOString(),
        CreatedBy: 'GoogleSheetSync',
        _v2: true,
        _source: `GoogleSheet:${tab}`
      };
      db.Requirements.push(req);
    }
    Object.assign(req, reqData);
    req.UpdatedAt = new Date().toISOString();

    return {
      ok: true,
      action: created ? 'CREATED' : 'UPDATED',
      leadId: lead.LeadID,
      legacyId: lead.LegacyID,
      transactionId: txn.TransactionID,
      requirementId: req.RequirementID
    };
  }
}

module.exports = { GoogleSheetSyncService, COLUMN_MAP };
