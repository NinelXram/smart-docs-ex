# XLSX Sheet Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tabbed sheet navigator to the XLSX Review panel so users can switch between sheets instead of scrolling one long page.

**Architecture:** A new `parseXlsxSheets(html)` module parses the concatenated HTML string (produced by the existing `renderXlsx`) into per-sheet fragments using `DOMParser`. `Review.jsx` adds `currentSheet` state and a `tabSwitchRef`, replaces the single `useEffect([html, fields])` with one that also depends on `currentSheet`, and renders a tab bar above the viewer when there are multiple sheets.

**Tech Stack:** React 18, Vitest + React Testing Library, Tailwind CSS, jsdom (test environment)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `src/lib/renderers/xlsxSheetParser.js` | Pure `parseXlsxSheets(html)` function |
| **Create** | `src/test/xlsxSheetParser.test.js` | Unit tests for parser |
| **Modify** | `src/pages/Review.jsx` | Tab state, updated effect, tab bar UI, remove dead `[&_h3]` styles |
| **Modify** | `src/test/Review.xlsx.test.jsx` | New tab behavior tests (existing tests unchanged) |

---

## Task 1: `parseXlsxSheets` — TDD

**Files:**
- Create: `src/lib/renderers/xlsxSheetParser.js`
- Create: `src/test/xlsxSheetParser.test.js`

### How `renderXlsx` formats its output (read before writing tests)

`renderXlsx` in `src/lib/renderers/xlsx.js` produces HTML like this — one `<h3>` per sheet followed by its `<table>`:

```html
<h3>Sheet1</h3><table><tr><td data-cell-address="Sheet1!A1">Revenue</td></tr></table><h3>Q&amp;A</h3><table><tr><td data-cell-address="Q&amp;A!A1">val</td></tr></table>
```

Note: sheet names and `data-cell-address` values are both HTML-escaped by `escapeHtml()` in `xlsx.js`. A sheet named `Q&A` appears as `<h3>Q&amp;A</h3>` and its cell addresses are `data-cell-address="Q&amp;A!A1"`.

`parseXlsxSheets` must:
- Return decoded sheet names (`.textContent` on the `<h3>`) — so `Q&A`, not `Q&amp;A`
- Pass the table fragments through verbatim (so `data-cell-address="Q&amp;A!A1"` stays escaped)
- Return `[]` for empty/null input or input with no `<h3>` tags

### Step 1: Write the failing tests

- [ ] Create `src/test/xlsxSheetParser.test.js`:

```js
import { parseXlsxSheets } from '../lib/renderers/xlsxSheetParser.js'

describe('parseXlsxSheets', () => {
  it('returns [] for empty string', () => {
    expect(parseXlsxSheets('')).toEqual([])
  })

  it('returns [] for null', () => {
    expect(parseXlsxSheets(null)).toEqual([])
  })

  it('returns [] when no <h3> tags present', () => {
    expect(parseXlsxSheets('<table><tr><td>foo</td></tr></table>')).toEqual([])
  })

  it('parses a single sheet — strips <h3>, keeps table', () => {
    const html = '<h3>Sheet1</h3><table><tr><td>foo</td></tr></table>'
    const result = parseXlsxSheets(html)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Sheet1')
    expect(result[0].html).toContain('<table>')
    expect(result[0].html).not.toContain('<h3>')
  })

  it('parses multiple sheets into correct entries', () => {
    const html =
      '<h3>Sheet1</h3><table><tr><td>A</td></tr></table>' +
      '<h3>Sheet2</h3><table><tr><td>B</td></tr></table>'
    const result = parseXlsxSheets(html)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Sheet1')
    expect(result[0].html).toContain('A')
    expect(result[1].name).toBe('Sheet2')
    expect(result[1].html).toContain('B')
    // Each fragment must not contain the other sheet's content
    expect(result[0].html).not.toContain('B')
    expect(result[1].html).not.toContain('A')
  })

  it('decodes HTML-escaped sheet name but preserves escaped data-cell-address', () => {
    const html =
      '<h3>Q&amp;A</h3>' +
      '<table><tr><td data-cell-address="Q&amp;A!A1">val</td></tr></table>'
    const result = parseXlsxSheets(html)
    expect(result[0].name).toBe('Q&A')                          // decoded
    expect(result[0].html).toContain('data-cell-address="Q&amp;A!A1"')  // verbatim
  })

  it('returns entry with empty html for <h3> with no following elements', () => {
    const html = '<h3>Empty</h3>'
    const result = parseXlsxSheets(html)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Empty')
    expect(result[0].html).toBe('')
  })
})
```

