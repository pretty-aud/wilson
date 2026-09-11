// ============================================================
// WILSON Dashboard — task views (Session 8; UI overhaul C2)
// ============================================================
//
// Table / kanban board / gallery over the signed-in user's own tasks
// across every project (useMyTasks). Interaction parity with RABBIT's
// task views — same popup (TaskDetailPopup via a synthetic per-project
// ctx), same hand-rolled HTML5 drag/drop.
//
// ── What the overhaul changed, and what it deliberately did not ─────────────
//
// Q1 moved this page off `#f4a261` and onto the dark `paper` the tools use,
// so the local `L` token object is gone: there is no page-local palette here
// any more, only `src/ui` components and the tokens in `@theme` (C8). The
// eight-column table is the shared `Table` — a real <table> with
// `table-layout: fixed`, 36px rows and a sticky opaque head — which deletes
// the fifth hand-written copy of `ThLight` and makes this table and the Team
// Members table the same object (review D13, uniformity gaps 3, 4 and 6).
//
// Nothing about what a control DOES changed (C1). The three views, the five
// groupings, the seven sorts, the two directions, the four filter fields, the
// drag/drop and the row click all behave exactly as before; the review's
// Hick's-law findings ship as GROUPING — three toolbar regions separated by a
// hairline — and not as a disclosure, so no control moved, none was hidden
// and none gained a click.
//
// 🚨 The drag feedback has no test. Both `dragOver` branches (the group band
// and the kanban column) are driven by a dragCountRef enter/leave counter and
// are resolved in dashboard.css; a restyle that drops one loses drag feedback
// silently (review rework risk 3).
//
// Budget honesty: no budget/rate columns exist here at all. Inside the
// popup, day-rate math comes from rate_card_entries which are RLS-empty
// for the 'user' role — the DB is the gate, and this surface adds nothing.

import { useMemo, useRef, useState } from 'react'
import {
  Table2, Columns3, LayoutGrid, Search, ChevronDown, ChevronUp,
  X, RefreshCw, CloudOff, ListChecks, AlertTriangle, Plus,
} from 'lucide-react'
import TaskDetailPopup from '../../tools/rabbit_v0.1.0/components/TaskDetailPopup'
import { useMyTasks } from './useMyTasks'
import { usePermissions } from '../../permissions/usePermissions'
import { canOnProject } from '../../permissions/projectRoleMatrix'
import {
  TASK_STATUSES, PRIORITIES, GROUP_OPTIONS, SORT_OPTIONS, FILTER_FIELDS,
  TASK_COLUMNS, applyTaskFilters, applyTaskSort, groupTasks, buildGroupPatch,
  priorityTone, fmt, statusLabel, myRoleOnTask,
} from './dashboardTaskModel'
import {
  Badge, Banner, Button, Card, Chip, Dialog, EmptyState, IconButton, Input,
  Loading, Row, Select, StatusDot, Table, Td, Th, Toolbar,
} from '../../ui'
import './dashboard.css'

const COLS = TASK_COLUMNS.length

