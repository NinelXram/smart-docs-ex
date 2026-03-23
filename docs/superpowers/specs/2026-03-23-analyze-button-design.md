# Analyze Button — Design Spec
Date: 2026-03-23

## Overview

Add an **Analyze** button to the Generate page that lets users upload an image or document (CV, form, etc.). Gemini extracts values for the template fields and auto-populates the matching inputs.

---

## Placement

The Analyze button sits in the **header bar**, top-right corner, mirroring the Back button on the left:

```
[ ← Back ]  My Template Name  [ ✦ Analyze ]
```

The footer bar is unchanged: only the Download button lives there.

---

## Accepted File Formats

- Images: `image/*` (PNG, JPG, etc.)
- PDF: `application/pdf`
- DOCX: `.docx`
- Plain text: `.txt`

Input accept string: `image/*,.pdf,.docx,.txt`

---

## File Picker UX

- **Click** Analyze → calls `fileInputRef.current.click()` via a `useRef` on the hidden input
- **Drag-and-drop** onto the Analyze button → `onDragOver` prevents default, `onDrop` reads `e.dataTransfer.files[0]`
- Both paths call the same `handleAnalyze(file)` handler
- No drag-over visual styling is required on the button
- `handleAnalyze` returns early if `analyzing` is already `true` (prevents concurrent in-flight calls)

---

## API Key

`Generate.jsx` calls `getApiKey()` from `src/lib/storage.js` at the start of `handleAnalyze`. If the key is null, it shows the `analyzeError` toast immediately without calling `analyzeSource`. The `apiKey` is **not** added as a prop to `Generate` — it is retrieved internally, consistent with how `Review.jsx` retrieves it.

---

## Language

`handleAnalyze` reads `lang` from `useLanguage()` (already used in the component for `t`) and passes it into `analyzeSource`.

---

## Data Flow

```
User clicks Analyze / drops file
  ↓
handleAnalyze(file)  ← same function for click and drag-drop
  [return early if analyzing === true]
  ↓
getApiKey() from storage  [toast + return if null]
  ↓
setAnalyzing(true)
  ↓
analyzeSource(apiKey, file, fields, lang)
  ├─ image/* or application/pdf
  │   [throw if file.size > 4 MB]
  │   → chunked base64 encoding (see below)
  │   → model.generateContent([
  │       { inlineData: { mimeType: file.type, data: base64 } },
  │       { text: prompt }
  │     ])
  ├─ .docx
  │   → mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  │   → .value  [throw if > MAX_CHARS]
  │   → model.generateContent(prompt + '\n\n' + text)
  └─ .txt
      → FileReader.readAsText(file)  [throw if > MAX_CHARS]
      → model.generateContent(prompt + '\n\n' + text)
  ↓
Strip markdown fences, JSON.parse (retry once with stricter prompt on failure)
  ↓
Filter to only keys present in fields[] (guard against hallucinated keys)
A Gemini response of {} and a response where all keys are filtered out are
treated identically — both result in setValues being called with an empty spread.
No special zero-match branch is needed.
  ↓
setValues(prev => ({ ...prev, ...matched }))
  ↓
setAnalyzing(false)
```

### Full Gemini prompt

```
These are the template field names: [fieldA, fieldB, fieldC].
Extract matching values from the document.
Return JSON only: {"fieldName": "value", ...}.
Only include fields you are confident about.
<appended if lang === 'vi': "\nRespond in Vietnamese.">
```

### JSON parsing

Follow the same pattern as all existing `gemini.js` functions:

```js
const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
const parsed = JSON.parse(cleaned)
```

Retry once on failure with `'\n\nCRITICAL: respond with valid JSON only.'` appended to the prompt (same pattern as `extractVariables`). Throw on second failure.

### Chunked base64 encoding

Use the chunked loop to avoid call stack overflow on large files:

```js
const bytes = new Uint8Array(arrayBuffer)
let binary = ''
const chunkSize = 8192
for (let i = 0; i < bytes.length; i += chunkSize) {
  binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
}
const base64 = btoa(binary)
```

