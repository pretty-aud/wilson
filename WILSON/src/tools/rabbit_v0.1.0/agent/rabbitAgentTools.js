// ============================================================
// R.A.B.B.I.T. — agent tool surface
// ============================================================
//
// Exports `createRabbitAgentTools(rabbitInterface)` — a factory
// that returns the 8 agent-callable actions defined in §8 of the
// RABBIT v0.6 build prompt. Each handler is async and returns
// `{ success, diff, error }`.
//
// `rabbitInterface` is the live `useRabbit()` value (or a
// compatible shape) — it owns the optimistic mutators, adapter
// writes, and selectors. The handlers never touch the network
// directly; they delegate everything to the provider so undo,
// rollback, and the agent locked-entity gate keep working.

/**
 * @typedef {Object} RabbitAgentToolResult
 * @property {boolean} success
 * @property {object|null} [diff]
 * @property {string|null} [error]
 */

/**
 * @param {object} rabbitInterface  The value returned by `useRabbit()`.
 * @returns {Record<string, (args: object) => Promise<RabbitAgentToolResult>>}
 */
export function createRabbitAgentTools(rabbitInterface) {
  // Defensive: if a caller passes an empty interface, every action
  // becomes a clean no-op error rather than a runtime crash.
  const i = rabbitInterface || {}

  function ok(diff) { return { success: true, diff: diff || null, error: null } }
  function fail(error) { return { success: false, diff: null, error: String(error || 'unknown error') } }

  async function create_phase({ projectId, name, description, startDate, endDate, color } = {}) {
    try {
      if (!name) return fail('name is required')
      if (projectId && i.activeProjectId && projectId !== i.activeProjectId) {
        return fail(`active project mismatch (${projectId} vs ${i.activeProjectId})`)
      }
      if (!i.addPhase) return fail('rabbit interface not mounted')
      const created = await i.addPhase({
        name,
        description: description || '',
        start_date: startDate || null,
        end_date: endDate || null,
        color: color || null,
      })
      return ok({ kind: 'phase', created })
    } catch (err) {
      return fail(err?.message || err)
    }
  }

  async function create_asset({ projectId, phaseId, name, type, description, typeLabel } = {}) {
    try {
      if (!name) return fail('name is required')
      if (projectId && i.activeProjectId && projectId !== i.activeProjectId) {
        return fail(`active project mismatch (${projectId} vs ${i.activeProjectId})`)
      }
      if (!i.addAsset) return fail('rabbit interface not mounted')
      const created = await i.addAsset({
        phase_id: phaseId || null,
        name,
        type: type || 'other',
        description: description || '',
        type_label: typeLabel || null,
      })
      return ok({ kind: 'asset', created })
    } catch (err) {
      return fail(err?.message || err)
    }
  }

  async function create_task({
    assetId,
    title,
    description,
    status,
    priority,
    startDate,
    endDate,
    bidDays,
    assignedPosition,
    assignedRoleSlug,
  } = {}) {
    try {
      if (!assetId) return fail('assetId is required')
      if (!title) return fail('title is required')
      if (!i.addTask) return fail('rabbit interface not mounted')
      const created = await i.addTask({
        asset_id: assetId,
        title,
        description: description || '',
        status: status || 'not_started',
        priority: priority || 'med',
        start_date: startDate || null,
        end_date: endDate || null,
        bid_days: typeof bidDays === 'number' ? bidDays : null,
        assigned_position: assignedPosition || null,
        assigned_role_slug: assignedRoleSlug || null,
      })
      return ok({ kind: 'task', created })
    } catch (err) {
      return fail(err?.message || err)
    }
  }

  async function update_task({ taskId, patch } = {}) {
    try {
      if (!taskId) return fail('taskId is required')
      if (!patch || typeof patch !== 'object') return fail('patch must be an object')
      if (!i.updateTask) return fail('rabbit interface not mounted')
      const updated = await i.updateTask(taskId, patch)
      return ok({ kind: 'task', updated })
    } catch (err) {
      return fail(err?.message || err)
    }
  }

  async function set_dependency({ predecessorId, successorId, type, lagDays } = {}) {
    try {
      if (!predecessorId || !successorId) return fail('predecessorId + successorId required')
      if (!i.linkTasks) return fail('rabbit interface not mounted')
      const created = await i.linkTasks(
        predecessorId,
        successorId,
        type || 'FS',
        typeof lagDays === 'number' ? lagDays : 0
      )
      return ok({ kind: 'dependency', created })
    } catch (err) {
      return fail(err?.message || err)
    }
  }

  async function set_status({ entity, id, status } = {}) {
    try {
      if (!entity || !id || !status) return fail('entity, id, status all required')
      if (entity === 'task') {
        if (!i.updateTask) return fail('rabbit interface not mounted')
        const updated = await i.updateTask(id, { status })
        return ok({ kind: 'task', updated })
      }
      if (entity === 'asset') {
        if (!i.updateAsset) return fail('rabbit interface not mounted')
        const updated = await i.updateAsset(id, { status })
        return ok({ kind: 'asset', updated })
      }
      return fail(`unknown entity "${entity}"`)
    } catch (err) {
      return fail(err?.message || err)
    }
  }

  async function bulk_create_from_breakdown({ projectId, breakdown } = {}) {
    try {
      if (!breakdown) return fail('breakdown is required')
      if (projectId && i.activeProjectId && projectId !== i.activeProjectId) {
        return fail(`active project mismatch (${projectId} vs ${i.activeProjectId})`)
      }
      // The provider's acceptIngestion is the canonical bulk-write
      // path. The agent simply hands the breakdown over and lets
      // the user review the diff (Session 3 wires the DiffView in).
      if (!i.acceptIngestion) return fail('rabbit interface not mounted')
      const result = await i.acceptIngestion(null, breakdown)
      return ok({ kind: 'breakdown', result })
    } catch (err) {
      return fail(err?.message || err)
    }
  }

  async function summarize_project({ projectId } = {}) {
    try {
      if (projectId && i.activeProjectId && projectId !== i.activeProjectId) {
        return fail(`active project mismatch (${projectId} vs ${i.activeProjectId})`)
      }
      const phases = i.phases || []
      const assets = i.assets || []
      const tasks  = i.tasks  || []

      const statusCounts = {}
      for (const t of tasks) {
        const k = t.status || 'unknown'
        statusCounts[k] = (statusCounts[k] || 0) + 1
      }

      let budgetSummary = null
      if (i.selectProjectBudgetRollup) {
        try { budgetSummary = i.selectProjectBudgetRollup() } catch { /* ignore */ }
      }

      const summary = {
        projectId: i.activeProjectId,
        projectTitle: i.project?.title || null,
        phaseCount: phases.length,
        assetCount: assets.length,
        taskCount: tasks.length,
        statusCounts,
        budget: budgetSummary,
      }
      return ok({ kind: 'summary', summary })
    } catch (err) {
      return fail(err?.message || err)
    }
  }

  return {
    create_phase,
    create_asset,
    create_task,
    update_task,
    set_dependency,
    set_status,
    bulk_create_from_breakdown,
    summarize_project,
  }
}

/**
 * Resolve an agent action to a handler key. Used by the agent
 * runtime when the action object's `type` matches one of the
 * 8 known RABBIT actions.
 */
export const RABBIT_TOOL_NAMES = [
  'create_phase',
  'create_asset',
  'create_task',
  'update_task',
  'set_dependency',
  'set_status',
  'bulk_create_from_breakdown',
  'summarize_project',
]

export default createRabbitAgentTools
