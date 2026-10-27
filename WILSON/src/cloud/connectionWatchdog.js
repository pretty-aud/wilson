// =============================================================================
// connectionWatchdog — Track B bundle B2, part 2 (the honest surface for the
// silent hang), and S1 of night 2 (2026-10-27): the recovery.
//
// THE DEFECT (OUTSTANDING.md, measured S21; reproduced on demand by
// scripts/probes/connection-hang.mjs): when the network drops packets without
// closing the socket — a router that went away, a captive portal, a laptop
// lid, a VPN that stopped forwarding — a fetch never settles. The browser
// reports `navigator.onLine === true`, no error fires, and the request is
// simply pending forever. If that request is auth-js's token refresh, EVERY
// later PostgREST and Storage call waits behind it: supabase-js awaits
// `_getAccessToken()` before each request, that awaits `getSession()`, and
// auth-js runs one caller at a time through its own queue (`lockAcquired` +
// `pendingInLock`, GoTrueClient.js as installed) — the app's lock function
// is a no-op (`persistSession: false` never picks `navigatorLock`), so the
// queue IS the pin, and no SDK timeout bounds it. `withTimeout` cannot unpin
// it because it races rather than aborts.
//
// WHAT THIS DOES (docs/design/RECONNECT_DESIGN.md): it wraps the ONE fetch
// supabase-js uses (passed as `global.fetch` to createClient — the same
// function reaches GoTrue, PostgREST and Storage), gives every watched
// request its own AbortController, and keeps a table of them in flight.
//
//   1. THE ABORT. A watched request pending past its budget while the browser
//      still says it is online is ABORTED, not only counted. Measured (the
//      probe's phase E): the SDK reads the rejected refresh as retryable,
//      keeps the session, and retries by itself — one more attempt 200 ms
//      later, then the next queued caller's turn — so the moment the network
//      answers, an attempt lands, TOKEN_REFRESHED fires and every caller
//      still queued completes with the same client. No reload. A PostgREST
//      or storage request that hangs on its own fails at the budget instead
//      of never, and its caller's own error path runs.
//   2. `lost`, PER FAMILY. The first abort of a family (`auth`, `rest`,
//      `storage`) marks it lost; the strip shows while any family is lost.
//      A family clears ONLY when one of its requests RESOLVES with a status
//      under 500 (an answer is a connection; an abort, a rejection, a 5xx
//      from the gateway are not), so an aborted request never clears what
//      it raised (the strip would blink), and a PostgREST answer never
//      clears a GoTrue that is still stuck (review round 1, F1).
//   3. THE PING. While a family is lost it is asked every PING_EVERY_MS with
//      a PING_BUDGET_MS budget: GET /auth/v1/health, HEAD /rest/v1/, or a
//      HEAD of the hung object, with the `apikey` of the request that hung
//      (both remembered from it: no new seam in the client module). An
//      answered ping clears its family and ABORTS the family's requests that
//      were already pending when it was sent — after a sleep-wake or a VPN
//      reset the old connection is dead and would sit until its own budget;
//      aborting it makes the SDK's next attempt the next thing on the wire.
//   4. THE PHASE. `ok` → `reconnecting` (the strip's first sentence) →
//      `reload` after RELOAD_AFTER_MS lost (today's sentence; the pings go
//      on, so a late answer still clears). The clock runs from the first
//      raise; later aborts do not restart it.
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
// round trip on this platform (hundreds of milliseconds), under the time a
// person stays looking at a screen, and above the auth screens' own 15 s
// ceilings (withTimeout), so a sign-in or an MFA verify is abandoned by its
// screen before it is aborted here. A request WITH a body gets one second
// more per 50 KB of it (a 1 MB course save: 40 s), so a slow uplink is not
// read as a dead one (round 1, F5). The ticker runs only while something is
// pending or a family is lost, so an idle, connected app has no timer.
//
// What an abort can cost, and why it is not worse than today: a write
// aborted at the budget may have landed (the person's retry of a CREATE can
// duplicate it; today the same write hangs and the same duplicate follows
// the reload); a refresh aborted after GoTrue rotated the token is refused
// on the retry outside GoTrue's reuse interval and the session is removed
// (today the same refusal follows the reload, which holds the same token).
// Both in docs/design/RECONNECT_DESIGN.md §5.
//
// No React here; ConnectionLostBanner and ConnectionDot subscribe through
// useSyncExternalStore. supabaseClient.js composes the guard below with the
// wrapper (the guard outside, so a refused request is never tracked).
// =============================================================================

