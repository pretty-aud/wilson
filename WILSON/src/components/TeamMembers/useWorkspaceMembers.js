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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../cloud/auth/supabaseClient'
import { usePermissions } from '../../permissions/usePermissions'
import { devFixtures } from '../../dev/devFixtures'
import { createReadCache, useReadEntry } from '../../lib/readCache'

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


// ── F5 (shared B1, rabbit B1): ONE roster for every reader ───────────────────
// Before F5 every useWorkspaceMembers() held its own copy and called
// workspace_directory() itself (seven calls at an admin's launch, more on
// opening Scenes or the Timeline), and a member change reached only the two
// pages that listened for one. Now one module-level entry per signed-in
// person and company holds the rows (lib/readCache.js): readers that mount
// together share one read, and R.A.B.B.I.T.'s workspace channel reads it once
// more per workspace_members event or (re)join (noteRosterEvent, which the
// provider calls). useTeamMembers reads the same entry on the cloud.
//
// Keyed on the PERSON as well as the company (F4's rule): the RPC answers
// emails to admins, managers and the caller only, so an admin's roster must
// never be shown to the member who signs in after them in the same company.
const rosterCache = createReadCache({ empty: [] })
let rosterKeyNow = null
let rosterTimer = null
// The pages' own debounce before F5 (TeamMembersPage, DashboardPage).
const ROSTER_EVENT_MS = 400
const EMPTY_ROWS = Object.freeze([])

/** The roster's key for a person in a company; null when no company is claimed. */
export function rosterKeyFor(userId, workspaceId) {
  return workspaceId ? `cloud|${userId || '-'}|${workspaceId}` : null
}

function directoryReader(workspaceId) {
  return async () => {
    // Dev fixtures (2026-09-11, dev builds only): the roster is the dataset's.
    const fx = import.meta.env.DEV ? devFixtures() : null
    if (fx?.workspace) return sortMembers(fx.workspace.listMembers())
    const { data, error: rpcErr } = await supabase.rpc('workspace_directory')
    if (!rpcErr) return sortMembers(Array.isArray(data) ? data : [])
    if (!MISSING_RPC_CODES.has(rpcErr.code)) throw rpcErr
    // 0010 not deployed here yet — degrade to the RLS-scoped table read.
    const { data: fallback, error: selErr } = await supabase
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
    if (selErr) throw selErr
    return sortMembers(Array.isArray(fallback) ? fallback : [])
  }
}
const workspaceOfKey = (key) => key.slice(key.lastIndexOf('|') + 1)

/**
 * R.A.B.B.I.T.'s workspace channel, for the roster: a workspace_members
 * change, or the synthetic RESYNC every (re)join sends (the missed-events
 * window). Debounced into ONE read, however many arrive or readers there are.
 */
export function noteRosterEvent(evt) {
  if (evt?.op !== 'RESYNC' && evt?.table !== 'workspace_members') return
  const key = rosterKeyNow
  if (!key) return
  if (rosterTimer) clearTimeout(rosterTimer)
  rosterTimer = setTimeout(() => {
    rosterTimer = null
    if (rosterKeyNow === key) rosterCache.reload(key, directoryReader(workspaceOfKey(key)))
  }, ROSTER_EVENT_MS)
}

/** Test seam: the module-level roster forgets everything. */
export function __resetRosterCache() {
  if (rosterTimer) clearTimeout(rosterTimer)
  rosterTimer = null
  rosterKeyNow = null
  rosterCache.clear()
}

/**
 * The one roster entry for whoever is signed in: { key, rows, loading, error,
 * reload }. Used by useWorkspaceMembers and, on the cloud, by useTeamMembers.
 */
