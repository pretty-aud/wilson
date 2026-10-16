// ============================================================
// RABBIT — a task's items (FX2, migration 0096, 2026-10-11; VW1m, 2026-10-16)
// ============================================================
//
// Audrey (2026-10-11): "a task should allow for multiple assets assigned.
// scenes and shots, levels, experiences also. a task may be related to
// multiple items."
//
// VW1m (2026-10-16, her batch 12 and 13 rulings in
// docs/design/CUSTOM_VIEWS_QUESTIONS.md): a task's items are its items. No
// item of a kind counts for more than another, on any screen, in any sum, in
// any delete. The contract every part is built to is item 2 of
// docs/sessions/handoffs/po-vw1m-2026-10-16.md.
//
// A task's ITEMS are rows `{ id, task_id, project_id, entity_type,
// entity_id, position, created_at, created_by }` — entity_type one of the
// five KINDS. Their STORED ORDER (position, then created_at, then id —
// 0096's ORDER BY, compareItems) means only the order they were added: it
// decides the *Date added* sort and the older apps' copy, nothing else.
//
// THE OLDER APPS' COPY: each task's single fields (asset_id, scene_id,
// shot_id, level_id, experience_id) hold the first item of their kind in the
// stored order (copyFieldsFromItems), for builds that still read and write
// one field. The backends write it (0097 §7a, the desktop's syncTaskFields,
// the fixtures' column sync); this app never reads it for meaning where items
// are kept. An older app's write of one field ADDS that item and never
// removes another, except the one a cleared field named (planLegacyFieldWrite).
//
// LIVE items (her Q-N4, 2026-10-16): those whose row the project shows. An
// item whose row is in the trash, or not loaded, is hidden from the task's
// window, the Timeline, the groups and the Budget's split, and shows again
// when its row comes back. buildItemLookup is the screens' one reading path.
//
// This file is the ONE statement of the rules, pure, for every backend:
//   * the cloud runs them in SQL (0096 §6, 0097 §7), and this file mirrors
//     them so the screen changes before the echo;
//   * the Local Server runs the backends' half in electron/rabbitTaskItems.cjs,
//     a CommonJS copy held to this one by taskItemsParity.test.js;
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

// VW1m (2026-10-16): the empty combination's words, a group's or a row's
// name when a task has no live item of the kind.
export const NO_KIND_LABEL = Object.freeze({
  asset: 'No asset', scene: 'No scene', shot: 'No shot', level: 'No level', experience: 'No experience',
})

// VW1m (2026-10-16), her Q-N1: "allow user to sort select order by date of
// creation/upload, alphabetical, type". The task window's Sort menu; *Type*
// is where it starts (batch 14's interim, until Q-N1a and Q-N1b are asked).
export const ITEM_SORTS = Object.freeze(['type', 'name', 'date'])
export const ITEM_SORT_LABEL = Object.freeze({ type: 'Type', name: 'A to Z', date: 'Date added' })

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

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** 0096's order: position, then created_at, then id (the stored order). */
export function compareItems(a, b) {
  const pa = Number(a?.position) || 0
  const pb = Number(b?.position) || 0
  if (pa !== pb) return pa - pb
  const ta = timeOf(a?.created_at)
  const tb = timeOf(b?.created_at)
  if (ta !== tb) return ta - tb
  return byCodeUnit(String(a?.id ?? ''), String(b?.id ?? ''))
}

/**
 * A task's items, kinds in ITEM_KINDS order and each kind in the stored
 * order. With `kind`, that kind's only.
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

/**
 * VW1m (2026-10-16): the older apps' copy a task's items say — each kind's
 * first item in the stored order, or null. Only the backends write it
 * (FX2's linkFieldsFromItems, renamed: it decides nothing on screen).
 */
