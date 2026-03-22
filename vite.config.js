import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, existsSync } from 'fs'

export default defineConfig({
  plugins: [react(), copyExtensionAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
})

function copyExtensionAssets() {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      mkdirSync('dist/icons', { recursive: true })
      copyFileSync('manifest.json', 'dist/manifest.json')
      copyFileSync('background.js', 'dist/background.js')

      // Placeholder icons (replace with real PNGs before publishing)
      ;['icon16.png', 'icon48.png', 'icon128.png'].forEach(name => {
        const dest = `dist/icons/${name}`
        if (!existsSync(dest) && existsSync(`public/icons/${name}`)) {
          copyFileSync(`public/icons/${name}`, dest)
        }
      })
    },
  }
}
