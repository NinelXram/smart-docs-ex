# Analyze Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Analyze button to the Generate page that accepts an image or document, sends it to Gemini, and auto-populates matching template fields.

**Architecture:** A new `analyzeSource(apiKey, file, fields, lang)` function in `gemini.js` handles all Gemini interaction. Images and PDFs are sent as base64 `inlineData` (multimodal); DOCX and TXT are extracted to text then sent as a text prompt. `Generate.jsx` adds the button to the header, wires a hidden file input and drag-drop handlers, and merges results into existing field values state.

**Tech Stack:** React, @google/generative-ai, mammoth (already a dep), Vitest + React Testing Library

**Spec:** `docs/superpowers/specs/2026-03-23-analyze-button-design.md`

---

## File Map

| File | Change |
|------|--------|
| `src/locales/en.json` | Add 3 keys to `generate` object |
| `src/locales/vi.json` | Add 3 keys to `generate` object |
| `src/lib/gemini.js` | Add `analyzeSource()` export |
| `src/test/lib/gemini.test.js` | Add `describe('analyzeSource', ...)` tests |
| `src/pages/Generate.jsx` | Add Analyze button + handler |
| `src/test/pages/Generate.test.jsx` | Add mock for gemini + 5 new tests |

---

## Task 1: Add i18n keys

**Files:**
- Modify: `src/locales/en.json`
- Modify: `src/locales/vi.json`

- [ ] **Step 1: Add keys to en.json**

In `src/locales/en.json`, inside the `"generate"` object (after `"errorFailed": "Generation failed:"`), add:

```json
"analyze": "Analyze",
"analyzing": "Analyzing…",
"analyzeError": "Analysis failed:"
```

- [ ] **Step 2: Add keys to vi.json**

In `src/locales/vi.json`, inside the `"generate"` object (after `"errorFailed": "Tạo tệp thất bại:"`), add:

```json
"analyze": "Phân tích",
"analyzing": "Đang phân tích…",
"analyzeError": "Phân tích thất bại:"
```

- [ ] **Step 3: Commit**

```bash
git add src/locales/en.json src/locales/vi.json
git commit -m "feat: add analyze button i18n keys"
```

---

## Task 2: analyzeSource — failing tests

**Files:**
- Modify: `src/test/lib/gemini.test.js`

The existing test file mocks `@google/generative-ai` and `mammoth` is not yet mocked. Add a `mammoth` mock and a new `describe('analyzeSource', ...)` block.

- [ ] **Step 1: Add mammoth mock and analyzeSource import**

At the top of `src/test/lib/gemini.test.js`, after the existing `@google/generative-ai` mock, add:

```js
vi.mock('mammoth', () => ({
  extractRawText: vi.fn(),
}))

import * as mammoth from 'mammoth'
```

Update the existing import line to also import `analyzeSource`:

```js
import { testConnection, extractVariables, MAX_CHARS, suggestFieldName, suggestFieldPattern, analyzeSource } from '../../lib/gemini.js'
```

- [ ] **Step 2: Add failing tests**

Append this describe block to `src/test/lib/gemini.test.js`:

