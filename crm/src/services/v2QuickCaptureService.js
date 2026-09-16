'use strict';

/**
 * Phase 13 — Quick Capture
 *
 * Creates the minimum useful client workflow atomically:
 * Lead → Transaction → Requirement.
 * The JSON repository has no database transaction, so the original snapshot
 * is restored if any step fails.
 */
class V2QuickCaptureService {
  constructor(repository, leadService, transactionService, requirementService, nextQuestionService, scoringService, accessService = null) {
    if (!repository) throw new Error('V2QuickCaptureService requires a repository');
    this.repository = repository;
    this.leadSvc = leadService;
    this.txnSvc = transactionService;
    this.reqSvc = requirementService;
    this.nextQSvc = nextQuestionService;
    this.scoringSvc = scoringService;
    this.accessSvc = accessService;
  }

  capture(payload = {}, actor = {}) {
    const client = payload.client || {};
    const transaction = payload.transaction || {};
    const requirement = payload.requirement || {};

    const name = String(client.name || client.ClientName || '').trim();
    const primaryMobile = String(client.primaryMobile || client.PrimaryMobile || client.phone || '').trim();
    const transactionType = String(transaction.transactionType || transaction.TransactionType || '').trim();
    const category = String(requirement.category || requirement.Category || '').trim();

    if (!name) return { ok: false, error: 'client.name is required' };
    if (!primaryMobile) return { ok: false, error: 'client.primaryMobile is required' };
    if (!transactionType) return { ok: false, error: 'transaction.transactionType is required' };
    if (!category) return { ok: false, error: 'requirement.category is required' };

    const duplicatePayload = {
      ClientName: name,
      PrimaryMobile: primaryMobile,
      Email: client.email || client.Email || undefined
    };
    const duplicate = this.leadSvc.checkDuplicate(duplicatePayload);
    const duplicateAction = String(
      payload.duplicateAction || client.duplicateAction || ''
    ).trim().toUpperCase();

    if (duplicate.result === 'POSSIBLE_MATCH' && !['USE_EXISTING', 'CREATE_NEW'].includes(duplicateAction)) {
      return {
        ok: false,
        statusCode: 409,
        error: 'Possible duplicate detected. Choose whether to use the existing client or create a new one.',
        duplicateResult: duplicate.result,
        candidates: duplicate.candidates,
        requiresConfirmation: true
      };
    }

    const snapshot = this.repository.read();
    let lead;
    let createdLead = false;

    try {
      const useExisting = duplicate.result === 'EXACT_MATCH'
        || (duplicate.result === 'POSSIBLE_MATCH' && duplicateAction === 'USE_EXISTING');
      if (useExisting) {
        const candidateId = duplicate.candidates?.[0]?.LeadID;
        lead = candidateId ? this.repository.readLead(candidateId) : null;
        if (!lead) return { ok: false, error: 'Duplicate client could not be loaded' };
        const access = this.accessSvc
          ? this.accessSvc.authorizeLead(actor, lead, { skipPermission: true })
          : { ok: this._sameTenant(lead, actor) };
        if (!access.ok) {
          return { ok: false, statusCode: 404, error: 'Client not found' };
        }
      } else {
        // Do not pass client-controlled tenant or audit fields into the service.
        const leadResult = this.leadSvc.createLead({
          ClientName: name,
          PrimaryMobile: primaryMobile,
          Email: client.email || client.Email || null,
          City: client.city || client.City || null,
          LeadSource: client.source || client.LeadSource || 'Manual',
          ClientStatus: 'New',
          ClientLifecycle: 'Prospect'
        }, actor, { allowPossibleDuplicate: duplicateAction === 'CREATE_NEW' });
        if (!leadResult.ok) return { ...leadResult, statusCode: leadResult.duplicateResult ? 409 : 400 };
        lead = leadResult.data;
        createdLead = true;
      }

      const txnResult = this.txnSvc.createTransaction(lead.LeadID, {
        TransactionType: transactionType,
        TransactionStatus: transaction.transactionStatus || 'Open',
        PipelineStage: transaction.pipelineStage || 'New',
        Notes: transaction.notes || transaction.Notes || ''
      }, actor);
      if (!txnResult.ok) throw this._stepError('Transaction', txnResult.error);

      const locations = Array.isArray(requirement.locations)
        ? requirement.locations.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
      const requirementPayload = this._buildRequirementPayload(requirement, {
        LeadID: lead.LeadID,
        TransactionID: txnResult.data.TransactionID,
        TransactionType: transactionType,
        Category: category,
        locations
      });
      const reqResult = this.reqSvc.createRequirement(txnResult.data.TransactionID, requirementPayload, actor);
      if (!reqResult.ok) throw this._stepError('Requirement', reqResult.error);

      const scoreResult = this.scoringSvc?.recalculateClientScore(lead.LeadID);
      if (scoreResult && !scoreResult.ok) throw this._stepError('Client score', scoreResult.error);
      const currentLead = this.repository.readLead(lead.LeadID) || lead;
      const currentRequirement = this.repository.readRequirement(reqResult.data.RequirementID) || reqResult.data;
      const next = this.nextQSvc?.getNextQuestions(currentRequirement.RequirementID, { limit: 3 });

      return {
        ok: true,
        client: {
          leadId: currentLead.LeadID,
          name: currentLead.ClientName,
          created: createdLead,
          reused: !createdLead
        },
        transaction: {
          transactionId: txnResult.data.TransactionID,
          transactionType: txnResult.data.TransactionType
        },
        requirement: {
          requirementId: currentRequirement.RequirementID,
          category: currentRequirement.Category,
          subCategory: currentRequirement.SubCategory || null,
          locations: [currentRequirement.Location1, currentRequirement.Location2, currentRequirement.Location3].filter(Boolean),
          budgetMin: currentRequirement.BudgetMin ?? null,
          budgetMax: currentRequirement.BudgetMax ?? null
        },
        scores: {
          clientScore: scoreResult?.score ?? currentLead.ClientScore ?? 0,
          requirementScore: currentRequirement.RequirementScore ?? 0
        },
        nextQuestions: next?.ok ? next.questions : []
      };
    } catch (error) {
      this.repository.write(snapshot);
      return {
        ok: false,
        statusCode: error.statusCode || 400,
        error: error.message || 'Quick capture failed',
        rolledBack: true
      };
    }
  }

