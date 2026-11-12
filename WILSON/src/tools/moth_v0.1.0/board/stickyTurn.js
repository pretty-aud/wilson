// stickyTurn.js — MO4 (Session 4): whose turn it is to write in each sticky (0133's soft locks). Pure JS: no React.
//
// Her ruling: while someone types in a sticky it shows their name and a soft glow, and nobody else can edit it until
// they click away; the lock lets go on its own if they disconnect. So: a sticky's editor asks for the turn when it
// takes focus (begin), keeps it every ten seconds while it has it (the server's turn lasts thirty), saves through
// the turn's number, and lets go on blur and on close (end, dispose). A turn someone else holds is refused with
// their name, for the glow. The glow of every sticky comes from the board channel's `sticky` messages and from
// sticky_status, each with when it ends, so a glow nobody renews fades by itself.
//
// A turn that ended while the editor was open (the computer slept, the network went) is said, and the words stay in
// the editor: save answers { ok: false, words } and nothing is lost from the screen. The last save before a blur
// reaches the file before the turn is let go.
import { wordsOf } from './boardStore.js'

const RENEW_MS = 10000
const TURN_MS = 30000
const ECHO_MS = 3000

export const TURN_WORDS = Object.freeze({
  ended: 'Your turn in this sticky ended, so your words were not saved. They are still here.',
  moved: 'This sticky changed while you were writing, so your words were not saved. They are still here.',
  notSaved: 'Your words could not be saved just now. They are still here.',
  notOpened: 'This sticky could not be opened for writing just now.',
})

const SESSION = /^[A-Za-z0-9_-]{8,64}$/
const newSession = () => globalThis.crypto.randomUUID()

/**
 * onChange, and every subscriber, hears { type: 'glow', elementId? } (a glow came, went or moved), { type: 'ended',
 * elementId, words } (this window's turn ended) and { type: 'body', elementId, mine } (a sticky's words were saved:
 * read them again at once unless they are this window's own). `subscribe(fn)` returns its unsubscribe; the canvas
 * subscribes, so another person's words show the moment they are saved.
 */
