---
name: V2 IdEngine Counter Overwrite Bug
description: Services that read DB at top then call idEngine will overwrite the counter unless they re-read after idEngine
---

## Rule

In any V2 service `create*` method, call `this.idEngine.next*Id()` **before** doing the final `this.repository.read()` that precedes the write. Never hold a DB snapshot from before the idEngine call and write it back afterwards.

**Why:** `idEngine.next*Id()` does its own read → increment → write cycle internally. If the service already holds a DB snapshot from a read at the top of the function, and then writes that snapshot after calling idEngine, the snapshot carries the old counter value (e.g. `{}`) and overwrites the counter increment. The next call starts the counter from 0 again, causing ID collisions.

**How to apply:**
- For validation, use the initial read (`dbCheck = this.repository.read()`).
- Call `idEngine.next*Id()` after all validations pass.
- Then do a **second** `db = this.repository.read()` for the write, so the counter is preserved.
- `v2TransactionService.createTransaction` already follows this pattern correctly (line 70 re-reads after line 50 idEngine call). `v2RequirementService.createRequirement` was fixed the same way.
- Check any future `create*` methods against this pattern.
