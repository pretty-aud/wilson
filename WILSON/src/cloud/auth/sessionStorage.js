// =============================================================================
// sessionStorage — persists the Supabase session per host:
//
//   Electron  -> the preload bridge (window.wilsonSession), which encrypts
//                with safeStorage in the main process (OS keychain).
//   Browser   -> localStorage. Session 12 settled the web strategy: the web
//                build ships on a static host with no server to set an
//                httpOnly cookie, so it persists the way every Supabase SPA
//                does (supabase-js's own persistSession uses localStorage).
//                XSS is the threat model either way, and the token is a
//                short-lived JWT + rotating refresh token, not a credential.
//
// The key keeps its historical name — `wilson.dev.session` predates the web
// build (it was the vite-dev fallback) and renaming it would sign out every
// existing dev session for no gain.
//
// SESSION ISOLATION (Session 15, locked #18). The platform operator console
// at /wilsonadmin is a separate surface with a separate sign-in, but
// localStorage is scoped per ORIGIN, not per path — on beta.petalstudios.co
// both bundles read the same store. So the operator bundle uses a DIFFERENT
// KEY, and that key string is the entire isolation mechanism: without it the
// two surfaces would silently share one session and signing into /wilson
// would sign you into the console. The historical key is kept for /wilson
// precisely so no existing session is disturbed.
//
// __WILSON_SURFACE__ is a build-time define (vite.config.js), so the operator
// key cannot leak into the app bundle at runtime — it is not even a branch,
// it is a different constant in each build.
//
// The three functions below are the entire surface the auth flow touches.
// supabaseClient re-saves on TOKEN_REFRESHED so the stored refresh token
// never goes stale in a long-lived tab.
// =============================================================================

/* global __WILSON_SURFACE__ */
const SURFACE =
  typeof __WILSON_SURFACE__ === 'string' ? __WILSON_SURFACE__ : 'app'

const STORAGE_KEY =
  SURFACE === 'admin' ? 'wilson.operator.session' : 'wilson.dev.session'

// The Electron preload bridge is a SINGLE safeStorage slot — save/load/clear
// take no key argument. So the operator surface must never touch it: sharing
// that one slot would defeat the isolation the key split above provides. The
// admin entry is excluded from the Electron build (vite.config.js gates the
// input on mode), making this unreachable today; it is here so the isolation
// does not quietly depend on that build detail staying true.
const hasBridge = () =>
  SURFACE !== 'admin' &&
  typeof window !== 'undefined' &&
  !!window.wilsonSession

export async function saveSession(session) {
  if (!session) return
  if (hasBridge()) {
    await window.wilsonSession.save(session)
    return
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch { /* storage disabled */ }
}

export async function loadSession() {
  if (hasBridge()) {
    return window.wilsonSession.load()
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function clearSession() {
  if (hasBridge()) {
    await window.wilsonSession.clear()
    return
  }
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
}
