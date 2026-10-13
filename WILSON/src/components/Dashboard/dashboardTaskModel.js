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
// the DB enum since 0019).
//
// 🚨 THIS FILE NO LONGER DECIDES A COLOUR. It used to carry `statusColor` and
// `priorityColor` — a verbatim copy of RABBIT's switch bodies (four such
// copies existed) — under a header comment claiming they "read correctly on
// WILSON's light pages too". Measured against the old #f4a261 ground that was
// false for eight of the nine statuses: #fb923c was 1.09:1 and the DEFAULT
// status's #a8a29e was 1.42:1, so the most common status dot in the app was
// effectively not drawn (review D3). The colour now comes from the kit's one
// semantic source, `src/ui/StatusDot`, which resolves a status to a TONE and
// lets the stylesheet pick the value per surface. A copy cannot drift from a
// source it does not have.

import { statusMeta } from '../../ui/StatusDot'

/**
 * The task table's column spec (review D13: "carry the width prop across as a
 * column-spec field"). It lives in this pure module rather than in the view so
 * that the sum can be asserted without mounting React.
 *
 * 🚨 THE WIDTHS MUST SUM TO EXACTLY 100. `table-layout: fixed` hands any
 * excess back to the browser to reconcile, so a set that over-sums is not a
 * declaration at all — every column lands somewhere other than where it was
 * written. F2 shipped three cuts of the Team Members table that each claimed
 * 100 in a comment and twice did not; `dashboardTaskModel.test.js` computes
 * this one instead of trusting it.
 *
 * The proportions are the review's: Task 3 / Project 2 / Asset 1.5 for the
 * three flexible columns, against 560px of fixed width before, which left the
 * most important column about 113px and truncating while the Status dropdown
 * gave up nothing.
 *
 * The five fixed columns were then MEASURED in the browser against the widest
 * value each can hold, because a percentage that is one character short is a
 * column that elides on the rows that matter: the first cut gave the dates
 * 8.5 percent, which is 105px, and "Sep 14, 2026" needs about 95px of text
 * plus 24px of cell padding. Status is sized for "Waiting to start", Role for
 * the "Reviewing" badge, Priority for "Medium".
 */
export const TASK_COLUMNS = Object.freeze([
  { key: 'title',    header: 'Task',     width: '21.7%' },
  { key: 'project',  header: 'Project',  width: '14.5%' },
  { key: 'asset',    header: 'Asset',    width: '10.8%' },
  { key: 'status',   header: 'Status',   width: '14.5%' },
  { key: 'priority', header: 'Priority', width: '8%' },
  { key: 'role',     header: 'Role',     width: '9.5%' },
  { key: 'start',    header: 'Start',    width: '10.5%', numeric: true },
  { key: 'end',      header: 'Due',      width: '10.5%', numeric: true },
])

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

/**
 * Priority as a STATUS TONE, not a colour. Four values became four hex
 * literals; they become two marked cases and two unmarked ones.
 *
 * Only `urgent` and `high` carry a tone. The review's instruction is
 * verbatim: "stop encoding priority with colour alone: render it as an 11px
 * label with a dark ink and reserve colour for the urgent and high cases
 * only." A scale where every step is coloured has no emphasis left to spend
 * on the step that matters, and 'low' in its own grey was 2.33:1.
 */
const PRIORITY_TONE = Object.freeze({
  urgent: 'danger',
  high:   'warning',
  medium: 'neutral',
  low:    'neutral',
})

export function priorityTone(p) {
  return PRIORITY_TONE[p] || 'neutral'
}

/** Sentence case, from one place (Q2). 'in_progress' -> 'In progress'. */
export function fmt(s) {
  const t = String(s ?? '').replace(/_/g, ' ')
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''
}

/** A status's written word, from the kit's semantic source and nowhere else. */
export function statusLabel(status) {
  return statusMeta(status).label
}

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
  // A status group's word is the kit's, so the band and the row's own badge
  // can never disagree about what a status is called.
  if (groupBy === 'status') return statusLabel(key)
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
