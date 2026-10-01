// shotListModel.js — the pure half of shot lists and edits (post-overhaul S3a).
//
// No React, no adapters, no I/O: plain rows in, plain rows out. The provider
// (RabbitProvider.jsx) wraps these as ctx selectors and uses the plan* helpers
// to compute the item set a mutator writes; S3b and S3c call the selectors.
//
// THE MODEL (Audrey's rulings, docs/design/POST_OVERHAUL_PLAN.md §0.1):
//   * D1 + D3 — a shot list is MEMBERSHIP, not copies. A scene or shot row is
//     shared by every list that contains it: its name, description, notes,
//     status and thumbnail are the same everywhere. Only membership and order
//     are per list (shotListItems rows: { shot_list_id, scene_id | shot_id,
//     position }).
//   * Positions: scene items order a list's scenes; shot items order the shots
//     WITHIN their scene (restarting at 0 per scene, and for the "Unlinked
//     shots" bucket). The same rule as migration 0084's backfill.
//   * D10 — every surface except the Scenes tab reads the ACTIVE list
//     (project.active_shot_list_id). No active list => every scene and shot
//     (the pre-0084 behaviour), so nothing disappears on a project that has
//     no list yet.
//   * D14 — a list is title + integer version, unique per project, shown
//     "Title · v3".
//
// The ordering helpers MUST stay identical to 0084's backfill ORDER BY and to
// electron/rabbitShotLists.cjs; shotListModel.test.js pins all three together.

export const SHOT_LIST_BACKFILL_TITLE = 'Shot list 1'
export const SHOT_LIST_BACKFILL_SUMMARY = 'Created from existing scenes'

// ── ordering ────────────────────────────────────────────────────────────────

function cmpNullsLast(a, b) {
  const an = a === null || a === undefined || a === ''
  const bn = b === null || b === undefined || b === ''
  if (an && bn) return 0
  if (an) return 1
  if (bn) return -1
  const x = Number(a)
  const y = Number(b)
  if (x < y) return -1
  if (x > y) return 1
  return 0
}

function cmpText(a, b) {
  const x = a == null ? '' : String(a)
  const y = b == null ? '' : String(b)
  if (x < y) return -1
  if (x > y) return 1
  return 0
}

/** scene_number (nulls last), then sort_order, created_at, id — 0084's ORDER BY. */
export function compareScenesForList(a, b) {
  return cmpNullsLast(a?.scene_number, b?.scene_number)
    || cmpNullsLast(a?.sort_order, b?.sort_order)
    || cmpText(a?.created_at, b?.created_at)
    || cmpText(a?.id, b?.id)
}

/** shot_number (nulls last), then sort_order, created_at, id — 0084's ORDER BY. */
export function compareShotsForList(a, b) {
  return cmpNullsLast(a?.shot_number, b?.shot_number)
    || cmpNullsLast(a?.sort_order, b?.sort_order)
    || cmpText(a?.created_at, b?.created_at)
    || cmpText(a?.id, b?.id)
}

/** Lists for display: title (natural order), then version ascending. */
function compareShotLists(a, b) {
  const t = String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { numeric: true, sensitivity: 'base' })
  return t || (Number(a?.version) || 0) - (Number(b?.version) || 0) || cmpText(a?.id, b?.id)
}

export function sortShotLists(lists) {
  return [...(lists || [])].sort(compareShotLists)
}

/** "Title · v3" (D14). */
export function formatShotListLabel(list) {
  if (!list) return ''
  return `${list.title || 'Untitled'} · v${Number(list.version) || 1}`
}

// ── the backfill (D11) ──────────────────────────────────────────────────────

/**
 * The membership 0084's backfill writes for one project: every scene
 * (position = scene order) and every shot (position = shot order within its
 * scene; unlinked shots form their own bucket). Returns rows WITHOUT ids or
 * list ids — { scene_id, shot_id, position } — so callers stamp their own.
 */
