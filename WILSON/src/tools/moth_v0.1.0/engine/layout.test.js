// =============================================================================
// layout.test.js — the layouts and their worker (MO2a, the brief's item 2:
// "a force layout and a radial tree, run in a bounded Web Worker; the
// simulation suspends once settled; positions are plain data").
//
// Pins: the force layout is deterministic per seed; a fully saved view is
// settled at once on its saved places; new dots start beside their nearest
// placed ancestor while saved dots hold; a pin moves only its two-step
// neighbourhood; releaseHolds keeps pins. The radial tree puts one island at
// the centre, overlaps nothing, and rings the tags outside everything. The
// worker protocol (layoutWorkerCore.js, driven by a manual schedule queue and
// an injected clock): one settled then nothing scheduled until a pin, unpin or
// reheat; stale jobs ignored; refusals answered; bounds and error codes; the
// buffers transferred. The client (layoutClient.js, around a fake worker built
// on the real core, with fake timers): settle, the watchdog, a late tick after
// stop, pins dropped after stop or dispose, a refusal keeps the job, dispose
// and a crash end the worker. Each rule has a PLANTED control.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createForceLayout, radialTree } from './layout.js'
import { createLayoutWorkerCore, WORKER_LIMITS } from './layoutWorkerCore.js'
import { createLayoutClient } from './layoutClient.js'
import { buildGraph, toLayoutInput, positionsToData } from './model.js'
import { generateCatalogue, fixtureForTarget } from './fixtures.js'

const CAT = generateCatalogue({ seed: 3, projects: 1, foldersPerProject: 8, filesPerProject: 45, relations: 8 })
const G = buildGraph(CAT, { expanded: 'all' })
const IN = toLayoutInput(G) // 61 dots, 106 lines
// The protocol and client tests only need something to tick: a smaller graph keeps the file fast.
const SMALL = toLayoutInput(buildGraph(generateCatalogue({ seed: 4, projects: 1, foldersPerProject: 5, filesPerProject: 25 }), { expanded: 'all' }))
const SID = SMALL.nodes.map((n) => n.id)
const IDS = IN.nodes.map((n) => n.id)
const at = (id) => IDS.indexOf(id)
const node = new Map(G.nodes.map((n) => [n.id, n]))

const settle = (lay, max = 3000) => { for (let k = 0; k < max && !lay.settled(); k++) lay.tick(1); return lay }
const places = (lay) => lay.write(new Float64Array(lay.n * 2))
const dist = (xy, i, j) => Math.hypot(xy[2 * i] - xy[2 * j], xy[2 * i + 1] - xy[2 * j + 1])
const without = (pos, ids) => Object.fromEntries(Object.entries(pos).filter(([id]) => !ids.includes(id)))
const SAVED = positionsToData(IDS, places(settle(createForceLayout(IN)))) // a saved view: every dot placed
// A file three folders deep (file -> A -> B -> C).
const DEEP = G.nodes.find((n) => n.kind === 'file' && [1, 2, 3].every((k) => ancestors(n.id)[k - 1]?.startsWith('folder:')))
function ancestors(id) { const out = []; for (let p = node.get(id).parent; p; p = node.get(p).parent) out.push(p); return out }

