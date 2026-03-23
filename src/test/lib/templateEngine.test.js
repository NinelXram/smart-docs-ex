import { describe, it, expect, vi, beforeEach } from 'vitest'
import PizZip from 'pizzip'
import * as XLSX from 'xlsx'
import { generateDocx, generateXlsx, saveFile } from '../../lib/templateEngine.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(blob)
  })
}

// ─── XLSX fixture helpers ───────────────────────────────────────────────────

function buildXlsx(sheets) {
  const wb = XLSX.utils.book_new()
  for (const [name, cells] of Object.entries(sheets)) {
    const ws = {}
    let maxR = 0, maxC = 0
    for (const [ref, val] of Object.entries(cells)) {
      const decoded = XLSX.utils.decode_cell(ref)
      maxR = Math.max(maxR, decoded.r)
      maxC = Math.max(maxC, decoded.c)
      ws[ref] = { t: 's', v: String(val) }
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } })
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return buf.buffer ?? buf
}

function readXlsxCell(binary, sheetName, cellRef) {
  const wb = XLSX.read(binary, { type: 'array' })
  return wb.Sheets[sheetName]?.[cellRef]?.v
}

// Build a PizZip-level XLSX fixture with a drawing entry and a token cell (t="s" shared string)
function buildXlsxWithToken(tokenCell = 'A1', fieldName = 'ClientName') {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`)
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="${tokenCell}" t="s"><v>0</v></c></row>
  </sheetData>
</worksheet>`)
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1">
  <si><t>{{${fieldName}}}</t></si>
</sst>`)
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8"?><root/>`)
  return zip.generate({ type: 'arraybuffer' })
}

// Build a minimal valid ZIP (PizZip-compatible) for generateDocx tests
function buildMinimalDocx() {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  return zip.generate({ type: 'arraybuffer' })
}

// ─── generateDocx ────────────────────────────────────────────────────────────

vi.mock('docxtemplater', () => {
  const Docxtemplater = vi.fn().mockImplementation(() => ({
    render: vi.fn(),
    getZip: vi.fn().mockReturnValue({
      generate: vi.fn().mockResolvedValue(new Blob(['docx'])),
    }),
  }))
  return { default: Docxtemplater }
})

describe('generateDocx', () => {
  it('returns a Blob', async () => {
    const buffer = buildMinimalDocx()
    const blob = await generateDocx(buffer, { ClientName: 'Acme Corp' })
    expect(blob).toBeInstanceOf(Blob)
  })
})

// ─── generateXlsx ────────────────────────────────────────────────────────────

describe('generateXlsx', () => {
  it('returns a Blob', async () => {
    const binary = buildXlsxWithToken()
    const blob = await generateXlsx(binary, { ClientName: 'Acme Corp' })
    expect(blob).toBeInstanceOf(Blob)
  })

  it('replaces {{FieldName}} shared-string token with value', async () => {
    const binary = buildXlsxWithToken('A1', 'ClientName')
    const blob = await generateXlsx(binary, { ClientName: 'Acme Corp' })
    const buf = await blobToArrayBuffer(blob)
    expect(readXlsxCell(buf, 'Sheet1', 'A1')).toBe('Acme Corp')
  })

  it('leaves non-token cells unchanged', async () => {
    const zip = new PizZip()
    zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`)
    zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
    zip.file('xl/workbook.xml', `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`)
    zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`)
    zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>`)
    zip.file('xl/sharedStrings.xml', `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>{{ClientName}}</t></si><si><t>Static Value</t></si></sst>`)
    const binary = zip.generate({ type: 'arraybuffer' })

    const blob = await generateXlsx(binary, { ClientName: 'Acme Corp' })
    const buf = await blobToArrayBuffer(blob)
    expect(readXlsxCell(buf, 'Sheet1', 'A1')).toBe('Acme Corp')
    expect(readXlsxCell(buf, 'Sheet1', 'B1')).toBe('Static Value')
  })

  it('preserves drawing entry in the output zip', async () => {
    const binary = buildXlsxWithToken()
    const blob = await generateXlsx(binary, { ClientName: 'Acme Corp' })
    const buf = await blobToArrayBuffer(blob)
    const outZip = new PizZip(buf)
    expect(Object.keys(outZip.files)).toContain('xl/drawings/drawing1.xml')
  })

  it('does not export injectVariables', async () => {
    const mod = await import('../../lib/templateEngine.js')
    expect(mod.injectVariables).toBeUndefined()
  })
})

// ─── saveFile ────────────────────────────────────────────────────────────────

describe('saveFile', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:url'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('calls showSaveFilePicker when available', async () => {
    const mockWritable = { write: vi.fn(), close: vi.fn() }
    const mockHandle = { createWritable: vi.fn().mockResolvedValue(mockWritable) }
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue(mockHandle))

    await saveFile(new Blob(['test']), 'output.xlsx', 'xlsx')
    expect(window.showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'output.xlsx' })
    )
    expect(mockWritable.write).toHaveBeenCalled()
    expect(mockWritable.close).toHaveBeenCalled()
  })

  it('silently ignores AbortError from showSaveFilePicker', async () => {
    const abort = Object.assign(new Error('User cancelled'), { name: 'AbortError' })
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(abort))
    await expect(saveFile(new Blob(['test']), 'output.xlsx', 'xlsx')).resolves.toBeUndefined()
  })

  it('propagates non-AbortError from showSaveFilePicker', async () => {
    const err = new Error('Disk full')
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(err))
    await expect(saveFile(new Blob(['test']), 'output.xlsx', 'xlsx')).rejects.toThrow('Disk full')
  })

  it('falls back to anchor download when showSaveFilePicker is unavailable', async () => {
    vi.stubGlobal('showSaveFilePicker', undefined)
    const mockAnchor = { href: '', download: '', click: vi.fn() }
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor)
    await saveFile(new Blob(['test']), 'output.docx', 'docx')
    expect(mockAnchor.download).toBe('output.docx')
    expect(mockAnchor.click).toHaveBeenCalled()
  })
})
