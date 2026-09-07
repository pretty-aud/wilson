// =============================================================================
// otterFetch — Session 10
//
// The single seam between O.T.T.E.R.'s ~90 `fetch('/api/software/...')` call
// sites and whichever backend is actually there:
//
//   Electron, signed out / local mode  ->  the in-app Express server (as before)
//   Signed in to a workspace           ->  Supabase (migration 0022)
//   Browser (Session 11)               ->  Supabase, because there is no
//                                          in-app Express server at all
//
// Call sites keep their exact shape — `otterFetch(url, init).then(r => r.json())`
// — so the diff across Otter.jsx/Validator.jsx is one identifier, not a rewrite
// of a 4,600-line component. Anything that is not an O.T.T.E.R. content route
// (pet, otter-settings, agent-skills, fetch-url, …) falls straight through to
// the real network untouched.
//
// Browser-safe by construction: no window.electronAPI, no node APIs, no
// safeStorage bridge. Session 11 needs this file to work unchanged on the web.
// =============================================================================

import { parseOtterRoute } from './otterRoutes.js'
import { supabaseOtterAdapter, OtterCloudError } from './supabaseOtterAdapter.js'
import { supabase } from '../../../cloud/auth/supabaseClient.js'

/**
 * 'auto' follows the session; 'local'/'supabase' pin it.
 *
 * A4, Audrey's decision 3. Until this bundle `setOtterAdapterMode` had ZERO
 * callers — the two comments elsewhere calling it "the Settings override"
 * described a control that was never built. Signing in on the desktop
 * therefore hid the six local courses with no way back, because `cloudActive()`
 * answered from the session's `workspace_id` and nothing could say otherwise.
 */
let modeOverride = 'auto'

/** The three values the routing seam understands. The Settings control only
 *  offers 'auto' and 'local'; 'supabase' stays reachable for a caller that
 *  knows a session exists, and pinning it while signed out would 501 every
 *  cloudOnly route — which is why the UI does not offer it. */
const OTTER_MODES = ['auto', 'local', 'supabase']

/**
 * Per-DEVICE pin, in localStorage rather than `otter-settings.json`.
 *
 * Two reasons, both load-bearing. (1) `otterFetch` routes on a SYNCHRONOUS read
 * of `modeOverride`; a settings file behind `/api/otter-settings` would make
 * every one of the ~90 call sites race a fetch on first paint. (2)
 * `resolveUserSettings` in `src/lib/userState.js` already refuses to carry
 * machine state (`adapterMode`, `storageLocation`) between computers, and this
 * is exactly that kind of state — "show me THIS computer's library" is a fact
 * about the computer, not about the person.
 */
export const OTTER_LIBRARY_MODE_KEY = 'wilson.otter.libraryMode'

/**
 * A 'local' pin CANNOT be honoured on the web build: there is no in-app Express
 * server, so every content route would answer 401 and the library would be
 * permanently empty with the control that got you there off-screen. localStorage
 * is per-origin so a desktop pin should never reach a browser in the first
 * place; this is the belt to that braces, and it also covers a pin written
 * before a build changed underneath it.
 */
function usableMode(mode) {
  if (!OTTER_MODES.includes(mode)) return 'auto'
  if (mode === 'local' && isBrowserBuild()) return 'auto'
  return mode
}

/** Read the pin once, at module load. Wrapped because `localStorage` throws
 *  outright in some privacy modes and does not exist in the node test env. */
function readPinnedMode() {
  try {
    return usableMode(localStorage.getItem(OTTER_LIBRARY_MODE_KEY))
  } catch {
    return 'auto'
  }
}

modeOverride = readPinnedMode()

const modeListeners = new Set()

/**
 * Anything whose ANSWER changes with the library mode subscribes here. Two
 * things do today, and both are load-bearing:
 *
 *   • `Otter.jsx`'s `cloudMode`, which decides whether the sharing, trash and
 *     change-request affordances render at all. Its effect is keyed on
 *     `[perms.ready, perms.workspaceId]`, neither of which moves when the
 *     switch is flipped, so without this the controls would keep rendering
 *     against a backend that has no idea what they are.
 *
 *   • Phase 6's pet knowledge index (wired in `App.jsx`). It is module-level,
 *     keyed on nothing, and warm for INDEX_TTL_MS — so without this the pet
 *     answers Blender questions out of the library you just switched AWAY from,
 *     for five minutes, with no sign that anything is wrong.
 *
 * Subscribing here rather than having each caller of `setOtterAdapterMode`
 * remember to clear things is deliberate: a future third caller gets the
 * behaviour for free instead of reintroducing the bug.
 *
 * @returns {() => void} unsubscribe
 */
