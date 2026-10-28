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
//   D, E, F  S1's: a second client, the abort, the build end to end (below)
//   G  S2's: a cold launch with a saved session under six networks, restored
//      as App.jsx did before S2 (the sign-in screen's times) and through the
//      build's restoreSavedSession (held, refused, the way back); run alone
//      with `node scripts/probes/connection-hang.mjs .env.local G`
//
// Nothing here is printed but paths, methods and milliseconds.
// =============================================================================

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  createConnectionWatchdog, createAnonGuard, restoreSavedSession, rehydrateSession,
  LAUNCH_BUDGET_MS, LAUNCH_CEILING_MS,
} from '../../src/cloud/connectionWatchdog.js'

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

/**
 * Phase F — the build (S1): the same hang through the REAL watchdog with its
 * real 20 s budget and the client module's guard in front of it, as the app
 * composes them. What it shows, with times: the strip at the budget, the
 * abort, the SDK's own retry 200 ms later, the loop ending at ~42 s with the
 * hung caller's read REFUSED by the guard (never sent with the anon key), a
 * caller queued meanwhile, the network answering, the ping clearing the auth
 * family and aborting the dead attempt, TOKEN_REFRESHED, the queued caller's
 * read with the new token, the recovered hook. While "dead", every /auth/v1/
 * request but GET /user is a black hole; the health ping goes to the real
 * project once the network is "back"; the refresh answers with a made-up
 * session (never a real token).
 */
async function phaseF() {
  log('── Phase F — the build: the real watchdog (20 s budget) and the guard; the hang, the abort, the retry, the network back')
  const { state, fetchImpl } = abortableDeadNetworkFetch('F')
  // while armed, the whole auth family is dark (the health ping too), not only /token
  const dark = (input, init) => {
    const path = pathOf(input)
    if (state.armed && path.includes('/auth/v1/') && !path.endsWith('/auth/v1/user')) {
      const method = (init?.method ?? 'GET').toUpperCase()
      state.seen.push({ at: Date.now() - t0, method, path: path.split('?')[0], who: 'ping' })
      if (path.includes('/auth/v1/token')) state.refreshAt.push(Date.now() - t0)
      log(`F: ${method} ${path.split('?')[0]} → black hole (abortable)`)
      return new Promise((_, reject) => {
        const signal = init?.signal
        if (!signal) return
        const fail = () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
        if (signal.aborted) fail()
        else signal.addEventListener('abort', fail, { once: true })
      })
    }
    return fetchImpl(input, init)
  }
  const wd = createConnectionWatchdog({ tickMs: 250, isOnline: () => true, windowRef: null })
  const marks = []
  wd.subscribe((lost, phase) => { marks.push({ at: Date.now() - t0, lost, phase }); log(`F: watchdog → lost ${lost}, phase ${phase}${lost ? ` (families: ${wd.lostFamilies().join(', ')})` : ''}`) })
  wd.onRecovered((family) => log(`F: watchdog → recovered: ${family}`))
  let signedIn = false
  const guard = createAnonGuard({ anonKey: ANON, isSignedIn: () => signedIn, onRefused: (p) => log(`F: the guard refused ${p} (anon bearer while signed in)`) })
  const sb = makeClient(guard(wd.wrapFetch(dark)))
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') signedIn = false; else if (session) signedIn = true
    log(`F: auth event ${event}`)
  })
  const saved = await race(sb.auth.setSession({ access_token: nearlyExpiredToken(), refresh_token: 'refresh-token-that-never-answers' }), 5000, 'F: auth.setSession (a session saved, its token about to expire)')
  log(`F: saved → session ${saved.value?.data?.session ? 'present' : 'null'}; signed in ${signedIn}`)
  state.armed = true
  const tHang = Date.now()
  const since = () => `${Date.now() - tHang} ms`
  let s1 = false; let s2 = false
  // The first caller is the HOLDER: its getSession() starts the refresh that hangs, and the SDK
  // holds it until its whole queue has drained (GoTrueClient._acquireLock), so it cannot settle
  // while the network is dead. The second caller queues behind it.
  const read1 = race(sb.from('workspaces').select('id').limit(1), 95000, 'F: the first read (the holder: its refresh is the hang)').then(r => { s1 = true; return r })
  await sleep(5000)
  const read2 = race(sb.from('workspaces').select('id').limit(1), 95000, 'F: a second read, queued behind the first').then(r => { s2 = true; return r })
  log(`F: ${since()} → ${sdkState(sb)}; watched pending ${wd.pendingCount()}`)
  // The holder's own loop is two attempts of 21 s (the refresh carries a body), 200 ms apart:
  // over at ~42.6 s. Then the queued caller's turn starts a loop of its own.
  await sleep(40000)
  const heldWhileDead = !s1 && !s2
  log(`F: ${since()} → ${sdkState(sb)}; lost ${wd.getSnapshot()} (${wd.lostFamilies().join(', ')}); phase ${wd.getPhase()}; the first read settled: ${s1}; the second: ${s2}; /rest/v1/ requests sent: ${state.seen.filter(s => s.path.includes('/rest/v1/')).length}`)
  // The network comes back. The next ping answers, aborts the dead attempt, the SDK's retry lands.
  state.armed = false
  state.answerRefresh = true
  const tBack = Date.now()
  log(`F: ${since()} the network is back`)
  const [r1, r2] = await Promise.all([read1, read2])
  const restSent = state.seen.filter(s => s.path.includes('/rest/v1/'))
  const describe = (r) => r.hung ? 'NO ANSWER' : r.value?.error ? `error "${String(r.value.error.message).slice(0, 60)}" (status ${r.value.status})` : `status ${r.value?.status}`
  log(`F: ${since()} the queued read → ${describe(r2)}; the holder's read → ${describe(r1)}`)
  log(`F: /rest/v1/ requests sent in the end: ${restSent.length} (Authorization: ${restSent.map(s => s.who).join(', ') || 'none'})`)
  await sleep(1500)
  log(`F: ${since()} → ${sdkState(sb)}; lost ${wd.getSnapshot()}; phase ${wd.getPhase()}; refresh attempts at ${state.refreshAt.map(a => `${a - (tHang - t0)} ms`).join(', ')}`)
  const lostAt = marks.find(m => m.lost)?.at
  const clearAt = marks.find(m => !m.lost && m.at > tBack - t0)?.at
  log(`F: the strip up ${lostAt != null ? lostAt - (tHang - t0) : '—'} ms into the hang; cleared ${clearAt != null ? clearAt - (tBack - t0) : '—'} ms after the network returned`)
  wd.reset()
  return {
    lostAfterMs: lostAt != null ? lostAt - (tHang - t0) : null,
    holderHeldWhileDead: heldWhileDead,
    firstReadRefused: !!r1.value?.error && String(r1.value.error.message).includes('session check failed'),
    firstReadSent: restSent.some(s => s.who === 'anon'),
    recoveredMs: clearAt != null ? clearAt - (tBack - t0) : null,
    secondReadWithToken: r2.value?.status != null && restSent.some(s => s.who === 'token'),
  }
}