function fmtDate(d) {
  if (!d) return null
  const dt = new Date(`${d}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** A date, or the one emptiness treatment: italic, the third ink. */
function DateValue({ value }) {
  const t = fmtDate(value)
  return t ? <>{t}</> : <span className="dash-empty-value">—</span>
}

// 🚨 An in-cell editor, not a form well. The kit's `Select` is a 28/36px well
// with a hairline, which is right in a Toolbar and wrong inside a 36px row —
// F2 kept two page-owned rules for exactly this case on Team Members. What
// this fixes is review D7: these were bare <select>s and nothing set
// `appearance: none`, so Chromium painted its native caret in the Status AND
// the Priority cell of every row, permanently. At thirty tasks that is sixty
// caret glyphs competing with the data. The caret is drawn by dashboard.css
// now and revealed on row hover or focus-within; the control is unchanged and
// every option stays equally reachable.
function CellSelect({ value, options, onChange, disabled, label, tone }) {
  return (
    <span className="dash-cell-editor">
      <select
        className="dash-cell-select"
        value={value}
        disabled={disabled}
        aria-label={label}
        title={disabled ? undefined : label}
        data-tone={tone}
        onChange={e => onChange(e.target.value)}
        onClick={e => e.stopPropagation()}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  )
}

const STATUS_OPTIONS = TASK_STATUSES.map(s => ({ value: s, label: statusLabel(s) }))
const PRIORITY_OPTIONS = PRIORITIES.map(p => ({ value: p, label: fmt(p) }))

function StatusCell({ value, onChange, disabled }) {
  const v = value || 'waiting_to_start'
  return (
    <span className="dash-cell-status">
      {/* The dot is decorative here: the select beside it carries the word and
          the accessible name, so announcing the status twice would be worse
          than announcing it once. */}
      <StatusDot status={v} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
      <CellSelect
        value={v}
        options={STATUS_OPTIONS}
        onChange={onChange}
        disabled={disabled}
        label="Status"
      />
    </span>
  )
}

function PriorityCell({ value, onChange, disabled }) {
  const v = value || 'medium'
  return (
    <CellSelect
      value={v}
      options={PRIORITY_OPTIONS}
      onChange={onChange}
      disabled={disabled}
      label="Priority"
      tone={priorityTone(v)}
    />
  )
}

// The role marker. It was two filled pills — `#ea580c` with white text, and
// the 3.38:1 brown well — which made "Assigned" the loudest thing in its row
// and put a signal fill under 11px text, which §3.2 forbids outright. Both
// are the inert `Badge` now and the WORD carries the difference, which is the
// only carrier left once colour is spent on status.
function RoleBadge({ role }) {
  if (!role) return <span className="dash-empty-value">—</span>
  return <Badge>{role === 'assigned' ? 'Assigned' : 'Reviewing'}</Badge>
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
  // The task the delete Dialog is asking about (W9). Null when it is closed.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

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
        //
        // 🚨 THE SYNCHRONOUS VETO IS THE CONTRACT, AND IT IS PRESERVED.
        // TaskDetailPopup calls this and reads the return VALUE:
        // `if (ctx?.deleteTask?.(task.id) !== false) onClose()`. A Dialog is
        // asynchronous, so W9's conversion works by always returning false —
        // "not deleted, keep yourself open" — and raising the Dialog, which
        // then closes the popup itself if the person confirms. Cancel leaves
        // the popup open, which is exactly what a cancelled window.confirm
        // did. TaskDetailPopup is RABBIT's file and is not touched.
        setConfirmDeleteId(id)
        return false
      },
    }
  }, [detailTask, mt])

  const dragEditable = buildGroupPatch(groupBy, '__probe__') !== null

  if (!mt.cloudReady) {
    return (
      <div className="dash-body">
        <EmptyState
          Icon={CloudOff}
          title="Dashboard needs the cloud"
          body="Your cross-project tasks live on the central workspace. Sign in and switch R.A.B.B.I.T. to the Supabase adapter (System settings → RABBIT) to see them here."
        />
      </div>
    )
  }

  return (
    <div className="dash-view">
      {/* ── Toolbar ──
          Nine controls in one ragged flat strip became three regions with a
          hairline between them: view mode and search, then the four view
          settings, then the count and refresh in the right slot. That is the
          whole of the Hick's-law fix (hotspot 1) — every control is still
          visible, still one click away, and in the same order. Every child is
          the toolbar's own 28px, so the row finally has one baseline (D15). */}
      {/* No `wrap`. Plan §4's contract is "never wraps", and D15 asked for
          the search field to give way rather than the row — which is what
          `.dash-search .ui-input` does. Measured at 1440x900 and 1280x700:
          the strip stays one 44px row. */}
      <Toolbar
        right={(
          <>
            <span className="dash-toolbar-sep" aria-hidden="true" />
            <span className="dash-count">
              {processed.length} task{processed.length === 1 ? '' : 's'}
            </span>
            <IconButton
              icon={RefreshCw}
              size="sm"
              title="Refresh"
              onClick={() => mt.reload()}
              className={mt.loading ? 'dash-spin' : ''}
            />
          </>
        )}
      >
        <span className="dash-toolbar-group">
          {[
            { key: 'table', Icon: Table2, title: 'Table' },
            { key: 'kanban', Icon: Columns3, title: 'Board' },
            { key: 'gallery', Icon: LayoutGrid, title: 'Gallery' },
          ].map(({ key, Icon, title }) => (
            <IconButton
              key={key}
              icon={Icon}
              size="sm"
              title={title}
              active={viewMode === key}
              onClick={() => setViewMode(key)}
            />
          ))}
          <span className="dash-search">
            <Search className="dash-toolbar-glyph" aria-hidden="true" />
            <Input
              size="sm"
              value={search}
              onChange={setSearch}
              placeholder="Search tasks"
              aria-label="Search tasks"
            />
          </span>
        </span>

        <span className="dash-toolbar-sep" aria-hidden="true" />

        <span className="dash-toolbar-group">
          {/* The two words stay. The review's complaint was that their cap
              height sat about 3px above the select's baseline, which the
              toolbar's one control height fixes by itself; deleting them
              would have cost the only thing that says which select is
              which. They are real labels now, so the word focuses the
              control. */}
          <label className="dash-toolbar-label" htmlFor="dash-group-by">Group</label>
          <Select
            id="dash-group-by"
            size="sm"
            value={groupBy}
            onChange={v => setGroupBy(v ?? 'status')}
            options={GROUP_OPTIONS.map(o => ({ value: o.key, label: o.label }))}
          />
          <label className="dash-toolbar-label" htmlFor="dash-sort-by">Sort</label>
          <Select
            id="dash-sort-by"
            size="sm"
            value={sortField}
            onChange={v => setSortField(v ?? 'end_date')}
            options={SORT_OPTIONS.map(o => ({ value: o.key, label: o.label }))}
          />
          <IconButton
            icon={sortDir === 'asc' ? ChevronUp : ChevronDown}
            size="sm"
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
          />
          <Chip
            active={!!(filters.length || showFilters)}
            count={filters.length || null}
            onClick={() => setShowFilters(v => !v)}
            title="Filter tasks"
          >
            Filter
          </Chip>
        </span>
      </Toolbar>

      <div className="dash-body">
        {showFilters && (
          <FilterPanel
            filters={filters}
            setFilters={setFilters}
            projectsById={mt.projectsById}
          />
        )}

        {/* No dismiss control: this strip did not have one, and adding one is
            a new control (C1). It still clears on the next successful reload,
            exactly as before. Recorded in the hand-off as D19's open half. */}
        {mt.error && <Banner tone="danger" Icon={AlertTriangle}>{mt.error}</Banner>}

        {/* Loading and empty were the same picture: while `loading` was true
            this rendered the TABLE, and because the status grouping keeps its
            empty groups the first paint of the page was a header row above
            nine bands reading "waiting to start 0". Skeleton rows for "not
            yet", EmptyState for "nothing here" (review D8 and D20; the
            critic's cross-cutting ruling, which the plan's §4 Loading entry
            makes app-wide). */}
        {mt.loading && processed.length === 0 ? (
          // In the SAME frame the rows will land in, or the card's hairline
          // pops into existence when loading ends — the opposite of what
          // skeleton rows are for.
          <Card pad={false} className="dash-table-card">
            <Loading rows={6} columns={COLS} label="Loading your tasks" />
          </Card>
        ) : processed.length === 0 ? (
          <EmptyState
            Icon={ListChecks}
            title={mt.tasks.length === 0 ? 'Nothing assigned to you yet' : 'No matches'}
            body={mt.tasks.length === 0
              ? 'Tasks appear here when you are set as assignee or reviewer on one.'
              : 'No task matches the current search and filters.'}
          />
        ) : viewMode === 'table' ? (
          <TaskTable groups={groups} groupBy={groupBy} mt={mt} onOpen={setDetailTaskId} dragEditable={dragEditable} canWriteTask={canWriteTask} />
        ) : viewMode === 'kanban' ? (
          <KanbanBoard groups={groups} groupBy={groupBy} mt={mt} onOpen={setDetailTaskId} dragEditable={dragEditable} canWriteTask={canWriteTask} />
        ) : (
          <TaskGallery groups={groups} mt={mt} onOpen={setDetailTaskId} />
        )}
      </div>

      {/* ── Detail popup (RABBIT reuse) ──
          🚨 NOT this session's component. It is RABBIT's, 680 lines, and it
          still carries its own dark surface, a 2px #f97316 frame and a heavy
          shadow. Folding it into the kit's Dialog changes RABBIT too, so it
          is scheduled with lane B2 (review D31). */}
      {detailTaskId && popupCtx && (
        <TaskDetailPopup
          taskId={detailTaskId}
          ctx={popupCtx}
          onClose={() => setDetailTaskId(null)}
        />
      )}

      {/* W9, ruled 2026-09-11: "convert the four native confirm pop-ups",
          extended to every `window.confirm` in the app, each lane converting
          its own as it passes. The copy is the confirm's, word for word, so
          the only thing that changed is which surface asks. */}
      {confirmDeleteId && (
        <Dialog
          width="confirm"
          title="Delete this task?"
          onClose={() => setConfirmDeleteId(null)}
          footer={(
            <>
              <Button autoFocus onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  const id = confirmDeleteId
                  setConfirmDeleteId(null)
                  mt.deleteTask(id).catch(() => {})
                  // The popup stayed open behind the Dialog because the ctx
                  // callback vetoed; closing it here is what the old `true`
                  // return used to make TaskDetailPopup do.
                  setDetailTaskId(null)
                }}
              >
                Delete task
              </Button>
            </>
          )}
        >
          It goes to the 30-day trash, and admins can restore it.
        </Dialog>
      )}
    </div>
  )
}

