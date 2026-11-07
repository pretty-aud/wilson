// MothTimeSlider.jsx — MO2: scrub back to see the project as it was (the brief §3.1; her Q2). Read-only while it
// looks back; everything before the record's start is said to be not recorded, never drawn as empty.
import { Button } from '../../../ui'

const HOUR = 3600000
const day = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const when = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export default function MothTimeSlider({ history }) {
  if (!history) return null
  if (history.available === false) {
    return <p className="moth-quiet" data-moth-time-absent>{history.localOnly ? 'History is not recorded for projects kept only on this computer.' : 'History is not on this database yet.'}</p>
  }
  const now = history.now ?? Date.now()
  const floor = Math.min(history.floor ?? now - 90 * 86400000, now)
  const value = history.at ?? now
  return (
    <div className="moth-time" data-moth-time>
      <label className="moth-label" htmlFor="moth-time-range">Look back</label>
      <input
        id="moth-time-range"
        className="moth-time-range"
        type="range"
        min={floor}
        max={now}
        step={HOUR}
        value={value}
        aria-valuetext={history.at ? when(value) : 'Now'}
        onChange={(e) => {
          const t = Number(e.target.value)
          history.setAt(t >= now - HOUR ? null : t)
        }}
        data-moth-time-range
      />
      <p className="moth-quiet" data-moth-time-says>
        {history.at ? `As it was ${when(history.at)}. Looking back changes nothing.` : 'Now.'}
        {' '}Not recorded before {day(floor)}.
        {history.loading ? ' Reading…' : ''}
        {history.error ? ` ${history.error}` : ''}
        {history.incomplete ? ' Only part of this period could be read.' : ''}
      </p>
      {history.at != null && <Button size="sm" variant="ghost" onClick={() => history.setAt(null)} data-moth-time-now>Back to now</Button>}
    </div>
  )
}
