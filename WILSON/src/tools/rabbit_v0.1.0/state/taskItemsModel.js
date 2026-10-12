// ============================================================
// RABBIT — a task's items (FX2, migration 0096, 2026-10-11)
// ============================================================
//
// Audrey (2026-10-11): "a task should allow for multiple assets assigned.
// scenes and shots, levels, experiences also. a task may be related to
// multiple items."
//
// A task's ITEMS are rows `{ id, task_id, project_id, entity_type,
// entity_id, position, created_at, created_by }` — entity_type one of the
// five KINDS. Position orders a task's items WITHIN their kind; the first of
// a kind (position, then created_at, then id — 0096's ORDER BY) is the task's
// MAIN item of that kind, and the task's single field of that kind
// (asset_id, scene_id, shot_id, level_id, experience_id) IS that main item.
//
// This file is the ONE statement of the rules, pure, for every backend:
//   * the cloud runs them in SQL (0096 §6, §7), and this file mirrors them so
//     the screen changes before the echo;
//   * the Local Server runs them in electron/rabbitTaskItems.cjs, a CommonJS
//     copy held to this one by taskItemsParity.test.js;
//   * the dev fixtures import this file.
//
// NOT task_links: that is 0000's table of a task's URL links (`taskLinks`).

export const ITEM_KINDS = Object.freeze(['asset', 'scene', 'shot', 'level', 'experience'])

export const KIND_FIELD = Object.freeze({
  asset: 'asset_id',
  scene: 'scene_id',
  shot: 'shot_id',
  level: 'level_id',
  experience: 'experience_id',
})

export const LINK_FIELDS = Object.freeze(ITEM_KINDS.map(k => KIND_FIELD[k]))

export const FIELD_KIND = Object.freeze(
  Object.fromEntries(ITEM_KINDS.map(k => [KIND_FIELD[k], k])),
)

// The cloud keeps three of the five as columns on `tasks` (0000, 0084); a
// level's and an experience's only cloud home is task_items.
export const COLUMN_KINDS = Object.freeze(['asset', 'scene', 'shot'])

// The words a screen uses for a kind, singular and plural.
export const KIND_LABEL = Object.freeze({
  asset: 'Asset', scene: 'Scene', shot: 'Shot', level: 'Level', experience: 'Experience',
})
export const KIND_LABEL_PLURAL = Object.freeze({
  asset: 'Assets', scene: 'Scenes', shot: 'Shots', level: 'Levels', experience: 'Experiences',
})

export function isItemKind(kind) {
  return ITEM_KINDS.includes(kind)
}

// Milliseconds since the epoch, with the database's microseconds kept as a
// fraction (review round 2, R2-7): Postgres orders created_at to the
// microsecond and Date.parse stops at the millisecond, so two items made in
// one millisecond were ordered by id here and by time there.
function timeOf(v) {
  if (v == null || v === '') return 0
  const t = Date.parse(v)
  if (!Number.isFinite(t)) return 0
  const m = /\.(\d{4,})/.exec(String(v))
  return m ? t + Number(m[1].slice(3, 6).padEnd(3, '0')) / 1000 : t
}

/** 0096's order: position, then created_at, then id. */
export function compareItems(a, b) {
  const pa = Number(a?.position) || 0
  const pb = Number(b?.position) || 0
  if (pa !== pb) return pa - pb
  const ta = timeOf(a?.created_at)
  const tb = timeOf(b?.created_at)
  if (ta !== tb) return ta - tb
  const ia = String(a?.id ?? '')
  const ib = String(b?.id ?? '')
  return ia < ib ? -1 : ia > ib ? 1 : 0
}

/**
 * A task's items, kinds in ITEM_KINDS order and each kind in 0096's order.
 * With `kind`, that kind's only.
 */
export function itemsOfTask(items, taskId, kind = null) {
  if (!Array.isArray(items) || taskId == null) return []
  const id = String(taskId)
  const mine = items.filter(i => i && String(i.task_id) === id && (kind == null || i.entity_type === kind))
  return mine.sort((a, b) => {
    if (a.entity_type !== b.entity_type) {
      return ITEM_KINDS.indexOf(a.entity_type) - ITEM_KINDS.indexOf(b.entity_type)
    }
    return compareItems(a, b)
  })
}

