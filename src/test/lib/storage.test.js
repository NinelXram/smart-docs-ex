import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveApiKey,
  getApiKey,
  saveTemplate,
  getTemplates,
  deleteTemplate,
} from '../../lib/storage.js'

const makeTemplate = (overrides = {}) => ({
  id: 'test-id-1',
  name: 'Test Contract',
  sourceFormat: 'docx',
  rawContent: 'This agreement is made with [VALUE] hereinafter.',
  variables: [{ name: 'ClientName', marker: 'made with [VALUE] hereinafter' }],
  createdAt: 1000000,
  ...overrides,
})

describe('storage', () => {
  describe('saveApiKey / getApiKey', () => {
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

  describe('saveTemplate / getTemplates', () => {
    it('returns empty array when no templates exist', async () => {
      expect(await getTemplates()).toEqual([])
    })

    it('saves and retrieves a template', async () => {
      const t = makeTemplate()
      await saveTemplate(t)
      const list = await getTemplates()
      expect(list).toHaveLength(1)
      expect(list[0]).toEqual(t)
    })

    it('saves multiple templates', async () => {
      await saveTemplate(makeTemplate({ id: 'id-1', name: 'Contract A' }))
      await saveTemplate(makeTemplate({ id: 'id-2', name: 'Contract B' }))
      const list = await getTemplates()
      expect(list).toHaveLength(2)
    })

    it('updates an existing template when id matches', async () => {
      await saveTemplate(makeTemplate({ name: 'Original' }))
      await saveTemplate(makeTemplate({ name: 'Updated' }))
      const list = await getTemplates()
      expect(list).toHaveLength(1)
      expect(list[0].name).toBe('Updated')
    })
  })

  describe('deleteTemplate', () => {
    it('removes a template by id', async () => {
      await saveTemplate(makeTemplate({ id: 'keep' }))
      await saveTemplate(makeTemplate({ id: 'remove' }))
      await deleteTemplate('remove')
      const list = await getTemplates()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('keep')
    })

    it('does nothing when id does not exist', async () => {
      await saveTemplate(makeTemplate())
      await deleteTemplate('nonexistent')
      expect(await getTemplates()).toHaveLength(1)
    })
  })
})
