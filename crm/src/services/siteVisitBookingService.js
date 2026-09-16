'use strict';

/**
 * SiteVisitBookingService — group multiple properties into ONE visit slot
 * for a single client.
 *
 * Persists into the existing `SiteVisits` collection with a shared
 * `VisitBookingID` linking N rows. Bypasses the strict createSiteVisit
 * validation (which requires a Match record) so it works with SmartMatch V2
 * / Shortlist V2 where Match rows are not persisted.
 */
class SiteVisitBookingService {
  constructor(repository) {
    this.repo = repository;
  }

  _now() { return new Date().toISOString(); }

  _validStatus(s) {
    const v = String(s || 'Scheduled');
    return ['Scheduled', 'Confirmed', 'Rescheduled', 'Completed', 'Cancelled', 'NoShow'].includes(v) ? v : 'Scheduled';
  }

  _propertyBrief(prop) {
    if (!prop) return null;
    return {
      PropertyID: prop.PropertyID,
      Title: prop.Title || prop.Project || prop.PropertyType || prop.PropertyID,
      SubCategory: prop.SubCategory || null,
      Location1: prop.Location1 || prop.Location || prop.City || null,
      SocietyName: prop.SocietyName || null,
      AskingPrice: prop.AskingPrice ?? prop.Price ?? null,
      InventorySource: prop.InventorySource || null,
      ListingFor: prop.ListingFor || null,
      PhotoUrl: (prop.Photos && prop.Photos[0]?.url) || null
    };
  }

  _buildBookingView(bookingId, rows) {
    if (!rows.length) return null;
    const first = rows[0];
    const properties = rows.map((r) => {
      const prop = this.repo.find('Inventory', 'PropertyID', r.PropertyID);
      return {
        VisitID: r.VisitID,
        PropertyID: r.PropertyID,
        Status: r.Status,
        VisitOrder: r.VisitOrder || null,
        ...this._propertyBrief(prop)
      };
    });
    // Booking-level status: if all completed -> Completed; if all cancelled -> Cancelled; else earliest wins
    const statuses = rows.map((r) => r.Status);
    let bookingStatus = 'Scheduled';
    if (statuses.every((s) => s === 'Completed')) bookingStatus = 'Completed';
    else if (statuses.every((s) => s === 'Cancelled')) bookingStatus = 'Cancelled';
    else if (statuses.some((s) => s === 'Confirmed')) bookingStatus = 'Confirmed';
    return {
      VisitBookingID: bookingId,
      LeadID: first.LeadID,
      RequirementID: first.RequirementID,
      ClientName: first.ClientName || null,
      ClientPhone: first.ClientPhone || null,
      VisitDate: first.VisitDate,
      VisitTime: first.VisitTime,
      Duration: first.Duration || null,
      MeetingPoint: first.MeetingPoint || null,
      Notes: first.Notes || '',
      Status: bookingStatus,
      Properties: properties,
      PropertyCount: properties.length,
      CreatedAt: first.CreatedAt,
      UpdatedAt: first.UpdatedAt
    };
  }

