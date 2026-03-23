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
1. Import as `import * as docx from 'docx-preview'` and call `docx.renderAsync(buffer, container)` on a detached `<div>`.
2. Walk all `<p>` elements in the rendered output and add `data-paragraph-index` attributes (0-based).

   **Alignment with `collectBodyParagraphs`:** `insertDocx` uses `collectBodyParagraphs` to index `<w:p>` elements in `word/document.xml` (depth-first, excluding `<w:del>` children). `Review.jsx` maps these indices by calling `viewerRef.current.querySelectorAll('p')` on the rendered HTML. For the indices to align, the rendered `<p>` count must match the `collectBodyParagraphs` count. `docx-preview` renders one HTML `<p>` per DOCX `<w:p>`, including paragraphs inside table cells and text boxes, in document order — matching `collectBodyParagraphs`'s depth-first walk. Paragraphs inside `<w:del>` are excluded by `collectBodyParagraphs` but `docx-preview` does not render deleted text either, so the counts stay in sync. If a future edge case breaks alignment, `insertDocx` returns `{ error: 'text_not_found' }`, which surfaces in the Review UI.

3. Return `{ html: container.innerHTML, binary: buffer }` — same interface, binary is unchanged.

**Dependency:** Add `docx-preview` to `package.json`.

---

### 2. Excel Image Placeholders — `src/lib/renderers/xlsx.js`

**Detect image anchors from drawing XML; inject placeholder `<td>` cells.**

XLSX files store drawing metadata in `xl/drawings/drawingN.xml`. Each drawing anchor (`<xdr:oneCellAnchor>` / `<xdr:twoCellAnchor>`) contains a `<xdr:from>` element with `<xdr:col>` and `<xdr:row>` (0-based integers) identifying the anchor cell.

**Implementation:**

`renderXlsx` retains `XLSX.read` for all cell-data rendering — existing tests that mock `XLSX.read` remain valid and unchanged. PizZip is added as a second, independent step solely to detect image anchors before the table is built. The two paths do not interact.

1. Attempt to open the buffer with PizZip inside a try/catch. If the buffer is not a valid zip (e.g. test fixtures using `new ArrayBuffer(8)`), catch the error and proceed with an empty image-anchor set — image placeholder detection degrades gracefully to a no-op. `XLSX.read` is still called as before; existing mocks still drive cell rendering.
2. For each sheet, resolve its drawing relationship from `xl/worksheets/_rels/sheetN.xml.rels`, then parse `xl/drawings/drawingN.xml`.
3. Collect a `Set<string>` of cell addresses (e.g. `"Sheet1!B3"`) that have image anchors.
4. Call `XLSX.read` and build the HTML table as before. When emitting each `<td>`, check the cell address against the anchor set. If matched, add `data-image-placeholder="true"` and render `<span>[Image]</span>` instead of the cell value.
5. `binary` remains the original `ArrayBuffer` passthrough — no mutation.

---

### 3. Excel Binary Preservation — `src/lib/fieldEditor.js` (`insertXlsx`)

**Replace `XLSX.read` → `XLSX.write` with direct PizZip surgery.**

`XLSX.write` rebuilds the zip from only what SheetJS models; drawings and media entries are lost. Instead:

1. Open the buffer with PizZip.
2. Resolve the target sheet's XML path using this two-step lookup:
   - Parse `xl/workbook.xml` and find the `<sheet name="...">` element whose `name` attribute matches `sheetName`. If no match is found, return `{ error: 'sheet_not_found' }`.
   - Read its `r:id` attribute, then look up that `r:id` in `xl/_rels/workbook.xml.rels` to get the target file path (e.g. `worksheets/sheet2.xml`), and resolve to `xl/worksheets/sheet2.xml`.
   - If the rels file is absent or does not contain the `r:id`, fall back to iterating `Object.keys(zip.files)` for entries matching `xl/worksheets/sheet*.xml` in lexicographic order — but only after the `sheet_not_found` check above has already confirmed the sheet name exists in `xl/workbook.xml`. This preserves the existing `{ error: 'sheet_not_found' }` error path.
3. Read `xl/worksheets/sheetN.xml` as text.
4. Locate the target cell by address using XML parsing (DOMParser on just the sheet XML).
5. If the workbook has a shared strings table (`xl/sharedStrings.xml`): append `{{fieldName}}` as a new `<si><t>` entry, update the cell to type `s` referencing the new index. If no shared strings table exists, write an inline string using the correct OOXML structure — `<c r="B3" t="inlineStr"><is><t>{{fieldName}}</t></is></c>` — with no `<v>` child element (using `<v>` for `inlineStr` produces an invalid file that Excel rejects).
6. Write only the modified XML files back into the zip. All other entries (drawings, media, styles, relationships, `[Content_Types].xml`) remain exactly as-is.
7. Return `{ binary: zip.generate({ type: 'arraybuffer' }) }`.

   The `ArrayBuffer` produced by `zip.generate` is a valid OOXML zip that PizZip can subsequently re-open (PizZip reads its own output), so the re-render call in `Review.jsx` (`renderXlsx(newBinary)`) will succeed including the image-placeholder pass.

