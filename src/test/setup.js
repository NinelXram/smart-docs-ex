import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

// ─── OPFS Mock ─────────────────────────────────────────────────────────────
function createOpfsMock() {
  const files = new Map() // 'prefix/filename' → string | Uint8Array

  function makeFileHandle(path) {
    return {
      getFile: vi.fn(async () => {
        if (!files.has(path)) {
          throw Object.assign(new Error(`File not found: ${path}`), { name: 'NotFoundError' })
        }
        const data = files.get(path)
        return {
          arrayBuffer: async () => {
            if (data instanceof Uint8Array) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
            return new TextEncoder().encode(data).buffer
          },
          text: async () => {
            if (typeof data === 'string') return data
            return new TextDecoder().decode(data)
          },
        }
      }),
      createWritable: vi.fn(async () => {
        let written = null
        return {
          write: vi.fn(async (data) => { written = data }),
          close: vi.fn(async () => {
            if (written instanceof ArrayBuffer) {
              files.set(path, new Uint8Array(written))
            } else if (written instanceof Uint8Array) {
              files.set(path, written)
            } else {
              files.set(path, written) // string
            }
          }),
        }
      }),
    }
  }

  function makeDirHandle(prefix) {
    return {
      getFileHandle: vi.fn(async (name, opts = {}) => {
        const path = `${prefix}/${name}`
        if (!opts?.create && !files.has(path)) {
          throw Object.assign(new Error(`File not found: ${path}`), { name: 'NotFoundError' })
        }
        return makeFileHandle(path)
      }),
      getDirectoryHandle: vi.fn(async (name) => makeDirHandle(`${prefix}/${name}`)),
      removeEntry: vi.fn(async (name) => { files.delete(`${prefix}/${name}`) }),
      _files: files, // expose for assertions in tests
    }
  }

  const root = makeDirHandle('root')
  return { root, files }
}
// ───────────────────────────────────────────────────────────────────────────

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

  // Reset OPFS mock
  const opfs = createOpfsMock()
  global.navigator = {
    ...global.navigator,
    storage: {
      getDirectory: vi.fn(async () => opfs.root),
    },
  }
})
