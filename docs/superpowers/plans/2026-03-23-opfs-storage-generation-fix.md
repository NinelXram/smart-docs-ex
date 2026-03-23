# OPFS Storage + XLSX Generation Fidelity Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace chrome.storage.local template storage with OPFS (no size limit, real binary files) and fix XLSX generation to use PizZip surgery instead of SheetJS round-trip (preserves images, drawings, themes, fonts).

**Architecture:** Templates stored as `{id}.bin` + `{id}.meta.json` files under an OPFS `templates/` directory with an `index.json` manifest. XLSX generation opens the binary with PizZip, patches only `sharedStrings.xml` and inline-string cells, then regenerates the zip without touching any other entries. Output is delivered via `showSaveFilePicker`.

**Tech Stack:** Vitest, React Testing Library, PizZip, DOMParser/XMLSerializer, File System Access API (OPFS + showSaveFilePicker)

---

## File Map

| File | Action | Responsibility after change |
|------|--------|----------------------------|
| `src/test/setup.js` | Modify | Add in-memory OPFS mock alongside existing chrome.storage mock |
| `src/lib/storage.js` | Rewrite | OPFS reads/writes, `checkOpfsAvailable`, `getTemplateBinary`, migration |
| `src/test/lib/storage.test.js` | Rewrite | Tests for new OPFS-backed API |
| `src/lib/templateEngine.js` | Modify | `generateXlsx` PizZip surgery; `saveFile` replaces exported `downloadBlob` |
| `src/test/lib/templateEngine.test.js` | Modify | Remove XLSX mock, add PizZip fixture tests; test `saveFile` |
| `src/App.jsx` | Modify | Add `opfsError` state + `useEffect` for `checkOpfsAvailable` |
| `src/test/App.test.jsx` | Modify | Add test for OPFS-unavailable full-screen error |
| `src/pages/Review.jsx` | Modify | Remove `encodeBase64`; pass raw `ArrayBuffer` to `saveTemplate` |
| `src/test/pages/Review.test.jsx` | Modify | Assert `binary: expect.any(ArrayBuffer)` instead of `String` |
| `src/pages/Library.jsx` | Modify | Fix `tpl.variables` → `tpl.fields` (pre-existing bug) |
| `src/test/pages/Library.test.jsx` | Modify | Update fixture data to use `fields` |
| `src/pages/Generate.jsx` | Modify | Load binary via `getTemplateBinary` on mount; call `saveFile` |
| `src/test/pages/Generate.test.jsx` | Modify | Mock `getTemplateBinary`; assert `saveFile` instead of `downloadBlob` |

---

## Task 1: Add OPFS Mock to `src/test/setup.js`

**Files:**
- Modify: `src/test/setup.js`

This mock intercepts `navigator.storage.getDirectory()` and returns an in-memory directory handle backed by a `Map`. It is reset in `beforeEach` alongside the existing chrome.storage mock.

- [ ] **Step 1.1: Add OPFS mock factory and wire it into `beforeEach`**

Replace the contents of `src/test/setup.js` with:

```js
import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

// ─── OPFS Mock ─────────────────────────────────────────────────────────────
function createOpfsMock() {
  const files = new Map() // 'prefix/filename' → string | Uint8Array

  function makeFileHandle(path) {
    return {
      getFile: vi.fn(async () => {
        if (!files.has(path)) {
          throw Object.assign(new Error(`File not found: ${path}`), { name: 'NotFoundError' })
        }
        const data = files.get(path)
        return {
          arrayBuffer: async () => {
            if (data instanceof Uint8Array) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
            return new TextEncoder().encode(data).buffer
          },
          text: async () => {
            if (typeof data === 'string') return data
            return new TextDecoder().decode(data)
          },
        }
      }),
      createWritable: vi.fn(async () => {
        let written = null
        return {
          write: vi.fn(async (data) => { written = data }),
          close: vi.fn(async () => {
            if (written instanceof ArrayBuffer) {
              files.set(path, new Uint8Array(written))
            } else if (written instanceof Uint8Array) {
              files.set(path, written)
            } else {
              files.set(path, written) // string
            }
          }),
        }
      }),
    }
  }

  function makeDirHandle(prefix) {
    return {
      getFileHandle: vi.fn(async (name, opts = {}) => {
        const path = `${prefix}/${name}`
        if (!opts?.create && !files.has(path)) {
          throw Object.assign(new Error(`File not found: ${path}`), { name: 'NotFoundError' })
        }
        return makeFileHandle(path)
      }),
      getDirectoryHandle: vi.fn(async (name) => makeDirHandle(`${prefix}/${name}`)),
      removeEntry: vi.fn(async (name) => { files.delete(`${prefix}/${name}`) }),
      _files: files, // expose for assertions in tests
    }
  }

  const root = makeDirHandle('root')
  return { root, files }
}
// ───────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset chrome.storage mock data between tests
  const store = {}

  global.chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          if (Array.isArray(keys)) {
            return keys.reduce((acc, k) => {
              if (k in store) acc[k] = store[k]
              return acc
            }, {})
          }
          return store[keys] !== undefined ? { [keys]: store[keys] } : {}
        }),
        set: vi.fn(async (items) => {
          Object.assign(store, items)
        }),
        remove: vi.fn(async (keys) => {
          const ks = Array.isArray(keys) ? keys : [keys]
          ks.forEach(k => delete store[k])
        }),
      },
    },
    runtime: {
      getURL: vi.fn(path => `chrome-extension://fake-extension-id/${path}`),
    },
  }

  // Reset OPFS mock
  const opfs = createOpfsMock()
  global.navigator = {
    ...global.navigator,
    storage: {
      getDirectory: vi.fn(async () => opfs.root),
    },
  }
})
```

- [ ] **Step 1.2: Run all existing tests to verify nothing broke**

```bash
npx vitest run
```

Expected: all existing tests pass. If any test relied on `downloadBlob` being exported from `templateEngine.js`, note it — it will be addressed in Task 5.

- [ ] **Step 1.3: Commit**

```bash
git add src/test/setup.js
git commit -m "test: add in-memory OPFS mock to test setup"
```

---

## Task 2: Rewrite `storage.js` — Core OPFS API (TDD)

**Files:**
- Modify: `src/test/lib/storage.test.js`
- Rewrite: `src/lib/storage.js`

The new storage module stores templates as OPFS binary files. `getTemplates()` returns metadata only (no binary). `getTemplateBinary(id)` loads the file lazily.

- [ ] **Step 2.1: Rewrite `src/test/lib/storage.test.js`**

```js
import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveApiKey,
  getApiKey,
  checkOpfsAvailable,
  saveTemplate,
  getTemplates,
  getTemplateBinary,
  deleteTemplate,
} from '../../lib/storage.js'

