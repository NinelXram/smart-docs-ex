import PizZip from 'pizzip'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'

/**
 * Returns true if the node has a <w:del> ancestor (tracked deletion — mammoth skips these).
 */
function isInsideDel(node) {
  let n = node.parentNode
  while (n) {
    if (n.namespaceURI === W_NS && n.localName === 'del') return true
    n = n.parentNode
  }
  return false
}

/**
 * Collect all <w:p> descendants of <w:body>, depth-first, excluding those
 * inside <w:del> elements (tracked deletions, which mammoth skips).
 * Headers/footers are in separate XML files and never appear in document.xml's body.
 */
function collectBodyParagraphs(body) {
  const paras = []
  function walk(node) {
    for (const child of Array.from(node.children)) {
      if (child.namespaceURI === W_NS && child.localName === 'del') continue
      if (child.namespaceURI === W_NS && child.localName === 'p') {
        paras.push(child)
      }
      walk(child)
    }
  }
  walk(body)
  return paras
}

/**
 * Replace selectedText in a paragraph with {{fieldName}}.
 * Handles run-split text and partial-run boundaries.
 * Returns null on success or an error string.
 */
function insertInParagraph(para, selectedText, fieldName) {
  // Exclude runs inside <w:del> — they are tracked deletions that mammoth hides,
  // so they are invisible to the user and must not be considered part of the visible text.
  const runs = Array.from(para.getElementsByTagNameNS(W_NS, 'r')).filter(r => !isInsideDel(r))
  const runTexts = runs.map(r => {
    const tEls = Array.from(r.getElementsByTagNameNS(W_NS, 't'))
    return tEls.map(t => t.textContent).join('')
  })
  const fullText = runTexts.join('')
  const matchStart = fullText.indexOf(selectedText)
  if (matchStart === -1) return 'text_not_found'

  const matchEnd = matchStart + selectedText.length

  // Map cumulative char positions to runs
  let pos = 0
  const runRanges = runTexts.map((text, i) => {
    const start = pos
    pos += text.length
    return { start, end: pos, index: i }
  })

  const firstRunIdx = runRanges.findIndex(r => r.end > matchStart)
  const lastRunIdx = runRanges.findIndex(r => r.end >= matchEnd)
  if (firstRunIdx === -1 || lastRunIdx === -1) return 'text_not_found'

  const firstRun = runs[firstRunIdx]
  const firstRunRange = runRanges[firstRunIdx]
  const lastRun = runs[lastRunIdx]
  const lastRunRange = runRanges[lastRunIdx]

  const prefixText = runTexts[firstRunIdx].slice(0, matchStart - firstRunRange.start)
  const suffixText = runTexts[lastRunIdx].slice(matchEnd - lastRunRange.start)

  const doc = para.ownerDocument
  const firstRPr = firstRun.getElementsByTagNameNS(W_NS, 'rPr')[0]

  // Build the replacement {{fieldName}} run
  const newRun = doc.createElementNS(W_NS, 'w:r')
  if (firstRPr) newRun.appendChild(firstRPr.cloneNode(true))
  const newT = doc.createElementNS(W_NS, 'w:t')
  newT.textContent = `{{${fieldName}}}`
  newRun.appendChild(newT)

  const replacements = []

  if (prefixText) {
    const prefixRun = firstRun.cloneNode(true)
    const prefixT = prefixRun.getElementsByTagNameNS(W_NS, 't')[0]
    if (prefixT) {
      prefixT.textContent = prefixText
      if (prefixText.startsWith(' ') || prefixText.endsWith(' ')) {
        prefixT.setAttributeNS(XML_NS, 'xml:space', 'preserve')
      }
    }
    replacements.push(prefixRun)
  }

  replacements.push(newRun)

  if (suffixText) {
    const suffixRun = lastRun.cloneNode(true)
    const suffixT = suffixRun.getElementsByTagNameNS(W_NS, 't')[0]
    if (suffixT) {
      suffixT.textContent = suffixText
      if (suffixText.startsWith(' ') || suffixText.endsWith(' ')) {
        suffixT.setAttributeNS(XML_NS, 'xml:space', 'preserve')
      }
    }
    replacements.push(suffixRun)
  }

  const parent = firstRun.parentNode
  const involvedRuns = runs.slice(firstRunIdx, lastRunIdx + 1)
  for (const r of replacements) parent.insertBefore(r, firstRun)
  // Remove each involved run from its own parentNode — runs may live inside <w:ins>
  // or other tracked-change wrappers whose parent differs from firstRun's parent.
  for (const r of involvedRuns) r.parentNode.removeChild(r)

  return null
}

