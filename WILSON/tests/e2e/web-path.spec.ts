// =============================================================================
// tests/e2e/web-path.spec.ts — Session 12: the web-build lane.
//
// Runs against the REAL dist-web build served under the locked /wilson path
// shape (scripts/serve-web.mjs — same rewrites the test host uses), not the
// vite dev server. Guards the Session 12 exit criteria:
//
//   1. A deep link (/wilson/otter) serves the app shell, sign-in lands ON
//      the deep-linked page, and the URL survives.
//   2. In-app navigation pushes /wilson/<page> URLs (history API sync over
//      the all-pages-rendered shell — no router).
//   3. The browser back button navigates the app (popstate → navigateTo).
//   4. Signed out, every deep link shows the login screen — never a blank
//      pane or a 404.
//
// Uses the same seeded creds as auth.spec.ts (WILSON_E2E_* env in CI).
// =============================================================================

import { test, expect } from '@playwright/test'
// Session 43: the sign-in flow lives in authFlow.ts. This file used to carry
// its own copy, which is exactly why the two-step split broke it — see the
// header of that module.
import { signInHere } from './authFlow'

test('deep link /wilson/otter serves the shell and sign-in lands there', async ({ page }) => {
  await page.goto('/wilson/otter')
  await signInHere(page)

  // The top bar renders the page title for every non-home page. O.T.T.E.R.
  // must be the CURRENT page — a home landing would prove deep links reset.
  await expect(page.getByRole('heading', { name: 'O.T.T.E.R.' })).toBeVisible({ timeout: 20_000 })
  expect(new URL(page.url()).pathname).toBe('/wilson/otter')
})

test('in-app navigation pushes /wilson/<page> URLs and back returns', async ({ page }) => {
  await page.goto('/wilson')
  await signInHere(page)
  await expect(page.getByText(/^HOME$/i)).toBeVisible({ timeout: 15_000 })

  // Home menu tiles carry a sprite img — same selector trick as auth.spec.
  await page.getByRole('button', { name: /dashboard/i }).filter({ has: page.getByRole('img') }).click()

  // navigateTo pushes the URL at click time; the page swap animates ~2.1s.
  await expect(page).toHaveURL(/\/wilson\/dashboard$/, { timeout: 10_000 })
  await expect(page.getByRole('heading', { name: 'DASHBOARD' })).toBeVisible({ timeout: 20_000 })

  // Browser back → popstate → navigateTo('home') with the same animation.
  await page.goBack()
  await expect(page).toHaveURL(/\/wilson\/?$/, { timeout: 10_000 })
  await expect(page.getByText(/^HOME$/i)).toBeVisible({ timeout: 20_000 })
})

test('signed out, deep links land on the login screen — not a blank page', async ({ page }) => {
  for (const path of ['/wilson/dog', '/wilson/rate-card', '/wilson/admin-terminal']) {
    await page.goto(path)
    await expect(page.getByText(/^LOGIN$/)).toBeVisible({ timeout: 15_000 })
  }
})
