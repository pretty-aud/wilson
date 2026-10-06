// ============================================================
// WILSON Dashboard — useMyTasks (Session 8)
// ============================================================
//
// Cross-project "my tasks" state for the Dashboard. The RABBIT provider's
// bundle only ever holds the OPEN project, so this hook owns its own task
// list: one indexed adapter query (tasks where I'm assignee or reviewer,
// with project/asset embeds for labels) plus the phase + roster lookups the
// views and TaskDetailPopup need.
//
// Liveness rides the Session 8 workspace channel via
// rabbit.subscribeWorkspaceEvents — relevant events debounce into a refetch
// (the query is cheap and RLS re-applies on every read). Cloud-only:
// local_server / google_drive adapters don't implement listMyTasks, so the
// hook resolves to a sensible empty state there.
//
// Write path: edits to a task of the ACTIVE project route through the
// provider's updateTask/deleteTask (undo history + pending-field LWW +
// undo toast). Tasks of other projects go straight to the adapter — the
// provider's machinery is bundle-scoped by design.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { usePermissions } from '../../permissions/usePermissions'

export function useMyTasks() {
  const rabbit = useRabbit()
  const perms = usePermissions()
  const adapterMode = rabbit?.adapterMode
  const getAdapter = rabbit?.getAdapter
  const subscribeWorkspaceEvents = rabbit?.subscribeWorkspaceEvents

  const [tasks, setTasks] = useState([])
  const [phases, setPhases] = useState([])
  const [roster, setRoster] = useState([]) // project_members rows for my projects
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // StrictMode-safe mounted flag: the effect BODY must reset the flag to
  // true (setup → cleanup → setup on the same instance).
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const reqSeqRef = useRef(0)

  const userId = perms?.userId ?? null
  const cloudReady = adapterMode === 'supabase' && !!userId

  const load = useCallback(async () => {
    const seq = ++reqSeqRef.current
    const adapter = typeof getAdapter === 'function' ? getAdapter() : null
    if (adapterMode !== 'supabase' || typeof adapter?.listMyTasks !== 'function') {
      setTasks([]); setPhases([]); setRoster([]); setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rows = await adapter.listMyTasks()
      if (!mountedRef.current || seq !== reqSeqRef.current) return
      const pids = [...new Set((rows || []).map(t => t.project_id).filter(Boolean))]
      const [phaseRows, rosterRows] = await Promise.all([
        typeof adapter.listPhasesByProjects === 'function'
          ? adapter.listPhasesByProjects(pids) : [],
        typeof adapter.listProjectMembersByProjects === 'function'
          ? adapter.listProjectMembersByProjects(pids) : [],
      ])
      if (!mountedRef.current || seq !== reqSeqRef.current) return
      setTasks(Array.isArray(rows) ? rows : [])
      setPhases(Array.isArray(phaseRows) ? phaseRows : [])
      setRoster(Array.isArray(rosterRows) ? rosterRows : [])
    } catch (err) {
      if (mountedRef.current && seq === reqSeqRef.current) {
        setError(err.message || String(err))
      }
    } finally {
      if (mountedRef.current && seq === reqSeqRef.current) setLoading(false)
    }
  }, [adapterMode, getAdapter])

  useEffect(() => { load() }, [load, userId])

  // Live refresh: workspace-channel events → debounced reload. Kept behind
  // refs so the subscription survives re-renders without re-subscribing.
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])
  const userIdRef = useRef(userId)
  useEffect(() => { userIdRef.current = userId }, [userId])
  // Asset + project id sets for the relevance filter below.
  const myIdsRef = useRef({ assetIds: new Set(), projectIds: new Set() })
  useEffect(() => {
    myIdsRef.current = {
      assetIds: new Set(tasks.map(t => t.asset_id).filter(Boolean)),
      projectIds: new Set(tasks.map(t => t.project_id).filter(Boolean)),
    }
  }, [tasks])

  useEffect(() => {
    if (typeof subscribeWorkspaceEvents !== 'function') return undefined
    let timer = null
    const unsub = subscribeWorkspaceEvents((evt) => {
      const uid = userIdRef.current
      const { assetIds, projectIds } = myIdsRef.current
      let relevant = false
      if (evt.op === 'RESYNC') {
        relevant = true // (re)join — close the missed-events window
      } else if (evt.table === 'tasks') {
        relevant = !!uid && [
          evt.record?.assignee_id, evt.record?.reviewer_id,
          evt.oldRecord?.assignee_id, evt.oldRecord?.reviewer_id,
        ].includes(uid)
      } else if (evt.table === 'projects') {
        relevant = true // rename/trash/restore changes labels or row visibility
      } else if (evt.table === 'assets') {
        // Transitive-hide path (review finding C1): trashing/restoring an
        // asset hides/reveals its tasks without touching any tasks row. A
        // restore's asset id can't be matched (its tasks aren't in our list
        // while hidden), so any deleted_at TRANSITION reloads; otherwise
        // only assets hosting our tasks matter (name/phase label changes).
        const deletedChanged =
          (evt.record?.deleted_at ?? null) !== (evt.oldRecord?.deleted_at ?? null)
        const id = evt.record?.id ?? evt.oldRecord?.id
        relevant = deletedChanged || (!!id && assetIds.has(id))
      } else if (evt.table === 'project_members') {
        // Role/staffing liveness (review finding M5): my seat changed, or
        // the roster of a project I have tasks on changed (staffed flag /
        // popup write gating).
        const pid = evt.record?.project_id ?? evt.oldRecord?.project_id
        const seatUid = evt.record?.user_id ?? evt.oldRecord?.user_id
        relevant = (!!uid && seatUid === uid) || (!!pid && projectIds.has(pid))
      }
      if (!relevant) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        loadRef.current()
      }, 400)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
    }
  }, [subscribeWorkspaceEvents])

  // ── writes ──────────────────────────────────────────────
  // Optimistic local patch either way; the provider path adds undo + LWW
  // pending-field protection when the task belongs to the open project.
  const patchTask = useCallback(async (id, patch) => {
    const task = tasks.find(t => t.id === id)
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
    try {
      if (task && rabbit?.activeProjectId && task.project_id === rabbit.activeProjectId
          && typeof rabbit.updateTask === 'function') {
        return await rabbit.updateTask(id, patch)
      }
      const adapter = typeof getAdapter === 'function' ? getAdapter() : null
      if (typeof adapter?.patchTask !== 'function') return null
      return await adapter.patchTask(id, patch)
    } catch (err) {
      setError(err.message || String(err))
      loadRef.current() // reconverge — the optimistic patch may be wrong now
      throw err
    }
  }, [tasks, rabbit, getAdapter])

  const deleteTask = useCallback(async (id) => {
    const task = tasks.find(t => t.id === id)
    setTasks(prev => prev.filter(t => t.id !== id))
    try {
      if (task && rabbit?.activeProjectId && task.project_id === rabbit.activeProjectId
          && typeof rabbit.deleteTask === 'function') {
        return await rabbit.deleteTask(id) // provider path → undo toast
      }
      const adapter = typeof getAdapter === 'function' ? getAdapter() : null
      if (typeof adapter?.deleteTask !== 'function') return null
      return await adapter.deleteTask(id) // soft_delete_row RPC
    } catch (err) {
      setError(err.message || String(err))
      // Reconverge from the server rather than restoring a snapshot — a
      // realtime-driven reload may have landed while the RPC was in
      // flight, and the captured array would clobber it (review finding).
      loadRef.current()
      throw err
    }
  }, [tasks, rabbit, getAdapter])

  // ── derived lookups ─────────────────────────────────────
  const projectsById = useMemo(() => {
    const out = {}
    for (const t of tasks) {
      if (t.project?.id && !out[t.project.id]) out[t.project.id] = t.project
    }
    return out
  }, [tasks])

  const phasesById = useMemo(() => {
    const out = {}
    for (const p of phases) out[p.id] = p
    return out
  }, [phases])

  const staffedByProject = useMemo(() => {
    const out = {}
    for (const r of roster) out[r.project_id] = true
    return out
  }, [roster])

  const myRoleByProject = useMemo(() => {
    const out = {}
    if (!userId) return out
    for (const r of roster) {
      if (r.user_id === userId) out[r.project_id] = r.project_role
    }
    return out
  }, [roster, userId])

  return {
    cloudReady,
    userId,
    tasks,
    phases,
    loading,
    error,
    reload: load,
    patchTask,
    deleteTask,
    projectsById,
    phasesById,
    staffedByProject,
    myRoleByProject,
  }
}
