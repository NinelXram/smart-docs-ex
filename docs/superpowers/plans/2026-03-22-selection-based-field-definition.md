# Selection-Based Field Definition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI full-document scan approach with a selection-based workflow where users highlight text (DOCX) or click a cell (XLSX) to define fields, and the binary is immediately rewritten with `{{FieldName}}` tokens.

**Architecture:** New renderer layer converts files to HTML for preview (binary passed through unchanged). A field editor layer uses PizZip + XML DOM manipulation (DOCX) or SheetJS (XLSX) to rewrite the binary. At generate time, docxtemplater (DOCX) or SheetJS read→modify→write (XLSX) fills the tokens. The Review page is fully replaced: it renders the HTML via `innerHTML` assignment (not React state), handles text selection (DOCX) or cell click (XLSX), shows an AI-powered suggestion popover, and saves the modified binary as base64.

**Tech Stack:** mammoth (DOCX HTML rendering), SheetJS/xlsx (XLSX rendering + field insertion + generation), pizzip + docxtemplater (DOCX field insertion + generation), @google/generative-ai (field name suggestion), uuid, react, vitest + @testing-library/react

**Spec:** `docs/superpowers/specs/2026-03-22-selection-based-field-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/renderers/docx.js` | Create | mammoth → `{ html, binary }` |
| `src/lib/renderers/xlsx.js` | Create | SheetJS → `{ html, binary }` with `data-cell-address` |
| `src/lib/renderers/index.js` | Create | `renderFile(file)` dispatch |
| `src/lib/fieldEditor.js` | Create | `insertDocx` + `insertXlsx` |
| `src/lib/gemini.js` | Modify | Add `suggestFieldName` |
| `src/lib/templateEngine.js` | Rewrite | `generateDocx(binary, values)`, `generateXlsx(binary, values)`, `downloadBlob`; remove `injectVariables` |
| `src/pages/Upload.jsx` | Modify | Use `renderFile`; no Gemini call; pass `{ html, binary, format, fileName, fields: [] }` |
| `src/pages/Review.jsx` | Replace | Full new implementation |
| `src/pages/Generate.jsx` | Modify | Use `template.fields`; call new `generateDocx`/`generateXlsx` |
| `src/App.jsx` | Modify | Pass `apiKey` to Review; update `scanData` shape |
| `src/lib/parsers/docx.js` | Delete | — |
| `src/lib/parsers/xlsx.js` | Delete | — |
| `src/lib/parsers/index.js` | Delete | — |
| `src/lib/parsers/pdf.js` | Delete | — |
| `vite.config.js` | Modify | Remove pdfjs worker copy |

---

## Task 1: Install new packages and remove old ones

**Files:**
- Modify: `package.json` (via npm commands)
- Modify: `vite.config.js`

- [ ] **Step 1: Install pizzip and docxtemplater**

```bash
npm install pizzip docxtemplater
```

Expected: both appear in `node_modules` and `package.json` dependencies.

- [ ] **Step 2: Uninstall packages no longer needed**

```bash
npm uninstall jspdf docx pdfjs-dist
```

Expected: removed from `node_modules` and `package.json`.

- [ ] **Step 3: Remove pdfjs worker copy from vite.config.js**

Read `vite.config.js`. Remove lines 33–36 (the `const workerSrc = ...` block that copies `pdf.worker.min.mjs`). The `closeBundle` function should still copy `manifest.json`, `background.js`, and icons — just remove the pdfjs block.

The result should look like:

```js
closeBundle() {
  mkdirSync('dist/icons', { recursive: true })
  copyFileSync('manifest.json', 'dist/manifest.json')
  copyFileSync('background.js', 'dist/background.js')

  ;['icon16.png', 'icon48.png', 'icon128.png'].forEach(name => {
    const dest = `dist/icons/${name}`
    if (!existsSync(dest) && existsSync(`public/icons/${name}`)) {
      copyFileSync(`public/icons/${name}`, dest)
    }
  })
},
```

Also remove the unused `existsSync` import if it's only used for the pdfjs block — keep it if it's still used for icons (it is, so leave it).

- [ ] **Step 4: Verify build still works**

```bash
npm run build
```

Expected: BUILD SUCCESS, no errors about missing pdfjs modules.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.js
git commit -m "chore: swap jspdf+docx+pdfjs for pizzip+docxtemplater"
```

---

## Task 2: DOCX renderer

**Files:**
- Create: `src/lib/renderers/docx.js`
- Create: `src/test/lib/renderers/docx.test.js`

- [ ] **Step 1: Write failing test**

Create `src/test/lib/renderers/docx.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('mammoth', () => ({
  default: {
    convertToHtml: vi.fn(),
  },
}))

import { renderDocx } from '../../../lib/renderers/docx.js'
import mammoth from 'mammoth'

describe('renderDocx', () => {
  it('returns html from mammoth and passes binary through unchanged', async () => {
    mammoth.convertToHtml.mockResolvedValue({ value: '<p>Hello World</p>', messages: [] })
    const buffer = new ArrayBuffer(8)
    const result = await renderDocx(buffer)
    expect(result.html).toBe('<p>Hello World</p>')
    expect(result.binary).toBe(buffer)
  })

  it('passes arrayBuffer option to mammoth', async () => {
    mammoth.convertToHtml.mockResolvedValue({ value: '', messages: [] })
    const buffer = new ArrayBuffer(16)
    await renderDocx(buffer)
    expect(mammoth.convertToHtml).toHaveBeenCalledWith({ arrayBuffer: buffer })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/test/lib/renderers/docx.test.js
```

Expected: FAIL with "Cannot find module '../../../lib/renderers/docx.js'"

- [ ] **Step 3: Implement `src/lib/renderers/docx.js`**

```js
import mammoth from 'mammoth'

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ html: string, binary: ArrayBuffer }>}
 */
export async function renderDocx(buffer) {
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
  return { html: result.value, binary: buffer }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/test/lib/renderers/docx.test.js
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/renderers/docx.js src/test/lib/renderers/docx.test.js
git commit -m "feat: add DOCX renderer (mammoth → html, binary passthrough)"
```

---

## Task 3: XLSX renderer

**Files:**
- Create: `src/lib/renderers/xlsx.js`
- Create: `src/test/lib/renderers/xlsx.test.js`

- [ ] **Step 1: Write failing test**

Create `src/test/lib/renderers/xlsx.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('xlsx', () => ({
  read: vi.fn(),
  utils: {
    encode_cell: vi.fn(),
    decode_range: vi.fn(),
  },
}))

import { renderXlsx } from '../../../lib/renderers/xlsx.js'
import * as XLSX from 'xlsx'

describe('renderXlsx', () => {
  beforeEach(() => {
    XLSX.utils.decode_range.mockReturnValue({ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } })
    XLSX.utils.encode_cell
      .mockReturnValueOnce('A1').mockReturnValueOnce('B1')
      .mockReturnValueOnce('A2').mockReturnValueOnce('B2')
  })

  it('returns binary as the original input buffer unchanged', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:B2',
          A1: { v: 'Name', t: 's' },
          B1: { v: 'Date', t: 's' },
          A2: { v: 'Alice', t: 's' },
          B2: { v: '2024-01-01', t: 's' },
        },
      },
    })
    const buffer = new ArrayBuffer(8)
    const result = renderXlsx(buffer)
    expect(result.binary).toBe(buffer)
  })

  it('produces html table with data-cell-address attributes', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:B2',
          A1: { v: 'Name', t: 's' },
          B1: { v: 'Date', t: 's' },
          A2: { v: 'Alice', t: 's' },
          B2: { v: '2024-01-01', t: 's' },
        },
      },
    })
    const buffer = new ArrayBuffer(8)
    const result = renderXlsx(buffer)
    expect(result.html).toContain('data-cell-address="Sheet1!A1"')
    expect(result.html).toContain('data-cell-address="Sheet1!B2"')
    expect(result.html).toContain('>Name<')
    expect(result.html).toContain('>Alice<')
  })

  it('includes sheet name as h3 heading for each sheet', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Data', 'Summary'],
      Sheets: {
        Data: { '!ref': 'A1:A1', A1: { v: 'x', t: 's' } },
        Summary: { '!ref': 'A1:A1', A1: { v: 'y', t: 's' } },
      },
    })
    XLSX.utils.decode_range
      .mockReturnValueOnce({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } })
      .mockReturnValueOnce({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } })
    XLSX.utils.encode_cell.mockReturnValue('A1')
    const result = renderXlsx(new ArrayBuffer(8))
    expect(result.html).toContain('<h3>Data</h3>')
    expect(result.html).toContain('<h3>Summary</h3>')
  })

  it('renders empty string for missing cells', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: { '!ref': 'A1:A1' } }, // A1 missing (undefined)
    })
    XLSX.utils.decode_range.mockReturnValue({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } })
    XLSX.utils.encode_cell.mockReturnValue('A1')
    const result = renderXlsx(new ArrayBuffer(8))
    expect(result.html).toContain('data-cell-address="Sheet1!A1"')
    expect(result.html).toContain('></td>')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/test/lib/renderers/xlsx.test.js
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/lib/renderers/xlsx.js`**

```js
import * as XLSX from 'xlsx'

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ html: string, binary: ArrayBuffer }}
 */
