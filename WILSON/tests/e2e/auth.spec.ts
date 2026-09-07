// =============================================================================
// tests/e2e/auth.spec.ts
//
// Three scenarios guard the Session 3 exit criteria:
//
//   1. Sign-in with a valid username+password lands on Home with the correct
//      workspace in view. Verifies the username-first flow end-to-end:
//      resolve-login → signInWithPassword → custom_access_token_hook →
//      RLS-scoped project list.
//
//   2. Admin invites a new member via the TeamMembersPage "Invite User"
//      dialog, which calls invite-member; a mailpit fetch confirms the
//      invite email landed with a recovery link; the invitee follows the
//      link and can set a password.
//
//   3. Forgot-password wizard dispatches a reset email, the user follows
//      the recovery link, sets a new password, and signs in with it.
//
// Scenarios 2 and 3 depend on mailpit (local Supabase stack's mail server
// at :54324); a helper fetches the latest message for a given recipient.
// They can be skipped by setting PLAYWRIGHT_SKIP_EMAIL=1 when running
// against a hosted env without mailpit access.
//
// Prereqs: npm install -D @playwright/test + npx playwright install chromium
// See playwright.config.ts for local + CI wiring.
// =============================================================================

import { test, expect } from '@playwright/test'
// Session 43: sign-in lives in authFlow.ts so this spec and web-path.spec.ts
// cannot drift apart again. USERNAME / PASSWORD / WORKSPACE come from there.
import {
  USERNAME, PASSWORD, WORKSPACE, WORKSPACE_NAME, signIn, gotoForgotPassword, clearCompanyStep,
} from './authFlow'

const MAILPIT  = process.env.MAILPIT_URL         ?? 'http://localhost:54324'
const SKIP_EMAIL = process.env.PLAYWRIGHT_SKIP_EMAIL === '1'

// ── Helpers ────────────────────────────────────────────────────────────────
async function latestMailFor(email: string) {
  // Mailpit search API: GET /api/v1/search?query=to:<email>
  const r = await fetch(`${MAILPIT}/api/v1/search?query=to%3A${encodeURIComponent(email)}&limit=1`)
  if (!r.ok) throw new Error(`mailpit search ${r.status}`)
  const json = await r.json() as { messages?: Array<{ ID: string }> }
  const id = json.messages?.[0]?.ID
  if (!id) return null
  const detail = await fetch(`${MAILPIT}/api/v1/message/${id}`)
  if (!detail.ok) return null
  return detail.json() as Promise<{ HTML: string; Text: string; Subject: string }>
}

function recoveryLinkFrom(html: string): string | null {
  // Our recovery / invite templates embed the link both as an <a href=...>
  // and as a plain URL. The anchor is the authoritative source.
  const m = html.match(/href="([^"]*type=recovery[^"]*)"/i)
  return m?.[1] ?? null
}

// ── Scenario 1: basic sign-in + RLS-scoped directory ──────────────────────
test('valid sign-in lands on Home with an RLS-scoped member directory', async ({ page }) => {
  await signIn(page, USERNAME, PASSWORD)

  // The AuthShell animates out and the main app reveals. The "Home" nav
  // label is the stable landmark we can wait on.
  await expect(page.getByText(/^HOME$/i)).toBeVisible({ timeout: 15_000 })

  // Resources → Team Members. The page reads workspace_members through the
  // workspace_directory RPC (Session 4), so a visible roster row proves the
  // whole chain: resolve-login → signInWithPassword →
  // custom_access_token_hook → RLS/RPC-scoped directory read.
  //
  // (The original RABBIT "Smoke Project" assertion needs the supabase
  // adapter, which browser-mode RABBIT doesn't default to — that check
  // returns with the web-build session.)
  //
  // Selector note: the top nav-strip duplicates menu labels but sits under
  // an overlay that eats pointer events; only the real menu tiles contain a
  // sprite with role img — filter on that.
  await page.getByRole('button', { name: 'Resources' }).filter({ has: page.getByRole('img') }).click()
  await page.getByRole('button', { name: /team members/i }).filter({ has: page.getByRole('img') }).click()
  // WILSON's page transition (compress → title-hold → expand) takes ~2.1s,
  // then the directory RPC round-trips.
  await expect(page.getByText(USERNAME).first()).toBeVisible({ timeout: 20_000 })
})

