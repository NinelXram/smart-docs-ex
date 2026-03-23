# Format Integrity & Field Mapping Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four bugs: DOCX preview strips styles (replace mammoth → docx-preview), Excel images lost in preview and download (add PizZip image detection; rewrite insertXlsx to skip XLSX.write), and Gemini field-name suggestion hangs silently (fix model name, add timeout, surface errors).

**Architecture:** Each fix is isolated to one file. Tests are TDD — write the failing test, verify it fails, implement, verify it passes, commit. Task 1 (Gemini) and Task 4 (insertXlsx) are the highest-priority fixes. Tasks execute in dependency order: install dep → DOCX renderer → XLSX renderer → XLSX binary → Gemini+Review.

**Tech Stack:** Vitest + React Testing Library (tests), docx-preview (new dep), PizZip (already installed), SheetJS/xlsx (already installed), @google/generative-ai (already installed)

---

## File Map

| File | Change |
|---|---|
| `src/lib/renderers/docx.js` | Replace mammoth with docx-preview |
| `src/lib/renderers/xlsx.js` | Add PizZip image-anchor detection before XLSX.read table render |
| `src/lib/fieldEditor.js` | Rewrite `insertXlsx` using PizZip zip surgery |
| `src/lib/gemini.js` | Fix model name, add 10s timeout via Promise.race, re-throw errors |
| `src/pages/Review.jsx` | Wrap suggestFieldName call in try/catch inside openSuggestion |
| `src/test/lib/renderers/docx.test.js` | Replace entire file (remove mammoth, add docx-preview mock + tests) |
| `src/test/lib/renderers/xlsx.test.js` | Add image-placeholder test |
| `src/test/lib/fieldEditor.test.js` | Add drawing-preservation test |
| `src/test/lib/gemini.test.js` | Replace throws test, add timeout test |
| `src/test/pages/Review.test.jsx` | Add AI-failure popover test |
| `package.json` | Add `docx-preview` |

---

## Task 1: Install docx-preview dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
npm install docx-preview
```

Expected: package added to `dependencies` in `package.json`.

- [ ] **Step 2: Verify it resolves**

```bash
node -e "import('docx-preview').then(m => console.log(Object.keys(m)))"
```

Expected: prints an array including `renderAsync`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add docx-preview dependency"
```

---

## Task 2: Replace DOCX renderer (mammoth → docx-preview)

**Files:**
- Modify: `src/lib/renderers/docx.js`
- Modify: `src/test/lib/renderers/docx.test.js` (full replacement)

**Background:** `docx-preview` renders a DOCX `ArrayBuffer` into a DOM container using `docx.renderAsync(buffer, container)`. After it resolves, `container.innerHTML` contains styled HTML. We then walk all `<p>` elements and stamp them with `data-paragraph-index` attributes so `Review.jsx`'s `querySelectorAll('p')` finds them in the same order as `insertDocx`'s `collectBodyParagraphs` (both walk `<w:p>` elements depth-first, so counts stay in sync).

- [ ] **Step 1: Replace the test file entirely**

Write `src/test/lib/renderers/docx.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('docx-preview', () => ({
  renderAsync: vi.fn(async (_buf, container) => {
    container.innerHTML = '<p>Hello</p><p>World</p>'
  }),
}))

import * as docx from 'docx-preview'
import { renderDocx } from '../../../lib/renderers/docx.js'

describe('renderDocx', () => {
  it('passes binary through unchanged', async () => {
    const buffer = new ArrayBuffer(8)
    const result = await renderDocx(buffer)
    expect(result.binary).toBe(buffer)
  })

  it('returns html with data-paragraph-index on each <p>', async () => {
    const buffer = new ArrayBuffer(8)
    const result = await renderDocx(buffer)
    expect(result.html).toContain('data-paragraph-index="0"')
    expect(result.html).toContain('data-paragraph-index="1"')
  })
})
```

- [ ] **Step 2: Run to confirm both tests fail**

```bash
npx vitest run src/test/lib/renderers/docx.test.js
```

Expected: FAIL — `renderDocx` still uses mammoth, returns no `data-paragraph-index`.

- [ ] **Step 3: Rewrite `src/lib/renderers/docx.js`**

