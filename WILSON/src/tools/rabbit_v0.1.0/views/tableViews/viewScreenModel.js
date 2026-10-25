// ============================================================
// RABBIT — custom table views on screen: the rules (VW1d, 2026-10-25)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §4.2 to §4.5 and §6 (as VW1d's step 0
// review corrected them, §11 round 5), on top of the data's rules
// (state/tableViewsModel.js) and the provider's API (state/tableViewsState.js).
// Pure: the shared views piece (views/tableViews/) reads a table through its
// DESCRIPTION — its fields (key, label, how to filter, sort and group them),
// its defaults — and these functions turn a view and the change for now into
// what the table shows and what the bar says. Every key is the table's column
// key (§5.1); a description may name a sortable field that is no column
// (Tasks' `created_at`, finding 5).
//
// Her answers: Q3 (a change is for the moment until saved), Q3a (Save, Save
// as new view, Reset; All cannot change; reviewers Reset only), Q3c and Q-A3
// (the bar only while there are unsaved edits), Q3d (a teammate's save
// follows; one's own change stays, and the bar says so), Q-G3 (Save over a
// teammate's newer save asks first), Q5 and Q5a (the four parts and their
// summaries), Q6 and Q7 (order and visibility of fields, the name always
// shown), Q13 (every condition must match; a condition can match any of
// several values), Q14 (several sorts in order), Q15 (one grouping, Hide
// empty groups), Q21 (defects 1 and 2).

import {
  readViewConfig, writeViewConfig, isCompleteFilter, FILTER_VALUELESS_OPS, ALL_VIEW_ID,
} from '../../state/tableViewsModel'

// ── Fields: order and visibility (Q6, Q7; design §4.3, §5.1) ─────────────

/**
 * The fields as the table shows them: `[{ key, visible, fixed }]` over
 * `defaultKeys` (the table's fields now, in their default order). The keys a
 * view lists fill the places of the listed keys in the listed order; a key
 * the view does not list keeps its default place and shows (§5.1: "a field
 * the view does not list shows at its default place"); a listed key the
 * table does not have now is left out; a `fixed` key (the name, Q6) keeps
 * its place and always shows.
 */
export function effectiveFields(fields, defaultKeys, { fixed = [] } = {}) {
  const keys = Array.isArray(defaultKeys) ? defaultKeys : []
  const present = new Set(keys)
  const fixedSet = new Set(fixed)
  const seen = new Set()
  const listed = []
  for (const f of Array.isArray(fields) ? fields : []) {
    if (!f || typeof f.key !== 'string' || !present.has(f.key) || fixedSet.has(f.key) || seen.has(f.key)) continue
    seen.add(f.key)
    listed.push({ key: f.key, visible: f.visible !== false })
  }
  const queue = [...listed]
  return keys.map((key) => {
    if (fixedSet.has(key)) return { key, visible: true, fixed: true }
    if (!seen.has(key)) return { key, visible: true, fixed: false }
    const next = queue.shift()
    return { key: next.key, visible: next.visible, fixed: false }
  })
}

/**
 * The `fields` to keep for an effective list (the Fields card's result):
 * empty when it is the default (every field shown, in the default order),
 * else every field but the fixed ones, in order, with the stored entries for
 * keys the table does not have now kept after them (a Level column a project
 * shows again finds its place).
 */
export function fieldsToStore(effective, stored, defaultKeys) {
  const list = (Array.isArray(effective) ? effective : []).filter(f => f && !f.fixed)
  const keys = (Array.isArray(defaultKeys) ? defaultKeys : [])
  const present = new Set(keys)
  const kept = (Array.isArray(stored) ? stored : []).filter(f => f && typeof f.key === 'string' && !present.has(f.key))
  const plain = keys.filter(k => list.some(f => f.key === k))
  const isDefault = list.every(f => f.visible) && list.map(f => f.key).join('\n') === plain.join('\n')
  if (isDefault && kept.length === 0) return []
  return [...list.map(f => ({ key: f.key, visible: f.visible })), ...kept.map(f => ({ key: f.key, visible: f.visible !== false }))]
}

/**
 * A field dragged onto another's place (the Fields card's handle, her Q7:
 * "you drag fields up and down"): it takes the target's place, the rest
 * close up; the name never moves and nothing goes before it.
 */
export function moveFieldTo(effective, key, targetKey) {
  const list = (Array.isArray(effective) ? effective : []).map(f => ({ ...f }))
  const from = list.findIndex(f => f.key === key)
  const to = list.findIndex(f => f.key === targetKey)
  if (from < 0 || to < 0 || from === to || list[from].fixed || list[to].fixed) return list
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
  return list
}