// ── Scenario 2: admin invites a member; invitee sets a password ────────────
test('admin invite flow ends in the invitee setting their password', async ({ page }) => {
  test.skip(SKIP_EMAIL, 'mailpit not reachable; PLAYWRIGHT_SKIP_EMAIL=1')

  const ts = Date.now()
  const inviteeEmail    = `invitee+${ts}@example.test`
  const inviteeUsername = `invitee_${ts}`
  const inviteePassword = `PWchange${ts}!`

  await signIn(page, USERNAME, PASSWORD)
  await expect(page.getByText(/^HOME$/i)).toBeVisible({ timeout: 15_000 })

  // Navigate to TeamMembersPage: it lives in Home's Resources submenu.
  // Same img-filter trick as scenario 1 — the nav-strip titles duplicate the
  // menu labels but sit under an overlay.
  await page.getByRole('button', { name: 'Resources' }).filter({ has: page.getByRole('img') }).click()
  await page.getByRole('button', { name: /team members/i }).filter({ has: page.getByRole('img') }).click()
  await page.getByRole('button', { name: /invite user/i }).click()

  await page.getByLabel('Email').fill(inviteeEmail)
  await page.getByLabel('Username').fill(inviteeUsername)
  await page.getByRole('button', { name: /send invite/i }).click()
  await expect(page.getByText(/invite sent/i)).toBeVisible({ timeout: 10_000 })

  // Pull the invite email from mailpit.
  const mail = await latestMailFor(inviteeEmail)
  expect(mail, 'invite email should exist in mailpit').toBeTruthy()
  expect(mail!.Subject).toContain('invited')
  const link = recoveryLinkFrom(mail!.HTML)
  expect(link, 'invite email must contain a recovery link').toBeTruthy()

  // Follow the link in a fresh context — simulates a different browser.
  await page.goto(link!)
  await expect(page.getByText(/^NEW PASSWORD$/i)).toBeVisible({ timeout: 12_000 })
  await page.getByLabel('New password').fill(inviteePassword)
  await page.getByLabel('Confirm new password').fill(inviteePassword)
  await page.getByRole('button', { name: /set password/i }).click()
  await expect(page.getByText(/password updated/i)).toBeVisible({ timeout: 10_000 })
})

// ── Scenario 3: forgot password → reset → sign in with new password ───────
test('forgot-password delivers a working reset link', async ({ page }) => {
  test.skip(SKIP_EMAIL, 'mailpit not reachable; PLAYWRIGHT_SKIP_EMAIL=1')

  await gotoForgotPassword(page)
  await expect(page.getByText(/^RESET PASSWORD$/i)).toBeVisible({ timeout: 8_000 })

  await page.getByLabel('Username').fill(USERNAME)
  await page.getByRole('button', { name: /send reset link/i }).click()
  await expect(page.getByText(/reset link is on its way/i)).toBeVisible({ timeout: 8_000 })

  // The reset email goes to the resolved address — smoke@example.com for
  // the default smoke_admin seed.
  const mail = await latestMailFor('smoke@example.com')
  expect(mail, 'recovery email should exist in mailpit').toBeTruthy()
  const link = recoveryLinkFrom(mail!.HTML)
  expect(link, 'recovery email must contain a recovery link').toBeTruthy()

  await page.goto(link!)
  await expect(page.getByText(/^NEW PASSWORD$/i)).toBeVisible({ timeout: 12_000 })
  // Rotate to a known password, then immediately rotate back so the suite
  // leaves the DB as it found it (important for CI re-runs).
  const tmp = `TmpRotate${Date.now()}!`
  await page.getByLabel('New password').fill(tmp)
  await page.getByLabel('Confirm new password').fill(tmp)
  await page.getByRole('button', { name: /set password/i }).click()
  await expect(page.getByText(/password updated/i)).toBeVisible({ timeout: 10_000 })

  // Sign in with the new password to prove the rotation took effect.
  await page.goto('/')
  await signIn(page, USERNAME, tmp)
  await expect(page.getByText(/^HOME$/i)).toBeVisible({ timeout: 15_000 })

  // Restore the original password via a second reset round-trip (so
  // subsequent test runs and the issue-session smoke probe keep working).
  await gotoForgotPassword(page)
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByRole('button', { name: /send reset link/i }).click()
  await page.waitForTimeout(500)
  const mail2 = await latestMailFor('smoke@example.com')
  const link2 = recoveryLinkFrom(mail2!.HTML)!
  await page.goto(link2)
  await expect(page.getByText(/^NEW PASSWORD$/i)).toBeVisible({ timeout: 12_000 })
  await page.getByLabel('New password').fill(PASSWORD)
  await page.getByLabel('Confirm new password').fill(PASSWORD)
  await page.getByRole('button', { name: /set password/i }).click()
  await expect(page.getByText(/password updated/i)).toBeVisible({ timeout: 10_000 })
})

