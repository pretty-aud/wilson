// boardLive.js — MO4 (Session 4): one window's place on a board's two live channels (0132). Pure JS: no React.
//
// The database's channel (`topic`) brings others' saves to the store and the stickies' turns to stickyTurn; this
// window only listens there. The live channel (`live_topic`) carries what the database never sees: where each
// person's pointer is, a drag on its way, and who is here (presence: a name and a colour, never an email).
//
// A pointer and a drag are each sent at most ten times a second and only while they move: a still pointer sends
// nothing, and the last place it stopped is always sent. What arrives is smoothed for drawing: each new place is
// reached over a tenth of a second from where the drawing was, so a cursor glides instead of jumping. Our own
// messages never come back to us (the adapter joins with `self: false`, and anything carrying our id is dropped).
//
// AUDIENCE means the channels were renamed (a board to the trash, to another project, a member gone): the names are
// asked again and joined, and the store and the turns read again what the old names carried meanwhile. A refusal
// then means this person may no longer read the board: it closes with words. A page hidden for good leaves; the
// panel leaves on close, on sign-out and on a change of company (its `me` changes, and it calls leave()).
//
// The channels say when they join and when they fail (the adapter's onStatus). Whenever the database's channel has
// joined, the first time and again after a network gone and back, the board and the turns are read again: a save
// made before the join, or while this window heard nothing, was never told to it. A channel that cannot join has the
// names asked again: they may have changed meanwhile (an AUDIENCE this window missed), or the board may be closed to
// this person, which closes it with words. Subscribers hear { type: 'link', up } as the database's channel goes
// and comes.
import { isRefusal, wordsOf } from './boardStore.js'

const SEND_EVERY_MS = 100
const SMOOTH_MS = 100
const CURSOR_GONE_MS = 5000
const DRAG_GONE_MS = 2000
const DRAG_HUSH_MS = 600
const SWEEP_MS = 1000
const RETRY_MS = [2000, 5000, 10000, 30000]
// A channel that keeps failing asks the names again no more often than this.
const CHECK_EVERY_MS = 5000

// Colours that read on a light board and are never the kit's orange, which is the selection's.
const PALETTE = Object.freeze(['#1c7ed6', '#2f9e44', '#c2255c', '#7048e8', '#0c8599', '#5c940d', '#ae3ec9',
  '#1098ad', '#d6336c', '#4263eb'])

export const LIVE_WORDS = Object.freeze({
  gone: 'This board is not open to you any more. It may have gone to the trash or moved.',
  someone: 'Someone',
})

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }

/** A person's colour on a board: the same on every screen, from their id. */
export function personColour(id) {
  return PALETTE[hash(id ?? '') % PALETTE.length]
}

/** A name as a board shows it: short, and never an email (an address becomes "Someone"). */
export function plainLabel(label) {
  const s = String(label ?? '').replace(/\s+/g, ' ').trim()
  return !s || s.includes('@') ? LIVE_WORDS.someone : s.slice(0, 60)
}

const goneWords = (err) => (err?.code === '42501' ? LIVE_WORDS.gone : wordsOf(err, LIVE_WORDS.gone))
const tenth = (v) => Math.round(Number(v) * 10) / 10
const defaultFrame = (fn) => (typeof globalThis.requestAnimationFrame === 'function'
  ? globalThis.requestAnimationFrame(fn)
  : setTimeout(fn, 16))

/**
 * @returns {Promise<{ sendPointer(x, y), sendDrag(elementId, x, y), cursors(): Map, people(): Array,
 *   subscribe(fn): () => void, stats(): { sent, received }, leave() }>}
 * Subscribers hear { type: 'cursors' } (a cursor or a drag moved), { type: 'people' } and { type: 'closed', words }.
 */
