// boardPanelState.js — MO4 (Session 4): the board panel's pure rules, apart from React so they are tested alone.
// The panel has three sizes (in a frame over the map, filling the map's view, maximised over the whole tool); on the
// framed size only, its edges pull away (the frame shrinks as it is pulled, and past a set distance it collapses
// back into its dot) and its corners resize. Escape goes to the topmost picker, editor or drag first (the stack),
// and only then back to the map. Nothing here touches the DOM.

export const SIZES = Object.freeze(['framed', 'filled', 'maximised'])
export const SIZE_WORDS = Object.freeze({ framed: 'Show in a frame', filled: 'Fill the view', maximised: 'Maximise' })
export const normalizeSize = (size) => (SIZES.includes(size) ? size : 'framed')
/** Pulling an edge away and dragging a corner are the frame's alone: the other sizes fill their space. */
export const canPullAway = (size) => size === 'framed'
export const canResize = (size) => size === 'framed'

/** How far an edge is pulled outward before letting go closes the board (CSS px). */
export const PULL_CLOSE_PX = 160
/** How much smaller the frame is at the closing distance: it shrinks as it is pulled. */
export const PULL_SHRINK = 0.3
/** The band along the frame's edge that is the frame's own, and the square at each corner (larger for a finger). */
export const EDGE_BAND_PX = 10
export const CORNER_PX = 20
export const TOUCH_EDGE_BAND_PX = 18
export const TOUCH_CORNER_PX = 32
export const MIN_FRAME = Object.freeze({ w: 360, h: 240 })
/** A frame's space when it cannot be measured (a test's DOM, a hidden page). */
export const FALLBACK_BOUNDS = Object.freeze({ w: 1200, h: 800 })
/**
 * How far in from the page's right edge WILSON's pet reaches (it sits fixed in the bottom right corner, above every
 * page, and takes a press itself): the frame opens clear of it, so its bottom right corner can be taken hold of.
 * Seen in a running browser: at 64 px the corner lay under the pet, and a press there opened the pet instead.
 */
export const PET_REACH_PX = 80
const MARGIN = Object.freeze({ x: PET_REACH_PX + 8, y: 48 })
/** How long the frame takes to collapse into its dot. */
export const COLLAPSE_MS = 200

export const BOARD_NEEDS_CLOUD = 'A board needs this project in the cloud.'

/** The band and corner sizes for the input in use: a finger or a pen gets larger targets. */
export function hitSizes(inputMode) {
  return inputMode === 'touch' || inputMode === 'pen'
    ? { band: TOUCH_EDGE_BAND_PX, corner: TOUCH_CORNER_PX }
    : { band: EDGE_BAND_PX, corner: CORNER_PX }
}

const finite = (v, d) => (Number.isFinite(v) ? v : d)

/** The space the frame lives in, from a measured rect; nothing measured is the fallback. */
export function boundsFrom(rect) {
  const w = finite(rect?.width, 0)
  const h = finite(rect?.height, 0)
  return w > 0 && h > 0 ? { w, h } : { ...FALLBACK_BOUNDS }
}

/** The frame a board opens in: centred, with the map showing around it. */
export function defaultFrame(bounds = FALLBACK_BOUNDS) {
  const bw = Math.max(1, finite(bounds?.w, FALLBACK_BOUNDS.w))
  const bh = Math.max(1, finite(bounds?.h, FALLBACK_BOUNDS.h))
  const w = Math.min(bw, Math.max(MIN_FRAME.w, bw - 2 * MARGIN.x))
  const h = Math.min(bh, Math.max(MIN_FRAME.h, bh - 2 * MARGIN.y))
  return { x: Math.round((bw - w) / 2), y: Math.round((bh - h) / 2), w: Math.round(w), h: Math.round(h) }
}

/** A frame kept inside its space, no smaller than the least (unless the space itself is smaller). */
export function clampFrame(rect, bounds = FALLBACK_BOUNDS, min = MIN_FRAME) {
  const bw = Math.max(1, finite(bounds?.w, FALLBACK_BOUNDS.w))
  const bh = Math.max(1, finite(bounds?.h, FALLBACK_BOUNDS.h))
  const w = Math.min(bw, Math.max(Math.min(min.w, bw), finite(rect?.w, min.w)))
  const h = Math.min(bh, Math.max(Math.min(min.h, bh), finite(rect?.h, min.h)))
  const x = Math.min(bw - w, Math.max(0, finite(rect?.x, 0)))
  const y = Math.min(bh - h, Math.max(0, finite(rect?.y, 0)))
  return { x, y, w, h }
}

