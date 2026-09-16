# Phase 5.0 Production Architecture

## 1. Current Architecture Inventory

The repository currently contains a browser-first Signature Realty OS built around a single Node.js HTTP server and a JSON-backed repository. It has completed and frozen CRM, inventory, matching, shortlist, site visit, negotiation, token, deal, commission, closing, reporting, and admin flows.

### Runtime and server
- `server.js` is the runtime boundary. It serves the SPA and exposes REST endpoints under `/api/*`.
- `src/runtime/app.js` is the service facade used by the server. It composes the repository, router, forms engine, matching engine, and broker service.
- `src/controllers/router.js` wires controller modules such as dashboard, leads, transactions, requirements, matching, brokers, and site visits.
- `src/data/repository.js` is the primary business logic and persistence layer using a JSON file database.

### Data model and schema
- `src/data/schema.js` defines the canonical entity model and lifecycle values used by the app.
- It already includes core entities such as Users, Roles, Leads, Requirements, Inventory, Matches, Shortlists, SiteVisits, Negotiations, Tokens, Deals, Commission, Closings, Documents, Builders, Projects, Brokers, BrokerShares, BrokerSubmissions, etc.
- The schema shows a single-company, JSON-collection approach, not a normalized production relational schema.

### Existing app surface
- `app.js` is a single-page app that renders CRM sections including dashboard, leads, workspace, requirements, inventory, matching, shortlist, site visits, negotiation, deal center, commission, reports, broker collaboration, admin, and settings.
- `index.html` and `styles.css` provide the responsive UI shell and styling.
- The UI already contains broker collaboration screens and requirement-sharing UI hooks, though they are mostly front-end placeholders for an underlying broker network layer.

### Current persistence model
- The repository creates a local JSON database at `data/sig-realty-db.json` and writes atomic temp files to the same directory.
- `ensureDatabase()` initializes a schema-like object with collections for many domain entities.
- Seed data is injected through `src/data/store.js`.
- This is reliable for local tests and development, but it is not production-safe for multi-tenant SaaS, file storage, RBAC, broker security, or cloud operations.

### Existing features already implemented and frozen
- CRM lead lifecycle
- Requirement management and associated history
- Matching engine and scoring
- Shortlist flows
- Site visit flow
- Negotiation lifecycle
- Token and deal creation
- Commission and closing rules
- Reporting and analytics
- Admin, settings, masters, permissions, backup, audit, health checks

These areas are already implemented and must remain intact.

## 2. Target Production Architecture

The target is a single domain model served by one API layer that can support:
- CRM
- Website
- Mobile app
- Broker portal
- Broker network
- Admin panel
- Multi-company/multi-brokerage tenancy

This should be API-first and database-first, with the frontend and mobile clients consuming the same service layer instead of duplicating business logic.

### Target runtime architecture

Signature Realty OS
  |
  +-- Website
  +-- Mobile App
  +-- Broker Portal
  +-- Admin Panel
  +-- CRM UI
  |
  +-- REST API / Graph-ready API boundary
  |
  +-- Auth + RBAC + tenancy layer
  |
  +-- Domain services and repository adapters
  |
  +-- Primary database (PostgreSQL/Supabase-style)
  +-- File storage (Supabase Storage / S3 / object store)
  |
  +-- Analytics and reporting layer
  +-- Import/export layer for Google Sheets / CSV / Excel

The crucial principle is: current JSON/test architecture remains usable for local development, and the future production layer is abstracted behind repository/service interfaces so frozen business modules do not need to be rewritten.

## 3. Current JSON/Test Persistence

Current persistence behaviors:
- JSON document store per database file
- Atomic write with temp file rename
- Seeded starter data inserted on bootstrap
- Entity collections with nested arrays and payloads
- Business logic is embedded in repository methods

This is adequate for:
- local dev
- tests
- demos
- single-company operation

It is not adequate for:
- multi-tenant isolation
- secure broker sharing
- production file metadata
- low-latency API use
- row-level security
- multi-user concurrent writes
- external object storage

## 4. Production Database Abstraction

The production layer should be introduced behind a repository abstraction rather than replacing the current run-time immediately.

### Proposed abstraction
- `DomainRepository`
- `SqlRepository` or `SupabaseRepository`
- `JsonRepository` for tests and local compatibility
- `StorageProvider`

### Interface responsibilities
- CRUD for entity sets
- validation
- soft deletes / archival
- id creation and stable identifiers
- audit insertions
- tenant/company scoping
- relationship queries
- import/export transformations

### Production database shape
- Prefer relational tables or a PostgreSQL-compatible schema with explicit foreign keys and indexes.
- Store metadata in normalized tables, not large nested JSON blobs for core business records.
- Use an adapter layer so current frozen logic continues to run against the JSON repository while the production implementation is prepared behind the same API contract.

## 5. API Architecture

