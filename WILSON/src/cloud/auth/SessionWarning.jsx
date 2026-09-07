// =============================================================================
// SessionWarning — Track B bundle B2, part 2: the two notices the session
// timeouts put on screen before they sign someone out.
//
//   idle-warning  "STILL THERE?"  — 25 minutes without activity; any pointer
//                 or key clears it; the button is for people who read first.
//   cap-warning   "SESSION ENDING" — five minutes before the 4-hour cap;
//                 activity cannot extend it, so the button only dismisses.
//
// Same grammar as UpdatePrompt (dark stone, orange rule, two lines, one or
// two buttons) so it reads as the app talking, not the browser. Rendered on
// both surfaces; the operator console is a light page but its dialogs are
// dark by the same convention.
//
// UX laws applied: Doherty (a live countdown, not "soon"); Peak-End (a
// person is never dropped without a sentence saying why — the sign-out
// itself is explained again on the login screen); Fitts (one large primary
// action); Cognitive Load (no settings, no snooze, no second paragraph).
// =============================================================================

import { useEffect, useState } from 'react'

function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function describeSessionExpiry(reason, capHours = 4) {
  if (reason === 'idle_timeout') return 'SIGNED OUT AFTER 30 MINUTES WITHOUT ACTIVITY.'
  if (reason === 'session_cap') return `SIGNED OUT: SESSIONS END AFTER ${capHours} HOURS. SIGN IN AGAIN TO CONTINUE.`
  return ''
}

/**
 * @param {object} props
 * @param {'active'|'idle-warning'|'cap-warning'|'expired'|'inactive'} props.phase
 * @param {number|null} props.deadline   epoch ms of the sign-out
 * @param {() => void} props.onStay      counts as activity (idle only)
 * @param {number} [props.capHours]
 * @param {number} [props.zIndex]
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

  const remaining = mmss(deadline - now)
  const idle = phase === 'idle-warning'

  // R2: the cap notice is NON-MODAL, and deliberately. It fires on a session
  // that is by definition busy — the whole point is "save your work" — so a
  // full-screen backdrop that eats every click, plus an autoFocus that pulls
  // the caret out of whatever is being typed, would cost the person the very
  // work the notice is telling them to save. It sits in the corner, takes no
  // pointer events except on the card itself, and does not steal focus.
  // The idle dialog stays modal: nobody is typing, and it is 5 minutes from
  // signing them out.
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={idle ? 'Still there?' : 'Session ending'}
      style={idle
        ? {
            position: 'fixed', inset: 0, zIndex,
            backgroundColor: 'rgba(28, 25, 23, 0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }
        : {
            position: 'fixed', inset: 0, zIndex,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
            padding: '24px',
            pointerEvents: 'none',
          }}
    >
      <div
        className="flex flex-col gap-4 p-6"
        style={{
          backgroundColor: '#1c1917', border: '2px solid #ea580c',
          borderRadius: '6px', width: 380, maxWidth: '90vw',
          ...(idle ? null : { pointerEvents: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }),
        }}
      >
        <div className="text-sm font-bold uppercase tracking-widest" style={{ color: '#f4a261' }}>
          {idle ? 'Still there?' : 'Session ending'}
        </div>
        <div className="text-xs font-mono leading-relaxed" style={{ color: '#e7e5e4' }}>
          {idle
            ? <>You&rsquo;ll be signed out in <span style={{ color: '#f4a261' }}>{remaining}</span> for inactivity. Move the mouse or press a key to stay signed in.</>
            : <>Sessions end after {capHours} hours. You&rsquo;ll be signed out in <span style={{ color: '#f4a261' }}>{remaining}</span> &mdash; save your work.</>}
        </div>
        <div className="flex items-center justify-end gap-2">
          {idle ? (
            // R2: any pointer or key event clears the warning through the
            // activity listeners before a click on this button can land —
            // which is what the copy above promises ("Move the mouse or
            // press a key"). The button is here for the person who reads
            // first and reaches for something to press; autoFocus makes it
            // the Enter target, and Enter is itself activity. Either way the
            // session stays. Do not "fix" it by narrowing the activity
            // events: the promise in the copy is the behaviour.
            <button
              type="button"
              autoFocus
              onClick={() => onStay?.()}
              className="text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-sm"
              style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
            >
              Stay signed in
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setDismissedDeadline(deadline)}
              className="text-xs font-mono px-3 py-2 rounded-sm"
              style={{ color: '#a8a29e', backgroundColor: 'transparent', border: '1px solid #44403c' }}
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
