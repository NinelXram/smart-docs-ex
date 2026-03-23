import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateContent = vi.fn()
const mockGetGenerativeModel = vi.fn(() => ({ generateContent: mockGenerateContent }))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}))

vi.mock('mammoth', () => ({
  extractRawText: vi.fn(),
}))

import * as mammoth from 'mammoth'
import { testConnection, extractVariables, MAX_CHARS, suggestFieldName, suggestFieldPattern, analyzeSource } from '../../lib/gemini.js'

const VALID_KEY = 'test-api-key'
const SAMPLE_VARS = [
  { name: 'ClientName', marker: 'made with [VALUE] hereinafter' },
  { name: 'EffectiveDate', marker: 'effective as of [VALUE] between' },
]

beforeEach(() => {
  mockGenerateContent.mockReset()
})

describe('testConnection', () => {
  it('returns true when the API call succeeds', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'OK' } })
    expect(await testConnection(VALID_KEY)).toBe(true)
  })

  it('throws when the API call fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Invalid API key'))
    await expect(testConnection(VALID_KEY)).rejects.toThrow('Invalid API key')
  })
})

describe('extractVariables', () => {
  it('returns parsed variables from a valid JSON response', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify(SAMPLE_VARS) },
    })
    const result = await extractVariables(VALID_KEY, 'some document content')
    expect(result).toEqual(SAMPLE_VARS)
  })

  it('strips markdown code fences before parsing', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '```json\n' + JSON.stringify(SAMPLE_VARS) + '\n```' },
    })
    const result = await extractVariables(VALID_KEY, 'content')
    expect(result).toEqual(SAMPLE_VARS)
  })

  it('filters out variables whose marker has no [VALUE] token', async () => {
    const malformed = [
      { name: 'Good', marker: 'good [VALUE] marker' },
      { name: 'Bad', marker: 'no value token here' },
    ]
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify(malformed) },
    })
    const result = await extractVariables(VALID_KEY, 'content')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Good')
  })

  it('retries once on malformed JSON and throws MALFORMED_RESPONSE on second failure', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'not json at all' },
    })
    await expect(extractVariables(VALID_KEY, 'content')).rejects.toThrow(
      'MALFORMED_RESPONSE'
    )
    expect(mockGenerateContent).toHaveBeenCalledTimes(2)
  })

  it('throws when content exceeds MAX_CHARS', async () => {
    const oversized = 'a'.repeat(MAX_CHARS + 1)
    await expect(extractVariables(VALID_KEY, oversized)).rejects.toThrow(
      'Document too large'
    )
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })

  it('throws MALFORMED_RESPONSE when Gemini returns a non-array', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"not": "an array"}' },
    })
    await expect(extractVariables(VALID_KEY, 'content')).rejects.toThrow(
      'MALFORMED_RESPONSE'
    )
  })
})

describe('suggestFieldName', () => {
  it('returns a valid camelCase field name from AI response', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => '{"fieldName":"ContractValue","description":"contract value"}' } })
    const result = await suggestFieldName('key', '$75,000', 'value shall be $75,000 payable', [])
    expect(result).toEqual({ fieldName: 'ContractValue', description: 'contract value' })
  })

  it('includes selectedText, surroundingContext, and existingFields in the prompt', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => '{"fieldName":"FieldName","description":""}' } })
    await suggestFieldName('key', 'Alice', 'name is Alice here', ['ExistingField'])
    const call = mockGenerateContent.mock.calls[0][0]
    expect(call).toContain('"Alice"')
    expect(call).toContain('name is Alice here')
    expect(call).toContain('ExistingField')
  })

  it('returns null when AI response fails validation (not camelCase)', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'not valid!' } })
    const result = await suggestFieldName('key', 'text', 'ctx', [])
    expect(result).toBeNull()
  })

  it('throws when API call fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Network error'))
    await expect(suggestFieldName('key', 'text', 'ctx', [])).rejects.toThrow('Network error')
  })

  it('throws on timeout after 10 seconds', async () => {
    vi.useFakeTimers()
    mockGenerateContent.mockReturnValue(new Promise(() => {})) // never resolves
    const promise = suggestFieldName('key', 'text', 'ctx', [])
    vi.advanceTimersByTime(10001)
    await expect(promise).rejects.toThrow('timeout')
    vi.useRealTimers()
  })

  it('returns null when response is empty string', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => '  ' } })
    const result = await suggestFieldName('key', 'text', 'ctx', [])
    expect(result).toBeNull()
  })
})

describe('lang param — Vietnamese instruction', () => {
  it('suggestFieldName appends Vietnamese instruction when lang=vi', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"fieldName":"clientName","description":"tên khách hàng"}' },
    })
    await suggestFieldName('key', 'Nguyen Van A', 'context', [], 'vi')
    const prompt = mockGenerateContent.mock.calls[0][0]
    expect(prompt).toContain('Respond in Vietnamese.')
  })

  it('suggestFieldName does NOT append instruction when lang=en', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"fieldName":"clientName","description":"client name"}' },
    })
    await suggestFieldName('key', 'John Doe', 'context', [], 'en')
    const prompt = mockGenerateContent.mock.calls[0][0]
    expect(prompt).not.toContain('Respond in Vietnamese.')
  })

  it('suggestFieldPattern appends Vietnamese instruction when lang=vi', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '{"label":"Name: ","value":"Nguyen Van A","fieldName":"clientName","description":"tên"}' },
    })
    await suggestFieldPattern('key', 'Name: Nguyen Van A', 'Nguyen Van A', [], '', 'vi')
    const prompt = mockGenerateContent.mock.calls[0][0]
    expect(prompt).toContain('Respond in Vietnamese.')
  })

  it('extractVariables appends Vietnamese instruction when lang=vi', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '[{"name":"clientName","marker":"agreement with [VALUE] herein"}]' },
    })
    await extractVariables('key', 'some document content', 'vi')
    const prompt = mockGenerateContent.mock.calls[0][0]
    expect(prompt).toContain('Respond in Vietnamese.')
  })
})

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