```js
import * as docx from 'docx-preview'

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ html: string, binary: ArrayBuffer }>}
 */
export async function renderDocx(buffer) {
  const container = document.createElement('div')
  await docx.renderAsync(buffer, container)

  // Stamp each rendered <p> with its 0-based index so Review.jsx's
  // querySelectorAll('p') aligns with insertDocx's collectBodyParagraphs.
  Array.from(container.querySelectorAll('p')).forEach((p, i) => {
    p.setAttribute('data-paragraph-index', String(i))
  })

  return { html: container.innerHTML, binary: buffer }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/test/lib/renderers/docx.test.js
```

Expected: PASS (2 tests).

- [ ] **Step 5: Run full test suite to confirm nothing else broke**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/renderers/docx.js src/test/lib/renderers/docx.test.js
git commit -m "feat: replace mammoth with docx-preview for styled DOCX preview"
```

---

## Task 3: Excel image placeholder detection

**Files:**
- Modify: `src/lib/renderers/xlsx.js`
- Modify: `src/test/lib/renderers/xlsx.test.js`

**Background:** XLSX files store image anchors in `xl/drawings/drawingN.xml`. Each anchor has `<xdr:from><xdr:col>` and `<xdr:row>` (0-based integers). We open the zip with PizZip (guarded by try/catch so invalid test buffers still work), walk the workbook → rels → drawing chain to collect image-anchor cell addresses, then inject `[Image]` placeholders when emitting `<td>` elements. `XLSX.read` is still used for all cell data — the existing mock-based tests are unaffected.

- [ ] **Step 1: Add the failing test to `src/test/lib/renderers/xlsx.test.js`**

First, add the PizZip import at the **top of the file**, after line 11 (after `import * as XLSX from 'xlsx'`):

```js
import PizZip from 'pizzip'
```

Then add this helper and test at the **end of the file**, inside the `describe('renderXlsx', ...)` block, before the closing `})`:

```js
// Build a minimal XLSX zip (not via SheetJS) that contains a drawing anchored at col=0, row=0.
function buildXlsxWithDrawing() {
  const zip = new PizZip()
  zip.file('xl/workbook.xml',
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
  zip.file('xl/worksheets/_rels/sheet1.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`)
  zip.file('xl/drawings/drawing1.xml',
    `<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="1" cy="1"/><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`)
  return zip.generate({ type: 'arraybuffer' })
}

it('renders image placeholder for cells with embedded images', () => {
  XLSX.read.mockReturnValue({
    SheetNames: ['Sheet1'],
    Sheets: { Sheet1: { '!ref': 'A1:A1', A1: { v: '', t: 's' } } },
  })
  XLSX.utils.decode_range.mockReturnValue({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } })
  // Reset the once-queue from beforeEach before setting the unconditional mock
  XLSX.utils.encode_cell.mockReset()
  XLSX.utils.encode_cell.mockReturnValue('A1')

  const buffer = buildXlsxWithDrawing()
  const result = renderXlsx(buffer)

  expect(result.html).toContain('data-image-placeholder="true"')
  expect(result.html).toContain('[Image]')
  expect(result.html).toContain('data-cell-address="Sheet1!A1"')
})
```

- [ ] **Step 2: Run to confirm test fails**

```bash
npx vitest run src/test/lib/renderers/xlsx.test.js
```

Expected: FAIL on the new test — `data-image-placeholder` not present.

- [ ] **Step 3: Update `src/lib/renderers/xlsx.js`**

```js
import * as XLSX from 'xlsx'
import PizZip from 'pizzip'

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Build a Map<sheetName, Set<"col,row">> of image-anchor positions.
 * Opens the zip with PizZip; returns empty map on any error.
 * @param {ArrayBuffer} buffer
 * @param {string[]} sheetNames
 */
function buildImageAnchors(buffer, sheetNames) {
  const anchors = new Map(sheetNames.map(n => [n, new Set()]))
  let zip
  try { zip = new PizZip(buffer) } catch { return anchors }

  // Resolve sheet name → sheet XML file path via workbook.xml + rels
  const wbFile = zip.files['xl/workbook.xml']
  const wbRelsFile = zip.files['xl/_rels/workbook.xml.rels']
  if (!wbFile || !wbRelsFile) return anchors

  const wbDoc = new DOMParser().parseFromString(wbFile.asText(), 'text/xml')
  const relsDoc = new DOMParser().parseFromString(wbRelsFile.asText(), 'text/xml')

  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

  for (const sheetName of sheetNames) {
    const sheetEls = Array.from(wbDoc.querySelectorAll('sheet'))
    const sheetEl = sheetEls.find(el => el.getAttribute('name') === sheetName)
    if (!sheetEl) continue

    const rId = sheetEl.getAttributeNS(R_NS, 'id') || sheetEl.getAttribute('r:id')
    const relEls = Array.from(relsDoc.querySelectorAll('Relationship'))
    const sheetRel = relEls.find(r => r.getAttribute('Id') === rId)
    if (!sheetRel) continue

    // e.g. Target="worksheets/sheet1.xml" → "sheet1.xml"
    const sheetFileName = (sheetRel.getAttribute('Target') || '').split('/').pop()
    const sheetRelsPath = `xl/worksheets/_rels/${sheetFileName}.rels`
    const sheetRelsFile = zip.files[sheetRelsPath]
    if (!sheetRelsFile) continue

    const sheetRelsDoc = new DOMParser().parseFromString(sheetRelsFile.asText(), 'text/xml')
    for (const rel of Array.from(sheetRelsDoc.querySelectorAll('Relationship'))) {
      if (!(rel.getAttribute('Type') || '').endsWith('/drawing')) continue
      const drawingName = (rel.getAttribute('Target') || '').split('/').pop()
      const drawingFile = zip.files[`xl/drawings/${drawingName}`]
      if (!drawingFile) continue

      const drawingDoc = new DOMParser().parseFromString(drawingFile.asText(), 'text/xml')
      for (const fromEl of Array.from(drawingDoc.querySelectorAll('from'))) {
        const col = parseInt(fromEl.querySelector('col')?.textContent ?? '-1', 10)
        const row = parseInt(fromEl.querySelector('row')?.textContent ?? '-1', 10)
        if (col >= 0 && row >= 0) anchors.get(sheetName).add(`${col},${row}`)
      }
    }
  }

  return anchors
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ html: string, binary: ArrayBuffer }}
 */
