// =============================================================================
// sessionTimeouts.test.js — Track B bundle B2, part 2.
//
// Drives the core under a fake clock: the warning at 25 minutes, the sign-out
// at 30, the 4-hour cap that ignores activity, the reload that keeps the cap
// clock, the return-to-visibility rule, and — the trap the brief names — that
// the two surfaces never share state while two tabs of ONE surface do.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import {
  createSessionTimeouts, readJwtClaims, sessionIdOf,
  IDLE_WARN_MS, IDLE_SIGN_OUT_MS, SESSION_CAP_MS, CAP_WARN_MS, TICK_MS,
} from './sessionTimeouts'

const MIN = 60 * 1000
const HOUR = 60 * MIN

function memoryStorage() {
  const map = new Map()
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
  }
}

/**
 * A clock plus a ticker the test steps by hand. `advance(ms)` moves time and
 * fires every scheduled ticker as often as a real interval would.
 */
function harness() {
  let t = 1_000_000
  const tickers = new Set()
  return {
    now: () => t,
    schedule: (fn, ms) => { const h = { fn, ms, next: t + ms }; tickers.add(h); return h },
    unschedule: (h) => { tickers.delete(h) },
    advance(ms) {
      const end = t + ms
      // fire tickers in time order until `end`
      for (;;) {
        let soonest = null
        for (const h of tickers) if (h.next <= end && (!soonest || h.next < soonest.next)) soonest = h
        if (!soonest) break
        t = soonest.next
        soonest.next += soonest.ms
        soonest.fn()
      }
      t = end
    },
    tickerCount: () => tickers.size,
  }
}

function make(h, storage, extra = {}) {
  const events = []
  const ctl = createSessionTimeouts({
    surfaceKey: 'wilson.dev.session',
    sessionId: 'sess-1',
    storage,
    now: h.now,
    schedule: h.schedule,
    unschedule: h.unschedule,
    onChange: (s) => events.push(['change', s.phase, s.reason]),
    onExpire: (r) => events.push(['expire', r]),
    ...extra,
  })
  return { ctl, events }
}

describe('idle timeout', () => {
  it('warns at 25 minutes, signs out at 30, and says why', () => {
    const h = harness(); const st = memoryStorage()
    const { ctl, events } = make(h, st)
    ctl.start()
    expect(ctl.getState().phase).toBe('active')

    h.advance(IDLE_WARN_MS - TICK_MS)
    expect(ctl.getState().phase).toBe('active')
    h.advance(TICK_MS)
    expect(ctl.getState().phase).toBe('idle-warning')
    expect(ctl.getState().deadline).toBe(1_000_000 + IDLE_SIGN_OUT_MS)

    h.advance(IDLE_SIGN_OUT_MS - IDLE_WARN_MS)
    expect(ctl.getState().phase).toBe('expired')
    expect(ctl.getState().reason).toBe('idle_timeout')
    expect(events.filter(e => e[0] === 'expire')).toEqual([['expire', 'idle_timeout']])
    // the clocks are cleared for the next sign-in
    expect(st.map.has('wilson.dev.session.activity')).toBe(false)
    expect(st.map.has('wilson.dev.session.start')).toBe(false)
    expect(h.tickerCount()).toBe(0)
  })

  it('activity resets the idle clock', () => {
    const h = harness(); const st = memoryStorage()
    const { ctl } = make(h, st)
    ctl.start()
    h.advance(24 * MIN)
    ctl.activity()
    h.advance(24 * MIN)
    expect(ctl.getState().phase).toBe('active')
    h.advance(2 * MIN)
    expect(ctl.getState().phase).toBe('idle-warning')
    h.advance(5 * MIN)
    expect(ctl.getState().phase).toBe('expired')
  })

  it('a warning clears on the very next activity, not on the next tick', () => {
    const h = harness(); const st = memoryStorage()
    const { ctl } = make(h, st)
    ctl.start()
    h.advance(26 * MIN)
    expect(ctl.getState().phase).toBe('idle-warning')
    ctl.activity()
    expect(ctl.getState().phase).toBe('active')
  })

  it('expires at most once, and a stopped controller never expires', () => {
    const h = harness(); const st = memoryStorage()
    const { ctl, events } = make(h, st)
    ctl.start()
    h.advance(31 * MIN)
    ctl.evaluate(); ctl.evaluate(); ctl.activity(); ctl.visible()
    expect(events.filter(e => e[0] === 'expire')).toHaveLength(1)

    const h2 = harness(); const st2 = memoryStorage()
    const b = make(h2, st2)
    b.ctl.start()
    b.ctl.stop()
    h2.advance(2 * HOUR)
    b.ctl.evaluate()
    expect(b.events.filter(e => e[0] === 'expire')).toHaveLength(0)
    expect(h2.tickerCount()).toBe(0)
  })
})

