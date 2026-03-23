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
  {id}.bin            ← raw ArrayBuffer binary (original unmodified file)
  {id}.meta.json      ← { id, name, sourceFormat, fields, createdAt }
```

**Public API changes:**

- `saveTemplate(template)` — same signature, but now accepts `binary` as a raw `ArrayBuffer` (not base64). Writes `{id}.bin` and `{id}.meta.json`, then updates `index.json`.
- `getTemplates()` — returns `{ id, name, sourceFormat, fields, createdAt }[]` — **no binary**. Binaries are loaded lazily.
- `getTemplateBinary(id)` — **new function** — reads `{id}.bin` from OPFS, returns `Promise<ArrayBuffer>`.
- `deleteTemplate(id)` — removes `{id}.bin`, `{id}.meta.json`, and removes the ID from `index.json`. See delete sequence below.
- `getApiKey()` / `saveApiKey()` — unchanged, still use `chrome.storage.local`.

**OPFS availability check:** `storage.js` calls `navigator.storage.getDirectory()` once at module initialisation. If it throws (unavailable environment), the module re-throws with a clear message. `App.jsx` catches this during its `getApiKey()` startup sequence, sets an `opfsError` state, and renders a full-screen error message: _"This extension requires a browser with file system support. Please update Chrome."_ The app is blocked — no graceful fallback to chrome.storage (which cannot handle large binaries reliably).

**index.json write strategy:** All operations that modify `index.json` use a read-modify-write of the entire file via `FileSystemFileHandle.createWritable({ keepExistingData: false })`. This is a single-user extension with no concurrency. If the write fails, the error is surfaced as a toast and the in-memory state is not updated (leave-on-failure).

**deleteTemplate sequence:**
1. Delete `{id}.bin`
2. Delete `{id}.meta.json`
3. Read-modify-write `index.json` (remove the ID)

If step 1 or 2 fails (file already missing), continue — treat as a no-op for that file. If step 3 fails, show toast: _"Failed to remove template from index"_. Orphaned `.bin`/`.meta.json` files (ID not in index) are inert and will be ignored by `getTemplates()`.

**Migration:** On first run after the update, `storage.js` checks `chrome.storage.local` for an existing `templates` array. For each entry:
1. Decode `template.binary` from base64 to `ArrayBuffer`.
2. Write to OPFS (idempotent: skip if `{id}.bin` already exists in OPFS).
3. If the write succeeds, remove only that entry from the chrome.storage array.
4. Corrupt or decode-failing entries are skipped with a `console.warn` (not surfaced to user).

After all entries are processed, remove `templates` from `chrome.storage.local`. If OPFS writes fail mid-migration, the remaining entries stay in chrome.storage and will be retried on the next app load.

---

### Call-site Changes in `Review.jsx`

`Review.jsx` currently calls `encodeBase64(binary)` before passing to `saveTemplate`. This encoding is removed. `saveTemplate` now receives the raw `ArrayBuffer` from `scanData.binary` directly. The `encodeBase64` import and call are deleted from `Review.jsx`.

---

### Call-site Changes in `Generate.jsx`

`Generate.jsx` currently calls `decodeBase64(template.binary)` because templates came back with binary included. Under the new design:

1. `Library` passes a template metadata object (no binary) to `Generate` via `onSelect(tpl)`.
2. `Generate.jsx` calls `getTemplateBinary(template.id)` on mount to load the binary from OPFS.
3. The `decodeBase64` import and call are removed.
4. Loading state is shown while the binary is being read.

---

### Generation Fix (`src/lib/templateEngine.js`)

**`generateXlsx` — before:**
```
XLSX.read(binary) → iterate cells, replace {{token}} values → XLSX.write()
```
Strips images, drawings, themes, fonts.

**`generateXlsx` — after (PizZip surgery):**
```
PizZip(binary)
  → for each worksheet XML:
      → scan cells with t="s": look up value in sharedStrings.xml; if exact match {{fieldName}}, replace the <t> text
      → scan cells with t="inlineStr": check <is><t> text; if exact match {{fieldName}}, replace in-place
  → update sharedStrings.xml with replaced values
  → zip.generate({ type: 'blob' })