// ── S2 (night 3 of PLAN_TO_1_0, 2026-10-27): the offline LAUNCH. Phase G
// starts a client cold, composed as the app composes it (the guard outside the
// watchdog's wrapper, the real 20 s budget), and restores a SAVED session the
// way App.jsx's checkSessionValid does today: `withTimeout(hydrate(saved),
// 15 s)`, where hydrate is supabaseClient.js's hydrateSupabase (setSession;
// an error is "no session"). A null is the sign-in screen. Six networks:
// GET /auth/v1/user stalls or fails at once (an unexpired token: auth-js
// checks it with that one request), the refresh stalls or fails at once (an
// expired token: refreshed first, in the SDK's own retry loop), and the real
// project answering a made-up token (a refusal). The stored session is
// modelled as the object the app keeps (sessionStorage.js): read after each
// case to say whether anything cleared it. Made-up tokens only; nothing
// printed but paths, methods, error names, statuses and milliseconds.

/** An unexpired token: the shape a saved session has when its last refresh was recent. */
function unexpiredToken() {
  const now = Math.floor(Date.now() / 1000)
  const sub = '00000000-0000-4000-8000-000000000000'
  return `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url({
    sub, aud: 'authenticated', role: 'authenticated', session_id: '22222222-2222-4222-8222-222222222222',
    iat: now - 600, exp: now + 3000, app_metadata: { workspace_id: '33333333-3333-4333-8333-333333333333', app_role: 'user' }, user_metadata: {},
  })}.${b64url({ sig: 'not-checked-client-side' })}`
}

