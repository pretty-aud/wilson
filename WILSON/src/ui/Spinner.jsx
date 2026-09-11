// =============================================================================
// Spinner — an indeterminate progress ring: a 2px hairline with the signal
// as the moving quarter. Sizes are the icon tokens (14 / 16 / 24); a number
// is accepted for Bins' existing callers. It keeps turning under reduced
// motion because it has no end state to jump to. `role="status"` with the
// label so assistive tech hears "Loading" and not nothing.
// =============================================================================

const SIZES = { sm: 14, md: 16, lg: 24 }

export function Spinner({ size = 'md', label = 'Loading', className = '', ...rest }) {
  const px = typeof size === 'number' ? size : (SIZES[size] ?? SIZES.md)
  return (
    <span
      role="status"
      aria-label={label}
      className={`ui-spinner ${className}`.trim()}
      style={{ width: px, height: px }}
      {...rest}
    />
  )
}

export default Spinner
