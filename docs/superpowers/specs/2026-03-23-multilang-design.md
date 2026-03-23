# Multi-Language Support Design
**Date:** 2026-03-23
**Status:** Approved

## Overview

Add Vietnamese (default) and English language support to the Gemini Doc-Template Agent Chrome extension. Localization covers the full UI and AI-generated field descriptions/suggestions from Gemini.

## Requirements

- Two supported languages: Vietnamese (`vi`, default) and English (`en`)
- Language toggle in the app header (visible on steps 1–4 only; MUST NOT appear on step 0 / Onboarding)
- Language preference persisted to `chrome.storage.local`
- All UI strings translated via JSON locale files
- Gemini prompts instructed to respond in the active language
- No new third-party dependencies

### Onboarding Language Constraint (Accepted)

The toggle is hidden on the Onboarding screen (step 0). Users who have never set an API key will see Vietnamese (the default) on Onboarding with no way to switch. This is accepted: the toggle becomes available immediately after the API key is confirmed (step 1). English-speaking first-time users will see a single screen in Vietnamese before gaining access to the toggle.

## Architecture

### New Files

| File | Purpose |
|---|---|
| `src/locales/vi.json` | Vietnamese string translations (default locale) |
| `src/locales/en.json` | English string translations |
| `src/lib/i18n.js` | `LanguageContext`, `LanguageProvider`, `useLanguage()`, `makeT(lang)` |

### Modified Files

| File | Change |
|---|---|
| `src/lib/storage.js` | Add `getLang()` and `saveLang(lang)` |
| `src/App.jsx` | Load/save lang, add toggle to header, wrap tree in `LanguageProvider` |
| `src/lib/gemini.js` | Add `lang` param to `suggestFieldName`, `suggestFieldPattern`, `extractVariables` |
| `src/pages/Onboarding.jsx` | Replace hardcoded strings with `t()` |
| `src/pages/Upload.jsx` | Replace hardcoded strings with `t()` |
| `src/pages/Review.jsx` | Replace hardcoded strings with `t()`; pass `lang` to Gemini calls |
| `src/pages/Library.jsx` | Replace hardcoded strings with `t()` |
| `src/pages/Generate.jsx` | Replace hardcoded strings with `t()` |
| `src/components/ProgressBar.jsx` | Translate step labels via `progressBar` locale namespace |
| `src/components/FileDropZone.jsx` | Translate two visible strings (see `upload` namespace) |
| `src/components/VariableChip.jsx` | Translate `aria-label="remove variable"` via `variableChip.ariaRemove` |
| `src/components/Toast.jsx` | Translate `aria-label="dismiss toast"` via `toast.ariaDismiss` |

### Pre-Audit Results for Components

Checked before finalizing the spec:

- **ProgressBar**: has hardcoded `['Upload', 'Review', 'Library', 'Generate']` step labels → added to `progressBar` namespace
- **FileDropZone**: has "Drop a file or click to browse" and "Accepted: PDF, DOCX, XLSX" → added to `upload` namespace
- **VariableChip**: only hardcoded string is `aria-label="remove variable"` → added to `variableChip` namespace
- **Toast**: renders a `message` prop (no hardcoded visible text); only hardcoded string is `aria-label="dismiss toast"` → added to `toast` namespace

## State & Persistence

- `lang` state lives in `App.jsx` alongside `apiKey` and `step`
- On mount: load from `chrome.storage.local` via `getLang()`, default to `"vi"` if absent or on error
- On toggle: `setLang(next)` immediately (optimistic), then `await saveLang(next)`. If `saveLang` rejects, rollback via `setLang(prev)` and show a toast error using `makeT(prev)('app.langSaveError')`.
- `LanguageProvider` is intentionally a thin context bridge — it receives `lang` and `setLang` as props from `App.jsx` rather than owning state internally. This keeps all root-level state co-located in `App.jsx`.

## `storage.js` Additions

```js
const LANG_KEY = 'lang'

export async function getLang() {
  return new Promise(resolve => {
    chrome.storage.local.get([LANG_KEY], result => {
      resolve(result[LANG_KEY] ?? 'vi')
    })
  })
}

export async function saveLang(lang) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [LANG_KEY]: lang }, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
      else resolve()
    })
  })
}
```

Follows the same pattern as the existing `getApiKey` / `saveApiKey` functions.

## i18n Module (`src/lib/i18n.js`)