describe('force layout', () => {
  const samePlaces = (a, b) => a.length === b.length && a.every((v, k) => Object.is(v, b[k]))
  const partial = without(SAVED, G.nodes.filter((n) => n.kind === 'file').slice(0, 6).map((n) => n.id))
  const runOf = (seed, positions) => { const l = createForceLayout({ ...IN, positions, options: { seed } }); l.tick(30); return places(l) }

  it('is deterministic per seed (from scratch and with new dots placed at random angles)', () => {
    expect(samePlaces(runOf(1, null), runOf(1, null))).toBe(true)
    expect(samePlaces(runOf(5, partial), runOf(5, partial))).toBe(true)
  })

  it('CONTROL: another seed (what an unseeded Math.random would give) changes the places, and the check sees it', () => {
    expect(samePlaces(runOf(5, partial), runOf(6, partial))).toBe(false)
  })

  const restsOnSaved = (lay, saved) => {
    const xy = places(lay)
    return lay.settled() && IDS.every((id, i) => xy[2 * i] === saved[id]?.x && xy[2 * i + 1] === saved[id]?.y)
  }
  it('a fully saved view is settled at once and writes exactly the saved places', () => {
    expect(restsOnSaved(createForceLayout({ ...IN, positions: SAVED }), SAVED)).toBe(true)
  })
  it('CONTROL: one place missing and the same check fails (not settled, not the saved places)', () => {
    expect(restsOnSaved(createForceLayout({ ...IN, positions: without(SAVED, [IDS[9]]) }), SAVED)).toBe(false)
  })

  const savedStill = (xy, saved) => Object.entries(saved).every(([id, p]) => xy[2 * at(id)] === p.x && xy[2 * at(id) + 1] === p.y)
  const startsNear = (xy, id, ancId, levels) => dist(xy, at(id), at(ancId)) <= 20 * levels + 1e-9
  const leaf = G.nodes.find((n) => n.kind === 'file' && n.parent?.startsWith('folder:'))

  it('one new dot: it starts beside its parent and, run to rest, the saved dots have not moved', () => {
    const saved = without(SAVED, [leaf.id])
    const lay = createForceLayout({ ...IN, positions: saved })
    const start = places(lay)
    expect(startsNear(start, leaf.id, leaf.parent, 1)).toBe(true)
    expect(lay.settled()).toBe(false)
    const end = places(settle(lay))
    expect(lay.settled()).toBe(true)
    expect(end[2 * at(leaf.id)]).not.toBe(start[2 * at(leaf.id)]) // the new dot found its own place
    expect(savedStill(end, saved)).toBe(true)
  })
  it('CONTROL: a layout that lets the saved dots go (holds released) moves them, and the check sees it', () => {
    const saved = without(SAVED, [leaf.id])
    const lay = createForceLayout({ ...IN, positions: saved })
    lay.reheat()
    lay.tick(40)
    expect(savedStill(places(lay), saved)).toBe(false)
  })

  // Shifted far from the origin, so "beside its ancestor" cannot be met by luck near (0, 0).
  const far = Object.fromEntries(Object.entries(SAVED).map(([id, p]) => [id, { x: p.x + 5000, y: p.y - 5000 }]))
  const chain = () => [DEEP.id, ...ancestors(DEEP.id).slice(0, 2)] // the file and two folders are new
  it('a new chain several levels deep starts beside its nearest placed ancestor', () => {
    expect(DEEP).toBeTruthy()
    const lay = createForceLayout({ ...IN, positions: without(far, chain()) })
    expect(startsNear(places(lay), DEEP.id, ancestors(DEEP.id)[2], 3)).toBe(true)
  })
  it('CONTROL: with the chain cut from its parents (corrupted input) the same check fails', () => {
    const cut = { ...IN, nodes: IN.nodes.map((n) => (chain().includes(n.id) ? { ...n, parent: null } : n)) }
    const lay = createForceLayout({ ...cut, positions: without(far, chain()) })
    expect(startsNear(places(lay), DEEP.id, ancestors(DEEP.id)[2], 3)).toBe(false)
  })

  const within = (i, reach) => {
    const adj = IDS.map(() => [])
    for (const [s, t] of IN.links) { adj[s].push(t); adj[t].push(s) }
    const seen = new Set([i])
    let front = [i]
    for (let d = 0; d < reach; d++) front = front.flatMap((a) => adj[a].filter((b) => !seen.has(b) && seen.add(b)))
    return seen
  }
  const onlyNearMoved = (before, after, i, x, y) => {
    const near = within(i, 2)
    if (after[2 * i] !== x || after[2 * i + 1] !== y) return false
    return IDS.every((_, j) => near.has(j) || (after[2 * j] === before[2 * j] && after[2 * j + 1] === before[2 * j + 1]))
  }
  const dragged = (options, ticks = Infinity) => {
    const lay = createForceLayout({ ...IN, positions: SAVED, options })
    const before = places(lay)
    const i = at(DEEP.id)
    const [x, y] = [before[2 * i] + 40, before[2 * i + 1] - 30]
    lay.pin(i, x, y)
    if (ticks === Infinity) settle(lay)
    else lay.tick(ticks)
    return { lay, before, after: places(lay), i, x, y }
  }
  it('pin moves only the two-step neighbourhood and the pinned dot stays exactly where put', () => {
    const { before, after, i, x, y } = dragged()
    expect(onlyNearMoved(before, after, i, x, y)).toBe(true)
    const near = [...within(i, 2)].filter((j) => j !== i)
    expect(near.some((j) => after[2 * j] !== before[2 * j])).toBe(true) // the neighbourhood did follow
    expect(IDS.length - near.length - 1).toBeGreaterThan(20) // and most of the world was held
  })
  it('CONTROL: a drag that reaches four steps moves dots beyond two, and the same check fails', () => {
    const { before, after, i, x, y } = dragged({ pinReach: 4 }, 40)
    expect(onlyNearMoved(before, after, i, x, y)).toBe(false)
  })

  const freedButPinned = (lay, i) => IDS.every((_, j) => !lay.held(j)) && lay.pinned(i)
  it('releaseHolds frees the held dots but not the pin, which stays put through a re-layout', () => {
    const { lay, i, x, y } = dragged(undefined, 0)
    expect(IDS.some((_, j) => lay.held(j))).toBe(true)
    lay.releaseHolds()
    expect(freedButPinned(lay, i)).toBe(true)
    lay.reheat()
    lay.tick(60)
    const xy = places(lay)
    expect([xy[2 * i], xy[2 * i + 1]]).toEqual([x, y])
  })
  it('CONTROL: a release that also drops pins (unpin first) fails the same check', () => {
    const { lay, i } = dragged(undefined, 0)
    lay.unpin(i)
    lay.releaseHolds()
    expect(freedButPinned(lay, i)).toBe(false)
  })
})

