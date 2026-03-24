# Image Auto-Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard "File too large" error for oversized images with an automatic canvas-based downscale before sending to Gemini.

**Architecture:** Add an exported `_resizeImageToLimit` helper to `gemini.js` that iteratively halves image dimensions on a canvas until the JPEG output fits within 4 MB. Update `analyzeSource` to call it when needed, splitting the current combined image+PDF branch into two separate branches. Fix the existing spread-based base64 encoder in both branches.

**Tech Stack:** Vitest + jsdom (tests), HTML Canvas API (resize), `@google/generative-ai` (Gemini)

---

## File Map

| File | What changes |
|------|-------------|
| `src/lib/gemini.js` | Fix base64 encoder; split image/PDF branches; add exported `_resizeImageToLimit` |
| `src/test/lib/gemini.test.js` | Replace 1 existing test; add 5 new test cases |

Run tests at any time with:
```bash
npx vitest run src/test/lib/gemini.test.js
```

---

## Task 1: Fix the base64 encoder and split image/PDF branches

The current `analyzeSource` at `gemini.js:240–248` combines images and PDFs in one `if` block and uses a spread-based encoder that throws `RangeError` on buffers larger than ~250 KB. Fix both in one change — no new tests needed because the existing `analyzeSource` tests cover this branch and will catch regressions.

**Files:**
- Modify: `src/lib/gemini.js:240–248`

- [ ] **Step 1: Replace the combined binary branch with two separate branches**

Open `src/lib/gemini.js`. Find this block (around line 240):

```js
if (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/gif' ||
    file.type === 'image/webp' || file.type === 'application/pdf') {
  // Binary path — size guard
  if (file.size > MAX_BINARY_BYTES) {
    throw new Error(`File too large: ${file.size} bytes (max ${MAX_BINARY_BYTES})`)
  }
  const buffer = await file.arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  contents = [{ inlineData: { mimeType: file.type, data: base64 } }, { text: prompt }]
```

Replace it with:

```js
if (file.type === 'image/png' || file.type === 'image/jpeg' ||
    file.type === 'image/gif' || file.type === 'image/webp') {
  // Image path — auto-resize if needed (added in Task 2)
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
```

Note: `_resizeImageToLimit` doesn't exist yet — it will be defined in Task 2. The image path will call it, but the small-image fast-path (`file.size <= MAX_BINARY_BYTES`) won't reach it.

- [ ] **Step 2: Replace the existing "throws if binary file exceeds 4 MB" test**

Open `src/test/lib/gemini.test.js`. Find this test (around line 242):

```js
it('throws if binary file exceeds 4 MB', async () => {
  const file = makeFile({ type: 'image/png', size: 4 * 1024 * 1024 + 1 })
  await expect(analyzeSource(VALID_KEY, file, FIELDS)).rejects.toThrow()
  expect(mockGenerateContent).not.toHaveBeenCalled()
})
```

Replace it with a PDF-specific size test (images no longer throw — they resize):

```js
it('throws if PDF exceeds 4 MB', async () => {
  const file = makeFile({ type: 'application/pdf', size: 4 * 1024 * 1024 + 1 })
  await expect(analyzeSource(VALID_KEY, file, FIELDS)).rejects.toThrow('File too large')
  expect(mockGenerateContent).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Run the tests and confirm they still pass**

```bash
npx vitest run src/test/lib/gemini.test.js
```

Expected: all tests pass. The large-image test no longer exists; the PDF test replaces it. The small-image tests still pass because `file.size <= MAX_BINARY_BYTES` skips the resize call.

- [ ] **Step 4: Commit**

```bash
git add src/lib/gemini.js src/test/lib/gemini.test.js
git commit -m "refactor: split image/PDF branches in analyzeSource, fix base64 encoder"
```

---

## Task 2: Implement `_resizeImageToLimit`

Add the resize helper as a named export. Tests are written first (TDD).

**Files:**
- Modify: `src/test/lib/gemini.test.js` (add tests first)
- Modify: `src/lib/gemini.js` (add implementation)

### Canvas mock helpers

The tests run in jsdom which has no real canvas. You need to mock four browser APIs before each resize test: `URL.createObjectURL`, `URL.revokeObjectURL`, the `Image` constructor, and `document.createElement('canvas')`.

Add a helper block **inside** the existing `describe('analyzeSource', ...)` block (or in a new sibling `describe` — either works). The helper below is self-contained:

```js
// --- Canvas mock helpers (used by resize tests) ---
function makeCanvasMock(blobByteLength) {
  // Returns a fake canvas whose toBlob callback fires with a blob of the given size
  const fakeBytes = new Uint8Array(blobByteLength)
  const fakeBlob = new Blob([fakeBytes])
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    toBlob: vi.fn((cb) => cb(fakeBlob)),
  }
}

