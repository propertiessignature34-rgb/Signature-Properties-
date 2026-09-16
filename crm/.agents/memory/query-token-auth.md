---
name: Query-token authentication
description: Session credentials must not be accepted from URL query parameters.
---

Session authentication uses cookies or request headers only. URL parameters such as token and sessionToken are intentionally not authentication sources.

**Why:** Query strings can persist in browser history and appear in proxy logs, analytics, and referrer data, turning a session credential into a leakable URL value.

**How to apply:** Preserve cookie, Authorization Bearer, and x-session-token support; reject query-only credentials and keep public share tokens as explicit path-scoped contracts rather than session authentication.