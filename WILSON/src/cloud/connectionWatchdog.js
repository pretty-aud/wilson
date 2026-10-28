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
//      answered ping ABORTS the family's requests that were already pending
//      when it was sent — after a sleep-wake or a VPN reset the old
//      connection is dead and would sit until its own budget; aborting it
//      makes the SDK's next attempt the next thing on the wire. Whether it
//      CLEARS the family depends on what it proves (review round 2, F2):
//      the storage ping repeats the hung request itself, so it clears; the
//      auth and rest pings answer from the gateway and the schema cache even
//      while the database behind them is stuck, so they clear nothing — they
//      tell the client module (`onPingAnswered`), which asks for real: the
//      session for auth (the SDK's refresh), a HEAD of one table for rest —
//      and that REAL answer clears. Otherwise a stalled database read as a
//      recovery every ten seconds: the strip flickering, re-announced, and
//      never reaching "reload".
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
// more per whole 50 KB of it (bytes, not characters; a body under 50 KB
// adds nothing; a 1 MB course save: 40 s), so a slow uplink is not read as
// a dead one (round 1, F5). The ticker runs only while something is pending
// or a family is lost, so an idle, connected app has no timer.
//
// What an abort can cost, and why it is not worse than today: a write
// aborted at the budget may have landed (the person's retry of a CREATE can
// duplicate it; today the same write hangs and the same duplicate follows
// the reload); a refresh aborted after GoTrue rotated the token is refused
// on the retry outside GoTrue's reuse interval and the session is removed
// (today the same refusal follows the reload, which holds the same token).
// Both in docs/design/RECONNECT_DESIGN.md §5.
//
// S2 (night 3, 2026-10-27; RECONNECT_DESIGN.md §11): THE OFFLINE LAUNCH. A
// saved sign-in inside the 4-hour cap that cannot reach the cloud opens the
// shell offline, and this module holds the network half of it: `launchProbe`,
// the launch's one health question to GoTrue (the only new budget, 5 s, on a
// request the launch adds, never on one the SDK sends); `restoreSavedSession`,
// the decision itself (exported so the probe runs the code the app runs);
// `launchedOffline`, the auth family marked lost from the first paint, with
// "reconnecting" kept until it answers and its pings sent whether or not the
// browser says online; `launchEnded`, the loss lowered when a hold ends with
// nothing left to ask; `quietWhile`, no auth ping while the re-hydration's own
// request is out; and `rehydrateSession`, the saved session given to the SDK
// again on the first answered ping. None of S1's numbers moves.
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
/** S2: the launch's health question to GoTrue (§11.4 step 3): the ping's own budget. */
export const LAUNCH_BUDGET_MS = 5_000
/** S2: the whole decision inside the cap, from the probe: two launch budgets. */
export const LAUNCH_CEILING_MS = 10_000

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
  if (typeof b === 'string') {
    // bytes, not UTF-16 units: a body of accented text is half again as long on the wire
    try { return new TextEncoder().encode(b).byteLength } catch { return b.length }
  }
  if (typeof b.byteLength === 'number') return b.byteLength   // ArrayBuffer, a view
  if (b instanceof Blob) return b.size                         // Blob, File (not URLSearchParams's pair count)
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

/** The budget for one request: the base, plus a second per whole BODY_BYTES_PER_SECOND of body. */
export function budgetFor(init, baseMs = WATCHDOG_BUDGET_MS, bytesPerSecond = BODY_BYTES_PER_SECOND) {
  return baseMs + Math.floor(bodyBytes(init) / bytesPerSecond) * 1000
}

// The reason a caller sees (postgrest-js prefixes it with the error's name in
// the result's message, which a view may show): a sentence, not a stack.
function abortError(message) {
  try { return new DOMException(message, 'AbortError') } catch { const e = new Error(message); e.name = 'AbortError'; return e }
}
const cancelledAfter = (ms) => `The request was cancelled after ${Math.round(ms / 1000)} seconds without an answer (the connection watchdog).`
const CANCELLED_DEAD = 'The request was cancelled: the service answered a newer request, so this one was on a dead connection (the connection watchdog).'

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
/** S2: the guard's reason while a session is held at an offline launch (§11.5). */
export const HELD_GUARD_MESSAGE = 'Could not reach the database, so the request was not sent.'

