// ============================================================
// RABBIT — ProjectTasksView
// ============================================================
//
// Full-featured task management view with two modes:
//
//   1. TABLE — spreadsheet-style rows with complex filtering,
//      sorting, grouping, inline-add blank rows per group,
//      and phase creation.
//
//   2. KANBAN — column-based card board grouped by a user-
//      chosen property (status default, or assignee/asset/
//      phase/type/priority). Shares the same filter & sort
//      engine as the table.
//
// Saved view profiles let users name and recall filter/sort/
// group/kanban configurations.
//
// ── UX Laws applied ──
// • Aesthetic-Usability Effect — polished surfaces, spacing, color harmony
// • Law of Common Region — cards & columns as clearly bounded groups
// • Law of Proximity — tight internal spacing, generous external gaps
// • Von Restorff Effect — status accent bars for instant recognition
// • Doherty Threshold — 150-200ms transitions on all interactive elements
// • Fitts's Law — larger touch targets, prominent primary actions
// • Law of Prägnanz — clean shapes, minimal decoration
// • Law of Similarity — consistent card/row treatment across views

import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import {
  ListChecks, Plus, Search, Filter, Trash2, X, FileText,
  ArrowUpDown, Diamond,
  ChevronDown, ChevronRight, Save, BookmarkPlus,
  CheckSquare, Square, MinusSquare,
  History, Download,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useRosterMembers } from '../../../components/TeamMembers/useRosterMembers'
import { usePermissions } from '../../../permissions/usePermissions'
import { canOnProject, projectActionDeniedReason } from '../../../permissions/projectRoleMatrix'
import GatedAction, { WriteReasonProvider, useWriteReason } from '../../../permissions/GatedAction'
import TaskDetailPopup from '../components/TaskDetailPopup'
import NewTaskPopup from '../components/NewTaskPopup'
import EditHistoryDrawer from '../components/EditHistoryDrawer'
import { downloadCsv, exportDateStamp } from '../../../lib/csvExport'
import {
  Stat, Toolbar, Button, IconButton, Tabs, Table, Th, Td, Row, Dialog,
  HoverActions, EmptyState, Badge, StatusDot, statusMeta, humanizeStatus,
} from '../../../ui'
// Priority as a status TONE, from the one place that decides it: the
// Dashboard's task table shows the same tasks and must not say otherwise.
import { priorityTone } from '../../../components/Dashboard/dashboardTaskModel'
import './rabbitTasks.css'

// ── Constants ──
const TASK_STATUSES = [
  'waiting_to_start','in_progress','pending_review','needs_revisions',
  'approved','final','blocked','on_hold','omitted',
]

const PRIORITIES = ['low','medium','high','urgent']

const GROUPABLE_FIELDS = [
  { value: '',        label: 'No grouping' },
  { value: 'status',  label: 'Status' },
  { value: 'asset',   label: 'Asset' },
  { value: 'phase',   label: 'Phase' },
  { value: 'priority',label: 'Priority' },
  { value: 'assignee',label: 'Assignee' },
]

const SORTABLE_FIELDS = [
  { value: 'title',      label: 'Title' },
  { value: 'status',     label: 'Status' },
  { value: 'priority',   label: 'Priority' },
  { value: 'start_date', label: 'Start date' },
  { value: 'end_date',   label: 'End date' },
  { value: 'bid_days',   label: 'Bid days' },
  { value: 'created_at', label: 'Created' },
]

const FILTER_FIELDS = [
  { value: 'status',      label: 'Status',   type: 'select', options: TASK_STATUSES },
  { value: 'priority',    label: 'Priority', type: 'select', options: PRIORITIES },
  { value: 'asset_id',    label: 'Asset',    type: 'select', dynamic: 'assets' },
  { value: 'phase_id',    label: 'Phase',    type: 'select', dynamic: 'phases' },
  { value: 'assignee_id', label: 'Assignee', type: 'select', dynamic: 'members' },
  { value: 'title',       label: 'Title',    type: 'text' },
]

