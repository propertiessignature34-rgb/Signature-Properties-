# Signature Properties V2 — Revised Implementation Blueprint

Status: **Phase 7 DONE. Phase 8–20 architecture updated (see §4 and §9 below).**
This document supersedes all prior plans. Where it conflicts with `replit.md`, THIS document wins.

---

## 1. Revised architecture (frozen)

**Product principle:** a client-centric, transaction-aware, configuration-driven, progressive, conversation-based CRM. The CRM is the agent's memory, not a form collection.

```
UI concept:        CLIENT  →  NEEDS
Backend identity:  LEAD    →  TRANSACTION  →  REQUIREMENT
```

- One Client = one Lead identity, forever. Multiple needs = multiple Transactions under the same LeadID. Never a second Lead.
- "Need" is a UX concept only — no Need DB entity. A Need card = Transaction + its Requirement.
- Requirement = the current understanding of one need. It starts tiny and grows through conversations. Same L/T/R IDs for its entire life.
- Hard invariant (server-rejected): `Requirement.LeadID === Transaction.LeadID`.
- Requirement stores criteria only — never property/inventory data. Matching Engine out of scope.
- Frontend executes configuration; server enforces the same configuration. No hardcoded `if (category === 'Residential')` business logic in the frontend.

### The critical shift from the previous build

| Previous (rejected) | Revised (approved) |
|---|---|
| Big requirement form, required fields enforced at creation | Minimal creation: Name + Phone (+ optional TransactionType/Category/Location/Budget) is a complete, VALID save |
| Missing field = validation error | Missing field = **UNKNOWN** — never an error, never treated as NO |
| Completeness = filled/total | Completeness = Core / Important / Optional tiers from config |
| Form filled once | Requirement progressively updated via PATCH across many conversations |
| Field shown if it exists in registry | Field relevance states: HIDDEN / VISIBLE / RELEVANT / REQUIRED / COMPLETED, driven by config + dependencies |

### Architecture invariants that must never be reverted (Phase 7 baseline)

- **UNKNOWN is a valid state.** KNOWN is a valid state. NOT_APPLICABLE is a valid state.
- **Never reintroduce** "all required fields must be filled before saving."
- **Never reintroduce** "one complete form submission = one Requirement."
- **Never create a new Requirement** simply because an agent records a new call.
- A Requirement is a living client need that becomes progressively more complete.
- The UI must optimise for real-time agent conversation, not data-entry completeness.

---

## 2. Revised data model

### Lead (client-level only — no need data here)
`LeadID (L000001)`, ClientName, PrimaryMobile, AlternateMobile, WhatsApp, Email, Tags[], ClientStatus, ClientLifecycle, ClientScore, Source, AssignedAgentID, Notes, LegacyID, `_v2: true`, audit fields.

### Transaction (what the client is trying to do)
`TransactionID (T000001)`, LeadID, TransactionType (Purchase|Sale|Rent|Rent Out|Lease|Lease Out), TransactionStatus (Open|Active|Closed|Cancelled), PipelineStage (New→…→Deal), CreatedBy/At, UpdatedBy/At, Version, LegacyID. Pipeline lives here — never on Lead.

### Requirement (evolving structured record)
```
RequirementID (R000001), LeadID, TransactionID,
TransactionType / Category / SubCategory,
FormVersion (immutable after creation),
RequirementStatus (Draft|Active|Paused|Closed|Lost|Archived),
Fields: {                        ← three-state field store (Phase 7 baseline)
  BHK:      { state: "KNOWN", value: 3 },
  Parking:  { state: "NOT_REQUIRED" },
  Possession: { state: "UNKNOWN" }        // or simply absent = UNKNOWN
},
Preferences: [ "Near school", "Not near temple" ],   ← free-form, client's words
SpecialNotes: "Buying for mother",
DynamicAttributes: { ... },              ← business-configured custom fields
Completeness: { core: "complete", important: "1/2", optional: "1/5" },
RequirementScore, ScoreBreakdown, ScoreVersion, CalculatedAt,
RequirementHistory (append-only), LegacyID, audit fields.
```
Field states: **UNKNOWN** (not asked), **KNOWN** (has value), **NOT_APPLICABLE / NOT_REQUIRED** (client explicitly declined). UNKNOWN ≠ NO — ever.