/** A network for one launch: 'stall' (abortable black hole), 'fail' (rejects at once), 'real' (passes through). */
function launchNetwork(kind, label) {
  const state = { seen: [] }
  const fetchImpl = (input, init) => {
    const path = pathOf(input).split('?')[0]
    const method = (init?.method ?? 'GET').toUpperCase()
    state.seen.push({ at: Date.now() - t0, method, path })
    if (kind === 'fail') return Promise.reject(new TypeError('Failed to fetch'))
    if (kind === 'stall') {
      return new Promise((_, reject) => {
        const signal = init?.signal
        if (!signal) return
        const fail = () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
        if (signal.aborted) fail()
        else signal.addEventListener('abort', fail, { once: true })
      })
    }
    return fetch(input, init)
  }
  return { state, fetchImpl, label }
}

async function launchCase({ name, token, net, waitMs }) {
  const { withTimeout, AUTH_TIMEOUT_MS } = await import('../../src/cloud/auth/withTimeout.js')
  const { state, fetchImpl } = launchNetwork(net, name)
  const wd = createConnectionWatchdog({ tickMs: 250, isOnline: () => true, windowRef: null })
  const marks = []
  wd.subscribe((lost, phase) => marks.push({ at: Date.now(), lost, phase }))
  let signedIn = false
  const guard = createAnonGuard({ anonKey: ANON, isSignedIn: () => signedIn })
  const sb = makeClient(guard(wd.wrapFetch(fetchImpl)))
  const events = []
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') signedIn = false; else if (session) signedIn = true
    events.push({ at: Date.now(), event })
  })
  const saved = { access_token: token, refresh_token: 'refresh-token-made-up', expires_at: Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp), token_type: 'bearer', user: MADE_UP_USER }
  const store = { session: saved }                  // the app's stored session, as sessionStorage.js keeps it
  const before = JSON.stringify(store.session)
  const tLaunch = Date.now()
  let settledAt = null; let settled = null
  // supabaseClient.js hydrateSupabase, as it stands
  const restore = sb.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token })
    .then((r) => { settledAt = Date.now(); settled = r; return r.error ? null : r.data.session })
  // App.jsx checkSessionValid, as it stands
  const session = await withTimeout(restore, AUTH_TIMEOUT_MS, 'session restore').catch(() => null)
  const signInMs = Date.now() - tLaunch
  const lostAtSignIn = wd.getSnapshot()
  await Promise.race([restore.catch(() => {}), sleep(waitMs)])
  await sleep(300)
  const err = settled?.error
  const mem = await Promise.race([sb.auth.getSession().then((r) => (r.data.session ? 'a session' : 'none')), sleep(1000).then(() => 'getSession() pending')])
  const strip = marks.find((m) => m.lost)
  const r = {
    name,
    signInScreenMs: session ? null : signInMs,
    shellOpened: !!session,
    restoreSettledMs: settledAt ? settledAt - tLaunch : null,
    error: err ? `${err.name}${err.status != null ? ` status ${err.status}` : ''}${err.code ? ` code ${err.code}` : ''}` : (settled ? 'none' : 'still pending'),
    stripMs: strip ? strip.at - tLaunch : null,
    stripPhase: wd.getPhase(),
    lostAtSignIn,
    sdkMemory: mem,
    events: events.map((e) => `${e.event}@${e.at - tLaunch}`).join(' ') || 'none',
    requests: state.seen.map((s) => `${s.method} ${s.path.replace(/^.*\/(auth|rest)\/v1/, '/$1/v1')}@${s.at - (tLaunch - t0)}`).join(', '),
    storeTouched: JSON.stringify(store.session) !== before,
    lock: sdkState(sb),
  }
  log(`G: ${name}`)
  log(`G:   the sign-in screen at ${r.signInScreenMs ?? '—'} ms (shell opened: ${r.shellOpened}); the restore settled at ${r.restoreSettledMs ?? 'never (in the wait)'} ms with ${r.error}`)
  log(`G:   the strip: ${r.stripMs != null ? `up at ${r.stripMs} ms` : 'never'} (lost at the sign-in screen: ${r.lostAtSignIn}; phase now ${r.stripPhase}); auth events: ${r.events}`)
  log(`G:   the SDK holds ${r.sdkMemory}; ${r.lock}; the stored session touched: ${r.storeTouched}`)
  log(`G:   on the wire: ${r.requests || 'nothing'}`)
  wd.reset()
  try { sb.auth.stopAutoRefresh() } catch { /* not started */ }
  return r
}

