// =============================================================================
// vitest.config.js
//
// Unit tests for renderer modules (Session 4). Kept separate from
// vite.config.js so the Electron build config stays untouched. Vitest
// supplies import.meta.env natively, which roleMatrix.js's dev-warn path
// relies on.
//
// Running:
//   npm test            # single pass (CI)
//   npm run test:watch  # watch mode
// =============================================================================

import { defineConfig } from 'vitest/config'

export default defineConfig({
  // B2 part 2 (Track B): the automatic JSX runtime, as vite.config.js's React
  // plugin gives the app. Without it a test that renders a .jsx component
  // (sessionDialogs.test.js) fails with "React is not defined" — a runtime
  // choice, not a missing import.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
})
