// ============================================================
// RABBIT — the Tasks table's description for the custom views (VW1d,
// 2026-10-25)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §6: "one R.A.B.B.I.T. component
// (`views/tableViews/`), given each table's description: its key, its
// fields (key, label, kind), its leading columns, its filterable, sortable
// and groupable fields (and which are linked kinds), its defaults (*All*),
// and how to read a row's value for a field." This is the Tasks table's.
// The other tables' are VW1e's.
//
// Every key is the table's COLUMN key (§5.1; VW1c step 0, finding 9):
// views/tasksTableColumns.js' `title`, `status`, `priority`, the item kinds
// (`asset`, `scene`, `shot`, `level`, `experience`), `phase_id`,
// `assignee_id`, `start_date`, `end_date`, `bid_days`; and `created_at`, a
// sort with no column (VW1d step 0, finding 5). The Tasks tab's older
// vocabularies — the Group menu's `phase` / `assignee` (its grouping code,
// buildGroupPatch, the add rows' defaults) and the old Filter strip's
// `asset_id` — are mapped here, once (groupToTab / groupFromTab).

import { statusMeta } from '../../../../ui'
import { ITEM_KINDS, KIND_LABEL, sortIdsForDisplay } from '../../state/taskItemsModel'
import { tasksTableColumns } from '../tasksTableColumns'

export const TASKS_TABLE = 'tasks'

