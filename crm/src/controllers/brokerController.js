const { BrokerService } = require('../services/brokerService');

class BrokerController {
  constructor() {
    this.brokerService = new BrokerService();
  }

  async list() {
    const brokers = await this.brokerService.listBrokers();
    return { data: brokers, ok: true };
  }

  async shareRequirement(ctx) {
    const { requirementId, brokerId } = ctx.body;
    const result = await this.brokerService.shareRequirement(requirementId, brokerId);
    return { data: result, ok: true };
  }

  async approveSubmission(ctx) {
    const { submissionId } = ctx.body;
    return await this.brokerService.approveSubmission(submissionId);
  }
}

module.exports = { BrokerController };
