import { describe, it, expect, vi } from 'vitest'

vi.mock('xlsx', () => ({
  read: vi.fn(),
  utils: {
    sheet_to_csv: vi.fn(),
  },
}))

import { parseXlsx } from '../../../lib/parsers/xlsx.js'
import * as XLSX from 'xlsx'

describe('parseXlsx', () => {
  it('extracts text from a single sheet', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    })
    XLSX.utils.sheet_to_csv.mockReturnValue('Name,Date\nAlice,2024-01-01')

    const result = parseXlsx(new ArrayBuffer(8))
    expect(result.text).toBe('=== Sheet: Sheet1 ===\nName,Date\nAlice,2024-01-01')
    expect(result.sheets).toEqual(['Sheet1'])
  })

  it('joins multiple sheets with double newline', () => {
    XLSX.read.mockReturnValue({
      SheetNames: ['Data', 'Summary'],
      Sheets: { Data: {}, Summary: {} },
    })
    XLSX.utils.sheet_to_csv
      .mockReturnValueOnce('A,B')
      .mockReturnValueOnce('C,D')

    const result = parseXlsx(new ArrayBuffer(8))
    expect(result.text).toContain('=== Sheet: Data ===')
    expect(result.text).toContain('=== Sheet: Summary ===')
    expect(result.sheets).toEqual(['Data', 'Summary'])
  })

  it('passes correct options to XLSX.read', () => {
    XLSX.read.mockReturnValue({ SheetNames: [], Sheets: {} })
    const buffer = new ArrayBuffer(32)
    parseXlsx(buffer)
    expect(XLSX.read).toHaveBeenCalledWith(buffer, { type: 'array' })
  })
})