describe('radial tree', () => {
  const fixture = fixtureForTarget({ nodes: 200, edges: 400 }).catalogue
  const FIX = toLayoutInput(buildGraph(fixture, { expanded: 'all' }))
  const FLAT = toLayoutInput(buildGraph(fixture, { nodeKinds: ['file'], expanded: 'all' })) // 173 files, no hierarchy
  const atCentre = (xy, i) => xy[2 * i] === 0 && xy[2 * i + 1] === 0
  const overlaps = (xy, nodes) => {
    let bad = 0
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) if (dist(xy, a, b) < nodes[a].r + nodes[b].r) bad++
    }
    return bad
  }
  const norm = (xy, i) => Math.hypot(xy[2 * i], xy[2 * i + 1])
  const tagsOutside = (xy, nodes) => {
    const tag = nodes.map((n, i) => [n, i]).filter(([n]) => n.id.startsWith('tag:')).map(([, i]) => norm(xy, i))
    const rest = nodes.map((n, i) => [n, i]).filter(([n]) => !n.id.startsWith('tag:')).map(([, i]) => norm(xy, i))
    return tag.length > 1 && Math.max(...tag) - Math.min(...tag) < 1e-3 && Math.min(...tag) > Math.max(...rest)
  }

  it('a single island sits at the centre (0, 0)', () => {
    expect(atCentre(radialTree(IN), at(G.nodes.find((n) => n.kind === 'project').id))).toBe(true)
  })
  it('CONTROL: with a second island (a hidden root over both) the first is off-centre, and the check sees it', () => {
    const two = toLayoutInput(buildGraph(generateCatalogue({ seed: 3, projects: 2, foldersPerProject: 4, filesPerProject: 10 }), { expanded: 'all' }))
    expect(atCentre(radialTree(two), two.nodes.findIndex((n) => n.id.startsWith('project:')))).toBe(false)
  })

  it('no two dots overlap (distance >= r_a + r_b): a fully opened 200-dot fixture and a flat files-only view', () => {
    expect(FIX.nodes.length).toBe(200)
    expect(overlaps(radialTree(FIX), FIX.nodes)).toBe(0)
    expect(FLAT.nodes.every((n) => n.parent === null)).toBe(true)
    expect(overlaps(radialTree(FLAT), FLAT.nodes)).toBe(0)
  })
  it('CONTROL: rings computed for dots that ignore their sizes (r 0.1) do overlap at the real sizes', () => {
    const tiny = (inp) => radialTree({ nodes: inp.nodes.map((n) => ({ ...n, r: 0.1 })) })
    expect(overlaps(tiny(FLAT), FLAT.nodes)).toBeGreaterThan(0)
  })

  it('tag dots (loose) lie on one ring beyond every other dot', () => {
    expect(tagsOutside(radialTree(IN), IN.nodes)).toBe(true)
    expect(tagsOutside(radialTree(FIX), FIX.nodes)).toBe(true)
  })
  it('CONTROL: tags not marked loose (corrupted input) join the hierarchy and the same check fails', () => {
    const tied = IN.nodes.map((n) => ({ ...n, loose: false }))
    expect(tagsOutside(radialTree({ nodes: tied }), tied)).toBe(false)
  })
})

