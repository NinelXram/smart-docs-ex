import XLSX from 'xlsx'

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ text: string, sheets: string[] }}
 */
export function parseXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const parts = []

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(ws)
    parts.push(`=== Sheet: ${sheetName} ===\n${csv}`)
  }

  return {
    text: parts.join('\n\n'),
    sheets: wb.SheetNames,
  }
}
