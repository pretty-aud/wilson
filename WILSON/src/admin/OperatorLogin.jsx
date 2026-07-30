// =============================================================================
// OperatorLogin — Session 15: sign-in for the Platform Operator Console.
//
// EMAIL, not username. WILSON's product login is username-first (locked #2):
// resolve-login turns company-slug + username into an email. A platform
// operator has no company — that is the definition of the tier — so there is
// nothing for the resolver to resolve. Email + password + TOTP it is, and
// this is the one place in the product where that is the correct flow rather
// than a regression.
//
// MFA is not optional here. operatorGuard refuses any operator without a
// verified TOTP factor and any token below aal2, so the challenge stage is
// the normal path, not an edge case. An operator who has not enrolled is
// told exactly where to go and why.
//
// UX laws applied (≥5): Jakob's Law (a plain centred email/password card —
// every admin console on earth looks like this, and inventing something for
// a once-a-month sign-in would be pure cost); Cognitive Load (two fields,
// no branding, no marketing, nothing to read); Doherty Threshold (the button
// states its own progress and the code field autofocuses the moment the
// stage flips); Postel's Law (the code input accepts spaces and strips
// them, and the email is trimmed and lowercased); Peak-End (a failed code
// clears the field and keeps focus rather than dumping the operator back to
// the password step, which is the moment this flow would otherwise feel
// worst).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../cloud/auth/supabaseClient'
import { saveSession } from '../cloud/auth/sessionStorage'

// Deliberately identical for wrong-email, wrong-password and not-an-operator.
// The console's URL is not a secret, so its error copy must not confirm which
// addresses exist or which of them hold platform privilege.
const GENERIC_ERROR = 'Sign-in failed. Check your details and try again.'

export default function OperatorLogin({ onSignedIn }) {
  const [stage, setStage] = useState('auth')   // 'auth' | 'mfa'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [factorId, setFactorId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const codeRef = useRef(null)

  useEffect(() => {
    if (stage === 'mfa') codeRef.current?.focus()
  }, [stage])

  const handlePassword = useCallback(async (e) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (signInErr || !data.session) {
        setError(GENERIC_ERROR)
        setBusy(false)
        return
      }

      // Upgrade to aal2 BEFORE handing the session on — every operator Edge
      // Function requires it, so an aal1 session here would look signed in
      // and then fail on the first action.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        const { data: factors } = await supabase.auth.mfa.listFactors()
        const totp = (factors?.totp ?? []).find((f) => f.status === 'verified')
        if (totp) {
          setFactorId(totp.id)
          setCode('')
          setStage('mfa')
          setBusy(false)
          return
        }
      }

      // No verified factor. The guard would refuse this session anyway; say
      // so now, with the actual remedy, instead of after a confusing 403.
      // scope: 'local' — a global sign-out here would also revoke the same
      // person's /wilson session in another tab, punishing them for trying
      // the wrong door.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      setError(
        'The operator console requires two-factor authentication. Enrol an authenticator in WILSON → Settings → Security, then sign in here again.',
      )
      setBusy(false)
    } catch {
      setError(GENERIC_ERROR)
      setBusy(false)
    }
  }, [busy, email, password])

  const handleCode = useCallback(async (e) => {
    e?.preventDefault()
    if (busy || !factorId) return
    const clean = code.replace(/\s+/g, '')
    if (!/^[0-9]{6}$/.test(clean)) {
      setError('Enter the six-digit code from your authenticator.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId })
      if (chErr || !ch?.id) throw chErr ?? new Error('challenge failed')
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: ch.id,
        code: clean,
      })
      if (vErr) {
        setError('Code rejected. Try again.')
        setCode('')
        setBusy(false)
        return
      }
      const { data: fresh } = await supabase.auth.getSession()
      const session = fresh?.session
      if (!session) {
        setError(GENERIC_ERROR)
        setBusy(false)
        return
      }
      await saveSession(session)
      onSignedIn(session)
    } catch {
      setError('Code rejected. Try again.')
      setBusy(false)
    }
  }, [busy, factorId, code, onSignedIn])

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: '#1c1917' }}
    >
      <div className="w-full" style={{ maxWidth: '380px' }}>
        <div className="mb-6">
          <h1
            className="text-sm font-bold uppercase tracking-widest"
            style={{ color: '#f4a261' }}
          >
            WILSON Operator Console
          </h1>
          <p className="text-xs mt-1" style={{ color: '#a8a29e' }}>
            Platform administration. Not the company admin terminal.
          </p>
        </div>

        <form
          onSubmit={stage === 'auth' ? handlePassword : handleCode}
          className="p-5 rounded-sm"
          style={{ backgroundColor: 'rgba(120, 70, 30, 0.18)', border: '1px solid rgba(120, 70, 30, 0.4)' }}
        >
          {stage === 'auth' ? (
            <>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#a8a29e' }}>
                Email
              </label>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError('') }}
                disabled={busy}
                className="w-full px-3 py-2 mb-4 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: 'rgba(0,0,0,0.35)', color: '#fde8d0', border: 'none' }}
              />
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#a8a29e' }}>
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                disabled={busy}
                className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: 'rgba(0,0,0,0.35)', color: '#fde8d0', border: 'none' }}
              />
            </>
          ) : (
            <>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#a8a29e' }}>
                Authenticator code
              </label>
              <input
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={code}
                onChange={(e) => { setCode(e.target.value); setError('') }}
                disabled={busy}
                className="w-full px-3 py-2 text-lg font-mono tracking-[0.4em] text-center rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: 'rgba(0,0,0,0.35)', color: '#fde8d0', border: 'none' }}
              />
            </>
          )}

          {error && (
            <p className="text-[11px] mt-3 leading-relaxed" style={{ color: '#fca5a5' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full mt-5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40"
            style={{ backgroundColor: '#ea580c', color: '#fff' }}
          >
            {busy ? 'Working…' : stage === 'auth' ? 'Sign in' : 'Verify'}
          </button>
        </form>
      </div>
    </div>
  )
}
