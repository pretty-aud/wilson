// ============================================================
// RABBIT — the Assets table's description for the custom views (VW1e,
// 2026-10-25)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §6: the shared piece is given each
// table's description. This is the Assets table's, the Tasks one's twin
// (tasksTableView.js): its fields by their column keys (§5.1), the picture in
// front of the name (her Q-J), the Gallery card's fields (her Q-E, Q-P2), and
// the linked kinds an asset is grouped and filtered by (her Q-M3: "Tasks,
// Assets, Levels, Exp." — Assets by the scenes, shots, levels and experiences
// an asset is in), which are no columns (her Q12: "the other tables get no
// new columns").
//
// The keys: `name` (the fixed name), `type`, `phase_id`, `status`,
// `start_date`, `due_date`, `description`, `tasks` (the count, Q12: "views
// can show or hide the counts"); `created_at`, a sort with no column; the
// kinds `scene`, `shot`, `level`, `experience` (their columns' keys on the
// Tasks table, so a filter means the same everywhere). The leading column is
// `thumbnail`. The old Group menu's `phase` is `phase_id` here, once.

import { statusMeta } from '../../../../ui'
import { KIND_LABEL } from '../../state/taskItemsModel'
import { ASSET_TYPES, assetTypeLabel } from '../../state/assetTypes'
import { CHOICE_OPS, TEXT_OPS, itemKindOptions } from './tasksTableView'
import { combinationOfIds } from './combinationGroups'

export const ASSETS_TABLE = 'assets'

export const ASSET_STATUSES = Object.freeze([
  'not_started', 'in_progress', 'pending_review', 'needs_revisions',
  'approved', 'final', 'blocked', 'on_hold', 'omitted',
])

/** The kinds an asset names, each with the asset's own field (0084, 0099). */
export const ASSET_KINDS = Object.freeze(['scene', 'shot', 'level', 'experience'])
export const ASSET_KIND_FIELD = Object.freeze({
  scene: 'scene_ids', shot: 'shot_ids', level: 'level_ids', experience: 'experience_ids',
})

/** The Gallery card's own lines (finding 6's rule, built for the Gallery): its fields, in its order. */
export const ASSET_CARD_FIELDS = Object.freeze(['status', 'type', 'phase_id', 'tasks'])

/** The columns in front of the name (her Q-J): hideable, never movable. */
export const ASSET_LEADING = Object.freeze([Object.freeze({ key: 'thumbnail', label: 'Picture' })])

/**
 * The table's columns in order, each with what the sheet's widths need
 * (§4.10): `width` its CSS width, `min` what it takes at the least, `grow`
 * whether it shares the spare. The name's own minimum and maximum are the
 * sheet's. Description is the one column that grows (FX8: the name takes up
 * to its maximum, Description the rest).
 */
export function assetsTableColumns() {
  return [
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type', width: 'var(--rb-asset-type)', min: 'var(--rb-asset-type)' },
    { key: 'phase_id', label: 'Phase', width: 'var(--rb-asset-phase)', min: 'var(--rb-asset-phase)' },
    { key: 'status', label: 'Status', width: 'var(--rb-asset-status)', min: 'var(--rb-asset-status)' },
    { key: 'start_date', label: 'Start', width: 'var(--rb-asset-date)', min: 'var(--rb-asset-date)' },
    { key: 'due_date', label: 'Due', width: 'var(--rb-asset-date)', min: 'var(--rb-asset-date)' },
    { key: 'description', label: 'Description', width: 'var(--rb-asset-col-desc)', min: 'var(--rb-asset-desc)', grow: true },
    { key: 'tasks', label: 'Tasks', width: 'var(--rb-asset-tasks)', min: 'var(--rb-asset-tasks)', numeric: true },
  ]
}

/**
 * What the columns on screen ask of the sheet (§4.10, VW1e step 0 finding
 * 8): `fixed` (`--rb-asset-fixed` on `.rb-asset-table-wrap`), the checkbox,
 * the picture while it shows and every column's minimum summed (the name's
 * own minimum and maximum are the sheet's); `grow`, how many growable columns
 * show (Description, or none: then the view says `data-grow="none"` and the
 * table is never wider than the fixed columns and the name's maximum).
 */
export function assetsTableWidths(columns, showThumb = true) {
  const list = Array.isArray(columns) ? columns : []
  const mins = ['var(--rb-asset-check)', ...(showThumb ? ['var(--rb-asset-thumb)'] : []), ...list.filter(c => c && c.min).map(c => c.min)]
  return { fixed: `calc(${mins.join(' + ')})`, grow: list.filter(c => c && c.grow).length }
}

/**
 * The kinds the project's assets can be grouped and filtered by: the asset
 * window's own rule (RelationsPanel's sections) — scenes and shots where the
 * project has scenes turned on, levels and experiences where it has them —
 * or where any asset names a row of that kind (as the Tasks table's columns
 * follow the task window's picker, pickerKinds).
 */
export function assetKindsOf(project, assets = []) {
  const names = (kind) => (Array.isArray(assets) ? assets : []).some(a => Array.isArray(a?.[ASSET_KIND_FIELD[kind]]) && a[ASSET_KIND_FIELD[kind]].length > 0)
  return ASSET_KINDS.filter((kind) => {
    if (kind === 'scene' || kind === 'shot') return !!project?.scenes_enabled || names(kind)
    if (kind === 'level') return !!project?.levels_enabled || names(kind)
    return !!project?.experiences_enabled || names(kind)
  })
}

const ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const STATUS_LABELS = Object.freeze(Object.fromEntries(ASSET_STATUSES.map(s => [s, statusMeta(s).label])))

