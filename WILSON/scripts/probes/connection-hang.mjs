// =============================================================================
// connection-hang.mjs — Track B bundle B2, part 2: reproduce the silent hang
// the "Connection lost — reload to continue" banner exists for, and show the
// banner's watchdog catching it.
//
// THE HANG (OUTSTANDING.md "One hung getSession() pins the whole app's auth",
// measured S21): a network that drops packets without closing the socket
// leaves a fetch pending forever. If that fetch is auth-js's token refresh,
// every later PostgREST / Storage call waits behind it — supabase-js awaits
// _getAccessToken() → getSession() before each request, and an in-flight
// refresh is shared through auth-js's refreshingDeferred (and its lock where
// one is in use). Nothing errors. navigator.onLine stays true.
//
// THIS SCRIPT stands in for the dead network with a fetch that, once armed,
// never settles a request to /auth/v1/token — the same observable as a
// socket that never answers. It runs supabase-js 2.101.1 exactly as the app
// configures it (persistSession:false, autoRefreshToken:true) against the
// linked project with the anon key, and needs no password: the refresh that
// hangs is for a deliberately expired token, and the pinned read is a
// PostgREST call that would otherwise answer 200 (empty) to anon.
//
//   node scripts/probes/connection-hang.mjs .env.local            # dev
//
// Phases:
//   A  control — a PostgREST read answers in well under a second
//   B  the hang — setSession() with an expired token starts a refresh that
//      never settles; a PostgREST read then NEVER RESOLVES and NEVER ISSUES
//      A REQUEST (no /rest/v1/ line after the hang begins): that is the pin
//   C  the watchdog — the same sequence through connectionWatchdog.wrapFetch
//      with a 5-second budget raises `lost` at the budget and keeps it raised
//
// Nothing here is printed but paths, methods and milliseconds.
// =============================================================================

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { createConnectionWatchdog } from '../../src/cloud/connectionWatchdog.js'

const envPath = process.argv[2]
if (!envPath) { console.error('usage: node connection-hang.mjs <env-file>'); process.exit(2) }
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const URL_ = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
if (!URL_ || !ANON) { console.error('missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'); process.exit(2) }

const t0 = Date.now()
const ms = () => String(Date.now() - t0).padStart(6, ' ')
const log = (...a) => console.log(`[${ms()} ms]`, ...a)

function pathOf(input) {
  const s = typeof input === 'string' ? input : input?.url ?? String(input)
  const u = new URL(s)
  return u.pathname + u.search
}

/** A fetch with a switch: once armed, /auth/v1/token never settles. */
function deadNetworkFetch(label) {
  const state = { armed: false, seen: [] }
  const fetchImpl = (input, init) => {
    const path = pathOf(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    state.seen.push({ at: Date.now() - t0, method, path: path.split('?')[0] })
    if (state.armed && path.includes('/auth/v1/token')) {
      log(`${label}: ${method} ${path.split('?')[0]} → black hole (never settles)`)
      return new Promise(() => {})
    }
    return fetch(input, init)
  }
  return { state, fetchImpl }
}

function b64url(o) {
  return Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}
/** An access token auth-js will consider expired (it decodes, it does not verify). */
function expiredToken() {
  const now = Math.floor(Date.now() / 1000)
  const sub = '00000000-0000-4000-8000-000000000000'
  return `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url({
    sub, aud: 'authenticated', role: 'authenticated', session_id: '11111111-1111-4111-8111-111111111111',
    iat: now - 7200, exp: now - 3600, app_metadata: {}, user_metadata: {},
  })}.${b64url({ sig: 'not-checked-client-side' })}`
}

function race(promise, ms, label) {
  let timer
  const ceiling = new Promise(resolve => { timer = setTimeout(() => resolve({ hung: true }), ms) })
  return Promise.race([
    Promise.resolve(promise).then(v => ({ hung: false, value: v }), e => ({ hung: false, error: e })),
    ceiling,
  ]).finally(() => clearTimeout(timer)).then(r => {
    log(`${label}: ${r.hung ? `NO ANSWER after ${ms} ms` : 'answered'}${r.error ? ` (error: ${r.error.message})` : ''}`)
    return r
  })
}

function makeClient(fetchImpl) {
  return createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'sb-wilson-probe' },
    global: { fetch: fetchImpl },
  })
}

