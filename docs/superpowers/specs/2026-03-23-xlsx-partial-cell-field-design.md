# XLSX Partial-Cell Field Definition — Design Spec

**Date:** 2026-03-23
**Status:** Approved

---

## Overview

When an XLSX cell contains both a static label and a dynamic value (e.g. `"Name: Bao Huynh"`), the user needs to define a template field that replaces only the value portion while preserving the label. The current approach of doing partial-text detection via raw XML surgery is unreliable (fails for rich-text shared strings). This design replaces that approach with a Gemini-driven label/value split where the AI explicitly identifies the boundary and the user confirms it before any binary change is made.

---

## Scope

- **XLSX only.** DOCX partial-text replacement (`insertInParagraph`) works correctly and is untouched. All DOCX code paths (event handlers, popover, `insertDocx`) are unchanged.
- Affects: `gemini.js`, `Review.jsx`, `fieldEditor.js`. No changes to `templateEngine.js`.
- **Out of scope:** suffix/infix labels (e.g. `"Bao Huynh (Manager)"`), cells containing multiple label-value pairs (e.g. `"Name: Bao, Date: 2026-01-01"`). These are edge cases not present in typical template documents. If Gemini detects no prefix label, it returns `label: ""` and the full cell becomes the value.

---

## Architecture

| File | Change |
|---|---|
| `gemini.js` | Add `suggestFieldPattern()` — returns `{ label, value, fieldName }` |
| `Review.jsx` | XLSX event handlers and popover updated; DOCX paths unchanged |
| `fieldEditor.js` | `insertXlsx` simplified — always writes the full confirmed pattern string; partial-detection logic removed |
| `templateEngine.js` | No changes — cells stored as `"Name: {{name}}"` (single `<t>`) already work with existing token regex |

**Key principle:** Gemini determines the label/value split and returns the complete pattern (e.g. `"Name: {{name}}"`). `insertXlsx` becomes a full-cell write every time, eliminating the partial-detection XML surgery entirely.

---

## Data Flow

```
User clicks cell or selects text within cell
        ↓
handleMouseUp (XLSX branch) / handleClick:
  collects { cellAddress, fullCellText: td.textContent.trim(), selectedText (if any) }
  writes pendingRef.current = { cellAddress }   ← selectedText dropped for XLSX
        ↓
openSuggestion branches on format:
  DOCX → suggestFieldName(apiKey, selectedText, surroundingContext, existingFields) [unchanged]
  XLSX → suggestFieldPattern(apiKey, fullCellText, selectedText, existingFields)
        ↓
suggestFieldPattern returns:
  { label: "Name: ", value: "Bao Huynh", fieldName: "name" }
        ↓
Popover state set (XLSX):
  { state: 'ready', label: 'Name: ', fieldName: 'name', errorMsg: '', position }
        ↓
Popover opens:
  [Label (preserved)]  "Name: "     ← editable
  [Field name]         "name"       ← editable
  Preview:             Name: {{name}}  ← updates live
        ↓
User confirms (or edits either field)
        ↓
handleAccept (XLSX branch):
  pattern = (popover.label ?? '') + `{{${fieldName}}}`
  insertXlsx(binary, cellAddress, fieldName, pattern)
  → full cell replaced with "Name: {{name}}"
        ↓
Re-render HTML from new binary
applyChipOverlay highlights {{name}} as colored chip
```

If `selectedText` is empty (cell click, no selection), Gemini uses `fullCellText` alone. If the cell has no label (e.g. just `"Bao Huynh"`), Gemini returns `label: ""` and the preview shows just `{{name}}`.

---

## Gemini — `suggestFieldPattern`

### Signature

```js
suggestFieldPattern(apiKey, fullCellText, selectedText, existingFields)
// → Promise<{ label: string, value: string, fieldName: string }>
```