/** Every item grouped by its task: Map(taskId → items, each kind sorted). */
export function indexItemsByTask(items) {
  const byTask = new Map()
  for (const i of Array.isArray(items) ? items : []) {
    if (!i || i.task_id == null) continue
    const k = String(i.task_id)
    if (!byTask.has(k)) byTask.set(k, [])
    byTask.get(k).push(i)
  }
  for (const list of byTask.values()) {
    list.sort((a, b) => (a.entity_type !== b.entity_type
      ? ITEM_KINDS.indexOf(a.entity_type) - ITEM_KINDS.indexOf(b.entity_type)
      : compareItems(a, b)))
  }
  return byTask
}

/** The task's main item of a kind (the row), or null. */
export function mainItemOf(items, taskId, kind) {
  return itemsOfTask(items, taskId, kind)[0] || null
}

/** The five single fields a task's items say: each kind's main entity id, or null. */
export function linkFieldsFromItems(taskItems) {
  const out = {}
  for (const kind of ITEM_KINDS) out[KIND_FIELD[kind]] = null
  const sorted = (Array.isArray(taskItems) ? taskItems.slice() : []).sort(compareItems)
  for (const i of sorted) {
    const f = KIND_FIELD[i?.entity_type]
    if (f && out[f] == null) out[f] = i.entity_id
  }
  return out
}

/**
 * The tasks with their five single fields read from their items — what every
 * screen reads (`ctx.tasks`). A task whose fields already agree comes back as
 * the same object, so a memo keyed on it holds. When the backend has no items
 * (`available` false: a cloud without 0096, Google Drive), the stored fields
 * are the truth and the tasks come back untouched.
 */
export function withItemLinks(tasks, items, available = true) {
  if (!Array.isArray(tasks)) return []
  if (!available) return tasks
  const byTask = indexItemsByTask(items)
  let changed = false
  const out = tasks.map(t => {
    if (!t) return t
    const fields = linkFieldsFromItems(byTask.get(String(t.id)))
    let same = true
    for (const f of LINK_FIELDS) {
      if ((t[f] ?? null) !== fields[f]) { same = false; break }
    }
    if (same) return t
    changed = true
    return { ...t, ...fields }
  })
  return changed ? out : tasks
}

/**
 * Review round 2 (R2-1): the ids of the tasks whose items differ between two
 * lists — a row added, removed or replaced (rows are never changed in
 * place). The provider re-reads only these tasks' single links from their
 * items; every other task row keeps the links it came with (the backend's,
 * kept in step by 0096 and its twins), so a task the backend brought back
 * before this bundle read its items keeps its links.
 */
export function tasksWithChangedItems(prevItems, nextItems) {
  const out = new Set()
  if (prevItems === nextItems) return out
  const before = new Map()
  for (const i of Array.isArray(prevItems) ? prevItems : []) if (i && i.id != null) before.set(String(i.id), i)
  const seen = new Set()
  for (const i of Array.isArray(nextItems) ? nextItems : []) {
    if (!i || i.id == null) continue
    const id = String(i.id)
    seen.add(id)
    const was = before.get(id)
    if (was === i) continue
    if (i.task_id != null) out.add(String(i.task_id))
    if (was && was.task_id != null) out.add(String(was.task_id))
  }
  for (const [id, was] of before) if (!seen.has(id) && was && was.task_id != null) out.add(String(was.task_id))
  return out
}

/**
 * The named tasks with their five single links read from their items (null
 * for a kind a task has no item of); every other task as it is. The same
 * array when nothing differs.
 */
export function withItemLinksFor(tasks, items, taskIds) {
  if (!Array.isArray(tasks) || !taskIds || taskIds.size === 0) return tasks
  const byTask = indexItemsByTask(items)
  let changed = false
  const out = tasks.map(t => {
    if (!t || !taskIds.has(String(t.id))) return t
    const fields = linkFieldsFromItems(byTask.get(String(t.id)))
    for (const f of LINK_FIELDS) {
      if ((t[f] ?? null) !== fields[f]) { changed = true; return { ...t, ...fields } }
    }
    return t
  })
  return changed ? out : tasks
}

/**
 * The provider's every bundle write, where the backend keeps items: the
 * tasks whose items the write changed read their links from them.
 */
export function linksInStep(prev, next, itemsOn) {
  if (!itemsOn || !next || !Array.isArray(next.tasks)) return next
  const touched = tasksWithChangedItems(prev?.taskItems, next.taskItems)
  if (touched.size === 0) return next
  const tasks = withItemLinksFor(next.tasks, next.taskItems || [], touched)
  return tasks === next.tasks ? next : { ...next, tasks }
}