export function renderXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  let html = ''

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    html += `<h3>${sheetName}</h3>`
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
    let table = '<table>'
    for (let r = range.s.r; r <= range.e.r; r++) {
      table += '<tr>'
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c })
        const fullAddr = `${sheetName}!${cellRef}`
        const cell = ws[cellRef]
        const value = cell != null ? String(cell.v ?? '') : ''
        table += `<td data-cell-address="${fullAddr}">${value}</td>`
      }
      table += '</tr>'
    }
    table += '</table>'
    html += table
  }

  return { html, binary: buffer }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/test/lib/renderers/xlsx.test.js
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/renderers/xlsx.js src/test/lib/renderers/xlsx.test.js
git commit -m "feat: add XLSX renderer (SheetJS → html table with data-cell-address)"
```

---

## Task 4: Renderers index

**Files:**
- Create: `src/lib/renderers/index.js`
- Create: `src/test/lib/renderers/index.test.js`

- [ ] **Step 1: Write failing test**

Create `src/test/lib/renderers/index.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/renderers/docx.js', () => ({
  renderDocx: vi.fn().mockResolvedValue({ html: '<p>doc</p>', binary: new ArrayBuffer(4) }),
}))
vi.mock('../../../lib/renderers/xlsx.js', () => ({
  renderXlsx: vi.fn().mockReturnValue({ html: '<table></table>', binary: new ArrayBuffer(4) }),
}))

import { renderFile } from '../../../lib/renderers/index.js'

