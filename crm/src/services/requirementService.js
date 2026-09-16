const { JsonRepository } = require('../data/repository');

class RequirementService {
  constructor(repository = null) {
    this.repository = repository || new JsonRepository();
  }

  async listRequirements() {
    return this.repository.list('Requirements');
  }

  async createRequirement(payload) {
    return this.repository.createRequirement(payload);
  }

  async archiveRequirement(requirementId) {
    return this.repository.archiveRequirement(requirementId);
  }
}

module.exports = { RequirementService };
