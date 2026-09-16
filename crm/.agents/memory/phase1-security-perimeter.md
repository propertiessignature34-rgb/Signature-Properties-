---
name: Phase 1 security perimeter
description: Security boundary decisions for project, broker, storage, tenant, payload, and API-abuse controls.
---

Sensitive master-data and legacy CRM/financial mutations require explicit capability permissions rather than authentication alone. Internal object, leads, requirements, follow-ups/calendar, dashboard, inventory, transactions, search, broker directory, owner, builder/project, notifications, users, duplicate-review, storage observability, negotiation, deal, token, commission, and closing routes are authenticated and permission-gated; public broker-share token routes remain the deliberate exception. Search results must apply linked-record and tenant authorization, broker directory responses must use a read capability plus an explicit safe-field whitelist, internal owner/builder/project lists must be tenant-filtered, project creation must validate existing builder references against the caller tenant, notification settings require administrator permission at the route boundary, and legacy user listing delegates to the admin user-management capability. New inventory records must ignore client-supplied tenant IDs. Setup endpoints must never return shared secrets.

**Why:** Authentication proves identity but does not establish that an agent may mutate global Builder Project or Broker Network data, inspect storage internals, or consume unbounded request resources.

**How to apply:** Add new capability codes to the canonical auth permission vocabulary, gate routes before service calls, preserve disabled-feature status contracts, fail closed when a scoped record has no tenant metadata, and keep payload/rate limits covered by regression tests.