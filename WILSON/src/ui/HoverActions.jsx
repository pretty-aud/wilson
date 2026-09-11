// =============================================================================
// HoverActions — row controls revealed on hover AND on keyboard focus
// (plan §4; Q17(b), ruled: "yes to both, but keep it minimal").
//
// A RESERVED fixed-width slot: the controls fade, the space never moves, so a
// row cannot reflow under the pointer. 120ms, opacity only, nothing else.
//
// ── Why focus-within is the whole point ──────────────────────────────────────
// Six files hide row controls behind `group-hover:opacity-100` today and
// nothing reveals them on focus, so every one of those controls is a keyboard
// dead end: it is in the tab order, it takes focus, and it is invisible while
// focused. Audrey ruled this in because it fixes a real dead end and adds
// nothing else — no new control, no new chrome, no second way to reach
// anything, and no change to what any click does.
//
// The reveal rules live in index.css so that any row hosts it with no wrapper
// component: a <tr>, an <li>, or anything marked `.ui-hover-host`.
//
// `always` opts a row out, for a control that must be visible at rest — which
// is every row's PRIMARY action, if it has one. Hiding that would be the
// "more disclosure" C1 forbids; hiding a secondary one is not.
// =============================================================================

export function HoverActions({ children, always = false, className = '', ...rest }) {
  return (
    <span
      className={`ui-hover-actions ${className}`.trim()}
      data-always={always || undefined}
      {...rest}
    >
      {children}
    </span>
  )
}

export default HoverActions
