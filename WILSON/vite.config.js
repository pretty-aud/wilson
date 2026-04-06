import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

// All versions sourced from package.json
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))
const wilsonVersion = `v${pkg.version}`
const appVersion = pkg.toolVersions?.['deck-outline-generator'] ? `v${pkg.toolVersions['deck-outline-generator']}` : 'v?'
const otterVersion = pkg.toolVersions?.otter ? `v${pkg.toolVersions.otter}` : 'v?'
const rabbitVersion = pkg.toolVersions?.rabbit ? `v${pkg.toolVersions.rabbit}` : 'v?'

export default defineConfig({
  base: './',
  plugins: [
    tailwindcss(),
    react(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __WILSON_VERSION__: JSON.stringify(wilsonVersion),
    __OTTER_VERSION__: JSON.stringify(otterVersion),
    __RABBIT_VERSION__: JSON.stringify(rabbitVersion),
  },
  server: {
    port: 5203,
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
})
