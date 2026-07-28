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
  Table as TableIcon, Columns3, ArrowUpDown, Layers, Diamond,
  ChevronDown, ChevronRight, Save, BookmarkPlus,
  GripVertical, MoreHorizontal, CheckSquare, Square, MinusSquare,
  Clock, CalendarDays, History,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useRosterMembers } from '../../../components/TeamMembers/useRosterMembers'
import { usePermissions } from '../../../permissions/usePermissions'
import { canOnProject } from '../../../permissions/projectRoleMatrix'
import TaskDetailPopup from '../components/TaskDetailPopup'
import EditHistoryDrawer from '../components/EditHistoryDrawer'

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

// ── Color system ──
// Direct status → accent color. Used for card left-borders,
// column header accents, inline select text, and kanban badges.
function statusColor(status) {
  switch (status) {
    case 'in_progress':    return '#fb923c'
    case 'pending_review': return '#fbbf24'
    case 'needs_revisions': return '#e879f9'
    case 'approved':       return '#4ade80'
    case 'final':          return '#22c55e'
    case 'blocked':        return '#ef4444'
    case 'on_hold':        return '#fcd34d'
    case 'omitted':        return '#57534e'
    default:               return '#a8a29e'  // waiting_to_start
  }
}

function priorityColor(p) {
  switch (p) {
    case 'urgent': return '#ef4444'
    case 'high':   return '#fb923c'
    case 'medium': return '#fbbf24'
    case 'low':    return '#78716c'
    default:       return '#a8a29e'
  }
}