// Binary helper — 4-byte ArrayBuffer
function makeBuffer(bytes = [1, 2, 3, 4]) {
  return new Uint8Array(bytes).buffer
}

const META = {
  id: 'test-id-1',
  name: 'Sales Contract',
  sourceFormat: 'docx',
  fields: ['ClientName', 'EffectiveDate'],
  createdAt: 1000000,
}

describe('getApiKey / saveApiKey', () => {
  it('returns null when no key is stored', async () => {
    expect(await getApiKey()).toBeNull()
  })

  it('stores and retrieves the API key', async () => {
    await saveApiKey('my-secret-key')
    expect(await getApiKey()).toBe('my-secret-key')
  })

  it('overwrites the previous key', async () => {
    await saveApiKey('old-key')
    await saveApiKey('new-key')
    expect(await getApiKey()).toBe('new-key')
  })
})

describe('checkOpfsAvailable', () => {
  it('resolves when navigator.storage.getDirectory is available', async () => {
    await expect(checkOpfsAvailable()).resolves.toBeUndefined()
  })

  it('rejects when navigator.storage is unavailable', async () => {
    const orig = global.navigator.storage
    global.navigator = { ...global.navigator, storage: undefined }
    await expect(checkOpfsAvailable()).rejects.toThrow()
    global.navigator = { ...global.navigator, storage: orig }
  })
})

describe('saveTemplate / getTemplates', () => {
  it('returns empty array when no templates exist', async () => {
    expect(await getTemplates()).toEqual([])
  })

  it('saves and retrieves template metadata (no binary)', async () => {
    await saveTemplate({ ...META, binary: makeBuffer() })
    const list = await getTemplates()
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual(META)          // no binary field
    expect(list[0].binary).toBeUndefined()
  })

  it('saves multiple templates', async () => {
    await saveTemplate({ ...META, id: 'id-1', name: 'A', binary: makeBuffer() })
    await saveTemplate({ ...META, id: 'id-2', name: 'B', binary: makeBuffer() })
    expect(await getTemplates()).toHaveLength(2)
  })

  it('updates metadata when id matches', async () => {
    await saveTemplate({ ...META, name: 'Original', binary: makeBuffer() })
    await saveTemplate({ ...META, name: 'Updated', binary: makeBuffer([5, 6, 7, 8]) })
    const list = await getTemplates()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Updated')
  })
})

describe('getTemplateBinary', () => {
  it('returns the stored ArrayBuffer', async () => {
    const buf = makeBuffer([10, 20, 30])
    await saveTemplate({ ...META, binary: buf })
    const result = await getTemplateBinary(META.id)
    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(result)).toEqual(new Uint8Array([10, 20, 30]))
  })

  it('throws when template binary is not found', async () => {
    await expect(getTemplateBinary('nonexistent-id')).rejects.toThrow()
  })
})

describe('deleteTemplate', () => {
  it('removes a template by id', async () => {
    await saveTemplate({ ...META, id: 'keep', binary: makeBuffer() })
    await saveTemplate({ ...META, id: 'remove', binary: makeBuffer() })
    await deleteTemplate('remove')
    const list = await getTemplates()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('keep')
  })

  it('does nothing when id does not exist', async () => {
    await saveTemplate({ ...META, binary: makeBuffer() })
    await deleteTemplate('nonexistent')
    expect(await getTemplates()).toHaveLength(1)
  })

  it('binary is no longer retrievable after delete', async () => {
    await saveTemplate({ ...META, binary: makeBuffer() })
    await deleteTemplate(META.id)
    await expect(getTemplateBinary(META.id)).rejects.toThrow()
  })
})
```

- [ ] **Step 2.2: Run tests to confirm they all fail (expected — storage.js unchanged)**

```bash
npx vitest run src/test/lib/storage.test.js
```

Expected: most tests fail. `getApiKey`/`saveApiKey` tests may still pass (chrome.storage path unchanged).

- [ ] **Step 2.3: Rewrite `src/lib/storage.js`**

```js
const API_KEY_KEY = 'apiKey'

