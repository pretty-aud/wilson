// =============================================================================
// MfaSection — Session 9 (locked decision #9: MFA for all admin tiers).
//
// Three exports:
//   MfaEnrollPanel    — the QR + secret + verify-code block (shared).
//   MfaEnrollGate     — full-screen post-login overlay (App.jsx mounts it for
//                       admins/operators with no verified TOTP factor —
//                       the same pendingOnboarding overlay pattern).
//   MfaSecuritySection — Settings > Profile security block: status, enroll,
//                       disable (blocked for admins).
//
// Enrollment flow: mfa.enroll('totp') → QR/secret → challenge+verify(code).
// A previously abandoned unverified factor is unenrolled first — GoTrue
// keeps them around and they'd shadow the fresh one.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldCheck, ShieldOff, Copy, Check } from 'lucide-react'
import { supabase } from './supabaseClient'
import AuthShell, {
  AUTH_TEXT_STYLE, AUTH_PROSE_STYLE, AUTH_INPUT_STYLE,
  AUTH_BUTTON_STYLE, AUTH_BUTTON_BUSY_STYLE, AUTH_ERROR_STYLE,
  AUTH_LINK_STYLE, AUTH_HINT_STYLE,
  AUTH_GAP_WITHIN_FIELD, AUTH_GAP_BETWEEN_FIELDS, AUTH_GAP_BETWEEN_BLOCKS,
} from './AuthShell'
import { usePermissions } from '../../permissions'
import { reportAppEvent } from '../errorCodes'
import { withTimeout, AUTH_TIMEOUT_MS } from './withTimeout'
import { Button } from '../../ui'
import {
  INK_LIGHT, RULE_LIGHT, WELL_LIGHT, GROUND_LIGHT,
  RADIUS_CONTROL, TYPE, ICON, GUTTER,
} from '../../ui/tokens'

async function listVerifiedTotp() {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  const all = data?.totp ?? []
  return {
    verified: all.filter(f => f.status === 'verified'),
    unverified: all.filter(f => f.status !== 'verified'),
  }
}

