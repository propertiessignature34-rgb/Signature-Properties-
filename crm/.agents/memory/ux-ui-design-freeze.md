---
name: UX/UI Design Freeze
description: Brown/gold premium theme + agent-facing business model corrections applied across all pages
---

## Rules (enforced by instruction file)

**Why:** Per uploaded design spec (868 lines), UI must reflect the agent's actual workflow: Client → Requirement. No Transaction layer visible to agents. Backend V2 services unchanged.

### Brand
- Product name: **Signature Property** (singular, no "Properties")
- Nav icon: **SP**

### Theme
- Nav/header: `#2c1405` (very dark brown)
- Primary brand color: `#5c3317` (deep brown)
- Accent / primary buttons: `#b8860b` (dark gold)
- Gold highlights: `#d4a017`
- Background: `#faf7f2` (warm cream)
- Border: `#e8ddd0` (warm brown border)

### Business model — agent UI
- Agent sees: CLIENT → REQUIREMENT (no transaction group wrappers)
- Transaction type shown inline on requirement card title only
- Same need = UPDATE same RequirementID; different need = NEW RequirementID
- Clients remain active after marking requirements Lost

### Pages changed
- **clients.html** — full rewrite; columns: Client, Mobile, Status, Active Requirements, Budget, Location, Last Activity, Agent (removed Lifecycle/Tags/Score)
- **requirements-view.html** — full rewrite; client link uses `/client-workspace?id=` (no .html)
- **app.js** — nav shows only: Clients, Dashboard, Inventory, Matching, Site Visits, Deals, Commission, Follow-ups, Calendar, Reports, Settings; uses `data-key` attribute on nav-module-link elements for active state
- **index.html** — brand "Signature Property" / icon "SP"
- **client-workspace.html** — brown/gold theme; "REQUIREMENTS" section (was "Active Needs"); "+ New Requirement"; "Update Requirement" + "Ask" + "Mark Lost" footer buttons; Mark Lost modal with reason dropdown + notes textarea; lost reqs collapsed under "Past / Lost" details element

### Mark Lost modal
- Reason select: Bought Elsewhere, Budget Mismatch, Location Mismatch, Requirement Cancelled, Not Responding, Other
- PATCHes requirement with `{ RequirementStatus: 'Lost', LostReason, LostNotes }`
- Client status unchanged

**How to apply:** Any future page or component must use the :root CSS variables already defined. Never add Leads/Shortlist/Negotiation/Broker/Documents/Users/Admin to agent nav.
