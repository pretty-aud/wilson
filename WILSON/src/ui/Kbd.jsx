// =============================================================================
// Kbd — a key cap (plan §4): Label step in the mono, hairline, 4px radius,
// min-width 18px, centred, `ink-2` on `paper-recessed`. Up from 9px to the
// 11px floor (Q10). The mono's size compensation is the one token,
// clamped so the floor holds: max(11px, 11px × --mono-size-adjust).
// Displays a key; registers none.
// =============================================================================

export function Kbd({ children, className = '', title, ...rest }) {
  return (
    <kbd className={`ui-kbd ${className}`.trim()} title={title} {...rest}>
      {children}
    </kbd>
  )
}

export default Kbd
