// =============================================================================
// Shared authenticated Supabase client for the renderer.
// Used by LoginScreen, supabaseAdapter, and any future cloud hook.
//
// persistSession: false  -> we manage persistence ourselves via
//                           sessionStorage.js (safeStorage in Electron,
//                           localStorage on the web — Session 12 settled the
//                           web strategy: a static host has no server to set
//                           an httpOnly cookie, so the web build persists the
//                           way every Supabase SPA does, in localStorage).
// autoRefreshToken: true -> the SDK handles refresh rotation for us. The
//                           TOKEN_REFRESHED hook below re-saves the rotated
//                           refresh token; without it a long-lived tab's
//                           stored session goes stale and the next boot
//                           silently lands on the login screen.
// =============================================================================

import { createClient } from '@supabase/supabase-js'
import { saveSession } from './sessionStorage'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  // Surface loudly at boot — missing env = nothing works.
  console.error('[wilson] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing. Check .env.development.')
}

export const supabase = createClient(url ?? '', anon ?? '', {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

// Keep the persisted copy current across refresh rotation (Session 12 web
// follow-up from Session 2's persistSession:false note). Sign-out clearing
// stays with the explicit logout flow — clearing here too would race it.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED' && session) {
    Promise.resolve(saveSession(session)).catch(() => { /* best-effort */ })
  }
})

// Hydrate the client from a previously-saved session. Called at boot from
// App.jsx once sessionStorage.loadSession() resolves.
export async function hydrateSupabase(session) {
  if (!session?.access_token || !session?.refresh_token) return null
  const { data, error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (error) {
    console.warn('[wilson] setSession failed:', error.message)
    return null
  }
  return data.session
}