export function renderXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const imageAnchors = buildImageAnchors(buffer, wb.SheetNames)

  let html = ''
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    html += `<h3>${escapeHtml(sheetName)}</h3>`
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
    let table = '<table>'
    for (let r = range.s.r; r <= range.e.r; r++) {
      table += '<tr>'
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c })
        const fullAddr = `${sheetName}!${cellRef}`
        const isImage = imageAnchors.get(sheetName)?.has(`${c},${r}`)
        if (isImage) {
          table += `<td data-cell-address="${escapeHtml(fullAddr)}" data-image-placeholder="true"><span>[Image]</span></td>`
        } else {
          const cell = ws[cellRef]
          const value = cell != null ? escapeHtml(String(cell.v ?? '')) : ''
          table += `<td data-cell-address="${escapeHtml(fullAddr)}">${value}</td>`
        }
      }
      table += '</tr>'
    }
    table += '</table>'
    html += table
  }

  return { html, binary: buffer }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/test/lib/renderers/xlsx.test.js
```

Expected: all 6 tests pass (5 existing + 1 new).

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/renderers/xlsx.js src/test/lib/renderers/xlsx.test.js
git commit -m "feat: show image placeholders for embedded images in Excel preview"
```

---

## Task 4: Excel binary preservation (rewrite insertXlsx)

**Files:**
- Modify: `src/lib/fieldEditor.js` (`insertXlsx` function only)
- Modify: `src/test/lib/fieldEditor.test.js`

**Background:** The current `insertXlsx` calls `XLSX.write()` which rebuilds the zip from scratch and drops all `xl/drawings/` and `xl/media/` entries. The fix opens the zip with PizZip, resolves the target sheet via `xl/workbook.xml` → rels, surgically modifies only the sheet XML and shared-strings table, and writes everything else back untouched. All existing tests pass because `XLSX.write`-built fixtures have rels files and shared strings that the new code handles via the two-step lookup.

- [ ] **Step 1: Add the failing test to `src/test/lib/fieldEditor.test.js`**

Add this helper and test at the end of the `describe('insertXlsx', ...)` block:

