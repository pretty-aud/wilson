import { defineConfig, loadEnv } from 'vite'
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

// Session 15: two surfaces come out of this one config, selected by --mode.
//
//   default / production / development -> index.html  -> src/main.jsx  (WILSON)
//   admin                              -> admin.html  -> src/admin/...  (operator console)
//
// The entry is gated on mode rather than always listed, because `npm run
// build` feeds the Electron package and electron/main.cjs serves dist/ with
// a catch-all SPA fallback — an unconditional second input would ship the
// platform operator console inside the desktop installer.
//
// --mode (not an env var) because it behaves identically on Windows, in CI
// and on Vercel with no cross-env dependency.
// MO1 (MOTH PS-7): the desktop's main process asks the auth server who a token belongs to, and the
// renderer's URL and key are compile-time constants it cannot read. Both are public and already in the
// bundle (electron/authCheck.cjs).
function authPublic(mode) {
  return {
    name: 'wilson-auth-public',
    apply: 'build',
    generateBundle() {
      const env = loadEnv(mode, process.cwd(), 'VITE_SUPABASE_')
      if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) return
      this.emitFile({
        type: 'asset',
        fileName: 'auth-public.json',
        source: JSON.stringify({ url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY }),
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    tailwindcss(),
    react(),
    authPublic(mode),
  ],
  resolve: {
    // A second yjs copy (hoisting or CJS+ESM pair) breaks the CRDT's
    // instanceof checks — "Yjs was already imported". Keep one resolution.
    dedupe: ['yjs', 'y-protocols'],
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __WILSON_VERSION__: JSON.stringify(wilsonVersion),
    __OTTER_VERSION__: JSON.stringify(otterVersion),
    __RABBIT_VERSION__: JSON.stringify(rabbitVersion),
    // Which surface this bundle is. Read by src/cloud/auth/sessionStorage.js
    // and supabaseClient.js to keep /wilson and /wilsonadmin on separate
    // session keys — localStorage is per-ORIGIN, not per-path, so on
    // beta.petalstudios.co the two surfaces share one store and DIFFERENT
    // KEY STRINGS are the only thing isolating them.
    __WILSON_SURFACE__: JSON.stringify(mode === 'admin' ? 'admin' : 'app'),
  },
  server: {
    port: 5203,
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: mode === 'admin' ? 'admin.html' : 'index.html',
    },
  },
}))
