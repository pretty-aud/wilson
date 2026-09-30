// =============================================================================
// SessionWarning — Track B bundle B2, part 2: the two notices the session
// timeouts put on screen before they sign someone out.
//
//   idle-warning  "Still there?"     — 25 minutes without activity; any pointer
//                 or key clears it; the button is for people who read first.
//   cap-warning   "Session ending"   — five minutes before the 4-hour cap;
//                 activity cannot extend it, so the button only dismisses.
//
// On the kit since the post-overhaul merge (2026-09-30): the idle notice is
// the one `Dialog` (modal, Escape-to-close, focus held and returned — the
// same grammar UpdatePrompt moved to), and the cap notice is a kit `Toast`,
// because it must NOT be modal (below). Rendered on both surfaces; the
// operator console is a light page but its dialogs are dark by the same
// convention.
//
// ── Review round 1 of that merge (B-R1-02, -03, -06) ─────────────────────
// · THE LAYER. The kit's backdrop is z 70; the track's overlay was 210. At
//   70 the idle warning rendered UNDER the operator console's own modals
//   (CreateCompanyDialog at 85, the show-once CredentialsDialog at 90) and
//   under App's quit dialog (200): an operator who went idle with the
//   one-time password on screen was signed out behind it with no visible
//   warning. The `Dialog` is wrapped in a `position: relative` div at
//   `zIndex` (210): that div is a stacking context, and the fixed backdrop
//   inside it paints at 210 against the page — above every modal either
//   surface owns, still under ConnectionLostBanner (300), which is the reason
//   none of them can make progress.
// · THE ANCHOR. The cap notice was a SECOND `position: fixed` toast surface,
//   24px off the WINDOW's corner — which is 24px off the bottom bar only on
//   a page with no bar, and src/ui/Toast.jsx says what that costs (D1b §7:
//   inside the light pages' 80px bar, inside Home's 268px frame). On /wilson
//   it now rides the app's ONE toast stack through `useToast()` — the stack
//   the shell already anchors 24px above the current page's bar — sticky
//   (`duration: 0`), warning tone, named for getByRole('alert'). A-R2-02
//   retired the last second anchor (UndoToast, now `pinned`); this was the
//   next one. `placement="corner"` keeps the corner card for the operator
//   console, which has no ToastProvider and no bar — the one surface where
//   the flat 24px is correct.
// · THE ROLE. `alertdialog` is WAI-ARIA's role for an urgent interruption
//   that needs an answer; the kit Dialog now takes it as `alert`. The
//   surface no longer carries `aria-live="assertive"`: a live region that
//   exists from its first render announces nothing by itself, and one whose
//   countdown re-renders every second would interrupt every second. What
//   announces the dialog is the role plus the focus move (autoFocus lands on
//   the button), which reads the title and the `aria-describedby` sentence
//   ONCE, complete with the number as it stood; nothing re-announces the
//   ticks. That is also why the countdown span is not aria-hidden — hiding
//   it would make the one sentence a person hears "signed out in for
//   inactivity".
//
// UX laws applied: Doherty (a live countdown, not "soon"); Peak-End (a
// person is never dropped without a sentence saying why — the sign-out
// itself is explained again on the login screen); Fitts (one large primary
// action); Cognitive Load (no settings, no snooze, no second paragraph).
// =============================================================================

import { useEffect, useId, useRef, useState } from 'react'
import { Button, Dialog, Toast, useToast, FONT_MONO } from '../../ui'

function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

// The two post-sign-out notices the login screens show, as a hand-written
// table: sentence case, like every other message there (AUTH-11). A plain
// object literal on purpose — authSelectors.test.js reads it as a render
// table (`RENDER_TABLES`), which pins sessions.spec.ts's two notice
// selectors to this file. The cap line names the DEFAULT cap; a non-default
// `capHours` builds its own sentence below.
const EXPIRY_NOTICES = {
  idle_timeout: 'Signed out after 30 minutes without activity.',
  session_cap: 'Signed out: sessions end after 4 hours. Sign in again to continue.',
}

// The cap notice's title AND its accessible name, one constant by
// construction: the stack toast takes it as `title` and `name`, the corner
// card as `title` and `aria-label`, so the word a person sees and the word a
// spec asks for by role cannot drift apart. authSelectors.test.js lists it in
// RENDER_TABLES (the one-row form) and pins `/session ending/i` to it.
const CAP_TITLE = 'Session ending'

export function describeSessionExpiry(reason, capHours = 4) {
  if (reason === 'session_cap' && capHours !== 4) {
    return `Signed out: sessions end after ${capHours} hours. Sign in again to continue.`
  }
  return EXPIRY_NOTICES[reason] ?? ''
}

// The countdown ticks ITSELF, so the surface that holds it — a dialog body,
// a toast body the stack keeps in its own state — re-renders once a second
// and nothing above it does. A numeric, so it keeps the mono (Q4) — inline
// from the token, as UpdatePrompt's percentage readout does.
function Countdown({ deadline }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [deadline])
  return <span style={{ fontFamily: FONT_MONO }}>{mmss(deadline - now)}</span>
}

