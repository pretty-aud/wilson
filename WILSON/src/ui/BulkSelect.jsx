// =============================================================================
// BulkSelect — a bulk bar's picker (post-overhaul F10, rabbit A6): the kit's
// small well, its first option the label it always shows, a choice applied
// the moment it is picked and the select back on its label. Four copies of
// this lived in R.A.B.B.I.T.'s views (the Tasks, Assets, Levels/Experiences
// and Scenes bars); they differed in their words and in one defect.
//
// `options` are values, or `{ value, label }` (CellSelect's shape). An
// option's words: its own label; else, with `labels`, `labels[value]` (the
// value itself where that is empty, as before); with no `labels`, the value in
// sentence case (humanizeStatus, the Scenes bars' words). The Tasks, Assets
// and Levels copies ran `.replace(/_/g, ' ')` over every label, so a phase or a
// person whose NAME held an underscore read without it; a label is now read
// as given.
//
// `allowEmpty` adds "None", which answers `onPick(null)`: clear the field on
// every ticked row. In the Tasks and Assets copies "None" had the label
// option's own value, '', which their change handler ignored, so picking it
// did nothing while every caller's `v || null` expected the clear (F10's
// measurement). The two are the changes this piece makes on screen.
//
// The look is the well's (`.ui-input[data-size="sm"]`) plus the caller's
// class, where its bar's sheet places it. A caller may write the pair whole
// (`className="ui-input rb-scene-bulk-select"`, so its sheet's guards read the
// pair in its own source); the kit's class is not written twice.
// =============================================================================

import { humanizeStatus } from './StatusDot'

const withKitInput = (cls) => {
  const parts = String(cls || '').split(/\s+/).filter(Boolean)
  return ['ui-input', ...parts.filter(p => p !== 'ui-input')].join(' ')
}

// A value no real option holds (statuses, types, ids), so "None" is never the
// label's ''.
const NONE = 'ui-bulk-none'

export function BulkSelect({ label, options = [], labels = null, onPick, allowEmpty = false, emptyLabel = 'None', className = '', ...rest }) {
  const words = (o) => {
    const value = o?.value ?? o
    if (o?.label != null) return o.label
    return labels ? (labels[value] || String(value)) : humanizeStatus(value)
  }
  return (
    // The caller's other props first: none replaces the picker's own
    // (its change, its class pair, its size; F10 review round 1, 1A-09).
    <select
      {...rest}
      defaultValue=""
      aria-label={label}
      onChange={(e) => {
        const v = e.target.value
        if (v === '') return
        onPick?.(v === NONE ? null : v)
        e.target.value = ''
      }}
      className={withKitInput(className)}
      data-size="sm"
    >
      <option value="" disabled>{label}</option>
      {allowEmpty && <option value={NONE}>{emptyLabel}</option>}
      {options.map((o) => {
        const value = o?.value ?? o
        return <option key={value} value={value}>{words(o)}</option>
      })}
    </select>
  )
}

export default BulkSelect
