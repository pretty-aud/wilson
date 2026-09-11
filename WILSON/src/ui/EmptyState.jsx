// =============================================================================
// EmptyState — "there is nothing here", never "wait" (plan §4).
//
// 24px icon in the third ink, a Body title at 600, a Dense body, an action
// slot. It must never be passed a string containing "Loading": loading and
// empty used to be the same picture on seven surfaces (a full-deck run said
// "No output yet"; Logs called EmptyState with 'Loading...'), which is the
// difference between "nothing to do" and "not yet". Loading is a separate
// component with skeleton rows. In dev, a loading string is reported.
//
// Props are Bins' EmptyState's, unchanged: `Icon`, `title`, `body`,
// `children` (actions), `compact`.
// =============================================================================

const LOADING = /\bloading\b/i

export function EmptyState({ Icon, icon, title, body, children, compact = false, surface = 'dark', className = '', ...rest }) {
  const Glyph = Icon || icon
  if (import.meta.env?.DEV && (LOADING.test(String(title ?? '')) || LOADING.test(String(body ?? '')))) {
    console.error('EmptyState: received a loading string — render <Loading /> for that state instead')
  }
  return (
    <div
      className={`ui-empty ${className}`.trim()}
      data-compact={compact || undefined}
      data-surface={surface}
      role="status"
      {...rest}
    >
      {Glyph && <Glyph aria-hidden="true" />}
      <div className="ui-empty-title">{title}</div>
      {body && <div className="ui-empty-body">{body}</div>}
      {children && <div className="ui-empty-actions">{children}</div>}
    </div>
  )
}

export default EmptyState
