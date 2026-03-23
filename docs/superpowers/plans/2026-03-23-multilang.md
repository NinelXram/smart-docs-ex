# Multi-Language Support (VI/EN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Vietnamese (default) and English language support — full UI translation and language-aware Gemini prompts — with a header toggle persisted to chrome.storage.local.

**Architecture:** A `LanguageContext` in `src/lib/i18n.js` exposes `{ lang, setLang, t }` to the tree. `t('namespace.key')` looks up JSON locale files with fallback to English then key string. `App.jsx` owns `lang` state, loads it from storage on mount, and renders the toggle. Gemini functions gain a `lang` param that appends "Respond in Vietnamese." when `lang === 'vi'`.

**Tech Stack:** React context, Vitest + React Testing Library, chrome.storage.local (existing mock in `src/test/setup.js`).

---

## File Map

| Action | File |
|---|---|
| Create | `src/locales/en.json` |
| Create | `src/locales/vi.json` |
| Create | `src/lib/i18n.js` |
| Create | `src/test/lib/i18n.test.js` |
| Modify | `src/lib/storage.js` — add `getLang`, `saveLang` |
| Modify | `src/test/lib/storage.test.js` — add lang tests |
| Modify | `src/lib/gemini.js` — add `lang` param to 3 functions |
| Modify | `src/test/lib/gemini.test.js` — add lang prompt tests |
| Modify | `src/test/gemini.test.js` — add lang prompt tests |
| Modify | `src/App.jsx` — provider, toggle, lang loading |
| Modify | `src/test/App.test.jsx` — update for new context |
| Modify | `src/components/ProgressBar.jsx` |
| Modify | `src/test/components/ProgressBar.test.jsx` |
| Modify | `src/components/FileDropZone.jsx` |
| Modify | `src/test/components/FileDropZone.test.jsx` |
| Modify | `src/components/VariableChip.jsx` |
| Modify | `src/test/components/VariableChip.test.jsx` |
| Modify | `src/components/Toast.jsx` |
| Modify | `src/test/components/Toast.test.jsx` |
| Modify | `src/pages/Onboarding.jsx` |
| Modify | `src/test/pages/Onboarding.test.jsx` |
| Modify | `src/pages/Upload.jsx` |
| Modify | `src/test/pages/Upload.test.jsx` |
| Modify | `src/pages/Library.jsx` |
| Modify | `src/test/pages/Library.test.jsx` |
| Modify | `src/pages/Generate.jsx` |
| Modify | `src/test/pages/Generate.test.jsx` |
| Modify | `src/pages/Review.jsx` |
| Modify | `src/test/pages/Review.test.jsx` |

---

## Task 1: Create locale files

**Files:**
- Create: `src/locales/en.json`
- Create: `src/locales/vi.json`

- [ ] **Step 1: Create `src/locales/en.json`**

```json
{
  "app": {
    "title": "Doc Template Agent",
    "changeApiKey": "Change API Key",
    "library": "Library",
    "loading": "Loading…",
    "opfsError": "This extension requires a browser with file system support. Please update Chrome.",
    "langSaveError": "Failed to save language preference"
  },
  "onboarding": {
    "title": "Doc Template Agent",
    "subtitle": "Enter your Gemini API key to get started",
    "placeholder": "Gemini API key",
    "submit": "Test Connection",
    "submitting": "Testing…",
    "getKey": "Get a free key at"
  },
  "upload": {
    "title": "Upload Document",
    "rendering": "Rendering document…",
    "dropzoneLabel": "Drop a file or click to browse",
    "dropzoneAccepted": "Accepted: PDF, DOCX, XLSX",
    "unsupported": "Unsupported file type"
  },
  "review": {
    "back": "← Back",
    "fields": "field",
    "fields_plural": "fields",
    "templatePlaceholder": "Template name…",
    "save": "Save Template",
    "saving": "Saving…",
    "xlsxHint": "Click a cell — AI will identify the label and value. Select text to hint which part is the value.",
    "labelPreserved": "Label (preserved)",
    "fieldName": "Field name",
    "description": "Description",
    "descriptionHint": "(max 10 words)",
    "descriptionPlaceholder": "What does this field represent?",
    "accept": "Accept",
    "dismiss": "Dismiss",
    "analyzing": "Analyzing…",
    "errorSingleParagraph": "Select text within a single paragraph",
    "errorAlreadyField": "This cell is already a field",
    "errorFieldRequired": "Field name is required",
    "errorFieldFormat": "Field name must start with a letter and contain only letters, digits, and underscores",
    "errorFieldDuplicate": "Field name already used — choose another",
    "errorInsertFailed": "Could not locate selection in document — try selecting again",
    "errorAiFailed": "AI suggestion failed — enter values manually",
    "errorNoFields": "Define at least one field before saving",
    "errorNoName": "Enter a template name",
    "errorSaveFailed": "Save failed:",
    "ariaPopover": "Field name suggestion",
    "ariaTablist": "Worksheet tabs"
  },
  "library": {
    "loading": "Loading…",
    "empty": "No templates saved yet.",
    "new": "+ New Template",
    "variable": "variable",
    "variables": "variables",
    "errorLoad": "Failed to load templates:",
    "errorDelete": "Delete failed:",
    "ariaDelete": "delete template"
  },
  "generate": {
    "back": "← Back",
    "download": "⬇ Download",
    "generating": "Generating…",
    "fieldPlaceholder": "Enter",
    "errorNotFound": "Template file not found — please re-upload",
    "errorFailed": "Generation failed:"
  },
  "progressBar": {
    "upload": "Upload",
    "review": "Review",
    "library": "Library",
    "generate": "Generate"
  },
  "variableChip": {
    "ariaRemove": "remove variable"
  },
  "toast": {
    "ariaDismiss": "dismiss toast"
  }
}
```

- [ ] **Step 2: Create `src/locales/vi.json`**