/** A list's item dragged from one place to another (the Sort card's handle). */
export function moveItemTo(list, from, to) {
  const out = (Array.isArray(list) ? list : []).slice()
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out
  const [moved] = out.splice(from, 1)
  out.splice(to, 0, moved)
  return out
}

/** A field moved up (-1) or down (+1) among the movable ones; the list as it is when it cannot move. */
export function moveField(effective, key, by) {
  const list = (Array.isArray(effective) ? effective : []).map(f => ({ ...f }))
  const i = list.findIndex(f => f.key === key)
  const j = i + by
  if (i < 0 || j < 0 || j >= list.length || list[i].fixed || list[j].fixed) return list
  ;[list[i], list[j]] = [list[j], list[i]]
  return list
}

// ── Filters (Q13; defects 1 and 2) ──────────────────────────────────────

/** How many filters filter: an incomplete row (no value yet) filters nothing and is not counted (defect 1). */
export function filterCount(filters) {
  return (Array.isArray(filters) ? filters : []).filter(isCompleteFilter).length
}

const text = (v) => (v == null ? '' : String(v))

/**
 * Does `row` match one filter? `values` is the row's values for the field
 * (`description.valuesOf(row, field)`: a linked kind's live ids, a choice's
 * one value, a text's one string; [] for none). An incomplete filter matches
 * every row (defect 1).
 *   is / is not   any of the filter's values is one of the row's / none is
 *                 (a text field: the text, whole, case ignored);
 *   is empty      the row has none; is not empty, it has one;
 *   contains      a text field's text holds the filter's (case ignored), or not.
 */
export function matchesFilter(values, filter) {
  if (!isCompleteFilter(filter)) return true
  const mine = (Array.isArray(values) ? values : []).filter(v => v != null && v !== '').map(text)
  const wanted = FILTER_VALUELESS_OPS.includes(filter.op) ? [] : filter.values.map(text)
  const lower = (s) => s.toLowerCase()
  switch (filter.op) {
    case 'is_empty': return mine.length === 0
    case 'is_not_empty': return mine.length > 0
    case 'is': return mine.some(v => wanted.includes(v)) || (filter.text === true && mine.some(v => wanted.some(w => lower(w) === lower(v))))
    case 'is_not': return !mine.some(v => wanted.includes(v) || (filter.text === true && wanted.some(w => lower(w) === lower(v))))
    case 'contains': return mine.some(v => wanted.some(w => lower(v).includes(lower(w))))
    case 'not_contains': return !mine.some(v => wanted.some(w => lower(v).includes(lower(w))))
    default: return true
  }
}

/** The rows every complete filter matches (Q13: all must match). */
export function applyViewFilters(rows, filters, description) {
  const list = (Array.isArray(filters) ? filters : []).filter(isCompleteFilter)
  if (list.length === 0) return rows
  return rows.filter(row => list.every((f) => {
    const field = description.field(f.field)
    if (!field || !field.filter) return true
    const values = description.valuesOf(row, f.field)
    return matchesFilter(values, field.filter === 'text' ? { ...f, text: true } : f)
  }))
}

/**
 * A filter row after its FIELD changed (defect 2): the new field's first
 * condition and no value — the old condition and value belonged to the old
 * field ("Status is In progress" never becomes "Title is in_progress").
 */
export function withFilterField(row, field, description) {
  const def = description.field(field)
  const ops = def ? description.filterOps(def) : []
  return { field, op: ops[0]?.value || 'is', values: [] }
}

/** A filter row after its CONDITION changed: a condition that takes no value keeps none. */
export function withFilterOp(row, op) {
  return { ...row, op, values: FILTER_VALUELESS_OPS.includes(op) ? [] : (Array.isArray(row.values) ? row.values : []) }
}

// ── Sorts (Q14) ─────────────────────────────────────────────────────────

/**
 * The rows in the sorts' order, each sort breaking the previous one's ties
 * (`description.compare(field, a, b)`); rows equal on every sort keep their
 * order. No sort: the rows as given.
 */
export function applyViewSorts(rows, sorts, description) {
  const list = (Array.isArray(sorts) ? sorts : []).filter(s => s && description.field(s.field)?.sortable)
  if (list.length === 0) return rows
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      for (const s of list) {
        const d = description.compare(s.field, a.row, b.row)
        if (d !== 0) return s.dir === 'desc' ? -d : d
      }
      return a.i - b.i
    })
    .map(x => x.row)
}

/**
 * The toolbar's Sort sets the FIRST sort (Q14; design §4.3): a field already
 * used later moves to the front (its later place goes); '' takes the first
 * away. The direction stays the first sort's.
 */
export function withFirstSort(sorts, field) {
  const list = (Array.isArray(sorts) ? sorts : []).filter(Boolean)
  if (!field) return list.slice(1)
  const dir = list[0]?.dir === 'desc' ? 'desc' : 'asc'
  const rest = list.slice(1).filter(s => s.field !== field)
  return [{ field, dir: list[0]?.field === field ? list[0].dir : dir }, ...rest]
}

