---
name: CSRF origin guard
description: State-changing API requests use same-origin and Fetch Metadata checks as cookie-session defense in depth.
---

State-changing API methods validate Origin/Referer against the forwarded application origin and reject Sec-Fetch-Site: cross-site. Requests without browser origin metadata remain compatible with non-browser clients.

**Why:** Cookie sessions can be sent automatically by browsers, so authentication alone does not prevent cross-site mutation requests.

**How to apply:** Keep public share contracts explicit, reject mismatched or malformed origin metadata with a stable security error, and test both cross-site rejection and same-origin compatibility.