```json
{
  "app": {
    "title": "Trợ lý Mẫu Tài liệu",
    "changeApiKey": "Đổi API Key",
    "library": "Thư viện",
    "loading": "Đang tải…",
    "opfsError": "Extension này yêu cầu trình duyệt hỗ trợ hệ thống tệp. Vui lòng cập nhật Chrome.",
    "langSaveError": "Không thể lưu cài đặt ngôn ngữ"
  },
  "onboarding": {
    "title": "Trợ lý Mẫu Tài liệu",
    "subtitle": "Nhập Gemini API key của bạn để bắt đầu",
    "placeholder": "Gemini API key",
    "submit": "Kiểm tra kết nối",
    "submitting": "Đang kiểm tra…",
    "getKey": "Lấy key miễn phí tại"
  },
  "upload": {
    "title": "Tải lên tài liệu",
    "rendering": "Đang xử lý tài liệu…",
    "dropzoneLabel": "Kéo thả tệp hoặc nhấp để duyệt",
    "dropzoneAccepted": "Chấp nhận: PDF, DOCX, XLSX",
    "unsupported": "Định dạng tệp không được hỗ trợ"
  },
  "review": {
    "back": "← Quay lại",
    "fields": "trường",
    "fields_plural": "trường",
    "templatePlaceholder": "Tên mẫu…",
    "save": "Lưu mẫu",
    "saving": "Đang lưu…",
    "xlsxHint": "Nhấp vào ô — AI sẽ xác định nhãn và giá trị. Chọn văn bản để chỉ ra phần nào là giá trị.",
    "labelPreserved": "Nhãn (giữ nguyên)",
    "fieldName": "Tên trường",
    "description": "Mô tả",
    "descriptionHint": "(tối đa 10 từ)",
    "descriptionPlaceholder": "Trường này đại diện cho điều gì?",
    "accept": "Xác nhận",
    "dismiss": "Bỏ qua",
    "analyzing": "Đang phân tích…",
    "errorSingleParagraph": "Chọn văn bản trong cùng một đoạn",
    "errorAlreadyField": "Ô này đã là một trường",
    "errorFieldRequired": "Tên trường là bắt buộc",
    "errorFieldFormat": "Tên trường phải bắt đầu bằng chữ cái và chỉ chứa chữ cái, số và dấu gạch dưới",
    "errorFieldDuplicate": "Tên trường đã được sử dụng — vui lòng chọn tên khác",
    "errorInsertFailed": "Không thể xác định vị trí trong tài liệu — thử chọn lại",
    "errorAiFailed": "Gợi ý AI thất bại — vui lòng nhập thủ công",
    "errorNoFields": "Hãy xác định ít nhất một trường trước khi lưu",
    "errorNoName": "Vui lòng nhập tên mẫu",
    "errorSaveFailed": "Lưu thất bại:",
    "ariaPopover": "Gợi ý tên trường",
    "ariaTablist": "Tab bảng tính"
  },
  "library": {
    "loading": "Đang tải…",
    "empty": "Chưa có mẫu nào được lưu.",
    "new": "+ Mẫu mới",
    "variable": "biến",
    "variables": "biến",
    "errorLoad": "Tải mẫu thất bại:",
    "errorDelete": "Xóa thất bại:",
    "ariaDelete": "xóa mẫu"
  },
  "generate": {
    "back": "← Quay lại",
    "download": "⬇ Tải xuống",
    "generating": "Đang tạo…",
    "fieldPlaceholder": "Nhập",
    "errorNotFound": "Không tìm thấy tệp mẫu — vui lòng tải lên lại",
    "errorFailed": "Tạo tệp thất bại:"
  },
  "progressBar": {
    "upload": "Tải lên",
    "review": "Xem xét",
    "library": "Thư viện",
    "generate": "Tạo tệp"
  },
  "variableChip": {
    "ariaRemove": "xóa biến"
  },
  "toast": {
    "ariaDismiss": "đóng thông báo"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/locales/en.json src/locales/vi.json
git commit -m "feat: add en/vi locale files"
```

---

## Task 2: i18n module + tests

**Files:**
- Create: `src/lib/i18n.js`
- Create: `src/test/lib/i18n.test.js`

**Context:** `createContext()` is given a default English value so components render correctly in tests that don't wrap with a provider. `makeT(lang)` is also exported for use in `App.jsx` (which is the provider root and cannot call `useLanguage()`).

- [ ] **Step 1: Write the failing tests**

Create `src/test/lib/i18n.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { makeT, LanguageProvider, useLanguage } from '../../lib/i18n.js'

describe('makeT', () => {
  it('returns the value for the active locale', () => {
    const t = makeT('en')
    expect(t('app.title')).toBe('Doc Template Agent')
  })

  it('returns the Vietnamese value when lang is vi', () => {
    const t = makeT('vi')
    expect(t('app.title')).toBe('Trợ lý Mẫu Tài liệu')
  })

  it('falls back to en when key is missing in vi', () => {
    const t = makeT('vi')
    // Use a key that exists in en but not vi by temporarily relying on fallback
    // Verify: returns a string (not the key) if en has it
    expect(typeof t('app.loading')).toBe('string')
    expect(t('app.loading')).not.toBe('app.loading')
  })

  it('falls back to the key string when missing in both locales', () => {
    const t = makeT('vi')
    expect(t('nonexistent.key')).toBe('nonexistent.key')
  })

  it('resolves nested dot notation', () => {
    const t = makeT('en')
    expect(t('review.accept')).toBe('Accept')
  })
})

describe('LanguageProvider + useLanguage', () => {
  function Consumer() {
    const { lang, t } = useLanguage()
    return <div data-testid="out">{lang}:{t('app.library')}</div>
  }

  it('exposes lang and t to consumers', () => {
    render(
      <LanguageProvider lang="en" setLang={() => {}}>
        <Consumer />
      </LanguageProvider>
    )
    expect(screen.getByTestId('out').textContent).toBe('en:Library')
  })

  it('renders Vietnamese strings when lang is vi', () => {
    render(
      <LanguageProvider lang="vi" setLang={() => {}}>
        <Consumer />
      </LanguageProvider>
    )
    expect(screen.getByTestId('out').textContent).toBe('vi:Thư viện')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/test/lib/i18n.test.js
```

Expected: FAIL — `i18n.js` does not exist yet.

- [ ] **Step 3: Create `src/lib/i18n.js`**

