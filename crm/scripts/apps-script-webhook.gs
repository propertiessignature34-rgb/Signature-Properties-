/**
 * SIGNATURE REALTY CRM — Google Sheet Sync
 * ==========================================
 *
 * SETUP (5 minutes):
 * 1. Open your Google Sheet:
 *    https://docs.google.com/spreadsheets/d/1nkjzrMRDCMoWFnzxxovvxu-fzILv6Li-VfBY4VLr-QI/edit
 * 2. Click:  Extensions → Apps Script
 * 3. Delete the default code and paste THIS ENTIRE FILE
 * 4. The webhook URL below is the live Signature Properties Render service.
 * 5. Click the "Save" (💾) icon
 * 6. Click the ▶️ Run button next to the function "installTriggers"
 *    - Grant permission when prompted (only once)
 * 7. Done! Every new row / edit will auto-sync to CRM within 2 seconds.
 *
 * OPTIONAL — one-time full backfill:
 *   Click ▶️ Run next to "syncAllRows" to push every existing row to CRM.
 */

// ── CONFIG ─────────────────────────────────────────────────────────────
const WEBHOOK_URL = 'https://signature-properties-1.onrender.com/api/sync/google-sheet';
const SYNC_TOKEN = 'CHANGE_ME_SECRET';
const CRM_EXPORT_URL = 'https://signature-properties-1.onrender.com/api/sync/google-sheet/export';

// ── Sheet tabs to watch ───────────────────────────────────────────────
const WATCHED_TABS = ['Comm', 'Sale', 'Rent'];

/** Add the sync buttons to the Google Sheet menu after refresh. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CRM Sync')
    .addItem('Sheet → CRM', 'syncAllRows')
    .addItem('CRM → Sheet', 'syncCrmToSheet')
    .addSeparator()
    .addItem('Install automatic sync', 'installTriggers')
    .addToUi();
}

/**
 * onEdit — fires whenever ANY cell is edited on ANY sheet.
 * We push the entire changed row to CRM.
 * (Simple trigger — no permission dialog needed.)
 */
function onSheetEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const tabName = sheet.getName();
    if (WATCHED_TABS.indexOf(tabName) === -1) return;

    const rowIdx = e.range.getRow();
    if (rowIdx <= 1) return; // header row

    const rowData = _getRowAsObject(sheet, rowIdx);
    if (!rowData) return;

    _postToCrm(tabName, [rowData]);
  } catch (err) {
    Logger.log('onEdit error: ' + err.message);
  }
}

/**
 * Installable onChange trigger — catches row inserts, deletes, formatting.
 * Called from installTriggers().
 */
function onSheetChange(e) {
  try {
    if (!e) return;
    if (e.changeType && ['INSERT_ROW','EDIT','FORMAT','OTHER'].indexOf(e.changeType) === -1) return;

    const ss = SpreadsheetApp.getActive();
    WATCHED_TABS.forEach(function(tabName) {
      const sheet = ss.getSheetByName(tabName);
      if (!sheet) return;
      // Push last row only (INSERT_ROW usually happens at the bottom)
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const rowData = _getRowAsObject(sheet, lastRow);
        if (rowData && rowData['Phone']) _postToCrm(tabName, [rowData]);
      }
    });
  } catch (err) {
    Logger.log('onSheetChange error: ' + err.message);
  }
}

/**
 * Install a permanent trigger — run this ONCE from the Apps Script editor.
 * After installation, edits/inserts sync automatically forever.
 */
function installTriggers() {
  // Remove previous sync triggers so every edit is submitted exactly once.
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (['onSheetChange', 'onSheetEdit', 'onEdit'].indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('onSheetEdit')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  ScriptApp.newTrigger('onSheetChange')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onChange()
    .create();

  SpreadsheetApp.getActive().toast('CRM Sync installed! Every row edit will now sync.', 'Signature Realty', 5);
}

/**
 * One-time full backfill — push every existing row to CRM.
 * Run manually from Apps Script editor.
 */
function syncAllRows() {
  const ss = SpreadsheetApp.getActive();
  let totalSent = 0;
  WATCHED_TABS.forEach(function(tabName) {
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) return;
    const rows = _getAllRowsAsObjects(sheet);
    if (rows.length === 0) return;
    // Send in batches of 50
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50).filter(function(r) { return r['Phone']; });
      if (batch.length) {
        _postToCrm(tabName, batch);
        totalSent += batch.length;
      }
    }
  });
  SpreadsheetApp.getActive().toast('Synced ' + totalSent + ' rows to CRM', 'Signature Realty', 8);
}

