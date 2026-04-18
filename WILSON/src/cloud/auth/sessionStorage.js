// =============================================================================
// sessionStorage — thin wrapper around the Electron preload bridge that
// persists Supabase sessions with safeStorage (OS-native encryption).
//
// Web path (Session 10) will swap this for an httpOnly cookie round-trip.
// The three functions below are the entire surface the auth flow touches.
// =============================================================================

const hasBridge = () =>
  typeof window !== 'undefined' && !!window.wilsonSession

export async function saveSession(session) {
  if (!session) return
  if (hasBridge()) {
    await window.wilsonSession.save(session)
    return
  }
  // Renderer-only fallback for `npm run dev` outside Electron. NOT encrypted.
  // Never use in production; main process handles the real path.
  try {
    localStorage.setItem('wilson.dev.session', JSON.stringify(session))
  } catch { /* storage disabled */ }
}

export async function loadSession() {
  if (hasBridge()) {
    return window.wilsonSession.load()
  }
  try {
    const raw = localStorage.getItem('wilson.dev.session')
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
    localStorage.removeItem('wilson.dev.session')
  } catch { /* ignore */ }
}
