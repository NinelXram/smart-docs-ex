import * as XLSX from 'xlsx'

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ html: string, binary: ArrayBuffer }}
 */
export function renderXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  let html = ''

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    html += `<h3>${escapeHtml(sheetName)}</h3>`
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
    let table = '<table>'
    for (let r = range.s.r; r <= range.e.r; r++) {
      table += '<tr>'
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c })
        const fullAddr = `${sheetName}!${cellRef}`
        const cell = ws[cellRef]
        const value = cell != null ? escapeHtml(String(cell.v ?? '')) : ''
        table += `<td data-cell-address="${escapeHtml(fullAddr)}">${value}</td>`
      }
      table += '</tr>'
    }
    table += '</table>'
    html += table
  }

  return { html, binary: buffer }
}
