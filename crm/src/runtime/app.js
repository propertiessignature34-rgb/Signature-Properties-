const { ApiRouter } = require('../controllers/router');
const { DynamicFormEngine } = require('../services/formEngine');
const { MatchingEngine } = require('../services/matchingEngine');
const { BrokerService } = require('../services/brokerService');
const { AuthService } = require('../services/authService');
const { JsonRepository } = require('../data/repository');
const { JsonDatabaseAdapter } = require('../data/databaseAdapter');

class SignatureRealtyRuntime {
  constructor(dbFile = process.env.SIG_REALTY_DB_FILE) {
    this.repository = new JsonRepository(dbFile);
    this.database = new JsonDatabaseAdapter(this.repository);
    this.router = new ApiRouter(this.repository);
    this.formEngine = new DynamicFormEngine(() => this.repository.getFormRegistrySnapshot());
    this.matchingEngine = new MatchingEngine({}, this.repository);
    this.brokerService = new BrokerService();
    this.auth = new AuthService(this.repository);
  }

  resolveAuthenticatedActor(request = {}) {
    const context = this.auth.resolveRequestContext(request);
    if (!context.authenticated) {
      return { ok: false, statusCode: context.statusCode || 401, error: context.error || 'Unauthorized' };
    }

    const actor = {
      userId: context.userId,
      userID: context.userId,
      role: context.role,
      companyId: context.companyId,
      brokerageId: context.brokerageId,
      permissions: context.permissions,
      principalType: context.principalType || '',
      user: context.user
    };

    return { ok: true, actor };
  }

  resolveAuthenticatedAdmin(actor = {}) {
    const normalized = {
      userId: actor.userId || actor.userID || actor.agentId || actor.agentID || '',
      role: actor.role || '',
      companyId: actor.companyId || actor.companyID || '',
      brokerageId: actor.brokerageId || actor.brokerageID || '',
      permissions: actor.permissions || []
    };

    if (!normalized.userId) {
      return { ok: false, statusCode: 401, error: 'Unauthorized' };
    }

    const user = this.repository.getUser(normalized.userId);
    if (!user || String(user.Status || '').trim().toUpperCase() !== 'ACTIVE') {
      return { ok: false, statusCode: 401, error: 'Unauthorized' };
    }

    const requestedRole = String(normalized.role || '').trim().toUpperCase();
    const userRole = String(user.Role || '').trim().toUpperCase();
    if (requestedRole && requestedRole !== userRole) {
      return { ok: false, statusCode: 403, error: 'Forbidden' };
    }

    return { ok: true, actor: { ...normalized, userId: user.UserID, userID: user.UserID, role: userRole, userName: user.Name, user } };
  }

  requireAdminPermission(actor, permission, context = {}) {
    const auth = this.auth.requirePermission(actor, permission, context);
    if (!auth.ok) return auth;
    if (!this.repository.hasPermission(auth.actor, permission)) {
      return { ok: false, statusCode: 403, error: 'Forbidden' };
    }
    return auth;
  }

  async dashboard() {
    return this.router.route('dashboard', 'summary');
  }

  async leads() {
    return this.router.route('leads', 'list');
  }

  async listLeads() {
    return { ok: true, data: this.repository.listLeads() };
  }

  async createLead(payload) {
    const result = this.repository.createLead(payload);
    return { ok: true, data: result };
  }

  async readLead(leadId) {
    const lead = this.repository.readLead(leadId);
    if (!lead) {
      return { ok: false, error: 'Lead not found' };
    }
    return { ok: true, data: lead };
  }

  async updateLead(leadId, payload) {
    const updated = this.repository.updateLead(leadId, payload);
    if (!updated) {
      return { ok: false, error: 'Lead not found' };
    }
    return { ok: true, data: updated };
  }

  async createNegotiation(payload = {}) {
    return this.repository.createNegotiation(payload);
  }

  async getNegotiation(negotiationId) {
    const row = this.repository.getNegotiation(negotiationId);
    if (!row) {
      return { ok: false, error: 'Negotiation not found' };
    }
    return { ok: true, data: row };
  }

  async updateNegotiation(negotiationId, payload = {}) {
    return this.repository.updateNegotiation(negotiationId, payload);
  }

  async listNegotiations(filters = {}) {
    return { ok: true, data: this.repository.listNegotiations(filters) };
  }

  async getNegotiationHistory(negotiationId) {
    return this.repository.getNegotiationHistory(negotiationId);
  }