// ─── OPFS helpers ────────────────────────────────────────────────────────────

async function getTemplatesDir() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('templates', { create: true })
}

async function readJson(dir, name) {
  try {
    const fh = await dir.getFileHandle(name)
    const file = await fh.getFile()
    return JSON.parse(await file.text())
  } catch (e) {
    if (e.name === 'NotFoundError') return null
    throw e
  }
}

async function writeJson(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable({ keepExistingData: false })
  await w.write(JSON.stringify(data))
  await w.close()
}

async function readIndex(dir) {
  return (await readJson(dir, 'index.json')) ?? []
}

async function writeIndex(dir, ids) {
  await writeJson(dir, 'index.json', ids)
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function checkOpfsAvailable() {
  await navigator.storage.getDirectory()
}

export async function saveApiKey(key) {
  await chrome.storage.local.set({ [API_KEY_KEY]: key })
}

export async function getApiKey() {
  const result = await chrome.storage.local.get([API_KEY_KEY])
  return result[API_KEY_KEY] ?? null
}

export async function saveTemplate(template) {
  const { binary, ...meta } = template
  const dir = await getTemplatesDir()

  // Write binary
  const fh = await dir.getFileHandle(`${meta.id}.bin`, { create: true })
  const w = await fh.createWritable({ keepExistingData: false })
  await w.write(binary)
  await w.close()

  // Write metadata
  await writeJson(dir, `${meta.id}.meta.json`, meta)

  // Update index
  const ids = await readIndex(dir)
  if (!ids.includes(meta.id)) {
    ids.push(meta.id)
    await writeIndex(dir, ids)
  } else {
    // id already in index — meta updated in place, index unchanged
  }
}

export async function getTemplates() {
  const dir = await getTemplatesDir()
  const ids = await readIndex(dir)
  const metas = []
  for (const id of ids) {
    const meta = await readJson(dir, `${id}.meta.json`)
    if (meta) metas.push(meta)
  }
  return metas
}

export async function getTemplateBinary(id) {
  const dir = await getTemplatesDir()
  const fh = await dir.getFileHandle(`${id}.bin`)
  const file = await fh.getFile()
  return file.arrayBuffer()
}

export async function deleteTemplate(id) {
  const dir = await getTemplatesDir()

  // Step 1 & 2: delete files (ignore NotFoundError)
  for (const name of [`${id}.bin`, `${id}.meta.json`]) {
    try {
      await dir.removeEntry(name)
    } catch (e) {
      if (e.name !== 'NotFoundError') throw e
    }
  }

  // Step 3: update index
  const ids = await readIndex(dir)
  await writeIndex(dir, ids.filter(i => i !== id))
}

// ─── Migration ───────────────────────────────────────────────────────────────
// Runs once: moves legacy chrome.storage.local templates to OPFS.
// Called internally from getTemplates() on first run.

export async function migrateFromChromeStorage() {
  const result = await chrome.storage.local.get(['templates'])
  const legacy = result.templates
  if (!Array.isArray(legacy) || legacy.length === 0) return

  for (const t of legacy) {
    try {
      // Decode base64 binary
      const binaryStr = atob(t.binary)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
      const buffer = bytes.buffer

      // Check idempotency: skip if already migrated
      const dir = await getTemplatesDir()
      try {
        await dir.getFileHandle(`${t.id}.bin`)
        continue // already exists
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e
      }

      await saveTemplate({ ...t, binary: buffer })

      // Remove this entry from chrome.storage
      const current = await chrome.storage.local.get(['templates'])
      const remaining = (current.templates ?? []).filter(x => x.id !== t.id)
      await chrome.storage.local.set({ templates: remaining })
    } catch (e) {
      console.warn(`[storage] Migration failed for template ${t.id}:`, e)
    }
  }

  // If all migrated, remove the key entirely
  const final = await chrome.storage.local.get(['templates'])
  if (!Array.isArray(final.templates) || final.templates.length === 0) {
    await chrome.storage.local.remove(['templates'])
  }
}
```

- [ ] **Step 2.4: Run storage tests to verify they pass**

```bash
npx vitest run src/test/lib/storage.test.js
```

Expected: all tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/storage.js src/test/lib/storage.test.js
git commit -m "feat: rewrite storage.js with OPFS backend and getTemplateBinary"
```

---

## Task 3: Add Migration Test

**Files:**
- Modify: `src/test/lib/storage.test.js`

- [ ] **Step 3.1: Add migration tests to storage.test.js**

Append this block to `src/test/lib/storage.test.js`:

```js
describe('migrateFromChromeStorage', () => {
  it('migrates legacy base64 templates to OPFS', async () => {
    // Arrange: put a base64-encoded template in chrome.storage mock
    const bytes = new Uint8Array([9, 8, 7])
    const base64 = btoa(String.fromCharCode(...bytes))
    const legacy = [{ id: 'legacy-1', name: 'Old', sourceFormat: 'xlsx', binary: base64, fields: ['X'], createdAt: 1 }]
    await chrome.storage.local.set({ templates: legacy })

    // Act
    const { migrateFromChromeStorage } = await import('../../lib/storage.js')
    await migrateFromChromeStorage()

    // Assert: template is now in OPFS
    const list = await getTemplates()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('legacy-1')

    // Assert: binary is retrievable
    const bin = await getTemplateBinary('legacy-1')
    expect(new Uint8Array(bin)).toEqual(bytes)

    // Assert: chrome.storage.local templates key is removed
    const stored = await chrome.storage.local.get(['templates'])
    expect(stored.templates).toBeUndefined()
  })

  it('is idempotent — does not duplicate if run twice', async () => {
    const base64 = btoa(String.fromCharCode(1, 2))
    await chrome.storage.local.set({
      templates: [{ id: 'dup-1', name: 'D', sourceFormat: 'docx', binary: base64, fields: [], createdAt: 1 }],
    })
    const { migrateFromChromeStorage } = await import('../../lib/storage.js')
    await migrateFromChromeStorage()
    await migrateFromChromeStorage() // run twice
    expect(await getTemplates()).toHaveLength(1)
  })

  it('skips corrupt entries and continues', async () => {
    await chrome.storage.local.set({
      templates: [
        { id: 'bad', name: 'Bad', sourceFormat: 'docx', binary: '!!!not-base64!!!', fields: [], createdAt: 1 },
        { id: 'good', name: 'Good', sourceFormat: 'docx', binary: btoa('x'), fields: [], createdAt: 2 },
      ],
    })
    const { migrateFromChromeStorage } = await import('../../lib/storage.js')
    await migrateFromChromeStorage()
    const list = await getTemplates()
    expect(list.map(t => t.id)).toContain('good')
  })
})
```

- [ ] **Step 3.2: Run migration tests**

```bash
npx vitest run src/test/lib/storage.test.js
```

Expected: all pass.

- [ ] **Step 3.3: Commit**

```bash
git add src/test/lib/storage.test.js
git commit -m "test: add migration tests for OPFS storage"
```

---

## Task 4: Rewrite `generateXlsx` with PizZip Surgery (TDD)

**Files:**
- Modify: `src/test/lib/templateEngine.test.js`
- Modify: `src/lib/templateEngine.js`

The new `generateXlsx` uses PizZip to patch only token cells — every other zip entry (drawings, media, theme) is preserved unchanged.

- [ ] **Step 4.1: Update `src/test/lib/templateEngine.test.js` — remove XLSX mock, add PizZip fixture tests**

Replace the entire file contents:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PizZip from 'pizzip'
import * as XLSX from 'xlsx'
import { generateDocx, generateXlsx, saveFile } from '../../lib/templateEngine.js'

// ─── XLSX fixture helpers (same pattern as fieldEditor.test.js) ───────────

function buildXlsx(sheets) {
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

// Build a PizZip-level XLSX fixture with a drawing entry and a token cell
function buildXlsxWithToken(tokenCell = 'A1', fieldName = 'ClientName') {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`)
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="${tokenCell}" t="s"><v>0</v></c></row>
  </sheetData>
</worksheet>`)
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1">
  <si><t>{{${fieldName}}}</t></si>
</sst>`)
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8"?><root/>`)
  return zip.generate({ type: 'arraybuffer' })
}

