import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

beforeEach(() => {
  // Reset chrome.storage mock data between tests
  const store = {}

  global.chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          if (Array.isArray(keys)) {
            return keys.reduce((acc, k) => {
              if (k in store) acc[k] = store[k]
              return acc
            }, {})
          }
          return store[keys] !== undefined ? { [keys]: store[keys] } : {}
        }),
        set: vi.fn(async (items) => {
          Object.assign(store, items)
        }),
        remove: vi.fn(async (keys) => {
          const ks = Array.isArray(keys) ? keys : [keys]
          ks.forEach(k => delete store[k])
        }),
      },
    },
    runtime: {
      getURL: vi.fn(path => `chrome-extension://fake-extension-id/${path}`),
    },
  }
})