// ── The worker protocol ─────────────────────────────────────────────────────
// clock 'step': each now() call is 1 ms later; 'still': time never moves.
function harness({ limits, clock = 'step', make = createLayoutWorkerCore } = {}) {
  const h = { queue: [], out: [], t: 0 }
  h.core = make({ post: (m, transfer) => h.out.push({ m, transfer }), schedule: (fn) => h.queue.push(fn), now: () => (clock === 'step' ? ++h.t : h.t), limits })
  h.send = (m) => { const n0 = h.out.length; h.core.handle(m); return h.out[n0]?.m }
  h.steps = (n) => { for (let k = 0; k < n && h.queue.length; k++) h.queue.shift()() }
  return h
}
const init = (job, extra = {}) => ({ type: 'init', job, layout: 'force', ...SMALL, positions: null, options: {}, ...extra })
const started = (o = {}, extra) => { const h = harness(o); h.send(init(1, extra)); return h }
// A naive worker: no job check, no bounds, no answers, no transfer list, never suspends.
function naiveCore({ post, schedule }) {
  return {
    handle(m) {
      if (m.type !== 'init') return
      const lay = createForceLayout(m)
      const loop = () => { lay.tick(1); post({ type: lay.settled() ? 'settled' : 'tick', job: m.job, xy: lay.write(new Float32Array(lay.n * 2)) }, []); schedule(loop) }
      schedule(loop)
    },
  }
}
// Run scheduled work one item at a time until a 'settled' is posted; then nothing may be left scheduled.
const quietOnceSettled = (h, max = 5000) => {
  const n0 = h.out.length
  for (let k = 0; k < max && h.queue.length; k++) {
    h.queue.shift()()
    if (h.out.slice(n0).some((o) => o.m.type === 'settled')) return h.queue.length === 0
  }
  return false
}
const ran = (o, extra) => { const h = started(o, extra); quietOnceSettled(h); return h }
const kinds = (h, from = 0) => h.out.slice(from).map((o) => o.m.type)

