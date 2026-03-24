# Chicken Fill Form — Plan 1: Foundation Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and fully test the non-UI foundation: project scaffold, Chrome storage wrapper, file parsers (PDF/DOCX/XLSX), Gemini API client, and template engine. No React components or pages in this plan — those are Plan 2.

**Architecture:** All-in-one Chrome MV3 side panel extension. This plan builds `src/lib/` and all project configuration. Every lib module is a set of pure async functions with no DOM dependencies except `storage.js` (which wraps `chrome.storage.local`). Tests run in Vitest with jsdom and a mocked `chrome` global.

**Tech Stack:** Vite 5, React 18, Tailwind CSS 3, Vitest 2 + jsdom, `@google/generative-ai`, `pdfjs-dist` 4, `mammoth`, `xlsx`, `jspdf`, `docx` (npm), `uuid`

**Spec:** `docs/superpowers/specs/2026-03-22-gemini-doc-template-agent-design.md`

---

## File Map

| File | Responsibility |
|---|---|
| `package.json` | Dependencies + scripts |
| `vite.config.js` | Vite build + Vitest config + extension file copy |
| `tailwind.config.js` / `postcss.config.js` | Tailwind setup |
| `manifest.json` | Chrome MV3 manifest |
| `background.js` | Minimal service worker (open side panel on icon click) |
| `sidepanel.html` | Side panel HTML entry point |
| `src/main.jsx` | React entry (stub for Plan 2) |
| `src/App.jsx` | App root (stub for Plan 2) |
| `src/test/setup.js` | Vitest global setup: mocks `chrome` APIs |
| `src/lib/storage.js` | `chrome.storage.local` wrapper — API key + templates |
| `src/lib/parsers/pdf.js` | pdfjs-dist wrapper → `{ text, pageCount }` |
| `src/lib/parsers/docx.js` | mammoth wrapper → `{ text }` |
| `src/lib/parsers/xlsx.js` | xlsx wrapper → `{ text, sheets }` |
| `src/lib/parsers/index.js` | Format detection + unified `parseFile(file)` |
| `src/lib/gemini.js` | Gemini 1.5 Flash client: `testConnection`, `extractVariables` |
| `src/lib/templateEngine.js` | Variable injection + PDF/DOCX/XLSX output generation |
| `src/test/lib/storage.test.js` | Storage tests |
| `src/test/lib/parsers/pdf.test.js` | PDF parser tests |
| `src/test/lib/parsers/docx.test.js` | DOCX parser tests |
| `src/test/lib/parsers/xlsx.test.js` | XLSX parser tests |
| `src/test/lib/parsers/index.test.js` | Parser index tests |
| `src/test/lib/gemini.test.js` | Gemini client tests |
| `src/test/lib/templateEngine.test.js` | Template engine tests |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`
- Create: `manifest.json`, `background.js`, `sidepanel.html`
- Create: `src/main.jsx`, `src/App.jsx`, `src/index.css`
- Create: `src/test/setup.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "gemini-doc-template-agent",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "docx": "^8.5.0",
    "jspdf": "^2.5.2",
    "mammoth": "^1.8.0",
    "pdfjs-dist": "^4.9.155",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "uuid": "^11.0.5",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.5.1",
    "tailwindcss": "^3.4.17",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no peer dependency errors.

- [ ] **Step 3: Create `vite.config.js`**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, existsSync } from 'fs'