Do **not** use `btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))` — the spread operator hits the call stack limit for files larger than ~250 KB.

---

## Partial Match Behavior

- Fields Gemini matched: auto-populated
- Fields Gemini did not match: left empty, user fills manually
- **Zero matches**: silent no-op — `setValues` is still called, spread of `{}` changes nothing. No toast. Deliberate: the user sees immediately that no fields changed and can try a different file.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gemini.js` | Add `analyzeSource(apiKey, file, fields, lang)` |
| `src/pages/Generate.jsx` | Add Analyze button, `fileInputRef`, drag-drop handlers, `analyzing` state, `handleAnalyze` |
| `src/locales/en.json` | Add `generate.analyze`, `generate.analyzing`, `generate.analyzeError` |
| `src/locales/vi.json` | Same keys in Vietnamese |

Note: `generate.analyzing` is a new key under the `generate` namespace — do not reuse `review.analyzing`.

### i18n string values

| Key | English | Vietnamese |
|-----|---------|------------|
| `generate.analyze` | `"Analyze"` | `"Phân tích"` |
| `generate.analyzing` | `"Analyzing…"` | `"Đang phân tích…"` |
| `generate.analyzeError` | `"Analysis failed:"` | `"Phân tích thất bại:"` |

---

## analyzeSource() Signature

```js
/**
 * Read a file and ask Gemini to extract values for known template fields.
 * Binary files (images, PDF) are sent via inlineData multimodal call.
 * Text files (DOCX, TXT) are extracted to string and sent as a text prompt.
 * @param {string} apiKey
 * @param {File} file
 * @param {string[]} fields - known template field names
 * @param {string} [lang]
 * @returns {Promise<Record<string, string>>} - matched field values only
 */
export async function analyzeSource(apiKey, file, fields, lang = 'vi')
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `analyzing` already true | Return early (no toast) |
| No API key (`getApiKey()` returns null) | Toast `analyzeError`, return (no API call) |
| File > 4 MB (binary path) | `analyzeSource` throws → toast `analyzeError` |
| Text > MAX_CHARS (text path) | `analyzeSource` throws → toast `analyzeError` |
| Gemini API error | Catch → toast `analyzeError`, fields unchanged |
| Malformed JSON (after retry) | Catch → toast `analyzeError`, fields unchanged |
| No fields matched / empty result | Silent no-op |

Toast format matches existing error toasts: `{ message: \`${t('generate.analyzeError')} ${err.message}\`, type: 'error' }`.

---

## Loading State

- Analyze button shows `t('generate.analyzing')` and is disabled while in flight
- Download button remains enabled during analysis

---

## Tests (Generate.test.jsx)

All tests require two mocks from `../lib/storage.js`:
- `getTemplateBinary` resolves (keeps the component in ready state)
- `getApiKey` resolves with a fake key string (unless a test specifically tests the null-key path)

Use `vi.mock('../lib/storage.js', ...)` at the top of the describe block.

1. **Happy path — matched fields**: mock `analyzeSource` resolves `{ fullName: 'Jane' }` → simulate file input `change` event → `waitFor` → assert `fullName` input value is `'Jane'`

2. **API error**: mock `analyzeSource` throws `new Error('oops')` → simulate file input `change` → `waitFor` → assert `onToast` called with `{ type: 'error', message: expect.stringContaining('oops') }`

3. **No API key**: mock `getApiKey` returns `null` → simulate Analyze button click → `waitFor` → assert `onToast` called with `{ type: 'error' }` and `analyzeSource` is never called

4. **File too large**: mock `analyzeSource` to throw `new Error('too large')` (the size check is inside `analyzeSource`) → simulate file input `change` with any File → assert `onToast` called with error. This tests the component's error-handling path; the internal size logic is unit-tested in `gemini.test.js`.

5. **Drag-drop fills fields**: simulate `drop` event on the Analyze button (with a mock `dataTransfer.files[0]`), mock `analyzeSource` resolves `{ jobTitle: 'Engineer' }` → `waitFor` → assert `jobTitle` input value is `'Engineer'`