// ── Filters ─────────────────────────────────────────────────
function FilterPanel({ filters, setFilters, projectsById }) {
  const valueOptions = (field) => {
    if (field === 'status')   return TASK_STATUSES.map(s => ({ value: s, label: statusLabel(s) }))
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
    <div className="dash-filters">
      {/* One Label row above the first filter only, and three fixed
          proportional widths, so stacked filters read as a table instead of a
          pile of identical wells (Hick's hotspot 3). No interaction change:
          the same three selects in the same order. */}
      {filters.length > 0 && (
        <div className="dash-filter-head" aria-hidden="true">
          <span>Field</span><span>Test</span><span>Value</span>
        </div>
      )}
      {filters.map((f, i) => (
        <div key={i} className="dash-filter-row">
          <Select
            size="sm"
            value={f.field}
            onChange={v => update(i, { field: v ?? 'status', value: '' })}
            options={FILTER_FIELDS.map(o => ({ value: o.key, label: o.label }))}
            aria-label={`Filter ${i + 1} field`}
          />
          <Select
            size="sm"
            value={f.op}
            onChange={v => update(i, { op: v ?? 'is' })}
            options={[{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }]}
            aria-label={`Filter ${i + 1} test`}
          />
          <Select
            size="sm"
            value={f.value}
            onChange={v => update(i, { value: v ?? '' })}
            placeholder="—"
            options={valueOptions(f.field)}
            aria-label={`Filter ${i + 1} value`}
          />
          <IconButton
            icon={X}
            size="sm"
            title="Remove filter"
            onClick={() => setFilters(prev => prev.filter((_, idx) => idx !== i))}
          />
        </div>
      ))}
      <Button
        size="sm"
        className="dash-add-filter"
        onClick={() => setFilters(prev => [...prev, { field: 'status', op: 'is', value: '' }])}
      >
        <Plus aria-hidden="true" /> Add filter
      </Button>
    </div>
  )
}