export function createStickyTurns({ adapter, boardId, sessionId, onChange = () => {}, now = Date.now,
  target = globalThis.window } = {}) {
  const session = typeof sessionId === 'string' && SESSION.test(sessionId) ? sessionId : newSession()
  const held = new Map()     // element id -> { generation, endsAt, claimedAt, timer, renewing }
  const wanted = new Set()   // element ids whose editor has focus
  const claims = new Map()   // element id -> a begin on its way
  const glows = new Map()    // element id -> { holderLabel, endsAt, mine }
  const saves = new Map()    // element id -> { running, queued }
  const listeners = new Set()
  let expiryTimer = null
  let disposed = false

  const tell = (event) => {
    if (disposed) return
    try { onChange(event) } catch { /* the canvas's own */ }
    // A copy: a listener that unsubscribes (or subscribes another) while hearing does not skip one.
    for (const fn of [...listeners]) {
      try { fn(event) } catch { /* a listener's fault stays its own */ }
    }
  }
  function subscribe(fn) {
    if (typeof fn !== 'function' || disposed) return () => {}
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }

  // ── Glows ─────────────────────────────────────────────────────────────────────────────────────────────────────
  function scheduleExpiry() {
    if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null }
    if (disposed) return
    let soonest = Infinity
    for (const [id, g] of glows) if (!held.has(id) && g.endsAt < soonest) soonest = g.endsAt
    if (soonest === Infinity) return
    expiryTimer = setTimeout(() => {
      expiryTimer = null
      const t = now()
      let gone = false
      for (const [id, g] of glows) if (!held.has(id) && g.endsAt <= t) { glows.delete(id); gone = true }
      scheduleExpiry()
      if (gone) tell({ type: 'glow' })
    }, Math.max(0, soonest - now()))
  }
  function setGlow(id, glow) {
    glows.set(id, glow)
    scheduleExpiry()
    tell({ type: 'glow', elementId: id })
  }
  function dropGlow(id) {
    if (!glows.delete(id)) return
    scheduleExpiry()
    tell({ type: 'glow', elementId: id })
  }

  // ── This window's turns ───────────────────────────────────────────────────────────────────────────────────────
  function hold(id, generation, endsInMs) {
    const t = now()
    const h = { generation, endsAt: t + (Number(endsInMs) || TURN_MS), claimedAt: t, timer: null, renewing: false }
    h.timer = setInterval(() => { renew(id) }, RENEW_MS)
    held.set(id, h)
    setGlow(id, { holderLabel: glows.get(id)?.holderLabel ?? null, endsAt: h.endsAt, mine: true })
  }
  function letGo(id) {
    const h = held.get(id)
    if (!h) return null
    clearInterval(h.timer)
    held.delete(id)
    return h
  }
  function turnEnded(id, words = TURN_WORDS.ended) {
    if (!letGo(id)) return
    wanted.delete(id)
    if (glows.get(id)?.mine) dropGlow(id)
    tell({ type: 'ended', elementId: id, words })
  }

  async function renew(id) {
    const h = held.get(id)
    if (!h || h.renewing) return
    h.renewing = true
    try {
      const r = await adapter.renewSticky(id, h.generation)
      if (held.get(id) !== h) return
      if (r?.ok) {
        h.endsAt = now() + (Number(r.ends_in_ms) || TURN_MS)
        const g = glows.get(id)
        if (g) glows.set(id, { ...g, endsAt: h.endsAt, mine: true })
      } else {
        turnEnded(id)
      }
    } catch {
      // Not heard: the turn is still ours until its end passes.
      if (held.get(id) === h && now() >= h.endsAt) turnEnded(id)
    } finally {
      h.renewing = false
    }
  }

  async function begin(elementId) {
    if (disposed || !elementId) return { granted: false, holderLabel: null }
    wanted.add(elementId)
    if (held.has(elementId)) return { granted: true, holderLabel: null }
    if (claims.has(elementId)) return claims.get(elementId)
    const claim = (async () => {
      let r
      try {
        r = await adapter.claimSticky(elementId, session)
      } catch (err) {
        wanted.delete(elementId)
        return { granted: false, holderLabel: null, words: wordsOf(err, TURN_WORDS.notOpened) }
      }
      if (r?.granted) {
        if (disposed || !wanted.has(elementId)) {
          // Blurred before the answer came: the turn goes straight back.
          try { await adapter.releaseSticky(elementId, r.generation) } catch { /* it ends on its own */ }
          return { granted: false, holderLabel: null }
        }
        hold(elementId, r.generation, r.ends_in_ms)
        return { granted: true, holderLabel: null }
      }
      wanted.delete(elementId)
      const holderLabel = r?.holder_label ?? null
      setGlow(elementId, { holderLabel, endsAt: now() + (Number(r?.ends_in_ms) || 0), mine: false })
      return { granted: false, holderLabel }
    })().finally(() => { claims.delete(elementId) })
    claims.set(elementId, claim)
    return claim
  }

  async function saveNow(element, text) {
    const id = element.id
    const h = held.get(id)
    if (!h) return { ok: false, words: TURN_WORDS.ended, reason: 'turn_ended' }
    let r
    try {
      r = await adapter.saveStickyText(element, h.generation, text)
    } catch (err) {
      return { ok: false, words: wordsOf(err, TURN_WORDS.notSaved) }
    }
    if (r?.ok) {
      // The server's publish renewed the turn too.
      if (held.get(id) === h) h.endsAt = now() + TURN_MS
      return { ok: true, words: null }
    }
    if (r?.reason === 'turn_ended') {
      const words = r.words || TURN_WORDS.ended
      if (held.get(id) === h) turnEnded(id, words)
      return { ok: false, words, reason: 'turn_ended' }
    }
    return { ok: false, words: r?.words || TURN_WORDS.moved, reason: r?.reason ?? null }
  }

  // One save at a time a sticky, in order; a save asked for while another runs waits, and only the latest waits.
  function save(element, text) {
    const id = element?.id
    if (!id) return Promise.resolve({ ok: false, words: TURN_WORDS.ended, reason: 'turn_ended' })
    let lane = saves.get(id)
    if (!lane) { lane = { running: null, queued: null }; saves.set(id, lane) }
    if (lane.queued) {
      lane.queued.element = element
      lane.queued.text = text
      return lane.queued.promise
    }
    const job = { element, text }
    job.promise = new Promise((resolve) => { job.resolve = resolve })
    lane.queued = job
    if (!lane.running) pump(id, lane)
    return job.promise
  }
  async function pump(id, lane) {
    while (lane.queued) {
      const job = lane.queued
      lane.queued = null
      lane.running = job.promise
      job.resolve(await saveNow(job.element, job.text))
    }
    lane.running = null
    if (saves.get(id) === lane) saves.delete(id)
  }
  async function settled(id) {
    for (let lane = saves.get(id); lane; lane = saves.get(id)) {
      await (lane.queued?.promise ?? lane.running)
    }
  }

  async function end(elementId) {
    if (!elementId) return
    wanted.delete(elementId)
    const claim = claims.get(elementId)
    if (claim) { try { await claim } catch { /* answered below */ } }
    await settled(elementId)
    if (wanted.has(elementId)) return
    const h = letGo(elementId)
    if (!h) return
    if (glows.get(elementId)?.mine) dropGlow(elementId)
    try { await adapter.releaseSticky(elementId, h.generation) } catch { /* it ends on its own in 30 seconds */ }
  }

  function glow() {
    const t = now()
    const out = new Map()
    for (const [id, g] of glows) {
      const mine = held.has(id)
      if (mine || g.endsAt > t) out.set(id, { holderLabel: g.holderLabel, endsAt: mine ? held.get(id).endsAt : g.endsAt, mine })
    }
    return out
  }

  /** A `sticky` message from the board's channel: { board, op: lock | renew | unlock | body, element, ... }. */
  function applyMessage(p) {
    if (!p || disposed || (p.board && p.board !== boardId) || !p.element) return
    const id = String(p.element)
    const h = held.get(id)
    if (p.op === 'lock' || p.op === 'renew') {
      // A claim heard while this window holds the turn, long after its own claim, is likely someone else's: kept as
      // theirs, and the server asked at once whether the turn is still ours (a yes makes the glow ours again).
      const late = !!h && p.op === 'lock' && now() - h.claimedAt > ECHO_MS
      setGlow(id, { holderLabel: p.holder_label ?? glows.get(id)?.holderLabel ?? null,
        endsAt: now() + (Number(p.ends_in_ms) || TURN_MS), mine: !!h && !late })
      if (late) renew(id)
    } else if (p.op === 'unlock') {
      if (!h) dropGlow(id)
    } else if (p.op === 'body') {
      tell({ type: 'body', elementId: id, mine: !!h })
    }
  }

  async function refresh() {
    let rows
    try {
      rows = await adapter.stickyStatus(boardId)
    } catch {
      return
    }
    if (disposed) return
    const t = now()
    const next = new Map()
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r?.element) continue
      const id = String(r.element)
      next.set(id, { holderLabel: r.holder_label ?? null, endsAt: t + (Number(r.ends_in_ms) || 0), mine: held.has(id) })
    }
    for (const [id, h] of held) {
      if (!next.has(id)) next.set(id, { holderLabel: glows.get(id)?.holderLabel ?? null, endsAt: h.endsAt, mine: true })
    }
    glows.clear()
    for (const [id, g] of next) glows.set(id, g)
    scheduleExpiry()
    tell({ type: 'glow' })
  }

  // Every turn this window holds, let go (its last words first).
  function releaseAll() {
    wanted.clear()
    return Promise.allSettled([...held.keys()].map((id) => end(id)))
  }
  const onHide = () => { releaseAll() }
  target?.addEventListener?.('pagehide', onHide)

  function dispose() {
    target?.removeEventListener?.('pagehide', onHide)
    const done = releaseAll()
    disposed = true
    listeners.clear()
    if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null }
    return done
  }

  return { begin, save, end, glow, applyMessage, refresh, subscribe, dispose, sessionId: session }
}
