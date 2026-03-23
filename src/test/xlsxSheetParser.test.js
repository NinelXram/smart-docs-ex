import { parseXlsxSheets } from '../lib/renderers/xlsxSheetParser.js'

describe('parseXlsxSheets', () => {
  it('returns [] for empty string', () => {
    expect(parseXlsxSheets('')).toEqual([])
  })

  it('returns [] for null', () => {
    expect(parseXlsxSheets(null)).toEqual([])
  })

  it('returns [] when no <h3> tags present', () => {
    expect(parseXlsxSheets('<table><tr><td>foo</td></tr></table>')).toEqual([])
  })

  it('parses a single sheet — strips <h3>, keeps table', () => {
    const html = '<h3>Sheet1</h3><table><tr><td>foo</td></tr></table>'
    const result = parseXlsxSheets(html)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Sheet1')
    expect(result[0].html).toContain('<table>')
    expect(result[0].html).not.toContain('<h3>')
  })

  it('parses multiple sheets into correct entries', () => {
    const html =
      '<h3>Sheet1</h3><table><tr><td>A</td></tr></table>' +
      '<h3>Sheet2</h3><table><tr><td>B</td></tr></table>'
    const result = parseXlsxSheets(html)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Sheet1')
    expect(result[0].html).toContain('A')
    expect(result[1].name).toBe('Sheet2')
    expect(result[1].html).toContain('B')
    expect(result[0].html).not.toContain('B')
    expect(result[1].html).not.toContain('A')
  })

  it('decodes HTML-escaped sheet name but preserves escaped data-cell-address', () => {
    const html =
      '<h3>Q&amp;A</h3>' +
      '<table><tr><td data-cell-address="Q&amp;A!A1">val</td></tr></table>'
    const result = parseXlsxSheets(html)
    expect(result[0].name).toBe('Q&A')                          // decoded
    expect(result[0].html).toContain('data-cell-address="Q&amp;A!A1"')  // verbatim
  })

  it('returns entry with empty html for <h3> with no following elements', () => {
    const html = '<h3>Empty</h3>'
    const result = parseXlsxSheets(html)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Empty')
    expect(result[0].html).toBe('')
  })
})
