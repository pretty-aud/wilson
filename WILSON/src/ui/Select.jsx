// =============================================================================
// Select — the native <select> in the one well (plan §4). Options are
// `{ value, label }` objects or plain strings; a `placeholder` renders an
// empty first option and an empty choice reports `null`. Its dropdown
// list is painted by the global `select option` rule in index.css.
// Promoted from Bins' Select with its props unchanged.
//
// Post-overhaul S5d kit request (its caller: the Timeline's bid version
// control, TimelineVersions.jsx): an option may be `disabled: true` — shown,
// greyed by the browser, never chosen (a bid version saved before versions
// kept their schedule says "no timeline captured" that way) — and an entry
// `{ label, options: [...] }` is a native <optgroup>, the platform's own
// grouping, read out as a group by a screen reader. Both are additive: a
// caller that passes neither gets exactly the select it always had.
// =============================================================================

import { forwardRef } from 'react'

function OptionOf({ o }) {
  return (
    <option value={o?.value ?? o} disabled={o?.disabled || undefined}>{o?.label ?? o}</option>
  )
}

export const Select = forwardRef(function Select(
  { value, onChange, options = [], disabled, placeholder = null, size = 'md', surface = 'dark', className = '', ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value === '' ? null : e.target.value)}
      disabled={disabled}
      className={`ui-input ${className}`.trim()}
      data-size={size}
      data-surface={surface}
      {...rest}
    >
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((o) => (Array.isArray(o?.options)
        ? (
          <optgroup key={`group:${o.label}`} label={o.label}>
            {o.options.map((g) => <OptionOf key={g?.value ?? g} o={g} />)}
          </optgroup>
        )
        : <OptionOf key={o?.value ?? o} o={o} />))}
    </select>
  )
})

export default Select
