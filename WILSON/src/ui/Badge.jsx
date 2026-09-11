// =============================================================================
// Badge — the inert label (plan §4): Label step, 4px radius, hairline, 20px.
// It carries a word, never a state; a status is StatusBadge and an
// interactive filter is Chip. An optional `Icon` (lucide, 14px) leads the
// text. On a light surface it takes the well and the one ink.
// =============================================================================

export function Badge({ children, Icon, icon, title, surface = 'dark', className = '', ...rest }) {
  const Glyph = Icon || icon
  return (
    <span className={`ui-badge ${className}`.trim()} data-surface={surface} title={title} {...rest}>
      {Glyph && <Glyph aria-hidden="true" style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />}
      {children}
    </span>
  )
}

export default Badge
