// ============================================================
// RABBIT — the Levels and Experiences tables' description for the custom
// views (VW1e, 2026-10-25)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §6: the shared piece is given each
// table's description. EntityListView renders Levels and Experiences from
// one `entity` config (B4c); so does this: one description, keyed by the
// entity's table (`levels` / `experiences`), the Tasks one's twin
// (tasksTableView.js).
//
// The keys: `name` (the fixed name), `status`, `assets` and `tasks` (the
// counts, her Q12: "views can show or hide the counts"), `description`;
// `created_at`, a sort with no column; `asset`, the kind a level or an
// experience is grouped and filtered by (her Q-M3: "Levels and Experiences
// by asset"), which has no column (Q12: no new columns). A level's assets
// are the assets whose `level_ids` (an experience's, `experience_ids`) name
// it: the link lives on the ASSETS (VW1e step 0, finding 3), on the cloud
// since 0099. No leading column.

import { statusMeta } from '../../../../ui'
import { KIND_LABEL } from '../../state/taskItemsModel'
import { CHOICE_OPS, TEXT_OPS, itemKindOptions } from './tasksTableView'
import { combinationOfIds } from './combinationGroups'

const ENTITY_STATUSES = Object.freeze([
  'not_started', 'in_progress', 'pending_review', 'needs_revisions',
  'approved', 'final', 'blocked', 'on_hold', 'omitted',
])
const STATUS_LABELS = Object.freeze(Object.fromEntries(ENTITY_STATUSES.map(s => [s, statusMeta(s).label])))

/** The Gallery card's own lines (finding 6's rule, built for the Gallery). */
const ENTITY_CARD_FIELDS = Object.freeze(['status', 'description'])

/**
 * The table's columns in order, each with what the sheet's widths need
 * (§4.10): the name takes the rest up to its maximum (360px), Description
 * the spare past it (FX8) — the one growable column.
 */
export function entityTableColumns() {
  return [
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Status', width: 'var(--rb-ent-status)', min: 'var(--rb-ent-status)' },
    { key: 'assets', label: 'Assets', width: 'var(--rb-ent-assets)', min: 'var(--rb-ent-assets)', numeric: true },
    { key: 'tasks', label: 'Tasks', width: 'var(--rb-ent-tasks)', min: 'var(--rb-ent-tasks)', numeric: true },
    { key: 'description', label: 'Description', width: 'var(--rb-ent-desc)', min: 'var(--rb-ent-text-min)', grow: true },
  ]
}

/** The columns on screen's fixed sum (`--rb-ent-fixed`) and how many grow (§4.10). */
export function entityTableWidths(columns) {
  const list = Array.isArray(columns) ? columns : []
  const mins = ['var(--rb-ent-check)', ...list.filter(c => c && c.min).map(c => c.min)]
  return { fixed: `calc(${mins.join(' + ')})`, grow: list.filter(c => c && c.grow).length }
}

/**
 * Each row's assets: the live assets whose `assetsKey` ('level_ids' /
 * 'experience_ids') names it, by row id. An asset names a row once.
 */
export function assetsByEntity(assets, assetsKey) {
  const map = new Map()
  for (const a of Array.isArray(assets) ? assets : []) {
    const ids = Array.isArray(a?.[assetsKey]) ? a[assetsKey] : []
    for (const id of new Set(ids.filter(x => x != null && x !== '').map(String))) {
      if (!map.has(id)) map.set(id, [])
      map.get(id).push(a.id)
    }
  }
  return map
}

/**
 * The description: `tableKey` ('levels' / 'experiences'), the assets and
 * the lookup (buildItemLookup: what is live, the names, the display order),
 * the assets by row (assetsByEntity), and each row's task count.
 */
export function entityDescription({ tableKey, assets = [], lookup = null, assetsOf = new Map(), taskCountOf = () => 0 } = {}) {
  const columns = entityTableColumns()
  const idsOf = (row) => assetsOf.get(String(row?.id)) || []
  const combination = (row) => (lookup ? combinationOfIds('asset', idsOf(row), lookup) : { key: '', ids: [], label: '' })
  const assetCount = (row) => combination(row).ids.length

  const fields = [
    { key: 'name', label: 'Name', filter: 'text', sortable: true },
    { key: 'status', label: 'Status', filter: 'choice', sortable: true, groupable: true },
    { key: 'assets', label: 'Assets', sortable: true },
    { key: 'tasks', label: 'Tasks', sortable: true },
    { key: 'description', label: 'Description', filter: 'text' },
    { key: 'created_at', label: 'Created', sortable: true, column: false },
    // The kind: grouped and filtered by, no column (her Q12, Q-M3).
    { key: 'asset', kind: 'asset', label: KIND_LABEL.asset, filter: 'item', groupable: true, column: false },
  ].map(f => Object.freeze({ column: true, ...f }))
  const byKey = new Map(fields.map(f => [f.key, f]))

  function valuesOf(row, key) {
    switch (key) {
      case 'status': return [row.status || 'not_started']
      case 'name': return row.name ? [row.name] : []
      case 'description': return row.description ? [row.description] : []
      case 'assets': return [assetCount(row)]
      case 'tasks': return [taskCountOf(row)]
      case 'asset': return combination(row).ids
      default: return row[key] == null || row[key] === '' ? [] : [row[key]]
    }
  }

  // Status by its list, the name case ignored (as the old Sort read them),
  // the counts as numbers; the rest as text, a missing value first going up.
  function compare(key, a, b) {
    const plain = (x, y) => (x < y ? -1 : x > y ? 1 : 0)
    switch (key) {
      case 'status': return ENTITY_STATUSES.indexOf(a.status || 'not_started') - ENTITY_STATUSES.indexOf(b.status || 'not_started')
      case 'name': return plain(String(a.name || '').toLowerCase(), String(b.name || '').toLowerCase())
      case 'assets': return assetCount(a) - assetCount(b)
      case 'tasks': return taskCountOf(a) - taskCountOf(b)
      default: return plain(String(a[key] ?? ''), String(b[key] ?? ''))
    }
  }

  function options(key) {
    if (key === 'status') return ENTITY_STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s] }))
    if (key === 'asset') return itemKindOptions('asset', assets, lookup)
    return []
  }

  return Object.freeze({
    tableKey,
    fields,
    field: (key) => (typeof key === 'string' && byKey.has(key) ? byKey.get(key) : null),
    columns,
    fieldKeys: columns.map(c => c.key),
    fixed: ['name'],
    leading: [],
    leadingKeys: [],
    // In the old Filter strip's order (a new row starts on Status).
    filterFields: ['status', 'asset', 'name', 'description'].map(k => byKey.get(k)),
    sortFields: fields.filter(f => f.sortable),
    groupFields: fields.filter(f => f.groupable),
    cardFields: ENTITY_CARD_FIELDS.filter(k => byKey.has(k)),
    kinds: ['asset'],
    filterOps: (def) => (def?.filter === 'text' ? TEXT_OPS : CHOICE_OPS),
    valuesOf,
    compare,
    options,
    // Q-I: on for every field (in tables only the Tasks Status grouping
    // shows its empty groups).
    hideEmptyDefault: () => true,
    combinationOf: (row) => combination(row),
    assetIdsOf: idsOf,
  })
}
