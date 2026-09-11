// =============================================================================
// LoginScreen — terminal-aesthetic sign-in, built on AuthShell.
//
// Four stages:
//   1. 'company'   — ONE input: the company. Shape-checked and remembered;
//                    see "Why the company step does not phone home" below.
//   2. 'auth'      — USERNAME + PASSWORD for that company. On submit:
//                      a. POST /functions/v1/resolve-login with the username
//                         AND the workspace slug → { exists, email }. Server
//                         replies in constant time.
//                      b. supabase.auth.signInWithPassword({ email, password }).
//                         If the username/company pair was unknown, we sign in
//                         against an unreachable fake email so request timing
//                         still looks like a real attempt (prevents username
//                         enumeration).
//                      c. Fetch workspace memberships. One workspace → reveal
//                         the app; more than one → advance to stage 4.
//   3. 'mfa'       — TOTP challenge, between password success and everything
//                    else (the challenge upgrades the session to aal2).
//   4. 'workspace' — list of the user's active workspaces. Arrow keys move the
//                    cursor, Enter selects. `issue-session` sets the active
//                    workspace; refreshSession picks up the new JWT claims.
//
// Session 43 split stages 1 and 2 apart. Audrey, 2026-08-10: "first the user
// should enter the company name … after the user enters the company … then
// the user should see the name and password entry." One line visible at a
// time, which is also the shape the screen had before the username input was
// added to it. Hick's Law: one decision per step. Chunking: the company is a
// different KIND of fact from the credential.
//
// 🚨 The company IS a gate, and that was a decision with a cost
//   Audrey, 2026-08-10, after testing a wrong company and being let in:
//   "the user has to enter the company, the system should verify that company
//   exists, the login after the company should only allow users of that
//   company to login."
//
//   So step 1 asks resolve-login whether the company exists, and step 2 sends
//   the canonical slug the server returned with NO fallback. A member of
//   another workspace cannot get past step 2 no matter what they type.
//
//   The cost, stated once so it is not rediscovered as a surprise: this is a
//   company-existence oracle. Anyone holding the anon key — which the web app
//   ships — can now test whether a company is a customer. It is bounded by
//   the same per-IP limiter and the same ~180ms constant-time floor as the
//   username path, and returns only a boolean plus the slug. An earlier
//   revision avoided the oracle by never checking, and the result was that a
//   wrong company signed you in; that was rejected. This is the trade Audrey
//   chose, with the alternative on the table.
//
//   🚨 THE USERNAME PATH'S DEFENCE IS UNTOUCHED and must stay that way: one
//   generic error for every failure, and a fake-email sign-in so an unknown
//   username takes the same time as a known one. Verifying a COMPANY does not
//   license leaking anything about a PERSON.
//
// ⚠️ Requires the deployed resolve-login to understand `{company}` (contract
//   v2). Against an older deployment the client degrades to a derived slug and
//   warns in the console — the gate is not enforced until it is deployed.
//
// Security notes:
//   - The same generic error is used for every failure mode below rate-limiting.
//   - Response-body shape + timing are uniform across found / not-found /
//     rate-limited (the Edge Function's job; we just mirror that here).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { saveSession } from './sessionStorage'
import AuthShell, {
  AUTH_TEXT_STYLE,
  AUTH_TITLE_STYLE,
  AUTH_INPUT_STYLE,
  AUTH_BUTTON_STYLE,
  AUTH_LINK_STYLE,
  AUTH_HINT_STYLE,
  AUTH_ERROR_STYLE,
  AUTH_GAP_BETWEEN_FIELDS,
  AuthField,
  AuthPasswordInput,
} from './AuthShell'
import { SLUG_RE, slugifyWorkspace } from './workspaceSlug'
import { withTimeout, AUTH_TIMEOUT_MS } from './withTimeout'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

// Session 43: names the company too. The company is now one of the things the
// user supplied, so a message that lists only two of the three sends someone
// with a mistyped company round a loop that cannot succeed. This is the
// generic error — it stays generic, and it must never grow a branch that
// says WHICH of the three was wrong.
const GENERIC_ERROR = 'SIGN-IN FAILED. CHECK COMPANY, USERNAME AND PASSWORD.'

