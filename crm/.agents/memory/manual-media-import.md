---
name: Manual media import policy
description: Safety and product boundary for Builder Project brochure and image imports
---

Builder Project brochure/image ingestion is manual-only. The caller must provide the explicit legitimate HTTP(S) URL; the server must not discover URLs from existing records, scrape listing/detail pages, retry access denials, or use proxy, anti-bot, or CAPTCHA bypasses. HTTP 403 is a terminal import failure.

**Why:** The product requirement is to preserve existing Builder Projects and avoid turning blocked third-party content into an automated scraping workflow.

**How to apply:** Keep import bounded by SSRF, redirect, size, timeout, and file-signature checks; store verified bytes in the GridFS object bucket; read back and verify before writing only the selected project’s media metadata; expose the internal media URL rather than the remote URL for app usage.