export function createAnonGuard({ anonKey, isSignedIn, onRefused = null, message = null }) {
  const bearer = `Bearer ${anonKey}`
  return (baseFetch) => (input, init) => {
    if (anonKey && isSignedIn()) {
      const path = pathOf(input)
      if ((path.includes('/rest/v1/') || path.includes('/storage/v1/')) && headerOf(init, 'authorization') === bearer) {
        try { onRefused?.(path) } catch { /* a listener must not break the guard */ }
        let reason = ANON_GUARD_MESSAGE
        try { reason = (typeof message === 'function' ? message() : null) || ANON_GUARD_MESSAGE } catch { /* the default reason */ }
        return Promise.reject(new TypeError(reason))
      }
    }
    return baseFetch(input, init)
  }
}

// ── S2: the offline launch's decision (RECONNECT_DESIGN.md §11.2, §11.4) ────

/**
 * What a failed restore says about the auth server, by auth-js's own error
 * classes as installed (lib/fetch.js handleError, lib/errors.js):
 *   'unreached'     it could not be reached: a rejected or aborted fetch, an
 *                   answer that is not GoTrue's JSON (AuthRetryableFetchError,
 *                   AuthUnknownError), or any 5xx
 *   'refused-ends'  GoTrue refused the saved session for good: 400 (a spent or
 *                   invalid refresh token), 401, 403, session_not_found, a token
 *                   that cannot be decoded — the store may be cleared
 *   'refused-keeps' any other answer (404, 429, an unexpected error): the
 *                   sign-in screen as today, the store kept
 */
export function classifyAuthFailure(error) {
  if (!error) return 'refused-keeps'
  const name = error.name
  const status = typeof error.status === 'number' ? error.status : null
  if (name === 'AuthRetryableFetchError' || name === 'AuthUnknownError') return 'unreached'
  if (status != null && status >= 500) return 'unreached'
  if (name === 'AuthSessionMissingError' || name === 'AuthInvalidJwtError') return 'refused-ends'
  if (status === 400 || status === 401 || status === 403) return 'refused-ends'
  return 'refused-keeps'
}

/**
 * The launch's decision for a saved session INSIDE the cap (§11.4 steps 3–5).
 * `probe()` resolves whether GoTrue answered its health question (the
 * watchdog's launchProbe); only then is the SDK asked (`auth.setSession`, with
 * S1's budgets), and the whole is raced against `ceilingMs`. Resolves:
 *   { outcome: 'online', session }      the SDK holds the session: the shell, as today
 *   { outcome: 'held', reason, late? }  nothing answered: the caller holds `saved`;
 *                                       `late` is the SDK's restore still running
 *                                       when the ceiling decided (its answer is handled)
 *   { outcome: 'refused', error }       the store may be cleared (compare-and-clear)
 *   { outcome: 'none', error }          the sign-in screen as today
 * Never a real request when the probe is not answered.
 */
export async function restoreSavedSession({ auth, saved, probe, ceilingMs = LAUNCH_CEILING_MS, timers = globalThis }) {
  let timer = null
  const ceiling = new Promise((resolve) => { timer = timers.setTimeout(() => resolve({ timedOut: true }), ceilingMs) })
  try {
    const asked = await Promise.race([
      Promise.resolve().then(() => probe()).then((ok) => ({ ok: ok === true }), () => ({ ok: false })),
      ceiling,
    ])
    if (asked.timedOut) return { outcome: 'held', reason: 'ceiling' }
    if (!asked.ok) return { outcome: 'held', reason: 'probe' }
    const restore = Promise.resolve().then(() => auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token }))
    const r = await Promise.race([restore.then((value) => ({ value }), (thrown) => ({ thrown })), ceiling])
    if (r.timedOut) return { outcome: 'held', reason: 'ceiling', late: restore }
    if (r.thrown) return { outcome: 'none', error: r.thrown }
    const { data, error } = r.value || {}
    if (!error && data?.session) return { outcome: 'online', session: data.session }
    const kind = classifyAuthFailure(error)
    if (kind === 'unreached') return { outcome: 'held', reason: 'unreached', error }
    if (kind === 'refused-ends') return { outcome: 'refused', error }
    return { outcome: 'none', error }
  } finally {
    if (timer != null) timers.clearTimeout(timer)
  }
}

/**
 * The re-hydration (§11.5): the held session given to the SDK again, on the
 * first answered auth ping. 'online' (the SDK emitted SIGNED_IN or
 * TOKEN_REFRESHED), 'refused' (for good: the session is over), or 'unreached'
 * (keep holding; the next answered ping asks again — a 404 or 429 included).
 */
