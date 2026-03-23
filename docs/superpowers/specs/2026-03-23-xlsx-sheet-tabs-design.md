# XLSX Sheet Tabs — Design Spec

**Date:** 2026-03-23
**Scope:** Review step (Step 2) — XLSX workbooks only
**Goal:** Replace the single-scroll view for XLSX files with a tabbed interface, one tab per sheet, so users can navigate large workbooks without losing context during field mapping.

---

## Problem

`renderXlsx` concatenates all sheets into one HTML string (`<h3>SheetName</h3><table>…</table>` repeated). The Review panel dumps this entire string into a single scrollable `div`, which becomes unmanageable for workbooks with many sheets.

---

## Decisions

- **DOCX:** No change. `docx-preview` renders all pages as one unsegmented block; pagination is out of scope.
- **XLSX:** Tabbed navigation — one tab per sheet, tabs positioned above the viewer (classic spreadsheet style).
- **Renderer:** `renderXlsx` and its return shape (`{ html, binary }`) are unchanged. The HTML string already contains all the data needed; a parser in Review.jsx will slice it into sheets.

---

## Architecture

### New helper: `parseXlsxSheets(html)`

A pure function added to `Review.jsx` (or a small inline utility):

```js
// Returns [{ name: string, html: string }]
function parseXlsxSheets(html) { … }
```

**Logic:** Parse the concatenated HTML string by `<h3>` tags. Each `<h3>` marks the start of a new sheet; its text content is the sheet name; everything until the next `<h3>` (or end of string) is that sheet's HTML fragment.

### Review.jsx changes

1. **New state:** `const [currentSheet, setCurrentSheet] = useState(null)` — holds the active sheet name (string). Initialized to the first sheet name when format is `xlsx`.

2. **Derived value:** `const sheets = useMemo(() => format === 'xlsx' ? parseXlsxSheets(html) : [], [html, format])`

3. **`currentSheet` initialization:** `useEffect` that sets `currentSheet` to `sheets[0].name` when `sheets` changes and current sheet is no longer in the list (handles re-render after field insertion).

4. **`innerHTML` effect** (existing): condition changes — instead of writing `html` directly, write only the active sheet's fragment:
   - DOCX: `viewerRef.current.innerHTML = html` (unchanged)
   - XLSX: `viewerRef.current.innerHTML = sheets.find(s => s.name === currentSheet)?.html ?? ''`

5. **Tab bar:** Rendered between the hint bar and the doc viewer, only when `format === 'xlsx'` and `sheets.length > 1`. Horizontally scrollable (`overflow-x: auto`) for workbooks with many sheets. Active tab indicated by blue top border + white text; inactive tabs are muted.

### After field insertion

`insertXlsx` → `renderXlsx(newBinary)` → new `html` string → `setHtml(newHtml)` → `sheets` recomputed → effect re-runs with same `currentSheet` name → user stays on the same sheet.

---

## Component Structure

```
Review.jsx
├── Header bar                          (unchanged)
├── Save error                          (unchanged)
├── Hint bar (xlsx only)                (unchanged)
├── [NEW] Sheet tab bar (xlsx only)     ← new, above viewer
│   └── Tab per sheet, overflow-x:auto
└── Document viewer (relative wrapper)
    ├── viewerRef div                   (renders active sheet html only)
    ├── Spinner overlay                 (unchanged)
    └── Suggestion popover              (unchanged)
```

---

## Data Flow

```
initialHtml (prop)
  → html (state)
    → parseXlsxSheets(html) → sheets[]
      → currentSheet (state, tracks active sheet name)
        → viewerRef.current.innerHTML = activeSheet.html
          → applyChipOverlay(viewerRef.current, fields)
```

---

## Edge Cases

| Case | Behaviour |
|------|-----------|
| Single-sheet workbook | Tab bar hidden (no value in showing one tab) |
| Sheet name contains special chars | `parseXlsxSheets` reads from DOM text content, not raw HTML — safe |
| Active sheet removed after re-render | `currentSheet` falls back to first sheet |
| DOCX file | No `sheets` computed, no tab bar rendered, `innerHTML` set to full `html` as before |

---

## Testing

- **`parseXlsxSheets`** — unit tests: single sheet, multiple sheets, empty html
- **Review.jsx (xlsx)** — tab bar renders; clicking a tab updates viewer content; chip overlay applies to active sheet; field insertion preserves active tab
- **Review.jsx (docx)** — no tab bar rendered; existing tests unaffected

---

## Out of Scope

- DOCX pagination
- Sheet reordering or renaming in the UI
- Remembering last-active sheet across sessions
