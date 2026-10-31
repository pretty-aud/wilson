// =============================================================================
// Banner — the in-flow warning strip (plan §4). One line of Dense text on a
// 14% tint of its tone with a hairline under it; an optional lucide icon
// and an action slot on the right. It sits IN the flow (above the chrome,
// like ModelWarningBanner, which becomes its first caller in D2) and never
// times out; a message that should go away by itself is a Toast.
//
//   tone: 'info' | 'success' | 'warning' | 'danger'   (default info)
//
// On the orange frame or a light page pass surface="light": the ink there
// is `ink-light`, because on orange text is black or white.
//
// Post-overhaul VW1d (2026-10-25), the kit request VW1-KR-4 of
// docs/design/CUSTOM_VIEWS_DESIGN.md §8: `live={false}` drops the Banner's
// own live role — both of them, `status` and the danger and warning tones'
// `alert` (VW1d step 0, finding 17). Its caller, the custom views' *changed
// for now* bar, writes its words into its table's one polite live region
// instead, so a screen reader hears them once, and a Banner that comes and
// goes with every change is not announced twice.
// =============================================================================

export const BANNER_TONES = Object.freeze(['info', 'success', 'warning', 'danger'])

export function Banner({ tone = 'info', Icon, icon, children, action, surface = 'dark', live = true, className = '', ...rest }) {
  const Glyph = Icon || icon
  return (
    <div
      role={!live ? undefined : tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={`ui-banner ${className}`.trim()}
      data-tone={tone}
      data-surface={surface}
      {...rest}
    >
      {Glyph && <Glyph aria-hidden="true" />}
      <div className="ui-banner-text">{children}</div>
      {action}
    </div>
  )
}

export default Banner
