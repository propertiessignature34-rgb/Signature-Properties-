## What's Been Implemented — Karma Group Builder Project Scrape

- Re-enabled authenticated Karma Group scraping with the current public listing URL and live status endpoint.
- Added Source Project ID deduplication, safer current-page parsing, non-destructive updates, and a Builder Projects scrape button with progress/result counts.
- Automatic brochure binary ingestion stays disabled by default; project details and source URLs are imported without bypassing source restrictions.
- Live run completed through the public API: 143 discovered/scanned, 143 unique Builder Project records, 0 failures, and invalid source status tokens excluded from RERA identity.
- Added the preview `/api` proxy on port 8001 so the existing Node API is reachable through Emergent's split UI/API ingress.
- Expanded the live catalog to all 8 source categories: 758 unique projects saved permanently in Mongo.
- Downloaded and verified every source-available media item into internal GridFS: 2,733 photos, 409 floor plans, and 431 brochures (3,573 files / 5.66 GB); media records expose only internal `/api` URLs.
- The source itself has 103 broken media URLs (HTTP 404) and one `.pdf` that contains HTML rather than PDF bytes; these are marked unavailable instead of storing fake or unsafe files.

## What's Been Implemented — Mobile PWA Access

- Added a root-scoped installable web app manifest, service worker, Signature Properties icon, and Android/iOS Add to Home Screen prompt.
- Shared links open in the mobile browser; no Play Store publication is required.
- Linked `propertiessignature34@gmail.com` to the active `USR-SYSTEM-ADMIN` account with ADMIN access.

## What's Been Implemented — Gethub / Seen My File

- Added a standalone public `/gethub` file browser with a high-contrast dark repository UI.
- Added demo file tree, multi-file tabs, code/document preview, metadata sidebar, language mix, activity and commit history.
- Added local search, Cmd/Ctrl+K quick find, recent files drawer, copy/download actions, branch/star demo actions, and drag/drop local file preview.
- No third-party integration or new persistence was added; uploaded files remain local to the browser session.

## What's Been Implemented — Session 25 (Aug 2026, fork continuation)

