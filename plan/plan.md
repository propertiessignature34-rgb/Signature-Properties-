# Signature Realty CRM — Import & Go Live

## What this project actually is

The GitHub repo is **not** a typical web app built on this platform's usual stack. It is an
existing, substantially-built **real-estate brokerage CRM** ("Signature Realty") made of:

- A **Node.js server** that serves plain HTML/JavaScript pages (dashboard, clients, leads,
  inventory, builder projects, broker network, calculators, digital card, login, etc.).
- **File-based storage** (JSON files) today, with an optional database mode already coded in.
- **Google Sign-In** with `propertiessignature34@gmail.com` set up as the admin.
- A separate experimental "gethub" file-browser page (demo only, not real).
- Deployment config for an external host (Render).

The CRM already covers a broad brokerage workflow: client intake → leads → requirements →
property matching → shortlist → site visits → negotiation → token → deal → closing →
commission, plus broker collaboration, media/documents, and admin/reporting screens. The
repo's own notes say the core flows work but the app is "not yet production-certified."

## The goal (from you)

1. Bring this repo into the workspace and keep building/fixing it.
2. Focus on the real-estate CRM.
3. Use platform-managed Google login (no Google Cloud setup needed from you).
4. Get it live.

## Proposed approach

**Keep the existing CRM as-is (do not rebuild it).** Import the current Node/HTML CRM into the
workspace and get it running here, rather than rewriting it as a new app. This is the fastest,
lowest-risk path to "live" and preserves all the work already done.

Concretely, this pass will:

1. **Import & run** the existing CRM in the workspace so the preview URL opens the real app
   (login screen → dashboard → the CRM modules).
2. **Switch login to platform-managed Google sign-in.** You will not need to create or paste any
   Google credentials. `propertiessignature34@gmail.com` stays the admin; other users get a
   normal (non-admin) role. Confirm if you want a different admin email or additional allowed
   users.
3. **Move storage to a real database** (MongoDB) instead of loose JSON files, so data survives
   restarts and the app is safe to host. Any demo/sample data currently in the repo's JSON files
   will not automatically carry over unless you want it migrated (see decisions below).
4. **Verify the core CRM works end-to-end**: sign in with Google, land on the dashboard, and use
   the primary modules (clients/leads, requirements, properties/inventory, site visits, deals).
   Bugs found here get fixed as part of this pass.
5. **Prepare it to go live** and hand you the one manual step: approving the publish and completing
   the Google sign-in consent once (that consent is a human step that cannot be automated).

## Scope for this pass

**In scope**
- Getting the real CRM running in the workspace on the preview URL.
- Platform-managed Google login with admin mapping.
- Database-backed storage.
- Making the core brokerage flow usable and fixing what's broken in it.
- Getting the app to a live-ready state.

**Deferred (not this pass, can be picked up next)**
- The "gethub" file-browser page (demo-only; left as-is).
- Deep hardening of every secondary module (full audit, advanced reporting, notifications,
  calendar, follow-up automation) beyond making them load and function at a basic level.
- Bulk data imports (e.g., the large "Karma projects" import referenced in the repo).
- External-host (Render) deployment — going live will use this platform's publish flow instead.

## Decisions I need from you

1. **Admin & access** — Keep `propertiessignature34@gmail.com` as the sole admin, or add more
   admins / an allowed-user list? (Default: that email is admin, anyone else who signs in gets a
   standard role.)
2. **Existing sample data** — The repo ships with JSON data (sample clients/properties). Do you
   want that migrated into the database, or start clean? (Default: **start clean**; the app comes
   up empty and you add real records.)
3. **"Live" means the platform preview/publish URL** — going live here uses this platform's
   publish, not the external Render setup in the repo. Confirm that's fine. (Default: yes.)

## Assumptions

- Keep the current plain-HTML/JS CRM; no rewrite into a different framework.
- Focus effort on the core brokerage lifecycle; secondary/demo features are left running but not
  deep-polished this pass.
- Only you can complete the actual Google account consent screen once during testing/launch.

## What "done" looks like for this pass

- Opening the app shows the Signature Realty login, Google sign-in works via the platform flow,
  and the admin lands on a working dashboard.
- Core CRM modules load and their main create/read/update actions work against the database.
- The app is ready for you to publish live, with the remaining manual consent/publish step clearly
  called out.
