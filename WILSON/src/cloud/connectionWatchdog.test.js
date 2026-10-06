// =============================================================================
// connectionWatchdog.test.js — Track B bundle B2, part 2.
//
// The test the brief demands is the no-false-positive one: a fake slow upload
// running for minutes under the watchdog must never raise the banner. The
// rest pins the positive case (a PostgREST call and an auth refresh that hang
// while the browser says it is online), the offline exemption, and the
// structural exclusions.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createConnectionWatchdog, shouldWatch, WATCHDOG_BUDGET_MS } from './connectionWatchdog'

const BASE = 'https://eqjzmnvkrakroyqxfsvw.supabase.co'
const MIN = 60_000

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

/** A fetch whose every call is a promise the test settles by hand. */
function controllableFetch() {
  const calls = []
  const fetch = (input, init) => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    calls.push({ input, init, resolve, reject })
    return promise
  }
  return { fetch, calls }
}

function make(h) {
  const wd = createConnectionWatchdog({
    budgetMs: WATCHDOG_BUDGET_MS, tickMs: 1000,
    now: h.now, isOnline: h.isOnline, schedule: h.schedule, unschedule: h.unschedule,
    windowRef: null,
  })
  const notified = []
  wd.subscribe((lost) => notified.push(lost))
  const { fetch, calls } = controllableFetch()
  return { wd, fetch: wd.wrapFetch(fetch), calls, notified }
}

describe('shouldWatch — the scope', () => {
  it('watches auth, PostgREST and storage downloads', () => {
    expect(shouldWatch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' })).toBe(true)
    expect(shouldWatch(`${BASE}/rest/v1/workspaces?select=id`, { method: 'GET' })).toBe(true)
    expect(shouldWatch(`${BASE}/rest/v1/auth_events`, { method: 'POST' })).toBe(true)
    expect(shouldWatch(`${BASE}/storage/v1/object/rabbit-files/x.png`, { method: 'GET' })).toBe(true)
    expect(shouldWatch(`${BASE}/storage/v1/object/rabbit-files/x.png`, { method: 'HEAD' })).toBe(true)
  })

  it('never watches uploads, the resumable path, Edge Functions or anything else', () => {
    expect(shouldWatch(`${BASE}/storage/v1/object/rabbit-files/big.mov`, { method: 'POST' })).toBe(false)
    expect(shouldWatch(`${BASE}/storage/v1/object/rabbit-files/big.mov`, { method: 'PUT' })).toBe(false)
    expect(shouldWatch(`${BASE}/storage/v1/upload/resumable`, { method: 'POST' })).toBe(false)
    expect(shouldWatch(`${BASE}/storage/v1/upload/resumable/abc`, { method: 'PATCH' })).toBe(false)
    expect(shouldWatch(`${BASE}/functions/v1/ai-proxy`, { method: 'POST' })).toBe(false)
    expect(shouldWatch(`${BASE}/functions/v1/workspace-takeout`, { method: 'POST' })).toBe(false)
    expect(shouldWatch(`${BASE}/realtime/v1/websocket`, {})).toBe(false)
    expect(shouldWatch('https://api.anthropic.com/v1/messages', { method: 'POST' })).toBe(false)
  })

  it('reads the method from a Request-like object and accepts URL objects', () => {
    expect(shouldWatch({ url: `${BASE}/storage/v1/object/b/k`, method: 'POST' })).toBe(false)
    expect(shouldWatch({ url: `${BASE}/storage/v1/object/b/k`, method: 'GET' })).toBe(true)
    expect(shouldWatch({ href: `${BASE}/rest/v1/projects` })).toBe(true)
  })
})

describe('the watchdog', () => {
  it('a PostgREST call pending past the budget while online raises the banner; settling late clears it', async () => {
    const h = harness()
    const { fetch, calls, wd, notified } = make(h)
    const p = fetch(`${BASE}/rest/v1/projects?select=id`, { method: 'GET' })
    h.advance(WATCHDOG_BUDGET_MS - 1000)
    expect(wd.getSnapshot()).toBe(false)
    h.advance(1000)
    expect(wd.getSnapshot()).toBe(true)
    expect(notified).toEqual([true])
    // it was slow, not dead
    calls[0].resolve({ ok: true, status: 200 })
    await p
    expect(wd.getSnapshot()).toBe(false)
    expect(notified).toEqual([true, false])
    expect(wd.pendingCount()).toBe(0)
    expect(h.tickerCount()).toBe(0)
  })

  it('an auth refresh that never settles raises the banner — the hang class from S21', () => {
    const h = harness()
    const { fetch, wd } = make(h)
    fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' })
    h.advance(WATCHDOG_BUDGET_MS)
    expect(wd.getSnapshot()).toBe(true)
    h.advance(10 * MIN)
    expect(wd.getSnapshot()).toBe(true)   // and it stays up: nothing settled
  })

  it('NO FALSE POSITIVE: a slow upload running for minutes never raises the banner', async () => {
    const h = harness()
    const { fetch, calls, wd, notified } = make(h)
    const upload = fetch(`${BASE}/storage/v1/object/rabbit-files/dailies/reel.mov`, { method: 'POST', body: 'x'.repeat(10) })
    const tus = fetch(`${BASE}/storage/v1/upload/resumable/abc`, { method: 'PATCH' })
    h.advance(5 * MIN)
    expect(wd.getSnapshot()).toBe(false)
    expect(notified).toEqual([])
    expect(wd.pendingCount()).toBe(0)     // never registered at all
    expect(h.tickerCount()).toBe(0)       // and no timer was ever started for it
    calls[0].resolve({ ok: true }); calls[1].resolve({ ok: true })
    await upload; await tus
  })

  it('a healthy read beside a long upload stays healthy', async () => {
    const h = harness()
    const { fetch, calls, wd } = make(h)
    const upload = fetch(`${BASE}/storage/v1/object/rabbit-files/reel.mov`, { method: 'POST' })
    const read = fetch(`${BASE}/rest/v1/tasks?select=id`, { method: 'GET' })
    h.advance(400)
    calls[1].resolve({ ok: true })
    await read
    h.advance(3 * MIN)
    expect(wd.getSnapshot()).toBe(false)
    calls[0].resolve({ ok: true })
    await upload
  })

  it('does not fire while the browser says it is offline, and fires once it says online again', () => {
    const h = harness({ online: false })
    const { fetch, wd } = make(h)
    fetch(`${BASE}/rest/v1/projects`, { method: 'GET' })
    h.advance(WATCHDOG_BUDGET_MS + 5000)
    expect(wd.getSnapshot()).toBe(false)
    h.online = true
    h.advance(1000)
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

  it('passes input and init through untouched and returns the underlying response', async () => {
    const h = harness()
    const { fetch, calls } = make(h)
    const init = { method: 'POST', headers: { apikey: 'k' }, body: '{}' }
    const p = fetch(`${BASE}/rest/v1/auth_events`, init)
    expect(calls[0].input).toBe(`${BASE}/rest/v1/auth_events`)
    expect(calls[0].init).toBe(init)
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

  it('reset() forgets every request and lowers the banner', () => {
    const h = harness()
    const { fetch, wd, notified } = make(h)
    fetch(`${BASE}/rest/v1/projects`, { method: 'GET' })
    h.advance(WATCHDOG_BUDGET_MS)
    expect(wd.getSnapshot()).toBe(true)
    wd.reset()
    expect(wd.getSnapshot()).toBe(false)
    expect(wd.pendingCount()).toBe(0)
    expect(h.tickerCount()).toBe(0)
    expect(notified).toEqual([true, false])
  })
})
