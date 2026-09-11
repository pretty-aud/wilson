// ============================================================
// WILSON Dashboard — task views (Session 8)
// ============================================================
//
// Table / kanban board / gallery over the signed-in user's own tasks
// across every project (useMyTasks). Interaction parity with RABBIT's
// task views — same popup (TaskDetailPopup via a synthetic per-project
// ctx), same hand-rolled HTML5 drag/drop — but styled with the WILSON
// light-page tokens, NOT the RABBIT dark theme (visual-language rule:
// local token object per page, no shared theme module).
//
// Budget honesty: no budget/rate columns exist here at all. Inside the
// popup, day-rate math comes from rate_card_entries which are RLS-empty
// for the 'user' role — the DB is the gate, and this surface adds nothing.

import { useMemo, useRef, useState } from 'react'
import {
  Table2, Columns3, LayoutGrid, Search, ChevronDown, ChevronUp,
  Filter, X, RefreshCw, CloudOff, ListChecks,
} from 'lucide-react'
import TaskDetailPopup from '../../tools/rabbit_v0.1.0/components/TaskDetailPopup'
import { useMyTasks } from './useMyTasks'
import { usePermissions } from '../../permissions/usePermissions'
import { canOnProject } from '../../permissions/projectRoleMatrix'
import {
  TASK_STATUSES, PRIORITIES, GROUP_OPTIONS, SORT_OPTIONS, FILTER_FIELDS,
  applyTaskFilters, applyTaskSort, groupTasks, buildGroupPatch,
  statusColor, priorityColor, fmt, myRoleOnTask,
} from './dashboardTaskModel'
import { LIGHT_INK, LIGHT_RULE, LIGHT_WELL } from '../lightSurface'
import './dashboard.css'

// ── WILSON light-page tokens (local per page, by convention) ──
const L = {
  text:        '#1c1917',
  label:       LIGHT_INK,
  // ⚠️ DARK-SURFACE ONLY. Sole consumer is RolePill's "no role" dash when
  // `onDark` is set (the gallery's #1c1917 card) — LIGHT_INK there would be
  // invisible. Every light-surface site uses LIGHT_INK directly.
  muted:       '#78716c',
  border:      LIGHT_RULE,
  headRow:     LIGHT_WELL,
  inputBg:     'rgba(120, 70, 30, 0.55)',
  inputText:   '#fde8d0',
  chipBg:      '#1c1917',
  chipText:    '#f4a261',
  primary:     '#ea580c',
  primaryText: '#ffffff',
  columnBg:    'rgba(120, 70, 30, 0.18)',
}

const inputClass = 'px-3 py-2 text-xs font-mono rounded-sm focus:ring-2 focus:ring-orange-500'
const labelClass = 'text-[11px] font-bold uppercase tracking-wider'

