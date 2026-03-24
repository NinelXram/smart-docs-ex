# Image Auto-Resize for AI Analysis

**Date:** 2026-03-24
**Status:** Approved

## Problem

Images over 4 MB sent to the Gemini API via `analyzeSource()` currently throw a hard "File too large" error, blocking the upload-and-analyze workflow. Users must manually resize before uploading.

## Goal

Automatically downscale oversized images before sending to Gemini, with no user intervention required. PDFs retain the existing size error.

## Scope

- **In scope:** PNG, JPEG, GIF, WebP inputs to `analyzeSource()`
- **Out of scope:** PDF resizing, changes to any file outside `src/lib/gemini.js` and `src/test/lib/gemini.test.js`

## Design

### Fix to base64 encoder (prerequisite)

The existing encoder at `gemini.js:247` uses spread syntax:

```js
const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
```

This throws `RangeError: Maximum call stack size exceeded` for buffers larger than ~250 KB due to the spread. This must be replaced with a chunked loop in the same change:

```js
const bytes = new Uint8Array(buffer)
let binary = ''
for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
const base64 = btoa(binary)
```

This fix applies to all images and PDFs, not just resized ones. It is intentionally duplicated in both the image and PDF branches — do not extract it into a shared helper.

### New helper: `export async function _resizeImageToLimit(arrayBuffer, mimeType, maxBytes)`

Located in `src/lib/gemini.js`. **Exported as a named export** (prefixed with underscore to signal internal intent, but exported so it can be imported directly in tests). Note: the existing `_parseFieldPattern` and `_sanitizeFieldName` helpers in this file are *not* exported — this is a new pattern for this module, introduced because the helper needs direct unit-test coverage.

**Algorithm:**
1. Create a `Blob` from the `ArrayBuffer`, decode into an `HTMLImageElement` via `URL.createObjectURL`
2. Draw onto a `<canvas>` at current `{ width, height }`
3. Export as JPEG via `canvas.toBlob()` at quality 0.85; convert result to `ArrayBuffer`
4. If resulting size > `maxBytes`, check stopping conditions **before modifying dimensions**:
   - **Dimension floor (checked first):** if `Math.min(width / 2, height / 2) < 200`, throw `"Image too large to resize: could not fit within 4 MB"`
   - **Halving counter (checked second):** initialised to 0, incremented after each successful halve. If counter has already reached 5, throw same error.
   - Otherwise: `width = Math.round(width / 2); height = Math.round(height / 2); halvingCount++` — then go to step 2
5. Return `{ buffer: ArrayBuffer, mimeType: 'image/jpeg' }`

"One halving" = one pass through step 4 that results in new dimensions. The initial canvas draw (step 2 on first entry) is not counted as a halve.

Output is always JPEG regardless of input format. Animated GIFs are flattened to the first frame.

**Memory note:** The original buffer and the canvas RGBA pixel buffer coexist in memory during resize. For a 20 MP image this can exceed 100 MB peak. Acceptable for a Chrome extension side panel; no upper input-size bound is enforced.

### Change to `analyzeSource()` — image and PDF branches split

Replace the single binary branch with separate image and PDF conditions:

```js
if (file.type === 'image/png' || file.type === 'image/jpeg' ||
    file.type === 'image/gif' || file.type === 'image/webp') {
  // Image path — auto-resize if needed
  let buffer = await file.arrayBuffer()
  let mimeType = file.type
  if (file.size > MAX_BINARY_BYTES) {
    ({ buffer, mimeType } = await _resizeImageToLimit(buffer, mimeType, MAX_BINARY_BYTES))
  }
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const base64 = btoa(binary)
  contents = [{ inlineData: { mimeType, data: base64 } }, { text: prompt }]

} else if (file.type === 'application/pdf') {
  // PDF path — size guard unchanged
  if (file.size > MAX_BINARY_BYTES) {
    throw new Error(`File too large: ${file.size} bytes (max ${MAX_BINARY_BYTES})`)
  }
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const base64 = btoa(binary)
  contents = [{ inlineData: { mimeType: file.type, data: base64 } }, { text: prompt }]
}
```

### Data Flow

```
User uploads image (any size)
  ↓
analyzeSource() detects image MIME type
  ↓
file.size > MAX_BINARY_BYTES?
  ├─ No  → use original buffer (fast path)
  └─ Yes → _resizeImageToLimit(buffer, mimeType, MAX_BINARY_BYTES)
              ↓
           canvas draw → JPEG export at 0.85 quality
              ↓
           still too large?
             post-halve short side >= 200px AND halvingCount < 5?
               ├─ Yes → halve dimensions, halvingCount++, repeat
               └─ No  → throw error
              ↓
           return { buffer, mimeType: 'image/jpeg' }
  ↓
chunked base64-encode → send as inlineData to Gemini
```

## Edge Cases

| Case | Behavior |
|------|----------|
| GIF / WebP input | Canvas export normalises to JPEG; animated GIFs flattened to frame 1 |
| halvingCount reaches 5 | Throws `"Image too large to resize: could not fit within 4 MB"` |
| Post-halve short side < 200 px | Throws same error (checked before halvingCount) |
| Canvas unavailable | N/A — side panel always runs in a full browser context |
| PDF over 4 MB | Unchanged — throws original "File too large" error |
| Image already under limit | `_resizeImageToLimit` not called; zero overhead |
| Large buffer base64 encode | Chunked loop (not spread) prevents RangeError |

## Testing

File: `src/test/lib/gemini.test.js`

`_resizeImageToLimit` is a named export — tests import it directly for unit tests. For integration tests of `analyzeSource`, the "resize not called" case is verified by asserting that `document.createElement` was not called with `'canvas'` (since canvas is only created inside `_resizeImageToLimit`). The "resize called" case is verified by importing the mock-canvas helper and checking the returned buffer size.

Canvas is unavailable in jsdom. All tests that exercise `_resizeImageToLimit` mock `document.createElement('canvas')` and `HTMLCanvasElement.prototype.toBlob` via `vi.spyOn`.

| Test | What it verifies |
|------|-----------------|
| Small image (under limit) via `analyzeSource` | No canvas created; original buffer used (assert `createElement` not called with `'canvas'`) |
| Large image (over limit) via `analyzeSource` | Canvas mock returns small-enough blob; `analyzeSource` sends mimeType `image/jpeg` |
| GIF input via `_resizeImageToLimit` directly | Returns `{ mimeType: 'image/jpeg' }` (magic-byte check omitted — canvas encoder is mocked in jsdom, so byte content is not meaningful) |
| halvingCount reaches 5 via `_resizeImageToLimit` | Throws `"Image too large to resize: could not fit within 4 MB"` |
| PDF over limit via `analyzeSource` | Throws original `"File too large"` error; no canvas created |

**Existing test to update:** The current test at `gemini.test.js` that asserts `analyzeSource` throws `"File too large"` for an image of `size: MAX_BINARY_BYTES + 1` must be replaced — that path now routes through `_resizeImageToLimit` instead of throwing.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gemini.js` | Fix chunked base64 encoder in both branches; split image/PDF branches; add exported `_resizeImageToLimit` |
| `src/test/lib/gemini.test.js` | Add 5 new test cases |
