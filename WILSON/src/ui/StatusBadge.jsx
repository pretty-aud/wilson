// =============================================================================
// StatusBadge — dot + word from one semantic source (plan §4, StatusDot.jsx).
// Label step, 20px, a 14% tint of the tone behind the ink; on a light
// surface the well and the one ink, tone carried by the word alone.
// `children` overrides the label text (a count, say) without changing the
// tone; `label` overrides the accessible name and the word together.
// =============================================================================

import { StatusDot, statusMeta } from './StatusDot'

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
      {/* The dot is StatusDot, not a second copy of its markup: one element,
          one set of tone rules, one place a status colour is decided. The
          badge supplies the accessible name in its own word, so the dot is
          hidden from the accessibility tree here. */}
      <StatusDot tone={t} status={status} aria-hidden="true" role={undefined} aria-label={undefined} title={undefined} surface={surface} />
      <span>{children ?? word}</span>
    </span>
  )
}

export default StatusBadge