function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(`${d}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function StatusDot({ status }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: statusColor(status) }}
    />
  )
}

function StatusSelect({ value, onChange, disabled }) {
  return (
    <div className="flex items-center gap-1.5">
      <StatusDot status={value} />
      <select
        value={value || 'waiting_to_start'}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onClick={e => e.stopPropagation()}
        className="text-xs font-mono bg-transparent cursor-pointer"
        style={{ color: L.text, border: 'none' }}
      >
        {TASK_STATUSES.map(s => <option key={s} value={s}>{fmt(s)}</option>)}
      </select>
    </div>
  )
}

function PrioritySelect({ value, onChange, disabled }) {
  return (
    <select
      value={value || 'medium'}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      className="text-xs font-mono bg-transparent cursor-pointer"
      style={{ color: priorityColor(value), border: 'none', fontWeight: 700 }}
    >
      {PRIORITIES.map(p => <option key={p} value={p} style={{ color: L.text }}>{fmt(p)}</option>)}
    </select>
  )
}

// 🚨 Renders on BOTH surfaces — the light table cell and the dark gallery
// card — and only the "no role" dash differs. One ink cannot serve both, so
// the CALLER states which surface it is on rather than the component guessing.
// Defaults to light, because a wrong guess there is unreadable (2.33:1) while
// a wrong guess on the dark card is merely dim.
function RolePill({ role, onDark = false }) {
  if (!role) {
    return (
      <span className="dash-role-none text-xs font-mono italic" data-surface={onDark ? 'dark' : 'light'}>—</span>
    )
  }
  const assigned = role === 'assigned'
  return (
    <span
      className="dash-role-pill px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider"
      data-role={assigned ? 'assigned' : 'reviewing'}
    >
      {assigned ? 'Assigned' : 'Reviewing'}
    </span>
  )
}

export default function DashboardTasksView() {
  const mt = useMyTasks()
  const { role: appRole, ready: permsReady } = usePermissions()
  const [viewMode, setViewMode] = useState('table') // table | kanban | gallery
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState([])
  const [showFilters, setShowFilters] = useState(false)
  const [sortField, setSortField] = useState('end_date')
  const [sortDir, setSortDir] = useState('asc')
  const [groupBy, setGroupBy] = useState('status')
  const [detailTaskId, setDetailTaskId] = useState(null)

  const processed = useMemo(
    () => applyTaskSort(
      applyTaskFilters(mt.tasks, { search, filters, userId: mt.userId }),
      { sortField, sortDir },
    ),
    [mt.tasks, mt.userId, search, filters, sortField, sortDir],
  )

  const groups = useMemo(
    () => groupTasks(processed, groupBy, {
      projectsById: mt.projectsById,
      phasesById: mt.phasesById,
      userId: mt.userId,
    }),
    [processed, groupBy, mt.projectsById, mt.phasesById, mt.userId],
  )

  // Project-role write gating (review finding C2): mirror the DB's
  // can_write_project via the client matrix — reviewers on staffed projects
  // (the primary dashboard persona) must not get live write affordances the
  // RLS will reject. DB stays the real gate.
  //
  // 🚨 Session 29 added `ready`, which was missing. Without it the flag reads
  // "denied" for the whole window before the first getSession() resolves —
  // appRole is null, so on a staffed project the seat check fails and every
  // write affordance on the dashboard is absent at first paint. Found by
  // writeGate.test.js, not by anyone using the screen: the people testing it
  // all had permission, so the only visible symptom was a brief flicker.
  const canWriteTask = useMemo(() => (task) => {
    if (!task) return false
    return canOnProject({
      appRole,
      projectRole: mt.myRoleByProject[task.project_id] ?? null,
      isStaffed: !!mt.staffedByProject[task.project_id],
      ready: permsReady,
    }, 'project.entity.write')
  }, [appRole, permsReady, mt.myRoleByProject, mt.staffedByProject])

  // Synthetic per-project ctx for TaskDetailPopup. The popup reads data
  // and calls updateTask/deleteTask — nothing else. No *_enabled flags and
  // empty assets/shots keep hasLeftColumn false, so FileManager (which
  // writes to the provider's ACTIVE project) never mounts here.
  const detailTask = detailTaskId ? mt.tasks.find(t => t.id === detailTaskId) : null
  const popupCtx = useMemo(() => {
    if (!detailTask) return null
    const pid = detailTask.project_id
    return {
      tasks: mt.tasks,
      // assets/phases stay EMPTY on purpose: a populated assets list mounts
      // the FileManager left column (active-project writes), and the phase
      // select would write tasks.phase_id — a column that does not exist
      // (review findings C3/C4; the popup shows the embedded asset name
      // read-only instead).
      assets: [],
      phases: [],
      project: { id: pid, title: mt.projectsById[pid]?.title || '' },
      scenes: [], shots: [], levels: [], experiences: [],
      teamAssignments: [],
      managedFiles: [],
      refreshManagedFiles: () => {},
      myProjectRole: mt.myRoleByProject[pid] ?? null,
      projectIsStaffed: !!mt.staffedByProject[pid],
      activeProjectId: pid,
      updateTask: (id, patch) => { mt.patchTask(id, patch).catch(() => {}) },
      deleteTask: (id) => {
        // No undo toast outside the open project — confirm instead (v1).
        // Returning false tells the popup the delete was declined so it
        // keeps the popup open (review finding M7).
        if (!window.confirm('Delete this task? (30-day trash, admins can restore)')) {
          return false
        }
        mt.deleteTask(id).catch(() => {})
        return true
      },
    }
  }, [detailTask, mt])

  const dragEditable = buildGroupPatch(groupBy, '__probe__') !== null

  if (!mt.cloudReady) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <CloudOff className="w-8 h-8" style={{ color: LIGHT_INK }} />
        <div className="text-sm font-bold uppercase tracking-widest" style={{ color: L.label }}>
          Dashboard needs the cloud
        </div>
        <div className="text-xs font-mono text-center max-w-md" style={{ color: LIGHT_INK }}>
          Your cross-project tasks live on the central workspace. Sign in and
          switch R.A.B.B.I.T. to the Supabase adapter (System Settings → RABBIT)
          to see them here.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap pb-3">
        {/* view toggle */}
        <div className="flex rounded-sm overflow-hidden" style={{ border: `1px solid ${L.border}` }}>
          {[
            { key: 'table',   Icon: Table2,     title: 'Table' },
            { key: 'kanban',  Icon: Columns3,   title: 'Board' },
            { key: 'gallery', Icon: LayoutGrid, title: 'Gallery' },
          ].map(({ key, Icon, title }) => (
            <button
              key={key}
              type="button"
              title={title}
              onClick={() => setViewMode(key)}
              className="dash-viewmode px-2.5 py-1.5 transition-colors"
              data-active={String(viewMode === key)}
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>

        {/* search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: L.inputText, opacity: 0.7 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className={`${inputClass} pl-8 w-52`}
            style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
          />
        </div>

        {/* group */}
        <label className={labelClass} style={{ color: L.label }}>Group</label>
        <select
          value={groupBy}
          onChange={e => setGroupBy(e.target.value)}
          className={inputClass}
          style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
        >
          {GROUP_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>

        {/* sort */}
        <label className={labelClass} style={{ color: L.label }}>Sort</label>
        <select
          value={sortField}
          onChange={e => setSortField(e.target.value)}
          className={inputClass}
          style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
        >
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
          title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          className="dash-chip p-1.5 rounded-sm transition-colors"
        >
          {sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {/* filters */}
        <button
          type="button"
          onClick={() => setShowFilters(v => !v)}
          className="dash-filter-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider transition-colors"
          data-active={String(!!(filters.length || showFilters))}
        >
          <Filter className="w-3.5 h-3.5" />
          Filter{filters.length ? ` (${filters.length})` : ''}
        </button>

        <div className="flex-1" />
        <span className="text-xs font-mono" style={{ color: LIGHT_INK }}>
          {processed.length} task{processed.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={() => mt.reload()}
          title="Refresh"
          className="dash-chip p-1.5 rounded-sm transition-colors"
          data-hover="fade"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${mt.loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Filter rows ── */}
      {showFilters && (
        <FilterPanel
          filters={filters}
          setFilters={setFilters}
          projectsById={mt.projectsById}
        />
      )}

      {mt.error && (
        <div className="text-xs font-mono mb-2 px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>
          {mt.error}
        </div>
      )}

      {/* ── Views ── */}
      {processed.length === 0 && !mt.loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <ListChecks className="w-8 h-8" style={{ color: LIGHT_INK }} />
          <div className="text-xs font-mono italic" style={{ color: LIGHT_INK }}>
            {mt.tasks.length === 0
              ? 'Nothing assigned to you yet — tasks appear here when you are set as assignee or reviewer.'
              : 'No tasks match the current search/filters.'}
          </div>
        </div>
      ) : viewMode === 'table' ? (
        <TaskTable groups={groups} groupBy={groupBy} mt={mt} onOpen={setDetailTaskId} dragEditable={dragEditable} canWriteTask={canWriteTask} />
      ) : viewMode === 'kanban' ? (
        <KanbanBoard groups={groups} groupBy={groupBy} mt={mt} onOpen={setDetailTaskId} dragEditable={dragEditable} canWriteTask={canWriteTask} />
      ) : (
        <TaskGallery groups={groups} mt={mt} onOpen={setDetailTaskId} />
      )}

      {/* ── Detail popup (RABBIT reuse) ── */}
      {detailTaskId && popupCtx && (
        <TaskDetailPopup
          taskId={detailTaskId}
          ctx={popupCtx}
          onClose={() => setDetailTaskId(null)}
        />
      )}
    </div>
  )
}

// ── Filters ─────────────────────────────────────────────────
function FilterPanel({ filters, setFilters, projectsById }) {
  const valueOptions = (field) => {
    if (field === 'status')   return TASK_STATUSES.map(s => ({ value: s, label: fmt(s) }))
    if (field === 'priority') return PRIORITIES.map(p => ({ value: p, label: fmt(p) }))
    if (field === 'role')     return [{ value: 'assigned', label: 'Assigned' }, { value: 'reviewing', label: 'Reviewing' }]
    if (field === 'project_id') {
      return Object.entries(projectsById).map(([id, p]) => ({ value: id, label: p.title || id }))
    }
    return []
  }

  const update = (i, patch) => {
    setFilters(prev => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }

  return (
    <div className="flex flex-col gap-1.5 pb-3">
      {filters.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select
            value={f.field}
            onChange={e => update(i, { field: e.target.value, value: '' })}
            className={inputClass}
            style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
          >
            {FILTER_FIELDS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <select
            value={f.op}
            onChange={e => update(i, { op: e.target.value })}
            className={inputClass}
            style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
          >
            <option value="is">is</option>
            <option value="is_not">is not</option>
          </select>
          <select
            value={f.value}
            onChange={e => update(i, { value: e.target.value })}
            className={inputClass}
            style={{ backgroundColor: L.inputBg, color: L.inputText, border: 'none' }}
          >
            <option value="">—</option>
            {valueOptions(f.field).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setFilters(prev => prev.filter((_, idx) => idx !== i))}
            className="p-1.5 rounded-sm"
            style={{ color: LIGHT_INK }}
            title="Remove filter"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setFilters(prev => [...prev, { field: 'status', op: 'is', value: '' }])}
        className="dash-chip self-start px-2.5 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider"
      >
        + Add filter
      </button>
    </div>
  )
}

// ── Table ───────────────────────────────────────────────────
function ThLight({ children, width }) {
  return (
    <th
      className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left"
      style={{ color: L.label, width }}
    >
      {children}
    </th>
  )
}

function TaskTable({ groups, groupBy, mt, onOpen, dragEditable, canWriteTask }) {
  return (
    <div className="overflow-auto flex-1 rounded-sm" style={{ border: `1px solid ${L.border}` }}>
      <table className="w-full border-collapse" style={{ minWidth: 900 }}>
        <thead>
          <tr style={{ backgroundColor: L.headRow }}>
            <ThLight>Task</ThLight>
            <ThLight>Project</ThLight>
            <ThLight>Asset</ThLight>
            <ThLight width={150}>Status</ThLight>
            <ThLight width={90}>Priority</ThLight>
            <ThLight width={100}>Role</ThLight>
            <ThLight width={110}>Start</ThLight>
            <ThLight width={110}>Due</ThLight>
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <TableGroup
              key={group.key}
              group={group}
              groupBy={groupBy}
              mt={mt}
              onOpen={onOpen}
              droppable={dragEditable}
              canWriteTask={canWriteTask}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableGroup({ group, groupBy, mt, onOpen, droppable, canWriteTask }) {
  const dragCountRef = useRef(0)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault()
    dragCountRef.current = 0
    setDragOver(false)
    if (!droppable) return
    const taskId = e.dataTransfer.getData('text/plain')
    const task = mt.tasks.find(t => t.id === taskId)
    const patch = buildGroupPatch(groupBy, group.key)
    if (taskId && patch && canWriteTask(task)) mt.patchTask(taskId, patch).catch(() => {})
  }

  return (
    <>
      <tr
        onDragEnter={droppable ? (e) => { e.preventDefault(); dragCountRef.current++; if (dragCountRef.current === 1) setDragOver(true) } : undefined}
        onDragOver={droppable ? (e) => e.preventDefault() : undefined}
        onDragLeave={droppable ? () => { dragCountRef.current--; if (dragCountRef.current <= 0) { dragCountRef.current = 0; setDragOver(false) } } : undefined}
        onDrop={droppable ? handleDrop : undefined}
        className="dash-group-row"
        data-dragover={String(dragOver)}
      >
        <td colSpan={8} className="px-3 py-1.5">
          <div className="flex items-center gap-2">
            {(groupBy === 'status') && <StatusDot status={group.key} />}
            <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: L.label }}>
              {group.label}
            </span>
            <span className="text-[10.5px] font-mono" style={{ color: LIGHT_INK }}>{group.tasks.length}</span>
          </div>
        </td>
      </tr>
      {group.tasks.map(task => (
        <tr
          key={task.id}
          draggable={canWriteTask(task)}
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move' }}
          onClick={() => onOpen(task.id)}
          className="dash-task-row cursor-pointer transition-colors"
          style={{ borderBottom: `1px solid ${LIGHT_RULE}` }}
        >
          <td className="px-3 py-2 text-xs font-mono" style={{ color: L.text }}>{task.title}</td>
          <td className="px-3 py-2 text-xs font-mono" style={{ color: LIGHT_INK }}>{task.project?.title || '—'}</td>
          <td className="px-3 py-2 text-xs font-mono" style={{ color: LIGHT_INK }}>{task.asset?.name || '—'}</td>
          <td className="px-3 py-2">
            <StatusSelect value={task.status} disabled={!canWriteTask(task)} onChange={v => mt.patchTask(task.id, { status: v }).catch(() => {})} />
          </td>
          <td className="px-3 py-2">
            <PrioritySelect value={task.priority} disabled={!canWriteTask(task)} onChange={v => mt.patchTask(task.id, { priority: v }).catch(() => {})} />
          </td>
          <td className="px-3 py-2"><RolePill role={myRoleOnTask(task, mt.userId)} /></td>
          <td className="px-3 py-2 text-xs font-mono" style={{ color: LIGHT_INK }}>{fmtDate(task.start_date)}</td>
          <td className="px-3 py-2 text-xs font-mono" style={{ color: L.text }}>{fmtDate(task.end_date)}</td>
        </tr>
      ))}
    </>
  )
}

// ── Kanban ──────────────────────────────────────────────────
function KanbanBoard({ groups, groupBy, mt, onOpen, dragEditable, canWriteTask }) {
  return (
    <div className="flex gap-3 overflow-x-auto flex-1 pb-2 items-start">
      {groups.map(group => (
        <KanbanColumn
          key={group.key}
          group={group}
          groupBy={groupBy}
          mt={mt}
          onOpen={onOpen}
          droppable={dragEditable}
          canWriteTask={canWriteTask}
        />
      ))}
    </div>
  )
}

function KanbanColumn({ group, groupBy, mt, onOpen, droppable, canWriteTask }) {
  const dragCountRef = useRef(0)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault()
    dragCountRef.current = 0
    setDragOver(false)
    if (!droppable) return
    const taskId = e.dataTransfer.getData('text/plain')
    const task = mt.tasks.find(t => t.id === taskId)
    const patch = buildGroupPatch(groupBy, group.key)
    if (taskId && patch && canWriteTask(task)) mt.patchTask(taskId, patch).catch(() => {})
  }

  return (
    <div
      className="dash-kanban-col flex flex-col flex-shrink-0 rounded-sm"
      data-dragover={String(dragOver)}
      style={{
        width: 270,
        border: `1px solid ${L.border}`,
        maxHeight: '100%',
      }}
      onDragEnter={droppable ? (e) => { e.preventDefault(); dragCountRef.current++; if (dragCountRef.current === 1) setDragOver(true) } : undefined}
      onDragOver={droppable ? (e) => e.preventDefault() : undefined}
      onDragLeave={droppable ? () => { dragCountRef.current--; if (dragCountRef.current <= 0) { dragCountRef.current = 0; setDragOver(false) } } : undefined}
      onDrop={droppable ? handleDrop : undefined}
    >
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${L.border}` }}>
        {groupBy === 'status' && <StatusDot status={group.key} />}
        <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: L.label }}>
          {group.label}
        </span>
        <span className="text-[10.5px] font-mono" style={{ color: LIGHT_INK }}>{group.tasks.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2 overflow-y-auto">
        {group.tasks.map(task => (
          <KanbanCard key={task.id} task={task} mt={mt} onOpen={onOpen} draggable={droppable && canWriteTask(task)} />
        ))}
      </div>
    </div>
  )
}

