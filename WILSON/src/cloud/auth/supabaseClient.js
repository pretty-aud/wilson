// =============================================================================
// Shared authenticated Supabase client for the renderer.
// Used by LoginScreen, supabaseAdapter, and any future cloud hook.
//
// persistSession: false  -> we manage persistence ourselves via
//                           sessionStorage.js (safeStorage in Electron,
//                           httpOnly cookie on web in Session 10).
// autoRefreshToken: true -> the SDK handles refresh rotation for us.
// =============================================================================

import { createClient } from '@supabase/supabase-js'

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
