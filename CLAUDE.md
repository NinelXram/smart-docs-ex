# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Chicken Fill Form** — A Chrome Extension (Manifest V3) side panel that lets users upload DOCX/XLSX files, select text to define template fields (with Gemini AI naming suggestions), save templates, and generate filled document instances.

## Commands

```bash
npm run dev        # Watch mode build (outputs to dist/)
npm run build      # Production build
npm test           # Run tests once
npm run test:watch # Run tests in watch mode
```

To run a single test file:
```bash
npx vitest run src/test/App.test.jsx
```

Load the extension in Chrome: open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select the `dist/` folder.

## Architecture

### Wizard Flow (App.jsx)

Five steps managed as state in `App.jsx`:

```
Step 0: Onboarding  → API key entry (stored via storage.js)
Step 1: Upload      → Drop file → renderFile() → scanData shape
Step 2: Review      → Preview HTML, select text to define fields → fieldEditor inserts {{tokens}}
Step 3: Library     → Browse/delete saved templates
Step 4: Generate    → Fill field values → generateDocx/Xlsx() → download
```

### scanData Shape (flows from Upload → Review → Library → Generate)

```js
{
  html: string,           // Rendered HTML preview
  binary: ArrayBuffer,    // Original file binary (modified in Review)
  format: 'docx'|'xlsx',
  fileName: string,
  fields: string[]        // Field names; empty after Upload, populated in Review
}
```

### Library Layer (`src/lib/`)

| File | Responsibility |
|------|---------------|
| `renderers/index.js` | `renderFile(file)` → dispatches to docx.js or xlsx.js, returns `{ html, binary, format, fileName }` |
| `renderers/docx.js` | mammoth → HTML |
| `renderers/xlsx.js` | SheetJS → HTML table with `data-cell-address` attributes |
| `fieldEditor.js` | `insertDocx(binary, selection)` / `insertXlsx(binary, selection)` — inserts `{{fieldName}}` tokens into binary using PizZip+DOMParser (DOCX) or SheetJS (XLSX) |
| `templateEngine.js` | `generateDocx(binary, values)` / `generateXlsx(binary, values)` / `downloadBlob()` — fills tokens and triggers download |
| `gemini.js` | `testConnection()`, `suggestFieldName(text)` |
| `storage.js` | `chrome.storage.local` wrapper for API key and templates array |

### Field Definition (Review Step)

User selects text in the HTML preview → `suggestFieldName()` proposes a name → confirmed name gets inserted as `{{name}}` into the binary via `fieldEditor`. Constraints:
- DOCX: selection must be within a single paragraph
- XLSX: selection must be a single cell (matched via `data-cell-address`)
- Field name regex: `^[a-zA-Z][a-zA-Z0-9_]*$`

### Template Storage Schema

Stored in `chrome.storage.local` under key `templates`:
```js
[{ id, name, sourceFormat, binary, fields, createdAt }]
// binary is base64-encoded; fields is string[]
```

### Chrome Extension Structure

- **`background.js`**: Single-line service worker — registers side panel behavior only, no message passing
- **`sidepanel.html`**: Entry point for the React app
- **`vite.config.js`**: Custom `copyExtensionAssets()` plugin copies `manifest.json`, `background.js`, and icons to `dist/` post-build

## Testing

Tests use Vitest + React Testing Library with jsdom. `src/test/setup.js` mocks `chrome.storage.local` and `chrome.runtime.getURL` with per-test isolation.

## Key Constraints

- Gemini input capped at 750,000 characters (prevents token limit issues)
- `unlimitedStorage` permission required for large template binaries
- Extension targets Chrome MV3 with `sidePanel` permission
