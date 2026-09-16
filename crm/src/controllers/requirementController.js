const { RequirementService } = require('../services/requirementService');
const { DynamicFormEngine } = require('../services/formEngine');
const { JsonRepository } = require('../data/repository');

class RequirementController {
  constructor(repository = null) {
    this.requirementService = new RequirementService(repository);
    this.formEngine = new DynamicFormEngine();
    this.repository = repository || new JsonRepository();
  }

  async list(ctx = {}) {
    const leadId = ctx.leadId || ctx.params?.leadId || null;
    if (leadId) {
      const requirements = this.repository.listRequirementsByLead(leadId);
      return { data: requirements, ok: true };
    }

    const requirements = await this.requirementService.listRequirements();
    return { data: requirements, ok: true };
  }

  async create(ctx) {
    const payload = ctx.body || ctx;
    const leadId = payload.leadId || payload.LeadID || payload.leadID;
    const transactionId = payload.transactionId || payload.TransactionID || 'TXN-0001';

    if (!leadId) {
      return { ok: false, error: 'leadId is required' };
    }

    const validation = this.formEngine.validate(payload.formType || payload.category || 'residential', payload);
    if (validation.length) {
      return { ok: false, errors: validation };
    }

    const requirement = await this.requirementService.createRequirement(leadId, transactionId, payload);
    return { data: requirement, ok: true };
  }

  async get(ctx) {
    const requirementId = ctx.params?.requirementId || ctx.requirementId;
    const requirement = this.repository.readRequirement(requirementId);
    if (!requirement) {
      return { ok: false, error: 'Requirement not found' };
    }

    const history = this.repository.requirementHistory(requirementId);
    return { data: { ...requirement, history }, ok: true };
  }

  async update(ctx) {
    const requirementId = ctx.params?.requirementId || ctx.requirementId;
    const payload = ctx.body || ctx;
    const result = this.repository.updateRequirement(requirementId, payload);

    if (!result) {
      return { ok: false, error: 'Requirement not found' };
    }

    return { data: { requirement: result.requirement, history: result.history }, ok: true };
  }

  async archive(ctx) {
    const requirementId = ctx.requirementId || ctx.params?.requirementId;
    const requirement = await this.requirementService.archiveRequirement(requirementId);
    if (!requirement) {
      return { ok: false, error: 'Requirement not found' };
    }

    return { data: requirement, ok: true };
  }

  async delete(ctx) {
    const requirementId = ctx.params?.requirementId || ctx.requirementId;
    this.repository.delete('Requirements', 'RequirementID', requirementId);
    return { ok: true, data: { deletedRequirementId: requirementId } };
  }
}

module.exports = { RequirementController };
