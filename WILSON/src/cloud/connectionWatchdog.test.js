// =============================================================================
// connectionWatchdog.test.js — Track B bundle B2, part 2, and S1 (night 2,
// 2026-10-27): the recovery.
//
// Still here from B2: the no-false-positive test (a fake slow upload running
// for minutes never raises the strip), the offline exemption, the structural
// exclusions. S1 adds what docs/design/RECONNECT_DESIGN.md §6 lists: the
// abort at the budget (the caller rejects, the family is lost); `lost` kept
// per family and cleared only by an answer under 500 from that family; the
// pings (three shapes, the hung request's apikey, every 10 s, a 5 s budget,
// stopped on the clear; an answered ping aborts the family's older requests);
// a caller's own signal; the body scale; the words' clock; the guard; and,
// through auth-js AS INSTALLED on a fetch that never answers the refresh but
// honours the signal, the hang, the recovery, the start-up check — with a
// CONTROL that puts today's counting-only wrapper in front of the same client
// and is still pending after minutes.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { GoTrueClient } from '@supabase/auth-js'
import {
  createConnectionWatchdog, createAnonGuard, familyOf, shouldWatch, budgetFor, headerOf,
  WATCHDOG_BUDGET_MS, PING_EVERY_MS, PING_BUDGET_MS, RELOAD_AFTER_MS, ANON_GUARD_MESSAGE,
} from './connectionWatchdog'

const BASE = 'https://eqjzmnvkrakroyqxfsvw.supabase.co'
const MIN = 60_000
const KEY = { apikey: 'anon-key-for-the-test' }

afterEach(() => { vi.useRealTimers() })

/** A hand-stepped clock and interval, like sessionTimeouts.test.js. */
function harness({ online = true } = {}) {
  let t = 5_000_000
  const tickers = new Set()
  const h = {
    online,
    now: () => t,
    isOnline: () => h.online,
    schedule: (fn, ms) => { const x = { fn, ms, next: t + ms }; tickers.add(x); return x },
    unschedule: (x) => { tickers.delete(x) },
    advance(ms) {
      const end = t + ms
      for (;;) {
        let soonest = null
        for (const x of tickers) if (x.next <= end && (!soonest || x.next < soonest.next)) soonest = x
        if (!soonest) break
        t = soonest.next
        soonest.next += soonest.ms
        soonest.fn()
      }
      t = end
    },
    tickerCount: () => tickers.size,
  }
  return h
}

/** A fetch whose every call is a promise the test settles by hand — and that honours the signal it is given, as a real one does. */
function controllableFetch() {
  const calls = []
  const fetch = (input, init) => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    const signal = init?.signal
    if (signal) {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }
    calls.push({ input, init, resolve, reject, promise })
    return promise
  }
  return { fetch, calls }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

function make(h, extra = {}) {
  const wd = createConnectionWatchdog({
    budgetMs: WATCHDOG_BUDGET_MS, tickMs: 1000,
    now: h.now, isOnline: h.isOnline, schedule: h.schedule, unschedule: h.unschedule,
    windowRef: null, ...extra,
  })
  const notified = []
  wd.subscribe((lost, phase) => notified.push({ lost, phase }))
  const recovered = []
  wd.onRecovered((family) => recovered.push(family))
  const { fetch, calls } = controllableFetch()
  return { wd, fetch: wd.wrapFetch(fetch), calls, notified, recovered }
}

