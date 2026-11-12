// =============================================================================
// layoutWorkerCore.js — the layout worker's protocol (MO2a, the brief's
// item 2: "run in a bounded Web Worker; the simulation suspends once
// settled").
//
// Pure and injectable: { post(message, transfer), schedule(fn), now() }.
// layout.worker.js is the five-line shim that wires it to `self`; the tests
// drive it directly and through layoutClient.js with a fake worker.
//
// Messages in (every one names its job; another job's message is ignored):
//   { type: 'init', job, layout: 'force' | 'radial', nodes, links, positions, options }
//   { type: 'pin', job, id, x, y }   { type: 'unpin', job, id }
//   { type: 'reheat', job }          { type: 'stop', job }
// Messages out:
//   { type: 'tick', job, seq, xy }                 (xy: Float32Array, transferred; at most every postEveryMs)
//   { type: 'settled', job, seq, xy, ticks, reason: 'settled' | 'cap' }
//   { type: 'error', job, code: 'too_large' | 'bad_input' | 'unknown_layout' | 'failed' }
//   { type: 'error', job, code: 'refused' }   (a pin or unpin of a dot it does not hold; the job stays)
//
// Bounds: at most WORKER_LIMITS.maxNodes dots and maxLinks lines; each batch
// of ticks stops at batchMs; a run stops at maxTicks or after maxRunMs of
// wall-clock time, whichever comes first, even if it has not settled (reason
// 'cap'). A layout that needs no ticks (every place saved, or a radial tree)
// is answered at once. Once settled or capped nothing is scheduled again
// until a pin, an unpin or a reheat starts a new, equally bounded run.
// =============================================================================

import { createForceLayout, radialTree } from './layout.js'

export const WORKER_LIMITS = Object.freeze({
  maxNodes: 20000,
  maxLinks: 60000,
  batchMs: 8,
  maxTicks: 600,
  maxRunMs: 10000,
  postEveryMs: 32, // ticks keep running between posts; the page draws at most ~30 times a second while it settles
})

function validInput(nodes, links) {
  if (!Array.isArray(nodes) || !Array.isArray(links)) return false
  for (const n of nodes) if (!n || typeof n.id !== 'string') return false
  const n = nodes.length
  for (const l of links) {
    if (!Array.isArray(l) || l.length < 2) return false
    if (!Number.isInteger(l[0]) || !Number.isInteger(l[1]) || l[0] < 0 || l[1] < 0 || l[0] >= n || l[1] >= n) return false
  }
  return true
}

export function createLayoutWorkerCore({ post, schedule, now, limits = {} }) {
  const L = { ...WORKER_LIMITS, ...limits } // a partial override keeps the other bounds
  let job = null // the force run: { id, layout, indexOf, seq, ticks, runTicks, runStart, running }
  let lastId = null // the latest init's job id

  const send = (msg) => post(msg, msg.xy ? [msg.xy.buffer] : [])
  const snapshot = (j) => j.layout.write(new Float32Array(j.layout.n * 2))

  function run(j) {
    if (job !== j || j.running) return
    j.running = true
    j.runTicks = 0
    j.runStart = now()
    schedule(() => step(j))
  }

  function step(j) {
    if (job !== j) return // stopped or replaced: this run ends here
    const t0 = now()
    let done = j.layout.settled() // nothing to move (every place saved)
    let reason = 'settled'
    while (!done) {
      j.layout.tick(1)
      j.ticks++
      j.runTicks++
      if (j.layout.settled()) { done = true; break }
      if (j.runTicks >= L.maxTicks || now() - j.runStart >= L.maxRunMs) { done = true; reason = 'cap'; break }
      if (now() - t0 >= L.batchMs) break
    }
    if (done) {
      j.seq++
      j.running = false
      j.layout.releaseHolds()
      send({ type: 'settled', job: j.id, seq: j.seq, xy: snapshot(j), ticks: j.ticks, reason })
      return // suspended: nothing more is scheduled
    }
    // Positions go to the page at most every postEveryMs: fewer copies and
    // frames on the main thread while the layout settles, so a press is
    // still answered quickly (measured: feedback while streaming, hand-off).
    if (j.lastPost == null || now() - j.lastPost >= L.postEveryMs) {
      j.seq++
      j.lastPost = now()
      send({ type: 'tick', job: j.id, seq: j.seq, xy: snapshot(j) })
    }
    schedule(() => step(j))
  }

  function init(msg) {
    job = null
    const { job: id, layout, nodes, links, positions, options } = msg
    lastId = id
    if (!validInput(nodes, links)) return send({ type: 'error', job: id, code: 'bad_input' })
    if (nodes.length > L.maxNodes || links.length > L.maxLinks) return send({ type: 'error', job: id, code: 'too_large' })
    if (layout === 'radial') {
      const xy = radialTree({ nodes, options })
      return send({ type: 'settled', job: id, seq: 1, xy, ticks: 0, reason: 'settled' })
    }
    if (layout !== 'force') return send({ type: 'error', job: id, code: 'unknown_layout' })
    const j = {
      id, layout: createForceLayout({ nodes, links, positions, options }),
      indexOf: new Map(nodes.map((n, i) => [n.id, i])), seq: 0, ticks: 0, runTicks: 0, runStart: 0, lastPost: null, running: false,
    }
    job = j
    run(j)
  }

  return {
    handle(msg) {
      try {
        if (!msg || typeof msg.type !== 'string') return
        if (msg.type === 'init') return init(msg)
        if (!job || msg.job !== job.id) {
          // The latest job with nothing to tick (a radial tree, a refused
          // init): answered, so the client never waits on silence. An older
          // job's message is ignored.
          if (msg.job === lastId && msg.type !== 'stop') send({ type: 'error', job: msg.job, code: 'refused' })
          return
        }
        const i = msg.id != null ? job.indexOf.get(msg.id) : undefined
        // A pin or unpin it cannot apply is answered, never left silent, so
        // the client's watchdog does not mistake it for a hung worker.
        const refuse = () => send({ type: 'error', job: job.id, code: 'refused' })
        switch (msg.type) {
          case 'pin':
            if (i === undefined || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return refuse()
            job.layout.pin(i, msg.x, msg.y) // moves its neighbourhood, holds the rest
            return run(job)
          case 'unpin':
            if (i === undefined) return refuse()
            job.layout.unpin(i)
            return run(job)
          case 'reheat':
            job.layout.reheat()
            return run(job)
          case 'stop':
            job = null
            return
          default:
            return
        }
      } catch {
        const id = msg && msg.job
        job = null
        send({ type: 'error', job: id, code: 'failed' })
      }
    },
    /** For tests: whether a run is in progress. */
    running: () => !!(job && job.running),
  }
}
