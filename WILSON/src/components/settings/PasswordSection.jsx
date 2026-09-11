// =============================================================================
// PasswordSection — change the signed-in user's password, in-app.
//
// Session 21. Session 15 deleted the previous panel for a good reason: it drove
// /api/auth/change, which edited a plaintext credential in
// otter-data/wilson-auth.json that nothing had checked since the Supabase login
// landed in S2 (MASTER_PLAN §6 #32). A control that grants nothing is worse
// than no control, so the panel became a line of copy pointing at "Forgot
// password" on the sign-in screen. This wires it to Supabase for real.
//
// -----------------------------------------------------------------------------
// WHY THERE IS NO "CURRENT PASSWORD" FIELD
// -----------------------------------------------------------------------------
// The obvious design asks for the current password and verifies it. There is no
// client-side Supabase call that checks a password WITHOUT replacing the
// session: the only candidate is signInWithPassword, and it returns a fresh
// session at aal1.
//
// That is not acceptable here. OperatorLogin.jsx:69 upgrades to aal2 precisely
// because "every operator Edge Function requires it, so an aal1 session here
// would look signed in" — so verifying a password this way would silently
// downgrade an MFA session and break every operator surface, with the user
// still appearing signed in. That is the exact failure shape this codebase
// keeps paying for.
//
// The correct mechanism is supabase.auth.reauthenticate() — it issues a nonce
// by email and does not touch the AAL. It is not usable yet: the auth email
// templates are uploaded on STAGING only, and dev and prod would send nothing
// or an unstyled default. When the templates land everywhere, the upgrade is
// to call reauthenticate() and pass the nonce to updateUser().
//
// Until then this matches ResetPasswordWizard.jsx:168 exactly — a plain
// updateUser({ password }) on an already-authenticated session. If the project
// has "Secure password change" switched on, GoTrue enforces session recency
// itself and its error is surfaced verbatim rather than swallowed.
//
// -----------------------------------------------------------------------------
// The session read is bounded. Every await on the auth path gets a ceiling for
// the reason withTimeout.js:12 gives — a rejected promise is recoverable, a
// pending one strands the panel with no error and nothing in the console.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { withTimeout, AUTH_TIMEOUT_MS } from '../../cloud/auth/withTimeout'
import './settings.css'
import { Section, Group, Row } from './SettingsChrome'
import { Button, Input } from '../../ui'

// Mirrors ResetPasswordWizard.jsx:158 — one rule for the whole app, so a
// password accepted at reset is accepted here.
const MIN_LEN = 10
const MAX_LEN = 128

export default function PasswordSection() {
  const [email, setEmail] = useState('')
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Is there a cloud session at all? Local-only mode has no password to change,
  // and offering a form that cannot work is the thing S15 removed.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await withTimeout(
          supabase.auth.getSession(), AUTH_TIMEOUT_MS, 'reading your session',
        )
        if (cancelled) return
        setEmail(res?.data?.session?.user?.email || '')
      } catch {
        // A stalled read is not "signed out" — leave email empty and let the
        // panel fall back to the honest copy rather than claiming either.
        if (!cancelled) setEmail('')
      } finally {
        // Runs on BOTH paths, which is the whole point: the S17 rule is that no
        // loading flag is cleared only on the success branch.
        if (!cancelled) setChecking(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy) return
    if (password.length < MIN_LEN || password.length > MAX_LEN) {
      setError(`Password must be ${MIN_LEN}–${MAX_LEN} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true); setError(''); setDone(false)
    try {
      const { error: upErr } = await withTimeout(
        supabase.auth.updateUser({ password }), AUTH_TIMEOUT_MS, 'changing your password',
      )
      if (!mountedRef.current) return
      if (upErr) {
        setError(upErr.message || 'Could not change your password.')
        return
      }
      // The session stays valid and stays at its current AAL — updateUser does
      // not re-issue it. Deliberately no sign-out: the reset wizard signs out
      // because it runs from a one-time link with nowhere to return to, but
      // ejecting someone from a settings page they are mid-way through is
      // hostile and teaches nothing.
      setPassword(''); setConfirm(''); setDone(true)
    } catch (err) {
      if (mountedRef.current) setError(err?.message ?? 'Unknown error.')
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [busy, password, confirm])

  // The fourth verbatim copy of one inputStyle object, and the second of
  // inputClass/labelClass, are gone: both now come from the kit (S3, U4).
  return (
    <Section title="Change password">
      {checking ? (
        <p className="s-row-desc">Checking your account…</p>
      ) : !email ? (
        // Unchanged from what S15 left here — still the true thing to say when
        // there is no cloud session behind this window.
        <p className="s-row-desc">
          Your password is managed by your workspace account. Use “Forgot
          password” on the sign-in screen to reset it, or ask a workspace admin.
        </p>
      ) : (
        <>
          <p className="s-row-desc mb-4">
            Changing the password for <span className="s-data">{email}</span>.
            Must be {MIN_LEN}–{MAX_LEN} characters. You will stay signed in on
            this device; other devices keep their existing sessions until those
            expire.
          </p>

          {/* A2: this form was max-w-md (448px) inside a 672px column under
              paragraphs that ran the full 672px, so one scroll had three
              different right edges. It is on the page's one measure now, and
              its fields are rows like every other setting. */}
          <form onSubmit={handleSubmit}>
            <Group>
              <Row label="New password" htmlFor="pw-new" stacked>
                <Input
                  id="pw-new"
                  surface="light"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(v) => { setPassword(v); setError(''); setDone(false) }}
                  disabled={busy}
                  className="w-full"
                />
              </Row>

              <Row label="Confirm new password" htmlFor="pw-confirm" stacked>
                <Input
                  id="pw-confirm"
                  surface="light"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(v) => { setConfirm(v); setError(''); setDone(false) }}
                  disabled={busy}
                  className="w-full"
                />
              </Row>

              <Row label="Apply">
                <Button
                  surface="light"
                  size="sm"
                  variant="primary"
                  type="submit"
                  disabled={busy || !password || !confirm}
                >
                  {busy ? 'Changing…' : 'Change password'}
                </Button>
              </Row>
            </Group>

            {/* S10: 'Password changed.' was #15803d on #f4a261 — 2.60:1 —
                and the error #b91c1c at 3.14:1. Both keep the page's ink and
                carry their meaning on the left edge. */}
            {done && (
              <p className="s-feedback mt-4" data-tone="ok" role="status">Password changed.</p>
            )}
            {error && (
              <p className="s-feedback mt-4" data-tone="error" role="alert">{error}</p>
            )}
          </form>
        </>
      )}
    </Section>
  )
}
