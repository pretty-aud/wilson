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
//   npm run dev         # terminal 1 — serves the renderer at :5203
//   npx playwright test # terminal 2 — exercises the flows
//
// CI integration is queued for Session 4 — the config supports it today via
// PLAYWRIGHT_BASE_URL / PROBE_* env vars wired the same way as the
// issue-session smoke job in .github/workflows/rls.yml.
// =============================================================================

import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5203'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
