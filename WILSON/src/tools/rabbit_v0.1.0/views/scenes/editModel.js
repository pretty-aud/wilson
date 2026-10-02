// ============================================================
// RABBIT — an edit on screen, and the changes a draft makes to it
// (post-overhaul S3c, steps 3, 4 and 6)
// ============================================================
//
// D6: an edit is an ordered list of ITEMS — { id, scene_id, shot_id, label,
// notes } — referencing shot ids, in a cut order: a shot may repeat and
// keeps its name; "entirely new shots" are real shot rows on the list. Audrey:
// "after things are rendered or shot, the name of the shot/scene will not
// change in an edit but the order can change and shots/scenes can be
// repeated, removed, or could now include entirely new shots/scenes."
//
// An item's `scene_id` is the scene BLOCK it sits in. A shot moved into
// another scene's block (D16: "move between scenes") joins that block; its
// own name — and its own scene, on its own row — never change. The blocks
// are the runs of consecutive items in one scene ("the scene bands
// following the cut", S3c brief step 3): a scene can come back later in the
// cut as a second band.
//
// D17: a shot deleted from the project stays in the edit as "Missing shot:
// <last-known name>" and counts for nothing; undoing the delete brings it
// back. The name is the edit's saved snapshot's, else the item's label (the
// shot's name when the item was made, refreshed when the draft is saved).
//
// Pure: items in, items out (editModel.test.js). Every change returns a NEW
// array; nothing here writes.
// ============================================================

import { editChainTip, nextEditVersion } from '../../state/shotListModel'

export const MISSING_SHOT = 'Missing shot'

/**
 * The cut, resolved: one row per item, in order.
 *   items      the edit's (or the draft's) items
 *   shotById / sceneById   the provider's lookups over every row
 *   snapshot   the edit's saved snapshot ({ shots: { [id]: { name } }, scenes }), if any
 * → [{ item, index, shot, scene, missing, name, frames }]
 */
export function cutRows({ items, shotById, sceneById, snapshot = null }) {
  return (items || []).map((item, index) => {
    const shot = item?.shot_id ? (shotById?.(item.shot_id) || null) : null
    const missing = !!item?.shot_id && !shot
    const scene = item?.scene_id ? (sceneById?.(item.scene_id) || null) : null
    const lastName = snapshot?.shots?.[item?.shot_id]?.name || item?.label || ''
    return {
      item,
      index,
      shot,
      scene,
      missing,
      name: shot ? (shot.name || 'Untitled shot') : `${MISSING_SHOT}: ${lastName || 'no name'}`,
      frames: shot ? (Number(shot.frame_count) || 0) : 0,
    }
  })
}

/**
 * The scene bands, following the cut: one per run of consecutive rows in
 * the same scene block.
 * → [{ key, sceneId, scene, label, start, end, rows }]  (start/end: item indexes, inclusive)
 */
export function cutBands(rows, { snapshot = null } = {}) {
  const out = []
  for (const row of rows || []) {
    const sceneId = row.item?.scene_id || null
    const last = out[out.length - 1]
    if (last && last.sceneId === sceneId) {
      last.rows.push(row)
      last.end = row.index
      continue
    }
    const scene = row.scene
    const frozen = sceneId ? snapshot?.scenes?.[sceneId]?.name : null
    out.push({
      key: `band-${row.index}`,
      sceneId,
      scene,
      label: scene ? (scene.name || 'Untitled scene')
        : sceneId ? (frozen ? `Missing scene: ${frozen}` : 'Missing scene') : 'Shots without a scene',
      start: row.index,
      end: row.index,
      rows: [row],
    })
  }
  return out
}

/**
 * D20: an edit's four tiles total its items IN ORDER — a repeated shot
 * counts each time, a missing shot not at all. `scenes` counts the scenes
 * the cut shows (a scene in two bands is one scene).
 */
export function cutTotals(rows) {
  let frames = 0
  let shots = 0
  const scenes = new Set()
  for (const r of rows || []) {
    if (!r.shot) continue
    frames += r.frames
    shots += 1
    if (r.item?.scene_id) scenes.add(r.item.scene_id)
  }
  return { frames, shots, scenes: scenes.size }
}

/**
 * D13 + D14: what a new draft is called — the same title as the chain's
 * latest edit, or the list's title when it has none, at the next version
 * of that title on this list. The chain is linear (D6): whichever edit is on
 * screen, the draft saves as the chain's next edit.
 */
export function draftName({ edits, list }) {
  const listId = list?.id
  const tip = editChainTip(edits || [], listId)
  const title = String(tip?.title || list?.title || 'Edit').trim()
  return { title, version: nextEditVersion(edits || [], listId, title) }
}

/** The list's string-out as edit items, with shot names as labels (S3a's editItemsFromList). */
export function labelled(items, shotById) {
  return (items || []).map(it => {
    const shot = it.shot_id ? shotById?.(it.shot_id) : null
    return shot ? { ...it, label: shot.name || it.label || '' } : it
  })
}

// ── the draft's changes (D16) ───────────────────────────────────────────────

const indexOfItem = (items, id) => (items || []).findIndex(i => i.id === id)

