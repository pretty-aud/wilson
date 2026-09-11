// =============================================================================
// Chip — the interactive filter (plan §4). Label step, 4px radius, 28px so it
// shares a Toolbar's baseline, one active treatment: the signal as a 16%
// tint and a 1px edge with the ink unchanged. Never the signal as a fill
// under 11px text (§3.2). For an inert label use Badge; for a status use
// StatusBadge.
//
// `color` is a DATA colour (a bin's label colour in Bins) and rides in as a
// custom property so the active fill can be that colour without the state
// itself ever living in an inline style. `count` renders a trailing count in
// the second ink. Props are Bins' Chip's, unchanged.
// =============================================================================

export function Chip({
  active = false,
  onClick,
  children,
  title,
  color = null,
  count = null,
  disabled = false,
  surface = 'dark',
  type = 'button',
  className = '',
  style,
  ...rest
}) {
  const vars = color ? { '--chip-color': color, '--chip-edge': color } : null
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={active}
      className={`ui-chip ${className}`.trim()}
      data-active={active}
      data-surface={surface}
      style={vars || style ? { ...vars, ...style } : undefined}
      {...rest}
    >
      {children}
      {count != null && <span className="ui-chip-count">{count}</span>}
    </button>
  )
}

export default Chip
