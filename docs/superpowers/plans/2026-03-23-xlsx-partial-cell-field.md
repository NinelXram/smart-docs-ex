# XLSX Partial-Cell Field Definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace broken partial-text XML surgery in XLSX field definition with a Gemini-driven label/value split — Gemini identifies the static label and dynamic value, user confirms in an updated popover, and `insertXlsx` always writes the full confirmed pattern string.

**Architecture:** Add `suggestFieldPattern` to `gemini.js` (returns `{ label, value, fieldName }`). Update `Review.jsx` to branch on format: XLSX uses the new function + a two-input popover (label + field name); DOCX paths are untouched. Simplify `insertXlsx` to always write the full confirmed pattern string — all partial-detection logic is removed.

**Tech Stack:** React 18, Vitest, `@google/generative-ai`, PizZip, SheetJS (`xlsx`)

**Spec:** `docs/superpowers/specs/2026-03-23-xlsx-partial-cell-field-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/gemini.js` | Modify | Add `suggestFieldPattern` export |
| `src/lib/fieldEditor.js` | Modify | Simplify `insertXlsx` — drop partial detection, accept `pattern` arg |
| `src/pages/Review.jsx` | Modify | Branch `openSuggestion` on format; update handlers + popover JSX |
| `src/test/gemini.test.js` | Create | Unit tests for `suggestFieldPattern` |
| `src/test/fieldEditor.test.js` | Create | Unit tests for simplified `insertXlsx` |

---

## Task 1: `suggestFieldPattern` — tests

**Files:**
- Create: `src/test/gemini.test.js`

- [ ] **Step 1: Create the test file with a mock for `@google/generative-ai`**

```js
// src/test/gemini.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Gemini SDK before importing the module under test
const mockGenerateContent = vi.fn()
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      generateContent: mockGenerateContent,
    })),
  })),
}))

import { suggestFieldPattern } from '../lib/gemini.js'

const API_KEY = 'test-key'

beforeEach(() => {
  vi.clearAllMocks()
})

function mockGemini(jsonPayload) {
  mockGenerateContent.mockResolvedValueOnce({
    response: { text: () => JSON.stringify(jsonPayload) },
  })
}
```

- [ ] **Step 2: Add the happy-path test (full cell with label prefix)**

```js
describe('suggestFieldPattern', () => {
  it('returns label, value, fieldName from valid Gemini response', async () => {
    mockGemini({ label: 'Name: ', value: 'Bao Huynh', fieldName: 'name' })
    const result = await suggestFieldPattern(API_KEY, 'Name: Bao Huynh', '', [])
    expect(result).toEqual({ label: 'Name: ', value: 'Bao Huynh', fieldName: 'name' })
  })
```

- [ ] **Step 3: Add the no-label test**

```js
  it('returns empty label when Gemini finds no prefix', async () => {
    mockGemini({ label: '', value: 'Bao Huynh', fieldName: 'fullName' })
    const result = await suggestFieldPattern(API_KEY, 'Bao Huynh', '', [])
    expect(result).toEqual({ label: '', value: 'Bao Huynh', fieldName: 'fullName' })
  })
```

- [ ] **Step 4: Add the label+value mismatch fallback test**

```js
  it('falls back to label="" when label+value does not equal fullCellText', async () => {
    mockGemini({ label: 'Wrong: ', value: 'Data', fieldName: 'myField' })
    // "Wrong: " + "Data" = "Wrong: Data" ≠ "Name: Bao Huynh"
    const result = await suggestFieldPattern(API_KEY, 'Name: Bao Huynh', '', [])
    expect(result.label).toBe('')
    expect(result.value).toBe('Name: Bao Huynh')
    expect(result.fieldName).toBe('myField') // keeps the suggested name
  })
```

- [ ] **Step 5: Add the malformed JSON fallback test**

```js
  it('falls back when Gemini returns malformed JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'not json at all' },
    })
    const result = await suggestFieldPattern(API_KEY, 'Name: Bao Huynh', '', [])
    expect(result.label).toBe('')
    expect(result.value).toBe('Name: Bao Huynh')
    expect(typeof result.fieldName).toBe('string')
  })
```

