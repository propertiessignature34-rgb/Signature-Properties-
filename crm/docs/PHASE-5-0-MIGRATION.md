# Phase 5.0-B Migration Foundation

## Status

This is a migration design and tooling boundary only. Phase 5.0-B does not connect to a production database, migrate data, or modify the current JSON database.

## Migration Flow

```text
JSON repository
    |
    v
Export snapshot
    |
    v
Validate shape, IDs, references, tenants
    |
    v
Transform JSON field names to relational records
    |
    v
Import in dependency order
    |
    v
Verify counts, relationships, IDs, and financial totals
```

## Entity Mapping

The source collections and destination tables are documented in [PHASE-5-0-DATABASE-SCHEMA.md](PHASE-5-0-DATABASE-SCHEMA.md). The migration boundary must preserve current business IDs while adding internal relational UUIDs.

| Source collection | Destination table | Primary source identifier |
| --- | --- | --- |
| Users | users | UserID |
| Roles | roles | RoleID |
| Leads | leads | LeadID |
| Transactions | transactions | TransactionID |
| Requirements | requirements | RequirementID |
| RequirementHistory | requirement_history | RequirementHistoryID |
| Inventory / Properties | properties | PropertyID |
| Builders | builders | BuilderID |
| Projects | projects | ProjectID |
| Documents | documents | DocumentID |
| Matches | matches | MatchID |
| Shortlists | shortlists | ShortlistID |
| SiteVisits | site_visits | VisitID |
| Negotiations | negotiations | NegotiationID |
| NegotiationHistory | negotiation_history | NegotiationHistoryID |
| Tokens | tokens | TokenID |
| Deals | deals | DealID |
| Commission | commissions | CommissionID |
| CommissionLedger | commission_ledger | LedgerID |
| Closings | closings | ClosingID |
| ClosingHistory | closing_history | ClosingHistoryID |
| FollowUps | followups | FollowUpID |
| Timeline | timeline | TimelineID |
| Reports | reports | ReportID |
| Settings | settings | SettingsID |
| Audit | audit_logs | AuditID |
| Brokers / BrokerShares / BrokerSubmissions | broker relationship and network tables | existing broker/share/submission IDs |

## Dependency Order

1. Companies and brokerages
2. Roles and permissions
3. Users and user roles
4. Builders
5. Leads
6. Transactions
7. Projects
8. Properties/inventory
9. Requirements
10. Requirement history
11. Matches
12. Shortlists
13. Site visits
14. Negotiations
15. Negotiation history
16. Tokens and token history
17. Deals and deal history
18. Commissions and commission ledger
19. Closings and closing history
20. Followups, tasks, timeline, reports, settings, documents, and media metadata
21. Broker relationships and shared requirement records
22. Audit events and broker network events

## Validation

Before import, validate:

- every required source collection is an array or is explicitly defaulted to an empty collection
- every external business ID is non-empty and unique within its entity type
- every relationship reference resolves to a source record or is reported as an unresolved reference
- monetary fields are numeric and non-negative where the current repository requires that rule
- lifecycle statuses are members of the existing schema values
- dates are parseable and retain their source precision
- records with sensitive fields are not copied into public or broker DTO tables
- tenant assignment is present for every company-owned record

## Duplicate Strategy

- Exact duplicate external IDs are not silently overwritten.
- A duplicate is reported with source collection, business ID, and row fingerprint.
- Identical duplicate rows may be marked `SKIPPED_DUPLICATE` after operator review.
- Conflicting rows are `FAILED_CONFLICT` and block final certification until resolved.
- Existing source data is never deleted during duplicate handling.

## ID Preservation

- Existing IDs such as `LEAD-0001`, `REQ-0001`, `PROP-0001`, `TOK-*`, and `DEAL-*` remain unique external identifiers.
- The transform creates an internal UUID mapping table in memory or a migration staging table.
- Foreign keys are resolved through that mapping, never through string parsing or regenerated counters.

## Error Handling

Every row receives a migration result:

- `IMPORTED`
- `FAILED_VALIDATION`
- `FAILED_REFERENCE`
- `FAILED_CONFLICT`
- `SKIPPED_DUPLICATE`
- `SKIPPED_UNSUPPORTED`

Errors include entity, external ID, field, message, and source snapshot location. Secrets and client identity should not be copied into error logs unnecessarily.

## Transaction and Rollback

- Import batches should run in database transactions.
- A failed batch is rolled back before the next batch is attempted.
- A migration run has a run ID and immutable report.
- The current JSON source remains untouched.
- Rollback means removing only rows created by that migration run, or restoring the target database to its pre-run snapshot; it never means deleting the source JSON.

## Verification

The final report must compare source and target:

- row counts by entity
- imported / failed / skipped / duplicate counts
- relationship resolution counts
- external ID uniqueness
- lead-to-requirement counts
- requirement-to-property/match counts
- token, deal, commission, and closing counts
- financial totals for deal value, brokerage, gross commission, received amount, and pending amount
- audit and history row counts

Any mismatch is a migration blocker, not a reason to silently adjust source data.

## Future Tool Boundary

A future migration command should expose separate stages such as:

- `export`
- `validate`
- `transform`
- `import`
- `verify`
- `report`

The command should accept an explicit source JSON path, target profile, dry-run mode, and migration run ID. It must not be introduced until the production database adapter and auth/tenant policies are certified.
