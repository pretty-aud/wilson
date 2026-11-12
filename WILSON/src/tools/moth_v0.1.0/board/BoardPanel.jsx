// BoardPanel.jsx — MO4 (Session 4): one board, in a panel that expands inside M.O.T.H. Three sizes: in a frame over
// the map, filling the map's view, and maximised over the whole tool. A button and Escape go straight back to the
// map; the topmost picker, editor or drag inside the board takes Escape first (the Escape stack it is handed as
// `escape`). On the framed size only, an edge pulled outward shrinks the frame as it goes, and let go past a set
// distance it collapses back into its dot; its corners resize it. The rules are boardPanelState.js's.
//
// It makes the board's store, its turns at the stickies and its live channels, and hands them to the canvas. The
// canvas (and Konva with it) is reached only through React.lazy, so neither is in the Moth chunk. The kit Dialog does
// not portal (handbook rule 54): whatever the board opens is layered inside this panel, inside Moth's own page.
//
// Another person, another company (`companyId`) or signed out: the channels are left, the store and the turns let
// go, and the panel goes back to the map, so nothing of one account's board stays open for the next. Someone who may
// change the board can put it in the trash from here: asked first in the panel itself, then the board's own folder
// goes (0131's moth_trash_folders), and Moth's trash lists it with Bring back.
import { Component, Suspense, lazy, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Expand, Maximize2, Shrink, Trash2 } from 'lucide-react'
import { Banner, Button, IconButton } from '../../../ui'
import { createBoardStore } from './boardStore.js'
import { joinBoard } from './boardLive.js'
import { createStickyTurns } from './stickyTurn.js'
import {
  SIZES, SIZE_WORDS, normalizeSize, canPullAway, canResize, FALLBACK_BOUNDS, COLLAPSE_MS, boundsFrom, defaultFrame,
  clampFrame, hitZone, hitSizes, isCorner, isEdge, cursorFor, pullDistance, pullScale, pullCloses, resizeFrame,
  collapseTransform, createEscapeStack, boardWords, TRASH_WORDS, trashWords, whoKey, keepLeaving, doneLeaving, leavingOf,
  dropLeaving,
} from './boardPanelState.js'

const BoardCanvas = lazy(() => import('./BoardCanvas.jsx'))

const SIZE_ICONS = { framed: Shrink, filled: Expand, maximised: Maximize2 }
export const BACK_WORDS = 'Back to the map'
export const GONE_WORDS = 'You cannot see this board any more, so it was closed.'
export const LIVE_FAILED_WORDS = 'Could not reach the others on this board just now. Your changes still save.'
// The channel that brings the others' changes dropped and has not come back for a moment (boardLive's `link`).
export const LIVE_DOWN_WORDS = 'Not connected to the others on this board just now. WILSON keeps trying.'
const LINK_GRACE_MS = 4000

// Until the live channels are joined (or if they cannot be), the canvas is handed one that sends and hears nothing.
const NO_LIVE = Object.freeze({
  sendPointer() {}, sendDrag() {}, cursors: () => new Map(), people: () => [], subscribe: () => () => {},
  stats: () => ({ sent: 0, received: 0 }), leave() {},
})

// A board closed while its last changes could not reach the server: its store keeps trying a while (boardStore's
// dispose). boardPanelState.js holds those closes by board id (keepLeaving, leavingOf, doneLeaving, dropLeaving), so
// the same board opened again sends them first and then reads, and another person or company lets them go at once,
// here when a board is open and from the page when none is.

