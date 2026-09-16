---
name: V2Router Feature Flag Gate
description: The isV2Enabled() gate in v2Router.js must NOT block /api/v2/* canonical routes — they must always be reachable.
---

## The Rule
The feature flag `LEAD_V2_ENABLED` gates ONLY the shared adapter routes (`/api/leads*`, `/api/requirements*`). 
Canonical `/api/v2/*` routes must ALWAYS be active.

## The Fix
Change:
```js
if (!isV2Enabled()) return null;
```
To:
```js
if (!isV2Enabled() && !pathname.startsWith('/api/v2/')) return null;
```

**Why:** Adding canonical /api/v2/* routes after the flag gate makes them unreachable when the flag is off. The canonical routes return `null` (unhandled) and fall through — causing 404s or wrong handler. The single-line fix allows /api/v2/* to always fall through to the canonical routes block below.

**How to apply:** Any time you add new `/api/v2/*` routes to v2Router.js after the `isV2Enabled()` guard, verify the guard has the `!pathname.startsWith('/api/v2/')` exception. Without it, routes are only reachable when the flag is on.