- [ ] Run the tests to confirm they all fail (module not found):

```bash
npx vitest run src/test/xlsxSheetParser.test.js
```

Expected: 6 failures with `Cannot find module '../lib/renderers/xlsxSheetParser.js'`

### Step 2: Implement `parseXlsxSheets`

- [ ] Create `src/lib/renderers/xlsxSheetParser.js`:

```js
/**
 * Split the concatenated HTML output of renderXlsx into per-sheet entries.
 *
 * renderXlsx emits: <h3>SheetName</h3><table>…</table> repeated for each sheet.
 * Sheet names and data-cell-address values are HTML-escaped in the source.
 * This function decodes sheet names via DOMParser / .textContent, but passes
 * table fragments through verbatim so data-cell-address attributes stay escaped.
 *
 * @param {string|null} htmlString
 * @returns {{ name: string, html: string }[]}
 */
export function parseXlsxSheets(htmlString) {
  if (!htmlString) return []

  const doc = new DOMParser().parseFromString(htmlString, 'text/html')
  const children = Array.from(doc.body.children)

  if (!children.some(c => c.tagName === 'H3')) return []

  const sheets = []
  let currentName = null
  let currentParts = []

  for (const child of children) {
    if (child.tagName === 'H3') {
      if (currentName !== null) {
        sheets.push({ name: currentName, html: currentParts.join('') })
      }
      currentName = child.textContent   // .textContent decodes &amp; → &
      currentParts = []
    } else if (currentName !== null) {
      currentParts.push(child.outerHTML) // outerHTML preserves escaped attrs verbatim
    }
  }

  if (currentName !== null) {
    sheets.push({ name: currentName, html: currentParts.join('') })
  }

  return sheets
}
```

- [ ] Run the tests — all should pass:

```bash
npx vitest run src/test/xlsxSheetParser.test.js
```

Expected: 6 passing

- [ ] Commit:

```bash
git add src/lib/renderers/xlsxSheetParser.js src/test/xlsxSheetParser.test.js
git commit -m "feat: add parseXlsxSheets to split renderXlsx HTML into per-sheet fragments"
```

---

## Task 2: Wire Parser Into Review.jsx

**Files:**
- Modify: `src/pages/Review.jsx`

This task updates the state and effect logic. No UI visible yet — the tab bar comes in Task 3. Existing tests must keep passing throughout.

### Step 1: Add the import and new state/memo

- [ ] At the top of `Review.jsx`, add the import after the existing renderer imports:

```js
import { parseXlsxSheets } from '../lib/renderers/xlsxSheetParser.js'
```

- [ ] Inside the `Review` component, after the existing state declarations (around line 103–111), add:

```js
const [currentSheet, setCurrentSheet] = useState(null)
const tabSwitchRef = useRef(false)
```

- [ ] Add the memo immediately after (before the existing `useEffect`):

```js
const sheets = useMemo(
  () => (format === 'xlsx' ? parseXlsxSheets(html) : []),
  [html, format]
)
```

Also add `useMemo` to the React import at line 1:

```js
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
```

### Step 2: Replace the `innerHTML` effect

- [ ] Find and replace the existing effect (lines 114–120):

**Remove:**
```js
// Apply html to DOM and run chip overlay after every html/fields update
useEffect(() => {
  if (!viewerRef.current) return
  const scrollTop = viewerRef.current.scrollTop
  viewerRef.current.innerHTML = html
  applyChipOverlay(viewerRef.current, fields)
  viewerRef.current.scrollTop = scrollTop
}, [html, fields])
```

**Replace with:**
```js
// Apply active sheet (or full html for DOCX) to DOM after html, fields, or tab change.
// tabSwitchRef distinguishes explicit tab switches (scroll → 0) from re-renders (preserve scroll).
useEffect(() => {
  if (!viewerRef.current) return

  const isXlsx = format === 'xlsx' && sheets.length > 0
  const active = isXlsx
    ? (sheets.find(s => s.name === currentSheet) ?? sheets[0])
    : null

  // Sync currentSheet on first mount (null) or if active sheet changed
  if (isXlsx && active.name !== currentSheet) {
    setCurrentSheet(active.name)
    // Note: setCurrentSheet schedules a re-render but active.html is already correct here
  }

  const scrollTop = tabSwitchRef.current ? 0 : viewerRef.current.scrollTop
  tabSwitchRef.current = false

  viewerRef.current.innerHTML = isXlsx ? active.html : html
  applyChipOverlay(viewerRef.current, fields)
  viewerRef.current.scrollTop = scrollTop
}, [html, fields, currentSheet])
```