/**
 * Pull CRM leads into the Sheet. Existing rows are matched by phone; new
 * CRM leads are appended to the tab selected from their GoogleSheet source.
 */
function syncCrmToSheet() {
  const response = UrlFetchApp.fetch(CRM_EXPORT_URL, { method: 'get', muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('CRM export failed: ' + response.getContentText());
  const payload = JSON.parse(response.getContentText());
  const leads = Array.isArray(payload.data) ? payload.data : [];
  const workbook = SpreadsheetApp.getActive();
  const tabs = { Comm: 'Comm', Sale: 'Sale', Rent: 'Rent' };
  let updated = 0;
  let appended = 0;

  leads.forEach(function(lead) {
    const phone = _phoneKey(lead.PrimaryMobile || lead.Phone);
    if (!phone) return;
    const source = String(lead._source || 'GoogleSheet:Comm');
    const tabName = (source.match(/^GoogleSheet:([^:]+)/) || [])[1] || 'Comm';
    const sheet = workbook.getSheetByName(tabs[tabName] || 'Comm');
    if (!sheet) return;
    const lastColumn = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
    const phoneColumn = headers.indexOf('Phone');
    if (phoneColumn < 0) return;
    const lastRow = sheet.getLastRow();
    const phoneValues = lastRow > 1 ? sheet.getRange(2, phoneColumn + 1, lastRow - 1, 1).getValues() : [];
    let rowNumber = -1;
    phoneValues.some(function(row, index) {
      if (_phoneKey(row[0]) === phone) { rowNumber = index + 2; return true; }
      return false;
    });
    const values = headers.map(function(header) { return _crmValue(header, lead); });
    if (rowNumber === -1) { sheet.appendRow(values); appended++; }
    else { sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]); updated++; }
  });
  SpreadsheetApp.getActive().toast('CRM sync complete: ' + updated + ' updated, ' + appended + ' appended', 'Signature Realty', 8);
}

function _phoneKey(value) {
  return String(value || '').replace(/\D/g, '').replace(/^91/, '').slice(-10);
}

function _crmValue(header, lead) {
  const values = {
    'Lead ID': lead.LegacyID || lead.LeadID,
    'Name': lead.ClientName,
    'Phone': lead.PrimaryMobile || lead.Phone,
    'Email': lead.Email,
    'Source': lead.LeadSource || lead.Source,
    'Status': lead.ClientStatus || lead.LeadStatus,
    'Assigned To': lead.AssignedAgentID,
    'Date': lead.CreatedAt,
    'Remarks': lead.Notes
  };
  return values[header] == null ? '' : values[header];
}

// ── Helpers ───────────────────────────────────────────────────────────

function _getRowAsObject(sheet, rowIdx) {
  const numCols = sheet.getLastColumn();
  if (numCols < 1) return null;
  const headers = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  const values  = sheet.getRange(rowIdx, 1, 1, numCols).getValues()[0];
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim();
    if (!h) continue;
    let v = values[i];
    if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    obj[h] = v === null || v === undefined ? '' : String(v);
  }
  return obj;
}

function _getAllRowsAsObjects(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const data    = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return data.map(function(row) {
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim();
      if (!h) continue;
      let v = row[i];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      obj[h] = v === null || v === undefined ? '' : String(v);
    }
    return obj;
  });
}

function _postToCrm(tab, rows) {
  const payload = { tab: tab, rows: rows };
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Sync-Token': SYNC_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  try {
    const resp = UrlFetchApp.fetch(WEBHOOK_URL, options);
    Logger.log('CRM sync response [' + tab + ' × ' + rows.length + ']: ' + resp.getResponseCode() + ' ' + resp.getContentText().substring(0, 300));
  } catch (err) {
    Logger.log('CRM sync FAILED: ' + err.message);
  }
}
