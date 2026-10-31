// ============================================================
// RABBIT — which shot list holds a scene or shot, and which edits use it
// (post-overhaul S3c, step 1)
// ============================================================
//
// D10: every surface but the Scenes tab reads the ACTIVE list, yet a task,
// an asset or a take can be linked to a scene or shot that only ANOTHER list
// holds (D1 + D3: one row, shared by every list that holds it). Audrey's
// brief: "shots, tasks, and assets need to clearly indicate which edit and
// shot version they are assigned to." So wherever a linked scene or shot is
// shown, it says which list holds it and which edits use it. D10 ruled a
// tooltip the floor ("SC001 · Storyboard pass v3"); where there is room the
// label is printed beside the name (LinkHome.jsx): the active list's label
// when the row is in it, else the first list that holds it, and "+N" for
// every other list and edit, each named in the tooltip.
//
// LIVE lists and edits only, as the Scenes tab's own name tooltip counts
// them (S3b): to the people who set a list or an edit aside it is gone, and
// S3a's "Not in any list" agrees.
//
// Pure: rows in, words out (linkHomes.test.js). One index per change of the
// lists, so a table of a hundred rows asks it a hundred times for nothing.
// ============================================================

import { itemsOf, sceneIdSetOf, sortShotLists, formatShotListLabel } from '../../state/shotListModel'

/** "In no shot list": S3b's words for a row no live list holds. */
export const NO_LIST_WORDS = 'In no shot list'

/**
 * The index. Everything it needs is on ctx (useRabbit):
 *   shotLists, shotListItems, shots (every row: ctx.allShots), edits,
 *   activeId (project.active_shot_list_id)
 * → (id) => { lists, edits, primary, more, title(name) }
 *   lists    the live lists holding it — a scene through its own item or one
 *            of its shots' (S3a's rule) — the active one first, the rest in
 *            the lists' one order
 *   edits    the live edits whose items name it, each with its list's label
 *   primary  the label printed beside a name: the active list's when the
 *            row is in it, else the first list's; null in no list
 *   more     how many lists and edits the "+N" stands for
 *   title    the tooltip: the name, then "In: …", then "Edits: …", a line
 *            each
 */
export function homeIndex({ shotLists, shotListItems, shots, edits, activeId }) {
  const live = sortShotLists((shotLists || []).filter(l => !l.archived_at))
  const listById = new Map((shotLists || []).map(l => [l.id, l]))
  const listsOf = new Map()
  const add = (map, id, row) => {
    if (!id) return
    if (!map.has(id)) map.set(id, [])
    const arr = map.get(id)
    if (!arr.includes(row)) arr.push(row)
  }
  for (const list of live) {
    for (const sid of sceneIdSetOf(shotListItems, list.id, shots)) add(listsOf, sid, list)
    for (const it of itemsOf(shotListItems, list.id)) if (it.shot_id) add(listsOf, it.shot_id, list)
  }
  const editsOf = new Map()
  const liveEdits = (edits || [])
    .filter(e => !e.archived_at)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || (Number(a.version) || 0) - (Number(b.version) || 0))
  for (const e of liveEdits) {
    for (const it of Array.isArray(e.items) ? e.items : []) {
      add(editsOf, it?.shot_id, e)
      add(editsOf, it?.scene_id, e)
    }
  }

  return (id) => {
    const held = listsOf.get(id) || []
    const lists = [...held.filter(l => l.id === activeId), ...held.filter(l => l.id !== activeId)]
    const used = (editsOf.get(id) || []).map(e => ({ row: e, listLabel: formatShotListLabel(listById.get(e.shot_list_id)) || '' }))
    const primary = lists.length ? formatShotListLabel(lists[0]) : null
    const more = Math.max(0, lists.length - 1) + used.length
    const title = (name) => [
      name || null,
      lists.length
        ? `In: ${lists.map(l => `${formatShotListLabel(l)}${l.id === activeId ? ' (active)' : ''}`).join(', ')}`
        : NO_LIST_WORDS,
      used.length
        ? `Edits: ${used.map(u => `${formatShotListLabel(u.row)}${u.listLabel ? ` (${u.listLabel})` : ''}`).join(', ')}`
        : null,
    ].filter(Boolean).join('\n')
    return { lists, edits: used.map(u => u.row), primary, more, title }
  }
}

/** The index from a provider context (useRabbit()), or a resolver that knows nothing. */
export function homeIndexOf(ctx) {
  if (!ctx) return () => ({ lists: [], edits: [], primary: null, more: 0, title: (name) => [name || null, NO_LIST_WORDS].filter(Boolean).join('\n') })
  return homeIndex({
    shotLists: ctx.shotLists,
    shotListItems: ctx.shotListItems,
    shots: ctx.allShots || ctx.shots,
    edits: ctx.edits,
    activeId: ctx.project?.active_shot_list_id || null,
  })
}

/**
 * The rows a picker offers (S3c step 1): the ACTIVE list's by default (D10:
 * the list every other tab reads), every row of the project once "Show all
 * lists" is on — and, either way, the row already chosen, so a link to a row
 * only another list holds never reads as empty.
 *   active    ctx.scenes / ctx.shots
 *   all       ctx.allScenes / ctx.allShots
 *   showAll   the switch
 *   keep      ids already linked (a string, an array, or nothing)
 */