- [ ] **Step 6: Add the invalid fieldName sanitization test**

```js
  it('sanitizes fieldName when it fails the regex', async () => {
    mockGemini({ label: 'Name: ', value: 'Bao Huynh', fieldName: '123-invalid!' })
    const result = await suggestFieldPattern(API_KEY, 'Name: Bao Huynh', '', [])
    expect(result.fieldName).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/)
  })
```

- [ ] **Step 7: Add the timeout test**

```js
  it('throws when Gemini call exceeds 10 seconds', async () => {
    vi.useFakeTimers()
    mockGenerateContent.mockImplementationOnce(
      () => new Promise(resolve => setTimeout(resolve, 15_000))
    )
    const promise = suggestFieldPattern(API_KEY, 'Name: Bao Huynh', '', [])
    vi.advanceTimersByTime(10_001)
    await expect(promise).rejects.toThrow()
    vi.useRealTimers()
  })

  it('includes selectedText line in prompt when provided', async () => {
    mockGemini({ label: 'Name: ', value: 'Bao Huynh', fieldName: 'name' })
    await suggestFieldPattern(API_KEY, 'Name: Bao Huynh', 'Bao Huynh', [])
    const promptArg = mockGenerateContent.mock.calls[0][0]
    expect(promptArg).toContain('User selected:')
    expect(promptArg).toContain('Bao Huynh')
  })

  it('omits selectedText line when selectedText is empty', async () => {
    mockGemini({ label: 'Name: ', value: 'Bao Huynh', fieldName: 'name' })
    await suggestFieldPattern(API_KEY, 'Name: Bao Huynh', '', [])
    const promptArg = mockGenerateContent.mock.calls[0][0]
    expect(promptArg).not.toContain('User selected:')
  })
})
```

- [ ] **Step 8: Run tests and verify they all FAIL (function does not exist yet)**

```bash
npx vitest run src/test/gemini.test.js
```

Expected: all tests fail with "suggestFieldPattern is not a function" or similar import error.

---

## Task 2: `suggestFieldPattern` — implementation

**Files:**
- Modify: `src/lib/gemini.js`

- [ ] **Step 1: Add `suggestFieldPattern` to `src/lib/gemini.js`**

Append after `suggestFieldName` (after line 80):

```js
/**
 * Ask Gemini to identify the static label prefix and dynamic value in a cell.
 * Returns { label, value, fieldName }.
 * Throws on timeout or unrecoverable error (caller shows manual-entry popover).
 * @param {string} apiKey
 * @param {string} fullCellText
 * @param {string} selectedText — empty string if no text selected (cell click)
 * @param {string[]} existingFields
 * @returns {Promise<{ label: string, value: string, fieldName: string }>}
 */
export async function suggestFieldPattern(apiKey, fullCellText, selectedText, existingFields) {
  const selectedLine = selectedText
    ? `User selected: "${selectedText}"\n`
    : ''
  const existingLine = existingFields.length
    ? `Existing field names: [${existingFields.join(', ')}]\n`
    : ''

  const prompt =
    `You are analyzing a spreadsheet cell for document templating.\n` +
    `Cell content: "${fullCellText}"\n` +
    selectedLine +
    existingLine +
    `Identify:\n` +
    `- label: the static prefix to preserve (empty string if none)\n` +
    `- value: the dynamic portion to replace with a template field\n` +
    `- fieldName: a short camelCase name (must not match existing names)\n\n` +
    `Respond with JSON only: {"label": "...", "value": "...", "fieldName": "..."}\n\n` +
    `Rules:\n` +
    `- label + value must equal the full cell content exactly\n` +
    `- fieldName must match ^[a-zA-Z][a-zA-Z0-9_]*$\n` +
    `- If no label prefix exists, return label as ""`

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })
  const raw = await Promise.race([
    model.generateContent(prompt),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
  ])
  const text = raw.response.text().trim()

  return _parseFieldPattern(text, fullCellText)
}

function _parseFieldPattern(text, fullCellText) {
  let parsed
  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return { label: '', value: fullCellText, fieldName: _sanitizeFieldName('') }
  }

  const { label = '', value = '', fieldName = '' } = parsed

  // Validate constraint: label + value must reconstruct fullCellText
  const resolvedLabel = (label + value === fullCellText) ? label : ''
  const resolvedValue = (label + value === fullCellText) ? value : fullCellText

  return {
    label: resolvedLabel,
    value: resolvedValue,
    fieldName: _sanitizeFieldName(String(fieldName)),
  }
}

function _sanitizeFieldName(raw) {
  // Strip characters not in [a-zA-Z0-9_], then ensure starts with a letter
  let name = raw.replace(/[^a-zA-Z0-9_]/g, '')
  if (/^\d/.test(name)) name = 'field' + name
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) ? name : 'field'
}
```