/**
 * Review round 2 (R2-3): the entity a single-field write (0096 §7b) leaves
 * as the task's main item of a kind — the value itself when one is given;
 * when the field is cleared, the item after the main one (the main goes), or
 * none.
 */
export function mainAfterLinkWrite(items, taskId, kind, value) {
  if (value != null && value !== '') return value
  const mine = itemsOfTask(items, taskId, kind)
  return mine.length > 1 ? mine[1].entity_id : null
}

/**
 * The tasks ABOUT one item — the relation lists and per-row counts (the
 * scene, shot, level, experience and asset windows; the tables' task
 * counts): every task that names it, main or not. Without items, the single
 * field decides, as before 0096.
 */
export function tasksAbout(tasks, items, kind, entityId, available = true) {
  if (!Array.isArray(tasks) || entityId == null || !isItemKind(kind)) return []
  const id = String(entityId)
  if (!available) {
    const f = KIND_FIELD[kind]
    return tasks.filter(t => t && t[f] != null && String(t[f]) === id)
  }
  const taskIds = new Set()
  for (const i of Array.isArray(items) ? items : []) {
    if (i && i.entity_type === kind && String(i.entity_id) === id) taskIds.add(String(i.task_id))
  }
  return tasks.filter(t => t && taskIds.has(String(t.id)))
}