export function backfillItems(scenes, shots) {
  const out = []
  const orderedScenes = [...(scenes || [])].sort(compareScenesForList)
  orderedScenes.forEach((s, i) => out.push({ scene_id: s.id, shot_id: null, position: i }))
  const groups = new Map()
  for (const sh of shots || []) {
    const key = sh.scene_id || null
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(sh)
  }
  // Emit shot groups in scene order, then the unlinked bucket, so the output is
  // deterministic for tests; positions restart per group either way.
  const sceneOrder = new Map(orderedScenes.map((s, i) => [s.id, i]))
  const rank = (k) => (k === null ? Number.MAX_SAFE_INTEGER
    : (sceneOrder.has(k) ? sceneOrder.get(k) : Number.MAX_SAFE_INTEGER - 1))
  const keys = [...groups.keys()].sort((a, b) => (rank(a) - rank(b)) || cmpText(a, b))
  for (const k of keys) {
    groups.get(k).sort(compareShotsForList).forEach((sh, i) => out.push({ scene_id: null, shot_id: sh.id, position: i }))
  }
  return out
}

// ── selectors ───────────────────────────────────────────────────────────────

export function itemsOf(items, listId) {
  if (!listId) return []
  return (items || []).filter(i => i.shot_list_id === listId)
}

/** The project's active list row, or null (no pointer, or the list is not loaded). */
export function activeShotListOf(project, shotLists) {
  const id = project?.active_shot_list_id
  if (!id) return null
  return (shotLists || []).find(l => l.id === id) || null
}

/**
 * Scene ids a list shows: its scene items, PLUS the scene of every shot item
 * whose scene has no item of its own (an "implied" scene — a shot moved into a
 * scene the list does not name would otherwise render under no heading).
 */
export function sceneIdSetOf(items, listId, shots) {
  const own = itemsOf(items, listId)
  const set = new Set(own.filter(i => i.scene_id).map(i => i.scene_id))
  const shotById = shots ? new Map(shots.map(s => [s.id, s])) : null
  if (shotById) {
    for (const i of own) {
      if (!i.shot_id) continue
      const sc = shotById.get(i.shot_id)?.scene_id
      if (sc) set.add(sc)
    }
  }
  return set
}

function shotIdSetOf(items, listId) {
  return new Set(itemsOf(items, listId).filter(i => i.shot_id).map(i => i.shot_id))
}

/** A list's scenes in LIST order (item position; implied scenes after, by number). */
export function scenesOfList(scenes, items, listId, shots) {
  if (!listId) return []
  const own = itemsOf(items, listId)
  const pos = new Map(own.filter(i => i.scene_id).map(i => [i.scene_id, i.position ?? 0]))
  const ids = sceneIdSetOf(items, listId, shots)
  return (scenes || [])
    .filter(s => ids.has(s.id))
    .sort((a, b) => {
      const pa = pos.has(a.id) ? pos.get(a.id) : Infinity
      const pb = pos.has(b.id) ? pos.get(b.id) : Infinity
      if (pa !== pb) return pa < pb ? -1 : 1
      return compareScenesForList(a, b)
    })
}

/** A list's shots in LIST order: by their scene's list order (unlinked last), then shot position. */
export function shotsOfList(shots, items, listId, scenes) {
  if (!listId) return []
  const own = itemsOf(items, listId)
  const shotPos = new Map(own.filter(i => i.shot_id).map(i => [i.shot_id, i.position ?? 0]))
  const orderedScenes = scenesOfList(scenes || [], items, listId, shots)
  const sceneRank = new Map(orderedScenes.map((s, i) => [s.id, i]))
  return (shots || [])
    .filter(s => shotPos.has(s.id))
    .sort((a, b) => {
      const ra = a.scene_id && sceneRank.has(a.scene_id) ? sceneRank.get(a.scene_id) : Infinity
      const rb = b.scene_id && sceneRank.has(b.scene_id) ? sceneRank.get(b.scene_id) : Infinity
      if (ra !== rb) return ra < rb ? -1 : 1
      const pa = shotPos.get(a.id)
      const pb = shotPos.get(b.id)
      if (pa !== pb) return pa < pb ? -1 : 1
      return compareShotsForList(a, b)
    })
}

