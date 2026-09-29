// =============================================================================
// PageHeader — the one page header, in the orange bar (plan §4, review F32).
//
//   56px tall, the one 24px gutter, title at the H1 step (sentence case, 600),
//   an optional Dense subtitle, an optional `leading` slot (the tool pages'
//   wordmark logo) and a right-hand `actions` slot (the nav hamburger).
//
// It replaced FOUR headers: three byte-identical tool blocks in App.jsx that
// differed only in two strings, and a fifth-way OR chain for the page bar.
// Four sizes (18 / 20 / 24 / 24), three cases, three inks and two gutters
// (16 and 24px) become one of each.
//
// ── The two inks, and why they differ ────────────────────────────────────────
// This sits ON the orange frame, where text is white or black and nothing
// else (C6, Audrey 2026-08-10, in capitals). White measures 3.56:1 on
// `#ea580c`, which clears 3:1 for large text but fails 4.5:1 for small — so
// the TITLE is white (20px at 600 is large text) and the SUBTITLE is
// `ink-light` (4.91:1). The subtitle shipped as `text-orange-200` at 2.63:1,
// which is the single worst-contrast piece of standing copy in the app.
//
// `measure` caps the header to the same centred column its page uses, so the
// title sits directly above the page's own first row. A page capped to 1240
// under a full-bleed title is a title that does not line up with anything
// underneath it.
//
// The title is passed in, never transformed here: the registry holds it in
// sentence case (Q2) and the page transition applies its own
// `text-transform: uppercase` for the 400ms it holds the title (Q18 — the
// transition is untouched).
// =============================================================================

export function PageHeader({ title, subtitle, leading, actions, measure = null, className = '', ...rest }) {
  return (
    <header className={`ui-page-header ${className}`.trim()} data-measure={measure || undefined} {...rest}>
      {leading}
      <div className="ui-page-header-text">
        <h1 className="ui-page-header-title">{title}</h1>
        {subtitle && <p className="ui-page-header-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="ui-page-header-actions">{actions}</div>}
    </header>
  )
}

export default PageHeader
