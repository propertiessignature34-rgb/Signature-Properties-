# Phase 5.0-B Database Schema Design

## Status

This document defines the production relational foundation. It is design-only in Phase 5.0-B: no live database connection or data migration is performed.

The executable PostgreSQL-compatible draft is [db/schema.sql](../db/schema.sql).

## Mapping Principles

- Existing JSON business IDs remain traceable as unique external identifiers such as `lead_id`, `requirement_id`, and `property_id`.
- Each relational table also has an internal UUID primary key for foreign-key efficiency and provider portability.
- Current JSON field names are mapped to snake_case SQL names without changing current runtime behavior.
- Company-owned records include `company_id` and, where relevant, `brokerage_id`.
- Actor fields use `created_by` and `updated_by` where the current model already has creator/updater semantics.
- Important operational records support `archived_at` and `deleted_at`; financial and history rows are retained rather than physically deleted.

## Current JSON to Relational Mapping

| Current JSON entity | Future table | External primary key | Important foreign keys | Tenant fields | Important indexes |
| --- | --- | --- | --- | --- | --- |
| Users | users | UserID -> user_id | company, brokerage | company_id, brokerage_id | tenant, status |
| Roles | roles | RoleID -> role_id | none | none | name |
| Permissions | permissions | PermissionID -> permission_id | none | none | code, module/action |
| Users.Permissions / role assignments | user_roles | composite user/role relation | user_id, role_id | company_id, brokerage_id | user, role, tenant |
| Leads | leads | LeadID -> lead_id | assigned agent, actor users | company_id, brokerage_id | status, assigned agent, created_at |
| Transactions | transactions | TransactionID -> transaction_id | lead_id | company_id, brokerage_id | lead_id, status |
| Requirements | requirements | RequirementID -> requirement_id | lead_id, transaction_id | company_id, brokerage_id | lead/transaction, status, created_at |
| RequirementHistory | requirement_history | RequirementHistoryID | requirement_id, updated_by | inherited through requirement | requirement, updated_at |
| Inventory | properties | PropertyID -> property_id | project, builder; owner/broker retained as external IDs initially | company_id, brokerage_id | category, property type, location, price, BHK, area, visibility |
| Properties | properties | PropertyID -> property_id | project/builder | company_id, brokerage_id | same property indexes |
| Builders | builders | BuilderID -> builder_id | actor users | company_id, brokerage_id | name, tenant |
| Projects | projects | ProjectID -> project_id | builder_id | company_id, brokerage_id | builder, status |
| Documents | documents | DocumentID -> document_id | lead/entity references | company_id, brokerage_id | entity, status |
| Project/property media | inventory_media | MediaID -> media_id | project_id/property_id | company_id, brokerage_id | entity, visibility, created_at |
| Matches | matches | MatchID -> match_id | requirement_id, property_id, lead_id | company_id, brokerage_id | requirement/property, score |
| Shortlists | shortlists | ShortlistID -> shortlist_id | lead, transaction, requirement, property | company_id, brokerage_id | requirement/property/status |
| SiteVisits | site_visits | VisitID -> visit_id | lead, transaction, requirement, property, agent | company_id, brokerage_id | requirement/property/status |
| Negotiations | negotiations | NegotiationID -> negotiation_id | lifecycle entities and previous-stage IDs | company_id, brokerage_id | requirement/property/status |
| NegotiationHistory | negotiation_history | NegotiationHistoryID | negotiation_id, user_id | inherited through negotiation | negotiation, timestamp |
| Tokens | tokens | TokenID -> token_id | lead, requirement, property, negotiation, shortlist | company_id, brokerage_id | requirement/property/status |
| Token history | token_history | TokenHistoryID | token_id, actor | inherited through token | token, created_at |
| Deals | deals | DealID -> deal_id | lead, requirement, property, negotiation, token | company_id, brokerage_id | tenant/status/created_at |
| Deal history | deal_history | DealHistoryID | deal_id, actor | inherited through deal | deal, created_at |
| Commission | commissions | CommissionID -> commission_id | deal, token, negotiation, lead, requirement, property, agent | company_id, brokerage_id | deal/status/due_date |
| CommissionLedger | commission_ledger | LedgerID -> ledger_id | commission and lifecycle entities | inherited through commission | commission, entry date |
| Closings | closings | ClosingID -> closing_id | deal, token, negotiation, transaction, requirement, property | company_id, brokerage_id | deal/status |
| ClosingHistory | closing_history | ClosingHistoryID | closing_id, deal, lead, actor | inherited through closing | closing/event date |
| FollowUps | followups | FollowUpID -> followup_id | lead, transaction, assigned user | company_id, brokerage_id | assigned/status/due date |
| Tasks | tasks | TaskID -> task_id | assigned user and polymorphic entity reference | company_id, brokerage_id | assigned/status/due_at |
| Timeline | timeline | TimelineID -> timeline_id | lead and polymorphic entity reference | company_id, brokerage_id | lead/event date |
| Reports | reports | ReportID -> report_id | actor user | company_id, brokerage_id | category/status |
| Settings | settings | SettingsID -> settings_id | actor user | company_id, brokerage_id | tenant/key/version |
| Audit | audit_logs | AuditID -> audit_id | actor user | company_id, brokerage_id | tenant/entity/time |
| Brokers | broker_relationships / users / brokerages | BrokerID retained as external broker identifier | company/brokerage relationship | originating/receiving company IDs | broker/status |
| BrokerShares | shared_requirements | BrokerShareID / ShareCode mapped to shared requirement and token hash | requirement, originating broker/company | originating_company_id, originating_brokerage_id | token, origin, status, expiry |
| BrokerSubmissions | shared_requirement_properties | BrokerSubmissionID -> shared_requirement_property_id | shared requirement, property | submitting company/brokerage | parent/property/submitter |
| Broker network activity | broker_network_events | EventID -> event_id | shared requirement/response, actor | company_id, brokerage_id | parent/time |