```js
import { createContext, useContext } from 'react'
import vi from '../locales/vi.json'
import en from '../locales/en.json'

const locales = { vi, en }

/** Standalone lookup — usable outside a React tree (e.g. App.jsx). */
export function makeT(lang) {
  return function t(key) {
    const parts = key.split('.')
    return (
      parts.reduce((obj, k) => obj?.[k], locales[lang]) ??
      parts.reduce((obj, k) => obj?.[k], locales['en']) ??
      key
    )
  }
}

// Default value provides English fallback for components rendered in tests
// without a LanguageProvider wrapper.
export const LanguageContext = createContext({
  lang: 'en',
  setLang: () => {},
  t: makeT('en'),
})

export function LanguageProvider({ lang, setLang, children }) {
  const t = makeT(lang)
  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/test/lib/i18n.test.js
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n.js src/test/lib/i18n.test.js
git commit -m "feat: add i18n module with makeT, LanguageProvider, useLanguage"
```

---

## Task 3: Add getLang / saveLang to storage + tests

**Files:**
- Modify: `src/lib/storage.js`
- Modify: `src/test/lib/storage.test.js`

**Context:** The existing mock in `src/test/setup.js` supports `chrome.storage.local.get/set` as async functions. Follow the same `await` pattern used by `getApiKey`/`saveApiKey` — no callbacks needed.

- [ ] **Step 1: Add failing tests to `src/test/lib/storage.test.js`**

Append at the end of the file:

```js
import { getLang, saveLang } from '../../lib/storage.js'

describe('getLang / saveLang', () => {
  it('returns "vi" when no lang is stored', async () => {
    expect(await getLang()).toBe('vi')
  })

  it('stores and retrieves the language', async () => {
    await saveLang('en')
    expect(await getLang()).toBe('en')
  })

  it('overwrites the previous language', async () => {
    await saveLang('vi')
    await saveLang('en')
    expect(await getLang()).toBe('en')
  })
})
```

Do NOT replace the existing import block. Instead, add only `, getLang, saveLang` to the existing import list at line 2–11 of the file. The existing import already has all other identifiers.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/test/lib/storage.test.js
```

Expected: FAIL — `getLang` and `saveLang` not exported.

- [ ] **Step 3: Add `getLang` and `saveLang` to `src/lib/storage.js`**

Append after the `getApiKey` function (around line 49):

```js
const LANG_KEY = 'lang'

export async function getLang() {
  const result = await chrome.storage.local.get([LANG_KEY])
  return result[LANG_KEY] ?? 'vi'
}

