import path from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Read version.json at build time (try repo root first, then local copy for Docker)
let versionData = { version: '', buildDate: '' }
for (const p of ['../version.json', './version.json']) {
  try {
    versionData = JSON.parse(readFileSync(path.resolve(__dirname, p), 'utf-8'))
    break
  } catch { /* try next */ }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(versionData.version),
    __APP_BUILD_DATE__: JSON.stringify(versionData.buildDate),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
})
