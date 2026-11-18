// ============================================================
// useTeamMembers — workspace-scoped team members hook
// ============================================================
//
// Workspace-level team member registry. Members can be assigned
// to projects and then to individual tasks within those projects.
//
// Fields per member:
//   { id, workspace_id, name, title, department, location,
//     email, pronouns (array), profile_picture_url,
//     created_at, updated_at }

import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { useRabbitOnline } from '../../tools/rabbit_v0.1.0/state/rabbitLive'
import { usePermissions } from '../../permissions/usePermissions'
import { createReadCache, useReadEntry, sourceId } from '../../lib/readCache'
import { useRosterEntry, teamMembersFromDirectory } from './useWorkspaceMembers'

export const DEFAULT_DEPARTMENTS = [
  'CG Art',
  'Production',
  'Creatives',
  'Post',
  'QA',
  'Audio',
  'Physical Production',
  'Development',
  'Executive',
  'Operations',
]

export const EMPLOYMENT_TYPES = [
  { value: 'fulltime',   label: 'Full-Time / Internal' },
  { value: 'freelancer', label: 'Freelancer' },
]
// ── F5 (shared B1, rabbit B1): one roster per mode, shared by every reader ──
// On the cloud the roster IS the workspace directory: this hook reads the
// one entry useWorkspaceMembers holds (no second workspace_directory() call,
// which supabaseAdapter.listTeamMembers made per mount before F5) and maps
// it onto the team-member shape. Elsewhere (the Local Server's registry) the
// adapter's listTeamMembers is read once per mode, person and company into
// one module-level entry, which every reader and every write shares.
const localCache = createReadCache({ empty: [] })
let localKeyNow = null
const NO_MEMBERS = Object.freeze([])

// The adapter object is part of the key: a switched (or, in a test, a new) adapter is a new entry.
const localKeyFor = (adapter, mode, userId, workspaceId) => (adapter && mode && workspaceId ? `${sourceId(adapter)}|${mode}|${userId || '-'}|${workspaceId}` : null)

function teamReader(getAdapter, workspaceId) {
  return async () => {
    const adapter = getAdapter?.()
    if (!adapter?.listTeamMembers) return []
    const list = await adapter.listTeamMembers(workspaceId)
    return Array.isArray(list) ? list : []
  }
}

/** Test seam: the module-level local roster forgets everything. */
export function __resetTeamMembersCache() {
  localKeyNow = null
  localCache.clear()
}

