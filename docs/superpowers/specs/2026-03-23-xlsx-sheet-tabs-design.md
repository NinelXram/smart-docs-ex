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
- **Renderer:** `renderXlsx` and its return shape (`{ html, binary }`) are unchanged. The HTML string already contains all the data needed; a parser will slice it into sheets.
- **Keyboard accessibility (ARIA tablist):** Out of scope for this iteration.

---

## Architecture

### New module: `src/lib/renderers/xlsxSheetParser.js`

```js
// Returns [{ name: string, html: string }]
// `name` is the decoded (unescaped) sheet name for display and currentSheet matching.
// `html` is the table fragment for that sheet (the <h3> tag is stripped).
export function parseXlsxSheets(htmlString) { … }
```

**Parsing strategy:** Use `DOMParser` to parse the full HTML string, then walk top-level children. Each `<h3>` starts a new sheet; its `.textContent` gives the decoded sheet name. Everything up to (not including) the next `<h3>` forms that sheet's HTML fragment, serialized back to a string. This approach handles HTML-escaped sheet names correctly without regex.

**HTML-escaped sheet names:** `renderXlsx` applies `escapeHtml()` to sheet names in both `<h3>` headings and `data-cell-address` attributes. For example, sheet `Q&A` emits:
```html
<h3>Q&amp;A</h3>
<table>…<td data-cell-address="Q&amp;A!A1">…</td>…</table>
```
`parseXlsxSheets` returns `name: "Q&A"` (decoded via `.textContent`) and an `html` fragment that still contains `data-cell-address="Q&amp;A!A1"` verbatim — these are in their final HTML form and will be re-serialized into `innerHTML` unchanged.

**`data-cell-address` encoding note:** `parseCellAddr` in `Review.jsx` splits on `!` and returns the sheet portion directly from the attribute value, which is the HTML-escaped form (e.g. `Q&amp;A`). This value is used consistently within `getXlsxContext` for sibling lookups (e.g. `` `${target.sheet}!A1` `` = `"Q&amp;A!A1"`) and that round-trip is internally consistent. `currentSheet` stores the decoded name (`Q&A`) and is used only for tab display and sheet selection — it is never compared against `target.sheet` from `parseCellAddr`. No normalization is needed; the two values serve different purposes.

**Edge cases for `parseXlsxSheets`:**
- Empty string or `null` → returns `[]`
- HTML with no `<h3>` tags (malformed input) → returns `[]`
- `<h3>` with an empty table body → returns one entry with an empty table fragment

When `sheets` is empty (parser returns `[]`), Review.jsx falls back to writing `html` directly to `innerHTML`, preserving existing behavior.

### Review.jsx changes

**State:**
```js
const [currentSheet, setCurrentSheet] = useState(null)
const tabSwitchRef = useRef(false)  // true when currentSheet was set by a tab click
```

**Derived value:**
```js
const sheets = useMemo(
  () => (format === 'xlsx' ? parseXlsxSheets(html) : []),
  [html, format]
)
```
`format` is included in deps to satisfy exhaustive-deps lint rules. It is a mount-time prop that never changes during a Review session.

**Single combined `innerHTML` effect:**

One effect with deps `[html, fields, currentSheet]` replaces the existing `useEffect([html, fields])`. This avoids double `innerHTML` writes and stale-closure issues from a two-effect approach:

```js
useEffect(() => {
  if (!viewerRef.current) return

  // Resolve active sheet (handles null on first mount and removed-sheet fallback)
  const isXlsx = format === 'xlsx' && sheets.length > 0
  const active = isXlsx
    ? (sheets.find(s => s.name === currentSheet) ?? sheets[0])
    : null

  // Synchronize currentSheet state if it resolved to a different value
  if (isXlsx && active.name !== currentSheet) {
    setCurrentSheet(active.name)
    // setCurrentSheet schedules a re-render; this render's innerHTML write below
    // is still correct because we use `active.html` not `currentSheet`
  }

  // Scroll: preserve position on re-render (field insertion, chip update);
  // reset to 0 on explicit tab switch
  const scrollTop = tabSwitchRef.current ? 0 : viewerRef.current.scrollTop
  tabSwitchRef.current = false

  viewerRef.current.innerHTML = isXlsx ? active.html : html
  applyChipOverlay(viewerRef.current, fields)
  viewerRef.current.scrollTop = scrollTop
}, [html, fields, currentSheet])
```

**Tab click handler:**
```js
const handleTabClick = (name) => {
  tabSwitchRef.current = true   // mark as tab switch before state update
  setCurrentSheet(name)
}
```

`tabSwitchRef.current` is set synchronously before `setCurrentSheet`, so when the effect fires on the next render, it sees `true` and resets scroll.

**Blank-on-mount clarification:** On first mount, `currentSheet` is `null`. The effect fires, resolves `active` to `sheets[0]`, writes `active.html` to `innerHTML` (correct), and calls `setCurrentSheet(sheets[0].name)` (schedules a second render). The viewer is populated correctly from the first render — it is never blank. The second render fires the effect again, but this time `sheets.find(s => s.name === currentSheet)` succeeds (no fallback needed), and `tabSwitchRef.current` is `false`, so scroll is preserved (0 on a fresh mount).

