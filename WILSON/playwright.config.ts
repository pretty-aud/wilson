// =============================================================================
// playwright.config.ts
//
// Browser-driven end-to-end tests for WILSON's auth + permissions flows.
// Points at the running Vite dev server (port 5203 per vite.config.js).
//
// Local prerequisites (once):
//   npm install -D @playwright/test
//   npx playwright install chromium
//
// Running:
//   npx playwright test   # webServer below auto-starts `npm run dev` at :5203
//                         # (reuses an already-running dev server locally)
//
// CI (Session 4): the e2e-auth job in .github/workflows/rls.yml runs this
// against wilson-dev with VITE_* env from the DEV_* repo secrets and
// PLAYWRIGHT_SKIP_EMAIL=1 (no mailpit in that job).
// =============================================================================

import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5203'
// Session 12: the WEB build lane — dist-web served under the locked /wilson
// path shape by scripts/serve-web.mjs (mirrors the deployed test host).
const WEB_URL = process.env.PLAYWRIGHT_WEB_URL ?? 'http://localhost:4174'

export default defineConfig({
  testDir: './tests/e2e',
  // WILSON's auth shell + page transitions are deliberately slow (~6s logo
  // intro, ~4s reveal, 2.1s page swaps) — 30s total was too tight in practice.
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    // Without this, a click on a locator that never matches blocks until the
    // TEST timeout — cap individual actions so fallbacks actually run.
    actionTimeout: 10_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /web-path\.spec\.ts/,
    },
    // Session 12: web-path lane — deep links, URL ↔ page sync and the
    // signed-out degradations against the real dist-web build under /wilson.
    {
      name: 'chromium-web',
      use: { ...devices['Desktop Chrome'], baseURL: WEB_URL },
      testMatch: /web-path\.spec\.ts/,
    },
  ],

  // Auto-start the Vite dev server. Vite inherits VITE_SUPABASE_URL /
  // VITE_SUPABASE_ANON_KEY from the process env (CI) or .env.development
  // (local). reuseExistingServer keeps the two-terminal workflow viable.
  // The second entry builds + serves the WEB target for the chromium-web
  // project (the build inherits the same VITE_* env).
  webServer: [
    {
      command: 'npm run dev',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run build:web && npm run preview:web',
      url: `${WEB_URL}/wilson/`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
})