### Step 3: Remove dead `[&_h3]` Tailwind selectors

- [ ] Find the `data-testid="doc-viewer"` div (around line 319). Its `className` currently includes these selectors for `<h3>` tags. Since `parseXlsxSheets` strips `<h3>` from all fragments, these selectors will never match — remove them.

**Find in className string:**
```
[&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-gray-400 [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:mt-3 [&_h3]:mb-1
```
(note the trailing space before `[&_td]`)

**Remove those 7 selectors**, leaving the rest of the className intact. The result should look like:

```
[&_table]:border-collapse [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:border-gray-600 [&_td]:px-2 [&_td]:py-1.5 [&_td[data-cell-address]]:cursor-pointer [&_td[data-cell-address]:hover]:bg-blue-900/25 [&_td[data-cell-address]:hover]:transition-colors
```

### Step 4: Verify existing tests still pass

- [ ] Run the full test suite:

```bash
npx vitest run
```

Expected: all previously passing tests still pass. The existing `Review.xlsx.test.jsx` tests use HTML without `<h3>` tags, so `sheets` will be `[]` and the effect falls back to writing `html` directly — same as before.

- [ ] Commit:

```bash
git add src/pages/Review.jsx
git commit -m "feat: wire parseXlsxSheets into Review — currentSheet state, combined innerHTML effect"
```

---

## Task 3: Add Tab Bar UI to Review.jsx

**Files:**
- Modify: `src/pages/Review.jsx`

### Step 1: Add the `handleTabClick` callback

- [ ] Add this callback inside `Review`, after the existing callbacks (e.g., after `handleClick`):

```js
const handleTabClick = useCallback((name) => {
  tabSwitchRef.current = true  // mark as tab switch so effect resets scroll
  setCurrentSheet(name)
}, [])
```

### Step 2: Insert the tab bar JSX

- [ ] In the `return` block, find the hint bar section (the `{format === 'xlsx' && (…)}` block around line 307). Insert the tab bar **after** the hint bar and **before** the `{/* Document viewer */}` div:

```jsx
{/* Sheet tab bar — only for xlsx workbooks with more than one sheet */}
{format === 'xlsx' && sheets.length > 1 && (
  <div className="flex overflow-x-auto whitespace-nowrap border-b border-gray-700 shrink-0 bg-gray-900">
    {sheets.map(sheet => (
      <button
        key={sheet.name}
        onClick={() => handleTabClick(sheet.name)}
        className={`px-4 py-2 text-xs border-t-2 transition-colors ${
          sheet.name === currentSheet
            ? 'border-blue-500 text-white bg-gray-800'
            : 'border-transparent text-gray-500 hover:text-gray-300'
        }`}
      >
        {sheet.name}
      </button>
    ))}
  </div>
)}
```

### Step 3: Verify the app builds and existing tests pass

- [ ] Run tests:

```bash
npx vitest run
```

Expected: all passing.

- [ ] Commit:

```bash
git add src/pages/Review.jsx
git commit -m "feat: add XLSX sheet tab bar to Review panel"
```

---

## Task 4: Tab Behavior Tests

**Files:**
- Modify: `src/test/Review.xlsx.test.jsx`

### Step 1: Write the failing tab tests

- [ ] Add the following to `src/test/Review.xlsx.test.jsx`, after the existing imports and helpers but before the existing `describe` block:

```js
// Multi-sheet helpers
const MULTI_SHEET_HTML =
  '<h3>Sheet1</h3><table><tr><td data-cell-address="Sheet1!A1">Revenue</td></tr></table>' +
  '<h3>Sheet2</h3><table><tr><td data-cell-address="Sheet2!A1">Expenses</td></tr></table>'

function makeBinaryMulti() {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Revenue']]), 'Sheet1')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Expenses']]), 'Sheet2')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return buf instanceof ArrayBuffer ? buf : buf.buffer
}

function multiSheetProps(overrides = {}) {
  return {
    html: MULTI_SHEET_HTML,
    binary: makeBinaryMulti(),
    format: 'xlsx',
    fileName: 'multi.xlsx',
    fields: [],
    apiKey: 'test-key',
    onSave: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  }
}
```

- [ ] Add a new `describe` block after the existing one:

```js
describe('Review XLSX — sheet tabs', () => {
  it('renders a tab for each sheet when workbook has multiple sheets', () => {
    render(<Review {...multiSheetProps()} />)
    expect(screen.getByRole('button', { name: 'Sheet1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sheet2' })).toBeInTheDocument()
  })

  it('shows first sheet content on initial render', () => {
    render(<Review {...multiSheetProps()} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    expect(viewer.innerHTML).toContain('Revenue')
    expect(viewer.innerHTML).not.toContain('Expenses')
  })

  it('switches to second sheet content when its tab is clicked', async () => {
    render(<Review {...multiSheetProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sheet2' }))
    await waitFor(() => {
      const viewer = document.querySelector('[data-testid="doc-viewer"]')
      expect(viewer.innerHTML).toContain('Expenses')
      expect(viewer.innerHTML).not.toContain('Revenue')
    })
  })

  it('does not render a tab bar for a single-sheet workbook', () => {
    render(<Review {...baseProps()} />)
    // baseProps uses html with no <h3> tags — sheets[] is empty, no tab bar
    expect(screen.queryByRole('button', { name: 'Sheet1' })).not.toBeInTheDocument()
  })

  it('displays sheet name with special characters correctly in tab', () => {
    const html =
      '<h3>Q&amp;A</h3><table><tr><td data-cell-address="Q&amp;A!A1">val</td></tr></table>' +
      '<h3>Sheet2</h3><table><tr><td data-cell-address="Sheet2!A1">other</td></tr></table>'
    render(<Review {...multiSheetProps({ html })} />)
    expect(screen.getByRole('button', { name: 'Q&A' })).toBeInTheDocument()
  })

  it('applies chip overlay to active sheet content after tab switch', async () => {
    // Sheet1 HTML contains a {{name}} token; fields prop declares 'name'
    const html =
      '<h3>Sheet1</h3><table><tr><td data-cell-address="Sheet1!A1">{{name}}</td></tr></table>' +
      '<h3>Sheet2</h3><table><tr><td data-cell-address="Sheet2!A1">Expenses</td></tr></table>'
    render(<Review {...multiSheetProps({ html, fields: ['name'] })} />)

    // Switch to Sheet2 then back to Sheet1
    fireEvent.click(screen.getByRole('button', { name: 'Sheet2' }))
    await waitFor(() => {
      const viewer = document.querySelector('[data-testid="doc-viewer"]')
      expect(viewer.innerHTML).toContain('Expenses')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sheet1' }))
    await waitFor(() => {
      const viewer = document.querySelector('[data-testid="doc-viewer"]')
      // applyChipOverlay should have replaced {{name}} with a colored chip span
      expect(viewer.querySelector('span')).not.toBeNull()
      expect(viewer.textContent).toContain('{{name}}')
    })
  })

  // Note: scroll-reset-to-0 on tab switch is implemented via tabSwitchRef in
  // the combined effect. jsdom does not track scrollTop, so this is a runtime
  // behavior verified manually — not tested here.

  it('preserves active tab after field insertion', async () => {
    suggestFieldPattern.mockResolvedValueOnce({ label: '', value: 'Expenses', fieldName: 'expenses' })
    render(<Review {...multiSheetProps()} />)

    // Switch to Sheet2
    fireEvent.click(screen.getByRole('button', { name: 'Sheet2' }))
    await waitFor(() => {
      const viewer = document.querySelector('[data-testid="doc-viewer"]')
      expect(viewer.innerHTML).toContain('Expenses')
    })

    // Insert a field on Sheet2
    fireEvent.click(screen.getByText('Expenses'))
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Sheet2 tab should still be active (Sheet2 content visible)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    expect(viewer.innerHTML).not.toContain('Revenue')
  })
})
```

### Step 2: Run to confirm failures

- [ ] Run:

```bash
npx vitest run src/test/Review.xlsx.test.jsx
```

Expected: the new `describe` block tests fail; the existing `describe` block tests still pass.

### Step 3: Run full suite to confirm all tests pass

- [ ] The tests should pass without any further changes (the implementation was done in Tasks 1–3):

```bash
npx vitest run src/test/Review.xlsx.test.jsx
```

Expected: all 11 tests pass (3 existing + 8 new).

- [ ] Run the full suite one final time:

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] Commit:

```bash
git add src/test/Review.xlsx.test.jsx
git commit -m "test: add XLSX sheet tab behavior tests to Review.xlsx.test.jsx"
```