## Lifecycle Relationships

The normalized foreign-key plan preserves:

`leads -> transactions -> requirements -> matches -> shortlists -> site_visits -> negotiations -> tokens -> deals -> commissions -> closings`

The links are intentionally explicit. A relational adapter can resolve existing external IDs to UUIDs during migration while retaining the original IDs for API compatibility, audit, and reconciliation.

## Tenancy

The root tenancy is:

`companies -> brokerages -> users`

Company-owned tables carry `company_id`. Brokerage-specific records additionally carry `brokerage_id`. During migration, a default development company and brokerage can be assigned to existing single-company JSON records. No current JSON record needs to be rewritten for this design phase.

Row-level security policies are deliberately deferred to the authentication and authorization phase. The required tenant columns and lookup indexes are already specified.

## IDs and Compatibility

The database uses UUIDs as internal primary keys and the existing business IDs as unique external IDs. For example:

- `LEAD-0001` remains `leads.lead_id`
- `REQ-0001` remains `requirements.requirement_id`
- `PROP-0001` remains `properties.property_id`
- `MATCH-*` remains `matches.match_id`
- `SHORT-*` remains `shortlists.shortlist_id`
- `VISIT-*` remains `site_visits.visit_id`
- `NEG-*` remains `negotiations.negotiation_id`
- `TOK-*` remains `tokens.token_id`
- `DEAL-*` remains `deals.deal_id`
- `COM-*` remains `commissions.commission_id`
- `CLOSE-*` remains `closings.closing_id`

## Index Strategy

- Tenant/status/created indexes support scoped operational lists.
- Relationship indexes support lifecycle screens and API joins.
- Property search indexes cover category, type, location, price, BHK, and area because these are the matching engine's primary candidate dimensions.
- Share token hashes are indexed for constant-time secure-link lookup.
- Expiry/status and origin indexes support network dashboards and cleanup jobs.
- Audit and timeline indexes support chronological investigation.

Indexes should be reviewed with production query plans before adding further indexes.

## Audit and Soft Delete

Audit rows capture actor, tenant, action, module/entity, before/after states, result, timestamp, and optional IP/device metadata. Sensitive identity fields should be redacted before serialization into audit payloads.

Important business entities use `status`, `archived_at`, and `deleted_at`. Financial records, histories, audit logs, and attribution records should remain retained for reconciliation and dispute handling.

## Media Metadata

`inventory_media` and `documents` store metadata and object storage references only. They do not store binary photos or videos in PostgreSQL. `storage_provider`, `storage_path`, MIME type, size, checksum, visibility, and uploader metadata allow a future Supabase Storage or S3-compatible provider without changing domain records.