  async makeNegotiationOffer(negotiationId, payload = {}) {
    return this.repository.makeNegotiationOffer(negotiationId, payload);
  }

  async makeNegotiationCounterOffer(negotiationId, payload = {}) {
    return this.repository.makeNegotiationCounterOffer(negotiationId, payload);
  }

  async acceptNegotiationOffer(negotiationId, payload = {}) {
    return this.repository.acceptNegotiationOffer(negotiationId, payload);
  }

  async rejectNegotiationOffer(negotiationId, payload = {}) {
    return this.repository.rejectNegotiationOffer(negotiationId, payload);
  }

  async holdNegotiation(negotiationId, payload = {}) {
    return this.repository.holdNegotiation(negotiationId, payload);
  }

  async resumeNegotiation(negotiationId, payload = {}) {
    return this.repository.resumeNegotiation(negotiationId, payload);
  }

  async markNegotiationAgreed(negotiationId, payload = {}) {
    return this.repository.markNegotiationAgreed(negotiationId, payload);
  }

  async recordNegotiationToken(negotiationId, payload = {}) {
    return this.repository.recordNegotiationToken(negotiationId, payload);
  }

  async markNegotiationAgreement(negotiationId, payload = {}) {
    return this.repository.markNegotiationAgreement(negotiationId, payload);
  }

  async markNegotiationRegistration(negotiationId, payload = {}) {
    return this.repository.markNegotiationRegistration(negotiationId, payload);
  }

  async completeNegotiation(negotiationId, payload = {}) {
    return this.repository.completeNegotiation(negotiationId, payload);
  }

  async cancelNegotiation(negotiationId, payload = {}) {
    return this.repository.cancelNegotiation(negotiationId, payload);
  }

  async createToken(payload = {}) {
    return this.repository.createToken(payload);
  }

  async listTokens(filters = {}) {
    return { ok: true, data: this.repository.listTokens(filters) };
  }

  async createDeal(payload = {}) {
    return this.repository.createDeal(payload);
  }

  async listDeals(filters = {}) {
    return { ok: true, data: this.repository.listDeals(filters) };
  }

  async createPayment(payload = {}) {
    return this.repository.createPayment(payload);
  }

  async listPayments(filters = {}) {
    return { ok: true, data: this.repository.listPayments(filters) };
  }

  async createCommission(payload = {}) {
    return this.repository.createCommission(payload);
  }

  async listCommissions(filters = {}) {
    return { ok: true, data: this.repository.listCommissions(filters) };
  }

  async calculateCommission(payload = {}) {
    return this.repository.calculateCommission(payload);
  }

  async getCommission(commissionId) {
    const commission = this.repository.getCommission(commissionId);
    if (!commission) return { ok: false, error: 'Commission not found' };
    return { ok: true, data: commission };
  }

  async updateCommissionStatus(commissionId, payload = {}) {
    return this.repository.updateCommissionStatus(commissionId, payload);
  }

  async recordCommissionPayment(commissionId, payload = {}) {
    return this.repository.recordCommissionPayment(commissionId, payload);
  }

  async listCommissionPayments(commissionId) {
    return { ok: true, data: this.repository.listCommissionPayments(commissionId) };
  }

  async getCommissionHistory(commissionId) {
    return { ok: true, data: this.repository.listCommissionHistory(commissionId) };
  }

  async getCommissionSummary() {
    return this.repository.getCommissionSummary();
  }

  async startClosing(dealId, payload = {}) {
    return this.repository.startClosing(dealId, payload);
  }

  async getClosing(dealId) {
    const closing = this.repository.getClosing(dealId);
    if (!closing) return { ok: false, error: 'Closing not found' };
    return { ok: true, data: closing };
  }

  async updateClosingChecklist(dealId, payload = {}) {
    return this.repository.updateClosingChecklist(dealId, payload);
  }

  async completeClosing(dealId, payload = {}) {
    return this.repository.completeClosing(dealId, payload);
  }

  async closeDeal(dealId, payload = {}) {
    return this.repository.closeDeal(dealId, payload);
  }

  async getClosingHistory(dealId) {
    return { ok: true, data: this.repository.listClosingHistory(dealId) };
  }

  async createFollowUp(payload = {}) {
    return this.repository.createFollowUp(payload);
  }

  async listFollowUps(filters = {}) {
    return { ok: true, data: this.repository.listFollowUps(filters) };
  }

  async createDocument(payload = {}) {
    return this.repository.createDocument(payload);
  }