### Real Google Sign-In completed + API auth-gate security fix + deployment check
- **Completed Google Auth wiring**: injected the missing `doLogout()` JS function (POST `/api/auth/logout` + redirect) into the 8 pages that only had a dangling `onclick="doLogout()"` link (clients, inventory, duplicates, requirements-view, builder-projects, broker-network, calculators, digital-card.html). `DEMO_MODE` is now `false` — real Emergent-managed Google Sign-In is live (`login.html` → `auth.emergentagent.com` → `/api/auth/session-exchange` → `sig_session` cookie). Page gating (302→`/login.html` for any unauthenticated request to a non-public page) verified working.
- **SECURITY FIX (found by testing_agent, iteration_15.json)**: `GET /api/leads`, `GET/POST /api/builders`, `GET/POST /api/projects` had ZERO auth checks — fully public data leak even with real auth now live. Added `_requireActor`/`getAuthenticatedActor` guards to all 5 (v2Router.js `/api/leads` GET; server.js `/api/builders` + `/api/projects`). Verified via curl: anonymous → 401, with `sig_session` cookie → 200.
- **Testing (iteration_15.json)**: 33/33 backend pytest pass (page gating, session-exchange, logout revocation, test-session bypass all correct) + 100% frontend (doLogout defined on all 8 pages, no console errors, Google redirect works). 2 critical/high API-auth bugs found & fixed post-test (see above).
- **Fixed stale `APP_URL`** in `/etc/supervisor/conf.d/realty.conf` (was pointing to an old fork's preview URL).
- **Deployment check**: `deployment_agent` found `.env`/`.env.*` wrongly excluded in `.gitignore` — fixed (removed those lines). Second run surfaced a genuine infra question: the platform's default (READONLY) `/etc/supervisor/conf.d/supervisord.conf` still declares standard `[program:backend]`(uvicorn)/`[program:frontend]`(yarn) blocks that don't apply to this custom monolithic `node server.js` app (`realty` program) — both crash-loop harmlessly in preview (no port conflict, since they error out before binding), but `deployment_agent` flags it as a K8s deploy blocker. Escalated to `support_agent` — outside documented scope; user should contact **support@emergent.sh** with job ID before attempting a real deploy of this non-standard app architecture.
- **Known limitation (by user's own explicit choice)**: sessions are in-memory (`Map` in `authService.js`), not Mongo-backed — restart/redeploy = all users logged out. User explicitly approved this tradeoff ("Session storage Abhi skip karo, deploy karo").
- **Node process has NO hot-reload** (`node server.js` directly, no nodemon) — `sudo supervisorctl restart realty` required after every `server.js`/`src/**` change to take effect (learned during this session's security fix, which initially appeared not to work due to this).

## What's Been Implemented — Session 24 (Sep 6, 2026)

### Bug Fix + 4 Features (Nearest Visit Order, Video Thumbnails, Calculator, Bulk Brochure Extraction)
- **BUG FIX**: "Broker network preview mein nahi dikh raha" — root cause: Dashboard Modules grid never had a Broker Network tile (only a top-nav link). Added `mod-broker-network` tile to `index.html` with live broker count. Also fixed truncated nav label on `broker-network.html` itself.
- **Nearest Visit Order**: `openVisitRoute()` in `client-workspace.html` now prefixes waypoints with `optimize:true|` — Google Maps auto-reorders multi-stop routes for shortest driving path (native URL feature, no geocoding/API key needed).
- **Video Thumbnails**: builder-project video uploads now show a `preload="metadata"` video + centered ▶ play-badge overlay; click opens video in new tab, delete button uses `stopPropagation`.
- **Loan & Stamp Duty Calculator**: new standalone page `/calculators.html` (nav link on all 7 pages) — pure client-side JS, no backend. Tab 1: EMI/loan eligibility (income, existing EMI, price, down payment, rate default 8.5%, tenure). Tab 2: Gujarat stamp duty (4.9% flat) + registration fee (1%, waived for sole-female ownership).
- **Bulk Brochure Extraction**: new "🤖 Bulk from Brochures" modal on `builder-projects.html` — upload multiple PDFs, sequentially calls the existing `extract-brochure` endpoint per file (real Gemini 3.1 Pro calls), review table with checkboxes, then batch-creates projects via existing create endpoint (no new backend route needed).
- **Testing (iteration_12.json)**: 100% backend + 100% frontend, zero bugs. Applied cheap hardening from code-review notes: `min`/`max` input clamps on calculator fields, stamp-duty-waiver-cap disclaimer note.

## What's Been Implemented — Session 23 (Sep 6, 2026)

### Brochure AI Auto-fill + Per-Config Unit Sizes for Builder Projects
User asked: uploading a brochure PDF should auto-fill the project form via AI, with per-configuration sizes (e.g. "2 BHK: 950 sqft", "3 BHK: 1200 sqft") shown separately instead of one combined range. Confirmed model = Gemini 3.1 Pro (only Gemini supports PDF document attachments in the emergentintegrations SDK).

- **`scripts/extract_brochure.py`** (Python, invoked from Node via `child_process.spawn`) — uses `emergentintegrations` `LlmChat` + `FileContentWithMimeType` to send the brochure PDF to Gemini 3.1 Pro with a strict-JSON extraction prompt (ProjectName, BuilderName, Location1, Address, RERANumber, Category, ProjectStatus, TotalUnits, PriceMin/Max, PossessionDate, Amenities, `ConfigDetails: [{Type, AreaSqft}]`).
- **`src/services/brochureExtractionService.js`** — writes incoming base64 PDF to a temp file, spawns the python script (`PYTHON_BIN` env var, defaults to `/root/.venv/bin/python3` since system `python3` lacks the pip package), 90s timeout, 15MB size guard, parses JSON from stdout.
- **New route** `POST /api/v2/builder-projects/extract-brochure` in `server.js`.
- **`builderProjectService.js`** — `_normalizePayload()` now derives `Configurations[]` + `AreaRange{min,max}` automatically whenever `ConfigDetails[]` is present in the payload (create/update).
- **`builder-projects.html`** — replaced the old flat "Configurations" text field + "Carpet Area Min/Max" fields with a dynamic **Configuration & Sizes** row-based UI (`+ Add Config`, per-row Type + Area Sqft + remove ×). Added a gold "🤖 Auto-fill from Brochure (PDF)" upload box at the top of the Add/Edit modal — populates all fields including config rows on success. Card grid shows per-config pills ("2 BHK · 950 sqft"). WhatsApp Share message branches on ConfigDetails vs legacy Configurations+AreaRange.
- **Testing (iteration_11.json)**: 100% backend (8/8) + 100% frontend, zero bugs. Post-test hardening applied: `PYTHON_BIN` now an env var (was hardcoded), added 15MB payload guard, unique Gemini session_id per extraction (was a fixed constant).

## What's Been Implemented — Session 22 (Sep 6, 2026)

### WhatsApp Reminder Templates + Builder Project Media Upload + Fix Unknown Builders
User approved 3 features together: "Yes ek sath" (do all together).

- **WhatsApp Visit Reminder**: `client-workspace.html` booking cards (Shortlist panel → Booked Site Visits) now have a green "📱 Remind" button next to "🗺️ Route". `sendVisitReminder(reqId, bookingId)` builds a Hinglish template (`🏠 *Site Visit Reminder*`, client name, date/time, meeting point, property list) + a Google Maps pin link (`google.com/maps/search/?api=1&query=...`), opens `wa.me/<clientPhone>?text=...`.
- **WhatsApp Follow-up Reminder**: Dashboard (`index.html`) Follow-ups widget `fuRow()` — WHATSAPP-type rows now build an encoded Hinglish reminder message (was previously a bare `wa.me/<phone>` link with no text).
- **Emergent Object Storage integration** — new `src/services/objectStorageService.js` (Node native `fetch`, `INTEGRATION_PROXY_URL` + `EMERGENT_LLM_KEY` added to `/etc/supervisor/conf.d/realty.conf`). `initStorage()`/`putObject()`/`getObject()` with 404→re-init-once retry.
- **Builder Project Media (Photos/Videos/Brochure)**: `builderProjectService.js` new methods `addMedia()` (base64 → object storage → appends `{MediaID, Filename, StoragePath, Url}` to `Photos[]`/`Videos[]`/`Brochures[]`), `removeMedia()`, `getMediaFile()`. New routes: `POST /api/v2/builder-projects/:id/media`, `DELETE /api/v2/builder-projects/:id/media/:mediaId`, `GET /api/v2/builder-projects/media/:mediaId` (serves bytes, GET+HEAD). `builder-projects.html` Edit modal has a Media section (multi photo/video upload, single/multi brochure PDF) — hidden on Add (new project) with a "save first" hint. Card grid shows cover image (first photo) + 📷/🎥/📄 count badges.
- **Fix Unknown Builders (bulk-edit)**: new `listUnknownBuilders()` + `bulkAssignBuilder(projectIds, builderName)` in service; routes `GET /api/v2/builder-projects/unknown-builders`, `POST /api/v2/builder-projects/bulk-assign-builder`. New "🏗️ Fix Unknown Builders" button/modal on `builder-projects.html` — lists all 30 projects with blank/"Unknown Builder" name, checkboxes pre-checked, one builder-name input, "Assign to Selected" batch-updates.
- **Testing (iteration_10.json)**: 100% backend + 100% frontend, zero bugs. Minor non-blocking suggestions only (HEAD support for media GET — fixed post-test; no DELETE endpoint on follow-ups — not in scope).

# Signature Realty CRM — Product Requirement Doc

## Original Problem Statement
"Build a mobile app: get hu merei app hai" — User is a real estate broker in Surat with an existing GitHub CRM. Wants to fix/improve lead management, add features, redesign UI, and deploy.

## User Persona
- **Primary user**: Real estate broker based in Surat, Gujarat
- **Daily workflow**: Lead intake, requirement capture, matching, site visits, negotiation, deal closure
- **Language**: Hinglish comfortable; regional (Gujarati) later

## Architecture
- **Existing codebase**: Node.js 20 + vanilla HTML/CSS/JS + JSON file DB
- **Ports adapted**: Node app now listens on both `3000` (frontend routes) and `8001` (`/api/*` routes) to work with Emergent ingress
- **DB**: `/app/data/sig-realty-db.json` — file-backed via `JsonRepository`
- **Supervisor**: `realty` program running `node server.js` (kills default backend/frontend)
- **Auth**: `DEMO_MODE=true` env auto-authenticates as System Admin (`USR-0001`) — for preview without Google OAuth
- **Preview URL**: `https://seen-my-file.preview.emergentagent.com`

## Core Modules Present
32 existing modules (Clients, Transactions, Requirements, Matching, Broker Network, etc.). Detailed inventory in chat.

## Bug Fix — Session 21 (Sep 6, 2026)
- **Reported**: "Broker network ni dikh raha hai" — page/API worked fine but had NO nav link on Dashboard/Clients/Inventory/Requirements/Duplicates/Builder-Projects (pre-existing gap, not a regression). Fixed by adding "👥 Broker Network" nav link to all 6 pages (also added missing "Builder Projects" link to clients.html/duplicates.html/requirements-view.html which had the same gap).
- **Testing (iteration_8.json)**: 100% frontend pass — verified click-through from Dashboard lands on working /broker-network with data, regression clean on all other nav links across 6 pages.
- Known nit (non-blocking): nav HTML duplicated across 7+ static files; future nav changes need multi-file edits.

## What's Been Implemented — Session 20 (Sep 6, 2026)

### Auto Scraper Scheduler + Builder Name Cleanup + Site Visit Route Planning
- **Auto Scraper Scheduler**: `_ScraperSettings.autoRunEnabled` + hourly `setInterval` tick in server.js calls `maybeAutoRun()` — runs Karma Group scrape by itself once the configured interval (Weekly/Monthly) elapses, no button click needed. Server-side guard added: can't enable auto-run with "No limit" interval (forces false).
- **Builder Name Cleanup tool**: "🧹 Clean Names" button on `/builder-projects` → modal shows duplicate builder name variants (normalized by stripping suffixes like Group/Builders/Pvt Ltd) with suggested canonical name (editable) + checkboxes, "Merge This Group" applies via `POST /api/v2/builder-projects/merge-builders`. Verified: real 546-project dataset has 0 duplicates (scraper's own naming is already consistent) — tool tested with synthetic variants, works correctly.
- **Site Visit Route Planning**: booking cards in client-workspace.html Site Visits tab now have a "🗺️ Route" button — opens Google Maps directions (origin/waypoints/destination) built from the visit's property locations + meeting point. Fixed waypoint duplication bug found by testing agent.
- **Testing (iteration_7.json)**: 7/7 backend passed (1 skipped by design), 100% frontend E2E. 2 minor issues found & fixed post-test (route waypoint duplication, missing server-side validation guard).

## What's Been Implemented — Session 19 (Sep 6, 2026)
- **Collapse/Expand builder groups**: clicking a group header (▶ chevron) toggles that builder's project list visibility. State persists while filtering/searching.
- **WhatsApp Share per project card**: "📱 Share" button on every card builds a formatted message (name, builder, location, category, status, configs, units, area, price, possession, RERA if present) and opens `wa.me` in a new tab. Verified via automated click — correct message content confirmed.

## What's Been Implemented — Session 18 (Sep 6, 2026)
- **Builder Name editable dropdown**: `f-builder-name` field in Add/Edit modal now uses a `<datalist>` populated with all 254 unique builder names from existing projects — shows as a dropdown but stays fully editable/typeable (same UX pattern as the Location field).

## What's Been Implemented — Session 17 (Sep 6, 2026)

### Group by Builder view + RERA auto-fetch feasibility check (parked)
- **Gujarat RERA auto-fetch investigated & parked**: attempted to build a "Fetch by RERA No." button that pulls official project details from gujrera.gujarat.gov.in. Found real blockers: (1) site requires legacy TLS renegotiation (non-standard SSL), (2) Angular SPA with obfuscated API base URL not resolvable from bundle, (3) any guessed API path gets WAF-blocked (403). Decision: parked this integration — RERA Number stays a manual/optional field (Add Project modal + bulk CSV), as before.
- **New "📁 Group by Builder" toggle** on `/builder-projects` — switches grid between flat "Individual View" and grouped view (projects clustered under builder name headers with counts, sorted by project count descending). Verified via screenshot both directions.

## What's Been Implemented — Session 16 (Sep 6, 2026)

### Scrape button rename + Scrape Settings (rate-limit) + cleanup
- User asked: keep ONLY Karma Group scraped data in Builder Projects, delete rest → removed the 5 legacy RERA-migrated rows + 2 test CSV rows. Builder Projects now = exactly 546 Karma Group rows (367 Residential, 158 Commercial, 21 Industrial).
- Renamed button "🔄 Scrape Karma Group" → "🔄 Scrape". Added a separate ⚙️ gear button that opens a **closed-by-default Scrape Settings modal** (per user request "setting rakho open ni").
- Added scrape rate-limiting: `db._ScraperSettings = { minIntervalHours, lastRunAt }`. Default 24h — prevents daily/repeated scraping unless user changes the interval in Settings (dropdown: No limit / Once per day / Once per week / Once per month). New API: `GET/PATCH /api/v2/builder-projects/scrape/settings`. Scrape endpoint returns HTTP 429 with a friendly cooldown message if run too soon; `{force:true}` body bypasses it (used internally, not exposed in UI by design).
- Verified via curl: cooldown blocks correctly, settings save/load correctly, modal stays closed until gear icon clicked.

## What's Been Implemented — Session 15 (Sep 6, 2026)

### 🕷️ Karma Group Scraper + Category field for Builder Projects
User asked: "https://karmagroup.co.in isme se aap le sakte ho all projects scrap kar ke" — scrape all projects from this Surat broker site and import into Builder Projects, categorized (Residential/Commercial/Industrial).

- **Site quirk discovered & solved**: karmagroup.co.in's `/Property/ProjectList` API ignores `PageNumber`/`PageSize` when `Filters=[]` (always returns same first-10 rows — a bug on their end). Fixed by fetching per-category (`ItemCategory` filter) with `PageSize=500`, which correctly returns the full category in one request.
- **New service `src/services/karmaGroupScraperService.js`** — scrapes 7 category IDs (Residential, Commercial, Industrial Plots, Club Membership, PreLease, Textile Commercial, Industrial) → mapped to app's Residential/Commercial/Industrial taxonomy. Parses card HTML via regex (ProjectName, Address, Year). BuilderName guessed from first word of project name (stopword fallback → "Unknown Builder"). Location1 matched against the 35-area Surat list (fallback "Surat"). ProjectStatus derived from possession year vs current year. Feeds an in-memory CSV into the existing `builderProjectService.commit()` pipeline (dedup, history, everything reused).
- **New API**: `POST /api/v2/builder-projects/scrape/karma-group` — triggers scrape on demand (reusable "Refresh" engine, not one-off).
- **`Category` field added** to BuilderProjects schema (Residential/Commercial/Industrial/Land) — CRUD, CSV import, and now server-side `?category=` filter all support it.
- **UI** (`builder-projects.html`): "🔄 Scrape Karma Group" button, Category filter chips, Category dropdown in Add/Edit modal, colored category badges on cards.
- **Result**: 553 total projects (367 Residential, 158 Commercial, 21 Industrial, 7 legacy from RERA migration). Scrape is idempotent — re-running updates instead of duplicating (verified: 2nd run → Inserted:0, Updated:546).
- **Testing (iteration_6.json)**: Found + fixed 1 bug (server.js `?category=` query param wasn't forwarded to service — now fixed and verified via curl, all 3 category counts correct). Frontend 100% pass (scrape flow, filter chips, badges, modal). Backend now expected 13/13 after fix (was 10/13, all 3 failures were this one bug).

## What's Been Implemented — Session 14 (Sep 6, 2026)

### 🏗️ RERA Module Removed → Builder Projects Module (Surat)
User request: "Rera wala pura part remove karo. Mere ko surat ki builder project dal ne hai" — remove RERA import/scraper entirely, replace with a Builder Projects feature.

- **Removed entirely**: `rera-import.html`, `reraImportService.js`, `reraConfig.js`, `reraPortalClient.js`, `reraScraperService.js`, `reverseMatchService.js`, `scripts/rera-refresh.cron` + installed `/etc/cron.d/rera-refresh`. All `/api/v2/rera/*` routes removed from `server.js`. RERA nav links/tiles/filter chips removed from `index.html`, `inventory.html`, `broker-network.html`.
- **New service `src/services/builderProjectService.js`** — new `db.BuilderProjects` collection (separate from Inventory). CRUD (list/get/create/update/remove — soft delete) + CSV/Excel bulk import (preview/commit, column-alias auto-detect, groups multi-unit-type rows by RERA Number OR ProjectName+BuilderName+Location, dedup on re-import) + import history (`db._BuilderProjectImports`).
- **Schema**: `ProjectID(BLDP-)`, ProjectName, BuilderName, Location1 (Surat area), Address, `RERANumber` (optional free-text, NO format validation/regex — per user Q2 choice), ProjectStatus (New Launch/Under Construction/Ready to Move/Completed), Configurations[], TotalUnits, AreaRange{min,max}, PriceRange{min,max}, PossessionDate, Amenities[], Notes.
- **API**: `GET/POST /api/v2/builder-projects`, `GET/PATCH/DELETE /api/v2/builder-projects/:id`, `POST /api/v2/builder-projects/import/{preview,commit}`, `GET /api/v2/builder-projects/import/history`.
- **New page `/builder-projects.html`** — card grid (status badge, location, config pills, price range, RERA# if present), search + status filter chips, Add/Edit modal (manual entry, all fields incl. optional RERA#), Bulk Upload modal (drag-drop CSV/Excel → Preview stats → Import), Recent Bulk Imports history table. Reuses existing 35-area Surat location autocomplete list.
- **Migration**: `scripts/migrateReraToBuilderProjects.js` (one-off, already run) — converted the 5 old RERA-scraped Inventory rows (IsReraMaster=true) into BuilderProjects entries, removed them from Inventory. Verified: Inventory now has 0 IsReraMaster rows.
- **Dashboard** (`index.html`): RERA stat tile + RERA/RERA-Import/Pending-Review module tiles replaced with a single "Builder Projects" stat + module tile, count fetched live from `/api/v2/builder-projects`.
- **Testing (iteration_5.json)**: 100% backend (18/18 pytest) + 100% frontend (grid, add/edit/delete, search, filters, bulk CSV preview→commit→history) + RERA-removal verified (`/rera-import` 404, no RERA routes/nav/tiles) + regression on Clients/Requirements/Inventory/Broker Network all clean. Zero bugs found.

## What's Been Implemented — Session 13 (Sep 4, 2026)

### 👥 Broker Network V2 (PII-safe reverse-inventory workflow)
- **New service `src/services/brokerNetworkV2Service.js`** — CRUD for broker registry + WhatsApp share lifecycle + anonymized public views + response submission → auto-Inventory + auto-Shortlist. Legacy `brokerNetworkService.legacy.js` preserved and still wired.
- **API endpoints (all under /api/v2)**:
  - `GET/POST /broker-network` + `PATCH/DELETE /broker-network/:id` — trusted broker CRUD (Name, Phone, Agency, TrustLevel, Specializations[], Notes, Active). Phone-digits dedup.
  - `POST /requirements/:reqId/network-share` `{ brokerIds[], message?, expiresInDays? }` — generates one unique base64url token per broker; returns share rows with BrokerName/BrokerPhone/Token.
  - `GET /requirements/:reqId/network-shares` — sender-side share list.
  - `POST /network-shares/:shareId/revoke` — mark Revoked.
  - **`GET /api/v2/public/req/:token` — NO AUTH** — anonymized whitelisted requirement fields ONLY (Category/SubCategory/TransactionType/Location1/2/BHK/BudgetMin/Max/Carpet/Furnishing/Purpose/Timeline/ReadyToMove/Amenities). PII leak check confirmed by testing agent (no LeadID/ClientName/Phone/Email).
  - **`POST /api/v2/public/req/:token/response` — NO AUTH** — submits property → creates Inventory row with `InventorySource='NetworkSubmission'` + `SubmittedByBrokerID`/`SubmittedByBrokerName`/`SubmittedByBrokerPhone`/`NetworkShareID`/`NetworkResponseID`/`ExpectedCommissionSplit`/`Availability` + auto-creates Shortlist entry linking Requirement → Property with `NetworkSubmission=true` and `[Network]` note prefix.
- **New pages**:
  - `/broker-network` (admin CRUD) — table with Name/Phone/Agency/Trust/Specialization + Add/Edit/Delete
  - `/share/req/<token>` (public, mobile-first) — hero greeting to broker + privacy banner + anonymized spec grid + rich structured property form (Title, BHK, CarpetArea, Society, Location, Price, Rate, Floor, Furnishing, Availability, ExpectedSplit, Photos URLs, VideoUrl, Amenities, Notes) + success screen with Response ID
- **Client Workspace integration**: new `👥 Share with Network` button (`req-share-<reqId>`) on every requirement card footer. Opens modal with broker checkboxes (loaded from `/api/v2/broker-network?active=true`), optional message field, and Send button that (1) POSTs `network-share`, (2) builds WhatsApp deep-links per broker with pre-filled invite text + secure link, (3) auto-opens first WhatsApp link and shows per-broker send buttons for the rest.
- **Testing (iteration_4.json)**: **100% backend (15/15) + 100% frontend (BN6-BN8) + PII leak check PASSED + 4 regressions clean**. Zero critical bugs.





### 🔔 Follow-ups Widget (dashboard)
- Reused existing `v2FollowUpService` (createFollowUp / listFollowUps / completeFollowUp) — no backend changes needed
- **New widget on `/` dashboard** (`data-testid=followups-widget`): header + overdue count badge + 3 tabs (Today / Overdue / Upcoming). Default tab = Today.
- **Row rendering**: type-icon (☎️ CALL, 💬 WHATSAPP, 🏠 VISIT, etc.) + client name (joined from ALL_LEADS) + human relative time badge ("IN 1H", "1D OVERDUE") + notes.
- **Quick actions per row**: `tel:+<phone>` link for CALL type, `wa.me/<phone>` link for WHATSAPP type, always-visible green `✓ Done` button (calls POST `/api/v2/followups/:id/complete`).
- **Colour coding**: red-tinted item when overdue, amber-tinted when due today, plain white for upcoming.
- Data-testid coverage: `fu-tab-{today,overdue,upcoming}`, `fu-item-<id>`, `fu-done-<id>`, `fu-tel-<id>`, `fu-wa-<id>`, `fu-tab-overdue-btn`.

### 🗄️ MongoDB Migration — P0 blocker cleared ✅
- **New `src/data/mongoStore.js`** — snapshot-based Mongo backend. Single Mongo document `{ _id: 'singleton' }` in `signature_realty.db_snapshot` holds the entire DB payload. Async `initMongo(fallbackJson)` loads snapshot into in-memory cache before `server.listen()`; if Mongo is empty, seeds from `data/sig-realty-db.json` (one-time transparent migration). `read()` returns a deep-cloned copy of the cache; `write(db)` updates cache + enqueues an async `replaceOne` chained via `_writeQueue` so writes never race.
- **`src/data/repository.js` minimally patched** — added `const mongoStore = require('./mongoStore')`. `ensureDatabase()` skips file bootstrap when Mongo is enabled. `read()` and `write(db)` transparently delegate to `mongoStore` when enabled + initialized. Zero changes to any downstream caller — the whole codebase keeps its synchronous API.
- **Startup flow rewritten** in `server.js` — new `async startServer()` awaits `mongoStore.initMongo(fallbackJson)`, then invokes `runtime.repository.ensureStarterSeed()` to backfill seed collections, then binds the HTTP server. Fatal init errors log `[startup] fatal:` and exit 1.
- **Supervisor env** — `/etc/supervisor/conf.d/realty.conf` now exports `STORAGE_MODE=mongo`, `MONGO_URL=mongodb://localhost:27017`, `MONGO_DB=signature_realty`. Fallback to JSON mode remains fully functional (`STORAGE_MODE=json` or missing env).
- **`GET /api/v2/storage/health`** — new endpoint returns `{ enabled, initialized, cacheSize, successes, failures, lastWriteAt, lastError }` for post-deploy observability.
- **Boot verification**: first boot logged `[mongo] init: { source: 'json-migrated', size: 435295 }`; subsequent boots log `source: 'mongo'`. Post-restart data survives.

### Testing (iteration_3.json — 11/11 pass, 100% backend + 100% frontend)
- MONGO 1-3: storage/health OK · POST `/api/leads` new row `L000011 TEST_MONGO_*` persists across `sudo supervisorctl restart realty` (total leads 195 → 196) · `[mongo] init: source=json-migrated|mongo` log confirmed
- FU 1-3: today/overdue/upcoming presets return correct filtered rows · complete flow persists Status=COMPLETED
- FU 4-6: dashboard widget renders with all data-testids · tab switch works · Done button removes item + refetches
- REGRESSION: hero + stats + modules + call priority + recent activity + inventory RERA modal all still work





### RERA Import Phase 2 — Auto-scraper
- **New service `src/services/reraPortalClient.js`** — pluggable Gujarat RERA portal client with two modes: `mock` (default, returns sample projects for dev/testing) and `live` (real HTTPS + HTML parse). Toggle via env `RERA_SCRAPER_MODE=live`. Portal URL configurable via `RERA_PORTAL_URL`. Live client is a stub that reaches the portal and can be extended with a real HTML parser without touching the runner/cron.
- **New service `src/services/reraScraperService.js`** — per-area job runner: single portal fetch → client-side bucketing by target area → separate commit per area (throttled 2.5s between areas, configurable via `RERA_SCRAPER_THROTTLE_MS`). A single-area failure doesn't block others. Every commit uses `needsReview=true` so new rows land with the 🆕 Pending Review flag. Full run record stored in `_ReraScrapeRuns` (last 50).
- **API endpoints**:
  - `POST /api/v2/rera/scraper/run` `{ triggeredBy? }` — sync trigger, returns full run record with per-area breakdown
  - `GET  /api/v2/rera/scraper/runs?limit=20` — recent runs
  - `GET  /api/v2/rera/scraper/runs/:runId` — single run detail
- **System cron `/etc/cron.d/rera-refresh`** — source at `/app/scripts/rera-refresh.cron`, auto-installed on server startup (`app.listen` writes it if missing/changed). Schedule: `0 3 1 1,4,7,10 *` = quarterly at 03:00 IST on 1st of Jan/Apr/Jul/Oct.
- **Import service update**: Now auto-sets `SubCategory='Flat'` and `BHK` (derived from first Configuration, e.g. "3BHK" → "3 BHK") + `CarpetArea` (from AreaRange.min) on every RERA row. This lets SmartMatch + Reverse Match score them properly.
- **UI in `/rera-import.html`**: New **🔄 Auto Scraper** card between Upload and Preview sections. "Run Scraper Now" button (manual trigger) + Scraper Runs table showing RunID / Started / Mode (mock/live badge) / Status / Fetched / Inserted / Updated / Trigger / Per-Area chips (e.g. `Vesu 1  Adajan 1  Pal 1  Piplod 1  Athwa 0  Citylight 1`).

### Reverse Match — surface waiting clients on new RERA import
- **New service `src/services/reverseMatchService.js`** — for a list of PropertyIDs, iterate every ACTIVE requirement (skips Lost/Closed/Deal stages), run SmartMatch scoring, filter matches down to the requested properties. Returns `{ [propertyId]: [ { RequirementID, LeadID, ClientName, ClientPhone, Category, SubCategory, TransactionType, Score, MatchLevel, MatchedOn[] } ] }` sorted by score desc, capped 10 per property.
- **API endpoint** `POST /api/v2/rera/reverse-match  { propertyIds:[], minScore?=45, perPropertyLimit?=10 }`.
- **UI trigger — Option A only** (per user request): After both CSV commit and scraper run, if any rows were inserted, `showReverseMatches(insertedIds)` fires. If any property matches ≥1 client, a purple modal opens: "🎯 Waiting Clients Matched — 2 waiting clients match 2 newly-imported properties". Each match card shows: ClientName + LeadID, matched criteria (green-tick fields), Score + Level pill, **Open →** button linking to `/client-workspace?id=<LeadID>` (opens new tab). Silent (no modal) when zero matches so no interruption.
- **Verified end-to-end**: Fresh scraper run inserts 5 mock RERA projects (Ratnakar/Sunrise/Amber/Palm/Meadows), reverse-match immediately shows Hitesh Shah (L000002 · Flat/Adajan · Score 55/Possible) for Sunrise Skyline and Neha Sanghvi (L000007 · Flat/Pal · Score 45/Possible) for Green Meadows.

### WhatsApp Share (Shortlist compare view)
- **New button** on Shortlist panel in `client-workspace.html` — green `📱 WhatsApp Share` next to the teal Schedule Site Visit button.
- **Formatting** (Option B — detailed): `🏠 *Signature Property* — Shortlist for *ClientName*` header, per-property `*N. Title* / 📍 Location • Society / 💰 Price @ Rate/sqft / 🏘 BHK · CarpetArea · Furnishing / 🏗️ RERA: PR/GJ/… (only if IsReraMaster) / 📝 Notes (if any)`, followed by call-to-action + broker sign-off.
- **Deep link**: `https://wa.me/<clientPhone>?text=<encoded>` — auto-fills client phone from lead (falls back to no-recipient share picker). Opens in new tab via `window.open`.
- **Shortlist snapshot enriched**: `shortlistServiceV2._propertySnapshot()` now also includes `IsReraMaster`, `RERANumber`, `ProjectName`, `BuilderName` so the WhatsApp message can include RERA registration when applicable.





### RERA Import Module — Phase 1 (Gujarat RERA CSV/Excel → Inventory)
- **New service `src/services/reraConfig.js`** — target areas (default: Vesu, Adajan, Pal, Piplod, Athwa, Citylight) stored in `_ReraConfig` collection (runtime editable), RERA regex (`/^PR\/GJ\/SURAT\/[^/]+\/[^/]+\/[A-Z]{2,4}\d{4,7}\/\d{6}$/i`), status normalization map (hardcoded — Ongoing/New/Completed/Lapsed), area fuzzy match (`normalizeArea()` strips spaces/hyphens/underscores so "City Light"="Citylight"="city-light").
- **New service `src/services/reraImportService.js`** — CSV + XLSX parser with column alias auto-detection (RERA Number, Project Name, Promoter, Village, Taluka, Registration Date, Unit Type, No of Units, Carpet Area, Land Area, Possession Date, etc.), aggregation by RERANumber (multi-row unit types collapse into `Configurations[]` + `TotalUnits` + `AreaRange={min,max}`), 10-year rolling filter on `RERARegistrationDate` (inclusive), area filter matches Village OR Location1 only (per Q3 lock), safe-update fields on dedup (never overwrites AskingPrice / Photos / Notes / BrokerName).
- **API endpoints**:
  - `GET  /api/v2/rera/config` / `PATCH /api/v2/rera/config` — read + save areas
  - `POST /api/v2/rera/import/preview` — `{ filename, fileBase64, columnMap? }` → returns totalRows, detectedColumns, columnMap, missingRequired, summary { projects, outOfArea, tooOld, invalidRera, other }, and samples[]
  - `POST /api/v2/rera/import/commit` — `{ filename, fileBase64, columnMap?, needsReview? }` → inserts/updates Inventory rows, writes `_ReraImports` history entry with counts + insertedIDs + updatedIDs
  - `GET  /api/v2/rera/import/history?limit=20` — recent imports (capped at 100 stored)
- **Inventory row shape (Phase 1 additions)**: `IsReraMaster=true`, `NeedsReview` (opt), `RERANumber`, `RERARegistrationDate`, `ProjectName`, `BuilderName`, `ProjectStatus`, `Location1`, `Taluka`, `Village`, `Configurations[]`, `TotalUnits`, `AreaRange`, `PossessionDate`, `LandArea`, `ImportedFrom`, `ImportedAt`. `AskingPrice=null`, `Photos=[]` (broker fills later).

### Admin UI — `/rera-import.html`
- Drag-drop CSV/Excel upload (max 10 MB, base64 → JSON body — no multipart parser needed)
- Editable **Target Areas** chip list with add/remove + Save
- **Preview** button → live stats grid (Projects / Out-of-area / Too-old / Invalid RERA / Other) + full projects table (RERA#, Project, Builder, Area, Status, Config, Units, Carpet, RegDate) + collapsible error sections
- **Import Now** button (green) and **Import as "Needs Review"** button (brown/gold — flags every row with `NeedsReview=true`)
- **Recent Imports** history table (Import ID, Filename, Run At, Inserted/Updated counts, Skipped-Area, Skipped-Old, Invalid)
- Nav link "🏗️ RERA Import" added on inventory + rera-import pages

### Inventory page updates
- New filter chips: **🏗️ RERA Master** (yellow) + **🆕 Pending Review** (blue)
- Default view **hides** all `IsReraMaster=true` rows (9 of 13 shown before filter; toggle chip → 4 of 13)
- RERA cards get a distinct **🏗️ RERA badge** (top-left, yellow) + subtitle line showing `RERA: PR/GJ/SURAT/…` in monospace
- Card title auto-formats as `ProjectName — BuilderName`
- Fact pills show `Configurations · TotalUnits · AreaRange · Possession · ProjectStatus`

### End-to-end verification
- Sample CSV with 8 rows tested → 4 projects imported (Ratnakar Nine Square auto-aggregated `Configurations=[2BHK,3BHK]`, `TotalUnits=130`, `AreaRange=650-950`), 1 out-of-area (Bhatar), 1 too-old (2014), 1 invalid RERA format, 1 duplicate row correctly merged
- Re-import same CSV → Inserted:0 Updated:4 (dedup by RERANumber working, safe-update-only fields respected)
- UI screenshots confirm: preview mode shows all 4 projects + skipped buckets; inventory default view hides RERA rows; RERA chip switches to 4 RERA-only cards with correct badge/config pills





### Site Visit Booking V2 (multi-property visit slot per client)
- **New service**: `src/services/siteVisitBookingService.js` — group N shortlisted properties into a single visit slot for one client. Persists to the existing `SiteVisits` collection with a shared `VisitBookingID` linking all rows. Bypasses the strict legacy `createSiteVisit` (which requires a Match record) so it works with SmartMatch V2 + Shortlist V2.
- **API endpoints** (auth required):
  - `POST   /api/v2/site-visit-bookings` — `{ requirementId, propertyIds[], visitDate, visitTime, duration?, meetingPoint?, notes?, assignedAgentId? }` → creates N SiteVisit rows sharing `VisitBookingID`. Auto-fills `ClientName` + `ClientPhone` from lead.
  - `GET    /api/v2/site-visit-bookings?requirementId=X | ?leadId=X` — grouped booking list, sorted latest first
  - `GET    /api/v2/site-visit-bookings/:bookingId` — single booking view
  - `PATCH  /api/v2/site-visit-bookings/:bookingId` — reschedule (visitDate/visitTime/duration/meetingPoint/notes/status)
  - `POST   /api/v2/site-visit-bookings/:bookingId/cancel` — cancels all visits in the booking
  - `POST   /api/v2/site-visit-bookings/:bookingId/complete` — marks completed
- **Timeline**: each booking writes a `SITE_VISIT_SCHEDULED` timeline entry on the lead.
- **Validation**: 400 on missing requirementId / propertyIds / visitDate / visitTime; 400 with joined ID list when any property doesn't exist; 404 on unknown bookingId.

### Client Workspace UI (embedded in Shortlist panel)
- **🏠 Schedule Site Visit button** at the top-right of the Shortlist compare view. Opens a modal listing all shortlisted properties as checkboxes (pre-checked); broker de-selects any they don't want to include, picks Date (defaults to tomorrow) + Time (default 11:00) + Duration + Meeting Point + Notes and hits **Confirm Booking**.
- **Booked Site Visits section** rendered directly below the compare table:
  - Human-readable slot: "Sun, 20 Sept, 11:00 am · 📍 Ghod Dod Road · 90 mins · +91 98765 43210" with a clickable `tel:` link
  - Status pill (SCHEDULED/CONFIRMED/COMPLETED/CANCELLED) colour-coded
  - Property chips for every included property with location subtext
  - Notes shown inline in italics
  - Per-booking action buttons: ✓ Mark Complete · ✕ Cancel (hidden once status is terminal)
- **Header counter** updates: "⭐ Shortlist — 2 properties · 🏠 1 visit booked".
- **State sync**: after any booking create/cancel/complete, the shortlist cache reloads and re-renders so counters and status pills stay live.
- **Verified end-to-end** via curl (create with 2 props, list-by-req, patch reschedule, cancel, complete, invalid payloads) and Playwright screenshot on LEAD-0001 → R000199 → 2 shortlisted properties + booking for Sun 20 Sept 11:00 with 2 properties visible in compare view + Booked Site Visits panel.





### Shortlist V2 (Requirement → Properties, notes-aware)
- **New service**: `src/services/shortlistServiceV2.js` — property-level shortlist per requirement using existing `Shortlists` collection. Does NOT require a persisted Match record (Smart Match V2 scores are live); accepts `matchScore` + `matchLevel` at add-time so compare view keeps the score even if inventory changes later.
- **API endpoints (all authenticated)**:
  - `GET    /api/v2/shortlist/:reqId?status=Active` — list shortlisted properties (default Active only). Each row returns a `Property` snapshot (Title, Category, SubCategory, Location1, SocietyName, AskingPrice, RatePerSqFt, CarpetArea, BHK, Furnishing, Source, ListingFor, Status, PhotoUrl) + Notes + MatchScore/Level.
  - `POST   /api/v2/shortlist/:reqId/add`  `{ propertyId, notes?, priority?, matchScore?, matchLevel? }` — idempotent (returns `alreadyShortlisted:true` for existing Active row and merges any provided notes/priority/score).
  - `DELETE /api/v2/shortlist/:reqId/remove/:propertyId` — soft delete (status=Removed).
  - `PATCH  /api/v2/shortlist/:reqId/notes/:propertyId` `{ notes, priority? }` — update notes/priority on active entry.
- **Validation**: 404 when requirement or property doesn't exist; 400 on missing propertyId; re-adding a previously Removed combo creates a fresh Active row.

### Client Workspace UI
- **⭐ Shortlist button** added to every requirement card footer alongside 🎯 Smart Match.
- **Inline ⭐ Shortlist / Shortlisted ✓ toggle** on each Smart Match result card (data-testid `mm-shortlist-<PropertyID>`). Turns yellow when active.
- **Compare view** — dedicated Shortlist panel (yellow) directly below the Smart Match panel:
  - Property header row with photo + source badge (⭐ Own / 🏗️ Builder / 🤝 Broker) + Match Score pill + ✕ Remove
  - Side-by-side rows: Price, Rate / sqft, Carpet Area, BHK, Furnishing, Location + Society, Sub-category, Source, Status
  - Editable Notes textarea per property (saved on blur via PATCH endpoint)
  - Horizontal scroll for 3+ shortlisted properties on smaller screens
- **State sync**: Smart Match cards re-render after Add/Remove so the button always reflects live shortlist state; toggling Smart Match auto-primes the shortlist cache so the initial card render is already correct.
- **Verified end-to-end** via curl (add/list/patch/delete/re-add/invalid ids) and Playwright screenshot on LEAD-0001 → R000199: shortlisted 50/Possible office → "⭐ Shortlisted ✓" state + compare panel renders "1 property" with all attributes and Remove button.





### Smart Match V2 (Requirement → Inventory)
- **New `src/services/smartMatchService.js`** — V2-aware matching engine
  - Understands both `Fields.<key>.value` wrapping and flat requirement fields
  - Hard filters: Category, SubCategory (soft), TransactionType with alias set (Purchase ↔ Sale ↔ Rent+Sale; Rent ↔ Lease)
  - Weighted scoring (out of 100): Category 15, SubCategory 10, Location 20, Budget 25, Rate/sqft 10, Size (BHK/carpet) 10, Furnishing 5, Sub-cat specifics 5
  - Levels: 85+ Excellent / 65+ Strong / 45+ Possible / <45 Weak (hidden by default)
  - Sub-category specifics: Office matches Cabins+Workstations, Shop matches Frontage
  - Excludes Sold / Rented properties automatically
- **API**: `GET /api/v2/requirements/:id/matches?limit=10&minScore=40`
  - Returns criteria (for debug), scanned count, total matches, and top-N matches with `Score`, `MatchLevel`, and per-criterion `Breakdown` array
- **UI in Client Workspace**:
  - Every requirement card now has a **🎯 Smart Match** button (replaces old "Matching" navigate-away link)
  - Click expands an inline panel with header "🎯 Smart Matches — X of Y properties match"
  - Each match card shows: photo thumb, source badge (⭐/🏗️/🤝 color-coded), title, sub-cat + location + society + price, score with colour-coded level (green Excellent → orange Possible), and green pills for matched criteria + red pills for misses
  - Loaded lazily on click (dataset.loaded flag prevents refetch)
- **Verified end-to-end**: Sneha Trivedi's Villa/Vesu ₹2.5-4Cr requirement scored PROP-0003 Dumas Road villa 60/Possible with "Within budget ₹3.50 Cr ✓", "4 BHK ✓" green + "Location mismatch ✓" red



## What's Been Implemented — Session 6 (Sep 4, 2026 late)
- **New top-level field `InventorySource`** on every property = one of `Own` / `Builder` / `Broker`; auto-derived from OwnerType when missing (Builder → Builder, Sub-broker → Broker, everything else → Own)
- **Backend**:
  - `list()` supports `?source=Own|Builder|Broker` filter
  - `create()` + `update()` accept `InventorySource`, `BuilderName`, `ProjectName`, `BrokerName`, `BrokerMobile`, `BrokerCommissionShare` at top-level
  - New helper `_deriveInventorySource(ownerType)` for backfill on legacy records
- **Frontend / `/inventory`**:
  - **Source filter row** with 4 chips: All Sources / ⭐ My Own Inventory / 🏗️ Builder Inventory / 🤝 Broker Inventory (color-coded amber / blue / purple)
  - **Header count bar** now shows per-source breakdown: "9 of 9 · ⭐ Own 5 · 🏗️ Builder 2 · 🤝 Broker 2"
  - **Color-coded source badge** on top-right of every property card (Own = amber, Builder = blue, Broker = purple)
  - **Source-aware footer**: shows Owner name for Own listings, "Broker Name • Split X%" for Broker, "Builder • Project" for Builder
  - **Contextual form fields**: Ownership section reveals Builder Name/Project only for Builder source; Broker Name/Mobile/Commission Split only for Broker source (auto-toggle via `onSourceChange`)
  - Auto-adjusts OwnerType dropdown when source changes (Builder → Builder OwnerType, Broker → Sub-broker OwnerType)
- **Sample data reassigned**: 9 Surat properties now split 5 Own / 2 Builder / 2 Broker with realistic broker (Kunal Estate Agency Split 50%, Vinay Realtors Split 60%) and builder (Kamrej Developers → Kamrej Green Estate, Pandesara Infra → Signature Industrial Park) details
- **Legacy Bengaluru duplicates cleaned** (Azure Crest test data removed from inventory)
- **Verified end-to-end**: filter chip switches instantly, badge colors render correctly, footer copy adapts per source



## What's Been Implemented — Session 5 (Sep 4, 2026 later)
- **New service**: `src/services/inventoryService.js` — CRUD + photo upload
- **API endpoints**:
  - `GET  /api/v2/inventory` — list with filters (q, category, subCategory, transactionType, status)
  - `POST /api/v2/inventory` — create property
  - `GET  /api/v2/inventory/:id` — detail
  - `PATCH /api/v2/inventory/:id` — update
  - `DELETE /api/v2/inventory/:id` — soft delete
  - `POST /api/v2/inventory/:id/photos` — multi-photo upload (base64 data URLs)
  - `DELETE /api/v2/inventory/:id/photos/:photoId` — delete individual photo
- **Photo storage**: Base64 payload → decoded to `/app/uploads/properties/<id>/<timestamp>.<ext>` on disk → served under `/uploads/properties/<id>/…`
- **`/inventory.html` grid page**:
  - Photo-card layout with status badge, photo count badge, owner info footer
  - Filter chips per category (🏠 Res / 🏢 Comm / 🏭 Ind / 🌾 Land)
  - Live search across title/owner/society/area
  - Indian-formatted prices (₹1.25 Cr, ₹75L, ₹22,000/mo, ₹95,000/mo)
  - Rate/sqft, carpet area, BHK, furnishing, cabins, frontage, GIDC, ★ Exclusive facts pills
- **Add / Edit Property modal**:
  - Static blocks: Photos, Property Info, Ownership
  - Dynamic Pricing + Commission + Property + Legal + Project sections from V2FieldConfig
  - Multi-photo drag/click upload with base64 preview strip + individual delete
  - Full data-testid coverage
- **24 new Property-scoped V2FieldConfig fields** (EntityScope='Property'):
  - Listing: Title, ListingFor, ListingStatus, AvailableFrom, PropertyURL, ExclusiveWithMe
  - Ownership: OwnerName, OwnerMobile, OwnerType, OwnerEmail, POA
  - Pricing: AskingPrice, AskingRatePerSqFt, MinPrice, MaintenanceMonthly, DepositMonths, NegotiableMargin
  - Commission: CommissionMode (11 options incl. 1%/2% splits, Rent=1mo, Fixed), CommissionAmount
  - Project: ProjectName, BuilderName, BuilderRERA, ProjectPossession, ProjectStatus
- **8 sample Surat properties seeded** across all categories: Ratnakar Nine Square Vesu, City Light rent, Dumas Road villa, Ghod Dod office (4 cabins/20 seats), Vesu shop, GIDC Sachin textile godown, Kamrej NA plot 12 vigha, GIDC Pandesara factory
- **Nav updated**: Inventory link added to Clients + Duplicates pages
- **Verified end-to-end**: Created PROP-0009 via UI (₹75L @ ₹7,200/sqft + Exclusive), uploaded 3 photos via API, photos serve correctly via `/uploads/…`, card shows 📷 3 badge



## What's Been Implemented — Session 4 (Sep 4, 2026 later)
- **`add-need-modal` in `client-workspace.html` now fully dynamic** — uses same `/api/v2/form-config` endpoint as the clients page Add Client modal
- Removed hardcoded budget/location inputs — everything renders from V2FieldConfig (154 fields)
- **Section-grouped rendering**: Budget → Location → Property → Legal → Client → Timing → Details
- **Autocomplete datalists** for fields with Options (Surat area presets, industry types, etc.)
- **Tier indicators**: CORE fields show red `*` asterisk
- **Help text** rendered below field (e.g., "Rate range per sq ft (Surat market unit)", "Gujarat RERA registration number", "1 vigha = 17,424 sqft")
- **Full data-testid coverage**: `need-txn-type`, `need-category`, `need-subcategory`, `need-req-field-<FieldKey>` for every dynamic field
- **saveAddNeed() collects all fields dynamically** via `[data-field-key]` attribute — no hardcoded field extraction
- Removed legacy `addLocationRow()` + `location-row` — replaced by dynamic Location1/2/3 fields
- **End-to-end verified**: Created Commercial/Office requirement (R000199) with Cabins=4, Workstations=20, MeetingRooms=2, ConferenceRoom=Yes, FurnishingType=Fully Furnished, NatureOfBusiness=IT/Software, GujaratRERA — all fields persisted correctly to DB



## What's Been Implemented — Session 3 (Sep 4, 2026 later)

### Duplicate Merge UI
- **Fuzzy dup detection** in `googleSheetSyncService._syncOneRow()`:
  - After exact phone-match miss, checks Name (case-insensitive, whitespace-normalised) and Email
  - If match found, still creates lead but marks `_reviewStatus: 'PENDING_DUP_MERGE'` + `_dupCandidates: [leadIds]` + `_reviewNote`
- **APIs**:
  - `GET  /api/v2/duplicates/pending` — enriched list (source + candidate leads + reason)
  - `POST /api/v2/duplicates/keep-separate` — clear pending flag, keep as new client
  - `POST /api/v2/duplicates/merge` — merge source into target with field-level overrides (source|target per field). Transactions/Requirements/Activities/Follow-ups all reassigned; source lead deleted; `_mergedFrom` tracked on target for audit
  - `DELETE /api/v2/duplicates/:leadId` — hard delete pending-review lead (was spam)
- **UI** — `/duplicates.html`:
  - Card per pending lead, dropdown to switch between candidates
  - Side-by-side grid: label / NEW (yellow) / EXISTING (green)
  - Diff rows auto-highlighted in yellow
  - Radio button per field to pick source or target value
  - 3-action row: 🗑 Delete Incoming, Keep Separate, ✓ Merge into Target
  - Toast notifications for success/error
- **Nav integration**: clients.html topbar now has `Duplicates <badge>` with red count when items pending
- **Verified end-to-end**: seeded 2 fuzzy dupes ("kartik" & "Prashant Missel"), merged one with field override (Email + City from source), kept the other separate — all 3 API paths pass

## What's Been Implemented — Session 2 (Sep 4, 2026 mid)

### Track A: Full Category Depth (86 new fields)
- `scripts/seedFullCategoryFields.js` — comprehensive V2FieldConfig seed
- **Residential** (16 fields): PlotArea, BuiltUpArea, Garden, SwimmingPool, ServantQuarter, BoundaryWall, Balconies, Bathrooms, AgeOfProperty, OwnershipType, LoanApproved, KitchenType, PGSharingType, etc.
- **Commercial** (33 fields): FurnishingType (Bare/Semi/Fully/Plug-and-Play), FloorNumber, Lift, ParkingCarSlots, PowerLoadKVA, ACType, CeilingHeightComm; Office: Cabins, Workstations, MeetingRooms, ConferenceRoom, Reception, Pantry, ServerRoom, NatureOfBusiness; Shop: FrontageWidth, Depth, FacadeType, Mezzanine, Footfall; Warehouse: LoadingBay, TruckAccess, FloorLoadCapacity; Showroom: DisplayWindow, StorageBackroom
- **Industrial** (15 fields): GIDCApproval, IndustryZone (GIDC Sachin/Palsana/Hojiwala/Pandesara/Ichhapore), PowerLoadHP, ETP, BoilerAllowed, IndustryType, WaterConnection, CraneAvailable, LabourQuarter, ColdChambers, TempRange
- **Land** (18 fields): LandAreaUnit (with Vigha for Gujarat), RatePerVigha, RatePerSqYard, LandZoning, TPScheme, NAOrder, FSI, BuildingPermission; Agricultural: SoilType, WaterSource, ExistingCrops, IrrigationType, FarmHouse
- **Common** (4 fields): Purpose, ClientType (Individual/HUF/Pvt Ltd/NRI), GujaratRERA, Priority
- Total V2FieldConfig entries: **154** (up from 61)

### Track C: Google Sheets Real-time Sync (Live)
- **Endpoint**: `POST /api/sync/google-sheet` (X-Sync-Token auth)
- **Setup helper**: `GET /api/sync/google-sheet/setup` returns webhook URL + token
- **Service**: `src/services/googleSheetSyncService.js` — column-map based ETL
  - 40 sheet columns → V2 model mapping (Lead / Transaction / Requirement)
  - Indian budget parsing: "2Cr" → 20000000, "40000" → 40000, "1.3" → 13000000, "2L" → 200000
  - Phone normalisation for dup matching
  - Status mapping: Telecalling/Verified/Lost/Call Not Received → CRM statuses
  - Legacy sheet IDs preserved as LegacyID + used as LeadID when creating new
- **Apps Script**: `scripts/apps-script-webhook.gs` — user pastes in their sheet's Extensions → Apps Script
  - `onEdit` trigger (simple) — every cell edit syncs the row
  - `onSheetChange` installable trigger (via `installTriggers()`)  — catches inserts
  - `syncAllRows()` — one-time full backfill
- **Live import result**: **190 real leads** imported from user's actual sheet
  - Comm tab: 79 rows
  - Sale tab: 79 rows
  - Rent tab: 32 rows
- Sync token env: `SHEET_SYNC_TOKEN` (defaults to dev-mode if unset)



## What's Been Implemented — Session 1 (Sep 4, 2026 earlier)
- Created `/etc/supervisor/conf.d/realty.conf` — runs Node app under supervisor
- Added `DEMO_MODE` bypass in `authService.js` — auto-login as ADMIN without Google OAuth
- Fixed missing `CompanyID`/`BrokerageID` on seeded Users

### Surat-Specific Enhancements (Lead Management)
- Seed script `scripts/seedSuratData.js` adds:
  - 35 Surat area presets (Vesu, Adajan, Piplod, Athwa, Pal, etc.)
  - 7 new V2FieldConfig entries: `RatePerSqFtMin`, `RatePerSqFtMax`, `SocietyName`, `RERANumber`, `CarpetArea`, `SuperBuiltUpArea`, `LeadSource`
  - 8 realistic Surat sample leads with transactions + requirements
- Location fields (`Location1/2/3/AvoidLocations`) now render as **Autocomplete** with Surat area suggestions

### Fully Dynamic Requirement Form
- **`resolveFormConfig()` refactored** (`v2FormRegistryService.js`):
  - Auto-includes V2FieldConfig entries whose TransactionType/Category are null OR match context
  - Case-insensitive dedup (avoids `budgetMin` / `BudgetMin` duplicates)
  - Promotes FieldType to `Autocomplete` when meta has Options
- **`clients.html` Add Client modal fully dynamic**:
  - Hardcoded requirement fields removed
  - Every field renders from `/api/v2/form-config` response
  - Adding new field = 1 row in `V2FieldConfig`, no HTML changes

### Clients List UI Improvements
- Added columns: **Rate/Sqft**, **Source** (in addition to Budget, Location)
- New filter chips: 🔥 Hot, 💰 Investor, 👨‍👩‍👧 Family, 🔁 Repeat
- Extended `_needSummaries` API response to include Rate/Sqft/Society/Carpet
- Formatted Indian currency (₹75L, ₹1.2Cr, ₹5,500/sqft)
- Added `data-testid` on all interactive elements

### Fixes
- `_V2Counters` case mismatch (lowercase vs CamelCase) — resolved
- Duplicate LeadID L000002 issue — cleaned up
- Users seeded with tenant IDs (CompanyID: COMP-001, BrokerageID: BRK-001)

## Data State
- 10 Leads (2 legacy + 8 Surat)
- 8 Requirements (with Rate/Sqft, Location, Society for Surat entries)
- 35 Surat areas configured on 4 location fields
- 61 V2FieldConfig entries (54 original + 7 Surat-specific)

## Prioritized Backlog (Not Yet Started)
### P0
- Requirement form validation before save (Surat-specific — RERA mandatory for commercial)
- Property/Inventory master UI (photos gallery, owner/builder/project master)
- WhatsApp share button working (share property to client)

### P1
- Follow-ups + Calendar module UI (bell notifications, daily widget)
- Site Visit scheduler + feedback capture
- Shortlist compare view (side-by-side 2-3 properties)
- Broker Network UI (share requirement with sub-brokers)

### P2
- Unified UI redesign (consistent design system across all pages)
- Loan eligibility + Stamp duty calculators
- Gujarati/Hindi language toggle
- MongoDB migration (from JSON file DB)
- Emergent deployment configuration

## Files Modified
- `/app/server.js` — dual port listen
- `/app/clients.html` — Surat fields + dynamic form + testids
- `/app/src/services/v2FormRegistryService.js` — dynamic field merge
- `/app/src/services/authService.js` — DEMO_MODE bypass
- `/app/src/api/v2Router.js` — extended `_needSummaries`
- `/app/scripts/seedSuratData.js` (NEW) — Surat seed
- `/etc/supervisor/conf.d/realty.conf` (NEW) — supervisor config
- `/app/data/sig-realty-db.json` — Surat data + 7 new field configs

## Test Credentials (Demo Mode Active)
- No login required; all APIs auto-authenticate as `USR-0001` (System Admin)
- To disable demo mode: set `DEMO_MODE=false` in `/etc/supervisor/conf.d/realty.conf` and restart

## Known Issues
- `client-workspace.html` "New Requirement" modal not yet made dynamic (only `clients.html` Add Client modal is fully dynamic)
- Google OAuth flow untested (requires client ID)
- No end-to-end test suite run yet (existing Playwright tests may need port config update)
