import { describe, it, expect } from 'vitest'
import PizZip from 'pizzip'
import { insertDocx } from '../../lib/fieldEditor.js'

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
})