  create(payload = {}, actor = {}) {
    const requirementId = payload.requirementId || payload.RequirementID;
    const propertyIds = Array.isArray(payload.propertyIds) ? payload.propertyIds : (Array.isArray(payload.PropertyIDs) ? payload.PropertyIDs : []);
    const visitDate = payload.visitDate || payload.VisitDate;
    const visitTime = payload.visitTime || payload.VisitTime;

    if (!requirementId) return { ok: false, error: 'requirementId required' };
    if (!propertyIds.length) return { ok: false, error: 'At least one propertyId required' };
    if (!visitDate) return { ok: false, error: 'visitDate required (YYYY-MM-DD)' };
    if (!visitTime) return { ok: false, error: 'visitTime required (HH:MM)' };

    const requirement = this.repo.readRequirement(requirementId);
    if (!requirement) return { ok: false, error: 'Requirement not found' };
    const lead = this.repo.readLead(requirement.LeadID);
    if (!lead) return { ok: false, error: 'Lead not found' };

    // Validate all properties exist
    const properties = propertyIds.map((pid) => {
      const p = this.repo.find('Inventory', 'PropertyID', pid);
      return p ? { id: pid, prop: p } : { id: pid, prop: null };
    });
    const missing = properties.filter((x) => !x.prop).map((x) => x.id);
    if (missing.length) return { ok: false, error: `Property not found: ${missing.join(', ')}` };

    const db = this.repo.read();
    db.SiteVisits = db.SiteVisits || [];

    const requestedStatus = this._validStatus(payload.status || payload.Status || 'Scheduled');
    const duplicate = db.SiteVisits.find((row) =>
      row &&
      row.RequirementID === requirementId &&
      propertyIds.includes(row.PropertyID) &&
      row.VisitDate === visitDate &&
      row.VisitTime === visitTime &&
      !['Completed', 'Cancelled'].includes(this._validStatus(row.Status))
    );
    if (duplicate) {
      return { ok: false, error: 'Duplicate active site visit already exists for this requirement/property/date/time', code: 'DUPLICATE_SITE_VISIT' };
    }

    const bookingId = this.repo.createId('BOOK');
    const now = this._now();
    const duration = payload.duration || payload.Duration || '60 mins';
    const meetingPoint = payload.meetingPoint || payload.MeetingPoint || '';
    const notes = payload.notes || payload.Notes || '';
    const assignedAgentId = payload.assignedAgentId || payload.AssignedAgentID || null;
    const clientName = payload.clientName || payload.ClientName || lead.ClientName || null;
    const clientPhone = payload.clientPhone || payload.ClientPhone || lead.PrimaryMobile || lead.Phone || null;

    const rows = properties.map((item, idx) => {
      const visit = {
        VisitID: this.repo.createId('VISIT'),
        VisitBookingID: bookingId,
        VisitOrder: idx + 1,
        LeadID: lead.LeadID,
        TransactionID: requirement.TransactionID || null,
        RequirementID: requirementId,
        PropertyID: item.id,
        MatchID: null,
        ShortlistID: null,
        VisitDate: visitDate,
        VisitTime: visitTime,
        Duration: duration,
        MeetingPoint: meetingPoint,
        AssignedAgentID: assignedAgentId,
        ClientName: clientName,
        ClientPhone: clientPhone,
        Notes: notes,
        Status: requestedStatus,
        CompanyID: lead.CompanyID || actor.companyId || actor.companyID || null,
        BrokerageID: lead.BrokerageID || actor.brokerageId || actor.brokerageID || null,
        CreatedBy: actor.userId || 'system',
        CreatedAt: now,
        UpdatedBy: actor.userId || 'system',
        UpdatedAt: now
      };
      db.SiteVisits.push(visit);
      return visit;
    });

    this.repo.write(db);
    try {
      this.repo.addTimelineEntry(lead.LeadID, 'SiteVisitBooking', bookingId, 'SITE_VISIT_SCHEDULED',
        `Site visit scheduled — ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'}`,
        { VisitBookingID: bookingId, PropertyIDs: propertyIds, VisitDate: visitDate, VisitTime: visitTime });
    } catch (_) { /* non-fatal */ }

    return { ok: true, data: this._buildBookingView(bookingId, rows) };
  }

  _listRawByBooking(bookingId) {
    const db = this.repo.read();
    return (db.SiteVisits || []).filter((r) => r.VisitBookingID === bookingId);
  }

  _groupBookings(rows) {
    const groups = new Map();
    for (const r of rows) {
      const bid = r.VisitBookingID;
      if (!bid) continue; // skip legacy single-property visits
      if (!groups.has(bid)) groups.set(bid, []);
      groups.get(bid).push(r);
    }
    return Array.from(groups.entries())
      .map(([bid, list]) => this._buildBookingView(bid, list))
      .sort((a, b) => `${b.VisitDate} ${b.VisitTime}`.localeCompare(`${a.VisitDate} ${a.VisitTime}`));
  }

  listByRequirement(requirementId) {
    const db = this.repo.read();
    const rows = (db.SiteVisits || []).filter((r) => r.RequirementID === requirementId && r.VisitBookingID);
    return this._groupBookings(rows);
  }

  listByLead(leadId) {
    const db = this.repo.read();
    const rows = (db.SiteVisits || []).filter((r) => r.LeadID === leadId && r.VisitBookingID);
    return this._groupBookings(rows);
  }

