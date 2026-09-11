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
