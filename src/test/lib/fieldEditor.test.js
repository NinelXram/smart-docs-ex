import { describe, it, expect } from 'vitest'
import PizZip from 'pizzip'
import * as XLSX from 'xlsx'
import { insertDocx, insertXlsx } from '../../lib/fieldEditor.js'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// Build a minimal DOCX binary with the given paragraphs (array of strings).
// Each paragraph becomes a single <w:p><w:r><w:t>text</w:t></w:r></w:p>.
function buildDocx(paragraphs) {
  const paras = paragraphs.map(text => {
    return `<w:p xmlns:w="${W_NS}"><w:r><w:t>${text}</w:t></w:r></w:p>`
  }).join('')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W_NS}">
  <w:body>${paras}</w:body>
</w:document>`
  const zip = new PizZip()
  zip.file('word/document.xml', xml)
  return zip.generate({ type: 'arraybuffer' })
}

// Build a DOCX where a paragraph has split runs (text split across multiple <w:r>).
function buildDocxSplitRuns(parts) {
  // parts is an array of strings; each becomes its own <w:r><w:t>...</w:t></w:r>
  const runs = parts.map(p => `<w:r><w:t xml:space="preserve">${p}</w:t></w:r>`).join('')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W_NS}">
  <w:body><w:p xmlns:w="${W_NS}">${runs}</w:p></w:body>
</w:document>`
  const zip = new PizZip()
  zip.file('word/document.xml', xml)
  return zip.generate({ type: 'arraybuffer' })
}

function readDocxXml(binary) {
  const zip = new PizZip(binary)
  return zip.files['word/document.xml'].asText()
}

describe('insertDocx', () => {
  it('replaces selected text with {{fieldName}} in a single-run paragraph', () => {
    const binary = buildDocx(['Agreement with Acme Corp hereinafter.'])
    const result = insertDocx(binary, 'Acme Corp', 0, 'ClientName')
    expect(result.error).toBeUndefined()
    const xml = readDocxXml(result.binary)
    expect(xml).toContain('{{ClientName}}')
    expect(xml).not.toContain('Acme Corp')
  })

  it('returns error when selected text is not found', () => {
    const binary = buildDocx(['Some other text.'])
    const result = insertDocx(binary, 'Missing Text', 0, 'Field')
    expect(result.error).toBe('text_not_found')
  })

  it('targets the correct paragraph by index', () => {
    const binary = buildDocx(['First paragraph.', 'Second paragraph.', 'Third paragraph.'])
    const result = insertDocx(binary, 'Second paragraph', 1, 'Middle')
    expect(result.error).toBeUndefined()
    const xml = readDocxXml(result.binary)
    expect(xml).toContain('{{Middle}}')
    expect(xml).toContain('First paragraph.')
    expect(xml).toContain('Third paragraph.')
    expect(xml).not.toContain('Second paragraph.')
  })

  it('handles run-split text (text spread across multiple <w:r> elements)', () => {
    // "John Smith" split as ["John ", "Smith"]
    const binary = buildDocxSplitRuns(['John ', 'Smith'])
    const result = insertDocx(binary, 'John Smith', 0, 'FullName')
    expect(result.error).toBeUndefined()
    const xml = readDocxXml(result.binary)
    expect(xml).toContain('{{FullName}}')
    expect(xml).not.toContain('John ')
    expect(xml).not.toContain('>Smith<')
  })

  it('handles partial-run selection (selectedText starts mid-run)', () => {
    // Run contains "Mr. John Smith here." but we select only "John Smith"
    const binary = buildDocx(['Mr. John Smith here.'])
    const result = insertDocx(binary, 'John Smith', 0, 'FullName')
    expect(result.error).toBeUndefined()
    const xml = readDocxXml(result.binary)
    expect(xml).toContain('{{FullName}}')
    expect(xml).toContain('Mr. ')
    expect(xml).toContain(' here.')
  })

  it('uses first occurrence when selectedText appears twice in the paragraph', () => {
    const binary = buildDocx(['AAA and AAA.'])
    const result = insertDocx(binary, 'AAA', 0, 'Tag')
    expect(result.error).toBeUndefined()
    const xml = readDocxXml(result.binary)
    // Second AAA should remain; first should be replaced
    expect(xml).toContain('{{Tag}}')
    expect(xml).toContain('AAA')
    // Count occurrences of 'AAA' in the output
    const remaining = (xml.match(/AAA/g) || []).length
    expect(remaining).toBe(1) // only the second one remains
  })

  it('returns error for out-of-range paragraphIndex', () => {
    const binary = buildDocx(['Only one paragraph.'])
    const result = insertDocx(binary, 'Only one', 5, 'Field')
    expect(result.error).toBe('paragraph_index_out_of_range')
  })

  it('returns error for negative paragraphIndex', () => {
    const binary = buildDocx(['Only one paragraph.'])
    const result = insertDocx(binary, 'Only one', -1, 'Field')
    expect(result.error).toBe('paragraph_index_out_of_range')
  })

  it('returns error when word/document.xml is missing', () => {
    const zip = new PizZip()
    zip.file('word/styles.xml', '<w:styles/>')
    const binary = zip.generate({ type: 'arraybuffer' })
    const result = insertDocx(binary, 'anything', 0, 'Field')
    expect(result.error).toBe('no_body')
  })
})

function buildXlsx(sheets) {
  // sheets: { sheetName: { cellRef: value } }
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

describe('insertXlsx', () => {
  it('replaces cell value with {{fieldName}}', () => {
    const binary = buildXlsx({ Sheet1: { B3: '$75,000' } })
    const result = insertXlsx(binary, 'Sheet1!B3', 'ContractValue')
    expect(result.error).toBeUndefined()
    expect(readXlsxCell(result.binary, 'Sheet1', 'B3')).toBe('{{ContractValue}}')
  })

  it('preserves cell type as string', () => {
    const binary = buildXlsx({ Sheet1: { A1: '2024-01-01' } })
    const result = insertXlsx(binary, 'Sheet1!A1', 'EffectiveDate')
    const wb = XLSX.read(result.binary, { type: 'array' })
    expect(wb.Sheets['Sheet1']['A1'].t).toBe('s')
  })

  it('returns error for invalid cell address format', () => {
    const binary = buildXlsx({ Sheet1: { A1: 'x' } })
    const result = insertXlsx(binary, 'B3', 'Field') // missing sheet name
    expect(result.error).toBe('invalid_cell_address')
  })

  it('returns error when sheet is not found', () => {
    const binary = buildXlsx({ Sheet1: { A1: 'x' } })
    const result = insertXlsx(binary, 'MissingSheet!A1', 'Field')
    expect(result.error).toBe('sheet_not_found')
  })
})