  get(bookingId) {
    const rows = this._listRawByBooking(bookingId);
    if (!rows.length) return { ok: false, error: 'Booking not found' };
    return { ok: true, data: this._buildBookingView(bookingId, rows) };
  }

  update(bookingId, changes = {}, actor = {}) {
    const db = this.repo.read();
    db.SiteVisits = db.SiteVisits || [];
    const rows = db.SiteVisits.filter((r) => r.VisitBookingID === bookingId);
    if (!rows.length) return { ok: false, error: 'Booking not found' };
    const patch = {};
    if (changes.visitDate !== undefined || changes.VisitDate !== undefined) patch.VisitDate = changes.visitDate || changes.VisitDate;
    if (changes.visitTime !== undefined || changes.VisitTime !== undefined) patch.VisitTime = changes.visitTime || changes.VisitTime;
    if (changes.duration !== undefined || changes.Duration !== undefined) patch.Duration = changes.duration || changes.Duration;
    if (changes.meetingPoint !== undefined || changes.MeetingPoint !== undefined) patch.MeetingPoint = changes.meetingPoint || changes.MeetingPoint || '';
    if (changes.notes !== undefined || changes.Notes !== undefined) patch.Notes = changes.notes ?? changes.Notes ?? '';
    if (changes.status !== undefined || changes.Status !== undefined) {
      const s = this._validStatus(changes.status || changes.Status);
      patch.Status = s;
    }
    const nextDate = patch.VisitDate || rows[0].VisitDate;
    const nextTime = patch.VisitTime || rows[0].VisitTime;
    const nextStatus = patch.Status || rows[0].Status;
    const nextPropertyIds = Array.isArray(changes.propertyIds) ? changes.propertyIds : [];
    const propertyIdSet = nextPropertyIds.length ? new Set(nextPropertyIds) : new Set(rows.map((row) => row.PropertyID));
    const duplicate = db.SiteVisits.find((row) =>
      row &&
      row.VisitBookingID !== bookingId &&
      row.RequirementID === rows[0].RequirementID &&
      propertyIdSet.has(row.PropertyID) &&
      row.VisitDate === nextDate &&
      row.VisitTime === nextTime &&
      !['Completed', 'Cancelled'].includes(this._validStatus(row.Status)) &&
      !['Completed', 'Cancelled'].includes(this._validStatus(nextStatus))
    );
    if (duplicate) {
      return { ok: false, error: 'Duplicate active site visit already exists for this requirement/property/date/time', code: 'DUPLICATE_SITE_VISIT' };
    }
    const now = this._now();
    const previousDate = rows[0].VisitDate || null;
    const previousTime = rows[0].VisitTime || null;
    const previousStatus = rows[0].Status || null;
    for (const r of rows) {
      const idx = db.SiteVisits.findIndex((x) => x.VisitID === r.VisitID);
      db.SiteVisits[idx] = { ...r, ...patch, UpdatedBy: actor.userId || r.UpdatedBy || 'system', UpdatedAt: now };
    }
    this.repo.write(db);
    try {
      if ((patch.VisitDate && patch.VisitDate !== previousDate) || (patch.VisitTime && patch.VisitTime !== previousTime)) {
        this.repo.addTimelineEntry(rows[0].LeadID, 'SiteVisitBooking', bookingId, 'SITE_VISIT_RESCHEDULED', 'Site visit rescheduled', {
          VisitBookingID: bookingId,
          RequirementID: rows[0].RequirementID,
          previousDate,
          previousTime,
          nextDate,
          nextTime
        });
      } else if (patch.Status && patch.Status !== previousStatus) {
        this.repo.addTimelineEntry(rows[0].LeadID, 'SiteVisitBooking', bookingId, patch.Status === 'Completed' ? 'SITE_VISIT_COMPLETED' : 'SITE_VISIT_CANCELLED', `Site visit ${patch.Status.toLowerCase()}`, {
          VisitBookingID: bookingId,
          RequirementID: rows[0].RequirementID,
          status: patch.Status
        });
      }
    } catch (_) { /* non-fatal */ }
    return this.get(bookingId);
  }

  cancel(bookingId, actor = {}) {
    return this.update(bookingId, { status: 'Cancelled' }, actor);
  }

  complete(bookingId, actor = {}) {
    return this.update(bookingId, { status: 'Completed' }, actor);
  }
}

module.exports = { SiteVisitBookingService };