export function subscribeOtterAdapterMode(fn) {
  // Belt to the per-listener catch below rather than an independently
  // observable guard: without it a non-function would sit in the Set and be
  // swallowed by that catch on every notify. Deliberately NOT pinned by a
  // test -- with the catch in place no assertion can tell the two apart, and
  // a test that cannot fail is worse than none.
  if (typeof fn !== 'function') return () => {}
  modeListeners.add(fn)
  return () => { modeListeners.delete(fn) }
}

/**
 * Set the library mode and persist it for this device.
 * @param {'auto'|'local'|'supabase'} mode
 * @param {{persist?: boolean}} [opts] persist:false is for tests and for
 *        restoring a value that came FROM storage.
 * @returns {string} the mode actually adopted (may differ — see usableMode)
 */
export function setOtterAdapterMode(mode, { persist = true } = {}) {
  const next = usableMode(mode)
  const changed = next !== modeOverride
  modeOverride = next
  if (persist) {
    try {
      if (next === 'auto') localStorage.removeItem(OTTER_LIBRARY_MODE_KEY)
      else localStorage.setItem(OTTER_LIBRARY_MODE_KEY, next)
    } catch { /* no storage: the pin is per-device and best-effort by design */ }
  }
  // Snapshot before iterating. NOT for self-removal -- deleting the current
  // element of a Set mid-iteration is well defined and does not skip the next
  // one (measured, not assumed). The case the copy actually prevents is a
  // listener that SUBSCRIBES during the pass: live iteration would call the
  // brand-new listener for a change it was never subscribed to, and a listener
  // that resubscribes would not terminate. Snapshot semantics: everyone
  // registered when the mode moved is called exactly once.
  if (changed) {
    for (const fn of [...modeListeners]) {
      try { fn(next) } catch { /* one bad listener must not strand the others */ }
    }
  }
  return next
}

export function getOtterAdapterMode() {
  return modeOverride
}

/** True when there is no in-app Express server to fall back to. */
function isBrowserBuild() {
  return typeof window !== 'undefined' && !window.electronAPI
}

/**
 * Cloud mode is active when the signed-in session carries a workspace_id.
 * Read from the token payload, matching usePermissions — app_metadata on the
 * user object is not authoritative (the Session 9 Edge-Function finding).
 */
async function cloudActive() {
  if (modeOverride === 'local') return false
  if (modeOverride === 'supabase') return true
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return false
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return Boolean(payload?.app_metadata?.workspace_id)
  } catch {
    return false
  }
}

/**
 * Session 11: the UI needs the SAME answer otterFetch routes on, so that the
 * sharing / trash / change-request affordances appear exactly when they work.
 * Deriving it independently (e.g. from usePermissions alone) would drift the
 * moment someone pins the mode override in Settings — the controls would render
 * against a backend that has no idea what they are.
 * @returns {Promise<boolean>}
 */
export function otterCloudActive() {
  return cloudActive()
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function parseBody(init) {
  if (!init || init.body == null) return undefined
  if (typeof init.body === 'string') {
    try { return JSON.parse(init.body) } catch { return undefined }
  }
  return init.body
}

/**
 * Drop-in replacement for fetch() on O.T.T.E.R. content routes.
 * @returns {Promise<Response>}
 */
export async function otterFetch(input, init) {
  const url = typeof input === 'string' ? input : input?.url ?? ''
  const method = init?.method ?? (typeof input === 'object' ? input?.method : undefined) ?? 'GET'

  const route = parseOtterRoute(url, method)
  if (!route) return fetch(input, init)

  if (!(await cloudActive())) {
    if (route.cloudOnly) {
      // Sharing, editor grants, trash and change requests exist only in a
      // workspace. Express has no such routes, so falling through would return
      // the local server's HTML 404 to a call site that does not check res.ok.
      return jsonResponse(
        { error: 'This O.T.T.E.R. feature needs a signed-in workspace.' }, 501)
    }
    if (isBrowserBuild()) {
      // Failing loudly beats a confusing 404 from the static host.
      return jsonResponse(
        { error: 'O.T.T.E.R. requires a signed-in workspace on the web.' }, 401)
    }
    return fetch(input, init)
  }

  const handler = supabaseOtterAdapter[route.op]
  if (typeof handler !== 'function') {
    return jsonResponse({ error: `unsupported O.T.T.E.R. route: ${route.op}` }, 501)
  }

  try {
    const data = await handler({ ...route, body: parseBody(init) })
    return jsonResponse(data, 200)
  } catch (err) {
    const status = err instanceof OtterCloudError ? err.status : 500
    // Mirrors the Express server's error shape so existing `.catch()` fallbacks
    // in Otter.jsx keep behaving the same way.
    return jsonResponse({ error: err?.message ?? 'O.T.T.E.R. cloud request failed' }, status)
  }
}

export { supabaseOtterAdapter }
