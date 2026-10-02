// ============================================================
// RABBIT — dragging rows to change a cut (post-overhaul S3c, step 6; D16)
// ============================================================
//
// Native HTML5 drag (no library, D16), by a handle: the grip in a row's
// number cell (EditTable's cut position, the list tables' scene or shot
// number). The rows are kit Table rows; their inline editors stay clickable
// because only the grip is draggable.
//
// What may land where:
//   on the LIST (its own order on screen)    on an EDIT or a draft
//     a scene row   before / after a scene     a scene block  before / after a block
//     a shot row    before / after a shot      a shot (item)  before / after an item
//     a shot row    onto a scene: its top      an item        onto a block: its top
// A scene never lands on a shot (nor a block on an item) as a shot: over a
// row of ANOTHER block, a dragged block lands after that block (review round
// 2, R2-06: the line R1-07 draws under a block's last row sat on a row that
// refused the drop) — the rows pass the block they are part of. "Before" or
// "after" is the half of the row the pointer is over (a block's heading;
// anywhere else in the block is after it); a shot onto a scene is always the
// top of that scene's block ("after" its heading). The line is the row's
// `data-drop` (a sheet rule — never a style from script) and is state here,
// so one row shows it at a time.
//
// The drop itself is the caller's (`onDrop(drag, target, where)`): ScenesView
// turns it into a change of the cut through useEditChanges — on the list or a
// saved edit the first one asks (D13), on a draft it applies at once. Nothing
// moves while the pointer is down, so a Cancel has nothing to spring back.
// ============================================================

import { useCallback, useRef, useState } from 'react'

/** Which drags a target takes: the same kind, or a shot onto its block. */
const TAKES = {
  scene: ['scene', 'shot'],
  shot: ['shot'],
  band: ['band', 'item'],
  item: ['item'],
}
const isInto = (dragKind, targetKind) => (dragKind === 'shot' && targetKind === 'scene') || (dragKind === 'item' && targetKind === 'band')

export function dropAllowed(dragKind, targetKind) {
  return !!TAKES[targetKind]?.includes(dragKind)
}

