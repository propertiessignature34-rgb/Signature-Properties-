const { JsonRepository } = require('../data/repository');

// Not yet computed from real data; kept as placeholders until their aggregation logic exists.
const PLACEHOLDER_FOLLOW_UPS_DUE = 24;
const PLACEHOLDER_PIPELINE_PULSE = 76;

class DashboardService {
  constructor(repository = null) {
    this.repository = repository || new JsonRepository();
  }

  async getDashboardSummary() {
    const leads = this.repository.listLeads();
    const requirements = this.repository.list('Requirements');
    const activeRequirements = requirements.filter((row) => ['ACTIVE', 'OPEN', 'NEW'].includes(String(row.Status || '').toUpperCase())).length;

    return {
      totalLeads: leads.length,
      newLeads: leads.filter((lead) => String(lead.LeadStatus || '').toUpperCase() === 'NEW').length,
      followUpsDue: PLACEHOLDER_FOLLOW_UPS_DUE,
      activeRequirements,
      pipelinePulse: PLACEHOLDER_PIPELINE_PULSE,
      modules: ['Dashboard', 'Leads', 'Lead Workspace', 'Requirements', 'Inventory', 'Matching Engine']
    };
  }
}

module.exports = { DashboardService };
