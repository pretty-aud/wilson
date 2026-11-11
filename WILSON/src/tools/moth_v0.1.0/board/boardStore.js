// boardStore.js — MO4 (Session 4): one board's elements as this window draws them, and how they reach the server.
// Pure JS: no React, no Konva. The canvas reads getElements() and listens; the panel makes it and loads it.
//
// The drawing changes at once and the server hears it in batches. Each element is drawn from what the server last
// said of it (its version and all), with this window's own changes laid over it: those being saved, those waiting
// to be, and a drag that has not settled (drawn, never saved, until a later update settles it). At most one save is
// in flight, 150 ms after the last change and a second at most, so a drag is one save when it lets go.
//
// Others' saves arrive as the board channel's `elements` messages (0132). An element is taken only when its
// version is newer than the one held, so a late message never draws an older state over a newer one; this window's
// own unsaved changes stay on top, and are saved after (the last writer wins each element, 0130). A message leaves
// out a placed file and a long drawing's points: those are read again with readBoardElements.
//
// Undo and redo go a step at a time: the changes made in one moment (one run of the page's code: a group moved
// together, a shape and its line) are one step. An undo sends each element's earlier fields with the version this
// window last saved of it (`expect`); one someone else changed since is skipped, said, and drawn as they left it.
//
// A refusal comes back in the server's words and is said; what it refused is read again so the drawing matches the
// server. A save that could not reach the server at all is kept and tried again.

const DEBOUNCE_MS = 150
const MAX_WAIT_MS = 1000
const UNDO_DEPTH = 200
const RETRY_MS = [1000, 2000, 5000, 10000, 30000]

// What board_put_elements reads of an element (file_id is added for a file's kinds; `expect` for undo and redo).
const SENT_KEYS = Object.freeze(['kind', 'shape', 'x', 'y', 'w', 'h', 'rotation', 'z', 'style', 'body', 'points',
  'from_id', 'from_anchor', 'to_id', 'to_anchor'])
// What a change never touches: an element keeps its id, kind and file (fn_board_elements_guard), and the rest is
// the server's.
const FIXED_KEYS = new Set(['id', 'kind', 'file', 'file_id', 'missing', 'version', 'updated_at', 'updated_by',
  'has_file', 'points_omitted'])
const FILE_KINDS = new Set(['sticky', 'media', 'embed'])
const DRAG_KEYS = Object.freeze(['x', 'y', 'w', 'h', 'rotation'])
const DEFAULTS = Object.freeze({ shape: null, x: 0, y: 0, w: 0, h: 0, rotation: 0, body: null, points: null,
  file: null, missing: false, from_id: null, from_anchor: null, to_id: null, to_anchor: null })

export const BOARD_WORDS = Object.freeze({
  readOnly: 'You can look at this board but not change it.',
  conflictOne: 'Someone else changed this since, so it stays as they left it.',
  conflictMany: (n) => `Someone else changed ${n} of these since, so they stay as they left them.`,
  notSaved: 'Your last changes are not saved yet. WILSON will keep trying.',
  refused: 'That change could not be saved.',
})

/** The words a refusal carries, without an adapter's "[supabase] " tag; a P0001's DETAIL when it has one. */
export function wordsOf(err, fallback = '') {
  const raw = err?.words || (err?.code === 'P0001' && (err?.details || err?.detail)) || err?.message || ''
  const words = String(raw).replace(/^\[[^\]]*\]\s*/, '').trim()
  return words || fallback
}

const TRANSIENT_CODES = /^(network|offline|timeout|aborted|fetch|ECONN|ETIMEDOUT|EAI_AGAIN)/i
/** The server said no (an SQL state or an adapter's own code), as against a save that never reached it. */
export function isRefusal(err) {
  const code = err?.code
  return typeof code === 'string' && code !== '' && !TRANSIENT_CODES.test(code)
}

const same = (a, b) => a === b
  || (a != null && b != null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b))
const newId = () => globalThis.crypto.randomUUID()
const versionOf = (el) => Number(el?.version ?? 0)

