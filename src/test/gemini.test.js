// src/test/gemini.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Gemini SDK before importing the module under test
const mockGenerateContent = vi.fn()
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      generateContent: mockGenerateContent,
    })),
  })),
}))

import { suggestFieldPattern } from '../lib/gemini.js'

const API_KEY = 'test-key'

beforeEach(() => {
  vi.clearAllMocks()
})

function mockGemini(jsonPayload) {
  mockGenerateContent.mockResolvedValueOnce({
    response: { text: () => JSON.stringify(jsonPayload) },
  })
}

describe('suggestFieldPattern', () => {
  it('returns label, value, fieldName from valid Gemini response', async () => {
    mockGemini({ label: 'Name: ', value: 'Bao Huynh', fieldName: 'name' })
    const result = await suggestFieldPattern(API_KEY, 'Name: Bao Huynh', '', [])
    expect(result).toEqual({ label: 'Name: ', value: 'Bao Huynh', fieldName: 'name' })
  })

  it('returns empty label when Gemini finds no prefix', async () => {
    mockGemini({ label: '', value: 'Bao Huynh', fieldName: 'fullName' })
    const result = await suggestFieldPattern(API_KEY, 'Bao Huynh', '', [])
    expect(result).toEqual({ label: '', value: 'Bao Huynh', fieldName: 'fullName' })
  })

  it('falls back to label="" when label+value does not equal fullCellText', async () => {
    mockGemini({ label: 'Wrong: ', value: 'Data', fieldName: 'myField' })
    const result = await suggestFieldPattern(API_KEY, 'Name: Bao Huynh', '', [])
    expect(result.label).toBe('')
    expect(result.value).toBe('Name: Bao Huynh')
    expect(result.fieldName).toBe('myField')
  })

  it('falls back when Gemini returns malformed JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'not json at all' },
    })
    const result = await suggestFieldPattern(API_KEY, 'Name: Bao Huynh', '', [])
    expect(result.label).toBe('')
    expect(result.value).toBe('Name: Bao Huynh')
    expect(typeof result.fieldName).toBe('string')
  })

  it('sanitizes fieldName when it fails the regex', async () => {
    mockGemini({ label: 'Name: ', value: 'Bao Huynh', fieldName: '123-invalid!' })
    const result = await suggestFieldPattern(API_KEY, 'Name: Bao Huynh', '', [])
    expect(result.fieldName).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/)
  })

  it('throws when Gemini call exceeds 10 seconds', async () => {
    vi.useFakeTimers()
    mockGenerateContent.mockImplementationOnce(
      () => new Promise(resolve => setTimeout(resolve, 15_000))
    )
    const promise = suggestFieldPattern(API_KEY, 'Name: Bao Huynh', '', [])
    vi.advanceTimersByTime(10_001)
    await expect(promise).rejects.toThrow()
    vi.useRealTimers()
  })

  it('includes selectedText line in prompt when provided', async () => {
    mockGemini({ label: 'Name: ', value: 'Bao Huynh', fieldName: 'name' })
    await suggestFieldPattern(API_KEY, 'Name: Bao Huynh', 'Bao Huynh', [])
    const promptArg = mockGenerateContent.mock.calls[0][0]
    expect(promptArg).toContain('User selected:')
    expect(promptArg).toContain('Bao Huynh')
  })

  it('omits selectedText line when selectedText is empty', async () => {
    mockGemini({ label: 'Name: ', value: 'Bao Huynh', fieldName: 'name' })
    await suggestFieldPattern(API_KEY, 'Name: Bao Huynh', '', [])
    const promptArg = mockGenerateContent.mock.calls[0][0]
    expect(promptArg).not.toContain('User selected:')
  })
})
