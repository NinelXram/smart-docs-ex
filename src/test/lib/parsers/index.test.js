import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/parsers/pdf.js', () => ({
  parsePdf: vi.fn().mockResolvedValue({ text: 'pdf text', pageCount: 1 }),
  initPdfWorker: vi.fn(),
}))
vi.mock('../../../lib/parsers/docx.js', () => ({
  parseDocx: vi.fn().mockResolvedValue({ text: 'docx text' }),
}))
vi.mock('../../../lib/parsers/xlsx.js', () => ({
  parseXlsx: vi.fn().mockReturnValue({ text: 'xlsx text', sheets: ['Sheet1'] }),
}))

import { parseFile, SUPPORTED_EXTENSIONS } from '../../../lib/parsers/index.js'

const makeFile = (name, content = 'data') => {
  const file = new File([content], name, { type: 'application/octet-stream' })
  // Mock arrayBuffer method since Vitest File doesn't have it
  file.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(content.length))
  return file
}

describe('parseFile', () => {
  it('routes .pdf files to parsePdf', async () => {
    const result = await parseFile(makeFile('contract.pdf'))
    expect(result.text).toBe('pdf text')
    expect(result.format).toBe('pdf')
  })

  it('routes .docx files to parseDocx', async () => {
    const result = await parseFile(makeFile('contract.docx'))
    expect(result.text).toBe('docx text')
    expect(result.format).toBe('docx')
  })

  it('routes .xlsx files to parseXlsx', async () => {
    const result = await parseFile(makeFile('data.xlsx'))
    expect(result.text).toBe('xlsx text')
    expect(result.format).toBe('xlsx')
  })

  it('routes .xls files to parseXlsx', async () => {
    const result = await parseFile(makeFile('data.xls'))
    expect(result.format).toBe('xlsx')
  })

  it('throws for unsupported extensions', async () => {
    await expect(parseFile(makeFile('document.txt'))).rejects.toThrow(
      'Unsupported file format: .txt'
    )
  })
})

describe('SUPPORTED_EXTENSIONS', () => {
  it('includes pdf, docx, xlsx, xls', () => {
    expect(SUPPORTED_EXTENSIONS).toContain('.pdf')
    expect(SUPPORTED_EXTENSIONS).toContain('.docx')
    expect(SUPPORTED_EXTENSIONS).toContain('.xlsx')
    expect(SUPPORTED_EXTENSIONS).toContain('.xls')
  })
})
