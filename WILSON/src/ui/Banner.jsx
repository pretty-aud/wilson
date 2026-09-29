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
// =============================================================================

export const BANNER_TONES = Object.freeze(['info', 'success', 'warning', 'danger'])

export function Banner({ tone = 'info', Icon, icon, children, action, surface = 'dark', className = '', ...rest }) {
  const Glyph = Icon || icon
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
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
