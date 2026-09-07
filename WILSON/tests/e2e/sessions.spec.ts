// =============================================================================
// tests/e2e/sessions.spec.ts — Track B bundle B2, part 2: the session layer,
// end to end against the hosted dev project as the probe admin.
//
//   7. A sign-in writes the app's own `sign_in` row (0070, stamped with the
//      address) and Admin Terminal → Logs → Sign-ins shows it.
//   8. An idle session gets the "Still there?" warning, then is signed out,
//      and the login screen says why.
//   9. Activity clears the idle warning.
//  10. The absolute cap ends a BUSY session and says why.
//  11. A PostgREST call that silently never answers while the browser says
//      it is online raises "Connection lost — reload to continue".
//
// 8–10 run the real timers with the DEV-ONLY override in sessionTimeouts.js
// (`localStorage['wilson.session.timeouts.debug']`), which the Vite dev
// server honours and the production build never reads. The numbers under
// test — 25 / 30 minutes and 4 hours — are pinned by sessionTimeouts.test.js;
// this file proves the wiring around them: listeners, the dialog, the
// sign-out, the notice, the rows.
//
// 11 stands in for the dead network with a route that never answers — the
// same observable the S21 hang has (scripts/probes/connection-hang.mjs is
// the Node reproduction with timings). The no-false-positive half (a slow
// upload never raises the banner) is connectionWatchdog.test.js; an upload
// needs a bucket this account does not have here.
//
// Assumes the probe account is a workspace ADMIN (scenario 7 opens the Admin
// Terminal), as scenario 1 in auth.spec.ts already assumes for the roster.
// Each scenario spends one company check and one credential check on
// resolve-login's per-address limiter (20 / 30 a minute) — five here, six in
// auth.spec.ts; a loop of sign-ins would trip it, this does not.
// =============================================================================

import { test, expect, type Page } from '@playwright/test'
import { signIn, signInHere } from './authFlow'

const DEBUG_KEY = 'wilson.session.timeouts.debug'

const IDLE_NOTICE = 'SIGNED OUT AFTER 30 MINUTES WITHOUT ACTIVITY.'
const CAP_NOTICE = 'SIGNED OUT: SESSIONS END AFTER 4 HOURS. SIGN IN AGAIN TO CONTINUE.'

/** Shrink the clocks BEFORE the app boots (the hook reads the key at start). */
async function shrinkTimeouts(page: Page, overrides: Record<string, number>) {
  await page.addInitScript(([key, value]) => {
    try { localStorage.setItem(key, value) } catch { /* storage disabled */ }
  }, [DEBUG_KEY, JSON.stringify(overrides)] as const)
}

async function expectHome(page: Page) {
  await expect(page.getByText(/^HOME$/i)).toBeVisible({ timeout: 15_000 })
}

// ── 7. the sign_in row, seen in the Sign-ins log ───────────────────────────
test('a sign-in writes the app’s own sign_in row and Logs → Sign-ins shows it with an address', async ({ page }) => {
  // Deep link so the reveal lands on the Admin Terminal (the web-path lane
  // proves deep links; here it just saves a page transition).
  await page.goto('/admin-terminal')
  await signInHere(page)
  await page.getByRole('button', { name: /^logs$/i }).click({ timeout: 20_000 })
  await page.getByRole('button', { name: /^sign-ins$/i }).click()
  // The row the client wrote seconds ago: "Signed in", written by the app,
  // with the address the stamp trigger copied from auth.sessions.
  const row = page.getByRole('row').filter({ hasText: /signed in/i }).filter({ hasText: /^(?!.*sign-in server).*$/s }).first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).toContainText(/\bapp\b/)
  await expect(row).toContainText(/\d{1,3}(\.\d{1,3}){3}|[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}/i)
  await expect(page.getByText(/addresses are recorded on the app/i)).toBeVisible()
})

// ── 8. idle: warned, then signed out, then told why ────────────────────────
test('an idle session is warned, then signed out, and the login screen says why', async ({ page }) => {
  await shrinkTimeouts(page, { idleWarnMs: 4_000, idleSignOutMs: 9_000, tickMs: 500 })
  await signIn(page)
  await expectHome(page)
  // Hands off from here: no mouse, no keys.
  const dialog = page.getByRole('alertdialog', { name: /still there/i })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await expect(dialog).toContainText(/signed out in \d+:\d\d for inactivity/i)
  await expect(dialog.getByRole('button', { name: /stay signed in/i })).toBeVisible()
  await expect(page.getByText(IDLE_NOTICE)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/^LOGIN$/)).toBeVisible()
})

// ── 9. activity clears the warning ─────────────────────────────────────────
test('activity clears the idle warning', async ({ page }) => {
  await shrinkTimeouts(page, { idleWarnMs: 3_000, idleSignOutMs: 30_000, tickMs: 500 })
  await signIn(page)
  await expectHome(page)
  const dialog = page.getByRole('alertdialog', { name: /still there/i })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByRole('button', { name: /stay signed in/i }).click()
  await expect(dialog).toBeHidden({ timeout: 2_000 })
  // and it comes back when the person goes quiet again
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await page.mouse.move(200, 200)
  await page.mouse.move(240, 260)
  await expect(dialog).toBeHidden({ timeout: 2_000 })
  await expect(page.getByText(/^HOME$/i)).toBeVisible()
})

// ── 10. the cap ends a BUSY session ────────────────────────────────────────
test('the absolute cap ends a busy session with a warning first and says why', async ({ page }) => {
  await shrinkTimeouts(page, { capMs: 12_000, capWarnMs: 5_000, tickMs: 500 })
  await signIn(page)
  await expectHome(page)
  // Keep the session busy for the whole test: activity must not extend a cap.
  await page.evaluate(() => {
    const id = setInterval(() => window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })), 300)
    ;(window as unknown as { __b2mover?: number }).__b2mover = id as unknown as number
  })
  const dialog = page.getByRole('alertdialog', { name: /session ending/i })
  await expect(dialog).toBeVisible({ timeout: 12_000 })
  await expect(dialog).toContainText(/sessions end after 4 hours/i)
  await expect(page.getByText(CAP_NOTICE)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/^LOGIN$/)).toBeVisible()
})

// ── 11. the banner ─────────────────────────────────────────────────────────
test('a PostgREST call that never answers while online raises the connection-lost banner', async ({ page }) => {
  // Land on the Admin Terminal and open Logs, whose first activation loads
  // app_events — so the LATER Refresh click below is a request this test
  // controls, not one the all-pages-mounted shell already made at sign-in.
  await page.goto('/admin-terminal')
  await signInHere(page)
  await page.getByRole('button', { name: /^logs$/i }).click({ timeout: 20_000 })
  await page.waitForTimeout(4_000)
  await expect(page.getByTestId('connection-lost-banner')).toHaveCount(0)
  // The dead network: every PostgREST request from now on is accepted and
  // never answered. navigator.onLine stays true — nothing errors.
  await page.route('**/rest/v1/**', () => { /* never continue, never fulfil */ })
  // One bounded read into the void.
  await page.getByRole('button', { name: /^refresh$/i }).click()
  const banner = page.getByTestId('connection-lost-banner')
  await expect(banner).toBeVisible({ timeout: 35_000 })
  await expect(banner).toContainText(/connection lost/i)
  await expect(banner.getByRole('button', { name: /^reload$/i })).toBeVisible()
})