### Configuration collections (all persisted, versioned, editable)
EntityConfig, FormConfig, **FieldConfig** (FieldID, Entity, FieldKey, FieldLabel, **QuestionLabel** (separate!), FieldType, TransactionType/Category/SubCategory scope, Required, Visible, Default, Options, Validation, Dependency, Priority, Section, HelpText, Version, IsActive), OptionConfig, **DependencyConfig**, ValidationConfig, WorkflowConfig, ColumnConfig, ScoringConfig, TagConfig, **QuestionConfig** (QuestionID, FieldKey, QuestionLabel, FieldLabel, TransactionType, Category, SubCategory, FieldType, Priority, Section, RequiredMode, DependencyRule, ValidationRule, Options, HelpText, Placeholder, Active, Version, DisplayOrder).

Form Registry key: `TransactionType|Category|SubCategory|FormVersion`. Requirements remain interpretable via their stored FormVersion.

Completeness tiers per form config: **Core** (high-value information — not required fields, but meaningful) / **Important** / **Optional**. Only Core can ever block anything, and only if configured. CORE means "requirement becomes meaningful with this"; it does NOT mean "mandatory form field".

---

## 3. Retain / Adapt / Rework audit of existing code

| Component | Verdict | Why |
|---|---|---|
| `src/data/idEngine.js` (L/T/R IDs, counters) | **RETAIN** | Counter-overwrite safe; see §3a |
| `src/data/repository.js` additions (`_V2Counters`, `RequirementHistory`) | **RETAIN** | Correct persistence path |
| `src/services/v2LeadService.js` — duplicate detection, tags, normalizePhone, ClientScore | **RETAIN** | Counter-overwrite verified safe (reads DB fresh after idEngine); see §3a |
| `src/services/v2TransactionService.js` | **RETAIN** | Model matches correctly; counter-overwrite safe |
| `src/services/v2RequirementService.js` | **DONE — Phase 7** | Three-state fields, minimal creation, progressive PATCH, counter-overwrite fixed |
| Body caching (`req._parsedBody`), V2Router dispatch pattern, feature flag | **RETAIN** | Correct pattern |
| `scripts/migrateV2.js` (dry-run default, MigrationMap, rollback) | **RETAIN** | Re-verify requirement mapper vs. Fields store in Phase 18 |
| `src/data/v2Config.js` — EntityConfig, WorkflowConfig, TagConfig, ScoringConfig, ColumnConfig | **ADAPT (Phase 8)** | Move from in-code constants to persisted, admin-editable configuration; add QuestionConfig, DependencyConfig, FieldConfig with QuestionLabel/Priority/Section |
| `V2FormRegistry` (40+ entries) | **ADAPT (Phase 10)** | Keys/FormVersion correct; rename concept to "Need Configuration"; re-tier fields (Core/Important/Optional); add Rent-specific fields, Agriculture category |
| `clients.html` Add Client modal | **REWORK (Phase 13)** | Quick Capture form: Name + Phone + optional need seed → atomic L+T+R |
| `client-workspace.html` | **REWORK (Phase 14)** | Needs cards with Known/To-discover panel + Next Questions |
| `requirements-view.html` | **ADAPT (Phase 15)** | Client/Needs language; tiered completeness |
| `test/leadV2.test.js` (77 tests) | **EXTEND (Phase 19)** | Phase 7 tests are baseline; extend for question engine, dependency, E2E |
| Legacy modules (Inventory, Matching, Deals, Auth, …) | **UNTOUCHED** | |

### §3a — Counter-overwrite risk verification (Phase 8 prerequisite)

**v2LeadService.js** `createLead`: calls `idEngine.nextLeadId()` at line 155, then does a **fresh** `this.repository.read()` at line 191 before the write. Counter is preserved. ✅ **No bug.**

**v2TransactionService.js** `createTransaction`: same safe pattern — idEngine called at line 50, fresh read at line 70. ✅ **No bug.**

**v2RequirementService.js** `createRequirement`: had the bug (stale read held across idEngine call). **Fixed in Phase 7** — now re-reads after idEngine. ✅ **Fixed.**

---

