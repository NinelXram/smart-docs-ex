import { describe, it, expect, vi, beforeEach } from 'vitest'
import PizZip from 'pizzip'

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

describe('renderXlsx — image placeholders', () => {
  it('marks cells with image anchors as placeholders', () => {
    // Build a real PizZip buffer containing drawing XML with an anchor at col=0, row=0
    const zip = new PizZip()
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`)
    zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`)
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`)
    zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">
  <xdr:oneCellAnchor>
    <xdr:from>
      <xdr:col>0</xdr:col>
      <xdr:row>0</xdr:row>
    </xdr:from>
  </xdr:oneCellAnchor>
</xdr:wsDr>`)
    const buffer = zip.generate({ type: 'arraybuffer' })

    // Stub XLSX.read to return a sheet with cell A1
    XLSX.utils.encode_cell.mockReset()
    XLSX.utils.encode_cell.mockReturnValue('A1')
    XLSX.read.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: {
        Sheet1: {
          '!ref': 'A1:A1',
          A1: { t: 's', v: 'sometext' },
        },
      },
    })
    XLSX.utils.decode_range.mockReturnValue({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } })

    const result = renderXlsx(buffer)
    expect(result.html).toContain('data-image-placeholder="true"')
    expect(result.html).toContain('[Image]')
  })
})