function KanbanCard({ task, mt, onOpen, draggable }) {
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move' }}
      onClick={() => onOpen(task.id)}
      className="rounded-sm cursor-pointer overflow-hidden"
      style={{ backgroundColor: L.chipBg, border: '1px solid #44403c' }}
    >
      <div style={{ height: 3, backgroundColor: statusColor(task.status) }} />
      <div className="p-2.5 flex flex-col gap-1.5">
        <div className="text-xs font-mono font-bold leading-snug" style={{ color: L.chipText }}>
          {task.title}
        </div>
        <div className="text-[10.5px] font-mono" style={{ color: '#a8a29e' }}>
          {task.project?.title || '—'}{task.asset?.name ? ` · ${task.asset.name}` : ''}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: priorityColor(task.priority) }}>
            {fmt(task.priority)}
          </span>
          <span className="text-[10.5px] font-mono" style={{ color: '#a8a29e' }}>
            {fmtDate(task.end_date)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Gallery ─────────────────────────────────────────────────
function TaskGallery({ groups, mt, onOpen }) {
  const tasks = groups.flatMap(g => g.tasks)
  return (
    <div className="overflow-y-auto flex-1">
      <div className="grid gap-3 pb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {tasks.map(task => (
          <div
            key={task.id}
            onClick={() => onOpen(task.id)}
            className="rounded-sm cursor-pointer overflow-hidden flex flex-col"
            style={{ backgroundColor: L.chipBg, border: '1px solid #44403c' }}
          >
            <div
              className="h-20 flex items-center justify-center relative"
              style={{ borderBottom: '1px solid #44403c' }}
            >
              <span className="text-2xl font-bold" style={{ color: statusColor(task.status), opacity: 0.85 }}>
                {(task.title || '?').trim().charAt(0).toUpperCase()}
              </span>
              <span
                className="absolute top-2 right-2 px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wider"
                style={{ backgroundColor: statusColor(task.status), color: '#1c1917' }}
              >
                {fmt(task.status)}
              </span>
            </div>
            <div className="p-2.5 flex flex-col gap-1">
              <div className="text-xs font-mono font-bold leading-snug" style={{ color: L.chipText }}>
                {task.title}
              </div>
              <div className="text-[10.5px] font-mono" style={{ color: '#a8a29e' }}>
                {task.project?.title || '—'}
              </div>
              <div className="flex items-center justify-between pt-1">
                {/* Gallery card is L.chipBg (#1c1917) — the dark branch. */}
                <RolePill role={myRoleOnTask(task, mt.userId)} onDark />
                <span className="text-[10.5px] font-mono" style={{ color: '#a8a29e' }}>
                  {fmtDate(task.end_date)}
                </span>
              </div>
            </div>
            <div style={{ height: 3, backgroundColor: priorityColor(task.priority), marginTop: 'auto' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
