'use strict';

/**
 * BrokerNetworkV2Service — simple, WhatsApp-driven broker network + share
 * flow. Client PII is NEVER exposed on the broker-facing side. Property
 * responses land as regular Inventory rows with InventorySource=
 * 'NetworkSubmission' + attribution to the submitting broker, and are
 * auto-shortlisted against the requirement.
 */

const crypto = require('crypto');

const SUBMISSION_SOURCE = 'NetworkSubmission';

class BrokerNetworkV2Service {
  constructor(repository) { this.repo = repository; }
  _now() { return new Date().toISOString(); }
  _token() { return crypto.randomBytes(16).toString('base64url'); }

  // ── Broker registry ─────────────────────────────────────────────────────
  listBrokers({ active } = {}) {
    const db = this.repo.read();
    const rows = db.BrokerNetworkContacts || [];
    const filtered = active === undefined ? rows : rows.filter((r) => !!r.Active === active);
    return filtered.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));
  }

  createBroker(payload = {}) {
    const name = String(payload.Name || '').trim();
    const phone = String(payload.Phone || '').trim();
    if (!name) return { ok: false, error: 'Name required' };
    if (!phone) return { ok: false, error: 'Phone required' };
    const db = this.repo.read();
    db.BrokerNetworkContacts = db.BrokerNetworkContacts || [];
    const digits = phone.replace(/\D/g, '');
    if (db.BrokerNetworkContacts.some((b) => (b.Phone || '').replace(/\D/g, '') === digits && b.Active !== false)) {
      return { ok: false, error: 'Broker with this phone already exists' };
    }
    const row = {
      NetworkBrokerID: this.repo.createId('BNB'),
      Name: name, Phone: phone,
      Agency: String(payload.Agency || '').trim() || null,
      TrustLevel: ['High', 'Medium', 'Low'].includes(payload.TrustLevel) ? payload.TrustLevel : 'Medium',
      Specializations: Array.isArray(payload.Specializations) ? payload.Specializations : [],
      Notes: String(payload.Notes || '').trim() || null,
      Active: payload.Active !== false,
      AddedAt: this._now(), UpdatedAt: this._now()
    };
    db.BrokerNetworkContacts.push(row);
    this.repo.write(db);
    return { ok: true, data: row };
  }

  updateBroker(brokerId, patch = {}) {
    const db = this.repo.read();
    db.BrokerNetworkContacts = db.BrokerNetworkContacts || [];
    const idx = db.BrokerNetworkContacts.findIndex((b) => b.NetworkBrokerID === brokerId);
    if (idx < 0) return { ok: false, error: 'Broker not found' };
    const row = db.BrokerNetworkContacts[idx];
    for (const k of ['Name', 'Phone', 'Agency', 'TrustLevel', 'Specializations', 'Notes', 'Active']) {
      if (patch[k] !== undefined) row[k] = patch[k];
    }
    row.UpdatedAt = this._now();
    db.BrokerNetworkContacts[idx] = row;
    this.repo.write(db);
    return { ok: true, data: row };
  }

  deleteBroker(brokerId) {
    const db = this.repo.read();
    db.BrokerNetworkContacts = db.BrokerNetworkContacts || [];
    const before = db.BrokerNetworkContacts.length;
    db.BrokerNetworkContacts = db.BrokerNetworkContacts.filter((b) => b.NetworkBrokerID !== brokerId);
    if (db.BrokerNetworkContacts.length === before) return { ok: false, error: 'Broker not found' };
    this.repo.write(db);
    return { ok: true };
  }

  // ── Anonymized requirement view (whitelist ONLY safe fields) ────────────
  _anonymize(req) {
    const f = req.Fields || {};
    const g = (k) => (f[k] && (f[k].value ?? f[k])) || req[k] || null;
    return {
      RequirementCode: req.RequirementCode || req.RequirementID,
      Category: req.Category || null,
      SubCategory: req.SubCategory || null,
      TransactionType: req.TransactionType || g('TransactionType') || null,
      Location1: g('Location1') || g('Location'),
      Location2: g('Location2') || null,
      BHK: g('BHK') || g('Configuration'),
      BudgetMin: g('BudgetMin') || g('BudgetFrom'),
      BudgetMax: g('BudgetMax') || g('BudgetTo') || g('Budget'),
      CarpetAreaMin: g('CarpetAreaMin'),
      CarpetAreaMax: g('CarpetAreaMax'),
      FurnishingPreference: g('FurnishingType') || g('FurnishingPreference'),
      Purpose: g('Purpose') || g('EndUse'),
      Timeline: g('Timeline') || g('MovingIn'),
      ReadyToMove: g('ReadyToMove'),
      Amenities: g('Amenities')
    };
  }

  share(requirementId, { brokerIds = [], message = '', expiresInDays = 30, userId = 'system' } = {}) {
    const req = this.repo.readRequirement(requirementId);
    if (!req) return { ok: false, error: 'Requirement not found' };
    const db = this.repo.read();
    const brokers = (db.BrokerNetworkContacts || []).filter((b) => brokerIds.includes(b.NetworkBrokerID) && b.Active !== false);
    if (!brokers.length) return { ok: false, error: 'No valid active brokers selected' };
    const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
    db.RequirementShares = db.RequirementShares || [];
    const shares = brokers.map((b) => {
      const token = this._token();
      const share = {
        ShareID: this.repo.createId('SHR'),
        RequirementID: requirementId, LeadID: req.LeadID,
        NetworkBrokerID: b.NetworkBrokerID, BrokerName: b.Name, BrokerPhone: b.Phone,
        Token: token, Message: String(message || '').trim() || null,
        Status: 'Open', SharedBy: userId, SharedAt: this._now(), ExpiresAt: expiresAt,
        FirstViewedAt: null, LastViewedAt: null, ViewCount: 0, ResponseCount: 0
      };
      db.RequirementShares.push(share);
      return share;
    });
    this.repo.write(db);
    return { ok: true, data: { shares, count: shares.length } };
  }

  getPublicShareByToken(token) {
    const db = this.repo.read();
    const share = (db.RequirementShares || []).find((s) => s.Token === token);
    if (!share) return { ok: false, error: 'Share not found', code: 'NOT_FOUND' };
    if (share.Status === 'Revoked') return { ok: false, error: 'Share revoked', code: 'REVOKED' };
    if (new Date(share.ExpiresAt) < new Date()) return { ok: false, error: 'Share expired', code: 'EXPIRED' };
    const req = (db.V2Requirements || db.Requirements || []).find((r) => r.RequirementID === share.RequirementID);
    if (!req) return { ok: false, error: 'Requirement not found', code: 'NOT_FOUND' };
    const idx = db.RequirementShares.findIndex((s) => s.ShareID === share.ShareID);
    if (idx >= 0) {
      const patched = { ...share, LastViewedAt: this._now(), ViewCount: (share.ViewCount || 0) + 1 };
      if (!patched.FirstViewedAt) patched.FirstViewedAt = patched.LastViewedAt;
      db.RequirementShares[idx] = patched;
      this.repo.write(db);
    }
    return {
      ok: true,
      data: {
        Requirement: this._anonymize(req),
        BrokerName: share.BrokerName,
        Message: share.Message,
        SharedAt: share.SharedAt,
        ExpiresAt: share.ExpiresAt
      }
    };
  }

  submitResponse(token, payload = {}) {
    const db = this.repo.read();
    const share = (db.RequirementShares || []).find((s) => s.Token === token);
    if (!share) return { ok: false, error: 'Share not found', code: 'NOT_FOUND' };
    if (share.Status === 'Revoked' || new Date(share.ExpiresAt) < new Date()) {
      return { ok: false, error: 'Share no longer accepting responses', code: 'CLOSED' };
    }
    const req = (db.V2Requirements || db.Requirements || []).find((r) => r.RequirementID === share.RequirementID);
    if (!req) return { ok: false, error: 'Requirement not found', code: 'NOT_FOUND' };
    const title = String(payload.Title || payload.ProjectName || '').trim();
    if (!title) return { ok: false, error: 'Title / Project Name required' };
    const now = this._now();
    const propertyId = this.repo.createId('PROP');
    const cfg = String(payload.BHK || '').trim();
    const propertyRow = {
      PropertyID: propertyId, Title: title,
      Category: req.Category || 'Residential',
      SubCategory: payload.SubCategory || req.SubCategory || 'Flat',
      BHK: cfg || null, Configurations: cfg ? [cfg] : [],
      Location1: String(payload.Location1 || '').trim() || null,
      SocietyName: String(payload.SocietyName || payload.ProjectName || '').trim() || null,
      CarpetArea: Number(payload.CarpetArea) || null,
      Floor: payload.Floor || null, TotalFloors: payload.TotalFloors || null,
      FurnishingType: payload.FurnishingType || null,
      Amenities: Array.isArray(payload.Amenities) ? payload.Amenities : [],
      AskingPrice: Number(payload.AskingPrice) || Number(payload.Price) || null,
      AskingRatePerSqFt: Number(payload.AskingRatePerSqFt) || null,
      ListingFor: req.TransactionType || 'Sale',
      ListingStatus: 'Available',
      InventorySource: SUBMISSION_SOURCE,
      SubmittedByBrokerID: share.NetworkBrokerID,
      SubmittedByBrokerName: share.BrokerName,
      SubmittedByBrokerPhone: share.BrokerPhone,
      NetworkShareID: share.ShareID,
      NetworkResponseID: this.repo.createId('NRSP'),
      ExpectedCommissionSplit: String(payload.ExpectedSplit || '').trim() || null,
      Availability: String(payload.Availability || '').trim() || null,
      Notes: String(payload.Notes || '').trim() || null,
      Photos: Array.isArray(payload.Photos) ? payload.Photos : [],
      VideoUrl: String(payload.VideoUrl || '').trim() || null,
      CreatedAt: now, UpdatedAt: now,
      CreatedBy: `network:${share.NetworkBrokerID}`
    };
    db.Inventory = db.Inventory || [];
    db.Inventory.push(propertyRow);
    db.Shortlists = db.Shortlists || [];
    db.Shortlists.push({
      ShortlistID: this.repo.createId('SL'),
      RequirementID: share.RequirementID, LeadID: share.LeadID,
      PropertyID: propertyId, MatchID: null,
      Status: 'Active', Priority: 'Medium',
      Notes: payload.Notes ? `[Network] ${payload.Notes}` : `[Network] Submitted by ${share.BrokerName}`,
      MatchScore: null, MatchLevel: null,
      NetworkSubmission: true, NetworkShareID: share.ShareID,
      NetworkResponseID: propertyRow.NetworkResponseID,
      SubmittedByBrokerID: share.NetworkBrokerID,
      SubmittedByBrokerName: share.BrokerName,
      CreatedBy: `network:${share.NetworkBrokerID}`,
      RemovedAt: null, RemovedBy: null,
      CreatedAt: now, UpdatedAt: now
    });
    const idx = db.RequirementShares.findIndex((s) => s.ShareID === share.ShareID);
    db.RequirementShares[idx] = { ...share, ResponseCount: (share.ResponseCount || 0) + 1, LastResponseAt: now };
    try {
      this.repo.addTimelineEntry(share.LeadID, 'NetworkResponse', propertyRow.NetworkResponseID, 'NETWORK_PROPERTY_SUBMITTED',
        `Broker ${share.BrokerName} submitted property "${title}"`,
        { PropertyID: propertyId, ShareID: share.ShareID, BrokerID: share.NetworkBrokerID });
    } catch (_) {}
    this.repo.write(db);
    return { ok: true, data: { NetworkResponseID: propertyRow.NetworkResponseID, Received: true, Message: 'Thank you! Your property has been submitted.' } };
  }

  listSharesByRequirement(requirementId) {
    const db = this.repo.read();
    return (db.RequirementShares || [])
      .filter((s) => s.RequirementID === requirementId)
      .sort((a, b) => new Date(b.SharedAt) - new Date(a.SharedAt));
  }

  // ── Admin-facing views (internal, PII visible) ──────────────────────────
  listAllShares({ brokerId } = {}) {
    const db = this.repo.read();
    let shares = (db.RequirementShares || []).slice();
    if (brokerId) shares = shares.filter((s) => s.NetworkBrokerID === brokerId);
    shares = shares.map((s) => {
      const lead = this.repo.readLead(s.LeadID);
      const req = this.repo.readRequirement(s.RequirementID);
      const now = new Date();
      let status = s.Status;
      if (status === 'Open' && new Date(s.ExpiresAt) < now) status = 'Expired';
      return {
        ...s,
        Status: status,
        LeadName: lead?.ClientName || null,
        RequirementCode: req?.RequirementCode || s.RequirementID
      };
    });
    return { ok: true, data: shares.sort((a, b) => new Date(b.SharedAt) - new Date(a.SharedAt)), count: shares.length };
  }

  // ── Commission ledger (network-submitted properties) ───────────────────
  listCommissionLedger() {
    const db = this.repo.read();
    const rows = (db.Inventory || []).filter((p) => p.InventorySource === SUBMISSION_SOURCE);
    const data = rows.map((p) => ({
      PropertyID: p.PropertyID,
      Title: p.Title,
      Location1: p.Location1,
      AskingPrice: p.AskingPrice,
      ListingStatus: p.ListingStatus,
      SubmittedByBrokerID: p.SubmittedByBrokerID,
      SubmittedByBrokerName: p.SubmittedByBrokerName,
      SubmittedByBrokerPhone: p.SubmittedByBrokerPhone,
      ExpectedCommissionSplit: p.ExpectedCommissionSplit,
      ActualCommissionSplit: p.ActualCommissionSplit || null,
      SettlementStatus: p.SettlementStatus || 'Pending',
      CreatedAt: p.CreatedAt
    }));
    return { ok: true, data: data.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt)), count: data.length };
  }

  updateCommissionEntry(propertyId, patch = {}) {
    const db = this.repo.read();
    const idx = (db.Inventory || []).findIndex((p) => p.PropertyID === propertyId && p.InventorySource === SUBMISSION_SOURCE);
    if (idx < 0) return { ok: false, error: 'Network-submitted property not found' };
    const row = db.Inventory[idx];
    if (patch.ActualCommissionSplit !== undefined) row.ActualCommissionSplit = String(patch.ActualCommissionSplit || '').trim() || null;
    if (patch.SettlementStatus !== undefined && ['Pending', 'Paid'].includes(patch.SettlementStatus)) row.SettlementStatus = patch.SettlementStatus;
    row.UpdatedAt = this._now();
    this.repo.write(db);
    return { ok: true, data: row };
  }

  revokeShare(shareId) {
    const db = this.repo.read();
    const idx = (db.RequirementShares || []).findIndex((s) => s.ShareID === shareId);
    if (idx < 0) return { ok: false, error: 'Share not found' };
    db.RequirementShares[idx].Status = 'Revoked';
    db.RequirementShares[idx].UpdatedAt = this._now();
    this.repo.write(db);
    return { ok: true, data: db.RequirementShares[idx] };
  }
}

module.exports = { BrokerNetworkV2Service, SUBMISSION_SOURCE };
