import { describe, it, expect, vi } from 'vitest'

vi.mock('pizzip', () => {
  const PizZip = vi.fn().mockImplementation(() => ({
    generate: vi.fn(() => new Uint8Array([1, 2, 3])),
  }))
  return { default: PizZip }
})

vi.mock('docxtemplater', () => {
  const Docxtemplater = vi.fn().mockImplementation(() => ({
    render: vi.fn(),
    getZip: vi.fn().mockReturnValue({
      generate: vi.fn().mockResolvedValue(new Blob(['docx'])),
    }),
  }))
  return { default: Docxtemplater }
})

vi.mock('xlsx', () => ({
  read: vi.fn(),
  write: vi.fn(() => new Uint8Array([4, 5, 6])),
  utils: {
    book_new: vi.fn(() => ({})),
    aoa_to_sheet: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
}))

import { generateDocx, generateXlsx, downloadBlob } from '../../lib/templateEngine.js'
import * as XLSX from 'xlsx'

describe('generateDocx', () => {
  it('returns a Blob', async () => {
    const buffer = new ArrayBuffer(8)
    const blob = await generateDocx(buffer, { ClientName: 'Acme Corp' })
    expect(blob).toBeInstanceOf(Blob)
  })
})

describe('generateXlsx', () => {
  it('returns a Blob', async () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:A1',
          A1: { t: 's', v: '{{ClientName}}' },
        },
      },
    })
    const buffer = new ArrayBuffer(8)
    const blob = await generateXlsx(buffer, { ClientName: 'Acme Corp' })
    expect(blob).toBeInstanceOf(Blob)
  })

  it('replaces {{FieldName}} tokens with values', async () => {
    const sheet = {
      '!ref': 'A1:B1',
      A1: { t: 's', v: '{{ClientName}}' },
      B1: { t: 's', v: 'static value' },
    }
    XLSX.read.mockReturnValue({ SheetNames: ['Sheet1'], Sheets: { Sheet1: sheet } })
    const buffer = new ArrayBuffer(8)
    await generateXlsx(buffer, { ClientName: 'Acme Corp' })
    // After generateXlsx, the sheet object is mutated before XLSX.write is called
    expect(sheet.A1.v).toBe('Acme Corp')
    expect(sheet.B1.v).toBe('static value') // not a token, unchanged
  })

  it('does not export injectVariables', async () => {
    const mod = await import('../../lib/templateEngine.js')
    expect(mod.injectVariables).toBeUndefined()
  })
})

describe('downloadBlob', () => {
  it('creates an anchor and triggers click', () => {
    const mockAnchor = { href: '', download: '', click: vi.fn() }
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:url'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor)
    downloadBlob(new Blob(['test']), 'output.docx')
    expect(mockAnchor.download).toBe('output.docx')
    expect(mockAnchor.click).toHaveBeenCalled()
  })
})
