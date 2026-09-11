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
//
// ── UI overhaul D2 ──────────────────────────────────────────────────────────
// This widget mounts in ONE place: SettingsPage's General tab (SettingsPage
// .jsx:380). Settings is a LIGHT page (#f4a261, Q1 Option A), so unlike
// MfaSection — which is both a Settings panel AND a full-screen enrol gate —
// there is no dark branch here. Every value below is the light family.
//
// AUTH-14  The section header that opened this file — a 14px bold uppercase
//          widely-tracked h2 over a 12px paragraph — was byte-identical to
//          MfaSection's and one of 43 copies in src. (The class string itself
//          is quoted in the review, not here, so a grep audit counts the
//          remaining copies rather than this comment.)
//
//          It is now `AuthSectionTitle` from AuthShell: ONE implementation for
//          both auth surfaces that have the role, so the two cannot drift into
//          two hand-rolled versions — which is the outcome the first pass at
//          this actually produced. It draws a 1px `rule-light` hairline above,
//          24px of padding under it, an H2 at 16/600 sentence case with zero
//          tracking, and a 13px Dense description on a 60ch measure. That
//          export is a STAND-IN for `src/ui/SectionTitle` (Foundation 2, kit
//          request K2); when the kit has it, both callers move and the
//          stand-in is deleted.
//
// AUTH-25  Five `font-mono` uses; four were a name, a status word, a status
//          word and an error. ONE survives: the workspace SLUG, which is an
//          identifier (Q4 keeps mono for ids). LoginScreen.jsx:680 carries
//          the same slug and must make the same call.
//
// AUTH-15  The error was a seventh red, `#991b1b`, hand-typed. It now takes
//          the auth family's one error voice, AUTH_ERROR_STYLE — #7f1d1d,
//          measured at 4.86:1 on #f4a261 in AuthShell's own comment.
//
// State (active / busy) lives in `data-state` + Tailwind variants on
// mutually exclusive selectors, never in an inline style ternary, so a later
// class-based restyle cannot be silently outranked by a surviving inline
// style. Nothing here is a colour on a light surface except the one ink:
// the selected row is carried by its border, its dot fill and weight 600.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import { saveSession } from './sessionStorage'
import { AUTH_ERROR_STYLE, AuthSectionTitle } from './AuthShell'

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
      {/* AUTH-14 — the section-header role, from AuthShell so this file and
          MfaSection cannot drift apart again. It carries its own 16px of air
          below the block, which is why the list no longer adds `mt-4`. */}
      <AuthSectionTitle
        title="Active workspace"
        description="You belong to more than one workspace. Switching reloads the app so every view re-reads the new workspace's data."
      />
      <div className="flex flex-col gap-2">
        {workspaces.map(ws => {
          const active = ws.id === activeWsId
          const busy   = switchingId === ws.id
          const state  = active ? 'active' : 'idle'
          return (
            <button
              key={ws.id}
              type="button"
              data-state={state}
              disabled={!!switchingId || active}
              onClick={() => handleSwitch(ws.id)}
              className="flex items-center gap-3 px-3 py-2 text-left rounded-control border bg-well-light transition-colors disabled:cursor-default data-[state=idle]:border-rule-light data-[state=active]:border-ink-light"
            >
              {/* On light, status is a dot in the one ink — never a colour. */}
              <span
                data-state={state}
                className="w-3 h-3 rounded-full flex-shrink-0 border border-ink-light data-[state=idle]:bg-transparent data-[state=active]:bg-ink-light"
              />
              <div className="flex flex-col flex-1">
                <span
                  data-state={state}
                  className="text-body text-ink-light data-[state=idle]:font-normal data-[state=active]:font-semibold"
                >
                  {ws.name}
                </span>
                {/* The one surviving mono on this file: a slug is an id. */}
                <span className="text-caption font-mono text-ink-light">
                  {ws.slug}
                </span>
              </div>
              {busy && (
                <span className="text-label uppercase text-ink-light">
                  Switching…
                </span>
              )}
              {active && !busy && (
                <span className="text-label uppercase text-ink-light">
                  Current
                </span>
              )}
            </button>
          )
        })}
      </div>
      {error && (
        <div className="mt-3" style={AUTH_ERROR_STYLE}>
          {error}
        </div>
      )}
    </div>
  )
}
