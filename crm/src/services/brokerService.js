const { dataStore } = require('../data/store');

class BrokerService {
  async listBrokers() {
    return [
      { BrokerID: 'BRO-001', BrokerName: 'Astra Realty Co.', BrokerType: 'Broker', Company: 'Astra Realty', Status: 'Active' },
      { BrokerID: 'BRO-002', BrokerName: 'Urban Crest Brokers', BrokerType: 'Broker', Company: 'Urban Crest', Status: 'Active' }
    ];
  }

  async shareRequirement(requirementId, brokerId) {
    const requirement = dataStore.requirements.find((item) => item.RequirementID === requirementId);
    if (!requirement) {
      throw new Error('Requirement not found');
    }

    const submission = {
      BrokerSubmissionID: `SUB-${Date.now()}`,
      LeadID: requirement.LeadID,
      RequirementID: requirement.RequirementID,
      BrokerID: brokerId,
      Status: 'Draft',
      RejectReason: null,
      Version: 1,
      SubmittedAt: new Date().toISOString()
    };

    return submission;
  }

  async approveSubmission(submissionId) {
    return { BrokerSubmissionID: submissionId, Status: 'Approved' };
  }
}

module.exports = { BrokerService };