async function resolveLogin({ username, workspaceSlug }) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/resolve-login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON,
    },
    body: JSON.stringify({
      username,
      ...(workspaceSlug ? { workspace_slug: workspaceSlug } : {}),
    }),
  })
  if (!res.ok) return { exists: false, email: null }
  return res.json()
}

// Step 1's existence check (Session 43, Audrey: "the system should verify that
// company exists"). Returns the CANONICAL slug so step 2 matches the workspace
// exactly, whether the person typed the display name or the slug.
//
// `unavailable` is not a refusal. An older deployment of resolve-login answers
// `{exists:false}` to any body without a username, which looks identical to
// "no such company" — so the contract version is what separates "this company
// is not real" from "this function has not been deployed yet". Without that
// distinction, shipping this client before the function would lock out every
// user instead of degrading to the previous behaviour.
async function verifyCompany(company) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/resolve-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON },
      body: JSON.stringify({ company }),
    })
    if (!res.ok) return { unavailable: true }
    const data = await res.json()
    if (data?.v !== 2) return { unavailable: true }
    return { unavailable: false, exists: !!data.exists, slug: data.slug ?? null }
  } catch {
    return { unavailable: true }
  }
}

async function issueSession(accessToken, workspaceId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/issue-session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON,
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(workspaceId ? { workspace_id: workspaceId } : {}),
  })
  if (!res.ok) return null
  return res.json()
}

// Read the user's memberships after sign-in. RLS on workspaces restricts this
// to rows the user can actually see (see supabase/migrations/0002_rls_workspaces.sql).
async function fetchUserWorkspaces() {
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, name, slug')
    .order('name', { ascending: true })
  if (error) return []
  return data ?? []
}

