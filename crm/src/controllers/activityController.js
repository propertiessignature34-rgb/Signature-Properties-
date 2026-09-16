const { JsonRepository } = require('../data/repository');

class ActivityController {
  constructor() {
    this.repository = new JsonRepository();
  }

  async list(ctx) {
    const leadId = ctx.params?.leadId || ctx.leadId;
    const activities = this.repository.getLeadActivities(leadId);
    return { ok: true, data: activities };
  }

  async create(ctx) {
    const leadId = ctx.params?.leadId || ctx.leadId;
    const payload = ctx.body || ctx;
    const activity = this.repository.createActivity(leadId, payload);
    return { ok: true, data: activity };
  }
}

module.exports = { ActivityController };
