// =============================================================================
// sessionTimeouts — Track B bundle B2, part 2: the idle timeout and the
// absolute session cap (TPN AS-3.8; fix plan answer 23).
//
// Numbers: a warning at 25 minutes without activity, sign-out at 30; an
// absolute cap of 4 HOURS from sign-in, activity or not, with a 5-minute
// notice before it so nobody loses unsaved work to a clock. 4 hours is TPN's
// figure and the default the B2 part 1 hand-off named; Audrey had not said
// otherwise when this shipped. Change the constants, not the logic.
//
// Wall-clock, not tick-counted. Timestamps are compared on every evaluation
// (a periodic tick; every activity while a warning is up; every return to
// visibility), so a background tab whose timers the browser throttles to
// once a minute still signs out — at most a minute late — and the moment it
// is looked at again it is evaluated at once.
//
// Activity: pointer, key, wheel and touch events, capture phase, passive. A
// return to visibility is evaluated FIRST (a person away for 40 minutes is
// signed out on return, not handed a fresh half hour) and THEN counted as
// activity (switching to the tab is an action).
//
// Storage, per SURFACE. Two keys under the surface's own session key —
// `<key>.activity` and `<key>.start` — so /wilson (`wilson.dev.session`) and
// /wilsonadmin (`wilson.operator.session`) never read each other's clocks: a
// busy console tab cannot keep an idle app tab alive, or the reverse. The
// same key IS shared by two tabs of one surface, on purpose: they hold one
// Supabase session (one refresh token), and a `scope: 'local'` sign-out from
// an idle tab revokes that session server-side, so the working tab would be
// dropped at its next refresh with nothing on screen to explain it. Sharing
// the activity clock within a surface prevents exactly that.
//
// The cap is keyed by the JWT's session_id: a reload keeps the original
// sign-in time; a new sign-in starts a new clock; a session from before this
// shipped counts from the first time this code saw it.
//
// No React and no DOM in the core — createSessionTimeouts() takes its clock,
// storage and timer as arguments so the test drives it under fake timers.
// useSessionTimeouts() binds it to the document for the two surfaces.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { SESSION_STORAGE_KEY } from './sessionStorage'

export const IDLE_WARN_MS       = 25 * 60 * 1000
export const IDLE_SIGN_OUT_MS   = 30 * 60 * 1000
export const SESSION_CAP_MS     =  4 * 60 * 60 * 1000
export const CAP_WARN_MS        =  5 * 60 * 1000
export const TICK_MS            =  5 * 1000
export const ACTIVITY_PERSIST_MS = 5 * 1000

/** The reasons handed to onExpire — also the auth_events kinds they become. */
export const EXPIRE_REASONS = Object.freeze(['idle_timeout', 'session_cap'])

export const INACTIVE_STATE = Object.freeze({
  phase: 'inactive', deadline: null, reason: null, startedAt: null, lastActivity: null,
})

// ── JWT helpers ──────────────────────────────────────────────────────────────

/** Decode a JWT payload without verifying it (the claims are for display). */
export function readJwtClaims(accessToken) {
  if (typeof accessToken !== 'string') return null
  const parts = accessToken.split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    return JSON.parse(atob(b64 + pad))
  } catch {
    return null
  }
}

/**
 * The key the cap clock is tied to. GoTrue stamps `session_id` into every
 * access token of a session and keeps it across refreshes; a new sign-in is a
 * new id. Falls back to the subject so a token without the claim still gets
 * a clock, keyed per person rather than per session.
 */
export function sessionIdOf(session) {
  const claims = readJwtClaims(session?.access_token)
  return claims?.session_id ?? claims?.sub ?? session?.user?.id ?? null
}

// ── Storage helpers ──────────────────────────────────────────────────────────

function readNumber(storage, key) {
  try {
    const raw = storage?.getItem(key)
    const n = raw == null ? NaN : Number(raw)
    return Number.isFinite(n) ? n : null
  } catch { return null }
}

function readJson(storage, key) {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function write(storage, key, value) {
  try { storage?.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)) } catch { /* storage disabled */ }
}

function remove(storage, key) {
  try { storage?.removeItem(key) } catch { /* ignore */ }
}

// ── The core ─────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}   opts.surfaceKey   the surface's session key; two keys hang off it
 * @param {string}   opts.sessionId    ties the cap clock to one sign-in
 * @param {object}  [opts.storage]     { getItem, setItem, removeItem } — localStorage when present
 * @param {() => number} [opts.now]
 * @param {(fn: () => void, ms: number) => any} [opts.schedule]   periodic; defaults to setInterval
 * @param {(handle: any) => void} [opts.unschedule]
 * @param {(state: object) => void} [opts.onChange]
 * @param {(reason: 'idle_timeout'|'session_cap') => void} [opts.onExpire]
 */