  _buildRequirementPayload(input, base) {
    const payload = { ...input, ...base };
    delete payload.category;
    delete payload.locations;
    delete payload.budgetMin;
    delete payload.budgetMax;
    delete payload.subCategory;
    delete payload.SubCategory;

    const subCategory = input.subCategory || input.SubCategory;
    if (subCategory) payload.SubCategory = subCategory;
    if (input.budgetMin !== undefined) payload.BudgetMin = input.budgetMin;
    if (input.budgetMax !== undefined) payload.BudgetMax = input.budgetMax;
    base.locations.forEach((location, index) => {
      if (index < 3) payload[`Location${index + 1}`] = location;
    });
    return payload;
  }

  _sameTenant(record, actor) {
    const actorCompany = String(actor.companyId || actor.companyID || '').trim();
    const actorBrokerage = String(actor.brokerageId || actor.brokerageID || '').trim();
    const recordCompany = String(record.CompanyID || record.CompanyId || '').trim();
    const recordBrokerage = String(record.BrokerageID || record.BrokerageId || '').trim();
    if (actor.role === 'ADMIN') return true;
    if (actorCompany && (!recordCompany || actorCompany !== recordCompany)) return false;
    if (actorBrokerage && (!recordBrokerage || actorBrokerage !== recordBrokerage)) return false;
    return true;
  }

  _stepError(step, message) {
    const error = new Error(`${step} creation failed: ${message || 'Unknown error'}`);
    error.statusCode = 400;
    return error;
  }
}

module.exports = { V2QuickCaptureService };