// ─── generateDocx ─────────────────────────────────────────────────────────

vi.mock('pizzip', async (importOriginal) => importOriginal())
vi.mock('docxtemplater', () => {
  const Docxtemplater = vi.fn().mockImplementation(() => ({
    render: vi.fn(),
    getZip: vi.fn().mockReturnValue({
      generate: vi.fn().mockResolvedValue(new Blob(['docx'])),
    }),
  }))
  return { default: Docxtemplater }
})

describe('generateDocx', () => {
  it('returns a Blob', async () => {
    const buffer = new ArrayBuffer(8)
    const blob = await generateDocx(buffer, { ClientName: 'Acme Corp' })
    expect(blob).toBeInstanceOf(Blob)
  })
})

// ─── generateXlsx ────────────────────────────────────────────────────────

describe('generateXlsx', () => {
  it('returns a Blob', async () => {
    const binary = buildXlsxWithToken()
    const blob = await generateXlsx(binary, { ClientName: 'Acme Corp' })
    expect(blob).toBeInstanceOf(Blob)
  })

  it('replaces {{FieldName}} shared-string token with value', async () => {
    const binary = buildXlsxWithToken('A1', 'ClientName')
    const blob = await generateXlsx(binary, { ClientName: 'Acme Corp' })
    const buf = await blob.arrayBuffer()
    expect(readXlsxCell(buf, 'Sheet1', 'A1')).toBe('Acme Corp')
  })

  it('leaves non-token cells unchanged', async () => {
    // Build a file with A1 = token and B1 = static text
    const zip = new PizZip()
    zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`)
    zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
    zip.file('xl/workbook.xml', `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`)
    zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`)
    zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>`)
    zip.file('xl/sharedStrings.xml', `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>{{ClientName}}</t></si><si><t>Static Value</t></si></sst>`)
    const binary = zip.generate({ type: 'arraybuffer' })

    const blob = await generateXlsx(binary, { ClientName: 'Acme Corp' })
    const buf = await blob.arrayBuffer()
    expect(readXlsxCell(buf, 'Sheet1', 'A1')).toBe('Acme Corp')
    expect(readXlsxCell(buf, 'Sheet1', 'B1')).toBe('Static Value')
  })

  it('preserves drawing entry in the output zip', async () => {
    const binary = buildXlsxWithToken()
    const blob = await generateXlsx(binary, { ClientName: 'Acme Corp' })
    const buf = await blob.arrayBuffer()
    const outZip = new PizZip(buf)
    expect(Object.keys(outZip.files)).toContain('xl/drawings/drawing1.xml')
  })

  it('does not export injectVariables', async () => {
    const mod = await import('../../lib/templateEngine.js')
    expect(mod.injectVariables).toBeUndefined()
  })
})

// ─── saveFile ─────────────────────────────────────────────────────────────

describe('saveFile', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:url'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('calls showSaveFilePicker when available', async () => {
    const mockWritable = { write: vi.fn(), close: vi.fn() }
    const mockHandle = { createWritable: vi.fn().mockResolvedValue(mockWritable) }
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue(mockHandle))

    await saveFile(new Blob(['test']), 'output.xlsx', 'xlsx')
    expect(window.showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'output.xlsx' })
    )
    expect(mockWritable.write).toHaveBeenCalled()
    expect(mockWritable.close).toHaveBeenCalled()
  })

  it('silently ignores AbortError from showSaveFilePicker', async () => {
    const abort = Object.assign(new Error('User cancelled'), { name: 'AbortError' })
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(abort))
    await expect(saveFile(new Blob(['test']), 'output.xlsx', 'xlsx')).resolves.toBeUndefined()
  })

  it('propagates non-AbortError from showSaveFilePicker', async () => {
    const err = new Error('Disk full')
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(err))
    await expect(saveFile(new Blob(['test']), 'output.xlsx', 'xlsx')).rejects.toThrow('Disk full')
  })

  it('falls back to anchor download when showSaveFilePicker is unavailable', async () => {
    vi.stubGlobal('showSaveFilePicker', undefined)
    const mockAnchor = { href: '', download: '', click: vi.fn() }
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor)
    await saveFile(new Blob(['test']), 'output.docx', 'docx')
    expect(mockAnchor.download).toBe('output.docx')
    expect(mockAnchor.click).toHaveBeenCalled()
  })
})
```

- [ ] **Step 4.2: Run tests — expect failures on generateXlsx and saveFile (not yet implemented)**

```bash
npx vitest run src/test/lib/templateEngine.test.js
```

Expected: `generateDocx` passes; `generateXlsx` and `saveFile` tests fail.

- [ ] **Step 4.3: Rewrite `src/lib/templateEngine.js`**

```js
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'

/**
 * Generate a filled DOCX from a binary template with {{tokens}}.
 */
export async function generateDocx(binary, values) {
  const zip = new PizZip(binary)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })
  doc.render(values)
  return await doc.getZip().generate({ type: 'blob' })
}

/**
 * Generate a filled XLSX from a binary template with {{tokens}} in cells.
 * Uses PizZip surgery — preserves all non-text entries (drawings, media, theme).
 */
export async function generateXlsx(binary, values) {
  const zip = new PizZip(binary)
  const parser = new DOMParser()
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

  // Enumerate sheet paths via xl/_rels/workbook.xml.rels (same approach as insertXlsx)
  const sheetPaths = []
  const wbRelsXml = zip.files['xl/_rels/workbook.xml.rels']?.asText()
  if (wbRelsXml) {
    const relsDoc = parser.parseFromString(wbRelsXml, 'application/xml')
    for (const rel of Array.from(relsDoc.getElementsByTagName('Relationship'))) {
      const type = rel.getAttribute('Type') ?? ''
      if (type.endsWith('/worksheet')) {
        const target = rel.getAttribute('Target')
        if (target) sheetPaths.push(`xl/${target}`)
      }
    }
  }

  // Load shared strings
  const ssPath = 'xl/sharedStrings.xml'
  const ssXml = zip.files[ssPath]?.asText()
  let ssDoc = null
  let siEls = []
  if (ssXml) {
    ssDoc = parser.parseFromString(ssXml, 'application/xml')
    siEls = Array.from(ssDoc.getElementsByTagNameNS(ns, 'si'))
  }

  // Map: shared string index → replacement value (populated while scanning cells)
  const ssUpdates = new Map()

  // Process each sheet
  for (const sheetPath of sheetPaths) {
    const sheetXml = zip.files[sheetPath]?.asText()
    if (!sheetXml) continue
    const sheetDoc = parser.parseFromString(sheetXml, 'application/xml')
    let sheetModified = false

    for (const cell of Array.from(sheetDoc.getElementsByTagNameNS(ns, 'c'))) {
      const t = cell.getAttribute('t')

      if (t === 's' && siEls.length > 0) {
        // Shared string: check the string value at the referenced index
        const vEl = cell.getElementsByTagNameNS(ns, 'v')[0]
        if (!vEl) continue
        const idx = parseInt(vEl.textContent, 10)
        if (isNaN(idx) || idx < 0 || idx >= siEls.length) continue
        const tEls = siEls[idx].getElementsByTagNameNS(ns, 't')
        if (!tEls.length) continue
        const text = tEls[0].textContent
        const match = text.match(/^\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}$/)
        if (match && match[1] in values) {
          ssUpdates.set(idx, values[match[1]])
        }
      } else if (t === 'inlineStr') {
        // Inline string: patch directly in sheet XML
        const isEl = cell.getElementsByTagNameNS(ns, 'is')[0]
        if (!isEl) continue
        const tEl = isEl.getElementsByTagNameNS(ns, 't')[0]
        if (!tEl) continue
        const match = tEl.textContent.match(/^\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}$/)
        if (match && match[1] in values) {
          tEl.textContent = values[match[1]]
          sheetModified = true
        }
      }
    }

    if (sheetModified) {
      zip.file(sheetPath, new XMLSerializer().serializeToString(sheetDoc))
    }
  }

  // Apply shared string updates
  if (ssDoc && ssUpdates.size > 0) {
    for (const [idx, value] of ssUpdates) {
      const tEls = siEls[idx].getElementsByTagNameNS(ns, 't')
      if (tEls.length) tEls[0].textContent = value
    }
    zip.file(ssPath, new XMLSerializer().serializeToString(ssDoc))
  }

  return zip.generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * Save a Blob to disk.
 * Uses showSaveFilePicker when available; falls back to anchor-click download.
 * AbortError (user cancel) is silently swallowed. All other errors propagate.
 */
export async function saveFile(blob, suggestedName, format) {
  const mimeMap = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{
          description: format.toUpperCase() + ' Document',
          accept: { [mimeMap[format]]: ['.' + format] },
        }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
    } catch (err) {
      if (err.name === 'AbortError') return
      throw err
    }
  } else {
    downloadBlob(blob, suggestedName)
  }
}

// Private fallback — not exported
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4.4: Run all templateEngine tests**

```bash
npx vitest run src/test/lib/templateEngine.test.js
```

Expected: all pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/templateEngine.js src/test/lib/templateEngine.test.js
git commit -m "feat: rewrite generateXlsx with PizZip surgery; add saveFile"
```

---

## Task 5: Update `App.jsx` — OPFS Error State

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/test/App.test.jsx`

- [ ] **Step 5.1: Read `src/test/App.test.jsx` to understand existing tests**

(Read the file — do not skip this step. Verify what is already tested before adding.)

- [ ] **Step 5.2: Add OPFS-unavailable test to `src/test/App.test.jsx`**

Add the following import and test block (do not replace existing tests):

```js
// At the top of the file, add this import if not already present:
import { vi } from 'vitest'

// Add this describe block:
describe('App — OPFS unavailable', () => {
  it('renders full-screen error when OPFS is unavailable', async () => {
    vi.spyOn(navigator.storage, 'getDirectory').mockRejectedValueOnce(
      new Error('OPFS not supported')
    )
    render(<App />)
    await waitFor(() =>
      expect(screen.getByText(/browser file system support required/i)).toBeInTheDocument()
    )
  })
})
```

- [ ] **Step 5.3: Run the new test — expect it to fail**

```bash
npx vitest run src/test/App.test.jsx
```

Expected: the new test fails (App.jsx not yet updated).

- [ ] **Step 5.4: Update `src/App.jsx`**

Add `opfsError` state and `checkOpfsAvailable` effect. The existing `getApiKey` effect is **not** modified.

Find this line:

```js
  const [toast, setToast] = useState(null)
```

Add after it:

```js
  const [opfsError, setOpfsError] = useState(false)
```

Find this import:

```js
import { getApiKey } from './lib/storage.js'
```

Replace with:

```js
import { getApiKey, checkOpfsAvailable } from './lib/storage.js'
```

Add a new `useEffect` after the existing one (after the closing `}, [])` of the `getApiKey` effect):

```js
  useEffect(() => {
    checkOpfsAvailable().catch(() => setOpfsError(true))
  }, [])
```

Add the error screen render just before the loading screen check (`if (step === null)`):

```js
  if (opfsError) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white text-sm text-center px-6">
        <p>Browser file system support required. Please update Chrome.</p>
      </div>
    )
  }
