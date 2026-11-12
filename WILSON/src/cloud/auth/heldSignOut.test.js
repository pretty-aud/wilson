// =============================================================================
// heldSignOut.test.js — S2 (night 3, 2026-10-27), build review round 2, F1
// (docs/design/RECONNECT_DESIGN.md §11.18). A sign-out while the held
// session's own work is out, through the REAL client module, the real
// watchdog singleton and supabase-js / auth-js as installed (2.101.1), on a
// fake network whose every request honours its AbortSignal as fetch does.
// supabaseClient.test.js mocks the SDK, so it cannot hold this: what is
// measured here is auth-js's own lock, its refresh retry loop and the session
// removal it runs after a refusal.
//
//   * an EXPIRED held token, its re-hydration's refresh out (stalled): the
//     sign-out aborts it, and the loop's next attempt is answered with a
//     refusal without the network, so the loop ends within one backoff and
//     the lock is free. A new sign-in 9 s later stands: nothing is revoked,
//     nothing signs it out, its MFA-level check is not kept waiting, and its
//     own refresh goes out unjoined;
//   * an UNEXPIRED held token (GET /user, told by its bearer): the same;
//   * a held refresh failing FAST (503s, so the loop sleeps in long
//     backoffs): the sign-out inside a 6.4 s backoff, a new sign-in 2 s later,
//     before the loop's next attempt. That attempt is answered with a 503,
//     not a refusal — a refusal makes auth-js remove the SDK's session, by
//     then the new one — and the new sign-in stands. CONTROL: with no new
//     sign-in the same attempt is answered with the refusal, and the loop
//     ends there.
// App.jsx's own part (no row, no AI-files release and no SDK sign-out for a
// held session) is pinned in offlineLaunchWiring.test.js; this file does what
// App does with the client module: endSessionLocally(), nothing else.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./sessionStorage', () => ({
  SESSION_STORAGE_KEY: 'wilson.dev.session',
  saveSession: async () => {},
  loadSession: async () => null,
  clearSession: async () => {},
}))

