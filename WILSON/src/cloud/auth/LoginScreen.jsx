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
//
// ── UI overhaul, session D2 ──────────────────────────────────────────────────
// AUTH-09  Every gap was a hand-typed 18px, so the title sat exactly as far
//          from the first field as the fields sat from each other and spacing
//          carried no grouping information. Now the three named tokens do it:
//          24 between blocks, 16 between field groups, 8 within one.
// AUTH-11  Every message here SHOUTED while the two sibling wizards spoke
//          theirs. All of them are sentence case now; the words are untouched,
//          because the genericness of GENERIC_ERROR is a security property.
//          The three repeated strings are constants rather than five literals.
//          ⚠️ ONE shouted string survives, `'COMPANY NOT FOUND.'` inside the
//          dev auto sign-in effect below. Be exact about why, because the
//          first version of this note was not: devAutoLogin.test.js reads
//          this file as TEXT and pins the SHAPE of that effect — the guard
//          order, an occurrence count, three patterns that must never appear
//          — so the block is not reflowed by a restyle. The literal itself is
//          not pinned. It stays shouted by decision, not by necessity, and it
//          is dev builds only, so nobody who uses WILSON ever reads it.
// AUTH-05  The MFA instruction is a sentence, so it takes AUTH_PROSE_STYLE.
//   /-12  AUTH_HINT_STYLE keeps only the label-like fragments: the company
//          echo, the "·" separator and the "Select workspace" caption.
// AUTH-24  The code field keeps its 0.35em tracking — that is what makes six
//          digits read as six digits — and gains a matching `textIndent`, so
//          the trailing letter-space stops pulling the run ~3px left of centre.
// AUTH-25  The workspace slug is an identifier, so it keeps the mono (Q4).
//          WorkspaceSwitcher.jsx made the same call for the same value; the
//          two screens now agree by decision rather than by accident.
// AUTH-07  The "↑ ↓ TO MOVE · ENTER TO SELECT" caps line is gone. Q10: no
//          shortcut bar anywhere, so its replacement is nothing. The arrow-key
//          handler is untouched — only the decoration went.
// Q2       The page title is `Login`, not `LOGIN`. Uppercase survives in two
//          roles app-wide and a page heading is neither of them.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { saveSession } from './sessionStorage'
import AuthShell, {
  AUTH_TEXT_STYLE,
  AUTH_TITLE_STYLE,
  AUTH_INPUT_STYLE,
  AUTH_BUTTON_STYLE,
  AUTH_BUTTON_BUSY_STYLE,
  AUTH_LINK_STYLE,
  AUTH_LINK_BUSY_STYLE,
  AUTH_HINT_STYLE,
  AUTH_PROSE_STYLE,
  AUTH_ERROR_STYLE,
  AUTH_GAP_WITHIN_FIELD,
  AUTH_GAP_BETWEEN_FIELDS,
  AUTH_GAP_BETWEEN_BLOCKS,
  AuthField,
  AuthPasswordInput,
} from './AuthShell'
import { TYPE, FONT_MONO } from '../../ui/tokens'
import { SLUG_RE, slugifyWorkspace } from './workspaceSlug'
import { withTimeout, AUTH_TIMEOUT_MS } from './withTimeout'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

// Session 43: names the company too. The company is now one of the things the
// user supplied, so a message that lists only two of the three sends someone
// with a mistyped company round a loop that cannot succeed. This is the
// generic error — it stays generic, and it must never grow a branch that
// says WHICH of the three was wrong.
//
// AUTH-11 (UI overhaul D2): sentence case. Every message on this screen was
// SHOUTED while its two sibling wizards spoke theirs, so the auth family had
// two voices for one role. An all-caps error reads as the system blaming the
// user. Only the case and the terminal punctuation changed — the WORDS are
// untouched, because this string's genericness is a security property.
const GENERIC_ERROR = 'Sign-in failed. Check company, username and password.'

