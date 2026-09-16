const { dataStore } = require('../data/store');

const ApiService = {
  dashboard: {
    async getSummary() {
      return {
        totalLeads: dataStore.leads.length,
        newLeads: dataStore.leads.filter((lead) => lead.LeadStatus === 'New').length,
        followUpsDue: 24,
        activeRequirements: dataStore.requirements.length,
        pipelinePulse: 76,
        modules: ['Dashboard', 'Leads', 'Lead Workspace', 'Requirements', 'Inventory', 'Matching Engine']
      };
    }
  },
  leads: {
    async list() {
      return dataStore.leads;
    },
    async getById(leadId) {
      return dataStore.leads.find((lead) => lead.LeadID === leadId) || null;
    }
  },
  transactions: {
    async list() {
      return dataStore.transactions;
    }
  },
  requirements: {
    async list() {
      return dataStore.requirements;
    }
  },
  inventory: {
    async list() {
      return dataStore.inventory;
    }
  },
  matching: {
    async list() {
      return {
        matchResults: [
          { RequirementID: 'REQ-0001', PropertyID: 'PROP-0001', MatchScore: 91, MatchLevel: 'Excellent', Explanation: 'Budget, location and lifestyle fit align' }
        ]
      };
    }
  },
  shortlist: {
    async list() {
      return [];
    }
  },
  siteVisits: {
    async list() {
      return [];
    }
  },
  negotiation: {
    async list() {
      return [];
    }
  },
  deals: {
    async list() {
      return [];
    }
  },
  commission: {
    async list() {
      return [];
    }
  },
  activities: {
    async timeline() {
      return [];
    }
  },
  brokers: {
    async list() {
      return [];
    }
  },
  documents: {
    async list() {
      return [];
    }
  },
  users: {
    async list() {
      return [];
    }
  }
};

module.exports = { ApiService };
