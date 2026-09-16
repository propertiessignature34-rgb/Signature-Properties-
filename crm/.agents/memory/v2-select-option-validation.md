---
name: V2 Select Option Validation
description: Option-membership checks in _validateProvidedValues apply to strings only; numbers pass through; absence never errors
---

## Rule

`_validateProvidedValues` in `v2RequirementService.js` enforces these checks:
1. Positive-number fields must be ≥ 0.
2. Cross-field ranges (budgetMin ≤ budgetMax, areaMin ≤ areaMax) are enforced only when both sides are present.
3. **Select/MultiSelect option membership is checked ONLY when `typeof rawVal === 'string'`.** Numeric values (e.g. `Parking: 2` for "2 parking spaces") are stored as-is without option checking.
4. Absence (undefined/null) of any field is **never** an error.

**Why:** Progressive capture means agents record what clients say in natural form. `Parking: 2` is a count, not a dropdown choice. Treating numbers as invalid Select values would reject legitimate agent input. The UI dropdown provides options; the server enforces correctness only for string values where membership can be checked.

**How to apply:**
- When adding new Select fields to v2Config, remember numeric agent-input is always accepted.
- When writing tests for option validation, use a string value (e.g. `'SUPER_URGENT'`) not a number.
- If a field genuinely must be one of specific numeric codes, use fieldType `'Enum'` (future) or validate explicitly in the service layer, not in `_validateProvidedValues`.
