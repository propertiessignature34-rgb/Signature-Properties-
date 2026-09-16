---
name: V2 Body Caching Pattern
description: server.js reads request body once and caches it; V2Router and legacy handlers share the cache
---

## Rule

`readJson(req)` caches parsed body in `req._parsedBody`. V2Router pre-reads the body for all POST/PATCH requests and stores it there. Legacy handlers calling `readJson(req)` will return the cached value without re-reading the consumed stream.

**Why:** V2Router dispatch runs before all existing route handlers. Without caching, the stream is already consumed by the time legacy handlers call `readJson()`, producing empty bodies.

**How to apply:** Any new middleware or handler that reads the request body must check `req._parsedBody` first. Never call raw stream listeners after `readJson` may have run.
