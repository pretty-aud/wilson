// ============================================================
// useTaskTemplates — workspace-scoped task templates hook
// ============================================================
//
// Task templates are pre-defined sets of tasks that can be
// applied to an asset. They're stored globally at the workspace
// level, with an optional project_id for project-specific templates.
//
// Template shape:
//   { id, workspace_id, project_id (null=global), name, description,
//     tasks: [{ id, name, role_slug, bid_days, sort_order, depends_on: [id] }],
//     created_at, updated_at }

import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { usePermissions } from '../../permissions/usePermissions'

export function useTaskTemplates() {
  const rabbit = useRabbit()
  const perms = usePermissions()
  const getAdapter = rabbit?.getAdapter
  // Same trap as useRateCard — see the long note there. DEFAULT_WORKSPACE_ID
  // is the pre-multi-tenant seed constant and is refused by every
  // workspace-scoped RLS policy in cloud mode. Null claim -> local mode ->
  // the seed constant, which is correct there.
  const workspaceId = perms?.workspaceId || rabbit?.DEFAULT_WORKSPACE_ID
  const adapterMode = rabbit?.adapterMode
  const adapterStatus = rabbit?.adapterStatus

  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // ── Load templates on mount + on adapter mode change ──
  const loadTemplates = useCallback(async () => {
    if (!getAdapter || !workspaceId) return
    const adapter = getAdapter()
    if (!adapter?.listTaskTemplates) return
    setLoading(true)
    setError(null)
    try {
      let list = await adapter.listTaskTemplates(workspaceId)
      if (!Array.isArray(list)) list = []
      if (!mountedRef.current) return
      setTemplates(list)
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [getAdapter, workspaceId])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates, adapterMode, adapterStatus?.online])

  // ── Load templates available to a specific project (global + project-specific) ──
  const loadProjectTemplates = useCallback(async (projectId) => {
    if (!getAdapter || !projectId) return []
    const adapter = getAdapter()
    if (!adapter?.listProjectTaskTemplates) return []
    try {
      let list = await adapter.listProjectTaskTemplates(projectId)
      if (!Array.isArray(list)) list = []
      return list
    } catch (err) {
      if (mountedRef.current) setError(err.message || String(err))
      return []
    }
  }, [getAdapter])

  // ── Create template ──
  const addTemplate = useCallback(async (draft) => {
    if (!getAdapter || !workspaceId) return null
    const adapter = getAdapter()
    if (!adapter?.upsertTaskTemplate) return null
    const template = {
      id: draft.id || uuidv4(),
      workspace_id: workspaceId,
      name: draft.name || 'New Template',
      description: draft.description || '',
      project_id: draft.project_id || null,
      tasks: Array.isArray(draft.tasks) ? draft.tasks : [],
      ...draft,
      workspace_id: workspaceId,
    }
    setTemplates(prev => [...prev, template])
    try {
      const saved = await adapter.upsertTaskTemplate(template)
      const final = saved || template
      setTemplates(prev => prev.map(t => t.id === template.id ? { ...template, ...final } : t))
      return final
    } catch (err) {
      setTemplates(prev => prev.filter(t => t.id !== template.id))
      setError(err.message || String(err))
      throw err
    }
  }, [getAdapter, workspaceId])

  // ── Update template ──
  const updateTemplate = useCallback(async (id, patch) => {
    if (!getAdapter) return
    const adapter = getAdapter()
    if (!adapter?.updateTaskTemplate) return
    const snapshot = templates
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
    try {
      const saved = await adapter.updateTaskTemplate(id, patch)
      setTemplates(prev => prev.map(t => t.id === id ? { ...t, ...patch, ...saved } : t))
      return saved
    } catch (err) {
      setTemplates(snapshot)
      setError(err.message || String(err))
      throw err
    }
  }, [templates, getAdapter])

  // ── Delete template ──
  const deleteTemplate = useCallback(async (id) => {
    if (!getAdapter) return
    const adapter = getAdapter()
    if (!adapter?.deleteTaskTemplate) return
    const snapshot = templates
    setTemplates(prev => prev.filter(t => t.id !== id))
    try {
      await adapter.deleteTaskTemplate(id)
    } catch (err) {
      setTemplates(snapshot)
      setError(err.message || String(err))
      throw err
    }
  }, [templates, getAdapter])

  // ── Helper: compute template stats ──
  const getTemplateStats = useCallback((template) => {
    const tasks = template?.tasks || []
    return {
      taskCount: tasks.length,
      totalDays: tasks.reduce((sum, t) => sum + (t.bid_days || 0), 0),
    }
  }, [])

  return {
    workspaceId,
    templates,
    loading,
    error,
    reload: loadTemplates,
    loadProjectTemplates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    getTemplateStats,
  }
}