function setupCanvasMocks({ blobByteLength = 100 } = {}) {
  // URL mocks
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:fake'),
    revokeObjectURL: vi.fn(),
  })

  // Image mock — auto-fires onload with a 800x600 image
  const fakeImg = { naturalWidth: 800, naturalHeight: 600, src: '' }
  const OriginalImage = globalThis.Image
  vi.stubGlobal('Image', function () {
    Object.assign(this, fakeImg)
    setTimeout(() => this.onload?.(), 0)
  })

  // Canvas mock
  const canvas = makeCanvasMock(blobByteLength)
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'canvas') return canvas
    return OriginalImage // won't be called for 'canvas'
  })

  return canvas
}
```

- [ ] **Step 1: Write failing tests for `_resizeImageToLimit`**

Add these tests to `src/test/lib/gemini.test.js`. Import `_resizeImageToLimit` at the top of the file alongside the other named imports:

```js
import { testConnection, extractVariables, MAX_CHARS, suggestFieldName, suggestFieldPattern, analyzeSource, _resizeImageToLimit } from '../../lib/gemini.js'
```

Add the canvas mock helpers block (shown above) after the `makeFile` helper inside `describe('analyzeSource', ...)`.

Then add this new `describe` block after (or inside) the `analyzeSource` describe:

```js
describe('_resizeImageToLimit', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns mimeType image/jpeg for GIF input', async () => {
    setupCanvasMocks({ blobByteLength: 100 }) // small output, under limit
    const inputBuffer = new ArrayBuffer(8)
    const result = await _resizeImageToLimit(inputBuffer, 'image/gif', 4 * 1024 * 1024)
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.buffer).toBeInstanceOf(ArrayBuffer)
  })

  it('throws when halvingCount reaches 5', async () => {
    // Each toBlob call returns a blob that is still over the 10-byte limit
    // We use a tiny limit so the mock output (100 bytes) always exceeds it
    setupCanvasMocks({ blobByteLength: 1000 })
    const inputBuffer = new ArrayBuffer(8)
    await expect(
      _resizeImageToLimit(inputBuffer, 'image/png', 10)
    ).rejects.toThrow('Image too large to resize: could not fit within 4 MB')
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run src/test/lib/gemini.test.js
```

Expected: the two new tests fail with "\_resizeImageToLimit is not a function" (or similar import error).

- [ ] **Step 3: Implement `_resizeImageToLimit` in `gemini.js`**

Add this function near the bottom of `src/lib/gemini.js`, before `analyzeSource`:

```js
export async function _resizeImageToLimit(arrayBuffer, mimeType, maxBytes) {
  const blob = new Blob([arrayBuffer], { type: mimeType })
  const url = URL.createObjectURL(blob)

  const img = await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = url
  })
  URL.revokeObjectURL(url)

  let width = img.naturalWidth
  let height = img.naturalHeight
  let halvingCount = 0

  while (true) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(img, 0, 0, width, height)

    const resultBlob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    })

    const resultBuffer = await resultBlob.arrayBuffer()

    if (resultBuffer.byteLength <= maxBytes) {
      return { buffer: resultBuffer, mimeType: 'image/jpeg' }
    }

    // Check stopping conditions before modifying dimensions
    if (Math.min(width / 2, height / 2) < 200) {
      throw new Error('Image too large to resize: could not fit within 4 MB')
    }
    if (halvingCount >= 5) {
      throw new Error('Image too large to resize: could not fit within 4 MB')
    }

    width = Math.round(width / 2)
    height = Math.round(height / 2)
    halvingCount++
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run src/test/lib/gemini.test.js
```

Expected: all tests pass including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gemini.js src/test/lib/gemini.test.js
git commit -m "feat: add _resizeImageToLimit canvas-based image downscale helper"
```

---

## Task 3: Integration tests for `analyzeSource` resize path

Add the three remaining integration tests that exercise `analyzeSource` end-to-end with the resize path.