```js
import { createContext, useContext } from 'react'
import vi from '../locales/vi.json'
import en from '../locales/en.json'

const locales = { vi, en }

export const LanguageContext = createContext()

/** Standalone lookup — usable outside a React tree (e.g., in App.jsx before the provider). */
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

- `t(key)`: dot-notation lookup in active locale → falls back to `en` → falls back to key string
- `makeT(lang)` is exported for use in `App.jsx` where `useLanguage()` is unavailable (App.jsx is the provider root, not a consumer)

## Locale Key Structure

Both `vi.json` and `en.json` share this shape:

```json
{
  "app": {
    "title": "...",
    "changeApiKey": "...",
    "library": "...",
    "loading": "...",
    "opfsError": "...",
    "langSaveError": "..."
  },
  "onboarding": {
    "title": "...",
    "subtitle": "...",
    "placeholder": "...",
    "submit": "...",
    "submitting": "...",
    "getKey": "..."
  },
  "upload": {
    "dropzone": "...",
    "browse": "...",
    "dropzoneLabel": "...",
    "dropzoneAccepted": "...",
    "unsupported": "..."
  },
  "review": {
    "back": "...",
    "fields": "...",
    "fields_plural": "...",
    "templatePlaceholder": "...",
    "save": "...",
    "saving": "...",
    "xlsxHint": "...",
    "labelPreserved": "...",
    "fieldName": "...",
    "description": "...",
    "descriptionHint": "...",
    "descriptionPlaceholder": "...",
    "accept": "...",
    "dismiss": "...",
    "analyzing": "...",
    "errorSingleParagraph": "...",
    "errorAlreadyField": "...",
    "errorFieldRequired": "...",
    "errorFieldFormat": "...",
    "errorFieldDuplicate": "...",
    "errorInsertFailed": "...",
    "errorAiFailed": "...",
    "errorNoFields": "...",
    "errorNoName": "...",
    "errorSaveFailed": "...",
    "ariaPopover": "...",
    "ariaTablist": "..."
  },
  "library": {
    "empty": "...",
    "new": "...",
    "delete": "...",
    "use": "..."
  },
  "generate": {
    "back": "...",
    "generate": "...",
    "generating": "...",
    "download": "..."
  },
  "progressBar": {
    "upload": "...",
    "review": "...",
    "library": "...",
    "generate": "..."
  },
  "variableChip": {
    "ariaRemove": "..."
  },
  "toast": {
    "ariaDismiss": "..."
  }
}
```

### English locale values (en.json)

Key values for English, for reference during implementation:

- `app.langSaveError`: "Failed to save language preference"
- `upload.dropzoneLabel`: "Drop a file or click to browse"
- `upload.dropzoneAccepted`: "Accepted: PDF, DOCX, XLSX"
- `progressBar.upload`: "Upload", `progressBar.review`: "Review", `progressBar.library`: "Library", `progressBar.generate`: "Generate"
- `variableChip.ariaRemove`: "remove variable"
- `toast.ariaDismiss`: "dismiss toast"
- `review.fields`: "field", `review.fields_plural`: "fields"

### Plural Convention

Vietnamese has no grammatical plural, so `vi.json` uses the same string for both keys. Call sites use a ternary — used in exactly one place in `Review.jsx`:

```jsx
t(fields.length === 1 ? 'review.fields' : 'review.fields_plural')
```

No helper function is needed.

## Gemini Language Integration

Each of the three Gemini functions gains a `lang` parameter (default `"vi"`):

```js
export async function suggestFieldName(apiKey, selectedText, surroundingContext, existingFields, lang = 'vi')
export async function suggestFieldPattern(apiKey, fullCellText, selectedText, existingFields, spatialContext, lang = 'vi')
export async function extractVariables(apiKey, content, lang = 'vi')
```

When `lang === "vi"`, append `"\nRespond in Vietnamese."` to the prompt string before sending to the model. When `lang === "en"`, no extra instruction is needed.

### Call Sites

- `Review.jsx` reads `lang` from `useLanguage()` and passes it to `suggestFieldName` and `suggestFieldPattern`.
- `extractVariables`: currently has no call site in the UI flow. The implementer **must grep for `extractVariables` across the codebase** (particularly in the files listed as modified in git status: `src/App.jsx`, `src/pages/Generate.jsx`, `src/pages/Library.jsx`) to confirm this before finalizing. If a call site is found, it must receive `lang` from the nearest `useLanguage()` context.

## Header Toggle

```jsx
<button
  className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
  onClick={async () => {
    const prev = lang
    const next = lang === 'vi' ? 'en' : 'vi'
    setLang(next)
    try {
      await saveLang(next)
    } catch {
      setLang(prev) // rollback
      setToast({ message: makeT(prev)('app.langSaveError'), type: 'error' })
    }
  }}
>
  {lang === 'vi' ? 'EN' : 'VI'}
</button>
```

The `"VI"` / `"EN"` button labels are intentionally hardcoded — they are language-neutral identifiers, not translated strings, and must remain recognizable regardless of the active locale.

`makeT` is imported from `src/lib/i18n.js` for use in the rollback toast, since `App.jsx` is the provider root and cannot call `useLanguage()`.

## Testing

### Audit Existing Tests First

Before replacing hardcoded strings, audit these test files for `getByText` / `findByText` assertions on English strings that will break after locale change (default is now `"vi"`). All these files are confirmed to exist:

- `src/test/App.test.jsx`
- `src/test/pages/Onboarding.test.jsx`
- `src/test/pages/Upload.test.jsx`
- `src/test/pages/Review.test.jsx`
- `src/test/pages/Library.test.jsx`
- `src/test/pages/Generate.test.jsx`

Any such assertions must be updated to use Vietnamese strings or switched to `data-testid` selectors.

Also audit these component test files for the same issue:

- `src/test/components/ProgressBar.test.jsx`
- `src/test/components/FileDropZone.test.jsx`
- `src/test/components/VariableChip.test.jsx`
- `src/test/components/Toast.test.jsx`

### New Test Files

| File | Coverage |
|---|---|
| `src/test/lib/i18n.test.js` | `makeT('vi')` returns vi value; falls back to en on missing vi key; falls back to key string on missing both; `useLanguage()` returns context values |
| `src/test/lib/storage.test.js` (extend existing — file confirmed present) | `getLang()` returns `"vi"` when key absent; `saveLang()` round-trip; `saveLang()` rejects on `lastError` |

### Gemini Test Updates

In `src/test/lib/gemini.test.js` and `src/test/gemini.test.js`: verify that `lang = 'vi'` appends `"Respond in Vietnamese."` to prompts for all three functions, and that `lang = 'en'` does not append it.

## Out of Scope

- RTL layout support
- More than two languages
- Complex plural rules (English plural here is a single ternary; Vietnamese has none)
- Translation of dynamic content (document content, template names entered by user)