### Proposed boundaries
- `/api/auth/*`
- `/api/users/*`
- `/api/companies/*`
- `/api/brokerages/*`
- `/api/leads/*`
- `/api/transactions/*`
- `/api/requirements/*`
- `/api/inventory/*`
- `/api/projects/*`
- `/api/builders/*`
- `/api/matching/*`
- `/api/shortlists/*`
- `/api/site-visits/*`
- `/api/negotiations/*`
- `/api/tokens/*`
- `/api/deals/*`
- `/api/commissions/*`
- `/api/closing/*`
- `/api/reports/*`
- `/api/admin/*`
- `/api/media/*`
- `/api/documents/*`
- `/api/broker-network/*`

### API principles
- Backend owns all business rules.
- Frontend and mobile are clients.
- Response DTOs shape internal records for public or broker-specific views.
- Field-level security is enforced at API response time, not by UI-only hiding.

## 6. Authentication Foundation

### Required production behavior
- secure login credential handling
- session or token-based authentication
- refresh token and expiry support
- logout and invalidation support
- user status checks such as active/inactive/blacklisted
- audit logging of login and authorization events
- strong secret handling outside frontend storage

### Notes for this codebase
- The runtime already contains `resolveAuthenticatedAdmin()` and `requireAdminPermission()` patterns in `src/runtime/app.js`.
- This is a good starting point to evolve into a full auth + RBAC layer.
- Login secrets should never be stored in browser localStorage unless a deliberately secure, ephemeral flow is designed.

## 7. Authorization and RBAC

### Roles
- SUPER_ADMIN
- COMPANY_ADMIN
- MANAGER
- BROKER
- AGENT
- EXTERNAL_BROKER
- VIEWER

### Permissions (examples)
- lead.view
- lead.create
- lead.edit
- requirement.view
- requirement.create
- requirement.share
- inventory.view
- inventory.create
- broker_network.view
- broker_network.share
- broker_network.respond
- deal.view
- commission.view
- commission.manage
- admin.manage

### Model
- Users belong to one or more company/brokerage scopes.
- Roles grant permissions.
- Access checks occur on both identity and company scope.
- Data must be filtered by companyId / brokerageId.

## 8. Multi-Tenant Foundation

The production model must support:
- companyId
- brokerageId
- userId
- roleId
- createdBy / updatedBy

### Data scoping rule
All company-owned entities must be capable of being scoped to a company and a brokerage. Private data for one brokerage must never be visible to another brokerage.

### Legacy compatibility
- Existing single-company development mode continues to operate with default company and default brokerage values.
- Tenant scoping can be added as a non-breaking adapter layer.

## 9. Broker Network Data Model

The current project already contains `Brokers`, `BrokerShares`, and `BrokerSubmissions` in the schema and a basic broker service stub. That is a foundation but not a security-grade broker network.

### Proposed tables and entities
- `companies`
- `brokerages`
- `broker_networks`
- `users`
- `broker_profiles`
- `shared_requirements`
- `shared_requirement_properties`
- `shared_requirement_events`
- `broker_property_responses`
- `broker_network_audit`

### Shared requirement model
- `SharedRequirementID`
- `RequirementID`
- `OriginatingBrokerID`
- `OriginatingCompanyID`
- `ShareToken`
- `Status` (`ACTIVE`, `EXPIRED`, `REVOKED`, `CLOSED`)
- `ExpiresAt`
- `CreatedAt`
- `AccessCount`
- `LastAccessedAt`
- `RevokedAt`

### Shared requirement response model
- `SharedRequirementResponseID`
- `SharedRequirementID`
- `PropertyID`
- `SubmittingBrokerID`
- `SubmittingCompanyID`
- `Status`
- `SubmittedAt`
- `Message`
- `Attribution`
- `CreatedAt`
- `UpdatedAt`

### Security requirement
- Do not expose client identity through a public or external broker URL.
- Use a separate DTO/response mapper to shape broker-network payloads.
- Only field-level safe data should be returned.

## 10. Client Privacy and Broker Sharing

### Internal lead record
- ClientName
- Mobile
- Email
- Address
- Notes
- AssignedAgentID

### Broker-external DTO
- SharedRequirementID
- TransactionType
- Category
- BHK
- BudgetMin
- BudgetMax
- Locations
- Possession
- Urgency
- OriginatingBrokerDisplayName

### Safe sharing rule
The external broker should never see client identity unless explicitly authorized and legally permitted. This must be enforced at API output shape, not only in UI code.

## 11. Builder and Project Architecture

The repository already contains `Builders` and `Projects` collections, which is a good start for a future production model.

### Proposed project fields
- ProjectID
- BuilderID
- ProjectName
- RERA
- Address
- City
- Location
- Latitude
- Longitude
- Status
- Possession
- Description

### Project configuration examples
- 1 BHK
- 2 BHK
- 3 BHK
- 4 BHK
- Penthouse
- Commercial
- Office
- Shop
- Plot

## 12. Project Media Center

Media must be stored as metadata plus object storage URLs rather than raw binary rows.

### Proposed media table
- MediaID
- ProjectID
- PropertyID
- Type
- Title
- StorageURL
- ThumbnailURL
- MimeType
- Size
- UploadedBy
- Visibility
- CreatedAt