function IdleWarning({ deadline, onStay, zIndex }) {
  const descId = useId()
  // R2: any pointer or key event clears the warning through the activity
  // listeners before a click on this button can land — which is what the
  // copy promises ("Move the mouse or press a key"). The button is here for
  // the person who reads first and reaches for something to press;
  // autoFocus makes it the Enter target, and Enter is itself activity.
  // Either way the session stays. Do not "fix" it by narrowing the
  // activity events: the promise in the copy is the behaviour. Escape and
  // the Close glyph are the same act, so they also stay.
  return (
    <div style={{ position: 'relative', zIndex }} data-session-layer="idle">
      <Dialog
        alert
        title="Still there?"
        width="confirm"
        onClose={() => onStay?.()}
        aria-describedby={descId}
        footer={(
          <Button variant="primary" autoFocus onClick={() => onStay?.()}>
            Stay signed in
          </Button>
        )}
      >
        <div id={descId}>
          You&rsquo;ll be signed out in <Countdown deadline={deadline} /> for inactivity. Move the
          mouse or press a key to stay signed in.
        </div>
      </Dialog>
    </div>
  )
}

function CapSentence({ deadline, capHours }) {
  return (
    <>
      Sessions end after {capHours} hours. You&rsquo;ll be signed out in <Countdown deadline={deadline} /> &mdash; save your work.
    </>
  )
}

// /wilson: the app's one toast stack. Pushed once per deadline from an
// effect, dismissed when the phase leaves (the effect's cleanup), sticky
// until then. `onDismiss` is held in a ref so a parent re-render cannot
// re-run the effect and re-push (the Toast.jsx idiom).
function CapNoticeOnStack({ deadline, capHours, onDismiss }) {
  const toast = useToast()
  const onDismissRef = useRef(onDismiss); onDismissRef.current = onDismiss
  useEffect(() => {
    const id = toast.push({
      tone: 'warning',
      title: CAP_TITLE,
      name: CAP_TITLE,
      body: <CapSentence deadline={deadline} capHours={capHours} />,
      duration: 0,
      action: (
        <Button size="sm" variant="secondary" onClick={() => onDismissRef.current?.()}>
          OK
        </Button>
      ),
    })
    return () => toast.dismiss(id)
  }, [toast, deadline, capHours])
  return null
}

// The operator console: no ToastProvider, no bottom bar, so the flat 24px
// off the window is the right anchor there and there only.
function CapNoticeInCorner({ deadline, capHours, zIndex, onDismiss }) {
  return (
    <div
      data-session-notice="corner"
      style={{
        position: 'fixed', inset: 0, zIndex,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
        padding: 24,
        pointerEvents: 'none',
      }}
    >
      <div style={{ pointerEvents: 'auto' }}>
        <Toast
          tone="warning"
          title={CAP_TITLE}
          aria-label={CAP_TITLE}
          body={<CapSentence deadline={deadline} capHours={capHours} />}
          action={(
            <Button size="sm" variant="secondary" onClick={onDismiss}>
              OK
            </Button>
          )}
        />
      </div>
    </div>
  )
}

/**
 * @param {object} props
 * @param {'active'|'idle-warning'|'cap-warning'|'expired'|'inactive'} props.phase
 * @param {number|null} props.deadline   epoch ms of the sign-out
 * @param {() => void} props.onStay      counts as activity (idle only)
 * @param {number} [props.capHours]
 * @param {number} [props.zIndex]        the idle dialog's layer, and the corner
 *                                       card's; above both surfaces' own modals
 * @param {'stack'|'corner'} [props.placement]
 *   where the cap notice goes: the app's toast stack (needs a ToastProvider
 *   above — /wilson has one; outside one `useToast` throws, by the kit's
 *   design) or the window corner (the operator console: no stack, no bar).
 */
export default function SessionWarning({
  phase, deadline, onStay, capHours = 4, zIndex = 210, placement = 'stack',
}) {
  const [dismissedDeadline, setDismissedDeadline] = useState(null)
  const showing = (phase === 'idle-warning' || phase === 'cap-warning') && deadline != null
  if (!showing) return null

  if (phase === 'idle-warning') {
    return <IdleWarning deadline={deadline} onStay={onStay} zIndex={zIndex} />
  }

  // R2: the cap notice is NON-MODAL, and deliberately. It fires on a session
  // that is by definition busy — the whole point is "save your work" — so a
  // full-screen backdrop that eats every click, plus an autoFocus that pulls
  // the caret out of whatever is being typed, would cost the person the very
  // work the notice is telling them to save. It takes no pointer events
  // except on the card itself, and does not steal focus. OK dismisses it for
  // THIS deadline only; a new session's cap is a new notice.
  if (dismissedDeadline === deadline) return null
  const dismiss = () => setDismissedDeadline(deadline)
  if (placement === 'corner') {
    return <CapNoticeInCorner deadline={deadline} capHours={capHours} zIndex={zIndex} onDismiss={dismiss} />
  }
  return <CapNoticeOnStack deadline={deadline} capHours={capHours} onDismiss={dismiss} />
}
