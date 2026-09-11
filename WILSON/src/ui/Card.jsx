// =============================================================================
// Card — the one framed region (plan §4).
//
//   One surface (`paper-raised` on dark, `well-light` on light), one hairline,
//   3px radius (Q5), an optional title slot at the H3 step and an actions
//   slot beside it.
//
// It replaces the hand-rolled cards in Admin Terminal, Storage and Summary and
// every `bg-white/40` (C9: no white or near-white surface). `pad={false}` is
// for a card whose content brings its own padding — a table, which pads its
// own cells and must reach the card's hairline on every side.
// =============================================================================

export function Card({
  children,
  title,
  actions,
  pad = true,
  surface = 'dark',
  className = '',
  ...rest
}) {
  return (
    <section
      className={`ui-card ${className}`.trim()}
      data-surface={surface}
      data-pad={pad || undefined}
      {...rest}
    >
      {(title || actions) && (
        <header className="ui-card-head">
          {title && <h3 className="ui-card-title">{title}</h3>}
          {actions && <div className="ui-card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export default Card