/** Scene ids that belong to SOME list (explicitly, or implied by one of their shots). */
function listedSceneIds(shotListItems, shots) {
  const set = new Set()
  const shotById = new Map((shots || []).map(s => [s.id, s]))
  for (const i of shotListItems || []) {
    if (i.scene_id) set.add(i.scene_id)
    else if (i.shot_id) {
      const sc = shotById.get(i.shot_id)?.scene_id
      if (sc) set.add(sc)
    }
  }
  return set
}

function listedShotIds(shotListItems) {
  return new Set((shotListItems || []).filter(i => i.shot_id).map(i => i.shot_id))
}

/**
 * ctx.scenes (D10, as Audrey ruled it): the ACTIVE list's scenes, in the order
 * they were LOADED (every existing view sorts by number itself, so the order
 * it receives is unchanged); every scene when the project has no active list
 * (or names one this client has not loaded — the provider re-reads the lists).
 *
 * A scene in NO list is NOT shown here. Round 1 showed such rows everywhere to
 * keep accidents visible; round 2 measured that it also undid every DELIBERATE
 * removal from a project's only list (D10 says the other surfaces read the
 * active list, full stop). Accidents are now prevented where they start — a
 * new row whose membership write fails is removed again and the error raised
 * (RabbitProvider addScene / addShot) — and any row that still ends up in no
 * list stays reachable through unlistedScenesOf / unlistedShotsOf, for S3b's
 * Scenes tab. Whether a row in no list should show elsewhere is recorded in
 * the S3a hand-off as a question for Audrey.
 */
export function activeScenesOf({ project, shotLists, shotListItems, scenes, shots }) {
  const active = activeShotListOf(project, shotLists)
  if (!active) return scenes || []
  const ids = sceneIdSetOf(shotListItems, active.id, shots)
  return (scenes || []).filter(s => ids.has(s.id))
}

/** ctx.shots (D10): the ACTIVE list's shots, load order; every shot when there is no active list. */
export function activeShotsOf({ project, shotLists, shotListItems, shots }) {
  const active = activeShotListOf(project, shotLists)
  if (!active) return shots || []
  const ids = shotIdSetOf(shotListItems, active.id)
  return (shots || []).filter(s => ids.has(s.id))
}

/** Scenes that belong to no list (S3b's "not in any list" bucket in the Scenes tab). */
export function unlistedScenesOf({ shotListItems, scenes, shots }) {
  const listed = listedSceneIds(shotListItems, shots)
  return (scenes || []).filter(s => !listed.has(s.id))
}

/** Shots that belong to no list. */
export function unlistedShotsOf({ shotListItems, shots }) {
  const listed = listedShotIds(shotListItems)
  return (shots || []).filter(s => !listed.has(s.id))
}

/**
 * Every list that contains this scene or shot id (for D10's tooltip), sorted
 * for display. A scene is contained by a list that names it OR one of its shots.
 */
export function listsContainingOf({ shotLists, shotListItems, shots }, id) {
  if (!id) return []
  const out = []
  for (const list of shotLists || []) {
    const own = itemsOf(shotListItems, list.id)
    if (own.some(i => i.shot_id === id || i.scene_id === id)) { out.push(list); continue }
    if (sceneIdSetOf(shotListItems, list.id, shots).has(id)) out.push(list)
  }
  return sortShotLists(out)
}

/** Next free version for a title in this project (D14): max + 1, or 1. */
export function nextShotListVersion(shotLists, title) {
  const t = String(title || '').trim()
  let max = 0
  for (const l of shotLists || []) {
    if (String(l.title || '').trim() === t) max = Math.max(max, Number(l.version) || 0)
  }
  return max + 1
}

