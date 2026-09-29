// =============================================================================
// Select — the native <select> in the one well (plan §4). Options are
// `{ value, label }` objects or plain strings; a `placeholder` renders an
// empty first option and an empty choice reports `null`. Its dropdown
// list is painted by the global `select option` rule in index.css.
// Promoted from Bins' Select with its props unchanged.
// =============================================================================

import { forwardRef } from 'react'

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
      {options.map((o) => (
        <option key={o?.value ?? o} value={o?.value ?? o}>{o?.label ?? o}</option>
      ))}
    </select>
  )
})

export default Select