function fmt(s) { return (s || '').replace(/_/g, ' ') }

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

  // Edit history (Session 5) — DB-side RLS is the real gate; this only
  // hides the affordance below manager.
  const { can, role } = usePermissions()
  const canViewHistory = can('rabbit.history.view')
  const [historyTaskId, setHistoryTaskId] = useState(null)

  // Entity writes (Session 6) — DB-side RLS is the real gate; this only
  // hides write affordances for staffed-project reviewers.
  const canWrite = canOnProject(
    { appRole: role, projectRole: ctx?.myProjectRole, isStaffed: ctx?.projectIsStaffed },
    'project.entity.write'
  )

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

  // ── All milestones (user + project bounds) ──
  const allMilestones = useMemo(() => {
    const list = [...milestones]
    if (project?.start_date) {
      list.push({ id: '__project_start__', title: 'Project Start', date: project.start_date, color: '#22c55e', isProjectBound: true })
    }
    if (project?.end_date) {
      list.push({ id: '__project_end__', title: 'Project End', date: project.end_date, color: '#ef4444', isProjectBound: true })
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
    return fmt(key)
  }

  // ── Task creation ──
  async function handleAddTask(defaults = {}) {
    if (!ctx?.addTask) return
    await ctx.addTask({
      title: '',
      status: 'waiting_to_start',
      priority: 'medium',
      ...defaults,
    })
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
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: '#1c1917' }}>
        <span className="text-[13.5px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>No project loaded</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>

      {/* ── Summary cards (always visible) ── */}
      <div className="flex gap-3 px-4 pt-4 pb-2 flex-wrap flex-shrink-0">
        <TaskBigTile icon={ListChecks} label="Tasks Remaining" value={taskSummary.remaining} />
        <TaskBigTile icon={Clock} label="Days Remaining" value={taskSummary.daysRemaining} />
        <TaskBigTile icon={CheckSquare} label="Tasks Completed" value={taskSummary.completed} tone="good" />
        <TaskBigTile icon={CalendarDays} label="Days Passed" value={taskSummary.daysPassed} />
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-2 flex-wrap flex-shrink-0" style={{ borderBottom: '1px solid #44403c' }}>

        {/* Filter */}
        <button type="button" onClick={() => setShowFilterPanel(!showFilterPanel)}
          className="flex items-center gap-1.5 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
          style={{ color: filters.length > 0 ? '#fb923c' : '#78716c', border: '1px solid #44403c' }}>
          <Filter className="w-3 h-3" />
          Filter{filters.length > 0 ? ` (${filters.length})` : ''}
        </button>

        {/* Sort */}
        <div className="flex items-center gap-1">
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            className="px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm focus:outline-none cursor-pointer"
            style={{ backgroundColor: '#292524', color: sortField ? '#fb923c' : '#78716c', border: '1px solid #44403c' }}>
            <option value="">Sort…</option>
            {SORTABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          {sortField && (
            <button type="button" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              className="p-1.5 rounded-sm hover:bg-stone-700 transition-colors"
              style={{ color: sortField ? '#fb923c' : '#57534e' }}>
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* Group */}
        <select value={viewMode === 'kanban' ? kanbanGroup : groupBy}
          onChange={e => viewMode === 'kanban' ? setKanbanGroup(e.target.value) : setGroupBy(e.target.value)}
          className="px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm focus:outline-none cursor-pointer"
          style={{ backgroundColor: '#292524', color: (viewMode === 'kanban' ? kanbanGroup : groupBy) ? '#fb923c' : '#78716c', border: '1px solid #44403c' }}>
          {GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* View mode toggle — segmented control */}
        <div className="flex rounded-sm overflow-hidden" style={{ border: '1px solid #44403c' }}>
          <button type="button" onClick={() => setViewMode('table')}
            className="flex items-center gap-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: viewMode === 'table' ? '#ea580c' : 'transparent',
              color: viewMode === 'table' ? '#fff7ed' : '#78716c',
            }}>
            <TableIcon className="w-3 h-3" /> Table
          </button>
          <button type="button" onClick={() => setViewMode('kanban')}
            className="flex items-center gap-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: viewMode === 'kanban' ? '#ea580c' : 'transparent',
              color: viewMode === 'kanban' ? '#fff7ed' : '#78716c',
            }}>
            <Columns3 className="w-3 h-3" /> Board
          </button>
        </div>

        {/* Saved views dropdown */}
        <SavedViewsDropdown
          views={savedViews}
          onLoad={loadView}
          onDelete={deleteSavedView}
          onSave={() => setShowSaveDialog(true)}
        />

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* Search */}
        <div className="flex items-center flex-1 min-w-[120px] max-w-[240px] rounded-sm" style={{ border: '1px solid #44403c', backgroundColor: '#292524' }}>
          <Search className="w-3 h-3 ml-2 flex-shrink-0" style={{ color: '#57534e' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="flex-1 px-2 py-1.5 text-[10.5px] font-mono bg-transparent focus:outline-none"
            style={{ color: '#d6d3d1' }} />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="p-1 mr-0.5 hover:bg-stone-700 rounded transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Right: count, phase, new task */}
        <div className="flex items-center gap-2 ml-auto">

          <span className="text-[10.5px] font-mono uppercase tracking-wider px-1" style={{ color: '#78716c' }}>
            {processed.length}/{tasks.length}
          </span>

          {canWrite && (
            <>
              {/* Phase create */}
              <button type="button" onClick={() => setShowPhaseCreate(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
                style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
                <Plus className="w-3.5 h-3.5" /> Phase
              </button>

              {/* Key date create */}
              <button type="button" onClick={() => ctx?.addMilestone?.({ title: '', date: new Date().toISOString().slice(0, 10) })}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
                style={{ color: '#f59e0b', border: '1px solid #44403c' }}>
                <Diamond className="w-3.5 h-3.5" /> Key Date
              </button>

              <button type="button" onClick={() => handleAddTask()}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded transition-colors"
                style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
                <Plus className="w-3.5 h-3.5" /> New task
              </button>
            </>
          )}
        </div>
      </div>

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
      <div className="flex-1 overflow-auto">
        {viewMode === 'table' ? (
          <TaskTable
            tasks={processed}
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

      {/* ── Save view dialog ── */}
      {showSaveDialog && (
        <>
          <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={() => setShowSaveDialog(false)} />
          <div className="fixed z-50 top-1/2 left-1/2 w-80 rounded p-5 flex flex-col gap-4"
            style={{ backgroundColor: '#292524', border: '2px solid #f97316', transform: 'translate(-50%,-50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <span className="text-[13.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>Save current view</span>
            <input autoFocus type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
              placeholder="View name..."
              onKeyDown={e => { if (e.key === 'Enter') saveCurrentView() }}
              className="px-3 py-2 text-xs font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }} />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowSaveDialog(false)}
                className="px-4 py-1.5 text-[11.5px] font-mono rounded hover:bg-stone-700 transition-colors"
                style={{ color: '#a8a29e', border: '1px solid #44403c' }}>Cancel</button>
              <button type="button" onClick={saveCurrentView}
                className="px-4 py-1.5 text-[11.5px] font-mono rounded transition-colors"
                style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>Save</button>
            </div>
          </div>
        </>
      )}

      {/* ── Phase create dialog ── */}
      {showPhaseCreate && (
        <>
          <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={() => setShowPhaseCreate(false)} />
          <div className="fixed z-50 top-1/2 left-1/2 w-80 rounded p-5 flex flex-col gap-4"
            style={{ backgroundColor: '#292524', border: '2px solid #f97316', transform: 'translate(-50%,-50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <span className="text-[13.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>Create phase</span>
            <input autoFocus type="text" value={newPhaseName} onChange={e => setNewPhaseName(e.target.value)}
              placeholder="Phase name..."
              onKeyDown={e => { if (e.key === 'Enter') handleCreatePhase() }}
              className="px-3 py-2 text-xs font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }} />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowPhaseCreate(false)}
                className="px-4 py-1.5 text-[11.5px] font-mono rounded hover:bg-stone-700 transition-colors"
                style={{ color: '#a8a29e', border: '1px solid #44403c' }}>Cancel</button>
              <button type="button" onClick={handleCreatePhase}
                className="px-4 py-1.5 text-[11.5px] font-mono rounded transition-colors"
                style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>Create</button>
            </div>
          </div>
        </>
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
    return (def.options || []).map(o => ({ value: o, label: fmt(o) }))
  }
  function getType(f) {
    return FILTER_FIELDS.find(ff => ff.value === f.field)?.type || 'text'
  }
  return (
    <div className="px-4 py-3 flex flex-col gap-2" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}>
      {filters.map((f, i) => {
        const type = getType(f)
        const ops = FILTER_OPS[type] || FILTER_OPS.text
        const needsValue = !['is_empty','is_not_empty'].includes(f.op)
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10.5px] font-mono uppercase font-semibold" style={{ color: '#78716c', width: 40 }}>
              {i === 0 ? 'Where' : 'And'}
            </span>
            <select value={f.field} onChange={e => onUpdate(i, { field: e.target.value, value: '' })}
              className="px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}>
              {FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select value={f.op} onChange={e => onUpdate(i, { op: e.target.value })}
              className="px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}>
              {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
              type === 'select' ? (
                <select value={f.value} onChange={e => onUpdate(i, { value: e.target.value })}
                  className="px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}>
                  <option value="">-- select --</option>
                  {getOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" value={f.value || ''} onChange={e => onUpdate(i, { value: e.target.value })}
                  placeholder="value..."
                  className="px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 w-36"
                  style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }} />
              )
            )}
            <button type="button" onClick={() => onRemove(i)} className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#fca5a5' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}
      <div className="flex items-center gap-2 mt-1">
        <button type="button" onClick={onAdd}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded hover:bg-stone-800 transition-colors"
          style={{ color: '#fb923c', border: '1px solid #44403c' }}>
          <Plus className="w-3.5 h-3.5" /> Add filter
        </button>
        {filters.length > 0 && (
          <button type="button" onClick={onClose}
            className="px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded hover:bg-stone-800 transition-colors"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            Done
          </button>
        )}
      </div>
    </div>
  )
}


// ═════════════════════════════════════════════════════
// SAVED VIEWS DROPDOWN
// ═════════════════════════════════════════════════════
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
      <button type="button" onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
        style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
        <BookmarkPlus className="w-3.5 h-3.5" /> Views
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded overflow-hidden z-30"
          style={{ backgroundColor: '#292524', border: '1px solid #44403c', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {views.length === 0 && (
            <div className="px-3 py-2.5 text-[11.5px] font-mono italic" style={{ color: '#78716c' }}>No saved views</div>
          )}
          {views.map(v => (
            <div key={v.id} className="flex items-center justify-between px-3 py-2 hover:bg-stone-700 cursor-pointer transition-colors"
              onClick={() => { onLoad(v); setOpen(false) }}>
              <span className="text-[11.5px] font-mono truncate" style={{ color: '#d6d3d1' }}>{v.name}</span>
              <button type="button" onClick={e => { e.stopPropagation(); onDelete(v.id) }}
                className="p-0.5 hover:bg-stone-600 rounded transition-colors" style={{ color: '#fca5a5' }}>
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #44403c' }}>
            <button type="button" onClick={() => { onSave(); setOpen(false) }}
              className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-stone-700 text-[11.5px] font-mono transition-colors"
              style={{ color: '#fb923c' }}>
              <Save className="w-3 h-3" /> Save current view
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ═════════════════════════════════════════════════════
// TABLE VIEW
// ═════════════════════════════════════════════════════
function TaskTable({ tasks, groups, groupBy, assets, phases, members, assetById, phaseById, memberById, collapsedGroups, toggleGroup, ctx, canWrite, onAddTask, onDetailClick, onHistoryClick, milestones = [], sortField, sortDir }) {
  const columns = [
    { key: 'title',       label: 'Title',    flex: 3 },
    { key: 'status',      label: 'Status',   flex: 1.2 },
    { key: 'priority',    label: 'Priority', flex: 1 },
    { key: 'asset_id',    label: 'Asset',    flex: 1.5 },
    { key: 'phase_id',    label: 'Phase',    flex: 1.2 },
    { key: 'assignee_id', label: 'Assignee', flex: 1.2 },
    { key: 'start_date',  label: 'Start',    flex: 1 },
    { key: 'end_date',    label: 'End',      flex: 1 },
    { key: 'bid_days',    label: 'Bid',      flex: 0.6 },
    { key: '_actions',    label: '',         flex: onHistoryClick ? 0.7 : 0.4 },
  ]

  // ── Multi-select state ──
  const [selected, setSelected] = useState(new Set())
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
  function bulkDelete() {
    if (!window.confirm(`Delete ${selected.size} task${selected.size === 1 ? '' : 's'}?`)) return
    // Batch deletes reject on partial failure — the provider already
    // records the error in its state, so just swallow the rejection.
    ctx?.deleteTasks?.([...selected])?.catch(() => {})
    clearSelection()
  }

  if (tasks.length === 0 && (!groups || groups.length === 0)) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <ListChecks className="w-12 h-12" style={{ color: '#44403c' }} />
        <span className="text-[13.5px] font-mono" style={{ color: '#78716c' }}>No tasks yet</span>
        <span className="text-[11.5px] font-mono" style={{ color: '#57534e' }}>Create a task to get started</span>
      </div>
    )
  }

  return (
    <div className="min-w-full relative">
      {/* Header */}
      <div className="relative flex sticky top-0 z-10" style={{ borderBottom: '1px solid #44403c' }}>
        {/* ── Bulk-action bar (overlays header) ── */}
        {someSelected && (
          <div className="absolute top-0 z-20 flex items-center gap-3 h-full px-3 rounded-sm"
            style={{ left: 36, backgroundColor: '#292524', border: '1px solid #ea580c', width: 'fit-content' }}>
            <span className="text-[11.5px] font-mono font-bold flex-shrink-0" style={{ color: '#fb923c' }}>
              {selected.size} selected
            </span>
            {canWrite && (
              <>
                <div style={{ width: 1, height: 18, backgroundColor: '#44403c' }} />
                <BulkSelect label="Status" options={TASK_STATUSES} onPick={v => bulkUpdate({ status: v })} />
                <BulkSelect label="Priority" options={PRIORITIES} onPick={v => bulkUpdate({ priority: v })} />
                <BulkSelect label="Phase" options={phases.map(p => p.id)} labels={phases.reduce((m, p) => { m[p.id] = p.name; return m }, {})} onPick={v => bulkUpdate({ phase_id: v || null })} allowEmpty />
                <BulkSelect label="Assignee" options={members.map(m => m.id)} labels={members.reduce((m, p) => { m[p.id] = p.name; return m }, {})} onPick={v => bulkUpdate({ assignee_id: v || null })} allowEmpty />
                <div style={{ width: 1, height: 18, backgroundColor: '#44403c' }} />
                <button type="button" onClick={bulkDelete}
                  className="flex items-center gap-1 px-2 py-1 rounded hover:bg-red-900/40 transition-colors"
                  style={{ color: '#fca5a5' }}>
                  <Trash2 className="w-3 h-3" /> <span className="text-[10.5px] font-mono uppercase">Delete</span>
                </button>
              </>
            )}
            <button type="button" onClick={clearSelection}
              className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {/* Checkbox column */}
        <div className="flex items-center justify-center px-2" style={{ width: 36, flexShrink: 0 }}>
          <button type="button" onClick={toggleAll} className="p-0.5 rounded hover:bg-stone-700 transition-colors">
            {allSelected
              ? <CheckSquare className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
              : someSelected
                ? <MinusSquare className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
                : <Square className="w-3.5 h-3.5" style={{ color: '#57534e' }} />}
          </button>
        </div>
        {columns.map(c => (
          <div key={c.key} className="px-3.5 py-2.5 text-[10.5px] font-mono uppercase tracking-wider font-semibold text-left"
            style={{ color: '#a8a29e', flex: c.flex, minWidth: 0 }}>
            {c.label}
          </div>
        ))}
      </div>

      {/* Milestone rows + task rows. When sorting by a date field,
          milestones are interleaved at their correct chronological
          position. Otherwise they render as a block above the tasks. */}
      <div className="flex flex-col gap-1 p-3">
        {groups ? (
          <>
            {/* Milestones above grouped tasks */}
            {milestones.length > 0 && (
              <div className="flex flex-col gap-1">
                {milestones.map(ms => (
                  <MilestoneRow key={`ms-${ms.id}`} milestone={ms} columns={columns} ctx={ctx} canWrite={canWrite} />
                ))}
              </div>
            )}
            {groups.map(g => (
              <TaskGroup key={g.key} group={g} groupBy={groupBy} columns={columns}
                assets={assets} phases={phases} members={members}
                assetById={assetById} phaseById={phaseById} memberById={memberById}
                collapsed={collapsedGroups.has(g.key)} onToggle={() => toggleGroup(g.key)}
                ctx={ctx} canWrite={canWrite} onAddTask={onAddTask} onDetailClick={onDetailClick} onHistoryClick={onHistoryClick}
                selected={selected} toggleOne={toggleOne} />
            ))}
          </>
        ) : (
          <>
            {(() => {
              // When sorted by date, interleave milestones chronologically
              const dateSort = sortField === 'start_date' || sortField === 'end_date'
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
                return merged.map(entry =>
                  entry.type === 'milestone' ? (
                    <MilestoneRow key={`ms-${entry.item.id}`} milestone={entry.item} columns={columns} ctx={ctx} canWrite={canWrite} />
                  ) : (
                    <TaskRow key={entry.item.id} task={entry.item} columns={columns}
                      assets={assets} phases={phases} members={members}
                      assetById={assetById} phaseById={phaseById} memberById={memberById}
                      ctx={ctx} canWrite={canWrite} onDetailClick={() => onDetailClick?.(entry.item.id)}
                      onHistoryClick={onHistoryClick ? () => onHistoryClick(entry.item.id) : null}
                      isSelected={selected.has(entry.item.id)} onToggleSelect={() => toggleOne(entry.item.id)} />
                  )
                )
              }
              // No date sort — milestones first, then tasks
              return (
                <>
                  {milestones.map(ms => (
                    <MilestoneRow key={`ms-${ms.id}`} milestone={ms} columns={columns} ctx={ctx} canWrite={canWrite} />
                  ))}
                  {tasks.map(t => (
                    <TaskRow key={t.id} task={t} columns={columns}
                      assets={assets} phases={phases} members={members}
                      assetById={assetById} phaseById={phaseById} memberById={memberById}
                      ctx={ctx} canWrite={canWrite} onDetailClick={() => onDetailClick?.(t.id)}
                      onHistoryClick={onHistoryClick ? () => onHistoryClick(t.id) : null}
                      isSelected={selected.has(t.id)} onToggleSelect={() => toggleOne(t.id)} />
                  ))}
                </>
              )
            })()}
            {canWrite && <AddRowButton onAdd={() => onAddTask()} />}
          </>
        )}
      </div>

    </div>
  )
}

// ── Bulk-action dropdown for floating bar ──
function BulkSelect({ label, options, labels, onPick, allowEmpty }) {
  return (
    <select
      defaultValue=""
      onChange={e => { if (e.target.value !== '') { onPick(e.target.value); e.target.value = '' } }}
      className="px-2 py-1 text-[10.5px] font-mono uppercase rounded focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
      style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#a8a29e' }}
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

// ── Task group with header + add-row + drop target ──
function TaskGroup({ group, groupBy, columns, assets, phases, members, assetById, phaseById, memberById, collapsed, onToggle, ctx, canWrite, onAddTask, onDetailClick, onHistoryClick, selected, toggleOne }) {
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
    if (!taskId || !ctx?.updateTask) return
    const patch = buildGroupPatch(groupBy, group.key)
    ctx.updateTask(taskId, patch)
  }

  // Resolve accent color — use status color if grouped by status, otherwise orange
  const groupAccent = groupBy === 'status' ? statusColor(group.key) : '#fb923c'

  // Phase data for editable header
  const isPhaseGroup = groupBy === 'phase' && group.key !== '__none__'
  const phase = isPhaseGroup ? phaseById[group.key] : null

  return (
    <div onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
      style={{
        boxShadow: dragOver ? 'inset 3px 0 0 #ea580c' : 'none',
        backgroundColor: dragOver ? 'rgba(234, 88, 12, 0.04)' : 'transparent',
        transition: 'box-shadow 200ms ease, background-color 200ms ease',
      }}>
      <div
        className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-stone-800/50 transition-colors"
        style={{
          backgroundColor: '#1c1917',
          borderBottom: '1px solid #44403c',
          borderLeft: `3px solid ${groupAccent}`,
        }}>
        <button type="button" onClick={onToggle} className="flex items-center gap-2.5 flex-shrink-0">
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5" style={{ color: '#a8a29e' }} />
            : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#a8a29e' }} />}
        </button>

        {isPhaseGroup && phase ? (
          /* ── Editable phase header ── */
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <PhaseInlineEdit
              value={phase.name || ''}
              onCommit={(name) => ctx?.updatePhase?.(phase.id, { name })}
              accent={groupAccent}
            />
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>Start</span>
              <input
                type="date"
                value={phase.start_date || ''}
                onChange={e => ctx?.updatePhase?.(phase.id, { start_date: e.target.value || null })}
                onClick={e => e.stopPropagation()}
                className="px-1.5 py-0.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#292524', color: phase.start_date ? '#d6d3d1' : '#57534e', border: '1px solid #44403c', width: 120 }}
              />
              <span className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>End</span>
              <input
                type="date"
                value={phase.end_date || ''}
                onChange={e => ctx?.updatePhase?.(phase.id, { end_date: e.target.value || null })}
                onClick={e => e.stopPropagation()}
                className="px-1.5 py-0.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#292524', color: phase.end_date ? '#d6d3d1' : '#57534e', border: '1px solid #44403c', width: 120 }}
              />
            </div>
            <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ color: '#a8a29e', backgroundColor: '#292524' }}>
              {group.tasks.length}
            </span>
          </div>
        ) : (
          /* ── Standard group header ── */
          <button type="button" onClick={onToggle} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
            <span className="text-[12.5px] font-mono uppercase tracking-wider font-bold"
              style={{ color: groupAccent }}>
              {group.label}
            </span>
            <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded"
              style={{ color: '#a8a29e', backgroundColor: '#292524' }}>
              {group.tasks.length}
            </span>
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="flex flex-col gap-1 p-3 pt-1">
          {group.tasks.map(t => (
            <TaskRow key={t.id} task={t} columns={columns}
              assets={assets} phases={phases} members={members}
              assetById={assetById} phaseById={phaseById} memberById={memberById}
              ctx={ctx} canWrite={canWrite} onDetailClick={() => onDetailClick?.(t.id)}
              onHistoryClick={onHistoryClick ? () => onHistoryClick(t.id) : null}
              isSelected={selected?.has(t.id)} onToggleSelect={() => toggleOne?.(t.id)} />
          ))}
          {canWrite && <AddRowButton onAdd={() => onAddTask(groupDefaults())} />}
        </div>
      )}
    </div>
  )
}

// ── Inline phase name editor (for group headers) ──
function PhaseInlineEdit({ value, onCommit, accent }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
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
        className="px-1.5 py-0.5 text-[12.5px] font-mono uppercase tracking-wider font-bold rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={{ backgroundColor: '#292524', color: accent, border: '1px solid #44403c', minWidth: 80 }}
      />
    )
  }
  return (
    <button type="button"
      onClick={e => { e.stopPropagation(); setDraft(value); setEditing(true) }}
      className="text-[12.5px] font-mono uppercase tracking-wider font-bold hover:bg-stone-700/40 px-1.5 py-0.5 rounded transition-colors truncate"
      style={{ color: accent }}
      title="Click to rename phase">
      {value || 'Untitled'}
    </button>
  )
}


// ── Milestone row — visually distinct with diamond icon + amber accent ──
function MilestoneRow({ milestone, columns, ctx, canWrite }) {
  const [hovered, setHovered] = useState(false)
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
  // Soft delete — no confirm; the shell-level undo toast covers it.
  function handleDelete() {
    if (isProjectBound) return
    // Milestones are hard-deleted with no undo path (local entity, not one of
    // the 7 soft-delete tables) — the confirm stays until they get one.
    if (window.confirm(`Delete milestone "${milestone.title || 'Untitled'}"?`)) {
      ctx?.deleteMilestone?.(milestone.id)
    }
  }

  return (
    <div
      className="flex items-center transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: '1px solid #44403c',
        borderRadius: 4,
        backgroundColor: hovered ? 'rgba(245, 158, 11, 0.08)' : 'rgba(245, 158, 11, 0.04)',
        borderLeft: `3px solid ${milestone.color || '#f59e0b'}`,
      }}
    >
      {/* Checkbox spacer */}
      <div className="flex items-center justify-center px-2" style={{ width: 36, flexShrink: 0 }}>
        <Diamond className="w-3.5 h-3.5" style={{ color: milestone.color || '#f59e0b' }} />
      </div>
      {columns.map(c => {
        if (c.key === 'title') {
          return (
            <div key={c.key} className="flex items-center gap-2 px-3.5 py-2" style={{ flex: c.flex, minWidth: 0 }}>
              <Diamond className="w-3 h-3 flex-shrink-0" style={{ color: milestone.color || '#f59e0b', fill: milestone.color || '#f59e0b' }} />
              {editTitle && !isProjectBound ? (
                <input type="text" value={localTitle} autoFocus
                  onChange={e => setLocalTitle(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setLocalTitle(milestone.title); setEditTitle(false) } }}
                  className="flex-1 px-1 py-0.5 text-[12.5px] font-mono font-semibold rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
                  style={{ backgroundColor: '#1c1917', color: '#f59e0b', border: '1px solid #44403c' }}
                />
              ) : (
                <span
                  className="text-[12.5px] font-mono font-semibold truncate cursor-pointer"
                  style={{ color: '#f59e0b' }}
                  onClick={() => !isProjectBound && setEditTitle(true)}
                  title={milestone.description || milestone.title}
                >
                  {milestone.title}
                </span>
              )}
              {isProjectBound && (
                <span className="text-[9.5px] font-mono uppercase px-1.5 py-0.5 rounded" style={{ color: '#78716c', backgroundColor: '#292524', border: '1px solid #3a3733' }}>bound</span>
              )}
            </div>
          )
        }
        if (c.key === 'start_date' || c.key === 'end_date') {
          return (
            <div key={c.key} className="px-3.5 py-2" style={{ flex: c.flex, minWidth: 0 }}>
              {c.key === 'start_date' ? (
                editDate && !isProjectBound ? (
                  <input type="date" value={localDate} autoFocus
                    onChange={e => setLocalDate(e.target.value)}
                    onBlur={commitDate}
                    onKeyDown={e => { if (e.key === 'Enter') commitDate(); if (e.key === 'Escape') { setLocalDate(milestone.date); setEditDate(false) } }}
                    className="w-full px-1 py-0.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
                    style={{ backgroundColor: '#1c1917', color: '#f59e0b', border: '1px solid #44403c' }}
                  />
                ) : (
                  <span
                    className="text-[11.5px] font-mono cursor-pointer"
                    style={{ color: '#f59e0b' }}
                    onClick={() => !isProjectBound && setEditDate(true)}
                  >
                    {milestone.date || '—'}
                  </span>
                )
              ) : (
                <span className="text-[11.5px] font-mono" style={{ color: '#57534e' }}>—</span>
              )}
            </div>
          )
        }
        if (c.key === '_actions') {
          return (
            <div key={c.key} className="flex items-center justify-center px-2" style={{ flex: c.flex, minWidth: 0 }}>
              {canWrite && !isProjectBound && hovered && (
                <button type="button" onClick={handleDelete}
                  className="p-1 rounded hover:bg-red-900/40 transition-colors" style={{ color: '#78716c' }}>
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          )
        }
        // Empty cell for other columns
        return (
          <div key={c.key} className="px-3.5 py-2" style={{ flex: c.flex, minWidth: 0 }}>
            <span className="text-[11.5px] font-mono" style={{ color: '#3a3733' }}>—</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Single task row ──
function TaskRow({ task, columns, assets, phases, members, assetById, phaseById, memberById, ctx, canWrite, onDetailClick, onHistoryClick, isSelected, onToggleSelect }) {
  const [hovered, setHovered] = useState(false)

  function handleUpdate(patch) { ctx?.updateTask?.(task.id, patch) }
  // Soft delete — no confirm; the shell-level undo toast covers it.
  function handleDelete() { ctx?.deleteTask?.(task.id) }

  // Borderless select — transparent until hover/focus
  const flatSelect = {
    backgroundColor: 'transparent', border: '1px solid transparent',
    outline: 'none', cursor: 'pointer',
  }

  function renderCell(col) {
    switch (col.key) {
      case 'title':
        return (
          <div className="flex items-center gap-1 w-full min-w-0">
            <div className="flex-1 min-w-0">
              <CellInlineText value={task.title || ''} placeholder="Untitled task" onCommit={v => handleUpdate({ title: v })} />
            </div>
            <button type="button" onClick={onDetailClick}
              className="p-1 rounded hover:bg-stone-700 transition-colors flex-shrink-0"
              title="View task details"
              style={{ color: '#fb923c', opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity 150ms ease' }}>
              <FileText className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      case 'status': {
        const sc = statusColor(task.status)
        return (
          <select value={task.status || 'waiting_to_start'} onChange={e => handleUpdate({ status: e.target.value })}
            className="px-1.5 py-1 text-[11.5px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full hover:bg-stone-700/40 transition-colors"
            style={{ ...flatSelect, color: sc }}>
            {TASK_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
          </select>
        )
      }
      case 'priority': {
        const pc = priorityColor(task.priority)
        return (
          <select value={task.priority || 'medium'} onChange={e => handleUpdate({ priority: e.target.value })}
            className="px-1.5 py-1 text-[11.5px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full hover:bg-stone-700/40 transition-colors"
            style={{ ...flatSelect, color: pc }}>
            {PRIORITIES.map(p => <option key={p} value={p} style={{ color: priorityColor(p) }}>{fmt(p)}</option>)}
          </select>
        )
      }
      case 'asset_id':
        return (
          <select value={task.asset_id || ''} onChange={e => handleUpdate({ asset_id: e.target.value || null })}
            className="px-1.5 py-1 text-[11.5px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full truncate hover:bg-stone-700/40 transition-colors"
            style={{ ...flatSelect, color: task.asset_id ? '#d6d3d1' : '#57534e' }}>
            <option value="">--</option>
            {assets.map(a => <option key={a.id} value={a.id}>{a.name || 'Untitled'}</option>)}
          </select>
        )
      case 'phase_id':
        return (
          <select value={task.phase_id || ''} onChange={e => handleUpdate({ phase_id: e.target.value || null })}
            className="px-1.5 py-1 text-[11.5px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full truncate hover:bg-stone-700/40 transition-colors"
            style={{ ...flatSelect, color: task.phase_id ? '#d6d3d1' : '#57534e' }}>
            <option value="">--</option>
            {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
          </select>
        )
      case 'assignee_id':
        return (
          <select value={task.assignee_id || ''} onChange={e => handleUpdate({ assignee_id: e.target.value || null })}
            className="px-1.5 py-1 text-[11.5px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full truncate hover:bg-stone-700/40 transition-colors"
            style={{ ...flatSelect, color: task.assignee_id ? '#d6d3d1' : '#57534e' }}>
            <option value="">--</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )
      case 'start_date':
        return <CellDateInput value={task.start_date || ''} onCommit={v => handleUpdate({ start_date: v || null })} />
      case 'end_date':
        return <CellDateInput value={task.end_date || ''} onCommit={v => handleUpdate({ end_date: v || null })} />
      case 'bid_days':
        return <CellNumberInput value={task.bid_days} onCommit={v => handleUpdate({ bid_days: v })} />
      case '_actions':
        return (
          <div className="flex items-center"
            style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity 150ms ease' }}>
            {onHistoryClick && (
              <button type="button" onClick={onHistoryClick}
                className="p-1 rounded hover:bg-stone-700 transition-colors"
                title="View edit history"
                style={{ color: '#a8a29e' }}>
                <History className="w-3.5 h-3.5" />
              </button>
            )}
            {canWrite && (
              <button type="button" onClick={handleDelete}
                className="p-1 rounded hover:bg-stone-700 transition-colors"
                style={{ color: '#fca5a5' }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )
      default:
        return <span className="text-[11.5px] font-mono" style={{ color: '#a8a29e' }}>{task[col.key] ?? '--'}</span>
    }
  }

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className={`flex cursor-grab active:cursor-grabbing${!isSelected && !hovered ? ' hover:bg-stone-800' : ''}`} draggable
      onDragStart={handleDragStart}
      style={{
        border: isSelected ? '1px solid #ea580c' : '1px solid #44403c',
        borderRadius: 4,
        backgroundColor: isSelected ? 'rgba(234, 88, 12, 0.1)' : '#1c1917',
        transition: 'background-color 150ms ease, border-color 150ms ease',
      }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {/* Checkbox */}
      <div className="flex items-center justify-center px-2" style={{ width: 36, flexShrink: 0 }}>
        <button type="button" onClick={e => { e.stopPropagation(); onToggleSelect?.() }}
          className="p-0.5 rounded hover:bg-stone-700 transition-colors"
          style={{ opacity: isSelected || hovered ? 1 : 0, transition: 'opacity 150ms ease' }}>
          {isSelected
            ? <CheckSquare className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
            : <Square className="w-3.5 h-3.5" style={{ color: '#57534e' }} />}
        </button>
      </div>
      {columns.map(c => (
        <div key={c.key} className="px-3.5 py-2 flex items-center" style={{ flex: c.flex, minWidth: 0, overflow: 'hidden' }}>
          {renderCell(c)}
        </div>
      ))}
    </div>
  )
}

// ── Add-row button ──
function AddRowButton({ onAdd }) {
  return (
    <button type="button" onClick={onAdd}
      className="w-full flex items-center gap-2 px-3.5 py-2 hover:bg-stone-800/40 transition-colors text-left"
      style={{ border: '1px dashed #292524', borderRadius: 4 }}>
      <Plus className="w-3.5 h-3.5" style={{ color: '#57534e' }} />
      <span className="text-[11.5px] font-mono" style={{ color: '#57534e' }}>New task</span>
    </button>
  )
}


// ═════════════════════════════════════════════════════
// KANBAN BOARD
// ═════════════════════════════════════════════════════
//
// Redesigned with UX Laws in mind:
// • Common Region — each column is a distinct bounded container
// • Proximity — cards have internal padding, columns have external gaps
// • Von Restorff — status-colored top accent makes columns instantly scannable
// • Doherty — smooth 200ms transitions on drag-over, hover, and state changes
// • Prägnanz — clean cards with left accent bar, no excess decoration
// • Fitts's Law — generous add-task targets, large enough card touch areas
//
function KanbanBoard({ groups, kanbanGroup, assets, phases, members, assetById, phaseById, memberById, ctx, canWrite, onAddTask, onDetailClick }) {
  return (
    <div className="flex gap-4 p-5 h-full overflow-x-auto">
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
    if (!taskId || !ctx?.updateTask) return
    const patch = buildGroupPatch(kanbanGroup, group.key)
    ctx.updateTask(taskId, patch)
  }

  // Column accent color — status-mapped when grouped by status, orange otherwise
  const headerAccent = kanbanGroup === 'status' ? statusColor(group.key) : '#fb923c'

  return (
    <div className="flex flex-col flex-shrink-0"
      onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
      style={{
        width: 280,
        backgroundColor: dragOver ? 'rgba(234, 88, 12, 0.06)' : '#292524',
        border: '1px solid #44403c',
        borderRadius: 6,
        // inset box-shadow for drag highlight — no layout shift, all sides uniform
        boxShadow: dragOver
          ? 'inset 0 0 0 2px #ea580c, 0 0 20px rgba(234, 88, 12, 0.15)'
          : 'none',
        transition: 'background-color 200ms ease, box-shadow 200ms ease',
      }}>

      {/* ── Column header ── */}
      <div className="px-3.5 py-3 flex items-center justify-between"
        style={{ borderBottom: `3px solid ${headerAccent}`, flexShrink: 0 }}>
        <div className="flex items-center gap-2.5">
          <span className="text-[12.5px] font-mono uppercase tracking-wider font-bold"
            style={{ color: headerAccent }}>
            {group.label}
          </span>
          <span className="text-[10.5px] font-mono px-2 py-0.5 rounded"
            style={{ color: '#a8a29e', backgroundColor: '#1c1917' }}>
            {group.tasks.length}
          </span>
        </div>
        {canWrite && (
          <button type="button" onClick={() => onAddTask(groupDefaults())}
            className="p-1 rounded hover:bg-stone-600 transition-colors" style={{ color: '#a8a29e' }}>
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* ── Card list ── */}
      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2" style={{ minHeight: 60 }}>
        {group.tasks.map(t => (
          <KanbanCard key={t.id} task={t}
            assetById={assetById} phaseById={phaseById} memberById={memberById}
            ctx={ctx} canWrite={canWrite} onDetailClick={() => onDetailClick?.(t.id)} />
        ))}

        {/* Inline add — dashed border invites input */}
        {canWrite && (
          <input ref={inputRef} type="text" value={addTitle} onChange={e => setAddTitle(e.target.value)}
            placeholder="+ Add task..."
            onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') { setAddTitle(''); inputRef.current?.blur() } }}
            onBlur={commitAdd}
            className="w-full px-3 py-2 text-[11.5px] font-mono rounded focus:outline-none focus:ring-1 focus:ring-orange-500 transition-all"
            style={{
              color: '#a8a29e',
              backgroundColor: 'transparent',
              border: '1px dashed #44403c',
              flexShrink: 0,
            }} />
        )}
      </div>
    </div>
  )
}

function KanbanCard({ task, assetById, phaseById, memberById, ctx, canWrite, onDetailClick }) {
  const [hovered, setHovered] = useState(false)
  const sc = statusColor(task.status)
  const pc = priorityColor(task.priority)
  const assignee = task.assignee_id ? memberById[task.assignee_id] : null
  const asset    = task.asset_id    ? assetById[task.asset_id]     : null

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="flex flex-col gap-1.5 cursor-grab active:cursor-grabbing"
      draggable onDragStart={handleDragStart}
      style={{
        backgroundColor: '#1c1917',
        border: `1px solid ${hovered ? '#57534e' : '#44403c'}`,
        borderLeft: `3px solid ${sc}`,
        borderRadius: 6,
        padding: '10px 12px',
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
        boxShadow: hovered ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
      }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>

      {/* Title + actions */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13.5px] font-mono leading-snug font-medium" style={{ color: '#e7e5e4' }}>
          {task.title || 'Untitled task'}
        </span>
        <div className="flex items-center gap-0.5 flex-shrink-0"
          style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity 150ms ease' }}>
          <button type="button" onClick={onDetailClick}
            className="p-0.5 rounded hover:bg-stone-600 transition-colors"
            title="View task details"
            style={{ color: '#fb923c' }}>
            <FileText className="w-3 h-3" />
          </button>
          {canWrite && (
            // Soft delete — no confirm; the shell-level undo toast covers it.
            <button type="button" onClick={() => ctx?.deleteTask?.(task.id)}
              className="p-0.5 rounded hover:bg-stone-600 transition-colors"
              style={{ color: '#ef4444' }}>
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Status + Priority */}
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[10.5px] font-mono uppercase tracking-wider font-semibold" style={{ color: sc }}>
          {fmt(task.status || 'waiting_to_start')}
        </span>
        <span style={{ color: '#44403c' }}>&middot;</span>
        <span className="text-[10.5px] font-mono uppercase tracking-wider" style={{ color: pc }}>
          {fmt(task.priority || 'medium')}
        </span>
      </div>

      {/* Asset + Assignee */}
      {(asset || assignee) && (
        <div className="flex items-center justify-between mt-1 pt-1.5" style={{ borderTop: '1px solid #292524' }}>
          {asset ? (
            <span className="text-[10.5px] font-mono truncate max-w-[140px]" style={{ color: '#78716c' }}>
              {asset.name}
            </span>
          ) : <span />}
          {assignee ? (
            <span className="text-[10.5px] font-mono truncate max-w-[100px] text-right" style={{ color: '#78716c' }}>
              {assignee.name}
            </span>
          ) : null}
        </div>
      )}

      {/* Date + bid */}
      {(task.start_date || task.bid_days != null) && (
        <div className="flex items-center gap-2 text-[10.5px] font-mono" style={{ color: '#57534e' }}>
          {task.start_date && <span>{task.start_date}</span>}
          {task.bid_days != null && <span>{task.bid_days}d</span>}
        </div>
      )}
    </div>
  )
}


// ═════════════════════════════════════════════════════
// CELL EDITORS
// ═════════════════════════════════════════════════════
function CellInlineText({ value, placeholder, onCommit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => { setDraft(value) }, [value])

  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }

  if (editing) {
    return (
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        className="w-full px-1.5 py-1 text-[12.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
    )
  }
  return (
    <button type="button" onClick={() => { setDraft(value); setEditing(true) }}
      className="text-[12.5px] font-mono text-left w-full truncate hover:bg-stone-700/40 px-1.5 py-1 rounded transition-colors"
      style={{ color: value ? '#d6d3d1' : '#57534e' }}>
      {value || placeholder || '\u2014'}
    </button>
  )
}

function CellDateInput({ value, onCommit }) {
  return (
    <input type="date" value={value || ''} onChange={e => onCommit(e.target.value)}
      className="px-1.5 py-1 text-[11.5px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full hover:bg-stone-700/40 transition-colors"
      style={{ backgroundColor: 'transparent', color: value ? '#d6d3d1' : '#57534e', border: '1px solid transparent', outline: 'none', colorScheme: 'dark' }} />
  )
}

function CellNumberInput({ value, onCommit }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  return (
    <input type="number" value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={() => { const n = parseFloat(draft); onCommit(isNaN(n) ? null : n) }}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      className="px-1.5 py-1 text-[11.5px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full hover:bg-stone-700/40 transition-colors"
      style={{ backgroundColor: 'transparent', color: (value != null && value !== '') ? '#d6d3d1' : '#57534e', border: '1px solid transparent', outline: 'none' }}
      min={0} step={0.5} />
  )
}

// ─── Summary card ───
function TaskBigTile({ icon: Icon, label, value, tone = 'neutral' }) {
  const colors = {
    good:    { bg: '#1c1917', border: '#15803d', text: '#86efac', label: '#86efac', icon: '#15803d' },
    danger:  { bg: '#1c1917', border: '#7f1d1d', text: '#fca5a5', label: '#fca5a5', icon: '#7f1d1d' },
    neutral: { bg: '#1c1917', border: '#44403c', text: '#d6d3d1', label: '#a8a29e', icon: '#57534e' },
  }[tone]
  return (
    <div className="flex-1 min-w-[120px] flex items-center gap-3 rounded-sm px-4 py-3"
      style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}>
      <Icon className="w-4 h-4 flex-shrink-0" style={{ color: colors.icon }} />
      <div className="flex flex-col min-w-0">
        <span className="text-[11.5px] font-mono uppercase tracking-widest" style={{ color: colors.label }}>{label}</span>
        <span className="text-lg font-mono font-bold" style={{ color: colors.text }}>{value}</span>
      </div>
    </div>
  )
}


