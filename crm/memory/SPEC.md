# Gethub / Seen My File

## What it does

Adds a standalone `/gethub` repository-style file browser to the existing Signature Properties application. It is a self-contained demo: repository data is embedded in the browser, while uploaded files stay local to the current browser session.

The existing Builder Projects module also supports an authenticated Karma Group scrape. It requests all eight current category filters from `https://karmagroup.co.in/Projects/ProjectList` (758 unique projects as of the live verification), deduplicates and identifies records by the source project ID, parses each project detail page, and creates or non-destructively updates Builder Project records. Only Gujarat RERA values beginning with `PR/GJ/` participate in RERA identity matching; source-site status tokens such as `BUC` are ignored.

## Key flows

- Browse the file tree and expand/collapse folders
- Select a file to view syntax-highlighted content and metadata
- Open multiple file tabs and close tabs
- Search with the sidebar filter or `Cmd/Ctrl + K`
- Review recent files, copy a path, download a preview, and switch demo branches
- Add local files through the button or drag-and-drop area
- Start a Karma Group scrape from Builder Projects and watch live progress/result counts

## Data and integrations

- No new backend data model or API endpoint
- No third-party integration; all repository data is demo/local state
- Existing CRM routes and authentication flows remain unchanged
- Karma scrape API: `POST /api/v2/builder-projects/scrape/karma-group`; status: `GET /api/v2/builder-projects/scrape/status`
- Scraping requires Builder Projects permissions and does not bypass the source website; brochure binary ingestion remains opt-in through `KARMA_SCRAPE_INGEST_BROCHURES=true`
- With `KARMA_SCRAPE_INGEST_MEDIA=true`, all discoverable project photos, floor plans and brochures are downloaded, signature-validated, persisted in Mongo GridFS, and referenced only through internal `/api` media URLs; no external media URL is used by the UI
- Preview ingress uses `/app/backend/server.py` as a thin same-origin `/api` proxy from port 8001 to the existing Node app; business logic and persistence remain in the Node service

## Access

`/gethub` is intentionally public so the demo can be previewed without CRM authentication.

The preview process is persistently managed by the standard supervisor `frontend` program through `/app/frontend/package.json`, which starts the Node CRM on port 3000. Google OAuth redirect URIs are derived from the current request/browser origin and are never hardcoded to a preview or production host.

The CRM is an installable mobile web app (PWA): the shared link opens in the mobile browser, registers a root-scoped service worker, and can be added to the Android/iOS home screen without Play Store publication. API and authenticated CRM data are never cached by the service worker.

Emergent provider sign-in URLs always include a current-origin `/login.html` callback in the required `redirect` query parameter, with the signed auth state embedded in that callback. A bare provider URL is never emitted.

The preview API proxy accepts same-origin authenticated callback mutations only when the trusted Emergent public `Origin` and `Referer` agree. This allows the post-Google `/api/auth/session-exchange` request through while still rejecting unrelated cross-origin requests.

`SIG_REALTY_PUBLIC_ORIGIN` pins the current public preview origin for Node-side CSRF comparison, preventing internal ingress hostnames from rejecting the legitimate post-approval session exchange.