export function createSessionTimeouts(opts) {
  const {
    surfaceKey,
    sessionId,
    storage = null,
    now = () => Date.now(),
    schedule = (fn, ms) => setInterval(fn, ms),
    unschedule = (h) => clearInterval(h),
    idleWarnMs = IDLE_WARN_MS,
    idleSignOutMs = IDLE_SIGN_OUT_MS,
    capMs = SESSION_CAP_MS,
    capWarnMs = CAP_WARN_MS,
    tickMs = TICK_MS,
    activityPersistMs = ACTIVITY_PERSIST_MS,
    onChange = () => {},
    onExpire = () => {},
  } = opts
  if (!surfaceKey) throw new Error('createSessionTimeouts: surfaceKey is required')

  const activityKey = `${surfaceKey}.activity`
  const startKey    = `${surfaceKey}.start`

  let state = { ...INACTIVE_STATE }
  let startedAt = null
  let memActivity = null      // this tab's own last activity
  let lastPersisted = 0
  let timer = null
  let expired = false
  let running = false

  function setState(next) {
    const changed = next.phase !== state.phase || next.deadline !== state.deadline || next.reason !== state.reason
    state = next
    if (changed) onChange(state)
  }

  function lastActivity() {
    // Another tab of the same surface may be the busy one.
    //
    // R2: clamped to now. A stored timestamp in the FUTURE — an OS clock
    // correction backwards, after this or another tab wrote under the old
    // clock — otherwise makes `idleFor` negative and suppresses the idle
    // timeout for as long as the skew lasts. A clock that moved is not
    // activity; the worst this can do is expire a session early, which is
    // the safe direction for a security control.
    const t = now()
    const stored = readNumber(storage, activityKey)
    return Math.min(Math.max(memActivity ?? 0, stored ?? 0), t)
  }

  function stopTicker() {
    if (timer != null) { unschedule(timer); timer = null }
  }

  function expire(reason) {
    if (expired) return state
    expired = true
    running = false
    stopTicker()
    // 🚨 R2: the two keys are deliberately NOT removed here. `onExpire`
    // starts a sign-out that is network work — it can hang, and the tab can
    // be closed inside it. Deleting `.start` first meant that a sign-out
    // which never finished left the persisted session in place AND no start
    // time, so the next boot of that same session read "no clock for this
    // session id" and handed out a FRESH four hours. Keeping it makes the
    // restart expire again at once (`start()` ends in `evaluate()`), which
    // is the safe direction. Nothing leaks: `.start` is keyed by session id,
    // and `start()` overwrites both keys for any new one.
    setState({ phase: 'expired', deadline: null, reason, startedAt, lastActivity: memActivity })
    onExpire(reason)
    return state
  }

  function evaluate() {
    if (!running || expired) return state
    const t = now()
    const last = lastActivity()
    const idleFor = t - last
    const age = t - startedAt
    if (age >= capMs) return expire('session_cap')
    if (idleFor >= idleSignOutMs) return expire('idle_timeout')
    let next
    if (idleFor >= idleWarnMs) {
      next = { phase: 'idle-warning', deadline: last + idleSignOutMs, reason: 'idle_timeout' }
    } else if (age >= capMs - capWarnMs) {
      next = { phase: 'cap-warning', deadline: startedAt + capMs, reason: 'session_cap' }
    } else {
      next = { phase: 'active', deadline: null, reason: null }
    }
    setState({ ...next, startedAt, lastActivity: last })
    return state
  }

  function activity() {
    if (!running || expired) return
    const t = now()
    memActivity = t
    if (t - lastPersisted >= activityPersistMs) {
      lastPersisted = t
      write(storage, activityKey, String(t))
    }
    // A warning must clear the moment the person moves, not at the next tick.
    if (state.phase !== 'active') evaluate()
  }

  /** The tab became visible: judge the absence first, then count the return. */
  function visible() {
    if (!running || expired) return
    evaluate()
    if (!expired) activity()
  }

  function start() {
    if (running || expired) return
    running = true
    const t = now()
    const stored = readJson(storage, startKey)
    if (stored && stored.sid === sessionId && Number.isFinite(stored.at) && stored.at <= t) {
      startedAt = stored.at               // a reload; the clock keeps running
    } else {
      startedAt = t                        // a new sign-in, or a session from before this shipped
      write(storage, startKey, { sid: sessionId, at: t })
    }
    memActivity = t
    lastPersisted = t
    write(storage, activityKey, String(t))
    timer = schedule(evaluate, tickMs)
    evaluate()
  }

  function stop() {
    running = false
    stopTicker()
    // The keys stay: `.start` is keyed by session id and `.activity` is
    // overwritten by the next start(). Nothing here belongs to another surface.
  }

  return {
    start, stop, activity, visible, evaluate,
    getState: () => state,
    isRunning: () => running,
  }
}