export function pickerRows({ active, all, showAll, keep }) {
  if (showAll) return all || []
  const base = active || []
  const want = new Set((Array.isArray(keep) ? keep : [keep]).filter(Boolean))
  const have = new Set(base.map(r => r.id))
  const extra = (all || []).filter(r => want.has(r.id) && !have.has(r.id))
  return extra.length ? [...base, ...extra] : base
}

/** Whether the project has anything a "Show all lists" switch would add. */
export function otherListRows({ active, all }) {
  const have = new Set((active || []).map(r => r.id))
  return (all || []).some(r => !have.has(r.id))
}

// ── Removing a list never removes the Timeline or the Budget ──────────────
//
// Audrey's rule of 2026-10-02 (POST_OVERHAUL_ANSWERS.md): "if a shot list is
// removed. dont delete the budget and timeline. just disconnect the projects
// tasks and phases from be assigned to shots and scenes". Nothing is deleted
// — no task, phase or budget line ever followed a list. On screen, the
// Timeline's group-by-scene and the Budget's By scene, By shot and Custom
// read the ACTIVE list (D10), so a task whose scene or shot is not in it
// (the list cleared, another made active, the row taken out) is NOT dropped:
// it reads as not assigned there (NO_SCENE_GROUP, NO_SHOT_GROUP), and its
// tooltip, like the task popup, says what it points at. Its stored link
// is kept, so it is under its scene again once the scene is back in the
// active list. This replaces step 1's "resolve through sceneById" for those
// two views' GROUPS only (the S3c brief's dated section).

/** The words for a row a task points at that the active list does not hold. */
export const NOT_IN_ACTIVE = 'not in the active list'

/**
 * The not-assigned groups' names on the Timeline and the Budget. They hold
 * two kinds of task — one with no scene (or shot) at all, and one whose
 * scene (or shot) the active list does not hold — and their name must be
 * true of both (the controller's note on Audrey's rule, 2026-10-02): neither
 * has a scene IN THE ACTIVE LIST. "No Scene" alone was not true of the
 * second, whose link is kept.
 */
export const NO_SCENE_GROUP = 'No scene in the active list'
export const NO_SHOT_GROUP = 'No shot in the active list'

/** What LinkHome's tooltip adds for such a row (the task popup). */
export const NOT_IN_ACTIVE_NOTE = 'Not in the active list, so the Timeline and the Budget read its tasks as not assigned to it until it is in the active list again.'

const q = (s) => `“${s}”`

/** The active list's rows as id sets: ctx.scenes / ctx.shots (D10). */
export function activeIdsOf(scenes, shots) {
  return { sceneIds: new Set((scenes || []).map(s => s.id)), shotIds: new Set((shots || []).map(s => s.id)) }
}

/**
 * One link that is not in the active list, in words:
 *   Scene “Cliff path”: in Pickups · v1, not in the active list
 *   Shot “The door”: in no shot list
 *   Scene: no longer in the project      (a link to a row that is gone)
 *   kind    'Scene' | 'Shot'
 *   row     the row (the provider's lookups over every row), or null
 *   homeOf  homeIndex, or null (then no list is named)
 */
export function pointsAt(kind, row, homeOf = null) {
  if (!row) return `${kind}: no longer in the project`
  const lists = (homeOf && homeOf(row.id).lists) || []
  const name = `${kind} ${q(row.name || 'Untitled')}`
  return lists.length
    ? `${name}: in ${lists.map(formatShotListLabel).join(', ')}, ${NOT_IN_ACTIVE}`
    : `${name}: in no shot list`
}

/**
 * Where a task's links stand against the active list.
 *   task     { scene_id, shot_id }
 *   active   activeIdsOf(ctx.scenes, ctx.shots)
 *   sceneById / shotById   the provider's lookups over EVERY row
 *   homeOf   homeIndex (optional)
 * → { sceneId, shotId, outside }
 *   sceneId  its scene when the active list holds it, else null
 *   shotId   its shot when the active list holds it, else null
 *   outside  a line (pointsAt) for each link the active list does not hold
 */
export function linksInActive(task, { active, sceneById = null, shotById = null, homeOf = null }) {
  const sceneId = task?.scene_id && active.sceneIds.has(task.scene_id) ? task.scene_id : null
  const shotId = task?.shot_id && active.shotIds.has(task.shot_id) ? task.shot_id : null
  const outside = []
  if (task?.scene_id && !sceneId) outside.push(pointsAt('Scene', sceneById?.(task.scene_id) || null, homeOf))
  if (task?.shot_id && !shotId) outside.push(pointsAt('Shot', shotById?.(task.shot_id) || null, homeOf))
  return { sceneId, shotId, outside }
}

/** A not-assigned group's tooltip: what its tasks point at, each once; undefined when nothing. */
export function notAssignedTitle(lines) {
  const each = [...new Set(lines)]
  return each.length ? ['Tasks here are linked outside the active list:', ...each].join('\n') : undefined
}