export function useRosterEntry(perms) {
  const workspaceId = perms?.workspaceId || null
  const key = rosterKeyFor(perms?.userId, workspaceId)
  const entry = useReadEntry(rosterCache, key)

  useEffect(() => {
    if (!key) {
      // Signed out (or not yet known): nothing of the last person's is kept.
      if (rosterKeyNow !== null) {
        rosterKeyNow = null
        rosterCache.retain(() => false)
      }
      return
    }
    if (rosterKeyNow !== key) {
      rosterKeyNow = key
      rosterCache.retain((k) => k === key)
    }
    rosterCache.ensure(key, directoryReader(workspaceId))
  }, [key, workspaceId])

  // S2's offline launch: the claims are the held session's and the read was
  // refused before the network. At the confirmation the one entry is read
  // once more, however many readers see it. (A drop and a return of the
  // network re-read it through the channel's RESYNC, noteRosterEvent.)
  const offline = !!perms?.offline
  useEffect(() => {
    if (key) rosterCache.noteOnline(key, !offline, directoryReader(workspaceId))
  }, [key, workspaceId, offline])

  const reload = useCallback(
    () => (key ? rosterCache.reload(key, directoryReader(workspaceId)) : Promise.resolve()),
    [key, workspaceId],
  )
  return { key, rows: entry.data || EMPTY_ROWS, loading: entry.loading, error: entry.error, reload }
}

export function useWorkspaceMembers() {
  const perms = usePermissions()
  const workspaceId = perms.workspaceId
  const { key, rows: members, loading, error, reload } = useRosterEntry(perms)

  const setRows = useCallback((fn) => rosterCache.mutate(key, fn), [key])
  // F5 review round 1: an edit's refusal is THIS reader's to show (the guard
  // trigger's words), not the one roster's: a shared error read as "the roster
  // failed to load" on every page and picker.
  const [writeError, setError] = useState(null)

  // ── Mutations (optimistic, snapshot rollback) ──
  // The DB decides what's actually allowed; surfaced errors include the
  // guard-trigger messages ('self-role change not allowed', 'managers may
  // only edit title and department', ...). They change the ONE roster, so
  // every reader sees the edit; an answer that arrives after the person
  // changed lands nowhere (the entry is theirs, by its key).
  const updateMember = useCallback(async (userId, patch) => {
    if (!workspaceId || !key) return null
    // Surgical rollback: snapshot ONLY the target row. Restoring the whole
    // list would revert other members' concurrently-saved edits (and any
    // rows refreshed by a read that resolved while this request flew).
    const savedRow = (rosterCache.peek(key).data || []).find(m => m.user_id === userId) || null
    setRows(prev => prev.map(m => m.user_id === userId ? { ...m, ...patch } : m))
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
      setRows(prev => sortMembers(prev.map(m => m.user_id === userId ? { ...m, ...data } : m)))
      return data
    } catch (err) {
      if (savedRow) setRows(prev => sortMembers(prev.map(m => m.user_id === userId ? savedRow : m)))
      setError(err.message || String(err))
      throw err
    }
  }, [key, workspaceId, setRows, setError])

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
    setRows(prev => {
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
  }, [setRows])

  const clearError = useCallback(() => setError(null), [])

  return useMemo(() => ({
    ready: perms.ready,
    workspaceId,
    role: perms.role,
    userId: perms.userId,
    can: perms.can,
    members,
    loading,
    error: writeError ?? error,
    clearError,
    reload,
    updateMember,
    setRole,
    setActive,
    injectMember,
  }), [perms.ready, workspaceId, perms.role, perms.userId, perms.can, members, loading, error, writeError,
    clearError, reload, updateMember, setRole, setActive, injectMember])
}

/**
 * The directory's rows in R.A.B.B.I.T.'s team-member shape: the cloud's
 * mapping, which supabaseAdapter.listTeamMembers made before F5 (that method
 * read the same RPC a second time per useRosterMembers).
 */
export function teamMembersFromDirectory(rows) {
  return (rows || [])
    .filter(r => r.is_active !== false)
    .map(r => ({
      id: r.user_id,                       // cloud identity IS the user id
      user_id: r.user_id,
      name: r.display_name || r.username || '(unnamed)',
      username: r.username,
      title: r.title || '',                // company job title
      department: r.department || '',
      avatar_url: r.avatar_url || null,
      email: r.email || null,
      app_role: r.app_role,
      // No cloud column. The local bundle carries it; defaulting keeps
      // CrewTeamTab's grouping working rather than rendering undefined.
      employment_type: 'fulltime',
    }))
}
