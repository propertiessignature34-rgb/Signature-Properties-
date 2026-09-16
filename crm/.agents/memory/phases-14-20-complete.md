---
name: Phases 14-20 Complete
description: All V2 phases done including Phase 20 Rollback Safety Fix; 874/874 tests
---

All phases complete. Final test count: 874/874.

Phases 14–19: See docs/V2-API.md, docs/V2-TEST-REPORT.md, docs/V2-ROLLOUT.md.

Phase 20 — Rollback Safety Fix:
- scripts/migrateV2.js --apply now writes migration-manifest-<runId>.json alongside every backup
- --rollback reads ONLY manifests; hard-stops on: 0 manifests, >1 manifests, sourceDbPath mismatch, missing backup file, checksum mismatch
- Test artifacts (sig-realty-db-backup-*.json) have no manifest → permanently ineligible for automated rollback
- Safety gate backup (pre-apply-safety-gate-20260817T195840Z.json, 101 KB, SHA-256 a829b28a…) is the only production-eligible backup
- Test file: test/v2Phase20RollbackSafety.test.js (14 tests, Groups A-H)

Test isolation pattern (critical for concurrent test execution):
- Phase 18 apply tests call _clearMfForDb(dbFile) after each test (surgical: only removes manifests for that specific temp dbFile)
- Phase 18 rollback test uses hideForeignManifests/restoreHiddenManifests to isolate WITHOUT global deletion
- Phase 20 G2 uses report-based assertion (data/migration-report.json) instead of global manifest count
- This pattern is immune to node --test concurrent file execution
