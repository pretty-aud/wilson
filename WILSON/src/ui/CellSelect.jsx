// =============================================================================
// CellSelect — a table cell's own select (B4, 2026-09-25; kit request B2 §4:
// "a shared cell select — B4's file tables and B5's money tables will want
// the same").
//
// Borderless and transparent: it reads as the cell's text until its row is
// hovered or focused, when a 5px caret appears (index.css, `.ui-cell-select`).
// The kit `Select` is a field — a well, a border, 28 or 36px of chrome — and
// in a 36px row that either grows the row or crowds the text; this is the
// other answer, promoted from B2's `.rb-task-cell-select` and the Dashboard's
// `.dash-cell-editor`, which were two copies of it.
//
// `onChange` receives the value, or null for the empty option (the kit
// Select's contract). `placeholder` renders that empty option; with it
// selected the ink drops to the third step (`data-empty`). A cell control
// has no visible label, so pass `aria-label` — "Kind for brief.pdf".
// =============================================================================

import { forwardRef } from 'react'

export const CellSelect = forwardRef(function CellSelect(
  { value, onChange, options = [], placeholder = null, disabled, className = '', ...rest },
  ref,
) {
  const empty = value == null || value === ''
  return (
    <span className={`ui-cell-select ${className}`.trim()}>
      <select
        ref={ref}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value === '' ? null : e.target.value)}
        disabled={disabled}
        data-empty={empty ? 'true' : undefined}
        {...rest}
      >
        {placeholder != null && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o?.value ?? o} value={o?.value ?? o}>{o?.label ?? o}</option>
        ))}
      </select>
    </span>
  )
})

export default CellSelect
