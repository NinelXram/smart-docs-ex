const API_KEY_KEY = 'apiKey'

// ─── OPFS helpers ────────────────────────────────────────────────────────────

async function getTemplatesDir() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('templates', { create: true })
}

async function readJson(dir, name) {
  try {
    const fh = await dir.getFileHandle(name)
    const file = await fh.getFile()
    return JSON.parse(await file.text())
  } catch (e) {
    if (e.name === 'NotFoundError') return null
    throw e
  }
}

async function writeJson(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(JSON.stringify(data))
  await w.close()
}

async function readIndex(dir) {
  return (await readJson(dir, 'index.json')) ?? []
}

async function writeIndex(dir, ids) {
  await writeJson(dir, 'index.json', ids)
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function checkOpfsAvailable() {
  await navigator.storage.getDirectory()
}

export async function saveApiKey(key) {
  await chrome.storage.local.set({ [API_KEY_KEY]: key })
}

export async function getApiKey() {
  const result = await chrome.storage.local.get([API_KEY_KEY])
  return result[API_KEY_KEY] ?? null
}

const LANG_KEY = 'lang'

export async function getLang() {
  const result = await chrome.storage.local.get([LANG_KEY])
  return result[LANG_KEY] ?? 'vi'
}

export async function saveLang(lang) {
  await chrome.storage.local.set({ [LANG_KEY]: lang })
}

export async function saveTemplate(template) {
  const { binary, ...meta } = template
  const dir = await getTemplatesDir()

  // Write binary
  const fh = await dir.getFileHandle(`${meta.id}.bin`, { create: true })
  const w = await fh.createWritable()
  await w.write(binary)
  await w.close()

  // Write metadata
  await writeJson(dir, `${meta.id}.meta.json`, meta)

  // Update index (add if not present)
  const ids = await readIndex(dir)
  if (!ids.includes(meta.id)) {
    ids.push(meta.id)
    await writeIndex(dir, ids)
  }
}

export async function getTemplates() {
  const dir = await getTemplatesDir()
  const ids = await readIndex(dir)
  const metas = []
  for (const id of ids) {
    const meta = await readJson(dir, `${id}.meta.json`)
    if (meta) metas.push(meta)
  }
  return metas
}

export async function getTemplateBinary(id) {
  const dir = await getTemplatesDir()
  const fh = await dir.getFileHandle(`${id}.bin`)
  const file = await fh.getFile()
  return file.arrayBuffer()
}

export async function deleteTemplate(id) {
  const dir = await getTemplatesDir()

  // Delete files (ignore NotFoundError)
  for (const name of [`${id}.bin`, `${id}.meta.json`]) {
    try {
      await dir.removeEntry(name)
    } catch (e) {
      if (e.name !== 'NotFoundError') throw e
    }
  }

  // Update index
  const ids = await readIndex(dir)
  await writeIndex(dir, ids.filter(i => i !== id))
}

// ─── Migration ───────────────────────────────────────────────────────────────

export async function migrateFromChromeStorage() {
  const result = await chrome.storage.local.get(['templates'])
  const legacy = result.templates
  if (!Array.isArray(legacy) || legacy.length === 0) return

  for (const t of legacy) {
    try {
      // Decode base64 binary
      const binaryStr = atob(t.binary)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
      const buffer = bytes.buffer

      // Check idempotency: skip if already migrated
      const dir = await getTemplatesDir()
      try {
        await dir.getFileHandle(`${t.id}.bin`)
        continue // already exists
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e
      }

      await saveTemplate({ ...t, binary: buffer })

      // Remove this entry from chrome.storage
      const current = await chrome.storage.local.get(['templates'])
      const remaining = (current.templates ?? []).filter(x => x.id !== t.id)
      await chrome.storage.local.set({ templates: remaining })
    } catch (e) {
      console.warn(`[storage] Migration failed for template ${t.id}:`, e)
    }
  }

  // If all migrated, remove the key entirely
  const final = await chrome.storage.local.get(['templates'])
  if (!Array.isArray(final.templates) || final.templates.length === 0) {
    await chrome.storage.local.remove(['templates'])
  }
}