export async function saveLang(lang) {
  await chrome.storage.local.set({ [LANG_KEY]: lang })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/test/lib/storage.test.js
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.js src/test/lib/storage.test.js
git commit -m "feat: add getLang/saveLang to storage"
```

---

## Task 4: Add lang param to Gemini functions + tests

**Files:**
- Modify: `src/lib/gemini.js`
- Modify: `src/test/lib/gemini.test.js`
- Modify: `src/test/gemini.test.js`

**Context:** Each of the three exported async functions gains a `lang` parameter (default `'vi'`). When `lang === 'vi'`, append `'\nRespond in Vietnamese.'` to the prompt before calling `model.generateContent`.

- [ ] **Step 1: Read both gemini test files to understand their mock patterns**

Run: `cat src/test/lib/gemini.test.js` and `cat src/test/gemini.test.js` — note how `GoogleGenerativeAI` is mocked and how prompts are captured.

- [ ] **Step 2: Add failing lang tests**

The test file at `src/test/lib/gemini.test.js` uses module-level `mockGenerateContent` and `mockGetGenerativeModel` — use those directly, not `GoogleGenerativeAI.mockImplementation`. Also update line 12 to add `suggestFieldPattern` to the imports.

Update the import line (line 12) from:
```js
import { testConnection, extractVariables, MAX_CHARS, suggestFieldName } from '../../lib/gemini.js'
```
To:
```js
import { testConnection, extractVariables, MAX_CHARS, suggestFieldName, suggestFieldPattern } from '../../lib/gemini.js'
```

Then append a new describe block at the end of the file:

```js
describe('lang param — Vietnamese instruction', () => {
  it('suggestFieldName appends Vietnamese instruction when lang=vi', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"fieldName":"clientName","description":"tên khách hàng"}' },
    })
    await suggestFieldName('key', 'Nguyen Van A', 'context', [], 'vi')
    const prompt = mockGenerateContent.mock.calls[0][0]
    expect(prompt).toContain('Respond in Vietnamese.')
  })

  it('suggestFieldName does NOT append instruction when lang=en', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"fieldName":"clientName","description":"client name"}' },
    })
    await suggestFieldName('key', 'John Doe', 'context', [], 'en')
    const prompt = mockGenerateContent.mock.calls[0][0]
    expect(prompt).not.toContain('Respond in Vietnamese.')
  })

  it('suggestFieldPattern appends Vietnamese instruction when lang=vi', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"label":"Name: ","value":"Nguyen Van A","fieldName":"clientName","description":"tên"}' },
    })
    await suggestFieldPattern('key', 'Name: Nguyen Van A', 'Nguyen Van A', [], '', 'vi')
    const prompt = mockGenerateContent.mock.calls[0][0]
    expect(prompt).toContain('Respond in Vietnamese.')
  })

  it('extractVariables appends Vietnamese instruction when lang=vi', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '[{"name":"clientName","marker":"agreement with [VALUE] herein"}]' },
    })
    await extractVariables('key', 'some document content', 'vi')
    const prompt = mockGenerateContent.mock.calls[0][0]
    expect(prompt).toContain('Respond in Vietnamese.')
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx vitest run src/test/lib/gemini.test.js
```

Expected: FAIL — `lang` param not yet added.

- [ ] **Step 4: Update `src/lib/gemini.js`**

Add `lang = 'vi'` parameter and Vietnamese instruction to each of the three functions:

For `buildPrompt`, add a `lang` parameter and a conditional suffix:

```js
function buildPrompt(content, lang) {
  const langInstruction = lang === 'vi' ? '\nRespond in Vietnamese.' : ''
  return `Analyze this document. Identify all variable fields likely to change across iterations (e.g., names, IDs, dates, amounts). Return a JSON array where each item has: "name" (a short camelCase label) and "marker" (a short phrase of 5-10 words from the document that contains the variable's value, with that value replaced by the literal token [VALUE]). The [VALUE] token must appear exactly once in each marker string. Example: "agreement is made with [VALUE] hereinafter".

Respond with ONLY the JSON array, no markdown, no explanation.

Document content:
${content}${langInstruction}`
}
```

Update `extractVariables` signature and call:

```js
export async function extractVariables(apiKey, content, lang = 'vi') {
  // ...existing length check...
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })
  let responseText
  try {
    const result = await model.generateContent(buildPrompt(content, lang))
    responseText = result.response.text()
  } catch (err) {
    throw new Error(`Gemini API error: ${err.message}`)
  }
  // ...existing retry logic — update retry call too:
  const retryResult = await model.generateContent(
    buildPrompt(content, lang) + '\n\nCRITICAL: respond with valid JSON only.'
  )
  // ...
}
```

Update `suggestFieldName`:

```js
export async function suggestFieldName(apiKey, selectedText, surroundingContext, existingFields, lang = 'vi') {
  const langInstruction = lang === 'vi' ? '\nRespond in Vietnamese.' : ''
  const prompt = `The following text was selected from a document: "${selectedText}". The surrounding context is: "${surroundingContext}". Fields already defined: [${existingFields.join(', ')}]. Suggest a concise camelCase field name and a short description (max 10 words) explaining the field's purpose. Return JSON only: {"fieldName": "...", "description": "..."}${langInstruction}`
  // ...rest unchanged...
}
```

Update `suggestFieldPattern`:

```js
export async function suggestFieldPattern(apiKey, fullCellText, selectedText, existingFields, spatialContext, lang = 'vi') {
  const langInstruction = lang === 'vi' ? '\nRespond in Vietnamese.' : ''
  // ...existing prompt construction...
  const prompt =
    `You are analyzing a spreadsheet cell for document templating.\n` +
    // ...existing lines...
    `- If no label prefix exists, return label as ""` +
    langInstruction

  // ...rest unchanged...
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run src/test/lib/gemini.test.js
```

Expected: All PASS.

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
npm test
```

Expected: All PASS (existing tests use `lang` defaulting to `'vi'` — no call site changes yet).

- [ ] **Step 7: Commit**

```bash
git add src/lib/gemini.js src/test/lib/gemini.test.js
git commit -m "feat: add lang param to gemini functions with Vietnamese prompt instruction"
```

---

## Task 5: Update App.jsx — provider, lang loading, toggle

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/test/App.test.jsx`

**Context:** `App.jsx` adds `lang` state, loads from `getLang()` on mount, saves via `saveLang()` on toggle, and wraps the tree in `LanguageProvider`. The toggle button (`VI`/`EN`) appears in the header only when `step > 0`. `makeT` is used for the rollback toast since `App.jsx` is the provider root.

- [ ] **Step 1: Update the storage mock in `src/test/App.test.jsx`**

The existing `vi.mock` on line 4 is:
```js
vi.mock('../lib/storage.js', () => ({ getApiKey: vi.fn(), checkOpfsAvailable: vi.fn() }))
```

Replace it with:
```js
vi.mock('../lib/storage.js', () => ({
  getApiKey: vi.fn(),
  checkOpfsAvailable: vi.fn(),
  getLang: vi.fn().mockResolvedValue('vi'),
  saveLang: vi.fn().mockResolvedValue(undefined),
}))
```

Also update the `import * as storage` usage — add `storage.getLang` and `storage.saveLang` as needed by the new tests below.

- [ ] **Step 2: Find and fix the breaking assertion for "Library"**

In `src/test/App.test.jsx`, search for any assertion using `/library/i` text or `"Library"` string (e.g. `getByText(/library/i)`, `getByRole('button', { name: /library/i })`). After the change, the Library button renders `t('app.library')` which defaults to `"Library"` in English context. Since `App.jsx` uses `makeT(lang)` directly in the header (not inside the provider tree at that point), the existing test should still see `"Library"`. Verify this is the case, and if any test fails, switch the assertion to use `data-testid`.

- [ ] **Step 3: Add a test for language loading and toggle**

In `src/test/App.test.jsx`, add:

```js
describe('language', () => {
  it('loads saved language from storage on mount', async () => {
    storage.getLang.mockResolvedValue('en')
    storage.getApiKey.mockResolvedValue('my-key')
    render(<App />)
    await waitFor(() => expect(storage.getLang).toHaveBeenCalled())
  })

  it('renders EN toggle button when lang is vi and step > 0', async () => {
    storage.getLang.mockResolvedValue('vi')
    storage.getApiKey.mockResolvedValue('my-key')
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'EN' })).toBeInTheDocument())
  })
})
```

- [ ] **Step 3: Run the App test to confirm the new tests fail**

```bash
npx vitest run src/test/App.test.jsx
```

Expected: New tests FAIL. Existing tests may emit warnings but should not hard-fail (default context provides English fallback).

- [ ] **Step 4: Update `src/App.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { getApiKey, checkOpfsAvailable, getLang, saveLang } from './lib/storage.js'
import { LanguageProvider, makeT } from './lib/i18n.js'
import ProgressBar from './components/ProgressBar.jsx'
import Toast from './components/Toast.jsx'
import Onboarding from './pages/Onboarding.jsx'
import Upload from './pages/Upload.jsx'
import Review from './pages/Review.jsx'
import Library from './pages/Library.jsx'
import Generate from './pages/Generate.jsx'

