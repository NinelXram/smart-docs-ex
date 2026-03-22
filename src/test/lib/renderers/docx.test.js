import { describe, it, expect, vi } from 'vitest'

vi.mock('mammoth', () => ({
  default: {
    convertToHtml: vi.fn(),
  },
}))

import { renderDocx } from '../../../lib/renderers/docx.js'
import mammoth from 'mammoth'

describe('renderDocx', () => {
  it('returns html from mammoth and passes binary through unchanged', async () => {
    mammoth.convertToHtml.mockResolvedValue({ value: '<p>Hello World</p>', messages: [] })
    const buffer = new ArrayBuffer(8)
    const result = await renderDocx(buffer)
    expect(result.html).toBe('<p>Hello World</p>')
    expect(result.binary).toBe(buffer)
  })

  it('passes arrayBuffer option to mammoth', async () => {
    mammoth.convertToHtml.mockResolvedValue({ value: '', messages: [] })
    const buffer = new ArrayBuffer(16)
    await renderDocx(buffer)
    expect(mammoth.convertToHtml).toHaveBeenCalledWith({ arrayBuffer: buffer })
  })
})