/**
 * Where a press on the frame lands, in the frame's own coordinates' space (the same space as `rect`): a corner
 * ('nw', 'ne', 'sw', 'se') within `corner` of two edges, an edge ('n', 'e', 's', 'w') within `band` of one, or null
 * (inside, where the board has it, or outside the frame).
 */
export function hitZone(rect, px, py, { band = EDGE_BAND_PX, corner = CORNER_PX } = {}) {
  if (!rect || !Number.isFinite(px) || !Number.isFinite(py)) return null
  const lx = px - rect.x
  const ly = py - rect.y
  if (lx < 0 || ly < 0 || lx > rect.w || ly > rect.h) return null
  const fromLeft = lx
  const fromRight = rect.w - lx
  const fromTop = ly
  const fromBottom = rect.h - ly
  const ns = fromTop <= corner ? 'n' : fromBottom <= corner ? 's' : ''
  const ew = fromLeft <= corner ? 'w' : fromRight <= corner ? 'e' : ''
  // A corner is near two edges at once, and within the band of at least one of them (its inside stays the board's).
  const inBand = Math.min(fromLeft, fromRight, fromTop, fromBottom) <= band
  if (ns && ew && inBand) return ns + ew
  if (fromTop <= band) return 'n'
  if (fromBottom <= band) return 's'
  if (fromLeft <= band) return 'w'
  if (fromRight <= band) return 'e'
  return null
}
export const isCorner = (zone) => zone === 'nw' || zone === 'ne' || zone === 'sw' || zone === 'se'
export const isEdge = (zone) => zone === 'n' || zone === 'e' || zone === 's' || zone === 'w'

/** The pointer's cursor over a zone: a corner resizes, an edge pulls away. */
export function cursorFor(zone) {
  if (zone === 'nw' || zone === 'se') return 'nwse-resize'
  if (zone === 'ne' || zone === 'sw') return 'nesw-resize'
  if (isEdge(zone)) return 'grab'
  return ''
}

/** How far an edge has been pulled outward from where it was pressed; pushing it inward is no pull. */
export function pullDistance(edge, start, now) {
  if (!start || !now) return 0
  const dx = finite(now.x, 0) - finite(start.x, 0)
  const dy = finite(now.y, 0) - finite(start.y, 0)
  const out = edge === 'n' ? -dy : edge === 's' ? dy : edge === 'w' ? -dx : edge === 'e' ? dx : 0
  return Math.max(0, out)
}

/** The frame's scale while pulled: 1 at rest, smaller the farther it is pulled, and no smaller past the distance. */
export function pullScale(distance) {
  const t = Math.min(1, Math.max(0, finite(distance, 0)) / PULL_CLOSE_PX)
  return 1 - PULL_SHRINK * t
}
/** Let go at this distance or beyond, and the board closes into its dot; short of it, the frame springs back. */
export const pullCloses = (distance) => finite(distance, 0) >= PULL_CLOSE_PX

