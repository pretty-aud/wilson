// =============================================================================
// connectionWatchdog — Track B bundle B2, part 2: the honest surface for the
// silent hang (fix plan answer 10, "a connection lost, reload banner").
//
// THE DEFECT IT SURFACES (OUTSTANDING.md, measured S21; reproduced again for
// this bundle by scripts/probes/connection-hang.mjs): when the network drops
// packets without closing the socket — a router that went away, a captive
// portal, a laptop lid, a VPN that stopped forwarding — a fetch never
// settles. The browser reports `navigator.onLine === true`, no error fires,
// and the request is simply pending forever. If that request is auth-js's
// token refresh, EVERY later PostgREST and Storage call waits behind it:
// supabase-js awaits `_getAccessToken()` before each request, that awaits
// `getSession()`, and an in-flight refresh is shared through auth-js's
// `refreshingDeferred` (and its lock, where one is in use). One hung refresh
// pins the whole app, and `withTimeout` cannot unpin it because it races
// rather than aborts. Bounding N call sites fixes N UIs, not the app.
//
// WHAT THIS DOES: it wraps the ONE fetch supabase-js uses (passed as
// `global.fetch` to createClient — the same function reaches GoTrue,
// PostgREST and Storage) and keeps a table of watched requests in flight.
// When any watched request has been pending longer than its budget while the
// browser still says it is online, the store flips to `lost` and
// ConnectionLostBanner shows "Connection lost — reload to continue". A watched
// request that settles late clears the condition again (a slow link is not a
// dead one). Reload is the remedy because the SDK's shared refresh promise
// cannot be cancelled from outside; proper reconnect logic is deferred by
// Audrey's choice (answer 10).
//
// WHAT IT WATCHES — bounded calls only:
//   /auth/v1/*                   token refresh, sign-in, MFA — the hang class
//   /rest/v1/*                   PostgREST reads and writes
//   GET|HEAD /storage/v1/object  downloads: fetch resolves at the headers,
//                                the body streams afterwards, outside this
//
// WHAT IT NEVER WATCHES — things that legitimately run for minutes:
//   POST|PUT /storage/v1/object  plain uploads (a 200 MB file on a slow link)
//   /storage/v1/upload/resumable the TUS path (tus-js-client uses its own XHR
//                                anyway)
//   /functions/v1/*              every Edge Function call in this codebase is
//                                a raw fetch outside the client (aiProxy,
//                                adminApi, storageApi, operatorApi — the AI
//                                stream included), and a function may run to
//                                its 150-second wall clock; excluded here too
//                                so a future functions.invoke() cannot trip it
//   realtime                     a websocket, not a fetch
//
// The budget is 20 seconds: an order of magnitude above a healthy PostgREST
// round trip on this platform (hundreds of milliseconds) and short enough that
// the banner appears while the person is still looking at the screen. The
// ticker runs only while something is pending, so an idle app has no timer.
//
// No React here; ConnectionLostBanner subscribes through useSyncExternalStore.
// =============================================================================

export const WATCHDOG_BUDGET_MS = 20_000
export const WATCHDOG_TICK_MS = 1_000

function pathOf(input) {
  let s
  if (typeof input === 'string') s = input
  else if (input && typeof input.url === 'string') s = input.url   // Request
  else if (input && typeof input.href === 'string') s = input.href // URL
  else s = String(input ?? '')
  const i = s.indexOf('://')
  if (i === -1) return s
  const slash = s.indexOf('/', i + 3)
  return slash === -1 ? '/' : s.slice(slash)
}

function methodOf(input, init) {
  const m = init?.method ?? (input && typeof input === 'object' && typeof input.method === 'string' ? input.method : 'GET')
  return String(m || 'GET').toUpperCase()
}

/** Is this request one whose duration is bounded in a healthy app? */
export function shouldWatch(input, init) {
  const path = pathOf(input)
  const method = methodOf(input, init)
  if (path.includes('/auth/v1/')) return true
  if (path.includes('/rest/v1/')) return true
  if (path.includes('/storage/v1/upload/resumable')) return false
  if (path.includes('/storage/v1/object')) return method === 'GET' || method === 'HEAD'
  return false
}

/**
 * @param {object} [opts]  every seam the test needs; the app uses the defaults
 */
export function createConnectionWatchdog(opts = {}) {
  const {
    budgetMs = WATCHDOG_BUDGET_MS,
    tickMs = WATCHDOG_TICK_MS,
    now = () => Date.now(),
    isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    watch = shouldWatch,
    schedule = (fn, ms) => setInterval(fn, ms),
    unschedule = (h) => clearInterval(h),
    windowRef = typeof window !== 'undefined' ? window : null,
  } = opts

  const pending = new Map()    // id -> { startedAt, path, method }
  const listeners = new Set()
  let lost = false
  let overdueSince = null      // when the current `lost` began (for the banner's copy, if it ever wants it)
  let timer = null
  let seq = 0

  function emit() { for (const l of listeners) { try { l(lost) } catch { /* a listener must not break the store */ } } }

  function evaluate() {
    const t = now()
    let overdue = null
    for (const p of pending.values()) {
      if (t - p.startedAt >= budgetMs) { overdue = p; break }
    }
    const next = !!overdue && isOnline()
    if (next !== lost) {
      lost = next
      overdueSince = next ? t : null
      emit()
    }
    if (pending.size === 0 && timer != null) { unschedule(timer); timer = null }
    return lost
  }

  function track(input, init) {
    const id = ++seq
    pending.set(id, { startedAt: now(), path: pathOf(input), method: methodOf(input, init) })
    if (timer == null) timer = schedule(evaluate, tickMs)
    let released = false
    return () => {
      if (released) return
      released = true
      pending.delete(id)
      evaluate()
    }
  }

  /** Wrap a fetch. Unwatched requests pass straight through, untouched. */
  function wrapFetch(baseFetch) {
    return (input, init) => {
      if (!watch(input, init)) return baseFetch(input, init)
      const release = track(input, init)
      let p
      try {
        p = baseFetch(input, init)
      } catch (err) {
        release()
        throw err
      }
      return Promise.resolve(p).finally(release)
    }
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  if (windowRef?.addEventListener) {
    // Going offline turns a silent hang into a loud error within seconds and
    // the banner is not for that case; coming back online with a request
    // still pending is exactly its case. Either way, re-judge now.
    windowRef.addEventListener('online', evaluate)
    windowRef.addEventListener('offline', evaluate)
  }

  return {
    wrapFetch,
    subscribe,
    getSnapshot: () => lost,
    evaluate,
    pendingCount: () => pending.size,
    overdueSince: () => overdueSince,
    /** Test seam: tear down the ticker and forget every request. */
    reset() {
      pending.clear()
      if (timer != null) { unschedule(timer); timer = null }
      if (lost) { lost = false; overdueSince = null; emit() }
    },
  }
}

/** The app-wide instance. supabaseClient.js wraps its fetch with this one. */
export const connectionWatchdog = createConnectionWatchdog()