  async listDocuments(filters = {}) {
    return { ok: true, data: this.repository.listDocuments(filters) };
  }

  async createOwner(payload = {}, actor = {}) {
    return this.repository.createOwner(payload, actor);
  }

  async listOwners() {
    return { ok: true, data: this.repository.listOwners() };
  }

  async createBuilder(payload = {}, actor = {}) {
    return this.repository.createBuilder(payload, actor);
  }

  async listBuilders() {
    return { ok: true, data: this.repository.listBuilders() };
  }

  async createProject(payload = {}, actor = {}) {
    return this.repository.createProject(payload, actor);
  }

  async listProjects() {
    return { ok: true, data: this.repository.listProjects() };
  }

  async getTimeline(leadId) {
    return { ok: true, data: this.repository.getTimeline(leadId) };
  }

  async globalSearch(query = '') {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return { ok: true, data: [] };
    const db = this.repository.read();
    const candidates = [
      ...(db.Leads || []),
      ...(db.Requirements || []),
      ...(db.Inventory || []),
      ...(db.Matches || []),
      ...(db.Shortlists || []),
      ...(db.SiteVisits || []),
      ...(db.Negotiations || []),
      ...(db.Tokens || []),
      ...(db.Deals || []),
      ...(db.Projects || []),
      ...(db.Owners || []),
      ...(db.Builders || [])
    ];

    const matches = candidates.filter((row) => {
      return JSON.stringify(row).toLowerCase().includes(q);
    }).map((row) => ({
      entityType: Object.keys(row).includes('LeadID') && row.LeadID ? 'Lead' : Object.keys(row).includes('RequirementID') && row.RequirementID ? 'Requirement' : Object.keys(row).includes('PropertyID') && row.PropertyID ? 'Property' : Object.keys(row).includes('MatchID') && row.MatchID ? 'Match' : Object.keys(row).includes('NegotiationID') && row.NegotiationID ? 'Negotiation' : Object.keys(row).includes('TokenID') && row.TokenID ? 'Token' : Object.keys(row).includes('DealID') && row.DealID ? 'Deal' : 'Record',
      ...row
    }));

    return { ok: true, data: matches };
  }

  async getReportSummary() {
    const db = this.repository.read();
    const leadCount = (db.Leads || []).length;
    const requirementCount = (db.Requirements || []).length;
    const matchCount = (db.Matches || []).length;
    const shortlistCount = (db.Shortlists || []).length;
    const siteVisitCount = (db.SiteVisits || []).length;
    const negotiationCount = (db.Negotiations || []).length;
    const tokenCount = (db.Tokens || []).length;
    const dealCount = (db.Deals || []).length;

    return {
      ok: true,
      data: {
        totalLeads: leadCount,
        activeLeads: (db.Leads || []).filter((lead) => ['Active', 'Verified'].includes(lead.LeadStatus || lead.leadStatus)).length,
        requirements: requirementCount,
        matches: matchCount,
        shortlists: shortlistCount,
        siteVisits: siteVisitCount,
        negotiations: negotiationCount,
        tokens: tokenCount,
        deals: dealCount,
        revenue: (db.Deals || []).reduce((sum, deal) => sum + Number(deal.FinalPrice || 0), 0),
        brokerage: (db.Deals || []).reduce((sum, deal) => sum + Number(deal.Brokerage || 0), 0),
        received: (db.Payments || []).reduce((sum, payment) => sum + Number(payment.Amount || 0), 0),
        pending: (db.Commission || []).reduce((sum, item) => sum + Number(item.PendingAmount || item.Pending || 0), 0)
      }
    };
  }

  async getDashboardReport(filters = {}, actor = {}) {
    return this.repository.getDashboardReport(filters, actor);
  }

  async getLeadsReport(filters = {}, actor = {}) {
    return this.repository.getLeadAnalytics(filters, actor);
  }

  async getRequirementsReport(filters = {}, actor = {}) {
    return this.repository.getRequirementAnalytics(filters, actor);
  }

  async getInventoryReport(filters = {}, actor = {}) {
    return this.repository.getInventoryAnalytics(filters, actor);
  }

  async getMatchingReport(filters = {}, actor = {}) {
    return this.repository.getMatchingAnalytics(filters, actor);
  }

  async getShortlistReport(filters = {}, actor = {}) {
    return this.repository.getShortlistAnalytics(filters, actor);
  }

  async getSiteVisitReport(filters = {}, actor = {}) {
    return this.repository.getSiteVisitAnalytics(filters, actor);
  }