**Tab bar:** Rendered between the hint bar and the doc viewer, only when `format === 'xlsx'` and `sheets.length > 1` (single-sheet workbooks skip the tab bar). Uses `overflow-x: auto` with `whitespace-nowrap` for workbooks with many sheets. Active tab: blue top border (`border-t-2 border-blue-500`) + white text; inactive tabs: muted gray.

**Single-sheet workbooks:** `sheets.length === 1` — no tab bar rendered. The viewer receives the table fragment (no `<h3>`). The existing `[&_h3]` Tailwind styles on the viewer become a no-op.

**Multi-sheet workbooks:** Each fragment also excludes its `<h3>` — the sheet name is shown in the tab instead.

---

## Component Structure

```
Review.jsx
├── Header bar                          (unchanged)
├── Save error                          (unchanged)
├── Hint bar (xlsx only)                (unchanged)
├── [NEW] Sheet tab bar (xlsx, >1 sheet only)
│   └── Tab per sheet, overflow-x:auto
└── Document viewer (relative wrapper)
    ├── viewerRef div                   (active sheet html fragment only)
    ├── Spinner overlay                 (unchanged)
    └── Suggestion popover              (unchanged)
```

---

## Data Flow

```
initialHtml (prop)
  → html (state)
    → parseXlsxSheets(html) → sheets[] (memo, [html, format] deps)
      → currentSheet (state, decoded sheet name, null on mount)
        → single useEffect([html, fields, currentSheet])
          → tabSwitchRef.current controls scroll reset vs. preserve
          → viewerRef.current.innerHTML = active sheet html fragment
          → applyChipOverlay(viewerRef.current, fields)
```

---

## Edge Cases

| Case | Behaviour |
|------|-----------|
| Single-sheet workbook | Tab bar hidden; table fragment injected directly; no `<h3>` in DOM |
| Sheet name with `&`, `<`, `"` | `parseXlsxSheets` decodes via `.textContent`; fragment passed through verbatim; `data-cell-address` attrs remain HTML-escaped and are consistent within `parseCellAddr` lookups |
| Active sheet removed after re-render | Falls back to `sheets[0]` in combined effect |
| Tab switch | `tabSwitchRef` → scroll resets to 0 |
| Re-render from field insertion | `tabSwitchRef` is false → scroll position preserved |
| First mount (`currentSheet === null`) | `active` resolves to `sheets[0]`; viewer populated on first render; second render syncs `currentSheet` |
| `parseXlsxSheets` gets no `<h3>` tags | Returns `[]`; effect falls back to raw `html` |
| DOCX file | `sheets` is `[]`; no tab bar; `innerHTML` set to full `html` as before |

---

## Testing

- **`parseXlsxSheets` (unit, `src/test/xlsxSheetParser.test.js`):**
  - Single sheet: one entry, `html` is table only (no `<h3>`)
  - Multiple sheets: correct count, names, html fragments
  - Empty string: returns `[]`
  - No `<h3>` tags present: returns `[]`
  - `<h3>` with empty table body: one entry with empty table fragment
  - Sheet name `Q&A` (HTML-escaped in source): decoded `name` is `"Q&A"`; fragment still contains `data-cell-address="Q&amp;A!A1"`

- **Review.jsx (xlsx, `src/test/Review.test.jsx` or xlsx-specific file):**
  - Tab bar renders for >1 sheet workbook
  - Tab bar hidden for single-sheet workbook
  - Viewer shows first sheet on mount (never blank)
  - Clicking a tab shows correct sheet content
  - Clicking a tab resets scroll to top
  - Re-render after field insertion preserves active tab and scroll position
  - Chip overlay applies to active sheet content after tab switch
  - Sheet with special characters in name displays correctly in tab

- **Review.jsx (docx):**
  - No tab bar rendered; existing test behavior unchanged

---

## Implementation Notes

- **Remove `[&_h3]` Tailwind selectors** from the viewer `className` in `Review.jsx` — once `parseXlsxSheets` strips `<h3>` tags from all fragments, those selectors will never match and become misleading dead code.
- **`active` is `null` when `isXlsx` is false** — the effect pseudocode guards against this with the `isXlsx` conditional; do not move the `sheets.find(…) ?? sheets[0]` expression above that guard.
- **Fragment serialization** — when collecting child nodes between `<h3>` elements, append to a `<div>` wrapper and read `.innerHTML` to serialize back to a string. Do not use `XMLSerializer` (produces XHTML self-closing tags that can confuse `innerHTML` assignment).
- **`DOMParser` in tests** — jsdom provides `DOMParser` globally; no polyfill needed in `xlsxSheetParser.js`.

---

## Out of Scope

- DOCX pagination
- Sheet reordering or renaming in the UI
- Remembering last-active sheet across sessions
- ARIA tablist/tab/tabpanel keyboard semantics
