// =============================================================================
// Kbd — a key cap (plan §4): Label step in the mono, hairline, 3px radius,
// min-width 18px, centred, `ink-2` on `paper-recessed`, at the 11px floor.
// Q10 (ruled 2026-09-11): there is no shortcut bar anywhere; Kbd is for Help
// content and menu hints — and for the Bins footer bar only until B6 removes
// that bar. The mono's size compensation is the one
// token, clamped so the floor holds: max(11px, 11px × --mono-size-adjust).
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