### Media types
- IMAGE
- VIDEO
- BROCHURE
- PDF
- FLOOR_PLAN
- PRICE_LIST
- RERA
- DOCUMENT
- VIRTUAL_TOUR
- CAD
- OTHER

## 13. Property Inventory Model

Inventory already supports property and builder/project data. The next step is to normalize it into a production property model with tenancy and visibility rules.

### Proposed property model
- PropertyID
- ProjectID
- BuilderID
- OwnerID
- BrokerageID
- TransactionType
- Category
- SubCategory
- Configuration
- BHK
- Area
- Price
- Status
- Possession
- Location
- Latitude
- Longitude
- RERA
- Visibility
- CreatedAt
- UpdatedAt

### Property sharing model
- Own inventory
- Broker inventory
- Builder inventory
- Project inventory
- Owner inventory

All exposures should respect permissions, visibility, and privacy boundaries.

## 14. Website and Mobile Architecture

### Website integration
- Same API as CRM
- Public website only exposes explicitly public properties/projects
- Leads created through website flow are routed into CRM `lead -> requirement -> matching -> follow up`
- Lead source is tracked, e.g. `WEBSITE`

### Mobile-first model
- Primary navigation: Home, Clients, Requirements, Inventory, Network, More
- Touch-friendly, no horizontal overflow, responsive at 360x800, 390x844, 768x1024, and 1024x768
- Shared API contract and same domain services, not a separate data store

## 15. Google Sheets Role

Google Sheets must be treated as an import/export and bulk provisioning layer, not as the primary database.

### Supported flows
- Import: Sheet -> validation -> API -> database
- Export: database -> API -> Sheet
- Builder CSV / Excel / Sheet upload for mass data ingestion

### Rule
Data import must validate keys, required fields, ownership, and duplication before insertion.

## 16. Data Migration Strategy

Migration should be staged and reversible.

### Required migration steps
1. Export live JSON data
2. Validate schema and IDs
3. Transform to relational/SQL-compatible records
4. Import in batches
5. Verify row counts
6. Verify relationship counts
7. Verify financial totals, deal counts, and token counts
8. Generate migration report

### Migration report fields
- Imported
- Failed
- Skipped
- Duplicate
- Relationship mismatch

### Safety rule
Do not overwrite or destroy the current JSON/test database during migration development.

## 17. Backward Compatibility Strategy

The safest Phase 5 approach is not to rewrite the frozen modules. Instead:
- maintain the current JSON repository for tests and local development
- add adapter/repository interfaces for future SQL-driven persistence
- add an API abstraction layer that sits in front of both local and future production repositories
- keep the existing UI and business rules intact until the production abstraction is validated

## 18. Security Model

### Must be protected from leakage
- client mobile
- client email
- client address
- private notes
- owner private details
- PAN / Aadhaar / government identification
- private brokerage information

### Must be enforced
- API response field shaping
- broker network DTO mapping
- authorization checks by tenancy
- audit logging for sharing events, access, and responses
- secure management of share tokens, expiry, revocation, and access tracking

## 19. Testing Strategy

The project already has a disciplined test setup: direct Node tests, API tests, integration tests, and Playwright E2E tests.

### Phase 5 test gates
1. architecture test / inventory documentation
2. database abstraction tests
3. API contract tests
4. auth tests
5. permission tests
6. broker network privacy tests
7. secure token tests
8. media tests
9. migration tests

### Broker network test requirements
- client name hidden
- client mobile hidden
- client email hidden
- private notes hidden
- secure token required
- expired token rejected
- revoked token rejected
- broker sees only permitted inventory
- submitted property remains attributed
- originating broker sees responses
- receiving broker cannot access private client identity
- audit events created for network actions

## 20. Phase 5.0 Implementation Sequence

The planned sequence is:
- Phase 5.0-A: Architecture documentation
- Phase 5.0-B: Database abstraction
- Phase 5.0-C: Production schema
- Phase 5.0-D: API abstraction
- Phase 5.0-E: Authentication foundation
- Phase 5.0-F: Authorization / RBAC
- Phase 5.0-G: Multi-company foundation
- Phase 5.0-H: File/media storage abstraction
- Phase 5.0-I: Migration/import-export architecture
- Phase 5.0-J: Broker network data model
- Phase 5.0-K: Broker network secure sharing
- Phase 5.0-L: Broker network property response
- Phase 5.0-M: Broker network audit/attribution

Only after that foundation is stable should the project proceed to:
- Phase 5.1 Builder / Project Media Center
- Phase 5.2 Website API integration
- Phase 5.3 Mobile application

## 21. Gap Summary

The current repository is already strong in domain functionality and UI flows, but it is missing a production architecture layer for:
- multi-company / multi-brokerage tenancy
- normalized relational schema
- secure auth and RBAC
- broker network secure sharing
- external file/media storage abstraction
- public/private property visibility rules
- production-grade API contract boundaries
- migration and import/export controls
- privacy-by-design DTO mapping

## 22. Execution Rule for This Step

This step is architecture-only and documentation-only. No frozen business logic has been modified. The current JSON repository, service logic, and tested modules remain intact.