/** A corner dragged by (dx, dy): the two edges it joins move, kept inside the space and no smaller than the least. */
export function resizeFrame(rect, corner, dx, dy, bounds = FALLBACK_BOUNDS, min = MIN_FRAME) {
  if (!rect || !isCorner(corner)) return rect
  const bw = Math.max(1, finite(bounds?.w, FALLBACK_BOUNDS.w))
  const bh = Math.max(1, finite(bounds?.h, FALLBACK_BOUNDS.h))
  const mw = Math.min(min.w, bw)
  const mh = Math.min(min.h, bh)
  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.w
  let bottom = rect.y + rect.h
  const ddx = finite(dx, 0)
  const ddy = finite(dy, 0)
  if (corner.includes('w')) left = Math.min(right - mw, Math.max(0, left + ddx))
  if (corner.includes('e')) right = Math.max(left + mw, Math.min(bw, right + ddx))
  if (corner.includes('n')) top = Math.min(bottom - mh, Math.max(0, top + ddy))
  if (corner.includes('s')) bottom = Math.max(top + mh, Math.min(bh, bottom + ddy))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * The frame collapsing back into its dot: the move from the frame's centre to the dot and the scale it ends at, as a
 * CSS transform. With no dot to go to, it shrinks where it is.
 */
export function collapseTransform(rect, origin) {
  if (!rect) return 'scale(0.04)'
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return 'scale(0.04)'
  return `translate(${Math.round(origin.x - cx)}px, ${Math.round(origin.y - cy)}px) scale(0.04)`
}

/**
 * The panel's Escape stack (handed to the board as `escape`): `push(handler)` returns its pop. An Escape asks the
 * newest handler first; one that returns true took the key, and an older one is asked only when a newer one did not.
 * When none takes it, the panel goes back to the map.
 */
export function createEscapeStack() {
  const entries = []
  return {
    push(handler) {
      if (typeof handler !== 'function') return () => {}
      const entry = { handler }
      entries.push(entry)
      let popped = false
      return () => {
        if (popped) return
        popped = true
        const i = entries.indexOf(entry)
        if (i >= 0) entries.splice(i, 1)
      }
    },
    handle(event) {
      // A handler that pops itself (or another) while answering must not skip one: walk a copy, newest first.
      for (const entry of [...entries].reverse()) {
        if (!entries.includes(entry)) continue
        let took = false
        try { took = entry.handler(event) === true } catch { took = false }
        if (took) return true
      }
      return false
    },
    size: () => entries.length,
  }
}

/**
 * The words for a board that could not be opened (or, `making`, made): the server's own when they are plain, else
 * ours. The server gives one refusal for missing and not allowed ("board not found", "folder not found or not
 * writable"), and so do these words.
 */
export function boardWords(err, { making = false } = {}) {
  if (err?.code === 'boards_absent') return err?.message || BOARD_NEEDS_CLOUD
  const m = String(err?.message ?? '')
  if (err?.code === '42501' && (!m || /not found|not writable/i.test(m))) {
    return making ? 'You cannot make a board here. The folder may have moved, or you may not change it.'
      : 'This board is not there any more, or you may not open it.'
  }
  return m || (making ? 'The board could not be made just now.' : 'The board could not be opened just now.')
}

// ── A board to the trash (0131's moth_trash_folders on the board's own folder) ────────────────────────────────
export const TRASH_WORDS = Object.freeze({
  action: 'Put in the trash',
  question: 'Put this board in the trash? Its notes and pictures go with it. You can bring it back from Moth\'s trash for 30 days.',
  yes: 'Put it in the trash',
  no: 'Keep it',
  busy: 'Putting it in the trash…',
  done: 'The board is in the trash. You can bring it back from Moth\'s trash for 30 days.',
  failed: 'The board could not be put in the trash just now.',
  gone: 'This board is not there any more, or you may not change it.',
})

/**
 * Why a board did not go to the trash: the server's own words (an adapter's "[name] " before them left off). Its
 * one refusal for missing and not allowed ("folder not found or not writable") is said plainly, as a board.
 */
export function trashWords(err) {
  if (err?.code === 'boards_absent') return err?.message || BOARD_NEEDS_CLOUD
  const raw = err?.words || (err?.code === 'P0001' && (err?.details || err?.detail)) || err?.message || ''
  const m = String(raw).replace(/^\[[^\]]*\]\s*/, '').trim()
  if (err?.code === '42501' && (!m || /not found|not writable/i.test(m))) return TRASH_WORDS.gone
  return m || TRASH_WORDS.failed
}

/**
 * Who the panel is open for: the person and their company. When either changes (another account, another company,
 * or signed out), the board of the last one is let go and the panel closes.
 */
export const whoKey = (me, companyId) => `${me?.id ?? ''}|${companyId ?? ''}`

// Boards closed while their last changes could not reach the server: each one's store keeps trying a while
// (boardStore's dispose). They are held here, by board id, and not in the panel's own file, for two reasons: the same
// board opened again sends those changes first and then reads; and the page, which is there when no board is open,
// lets them all go the moment the person or the company changes. What was waiting must never go out under the next
// account.
const leaving = new Map() // board id -> { store, who }
/** Remember a close that is still trying. */
export function keepLeaving(boardId, entry) { leaving.set(boardId, entry) }
/** Forget it once it has ended (only if it is still the one held for that board). */
export function doneLeaving(boardId, entry) { if (leaving.get(boardId) === entry) leaving.delete(boardId) }
/** The close still trying for a board, or null. */
export function leavingOf(boardId) { return leaving.get(boardId) ?? null }
/** Let go of every close that is not this person's in this company: dropped, with nothing more sent. */
export function dropLeaving(who) {
  for (const [id, l] of leaving) {
    if (l.who === who) continue
    leaving.delete(id)
    try { l.store.dispose?.({ save: false }) } catch { /* already gone */ }
  }
}