export const TASK_STATUSES = Object.freeze([
  'waiting_to_start', 'in_progress', 'pending_review', 'needs_revisions',
  'approved', 'final', 'blocked', 'on_hold', 'omitted',
])
export const PRIORITIES = Object.freeze(['low', 'medium', 'high', 'urgent'])
// Sentence-case labels (Q2), a status's words from the kit's one status source.
export const STATUS_LABELS = Object.freeze(Object.fromEntries(TASK_STATUSES.map(s => [s, statusMeta(s).label])))
export const PRIORITY_LABELS = Object.freeze({ low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' })

/** The Board's card has fixed lines (VW1d step 0, finding 6): these are its fields, in its own order. */
export const CARD_FIELDS = Object.freeze(['status', 'priority', 'asset', 'assignee_id', 'start_date', 'bid_days'])

const CHOICE_OPS = Object.freeze([
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
])
const TEXT_OPS = Object.freeze([
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
])

// The Group menu's values on the tab (its grouping code reads `phase` and
// `assignee`) and the config's column keys.
const TAB_GROUP = Object.freeze({ phase_id: 'phase', assignee_id: 'assignee' })
const CONFIG_GROUP = Object.freeze({ phase: 'phase_id', assignee: 'assignee_id' })
/** A config's grouping field as the tab's grouping code names it. */
// Own keys only: a stored "constructor" or "__proto__" maps to itself, then
// reads as no grouping (code review round 2, R2-7).
const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
export function groupToTab(field) { return field ? (own(TAB_GROUP, field) || String(field)) : '' }
/** The tab's grouping value as a config names it. */
export function groupFromTab(value) { return value ? (own(CONFIG_GROUP, value) || String(value)) : '' }

const ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * The description, from what the tab knows now: the item kinds the project
 * uses (`itemKinds`, the columns' rule), its phases and the people the
 * Assignee cell offers, the items' lookup, each kind's live rows in the
 * project's own order (`kindRows`) and the task window's Sort (`itemSort`,
 * for a cell's words).
 */
export function tasksDescription({ itemKinds = ['asset'], phases = [], members = [], lookup = null, kindRows = {}, itemSort = 'type' } = {}) {
  const kinds = ITEM_KINDS.filter(k => itemKinds.includes(k))
  const phaseIndex = new Map(phases.map((p, i) => [String(p.id), i]))
  const phaseName = new Map(phases.map(p => [String(p.id), p.name || 'Untitled']))
  const memberName = new Map(members.map(m => [String(m.id), m.name || m.display_name || 'Unnamed']))
  const columns = tasksTableColumns(kinds)
  const idsOf = (t, kind) => (lookup ? lookup.idsOf(t, kind) : [])
  const cellText = (t, kind) => sortIdsForDisplay(kind, idsOf(t, kind), itemSort, lookup).map(id => lookup?.nameOf(kind, id) || '').join(', ')

  const fields = [
    { key: 'title', label: 'Title', filter: 'text', sortable: true },
    { key: 'status', label: 'Status', filter: 'choice', sortable: true, groupable: true },
    { key: 'priority', label: 'Priority', filter: 'choice', sortable: true, groupable: true },
    ...kinds.map(kind => ({ key: kind, kind, label: KIND_LABEL[kind], filter: 'item', sortable: true, groupable: true })),
    { key: 'phase_id', label: 'Phase', filter: 'choice', sortable: true, groupable: true },
    { key: 'assignee_id', label: 'Assignee', filter: 'choice', sortable: true, groupable: true },
    { key: 'start_date', label: 'Start date', short: 'Start', sortable: true },
    { key: 'end_date', label: 'End date', short: 'End', sortable: true },
    { key: 'bid_days', label: 'Bid days', short: 'Bid', sortable: true },
    // A sort with no column (VW1d step 0, finding 5).
    { key: 'created_at', label: 'Created', sortable: true, column: false },
  ].map(f => Object.freeze({ column: true, ...f }))
  const byKey = new Map(fields.map(f => [f.key, f]))

  function valuesOf(t, key) {
    switch (key) {
      case 'status': return [t.status || 'waiting_to_start']
      case 'priority': return [t.priority || 'medium']
      case 'phase_id': return t.phase_id ? [t.phase_id] : []
      case 'assignee_id': return t.assignee_id ? [t.assignee_id] : []
      case 'title': return t.title ? [t.title] : []
      default:
        if (byKey.get(key)?.kind) return idsOf(t, key)
        return t[key] == null || t[key] === '' ? [] : [t[key]]
    }
  }

  // Each field's order. Status and priority by their lists, Phase by the
  // project's phases, Assignee and the item columns by their words A to Z;
  // the rest as the table always sorted them (a missing value first going
  // up, as the old Sort did).
  function compare(key, a, b) {
    const plain = (x, y) => (x < y ? -1 : x > y ? 1 : 0)
    switch (key) {
      case 'status': return TASK_STATUSES.indexOf(a.status || 'waiting_to_start') - TASK_STATUSES.indexOf(b.status || 'waiting_to_start')
      case 'priority': return PRIORITIES.indexOf(a.priority || 'medium') - PRIORITIES.indexOf(b.priority || 'medium')
      case 'phase_id': {
        const ia = a.phase_id != null && phaseIndex.has(String(a.phase_id)) ? phaseIndex.get(String(a.phase_id)) : Infinity
        const ib = b.phase_id != null && phaseIndex.has(String(b.phase_id)) ? phaseIndex.get(String(b.phase_id)) : Infinity
        return ia === ib ? 0 : ia < ib ? -1 : 1
      }
      case 'assignee_id': return ORDER.compare(memberName.get(String(a.assignee_id)) || '￿', memberName.get(String(b.assignee_id)) || '￿')
      case 'title': return plain(String(a.title || '').toLowerCase(), String(b.title || '').toLowerCase())
      case 'bid_days': {
        const x = Number.isFinite(Number(a.bid_days)) && a.bid_days !== null && a.bid_days !== '' ? Number(a.bid_days) : -Infinity
        const y = Number.isFinite(Number(b.bid_days)) && b.bid_days !== null && b.bid_days !== '' ? Number(b.bid_days) : -Infinity
        return x === y ? 0 : x < y ? -1 : 1
      }
      default:
        if (byKey.get(key)?.kind) return ORDER.compare(cellText(a, key) || '￿', cellText(b, key) || '￿')
        return plain(String(a[key] ?? ''), String(b[key] ?? ''))
    }
  }

  // A choice's or an item's options, for the filter's value picker; a value
  // whose row is gone is not one (the picker names it "No longer in the
  // project").
  function options(key) {
    switch (key) {
      case 'status': return TASK_STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s] }))
      case 'priority': return PRIORITIES.map(p => ({ value: p, label: PRIORITY_LABELS[p] }))
      case 'phase_id': return phases.map(p => ({ value: p.id, label: p.name || 'Untitled' }))
      case 'assignee_id': return members.map(m => ({ value: m.id, label: m.name || m.display_name || 'Unnamed' }))
      default: {
        const kind = byKey.get(key)?.kind
        if (!kind) return []
        const rows = (Array.isArray(kindRows[kind]) ? kindRows[kind] : []).filter(r => r && r.id != null && (!lookup || lookup.isLive(kind, r.id)))
        const named = rows.map(r => ({ value: r.id, label: lookup ? lookup.nameOf(kind, r.id) : (r.name || 'Untitled'), row: r }))
        const count = new Map()
        for (const o of named) count.set(o.label, (count.get(o.label) || 0) + 1)
        return named.map(o => ({ value: o.value, label: o.label, apart: count.get(o.label) > 1 ? apartOf(kind, o.row) : null }))
      }
    }
  }
  function apartOf(kind, row) {
    if (kind === 'asset') return [row.type, phaseName.get(String(row.phase_id))].filter(Boolean).join(' · ') || null
    if (kind === 'scene' && row.scene_number != null) return `Scene ${row.scene_number}`
    if (kind === 'shot' && row.shot_number != null) return `Shot ${row.shot_number}`
    return null
  }

  return Object.freeze({
    tableKey: TASKS_TABLE,
    fields,
    field: (key) => byKey.get(key) || null,
    columns,
    // The fields in their default order (the columns'), the name first and fixed (Q6).
    fieldKeys: columns.map(c => c.key),
    fixed: ['title'],
    // In the old Filter strip's order (a new row starts on Status), the item
    // kinds after Asset.
    filterFields: ['status', 'priority', ...kinds, 'phase_id', 'assignee_id', 'title'].map(k => byKey.get(k)),
    sortFields: fields.filter(f => f.sortable),
    groupFields: fields.filter(f => f.groupable),
    cardFields: CARD_FIELDS.filter(k => byKey.has(k)),
    filterOps: (def) => (def?.filter === 'text' ? TEXT_OPS : CHOICE_OPS),
    valuesOf,
    compare,
    options,
    // Q-I as a rule per field (VW1d step 0, finding 12): in the table off for
    // Status and on for the rest; on the Board off for every field.
    hideEmptyDefault: (layout, field) => (layout === 'board' ? false : field !== 'status'),
  })
}