export const WATCHDOG_BUDGET_MS = 20_000
const WATCHDOG_TICK_MS = 1_000
export const PING_EVERY_MS = 10_000
export const PING_BUDGET_MS = 5_000
export const RELOAD_AFTER_MS = 60_000
/** One second of budget per this many body bytes (a 400 kbit/s uplink). */
export const BODY_BYTES_PER_SECOND = 51_200

function urlOf(input) {
  if (typeof input === 'string') return input
  if (input && typeof input.url === 'string') return input.url   // Request
  if (input && typeof input.href === 'string') return input.href // URL
  return String(input ?? '')
}

function pathOf(input) {
  const s = urlOf(input)
  const i = s.indexOf('://')
  if (i === -1) return s
  const slash = s.indexOf('/', i + 3)
  return slash === -1 ? '/' : s.slice(slash)
}

function originOf(input) {
  const s = urlOf(input)
  const i = s.indexOf('://')
  if (i === -1) return ''
  const slash = s.indexOf('/', i + 3)
  return slash === -1 ? s : s.slice(0, slash)
}

function methodOf(input, init) {
  const m = init?.method ?? (input && typeof input === 'object' && typeof input.method === 'string' ? input.method : 'GET')
  return String(m || 'GET').toUpperCase()
}

/** A header's value from an init's headers (a Headers, an array of pairs, or a plain object), case-insensitively. */
export function headerOf(init, name) {
  const h = init?.headers
  if (!h) return null
  const want = name.toLowerCase()
  if (typeof h.get === 'function') return h.get(name) ?? null
  if (Array.isArray(h)) {
    const hit = h.find(([k]) => String(k).toLowerCase() === want)
    return hit ? String(hit[1]) : null
  }
  for (const k of Object.keys(h)) if (k.toLowerCase() === want) return h[k] == null ? null : String(h[k])
  return null
}

/** The size of a request body in bytes, where it can be known; 0 otherwise. */
function bodyBytes(init) {
  const b = init?.body
  if (b == null) return 0
  if (typeof b === 'string') return b.length
  if (typeof b.byteLength === 'number') return b.byteLength   // ArrayBuffer, a view
  if (typeof b.size === 'number') return b.size               // Blob, File
  return 0
}

/**
 * Which family a request belongs to, or null when it is not watched. The
 * three families are what `lost` is kept by: a hang in one says nothing about
 * the others (a partial outage is ordinary: one gateway, several upstreams).
 */
export function familyOf(input, init) {
  const path = pathOf(input)
  const method = methodOf(input, init)
  if (path.includes('/auth/v1/')) return 'auth'
  if (path.includes('/rest/v1/')) return 'rest'
  if (path.includes('/storage/v1/upload/resumable')) return null
  if (path.includes('/storage/v1/object')) return method === 'GET' || method === 'HEAD' ? 'storage' : null
  return null
}

/** Is this request one whose duration is bounded in a healthy app? */
export function shouldWatch(input, init) {
  return familyOf(input, init) !== null
}

/** The budget for one request: the base, plus a second per BODY_BYTES_PER_SECOND of body. */
export function budgetFor(init, baseMs = WATCHDOG_BUDGET_MS, bytesPerSecond = BODY_BYTES_PER_SECOND) {
  return baseMs + Math.ceil(bodyBytes(init) / bytesPerSecond) * 1000
}

function abortError(message) {
  try { return new DOMException(message, 'AbortError') } catch { const e = new Error(message); e.name = 'AbortError'; return e }
}

/**
 * The guard the client module puts OUTSIDE the wrapper (design §3, round 1
 * F2a): once the hung refresh's own caller gets its loop's result — no
 * session — supabase-js sends that caller's request with the ANON key, which
 * on a table anon may read is an empty 200 that looks like data. While a
 * person is signed in, a PostgREST or storage request carrying the anon
 * bearer is refused here with a rejected fetch and one sentence, which
 * postgrest-js turns into the caller's error result (status 0): the caller's
 * own error path, never an empty success. Raw fetches outside the client
 * (the Edge Functions) and `/auth/v1/` itself are untouched.
 */
export const ANON_GUARD_MESSAGE = 'Signed in, but the session check failed; the request was not sent.'

