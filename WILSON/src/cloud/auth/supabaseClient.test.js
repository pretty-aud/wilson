// =============================================================================
// supabaseClient.test.js — S1 (night 2, 2026-10-27; review round 2, F1 and
// F5). The client module's own behaviours, which no other test reached:
//
//   * the guard is composed OUTSIDE the watchdog's wrapper, and reads whether
//     a person is signed in from the auth EVENTS: INITIAL_SESSION with no
//     session leaves it signed out; SIGNED_IN signs it in; SIGNED_OUT out;
//   * the auth family's retry on an answered ping asks for the session (and
//     the rest family's a HEAD of one `workspaces` row); the storage family
//     asks nothing (its ping repeats the hung request itself);
//   * the sign-out latch: after `endSessionLocally()` a TOKEN_REFRESHED is
//     NOT written back to the stored session, the guard treats the person as
//     signed out, and the auth retry finishes the sign-out instead of asking
//     for the session; SIGNED_IN (a new sign-in) and SIGNED_OUT clear it.
//
// `createClient` is mocked to a client whose `global.fetch` is captured and
// whose auth events the test fires; the watchdog is the real module with its
// app-wide instance replaced by a hand-driven one (its wrapper passes through).
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const captured = vi.hoisted(() => ({ fetch: null, listeners: [], getSession: null, signOut: null, setSession: null, from: null, head: null }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url, key, opts) => {
    captured.fetch = opts.global.fetch
    captured.getSession = vi.fn(async () => ({ data: { session: null }, error: null }))
    captured.signOut = vi.fn(async () => ({ error: null }))
    captured.head = vi.fn(() => ({ limit: vi.fn(async () => ({ data: null, error: null })) }))
    captured.from = vi.fn(() => ({ select: captured.head }))
    return {
      auth: {
        onAuthStateChange: (cb) => { captured.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } } },
        getSession: (...a) => captured.getSession(...a),
        signOut: (...a) => captured.signOut(...a),
        setSession: (...a) => captured.setSession(...a),   // S2: the test decides what the SDK's restore does
      },
      from: (...a) => captured.from(...a),
    }
  },
}))
const stored = vi.hoisted(() => ({ saveSession: null, loadSession: null, clearSession: null }))
vi.mock('./sessionStorage', () => ({
  SESSION_STORAGE_KEY: 'wilson.dev.session',   // S2: sessionTimeouts.js (the cap's own record) reads it
  saveSession: (...a) => stored.saveSession(...a),
  loadSession: (...a) => stored.loadSession(...a),
  clearSession: (...a) => stored.clearSession(...a),
}))
const wd = vi.hoisted(() => ({ ping: [], recovered: [], launchProbe: null, launchedOffline: null, launchEnded: null, quietWhile: null }))
vi.mock('../connectionWatchdog', async (orig) => {
  const real = await orig()
  return {
    ...real,
    connectionWatchdog: {
      wrapFetch: (f) => f,
      onRecovered: (l) => { wd.recovered.push(l); return () => {} },
      onPingAnswered: (l) => { wd.ping.push(l); return () => {} },
      // S2: the launch path, each a spy the test reads
      launchProbe: (...a) => wd.launchProbe(...a),
      launchedOffline: (...a) => wd.launchedOffline(...a),
      launchEnded: (...a) => wd.launchEnded(...a),
      quietWhile: (...a) => wd.quietWhile(...a),
      subscribe: () => () => {},
      getSnapshot: () => false,
      getPhase: () => 'ok',
    },
  }
})