```

- [ ] **Step 5.5: Run App tests**

```bash
npx vitest run src/test/App.test.jsx
```

Expected: all pass including the new test.

- [ ] **Step 5.6: Commit**

```bash
git add src/App.jsx src/test/App.test.jsx
git commit -m "feat: add OPFS availability check and full-screen error in App"
```

---

## Task 6: Update `Review.jsx` — Remove `encodeBase64`

**Files:**
- Modify: `src/pages/Review.jsx`
- Modify: `src/test/pages/Review.test.jsx`

- [ ] **Step 6.1: Update the assertion in `src/test/pages/Review.test.jsx`**

Find this line (around line 226):

```js
          binary: expect.any(String), // base64 string
```

Replace with:

```js
          binary: expect.any(ArrayBuffer),
```

Also update the test description nearby from `'saves template with base64-encoded binary'` to `'saves template with raw ArrayBuffer binary'`.

- [ ] **Step 6.2: Run the Review test — expect the binary assertion to fail**

```bash
npx vitest run src/test/pages/Review.test.jsx
```

Expected: the `saves template with raw ArrayBuffer binary` test fails.

- [ ] **Step 6.3: Update `src/pages/Review.jsx` — remove `encodeBase64`**

Delete the `encodeBase64` function definition (lines 14–18):

```js
function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
```

In `handleSave`, replace:

```js
      const base64 = encodeBase64(binary)
      await saveTemplate({
        id: uuidv4(),
        name: templateName.trim(),
        sourceFormat: format,
        binary: base64,
        fields,
        createdAt: Date.now(),
      })