  async getNegotiationReport(filters = {}, actor = {}) {
    return this.repository.getNegotiationAnalytics(filters, actor);
  }

  async getTokenReport(filters = {}, actor = {}) {
    return this.repository.getTokenAnalytics(filters, actor);
  }

  async getDealReport(filters = {}, actor = {}) {
    return this.repository.getDealAnalytics(filters, actor);
  }

  async getCommissionReport(filters = {}, actor = {}) {
    return this.repository.getCommissionAnalytics(filters, actor);
  }

  async getClosingReport(filters = {}, actor = {}) {
    return this.repository.getClosingAnalytics(filters, actor);
  }

  async getAgentsReport(filters = {}, actor = {}) {
    return this.repository.getAgentPerformanceAnalytics(filters, actor);
  }

  async getSourcesReport(filters = {}, actor = {}) {
    return this.repository.getSourcePerformanceAnalytics(filters, actor);
  }

  async getLocationsReport(filters = {}, actor = {}) {
    return this.repository.getLocationAnalytics(filters, actor);
  }

  async getBuildersReport(filters = {}, actor = {}) {
    return this.repository.getBuilderAnalytics(filters, actor);
  }

  async getFinancialReport(filters = {}, actor = {}) {
    return this.repository.getFinancialAnalytics(filters, actor);
  }

  async getReportsCenter(filters = {}, actor = {}) {
    return this.repository.getReportsCenter(filters, actor);
  }

  async exportReportCsv(type, filters = {}, actor = {}) {
    return this.repository.exportReportCsv(type, filters, actor);
  }

  async requirements() {
    return this.router.route('requirements', 'list');
  }

  async getLeadWorkspace(leadId) {
    const lead = this.repository.readLead(leadId);
    if (!lead) {
      return { ok: false, error: 'Lead not found' };
    }

    const requirements = this.repository.listRequirementsByLead(leadId);
    const activities = this.repository.getLeadActivities(leadId);
    const shortlist = await this.listShortlist({ leadId, status: 'Active' });
    const siteVisitsResult = this.repository.listSiteVisits();
    const negotiations = this.repository.listNegotiations({ LeadID: leadId });
    const tokens = this.repository.listTokens({ LeadID: leadId });
    const deals = this.repository.listDeals({ LeadID: leadId });
    const payments = this.repository.listPayments();
    const commissions = this.repository.listCommissions({ LeadID: leadId });
    const closings = (this.repository.read().Closings || []).filter((item) => item.LeadID === leadId);
    const documents = this.repository.listDocuments({ EntityType: 'Lead', EntityID: leadId });

    return {
      ok: true,
      data: {
        lead,
        transactions: this.repository.list('Transactions').filter((t) => t.LeadID === leadId),
        requirements,
        activities,
        timeline: this.repository.list('Timeline').filter((t) => t.LeadID === leadId),
        matching: this.repository.listMatches().filter((item) => requirements.some((req) => req.RequirementID === item.RequirementID)),
        shortlist: shortlist.ok ? shortlist.data : [],
        siteVisits: siteVisitsResult.ok ? siteVisitsResult.data.filter((visit) => visit.LeadID === leadId) : [],
        negotiations,
        tokens,
        deals,
        commissions,
        closings,
        payments: payments.filter((item) => item.DealID && deals.some((deal) => deal.DealID === item.DealID)),
        documents,
        followUps: this.repository.listFollowUps({ LeadID: leadId })
      }
    };
  }

  async listInventory() {
    return { ok: true, data: this.repository.list('Inventory') };
  }

  async listPublicProperties() {
    const rows = this.repository.list('Inventory').filter((row) => String(row.Visibility || row.visibility || 'PRIVATE').toUpperCase() === 'PUBLIC');
    return { ok: true, data: rows };
  }

  async listPublicProjects() {
    const rows = this.repository.list('Projects').filter((row) => String(row.Visibility || row.visibility || 'PRIVATE').toUpperCase() === 'PUBLIC');
    return { ok: true, data: rows };
  }