async function phaseA() {
  log('── Phase A — control: a PostgREST read on a live network')
  const { fetchImpl } = deadNetworkFetch('A')
  const sb = makeClient(fetchImpl)
  const t = Date.now()
  const { error, status } = await sb.from('workspaces').select('id').limit(1)
  log(`A: GET /rest/v1/workspaces → status ${status}${error ? ` error ${error.code ?? error.message}` : ''} in ${Date.now() - t} ms`)
}

async function phaseB() {
  log('── Phase B — the hang: one refresh that never settles pins every later call')
  const { state, fetchImpl } = deadNetworkFetch('B')
  const sb = makeClient(fetchImpl)
  state.armed = true
  const tok = expiredToken()
  // Not awaited: this is the abandoned call. auth-js sees exp in the past and
  // calls /auth/v1/token?grant_type=refresh_token, which never answers.
  const setSess = sb.auth.setSession({ access_token: tok, refresh_token: 'refresh-token-that-never-answers' })
  await race(setSess, 3000, 'B: auth.setSession (starts the refresh)')
  const restBefore = state.seen.filter(s => s.path.includes('/rest/v1/')).length
  const r1 = await race(sb.from('workspaces').select('id').limit(1), 10000, 'B: GET /rest/v1/workspaces behind the hung refresh')
  const r2 = await race(sb.auth.getSession(), 3000, 'B: auth.getSession() behind the hung refresh')
  const restAfter = state.seen.filter(s => s.path.includes('/rest/v1/')).length
  log(`B: /rest/v1/ requests issued after the hang began: ${restAfter - restBefore} (expected 0 — the call never reached the network)`)
  log(`B: requests seen: ${state.seen.map(s => `${s.method} ${s.path}`).join(' | ')}`)
  return { pinnedRead: r1.hung, pinnedGetSession: r2.hung, restIssued: restAfter - restBefore }
}

async function phaseC() {
  log('── Phase C — the watchdog: the same hang through connectionWatchdog.wrapFetch (budget 5 s)')
  const { state, fetchImpl } = deadNetworkFetch('C')
  const wd = createConnectionWatchdog({ budgetMs: 5000, tickMs: 250, isOnline: () => true, windowRef: null })
  let lostAt = null
  wd.subscribe(lost => { if (lost && lostAt == null) { lostAt = Date.now(); log(`C: watchdog → lost = true (banner would show)`) } else log(`C: watchdog → lost = ${lost}`) })
  const sb = makeClient(wd.wrapFetch(fetchImpl))
  state.armed = true
  const tHang = Date.now()
  const setSess = sb.auth.setSession({ access_token: expiredToken(), refresh_token: 'refresh-token-that-never-answers' })
  await race(setSess, 2000, 'C: auth.setSession (starts the refresh)')
  await race(sb.from('workspaces').select('id').limit(1), 8000, 'C: GET /rest/v1/workspaces behind the hung refresh')
  const pendingNow = wd.pendingCount()
  log(`C: watched requests still pending: ${pendingNow}; lost after ${lostAt ? lostAt - tHang : 'never'} ms; still lost: ${wd.getSnapshot()}`)
  wd.reset()
  return { lostAfterMs: lostAt ? lostAt - tHang : null, pending: pendingNow }
}

// ── S1 (night 2 of PLAN_TO_1_0, 2026-10-27): the measurements the reconnect
// design stands on. Phase D asks what a SECOND client with the same storageKey
// does while the first is pinned; phase E aborts the hung refresh from the
// fetch wrapper — the candidate the OUTSTANDING entry never tried — and reads
// what the SDK does with a rejected refresh, what its waiters get, and what
// happens when the network comes back. Still nothing printed but paths,
// methods, event names and milliseconds.

/** A token auth-js will consider fresh (exp an hour away); the same unchecked signature. */
function freshToken() {
  const now = Math.floor(Date.now() / 1000)
  const sub = '00000000-0000-4000-8000-000000000000'
  return `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url({
    sub, aud: 'authenticated', role: 'authenticated', session_id: '11111111-1111-4111-8111-111111111111',
    iat: now, exp: now + 3600, app_metadata: {}, user_metadata: {},
  })}.${b64url({ sig: 'not-checked-client-side' })}`
}

