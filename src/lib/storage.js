const API_KEY_KEY = 'apiKey'
const TEMPLATES_KEY = 'templates'

export async function saveApiKey(key) {
  await chrome.storage.local.set({ [API_KEY_KEY]: key })
}

export async function getApiKey() {
  const result = await chrome.storage.local.get([API_KEY_KEY])
  return result[API_KEY_KEY] ?? null
}

export async function saveTemplate(template) {
  const templates = await getTemplates()
  const idx = templates.findIndex(t => t.id === template.id)
  if (idx >= 0) {
    templates[idx] = template
  } else {
    templates.push(template)
  }
  await chrome.storage.local.set({ [TEMPLATES_KEY]: templates })
}

export async function getTemplates() {
  const result = await chrome.storage.local.get([TEMPLATES_KEY])
  return result[TEMPLATES_KEY] ?? []
}

export async function deleteTemplate(id) {
  const templates = await getTemplates()
  await chrome.storage.local.set({
    [TEMPLATES_KEY]: templates.filter(t => t.id !== id),
  })
}