export async function joinBoard({ adapter, boardId, me, store, turns, onClosed = () => {}, now = Date.now,
  frame = defaultFrame, target = globalThis.window } = {}) {
  const self = { id: String(me?.id ?? ''), label: plainLabel(me?.label) }
  const meta = { user_id: self.id, label: self.label, colour: personColour(self.id) }
  const counts = { sent: 0, received: 0, sentByEvent: {}, receivedByEvent: {} }
  const listeners = new Set()
  const cursorTracks = new Map()   // user id -> track
  const dragTracks = new Map()     // element id -> track
  const hushed = new Map()         // element id -> until when a late drag message for it is old
  const lanes = new Map()          // 'cursor' | 'drag:<id>' -> what to send next and when
  let present = new Map()          // user id -> { id, label, colour }
  let conn = null
  let topics = null
  let gen = 0
  let closed = false
  let suspended = false
  let rejoining = null
  let retryTimer = null
  let retries = 0
  let framing = false
  let sweepTimer = null
  let linked = false               // the database's channel is joined, as far as this window has been told
  let lastCheck = -Infinity

  const emit = (event) => {
    for (const fn of [...listeners]) {
      try { fn(event) } catch { /* a listener's fault stays its own */ }
    }
  }
  const setLinked = (up) => {
    if (linked === up) return
    linked = up
    emit({ type: 'link', up })
  }
  const tally = (way, event) => {
    counts[way] += 1
    const by = way === 'sent' ? counts.sentByEvent : counts.receivedByEvent
    by[event] = (by[event] ?? 0) + 1
  }
  const forThisBoard = (p) => !p?.board || p.board === boardId
  const quietly = (fn) => { try { return Promise.resolve(fn()).catch(() => {}) } catch { return Promise.resolve() } }

  // ── Receiving ─────────────────────────────────────────────────────────────────────────────────────────────────
  function at(track, t) {
    const k = Math.min(1, Math.max(0, (t - track.t0) / SMOOTH_MS))
    return { x: track.fromX + (track.toX - track.fromX) * k, y: track.fromY + (track.toY - track.fromY) * k }
  }
  function aim(map, key, x, y, t, extra) {
    const track = map.get(key)
    if (!track) { map.set(key, { fromX: x, fromY: y, toX: x, toY: y, t0: t, seen: t, ...extra }); return }
    const p = at(track, t)
    Object.assign(track, { fromX: p.x, fromY: p.y, toX: x, toY: y, t0: t, seen: t, ...extra })
  }
  function animate() {
    if (!sweepTimer) sweepTimer = setInterval(sweep, SWEEP_MS)
    if (framing) return
    framing = true
    frame(tick)
  }
  function tick() {
    framing = false
    if (closed || suspended) return
    const t = now()
    let moving = false
    for (const [id, track] of dragTracks) {
      store?.preview?.(id, at(track, t))
      if (t < track.t0 + SMOOTH_MS) moving = true
    }
    for (const track of cursorTracks.values()) if (t < track.t0 + SMOOTH_MS) moving = true
    emit({ type: 'cursors' })
    if (moving) animate()
  }
  function endDrag(id, hush) {
    if (!id || !dragTracks.has(id)) return
    dragTracks.delete(id)
    store?.preview?.(id, null)
    if (hush) hushed.set(id, now() + DRAG_HUSH_MS)
  }
  function sweep() {
    const t = now()
    let changed = false
    for (const [user, track] of cursorTracks) if (t - track.seen > CURSOR_GONE_MS) { cursorTracks.delete(user); changed = true }
    for (const [id, track] of dragTracks) if (t - track.seen > DRAG_GONE_MS) { endDrag(id, false); changed = true }
    for (const [id, until] of hushed) if (until <= t) hushed.delete(id)
    if (!cursorTracks.size && !dragTracks.size && !hushed.size && sweepTimer) { clearInterval(sweepTimer); sweepTimer = null }
    if (changed) emit({ type: 'cursors' })
  }

  function receiveLive(event, p) {
    if (!p || typeof p !== 'object' || !forThisBoard(p)) return
    const user = p.user != null ? String(p.user) : ''
    if (!user || user === self.id) return
    const x = Number(p.x)
    const y = Number(p.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const t = now()
    if (event === 'cursor') {
      aim(cursorTracks, user, x, y, t, { label: plainLabel(p.label ?? present.get(user)?.label) })
    } else if (event === 'drag') {
      const id = p.element != null ? String(p.element) : ''
      if (!id || (hushed.get(id) ?? 0) > t) return
      aim(dragTracks, id, x, y, t, { user })
    } else {
      return
    }
    animate()
  }

  function setPresence(state) {
    const metas = Array.isArray(state) ? state.flat(2)
      : state && typeof state === 'object' ? Object.values(state).flat(2) : []
    const next = new Map()
    for (const m of metas) {
      const id = m?.user_id ?? m?.id ?? m?.user
      if (id == null) continue
      const key = String(id)
      if (key === self.id || next.has(key)) continue
      next.set(key, { id: key, label: plainLabel(m.label), colour: personColour(key) })
    }
    for (const id of present.keys()) if (!next.has(id)) cursorTracks.delete(id)
    present = next
    emit({ type: 'people' })
  }

  function handlersFor(g) {
    const current = () => g === gen && !closed && !suspended
    return {
      onStatus(s) {
        if (!current()) return
        const database = s?.channel !== 'live'
        const status = s?.status
        if (status === 'SUBSCRIBED') {
          if (!database) return
          setLinked(true)
          catchUp()
          return
        }
        if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT' && status !== 'CLOSED') return
        if (database) setLinked(false)
        // Closed by the server, a channel does not join again by itself: it is opened again under the names of now.
        checkNames(status === 'CLOSED')
      },
      onElements(payload) {
        if (!current()) return
        tally('received', 'elements')
        if (!forThisBoard(payload)) return
        quietly(() => store?.applyRemote?.(payload))
        const ids = payload?.op === 'remove' ? (payload.ids ?? []) : (payload?.elements ?? []).map((el) => el?.id)
        for (const id of ids) endDrag(id, true)
      },
      onSticky(payload) {
        if (!current()) return
        tally('received', 'sticky')
        if (forThisBoard(payload)) turns?.applyMessage?.(payload)
      },
      onAudience(payload) {
        if (!current()) return
        tally('received', 'audience')
        if (forThisBoard(payload)) rejoin()
      },
      onLive(a, b) {
        if (!current()) return
        const event = typeof a === 'string' ? a : a?.event
        const payload = typeof a === 'string' ? b : (a?.payload ?? b)
        tally('received', event ?? 'live')
        receiveLive(event, payload)
      },
      onPresence(state) {
        if (!current()) return
        setPresence(state)
      },
    }
  }

  // ── Joining and leaving ───────────────────────────────────────────────────────────────────────────────────────
  function drop() {
    const c = conn
    conn = null
    gen += 1
    for (const lane of lanes.values()) if (lane.timer) clearTimeout(lane.timer)
    lanes.clear()
    if (c) { try { c.leave?.() } catch { /* already down */ } }
    setLinked(false)
  }
  function clearTracks() {
    for (const id of [...dragTracks.keys()]) endDrag(id, false)
    cursorTracks.clear()
    hushed.clear()
    if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null }
  }
  function teardown() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    drop()
    clearTracks()
    target?.removeEventListener?.('pagehide', onHide)
    target?.removeEventListener?.('pageshow', onShow)
  }
  function close(words) {
    if (closed) return
    teardown()
    closed = true
    emit({ type: 'closed', words })
    try { onClosed(words) } catch { /* the panel's own */ }
    listeners.clear()
  }

  async function open(ch) {
    const g = ++gen
    const next = { topic: ch?.topic, live_topic: ch?.live_topic }
    const c = await adapter.openBoardChannels(next, handlersFor(g))
    if (closed || suspended || g !== gen) { try { c?.leave?.() } catch { /* never used */ } return false }
    conn = c
    topics = next
    retries = 0
    // Taken as joined until a channel says otherwise: an adapter with no word on its channels (the dev fixtures'
    // in-page one) is joined as soon as it is opened.
    setLinked(true)
    try { await conn?.track?.({ ...meta }) } catch { /* presence is a nicety; the channels still work */ }
    return true
  }
  // What was said while this window could not hear it (new names being made, a channel not yet joined, a network
  // gone), read again. One read at a time; asked again while one is on its way, one more follows it, since the one
  // on its way may have read before the channel that asked had joined.
  let catching = null
  let catchAgain = false
  function catchUp() {
    if (catching) { catchAgain = true; return catching }
    catching = Promise.allSettled([quietly(() => store?.load?.()), quietly(() => turns?.refresh?.())]).then(() => {
      catching = null
      const again = catchAgain && !closed && !suspended
      catchAgain = false
      return again ? catchUp() : undefined
    })
    return catching
  }

  function failedToJoin(err) {
    if (isRefusal(err)) { close(goneWords(err)); return }
    if (closed || suspended || retryTimer) return
    const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]
    retries += 1
    // Joined again by itself meanwhile (the network came back): the names are only compared, nothing is left.
    retryTimer = setTimeout(() => { retryTimer = null; rejoin(!(conn && linked)) }, wait)
  }

  // A channel failed: the names are asked again, at most once in a while unless it was closed for good.
  function checkNames(force = false) {
    if (closed || suspended || rejoining || retryTimer) return
    const t = now()
    if (!force && t - lastCheck < CHECK_EVERY_MS) return
    lastCheck = t
    rejoin(force)
  }

  function rejoin(force = false) {
    if (closed || suspended) return Promise.resolve()
    if (rejoining) return rejoining
    rejoining = (async () => {
      let ch
      try {
        ch = await adapter.boardChannels(boardId)
      } catch (err) {
        failedToJoin(err)
        return
      }
      if (closed || suspended) return
      if (!force && conn && ch?.topic === topics?.topic && ch?.live_topic === topics?.live_topic) return
      drop()
      try {
        if (!(await open(ch))) return
      } catch (err) {
        failedToJoin(err)
        return
      }
      await catchUp()
    })().finally(() => { rejoining = null })
    return rejoining
  }

  // A page hidden for good leaves its channels; one brought back from the browser's cache joins again.
  function onHide() {
    if (closed || suspended) return
    suspended = true
    drop()
    clearTracks()
    emit({ type: 'cursors' })
  }
  function onShow(event) {
    if (closed || !suspended || !event?.persisted) return
    suspended = false
    rejoin(true)
  }
  target?.addEventListener?.('pagehide', onHide)
  target?.addEventListener?.('pageshow', onShow)

  try {
    const ch = await adapter.boardChannels(boardId)
    await open(ch)
  } catch (err) {
    failedToJoin(err)
  }

  // ── Sending ───────────────────────────────────────────────────────────────────────────────────────────────────
  function flushLane(lane) {
    const m = lane.next
    lane.next = null
    if (!m || !conn || closed || suspended) return
    if (lane.prev && lane.prev.x === m.body.x && lane.prev.y === m.body.y) return
    // The adapter answers false before the live channel is joined: not sent, so not counted, and not the last place.
    let went = false
    try {
      went = conn.sendLive(m.event, { board: boardId, user: self.id, label: self.label, ...m.body }) !== false
    } catch { /* a lost cursor is the next one's to correct */ }
    if (!went) return
    lane.last = now()
    lane.prev = { x: m.body.x, y: m.body.y }
    tally('sent', m.event)
  }
  function send(key, event, body) {
    if (closed || suspended || !conn || !Number.isFinite(body.x) || !Number.isFinite(body.y)) return
    let lane = lanes.get(key)
    if (!lane) { lane = { last: -Infinity, timer: null, next: null, prev: null }; lanes.set(key, lane) }
    const still = lane.prev && lane.prev.x === body.x && lane.prev.y === body.y
    if (still && !lane.timer) return
    lane.next = { event, body }
    if (lane.timer) return
    const wait = lane.last + SEND_EVERY_MS - now()
    if (wait <= 0) { flushLane(lane); return }
    lane.timer = setTimeout(() => { lane.timer = null; flushLane(lane) }, wait)
  }

  return {
    sendPointer(x, y) { send('cursor', 'cursor', { x: tenth(x), y: tenth(y) }) },
    sendDrag(elementId, x, y) {
      if (elementId == null || elementId === '') return
      send(`drag:${elementId}`, 'drag', { element: String(elementId), x: tenth(x), y: tenth(y) })
    },
    cursors() {
      const t = now()
      const out = new Map()
      for (const [user, track] of cursorTracks) {
        if (t - track.seen > CURSOR_GONE_MS) continue
        const p = at(track, t)
        out.set(user, { x: p.x, y: p.y, label: track.label, colour: personColour(user) })
      }
      return out
    },
    people: () => [...present.values()].map((p) => ({ ...p })),
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    stats: () => ({ sent: counts.sent, received: counts.received,
      sentByEvent: { ...counts.sentByEvent }, receivedByEvent: { ...counts.receivedByEvent } }),
    leave() {
      if (closed) return
      teardown()
      closed = true
      listeners.clear()
    },
  }
}
