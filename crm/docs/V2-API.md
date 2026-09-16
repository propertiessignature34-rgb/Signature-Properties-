# Signature Realty OS — V2 Canonical API Reference

> Phase 17 | Status: **ACTIVE** | Version: 2.0 | Last updated: 2026-08-18

---

## Overview

The V2 API is the authoritative interface for all client, transaction, requirement, activity, and follow-up operations in the Signature Realty OS. It is always active (not gated by `LEAD_V2_ENABLED`).

### Base URL
```
/api/v2
```

### Response Envelope
Every endpoint returns a JSON object with:
```json
{ "ok": true,  "data": <payload> }       // success
{ "ok": false, "error": { "code": "...", "message": "..." } }  // failure
```

HTTP status codes: `200 OK`, `201 Created`, `400 Bad Request`, `404 Not Found`, `409 Conflict`, `422 Unprocessable Entity`, `500 Internal Server Error`.

---

## 1. Clients (Leads)

> **Invariant**: ONE CLIENT = ONE LEAD. Every `/api/v2/clients` write creates or modifies exactly one Lead record.

### `GET /api/v2/clients`

List all clients with optional filters.

**Query params**:
| Param | Type | Description |
|---|---|---|
| `status` | string | Filter by `ClientStatus` (Active, Inactive, …) |
| `lifecycle` | string | Filter by `Lifecycle` (Prospect, Client, …) |
| `transactionType` | string | Filter by active transaction type |
| `limit` | number | Max results (default: 100) |
| `offset` | number | Pagination offset |

**Response**:
```json
{
  "ok": true,
  "data": [ { "LeadID": "L000001", "ClientName": "…", "PrimaryMobile": "…", … } ],
  "total": 12
}
```

---

### `POST /api/v2/clients`

Create a new client. Duplicate mobile returns `409`.

**Body**:
```json
{
  "ClientName":    "Rahul Shah",          // required
  "PrimaryMobile": "9876543210",          // required
  "Email":         "rahul@example.com",   // optional
  "Lifecycle":     "Prospect"             // optional
}
```

**Response** (`201`):
```json
{ "ok": true, "data": { "LeadID": "L000003", … } }
```

**Duplicate** (`409`):
```json
{ "ok": false, "duplicateResult": "EXACT_MATCH", "error": { "code": "DUPLICATE_LEAD", "message": "A client with this mobile already exists." } }
```

---

### `GET /api/v2/clients/:id`

Get a single client by `LeadID`.

**Response** (`200`):
```json
{ "ok": true, "data": { "LeadID": "L000001", "ClientName": "…", … } }
```

**Not found** (`404`):
```json
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "Client not found" } }
```

---

### `PATCH /api/v2/clients/:id`

Update mutable fields of a client. `LeadID`, `CreatedAt`, and audit fields are immutable.

**Body**: Any subset of mutable client fields.
```json
{ "ClientStatus": "Inactive", "Email": "new@example.com" }
```

---

### `GET /api/v2/clients/:id/workspace`

Full client workspace: lead, all transactions, all requirements (with scores), recent activities, pending follow-ups.

**Response**:
```json
{
  "ok": true,
  "data": {
    "lead":         { "LeadID": "L000001", … },
    "transactions": [ { "TransactionID": "T000001", "requirements": [ … ] } ],
    "activities":   [ … ],
    "followUps":    [ … ],
    "score":        { "score": 72, "band": "HIGH", "progress": 0.72 }
  }
}
```

---

### `GET /api/v2/clients/:id/transactions`

List all transactions for a client.

---

### `POST /api/v2/clients/:id/transactions`

Create a new transaction for a client.

**Body**:
```json
{ "TransactionType": "Purchase" }   // Purchase | Rent | Sale | NRI
```

---

### `GET /api/v2/clients/:id/activities`

List all activities linked to a client.

---

### `GET /api/v2/clients/:id/followups`

