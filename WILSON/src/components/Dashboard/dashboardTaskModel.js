// ============================================================
// WILSON Dashboard — task view model (Session 8)
// ============================================================
//
// Pure filter/sort/group helpers for the Dashboard's task views — the
// RABBIT ProjectTasksView engine adapted for CROSS-project rows (embedded
// project/asset labels, a 'project' grouping, and a 'role' grouping that
// splits "assigned to me" from "reviewing"). Pure module: unit-tested,
// no React.
//
// Status/priority vocabularies match the RABBIT task views ('urgent' is in
// the DB enum since 0019). Status accent colors are the same semantic set
// RABBIT uses — they read correctly on WILSON's light pages too.

export const TASK_STATUSES = [
  'waiting_to_start', 'in_progress', 'pending_review', 'needs_revisions',
  'approved', 'final', 'blocked', 'on_hold', 'omitted',
]

export const PRIORITIES = ['low', 'medium', 'high', 'urgent']

export const GROUP_OPTIONS = [
  { key: 'status',   label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'project',  label: 'Project' },
  { key: 'phase',    label: 'Phase' },
  { key: 'role',     label: 'My role' },
]

export const SORT_OPTIONS = [
  { key: 'end_date',   label: 'Due date' },
  { key: 'start_date', label: 'Start date' },
  { key: 'title',      label: 'Title' },
  { key: 'status',     label: 'Status' },
  { key: 'priority',   label: 'Priority' },
  { key: 'project',    label: 'Project' },
  { key: 'updated_at', label: 'Updated' },
]

export const FILTER_FIELDS = [
  { key: 'status',     label: 'Status' },
  { key: 'priority',   label: 'Priority' },
  { key: 'project_id', label: 'Project' },
  { key: 'role',       label: 'My role' },
]

export const ROLE_KEYS = { assigned: 'assigned', reviewing: 'reviewing' }

export function statusColor(status) {
  switch (status) {
    case 'in_progress':     return '#fb923c'
    case 'pending_review':  return '#fbbf24'
    case 'needs_revisions': return '#e879f9'
    case 'approved':        return '#4ade80'
    case 'final':           return '#22c55e'
    case 'blocked':         return '#ef4444'
    case 'on_hold':         return '#fcd34d'
    case 'omitted':         return '#57534e'
    default:                return '#a8a29e' // waiting_to_start
  }
}

export function priorityColor(p) {
  switch (p) {
    case 'urgent': return '#ef4444'
    case 'high':   return '#fb923c'
    case 'medium': return '#fbbf24'
    case 'low':    return '#78716c'
    default:       return '#a8a29e'
  }
}

export function fmt(s) { return (s || '').replace(/_/g, ' ') }

/** 'assigned' | 'reviewing' | null for a task relative to the user. */
export function myRoleOnTask(task, userId) {
  if (!userId) return null
  if (task.assignee_id === userId) return ROLE_KEYS.assigned
  if (task.reviewer_id === userId) return ROLE_KEYS.reviewing
  return null
}

/**
 * Filters: text search over title + project title, then [{field, op, value}]
 * rows. `role` filters on myRoleOnTask; the rest read task columns.
 */
export function applyTaskFilters(tasks, { search = '', filters = [], userId = null } = {}) {
  let result = tasks
  const s = search.trim().toLowerCase()
  if (s) {
    result = result.filter(t =>
      (t.title || '').toLowerCase().includes(s)
      || (t.project?.title || '').toLowerCase().includes(s))
  }
  for (const f of filters) {
    if (!f.field) continue
    result = result.filter(t => {
      const val = f.field === 'role' ? myRoleOnTask(t, userId) : t[f.field]
      switch (f.op) {
        case 'is':     return val === f.value
        case 'is_not': return val !== f.value
        default:       return true
      }
    })
  }
  return result
}

