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
  AUTH_LINK_STYLE, AUTH_HINT_STYLE, AuthSectionTitle,
  AUTH_GAP_WITHIN_FIELD, AUTH_GAP_BETWEEN_FIELDS, AUTH_GAP_BETWEEN_BLOCKS,
} from './AuthShell'
import { usePermissions } from '../../permissions'
import { reportAppEvent } from '../errorCodes'
import { withTimeout, AUTH_TIMEOUT_MS } from './withTimeout'
import { Button } from '../../ui'
import {
  INK_LIGHT, ON_FILL, RADIUS_CONTROL, TYPE, ICON,
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
// Two mount points, ONE surface. This used to take a `dark` prop, and that
// prop was a misnomer that cost the component its legibility. Both of its
// grounds are the light orange:
//
//   MfaEnrollGate       → AuthShell's content area, the LIGHT well (#f4a261)
//                         AuthShell paints between the bars.
//   MfaSecuritySection  → Settings, which is NOT a dark page (App.jsx:
//                         `isDarkPage = isDog || isOtter || isRabbit`). It is
//                         the same #f4a261.
//
// So there is no dark branch to keep: ink, field, primary button, busy state
// and error ink are ONE treatment here, because one ground can only have one
// ink (8.48:1 for #1c1917; white is 2.06:1 and is what eighteen sessions
// shipped). D2 note for the parent: the brief described the Settings branch
// as dark and asked for INK / PAPER_RAISED / RULE / DANGER on it. Applied to
// #f4a261 that is #f5f0ec on orange — the exact defect Session 43 removed —
// so it is reported rather than written.
//
// 🚨 R1 correction: the prop is GONE rather than kept-and-unused. The last
// thing it selected was the secret chip's ground, and it only had that job
// because the Settings mount wrapped this panel in a `WELL_LIGHT` block —
// which is the fill that dragged the error ink down to 3.95:1 (see the error
// line below and the section that mounts it). With that block drawn as a
// hairline instead of a fill, both mounts are the bare #f4a261 and the chip
// has one treatment. A prop that selects nothing is a prop the next session
// has to re-derive; this file has already paid for one of those.
export function MfaEnrollPanel({ onEnrolled }) {
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
        {/* 🚨 R2 raised this and it stays as it is, on purpose. Its edge is the
            kit's `rule-light`, which measures 1.51:1 on this ground — the very
            value the secret chip below rejects as "an edge nobody can see", so
            the outlined-control role is drawn two ways in one component. What
            R2 did not check is that the two never co-render: `phase === 'error'`
            returns HERE, and the chip only exists in the form below it. The
            inconsistency is real but it is across states, not across a screen.
            It is not fixed from the caller, because the two ways out both make
            things worse: hand-rolling this as AUTH_BUTTON_QUIET_STYLE adds a
            tenth copy of an outlined button to a file that is trying to
            converge on the kit, and pushing a border through `className` is the
            Bins dead-hover pattern the kit header forbids. It is the light-
            surface edge kit request (filed with K7), and the day that lands
            every kit Button on every light page changes at once, which is the
            point of the kit. */}
        <Button
          variant="secondary"
          surface="light"
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
        // 🚨 THE ONE WHITE IN THE AUTH FAMILY, AND IT IS DELIBERATE.
        //
        // D2 painted this quiet zone the page orange on the reasoning that C9
        // forbids a white ground and that 8.48:1 is "well past any scanner's
        // threshold". Both halves were wrong for this element:
        //
        //   • C9 governs UI SURFACES — a ground, a panel, a card, a well, a
        //     header row, a dialog, a menu. A machine-readable code is none of
        //     those. Its quiet zone is part of the glyph, not part of the page.
        //   • A WCAG ratio is not a scanner's threshold. Decoders binarise the
        //     camera frame and expect the quiet zone to be the LIGHT module
        //     colour; ISO/IEC 18004 specifies four modules of it. 8.48:1 says
        //     the modules are readable by a human eye, which is not the claim
        //     that matters here.
        //
        // And the assumption the old comment leant on — "a QR whose own SVG
        // paints a light rect is unaffected either way" — was never checked
        // against what GoTrue actually returns (`qrSrc` below passes the
        // payload straight through without inspecting it). On the ONE screen
        // where a failure means a person cannot enrol a second factor, an
        // unverified assumption is not a thing to ship. So the white is back:
        // if the SVG paints its own light rect this costs nothing, and if it
        // is transparent this is the thing making the code scannable.
        //
        // 🚨 R2, two corrections to the paragraph above, because R1 claimed
        // more for this than it delivers.
        //
        //   1. THE 6px IS NOT A QUIET ZONE. Preflight makes this box
        //      border-box, so `width: 168` with `padding: 6` leaves 156px of
        //      modules. A GoTrue otpauth URI is long enough to need a mid
        //      version — call it 25–45 modules — so one module is roughly 3.5
        //      to 6px and the padding is about ONE of them against the four
        //      ISO/IEC 18004 asks for. R1 wrote "already sub-spec" and then
        //      reasoned as if the padding were doing the job. It is not. What
        //      does the job in the transparent case is the PLATE — being the
        //      light module colour under the whole glyph — and in the other
        //      case the SVG's own margin, which every common generator emits
        //      at the spec's four modules. Enlarging the padding to four
        //      modules was considered and NOT done: on the far more likely
        //      branch (the SVG carries its own margin) it would put a much
        //      bigger white rectangle on the screen to fix nothing. Measure
        //      first, then size it.
        //
        //   2. THIS IS AN OPEN C9 EXCEPTION, NOT A SETTLED ONE. C9 is dated,
        //      capitalised and Audrey's ("i never liked when we had white
        //      backgrounds"), and whether a machine-readable plate is a "UI
        //      surface" is genuinely arguable — which is exactly what makes it
        //      a question for her rather than a ruling taken in a file comment.
        //      It ships white in the meantime because the failure mode of
        //      getting it wrong is an admin who cannot enrol a second factor,
        //      and that beats a colour rule; but the walkthrough must carry it
        //      as a NAMED exception, and the thing that closes it is evidence,
        //      not argument: log one real `factor.qr` and look at whether its
        //      SVG paints a light rect. If it does, the plate is dead weight
        //      and the ground goes back to the page. If it does not, the plate
        //      stays and gets sized to four modules.
        //
        // ⚠️ ON_FILL is `--color-on-fill` (#ffffff), and it is BORROWED. The
        // token module documents it as the label colour for a filled primary
        // ("The filled primary button, white text (5.18:1)"), not as a ground —
        // there is no plate token, so this is the one name in the system with
        // the right value. Retint `--color-on-fill` (to an off-white for the
        // primary's label, say) and you silently retint a machine-readable
        // quiet zone. 🚨 KIT REQUEST (K9): a `--color-plate` token with its job
        // written down, so the borrowing ends.
        //
        // No hairline around it: a 1px frame on the outside of the plate buys
        // nothing, and the plate is its own boundary against the orange.
        <img
          src={qrSrc(factor.qr)}
          alt="Authenticator enrollment QR code"
          style={{
            width: 168,
            height: 168,
            padding: 6,
            backgroundColor: ON_FILL,
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
        //
        // R1: one treatment, and the edge is the FULL ink, not `rule-light`.
        // This is a control (it copies), so its boundary is 1.4.11's business,
        // and `rule-light` measured 1.51:1 on the ground and 1.47:1 inside the
        // Settings well — an edge nobody can see is not an edge. INK_LIGHT is
        // 8.48:1 and is the same 1px the rest of this screen is drawn in
        // (every field is a bottom rule in it; AUTH_BUTTON_QUIET_STYLE argues
        // the identical point and authContrast.test.js pins it).
        <button
          type="button"
          onClick={copySecret}
          className={`flex items-center gap-2 font-mono ${PRESS_CLASS}`}
          style={{
            ...AUTH_TEXT_STYLE,
            fontSize: `${TYPE.dense}px`,
            padding: '6px 8px',
            borderRadius: RADIUS_CONTROL,
            border: `1px solid ${INK_LIGHT}`,
            backgroundColor: 'transparent',
            cursor: 'pointer',
          }}
          title="Copy secret"
        >
          <span style={{ wordBreak: 'break-all' }}>{factor.secret}</span>
          {copied
            ? <Check size={ICON.sm} className="flex-shrink-0" aria-hidden="true" />
            : <Copy size={ICON.sm} className="flex-shrink-0" aria-hidden="true" />}
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
          carry measured 1.5:1 and 2.2:1 — an error you cannot read is worse
          than none.

          🚨 R1 correction, and it is the reason the Settings mount below stopped
          being a filled well. The old comment here claimed AUTH_ERROR_INK was
          4.86:1 and that it was "the same ground on both of this panel's
          surfaces". The first number was right only for the GATE; the second
          was simply false. Measured with src/ui/contrast.js:

            #7f1d1d on #f4a261 (the gate, bare ground)          4.86:1  ✓
            #7f1d1d on over(WELL_LIGHT, #f4a261) = #de9155      3.95:1  ✗

          A 13px/600 line needs 4.5, so the Settings mount was shipping an
          unreadable error on the one path an admin has to enrol. It is fixed by
          moving the ground, not the ink: the `WELL_LIGHT` fill that wrapped this
          panel in Settings is now a hairline, so BOTH mounts are #f4a261 and
          both errors measure 4.86:1. The sentence about one ground on both
          surfaces is now true rather than aspirational. If a well is ever put
          back around this panel, this line fails again — measure before you
          fill. */}
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
          // an opacity, and after R1 it is not a fill change or an edge either:
          // AUTH_BUTTON_BUSY_STYLE is `{ cursor: 'not-allowed' }` and nothing
          // else. Busy is carried by the label swap below ("Activating…",
          // "MFA active ✓"), by the native `disabled` attribute — which is what
          // a screen reader announces — and by the fill staying exactly where
          // it was, so nothing moves and nothing loses contrast mid-verify.
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
              to 10px, trading a contrast failure for a legibility one.

              🚨 R2 asked for two changes here and gets neither, with reasons.

              It called this a third hand-rolled copy of `AuthSectionTitle`. It
              is not the same role: AuthSectionTitle is a Settings SECTION head
              — it opens with a `rule-light` top hairline and its description is
              the Dense step — and this is the page title of a full-screen auth
              surface with a 14px PROSE paragraph under it in a centred column.
              Only the five h2 properties coincide. Routing this through it
              would import a hairline the gate has no use for.

              It also asked for AUTH_TITLE_STYLE (the H1 step, 20px), since the
              other four auth surfaces set their page title with it and this one
              is four pixels smaller. That inconsistency is real — and so is the
              related one R2 names, that the other four are `<div>`s so no auth
              screen has an h1 while this, the odd size out, is the only true
              heading. But this is the screen `SPLIT_BAR_HEIGHT` is fitted to:
              AuthShell's geometry block measures this exact stack, heading
              block included, and going 16 → 20px moves that number. Changing it
              here without re-measuring there is precisely the stale-figure
              failure this round exists to catch, and AuthShell is not this
              file's to edit. So it stays at H2 and the fix is named instead:
              promote all five auth page titles to one `AuthTitle` element —
              same step, same tag — in the pass that re-measures the gate. */}
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
          <MfaEnrollPanel onEnrolled={startReveal} />
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
// h2 over a 12px stone-950 paragraph — one of 43 copies of that one class at
// the start of this session (40 at its end; this file held one of the three
// that left)
// string in src, and the two are adjacent panels on one Settings page, so the
// duplication is visible as well as structural. (The exact string is quoted in
// the review, AUTH-14; it is paraphrased here so a grep audit counts the
// remaining copies rather than this comment.)
//
// 🚨 R1: the first attempt at this hand-rolled the role HERE as three local
// style objects while WorkspaceSwitcher hand-rolled it as Tailwind utilities —
// so two byte-identical copies became two copies that no longer even agreed
// (different spacing below the block, a measure cap on one and not the other),
// which is a worse outcome than leaving both alone. The role now lives once, as
// `AuthSectionTitle` in AuthShell, and both auth callers import it.
//
// 🚨 STILL A KIT REQUEST: `src/ui/SectionTitle` (title, description, surface)
// is Foundation 2's. AuthSectionTitle is the stand-in that keeps the two
// surfaces from drifting again in the meantime, and it is deleted into the kit
// component the day that lands — one deletion, not two.

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
      <AuthSectionTitle
        title="Two-factor authentication"
        description={`A 6-digit authenticator code on top of your password.${
          isAdminTier ? ' Required for admins.' : ' Recommended for everyone.'
        }`}
      />

      {state.loading ? (
        <div style={{ ...AUTH_HINT_STYLE, color: INK_LIGHT }}>Checking status…</div>
      ) : enrolling ? (
        // 🚨 R1: this block used to be a `WELL_LIGHT` FILL, and the fill was the
        // defect. `over(WELL_LIGHT, #f4a261)` flattens to #de9155, on which the
        // family's error ink measures 3.95:1 — below AA, on the errors an admin
        // reads while enrolling. Removing the fill is the whole fix: the panel
        // sits on the bare #f4a261, the error measures 4.86:1, and this mount
        // and the gate are the same ground — which is what let the panel's
        // `dark` prop go.
        //
        // 🚨 R2 took the box back off. R1 replaced the fill with a 1px INK_LIGHT
        // hairline to keep a "grouping", and that was a second change smuggled
        // in beside the one that was needed. INK_LIGHT is 8.48:1 on this ground:
        // every other panel boundary on a light surface in this app — HelpPage's
        // cards, `.ui-badge[data-surface="light"]`, `.ui-banner[data-surface=
        // "light"]`, the kit's light buttons — is `rule-light` at 1.51:1, so a
        // full-ink box here would have been the only one in the app and would
        // read as an alarm rather than as a grouping. The precedent R1 cited,
        // AUTH_BUTTON_QUIET_STYLE, is a CONTROL's own edge, which is what WCAG
        // 1.4.11 governs; a grouping box around a panel is not a control and
        // 1.4.11 has nothing to say about it.
        //
        // So: no fill and no edge. The padding stays as air under the section
        // title. The panel now genuinely renders the way it does on the gate
        // rather than in a box the gate does not have — which is what the
        // sentence above always claimed. Do not put a fill back without
        // re-measuring AUTH_ERROR_INK against it.
        <div style={{ padding: '16px' }}>
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
                <ShieldCheck size={ICON.md} aria-hidden="true" /> Enabled
              </span>
              {isAdminTier ? (
                <span style={{ ...AUTH_HINT_STYLE, color: INK_LIGHT }}>
                  Admins must keep MFA on.
                </span>
              ) : confirmDisable ? (
                // 🚨 R1 BLOCKER FIX — the destructive action and its cancel were
                // TWO IDENTICAL BUTTONS. `danger` and `secondary` sit in one
                // selector list on a light surface (src/index.css: `.ui-btn
                // [data-surface="light"][data-variant="secondary"|"ghost"|
                // "danger"]` → `color: ink-light; border-color: rule-light`,
                // and one shared `hover-light` fill), and that pair is (0,3,0)
                // so it beats the base `[data-variant="danger"]` at (0,2,0).
                // Both resolved to the same ink, the same 1px edge, the same
                // hover, the same box. Nothing but the words separated turning
                // off a second factor from cancelling it.
                //
                // Round 1 reached for `ghost` on the cancel, because ghost is
                // the one light variant with a different EDGE (a later rule
                // gives it `border-color: transparent`). Round 2 measured what
                // that costs: `.ui-btn[data-variant="ghost"]:hover` sets
                // `color: var(--color-ink)` at (0,4,0), the light block that
                // would take it back is (0,3,0) and its hover rule sets only a
                // background — so a hovered ghost on this surface paints its
                // label #f5f0ec on orange at **2.10:1**. That is white on
                // orange, the exact thing C6 forbids in Audrey's own capitals,
                // introduced by the fix for the blocker. It was the only
                // `variant="ghost" surface="light"` call site in the app.
                //
                // So the pair is separated by FILL instead, which no cascade
                // can undo: the safe action is the filled primary (signal-fill,
                // white at 5.18:1 on its own ground, untouched by the light
                // block) and the destructive one is the outlined `danger`. A
                // filled cancel next to an outlined confirm is also the right
                // way round for a destructive confirm — the safe choice is the
                // one the eye lands on, and the label says which is which.
                //
                // `Disable` stays `variant="danger"` rather than becoming a
                // secondary that happens to look right: the day the kit gains a
                // light danger treatment, this call site starts rendering it
                // with no edit.
                //
                // 🚨 KIT REQUEST "light danger" (K7): the light surface has NO
                // destructive treatment at all — `--color-danger` (#fca5a5) is a
                // dark-surface token and is unreadable on #f4a261, and the plan
                // draws no status colour on light. Until Foundation rules on
                // one, a destructive action on an orange page can only be
                // separated by shape.
                //
                // 🚨 KIT REQUEST "light hover ink" (K8): the one-line cause of
                // the ghost defect above. `.ui-iconbtn[data-surface="light"]
                // :hover` already sets `color: var(--color-ink-light)`;
                // `.ui-btn`'s light hover block omits it. Any future light
                // ghost or light-variant hover has the same 2.10:1 waiting.
                <span className="flex items-center" style={{ gap: AUTH_GAP_WITHIN_FIELD }}>
                  <span style={{ ...AUTH_TEXT_STYLE, color: INK_LIGHT, fontSize: `${TYPE.dense}px`, fontWeight: 600 }}>
                    Disable MFA?
                  </span>
                  <Button variant="danger" surface="light" onClick={disable}>
                    Disable
                  </Button>
                  <Button variant="primary" surface="light" onClick={() => setConfirmDisable(false)}>
                    Keep it
                  </Button>
                </span>
              ) : (
                <Button
                  variant="danger"
                  surface="light"
                  onClick={() => setConfirmDisable(true)}
                >
                  <ShieldOff aria-hidden="true" /> Disable
                </Button>
              )}
            </>
          ) : (
            <>
              <span style={{ ...AUTH_TEXT_STYLE, color: INK_LIGHT, fontSize: `${TYPE.dense}px` }}>
                Not enrolled
              </span>
              {/* R1 / C8: every kit Button in this file is the default `md`.
                  They were `sm` (28px / 13px) while the enrol panel's submit is
                  AUTH_BUTTON_STYLE (36px / 14px) — two filled primaries at two
                  sizes on one Settings panel, and clicking this one swapped a
                  28px primary for a 36px primary in the same block. One control
                  height per file until the AUTH_BUTTON_* kit is deleted into
                  `Button surface="light"` (which waits on the light-surface edge
                  and the light danger treatment, both filed). */}
              <Button
                variant="primary"
                surface="light"
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
