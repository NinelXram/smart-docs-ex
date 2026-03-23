# Design: OPFS Storage + XLSX Generation Fidelity Fix

**Date:** 2026-03-23
**Status:** Approved

---

## Problem

Two compounding issues degrade Excel template quality:

1. **Generation strips visual assets.** `generateXlsx` in `templateEngine.js` uses a `XLSX.read()` → `XLSX.write()` round-trip. SheetJS (non-Pro) discards drawings, embedded images, charts, color themes, and custom fonts on write. The downloaded file loses its visual identity.

2. **`chrome.storage.local` is size-limited and lossy.** Templates (including large Excel binaries) are serialized as base64 JSON under a ~10 MB quota. Large files fail silently; the storage layer is not designed for binary assets.

---

## Solution Overview

**Option C — OPFS storage + Save File Picker output + PizZip surgery for XLSX generation.**

- Templates stored as real binary files in the Origin Private File System (OPFS) — no size limit, no serialization, automatic permission.
- XLSX generation rewritten to use PizZip surgery (same technique as `insertXlsx`), leaving all non-text zip entries untouched.
- Output delivered via `showSaveFilePicker` — user chooses folder and filename at generation time.
- API key remains in `chrome.storage.local` (unchanged, small).

---

## Architecture

### Storage Layer (`src/lib/storage.js`)

Templates move to OPFS under a `templates/` directory:

```
opfs://templates/
  index.json          ← string[] of template IDs
  {id}.bin            ← original unmodified ArrayBuffer binary
  {id}.meta.json      ← { id, name, sourceFormat, fields, createdAt }
```

Public API is unchanged — same function signatures (`saveTemplate`, `getTemplates`, `deleteTemplate`, `getApiKey`, `saveApiKey`) so no call-site changes are needed outside `storage.js`.

**Migration:** On first run after the update, `storage.js` checks `chrome.storage.local` for any existing `templates` array, writes each entry to OPFS, then removes `templates` from Chrome storage. Silent and automatic. API key is not touched.

### Generation Fix (`src/lib/templateEngine.js`)

**Before:**
```
XLSX.read(binary) → iterate cells, replace {{token}} values → XLSX.write()
```
Stripes images, drawings, themes, fonts.

**After:**
```
PizZip(binary)
  → parse sharedStrings.xml
  → replace <t> text nodes that match {{fieldName}} with resolved values
  → zip.generate({ type: 'blob' })
```
Every other zip entry (xl/drawings/, xl/media/, xl/theme/, etc.) is untouched. Token replacement is scoped to string values only.

DOCX generation (`generateDocx`) is unaffected — Docxtemplater already uses PizZip internally and preserves structure correctly.

### Output (`src/lib/templateEngine.js` + `src/pages/Generate.jsx`)

`downloadBlob()` is replaced by `saveFile(blob, suggestedName)`:

```js
export async function saveFile(blob, suggestedName) {
  const ext = suggestedName.split('.').pop()
  const mimeTypes = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: [{ description: 'Document', accept: { [mimeTypes[ext]]: [`.${ext}`] } }],
  })
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}
```

If the user cancels the Save As dialog, the resulting `AbortError` is caught silently (no toast, no error state).

---

## Data Flow

```
Upload
  └─ file → renderFile() → { html, binary, format, fileName }

Review
  └─ binary modified in-memory via insertDocx / insertXlsx (PizZip, unchanged)
  └─ saveTemplate({ id, name, sourceFormat, binary, fields, createdAt })
       → OPFS: write {id}.bin + {id}.meta.json + update index.json

Library
  └─ getTemplates() → reads index.json + all {id}.meta.json (binaries not loaded)
  └─ deleteTemplate(id) → removes {id}.bin + {id}.meta.json + updates index.json

Generate
  └─ template selected → binary loaded from OPFS ({id}.bin)
  └─ generateDocx(binary, values) or generateXlsx(binary, values)
       → returns Blob (PizZip surgery for XLSX)
  └─ saveFile(blob, suggestedName) → showSaveFilePicker → user saves to chosen location
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| OPFS unavailable | Toast error on app load; graceful degradation message |
| OPFS write failure | Toast: "Failed to save template" |
| Save As dialog cancelled | Silent no-op (AbortError caught, no toast) |
| Template binary missing from OPFS | Toast: "Template file not found — please re-upload" |
| XLSX token not found in sharedStrings | Skip silently (cell left as-is) |

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/storage.js` | Full rewrite — OPFS reads/writes; one-time migration from chrome.storage |
| `src/lib/templateEngine.js` | `generateXlsx` rewritten with PizZip surgery; `downloadBlob` → `saveFile` |
| `src/pages/Generate.jsx` | Call `saveFile` instead of `downloadBlob`; handle async cancellation |
| `src/test/` | Update storage mocks for OPFS; add/update tests for `generateXlsx` and `saveFile` |

No changes to `manifest.json` — OPFS and `showSaveFilePicker` require no extra MV3 permissions.

---

## Out of Scope

- DOCX generation fix (already correct via Docxtemplater/PizZip)
- UI changes beyond the Generate page button behaviour
- Multi-directory or cloud storage
- Exporting/importing the OPFS template library