  async createInventoryProperty(payload = {}, actor = {}) {
    const property = {
      PropertyID: payload.PropertyID || this.repository.createId('PROP'),
      TransactionType: payload.transactionType || payload.TransactionType || null,
      Category: payload.category || payload.Category || 'Residential',
      SubCategory: payload.subCategory || payload.SubCategory || 'Apartment',
      PropertyType: payload.propertyType || payload.PropertyType || 'Apartment',
      Project: payload.project || payload.Project || 'Unnamed Project',
      Location: payload.location || payload.Location || 'Unknown',
      City: payload.city || payload.City || null,
      BHK: payload.bhk || payload.BHK || null,
      Area: payload.area || payload.Area || 0,
      Price: payload.price || payload.Price || 0,
      Possession: payload.possession || payload.Possession || null,
      Status: payload.status || payload.Status || 'Available',
      OwnerID: payload.ownerId || payload.OwnerID || null,
      BrokerID: payload.brokerId || payload.BrokerID || null,
      BuilderID: payload.builderId || payload.BuilderID || null,
      Visibility: payload.Visibility || payload.visibility || 'PRIVATE',
      CompanyID: actor.companyId || actor.companyID || null,
      BrokerageID: actor.brokerageId || actor.brokerageID || null,
      CreatedBy: actor.userId || 'system',
      CreatedAt: new Date().toISOString(),
      UpdatedBy: actor.userId || 'system',
      UpdatedAt: new Date().toISOString()
    };

    const created = this.repository.create('Inventory', property);
    return { ok: true, data: created };
  }

