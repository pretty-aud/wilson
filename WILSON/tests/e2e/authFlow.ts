// =============================================================================
// tests/e2e/authFlow.ts — the ONE definition of "sign in" for the e2e specs.
//
// 🚨 WHY THIS FILE EXISTS. Session 43 split sign-in into two steps (company,
// then username + password) and updated auth.spec.ts. web-path.spec.ts had its
// own private copy of the helper — `signInHere` — and was missed, so CI went
// red on a change whose vitest and pgTAP lanes were both green.
//
// It was missed because the search was for SYMBOLS (LoginScreen, AuthShell,
// resolve-login…) and that file names none of them. It only names the labels
// on screen. Two copies of a flow means the second one is found by CI.
//
// Both specs import from here now. If the sign-in flow changes again, this is
// the only place that needs to know.
// =============================================================================

import { expect, type Page } from '@playwright/test'

// Creds seeded by supabase/tests/rls helpers + the Session 2 smoke fixture.
// Supplied by env — WILSON_E2E_* locally, DEV_PROBE_* in CI (see the e2e-auth
// job in .github/workflows/rls.yml, which lives in the PARENT git root).
//
// Session 15 (TPN-SDLC-007): the password USED to have a hardcoded fallback.
// This repo is PUBLIC and the account is a live, active workspace admin on the
// hosted wilson-dev project — so the literal was a published credential, not a
// fixture. There is deliberately no fallback: an unset password fails loudly
// rather than silently reintroducing the literal.
export const USERNAME = process.env.WILSON_E2E_USERNAME ?? 'smoke_admin'
export const PASSWORD = process.env.WILSON_E2E_PASSWORD ?? ''

// Session 43: sign-in is company-first, so the flow needs the fixture's
// workspace slug. Read off wilson-dev 2026-08-10: smoke_admin belongs to
// exactly one workspace, "Smoke Workspace" / `smoke`. Defaulted like USERNAME
// rather than required — a slug is an identifier, not a credential, so unlike
// PASSWORD it is safe in a public repo.
//
// ⚠️ If DEV_PROBE_USERNAME is ever pointed at an account in a DIFFERENT
// workspace, set WILSON_E2E_WORKSPACE_SLUG alongside it or every scenario
// fails at step 1 with the generic error, which by design does not say why.
//
// `||` not `??` on purpose: GitHub Actions renders an UNSET secret as the
// empty string, not as undefined, so `??` would hand the empty string
// straight through and every scenario would fail step 1.
export const WORKSPACE = process.env.WILSON_E2E_WORKSPACE_SLUG || 'smoke'

if (!PASSWORD) {
  throw new Error(
    'WILSON_E2E_PASSWORD is not set. These specs sign in to a real hosted project; '
    + 'the credential is never committed. Set it from your password manager (or, in CI, '
    + 'from the DEV_PROBE_PASSWORD secret) before running.',
  )
}

// Step 1 of 2. The company step deliberately makes NO network call — it
// shape-checks the slug and advances — so there is nothing to wait on beyond
// the step cross-fade; waiting for the Username field covers it.
export async function clearCompanyStep(page: Page, workspace = WORKSPACE) {
  // UI overhaul D2: the title is sentence case now (Q2 — uppercase survives
  // only in the transition title and the 11px Label step), so this regex is
  // case-insensitive. It is a LOOSENING: it matches the old LOGIN and the new
  // Login, so it cannot regress while the restyle rolls through the lanes.
  await expect(page.getByText(/^login$/i)).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Company').fill(workspace)
  await page.getByRole('button', { name: /^continue$/i }).click()
  await expect(page.getByLabel('Username')).toBeVisible({ timeout: 10_000 })
}

// Sign in from wherever the page currently is. Deep-link specs must NOT
// navigate away first — the URL is the thing under test.
export async function signInHere(page: Page, username = USERNAME, password = PASSWORD) {
  await clearCompanyStep(page)
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  // Session 9: unenrolled admins get the MFA enrollment gate right after
  // reveal — its overlay eats every click below it. The probe admin stays
  // unenrolled (a TOTP secret in CI is S11 work), so defer per sign-in.
  const defer = page.getByRole('button', { name: /set up later/i })
  await defer.click({ timeout: 12_000 }).catch(() => { /* not an admin, or already enrolled */ })
}

// Sign in starting from the app root.
export async function signIn(page: Page, username = USERNAME, password = PASSWORD) {
  await page.goto('/')
  await signInHere(page, username, password)
}

// Session 43 §A1: "Forgot password?" moved to step 2, beside the password
// field it is about (Law of Proximity), so reaching it means clearing the
// company step first.
export async function gotoForgotPassword(page: Page) {
  await page.goto('/')
  await clearCompanyStep(page)
  await page.getByRole('button', { name: /forgot password/i }).click({ timeout: 10_000 })
}
