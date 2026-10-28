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
  const pinged = []
  wd.onPingAnswered((family) => pinged.push(family))
  const { fetch, calls } = controllableFetch()
  return { wd, fetch: wd.wrapFetch(fetch), calls, notified, recovered, pinged }
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

describe('budgetFor — a body adds a second per whole 50 KB, in bytes', () => {
  it('a body-less read and a small write keep the base; a large write gets more; bytes, not characters', () => {
    expect(budgetFor(undefined)).toBe(WATCHDOG_BUDGET_MS)
    expect(budgetFor({ method: 'POST', body: '{}' })).toBe(WATCHDOG_BUDGET_MS)
    expect(budgetFor({ method: 'POST', body: 'x'.repeat(51_199) })).toBe(WATCHDOG_BUDGET_MS)
    expect(budgetFor({ method: 'POST', body: 'x'.repeat(100 * 1024) })).toBe(WATCHDOG_BUDGET_MS + 2000)
    // 51,200 characters of "é" are 102,400 bytes on the wire (round 2, F6)
    expect(budgetFor({ method: 'POST', body: 'é'.repeat(51_200) })).toBe(WATCHDOG_BUDGET_MS + 2000)
    expect(budgetFor({ method: 'POST', body: new Blob(['x'.repeat(1024 * 1024)]) })).toBe(WATCHDOG_BUDGET_MS + 20_000)
    expect(budgetFor({ method: 'POST', body: new ArrayBuffer(51_200) })).toBe(WATCHDOG_BUDGET_MS + 1000)
    // a URLSearchParams's `size` is its pair count, not bytes: no allowance
    expect(budgetFor({ method: 'POST', body: new URLSearchParams({ a: '1', b: '2' }) })).toBe(WATCHDOG_BUDGET_MS)
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
    h.advance(WATCHDOG_BUDGET_MS)   // a small body adds nothing
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

  it("a Request's own signal is honoured too, when no init carries one (round 2, F10)", async () => {
    const h = harness()
    const { fetch, calls } = make(h)
    const outer = new AbortController()
    const req = new Request(`${BASE}/rest/v1/projects`, { method: 'GET', signal: outer.signal })
    const p = fetch(req)
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
    outer.abort()
    expect(calls[0].init.signal.aborted).toBe(true)
    await expect(p).rejects.toBeDefined()
  })

  it('an answer that lands after its own abort clears nothing: the abort is what raised the loss (round 2, F9)', async () => {
    const h = harness()
    const { fetch, calls, wd, notified } = make(h)
    const p = fetch(`${BASE}/rest/v1/projects`, { method: 'GET', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    expect(calls[0].init.signal.aborted).toBe(true)
    // the fetch of the test rejected on the abort; a real one could still resolve in the same tick
    calls[0].resolve({ ok: true, status: 200 })
    await p.catch(() => {})
    await settle()
    expect(wd.getSnapshot()).toBe(true)
    expect(notified).toEqual([{ lost: true, phase: 'reconnecting' }])
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

  it('an answered auth ping aborts the family\'s requests that were pending before it, tells the client module, and clears NOTHING; the real answer that follows clears (round 1 F3, round 2 F2)', async () => {
    const h = harness()
    const { fetch, calls, wd, recovered, pinged } = make(h)
    const first = fetch(`${BASE}/auth/v1/token`, { method: 'POST', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await first.catch(() => {})
    // the SDK's retry, 200 ms later, on a connection that is just as dead
    h.advance(200)
    const retry = fetch(`${BASE}/auth/v1/token`, { method: 'POST', headers: KEY })
    h.advance(PING_EVERY_MS - 200)
    const ping2 = calls[calls.length - 1]
    expect(ping2.input).toBe(`${BASE}/auth/v1/health`)
    // a request sent AFTER the ping is not the ping's business (round 2, F4)
    const later = fetch(`${BASE}/auth/v1/token`, { method: 'POST', headers: KEY })
    const retryRejected = expect(retry).rejects.toMatchObject({ name: 'AbortError' })
    ping2.resolve({ ok: true, status: 200 })
    await settle()
    await retryRejected
    expect(calls[calls.length - 1].init.signal.aborted).toBe(false)
    expect(wd.getSnapshot()).toBe(true)        // the gateway answered; the service has not
    expect(recovered).toEqual([])
    expect(pinged).toEqual(['auth'])           // the client module asks for real
    // …and its real answer is what clears
    calls[calls.length - 1].resolve({ ok: true, status: 200 })
    await later
    expect(wd.getSnapshot()).toBe(false)
    expect(recovered).toEqual(['auth'])
  })

  it('an answered storage ping clears (it repeats the hung request itself); an answered rest ping only tells the client module', async () => {
    const h = harness()
    const { fetch, calls, wd, recovered, pinged } = make(h)
    const dl = fetch(`${BASE}/storage/v1/object/rabbit-files/reel.png`, { method: 'GET', headers: KEY })
    const read = fetch(`${BASE}/rest/v1/tasks`, { method: 'GET', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await Promise.allSettled([dl, read])
    const pings = calls.slice(2)
    expect(pings.map((c) => c.init.method)).toEqual(['HEAD', 'HEAD'])
    const storagePing = pings.find((c) => String(c.input).includes('/storage/v1/'))
    const restPing = pings.find((c) => String(c.input).endsWith('/rest/v1/'))
    storagePing.resolve({ ok: false, status: 404 })   // the object is gone; the service answered
    await settle()
    expect(wd.lostFamilies()).toEqual(['rest'])
    expect(recovered).toEqual(['storage'])
    restPing.resolve({ ok: true, status: 200 })
    await settle()
    expect(wd.lostFamilies()).toEqual(['rest'])
    expect(pinged).toEqual(['rest'])
  })

  it('a second family raised later does not restart the clock (round 2, F4)', async () => {
    const h = harness()
    const { fetch, wd } = make(h)
    const t0 = h.now()
    const read = fetch(`${BASE}/rest/v1/tasks`, { method: 'GET', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await read.catch(() => {})
    h.advance(15_000)
    const refresh = fetch(`${BASE}/auth/v1/token`, { method: 'POST', headers: KEY })
    h.advance(WATCHDOG_BUDGET_MS)
    await refresh.catch(() => {})
    expect(wd.lostFamilies().sort()).toEqual(['auth', 'rest'])
    expect(wd.overdueSince()).toBe(t0 + WATCHDOG_BUDGET_MS)
    h.advance(RELOAD_AFTER_MS - 35_000)
    expect(wd.getPhase()).toBe('reload')
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

  it('reads whether a person is signed in at each request, not once at creation (round 2, F4)', async () => {
    let signedIn = false
    const base = vi.fn(async () => ({ ok: true, status: 200 }))
    const fetch = createAnonGuard({ anonKey: ANON, isSignedIn: () => signedIn })(base)
    const anon = () => fetch(`${BASE}/rest/v1/workspaces`, { headers: { Authorization: `Bearer ${ANON}` } })
    await anon()
    signedIn = true
    await expect(anon()).rejects.toThrow(ANON_GUARD_MESSAGE)
    signedIn = false
    await anon()
    expect(base).toHaveBeenCalledTimes(2)
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
    await vi.advanceTimersByTimeAsync(19_500)
    expect(settled).toBeNull()
    expect(wd.getSnapshot()).toBe(false)
    expect(state.tokens()).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)   // the budget: aborted, lost; the SDK's retry 200 ms later
    expect(wd.lostFamilies()).toEqual(['auth'])
    expect(state.tokens()).toBe(2)
    expect(settled).toBeNull()
    await vi.advanceTimersByTimeAsync(20_500)  // the retry's own budget: aborted, the loop over (~40.5 s)
    expect(settled).not.toBeNull()
    expect(settled.data.session).toBeNull()
    expect(settled.error?.name).toBe('AuthRetryableFetchError')
    expect(state.tokens()).toBe(2)
    expect(wd.getSnapshot()).toBe(true)
    // the session is kept: a later getSession() starts a refresh again rather than finding nothing
    const again = auth.getSession()
    await vi.advanceTimersByTimeAsync(100)
    expect(state.tokens()).toBe(3)
    // the network comes back: the next ping answers, the dead attempt is aborted, the SDK's retry
    // lands, and THAT answer (a real one) clears — the ping's did not
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
    await vi.advanceTimersByTimeAsync(WATCHDOG_BUDGET_MS * 2 + 1_500)   // two attempts of 20 s, 200 ms apart
    expect(hydrated).not.toBeNull()
    expect(hydrated.data.session).toBeNull()
    expect(hydrated.error?.name).toBe('AuthRetryableFetchError')
    expect(state.tokens()).toBe(2)
    const none = await auth.getSession()
    expect(none.data.session).toBeNull()
    expect(state.tokens()).toBe(2)   // nothing saved, so nothing to refresh
    expect(wd.getSnapshot()).toBe(true)
    // the network comes back: the health ping answers, which proves the gateway and clears nothing;
    // the next REAL auth answer — the restore path's setSession, here — is what clears
    state.answers = true
    await vi.advanceTimersByTimeAsync(PING_EVERY_MS + 1000)
    expect(wd.getSnapshot()).toBe(true)
    const later = await auth.setSession({ access_token: token(-3600), refresh_token: 'r1' })
    expect(later.data.session?.refresh_token).toBe('r2')
    expect(wd.getSnapshot()).toBe(false)
  })

  it('CONTROL: a wrapper that passes no signal (what the watchdog did before S1) in front of the same client leaves getSession() pending after minutes', async () => {
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

// =============================================================================
// S2 (night 3, 2026-10-27; docs/design/RECONNECT_DESIGN.md §11): the offline
// launch's network half — the launch probe, the decision, the launch-raised
// loss (the strip from the first paint, "reconnecting" until it answers, pinged
// whether or not the browser says online), its lowering, the quiet pings
// during a re-hydration, and the re-hydration itself; then the whole through
// auth-js as installed with a GET /user that stalls (S1's stand-in above
// always answers it).
// =============================================================================
import {
  classifyAuthFailure, restoreSavedSession, rehydrateSession,
  LAUNCH_BUDGET_MS, LAUNCH_CEILING_MS, HELD_GUARD_MESSAGE,
} from './connectionWatchdog'

/** A one-shot timer set the test fires by hand (restoreSavedSession's `timers`, launchProbe's setTimer). */
function manualTimers() {
  const pending = new Map()
  let id = 0
  return {
    setTimeout: (fn, ms) => { const h = ++id; pending.set(h, { fn, ms }); return h },
    clearTimeout: (h) => { pending.delete(h) },
    fireAll() { const all = [...pending.values()]; pending.clear(); for (const p of all) p.fn() },
    count: () => pending.size,
  }
}

const authError = (name, status, code) => Object.assign(new Error(name), { name, status, code })

describe('S2 — which failures open the shell offline (classifyAuthFailure, §11.2)', () => {
  it('reached nothing: a rejected or aborted fetch, an answer that is not GoTrue\'s, any 5xx', () => {
    expect(classifyAuthFailure(authError('AuthRetryableFetchError', 0))).toBe('unreached')
    expect(classifyAuthFailure(authError('AuthRetryableFetchError', 503))).toBe('unreached')
    expect(classifyAuthFailure(authError('AuthUnknownError', undefined))).toBe('unreached')
    expect(classifyAuthFailure(authError('AuthApiError', 500))).toBe('unreached')
  })
  it('a refusal that ends the session: 400, 401, 403, session_not_found, a token that cannot be decoded', () => {
    expect(classifyAuthFailure(authError('AuthApiError', 400, 'refresh_token_not_found'))).toBe('refused-ends')
    expect(classifyAuthFailure(authError('AuthApiError', 401))).toBe('refused-ends')
    expect(classifyAuthFailure(authError('AuthApiError', 403, 'bad_jwt'))).toBe('refused-ends')
    expect(classifyAuthFailure(authError('AuthSessionMissingError', 400))).toBe('refused-ends')
    expect(classifyAuthFailure(authError('AuthInvalidJwtError', 400))).toBe('refused-ends')
  })
  it('any other answer keeps the store: a 404, a 429, an unexpected error', () => {
    expect(classifyAuthFailure(authError('AuthApiError', 404))).toBe('refused-keeps')
    expect(classifyAuthFailure(authError('AuthApiError', 429, 'over_request_rate_limit'))).toBe('refused-keeps')
    expect(classifyAuthFailure(new TypeError('boom'))).toBe('refused-keeps')
  })
})

describe('S2 — restoreSavedSession, the launch\'s decision inside the cap (§11.4)', () => {
  const saved = { access_token: 'a', refresh_token: 'r' }
  const authWith = (setSession) => ({ setSession: vi.fn(setSession) })

  it('the probe not answered: held, and the SDK is never asked (no real request, no queue)', async () => {
    const auth = authWith(async () => ({ data: { session: { access_token: 'x' } }, error: null }))
    const r = await restoreSavedSession({ auth, saved, probe: async () => false, timers: manualTimers() })
    expect(r).toMatchObject({ outcome: 'held', reason: 'probe' })
    expect(auth.setSession).not.toHaveBeenCalled()
  })
  it('a probe that throws is not answered either', async () => {
    const auth = authWith(async () => ({ data: { session: {} }, error: null }))
    const r = await restoreSavedSession({ auth, saved, probe: async () => { throw new Error('x') }, timers: manualTimers() })
    expect(r.outcome).toBe('held')
    expect(auth.setSession).not.toHaveBeenCalled()
  })
  it('answered, and the SDK restores: online, with the SDK\'s session', async () => {
    const session = { access_token: 'x', refresh_token: 'y' }
    const auth = authWith(async () => ({ data: { session }, error: null }))
    const r = await restoreSavedSession({ auth, saved, probe: async () => true, timers: manualTimers() })
    expect(r).toEqual({ outcome: 'online', session })
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' })
  })
  it('answered, then the SDK reaches nothing: held', async () => {
    const auth = authWith(async () => ({ data: { session: null }, error: authError('AuthRetryableFetchError', 0) }))
    expect((await restoreSavedSession({ auth, saved, probe: async () => true, timers: manualTimers() })).outcome).toBe('held')
  })
  it('answered, then refused for good: refused (the caller clears the store)', async () => {
    const auth = authWith(async () => ({ data: { session: null }, error: authError('AuthApiError', 403, 'bad_jwt') }))
    expect((await restoreSavedSession({ auth, saved, probe: async () => true, timers: manualTimers() })).outcome).toBe('refused')
  })
  it('answered, then a 429: none — the sign-in screen as today, the store kept', async () => {
    const auth = authWith(async () => ({ data: { session: null }, error: authError('AuthApiError', 429) }))
    expect((await restoreSavedSession({ auth, saved, probe: async () => true, timers: manualTimers() })).outcome).toBe('none')
  })
  it('the ceiling while the SDK is still out: held, with the SDK\'s restore handed back as `late`', async () => {
    const timers = manualTimers()
    let finish
    const auth = authWith(() => new Promise((res) => { finish = res }))
    const p = restoreSavedSession({ auth, saved, probe: async () => true, timers })
    await settle()
    expect(timers.count()).toBe(1)
    timers.fireAll()
    const r = await p
    expect(r).toMatchObject({ outcome: 'held', reason: 'ceiling' })
    finish({ data: { session: { access_token: 'late' } }, error: null })
    expect((await r.late).data.session.access_token).toBe('late')
  })
  it('the ceiling while the probe is still out: held, the SDK never asked', async () => {
    const timers = manualTimers()
    const auth = authWith(async () => ({ data: { session: {} }, error: null }))
    const p = restoreSavedSession({ auth, saved, probe: () => new Promise(() => {}), timers })
    await settle()
    timers.fireAll()
    expect((await p).outcome).toBe('held')
    expect(auth.setSession).not.toHaveBeenCalled()
  })
  it('the numbers: a 5 s probe inside a 10 s decision', () => {
    expect(LAUNCH_BUDGET_MS).toBe(5_000)
    expect(LAUNCH_CEILING_MS).toBe(10_000)
    expect(PING_BUDGET_MS).toBe(LAUNCH_BUDGET_MS)
  })
})

describe('S2 — rehydrateSession, the held session given back to the SDK (§11.5)', () => {
  const held = { access_token: 'a', refresh_token: 'r' }
  it('online, refused, or unreached (a 404 and a 429 keep holding)', async () => {
    const run = (r) => rehydrateSession({ auth: { setSession: async () => r }, held })
    expect((await run({ data: { session: { access_token: 'x' } }, error: null })).outcome).toBe('online')
    expect((await run({ data: { session: null }, error: authError('AuthApiError', 401) })).outcome).toBe('refused')
    expect((await run({ data: { session: null }, error: authError('AuthRetryableFetchError', 0) })).outcome).toBe('unreached')
    expect((await run({ data: { session: null }, error: authError('AuthApiError', 429) })).outcome).toBe('unreached')
    const thrown = await rehydrateSession({ auth: { setSession: async () => { throw new Error('x') } }, held })
    expect(thrown.outcome).toBe('unreached')
  })
})

describe('S2 — the watchdog\'s launch path (§11.6)', () => {
  const health = `${BASE}/auth/v1/health`

  it('launchProbe: GoTrue\'s JSON 200 is an answer; a page, a 503 or a stall at the launch budget is not — and it raises nothing', async () => {
    const h = harness()
    const timers = manualTimers()
    const m = make(h, { setTimer: timers.setTimeout, clearTimer: timers.clearTimeout })
    const ask = () => m.wd.launchProbe({ origin: BASE, apikey: KEY.apikey })
    let p = ask()
    expect(m.calls.at(-1).input).toBe(health)
    expect(m.calls.at(-1).init.headers).toEqual({ apikey: KEY.apikey })
    m.calls.at(-1).resolve({ status: 200, json: async () => ({ name: 'GoTrue' }) })
    expect(await p).toBe(true)
    p = ask(); m.calls.at(-1).resolve({ status: 200, json: async () => { throw new SyntaxError('<html>') } })
    expect(await p).toBe(false)
    p = ask(); m.calls.at(-1).resolve({ status: 503, json: async () => ({}) })
    expect(await p).toBe(false)
    p = ask(); await settle(); timers.fireAll()   // the launch budget
    expect(await p).toBe(false)
    expect(m.wd.getSnapshot()).toBe(false)
    expect(m.notified).toEqual([])
    expect(m.wd.pendingCount()).toBe(0)
  })

  it('build review round 1, note: a ping hung while the browser says offline is cut at its budget, so the next one can go', async () => {
    const h = harness({ online: false })
    const m = make(h)
    m.wd.launchedOffline({ origin: BASE, apikey: KEY.apikey })
    h.advance(1_000)
    expect(m.wd.pingsInFlight()).toBe(1)
    h.advance(PING_BUDGET_MS)
    await settle()
    expect(m.wd.pingsInFlight()).toBe(0)
    h.advance(PING_EVERY_MS)
    expect(m.calls.filter((c) => c.input === `${BASE}/auth/v1/health`)).toHaveLength(2)
  })

  it('launchedOffline: the strip at once, with the browser OFFLINE, and the ping sent anyway', async () => {
    const h = harness({ online: false })
    const m = make(h)
    m.wd.launchedOffline({ origin: BASE, apikey: KEY.apikey })
    expect(m.wd.getPhase()).toBe('reconnecting')
    expect(m.notified.at(-1)).toEqual({ lost: true, phase: 'reconnecting' })
    h.advance(1_000)
    const pings = m.calls.filter((c) => c.input === health)
    expect(pings).toHaveLength(1)
    expect(pings[0].init.headers).toEqual({ apikey: KEY.apikey })
  })

  it('CONTROL: S1\'s own loss is never pinged while the browser says offline', async () => {
    const h = harness()
    const m = make(h)
    m.fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: KEY, body: '{}' }).catch(() => {})
    h.advance(WATCHDOG_BUDGET_MS)   // aborted, lost
    expect(m.wd.lostFamilies()).toEqual(['auth'])
    const before = m.calls.length            // the request and its first ping, sent at the raise
    expect(m.calls.filter((c) => c.input === `${BASE}/auth/v1/health`)).toHaveLength(1)
    h.online = false
    h.advance(PING_EVERY_MS * 3)
    expect(m.calls.length).toBe(before)      // offline: no ping for a loss the launch did not raise
  })

  it('"reconnecting" throughout on a launch that was never online — never "reload", however long', () => {
    const h = harness()
    const m = make(h)
    m.wd.launchedOffline({ origin: BASE, apikey: KEY.apikey })
    h.advance(RELOAD_AFTER_MS * 3)
    expect(m.wd.getPhase()).toBe('reconnecting')
    expect(m.notified.some((n) => n.phase === 'reload')).toBe(false)
  })

  it('a real auth answer clears it, and afterwards S1\'s words apply again (reload after a minute lost)', async () => {
    const h = harness()
    const m = make(h)
    m.wd.launchedOffline({ origin: BASE, apikey: KEY.apikey })
    m.fetch(`${BASE}/auth/v1/user`, { method: 'GET', headers: KEY }).catch(() => {})
    m.calls.at(-1).resolve({ status: 200 })
    await settle()
    expect(m.wd.getPhase()).toBe('ok')
    expect(m.recovered).toEqual(['auth'])
    m.fetch(`${BASE}/auth/v1/user`, { method: 'GET', headers: KEY }).catch(() => {})
    h.advance(WATCHDOG_BUDGET_MS + RELOAD_AFTER_MS)
    expect(m.wd.getPhase()).toBe('reload')
  })

  it('launchEnded lowers the launch\'s loss (nothing left to ask) and tells no listener', () => {
    const h = harness()
    const m = make(h)
    m.wd.launchedOffline({ origin: BASE, apikey: KEY.apikey })
    m.wd.launchEnded()
    expect(m.wd.getPhase()).toBe('ok')
    expect(m.recovered).toEqual([])
    expect(m.wd.launchRaised()).toBe(false)
  })

  it('…unless a real auth request is out, which decides as S1 built it', () => {
    const h = harness()
    const m = make(h)
    m.wd.launchedOffline({ origin: BASE, apikey: KEY.apikey })
    m.fetch(`${BASE}/auth/v1/user`, { method: 'GET', headers: KEY }).catch(() => {})
    m.wd.launchEnded()
    expect(m.wd.getSnapshot()).toBe(true)
  })

  it('CONTROL: launchEnded with no launch-raised loss leaves S1\'s loss alone', () => {
    const h = harness()
    const m = make(h)
    m.fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: KEY, body: '{}' }).catch(() => {})
    h.advance(WATCHDOG_BUDGET_MS)
    m.wd.launchEnded()
    expect(m.wd.lostFamilies()).toEqual(['auth'])
  })

  it('quietWhile: no auth ping while the re-hydration is out; pinging resumes when it settles', async () => {
    const h = harness()
    const m = make(h)
    m.wd.launchedOffline({ origin: BASE, apikey: KEY.apikey })
    let done
    m.wd.quietWhile('auth', new Promise((r) => { done = r }))
    h.advance(PING_EVERY_MS * 3)
    expect(m.calls.filter((c) => c.input === health)).toHaveLength(0)
    done()
    await settle()
    h.advance(1_000)
    expect(m.calls.filter((c) => c.input === health)).toHaveLength(1)
  })

  it('build review round 2, F3: while the launch\'s loss is up, the held work\'s own stalled request is cut at S1\'s budget with the browser OFFLINE — and the pings resume', async () => {
    const h = harness({ online: false })
    const m = make(h)
    m.wd.launchedOffline({ origin: BASE, apikey: KEY.apikey })
    const started = h.now()
    let settledAt = null
    const out = m.fetch(`${BASE}/auth/v1/user`, { method: 'GET', headers: KEY }).then(() => {}, () => { settledAt = h.now() })
    m.wd.quietWhile('auth', out)                             // the late restore (or a re-hydration) is out: no ping meanwhile
    h.advance(WATCHDOG_BUDGET_MS - 1_000)
    await settle()
    expect(settledAt).toBeNull()
    h.advance(1_000)
    await settle()
    expect(settledAt).toBe(started + WATCHDOG_BUDGET_MS)     // cut at the budget, whatever the browser says
    expect(m.wd.getPhase()).toBe('reconnecting')             // a cut is not an answer: still lost, still "reconnecting"
    expect(m.calls.filter((c) => c.input === health)).toHaveLength(0)
    await settle()                                           // the quiet window ends with the request
    h.advance(PING_EVERY_MS)
    expect(m.calls.filter((c) => c.input === health).length).toBeGreaterThan(0)
  })

  it('CONTROL for F3: with no launch-raised loss, a real request is still never cut while the browser says offline (S1\'s rule)', async () => {
    const h = harness({ online: false })
    const m = make(h)
    let settled = false
    m.fetch(`${BASE}/auth/v1/user`, { method: 'GET', headers: KEY }).then(() => { settled = true }, () => { settled = true })
    h.advance(WATCHDOG_BUDGET_MS * 3)
    await settle()
    expect(settled).toBe(false)
    expect(m.wd.pendingCount()).toBe(1)
  })

  it('the guard says why while a session is held: its message seam', async () => {
    const base = vi.fn(async () => ({ ok: true, status: 200 }))
    let held = true
    const guarded = createAnonGuard({ anonKey: 'anon', isSignedIn: () => true, message: () => (held ? HELD_GUARD_MESSAGE : null) })(base)
    const anon = { headers: { Authorization: 'Bearer anon' } }
    await expect(guarded(`${BASE}/rest/v1/projects`, anon)).rejects.toThrow(HELD_GUARD_MESSAGE)
    held = false
    await expect(guarded(`${BASE}/rest/v1/projects`, anon)).rejects.toThrow(ANON_GUARD_MESSAGE)
    expect(base).not.toHaveBeenCalled()
  })
})

describe('S2 — the offline launch through auth-js as installed: a GET /user that stalls', () => {
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
  /** GoTrue whose health answers when `health`, and whose GET /user answers only when `user`. */
  function gotrue() {
    const state = { health: true, user: false, requests: [] }
    const fetch = (input, init) => {
      const path = new URL(String(input)).pathname
      state.requests.push({ path, method: init?.method ?? 'GET' })
      if (path.endsWith('/health')) return state.health ? Promise.resolve(json({ name: 'GoTrue' })) : neverUnlessAborted(init)
      if (path.endsWith('/user')) return state.user ? Promise.resolve(json(USER)) : neverUnlessAborted(init)
      return neverUnlessAborted(init)
    }
    state.count = (suffix) => state.requests.filter((r) => r.path.endsWith(suffix)).length
    return { state, fetch }
  }
  let n = 0
  const client = (wrapped) => new GoTrueClient({
    url: `${BASE}/auth/v1`, fetch: wrapped, persistSession: false, autoRefreshToken: false,
    detectSessionInUrl: false, storageKey: `sb-s2-test-${++n}`,
  })

  it('the probe answers, GET /user stalls: held at the 10 s ceiling; the watchdog aborts GET /user at 20 s and the late restore ends retryable, nothing saved', async () => {
    vi.useFakeTimers()
    const wd = createConnectionWatchdog({ windowRef: null, isOnline: () => true, tickMs: 250 })
    const { state, fetch } = gotrue()
    const auth = client(wd.wrapFetch(fetch))
    const saved = { access_token: token(3000), refresh_token: 'r1' }
    let decided = null
    restoreSavedSession({ auth, saved, probe: () => wd.launchProbe({ origin: BASE, apikey: 'k' }) }).then((r) => { decided = r })
    await vi.advanceTimersByTimeAsync(9_900)
    expect(decided).toBeNull()
    await vi.advanceTimersByTimeAsync(200)
    expect(decided).toMatchObject({ outcome: 'held', reason: 'ceiling' })
    let late = null
    decided.late.then((r) => { late = r })
    await vi.advanceTimersByTimeAsync(WATCHDOG_BUDGET_MS - LAUNCH_CEILING_MS + 1_000)
    expect(late?.error?.name).toBe('AuthRetryableFetchError')
    expect(late.data.session).toBeNull()
    expect(wd.lostFamilies()).toEqual(['auth'])
    expect((await auth.getSession()).data.session).toBeNull()
    expect(state.count('/user')).toBe(1)
  })

  it('the probe not answered (a stall): held at the 5 s launch budget, and GET /user is never sent', async () => {
    vi.useFakeTimers()
    const wd = createConnectionWatchdog({ windowRef: null, isOnline: () => true, tickMs: 250 })
    const { state, fetch } = gotrue()
    state.health = false
    const auth = client(wd.wrapFetch(fetch))
    let decided = null
    restoreSavedSession({ auth, saved: { access_token: token(3000), refresh_token: 'r1' }, probe: () => wd.launchProbe({ origin: BASE, apikey: 'k' }) }).then((r) => { decided = r })
    await vi.advanceTimersByTimeAsync(LAUNCH_BUDGET_MS - 100)
    expect(decided).toBeNull()
    await vi.advanceTimersByTimeAsync(200)
    expect(decided).toMatchObject({ outcome: 'held', reason: 'probe' })
    expect(state.count('/user')).toBe(0)
    expect(wd.getSnapshot()).toBe(false)   // the probe raises nothing; the hold's launchedOffline does
  })

  it('the re-hydration: the hold raises the loss, the network returns, the ping answers, setSession(held) signs in and its answer clears the strip', async () => {
    vi.useFakeTimers()
    const wd = createConnectionWatchdog({ windowRef: null, isOnline: () => true, tickMs: 250 })
    const { state, fetch } = gotrue()
    state.health = false
    const auth = client(wd.wrapFetch(fetch))
    const events = []
    auth.onAuthStateChange((e) => events.push(e))
    const held = { access_token: token(3000), refresh_token: 'r1' }
    wd.launchedOffline({ origin: BASE, apikey: 'k' })
    // as supabaseClient.js does: the re-hydration is the question (quiet), and its caller decides
    wd.onPingAnswered((family) => {
      if (family !== 'auth') return
      wd.quietWhile('auth', rehydrateSession({ auth, held }).then((r) => { if (r.outcome === 'online') wd.launchEnded() }))
    })
    expect(wd.getPhase()).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(PING_EVERY_MS * 2)
    expect(wd.getPhase()).toBe('reconnecting')
    state.health = true
    state.user = true
    await vi.advanceTimersByTimeAsync(PING_EVERY_MS + 500)
    expect(events).toContain('SIGNED_IN')
    expect(wd.getPhase()).toBe('ok')
    expect((await auth.getSession()).data.session?.access_token).toBe(held.access_token)
  })

  it('build review round 1, F2: an answer that holds no session (a 429) keeps the session held and the strip up, and the next answered ping asks again', async () => {
    vi.useFakeTimers()
    const wd = createConnectionWatchdog({ windowRef: null, isOnline: () => true, tickMs: 250 })
    const { state, fetch } = gotrue()
    const rateLimited = (input, init) => {
      const path = new URL(String(input)).pathname
      if (state.limit && path.endsWith('/user')) { state.requests.push({ path, method: 'GET' }); return Promise.resolve(json({ code: 429, error_code: 'over_request_rate_limit', msg: 'slow down' }, 429)) }
      return fetch(input, init)
    }
    state.limit = true
    const auth = client(wd.wrapFetch(rateLimited))
    const held = { access_token: token(3000), refresh_token: 'r1' }
    let confirmed = false
    wd.launchedOffline({ origin: BASE, apikey: 'k' })
    wd.onPingAnswered((family) => {
      if (family !== 'auth') return
      wd.quietWhile('auth', rehydrateSession({ auth, held }).then((r) => { if (r.outcome === 'online') { confirmed = true; wd.launchEnded() } }))
    })
    await vi.advanceTimersByTimeAsync(1_000)                 // the first ping answers; GET /user: 429
    expect(state.count('/user')).toBe(1)
    expect(wd.getPhase()).toBe('reconnecting')                // the 429 is an answer, and it cleared nothing
    expect(confirmed).toBe(false)
    state.limit = false
    state.user = true
    await vi.advanceTimersByTimeAsync(PING_EVERY_MS + 500)   // the next answered ping asks again
    expect(state.count('/user')).toBe(2)
    expect(confirmed).toBe(true)
    expect(wd.getPhase()).toBe('ok')
  })

  it('CONTROL for F2: without quietWhile the same 429 clears the strip while the session is still held', async () => {
    vi.useFakeTimers()
    const wd = createConnectionWatchdog({ windowRef: null, isOnline: () => true, tickMs: 250 })
    const { state, fetch } = gotrue()
    const rateLimited = (input, init) => (new URL(String(input)).pathname.endsWith('/user')
      ? Promise.resolve(json({ code: 429, msg: 'slow down' }, 429))
      : fetch(input, init))
    const auth = client(wd.wrapFetch(rateLimited))
    wd.launchedOffline({ origin: BASE, apikey: 'k' })
    wd.onPingAnswered((family) => { if (family === 'auth') rehydrateSession({ auth, held: { access_token: token(3000), refresh_token: 'r1' } }) })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(state.count('/health')).toBeGreaterThanOrEqual(1)
    expect(wd.getPhase()).toBe('ok')                          // the strip gone, nothing confirmed: the stuck hold F2 found
  })

  it('CONTROL: the same stalled GET /user through a wrapper that cannot abort (no watchdog) leaves the late restore pending after minutes', async () => {
    vi.useFakeTimers()
    const { fetch } = gotrue()
    const auth = client((input, init) => fetch(input, { ...init, signal: undefined }))
    let decided = null
    restoreSavedSession({ auth, saved: { access_token: token(3000), refresh_token: 'r1' }, probe: async () => true }).then((r) => { decided = r })
    await vi.advanceTimersByTimeAsync(LAUNCH_CEILING_MS + 100)
    expect(decided.outcome).toBe('held')
    let late = null
    decided.late.then((r) => { late = r })
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(late).toBeNull()
  })
})
