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

- **Click** Analyze → opens native file picker
- **Drag-and-drop** onto the Analyze button → triggers the same handler
- Implemented via a hidden `<input type="file">` + `onDragOver`/`onDrop` on the button element

---

## Data Flow

```
User clicks Analyze / drops file
  ↓
hidden <input type="file"> triggers
  ↓
analyzeSource(apiKey, file, fields, lang)
  ├─ image/* or .pdf  → FileReader.readAsArrayBuffer() → base64
  │                   → Gemini inlineData (multimodal) + field-extraction prompt
  ├─ .docx            → mammoth.extractRawText() → string
  │                   → Gemini text prompt
  └─ .txt             → FileReader.readAsText() → string
                      → Gemini text prompt
  ↓
Gemini returns JSON: { "fieldName": "value", ... }
  ↓
Filter to only known template fields (guard against hallucinated keys)
  ↓
setValues(prev => ({ ...prev, ...matched }))
```

Gemini prompt:
> "These are the template field names: [name, jobTitle, date]. Extract matching values from the document. Return JSON only: `{"fieldName": "value"}`. Only include fields you are confident about."

---

## Partial Match Behavior

- Fields Gemini matched: auto-populated
- Fields Gemini did not match: left empty, user fills manually
- No feedback message — silent fill

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gemini.js` | Add `analyzeSource(apiKey, file, fields, lang)` |
| `src/pages/Generate.jsx` | Add Analyze button, hidden file input, drag-drop handlers, `analyzing` state |
| `src/locales/en.json` | Add `generate.analyze`, `generate.analyzing`, `generate.analyzeError` |
| `src/locales/vi.json` | Same keys in Vietnamese |

---

## analyzeSource() Signature

```js
/**
 * Upload a file to Gemini and extract values for known template fields.
 * @param {string} apiKey
 * @param {File} file
 * @param {string[]} fields - known template field names
 * @param {string} [lang]
 * @returns {Promise<Record<string, string>>} - matched field values only
 */
export async function analyzeSource(apiKey, file, fields, lang = 'vi')
```

**Binary path** (image/*, .pdf): reads as ArrayBuffer → base64 → Gemini `inlineData` multimodal call.

**Text path** (.docx, .txt): extracts raw text → Gemini text-only call. DOCX uses `mammoth.extractRawText()`.

File size limit: **4 MB** for binary path. Throws if exceeded (caller shows toast).

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| File > 4 MB | Throw before API call → `analyzeError` toast |
| No API key | Throw early → `analyzeError` toast |
| Gemini API error | Catch → `analyzeError` toast, fields unchanged |
| Malformed JSON response | Catch → `analyzeError` toast, fields unchanged |
| No fields matched | Silent no-op, fields stay empty |

---

## Loading State

- Analyze button shows `t('generate.analyzing')` and is disabled while in flight
- Download button remains enabled during analysis

---

## Tests (Generate.test.jsx)

1. Mock `analyzeSource` returns `{ fullName: 'Jane' }` → assert input updates to "Jane"
2. Mock `analyzeSource` throws → assert `onToast` called with error
3. File drag-drop triggers same handler as click (same code path)
