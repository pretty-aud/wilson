// ============================================================
// RABBIT — *Create grouping* (VW1d, 2026-10-25)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §4.11 (as VW1d's step 0 review
// corrected it). Her Q-D: "create a button called create grouping. so if the
// user wants to create a grouping give them a button that allows them to do
// this with a window with boolean check boxes for each item"; Q-D2 "Saved for
// the project"; Q-D3 "In the toolbar". The kit Dialog "Create grouping": a
// search field and a check box for every live item of the kind (with what
// tells same-named items apart), the grouping's name made from the ticked
// items as they are ticked (in the display order: a combination's name, as
// its group will read), *Cancel* and *Create* (at least one ticked; a set
// stored already says so instead). Created, the grouping shows at once,
// empty, ready for rows to be dragged in — whatever the view's *Hide empty
// groups* says (finding 1). Shared: VW1e's Assets, Levels and Experiences
// open it too.
//
// Laws: Tesler (the name is made for the person, from the ticks); Postel (a
// combination that exists already is said before any request, not refused
// after it).

import { useState } from 'react'
import { Button, Dialog } from '../../../../ui'
import { findGroupingBySet } from '../../state/tableViewsModel'
import { TickList } from './ViewFilterRow'
import './tableViews.css'

export const GROUPING_EXISTS_WORDS = 'That grouping already exists.'

/**
 * `options` the kind's live items `[{ value, label, apart }]` (the table's
 * description); `orderOf(kind)` the display order's comparator (the items'
 * lookup); `groupings` the project's groupings of this table and kind;
 * `onCreate(ids)` makes it (ctx.addItemGrouping) and may throw in words.
 */
export function CreateGroupingDialog({ tableKey, kind, singular, plural, options, orderOf = null, nameOf = null, groupings = [], onCreate, onClose }) {
  const [ticked, setTicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ordered = orderOf ? ticked.slice().sort(orderOf(kind)) : ticked
  const label = (id) => (nameOf ? nameOf(kind, id) : options.find(o => String(o.value) === String(id))?.label) || ''
  const name = ordered.map(label).join(', ')
  const exists = ticked.length > 0 && !!findGroupingBySet(groupings, tableKey, kind, ticked)
  async function create() {
    if (busy || ticked.length === 0 || exists) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(ticked)
      onClose()
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }
  return (
    <Dialog
      width="form"
      title="Create grouping"
      onClose={onClose}
      busy={busy}
      error={error}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={ticked.length === 0 || exists} onClick={create}>Create</Button>
        </>
      )}
    >
      <p className="rb-tv-ask">
        Tick the {plural.toLowerCase()} that belong together. The group is saved for everyone on the project, and tasks dragged into it take these {plural.toLowerCase()}.
      </p>
      <div className="rb-tv-group-name" aria-live="polite">
        <span className="rb-tv-row-label">Name</span>
        <span className="rb-tv-group-name-text" data-empty={name ? 'false' : 'true'}>{name || `Tick at least one ${String(singular || kind).toLowerCase()}`}</span>
      </div>
      {exists && <p className="rb-tv-field-error" role="status">{GROUPING_EXISTS_WORDS}</p>}
      <div className="rb-tv-group-list">
        <TickList options={options} chosen={ticked.map(String)} plural={plural} searchable
          onChange={(next) => { setTicked(next.map(v => options.find(o => String(o.value) === String(v))?.value ?? v)); setError(null) }} />
      </div>
    </Dialog>
  )
}
