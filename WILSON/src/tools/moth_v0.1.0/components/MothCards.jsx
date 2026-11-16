// MothCards.jsx — MO2: the folder cards, bottom left of the HUD (the brief §3.3, her rulings of 2026-11-01).
// Select a folder and a small scrollable card shows what is in it; pin it and it
// stays while you move about, up to five at once, each scrolling on its own. A sixth is refused with a sentence.
// Files drag between cards, and from a card onto the graph. Pinned cards are never saved with a view: instead a
// small icon opens the folders opened last, and nothing shows until it is pressed.
//
// MO5 (her item 1): a card is never cut off. The cards share one size, larger than before, which the person sets by
// dragging a card's top edge, its right edge or the corner between them (or with the arrow keys on an edge), and which
// is kept for them on this computer. However the size was set, a card is drawn no larger than the room the map leaves
// it, and its rows scroll inside it; more cards than one row holds wrap, and the cards scroll upward and downward
// together, never sideways under a scrollbar (her picture: the bar covered the cards' lower part).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Clock, Pin, PinOff, X } from 'lucide-react'
import { IconButton } from '../../../ui'
import { nodeId } from '../engine/model.js'
import { CARD_LIMITS, DEFAULT_LOCAL } from '../state/mothAppearance.js'

export const MAX_PINNED = 5
export const SIXTH_SENTENCE = 'Five cards at most. Unpin one to pin this.'
const CONTAINER = new Set(['project', 'folder', 'phase', 'scene'])
const FILE_DRAG = 'application/x-wilson-moth-file'
/** What the map keeps for itself round the cards: the list on the right, the bar above, the edges. */
export const CARDS_ROOM = Object.freeze({ left: 16, bottom: 16, right: 348, top: 88, clock: 36, pad: 6 })
export const CARD_KEY_STEP = 16

/** The room a card has inside the HUD (its width and height in pixels): what is left once the list, the bar, the
 *  clock icon and the strip's own edge (where the grips sit) are kept clear. */
export function cardsRoom(hud) {
  const w = Math.max(0, Number(hud?.w) || 0)
  const h = Math.max(0, Number(hud?.h) || 0)
  // Below the bar as it is drawn (a narrow window wraps it onto a second row), never higher than one row allows.
  const top = Number.isFinite(hud?.barBottom) ? Math.max(CARDS_ROOM.top, hud.barBottom + 32) : CARDS_ROOM.top
  return {
    w: Math.max(0, w - CARDS_ROOM.left - CARDS_ROOM.right - CARDS_ROOM.clock - CARDS_ROOM.pad),
    h: Math.max(0, h - CARDS_ROOM.bottom - top - CARDS_ROOM.pad),
  }
}

export const CARD_GAP = 8
/** The least a card is drawn at when many share a small room: its head and two rows. Below it, the cards scroll. */
export const CARD_FLOOR = 96

/**
 * The size a card is drawn at: the person's own, never larger than the room (the room wins over the minimum). With
 * `count` cards, as many as fit side by side make a row, and when that takes more than one row the rows share the
 * room's height, so every card shows whole; only past CARD_FLOOR do they scroll.
 */
export function fitCard(size, room, count = 1) {
  const w = Math.min(CARD_LIMITS.maxW, Math.max(CARD_LIMITS.minW, Number(size?.w) || DEFAULT_LOCAL.card_w))
  const h = Math.min(CARD_LIMITS.maxH, Math.max(CARD_LIMITS.minH, Number(size?.h) || DEFAULT_LOCAL.card_h))
  const rw = Number(room?.w)
  const rh = Number(room?.h)
  const dw = Number.isFinite(rw) && rw > 0 ? Math.min(w, rw) : w
  let dh = Number.isFinite(rh) && rh > 0 ? Math.min(h, rh) : h
  if (Number.isFinite(rw) && rw > 0 && Number.isFinite(rh) && rh > 0 && count > 1) {
    const perRow = Math.max(1, Math.floor((rw + CARD_GAP) / (dw + CARD_GAP)))
    const rows = Math.ceil(count / perRow)
    if (rows > 1) dh = Math.min(dh, Math.max(Math.min(CARD_FLOOR, rh), (rh - (rows - 1) * CARD_GAP) / rows))
  }
  return { w: Math.round(dw), h: Math.round(dh) }
}