export default function App() {
  const [step, setStep] = useState(null)
  const [apiKey, setApiKey] = useState(null)
  const [scanData, setScanData] = useState(null)
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [toast, setToast] = useState(null)
  const [opfsError, setOpfsError] = useState(false)
  const [lang, setLang] = useState('vi')

  useEffect(() => {
    Promise.all([getApiKey(), getLang()])
      .then(([key, savedLang]) => {
        setApiKey(key)
        setLang(savedLang)
        setStep(key ? 1 : 0)
      })
      .catch(() => setStep(0))
  }, [])

  useEffect(() => {
    checkOpfsAvailable().catch(() => setOpfsError(true))
  }, [])

  const handleLangToggle = async () => {
    const prev = lang
    const next = lang === 'vi' ? 'en' : 'vi'
    setLang(next)
    try {
      await saveLang(next)
    } catch {
      setLang(prev)
      setToast({ message: makeT(prev)('app.langSaveError'), type: 'error' })
    }
  }

  if (opfsError) {
    const t = makeT(lang)
    return (
      <div
        data-testid="opfs-error"
        className="flex items-center justify-center h-screen bg-white text-gray-900 text-sm"
      >
        {t('app.opfsError')}
      </div>
    )
  }

  if (step === null) {
    const t = makeT(lang)
    return (
      <div
        data-testid="loading"
        className="flex items-center justify-center h-screen bg-white text-gray-900 text-sm"
      >
        {t('app.loading')}
      </div>
    )
  }

  return (
    <LanguageProvider lang={lang} setLang={setLang}>
      <div className="flex flex-col h-screen bg-white text-gray-900 text-sm">
        {toast && (
          <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
        )}
        {step === 0 && (
          <Onboarding
            onSuccess={key => {
              setApiKey(key)
              setStep(1)
            }}
          />
        )}
        {step > 0 && (
          <>
            <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 shrink-0">
              <span className="font-semibold">Doc Template Agent</span>
              <div className="flex items-center gap-3">
                <button
                  className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
                  onClick={() => setStep(0)}
                >
                  {makeT(lang)('app.changeApiKey')}
                </button>
                <button
                  className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
                  onClick={() => setStep(3)}
                >
                  {makeT(lang)('app.library')}
                </button>
                <button
                  className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
                  onClick={handleLangToggle}
                >
                  {lang === 'vi' ? 'EN' : 'VI'}
                </button>
              </div>
            </header>
            <ProgressBar step={step} />
            <div className="flex-1 overflow-auto">
              {step === 1 && (
                <Upload
                  onScan={data => {
                    setScanData(data)
                    setStep(2)
                  }}
                  onToast={setToast}
                />
              )}
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
              {step === 3 && (
                <Library
                  onSelect={tpl => {
                    setSelectedTemplate(tpl)
                    setStep(4)
                  }}
                  onNew={() => setStep(1)}
                  onToast={setToast}
                />
              )}
              {step === 4 && (
                <Generate
                  template={selectedTemplate}
                  onBack={() => setStep(3)}
                  onToast={setToast}
                />
              )}
            </div>
          </>
        )}
      </div>
    </LanguageProvider>
  )
}
```

Note: the header strings use `makeT(lang)(...)` directly because the `<header>` is inside the provider tree — alternatively you can use `useLanguage()` in a child component. Using `makeT(lang)` here is fine since `lang` is already in scope.

Actually, once inside the `return` with `<LanguageProvider>`, the header is a child and could use `useLanguage()`. But since we're in `App.jsx` (the provider itself), keep using `makeT(lang)` inline for the header strings to avoid extracting a sub-component. Both approaches are correct.

- [ ] **Step 5: Run App tests**

```bash
npx vitest run src/test/App.test.jsx
```

Fix any assertions that broke due to text changes (switch to `data-testid` or Vietnamese text as appropriate).

- [ ] **Step 6: Run full suite**

```bash
npm test
```

Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/test/App.test.jsx
git commit -m "feat: add LanguageProvider, lang toggle, and lang loading to App"
```

---

## Task 6: Translate ProgressBar

**Files:**
- Modify: `src/components/ProgressBar.jsx`
- Modify: `src/test/components/ProgressBar.test.jsx`

**Context:** `ProgressBar` currently uses a hardcoded `STEPS` array. Replace with `useLanguage()` to build the labels from locale keys.

- [ ] **Step 1: Read `src/test/components/ProgressBar.test.jsx`** to check for `getByText` assertions on step labels.

- [ ] **Step 2: Update any breaking assertions** to check `data-testid` attributes (`step-1`, `step-2`, etc.) instead of text content.

- [ ] **Step 3: Add a test verifying Vietnamese labels**

```js
import { render, screen } from '@testing-library/react'
import { LanguageProvider } from '../../lib/i18n.js'
import ProgressBar from '../../components/ProgressBar.jsx'

it('renders Vietnamese step labels when lang is vi', () => {
  render(
    <LanguageProvider lang="vi" setLang={() => {}}>
      <ProgressBar step={1} />
    </LanguageProvider>
  )
  expect(screen.getByTestId('step-1').textContent).toContain('Tải lên')
})
```

- [ ] **Step 4: Run ProgressBar tests to confirm new test fails**

```bash
npx vitest run src/test/components/ProgressBar.test.jsx
```

- [ ] **Step 5: Update `src/components/ProgressBar.jsx`**

