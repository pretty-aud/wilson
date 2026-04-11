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
  Table as TableIcon, Columns3, ArrowUpDown, Layers,
  ChevronDown, ChevronRight, Save, BookmarkPlus,
  GripVertical, MoreHorizontal,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import TaskDetailPopup from '../components/TaskDetailPopup'

// ── Constants ──
const TASK_STATUSES = [
  'waiting_to_start','in_progress','pending_review','revisions',
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
    case 'revisions':      return '#f97316'
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
  const tm  = useTeamMembers()
  const tasks   = ctx?.tasks   || []
  const assets  = ctx?.assets  || []
  const phases  = ctx?.phases  || []
  const project = ctx?.project
  const teamAssignments = ctx?.teamAssignments || []

  // Lookups
  const assetById = useMemo(() => {
    const m = {}; for (const a of assets) m[a.id] = a; return m
  }, [assets])

  const phaseById = useMemo(() => {
    const m = {}; for (const p of phases) m[p.id] = p; return m
  }, [phases])

  const memberById = useMemo(() => {
    const m = {}; for (const mb of tm.members) m[mb.id] = mb; return m
  }, [tm.members])

  const projectMembers = useMemo(() => {
    return teamAssignments.map(a => memberById[a.member_id]).filter(Boolean)
  }, [teamAssignments, memberById])

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

  // ── Render ──
  if (!project) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: '#1c1917' }}>
        <span className="text-[13px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>No project loaded</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 flex-wrap" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#292524' }}>

        {/* Filter */}
        <button type="button" onClick={() => setShowFilterPanel(!showFilterPanel)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
          style={{ color: filters.length > 0 ? '#fb923c' : '#a8a29e', border: '1px solid #44403c' }}>
          <Filter className="w-3.5 h-3.5" />
          Filter{filters.length > 0 ? ` (${filters.length})` : ''}
        </button>

        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            className="px-2 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}>
            <option value="">No sort</option>
            {SORTABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          {sortField && (
            <button type="button" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              className="px-2 py-1.5 text-[10px] font-mono uppercase rounded hover:bg-stone-700 transition-colors"
              style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
              {sortDir === 'asc' ? 'A\u2192Z' : 'Z\u2192A'}
            </button>
          )}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, backgroundColor: '#44403c' }} />

        {/* Group */}
        <div className="flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
          <select value={viewMode === 'kanban' ? kanbanGroup : groupBy}
            onChange={e => viewMode === 'kanban' ? setKanbanGroup(e.target.value) : setGroupBy(e.target.value)}
            className="px-2 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}>
            {GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, backgroundColor: '#44403c' }} />

        {/* View mode toggle — segmented control */}
        <div className="flex rounded overflow-hidden" style={{ border: '1px solid #44403c' }}>
          <button type="button" onClick={() => setViewMode('table')}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: viewMode === 'table' ? '#ea580c' : 'transparent',
              color: viewMode === 'table' ? '#fff7ed' : '#78716c',
            }}>
            <TableIcon className="w-3 h-3" /> Table
          </button>
          <button type="button" onClick={() => setViewMode('kanban')}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: viewMode === 'kanban' ? '#ea580c' : 'transparent',
              color: viewMode === 'kanban' ? '#fff7ed' : '#78716c',
              borderLeft: '1px solid #44403c',
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

        {/* Divider */}
        <div style={{ width: 1, height: 20, backgroundColor: '#44403c' }} />

        {/* Search */}
        <div className="flex items-center gap-1.5 flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#78716c' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="flex-1 px-2.5 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }} />
          {search && (
            <button type="button" onClick={() => setSearch('')}
              className="p-0.5 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right: count, phase, new task */}
        <div className="flex items-center gap-2 ml-auto">

          <span className="text-[10px] font-mono uppercase tracking-wider px-1" style={{ color: '#78716c' }}>
            {processed.length}/{tasks.length}
          </span>

          {/* Phase create */}
          <button type="button" onClick={() => setShowPhaseCreate(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            <Plus className="w-3.5 h-3.5" /> Phase
          </button>

          <button type="button" onClick={() => handleAddTask()}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded transition-colors"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
            <Plus className="w-3.5 h-3.5" /> New task
          </button>
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
            onAddTask={handleAddTask}
            onDetailClick={(id) => setDetailTaskId(id)}
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
            <span className="text-[13px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>Save current view</span>
            <input autoFocus type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
              placeholder="View name..."
              onKeyDown={e => { if (e.key === 'Enter') saveCurrentView() }}
              className="px-3 py-2 text-xs font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }} />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowSaveDialog(false)}
                className="px-4 py-1.5 text-[11px] font-mono rounded hover:bg-stone-700 transition-colors"
                style={{ color: '#a8a29e', border: '1px solid #44403c' }}>Cancel</button>
              <button type="button" onClick={saveCurrentView}
                className="px-4 py-1.5 text-[11px] font-mono rounded transition-colors"
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
            <span className="text-[13px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>Create phase</span>
            <input autoFocus type="text" value={newPhaseName} onChange={e => setNewPhaseName(e.target.value)}
              placeholder="Phase name..."
              onKeyDown={e => { if (e.key === 'Enter') handleCreatePhase() }}
              className="px-3 py-2 text-xs font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }} />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowPhaseCreate(false)}
                className="px-4 py-1.5 text-[11px] font-mono rounded hover:bg-stone-700 transition-colors"
                style={{ color: '#a8a29e', border: '1px solid #44403c' }}>Cancel</button>
              <button type="button" onClick={handleCreatePhase}
                className="px-4 py-1.5 text-[11px] font-mono rounded transition-colors"
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
            <span className="text-[10px] font-mono uppercase font-semibold" style={{ color: '#78716c', width: 40 }}>
              {i === 0 ? 'Where' : 'And'}
            </span>
            <select value={f.field} onChange={e => onUpdate(i, { field: e.target.value, value: '' })}
              className="px-2 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}>
              {FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select value={f.op} onChange={e => onUpdate(i, { op: e.target.value })}
              className="px-2 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}>
              {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
              type === 'select' ? (
                <select value={f.value} onChange={e => onUpdate(i, { value: e.target.value })}
                  className="px-2 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}>
                  <option value="">-- select --</option>
                  {getOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" value={f.value || ''} onChange={e => onUpdate(i, { value: e.target.value })}
                  placeholder="value..."
                  className="px-2 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 w-36"
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
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded hover:bg-stone-800 transition-colors"
          style={{ color: '#fb923c', border: '1px solid #44403c' }}>
          <Plus className="w-3.5 h-3.5" /> Add filter
        </button>
        {filters.length > 0 && (
          <button type="button" onClick={onClose}
            className="px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded hover:bg-stone-800 transition-colors"
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
        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
        style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
        <BookmarkPlus className="w-3.5 h-3.5" /> Views
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded overflow-hidden z-30"
          style={{ backgroundColor: '#292524', border: '1px solid #44403c', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {views.length === 0 && (
            <div className="px-3 py-2.5 text-[11px] font-mono italic" style={{ color: '#78716c' }}>No saved views</div>
          )}
          {views.map(v => (
            <div key={v.id} className="flex items-center justify-between px-3 py-2 hover:bg-stone-700 cursor-pointer transition-colors"
              onClick={() => { onLoad(v); setOpen(false) }}>
              <span className="text-[11px] font-mono truncate" style={{ color: '#d6d3d1' }}>{v.name}</span>
              <button type="button" onClick={e => { e.stopPropagation(); onDelete(v.id) }}
                className="p-0.5 hover:bg-stone-600 rounded transition-colors" style={{ color: '#fca5a5' }}>
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #44403c' }}>
            <button type="button" onClick={() => { onSave(); setOpen(false) }}
              className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-stone-700 text-[11px] font-mono transition-colors"
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
function TaskTable({ tasks, groups, groupBy, assets, phases, members, assetById, phaseById, memberById, collapsedGroups, toggleGroup, ctx, onAddTask, onDetailClick }) {
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
    { key: '_actions',    label: '',         flex: 0.4 },
  ]

  if (tasks.length === 0 && (!groups || groups.length === 0)) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <ListChecks className="w-12 h-12" style={{ color: '#44403c' }} />
        <span className="text-[13px] font-mono" style={{ color: '#78716c' }}>No tasks yet</span>
        <span className="text-[11px] font-mono" style={{ color: '#57534e' }}>Create a task to get started</span>
      </div>
    )
  }

  return (
    <div className="min-w-full">
      {/* Header */}
      <div className="flex sticky top-0 z-10" style={{ backgroundColor: '#292524', borderBottom: '2px solid #44403c' }}>
        {columns.map(c => (
          <div key={c.key} className="px-3.5 py-2.5 text-[11px] font-mono uppercase tracking-wider font-semibold text-left"
            style={{ color: '#a8a29e', flex: c.flex, minWidth: 0 }}>
            {c.label}
          </div>
        ))}
      </div>

      {/* Rows */}
      {groups ? (
        groups.map(g => (
          <TaskGroup key={g.key} group={g} groupBy={groupBy} columns={columns}
            assets={assets} phases={phases} members={members}
            assetById={assetById} phaseById={phaseById} memberById={memberById}
            collapsed={collapsedGroups.has(g.key)} onToggle={() => toggleGroup(g.key)}
            ctx={ctx} onAddTask={onAddTask} onDetailClick={onDetailClick} />
        ))
      ) : (
        <>
          {tasks.map(t => (
            <TaskRow key={t.id} task={t} columns={columns}
              assets={assets} phases={phases} members={members}
              assetById={assetById} phaseById={phaseById} memberById={memberById}
              ctx={ctx} onDetailClick={() => onDetailClick?.(t.id)} />
          ))}
          <AddRowButton onAdd={() => onAddTask()} />
        </>
      )}
    </div>
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
function TaskGroup({ group, groupBy, columns, assets, phases, members, assetById, phaseById, memberById, collapsed, onToggle, ctx, onAddTask, onDetailClick }) {
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
              <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>Start</span>
              <input
                type="date"
                value={phase.start_date || ''}
                onChange={e => ctx?.updatePhase?.(phase.id, { start_date: e.target.value || null })}
                onClick={e => e.stopPropagation()}
                className="px-1.5 py-0.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#292524', color: phase.start_date ? '#d6d3d1' : '#57534e', border: '1px solid #44403c', width: 120 }}
              />
              <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>End</span>
              <input
                type="date"
                value={phase.end_date || ''}
                onChange={e => ctx?.updatePhase?.(phase.id, { end_date: e.target.value || null })}
                onClick={e => e.stopPropagation()}
                className="px-1.5 py-0.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#292524', color: phase.end_date ? '#d6d3d1' : '#57534e', border: '1px solid #44403c', width: 120 }}
              />
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ color: '#a8a29e', backgroundColor: '#292524' }}>
              {group.tasks.length}
            </span>
          </div>
        ) : (
          /* ── Standard group header ── */
          <button type="button" onClick={onToggle} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
            <span className="text-[12px] font-mono uppercase tracking-wider font-bold"
              style={{ color: groupAccent }}>
              {group.label}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ color: '#a8a29e', backgroundColor: '#292524' }}>
              {group.tasks.length}
            </span>
          </button>
        )}
      </div>
      {!collapsed && (
        <>
          {group.tasks.map(t => (
            <TaskRow key={t.id} task={t} columns={columns}
              assets={assets} phases={phases} members={members}
              assetById={assetById} phaseById={phaseById} memberById={memberById}
              ctx={ctx} onDetailClick={() => onDetailClick?.(t.id)} />
          ))}
          <AddRowButton onAdd={() => onAddTask(groupDefaults())} />
        </>
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
        className="px-1.5 py-0.5 text-[12px] font-mono uppercase tracking-wider font-bold rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={{ backgroundColor: '#292524', color: accent, border: '1px solid #44403c', minWidth: 80 }}
      />
    )
  }
  return (
    <button type="button"
      onClick={e => { e.stopPropagation(); setDraft(value); setEditing(true) }}
      className="text-[12px] font-mono uppercase tracking-wider font-bold hover:bg-stone-700/40 px-1.5 py-0.5 rounded transition-colors truncate"
      style={{ color: accent }}
      title="Click to rename phase">
      {value || 'Untitled'}
    </button>
  )
}


// ── Single task row ──
function TaskRow({ task, columns, assets, phases, members, assetById, phaseById, memberById, ctx, onDetailClick }) {
  const [hovered, setHovered] = useState(false)

  function handleUpdate(patch) { ctx?.updateTask?.(task.id, patch) }
  function handleDelete() {
    if (window.confirm(`Delete task "${task.title || 'Untitled'}"?`)) {
      ctx?.deleteTask?.(task.id)
    }
  }

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
            className="px-1.5 py-1 text-[11px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full hover:bg-stone-700/40 transition-colors"
            style={{ ...flatSelect, color: sc }}>
            {TASK_STATUSES.map(s => <option key={s} value={s}>{fmt(s)}</option>)}
          </select>
        )
      }
      case 'priority': {
        const pc = priorityColor(task.priority)
        return (
          <select value={task.priority || 'medium'} onChange={e => handleUpdate({ priority: e.target.value })}
            className="px-1.5 py-1 text-[11px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full hover:bg-stone-700/40 transition-colors"
            style={{ ...flatSelect, color: pc }}>
            {PRIORITIES.map(p => <option key={p} value={p}>{fmt(p)}</option>)}
          </select>
        )
      }
      case 'asset_id':
        return (
          <select value={task.asset_id || ''} onChange={e => handleUpdate({ asset_id: e.target.value || null })}
            className="px-1.5 py-1 text-[11px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full truncate hover:bg-stone-700/40 transition-colors"
            style={{ ...flatSelect, color: task.asset_id ? '#d6d3d1' : '#57534e' }}>
            <option value="">--</option>
            {assets.map(a => <option key={a.id} value={a.id}>{a.name || 'Untitled'}</option>)}
          </select>
        )
      case 'phase_id':
        return (
          <select value={task.phase_id || ''} onChange={e => handleUpdate({ phase_id: e.target.value || null })}
            className="px-1.5 py-1 text-[11px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full truncate hover:bg-stone-700/40 transition-colors"
            style={{ ...flatSelect, color: task.phase_id ? '#d6d3d1' : '#57534e' }}>
            <option value="">--</option>
            {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
          </select>
        )
      case 'assignee_id':
        return (
          <select value={task.assignee_id || ''} onChange={e => handleUpdate({ assignee_id: e.target.value || null })}
            className="px-1.5 py-1 text-[11px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full truncate hover:bg-stone-700/40 transition-colors"
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
            <button type="button" onClick={handleDelete}
              className="p-1 rounded hover:bg-stone-700 transition-colors"
              style={{ color: '#fca5a5' }}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      default:
        return <span className="text-[11px] font-mono" style={{ color: '#a8a29e' }}>{task[col.key] ?? '--'}</span>
    }
  }

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="flex cursor-grab active:cursor-grabbing" draggable
      onDragStart={handleDragStart}
      style={{
        borderBottom: '1px solid #292524',
        backgroundColor: hovered ? 'rgba(41, 37, 36, 0.5)' : 'transparent',
        transition: 'background-color 150ms ease',
      }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
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
      style={{ borderBottom: '1px solid #292524' }}>
      <Plus className="w-3.5 h-3.5" style={{ color: '#57534e' }} />
      <span className="text-[11px] font-mono" style={{ color: '#57534e' }}>New task</span>
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
function KanbanBoard({ groups, kanbanGroup, assets, phases, members, assetById, phaseById, memberById, ctx, onAddTask, onDetailClick }) {
  return (
    <div className="flex gap-4 p-5 h-full overflow-x-auto">
      {groups.map(g => (
        <KanbanColumn key={g.key} group={g} kanbanGroup={kanbanGroup}
          assets={assets} phases={phases} members={members}
          assetById={assetById} phaseById={phaseById} memberById={memberById}
          ctx={ctx} onAddTask={onAddTask} onDetailClick={onDetailClick} />
      ))}
    </div>
  )
}

function KanbanColumn({ group, kanbanGroup, assets, phases, members, assetById, phaseById, memberById, ctx, onAddTask, onDetailClick }) {
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
          <span className="text-[12px] font-mono uppercase tracking-wider font-bold"
            style={{ color: headerAccent }}>
            {group.label}
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded"
            style={{ color: '#a8a29e', backgroundColor: '#1c1917' }}>
            {group.tasks.length}
          </span>
        </div>
        <button type="button" onClick={() => onAddTask(groupDefaults())}
          className="p-1 rounded hover:bg-stone-600 transition-colors" style={{ color: '#a8a29e' }}>
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Card list ── */}
      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2" style={{ minHeight: 60 }}>
        {group.tasks.map(t => (
          <KanbanCard key={t.id} task={t}
            assetById={assetById} phaseById={phaseById} memberById={memberById}
            ctx={ctx} onDetailClick={() => onDetailClick?.(t.id)} />
        ))}

        {/* Inline add — dashed border invites input */}
        <input ref={inputRef} type="text" value={addTitle} onChange={e => setAddTitle(e.target.value)}
          placeholder="+ Add task..."
          onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') { setAddTitle(''); inputRef.current?.blur() } }}
          onBlur={commitAdd}
          className="w-full px-3 py-2 text-[11px] font-mono rounded focus:outline-none focus:ring-1 focus:ring-orange-500 transition-all"
          style={{
            color: '#a8a29e',
            backgroundColor: 'transparent',
            border: '1px dashed #44403c',
            flexShrink: 0,
          }} />
      </div>
    </div>
  )
}

function KanbanCard({ task, assetById, phaseById, memberById, ctx, onDetailClick }) {
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
        <span className="text-[13px] font-mono leading-snug font-medium" style={{ color: '#e7e5e4' }}>
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
          <button type="button" onClick={() => {
            if (window.confirm(`Delete task "${task.title || 'Untitled'}"?`)) ctx?.deleteTask?.(task.id)
          }} className="p-0.5 rounded hover:bg-stone-600 transition-colors"
            style={{ color: '#ef4444' }}>
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Status + Priority */}
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[10px] font-mono uppercase tracking-wider font-semibold" style={{ color: sc }}>
          {fmt(task.status || 'waiting_to_start')}
        </span>
        <span style={{ color: '#44403c' }}>&middot;</span>
        <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: pc }}>
          {fmt(task.priority || 'medium')}
        </span>
      </div>

      {/* Asset + Assignee */}
      {(asset || assignee) && (
        <div className="flex items-center justify-between mt-1 pt-1.5" style={{ borderTop: '1px solid #292524' }}>
          {asset ? (
            <span className="text-[10px] font-mono truncate max-w-[140px]" style={{ color: '#78716c' }}>
              {asset.name}
            </span>
          ) : <span />}
          {assignee ? (
            <span className="text-[10px] font-mono truncate max-w-[100px] text-right" style={{ color: '#78716c' }}>
              {assignee.name}
            </span>
          ) : null}
        </div>
      )}

      {/* Date + bid */}
      {(task.start_date || task.bid_days != null) && (
        <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: '#57534e' }}>
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
        className="w-full px-1.5 py-1 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
    )
  }
  return (
    <button type="button" onClick={() => { setDraft(value); setEditing(true) }}
      className="text-[12px] font-mono text-left w-full truncate hover:bg-stone-700/40 px-1.5 py-1 rounded transition-colors"
      style={{ color: value ? '#d6d3d1' : '#57534e' }}>
      {value || placeholder || '\u2014'}
    </button>
  )
}

function CellDateInput({ value, onCommit }) {
  return (
    <input type="date" value={value || ''} onChange={e => onCommit(e.target.value)}
      className="px-1.5 py-1 text-[11px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full hover:bg-stone-700/40 transition-colors"
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
      className="px-1.5 py-1 text-[11px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full hover:bg-stone-700/40 transition-colors"
      style={{ backgroundColor: 'transparent', color: (value != null && value !== '') ? '#d6d3d1' : '#57534e', border: '1px solid transparent', outline: 'none' }}
      min={0} step={0.5} />
  )
}