## 4. Phase status table

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture freeze + baseline (this blueprint) | DONE |
| 1 | Canonical Client/Lead model | DONE — retain |
| 2 | Central ID engine | DONE — retain |
| 3 | Repository persistence | DONE — retain |
| 4 | Client/Lead service | DONE — retain |
| 5 | Duplicate protection | DONE — retain |
| 6 | Transaction service | DONE — retain |
| 7 | Requirement service rework: three-state fields, minimal-valid creation, Preferences / SpecialNotes / DynamicAttributes, progressive PATCH | **DONE** |
| 8 | Question & Configuration Engine: QuestionConfig structure, config layers persisted in DB, Priority tiers (CORE/IMPORTANT/OPTIONAL) | NEXT |
| 9 | Dependency Engine: configuration-driven VISIBLE/HIDDEN/RELEVANT/NOT_RELEVANT/REQUIRED/OPTIONAL per T/C/SC context; server-side mirror | NEW |
| 10 | Form Registry → Need Configuration: rename concept, re-tier fields, Rent/Agriculture forms, FormVersion preserved | ADAPT |
| 11 | Next Question Engine: `GET /api/requirements/:id/next-questions`; priority + dependency driven, no AI/NLP | NEW |
| 12 | Client Intelligence + Scoring: separate ClientScore and RequirementScore with configurable factors and explained breakdown | ADAPT |
| 13 | New Client Quick Capture UI: small modal, atomic L+T+R, everything else UNKNOWN | REWORK |
| 14 | Client Workspace: Needs cards, Known/To-discover panel, Next Questions, inline update (no full form re-open) | REWORK |
| 15 | Client List + Requirements View: "Clients" nav, filter presets, Requirements as a query view | ADAPT |
| 16 | Conversation / Activity / Follow-up Engine: call → known/unknown panel → field update → timeline entry with L/T/R refs | NEW |
| 17 | API + Backward Compatibility: canonical REST shape, all legacy endpoints intact | VERIFY |
| 18 | Migration & Data Safety: dry-run flow, migration report files, no automatic production migration | VERIFY |
| 19 | Complete Testing: unit + API + integration + E2E Rahul Shah script | NEW |
| 20 | Rollout: feature flag, regression pass, backup, migration dry-run, explicit approval, enable V2 | ADAPT |

---

## 5. File-by-file responsibility map

| File | Responsibility |
|---|---|
| `server.js` | Routing, body cache, V2Router dispatch — unchanged pattern |
| `src/api/v2Router.js` | All V2 endpoints + new: `POST /api/v2/clients` (atomic L+T+R), `PATCH` progressive requirement updates, `GET /api/requirements/:id/next-questions`, `GET /api/requirements/:id/score`, `GET /api/leads/:id/score`, `GET /api/clients/:leadId/workspace`, config read endpoints |
| `src/data/idEngine.js` | L/T/R ID generation (retain) |
| `src/data/v2Config.js` | Config defaults/seeds only; live config moves to DB collections in Phase 8 |
| `src/data/repository.js` | Adds config collections + QuestionConfig + DependencyConfig; all writes Controller→Service→Repository→JSON |
| `src/services/v2LeadService.js` | Client-level data, dup check, tags, ClientScore |
| `src/services/v2TransactionService.js` | Transaction CRUD, status, pipeline |
| `src/services/v2RequirementService.js` | Progressive requirement lifecycle, three-state fields, completeness, history (**Phase 7 complete**) |
| `src/services/v2ConfigService.js` (new, Phase 8) | Config resolution: FieldConfig + DependencyConfig + ValidationConfig → resolved field set for T/C/S/FormVersion/context |
| `src/services/v2QuestionService.js` (new, Phase 11) | Next-Best-Question from QuestionConfig |
| `clients.html` / `client-workspace.html` / `requirements-view.html` | Config-executing UIs, zero hardcoded category logic |
| `scripts/migrateV2.js` | Unchanged flow; requirement mapper re-verified vs Fields store in Phase 18 |
| `test/leadV2.test.js` (+ new test files) | 77 tests baseline; extended per Phase 19 matrix |

---

## 6. Migration & compatibility strategy

