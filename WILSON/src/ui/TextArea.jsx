// =============================================================================
// TextArea — the multi-line well, the same well as Input (plan §4) with the
// same Escape-reverts-the-edit contract (Escape stops here so the Dialog
// around it stays open; Enter inserts a newline as a textarea should).
// Promoted from Bins' TextArea with its props unchanged.
// =============================================================================

import { forwardRef } from 'react'
import { useEscapeRevert } from './Input'

export const TextArea = forwardRef(function TextArea(
  {
    value,
    onChange,
    onCommit,
    placeholder,
    rows = 3,
    disabled,
    surface = 'dark',
    className = '',
    onKeyDown,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const esc = useEscapeRevert(onChange)
  return (
    <textarea
      ref={ref}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      onFocus={(e) => { esc.onFocus(e); onFocus?.(e) }}
      onBlur={(e) => { if (esc.committing()) onCommit?.(); onBlur?.(e) }}
      /* W2 / C2 KR-6: revert first, forward second — see Input.jsx. */
      onKeyDown={(e) => { if (e.key === 'Escape') { esc.cancel(e) } onKeyDown?.(e) }}
      className={`ui-input ${className}`.trim()}
      data-surface={surface}
      {...rest}
    />
  )
})

export default TextArea
