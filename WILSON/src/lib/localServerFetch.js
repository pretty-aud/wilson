// =============================================================================
// src/lib/localServerFetch.js — Bundle B3 (Track B): attach the per-launch
// loopback token to renderer fetches.
//
// The desktop Express server refuses every `/api` request that carries neither
// the token header nor the token cookie (electron/localToken.cjs). The cookie
// is set by main on the loopback origin and rides along on ALL same-origin
// requests automatically, so it — not this module — is what keeps `<img src>`
// and `<video src>` working. This module is the header arm: the belt to that
// cookie's braces, and the only arm a caller outside a browser has.
//
// ── 🚨 WHY THIS NEVER ATTACHES TO AN ABSOLUTE FOREIGN URL ───────────────────
//
// `otterFetch` falls through to raw `fetch(input, init)` for anything it does
// not recognise as an O.T.T.E.R. content route, and `fetchImpl` is injected
// into petKnowledge and managedVideoThumbnail from the outside. A helper that
// attached the token to whatever it was handed would post the launch secret to
// api.anthropic.com the first time somebody widened a call site. So the token
// goes ONLY to a URL this app is already same-origin with: a root-relative path,
// or an absolute URL whose origin equals `location.origin`. Everything else is
// passed through untouched.
//
// ── BROWSER-SAFE BY CONSTRUCTION ────────────────────────────────────────────
//
// `window.electronAPI` is undefined in the web build and in the node test
// environment, so `localFetch` is exactly `fetch` there — no bridge, no header,
// no behaviour change. `window.electronAPI` is NOT a backend selector
// (`ctx.supportsManagedFiles` is); it is only ever asked "is there a preload
// bridge here", which is the one question it can answer.
// =============================================================================

/** Must match TOKEN_HEADER in electron/localToken.cjs. */
export const LOCAL_TOKEN_HEADER = 'x-wilson-local-token'

/**
 * The per-launch token, or null off the desktop.
 * @returns {string|null}
 */
export function localServerToken() {
  if (typeof window === 'undefined') return null
  const token = window.electronAPI?.localServerToken
  return typeof token === 'string' && token.length > 0 ? token : null
}

/**
 * Is this URL one the local server answers — i.e. same-origin with the
 * renderer? See the header comment for why this is not optional.
 * @param {string|Request} input
 */
export function isLocalServerUrl(input) {
  const url = typeof input === 'string' ? input : (input?.url ?? '')
  if (typeof url !== 'string' || url.length === 0) return false
  // `//host/path` is protocol-relative and points at ANOTHER host.
  if (url.startsWith('//')) return false
  if (url.startsWith('/')) return true
  if (typeof window === 'undefined' || !window.location?.origin) return false
  try {
    return new URL(url, window.location.href).origin === window.location.origin
  } catch {
    return false
  }
}

/**
 * Copy `init` with the token header added, when there is a token and the URL is
 * ours. Returns `init` untouched otherwise — including the `undefined` a bare
 * `fetch(url)` passes, so nothing gains an empty options object it did not have.
 *
 * Handles all three shapes `HeadersInit` can take (Headers, entry array, plain
 * object) rather than assuming the object one; `localServerAdapter` passes
 * objects and a Request carries a Headers.
 */
export function withLocalToken(input, init) {
  const token = localServerToken()
  if (!token || !isLocalServerUrl(input)) return init

  const existing = init?.headers
  let headers
  if (existing instanceof Headers) {
    headers = new Headers(existing)
    headers.set(LOCAL_TOKEN_HEADER, token)
  } else if (Array.isArray(existing)) {
    headers = [...existing.filter(([k]) => String(k).toLowerCase() !== LOCAL_TOKEN_HEADER),
      [LOCAL_TOKEN_HEADER, token]]
  } else {
    headers = { ...(existing || {}) }
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === LOCAL_TOKEN_HEADER) delete headers[key]
    }
    headers[LOCAL_TOKEN_HEADER] = token
  }
  return { ...(init || {}), headers }
}

/**
 * Drop-in `fetch` for anything that talks to the desktop loopback server.
 *
 * 🚨 `fetch` RESOLVES for every status, so a 401 from the guard reads as an
 * empty list at a call site that does not check `res.ok`. That is the failure
 * mode this whole module exists to prevent; it is also why the harness asserts
 * on the STATUS and not on whether the promise settled.
 */
export function localFetch(input, init) {
  return fetch(input, withLocalToken(input, init))
}
