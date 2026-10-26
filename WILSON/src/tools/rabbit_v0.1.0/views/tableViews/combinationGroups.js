// ============================================================
// RABBIT — combination groups: one rule for every table grouped by a
// linked kind (VW1e, 2026-10-25)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §4.11, her Q-D ("make a group for the
// assets grouped together ... there should be a group called Asset A, Asset
// B, Asset C"), Q-D2 (a grouping made with Create grouping is saved for the
// project) and Q-M3 ("Tasks, Assets, Levels, Exp."): the Tasks table grouped
// by asset, scene, shot, level or experience; Assets by the scenes, shots,
// levels and experiences an asset is in; Levels and Experiences by the assets
// that name them. One group per COMBINATION — the set of a row's live items
// of the kind — so a row sits in exactly one group and the groups' counts add
// up to the rows.
//
// The rule was the Tasks view's own (`itemGroupsOf`, VW1m; VW1b's kinds;
// VW1d's Hide empty groups and the project's groupings). VW1e moves it here
// unchanged, so the four tables read one copy; the Tasks view still calls it
// through its own `itemGroupsOf(kind, tasks, …)`.
//
// Her Q-N4: an item whose row is in the trash or not loaded is not part of a
// row's combination (`lookup.isLive`); a grouping shows only while every item
// it names is live. Her Q-P3 (2026-10-25, "Keep the task's own order"): a
// group's NAME lists its items in the display order (`lookup.orderOf`: by
// name, numbers read as numbers; scenes by number; shots by their scene's,
// then their own) while a Tasks cell follows the task window's Sort.

import { groupingKeyOf } from '../../state/tableViewsModel'
import { NO_KIND_LABEL } from '../../state/taskItemsModel'

// A combination group's names A to Z, numbers read as numbers ("Shot 2"
// before "Shot 10"), case ignored: the order item 2 of VW1m's hand-off gives
// the labels themselves.
const LABEL_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * A row's combination of a kind from the ids it names (an asset's
 * `scene_ids`, the assets naming a level): `{ key, ids, label }` as
 * buildItemLookup's `combinationOf` answers for a task — the live ids only, in
 * the display order, the key their sorted ids joined with '|' ('' for none),
 * the label their names joined with ', '.
 */
export function combinationOfIds(kind, ids, lookup) {
  const live = [...new Set((Array.isArray(ids) ? ids : []).filter(id => id != null && id !== '').map(String))]
    .filter(id => lookup.isLive(kind, id))
    .sort(lookup.orderOf(kind))
  return {
    key: live.slice().sort(byCodeUnit).join('|'),
    ids: live,
    label: live.map(id => lookup.nameOf(kind, id)).join(', '),
  }
}

/**
 * The groups of `rows` grouped by `kind`, ordered as the Tasks table always
 * ordered them: a group for each single item in the project's own order
 * (`singles`, the kind's rows: the active shot list's, for scenes and shots),
 * then the combinations (and a single item `singles` does not hold) by name A
 * to Z, then "No asset" (or "No scene", …) last.
 *
 *   combinationOf(row)  the row's `{ key, ids, label }` of this kind
 *   lookup              isLive(kind, id), nameOf(kind, id), orderOf(kind)
 *   everySingle         a group for every single live item even when empty,
 *                       and "No …" always (the Board's columns, her Q-I; a
 *                       table view's *Hide empty groups* off, §4.3)
 *   saved               the project's groupings of this kind, `{ id, ids }`
 *                       (Q-D2): a grouping whose set rows already have IS
 *                       that group (its `groupingId`: the group's … removes
 *                       it, Q-D5); one no row has shows empty, in the place
 *                       its kind of group takes, while every item it names is
 *                       live — and never hides (VW1d step 0, finding 1)
 *   hideEmpty           drop the empty groups (never a grouping)
 *   as                  the name of each group's list of rows ('rows', or
 *                       'tasks' for the Tasks view)
 *
 * Each group: `{ key, ids, label, [as]: [...], groupingId? }`; `ids` are what
 * a drop or a new row there takes.
 */
export function combinationGroupsOf({
  kind, rows, combinationOf, lookup, singles = [], everySingle = false, saved = [], hideEmpty = false, as = 'rows',
}) {
  const noneLabel = NO_KIND_LABEL[kind] || 'None'
  const byKey = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const c = combinationOf(row)
    const key = c.key === '' ? '__none__' : c.key
    if (!byKey.has(key)) byKey.set(key, { key, ids: c.ids, label: c.label || noneLabel, [as]: [] })
    byKey.get(key)[as].push(row)
  }
  const groupingOf = new Map()
  for (const g of Array.isArray(saved) ? saved : []) {
    const ids = (g.ids || []).filter(id => lookup.isLive(kind, id)).sort(lookup.orderOf(kind))
    if (ids.length === 0) continue
    const key = groupingKeyOf(ids)
    if (!groupingOf.has(key)) groupingOf.set(key, g.id)
    if (!byKey.has(key)) byKey.set(key, { key, ids, label: ids.map(id => lookup.nameOf(kind, id)).join(', '), [as]: [] })
  }
  for (const [key, id] of groupingOf) byKey.get(key).groupingId = id
  const out = []
  const placed = new Set()
  for (const r of Array.isArray(singles) ? singles : []) {
    if (!r || r.id == null || !lookup.isLive(kind, r.id)) continue
    const key = String(r.id)
    if (placed.has(key)) continue
    const g = byKey.get(key)
    if (!g && !everySingle) continue
    out.push(g || { key, ids: [r.id], label: lookup.nameOf(kind, r.id), [as]: [] })
    placed.add(key)
  }
  const rest = [...byKey.values()].filter(g => g.key !== '__none__' && !placed.has(g.key))
  rest.sort((a, b) => LABEL_ORDER.compare(a.label, b.label) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  out.push(...rest)
  if (byKey.has('__none__')) out.push(byKey.get('__none__'))
  else if (everySingle) out.push({ key: '__none__', ids: [], label: noneLabel, [as]: [] })
  return hideEmpty ? out.filter(g => g[as].length > 0 || g.groupingId) : out
}
