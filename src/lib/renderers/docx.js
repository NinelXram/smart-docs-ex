import * as docx from 'docx-preview'

/**
 * Render a DOCX ArrayBuffer to HTML using docx-preview.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{ html: string, binary: ArrayBuffer }>}
 */
export async function renderDocx(buffer) {
  const container = document.createElement('div')
  await docx.renderAsync(buffer, container)
  Array.from(container.querySelectorAll('p')).forEach((p, i) => {
    p.setAttribute('data-paragraph-index', String(i))
  })
  return { html: container.innerHTML, binary: buffer }
}