- Legacy APIs/data untouched; V1 records never deleted; `LEAD_V2_ENABLED=false` default; flag is UX gating, not security.
- Shared endpoints keep flag fall-through; new endpoints always active.
- Migration stays manual: Backup → Dry Run → MigrationMap → Normalize → Duplicate Analysis → Create/Map Lead → Create Transaction → Attach Requirement → Validate relationships → Generate Report → Approval → Production Migration.
- `LegacyID` preserved on all migrated records.
- Migration produces: `migration-report.json`, `duplicate-report.json`, `orphan-report.json`, `relationship-report.json`.
- Migrated legacy requirements: every legacy field with a value → `KNOWN`; absent → `UNKNOWN` (never fabricated).

---

## 7. Test strategy

- **Unit:** IDs, phone normalization, dup detection, lifecycle/status separation, three-state fields (UNKNOWN ≠ NO), dependency engine, FormVersion immutability, question engine, tiered completeness, scoring, tags, activity.
- **API:** Lead CRUD, duplicate check, Transaction CRUD, Requirement CRUD, workspace, next-questions, scoring.
- **Integration:** Client → Need → progressive updates → same L/T/R IDs throughout → Next Question → Follow-up → Timeline.
- **E2E acceptance (Rahul Shah script):**
  1. Create: Rahul / 9876543210 / Purchase / Residential / Vesu / ₹1 Cr → L+T+R created
  2. Workspace shows Known: Vesu, ₹1 Cr | Unknown: BHK, Possession, Parking
  3. Call: "3 BHK" → PATCH same Requirement with BHK=3
  4. Next question: "Possession kab tak chahiye?"
  5. Client: "Ready" → PATCH same Requirement with Possession='Ready'
  6. Verify: LeadID / TransactionID / RequirementID all unchanged throughout
- **Regression:** auth, dashboard, inventory, matching, follow-ups, site visits, deals, commission — all legacy endpoints byte-compatible.

---

## 8. Phase-gate mechanism

After every phase: STOP and report Phase / Objective / Files changed / Functions added / Data-model changes / API changes / UI changes / Tests run / Pass-fail / Backward compatibility / Risks / Next phase — then wait for explicit approval before continuing. No silent multi-phase implementation.

---

## 9. Phase 8–20 detailed architecture

### PHASE 8 — Question & Configuration Engine

**Objective:** Make the CRM conversation-driven, not form-driven. Phase 7 made Requirement progressive. Phase 8 decides — given a client's Transaction + Category + SubCategory + current known information — which questions are relevant.

**Configuration layers to persist in DB:**
- EntityConfig, QuestionConfig, FieldConfig, OptionConfig, DependencyConfig, ValidationConfig, WorkflowConfig, ColumnConfig, ScoringConfig, FormRegistry

**QuestionConfig schema (per question):**
```
QuestionID, FieldKey, QuestionLabel, FieldLabel,
TransactionType, Category, SubCategory,
FieldType, Priority (CORE | IMPORTANT | OPTIONAL),
Section, RequiredMode, DependencyRule, ValidationRule,
Options, HelpText, Placeholder, Active, Version, DisplayOrder
```

**Priority meaning:**
- CORE = high-value information that makes the requirement meaningful (NOT "mandatory form field")
- IMPORTANT = significantly improves matching quality
- OPTIONAL = nice to have; asked last
- If client hasn't provided BHK → BHK = UNKNOWN. No error.

**First task of Phase 8:** verify counter-overwrite risk in v2LeadService.js. **Result: NO BUG — verified safe (§3a).**

---

### PHASE 9 — Dependency Engine

**Objective:** Configuration-driven field relevance. Zero hardcoded category branching anywhere.

Engine calculates per field, per context:
`VISIBLE | HIDDEN | RELEVANT | NOT_RELEVANT | REQUIRED | OPTIONAL | UNKNOWN | KNOWN | NOT_APPLICABLE`

**Context:** TransactionType + Category + SubCategory + current Fields state.

Examples:
- Purchase / Residential / Flat → residential-flat questions
- Rent → rent-specific questions (Move-in Date, Tenant Type, Deposit, Pets…)
- Commercial → commercial questions
- Office → office-specific questions

**Hard rule:** Frontend must never contain `if (category === 'Residential')`. Frontend only renders the engine's resolved field set.

---

### PHASE 10 — Form Registry → Need Configuration