export default function LoginScreen({ onAuthenticated, onForgotPassword }) {
  // ── Shell phase gate ───────────────────────────────────────────────────
  const [ready, setReady]         = useState(false)
  const [revealing, setRevealing] = useState(false)

  // ── Auth flow state ───────────────────────────────────────────────────
  const [stage, setStage]                   = useState('company')
  // Raw as typed, so the field does not fight the user mid-word. Slugified
  // on submit only.
  const [company, setCompany]               = useState('')
  const [companySlug, setCompanySlug]       = useState('')
  const [username, setUsername]             = useState('')
  const [password, setPassword]             = useState('')
  const [error, setError]                   = useState('')
  const [busy, setBusy]                     = useState(false)
  const [pendingSession, setPendingSession] = useState(null)
  const [workspaces, setWorkspaces]         = useState([])
  const [workspaceIndex, setWorkspaceIndex] = useState(0)
  const [mfaFactorId, setMfaFactorId]       = useState(null)
  const [mfaCode, setMfaCode]               = useState('')

  const finalSessionRef = useRef(null)
  // Session 17: the reveal handoff is guarded so exactly one of the two paths
  // (animation callback, or the fallback timer) completes the sign-in.
  const revealFallbackRef = useRef(null)
  const completedRef = useRef(false)
  useEffect(() => () => { if (revealFallbackRef.current) clearTimeout(revealFallbackRef.current) }, [])
  const companyInputRef = useRef(null)
  const usernameInputRef = useRef(null)
  const mfaInputRef = useRef(null)

  // Focus the step's first field when the shell settles and on every step
  // change. Paradox of the Active User: nobody reads an instruction telling
  // them where to type.
  useEffect(() => {
    if (!ready) return
    if (stage === 'company') companyInputRef.current?.focus()
    if (stage === 'auth')    usernameInputRef.current?.focus()
    if (stage === 'mfa')     mfaInputRef.current?.focus()
  }, [ready, stage])

  // ── Handlers ──────────────────────────────────────────────────────────
  const completeSignIn = useCallback(async (session, workspaceId) => {
    try {
      let effectiveSession = session
      // Only round-trip through issue-session + refresh when the user is
      // explicitly choosing a different workspace. For a single-workspace
      // user the custom_access_token_hook has already baked the right
      // workspace_id into the token returned by signInWithPassword; extra
      // calls would just burn a request and (per Session 1) currently 401.
      if (workspaceId) {
        await withTimeout(issueSession(session.access_token, workspaceId),
          AUTH_TIMEOUT_MS, 'issue-session')
        const { data: refreshed, error: refreshErr } = await withTimeout(
          supabase.auth.refreshSession(), AUTH_TIMEOUT_MS, 'session refresh')
        if (!refreshErr && refreshed?.session) effectiveSession = refreshed.session
      }
      await withTimeout(saveSession({
        access_token:  effectiveSession.access_token,
        refresh_token: effectiveSession.refresh_token,
        expires_at:    effectiveSession.expires_at,
        user:          effectiveSession.user,
      }), AUTH_TIMEOUT_MS, 'session save')
      finalSessionRef.current = effectiveSession
      setRevealing(true)
      // Session 17 — the handoff safety net. `busy` is deliberately NOT
      // cleared here: the success path ends by handing off to AuthShell's
      // reveal animation, which calls onAnimationComplete -> onAuthenticated.
      // If that handoff does not happen the user is stranded on "VERIFYING…"
      // over a screen AuthShell has already torn down (it returns null once
      // its phase reaches 'done'), which renders as a bare orange window.
      // The animation is 1s; 4s of grace, then complete it ourselves.
      // onAuthenticated is idempotent in App.jsx (it sets state), so a double
      // call is harmless — a stranded session is not.
      if (revealFallbackRef.current) clearTimeout(revealFallbackRef.current)
      revealFallbackRef.current = setTimeout(() => {
        if (!completedRef.current) {
          completedRef.current = true
          console.warn('[wilson] reveal handoff did not fire — completing sign-in directly')
          onAuthenticated?.(finalSessionRef.current)
        }
      }, 4000)
    } catch (err) {
      console.warn('[wilson] completeSignIn failed:', err?.message ?? err)
      setError(err?.name === 'TimeoutError'
        ? 'THE SERVER DID NOT RESPOND. CHECK YOUR CONNECTION AND TRY AGAIN.'
        : GENERIC_ERROR)
      setBusy(false)
    }
  }, [onAuthenticated])

  // Step 1. Verifies the company exists and captures its CANONICAL slug, so
  // step 2 can be a real gate rather than a suggestion.
  const handleCompanySubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy) return
    const typed = company.trim()
    if (typed.length < 2 || typed.length > 80) {
      setError('ENTER YOUR COMPANY.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await verifyCompany(typed)

      // Not deployed yet → degrade to the derived slug rather than refusing a
      // company that is perfectly real. Loud in the console, because in this
      // state the gate is NOT enforced.
      if (result.unavailable) {
        console.warn(
          '[wilson] company verification unavailable — deploy the resolve-login '
          + 'Edge Function (supabase functions deploy resolve-login). Falling back '
          + 'to a derived slug; the company gate is NOT enforced until then.',
        )
        setCompanySlug(slugifyWorkspace(typed))
        setStage('auth')
        return
      }

      if (!result.exists || !SLUG_RE.test(result.slug ?? '')) {
        setError('COMPANY NOT FOUND.')
        return
      }
      setCompanySlug(result.slug)
      setStage('auth')
    } finally {
      setBusy(false)
    }
  }, [busy, company])

  // Step 2. resolve username (+ company) → email → signInWithPassword →
  // either reveal (1 workspace) or advance to chooser (>1 workspace).
  const handleAuthSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy) return
    const u = username.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(u) || password.length === 0) {
      setError(GENERIC_ERROR)
      return
    }
    setBusy(true)
    setError('')
    try {
      // 🚨 SCOPED ONLY — NO FALLBACK. This is what makes the company a gate.
      //
      // Audrey, 2026-08-10, after testing a wrong company and being let in:
      // "the login after the company should only allow users of that company
      // to login." A retry without the slug would sign in any single-workspace
      // user regardless of what they typed, which is exactly the behaviour she
      // rejected. Do not re-add it.
      //
      // This is only safe because step 1 now VERIFIES the company and captures
      // its canonical slug — `companySlug` is a slug the server returned, not
      // one derived from what was typed. A slug-shaped guess would refuse
      // every real company (measured: four of four workspaces on wilson-dev
      // have a slug no derivation of their name produces — "Petal Studios" is
      // `petal`). If step 1 ever stops verifying, this line locks everyone out.
      const { exists, email: resolved } = await resolveLogin({
        username: u,
        workspaceSlug: companySlug,
      })
      // If resolver says "not found", sign in with an unreachable email so the
      // request timing still looks like a real attempt (prevents username
      // enumeration via response time).
      const email = exists ? resolved : `__miss+${crypto.randomUUID()}@invalid.local`

      const { data, error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
      if (signInErr || !data.session) {
        setError(GENERIC_ERROR)
        setBusy(false)
        return
      }
      setPendingSession(data.session)

      // Session 9 (locked #9): enrolled users clear the TOTP challenge
      // BEFORE workspace resolution or reveal — the challenge upgrades the
      // session to aal2, which the admin Edge Functions require.
      try {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
          const { data: factors } = await supabase.auth.mfa.listFactors()
          const totp = (factors?.totp ?? []).find(f => f.status === 'verified')
          if (totp) {
            setMfaFactorId(totp.id)
            setMfaCode('')
            setStage('mfa')
            setBusy(false)
            return
          }
        }
      } catch { /* unenrolled (or MFA API unavailable) → proceed as aal1 */ }

      const ws = await fetchUserWorkspaces()
      if (ws.length > 1) {
        setWorkspaces(ws)
        setWorkspaceIndex(0)
        setStage('workspace')
        setBusy(false)
      } else {
        await completeSignIn(data.session, null)
      }
    } catch {
      setError(GENERIC_ERROR)
      setBusy(false)
    }
  }, [busy, username, password, companySlug, completeSignIn])

  // ── Dev auto sign-in ──────────────────────────────────────────────────
  // Audrey, 2026-09-11 (UI overhaul F1): "i cant login for testing, can you
  // just make dev tool to bypass the login … a defaulted account called
  // tester. that way you can bypass needing a password."
  //
  // 🚨 DEV BUILDS ONLY. `import.meta.env.DEV` is a compile-time constant, so
  // `vite build` (the installer, the beta, Vercel) drops this whole effect;
  // there is no runtime switch that can turn it on in a shipped build. The
  // credentials live in the gitignored .env.local and nowhere else:
  //
  //   VITE_DEV_AUTOLOGIN=1
  //   VITE_DEV_AUTOLOGIN_COMPANY=smoke          # the seeded workspace on wilson-dev
  //   VITE_DEV_AUTOLOGIN_USERNAME=smoke_admin   # or any test user in it
  //   VITE_DEV_AUTOLOGIN_PASSWORD=…
  //
  // It walks the SAME two steps a person does — company verified, username
  // resolved, signInWithPassword — so the company gate is not bypassed, only
  // the typing is; a session without a real sign-in would see nothing (every
  // row is behind RLS). An MFA-enrolled account stops at the TOTP step like
  // anyone else. Any failure leaves the normal screen up with the fields
  // prefilled and the generic error, and says why in the console.
  const autoLoginRan = useRef(false)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (import.meta.env.VITE_DEV_AUTOLOGIN !== '1') return
    if (!ready || autoLoginRan.current) return
    const co = String(import.meta.env.VITE_DEV_AUTOLOGIN_COMPANY || '').trim()
    const u = String(import.meta.env.VITE_DEV_AUTOLOGIN_USERNAME || '').trim().toLowerCase()
    const pw = String(import.meta.env.VITE_DEV_AUTOLOGIN_PASSWORD || '')
    if (!co || !u || !pw) {
      console.warn('[wilson] VITE_DEV_AUTOLOGIN=1 but COMPANY / USERNAME / PASSWORD are not all set in .env.local')
      return
    }
    autoLoginRan.current = true
    console.warn(`[wilson] DEV auto sign-in as ${u} @ ${co} (VITE_DEV_AUTOLOGIN; dev builds only)`)
    setCompany(co)
    setUsername(u)
    // The password is used from the local `pw` only — never set into state:
    // a controlled <input type="password"> reflects its value into the DOM
    // attribute, readable in the Elements panel (review round 2).
    setBusy(true)
    setError('')
    ;(async () => {
      try {
        const v = await verifyCompany(co)
        const slug = v.unavailable
          ? slugifyWorkspace(co)
          : (v.exists && SLUG_RE.test(v.slug ?? '') ? v.slug : null)
        if (!slug) { setError('COMPANY NOT FOUND.'); setBusy(false); return }
        setCompanySlug(slug)
        setStage('auth')
        const { exists, email } = await resolveLogin({ username: u, workspaceSlug: slug })
        if (!exists) { setError(GENERIC_ERROR); setBusy(false); return }
        const { data, error: signInErr } = await supabase.auth.signInWithPassword({ email, password: pw })
        if (signInErr || !data.session) { setError(GENERIC_ERROR); setBusy(false); return }
        setPendingSession(data.session)
        try {
          const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
          if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
            const { data: factors } = await supabase.auth.mfa.listFactors()
            const totp = (factors?.totp ?? []).find(f => f.status === 'verified')
            if (totp) { setMfaFactorId(totp.id); setMfaCode(''); setStage('mfa'); setBusy(false); return }
          }
        } catch { /* unenrolled (or MFA API unavailable) → proceed as aal1 */ }
        const ws = await fetchUserWorkspaces()
        const match = ws.find(w => w.slug === slug)
        if (ws.length > 1 && !match) {
          setWorkspaces(ws); setWorkspaceIndex(0); setStage('workspace'); setBusy(false); return
        }
        await completeSignIn(data.session, ws.length > 1 && match ? match.id : null)
      } catch (err) {
        console.warn('[wilson] DEV auto sign-in failed:', err?.message ?? err)
        setError(GENERIC_ERROR)
        setBusy(false)
      }
    })()
  }, [ready, completeSignIn])

  // TOTP verify → the SDK swaps in an aal2 session; continue exactly where
  // the password path left off (chooser vs reveal).
  const handleMfaSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (busy || !mfaFactorId) return
    const code = mfaCode.replace(/\s+/g, '')
    if (!/^[0-9]{6}$/.test(code)) {
      setError('CODE REJECTED. TRY AGAIN.')
      return
    }
    setBusy(true)
    setError('')
    try {
      // Session 17: every await here is bounded. Unbounded, a hung GoTrue
      // call left this button reading "Verifying…" forever with no error —
      // and the verify had usually already SUCCEEDED server-side, so the
      // user was locked out of an account that was working fine.
      const { data: ch, error: chErr } = await withTimeout(
        supabase.auth.mfa.challenge({ factorId: mfaFactorId }),
        AUTH_TIMEOUT_MS, 'MFA challenge')
      if (chErr || !ch?.id) throw chErr ?? new Error('challenge failed')
      const { data: vData, error: vErr } = await withTimeout(
        supabase.auth.mfa.verify({ factorId: mfaFactorId, challengeId: ch.id, code }),
        AUTH_TIMEOUT_MS, 'MFA verify')
      if (vErr) {
        setError('CODE REJECTED. TRY AGAIN.')
        setMfaCode('')
        setBusy(false)
        return
      }
      // Session 17: use the session mfa.verify() RETURNS. We used to discard
      // it and call getSession() instead, which deadlocked: auth-js guards
      // every auth call with a navigator lock keyed on storageKey, and
      // getSession() contended for the lock verify() was still holding. The
      // symptom was brutal to diagnose because verify had ALREADY SUCCEEDED —
      // staging showed 4 challenges, 0 unverified — so the server was fine and
      // only the client hung, for the full timeout, every time.
      //
      // The extra round trip was never needed: verify() resolves with the
      // upgraded aal2 session. getSession() remains only as a fallback for an
      // auth-js version that omits it.
      let session = vData?.access_token ? vData : null
      if (!session) {
        const { data: fresh } = await withTimeout(
          supabase.auth.getSession(), AUTH_TIMEOUT_MS, 'session read')
        session = fresh?.session ?? null
      }
      if (!session) {
        setError(GENERIC_ERROR)
        setBusy(false)
        return
      }
      setPendingSession(session)
      const ws = await fetchUserWorkspaces()
      if (ws.length > 1) {
        setWorkspaces(ws)
        setWorkspaceIndex(0)
        setStage('workspace')
        setBusy(false)
      } else {
        await completeSignIn(session, null)
      }
    } catch (err) {
      // A timeout is NOT a rejected code, and telling the user their code was
      // wrong when the network stalled sends them round a loop that cannot
      // succeed. Distinguish them.
      setError(err?.name === 'TimeoutError'
        ? 'THE SERVER DID NOT RESPOND. CHECK YOUR CONNECTION AND TRY AGAIN.'
        : 'CODE REJECTED. TRY AGAIN.')
      setMfaCode('')
      setBusy(false)
    }
  }, [busy, mfaFactorId, mfaCode, completeSignIn])

  const handleWorkspaceChoose = useCallback(async (wsId) => {
    if (busy || !pendingSession) return
    setBusy(true)
    setError('')
    await completeSignIn(pendingSession, wsId)
  }, [busy, pendingSession, completeSignIn])

  // Back to the company step. State is kept, so the company is still in the
  // field to be corrected — Working Memory: nobody should have to re-type
  // something they already told us.
  const handleChangeCompany = useCallback(() => {
    setError('')
    setPassword('')
    setStage('company')
  }, [])

  // Arrow-key navigation for the workspace chooser.
  useEffect(() => {
    if (stage !== 'workspace') return
    const onKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setWorkspaceIndex((i) => {
          const delta = e.key === 'ArrowDown' ? 1 : -1
          return (i + delta + workspaces.length) % workspaces.length
        })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const chosen = workspaces[workspaceIndex]
        if (chosen) handleWorkspaceChoose(chosen.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, workspaces, workspaceIndex, handleWorkspaceChoose])

  // ── Render helpers ────────────────────────────────────────────────────
  const formStyle = {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: AUTH_GAP_BETWEEN_FIELDS,
  }
  const submitStyle = {
    ...AUTH_BUTTON_STYLE,
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.55 : 1,
    transition: `opacity 150ms ease-out, transform 100ms ease-out`,
  }
  const press = {
    onMouseDown: (e) => !busy && (e.currentTarget.style.transform = 'scale(0.98)'),
    onMouseUp:   (e) => (e.currentTarget.style.transform = 'scale(1)'),
    onMouseLeave:(e) => (e.currentTarget.style.transform = 'scale(1)'),
  }

  return (
    <AuthShell
      isRevealing={revealing}
      onIntroComplete={() => setReady(true)}
      onAnimationComplete={() => {
        if (completedRef.current) return
        completedRef.current = true
        if (revealFallbackRef.current) clearTimeout(revealFallbackRef.current)
        onAuthenticated?.(finalSessionRef.current)
      }}
      showLogoIntro
      playStartupSound={true}
    >
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '18px', minWidth: '320px',
      }}>
        {/* Static title — and it must stay OUTSIDE the keyed block below, or
            it animates on every step change. That is exactly what the first
            attempt at this did. In reveal, the parent fades the whole block. */}
        <div style={AUTH_TITLE_STYLE}>LOGIN</div>

        {/* The step swap. `key={stage}` remounts on every change so the CSS
            entrance in .auth-step (index.css) re-runs; the outgoing step is
            simply gone. No effect, no timer, no ordering problem — see the
            note in AuthShell where the old motion tokens used to live. */}
        <div
          key={stage}
          className="auth-step"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}
        >

        {/* ── Step 1: COMPANY ── one input, one action ────────────────── */}
        {stage === 'company' && (
          <form onSubmit={handleCompanySubmit} style={formStyle}>
            <AuthField label="COMPANY">
              <input
                ref={companyInputRef}
                type="text"
                autoComplete="organization"
                value={company}
                onChange={(e) => setCompany(e.target.value.slice(0, 80))}
                style={AUTH_INPUT_STYLE}
                aria-label="Company"
              />
            </AuthField>

            <button type="submit" disabled={busy} style={submitStyle} {...press}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}

        {/* ── Step 2: SIGN IN ── the company is fixed and shown ───────── */}
        {stage === 'auth' && (
          <form onSubmit={handleAuthSubmit} style={formStyle}>
            {/* Goal-Gradient: progress made visible, and the only way to see
                that you are signing in to the right place.
                Echoes what was TYPED, not the derived slug — the slug is an
                internal identifier that frequently differs from the name
                ("Petal Studios" is `petal`), so showing it here presented a
                confident-looking value the user had never seen and could not
                act on. */}
            <div style={AUTH_HINT_STYLE}>{company.trim()}</div>

            <AuthField label="USERNAME">
              <input
                ref={usernameInputRef}
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.slice(0, 32))}
                disabled={busy}
                style={AUTH_INPUT_STYLE}
                aria-label="Username"
              />
            </AuthField>

            <AuthField label="PASSWORD">
              <AuthPasswordInput
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                aria-label="Password"
              />
            </AuthField>

            <button type="submit" disabled={busy} style={submitStyle} {...press}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            {/* One row, not a stack. Two underlined links sitting on top of
                each other read as clutter under a single primary action;
                side by side with a divider they read as one quiet line. */}
            {/* Both are `disabled={busy}` for the same reason the submit is:
                mid-sign-in, "Change company" walked the user back to step 1
                while an auth request was still in flight, and its completion
                then landed on a screen that had moved on. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={handleChangeCompany}
                disabled={busy}
                style={{ ...AUTH_LINK_STYLE, opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer' }}
              >
                Change company
              </button>
              {onForgotPassword && (
                <>
                  <span aria-hidden="true" style={AUTH_HINT_STYLE}>·</span>
                  <button
                    type="button"
                    onClick={onForgotPassword}
                    disabled={busy}
                    style={{ ...AUTH_LINK_STYLE, opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer' }}
                  >
                    Forgot password?
                  </button>
                </>
              )}
            </div>
          </form>
        )}

        {stage === 'mfa' && (
          <form onSubmit={handleMfaSubmit} style={formStyle}>
            <AuthField label="AUTHENTICATOR CODE">
              <input
                ref={mfaInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/[^0-9\s]/g, ''))}
                disabled={busy}
                style={{ ...AUTH_INPUT_STYLE, letterSpacing: '0.35em', textAlign: 'center' }}
                aria-label="Authenticator code"
              />
            </AuthField>
            <div style={AUTH_HINT_STYLE}>
              ENTER THE 6-DIGIT CODE FROM YOUR AUTHENTICATOR APP
            </div>
            <button type="submit" disabled={busy} style={submitStyle} {...press}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
          </form>
        )}

        {stage === 'workspace' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <div style={AUTH_HINT_STYLE}>SELECT WORKSPACE</div>
            <ul style={{
              listStyle: 'none', padding: 0, margin: 0,
              display: 'flex', flexDirection: 'column', gap: '4px',
              minWidth: '280px',
            }}>
              {workspaces.map((ws, i) => {
                const selected = i === workspaceIndex
                return (
                  <li key={ws.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setWorkspaceIndex(i)}
                      onClick={() => handleWorkspaceChoose(ws.id)}
                      disabled={busy}
                      style={{
                        ...AUTH_TEXT_STYLE,
                        fontSize: '15px',
                        background: 'transparent',
                        border: 'none',
                        cursor: busy ? 'default' : 'pointer',
                        width: '100%',
                        textAlign: 'left',
                        padding: '4px 8px',
                        display: 'flex', alignItems: 'center', gap: '10px',
                        // Selection reads as weight, not as a lighter ink —
                        // a dimmed row on light orange is the grey-on-orange
                        // defect this session exists to remove.
                        fontWeight: selected ? 700 : 400,
                      }}
                    >
                      <span style={{ width: '12px' }}>{selected ? '>' : ' '}</span>
                      <span>{ws.name}</span>
                      <span style={{ fontSize: '11px', fontWeight: 400 }}>{ws.slug}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div style={{ ...AUTH_HINT_STYLE, marginTop: '8px' }}>
              ↑ ↓ TO MOVE · ENTER TO SELECT
            </div>
          </div>
        )}

        {error && <div style={AUTH_ERROR_STYLE}>{error}</div>}
        </div>
      </div>
    </AuthShell>
  )
}