/** Count of tasks about each entity of a kind: { entityId: n } (a task counts once per entity). */
export function taskCountsByEntity(tasks, items, kind, available = true) {
  const out = {}
  if (!Array.isArray(tasks) || !isItemKind(kind)) return out
  if (!available) {
    const f = KIND_FIELD[kind]
    for (const t of tasks) {
      if (!t || t[f] == null) continue
      out[t[f]] = (out[t[f]] || 0) + 1
    }
    return out
  }
  const live = new Set(tasks.filter(Boolean).map(t => String(t.id)))
  const seen = new Set()
  for (const i of Array.isArray(items) ? items : []) {
    if (!i || i.entity_type !== kind || !live.has(String(i.task_id))) continue
    const key = `${i.task_id}|${i.entity_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out[i.entity_id] = (out[i.entity_id] || 0) + 1
  }
  return out
}

/** The position a new item of a kind takes on a task: after the last. */
export function nextPosition(items, taskId, kind) {
  let max = -1
  for (const i of itemsOfTask(items, taskId, kind)) {
    const p = Number(i.position) || 0
    if (p > max) max = p
  }
  // Never past the cloud's INTEGER (review round 2, R2-7): at the ceiling a
  // new item ties there and sorts after by its later created_at.
  return Math.min(max + 1, MAX_ITEM_POSITION)
}

/**
 * reorder_task_items (0096 §6): the named ids first, in the order given;
 * every other item of that kind after, in its current order; positions dense
 * from 0. An id of another task or kind is ignored. Returns the changes,
 * `[{ id, position }]`, for the rows whose position moves.
 */
export function planReorder(items, taskId, kind, orderedIds) {
  const mine = itemsOfTask(items, taskId, kind)
  const named = new Map()
  ;(Array.isArray(orderedIds) ? orderedIds : []).forEach((id, n) => {
    if (id != null && !named.has(String(id))) named.set(String(id), n)
  })
  const ranked = mine.slice().sort((a, b) => {
    const na = named.has(String(a.id)) ? named.get(String(a.id)) : null
    const nb = named.has(String(b.id)) ? named.get(String(b.id)) : null
    if (na != null && nb != null) return na - nb
    if (na != null) return -1
    if (nb != null) return 1
    return compareItems(a, b)
  })
  const changes = []
  ranked.forEach((row, n) => {
    if ((Number(row.position) || 0) !== n) changes.push({ id: row.id, position: n })
  })
  return changes
}

/** The items with `changes` (`[{ id, position }]`) applied. */
export function applyPositions(items, changes) {
  if (!Array.isArray(changes) || changes.length === 0) return items
  const pos = new Map(changes.map(c => [String(c.id), c.position]))
  return items.map(i => (i && pos.has(String(i.id)) ? { ...i, position: pos.get(String(i.id)) } : i))
}

/**
 * 0096 §7b for one kind: what writing the task's single field of `kind` to
 * `value` does to its items, where `previous` is the value the writer is
 * replacing (the main item, normally).
 *   * value === the main item         → nothing;
 *   * value null                      → the item for `previous` goes (the
 *                                       next one becomes main);
 *   * value another item of the task  → it moves first, nothing removed;
 *   * value not an item of the task   → it replaces `previous`'s item, first.
 * Returns `{ remove: [item], insert: item | null, order: [id] | null }`;
 * `order`, when set, is the kind's full new order (feed it to planReorder).
 * `make()` builds the inserted row (the caller's id and stamps).
 */
export function planSingleFieldWrite(items, taskId, kind, value, previous, make) {
  const none = { remove: [], insert: null, order: null }
  if (!isItemKind(kind) || taskId == null) return none
  const mine = itemsOfTask(items, taskId, kind)
  const main = mine[0] || null
  const want = value == null || value === '' ? null : String(value)
  const prev = previous == null || previous === '' ? null : String(previous)
  if (want == null) {
    if (prev == null) return none
    return { remove: mine.filter(i => String(i.entity_id) === prev), insert: null, order: null }
  }
  if (main && String(main.entity_id) === want) return none
  const existing = mine.find(i => String(i.entity_id) === want)
  if (existing) {
    return { remove: [], insert: null, order: [existing.id, ...mine.filter(i => i !== existing).map(i => i.id)] }
  }
  const remove = prev == null ? [] : mine.filter(i => String(i.entity_id) === prev)
  const inserted = make({ task_id: taskId, entity_type: kind, entity_id: value, position: 0 })
  const rest = mine.filter(i => !remove.includes(i))
  return { remove, insert: inserted, order: [inserted.id, ...rest.map(i => i.id)] }
}

/**
 * The items a task's own single fields call for and do not have (0096 §7c and
 * §8): one per set field, at position 0, unless the task already has that
 * item. `fields` limits the kinds read (the cloud's three, or all five).
 */
export function seedItemsFor(task, items, make, fields = LINK_FIELDS) {
  if (!task || task.id == null) return []
  const out = []
  for (const f of fields) {
    const kind = FIELD_KIND[f]
    const v = task[f]
    if (!kind || v == null || v === '') continue
    const has = (Array.isArray(items) ? items : []).some(i => i
      && String(i.task_id) === String(task.id) && i.entity_type === kind && String(i.entity_id) === String(v))
    if (!has) out.push(make({ task_id: task.id, entity_type: kind, entity_id: v, position: 0 }))
  }
  return out
}

/** The single-link fields a patch writes (present keys only). */
export function linkFieldsIn(patch) {
  const out = {}
  if (!patch || typeof patch !== 'object') return out
  for (const f of LINK_FIELDS) if (Object.prototype.hasOwnProperty.call(patch, f)) out[f] = patch[f]
  return out
}

/** The patch without its single-link fields. */
export function withoutLinkFields(patch) {
  if (!patch || typeof patch !== 'object') return patch
  const out = { ...patch }
  for (const f of LINK_FIELDS) delete out[f]
  return out
}

/** A refusal's words when an item cannot be what it says. Null when it can. */
// FX2 review round 1 (R1-4): ids are strings (an array or an object passed
// the old `!= null` test and was stored as sent, then compared through
// String()); a position fits the cloud's INTEGER; created_at, when sent, is
// a date. The Local Server's route reads the same rule (rabbitTaskItems.cjs).
export const MAX_ITEM_POSITION = 2147483647
const isIdString = (v) => typeof v === 'string' && v.trim() !== ''
export function itemShapeProblem(row) {
  if (!row || typeof row !== 'object') return 'an item needs a task, a kind and an entity'
  if (row.task_id == null || row.task_id === '') return 'an item needs its task'
  if (!isIdString(row.task_id)) return 'an item\'s task is named by its id, as text'
  if (!isItemKind(row.entity_type)) return `${row.entity_type} is not a kind of item (asset, scene, shot, level, experience)`
  if (row.entity_id == null || row.entity_id === '') return 'an item needs the asset, scene, shot, level or experience it names'
  if (!isIdString(row.entity_id)) return 'an item names its asset, scene, shot, level or experience by its id, as text'
  if (row.id != null && !isIdString(row.id)) return 'an item\'s own id is text'
  const p = row.position == null ? 0 : Number(row.position)
  if (!Number.isInteger(p) || p < 0 || p > MAX_ITEM_POSITION) return 'an item\'s position is a whole number from 0 to 2147483647'
  if (row.created_at != null && (typeof row.created_at !== 'string' || Number.isNaN(Date.parse(row.created_at)))) {
    return 'an item\'s created_at is a date'
  }
  return null
}