describe('absolute cap', () => {
  it('signs out at 4 hours regardless of activity, with a 5-minute warning first', () => {
    const h = harness(); const st = memoryStorage()
    const { ctl, events } = make(h, st)
    ctl.start()
    // busy the whole time
    const until = SESSION_CAP_MS - CAP_WARN_MS - MIN
    for (let elapsed = 0; elapsed < until; elapsed += MIN) { h.advance(MIN); ctl.activity() }
    expect(ctl.getState().phase).toBe('active')
    h.advance(MIN); ctl.activity()
    expect(ctl.getState().phase).toBe('cap-warning')
    expect(ctl.getState().deadline).toBe(1_000_000 + SESSION_CAP_MS)
    // activity does not clear a cap warning
    ctl.activity()
    expect(ctl.getState().phase).toBe('cap-warning')
    for (let i = 0; i < 5; i++) { h.advance(MIN); ctl.activity() }
    expect(ctl.getState().phase).toBe('expired')
    expect(ctl.getState().reason).toBe('session_cap')
    expect(events.filter(e => e[0] === 'expire')).toEqual([['expire', 'session_cap']])
  })

  it('an idle warning outranks a cap warning when both apply', () => {
    const h = harness(); const st = memoryStorage()
    const { ctl } = make(h, st)
    ctl.start()
    for (let elapsed = 0; elapsed < SESSION_CAP_MS - 30 * MIN; elapsed += MIN) { h.advance(MIN); ctl.activity() }
    h.advance(26 * MIN)   // now 4 minutes from the cap AND 26 minutes idle
    expect(ctl.getState().phase).toBe('idle-warning')
  })

  it('a reload keeps the original sign-in time; a new session starts a new clock', () => {
    const h = harness(); const st = memoryStorage()
    const a = make(h, st)
    a.ctl.start()
    for (let elapsed = 0; elapsed < 3 * HOUR; elapsed += 10 * MIN) { h.advance(10 * MIN); a.ctl.activity() }
    a.ctl.stop()                       // the page is reloaded

    const b = make(h, st)              // same sessionId, same storage
    b.ctl.start()
    for (let elapsed = 0; elapsed < 55 * MIN; elapsed += MIN) { h.advance(MIN); b.ctl.activity() }
    expect(b.ctl.getState().phase).toBe('cap-warning')
    for (let i = 0; i < 6; i++) { h.advance(MIN); b.ctl.activity() }
    expect(b.ctl.getState().reason).toBe('session_cap')

    const c = make(h, memoryStorage(), { sessionId: 'sess-2' })
    c.ctl.start()
    for (let elapsed = 0; elapsed < 3 * HOUR; elapsed += 10 * MIN) { h.advance(10 * MIN); c.ctl.activity() }
    expect(c.ctl.getState().phase).toBe('active')
  })
})

describe('visibility', () => {
  it('judges the absence before counting the return', () => {
    // No ticker at all: a throttled background tab whose timers never fired.
    const h = harness(); const st = memoryStorage()
    const { ctl, events } = make(h, st, { schedule: () => null, unschedule: () => {} })
    ctl.start()
    h.advance(40 * MIN)
    expect(ctl.getState().phase).toBe('active')     // nothing has looked yet
    ctl.visible()
    expect(ctl.getState().phase).toBe('expired')
    expect(events.filter(e => e[0] === 'expire')).toEqual([['expire', 'idle_timeout']])
  })

  it('a return inside the window counts as activity', () => {
    const h = harness(); const st = memoryStorage()
    const { ctl } = make(h, st, { schedule: () => null, unschedule: () => {} })
    ctl.start()
    h.advance(20 * MIN)
    ctl.visible()
    h.advance(20 * MIN)
    ctl.evaluate()
    expect(ctl.getState().phase).toBe('active')
  })
})