/** The band (run of one scene block) an item index sits in: { start, end, sceneId }. */
export function bandAt(items, index) {
  if (index < 0 || index >= (items || []).length) return null
  const sceneId = items[index].scene_id || null
  let start = index
  let end = index
  while (start > 0 && (items[start - 1].scene_id || null) === sceneId) start -= 1
  while (end < items.length - 1 && (items[end + 1].scene_id || null) === sceneId) end += 1
  return { start, end, sceneId }
}

/**
 * Move one item before or after another; it joins the block it lands in
 * (the target's scene). A move onto itself changes nothing (null).
 */
export function moveItemTo(items, itemId, targetId, where = 'before') {
  if (itemId === targetId) return null
  const from = indexOfItem(items, itemId)
  if (from < 0 || indexOfItem(items, targetId) < 0) return null
  const moving = items[from]
  const rest = items.filter((_, i) => i !== from)
  const at = rest.findIndex(i => i.id === targetId)
  const target = rest[at]
  const placed = { ...moving, scene_id: target.scene_id || null }
  const next = [...rest]
  next.splice(where === 'after' ? at + 1 : at, 0, placed)
  return sameOrder(items, next) ? null : next
}

/**
 * Move a whole band (the run of items from `start` to `end`) before or after
 * another band (identified by any item index inside it). Its items keep
 * their scene.
 */
export function moveBandTo(items, start, end, targetIndex, where = 'before') {
  if (targetIndex >= start && targetIndex <= end) return null
  const target = bandAt(items, targetIndex)
  if (!target) return null
  const run = items.slice(start, end + 1)
  const rest = [...items.slice(0, start), ...items.slice(end + 1)]
  const targetId = items[where === 'after' ? target.end : target.start].id
  const at = rest.findIndex(i => i.id === targetId)
  const next = [...rest]
  next.splice(where === 'after' ? at + 1 : at, 0, ...run)
  return sameOrder(items, next) ? null : next
}

/**
 * Move up / Move down (the keyboard path, D16). Inside a band an item swaps
 * with its neighbour; at a band's edge it crosses into the neighbouring
 * band, taking that band's scene, without changing its place in the cut.
 * null at the cut's ends.
 */
export function stepItem(items, itemId, dir) {
  const at = indexOfItem(items, itemId)
  const to = at + dir
  if (at < 0 || to < 0 || to >= items.length) return null
  const here = items[at]
  const there = items[to]
  const next = [...items]
  if ((here.scene_id || null) === (there.scene_id || null)) {
    next[at] = there
    next[to] = here
  } else {
    next[at] = { ...here, scene_id: there.scene_id || null }
  }
  return next
}

/** Move a band up or down past the neighbouring band. null at the ends. */
export function stepBand(items, start, end, dir) {
  if (dir < 0) {
    if (start === 0) return null
    return moveBandTo(items, start, end, start - 1, 'before')
  }
  if (end >= items.length - 1) return null
  return moveBandTo(items, start, end, end + 1, 'after')
}

/** Duplicate in edit: a copy of the item right after it (a repeat, D6). */
export function duplicateItem(items, itemId, newId) {
  const at = indexOfItem(items, itemId)
  if (at < 0) return null
  const next = [...items]
  next.splice(at + 1, 0, { ...items[at], id: newId() })
  return next
}

/** Remove from edit: the item leaves the cut; the shot stays in the list and the project. */
export function removeItem(items, itemId) {
  const at = indexOfItem(items, itemId)
  if (at < 0) return null
  return items.filter((_, i) => i !== at)
}

/**
 * Duplicate a scene block in the edit (Audrey: "shots/scenes can be
 * repeated"): a copy of the band's items, with new ids, right after it — the
 * two runs of one scene then read as one band until something parts them.
 */
export function duplicateBand(items, start, end, newId) {
  if (start < 0 || end >= (items || []).length || start > end) return null
  const copy = items.slice(start, end + 1).map(it => ({ ...it, id: newId() }))
  const next = [...items]
  next.splice(end + 1, 0, ...copy)
  return next
}

/** Remove a scene block from the edit: its items leave the cut (the scene and its shots stay). */
export function removeBand(items, start, end) {
  if (start < 0 || end >= (items || []).length || start > end) return null
  return [...items.slice(0, start), ...items.slice(end + 1)]
}

/** New items after an item (null: at the end of the cut). */
export function insertAfter(items, afterId, newItems) {
  if (!newItems || !newItems.length) return null
  const at = afterId ? indexOfItem(items, afterId) : -1
  const next = [...(items || [])]
  next.splice(at < 0 ? next.length : at + 1, 0, ...newItems)
  return next
}

/**
 * Items for shots added to a draft. Added INTO a scene block (after a row,
 * or at a band's end) they join that block, as a shot moved there does
 * (`sceneId`); otherwise each sits in its own scene's block.
 */
export function itemsForShots(shots, newId, { sceneId } = {}) {
  return (shots || []).map(sh => ({
    id: newId(),
    scene_id: sceneId !== undefined ? (sceneId || null) : (sh.scene_id || null),
    shot_id: sh.id,
    label: sh.name || '',
    notes: '',
  }))
}

function sameOrder(a, b) {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && (x.scene_id || null) === (b[i].scene_id || null))
}
