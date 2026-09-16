'use strict';

/**
 * ShortlistServiceV2 — property-level shortlist per requirement.
 *
 * Backed by the existing `Shortlists` collection in the JSON repository, but
 * does NOT require a pre-existing Match record (SmartMatch V2 scores live and
 * does not persist Match rows). We accept the SmartMatch score / level and
 * notes at add-time, and keep the record around even if the requirement or
 * property gets updated later.
 */
class ShortlistServiceV2 {
  constructor(repository) {
    this.repo = repository;
  }

  _now() {
    return new Date().toISOString();
  }

  _validPriority(p) {
    const v = String(p || 'Medium');
    return ['High', 'Medium', 'Low'].includes(v) ? v : 'Medium';
  }

  _findActive(requirementId, propertyId) {
    const db = this.repo.read();
    db.Shortlists = db.Shortlists || [];
    return db.Shortlists.find(
      (s) =>
        s.RequirementID === requirementId &&
        s.PropertyID === propertyId &&
        s.Status === 'Active'
    ) || null;
  }

  _propertySnapshot(prop) {
    if (!prop) return {};
    return {
      Title: prop.Title || prop.Project || prop.PropertyType || null,
      Category: prop.Category || null,
      SubCategory: prop.SubCategory || null,
      Location1: prop.Location1 || prop.Location || prop.City || null,
      SocietyName: prop.SocietyName || null,
      AskingPrice: prop.AskingPrice ?? prop.Price ?? null,
      AskingRatePerSqFt: prop.AskingRatePerSqFt ?? null,
      CarpetArea: prop.CarpetArea ?? prop.Area ?? null,
      BHK: prop.BHK ?? null,
      FurnishingType: prop.FurnishingType || null,
      InventorySource: prop.InventorySource || null,
      ListingFor: prop.ListingFor || null,
      Status: prop.Status || null,
      PhotoUrl: (prop.Photos && prop.Photos[0]?.url) || null,
      IsReraMaster: !!prop.IsReraMaster,
      RERANumber: prop.RERANumber || null,
      ProjectName: prop.ProjectName || null,
      BuilderName: prop.BuilderName || null
    };
  }

  buildView(row) {
    const req = this.repo.readRequirement(row.RequirementID);
    const prop = this.repo.find('Inventory', 'PropertyID', row.PropertyID);
    return {
      ShortlistID: row.ShortlistID,
      RequirementID: row.RequirementID,
      PropertyID: row.PropertyID,
      LeadID: row.LeadID,
      Status: row.Status,
      Priority: row.Priority,
      Notes: row.Notes || '',
      MatchScore: row.MatchScore ?? null,
      MatchLevel: row.MatchLevel || null,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt,
      RequirementCode: req?.RequirementCode || row.RequirementID,
      Property: this._propertySnapshot(prop)
    };
  }

  list(requirementId, { status = 'Active' } = {}) {
    const db = this.repo.read();
    db.Shortlists = db.Shortlists || [];
    const rows = db.Shortlists
      .filter((s) => s.RequirementID === requirementId && (!status || s.Status === status))
      .sort((a, b) => new Date(b.CreatedAt || 0) - new Date(a.CreatedAt || 0));
    return rows.map((r) => this.buildView(r));
  }

  add(requirementId, payload = {}) {
    const propertyId = payload.propertyId || payload.PropertyID;
    if (!requirementId) return { ok: false, error: 'requirementId required' };
    if (!propertyId) return { ok: false, error: 'propertyId required' };

    const req = this.repo.readRequirement(requirementId);
    if (!req) return { ok: false, error: 'Requirement not found' };

    const prop = this.repo.find('Inventory', 'PropertyID', propertyId);
    if (!prop) return { ok: false, error: 'Property not found' };

    // Reactivate an existing Removed row if the same combo comes back
    const db = this.repo.read();
    db.Shortlists = db.Shortlists || [];
    const existingActive = this._findActive(requirementId, propertyId);
    if (existingActive) {
      // Merge notes / priority / score if provided
      const changes = { UpdatedAt: this._now() };
      if (payload.notes !== undefined) changes.Notes = String(payload.notes || '');
      if (payload.priority !== undefined) changes.Priority = this._validPriority(payload.priority);
      if (payload.matchScore !== undefined) changes.MatchScore = Number(payload.matchScore);
      if (payload.matchLevel !== undefined) changes.MatchLevel = String(payload.matchLevel || '');
      const idx = db.Shortlists.findIndex((s) => s.ShortlistID === existingActive.ShortlistID);
      db.Shortlists[idx] = { ...existingActive, ...changes };
      this.repo.write(db);
      return { ok: true, alreadyShortlisted: true, data: this.buildView(db.Shortlists[idx]) };
    }

    const row = {
      ShortlistID: this.repo.createId('SL'),
      RequirementID: requirementId,
      LeadID: req.LeadID,
      PropertyID: propertyId,
      MatchID: null,
      Status: 'Active',
      Priority: this._validPriority(payload.priority),
      Notes: String(payload.notes || ''),
      MatchScore: payload.matchScore != null ? Number(payload.matchScore) : null,
      MatchLevel: payload.matchLevel ? String(payload.matchLevel) : null,
      CreatedBy: payload.createdBy || 'system',
      RemovedAt: null,
      RemovedBy: null,
      CreatedAt: this._now(),
      UpdatedAt: this._now()
    };

    db.Shortlists.push(row);
    this.repo.write(db);
    try {
      this.repo.addTimelineEntry(row.LeadID, 'Shortlist', row.ShortlistID, 'SHORTLISTED', 'Property shortlisted', row);
    } catch (_) { /* non-fatal */ }
    return { ok: true, alreadyShortlisted: false, data: this.buildView(row) };
  }

  remove(requirementId, propertyId, removedBy = 'system') {
    const existing = this._findActive(requirementId, propertyId);
    if (!existing) return { ok: false, error: 'Shortlist entry not found' };
    const updated = this.repo.updateShortlist(existing.ShortlistID, {
      Status: 'Removed',
      RemovedAt: this._now(),
      RemovedBy: removedBy
    });
    return { ok: true, data: this.buildView(updated) };
  }

  updateNotes(requirementId, propertyId, notes) {
    const existing = this._findActive(requirementId, propertyId);
    if (!existing) return { ok: false, error: 'Shortlist entry not found' };
    const updated = this.repo.updateShortlist(existing.ShortlistID, {
      Notes: String(notes || '')
    });
    return { ok: true, data: this.buildView(updated) };
  }

  updateEntry(requirementId, propertyId, changes = {}) {
    const existing = this._findActive(requirementId, propertyId);
    if (!existing) return { ok: false, error: 'Shortlist entry not found' };
    const patch = {};
    if (changes.notes !== undefined) patch.Notes = String(changes.notes || '');
    if (changes.priority !== undefined) patch.Priority = this._validPriority(changes.priority);
    const updated = this.repo.updateShortlist(existing.ShortlistID, patch);
    return { ok: true, data: this.buildView(updated) };
  }
}

module.exports = { ShortlistServiceV2 };