export async function rehydrateSession({ auth, held }) {
  let r
  try { r = await auth.setSession({ access_token: held.access_token, refresh_token: held.refresh_token }) }
  catch (error) { return { outcome: 'unreached', error } }
  if (!r?.error && r?.data?.session) return { outcome: 'online', session: r.data.session }
  return { outcome: classifyAuthFailure(r?.error) === 'refused-ends' ? 'refused' : 'unreached', error: r?.error ?? null }
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
    launchBudgetMs = LAUNCH_BUDGET_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (h) => clearTimeout(h),
  } = opts

  const pending = new Map()      // id -> { startedAt, path, method, family, budgetMs, ctl, isPing, abortedAt }
  const lostFamilies = new Map() // family -> { since, lastPingAt, pingInFlight }
  const seen = new Map()         // family -> { origin, apikey, url }: what the ping is addressed to
  const listeners = new Set()
  const recoveredListeners = new Set()
  const pingListeners = new Set()
  const quiet = new Map()        // S2: family -> how many quietWhile() are out (no ping meanwhile)
  let lostSince = null           // the first raise of the current loss; later aborts do not restart it
  let phase = 'ok'               // ok | reconnecting | reload
  let timer = null
  let seq = 0
  let pinger = null              // the base fetch, for pings
  let launchRaised = false       // S2: the auth loss was raised by an offline launch (launchedOffline)
  let neverAnswered = false      // S2: ...and it has not answered since: the words stay "reconnecting"

  const lostNow = () => lostFamilies.size > 0

  function emit() { for (const l of listeners) { try { l(lostNow(), phase) } catch { /* a listener must not break the store */ } } }

  function phaseAt(t) {
    if (!lostNow()) return 'ok'
    // S2: a launch that was never online says "reconnecting" throughout: a
    // reload would only launch offline again (her ruling of 2026-10-27).
    if (neverAnswered) return 'reconnecting'
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

  function clearFamily(family, t, { announce = true } = {}) {
    if (!lostFamilies.delete(family)) return
    if (lostFamilies.size === 0) lostSince = null
    if (family === 'auth') { launchRaised = false; neverAnswered = false }
    // A ping still out for a family that has just answered is moot.
    for (const p of pending.values()) if (p.isPing && p.family === family) abort(p, t, 'the family answered')
    if (!announce) return
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
    for (const p of pending.values()) {
      // S1: a real request is aborted at its budget only while the browser
      // says online. S2 (build review round 1): a PING is ours, and is cut at
      // its budget whatever the browser says — a launch-raised loss is pinged
      // while it says offline, and one hung ping would block the next. And
      // (build review round 2, F3) while a launch-raised auth loss is up, the
      // held work's own auth request is cut at S1's budget whatever the
      // browser says: quietWhile keeps the pings away meanwhile, so nothing
      // else would ever end a stall on a working network the browser calls
      // offline.
      const cut = online || p.isPing || (p.family === 'auth' && launchRaised)
      if (p.abortedAt == null && t - p.startedAt >= p.budgetMs && cut) {
        abort(p, t, cancelledAfter(t - p.startedAt))
        if (!p.isPing) raise(p.family, t)
      }
    }
    for (const [family, info] of lostFamilies) {
      // S2: a loss an offline launch raised is pinged whether or not the
      // browser says online (a virtual adapter can say offline on a working
      // network; on a dead one the ping fails at once); every other loss only
      // while it says online, as S1 built it. No ping while quietWhile() is out.
      const mayPing = online || (family === 'auth' && launchRaised)
      if (mayPing && !quiet.get(family) && !pingInFlight(family) && t - info.lastPingAt >= pingEveryMs) ping(family, info, t)
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

  /**
   * A request settled. An answer under 500 to a REAL request clears its
   * family; an answer that lands after the request was aborted is a
   * coincidence and clears nothing (the abort is what raised the loss). An
   * answered ping aborts the family's older pending requests; it clears the
   * family only for storage (the ping repeats the hung request itself), and
   * for auth and rest it tells the client module, which asks for real.
   */
  function settle(entry, res) {
    if (!pending.delete(entry.id)) return
    const answered = !!res && typeof res.status === 'number' && res.status < 500 && entry.abortedAt == null
    if (answered) {
      const t = now()
      if (entry.isPing) {
        for (const p of pending.values()) {
          if (p.family === entry.family && !p.isPing && p.abortedAt == null && p.startedAt < entry.startedAt) abort(p, t, CANCELLED_DEAD)
        }
        if (entry.family === 'storage') clearFamily(entry.family, t)
        else for (const l of pingListeners) { try { l(entry.family) } catch { /* same rule */ } }
      } else if (!quiet.get(entry.family)) {
        // S2 (build review round 1, F2): while quietWhile() is out the answer
        // does not clear the family: the work it waits on decides (an answer
        // can hold no session — a 429, a portal's page — and the strip must
        // not go while the session is still held; launchEnded() clears on a
        // confirmation).
        clearFamily(entry.family, t)
      }
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
      // A caller's own signal (supabase-js `.abortSignal()`, or a Request's
      // own) is honoured: its abort aborts ours. It is a settle, never a loss.
      const outer = init?.signal ?? (input && typeof input === 'object' ? input.signal : null)
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

  /** Called with the family's name each time a lost family clears. */
  function onRecovered(listener) {
    recoveredListeners.add(listener)
    return () => { recoveredListeners.delete(listener) }
  }

  /**
   * Called with the family's name when an auth or rest ping answers while the
   * family is lost: the gateway is there; the client module asks for real.
   */
  function onPingAnswered(listener) {
    pingListeners.add(listener)
    return () => { pingListeners.delete(listener) }
  }

  /**
   * S2 (§11.4 step 3): the launch's one question to GoTrue, `GET /auth/v1/health`
   * with the anon key, sent with the base fetch and aborted at the launch
   * budget. Resolves true only for a 200 whose body is a JSON object (GoTrue's
   * own answer: a captive portal's page or a proxy's is not). Outside the
   * table: it raises nothing, clears nothing and tells no listener.
   */
  async function launchProbe({ origin, apikey } = {}) {
    if (!pinger || !origin) return false
    const ctl = makeAbortController()
    let handle = null
    try {
      handle = setTimer(() => { try { ctl.abort(abortError(cancelledAfter(launchBudgetMs))) } catch { /* an unusual controller */ } }, launchBudgetMs)
      const res = await pinger(`${origin}/auth/v1/health`, { method: 'GET', headers: apikey ? { apikey } : {}, signal: ctl.signal })
      if (!res || res.status !== 200 || typeof res.json !== 'function') return false
      const body = await res.json()
      return !!body && typeof body === 'object' && !Array.isArray(body)
    } catch {
      return false
    } finally {
      if (handle != null) clearTimer(handle)
    }
  }

  /**
   * S2 (§11.6): the shell is opening on a session the cloud could not
   * confirm. The auth family is lost from now (the strip from the first
   * paint, whether or not the browser says online), its ping is addressed to
   * `origin` with `apikey` (nothing has been sent at such a launch to remember
   * them from), and the words stay "reconnecting" until it answers.
   */
  function launchedOffline({ origin, apikey } = {}) {
    const t = now()
    if (origin) {
      const prev = seen.get('auth')
      seen.set('auth', { origin, apikey: apikey ?? prev?.apikey ?? null, url: `${origin}/auth/v1/health` })
    }
    launchRaised = true
    neverAnswered = true
    raise('auth', t)
    settlePhase(t)
  }

  /**
   * S2 (§11.6, round 1 F3): the hold ended with nothing left to ask (a
   * sign-out while held), or by a confirmation whose answer came before the
   * loss was raised. The loss the launch raised is lowered — unless a real
   * auth request is out, which decides as S1 built it. Not a recovery: no
   * listener is told.
   */
  function launchEnded() {
    if (!launchRaised || !lostFamilies.has('auth')) { launchRaised = false; neverAnswered = false; return }
    for (const p of pending.values()) if (p.family === 'auth' && !p.isPing && p.abortedAt == null) return
    const t = now()
    clearFamily('auth', t, { announce: false })
    evaluate()
  }

  /**
   * S2 (§11.5; design review F8, build review F2): until `promise` settles, no
   * ping of `family` is sent, and no answer of the family clears it — the
   * work being waited on (the launch's late restore, the re-hydration) is the
   * question, and its caller decides: launchEnded() on a confirmation; on
   * anything else the family stays lost and the pings resume.
   */
  function quietWhile(family, promise) {
    quiet.set(family, (quiet.get(family) || 0) + 1)
    const done = () => {
      const n = (quiet.get(family) || 1) - 1
      if (n <= 0) quiet.delete(family); else quiet.set(family, n)
    }
    Promise.resolve(promise).then(done, done)
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
    onPingAnswered,
    launchProbe,
    launchedOffline,
    launchEnded,
    quietWhile,
    launchRaised: () => launchRaised,
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
      quiet.clear()
      launchRaised = false
      neverAnswered = false
      lostSince = null
      if (timer != null) { unschedule(timer); timer = null }
      if (phase !== 'ok') { phase = 'ok'; emit() }
    },
  }
}

/** The app-wide instance. supabaseClient.js wraps its fetch with this one. */
export const connectionWatchdog = createConnectionWatchdog()