/**
 * @param {{ adapter: object, boardId: string, now?: () => number, delay?: number }} options
 * Subscribers hear { type: 'change', ids }, { type: 'notice', words } and { type: 'renamed', from, to } (an id the
 * server gave instead of the one asked for).
 */
export function createBoardStore({ adapter, boardId, now = Date.now, delay = DEBOUNCE_MS } = {}) {
  let board = null
  const base = new Map()              // id -> the element as the server last said it
  const previews = new Map()          // id -> { fields }: another person's drag, drawn only
  const inflight = new Map()          // id -> entry being saved
  const pending = new Map()           // id -> entry waiting to be saved: { fields, mode, expect, origin }
  const transient = new Map()         // id -> fields of a change not yet settled (drawn, not saved)
  const transientBefore = new Map()   // id -> those fields as they were before it began
  const removing = new Map()          // id -> { expect, origin, quiet }: a removal waiting to be sent
  const removingInflight = new Map()
  const hidden = new Set()            // removed here, the server not yet answered
  const myVersion = new Map()         // id -> the version this window's own last save of it made
  const tombs = new Map()             // id -> version: our own re-making of a removed element, its echo ignored
  const removeMarks = new Map()       // id -> how many removals of it this window has heard
  const listeners = new Set()
  const undoStack = []
  const redoStack = []
  let openStep = null
  let drawn = new Map()
  let handedOut = false
  let loading = null
  let timer = null
  let firstDirtyAt = null
  let running = null
  let failures = 0
  let saidNotSaved = false
  let saidReadOnly = false
  let closing = false
  // dispose({ save: false }): what was waiting is dropped, and nothing more goes to the adapter, not even what a
  // save already on its way would have sent or read next.
  let dropped = false

  const emit = (event) => {
    if (closing) return
    for (const fn of [...listeners]) {
      try { fn(event) } catch { /* a listener's fault stays its own */ }
    }
  }
  const say = (words) => { if (words) emit({ type: 'notice', words }) }
  const sayConflicts = (n) => { if (n > 0) say(n === 1 ? BOARD_WORDS.conflictOne : BOARD_WORDS.conflictMany(n)) }
  const mark = (id) => removeMarks.get(id) ?? 0
  const hasWork = () => !dropped && (pending.size > 0 || removing.size > 0)

  // ── What is drawn ─────────────────────────────────────────────────────────────────────────────────────────────
  function compute(id, withTransient = true) {
    if (hidden.has(id)) return null
    const b = base.get(id)
    const inf = inflight.get(id)
    const pen = pending.get(id)
    const whole = (inf && inf.mode !== 'patch') || (pen && pen.mode !== 'patch')
    if (!b && !whole) return null
    const el = { ...(b ?? {}) }
    const pv = previews.get(id)
    if (pv) Object.assign(el, pv.fields)
    if (inf) Object.assign(el, inf.fields)
    if (pen) Object.assign(el, pen.fields)
    if (withTransient && transient.has(id)) Object.assign(el, transient.get(id))
    el.id = id
    el.version = b ? versionOf(b) : 0
    return el
  }
  // getElements() hands out the map itself; the next change copies it first, so a reader's map never moves.
  function setDrawn(id, el) {
    if (handedOut) { drawn = new Map(drawn); handedOut = false }
    if (el) drawn.set(id, el)
    else drawn.delete(id)
  }
  function redraw(ids) {
    const list = [...new Set(ids)].filter(Boolean)
    if (!list.length) return
    for (const id of list) setDrawn(id, compute(id))
    emit({ type: 'change', ids: list })
  }

  function writable() {
    if (closing) return false
    if (board?.can_write === false) {
      if (!saidReadOnly) { saidReadOnly = true; say(BOARD_WORDS.readOnly) }
      return false
    }
    return true
  }
  // The version this window's next fenced change is measured against: its own last save, else what it last saw.
  function touch(id) {
    if (!myVersion.has(id) && base.has(id)) myVersion.set(id, versionOf(base.get(id)))
  }
  // A new change of ours, with nothing of ours on its way, is made over what we see now (someone else's save
  // included), so undoing it at once is not taken for a clash. An undo never re-bases: that is the clash it guards.
  function rebase(id) {
    if (base.has(id) && !pending.has(id) && !inflight.has(id)) myVersion.set(id, versionOf(base.get(id)))
    else touch(id)
  }
  function commit(id, entry) {
    const prev = pending.get(id)
    if (!prev) { pending.set(id, entry); return }
    pending.set(id, {
      fields: { ...prev.fields, ...entry.fields },
      mode: entry.mode !== 'patch' ? entry.mode : prev.mode,
      expect: prev.expect || entry.expect,
      origin: entry.origin ?? prev.origin,
    })
  }

  // ── Steps ─────────────────────────────────────────────────────────────────────────────────────────────────────
  function combine(prev, next) {
    if (prev.type === 'update' && next.type === 'update') {
      return { type: 'update', id: prev.id, before: { ...next.before, ...prev.before }, after: { ...prev.after, ...next.after } }
    }
    if (prev.type === 'add' && next.type === 'update') return { type: 'add', id: prev.id, el: { ...prev.el, ...next.after } }
    if (prev.type === 'add' && next.type === 'remove') return null
    if (prev.type === 'update' && next.type === 'remove') return { type: 'remove', id: prev.id, el: { ...next.el, ...prev.before } }
    return next
  }
  function record(change) {
    redoStack.length = 0
    if (!openStep) {
      const step = { changes: new Map() }
      openStep = step
      undoStack.push(step)
      if (undoStack.length > UNDO_DEPTH) undoStack.shift()
      queueMicrotask(() => { if (openStep === step) openStep = null })
    }
    const prev = openStep.changes.get(change.id)
    const next = prev ? combine(prev, change) : change
    if (next) openStep.changes.set(change.id, next)
    else openStep.changes.delete(change.id)
    if (!openStep.changes.size) {
      const i = undoStack.indexOf(openStep)
      if (i >= 0) undoStack.splice(i, 1)
      openStep = null
    }
  }
  function dropFromStep(step, id) {
    if (!step) return
    step.changes.delete(id)
    if (step.changes.size) return
    for (const stack of [undoStack, redoStack]) {
      const i = stack.indexOf(step)
      if (i >= 0) stack.splice(i, 1)
    }
  }

  // ── Saving ────────────────────────────────────────────────────────────────────────────────────────────────────
  function schedule() {
    if (closing) return
    const t = now()
    if (firstDirtyAt == null) firstDirtyAt = t
    const wait = Math.max(0, Math.min(delay, firstDirtyAt + MAX_WAIT_MS - t))
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; if (!running && hasWork()) start() }, wait)
  }
  function start() {
    firstDirtyAt = null
    running = round().then((ok) => {
      running = null
      if (!ok) { retryLater(); return false }
      if (hasWork() && !timer && !closing) start()
      return true
    })
    return running
  }
  function retryLater() {
    if (closing || timer) return
    const wait = RETRY_MS[Math.min(Math.max(failures - 1, 0), RETRY_MS.length - 1)]
    timer = setTimeout(() => { timer = null; if (!running && hasWork()) start() }, wait)
  }
  function failed() {
    failures += 1
    if (!saidNotSaved) { saidNotSaved = true; say(BOARD_WORDS.notSaved) }
  }

  const kindOf = (id, e) => e?.fields?.kind ?? base.get(id)?.kind ?? drawn.get(id)?.kind
  // A line after the shapes it joins, so a new shape is there before the line that names it.
  const connectorsLast = ([a, ea], [b, eb]) => (kindOf(a, ea) === 'connector') - (kindOf(b, eb) === 'connector')

  function wireOf(id, e) {
    const known = base.get(id) ?? drawn.get(id) ?? e.fields
    const kind = kindOf(id, e)
    const out = { id }
    if (kind) out.kind = kind
    if (e.mode === 'patch') {
      for (const k of SENT_KEYS) if (k !== 'kind' && k in e.fields) out[k] = e.fields[k]
      if (e.expect) {
        const v = myVersion.get(id) ?? base.get(id)?.version
        if (v != null) out.expect = Number(v)
      }
    } else {
      for (const k of SENT_KEYS) if (k !== 'kind' && e.fields[k] != null) out[k] = e.fields[k]
      if (e.mode === 'readd') out.expect = 0
    }
    const fileId = e.fields.file?.id ?? e.fields.file_id ?? known?.file?.id ?? known?.file_id
    if (FILE_KINDS.has(kind) && fileId) out.file_id = fileId
    if (kind === 'sticky') delete out.body
    return out
  }

  async function round() {
    // A part of an element the server never had would be made as a fragment: only whole new ones are sent so.
    const puts = [...pending].filter(([id, e]) => e.mode !== 'patch' || base.has(id)).sort(connectorsLast)
    pending.clear()
    const rms = [...removing]
    removing.clear()
    for (const [id, e] of puts) inflight.set(id, e)
    for (const [id, r] of rms) removingInflight.set(id, r)
    const marks = new Map([...puts, ...rms].map(([id]) => [id, mark(id)]))
    let ok = true
    if (puts.length) ok = await savePuts(puts, marks)
    if (rms.length && !dropped) ok = (await saveRemovals(rms)) && ok
    if (ok) { failures = 0; saidNotSaved = false }
    return ok
  }

  function requeue(puts) {
    for (const [id, e] of puts) {
      if (e.mode === 'new' && removing.has(id)) { removing.delete(id); hidden.delete(id); continue }
      const later = pending.get(id)
      pending.set(id, later
        ? { fields: { ...e.fields, ...later.fields }, mode: later.mode !== 'patch' ? later.mode : e.mode,
            expect: e.expect || later.expect, origin: later.origin ?? e.origin }
        : e)
    }
  }

  async function savePuts(puts, marks) {
    let answer
    try {
      answer = await adapter.putBoardElements(boardId, puts.map(([id, e]) => wireOf(id, e)))
    } catch (err) {
      inflight.clear()
      if (!isRefusal(err)) {
        requeue(puts)
        failed()
        redraw(puts.map(([id]) => id))
        return false
      }
      say(wordsOf(err, BOARD_WORDS.refused))
      redraw(puts.map(([id]) => id))
      await resync(puts.map(([id]) => id))
      return true
    }
    const sent = new Map(puts)
    const changed = []
    const again = []
    const reread = []
    for (const s of answer?.saved ?? []) {
      const asked = s?.asked ?? s?.id
      const e = sent.get(asked)
      if (!e) continue
      sent.delete(asked)
      let id = asked
      if (s.asked && s.id && s.asked !== s.id) { rename(s.asked, s.id); id = s.id }
      inflight.delete(id)
      const v = Number(s.version)
      myVersion.set(id, v)
      changed.push(id)
      // A partial change answered as a new element: someone removed it first, and the save made it again.
      if (e.mode === 'patch' && v === 1) { again.push(id); continue }
      const cur = base.get(id)
      if (mark(id) !== (marks.get(asked) ?? 0) || (e.mode === 'patch' && !cur)) { reread.push(id); continue }
      if (!cur || v >= versionOf(cur)) base.set(id, { ...(e.mode === 'patch' ? cur : {}), ...e.fields, id, version: v })
    }
    let skipped = 0
    for (const c of answer?.conflicts ?? []) {
      const e = sent.get(c?.id)
      if (!e) continue
      sent.delete(c.id)
      dropFromStep(e.origin, c.id)
      skipped += 1
      reread.push(c.id)
    }
    reread.push(...sent.keys())
    changed.push(...sent.keys())
    inflight.clear()
    for (const id of again) {
      base.delete(id)
      const p = pending.get(id)
      if (p?.mode === 'patch') pending.delete(id)
      hidden.add(id)
      tombs.set(id, 1)
      removing.set(id, { expect: true, origin: null, quiet: true })
    }
    redraw(changed)
    sayConflicts(skipped)
    if (reread.length) await resync(reread)
    return true
  }

  function requeueRemovals(group) {
    for (const [id, r] of group) {
      const p = pending.get(id)
      if (p?.mode === 'readd') { pending.set(id, { ...p, mode: 'patch', expect: true }); hidden.delete(id); continue }
      if (!removing.has(id)) removing.set(id, r)
    }
  }

  async function saveRemovals(rms) {
    let ok = true
    const groups = [rms.filter(([, r]) => !r.expect), rms.filter(([, r]) => r.expect)]
    for (const [i, group] of groups.entries()) {
      if (dropped) break
      if (!group.length) continue
      const ids = group.map(([id]) => id)
      const versions = i === 1 ? ids.map((id) => Number(myVersion.get(id) ?? base.get(id)?.version ?? 0)) : null
      let answer
      try {
        answer = await adapter.deleteBoardElements(boardId, ids, versions)
      } catch (err) {
        for (const id of ids) removingInflight.delete(id)
        if (!isRefusal(err)) { requeueRemovals(group); failed(); ok = false; continue }
        for (const id of ids) hidden.delete(id)
        say(wordsOf(err, BOARD_WORDS.refused))
        redraw(ids)
        await resync(ids)
        continue
      }
      const rec = new Map(group)
      const reread = []
      let skipped = 0
      for (const c of answer?.conflicts ?? []) {
        const r = rec.get(c?.id)
        if (!r) continue
        rec.delete(c.id)
        hidden.delete(c.id)
        dropFromStep(r.origin, c.id)
        if (!r.quiet) skipped += 1
        reread.push(c.id)
      }
      // Removed, or gone already (a removal names only what it found).
      for (const [id] of rec) {
        base.delete(id)
        myVersion.delete(id)
        hidden.delete(id)
      }
      for (const id of ids) removingInflight.delete(id)
      redraw(ids)
      sayConflicts(skipped)
      if (reread.length) await resync(reread)
    }
    return ok
  }

  // Read again from the server: exact when the drawing must match it (an id it does not return is gone).
  async function fetchIds(ids, exact = false) {
    const list = [...new Set(ids)].filter(Boolean)
    if (!list.length || dropped) return
    const marks = new Map(list.map((id) => [id, mark(id)]))
    let els
    try {
      els = await adapter.readBoardElements(boardId, list)
    } catch {
      return
    }
    const got = new Set()
    const changed = []
    for (const el of Array.isArray(els) ? els : []) {
      if (!el?.id || !marks.has(el.id)) continue
      got.add(el.id)
      if (mark(el.id) !== marks.get(el.id)) continue
      const cur = base.get(el.id)
      if (cur && versionOf(cur) > versionOf(el)) continue
      base.set(el.id, { ...el })
      previews.delete(el.id)
      changed.push(el.id)
    }
    if (exact) {
      for (const id of list) {
        if (got.has(id) || mark(id) !== marks.get(id)) continue
        base.delete(id)
        myVersion.delete(id)
        const p = pending.get(id)
        if (p?.mode === 'patch') pending.delete(id)
        changed.push(id)
      }
    }
    redraw(changed)
  }
  const resync = (ids) => fetchIds(ids, true)

  // An id the server gave in place of ours (the one asked for is another board's): every name of it follows.
  function rename(from, to) {
    for (const m of [base, pending, inflight, transient, transientBefore, myVersion, previews, removing, removingInflight]) {
      if (m.has(from)) { m.set(to, m.get(from)); m.delete(from) }
    }
    if (hidden.delete(from)) hidden.add(to)
    const swap = (o) => {
      if (!o) return o
      const n = { ...o }
      if (n.id === from) n.id = to
      if (n.from_id === from) n.from_id = to
      if (n.to_id === from) n.to_id = to
      return n
    }
    for (const step of [...undoStack, ...redoStack]) {
      const entries = [...step.changes.entries()]
      step.changes.clear()
      for (const [id, c] of entries) {
        const key = id === from ? to : id
        step.changes.set(key, { ...c, id: key, el: swap(c.el), before: swap(c.before), after: swap(c.after) })
      }
    }
    const ends = []
    for (const [id, el] of drawn) {
      if (id === from || (el.from_id !== from && el.to_id !== from)) continue
      const fields = {}
      if (el.from_id === from) fields.from_id = to
      if (el.to_id === from) fields.to_id = to
      commit(id, { fields, mode: 'patch', expect: false, origin: null })
      ends.push(id)
    }
    setDrawn(from, null)
    redraw([to, ...ends])
    emit({ type: 'renamed', from, to })
    if (ends.length) schedule()
  }

  // ── Changes made here ─────────────────────────────────────────────────────────────────────────────────────────
  function cleanPatch(current, patch) {
    const out = {}
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (FIXED_KEYS.has(k)) continue
      if (k === 'style') {
        const style = { ...(current?.style ?? {}) }
        for (const [sk, sv] of Object.entries(v ?? {})) {
          if (sv == null) delete style[sk]
          else style[sk] = sv
        }
        out.style = style
      } else {
        out[k] = v
      }
    }
    if (current?.kind === 'sticky') delete out.body
    return out
  }

  function topZ() {
    let z = 0
    for (const el of drawn.values()) if (Number.isFinite(el.z) && el.z > z) z = el.z
    return z
  }

  function add(el) {
    if (!writable()) return null
    const id = newId()
    const fields = { ...DEFAULTS, ...(el ?? {}) }
    for (const k of ['id', 'version', 'updated_at', 'updated_by', 'has_file', 'points_omitted']) delete fields[k]
    fields.style = { ...(el?.style ?? {}) }
    if (!Number.isFinite(fields.z)) fields.z = topZ() + 1
    if (fields.kind === 'sticky') fields.body = null
    pending.set(id, { fields, mode: 'new', expect: false, origin: null })
    record({ type: 'add', id, el: { ...fields } })
    redraw([id])
    schedule()
    return id
  }

  function update(id, patch, { settled = true } = {}) {
    if (!drawn.has(id) || !writable()) return false
    const current = drawn.get(id)
    const clean = cleanPatch(current, patch)
    const without = compute(id, false) ?? current
    if (!settled) {
      const before = transientBefore.get(id) ?? {}
      for (const k of Object.keys(clean)) if (!(k in before)) before[k] = without[k]
      transientBefore.set(id, before)
      transient.set(id, { ...(transient.get(id) ?? {}), ...clean })
      redraw([id])
      return true
    }
    const fields = { ...(transient.get(id) ?? {}), ...clean }
    const before = { ...(transientBefore.get(id) ?? {}) }
    for (const k of Object.keys(fields)) if (!(k in before)) before[k] = without[k]
    for (const k of Object.keys(before)) if (!(k in fields)) delete before[k]
    transient.delete(id)
    transientBefore.delete(id)
    for (const k of Object.keys(fields)) {
      if (same(fields[k], before[k])) { delete fields[k]; delete before[k] }
    }
    if (!Object.keys(fields).length) { redraw([id]); return false }
    rebase(id)
    commit(id, { fields, mode: 'patch', expect: false, origin: null })
    record({ type: 'update', id, before, after: fields })
    redraw([id])
    schedule()
    return true
  }

  function removeLocal(id, { expect = false, origin = null, quiet = false } = {}) {
    transient.delete(id)
    transientBefore.delete(id)
    pending.delete(id)
    // Never reached the server: forgetting it is the whole removal.
    if (!base.has(id) && !inflight.has(id) && !removingInflight.has(id)) return
    hidden.add(id)
    removing.set(id, { expect, origin, quiet })
  }

  function remove(ids) {
    const list = [...new Set([].concat(ids ?? []))].filter((id) => drawn.has(id))
    if (!list.length || !writable()) return
    for (const id of list) {
      const el = compute(id, false) ?? drawn.get(id)
      rebase(id)
      record({ type: 'remove', id, el: { ...el } })
      removeLocal(id)
    }
    redraw(list)
    schedule()
  }

  function readd(id, el, origin) {
    hidden.delete(id)
    const fields = { ...el }
    for (const k of ['id', 'version', 'updated_at', 'updated_by']) delete fields[k]
    if (removing.has(id)) {
      // Its removal was never sent: it is still there, and gets its fields back.
      removing.delete(id)
      commit(id, { fields, mode: 'patch', expect: true, origin })
    } else if (base.has(id) && !removingInflight.has(id)) {
      commit(id, { fields, mode: 'patch', expect: true, origin })
    } else {
      commit(id, { fields, mode: 'readd', expect: false, origin })
    }
  }

  function applyStep(from, to, back) {
    openStep = null
    if (!from.length || !writable()) return Promise.resolve(false)
    const step = from.pop()
    const changes = [...step.changes.values()]
    if (back) changes.reverse()
    const ids = []
    let gone = 0
    for (const c of changes) {
      const id = c.id
      ids.push(id)
      transient.delete(id)
      transientBefore.delete(id)
      if (c.type === 'update') {
        if (!drawn.has(id)) { step.changes.delete(id); gone += 1; continue }
        touch(id)
        commit(id, { fields: { ...(back ? c.before : c.after) }, mode: 'patch', expect: true, origin: step })
      } else if ((c.type === 'add') === back) {
        // An undone add, a redone removal. Gone already is where it was going: nothing to do.
        if (!drawn.has(id)) continue
        touch(id)
        removeLocal(id, { expect: true, origin: step })
      } else {
        readd(id, c.el, step)
      }
    }
    if (step.changes.size) to.push(step)
    redraw(ids)
    sayConflicts(gone)
    return flush()
  }

  // ── Others' changes ───────────────────────────────────────────────────────────────────────────────────────────
  // A key's own action (a placed file gone, the board followed its folder) moves the version and nothing drawn.
  function sameDrawing(cur, fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'version' || k === 'updated_by' || k === 'updated_at') continue
      if (!same(cur[k], v)) return false
    }
    return true
  }

  function remotePut(list) {
    const changed = []
    const fetch = []
    for (const w of Array.isArray(list) ? list : []) {
      if (!w?.id) continue
      if (loading) loading.puts.add(w.id)
      const tomb = tombs.get(w.id)
      if (tomb != null && versionOf(w) <= tomb) continue
      const cur = base.get(w.id)
      if (cur && versionOf(cur) >= versionOf(w)) continue
      const { has_file: hasFile, points_omitted: omitted, ...fields } = w
      if (!cur) {
        const mine = inflight.get(w.id) ?? pending.get(w.id)
        if (mine && mine.mode !== 'patch') {
          // This window's own new element, heard before its save's answer.
          const local = mine.fields
          base.set(w.id, { ...fields, file: local.file ?? null, missing: local.missing ?? false,
            ...(omitted ? { points: local.points ?? null, body: local.body ?? null } : {}) })
          changed.push(w.id)
          continue
        }
        if (hasFile || omitted) { fetch.push(w.id); continue }
        base.set(w.id, { ...fields, file: null, missing: false })
        changed.push(w.id)
        continue
      }
      const next = { ...cur, ...fields }
      if (omitted) {
        next.points = cur.points ?? null
        next.body = cur.body ?? null
        fetch.push(w.id)
      } else if (hasFile && sameDrawing(cur, fields)) {
        fetch.push(w.id)
      }
      base.set(w.id, next)
      previews.delete(w.id)
      changed.push(w.id)
    }
    redraw(changed)
    return fetch.length ? fetchIds(fetch) : Promise.resolve()
  }

  function remoteRemove(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter(Boolean)
    for (const id of list) {
      if (loading) loading.removes.add(id)
      removeMarks.set(id, mark(id) + 1)
      base.delete(id)
      previews.delete(id)
      tombs.delete(id)
      myVersion.delete(id)
      transient.delete(id)
      transientBefore.delete(id)
      removing.delete(id)
      if (pending.get(id)?.mode === 'patch') pending.delete(id)
      if (!removingInflight.has(id)) hidden.delete(id)
    }
    redraw(list)
    return Promise.resolve()
  }

  /** An `elements` message from the board's channel: { board, op: 'put', elements } or { board, op: 'remove', ids }. */
  function applyRemote(payload) {
    if (!payload || closing || (payload.board && payload.board !== boardId)) return Promise.resolve()
    if (payload.op === 'remove') return remoteRemove(payload.ids)
    if (payload.op === 'put') return remotePut(payload.elements)
    return Promise.resolve()
  }

  /** Another person's drag in progress, drawn only (never saved, never a step); null ends it. */
  function preview(id, fields) {
    if (!fields) { if (previews.delete(id)) redraw([id]); return }
    if (!base.has(id)) return
    const f = {}
    for (const k of DRAG_KEYS) if (Number.isFinite(fields[k])) f[k] = fields[k]
    previews.set(id, { fields: f })
    redraw([id])
  }

  /** An element the server already saved for this window (a sticky placed by createSticky): drawn and undoable. */
  function adopt(el) {
    if (!el?.id || closing) return
    const cur = base.get(el.id)
    if (!cur || versionOf(el) >= versionOf(cur)) base.set(el.id, { ...el })
    myVersion.set(el.id, versionOf(el) || 1)
    record({ type: 'add', id: el.id, el: { ...el } })
    redraw([el.id])
  }

  // ── Loading ───────────────────────────────────────────────────────────────────────────────────────────────────
  // A second load (after the channels were renamed) keeps this window's unsaved changes and anything newer it heard
  // while the read was on its way.
  async function load() {
    const marker = { puts: new Set(), removes: new Set() }
    loading = marker
    let res
    try {
      res = await adapter.readBoard(boardId)
    } finally {
      if (loading === marker) loading = null
    }
    if (closing) return
    board = res?.board ?? null
    const fresh = new Map((Array.isArray(res?.elements) ? res.elements : []).filter((el) => el?.id).map((el) => [el.id, el]))
    for (const id of new Set([...base.keys(), ...fresh.keys()])) {
      const f = fresh.get(id)
      const cur = base.get(id)
      if (!f) { if (cur && !marker.puts.has(id)) base.delete(id); continue }
      if (marker.removes.has(id)) continue
      if (cur && versionOf(cur) > versionOf(f)) continue
      base.set(id, { ...f })
    }
    const ids = new Set([...drawn.keys(), ...base.keys(), ...pending.keys(), ...inflight.keys()])
    handedOut = false
    drawn = new Map()
    for (const id of ids) { const el = compute(id); if (el) drawn.set(id, el) }
    emit({ type: 'change', ids: [...ids], loaded: true })
  }

  async function flush() {
    if (timer) { clearTimeout(timer); timer = null }
    for (let i = 0; i < 100; i += 1) {
      if (running) { await running; continue }
      if (!hasWork()) return
      const ok = await start()
      if (!ok) return
    }
  }

  // An ordinary close saves what is waiting first. { save: false } (another person or company now) drops it
  // instead, with its timer, and asks the adapter nothing more: a waiting save never goes out under the next account.
  function dispose({ save = true } = {}) {
    if (!save) {
      dropped = true
      pending.clear()
      removing.clear()
    }
    const done = (save && (hasWork() || running)) ? flush().catch(() => {}) : Promise.resolve()
    closing = true
    if (timer) { clearTimeout(timer); timer = null }
    listeners.clear()
    return done
  }

  return {
    load,
    getBoard: () => board,
    getElements: () => { handedOut = true; return drawn },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    add,
    update,
    remove,
    undo: () => applyStep(undoStack, redoStack, true),
    redo: () => applyStep(redoStack, undoStack, false),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    applyRemote,
    preview,
    adopt,
    flush,
    dispose,
  }
}