/** The SDK's own state, by the names GoTrueClient.js uses as installed. */
function sdkState(sb) {
  const a = sb.auth
  return `lock ${a.lock.name}; lockAcquired ${a.lockAcquired}; pendingInLock ${a.pendingInLock.length}; refreshingDeferred ${a.refreshingDeferred ? 'set' : 'null'}`
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function phaseD() {
  log('── Phase D — a second client with the same storageKey while the first is pinned')
  log(`D: this runtime: navigator.locks ${typeof globalThis.navigator?.locks}; isBrowser() (window and document) ${typeof window !== 'undefined' && typeof document !== 'undefined'}`)
  const { state, fetchImpl } = deadNetworkFetch('D')
  const sb1 = makeClient(fetchImpl)
  state.armed = true
  const pinned = sb1.auth.setSession({ access_token: expiredToken(), refresh_token: 'refresh-token-that-never-answers' })
  await race(pinned, 1500, 'D: client 1 auth.setSession (the refresh that never settles)')
  const waiter = race(sb1.from('workspaces').select('id').limit(1), 9000, 'D: client 1 GET /rest/v1/workspaces behind the hung refresh')
  await sleep(100)
  log(`D: client 1 → ${sdkState(sb1)}`)
  const sb2 = makeClient(fetchImpl)
  log(`D: client 2 → ${sdkState(sb2)}; same storageKey as client 1: ${sb2.auth.storageKey === sb1.auth.storageKey}`)
  const t = Date.now()
  const set2 = await race(sb2.auth.setSession({ access_token: freshToken(), refresh_token: 'refresh-token-unused' }), 3000, 'D: client 2 auth.setSession (a token that has not expired, so no refresh)')
  // A fresh token is checked with the server (GET /auth/v1/user), which refuses the made-up signature;
  // the point is only that client 2 is not waiting on client 1.
  log(`D: client 2 setSession → ${set2.value?.error ? `error ${set2.value.error.name} (status ${set2.value.error.status})` : 'no error'}`)
  const restBefore = state.seen.filter(s => s.path.includes('/rest/v1/')).length
  const r2 = await race(sb2.from('workspaces').select('id').limit(1), 5000, 'D: client 2 GET /rest/v1/workspaces while client 1 is pinned')
  const restAfter = state.seen.filter(s => s.path.includes('/rest/v1/')).length
  log(`D: client 2's read issued ${restAfter - restBefore} /rest/v1/ request(s) in ${Date.now() - t} ms${r2.value?.status != null ? ` → status ${r2.value.status}` : ''}`)
  log(`D: client 1 still → ${sdkState(sb1)}`)
  const r1 = await waiter
  return { secondClientIssued: restAfter - restBefore, firstStillPinned: r1.hung, lockName: sb1.auth.lock.name }
}

/** A token auth-js saves (exp in the future) but refreshes on its next use (inside the 90 s expiry margin). */
function nearlyExpiredToken() {
  const now = Math.floor(Date.now() / 1000)
  const sub = '00000000-0000-4000-8000-000000000000'
  return `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url({
    sub, aud: 'authenticated', role: 'authenticated', session_id: '11111111-1111-4111-8111-111111111111',
    iat: now - 3540, exp: now + 60, app_metadata: {}, user_metadata: {},
  })}.${b64url({ sig: 'not-checked-client-side' })}`
}

const MADE_UP_USER = Object.freeze({
  id: '00000000-0000-4000-8000-000000000000', aud: 'authenticated', role: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
})
const jsonResponse = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))

/**
 * A dead network whose black hole honours an AbortSignal, as a real socket
 * does: the request never answers, but an abort rejects it with an AbortError
 * at once. GET /auth/v1/user is answered here with a made-up user, so that
 * setSession() SAVES a session the way the app's boot does (the real server
 * would refuse the made-up signature). `answerRefresh` is "the network came
 * back": the refresh then answers with a made-up session (never a real
 * token). Every other request still goes to the real project.
 */