**Concept rename:** "Dynamic Form" → "Dynamic Need Configuration"

Registry key: `TransactionType | Category | SubCategory | FormVersion`

Examples:
- `Purchase | Residential | Flat | V2.1`
- `Rent | Residential | Flat | V2.1`
- `Purchase | Commercial | Office | V2.1`

Behaviour shift:
```
OLD: 30 fields → all required → Submit
NEW: Current known → Relevant questions → Unknown → Ask only when useful
```

Historical Requirements keep their `FormVersion` so old data is never reinterpreted incorrectly.

---

### PHASE 11 — Next Question Engine

API: `GET /api/requirements/:id/next-questions`

Given current Requirement, returns ordered list of what the agent should ask next.

Example:
- Known: Location, Budget, BHK, Category, SubCategory
- Unknown: Possession, Parking, Furnishing, Facing, Floor
- Returns:
  ```json
  [
    { "QuestionID": "possession", "Question": "Possession kab tak chahiye?", "Priority": "HIGH", "Reason": "Purchase requirement qualification" },
    { "QuestionID": "parking",    "Question": "Parking kitni chahiye?",      "Priority": "MEDIUM" },
    { "QuestionID": "furnishing", "Question": "Furnished property chalegi?", "Priority": "MEDIUM" }
  ]
  ```

Logic: priority-sorted unknown fields from QuestionConfig, filtered by DependencyEngine context, no AI/NLP.

---

### PHASE 12 — Client Intelligence + Scoring

**Two separate scores — both configurable:**

**ClientScore** — relationship/value score. Factors: Responsiveness, Engagement, Past transactions, Follow-up behavior, Relationship value.

**RequirementScore** — specific need quality. Factors:
- Positive: Budget confirmed (+15), Location confirmed (+15), BHK confirmed (+10), Timeline (+10), Finance readiness, Site visit (+18), Shortlist, Responsiveness
- Negative: No response, Very long timeline, Inactive requirement

Every score must explain itself:
```
RequirementScore: 78
Budget confirmed      +15
Location confirmed    +15
BHK confirmed         +10
Timeline confirmed    +10
Responsive            +10
Site Visit            +18
──────────────────────────
Total                  78
```

Store on record: `ScoreBreakdown`, `ScoreVersion`, `CalculatedAt`.

APIs: `GET /api/requirements/:id/score`, `GET /api/leads/:id/score`, `GET /api/leads/:id/tags`

---

### PHASE 13 — New Client Quick Capture UI

Agent clicks **+ NEW CLIENT**.

Do NOT show a large form. Show Quick Capture:

**CLIENT:** Name, Phone, Alternate Phone, WhatsApp

**INITIAL NEED:** Transaction, Category, SubCategory, Location(s), Budget, Short Notes

Agent can expand for additional fields. Everything else defaults to UNKNOWN.

Example save:
```
Rahul Shah / 9876543210 / Purchase / Residential / Flat / Vesu / ₹1 Cr / "3 BHK preferred"
```

Backend atomically creates L000001 + T000001 + R000001. Everything else: UNKNOWN.

---

### PHASE 14 — Client Workspace

Main CRM screen. Layout:

**Header:** ClientName | 📞 Call | 💬 WhatsApp | ✏️ Edit | + Transaction | + Requirement
Shows: Status, Lifecycle, Score, Tags

**Needs section** — one card per Transaction+Requirement:
```
Purchase — Residential Flat

Vesu  |  ₹1 Cr  |  3 BHK

KNOWN               TO DISCOVER
✓ Purchase          ○ Possession
✓ Residential       ○ Parking
✓ Flat              ○ Furnishing
✓ Vesu              ○ Facing
✓ ₹1 Cr
✓ 3 BHK

NEXT QUESTIONS
1. Possession kab chahiye?
2. Parking kitni?
3. Furnishing preference?
```

**Key rule:** Agent does NOT reopen a full form. Agent updates inline:
```
Parking  [ + ]  2   →  Save.  →  Same RequirementID.
```

---

### PHASE 15 — Client List + Requirements View

**Client List:**
- Navigation label: "Clients" (not "Leads")
- Default columns: Client, Mobile, Status, Lifecycle, Tags, Needs, Latest Need, Budget, Location, Score, Follow-up
- Filter presets: All, My Clients, New, Active, Hot, Follow-up Due, Inactive, Investor

