/**
 * PHASE 13 — V2 API Router
 *
 * Route strategy:
 *
 *   NEW routes (always active, no feature flag needed):
 *     POST   /api/leads/check-duplicate
 *     GET    /api/leads/:leadId/transactions
 *     POST   /api/leads/:leadId/transactions
 *     GET    /api/transactions/:id           (single transaction — legacy only exposes /api/transactions list)
 *     PATCH  /api/transactions/:id
 *     GET    /api/transactions/:id/requirements
 *     POST   /api/transactions/:id/requirements
 *     POST   /api/leads/:id/score
 *     POST   /api/leads/:id/tags
 *     DELETE /api/leads/:id/tags/:tag
 *     GET    /api/clients/:leadId/workspace
 *     GET    /api/v2/*  (config, form-config, form-registry, global requirements)
 *
 *   SHARED routes (handled by V2Router ONLY when LEAD_V2_ENABLED=true,
 *                  otherwise fall through to legacy handlers):
 *     GET    /api/leads
 *     POST   /api/leads
 *     GET    /api/leads/:id
 *     PATCH  /api/leads/:id
 *     GET    /api/requirements
 *     GET    /api/requirements/:id
 *     PATCH  /api/requirements/:id
 *
 * Legacy routes are ALWAYS preserved; this router returns null to fall through.
 */

'use strict';

const { V2LeadService }          = require('../services/v2LeadService');
const { V2TransactionService }   = require('../services/v2TransactionService');
const { V2RequirementService }   = require('../services/v2RequirementService');
const { V2ConfigService }        = require('../services/v2ConfigService');
const { V2FormRegistryService }  = require('../services/v2FormRegistryService');
const { V2DependencyService }    = require('../services/v2DependencyService');
const { V2NextQuestionService }  = require('../services/v2NextQuestionService');
const { V2ScoringService }       = require('../services/v2ScoringService');
const { V2ActivityService }      = require('../services/v2ActivityService');
const { V2FollowUpService }      = require('../services/v2FollowUpService');
const { V2QuickCaptureService }  = require('../services/v2QuickCaptureService');
const { DocumentService }        = require('../services/documentService');
const { AccessControlService }   = require('../services/accessControlService');
const { EntityConfig, TagConfig, WorkflowConfig, ScoringConfig, ColumnConfig, V2FormRegistry, SourceOptions } = require('../data/v2Config');

// ── Feature Flag ──────────────────────────────────────────────────────────────
// Read once at startup. Restart server to pick up a change.
// Controls only SHARED routes. New routes are always active.
function isV2Enabled() {
  return process.env.LEAD_V2_ENABLED === 'true';
}

class V2Router {
  constructor(repository, actorResolver = null) {
    // Services are built in dependency order
    this.configSvc    = new V2ConfigService(repository);
    this.registrySvc  = new V2FormRegistryService(repository, this.configSvc);
    this.depSvc       = new V2DependencyService(repository, this.registrySvc);
    this.scoringSvc   = new V2ScoringService(repository, this.depSvc);
    this.leadSvc      = new V2LeadService(repository, this.scoringSvc);
    this.txnSvc       = new V2TransactionService(repository);
    this.reqSvc       = new V2RequirementService(repository, this.scoringSvc);
    this.nextQSvc     = new V2NextQuestionService(repository, this.depSvc, this.configSvc);
    this.accessSvc    = new AccessControlService(repository);
    this.quickCaptureSvc = new V2QuickCaptureService(
      repository,
      this.leadSvc,
      this.txnSvc,
      this.reqSvc,
      this.nextQSvc,
      this.scoringSvc,
      this.accessSvc
    );
    this.actSvc       = new V2ActivityService(repository, this.reqSvc);
    this.fuSvc        = new V2FollowUpService(repository);
    this.documentSvc  = new DocumentService(repository);
    this.repo         = repository;
    this.actorResolver = typeof actorResolver === 'function' ? actorResolver : null;

    // Phase 8: seed FieldConfig and QuestionConfig on startup (idempotent)
    this.configSvc.seedConfigIfEmpty();
    // Phase 9: seed FormRegistry on startup (idempotent)
    this.registrySvc.seedFormRegistryIfEmpty();
    // Phase 10: seed DependencyConfig on startup (idempotent)
    this.depSvc.seedDependencyConfigIfEmpty();
    // Phase 12: seed ScoringConfig on startup (idempotent)
    this.scoringSvc.seedScoringConfigIfEmpty();
  }

  /**
   * Main dispatch method. Called from server.js.
   *
   * Returns:
   *   { handled: true, statusCode, body } — router handled this request
   *   null — not handled; caller should proceed with legacy handler
   */
  async handle(req, res, url, body) {
    const pathname = url.pathname;
    const method   = req.method;

    // ── NEW: Duplicate check (always active) ─────────────────────────────────
    if (pathname === '/api/leads/check-duplicate' && method === 'POST') {
      const auth = this._requireActor(req, url);
      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const permission = this.accessSvc.requirePermissions(auth.actor, ['LEADS_CREATE']);
      if (!permission.ok) return this._json(permission.statusCode, { ok: false, error: permission.error });
      const result = this.leadSvc.checkDuplicate(body || {});
      const visibleCandidates = (result.candidates || []).filter((candidate) => {
        const lead = this.repo.readLead(candidate.LeadID);
        return lead && this.accessSvc.canAccessLeadRecord(lead, auth.actor);
      });
      if (!visibleCandidates.length) return this._ok({ result: 'NO_MATCH', candidates: [] });
      return this._ok({ ...result, candidates: visibleCandidates });
    }

    // ── NEW: Lead sub-routes (always active) ─────────────────────────────────
    const leadSubMatch = pathname.match(/^\/api\/leads\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/);
    if (leadSubMatch) {
      const [, leadId, sub, subsub] = leadSubMatch;

      if (sub === 'transactions') {
        if (method === 'GET') {
          const auth = this._requireActor(req, url);
          if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
          const lead = this.repo.readLead(leadId);
          const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
          if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
          const rows = this.txnSvc.listTransactionsByLead(leadId);
          return this._ok({ ok: true, data: rows });
        }
        if (method === 'POST') {
          const auth = this._requireActor(req, url);

          if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
          const lead = this.repo.readLead(leadId);
          const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
          if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

          const actor  = auth.actor;
          const result = this.txnSvc.createTransaction(leadId, body || {}, actor);
          return this._json(result.ok ? 201 : 400, result);
        }
      }

      if (sub === 'score' && method === 'POST') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const lead = this.repo.readLead(leadId);
        const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        const result = this.leadSvc.recalculateScore(leadId);
        return this._json(result.ok ? 200 : 404, result);
      }

      if (sub === 'score' && method === 'GET') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const lead = this.repo.readLead(leadId);
        const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        const result = this.scoringSvc.recalculateClientScore(leadId);
        return this._json(result.ok ? 200 : 404, result);
      }

