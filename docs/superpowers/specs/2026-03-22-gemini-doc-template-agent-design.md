# Gemini Doc-Template Agent — Design Spec

**Date:** 2026-03-22
**Status:** Approved

---

## Overview

A Chrome Extension (MV3) that uses the Google Gemini API to parse documents (PDF, DOCX, XLSX), identify dynamic variables via AI, and transform them into reusable interactive templates. Designed for individual professionals (lawyers, sales reps, HR managers) who generate documents repeatedly with changing fields.

---

## Architecture

### Approach: All-in-One Side Panel

All logic runs inside the Chrome Side Panel React app — no message passing, no offscreen documents. The service worker is minimal (registers the side panel, handles icon click only).

**Why:** This is a single-user, user-triggered tool with no background tasks. The side panel is a stable, persistent context with full DOM access. Adding a service worker for Gemini calls introduces MV3 termination risks and message-passing complexity with no benefit.

### Extension Contexts

| Context | Responsibility |
|---|---|
| `sidepanel/` | Full React app: file parsing, Gemini calls, template storage, form generation |
| `background.js` | Service worker: registers side panel, handles icon click |
| `manifest.json` | Declares `side_panel`, `storage`, `unlimitedStorage`, host permissions for Gemini API |

### Tech Stack

| Concern | Library / Tool |
|---|---|
| Framework | React 18 + Vite |
| Styling | Tailwind CSS |
| AI | `@google/generative-ai` (Gemini 1.5 Flash) |
| PDF parsing | `pdfjs-dist` |
| DOCX parsing | `mammoth` |
| XLSX parsing | `xlsx` |
| PDF output | `jspdf` |
| DOCX output | `docx` (npm package) |
| XLSX output | `xlsx` (write mode, same library as parsing) |
| Storage | `chrome.storage.local` (`unlimitedStorage` permission) |

### Folder Structure

```
src/
  components/           # Shared React UI components
  lib/
    parsers/
      pdf.js            # pdfjs-dist wrapper → extracts text + page positions
      docx.js           # mammoth wrapper → extracts text + paragraph structure
      xlsx.js           # xlsx wrapper → extracts text + sheet/row structure
    gemini.js           # Gemini API client (key management, prompt builder, response parser)
    storage.js          # chrome.storage.local wrapper (templates + API key)
    templateEngine.js   # Variable injection + output file generation
  pages/
    Onboarding.jsx      # Step 0: API key entry and validation
    Upload.jsx          # Step 1: file upload and AI scan
    Review.jsx          # Step 2: variable review and refinement
    Library.jsx         # Step 3: saved template library
    Generate.jsx        # Step 4: fill form and download
  App.jsx               # Wizard router (step state machine)
  main.jsx              # React entry point
background.js           # Minimal MV3 service worker
manifest.json
```

---

## Data Flow

### Onboarding (Step 0)

1. User enters Gemini API key
2. Extension stores key in `chrome.storage.local`
3. "Test Connection" calls `gemini-1.5-flash` with a minimal prompt
4. Success → proceed to main UI; Failure → inline error with guidance

### Upload & Scan (Step 1)

1. User drops or selects a file (PDF, DOCX, or XLSX)
2. Appropriate parser extracts raw text and structural metadata
3. Pre-flight check: if extracted text exceeds 750,000 characters (~1M tokens), reject with a "Document too large" error before calling the API. User must use a smaller or trimmed document.
4. Extracted content is sent to Gemini 1.5 Flash with a structured prompt:

   > *"Analyze this document. Identify all variable fields likely to change across iterations (e.g., names, IDs, dates, amounts). Return a JSON array where each item has: `name` (a short camelCase label) and `marker` (a short phrase of 5–10 words from the document that contains the variable's value, with that value replaced by the literal token `[VALUE]`). The `[VALUE]` token must appear exactly once in each marker string. Example: `"agreement is made with [VALUE] hereinafter"`."*

5. Gemini returns:
   ```json
   [
     { "name": "ClientName", "marker": "agreement is made with [VALUE] hereinafter" },
     { "name": "EffectiveDate", "marker": "effective as of [VALUE] between" },
     { "name": "ContractValue", "marker": "total amount of [VALUE] USD" }
   ]
   ```

   **Injection contract:** At generate time, `templateEngine.js` searches `rawContent` for each marker string (with `[VALUE]` as a literal). If the marker appears more than once (duplicate boilerplate), the first occurrence is replaced and the user is warned. If the marker contains no `[VALUE]` token (malformed response), that variable is skipped and flagged.
6. UI renders document preview with detected fields highlighted as colored chips

### Review & Refine (Step 2)

1. User sees the document text with variable chips overlaid at each marker position
2. User actions:
   - **Rename:** click chip → edit label inline
   - **Remove:** click × on chip → removes variable
   - **Add:** highlight text in preview → "Add Variable" button → enter label. Implementation: the preview renders `rawContent` as plain text in a `<div>`. `window.getSelection()` captures the selected text. The extension locates the selection in `rawContent` using `indexOf` and builds a marker by taking up to 5 surrounding words on each side, replacing the selected text with `[VALUE]`. If the selected text appears more than once in `rawContent`, the marker may point to an unintended occurrence; the user is warned at generate time via the standard duplicate-marker warning.
