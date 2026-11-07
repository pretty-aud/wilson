// =============================================================================
// layoutClient.js — the main thread's side of the layout worker (MO2a).
//
// Owns one module worker (Vite emits layout.worker.js as its own chunk, so
// nothing here enters the main bundle until the lazy Moth page loads it).
// Bounded from this side too: a watchdog ends a worker that goes silent while
// a run is in progress, and dispose() ends it outright. A failed worker is
// reported as { code } so the page can fall back (for instance to the radial
// tree, which needs no ticking) instead of hanging.
//
//   const client = createLayoutClient({ onTick, onSettled, onError })
//   const job = client.run({ layout: 'force', nodes, links, positions, options })
//   client.pin(id, x, y); client.unpin(id); client.reheat(); client.stop(); client.dispose()
// =============================================================================

const defaultWorker = () => new Worker(new URL('./layout.worker.js', import.meta.url), { type: 'module' })

const CLIENT_DEFAULTS = Object.freeze({ timeoutMs: 5000 })

export function createLayoutClient({
  createWorker = defaultWorker,
  timeoutMs = CLIENT_DEFAULTS.timeoutMs,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  onTick = () => {},
  onSettled = () => {},
  onError = () => {},
} = {}) {
  let worker = null
  let job = 0
  let busy = false
  let live = false // the worker holds this job (until stop, an error or dispose)
  let watchdog = null

  const disarm = () => { if (watchdog != null) clearTimer(watchdog); watchdog = null }
  const arm = () => {
    disarm()
    watchdog = setTimer(() => {
      watchdog = null
      if (!busy) return
      const j = job
      kill()
      onError({ job: j, code: 'timeout' })
    }, timeoutMs)
  }
  const kill = () => {
    disarm()
    busy = false
    live = false
    if (worker) { try { worker.terminate() } catch { /* already gone */ } }
    worker = null
  }

  const ensure = () => {
    if (worker) return worker
    worker = createWorker()
    worker.onmessage = (event) => {
      const m = event.data
      // A stale job's message, or one still in flight after stop(), is
      // dropped: it must not re-arm the watchdog over a worker that has
      // rightly gone quiet.
      if (!m || m.job !== job || !live) return
      if (m.type === 'tick') { busy = true; arm(); onTick(m) }
      else if (m.type === 'settled') { busy = false; disarm(); onSettled(m) }
      else if (m.type === 'error') {
        // A refused pin or unpin leaves the job (and any run in progress, whose
        // next tick re-arms the watchdog) in place; anything else ends the job.
        busy = false
        disarm()
        if (m.code !== 'refused') live = false
        onError({ job: m.job, code: m.code })
      }
    }
    worker.onerror = () => {
      const j = job
      kill()
      onError({ job: j, code: 'crashed' })
    }
    return worker
  }

  // A pin, unpin or reheat only goes to a worker that still holds the job;
  // after stop, an error or dispose it is dropped here (the worker would
  // ignore it, and the watchdog would then end a healthy worker).
  const restart = (type, extra) => {
    if (!worker || !live) return false
    busy = true
    arm()
    worker.postMessage({ type, job, ...extra })
    return true
  }

  return {
    run({ layout = 'force', nodes, links, positions = null, options = {} }) {
      job++
      ensure()
      busy = true
      live = true
      arm()
      worker.postMessage({ type: 'init', job, layout, nodes, links, positions, options })
      return job
    },
    pin: (id, x, y) => restart('pin', { id, x, y }),
    unpin: (id) => restart('unpin', { id }),
    reheat: () => restart('reheat'),
    stop() {
      if (worker && live) worker.postMessage({ type: 'stop', job })
      busy = false
      live = false
      disarm()
    },
    dispose() { job++; kill() },
    busy: () => busy,
    job: () => job,
  }
}
