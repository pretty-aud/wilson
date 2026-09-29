// =============================================================================
// vitest.config.js
//
// Unit tests for renderer modules (Session 4). Kept separate from
// vite.config.js so the Electron build config stays untouched. Vitest
// supplies import.meta.env natively, which roleMatrix.js's dev-warn path
// relies on.
//
// UI overhaul F1 (2026-09-11): the React plugin is on so `.test.jsx` files
// can mount components with Testing Library. The environment stays `node`
// for the existing 86 files; a render test opts into jsdom with a docblock
// on its first line:
//
//   /** @vitest-environment jsdom */
//
// That keeps the ~2,000 existing assertions on the fast path and makes the
// DOM an explicit choice per file rather than a global cost.
//
// Running:
//   npm test            # single pass (CI)
//   npm run test:watch  # watch mode
// =============================================================================

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
})