/** The first sort's direction turned round. */
export function withFirstSortReversed(sorts) {
  const list = (Array.isArray(sorts) ? sorts : []).filter(Boolean)
  if (list.length === 0) return list
  return [{ ...list[0], dir: list[0].dir === 'desc' ? 'asc' : 'desc' }, ...list.slice(1)]
}

/** A list's item moved up (-1) or down (+1); the list as it is when it cannot move. */
export function moveItem(list, index, by) {
  const out = (Array.isArray(list) ? list : []).slice()
  const j = index + by
  if (index < 0 || index >= out.length || j < 0 || j >= out.length) return out
  ;[out[index], out[j]] = [out[j], out[index]]
  return out
}

// ── The config on screen, and whether it is a change ─────────────────────

/** A config as the table reads it: incomplete filters dropped, every part read with *All*'s fallbacks. */
export function readable(config, tableKey) {
  return readViewConfig(writeViewConfig(null, config || {}), tableKey).config
}

const sortedValues = (f) => ({ field: f.field, op: f.op, values: [...f.values].map(text).sort() })
const groupKey = (g) => (g ? `${g.field}\u0001${g.hideEmpty ? 1 : 0}` : '')

/**
 * Do two configs show the table alike (design §4.4: only a real change
 * raises the bar)? The layout, the complete filters (their values as a set),
 * the sorts, the grouping and its switch, the Board's, the key dates and the
 * fields over the table's fields NOW (`fieldKeys`, `fixed`): an empty filter
 * row, a field the table does not have and a key this build does not know
 * change nothing on screen.
 */
export function sameEffect(a, b, { tableKey, fieldKeys = [], fixed = [] } = {}) {
  const x = readable(a, tableKey)
  const y = readable(b, tableKey)
  if (x.layout !== y.layout) return false
  if (JSON.stringify(x.filters.map(sortedValues)) !== JSON.stringify(y.filters.map(sortedValues))) return false
  if (JSON.stringify(x.sorts) !== JSON.stringify(y.sorts)) return false
  if (groupKey(x.group) !== groupKey(y.group)) return false
  if (groupKey(x.board) !== groupKey(y.board)) return false
  if ((x.keyDates ?? true) !== (y.keyDates ?? true)) return false
  const fx = effectiveFields(x.fields, fieldKeys, { fixed })
  const fy = effectiveFields(y.fields, fieldKeys, { fixed })
  return JSON.stringify(fx) === JSON.stringify(fy)
}

// ── The "This view" summaries (design §4.2) ──────────────────────────────

export function filtersSummary(config) {
  const n = filterCount(config?.filters)
  return n === 0 ? 'None' : n === 1 ? '1 filter' : `${n} filters`
}

export function sortSummary(config, description) {
  const list = (config?.sorts || []).map(s => description.field(s.field)?.short || description.field(s.field)?.label).filter(Boolean)
  return list.length === 0 ? 'Default order' : list.join(', then ')
}

export function groupSummary(config, description) {
  const board = config?.layout === 'board'
  const g = board ? config?.board : config?.group
  const label = g?.field ? description.field(g.field)?.label : null
  if (board) return label ? `Columns by ${label.toLowerCase()}` : 'One column'
  return label ? `By ${label.toLowerCase()}` : 'None'
}

export function fieldsSummary(effective) {
  const list = Array.isArray(effective) ? effective : []
  return `${list.filter(f => f.visible).length} of ${list.length} shown`
}

// ── The bar (design §4.4, derived on render: step 0 review, finding 4) ───

export const BAR_WORDS = Object.freeze({
  cannotWrite: 'Only the project\'s editors can save views.',
  unavailable: 'Changed for now. Saved views are not on this server yet.',
  stillOnScreen: 'Your changes are still on screen.',
  gate: 'You can no longer change views on this project.',
  newer: 'This view was made by a newer WILSON.',
})

/**
 * The *changed for now* bar's state, or null when it is not shown (no
 * change of one's own: her Q-A3). Every input is what is on screen now:
 *
 *   isAll         the view on screen is the built-in *All*
 *   name          the view's name (the deleted one's, kept in the change)
 *   ownChange     the change for now shows the table otherwise than the view
 *   deleted       the view the change began from is gone
 *   moved         the view's revision is past the one the change began from
 *   revisedBy     who made that revision (`revised_by`); `me` the person
 *   whoName       revisedBy's name in the workspace roster, or null
 *   canWrite      the seat may save views (Q2, Q-F)
 *   available     the backend keeps views
 *   refusal       the last save's refusal for this view: { kind: 'filtered' } | { kind: 'failed', reason }
 *   newer         the view was written by a newer WILSON
 *
 * Answers `{ tone, words, actions, disabled }`: `actions` in the bar's order
 * from 'retry', 'reset', 'saveAsNew', 'save'; `disabled` a reason per action
 * shown greyed; `asks` true when Save writes over a teammate's (Q-G3).
 */