// ── Scenario 4 (Track B, B1): username enumeration stays closed ───────────
// RELEASE_TESTING §B `[BLOCKING]`: a wrong password and a username that does
// not exist must fail with the SAME words. Different wording is a
// username-enumeration leak, and the generic string in LoginScreen.jsx must
// never grow a branch that says which of the three inputs was wrong. Timing
// is measured separately (two timed requests, in the B1 commit); this pins
// the wording, which is the half a browser can see.
const GENERIC_ERROR = 'SIGN-IN FAILED. CHECK COMPANY, USERNAME AND PASSWORD.'

test('a wrong password and an unknown username fail with identical wording', async ({ page }) => {
  await page.goto('/')
  await clearCompanyStep(page)

  // Real username, wrong password.
  await page.getByLabel('Username').fill(USERNAME)
  await page.getByLabel('Password').fill(`not-the-password-${Date.now()}`)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByText(GENERIC_ERROR)).toBeVisible({ timeout: 15_000 })

  // Same company, a username nobody has. Submitting clears the error first
  // (LoginScreen does setError('') before the request), so waiting for it to
  // vanish proves the second assertion sees a NEW failure, not the old text.
  await page.getByLabel('Username').fill(`nobody_${Date.now()}`)
  await page.getByLabel('Password').fill('irrelevant-password-1')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByText(GENERIC_ERROR)).toBeHidden({ timeout: 5_000 })
  await expect(page.getByText(GENERIC_ERROR)).toBeVisible({ timeout: 15_000 })

  // Still on step 2 — neither failure sent the person anywhere.
  await expect(page.getByLabel('Password')).toBeVisible()
})

// ── Scenario 5 (B1): the company gate refuses an unknown company ──────────
// One wording, `COMPANY NOT FOUND.`, for a company that does not exist AND
// for one that is suspended (soft-deleted) — the server folds both into
// `exists:false`. CI can only exercise the first; the suspended case is in
// walkthrough 10_sign_in.md for Audrey's staging pass.
test('an unknown company is refused at step 1 and never reaches credentials', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText(/^LOGIN$/)).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Company').fill(`no-such-company-${Date.now()}`)
  await page.getByRole('button', { name: /^continue$/i }).click()
  await expect(page.getByText('COMPANY NOT FOUND.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Username')).toHaveCount(0)

  // B1 review rounds R1 + R2: a star is not a search. PostgREST reads `*` in
  // an ilike pattern as `%`, and before the fix `smo*` resolved the smoke
  // workspace and handed back its slug. The resolver now folds `*` to a
  // one-character `_` and re-checks the returned names for equality — and
  // ONLY the re-check stops this input: the display name minus its last
  // character plus `*` (`Smoke Workspac*`) still matches the row at the
  // database (`Smoke Workspac_`), so this line goes red the moment the
  // re-check is removed. A three-letter prefix would not (R2). Same wording
  // as any other unknown company. Submitting clears the error first, so
  // waiting for it to vanish proves the second assertion sees a new refusal.
  await page.getByLabel('Company').fill(`${WORKSPACE_NAME.slice(0, -1)}*`)
  await page.getByRole('button', { name: /^continue$/i }).click()
  await expect(page.getByText('COMPANY NOT FOUND.')).toBeHidden({ timeout: 5_000 })
  await expect(page.getByText('COMPANY NOT FOUND.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Username')).toHaveCount(0)
})

// ── Scenario 6 (B1): the company is remembered per device, and deep-linkable ─
test('the company is remembered on this device and a deep link pre-fills it', async ({ page }) => {
  await page.goto('/')
  await clearCompanyStep(page)
  // A fresh load of the same browser profile starts with the field filled.
  await page.reload()
  await expect(page.getByText(/^LOGIN$/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Company')).toHaveValue(WORKSPACE)

  // A deep link wins over the remembered value, and is only a pre-fill — the
  // Username field must not appear until step 1 has verified it.
  await page.goto(`/?company=${encodeURIComponent('Deep Link Co')}`)
  await expect(page.getByText(/^LOGIN$/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Company')).toHaveValue('Deep Link Co')
  await expect(page.getByLabel('Username')).toHaveCount(0)
})
