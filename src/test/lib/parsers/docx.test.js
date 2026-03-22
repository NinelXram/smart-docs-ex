import { describe, it, expect, vi } from 'vitest'

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
}))

import { parseDocx } from '../../../lib/parsers/docx.js'
import mammoth from 'mammoth'

describe('parseDocx', () => {
  it('extracts raw text from a DOCX buffer', async () => {
    mammoth.extractRawText.mockResolvedValue({
      value: 'This is the contract text.',
      messages: [],
    })
    const result = await parseDocx(new ArrayBuffer(8))
    expect(result.text).toBe('This is the contract text.')
  })

  it('passes the arrayBuffer option to mammoth', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: '', messages: [] })
    const buffer = new ArrayBuffer(16)
    await parseDocx(buffer)
    expect(mammoth.extractRawText).toHaveBeenCalledWith({ arrayBuffer: buffer })
  })

  it('returns empty string when mammoth returns empty value', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: '', messages: [] })
    const result = await parseDocx(new ArrayBuffer(8))
    expect(result.text).toBe('')
  })
})
