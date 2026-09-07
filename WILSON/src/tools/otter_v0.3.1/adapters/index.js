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
// B3 (Track B): the local-server arm below talks to the desktop loopback API,
// which now refuses any /api request without the per-launch token. localFetch
// attaches it — and only for same-origin URLs, which matters here because this
// fall-through takes whatever URL a call site hands otterFetch.
import { localFetch } from '../../../lib/localServerFetch.js'
import { supabaseOtterAdapter, OtterCloudError } from './supabaseOtterAdapter.js'
import { supabase } from '../../../cloud/auth/supabaseClient.js'

/** 'auto' follows the session; 'local'/'supabase' pin it (Settings override). */
let modeOverride = 'auto'

export function setOtterAdapterMode(mode) {
  modeOverride = ['auto', 'local', 'supabase'].includes(mode) ? mode : 'auto'
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
  if (!route) return localFetch(input, init)

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
    return localFetch(input, init)
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
