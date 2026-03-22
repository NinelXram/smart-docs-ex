# Selection-Based Field Definition — Design Spec

**Date:** 2026-03-22
**Status:** Approved

---

## Overview

Replace the current AI full-document scan approach with a selection-based field definition workflow. Instead of sending the entire document to Gemini for variable detection, the user manually highlights text (DOCX) or clicks a cell (XLSX) in a natively rendered document view. The AI's role is narrowed to suggesting a field name for the selection based on context. The original file binary is modified in-place with `{{FieldName}}` tokens, enabling formatting-preserving output at generate time.

**Supported formats:** DOCX and XLSX. PDF support is explicitly out of scope for this iteration.

---

## Motivation

The previous approach extracted plain text from files and sent it to Gemini in full. This caused:
- Loss of original formatting, special characters, images, and Excel formulas
- Structural integrity issues for large or complex documents
- High token cost for documents where only a few fields need to be marked
- Risk of data loss when processing large-scale documents

---

## Architecture

### Approach: Selection-First, Binary-Preserving

The user uploads a file → it is rendered natively in the Review panel → the user selects text (DOCX) or clicks a cell (XLSX) → Gemini suggests a field name → the user confirms → the original binary is immediately rewritten with `{{FieldName}}` in place of the selected text/cell → the rendered view re-renders from the updated binary. No full-document AI scan occurs at any point.

At generate time, docxtemplater (DOCX) or SheetJS (XLSX) fills `{{FieldName}}` tokens in the binary directly, preserving all original formatting.

### Extension Contexts (unchanged)

| Context | Responsibility |
|---|---|
| `sidepanel/` | Full React app: rendering, field definition, storage, form generation |
| `background.js` | Service worker: registers side panel, handles icon click |
| `manifest.json` | Declares `side_panel`, `storage`, `unlimitedStorage`, host permissions for Gemini API |

### Tech Stack Changes