List all follow-ups for a client (active by default).

---

### `GET /api/v2/clients/:id/score`

Get the current composite score across all transactions.

---

### `POST /api/v2/clients/check-duplicate`

Check whether a mobile or email would create a duplicate before committing.

**Body**:
```json
{ "PrimaryMobile": "9876543210", "Email": "opt@example.com" }
```

**Response**:
```json
{
  "ok": true,
  "result": "NO_MATCH",           // NO_MATCH | POSSIBLE_MATCH | EXACT_MATCH
  "candidates": [],
  "possibleCandidates": []
}
```

---

### `GET /api/v2/clients/query` · `POST /api/v2/clients/query`

Need-based query: find clients by their active requirement parameters.

**Query / Body params**:
| Param | Description |
|---|---|
| `transactionType` | Purchase \| Rent \| Sale |
| `budgetMin` / `budgetMax` | Numeric budget range |
| `location` | Location string (partial match) |
| `category` | Residential \| Commercial |
| `hasActiveNeed` | `true` to only return clients with open requirements |
| `followUpDue` | `today` \| `overdue` \| `upcoming` |

---

## 2. Transactions

### `GET /api/v2/transactions/:id`

Get a single transaction.

**Response** (`200`):
```json
{ "ok": true, "data": { "TransactionID": "T000001", "LeadID": "L000001", … } }
```

---

### `PATCH /api/v2/transactions/:id`

Update mutable fields. `TransactionID` and `LeadID` are immutable.

---

### `GET /api/v2/transactions/:id/requirements`

List all requirements for a transaction.

---

### `POST /api/v2/transactions/:id/requirements`

Create a requirement under a transaction.

**Body**:
```json
{
  "LeadID":   "L000001",        // required — must match transaction's LeadID
  "Category": "Residential",    // required
  "Fields":   {}                // optional initial field values
}
```

---

## 3. Requirements

### `GET /api/v2/requirements/:id`

Get a single requirement.

---

### `PATCH /api/v2/requirements/:id`

Progressively update requirement fields.

**Body**: Flat field map (classic keys):
```json
{ "BudgetMax": 12000000, "BHKMin": 2, "Location1": "Vesu" }
```

Or structured:
```json
{ "Fields": { "BudgetMax": { "state": "KNOWN", "value": 12000000 } } }
```

**Response**:
```json
{
  "ok": true,
  "data": { "requirement": { … } },
  "changedFields": [ "BudgetMax" ],
  "history": { … }
}
```

> **Invariants**: `RequirementID`, `LeadID`, `TransactionID`, and `FormVersion` are immutable once set. `UNKNOWN` fields remain `UNKNOWN` unless explicitly set to `KNOWN` or `NO`.

---

### `GET /api/v2/requirements/:id/score`

Get the current completeness score.

**Response**:
```json
{
  "ok":           true,
  "score":        72,
  "band":         "HIGH",
  "progress":     0.72,
  "breakdown":    { "CORE": { "answered": 4, "total": 5 }, "IMPORTANT": { … }, "OPTIONAL": { … } }
}
```

---

### `GET /api/v2/requirements/:id/next-questions`

Get the next unanswered questions (intelligent, dependency-aware).

**Query params**:
| Param | Default | Description |
|---|---|---|
| `limit` | 5 | Max questions to return |

**Response**:
```json
{
  "ok": true,
  "questions": [
    {
      "fieldKey":     "BHKMin",
      "label":        "BHK (minimum)",
      "rank":         "CORE",
      "displayOrder": 3,
      "inputType":    "number",
      "hint":         "E.g. 2 for 2 BHK"
    }
  ]
}
```

---

### `GET /api/v2/requirements/:id/activities`

List all activities linked to a requirement.

---

## 4. Activities

### `POST /api/v2/activities`

Create an activity linked to a lead (and optionally a transaction or requirement).