export default defineConfig({
  plugins: [react(), copyExtensionAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
})

function copyExtensionAssets() {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      mkdirSync('dist/icons', { recursive: true })
      copyFileSync('manifest.json', 'dist/manifest.json')
      copyFileSync('background.js', 'dist/background.js')

      // Copy PDF.js worker so it's accessible via chrome.runtime.getURL
      const workerSrc = 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'
      if (existsSync(workerSrc)) {
        copyFileSync(workerSrc, 'dist/pdf.worker.min.mjs')
      }

      // Placeholder icons (replace with real PNGs before publishing)
      ;['icon16.png', 'icon48.png', 'icon128.png'].forEach(name => {
        const dest = `dist/icons/${name}`
        if (!existsSync(dest) && existsSync(`public/icons/${name}`)) {
          copyFileSync(`public/icons/${name}`, dest)
        }
      })
    },
  }
}
```

- [ ] **Step 4: Create `tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./sidepanel.html', './src/**/*.{js,jsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

- [ ] **Step 5: Create `postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 6: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Chicken Fill Form",
  "version": "1.0.0",
  "description": "Parse documents, identify variables, and create reusable templates with Gemini AI.",
  "permissions": ["storage", "unlimitedStorage", "sidePanel"],
  "host_permissions": ["https://generativelanguage.googleapis.com/*"],
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_title": "Open Chicken Fill Form"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "web_accessible_resources": [
    {
      "resources": ["pdf.worker.min.mjs"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

- [ ] **Step 7: Create `background.js`**

```js
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
```

- [ ] **Step 8: Create `sidepanel.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chicken Fill Form</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 9: Create `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 10: Create `src/main.jsx` (stub)**

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 11: Create `src/App.jsx` (stub)**

```jsx
export default function App() {
  return <div className="p-4 text-white bg-gray-900 min-h-screen">Loading...</div>
}
```

- [ ] **Step 12: Create `src/test/setup.js`**

```js
import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

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
})
```

- [ ] **Step 13: Create `public/icons/` directory**

```bash
mkdir -p public/icons
```

Note: Real icons (16x16, 48x48, 128x128 PNG) must be added to `public/icons/` before publishing to the Chrome Web Store. The build and extension load will work without them during development.

- [ ] **Step 14: Verify build runs**

```bash
npm run build
```

Expected: `dist/` folder created containing `sidepanel.html`, `manifest.json`, `background.js`, `assets/`. No errors.

- [ ] **Step 15: Verify tests run (empty suite)**

```bash
npm test
```

Expected: `No test files found` or `0 tests passed`. No errors.

- [ ] **Step 16: Commit**

```bash
git add .
git commit -m "feat: project scaffold — Vite, React, Tailwind, Vitest, manifest"
```

---

## Task 2: Chrome Storage Wrapper

**Files:**
- Create: `src/lib/storage.js`
- Create: `src/test/lib/storage.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/test/lib/storage.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveApiKey,
  getApiKey,
  saveTemplate,
  getTemplates,
  deleteTemplate,
} from '../../lib/storage.js'

const makeTemplate = (overrides = {}) => ({
  id: 'test-id-1',
  name: 'Test Contract',
  sourceFormat: 'docx',
  rawContent: 'This agreement is made with [VALUE] hereinafter.',
  variables: [{ name: 'ClientName', marker: 'made with [VALUE] hereinafter' }],
  createdAt: 1000000,
  ...overrides,
})

