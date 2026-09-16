/**
 * PHASE 2 — Centralized V2 ID Engine
 *
 * Lead:        L000001
 * Transaction: T000001
 * Requirement: R000001
 *
 * Rules:
 * - Server-side only, client cannot control final ID
 * - Immutable once assigned
 * - Counters persisted in the JSON database
 * - Concurrency-safe within single-process Node.js architecture
 * - One centralized service — no duplicate generators elsewhere
 */

'use strict';

const PREFIXES = {
  Lead:        'L',
  Transaction: 'T',
  Requirement: 'R'
};

const PAD = 6; // L000001

/**
 * Format a sequence number as a zero-padded V2 ID.
 */
function formatV2Id(prefix, seq) {
  return `${prefix}${String(seq).padStart(PAD, '0')}`;
}

/**
 * Parse the numeric sequence from a V2 ID such as "L000042" → 42.
 * Returns 0 if not parseable.
 */
function parseV2Seq(id, prefix) {
  if (!id || !String(id).startsWith(prefix)) return 0;
  return parseInt(String(id).slice(prefix.length), 10) || 0;
}

/**
 * IdEngine wraps the repository to provide atomic, persistent V2 ID generation.
 *
 * Usage:
 *   const engine = new IdEngine(repository);
 *   const leadId = engine.nextLeadId();
 */
class IdEngine {
  constructor(repository) {
    if (!repository) throw new Error('IdEngine requires a repository instance');
    this.repository = repository;
  }

  /**
   * Read the current V2 counters from the database.
   * Counters are stored under db._V2Counters = { Lead: N, Transaction: N, Requirement: N }
   */
  _readCounters(db) {
    if (!db._V2Counters || typeof db._V2Counters !== 'object') {
      // Bootstrap from existing records if available
      const leadMax   = Math.max(0, ...(db.Leads || []).map((r) => parseV2Seq(r.LeadID, PREFIXES.Lead)));
      const txnMax    = Math.max(0, ...(db.Transactions || []).map((r) => parseV2Seq(r.TransactionID, PREFIXES.Transaction)));
      const reqMax    = Math.max(0, ...(db.Requirements || []).map((r) => parseV2Seq(r.RequirementID, PREFIXES.Requirement)));
      db._V2Counters  = { Lead: leadMax, Transaction: txnMax, Requirement: reqMax };
    }
    return db._V2Counters;
  }

  /**
   * Atomically increment the counter for `entity` and return the new V2 ID.
   * Performs a synchronous read→modify→write so it is safe within single-process Node.js.
   */
  _next(entity) {
    const prefix = PREFIXES[entity];
    if (!prefix) throw new Error(`Unknown V2 entity: ${entity}`);

    const db = this.repository.read();
    const counters = this._readCounters(db);
    counters[entity] = (counters[entity] || 0) + 1;
    db._V2Counters = counters;
    this.repository.write(db);

    return formatV2Id(prefix, counters[entity]);
  }

  nextLeadId()        { return this._next('Lead'); }
  nextTransactionId() { return this._next('Transaction'); }
  nextRequirementId() { return this._next('Requirement'); }

  /**
   * Check whether an ID is a V2-format ID.
   */
  static isV2LeadId(id)        { return /^L\d{6,}$/.test(String(id || '')); }
  static isV2TransactionId(id) { return /^T\d{6,}$/.test(String(id || '')); }
  static isV2RequirementId(id) { return /^R\d{6,}$/.test(String(id || '')); }
}

module.exports = { IdEngine, PREFIXES, formatV2Id, parseV2Seq };
