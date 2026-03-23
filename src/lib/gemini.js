import { GoogleGenerativeAI } from '@google/generative-ai'

const MODEL = 'gemini-2.0-flash'
export const MAX_CHARS = 750_000

function buildPrompt(content) {
  return `Analyze this document. Identify all variable fields likely to change across iterations (e.g., names, IDs, dates, amounts). Return a JSON array where each item has: "name" (a short camelCase label) and "marker" (a short phrase of 5-10 words from the document that contains the variable's value, with that value replaced by the literal token [VALUE]). The [VALUE] token must appear exactly once in each marker string. Example: "agreement is made with [VALUE] hereinafter".

Respond with ONLY the JSON array, no markdown, no explanation.

Document content:
${content}`
}

function parseResponse(text) {
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
  const parsed = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) throw new Error('MALFORMED_RESPONSE')
  return parsed.filter(
    v => typeof v.name === 'string' && typeof v.marker === 'string' && v.marker.includes('[VALUE]')
  )
}

export async function testConnection(apiKey) {
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })
  await model.generateContent('Reply with just: OK')
  return true
}

export async function extractVariables(apiKey, content) {
  if (content.length > MAX_CHARS) {
    throw new Error(`Document too large: ${content.length} chars (max ${MAX_CHARS})`)
  }

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })

  let responseText
  try {
    const result = await model.generateContent(buildPrompt(content))
    responseText = result.response.text()
  } catch (err) {
    throw new Error(`Gemini API error: ${err.message}`)
  }

  try {
    return parseResponse(responseText)
  } catch {
    // Retry once with a stricter prompt
    try {
      const retryResult = await model.generateContent(
        buildPrompt(content) + '\n\nCRITICAL: respond with valid JSON only.'
      )
      return parseResponse(retryResult.response.text())
    } catch {
      throw new Error('MALFORMED_RESPONSE')
    }
  }
}

/**
 * Ask Gemini to suggest a camelCase field name for the selected text.
 * Returns null on failure or invalid response.
 * @param {string} apiKey
 * @param {string} selectedText
 * @param {string} surroundingContext
 * @param {string[]} existingFields
 * @returns {Promise<string | null>}
 */
export async function suggestFieldName(apiKey, selectedText, surroundingContext, existingFields) {
  const prompt = `The following text was selected from a document: "${selectedText}". The surrounding context is: "${surroundingContext}". Fields already defined: [${existingFields.join(', ')}]. Suggest a concise camelCase field name for the selected text. Return only the field name, nothing else.`

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })
  const result = await Promise.race([
    model.generateContent(prompt),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
  ])
  const raw = result.response.text().trim()
  if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(raw)) return raw
  return null
}

/**
 * Ask Gemini to identify the static label prefix and dynamic value in a cell.
 * Returns { label, value, fieldName }.
 * Throws on timeout or unrecoverable error (caller shows manual-entry popover).
 * @param {string} apiKey
 * @param {string} fullCellText
 * @param {string} selectedText — empty string if no text selected (cell click)
 * @param {string[]} existingFields
 * @returns {Promise<{ label: string, value: string, fieldName: string }>}
 */
export async function suggestFieldPattern(apiKey, fullCellText, selectedText, existingFields) {
  const selectedLine = selectedText
    ? `User selected: "${selectedText}"\n`
    : ''
  const existingLine = existingFields.length
    ? `Existing field names: [${existingFields.join(', ')}]\n`
    : ''

  const prompt =
    `You are analyzing a spreadsheet cell for document templating.\n` +
    `Cell content: "${fullCellText}"\n` +
    selectedLine +
    existingLine +
    `Identify:\n` +
    `- label: the static prefix to preserve (empty string if none)\n` +
    `- value: the dynamic portion to replace with a template field\n` +
    `- fieldName: a short camelCase name (must not match existing names)\n\n` +
    `Respond with JSON only: {"label": "...", "value": "...", "fieldName": "..."}\n\n` +
    `Rules:\n` +
    `- label + value must equal the full cell content exactly\n` +
    `- fieldName must match ^[a-zA-Z][a-zA-Z0-9_]*$\n` +
    `- If no label prefix exists, return label as ""`

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })
  const raw = await Promise.race([
    model.generateContent(prompt),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
  ])
  const text = raw.response.text().trim()

  return _parseFieldPattern(text, fullCellText)
}

function _parseFieldPattern(text, fullCellText) {
  let parsed
  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return { label: '', value: fullCellText, fieldName: _sanitizeFieldName('') }
  }

  const { label = '', value = '', fieldName = '' } = parsed

  // Validate constraint: label + value must reconstruct fullCellText
  const resolvedLabel = (label + value === fullCellText) ? label : ''
  const resolvedValue = (label + value === fullCellText) ? value : fullCellText

  return {
    label: resolvedLabel,
    value: resolvedValue,
    fieldName: _sanitizeFieldName(String(fieldName)),
  }
}

function _sanitizeFieldName(raw) {
  // Strip characters not in [a-zA-Z0-9_], then ensure starts with a letter
  let name = raw.replace(/[^a-zA-Z0-9_]/g, '')
  if (/^\d/.test(name)) name = 'field' + name
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) ? name : 'field'
}