```js
// Build a complete XLSX zip (via PizZip, not XLSX.write) that includes a drawings entry.
function buildXlsxWithDrawingPizZip() {
  const SS_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const zip = new PizZip()
  zip.file('xl/workbook.xml',
    `<?xml version="1.0"?><workbook xmlns="${SS_NS}" xmlns:r="${R_NS}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="${PKG_NS}"><Relationship Id="rId1" Type="${R_NS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
  zip.file('xl/worksheets/sheet1.xml',
    `<?xml version="1.0"?><worksheet xmlns="${SS_NS}"><sheetData><row r="1"><c r="B1" t="s"><v>0</v></c></row></sheetData></worksheet>`)
  zip.file('xl/sharedStrings.xml',
    `<?xml version="1.0"?><sst xmlns="${SS_NS}" count="1" uniqueCount="1"><si><t>original</t></si></sst>`)
  zip.file('xl/drawings/drawing1.xml',
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>`)
  return zip.generate({ type: 'arraybuffer' })
}

it('preserves xl/drawings/ entries after insertXlsx', () => {
  const binary = buildXlsxWithDrawingPizZip()
  const result = insertXlsx(binary, 'Sheet1!B1', 'ContractValue')
  expect(result.error).toBeUndefined()
  const outZip = new PizZip(result.binary)
  expect(outZip.files['xl/drawings/drawing1.xml']).toBeDefined()
})
```

- [ ] **Step 2: Run to confirm test fails**

```bash
npx vitest run src/test/lib/fieldEditor.test.js
```

Expected: the new test FAILS — drawings entry is dropped by the current `XLSX.write` implementation.

- [ ] **Step 3: Rewrite `insertXlsx` in `src/lib/fieldEditor.js`**

Two edits to this file:
1. **Remove the now-unused import** on line 2: delete `import * as _XLSX from 'xlsx'` (the new implementation does not use SheetJS at all).
2. **Replace only the `insertXlsx` function** (lines 151–166). Keep `insertDocx` and the `import PizZip from 'pizzip'` import unchanged.

```js
/**
 * Insert {{fieldName}} into an XLSX binary at the specified cell using PizZip
 * zip surgery. Preserves all zip entries (drawings, media, styles) untouched.
 * @param {ArrayBuffer} binary
 * @param {string} cellAddress — format "SheetName!ColRow" e.g. "Sheet1!B3"
 * @param {string} fieldName
 * @returns {{ binary: ArrayBuffer } | { error: string }}
 */
export function insertXlsx(binary, cellAddress, fieldName) {
  const bangIdx = cellAddress.indexOf('!')
  if (bangIdx === -1) return { error: 'invalid_cell_address' }

  const sheetName = cellAddress.slice(0, bangIdx)
  const cellRef = cellAddress.slice(bangIdx + 1)

  const zip = new PizZip(binary)

  // --- Step 1: Confirm sheet exists in workbook.xml ---
  const wbFile = zip.files['xl/workbook.xml']
  if (!wbFile) return { error: 'sheet_not_found' }

  const wbDoc = new DOMParser().parseFromString(wbFile.asText(), 'text/xml')
  const sheetEl = Array.from(wbDoc.querySelectorAll('sheet'))
    .find(el => el.getAttribute('name') === sheetName)
  if (!sheetEl) return { error: 'sheet_not_found' }

  // --- Step 2: Resolve sheet file path ---
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const rId = sheetEl.getAttributeNS(R_NS, 'id') || sheetEl.getAttribute('r:id')

  let sheetFilePath = null
  const wbRelsFile = zip.files['xl/_rels/workbook.xml.rels']
  if (wbRelsFile) {
    const relsDoc = new DOMParser().parseFromString(wbRelsFile.asText(), 'text/xml')
    const rel = Array.from(relsDoc.querySelectorAll('Relationship'))
      .find(r => r.getAttribute('Id') === rId)
    if (rel) sheetFilePath = `xl/${rel.getAttribute('Target')}`
  }
  // Fallback: first sheet*.xml in xl/worksheets/
  if (!sheetFilePath || !zip.files[sheetFilePath]) {
    sheetFilePath = Object.keys(zip.files)
      .find(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)) ?? null
  }
  if (!sheetFilePath || !zip.files[sheetFilePath]) return { error: 'sheet_not_found' }

  // --- Step 3: Modify sheet XML and shared strings ---
  const SS_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const sheetDoc = new DOMParser().parseFromString(
    zip.files[sheetFilePath].asText(), 'text/xml'
  )

  // Helper: find or create a <c r="cellRef"> element inside the sheet
  function getOrCreateCell(doc, ref) {
    for (const c of Array.from(doc.getElementsByTagNameNS(SS_NS, 'c'))) {
      if (c.getAttribute('r') === ref) return c
    }
    const rowNum = ref.match(/\d+$/)[0]
    let rowEl = Array.from(doc.getElementsByTagNameNS(SS_NS, 'row'))
      .find(r => r.getAttribute('r') === rowNum)
    if (!rowEl) {
      const sheetData = doc.getElementsByTagNameNS(SS_NS, 'sheetData')[0]
      rowEl = doc.createElementNS(SS_NS, 'row')
      rowEl.setAttribute('r', rowNum)
      sheetData.appendChild(rowEl)
    }
    const cellEl = doc.createElementNS(SS_NS, 'c')
    cellEl.setAttribute('r', ref)
    rowEl.appendChild(cellEl)
    return cellEl
  }

  const serializer = new XMLSerializer()
  const ssFile = zip.files['xl/sharedStrings.xml']

  if (ssFile) {
    // Shared strings path: append new entry, reference it from cell
    const ssDoc = new DOMParser().parseFromString(ssFile.asText(), 'text/xml')
    const sst = ssDoc.getElementsByTagNameNS(SS_NS, 'sst')[0]
    const currentCount = parseInt(sst.getAttribute('uniqueCount') || '0', 10)
    const newSi = ssDoc.createElementNS(SS_NS, 'si')
    const newT = ssDoc.createElementNS(SS_NS, 't')
    newT.textContent = `{{${fieldName}}}`
    newSi.appendChild(newT)
    sst.appendChild(newSi)
    sst.setAttribute('uniqueCount', String(currentCount + 1))
    sst.setAttribute('count', String(currentCount + 1))

    const cellEl = getOrCreateCell(sheetDoc, cellRef)
    while (cellEl.firstChild) cellEl.removeChild(cellEl.firstChild)
    cellEl.setAttribute('t', 's')
    const vEl = sheetDoc.createElementNS(SS_NS, 'v')
    vEl.textContent = String(currentCount) // 0-based index of the new entry
    cellEl.appendChild(vEl)

    zip.file(sheetFilePath, serializer.serializeToString(sheetDoc))
    zip.file('xl/sharedStrings.xml', serializer.serializeToString(ssDoc))
  } else {
    // Inline string path (no shared strings table)
    const cellEl = getOrCreateCell(sheetDoc, cellRef)
    while (cellEl.firstChild) cellEl.removeChild(cellEl.firstChild)
    cellEl.setAttribute('t', 'inlineStr')
    const isEl = sheetDoc.createElementNS(SS_NS, 'is')
    const tEl = sheetDoc.createElementNS(SS_NS, 't')
    tEl.textContent = `{{${fieldName}}}`
    isEl.appendChild(tEl)
    cellEl.appendChild(isEl)

    zip.file(sheetFilePath, serializer.serializeToString(sheetDoc))
  }

  return { binary: zip.generate({ type: 'arraybuffer' }) }
}
```

- [ ] **Step 4: Run fieldEditor tests**

```bash
npx vitest run src/test/lib/fieldEditor.test.js
```

Expected: all tests pass (existing 4 insertXlsx tests + 1 new drawing-preservation test + all insertDocx tests).

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fieldEditor.js src/test/lib/fieldEditor.test.js
git commit -m "feat: rewrite insertXlsx with PizZip surgery to preserve images and drawings"
```

---

## Task 5: Fix Gemini reliability + Review error handling

**Files:**
- Modify: `src/lib/gemini.js`
- Modify: `src/pages/Review.jsx`
- Modify: `src/test/lib/gemini.test.js`
- Modify: `src/test/pages/Review.test.jsx`

**Background:** Three sub-fixes in one commit (they must land together or CI breaks):
1. `gemini.js`: fix model name `'gemini-flash-latest'` → `'gemini-2.0-flash'`; replace `try/catch { return null }` with `Promise.race` timeout that throws; remove silent swallow so errors propagate.
2. `Review.jsx`: wrap `suggestFieldName` call in try/catch *inside* `openSuggestion` so the popover transitions to `ready` with an error message instead of freezing on `loading`.
3. Tests: replace the old null-return API-error test with a throws test; add timeout test; add Review error-path test.

- [ ] **Step 1: Update `src/test/lib/gemini.test.js`**

**Delete** lines 116–120 entirely — this is the test that currently reads:

```js
  it('returns null when API call throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Network error'))
    const result = await suggestFieldName('key', 'text', 'ctx', [])
    expect(result).toBeNull()
  })
