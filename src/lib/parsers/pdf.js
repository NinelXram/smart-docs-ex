import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'

export function initPdfWorker(workerSrc) {
  GlobalWorkerOptions.workerSrc = workerSrc
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ text: string, pageCount: number }>}
 */
export async function parsePdf(buffer) {
  const pdf = await getDocument({ data: buffer }).promise
  const pages = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map(item => item.str).join(''))
  }

  return {
    text: pages.join('\n\n'),
    pageCount: pdf.numPages,
  }
}
