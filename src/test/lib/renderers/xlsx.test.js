import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('xlsx', () => ({
  read: vi.fn(),
  utils: {
    encode_cell: vi.fn(),
    decode_range: vi.fn(),
  },
}))

import { renderXlsx } from '../../../lib/renderers/xlsx.js'
import * as XLSX from 'xlsx'

describe('renderXlsx', () => {
  beforeEach(() => {
    // Reset mocks to clear mockReturnValueOnce queue
    XLSX.utils.encode_cell.mockReset()
    XLSX.utils.decode_range.mockReset()

    XLSX.utils.decode_range.mockReturnValue({ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } })
    XLSX.utils.encode_cell
      .mockReturnValueOnce('A1').mockReturnValueOnce('B1')
      .mockReturnValueOnce('A2').mockReturnValueOnce('B2')
  })

  it('returns binary as the original input buffer unchanged', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:B2',
          A1: { v: 'Name', t: 's' },
          B1: { v: 'Date', t: 's' },
          A2: { v: 'Alice', t: 's' },
          B2: { v: '2024-01-01', t: 's' },
        },
      },
    })
    const buffer = new ArrayBuffer(8)
    const result = renderXlsx(buffer)
    expect(result.binary).toBe(buffer)
  })

  it('produces html table with data-cell-address attributes', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:B2',
          A1: { v: 'Name', t: 's' },
          B1: { v: 'Date', t: 's' },
          A2: { v: 'Alice', t: 's' },
          B2: { v: '2024-01-01', t: 's' },
        },
      },
    })
    const buffer = new ArrayBuffer(8)
    const result = renderXlsx(buffer)
    expect(result.html).toContain('data-cell-address="Sheet1!A1"')
    expect(result.html).toContain('data-cell-address="Sheet1!B2"')
    expect(result.html).toContain('>Name<')
    expect(result.html).toContain('>Alice<')
  })

  it('includes sheet name as h3 heading for each sheet', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Data', 'Summary'],
      Sheets: {
        Data: { '!ref': 'A1:A1', A1: { v: 'x', t: 's' } },
        Summary: { '!ref': 'A1:A1', A1: { v: 'y', t: 's' } },
      },
    })
    XLSX.utils.decode_range
      .mockReturnValueOnce({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } })
      .mockReturnValueOnce({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } })
    XLSX.utils.encode_cell.mockReturnValue('A1')
    const result = renderXlsx(new ArrayBuffer(8))
    expect(result.html).toContain('<h3>Data</h3>')
    expect(result.html).toContain('<h3>Summary</h3>')
  })

  it('renders empty string for missing cells', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: { '!ref': 'A1:A1' } }, // A1 missing (undefined)
    })
    XLSX.utils.decode_range.mockReturnValue({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } })
    XLSX.utils.encode_cell.mockReturnValue('A1')
    const result = renderXlsx(new ArrayBuffer(8))
    expect(result.html).toContain('data-cell-address="Sheet1!A1"')
    expect(result.html).toContain('></td>')
  })

  it('escapes HTML in cell values and sheet names', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['<Sheet>'],
      Sheets: {
        '<Sheet>': {
          '!ref': 'A1:A1',
          A1: { v: '<b>bold</b>', t: 's' },
        },
      },
    })
    XLSX.utils.decode_range.mockReturnValue({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } })
    XLSX.utils.encode_cell.mockReturnValue('A1')
    const result = renderXlsx(new ArrayBuffer(8))
    expect(result.html).not.toContain('<b>')
    expect(result.html).toContain('&lt;b&gt;')
    expect(result.html).toContain('&lt;Sheet&gt;')
  })
})
