import PizZip from 'pizzip'

/**
 * Generate a filled DOCX from a binary template with {{tokens}}.
 * Uses direct regex replacement in word/document.xml — avoids docxtemplater
 * split-tag issues caused by XMLSerializer namespace re-declarations.
 */
export async function generateDocx(binary, values) {
  const zip = new PizZip(binary)

  const xmlFiles = ['word/document.xml', 'word/header1.xml', 'word/footer1.xml',
    'word/header2.xml', 'word/footer2.xml', 'word/header3.xml', 'word/footer3.xml']

  for (const path of xmlFiles) {
    if (!zip.files[path]) continue
    let xml = zip.files[path].asText()
    for (const [field, value] of Object.entries(values)) {
      // Escape the value for XML: &, <, >, ", '
      const escaped = String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
      // Replace all occurrences of {{field}} regardless of XML entity encoding of braces
      const pattern = new RegExp(`\\{\\{${field}\\}\\}`, 'g')
      xml = xml.replace(pattern, escaped)
    }
    zip.file(path, xml, { compression: 'DEFLATE' })
  }

  return zip.generate({ type: 'blob', compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

/**
 * Generate a filled XLSX from a binary template with {{tokens}} in cells.
 * Uses PizZip surgery — preserves all non-text entries (drawings, media, theme).
 */
export async function generateXlsx(binary, values) {
  const zip = new PizZip(binary)
  const parser = new DOMParser()
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

  // Enumerate sheet paths via xl/_rels/workbook.xml.rels (same approach as insertXlsx)
  const sheetPaths = []
  const wbRelsXml = zip.files['xl/_rels/workbook.xml.rels']?.asText()
  if (wbRelsXml) {
    const relsDoc = parser.parseFromString(wbRelsXml, 'application/xml')
    for (const rel of Array.from(relsDoc.getElementsByTagName('Relationship'))) {
      const type = rel.getAttribute('Type') ?? ''
      if (type.endsWith('/worksheet')) {
        const target = rel.getAttribute('Target')
        if (target) sheetPaths.push(`xl/${target}`)
      }
    }
  }

  // Load shared strings
  const ssPath = 'xl/sharedStrings.xml'
  const ssXml = zip.files[ssPath]?.asText()
  let ssDoc = null
  let siEls = []
  if (ssXml) {
    ssDoc = parser.parseFromString(ssXml, 'application/xml')
    siEls = Array.from(ssDoc.getElementsByTagNameNS(ns, 'si'))
  }

  // Map: shared string index → replacement value
  const ssUpdates = new Map()

  // Process each sheet
  for (const sheetPath of sheetPaths) {
    const sheetXml = zip.files[sheetPath]?.asText()
    if (!sheetXml) continue
    const sheetDoc = parser.parseFromString(sheetXml, 'application/xml')
    let sheetModified = false

    for (const cell of Array.from(sheetDoc.getElementsByTagNameNS(ns, 'c'))) {
      const t = cell.getAttribute('t')

      if (t === 's' && siEls.length > 0) {
        const vEl = cell.getElementsByTagNameNS(ns, 'v')[0]
        if (!vEl) continue
        const idx = parseInt(vEl.textContent, 10)
        if (isNaN(idx) || idx < 0 || idx >= siEls.length) continue
        const tEls = siEls[idx].getElementsByTagNameNS(ns, 't')
        if (!tEls.length) continue
        const text = tEls[0].textContent
        const match = text.match(/^\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}$/)
        if (match && match[1] in values) {
          ssUpdates.set(idx, values[match[1]])
        }
      } else if (t === 'inlineStr') {
        const isEl = cell.getElementsByTagNameNS(ns, 'is')[0]
        if (!isEl) continue
        const tEl = isEl.getElementsByTagNameNS(ns, 't')[0]
        if (!tEl) continue
        const match = tEl.textContent.match(/^\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}$/)
        if (match && match[1] in values) {
          tEl.textContent = values[match[1]]
          sheetModified = true
        }
      }
    }

    if (sheetModified) {
      zip.file(sheetPath, new XMLSerializer().serializeToString(sheetDoc), { compression: 'DEFLATE' })
    }
  }

  // Apply shared string updates
  if (ssDoc && ssUpdates.size > 0) {
    for (const [idx, value] of ssUpdates) {
      const tEls = siEls[idx].getElementsByTagNameNS(ns, 't')
      if (tEls.length) tEls[0].textContent = value
    }
    zip.file(ssPath, new XMLSerializer().serializeToString(ssDoc), { compression: 'DEFLATE' })
  }

  return zip.generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  })
}

/**
 * Save a Blob to disk.
 * Uses showSaveFilePicker when available; falls back to anchor-click download.
 * AbortError (user cancel) is silently swallowed.
 */
export async function saveFile(blob, suggestedName, format) {
  const mimeMap = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{
          description: format.toUpperCase() + ' Document',
          accept: { [mimeMap[format]]: ['.' + format] },
        }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
    } catch (err) {
      if (err.name === 'AbortError') return
      throw err
    }
  } else {
    downloadBlob(blob, suggestedName)
  }
}

// Private fallback — not exported
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