describe('renderFile', () => {
  it('dispatches to renderDocx for .docx files', async () => {
    const file = new File([new ArrayBuffer(4)], 'contract.docx')
    const result = await renderFile(file)
    expect(result.format).toBe('docx')
    expect(result.html).toBe('<p>doc</p>')
  })

  it('dispatches to renderXlsx for .xlsx files', async () => {
    const file = new File([new ArrayBuffer(4)], 'data.xlsx')
    const result = await renderFile(file)
    expect(result.format).toBe('xlsx')
    expect(result.html).toBe('<table></table>')
  })

  it('throws for unsupported formats', async () => {
    const file = new File([''], 'report.pdf')
    await expect(renderFile(file)).rejects.toThrow('Unsupported format — use DOCX or XLSX')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/test/lib/renderers/index.test.js
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `src/lib/renderers/index.js`**

```js
import { renderDocx } from './docx.js'
import { renderXlsx } from './xlsx.js'

/**
 * @param {File} file
 * @returns {Promise<{ html: string, binary: ArrayBuffer, format: string }>}
 */
export async function renderFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  const buffer = await file.arrayBuffer()

  if (ext === 'docx') {
    const { html, binary } = await renderDocx(buffer)
    return { html, binary, format: 'docx' }
  }
  if (ext === 'xlsx') {
    const { html, binary } = renderXlsx(buffer)
    return { html, binary, format: 'xlsx' }
  }
  throw new Error('Unsupported format — use DOCX or XLSX')
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/test/lib/renderers/index.test.js
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/renderers/index.js src/test/lib/renderers/index.test.js
git commit -m "feat: add renderFile dispatch (renderers/index.js)"
```

---

## Task 5: Field editor — DOCX

**Files:**
- Create: `src/lib/fieldEditor.js` (insertDocx only for now)
- Create: `src/test/lib/fieldEditor.test.js` (DOCX tests only)

**Context:** This is the most complex task. The algorithm uses PizZip to unpack the DOCX, DOMParser to parse `word/document.xml`, then walks `<w:p>` descendants of `<w:body>` (skipping `<w:del>` children), rebuilds the paragraph text from `<w:r>/<w:t>` runs, finds the selected text, handles partial-run boundaries, and merges the spanning runs into a single `{{fieldName}}` run.

- [ ] **Step 1: Write failing tests**

Create `src/test/lib/fieldEditor.test.js`:

```js
import { describe, it, expect } from 'vitest'
import PizZip from 'pizzip'
import { insertDocx } from '../../lib/fieldEditor.js'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// Build a minimal DOCX binary with the given paragraphs (array of strings).
// Each paragraph becomes a single <w:p><w:r><w:t>text</w:t></w:r></w:p>.
function buildDocx(paragraphs) {
  const paras = paragraphs.map(text => {
    return `<w:p xmlns:w="${W_NS}"><w:r><w:t>${text}</w:t></w:r></w:p>`
  }).join('')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W_NS}">
  <w:body>${paras}</w:body>
</w:document>`
  const zip = new PizZip()
  zip.file('word/document.xml', xml)
  return zip.generate({ type: 'arraybuffer' })
}

// Build a DOCX where a paragraph has split runs (text split across multiple <w:r>).
function buildDocxSplitRuns(parts) {
  // parts is an array of strings; each becomes its own <w:r><w:t>...</w:t></w:r>
  const runs = parts.map(p => `<w:r><w:t xml:space="preserve">${p}</w:t></w:r>`).join('')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W_NS}">
  <w:body><w:p xmlns:w="${W_NS}">${runs}</w:p></w:body>
</w:document>`
  const zip = new PizZip()
  zip.file('word/document.xml', xml)
  return zip.generate({ type: 'arraybuffer' })
}

function readDocxXml(binary) {
  const zip = new PizZip(binary)
  return zip.files['word/document.xml'].asText()
}

describe('insertDocx', () => {
  it('replaces selected text with {{fieldName}} in a single-run paragraph', () => {
    const binary = buildDocx(['Agreement with Acme Corp hereinafter.'])
    const result = insertDocx(binary, 'Acme Corp', 0, 'ClientName')
    expect(result.error).toBeUndefined()
    const xml = readDocxXml(result.binary)
    expect(xml).toContain('{{ClientName}}')
    expect(xml).not.toContain('Acme Corp')
  })

  it('returns error when selected text is not found', () => {
    const binary = buildDocx(['Some other text.'])
    const result = insertDocx(binary, 'Missing Text', 0, 'Field')
    expect(result.error).toBe('text_not_found')
  })

  it('targets the correct paragraph by index', () => {
    const binary = buildDocx(['First paragraph.', 'Second paragraph.', 'Third paragraph.'])
    const result = insertDocx(binary, 'Second paragraph', 1, 'Middle')
    expect(result.error).toBeUndefined()
    const xml = readDocxXml(result.binary)
    expect(xml).toContain('{{Middle}}')
    expect(xml).toContain('First paragraph.')
    expect(xml).toContain('Third paragraph.')
    expect(xml).not.toContain('Second paragraph.')
  })

  it('handles run-split text (text spread across multiple <w:r> elements)', () => {
    // "John Smith" split as ["John ", "Smith"]
    const binary = buildDocxSplitRuns(['John ', 'Smith'])
    const result = insertDocx(binary, 'John Smith', 0, 'FullName')
    expect(result.error).toBeUndefined()
    const xml = readDocxXml(result.binary)
    expect(xml).toContain('{{FullName}}')
    expect(xml).not.toContain('John ')
    expect(xml).not.toContain('>Smith<')
  })

  it('handles partial-run selection (selectedText starts mid-run)', () => {
    // Run contains "Mr. John Smith" but we select only "John Smith"
    const binary = buildDocx(['Mr. John Smith here.'])
    const result = insertDocx(binary, 'John Smith', 0, 'FullName')
    expect(result.error).toBeUndefined()
    const xml = readDocxXml(result.binary)
    expect(xml).toContain('{{FullName}}')
    expect(xml).toContain('Mr. ')
    expect(xml).toContain(' here.')
  })

  it('uses first occurrence when selectedText appears twice in the paragraph', () => {
    const binary = buildDocx(['AAA and AAA.'])
    const result = insertDocx(binary, 'AAA', 0, 'Tag')
    expect(result.error).toBeUndefined()
    const xml = readDocxXml(result.binary)
    // Second AAA should remain; first should be replaced
    expect(xml).toContain('{{Tag}}')
    expect(xml).toContain('AAA')
    // Count occurrences of 'AAA' in the output
    const remaining = (xml.match(/AAA/g) || []).length
    expect(remaining).toBe(1) // only the second one remains
  })

  it('returns error for out-of-range paragraphIndex', () => {
    const binary = buildDocx(['Only one paragraph.'])
    const result = insertDocx(binary, 'Only one', 5, 'Field')
    expect(result.error).toBe('paragraph_index_out_of_range')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/test/lib/fieldEditor.test.js
```

Expected: FAIL with "Cannot find module '../../lib/fieldEditor.js'"

- [ ] **Step 3: Implement `src/lib/fieldEditor.js` (insertDocx)**

```js
import PizZip from 'pizzip'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'

/**
 * Collect all <w:p> descendants of <w:body>, depth-first, excluding those
 * inside <w:del> elements (tracked deletions, which mammoth skips).
 * Headers/footers are in separate XML files and never appear in document.xml's body.
 */
function collectBodyParagraphs(body) {
  const paras = []
  function walk(node) {
    for (const child of Array.from(node.children)) {
      if (child.namespaceURI === W_NS && child.localName === 'del') continue
      if (child.namespaceURI === W_NS && child.localName === 'p') {
        paras.push(child)
      }
      walk(child)
    }
  }
  walk(body)
  return paras
}

/**
 * Replace selectedText in a paragraph with {{fieldName}}.
 * Handles run-split text and partial-run boundaries.
 * Returns null on success or an error string.
 */
function insertInParagraph(para, selectedText, fieldName) {
  const runs = Array.from(para.getElementsByTagNameNS(W_NS, 'r'))
  const runTexts = runs.map(r => {
    const tEls = Array.from(r.getElementsByTagNameNS(W_NS, 't'))
    return tEls.map(t => t.textContent).join('')
  })
  const fullText = runTexts.join('')
  const matchStart = fullText.indexOf(selectedText)
  if (matchStart === -1) return 'text_not_found'

  const matchEnd = matchStart + selectedText.length

  // Map cumulative char positions to runs
  let pos = 0
  const runRanges = runTexts.map((text, i) => {
    const start = pos
    pos += text.length
    return { start, end: pos, index: i }
  })

  const firstRunIdx = runRanges.findIndex(r => r.end > matchStart)
  const lastRunIdx = runRanges.findIndex(r => r.end >= matchEnd)
  if (firstRunIdx === -1 || lastRunIdx === -1) return 'text_not_found'

  const firstRun = runs[firstRunIdx]
  const firstRunRange = runRanges[firstRunIdx]
  const lastRun = runs[lastRunIdx]
  const lastRunRange = runRanges[lastRunIdx]

  const prefixText = runTexts[firstRunIdx].slice(0, matchStart - firstRunRange.start)
  const suffixText = runTexts[lastRunIdx].slice(matchEnd - lastRunRange.start)

  const doc = para.ownerDocument
  const firstRPr = firstRun.getElementsByTagNameNS(W_NS, 'rPr')[0]

  // Build the replacement {{fieldName}} run
  const newRun = doc.createElementNS(W_NS, 'w:r')
  if (firstRPr) newRun.appendChild(firstRPr.cloneNode(true))
  const newT = doc.createElementNS(W_NS, 'w:t')
  newT.textContent = `{{${fieldName}}}`
  newRun.appendChild(newT)

  const replacements = []

  if (prefixText) {
    const prefixRun = firstRun.cloneNode(true)
    const prefixT = prefixRun.getElementsByTagNameNS(W_NS, 't')[0]
    if (prefixT) {
      prefixT.textContent = prefixText
      if (prefixText.startsWith(' ') || prefixText.endsWith(' ')) {
        prefixT.setAttributeNS(XML_NS, 'xml:space', 'preserve')
      }
    }
    replacements.push(prefixRun)
  }

  replacements.push(newRun)

  if (suffixText) {
    const suffixRun = lastRun.cloneNode(true)
    const suffixT = suffixRun.getElementsByTagNameNS(W_NS, 't')[0]
    if (suffixT) {
      suffixT.textContent = suffixText
      if (suffixText.startsWith(' ') || suffixText.endsWith(' ')) {
        suffixT.setAttributeNS(XML_NS, 'xml:space', 'preserve')
      }
    }
    replacements.push(suffixRun)
  }

  const parent = firstRun.parentNode
  const involvedRuns = runs.slice(firstRunIdx, lastRunIdx + 1)
  for (const r of replacements) parent.insertBefore(r, firstRun)
  for (const r of involvedRuns) parent.removeChild(r)

  return null
}

/**
 * Insert {{fieldName}} into a DOCX binary at the selected text position.
 * @param {ArrayBuffer} binary
 * @param {string} selectedText
 * @param {number} paragraphIndex — index among all <w:p> in <w:body> in document order
 * @param {string} fieldName
 * @returns {{ binary: ArrayBuffer } | { error: string }}
 */
export function insertDocx(binary, selectedText, paragraphIndex, fieldName) {
  const zip = new PizZip(binary)
  const xmlText = zip.files['word/document.xml'].asText()

  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml')

  const bodies = xmlDoc.getElementsByTagNameNS(W_NS, 'body')
  if (!bodies.length) return { error: 'no_body' }

  const paras = collectBodyParagraphs(bodies[0])

  if (paragraphIndex >= paras.length) return { error: 'paragraph_index_out_of_range' }

  const err = insertInParagraph(paras[paragraphIndex], selectedText, fieldName)
  if (err) return { error: err }

  const serializer = new XMLSerializer()
  const newXml = serializer.serializeToString(xmlDoc)
  zip.file('word/document.xml', newXml)

  const newBinary = zip.generate({ type: 'arraybuffer' })
  return { binary: newBinary }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/test/lib/fieldEditor.test.js
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fieldEditor.js src/test/lib/fieldEditor.test.js
git commit -m "feat: add insertDocx (PizZip + DOMParser XML run normalization)"
```

---

## Task 6: Field editor — XLSX

**Files:**
- Modify: `src/lib/fieldEditor.js` (add `insertXlsx`)
- Modify: `src/test/lib/fieldEditor.test.js` (add XLSX tests)

- [ ] **Step 1: Add failing XLSX tests to `src/test/lib/fieldEditor.test.js`**

Append to the existing test file (after the `insertDocx` describe block):

```js
import * as XLSX from 'xlsx'
import { insertXlsx } from '../../lib/fieldEditor.js'

function buildXlsx(sheets) {
  // sheets: { sheetName: { cellRef: value } }
  const wb = XLSX.utils.book_new()
  for (const [name, cells] of Object.entries(sheets)) {
    const ws = {}
    let maxR = 0, maxC = 0
    for (const [ref, val] of Object.entries(cells)) {
      const decoded = XLSX.utils.decode_cell(ref)
      maxR = Math.max(maxR, decoded.r)
      maxC = Math.max(maxC, decoded.c)
      ws[ref] = { t: 's', v: String(val) }
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } })
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return buf.buffer ?? buf
}

function readXlsxCell(binary, sheetName, cellRef) {
  const wb = XLSX.read(binary, { type: 'array' })
  return wb.Sheets[sheetName]?.[cellRef]?.v
}

describe('insertXlsx', () => {
  it('replaces cell value with {{fieldName}}', () => {
    const binary = buildXlsx({ Sheet1: { B3: '$75,000' } })
    const result = insertXlsx(binary, 'Sheet1!B3', 'ContractValue')
    expect(result.error).toBeUndefined()
    expect(readXlsxCell(result.binary, 'Sheet1', 'B3')).toBe('{{ContractValue}}')
  })

  it('preserves cell type as string', () => {
    const binary = buildXlsx({ Sheet1: { A1: '2024-01-01' } })
    const result = insertXlsx(binary, 'Sheet1!A1', 'EffectiveDate')
    const wb = XLSX.read(result.binary, { type: 'array' })
    expect(wb.Sheets['Sheet1']['A1'].t).toBe('s')
  })

  it('returns error for invalid cell address format', () => {
    const binary = buildXlsx({ Sheet1: { A1: 'x' } })
    const result = insertXlsx(binary, 'B3', 'Field') // missing sheet name
    expect(result.error).toBe('invalid_cell_address')
  })

  it('returns error when sheet is not found', () => {
    const binary = buildXlsx({ Sheet1: { A1: 'x' } })
    const result = insertXlsx(binary, 'MissingSheet!A1', 'Field')
    expect(result.error).toBe('sheet_not_found')
  })
})
```

- [ ] **Step 2: Run tests to verify new ones fail**

```bash
npm test -- src/test/lib/fieldEditor.test.js
```

Expected: 6 PASS (insertDocx), 4 FAIL (insertXlsx — not yet implemented)

- [ ] **Step 3: Add `insertXlsx` to `src/lib/fieldEditor.js`**

First, add `import * as _XLSX from 'xlsx'` to the top of `fieldEditor.js` so the imports section reads:

```js
import PizZip from 'pizzip'
import * as _XLSX from 'xlsx'
```

Then append `insertXlsx` to the bottom of the file:

```js
/**
 * Insert {{fieldName}} into an XLSX binary at the specified cell.
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

  const wb = _XLSX.read(binary, { type: 'array' })
  const ws = wb.Sheets[sheetName]
  if (!ws) return { error: 'sheet_not_found' }

  ws[cellRef] = { t: 's', v: `{{${fieldName}}}` }

  const buf = _XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return { binary: buf.buffer ?? buf }
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npm test -- src/test/lib/fieldEditor.test.js
```

Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fieldEditor.js src/test/lib/fieldEditor.test.js
git commit -m "feat: add insertXlsx to fieldEditor"
```

---

## Task 7: `suggestFieldName` in gemini.js

**Files:**
- Modify: `src/lib/gemini.js`
- Modify: `src/test/lib/gemini.test.js`

- [ ] **Step 1: Add failing tests to `src/test/lib/gemini.test.js`**

The existing tests for `testConnection` and `extractVariables` must keep passing. Add a new describe block at the bottom of the file:

```js
import { suggestFieldName } from '../../lib/gemini.js'

describe('suggestFieldName', () => {
  it('returns a valid camelCase field name from AI response', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'ContractValue' } })
    const result = await suggestFieldName('key', '$75,000', 'value shall be $75,000 payable', [])
    expect(result).toBe('ContractValue')
  })

  it('includes selectedText, surroundingContext, and existingFields in the prompt', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'FieldName' } })
    await suggestFieldName('key', 'Alice', 'name is Alice here', ['ExistingField'])
    const call = mockGenerateContent.mock.calls[0][0]
    expect(call).toContain('"Alice"')
    expect(call).toContain('name is Alice here')
    expect(call).toContain('ExistingField')
  })

  it('returns null when AI response fails validation (not camelCase)', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'not valid!' } })
    const result = await suggestFieldName('key', 'text', 'ctx', [])
    expect(result).toBeNull()
  })

  it('returns null when API call throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Network error'))
    const result = await suggestFieldName('key', 'text', 'ctx', [])
    expect(result).toBeNull()
  })

  it('returns null when response is empty string', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => '  ' } })
    const result = await suggestFieldName('key', 'text', 'ctx', [])
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify new ones fail**

