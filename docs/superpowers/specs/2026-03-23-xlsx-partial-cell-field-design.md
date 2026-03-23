# XLSX Partial-Cell Field Definition — Design Spec

**Date:** 2026-03-23
**Status:** Approved

---

## Overview

When an XLSX cell contains both a static label and a dynamic value (e.g. `"Name: Bao Huynh"`), the user needs to define a template field that replaces only the value portion while preserving the label. The current approach of doing partial-text detection via raw XML surgery is unreliable (fails for rich-text shared strings). This design replaces that approach with a Gemini-driven label/value split where the AI explicitly identifies the boundary and the user confirms it before any binary change is made.

---

## Scope

- **XLSX only.** DOCX partial-text replacement (`insertInParagraph`) works correctly and is untouched.
- Affects: `gemini.js`, `Review.jsx`, `fieldEditor.js`. No changes to `templateEngine.js`.

---

## Architecture

| File | Change |
|---|---|
| `gemini.js` | Add `suggestFieldPattern()` — returns `{ label, value, fieldName }` |
| `Review.jsx` | XLSX popover replaced with two-input split editor; DOCX popover unchanged |
| `fieldEditor.js` | `insertXlsx` simplified — always writes the full confirmed pattern string; partial-detection logic removed |
| `templateEngine.js` | No changes — cells stored as `"Name: {{name}}"` (single `<t>`) already work with existing token regex |

**Key principle:** Gemini determines the label/value split and returns the complete pattern (e.g. `"Name: {{name}}"`). `insertXlsx` becomes a full-cell write every time, eliminating the partial-detection XML surgery entirely.

---

## Data Flow

```
User clicks cell or selects text within cell
        ↓
handleMouseUp / handleClick collects:
  { cellAddress, fullCellText, selectedText (if any) }
        ↓
suggestFieldPattern(apiKey, fullCellText, selectedText, existingFields)
  → Returns: { label: "Name: ", value: "Bao Huynh", fieldName: "name" }
        ↓
Popover opens (XLSX):
  [Label (preserved)]  "Name: "     ← editable
  [Field name]         "name"       ← editable
  Preview:             Name: {{name}}  ← updates live
        ↓
User confirms (or edits either field)
        ↓
pattern = label + "{{" + fieldName + "}}"
insertXlsx(binary, cellAddress, fieldName, pattern)
  → full cell replaced with "Name: {{name}}"
        ↓
Re-render HTML from new binary
applyChipOverlay highlights {{name}} as colored chip
```

If `selectedText` is empty (cell click, no selection), Gemini uses `fullCellText` alone. If the cell has no label (e.g. just `"Bao Huynh"`), Gemini returns `label: ""` and the preview shows just `{{name}}`.

---

## Gemini — `suggestFieldPattern`

### Prompt

```
You are analyzing a spreadsheet cell for document templating.

Cell content: "{fullCellText}"
User selected: "{selectedText}"    ← omitted if empty
Existing field names: [name, date, ...]    ← to avoid duplicates

Identify:
- label: the static prefix to preserve (empty string if none)
- value: the dynamic portion to replace with a template field
- fieldName: a short camelCase name for the field (must not match existing names)

Respond with JSON only:
{"label": "...", "value": "...", "fieldName": "..."}

Rules:
- label + value must equal the full cell content exactly
- fieldName must match ^[a-zA-Z][a-zA-Z0-9_]*$
- If no label exists, return label as ""
```

### Response Validation

1. Parse JSON — check `label`, `value`, `fieldName` all present
2. Verify `label + value === fullCellText` — if not, fall back to `{ label: "", value: fullCellText, fieldName }` using existing `suggestFieldName` logic for the name
3. Verify `fieldName` matches `^[a-zA-Z][a-zA-Z0-9_]*$` — if not, sanitize or fall back to a generic name

### Error Fallback

If the Gemini call fails entirely, the popover opens with `label: ""` and an empty `fieldName`, and the user fills both manually. No silent errors.

---

## Popover UI (XLSX — `Review.jsx`)

The DOCX popover (single field name input) is untouched.

```
┌─────────────────────────────┐
│  Label (preserved)          │
│  ┌─────────────────────┐    │
│  │ Name:               │    │
│  └─────────────────────┘    │
│                             │
│  Field name                 │
│  ┌─────────────────────┐    │
│  │ name                │    │
│  └─────────────────────┘    │
│                             │
│  Preview                    │
│  Name: {{name}}             │
│                             │
│  [  Accept  ]  Dismiss      │
└─────────────────────────────┘
```

**Behaviour:**
- Both inputs editable; preview updates live
- `fieldName` validated on Accept (regex + duplicate check — same rules as today)
- `label` has no validation; empty string is valid
- `pendingRef` shape for XLSX: `{ cellAddress }` only — `selectedText` no longer needed

**Popover state (XLSX ready):**
```js
{ state: 'ready', label: 'Name: ', fieldName: 'name', errorMsg: '', position }
```

---

## `insertXlsx` Simplification (`fieldEditor.js`)

### Signature change

```js
// Before
insertXlsx(binary, cellAddress, fieldName, selectedText)

// After
insertXlsx(binary, cellAddress, fieldName, pattern)
// pattern = full new cell content, e.g. "Name: {{name}}"
```

### What is removed

All partial-detection logic: shared string index lookup to read the current value, `Array.from(tEls).map(...).join('')`, `includes()` / `!==` checks. Every call is now a full-cell write.

### What remains

```
1. Open zip with PizZip
2. Locate sheet XML via workbook.xml.rels
3. Find target cell by cellRef
4. Append new shared string: <si><t xml:space="preserve">{pattern}</t></si>
5. Point cell to new shared string index (t="s")
6. Return new ArrayBuffer
```

The `else` branch (no shared strings file → inline string) also simplified to write `pattern` directly.

### Call site in `handleAccept`

```js
const { cellAddress } = pendingRef.current
const pattern = (popover.label ?? '') + `{{${fieldName}}}`
result = insertXlsx(binary, cellAddress, fieldName, pattern)
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Gemini call fails | Popover opens with empty label + empty fieldName; user fills manually |
| `label + value ≠ fullCellText` | Fall back to `label: ""`, `value: fullCellText`; no crash |
| `fieldName` invalid regex | Sanitize or fall back; error shown in popover |
| `fieldName` duplicate | Existing duplicate check in `handleAccept` catches it |
| Cell not found in XML | `insertXlsx` returns `{ error: 'cell_not_found' }` — popover shows existing error message |

---

## Testing

- **Unit — `suggestFieldPattern`:** mock Gemini responses; assert correct `{ label, value, fieldName }` parsing; assert fallback on malformed JSON and on `label + value ≠ fullCellText`
- **Unit — `insertXlsx`:** given a binary + cellAddress + pattern, assert the cell in the output binary contains the pattern string verbatim
- **Integration — Review flow:** cell click → Gemini mock → popover prefill → accept → re-rendered HTML shows chip within label context