const BASE = 'https://example-project.supabase.co'
const ANON = 'anon-key-for-the-test'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const sec = () => Math.floor(Date.now() / 1000)
// Made-up tokens: an unsigned JWT shape whose claims the module and auth-js read.
function tokenFor(sid, exp) {
  const claims = { sub: `u-${sid}`, aud: 'authenticated', role: 'authenticated', session_id: sid, exp, iat: sec() - 600, amr: [{ method: 'password', timestamp: sec() - 3600 }], app_metadata: { workspace_id: 'w1', app_role: 'user' }, user_metadata: {} }
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`
}
const sidOf = (token) => { try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString()).session_id } catch { return null } }
const bearerSid = (bearer) => sidOf(String(bearer).replace(/^Bearer /, ''))
const user = (sid) => ({ id: `u-${sid}`, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, factors: [] })
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const sessionBody = (sid, n) => ({ access_token: tokenFor(sid, sec() + 3600), refresh_token: `${sid}-refresh-${n}`, token_type: 'bearer', expires_in: 3600, expires_at: sec() + 3600, user: user(sid) })

const net = { up: false, heldRefresh: 'stall', log: [] }
function headerIn(init, name) {
  const h = init?.headers || {}
  if (typeof h.get === 'function') return h.get(name)
  for (const k of Object.keys(h)) if (k.toLowerCase() === name) return h[k]
  return null
}
function fakeFetch(input, init = {}) {
  const u = new URL(typeof input === 'string' ? input : input.url)
  const body = typeof init.body === 'string' ? init.body : ''
  const bearer = headerIn(init, 'authorization')
  const s = init.signal
  net.log.push({ t: Date.now(), method: init.method || 'GET', path: u.pathname + u.search, bearer, body, abortedAtSend: !!s?.aborted })
  const abortable = (p) => new Promise((res, rej) => {
    if (s?.aborted) return rej(s.reason ?? new DOMException('aborted', 'AbortError'))
    s?.addEventListener('abort', () => rej(s.reason ?? new DOMException('aborted', 'AbortError')), { once: true })
    p.then(res, rej)
  })
  if (!net.up) return abortable(Promise.reject(new TypeError('Failed to fetch')))
  if (u.pathname.endsWith('/auth/v1/health')) return abortable(Promise.resolve(json({ name: 'GoTrue', version: 'test' })))
  if (u.search.includes('grant_type=password')) return abortable(Promise.resolve(json(sessionBody('new-sid', 1))))
  if (u.search.includes('grant_type=refresh_token')) {
    const rt = JSON.parse(body || '{}').refresh_token
    if (rt === 'held-refresh') {
      if (net.heldRefresh === 'stall') return abortable(new Promise(() => {}))
      return abortable(Promise.resolve(json({ message: 'unavailable' }, 503)))
    }
    if (rt === 'new-sid-refresh-1') return abortable(Promise.resolve(json(sessionBody('new-sid', 2))))
    return abortable(Promise.resolve(json({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, 400)))
  }
  if (u.pathname.endsWith('/auth/v1/user')) {
    if (bearerSid(bearer) === 'held-sid') return abortable(new Promise(() => {}))   // the held session's GET /user: stalled
    return abortable(Promise.resolve(json(user(bearerSid(bearer)))))
  }
  if (u.pathname.endsWith('/auth/v1/logout')) return abortable(Promise.resolve(new Response(null, { status: 204 })))
  if (u.pathname.startsWith('/rest/v1/')) return abortable(Promise.resolve(json([])))
  return abortable(Promise.resolve(json({}, 404)))
}

let mod
const events = []
beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubEnv('VITE_SUPABASE_URL', BASE)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON)
  vi.stubGlobal('fetch', fakeFetch)
  Object.assign(net, { up: false, heldRefresh: 'stall', log: [] })
  events.length = 0
  mod = await import('./supabaseClient')
  mod.supabase.auth.onAuthStateChange((event, session) => { events.push({ t: Date.now(), event, sid: session ? sidOf(session.access_token) : null }) })
})
afterEach(() => {
  try { mod.supabase.auth.stopAutoRefresh() } catch { /* not started */ }
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** An offline launch held at once (the network down), then the network back: the first answered ping re-hydrates. */
async function heldThenRehydrating({ expired }) {
  const exp = expired ? sec() - 60 : sec() + 3000
  const held = { access_token: tokenFor('held-sid', exp), refresh_token: 'held-refresh', expires_at: exp, user: { id: 'u-held-sid' } }
  expect(await mod.hydrateSupabase(held, { holdOffline: true })).toBe(held)
  net.up = true
  await vi.advanceTimersByTimeAsync(1_100)
  return held
}
const heldRefreshes = () => net.log.filter((r) => r.path.includes('grant_type=refresh_token') && r.body.includes('"held-refresh"'))
const heldUserReads = () => net.log.filter((r) => r.path === '/auth/v1/user' && bearerSid(r.bearer) === 'held-sid')
const signedOutSince = (t) => events.filter((e) => e.event === 'SIGNED_OUT' && e.t >= t)
const logouts = () => net.log.filter((r) => r.path.startsWith('/auth/v1/logout'))

/** A new sign-in, then LoginScreen's next step (the MFA level, under the SDK's lock); returns how long that step waited. */
async function signInAgain() {
  const si = await mod.supabase.auth.signInWithPassword({ email: 'person@example.com', password: 'made-up' })
  expect(si.error).toBeNull()
  expect(sidOf(si.data.session.access_token)).toBe('new-sid')
  const tIn = Date.now()
  let aalAt = null
  mod.supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(() => { aalAt = Date.now() })
  for (let i = 0; i < 400 && aalAt == null; i += 1) await vi.advanceTimersByTimeAsync(100)
  expect(aalAt).not.toBeNull()
  return { tIn, aalWaitedMs: aalAt - tIn }
}

async function theNewSignInStands(tIn) {
  await vi.advanceTimersByTimeAsync(40_000)              // past any window the held loop could still have had
  expect(logouts()).toEqual([])                           // nothing revoked: the new token least of all
  expect(signedOutSince(tIn)).toEqual([])                  // nothing signed the new sign-in out
  const now = (await mod.supabase.auth.getSession()).data.session
  expect(sidOf(now?.access_token)).toBe('new-sid')
}

describe('S2, build review round 2, F1: a sign-out while the held work is out', () => {
  it('an EXPIRED held token, its refresh out: the loop ends within one backoff of the sign-out, and a new sign-in 9 s later stands', async () => {
    await heldThenRehydrating({ expired: true })
    expect(heldRefreshes()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    const tOut = Date.now()
    expect(mod.endSessionLocally()).toBe(true)            // a HELD session ended: App sends no row and queues no SDK sign-out
    await vi.advanceTimersByTimeAsync(1_000)
    const outs = signedOutSince(tOut)                       // auth-js's clean-up after the refusal, with nothing to remove
    expect(outs).toHaveLength(1)
    expect(outs[0].t - tOut).toBeLessThanOrEqual(400)
    expect(heldRefreshes().filter((r) => r.t > tOut)).toEqual([])   // no attempt after the sign-out reached the network
    await vi.advanceTimersByTimeAsync(8_000)
    const { tIn, aalWaitedMs } = await signInAgain()
    expect(aalWaitedMs).toBeLessThanOrEqual(100)           // the lock is free: LoginScreen is not kept on "Signing in…"
    // its own refresh (LoginScreen after issue-session; WorkspaceSwitcher) goes out unjoined, and lands
    const r = await mod.supabase.auth.refreshSession()
    expect(r.error).toBeNull()
    const own = net.log.filter((x) => x.body.includes('"new-sid-refresh-1"'))
    expect(own).toHaveLength(1)
    expect(own[0].abortedAtSend).toBe(false)
    await theNewSignInStands(tIn)
  })

  it('an UNEXPIRED held token (its GET /user, told by its bearer): aborted by the sign-out, nothing removed, and the new sign-in stands', async () => {
    await heldThenRehydrating({ expired: false })
    expect(heldUserReads()).toHaveLength(1)
    expect(heldUserReads()[0].abortedAtSend).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mod.endSessionLocally()).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(events.filter((e) => e.sid === 'held-sid')).toEqual([])   // the ended session never reached the SDK
    expect(heldUserReads()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(8_000)
    const { tIn, aalWaitedMs } = await signInAgain()
    expect(aalWaitedMs).toBeLessThanOrEqual(100)
    await theNewSignInStands(tIn)
  })

  /** The held refresh failing fast: attempts at 0, 0.2, 0.6, 1.4, 3.0 and 6.2 s, then a 6.4 s backoff; 1 s into it, the sign-out. */
  async function signOutInsideALongBackoff() {
    net.heldRefresh = '503'
    await heldThenRehydrating({ expired: true })
    for (let i = 0; i < 200 && heldRefreshes().length < 6; i += 1) await vi.advanceTimersByTimeAsync(100)
    expect(heldRefreshes()).toHaveLength(6)
    const first = heldRefreshes()[0].t
    const sixth = heldRefreshes()[5].t
    await vi.advanceTimersByTimeAsync(1_000)
    const tOut = Date.now()
    expect(mod.endSessionLocally()).toBe(true)              // nothing in flight to abort: the loop is asleep
    return { first, sixth, tOut }
  }

  it("a held refresh failing fast: a new sign-in that lands before the loop's next attempt stands — that attempt is answered with a 503, not a refusal", async () => {
    const { first, tOut } = await signOutInsideALongBackoff()
    await vi.advanceTimersByTimeAsync(2_000)
    const { tIn, aalWaitedMs } = await signInAgain()
    // the loop ran out its 30 s window on answers that never reached the network, and removed nothing
    expect(heldRefreshes().filter((r) => r.t > tOut)).toEqual([])
    expect(tIn + aalWaitedMs - first).toBeLessThanOrEqual(30_000)   // the lock comes free when the window runs out
    await theNewSignInStands(tIn)
  })

  it('CONTROL: the same sign-out with no new sign-in — the next attempt is answered with the refusal, and the loop ends there', async () => {
    const { sixth, tOut } = await signOutInsideALongBackoff()
    await vi.advanceTimersByTimeAsync(7_000)
    const outs = signedOutSince(tOut)
    expect(outs).toHaveLength(1)
    expect(outs[0].t - sixth).toBeGreaterThanOrEqual(6_000)  // at the next attempt, after the backoff…
    expect(outs[0].t - sixth).toBeLessThan(7_000)            // …not at the end of the window
    expect(heldRefreshes().filter((r) => r.t > tOut)).toEqual([])
    expect(logouts()).toEqual([])
  })
})