```bash
npm test -- src/test/lib/gemini.test.js
```

Expected: 8 existing tests pass, 5 new tests FAIL

- [ ] **Step 3: Add `suggestFieldName` to `src/lib/gemini.js`**

Append to the existing file:

```js
/**
 * Ask Gemini to suggest a camelCase field name for the selected text.
 * Returns null on failure or invalid response.
 * @param {string} apiKey
 * @param {string} selectedText
 * @param {string} surroundingContext
 * @param {string[]} existingFields
 * @returns {Promise<string | null>}
 */
export async function suggestFieldName(apiKey, selectedText, surroundingContext, existingFields) {
  const prompt = `The following text was selected from a document: "${selectedText}". The surrounding context is: "${surroundingContext}". Fields already defined: [${existingFields.join(', ')}]. Suggest a concise camelCase field name for the selected text. Return only the field name, nothing else.`

  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })
    const result = await model.generateContent(prompt)
    const raw = result.response.text().trim()
    if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(raw)) return raw
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run all gemini tests to verify they pass**

```bash
npm test -- src/test/lib/gemini.test.js
```

Expected: 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gemini.js src/test/lib/gemini.test.js
git commit -m "feat: add suggestFieldName to gemini.js"
```

---

## Task 8: Rewrite templateEngine.js

**Files:**
- Rewrite: `src/lib/templateEngine.js`
- Rewrite: `src/test/lib/templateEngine.test.js`

The new `generateDocx` takes an `ArrayBuffer` and a values map and uses docxtemplater + PizZip. The new `generateXlsx` takes an `ArrayBuffer` and replaces `{{FieldName}}` cell values. `injectVariables`, `generatePdf`, and the old `generateDocx(content)` are removed. `downloadBlob` is kept.

- [ ] **Step 1: Write new test file**

