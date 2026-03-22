import mammoth from 'mammoth'

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ text: string }>}
 */
export async function parseDocx(buffer) {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return { text: result.value }
}
