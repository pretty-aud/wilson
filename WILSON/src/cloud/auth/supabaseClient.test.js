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

import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured = vi.hoisted(() => ({ fetch: null, listeners: [], getSession: null, signOut: null, from: null, head: null }))
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
        setSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      },
      from: (...a) => captured.from(...a),
    }
  },
}))
const stored = vi.hoisted(() => ({ saveSession: null }))
vi.mock('./sessionStorage', () => ({ saveSession: (...a) => stored.saveSession(...a) }))
const wd = vi.hoisted(() => ({ ping: [], recovered: [] }))
vi.mock('../connectionWatchdog', async (orig) => {
  const real = await orig()
  return {
    ...real,
    connectionWatchdog: {
      wrapFetch: (f) => f,
      onRecovered: (l) => { wd.recovered.push(l); return () => {} },
      onPingAnswered: (l) => { wd.ping.push(l); return () => {} },
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
  stored.saveSession = vi.fn(async () => {})
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
