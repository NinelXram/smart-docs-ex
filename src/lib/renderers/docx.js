import mammoth from 'mammoth'

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ html: string, binary: ArrayBuffer }>}
 */
export async function renderDocx(buffer) {
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
  return { html: result.value, binary: buffer }
}
