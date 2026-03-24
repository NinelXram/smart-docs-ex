import { GoogleGenerativeAI } from '@google/generative-ai'
import * as mammoth from 'mammoth'

const MODEL = 'gemini-2.0-flash'
export const MAX_CHARS = 750_000

function buildPrompt(content, lang) {
  const langInstruction = lang === 'vi' ? '\nRespond in Vietnamese.' : ''
  return `Analyze this document. Identify all variable fields likely to change across iterations (e.g., names, IDs, dates, amounts). Return a JSON array where each item has: "name" (a short camelCase label) and "marker" (a short phrase of 5-10 words from the document that contains the variable's value, with that value replaced by the literal token [VALUE]). The [VALUE] token must appear exactly once in each marker string. Example: "agreement is made with [VALUE] hereinafter".

Respond with ONLY the JSON array, no markdown, no explanation.

Document content:
${content}${langInstruction}`
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

export async function extractVariables(apiKey, content, lang = 'vi') {
  if (content.length > MAX_CHARS) {
    throw new Error(`Document too large: ${content.length} chars (max ${MAX_CHARS})`)
  }

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })

  let responseText
  try {
    const result = await model.generateContent(buildPrompt(content, lang))
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
        buildPrompt(content, lang) + '\n\nCRITICAL: respond with valid JSON only.'
      )
      return parseResponse(retryResult.response.text())
    } catch {
      throw new Error('MALFORMED_RESPONSE')
    }
  }
}

/**
 * Ask Gemini to suggest a camelCase field name and a short description for the selected text.
 * Returns { fieldName, description } or null on failure or invalid response.
 * @param {string} apiKey
 * @param {string} selectedText
 * @param {string} surroundingContext
 * @param {string[]} existingFields
 * @returns {Promise<{ fieldName: string, description: string } | null>}
 */
export async function suggestFieldName(apiKey, selectedText, surroundingContext, existingFields, lang = 'vi') {
  const prompt = `The following text was selected from a document: "${selectedText}". The surrounding context is: "${surroundingContext}". Fields already defined: [${existingFields.join(', ')}]. Suggest a concise camelCase field name and a short description (max 10 words) explaining the field's purpose. Return JSON only: {"fieldName": "...", "description": "..."}${lang === 'vi' ? '\nRespond in Vietnamese.' : ''}`

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })
  const result = await Promise.race([
    model.generateContent(prompt),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
  ])
  const raw = result.response.text().trim()
  try {
    const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(parsed.fieldName)) return null
    return { fieldName: parsed.fieldName, description: _truncateDescription(String(parsed.description ?? '')) }
  } catch {
    // Fallback: treat raw as plain field name with no description
    if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(raw)) return { fieldName: raw, description: '' }
    return null
  }
}

/**
 * Ask Gemini to identify the static label prefix and dynamic value in a cell.
 * Returns { label, value, fieldName }.
 * Throws on timeout or unrecoverable error (caller shows manual-entry popover).
 * @param {string} apiKey
 * @param {string} fullCellText
 * @param {string} selectedText — empty string if no text selected (cell click)
 * @param {string[]} existingFields
 * @param {string} [spatialContext] — column header, row label, and sibling cells
 * @returns {Promise<{ label: string, value: string, fieldName: string }>}
 */
export async function suggestFieldPattern(apiKey, fullCellText, selectedText, existingFields, spatialContext, lang = 'vi') {
  const selectedLine = selectedText
    ? `User selected: "${selectedText}"\n`
    : ''
  const contextLine = spatialContext
    ? `Spatial context — ${spatialContext}\n`
    : ''
  const existingLine = existingFields.length
    ? `Existing field names: [${existingFields.join(', ')}]\n`
    : ''

  const prompt =
    `You are analyzing a spreadsheet cell for document templating.\n` +
    `Cell content: "${fullCellText}"\n` +
    selectedLine +
    contextLine +
    existingLine +
    `Identify:\n` +
    `- label: the static prefix to preserve (empty string if none)\n` +
    `- value: the dynamic portion to replace with a template field\n` +
    `- fieldName: a short camelCase name (must not match existing names)\n` +
    `- description: max 10 words explaining the field's purpose\n\n` +
    `Respond with JSON only: {"label": "...", "value": "...", "fieldName": "...", "description": "..."}\n\n` +
    `Rules:\n` +
    `- label + value must equal the full cell content exactly\n` +
    `- fieldName must match ^[a-zA-Z][a-zA-Z0-9_]*$\n` +
    `- If no label prefix exists, return label as ""` +
    `${lang === 'vi' ? '\nRespond in Vietnamese.' : ''}`

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

  const { label = '', value = '', fieldName = '', description = '' } = parsed

  // Validate constraint: label + value must reconstruct fullCellText
  const resolvedLabel = (label + value === fullCellText) ? label : ''
  const resolvedValue = (label + value === fullCellText) ? value : fullCellText

  return {
    label: resolvedLabel,
    value: resolvedValue,
    fieldName: _sanitizeFieldName(String(fieldName)),
    description: _truncateDescription(String(description)),
  }
}

