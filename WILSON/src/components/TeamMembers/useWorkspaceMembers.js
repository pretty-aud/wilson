// ============================================================
// useWorkspaceMembers — cloud workspace membership hook
// ============================================================
//
// Session 4: the Team Members page is the single source of truth for
// workspace membership, backed by Supabase `workspace_members` (RLS-scoped)
// — NOT the RABBIT team_members JSON entity, which stays untouched for the
// RABBIT views until Session 6 unifies project assignment.
//
// Listing goes through the workspace_directory() RPC (migration 0010) so the
// UI can show emails (joined from auth.users, admin/manager callers only).
// If the RPC isn't deployed yet, we fall back to a plain workspace_members
// SELECT — same rows, email column absent.
//
// Row shape (from the RPC):
//   { workspace_id, user_id, app_role, username, display_name, pronouns,
//     title, department, avatar_url, is_active, onboarded_at, created_at,
//     email|null }
//
// Enforcement note: every mutation goes straight at workspace_members and
// relies on the DB (RLS policies + the 0010 guard trigger) as the real
// gate. The UI's PermissionGate/role checks are presentation only.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { usePermissions } from '../../permissions/usePermissions'
import { devFixtures } from '../../dev/devFixtures'

// Only render avatar images served from OUR storage bucket. avatar_url is
// member-writable text — an arbitrary external URL rendered to teammates
// would be a free tracking beacon.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const AVATAR_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/user-avatars/`
export function isOwnAvatarUrl(url) {
  // Dev fixtures (dev builds only): the dataset's avatars are generated SVG data
  // URIs. A data URI cannot beacon, so the tracking concern above does not apply.
  if (import.meta.env.DEV && devFixtures() && typeof url === 'string' && url.startsWith('data:image/svg+xml')) return true
  return typeof url === 'string' && !!SUPABASE_URL && url.startsWith(AVATAR_URL_PREFIX)
}

function sortMembers(list) {
  return [...list].sort((a, b) => {
    const an = (a.display_name || a.username || '').toLowerCase()
    const bn = (b.display_name || b.username || '').toLowerCase()
    return an.localeCompare(bn)
  })
}

// PostgREST error codes for "function does not exist" — the fallback path
// when migration 0010 hasn't reached this environment yet.
const MISSING_RPC_CODES = new Set(['PGRST202', '42883'])

export function useWorkspaceMembers() {
  const perms = usePermissions()
  const workspaceId = perms.workspaceId

  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // StrictMode-safe mounted flag: the effect BODY must reset the flag to
  // true, because StrictMode runs setup → cleanup → setup on the same
  // component instance — a cleanup-only effect leaves the ref false forever
  // and every post-fetch setState gets skipped (perpetual "Loading...").
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    try {
      // Dev fixtures (2026-09-11, dev builds only): the roster is the dataset's.
      const fx = import.meta.env.DEV ? devFixtures() : null
      if (fx?.workspace) {
        if (mountedRef.current) setMembers(sortMembers(fx.workspace.listMembers()))
        return
      }
      let rows = null
      const { data, error: rpcErr } = await supabase.rpc('workspace_directory')
      if (rpcErr) {
        if (!MISSING_RPC_CODES.has(rpcErr.code)) throw rpcErr
        // 0010 not deployed here yet — degrade to the RLS-scoped table read.
        const { data: fallback, error: selErr } = await supabase
          .from('workspace_members')
          .select('*')
          .eq('workspace_id', workspaceId)
        if (selErr) throw selErr
        rows = fallback
      } else {
        rows = data
      }
      if (!mountedRef.current) return
      setMembers(sortMembers(Array.isArray(rows) ? rows : []))
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { load() }, [load])

  // ── Mutations (optimistic, snapshot rollback) ──
  // The DB decides what's actually allowed; surfaced errors include the
  // guard-trigger messages ('self-role change not allowed', 'managers may
  // only edit title and department', ...).
  const updateMember = useCallback(async (userId, patch) => {
    if (!workspaceId) return null
    // Surgical rollback: snapshot ONLY the target row. Restoring the whole
    // list would revert other members' concurrently-saved edits (and any
    // rows refreshed by a load() that resolved while this request flew).
    const savedRow = members.find(m => m.user_id === userId) || null
    setMembers(prev => prev.map(m => m.user_id === userId ? { ...m, ...patch } : m))
    setError(null)
    try {
      // Dev fixtures (dev builds only): the edit lands in memory, same answer shape.
      const fx = import.meta.env.DEV ? devFixtures() : null
      const { data, error: updErr } = fx?.workspace
        ? fx.workspace.updateMember(userId, patch)
        : await supabase
          .from('workspace_members')
          .update(patch)
          .eq('workspace_id', workspaceId)
          .eq('user_id', userId)
          .select()
          .maybeSingle()
      if (updErr) throw updErr
      if (!data) throw new Error('Update was blocked — you may not have permission to edit this member.')
      if (mountedRef.current) {
        setMembers(prev => sortMembers(prev.map(m => m.user_id === userId ? { ...m, ...data } : m)))
      }
      return data
    } catch (err) {
      if (mountedRef.current) {
        if (savedRow) {
          setMembers(prev => sortMembers(prev.map(m => m.user_id === userId ? savedRow : m)))
        }
        setError(err.message || String(err))
      }
      throw err
    }
  }, [members, workspaceId])

  const setRole = useCallback(
    (userId, app_role) => updateMember(userId, { app_role }),
    [updateMember],
  )

  const setActive = useCallback(
    (userId, is_active) => updateMember(userId, { is_active }),
    [updateMember],
  )

  // Push a freshly-invited member into the list without a refetch. `row` is
  // the invite-member Edge Function's 201 body:
  //   { user_id, email, username, app_role, workspace_id }
  const injectMember = useCallback((row) => {
    if (!row?.user_id) return
    setMembers(prev => {
      if (prev.some(m => m.user_id === row.user_id)) return prev
      return sortMembers([...prev, {
        workspace_id: row.workspace_id,
        user_id:      row.user_id,
        app_role:     row.app_role || 'user',
        username:     row.username || '',
        display_name: row.display_name || row.username || '',
        pronouns:     null,
        title:        null,
        department:   null,
        avatar_url:   null,
        is_active:    true,
        onboarded_at: null,
        created_at:   null,
        email:        row.email ?? null,
      }])
    })
  }, [])

  return {
    ready: perms.ready,
    workspaceId,
    role: perms.role,
    userId: perms.userId,
    can: perms.can,
    members,
    loading,
    error,
    clearError: () => setError(null),
    reload: load,
    updateMember,
    setRole,
    setActive,
    injectMember,
  }
}