function abortableDeadNetworkFetch(label) {
  const state = { armed: false, answerRefresh: false, seen: [], refreshAt: [] }
  const fetchImpl = (input, init) => {
    const path = pathOf(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const bearer = new Headers(init?.headers ?? {}).get('authorization') ?? ''
    const who = bearer === `Bearer ${ANON}` ? 'anon' : bearer ? 'token' : 'none'
    state.seen.push({ at: Date.now() - t0, method, path: path.split('?')[0], who })
    if (path.endsWith('/auth/v1/user') && method === 'GET') return jsonResponse(MADE_UP_USER)
    if (path.includes('/auth/v1/token')) {
      state.refreshAt.push(Date.now() - t0)
      if (state.answerRefresh) {
        const now = Math.floor(Date.now() / 1000)
        return jsonResponse({
          access_token: freshToken(), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
          refresh_token: 'refresh-token-made-up', user: MADE_UP_USER,
        })
      }
      if (state.armed) {
        log(`${label}: ${method} ${path.split('?')[0]} → black hole (abortable)`)
        return new Promise((_, reject) => {
          const signal = init?.signal
          if (!signal) return
          const fail = () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
          if (signal.aborted) fail()
          else signal.addEventListener('abort', fail, { once: true })
        })
      }
    }
    return fetch(input, init)
  }
  return { state, fetchImpl }
}

/** The candidate: a wrapper that gives each refresh its own AbortController and aborts it at the budget. */
function abortRefreshAtBudget(baseFetch, budgetMs, label) {
  const aborted = []
  const wrapped = (input, init) => {
    const path = pathOf(input)
    if (!path.includes('/auth/v1/token')) return baseFetch(input, init)
    const ctl = new AbortController()
    const timer = setTimeout(() => {
      aborted.push(Date.now() - t0)
      log(`${label}: the wrapper aborts ${path.split('?')[0]} after ${budgetMs} ms`)
      ctl.abort()
    }, budgetMs)
    return Promise.resolve(baseFetch(input, { ...init, signal: ctl.signal })).finally(() => clearTimeout(timer))
  }
  return { wrapped, aborted }
}

async function phaseE() {
  const BUDGET = 2000
  log(`── Phase E — the candidate: the wrapper aborts the hung refresh at a ${BUDGET} ms budget; then the network comes back`)
  const { state, fetchImpl } = abortableDeadNetworkFetch('E')
  const { wrapped, aborted } = abortRefreshAtBudget(fetchImpl, BUDGET, 'E')
  const sb = makeClient(wrapped)
  const events = []
  sb.auth.onAuthStateChange((event) => { events.push({ at: Date.now() - t0, event }); log(`E: auth event ${event}`) })
  // As the app's boot: a saved session (setSession checks the token with GET /auth/v1/user, answered
  // here), whose token is inside the SDK's 90 s expiry margin, so its next use starts a refresh.
  const saved = await race(sb.auth.setSession({ access_token: nearlyExpiredToken(), refresh_token: 'refresh-token-that-never-answers' }), 5000, 'E: auth.setSession (a session saved, its token about to expire)')
  log(`E: saved → session ${saved.value?.data?.session ? 'present' : 'null'}${saved.value?.error ? `; error ${saved.value.error.name}` : ''}; ${sdkState(sb)}`)
  state.armed = true
  const tHang = Date.now()
  const sinceHang = (at) => `${at - (tHang - t0)} ms`
  const read = race(sb.from('workspaces').select('id').limit(1), 45000, 'E: GET /rest/v1/workspaces (its refresh is the hang)')
  await sleep(300)
  const sess = race(sb.auth.getSession(), 45000, 'E: auth.getSession() behind the refresh')
  await sleep(300)
  log(`E: while pinned → ${sdkState(sb)}`)
  const [r1, g1] = await Promise.all([read, sess])
  const settledMs = Date.now() - tHang
  log(`E: everything settled ${settledMs} ms after the hang began; the SDK sent ${state.refreshAt.length} refresh request(s) at ${state.refreshAt.map(sinceHang).join(', ')}; the wrapper aborted ${aborted.length}`)
  log(`E: getSession → session ${g1.value?.data?.session ? 'present' : 'null'}${g1.value?.error ? `; error ${g1.value.error.name} (status ${g1.value.error.status})` : '; no error'}`)
  const restIssued = state.seen.filter(s => s.path.includes('/rest/v1/'))
  log(`E: the read → ${r1.value?.status != null ? `status ${r1.value.status}` : 'no status'}${r1.value?.error ? `; error ${r1.value.error.code ?? r1.value.error.message}` : ''}; /rest/v1/ requests issued: ${restIssued.length}${restIssued.length ? ` (Authorization: ${restIssued.map(s => s.who).join(', ')})` : ''}`)
  log(`E: after the abort → ${sdkState(sb)}; auth events so far: ${events.map(e => e.event).join(', ') || 'none'}`)
  // A later call while the network is still dead: does it start a new refresh, and does that one hang too?
  const refreshesBefore = state.refreshAt.length
  const again = await race(sb.auth.getSession(), 6000, 'E: a later auth.getSession() while the network is still dead')
  log(`E: that call sent ${state.refreshAt.length - refreshesBefore} new refresh request(s)${again.hung ? '' : `; session ${again.value?.data?.session ? 'present' : 'null'}${again.value?.error ? `; error ${again.value.error.name}` : ''}`}`)
  // The network comes back: the refresh answers (the retry loop above, if still running, lands on it).
  state.answerRefresh = true
  const tBack = Date.now()
  const back = await race(sb.auth.getSession(), 12000, 'E: auth.getSession() once the refresh answers')
  const restBefore = state.seen.filter(s => s.path.includes('/rest/v1/')).length
  const rb = await race(sb.from('workspaces').select('id').limit(1), 8000, 'E: GET /rest/v1/workspaces once the refresh answers')
  const restAfterBack = state.seen.filter(s => s.path.includes('/rest/v1/'))
  const refreshed = events.some(e => e.event === 'TOKEN_REFRESHED' && e.at >= tBack - t0)
  log(`E: back → session ${back.value?.data?.session ? 'present' : 'null'}; TOKEN_REFRESHED fired: ${refreshed}; the read issued ${restAfterBack.length - restBefore} request(s) (Authorization: ${restAfterBack.slice(restBefore).map(s => s.who).join(', ') || 'none'})${rb.value?.status != null ? ` → status ${rb.value.status}` : ''}; ${Date.now() - tBack} ms`)
  log(`E: at the end → ${sdkState(sb)}`)
  return {
    settledMs, refreshRequests: refreshesBefore,
    // kept: the later call found the session (and so started a refresh of it) rather than nothing
    sessionKeptAfterAbort: state.refreshAt.length > refreshesBefore,
    recovered: refreshed && !!back.value?.data?.session && restAfterBack.slice(restBefore).some(s => s.who === 'token'),
  }
}

const host = new URL(URL_).host
log(`project host: ${host}; supabase-js as installed; persistSession:false autoRefreshToken:true`)
await phaseA()
const b = await phaseB()
const c = await phaseC()
const d = await phaseD()
const e = await phaseE()
log('── Summary')
log(`pinned PostgREST read: ${b.pinnedRead}; pinned getSession(): ${b.pinnedGetSession}; /rest/v1/ requests issued behind the hang: ${b.restIssued}`)
log(`watchdog raised lost after ${c.lostAfterMs} ms with ${c.pending} watched request(s) pending`)
log(`the lock is ${d.lockName}; a second client with the same storageKey issued ${d.secondClientIssued} read(s) while the first stayed pinned: ${d.firstStillPinned}`)
log(`an aborted refresh settled the SDK ${e.settledMs} ms after the hang (${e.refreshRequests} refresh request(s)); the session kept: ${e.sessionKeptAfterAbort}; recovered once the network answered: ${e.recovered}`)
const ok = b.pinnedRead && b.pinnedGetSession && b.restIssued === 0 && c.lostAfterMs != null && c.lostAfterMs >= 5000 && c.lostAfterMs < 6500
  && e.settledMs < 45000 && e.recovered
log(ok ? 'RESULT: hang reproduced and caught; the abort settles it and the client recovers' : 'RESULT: something did not behave as described — read the lines above')
process.exit(ok ? 0 : 1)
