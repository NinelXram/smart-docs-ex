import { GoogleGenerativeAI } from '@google/generative-ai'

const MODEL = 'gemini-flash-latest'
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