// ── Table ───────────────────────────────────────────────────
function TaskTable({ groups, groupBy, mt, onOpen, dragEditable, canWriteTask }) {
  return (
    // The table pads its own cells and its rows must reach the hairline on
    // every side, so the card does not pad (F2's Team Members pattern).
    <Card pad={false} className="dash-table-card">
      <Table
        aria-label="My tasks across every project"
        head={(
          <Row>
            {TASK_COLUMNS.map(c => (
              <Th key={c.key} width={c.width} numeric={c.numeric}>{c.header}</Th>
            ))}
          </Row>
        )}
      >
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
      </Table>
    </Card>
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
      {/* `data-empty` is review D8's executable half: the status grouping
          keeps its empty bands on purpose, so a band with nothing under it
          recedes to a hairline and a label instead of wearing a filled well
          and a count chip and reading as content. */}
      <Row
        className="dash-group-row"
        data-dragover={String(dragOver)}
        data-empty={group.tasks.length === 0 ? 'true' : undefined}
        onDragEnter={droppable ? (e) => { e.preventDefault(); dragCountRef.current++; if (dragCountRef.current === 1) setDragOver(true) } : undefined}
        onDragOver={droppable ? (e) => e.preventDefault() : undefined}
        onDragLeave={droppable ? () => { dragCountRef.current--; if (dragCountRef.current <= 0) { dragCountRef.current = 0; setDragOver(false) } } : undefined}
        onDrop={droppable ? handleDrop : undefined}
      >
        <Td colSpan={COLS}>
          <span className="dash-group-label">
            {groupBy === 'status' && <StatusDot status={group.key} aria-hidden="true" role={undefined} aria-label={undefined} title="" />}
            <span className="dash-group-name">{group.label}</span>
            <span className="dash-group-count">{group.tasks.length}</span>
          </span>
        </Td>
      </Row>
      {group.tasks.map(task => (
        <Row
          key={task.id}
          interactive
          draggable={canWriteTask(task)}
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move' }}
          onClick={() => onOpen(task.id)}
        >
          {/* Three levels where there was one ink, one size and one face: the
              title carries the weight, the parent project and the asset are
              the same ink at 400, and the two dates are right-aligned tabular
              figures with the weight on Due, which is what the default sort
              is on (review D6, alignment 5). */}
          <Td className="dash-cell-title" title={task.title}>{task.title}</Td>
          <Td title={task.project?.title || undefined}>
            {task.project?.title || <span className="dash-empty-value">—</span>}
          </Td>
          <Td title={task.asset?.name || undefined}>
            {task.asset?.name || <span className="dash-empty-value">—</span>}
          </Td>
          <Td>
            <StatusCell
              value={task.status}
              disabled={!canWriteTask(task)}
              onChange={v => mt.patchTask(task.id, { status: v }).catch(() => {})}
            />
          </Td>
          <Td>
            <PriorityCell
              value={task.priority}
              disabled={!canWriteTask(task)}
              onChange={v => mt.patchTask(task.id, { priority: v }).catch(() => {})}
            />
          </Td>
          <Td><RoleBadge role={myRoleOnTask(task, mt.userId)} /></Td>
          <Td numeric><DateValue value={task.start_date} /></Td>
          <Td numeric className="dash-cell-due"><DateValue value={task.end_date} /></Td>
        </Row>
      ))}
    </>
  )
}