**Files:**
- Modify: `src/test/lib/gemini.test.js`

- [ ] **Step 1: Write the three failing integration tests**

Add these inside `describe('analyzeSource', ...)` in `src/test/lib/gemini.test.js`, after the existing tests:

```js
describe('image auto-resize', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not create a canvas when image is under the size limit', async () => {
    const createElementSpy = vi.spyOn(document, 'createElement')
    const file = makeFile({ type: 'image/png', size: 100 })
    mockGenerateContent.mockResolvedValue({ response: { text: () => '{}' } })

    await analyzeSource(VALID_KEY, file, FIELDS)

    expect(createElementSpy).not.toHaveBeenCalledWith('canvas')
  })

  it('resizes and sends mimeType image/jpeg when image exceeds the size limit', async () => {
    // Setup canvas mock that returns a small blob (under 4 MB limit)
    setupCanvasMocks({ blobByteLength: 100 })
    const oversizedBuffer = new ArrayBuffer(4 * 1024 * 1024 + 1)
    const file = makeFile({ type: 'image/png', size: 4 * 1024 * 1024 + 1, content: oversizedBuffer })
    mockGenerateContent.mockResolvedValue({ response: { text: () => '{"fullName":"Jane"}' } })

    const result = await analyzeSource(VALID_KEY, file, FIELDS)

    expect(result).toEqual({ fullName: 'Jane' })
    const call = mockGenerateContent.mock.calls[0][0]
    expect(Array.isArray(call)).toBe(true)
    expect(call[0].inlineData.mimeType).toBe('image/jpeg')
  })

  it('throws the resize error (not "File too large") when canvas cannot shrink enough', async () => {
    // Canvas always returns a blob larger than our tiny limit
    setupCanvasMocks({ blobByteLength: 1000 })
    const file = makeFile({ type: 'image/png', size: 4 * 1024 * 1024 + 1 })

    // Temporarily override MAX_BINARY_BYTES by using a ridiculously small limit
    // We achieve this by mocking _resizeImageToLimit to throw as it would for a real oversized image
    // Instead: test by verifying the error message is the resize error, not the size guard error.
    // Use the actual function — set blobByteLength large enough that it always exceeds the real 4MB limit
    const bigBlob = 4 * 1024 * 1024 + 1 // 4 MB + 1 byte — exceeds MAX_BINARY_BYTES
    setupCanvasMocks({ blobByteLength: bigBlob }) // canvas always returns over-limit

    await expect(analyzeSource(VALID_KEY, file, FIELDS)).rejects.toThrow(
      'Image too large to resize: could not fit within 4 MB'
    )
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })
})
```

**Note on the third test:** `setupCanvasMocks` is called twice above — remove the first call and keep only the second. The test as shown has a comment error. Here is the corrected version:

```js
it('throws the resize error when canvas cannot shrink the image enough', async () => {
  // Canvas mock always returns a blob still over the 4 MB limit → resize loop exhausts
  const bigBlobSize = 4 * 1024 * 1024 + 1
  setupCanvasMocks({ blobByteLength: bigBlobSize })

  const file = makeFile({ type: 'image/png', size: 4 * 1024 * 1024 + 1 })

  await expect(analyzeSource(VALID_KEY, file, FIELDS)).rejects.toThrow(
    'Image too large to resize: could not fit within 4 MB'
  )
  expect(mockGenerateContent).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run src/test/lib/gemini.test.js
```

Expected: the three new integration tests fail (the resize path isn't fully wired yet, or the mock setup needs adjustment).

- [ ] **Step 3: Adjust mock setup if needed and run until tests pass**

If `setupCanvasMocks` is defined outside `describe('analyzeSource')`, move it to a shared scope. If `afterEach` restores mocks between the unit and integration tests, confirm `vi.restoreAllMocks()` runs correctly.

Run:
```bash
npx vitest run src/test/lib/gemini.test.js
```

Expected: all tests pass.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all tests pass with no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/test/lib/gemini.test.js
git commit -m "test: add analyzeSource integration tests for image auto-resize path"
```

---

## Done

All changes are in two files. The feature is complete when:
- `npm test` passes with no failures
- Uploading an image > 4 MB in the Generate step no longer shows an error toast — it silently resizes and sends to Gemini
- Uploading a PDF > 4 MB still shows the "File too large" error