/** Before or after: the half of the target row the pointer is over. */
export function dropWhere(dragKind, targetKind, clientY, rect) {
  if (isInto(dragKind, targetKind)) return 'after'
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

const cutBlockKey = (block) => `${block.kind}:${block.id}`

/**
 * What a drag over a row lands on: the row itself when it takes the drag;
 * else, for a BLOCK dragged over a row of a block (`opts.block`, the
 * { kind, id } the row is part of), that block — after it (R2-06). Null:
 * nothing (a block over its own rows lands nowhere new: the caller's self
 * check).
 */
export function dropTarget(drag, kind, id, opts) {
  if (!drag) return null
  if (dropAllowed(drag.kind, kind)) return { kind, id, inBlock: false }
  const b = opts?.block
  if (b && b.id && drag.kind === b.kind && dropAllowed(drag.kind, b.kind)) return { kind: b.kind, id: b.id, inBlock: true }
  return null
}

/**
 * onDrop(drag, target, where)   drag / target: { kind, id }; where: 'before' | 'after'
 * → { start(kind, id), end, over(kind, id, opts), leave(kind, id, opts), drop(kind, id, opts), at(kind, id), lineOf(kind, id), blockRow(block) }
 *   each of start / over / leave / drop returns the handler for that row;
 *   opts.block: the block the row is part of ({ kind, id }: an item's band,
 *   a shot's scene), where a dragged block over it lands (R2-06)
 *   blockRow(block) → the ref for a block's heading and each of its rows:
 *     that block's line holds while the pointer moves among them
 *   at(kind, id) → 'before' | 'after' | undefined — the row's drop line now
 *   lineOf(kind, id) → { where, drag } | undefined — the same, with the KIND
 *     being dragged: a block (or a scene) dropped after a block lands after
 *     that block's last row, so the tables draw its line there, not under
 *     the heading (review round 1, R1-07); a shot onto a block is the top
 *     of it, under the heading
 */
export function useCutDrag({ onDrop }) {
  const dragRef = useRef(null)
  const [line, setLine] = useState(null)   // { kind, id, where, drag }

  const start = useCallback((kind, id) => (e) => {
    dragRef.current = { kind, id }
    const dt = e.dataTransfer
    if (dt) {
      try {
        dt.effectAllowed = 'move'
        dt.setData('application/x-wilson-cut', JSON.stringify({ kind, id }))
        // The whole row goes with the pointer, not the grip alone.
        const row = e.currentTarget?.closest?.('tr')
        if (row && typeof dt.setDragImage === 'function') dt.setDragImage(row, 16, 16)
      } catch { /* a browser that refuses one of these still drags */ }
    }
  }, [])

  const end = useCallback(() => {
    dragRef.current = null
    setLine(null)
  }, [])

  const over = useCallback((kind, id, opts) => (e) => {
    const d = dragRef.current
    const t = dropTarget(d, kind, id, opts)
    if (!t || (d.kind === t.kind && d.id === t.id)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    const where = t.inBlock ? 'after' : dropWhere(d.kind, kind, e.clientY, e.currentTarget.getBoundingClientRect())
    setLine(prev => (prev && prev.kind === t.kind && prev.id === t.id && prev.where === where && prev.drag === d.kind ? prev : { kind: t.kind, id: t.id, where, drag: d.kind }))
  }, [])

  // Each block's heading and rows (`blockRow`'s refs), so a block's line
  // can tell a move within the block from leaving it. Kept here, not as a
  // DOM attribute: a data-* the sheet does not key on is the Scenes lane's
  // own rule (rabbitScenesCss.test.js).
  const blockOf = useRef(new WeakMap())
  const blockRow = useCallback((block) => (el) => {
    if (el && block?.id) blockOf.current.set(el, cutBlockKey(block))
  }, [])
  const blockAt = (node) => {
    // A nested table's row (the list's nest of shots) is its nest's.
    for (let tr = node?.closest?.('tr'); tr; tr = tr.parentElement?.closest?.('tr')) {
      const key = blockOf.current.get(tr)
      if (key) return key
    }
    return null
  }

  const leave = useCallback((kind, id, opts) => (e) => {
    // Moving between a row's own cells is not leaving it.
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return
    // A block's line (drawn from its heading or any of its rows) stays
    // while the pointer moves within that block, and goes when it leaves
    // the block. Chromium fires no dragover in the step that changes the
    // element under the pointer (the next one comes a tick later), so
    // clearing it row by row made the line blink at every row (measured in
    // review round 2's re-run).
    const b = opts?.block
    const into = b ? blockAt(e.relatedTarget) : null
    setLine((prev) => {
      if (!prev) return prev
      if (b && prev.kind === b.kind && prev.id === b.id) return into === cutBlockKey(b) ? prev : null
      return prev.kind === kind && prev.id === id ? null : prev
    })
  }, [])

  const drop = useCallback((kind, id, opts) => (e) => {
    const d = dragRef.current
    const t = dropTarget(d, kind, id, opts)
    if (!t) return
    e.preventDefault()
    const where = t.inBlock ? 'after' : dropWhere(d.kind, kind, e.clientY, e.currentTarget.getBoundingClientRect())
    dragRef.current = null
    setLine(null)
    if (d.kind === t.kind && d.id === t.id) return
    onDrop?.(d, { kind: t.kind, id: t.id }, where)
  }, [onDrop])

  const at = useCallback((kind, id) => (line && line.kind === kind && line.id === id ? line.where : undefined), [line])
  const lineOf = useCallback((kind, id) => (line && line.kind === kind && line.id === id ? { where: line.where, drag: line.drag } : undefined), [line])

  return { start, end, over, leave, drop, at, lineOf, blockRow }
}

/**
 * Where a block's heading and its rows draw the line (R1-07): a block of the
 * heading's own kind dropped AFTER it lands after the block's last row, so
 * the line is that row's when the block shows any; otherwise the heading's.
 *   line      lineOf(kind, id) for the heading
 *   blockKind the kind a block of this heading is dragged as ('band' in the
 *             cut, 'scene' on the list)
 *   rowsShown whether the block shows rows under its heading now
 * → { head: 'before' | 'after' | undefined, lastRow: 'after' | undefined }
 */
export function blockLine(line, blockKind, rowsShown) {
  if (!line) return { head: undefined, lastRow: undefined }
  if (line.where === 'after' && line.drag === blockKind && rowsShown) return { head: undefined, lastRow: 'after' }
  return { head: line.where, lastRow: undefined }
}