      if (sub === 'tags') {
        if (method === 'POST') {
          const auth = this._requireActor(req, url);

          if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
          const lead = this.repo.readLead(leadId);
          const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
          if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

          const actor  = auth.actor;
          const tag    = (body && (body.tag || body.Tag)) || null;
          if (!tag) return this._json(400, { ok: false, error: 'tag is required' });
          const result = this.leadSvc.addTag(leadId, tag, actor);
          return this._json(result.ok ? 200 : 400, result);
        }
        if (method === 'DELETE' && subsub) {
          const auth = this._requireActor(req, url);

          if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
          const lead = this.repo.readLead(leadId);
          const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
          if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

          const actor  = auth.actor;
          const result = this.leadSvc.removeTag(leadId, subsub, actor);
          return this._json(result.ok ? 200 : 400, result);
        }
      }

      // /api/leads/:leadId/workspace — handled below by /api/clients/:id/workspace
      // Return null so legacy workspace handler still works
      return null;
    }

    // ── NEW: Client workspace (always active) ─────────────────────────────────
    const wsMatch = pathname.match(/^\/api\/clients\/([^/]+)\/workspace$/);
    if (wsMatch && method === 'GET') {
      const leadId = wsMatch[1];
      const auth = this._requireActor(req, url);
      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const lead = this.repo.readLead(leadId);
      const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
      if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error === 'Not found' ? 'Client not found' : access.error });
      const result = await this._buildClientWorkspace(leadId, auth.actor);
      return this._json(result.ok ? 200 : 404, result);
    }

    // ── NEW: Transaction sub-routes (always active) ───────────────────────────
    const txnReqMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/requirements$/);
    if (txnReqMatch) {
      const transactionId = txnReqMatch[1];
      if (method === 'GET') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const transaction = this.txnSvc.getTransaction(transactionId);
        const access = this.accessSvc.authorizeTransaction(auth.actor, transaction.ok ? transaction.data : null, { permissions: ['REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        const rows = this.reqSvc.listRequirementsByTransaction(transactionId);
        return this._ok({ ok: true, data: rows });
      }
      if (method === 'POST') {
        const auth = this._requireActor(req, url);

        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const transaction = this.txnSvc.getTransaction(transactionId);
        const access = this.accessSvc.authorizeTransaction(auth.actor, transaction.ok ? transaction.data : null, { permissions: ['REQUIREMENTS_CREATE', 'REQUIREMENTS_EDIT', 'REQUIREMENTS_UPDATE', 'LEADS_EDIT', 'LEADS_UPDATE'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

        const actor  = auth.actor;
        const result = this.reqSvc.createRequirement(transactionId, body || {}, actor);
        return this._json(result.ok ? 201 : 400, result);
      }
    }

    // GET /api/transactions/:id and PATCH /api/transactions/:id
    // The legacy server only has /api/transactions (list). These are new.
    const txnMatch = pathname.match(/^\/api\/transactions\/([^/]+)$/);
    if (txnMatch) {
      const txnId = txnMatch[1];
      if (method === 'GET') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const result = this.txnSvc.getTransaction(txnId);
        const access = this.accessSvc.authorizeTransaction(auth.actor, result.ok ? result.data : null, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        return this._json(result.ok ? 200 : 404, result);
      }
      if (method === 'PATCH') {
        const auth = this._requireActor(req, url);

        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const current = this.txnSvc.getTransaction(txnId);
        const access = this.accessSvc.authorizeTransaction(auth.actor, current.ok ? current.data : null, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

        const actor  = auth.actor;
        const result = this.txnSvc.updateTransaction(txnId, body || {}, actor);
        return this._json(result.ok ? 200 : 404, result);
      }
    }

    // ── NEW: V2 namespace routes (always active) ──────────────────────────────

    // ── Phase 8: Config sub-routes (must come BEFORE the /api/v2/config catch-all) ─

    if (pathname === '/api/v2/config/fields' && method === 'GET') {
      const filters = {};
      const txn = url.searchParams.get('transactionType') || url.searchParams.get('txnType');
      const cat = url.searchParams.get('category');
      const sub = url.searchParams.get('subCategory') || url.searchParams.get('subcategory');
      const tier = url.searchParams.get('tier');
      if (txn) filters.transactionType = txn;
      if (cat) filters.category = cat;
      if (sub) filters.subCategory = sub;
      if (tier) filters.tier = tier;
      const rows = this.configSvc.getFieldConfig(filters);
      return this._ok({ ok: true, data: rows, count: rows.length });
    }

    if (pathname === '/api/v2/config/questions' && method === 'GET') {
      const filters = {};
      const txn = url.searchParams.get('transactionType') || url.searchParams.get('txnType');
      const cat = url.searchParams.get('category');
      const sub = url.searchParams.get('subCategory') || url.searchParams.get('subcategory');
      const priority = url.searchParams.get('priority');
      if (txn) filters.transactionType = txn;
      if (cat) filters.category = cat;
      if (sub) filters.subCategory = sub;
      if (priority) filters.priority = priority;
      const rows = this.configSvc.getQuestionConfig(filters);
      return this._ok({ ok: true, data: rows, count: rows.length });
    }

    if (pathname === '/api/v2/config/scoring' && method === 'GET') {
      return this._ok({ ok: true, data: ScoringConfig });
    }

    if (pathname === '/api/v2/config/workflows' && method === 'GET') {
      return this._ok({ ok: true, data: WorkflowConfig });
    }

    // ── Phase 9: Form Registry + SubCategory routes ───────────────────────────

    if (pathname === '/api/v2/config/subcategories' && method === 'GET') {
      const category       = url.searchParams.get('category');
      const transactionType = url.searchParams.get('transactionType') || url.searchParams.get('txnType');
      if (!category) return this._json(400, { ok: false, error: 'category is required' });
      const data = this.registrySvc.getSubCategories(category, transactionType || null);
      return this._ok({ ok: true, data, count: data.length });
    }

    if (pathname === '/api/v2/config/categories' && method === 'GET') {
      const data = this.registrySvc.getCategories();
      return this._ok({ ok: true, data, count: data.length });
    }

    // GET /api/v2/config/forms/:formId  (specific form — must come before /forms list)
    const formByIdMatch = pathname.match(/^\/api\/v2\/config\/forms\/([^/]+)$/);
    if (formByIdMatch && method === 'GET') {
      const formId = formByIdMatch[1];
      const meta   = this.registrySvc.getFormById(formId);
      if (!meta) return this._json(404, { ok: false, error: `Form not found: ${formId}` });

      const resolved = this.registrySvc.resolveFormConfig(
        meta.TransactionType, meta.Category, meta.SubCategory
      );
      return this._ok({ ok: true, data: { ...meta, resolved } });
    }

    if (pathname === '/api/v2/config/forms' && method === 'GET') {
      const filters = {};
      const txn = url.searchParams.get('transactionType') || url.searchParams.get('txnType');
      const cat = url.searchParams.get('category');
      const sub = url.searchParams.get('subCategory') || url.searchParams.get('subcategory');
      const active = url.searchParams.get('active');
      if (txn)    filters.transactionType = txn;
      if (cat)    filters.category        = cat;
      if (sub)    filters.subCategory     = sub;
      if (active !== null && active !== undefined) filters.isActive = active !== 'false';
      const data = this.registrySvc.getAllForms(filters);
      return this._ok({ ok: true, data, count: data.length });
    }

    // ── Phase 12: Score routes ────────────────────────────────────────────────

    // GET /api/v2/requirements/:id/score  — V2 canonical path
    const reqScoreV2Match = pathname.match(/^\/api\/v2\/requirements\/([^/]+)\/score$/);
    if (reqScoreV2Match && method === 'GET') {
      const requirementId = reqScoreV2Match[1];
      const result = this.scoringSvc.recalculateRequirementScore(requirementId);
      return this._json(result.ok ? 200 : 404, result);
    }

    // GET /api/requirements/:id/score  — bare V1-compatible path
    const reqScoreMatch = pathname.match(/^\/api\/requirements\/([^/]+)\/score$/);
    if (reqScoreMatch && method === 'GET') {
      const requirementId = reqScoreMatch[1];
      const result = this.scoringSvc.recalculateRequirementScore(requirementId);
      return this._json(result.ok ? 200 : 404, result);
    }

    // GET /api/v2/leads/:id/score — V2 canonical path
    const leadScoreV2Match = pathname.match(/^\/api\/v2\/leads\/([^/]+)\/score$/);
    if (leadScoreV2Match && method === 'GET') {
      const leadId = leadScoreV2Match[1];
      const result = this.scoringSvc.recalculateClientScore(leadId);
      return this._json(result.ok ? 200 : 404, result);
    }

    // GET /api/leads/:id/score — bare path (returns score without mutating; POST stays for explicit recalc)
    const leadScoreMatch = pathname.match(/^\/api\/leads\/([^/]+)\/score$/);
    if (leadScoreMatch && method === 'GET') {
      const leadId = leadScoreMatch[1];
      const result = this.scoringSvc.recalculateClientScore(leadId);
      return this._json(result.ok ? 200 : 404, result);
    }

    // ── Phase 11: Next Question Engine routes ────────────────────────────────

    // GET /api/v2/requirements/:requirementId/next-questions
    const nextQMatch = pathname.match(/^\/api\/v2\/requirements\/([^/]+)\/next-questions$/);
    if (nextQMatch && method === 'GET') {
      const requirementId = nextQMatch[1];
      const limit         = url.searchParams.get('limit');
      const result        = this.nextQSvc.getNextQuestions(requirementId, { limit });
      return this._json(result.ok ? 200 : 404, result);
    }

    // ── Phase 10: Dependency Engine routes ───────────────────────────────────

    // GET /api/v2/dependencies/evaluate — evaluate field states for a context or requirementId
    if (pathname === '/api/v2/dependencies/evaluate' && method === 'GET') {
      const requirementId  = url.searchParams.get('requirementId');
      const txnType        = url.searchParams.get('transactionType') || url.searchParams.get('txnType');
      const category       = url.searchParams.get('category');
      const subCategory    = url.searchParams.get('subCategory') || url.searchParams.get('subcategory');

      if (requirementId) {
        // DB-backed evaluation from stored Requirement
        const result = this.depSvc.evaluateDependencies(requirementId);
        return this._json(result.ok ? 200 : 404, result);
      }

      // Direct context evaluation
      if (!txnType && !category) {
        return this._json(400, { ok: false, error: 'Provide requirementId or at least transactionType / category' });
      }
      const ctx = {
        transactionType: txnType    || null,
        category:        category   || null,
        subCategory:     subCategory || null,
        fields:          {}
      };
      const result = this.depSvc.evaluateContext(ctx);
      return this._json(result.ok ? 200 : 400, result);
    }

    // GET /api/v2/dependencies — list all active dependency rules
    if (pathname === '/api/v2/dependencies' && method === 'GET') {
      const txnType    = url.searchParams.get('transactionType') || url.searchParams.get('txnType');
      const category   = url.searchParams.get('category');
      const subCat     = url.searchParams.get('subCategory') || url.searchParams.get('subcategory');
      const target     = url.searchParams.get('targetField');
      const activeOnly = url.searchParams.get('active') !== 'false';
      const filters    = { isActive: activeOnly };
      if (txnType)   filters.transactionType = txnType;
      if (category)  filters.category        = category;
      if (subCat)    filters.subCategory     = subCat;
      if (target)    filters.targetField     = target;
      const data = this.depSvc.getDependencyRules(filters);
      return this._ok({ ok: true, data, count: data.length });
    }

    if (pathname === '/api/v2/requirements/global' && method === 'GET') {
      const filters = {
        RequirementStatus: url.searchParams.get('status') || undefined,
        PipelineStage:     url.searchParams.get('stage') || undefined,
        Category:          url.searchParams.get('category') || undefined,
        TransactionType:   url.searchParams.get('transactionType') || undefined
      };
      const rows = this.reqSvc.listGlobalRequirements(filters);
      return this._ok({ ok: true, data: rows, count: rows.length });
    }

    if (pathname === '/api/v2/config' && method === 'GET') {
      return this._ok({
        ok: true,
        data: {
          entityConfig:    EntityConfig,
          tagConfig:       TagConfig,
          workflowConfig:  WorkflowConfig,
          columnConfig:    ColumnConfig,
          sourceOptions:   SourceOptions,
          v2Enabled:       isV2Enabled()
        }
      });
    }

    if (pathname === '/api/v2/form-config' && method === 'GET') {
      const txnType     = url.searchParams.get('transactionType') || url.searchParams.get('txnType') || '';
      const category    = url.searchParams.get('category') || '';
      const subCategory = url.searchParams.get('subCategory') || url.searchParams.get('subcategory') || '';
      const resolved    = url.searchParams.get('resolved') !== 'false'; // default: full resolved config
      if (resolved && txnType) {
        // Phase 9: return full resolved config (fields + questions + dependencies)
        const data = this.registrySvc.resolveFormConfig(txnType, category, subCategory);
        return this._ok({ ok: true, data });
      }
      // Backward-compatible: return raw static form config
      const config = this.reqSvc.getFormConfig(txnType, category, subCategory);
      return this._ok({ ok: true, data: config });
    }

    if (pathname === '/api/v2/form-registry' && method === 'GET') {
      const keys = Object.keys(V2FormRegistry).map((key) => {
        const f = V2FormRegistry[key];
        return { key, formName: f.formName, transactionType: f.transactionType, category: f.category, subCategory: f.subCategory, isActive: f.isActive, formVersion: f.formVersion };
      });
      return this._ok({ ok: true, data: keys });
    }

    // ── SHARED routes — only active when LEAD_V2_ENABLED=true ────────────────
    // /api/v2/* canonical routes are ALWAYS active (never gated).
    // Only /api/leads and /api/requirements shared paths are gated.
    if (!isV2Enabled() && !pathname.startsWith('/api/v2/')) return null;

    // GET/POST /api/leads
    if (pathname === '/api/leads' && method === 'GET') {
      const auth = this._requireActor(req, url);
      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const permission = this.accessSvc.requirePermissions(auth.actor, ['LEADS_VIEW', 'LEADS_READ']);
      if (!permission.ok) return this._json(permission.statusCode, { ok: false, error: permission.error });

      const filters = {
        ClientStatus:    url.searchParams.get('status') || url.searchParams.get('clientStatus') || undefined,
        ClientLifecycle: url.searchParams.get('lifecycle') || undefined,
        AssignedAgentID: url.searchParams.get('agentId') || url.searchParams.get('assignedAgentId') || undefined,
        tag:             url.searchParams.get('tag') || undefined,
        source:          url.searchParams.get('source') || undefined,
        search:          url.searchParams.get('search') || url.searchParams.get('q') || undefined
      };
      const data = this.accessSvc.filterReadableLeads(this.leadSvc.listLeads(filters), auth.actor);
      return this._ok({ ok: true, data, count: data.length });
    }

    if (pathname === '/api/leads' && method === 'POST') {
      const allowPossible = (body && body.confirmDuplicate === true) || false;
      const auth = this._requireActor(req, url);

      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });

      const actor  = auth.actor;
      const result = this.leadSvc.createLead(body || {}, actor, { allowPossibleDuplicate: allowPossible });
      if (!result.ok && result.duplicateResult) {
        return this._json(409, result);
      }
      return this._json(result.ok ? 201 : 400, result);
    }

    // GET/PATCH /api/leads/:id  (simple — no sub-path)
    const leadIdMatch = pathname.match(/^\/api\/leads\/([^/]+)$/);
    if (leadIdMatch) {
      const leadId = leadIdMatch[1];
      if (method === 'GET') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const lead = this.repo.readLead(leadId);
        const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error === 'Not found' ? 'Lead not found' : access.error });
        return this._ok({ ok: true, data: lead });
      }
      if (method === 'PATCH') {
        const auth = this._requireActor(req, url);

        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const lead = this.repo.readLead(leadId);
        const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

        const actor  = auth.actor;
        const result = this.leadSvc.updateLead(leadId, body || {}, actor);
        return this._json(result.ok ? 200 : 404, result);
      }
    }

    // GET /api/requirements  (list)
    if (pathname === '/api/requirements' && method === 'GET') {
      const auth = this._requireActor(req, url);
      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const permission = this.accessSvc.requirePermissions(auth.actor, ['REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ']);
      if (!permission.ok) return this._json(permission.statusCode, { ok: false, error: permission.error });
      const filters = {
        LeadID:            url.searchParams.get('leadId') || undefined,
        TransactionID:     url.searchParams.get('transactionId') || undefined,
        RequirementStatus: url.searchParams.get('status') || undefined,
        PipelineStage:     url.searchParams.get('stage') || undefined,
        Category:          url.searchParams.get('category') || undefined,
        TransactionType:   url.searchParams.get('transactionType') || undefined
      };
      const rows = this.reqSvc.listAllRequirements(filters).filter((row) => this.accessSvc.authorizeRequirement(auth.actor, row, { skipPermission: true }).ok);
      return this._ok({ ok: true, data: rows });
    }

    // GET/PATCH /api/requirements/:id
    const reqIdMatch = pathname.match(/^\/api\/requirements\/([^/]+)$/);
    if (reqIdMatch) {
      const reqId = reqIdMatch[1];
      if (method === 'GET') {
        const result = this.reqSvc.getRequirement(reqId);
        return this._json(result.ok ? 200 : 404, result);
      }
      if (method === 'PATCH') {
        const auth = this._requireActor(req, url);

        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });

        const actor  = auth.actor;
        const result = this.reqSvc.updateRequirement(reqId, body || {}, actor);
        return this._json(result.ok ? 200 : 404, result);
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CANONICAL V2 API (Phases 15, 16, 17) — always active
    // ══════════════════════════════════════════════════════════════════════════

    // ── /api/v2/clients/check-duplicate ──────────────────────────────────────
    if (pathname === '/api/v2/clients/check-duplicate' && method === 'POST') {
      const auth = this._requireActor(req, url);
      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const permission = this.accessSvc.requirePermissions(auth.actor, ['LEADS_CREATE']);
      if (!permission.ok) return this._json(permission.statusCode, { ok: false, error: permission.error });

      const result = this.leadSvc.checkDuplicate(body || {});
      const visibleCandidates = (result.candidates || []).filter((candidate) => {
        const lead = this.repo.readLead(candidate.LeadID);
        return lead && this.accessSvc.canAccessLeadRecord(lead, auth.actor);
      });
      if (!visibleCandidates.length) return this._ok({ ok: true, result: 'NO_MATCH', candidates: [] });
      return this._ok({ ok: true, ...result, candidates: visibleCandidates });
    }

    // ── Phase 13: atomic New Client Quick Capture ────────────────────────────
    if (pathname === '/api/v2/quick-capture' && method === 'POST') {
      const auth = this._requireActor(req, url);
      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      for (const requiredPermission of ['LEADS_CREATE', 'REQUIREMENTS_CREATE']) {
        const permission = this.accessSvc.requirePermissions(auth.actor, [requiredPermission]);
        if (!permission.ok) return this._json(permission.statusCode, { ok: false, error: permission.error });
      }
      const result = this.quickCaptureSvc.capture(body || {}, auth.actor);
      return this._json(result.statusCode || (result.ok ? 201 : 400), result);
    }

    // ── /api/v2/clients/query  (need-based client query — Phase 15) ──────────
    if (pathname === '/api/v2/clients/query' && method === 'GET') {
      const auth = this._requireActor(req, url);
      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const permission = this.accessSvc.requirePermissions(auth.actor, ['LEADS_VIEW', 'LEADS_READ']);
      if (!permission.ok) return this._json(permission.statusCode, { ok: false, error: permission.error });
      return this._ok(this._queryClients(url, auth.actor));
    }
    if (pathname === '/api/v2/clients/query' && method === 'POST') {
      const auth = this._requireActor(req, url);
      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const permission = this.accessSvc.requirePermissions(auth.actor, ['LEADS_VIEW', 'LEADS_READ']);
      if (!permission.ok) return this._json(permission.statusCode, { ok: false, error: permission.error });
      const filters = body || {};
      return this._ok(this._queryClientsByNeed(filters, auth.actor));
    }

    // ── /api/v2/clients  (list + create) ─────────────────────────────────────
    if (pathname === '/api/v2/clients' && method === 'GET') {
      const auth = this._requireActor(req, url);
      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const permission = this.accessSvc.requirePermissions(auth.actor, ['LEADS_VIEW', 'LEADS_READ']);
      if (!permission.ok) return this._json(permission.statusCode, { ok: false, error: permission.error });
      const filters = {
        ClientStatus:    url.searchParams.get('status')     || undefined,
        ClientLifecycle: url.searchParams.get('lifecycle')  || undefined,
        AssignedAgentID: url.searchParams.get('agentId')    || undefined,
        tag:             url.searchParams.get('tag')        || undefined,
        source:          url.searchParams.get('source')     || undefined,
        search:          url.searchParams.get('q')          || url.searchParams.get('search') || undefined
      };
      const raw    = this.accessSvc.filterReadableLeads(this.leadSvc.listLeads(filters), auth.actor);
      const data   = this._enrichClientsForList(raw);
      return this._ok({ ok: true, data, count: data.length });
    }
    if (pathname === '/api/v2/clients' && method === 'POST') {
      const allowPossible = !!(body && body.confirmDuplicate);
      const auth = this._requireActor(req, url);

      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });

      const actor  = auth.actor;
      const result = this.leadSvc.createLead(body || {}, actor, { allowPossibleDuplicate: allowPossible });
      if (!result.ok && result.duplicateResult) return this._json(409, result);
      return this._json(result.ok ? 201 : 400, result);
    }

    // ── /api/v2/clients/:id/...  (sub-routes first) ───────────────────────────
    const v2ClientSubMatch = pathname.match(/^\/api\/v2\/clients\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/);
    if (v2ClientSubMatch) {
      const [, leadId, sub, subsub] = v2ClientSubMatch;

      // Workspace
      if (sub === 'workspace' && method === 'GET') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const lead = this.repo.readLead(leadId);
        const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error === 'Not found' ? 'Client not found' : access.error });
        const result = await this._buildClientWorkspace(leadId, auth.actor);
        return this._json(result.ok ? 200 : 404, result);
      }

      // Transactions
      if (sub === 'transactions') {
        if (method === 'GET') {
          const auth = this._requireActor(req, url);
          if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
          const lead = this.repo.readLead(leadId);
          const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
          if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
          const rows = this.txnSvc.listTransactionsByLead(leadId);
          return this._ok({ ok: true, data: rows });
        }
        if (method === 'POST') {
          const auth = this._requireActor(req, url);

          if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
          const lead = this.repo.readLead(leadId);
          const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
          if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

          const actor  = auth.actor;
          const result = this.txnSvc.createTransaction(leadId, body || {}, actor);
          return this._json(result.ok ? 201 : 400, result);
        }
      }

      // Activities (Phase 16)
      if (sub === 'activities') {
        if (method === 'GET') {
          const auth = this._requireActor(req, url);
          if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
          const lead = this.repo.readLead(leadId);
          const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
          if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
          const result = this.actSvc.listActivitiesByLead(leadId, {
            limit: url.searchParams.get('limit') || 50
          });
          return this._json(result.ok ? 200 : 404, result);
        }
      }

      // Follow-ups
      if (sub === 'followups' || sub === 'follow-ups') {
        if (method === 'GET') {
          const auth = this._requireActor(req, url);
          if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
          const lead = this.repo.readLead(leadId);
          const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
          if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
          const preset = url.searchParams.get('preset') || undefined;
          const result = this.fuSvc.listFollowUps({
            LeadID: leadId,
            preset,
            Status: url.searchParams.get('status') || undefined,
            limit: url.searchParams.get('limit') || undefined
          });
          return this._json(result.ok ? 200 : 404, result);
        }
      }

      if (sub === 'lost' && method === 'POST') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const lead = this.repo.readLead(leadId);
        const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        const result = this.leadSvc.markLeadLost(leadId, body || {}, auth.actor);
        return this._json(result.ok ? 200 : 400, result);
      }

      if (sub === 'reactivate' && method === 'POST') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const lead = this.repo.readLead(leadId);
        const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        const result = this.leadSvc.reactivateLead(leadId, body || {}, auth.actor);
        return this._json(result.ok ? 200 : 400, result);
      }

      // Score
      if (sub === 'score' && method === 'GET') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const lead = this.repo.readLead(leadId);
        const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        const result = this.scoringSvc.recalculateClientScore(leadId, this.txnSvc, this.reqSvc);
        return this._json(result.ok ? 200 : 404, result);
      }
    }

    // ── /api/v2/clients/:id  (single client) ─────────────────────────────────
    const v2ClientMatch = pathname.match(/^\/api\/v2\/clients\/([^/]+)$/);
    if (v2ClientMatch) {
      const leadId = v2ClientMatch[1];
      if (method === 'GET') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const lead = this.repo.readLead(leadId);
        if (!lead) return this._json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Client not found' } });
        const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error === 'Not found' ? { code: 'NOT_FOUND', message: 'Client not found' } : access.error });
        return this._ok({ ok: true, data: lead });
      }
      if (method === 'PATCH') {
        const auth = this._requireActor(req, url);

        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const lead = this.repo.readLead(leadId);
        const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

        const actor  = auth.actor;
        const result = this.leadSvc.updateLead(leadId, body || {}, actor);
        return this._json(result.ok ? 200 : 404, result);
      }
    }

    // ── /api/v2/transactions/:id/requirements  (sub first) ───────────────────
    const v2TxnReqMatch = pathname.match(/^\/api\/v2\/transactions\/([^/]+)\/requirements$/);
    if (v2TxnReqMatch) {
      const transactionId = v2TxnReqMatch[1];
      if (method === 'GET') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const transaction = this.txnSvc.getTransaction(transactionId);
        const access = this.accessSvc.authorizeTransaction(auth.actor, transaction.ok ? transaction.data : null, { permissions: ['REQUIREMENTS_VIEW', 'REQUIREMENTS_READ', 'LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        const rows = this.reqSvc.listRequirementsByTransaction(transactionId);
        return this._ok({ ok: true, data: rows });
      }
      if (method === 'POST') {
        const auth = this._requireActor(req, url);

        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const transaction = this.txnSvc.getTransaction(transactionId);
        const access = this.accessSvc.authorizeTransaction(auth.actor, transaction.ok ? transaction.data : null, { permissions: ['REQUIREMENTS_CREATE', 'REQUIREMENTS_EDIT', 'REQUIREMENTS_UPDATE', 'LEADS_EDIT', 'LEADS_UPDATE'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

        const actor  = auth.actor;
        const result = this.reqSvc.createRequirement(transactionId, body || {}, actor);
        return this._json(result.ok ? 201 : 400, result);
      }
    }

    // ── /api/v2/transactions/:id  ─────────────────────────────────────────────
    const v2TxnMatch = pathname.match(/^\/api\/v2\/transactions\/([^/]+)$/);
    if (v2TxnMatch) {
      const txnId = v2TxnMatch[1];
      if (method === 'GET') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const result = this.txnSvc.getTransaction(txnId);
        const access = this.accessSvc.authorizeTransaction(auth.actor, result.ok ? result.data : null, { permissions: ['LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        return this._json(result.ok ? 200 : 404, result);
      }
      if (method === 'PATCH') {
        const auth = this._requireActor(req, url);

        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const current = this.txnSvc.getTransaction(txnId);
        const access = this.accessSvc.authorizeTransaction(auth.actor, current.ok ? current.data : null, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

        const actor  = auth.actor;
        const result = this.txnSvc.updateTransaction(txnId, body || {}, actor);
        return this._json(result.ok ? 200 : 404, result);
      }
    }

    // ── /api/v2/requirements/:id/next-questions — already handled above ───────
    // ── /api/v2/requirements/:id/score          — already handled above ───────
    // ── /api/v2/requirements/:id/activities (Phase 16) ───────────────────────
    const v2ReqSubMatch = pathname.match(/^\/api\/v2\/requirements\/([^/]+)\/activities$/);
    if (v2ReqSubMatch && method === 'GET') {
      const auth = this._requireActor(req, url);
      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const requirement = this.reqSvc.getRequirement(v2ReqSubMatch[1]);
      const access = this.accessSvc.authorizeRequirement(auth.actor, requirement.ok ? requirement.data : null);
      if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
      const result = this.actSvc.listActivitiesByRequirement(v2ReqSubMatch[1]);
      return this._json(result.ok ? 200 : 404, result);
    }

    // ── /api/v2/requirements/:id  ─────────────────────────────────────────────
    const v2ReqMatch = pathname.match(/^\/api\/v2\/requirements\/([^/]+)$/);
    if (v2ReqMatch) {
      const reqId = v2ReqMatch[1];
      if (method === 'GET') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const result = this.reqSvc.getRequirement(reqId);
        const access = this.accessSvc.authorizeRequirement(auth.actor, result.ok ? result.data : null);
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        return this._json(result.ok ? 200 : 404, result);
      }
      if (method === 'PATCH') {
        const auth = this._requireActor(req, url);

        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const current = this.reqSvc.getRequirement(reqId);
        const access = this.accessSvc.authorizeRequirement(auth.actor, current.ok ? current.data : null, { permissions: ['REQUIREMENTS_EDIT', 'REQUIREMENTS_UPDATE', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

        const actor  = auth.actor;
        const result = this.reqSvc.updateRequirement(reqId, body || {}, actor);
        return this._json(result.ok ? 200 : 404, result);
      }
    }

    // ── Phase 16: Activity routes ─────────────────────────────────────────────
    if (pathname === '/api/v2/activities' && method === 'POST') {
      const auth = this._requireActor(req, url);

      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const lead = this.repo.readLead(body?.LeadID);
      const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
      if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
      if (body?.RequirementID) {
        const requirement = this.reqSvc.getRequirement(body.RequirementID);
        const reqAccess = this.accessSvc.authorizeRequirement(auth.actor, requirement.ok ? requirement.data : null, { permissions: ['REQUIREMENTS_EDIT', 'REQUIREMENTS_UPDATE', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ'] });
        if (!reqAccess.ok) return this._json(reqAccess.statusCode, { ok: false, error: reqAccess.error });
      }

      const actor  = auth.actor;
      const result = this.actSvc.createActivity(body || {}, actor);
      return this._json(result.ok ? 201 : 400, result);
    }

    const v2ActMatch = pathname.match(/^\/api\/v2\/activities\/([^/]+)$/);
    if (v2ActMatch) {
      const activityId = v2ActMatch[1];
      if (method === 'GET') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const result = this.actSvc.getActivity(activityId);
        const access = this.accessSvc.authorizeActivity(auth.actor, result.ok ? result.data : null);
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        return this._json(result.ok ? 200 : 404, result);
      }
      if (method === 'PATCH') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const current = this.actSvc.getActivity(activityId);
        const access = this.accessSvc.authorizeActivity(auth.actor, current.ok ? current.data : null, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        const result = this.actSvc.updateActivity(activityId, body || {}, auth.actor);
        return this._json(result.ok ? 200 : 400, result);
      }
    }

    // ── Phase 16: Follow-up routes ────────────────────────────────────────────
    if (pathname === '/api/v2/followups' && method === 'POST') {
      const auth = this._requireActor(req, url);

      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const lead = this.repo.readLead(body?.LeadID);
      const access = this.accessSvc.authorizeLead(auth.actor, lead, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
      if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
      if (body?.RequirementID) {
        const requirement = this.reqSvc.getRequirement(body.RequirementID);
        const reqAccess = this.accessSvc.authorizeRequirement(auth.actor, requirement.ok ? requirement.data : null, { permissions: ['REQUIREMENTS_EDIT', 'REQUIREMENTS_UPDATE', 'REQUIREMENTS_VIEW', 'REQUIREMENTS_READ'] });
        if (!reqAccess.ok) return this._json(reqAccess.statusCode, { ok: false, error: reqAccess.error });
      }

      const actor  = auth.actor;
      const result = this.fuSvc.createFollowUp(body || {}, actor);
      return this._json(result.ok ? 201 : 400, result);
    }
    if (pathname === '/api/v2/followups' && method === 'GET') {
      const auth = this._requireActor(req, url);
      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const permission = this.accessSvc.requirePermissions(auth.actor, ['LEADS_VIEW', 'LEADS_READ']);
      if (!permission.ok) return this._json(permission.statusCode, { ok: false, error: permission.error });
      const filters = {
        LeadID:          url.searchParams.get('leadId')        || undefined,
        TransactionID:   url.searchParams.get('transactionId') || undefined,
        RequirementID:   url.searchParams.get('requirementId') || undefined,
        AssignedTo:      url.searchParams.get('assignedTo')    || undefined,
        Status:          url.searchParams.get('status')        || undefined,
        preset:          url.searchParams.get('preset')        || undefined,
        limit:           url.searchParams.get('limit')         || undefined
      };
      const result = this.fuSvc.listFollowUps(filters);
      if (result.ok) {
        result.data = (Array.isArray(result.data) ? result.data : []).filter((row) => this.accessSvc.authorizeFollowUp(auth.actor, row, { skipPermission: true }).ok);
        result.total = result.data.length;
      }
      return this._ok(result);
    }

    const v2FuSubMatch = pathname.match(/^\/api\/v2\/followups\/([^/]+)\/(complete|cancel)$/);
    if (v2FuSubMatch && method === 'POST') {
      const [, fuId, action] = v2FuSubMatch;
      const auth = this._requireActor(req, url);

      if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
      const followUp = this.fuSvc.getFollowUp(fuId);
      const access = this.accessSvc.authorizeFollowUp(auth.actor, followUp.ok ? followUp.data : null, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
      if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

      const actor  = auth.actor;
      const result = action === 'complete'
        ? this.fuSvc.completeFollowUp(fuId, actor)
        : this.fuSvc.cancelFollowUp(fuId, actor);
      return this._json(result.ok ? 200 : 400, result);
    }

    const v2FuMatch = pathname.match(/^\/api\/v2\/followups\/([^/]+)$/);
    if (v2FuMatch) {
      const fuId = v2FuMatch[1];
      if (method === 'GET') {
        const auth = this._requireActor(req, url);
        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const result = this.fuSvc.getFollowUp(fuId);
        const access = this.accessSvc.authorizeFollowUp(auth.actor, result.ok ? result.data : null);
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });
        return this._json(result.ok ? 200 : 404, result);
      }
      if (method === 'PATCH') {
        const auth = this._requireActor(req, url);

        if (!auth.ok) return this._json(auth.statusCode, { ok: false, error: auth.error });
        const followUp = this.fuSvc.getFollowUp(fuId);
        const access = this.accessSvc.authorizeFollowUp(auth.actor, followUp.ok ? followUp.data : null, { permissions: ['LEADS_EDIT', 'LEADS_UPDATE', 'LEADS_VIEW', 'LEADS_READ'] });
        if (!access.ok) return this._json(access.statusCode, { ok: false, error: access.error });

        const actor  = auth.actor;
        const result = this.fuSvc.updateFollowUp(fuId, body || {}, actor);
        return this._json(result.ok ? 200 : 400, result);
      }
    }

    // Not handled
    return null;
  }

  // ── Client query helpers (Phase 15) ─────────────────────────────────────────

  /**
   * GET /api/v2/clients/query — need-based client query
   * Params: transactionType, category, subCategory, budgetMin, budgetMax, location, bhk, q
   */
  _queryClients(url, actor = null) {
    const txnType   = url.searchParams.get('transactionType') || url.searchParams.get('type');
    const category  = url.searchParams.get('category');
    const subCat    = url.searchParams.get('subCategory')    || url.searchParams.get('subcat');
    const budgetMin = url.searchParams.get('budgetMin') ? Number(url.searchParams.get('budgetMin')) : null;
    const budgetMax = url.searchParams.get('budgetMax') ? Number(url.searchParams.get('budgetMax')) : null;
    const location  = url.searchParams.get('location');
    const bhk       = url.searchParams.get('bhk') ? Number(url.searchParams.get('bhk')) : null;
    const q         = url.searchParams.get('q') || url.searchParams.get('search');

    return this._queryClientsByNeed({ txnType, category, subCategory: subCat, budgetMin, budgetMax, location, bhk, q }, actor);
  }

  _queryClientsByNeed(filters = {}, actor = null) {
    const db   = this.repo.read();
    const reqs = db.Requirements || [];
    const leads = db.Leads || [];
    const txns  = db.Transactions || [];

    // Find requirements matching filters
    const matchingLeadIds = new Set();

    for (const req of reqs) {
      if (!this._reqMatchesFilters(req, filters, txns)) continue;
      if (req.LeadID) matchingLeadIds.add(req.LeadID);
    }

    // If no need-filters specified, return all clients enriched
    const sourceLeads = (filters.txnType || filters.category || filters.subCategory ||
                         filters.budgetMin || filters.budgetMax || filters.location ||
                         filters.bhk || filters.q)
      ? leads.filter(l => matchingLeadIds.has(l.LeadID))
      : leads;

    // Text search on lead fields
    let result = sourceLeads;
    if (filters.q) {
      const q = String(filters.q).toLowerCase();
      result = result.filter(l => {
        const name   = (l.ClientName || l.Name || '').toLowerCase();
        const mobile = (l.PrimaryMobile || l.Phone || '').replace(/\D/g, '');
        const email  = (l.Email || '').toLowerCase();
        const lid    = (l.LeadID || '').toLowerCase();
        const qDigits = q.replace(/\D/g, '');
        return name.includes(q) || (qDigits && mobile.includes(qDigits)) || email.includes(q) || lid.includes(q);
      });
    }

    // Deduplicate by LeadID
    const seen = new Set();
    const deduped = [];
    for (const l of result) {
      if (!seen.has(l.LeadID)) { seen.add(l.LeadID); deduped.push(l); }
    }

    const enriched = this._enrichClientsForList(actor ? this.accessSvc.filterReadableLeads(deduped, actor) : deduped);
    return { ok: true, data: enriched, count: enriched.length, filters };
  }

  _reqMatchesFilters(req, filters, txns) {
    if (filters.txnType) {
      const reqTxnType = req.TransactionType || (txns.find(t => t.TransactionID === req.TransactionID) || {}).TransactionType;
      if (reqTxnType && reqTxnType.toLowerCase() !== String(filters.txnType).toLowerCase()) return false;
    }
    if (filters.category && req.Category && req.Category.toLowerCase() !== String(filters.category).toLowerCase()) return false;
    if (filters.subCategory && req.SubCategory && req.SubCategory.toLowerCase() !== String(filters.subCategory).toLowerCase()) return false;

    // Budget filters (Fields.BudgetMax or flat)
    if (filters.budgetMin != null || filters.budgetMax != null) {
      const bMax = req.Fields?.BudgetMax?.value ?? req.BudgetMax;
      const bMin = req.Fields?.BudgetMin?.value ?? req.BudgetMin;
      if (filters.budgetMax != null && bMin != null && bMin > filters.budgetMax) return false;
      if (filters.budgetMin != null && bMax != null && bMax < filters.budgetMin) return false;
    }

    // Location
    if (filters.location) {
      const loc = filters.location.toLowerCase();
      const l1 = (req.Fields?.Location1?.value ?? req.Location1 ?? '').toLowerCase();
      const l2 = (req.Fields?.Location2?.value ?? req.Location2 ?? '').toLowerCase();
      if (l1 && !l1.includes(loc) && l2 && !l2.includes(loc)) return false;
    }

    // BHK
    if (filters.bhk != null) {
      const bhkMin = req.Fields?.BHKMin?.value ?? req.BHKMin;
      if (bhkMin != null && Number(bhkMin) < Number(filters.bhk)) return false;
    }

    return true;
  }

  /**
   * Enrich a list of leads with their active-need summary.
   */
  _enrichClientsForList(leads) {
    const db   = this.repo.read();
    const reqs = db.Requirements || [];
    const txns = db.Transactions || [];
    const fus  = db.FollowUps   || [];
    const acts = db.Activities  || [];

    return leads.map(lead => {
      const leadReqs = reqs.filter(r => r.LeadID === lead.LeadID);
      const leadTxns = txns.filter(t => t.LeadID === lead.LeadID);
      const pending  = fus.filter(f => f.LeadID === lead.LeadID && f.Status !== 'COMPLETED' && f.Status !== 'CANCELLED')
        .sort((a, b) => new Date(a.DueAt || a.DueDate || '').getTime() - new Date(b.DueAt || b.DueDate || '').getTime());

      const lastAct = acts
        .filter(a => a.LeadID === lead.LeadID)
        .sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime())[0];

      // Active need summaries (up to 3)
      const needSummaries = leadReqs.slice(0, 3).map(r => {
        const txn      = leadTxns.find(t => t.TransactionID === r.TransactionID);
        const budMin   = r.Fields?.BudgetMin?.value ?? r.BudgetMin;
        const budMax   = r.Fields?.BudgetMax?.value ?? r.BudgetMax;
        const loc1     = r.Fields?.Location1?.value ?? r.Location1;
        const loc2     = r.Fields?.Location2?.value ?? r.Location2;
        const bhkMin   = r.Fields?.BHKMin?.value    ?? r.BHKMin ?? r.BHK;
        const rpsfMin  = r.Fields?.RatePerSqFtMin?.value ?? r.RatePerSqFtMin;
        const rpsfMax  = r.Fields?.RatePerSqFtMax?.value ?? r.RatePerSqFtMax;
        const society  = r.Fields?.SocietyName?.value ?? r.SocietyName;
        const carpet   = r.Fields?.CarpetArea?.value ?? r.CarpetArea;
        return {
          RequirementID:   r.RequirementID,
          TransactionType: r.TransactionType || txn?.TransactionType,
          Category:        r.Category,
          SubCategory:     r.SubCategory,
          BudgetMin:       budMin,
          BudgetMax:       budMax,
          Location:        loc1,
          Location1:       loc1,
          Location2:       loc2,
          BHK:             bhkMin,
          RatePerSqFtMin:  rpsfMin,
          RatePerSqFtMax:  rpsfMax,
          SocietyName:     society,
          CarpetArea:      carpet,
          Score:           r.RequirementScore
        };
      });

      return {
        ...lead,
        _activeNeeds:    leadReqs.length,
        _needSummaries:  needSummaries,
        _moreNeeds:      Math.max(0, leadReqs.length - 3),
        _nextFollowUp:   pending[0] ? (pending[0].DueAt || pending[0].DueDate) : null,
        _lastContact:    lastAct ? lastAct.CreatedAt : lead.last_activity_at || null
      };
    });
  }

  // ── Client Workspace ──────────────────────────────────────────────────────

  async _buildClientWorkspace(leadId, actor = null) {
    const lead = this.repo.readLead(leadId);
    if (!lead) return { ok: false, error: 'Client not found' };

    const transactions = this.txnSvc.listTransactionsByLead(leadId);
    const requirements = this.reqSvc.listRequirementsByLead(leadId);
    const requirementIds = new Set((requirements || []).map((r) => r.RequirementID).filter(Boolean));

    const txnWithReqs = transactions.map((txn) => ({
      ...txn,
      requirements: requirements.filter((r) => r.TransactionID === txn.TransactionID)
    }));

    const db       = this.repo.read();
    const activities = (db.Activities || []).filter((a) => a.LeadID === leadId).sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());
    const followUpResult = this.fuSvc.listFollowUps({ LeadID: leadId, limit: 200 });
    const followUps = followUpResult.ok ? followUpResult.data : [];
    const timeline   = (db.Timeline || []).filter((t) => t.LeadID === leadId).sort((a, b) => new Date(b.EventDate).getTime() - new Date(a.EventDate).getTime());
    const transactionIds = new Set((transactions || []).map((row) => row.TransactionID).filter(Boolean));
    const docContext = {
      companyId: String(actor?.companyId || actor?.companyID || lead.CompanyID || '').trim(),
      brokerageId: String(actor?.brokerageId || actor?.brokerageID || lead.BrokerageID || '').trim()
    };
    const leadDocsResult = await this.documentSvc.listDocuments({ EntityType: 'Lead', EntityID: leadId }, actor || {}, docContext);
    const requirementDocs = [];
    const transactionDocs = [];
    for (const id of Array.from(requirementIds)) {
      const result = await this.documentSvc.listDocuments({ EntityType: 'Requirement', EntityID: id }, actor || {}, docContext);
      if (result.ok && Array.isArray(result.data)) requirementDocs.push(...result.data);
    }
    for (const id of Array.from(transactionIds)) {
      const result = await this.documentSvc.listDocuments({ EntityType: 'Transaction', EntityID: id }, actor || {}, docContext);
      if (result.ok && Array.isArray(result.data)) transactionDocs.push(...result.data);
    }
    const leadDocs = leadDocsResult.ok && Array.isArray(leadDocsResult.data) ? leadDocsResult.data : [];
    const documents = [];
    const seenDocumentIds = new Set();
    for (const doc of [...leadDocs, ...requirementDocs, ...transactionDocs]) {
      const key = doc?.DocumentID || `${doc?.EntityType || 'Unknown'}:${doc?.EntityID || ''}:${documents.length}`;
      if (seenDocumentIds.has(key)) continue;
      seenDocumentIds.add(key);
      documents.push(doc);
    }
    const siteVisits = (db.SiteVisits || []).filter((row) => row.LeadID === leadId);
    const negotiations = (db.Negotiations || []).filter((row) => row.LeadID === leadId);
    const deals = (db.Deals || []).filter((row) => row.LeadID === leadId);
    const commissions = (db.Commission || []).filter((row) => row.LeadID === leadId);
    const dealIds = new Set(deals.map((deal) => deal.DealID).filter(Boolean));
    const payments = (db.Payments || []).filter((row) => {
      if (!row || typeof row !== 'object') return false;
      if (row.DealID && dealIds.has(row.DealID)) return true;
      if (row.LeadID && row.LeadID === leadId) return true;
      if (row.TransactionID && transactionIds.has(row.TransactionID)) return true;
      return false;
    });
    const matching = (db.Matches || []).filter((row) => requirementIds.has(row.RequirementID));
    const shortlist = (db.Shortlists || []).filter((row) => requirementIds.has(row.RequirementID));

    return {
      ok:   true,
      data: {
        lead,
        transactions:  txnWithReqs,
        requirements,
        activities,
        followUps,
        timeline,
        documents,
        siteVisits,
        negotiations,
        deals,
        commissions,
        payments,
        matching,
        shortlist,
        summary: {
          transactionCount:  transactions.length,
          requirementCount:  requirements.length,
          activeRequirements: requirements.filter((r) => (r.RequirementStatus || r.Status) === 'Active').length,
          pendingFollowUps:   followUps.filter((f) => !['COMPLETED', 'CANCELLED'].includes(String(f.status || f.Status || '').toUpperCase())).length
        }
      }
    };
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  _actor(req, url) {
    if (!this.actorResolver) {
      const headers = req?.headers || {};
      const userId = headers['x-user-id'] || headers['x-userid'] || '';
      if (!userId) return null;
      return {
        userId: String(userId).trim(),
        role: String(headers['x-user-role'] || 'AGENT').trim().toUpperCase(),
        companyId: String(headers['x-company-id'] || headers['x-companyid'] || '').trim(),
        brokerageId: String(headers['x-brokerage-id'] || headers['x-brokerageid'] || '').trim(),
        permissions: Array.isArray(headers['x-permissions']) ? headers['x-permissions'] : []
      };
    }
    return this.actorResolver(req, url) || null;
  }

  _requireActor(req, url) {
    const actor = this._actor(req, url);
    if (!actor || !actor.userId) {
      return { ok: false, statusCode: 401, error: 'Unauthorized' };
    }
    return { ok: true, actor };
  }

  _ok(body) {
    return { handled: true, statusCode: 200, body };
  }

  _json(statusCode, body) {
    return { handled: true, statusCode, body };
  }
}

module.exports = { V2Router, isV2Enabled };
