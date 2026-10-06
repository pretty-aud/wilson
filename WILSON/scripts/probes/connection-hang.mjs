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

const host = new URL(URL_).host
log(`project host: ${host}; supabase-js as installed; persistSession:false autoRefreshToken:true`)
await phaseA()
const b = await phaseB()
const c = await phaseC()
log('── Summary')
log(`pinned PostgREST read: ${b.pinnedRead}; pinned getSession(): ${b.pinnedGetSession}; /rest/v1/ requests issued behind the hang: ${b.restIssued}`)
log(`watchdog raised lost after ${c.lostAfterMs} ms with ${c.pending} watched request(s) pending`)
const ok = b.pinnedRead && b.pinnedGetSession && b.restIssued === 0 && c.lostAfterMs != null && c.lostAfterMs >= 5000 && c.lostAfterMs < 6500
log(ok ? 'RESULT: hang reproduced and caught' : 'RESULT: something did not behave as described — read the lines above')
process.exit(ok ? 0 : 1)
