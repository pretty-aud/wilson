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

import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'

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

export const PRONOUN_OPTIONS = ['he', 'him', 'she', 'her', 'they', 'them']

export function useTeamMembers() {
  const rabbit = useRabbit()
  const getAdapter = rabbit?.getAdapter
  const workspaceId = rabbit?.DEFAULT_WORKSPACE_ID
  const adapterMode = rabbit?.adapterMode
  const adapterStatus = rabbit?.adapterStatus

  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // ── Load members on mount + on adapter mode change ──
  const loadMembers = useCallback(async () => {
    if (!getAdapter || !workspaceId) return
    const adapter = getAdapter()
    if (!adapter?.listTeamMembers) return
    setLoading(true)
    setError(null)
    try {
      let list = await adapter.listTeamMembers(workspaceId)
      if (!Array.isArray(list)) list = []
      if (!mountedRef.current) return
      setMembers(list)
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [getAdapter, workspaceId])

  useEffect(() => {
    loadMembers()
  }, [loadMembers, adapterMode, adapterStatus?.online])

  // ── Mutations (optimistic) ──
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
  }, [getAdapter, workspaceId])

  const updateMember = useCallback(async (id, patch) => {
    if (!getAdapter) return
    const adapter = getAdapter()
    if (!adapter?.updateTeamMember) return
    const snapshot = members
    setMembers(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))
    try {
      const saved = await adapter.updateTeamMember(id, patch)
      setMembers(prev => prev.map(m => m.id === id ? { ...m, ...patch, ...saved } : m))
      return saved
    } catch (err) {
      setMembers(snapshot)
      setError(err.message || String(err))
      throw err
    }
  }, [members, getAdapter])

  const deleteMember = useCallback(async (id) => {
    if (!getAdapter) return
    const adapter = getAdapter()
    if (!adapter?.deleteTeamMember) return
    const snapshot = members
    setMembers(prev => prev.filter(m => m.id !== id))
    try {
      await adapter.deleteTeamMember(id)
    } catch (err) {
      setMembers(snapshot)
      setError(err.message || String(err))
      throw err
    }
  }, [members, getAdapter])

  return {
    workspaceId,
    members,
    loading,
    error,
    reload: loadMembers,
    addMember,
    updateMember,
    deleteMember,
  }
}