async function phaseG() {
  log('── Phase G — S2: a cold launch with a saved session, restored as App.jsx does today (bounded at 15 s)')
  const out = {}
  out.userStalls = await launchCase({ name: 'G1 GET /auth/v1/user stalls (an unexpired token)', token: unexpiredToken(), net: 'stall', waitMs: 25000 })
  out.userFails = await launchCase({ name: 'G2 GET /auth/v1/user fails at once (an unexpired token)', token: unexpiredToken(), net: 'fail', waitMs: 2000 })
  out.refreshStalls = await launchCase({ name: 'G3 the refresh stalls (an expired token)', token: expiredToken(), net: 'stall', waitMs: 45000 })
  out.refreshFails = await launchCase({ name: 'G4 the refresh fails at once (an expired token)', token: expiredToken(), net: 'fail', waitMs: 35000 })
  out.userRefused = await launchCase({ name: 'G5 the real project answers GET /auth/v1/user for a made-up token', token: unexpiredToken(), net: 'real', waitMs: 5000 })
  out.refreshRefused = await launchCase({ name: 'G6 the real project answers the refresh of a made-up refresh token', token: expiredToken(), net: 'real', waitMs: 5000 })
  return out
}

// ── Phase G, the build (S2): the same launches through the decision the app
// now makes inside the cap — `restoreSavedSession`, exported by the watchdog
// module so this runs the code the app runs: GoTrue's health first within the
// launch budget, then the SDK with S1's budgets, the whole within the launch
// ceiling. "Held" is the shell opening offline. Then the way back: the hold's
// loss pinged, the network returning, the first answered ping re-hydrating.
async function launchBuildCase({ name, token, net }) {
  const { state, fetchImpl } = launchNetwork(net, name)
  const wd = createConnectionWatchdog({ tickMs: 250, isOnline: () => true, windowRef: null })
  let signedIn = false
  const guard = createAnonGuard({ anonKey: ANON, isSignedIn: () => signedIn })
  const sb = makeClient(guard(wd.wrapFetch(fetchImpl)))
  sb.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_OUT') signedIn = false; else if (session) signedIn = true })
  const saved = { access_token: token, refresh_token: 'refresh-token-made-up' }
  const tLaunch = Date.now()
  const r = await restoreSavedSession({ auth: sb.auth, saved, probe: () => wd.launchProbe({ origin: URL_, apikey: ANON }) })
  const decidedMs = Date.now() - tLaunch
  const out = {
    name, outcome: r.outcome, reason: r.reason ?? null, decidedMs,
    error: r.error ? `${r.error.name}${r.error.status != null ? ` status ${r.error.status}` : ''}${r.error.code ? ` code ${r.error.code}` : ''}` : 'none',
    requests: state.seen.map((s) => `${s.method} ${s.path.replace(/^.*\/(auth|rest)\/v1/, '/$1/v1')}@${s.at - (tLaunch - t0)}`).join(', '),
    realRequests: state.seen.filter((s) => !s.path.endsWith('/auth/v1/health')).length,
  }
  log(`G+: ${name}`)
  log(`G+:   ${out.outcome}${out.reason ? ` (${out.reason})` : ''} at ${decidedMs} ms; ${out.error}; on the wire: ${out.requests || 'nothing'}`)
  wd.reset()
  try { sb.auth.stopAutoRefresh() } catch { /* not started */ }
  return out
}