export function useTeamMembers() {
  const rabbit = useRabbit()
  const perms = usePermissions()
  const getAdapter = rabbit?.getAdapter
  // Same trap as useRateCard — see the long note there.
  // Gated on `ready` — see the long note in useRateCard.
  const workspaceId = perms?.ready
    ? (perms.workspaceId || rabbit?.DEFAULT_WORKSPACE_ID)
    : null
  const adapterMode = rabbit?.adapterMode
  // F4: the adapter's `online`, one word from a context of its own, and not
  // the status object off the value (rabbitLive.js). A new status that says
  // the same thing does not draw this hook's host.
  const adapterOnline = useRabbitOnline(rabbit)
  const cloud = adapterMode === 'supabase'

  // The cloud: the one directory entry (useWorkspaceMembers), mapped once per change.
  const directory = useRosterEntry(perms)
  const cloudMembers = useMemo(
    () => (cloud ? teamMembersFromDirectory(directory.rows) : NO_MEMBERS),
    [cloud, directory.rows],
  )

  // Elsewhere: the adapter's registry, one entry per mode, person and company.
  const localKey = cloud ? null : localKeyFor(getAdapter?.(), adapterMode, perms?.userId, workspaceId)
  const local = useReadEntry(localCache, localKey)
  useEffect(() => {
    if (!localKey) return
    // No adapter yet (the provider picks it after its first render), or one
    // with no registry (Drive): nothing is read, and nothing empty is kept
    // as the answer. `adapterOnline` brings this back once the adapter is up.
    if (!getAdapter?.()?.listTeamMembers) return
    if (localKeyNow !== localKey) {
      localKeyNow = localKey
      localCache.retain((k) => k === localKey)
    }
    localCache.ensure(localKey, teamReader(getAdapter, workspaceId))
  }, [localKey, getAdapter, workspaceId, adapterOnline])

  // The load ran again when the adapter came back online (before F5, per
  // reader, every time); now once per return after a failed read. (The
  // cloud's entry is re-read by the workspace channel's RESYNC instead.)
  useEffect(() => {
    if (localKey) localCache.noteOnline(localKey, adapterOnline, teamReader(getAdapter, workspaceId))
  }, [adapterOnline, localKey, getAdapter, workspaceId])

  const members = cloud ? cloudMembers : (local.data || NO_MEMBERS)
  const loading = cloud ? directory.loading : local.loading
  // F5 review round 1: an edit's refusal is this reader's (setError below).
  const [writeError, setWriteError] = useState(null)
  const error = writeError ?? (cloud ? directory.error : local.error)

  const reload = useCallback(() => {
    if (cloud) return directory.reload()
    return localKey ? localCache.reload(localKey, teamReader(getAdapter, workspaceId)) : Promise.resolve()
  }, [cloud, directory, localKey, getAdapter, workspaceId])

  // ── Mutations (optimistic) ──
  // The cloud adapter has no team-member writers (the Admin terminal owns
  // membership), so these feature-detect exactly as before and change the
  // one local entry, which every reader sees.
  const setMembers = useCallback((fn) => { if (localKey) localCache.mutate(localKey, fn) }, [localKey])
  const setError = setWriteError

  const addMember = useCallback(async (draft) => {
    if (!getAdapter || !workspaceId) return null
    const adapter = getAdapter()
    if (!adapter?.upsertTeamMember) return null
    const member = {
      id: draft.id || uuidv4(),
      workspace_id: workspaceId,
      name: draft.name || '',
      title: draft.title || '',
      department: draft.department || '',
      location: draft.location || '',
      email: draft.email || '',
      employment_type: draft.employment_type || 'fulltime',
      pronouns: Array.isArray(draft.pronouns) ? draft.pronouns : [],
      profile_picture_url: draft.profile_picture_url || null,
      ...draft,
      workspace_id: workspaceId,
    }
    setMembers(prev => [...prev, member])
    try {
      const saved = await adapter.upsertTeamMember(member)
      setMembers(prev => prev.map(m => m.id === member.id ? { ...member, ...saved } : m))
      return saved || member
    } catch (err) {
      setMembers(prev => prev.filter(m => m.id !== member.id))
      setError(err.message || String(err))
      throw err
    }
  }, [getAdapter, workspaceId, setMembers, setError])

  const updateMember = useCallback(async (id, patch) => {
    if (!getAdapter) return
    const adapter = getAdapter()
    if (!adapter?.updateTeamMember) return
    const snapshot = localKey ? localCache.peek(localKey).data : null
    setMembers(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))
    try {
      const saved = await adapter.updateTeamMember(id, patch)
      setMembers(prev => prev.map(m => m.id === id ? { ...m, ...patch, ...saved } : m))
      return saved
    } catch (err) {
      if (snapshot) setMembers(() => snapshot)
      setError(err.message || String(err))
      throw err
    }
  }, [getAdapter, localKey, setMembers, setError])

  const deleteMember = useCallback(async (id) => {
    if (!getAdapter) return
    const adapter = getAdapter()
    if (!adapter?.deleteTeamMember) return
    const snapshot = localKey ? localCache.peek(localKey).data : null
    setMembers(prev => prev.filter(m => m.id !== id))
    try {
      await adapter.deleteTeamMember(id)
    } catch (err) {
      if (snapshot) setMembers(() => snapshot)
      setError(err.message || String(err))
      throw err
    }
  }, [getAdapter, localKey, setMembers, setError])

  return {
    workspaceId,
    members,
    loading,
    error,
    reload,
    addMember,
    updateMember,
    deleteMember,
  }
}