| Concern | Old | New |
|---|---|---|
| DOCX preview | mammoth (text extraction) | mammoth (HTML rendering for preview) |
| XLSX preview | xlsx (text extraction) | SheetJS (HTML table rendering with `data-cell-address` attributes) |
| Field insertion (DOCX) | N/A | JSZip + XML run normalization |
| Field insertion (XLSX) | N/A | SheetJS cell modification |
| DOCX generation | `docx` npm package (regenerates from scratch) | docxtemplater (fills tokens in original binary) |
| XLSX generation | SheetJS write (regenerates) | SheetJS read → modify → write (preserves structure) |
| PDF generation | jsPDF | **Removed** (PDF output not supported in this iteration) |
| AI role | Extract all variables from full document | Suggest field name for selected text/cell + context |

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/renderers/docx.js` | New | mammoth: DOCX ArrayBuffer → `{ html, binary }` |
| `src/lib/renderers/xlsx.js` | New | SheetJS: XLSX ArrayBuffer → `{ html, binary }` (cells have `data-cell-address` attrs) |
| `src/lib/renderers/index.js` | New | `renderFile(file) → Promise<{ html, binary, format }>` — dispatches to docx or xlsx renderer by file extension |
| `src/lib/fieldEditor.js` | New | `insertDocx(binary, selectedText, paragraphIndex, fieldName)` and `insertXlsx(binary, cellAddress, fieldName)` |
| `src/lib/gemini.js` | Modified | Add `suggestFieldName(apiKey, selectedText, surroundingContext, existingFields)` |
| `src/lib/storage.js` | Modified | Updated template schema: `binary` (base64) + `fields[]` replaces `rawContent` + `variables[]` |
| `src/lib/templateEngine.js` | Modified | Exports `generateDocx(binary, values)` and `generateXlsx(binary, values)`; remove `injectVariables`, jsPDF, and `docx` npm |
| `src/lib/parsers/docx.js` | Deleted | Replaced by `renderers/docx.js` |
| `src/lib/parsers/xlsx.js` | Deleted | Replaced by `renderers/xlsx.js` |
| `src/lib/parsers/index.js` | Deleted | Replaced by `renderers/index.js` |
| `src/pages/Upload.jsx` | Modified | No Gemini call on upload; calls `renderFile(file)` and passes `{ html, binary, format, fileName, fields: [] }` to Review |
| `src/pages/Review.jsx` | Replaced | Native document viewer + selection/click popover + field chip overlay |
| `src/test/lib/renderers/docx.test.js` | New | Renderer unit tests |
| `src/test/lib/renderers/xlsx.test.js` | New | Renderer unit tests |
| `src/test/lib/fieldEditor.test.js` | New | Field insertion unit tests |
| `src/test/lib/gemini.test.js` | Modified | Add tests for `suggestFieldName` |
| `src/test/lib/templateEngine.test.js` | Modified | Update generation tests for docxtemplater + SheetJS |
| `src/test/pages/Review.test.jsx` | Replaced | Review page interaction tests |
| `src/test/pages/Upload.test.jsx` | Modified | Remove Gemini call assertions; assert render output passed to Review |

---

## Data Flow

### Onboarding (Step 0 — unchanged)

Onboarding (API key entry and validation) is unchanged from the original design. `apiKey` is loaded from `chrome.storage.local` by `App.jsx` on startup and passed as a prop to Review. `suggestFieldName` receives `apiKey` as a parameter.

### Upload (Step 1)

1. User drops or selects a DOCX or XLSX file
2. Unsupported format (PDF, other) → rejected at drop with inline error: "Unsupported format — use DOCX or XLSX"
3. Format detected from file extension
4. `renderFile(file)` (from `src/lib/renderers/index.js`) reads the file as an ArrayBuffer and dispatches to the appropriate renderer:
   - DOCX: `renderDocx(buffer)` → `{ html: string, binary: ArrayBuffer }`
   - XLSX: `renderXlsx(buffer)` → `{ html: string, binary: ArrayBuffer }` (cells annotated with `data-cell-address`)
5. No Gemini call occurs at this step
6. Navigate to Review with `{ html, binary, format, fileName, fields: [] }`

### Review (Step 2)

**Rendering:**
- The `html` string is applied to a `<div ref={viewerRef}>` using a `useEffect` that sets `viewerRef.current.innerHTML = html` directly. React's `dangerouslySetInnerHTML` is not used because scroll position must be preserved across re-renders without unmounting the element.
- After setting `innerHTML`, a chip overlay pass immediately scans the new DOM for text nodes matching `{{FieldName}}` and replaces them with styled chip elements (color-coded by field index in `fields[]`). Because `innerHTML` is reset before the chip pass on every render, there is no risk of double-replacement.
- Scroll position is preserved by saving `viewerRef.current.scrollTop` before the `innerHTML` assignment and restoring it after the chip pass completes.
- The panel is vertically scrollable (`overflow-y: auto` on the viewer div).

**Field definition — DOCX (text selection):**

1. User selects text in the rendered document using mouse or keyboard
2. On `mouseup`, if the selection is non-collapsed and contains ≥ 3 non-whitespace characters:
   - Validate that anchor and focus nodes belong to the same paragraph element; if not: show inline popover error "Select text within a single paragraph" and return
   - Record `selectedText = selection.toString().trim()`
   - Compute `paragraphIndex`: call `Array.from(viewerRef.current.querySelectorAll('p'))` to get a flat list of all `<p>` elements in document order (including those inside table cells, matching mammoth's rendering order). `paragraphIndex` is the index of the `<p>` element that contains the anchor node of the selection. On the XML side, `fieldEditor.insertDocx` collects all `<w:p>` elements from `word/document.xml` in document order using a depth-first walk, which matches the order mammoth emits `<p>` elements. Both sides count all paragraphs (body and table-cell) in the same document order, ensuring the index is consistent.
   - Dismiss any existing popover
   - Show popover in "loading" state (spinner, Dismiss button only)
   - Call `suggestFieldName(apiKey, selectedText, surroundingContext, existingFields)` asynchronously
3. When suggestion returns: populate popover input with suggested name (editable); if suggestion fails (network error, invalid response): show empty editable input
4. User edits the field name if desired, then clicks Accept or Dismiss

**Field definition — XLSX (cell click):**

1. User clicks a rendered table cell
2. The target cell's `data-cell-address` attribute (e.g., `"Sheet1!B3"`) is read
3. `selectedText = cell.textContent.trim()` (the current cell value)
4. If cell already contains `{{...}}`: show error "This cell is already a field" and return
5. Show popover in "loading" state; call `suggestFieldName(apiKey, selectedText, surroundingContext, existingFields)` where `surroundingContext` is the text of the 2 surrounding cells in each direction and `existingFields` is the current `fields` array
6. When suggestion returns: populate popover input; if suggestion fails: show empty editable input

**On Accept (both formats):**

1. Validate field name: non-empty, matches `^[a-zA-Z][a-zA-Z0-9_]*$`, not already in `fields`; if invalid: show validation message in popover
2. Show spinner overlay on document viewer (document is temporarily non-interactive)
3. Call the appropriate editor:
   - DOCX: `fieldEditor.insertDocx(binary, selectedText, paragraphIndex, fieldName)` → `newBinary`
   - XLSX: `fieldEditor.insertXlsx(binary, cellAddress, fieldName)` → `newBinary`
4. If editor returns an error: dismiss spinner, show inline error in popover (do not update state)
5. On success: `binary ← newBinary`, `fields ← [...fields, fieldName]`
6. Re-render: call `renderDocx(newBinary)` or `renderXlsx(newBinary)` → extract only `html` from the result (the `binary` field of the renderer return value is ignored — `binary` state was already updated in step 5 from the `fieldEditor` output); update `html` state
7. Restore scroll position; dismiss spinner; dismiss popover; run chip overlay pass

**On Dismiss:** close popover, clear selection (DOCX) or deselect cell (XLSX).

**Saving:**
1. User enters a template name (non-empty) and clicks "Save Template"
2. Validates: name non-empty, at least one field defined
3. Encodes `binary` as base64 string using: `btoa(String.fromCharCode(...new Uint8Array(binary)))` for ArrayBuffers up to ~10 MB; for larger files, encode in chunks to avoid stack overflow
4. Saves to `chrome.storage.local`

### Template Storage

```json
{
  "id": "uuid-v4",
  "name": "Sales Contract",
  "sourceFormat": "docx",
  "binary": "<base64-encoded ArrayBuffer of the modified DOCX/XLSX with {{tokens}}>",
  "fields": ["ClientName", "EffectiveDate", "ContractValue"],
  "createdAt": 1774148866
}
```

`rawContent` and `variables` (with markers) from the previous schema are removed. `fields` is a flat array of field name strings — token positions are embedded in the binary itself.

**Storage note:** DOCX/XLSX binaries encoded as base64 are larger than plain text. `unlimitedStorage` is already declared in the manifest; no quota change required.

**Re-editing saved templates:** Not supported in this iteration. Templates in the Library are used for generation only, not re-editing.

### Library (Step 3 — unchanged)

Template list shows name, format badge, field count, and created date. Select navigates to Generate. Delete removes from storage.

### Generate (Step 4)

1. User selects a template from Library
2. Render one labeled input per name in `template.fields`
3. User fills values and clicks "Download"
4. Decode `template.binary` from base64 → ArrayBuffer using the inverse of the encoding: `Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer`
5. Generation via `templateEngine.js`:
   - **DOCX:** `generateDocx(binary: ArrayBuffer, values: Record<string, string>) → Promise<Blob>` — passes ArrayBuffer to docxtemplater with the values map → returns filled DOCX Blob → downloaded as `${name}.docx`
   - **XLSX:** `generateXlsx(binary: ArrayBuffer, values: Record<string, string>) → Promise<Blob>` — SheetJS reads ArrayBuffer → iterates all cells across all sheets, replaces `{{FieldName}}` cell values with user-supplied values → SheetJS writes → returns Blob → downloaded as `${name}.xlsx`
   - The old `injectVariables` export is removed from `templateEngine.js`
6. Warnings: if a `{{FieldName}}` token is not found in the binary, highlight that input and warn: `"Field 'X' not found in template — it will be skipped"`
7. Output format is always the same as `sourceFormat` (no cross-format conversion)

---

## DOCX Field Insertion — Technical Detail

DOCX XML stores paragraph text across multiple `<w:r>` (run) elements. A string like "John Smith" may be split as `<w:r>John </w:r><w:r>Smith</w:r>`. Simple string search across the serialized XML fails in this case.

**Insertion algorithm (`fieldEditor.insertDocx(binary, selectedText, paragraphIndex, fieldName)`):**

1. Use JSZip to unpack the DOCX
2. Parse `word/document.xml`; collect all `<w:p>` paragraph elements
3. Select the paragraph at `paragraphIndex`
4. Concatenate text content of all `<w:r>` children to produce the paragraph's plain-text view
5. Search for `selectedText` in the plain-text view
6. If not found: return error `{ error: "text_not_found" }` — Review shows "Could not locate selection in document — try selecting again"
7. If found: identify which runs span the match; normalize by merging those runs into a single run preserving the first run's formatting (`<w:rPr>`); replace the merged run's text with `{{fieldName}}`
8. If `selectedText` appears more than once in the paragraph: use the first occurrence (consistent, deterministic behavior; user is not warned since the exact paragraph is targeted by index)
9. Serialize and rezip → return `{ binary: ArrayBuffer }`

**XLSX field insertion (`fieldEditor.insertXlsx(binary, cellAddress, fieldName)`):**

1. SheetJS reads the workbook
2. Parse `cellAddress` (format: `"SheetName!ColRow"`, e.g., `"Sheet1!B3"`)
3. Locate the sheet and cell; set cell value to `{{fieldName}}`; preserve cell type as string
4. For merged cells: `cellAddress` refers to the top-left cell of the merged range; inserting into any other cell of the merge is not supported and produces an error
5. SheetJS writes → return `{ binary: ArrayBuffer }`

---

## XLSX Renderer — Technical Detail

`renderXlsx(buffer)` uses SheetJS to convert each sheet to an HTML table. The rendered HTML contains one `<table>` per sheet, each preceded by a `<h3>` heading with the sheet name. Each `<td>` element receives a `data-cell-address` attribute in the format `"SheetName!ColRow"` (e.g., `data-cell-address="Sheet1!B3"`). This attribute survives re-renders because it is generated from the cell coordinates, not from DOM identity. The `cellMap` is not a separate data structure — the address is read directly from the clicked element's dataset.

**Merged cells:** SheetJS HTML output represents merged cells as a single `<td colspan="..." rowspan="...">` element for the top-left cell of the merge; non-primary cells of the merge are absent from the DOM. Consequently, a user can only ever click the top-left cell of a merge (the only rendered element). The "Select the top-left cell of a merged range" error in the Error Handling table is therefore unreachable and is removed from the spec. The `fieldEditor.insertXlsx` documentation note about non-primary cells is retained as an internal implementation constraint.

---

## Gemini Integration — `suggestFieldName`

**Signature:** `suggestFieldName(apiKey: string, selectedText: string, surroundingContext: string, existingFields: string[]) → Promise<string | null>`

**`surroundingContext`:** extracted from `viewerRef.current.textContent` (the rendered document's plain text, HTML tags stripped) — up to 100 characters before and after `selectedText`.

**Prompt:**
> "The following text was selected from a document: `"<selectedText>"`. The surrounding context is: `"<context>"`. Fields already defined: `[<existingFields>]`. Suggest a concise camelCase field name for the selected text. Return only the field name, nothing else."

**Response handling:**
- Strip whitespace; validate against `^[a-zA-Z][a-zA-Z0-9_]*$`
- If response is invalid or request fails: return `null` → popover shows empty editable input, user types manually
- No retry on failure

**Accidental selection guard:** The Gemini call is only made if the selection contains ≥ 3 non-whitespace characters (enforced in Review before the API call).

---

## UI Layout

**Review panel (400px wide):**
- Full-height document viewer with vertical scroll (`overflow-y: auto`)
- Non-editable rendered document; native browser text selection enabled (DOCX) or cell click (XLSX)
- Chip overlay: `{{FieldName}}` tokens replaced with colored inline badges (color assigned by index in `fields[]`)
- Spinner overlay covers the document viewer during re-render (non-interactive)
- Selection popover: fixed-position card anchored near the selection/clicked cell, z-index above document; contains field name input, Accept and Dismiss buttons, and inline validation/error messages
- Bottom bar: field count label, template name input, Save Template button

**Generate panel (unchanged layout):** one labeled input per field name in `fields[]`, Download button.

---

## Error Handling

| Scenario | Response |
|---|---|
| Unsupported format (PDF, etc.) | Rejected at drop: "Unsupported format — use DOCX or XLSX" |
| Corrupted file / parse failure | Error state on Upload: "Could not read file — try another" |
| Selection < 3 non-whitespace characters | No popover; selection ignored |
| Cross-paragraph selection (DOCX) | Inline popover error: "Select text within a single paragraph" |
| Selected text not found in paragraph XML | Inline popover error: "Could not locate selection in document — try selecting again" |
| Cell already a field (XLSX) | Inline popover error: "This cell is already a field" |
| Merged cell — non-primary cell targeted | Not reachable: SheetJS renders only the top-left cell of each merge; non-primary cells are absent from the DOM |
| Duplicate field name | Popover validation: "Field name already used — choose another" |
| Invalid field name format | Popover validation: "Field name must start with a letter and contain only letters, digits, and underscores" |
| AI suggestion fails | Popover shows empty editable input; user types manually |
| Save with no fields | Validation: "Define at least one field before saving" |
| Save with no name | Validation: "Enter a template name" |
| `{{FieldName}}` missing at generate time | Per-field warning; field skipped in output |
| Storage quota exceeded | Prompt to delete old templates |

---

## Testing Strategy

### Unit Tests (Vitest)

- **`renderers/docx.js`:** Given a DOCX ArrayBuffer fixture, assert HTML output contains expected text; assert `binary` is returned unchanged
- **`renderers/xlsx.js`:** Given an XLSX ArrayBuffer fixture, assert HTML table contains expected cell values; assert cells have `data-cell-address` attributes with correct addresses
- **`fieldEditor.js` (DOCX):** Given a DOCX binary + selected text + paragraphIndex, assert returned binary contains `{{FieldName}}` and original text is absent; assert run-split text is correctly normalized; assert text-not-found returns error; assert duplicate text in paragraph uses first occurrence
- **`fieldEditor.js` (XLSX):** Given an XLSX binary + cell address, assert returned binary has `{{FieldName}}` in that cell; assert cell type is preserved as string
- **`gemini.js` (`suggestFieldName`):** Mock API — assert prompt includes selected text, context, and existing fields; assert invalid response returns `null`; assert network error returns `null`
- **`templateEngine.js` (`generateDocx`):** `generateDocx(binary: ArrayBuffer, values: Record<string, string>) → Promise<Blob>` — given a DOCX binary with `{{ClientName}}`, assert returned Blob contains the substituted value; assert missing token produces a warning and the field is skipped
- **`templateEngine.js` (`generateXlsx`):** `generateXlsx(binary: ArrayBuffer, values: Record<string, string>) → Promise<Blob>` — given an XLSX binary with a `{{ClientName}}` cell, assert returned Blob has the substituted value; assert `injectVariables` is no longer exported

### Component Tests (@testing-library/react)

- **`Review.jsx`:** Mock renderers and fieldEditor; assert popover appears on valid selection (DOCX); assert popover appears on cell click (XLSX); assert AI suggestion rendered in input; assert Accept triggers `fieldEditor.insertDocx` / `insertXlsx` and re-render; assert Dismiss closes popover; assert chip appears after Accept; assert cross-paragraph selection shows error; assert selection < 3 chars shows no popover; assert duplicate field name blocked at Accept; assert Save Template blocked when zero fields defined
- **`Upload.jsx`:** Assert no Gemini call on upload; assert render result (html, binary, format) passed to Review

### Manual QA

- DOCX with run-split text (verify field insertion works correctly)
- XLSX with merged cells (verify top-left cell is targeted)
- Large DOCX (verify base64 storage round-trip)
- Generate: all fields filled; missing-field warning; downloaded file opens correctly in Word / Excel

---

## Constraints & Decisions

| Decision | Rationale |
|---|---|
| PDF output removed | PDF text replacement while preserving layout is not feasible client-side; PDF rendering for the review panel is also out of scope for this iteration |
| Output format = source format only | No cross-format conversion; simplifies generation and avoids fidelity loss |
| docxtemplater for DOCX generation | Handles `{{token}}` reliably even if surrounding XML is complex |
| XLSX uses cell click (not text selection) | XLSX data is cell-structured; text selection across cells is ambiguous; cell-click maps directly to a `data-cell-address` |
| Binary stored as base64 in `chrome.storage.local` | Single-user, local-first; `unlimitedStorage` already declared |
| AI suggestion is optional (falls back to manual input) | Network failure or quota exhaustion must not block field definition |
| Re-render from binary after each insertion | Ensures review panel always reflects the actual stored state of the binary |
| No cross-paragraph fields | Selecting across paragraph boundaries in DOCX XML is prohibitively complex; single-paragraph constraint is acceptable for all practical field types (names, dates, amounts) |
| Re-editing saved templates not supported | Out of scope; adds significant complexity around detecting which tokens exist, rendering them as editable chips, and updating the binary |
| `paragraphIndex` passed to `fieldEditor.insertDocx` | Disambiguates which paragraph to modify when the same text appears in multiple paragraphs |
| `data-cell-address` on XLSX cells | Stable across re-renders (derived from coordinates, not DOM identity); eliminates need for a separate `cellMap` data structure |
| Minimum 3 non-whitespace characters to trigger AI | Prevents API calls from accidental or exploratory selections |