const BASE = 'https://eqjzmnvkrakroyqxfsvw.supabase.co'
// The module reads its key from the environment at import; CI has no .env.local, so one is stubbed.
const ANON = 'anon-key-for-the-test'
const fire = (event, session) => { for (const l of captured.listeners) l(event, session) }
const session = () => ({ access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u' } })
const tick = () => new Promise((r) => setTimeout(r, 0))

let base
let mod
beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', BASE)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON)
  captured.listeners = []
  wd.ping = []
  wd.recovered = []
  wd.launchProbe = vi.fn(async () => false)
  wd.launchedOffline = vi.fn()
  wd.launchEnded = vi.fn()
  wd.quietWhile = vi.fn()
  captured.setSession = vi.fn(async () => ({ data: { session: null }, error: null }))
  stored.saveSession = vi.fn(async () => {})
  stored.loadSession = vi.fn(async () => null)
  stored.clearSession = vi.fn(async () => {})
  base = vi.fn(async () => ({ ok: true, status: 200 }))
  vi.stubGlobal('fetch', base)
  mod = await import('./supabaseClient')
})

const anonRead = () => captured.fetch(`${BASE}/rest/v1/workspaces?select=id`, { method: 'GET', headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
const tokenRead = () => captured.fetch(`${BASE}/rest/v1/workspaces?select=id`, { method: 'GET', headers: { apikey: ANON, Authorization: 'Bearer a-session-token' } })

describe('the guard, from the auth events', () => {
  it('signed out until an event carries a session: the anon bearer passes, then is refused, then passes again after SIGNED_OUT', async () => {
    fire('INITIAL_SESSION', null)
    await anonRead()
    expect(base).toHaveBeenCalledTimes(1)
    fire('SIGNED_IN', session())
    await expect(anonRead()).rejects.toThrow(mod.ANON_GUARD_MESSAGE ?? /session check failed/)
    expect(base).toHaveBeenCalledTimes(1)
    await tokenRead()
    expect(base).toHaveBeenCalledTimes(2)
    fire('SIGNED_OUT', null)
    await anonRead()
    expect(base).toHaveBeenCalledTimes(3)
  })

  it('a TOKEN_REFRESHED with a session also counts as signed in, and is written to the stored session', async () => {
    fire('TOKEN_REFRESHED', session())
    await tick()
    expect(stored.saveSession).toHaveBeenCalledTimes(1)
    await expect(anonRead()).rejects.toThrow(/session check failed/)
  })
})

describe('the retry on an answered ping', () => {
  it('auth asks for the session; rest asks a HEAD of one workspaces row; storage asks nothing', async () => {
    expect(wd.ping).toHaveLength(1)
    const answered = wd.ping[0]
    answered('auth')
    expect(captured.getSession).toHaveBeenCalledTimes(1)
    expect(captured.signOut).not.toHaveBeenCalled()
    answered('rest')
    expect(captured.from).toHaveBeenCalledWith('workspaces')
    expect(captured.head).toHaveBeenCalledWith('id', { head: true })
    answered('storage')
    expect(captured.getSession).toHaveBeenCalledTimes(1)
    expect(captured.from).toHaveBeenCalledTimes(1)
  })
})

describe('the sign-out latch (round 2, F1)', () => {
  it('after endSessionLocally() a refreshed token is not written back, the guard reads signed out, and the auth retry finishes the sign-out', async () => {
    fire('SIGNED_IN', session())
    mod.endSessionLocally()
    fire('TOKEN_REFRESHED', session())   // the SDK kept the session and refreshed it on a dead network's return
    await tick()
    expect(stored.saveSession).not.toHaveBeenCalled()
    await anonRead()                      // signed out as far as the guard is concerned
    expect(base).toHaveBeenCalledTimes(1)
    wd.ping[0]('auth')
    expect(captured.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(captured.getSession).not.toHaveBeenCalled()
  })

  it('the sign-out landing (SIGNED_OUT) clears the latch; so does a new sign-in, after which a refresh is written again', async () => {
    mod.endSessionLocally()
    fire('SIGNED_OUT', null)
    fire('TOKEN_REFRESHED', session())
    await tick()
    expect(stored.saveSession).toHaveBeenCalledTimes(1)
    mod.endSessionLocally()
    fire('TOKEN_REFRESHED', session())
    await tick()
    expect(stored.saveSession).toHaveBeenCalledTimes(1)
    fire('SIGNED_IN', session())
    fire('TOKEN_REFRESHED', session())
    await tick()
    expect(stored.saveSession).toHaveBeenCalledTimes(2)
    wd.ping[0]('auth')
    expect(captured.getSession).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: without the latch the same refresh IS written back (the hook as it was before S1\'s round 2)', async () => {
    fire('SIGNED_IN', session())
    fire('TOKEN_REFRESHED', session())
    await tick()
    expect(stored.saveSession).toHaveBeenCalledTimes(1)
  })
})

// =============================================================================
// S2 (night 3, 2026-10-27; docs/design/RECONNECT_DESIGN.md §11.4, §11.5): the
// session HELD at an offline launch. A saved sign-in inside the 4-hour cap
// (here: the token's own amr, an hour old; the record is absent, as on the
// desktop) whose launch reached nothing is held: the guard latched from the
// hold, the watchdog told, the store untouched; the first answered auth ping
// re-hydrates; a refusal clears the store if it still holds the refused token
// and tells App; a sign-out during a re-hydration stays a sign-out.
// =============================================================================
describe('S2 — the session held at an offline launch', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const savedSession = ({ signedInAgoMs = 60 * 60_000, sid = 'held-sid' } = {}) => {
    const now = Math.floor(Date.now() / 1000)
    const claims = { sub: 'u-held', session_id: sid, exp: now + 3000, amr: [{ method: 'password', timestamp: now - Math.floor(signedInAgoMs / 1000) }], app_metadata: { workspace_id: 'w1', app_role: 'user' } }
    return { access_token: `${b64({ alg: 'ES256' })}.${b64(claims)}.sig`, refresh_token: 'held-refresh', expires_at: now + 3000, user: { id: 'u-held' } }
  }
  const held = async () => (await import('./heldSession')).heldSession()

  it('reached nothing inside the cap: the saved session is held and returned, the SDK never asked, the guard latched', async () => {
    const saved = savedSession()
    const r = await mod.hydrateSupabase(saved, { holdOffline: true })
    expect(r).toBe(saved)
    expect(await held()).toBe(saved)
    expect(wd.launchProbe).toHaveBeenCalledWith({ origin: BASE, apikey: ANON })
    expect(captured.setSession).not.toHaveBeenCalled()
    expect(wd.launchedOffline).toHaveBeenCalledWith({ origin: BASE, apikey: ANON })
    fire('INITIAL_SESSION', null)                          // the SDK's own first event carries nothing
    await expect(anonRead()).rejects.toThrow('Could not reach the database, so the request was not sent.')
    expect(base).not.toHaveBeenCalled()
    expect(stored.clearSession).not.toHaveBeenCalled()
  })

  it('CONTROL: the same launch without `holdOffline` (the operator console) is today\'s restore — no probe, no hold, the guard open', async () => {
    const r = await mod.hydrateSupabase(savedSession())
    expect(r).toBeNull()
    expect(captured.setSession).toHaveBeenCalledTimes(1)
    expect(wd.launchProbe).not.toHaveBeenCalled()
    expect(await held()).toBeNull()
    await anonRead()
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('outside the cap (signed in five hours ago): today\'s restore, never held', async () => {
    const r = await mod.hydrateSupabase(savedSession({ signedInAgoMs: 5 * 60 * 60_000 }), { holdOffline: true })
    expect(r).toBeNull()
    expect(wd.launchProbe).not.toHaveBeenCalled()
    expect(captured.setSession).toHaveBeenCalledTimes(1)
    expect(await held()).toBeNull()
  })

  it('answered, then refused (403): no session, and the store cleared — only while it still holds the refused token', async () => {
    wd.launchProbe = vi.fn(async () => true)
    captured.setSession = vi.fn(async () => ({ data: { session: null }, error: Object.assign(new Error('bad_jwt'), { name: 'AuthApiError', status: 403 }) }))
    const saved = savedSession()
    stored.loadSession = vi.fn(async () => ({ refresh_token: 'held-refresh' }))
    expect(await mod.hydrateSupabase(saved, { holdOffline: true })).toBeNull()
    expect(stored.clearSession).toHaveBeenCalledTimes(1)
    stored.clearSession.mockClear()
    stored.loadSession = vi.fn(async () => ({ refresh_token: 'another-tab-saved-a-newer-one' }))
    expect(await mod.hydrateSupabase(saved, { holdOffline: true })).toBeNull()
    expect(stored.clearSession).not.toHaveBeenCalled()
    expect(await held()).toBeNull()
  })

  it('the re-hydration: the first answered auth ping gives the held session to the SDK (quietly), SIGNED_IN ends the hold', async () => {
    const saved = savedSession()
    await mod.hydrateSupabase(saved, { holdOffline: true })
    captured.setSession = vi.fn(async (s) => {
      const session = { ...saved, ...s }
      fire('SIGNED_IN', session)                           // what auth-js does inside setSession for an unexpired token
      return { data: { session }, error: null }
    })
    wd.ping[0]('auth')
    expect(captured.setSession).toHaveBeenCalledWith({ access_token: saved.access_token, refresh_token: 'held-refresh' })
    expect(captured.getSession).not.toHaveBeenCalled()     // while held the real question is the session itself
    expect(wd.quietWhile).toHaveBeenCalledWith('auth', expect.any(Promise))
    await tick(); await tick()
    expect(await held()).toBeNull()
    expect(wd.launchEnded).toHaveBeenCalled()
    await tokenRead()
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('a refusal on the way back: the hold ends, the store is cleared, App is told', async () => {
    const saved = savedSession()
    await mod.hydrateSupabase(saved, { holdOffline: true })
    stored.loadSession = vi.fn(async () => ({ refresh_token: 'held-refresh' }))
    captured.setSession = vi.fn(async () => ({ data: { session: null }, error: Object.assign(new Error('invalid refresh'), { name: 'AuthApiError', status: 400 }) }))
    const refused = vi.fn()
    mod.onHeldSessionRefused(refused)
    wd.ping[0]('auth')
    await tick(); await tick(); await tick()
    expect(refused).toHaveBeenCalledTimes(1)
    expect(stored.clearSession).toHaveBeenCalledTimes(1)
    expect(await held()).toBeNull()
  })

  it('reached nothing again on the way back: still held, nothing cleared, App not told', async () => {
    const saved = savedSession()
    await mod.hydrateSupabase(saved, { holdOffline: true })
    captured.setSession = vi.fn(async () => ({ data: { session: null }, error: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 }) }))
    const refused = vi.fn()
    mod.onHeldSessionRefused(refused)
    wd.ping[0]('auth')
    await tick(); await tick()
    expect(await held()).toBe(saved)
    expect(refused).not.toHaveBeenCalled()
    expect(stored.clearSession).not.toHaveBeenCalled()
  })

  it('a SIGNED_OUT while held (the SDK\'s, inside a refused restore) leaves the latch on', async () => {
    await mod.hydrateSupabase(savedSession(), { holdOffline: true })
    fire('SIGNED_OUT', null)
    await expect(anonRead()).rejects.toThrow(/Could not reach the database/)
    expect(base).not.toHaveBeenCalled()
  })

  it('a sign-out ends the hold at once, and a sign-out DURING a re-hydration stays a sign-out', async () => {
    const saved = savedSession()
    await mod.hydrateSupabase(saved, { holdOffline: true })
    let finish
    captured.setSession = vi.fn(() => new Promise((res) => { finish = res }))
    wd.ping[0]('auth')
    mod.endSessionLocally()                                // the person signs out while it is out
    expect(await held()).toBeNull()
    expect(wd.launchEnded).toHaveBeenCalled()
    fire('SIGNED_IN', { ...saved })                        // the late re-hydration lands: the SAME session id
    expect(captured.signOut).toHaveBeenCalledWith({ scope: 'local' })
    await anonRead()                                       // the guard still reads the person as signed out
    expect(base).toHaveBeenCalledTimes(1)
    finish({ data: { session: { ...saved } }, error: null })
    await tick(); await tick()
    expect(captured.signOut).toHaveBeenCalledTimes(2)      // and the session it gave the SDK is dropped
    fire('SIGNED_IN', savedSession({ sid: 'a-new-sign-in' }))   // CONTROL: a real new sign-in is a sign-in
    await expect(anonRead()).rejects.toThrow(/session check failed/)
  })
})

// ── S2, build review round 1 (F2–F5, F8): the corrections, each pinned ──────
describe('S2 — build review round 1', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const savedSession = ({ sid = 'held-sid' } = {}) => {
    const now = Math.floor(Date.now() / 1000)
    const claims = { sub: 'u-held', session_id: sid, exp: now + 3000, amr: [{ method: 'password', timestamp: now - 3600 }], app_metadata: { workspace_id: 'w1', app_role: 'user' } }
    return { access_token: `${b64({ alg: 'ES256' })}.${b64(claims)}.sig`, refresh_token: 'held-refresh', expires_at: now + 3000, user: { id: 'u-held' } }
  }
  const held = async () => (await import('./heldSession')).heldSession()
  const apiError = (status) => Object.assign(new Error(`status ${status}`), { name: 'AuthApiError', status })
  afterEach(() => { vi.useRealTimers() })

  /** A launch whose SDK restore outlives the 10 s ceiling; returns the hand that settles it. */
  async function launchPastTheCeiling(saved) {
    vi.useFakeTimers()
    wd.launchProbe = vi.fn(async () => true)
    let settleRestore
    captured.setSession = vi.fn(() => new Promise((res) => { settleRestore = res }))
    const p = mod.hydrateSupabase(saved, { holdOffline: true })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await p).toBe(saved)
    vi.useRealTimers()
    return (r) => settleRestore(r)
  }

  it('F8: the late restore is covered — quiet while it is out; a late session confirms and lowers the launch\'s loss', async () => {
    const saved = savedSession()
    const settle = await launchPastTheCeiling(saved)
    expect(wd.quietWhile).toHaveBeenCalledWith('auth', expect.any(Promise))
    expect(await held()).toBe(saved)
    settle({ data: { session: { ...saved } }, error: null })
    await tick(); await tick()
    expect(await held()).toBeNull()
    expect(wd.launchEnded).toHaveBeenCalled()
  })

  it('F8: a late refusal ends the hold through App, the store cleared while it still holds the refused token', async () => {
    const saved = savedSession()
    stored.loadSession = vi.fn(async () => ({ refresh_token: 'held-refresh' }))
    const refused = vi.fn()
    mod.onHeldSessionRefused(refused)
    const settle = await launchPastTheCeiling(saved)
    settle({ data: { session: null }, error: apiError(401) })
    await tick(); await tick(); await tick()
    expect(refused).toHaveBeenCalledTimes(1)
    expect(stored.clearSession).toHaveBeenCalledTimes(1)
  })

  it('F2/F8: a late answer that is neither (a 429) keeps the session held, and the launch\'s loss up', async () => {
    const saved = savedSession()
    const settle = await launchPastTheCeiling(saved)
    settle({ data: { session: null }, error: apiError(429) })
    await tick(); await tick()
    expect(await held()).toBe(saved)
    expect(wd.launchEnded).not.toHaveBeenCalled()
  })

  it('F3: App is told while the hold still names the person (its sign-out reads whose pet cache to clear)', async () => {
    const saved = savedSession()
    await mod.hydrateSupabase(saved, { holdOffline: true })
    stored.loadSession = vi.fn(async () => ({ refresh_token: 'held-refresh' }))
    captured.setSession = vi.fn(async () => ({ data: { session: null }, error: apiError(403) }))
    const { heldSession } = await import('./heldSession')
    const seen = []
    mod.onHeldSessionRefused((s) => { seen.push({ arg: s, heldThen: heldSession() }) })
    wd.ping[0]('auth')
    await tick(); await tick(); await tick()
    expect(seen).toHaveLength(1)
    expect(seen[0].heldThen).toBe(saved)                   // the hold still named the person when App was told
    expect(seen[0].arg).toBe(saved)
    expect(await held()).toBeNull()                         // and it ended right after, nobody else ending it
  })

  it('F4 (round 2, F1): a sign-out aborts the held work\'s own requests — told by its tokens — and nothing is joined by URL alone', async () => {
    const saved = savedSession()
    await mod.hydrateSupabase(saved, { holdOffline: true })
    let finish
    captured.setSession = vi.fn(() => new Promise((res) => { finish = res }))
    wd.ping[0]('auth')                                      // the re-hydration is out
    const heldBearer = { apikey: ANON, Authorization: `Bearer ${saved.access_token}` }
    const refreshOf = (token) => captured.fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: ANON }, body: JSON.stringify({ refresh_token: token }) })
    await captured.fetch(`${BASE}/auth/v1/user`, { method: 'GET', headers: heldBearer })
    const userInit = base.mock.calls.at(-1)[1]
    expect(userInit.signal).toBeDefined()
    expect(userInit.signal.aborted).toBe(false)
    await refreshOf('held-refresh')                         // the held session's own refresh: its body carries the held token
    expect(base.mock.calls.at(-1)[1].signal).toBe(userInit.signal)
    // CONTROL (round 2, F1): the same URLs with another sign-in's tokens, and the password grant, are never joined
    await captured.fetch(`${BASE}/auth/v1/user`, { method: 'GET', headers: { apikey: ANON, Authorization: 'Bearer another-sign-in' } })
    expect(base.mock.calls.at(-1)[1].signal).toBeUndefined()
    await refreshOf('another-sign-ins-refresh')
    expect(base.mock.calls.at(-1)[1].signal).toBeUndefined()
    await captured.fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON }, body: '{}' })
    expect(base.mock.calls.at(-1)[1].signal).toBeUndefined()
    expect(mod.endSessionLocally()).toBe(true)              // a HELD session ended: App queues no SDK sign-out and writes no row
    expect(userInit.signal.aborted).toBe(true)
    // round 2, F1: the held work's next attempt never reaches the network — a refusal, which ends auth-js's retry loop
    const sent = base.mock.calls.length
    const answer = await refreshOf('held-refresh')
    expect(answer.status).toBe(400)
    expect(base.mock.calls.length).toBe(sent)
    // round 2, F2: endSessionLocally() lowers the launch's loss itself, so the epoch branch's own call is read from here
    wd.launchEnded.mockClear()
    finish({ data: { session: null }, error: Object.assign(new Error('aborted'), { name: 'AuthRetryableFetchError', status: 0 }) })
    await tick(); await tick()
    expect(wd.launchEnded).toHaveBeenCalledTimes(1)         // round 1, F5: lowered once the aborted request has settled
    await captured.fetch(`${BASE}/auth/v1/user`, { method: 'GET', headers: heldBearer })
    expect(base.mock.calls.at(-1)[1].signal).toBeUndefined()   // the work over: nothing joined any more
  })

  it('CONTROL for F4: with no held work out, GET /user goes as it always did (no signal added)', async () => {
    await captured.fetch(`${BASE}/auth/v1/user`, { method: 'GET', headers: { apikey: ANON } })
    expect(base.mock.calls.at(-1)[1].signal).toBeUndefined()
  })
})

