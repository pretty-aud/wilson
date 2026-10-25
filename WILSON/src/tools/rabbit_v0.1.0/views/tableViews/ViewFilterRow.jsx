// ============================================================
// RABBIT — the custom views' filter row (VW1d, 2026-10-25)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §4.3 (Filters) and §4.8 (defects 1 and
// 2): "The toolbar's Filter strip and this card draw the same row
// component." Today's shape — *Where* / *And*, the field, the condition, the
// value, ✕ — with her Q13: a choice field's value is a picker with tick boxes
// (a child Popover, portalled: it may open inside the Views dropdown's card),
// one or several values ("Status is In progress, Pending review"); *is*
// matches any of them, *is not* none of them. A linked kind (Asset, Scene,
// Shot, Level, Experience): *is* = one of the row's items is among the
// values. A text field keeps one value. A row with no value yet filters
// nothing and is not counted (defect 1); changing its field resets its
// condition and value (defect 2). A value whose row is gone reads "No longer
// in the project" and matches nothing.
//
// Laws: Jakob (the row people already know, from the strip, inside the
// card, as her Q5a asked); Postel (an empty text is no value, not a filter
// that empties the table).

import { useRef, useState } from 'react'
import { X, ChevronDown, CheckSquare, Square, Search } from 'lucide-react'
import { IconButton, Popover } from '../../../../ui'
import { FILTER_VALUELESS_OPS } from '../../state/tableViewsModel'
import { withFilterField, withFilterOp } from './viewScreenModel'
import './tableViews.css'

export const GONE_WORDS = 'No longer in the project'

/**
 * One filter row. `row` is `{ field, op, values }` (column keys); `onChange`
 * takes the whole row; `index` 0 reads *Where*, the rest *And*.
 */
