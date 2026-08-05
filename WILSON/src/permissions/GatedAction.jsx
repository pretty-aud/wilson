// =============================================================================
// GatedAction — Session 29. The ONE treatment for a control the caller is not
// allowed to use.
//
// Audrey, 2026-08-04: "keep button gray and explain why."
//
// Before this, six R.A.B.B.I.T. surfaces HID their create controls off a single
// `canWrite` flag, and the Timeline gated nothing at all — so the same denial
// produced three different experiences: a control that silently vanished, a
// control that was never there, and a control that worked right up until the
// database refused it with
//
//     new row violates row-level security policy for table "tasks"
//
// This renders the third case honestly and the first two consistently. Wrap any
// affordance whose action can be denied:
//
//   <GatedAction allowed={canWrite} reason={writeReason}>
//     <button onClick={…}>New task</button>
//   </GatedAction>
//
// `allowed` true renders the children completely untouched — no wrapper, no
// extra DOM, so the permitted path (which is almost everyone, almost always)
// pays nothing.
//
// ── Two traps this exists to avoid ───────────────────────────────────────────
//
// 1. 🚨 A `disabled` <button> does not fire mouse events, so a `title=` on the
//    button itself is unreliable — Chrome in particular will not show it. The
//    reason would be invisible in exactly the browser Audrey uses, which is
//    worse than hiding the control, because the user sees a dead control AND no
//    explanation. So the title lives on an OUTER wrapper that stays interactive,
//    and the children are made inert INSIDE it. Native `title` is deliberate:
//    it is what the rest of this codebase already uses (ProjectTasksView's
//    Export button, every Timeline row), and there is no Tooltip component to
//    reuse — verified by grep, 2026-08-04.
//
// 2. 🚨 Grey must never mean "loading". `canOnProject` returns TRUE while
//    permissions are still resolving (projectRoleMatrix.js `ready === false`),
//    on purpose, so a control is never greyed merely because the session has not
//    settled. Callers MUST pass `ready` into the gate — the hook that computes
//    `allowed`/`reason` does it for them. See useProjectWrite.js.
//
// `inert` (React 19) removes the subtree from the tab order, from the a11y tree
// and from hit-testing; `pointerEvents: none` is belt-and-braces for the same
// thing. The wrapper keeps `aria-disabled` and the reason as its accessible
// name so a screen reader gets the explanation the sighted user gets from hover.
// =============================================================================

import { createContext, useContext } from 'react'

/**
 * The denial sentence for the surface currently being rendered.
 *
 * Why a context rather than a prop: `canWrite` is already threaded through
 * these view trees because the LOGIC needs it (a handler that must not fire,
 * a drag that must not start). The reason string is needed only at the leaves
 * that actually render something, and ProjectTasksView alone has nine of them
 * behind eight component boundaries. Threading a constant string through every
 * signature to reach them is churn that buys nothing and invites a call site
 * that passes `canWrite` and forgets `writeReason` — a greyed control with no
 * explanation, which is the state this session exists to remove.
 *
 * `allowed` stays an explicit prop precisely because it is NOT constant per
 * surface and must never be ambient.
 */
export const WriteReasonContext = createContext(null)

export function WriteReasonProvider({ reason, children }) {
  return <WriteReasonContext.Provider value={reason}>{children}</WriteReasonContext.Provider>
}

/**
 * For the handful of places that need the sentence WITHOUT wrapping anything —
 * a row that is no longer draggable, a cell that is no longer editable. There
 * is no control to grey there, only a `title` to hang the explanation on.
 */
export function useWriteReason() {
  return useContext(WriteReasonContext)
}

export default function GatedAction({
  allowed,
  reason,
  children,
  // Wrapper display. Buttons in a flex toolbar want inline-flex; a full-width
  // row (the Timeline's "New task…" drop zones) wants block so it still fills
  // its track.
  display = 'inline-flex',
  // Denied opacity. Matches the codebase's existing `disabled:opacity-40`.
  opacity = 0.4,
  className,
  style,
}) {
  const contextReason = useContext(WriteReasonContext)
  // Hooks must run unconditionally, so the early return comes after.
  // Fragment, not a bare `children`: some call sites pass SIBLINGS (the bulk
  // action group), and returning a raw array asks React for keys it has no
  // reason to need.
  if (allowed) return <>{children}</>

  const text = reason ?? contextReason ?? null

  return (
    <span
      title={text || undefined}
      aria-disabled="true"
      aria-label={text || undefined}
      className={className}
      style={{
        display,
        cursor: 'not-allowed',
        // The wrapper itself must stay hit-testable or the title never shows.
        pointerEvents: 'auto',
        // ⚠️ The dimming lives HERE, not on the inner span. The inner span is
        // `display: contents`, which generates no box at all — and `opacity`
        // on a boxless element does nothing, so putting it there would have
        // rendered a control that looked perfectly enabled and did nothing.
        opacity,
        ...style,
      }}
    >
      <span inert style={{ display: 'contents', pointerEvents: 'none' }}>
        {children}
      </span>
    </span>
  )
}