describe('worker protocol', () => {
  it('init force -> ticks -> one settled, then nothing is scheduled until a pin, unpin or reheat', () => {
    const h = started()
    expect(quietOnceSettled(h)).toBe(true)
    const k = kinds(h)
    expect(k.filter((t) => t === 'tick').length).toBeGreaterThan(1)
    expect(k.indexOf('settled')).toBe(k.length - 1)
    expect(h.out.map((o) => o.m.seq)).toEqual(h.out.map((_, n) => n + 1))
    expect(h.core.running()).toBe(false)
    for (const m of [{ type: 'pin', id: SID[5], x: 9, y: 9 }, { type: 'unpin', id: SID[5] }, { type: 'reheat' }]) {
      const n0 = h.out.length
      h.send({ ...m, job: 1 })
      expect(h.queue.length).toBe(1)
      expect(quietOnceSettled(h)).toBe(true)
      expect(kinds(h, n0).filter((t) => t === 'settled').length).toBe(1)
    }
  })
  it('CONTROL: a naive worker that keeps its loop going after settling fails the same check', () => {
    expect(quietOnceSettled(started({ make: naiveCore }))).toBe(false)
  })

  const silentFor = (h, job, from) => h.out.slice(from).every((o) => o.m.job !== job)
  const staleRun = (make) => {
    const h = started({ make })
    h.steps(3)
    h.send(init(2))
    const from = h.out.length
    for (const m of [{ type: 'pin', id: SID[5], x: 0, y: 0 }, { type: 'unpin', id: 'node:nope' }, { type: 'reheat' }]) h.send({ ...m, job: 1 })
    h.steps(40)
    return { h, from }
  }
  it("a stale job's messages are ignored (and its scheduled run posts nothing more)", () => {
    const { h, from } = staleRun()
    expect(silentFor(h, 1, from)).toBe(true)
    expect(quietOnceSettled(h)).toBe(true)
    expect(h.out.at(-1).m).toMatchObject({ type: 'settled', job: 2 })
  })
  it('CONTROL: a naive worker keeps posting for the replaced job, and the check sees it', () => {
    const { h, from } = staleRun(naiveCore)
    expect(silentFor(h, 1, from)).toBe(false)
  })

  const refusedButKept = (h, job) => {
    for (const m of [{ type: 'pin', id: 'node:nope', x: 1, y: 1 }, { type: 'unpin', id: 'node:nope' }, { type: 'pin', id: SID[4], x: NaN, y: 1 }]) {
      const a = h.send({ ...m, job })
      if (!a || a.type !== 'error' || a.code !== 'refused' || a.job !== job) return false
    }
    h.send({ type: 'pin', job, id: SID[4], x: 1, y: 1 })
    return h.queue.length === 1 && quietOnceSettled(h)
  }
  it("a pin or unpin it cannot apply answers error 'refused' and the job stays", () => {
    expect(refusedButKept(ran(), 1)).toBe(true)
  })
  it('CONTROL: a naive worker leaves the bad pin unanswered, and the same check fails', () => {
    expect(refusedButKept(started({ make: naiveCore }), 1)).toBe(false)
  })

  const answeredRefused = (h, m) => { const a = h.send(m); return a?.type === 'error' && a.code === 'refused' && a.job === m.job }
  it("a message for the latest job when there is no force run (radial) answers 'refused'; stop is not answered", () => {
    const h = harness()
    expect(h.send(init(1, { layout: 'radial' }))).toMatchObject({ type: 'settled', reason: 'settled', ticks: 0 })
    expect(h.queue.length).toBe(0)
    expect(answeredRefused(h, { type: 'pin', job: 1, id: SID[3], x: 0, y: 0 })).toBe(true)
    expect(answeredRefused(h, { type: 'reheat', job: 1 })).toBe(true)
    expect(h.send({ type: 'stop', job: 1 })).toBeUndefined()
  })
  it('CONTROL: the same message for an older job is ignored, so the check can fail', () => {
    const h = started({}, { layout: 'radial' })
    h.send(init(2, { layout: 'radial' }))
    expect(answeredRefused(h, { type: 'pin', job: 1, id: SID[3], x: 0, y: 0 })).toBe(false)
  })

  const code = (limits, extra) => harness({ limits }).send(init(1, extra))?.code
  const huge = { nodes: Array.from({ length: WORKER_LIMITS.maxNodes + 1 }, (_, i) => ({ id: `n${i}` })), links: [] }
  it("bounds: maxNodes+1 or maxLinks+1 gives 'too_large'; a partial override keeps the other bounds", () => {
    expect(code({ maxNodes: SMALL.nodes.length - 1 })).toBe('too_large')
    expect(code({ maxLinks: SMALL.links.length - 1 })).toBe('too_large')
    expect(code({ maxTicks: 5 }, huge)).toBe('too_large') // maxNodes is still the default 20,000
  })
  it('CONTROL: exactly at the bounds, or with an override that replaced the defaults, it is not too_large', () => {
    expect(code({ maxNodes: SMALL.nodes.length, maxLinks: SMALL.links.length })).not.toBe('too_large')
    const replaced = Object.fromEntries(Object.keys(WORKER_LIMITS).map((k) => [k, k === 'maxTicks' ? 5 : undefined]))
    expect(code(replaced, huge)).not.toBe('too_large')
  })

  const capped = (h, maxTicks) => { const m = h.out.at(-1)?.m; return m?.type === 'settled' && m.reason === 'cap' && m.ticks <= maxTicks && h.queue.length === 0 }
  it("maxTicks caps the run with reason 'cap'; maxRunMs caps it on a clock that advances per now() call", () => {
    const a = ran({ limits: { maxTicks: 5 }, clock: 'still' })
    expect(capped(a, 5)).toBe(true)
    expect(a.out.at(-1).m.ticks).toBe(5)
    expect(capped(ran({ limits: { maxRunMs: 40 } }), 30)).toBe(true)
  })
  it('CONTROL: with no tick cap, or a clock that never moves, the same run settles instead and the check fails', () => {
    expect(capped(ran({ clock: 'still' }), 5)).toBe(false)
    const b = ran({ limits: { maxRunMs: 40 }, clock: 'still' })
    expect(capped(b, 30)).toBe(false)
    expect(b.out.at(-1).m.reason).toBe('settled')
  })

  const BAD = [{ nodes: 'x' }, { links: null }, { nodes: [{ id: 7 }] }, { links: [[0, SMALL.nodes.length, 0]] }, { links: [[0.5, 1, 0]] }]
  it("bad input gives 'bad_input'; an unknown layout gives 'unknown_layout'", () => {
    for (const b of BAD) expect(code(undefined, b)).toBe('bad_input')
    expect(code(undefined, { layout: 'spiral' })).toBe('unknown_layout')
  })
  it('CONTROL: the valid input and known layouts get neither code', () => {
    expect(code(undefined)).not.toBe('bad_input')
    expect(code(undefined, { layout: 'radial' })).not.toBe('unknown_layout')
  })

  const transferred = (h) => h.out.length > 1 && h.out.every(({ m, transfer }) => m.xy instanceof Float32Array && m.xy.length === 2 * SMALL.nodes.length && transfer.includes(m.xy.buffer))
  it('tick and settled messages carry a Float32Array whose buffer is in the transfer list', () => {
    expect(transferred(ran())).toBe(true)
  })
  it('CONTROL: a naive worker that copies (empty transfer list) fails the same check', () => {
    const h = started({ make: naiveCore })
    h.steps(5)
    expect(transferred(h)).toBe(false)
  })
})