```

**Replace** those 5 lines with these two new tests (insert at the same position — after the `'returns null when AI response fails validation'` test and before the `'returns null when response is empty string'` test):

```js
  it('throws when API call fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Network error'))
    await expect(suggestFieldName('key', 'text', 'ctx', [])).rejects.toThrow('Network error')
  })

  it('throws after 10 seconds without a response', async () => {
    vi.useFakeTimers()
    mockGenerateContent.mockReturnValue(new Promise(() => {})) // never resolves
    const promise = suggestFieldName('key', 'text', 'ctx', [])
    vi.advanceTimersByTime(10_001)
    await expect(promise).rejects.toThrow('timeout')
    vi.useRealTimers()
  })
```

Leave the `'returns null when response is empty string'` test (lines 122–126) **unchanged** — that path returns `null` due to regex mismatch, not an error, and is unaffected by this change.

- [ ] **Step 2: Run gemini tests to confirm new tests fail**

```bash
npx vitest run src/test/lib/gemini.test.js
```

Expected: the two new tests FAIL — `suggestFieldName` still returns null instead of throwing.

- [ ] **Step 3: Add the Review.test.jsx test**

Add inside `describe('Review — DOCX', ...)` in `src/test/pages/Review.test.jsx`:

```js
it('shows fallback error in popover when AI suggestion fails', async () => {
  gemini.suggestFieldName.mockRejectedValue(new Error('Network error'))
  render(<Review {...DOCX_PROPS} />)
  const viewer = document.querySelector('[data-testid="doc-viewer"]')
  const para = viewer.querySelector('p')

  mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
  await act(async () => { fireEvent.mouseUp(viewer) })

  await waitFor(() =>
    expect(screen.getByText(/AI suggestion failed/i)).toBeInTheDocument()
  )
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})
```

- [ ] **Step 4: Run Review tests to confirm new test fails**

```bash
npx vitest run src/test/pages/Review.test.jsx
```

Expected: the new test FAILS — popover stays frozen on `loading`.

- [ ] **Step 5: Fix `src/lib/gemini.js`**

Change line 3: `const MODEL = 'gemini-2.0-flash'`

Replace the `suggestFieldName` function (lines 69–81):

```js
export async function suggestFieldName(apiKey, selectedText, surroundingContext, existingFields) {
  const prompt = `The following text was selected from a document: "${selectedText}". The surrounding context is: "${surroundingContext}". Fields already defined: [${existingFields.join(', ')}]. Suggest a concise camelCase field name for the selected text. Return only the field name, nothing else.`

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })

  // Race the API call against a 10-second timeout
  const result = await Promise.race([
    model.generateContent(prompt),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 10_000)
    ),
  ])

  const raw = result.response.text().trim()
  if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(raw)) return raw
  return null
}
```

- [ ] **Step 6: Fix `src/pages/Review.jsx` — wrap suggestFieldName in try/catch inside openSuggestion**

Replace the `openSuggestion` `useCallback` (lines 93–98):

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

- [ ] **Step 7: Run both test files**

```bash
npx vitest run src/test/lib/gemini.test.js src/test/pages/Review.test.jsx
```

Expected: all tests pass.

- [ ] **Step 8: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit (gemini.js + Review.jsx + both test files in one commit)**

```bash
git add src/lib/gemini.js src/pages/Review.jsx src/test/lib/gemini.test.js src/test/pages/Review.test.jsx
git commit -m "fix: surface Gemini errors in popover; fix model name; add 10s timeout"
```

---

## Final verification

- [ ] **Run the full test suite one last time**

```bash
npm test
```

Expected: all tests pass, no regressions.

- [ ] **Build the extension**

```bash
npm run build
```

Expected: build succeeds with no errors. Load `dist/` in Chrome (`chrome://extensions` → Developer Mode → Load unpacked) and manually verify:
1. Upload a DOCX → Review step shows styled preview (fonts, tables preserved).
2. Upload an XLSX with embedded images → cells with images show `[Image]` placeholder.
3. Select text in DOCX → popover appears with AI suggestion (or empty field if Gemini unavailable).
4. Accept a field, save template, generate — downloaded file only replaces the token, all other content identical to original.