export function ViewFilterRow({ row, index, description, onChange, onRemove }) {
  const def = description.field(row.field)
  const ops = description.filterOps(def)
  const needsValue = !FILTER_VALUELESS_OPS.includes(row.op)
  const values = Array.isArray(row.values) ? row.values : []
  return (
    <div className="rb-tv-filter-row">
      <span className="rb-tv-filter-where text-label uppercase">{index === 0 ? 'Where' : 'And'}</span>
      <select value={row.field} aria-label="Field" className="ui-input rb-tv-filter-field" data-size="sm"
        onChange={e => onChange(withFilterField(row, e.target.value, description))}>
        {!def && <option value={row.field}>{row.field}</option>}
        {description.filterFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>
      <select value={row.op} aria-label="Condition" className="ui-input rb-tv-filter-op" data-size="sm"
        onChange={e => onChange(withFilterOp(row, e.target.value))}>
        {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {needsValue && (def?.filter === 'text' ? (
        <input type="text" value={values[0] == null ? '' : String(values[0])} aria-label="Value" placeholder="value…"
          className="ui-input rb-tv-filter-text" data-size="sm"
          onChange={e => onChange({ ...row, values: e.target.value === '' ? [] : [e.target.value] })} />
      ) : (
        <ValuePicker def={def} values={values} description={description} onChange={(next) => onChange({ ...row, values: next })} />
      ))}
      {!needsValue && <span className="rb-tv-filter-novalue" aria-hidden="true" />}
      <IconButton size="sm" Icon={X} danger title="Remove this filter" onClick={onRemove} />
    </div>
  )
}

/** The value button and its tick-box list (a child Popover). */
function ValuePicker({ def, values, description, onChange }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef(null)
  const options = def ? description.options(def.key) : []
  const chosen = values.map(String)
  const labelOf = (v) => options.find(o => String(o.value) === v)?.label ?? GONE_WORDS
  const words = chosen.map(labelOf).join(', ')
  return (
    <>
      <button ref={buttonRef} type="button" className="ui-input rb-tv-filter-value" data-size="sm"
        data-empty={chosen.length ? 'false' : 'true'}
        aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Value: ${chosen.length ? words : 'none chosen'}`}
        title={chosen.length ? words : undefined}
        onClick={() => setOpen(o => !o)}>
        <span className="rb-tv-filter-value-text">{chosen.length ? words : 'Choose…'}</span>
        <ChevronDown aria-hidden="true" className="rb-tv-filter-value-icon" />
      </button>
      {open && buttonRef.current && (
        <Popover anchor={buttonRef.current} label={`${def?.label || 'Field'}: values`} width={260} onClose={() => setOpen(false)}>
          <TickList options={options} chosen={chosen} plural={def?.label || 'Values'}
            onChange={onChange} />
        </Popover>
      )}
    </>
  )
}

/**
 * The list: a search past eight options (or always, `searchable`), then
 * every option with a tick box (role checkbox, one Tab stop, ↑ ↓ Home End
 * move, Space or Enter ticks — the item picker's model, VW1b), the gone
 * values first while chosen. Also *Create grouping*'s list.
 */
export function TickList({ options, chosen, plural, onChange, searchable = null }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef(null)
  const searchRef = useRef(null)
  const gone = chosen.filter(v => !options.some(o => String(o.value) === v))
  const q = query.trim().toLowerCase()
  const shown = [
    ...gone.map(v => ({ value: v, label: GONE_WORDS, gone: true })),
    ...options.filter(o => !q || String(o.label).toLowerCase().includes(q) || String(o.apart || '').toLowerCase().includes(q)),
  ]
  const at = Math.min(active, Math.max(0, shown.length - 1))
  const set = new Set(chosen)
  function toggle(v) {
    const key = String(v)
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    // Kept in the options' order, the gone ones first (stable words).
    const ordered = [
      ...gone.filter(g => next.has(g)),
      ...options.filter(o => next.has(String(o.value))).map(o => o.value),
    ]
    onChange(ordered)
  }
  const rowAt = (i) => listRef.current?.querySelectorAll('[role="checkbox"]')[i] || null
  const moveTo = (i) => {
    const n = Math.max(0, Math.min(shown.length - 1, i))
    setActive(n)
    rowAt(n)?.focus()
  }
  function onRowKey(e, i, v) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(i + 1) } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (i === 0 && searchRef.current) searchRef.current.focus()
      else moveTo(i - 1)
    } else if (e.key === 'Home') { e.preventDefault(); moveTo(0) } else if (e.key === 'End') {
      e.preventDefault(); moveTo(shown.length - 1)
    } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(v) }
  }
  const withSearch = searchable == null ? options.length > 8 : searchable
  return (
    <div className="rb-tv-values">
      {withSearch && (
        <div className="rb-tv-values-search">
          <Search aria-hidden="true" className="rb-tv-values-search-icon" />
          <input ref={searchRef} type="text" value={query} aria-label={`Search ${plural.toLowerCase()}`}
            placeholder="Search…" className="ui-input rb-tv-values-input" data-size="sm"
            onChange={e => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={e => { if (e.key === 'ArrowDown' && shown.length) { e.preventDefault(); moveTo(at) } }} />
        </div>
      )}
      <div ref={listRef} className="rb-tv-values-list" role="group" aria-label={plural}>
        {shown.length === 0 ? (
          <p className="rb-tv-values-empty">{q ? 'No matches' : 'Nothing to choose yet'}</p>
        ) : shown.map((o, i) => {
          const on = set.has(String(o.value))
          return (
            <div key={`${o.gone ? 'gone:' : ''}${o.value}`} role="checkbox" aria-checked={on ? 'true' : 'false'}
              tabIndex={i === at ? 0 : -1}
              className="rb-tv-values-row"
              data-ticked={on ? 'true' : 'false'}
              data-gone={o.gone ? 'true' : 'false'}
              onClick={() => { setActive(i); toggle(o.value) }}
              onKeyDown={(e) => onRowKey(e, i, o.value)}>
              <span className="rb-tv-values-tick" aria-hidden="true">{on ? <CheckSquare /> : <Square />}</span>
              <span className="rb-tv-values-name">{o.label}</span>
              {o.apart && <span className="rb-tv-values-apart">{o.apart}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
