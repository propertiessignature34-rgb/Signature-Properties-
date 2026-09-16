# Signature Realty OS — Project Architecture

> **⚠️ ARCHITECTURE REVISED (Aug 2026):** The form-centric V2 design below is superseded by the approved client-centric, progressive-capture V2 architecture. See **`docs/V2-BLUEPRINT.md`** — it is authoritative wherever the two conflict. Key changes: minimal client creation (no big forms), three-state fields (UNKNOWN/KNOWN/NOT_APPLICABLE — UNKNOWN never means NO), tiered completeness (Core/Important/Optional), "Needs" UX terminology, QuestionConfig/Next-Best-Question engine, and a mandatory phase-gate (stop + report + await approval after every phase).

## What this project is

A **full-stack real-estate brokerage CRM** built in Node.js with a vanilla HTML/CSS/JS frontend. It manages the complete lead-to-deal lifecycle: leads → transactions → requirements → matching → site visits → negotiation → token → deal → commission → closing.

All data is persisted in a single JSON file (`data/sig-realty-db.json`). No external database or framework is used.

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20 (CommonJS) |
| HTTP server | Built-in `node:http` |
| Database | JSON file (`data/sig-realty-db.json`) via `JsonRepository` |
| Frontend | Vanilla HTML + CSS + JavaScript (no framework) |
| Testing | Node.js built-in test runner (`node:test`) + Playwright (e2e) |
| Port | `5000` in the Replit preview workflow (or `process.env.PORT`) |

---

## Domain model (canonical)

```
CLIENT ──── LEAD ──── TRANSACTION ──── REQUIREMENT
              │               │
              │               └── SITE VISIT
              │               └── NEGOTIATION → TOKEN → DEAL
              │               └── MATCHING ← INVENTORY/PROPERTY
              │
              ├── ACTIVITY
              ├── FOLLOW-UP
              ├── TIMELINE
              └── DOCUMENT / MEDIA
```

### Invariants (must never be broken)

- **One Client = One Lead.** Client and Lead are the same record; there is no separate Client entity.
- **Transaction belongs to exactly one Lead.**
- **Requirement belongs to exactly one Transaction AND one Lead.** `Requirement.LeadID` must always equal `Transaction.LeadID` — enforced at creation time.
- **Requirement must never embed Inventory/Property data.** Requirements describe what the buyer/tenant wants; Inventory describes what exists. Matching is a separate entity that links them.
- **FormVersion is immutable** after a Requirement is created (captures the form schema at submission time).

---

## V2 ID format

All V2 entities use zero-padded sequential IDs:

| Entity | Format | Example |
|---|---|---|
| Lead | `L` + 6 digits | `L000001` |
| Transaction | `T` + 6 digits | `T000001` |
| Requirement | `R` + 6 digits | `R000001` |

V1 legacy IDs keep the old format (`LEAD-0001`, `TXN-001`, `REQ-001`). Both coexist in the same collections, differentiated by the `_v2: true` marker.

---

## File structure

```
server.js                    Entry point — HTTP server, all routing
src/
  runtime/app.js             SignatureRealtyRuntime — bootstraps repo + services
  data/
    repository.js            JsonRepository — all DB reads/writes (single source of truth)
    schema.js                Legacy schema definitions
    store.js                 Seed data
    idEngine.js              V2 ID generation (L/T/R format, counters in db._V2Counters)
    v2Config.js              EntityConfig, WorkflowConfig, TagConfig, ScoringConfig,
                             ColumnConfig, V2FormRegistry (40+ form entries), ValidationConfig
    bootstrap.js             DB initialisation helpers
    databaseAdapter.js       Adapter shim
  services/
    leadService.js           Legacy lead CRUD
    requirementService.js    Legacy requirement CRUD
    transactionService.js    Legacy transaction CRUD
    matchingEngine.js        Inventory matching logic
    dashboardService.js      Reporting/analytics
    authService.js           Session auth
    brokerService.js         Broker/network management
    documentService.js       Document management
    mediaService.js          Media upload/storage
    formEngine.js            Legacy form engine
    storageService.js        File storage helper
    v2LeadService.js         V2: create + duplicate detection + tags + scoring
    v2TransactionService.js  V2: durable transaction CRUD with status transitions
    v2RequirementService.js  V2: requirement with form validation + RequirementScore
  api/
    v2Router.js              V2 API route dispatcher (feature-flag-aware)
    api.js                   Legacy API helpers
  controllers/               Legacy route controllers
scripts/
  migrateV2.js              V1 → V2 migration (dry-run by default, --apply, --rollback)
test/
  leadV2.test.js            65 unit tests covering all V2 contracts
e2e/                        Playwright end-to-end tests
data/
  sig-realty-db.json        Live database (created on first run)
clients.html                V2 Clients List page
client-workspace.html       V2 Client Workspace (6-tab)
requirements-view.html      V2 Global Requirements view
index.html                  Legacy Dashboard
login.html                  Auth page
```