**Requirements View:**
- This is a query/view, not a separate database
- Shows: `Purchase | Residential | 3 BHK | Vesu | ₹1 Cr`
- Click-through: Client → Transaction → Requirement

---

### PHASE 16 — Conversation / Activity / Follow-up Engine

Connects CRM to actual agent workflow:

```
Call received
  ↓ Agent opens current Need
  ↓ System shows: Known (3 BHK, Vesu, ₹1 Cr) | Unknown (Possession, Parking, Furnishing)
  ↓ Agent asks. Client answers.
  ↓ Agent updates field.
  ↓ Timeline entry auto-created: "Possession: UNKNOWN → Ready"
  ↓ Next call: Parking → "2"
  ↓ Timeline: "Parking: UNKNOWN → 2"
```

Every Activity references: LeadID, TransactionID, RequirementID, UserID. No duplicate Client records ever.

---

### PHASE 17 — API + Backward Compatibility

**Canonical API shape:**

```
# Client/Lead
GET    /api/leads
GET    /api/leads/:id
POST   /api/leads
PATCH  /api/leads/:id
POST   /api/leads/check-duplicate

# Transaction
GET    /api/leads/:leadId/transactions
POST   /api/leads/:leadId/transactions
GET    /api/transactions/:id
PATCH  /api/transactions/:id

# Requirement
GET    /api/transactions/:transactionId/requirements
POST   /api/transactions/:transactionId/requirements
GET    /api/requirements/:id
PATCH  /api/requirements/:id
GET    /api/requirements

# Intelligence
GET    /api/requirements/:id/next-questions
GET    /api/requirements/:id/score
GET    /api/leads/:id/score
GET    /api/leads/:id/tags

# Workspace
GET    /api/clients/:leadId/workspace

# Configuration (read-only initially)
GET    /api/v2/config/questions
GET    /api/v2/config/forms
GET    /api/v2/config/options
GET    /api/v2/config/dependencies
```

**Do not break:** Dashboard, Matching, Inventory, Follow-up, Activities, Deal, Commission, Auth, RBAC. Old APIs continue through adapters.

---

### PHASE 18 — Migration & Data Safety

No automatic production migration. Manual flow only:

```
Backup → Dry Run → MigrationMap → Normalize → Duplicate Analysis
→ Create/Map Lead → Create Transaction → Attach Requirement
→ Validate relationships → Generate Report → Approval → Production Migration
```

Outputs: `migration-report.json`, `duplicate-report.json`, `orphan-report.json`, `relationship-report.json`

Preserve `LegacyID`. Never delete original data.

---

### PHASE 19 — Complete Testing

**Unit:** ID Engine, Lead, Duplicate, Transaction, Requirement, QuestionConfig, Dependency, UNKNOWN/KNOWN/N/A states, FormVersion, Next Question, Scoring, Tags, Activity

**API:** Lead CRUD, Duplicate, Transaction CRUD, Requirement CRUD, Workspace, Next Questions, Scoring

**Integration (critical path):**
```
Create Client → Transaction → Requirement → Call → Update Requirement
→ Next Question → Follow-up → Timeline
```

**E2E acceptance:**
- Step 1: Create Rahul / 9876543210 / Purchase / Residential / Vesu / ₹1 Cr
- Step 2: Workspace shows Known: Vesu, ₹1 Cr | Unknown: BHK, Possession, Parking
- Step 3: Call — client says "3 BHK"
- Step 4: Update same Requirement: BHK = 3
- Step 5: Next question: "Possession?"
- Step 6: Client: "Ready"
- Step 7: Same LeadID + TransactionID + RequirementID throughout — must remain unchanged

---

### PHASE 20 — Rollout

Feature flag: `LEAD_V2_ENABLED`

- **OFF:** Existing system unchanged
- **ON:** Clients view, Client Workspace, Progressive Needs, Dynamic Questions, Next Questions

Production rollout gate:
```
Tests PASS → E2E PASS → Regression PASS → Backup
→ Migration Dry Run → Report Review → Explicit Approval → Enable V2
```

V1 remains available until V2 is proven stable.
