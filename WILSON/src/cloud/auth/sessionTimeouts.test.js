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
    expect(h.tickerCount()).toBe(0)

    // R2: the cap clock SURVIVES the expiry (the cap test below proves what
    // that is for). A restart after an IDLE expiry is a person who came
    // back, so their idle window starts again — only the four hours carry.
    expect(st.map.has('wilson.dev.session.start')).toBe(true)
    const again = make(h, st)
    again.ctl.start()
    expect(again.ctl.getState().phase).toBe('active')
    expect(again.ctl.getState().startedAt).toBe(1_000_000)
  })

  it('a stored activity timestamp in the future cannot suppress the timeout', () => {
    // An OS clock correction backwards: the value was written under the old
    // clock and now reads as two hours ahead.
    const h = harness(); const st = memoryStorage()
    st.setItem('wilson.dev.session.activity', String(1_000_000 + 2 * HOUR))
    const { ctl } = make(h, st)
    ctl.start()
    h.advance(31 * MIN)
    expect(ctl.getState().phase).toBe('expired')
    expect(ctl.getState().reason).toBe('idle_timeout')
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

    // 🚨 R2: the cap clock survives the expiry ON PURPOSE. `onExpire` starts
    // a sign-out that is network work; if it hangs, or the tab is closed
    // inside it, the persisted session is still there and this same session
    // comes back at the next boot. Deleting `.start` here handed it a fresh
    // four hours. Keeping it expires it again at once.
    expect(st.map.has('wilson.dev.session.start')).toBe(true)
    const again = make(h, st)
    again.ctl.start()
    expect(again.ctl.getState().phase).toBe('expired')
    expect(again.ctl.getState().reason).toBe('session_cap')
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

// =============================================================================
// S2 (night 3, 2026-10-27; docs/design/RECONNECT_DESIGN.md §11.3): the
// four-hour test an offline launch makes — the EARLIER of the cap's own record
// (read as start() reads it) and the token's own sign-in time (`amr`). Pinned
// as the design states it: never more lenient than the cap, and stricter where
// the cap cannot prove an age (no record on the desktop: a new origin at every
// launch).
// =============================================================================
import { sessionStartOf, insideSessionCap, tokenSignedInAt } from './sessionTimeouts'

describe('S2 — sessionStartOf / insideSessionCap', () => {
  const NOW = 1_800_000_000_000
  const SID = 'sid-1'
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const session = ({ sid = SID, amrAgoMs = null, amrAt = null } = {}) => {
    const claims = { sub: 'u', session_id: sid, exp: Math.floor(NOW / 1000) + 3000 }
    const at = amrAt ?? (amrAgoMs == null ? null : NOW - amrAgoMs)
    if (at != null) claims.amr = [{ method: 'totp', timestamp: Math.floor(at / 1000) + 60 }, { method: 'password', timestamp: Math.floor(at / 1000) }]
    return { access_token: `${b64({ alg: 'ES256' })}.${b64(claims)}.sig`, refresh_token: 'r' }
  }
  const storageWith = (record) => {
    const s = memoryStorage()
    if (record) s.setItem('wilson.dev.session.start', JSON.stringify(record))
    return s
  }

  it('the web: the cap\'s record alone decides', () => {
    const s = storageWith({ sid: SID, at: NOW - 1 * HOUR })
    expect(sessionStartOf(session(), { storage: s, now: NOW })).toBe(NOW - 1 * HOUR)
    expect(insideSessionCap(session(), { storage: s, now: NOW })).toBe(true)
    expect(insideSessionCap(session(), { storage: storageWith({ sid: SID, at: NOW - 4 * HOUR }), now: NOW })).toBe(false)
  })

  it('the desktop (no record): the token\'s own sign-in time decides — its earliest amr', () => {
    const s = storageWith(null)
    expect(sessionStartOf(session({ amrAgoMs: 2 * HOUR }), { storage: s, now: NOW })).toBe(NOW - 2 * HOUR)
    expect(insideSessionCap(session({ amrAgoMs: 2 * HOUR }), { storage: s, now: NOW })).toBe(true)
    expect(insideSessionCap(session({ amrAgoMs: 4 * HOUR + 1000 }), { storage: s, now: NOW })).toBe(false)
  })

  it('both known: the EARLIER wins, either way round', () => {
    expect(sessionStartOf(session({ amrAgoMs: 3 * HOUR }), { storage: storageWith({ sid: SID, at: NOW - 1 * HOUR }), now: NOW })).toBe(NOW - 3 * HOUR)
    expect(sessionStartOf(session({ amrAgoMs: 1 * HOUR }), { storage: storageWith({ sid: SID, at: NOW - 3 * HOUR }), now: NOW })).toBe(NOW - 3 * HOUR)
    // a young record does not rescue an old sign-in
    expect(insideSessionCap(session({ amrAgoMs: 5 * HOUR }), { storage: storageWith({ sid: SID, at: NOW - 10 * MIN }), now: NOW })).toBe(false)
  })

  it('what proves nothing: another session\'s record, a record or an amr in the future, neither at all', () => {
    expect(sessionStartOf(session(), { storage: storageWith({ sid: 'other', at: NOW - HOUR }), now: NOW })).toBeNull()
    expect(sessionStartOf(session(), { storage: storageWith({ sid: SID, at: NOW + HOUR }), now: NOW })).toBeNull()
    expect(sessionStartOf(session({ amrAt: NOW + HOUR }), { storage: storageWith(null), now: NOW })).toBeNull()
    expect(insideSessionCap(session(), { storage: storageWith(null), now: NOW })).toBe(false)
    expect(insideSessionCap({ access_token: 'not-a-jwt', refresh_token: 'r' }, { storage: storageWith(null), now: NOW })).toBe(false)
  })

  it('the cap\'s own number, the dev-only override included (a dev server\'s shrunk cap shrinks this too)', () => {
    const s = storageWith({ sid: SID, at: NOW - 2 * MIN })
    expect(insideSessionCap(session(), { storage: s, now: NOW })).toBe(true)
    s.setItem('wilson.session.timeouts.debug', JSON.stringify({ capMs: MIN }))
    expect(insideSessionCap(session(), { storage: s, now: NOW })).toBe(false)
    expect(SESSION_CAP_MS).toBe(4 * HOUR)
  })

  it('offline is never more lenient than the cap: a record past the cap is outside, and start() expires it at once', () => {
    const h = harness()
    const s = storageWith({ sid: SID, at: h.now() - 4 * HOUR - 1 })
    const sess = session()
    expect(insideSessionCap(sess, { storage: s, now: h.now() })).toBe(false)
    const { ctl, events } = make(h, s, { sessionId: sessionIdOf(sess) })
    ctl.start()
    expect(events.filter((e) => e[0] === 'expire')).toEqual([['expire', 'session_cap']])
  })

  // D1 (night 4, 2026-10-28; RECONNECT_DESIGN.md §12.2): this CONTROL pinned
  // the gap S2 found — with no record, start() handed a five-hour-old sign-in
  // a fresh four hours, so the desktop's cap restarted at every launch
  // (OUTSTANDING S2-01). Moved, with its reason: at a restore the surfaces pass
  // the token's own sign-in time through the option they use, and start() runs
  // from it. Red on the code before D1 (start() read no such option).
  it('CONTROL, moved by D1: at a restore with no record, start() runs from the token\'s sign-in, so a five-hour-old sign-in ends at once', () => {
    const h = harness()
    const s = storageWith(null)
    const sess = session({ amrAt: h.now() - 5 * HOUR })
    expect(insideSessionCap(sess, { storage: s, now: h.now() })).toBe(false)
    const { ctl, events } = make(h, s, { sessionId: sessionIdOf(sess), signedInAt: tokenSignedInAt(sess) })
    ctl.start()
    expect(events.filter((e) => e[0] === 'expire')).toEqual([['expire', 'session_cap']])
  })

  describe('D1 — at a restore, start() takes the start the offline launch tests', () => {
    const restore = (h, s, sess) => make(h, s, { sessionId: sessionIdOf(sess), signedInAt: tokenSignedInAt(sess) })
    /** Advance with activity every ten minutes, so only the cap can end the session. */
    const busyFor = (h, ctl, ms) => {
      for (let left = ms; left > 0; left -= 10 * MIN) { h.advance(Math.min(10 * MIN, left)); ctl.activity() }
    }

    it('tokenSignedInAt: the earliest amr in ms, raw (start() judges the future at its own clock), null without one', () => {
      expect(tokenSignedInAt(session({ amrAt: NOW - 2 * HOUR }))).toBe(NOW - 2 * HOUR)
      expect(tokenSignedInAt(session({ amrAt: NOW + HOUR }))).toBe(NOW + HOUR)
      expect(tokenSignedInAt(session())).toBeNull()
      expect(tokenSignedInAt({ access_token: 'not-a-jwt', refresh_token: 'r' })).toBeNull()
      expect(tokenSignedInAt(null)).toBeNull()
    })

    it('a relaunch inside the cap keeps the sign-in\'s deadline: the notice at four hours less five minutes from the sign-in, the end at four hours', () => {
      const h = harness()
      const s = storageWith(null)                        // the desktop's relaunch: a new origin, no record
      const sess = session({ amrAt: h.now() - 2 * HOUR })
      const signedIn = tokenSignedInAt(sess)
      const { ctl, events } = restore(h, s, sess)
      ctl.start()
      expect(ctl.getState().startedAt).toBe(signedIn)
      expect(JSON.parse(s.getItem('wilson.dev.session.start'))).toEqual({ sid: SID, at: signedIn })
      busyFor(h, ctl, 2 * HOUR - CAP_WARN_MS - MIN)
      expect(ctl.getState().phase).toBe('active')
      busyFor(h, ctl, 2 * MIN)
      expect(ctl.getState()).toMatchObject({ phase: 'cap-warning', deadline: signedIn + SESSION_CAP_MS })
      busyFor(h, ctl, 4 * MIN)
      expect(events.filter((e) => e[0] === 'expire')).toEqual([['expire', 'session_cap']])
    })

    it('a relaunch past the cap ends the session the moment it starts', () => {
      const h = harness()
      const { ctl, events } = restore(h, storageWith(null), session({ amrAt: h.now() - SESSION_CAP_MS - 1000 }))
      ctl.start()
      expect(events.filter((e) => e[0] === 'expire')).toEqual([['expire', 'session_cap']])
    })

    it('the record and the token: the earlier wins, either way round', () => {
      const h = harness()
      const older = session({ amrAt: h.now() - 3 * HOUR })
      const a = restore(h, storageWith({ sid: SID, at: h.now() - 1 * HOUR }), older)
      a.ctl.start()
      expect(a.ctl.getState().startedAt).toBe(tokenSignedInAt(older))
      const b = restore(h, storageWith({ sid: SID, at: h.now() - 3 * HOUR }), session({ amrAt: h.now() - 1 * HOUR }))
      b.ctl.start()
      expect(b.ctl.getState().startedAt).toBe(h.now() - 3 * HOUR)
    })

    it('a fresh sign-in passes no time: its record is now, whatever the token says (a clock hours ahead is not signed out at the sign-in)', () => {
      const h = harness()
      const s = storageWith(null)
      const sess = session({ amrAt: h.now() - 5 * HOUR })   // what a clock five hours ahead of the server reads at a sign-in
      const { ctl, events } = make(h, s, { sessionId: sessionIdOf(sess) })   // App's handleAuth, the console's handleSignedIn
      ctl.start()
      expect(events.some((e) => e[0] === 'expire')).toBe(false)
      expect(ctl.getState().startedAt).toBe(h.now())
      expect(JSON.parse(s.getItem('wilson.dev.session.start'))).toEqual({ sid: SID, at: h.now() })
    })

    it('what proves nothing leaves the cap as before: a token without amr, an amr in the future, another session\'s record', () => {
      const h = harness()
      const plain = session()
      const r1 = restore(h, storageWith({ sid: SID, at: h.now() - HOUR }), plain)
      r1.ctl.start()
      expect(r1.ctl.getState().startedAt).toBe(h.now() - HOUR)          // the web's reload: the record decides
      const r2 = restore(h, storageWith(null), plain)
      r2.ctl.start()
      expect(r2.ctl.getState().startedAt).toBe(h.now())                 // nothing proved: now, as before
      const r3 = restore(h, storageWith(null), session({ amrAt: h.now() + HOUR }))
      r3.ctl.start()
      expect(r3.ctl.getState().startedAt).toBe(h.now())                 // a clock behind the server's: the future proves nothing
      const own = session({ amrAt: h.now() - 2 * HOUR })
      const r4 = restore(h, storageWith({ sid: 'other', at: h.now() - 3 * HOUR }), own)
      r4.ctl.start()
      expect(r4.ctl.getState().startedAt).toBe(tokenSignedInAt(own))   // another session's record proves nothing
    })

    it('agreement: at a restore, start() ends the session at once exactly when insideSessionCap says outside, whenever a start is proved', () => {
      const records = [null, { sid: 'other', at: -3 * HOUR }, { sid: SID, at: HOUR }, { sid: SID, at: -HOUR }, { sid: SID, at: -SESSION_CAP_MS - 1000 }, { sid: SID, at: -SESSION_CAP_MS + MIN }]
      const amrs = [null, HOUR, -2 * HOUR, -SESSION_CAP_MS - 1000, -SESSION_CAP_MS + MIN]
      let cases = 0
      for (const rec of records) {
        for (const amr of amrs) {
          const h = harness()
          const s = storageWith(rec && { sid: rec.sid, at: h.now() + rec.at })
          const sess = session({ amrAt: amr == null ? null : h.now() + amr })
          const proved = sessionStartOf(sess, { storage: s, now: h.now() }) != null
          const inside = insideSessionCap(sess, { storage: s, now: h.now() })
          const { ctl, events } = restore(h, s, sess)
          ctl.start()
          const endedAtOnce = events.some((e) => e[0] === 'expire')
          // Neither proved: a fresh four hours online, as before; offline the launch refuses (§11.3).
          expect(endedAtOnce).toBe(proved ? !inside : false)
          cases += 1
        }
      }
      expect(cases).toBe(30)
    })
  })
})