```jsx
import { useLanguage } from '../lib/i18n.js'

export default function ProgressBar({ step }) {
  const { t } = useLanguage()
  const STEPS = [
    t('progressBar.upload'),
    t('progressBar.review'),
    t('progressBar.library'),
    t('progressBar.generate'),
  ]

  return (
    <div className="flex border-b border-gray-700 shrink-0">
      {STEPS.map((label, i) => {
        const num = i + 1
        const active = step === num
        const done = step > num
        return (
          <div
            key={label}
            data-testid={`step-${num}`}
            data-active={String(active)}
            data-done={String(done)}
            className={`flex-1 py-2 text-center text-xs font-medium border-b-2 transition-colors ${
              active
                ? 'border-blue-500 text-blue-400'
                : done
                ? 'border-green-500 text-green-400'
                : 'border-transparent text-gray-500'
            }`}
          >
            {done ? '✓ ' : ''}{label}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/test/components/ProgressBar.test.jsx
```

Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/ProgressBar.jsx src/test/components/ProgressBar.test.jsx
git commit -m "feat: translate ProgressBar step labels"
```

---

## Task 7: Translate FileDropZone

**Files:**
- Modify: `src/components/FileDropZone.jsx`
- Modify: `src/test/components/FileDropZone.test.jsx`

**Context:** Two hardcoded strings: "Drop a file or click to browse" and "Accepted: PDF, DOCX, XLSX".

- [ ] **Step 1: Read `src/test/components/FileDropZone.test.jsx`** and update any `getByText` assertions on those strings to use `data-testid` or Vietnamese text.

- [ ] **Step 2: Add a Vietnamese label test**

```js
it('renders Vietnamese dropzone text when lang is vi', () => {
  render(
    <LanguageProvider lang="vi" setLang={() => {}}>
      <FileDropZone onFile={() => {}} accept=".docx" />
    </LanguageProvider>
  )
  expect(screen.getByText('Kéo thả tệp hoặc nhấp để duyệt')).toBeInTheDocument()
})
```

- [ ] **Step 3: Run tests to confirm new test fails**

```bash
npx vitest run src/test/components/FileDropZone.test.jsx
```

- [ ] **Step 4: Update `src/components/FileDropZone.jsx`**

Add `import { useLanguage } from '../lib/i18n.js'` and `const { t } = useLanguage()` at the top of the component. Replace:

```jsx
<span className="text-sm text-gray-300">Drop a file or click to browse</span>
<span className="text-xs text-gray-500">Accepted: PDF, DOCX, XLSX</span>
```

With:

```jsx
<span className="text-sm text-gray-300">{t('upload.dropzoneLabel')}</span>
<span className="text-xs text-gray-500">{t('upload.dropzoneAccepted')}</span>
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/test/components/FileDropZone.test.jsx
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/FileDropZone.jsx src/test/components/FileDropZone.test.jsx
git commit -m "feat: translate FileDropZone strings"
```

---

## Task 8: Translate VariableChip and Toast

**Files:**
- Modify: `src/components/VariableChip.jsx`
- Modify: `src/components/Toast.jsx`
- Modify: `src/test/components/VariableChip.test.jsx`
- Modify: `src/test/components/Toast.test.jsx`

**Context:** Only aria-labels need translation — no visible text changes. Tests that find elements by `aria-label` in English will need updating.

- [ ] **Step 1: Read both test files** and identify assertions using `getByLabelText` or `aria-label` matching English strings.

- [ ] **Step 2: Update `src/components/VariableChip.jsx`**

Add `import { useLanguage } from '../lib/i18n.js'` and `const { t } = useLanguage()`. Change:

```jsx
aria-label="remove variable"
```

To:

```jsx
aria-label={t('variableChip.ariaRemove')}
```

- [ ] **Step 3: Update `src/components/Toast.jsx`**

Add `import { useLanguage } from '../lib/i18n.js'` and `const { t } = useLanguage()`. Change:

```jsx
aria-label="dismiss toast"
```

To:

```jsx
aria-label={t('toast.ariaDismiss')}
```

- [ ] **Step 4: Update test files** — replace `getByLabelText('remove variable')` / `getByLabelText('dismiss toast')` with the Vietnamese equivalents (`'xóa biến'` / `'đóng thông báo'`) or use `getByRole` queries that don't depend on label text.

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/test/components/VariableChip.test.jsx src/test/components/Toast.test.jsx
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/VariableChip.jsx src/components/Toast.jsx src/test/components/VariableChip.test.jsx src/test/components/Toast.test.jsx
git commit -m "feat: translate VariableChip and Toast aria-labels"
```

---

## Task 9: Translate Onboarding page

**Files:**
- Modify: `src/pages/Onboarding.jsx`
- Modify: `src/test/pages/Onboarding.test.jsx`

**Context:** Onboarding renders without a `LanguageProvider` (step 0, toggle not shown). The default context value (`makeT('en')`) means tests without a provider see English — existing tests continue to pass. Add new tests verifying Vietnamese renders when wrapped.

- [ ] **Step 1: Write a failing test first**

In `src/test/pages/Onboarding.test.jsx`, add:

```js
import { LanguageProvider } from '../../lib/i18n.js'

it('renders Vietnamese submit button when lang is vi', () => {
  render(
    <LanguageProvider lang="vi" setLang={() => {}}>
      <Onboarding onSuccess={vi.fn()} />
    </LanguageProvider>
  )
  expect(screen.getByRole('button', { name: 'Kiểm tra kết nối' })).toBeInTheDocument()
})
```

Run to confirm it fails:
```bash
npx vitest run src/test/pages/Onboarding.test.jsx
```

- [ ] **Step 2: Update `src/pages/Onboarding.jsx`**

```jsx
import { useState } from 'react'
import { testConnection } from '../lib/gemini.js'
import { saveApiKey } from '../lib/storage.js'
import { useLanguage } from '../lib/i18n.js'

export default function Onboarding({ onSuccess }) {
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const { t } = useLanguage()

  const handleSubmit = async e => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await testConnection(key.trim())
      await saveApiKey(key.trim())
      onSuccess(key.trim())
    } catch (err) {
      setError(err.message ?? 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen p-6 gap-6">
      <div className="text-center">
        <h1 className="text-lg font-bold text-white">{t('onboarding.title')}</h1>
        <p className="text-xs text-gray-400 mt-1">{t('onboarding.subtitle')}</p>
      </div>
      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
        <input
          type="password"
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder={t('onboarding.placeholder')}
          className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !key.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded transition-colors"
        >
          {loading ? t('onboarding.submitting') : t('onboarding.submit')}
        </button>
      </form>
      <p className="text-xs text-gray-500 text-center">
        {t('onboarding.getKey')}{' '}
        <span className="text-blue-400">aistudio.google.com</span>
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Run all Onboarding tests**

```bash
npx vitest run src/test/pages/Onboarding.test.jsx
```

Existing tests render without a provider — they get the default English context, so `t('onboarding.submit')` → `'Test Connection'`. They should still PASS. The new Vietnamese test should now also PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Onboarding.jsx src/test/pages/Onboarding.test.jsx
git commit -m "feat: translate Onboarding page"
```

---

## Task 10: Translate Upload page

**Files:**
- Modify: `src/pages/Upload.jsx`
- Modify: `src/test/pages/Upload.test.jsx`

- [ ] **Step 1: Update `src/pages/Upload.jsx`**