Wraps the Gemini call in a `Promise.race` with a **10-second timeout** (matching the existing `suggestFieldName` timeout). On timeout, throws so the caller falls back to the empty-state popover.

### Prompt

```
You are analyzing a spreadsheet cell for document templating.

Cell content: "{fullCellText}"
User selected: "{selectedText}"    ← line omitted if selectedText is empty
Existing field names: [name, date, ...]    ← to avoid duplicates

Identify:
- label: the static prefix to preserve (empty string if none exists)
- value: the dynamic portion to replace with a template field
- fieldName: a short camelCase name for the field (must not match existing names)

Respond with JSON only:
{"label": "...", "value": "...", "fieldName": "..."}

Rules:
- label + value must equal the full cell content exactly
- fieldName must match ^[a-zA-Z][a-zA-Z0-9_]*$
- If no label prefix exists, return label as ""
```

### Response Validation

> **Note:** The prompt rule `label + value === fullCellText` is advisory — it guides Gemini but cannot be enforced by the caller. The validation fallback below is the authoritative safeguard and is always executed regardless of whether the rule appears satisfied.

1. Parse JSON — check `label`, `value`, `fieldName` all present
2. Verify `label + value === fullCellText` — if not, fall back to `{ label: "", value: fullCellText, fieldName }` using the `fieldName` value already returned in the Gemini response (then apply the regex sanitization in step 3 — no second network call)
3. Verify `fieldName` matches `^[a-zA-Z][a-zA-Z0-9_]*$` — if not, strip non-matching characters and prepend `field` if result starts with a digit; if result is empty, fall back to `"field"`

### Error Fallback

If the Gemini call fails (timeout, network error, HTTP error), the function throws. `openSuggestion` catches and opens the popover in ready state with `label: ""` and `fieldName: ""`. The user fills both manually. No silent errors.

---

## `Review.jsx` — Handler Changes

### `openSuggestion`

Branches on `format`. DOCX path is unchanged:

```js
const openSuggestion = useCallback(async (selectedText, surroundingContext, pendingData, position) => {
  pendingRef.current = pendingData
  setPopover({ state: 'loading', label: '', fieldName: '', errorMsg: '', position })
  try {
    if (format === 'xlsx') {
      const { fullCellText } = pendingData
      const result = await suggestFieldPattern(apiKey, fullCellText, selectedText, fields)
      setPopover(prev => prev ? { ...prev, state: 'ready', label: result.label, fieldName: result.fieldName } : null)
    } else {
      // DOCX — unchanged behaviour
      const suggested = await suggestFieldName(apiKey, selectedText, surroundingContext, fields)
      setPopover(prev => prev ? { ...prev, state: 'ready', fieldName: suggested ?? '' } : null)
    }
  } catch {
    const errorMsg = 'AI suggestion failed — enter values manually'
    setPopover(prev => prev ? { ...prev, state: 'ready', label: '', fieldName: '', errorMsg } : null)
  }
}, [apiKey, fields, format])
```

### `handleMouseUp` — XLSX branch

`pendingRef` shape changes from `{ cellAddress, selectedText }` to `{ cellAddress, fullCellText }`. `selectedText` is still passed to `openSuggestion` as a call argument (hint for Gemini) but is not stored in `pendingRef`:

```js
// XLSX branch in handleMouseUp
const cellAddress = anchorCell.dataset.cellAddress
const fullCellText = anchorCell.textContent.trim()
const surroundingContext = getXlsxContext(anchorCell)
const rect = sel.getRangeAt(0).getBoundingClientRect()
await openSuggestion(selectedText, surroundingContext, { cellAddress, fullCellText }, { top: rect.bottom + 8, left: rect.left })
```

### `handleClick` — XLSX branch

Same shape — `{ cellAddress, fullCellText }`. No text is selected on a plain click, so `selectedText` is passed as `""` (empty string) so `suggestFieldPattern` omits the "User selected" hint line from the prompt. The existing already-a-field guard is retained:

```js
const cellAddress = td.dataset.cellAddress
const fullCellText = td.textContent.trim()

// retain existing guard
if (/^\{\{.+\}\}$/.test(fullCellText)) {
  setPopover({ state: 'ready', label: '', fieldName: '', errorMsg: 'This cell is already a field', position: { top: 80, left: 50 } })
  return
}

const surroundingContext = getXlsxContext(td)
const rect = td.getBoundingClientRect()
await openSuggestion('', surroundingContext, { cellAddress, fullCellText }, { top: rect.bottom + 8, left: rect.left })
```

### `handleAccept` — branched body

```js
const handleAccept = async () => {
  const fieldName = popover.fieldName.trim()
  // shared validation (regex, duplicate check) — unchanged

  setProcessing(true)
  try {
    let result
    if (format === 'docx') {
      // DOCX — unchanged
      const { selectedText, paragraphIndex } = pendingRef.current
      result = insertDocx(binary, selectedText, paragraphIndex, fieldName)
    } else {
      // XLSX — new path
      const { cellAddress } = pendingRef.current
      const pattern = (popover.label ?? '') + `{{${fieldName}}}`
      result = insertXlsx(binary, cellAddress, fieldName, pattern)
    }
    // ... rest of accept handler unchanged (error check, re-render, state reset)
    // Note: renderXlsx is synchronous (no await); renderDocx is async. Do not add await to the xlsx branch.
  } finally {
    setProcessing(false)
  }
}
```

---

## Popover UI (XLSX — `Review.jsx`)

The DOCX popover (single field name input) is untouched. The XLSX popover shows two inputs and a live preview.

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
- Both inputs editable; preview updates live as either input changes
- `fieldName` validated on Accept (regex + duplicate check — same rules as today)
- `label` has no validation; empty string is valid
- The DOCX popover renders only the `fieldName` input (unchanged)

**Popover state shape (unified — DOCX ignores `label`):**
```js
{ state: 'loading' | 'ready', label: string, fieldName: string, errorMsg: string, position }
```

The existing DOCX `setPopover` calls add `label: ''` so the shape is consistent; DOCX `handleAccept` never reads `popover.label`.

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

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Gemini call fails / times out (10 s) | Popover opens with empty label + empty fieldName; user fills manually |
| `label + value ≠ fullCellText` | Fall back to `label: ""`, `value: fullCellText`; no crash |
| `fieldName` invalid regex | Strip non-matching chars; prepend `field` if starts with digit; use `"field"` if empty |
| `fieldName` duplicate | Existing duplicate check in `handleAccept` catches it |
| Cell not found in XML | `insertXlsx` returns `{ error: 'cell_not_found' }` — popover shows existing error message |

---

## Testing

- **Unit — `suggestFieldPattern`:**
  - Mock Gemini response → assert correct `{ label, value, fieldName }` parsing
  - Malformed JSON → assert fallback to `{ label: "", value: fullCellText, fieldName: "field" }`
  - `label + value ≠ fullCellText` → assert fallback
  - `fieldName` fails regex → assert sanitization
  - `selectedText` empty → assert prompt omits the "User selected" line; no crash
  - Timeout → assert function throws within 10 s
- **Unit — `insertXlsx`:**
  - Given binary + cellAddress + pattern → assert output binary cell contains pattern string verbatim
  - Full-cell pattern (no label) → assert cell contains only `{{fieldName}}`
  - Pattern with label prefix → assert cell contains `"Label: {{fieldName}}"`
- **Integration — Review flow (XLSX):**
  - Cell click → Gemini mock returns `{ label, value, fieldName }` → popover prefills both inputs → user accepts → re-rendered HTML shows chip within label context
  - Cell click → Gemini mock throws → popover opens with empty inputs → user fills manually → accept succeeds
  - Text selection within cell → `selectedText` passed as hint → Gemini mock returns correct split