```

With:

```js
      await saveTemplate({
        id: uuidv4(),
        name: templateName.trim(),
        sourceFormat: format,
        binary,
        fields,
        createdAt: Date.now(),
      })
```

- [ ] **Step 6.4: Run Review tests**

```bash
npx vitest run src/test/pages/Review.test.jsx
```

Expected: all pass.

- [ ] **Step 6.5: Commit**

```bash
git add src/pages/Review.jsx src/test/pages/Review.test.jsx
git commit -m "feat: pass raw ArrayBuffer to saveTemplate — remove encodeBase64"
```

---

## Task 7: Fix `Library.jsx` — `tpl.variables` → `tpl.fields`

**Files:**
- Modify: `src/pages/Library.jsx`
- Modify: `src/test/pages/Library.test.jsx`

- [ ] **Step 7.1: Update `src/test/pages/Library.test.jsx` fixture data**

Find the `TEMPLATES` array at the top of the file. Replace both template objects — change `variables: [...]` to `fields: ['ClientName', 'Date']` and `fields: ['Party']` respectively:

```js
const TEMPLATES = [
  {
    id: 'id-1',
    name: 'Sales Contract',
    sourceFormat: 'docx',
    fields: ['ClientName', 'Date'],
    createdAt: 1000000000000,
  },
  {
    id: 'id-2',
    name: 'NDA',
    sourceFormat: 'pdf',
    fields: ['Party'],
    createdAt: 1100000000000,
  },
]
```

Also check if any test assertions reference `variables` count (e.g. "2 variables") and update them to match `fields` terminology.

- [ ] **Step 7.2: Run Library tests — expect field-count assertions to fail**

```bash
npx vitest run src/test/pages/Library.test.jsx
```

Expected: tests checking variable/field counts fail because `Library.jsx` still reads `tpl.variables`.

- [ ] **Step 7.3: Fix `src/pages/Library.jsx` line 60**

Find:

```js
              {(tpl.variables ?? []).length} variable{(tpl.variables ?? []).length !== 1 ? 's' : ''}
