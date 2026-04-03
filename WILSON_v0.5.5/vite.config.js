import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

// Extract DOG version from the tool folder name inside src/tools/
const toolsDir = path.resolve(__dirname, 'src/tools')
const toolFolders = fs.existsSync(toolsDir) ? fs.readdirSync(toolsDir) : []
const dogFolder = toolFolders.find(f => f.startsWith('deck-outline-generator'))
const versionMatch = dogFolder ? dogFolder.match(/_v([\d.]+)$/) : null
const appVersion = versionMatch ? `v${versionMatch[1]}` : 'v?'

// Extract O.T.T.E.R. version from tool folder name
const otterFolder = toolFolders.find(f => f.startsWith('otter'))
const otterVersionMatch = otterFolder ? otterFolder.match(/_v([\d.]+)$/) : null
const otterVersion = otterVersionMatch ? `v${otterVersionMatch[1]}` : 'v?'

// Extract WILSON container version from package.json
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))
const wilsonVersion = `v${pkg.version}`

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
  },
  server: {
    port: 5203,
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
})