/** A launch that holds, then the network returns: GoTrue's health and GET /user answer (the made-up user). */
async function rehydrationCase() {
  const state = { back: false, seen: [] }
  const fetchImpl = (input, init) => {
    const path = pathOf(input).split('?')[0]
    const method = (init?.method ?? 'GET').toUpperCase()
    state.seen.push({ at: Date.now() - t0, method, path })
    if (!state.back) {
      return new Promise((_, reject) => {
        const signal = init?.signal
        if (!signal) return
        const fail = () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
        if (signal.aborted) fail(); else signal.addEventListener('abort', fail, { once: true })
      })
    }
    if (path.endsWith('/auth/v1/health')) return jsonResponse({ name: 'GoTrue', version: 'made-up' })
    if (path.endsWith('/auth/v1/user') && method === 'GET') return jsonResponse(MADE_UP_USER)
    return fetch(input, init)
  }
  const wd = createConnectionWatchdog({ tickMs: 250, isOnline: () => true, windowRef: null })
  const sb = makeClient(wd.wrapFetch(fetchImpl))
  const events = []
  sb.auth.onAuthStateChange((event) => events.push({ at: Date.now(), event }))
  const saved = { access_token: unexpiredToken(), refresh_token: 'refresh-token-made-up' }
  const tLaunch = Date.now()
  const r = await restoreSavedSession({ auth: sb.auth, saved, probe: () => wd.launchProbe({ origin: URL_, apikey: ANON }) })
  const heldMs = Date.now() - tLaunch
  wd.launchedOffline({ origin: URL_, apikey: ANON })
  const phases = []
  wd.subscribe((lost, phase) => phases.push({ at: Date.now(), lost, phase }))
  let rehydrated = null
  wd.onPingAnswered((family) => {
    if (family !== 'auth' || rehydrated) return
    rehydrated = rehydrateSession({ auth: sb.auth, held: saved })
    wd.quietWhile('auth', rehydrated)
  })
  log(`G+: the way back — held (${r.outcome}, ${r.reason}) at ${heldMs} ms; phase ${wd.getPhase()}`)
  await sleep(12_000)
  log(`G+:   ${Date.now() - tLaunch} ms: still ${wd.getPhase()}; health pings sent ${state.seen.filter((s) => s.path.endsWith('/auth/v1/health')).length}`)
  state.back = true
  const tBack = Date.now()
  log('G+:   the network is back (the stub answers health and GET /user)')
  await sleep(14_000)
  const signedInAt = events.find((e) => e.event === 'SIGNED_IN')?.at
  const clearAt = phases.find((p) => !p.lost && p.at >= tBack)?.at
  const out = {
    heldMs, outcome: r.outcome,
    signedInMs: signedInAt ? signedInAt - tBack : null,
    stripClearedMs: clearAt ? clearAt - tBack : null,
    phaseNow: wd.getPhase(),
    session: (await sb.auth.getSession()).data.session ? 'the SDK holds it' : 'none',
  }
  log(`G+:   SIGNED_IN ${out.signedInMs ?? '—'} ms after the network returned; the strip cleared ${out.stripClearedMs ?? '—'} ms after; phase ${out.phaseNow}; ${out.session}`)
  wd.reset()
  try { sb.auth.stopAutoRefresh() } catch { /* not started */ }
  return out
}

async function phaseGBuild() {
  log(`── Phase G, the build — restoreSavedSession inside the cap: the health probe first (${LAUNCH_BUDGET_MS} ms), the SDK with S1's budgets, the decision within ${LAUNCH_CEILING_MS} ms`)
  const out = {}
  out.userStalls = await launchBuildCase({ name: 'G1+ the network stalls (an unexpired token)', token: unexpiredToken(), net: 'stall' })
  out.userFails = await launchBuildCase({ name: 'G2+ the network fails at once (an unexpired token)', token: unexpiredToken(), net: 'fail' })
  out.refreshStalls = await launchBuildCase({ name: 'G3+ the network stalls (an expired token)', token: expiredToken(), net: 'stall' })
  out.refreshFails = await launchBuildCase({ name: 'G4+ the network fails at once (an expired token)', token: expiredToken(), net: 'fail' })
  out.userRefused = await launchBuildCase({ name: 'G5+ the real project, GET /user for a made-up token', token: unexpiredToken(), net: 'real' })
  out.refreshRefused = await launchBuildCase({ name: 'G6+ the real project, the refresh of a made-up refresh token', token: expiredToken(), net: 'real' })
  out.back = await rehydrationCase()
  return out
}

function buildOk(b) {
  return b.userStalls.outcome === 'held' && b.userStalls.decidedMs >= LAUNCH_BUDGET_MS - 100 && b.userStalls.decidedMs < LAUNCH_BUDGET_MS + 1000 && b.userStalls.realRequests === 0
    && b.userFails.outcome === 'held' && b.userFails.decidedMs < 1000 && b.userFails.realRequests === 0
    && b.refreshStalls.outcome === 'held' && b.refreshStalls.decidedMs < LAUNCH_BUDGET_MS + 1000 && b.refreshStalls.realRequests === 0
    && b.refreshFails.outcome === 'held' && b.refreshFails.decidedMs < 1000 && b.refreshFails.realRequests === 0
    && b.userRefused.outcome === 'refused' && b.refreshRefused.outcome === 'refused'
    && b.back.outcome === 'held' && b.back.signedInMs != null && b.back.stripClearedMs != null && b.back.stripClearedMs < 12_000 && b.back.phaseNow === 'ok'
}