- [ ] **Step 2: Run tests and verify they all PASS**

```bash
npx vitest run src/test/gemini.test.js
```

Expected: all 8 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/gemini.js src/test/gemini.test.js
git commit -m "feat: add suggestFieldPattern to gemini.js"
```

---

## Task 3: Simplify `insertXlsx` — tests

**Files:**
- Create: `src/test/fieldEditor.test.js`

- [ ] **Step 1: Create the test file with a helper to build and read XLSX binaries**

```js
// src/test/fieldEditor.test.js
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { insertXlsx } from '../lib/fieldEditor.js'

// Build a minimal XLSX binary with a single string cell at A1
function makeBinary(cellValue) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([[cellValue]])
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return buf instanceof ArrayBuffer ? buf : buf.buffer
}

// Read a cell value back from a binary
function readCell(binary, addr) {
  const wb = XLSX.read(binary, { type: 'array' })
  const [sheet, ref] = addr.split('!')
  return wb.Sheets[sheet]?.[ref]?.v ?? null
}
```

- [ ] **Step 2: Add test — full-cell token (no label)**

```js
describe('insertXlsx', () => {
  it('writes pattern as full cell content when pattern is just a token', () => {
    const binary = makeBinary('Bao Huynh')
    const result = insertXlsx(binary, 'Sheet1!A1', 'name', '{{name}}')
    expect(result.error).toBeUndefined()
    expect(readCell(result.binary, 'Sheet1!A1')).toBe('{{name}}')
  })
```

- [ ] **Step 3: Add test — pattern with label prefix**

```js
  it('writes pattern preserving label prefix', () => {
    const binary = makeBinary('Name: Bao Huynh')
    const result = insertXlsx(binary, 'Sheet1!A1', 'name', 'Name: {{name}}')
    expect(result.error).toBeUndefined()
    expect(readCell(result.binary, 'Sheet1!A1')).toBe('Name: {{name}}')
  })
```

- [ ] **Step 4: Add test — error when cell not found**

```js
  it('returns error when cell address does not exist in sheet', () => {
    const binary = makeBinary('hello')
    const result = insertXlsx(binary, 'Sheet1!Z99', 'name', '{{name}}')
    expect(result.error).toBe('cell_not_found')
  })
```

- [ ] **Step 5: Add test — overwrites existing cell value**

```js
  it('overwrites previous cell content with new pattern', () => {
    const binary = makeBinary('old value')
    const result = insertXlsx(binary, 'Sheet1!A1', 'name', 'Label: {{name}}')
    expect(readCell(result.binary, 'Sheet1!A1')).toBe('Label: {{name}}')
  })
})
```

- [ ] **Step 6: Run tests — confirm they FAIL (red step)**

```bash
npx vitest run src/test/fieldEditor.test.js
```

Expected: tests FAIL. The current `insertXlsx` treats the 4th argument as `selectedText` (partial-detection logic), not as a full `pattern` to write verbatim. Some tests may accidentally produce the right output via the fallback path — if they pass, note which ones so you can verify the new implementation actually exercises the simplified path in Task 4. The goal here is to establish the baseline before the refactor.

---

## Task 4: Simplify `insertXlsx` — implementation

**Files:**
- Modify: `src/lib/fieldEditor.js` (lines 177–313)

- [ ] **Step 1: Replace the entire `insertXlsx` function**

Find the function starting at `export function insertXlsx(binary, cellAddress, fieldName, selectedText) {` and replace the complete function body with the simplified version:

```js
/**
 * Insert a confirmed pattern string into an XLSX cell.
 * pattern is the full new cell content, e.g. "Name: {{fieldName}}".
 * @param {ArrayBuffer} binary
 * @param {string} cellAddress — "SheetName!ColRow" e.g. "Sheet1!B3"
 * @param {string} fieldName — used only to detect already-inserted tokens (not for logic)
 * @param {string} pattern — full cell content to write, e.g. "Name: {{name}}"
 * @returns {{ binary: ArrayBuffer } | { error: string }}
 */
export function insertXlsx(binary, cellAddress, fieldName, pattern) {
  const bangIdx = cellAddress.indexOf('!')
  if (bangIdx === -1) return { error: 'invalid_cell_address' }
  const sheetName = cellAddress.slice(0, bangIdx)
  const cellRef = cellAddress.slice(bangIdx + 1)

  let zip
  try {
    zip = new PizZip(binary)
  } catch {
    return { error: 'invalid_binary' }
  }

  const parser = new DOMParser()

  // Step 1: Find sheet path via workbook.xml.rels
  const wbXml = zip.files['xl/workbook.xml']?.asText()
  if (!wbXml) return { error: 'sheet_not_found' }
  const wbDoc = parser.parseFromString(wbXml, 'application/xml')
  const sheetEl = Array.from(wbDoc.getElementsByTagName('sheet'))
    .find(el => el.getAttribute('name') === sheetName)
  if (!sheetEl) return { error: 'sheet_not_found' }
  const rId = sheetEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')

  let sheetPath = null
  const wbRelsXml = zip.files['xl/_rels/workbook.xml.rels']?.asText()
  if (wbRelsXml) {
    const relsDoc = parser.parseFromString(wbRelsXml, 'application/xml')
    const rel = Array.from(relsDoc.getElementsByTagName('Relationship'))
      .find(r => r.getAttribute('Id') === rId)
    if (rel) sheetPath = `xl/${rel.getAttribute('Target')}`
  }
  if (!sheetPath) {
    const found = Object.keys(zip.files)
      .filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
      .sort()[0]
    if (!found) return { error: 'sheet_not_found' }
    sheetPath = found
  }

  // Step 2: Find target cell
  const sheetXml = zip.files[sheetPath]?.asText()
  if (!sheetXml) return { error: 'sheet_not_found' }
  const sheetDoc = parser.parseFromString(sheetXml, 'application/xml')
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const targetCell = Array.from(sheetDoc.getElementsByTagNameNS(ns, 'c'))
    .find(c => c.getAttribute('r') === cellRef)
  if (!targetCell) return { error: 'cell_not_found' }

  // Step 3: Write pattern as new shared string (or inline string if no sst)
  const ssPath = 'xl/sharedStrings.xml'
  const ssXml = zip.files[ssPath]?.asText()

  if (ssXml) {
    // Parse shared strings to get the correct next index via DOM (regex counting is unreliable)
    const ssDoc = parser.parseFromString(ssXml, 'application/xml')
    const siEls = Array.from(ssDoc.getElementsByTagNameNS(ns, 'si'))
    const newIndex = siEls.length

    // String-based append to avoid XMLSerializer namespace redundancy
    const newSiXml = `<si><t xml:space="preserve">${escapeXml(pattern)}</t></si>`
    const closingTag = '</sst>'
    const insertPos = ssXml.lastIndexOf(closingTag)
    if (insertPos === -1) return { error: 'corrupt_shared_strings' }

    // Increment count (total references) and uniqueCount (distinct entries) independently
    let updatedSsXml = ssXml.slice(0, insertPos) + newSiXml + ssXml.slice(insertPos)
    updatedSsXml = updatedSsXml
      .replace(/\bcount="(\d+)"/, (_, n) => `count="${parseInt(n, 10) + 1}"`)
      .replace(/\buniqueCount="(\d+)"/, (_, n) => `uniqueCount="${parseInt(n, 10) + 1}"`)
    zip.file(ssPath, updatedSsXml, { compression: 'DEFLATE' })

    // Point cell to new shared string index
    while (targetCell.firstChild) targetCell.removeChild(targetCell.firstChild)
    targetCell.setAttribute('t', 's')
    const vEl = sheetDoc.createElementNS(ns, 'v')
    vEl.textContent = String(newIndex)
    targetCell.appendChild(vEl)
  } else {
    // No shared strings — use inline string
    while (targetCell.firstChild) targetCell.removeChild(targetCell.firstChild)
    targetCell.setAttribute('t', 'inlineStr')
    const isEl = sheetDoc.createElementNS(ns, 'is')
    const tEl = sheetDoc.createElementNS(ns, 't')
    tEl.textContent = pattern
    tEl.setAttribute('xml:space', 'preserve')
    isEl.appendChild(tEl)
    targetCell.appendChild(isEl)
  }

  zip.file(sheetPath, new XMLSerializer().serializeToString(sheetDoc), { compression: 'DEFLATE' })
  return { binary: zip.generate({ type: 'arraybuffer', compression: 'DEFLATE' }) }
}
```

- [ ] **Step 2: Run fieldEditor tests — all 4 must PASS**

```bash
npx vitest run src/test/fieldEditor.test.js
```

Expected: 4 tests PASS.

- [ ] **Step 3: Run full test suite — no regressions**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/fieldEditor.js src/test/fieldEditor.test.js
git commit -m "refactor: simplify insertXlsx — always writes full pattern, no partial detection"
```

---

## Task 5: Update `Review.jsx` — handlers

**Files:**
- Modify: `src/pages/Review.jsx`

The changes below are made in sequence within the same file. Read the current file before editing.

- [ ] **Step 1: Add `suggestFieldPattern` to the import line**

Find:
```js
import { suggestFieldName } from '../lib/gemini.js'
```
Replace with:
```js
import { suggestFieldName, suggestFieldPattern } from '../lib/gemini.js'
```

- [ ] **Step 2: Update `openSuggestion` to branch on `format`**

Find the `openSuggestion` callback (lines ~85-96). Replace its body:

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
      const suggested = await suggestFieldName(apiKey, selectedText, surroundingContext, fields)
      setPopover(prev => prev ? { ...prev, state: 'ready', label: '', fieldName: suggested ?? '' } : null)
    }
  } catch {
    setPopover(prev => prev
      ? { ...prev, state: 'ready', label: '', fieldName: '', errorMsg: 'AI suggestion failed — enter values manually' }
      : null)
  }
}, [apiKey, fields, format])
```

- [ ] **Step 3: Update `handleMouseUp` XLSX branch — collect `fullCellText`, update `pendingData` shape**

Find the XLSX branch inside `handleMouseUp` (lines ~125-135). Replace it:

```js
    } else if (format === 'xlsx') {
      const anchorCell = sel.anchorNode?.parentElement?.closest('td[data-cell-address]') ?? null
      const focusCell = sel.focusNode?.parentElement?.closest('td[data-cell-address]') ?? null
      if (!anchorCell || anchorCell !== focusCell) return

      const cellAddress = anchorCell.dataset.cellAddress
      const fullCellText = anchorCell.textContent.trim()
      const surroundingContext = getXlsxContext(anchorCell)
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      await openSuggestion(selectedText, surroundingContext, { cellAddress, fullCellText }, { top: rect.bottom + 8, left: rect.left })
    }
