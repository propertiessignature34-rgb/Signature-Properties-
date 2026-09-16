---
name: Lead V2 Architecture
description: Core decisions for Lead Module V2 — ID format, DB strategy, service boundaries, feature flag
---

## Rules

**V2 IDs**: L000001 (Lead), T000001 (Transaction), R000001 (Requirement). Server-only via IdEngine. Counters in `db._V2Counters`.

**Same DB collections**: V2 records go into `db.Leads`, `db.Transactions`, `db.Requirements` with `_v2: true` marker and `LegacyID` linking to old records. Never create separate V2 collections.

**Service boundaries**:
- `src/services/v2LeadService.js` — all V2 lead creation/update
- `src/services/v2TransactionService.js` — durable (repository-backed) transactions
- `src/services/v2RequirementService.js` — requirement with parent-chain validation
- `src/api/v2Router.js` — dispatches all V2 routes, returns `null` when not handled (falls through to legacy)

**Invariants that must never break**:
- Requirement.LeadID MUST equal Transaction.LeadID (enforced at creation)
- FormVersion is immutable after Requirement creation
- Requirement must never embed Inventory/Property data

**Feature flag**: `LEAD_V2_ENABLED` in environment. V2 API routes are always live. Flag controls nav link and primary UI only.

**Why:** Keeps V1 production traffic unaffected while V2 is built out. Migration script (`scripts/migrateV2.js`) handles gradual promotion of V1 records.