export function createAnonGuard({ anonKey, isSignedIn, onRefused = null }) {
  const bearer = `Bearer ${anonKey}`
  return (baseFetch) => (input, init) => {
    if (anonKey && isSignedIn()) {
      const path = pathOf(input)
      if ((path.includes('/rest/v1/') || path.includes('/storage/v1/')) && headerOf(init, 'authorization') === bearer) {
        try { onRefused?.(path) } catch { /* a listener must not break the guard */ }
        return Promise.reject(new TypeError(ANON_GUARD_MESSAGE))
      }
    }
    return baseFetch(input, init)
  }
}

/**
 * @param {object} [opts]  every seam the test needs; the app uses the defaults
 */
export function createConnectionWatchdog(opts = {}) {
  const {
    budgetMs = WATCHDOG_BUDGET_MS,
    tickMs = WATCHDOG_TICK_MS,
    pingEveryMs = PING_EVERY_MS,
    pingBudgetMs = PING_BUDGET_MS,
    reloadAfterMs = RELOAD_AFTER_MS,
    bodyBytesPerSecond = BODY_BYTES_PER_SECOND,
    now = () => Date.now(),
    isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    watch = familyOf,
    schedule = (fn, ms) => setInterval(fn, ms),
    unschedule = (h) => clearInterval(h),
    makeAbortController = () => new AbortController(),
    windowRef = typeof window !== 'undefined' ? window : null,
  } = opts

  const pending = new Map()      // id -> { startedAt, path, method, family, budgetMs, ctl, isPing, abortedAt }
  const lostFamilies = new Map() // family -> { since, lastPingAt, pingInFlight }
  const seen = new Map()         // family -> { origin, apikey, url }: what the ping is addressed to
  const listeners = new Set()
  const recoveredListeners = new Set()
  let lostSince = null           // the first raise of the current loss; later aborts do not restart it
  let phase = 'ok'               // ok | reconnecting | reload
  let timer = null
  let seq = 0
  let pinger = null              // the base fetch, for pings

  const lostNow = () => lostFamilies.size > 0

  function emit() { for (const l of listeners) { try { l(lostNow(), phase) } catch { /* a listener must not break the store */ } } }

  function phaseAt(t) {
    if (!lostNow()) return 'ok'
    return t - lostSince >= reloadAfterMs ? 'reload' : 'reconnecting'
  }

  function settlePhase(t) {
    const next = phaseAt(t)
    if (next !== phase) { phase = next; emit() }
  }

  function raise(family, t) {
    if (lostFamilies.has(family)) return
    lostFamilies.set(family, { since: t, lastPingAt: -Infinity })
    if (lostSince == null) lostSince = t
    if (timer == null) timer = schedule(evaluate, tickMs)
  }

  /** A ping of this family still on the wire (an aborted one is not). */
  function pingInFlight(family) {
    for (const p of pending.values()) if (p.isPing && p.family === family && p.abortedAt == null) return true
    return false
  }

  function clearFamily(family, t) {
    if (!lostFamilies.delete(family)) return
    if (lostFamilies.size === 0) lostSince = null
    // A ping still out for a family that has just answered is moot.
    for (const p of pending.values()) if (p.isPing && p.family === family) abort(p, t, 'the family answered')
    for (const l of recoveredListeners) { try { l(family) } catch { /* same rule */ } }
  }

  function abort(p, t, why) {
    if (p.abortedAt != null) return
    p.abortedAt = t
    try { p.ctl.abort(abortError(why)) } catch { /* an unusual controller */ }
  }

  function evaluate() {
    const t = now()
    const online = isOnline()
    if (online) {
      for (const p of pending.values()) {
        if (p.abortedAt == null && t - p.startedAt >= p.budgetMs) {
          abort(p, t, `pending for ${t - p.startedAt} ms, over the connection watchdog's budget`)
          if (!p.isPing) raise(p.family, t)
        }
      }
      for (const [family, info] of lostFamilies) {
        if (!pingInFlight(family) && t - info.lastPingAt >= pingEveryMs) ping(family, info, t)
      }
    }
    settlePhase(t)
    if (pending.size === 0 && !lostNow() && timer != null) { unschedule(timer); timer = null }
    return lostNow()
  }

  function track(input, init, family, ctl, extra = {}) {
    const id = ++seq
    const entry = {
      id, startedAt: now(), path: pathOf(input), method: methodOf(input, init), family, ctl,
      budgetMs: extra.budgetMs ?? budgetFor(init, budgetMs, bodyBytesPerSecond),
      isPing: !!extra.isPing, abortedAt: null,
    }
    pending.set(id, entry)
    if (!entry.isPing) {
      const apikey = headerOf(init, 'apikey')
      const prev = seen.get(family)
      seen.set(family, { origin: originOf(input) || prev?.origin || '', apikey: apikey ?? prev?.apikey ?? null, url: urlOf(input) })
    }
    if (timer == null) timer = schedule(evaluate, tickMs)
    return entry
  }

  /** A request settled: an answer under 500 clears its family; anything else only releases it. */
  function settle(entry, res) {
    if (!pending.delete(entry.id)) return
    const answered = !!res && typeof res.status === 'number' && res.status < 500
    if (answered) {
      const t = now()
      if (entry.isPing) {
        // The ping answered: the family is reachable, so whatever of it was
        // already pending when the ping went out is on a dead connection.
        for (const p of pending.values()) {
          if (p.family === entry.family && !p.isPing && p.startedAt < entry.startedAt) abort(p, t, 'the service answered a newer request; this one is on a dead connection')
        }
      }
      clearFamily(entry.family, t)
    }
    evaluate()
  }

  function ping(family, info, t) {
    if (!pinger) return
    const where = seen.get(family)
    if (!where?.origin) return
    let url, method
    if (family === 'auth') { url = `${where.origin}/auth/v1/health`; method = 'GET' }
    else if (family === 'rest') { url = `${where.origin}/rest/v1/`; method = 'HEAD' }
    else { url = where.url; method = 'HEAD' }
    const headers = where.apikey ? { apikey: where.apikey } : {}
    const ctl = makeAbortController()
    const init = { method, headers, signal: ctl.signal }
    info.lastPingAt = t
    const entry = track(url, init, family, ctl, { isPing: true, budgetMs: pingBudgetMs })
    let p
    try { p = pinger(url, init) } catch { settle(entry, null); return }
    Promise.resolve(p).then((res) => settle(entry, res), () => settle(entry, null))
  }

  /** Wrap a fetch. Unwatched requests pass straight through, untouched. */
  function wrapFetch(baseFetch) {
    pinger = baseFetch
    return (input, init) => {
      const family = watch(input, init)
      if (!family) return baseFetch(input, init)
      const ctl = makeAbortController()
      // A caller's own signal (supabase-js `.abortSignal()`) is honoured: its
      // abort aborts ours. It is a settle, never a loss.
      const outer = init?.signal
      if (outer) {
        if (outer.aborted) ctl.abort(outer.reason)
        else outer.addEventListener('abort', () => ctl.abort(outer.reason), { once: true })
      }
      const entry = track(input, init, family, ctl)
      let p
      try {
        p = baseFetch(input, { ...init, signal: ctl.signal })
      } catch (err) {
        settle(entry, null)
        throw err
      }
      return Promise.resolve(p).then(
        (res) => { settle(entry, res); return res },
        (err) => { settle(entry, null); throw err },
      )
    }
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  /** Called with the family's name each time a lost family clears (the client module's nudge). */
  function onRecovered(listener) {
    recoveredListeners.add(listener)
    return () => { recoveredListeners.delete(listener) }
  }

  if (windowRef?.addEventListener) {
    // Going offline turns a silent hang into a loud error within seconds and
    // the strip is not for that case; coming back online with a request
    // still pending is exactly its case. Either way, re-judge now.
    windowRef.addEventListener('online', evaluate)
    windowRef.addEventListener('offline', evaluate)
  }

  return {
    wrapFetch,
    subscribe,
    onRecovered,
    getSnapshot: () => lostNow(),
    getPhase: () => phase,
    evaluate,
    pendingCount: () => [...pending.values()].filter((p) => !p.isPing).length,
    pingsInFlight: () => [...pending.values()].filter((p) => p.isPing).length,
    lostFamilies: () => [...lostFamilies.keys()],
    overdueSince: () => lostSince,
    /** Test seam: tear down the ticker and forget every request and every loss (nothing is aborted). */
    reset() {
      pending.clear()
      lostFamilies.clear()
      lostSince = null
      if (timer != null) { unschedule(timer); timer = null }
      if (phase !== 'ok') { phase = 'ok'; emit() }
    },
  }
}

/** The app-wide instance. supabaseClient.js wraps its fetch with this one. */
export const connectionWatchdog = createConnectionWatchdog()
