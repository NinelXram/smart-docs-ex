import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateContent = vi.fn()
const mockGetGenerativeModel = vi.fn(() => ({ generateContent: mockGenerateContent }))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}))

import { testConnection, extractVariables, MAX_CHARS } from '../../lib/gemini.js'

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
