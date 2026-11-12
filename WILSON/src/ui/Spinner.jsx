// =============================================================================
// Spinner — an indeterminate progress ring: a 2px hairline with the signal
// as the moving quarter. Sizes are the icon tokens (14 / 16 / 24); a number
// is accepted for Bins' existing callers. It keeps turning under reduced
// motion because it has no end state to jump to. `role="status"` with the
// label so assistive tech hears "Loading" and not nothing.
//
// `surface` was missing until F3 (D1 kit request 4): the ring is a screen of
// the near-white ink and the moving quarter is the signal, which measure
// 1.05:1 and 1.73:1 on the light ground — an indicator nobody can see.
// =============================================================================

const SIZES = { sm: 14, md: 16, lg: 24 }

export function Spinner({ size = 'md', label = 'Loading', surface = 'dark', className = '', ...rest }) {
  const px = typeof size === 'number' ? size : (SIZES[size] ?? SIZES.md)
  return (
    <span
      role="status"
      aria-label={label}
      className={`ui-spinner ${className}`.trim()}
      data-surface={surface}
      style={{ width: px, height: px }}
      {...rest}
    />
  )
}

export default Spinner
