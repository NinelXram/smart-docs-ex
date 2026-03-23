/**
 * Split the concatenated HTML output of renderXlsx into per-sheet entries.
 *
 * renderXlsx emits: <h3>SheetName</h3><table>…</table> repeated for each sheet.
 * Sheet names and data-cell-address values are HTML-escaped in the source.
 * This function decodes sheet names via DOMParser / .textContent, but passes
 * table fragments through verbatim so data-cell-address attributes stay escaped.
 *
 * @param {string|null|undefined} htmlString
 * @returns {{ name: string, html: string }[]}
 */
export function parseXlsxSheets(htmlString) {
  if (!htmlString) return []

  const doc = new DOMParser().parseFromString(htmlString, 'text/html')
  const children = Array.from(doc.body.children)

  if (!children.some(c => c.tagName === 'H3')) return []

  const sheets = []
  let currentName = null
  let currentParts = []

  for (const child of children) {
    if (child.tagName === 'H3') {
      if (currentName !== null) {
        sheets.push({ name: currentName, html: currentParts.join('') })
      }
      currentName = child.textContent   // .textContent decodes &amp; → &
      currentParts = []
    } else if (currentName !== null) {
      currentParts.push(child.outerHTML) // outerHTML preserves escaped attrs verbatim
    }
  }

  if (currentName !== null) {
    sheets.push({ name: currentName, html: currentParts.join('') })
  }

  return sheets
}
