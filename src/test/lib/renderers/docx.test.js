import { describe, it, expect, vi } from 'vitest'

vi.mock('docx-preview', () => ({
  renderAsync: vi.fn(async (_buf, container) => {
    container.innerHTML = '<p>Hello</p><p>World</p>'
  }),
}))

import * as docx from 'docx-preview'
import { renderDocx } from '../../../lib/renderers/docx.js'

describe('renderDocx', () => {
  it('returns the original buffer as binary unchanged', async () => {
    const buffer = new ArrayBuffer(8)
    const result = await renderDocx(buffer)
    expect(result.binary).toBe(buffer)
  })

  it('adds data-paragraph-index attributes to all paragraphs', async () => {
    const buffer = new ArrayBuffer(8)
    const result = await renderDocx(buffer)
    expect(result.html).toContain('data-paragraph-index="0"')
    expect(result.html).toContain('data-paragraph-index="1"')
  })
})