---

## Service architecture

### Data layer — `JsonRepository`

Single class, single file. Every DB operation goes through it. Reads the JSON file, mutates the in-memory object, writes back atomically.

Key collections in `db`:
```
Leads, Transactions, Requirements, RequirementHistory
Activities, FollowUps, Timeline
Inventory, Matches, Shortlists, SiteVisits
Negotiations, NegotiationHistory, Tokens, Deals, Payments
Commissions, CommissionHistory, Closings
Documents, Media
Owners, Builders, Projects, Brokers, BrokerNetwork
Users, Roles, Permissions, Settings, MasterData, PipelineConfig
Notifications, FormRegistry, AuditLog
_V2Counters, _V2MigrationMap   ← V2-only
```

### V2 service layer

```
V2LeadService
  createLead(payload, actor, opts)    → duplicate check (EXACT/POSSIBLE/NO_MATCH) → write
  updateLead(leadId, payload, actor)  → status/lifecycle workflow transitions
  addTag / removeTag                  → TagConfig-validated
  recalculateScore                    → ScoringConfig-driven ClientScore

V2TransactionService
  createTransaction(leadId, payload)  → validates Lead exists, EntityConfig statuses
  updateTransaction(txnId, payload)   → WorkflowConfig status transitions
  getTransaction / listTransactionsByLead

V2RequirementService
  createRequirement(txnId, payload)   → parent-chain validation (LeadID == Txn.LeadID)
                                      → form validation (required fields, option membership,
                                         positive-number constraints from V2FormRegistry)
                                      → FormVersion frozen at creation
                                      → RequirementScore computed
  updateRequirement(reqId, payload)   → FormVersion immutable, status transitions enforced
  getFormConfig(txnType, cat, subCat) → resolves V2FormRegistry key
  listGlobalRequirements(filters)     → enriched with clientName
```

### V2 API layer — `V2Router`

Dispatched at the TOP of `server.js:handleApi()` before all legacy handlers. Returns `null` to fall through to legacy.

**Feature flag:** `LEAD_V2_ENABLED=true` environment variable.

| Routes | Active when |
|---|---|
| `POST /api/leads/check-duplicate` | Always |
| `GET\|POST /api/leads/:leadId/transactions` | Always |
| `GET\|PATCH /api/transactions/:id` | Always |
| `GET\|POST /api/transactions/:id/requirements` | Always |
| `POST /api/leads/:id/score` | Always |
| `POST\|DELETE /api/leads/:id/tags[/:tag]` | Always |
| `GET /api/clients/:leadId/workspace` | Always |
| `GET /api/v2/config` | Always |
| `GET /api/v2/form-config` | Always |
| `GET /api/v2/form-registry` | Always |
| `GET /api/v2/requirements/global` | Always |
| `GET\|POST /api/leads` | LEAD_V2_ENABLED=true only |
| `GET\|PATCH /api/leads/:id` | LEAD_V2_ENABLED=true only |
| `GET /api/requirements` | LEAD_V2_ENABLED=true only |
| `GET\|PATCH /api/requirements/:id` | LEAD_V2_ENABLED=true only |

---

## V2 configuration — `v2Config.js`

### Entity statuses and lifecycle

```
Lead ClientStatus:    New → Verified → Active → Inactive → Blacklisted
Lead Lifecycle:       Prospect → Client → Past Client → Inactive → Blacklisted
Transaction Status:   Open → Active → Closed | Cancelled
Requirement Status:   Draft → Active → Paused → Closed | Lost | Archived
Pipeline Stage:       New → Matching → Shortlisted → Site Visit → Negotiation → Token → Deal
```