// ── S2, build review round 2 (F1, F2, F5): the corrections, each pinned ─────
describe('S2 — build review round 2', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const savedSession = ({ sid = 'held-sid' } = {}) => {
    const now = Math.floor(Date.now() / 1000)
    const claims = { sub: 'u-held', session_id: sid, exp: now + 3000, amr: [{ method: 'password', timestamp: now - 3600 }], app_metadata: { workspace_id: 'w1', app_role: 'user' } }
    return { access_token: `${b64({ alg: 'ES256' })}.${b64(claims)}.sig`, refresh_token: 'held-refresh', expires_at: now + 3000, user: { id: 'u-held' } }
  }
  const held = async () => (await import('./heldSession')).heldSession()
  const aborted = () => ({ data: { session: null }, error: Object.assign(new Error('aborted'), { name: 'AuthRetryableFetchError', status: 0 }) })
  afterEach(() => { vi.useRealTimers() })

  /** Launches whose SDK restores outlive the 10 s ceiling (StrictMode runs two); returns the hands that settle them, in order. */
  async function launchesPastTheCeiling(...saved) {
    vi.useFakeTimers()
    wd.launchProbe = vi.fn(async () => true)
    const settles = []
    captured.setSession = vi.fn(() => new Promise((res) => { settles.push(res) }))
    const launches = saved.map((s) => mod.hydrateSupabase(s, { holdOffline: true }))
    await vi.advanceTimersByTimeAsync(10_000)
    for (const [i, p] of launches.entries()) expect(await p).toBe(saved[i])
    vi.useRealTimers()
    return settles
  }

  it('F1: once the held work is aborted its answer is a refusal while the SDK holds nothing, and a 503 once a new sign-in has landed', async () => {
    const saved = savedSession()
    await mod.hydrateSupabase(saved, { holdOffline: true })
    let finish
    captured.setSession = vi.fn(() => new Promise((res) => { finish = res }))
    wd.ping[0]('auth')
    mod.endSessionLocally()
    const heldRefresh = () => captured.fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: ANON }, body: JSON.stringify({ refresh_token: 'held-refresh' }) })
    expect((await heldRefresh()).status).toBe(400)
    // the password grant takes no lock, so a new sign-in can land while the held loop sleeps: a refusal now would
    // make auth-js remove the SDK's session — the new one — so the answer is a retryable 503
    fire('SIGNED_IN', { access_token: 'a-new-sign-in', refresh_token: 'its-own-refresh', user: { id: 'u-new' } })
    expect((await heldRefresh()).status).toBe(503)
    fire('SIGNED_OUT', null)                               // the SDK holds nothing again: a refusal again
    expect((await heldRefresh()).status).toBe(400)
    expect(base).not.toHaveBeenCalled()                     // none of it reached the network
    finish(aborted())
    await tick(); await tick()
  })

  it('F2: a sign-out during the late restore — the late handler lowers the launch\'s loss again once the aborted restore settles', async () => {
    const saved = savedSession()
    const [settle] = await launchesPastTheCeiling(saved)
    expect(mod.endSessionLocally()).toBe(true)
    wd.launchEnded.mockClear()                              // endSessionLocally() lowers it itself; the late handler must too
    settle(aborted())
    await tick(); await tick()
    expect(wd.launchEnded).toHaveBeenCalledTimes(1)
  })

  it('F5: two launches (StrictMode\'s double mount): the first late answer, landing after the second hold, leaves the loss up', async () => {
    const savedA = savedSession()
    const savedB = { ...savedA }                            // a second loadSession(): another object, the same tokens
    const [settleA, settleB] = await launchesPastTheCeiling(savedA, savedB)
    expect(await held()).toBe(savedB)
    settleA(aborted())
    await tick(); await tick()
    expect(wd.launchEnded).not.toHaveBeenCalled()           // the second hold is on: its strip and its pings stay
    expect(await held()).toBe(savedB)
    settleB({ data: { session: { ...savedB } }, error: null })   // CONTROL: the current hold's own answer confirms, and lowers it
    await tick(); await tick()
    expect(await held()).toBeNull()
    expect(wd.launchEnded).toHaveBeenCalledTimes(1)
  })

  it('F5: a sign-out aborts every piece of held work out, the first launch\'s too', async () => {
    const savedA = savedSession()
    const savedB = { ...savedA }
    await launchesPastTheCeiling(savedA, savedB)
    const heldBearer = { apikey: ANON, Authorization: `Bearer ${savedA.access_token}` }
    await captured.fetch(`${BASE}/auth/v1/user`, { method: 'GET', headers: heldBearer })
    const signal = base.mock.calls.at(-1)[1].signal
    expect(signal.aborted).toBe(false)
    mod.endSessionLocally()
    expect(signal.aborted).toBe(true)
  })
})