```

- [ ] **Step 4: Update `handleClick` XLSX branch — pass `''` as selectedText, update pendingData, retain guard**

Find `handleClick` (lines ~138-156). Replace the inner body:

```js
  const handleClick = useCallback(async e => {
    if (format !== 'xlsx') return
    const td = e.target.closest('td[data-cell-address]')
    if (!td) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return

    const cellAddress = td.dataset.cellAddress
    const fullCellText = td.textContent.trim()

    if (/^\{\{.+\}\}$/.test(fullCellText)) {
      setPopover({ state: 'ready', label: '', fieldName: '', errorMsg: 'This cell is already a field', position: { top: 80, left: 50 } })
      return
    }

    const surroundingContext = getXlsxContext(td)
    const rect = td.getBoundingClientRect()
    await openSuggestion('', surroundingContext, { cellAddress, fullCellText }, { top: rect.bottom + 8, left: rect.left })
  }, [format, openSuggestion])
```

- [ ] **Step 5: Update `handleAccept` XLSX branch — build `pattern`, use new `insertXlsx` signature**

Find `handleAccept` (lines ~158-202). Replace the format-branched section inside the try block:

```js
      let result
      if (format === 'docx') {
        const { selectedText, paragraphIndex } = pendingRef.current
        result = insertDocx(binary, selectedText, paragraphIndex, fieldName)
      } else {
        const { cellAddress } = pendingRef.current
        const pattern = (popover.label ?? '') + `{{${fieldName}}}`
        result = insertXlsx(binary, cellAddress, fieldName, pattern)
        // Note: renderXlsx is synchronous — no await needed below
      }
