// =============================================================================
// Panel — the one docked sidebar (plan §4).
//
//   Width tokens sm 200 / md 240 / lg 300, ONE hairline on the docked edge, a
//   32px header at the Label step, NO fill.
//
// Five widths (200, 200, 220, 224, 300), two border weights and four surface
// tones — including a one-off `#1f1c1a` that exists nowhere else in the app —
// become three widths and one rule. No fill is the point: a panel is defined
// by its hairline and its content, and the stone-800 / stone-700 pairing was
// three tones deep before anything had been drawn in it.
// =============================================================================

const WIDTHS = ['sm', 'md', 'lg']

export function Panel({
  children,
  title,
  actions,
  width = 'md',
  side = 'left',
  surface = 'dark',
  className = '',
  ...rest
}) {
  // An unknown width used to render data-width="220px", which matches no
  // rule, so the element got NO width at all and nothing said so in a
  // production build — the silent-wrong-answer shape the page registry
  // next door exists to eliminate. It falls back to the scale.
  const w = WIDTHS.includes(width) ? width : 'md'
  if (import.meta.env?.DEV && w !== width) console.error(`Panel: unknown width "${width}" — using "md"`)
  return (
    <aside
      className={`ui-panel ${className}`.trim()}
      data-width={w}
      data-side={side}
      data-surface={surface}
      {...rest}
    >
      {(title || actions) && (
        <header className="ui-panel-head">
          {title && <span className="ui-panel-title">{title}</span>}
          {actions && <div className="ui-panel-actions">{actions}</div>}
        </header>
      )}
      <div className="ui-panel-body">{children}</div>
    </aside>
  )
}

export default Panel