**Body**:
```json
{
  "LeadID":        "L000001",    // required
  "ActivityType":  "CALL",       // CALL | SITE_VISIT | EMAIL | MEETING | NOTE | WHATSAPP
  "Summary":       "…",
  "TransactionID": "T000001",    // optional
  "RequirementID": "R000001",    // optional — must belong to same client
  "FieldUpdates":  {}            // optional — updates Requirement fields
}
```

**Response** (`201`):
```json
{ "ok": true, "data": { "ActivityID": "A000001", … } }
```

> **Security**: If `RequirementID` is supplied, it must belong to the same `LeadID`. Cross-client activity is rejected with `403`.

---

### `GET /api/v2/activities/:id`

Get a single activity.

---

## 5. Follow-ups

### `POST /api/v2/followups`

Create a follow-up.

**Body**:
```json
{
  "LeadID":        "L000001",    // required
  "DueAt":         "2026-08-20T10:00:00.000Z",  // required ISO8601
  "Type":          "CALL",       // CALL | VISIT | EMAIL | TASK
  "Title":         "…",
  "TransactionID": "T000001"     // optional
}
```

---

### `GET /api/v2/followups`

List follow-ups with preset filters.

**Query params**:
| Param | Description |
|---|---|
| `preset` | `today` \| `overdue` \| `upcoming` \| `completed` |
| `leadId` | Filter by client |

---

### `GET /api/v2/followups/:id`

Get a single follow-up.

---

### `PATCH /api/v2/followups/:id`

Update a follow-up (rescheduling, note update, etc.).

---

### `POST /api/v2/followups/:id/complete`

Mark a follow-up as completed.

**Body**:
```json
{ "CompletionNote": "Client confirmed budget." }
```

---

### `POST /api/v2/followups/:id/cancel`

Cancel a follow-up.

**Body**:
```json
{ "CancellationReason": "Client no longer interested." }
```

---

## 6. Legacy Adapter (`LEAD_V2_ENABLED=true`)

When the feature flag `LEAD_V2_ENABLED=true` is set, the following legacy paths are handled by the V2 router as adapters:

| Legacy Path | V2 Handler |
|---|---|
| `GET /api/leads` | `GET /api/v2/clients` |
| `POST /api/leads` | `POST /api/v2/clients` |
| `GET /api/leads/:id` | `GET /api/v2/clients/:id` |
| `PATCH /api/leads/:id` | `PATCH /api/v2/clients/:id` |
| `GET /api/requirements` | `GET /api/v2/requirements` (all) |
| `PATCH /api/requirements/:id` | `PATCH /api/v2/requirements/:id` |
| `GET /api/clients/:id/workspace` | `GET /api/v2/clients/:id/workspace` |

These adapters are transparent to existing consumers: request/response shapes are identical.

---

## 7. Feature Flag Behaviour

| Path prefix | `LEAD_V2_ENABLED=false` | `LEAD_V2_ENABLED=true` |
|---|---|---|
| `/api/v2/*` | ✅ Always active | ✅ Active |
| `/api/leads*` | ⬛ Returns null (legacy handles) | ✅ V2 router handles |
| `/api/requirements*` | ⬛ Returns null (legacy handles) | ✅ V2 router handles |

---

## 8. Error Codes

| Code | HTTP | Description |
|---|---|---|
| `NOT_FOUND` | 404 | Entity does not exist |
| `DUPLICATE_LEAD` | 409 | Mobile or email matches an existing client |
| `VALIDATION_ERROR` | 422 | Missing required field or invalid value |
| `CROSS_CLIENT_ERROR` | 403 | Requirement/Transaction belongs to a different client |
| `IMMUTABLE_FIELD` | 422 | Attempt to change a write-once field |
| `INVALID_STATE` | 422 | State machine transition not allowed |

All errors follow the envelope:
```json
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "Human-readable message" } }
```

No stack traces are ever included in error responses.
