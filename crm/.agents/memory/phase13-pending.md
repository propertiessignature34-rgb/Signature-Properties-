---
name: Phase 13 — Quick Capture (PENDING)
description: Deferred phase. Full contract in attached_assets/Pasted-PHASE-13-ONLY-QUICK-CAPTURE-NEW-CLIENT-FLOW-IMPORTANT-P_1786990891094.txt
---

# Phase 13 — Quick Capture / New Client Flow

**Status: PENDING — Do not implement until explicitly approved.**

## Core Contract (preserved verbatim)

- Small New Client form: Name + Phone only for client identity
- Initial transaction/need: TransactionType, Category, Location(s), Budget
- Dynamic fields driven by TransactionType + Category + SubCategory (via FormRegistry Phase 9)
- Only information the agent knows NOW is captured — everything else remains UNKNOWN
- Atomic creation: Lead + Transaction + Requirement in one logical operation
- One Client = One Lead (no duplicate leads — reuse existing via Phase 5 duplicate protection)
- EXACT_MATCH → reuse existing Lead, create new Transaction + Requirement under it
- POSSIBLE_MATCH → show confirmation dialog ("Use Existing" / "Create New")
- No giant mandatory requirement form — BHK, Possession, Parking, Furnishing etc. are NOT required
- SubCategory optional (remains UNKNOWN if agent doesn't know)
- Budget optional (BudgetMin and/or BudgetMax independently)
- Location: supports multiple (Location1, Location2, … stored on Requirement.Fields)
- After save → redirect to Client Workspace (Phase 14 will build the full workspace UI)

## API Contract
- `POST /api/v2/quick-capture`
- Request shape: `{ client: { name, primaryMobile }, transaction: { transactionType }, requirement: { category, locations: [], budgetMax, budgetMin } }`
- Response: `{ ok, client: { leadId, name }, transaction: { transactionId, transactionType }, requirement: { requirementId, category, locations, budgetMin, budgetMax }, scores: { clientScore, requirementScore }, nextQuestions: [] }`

## Atomicity requirement
- Snapshot/rollback at repository boundary (no real DB txns — JSON store)
- If Transaction creation fails → rollback Lead creation
- If Requirement creation fails → rollback Transaction + Lead
- Dedicated tests for partial-failure rollback (contract items 24 & 25)

## Services to use (do NOT replace)
- Phase 5: V2LeadService.checkDuplicate + createLead (allowPossibleDuplicate option)
- Phase 9: V2FormRegistryService for SubCategory resolution
- Phase 10: V2DependencyService.evaluateContext after Requirement creation
- Phase 11: V2NextQuestionService.getNextQuestions (optional in response)
- Phase 12: V2ScoringService (already wired into RequirementService + LeadService)

## Test file
- `test/v2Phase13.test.js` — 35 tests (contract items 1–35)

## Protected modules (must not be touched)
Inventory, Matching, Deal, Commission, Auth, RBAC, Migration,
V2DependencyService, V2NextQuestionService (unless minimal compat fix needed)

## UI changes needed
- clients.html: replace/adapt "Add Client" with Quick Capture modal
- Quick Capture form fields: Name, Mobile, TransactionType (dropdown), Category (dropdown), Locations (dynamic add/remove), Budget Min/Max (optional)
- After save: navigate to Client Workspace page
