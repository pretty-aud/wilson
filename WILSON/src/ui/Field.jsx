// =============================================================================
// Field — a label (the Label role: 11px, 600, upper, +0.06em) and its
// control at a fixed proximity ratio: 4px between label and control, 16px
// between fields (Law of Proximity — a label belongs to the control below
// it, not to the field above). Promoted from Bins' Field with its props
// unchanged: `inline` puts the label beside the control at a fixed 88px,
// `mixed` marks a multi-selection whose values differ (warning ink, "· mixed"
// appended), `hint` is a Caption under the control.
//
// It renders a <label>, so a click on the label text focuses the control
// inside it, and the control's accessible name is the label. A caller that
// wraps a non-labelable control (a Switch is labelable; a div is not) gets
// the proximity and nothing else, which is still correct.
//
// ── THE 16px IS A NORMAL-FLOW RULE. THE PARENT CAN SAY OTHERWISE. ───────────
//
// `.ui-field + .ui-field { margin-top: 16px }` is the between-fields half of
// the ratio, and `+` cannot see which way the parent lays its children out
// (C1 kit request 4). Two classes in index.css say it instead, and neither is
// a component — the caller already has the container, what it lacked was a
// name the kit knows:
//
//   .ui-field-row     a horizontal pair. Without it the second field takes
//                     16px of TOP margin beside the first, which pushes it
//                     down and stretches the first to cover the gap, so
//                     neither edge lines up (measured on a Start/End pair).
//   .ui-field-stack   a column that supplies its own `gap`. Without it the
//                     gap and the margin ADD: 32px down one column of a form
//                     and 16px down the other, on the same form.
//
// The bare margin stays for the callers in real normal flow —
// `InviteMemberDialog`'s <form> is one — where it is exactly right.
// =============================================================================

export function Field({ label, children, hint, inline = false, mixed = false, surface = 'dark', className = '', ...rest }) {
  return (
    <label
      className={`ui-field ${className}`.trim()}
      data-inline={inline || undefined}
      data-mixed={mixed || undefined}
      data-surface={surface}
      {...rest}
    >
      <span className="ui-field-label">
        {label}{mixed ? ' · mixed' : ''}
      </span>
      <span className="ui-field-control">{children}</span>
      {hint && <span className="ui-field-hint">{hint}</span>}
    </label>
  )
}

export default Field