  async createRequirement(leadId, transactionId = 'TXN-0001', payload = {}) {
    const normalized = {
      leadId,
      transactionId,
      ...payload,
      LeadID: payload.LeadID || payload.leadId || leadId,
      TransactionID: payload.TransactionID || payload.transactionId || transactionId,
      validated: false
    };

    const formTypeSource = payload.formType || payload.FormType || payload.category || payload.Category || 'residential';
    const normalizedFormType = this.formEngine.normalizeFormType(formTypeSource);

    const validation = await this.validateRequirementPayload(normalized, normalizedFormType);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors };
    }

    const req = this.repository.createRequirement(normalized);
    return { ok: true, data: req };
  }

  async readRequirement(requirementId) {
    const req = this.repository.readRequirement(requirementId);
    if (!req) {
      return { ok: false, error: 'Requirement not found' };
    }
    const history = this.repository.requirementHistory(requirementId);
    return { ok: true, data: { ...req, history } };
  }

  async updateRequirement(requirementId, payload) {
    const result = this.repository.updateRequirement(requirementId, payload);
    if (!result) {
      return { ok: false, error: 'Requirement not found' };
    }

    return { ok: true, data: { requirement: result.requirement, history: [result.history] } };
  }

  async archiveRequirement(requirementId) {
    const req = this.repository.archiveRequirement(requirementId);
    if (!req) {
      return { ok: false, error: 'Requirement not found' };
    }

    return { ok: true, data: req };
  }

  async deleteRequirement(requirementId) {
    const deleted = this.repository.delete('Requirements', 'RequirementID', requirementId);
    return { ok: true, deleted };
  }

  async duplicateRequirement(requirementId) {
    const dup = this.repository.duplicateRequirement(requirementId);
    if (!dup) {
      return { ok: false, error: 'Requirement not found' };
    }
    return { ok: true, data: dup };
  }

  async getLeadRequirements(leadId) {
    const requirements = this.repository.listRequirementsByLead(leadId);
    return { ok: true, data: requirements };
  }

  async addActivity(leadId, payload) {
    const activity = this.repository.createActivity(leadId, payload);
    return { ok: true, data: activity };
  }

  async getLeadActivity(leadId) {
    const activities = this.repository.getLeadActivities(leadId);
    return { ok: true, data: activities };
  }

  async validateRequirementPayload(payload, formType = 'residential') {
    const errors = [];

    const leadValue = payload.LeadID ?? payload.leadId;
    if (leadValue === undefined || leadValue === null || leadValue === '') {
      errors.push('leadId is required');
    }

    const budgetMin = Number(payload.budgetMin ?? payload.BudgetMin);
    const budgetMax = Number(payload.budgetMax ?? payload.BudgetMax);
    if (payload.budgetMin !== undefined || payload.BudgetMin !== undefined || payload.budgetMax !== undefined || payload.BudgetMax !== undefined) {
      if (!Number.isNaN(budgetMin) && !Number.isNaN(budgetMax) && budgetMin > budgetMax) {
        errors.push('BudgetMin must be less than or equal to BudgetMax');
      }
    }

    const areaMin = Number(payload.areaMin ?? payload.AreaMin);
    const areaMax = Number(payload.areaMax ?? payload.AreaMax);
    if (payload.areaMin !== undefined || payload.AreaMin !== undefined || payload.areaMax !== undefined || payload.AreaMax !== undefined) {
      if (!Number.isNaN(areaMin) && !Number.isNaN(areaMax) && areaMin > areaMax) {
        errors.push('AreaMin must be less than or equal to AreaMax');
      }
    }

    const mobile = payload.mobile ?? payload.Mobile ?? payload.phone ?? payload.Phone;
    if (mobile !== undefined && mobile !== null && mobile !== '' && !this.formEngine.isValidMobile(mobile)) {
      errors.push('Mobile number is invalid');
    }

    const email = payload.email ?? payload.Email;
    if (email !== undefined && email !== null && email !== '' && !this.formEngine.isValidEmail(email)) {
      errors.push('Email address is invalid');
    }

    const normalizedFormType = this.formEngine.normalizeFormType(formType);
    const registry = this.formEngine.resolveRegistry();
    if (normalizedFormType && registry[normalizedFormType]) {
      const registryErrors = this.formEngine.validate(normalizedFormType, payload);
      errors.push(...registryErrors.filter((error) => error && !error.startsWith('Form config')));
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }

    return { ok: true, errors: [] };
  }

  async getFormRegistry() {
    return { ok: true, data: this.formEngine.resolveRegistry() };
  }

  async getFormConfig(formType) {
    const cfg = this.formEngine.getFormConfig(formType);
    return { ok: true, data: cfg };
  }

  async runMatching(requirementId) {
    return this.matchingEngine.runMatching(requirementId);
  }

  async getMatches(requirementId) {
    return this.matchingEngine.getMatchesForRequirement(requirementId);
  }

  async getMatch(matchId) {
    return this.matchingEngine.getMatch(matchId);
  }

  async matching(requirementId = 'REQ-0001') {
    const requirementMatches = this.repository.listMatches(requirementId);
    if (requirementMatches.length > 0) {
      return { ok: true, data: requirementMatches };
    }

    const runResult = await this.runMatching(requirementId);
    if (runResult.ok && Array.isArray(runResult.data?.matches)) {
      return { ok: true, data: runResult.data.matches };
    }

    return this.matchingEngine.listAllMatches();
  }

  buildShortlistView(shortlist) {
    const requirement = this.repository.readRequirement(shortlist.RequirementID);
    const property = this.repository.find('Inventory', 'PropertyID', shortlist.PropertyID);
    const match = shortlist.MatchID
      ? this.repository.getMatch(shortlist.MatchID)
      : this.repository.findMatchByRequirementAndProperty(shortlist.RequirementID, shortlist.PropertyID);

    return {
      ...shortlist,
      RequirementCode: requirement?.RequirementCode || shortlist.RequirementID,
      PropertyName: property?.Project || property?.PropertyType || shortlist.PropertyID,
      Location: property?.Location || property?.City || null,
      Price: property?.Price ?? null,
      BHK: property?.BHK ?? null,
      Area: property?.Area ?? null,
      MatchScore: match?.Score ?? null,
      MatchLevel: match?.MatchLevel ?? null
    };
  }

  validateShortlistPriority(priority) {
    const value = String(priority || 'Medium');
    return ['High', 'Medium', 'Low'].includes(value) ? value : null;
  }

  async listShortlist(filters = {}) {
    const rows = this.repository.listShortlists(filters);
    return { ok: true, data: rows.map((row) => this.buildShortlistView(row)) };
  }

  async getShortlist(shortlistId) {
    const shortlist = this.repository.getShortlist(shortlistId);
    if (!shortlist) {
      return { ok: false, error: 'Shortlist record not found' };
    }

    return { ok: true, data: this.buildShortlistView(shortlist) };
  }

  async listSiteVisits() {
    return this.router.route('siteVisits', 'list');
  }

  async getSiteVisit(visitId) {
    return this.router.route('siteVisits', 'get', { params: { visitId } });
  }

  async createSiteVisit(payload = {}) {
    return this.router.route('siteVisits', 'create', payload);
  }

  async updateSiteVisit(visitId, payload = {}) {
    return this.router.route('siteVisits', 'update', { params: { visitId }, payload });
  }

  async rescheduleSiteVisit(visitId, payload = {}) {
    return this.router.route('siteVisits', 'reschedule', { params: { visitId }, payload });
  }

  async confirmSiteVisit(visitId) {
    return this.router.route('siteVisits', 'confirm', { params: { visitId } });
  }

  async completeSiteVisit(visitId) {
    return this.router.route('siteVisits', 'complete', { params: { visitId } });
  }

  async cancelSiteVisit(visitId) {
    return this.router.route('siteVisits', 'cancel', { params: { visitId } });
  }

  async markSiteVisitNoShow(visitId) {
    return this.router.route('siteVisits', 'noShow', { params: { visitId } });
  }

  async addToShortlist(payload = {}) {
    const requirementId = payload.requirementId || payload.RequirementID;
    const propertyId = payload.propertyId || payload.PropertyID;
    const matchId = payload.matchId || payload.MatchID || null;
    const notes = payload.notes || payload.Notes || '';
    const priority = this.validateShortlistPriority(payload.priority || payload.Priority || 'Medium');

    if (!requirementId) {
      return { ok: false, error: 'requirementId required' };
    }

    if (!propertyId) {
      return { ok: false, error: 'propertyId required' };
    }

    if (!priority) {
      return { ok: false, error: 'Invalid priority' };
    }

    const requirement = this.repository.readRequirement(requirementId);
    if (!requirement) {
      return { ok: false, error: 'Requirement not found' };
    }

    const property = this.repository.find('Inventory', 'PropertyID', propertyId);
    if (!property) {
      return { ok: false, error: 'Property not found' };
    }

    const match = matchId
      ? this.repository.getMatch(matchId)
      : this.repository.findMatchByRequirementAndProperty(requirementId, propertyId);

    if (!match) {
      return { ok: false, error: 'No matching property found for this requirement' };
    }

    if (match.RequirementID !== requirementId || match.PropertyID !== propertyId) {
      return { ok: false, error: 'Match does not belong to the given requirement/property' };
    }

    const existing = this.repository.findActiveShortlist(requirementId, propertyId);
    if (existing) {
      return { ok: true, data: this.buildShortlistView(existing), alreadyShortlisted: true };
    }

    const created = this.repository.createShortlist({
      RequirementID: requirementId,
      LeadID: requirement.LeadID,
      PropertyID: propertyId,
      MatchID: match.MatchID,
      Status: 'Active',
      Priority: priority,
      Notes: notes,
      CreatedBy: payload.createdBy || payload.CreatedBy || 'system'
    });

    return { ok: true, data: this.buildShortlistView(created), alreadyShortlisted: false };
  }

  async updateShortlist(shortlistId, payload = {}) {
    const shortlist = this.repository.getShortlist(shortlistId);
    if (!shortlist) {
      return { ok: false, error: 'Shortlist record not found' };
    }

    const changes = {};
    if (payload.priority !== undefined || payload.Priority !== undefined) {
      const priority = this.validateShortlistPriority(payload.priority || payload.Priority);
      if (!priority) {
        return { ok: false, error: 'Invalid priority' };
      }
      changes.Priority = priority;
    }

    if (payload.notes !== undefined || payload.Notes !== undefined) {
      changes.Notes = payload.notes ?? payload.Notes ?? '';
    }

    if (payload.status !== undefined || payload.Status !== undefined) {
      const status = payload.status || payload.Status;
      if (!['Active', 'Removed'].includes(status)) {
        return { ok: false, error: 'Invalid status' };
      }
      changes.Status = status;
    }

    const updated = this.repository.updateShortlist(shortlistId, changes);
    return { ok: true, data: this.buildShortlistView(updated) };
  }

  async removeFromShortlist(shortlistId, removedBy = 'system') {
    const removed = this.repository.removeShortlist(shortlistId, removedBy);
    if (!removed) {
      return { ok: false, error: 'Shortlist record not found' };
    }

    return { ok: true, data: this.buildShortlistView(removed) };
  }

  async formConfig(formType) {
    return this.formEngine.getFormConfig(formType);
  }

  async getAdminOverview(actor = {}) {
    const auth = this.requireAdminPermission(actor, 'ADMIN_VIEW');
    if (!auth.ok) return auth;
    return this.repository.getAdminOverview();
  }

  async listAdminUsers(actor = {}) {
    const auth = this.requireAdminPermission(actor, 'USERS_MANAGE');
    if (!auth.ok) return auth;
    return { ok: true, data: this.repository.listUsers() };
  }

  async createAdminUser(payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'USERS_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.createUser(payload, auth.actor);
  }

  async updateAdminUser(userId, payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'USERS_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.updateUser(userId, payload, auth.actor);
  }

  async updateAdminUserStatus(userId, status, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'USERS_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.updateUserStatus(userId, status, auth.actor);
  }

  async listAdminRoles(actor = {}) {
    const auth = this.requireAdminPermission(actor, 'ROLES_MANAGE');
    if (!auth.ok) return auth;
    return { ok: true, data: this.repository.getRoles() };
  }

  async createAdminRole(payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'ROLES_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.saveRole(payload, auth.actor);
  }

  async updateAdminRole(roleName, payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'ROLES_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.saveRole({ ...payload, Name: roleName }, auth.actor);
  }

  async listAdminPermissions(actor = {}) {
    const auth = this.requireAdminPermission(actor, 'PERMISSIONS_MANAGE');
    if (!auth.ok) return auth;
    return { ok: true, data: this.repository.getPermissions() };
  }

  async getAdminSettings(actor = {}) {
    const auth = this.requireAdminPermission(actor, 'SETTINGS_MANAGE');
    if (!auth.ok) return auth;
    return { ok: true, data: this.repository.getSettings() };
  }

  async updateAdminSettings(payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'SETTINGS_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.updateSettings(payload, auth.actor);
  }

  async getAdminMasters(filters = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'MASTERS_MANAGE');
    if (!auth.ok) return auth;
    return { ok: true, data: this.repository.listMasters(filters) };
  }

  async createAdminMaster(payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'MASTERS_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.createMaster(payload, auth.actor);
  }

  async updateAdminMaster(masterId, payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'MASTERS_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.updateMaster(masterId, payload, auth.actor);
  }

  async deactivateAdminMaster(masterId, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'MASTERS_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.deactivateMaster(masterId, auth.actor);
  }

  async getAdminPipeline(actor = {}) {
    const auth = this.requireAdminPermission(actor, 'PIPELINE_MANAGE');
    if (!auth.ok) return auth;
    return { ok: true, data: this.repository.getPipelineConfig() };
  }

  async updateAdminPipeline(payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'PIPELINE_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.updatePipelineConfig(payload, auth.actor);
  }

  async getAdminForms(actor = {}) {
    const auth = this.requireAdminPermission(actor, 'FORMS_MANAGE');
    if (!auth.ok) return auth;
    return { ok: true, data: this.repository.getFormRegistrySnapshot() };
  }

  async updateAdminForm(formType, payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'FORMS_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.saveFormConfig(formType, payload, auth.actor);
  }

  async updateAdminFormField(formType, fieldId, payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'FORMS_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.updateFormField(formType, fieldId, payload, auth.actor);
  }

  async deactivateAdminFormField(formType, fieldId, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'FORMS_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.deactivateFormField(formType, fieldId, auth.actor);
  }

  async getAdminNotifications(actor = {}) {
    const auth = this.requireAdminPermission(actor, 'NOTIFICATIONS_MANAGE');
    if (!auth.ok) return auth;
    return { ok: true, data: this.repository.getNotificationSettings() };
  }

  async updateAdminNotifications(payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'NOTIFICATIONS_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.updateNotificationSettings(payload, auth.actor);
  }

  async getAdminAudit(filters = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'AUDIT_VIEW');
    if (!auth.ok) return auth;
    return { ok: true, data: this.repository.listAudit(filters) };
  }

  async createAdminBackup(payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'BACKUP_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.createBackup(payload, auth.actor);
  }

  async getAdminBackups(actor = {}) {
    const auth = this.requireAdminPermission(actor, 'BACKUP_MANAGE');
    if (!auth.ok) return auth;
    return { ok: true, data: this.repository.listBackups() };
  }

  async restoreAdminBackup(backupId, payload = {}, actor = {}) {
    const auth = this.requireAdminPermission(actor, 'BACKUP_MANAGE');
    if (!auth.ok) return auth;
    return this.repository.restoreBackup(backupId, payload, auth.actor);
  }

  async getAdminHealth(actor = {}) {
    const auth = this.requireAdminPermission(actor, 'HEALTH_VIEW');
    if (!auth.ok) return auth;
    return this.repository.getHealth();
  }

  async getAdminMaintenance(actor = {}) {
    const auth = this.requireAdminPermission(actor, 'MAINTENANCE_VIEW');
    if (!auth.ok) return auth;
    return this.repository.getMaintenanceReport();
  }

  async getAdminDashboard(actor = {}) {
    return this.getAdminOverview(actor);
  }

  async brokerShare(requirementId, brokerId) {
    return this.brokerService.shareRequirement(requirementId, brokerId);
  }
}

module.exports = { SignatureRealtyRuntime };