export function applyTaskSort(tasks, { sortField = 'end_date', sortDir = 'asc' } = {}) {
  if (!sortField) return tasks
  const sorted = [...tasks]
  const dir = sortDir === 'desc' ? -1 : 1
  sorted.sort((a, b) => {
    let va, vb
    if (sortField === 'status') {
      va = TASK_STATUSES.indexOf(a.status); vb = TASK_STATUSES.indexOf(b.status)
    } else if (sortField === 'priority') {
      va = PRIORITIES.indexOf(a.priority); vb = PRIORITIES.indexOf(b.priority)
    } else if (sortField === 'project') {
      va = (a.project?.title || '').toLowerCase(); vb = (b.project?.title || '').toLowerCase()
    } else {
      va = a[sortField] ?? ''; vb = b[sortField] ?? ''
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase() }
    }
    // Empty values sink to the end regardless of direction (an undated
    // task shouldn't lead the "due soon" sort).
    const aEmpty = va === '' || va === -1
    const bEmpty = vb === '' || vb === -1
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  })
  return sorted
}

/**
 * Group into [{ key, label, tasks }]. Same shape drives the table's group
 * sections, the kanban columns and the gallery sections.
 */
export function groupTasks(tasks, groupBy, {
  projectsById = {}, phasesById = {}, userId = null,
} = {}) {
  const map = {}
  for (const t of tasks) {
    let key
    if (groupBy === 'status')        key = t.status || 'waiting_to_start'
    else if (groupBy === 'priority') key = t.priority || 'medium'
    else if (groupBy === 'project')  key = t.project_id || '__none__'
    else if (groupBy === 'phase')    key = t.asset?.phase_id || '__none__'
    else if (groupBy === 'role')     key = myRoleOnTask(t, userId) || '__none__'
    else key = '__all__'
    if (!map[key]) map[key] = []
    map[key].push(t)
  }

  let orderedKeys
  if (groupBy === 'status') {
    orderedKeys = [...TASK_STATUSES]
  } else if (groupBy === 'priority') {
    // Most urgent first — this is a "what's on fire" surface.
    orderedKeys = [...PRIORITIES].reverse()
  } else if (groupBy === 'role') {
    orderedKeys = [ROLE_KEYS.assigned, ROLE_KEYS.reviewing, '__none__']
  } else if (groupBy === 'project' || groupBy === 'phase') {
    orderedKeys = Object.keys(map).sort((a, b) => {
      const la = resolveGroupLabel(groupBy, a, { projectsById, phasesById }).toLowerCase()
      const lb = resolveGroupLabel(groupBy, b, { projectsById, phasesById }).toLowerCase()
      if (a === '__none__') return 1
      if (b === '__none__') return -1
      return la < lb ? -1 : la > lb ? 1 : 0
    })
  } else {
    orderedKeys = Object.keys(map)
  }

  return orderedKeys
    .map(key => ({
      key,
      label: resolveGroupLabel(groupBy, key, { projectsById, phasesById }),
      tasks: map[key] || [],
    }))
    // Cross-project boards would drown in empty columns — only status and
    // priority (finite, meaningful vocabularies) keep their empties.
    .filter(g => g.tasks.length > 0 || groupBy === 'status' || groupBy === 'priority')
}

export function resolveGroupLabel(groupBy, key, { projectsById = {}, phasesById = {} } = {}) {
  if (key === '__none__') {
    return groupBy === 'role' ? 'Other' : 'None'
  }
  if (groupBy === 'project') return projectsById[key]?.title || 'Unknown project'
  if (groupBy === 'phase')   return phasesById[key]?.name || 'Unknown phase'
  if (groupBy === 'role') {
    return key === ROLE_KEYS.assigned ? 'Assigned to me'
      : key === ROLE_KEYS.reviewing ? 'Reviewing' : fmt(key)
  }
  return fmt(key)
}

/**
 * Kanban drop → task patch. Only status and priority are drag-editable on
 * the Dashboard — a card can't be dragged into another project/phase/role
 * from here. Returns null when the group mode isn't drag-editable.
 */
export function buildGroupPatch(groupBy, targetKey) {
  if (groupBy === 'status')   return { status: targetKey === '__none__' ? 'waiting_to_start' : targetKey }
  if (groupBy === 'priority') return { priority: targetKey === '__none__' ? 'medium' : targetKey }
  return null
}