// ── The client ───────────────────────────────────────────────────────────────
// A fake worker around the real core (manual queue, its own clock), fake timers.
const TIMEOUT = 1000
function clientEnv({ silent = false, timeoutMs = TIMEOUT, input = SMALL, pump = false } = {}) {
  const env = { workers: [], errors: [], settled: [], ticks: [], t: 0, timers: new Map(), next: 1 }
  env.setTimer = (fn, ms) => { env.timers.set(env.next, { fn, due: env.t + ms }); return env.next++ }
  env.clearTimer = (h) => env.timers.delete(h)
  env.advance = (ms) => { env.t += ms; for (const [h, tm] of [...env.timers]) if (tm.due <= env.t) { env.timers.delete(h); tm.fn() } }
  env.createWorker = () => {
    const queue = []
    const outbox = []
    let wt = 0
    const w = { sent: [], terminated: false, onmessage: null, onerror: null, outbox }
    const core = createLayoutWorkerCore({ post: (m) => { if (!silent) outbox.push(m) }, schedule: (fn) => queue.push(fn), now: () => ++wt })
    w.postMessage = (m) => { w.sent.push(m); if (!w.terminated) core.handle(m) }
    w.terminate = () => { w.terminated = true }
    w.deliver = () => { while (outbox.length && !w.terminated) w.onmessage({ data: outbox.shift() }) }
    w.step = () => { const fn = queue.shift(); if (fn) fn() }
    w.pump = () => { for (let k = 0; k < 5000 && (queue.length || outbox.length); k++) { w.step(); w.deliver() } }
    env.workers.push(w)
    return w
  }
  env.client = createLayoutClient({
    createWorker: env.createWorker, timeoutMs, setTimer: env.setTimer, clearTimer: env.clearTimer,
    onTick: (m) => env.ticks.push(m), onSettled: (m) => env.settled.push(m), onError: (e) => env.errors.push(e),
  })
  env.job = env.client.run(input)
  env.w = env.workers[0]
  if (pump) env.w.pump()
  return env
}

