// =============================================================================
// StatusBadge — dot + word from one semantic source (plan §4, StatusDot.jsx).
// Label step, 20px, a 14% tint of the tone behind the ink; on a light
// surface the well and the one ink, tone carried by the word alone.
// `children` overrides the label text (a count, say) without changing the
// tone; `label` overrides the accessible name and the word together.
// =============================================================================

import { statusMeta } from './StatusDot'

export function StatusBadge({ status, tone, label, children, title, surface = 'dark', className = '', ...rest }) {
  const meta = statusMeta(status)
  const t = tone || meta.tone
  const word = label || meta.label
  return (
    <span
      className={`ui-status ${className}`.trim()}
      data-tone={t}
      data-status={status}
      data-surface={surface}
      title={title}
      {...rest}
    >
      <span className="ui-status-dot" data-tone={t} data-surface={surface} aria-hidden="true" />
      <span>{children ?? word}</span>
    </span>
  )
}

export default StatusBadge
