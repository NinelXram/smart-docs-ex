# Multi-Language Support Design
**Date:** 2026-03-23
**Status:** Approved

## Overview

Add Vietnamese (default) and English language support to the Gemini Doc-Template Agent Chrome extension. Localization covers the full UI and AI-generated field descriptions/suggestions from Gemini.

## Requirements

- Two supported languages: Vietnamese (`vi`, default) and English (`en`)
- Language toggle in the app header (visible on all steps past Onboarding)
- Language preference persisted to `chrome.storage.local`
- All UI strings translated via JSON locale files
- Gemini prompts instructed to respond in the active language
- No new third-party dependencies

## Architecture

### New Files

| File | Purpose |
|---|---|
| `src/locales/vi.json` | Vietnamese string translations (default locale) |
| `src/locales/en.json` | English string translations |
| `src/lib/i18n.js` | `LanguageContext`, `LanguageProvider`, `useLanguage()` hook |

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
| `src/components/ProgressBar.jsx` | Replace hardcoded strings with `t()` if any |
| `src/components/FileDropZone.jsx` | Replace hardcoded strings with `t()` if any |
| `src/components/Toast.jsx` | Replace hardcoded strings with `t()` if any |

## State & Persistence

- `lang` state lives in `App.jsx` alongside `apiKey` and `step`
- On mount: load from `chrome.storage.local` key `"lang"`, default to `"vi"` if absent
- On toggle: call `saveLang(newLang)` then `setLang(newLang)`
- `LanguageProvider` receives `lang` and `setLang` as props and exposes them via context

## i18n Module (`src/lib/i18n.js`)

```js
import vi from '../locales/vi.json'
import en from '../locales/en.json'

const locales = { vi, en }

export const LanguageContext = createContext()

export function LanguageProvider({ lang, setLang, children }) {
  function t(key) {
    const parts = key.split('.')
    const val = parts.reduce((obj, k) => obj?.[k], locales[lang])
      ?? parts.reduce((obj, k) => obj?.[k], locales['en'])
      ?? key
    return val
  }
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

## Locale Key Structure

Both `vi.json` and `en.json` share this shape:

```json
{
  "app": {
    "title": "...",
    "changeApiKey": "...",
    "library": "...",
    "loading": "...",
    "opfsError": "..."
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
  }
}
```

## Gemini Language Integration

Each of the three Gemini functions gains a `lang` parameter (default `"vi"`):

```js
export async function suggestFieldName(apiKey, selectedText, surroundingContext, existingFields, lang = 'vi')
export async function suggestFieldPattern(apiKey, fullCellText, selectedText, existingFields, spatialContext, lang = 'vi')
export async function extractVariables(apiKey, content, lang = 'vi')
```

When `lang === "vi"`, append `"\nRespond in Vietnamese."` to the prompt string before sending to the model. When `lang === "en"`, no extra instruction is needed.

`Review.jsx` reads `lang` from `useLanguage()` and passes it to both `suggestFieldName` and `suggestFieldPattern`.

## Header Toggle

In `App.jsx`, the header's button group gains a language toggle:

```jsx
<button onClick={() => { saveLang(lang === 'vi' ? 'en' : 'vi'); setLang(lang === 'vi' ? 'en' : 'vi') }}>
  {lang === 'vi' ? 'EN' : 'VI'}
</button>
```

Styled consistently with the existing "Library" and "Change API Key" buttons (`text-xs text-gray-500 hover:text-gray-900`).

## Testing

- Existing tests do not test hardcoded string content, so translation swaps should not break them
- New unit tests for `i18n.js`: `t()` returns correct value, falls back to `en`, falls back to key
- New unit tests for `storage.js`: `getLang()` / `saveLang()` round-trip
- Gemini tests: verify `lang` param appends the Vietnamese instruction to the prompt

## Out of Scope

- RTL layout support
- More than two languages
- Plural rules beyond simple `field`/`fields` count
- Translation of dynamic content (document content, template names entered by user)
