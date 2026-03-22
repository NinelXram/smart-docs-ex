import * as XLSX from 'xlsx'

/**
 * Injects variable values into rawContent using marker-based replacement.
 * @param {string} rawContent
 * @param {Array<{name: string, marker: string}>} variables
 * @param {Record<string, string>} values  — keyed by variable name
 * @returns {{ content: string, warnings: string[] }}
 */
export function injectVariables(rawContent, variables, values) {
  let content = rawContent
  const warnings = []

  for (const { name, marker } of variables) {
    const value = values[name] ?? ''

    if (!marker.includes('[VALUE]')) {
      warnings.push(`Variable "${name}" has a malformed marker (no [VALUE] token) — skipped`)
      continue
    }

    const occurrences = countOccurrences(content, marker)
    if (occurrences === 0) {
      warnings.push(`Variable "${name}" marker not found in document — skipped`)
      continue
    }
    if (occurrences > 1) {
      warnings.push(
        `Variable "${name}" marker appears ${occurrences} times — replaced first occurrence`
      )
    }

    // Use indexOf + slice instead of String.replace to avoid special-character
    // corruption (e.g. '$5,000' contains '$' which String.replace treats specially).
    const pos = content.indexOf(marker)
    const filledMarker = marker.slice(0, marker.indexOf('[VALUE]')) + value + marker.slice(marker.indexOf('[VALUE]') + '[VALUE]'.length)
    content = content.slice(0, pos) + filledMarker + content.slice(pos + marker.length)
  }

  return { content, warnings }
}

function countOccurrences(text, pattern) {
  let count = 0
  let pos = 0
  while ((pos = text.indexOf(pattern, pos)) !== -1) {
    count++
    pos += pattern.length
  }
  return count
}

// Stubs for removed jspdf / docx packages — will be replaced in Task 8.

/** @returns {Promise<Blob>} */
export async function generatePdf(_content) {
  throw new Error('PDF generation removed. Use DOCX or XLSX.')
}

/** @returns {Promise<Blob>} */
export async function generateDocx(_content) {
  throw new Error('generateDocx not yet implemented with new renderer.')
}

/**
 * @param {string} content  — rows separated by \n, columns by comma (CSV-like)
 * @returns {Promise<Blob>}
 */
export async function generateXlsx(content) {
  const rows = content.split('\n').map(line => [line])
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new Blob([buffer], {
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
