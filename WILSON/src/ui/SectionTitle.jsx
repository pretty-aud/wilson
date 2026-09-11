// =============================================================================
// SectionTitle — the one section heading (plan §4).
//
//   H2 (16px / 600) in sentence case, no tracking, an optional Dense
//   description, an optional Label-step eyebrow, and a HAIRLINE ABOVE rather
//   than a filled bar or a bordered box.
//
// The same nominal role shipped at 9.5, 12 and 14px with tracking-wide,
// -wider and -widest, and one version wrapped in a filled stone-700 bar —
// nine copies of one of them in SettingsPage alone. Sentence case is Q2: a
// section heading and a table header and a button were the same typographic
// object (10-12px bold uppercase tracked), and when everything is emphasised
// nothing is.
//
// A FIELD label is not this: that is the Label role, and it lives in `Field`.
// =============================================================================

export function SectionTitle({
  children,
  eyebrow,
  description,
  actions,
  rule = true,
  surface = 'dark',
  as: As = 'h2',
  className = '',
  ...rest
}) {
  return (
    <div
      className={`ui-section ${className}`.trim()}
      data-surface={surface}
      data-rule={rule || undefined}
      {...rest}
    >
      <div className="ui-section-text">
        {eyebrow && <div className="ui-section-eyebrow">{eyebrow}</div>}
        <As className="ui-section-title">{children}</As>
        {description && <p className="ui-section-desc">{description}</p>}
      </div>
      {actions && <div className="ui-section-actions">{actions}</div>}
    </div>
  )
}

export default SectionTitle