/**
 * Insert {{fieldName}} into a DOCX binary at the selected text position.
 * @param {ArrayBuffer} binary
 * @param {string} selectedText
 * @param {number} paragraphIndex — index among all <w:p> in <w:body> in document order
 * @param {string} fieldName
 * @returns {{ binary: ArrayBuffer } | { error: string }}
 */
export function insertDocx(binary, selectedText, paragraphIndex, fieldName) {
  const zip = new PizZip(binary)
  if (!zip.files['word/document.xml']) return { error: 'no_body' }
  const xmlText = zip.files['word/document.xml'].asText()

  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml')

  const bodies = xmlDoc.getElementsByTagNameNS(W_NS, 'body')
  if (!bodies.length) return { error: 'no_body' }

  const paras = collectBodyParagraphs(bodies[0])

  if (paragraphIndex < 0 || paragraphIndex >= paras.length) return { error: 'paragraph_index_out_of_range' }

  // Try the hinted index first; fall back to a full scan if text not found there.
  // (HTML paragraph count from mammoth may differ from raw <w:p> count in XML.)
  let targetPara = null
  if (paragraphIndex >= 0 && paragraphIndex < paras.length) {
    const runs = Array.from(paras[paragraphIndex].getElementsByTagNameNS(W_NS, 'r'))
    const text = runs.map(r => Array.from(r.getElementsByTagNameNS(W_NS, 't')).map(t => t.textContent).join('')).join('')
    if (text.includes(selectedText)) targetPara = paras[paragraphIndex]
  }
  if (!targetPara) {
    targetPara = paras.find(p => {
      const runs = Array.from(p.getElementsByTagNameNS(W_NS, 'r'))
      const text = runs.map(r => Array.from(r.getElementsByTagNameNS(W_NS, 't')).map(t => t.textContent).join('')).join('')
      return text.includes(selectedText)
    }) ?? null
  }
  if (!targetPara) return { error: 'text_not_found' }

  const err = insertInParagraph(targetPara, selectedText, fieldName)
  if (err) return { error: err }

  const serializer = new XMLSerializer()
  const newXml = serializer.serializeToString(xmlDoc)
  zip.file('word/document.xml', newXml, { compression: 'DEFLATE' })

  const newBinary = zip.generate({ type: 'arraybuffer', compression: 'DEFLATE' })
  return { binary: newBinary }
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Insert a confirmed pattern string into an XLSX cell.
 * pattern is the full new cell content, e.g. "Name: {{fieldName}}".
 * @param {ArrayBuffer} binary
 * @param {string} cellAddress — "SheetName!ColRow" e.g. "Sheet1!B3"
 * @param {string} fieldName — used only to detect already-inserted tokens (not for logic)
 * @param {string} pattern — full cell content to write, e.g. "Name: {{name}}"
 * @returns {{ binary: ArrayBuffer } | { error: string }}
 */
export function insertXlsx(binary, cellAddress, fieldName, pattern) {
  const bangIdx = cellAddress.indexOf('!')
  if (bangIdx === -1) return { error: 'invalid_cell_address' }
  const sheetName = cellAddress.slice(0, bangIdx)
  const cellRef = cellAddress.slice(bangIdx + 1)

  let zip
  try {
    zip = new PizZip(binary)
  } catch {
    return { error: 'invalid_binary' }
  }

  const parser = new DOMParser()

  // Step 1: Find sheet path via workbook.xml.rels
  const wbXml = zip.files['xl/workbook.xml']?.asText()
  if (!wbXml) return { error: 'sheet_not_found' }
  const wbDoc = parser.parseFromString(wbXml, 'application/xml')
  const sheetEl = Array.from(wbDoc.getElementsByTagName('sheet'))
    .find(el => el.getAttribute('name') === sheetName)
  if (!sheetEl) return { error: 'sheet_not_found' }
  const rId = sheetEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')

  let sheetPath = null
  const wbRelsXml = zip.files['xl/_rels/workbook.xml.rels']?.asText()
  if (wbRelsXml) {
    const relsDoc = parser.parseFromString(wbRelsXml, 'application/xml')
    const rel = Array.from(relsDoc.getElementsByTagName('Relationship'))
      .find(r => r.getAttribute('Id') === rId)
    if (rel) sheetPath = `xl/${rel.getAttribute('Target')}`
  }
  if (!sheetPath) {
    const found = Object.keys(zip.files)
      .filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
      .sort()[0]
    if (!found) return { error: 'sheet_not_found' }
    sheetPath = found
  }

  // Step 2: Find target cell
  const sheetXml = zip.files[sheetPath]?.asText()
  if (!sheetXml) return { error: 'sheet_not_found' }
  const sheetDoc = parser.parseFromString(sheetXml, 'application/xml')
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const targetCell = Array.from(sheetDoc.getElementsByTagNameNS(ns, 'c'))
    .find(c => c.getAttribute('r') === cellRef)
  if (!targetCell) return { error: 'cell_not_found' }

  // Step 3: Write pattern as new shared string (or inline string if no sst)
  const ssPath = 'xl/sharedStrings.xml'
  const ssXml = zip.files[ssPath]?.asText()

  if (ssXml) {
    // Parse shared strings to get the correct next index via DOM (regex counting is unreliable)
    const ssDoc = parser.parseFromString(ssXml, 'application/xml')
    const siEls = Array.from(ssDoc.getElementsByTagNameNS(ns, 'si'))
    const newIndex = siEls.length

    // String-based append to avoid XMLSerializer namespace redundancy
    const newSiXml = `<si><t xml:space="preserve">${escapeXml(pattern)}</t></si>`
    const closingTag = '</sst>'
    const insertPos = ssXml.lastIndexOf(closingTag)
    if (insertPos === -1) return { error: 'corrupt_shared_strings' }

    // Increment count (total references) and uniqueCount (distinct entries) independently
    let updatedSsXml = ssXml.slice(0, insertPos) + newSiXml + ssXml.slice(insertPos)
    updatedSsXml = updatedSsXml
      .replace(/\bcount="(\d+)"/, (_, n) => `count="${parseInt(n, 10) + 1}"`)
      .replace(/\buniqueCount="(\d+)"/, (_, n) => `uniqueCount="${parseInt(n, 10) + 1}"`)
    zip.file(ssPath, updatedSsXml, { compression: 'DEFLATE' })

    // Point cell to new shared string index
    while (targetCell.firstChild) targetCell.removeChild(targetCell.firstChild)
    targetCell.setAttribute('t', 's')
    const vEl = sheetDoc.createElementNS(ns, 'v')
    vEl.textContent = String(newIndex)
    targetCell.appendChild(vEl)
  } else {
    // No shared strings — use inline string
    while (targetCell.firstChild) targetCell.removeChild(targetCell.firstChild)
    targetCell.setAttribute('t', 'inlineStr')
    const isEl = sheetDoc.createElementNS(ns, 'is')
    const tEl = sheetDoc.createElementNS(ns, 't')
    tEl.textContent = pattern
    tEl.setAttribute('xml:space', 'preserve')
    isEl.appendChild(tEl)
    targetCell.appendChild(isEl)
  }

  zip.file(sheetPath, new XMLSerializer().serializeToString(sheetDoc), { compression: 'DEFLATE' })
  return { binary: zip.generate({ type: 'arraybuffer', compression: 'DEFLATE' }) }
}
