const { JsonRepository } = require('../data/repository');

class SiteVisitController {
  constructor(repository = null) {
    this.repository = repository || new JsonRepository();
  }

  async list() {
    return this.repository.listSiteVisits();
  }

  async get(ctx = {}) {
    const visitId = ctx.params?.visitId;
    return this.repository.getSiteVisit(visitId);
  }

  async create(payload = {}) {
    const normalized = {
      ...payload,
      LeadID: payload.LeadID || payload.leadId || null,
      RequirementID: payload.RequirementID || payload.requirementId || null,
      PropertyID: payload.PropertyID || payload.propertyId || null,
      MatchID: payload.MatchID || payload.matchId || null,
      ShortlistID: payload.ShortlistID || payload.shortlistId || null,
      VisitDate: payload.VisitDate || payload.visitDate || null,
      VisitTime: payload.VisitTime || payload.visitTime || null,
      Duration: payload.Duration || payload.duration || null,
      MeetingPoint: payload.MeetingPoint || payload.meetingPoint || null,
      AssignedAgentID: payload.AssignedAgentID || payload.assignedAgentId || null,
      ClientName: payload.ClientName || payload.clientName || null,
      ClientPhone: payload.ClientPhone || payload.clientPhone || null,
      Notes: payload.Notes || payload.notes || null,
      Status: payload.Status || payload.status || 'Scheduled'
    };

    return this.repository.createSiteVisit(normalized);
  }

  async update(ctx = {}) {
    const visitId = ctx.params?.visitId;
    return this.repository.updateSiteVisit(visitId, ctx.payload || {});
  }

  async reschedule(ctx = {}) {
    const visitId = ctx.params?.visitId;
    return this.repository.rescheduleSiteVisit(visitId, ctx.payload || {});
  }

  async confirm(ctx = {}) {
    const visitId = ctx.params?.visitId;
    return this.repository.confirmSiteVisit(visitId);
  }

  async complete(ctx = {}) {
    const visitId = ctx.params?.visitId;
    return this.repository.completeSiteVisit(visitId);
  }

  async cancel(ctx = {}) {
    const visitId = ctx.params?.visitId;
    return this.repository.cancelSiteVisit(visitId);
  }

  async noShow(ctx = {}) {
    const visitId = ctx.params?.visitId;
    return this.repository.markSiteVisitNoShow(visitId);
  }
}

module.exports = { SiteVisitController };
