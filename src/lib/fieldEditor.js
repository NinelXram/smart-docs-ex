import PizZip from 'pizzip'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'

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
  const runs = Array.from(para.getElementsByTagNameNS(W_NS, 'r'))
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
  for (const r of involvedRuns) parent.removeChild(r)

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

  const err = insertInParagraph(paras[paragraphIndex], selectedText, fieldName)
  if (err) return { error: err }

  const serializer = new XMLSerializer()
  const newXml = serializer.serializeToString(xmlDoc)
  zip.file('word/document.xml', newXml)

  const newBinary = zip.generate({ type: 'arraybuffer' })
  return { binary: newBinary }
}

/**
 * Insert {{fieldName}} into an XLSX binary at the specified cell.
 * Uses PizZip surgery to preserve all zip entries (drawings, media, etc.).
 * @param {ArrayBuffer} binary
 * @param {string} cellAddress — format "SheetName!ColRow" e.g. "Sheet1!B3"
 * @param {string} fieldName
 * @returns {{ binary: ArrayBuffer } | { error: string }}
 */
export function insertXlsx(binary, cellAddress, fieldName) {
  // cellAddress format: "Sheet1!B3" or "Sheet1!A1"
  const bangIdx = cellAddress.indexOf('!')
  if (bangIdx === -1) return { error: 'invalid_cell_address' }
  const sheetName = cellAddress.slice(0, bangIdx)
  const cellRef = cellAddress.slice(bangIdx + 1)  // e.g. "B3"

  let zip
  try {
    zip = new PizZip(binary)
  } catch {
    return { error: 'invalid_binary' }
  }

  const parser = new DOMParser()

  // Step 1: Find sheet in workbook.xml
  const wbXml = zip.files['xl/workbook.xml']?.asText()
  if (!wbXml) return { error: 'sheet_not_found' }
  const wbDoc = parser.parseFromString(wbXml, 'application/xml')
  const sheetEls = Array.from(wbDoc.getElementsByTagName('sheet'))
  const sheetEl = sheetEls.find(el => el.getAttribute('name') === sheetName)
  if (!sheetEl) return { error: 'sheet_not_found' }
  const rId = sheetEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')

  // Step 2: Resolve sheet file path via rels
  let sheetPath = null
  const wbRelsXml = zip.files['xl/_rels/workbook.xml.rels']?.asText()
  if (wbRelsXml) {
    const wbRelsDoc = parser.parseFromString(wbRelsXml, 'application/xml')
    const rels = Array.from(wbRelsDoc.getElementsByTagName('Relationship'))
    const rel = rels.find(r => r.getAttribute('Id') === rId)
    if (rel) {
      const target = rel.getAttribute('Target') // e.g. "worksheets/sheet1.xml"
      sheetPath = `xl/${target}`
    }
  }
  // Fallback: iterate zip files for xl/worksheets/sheet*.xml
  if (!sheetPath) {
    const sheetFiles = Object.keys(zip.files)
      .filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
      .sort()
    if (sheetFiles.length === 0) return { error: 'sheet_not_found' }
    sheetPath = sheetFiles[0]
  }

  // Step 3: Read and modify the sheet XML
  const sheetXml = zip.files[sheetPath]?.asText()
  if (!sheetXml) return { error: 'sheet_not_found' }
  const sheetDoc = parser.parseFromString(sheetXml, 'application/xml')

  // Find the target cell element
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const cells = Array.from(sheetDoc.getElementsByTagNameNS(ns, 'c'))
  const targetCell = cells.find(c => c.getAttribute('r') === cellRef)
  if (!targetCell) return { error: 'cell_not_found' }

  // Step 4: Insert the field token
  const ssPath = 'xl/sharedStrings.xml'
  const ssXml = zip.files[ssPath]?.asText()

  if (ssXml) {
    // Parse sheet to count existing si elements (to get new index)
    const ssDoc = parser.parseFromString(ssXml, 'application/xml')
    const siEls = Array.from(ssDoc.getElementsByTagNameNS(ns, 'si'))
    const newIndex = siEls.length

    // String-based append to avoid XMLSerializer namespace redundancy
    const newSiXml = `<si><t>{{${fieldName}}}</t></si>`
    const closingTag = '</sst>'
    const insertPos = ssXml.lastIndexOf(closingTag)
    if (insertPos === -1) return { error: 'corrupt_shared_strings' }
    let updatedSsXml = ssXml.slice(0, insertPos) + newSiXml + ssXml.slice(insertPos)
    updatedSsXml = updatedSsXml
      .replace(/\bcount="(\d+)"/, (_, n) => `count="${parseInt(n, 10) + 1}"`)
      .replace(/\buniqueCount="(\d+)"/, (_, n) => `uniqueCount="${parseInt(n, 10) + 1}"`)
    zip.file(ssPath, updatedSsXml)

    // Update the cell in the sheet XML
    while (targetCell.firstChild) targetCell.removeChild(targetCell.firstChild)
    targetCell.setAttribute('t', 's')
    const vEl = sheetDoc.createElementNS(ns, 'v')
    vEl.textContent = String(newIndex)
    targetCell.appendChild(vEl)

    const serializer = new XMLSerializer()
    zip.file(sheetPath, serializer.serializeToString(sheetDoc))
  } else {
    // No shared strings — use inline string
    while (targetCell.firstChild) targetCell.removeChild(targetCell.firstChild)
    targetCell.setAttribute('t', 'inlineStr')
    const isEl = sheetDoc.createElementNS(ns, 'is')
    const tEl = sheetDoc.createElementNS(ns, 't')
    tEl.textContent = `{{${fieldName}}}`
    isEl.appendChild(tEl)
    targetCell.appendChild(isEl)

    const serializer = new XMLSerializer()
    zip.file(sheetPath, serializer.serializeToString(sheetDoc))
  }

  return { binary: zip.generate({ type: 'arraybuffer' }) }
}