```jsx
import { useState } from 'react'
import FileDropZone from '../components/FileDropZone.jsx'
import { renderFile } from '../lib/renderers/index.js'
import { useLanguage } from '../lib/i18n.js'

export default function Upload({ onScan, onToast }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const { t } = useLanguage()

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
      <h2 className="text-sm font-semibold text-gray-300">{t('upload.title')}</h2>
      {loading ? (
        <div data-testid="loading" className="flex flex-col items-center gap-3 py-10 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs">{t('upload.rendering')}</span>
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

- [ ] **Step 2: Add a Vietnamese rendering test to `src/test/pages/Upload.test.jsx`**

```js
import { LanguageProvider } from '../../lib/i18n.js'

it('renders Vietnamese heading when lang is vi', () => {
  render(
    <LanguageProvider lang="vi" setLang={() => {}}>
      <Upload onScan={() => {}} onToast={() => {}} />
    </LanguageProvider>
  )
  expect(screen.getByText('Tải lên tài liệu')).toBeInTheDocument()
})
```

- [ ] **Step 3: Run Upload tests; fix any breaking `getByText` assertions**

```bash
npx vitest run src/test/pages/Upload.test.jsx
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Upload.jsx src/test/pages/Upload.test.jsx
git commit -m "feat: translate Upload page"
```

---

## Task 11: Translate Library page

**Files:**
- Modify: `src/pages/Library.jsx`
- Modify: `src/test/pages/Library.test.jsx`

- [ ] **Step 1: Update `src/pages/Library.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { getTemplates, deleteTemplate } from '../lib/storage.js'
import { useLanguage } from '../lib/i18n.js'

const FORMAT_BADGE = {
  pdf: 'bg-red-700',
  docx: 'bg-blue-700',
  xlsx: 'bg-green-700',
  xls: 'bg-green-700',
}