/** A drag of an edge (or the corner) from where it started: the top edge grows a card upward, the right edge wider. */
export function resizedCard(start, edge, dx, dy, room) {
  const lim = (v, lo, hi, roomMax) => Math.round(Math.max(lo, Math.min(hi, Number.isFinite(roomMax) && roomMax > 0 ? Math.min(v, roomMax) : v)))
  const w = edge === 'right' || edge === 'corner' ? start.w + dx : start.w
  const h = edge === 'top' || edge === 'corner' ? start.h - dy : start.h
  return { w: lim(w, CARD_LIMITS.minW, CARD_LIMITS.maxW, room?.w), h: lim(h, CARD_LIMITS.minH, CARD_LIMITS.maxH, room?.h) }
}

// An edge of a card: dragged with the pointer, or with the arrow keys once it has the focus (the corner is the
// pointer's only: its two edges are the keyboard's).
function Grip({ edge, size, drawn, room, onSize }) {
  const drag = useRef(null)
  const vertical = edge === 'right'
  const value = vertical ? drawn.w : drawn.h
  // Only the side dragged changes what is kept; the other stays as it was kept, never as the room cut it (round 1:
  // a touch, Escape or a key saved the size drawn in a small window, smaller than the size kept).
  // A drag's result, side by side: smaller than drawn is what it shows; larger than drawn never below the size kept
  // (the room may hold the cards smaller); a side not changed keeps the size kept (round 2).
  const dragged = (next, start, before) => {
    const side = (k) => (next[k] < start[k] ? next[k] : next[k] > start[k] ? Math.max(next[k], before[k]) : before[k])
    return { w: side('w'), h: side('h') }
  }
  const end = (cancel) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    window.removeEventListener('pointermove', d.move, true)
    window.removeEventListener('pointerup', d.up, true)
    window.removeEventListener('pointercancel', d.lost, true)
    window.removeEventListener('keydown', d.key, true)
    onSize(cancel || !d.moved ? d.before : dragged(d.last, d.start, d.before), { done: true })
  }
  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    e.stopPropagation()
    const start = { w: drawn.w, h: drawn.h }
    const d = {
      start, last: start, before: { w: size.w, h: size.h }, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false,
      move: (ev) => {
        if (d.id !== undefined && ev.pointerId !== undefined && ev.pointerId !== d.id) return
        // A finger's jitter is no drag (round 2): three pixels first.
        if (!d.moved && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 3) return
        d.moved = true
        d.last = resizedCard(start, edge, ev.clientX - d.x, ev.clientY - d.y, room)
        onSize(d.last, { done: false })
      },
      up: (ev) => { if (d.id === undefined || ev.pointerId === undefined || ev.pointerId === d.id) end(false) },
      lost: (ev) => { if (d.id === undefined || ev.pointerId === undefined || ev.pointerId === d.id) end(true) },
      key: (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(true) } },
    }
    drag.current = d
    window.addEventListener('pointermove', d.move, true)
    window.addEventListener('pointerup', d.up, true)
    window.addEventListener('pointercancel', d.lost, true)
    window.addEventListener('keydown', d.key, true)
  }
  useEffect(() => () => { if (drag.current) end(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const onKeyDown = (e) => {
    const step = e.shiftKey ? CARD_KEY_STEP * 4 : CARD_KEY_STEP
    const keys = vertical ? { ArrowRight: step, ArrowLeft: -step } : { ArrowUp: step, ArrowDown: -step }
    if (!(e.key in keys)) return
    e.preventDefault()
    const grow = keys[e.key]
    // Smaller goes from what is drawn (it shows at once); larger never below the size kept (round 1: where the room
    // held the cards smaller, "taller" saved less than was kept).
    const axis = vertical ? 'w' : 'h'
    const n = resizedCard(drawn, edge, vertical ? grow : 0, vertical ? 0 : -grow, room)[axis]
    onSize({ w: size.w, h: size.h, [axis]: grow > 0 ? Math.max(n, size[axis]) : n }, { done: true })
  }
  if (edge === 'corner') {
    return <span className="moth-card-grip" data-edge="corner" aria-hidden="true" onPointerDown={onPointerDown} data-moth-card-grip="corner" />
  }
  return (
    <span
      className="moth-card-grip"
      data-edge={edge}
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={vertical ? 'Width of the folder cards' : 'Height of the folder cards'}
      aria-valuemin={vertical ? CARD_LIMITS.minW : CARD_LIMITS.minH}
      aria-valuemax={Math.round(vertical ? Math.min(CARD_LIMITS.maxW, room?.w || CARD_LIMITS.maxW) : Math.min(CARD_LIMITS.maxH, room?.h || CARD_LIMITS.maxH))}
      aria-valuenow={value}
      title={vertical ? 'Drag to make the cards wider or narrower' : 'Drag to make the cards taller or shorter'}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      data-moth-card-grip={edge}
      data-size={vertical ? size.w : size.h}
    />
  )
}

function Card({ id, index, children, pinned, onPin, onClose, onSelect, onDropFile, onDragFile, drawn, size, room, onSize }) {
  const row = index.rows.get(id)
  const [over, setOver] = useState(false)
  if (!row) return null
  const kids = (children.get(id) || []).map((k) => index.rows.get(k)).filter(Boolean)
    .sort((a, b) => Number(b.kind !== 'file') - Number(a.kind !== 'file') || String(a.label).localeCompare(String(b.label)))
  return (
    <section
      className={`moth-card${over ? ' is-over' : ''}`}
      aria-label={row.label || 'Folder'}
      data-moth-card={pinned ? 'pinned' : 'open'}
      style={{ width: drawn.w, height: drawn.h }}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes(FILE_DRAG)) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); const fid = e.dataTransfer?.getData(FILE_DRAG); if (fid) { e.preventDefault(); onDropFile(fid, id) } }}
    >
      <Grip edge="top" size={size} drawn={drawn} room={room} onSize={onSize} />
      <Grip edge="right" size={size} drawn={drawn} room={room} onSize={onSize} />
      <Grip edge="corner" size={size} drawn={drawn} room={room} onSize={onSize} />
      <header className="moth-card-head">
        <span className="moth-card-title">{row.label || '(no name)'}</span>
        <IconButton size="sm" Icon={pinned ? PinOff : Pin} title={pinned ? 'Unpin this card' : 'Pin this card'} onClick={onPin} />
        {onClose && <IconButton size="sm" Icon={X} title="Close this card" onClick={onClose} />}
      </header>
      <ul className="moth-card-rows">
        {kids.length === 0 && <li className="moth-quiet">Nothing here you can see.</li>}
        {kids.map((k) => (
          <li key={k.id}>
            <button
              type="button"
              className="moth-link"
              draggable={k.kind === 'file'}
              onDragStart={(e) => { if (k.kind === 'file') { e.dataTransfer.setData(FILE_DRAG, k.rowId); e.dataTransfer.effectAllowed = 'move'; onDragFile?.(k.rowId) } }}
              onClick={() => onSelect(k.id)}
            >
              {k.label || '(no name)'}{CONTAINER.has(k.kind) ? ' ›' : ''}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function MothCards({ selectedId, index, recent, onSelect, onOpenCard, onDropFile, onNote, size: kept = null, onSize = () => {} }) {
  const [pinned, setPinned] = useState([])
  const [shut, setShut] = useState(null)
  const [recentOpen, setRecentOpen] = useState(false)
  const [opened, setOpened] = useState(null)
  // The size while an edge is held (drawn at once, kept when let go), and the room the HUD leaves the cards.
  const [held, setHeld] = useState(null)
  const size = held ?? { w: kept?.w ?? DEFAULT_LOCAL.card_w, h: kept?.h ?? DEFAULT_LOCAL.card_h }
  const boxRef = useRef(null)
  const [hud, setHud] = useState(null)
  useLayoutEffect(() => {
    const host = boxRef.current?.parentElement
    if (!host) return undefined
    const bar = () => host.querySelector?.('[data-moth-view-widget]') ?? null
    const measure = () => {
      const r = host.getBoundingClientRect()
      const b = bar()?.getBoundingClientRect?.()
      const barBottom = b && b.height > 0 ? b.bottom - r.top : undefined
      setHud((was) => (was && was.w === r.width && was.h === r.height && was.barBottom === barBottom ? was : { w: r.width, h: r.height, barBottom }))
    }
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    if (bar()) ro.observe(bar())
    return () => ro.disconnect()
  }, [])
  // An unmeasured HUD (a test's DOM) gives no room to hold to: the card is drawn at its own size.
  const room = hud && hud.w > 0 && hud.h > 0 ? cardsRoom(hud) : null
  const resize = (next, { done }) => {
    if (done) { setHeld(null); onSize(next) } else setHeld(next)
  }
  const children = useMemo(() => {
    const out = new Map()
    for (const [id, p] of index.parent) {
      if (!out.has(p)) out.set(p, [])
      out.get(p).push(id)
    }
    return out
  }, [index])
  // A new selection is followed afresh: a card shut, or one picked from the recent list, was for the last one.
  useEffect(() => { setShut(null); setOpened(null) }, [selectedId])
  const selectedRow = selectedId ? index.rows.get(selectedId) : null
  // The open card: a folder selected (the smallest level, a folder with its files; the brief §3.3), or one picked
  // from the recent list, unless it is pinned already or shut.
  const openId = opened && index.rows.has(opened) ? opened
    : selectedRow && selectedRow.kind === 'folder' && selectedId !== shut ? selectedId : null
  const live = pinned.filter((id) => index.rows.has(id))
  // Every folder whose card is shown is one of the folders opened last (the recent icon), not only a pinned one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (openId) onOpenCard?.(openId) }, [openId])
  const pin = (id) => {
    if (live.includes(id)) { setPinned(live.filter((x) => x !== id)); return }
    if (live.length >= MAX_PINNED) { onNote?.(SIXTH_SENTENCE); return }
    setPinned([...live, id])
    setOpened(null)
    onOpenCard?.(id)
  }
  // The folders opened last session, as Moth shows them now (a hidden or gone one is simply absent).
  const recentRows = (recent || []).map((r) => nodeId(r.k, r.id)).filter((id) => index.rows.has(id))
  const shownCount = live.length + (openId && !live.includes(openId) ? 1 : 0)
  const drawn = fitCard(size, room, shownCount)

  return (
    <div className="moth-cards" data-moth-cards ref={boxRef}
      style={room ? { maxWidth: room.w + CARDS_ROOM.pad + CARDS_ROOM.clock, maxHeight: room.h + CARDS_ROOM.pad } : undefined}>
      <div className="moth-cards-strip" data-moth-cards-strip
        style={room ? { maxWidth: room.w + CARDS_ROOM.pad, maxHeight: room.h + CARDS_ROOM.pad } : undefined}>
      {live.map((id) => (
        <Card key={id} id={id} index={index} children={children} pinned onPin={() => pin(id)} onSelect={onSelect} onDropFile={onDropFile}
          drawn={drawn} size={size} room={room} onSize={resize} />
      ))}
      {openId && !live.includes(openId) && (
        <Card id={openId} index={index} children={children} pinned={false} onPin={() => pin(openId)}
          onClose={() => { setOpened(null); setShut(openId) }} onSelect={onSelect} onDropFile={onDropFile}
          drawn={drawn} size={size} room={room} onSize={resize} />
      )}
      </div>
      <div className="moth-recent">
        <IconButton size="sm" Icon={Clock} title="Folders opened last" onClick={() => setRecentOpen((v) => !v)} aria-expanded={recentOpen} data-moth-recent />
        {recentOpen && (
          <ul className="moth-recent-list" data-moth-recent-list>
            {recentRows.length === 0 && <li className="moth-quiet">None yet.</li>}
            {recentRows.map((id) => (
              <li key={id}>
                <button type="button" className="moth-link" onClick={() => { setRecentOpen(false); setShut(null); setOpened(id) }}>
                  {index.rows.get(id)?.label || '(no name)'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
