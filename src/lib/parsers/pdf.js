// pdfjs-dist has been removed. This parser will be deleted in Task 13.
// Stub exported to keep the module graph intact until then.

export function initPdfWorker(_workerSrc) {}

/**
 * @param {ArrayBuffer} _buffer
 * @returns {Promise<{ text: string, pageCount: number }>}
 */
export async function parsePdf(_buffer) {
  throw new Error('PDF parsing is no longer supported. Please use DOCX or XLSX.')
}