const newSessionId = () => globalThis.crypto?.randomUUID?.() ?? `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

// A kit layer outside the board that is on show (a dialog, a drawer) answers Escape before the board does.
function layerAbove(panel) {
  if (typeof document === 'undefined') return false
  for (const el of document.querySelectorAll('.ui-dialog, .ui-drawer')) {
    if (panel?.contains(el)) continue
    if (typeof el.checkVisibility !== 'function' || el.checkVisibility()) return true
  }
  return false
}

// The canvas that could not be drawn (its chunk did not load, or it failed) says so, and the panel still closes.
class CanvasBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() {}
  render() {
    if (this.state.failed) {
      return (
        <Banner tone="danger" data-moth-board-canvas-failed>
          The board could not be drawn just now.{' '}
          <Button variant="ghost" size="sm" onClick={() => this.setState({ failed: false })}>Try again</Button>
        </Banner>
      )
    }
    return this.props.children
  }
}

// Who else has this board open (boardLive's presence, which was kept and never shown before the board was seen
// running): a name each, beside its colour, never an email. Nobody else here: nothing is drawn.
const PEOPLE_SHOWN = 4
function PeopleHere({ live }) {
  const [people, setPeople] = useState([])
  useEffect(() => {
    const read = () => setPeople(live?.people?.() ?? [])
    read()
    return live?.subscribe?.((evt) => { if (evt?.type === 'people') read() }) ?? undefined
  }, [live])
  if (!people.length) return null
  const shown = people.slice(0, PEOPLE_SHOWN)
  const more = people.slice(PEOPLE_SHOWN)
  return (
    <ul className="moth-board-people" aria-label="Also on this board" data-moth-board-people>
      {shown.map((p) => (
        <li key={p.id} title={p.label}>
          <span className="moth-board-person-dot" style={{ backgroundColor: p.colour }} aria-hidden="true" />
          <span className="moth-board-person-name">{p.label}</span>
        </li>
      ))}
      {more.length > 0 && <li title={more.map((p) => p.label).join(', ')}>+{more.length}</li>}
    </ul>
  )
}

export function BoardPanel({
  board, adapter, me, companyId = null, initialSize = 'framed', onClose, origin = null, inputMode = 'mouse',
  reducedMotion = false, onSize,
}) {
  const [size, setSizeState] = useState(() => normalizeSize(initialSize))
  const layerRef = useRef(null)
  const panelRef = useRef(null)
  const [bounds, setBounds] = useState(() => ({ ...FALLBACK_BOUNDS }))
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds
  // The person's own frame, once they have resized it; until then the frame the space gives.
  const [frame, setFrame] = useState(null)
  const [gesture, setGesture] = useState(null) // { kind: 'pull' | 'resize', zone, distance }
  const [hoverZone, setHoverZone] = useState(null)
  const [collapsing, setCollapsing] = useState(false)
  const [status, setStatus] = useState({ phase: 'loading', words: '' })
  const [parts, setParts] = useState(null) // { store, turns, live }
  const [liveWords, setLiveWords] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [, setTick] = useState(0)
  const escape = useMemo(() => createEscapeStack(), [])

  const closedRef = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onSizeRef = useRef(onSize)
  onSizeRef.current = onSize
  const meRef = useRef(me)
  meRef.current = me
  // Who it was opened for, and who it is for now (read when the board's parts are let go).
  const who = whoKey(me, companyId)
  const whoAtOpen = useRef(who)
  const whoRef = useRef(who)
  whoRef.current = who
  const collapseTimer = useRef(null)
  const gestureEnd = useRef(null)
  // Put in the trash: null, or the question asked in the panel { busy, words }.
  const [trash, setTrash] = useState(null)
  const trashRef = useRef(trash)
  trashRef.current = trash
  const askId = useId()
  const keepRef = useRef(null)

  const finish = useCallback((result) => {
    if (closedRef.current) return
    closedRef.current = true
    onCloseRef.current?.(result)
  }, [])

  const rect = frame ? clampFrame(frame, bounds) : defaultFrame(bounds)
  const rectRef = useRef(rect)
  rectRef.current = rect

  // ── The space the frame lives in ─────────────────────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = layerRef.current
    if (!el) return undefined
    const measure = () => setBounds((was) => {
      const b = boundsFrom(el.getBoundingClientRect())
      return was.w === b.w && was.h === b.h ? was : b
    })
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { onSizeRef.current?.(size) }, [size])
  useEffect(() => { panelRef.current?.focus?.({ preventScroll: true }) }, [])
  useEffect(() => () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    gestureEnd.current?.()
  }, [])

  // ── The board's store, turns and live channels: made on open, let go on close ──────────────────────────────
  useEffect(() => {
    dropLeaving(who)
    // Another person, another company, or signed out: the last one's parts were let go by the cleanup below, and
    // nothing is made again for the new one. Back to the map.
    if (who !== whoAtOpen.current) {
      setParts(null)
      setTrash(null)
      setStatus({ phase: 'left', words: '' })
      finish({ how: 'left' })
      return undefined
    }
    let alive = true
    let joined = null
    let off = null
    let offLink = null
    let linkTimer = null
    const store = createBoardStore({ adapter, boardId: board.id })
    // The canvas hears the turns itself (turns.subscribe): nothing the panel draws changes with a glow.
    const turns = createStickyTurns({ adapter, boardId: board.id, sessionId: newSessionId() })
    setStatus({ phase: 'loading', words: '' })
    setParts(null)
    setLiveWords('')
    ;(async () => {
      // This board's last close still trying: it is sent once more now, so the read below has it.
      const earlier = leavingOf(board.id)
      if (earlier) {
        try { await earlier.store.flush?.() } catch { /* it goes as the server has it */ }
        if (!alive) return
      }
      try {
        await store.load()
      } catch (err) {
        if (alive) setStatus({ phase: 'failed', words: boardWords(err) })
        return
      }
      if (!alive) return
      // Only what the panel shows is followed here (its name, whether it may be changed): the canvas follows the
      // drawing and says the store's notices itself, so a drag does not draw the panel again on every frame.
      let seen = store.getBoard?.() ?? null
      off = store.subscribe?.(() => {
        if (!alive) return
        const now = store.getBoard?.() ?? null
        if (now?.title !== seen?.title || now?.can_write !== seen?.can_write) { seen = now; setTick((t) => t + 1) }
      }) ?? null
      setParts({ store, turns, live: null })
      setStatus({ phase: 'ready', words: '' })
      Promise.resolve().then(() => turns.refresh?.()).catch(() => {})
      try {
        const session = await joinBoard({
          adapter, boardId: board.id, me: meRef.current, store, turns,
          onClosed: (words) => { if (alive) finish({ how: 'gone', words: words || GONE_WORDS }) },
        })
        if (!alive) { session?.leave?.(); return }
        joined = session
        // The others' changes stopped arriving (a network gone, a channel that will not join): said once it has
        // lasted a moment, and unsaid when the channel is back. A blink while the channels are renamed says nothing.
        offLink = session?.subscribe?.((evt) => {
          if (!alive || evt?.type !== 'link') return
          if (linkTimer) { clearTimeout(linkTimer); linkTimer = null }
          if (evt.up) setLiveWords('')
          else linkTimer = setTimeout(() => { linkTimer = null; if (alive) setLiveWords(LIVE_DOWN_WORDS) }, LINK_GRACE_MS)
        }) ?? null
        setParts({ store, turns, live: session })
      } catch {
        if (alive) setLiveWords(LIVE_FAILED_WORDS)
      }
    })()
    return () => {
      alive = false
      if (linkTimer) clearTimeout(linkTimer)
      try { off?.() } catch { /* already gone */ }
      try { offLink?.() } catch { /* already gone */ }
      try { joined?.leave?.() } catch { /* already gone */ }
      try { turns.dispose?.() } catch { /* already gone */ }
      if (whoRef.current !== who) {
        // Someone else now: let go at once, and ask nothing more of the board as the last one. What was waiting is
        // dropped, not saved: it would go out under the next account.
        try { store.dispose?.({ save: false }) } catch { /* already gone */ }
        dropLeaving(whoRef.current)
        return
      }
      // What is waiting is saved as the store is let go, and tried again a while if it cannot reach the server.
      const mine = { store, who }
      keepLeaving(board.id, mine)
      Promise.resolve().then(() => store.flush?.()).catch(() => {})
        .then(() => { try { return store.dispose?.() } catch { return undefined } })
        .catch(() => {})
        .finally(() => { doneLeaving(board.id, mine) })
    }
  }, [adapter, board.id, attempt, finish, who])

  // The person's name can arrive after the board was joined (the company's people load in their own time): the
  // others on the board are told then, not left with "Someone".
  const liveNow = parts?.live ?? null
  const myLabel = me?.label
  useEffect(() => { liveNow?.setLabel?.(myLabel) }, [liveNow, myLabel])

  // ── Put in the trash: asked in the panel, then the board's own folder goes ─────────────────────────────────
  const asking = trash !== null
  useEffect(() => {
    if (!asking) return undefined
    keepRef.current?.focus?.({ preventScroll: true })
    // Escape while asking is Keep it (and, while it goes, nothing: the answer is on its way).
    return escape.push(() => { if (!trashRef.current?.busy) setTrash(null); return true })
  }, [asking, escape])
  const keepBoard = () => {
    if (trashRef.current?.busy) return
    setTrash(null)
    panelRef.current?.focus?.({ preventScroll: true })
  }
  const putInTrash = async () => {
    const asked = trashRef.current
    const folderId = parts?.store?.getBoard?.()?.folder_id ?? board.folder_id
    if (!asked || asked.busy || !folderId || closedRef.current) return
    // Busy at once, before the next draw: a second press in the same moment asks nothing more.
    trashRef.current = { busy: true, words: '' }
    setTrash(trashRef.current)
    // Its last changes reach the board first, so the board that comes back is the one that went.
    try { await parts?.store?.flush?.() } catch { /* it goes as the server has it */ }
    try {
      await adapter.trashFolders([String(folderId)])
    } catch (err) {
      if (!closedRef.current) setTrash({ busy: false, words: trashWords(err) })
      return
    }
    finish({ how: 'trashed', words: TRASH_WORDS.done })
  }

  // ── Escape: the stack first, then straight back to the map ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || closedRef.current) return
      if (layerAbove(panelRef.current)) return
      e.preventDefault()
      if (escape.handle(e)) return
      finish({ how: 'escape' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [escape, finish])

  const setSize = (next) => {
    gestureEnd.current?.(true)
    setSizeState(normalizeSize(next))
  }

  // Back into its dot: the frame shrinks toward it, then the panel closes. Without motion, at once.
  const collapse = useCallback(() => {
    setCollapsing(true)
    if (reducedMotion) { finish({ how: 'pull' }); return }
    collapseTimer.current = setTimeout(() => { collapseTimer.current = null; finish({ how: 'pull' }) }, COLLAPSE_MS)
  }, [reducedMotion, finish])

  // ── The frame's edges and corners ────────────────────────────────────────────────────────────────────────────
  const localPoint = (e) => {
    const lr = layerRef.current?.getBoundingClientRect?.()
    return { x: e.clientX - (lr?.left || 0), y: e.clientY - (lr?.top || 0) }
  }
  const zoneAt = (e) => {
    // Only the frame's own band: a press inside is the board's.
    if (e.target !== e.currentTarget && !e.target?.closest?.('[data-moth-board-grip]')) return null
    const p = localPoint(e)
    return hitZone(rectRef.current, p.x, p.y, hitSizes(inputMode))
  }
  const onPointerDown = (e) => {
    if (collapsing || gestureEnd.current) return
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return
    const zone = zoneAt(e)
    const kind = isCorner(zone) && canResize(size) ? 'resize' : isEdge(zone) && canPullAway(size) ? 'pull' : null
    if (!kind) return
    e.preventDefault()
    e.stopPropagation()
    const g = { kind, zone, pointerId: e.pointerId, start: localPoint(e), startRect: rectRef.current, startFrame: frame, distance: 0 }
    setGesture({ kind, zone, distance: 0 })
    const same = (ev) => g.pointerId === undefined || ev.pointerId === undefined || ev.pointerId === g.pointerId
    const move = (ev) => {
      if (!same(ev)) return
      const at = localPoint(ev)
      if (kind === 'pull') {
        g.distance = pullDistance(zone, g.start, at)
        setGesture({ kind, zone, distance: g.distance })
      } else {
        setFrame(resizeFrame(g.startRect, zone, at.x - g.start.x, at.y - g.start.y, boundsRef.current))
      }
    }
    // Ended: let go (a pull far enough closes), cancelled (Escape, or the pointer lost: the frame as it was).
    let popEscape = () => {}
    const end = (cancelled = false) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', lost)
      popEscape()
      gestureEnd.current = null
      setGesture(null)
      if (cancelled && kind === 'resize') setFrame(g.startFrame)
    }
    const up = (ev) => {
      if (!same(ev)) return
      end(false)
      if (kind === 'pull' && pullCloses(g.distance)) collapse()
    }
    const lost = (ev) => { if (same(ev)) end(true) }
    popEscape = escape.push(() => { end(true); return true })
    gestureEnd.current = end
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', lost)
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* not every pointer can be captured */ }
  }
  const onPointerMove = (e) => {
    if (gesture || (!canPullAway(size) && !canResize(size))) return
    const zone = zoneAt(e)
    const z = (isCorner(zone) && canResize(size)) || (isEdge(zone) && canPullAway(size)) ? zone : null
    if (z !== hoverZone) setHoverZone(z)
  }

  const framed = size === 'framed'
  const pulling = gesture?.kind === 'pull'
  const willClose = pulling && pullCloses(gesture.distance)
  const style = framed
    ? {
      left: rect.x, top: rect.y, width: rect.w, height: rect.h,
      transform: collapsing ? collapseTransform(rect, origin) : pulling ? `scale(${pullScale(gesture.distance).toFixed(4)})` : undefined,
      cursor: gesture ? (pulling ? 'grabbing' : cursorFor(gesture.zone)) : cursorFor(hoverZone) || undefined,
    }
    : undefined
  const info = parts?.store?.getBoard?.() ?? null
  const title = info?.title || board.title || 'Board'
  const canWrite = info?.can_write === true
  // Only someone who may change the board is offered the trash; the server still decides.
  const mayTrash = canWrite && status.phase === 'ready' && typeof adapter?.trashFolders === 'function'
    && (info?.folder_id ?? board.folder_id) != null
  // No longer allowed while asking (the board became look-only): the question goes, unless its answer is on its way.
  useEffect(() => { if (!mayTrash && !trashRef.current?.busy) setTrash(null) }, [mayTrash])

  return (
    <div className="moth-board-layer" ref={layerRef} data-size={size} data-moth-board-layer>
      {framed && <div className="moth-board-scrim" aria-hidden="true" data-moth-board-scrim />}
      <section
        ref={panelRef}
        className="moth-board"
        role="region"
        aria-label={`Board: ${title}`}
        tabIndex={-1}
        data-moth-board={board.id}
        data-size={size}
        data-pulling={pulling ? 'true' : undefined}
        data-resizing={gesture?.kind === 'resize' ? 'true' : undefined}
        data-will-close={willClose ? 'true' : undefined}
        data-collapsing={collapsing ? 'true' : undefined}
        data-calm={reducedMotion ? 'true' : undefined}
        style={style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => { if (!gesture && hoverZone) setHoverZone(null) }}
      >
        <header className="moth-board-head">
          <span className="moth-board-title" title={title}>{title}</span>
          <PeopleHere live={parts?.live ?? null} />
          {/* A board that may only be looked at is said by the canvas, which is told canWrite. */}
          <div className="moth-board-sizes" role="group" aria-label="Board size">
            {SIZES.map((s) => (
              <IconButton key={s} size="sm" Icon={SIZE_ICONS[s]} title={SIZE_WORDS[s]} active={size === s} aria-pressed={size === s}
                onClick={() => setSize(s)} data-moth-board-size={s} />
            ))}
          </div>
          {mayTrash && (
            <IconButton size="sm" Icon={Trash2} title={TRASH_WORDS.action} active={asking} aria-pressed={asking}
              onClick={() => { if (!asking) setTrash({ busy: false, words: '' }) }} data-moth-board-trash />
          )}
          <Button size="sm" variant="ghost" Icon={ArrowLeft} onClick={() => finish({ how: 'button' })} title={`${BACK_WORDS} (Escape)`} data-moth-board-back>
            {BACK_WORDS}
          </Button>
        </header>
        {liveWords && (
          <div className="moth-board-notes">
            <p className="moth-quiet" data-moth-board-live-failed>{liveWords}</p>
          </div>
        )}
        <div className="moth-board-body">
          {asking && (
            <div className="moth-board-ask" role="alertdialog" aria-labelledby={askId} data-moth-board-trash-ask>
              <p id={askId} className="moth-board-ask-question">{TRASH_WORDS.question}</p>
              {trash.words && <Banner tone="danger" data-moth-board-trash-error>{trash.words}</Banner>}
              <div className="moth-board-ask-actions">
                <Button ref={keepRef} size="sm" variant="ghost" onClick={keepBoard} disabled={trash.busy} data-moth-board-trash-keep>
                  {TRASH_WORDS.no}
                </Button>
                <Button size="sm" variant="danger" onClick={putInTrash} loading={trash.busy} loadingLabel={TRASH_WORDS.busy} data-moth-board-trash-yes>
                  {TRASH_WORDS.yes}
                </Button>
              </div>
            </div>
          )}
          {status.phase === 'loading' && <p className="moth-quiet moth-board-wait">Opening the board…</p>}
          {status.phase === 'failed' && (
            <Banner tone="danger" data-moth-board-failed>
              {status.words}{' '}
              <Button variant="ghost" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
            </Banner>
          )}
          {status.phase === 'ready' && parts && (
            <CanvasBoundary>
              <Suspense fallback={<p className="moth-quiet moth-board-wait">Opening the board…</p>}>
                <BoardCanvas
                  store={parts.store}
                  live={parts.live || NO_LIVE}
                  turns={parts.turns}
                  adapter={adapter}
                  canWrite={canWrite}
                  inputMode={inputMode}
                  escape={escape}
                />
              </Suspense>
            </CanvasBoundary>
          )}
        </div>
        {framed && (
          <>
            {['nw', 'ne', 'sw', 'se'].map((c) => <span key={c} className="moth-board-grip" data-corner={c} data-moth-board-grip aria-hidden="true" />)}
            {willClose && <span className="moth-board-pull-word" aria-live="polite">Let go to close</span>}
          </>
        )}
      </section>
    </div>
  )
}

export default BoardPanel
