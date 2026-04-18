// =============================================================================
// WorkspaceSwitcher — Settings → General widget for switching between
// workspaces when the current user has more than one active membership.
//
// Hidden entirely when the user belongs to only one workspace.
//
// Flow on switch:
//   1. POST /functions/v1/issue-session with { workspace_id } + Bearer <access>
//   2. supabase.auth.refreshSession() so the JWT picks up the new
//      app_metadata.workspace_id + active app_role.
//   3. saveSession() writes the refreshed tokens via safeStorage.
//   4. window.location.reload() — the cleanest way to flush RabbitProvider,
//      adapter caches, and anything else that keyed off the old workspace.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { saveSession } from './sessionStorage'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

// Read the JWT payload without verifying it. The payload is advisory for
// UI — real enforcement happens at the DB via RLS.
function decodeJwtClaims(token) {
  try {
    const [, payload] = token.split('.')
    if (!payload) return {}
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return {} }
}

async function issueSession(accessToken, workspaceId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/issue-session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON,
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ workspace_id: workspaceId }),
  })
  if (!res.ok) throw new Error(`issue-session failed: ${res.status}`)
  return res.json()
}

export default function WorkspaceSwitcher() {
  const [loading, setLoading]         = useState(true)
  const [workspaces, setWorkspaces]   = useState([])
  const [activeWsId, setActiveWsId]   = useState(null)
  const [switchingId, setSwitchingId] = useState(null)
  const [error, setError]             = useState(null)

  // Load the user's workspaces + active selection from JWT + DB.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { if (!cancelled) setLoading(false); return }
        const claims = decodeJwtClaims(session.access_token)
        const active = claims?.app_metadata?.workspace_id ?? null
        const ids    = claims?.app_metadata?.workspace_ids ?? []

        // RLS restricts this to memberships the user has (see 0002_rls_workspaces.sql).
        const { data, error: fetchErr } = await supabase
          .from('workspaces')
          .select('id, name, slug')
          .order('name', { ascending: true })

        if (cancelled) return
        if (fetchErr) {
          setError(fetchErr.message)
          setLoading(false)
          return
        }

        // Preserve JWT ordering where possible — shows the user's
        // longest-standing workspace first, matching issue-session default.
        const byId = new Map((data ?? []).map(w => [w.id, w]))
        const ordered = ids.map(id => byId.get(id)).filter(Boolean)
        // Any DB rows not in the JWT list (shouldn't happen; belt+braces).
        for (const w of data ?? []) if (!ordered.find(x => x.id === w.id)) ordered.push(w)

        setWorkspaces(ordered)
        setActiveWsId(active)
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(err.message || String(err))
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleSwitch = useCallback(async (wsId) => {
    if (switchingId || wsId === activeWsId) return
    setSwitchingId(wsId)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No active session')
      await issueSession(session.access_token, wsId)
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession()
      if (refreshErr) throw refreshErr
      const s = refreshed?.session
      if (!s) throw new Error('refreshSession returned no session')
      await saveSession({
        access_token:  s.access_token,
        refresh_token: s.refresh_token,
        expires_at:    s.expires_at,
        user:          s.user,
      })
      // Reload so every provider re-reads the new JWT + RLS scope.
      window.location.reload()
    } catch (err) {
      setError(err.message || String(err))
      setSwitchingId(null)
    }
  }, [switchingId, activeWsId])

  const visible = useMemo(() => workspaces.length > 1, [workspaces])

  if (loading) return null
  if (!visible) return null

  return (
    <div>
      <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
        Active Workspace
      </h2>
      <p className="text-xs text-stone-950 mb-4 leading-relaxed">
        You belong to more than one workspace. Switching reloads the app so
        every view re-reads the new workspace's data.
      </p>
      <div className="flex flex-col gap-2">
        {workspaces.map(ws => {
          const active = ws.id === activeWsId
          const busy   = switchingId === ws.id
          return (
            <button
              key={ws.id}
              type="button"
              disabled={!!switchingId || active}
              onClick={() => handleSwitch(ws.id)}
              className="flex items-center gap-3 px-3 py-2 text-left rounded-sm transition-colors disabled:cursor-default"
              style={{
                backgroundColor: active ? 'rgba(234, 88, 12, 0.18)' : 'rgba(120, 70, 30, 0.18)',
                border: `2px solid ${active ? '#ea580c' : 'transparent'}`,
              }}
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: active ? '#ea580c' : 'transparent',
                  border: '2px solid #7c2d12',
                }}
              />
              <div className="flex flex-col flex-1">
                <span className="text-[12px] font-mono font-bold uppercase tracking-wider" style={{ color: '#1c1917' }}>
                  {ws.name}
                </span>
                <span className="text-[11px] font-mono" style={{ color: '#57534e' }}>
                  {ws.slug}
                </span>
              </div>
              {busy && (
                <span className="text-[11px] font-mono" style={{ color: '#1c1917' }}>
                  switching…
                </span>
              )}
              {active && !busy && (
                <span className="text-[11px] font-mono" style={{ color: '#1c1917' }}>
                  current
                </span>
              )}
            </button>
          )
        })}
      </div>
      {error && (
        <div className="mt-2 text-[11px] font-mono" style={{ color: '#991b1b' }}>
          {error}
        </div>
      )}
    </div>
  )
}
