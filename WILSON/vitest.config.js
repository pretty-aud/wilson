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

    // UI overhaul T1 (2026-09-22): `scripts/*.mjs` load as NODE modules, not
    // through Vite's SSR transform.
    //
    // 🚨 WITHOUT THIS THE CODEMOD'S GUARD DOES NOT LOAD AT ALL ON WINDOWS.
    // `src/ui/typeScale.test.js` imports six helpers from `scripts/`. Every
    // one of those files opens with `#!/usr/bin/env node` and has top-level
    // imports, and Vite's SSR transform HOISTS the `__vite_ssr_import__`
    // calls above the shebang — putting `#!` in the middle of a line, where
    // it is not a shebang but an illegal token. The whole suite file then
    // dies at collection with a bare `SyntaxError: Invalid or unexpected
    // token` and NO file or line, and vitest reports it as
    // `typeScale.test.js (0 test)` — the guard silently stops guarding.
    //
    // It reproduced here on Node 24 / Windows and NOT on CI (Node 22 /
    // ubuntu), so T0 measured 140 files / 2858 tests green and CI agreed,
    // while the same commit measures 139 + 1 failed / 2823 on Audrey's
    // machine. A guard that is green on CI and dead locally is the worst of
    // both: the sessions that must PROVE their assertions by breaking them
    // are exactly the ones that cannot run it.
    //
    // Externalising is also the more faithful of the two: these files are
    // run as `node scripts/ui-audit.mjs` everywhere else, they import only
    // node builtins and each other, and nothing in them needs Vite.
    server: { deps: { external: [/[\\/]scripts[\\/].*\.mjs$/] } },
  },
})