```js
describe('analyzeSource', () => {
  const FIELDS = ['fullName', 'jobTitle']

  function makeFile({ type = 'image/png', size = 100, content = new ArrayBuffer(8) } = {}) {
    return {
      type,
      size,
      arrayBuffer: vi.fn().mockResolvedValue(content),
      text: vi.fn().mockResolvedValue('plain text content'),
    }
  }

  it('sends image as inlineData and returns matched fields', async () => {
    const file = makeFile({ type: 'image/png', size: 100 })
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"fullName":"Jane","jobTitle":"Engineer","unknown":"x"}' },
    })
    const result = await analyzeSource(VALID_KEY, file, FIELDS)
    expect(result).toEqual({ fullName: 'Jane', jobTitle: 'Engineer' })
    // inlineData call shape: array with inlineData + text parts
    const call = mockGenerateContent.mock.calls[0][0]
    expect(Array.isArray(call)).toBe(true)
    expect(call[0]).toHaveProperty('inlineData')
    expect(call[0].inlineData.mimeType).toBe('image/png')
  })

  it('sends PDF as inlineData with mimeType application/pdf', async () => {
    const file = makeFile({ type: 'application/pdf', size: 100 })
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{}' },
    })
    await analyzeSource(VALID_KEY, file, FIELDS)
    const call = mockGenerateContent.mock.calls[0][0]
    expect(call[0].inlineData.mimeType).toBe('application/pdf')
  })

  it('extracts DOCX text via mammoth and sends as text prompt', async () => {
    const file = makeFile({ type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 100 })
    mammoth.extractRawText.mockResolvedValue({ value: 'extracted docx text' })
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"fullName":"Bob"}' },
    })
    const result = await analyzeSource(VALID_KEY, file, FIELDS)
    expect(mammoth.extractRawText).toHaveBeenCalledWith({ arrayBuffer: expect.any(ArrayBuffer) })
    expect(result).toEqual({ fullName: 'Bob' })
    // text-path call shape: plain string (not array)
    const call = mockGenerateContent.mock.calls[0][0]
    expect(typeof call).toBe('string')
    expect(call).toContain('extracted docx text')
  })

  it('reads TXT via file.text() and sends as text prompt', async () => {
    const file = makeFile({ type: 'text/plain', size: 100 })
    file.text.mockResolvedValue('hello world')
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"jobTitle":"Dev"}' },
    })
    const result = await analyzeSource(VALID_KEY, file, FIELDS)
    expect(file.text).toHaveBeenCalled()
    expect(result).toEqual({ jobTitle: 'Dev' })
  })

  it('throws if binary file exceeds 4 MB', async () => {
    const file = makeFile({ type: 'image/png', size: 4 * 1024 * 1024 + 1 })
    await expect(analyzeSource(VALID_KEY, file, FIELDS)).rejects.toThrow()
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })

  it('throws if text content exceeds MAX_CHARS', async () => {
    const file = makeFile({ type: 'text/plain', size: 100 })
    file.text.mockResolvedValue('a'.repeat(MAX_CHARS + 1))
    await expect(analyzeSource(VALID_KEY, file, FIELDS)).rejects.toThrow()
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })

  it('strips markdown fences and parses JSON', async () => {
    const file = makeFile({ type: 'image/png', size: 100 })
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '```json\n{"fullName":"Alice"}\n```' },
    })
    const result = await analyzeSource(VALID_KEY, file, FIELDS)
    expect(result).toEqual({ fullName: 'Alice' })
  })

  it('retries once on malformed JSON and throws on second failure', async () => {
    const file = makeFile({ type: 'image/png', size: 100 })
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'not json' },
    })
    await expect(analyzeSource(VALID_KEY, file, FIELDS)).rejects.toThrow()
    expect(mockGenerateContent).toHaveBeenCalledTimes(2)
  })

  it('returns empty object when no fields match', async () => {
    const file = makeFile({ type: 'image/png', size: 100 })
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"unknown":"x","other":"y"}' },
    })
    const result = await analyzeSource(VALID_KEY, file, FIELDS)
    expect(result).toEqual({})
  })

  it('appends Vietnamese instruction when lang=vi', async () => {
    const file = makeFile({ type: 'image/png', size: 100 })
    mockGenerateContent.mockResolvedValue({ response: { text: () => '{}' } })
    await analyzeSource(VALID_KEY, file, FIELDS, 'vi')
    const call = mockGenerateContent.mock.calls[0][0]
    const textPart = Array.isArray(call) ? call[1].text : call
    expect(textPart).toContain('Respond in Vietnamese.')
  })

  it('does not append Vietnamese instruction when lang=en', async () => {
    const file = makeFile({ type: 'image/png', size: 100 })
    mockGenerateContent.mockResolvedValue({ response: { text: () => '{}' } })
    await analyzeSource(VALID_KEY, file, FIELDS, 'en')
    const call = mockGenerateContent.mock.calls[0][0]
    const textPart = Array.isArray(call) ? call[1].text : call
    expect(textPart).not.toContain('Respond in Vietnamese.')
  })
})
```

