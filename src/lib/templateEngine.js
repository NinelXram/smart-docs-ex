import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import * as XLSX from 'xlsx'

/**
 * Generate a filled DOCX from a binary template with {{tokens}}.
 * @param {ArrayBuffer} binary — DOCX with {{FieldName}} tokens
 * @param {Record<string, string>} values — field values keyed by name
 * @returns {Promise<Blob>}
 */
export async function generateDocx(binary, values) {
  const zip = new PizZip(binary)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })
  doc.render(values)
  return await doc.getZip().generate({ type: 'blob' })
}

/**
 * Generate a filled XLSX from a binary template with {{tokens}} in cells.
 * @param {ArrayBuffer} binary — XLSX with {{FieldName}} token cells
 * @param {Record<string, string>} values — field values keyed by name
 * @returns {Promise<Blob>}
 */
export async function generateXlsx(binary, values) {
  const wb = XLSX.read(binary, { type: 'array' })

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    for (const cellRef in ws) {
      if (cellRef.startsWith('!')) continue
      const cell = ws[cellRef]
      if (cell && cell.t === 's' && typeof cell.v === 'string') {
        const match = cell.v.match(/^\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}$/)
        if (match && match[1] in values) {
          cell.v = values[match[1]]
        }
      }
    }
  }

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * Triggers a browser download of a Blob.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