// ── DOM binding ──────────────────────────────────────────────────────────────

export const ACTIVITY_EVENTS = Object.freeze(['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'])

/**
 * Wire a controller to the document. Returns the detach function.
 */
export function attachActivityListeners(ctl, target = typeof window !== 'undefined' ? window : null, doc = typeof document !== 'undefined' ? document : null) {
  if (!target || !doc) return () => {}
  const onActivity = () => ctl.activity()
  const onVisibility = () => { if (doc.visibilityState === 'visible') ctl.visible() }
  const listenerOpts = { capture: true, passive: true }
  for (const ev of ACTIVITY_EVENTS) target.addEventListener(ev, onActivity, listenerOpts)
  doc.addEventListener('visibilitychange', onVisibility)
  return () => {
    for (const ev of ACTIVITY_EVENTS) target.removeEventListener(ev, onActivity, listenerOpts)
    doc.removeEventListener('visibilitychange', onVisibility)
  }
}

function safeLocalStorage() {
  try {
    if (typeof localStorage === 'undefined') return null
    // A private window can expose the object and throw on use.
    localStorage.getItem('wilson.session.probe')
    return localStorage
  } catch { return null }
}

/**
 * DEV ONLY: `localStorage['wilson.session.timeouts.debug']` may hold JSON
 * overrides ({ idleWarnMs, idleSignOutMs, capMs, capWarnMs, tickMs }) so the
 * warning and the sign-out can be watched in seconds on a dev server. The
 * production build never reads it — `import.meta.env.DEV` is false there.
 */
export const DEV_OVERRIDES_KEY = 'wilson.session.timeouts.debug'
const OVERRIDABLE = ['idleWarnMs', 'idleSignOutMs', 'capMs', 'capWarnMs', 'tickMs']
export function readDevOverrides(storage = safeLocalStorage()) {
  // R2: the EXACT `import.meta.env.DEV`, not `import.meta.env?.DEV`. Vite
  // replaces this expression by key at build time, so the production bundle
  // folds the branch to `if (true) return {}` and never reads the key at all.
  // The optional chain happens to be matched today; relying on that is
  // relying on a bundler's pattern matching for a dev-only switch.
  if (!import.meta.env.DEV) return {}
  const raw = readJson(storage, DEV_OVERRIDES_KEY)
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const k of OVERRIDABLE) if (Number.isFinite(raw[k]) && raw[k] > 0) out[k] = raw[k]
  return out
}

/**
 * React binding for one surface.
 *
 * @param {object} opts
 * @param {boolean} opts.enabled      true while the surface has a session
 * @param {string|null} opts.sessionId
 * @param {(reason: string) => void} opts.onExpire   sign the surface out, say why
 * @param {string} [opts.surfaceKey]  defaults to this bundle's session key
 * @param {object} [opts.overrides]   test seam; DEV overrides are merged first
 * @returns {{ phase: string, deadline: number|null, reason: string|null, stay: () => void }}
 */
export function useSessionTimeouts({ enabled, sessionId, onExpire, surfaceKey = SESSION_STORAGE_KEY, overrides }) {
  const [state, setState] = useState(INACTIVE_STATE)
  const ctlRef = useRef(null)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  useEffect(() => {
    if (!enabled || !sessionId) {
      setState(INACTIVE_STATE)
      return undefined
    }
    const ctl = createSessionTimeouts({
      surfaceKey,
      sessionId,
      storage: safeLocalStorage(),
      ...readDevOverrides(),
      ...(overrides || {}),
      onChange: setState,
      onExpire: (reason) => onExpireRef.current?.(reason),
    })
    ctlRef.current = ctl
    const detach = attachActivityListeners(ctl)
    ctl.start()
    return () => {
      detach()
      ctl.stop()
      if (ctlRef.current === ctl) ctlRef.current = null
    }
    // `overrides` is a test seam; a new object per render must not restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId, surfaceKey])

  const stay = () => ctlRef.current?.activity()
  return { ...state, stay }
}