// One timeout voice, likewise. A stalled network is not a wrong credential,
// and saying so is what stops the user retrying a thing that cannot succeed.
const TIMEOUT_ERROR = 'The server did not respond. Check your connection and try again.'
const MFA_REJECTED_ERROR = 'Code rejected. Try again.'

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
      setError(err?.name === 'TimeoutError' ? TIMEOUT_ERROR : GENERIC_ERROR)
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
      setError('Enter your company.')
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
        setError('Company not found.')
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
      setError(MFA_REJECTED_ERROR)
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
        setError(MFA_REJECTED_ERROR)
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
      setError(err?.name === 'TimeoutError' ? TIMEOUT_ERROR : MFA_REJECTED_ERROR)
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
  // No transition at all, and that is the correction rather than a shorter
  // one. It used to read `opacity 150ms`, left from when busy WAS an opacity;
  // the first pass at this rewrote the property list to the fill, the ink and
  // the edge — but busy now changes exactly one property, the cursor, and a
  // cursor does not tween, so every property that list named was static and
  // the tween animated nothing. (150 was not one of the three durations
  // either.) When this becomes a kit Button, `.ui-btn`'s own
  // `--duration-state` rule arrives with it — which is the right place for
  // it, not here.
  //
  // 🚨 R2 corrects two sentences round 1 wrote here. The first said "nothing
  // else on this button moves between states": PRESS_CLASS below IS a
  // transform on this very element, so something does move — the press is
  // instant BY CHOICE (see the AUTH-21 note), not because there is nothing to
  // animate. The second, in AuthShell's busy block, said the native `disabled`
  // attribute is "what the global `:disabled` rule styles": the only global
  // `:disabled` declaration is the cursor, and `.ui-btn:disabled` never
  // reaches these raw <button>s. Said plainly, then: a busy auth primary is
  // pixel-identical to an idle one apart from its label and its cursor. That
  // is a deliberate divergence from §3.1's disabled token — the alternative
  // was a 1.51:1 edge appearing mid sign-in — and it stands until kit request
  // K1/K3 gives the filled primary a light-surface disabled treatment.
  const submitStyle = {
    ...AUTH_BUTTON_STYLE,
    ...(busy ? AUTH_BUTTON_BUSY_STYLE : null),
  }
  // AUTH-21. The press effect used to be three handlers writing
  // `transform: scale(0.98)` straight onto the DOM node. Nothing survives
  // that: a class-based Button cannot carry it forward, and the node keeps
  // whatever the last handler wrote even after React re-renders.
  //
  // `active:scale-[0.98]` is the same 2 percent, in CSS, on the element's own
  // :active — so it needs no handler, cannot be left stuck at 0.98 by a
  // mouse-up the element never received, and survives the restyle. The
  // 100ms transform tween left with the handlers; an instant press reads
  // crisper and has no state to unwind.
  //
  // Its permanent home is `.ui-btn:active` in the kit (hand-off kit request
  // K1); this is the one-utility stand-in until that lands app-wide.
  const PRESS_CLASS = 'active:scale-[0.98]'

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
      {/* AUTH-09. Every gap on this screen was a hand-typed 18px — the title
          sat exactly as far from the first field as the fields sat from each
          other, so spacing carried no grouping information at all. The three
          named gaps now do the grouping: BLOCKS here (title → form), FIELDS
          inside the step, WITHIN_FIELD inside AuthField. No literal px gap. */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: AUTH_GAP_BETWEEN_BLOCKS, minWidth: '320px',
      }}>
        {/* Static title — and it must stay OUTSIDE the keyed block below, or
            it animates on every step change. That is exactly what the first
            attempt at this did. In reveal, the parent fades the whole block.

            Sentence case (Q2): this is a page heading at the H1 step, not the
            page-transition title, and the transition title is one of only two
            roles app-wide that keep uppercase. */}
        <div style={AUTH_TITLE_STYLE}>Login</div>

        {/* The step swap. `key={stage}` remounts on every change so the CSS
            entrance in .auth-step (index.css) re-runs; the outgoing step is
            simply gone. No effect, no timer, no ordering problem — see the
            note in AuthShell where the old motion tokens used to live. */}
        <div
          key={stage}
          className="auth-step"
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            // The step's form and the error line under it are two groups, not
            // two blocks — the error is about the form directly above it.
            gap: AUTH_GAP_BETWEEN_FIELDS,
          }}
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

            <button type="submit" disabled={busy} className={PRESS_CLASS} style={submitStyle}>
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

            <button type="submit" disabled={busy} className={PRESS_CLASS} style={submitStyle}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            {/* One row, not a stack. Two underlined links sitting on top of
                each other read as clutter under a single primary action;
                side by side with a divider they read as one quiet line. */}
            {/* Both are `disabled={busy}` for the same reason the submit is:
                mid-sign-in, "Change company" walked the user back to step 1
                while an auth request was still in flight, and its completion
                then landed on a screen that had moved on. */}
            {/* AUTH-09: the form-to-tertiary-row boundary is a BLOCK gap, and
                the form's own gap is already the FIELDS one, so the margin is
                the difference between the two named tokens rather than a
                fourth hand-typed number. */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: AUTH_GAP_WITHIN_FIELD,
              marginTop: `calc(${AUTH_GAP_BETWEEN_BLOCKS} - ${AUTH_GAP_BETWEEN_FIELDS})`,
            }}>
              <button
                type="button"
                onClick={handleChangeCompany}
                disabled={busy}
                style={{ ...AUTH_LINK_STYLE, ...(busy ? AUTH_LINK_BUSY_STYLE : null) }}
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
                    style={{ ...AUTH_LINK_STYLE, ...(busy ? AUTH_LINK_BUSY_STYLE : null) }}
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
                // AUTH-24. The tracking here is functional — it is what keeps
                // six digits readable as six digits — so it stays, and it is
                // the one letterSpacing on this screen that is not a Label.
                //
                // But CSS lays tracking after the FINAL glyph as well as
                // between glyphs, so a centred tracked string is always offset
                // left by half the tracking, ~3px at this size. `textIndent`
                // equal to the tracking pushes the run back by the width of
                // that phantom trailing space and restores optical centre.
                // MfaSection.jsx carries the same field and now carries the
                // same two properties. The operator console under src/admin/
                // has a third copy of the field, and Q14 puts it out of scope
                // — so it is an open item in the hand-off, not a to-do here
                // with no owner.
                style={{
                  ...AUTH_INPUT_STYLE,
                  letterSpacing: '0.35em',
                  textIndent: '0.35em',
                  textAlign: 'center',
                }}
                aria-label="Authenticator code"
              />
            </AuthField>
            {/* AUTH-05 / AUTH-12: a sentence takes the prose role, not the
                hint role. AUTH_HINT_STYLE is the Caption step and belongs to
                label-like fragments; an instruction shouted in caption caps
                was the least readable text on the surface. */}
            <div style={AUTH_PROSE_STYLE}>
              Enter the 6-digit code from your authenticator app.
            </div>
            <button type="submit" disabled={busy} className={PRESS_CLASS} style={submitStyle}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
          </form>
        )}

        {stage === 'workspace' && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: AUTH_GAP_WITHIN_FIELD,
          }}>
            {/* AUTH-11 names this one of the shouted hints. It is a short
                caption over the list, not a field label, so it keeps the
                Caption step and loses the case. */}
            <div style={AUTH_HINT_STYLE}>Select workspace</div>
            <ul style={{
              listStyle: 'none', padding: 0, margin: 0,
              display: 'flex', flexDirection: 'column',
              // Row-to-row rhythm inside one group, so it is tighter than the
              // within-field gap rather than a fourth hand-typed number.
              gap: `calc(${AUTH_GAP_WITHIN_FIELD} / 2)`,
              minWidth: '280px',
            }}>
              {workspaces.map((ws, i) => {
                const selected = i === workspaceIndex
                return (
                  <li key={ws.id}>
                    {/* 🚨 R2: the pointer is a CLASS, and it has to be. These
                        rows have no fill, no edge and no hover background, so
                        the cursor is most of what says they are clickable —
                        and Tailwind v4's preflight, unlike v3's, gives a
                        <button> no cursor at all — but round 1 wrote it as an
                        unconditional INLINE `cursor: 'pointer'` on a row that
                        is `disabled={busy}`, and claimed the global
                        `:disabled { cursor: not-allowed }` in index.css would
                        still answer the busy half. It would not: an inline
                        declaration outranks every author rule short of
                        `!important`, so the rows advertised themselves as
                        clickable while they were inert. That is the same
                        cascade fact AUTH_BUTTON_BUSY_STYLE exists to work
                        around — it can only beat AUTH_BUTTON_STYLE's inline
                        pointer by being inline itself.
                        As utilities the pair resolves by specificity, in the
                        right direction: `.disabled\:cursor-not-allowed:disabled`
                        is (0,2,0) against `.cursor-pointer`'s (0,1,0), and both
                        sit in Tailwind's utilities layer above base. Do not
                        move either one back into the style object. */}
                    <button
                      type="button"
                      onMouseEnter={() => setWorkspaceIndex(i)}
                      onClick={() => handleWorkspaceChoose(ws.id)}
                      disabled={busy}
                      className="cursor-pointer disabled:cursor-not-allowed"
                      style={{
                        // 15px was off the scale entirely — a sixth size for
                        // one row. AUTH_TEXT_STYLE is the Body step and is
                        // what the row wanted; the override just goes.
                        ...AUTH_TEXT_STYLE,
                        background: 'transparent',
                        border: 'none',
                        width: '100%',
                        textAlign: 'left',
                        padding: '4px 8px',
                        display: 'flex', alignItems: 'center', gap: AUTH_GAP_WITHIN_FIELD,
                        // Selection reads as weight, not as a lighter ink —
                        // a dimmed row on light orange is the grey-on-orange
                        // defect this session exists to remove. 600, not 700:
                        // the variable face is declared `400 600`, so 700 was
                        // already rendering as 600 and the source was the only
                        // thing claiming otherwise.
                        fontWeight: selected ? 600 : 400,
                      }}
                    >
                      <span style={{ width: '12px' }}>{selected ? '>' : ' '}</span>
                      <span>{ws.name}</span>
                      {/* AUTH-25: a slug is an identifier, which is one of the
                          things mono keeps (Q4). WorkspaceSwitcher.jsx made
                          the same call for the same value — `text-caption
                          font-mono` — so the two screens now agree by decision
                          rather than by accident. */}
                      <span style={{
                        fontSize: `${TYPE.caption}px`,
                        fontFamily: FONT_MONO,
                        fontWeight: 400,
                      }}>{ws.slug}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {/* AUTH-07: the hand-drawn "↑ ↓ TO MOVE · ENTER TO SELECT" caps
                line that used to sit here is gone. It was arrow glyphs set in
                running caption text — one of three different ways three
                screens showed their shortcuts. Q10 ruled there is no shortcut
                bar anywhere ("i prefer it being cleaner"), so the replacement
                is nothing, not a component. The arrow-key handler above is
                untouched; only the decoration went. Do not re-draw it here. */}
          </div>
        )}

        {error && <div style={AUTH_ERROR_STYLE}>{error}</div>}
        </div>
      </div>
    </AuthShell>
  )
}