Return shape unchanged: `{ binary: ArrayBuffer } | { error: string }`.

---

### 4. Gemini Reliability — `src/lib/gemini.js` + `src/pages/Review.jsx`

#### gemini.js

- **Fix model name:** `'gemini-flash-latest'` → `'gemini-2.0-flash'` (the correct stable identifier; do not use a `-latest` suffix on versioned names).
- **Add timeout:** Wrap the `generateContent` call with a 10-second `AbortController` timeout. If it fires, throw `new Error('timeout')`.
- **Remove silent swallow:** Delete the `catch { return null }` in `suggestFieldName`. Re-throw the error so callers can decide how to handle it.

#### Review.jsx

The `await suggestFieldName(...)` call lives inside the `openSuggestion` `useCallback`. The try/catch **must be placed inside `openSuggestion`** — not in `handleMouseUp`/`handleClick` — so the popover state is updated before the throw propagates and leaves it frozen on `'loading'`.

Change `openSuggestion` to:
```js
const openSuggestion = useCallback(async (selectedText, surroundingContext, pendingData, position) => {
  pendingRef.current = pendingData
  setPopover({ state: 'loading', fieldName: '', errorMsg: '', position })
  try {
    const suggested = await suggestFieldName(apiKey, selectedText, surroundingContext, fields)
    setPopover(prev => prev ? { ...prev, state: 'ready', fieldName: suggested ?? '' } : null)
  } catch {
    setPopover(prev => prev
      ? { ...prev, state: 'ready', fieldName: '', errorMsg: 'AI suggestion failed — enter a name manually' }
      : null)
  }
}, [apiKey, fields])
```

Field mapping always completes. The user can type a name manually and accept.

**Note on null vs throw:** `suggestFieldName` has two distinct failure modes that must not be conflated:
- **Returns `null`** — Gemini responded but the returned string failed regex validation (`/^[a-zA-Z][a-zA-Z0-9_]*$/`). This is handled by `suggested ?? ''` in the try block and is not an error — the popover opens normally with an empty field for the user to fill.
- **Throws** — API error, network failure, or timeout. This is handled by the catch block. These two paths are mutually exclusive; do not merge them.

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
| `renderers/docx.test.js` | **Replace the entire file.** Remove `vi.mock('mammoth', ...)`, `import mammoth from 'mammoth'`, and both existing tests. Add: `vi.mock('docx-preview', () => ({ renderAsync: vi.fn(async (_buf, container) => { container.innerHTML = '<p>Hello</p><p>World</p>' }) }))` and `import * as docx from 'docx-preview'`. Two new tests: (1) assert `result.binary` is the original buffer; (2) assert `result.html` (a string) contains both `data-paragraph-index="0"` and `data-paragraph-index="1"` via `toContain` — do not query a DOM object. |
| `renderers/xlsx.test.js` | Add a new test using a hand-built PizZip buffer that includes `xl/drawings/drawing1.xml` with a `<xdr:oneCellAnchor>` anchored at col 1, row 2 (i.e. "Sheet1!B3"). Assert the rendered HTML contains `data-image-placeholder="true"` and the text `[Image]`. Existing tests pass `new ArrayBuffer(8)` — these continue to work because the PizZip open in step 1 is guarded by try/catch, producing an empty anchor set on invalid buffers. |
| `fieldEditor.test.js` | Add a new test using a hand-built PizZip fixture that includes `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheet1.xml`, `xl/sharedStrings.xml`, and a `xl/drawings/drawing1.xml` entry (minimal XML content). Call `insertXlsx` and re-open the result with PizZip. Assert the output zip's file list includes `xl/drawings/drawing1.xml`. Existing `buildXlsx`-based tests pass via the rels fallback. |
| `gemini.test.js` | **Replace lines 116–120** (`'returns null when API call throws'`) with: `it('throws when API call fails', async () => { mockGenerateContent.mockRejectedValue(new Error('Network error')); await expect(suggestFieldName('key', 'text', 'ctx', [])).rejects.toThrow('Network error') })`. Add a timeout test using `vi.useFakeTimers()`: mock `generateContent` to return a Promise that never resolves, fire `suggestFieldName(...)`, advance timers by 10001ms, and assert the returned promise rejects. The `'returns null when response is empty string'` test (lines 122–126) is unchanged. **Must be updated in the same commit as `gemini.js`.** |
| `Review.test.jsx` | Add a new test inside `describe('Review — DOCX', ...)`: call `gemini.suggestFieldName.mockRejectedValue(new Error('Network error'))`, simulate a mouseUp with a valid selection, and assert `screen.getByText(/AI suggestion failed/i)` is in the document and `screen.getByRole('dialog')` is still present. |

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