```

**Token matching:** Exact whole-cell match only — the cell value must be exactly `{{fieldName}}` (matching current behaviour in the old `generateXlsx`). Cells containing mixed text like `Hello {{name}}` are not supported and are left untouched.

Every other zip entry (`xl/drawings/`, `xl/media/`, `xl/theme/`, etc.) is untouched. Token replacement is scoped to shared string and inline string values only.

DOCX generation (`generateDocx`) is unaffected — Docxtemplater already uses PizZip internally and preserves structure correctly.

---

### Output (`src/lib/templateEngine.js` + `src/pages/Generate.jsx`)

`downloadBlob()` is replaced by `saveFile(blob, suggestedName, format)`:

```js
export async function saveFile(blob, suggestedName, format) {
  const mimeMap = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  if (window.showSaveFilePicker) {
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
  } else {
    // Fallback for environments where showSaveFilePicker is unavailable
    downloadBlob(blob, suggestedName)
  }
}
```

`suggestedName` is `${template.name}.${template.sourceFormat}` (same naming as current `downloadBlob` call in `Generate.jsx`).

`downloadBlob` is kept as a private fallback helper (not exported). If the user cancels the Save As dialog (`AbortError`), the error is caught silently — no toast, no error state.

---

## Data Flow

```
Upload
  └─ file → renderFile() → { html, binary: ArrayBuffer, format, fileName }

Review
  └─ binary modified in-memory via insertDocx / insertXlsx (PizZip, unchanged)
  └─ saveTemplate({ id, name, sourceFormat, binary: ArrayBuffer, fields, createdAt })
       → OPFS: write {id}.bin (raw ArrayBuffer) + {id}.meta.json + update index.json

Library
  └─ getTemplates() → reads index.json + all {id}.meta.json
       → returns [{ id, name, sourceFormat, fields, createdAt }]  (no binary)
  └─ onSelect(tpl) passes metadata object to Generate
  └─ deleteTemplate(id) → 3-step delete sequence (bin + meta + index)

Generate
  └─ on mount: getTemplateBinary(id) → reads {id}.bin → ArrayBuffer
  └─ generateDocx(binary, values) or generateXlsx(binary, values) → Blob
  └─ saveFile(blob, `${name}.${format}`, format) → showSaveFilePicker (or downloadBlob fallback)
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| OPFS unavailable on load | Full-screen error in `App.jsx`: "Browser file system support required" — app blocked |
| OPFS write failure (save template) | Toast: "Failed to save template" |
| OPFS read failure (load binary) | Toast: "Template file not found — please re-upload" |
| index.json write failure (delete) | Toast: "Failed to remove template from index" |
| Save As dialog cancelled | Silent no-op (`AbortError` caught, no toast) |
| `showSaveFilePicker` unavailable | Silent fallback to `downloadBlob` |
| XLSX token not found | Skip silently — cell left as-is |
| Migration: corrupt base64 entry | `console.warn`, skip entry, continue migration |

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/storage.js` | Full rewrite — OPFS reads/writes; `getTemplateBinary(id)`; one-time migration from chrome.storage |
| `src/lib/templateEngine.js` | `generateXlsx` rewritten with PizZip surgery; `downloadBlob` → `saveFile` (exported); `downloadBlob` kept as private fallback |
| `src/pages/Review.jsx` | Remove `encodeBase64` call; pass raw `ArrayBuffer` to `saveTemplate` |
| `src/pages/Generate.jsx` | Call `getTemplateBinary(id)` on mount; remove `decodeBase64`; call `saveFile` |
| `src/test/setup.js` | Add OPFS mock (in-memory Map-based implementation of `navigator.storage.getDirectory`) |
| `src/test/` | Update storage tests for OPFS; add/update tests for `generateXlsx` and `saveFile` |

No changes to `manifest.json` — OPFS and `showSaveFilePicker` require no extra MV3 permissions.

---

## Test Strategy for OPFS

jsdom does not implement the File System Access API. The test suite mocks `navigator.storage.getDirectory()` in `src/test/setup.js` with an in-memory implementation:

- A `Map<string, Uint8Array | string>` keyed by file path simulates the OPFS directory tree.
- `getFile()`, `createWritable()`, `write()`, `close()`, `getFileHandle()`, `removeEntry()` are stubbed to operate on that Map.
- The mock is reset between tests via `beforeEach`.

This pattern is consistent with the existing `chrome.storage.local` mock in `setup.js`.

---

## Out of Scope

- DOCX generation fix (already correct via Docxtemplater/PizZip)
- UI changes beyond Review, Library, and Generate pages
- Multi-directory or cloud storage
- Exporting/importing the OPFS template library
- Mixed-text token substitution (e.g. `Hello {{name}}` in a single cell)
