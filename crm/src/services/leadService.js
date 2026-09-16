const { JsonRepository } = require('../data/repository');

class LeadService {
  constructor(repository = null) {
    this.repository = repository || new JsonRepository();
  }

  async listLeads() {
    return this.repository.listLeads();
  }

  async getLead(leadId) {
    return this.repository.readLead(leadId);
  }
}

module.exports = { LeadService };
