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
// The three functions below are the entire surface the auth flow touches.
// supabaseClient re-saves on TOKEN_REFRESHED so the stored refresh token
// never goes stale in a long-lived tab.
// =============================================================================

const STORAGE_KEY = 'wilson.dev.session'

const hasBridge = () =>
  typeof window !== 'undefined' && !!window.wilsonSession

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