describe('storage', () => {
  describe('saveApiKey / getApiKey', () => {
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

  describe('saveTemplate / getTemplates', () => {
    it('returns empty array when no templates exist', async () => {
      expect(await getTemplates()).toEqual([])
    })

    it('saves and retrieves a template', async () => {
      const t = makeTemplate()
      await saveTemplate(t)
      const list = await getTemplates()
      expect(list).toHaveLength(1)
      expect(list[0]).toEqual(t)
    })

    it('saves multiple templates', async () => {
      await saveTemplate(makeTemplate({ id: 'id-1', name: 'Contract A' }))
      await saveTemplate(makeTemplate({ id: 'id-2', name: 'Contract B' }))
      const list = await getTemplates()
      expect(list).toHaveLength(2)
    })

    it('updates an existing template when id matches', async () => {
      await saveTemplate(makeTemplate({ name: 'Original' }))
      await saveTemplate(makeTemplate({ name: 'Updated' }))
      const list = await getTemplates()
      expect(list).toHaveLength(1)
      expect(list[0].name).toBe('Updated')
    })
  })

  describe('deleteTemplate', () => {
    it('removes a template by id', async () => {
      await saveTemplate(makeTemplate({ id: 'keep' }))
      await saveTemplate(makeTemplate({ id: 'remove' }))
      await deleteTemplate('remove')
      const list = await getTemplates()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('keep')
    })

    it('does nothing when id does not exist', async () => {
      await saveTemplate(makeTemplate())
      await deleteTemplate('nonexistent')
      expect(await getTemplates()).toHaveLength(1)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- storage
```

Expected: FAIL with `Cannot find module '../../lib/storage.js'`

- [ ] **Step 3: Implement `src/lib/storage.js`**

```js
const API_KEY_KEY = 'apiKey'
const TEMPLATES_KEY = 'templates'

export async function saveApiKey(key) {
  await chrome.storage.local.set({ [API_KEY_KEY]: key })
}

export async function getApiKey() {
  const result = await chrome.storage.local.get([API_KEY_KEY])
  return result[API_KEY_KEY] ?? null
}

export async function saveTemplate(template) {
  const templates = await getTemplates()
  const idx = templates.findIndex(t => t.id === template.id)
  if (idx >= 0) {
    templates[idx] = template
  } else {
    templates.push(template)
  }
  await chrome.storage.local.set({ [TEMPLATES_KEY]: templates })
}

export async function getTemplates() {
  const result = await chrome.storage.local.get([TEMPLATES_KEY])
  return result[TEMPLATES_KEY] ?? []
}

export async function deleteTemplate(id) {
  const templates = await getTemplates()
  await chrome.storage.local.set({
    [TEMPLATES_KEY]: templates.filter(t => t.id !== id),
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- storage
```

Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.js src/test/lib/storage.test.js
git commit -m "feat: chrome storage wrapper with full test coverage"
```

---

## Task 3: PDF Parser

**Files:**
- Create: `src/lib/parsers/pdf.js`
- Create: `src/test/lib/parsers/pdf.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/test/lib/parsers/pdf.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pdfjs-dist before importing the module under test
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}))

import { parsePdf, initPdfWorker } from '../../../lib/parsers/pdf.js'
import * as pdfjsLib from 'pdfjs-dist'

const makeMockPdf = (pages) => ({
  promise: Promise.resolve({
    numPages: pages.length,
    getPage: vi.fn(async (n) => ({
      getTextContent: async () => ({
        items: pages[n - 1].map(str => ({ str })),
      }),
    })),
  }),
})

describe('parsePdf', () => {
  beforeEach(() => {
    vi.mocked(pdfjsLib.getDocument).mockReset()
  })

  it('extracts text from a single-page PDF', async () => {
    pdfjsLib.getDocument.mockReturnValue(makeMockPdf([['Hello', ' ', 'World']]))
    const result = await parsePdf(new ArrayBuffer(8))
    expect(result.text).toBe('Hello  World')
    expect(result.pageCount).toBe(1)
  })

  it('joins pages with double newline', async () => {
    pdfjsLib.getDocument.mockReturnValue(
      makeMockPdf([['Page one'], ['Page two']])
    )
    const result = await parsePdf(new ArrayBuffer(8))
    expect(result.text).toBe('Page one\n\nPage two')
    expect(result.pageCount).toBe(2)
  })

  it('returns empty string for a PDF with no text', async () => {
    pdfjsLib.getDocument.mockReturnValue(makeMockPdf([[]]))
    const result = await parsePdf(new ArrayBuffer(8))
    expect(result.text).toBe('')
  })
})

describe('initPdfWorker', () => {
  it('sets GlobalWorkerOptions.workerSrc', () => {
    initPdfWorker('chrome-extension://fake/pdf.worker.min.mjs')
    expect(pdfjsLib.GlobalWorkerOptions.workerSrc).toBe(
      'chrome-extension://fake/pdf.worker.min.mjs'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- pdf.test
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `src/lib/parsers/pdf.js`**

```js
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'

export function initPdfWorker(workerSrc) {
  GlobalWorkerOptions.workerSrc = workerSrc
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ text: string, pageCount: number }>}
 */
export async function parsePdf(buffer) {
  const pdf = await getDocument({ data: buffer }).promise
  const pages = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map(item => item.str).join(''))
  }

  return {
    text: pages.join('\n\n'),
    pageCount: pdf.numPages,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- pdf.test
```

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsers/pdf.js src/test/lib/parsers/pdf.test.js
git commit -m "feat: PDF parser with pdfjs-dist wrapper"
```

---

## Task 4: DOCX Parser

**Files:**
- Create: `src/lib/parsers/docx.js`
- Create: `src/test/lib/parsers/docx.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/test/lib/parsers/docx.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
}))

import { parseDocx } from '../../../lib/parsers/docx.js'
import mammoth from 'mammoth'

describe('parseDocx', () => {
  it('extracts raw text from a DOCX buffer', async () => {
    mammoth.extractRawText.mockResolvedValue({
      value: 'This is the contract text.',
      messages: [],
    })
    const result = await parseDocx(new ArrayBuffer(8))
    expect(result.text).toBe('This is the contract text.')
  })

  it('passes the arrayBuffer option to mammoth', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: '', messages: [] })
    const buffer = new ArrayBuffer(16)
    await parseDocx(buffer)
    expect(mammoth.extractRawText).toHaveBeenCalledWith({ arrayBuffer: buffer })
  })

  it('returns empty string when mammoth returns empty value', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: '', messages: [] })
    const result = await parseDocx(new ArrayBuffer(8))
    expect(result.text).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- docx.test
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `src/lib/parsers/docx.js`**

```js
import mammoth from 'mammoth'

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ text: string }>}
 */
export async function parseDocx(buffer) {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return { text: result.value }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- docx.test
```

Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsers/docx.js src/test/lib/parsers/docx.test.js
git commit -m "feat: DOCX parser with mammoth wrapper"
```

---

## Task 5: XLSX Parser

**Files:**
- Create: `src/lib/parsers/xlsx.js`
- Create: `src/test/lib/parsers/xlsx.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/test/lib/parsers/xlsx.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('xlsx', () => ({
  default: {
    read: vi.fn(),
    utils: {
      sheet_to_csv: vi.fn(),
    },
  },
}))

import { parseXlsx } from '../../../lib/parsers/xlsx.js'
import XLSX from 'xlsx'

describe('parseXlsx', () => {
  it('extracts text from a single sheet', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    })
    XLSX.utils.sheet_to_csv.mockReturnValue('Name,Date\nAlice,2024-01-01')

    const result = parseXlsx(new ArrayBuffer(8))
    expect(result.text).toBe('=== Sheet: Sheet1 ===\nName,Date\nAlice,2024-01-01')
    expect(result.sheets).toEqual(['Sheet1'])
  })

  it('joins multiple sheets with double newline', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Data', 'Summary'],
      Sheets: { Data: {}, Summary: {} },
    })
    XLSX.utils.sheet_to_csv
      .mockReturnValueOnce('A,B')
      .mockReturnValueOnce('C,D')

    const result = parseXlsx(new ArrayBuffer(8))
    expect(result.text).toContain('=== Sheet: Data ===')
    expect(result.text).toContain('=== Sheet: Summary ===')
    expect(result.sheets).toEqual(['Data', 'Summary'])
  })

  it('passes correct options to XLSX.read', () => {
    XLSX.read.mockReturnValue({ SheetNames: [], Sheets: {} })
    const buffer = new ArrayBuffer(32)
    parseXlsx(buffer)
    expect(XLSX.read).toHaveBeenCalledWith(buffer, { type: 'array' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- xlsx.test
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `src/lib/parsers/xlsx.js`**

```js
import XLSX from 'xlsx'

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ text: string, sheets: string[] }}
 */
export function parseXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const parts = []

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(ws)
    parts.push(`=== Sheet: ${sheetName} ===\n${csv}`)
  }

  return {
    text: parts.join('\n\n'),
    sheets: wb.SheetNames,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- xlsx.test
```

Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsers/xlsx.js src/test/lib/parsers/xlsx.test.js
git commit -m "feat: XLSX parser with xlsx wrapper"
```

---

## Task 6: Parser Index (Format Detection)

**Files:**
- Create: `src/lib/parsers/index.js`
- Create: `src/test/lib/parsers/index.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/test/lib/parsers/index.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/parsers/pdf.js', () => ({
  parsePdf: vi.fn().mockResolvedValue({ text: 'pdf text', pageCount: 1 }),
  initPdfWorker: vi.fn(),
}))
vi.mock('../../../lib/parsers/docx.js', () => ({
  parseDocx: vi.fn().mockResolvedValue({ text: 'docx text' }),
}))
vi.mock('../../../lib/parsers/xlsx.js', () => ({
  parseXlsx: vi.fn().mockReturnValue({ text: 'xlsx text', sheets: ['Sheet1'] }),
}))

import { parseFile, SUPPORTED_EXTENSIONS } from '../../../lib/parsers/index.js'

const makeFile = (name, content = 'data') =>
  new File([content], name, { type: 'application/octet-stream' })

describe('parseFile', () => {
  it('routes .pdf files to parsePdf', async () => {
    const result = await parseFile(makeFile('contract.pdf'))
    expect(result.text).toBe('pdf text')
    expect(result.format).toBe('pdf')
  })

  it('routes .docx files to parseDocx', async () => {
    const result = await parseFile(makeFile('contract.docx'))
    expect(result.text).toBe('docx text')
    expect(result.format).toBe('docx')
  })

  it('routes .xlsx files to parseXlsx', async () => {
    const result = await parseFile(makeFile('data.xlsx'))
    expect(result.text).toBe('xlsx text')
    expect(result.format).toBe('xlsx')
  })

  it('routes .xls files to parseXlsx', async () => {
    const result = await parseFile(makeFile('data.xls'))
    expect(result.format).toBe('xlsx')
  })

  it('throws for unsupported extensions', async () => {
    await expect(parseFile(makeFile('document.txt'))).rejects.toThrow(
      'Unsupported file format: .txt'
    )
  })
})

describe('SUPPORTED_EXTENSIONS', () => {
  it('includes pdf, docx, xlsx, xls', () => {
    expect(SUPPORTED_EXTENSIONS).toContain('.pdf')
    expect(SUPPORTED_EXTENSIONS).toContain('.docx')
    expect(SUPPORTED_EXTENSIONS).toContain('.xlsx')
    expect(SUPPORTED_EXTENSIONS).toContain('.xls')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- parsers/index
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `src/lib/parsers/index.js`**

```js
import { parsePdf } from './pdf.js'
import { parseDocx } from './docx.js'
import { parseXlsx } from './xlsx.js'

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.xls']

const EXT_TO_FORMAT = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
}

/**
 * @param {File} file
 * @returns {Promise<{ text: string, format: string }>}
 */
export async function parseFile(file) {
  const dotIdx = file.name.lastIndexOf('.')
  const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : ''
  const format = EXT_TO_FORMAT[ext]

  if (!format) throw new Error(`Unsupported file format: ${ext}`)

  const buffer = await file.arrayBuffer()

  if (format === 'pdf') {
    const result = await parsePdf(buffer)
    return { text: result.text, format }
  }
  if (format === 'docx') {
    const result = await parseDocx(buffer)
    return { text: result.text, format }
  }
  // xlsx or xls
  const result = parseXlsx(buffer)
  return { text: result.text, format }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- parsers/index
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/parsers/index.js src/test/lib/parsers/index.test.js
git commit -m "feat: parser index with format detection for PDF/DOCX/XLSX"
```

---

## Task 7: Gemini API Client

**Files:**
- Create: `src/lib/gemini.js`
- Create: `src/test/lib/gemini.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/test/lib/gemini.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateContent = vi.fn()
const mockGetGenerativeModel = vi.fn(() => ({ generateContent: mockGenerateContent }))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}))

import { testConnection, extractVariables, MAX_CHARS } from '../../lib/gemini.js'

const VALID_KEY = 'test-api-key'
const SAMPLE_VARS = [
  { name: 'ClientName', marker: 'made with [VALUE] hereinafter' },
  { name: 'EffectiveDate', marker: 'effective as of [VALUE] between' },
]

beforeEach(() => {
  mockGenerateContent.mockReset()
})

describe('testConnection', () => {
  it('returns true when the API call succeeds', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'OK' } })
    expect(await testConnection(VALID_KEY)).toBe(true)
  })

  it('throws when the API call fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Invalid API key'))
    await expect(testConnection(VALID_KEY)).rejects.toThrow('Invalid API key')
  })
})