export function barStateOf({
  isAll = false, name = '', ownChange = false, deleted = false, moved = false,
  revisedBy = null, me = null, whoName = null, canWrite = false, available = true,
  refusal = null, newer = false,
} = {}) {
  if (!ownChange) return null
  const still = BAR_WORDS.stillOnScreen
  if (!available) return { tone: 'info', words: BAR_WORDS.unavailable, actions: ['reset'], disabled: {} }
  if (deleted && !isAll) {
    return { tone: 'info', words: `${name} was deleted. ${still}`, actions: canWrite ? ['reset', 'saveAsNew'] : ['reset'], disabled: {} }
  }
  if (!canWrite) {
    return { tone: 'info', words: `${isAll ? 'All' : name}: changed for now. ${BAR_WORDS.cannotWrite}`, actions: ['reset'], disabled: {} }
  }
  if (refusal?.kind === 'filtered') {
    return { tone: 'danger', words: BAR_WORDS.gate, actions: ['reset', 'saveAsNew'], disabled: { saveAsNew: BAR_WORDS.gate } }
  }
  if (refusal?.kind === 'failed' && !isAll) {
    const reason = String(refusal.reason || 'the request failed').replace(/[.\s]+$/, '')
    return { tone: 'danger', words: `${name} could not be saved: ${reason}.`, actions: ['retry', 'reset'], disabled: {} }
  }
  if (isAll) return { tone: 'info', words: 'All: changed for now', actions: ['reset', 'saveAsNew'], disabled: {} }
  const disabled = newer ? { save: BAR_WORDS.newer } : {}
  // A newer WILSON's view: its reason in the words too (code review round 1,
  // R1-7: a disabled button's tooltip reaches neither a keyboard nor a
  // screen reader).
  const tail = newer ? ` ${BAR_WORDS.newer}` : ''
  if (moved) {
    let words
    if (revisedBy && me && String(revisedBy) === String(me)) words = `You changed ${name} in another window. Your changes here are still on screen.`
    else if (!revisedBy) words = `${name} was changed on another computer. ${still}`
    else words = `${whoName || 'Someone'} changed ${name}. ${still}`
    return { tone: 'info', words: words + tail, actions: ['reset', 'saveAsNew', 'save'], disabled, asks: true }
  }
  return { tone: 'info', words: `${name}: changed for now${tail}`, actions: ['reset', 'saveAsNew', 'save'], disabled }
}

// ── The view on screen (design §4.5) ─────────────────────────────────────

/**
 * Which view a table shows: the change for now's view while it has one
 * (kept across tabs, Q3b); else the person's last used view on the table
 * (Q4), read only while the map is `ready`; else *All*. A view that is no
 * longer there (deleted since, by a teammate or on another computer) is
 * *All* — unless the change for now began from it: then the change stays on
 * screen and the bar says the view was deleted (§4.4).
 *
 * Answers `{ id, row, deleted, waiting }`: `row` the view's row (null for
 * *All*), `deleted` the change's view is gone, `waiting` the last used map
 * has not answered yet (the table shows the kit Loading line, §4.5).
 */
export function viewOnScreen({ draft = null, views = [], lastStatus = 'unavailable', lastId = null } = {}) {
  const find = (id) => (views || []).find(v => v && String(v.id) === String(id)) || null
  if (draft && draft.viewId != null) {
    if (draft.viewId === ALL_VIEW_ID) return { id: ALL_VIEW_ID, row: null, deleted: false, waiting: false }
    const row = find(draft.viewId)
    if (row) return { id: row.id, row, deleted: false, waiting: false }
    return { id: draft.viewId, row: null, deleted: true, waiting: false }
  }
  if (lastStatus === 'loading') return { id: ALL_VIEW_ID, row: null, deleted: false, waiting: true }
  if (lastStatus === 'ready' && lastId && lastId !== ALL_VIEW_ID) {
    const row = find(lastId)
    if (row) return { id: row.id, row, deleted: false, waiting: false }
  }
  return { id: ALL_VIEW_ID, row: null, deleted: false, waiting: false }
}

/** "Shoot week copy", within the 80 characters a name may hold. */
export function copyName(name, max = 80) {
  const suffix = ' copy'
  const base = String(name || 'View').trim()
  const chars = [...base]
  const room = max - suffix.length
  return (chars.length > room ? chars.slice(0, room).join('').trimEnd() : base) + suffix
}