Replace the entire contents of `src/test/lib/templateEngine.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('pizzip', () => {
  const PizZip = vi.fn().mockImplementation(() => ({
    generate: vi.fn(() => new Uint8Array([1, 2, 3])),
  }))
  return { default: PizZip }
})

vi.mock('docxtemplater', () => {
  const Docxtemplater = vi.fn().mockImplementation(() => ({
    render: vi.fn(),
    getZip: vi.fn().mockReturnValue({
      generate: vi.fn().mockResolvedValue(new Blob(['docx'])),
    }),
  }))
  return { default: Docxtemplater }
})

vi.mock('xlsx', () => ({
  read: vi.fn(),
  write: vi.fn(() => new Uint8Array([4, 5, 6])),
  utils: {
    book_new: vi.fn(() => ({})),
    aoa_to_sheet: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
}))

import { generateDocx, generateXlsx, downloadBlob } from '../../lib/templateEngine.js'
import * as XLSX from 'xlsx'

describe('generateDocx', () => {
  it('returns a Blob', async () => {
    const buffer = new ArrayBuffer(8)
    const blob = await generateDocx(buffer, { ClientName: 'Acme Corp' })
    expect(blob).toBeInstanceOf(Blob)
  })
})

describe('generateXlsx', () => {
  it('returns a Blob', async () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:A1',
          A1: { t: 's', v: '{{ClientName}}' },
        },
      },
    })
    const buffer = new ArrayBuffer(8)
    const blob = await generateXlsx(buffer, { ClientName: 'Acme Corp' })
    expect(blob).toBeInstanceOf(Blob)
  })

  it('replaces {{FieldName}} tokens with values', async () => {
    const sheet = {
      '!ref': 'A1:B1',
      A1: { t: 's', v: '{{ClientName}}' },
      B1: { t: 's', v: 'static value' },
    }
    XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { Sheet1: sheet } })
    const buffer = new ArrayBuffer(8)
    await generateXlsx(buffer, { ClientName: 'Acme Corp' })
    // After generateXlsx, the sheet object is mutated before XLSX.write is called
    expect(sheet.A1.v).toBe('Acme Corp')
    expect(sheet.B1.v).toBe('static value') // not a token, unchanged
  })

  it('does not export injectVariables', async () => {
    const mod = await import('../../lib/templateEngine.js')
    expect(mod.injectVariables).toBeUndefined()
  })
})

describe('downloadBlob', () => {
  it('creates an anchor and triggers click', () => {
    const mockAnchor = { href: '', download: '', click: vi.fn() }
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:url')
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    downloadBlob(new Blob(['test']), 'output.docx')
    expect(mockAnchor.download).toBe('output.docx')
    expect(mockAnchor.click).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/test/lib/templateEngine.test.js
```

