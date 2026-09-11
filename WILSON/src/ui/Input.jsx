// =============================================================================
// Input — the one text well (plan §4): hairline, 3px radius (Q5), 28 / 36, Dense
// 13px, the placeholder token, the global focus-visible ring; on a light
// surface the warm well and the one ink. States are data attributes
// resolved in index.css (`.ui-input[data-size]`, `[data-surface]`).
//
// It keeps Bins' best interaction, Escape-reverts-the-edit: Escape in a field
// is "cancel this edit" — the value goes back to what it was when the field
// took focus, nothing is committed, and the key stops PROPAGATING so a Dialog
// around the field stays open (Bins review round 2: Escape in a take's note
// closed the takes dialog and dropped the note). Enter commits through blur,
// as before. `onCommit` fires on blur unless the edit was cancelled.
//
// 🚨 THE KEY IS STILL HANDED TO THE CALLER (W2, C2 KR-6). "Reverts first,
// closes on the second press" is Audrey's ruling, and it needs both halves:
// the revert stops the key going UP to the Dialog, and `onKeyDown` still
// fires on the way through so a call site keeps whatever else Escape meant
// there. Two call sites lost their Escape exit to the old spelling.
//
// 🚨 THE REVERT IS A CALL TO YOUR `onChange` (C2 trap 0). If that `onChange`
// rebuilds the state object the field lives in, Escape re-opens what a
// capture handler just closed; if it is a write, Escape issues a PATCH. Use a
// functional update, and guard a write on the value actually differing.
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
        else if (e.key === 'Escape') { esc.cancel(e) }
        // W2, and C2 KR-6: the revert happens FIRST and the key is then
        // forwarded, so a caller's own Escape branch survives adoption. It
        // used to `return` here, and `cancel` calls `stopPropagation`, so a
        // call site that had an Escape exit lost it silently the moment it
        // moved onto the kit — one of them had no other exit. The field is
        // still what reverts; the caller decides what else Escape means.
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
