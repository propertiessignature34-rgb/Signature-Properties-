# Signature Realty CRM — PRD

## Original problem statement
Import the existing GitHub repo (Node.js real-estate brokerage CRM "Signature Realty"),
keep building/fixing it, use platform-managed Google login (admin =
propertiessignature34@gmail.com), move storage to a real database, and get it live.

## Architecture
- **Node.js CRM** (single HTTP server, `/app/crm/server.js`) serves both the HTML pages
  (dashboard, clients, leads, inventory, builder projects, broker network, calculators,
  digital card, login) and the `/api/*` endpoints on the same origin. Runs internally on
  **port 3001** as supervisor program `crm`.
- **Ingress fit (platform requirement):**
  - FastAPI (`/app/backend/server.py`, :8001) = transparent reverse proxy: `/api/*` → :3001.
  - CRA dev server (`/app/frontend/src/setupProxy.js`, :3000) = proxy for all non-`/api`
    paths → :3001.
  - Both preserve Host + set `X-Forwarded-Proto/Host` so the CRM resolves the real public
    origin for OAuth redirects and secure cookies.
- **Storage:** MongoDB (`STORAGE_MODE=mongo`, DB `signature_properties`), single-document
  snapshot collection `db_snapshot`.
- **Auth:** Platform-managed Google OAuth (Emergent). Only ACTIVE users already present in
  the CRM (matched by email) may sign in. In-memory session store; cookie `sig_dashboard_session`.

## User personas
- **Admin/Owner** (propertiessignature34@gmail.com): full ADMIN access to all modules.
- **Agents/Managers/Brokers/Viewers**: role-scoped permissions (RBAC defined in authService).

## Core requirements (static)
- Google-only sign-in via platform flow; admin mapping preserved.
- Database-backed storage that survives restarts.
- Core brokerage lifecycle usable end-to-end: leads → requirements → inventory/matching →
  shortlist → site visits → negotiation → token → deal → closing → commission; plus broker
  network, media/documents, admin/reporting.

## Implemented (2026-06)
- Imported the Node CRM into `/app/crm`; installed deps with yarn; running under supervisor
  on :3001 with Mongo storage.
- Reverse-proxy wiring (:8001 and :3000 → :3001) so the app is reachable on the preview URL.
- Platform-managed Google sign-in wired and verified up to the consent screen; admin email
  attached to the built-in ADMIN user (USR-SYSTEM-ADMIN).
- Verified authenticated ADMIN flows via loopback test-session: dashboard, leads CRUD,
  inventory, requirements, site-visits (contract), persistence to Mongo. 19/19 backend tests passed.
- Hardened the FastAPI proxy against transient keep-alive ReadErrors (retry idempotent + short
  keepalive_expiry).

## Notes / known behavior
- **Boot-time Google Sheet sync:** on startup the app auto-imports ~200+ leads/requirements
  from a public Google Sheet (repo's built-in `googleSheetSyncService`, every 5 min). The app
  does NOT come up empty. Can be disabled on request.
- The "gethub" file-browser page is demo-only, left as-is.
- Completing the Google consent screen is a human-only step (cannot be automated).

## Backlog (prioritized)
- P1: Decide on the Google Sheet auto-sync (keep as the live data source vs. disable for a clean start).
- P1: Add more allowed users / roles via the Admin > Users module.
- P2: Deep-polish secondary modules (advanced reporting, notifications, calendar, follow-up automation).
- P2: Bulk data imports (e.g., the "Karma projects" import) if needed.
- P3: Split server.js into route modules; migrate Mongo snapshot → per-collection persistence for scale.

## Next tasks
- User completes Google consent once and confirms admin lands on the dashboard.
- Publish live via the platform flow.
