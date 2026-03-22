import { renderDocx } from './docx.js'
import { renderXlsx } from './xlsx.js'

/**
 * @param {File} file
 * @returns {Promise<{ html: string, binary: ArrayBuffer, format: string }>}
 */
export async function renderFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  const buffer = await file.arrayBuffer()

  if (ext === 'docx') {
    const { html, binary } = await renderDocx(buffer)
    return { html, binary, format: 'docx' }
  }
  if (ext === 'xlsx') {
    const { html, binary } = renderXlsx(buffer)
    return { html, binary, format: 'xlsx' }
  }
  throw new Error('Unsupported format — use DOCX or XLSX')
}
