const { LeadService } = require('../services/leadService');
const { JsonRepository } = require('../data/repository');

class LeadController {
  constructor(repository = null) {
    this.leadService = new LeadService(repository);
    this.repository = repository || new JsonRepository();
  }

  async list(ctx) {
    const leads = await this.leadService.listLeads();
    return {
      data: leads,
      ok: true
    };
  }

  async get(ctx) {
    const leadId = ctx.params?.leadId;
    const lead = await this.leadService.getLead(leadId);
    if (!lead) {
      return { ok: false, error: 'Lead not found' };
    }
    return { data: lead, ok: true };
  }

  async create(ctx) {
    const payload = ctx;
    const required = ['clientName', 'city', 'phone', 'email'];
    const missing = required.filter((key) => !payload[key]);

    if (missing.length > 0) {
      return { ok: false, error: `Missing required fields: ${missing.join(', ')}` };
    }

    const newLead = this.repository.createLead(payload);
    return { ok: true, data: newLead };
  }

  async update(ctx) {
    const leadId = ctx.params?.leadId || ctx.leadId;
    const payload = ctx.payload || ctx.body || ctx;
    const updated = this.repository.updateLead(leadId, payload);
    if (!updated) {
      return { ok: false, error: 'Lead not found' };
    }
    return { ok: true, data: updated };
  }
}

module.exports = { LeadController };