- [ ] **Step 3: Run tests and confirm they fail**

```bash
npx vitest run src/test/lib/gemini.test.js
```

Expected: multiple failures with `analyzeSource is not a function` or similar.

---

## Task 3: Implement analyzeSource

**Files:**
- Modify: `src/lib/gemini.js`

- [ ] **Step 1: Add the analyzeSource function**

Append to `src/lib/gemini.js` (after the last export):

```js
/**
 * Read a file and ask Gemini to extract values for known template fields.
 * Binary files (images, PDF) are sent via inlineData multimodal call.
 * Text files (DOCX, TXT) are extracted to string and sent as a text prompt.
 * @param {string} apiKey
 * @param {File} file
 * @param {string[]} fields - known template field names
 * @param {string} [lang]
 * @returns {Promise<Record<string, string>>} - matched field values only
 */
export async function analyzeSource(apiKey, file, fields, lang = 'vi') {
  const langInstruction = lang === 'vi' ? '\nRespond in Vietnamese.' : ''
  const prompt =
    `These are the template field names: [${fields.join(', ')}].\n` +
    `Extract matching values from the document.\n` +
    `Return JSON only: {"fieldName": "value", ...}.\n` +
    `Only include fields you are confident about.` +
    langInstruction

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })

  let responseText
  if (_isBinary(file.type)) {
    if (file.size > 4 * 1024 * 1024) {
      throw new Error('File too large (max 4 MB)')
    }
    const arrayBuffer = await file.arrayBuffer()
    const base64 = _toBase64(arrayBuffer)
    try {
      const result = await model.generateContent([
        { inlineData: { mimeType: file.type, data: base64 } },
        { text: prompt },
      ])
      responseText = result.response.text()
    } catch (err) {
      throw new Error(`Gemini API error: ${err.message}`)
    }
  } else {
    let text
    if (file.type.includes('wordprocessingml') || file.name?.endsWith('.docx')) {
      const arrayBuffer = await file.arrayBuffer()
      const { value } = await mammoth.extractRawText({ arrayBuffer })
      text = value
    } else {
      text = await file.text()
    }
    if (text.length > MAX_CHARS) {
      throw new Error(`Document too large: ${text.length} chars (max ${MAX_CHARS})`)
    }
    try {
      const result = await model.generateContent(prompt + '\n\nDocument content:\n' + text)
      responseText = result.response.text()
    } catch (err) {
      throw new Error(`Gemini API error: ${err.message}`)
    }
  }

  return _parseFieldValues(responseText, fields, async () => {
    const retry = await model.generateContent(
      (prompt + '\n\nCRITICAL: respond with valid JSON only.')
    )
    return retry.response.text()
  })
}

function _isBinary(mimeType) {
  return mimeType.startsWith('image/') || mimeType === 'application/pdf'
}

function _toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function _parseFieldValues(text, fields, retryFn) {
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return retryFn().then(retryText => _parseFieldValuesStrict(retryText, fields))
  }
  return Promise.resolve(_filterToKnownFields(parsed, fields))
}

function _parseFieldValuesStrict(text, fields) {
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
  const parsed = JSON.parse(cleaned) // throws on failure — caller catches
  return _filterToKnownFields(parsed, fields)
}

function _filterToKnownFields(parsed, fields) {
  const result = {}
  for (const key of fields) {
    if (typeof parsed[key] === 'string' && parsed[key].length > 0) {
      result[key] = parsed[key]
    }
  }
  return result
}
```

Also add the mammoth import at the top of `src/lib/gemini.js` (after the existing import):

```js
import * as mammoth from 'mammoth'
```

- [ ] **Step 2: Run tests and confirm they pass**

```bash
npx vitest run src/test/lib/gemini.test.js
```

Expected: all tests pass including the new `analyzeSource` describe block.

- [ ] **Step 3: Commit**

```bash
git add src/lib/gemini.js src/test/lib/gemini.test.js
git commit -m "feat: add analyzeSource to gemini.js with tests"
```

---

## Task 4: Generate.jsx — failing tests

