// =============================================================================
// Switch — the one toggle: pill track 36x20, knob `ink-light` on the signal
// track, `ink-3` track when off (plan §2 rulings; review Part 3 on TL-25 vs
// R34: a switch that does not read as a switch is a usability cost, so the
// pill is a recorded exception to "sharp over soft").
//
// The track is a real <button role="switch">, so it is focusable and
// answers Space and Enter natively, and it is named by the label text
// through aria-labelledby. The wrapper is a <span>, NOT a <label>: a label
// would forward clicks on the text to the button, which the old Toggle did
// not do (its track was an inert span) — that would be a new click target
// (C1, review round 1). Replaces six hand-rolled toggles; Bins' Toggle is
// this under its old name (`checked`, `onChange`, `label` unchanged).
// =============================================================================

import { useId } from 'react'

export function Switch({
  checked = false,
  onChange,
  label,
  disabled = false,
  surface = 'dark',
  className = '',
  id,
  title,
  ...rest
}) {
  const on = Boolean(checked)
  const labelId = useId()
  const hasLabel = label != null && label !== ''
  return (
    <span
      className={`ui-switch ${className}`.trim()}
      data-checked={on}
      data-disabled={disabled || undefined}
      data-surface={surface}
      title={title}
    >
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={on}
        aria-labelledby={hasLabel ? labelId : undefined}
        disabled={disabled}
        className="ui-switch-track"
        onClick={() => { if (!disabled) onChange?.(!on) }}
        {...rest}
      >
        <span className="ui-switch-knob" aria-hidden="true" />
      </button>
      {hasLabel && <span id={labelId} className="ui-switch-label">{label}</span>}
    </span>
  )
}

export default Switch