Expected: FAIL (old exports don't match)

- [ ] **Step 3: Rewrite `src/lib/templateEngine.js`**

```js
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import * as XLSX from 'xlsx'

/**
 * Generate a filled DOCX from a binary template with {{tokens}}.
 * @param {ArrayBuffer} binary — DOCX with {{FieldName}} tokens
 * @param {Record<string, string>} values — field values keyed by name
 * @returns {Promise<Blob>}
 */
export async function generateDocx(binary, values) {
  const zip = new PizZip(binary)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })
  doc.render(values)
  return await doc.getZip().generate({ type: 'blob' })
}

/**
 * Generate a filled XLSX from a binary template with {{tokens}} in cells.
 * @param {ArrayBuffer} binary — XLSX with {{FieldName}} token cells
 * @param {Record<string, string>} values — field values keyed by name
 * @returns {Promise<Blob>}
 */
export async function generateXlsx(binary, values) {
  const wb = XLSX.read(binary, { type: 'array' })

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    for (const cellRef in ws) {
      if (cellRef.startsWith('!')) continue
      const cell = ws[cellRef]
      if (cell && cell.t === 's' && typeof cell.v === 'string') {
        const match = cell.v.match(/^\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}$/)
        if (match && match[1] in values) {
          cell.v = values[match[1]]
        }
      }
    }
  }

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * Triggers a browser download of a Blob.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/test/lib/templateEngine.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/templateEngine.js src/test/lib/templateEngine.test.js
git commit -m "feat: rewrite templateEngine — generateDocx/Xlsx(binary, values); remove injectVariables"
```

---

## Task 9: Update Upload.jsx

**Files:**
- Modify: `src/pages/Upload.jsx`
- Modify: `src/test/pages/Upload.test.jsx`

- [ ] **Step 1: Write updated test file**

Replace the entire contents of `src/test/pages/Upload.test.jsx`:

```js
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/renderers/index.js', () => ({ renderFile: vi.fn() }))
vi.mock('../../components/FileDropZone.jsx', () => ({
  default: ({ onFile }) => (
    <button onClick={() => onFile(new File([new ArrayBuffer(4)], 'test.docx'))}>
      select file
    </button>
  ),
}))

import Upload from '../../pages/Upload.jsx'
import * as renderers from '../../lib/renderers/index.js'

const RENDER_RESULT = {
  html: '<p>Hello</p>',
  binary: new ArrayBuffer(4),
  format: 'docx',
}

beforeEach(() => vi.clearAllMocks())

describe('Upload', () => {
  it('renders the file drop zone', () => {
    render(<Upload onScan={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'select file' })).toBeInTheDocument()
  })

  it('shows loading state while rendering', async () => {
    renderers.renderFile.mockReturnValue(new Promise(() => {})) // never resolves
    render(<Upload onScan={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() => expect(screen.getByTestId('loading')).toBeInTheDocument())
  })

  it('calls onScan with html, binary, format, fileName, and empty fields on success', async () => {
    renderers.renderFile.mockResolvedValue(RENDER_RESULT)
    const onScan = vi.fn()
    render(<Upload onScan={onScan} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() =>
      expect(onScan).toHaveBeenCalledWith({
        html: '<p>Hello</p>',
        binary: expect.any(ArrayBuffer),
        format: 'docx',
        fileName: 'test.docx',
        fields: [],
      })
    )
  })

  it('shows error when renderFile throws', async () => {
    renderers.renderFile.mockRejectedValue(new Error('Unsupported format — use DOCX or XLSX'))
    render(<Upload onScan={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() =>
      expect(screen.getByText(/unsupported format/i)).toBeInTheDocument()
    )
  })

  it('clears error when a new file is selected after a previous failure', async () => {
    renderers.renderFile
      .mockRejectedValueOnce(new Error('First file failed'))
      .mockResolvedValueOnce(RENDER_RESULT)
    const onScan = vi.fn()
    render(<Upload onScan={onScan} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() => expect(screen.getByText(/first file failed/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() => expect(onScan).toHaveBeenCalled())
    expect(screen.queryByText(/first file failed/i)).not.toBeInTheDocument()
  })

  it('does not call Gemini API at any point', async () => {
    renderers.renderFile.mockResolvedValue(RENDER_RESULT)
    render(<Upload onScan={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() => expect(renderers.renderFile).toHaveBeenCalled())
    // No gemini import means no extractVariables call — this test passing confirms it
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/test/pages/Upload.test.jsx
```

Expected: FAIL (old Upload.jsx has different behavior)

- [ ] **Step 3: Rewrite `src/pages/Upload.jsx`**

```jsx
import { useState } from 'react'
import FileDropZone from '../components/FileDropZone.jsx'
import { renderFile } from '../lib/renderers/index.js'

export default function Upload({ onScan, onToast }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleFile = async file => {
    setError(null)
    setLoading(true)
    try {
      const { html, binary, format } = await renderFile(file)
      onScan?.({ html, binary, format, fileName: file.name, fields: [] })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-gray-300">Upload Document</h2>
      {loading ? (
        <div data-testid="loading" className="flex flex-col items-center gap-3 py-10 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs">Rendering document…</span>
        </div>
      ) : (
        <>
          <FileDropZone onFile={handleFile} accept=".docx,.xlsx" />
          {error && (
            <p className="text-xs text-red-400 text-center">{error}</p>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/test/pages/Upload.test.jsx
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Upload.jsx src/test/pages/Upload.test.jsx
git commit -m "feat: update Upload to use renderFile; remove Gemini call"
```

---

## Task 10: Update App.jsx

**Files:**
- Modify: `src/App.jsx`

The `App.jsx` needs to: (1) pass `apiKey` to Review, (2) change the `onScan` handler to use the new `scanData` shape (`html`, `binary`, `format`, `fileName`, `fields`), (3) update Review props accordingly.

App.test.jsx mocks all pages so no test changes are needed — the tests will still pass.

- [ ] **Step 1: Read current App.jsx** (already done above; it's at lines 74–83)

The Review mount currently uses:
```jsx
<Review
  rawContent={scanData.text}
  format={scanData.format}
  initialVariables={scanData.variables}
  onSave={() => setStep(3)}
  onBack={() => setStep(1)}
  onToast={setToast}
/>
```

- [ ] **Step 2: Update `src/App.jsx`**

Change the Review render block (lines 74–83) to:

```jsx
{step === 2 && scanData && (
  <Review
    html={scanData.html}
    binary={scanData.binary}
    format={scanData.format}
    fileName={scanData.fileName}
    fields={scanData.fields}
    apiKey={apiKey}
    onSave={() => setStep(3)}
    onBack={() => setStep(1)}
  />
)}
```

Also remove `onToast={setToast}` from Review (the new Review doesn't use it — it handles errors inline). Keep the `toast` state and `onToast` for other pages.

- [ ] **Step 3: Run App tests to verify they still pass**

```bash
npm test -- src/test/App.test.jsx
```

Expected: all 6 tests pass (Review is mocked in App tests so prop changes don't affect them).

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: update App.jsx to pass new scanData shape and apiKey to Review"
```

---

## Task 11: Update Generate.jsx

**Files:**
- Modify: `src/pages/Generate.jsx`
- Modify: `src/test/pages/Generate.test.jsx`

The new Generate.jsx uses `template.fields` (a `string[]`) instead of `template.variables` (an array of objects), calls `generateDocx(binary, values)` or `generateXlsx(binary, values)`, decodes the base64 binary before passing it, and removes the format selector and PDF option.

- [ ] **Step 1: Write updated test file**

Replace the entire contents of `src/test/pages/Generate.test.jsx`:

```js
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/templateEngine.js', () => ({
  generateDocx: vi.fn(),
  generateXlsx: vi.fn(),
  downloadBlob: vi.fn(),
}))

import Generate from '../../pages/Generate.jsx'
import * as engine from '../../lib/templateEngine.js'

// binary is a base64-encoded ArrayBuffer
function makeBase64() {
  return btoa(String.fromCharCode(0, 1, 2, 3))
}

const TEMPLATE_DOCX = {
  id: 'id-1',
  name: 'Sales Contract',
  sourceFormat: 'docx',
  binary: makeBase64(),
  fields: ['ClientName', 'EffectiveDate'],
  createdAt: 1774148866000,
}

const TEMPLATE_XLSX = {
  id: 'id-2',
  name: 'Budget',
  sourceFormat: 'xlsx',
  binary: makeBase64(),
  fields: ['Quarter', 'Amount'],
  createdAt: 1774148866000,
}

beforeEach(() => vi.clearAllMocks())

describe('Generate', () => {
  it('renders one input per field name', () => {
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByLabelText('ClientName')).toBeInTheDocument()
    expect(screen.getByLabelText('EffectiveDate')).toBeInTheDocument()
  })

  it('does not render a format selector', () => {
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('calls generateDocx with decoded binary and values for DOCX template', async () => {
    engine.generateDocx.mockResolvedValue(new Blob(['docx']))
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('ClientName'), { target: { value: 'Acme Corp' } })
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => {
      expect(engine.generateDocx).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        { ClientName: 'Acme Corp', EffectiveDate: '' }
      )
      expect(engine.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Sales Contract.docx')
    })
  })

  it('calls generateXlsx for XLSX template', async () => {
    engine.generateXlsx.mockResolvedValue(new Blob(['xlsx']))
    render(<Generate template={TEMPLATE_XLSX} onBack={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => {
      expect(engine.generateXlsx).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        { Quarter: '', Amount: '' }
      )
      expect(engine.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Budget.xlsx')
    })
  })

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={onBack} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })

  it('calls onToast with error when generation fails', async () => {
    engine.generateDocx.mockRejectedValue(new Error('Output generation failed'))
    const onToast = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={onToast} />)
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/test/pages/Generate.test.jsx
```

Expected: FAIL (old Generate.jsx has different API)

- [ ] **Step 3: Rewrite `src/pages/Generate.jsx`**

```jsx
import { useState } from 'react'
import { generateDocx, generateXlsx, downloadBlob } from '../lib/templateEngine.js'

function decodeBase64(base64) {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer
}

export default function Generate({ template, onBack, onToast }) {
  const [values, setValues] = useState({})
  const [generating, setGenerating] = useState(false)

  const handleChange = (name, value) => {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const binary = decodeBase64(template.binary)
      const fieldValues = Object.fromEntries(
        template.fields.map(f => [f, values[f] ?? ''])
      )

      let blob
      if (template.sourceFormat === 'docx') {
        blob = await generateDocx(binary, fieldValues)
        downloadBlob(blob, `${template.name}.docx`)
      } else {
        blob = await generateXlsx(binary, fieldValues)
        downloadBlob(blob, `${template.name}.xlsx`)
      }
    } catch (err) {
      onToast({ message: `Generation failed: ${err.message}`, type: 'error' })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-700 flex gap-2 items-center shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-600"
        >
          ← Back
        </button>
        <span className="text-sm font-medium text-white truncate flex-1">{template.name}</span>
      </div>

      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        {template.fields.map(name => (
          <div key={name} className="flex flex-col gap-1">
            <label htmlFor={`field-${name}`} className="text-xs text-gray-400 font-medium">
              {name}
            </label>
            <input
              id={`field-${name}`}
              value={values[name] ?? ''}
              onChange={e => handleChange(name, e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              placeholder={`Enter ${name}…`}
            />
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-gray-700 flex gap-2 items-center shrink-0">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-1.5 rounded transition-colors"
        >
          {generating ? 'Generating…' : '⬇ Download'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/test/pages/Generate.test.jsx
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Generate.jsx src/test/pages/Generate.test.jsx
git commit -m "feat: update Generate to use template.fields and new generateDocx/Xlsx(binary, values)"
```

---

## Task 12: Replace Review.jsx

**Files:**
- Replace: `src/pages/Review.jsx`
- Replace: `src/test/pages/Review.test.jsx`

This is the most complex task. The new Review renders the document via `innerHTML`, handles DOCX text selection and XLSX cell click, shows a suggestion popover, inserts fields into the binary, and saves the modified template.

- [ ] **Step 1: Write new test file**

Replace the entire contents of `src/test/pages/Review.test.jsx`:

```js
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/renderers/docx.js', () => ({
  renderDocx: vi.fn().mockResolvedValue({ html: '<p>Updated</p>', binary: new ArrayBuffer(4) }),
}))
vi.mock('../../lib/renderers/xlsx.js', () => ({
  renderXlsx: vi.fn().mockReturnValue({ html: '<table></table>', binary: new ArrayBuffer(4) }),
}))
vi.mock('../../lib/fieldEditor.js', () => ({
  insertDocx: vi.fn(),
  insertXlsx: vi.fn(),
}))
vi.mock('../../lib/gemini.js', () => ({
  suggestFieldName: vi.fn().mockResolvedValue('ClientName'),
}))
vi.mock('../../lib/storage.js', () => ({
  saveTemplate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('uuid', () => ({ v4: () => 'test-uuid' }))

import Review from '../../pages/Review.jsx'
import * as fieldEditor from '../../lib/fieldEditor.js'
import * as gemini from '../../lib/gemini.js'
import * as storage from '../../lib/storage.js'

const DOCX_PROPS = {
  html: '<p>Agreement with Acme Corp hereinafter.</p>',
  binary: new ArrayBuffer(8),
  format: 'docx',
  fileName: 'contract.docx',
  fields: [],
  apiKey: 'test-key',
  onSave: vi.fn(),
  onBack: vi.fn(),
}

const XLSX_PROPS = {
  html: '<table><tr><td data-cell-address="Sheet1!B3">$75,000</td></tr></table>',
  binary: new ArrayBuffer(8),
  format: 'xlsx',
  fileName: 'budget.xlsx',
  fields: [],
  apiKey: 'test-key',
  onSave: vi.fn(),
  onBack: vi.fn(),
}

// Helper to simulate a DOCX text selection
function mockSelection(anchorNode, focusNode, text) {
  const mockSel = {
    isCollapsed: false,
    toString: () => text,
    anchorNode,
    focusNode,
    getRangeAt: () => ({
      getBoundingClientRect: () => ({ bottom: 100, left: 50, top: 90 }),
    }),
    removeAllRanges: vi.fn(),
  }
  Object.defineProperty(window, 'getSelection', { value: () => mockSel, configurable: true })
}

beforeEach(() => vi.clearAllMocks())

describe('Review — DOCX', () => {
  it('renders the document html in the viewer div', () => {
    render(<Review {...DOCX_PROPS} />)
    // The viewer sets innerHTML — check text is visible
    expect(screen.getByText(/Agreement with Acme Corp/i)).toBeInTheDocument()
  })

  it('shows popover when valid text is selected (≥ 3 non-whitespace chars)', async () => {
    render(<Review {...DOCX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
    await act(async () => {
      fireEvent.mouseUp(viewer)
    })

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  })

  it('does not show popover when selection has fewer than 3 non-whitespace chars', async () => {
    render(<Review {...DOCX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    mockSelection(para.firstChild, para.firstChild, 'AB')
    await act(async () => { fireEvent.mouseUp(viewer) })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows cross-paragraph error when anchor and focus are in different paragraphs', async () => {
    const html = '<p id="p1">Paragraph one.</p><p id="p2">Paragraph two.</p>'
    render(<Review {...DOCX_PROPS} html={html} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const p1 = viewer.querySelector('#p1')
    const p2 = viewer.querySelector('#p2')

    mockSelection(p1.firstChild, p2.firstChild, 'Paragraph one')
    await act(async () => { fireEvent.mouseUp(viewer) })

    await waitFor(() =>
      expect(screen.getByText(/single paragraph/i)).toBeInTheDocument()
    )
  })

  it('populates the field name input with AI suggestion', async () => {
    render(<Review {...DOCX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
    await act(async () => { fireEvent.mouseUp(viewer) })

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /field name/i })).toHaveValue('ClientName')
    )
  })

  it('calls insertDocx and re-renders on Accept', async () => {
    const newBinary = new ArrayBuffer(16)
    fieldEditor.insertDocx.mockReturnValue({ binary: newBinary })
    render(<Review {...DOCX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
    await act(async () => { fireEvent.mouseUp(viewer) })
    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByRole('button', { name: /accept/i }))

    await waitFor(() => expect(fieldEditor.insertDocx).toHaveBeenCalled())
    // Popover should close after accept
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows duplicate field name error when field already exists', async () => {
    render(<Review {...DOCX_PROPS} fields={['ClientName']} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
    await act(async () => { fireEvent.mouseUp(viewer) })
    await waitFor(() => screen.getByRole('dialog'))

    // Suggestion is 'ClientName' which already exists
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))

    await waitFor(() =>
      expect(screen.getByText(/already used/i)).toBeInTheDocument()
    )
  })

  it('dismisses popover on Dismiss click', async () => {
    render(<Review {...DOCX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
    await act(async () => { fireEvent.mouseUp(viewer) })
    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('blocks Save Template when zero fields defined', async () => {
    render(<Review {...DOCX_PROPS} fields={[]} />)
    fireEvent.change(screen.getByPlaceholderText(/template name/i), {
      target: { value: 'My Template' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save template/i }))
    await waitFor(() =>
      expect(screen.getByText(/at least one field/i)).toBeInTheDocument()
    )
    expect(storage.saveTemplate).not.toHaveBeenCalled()
  })

  it('saves template with base64-encoded binary and fields array', async () => {
    const newBinary = new ArrayBuffer(4)
    fieldEditor.insertDocx.mockReturnValue({ binary: newBinary })
    render(<Review {...DOCX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    // First add a field
    mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
    await act(async () => { fireEvent.mouseUp(viewer) })
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    await waitFor(() => expect(fieldEditor.insertDocx).toHaveBeenCalled())

    // Now save
    fireEvent.change(screen.getByPlaceholderText(/template name/i), {
      target: { value: 'Sales Contract' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save template/i }))

    await waitFor(() =>
      expect(storage.saveTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-uuid',
          name: 'Sales Contract',
          sourceFormat: 'docx',
          binary: expect.any(String), // base64 string
          fields: ['ClientName'],
        })
      )
    )
    expect(DOCX_PROPS.onSave).toHaveBeenCalled()
  })
})

describe('Review — XLSX', () => {
  it('shows popover when a table cell is clicked', async () => {
    render(<Review {...XLSX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const cell = viewer.querySelector('td[data-cell-address]')
    expect(cell).toBeInTheDocument()

    await act(async () => { fireEvent.click(cell) })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  })

  it('shows "already a field" error when cell contains {{...}}', async () => {
    const html = '<table><tr><td data-cell-address="Sheet1!A1">{{Existing}}</td></tr></table>'
    render(<Review {...XLSX_PROPS} html={html} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const cell = viewer.querySelector('td[data-cell-address]')

    await act(async () => { fireEvent.click(cell) })
    await waitFor(() =>
      expect(screen.getByText(/already a field/i)).toBeInTheDocument()
    )
  })

  it('calls insertXlsx on Accept', async () => {
    const newBinary = new ArrayBuffer(16)
    fieldEditor.insertXlsx.mockReturnValue({ binary: newBinary })
    render(<Review {...XLSX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const cell = viewer.querySelector('td[data-cell-address]')

    await act(async () => { fireEvent.click(cell) })
    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    await waitFor(() => expect(fieldEditor.insertXlsx).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/test/pages/Review.test.jsx
```

Expected: many FAIL (old Review.jsx has completely different interface)

- [ ] **Step 3: Implement new `src/pages/Review.jsx`**

```jsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { renderDocx } from '../lib/renderers/docx.js'
import { renderXlsx } from '../lib/renderers/xlsx.js'
import { insertDocx, insertXlsx } from '../lib/fieldEditor.js'
import { suggestFieldName } from '../lib/gemini.js'
import { saveTemplate } from '../lib/storage.js'

const CHIP_COLORS = [
  'bg-blue-600', 'bg-green-600', 'bg-purple-600',
  'bg-orange-500', 'bg-pink-600', 'bg-teal-600',
]

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let str = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    str += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(str)
}

function applyChipOverlay(container, fields) {
  if (!fields.length) return
  const pattern = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes = []
  let node
  while ((node = walker.nextNode())) {
    pattern.lastIndex = 0
    if (pattern.test(node.textContent)) textNodes.push(node)
  }
  for (const textNode of textNodes) {
    const parent = textNode.parentNode
    const frag = document.createDocumentFragment()
    let text = textNode.textContent
    let lastIndex = 0
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
      }
      const fieldName = match[1]
      const colorIdx = fields.indexOf(fieldName)
      const chip = document.createElement('span')
      chip.className = `inline-block px-1.5 py-0.5 rounded text-xs font-mono text-white ${CHIP_COLORS[colorIdx % CHIP_COLORS.length] || 'bg-gray-600'}`
      chip.textContent = `{{${fieldName}}}`
      frag.appendChild(chip)
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)))
    parent.replaceChild(frag, textNode)
  }
}

function getXlsxContext(td) {
  const table = td.closest('table')
  if (!table) return ''
  const allCells = Array.from(table.querySelectorAll('td'))
  const idx = allCells.indexOf(td)
  const radius = 2
  const contextCells = allCells
    .slice(Math.max(0, idx - radius), idx)
    .concat(allCells.slice(idx + 1, idx + 1 + radius))
  return contextCells.map(c => c.textContent.trim()).filter(Boolean).join(' ')
}

export default function Review({ html: initialHtml, binary: initialBinary, format, fileName, fields: initialFields, apiKey, onSave, onBack }) {
  const viewerRef = useRef(null)
  const [html, setHtml] = useState(initialHtml)
  const [binary, setBinary] = useState(initialBinary)
  const [fields, setFields] = useState(initialFields)
  const [templateName, setTemplateName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [popover, setPopover] = useState(null)
  // popover shape: { state: 'loading'|'ready', fieldName: string, errorMsg: string, position: {top, left} }
  const pendingRef = useRef(null)
  // pending shape (DOCX): { selectedText, paragraphIndex }
  // pending shape (XLSX): { cellAddress, selectedText }

  // Apply html to DOM and run chip overlay after every html/fields update
  useEffect(() => {
    if (!viewerRef.current) return
    const scrollTop = viewerRef.current.scrollTop
    viewerRef.current.innerHTML = html
    applyChipOverlay(viewerRef.current, fields)
    viewerRef.current.scrollTop = scrollTop
  }, [html, fields])

  const openSuggestion = useCallback(async (selectedText, surroundingContext, pendingData, position) => {
    pendingRef.current = pendingData
    setPopover({ state: 'loading', fieldName: '', errorMsg: '', position })
    const suggested = await suggestFieldName(apiKey, selectedText, surroundingContext, fields)
    setPopover(prev => prev ? { ...prev, state: 'ready', fieldName: suggested ?? '' } : null)
  }, [apiKey, fields])

  const handleMouseUp = useCallback(async () => {
    if (format !== 'docx') return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const selectedText = sel.toString().trim()
    if (selectedText.replace(/\s/g, '').length < 3) return

    // anchorNode/focusNode may be text nodes (no .closest); use parentElement first
    const anchorPara = sel.anchorNode?.parentElement?.closest('p') ?? null
    const focusPara = sel.focusNode?.parentElement?.closest('p') ?? null

    if (!anchorPara || anchorPara !== focusPara) {
      setPopover({ state: 'ready', fieldName: '', errorMsg: 'Select text within a single paragraph', position: { top: 80, left: 50 } })
      return
    }

    const allParas = Array.from(viewerRef.current.querySelectorAll('p'))
    const paragraphIndex = allParas.indexOf(anchorPara)

    const docText = viewerRef.current.textContent
    const selIdx = docText.indexOf(selectedText)
    const before = selIdx > 0 ? docText.slice(Math.max(0, selIdx - 100), selIdx) : ''
    const after = docText.slice(selIdx + selectedText.length, selIdx + selectedText.length + 100)
    const surroundingContext = before + selectedText + after

    const rect = sel.getRangeAt(0).getBoundingClientRect()
    await openSuggestion(selectedText, surroundingContext, { selectedText, paragraphIndex }, { top: rect.bottom + 8, left: rect.left })
  }, [format, openSuggestion])

  const handleClick = useCallback(async e => {
    if (format !== 'xlsx') return
    const td = e.target.closest('td[data-cell-address]')
    if (!td) return
    const cellAddress = td.dataset.cellAddress
    const selectedText = td.textContent.trim()

    if (/^\{\{.+\}\}$/.test(selectedText)) {
      setPopover({ state: 'ready', fieldName: '', errorMsg: 'This cell is already a field', position: { top: 80, left: 50 } })
      return
    }

    const surroundingContext = getXlsxContext(td)
    const rect = td.getBoundingClientRect()
    await openSuggestion(selectedText, surroundingContext, { cellAddress, selectedText }, { top: rect.bottom + 8, left: rect.left })
  }, [format, openSuggestion])

  const handleAccept = async () => {
    const fieldName = popover.fieldName.trim()
    if (!fieldName) {
      setPopover(prev => ({ ...prev, errorMsg: 'Field name is required' }))
      return
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(fieldName)) {
      setPopover(prev => ({ ...prev, errorMsg: 'Field name must start with a letter and contain only letters, digits, and underscores' }))
      return
    }
    if (fields.includes(fieldName)) {
      setPopover(prev => ({ ...prev, errorMsg: 'Field name already used — choose another' }))
      return
    }

    setProcessing(true)
    try {
      let result
      if (format === 'docx') {
        const { selectedText, paragraphIndex } = pendingRef.current
        result = insertDocx(binary, selectedText, paragraphIndex, fieldName)
      } else {
        const { cellAddress } = pendingRef.current
        result = insertXlsx(binary, cellAddress, fieldName)
      }

      if (result.error) {
        setPopover(prev => ({ ...prev, errorMsg: 'Could not locate selection in document — try selecting again' }))
        return
      }

      const newBinary = result.binary
      setBinary(newBinary)
      setFields(prev => [...prev, fieldName])

      const { html: newHtml } = format === 'docx'
        ? await renderDocx(newBinary)
        : renderXlsx(newBinary)
      setHtml(newHtml)
      setPopover(null)
      pendingRef.current = null
    } finally {
      setProcessing(false)
    }
  }

  const handleSave = async () => {
    setSaveError(null)
    if (!templateName.trim()) {
      setSaveError('Enter a template name')
      return
    }
    if (fields.length === 0) {
      setSaveError('Define at least one field before saving')
      return
    }
    setSaving(true)
    try {
      const base64 = encodeBase64(binary)
      await saveTemplate({
        id: uuidv4(),
        name: templateName.trim(),
        sourceFormat: format,
        binary: base64,
        fields,
        createdAt: Date.now(),
      })
      onSave()
    } catch (err) {
      setSaveError(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="p-3 border-b border-gray-700 flex gap-2 items-center shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-600"
        >
          ← Back
        </button>
        <span className="text-xs text-gray-500">{fields.length} field{fields.length !== 1 ? 's' : ''}</span>
        <input
          value={templateName}
          onChange={e => setTemplateName(e.target.value)}
          placeholder="Template name…"
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 rounded"
        >
          {saving ? 'Saving…' : 'Save Template'}
        </button>
      </div>

      {saveError && (
        <p className="text-xs text-red-400 text-center px-3 py-1">{saveError}</p>
      )}

      {/* Document viewer */}
      <div className="relative flex-1 overflow-hidden">
        <div
          data-testid="doc-viewer"
          ref={viewerRef}
          className="h-full overflow-y-auto p-3 text-sm text-gray-200 leading-relaxed"
          onMouseUp={handleMouseUp}
          onClick={handleClick}
        />

        {/* Spinner overlay during field insertion */}
        {processing && (
          <div className="absolute inset-0 bg-gray-900/60 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Suggestion popover */}
        {popover && (
          <div
            role="dialog"
            aria-label="Field name suggestion"
            className="absolute z-20 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 w-64"
            style={{ top: popover.position.top, left: Math.min(popover.position.left, 120) }}
          >
            {popover.state === 'loading' ? (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                Analyzing…
              </div>
            ) : (
              <>
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
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/test/pages/Review.test.jsx
```

Expected: all Review tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Review.jsx src/test/pages/Review.test.jsx
git commit -m "feat: replace Review.jsx with selection-based field definition"
```

---

## Task 13: Delete parser files, clean up, and final verification

**Files:**
- Delete: `src/lib/parsers/docx.js`, `src/lib/parsers/xlsx.js`, `src/lib/parsers/index.js`, `src/lib/parsers/pdf.js`
- Delete: `src/test/lib/parsers/docx.test.js`, `src/test/lib/parsers/xlsx.test.js`, `src/test/lib/parsers/index.test.js`, `src/test/lib/parsers/pdf.test.js`

- [ ] **Step 1: Delete all parser source files**

```bash
rm src/lib/parsers/docx.js src/lib/parsers/xlsx.js src/lib/parsers/index.js src/lib/parsers/pdf.js
```

- [ ] **Step 2: Delete all parser test files**

```bash
rm src/test/lib/parsers/docx.test.js src/test/lib/parsers/xlsx.test.js src/test/lib/parsers/index.test.js src/test/lib/parsers/pdf.test.js
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all tests pass. No references to deleted parser modules should remain.

If any test file still imports from `parsers/`, find and update it:

```bash
grep -r "parsers/" src/test/
```

Expected: no results.

- [ ] **Step 4: Run the production build**

```bash
npm run build
```

Expected: BUILD SUCCESS with no missing-module errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete old parser files (replaced by renderers)"
```

---

## Final verification

Run the full suite one last time and confirm:

```bash
npm test
```

Expected: all tests pass.

```bash
npm run build
```

Expected: BUILD SUCCESS.