**Files:**
- Modify: `src/test/pages/Generate.test.jsx`

The existing mock only covers `storage.js` with `getTemplateBinary`. We need to also mock `getApiKey` from storage, and mock `analyzeSource` from gemini.js.

- [ ] **Step 1: Update the storage mock and add gemini mock**

At the top of `src/test/pages/Generate.test.jsx`, update the existing storage mock:

```js
vi.mock('../../lib/storage.js', () => ({
  getTemplateBinary: vi.fn(),
  getApiKey: vi.fn(),
}))

vi.mock('../../lib/gemini.js', () => ({
  analyzeSource: vi.fn(),
}))
```

Add the new imports below the existing import lines:

```js
import * as gemini from '../../lib/gemini.js'
```

Update `beforeEach` to also set a default for `getApiKey`:

```js
beforeEach(() => {
  vi.clearAllMocks()
  storage.getTemplateBinary.mockResolvedValue(FAKE_BUFFER)
  storage.getApiKey.mockResolvedValue('fake-api-key')
})
```

- [ ] **Step 2: Add 5 failing tests**

Inside the existing `describe('Generate', () => { ... })` block, append:

```js
describe('Analyze button', () => {
  it('fills matched fields when analyzeSource resolves', async () => {
    gemini.analyzeSource.mockResolvedValue({ ClientName: 'Jane' })
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

    const file = new File(['content'], 'cv.txt', { type: 'text/plain' })
    const analyzeInput = screen.getByTestId('analyze-file-input')
    fireEvent.change(analyzeInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByLabelText('ClientName')).toHaveValue('Jane')
    })
  })

  it('shows analyzeError toast when analyzeSource throws', async () => {
    gemini.analyzeSource.mockRejectedValue(new Error('API down'))
    const onToast = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={onToast} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

    const file = new File(['content'], 'cv.txt', { type: 'text/plain' })
    const analyzeInput = screen.getByTestId('analyze-file-input')
    fireEvent.change(analyzeInput, { target: { files: [file] } })

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: expect.stringContaining('API down') })
      )
    )
  })

  it('shows analyzeError toast and does not call analyzeSource when API key is null', async () => {
    storage.getApiKey.mockResolvedValue(null)
    const onToast = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={onToast} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

    const file = new File(['content'], 'cv.txt', { type: 'text/plain' })
    const analyzeInput = screen.getByTestId('analyze-file-input')
    fireEvent.change(analyzeInput, { target: { files: [file] } })

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    )
    expect(gemini.analyzeSource).not.toHaveBeenCalled()
  })

  it('shows analyzeError toast when analyzeSource throws for oversized file', async () => {
    gemini.analyzeSource.mockRejectedValue(new Error('File too large (max 4 MB)'))
    const onToast = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={onToast} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

    const file = new File(['content'], 'big.png', { type: 'image/png' })
    const analyzeInput = screen.getByTestId('analyze-file-input')
    fireEvent.change(analyzeInput, { target: { files: [file] } })

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: expect.stringContaining('File too large') })
      )
    )
  })

  it('fills fields when file is dropped onto the Analyze button', async () => {
    gemini.analyzeSource.mockResolvedValue({ ClientName: 'Dropped' })
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

    const file = new File(['content'], 'cv.txt', { type: 'text/plain' })
    const analyzeBtn = screen.getByRole('button', { name: /analyze/i })
    fireEvent.drop(analyzeBtn, {
      dataTransfer: { files: [file] },
    })

    await waitFor(() => {
      expect(screen.getByLabelText('ClientName')).toHaveValue('Dropped')
    })
  })
})
```

- [ ] **Step 3: Run tests and confirm new ones fail**

```bash
npx vitest run src/test/pages/Generate.test.jsx
```

Expected: existing 9 tests still pass; 5 new `Analyze button` tests fail (button/input not found).

---

## Task 5: Implement Analyze button in Generate.jsx

**Files:**
- Modify: `src/pages/Generate.jsx`

- [ ] **Step 1: Replace the file contents**

