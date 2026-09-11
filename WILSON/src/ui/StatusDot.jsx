// =============================================================================
// StatusDot — a status as a dot plus an accessible name (plan §4).
//
// ONE semantic source: every status the app shows maps here to a tone and a
// label, so a status colour can never be written inline again (four copies
// of `statusColor` today, with three greens, a cool grey and a violet that
// exist nowhere else). Tones resolve to tokens in index.css
// (`[data-tone="success"] { --status-color: var(--color-success) }`), so the
// dot's colour is a stylesheet decision, not a prop. No glow (F20). Never
// colour alone: the dot always carries `aria-label`, and StatusBadge adds
// the word. On a light surface the dot is the one ink (plan §3.2: no status
// colour is drawn on the light ground).
//
// Unknown statuses render neutral with a humanised label rather than
// throwing — a new status in the data must never blank a table.
// =============================================================================

export const STATUS = Object.freeze({
  not_started:      { tone: 'neutral', label: 'Not started' },
  waiting_to_start: { tone: 'neutral', label: 'Waiting to start' },
  in_progress:      { tone: 'signal',  label: 'In progress' },
  blocked:          { tone: 'danger',  label: 'Blocked' },
  on_hold:          { tone: 'warning', label: 'On hold' },
  pending_review:   { tone: 'warning', label: 'Pending review' },
  needs_revisions:  { tone: 'warning', label: 'Needs revisions' },
  approved:         { tone: 'success', label: 'Approved' },
  final:            { tone: 'success', label: 'Final' },
  omitted:          { tone: 'neutral', label: 'Omitted' },
  active:           { tone: 'success', label: 'Active' },
  wrapped:          { tone: 'success', label: 'Wrapped' },
  draft:            { tone: 'neutral', label: 'Draft' },
  archived:         { tone: 'neutral', label: 'Archived' },
  online:           { tone: 'success', label: 'Online' },
  offline:          { tone: 'neutral', label: 'Offline' },
})

export const STATUS_TONES = Object.freeze(['neutral', 'signal', 'success', 'warning', 'danger'])

export function humanizeStatus(status) {
  return String(status ?? '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}

/** { tone, label } for a status key; neutral + humanised for an unknown one. */
export function statusMeta(status) {
  return STATUS[status] || { tone: 'neutral', label: humanizeStatus(status) || 'Unknown' }
}

export function StatusDot({ status, tone, label, title, surface = 'dark', className = '', ...rest }) {
  const meta = statusMeta(status)
  const t = tone || meta.tone
  const name = label || meta.label
  return (
    <span
      role="img"
      aria-label={name}
      title={title ?? name}
      className={`ui-status-dot ${className}`.trim()}
      data-tone={t}
      data-surface={surface}
      {...rest}
    />
  )
}

export default StatusDot
