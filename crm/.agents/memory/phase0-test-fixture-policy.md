---
name: Phase 0 test and fixture policy
description: Keep repository tests reproducible without treating the live local database as a default fixture.
---

Production-data safety checks are opt-in and must not assume that the current local JSON snapshot is pre-migration. Default tests use isolated fixtures; production-data checks run only with an explicit environment switch and report the observed baseline.

**Why:** The local snapshot can legitimately contain V2 records while historical rollback tests assumed zero V2 records, causing false failures and obscuring real regressions.

**How to apply:** Keep normal unit/API/E2E runs isolated and reproducible. Run production-data safety checks separately after recording counts, checksums, backup identity, and storage mode.