/** A list's edits, oldest first (the linear chain). */
export function editsOfList(edits, listId) {
  return (edits || [])
    .filter(e => e.shot_list_id === listId)
    .sort((a, b) => cmpText(a.created_at, b.created_at) || (Number(a.version) || 0) - (Number(b.version) || 0) || cmpText(a.id, b.id))
}

/**
 * D6: a list's edits form ONE linear chain. The tip is the edit no other edit
 * names as its parent — where the next edit continues. null for a list with
 * no edits. (With the database's one-root / one-child indexes there is exactly
 * one; if data ever disagrees, the newest childless edit wins.)
 */
export function editChainTip(edits, listId) {
  const own = (edits || []).filter(e => e.shot_list_id === listId)
  if (!own.length) return null
  const parents = new Set(own.map(e => e.parent_edit_id).filter(Boolean))
  const tips = own.filter(e => !parents.has(e.id))
  const pool = tips.length ? tips : own
  return pool.sort((a, b) => cmpText(b.created_at, a.created_at) || (Number(b.version) || 0) - (Number(a.version) || 0) || cmpText(b.id, a.id))[0]
}

export function nextEditVersion(edits, listId, title) {
  const t = String(title || '').trim()
  let max = 0
  for (const e of edits || []) {
    if (e.shot_list_id === listId && String(e.title || '').trim() === t) max = Math.max(max, Number(e.version) || 0)
  }
  return max + 1
}

// ── validation (the provider refuses BEFORE any optimistic write; the
//    database and the Local Server route refuse the same things) ────────────

export function validateVersionedTitle({ title, version }, noun = 'shot list') {
  const article = /^[aeiou]/i.test(noun) ? 'An' : 'A'
  if (typeof title !== 'string' || !title.trim()) {
    throw new Error(`${article} ${noun} needs a title.`)
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`${article} ${noun}'s version must be a whole number of at least 1.`)
  }
}

export function assertUniqueShotList(shotLists, { id, title, version }) {
  const t = String(title || '').trim()
  const clash = (shotLists || []).find(l => l.id !== id && String(l.title || '').trim() === t && Number(l.version) === Number(version))
  if (clash) throw new Error(`There is already a shot list called "${formatShotListLabel(clash)}".`)
}

export function assertUniqueEdit(edits, { id, shot_list_id, title, version }) {
  const t = String(title || '').trim()
  const clash = (edits || []).find(e => e.id !== id && e.shot_list_id === shot_list_id
    && String(e.title || '').trim() === t && Number(e.version) === Number(version))
  if (clash) throw new Error(`This shot list already has an edit called "${formatShotListLabel(clash)}".`)
}

// ── plans: each returns the NEW full item set of ONE list ───────────────────
//
// The provider writes only what a plan ADDS (adapter.upsertShotListItems),
// REMOVES (adapter.deleteShotListItems) or MOVES (adapter.repositionShotListItems,
// positions only) — never a whole list from its own possibly-stale view — and
// undoes each with the inverse on the same rows.

function nextPos(list) {
  let max = -1
  for (const i of list) max = Math.max(max, Number(i.position) || 0)
  return max + 1
}

/**
 * Add scenes and/or shots to a list. Adding a shot whose scene the list does
 * not hold adds the scene too (so the shot renders under its heading). Ids
 * already in the list are skipped. New items go to the end of their group.
 * Returns { next, added }.
 */
export function planAddToList({ items, listId, projectId, shots, sceneIds = [], shotIds = [], newId }) {
  const next = itemsOf(items, listId).map(i => ({ ...i }))
  const added = []
  const shotById = new Map((shots || []).map(s => [s.id, s]))
  const hasScene = (id) => next.some(i => i.scene_id === id)
  const hasShot = (id) => next.some(i => i.shot_id === id)
  const push = (row) => { next.push(row); added.push(row) }
  const addScene = (id) => {
    if (!id || hasScene(id)) return
    push({ id: newId(), shot_list_id: listId, project_id: projectId, scene_id: id, shot_id: null,
      position: nextPos(next.filter(i => i.scene_id)) })
  }
  for (const id of sceneIds) addScene(id)
  for (const id of shotIds) {
    if (!id || hasShot(id)) continue
    const sceneId = shotById.get(id)?.scene_id || null
    if (sceneId) addScene(sceneId)
    const group = next.filter(i => i.shot_id && (shotById.get(i.shot_id)?.scene_id || null) === sceneId)
    push({ id: newId(), shot_list_id: listId, project_id: projectId, scene_id: null, shot_id: id,
      position: nextPos(group) })
  }
  return { next, added }
}