// ── Kanban ──────────────────────────────────────────────────
function KanbanBoard({ groups, groupBy, mt, onOpen, dragEditable, canWriteTask }) {
  return (
    <div className="dash-board">
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
      className="dash-kanban-col"
      data-dragover={String(dragOver)}
      onDragEnter={droppable ? (e) => { e.preventDefault(); dragCountRef.current++; if (dragCountRef.current === 1) setDragOver(true) } : undefined}
      onDragOver={droppable ? (e) => e.preventDefault() : undefined}
      onDragLeave={droppable ? () => { dragCountRef.current--; if (dragCountRef.current <= 0) { dragCountRef.current = 0; setDragOver(false) } } : undefined}
      onDrop={droppable ? handleDrop : undefined}
    >
      <div className="dash-kanban-head">
        <span className="dash-group-label">
          {groupBy === 'status' && <StatusDot status={group.key} aria-hidden="true" role={undefined} aria-label={undefined} title="" />}
          <span className="dash-group-name">{group.label}</span>
          <span className="dash-group-count">{group.tasks.length}</span>
        </span>
      </div>
      <div className="dash-kanban-body">
        {group.tasks.map(task => (
          <TaskCard key={task.id} task={task} mt={mt} onOpen={onOpen} draggable={droppable && canWriteTask(task)} />
        ))}
      </div>
    </div>
  )
}

// One card for both the board and the gallery. They were two cards carrying
// the same content under two different codes: a 3px STATUS edge along the top
// of the kanban card and a 3px PRIORITY edge along the bottom of the gallery
// card, so a person who learned one had to unlearn it to read the other
// (review D18). Status keeps the edge, at the top, in both; priority is a
// Label-step word in both. The gallery's 80px band holding the first letter
// of the title at 24px — the loudest object on the card restating its
// quietest — is gone (D17).
// One card for both views, which is the point — so there is no per-view
// variant prop. An earlier cut passed `wide` from the gallery and rendered
// `data-wide`, which no rule read (review round 1, finding 9).
function TaskCard({ task, mt, onOpen, draggable = false }) {
  const tone = priorityTone(task.priority)
  return (
    <Card
      pad={false}
      className="dash-card"
      draggable={draggable}
      onDragStart={draggable ? (e) => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move' } : undefined}
      onClick={() => onOpen(task.id)}
    >
      <span className="dash-card-edge" aria-hidden="true">
        <StatusDot status={task.status} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
      </span>
      <div className="dash-card-body">
        <div className="dash-card-title">{task.title}</div>
        <div className="dash-card-meta">
          {task.project?.title || '—'}{task.asset?.name ? ` · ${task.asset.name}` : ''}
        </div>
        <div className="dash-card-foot">
          <span className="dash-card-status">{statusLabel(task.status)}</span>
          <span className="dash-card-date"><DateValue value={task.end_date} /></span>
        </div>
        <div className="dash-card-foot">
          <RoleBadge role={myRoleOnTask(task, mt.userId)} />
          <Badge className="dash-card-priority" data-tone={tone}>{fmt(task.priority)}</Badge>
        </div>
      </div>
    </Card>
  )
}

// ── Gallery ─────────────────────────────────────────────────
function TaskGallery({ groups, mt, onOpen }) {
  const tasks = groups.flatMap(g => g.tasks)
  return (
    <div className="dash-gallery">
      {tasks.map(task => (
        <TaskCard key={task.id} task={task} mt={mt} onOpen={onOpen} />
      ))}
    </div>
  )
}