export function copyFieldsFromItems(taskItems) {
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
 * The tasks ABOUT one item — the relation lists and per-row counts (the
 * scene, shot, level, experience and asset windows; the tables' task
 * counts): every task that names it. Without items, the single field
 * decides, as before 0096.
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

// VW1m review round 1 (R1-8): reorder_task_items (0096 section 6), an older
// app's reorder, is answered by the backends only: the desktop's route runs
// the twin's own planReorder / applyPositions (electron/rabbitTaskItems.cjs).
// This app has no Move buttons (her Q-N1), so the model states neither.

const idOrNull = (v) => (v == null || v === '' ? null : String(v))

/**
 * VW1m (2026-10-16), 0097 §7b for one kind: what an older app's write of the
 * task's single field of `kind` does to its items, where `previous` is the
 * value the field held before the write. ADD-ONLY, and nothing ever moves:
 *   * the same value                  → nothing;
 *   * cleared                         → the item for `previous` goes (only it);
 *   * a value the task already has    → nothing;
 *   * a new value                     → inserted at the end (nextPosition).
 * Returns `{ remove: [item], insert: item | null }`. `make(base)` builds the
 * inserted row (the caller's id and stamps).
 */
export function planLegacyFieldWrite(items, taskId, kind, value, previous, make) {
  const none = { remove: [], insert: null }
  if (!isItemKind(kind) || taskId == null) return none
  const mine = itemsOfTask(items, taskId, kind)
  const want = idOrNull(value)
  const prev = idOrNull(previous)
  if (want == null) {
    if (prev == null) return none
    return { remove: mine.filter(i => String(i.entity_id) === prev), insert: null }
  }
  if (want === prev) return none
  if (mine.some(i => String(i.entity_id) === want)) return none
  return {
    remove: [],
    insert: make({ task_id: taskId, entity_type: kind, entity_id: value, position: nextPosition(items, taskId, kind) }),
  }
}

/**
 * VW1m (2026-10-16): make a task's items of `kind` exactly `wantIds` — a drop
 * on a group or a Timeline row (the row's items become the task's, her Q-D1),
 * a bid version's open. The others go; the missing are inserted at the end in
 * the order given; the ones it keeps never move. Returns
 * `{ remove: [item], insert: [item] }`.
 */
export function planSetKind(items, taskId, kind, wantIds, make) {
  const none = { remove: [], insert: [] }
  if (!isItemKind(kind) || taskId == null) return none
  const mine = itemsOfTask(items, taskId, kind)
  const want = []
  const seen = new Set()
  for (const id of Array.isArray(wantIds) ? wantIds : []) {
    const k = idOrNull(id)
    if (k == null || seen.has(k)) continue
    seen.add(k)
    want.push(id)
  }
  const have = new Set(mine.map(i => String(i.entity_id)))
  const remove = mine.filter(i => !seen.has(String(i.entity_id)))
  let position = nextPosition(items, taskId, kind)
  const insert = []
  for (const id of want) {
    if (have.has(String(id))) continue
    insert.push(make({ task_id: taskId, entity_type: kind, entity_id: id, position }))
    position = Math.min(position + 1, MAX_ITEM_POSITION)
  }
  return { remove, insert }
}

/**
 * The items a task's own single fields call for and do not have (0096 §7c and
 * §8): one per set field, at position 0, unless the task already has that
 * item. `fields` limits the kinds read (the cloud's three, or all five). A
 * pre-FX2 row's fields become its items once; a new task from an older app
 * or a template likewise.
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

// ── The screens' half (VW1m, 2026-10-16; ESM only) ──────────────────────────

// Names A to Z, numbers read as numbers ("Shot 2" before "Shot 10"), case and
// accents ignored (item 2's display order).
const NAME_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// A scene's or shot's number, or null; a missing number sorts last (0084's
// NULLS LAST).
function numberOf(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function byNumber(a, b) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}

/**
 * VW1m (2026-10-16): the one way a screen reads a task's items.
 *
 * `items` and `available` are ctx.taskItems and ctx.taskItemsAvailable; the
 * row lists are what the project shows (scenes: ctx.allScenes || ctx.scenes;
 * shots: ctx.allShots || ctx.shots). Answers:
 *   * idsOf(task, kind)         the task's LIVE item ids of a kind, in the
 *                               display order. Where the backend keeps no
 *                               items (`available` false: a cloud before
 *                               0096, the test doubles), the task's own single
 *                               field is its one item, still only when live;
 *   * combinationOf(task, kind) `{ key, ids, label }`: the key is the sorted
 *                               ids joined with '|' ('' for none), the ids in
 *                               the display order, the label their names
 *                               joined with ', ' ('' for none: the screen says
 *                               NO_KIND_LABEL[kind]);
 *   * nameOf(kind, id)          a row's words (a shot is "Scene › Shot", as
 *                               the task window names it), null when the row
 *                               is not shown;
 *   * isLive(kind, id)          the row is in the list given for its kind;
 *   * orderOf(kind)             the display order, a comparator over ids:
 *                               assets, levels and experiences by name A to Z;
 *                               scenes by number, then name; shots by their
 *                               scene's number, then their own, then name;
 *                               rows not shown last; ties by id.
 */
export function buildItemLookup({ items, available = true, assets, scenes, shots, levels, experiences } = {}) {
  const lists = { asset: assets, scene: scenes, shot: shots, level: levels, experience: experiences }
  const rowsOf = {}
  for (const kind of ITEM_KINDS) {
    const m = new Map()
    for (const r of Array.isArray(lists[kind]) ? lists[kind] : []) if (r && r.id != null) m.set(String(r.id), r)
    rowsOf[kind] = m
  }
  const rowOf = (kind, id) => (id == null || !rowsOf[kind] ? null : rowsOf[kind].get(String(id)) || null)
  const isLive = (kind, id) => rowOf(kind, id) != null

  const nameOf = (kind, id) => {
    const row = rowOf(kind, id)
    if (!row) return null
    if (kind === 'shot') {
      const scene = row.scene_id != null ? rowOf('scene', row.scene_id) : null
      return `${scene ? `${scene.name || 'Untitled scene'} › ` : ''}${row.name || 'Untitled shot'}`
    }
    return row.name || `Untitled ${kind}`
  }

  const sceneNumber = (sceneId) => numberOf(rowOf('scene', sceneId)?.scene_number)
  const orders = new Map()
  const orderOf = (kind) => {
    if (orders.has(kind)) return orders.get(kind)
    const byName = (a, b) => NAME_ORDER.compare(nameOf(kind, a) || '', nameOf(kind, b) || '')
    let own = byName
    if (kind === 'scene') {
      own = (a, b) => byNumber(sceneNumber(a), sceneNumber(b)) || byName(a, b)
    } else if (kind === 'shot') {
      own = (a, b) => {
        const sa = rowOf('shot', a)
        const sb = rowOf('shot', b)
        return byNumber(sceneNumber(sa?.scene_id), sceneNumber(sb?.scene_id))
          || byNumber(numberOf(sa?.shot_number), numberOf(sb?.shot_number))
          || byName(a, b)
      }
    }
    const cmp = (a, b) => {
      const la = isLive(kind, a)
      const lb = isLive(kind, b)
      if (la !== lb) return la ? -1 : 1
      return (la ? own(a, b) : 0) || byCodeUnit(String(a), String(b))
    }
    orders.set(kind, cmp)
    return cmp
  }

  // Each task's entity ids by kind, once (a task named twice keeps one).
  const byTask = new Map()
  if (available) {
    for (const i of Array.isArray(items) ? items : []) {
      if (!i || i.task_id == null || !isItemKind(i.entity_type) || i.entity_id == null || i.entity_id === '') continue
      const k = String(i.task_id)
      let kinds = byTask.get(k)
      if (!kinds) { kinds = {}; byTask.set(k, kinds) }
      const list = kinds[i.entity_type] || (kinds[i.entity_type] = [])
      if (!list.some(e => String(e) === String(i.entity_id))) list.push(i.entity_id)
    }
  }

  const idsOf = (task, kind) => {
    if (!task || task.id == null || !isItemKind(kind)) return []
    let ids
    if (available) {
      ids = byTask.get(String(task.id))?.[kind] || []
    } else {
      const v = task[KIND_FIELD[kind]]
      ids = v == null || v === '' ? [] : [v]
    }
    return ids.filter(id => isLive(kind, id)).sort(orderOf(kind))
  }

  const combinationOf = (task, kind) => {
    const ids = idsOf(task, kind)
    return {
      key: ids.map(String).sort(byCodeUnit).join('|'),
      ids,
      label: ids.map(id => nameOf(kind, id)).join(', '),
    }
  }

  return Object.freeze({ idsOf, combinationOf, nameOf, isLive, orderOf })
}

/**
 * VW1m (2026-10-16), her Q-N1: a task's item rows in the window's chosen
 * order (ITEM_SORTS; anything else reads as *Type*). The caller keeps only
 * the live rows (lookup.isLive); this only orders.
 *   * type  kinds in ITEM_KINDS order, each in the display order;
 *   * name  one list by name A to Z, ties by kind, then the display order;
 *   * date  one list by when each was added (created_at), each kind keeping
 *           its stored order: the kinds' stored orders merged by time, ties
 *           by kind. Positions are a kind's own, so they alone cannot order
 *           one list across kinds; with every time equal this is the stored
 *           order itemsOfTask reads.
 * Returns a new array.
 */
export function sortItemsForDisplay(items, sort, lookup) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean)
  const kindIndex = (i) => {
    const n = ITEM_KINDS.indexOf(i.entity_type)
    return n < 0 ? ITEM_KINDS.length : n
  }
  const inKind = (a, b) => (lookup && isItemKind(a.entity_type) ? lookup.orderOf(a.entity_type)(a.entity_id, b.entity_id) : 0)
    || compareItems(a, b)
  if (sort === 'date') {
    const lanes = new Map()
    for (const i of list) {
      const k = kindIndex(i)
      if (!lanes.has(k)) lanes.set(k, [])
      lanes.get(k).push(i)
    }
    const heads = [...lanes.keys()].sort((a, b) => a - b).map(k => lanes.get(k).sort(compareItems))
    const out = []
    for (;;) {
      let pick = -1
      for (let n = 0; n < heads.length; n++) {
        if (!heads[n].length) continue
        if (pick < 0 || timeOf(heads[n][0].created_at) < timeOf(heads[pick][0].created_at)) pick = n
      }
      if (pick < 0) return out
      out.push(heads[pick].shift())
    }
  }
  if (sort === 'name') {
    const nameOf = (i) => (lookup ? lookup.nameOf(i.entity_type, i.entity_id) : null)
    return list.slice().sort((a, b) => {
      const na = nameOf(a)
      const nb = nameOf(b)
      if ((na == null) !== (nb == null)) return na == null ? 1 : -1
      return (na == null ? 0 : NAME_ORDER.compare(na, nb)) || (kindIndex(a) - kindIndex(b)) || inKind(a, b)
    })
  }
  return list.slice().sort((a, b) => (kindIndex(a) - kindIndex(b)) || inKind(a, b))
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