3. User names the template (e.g., "Standard Sales Contract")
4. User clicks "Save Template"

### Template Storage (Step 3)

Template saved to `chrome.storage.local` (requires `unlimitedStorage` manifest permission — legal contracts can exceed the default 5 MB quota):

```json
{
  "id": "uuid-v4",
  "name": "Standard Sales Contract",
  "sourceFormat": "docx",
  "rawContent": "...full extracted text...",
  "variables": [
    { "name": "ClientName", "marker": "agreement is made with [VALUE] hereinafter" }
  ],
  "createdAt": 1774148866
}
```

Library view lists all saved templates with name, format badge, variable count, and created date.

### Generate (Step 4)

1. User selects a saved template from the library
2. Extension renders a dynamic form: one labeled input per variable
3. User fills all fields
4. User selects output format: **PDF**, **DOCX**, or **XLSX**
5. `templateEngine.js` injects values at each marker position in the raw content (replaces `marker` with marker string where `[VALUE]` is substituted with the user's input)
6. Output file is serialized and downloaded:
   - **DOCX:** `docx` npm package rebuilds the document as a `.docx` file from the injected text
   - **XLSX:** `xlsx` (write mode) rebuilds the spreadsheet from the injected content
   - **PDF:** `jspdf` renders the injected plain text into a `.pdf` file. Structural metadata from the parser (paragraph breaks, line breaks) is preserved in the output where possible; visual fidelity beyond that is explicitly out of scope (see Constraints)

---

## UI Layout

**Wizard layout** with a 4-segment progress bar at the top of the side panel covering Steps 1–4 (Upload, Review, Library, Generate). Onboarding (API key setup) is a pre-wizard gate shown only on first launch; it is not part of the progress bar. Each wizard step occupies the full panel below. Users cannot skip steps (scan must complete before review, review must save before generate).

**Side panel width:** ~400px (standard Chrome side panel)

**Navigation:** "Next →" / "← Back" buttons at the bottom of each step. Library is accessible from Step 3 and as a shortcut from the header.

---

## Error Handling

### API Key Errors
- Invalid key → inline error on onboarding ("Invalid API key — check your Gemini console")
- Quota exceeded mid-session → toast notification with link to Gemini console

### File Parsing Errors
- Unsupported format → rejected at drop, before any processing
- Corrupted file → error state on Upload step, prompt to try another file
- Extracted text exceeds 750,000 characters → hard stop before API call with "Document too large" message; user must provide a smaller file

### Gemini Response Errors
- Malformed JSON → retry once with stricter prompt; on second failure, send user to manual variable entry mode
- Zero variables returned → notify user, enter manual "Add Variable" mode immediately

### Storage Errors
- `chrome.storage.local` quota exceeded → prompt user to delete old templates before saving

### Generate / Download Errors
- Marker not found in document → highlight the problematic variable in the form, skip it in output, warn user with specific field name
- Marker found but contains no `[VALUE]` token (malformed Gemini response) → same treatment as above
- Marker appears more than once → replace first occurrence, warn user that duplicate markers exist

---

## Testing Strategy

### Unit Tests (Vitest)
- **Parsers:** given fixture files (PDF, DOCX, XLSX), assert correct text extraction output
- **`gemini.js`:** mock API responses, assert prompt structure and JSON parsing logic
- **`templateEngine.js`:** given raw content + variable values, assert correct injection and output file validity

### Integration Tests
- Full scan → review → save → generate flow for one fixture file per format
- Edge cases: zero-variable document, 20+ variable document, missing marker on generate

### Manual QA Checklist (no automated extension E2E)
- Onboarding: valid key, invalid key, quota-exceeded key
- Upload: PDF, DOCX, XLSX; oversized file; corrupted file
- Review: rename variable, remove variable, add variable manually
- Generate: all three output formats; missing variable warning behavior

---

## Constraints & Decisions

| Decision | Rationale |
|---|---|
| All-in-one side panel (no SW for logic) | MV3 service worker termination risk; no background tasks needed |
| `chrome.storage.local` + `unlimitedStorage` | Single-user, local-first; default 5 MB quota is too small for contract text |
| API key stored in `chrome.storage.local` | Acceptable for a single-user local extension; key obfuscation is out of scope. The key is only accessible to extension JS, not web pages. |
| Gemini 1.5 Flash only (no model selection) | Flash and Pro share the same 1M token context window; model switching adds UI complexity with no functional benefit for this use case |
| 750K character pre-flight limit | Conservative threshold (~1M tokens) to avoid a paid failed API call |
| Output via `jspdf` / `docx` / `xlsx` write mode | Each handles its target format client-side; no server required |
| Marker injection uses first occurrence for duplicates | Deterministic behavior; user is warned rather than silently producing wrong output |
| No pixel-perfect document rendering | Good-enough plain-text preview with highlights is sufficient; avoids PDF/DOCX rendering complexity |
| User-selectable output format | Source format is not necessarily the target format |
| Wizard UI (not tabs) | Enforces correct ordering (scan → review → save → generate) |
| No automated extension E2E | Chrome Extension UI testing is complex/fragile; unit + integration + manual checklist covers adequately |