Full updated `src/pages/Generate.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react'
import { generateDocx, generateXlsx, saveFile } from '../lib/templateEngine.js'
import { getTemplateBinary, getApiKey } from '../lib/storage.js'
import { analyzeSource } from '../lib/gemini.js'
import { useLanguage } from '../lib/i18n.jsx'

export default function Generate({ template, onBack, onToast }) {
  const { t, lang } = useLanguage()
  const [values, setValues] = useState({})
  const [generating, setGenerating] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [binary, setBinary] = useState(null)
  const [binaryError, setBinaryError] = useState(false)
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef(null)

  useEffect(() => {
    getTemplateBinary(template.id)
      .then(buf => {
        setBinary(buf)
        setLoading(false)
      })
      .catch(() => {
        onToast({ message: t('generate.errorNotFound'), type: 'error' })
        setBinaryError(true)
        setLoading(false)
      })
  }, [template.id])

  const handleChange = (name, value) => {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  const handleAnalyze = async (file) => {
    if (analyzing) return
    const apiKey = await getApiKey()
    if (!apiKey) {
      onToast({ message: t('generate.analyzeError'), type: 'error' })
      return
    }
    setAnalyzing(true)
    try {
      const matched = await analyzeSource(apiKey, file, template.fields, lang)
      setValues(prev => ({ ...prev, ...matched }))
    } catch (err) {
      onToast({ message: `${t('generate.analyzeError')} ${err.message}`, type: 'error' })
    } finally {
      setAnalyzing(false)
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const fieldValues = Object.fromEntries(
        template.fields.map(f => [f, values[f] ?? ''])
      )

      let blob
      if (template.sourceFormat === 'docx') {
        blob = await generateDocx(binary, fieldValues)
        await saveFile(blob, `${template.name}.docx`, template.sourceFormat)
      } else {
        blob = await generateXlsx(binary, fieldValues)
        await saveFile(blob, `${template.name}.xlsx`, template.sourceFormat)
      }
    } catch (err) {
      onToast({ message: `${t('generate.errorFailed')} ${err.message}`, type: 'error' })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-700 flex gap-2 items-center shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-600"
        >
          {t('generate.back')}
        </button>
        <span className="text-sm font-medium text-white truncate flex-1">{template.name}</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.docx,.txt"
          data-testid="analyze-file-input"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleAnalyze(file)
            e.target.value = ''
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const file = e.dataTransfer.files?.[0]
            if (file) handleAnalyze(file)
          }}
          disabled={loading || binaryError || analyzing}
          className="text-xs text-purple-400 hover:text-white px-2 py-1 rounded border border-purple-700 disabled:opacity-50 transition-colors"
        >
          {analyzing ? t('generate.analyzing') : t('generate.analyze')}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        {template.fields.map(name => {
          const description = template.fieldDescriptions?.[name]
          return (
            <div key={name} className="flex flex-col gap-1">
              <label htmlFor={`field-${name}`} className="text-xs text-gray-400 font-medium">
                {name}
              </label>
              {description && (
                <p className="text-xs text-gray-500 -mt-0.5">{description}</p>
              )}
              <input
                id={`field-${name}`}
                value={values[name] ?? ''}
                onChange={e => handleChange(name, e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                placeholder={`${t('generate.fieldPlaceholder')} ${name}…`}
              />
            </div>
          )
        })}
      </div>

      <div className="p-3 border-t border-gray-700 flex gap-2 items-center shrink-0">
        <button
          onClick={handleGenerate}
          disabled={loading || binaryError || generating}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-1.5 rounded transition-colors"
        >
          {generating ? t('generate.generating') : t('generate.download')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run all tests and confirm everything passes**

```bash
npx vitest run src/test/pages/Generate.test.jsx
npx vitest run src/test/lib/gemini.test.js
```

Expected: all tests pass.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all tests pass with no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Generate.jsx src/test/pages/Generate.test.jsx
git commit -m "feat: add Analyze button to Generate page"
```

---

## Done

All 5 tasks complete. The Analyze button is live in the header, accepts images/PDFs/DOCX/TXT, calls Gemini to extract field values, and auto-populates matched inputs. Unmatched fields remain empty for manual entry.
