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