/**
 * The description, from what the tab knows now: the kinds the project uses
 * (`kinds`), its phases, the items' lookup (buildItemLookup: live rows, the
 * display order, the names), each kind's live rows in the project's own
 * order (`kindRows`), and each asset's task count (`taskCountOf`).
 */
export function assetsDescription({ kinds = [], phases = [], lookup = null, kindRows = {}, taskCountOf = () => 0 } = {}) {
  const usedKinds = ASSET_KINDS.filter(k => kinds.includes(k))
  const phaseIndex = new Map(phases.map((p, i) => [String(p.id), i]))
  const phaseName = new Map(phases.map(p => [String(p.id), p.name || 'Untitled']))
  const columns = assetsTableColumns()
  const idsOf = (a, kind) => (lookup ? combinationOfIds(kind, a?.[ASSET_KIND_FIELD[kind]], lookup).ids : [])

  const fields = [
    { key: 'name', label: 'Name', filter: 'text', sortable: true },
    { key: 'type', label: 'Type', filter: 'choice', sortable: true, groupable: true },
    { key: 'phase_id', label: 'Phase', filter: 'choice', sortable: true, groupable: true },
    { key: 'status', label: 'Status', filter: 'choice', sortable: true, groupable: true },
    { key: 'start_date', label: 'Start date', short: 'Start', sortable: true },
    { key: 'due_date', label: 'Due date', short: 'Due', sortable: true },
    { key: 'description', label: 'Description', filter: 'text' },
    { key: 'tasks', label: 'Tasks', sortable: true },
    { key: 'created_at', label: 'Created', sortable: true, column: false },
    // The kinds: grouped and filtered by, no column (her Q12).
    ...usedKinds.map(kind => ({ key: kind, kind, label: KIND_LABEL[kind], filter: 'item', groupable: true, column: false })),
  ].map(f => Object.freeze({ column: true, ...f }))
  const byKey = new Map(fields.map(f => [f.key, f]))

  function valuesOf(a, key) {
    switch (key) {
      case 'status': return [a.status || 'not_started']
      case 'type': return [a.type || 'other']
      case 'phase_id': return a.phase_id ? [a.phase_id] : []
      case 'name': return a.name ? [a.name] : []
      case 'description': return a.description ? [a.description] : []
      case 'tasks': return [taskCountOf(a)]
      default:
        if (byKey.get(key)?.kind) return idsOf(a, key)
        return a[key] == null || a[key] === '' ? [] : [a[key]]
    }
  }

  // Each field's order: status and type by their lists (the table's own
  // order, as the old Sort read them), the phase by the project's phases, the
  // name case ignored, the count as a number; the rest as text, a missing
  // value first going up (the old Sort's `?? ''`).
  function compare(key, a, b) {
    const plain = (x, y) => (x < y ? -1 : x > y ? 1 : 0)
    switch (key) {
      case 'status': return ASSET_STATUSES.indexOf(a.status || 'not_started') - ASSET_STATUSES.indexOf(b.status || 'not_started')
      case 'type': return ASSET_TYPES.indexOf(a.type || 'other') - ASSET_TYPES.indexOf(b.type || 'other')
      case 'phase_id': {
        const ia = a.phase_id != null && phaseIndex.has(String(a.phase_id)) ? phaseIndex.get(String(a.phase_id)) : Infinity
        const ib = b.phase_id != null && phaseIndex.has(String(b.phase_id)) ? phaseIndex.get(String(b.phase_id)) : Infinity
        return ia === ib ? 0 : ia < ib ? -1 : 1
      }
      case 'name': return plain(String(a.name || '').toLowerCase(), String(b.name || '').toLowerCase())
      case 'tasks': return taskCountOf(a) - taskCountOf(b)
      default: return plain(String(a[key] ?? ''), String(b[key] ?? ''))
    }
  }

  function options(key) {
    switch (key) {
      case 'status': return ASSET_STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s] }))
      case 'type': return ASSET_TYPES.map(t => ({ value: t, label: assetTypeLabel(t) }))
      case 'phase_id': return phases.map(p => ({ value: p.id, label: p.name || 'Untitled' }))
      default: {
        const kind = byKey.get(key)?.kind
        return kind ? itemKindOptions(kind, kindRows[kind], lookup, phaseName) : []
      }
    }
  }

  return Object.freeze({
    tableKey: ASSETS_TABLE,
    fields,
    // A Map's own keys only: a stored "constructor" is no field (VW1d R2-7).
    field: (key) => (typeof key === 'string' && byKey.has(key) ? byKey.get(key) : null),
    columns,
    fieldKeys: columns.map(c => c.key),
    fixed: ['name'],
    leading: ASSET_LEADING,
    leadingKeys: ASSET_LEADING.map(l => l.key),
    // In the old Filter strip's order (a new row starts on Status), the kinds
    // after Phase.
    filterFields: ['status', 'type', 'phase_id', ...usedKinds, 'name', 'description'].map(k => byKey.get(k)),
    sortFields: fields.filter(f => f.sortable),
    groupFields: fields.filter(f => f.groupable),
    cardFields: ASSET_CARD_FIELDS.filter(k => byKey.has(k)),
    kinds: usedKinds,
    filterOps: (def) => (def?.filter === 'text' ? TEXT_OPS : CHOICE_OPS),
    valuesOf,
    compare,
    options,
    // Q-I as a rule per field: on for every field (in tables only the Tasks
    // Status grouping shows its empty groups).
    hideEmptyDefault: () => true,
    // A row's combination of a kind (combinationGroups.js).
    combinationOf: (a, kind) => (lookup ? combinationOfIds(kind, a?.[ASSET_KIND_FIELD[kind]], lookup) : { key: '', ids: [], label: '' }),
  })
}

export { ORDER as ASSET_NAME_ORDER }
