// =============================================================================
// Stat — one metric (plan §4): a Label-step name, a tabular value, an optional
// delta in one of the status tones.
//
// For the four tiles in R.A.B.B.I.T.'s Tasks view and the Summary band, where
// four numbers are currently four different type treatments. The value is the
// mono at tabular figures so a row of tiles lines up digit under digit, and
// the label sits ABOVE it: the number is what you came for, and a label
// underneath reads as a caption belonging to the next tile along.
// =============================================================================

import { statusMeta } from './StatusDot'

export function Stat({
  label,
  value,
  delta,
  deltaTone,
  deltaStatus,
  hint,
  surface = 'dark',
  className = '',
  ...rest
}) {
  const tone = deltaTone || (deltaStatus ? statusMeta(deltaStatus).tone : 'neutral')
  return (
    <div className={`ui-stat ${className}`.trim()} data-surface={surface} {...rest}>
      <div className="ui-stat-label">{label}</div>
      <div className="ui-stat-value" title={hint}>{value}</div>
      {delta != null && <div className="ui-stat-delta" data-tone={tone}>{delta}</div>}
    </div>
  )
}

export default Stat