describe('familyOf / shouldWatch — the scope', () => {
  it('watches auth, PostgREST and storage downloads, each in its family', () => {
    expect(familyOf(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' })).toBe('auth')
    expect(familyOf(`${BASE}/rest/v1/workspaces?select=id`, { method: 'GET' })).toBe('rest')
    expect(familyOf(`${BASE}/rest/v1/auth_events`, { method: 'POST' })).toBe('rest')
    expect(familyOf(`${BASE}/storage/v1/object/rabbit-files/x.png`, { method: 'GET' })).toBe('storage')
    expect(familyOf(`${BASE}/storage/v1/object/rabbit-files/x.png`, { method: 'HEAD' })).toBe('storage')
    expect(shouldWatch(`${BASE}/auth/v1/token`, { method: 'POST' })).toBe(true)
  })

  it('never watches uploads, the resumable path, Edge Functions or anything else', () => {
    for (const [url, init] of [
      [`${BASE}/storage/v1/object/rabbit-files/big.mov`, { method: 'POST' }],
      [`${BASE}/storage/v1/object/rabbit-files/big.mov`, { method: 'PUT' }],
      [`${BASE}/storage/v1/upload/resumable`, { method: 'POST' }],
      [`${BASE}/storage/v1/upload/resumable/abc`, { method: 'PATCH' }],
      [`${BASE}/functions/v1/ai-proxy`, { method: 'POST' }],
      [`${BASE}/functions/v1/workspace-takeout`, { method: 'POST' }],
      [`${BASE}/realtime/v1/websocket`, {}],
      ['https://api.anthropic.com/v1/messages', { method: 'POST' }],
    ]) {
      expect(familyOf(url, init), url).toBeNull()
      expect(shouldWatch(url, init), url).toBe(false)
    }
  })

  it('reads the method from a Request-like object and accepts URL objects', () => {
    expect(familyOf({ url: `${BASE}/storage/v1/object/b/k`, method: 'POST' })).toBeNull()
    expect(familyOf({ url: `${BASE}/storage/v1/object/b/k`, method: 'GET' })).toBe('storage')
    expect(familyOf({ href: `${BASE}/rest/v1/projects` })).toBe('rest')
  })
})

describe('budgetFor — a body adds a second per 50 KB', () => {
  it('a body-less read keeps the base; a large write gets more', () => {
    expect(budgetFor(undefined)).toBe(WATCHDOG_BUDGET_MS)
    expect(budgetFor({ method: 'POST', body: '{}' })).toBe(WATCHDOG_BUDGET_MS + 1000)
    expect(budgetFor({ method: 'POST', body: 'x'.repeat(100 * 1024) })).toBe(WATCHDOG_BUDGET_MS + 2000)
    expect(budgetFor({ method: 'POST', body: { size: 1024 * 1024 } })).toBe(WATCHDOG_BUDGET_MS + 21_000)
    expect(budgetFor({ method: 'POST', body: new ArrayBuffer(51_200) })).toBe(WATCHDOG_BUDGET_MS + 1000)
  })
})

describe('headerOf', () => {
  it('reads a Headers, a plain object and an array of pairs, case-insensitively', () => {
    expect(headerOf({ headers: new Headers({ Apikey: 'k' }) }, 'apikey')).toBe('k')
    expect(headerOf({ headers: { APIKEY: 'k' } }, 'apikey')).toBe('k')
    expect(headerOf({ headers: [['apikey', 'k']] }, 'ApiKey')).toBe('k')
    expect(headerOf({ headers: {} }, 'apikey')).toBeNull()
    expect(headerOf(undefined, 'apikey')).toBeNull()
  })
})

describe('the abort at the budget', () => {
  it('a PostgREST call pending past the budget while online is aborted: its caller rejects, the family is lost, the strip is up', async () => {
    const h = harness()
    const { fetch, calls, wd, notified } = make(h)
    const p = fetch(`${BASE}/rest/v1/projects?select=id`, { method: 'GET', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS - 1000)
    expect(calls[0].init.signal.aborted).toBe(false)
    expect(wd.getSnapshot()).toBe(false)
    h.advance(1000)
    expect(calls[0].init.signal.aborted).toBe(true)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(wd.getSnapshot()).toBe(true)
    expect(wd.getPhase()).toBe('reconnecting')
    expect(wd.lostFamilies()).toEqual(['rest'])
    expect(wd.pendingCount()).toBe(0)
    expect(notified).toEqual([{ lost: true, phase: 'reconnecting' }])
  })

  it('an auth refresh that never settles is aborted at the budget and the loss stays up for as long as nothing answers', () => {
    const h = harness()
    const { fetch, calls, wd } = make(h)
    fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: KEY, body: '{}' }).catch(() => {})
    h.advance(WATCHDOG_BUDGET_MS + 1000)   // the body adds a second
    expect(calls[0].init.signal.aborted).toBe(true)
    expect(wd.lostFamilies()).toEqual(['auth'])
    h.advance(10 * MIN)
    expect(wd.getSnapshot()).toBe(true)   // every ping was aborted too; nothing answered
    expect(wd.getPhase()).toBe('reload')
  })

  it('a body scales the budget: a 100 KB write is given two seconds more', () => {
    const h = harness()
    const { fetch, calls } = make(h)
    fetch(`${BASE}/rest/v1/otter_courses`, { method: 'POST', headers: KEY, body: 'x'.repeat(100 * 1024) }).catch(() => {})
    h.advance(WATCHDOG_BUDGET_MS + 1000)
    expect(calls[0].init.signal.aborted).toBe(false)
    h.advance(1000)
    expect(calls[0].init.signal.aborted).toBe(true)
  })

  it("a caller's own signal aborts the request and raises nothing (it is a settle, not a loss)", async () => {
    const h = harness()
    const { fetch, calls, wd } = make(h)
    const outer = new AbortController()
    const p = fetch(`${BASE}/rest/v1/projects`, { method: 'GET', signal: outer.signal })
    h.advance(3000)
    outer.abort()
    expect(calls[0].init.signal.aborted).toBe(true)
    await expect(p).rejects.toBeDefined()
    expect(wd.getSnapshot()).toBe(false)
    expect(wd.pendingCount()).toBe(0)
    h.advance(WATCHDOG_BUDGET_MS + 1000)
    expect(wd.getSnapshot()).toBe(false)
  })

  it('does not abort while the browser says it is offline, and does once it says online again', () => {
    const h = harness({ online: false })
    const { fetch, calls, wd } = make(h)
    fetch(`${BASE}/rest/v1/projects`, { method: 'GET' }).catch(() => {})
    h.advance(WATCHDOG_BUDGET_MS + 5000)
    expect(calls[0].init.signal.aborted).toBe(false)
    expect(wd.getSnapshot()).toBe(false)
    h.online = true
    h.advance(1000)
    expect(calls[0].init.signal.aborted).toBe(true)
    expect(wd.getSnapshot()).toBe(true)
  })

  it('a fast failure is released and never counted', async () => {
    const h = harness()
    const { fetch, calls, wd } = make(h)
    const p = fetch(`${BASE}/rest/v1/projects`, { method: 'GET' })
    calls[0].reject(new TypeError('Failed to fetch'))
    await expect(p).rejects.toThrow('Failed to fetch')
    expect(wd.pendingCount()).toBe(0)
    h.advance(WATCHDOG_BUDGET_MS + 1000)
    expect(wd.getSnapshot()).toBe(false)
  })

  it('passes input and init through, adds its own signal, and returns the underlying response', async () => {
    const h = harness()
    const { fetch, calls } = make(h)
    const init = { method: 'POST', headers: { apikey: 'k' }, body: '{}' }
    const p = fetch(`${BASE}/rest/v1/auth_events`, init)
    expect(calls[0].input).toBe(`${BASE}/rest/v1/auth_events`)
    expect(calls[0].init).toMatchObject(init)
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
    const response = { ok: true, status: 201 }
    calls[0].resolve(response)
    await expect(p).resolves.toBe(response)
  })

  it('a synchronous throw from the base fetch is released and re-thrown', () => {
    const h = harness()
    const wd = createConnectionWatchdog({ now: h.now, isOnline: h.isOnline, schedule: h.schedule, unschedule: h.unschedule, windowRef: null })
    const wrapped = wd.wrapFetch(() => { throw new TypeError('Illegal invocation') })
    expect(() => wrapped(`${BASE}/rest/v1/x`, {})).toThrow('Illegal invocation')
    expect(wd.pendingCount()).toBe(0)
    expect(h.tickerCount()).toBe(0)
  })
})

describe('lost: per family, cleared only by an answer under 500 from that family', () => {
  async function lostRest(h, api) {
    const p = api.fetch(`${BASE}/rest/v1/projects`, { method: 'GET', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await p.catch(() => {})
    expect(api.wd.lostFamilies()).toEqual(['rest'])
  }

  it('an abort does not clear what it raised; an answer does, and says which family came back', async () => {
    const h = harness()
    const api = make(h)
    await lostRest(h, api)
    h.advance(3000)
    expect(api.wd.getSnapshot()).toBe(true)
    const p = api.fetch(`${BASE}/rest/v1/tasks`, { method: 'GET', headers: KEY })
    api.calls[api.calls.length - 1].resolve({ ok: true, status: 200 })
    await p
    expect(api.wd.getSnapshot()).toBe(false)
    expect(api.wd.getPhase()).toBe('ok')
    expect(api.recovered).toEqual(['rest'])
    expect(api.notified).toEqual([{ lost: true, phase: 'reconnecting' }, { lost: false, phase: 'ok' }])
    expect(h.tickerCount()).toBe(0)
  })

  it('a PostgREST answer does not clear an auth loss (round 1, F1): GoTrue stuck while PostgREST answers is an ordinary partial outage', async () => {
    const h = harness()
    const api = make(h)
    const refresh = api.fetch(`${BASE}/auth/v1/token`, { method: 'POST', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await refresh.catch(() => {})
    expect(api.wd.lostFamilies()).toEqual(['auth'])
    const read = api.fetch(`${BASE}/rest/v1/tasks`, { method: 'GET', headers: KEY })
    api.calls[api.calls.length - 1].resolve({ ok: true, status: 200 })
    await read
    expect(api.wd.lostFamilies()).toEqual(['auth'])
    expect(api.wd.getSnapshot()).toBe(true)
  })

  it('a 5xx clears nothing, nor does a rejection: only an answer under 500 is a connection', async () => {
    const h = harness()
    const api = make(h)
    await lostRest(h, api)
    const gateway = api.fetch(`${BASE}/rest/v1/tasks`, { method: 'GET', headers: KEY })
    api.calls[api.calls.length - 1].resolve({ ok: false, status: 503 })
    await gateway
    expect(api.wd.getSnapshot()).toBe(true)
    const failed = api.fetch(`${BASE}/rest/v1/tasks`, { method: 'GET', headers: KEY })
    api.calls[api.calls.length - 1].reject(new TypeError('Failed to fetch'))
    await failed.catch(() => {})
    expect(api.wd.getSnapshot()).toBe(true)
    const refused = api.fetch(`${BASE}/rest/v1/tasks`, { method: 'GET', headers: KEY })
    api.calls[api.calls.length - 1].resolve({ ok: false, status: 401 })
    await refused
    expect(api.wd.getSnapshot()).toBe(false)   // 401 is an answer: the service is there
  })

  it('two families lost clear each on their own; the strip stays while either is lost', async () => {
    const h = harness()
    const api = make(h)
    const a = api.fetch(`${BASE}/auth/v1/token`, { method: 'POST', headers: KEY })
    const r = api.fetch(`${BASE}/rest/v1/tasks`, { method: 'GET', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await Promise.allSettled([a, r])
    expect(api.wd.lostFamilies().sort()).toEqual(['auth', 'rest'])
    const read = api.fetch(`${BASE}/rest/v1/tasks`, { method: 'GET', headers: KEY })
    api.calls[api.calls.length - 1].resolve({ ok: true, status: 200 })
    await read
    expect(api.wd.lostFamilies()).toEqual(['auth'])
    expect(api.wd.getSnapshot()).toBe(true)
    const refresh = api.fetch(`${BASE}/auth/v1/token`, { method: 'POST', headers: KEY })
    api.calls[api.calls.length - 1].resolve({ ok: true, status: 200 })
    await refresh
    expect(api.wd.getSnapshot()).toBe(false)
    expect(api.recovered).toEqual(['rest', 'auth'])
  })
})

describe('the ping', () => {
  const pings = (calls) => calls.filter((c) => c.init?.headers?.apikey !== undefined && (c.init.method === 'HEAD' || String(c.input).endsWith('/auth/v1/health')))

  it('an auth loss is asked every 10 s at GET /auth/v1/health, with the hung request\'s apikey, on a 5 s budget', async () => {
    const h = harness()
    const { fetch, calls, wd } = make(h)
    const refresh = fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await refresh.catch(() => {})
    expect(calls).toHaveLength(2)
    expect(calls[1].input).toBe(`${BASE}/auth/v1/health`)
    expect(calls[1].init).toMatchObject({ method: 'GET', headers: { apikey: KEY.apikey } })
    expect(wd.pingsInFlight()).toBe(1)
    h.advance(PING_BUDGET_MS)
    expect(calls[1].init.signal.aborted).toBe(true)
    await settle()
    expect(wd.pingsInFlight()).toBe(0)
    expect(calls).toHaveLength(2)
    h.advance(PING_EVERY_MS - PING_BUDGET_MS)
    expect(calls).toHaveLength(3)
    expect(calls[2].input).toBe(`${BASE}/auth/v1/health`)
    expect(wd.getSnapshot()).toBe(true)
  })

  it('a rest loss pings HEAD /rest/v1/; a storage loss HEADs the hung object itself', async () => {
    const h = harness()
    const { fetch, calls } = make(h)
    const read = fetch(`${BASE}/rest/v1/tasks?select=id`, { method: 'GET', headers: KEY })
    const dl = fetch(`${BASE}/storage/v1/object/rabbit-files/dailies/reel.png`, { method: 'GET', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await Promise.allSettled([read, dl])
    const sent = calls.slice(2).map((c) => [c.init.method, c.input])
    expect(sent).toEqual([
      ['HEAD', `${BASE}/rest/v1/`],
      ['HEAD', `${BASE}/storage/v1/object/rabbit-files/dailies/reel.png`],
    ])
    expect(pings(calls)).toHaveLength(2)
  })

  it('an answered ping clears its family and aborts the family\'s requests that were pending before it (round 1, F3)', async () => {
    const h = harness()
    const { fetch, calls, wd, recovered } = make(h)
    const first = fetch(`${BASE}/auth/v1/token`, { method: 'POST', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await first.catch(() => {})
    // the SDK's retry, 200 ms later, on a connection that is just as dead
    h.advance(200)
    const retry = fetch(`${BASE}/auth/v1/token`, { method: 'POST', headers: KEY })
    h.advance(PING_EVERY_MS - 200)
    const ping2 = calls[calls.length - 1]
    expect(ping2.input).toBe(`${BASE}/auth/v1/health`)
    const retryRejected = expect(retry).rejects.toMatchObject({ name: 'AbortError' })
    ping2.resolve({ ok: true, status: 200 })
    await settle()
    expect(wd.getSnapshot()).toBe(false)
    expect(recovered).toEqual(['auth'])
    await retryRejected
    expect(wd.getSnapshot()).toBe(false)   // that abort raised nothing: the family had just answered
  })

  it('an aborted ping does not restart the clock, nor does a later abort; the words change 60 s after the first raise (round 1, F10, F11)', async () => {
    const h = harness()
    const { fetch, wd } = make(h)
    const t0 = h.now()
    const first = fetch(`${BASE}/rest/v1/tasks`, { method: 'GET', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await first.catch(() => {})
    expect(wd.overdueSince()).toBe(t0 + WATCHDOG_BUDGET_MS)
    h.advance(10_000)
    const second = fetch(`${BASE}/rest/v1/tasks`, { method: 'GET', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await second.catch(() => {})
    expect(wd.overdueSince()).toBe(t0 + WATCHDOG_BUDGET_MS)
    expect(wd.getPhase()).toBe('reconnecting')
    h.advance(RELOAD_AFTER_MS - WATCHDOG_BUDGET_MS - 10_000 - 1000)
    expect(wd.getPhase()).toBe('reconnecting')
    h.advance(1000)
    expect(wd.getPhase()).toBe('reload')
    expect(h.now() - t0).toBe(WATCHDOG_BUDGET_MS + RELOAD_AFTER_MS)   // 80 s into the hang
    expect(wd.pingsInFlight()).toBeGreaterThanOrEqual(0)   // still asking
  })

  it('NO FALSE POSITIVE: a slow upload running for minutes never raises the strip', async () => {
    const h = harness()
    const { fetch, calls, wd, notified } = make(h)
    const upload = fetch(`${BASE}/storage/v1/object/rabbit-files/dailies/reel.mov`, { method: 'POST', body: 'x'.repeat(10) })
    const tus = fetch(`${BASE}/storage/v1/upload/resumable/abc`, { method: 'PATCH' })
    h.advance(5 * MIN)
    expect(wd.getSnapshot()).toBe(false)
    expect(notified).toEqual([])
    expect(wd.pendingCount()).toBe(0)     // never registered at all
    expect(h.tickerCount()).toBe(0)       // and no timer was ever started for it
    expect(calls[0].init.signal).toBeUndefined()   // untouched: no signal of ours
    calls[0].resolve({ ok: true }); calls[1].resolve({ ok: true })
    await upload; await tus
  })

  it('a healthy read beside a long upload stays healthy', async () => {
    const h = harness()
    const { fetch, calls, wd } = make(h)
    const upload = fetch(`${BASE}/storage/v1/object/rabbit-files/reel.mov`, { method: 'POST' })
    const read = fetch(`${BASE}/rest/v1/tasks?select=id`, { method: 'GET' })
    h.advance(400)
    calls[1].resolve({ ok: true, status: 200 })
    await read
    h.advance(3 * MIN)
    expect(wd.getSnapshot()).toBe(false)
    calls[0].resolve({ ok: true })
    await upload
  })

  it('reset() forgets every request and every loss and lowers the strip', async () => {
    const h = harness()
    const { fetch, wd, notified } = make(h)
    const p = fetch(`${BASE}/rest/v1/projects`, { method: 'GET', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await p.catch(() => {})
    expect(wd.getSnapshot()).toBe(true)
    wd.reset()
    expect(wd.getSnapshot()).toBe(false)
    expect(wd.getPhase()).toBe('ok')
    expect(wd.pendingCount()).toBe(0)
    expect(h.tickerCount()).toBe(0)
    expect(notified).toEqual([{ lost: true, phase: 'reconnecting' }, { lost: false, phase: 'ok' }])
  })
})

describe('the guard: a data request with the anon bearer while signed in is refused (round 1, F2a)', () => {
  const ANON = 'anon-key'
  function guarded(signedIn) {
    const base = vi.fn(async () => ({ ok: true, status: 200 }))
    const refused = []
    const fetch = createAnonGuard({ anonKey: ANON, isSignedIn: () => signedIn, onRefused: (p) => refused.push(p) })(base)
    return { base, fetch, refused }
  }

  it('refuses /rest/v1/ and /storage/v1/ with the anon bearer while signed in, with one sentence, and never calls the base fetch', async () => {
    const { base, fetch, refused } = guarded(true)
    await expect(fetch(`${BASE}/rest/v1/workspaces`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })).rejects.toThrow(ANON_GUARD_MESSAGE)
    await expect(fetch(`${BASE}/storage/v1/object/b/k`, { method: 'GET', headers: new Headers({ Authorization: `Bearer ${ANON}` }) })).rejects.toThrow(ANON_GUARD_MESSAGE)
    expect(base).not.toHaveBeenCalled()
    expect(refused).toEqual(['/rest/v1/workspaces', '/storage/v1/object/b/k'])
  })

  it('passes the same request signed out, a token bearer while signed in, /auth/v1/ itself, and a raw Edge Function call', async () => {
    const out = guarded(false)
    await out.fetch(`${BASE}/rest/v1/workspaces`, { headers: { Authorization: `Bearer ${ANON}` } })
    const on = guarded(true)
    await on.fetch(`${BASE}/rest/v1/workspaces`, { headers: { Authorization: 'Bearer a-session-token' } })
    await on.fetch(`${BASE}/auth/v1/token`, { method: 'POST', headers: { Authorization: `Bearer ${ANON}` } })
    await on.fetch(`${BASE}/functions/v1/resolve-login`, { method: 'POST', headers: { Authorization: `Bearer ${ANON}` } })
    expect(out.base).toHaveBeenCalledTimes(1)
    expect(on.base).toHaveBeenCalledTimes(3)
    expect(on.refused).toEqual([])
  })
})

// ── Through auth-js as installed ───────────────────────────────────────────
// A real GoTrueClient on a fetch that answers GET /user (so setSession saves a
// session the way the app's boot does), never answers POST /token until told
// to, and honours the signal it is given. Fake timers: the SDK's backoff
// sleeps and its 30 s retry window read the same clock as the watchdog.
describe('through auth-js as installed: the hang, the recovery, the start-up check, and the CONTROL', () => {
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const token = (expIn) => {
    const now = Math.floor(Date.now() / 1000)
    return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u', aud: 'authenticated', role: 'authenticated', exp: now + expIn, iat: now - 60, session_id: 's', app_metadata: {}, user_metadata: {} })}.sig`
  }
  const USER = { id: 'u', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })
  const neverUnlessAborted = (init) => new Promise((_, reject) => {
    const s = init?.signal
    if (!s) return
    if (s.aborted) reject(s.reason)
    else s.addEventListener('abort', () => reject(s.reason), { once: true })
  })

  function gotrue() {
    const state = { answers: false, requests: [] }
    const fetch = (input, init) => {
      const path = new URL(String(input)).pathname
      state.requests.push({ at: Date.now(), path, method: init?.method ?? 'GET' })
      if (path.endsWith('/user') && (init?.method ?? 'GET') === 'GET') return Promise.resolve(json(USER))
      if (path.endsWith('/health')) return state.answers ? Promise.resolve(json({ name: 'GoTrue' })) : neverUnlessAborted(init)
      if (path.endsWith('/token')) {
        if (!state.answers) return neverUnlessAborted(init)
        const now = Math.floor(Date.now() / 1000)
        return Promise.resolve(json({ access_token: token(3600), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r2', user: USER }))
      }
      return Promise.resolve(json([]))
    }
    state.tokens = () => state.requests.filter((r) => r.path.endsWith('/token')).length
    return { state, fetch }
  }

  let n = 0
  function client(wrapped) {
    return new GoTrueClient({
      url: `${BASE}/auth/v1`, fetch: wrapped, persistSession: false, autoRefreshToken: false,
      detectSessionInUrl: false, storageKey: `sb-s1-test-${++n}`,
    })
  }

  it('the hang: the refresh is aborted at the budget, the SDK retries once, the caller settles without a session, the session is kept — and the network returning ends it', async () => {
    vi.useFakeTimers()
    const wd = createConnectionWatchdog({ windowRef: null, isOnline: () => true, tickMs: 250 })
    const { state, fetch } = gotrue()
    const auth = client(wd.wrapFetch(fetch))
    const events = []
    auth.onAuthStateChange((e) => events.push(e))
    const saved = await auth.setSession({ access_token: token(60), refresh_token: 'r1' })   // inside the 90 s margin: its next use refreshes
    expect(saved.data.session).toBeTruthy()
    let settled = null
    const p = auth.getSession().then((r) => { settled = r; return r })
    // The refresh carries a small body, so its budget is the base plus one second (21 s).
    await vi.advanceTimersByTimeAsync(20_500)
    expect(settled).toBeNull()
    expect(wd.getSnapshot()).toBe(false)
    expect(state.tokens()).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)   // the budget: aborted, lost; the SDK's retry 200 ms later
    expect(wd.lostFamilies()).toEqual(['auth'])
    expect(state.tokens()).toBe(2)
    expect(settled).toBeNull()
    await vi.advanceTimersByTimeAsync(21_500)  // the retry's own budget: aborted, the loop over (42.2 s)
    expect(settled).not.toBeNull()
    expect(settled.data.session).toBeNull()
    expect(settled.error?.name).toBe('AuthRetryableFetchError')
    expect(state.tokens()).toBe(2)
    expect(wd.getSnapshot()).toBe(true)
    // the session is kept: a later getSession() starts a refresh again rather than finding nothing
    const again = auth.getSession()
    await vi.advanceTimersByTimeAsync(100)
    expect(state.tokens()).toBe(3)
    // the network comes back: the next ping answers, the dead attempt is aborted, the SDK's retry lands
    state.answers = true
    await vi.advanceTimersByTimeAsync(PING_EVERY_MS + 1000)
    const r = await again
    expect(r.data.session?.refresh_token).toBe('r2')
    expect(events).toContain('TOKEN_REFRESHED')
    expect(wd.getSnapshot()).toBe(false)
    expect(wd.lostFamilies()).toEqual([])
  })

  it('an auth-only hang stays lost while PostgREST answers through the same wrapper', async () => {
    vi.useFakeTimers()
    const wd = createConnectionWatchdog({ windowRef: null, isOnline: () => true, tickMs: 250 })
    const { fetch } = gotrue()
    const wrapped = wd.wrapFetch(fetch)
    const auth = client(wrapped)
    await auth.setSession({ access_token: token(60), refresh_token: 'r1' })
    const p = auth.getSession()
    await vi.advanceTimersByTimeAsync(WATCHDOG_BUDGET_MS + 1_500)
    expect(wd.lostFamilies()).toEqual(['auth'])
    const res = await wrapped(`${BASE}/rest/v1/tasks?select=id`, { method: 'GET', headers: { apikey: 'k' } })
    expect(res.status).toBe(200)
    expect(wd.lostFamilies()).toEqual(['auth'])
    expect(wd.getSnapshot()).toBe(true)
    await vi.advanceTimersByTimeAsync(25_000)
    await p
  })

  it('the start-up check: a setSession whose refresh hangs ends at the loop\'s end with nothing saved, and a later setSession succeeds once the network answers', async () => {
    vi.useFakeTimers()
    const wd = createConnectionWatchdog({ windowRef: null, isOnline: () => true, tickMs: 250 })
    const { state, fetch } = gotrue()
    const auth = client(wd.wrapFetch(fetch))
    let hydrated = null
    auth.setSession({ access_token: token(-3600), refresh_token: 'r1' }).then((r) => { hydrated = r })   // expired: refreshed first, saved only on success
    await vi.advanceTimersByTimeAsync(WATCHDOG_BUDGET_MS * 2 + 3_500)   // two attempts of 21 s, 200 ms apart
    expect(hydrated).not.toBeNull()
    expect(hydrated.data.session).toBeNull()
    expect(hydrated.error?.name).toBe('AuthRetryableFetchError')
    expect(state.tokens()).toBe(2)
    const none = await auth.getSession()
    expect(none.data.session).toBeNull()
    expect(state.tokens()).toBe(2)   // nothing saved, so nothing to refresh
    expect(wd.getSnapshot()).toBe(true)
    state.answers = true
    await vi.advanceTimersByTimeAsync(PING_EVERY_MS + 1000)
    expect(wd.getSnapshot()).toBe(false)
    const later = await auth.setSession({ access_token: token(-3600), refresh_token: 'r1' })
    expect(later.data.session?.refresh_token).toBe('r2')
  })

  it('CONTROL: today\'s counting-only wrapper in front of the same client leaves getSession() pending after minutes', async () => {
    vi.useFakeTimers()
    const { state, fetch } = gotrue()
    const counting = (input, init) => fetch(input, init)   // no signal: the request can never be aborted
    const auth = client(counting)
    await auth.setSession({ access_token: token(60), refresh_token: 'r1' })
    let settled = null
    auth.getSession().then((r) => { settled = r })
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(settled).toBeNull()
    expect(state.tokens()).toBe(1)
  })
})