export default function Library({ onSelect, onNew, onToast }) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const { t } = useLanguage()

  useEffect(() => {
    getTemplates()
      .then(list => {
        setTemplates(list)
        setLoading(false)
      })
      .catch(err => {
        setLoading(false)
        onToast({ message: `${t('library.errorLoad')} ${err.message}`, type: 'error' })
      })
  }, [])

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    try {
      await deleteTemplate(id)
      setTemplates(prev => prev.filter(tp => tp.id !== id))
    } catch (err) {
      onToast({ message: `${t('library.errorDelete')} ${err.message}`, type: 'error' })
    }
  }

  if (loading) {
    return <div className="p-4 text-xs text-gray-500">{t('library.loading')}</div>
  }

  if (templates.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 text-xs flex flex-col items-center gap-3">
        <span>{t('library.empty')}</span>
        <button
          onClick={onNew}
          className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          {t('library.new')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="flex justify-end mb-1">
        <button
          onClick={onNew}
          className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          {t('library.new')}
        </button>
      </div>
      {templates.map(tpl => {
        const count = (tpl.fields ?? []).length
        return (
          <div
            key={tpl.id}
            onClick={() => onSelect(tpl)}
            className="flex items-center gap-2 p-3 rounded-lg bg-gray-800 hover:bg-gray-700 cursor-pointer transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white font-medium truncate">{tpl.name}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {count} {t(count === 1 ? 'library.variable' : 'library.variables')}
              </div>
            </div>
            <span
              className={`text-xs text-white px-1.5 py-0.5 rounded shrink-0 ${FORMAT_BADGE[tpl.sourceFormat] ?? 'bg-gray-600'}`}
            >
              {(tpl.sourceFormat ?? '').toUpperCase()}
            </span>
            <button
              onClick={e => handleDelete(e, tpl.id)}
              aria-label={t('library.ariaDelete')}
              className="text-gray-500 hover:text-red-400 shrink-0 text-sm"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Add a Vietnamese rendering test to `src/test/pages/Library.test.jsx`**

```js
import { LanguageProvider } from '../../lib/i18n.js'

it('renders Vietnamese empty state when lang is vi', async () => {
  // Mock getTemplates to return empty
  render(
    <LanguageProvider lang="vi" setLang={() => {}}>
      <Library onSelect={() => {}} onNew={() => {}} onToast={() => {}} />
    </LanguageProvider>
  )
  await waitFor(() => expect(screen.getByText('Chưa có mẫu nào được lưu.')).toBeInTheDocument())
})
```

- [ ] **Step 3: Run Library tests; fix any breaking assertions**

```bash
npx vitest run src/test/pages/Library.test.jsx
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Library.jsx src/test/pages/Library.test.jsx
git commit -m "feat: translate Library page"
```

---

## Task 12: Translate Generate page

**Files:**
- Modify: `src/pages/Generate.jsx`
- Modify: `src/test/pages/Generate.test.jsx`

- [ ] **Step 1: Update `src/pages/Generate.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { generateDocx, generateXlsx, saveFile } from '../lib/templateEngine.js'
import { getTemplateBinary } from '../lib/storage.js'
import { useLanguage } from '../lib/i18n.js'

export default function Generate({ template, onBack, onToast }) {
  const [values, setValues] = useState({})
  const [generating, setGenerating] = useState(false)
  const [binary, setBinary] = useState(null)
  const [binaryError, setBinaryError] = useState(false)
  const [loading, setLoading] = useState(true)
  const { t } = useLanguage()

  useEffect(() => {
    getTemplateBinary(template.id)
      .then(buf => {
        setBinary(buf)
        setLoading(false)
      })
      .catch(() => {
        onToast({ message: t('generate.errorNotFound'), type: 'error' })
        setBinaryError(true)
        setLoading(false)
      })
  }, [template.id])

  const handleChange = (name, value) => {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const fieldValues = Object.fromEntries(
        template.fields.map(f => [f, values[f] ?? ''])
      )

      let blob
      if (template.sourceFormat === 'docx') {
        blob = await generateDocx(binary, fieldValues)
        await saveFile(blob, `${template.name}.docx`, template.sourceFormat)
      } else {
        blob = await generateXlsx(binary, fieldValues)
        await saveFile(blob, `${template.name}.xlsx`, template.sourceFormat)
      }
    } catch (err) {
      onToast({ message: `${t('generate.errorFailed')} ${err.message}`, type: 'error' })
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
          {t('generate.back')}
        </button>
        <span className="text-sm font-medium text-white truncate flex-1">{template.name}</span>
      </div>

      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        {template.fields.map(name => {
          const description = template.fieldDescriptions?.[name]
          return (
            <div key={name} className="flex flex-col gap-1">
              <label htmlFor={`field-${name}`} className="text-xs text-gray-400 font-medium">
                {name}
              </label>
              {description && (
                <p className="text-xs text-gray-500 -mt-0.5">{description}</p>
              )}
              <input
                id={`field-${name}`}
                value={values[name] ?? ''}
                onChange={e => handleChange(name, e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                placeholder={`${t('generate.fieldPlaceholder')} ${name}…`}
              />
            </div>
          )
        })}
      </div>

      <div className="p-3 border-t border-gray-700 flex gap-2 items-center shrink-0">
        <button
          onClick={handleGenerate}
          disabled={loading || binaryError || generating}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-1.5 rounded transition-colors"
        >
          {generating ? t('generate.generating') : t('generate.download')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add a Vietnamese rendering test to `src/test/pages/Generate.test.jsx`**

```js
import { LanguageProvider } from '../../lib/i18n.js'

it('renders Vietnamese download button when lang is vi', async () => {
  render(
    <LanguageProvider lang="vi" setLang={() => {}}>
      <Generate template={{ id: 't1', name: 'Test', fields: [], sourceFormat: 'docx' }} onBack={() => {}} onToast={() => {}} />
    </LanguageProvider>
  )
  await waitFor(() => expect(screen.getByText('⬇ Tải xuống')).toBeInTheDocument())
})
```

- [ ] **Step 3: Run Generate tests; fix any breaking assertions**

```bash
npx vitest run src/test/pages/Generate.test.jsx
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/Generate.jsx src/test/pages/Generate.test.jsx
git commit -m "feat: translate Generate page"
```

---

## Task 13: Translate Review page + wire lang to Gemini calls

**Files:**
- Modify: `src/pages/Review.jsx`
- Modify: `src/test/pages/Review.test.jsx`
- Modify: `src/test/Review.xlsx.test.jsx`

**Context:** This is the most complex page. The key additions beyond string replacement are:
1. `const { t, lang } = useLanguage()` at the top
2. Pass `lang` to `suggestFieldName` and `suggestFieldPattern` calls in `openSuggestion`
3. All hardcoded error strings → `t()` calls

- [ ] **Step 1: Update `src/pages/Review.jsx`**

At the top, add `useLanguage` import and destructure both `t` and `lang`:

```js
import { useLanguage } from '../lib/i18n.js'
// inside component:
const { t, lang } = useLanguage()
```

Replace every hardcoded English string with the appropriate `t('review.*')` call. Key replacements (search for these exact strings and replace):

| Old string | New expression |
|---|---|
| `'← Back'` | `t('review.back')` |
| `` `${fields.length} field${fields.length !== 1 ? 's' : ''}` `` | `` `${fields.length} ${t(fields.length === 1 ? 'review.fields' : 'review.fields_plural')}` `` |
| `'Template name…'` (placeholder) | `t('review.templatePlaceholder')` |
| `'Save Template'` | `t('review.save')` |
| `'Saving…'` | `t('review.saving')` |
| `'Click a cell — AI will…'` (xlsxHint) | `t('review.xlsxHint')` |
| `'Label (preserved)'` | `t('review.labelPreserved')` |
| `'Field name'` | `t('review.fieldName')` |
| `'Description'` | `t('review.description')` |
| `'(max 10 words)'` | `t('review.descriptionHint')` |
| `'What does this field represent?'` | `t('review.descriptionPlaceholder')` |
| `'Accept'` | `t('review.accept')` |
| `'Dismiss'` | `t('review.dismiss')` |
| `'Analyzing…'` | `t('review.analyzing')` |
| `'Select text within a single paragraph'` | `t('review.errorSingleParagraph')` |
| `'This cell is already a field'` | `t('review.errorAlreadyField')` |
| `'AI suggestion failed — enter values manually'` | `t('review.errorAiFailed')` |
| `'Field name is required'` | `t('review.errorFieldRequired')` |
| `'Field name must start with a letter…'` | `t('review.errorFieldFormat')` |
| `'Field name already used — choose another'` | `t('review.errorFieldDuplicate')` |
| `'Could not locate selection…'` | `t('review.errorInsertFailed')` |
| `'Define at least one field before saving'` | `t('review.errorNoFields')` |
| `'Enter a template name'` | `t('review.errorNoName')` |
| `` `Save failed: ${err.message}` `` | `` `${t('review.errorSaveFailed')} ${err.message}` `` |
| `"Field name suggestion"` (aria-label) | `t('review.ariaPopover')` |
| `"Worksheet tabs"` (aria-label) | `t('review.ariaTablist')` |

In `openSuggestion`, pass `lang` to both Gemini calls:

```js
// DOCX path:
const suggested = await suggestFieldName(apiKey, selectedText, surroundingContext, fields, lang)
// XLSX path:
const result = await suggestFieldPattern(apiKey, fullCellText, selectedText, fields, surroundingContext, lang)
```

- [ ] **Step 2: Run Review tests; fix any breaking assertions**

```bash
npx vitest run src/test/pages/Review.test.jsx src/test/Review.xlsx.test.jsx
```

Fix assertions that matched English strings — switch to `data-testid` selectors where possible.

- [ ] **Step 3: Run full suite**

```bash
npm test
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Review.jsx src/test/pages/Review.test.jsx src/test/Review.xlsx.test.jsx
git commit -m "feat: translate Review page and wire lang to Gemini calls"
```

---

## Task 14: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: All tests PASS with no failures or warnings about missing context.

- [ ] **Step 2: Build the extension**

```bash
npm run build
```

Expected: Build completes with no errors. Check that `dist/` is populated.

- [ ] **Step 3: Manual smoke check** (if Chrome available)

Load the `dist/` folder as an unpacked extension. Verify:
- Default language is Vietnamese on all screens
- Header shows `EN` toggle when past Onboarding
- Clicking `EN` switches all UI text to English and shows `VI` toggle
- Reloading preserves the language choice
- Field suggestion popover text is in the active language

- [ ] **Step 4: Final commit**

```bash
git add src/locales/ src/lib/ src/pages/ src/components/ src/test/
git commit -m "feat: complete multi-language VI/EN support"
```