```

Replace with:

```js
              {(tpl.fields ?? []).length} field{(tpl.fields ?? []).length !== 1 ? 's' : ''}
```

- [ ] **Step 7.4: Run Library tests**

```bash
npx vitest run src/test/pages/Library.test.jsx
```

Expected: all pass.

- [ ] **Step 7.5: Commit**

```bash
git add src/pages/Library.jsx src/test/pages/Library.test.jsx
git commit -m "fix: tpl.variables → tpl.fields in Library card"
```

---

## Task 8: Update `Generate.jsx` — `getTemplateBinary` + `saveFile`

**Files:**
- Modify: `src/pages/Generate.jsx`
- Modify: `src/test/pages/Generate.test.jsx`

- [ ] **Step 8.1: Rewrite `src/test/pages/Generate.test.jsx`**

```js
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/templateEngine.js', () => ({
  generateDocx: vi.fn(),
  generateXlsx: vi.fn(),
  saveFile: vi.fn(),
}))

vi.mock('../../lib/storage.js', () => ({
  getTemplateBinary: vi.fn(),
}))

import Generate from '../../pages/Generate.jsx'
import * as engine from '../../lib/templateEngine.js'
import * as storage from '../../lib/storage.js'

function makeBuffer() {
  return new Uint8Array([0, 1, 2, 3]).buffer
}

const TEMPLATE_DOCX = {
  id: 'id-1',
  name: 'Sales Contract',
  sourceFormat: 'docx',
  fields: ['ClientName', 'EffectiveDate'],
  createdAt: 1774148866000,
}

const TEMPLATE_XLSX = {
  id: 'id-2',
  name: 'Budget',
  sourceFormat: 'xlsx',
  fields: ['Quarter', 'Amount'],
  createdAt: 1774148866000,
}

beforeEach(() => {
  vi.clearAllMocks()
  storage.getTemplateBinary.mockResolvedValue(makeBuffer())
})

