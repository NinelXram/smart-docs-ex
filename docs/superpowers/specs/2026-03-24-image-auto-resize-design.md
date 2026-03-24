# Image Auto-Resize for AI Analysis

**Date:** 2026-03-24
**Status:** Approved

## Problem

Images over 4 MB sent to the Gemini API via `analyzeSource()` currently throw a hard "File too large" error, blocking the upload-and-analyze workflow. Users must manually resize before uploading.

## Goal

Automatically downscale oversized images before sending to Gemini, with no user intervention required. PDFs retain the existing size error.

## Scope

- **In scope:** PNG, JPEG, GIF, WebP inputs to `analyzeSource()`
- **Out of scope:** PDF resizing, changes to any file outside `src/lib/gemini.js`, changes to text/DOCX paths

## Design

### New helper: `_resizeImageToLimit(arrayBuffer, mimeType, maxBytes)`

Located in `src/lib/gemini.js` (internal, not exported).

**Algorithm:**
1. Create a `Blob` from the `ArrayBuffer`, decode into an `HTMLImageElement`
2. Draw onto a `<canvas>` at current dimensions
3. Export as JPEG via `canvas.toBlob()` at quality 0.85
4. If resulting blob size > `maxBytes`, halve both dimensions and repeat
5. Max 5 iterations; if still over limit after 5 passes, throw:
   `"Image too large to resize: could not fit within 4 MB after 5 attempts"`
6. Return `{ buffer: ArrayBuffer, mimeType: 'image/jpeg' }`

Output is always JPEG regardless of input format. Animated GIFs are flattened to the first frame.

### Change to `analyzeSource()`

Replace:
```js
if (file.size > MAX_BINARY_BYTES) {
  throw new Error(`File too large: ${file.size} bytes (max ${MAX_BINARY_BYTES})`)
}
const buffer = await file.arrayBuffer()
// ... base64 encode buffer using original file.type
```

With:
```js
let buffer = await file.arrayBuffer()
let mimeType = file.type
if (file.size > MAX_BINARY_BYTES) {
  ({ buffer, mimeType } = await _resizeImageToLimit(buffer, mimeType, MAX_BINARY_BYTES))
}
// ... base64 encode buffer using mimeType
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
           canvas draw → JPEG export
              ↓
           still too large? halve dimensions, repeat (max 5x)
              ↓
           return { buffer, mimeType: 'image/jpeg' }
  ↓
base64-encode → send as inlineData to Gemini
```

## Edge Cases

| Case | Behavior |
|------|----------|
| GIF / WebP input | Canvas export normalises to JPEG; animated GIFs flattened to frame 1 |
| 5 iterations still too large | Throws descriptive error |
| Canvas unavailable | N/A — side panel always runs in a full browser context |
| PDF over 4 MB | Unchanged — still throws original "File too large" error |
| Image already under limit | `_resizeImageToLimit` not called; zero overhead |

## Testing

File: `src/test/lib/gemini.test.js`

| Test | What it verifies |
|------|-----------------|
| Small image (under limit) | Buffer sent as-is, resize not called |
| Large image (over limit) | Result fits within `MAX_BINARY_BYTES`, mimeType is `image/jpeg` |
| GIF input | Output mimeType is `image/jpeg` |
| 5-pass failure | `analyzeSource` throws with descriptive message |
| PDF over limit | Original "File too large" error thrown |

Canvas is unavailable in jsdom. Tests mock `_resizeImageToLimit` via `vi.spyOn` at the module boundary.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gemini.js` | Add `_resizeImageToLimit`; update `analyzeSource` image branch |
| `src/test/lib/gemini.test.js` | Add 5 new test cases |
