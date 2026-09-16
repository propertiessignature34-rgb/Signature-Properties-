# Signature Realty OS V2 — Rollout Gate

> Phase 20 | Status: **READY FOR PHASED ROLLOUT** | Date: 2026-08-18

---

## Gate Criteria

All criteria below must be satisfied before any traffic is shifted to V2.

| # | Criterion | Status |
|---|---|---|
| G-01 | Full test suite green (≥858 tests, 0 failures) | ✅ PASS |
| G-02 | All 6 business invariants certified | ✅ PASS |
| G-03 | Feature flag works correctly (V1 fallback verified) | ✅ PASS |
| G-04 | Migration dry-run reports no data corruption | ✅ PASS |
| G-05 | Migration backup + rollback cycle verified | ✅ PASS |
| G-06 | Error responses contain no stack traces | ✅ PASS |
| G-07 | Performance smoke test passes (< 2s per operation) | ✅ PASS |
| G-08 | Canonical /api/v2/* always active (not flag-gated) | ✅ PASS |
| G-09 | Legacy /api/leads fallthrough works when flag=false | ✅ PASS |
| G-10 | Cross-client data access is rejected | ✅ PASS |

**All 10 gate criteria passed. Rollout may proceed.**

---

## Rollout Plan

### Phase A — Internal Preview (Day 0)

1. Deploy to staging environment.
2. Set `LEAD_V2_ENABLED=false` (default).
3. Verify: all existing legacy flows work unchanged.
4. Test `/api/v2/clients`, `/api/v2/requirements/:id/score`, `/api/v2/requirements/:id/next-questions` via API client (these are always active).

**Rollback**: Simply remove `LEAD_V2_ENABLED` — all traffic falls to legacy handlers.

---

### Phase B — DB Migration (Day 1, before flag flip)

1. Take a full database backup: `node scripts/migrateV2.js --dry-run` → verify report.
2. Check for duplicates in the migration report (`data/migration-report.json`).
3. Manually review any records flagged for `manualReview`.
4. Execute: `node scripts/migrateV2.js --apply`.
5. Verify: `data/migration-report.json` shows 0 errors.
6. Verify: `data/backups/` contains the pre-migration backup.

**Rollback**: `node scripts/migrateV2.js --rollback` → restores backup.

---

### Phase C — Feature Flag Flip (Day 1, after migration)

1. Set `LEAD_V2_ENABLED=true` in the production environment.
2. Verify: `GET /api/leads` → proxied through V2 router → returns ok:true.
3. Verify: `PATCH /api/requirements/:id` → V2 handler responds correctly.
4. Spot-check: 3–5 existing clients have correct workspace data.

**Rollback**: Set `LEAD_V2_ENABLED=false` → traffic returns to legacy handlers. Data is safe (V2 records coexist, never replace).

---

### Phase D — UI Verification (Day 1, after flag flip)

1. Open `clients.html` — confirm client list loads.
2. Create a new client → confirm workspace opens.
3. Add a transaction → confirm requirement form appears.
4. Answer 3 questions → confirm score and next-questions update.
5. Log a call activity → confirm it appears in workspace.
6. Create a follow-up → confirm it appears in follow-up list.

---

### Phase E — Monitoring Period (Days 1–7)

Monitor for:
- Error rate on `/api/v2/*` endpoints (target: < 0.1%)
- Latency regression (target: < 500ms p95 for all endpoints)
- Any reports of missing or incorrect data

**Escalation path**: If errors appear → set `LEAD_V2_ENABLED=false` immediately → investigate → re-run tests → re-deploy.

---

## Rollback Procedures

### Immediate (< 5 minutes)

```bash
# Remove or set to false
LEAD_V2_ENABLED=false
```

All legacy flows resume instantly. No data is lost.

### Full Rollback (after migration applied)

```bash
node scripts/migrateV2.js --rollback
```

This restores the database from the pre-migration backup. V2 records are removed. Legacy system resumes from original state.

> ⚠️ Full rollback loses any V2-only data (activities, follow-ups, new requirements) created after the migration. Coordinate with the team before executing.

---

## Go / No-Go Checklist

Before setting `LEAD_V2_ENABLED=true` in production:

- [ ] Dry-run completed with 0 errors
- [ ] Backup file confirmed at `data/backups/`
- [ ] Migration report reviewed — no manual-review items outstanding
- [ ] Staging environment verified with flag=true
- [ ] On-call contact confirmed for the rollout window
- [ ] Rollback procedure reviewed by at least one team member
- [ ] Browser session verified for at least 2 clients in staging

---

## Definition of Done (V2)

V2 rollout is **complete** when:

1. `LEAD_V2_ENABLED=true` in production for ≥ 7 consecutive days.
2. Error rate < 0.1% sustained.
3. All active clients visible in `/api/v2/clients`.
4. Legacy `/api/leads` shim no longer needed (decommission planned).
5. Phase 13 (Quick Capture) approved and roadmapped for V2.1.

---

## Phase Summary

| Phase | Title | Status |
|---|---|---|
| 1–12 | Core V2 Architecture | ✅ Complete |
| 13 | Quick Capture | ⏸ Permanently deferred |
| 14 | Client Workspace | ✅ Complete |
| 15 | Client List / Query View | ✅ Complete |
| 16 | Activity / Follow-up Engine | ✅ Complete |
| 17 | Canonical V2 API | ✅ Complete |
| 18 | V1 → V2 Migration | ✅ Complete |
| 19 | Testing & Certification | ✅ Complete |
| **20** | **Rollout Gate** | ✅ **READY** |
