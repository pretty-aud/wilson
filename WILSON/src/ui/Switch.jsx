// =============================================================================
// Switch — the one toggle: pill track 36x20, knob `ink-light` on the signal
// track, `ink-3` track when off (plan §2 rulings; review Part 3 on TL-25 vs
// R34: a switch that does not read as a switch is a usability cost, so the
// pill is a recorded exception to "sharp over soft").
//
// The track is a real <button role="switch">, so it is focusable, answers
// Space and Enter natively, and is labelable — clicking the label text
// toggles it too. Replaces six hand-rolled toggles; Bins' Toggle is this
// under its old name (`checked`, `onChange`, `label` unchanged).
// =============================================================================

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
  return (
    <label
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
        disabled={disabled}
        className="ui-switch-track"
        onClick={() => { if (!disabled) onChange?.(!on) }}
        {...rest}
      >
        <span className="ui-switch-knob" aria-hidden="true" />
      </button>
      {label != null && label !== '' && <span className="ui-switch-label">{label}</span>}
    </label>
  )
}

export default Switch
