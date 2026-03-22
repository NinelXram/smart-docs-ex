import { parsePdf } from './pdf.js'
import { parseDocx } from './docx.js'
import { parseXlsx } from './xlsx.js'

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.xls']

const EXT_TO_FORMAT = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
}

/**
 * @param {File} file
 * @returns {Promise<{ text: string, format: string }>}
 */
export async function parseFile(file) {
  const dotIdx = file.name.lastIndexOf('.')
  const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : ''
  const format = EXT_TO_FORMAT[ext]

  if (!format) throw new Error(`Unsupported file format: ${ext}`)

  const buffer = await file.arrayBuffer()

  if (format === 'pdf') {
    const result = await parsePdf(buffer)
    return { text: result.text, format }
  }
  if (format === 'docx') {
    const result = await parseDocx(buffer)
    return { text: result.text, format }
  }
  // xlsx or xls
  const result = parseXlsx(buffer)
  return { text: result.text, format }
}