describe('Generate', () => {
  it('renders one input per field name', async () => {
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByLabelText('ClientName')).toBeInTheDocument()
      expect(screen.getByLabelText('EffectiveDate')).toBeInTheDocument()
    })
  })

  it('does not render a format selector', async () => {
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(storage.getTemplateBinary).toHaveBeenCalled())
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('calls generateDocx with binary and values for DOCX template', async () => {
    engine.generateDocx.mockResolvedValue(new Blob(['docx']))
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(storage.getTemplateBinary).toHaveBeenCalledWith('id-1'))

    fireEvent.change(screen.getByLabelText('ClientName'), { target: { value: 'Acme Corp' } })
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => {
      expect(engine.generateDocx).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        { ClientName: 'Acme Corp', EffectiveDate: '' }
      )
      expect(engine.saveFile).toHaveBeenCalledWith(
        expect.any(Blob), 'Sales Contract.docx', 'docx'
      )
    })
  })

  it('calls generateXlsx for XLSX template', async () => {
    engine.generateXlsx.mockResolvedValue(new Blob(['xlsx']))
    render(<Generate template={TEMPLATE_XLSX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(storage.getTemplateBinary).toHaveBeenCalledWith('id-2'))

    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => {
      expect(engine.generateXlsx).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        { Quarter: '', Amount: '' }
      )
      expect(engine.saveFile).toHaveBeenCalledWith(
        expect.any(Blob), 'Budget.xlsx', 'xlsx'
      )
    })
  })

  it('disables download button and shows toast when binary load fails', async () => {
    storage.getTemplateBinary.mockRejectedValue(new Error('File not found'))
    const onToast = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={onToast} />)
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: expect.stringMatching(/not found/i) })
      )
    )
    expect(screen.getByRole('button', { name: /download/i })).toBeDisabled()
  })

  it('calls onBack when back button clicked', async () => {
    const onBack = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={onBack} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })

  it('calls onToast with error when generation fails', async () => {
    engine.generateDocx.mockRejectedValue(new Error('Output generation failed'))
    const onToast = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={onToast} />)
    await waitFor(() => expect(storage.getTemplateBinary).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    )
  })
})
```

- [ ] **Step 8.2: Run Generate tests — expect failures**

```bash
npx vitest run src/test/pages/Generate.test.jsx
```

Expected: most tests fail (Generate.jsx still uses old API).

- [ ] **Step 8.3: Rewrite `src/pages/Generate.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { generateDocx, generateXlsx, saveFile } from '../lib/templateEngine.js'
import { getTemplateBinary } from '../lib/storage.js'

export default function Generate({ template, onBack, onToast }) {
  const [values, setValues] = useState({})
  const [generating, setGenerating] = useState(false)
  const [binary, setBinary] = useState(null)
  const [binaryError, setBinaryError] = useState(false)

  useEffect(() => {
    getTemplateBinary(template.id)
      .then(buf => setBinary(buf))
      .catch(() => {
        setBinaryError(true)
        onToast({ message: 'Template file not found — please re-upload', type: 'error' })
      })
  }, [template.id])

  const handleChange = (name, value) => {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  const handleGenerate = async () => {
    if (!binary) return
    setGenerating(true)
    try {
      const fieldValues = Object.fromEntries(
        template.fields.map(f => [f, values[f] ?? ''])
      )
      let blob
      if (template.sourceFormat === 'docx') {
        blob = await generateDocx(binary, fieldValues)
        await saveFile(blob, `${template.name}.docx`, 'docx')
      } else {
        blob = await generateXlsx(binary, fieldValues)
        await saveFile(blob, `${template.name}.xlsx`, 'xlsx')
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
          disabled={generating || binaryError || !binary}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-1.5 rounded transition-colors"
        >
          {generating ? 'Generating…' : '⬇ Download'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 8.4: Run Generate tests**

```bash
npx vitest run src/test/pages/Generate.test.jsx
```

Expected: all pass.

- [ ] **Step 8.5: Commit**

```bash
git add src/pages/Generate.jsx src/test/pages/Generate.test.jsx
git commit -m "feat: load template binary via OPFS; use saveFile for output"
```

---

## Task 9: Full Test Suite + Verification

**Files:** none changed

- [ ] **Step 9.1: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass. If any test references `downloadBlob` as an export, it will fail — find and update it now.

- [ ] **Step 9.2: Fix any remaining test failures**

Common issues to look for:
- Any test that imports `downloadBlob` from `templateEngine.js` → change to `saveFile`
- Any test that passes `binary: base64string` to `Generate` → update to omit `binary` (it is loaded from storage mock)
- Any storage test that uses the old chrome.storage path for templates

- [ ] **Step 9.3: Commit any fixes**

```bash
git add -p
git commit -m "fix: update remaining tests after storage and engine refactor"
```

- [ ] **Step 9.4: Build the extension to verify no compile errors**

```bash
npm run build
```

Expected: build completes with no errors. Check `dist/` contains the updated assets.

- [ ] **Step 9.5: Final commit if build-only changes needed**

```bash
git add dist/
git commit -m "chore: production build after OPFS migration"
```

---

## Done

All changes are complete. Summary of what was built:

| What | Where |
|------|-------|
| In-memory OPFS mock | `src/test/setup.js` |
| OPFS storage backend | `src/lib/storage.js` |
| PizZip XLSX generation | `src/lib/templateEngine.js` → `generateXlsx` |
| Save As dialog output | `src/lib/templateEngine.js` → `saveFile` |
| OPFS error screen | `src/App.jsx` |
| Raw ArrayBuffer save | `src/pages/Review.jsx` |
| Lazy binary load | `src/pages/Generate.jsx` |
| Field count fix | `src/pages/Library.jsx` |
