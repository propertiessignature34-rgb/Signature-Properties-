---
name: Storage signed URL ordering
description: Raw object routes must validate expiring bearer signatures before legacy authenticated permission gates.
---

The raw object access route has two valid paths: a short-lived signed bearer URL, or an authenticated caller with the storage-read permission. The signed-token check must run before the authenticated permission gate; otherwise the legacy gate rejects anonymous-but-valid bearer requests before signature validation.

**Why:** Adding the signed path without moving the existing gate caused valid issued URLs to return `401 Unauthorized`, hiding the actual signature behavior.

**How to apply:** Keep invalid or expired signed requests fail-closed, allow authenticated permissioned callers to use the legacy path, and test both paths at the route level.