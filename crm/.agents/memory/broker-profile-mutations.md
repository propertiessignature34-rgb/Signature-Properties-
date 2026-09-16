---
name: Broker profile mutation authorization
description: Public digital-card reads are separate from protected profile mutations.
---

The digital business card may expose profile data and the stored photo for sharing, but profile edits and photo uploads are administrative mutations protected by ADMIN_UPDATE.

**Why:** The read surface is intentionally shareable, while unauthenticated writes could alter the public identity card and replace stored media.

**How to apply:** Preserve public GET behavior unless the product changes, gate PATCH and photo POST before service calls, and keep mutation authorization covered separately from media streaming tests.