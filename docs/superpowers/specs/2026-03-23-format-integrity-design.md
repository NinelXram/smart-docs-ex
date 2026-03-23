# Format Integrity & Field Mapping Fixes

**Date:** 2026-03-23
**Status:** Approved

## Problem Summary

Four bugs affect the Review step and document generation:

1. **DOCX preview style bleeding** — mammoth strips all formatting; fonts, spacing, and tables are lost in the HTML preview.
2. **Excel images lost in preview** — `renderXlsx` only emits text cells; embedded images are invisible.
3. **Excel images lost in download** — `insertXlsx` round-trips through `XLSX.write()`, which rebuilds the zip from scratch and silently drops all drawing/media entries.
4. **DOCX field mapping unresponsive** — the Gemini model name `'gemini-flash-latest'` is invalid; errors are swallowed silently; the popover freezes on "Analyzing…" indefinitely.

## Goals

- DOCX HTML preview preserves fonts, spacing, tables, and layout.
- Excel preview shows placeholder markers where embedded images appear.
- Generated DOCX and XLSX outputs are byte-faithful except for the replaced `{{token}}` values.
- Field mapping always works; Gemini AI suggestion is a convenience, not a gate.
- Errors surface to the user instead of disappearing silently.

## Out of Scope

- Actual image rendering in the Excel preview (placeholder markers only).
- DOCX output style changes (binary-level manipulation already preserves styles correctly).
- Any changes to the Generate, Library, or Onboarding steps.

---

## Design

### 1. DOCX Preview — `src/lib/renderers/docx.js`

**Replace mammoth with `docx-preview`.**

`docx-preview` renders a DOCX `ArrayBuffer` into a detached DOM `<div>` with embedded CSS, preserving fonts, paragraph spacing, tables, bold/italic, and inline images.

**Implementation:**
1. Call `docx.renderAsync(buffer, container)` on a detached `<div>`.
2. Walk all `<p>` elements in the rendered output and add `data-paragraph-index` attributes (0-based) so `Review.jsx`'s paragraph-index mapping continues to work.
3. Return `{ html: container.innerHTML, binary: buffer }` — same interface, binary is unchanged.

**Dependency:** Add `docx-preview` to `package.json`.

---

### 2. Excel Image Placeholders — `src/lib/renderers/xlsx.js`

**Detect image anchors from drawing XML; inject placeholder `<td>` cells.**

XLSX files store drawing metadata in `xl/drawings/drawingN.xml`. Each drawing anchor (`<xdr:oneCellAnchor>` / `<xdr:twoCellAnchor>`) contains a `<xdr:from>` element with `<xdr:col>` and `<xdr:row>` (0-based integers) identifying the anchor cell.

**Implementation:**
1. Open the buffer with PizZip before rendering.
2. For each sheet, resolve its drawing relationship from `xl/worksheets/_rels/sheetN.xml.rels`, then parse `xl/drawings/drawingN.xml`.
3. Collect a `Set<string>` of cell addresses (e.g. `"Sheet1!B3"`) that have image anchors.
4. When emitting `<td>` elements, check if the cell address is in the set. If so, add `data-image-placeholder="true"` and render:
   ```html
   <td data-cell-address="Sheet1!B3" data-image-placeholder="true">
     <span style="...placeholder styles...">[Image]</span>
   </td>
   ```
5. `binary` remains the original `ArrayBuffer` passthrough — no mutation.

---

### 3. Excel Binary Preservation — `src/lib/fieldEditor.js` (`insertXlsx`)

**Replace `XLSX.read` → `XLSX.write` with direct PizZip surgery.**

`XLSX.write` rebuilds the zip from only what SheetJS models; drawings and media entries are lost. Instead:

1. Open the buffer with PizZip.
2. Resolve the target sheet's XML path via `xl/workbook.xml` → `xl/_rels/workbook.xml.rels`.
3. Read `xl/worksheets/sheetN.xml` as text.
4. Locate the target cell by address using XML parsing (DOMParser on just the sheet XML).
5. If the workbook has a shared strings table (`xl/sharedStrings.xml`): append `{{fieldName}}` as a new `<si><t>` entry, update the cell to type `s` referencing the new index. If no shared strings table exists, write an inline string (`t="inlineStr"`).
6. Write only the modified XML files back into the zip. All other entries (drawings, media, styles, relationships, `[Content_Types].xml`) remain exactly as-is.
7. Return `{ binary: zip.generate({ type: 'arraybuffer' }) }`.

Return shape unchanged: `{ binary: ArrayBuffer } | { error: string }`.

---

### 4. Gemini Reliability — `src/lib/gemini.js` + `src/pages/Review.jsx`

#### gemini.js

- **Fix model name:** `'gemini-flash-latest'` → `'gemini-2.0-flash-latest'`.
- **Add timeout:** Wrap the `generateContent` call with a 10-second `AbortController` timeout. If it fires, throw `new Error('timeout')`.
- **Remove silent swallow:** Delete the `catch { return null }` in `suggestFieldName`. Re-throw the error so callers can decide how to handle it.

#### Review.jsx

- Wrap `await openSuggestion(...)` calls in `handleMouseUp` and `handleClick` with try/catch.
- On catch, transition the popover from `'loading'` to `'ready'` with:
  ```js
  { state: 'ready', fieldName: '', errorMsg: 'AI suggestion failed — enter a name manually' }
  ```
- Field mapping always completes. The user can type a name manually and accept.

---

## Data Flow (unchanged)

```
Upload → renderFile() → { html, binary, format, fileName, fields: [] }
Review → user selects → suggestFieldName() → popover → accept
       → insertDocx/insertXlsx(binary) → { binary } (images preserved)
       → re-render → updated html with {{token}} chips
       → saveTemplate({ binary: base64, fields })
Generate → generateDocx/Xlsx(binary, values) → download
```

---

## Error Handling Summary

| Scenario | Before | After |
|---|---|---|
| Gemini API error | Popover frozen on "Analyzing…" | Popover shows "AI suggestion failed — enter a name manually" |
| Gemini timeout (>10s) | Popover frozen indefinitely | Popover shows fallback message after 10s |
| insertXlsx error | `errorMsg` shown in popover | Unchanged (already handled) |
| Save failure | `saveError` shown | Unchanged (already handled) |

---

## Testing

All changes update **existing** test files — no new test files created.

| Test file | What changes |
|---|---|
| `renderers/docx.test.js` | Mock `docx-preview`; assert `html` has content, `binary` is passthrough, `<p>` elements have `data-paragraph-index` |
| `renderers/xlsx.test.js` | Add fixture XLSX with drawing; assert HTML contains `[Image]` placeholder at correct cell address |
| `fieldEditor.test.js` | Assert that after `insertXlsx`, output zip still contains `xl/drawings/` entries from original |
| `gemini.test.js` | Assert `suggestFieldName` throws on API error and on timeout (not returns null) |
| `Review.test.jsx` | Assert popover transitions to `ready` with fallback message when `suggestFieldName` rejects |

---

## Files Changed

| File | Change |
|---|---|
| `src/lib/renderers/docx.js` | Replace mammoth with docx-preview |
| `src/lib/renderers/xlsx.js` | Add PizZip-based image placeholder detection |
| `src/lib/fieldEditor.js` | Replace XLSX.write with PizZip surgery in `insertXlsx` |
| `src/lib/gemini.js` | Fix model name, add timeout, remove silent swallow |
| `src/pages/Review.jsx` | Add error handling around `openSuggestion` calls |
| `package.json` | Add `docx-preview` dependency |