/**
 * Remove scenes and/or shots from a list. Removing a scene removes the list's
 * items for every shot of that scene as well (a heading with no scene would
 * otherwise come back as an "implied" scene). Returns { next, removed }.
 */
export function planRemoveFromList({ items, listId, shots, sceneIds = [], shotIds = [] }) {
  const current = itemsOf(items, listId)
  const scenesOut = new Set(sceneIds.filter(Boolean))
  const shotsOut = new Set(shotIds.filter(Boolean))
  for (const sh of shots || []) if (sh.scene_id && scenesOut.has(sh.scene_id)) shotsOut.add(sh.id)
  const next = []
  const removed = []
  for (const i of current) {
    if ((i.scene_id && scenesOut.has(i.scene_id)) || (i.shot_id && shotsOut.has(i.shot_id))) removed.push(i)
    else next.push({ ...i })
  }
  return { next, removed }
}

/**
 * Reorder ONE group of a list: its scenes, or the shots of one scene (or of
 * the unlinked bucket). `orderedIds` are item ids, scene ids or shot ids; the
 * named items take positions 0..n-1 in that order and the rest of the group
 * keep their relative order after them. Mixing scenes and shots, or shots of
 * two scenes, throws. Returns { next }.
 */
export function planReorderList({ items, listId, shots, orderedIds }) {
  const current = itemsOf(items, listId).map(i => ({ ...i }))
  const shotById = new Map((shots || []).map(s => [s.id, s]))
  const resolve = (id) => current.find(i => i.id === id) || current.find(i => i.scene_id === id) || current.find(i => i.shot_id === id)
  const named = []
  for (const id of orderedIds || []) {
    const it = resolve(id)
    if (!it) throw new Error('That scene or shot is not in this shot list.')
    if (!named.includes(it)) named.push(it)
  }
  if (!named.length) return { next: current, changed: [] }
  const kind = named[0].scene_id ? 'scene' : 'shot'
  const groupOf = (i) => (i.scene_id ? 'scene' : `shot:${shotById.get(i.shot_id)?.scene_id || ''}`)
  const group = groupOf(named[0])
  if (named.some(i => groupOf(i) !== group)) {
    throw new Error(kind === 'scene'
      ? 'Scenes and shots are reordered separately.'
      : 'Shots are reordered within one scene at a time.')
  }
  const rest = current
    .filter(i => groupOf(i) === group && !named.includes(i))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const before = new Map(current.map(i => [i.id, i.position]))
  ;[...named, ...rest].forEach((i, n) => { i.position = n })
  const changed = current.filter(i => before.get(i.id) !== i.position)
  return { next: current, changed }
}

/** Copy one list's membership into another (D3: the SAME scene and shot rows, new item ids). */
export function planCopyList({ items, fromListId, toListId, projectId, newId }) {
  return itemsOf(items, fromListId).map(i => ({
    id: newId(), shot_list_id: toListId, project_id: projectId,
    scene_id: i.scene_id || null, shot_id: i.shot_id || null, position: i.position ?? 0,
  }))
}

/** Membership for "a list of everything" — the backfill set, for a named list. */
export function planAllScenesAndShots({ scenes, shots, listId, projectId, newId }) {
  return backfillItems(scenes, shots).map(i => ({ id: newId(), shot_list_id: listId, project_id: projectId, ...i }))
}

// ── snapshots (D5: "Save" records a version point) ──────────────────────────