```

- [ ] **Step 6: Run existing tests — no regressions**

```bash
npm test
```

Expected: all tests PASS. (Review.jsx changes are logic-only; no new tests at this step.)

- [ ] **Step 7: Commit**

```bash
git add src/pages/Review.jsx
git commit -m "feat: update Review.jsx handlers for Gemini-driven XLSX field pattern"
```

---

## Task 6: Update `Review.jsx` — popover JSX

**Files:**
- Modify: `src/pages/Review.jsx`

- [ ] **Step 1: Update the popover JSX to show the label input and preview for XLSX**

Find the popover `ready` state render block (the `<>` block after `popover.state === 'loading'` check, lines ~299-332). Replace the inner content with a format-aware version:

```jsx
            <>
              {format === 'xlsx' && (
                <>
                  <label className="text-xs text-gray-400 block mb-1">
                    Label (preserved)
                  </label>
                  <input
                    value={popover.label ?? ''}
                    onChange={e => setPopover(prev => ({ ...prev, label: e.target.value, errorMsg: '' }))}
                    onKeyDown={e => { if (e.key === 'Escape') setPopover(null) }}
                    placeholder="e.g. Name: "
                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 mb-2"
                  />
                </>
              )}
              <label htmlFor="field-name-input" className="text-xs text-gray-400 block mb-1">
                Field name
              </label>
              <input
                id="field-name-input"
                autoFocus
                value={popover.fieldName}
                onChange={e => setPopover(prev => ({ ...prev, fieldName: e.target.value, errorMsg: '' }))}
                onKeyDown={e => { if (e.key === 'Enter') handleAccept(); if (e.key === 'Escape') setPopover(null) }}
                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 mb-2"
              />
              {format === 'xlsx' && (popover.label || popover.fieldName) && (
                <p className="text-xs text-gray-500 mb-2 font-mono">
                  {popover.label ?? ''}<span className="text-blue-400">{`{{${popover.fieldName || '…'}}}`}</span>
                </p>
              )}
              {popover.errorMsg && (
                <p className="text-xs text-red-400 mb-2">{popover.errorMsg}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleAccept}
                  className="flex-1 text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded"
                >
                  Accept
                </button>
                <button
                  onClick={() => setPopover(null)}
                  className="text-xs text-gray-400 hover:text-white px-2 py-1"
                >
                  Dismiss
                </button>
              </div>
            </>
```

- [ ] **Step 2: Update the XLSX hint text in the format banner**

Find the banner (lines ~262-267):
```jsx
      <span className="font-medium text-gray-300">Click</span> a cell to make it a field,
      or <span className="font-medium text-gray-300">select text within a cell</span> to replace only that portion (preserves the label).
```
Replace with:
```jsx
      <span className="font-medium text-gray-300">Click</span> a cell — AI will identify the label and value.
      <span className="font-medium text-gray-300"> Select text</span> to hint which part is the value.
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Build to check for JSX errors**

```bash
npm run build
```

Expected: build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Review.jsx
git commit -m "feat: update XLSX popover with label input and live preview"
```

---

## Task 7: Confirm no stale code remains

**Files:**
- Check: `src/lib/fieldEditor.js`
- No changes needed: `src/lib/templateEngine.js`

`templateEngine.js` is already in the correct production state — its `generateXlsx` function uses `Array.from(tEls).map(t => t.textContent).join('')` which is correct and intentional. Do not change it.

- [ ] **Step 1: Verify `insertXlsx` has no leftover partial-detection code**

Open `src/lib/fieldEditor.js`. After Task 4's replacement, confirm the function body contains no reference to `selectedText` (as a partial-detection variable), `includes(`, or `currentText`. The `fieldName` parameter still appears in the JSDoc comment — that is fine.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit if any stale code was removed**

```bash
git add src/lib/fieldEditor.js
git commit -m "chore: confirm no stale partial-detection code in insertXlsx"
```

---

## Task 8: Integration tests for Review.jsx XLSX flow

**Files:**
- Create: `src/test/Review.xlsx.test.jsx`

These tests mount the `Review` component with a minimal XLSX binary and mock `suggestFieldPattern` to verify the full cell-click → popover → accept → re-render flow.

- [ ] **Step 1: Create the integration test file**

```jsx
// src/test/Review.xlsx.test.jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import * as XLSX from 'xlsx'

vi.mock('../lib/gemini.js', () => ({
  suggestFieldName: vi.fn(),
  suggestFieldPattern: vi.fn(),
}))
vi.mock('../lib/storage.js', () => ({ saveTemplate: vi.fn() }))

import Review from '../pages/Review.jsx'
import { suggestFieldPattern } from '../lib/gemini.js'

function makeBinary(data) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(data)
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return buf instanceof ArrayBuffer ? buf : buf.buffer
}

function baseProps(overrides = {}) {
  return {
    html: '<table><tr><td data-cell-address="Sheet1!A1">Name: Bao Huynh</td></tr></table>',
    binary: makeBinary([['Name: Bao Huynh']]),
    format: 'xlsx',
    fileName: 'test.xlsx',
    fields: [],
    apiKey: 'test-key',
    onSave: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  }
}
```

- [ ] **Step 2: Add test — cell click → popover prefills label + fieldName from Gemini**

```jsx
describe('Review XLSX — cell click flow', () => {
  it('opens popover with Gemini-suggested label and fieldName on cell click', async () => {
    suggestFieldPattern.mockResolvedValueOnce({ label: 'Name: ', value: 'Bao Huynh', fieldName: 'name' })
    render(<Review {...baseProps()} />)

    const cell = screen.getByText('Name: Bao Huynh')
    fireEvent.click(cell)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Name: ')).toBeInTheDocument()  // label input
    expect(screen.getByDisplayValue('name')).toBeInTheDocument()    // fieldName input
  })
```

- [ ] **Step 3: Add test — Gemini failure → popover opens with empty inputs**

```jsx
  it('opens popover with empty inputs when Gemini call fails', async () => {
    suggestFieldPattern.mockRejectedValueOnce(new Error('timeout'))
    render(<Review {...baseProps()} />)

    fireEvent.click(screen.getByText('Name: Bao Huynh'))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    // Both inputs should be empty — user fills manually
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.some(i => i.value === '')).toBe(true)
  })
```

- [ ] **Step 4: Add test — accept adds field to fields list**

```jsx
  it('adds fieldName to fields list after accepting', async () => {
    suggestFieldPattern.mockResolvedValueOnce({ label: 'Name: ', value: 'Bao Huynh', fieldName: 'name' })
    const props = baseProps()
    render(<Review {...props} />)

    fireEvent.click(screen.getByText('Name: Bao Huynh'))
    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Header shows 1 field
    expect(screen.getByText(/1 field/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run these integration tests — they should FAIL (Review not yet updated)**

```bash
npx vitest run src/test/Review.xlsx.test.jsx
```

Expected: FAIL (popover not rendered with label input yet — Tasks 5 & 6 haven't run).

- [ ] **Step 6: After Tasks 5 & 6 complete, re-run integration tests — all must PASS**

```bash
npx vitest run src/test/Review.xlsx.test.jsx
```

Expected: all 3 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/test/Review.xlsx.test.jsx
git commit -m "test: add Review XLSX integration tests for Gemini-driven field pattern flow"
```

---

## Final Verification

- [ ] Run the complete test suite one last time

```bash
npm test
```

Expected: all tests PASS with no skips.

- [ ] Build for production

```bash
npm run build
```

Expected: clean build, no TypeScript/JSX errors, output in `dist/`.
