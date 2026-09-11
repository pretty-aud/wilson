// =============================================================================
// Input — the one text well (plan §4): hairline, 4px radius, 28 / 36, Dense
// 13px, the placeholder token, the global focus-visible ring; on a light
// surface the warm well and the one ink. States are data attributes
// resolved in index.css (`.ui-input[data-size]`, `[data-surface]`).
//
// It keeps Bins' best interaction, Escape-reverts-the-edit: Escape in a field
// is "cancel this edit" — the value goes back to what it was when the field
// took focus, nothing is committed, and the key stops there so a Dialog
// around the field stays open (Bins review round 2: Escape in a take's note
// closed the takes dialog and dropped the note). Enter commits through blur,
// as before. `onCommit` fires on blur unless the edit was cancelled.
//
// Promoted from Bins' TextInput with its props unchanged (`value`,
// `onChange(value)`, `onCommit`, `placeholder`, `disabled`, `type`,
// `className`, `autoFocus`, `onKeyDown`, `style`, ...rest). binUi re-exports
// it under the old name.
// =============================================================================

import { forwardRef, useRef } from 'react'

/** Escape in a field reverts to the value it had on focus and blurs. */
export function useEscapeRevert(onChange) {
  const initialRef = useRef(null)
  const cancelledRef = useRef(false)
  const onFocus = (e) => { initialRef.current = e.target.value; cancelledRef.current = false }
  const cancel = (e) => {
    e.stopPropagation(); e.preventDefault()
    cancelledRef.current = true
    if (initialRef.current != null) onChange?.(initialRef.current)
    e.currentTarget.blur()
  }
  const committing = () => { if (cancelledRef.current) { cancelledRef.current = false; return false } return true }
  return { onFocus, cancel, committing }
}

export const Input = forwardRef(function Input(
  {
    value,
    onChange,
    onCommit,
    placeholder,
    disabled,
    type = 'text',
    size = 'md',
    surface = 'dark',
    className = '',
    autoFocus = false,
    onKeyDown,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const esc = useEscapeRevert(onChange)
  return (
    <input
      ref={ref}
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={(e) => { esc.onFocus(e); onFocus?.(e) }}
      onBlur={(e) => { if (esc.committing()) onCommit?.(); onBlur?.(e) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur() }
        else if (e.key === 'Escape') { esc.cancel(e); return }
        onKeyDown?.(e)
      }}
      className={`ui-input ${className}`.trim()}
      data-size={size}
      data-surface={surface}
      {...rest}
    />
  )
})

export default Input