describe('layout client', () => {
  const settledCleanly = (env) => env.settled.length === 1 && env.settled[0].job === 1 && env.errors.length === 0 && !env.client.busy() && env.timers.size === 0
  it('run -> ticks -> onSettled, with the watchdog disarmed', () => {
    const env = clientEnv({ pump: true })
    expect(env.job).toBe(1)
    expect(env.ticks.length).toBeGreaterThan(0)
    expect(settledCleanly(env)).toBe(true)
  })
  it('CONTROL: a worker that never answers fails the same check', () => {
    expect(settledCleanly(clientEnv({ silent: true, pump: true }))).toBe(false)
  })

  const timedOut = (env) => env.errors.length === 1 && env.errors[0].code === 'timeout' && env.errors[0].job === 1 && env.w.terminated
  it('a silent worker while busy: after timeoutMs, onError timeout and terminate()', () => {
    const env = clientEnv({ silent: true })
    env.advance(TIMEOUT - 1)
    expect(env.errors).toEqual([])
    env.advance(1)
    expect(timedOut(env)).toBe(true)
  })
  it('CONTROL: a client with no watchdog (timeout never due) leaves it hanging, and the check fails', () => {
    const env = clientEnv({ silent: true, timeoutMs: Infinity })
    env.advance(TIMEOUT * 100)
    expect(timedOut(env)).toBe(false)
  })

  // stop() while a tick is already in flight: delivered after stop, it must not re-arm the watchdog.
  const quietAfterStop = (env) => { env.advance(TIMEOUT * 3); return env.errors.length === 0 && env.timers.size === 0 }
  it('stop() then a tick already in flight: no watchdog, no error after timeoutMs', () => {
    const env = clientEnv()
    env.w.step() // the worker posts a tick that the page has not received yet
    expect(env.w.outbox.map((m) => m.type)).toEqual(['tick'])
    env.client.stop()
    env.w.deliver()
    expect(env.ticks).toEqual([])
    expect(quietAfterStop(env)).toBe(true)
  })
  it('CONTROL: the old filter (job number only, not whether the job is live) accepts that tick and times out', () => {
    const env = clientEnv({ silent: true })
    env.client.stop()
    const job = 1 // the job stop() just ended; below, the watchdog as it was with the filter before the fix
    let busy = false
    let dog = null
    const arm = () => { if (dog != null) env.clearTimer(dog); dog = env.setTimer(() => { dog = null; if (busy) env.errors.push({ job, code: 'timeout' }) }, TIMEOUT) }
    const oldOnMessage = (m) => { if (!m || m.job !== job) return; if (m.type === 'tick') { busy = true; arm() } }
    oldOnMessage({ type: 'tick', job: 1, seq: 1, xy: new Float32Array(2 * SMALL.nodes.length) })
    expect(quietAfterStop(env)).toBe(false)
  })

  const pinDropped = (env) => env.client.pin(SID[5], 1, 2) === false && env.workers.every((w) => !w.sent.some((m) => m.type === 'pin')) && env.timers.size === 0
  it('a pin after stop() or dispose() is not sent', () => {
    const a = clientEnv({ pump: true })
    a.client.stop()
    expect(pinDropped(a)).toBe(true)
    const b = clientEnv()
    b.client.dispose()
    expect(pinDropped(b)).toBe(true)
  })
  it('CONTROL: a pin while the job is live is sent, and the same check fails', () => {
    expect(pinDropped(clientEnv({ pump: true }))).toBe(false)
  })

  const keptAfterRefusal = (env) => {
    env.client.pin('node:nope', 0, 0)
    env.w.pump()
    const refused = env.errors.at(-1)?.code === 'refused'
    const n = env.settled.length
    const sent = env.client.pin(SID[5], 3, 4)
    env.w.pump()
    return refused && sent && env.settled.length === n + 1
  }
  it('a refused pin keeps the job live: the next pin is sent and runs to settled', () => {
    expect(keptAfterRefusal(clientEnv({ pump: true }))).toBe(true)
  })
  it('CONTROL: a job ended by a real error (bad_input) is not live, and the same check fails', () => {
    const env = clientEnv({ input: { nodes: 'x', links: [] }, pump: true })
    expect(env.errors[0].code).toBe('bad_input')
    expect(keptAfterRefusal(env)).toBe(false)
  })

  const ended = (env) => env.w.terminated && env.timers.size === 0 && !env.client.busy()
  it('dispose() terminates the worker', () => {
    const env = clientEnv()
    env.client.dispose()
    expect(ended(env)).toBe(true)
  })
  it('CONTROL: stop() keeps the worker, and the same check fails', () => {
    const env = clientEnv()
    env.client.stop()
    expect(ended(env)).toBe(false)
  })

  const crashed = (env) => env.errors.length === 1 && env.errors[0].code === 'crashed' && env.errors[0].job === 1 && env.w.terminated
  it("worker.onerror is reported as 'crashed' and the worker is ended", () => {
    const env = clientEnv()
    env.w.onerror(new Error('boom'))
    expect(crashed(env)).toBe(true)
  })
  it("CONTROL: a handled failure ('failed' from the worker) is not a crash, and the same check fails", () => {
    const env = clientEnv()
    env.w.onmessage({ data: { type: 'error', job: 1, code: 'failed' } })
    expect(crashed(env)).toBe(false)
  })
})