function _truncateDescription(text) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, 10).join(' ')
}

function _sanitizeFieldName(raw) {
  // Strip characters not in [a-zA-Z0-9_], then ensure starts with a letter
  let name = raw.replace(/[^a-zA-Z0-9_]/g, '')
  if (/^\d/.test(name)) name = 'field' + name
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) ? name : 'field'
}

const MAX_BINARY_BYTES = 4 * 1024 * 1024 // 4 MB
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function _buildAnalyzePrompt(fields, lang, fieldDescriptions = {}) {
  const langInstruction = lang === 'vi' ? '\nRespond in Vietnamese.' : ''
  const fieldList = fields
    .map(f => {
      const desc = fieldDescriptions[f]
      return desc ? `- ${f}: ${desc}` : `- ${f}`
    })
    .join('\n')
  return (
    `You are filling in a document template. The template has these fields:\n${fieldList}\n\n` +
    `Extract the value for each field from the source document provided.\n` +
    `Return a JSON object mapping each field name to its value. Only include fields you find.\n` +
    `Respond with ONLY the JSON object, no markdown, no explanation.` +
    langInstruction
  )
}

function _parseAnalyzeResponse(text, fields) {
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
  const parsed = JSON.parse(cleaned)
  if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MALFORMED_RESPONSE')
  const result = {}
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(parsed, field)) {
      result[field] = parsed[field]
    }
  }
  return result
}

/**
 * Analyze a source file and extract values for the given template fields.
 * Images and PDFs are sent as inlineData; DOCX and TXT are sent as text.
 * @param {string} apiKey
 * @param {File|{type:string,size:number,arrayBuffer:Function,text:Function}} file
 * @param {string[]} fields
 * @param {string} [lang]
 * @returns {Promise<Record<string,string>>}
 */
export async function analyzeSource(apiKey, file, fields, lang = 'vi', fieldDescriptions = {}) {
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL })
  const prompt = _buildAnalyzePrompt(fields, lang, fieldDescriptions)

  let contents

  if (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/gif' ||
      file.type === 'image/webp' || file.type === 'application/pdf') {
    // Binary path — size guard
    if (file.size > MAX_BINARY_BYTES) {
      throw new Error(`File too large: ${file.size} bytes (max ${MAX_BINARY_BYTES})`)
    }
    const buffer = await file.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
    contents = [{ inlineData: { mimeType: file.type, data: base64 } }, { text: prompt }]
  } else if (file.type === DOCX_MIME) {
    // DOCX — extract plain text via mammoth
    const buffer = await file.arrayBuffer()
    const { value: text } = await mammoth.extractRawText({ arrayBuffer: buffer })
    if (text.length > MAX_CHARS) {
      throw new Error(`Document too large: ${text.length} chars (max ${MAX_CHARS})`)
    }
    contents = `${prompt}\n\nDocument content:\n${text}`
  } else {
    // Plain text path
    const text = await file.text()
    if (text.length > MAX_CHARS) {
      throw new Error(`Document too large: ${text.length} chars (max ${MAX_CHARS})`)
    }
    contents = `${prompt}\n\nDocument content:\n${text}`
  }

  let responseText
  try {
    const result = await model.generateContent(contents)
    responseText = result.response.text()
  } catch (err) {
    throw new Error(`Gemini API error: ${err.message}`)
  }

  try {
    return _parseAnalyzeResponse(responseText, fields)
  } catch {
    // Retry once
    try {
      const retryResult = await model.generateContent(contents)
      return _parseAnalyzeResponse(retryResult.response.text(), fields)
    } catch {
      throw new Error('MALFORMED_RESPONSE')
    }
  }
}
