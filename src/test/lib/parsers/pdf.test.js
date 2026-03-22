import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pdfjs-dist before importing the module under test
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}))

import { parsePdf, initPdfWorker } from '../../../lib/parsers/pdf.js'
import * as pdfjsLib from 'pdfjs-dist'

const makeMockPdf = (pages) => ({
  promise: Promise.resolve({
    numPages: pages.length,
    getPage: vi.fn(async (n) => ({
      getTextContent: async () => ({
        items: pages[n - 1].map(str => ({ str })),
      }),
    })),
  }),
})

describe('parsePdf', () => {
  beforeEach(() => {
    vi.mocked(pdfjsLib.getDocument).mockReset()
  })

  it('extracts text from a single-page PDF', async () => {
    pdfjsLib.getDocument.mockReturnValue(makeMockPdf([['Hello', '  ', 'World']]))
    const result = await parsePdf(new ArrayBuffer(8))
    expect(result.text).toBe('Hello  World')
    expect(result.pageCount).toBe(1)
  })

  it('joins pages with double newline', async () => {
    pdfjsLib.getDocument.mockReturnValue(
      makeMockPdf([['Page one'], ['Page two']])
    )
    const result = await parsePdf(new ArrayBuffer(8))
    expect(result.text).toBe('Page one\n\nPage two')
    expect(result.pageCount).toBe(2)
  })

  it('returns empty string for a PDF with no text', async () => {
    pdfjsLib.getDocument.mockReturnValue(makeMockPdf([[]]))
    const result = await parsePdf(new ArrayBuffer(8))
    expect(result.text).toBe('')
  })
})

describe('initPdfWorker', () => {
  it('sets GlobalWorkerOptions.workerSrc', () => {
    initPdfWorker('chrome-extension://fake/pdf.worker.min.mjs')
    expect(pdfjsLib.GlobalWorkerOptions.workerSrc).toBe(
      'chrome-extension://fake/pdf.worker.min.mjs'
    )
  })
})
