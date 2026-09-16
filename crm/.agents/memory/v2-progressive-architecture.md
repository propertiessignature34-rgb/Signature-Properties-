---
name: V2 progressive architecture
description: Approved Signature Properties V2 redesign — client-centric progressive capture, supersedes form-centric V2
---

The original form-centric Lead V2 build was rejected by the owner. The approved design is in `docs/V2-BLUEPRINT.md` (authoritative over older docs).

**Rules:**
- Minimal creation is VALID: Name + Phone (+ optional need seed) creates Lead+Transaction+Requirement atomically. Never reject a requirement for missing non-core fields.
- Requirement fields are three-state: UNKNOWN / KNOWN / NOT_APPLICABLE. **UNKNOWN must never be treated as NO.**
- Completeness = Core/Important/Optional tiers from config, never filled/total.
- UI vocabulary: "Client" and "Needs" — never expose Lead/Transaction/Requirement hierarchy in UI. Backend keeps Lead→Transaction→Requirement unchanged.
- **Phase-gate rule:** after each implementation phase, STOP, report (files/APIs/tests/compat/risks), and wait for user approval. Never silently implement multiple phases.
- `_validateFormFields` in V2RequirementService (strict required-field rejection) is the main REWORK target; IdEngine, dup detection, transaction service, migration script are RETAINED.

**Why:** Owner directive (Aug 2026 attached file) — the CRM is "the agent's memory", conversation-driven, not a form system.
