const { MatchingEngine } = require('../services/matchingEngine');

class MatchingController {
  constructor(repository = null) {
    this.matchingEngine = new MatchingEngine({}, repository);
  }

  async matchRequirement(ctx = {}) {
    const requirementId = ctx?.params?.requirementId || ctx?.requirementId || ctx?.body?.requirementId || 'REQ-0001';
    const matches = await this.matchingEngine.getMatchesForRequirement(requirementId);
    return { data: matches, ok: true };
  }
}

module.exports = { MatchingController };
