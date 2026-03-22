import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/renderers/docx.js', () => ({
  renderDocx: vi.fn().mockResolvedValue({ html: '<p>doc</p>', binary: new ArrayBuffer(4) }),
}))
vi.mock('../../../lib/renderers/xlsx.js', () => ({
  renderXlsx: vi.fn().mockReturnValue({ html: '<table></table>', binary: new ArrayBuffer(4) }),
}))

import { renderFile } from '../../../lib/renderers/index.js'

describe('renderFile', () => {
  it('dispatches to renderDocx for .docx files', async () => {
    const file = {
      name: 'contract.docx',
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
    }
    const result = await renderFile(file)
    expect(result.format).toBe('docx')
    expect(result.html).toBe('<p>doc</p>')
  })

  it('dispatches to renderXlsx for .xlsx files', async () => {
    const file = {
      name: 'data.xlsx',
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
    }
    const result = await renderFile(file)
    expect(result.format).toBe('xlsx')
    expect(result.html).toBe('<table></table>')
  })

  it('throws for unsupported formats', async () => {
    const file = {
      name: 'report.pdf',
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    }
    await expect(renderFile(file)).rejects.toThrow('Unsupported format — use DOCX or XLSX')
  })
})