// `node connection-hang.mjs <env> G` runs phase G alone, today's restore and the build's (about three minutes); no letter runs them all.
const only = (process.argv[3] || '').toUpperCase()
const todayOk = (g) => g.userStalls.signInScreenMs >= 14900 && g.userStalls.signInScreenMs < 15500
  && g.userFails.signInScreenMs < 2000
  && g.refreshStalls.signInScreenMs >= 14900 && g.refreshStalls.signInScreenMs < 15500
  && g.refreshFails.signInScreenMs >= 14900 && g.refreshFails.signInScreenMs < 15500
  && g.userRefused.signInScreenMs < 5000 && g.refreshRefused.signInScreenMs < 5000
  && Object.values(g).every((r) => !r.storeTouched && !r.shellOpened)
if (only === 'G') {
  log(`project host: ${new URL(URL_).host}; supabase-js as installed; persistSession:false autoRefreshToken:true`)
  const g = await phaseG()
  const gb = await phaseGBuild()
  const okG = todayOk(g) && buildOk(gb)
  log(`the build: held at ${gb.userStalls.decidedMs} ms (a stall) and ${gb.userFails.decidedMs} ms (a failure), no real request sent; refused at ${gb.userRefused.decidedMs} and ${gb.refreshRefused.decidedMs} ms; the way back: SIGNED_IN ${gb.back.signedInMs} ms and the strip cleared ${gb.back.stripClearedMs} ms after the network returned`)
  log(okG ? 'RESULT: today every offline launch lands on the sign-in screen and nothing clears the stored session; the build holds the saved sign-in inside the cap at once or within the 5 s probe, sends no real request while the network is dead, refuses what the server refuses, and re-hydrates on the first answered ping' : 'RESULT: something did not behave as described — read the lines above')
  process.exit(okG ? 0 : 1)
}

const host = new URL(URL_).host
log(`project host: ${host}; supabase-js as installed; persistSession:false autoRefreshToken:true`)
await phaseA()
const b = await phaseB()
const c = await phaseC()
const d = await phaseD()
const e = await phaseE()
const f = await phaseF()
const g = await phaseG()
const gb = await phaseGBuild()
log('── Summary')
log(`pinned PostgREST read: ${b.pinnedRead}; pinned getSession(): ${b.pinnedGetSession}; /rest/v1/ requests issued behind the hang: ${b.restIssued}`)
log(`watchdog raised lost after ${c.lostAfterMs} ms with ${c.pending} watched request(s) pending`)
log(`the lock is ${d.lockName}; a second client with the same storageKey issued ${d.secondClientIssued} read(s) while the first stayed pinned: ${d.firstStillPinned}`)
log(`an aborted refresh (2 s budget) kept the SDK retrying (${e.refreshRequests} request(s) in the first loop); the session kept: ${e.sessionKeptAfterAbort}; recovered once the network answered: ${e.recovered}`)
log(`the build: lost after ${f.lostAfterMs} ms; both callers held while the network was dead: ${f.holderHeldWhileDead}; the strip cleared ${f.recoveredMs} ms after the network returned; the queued read went with the new token: ${f.secondReadWithToken}; the holder's read refused by the guard: ${f.firstReadRefused} (sent as anon: ${f.firstReadSent})`)
const ok = b.pinnedRead && b.pinnedGetSession && b.restIssued === 0 && c.lostAfterMs != null && c.lostAfterMs >= 5000 && c.lostAfterMs < 6500
  && e.sessionKeptAfterAbort && e.recovered
  && f.lostAfterMs != null && f.lostAfterMs >= 20000 && f.lostAfterMs < 22500 && f.holderHeldWhileDead && f.recoveredMs != null && f.recoveredMs < 12000 && f.secondReadWithToken && f.firstReadRefused && !f.firstReadSent
  && todayOk(g) && buildOk(gb)
log(`the offline launch (S2): today the sign-in screen at ${g.userStalls.signInScreenMs} ms (a stall) and ${g.userFails.signInScreenMs} ms (a failure); the build holds at ${gb.userStalls.decidedMs} and ${gb.userFails.decidedMs} ms with no real request, and the way back clears the strip ${gb.back.stripClearedMs} ms after the network returns`)
log(ok ? 'RESULT: hang reproduced and caught; the abort lets the SDK recover on its own once the network answers; the build does the same with its real budget; an offline launch inside the cap holds and re-hydrates' : 'RESULT: something did not behave as described — read the lines above')
process.exit(ok ? 0 : 1)