const FILTER_OPS = {
  select: [
    { value: 'is',        label: 'is' },
    { value: 'is_not',    label: 'is not' },
    { value: 'is_empty',  label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  text: [
    { value: 'contains',     label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'is',           label: 'is' },
    { value: 'is_not',       label: 'is not' },
    { value: 'is_empty',     label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
}

const SAVED_VIEWS_KEY = 'rabbit_task_saved_views'

// The body the Table / Board tabs switch (the kit's Tabs wants its panel).
const BODY_ID = 'rb-task-body'

// Sentence-case labels (Q2). A status's words come from the kit's one status
// source (src/ui/StatusDot), so this table, the Dashboard and the popup say
// the same thing; the old `fmt()` lower-cased every one of them.
const STATUS_LABELS = Object.fromEntries(TASK_STATUSES.map(s => [s, statusMeta(s).label]))
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' }
function optionLabel(field, value) {
  if (field === 'status') return STATUS_LABELS[value] || humanizeStatus(value)
  if (field === 'priority') return PRIORITY_LABELS[value] || humanizeStatus(value)
  return fmt(value)
}

// ── Colour ──
// Status and priority colours live in rabbitTasks.css (`.rb-task-status`,
// `.rb-task-priority`): an element carries `data-status` / `data-priority`
// and reads the colour from the sheet, never from an inline style.

function fmt(s) { return (s || '').replace(/_/g, ' ') }

// A stored date (YYYY-MM-DD) as the date inputs beside it show one: the
// system's short date. A key date used to print its raw ISO string in the
// mono next to task dates reading 08/03/2026 (review round one).
function showDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return iso || '—'
  return new Date(+m[1], +m[2] - 1, +m[3])
    .toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// ─────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────
export default function ProjectTasksView() {
  const ctx = useRabbit()
  // Assignee resolution goes through the unified roster (Session 6) —
  // auth users in cloud mode, legacy team members locally. Mirrors
  // TaskDetailPopup so the ids shown here match what it writes to
  // task.assignee_id.
  const { members: rosterMembers, mode: rosterMode } = useRosterMembers()
  const tasks   = ctx?.tasks   || []
  const assets  = ctx?.assets  || []
  const phases  = ctx?.phases  || []
  const project = ctx?.project
  const milestones = ctx?.milestones || []
  const teamAssignments = ctx?.teamAssignments || []

  // Lookups
  const assetById = useMemo(() => {
    const m = {}; for (const a of assets) m[a.id] = a; return m
  }, [assets])

  const phaseById = useMemo(() => {
    const m = {}; for (const p of phases) m[p.id] = p; return m
  }, [phases])

  const memberById = useMemo(() => {
    const m = {}; for (const mb of rosterMembers) m[mb.id] = mb; return m
  }, [rosterMembers])

  const projectMembers = useMemo(() => {
    if (rosterMode === 'supabase') {
      // Cloud — project staffing lives in project_members (auth user_ids).
      // Unstaffed projects fall back to the whole workspace roster.
      if (!ctx?.projectIsStaffed) return rosterMembers
      const staffedIds = new Set((ctx?.projectMembers || []).map(pm => pm.user_id))
      return rosterMembers.filter(m => staffedIds.has(m.id))
    }
    // Local / drive — legacy RABBIT team assignments.
    return teamAssignments.map(a => memberById[a.member_id]).filter(Boolean)
  }, [rosterMode, rosterMembers, ctx?.projectIsStaffed, ctx?.projectMembers, teamAssignments, memberById])

  // ── View state ──
  const [viewMode, setViewMode] = useState('table') // table | kanban
  const [search, setSearch]     = useState('')
  const [filters, setFilters]   = useState([])  // [{ field, op, value }]
  const [sortField, setSortField]   = useState('')
  const [sortDir, setSortDir]       = useState('asc')
  const [groupBy, setGroupBy]       = useState('')
  const [kanbanGroup, setKanbanGroup] = useState('status')
  const [showFilterPanel, setShowFilterPanel] = useState(false)

  // Saved views
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || '[]') } catch { return [] }
  })
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')

  // Phase creation
  const [showPhaseCreate, setShowPhaseCreate] = useState(false)
  const [newPhaseName, setNewPhaseName] = useState('')

  // Task detail popup
  const [detailTaskId, setDetailTaskId] = useState(null)
  // Session 23: null = closed. An object = the popup is open, seeded with the
  // defaults its trigger passed (group add-rows supply phase_id/asset_id/etc).
  // Nothing is written until Confirm & Create.
  const [newTaskDraft, setNewTaskDraft] = useState(null)

  // Edit history (Session 5) — DB-side RLS is the real gate; this only
  // hides the affordance below manager.
  const { can, role, ready: permsReady } = usePermissions()
  const canViewHistory = can('rabbit.history.view')
  const [historyTaskId, setHistoryTaskId] = useState(null)

  // Entity writes (Session 6) — DB-side RLS is the real gate; this only
  // hides write affordances for staffed-project reviewers.
  // `ready` matters: without it, a session read still in flight leaves `role`
  // null and every New task affordance in this view — toolbar, add-rows,
  // per-group rows, row menu, both kanban adds — silently disappears.
  //
  // Session 29 — these controls used to VANISH when canWrite was false. They
  // now stay visible, greyed, and say why (Audrey, 2026-08-04: "keep button
  // gray and explain why"), so this screen and the Timeline behave the same
  // way. `writeReason` reaches the leaves through WriteReasonProvider below
  // rather than eight more prop signatures.
  const writeGateCtx = {
    appRole: role,
    projectRole: ctx?.myProjectRole,
    isStaffed: ctx?.projectIsStaffed,
    ready: permsReady,
  }
  const canWrite = canOnProject(writeGateCtx, 'project.entity.write')
  const writeReason = projectActionDeniedReason(writeGateCtx, 'project.entity.write')

  // Collapsed groups
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  function toggleGroup(key) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── Filtering ──
  const applyFilters = useCallback((taskList) => {
    let result = taskList
    // Text search
    const s = search.trim().toLowerCase()
    if (s) result = result.filter(t => (t.title || '').toLowerCase().includes(s))
    // Complex filters
    for (const f of filters) {
      if (!f.field) continue
      result = result.filter(t => {
        const val = t[f.field]
        switch (f.op) {
          case 'is':           return val === f.value
          case 'is_not':       return val !== f.value
          case 'is_empty':     return !val
          case 'is_not_empty': return !!val
          case 'contains':     return (val || '').toLowerCase().includes((f.value || '').toLowerCase())
          case 'not_contains': return !(val || '').toLowerCase().includes((f.value || '').toLowerCase())
          default: return true
        }
      })
    }
    return result
  }, [search, filters])

  // ── Sorting ──
  const applySort = useCallback((taskList) => {
    if (!sortField) return taskList
    const sorted = [...taskList]
    const dir = sortDir === 'desc' ? -1 : 1
    sorted.sort((a, b) => {
      let va = a[sortField] ?? ''
      let vb = b[sortField] ?? ''
      if (sortField === 'status') {
        va = TASK_STATUSES.indexOf(va); vb = TASK_STATUSES.indexOf(vb)
      } else if (sortField === 'priority') {
        va = PRIORITIES.indexOf(va); vb = PRIORITIES.indexOf(vb)
      } else if (typeof va === 'string') {
        va = va.toLowerCase(); vb = (vb || '').toLowerCase()
      }
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
    return sorted
  }, [sortField, sortDir])

  const processed = useMemo(() => applySort(applyFilters(tasks)), [tasks, applyFilters, applySort])

  // ── CSV export (Session 14, Block B) — exports the CURRENT view
  // (filters + sort applied): what you see is what you get. Tasks carry
  // no rate/budget data, so every project reader may export them; the
  // rows themselves arrived through RLS-scoped reads.
  const handleExportCsv = useCallback(() => {
    const memberName = (id) => {
      const m = memberById[id]
      return m ? (m.display_name || m.name || m.username || '') : ''
    }
    const stem = (project?.title || 'project').replace(/[^\w.-]+/g, '_')
    downloadCsv(`${stem}-tasks-${exportDateStamp()}.csv`, processed, [
      { key: 'title',      header: 'Task' },
      { key: 'status',     header: 'Status' },
      { key: 'priority',   header: 'Priority' },
      { key: 'assignee',   header: 'Assignee', map: t => memberName(t.assignee_id) },
      { key: 'phase',      header: 'Phase',    map: t => phaseById[t.phase_id]?.name || '' },
      { key: 'start_date', header: 'Start' },
      { key: 'end_date',   header: 'End' },
      { key: 'notes',      header: 'Notes' },
      { key: 'created_at', header: 'Created' },
    ])
  }, [processed, memberById, phaseById, project?.title])

  // ── All milestones (user + project bounds) ──
  const allMilestones = useMemo(() => {
    const list = [...milestones]
    if (project?.start_date) {
      list.push({ id: '__project_start__', title: 'Project start', date: project.start_date, color: 'var(--color-success)', isProjectBound: true })
    }
    if (project?.end_date) {
      list.push({ id: '__project_end__', title: 'Project end', date: project.end_date, color: 'var(--color-danger)', isProjectBound: true })
    }
    return list
  }, [milestones, project?.start_date, project?.end_date])

  // ── Grouping (table) ──
  const groups = useMemo(() => {
    const g = groupBy
    if (!g) return null
    const map = {}
    for (const t of processed) {
      let key
      if (g === 'status')   key = t.status || 'waiting_to_start'
      else if (g === 'asset')    key = t.asset_id || '__none__'
      else if (g === 'phase')    key = t.phase_id || '__none__'
      else if (g === 'priority') key = t.priority || 'medium'
      else if (g === 'assignee') key = t.assignee_id || '__none__'
      else key = '__all__'
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    // Ordered keys
    let orderedKeys
    if (g === 'status')   orderedKeys = TASK_STATUSES.filter(s => map[s])
    else if (g === 'priority') orderedKeys = PRIORITIES.filter(p => map[p])
    else if (g === 'phase') {
      // When sorting is active, sort phases by the sort field too
      let phaseOrder = phases.map(p => p.id).filter(id => map[id])
      if (sortField && (sortField === 'start_date' || sortField === 'end_date' || sortField === 'title' || sortField === 'created_at')) {
        const dir = sortDir === 'desc' ? -1 : 1
        phaseOrder.sort((a, b) => {
          const pa = phaseById[a], pb = phaseById[b]
          if (!pa || !pb) return 0
          let va, vb
          if (sortField === 'start_date') { va = pa.start_date || ''; vb = pb.start_date || '' }
          else if (sortField === 'end_date') { va = pa.end_date || ''; vb = pb.end_date || '' }
          else if (sortField === 'title') { va = (pa.name || '').toLowerCase(); vb = (pb.name || '').toLowerCase() }
          else { va = pa.created_at || ''; vb = pb.created_at || '' }
          if (va < vb) return -1 * dir
          if (va > vb) return 1 * dir
          return 0
        })
      }
      orderedKeys = phaseOrder
      if (map.__none__) orderedKeys.push('__none__')
    } else if (g === 'asset') {
      orderedKeys = assets.map(a => a.id).filter(id => map[id])
      if (map.__none__) orderedKeys.push('__none__')
    } else if (g === 'assignee') {
      orderedKeys = projectMembers.map(m => m.id).filter(id => map[id])
      if (map.__none__) orderedKeys.push('__none__')
    } else {
      orderedKeys = Object.keys(map)
    }
    // Add empty groups for keys with no items (so user sees all columns)
    if (g === 'status') TASK_STATUSES.forEach(s => { if (!orderedKeys.includes(s)) orderedKeys.push(s) })
    return orderedKeys.map(key => ({
      key,
      label: resolveGroupLabel(g, key),
      tasks: map[key] || [],
    }))
  }, [processed, groupBy, phases, assets, projectMembers, phaseById, assetById, memberById, sortField, sortDir])

  // Kanban groups
  const kanbanGroups = useMemo(() => {
    const g = kanbanGroup
    const map = {}
    for (const t of processed) {
      let key
      if (g === 'status')   key = t.status || 'waiting_to_start'
      else if (g === 'asset')    key = t.asset_id || '__none__'
      else if (g === 'phase')    key = t.phase_id || '__none__'
      else if (g === 'priority') key = t.priority || 'medium'
      else if (g === 'assignee') key = t.assignee_id || '__none__'
      else key = '__all__'
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    let orderedKeys
    if (g === 'status')   orderedKeys = [...TASK_STATUSES]
    else if (g === 'priority') orderedKeys = [...PRIORITIES]
    else if (g === 'phase') {
      orderedKeys = phases.map(p => p.id)
      orderedKeys.push('__none__')
    } else if (g === 'asset') {
      orderedKeys = assets.map(a => a.id)
      orderedKeys.push('__none__')
    } else if (g === 'assignee') {
      orderedKeys = projectMembers.map(m => m.id)
      orderedKeys.push('__none__')
    } else {
      orderedKeys = Object.keys(map)
    }
    return orderedKeys.map(key => ({
      key,
      label: resolveGroupLabel(g, key),
      tasks: map[key] || [],
    }))
  }, [processed, kanbanGroup, phases, assets, projectMembers, phaseById, assetById, memberById])

  function resolveGroupLabel(field, key) {
    if (key === '__none__') return 'Unassigned'
    if (field === 'asset')    return assetById[key]?.name || key
    if (field === 'phase')    return phaseById[key]?.name || key
    if (field === 'assignee') return memberById[key]?.name || key
    return optionLabel(field, key)
  }

  // ── Task creation ──
  // Session 23: open a draft popup; write nothing until the user confirms.
  // Audrey asked for this shape explicitly, matching New Asset — "nothing is
  // saved until you confirm". The first cut created the row and then opened
  // the detail popup on it, which left an untitled task behind whenever the
  // popup was dismissed.
  //
  // Every add affordance routes through here — the toolbar, the table
  // add-rows, the per-group rows and both kanban adds — so the group defaults
  // those triggers pass (phase_id when grouped by phase, asset_id when grouped
  // by asset, and so on) become the popup's seed values rather than being
  // written blind.
  function handleAddTask(defaults = {}) {
    if (!ctx?.addTask) return
    setNewTaskDraft(defaults || {})
  }

  // ── Phase creation ──
  async function handleCreatePhase() {
    if (!newPhaseName.trim() || !ctx?.addPhase) return
    await ctx.addPhase({ name: newPhaseName.trim() })
    setNewPhaseName('')
    setShowPhaseCreate(false)
  }

  // ── Saved views ──
  function saveCurrentView() {
    if (!saveName.trim()) return
    const view = {
      id: Date.now().toString(),
      name: saveName.trim(),
      filters, sortField, sortDir, groupBy, kanbanGroup, viewMode,
    }
    const next = [...savedViews, view]
    setSavedViews(next)
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next))
    setSaveName('')
    setShowSaveDialog(false)
  }

  function loadView(view) {
    setFilters(view.filters || [])
    setSortField(view.sortField || '')
    setSortDir(view.sortDir || 'asc')
    setGroupBy(view.groupBy || '')
    setKanbanGroup(view.kanbanGroup || 'status')
    if (view.viewMode) setViewMode(view.viewMode)
  }

  function deleteSavedView(id) {
    const next = savedViews.filter(v => v.id !== id)
    setSavedViews(next)
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next))
  }

  // ── Filter CRUD ──
  function addFilter() {
    setFilters(prev => [...prev, { field: 'status', op: 'is', value: '' }])
  }
  function updateFilter(idx, patch) {
    setFilters(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }
  function removeFilter(idx) {
    setFilters(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Summary computations ──
  const taskSummary = useMemo(() => {
    const completed = tasks.filter(t => t.status === 'approved' || t.status === 'final').length
    const omitted = tasks.filter(t => t.status === 'omitted').length
    const remaining = tasks.length - completed - omitted

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let daysRemaining = '—'
    let daysPassed = '—'

    if (project?.end_date) {
      const end = new Date(project.end_date)
      end.setHours(0, 0, 0, 0)
      const diff = Math.ceil((end - today) / (1000 * 60 * 60 * 24))
      daysRemaining = Math.max(diff, 0)
    }

    if (project?.start_date) {
      const start = new Date(project.start_date)
      start.setHours(0, 0, 0, 0)
      const diff = Math.ceil((today - start) / (1000 * 60 * 60 * 24))
      daysPassed = Math.max(diff, 0)
    }

    return { remaining, completed, daysRemaining, daysPassed }
  }, [tasks, project?.start_date, project?.end_date])

  // ── Render ──
  if (!project) {
    return (
      <div className="rb-task-view h-full flex items-center justify-center">
        <span className="text-label uppercase">No project loaded</span>
      </div>
    )
  }

  return (
    <WriteReasonProvider reason={writeReason}>
    <div className="rb-task-view h-full flex flex-col">

      {/* ── Summary tiles (always visible): the kit's Stat, value under its
          label, the same tile Summary's band uses (review R19, R43). ── */}
      <div className="rb-task-stats">
        <Stat className="rb-task-stat" label="Tasks remaining" value={taskSummary.remaining} />
        <Stat className="rb-task-stat" label="Days remaining" value={taskSummary.daysRemaining} />
        <Stat className="rb-task-stat" label="Tasks completed" value={taskSummary.completed} valueTone="success" />
        <Stat className="rb-task-stat" label="Days passed" value={taskSummary.daysPassed} />
      </div>

      {/* ── Toolbar: every control the 28px sm height, one baseline (R14).
          It wraps rather than clipping below about 1300px: thirteen controls
          do not fit one row at Electron's 1024px floor. ── */}
      <Toolbar
        wrap
        className="rb-task-toolbar"
        right={(
          <>
            <span className="rb-task-count">
              {processed.length}/{tasks.length}
            </span>

            {/* Export the current view (Session 14) — one button beside the
                existing toolbar, no new nav (session UI-restraint rule). */}
            <Button
              size="sm"
              variant="ghost"
              Icon={Download}
              onClick={handleExportCsv}
              disabled={processed.length === 0}
              title={processed.length === 0 ? 'Nothing to export in the current view' : 'Export the current view as CSV'}
            >
              Export
            </Button>

            {/* Session 29 — these three used to disappear together, leaving
                Export sitting in New task's pixel position. That is the "the
                button says export" sighting that opened the S23 investigation:
                nothing had been relabelled, three controls had been removed from
                a flex row. They now grey out in place, which removes the
                illusion as well as the confusion. */}
            <GatedAction allowed={canWrite}>
              {/* Phase create */}
              <Button size="sm" Icon={Plus} onClick={() => setShowPhaseCreate(true)}>
                Phase
              </Button>
            </GatedAction>

            <GatedAction allowed={canWrite}>
              {/* Key date create */}
              <Button size="sm" Icon={Diamond} onClick={() => ctx?.addMilestone?.({ title: '', date: new Date().toISOString().slice(0, 10) })}>
                Key date
              </Button>
            </GatedAction>

            <GatedAction allowed={canWrite}>
              <Button size="sm" variant="primary" Icon={Plus} onClick={() => handleAddTask()}>
                New task
              </Button>
            </GatedAction>
          </>
        )}
      >
        {/* Filter */}
        <Button
          size="sm"
          Icon={Filter}
          className="rb-task-tool"
          data-active={filters.length > 0 ? 'true' : 'false'}
          aria-expanded={showFilterPanel}
          onClick={() => setShowFilterPanel(!showFilterPanel)}
        >
          Filter{filters.length > 0 ? ` (${filters.length})` : ''}
        </Button>

        {/* Sort */}
        <span className="rb-task-sort">
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            aria-label="Sort"
            className="ui-input rb-task-tool"
            data-size="sm"
            data-active={sortField ? 'true' : 'false'}>
            <option value="">Sort…</option>
            {SORTABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          {sortField && (
            <IconButton
              size="sm"
              Icon={ArrowUpDown}
              title={sortDir === 'asc' ? 'Sorted ascending — reverse' : 'Sorted descending — reverse'}
              onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            />
          )}
        </span>

        <span className="rb-task-divider" aria-hidden="true" />

        {/* Group */}
        <select value={viewMode === 'kanban' ? kanbanGroup : groupBy}
          onChange={e => viewMode === 'kanban' ? setKanbanGroup(e.target.value) : setGroupBy(e.target.value)}
          aria-label="Group"
          className="ui-input rb-task-tool"
          data-size="sm"
          data-active={(viewMode === 'kanban' ? kanbanGroup !== 'status' : !!groupBy) ? 'true' : 'false'}>
          {GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        <span className="rb-task-divider" aria-hidden="true" />

        {/* Table / Board — the kit's Tabs: one underline, no orange fill
            under 13px text (C6; review R14). */}
        <Tabs
          label="View"
          panelId={BODY_ID}
          items={[{ id: 'table', label: 'Table' }, { id: 'kanban', label: 'Board' }]}
          value={viewMode}
          onChange={setViewMode}
        />

        {/* Saved views dropdown */}
        <SavedViewsDropdown
          views={savedViews}
          onLoad={loadView}
          onDelete={deleteSavedView}
          onSave={() => setShowSaveDialog(true)}
        />

        <span className="rb-task-divider" aria-hidden="true" />

        {/* Search */}
        <span className="rb-task-search">
          <Search className="rb-task-search-icon" aria-hidden="true" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="ui-input rb-task-search-input"
            data-size="sm" />
          {search && (
            <IconButton size="sm" Icon={X} title="Clear search" className="rb-task-search-clear" onClick={() => setSearch('')} />
          )}
        </span>
      </Toolbar>

      {/* ── Filter panel ── */}
      {showFilterPanel && (
        <FilterPanel
          filters={filters}
          assets={assets}
          phases={phases}
          members={projectMembers}
          onAdd={addFilter}
          onUpdate={updateFilter}
          onRemove={removeFilter}
          onClose={() => setShowFilterPanel(false)}
        />
      )}

      {/* ── Body ── */}
      <div className="rb-task-body" id={BODY_ID} role="tabpanel" aria-label={viewMode === 'table' ? 'Table' : 'Board'}>
        {viewMode === 'table' ? (
          <TaskTable
            tasks={processed}
            hasAnyTask={tasks.length > 0}
            groups={groups}
            groupBy={groupBy}
            assets={assets}
            phases={phases}
            members={projectMembers}
            assetById={assetById}
            phaseById={phaseById}
            memberById={memberById}
            collapsedGroups={collapsedGroups}
            toggleGroup={toggleGroup}
            ctx={ctx}
            canWrite={canWrite}
            onAddTask={handleAddTask}
            onDetailClick={(id) => setDetailTaskId(id)}
            onHistoryClick={canViewHistory ? (id) => setHistoryTaskId(id) : null}
            milestones={allMilestones}
            sortField={sortField}
            sortDir={sortDir}
          />
        ) : (
          <KanbanBoard
            groups={kanbanGroups}
            kanbanGroup={kanbanGroup}
            assets={assets}
            phases={phases}
            members={projectMembers}
            assetById={assetById}
            phaseById={phaseById}
            memberById={memberById}
            ctx={ctx}
            canWrite={canWrite}
            onAddTask={handleAddTask}
            onDetailClick={(id) => setDetailTaskId(id)}
          />
        )}
      </div>

      {/* ── Save view dialog — the kit's Dialog (Q17: Escape, the stack, the
          busy lock). The backdrop still closes it, as it always did. ── */}
      {showSaveDialog && (
        <Dialog
          width="confirm"
          title="Save current view"
          dismissOnBackdrop
          onClose={() => setShowSaveDialog(false)}
          footer={(
            <>
              <Button onClick={() => setShowSaveDialog(false)}>Cancel</Button>
              <Button variant="primary" onClick={saveCurrentView}>Save</Button>
            </>
          )}
        >
          <input autoFocus type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
            placeholder="View name…"
            aria-label="View name"
            onKeyDown={e => { if (e.key === 'Enter') saveCurrentView() }}
            className="ui-input" />
        </Dialog>
      )}

      {/* ── Phase create dialog ── */}
      {showPhaseCreate && (
        <Dialog
          width="confirm"
          title="Create phase"
          dismissOnBackdrop
          onClose={() => setShowPhaseCreate(false)}
          footer={(
            <>
              <Button onClick={() => setShowPhaseCreate(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleCreatePhase}>Create</Button>
            </>
          )}
        >
          <input autoFocus type="text" value={newPhaseName} onChange={e => setNewPhaseName(e.target.value)}
            placeholder="Phase name…"
            aria-label="Phase name"
            onKeyDown={e => { if (e.key === 'Enter') handleCreatePhase() }}
            className="ui-input" />
        </Dialog>
      )}

      {/* ── New task popup (Session 23) — drafts locally, commits on confirm ── */}
      {newTaskDraft && (
        <NewTaskPopup
          ctx={ctx}
          defaults={newTaskDraft}
          phases={phases}
          assets={assets}
          members={projectMembers}
          onCreated={() => setNewTaskDraft(null)}
          onClose={() => setNewTaskDraft(null)}
        />
      )}

      {/* ── Task detail popup ── */}
      {detailTaskId && (
        <TaskDetailPopup
          taskId={detailTaskId}
          ctx={ctx}
          onClose={() => setDetailTaskId(null)}
        />
      )}

      {/* ── Edit history drawer ── */}
      {historyTaskId && (
        <EditHistoryDrawer
          entityType="tasks"
          entityId={historyTaskId}
          entityLabel={tasks.find(t => t.id === historyTaskId)?.title}
          onClose={() => setHistoryTaskId(null)}
        />
      )}
    </div>
    </WriteReasonProvider>
  )
}


// ═════════════════════════════════════════════════════
// FILTER PANEL
// ═════════════════════════════════════════════════════
function FilterPanel({ filters, assets, phases, members, onAdd, onUpdate, onRemove, onClose }) {
  function getOptions(f) {
    const def = FILTER_FIELDS.find(ff => ff.value === f.field)
    if (!def) return []
    if (def.dynamic === 'assets')  return assets.map(a => ({ value: a.id, label: a.name || 'Untitled' }))
    if (def.dynamic === 'phases')  return phases.map(p => ({ value: p.id, label: p.name || 'Untitled' }))
    if (def.dynamic === 'members') return members.map(m => ({ value: m.id, label: m.name || 'Unnamed' }))
    return (def.options || []).map(o => ({ value: o, label: optionLabel(def.value, o) }))
  }
  function getType(f) {
    return FILTER_FIELDS.find(ff => ff.value === f.field)?.type || 'text'
  }
  return (
    <div className="rb-task-filters">
      {filters.map((f, i) => {
        const type = getType(f)
        const ops = FILTER_OPS[type] || FILTER_OPS.text
        const needsValue = !['is_empty','is_not_empty'].includes(f.op)
        return (
          <div key={i} className="rb-task-filter-row">
            <span className="rb-task-filter-where text-label uppercase">
              {i === 0 ? 'Where' : 'And'}
            </span>
            <select value={f.field} onChange={e => onUpdate(i, { field: e.target.value, value: '' })}
              aria-label="Field" className="ui-input rb-task-filter-field" data-size="sm">
              {FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select value={f.op} onChange={e => onUpdate(i, { op: e.target.value })}
              aria-label="Condition" className="ui-input rb-task-filter-op" data-size="sm">
              {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
              type === 'select' ? (
                <select value={f.value} onChange={e => onUpdate(i, { value: e.target.value })}
                  aria-label="Value" className="ui-input rb-task-tool" data-size="sm">
                  <option value="">— select —</option>
                  {getOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" value={f.value || ''} onChange={e => onUpdate(i, { value: e.target.value })}
                  placeholder="value…"
                  aria-label="Value"
                  className="ui-input rb-task-filter-text" data-size="sm" />
              )
            )}
            <IconButton size="sm" Icon={X} danger title="Remove this filter" onClick={() => onRemove(i)} />
          </div>
        )
      })}
      <div className="rb-task-filter-actions">
        <Button size="sm" Icon={Plus} onClick={onAdd}>Add filter</Button>
        {filters.length > 0 && (
          <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
        )}
      </div>
    </div>
  )
}


// ═════════════════════════════════════════════════════
// SAVED VIEWS DROPDOWN
// ═════════════════════════════════════════════════════
// Hand-drawn on the kit's floating tokens: the kit Menu has no item with a
// trailing action (load a view AND delete it, from one row). Kit request in
// the B2 hand-off.
function SavedViewsDropdown({ views, onLoad, onDelete, onSave }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <Button size="sm" Icon={BookmarkPlus} aria-expanded={open} onClick={() => setOpen(!open)}>
        Views
      </Button>
      {open && (
        <div className="rb-task-menu">
          {views.length === 0 && (
            <div className="rb-task-menu-empty">No saved views</div>
          )}
          {views.map(v => (
            <div key={v.id} className="rb-task-menu-item"
              onClick={() => { onLoad(v); setOpen(false) }}>
              <span className="rb-task-menu-label">{v.name}</span>
              <IconButton size="sm" Icon={X} danger title={`Delete the saved view "${v.name}"`}
                onClick={e => { e.stopPropagation(); onDelete(v.id) }} />
            </div>
          ))}
          <div className="rb-task-menu-foot">
            <button type="button" onClick={() => { onSave(); setOpen(false) }}
              className="rb-task-menu-item">
              <Save className="rb-task-menu-icon" aria-hidden="true" />
              <span className="rb-task-menu-label">Save current view</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ═════════════════════════════════════════════════════
// TABLE VIEW — the kit's Table (a real <table>, fixed layout, dense rows)
// ═════════════════════════════════════════════════════
// The header and the cells share one grid, so the header labels sit over
// their columns again: the flex version put rows 12px (24px when grouped)
// right of their own headers (review R05). Widths are px for the columns
// whose content has a known width (1054px with the checkbox) and the title
// takes the rest, never less than 200px: below 1254px of table the view
// scrolls sideways (only at Electron's 1024px floor) rather than wrapping a
// date mid-token (V1-06) or starving the title.
function TaskTable({ tasks, hasAnyTask = false, groups, groupBy, assets, phases, members, assetById, phaseById, memberById, collapsedGroups, toggleGroup, ctx, canWrite, onAddTask, onDetailClick, onHistoryClick, milestones = [], sortField, sortDir }) {
  const columns = [
    { key: 'title',       label: 'Title' },
    { key: 'status',      label: 'Status',   width: 148 },
    { key: 'priority',    label: 'Priority', width: 88 },
    { key: 'asset_id',    label: 'Asset',    width: 150 },
    { key: 'phase_id',    label: 'Phase',    width: 124 },
    { key: 'assignee_id', label: 'Assignee', width: 124 },
    { key: 'start_date',  label: 'Start',    width: 124 },
    { key: 'end_date',    label: 'End',      width: 124 },
    { key: 'bid_days',    label: 'Bid',      width: 64, numeric: true },
    { key: '_actions',    label: '',         width: onHistoryClick ? 72 : 44 },
  ]
  // The checkbox column plus the ten above: what a spanning cell spans.
  const span = columns.length + 1

  // ── Multi-select state ──
  const [selected, setSelected] = useState(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [confirmMilestone, setConfirmMilestone] = useState(null)
  const allTaskIds = useMemo(() => {
    if (groups) return groups.flatMap(g => g.tasks.map(t => t.id))
    return tasks.map(t => t.id)
  }, [groups, tasks])
  const allSelected = allTaskIds.length > 0 && allTaskIds.every(id => selected.has(id))
  const someSelected = selected.size > 0

  function toggleOne(id) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(allTaskIds))
  }
  function clearSelection() { setSelected(new Set()) }
  function bulkUpdate(patch) {
    for (const id of selected) ctx?.updateTask?.(id, patch)
    clearSelection()
  }
  // Bulk keeps its confirm (large blast radius); single rows rely on undo.
  // W9: the confirm is the kit's Dialog now, not window.confirm.
  function bulkDelete() {
    setConfirmBulkDelete(true)
  }
  function confirmedBulkDelete() {
    setConfirmBulkDelete(false)
    // Batch deletes reject on partial failure — the provider already
    // records the error in its state, so just swallow the rejection.
    ctx?.deleteTasks?.([...selected])?.catch(() => {})
    clearSelection()
  }

  if (tasks.length === 0 && (!groups || groups.length === 0)) {
    return (
      hasAnyTask ? (
        <EmptyState
          Icon={ListChecks}
          title="No tasks match these filters"
          body="Clear the search or a filter to see them again"
        />
      ) : (
        <EmptyState
          Icon={ListChecks}
          title="No tasks yet"
          body="Create a task to get started"
        />
      )
    )
  }

  const rowProps = {
    columns, assets, phases, members, assetById, phaseById, memberById, ctx, canWrite,
  }
  const taskRow = (t, drop) => (
    <TaskRow key={t.id} task={t} {...rowProps} drop={drop}
      onDetailClick={() => onDetailClick?.(t.id)}
      onHistoryClick={onHistoryClick ? () => onHistoryClick(t.id) : null}
      isSelected={selected.has(t.id)} onToggleSelect={() => toggleOne(t.id)} />
  )
  const milestoneRow = (ms) => (
    <MilestoneRow key={`ms-${ms.id}`} milestone={ms} columns={columns} canWrite={canWrite}
      ctx={ctx} onRequestDelete={() => setConfirmMilestone(ms)} />
  )

  // Milestone rows + task rows. When sorting by a date field, milestones are
  // interleaved at their correct chronological position. Otherwise they
  // render as a block above the tasks.
  let body
  if (groups) {
    body = (
      <>
        {milestones.map(ms => milestoneRow(ms))}
        {groups.map(g => (
          <TaskGroup key={g.key} group={g} groupBy={groupBy} span={span}
            phaseById={phaseById}
            collapsed={collapsedGroups.has(g.key)} onToggle={() => toggleGroup(g.key)}
            ctx={ctx} canWrite={canWrite} onAddTask={onAddTask}
            renderTask={taskRow} />
        ))}
      </>
    )
  } else {
    // When sorted by date, interleave milestones chronologically
    const dateSort = sortField === 'start_date' || sortField === 'end_date'
    let rows
    if (dateSort && milestones.length > 0) {
      const dir = sortDir === 'desc' ? -1 : 1
      // Build a merged array of { type: 'task'|'milestone', item }
      const merged = [
        ...tasks.map(t => ({ type: 'task', item: t, date: t[sortField] || '' })),
        ...milestones.map(ms => ({ type: 'milestone', item: ms, date: ms.date || '' })),
      ]
      merged.sort((a, b) => {
        if (a.date < b.date) return -1 * dir
        if (a.date > b.date) return 1 * dir
        // milestones sort before tasks at same date
        if (a.type === 'milestone' && b.type !== 'milestone') return -1
        if (a.type !== 'milestone' && b.type === 'milestone') return 1
        return 0
      })
      rows = merged.map(entry => entry.type === 'milestone' ? milestoneRow(entry.item) : taskRow(entry.item))
    } else {
      // No date sort — milestones first, then tasks
      rows = [...milestones.map(ms => milestoneRow(ms)), ...tasks.map(t => taskRow(t))]
    }
    body = (
      <>
        {rows}
        <AddRow span={span} canWrite={canWrite} onAdd={() => onAddTask()} />
      </>
    )
  }

  return (
    <div className="rb-task-table-wrap">
      {/* ── Bulk-action bar (overlays the header, right of the checkbox
          column: the controls appear where the selection was made). ── */}
      {someSelected && (
        <div className="rb-task-bulk">
          <span className="rb-task-bulk-count">
            {selected.size} selected
          </span>
          {/* One wrapper for the whole bulk group rather than six. It must
              generate a BOX (inline-flex, not `contents`) or the wrapper
              carries neither the dimming nor the hover that shows the
              reason. The parent row is `gap-3`, so the wrapper repeats that
              gap internally to keep the spacing identical. */}
          <GatedAction allowed={canWrite} style={{ gap: 12, alignItems: 'center' }}>
            <span className="rb-task-divider" aria-hidden="true" />
            <BulkSelect label="Status" options={TASK_STATUSES} labels={STATUS_LABELS} onPick={v => bulkUpdate({ status: v })} />
            <BulkSelect label="Priority" options={PRIORITIES} labels={PRIORITY_LABELS} onPick={v => bulkUpdate({ priority: v })} />
            <BulkSelect label="Phase" options={phases.map(p => p.id)} labels={phases.reduce((m, p) => { m[p.id] = p.name; return m }, {})} onPick={v => bulkUpdate({ phase_id: v || null })} allowEmpty />
            <BulkSelect label="Assignee" options={members.map(m => m.id)} labels={members.reduce((m, p) => { m[p.id] = p.name; return m }, {})} onPick={v => bulkUpdate({ assignee_id: v || null })} allowEmpty />
            <span className="rb-task-divider" aria-hidden="true" />
            <Button size="sm" variant="danger" Icon={Trash2} onClick={bulkDelete}>
              Delete
            </Button>
          </GatedAction>
          <IconButton size="sm" Icon={X} title="Clear the selection" onClick={clearSelection} />
        </div>
      )}

      <Table
        dense
        className="rb-task-table"
        head={(
          <Row>
            {/* Checkbox column */}
            <Th width={36} className="rb-task-check-cell">
              <button type="button" onClick={toggleAll}
                className="rb-task-check"
                data-checked={allSelected ? 'all' : someSelected ? 'some' : 'none'}
                aria-label={allSelected ? 'Clear the selection' : 'Select every task'}
                title={allSelected ? 'Clear the selection' : 'Select every task'}>
                {allSelected
                  ? <CheckSquare aria-hidden="true" />
                  : someSelected
                    ? <MinusSquare aria-hidden="true" />
                    : <Square aria-hidden="true" />}
              </button>
            </Th>
            {columns.map(c => (
              <Th key={c.key} width={c.width} numeric={c.numeric}>{c.label}</Th>
            ))}
          </Row>
        )}
      >
        {body}
      </Table>

      {confirmBulkDelete && (
        <Dialog
          width="confirm"
          title={`Delete ${selected.size} task${selected.size === 1 ? '' : 's'}?`}
          onClose={() => setConfirmBulkDelete(false)}
          footer={(
            <>
              <Button autoFocus onClick={() => setConfirmBulkDelete(false)}>Cancel</Button>
              <Button variant="danger" onClick={confirmedBulkDelete}>Delete</Button>
            </>
          )}
        >
          Every ticked task is deleted, including any in a collapsed group.
        </Dialog>
      )}

      {/* Milestones are hard-deleted with no undo path (local entity, not one
          of the 7 soft-delete tables) — the confirm stays until they get one.
          W9: the kit's Dialog, not window.confirm; raised here rather than
          in the row, because a table cell's nowrap would leak into it. */}
      {confirmMilestone && (
        <Dialog
          width="confirm"
          title={`Delete milestone "${confirmMilestone.title || 'Untitled'}"?`}
          onClose={() => setConfirmMilestone(null)}
          footer={(
            <>
              <Button autoFocus onClick={() => setConfirmMilestone(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => { const id = confirmMilestone.id; setConfirmMilestone(null); ctx?.deleteMilestone?.(id) }}>
                Delete
              </Button>
            </>
          )}
        >
          It comes off the Timeline as well.
        </Dialog>
      )}
    </div>
  )
}

// ── Bulk-action dropdown for floating bar ──
function BulkSelect({ label, options, labels, onPick, allowEmpty }) {
  return (
    <select
      defaultValue=""
      aria-label={label}
      onChange={e => { if (e.target.value !== '') { onPick(e.target.value); e.target.value = '' } }}
      className="ui-input rb-task-tool"
      data-size="sm"
    >
      <option value="" disabled>{label}</option>
      {allowEmpty && <option value="">None</option>}
      {options.map(o => <option key={o} value={o}>{(labels?.[o] || o).replace(/_/g, ' ')}</option>)}
    </select>
  )
}

// ── Drag helpers ──
function buildGroupPatch(groupBy, targetKey) {
  const val = targetKey === '__none__' ? null : targetKey
  if (groupBy === 'status')   return { status: val || 'waiting_to_start' }
  if (groupBy === 'asset')    return { asset_id: val }
  if (groupBy === 'phase')    return { phase_id: val }
  if (groupBy === 'priority') return { priority: val || 'medium' }
  if (groupBy === 'assignee') return { assignee_id: val }
  return {}
}

// ── Task group: header row + task rows + add row, one drop target ──
// A <tbody> cannot nest in the kit Table's own, so the group is a run of
// rows that share one set of drag handlers: entering any row of the group
// counts, leaving the last one un-counts (the same counter as before, over
// several elements instead of one wrapper).
function TaskGroup({ group, groupBy, span, phaseById, collapsed, onToggle, ctx, canWrite, onAddTask, renderTask }) {
  const [dragOver, setDragOver] = useState(false)
  const dragCountRef = useRef(0)

  function groupDefaults() {
    const d = {}
    if (groupBy === 'status')   d.status      = group.key
    if (groupBy === 'asset')    d.asset_id    = group.key === '__none__' ? undefined : group.key
    if (groupBy === 'phase')    d.phase_id    = group.key === '__none__' ? undefined : group.key
    if (groupBy === 'priority') d.priority    = group.key
    if (groupBy === 'assignee') d.assignee_id = group.key === '__none__' ? undefined : group.key
    return d
  }

  function handleDragEnter(e) { e.preventDefault(); dragCountRef.current++; if (dragCountRef.current === 1) setDragOver(true) }
  function handleDragOver(e) { e.preventDefault() }
  function handleDragLeave() { dragCountRef.current--; if (dragCountRef.current <= 0) { dragCountRef.current = 0; setDragOver(false) } }
  function handleDrop(e) {
    e.preventDefault()
    dragCountRef.current = 0
    setDragOver(false)
    const taskId = e.dataTransfer.getData('text/plain')
    // Session 29 — dropping a task on another group commits a real update.
    // The card's own draggable is gated below; this catches the drop itself.
    if (!canWrite) return
    if (!taskId || !ctx?.updateTask) return
    const patch = buildGroupPatch(groupBy, group.key)
    ctx.updateTask(taskId, patch)
  }
  // Every row of the group carries the handlers and the one flag.
  const drop = {
    handlers: { onDragEnter: handleDragEnter, onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop },
    over: dragOver,
  }

  // Phase data for editable header
  const isPhaseGroup = groupBy === 'phase' && group.key !== '__none__'
  const phase = isPhaseGroup ? phaseById[group.key] : null

  return (
    <>
      <Row className="rb-task-group-row" {...drop.handlers}
        data-drag-over={dragOver ? 'true' : 'false'}>
        <Td colSpan={span} className="rb-task-group-cell">
          <div className="rb-task-group-head">
            <IconButton size="sm" Icon={collapsed ? ChevronRight : ChevronDown}
              title={collapsed ? `Show ${group.label}` : `Hide ${group.label}`}
              aria-expanded={!collapsed}
              onClick={onToggle} />

            {isPhaseGroup && phase ? (
              /* ── Editable phase header ── */
              <div className="rb-task-group-body">
                {/* Session 29 — the phase header's name and both dates write
                    straight to ctx.updatePhase with no gate, same as the task row
                    cells did. */}
                <PhaseInlineEdit
                  value={phase.name || ''}
                  onCommit={(name) => { if (canWrite) ctx?.updatePhase?.(phase.id, { name }) }}
                  readOnly={!canWrite}
                />
                <span className="rb-task-phase-date">
                  <span className="text-label uppercase">Start</span>
                  <input
                    type="date"
                    value={phase.start_date || ''}
                    onChange={e => ctx?.updatePhase?.(phase.id, { start_date: e.target.value || null })}
                    onClick={e => e.stopPropagation()}
                    readOnly={!canWrite} disabled={!canWrite}
                    className="ui-input rb-task-date-input"
                    data-size="sm"
                    data-empty={phase.start_date ? 'false' : 'true'}
                  />
                </span>
                <span className="rb-task-phase-date">
                  <span className="text-label uppercase">End</span>
                  <input
                    type="date"
                    value={phase.end_date || ''}
                    onChange={e => ctx?.updatePhase?.(phase.id, { end_date: e.target.value || null })}
                    readOnly={!canWrite} disabled={!canWrite}
                    onClick={e => e.stopPropagation()}
                    className="ui-input rb-task-date-input"
                    data-size="sm"
                    data-empty={phase.end_date ? 'false' : 'true'}
                  />
                </span>
                <span className="rb-task-group-count">{group.tasks.length}</span>
              </div>
            ) : (
              /* ── Standard group header ── */
              <button type="button" onClick={onToggle} className="rb-task-group-toggle">
                {groupBy === 'status' && <StatusDot status={group.key} aria-hidden="true" role={undefined} aria-label={undefined} title="" />}
                <span className="rb-task-group-label">{group.label}</span>
                <span className="rb-task-group-count">{group.tasks.length}</span>
              </button>
            )}
          </div>
        </Td>
      </Row>
      {!collapsed && (
        <>
          {group.tasks.map(t => renderTask(t, drop))}
          <AddRow span={span} canWrite={canWrite} onAdd={() => onAddTask(groupDefaults())} drop={drop} />
        </>
      )}
    </>
  )
}

// ── Inline phase name editor (for group headers) ──
function PhaseInlineEdit({ value, onCommit, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  if (readOnly) {
    return (
      <span className="rb-task-group-label truncate">
        {value || 'Untitled phase'}
      </span>
    )
  }
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        aria-label="Phase name"
        className="ui-input rb-task-phase-input"
        data-size="sm"
      />
    )
  }
  return (
    <button type="button"
      onClick={e => { e.stopPropagation(); setDraft(value); setEditing(true) }}
      className="rb-task-cell-text rb-task-group-label"
      title="Click to rename phase">
      {value || 'Untitled'}
    </button>
  )
}


// ── Milestone (key date) row: its diamond carries the key date's colour ──
function MilestoneRow({ milestone, columns, ctx, canWrite, onRequestDelete }) {
  const [editTitle, setEditTitle] = useState(false)
  const [localTitle, setLocalTitle] = useState(milestone.title)
  const [editDate, setEditDate] = useState(false)
  const [localDate, setLocalDate] = useState(milestone.date || '')
  const isProjectBound = milestone.isProjectBound

  function commitTitle() {
    if (localTitle !== milestone.title && !isProjectBound) {
      ctx?.updateMilestone?.(milestone.id, { title: localTitle })
    }
    setEditTitle(false)
  }
  function commitDate() {
    if (localDate !== milestone.date && !isProjectBound) {
      ctx?.updateMilestone?.(milestone.id, { date: localDate })
    }
    setEditDate(false)
  }
  // The confirm (TaskTable's Dialog) guards the hard delete.
  function handleDelete() {
    if (isProjectBound) return
    onRequestDelete?.()
  }

  return (
    <Row className="rb-task-ms" style={{ '--rb-ms': milestone.color }}>
      {/* Checkbox spacer */}
      <Td className="rb-task-check-cell">
        <Diamond className="rb-task-ms-icon" aria-hidden="true" />
      </Td>
      {columns.map(c => {
        if (c.key === 'title') {
          return (
            <Td key={c.key} className="rb-task-cell">
              <span className="rb-task-ms-title">
                <Diamond className="rb-task-ms-icon" data-filled="true" aria-hidden="true" />
                {editTitle && !isProjectBound ? (
                  <input type="text" value={localTitle} autoFocus
                    onChange={e => setLocalTitle(e.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setLocalTitle(milestone.title); setEditTitle(false) } }}
                    aria-label="Key date name"
                    className="ui-input rb-task-cell-input"
                    data-size="sm"
                  />
                ) : (
                  isProjectBound ? (
                    <span className="rb-task-ms-name" data-empty="false"
                      title={milestone.description || milestone.title}>
                      {milestone.title}
                    </span>
                  ) : (
                    <button type="button"
                      className="rb-task-ms-name"
                      data-empty={milestone.title ? 'false' : 'true'}
                      onClick={() => setEditTitle(true)}
                      title={milestone.description || milestone.title}
                    >
                      {milestone.title || 'Untitled key date'}
                    </button>
                  )
                )}
                {isProjectBound && <Badge>Bound</Badge>}
              </span>
            </Td>
          )
        }
        if (c.key === 'start_date' || c.key === 'end_date') {
          return (
            <Td key={c.key} className="rb-task-cell">
              {c.key === 'start_date' ? (
                editDate && !isProjectBound ? (
                  <input type="date" value={localDate} autoFocus
                    onChange={e => setLocalDate(e.target.value)}
                    onBlur={commitDate}
                    onKeyDown={e => { if (e.key === 'Enter') commitDate(); if (e.key === 'Escape') { setLocalDate(milestone.date); setEditDate(false) } }}
                    aria-label="Key date"
                    className="ui-input rb-task-date-input"
                    data-size="sm"
                  />
                ) : (
                  isProjectBound ? (
                    <span className="rb-task-ms-date">{showDate(milestone.date)}</span>
                  ) : (
                    <button type="button" className="rb-task-ms-date" onClick={() => setEditDate(true)}>
                      {showDate(milestone.date)}
                    </button>
                  )
                )
              ) : (
                <span className="rb-task-none">—</span>
              )}
            </Td>
          )
        }
        if (c.key === '_actions') {
          return (
            <Td key={c.key} align="right">
              {canWrite && !isProjectBound && (
                <HoverActions>
                  <IconButton size="sm" Icon={Trash2} danger title="Delete key date" onClick={handleDelete} />
                </HoverActions>
              )}
            </Td>
          )
        }
        // Empty cell for other columns
        return (
          <Td key={c.key} numeric={c.numeric}>
            <span className="rb-task-none">—</span>
          </Td>
        )
      })}
    </Row>
  )
}

// ── Single task row ──
function TaskRow({ task, columns, assets, phases, members, assetById, phaseById, memberById, ctx, canWrite, onDetailClick, onHistoryClick, isSelected, onToggleSelect, drop }) {
  const writeReason = useWriteReason()

  // 🚨 Session 29 — this funnel was UNGATED, and it is not a create affordance
  // so neither the S23 nor the S29 brief covered it. Every inline cell on this
  // row (title, five dropdowns, both dates, bid days) commits through here, so
  // a reviewer could retype a task title or change its status and receive the
  // same raw `new row violates row-level security policy` string the Timeline
  // was fixed for. The create button being gated while the ROW was not is why
  // this screen read as "already gated".
  //
  // The controls below are individually disabled too — gating only this funnel
  // would leave nine editable-looking cells that silently discard input.
  function handleUpdate(patch) {
    if (!canWrite) return
    ctx?.updateTask?.(task.id, patch)
  }
  // Soft delete — no confirm; the shell-level undo toast covers it.
  function handleDelete() {
    if (!canWrite) return
    ctx?.deleteTask?.(task.id)
  }

  // Borderless select — transparent until hover: `.rb-task-cell-select`.
  // Its cursor used to be set INLINE from canWrite, which beat the
  // `disabled:cursor-not-allowed` class beside it; every one of these selects
  // is `disabled={!canWrite}`, so the stylesheet keys the cursor on :disabled.

  function renderCell(col) {
    switch (col.key) {
      case 'title':
        return (
          <span className="rb-task-title-cell">
            <CellInlineText value={task.title || ''} placeholder="Untitled task" onCommit={v => handleUpdate({ title: v })} readOnly={!canWrite} />
            <HoverActions>
              <IconButton size="sm" Icon={FileText} title="View task details" onClick={onDetailClick} />
            </HoverActions>
          </span>
        )
      case 'status':
        return (
          <span className="rb-task-status-cell">
            <StatusDot status={task.status || 'waiting_to_start'} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
            <span className="rb-task-cell-editor">
              <select value={task.status || 'waiting_to_start'} onChange={e => handleUpdate({ status: e.target.value })}
                disabled={!canWrite}
                aria-label="Status"
                className="rb-task-cell-select">
                {TASK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </span>
          </span>
        )
      case 'priority':
        return (
          <span className="rb-task-cell-editor">
            <select value={task.priority || 'medium'} onChange={e => handleUpdate({ priority: e.target.value })}
              disabled={!canWrite}
              aria-label="Priority"
              className="rb-task-cell-select"
              data-tone={priorityTone(task.priority || 'medium')}>
              {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
          </span>
        )
      case 'asset_id':
        return (
          <span className="rb-task-cell-editor">
            <select value={task.asset_id || ''} onChange={e => handleUpdate({ asset_id: e.target.value || null })}
              disabled={!canWrite}
              aria-label="Asset"
              className="rb-task-cell-select"
              data-empty={task.asset_id ? 'false' : 'true'}>
              <option value="">—</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.name || 'Untitled'}</option>)}
            </select>
          </span>
        )
      case 'phase_id':
        return (
          <span className="rb-task-cell-editor">
            <select value={task.phase_id || ''} onChange={e => handleUpdate({ phase_id: e.target.value || null })}
              disabled={!canWrite}
              aria-label="Phase"
              className="rb-task-cell-select"
              data-empty={task.phase_id ? 'false' : 'true'}>
              <option value="">—</option>
              {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
            </select>
          </span>
        )
      case 'assignee_id':
        return (
          <span className="rb-task-cell-editor">
            <select value={task.assignee_id || ''} onChange={e => handleUpdate({ assignee_id: e.target.value || null })}
              disabled={!canWrite}
              aria-label="Assignee"
              className="rb-task-cell-select"
              data-empty={task.assignee_id ? 'false' : 'true'}>
              <option value="">—</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </span>
        )
      case 'start_date':
        return <CellDateInput value={task.start_date || ''} label="Start date" onCommit={v => handleUpdate({ start_date: v || null })} readOnly={!canWrite} />
      case 'end_date':
        return <CellDateInput value={task.end_date || ''} label="End date" onCommit={v => handleUpdate({ end_date: v || null })} readOnly={!canWrite} />
      case 'bid_days':
        return <CellNumberInput value={task.bid_days} label="Bid days" onCommit={v => handleUpdate({ bid_days: v })} readOnly={!canWrite} />
      case '_actions':
        return (
          <HoverActions>
            {onHistoryClick && (
              <IconButton size="sm" Icon={History} title="View edit history" onClick={onHistoryClick} />
            )}
            {canWrite && (
              <IconButton size="sm" Icon={Trash2} danger title="Delete task" onClick={handleDelete} />
            )}
          </HoverActions>
        )
      default:
        return <span className="rb-task-none">{task[col.key] ?? '—'}</span>
    }
  }

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <Row
      className="rb-task-row"
      selected={isSelected}
      data-ticked={isSelected ? 'true' : 'false'}
      data-draggable={canWrite ? 'true' : 'false'}
      draggable={canWrite}
      onDragStart={handleDragStart}
      title={canWrite ? undefined : (writeReason || undefined)}
      {...(drop?.handlers || {})}
    >
      {/* Checkbox */}
      <Td className="rb-task-check-cell">
        <button type="button" onClick={e => { e.stopPropagation(); onToggleSelect?.() }}
          className="rb-task-check"
          data-checked={isSelected ? 'all' : 'none'}
          aria-pressed={isSelected}
          aria-label={`Select "${task.title || 'Untitled task'}"`}>
          {isSelected
            ? <CheckSquare aria-hidden="true" />
            : <Square aria-hidden="true" />}
        </button>
      </Td>
      {columns.map(c => (
        <Td key={c.key} numeric={c.numeric} align={c.key === '_actions' ? 'right' : 'left'} className="rb-task-cell">
          {renderCell(c)}
        </Td>
      ))}
    </Row>
  )
}

// ── Add row: "New task" at the foot of the table and of every group ──
function AddRow({ span, canWrite, onAdd, drop }) {
  return (
    <Row {...(drop?.handlers || {})}>
      <Td colSpan={span} className="rb-task-add-cell">
        <GatedAction allowed={canWrite} display="block">
          <button type="button" onClick={onAdd} className="rb-task-add">
            <Plus aria-hidden="true" />
            <span>New task</span>
          </button>
        </GatedAction>
      </Td>
    </Row>
  )
}


// ═════════════════════════════════════════════════════
// KANBAN BOARD
// ═════════════════════════════════════════════════════
//
// Redesigned with UX Laws in mind:
// • Common Region — each column is a distinct bounded container
// • Proximity — cards have internal padding, columns have external gaps
// • Von Restorff — the status dot makes columns instantly scannable
// • Doherty — the state changes are the kit's 120ms (§3.4)
// • Prägnanz — clean cards, no excess decoration
// • Fitts's Law — generous add-task targets, large enough card touch areas
//
function KanbanBoard({ groups, kanbanGroup, assets, phases, members, assetById, phaseById, memberById, ctx, canWrite, onAddTask, onDetailClick }) {
  return (
    <div className="rb-task-board">
      {groups.map(g => (
        <KanbanColumn key={g.key} group={g} kanbanGroup={kanbanGroup}
          assets={assets} phases={phases} members={members}
          assetById={assetById} phaseById={phaseById} memberById={memberById}
          ctx={ctx} canWrite={canWrite} onAddTask={onAddTask} onDetailClick={onDetailClick} />
      ))}
    </div>
  )
}

function KanbanColumn({ group, kanbanGroup, assets, phases, members, assetById, phaseById, memberById, ctx, canWrite, onAddTask, onDetailClick }) {
  const [addTitle, setAddTitle] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)
  const dragCountRef = useRef(0)

  function groupDefaults() {
    const d = {}
    if (kanbanGroup === 'status')   d.status      = group.key
    if (kanbanGroup === 'asset')    d.asset_id    = group.key === '__none__' ? undefined : group.key
    if (kanbanGroup === 'phase')    d.phase_id    = group.key === '__none__' ? undefined : group.key
    if (kanbanGroup === 'priority') d.priority    = group.key
    if (kanbanGroup === 'assignee') d.assignee_id = group.key === '__none__' ? undefined : group.key
    return d
  }

  function commitAdd() {
    if (!addTitle.trim()) return
    onAddTask({ ...groupDefaults(), title: addTitle.trim() })
    setAddTitle('')
  }

  // Counter-based drag tracking prevents flicker from child elements
  function handleDragEnter(e) { e.preventDefault(); dragCountRef.current++; if (dragCountRef.current === 1) setDragOver(true) }
  function handleDragOver(e) { e.preventDefault() }
  function handleDragLeave() { dragCountRef.current--; if (dragCountRef.current <= 0) { dragCountRef.current = 0; setDragOver(false) } }
  function handleDrop(e) {
    e.preventDefault()
    dragCountRef.current = 0
    setDragOver(false)
    const taskId = e.dataTransfer.getData('text/plain')
    // Session 29 — dropping a task on another group commits a real update.
    // The card's own draggable is gated below; this catches the drop itself.
    if (!canWrite) return
    if (!taskId || !ctx?.updateTask) return
    const patch = buildGroupPatch(kanbanGroup, group.key)
    ctx.updateTask(taskId, patch)
  }

  return (
    <div className="rb-task-col"
      data-drag-over={dragOver ? 'true' : 'false'}
      onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>

      {/* ── Column header ── */}
      <div className="rb-task-col-head">
        <div className="rb-task-col-title">
          {kanbanGroup === 'status' && <StatusDot status={group.key} aria-hidden="true" role={undefined} aria-label={undefined} title="" />}
          <span className="rb-task-group-label">{group.label}</span>
          <span className="rb-task-group-count">{group.tasks.length}</span>
        </div>
        <GatedAction allowed={canWrite}>
          <IconButton size="sm" Icon={Plus} title={`New task in ${group.label}`} onClick={() => onAddTask(groupDefaults())} />
        </GatedAction>
      </div>

      {/* ── Card list ── */}
      <div className="rb-task-col-list">
        {group.tasks.map(t => (
          <KanbanCard key={t.id} task={t}
            assetById={assetById} phaseById={phaseById} memberById={memberById}
            ctx={ctx} canWrite={canWrite} onDetailClick={() => onDetailClick?.(t.id)} />
        ))}

        {/* Inline add.
            🚨 This is the control from the S23 report: typing a task here and
            pressing Enter made the text vanish, because commitAdd clears the
            input unconditionally before the write resolves. Greyed, it cannot
            be typed into at all, which is the honest version of the same
            state. */}
        <GatedAction allowed={canWrite} display="block">
          <input ref={inputRef} type="text" value={addTitle} onChange={e => setAddTitle(e.target.value)}
            placeholder="+ Add task…"
            aria-label={`Add a task to ${group.label}`}
            onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') { setAddTitle(''); inputRef.current?.blur() } }}
            onBlur={commitAdd}
            className="ui-input rb-task-col-add"
            data-size="sm" />
        </GatedAction>
      </div>
    </div>
  )
}

function KanbanCard({ task, assetById, phaseById, memberById, ctx, canWrite, onDetailClick }) {
  const assignee = task.assignee_id ? memberById[task.assignee_id] : null
  const asset    = task.asset_id    ? assetById[task.asset_id]     : null
  const status   = task.status   || 'waiting_to_start'
  const priority = task.priority || 'medium'

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="rb-task-card ui-hover-host"
      data-draggable={canWrite ? 'true' : 'false'}
      draggable={canWrite} onDragStart={handleDragStart}>

      {/* Title + actions */}
      <div className="rb-task-card-top">
        <span className="rb-task-card-title">
          {task.title || 'Untitled task'}
        </span>
        <HoverActions>
          <IconButton size="sm" Icon={FileText} title="View task details" onClick={onDetailClick} />
          {canWrite && (
            // Soft delete — no confirm; the shell-level undo toast covers it.
            <IconButton size="sm" Icon={Trash2} danger title="Delete task" onClick={() => ctx?.deleteTask?.(task.id)} />
          )}
        </HoverActions>
      </div>

      {/* Status + Priority */}
      <div className="rb-task-card-meta">
        <StatusDot status={status} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
        <span>{STATUS_LABELS[status] || humanizeStatus(status)}</span>
        <span aria-hidden="true">&middot;</span>
        <span className="rb-task-card-priority" data-tone={priorityTone(priority)}>
          {PRIORITY_LABELS[priority] || priority}
        </span>
      </div>

      {/* Asset + Assignee */}
      {(asset || assignee) && (
        <div className="rb-task-card-people">
          {asset ? (
            <span className="rb-task-card-asset">{asset.name}</span>
          ) : <span />}
          {assignee ? (
            <span className="rb-task-card-assignee">{assignee.name}</span>
          ) : null}
        </div>
      )}

      {/* Date + bid */}
      {(task.start_date || task.bid_days != null) && (
        <div className="rb-task-card-figures">
          {task.start_date && <span>{showDate(task.start_date)}</span>}
          {task.bid_days != null && <span>{task.bid_days}d</span>}
        </div>
      )}
    </div>
  )
}


// ═════════════════════════════════════════════════════
// CELL EDITORS
// ═════════════════════════════════════════════════════
// Session 29 — `readOnly` renders the value as plain text with no button, no
// hover highlight and no way in. The alternative (leave the button, drop the
// write) is the S23 defect: a control that looks live, accepts a click, and
// discards what you typed.
function CellInlineText({ value, placeholder, onCommit, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => { setDraft(value) }, [value])

  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }

  if (readOnly) {
    return (
      <span className="rb-task-cell-text" data-empty={value ? 'false' : 'true'} data-static="true">
        {value || placeholder || '—'}
      </span>
    )
  }

  if (editing) {
    return (
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        aria-label="Title"
        className="ui-input rb-task-cell-input"
        data-size="sm" />
    )
  }
  return (
    <button type="button" onClick={() => { setDraft(value); setEditing(true) }}
      className="rb-task-cell-text"
      data-empty={value ? 'false' : 'true'}>
      {value || placeholder || '—'}
    </button>
  )
}

function CellDateInput({ value, label, onCommit, readOnly = false }) {
  return (
    <input type="date" value={value || ''} onChange={e => onCommit(e.target.value)}
      readOnly={readOnly} disabled={readOnly}
      aria-label={label}
      className="rb-task-cell-select rb-task-cell-date"
      data-empty={value ? 'false' : 'true'} />
  )
}

function CellNumberInput({ value, label, onCommit, readOnly = false }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  return (
    <input type="number" value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={() => { const n = parseFloat(draft); onCommit(isNaN(n) ? null : n) }}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      readOnly={readOnly} disabled={readOnly}
      aria-label={label}
      className="rb-task-cell-select rb-task-cell-number"
      data-empty={(value != null && value !== '') ? 'false' : 'true'}
      min={0} step={0.5} />
  )
}