function qrSrc(qr) {
  if (!qr) return null
  return qr.startsWith('data:') ? qr : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`
}

// The press affordance the auth family uses (LoginScreen's PRESS_CLASS). Named
// properties, never `transition-all`.
const PRESS_CLASS = 'active:scale-[0.98]'

// ── Shared enroll panel ──────────────────────────────────────────────────
// dark=true renders on the auth-overlay, dark=false in Settings > Profile.
//
// 🚨 `dark` is a MISNOMER and it cost this component its legibility. BOTH of
// its surfaces are the light orange ground:
//
//   dark=true   MfaEnrollGate → AuthShell's content area, the LIGHT well
//               (#f4a261) AuthShell paints between the bars.
//   dark=false  MfaSecuritySection → Settings, and Settings is NOT a dark
//               page (App.jsx: `isDarkPage = isDog || isOtter || isRabbit`).
//               It is the same #f4a261.
//
// So there is no dark branch to keep: ink, field, primary button, busy state
// and error ink are ONE treatment here, because one ground can only have one
// ink (8.48:1 for #1c1917; white is 2.06:1 and is what eighteen sessions
// shipped). D2 note for the parent: the brief described the Settings branch
// as dark and asked for INK / PAPER_RAISED / RULE / DANGER on it. Applied to
// #f4a261 that is #f5f0ec on orange — the exact defect Session 43 removed —
// so it is reported rather than written.
//
// What `dark` still selects, and the only thing it can honestly select, is
// the secret chip's GROUND: on the gate the chip sits on the bare well and
// earns a fill; in Settings it already sits inside a `WELL_LIGHT` block, and
// a well inside a well is a second surface for no reason, so there it is a
// hairline instead.
export function MfaEnrollPanel({ dark = false, onEnrolled }) {
  const [phase, setPhase] = useState('loading') // loading | show | verifying | error
  const [factor, setFactor] = useState(null)    // { id, qr, secret }
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const startedRef = useRef(false)
  // One name for the one state the submit button has (see its style below).
  const locked = phase === 'verifying' || phase === 'enrolled'

  const begin = useCallback(async () => {
    setPhase('loading')
    setError(null)
    try {
      // Clear abandoned unverified factors so the fresh QR is the only one.
      try {
        const { unverified } = await listVerifiedTotp()
        for (const f of unverified) {
          try { await supabase.auth.mfa.unenroll({ factorId: f.id }) } catch { /* stale */ }
        }
      } catch { /* listing is best-effort */ }
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (enrollErr || !data) throw enrollErr ?? new Error('enroll failed')
      setFactor({
        id: data.id,
        qr: data.totp?.qr_code ?? null,
        secret: data.totp?.secret ?? null,
      })
      setPhase('show')
    } catch (err) {
      setError(err?.message || 'Enrollment failed.')
      setPhase('error')
      reportAppEvent({ code: 'WIL-1004', eventType: 'auth', context: { step: 'enroll' }, error: err })
    }
  }, [])

  // StrictMode-safe one-shot start (ref guard, no cleanup — the enroll
  // round-trip must not be cancelled by the dev double-mount).
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    begin()
  }, [begin])

  const verify = useCallback(async (e) => {
    e?.preventDefault()
    const c = code.replace(/\s+/g, '')
    if (!/^[0-9]{6}$/.test(c) || !factor?.id) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setPhase('verifying')
    setError(null)
    try {
      // Session 17: bounded. An unbounded verify left this button reading
      // "Activating…" indefinitely while the factor was already verified
      // server-side — the user could not tell enrolment had worked.
      const { data: ch, error: chErr } = await withTimeout(
        supabase.auth.mfa.challenge({ factorId: factor.id }),
        AUTH_TIMEOUT_MS, 'MFA challenge')
      if (chErr || !ch?.id) throw chErr ?? new Error('challenge failed')
      const { error: vErr } = await withTimeout(
        supabase.auth.mfa.verify({ factorId: factor.id, challengeId: ch.id, code: c }),
        AUTH_TIMEOUT_MS, 'MFA verify')
      if (vErr) {
        setError('Code rejected — try the next one from your app.')
        setPhase('show')
        setCode('')
        return
      }
      // Give SUCCESS its own terminal state. Previously this path only called
      // onEnrolled() and left phase at 'verifying', so the button was stuck on
      // "Activating…" unless the parent unmounted this component instantly —
      // which the enrol gate does NOT do: it hands off to a 1s reveal
      // animation first. A success with no terminal state of its own is a
      // success the user cannot see.
      setPhase('enrolled')
      onEnrolled?.()
    } catch (err) {
      setError(err?.name === 'TimeoutError'
        ? 'The server did not respond. Check your connection and try again.'
        : (err?.message || 'Verification failed.'))
      setPhase('show')
      reportAppEvent({ code: 'WIL-1004', eventType: 'auth', context: { step: 'verify' }, error: err })
    }
  }, [code, factor, onEnrolled])

  const copySecret = useCallback(async () => {
    if (!factor?.secret) return
    try {
      await navigator.clipboard.writeText(factor.secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable — secret stays visible */ }
  }, [factor])

  // Session 43 / D2: one ink on one ground. Hierarchy is size and weight, and
  // de-emphasis is a smaller STEP on the scale — never a lighter colour, never
  // an alpha (a 72% black on orange is a grey by another name), and never a
  // size below the 11px floor.
  if (phase === 'loading') {
    return <div style={AUTH_HINT_STYLE}>Preparing enrollment…</div>
  }
  if (phase === 'error') {
    return (
      <div className="flex flex-col items-start" style={{ gap: AUTH_GAP_WITHIN_FIELD }}>
        <div style={AUTH_ERROR_STYLE}>{error}</div>
        <Button
          variant="secondary"
          surface="light"
          size="sm"
          onClick={() => { startedRef.current = true; begin() }}
        >
          Try again
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={verify}
      className="flex flex-col items-center"
      style={{ gap: AUTH_GAP_BETWEEN_FIELDS }}
    >
      {factor?.qr && (
        // The quiet zone is the page ground plus a hairline, not a white card
        // (C9: no white or near-white ground anywhere). #1c1917 modules on
        // #f4a261 measure 8.48:1, well past any scanner's threshold, and a QR
        // whose own SVG paints a light rect is unaffected either way.
        <img
          src={qrSrc(factor.qr)}
          alt="Authenticator enrollment QR code"
          style={{
            width: 168,
            height: 168,
            padding: 6,
            backgroundColor: GROUND_LIGHT,
            border: `1px solid ${RULE_LIGHT}`,
            borderRadius: RADIUS_CONTROL,
          }}
        />
      )}
      {/* AUTH-05's rule applied to this surface's other sentence: a sentence
          is prose, not a label, so it takes the Body step in sentence case
          rather than 11px mono. */}
      <div style={AUTH_PROSE_STYLE}>
        Scan with any authenticator app (1Password, Google Authenticator, Authy…)
        or enter the secret manually:
      </div>
      {factor?.secret && (
        // AUTH-25: a TOTP secret IS data, so this is one of the three uses on
        // the whole auth surface that keep the mono. Its letter-spacing went
        // with the rest (Q2: tracking survives only in the Label role) — the
        // mono advance already separates the glyphs.
        <button
          type="button"
          onClick={copySecret}
          className={`flex items-center gap-2 font-mono ${PRESS_CLASS}`}
          style={{
            ...AUTH_TEXT_STYLE,
            fontSize: `${TYPE.dense}px`,
            padding: '6px 8px',
            borderRadius: RADIUS_CONTROL,
            border: dark ? '1px solid transparent' : `1px solid ${RULE_LIGHT}`,
            backgroundColor: dark ? WELL_LIGHT : 'transparent',
            cursor: 'pointer',
          }}
          title="Copy secret"
        >
          <span style={{ wordBreak: 'break-all' }}>{factor.secret}</span>
          {copied
            ? <Check size={ICON.sm} className="flex-shrink-0" />
            : <Copy size={ICON.sm} className="flex-shrink-0" />}
        </button>
      )}
      {/* One field treatment across every auth surface (AUTH_INPUT_STYLE), at
          the code field's own narrower measure.

          AUTH-24: CSS adds tracking AFTER the final glyph as well as between
          glyphs, so a centred tracked string sits half the tracking value left
          of optical centre. `textIndent` equal to the tracking restores it.
          The two values move together or not at all. */}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^0-9\s]/g, ''))}
        placeholder="000000"
        aria-label="Authenticator code"
        className="font-mono"
        style={{
          ...AUTH_INPUT_STYLE,
          width: 160,
          letterSpacing: '0.35em',
          textIndent: '0.35em',
        }}
      />
      {/* AUTH-15: one error ink for the family. The two reds this file used to
          carry measured 1.5:1 and 2.2:1 on the well — an error you cannot read
          is worse than none. AUTH_ERROR_INK is 4.86:1 there, and it is the
          same ground on both of this panel's surfaces. */}
      {error && <div style={AUTH_ERROR_STYLE}>{error}</div>}
      <button
        type="submit"
        disabled={locked}
        className={PRESS_CLASS}
        style={{
          // "Authenticate" is one of the two buttons Audrey named. It IS
          // AUTH_BUTTON_STYLE now rather than a copy of its values — signal-
          // fill, white label, no outline, the 36px control height and the 3px
          // control radius — so the gate's primary action and the login
          // screen's are the same control by construction.
          ...AUTH_BUTTON_STYLE,
          // `locked` names the branch once. It was written out three times as
          // `phase === 'verifying' || phase === 'enrolled'` — twice inside an
          // inline style, where an opacity beats any class a restyle writes —
          // and the third value (0.6) was a third spelling of one state that
          // the rest of the family spells 0.55 and 0.5. The replacement is not
          // an opacity at all: drop the fill, keep the one ink, leave the
          // hairline, and let the cursor carry the rest.
          ...(locked ? AUTH_BUTTON_BUSY_STYLE : null),
        }}
      >
        {phase === 'enrolled' ? 'MFA active ✓' : phase === 'verifying' ? 'Activating…' : 'Activate MFA'}
      </button>
    </form>
  )
}

// ── Post-login gate for admin tiers ──────────────────────────────────────
// v1 allows a per-sign-in deferral ("asks again next sign-in") — the gate
// re-fires on every login until a verified factor exists. Hard, no-deferral
// enforcement lands with the S11 TPN pass (needs the CI probe admin
// enrolled first). Enrolled admins are already challenged at sign-in.
export function MfaEnrollGate({ onComplete, onDefer }) {
  const [revealing, setRevealing] = useState(false)
  // Session 17 — same handoff safety net as LoginScreen. AuthShell returns
  // null once its reveal reaches 'done', but THIS wrapper div is
  // position:fixed inset:0 z-index:60 — so if onComplete never fires, the
  // user is left under a full-screen invisible overlay showing App's orange
  // root through it, swallowing every click. Exactly one path completes.
  const completedRef = useRef(false)
  const fallbackRef = useRef(null)
  const complete = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    if (fallbackRef.current) clearTimeout(fallbackRef.current)
    onComplete?.()
  }, [onComplete])
  useEffect(() => () => { if (fallbackRef.current) clearTimeout(fallbackRef.current) }, [])
  const startReveal = useCallback(() => {
    setRevealing(true)
    fallbackRef.current = setTimeout(() => {
      if (!completedRef.current) {
        console.warn('[wilson] MFA gate reveal did not fire — closing directly')
        complete()
      }
    }, 4000)
  }, [complete])
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <AuthShell
        showLogoIntro={false}
        isRevealing={revealing}
        onAnimationComplete={complete}
      >
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: AUTH_GAP_BETWEEN_BLOCKS,
        }}>
          {/* AUTH-05, the worst single instance on the surface: a heading at
              13px/+0.18em/UPPER over an entire explanatory PARAGRAPH at 10px
              uppercase — below the 11px floor, and uppercase destroys the
              word-shape recognition fluent reading runs on.

              The heading is the H2 step in sentence case; the paragraph is
              AUTH_PROSE_STYLE — Body 14 / 400 / sentence / zero tracking /
              leading 1.5 / measure capped / left aligned inside the centred
              column. De-emphasis comes from sitting UNDER the heading. The
              file's own comment already knew that "an alpha on the ink is a
              grey by another name" and then solved de-emphasis by shrinking
              to 10px, trading a contrast failure for a legibility one. */}
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: AUTH_GAP_WITHIN_FIELD,
          }}>
            <h2 style={{
              ...AUTH_TEXT_STYLE,
              fontSize: `${TYPE.h2}px`,
              lineHeight: 1.3,
              fontWeight: 600,
              margin: 0,
            }}>
              Secure your admin account
            </h2>
            <p style={{ ...AUTH_PROSE_STYLE, margin: 0 }}>
              Workspace admins sign in with an authenticator code. Set it up once —
              you&apos;ll be asked for a code at every sign-in.
            </p>
          </div>
          <MfaEnrollPanel dark onEnrolled={startReveal} />
          {/* AUTH-17: the gate showed three peers — a filled button and two
              identical underlined links side by side — so the screen had no
              primary. Neither escape hatch is removed (this is a visual pass);
              they become LoginScreen's own row pattern, one quiet line a block
              below the primary with a single divider glyph between them, so a
              deferral and a sign-out read as two exits rather than two more
              decisions of the same rank.

              ⚠️ The button TEXT does not change: tests/e2e/authFlow.ts selects
              the deferral by role/name on /set up later/i. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: AUTH_GAP_WITHIN_FIELD }}>
            <button
              type="button"
              onClick={() => onDefer?.()}
              style={AUTH_LINK_STYLE}
            >
              Set up later
            </button>
            <span aria-hidden="true" style={AUTH_HINT_STYLE}>·</span>
            <button
              type="button"
              onClick={() => window.wilsonSignOut?.()}
              style={AUTH_LINK_STYLE}
            >
              Sign out instead
            </button>
          </div>
        </div>
      </AuthShell>
    </div>
  )
}

// ── Settings > Profile security block ────────────────────────────────────
// AUTH-14: this file and WorkspaceSwitcher.jsx opened with the IDENTICAL
// hand-typed section header — a 14px bold uppercase widely-tracked stone-900
// h2 over a 12px stone-950 paragraph — one of 43 copies of that one class
// string in src, and the two are adjacent panels on one Settings page, so the
// duplication is visible as well as structural. (The exact string is quoted in
// the review, AUTH-14; it is paraphrased here so a grep audit counts the
// remaining copies rather than this comment.)
//
// 🚨 KIT REQUEST: `src/ui/SectionTitle` (title, description, surface). It is
// Foundation 2's, not this session's, so the role is built here from shared
// tokens in the shape the component should take — H2 16/600 sentence case, an
// optional Dense description, a hairline above, 24px block spacing — and the
// two locals below are deleted into it the day it lands. This file and
// WorkspaceSwitcher are its first two callers.
const SECTION_BLOCK_STYLE = {
  borderTop: `1px solid ${RULE_LIGHT}`,
  paddingTop: `${GUTTER}px`,
  marginBottom: `${GUTTER}px`,
}
const SECTION_TITLE_STYLE = {
  color: INK_LIGHT,
  fontSize: `${TYPE.h2}px`,
  lineHeight: 1.3,
  fontWeight: 600,
  margin: 0,
}
const SECTION_DESC_STYLE = {
  color: INK_LIGHT,
  fontSize: `${TYPE.dense}px`,
  lineHeight: 1.45,
  fontWeight: 400,
  margin: `${AUTH_GAP_WITHIN_FIELD} 0 0`,
}

export function MfaSecuritySection() {
  const perms = usePermissions()
  const [state, setState] = useState({ loading: true, enrolled: false, factorId: null })
  const [enrolling, setEnrolling] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [error, setError] = useState(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const { verified } = await listVerifiedTotp()
      if (!mountedRef.current) return
      setState({ loading: false, enrolled: verified.length > 0, factorId: verified[0]?.id ?? null })
    } catch {
      if (!mountedRef.current) return
      setState({ loading: false, enrolled: false, factorId: null })
    }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const isAdminTier = perms.role === 'admin' || perms.isPlatformOperator

  const disable = useCallback(async () => {
    if (!state.factorId) return
    setError(null)
    try {
      const { error: err } = await supabase.auth.mfa.unenroll({ factorId: state.factorId })
      if (err) throw err
      setConfirmDisable(false)
      refresh()
    } catch (err) {
      setError(err?.message || 'Could not disable MFA.')
    }
  }, [state.factorId, refresh])

  return (
    <div>
      <div style={SECTION_BLOCK_STYLE}>
        <h2 style={SECTION_TITLE_STYLE}>Two-factor authentication</h2>
        <p style={SECTION_DESC_STYLE}>
          A 6-digit authenticator code on top of your password.
          {isAdminTier ? ' Required for admins.' : ' Recommended for everyone.'}
        </p>
      </div>

      {state.loading ? (
        <div style={{ ...AUTH_HINT_STYLE, color: INK_LIGHT }}>Checking status…</div>
      ) : enrolling ? (
        <div style={{
          padding: '16px',
          borderRadius: RADIUS_CONTROL,
          backgroundColor: WELL_LIGHT,
        }}>
          <MfaEnrollPanel onEnrolled={() => { setEnrolling(false); refresh() }} />
        </div>
      ) : (
        <div className="flex items-center" style={{ gap: AUTH_GAP_WITHIN_FIELD }}>
          {state.enrolled ? (
            <>
              {/* On the light ground no status colour is drawn (plan §3.2):
                  status is the word plus its mark, both in the one ink. The
                  greens and reds that used to live here were four of the
                  seven reds/greens AUTH-15 counted across this surface. */}
              <span
                className="flex items-center gap-1.5"
                style={{ ...AUTH_TEXT_STYLE, color: INK_LIGHT, fontSize: `${TYPE.dense}px` }}
              >
                <ShieldCheck size={ICON.md} /> Enabled
              </span>
              {isAdminTier ? (
                <span style={{ ...AUTH_HINT_STYLE, color: INK_LIGHT }}>
                  Admins must keep MFA on.
                </span>
              ) : confirmDisable ? (
                <span className="flex items-center" style={{ gap: AUTH_GAP_WITHIN_FIELD }}>
                  <span style={{ ...AUTH_TEXT_STYLE, color: INK_LIGHT, fontSize: `${TYPE.dense}px`, fontWeight: 600 }}>
                    Disable MFA?
                  </span>
                  <Button variant="danger" surface="light" size="sm" onClick={disable}>
                    Disable
                  </Button>
                  <Button variant="secondary" surface="light" size="sm" onClick={() => setConfirmDisable(false)}>
                    Keep it
                  </Button>
                </span>
              ) : (
                <Button
                  variant="danger"
                  surface="light"
                  size="sm"
                  onClick={() => setConfirmDisable(true)}
                >
                  <ShieldOff /> Disable
                </Button>
              )}
            </>
          ) : (
            <>
              <span style={{ ...AUTH_TEXT_STYLE, color: INK_LIGHT, fontSize: `${TYPE.dense}px` }}>
                Not enrolled
              </span>
              <Button
                variant="primary"
                surface="light"
                size="sm"
                onClick={() => setEnrolling(true)}
              >
                Set up
              </Button>
            </>
          )}
        </div>
      )}

      {error && <div style={{ ...AUTH_ERROR_STYLE, marginTop: AUTH_GAP_WITHIN_FIELD }}>{error}</div>}
    </div>
  )
}
