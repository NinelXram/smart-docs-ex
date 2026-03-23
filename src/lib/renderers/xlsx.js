import * as XLSX from 'xlsx'
import PizZip from 'pizzip'

const XDR_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Detect image anchor positions from XLSX drawing XML.
 * Returns a Map<sheetName, Set<"col,row">> of anchor positions.
 * Degrades gracefully if buffer is not a valid zip.
 */
function buildImageAnchors(buffer, sheetNames) {
  const anchors = new Map(sheetNames.map(n => [n, new Set()]))
  let zip
  try {
    zip = new PizZip(buffer)
  } catch {
    return anchors
  }

  // Parse workbook.xml to get sheet r:id mapping
  const wbXml = zip.files['xl/workbook.xml']?.asText()
  if (!wbXml) return anchors
  const parser = new DOMParser()
  const wbDoc = parser.parseFromString(wbXml, 'application/xml')
  const sheetEls = Array.from(wbDoc.getElementsByTagName('sheet'))

  // Parse xl/_rels/workbook.xml.rels to get sheet file paths
  const wbRelsXml = zip.files['xl/_rels/workbook.xml.rels']?.asText()
  if (!wbRelsXml) return anchors
  const wbRelsDoc = parser.parseFromString(wbRelsXml, 'application/xml')
  const wbRels = Array.from(wbRelsDoc.getElementsByTagName('Relationship'))

  for (const sheetEl of sheetEls) {
    const sheetName = sheetEl.getAttribute('name')
    if (!sheetName || !anchors.has(sheetName)) continue
    const rId = sheetEl.getAttribute('r:id')
    if (!rId) continue

    const relEl = wbRels.find(r => r.getAttribute('Id') === rId)
    if (!relEl) continue
    const target = relEl.getAttribute('Target') // e.g. "worksheets/sheet1.xml"

    // Find drawing relationship for this sheet
    const sheetBase = target.split('/').pop() // "sheet1.xml"
    const sheetRelsPath = `xl/worksheets/_rels/${sheetBase}.rels`
    const sheetRelsXml = zip.files[sheetRelsPath]?.asText()
    if (!sheetRelsXml) continue
    const sheetRelsDoc = parser.parseFromString(sheetRelsXml, 'application/xml')
    const sheetRels = Array.from(sheetRelsDoc.getElementsByTagName('Relationship'))
    const drawingRel = sheetRels.find(r =>
      r.getAttribute('Type')?.endsWith('/drawing')
    )
    if (!drawingRel) continue

    const drawingTarget = drawingRel.getAttribute('Target') // e.g. "../drawings/drawing1.xml"
    const drawingPath = `xl/drawings/${drawingTarget.split('/').pop()}`
    const drawingXml = zip.files[drawingPath]?.asText()
    if (!drawingXml) continue

    const drawingDoc = parser.parseFromString(drawingXml, 'application/xml')
    const fromEls = Array.from(drawingDoc.getElementsByTagNameNS(XDR_NS, 'from'))
    for (const fromEl of fromEls) {
      const colEls = fromEl.getElementsByTagNameNS(XDR_NS, 'col')
      const rowEls = fromEl.getElementsByTagNameNS(XDR_NS, 'row')
      const col = parseInt(colEls[0]?.textContent ?? '-1', 10)
      const row = parseInt(rowEls[0]?.textContent ?? '-1', 10)
      if (col >= 0 && row >= 0) {
        anchors.get(sheetName).add(`${col},${row}`)
      }
    }
  }

  return anchors
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ html: string, binary: ArrayBuffer }}
 */
export function renderXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const imageAnchors = buildImageAnchors(buffer, wb.SheetNames)
  let html = ''

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    html += `<h3>${escapeHtml(sheetName)}</h3>`
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
    const anchorSet = imageAnchors.get(sheetName) ?? new Set()
    let table = '<table>'
    for (let r = range.s.r; r <= range.e.r; r++) {
      table += '<tr>'
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c })
        const fullAddr = `${sheetName}!${cellRef}`
        const cell = ws[cellRef]
        const isImageCell = anchorSet.has(`${c},${r}`)
        if (isImageCell) {
          table += `<td data-cell-address="${escapeHtml(fullAddr)}" data-image-placeholder="true"><span>[Image]</span></td>`
        } else {
          const value = cell != null ? escapeHtml(String(cell.v ?? '')) : ''
          table += `<td data-cell-address="${escapeHtml(fullAddr)}">${value}</td>`
        }
      }
      table += '</tr>'
    }
    table += '</table>'
    html += table
  }

  return { html, binary: buffer }
}
