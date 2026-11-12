// frames.js: MO4 boards: what a frame holds, worked out from positions (nothing of it is stored). Pure, no Konva,
// no DOM.
//
//   * a frame holds a thing whose bounds' middle is inside the frame's bounds and which is no larger than the frame,
//     a frame by the same rule (of two frames that would hold each other, the lower holds the higher); a free line
//     (no end tied) as any thing, never a line tied at an end (it follows its ends) and never itself;
//   * what frames hold, and what the frames among those hold, and so on, without looping;
//   * the frame that would take what is being dragged, for the outline a drag shows;
//   * the box a new frame takes around a selection;
//   * the z values that put a frame and what it holds above everything else, in their own order.
import { boundsOf, byStack, grow, unionBounds } from './snapping.js'

const num = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d)
const listOf = (elements) => (elements instanceof Map ? [...elements.values()] : [...(elements ?? [])])

/** A connector tied at an end follows its ends and is never held; a free one is held as any thing is. */
export function isTied(el) {
  return el?.kind === 'connector' && (el.from_id != null || el.to_id != null)
}

// Whether a box's middle lies inside another box and it is no larger.
function sitsIn(outer, inner) {
  const cx = inner.x + inner.w / 2
  const cy = inner.y + inner.h / 2
  return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h
    && inner.w <= outer.w && inner.h <= outer.h
}

/**
 * Whether a frame holds an element: by the axis-aligned bounds the board uses, so a turned thing by its bounds. A
 * frame is held as any thing is; where two frames would hold each other, only the lower in the drawing order holds.
 */
export function frameHolds(frame, el) {
  if (!frame || !el || frame.kind !== 'frame' || el.id === frame.id || isTied(el)) return false
  const fb = boundsOf(frame)
  const b = boundsOf(el)
  if (!sitsIn(fb, b)) return false
  if (el.kind === 'frame' && sitsIn(b, fb)) return byStack(frame, el) < 0
  return true
}

/**
 * Everything the given frames hold, and what the frames among those hold, and so on: a set of ids, never a
 * connector tied at an end, never one of the given frames.
 */
export function heldBy(elements, frameIds) {
  const list = listOf(elements)
  const byId = new Map(list.map((el) => [el.id, el]))
  const seen = new Set(frameIds)
  const out = new Set()
  const queue = [...seen].map((id) => byId.get(id)).filter((el) => el?.kind === 'frame')
  while (queue.length) {
    const f = queue.shift()
    for (const el of list) {
      if (seen.has(el.id) || !frameHolds(f, el)) continue
      seen.add(el.id)
      out.add(el.id)
      if (el.kind === 'frame') queue.push(el)
    }
  }
  return out
}

/**
 * The frame that would take what is being dragged: the topmost frame (in drawing order), not one of skipIds, that
 * would hold one of `things` where each is now (frameHolds: by a thing's middle, not by where the pointer is, so
 * what the board shows during a drag is what the drop does). Null when none would.
 */
export function frameTaking(elements, things, skipIds = []) {
  const skip = skipIds instanceof Set ? skipIds : new Set(skipIds)
  const dragged = (things ?? []).filter(Boolean)
  if (!dragged.length) return null
  let top = null
  for (const el of listOf(elements)) {
    if (el?.kind !== 'frame' || skip.has(el.id)) continue
    if (!dragged.some((t) => frameHolds(el, t))) continue
    if (!top || byStack(top, el) < 0) top = el
  }
  return top
}

/** The box a frame takes around boxes: their union grown by pad on every side (null for none). */
export function frameBoxAround(boxes, pad = 24) {
  const u = unionBounds(boxes)
  return u ? grow(u, pad) : null
}

/**
 * The z values that put a frame (or none) and the held things straight above everything else: the frame first,
 * then the held things in their own drawing order, each above the one before. Anything already where it needs to
 * be keeps its z; answers [{ id, z }] for what changes.
 */
export function raisePlan(elements, frameId, heldIds) {
  const list = listOf(elements)
  const held = new Set(heldIds)
  if (frameId != null) held.delete(frameId)
  const frame = frameId != null ? list.find((el) => el.id === frameId) : null
  const chosen = list.filter((el) => held.has(el.id)).sort(byStack)
  if (frame) chosen.unshift(frame)
  if (!chosen.length) return []
  const moving = new Set(chosen.map((el) => el.id))
  let floor = -Infinity
  for (const el of list) if (!moving.has(el.id)) floor = Math.max(floor, num(el.z))
  const out = []
  for (const el of chosen) {
    const z = num(el.z)
    if (z > floor) { floor = z; continue }
    floor = Number.isFinite(floor) ? floor + 1 : z
    out.push({ id: el.id, z: floor })
  }
  return out
}
