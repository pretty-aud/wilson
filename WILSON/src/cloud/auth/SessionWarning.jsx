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
// same grammar UpdatePrompt moved to), and the cap notice is the kit `Toast`
// rendered standalone in the corner, because it must NOT be modal (below).
// Rendered on both surfaces; the operator console is a light page but its
// dialogs are dark by the same convention.
//
// UX laws applied: Doherty (a live countdown, not "soon"); Peak-End (a
// person is never dropped without a sentence saying why — the sign-out
// itself is explained again on the login screen); Fitts (one large primary
// action); Cognitive Load (no settings, no snooze, no second paragraph).
// =============================================================================

import { useEffect, useState } from 'react'
import { Button, Dialog, Toast, FONT_MONO } from '../../ui'

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

export function describeSessionExpiry(reason, capHours = 4) {
  if (reason === 'session_cap' && capHours !== 4) {
    return `Signed out: sessions end after ${capHours} hours. Sign in again to continue.`
  }
  return EXPIRY_NOTICES[reason] ?? ''
}

/**
 * @param {object} props
 * @param {'active'|'idle-warning'|'cap-warning'|'expired'|'inactive'} props.phase
 * @param {number|null} props.deadline   epoch ms of the sign-out
 * @param {() => void} props.onStay      counts as activity (idle only)
 * @param {number} [props.capHours]
 * @param {number} [props.zIndex]        the cap card's layer; the idle dialog
 *                                       takes the kit's modal layer
 */
export default function SessionWarning({ phase, deadline, onStay, capHours = 4, zIndex = 210 }) {
  const [now, setNow] = useState(() => Date.now())
  const [dismissedDeadline, setDismissedDeadline] = useState(null)
  const showing = (phase === 'idle-warning' || phase === 'cap-warning') && deadline != null

  useEffect(() => {
    if (!showing) return undefined
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [showing, deadline])

  if (!showing) return null
  if (phase === 'cap-warning' && dismissedDeadline === deadline) return null

  // The countdown is a numeric, so it keeps the mono (Q4) — inline from the
  // token, as UpdatePrompt's percentage readout does.
  const countdown = <span style={{ fontFamily: FONT_MONO }}>{mmss(deadline - now)}</span>

  if (phase === 'idle-warning') {
    // R2: any pointer or key event clears the warning through the activity
    // listeners before a click on this button can land — which is what the
    // copy promises ("Move the mouse or press a key"). The button is here for
    // the person who reads first and reaches for something to press;
    // autoFocus makes it the Enter target, and Enter is itself activity.
    // Either way the session stays. Do not "fix" it by narrowing the
    // activity events: the promise in the copy is the behaviour. Escape and
    // the Close glyph are the same act, so they also stay.
    return (
      <Dialog
        title="Still there?"
        width="confirm"
        onClose={() => onStay?.()}
        aria-live="assertive"
        footer={(
          <Button variant="primary" autoFocus onClick={() => onStay?.()}>
            Stay signed in
          </Button>
        )}
      >
        <div>
          You&rsquo;ll be signed out in {countdown} for inactivity. Move the
          mouse or press a key to stay signed in.
        </div>
      </Dialog>
    )
  }

  // R2: the cap notice is NON-MODAL, and deliberately. It fires on a session
  // that is by definition busy — the whole point is "save your work" — so a
  // full-screen backdrop that eats every click, plus an autoFocus that pulls
  // the caret out of whatever is being typed, would cost the person the very
  // work the notice is telling them to save. It sits in the corner, takes no
  // pointer events except on the card itself, and does not steal focus.
  return (
    <div
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
          title="Session ending"
          aria-label="Session ending"
          body={(
            <>
              Sessions end after {capHours} hours. You&rsquo;ll be signed out in {countdown} &mdash; save your work.
            </>
          )}
          action={(
            <Button size="sm" variant="secondary" onClick={() => setDismissedDeadline(deadline)}>
              OK
            </Button>
          )}
        />
      </div>
    </div>
  )
}