### Form Registry (V2FormRegistry)

40+ form entries keyed by `TransactionType|Category|SubCategory`:

| Transaction type | Categories |
|---|---|
| Purchase / Sale | Residential (Flat, Villa, Row House, Bungalow, Penthouse, Studio) |
| Rent / Rent Out | Residential (Flat, Villa, Row House, Bungalow) |
| Lease / Lease Out | Residential (Flat) |
| Purchase / Rent / Sale | Commercial (Office, Shop, Showroom, Warehouse) |
| Rent Out / Lease / Lease Out | Commercial (Office, Shop) |
| Purchase / Sale | Land (Residential Plot, Commercial Plot, Agricultural Land) |
| Purchase / Rent / Lease / Lease Out | Industrial (Factory, Warehouse) |

Each form entry has `commonFields` (BudgetMin, BudgetMax, Location, Urgency, etc.) and `categoryFields` (BHK, Area, BusinessType, Zoning, ZoneType, etc.) with `required`, `fieldType`, `options`, and `validation` metadata.

### Scoring

- **ClientScore** (max 100): tags quality, lifecycle, activity recency, requirements count, budget clarity
- **RequirementScore** (max 100): budget presence, location presence, category completeness, urgency level

---

## UI pages

| URL | File | Description |
|---|---|---|
| `/` | `index.html` | Legacy dashboard |
| `/login.html` | `login.html` | Authentication |
| `/clients` | `clients.html` | V2 Client List — stats bar, filter chips, sortable table, Add Client modal with real-time duplicate check |
| `/client-workspace?id=L000001` | `client-workspace.html` | V2 Client Workspace — 6 tabs (Overview, Transactions, Requirements, Activities, Follow-ups, Timeline), edit/add modals with dynamic form fields |
| `/requirements-view` | `requirements-view.html` | V2 Global Requirements — multi-filter toolbar, urgency/stage/score display |

---

## Migration

**Script:** `node scripts/migrateV2.js [--dry-run] [--apply] [--rollback] [--report]`

- Default is `--dry-run` — zero DB writes (in-memory ID allocator only)
- `--apply` accumulates all changes in memory, writes once atomically
- `--rollback` reverts using `db._V2MigrationMap`
- V1 records are never deleted; V2 copies are added alongside them with `_migratedFromV1: true`

---

## Key decisions & rules for future work

1. **Never bypass V2Router for V2 entities.** All V2 mutations go through the service layer, not direct `repo.write()`.
2. **Requirement.LeadID == Transaction.LeadID is non-negotiable.** Enforce it in every code path that creates or links a Requirement.
3. **Form validation uses V2FormRegistry.** Any new Requirement creation path must call `V2RequirementService._validateFormFields()`.
4. **Body caching is critical.** `server.js` caches the parsed request body in `req._parsedBody`. Any new middleware that reads the request body must check `req._parsedBody` first; never re-read a consumed stream.
5. **Same DB collections for V1 and V2.** Never create separate V2 collections. Use `_v2: true` marker.
6. **No auto-migration.** `migrateV2.js` must be run manually with `--apply`.
7. **`LEAD_V2_ENABLED=false` by default.** Shared routes fall through to legacy handlers; only new (non-overlapping) V2 routes are always active.
8. **Builder Project media is manual-only.** Karma scraping and automatic brochure migration are disabled. Explicit public brochure/image URLs use bounded safe download, GridFS read-back verification, and internal asset URLs; HTTP 403 is never bypassed.

---

## Running the project

```bash
PORT=5000 node server.js                # Start server for the Replit preview
node --test test/leadV2.test.js         # Run V2 unit tests (65 tests)
node scripts/migrateV2.js              # Dry-run migration report
node scripts/migrateV2.js --apply      # Apply V1 → V2 migration
node scripts/migrateV2.js --rollback   # Rollback last migration
```

---

## User preferences

- All 20 V2 phases must complete without stopping for confirmation.
- No redesign of Inventory, Matching, Deal, Commission, Auth/RBAC, or Deployment.
- Legacy V1 APIs must always remain live regardless of feature flag state.
