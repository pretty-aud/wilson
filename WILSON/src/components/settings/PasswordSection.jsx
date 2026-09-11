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
import { LIGHT_INK } from '../lightSurface'

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

  const inputStyle = { backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0', border: 'none' }
  const inputClass = 'w-full px-3 py-2 text-xs font-mono rounded-sm focus:ring-2 focus:ring-orange-500'
  const labelClass = 'block text-[11px] font-bold uppercase tracking-wider mb-1.5'

  return (
    <div>
      <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
        Change Password
      </h2>

      {checking ? (
        <p className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>
          Checking your account…
        </p>
      ) : !email ? (
        // Unchanged from what S15 left here — still the true thing to say when
        // there is no cloud session behind this window.
        <p className="text-xs text-stone-950 mb-4 leading-relaxed">
          Your password is managed by your workspace account. Use “Forgot
          password” on the sign-in screen to reset it, or ask a workspace admin.
        </p>
      ) : (
        <>
          <p className="text-xs text-stone-950 mb-4 leading-relaxed">
            Changing the password for <span className="font-mono">{email}</span>.
            Must be {MIN_LEN}–{MAX_LEN} characters. You will stay signed in on
            this device; other devices keep their existing sessions until those
            expire.
          </p>

          <form onSubmit={handleSubmit} className="max-w-md space-y-3">
            <div>
              <label className={labelClass} style={{ color: LIGHT_INK }} htmlFor="pw-new">
                New password
              </label>
              <input
                id="pw-new"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); setDone(false) }}
                disabled={busy}
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={{ color: LIGHT_INK }} htmlFor="pw-confirm">
                Confirm new password
              </label>
              <input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setError(''); setDone(false) }}
                disabled={busy}
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={busy || !password || !confirm}
                className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-50"
                style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
              >
                {busy ? 'Changing…' : 'Change Password'}
              </button>
              {done && (
                <span className="text-xs font-mono" style={{ color: '#15803d' }}>
                  Password changed.
                </span>
              )}
            </div>

            {error && (
              <p className="text-xs font-mono" style={{ color: '#b91c1c' }} role="alert">
                {error}
              </p>
            )}
          </form>
        </>
      )}
    </div>
  )
}