describe('surfaces and tabs', () => {
  it('the two surfaces do not share state: a busy console tab does not keep an idle app tab alive', () => {
    const h = harness(); const st = memoryStorage()
    const app = createSessionTimeouts({
      surfaceKey: 'wilson.dev.session', sessionId: 's', storage: st,
      now: h.now, schedule: h.schedule, unschedule: h.unschedule,
    })
    const console_ = createSessionTimeouts({
      surfaceKey: 'wilson.operator.session', sessionId: 's', storage: st,
      now: h.now, schedule: h.schedule, unschedule: h.unschedule,
    })
    app.start(); console_.start()
    for (let elapsed = 0; elapsed < 31 * MIN; elapsed += MIN) { h.advance(MIN); console_.activity() }
    expect(console_.getState().phase).toBe('active')
    expect(app.getState().phase).toBe('expired')
    expect(app.getState().reason).toBe('idle_timeout')
    // and the app's expiry did not touch the console's keys
    expect(st.map.has('wilson.operator.session.activity')).toBe(true)
    expect(st.map.has('wilson.operator.session.start')).toBe(true)
  })

  it('the reverse: a busy app tab does not keep an idle console tab alive', () => {
    const h = harness(); const st = memoryStorage()
    const app = createSessionTimeouts({ surfaceKey: 'wilson.dev.session', sessionId: 's', storage: st, now: h.now, schedule: h.schedule, unschedule: h.unschedule })
    const console_ = createSessionTimeouts({ surfaceKey: 'wilson.operator.session', sessionId: 's', storage: st, now: h.now, schedule: h.schedule, unschedule: h.unschedule })
    app.start(); console_.start()
    for (let elapsed = 0; elapsed < 31 * MIN; elapsed += MIN) { h.advance(MIN); app.activity() }
    expect(app.getState().phase).toBe('active')
    expect(console_.getState().phase).toBe('expired')
  })

  it('two tabs of ONE surface share the activity clock, so the working tab is not signed out by the idle one', () => {
    const h = harness(); const st = memoryStorage()
    const tabA = createSessionTimeouts({ surfaceKey: 'wilson.dev.session', sessionId: 's', storage: st, now: h.now, schedule: h.schedule, unschedule: h.unschedule })
    const tabB = createSessionTimeouts({ surfaceKey: 'wilson.dev.session', sessionId: 's', storage: st, now: h.now, schedule: h.schedule, unschedule: h.unschedule })
    tabA.start(); tabB.start()
    for (let elapsed = 0; elapsed < 45 * MIN; elapsed += MIN) { h.advance(MIN); tabA.activity() }
    expect(tabA.getState().phase).toBe('active')
    expect(tabB.getState().phase).toBe('active')
    // both fall silent together
    h.advance(31 * MIN)
    expect(tabA.getState().phase).toBe('expired')
    expect(tabB.getState().phase).toBe('expired')
  })

  it('a missing or hostile storage is survivable', () => {
    const h = harness()
    const broken = { getItem: () => { throw new Error('nope') }, setItem: () => { throw new Error('nope') }, removeItem: () => { throw new Error('nope') } }
    const { ctl } = make(h, broken)
    ctl.start()
    h.advance(31 * MIN)
    expect(ctl.getState().reason).toBe('idle_timeout')
    const { ctl: none } = make(h, null)
    none.start()
    expect(none.getState().phase).toBe('active')
  })
})

describe('JWT helpers', () => {
  function token(payload) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    return `${b64({ alg: 'ES256' })}.${b64(payload)}.sig`
  }

  it('reads the session_id claim, falling back to sub and then the user id', () => {
    expect(sessionIdOf({ access_token: token({ sub: 'u1', session_id: 'sid-1' }) })).toBe('sid-1')
    expect(sessionIdOf({ access_token: token({ sub: 'u1' }) })).toBe('u1')
    expect(sessionIdOf({ access_token: 'not-a-jwt', user: { id: 'u2' } })).toBe('u2')
    expect(sessionIdOf(null)).toBe(null)
  })

  it('never throws on garbage', () => {
    expect(readJwtClaims('a.b.c')).toBe(null)
    expect(readJwtClaims(undefined)).toBe(null)
    expect(readJwtClaims(42)).toBe(null)
  })
})

describe('the numbers', () => {
  it('are the figures the brief and TPN AS-3.8 name', () => {
    expect(IDLE_WARN_MS).toBe(25 * MIN)
    expect(IDLE_SIGN_OUT_MS).toBe(30 * MIN)
    expect(SESSION_CAP_MS).toBe(4 * HOUR)
    expect(CAP_WARN_MS).toBe(5 * MIN)
  })
})