describe('extractVariables', () => {
  it('returns parsed variables from a valid JSON response', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify(SAMPLE_VARS) },
    })
    const result = await extractVariables(VALID_KEY, 'some document content')
    expect(result).toEqual(SAMPLE_VARS)
  })

  it('strips markdown code fences before parsing', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '```json\n' + JSON.stringify(SAMPLE_VARS) + '\n```' },
    })
    const result = await extractVariables(VALID_KEY, 'content')
    expect(result).toEqual(SAMPLE_VARS)
  })

  it('filters out variables whose marker has no [VALUE] token', async () => {
    const malformed = [
      { name: 'Good', marker: 'good [VALUE] marker' },
      { name: 'Bad', marker: 'no value token here' },
    ]
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify(malformed) },
    })
    const result = await extractVariables(VALID_KEY, 'content')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Good')
  })

  it('retries once on malformed JSON and throws MALFORMED_RESPONSE on second failure', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'not json at all' },
    })
    await expect(extractVariables(VALID_KEY, 'content')).rejects.toThrow(
      'MALFORMED_RESPONSE'
    )
    expect(mockGenerateContent).toHaveBeenCalledTimes(2)
  })

  it('throws when content exceeds MAX_CHARS', async () => {
    const oversized = 'a'.repeat(MAX_CHARS + 1)
    await expect(extractVariables(VALID_KEY, oversized)).rejects.toThrow(
      'Document too large'
    )
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })

  it('throws MALFORMED_RESPONSE when Gemini returns a non-array', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"not": "an array"}' },
    })
    await expect(extractVariables(VALID_KEY, 'content')).rejects.toThrow(
      'MALFORMED_RESPONSE'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- gemini.test
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `src/lib/gemini.js`**

```js
import { GoogleGenerativeAI } from '@google/generative-ai'

const MODEL = 'gemini-flash-latest'
export const MAX_CHARS = 750_000

function buildPrompt(content) {
  return `Analyze this document. Identify all variable fields likely to change across iterations (e.g., names, IDs, dates, amounts). Return a JSON array where each item has: "name" (a short camelCase label) and "marker" (a short phrase of 5-10 words from the document that contains the variable's value, with that value replaced by the literal token [VALUE]). The [VALUE] token must appear exactly once in each marker string. Example: "agreement is made with [VALUE] hereinafter".

Respond with ONLY the JSON array, no markdown, no explanation.

Document content:
${content}`
}

function parseResponse(text) {
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
  const parsed = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) throw new Error('MALFORMED_RESPONSE')
  return parsed.filter(
    v => typeof v.name === 'string' && typeof v.marker === 'string' && v.marker.includes('[VALUE]')
  )
}

export async function testConnection(apiKey) {
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })
  await model.generateContent('Reply with just: OK')
  return true
}

export async function extractVariables(apiKey, content) {
  if (content.length > MAX_CHARS) {
    throw new Error(`Document too large: ${content.length} chars (max ${MAX_CHARS})`)
  }

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })

  let responseText
  try {
    const result = await model.generateContent(buildPrompt(content))
    responseText = result.response.text()
  } catch (err) {
    throw new Error(`Gemini API error: ${err.message}`)
  }

  try {
    return parseResponse(responseText)
  } catch {
    // Retry once with a stricter prompt
    try {
      const retryResult = await model.generateContent(
        buildPrompt(content) + '\n\nCRITICAL: respond with valid JSON only.'
      )
      return parseResponse(retryResult.response.text())
    } catch {
      throw new Error('MALFORMED_RESPONSE')
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- gemini.test
```

Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gemini.js src/test/lib/gemini.test.js
git commit -m "feat: Gemini 1.5 Flash client with variable extraction and retry logic"
```

---

## Task 8: Template Engine

**Files:**
- Create: `src/lib/templateEngine.js`
- Create: `src/test/lib/templateEngine.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/test/lib/templateEngine.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('jspdf', () => ({
  jsPDF: vi.fn().mockImplementation(() => ({
    splitTextToSize: vi.fn(() => ['line1', 'line2']),
    text: vi.fn(),
    output: vi.fn(() => new Blob(['pdf'], { type: 'application/pdf' })),
  })),
}))

vi.mock('docx', () => ({
  Document: vi.fn(),
  Packer: { toBlob: vi.fn().mockResolvedValue(new Blob(['docx'])) },
  Paragraph: vi.fn(),
  TextRun: vi.fn(),
}))

vi.mock('xlsx', () => ({
  default: {
    utils: {
      book_new: vi.fn(() => ({})),
      aoa_to_sheet: vi.fn(() => ({})),
      book_append_sheet: vi.fn(),
    },
    write: vi.fn(() => new Uint8Array([1, 2, 3])),
  },
}))

import {
  injectVariables,
  generatePdf,
  generateDocx,
  generateXlsx,
} from '../../lib/templateEngine.js'

const RAW = 'This agreement is made with [VALUE] hereinafter, effective as of [VALUE] between parties.'

describe('injectVariables', () => {
  const variables = [
    { name: 'ClientName', marker: 'made with [VALUE] hereinafter' },
    { name: 'EffectiveDate', marker: 'effective as of [VALUE] between' },
  ]
  const values = { ClientName: 'Acme Corp', EffectiveDate: '2026-01-01' }

  it('replaces [VALUE] with the provided value in each marker', () => {
    const { content, warnings } = injectVariables(RAW, variables, values)
    expect(content).toContain('made with Acme Corp hereinafter')
    expect(content).toContain('effective as of 2026-01-01 between')
    expect(warnings).toHaveLength(0)
  })

  it('uses empty string when value is not provided', () => {
    const { content } = injectVariables(RAW, variables, { ClientName: 'Acme Corp' })
    expect(content).toContain('effective as of  between')
  })

  it('warns and skips a variable whose marker is not found', () => {
    const { warnings } = injectVariables(
      'unrelated content',
      [{ name: 'Missing', marker: 'not [VALUE] here' }],
      { Missing: 'x' }
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"Missing"')
    expect(warnings[0]).toContain('not found')
  })

  it('warns and skips a variable whose marker has no [VALUE] token', () => {
    const { warnings } = injectVariables(
      RAW,
      [{ name: 'Bad', marker: 'agreement is made with' }],
      { Bad: 'x' }
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('malformed marker')
  })

  it('replaces first occurrence and warns when marker is duplicated', () => {
    const content = 'word [VALUE] end. word [VALUE] end.'
    const { content: result, warnings } = injectVariables(
      content,
      [{ name: 'Dup', marker: 'word [VALUE] end' }],
      { Dup: 'X' }
    )
    expect(result).toBe('word X end. word [VALUE] end.')
    expect(warnings[0]).toContain('2 times')
  })
})

describe('generatePdf', () => {
  it('returns a Blob', async () => {
    const blob = await generatePdf('some content')
    expect(blob).toBeInstanceOf(Blob)
  })
})

describe('generateDocx', () => {
  it('returns a Blob', async () => {
    const blob = await generateDocx('some content')
    expect(blob).toBeInstanceOf(Blob)
  })
})

describe('generateXlsx', () => {
  it('returns a Blob', async () => {
    const blob = await generateXlsx('line1\nline2')
    expect(blob).toBeInstanceOf(Blob)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- templateEngine.test
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `src/lib/templateEngine.js`**

```js
import { jsPDF } from 'jspdf'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import XLSX from 'xlsx'

/**
 * Injects variable values into rawContent using marker-based replacement.
 * @param {string} rawContent
 * @param {Array<{name: string, marker: string}>} variables
 * @param {Record<string, string>} values  — keyed by variable name
 * @returns {{ content: string, warnings: string[] }}
 */
export function injectVariables(rawContent, variables, values) {
  let content = rawContent
  const warnings = []

  for (const { name, marker } of variables) {
    const value = values[name] ?? ''

    if (!marker.includes('[VALUE]')) {
      warnings.push(`Variable "${name}" has a malformed marker (no [VALUE] token) — skipped`)
      continue
    }

    const occurrences = countOccurrences(content, marker)
    if (occurrences === 0) {
      warnings.push(`Variable "${name}" marker not found in document — skipped`)
      continue
    }
    if (occurrences > 1) {
      warnings.push(
        `Variable "${name}" marker appears ${occurrences} times — replaced first occurrence`
      )
    }

    // Use indexOf + slice instead of String.replace to avoid special-character
    // corruption (e.g. '$5,000' contains '$' which String.replace treats specially).
    const pos = content.indexOf(marker)
    const filledMarker = marker.slice(0, marker.indexOf('[VALUE]')) + value + marker.slice(marker.indexOf('[VALUE]') + '[VALUE]'.length)
    content = content.slice(0, pos) + filledMarker + content.slice(pos + marker.length)
  }

  return { content, warnings }
}

function countOccurrences(text, pattern) {
  let count = 0
  let pos = 0
  while ((pos = text.indexOf(pattern, pos)) !== -1) {
    count++
    pos += pattern.length
  }
  return count
}

/**
 * @param {string} content
 * @returns {Promise<Blob>}
 */
export async function generatePdf(content) {
  const doc = new jsPDF()
  const lines = doc.splitTextToSize(content, 180)
  doc.text(lines, 15, 15)
  return doc.output('blob')
}

/**
 * @param {string} content  — plain text; paragraphs separated by \n
 * @returns {Promise<Blob>}
 */
export async function generateDocx(content) {
  const paragraphs = content
    .split('\n')
    .map(line => new Paragraph({ children: [new TextRun(line)] }))
  const doc = new Document({ sections: [{ children: paragraphs }] })
  return await Packer.toBlob(doc)
}

/**
 * @param {string} content  — rows separated by \n, columns by comma (CSV-like)
 * @returns {Promise<Blob>}
 */
export async function generateXlsx(content) {
  const rows = content.split('\n').map(line => [line])
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([buffer], {
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
npm test -- templateEngine.test
```

Expected: All 8 tests pass.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: All tests pass across all files. Note the count — should be 40 tests (storage: 9, pdf: 4, docx: 3, xlsx: 3, parsers/index: 6, gemini: 7, templateEngine: 8).

- [ ] **Step 6: Commit**

```bash
git add src/lib/templateEngine.js src/test/lib/templateEngine.test.js
git commit -m "feat: template engine — variable injection, PDF/DOCX/XLSX output generation"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass. Verify output shows 37+ tests across 7 test files.

- [ ] **Step 2: Run a production build**

```bash
npm run build
```

Expected: `dist/` contains `manifest.json`, `background.js`, `sidepanel.html`, `pdf.worker.min.mjs`, and `assets/`.

- [ ] **Step 3: Load the extension in Chrome to verify no load errors**

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the `dist/` folder
4. Verify the extension appears with no errors
5. Click the extension icon → verify the side panel opens showing "Loading..."

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: foundation layer complete — all parsers, storage, Gemini client, template engine tested"
```

---

## Known Limitations (by design)

- **XLSX round-trip loses column structure:** The XLSX parser extracts content as CSV text (e.g., `Name,Date\nAlice,2026-01-01`). `generateXlsx` re-encodes each row as a single cell string rather than restoring column splits. After template generation, all content lands in column A. This matches the spec's "good-enough" rendering constraint and should be documented in the QA checklist.

---

## What's Next: Plan 2 — UI Layer

Plan 2 will cover:
- Shared UI components (Button, Input, Toast, ProgressBar, Spinner, FileDropzone, VariableChip)
- `Onboarding.jsx` — API key entry + test connection
- `Upload.jsx` — file drop + AI scan + detected variables list
- `Review.jsx` — variable chip overlay, rename/remove/add, template save
- `Library.jsx` — saved template list
- `Generate.jsx` — dynamic form + output format selector + download
- `App.jsx` — wizard router / step state machine