const SNAPSHOT_SCENE_FIELDS = Object.freeze([
  'id', 'name', 'scene_number', 'description', 'notes', 'status', 'type',
  'time_of_day', 'thumbnail_image', 'start_date', 'end_date',
])
const SNAPSHOT_SHOT_FIELDS = Object.freeze([
  'id', 'scene_id', 'name', 'shot_number', 'description', 'notes', 'status', 'type',
  'time_of_day', 'framing', 'camera_movement', 'frame_count', 'thumbnail_image',
  'start_date', 'end_date',
])

function pick(row, fields) {
  const out = {}
  for (const f of fields) out[f] = row?.[f] ?? null
  return out
}

/**
 * The snapshot "Save" writes to shot_lists.snapshot: the list's scenes, shots
 * and membership as they are now (the rows are shared and keep changing, D3).
 */
export function buildShotListSnapshot({ list, scenes, shots, items, savedAt, savedBy = null }) {
  const own = itemsOf(items, list.id)
  return {
    kind: 'shot_list',
    saved_at: savedAt,
    saved_by: savedBy,
    title: list.title,
    version: list.version,
    scenes: scenesOfList(scenes, items, list.id, shots).map(s => pick(s, SNAPSHOT_SCENE_FIELDS)),
    shots: shotsOfList(shots, items, list.id, scenes).map(s => pick(s, SNAPSHOT_SHOT_FIELDS)),
    items: own
      .map(i => ({ scene_id: i.scene_id || null, shot_id: i.shot_id || null, position: i.position ?? 0 }))
      .sort((a, b) => cmpText(a.scene_id ? 'a' : 'b', b.scene_id ? 'a' : 'b') || a.position - b.position || cmpText(a.scene_id || a.shot_id, b.scene_id || b.shot_id)),
  }
}

// ── edits (D6) ──────────────────────────────────────────────────────────────

/** One edit item: { id, scene_id, shot_id, label, notes }. Unknown keys are dropped. */
function normalizeEditItem(it, newId) {
  return {
    id: it?.id || newId(),
    scene_id: it?.scene_id || null,
    shot_id: it?.shot_id || null,
    label: it?.label == null ? '' : String(it.label),
    notes: it?.notes == null ? '' : String(it.notes),
  }
}

export function normalizeEditItems(items, newId) {
  if (!Array.isArray(items)) throw new Error('An edit\'s items must be a list.')
  return items.map(it => normalizeEditItem(it, newId))
}

/**
 * The "string-out" of a list: its shots in scene order, one item each, labelled
 * with the shot's name. An edit may start from this or from nothing (S3c).
 */
export function editItemsFromList({ scenes, shots, items, listId, newId }) {
  return shotsOfList(shots, items, listId, scenes).map(sh => ({
    id: newId(), scene_id: sh.scene_id || null, shot_id: sh.id, label: sh.name || '', notes: '',
  }))
}

/**
 * The snapshot "Save" writes to edits.snapshot: the name and number of every
 * shot and scene the items reference, AS THEY WERE — so a later-deleted shot
 * can still be shown as "Missing shot: <old name>" (D17).
 */
export function buildEditSnapshot({ items, shots, scenes, savedAt, savedBy = null }) {
  const shotById = new Map((shots || []).map(s => [s.id, s]))
  const sceneById = new Map((scenes || []).map(s => [s.id, s]))
  const shotRefs = {}
  const sceneRefs = {}
  for (const it of items || []) {
    const sh = it.shot_id ? shotById.get(it.shot_id) : null
    if (sh) shotRefs[sh.id] = { name: sh.name ?? null, shot_number: sh.shot_number ?? null, scene_id: sh.scene_id ?? null }
    const scId = it.scene_id || sh?.scene_id
    const sc = scId ? sceneById.get(scId) : null
    if (sc) sceneRefs[sc.id] = { name: sc.name ?? null, scene_number: sc.scene_number ?? null }
  }
  return { kind: 'edit', saved_at: savedAt, saved_by: savedBy, item_count: (items || []).length, shots: shotRefs, scenes: sceneRefs }
}
