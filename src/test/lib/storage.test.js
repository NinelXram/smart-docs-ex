import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveApiKey,
  getApiKey,
  checkOpfsAvailable,
  saveTemplate,
  getTemplates,
  getTemplateBinary,
  deleteTemplate,
  migrateFromChromeStorage,
} from '../../lib/storage.js'

// Binary helper — 4-byte ArrayBuffer
function makeBuffer(bytes = [1, 2, 3, 4]) {
  return new Uint8Array(bytes).buffer
}

const META = {
  id: 'test-id-1',
  name: 'Sales Contract',
  sourceFormat: 'docx',
  fields: ['ClientName', 'EffectiveDate'],
  createdAt: 1000000,
}

describe('getApiKey / saveApiKey', () => {
  it('returns null when no key is stored', async () => {
    expect(await getApiKey()).toBeNull()
  })

  it('stores and retrieves the API key', async () => {
    await saveApiKey('my-secret-key')
    expect(await getApiKey()).toBe('my-secret-key')
  })

  it('overwrites the previous key', async () => {
    await saveApiKey('old-key')
    await saveApiKey('new-key')
    expect(await getApiKey()).toBe('new-key')
  })
})

describe('checkOpfsAvailable', () => {
  it('resolves when navigator.storage.getDirectory is available', async () => {
    await expect(checkOpfsAvailable()).resolves.toBeUndefined()
  })

  it('rejects when navigator.storage is unavailable', async () => {
    const orig = global.navigator.storage
    global.navigator = { ...global.navigator, storage: undefined }
    await expect(checkOpfsAvailable()).rejects.toThrow()
    global.navigator = { ...global.navigator, storage: orig }
  })
})

describe('saveTemplate / getTemplates', () => {
  it('returns empty array when no templates exist', async () => {
    expect(await getTemplates()).toEqual([])
  })

  it('saves and retrieves template metadata (no binary)', async () => {
    await saveTemplate({ ...META, binary: makeBuffer() })
    const list = await getTemplates()
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual(META)          // no binary field
    expect(list[0].binary).toBeUndefined()
  })

  it('saves multiple templates', async () => {
    await saveTemplate({ ...META, id: 'id-1', name: 'A', binary: makeBuffer() })
    await saveTemplate({ ...META, id: 'id-2', name: 'B', binary: makeBuffer() })
    expect(await getTemplates()).toHaveLength(2)
  })

  it('updates metadata when id matches', async () => {
    await saveTemplate({ ...META, name: 'Original', binary: makeBuffer() })
    await saveTemplate({ ...META, name: 'Updated', binary: makeBuffer([5, 6, 7, 8]) })
    const list = await getTemplates()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Updated')
  })
})

describe('getTemplateBinary', () => {
  it('returns the stored ArrayBuffer', async () => {
    const buf = makeBuffer([10, 20, 30])
    await saveTemplate({ ...META, binary: buf })
    const result = await getTemplateBinary(META.id)
    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(result)).toEqual(new Uint8Array([10, 20, 30]))
  })

  it('throws when template binary is not found', async () => {
    await expect(getTemplateBinary('nonexistent-id')).rejects.toThrow()
  })
})

describe('deleteTemplate', () => {
  it('removes a template by id', async () => {
    await saveTemplate({ ...META, id: 'keep', binary: makeBuffer() })
    await saveTemplate({ ...META, id: 'remove', binary: makeBuffer() })
    await deleteTemplate('remove')
    const list = await getTemplates()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('keep')
  })

  it('does nothing when id does not exist', async () => {
    await saveTemplate({ ...META, binary: makeBuffer() })
    await deleteTemplate('nonexistent')
    expect(await getTemplates()).toHaveLength(1)
  })

  it('binary is no longer retrievable after delete', async () => {
    await saveTemplate({ ...META, binary: makeBuffer() })
    await deleteTemplate(META.id)
    await expect(getTemplateBinary(META.id)).rejects.toThrow()
  })
})

describe('migrateFromChromeStorage', () => {
  it('migrates legacy base64 templates to OPFS', async () => {
    // Arrange: put a base64-encoded template in chrome.storage mock
    const bytes = new Uint8Array([9, 8, 7])
    const base64 = btoa(String.fromCharCode(...bytes))
    const legacy = [{ id: 'legacy-1', name: 'Old', sourceFormat: 'xlsx', binary: base64, fields: ['X'], createdAt: 1 }]
    await chrome.storage.local.set({ templates: legacy })

    // Act
    await migrateFromChromeStorage()

    // Assert: template is now in OPFS
    const list = await getTemplates()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('legacy-1')

    // Assert: binary is retrievable
    const bin = await getTemplateBinary('legacy-1')
    expect(new Uint8Array(bin)).toEqual(bytes)

    // Assert: chrome.storage.local templates key is removed
    const stored = await chrome.storage.local.get(['templates'])
    expect(stored.templates).toBeUndefined()
  })

  it('is idempotent — does not duplicate if run twice', async () => {
    const base64 = btoa(String.fromCharCode(1, 2))
    await chrome.storage.local.set({
      templates: [{ id: 'dup-1', name: 'D', sourceFormat: 'docx', binary: base64, fields: [], createdAt: 1 }],
    })
    await migrateFromChromeStorage()
    await migrateFromChromeStorage() // run twice
    expect(await getTemplates()).toHaveLength(1)
  })

  it('skips corrupt entries and continues', async () => {
    await chrome.storage.local.set({
      templates: [
        { id: 'bad', name: 'Bad', sourceFormat: 'docx', binary: '!!!not-base64!!!', fields: [], createdAt: 1 },
        { id: 'good', name: 'Good', sourceFormat: 'docx', binary: btoa('x'), fields: [], createdAt: 2 },
      ],
    })
    await migrateFromChromeStorage()
    const list = await getTemplates()
    expect(list.map(t => t.id)).toContain('good')
  })
})
