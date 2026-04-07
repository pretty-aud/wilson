// ============================================================
// RABBIT — TimelineView (Notion-style two-panel timeline)
// ============================================================
//
// Layout:
//
//   ┌────────────────────────────────────────────────────────┐
//   │ Header strip                                            │
//   ├────────────────────────────────────────────────────────┤
//   │ Summary band                                            │
//   ├────────────────────────────────────────────────────────┤
//   │ ▼ OVERVIEW — month/year axis, project ± years           │
//   │   ╔═════ visible window frame (drag to scroll) ═════╗  │
//   │   ║ phase / task bars (compressed)                   ║  │
//   │   ╚═══════════════════════════════════════════════════╝  │
//   ├────────────────────────────────────────────────────────┤
//   │ ▼ DETAIL — day/week axis, zoomed gantt                  │
//   │   Phase / Task labels           │ axis + bars            │
//   │   …                              │ ▓▓▓▓▓                  │
//   └────────────────────────────────────────────────────────┘
//
// Notion-isms baked in:
//
//   • Two synchronized panes — overview is the "navigator",
//     detail is the zoomed gantt.
//   • Drag the frame on the overview to scroll the detail.
//   • Drag empty space on either pane to draw a new task.
//   • Drag a bar body to move it; drag a bar edge to squash
//     or stretch (resize) it.
//   • Phases are temporal containers with their own bar — the
//     same drag affordances apply.
//
// Hierarchy / grouping:
//
//   • Phases are ALWAYS rendered as group headers, even with
//     no children, so the user can see what they just created.
//   • A task can attach to a phase directly (phase_id) OR to
//     an asset inside a phase (asset_id). Asset wins for
//     visual nesting when both are set.
//   • Orphan tasks (no asset, no phase) get an "Orphan tasks"
//     bucket at the bottom.
//
// Data model adds (round-trip through the generic sub-entity
// upsert routes — no schema migration needed):
//
//   • phase.start_date / phase.end_date  (ISO YYYY-MM-DD)
//   • task.phase_id                      (uuid, optional)

import { useEffect, useMemo, useRef, useState, forwardRef } from 'react'
import {
  CalendarDays, GitBranch, ZoomIn, ZoomOut, Layers, Boxes, ListChecks,
  AlertTriangle, Plus, X, Trash2, Save, ChevronRight, ChevronDown,
  Settings as SettingsIcon, HelpCircle, Lock, Unlock, Crosshair,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { RABBIT_HELP_SIDEBAR_ITEMS, RabbitHelpContent } from '../rabbitHelpContent.jsx'
import {
  RABBIT_SCHEDULER_PROMPT,
  RABBIT_TASK_RECOMMENDER_PROMPT,
  RABBIT_PHASE_GENERATOR_PROMPT,
} from '../prompts.js'

// ─── Constants ──────────────────────────────────────────────

// Detail-pane zoom levels. Day view is the most zoomed-in: cells
// are large enough to read individual day numbers and weekends.
const ZOOM_LEVELS = [
  { id: 'day',     label: 'Day',     dayPx: 56,  axisFormat: 'day'     },
  { id: 'week',    label: 'Week',    dayPx: 22,  axisFormat: 'week'    },
  { id: 'month',   label: 'Month',   dayPx: 8,   axisFormat: 'month'   },
  { id: 'quarter', label: 'Quarter', dayPx: 4,   axisFormat: 'month'   },
]

// Per-zoom row heights — day view gets a taller row so each
// cell has space for the day number and a comfortable bar.
const ROW_PX_BY_ZOOM = {
  day:     56,
  week:    34,
  month:   30,
  quarter: 28,
}

const DEFAULT_ROW_PX  = 30
const HEADER_PX        = 44
const LABEL_W          = 240
const OVERVIEW_HEIGHT  = 160
const OVERVIEW_HEADER  = 24
const OVERVIEW_ROW_PX       = 14                  // legacy fallback / OverviewBar baseline
const OVERVIEW_PHASE_ROW_PX = 22                  // taller rows for phase bars in minimap
const OVERVIEW_TASK_ROW_PX  = 11                  // shorter rows for task bars in minimap
const EDGE_GRAB_PX     = 6
const MIN_DRAG_PX      = 4

// Overview is permanently locked to a weeks-or-larger view.
// Smallest granularity = "week"; the user is never allowed to
// zoom the minimap into per-day mode.
const OVERVIEW_ZOOM = ZOOM_LEVELS.find(z => z.id === 'week') || ZOOM_LEVELS[1]

const TODAY = startOfDay(new Date())

// Settings persistence key — survives reload, scoped to RABBIT.
const RABBIT_SETTINGS_KEY = 'rabbit-timeline-settings-v1'

const DEFAULT_SETTINGS = {
  showWeekends: true,
}

function loadRabbitSettings() {
  try {
    const raw = localStorage.getItem(RABBIT_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}
function saveRabbitSettings(s) {
  try { localStorage.setItem(RABBIT_SETTINGS_KEY, JSON.stringify(s)) } catch {}
}

// ============================================================
// TimelineView
// ============================================================

export default function TimelineView() {
  const ctx = useRabbit()
  const project = ctx?.project
  const phases = ctx?.phases || []
  const assets = ctx?.assets || []
  const tasks  = ctx?.tasks  || []
  const dependencies = ctx?.dependencies || []

  const [zoomId, setZoomId] = useState('week')
  const zoom = ZOOM_LEVELS.find(z => z.id === zoomId) || ZOOM_LEVELS[1]
  const DAY_PX = zoom.dayPx
  const ROW_PX = ROW_PX_BY_ZOOM[zoomId] || DEFAULT_ROW_PX

  // ── settings (persisted) ─────────────────────────────────
  const [settings, setSettings] = useState(() => loadRabbitSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState('settings')
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [helpPage, setHelpPage] = useState(RABBIT_HELP_SIDEBAR_ITEMS[0]?.id || 'rabbit-overview')
  function patchSettings(p) {
    setSettings(prev => {
      const next = { ...prev, ...p }
      saveRabbitSettings(next)
      return next
    })
  }

  // Listen for the WILSON nav strip's "open settings" event so the
  // SETTINGS item can pop the slide-out from outside the timeline.
  useEffect(() => {
    function onOpen() { setSettingsOpen(true) }
    window.addEventListener('rabbit:open-settings', onOpen)
    return () => window.removeEventListener('rabbit:open-settings', onOpen)
  }, [])

  // Day-grain showWeekends switch only matters at day zoom — at
  // larger zooms the visible cells are weeks/months and weekends
  // can't be skipped meaningfully.
  const hideWeekends = !settings.showWeekends && zoomId === 'day'

  // ── editor ───────────────────────────────────────────────
  const [editor, setEditor] = useState(null)
  const closeEditor = () => setEditor(null)

  const openNewTask = (prefill = {}) => setEditor({
    mode:   'task',
    taskId: null,
    draft:  emptyTaskDraft({
      assetId: assets[0]?.id || '',
      phaseId: phases[0]?.id || '',
      ...prefill,
    }),
  })
  const openNewPhase = (prefill = {}) => setEditor({
    mode:    'phase',
    phaseId: null,
    draft:   emptyPhaseDraft(prefill),
  })
  const openEditTask = (task) => setEditor({
    mode:   'task',
    taskId: task.id,
    draft: {
      title:      task.title || '',
      asset_id:   task.asset_id || '',
      phase_id:   task.phase_id || '',
      start_date: toDateInputValue(task.start_date),
      end_date:   toDateInputValue(task.end_date),
      bid_days:   task.bid_days ?? '',
      role:       task.assigned_position || task.assigned_role_slug || '',
      priority:   task.priority || 'medium',
      status:     task.status || 'waiting_to_start',
    },
  })
  const openEditPhase = (phase) => setEditor({
    mode:    'phase',
    phaseId: phase.id,
    draft: {
      name:            phase.name || '',
      description:     phase.description || '',
      parent_phase_id: phase.parent_phase_id || '',
      start_date:      toDateInputValue(phase.start_date),
      end_date:        toDateInputValue(phase.end_date),
    },
  })

  // ── derived data ─────────────────────────────────────────
  const criticalSet = useMemo(() => {
    const path = ctx?.selectCriticalPath?.() || []
    return new Set(path)
  }, [ctx])

  const schedule = useMemo(
    () => buildSchedule({ phases, assets, tasks, dependencies }),
    [phases, assets, tasks, dependencies]
  )

  const rows = useMemo(
    () => buildRows({ phases, assets, tasks, schedule }),
    [phases, assets, tasks, schedule]
  )

  const summary = useMemo(
    () => buildSummary({ phases, assets, tasks, schedule, criticalSet }),
    [phases, assets, tasks, schedule, criticalSet]
  )

  // Overview span: project min ‑ 6mo … project max + 18mo, with
  // a sane default when there's no content yet so the user has
  // something to draw on.
  const overviewSpan = useMemo(() => computeOverviewSpan(schedule), [schedule])

  // ── detail-pane scroll wiring ────────────────────────────
  // We track the detail container's scrollLeft + measured width
  // so the overview frame can mirror what's visible.
  const detailRef = useRef(null)
  const [detailScrollLeft, setDetailScrollLeft] = useState(0)
  const [detailViewportW, setDetailViewportW]   = useState(800)

  useEffect(() => {
    const el = detailRef.current
    if (!el) return
    function onScroll() { setDetailScrollLeft(el.scrollLeft) }
    function onResize() { setDetailViewportW(el.clientWidth) }
    onResize()
    el.addEventListener('scroll', onScroll)
    const ro = new ResizeObserver(onResize)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  // First mount: scroll detail to today so the user lands on
  // something useful instead of the very start of the buffer.
  const didCenterOnTodayRef = useRef(false)
  useEffect(() => {
    if (didCenterOnTodayRef.current) return
    if (!detailRef.current) return
    const todayDays = daysBetween(overviewSpan.start, TODAY)
    detailRef.current.scrollLeft = Math.max(0, todayDays * DAY_PX - 200)
    didCenterOnTodayRef.current = true
  }, [overviewSpan.start, DAY_PX])

  // ── viewport stabilization ──────────────────────────────
  // When the user drags a task or phase, the schedule rebuilds and
  // overviewSpan may shift its start date earlier or later. The
  // detail container's scrollLeft is in pixels relative to that
  // start, so a span shift would yank the user's viewport sideways.
  // We compensate by adjusting scrollLeft by the same number of
  // days the span moved, so whatever date the user was looking at
  // stays in the same place on screen. Same compensation when
  // DAY_PX changes (zoom level switch) — keep the centered date
  // anchored under the cursor instead of jumping to scrollLeft 0.
  const prevSpanStartRef = useRef(overviewSpan.start)
  const prevDayPxRef     = useRef(DAY_PX)
  useEffect(() => {
    const el = detailRef.current
    if (!el) return
    const prevStart = prevSpanStartRef.current
    const prevPx    = prevDayPxRef.current
    const currStart = overviewSpan.start
    const currPx    = DAY_PX

    // Day at the left edge of the visible window before this update.
    const visibleDayBefore = (el.scrollLeft / Math.max(1, prevPx)) +
      (prevStart && currStart ? 0 : 0)

    // Where that same calendar day lands AFTER the update.
    const startDeltaDays = (prevStart && currStart) ? daysBetween(currStart, prevStart) : 0
    // After update, dayBefore (in old coords) maps to (visibleDayBefore + startDeltaDays) in new coords.
    const newScrollLeft = (visibleDayBefore + startDeltaDays) * currPx

    if (Number.isFinite(newScrollLeft) && newScrollLeft >= 0) {
      // Only re-anchor when something actually moved — avoids fighting
      // the user's own scroll events.
      const startMoved = prevStart && currStart && +prevStart !== +currStart
      const zoomChanged = prevPx !== currPx
      if (startMoved || zoomChanged) {
        el.scrollLeft = newScrollLeft
      }
    }

    prevSpanStartRef.current = currStart
    prevDayPxRef.current     = currPx
  }, [overviewSpan.start, DAY_PX])

  // Visible window in days from overviewSpan.start.
  const visibleStartDays = Math.max(0, detailScrollLeft / DAY_PX)
  const visibleSpanDays  = Math.max(1, (detailViewportW - LABEL_W) / DAY_PX)
  const visibleEndDays   = visibleStartDays + visibleSpanDays

  function scrollDetailToDay(dayOffset) {
    if (!detailRef.current) return
    const px = Math.max(0, dayOffset * DAY_PX)
    detailRef.current.scrollLeft = px
  }

  // Center the detail viewport on today (or any date offset). Used
  // by the Crosshair button next to the detail-zoom toolbar so the
  // user can snap back to "now" with one click no matter how far
  // they've panned.
  function centerDetailOnToday() {
    const el = detailRef.current
    if (!el) return
    const todayDays = daysBetween(overviewSpan.start, TODAY)
    const viewportContentW = Math.max(100, (el.clientWidth || detailViewportW) - LABEL_W)
    const targetPx = todayDays * DAY_PX - viewportContentW / 2
    el.scrollLeft = Math.max(0, targetPx)
  }

  // ── overview measurement ────────────────────────────────
  // Overview is a fixed-width minimap whose internal scale is
  // derived from container width: every overviewSpan day fits.
  const overviewRef = useRef(null)
  const [overviewWidth, setOverviewWidth] = useState(1000)
  useEffect(() => {
    const el = overviewRef.current
    if (!el) return
    function onResize() { setOverviewWidth(el.clientWidth) }
    onResize()
    const ro = new ResizeObserver(onResize)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const OVERVIEW_DAY_PX = overviewWidth / Math.max(1, overviewSpan.days)

  // ── early return: no project ─────────────────────────────
  if (!project) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: '#1c1917' }}>
        <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>
          No project loaded
        </span>
      </div>
    )
  }

  // Detail chart geometry.
  const totalDays = overviewSpan.days
  const chartW = totalDays * DAY_PX

  // Today line offset in detail pane.
  const todayDays = daysBetween(overviewSpan.start, TODAY)

  // ── render ───────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* ── Header strip ── */}
      <div
        className="flex items-center gap-3 px-6 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid #44403c', backgroundColor: '#292524' }}
      >
        <CalendarDays className="w-4 h-4" style={{ color: '#fb923c' }} />
        <span className="text-[11px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>
          Timeline
        </span>
        <span className="text-[10px] font-mono" style={{ color: '#a8a29e' }}>
          · {phases.length} phase{phases.length === 1 ? '' : 's'} · {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </span>
        <span
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm"
          style={{ color: '#a8a29e', backgroundColor: '#1c1917', border: '1px solid #44403c' }}
        >
          <GitBranch className="w-3 h-3" />
          drag to draw · resize edges to stretch
        </span>

        <button
          type="button"
          onClick={() => openNewPhase()}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors"
          style={{ color: '#a8a29e', backgroundColor: '#1c1917', border: '1px solid #44403c' }}
        >
          <Plus className="w-3 h-3" />
          Phase
        </button>
        <button
          type="button"
          onClick={() => openNewTask()}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors"
          style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
        >
          <Plus className="w-3 h-3" />
          Task
        </button>

        {/* Right-side icon group: settings (slide-out) + help */}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Timeline settings"
            className="p-1.5 rounded-sm transition-colors hover:bg-stone-700"
            style={{ color: '#a8a29e', border: '1px solid #44403c', backgroundColor: '#1c1917' }}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            title="Help & Documentation"
            className="p-1.5 rounded-sm transition-colors hover:bg-stone-700"
            style={{ color: '#a8a29e', border: '1px solid #44403c', backgroundColor: '#1c1917' }}
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Summary band ── */}
      <SummaryBand summary={summary} />

      {/* ── Overview pane (top half) ── */}
      <OverviewPane
        ref={overviewRef}
        phases={phases}
        assets={assets}
        tasks={tasks}
        schedule={schedule}
        criticalSet={criticalSet}
        span={overviewSpan}
        dayPx={OVERVIEW_DAY_PX}
        visibleStartDays={visibleStartDays}
        visibleEndDays={visibleEndDays}
        onScrollDetailToDay={scrollDetailToDay}
        onCreateTaskFromDates={(startDate, endDate) =>
          openNewTask({
            start_date: toDateInputValue(startDate),
            end_date:   toDateInputValue(endDate),
          })
        }
        onUpdateTask={(taskId, patch) => ctx.updateTask(taskId, patch).catch(() => {})}
        onUpdatePhase={(phaseId, patch) => ctx.updatePhase(phaseId, patch).catch(() => {})}
        onEditTask={openEditTask}
        onEditPhase={openEditPhase}
      />

      {/* ── Detail-pane zoom toolbar (sits between minimap + gantt) ── */}
      <DetailZoomToolbar
        zoomId={zoomId}
        onChange={setZoomId}
        onCenterToday={centerDetailOnToday}
      />

      {/* ── Detail pane (bottom half) ── */}
      <DetailPane
        scrollRef={detailRef}
        rows={rows}
        span={overviewSpan}
        totalDays={totalDays}
        chartW={chartW}
        dayPx={DAY_PX}
        rowPx={ROW_PX}
        zoom={zoom}
        zoomId={zoomId}
        hideWeekends={hideWeekends}
        criticalSet={criticalSet}
        todayDays={todayDays}
        dependencies={dependencies}
        phases={phases}
        onCreateTaskFromDates={(startDate, endDate, phaseId, assetId) =>
          openNewTask({
            start_date: toDateInputValue(startDate),
            end_date:   toDateInputValue(endDate),
            phase_id:   phaseId || '',
            asset_id:   assetId || '',
          })
        }
        onUpdateTask={(taskId, patch) => ctx.updateTask(taskId, patch).catch(() => {})}
        onUpdatePhase={(phaseId, patch) => ctx.updatePhase(phaseId, patch).catch(() => {})}
        onToggleCollapse={(phase) =>
          ctx.updatePhase(phase.id, { collapsed: !phase.collapsed }).catch(() => {})
        }
        onLinkTasks={(predId, succId) => ctx.linkTasks(predId, succId).catch(() => {})}
        onLinkPhases={(predId, succId) => ctx.linkPhases(predId, succId).catch(() => {})}
        onUnlinkDependency={(depId) => ctx.unlinkDependency(depId).catch(() => {})}
        onMoveTaskToPhase={(taskId, phaseId) => {
          // Drag-drop a task into another phase row in the label gutter.
          // We update the task's phase_id; the buildSchedule pass will
          // re-derive the phase span on the next render.
          ctx.updateTask(taskId, { phase_id: phaseId || null }).catch(() => {})
        }}
        onNewTaskInPhase={(phaseId, startDate, endDate) => {
          // Clicking the empty drop zone under an expanded phase
          // opens a blank task editor prefilled with that phase.
          // If the user clicked on a specific X position in the
          // chart area, the start/end dates are derived from the
          // cursor position so the new task begins where the user
          // intends.
          openNewTask({
            phase_id:   phaseId || '',
            start_date: startDate ? toDateInputValue(startDate) : '',
            end_date:   endDate   ? toDateInputValue(endDate)   : '',
          })
        }}
        onEditTask={openEditTask}
        onEditPhase={openEditPhase}
      />

      {/* ── Editor — sibling so it survives any branch switch ── */}
      {editor && (
        <TaskEditor
          editor={editor}
          assets={assets}
          phases={phases}
          ctx={ctx}
          onClose={closeEditor}
        />
      )}

      {/* ── Settings slide-out (DOG/OTTER pattern: 40% width, slide-in) ── */}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          patchSettings={patchSettings}
          settingsTab={settingsTab}
          setSettingsTab={setSettingsTab}
          onClose={() => setSettingsOpen(false)}
          onOpenHelp={() => {
            setSettingsOpen(false)
            setShowHelpModal(true)
          }}
        />
      )}

      {/* ── Help & Documentation modal ── */}
      {showHelpModal && (
        <HelpModal
          helpPage={helpPage}
          setHelpPage={setHelpPage}
          onClose={() => setShowHelpModal(false)}
        />
      )}
    </div>
  )
}

// ============================================================
// OverviewPane — minimap + frame
// ============================================================

const OverviewPane = forwardRef(function OverviewPane({
  phases, assets, tasks, schedule, criticalSet,
  span, dayPx,
  visibleStartDays, visibleEndDays,
  onScrollDetailToDay,
  onCreateTaskFromDates,
  onUpdateTask, onUpdatePhase,
  onEditTask, onEditPhase,
}, forwardedRef) {
  // We render every phase as a row, with its task children as
  // smaller pills below. Orphan tasks (no phase) get a final
  // "Other" row.
  const overviewRows = useMemo(
    () => buildOverviewRows({ phases, assets, tasks, schedule }),
    [phases, assets, tasks, schedule]
  )

  // Drag-on-empty: create task. Drag-on-frame: scroll detail.
  // Drag-on-bar: move/resize bar (delegated to Bar).
  const bgRef = useRef(null)
  const [dragPreview, setDragPreview] = useState(null) // {kind:'create',leftPx,widthPx}

  function handleBackgroundMouseDown(e) {
    // Only react to clicks landing on the background itself, not
    // on a bar / frame / button.
    if (e.target !== bgRef.current) return
    if (e.button !== 0) return
    e.preventDefault()
    const rect = bgRef.current.getBoundingClientRect()
    const startX = e.clientX - rect.left
    let endX = startX
    setDragPreview({ kind: 'create', leftPx: startX, widthPx: 0 })
    function onMove(ev) {
      endX = ev.clientX - rect.left
      const lo = Math.min(startX, endX)
      const hi = Math.max(startX, endX)
      setDragPreview({ kind: 'create', leftPx: lo, widthPx: hi - lo })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const lo = Math.min(startX, endX)
      const hi = Math.max(startX, endX)
      setDragPreview(null)
      if (hi - lo < MIN_DRAG_PX) return
      const startDays = lo / dayPx
      const endDays   = hi / dayPx
      const startDate = addDays(span.start, Math.round(startDays))
      const endDate   = addDays(span.start, Math.max(1, Math.round(endDays)))
      onCreateTaskFromDates(startDate, endDate)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function handleFrameMouseDown(e) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX  = e.clientX
    const startVisibleDays = visibleStartDays
    function onMove(ev) {
      const dx = ev.clientX - startX
      const ddays = dx / dayPx
      onScrollDetailToDay(startVisibleDays + ddays)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Click-to-jump on the background (without drag): scroll the
  // detail pane to put that day at the left edge.
  function handleBackgroundClick(e) {
    if (e.target !== bgRef.current) return
    const rect = bgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    onScrollDetailToDay(x / dayPx - (visibleEndDays - visibleStartDays) / 2)
  }

  const frameLeft  = visibleStartDays * dayPx
  const frameWidth = (visibleEndDays - visibleStartDays) * dayPx
  const todayLeft  = daysBetween(span.start, TODAY) * dayPx

  // Variable-height layout for the minimap — phase rows are taller
  // than task rows so the phase bars read as "bigger / more
  // important" at a glance. We pre-compute each row's top and
  // height so the containment overlay can share the same layout.
  const rowLayouts = useMemo(() => {
    const out = []
    let y = 0
    for (let i = 0; i < overviewRows.length; i++) {
      const r = overviewRows[i]
      const h = r.kind === 'phase' ? OVERVIEW_PHASE_ROW_PX : OVERVIEW_TASK_ROW_PX
      out.push({ top: y, height: h })
      y += h
    }
    return { items: out, totalHeight: y }
  }, [overviewRows])
  const innerH = rowLayouts.totalHeight
  const ticks = useMemo(() => buildOverviewTicks(span.start, span.days), [span.start, span.days])

  return (
    <div
      ref={forwardedRef}
      className="flex-shrink-0 relative"
      style={{
        height: OVERVIEW_HEIGHT,
        backgroundColor: '#1c1917',
        borderBottom: '2px solid #44403c',
        overflow: 'hidden',
      }}
    >
      {/* Axis header */}
      <div
        className="relative w-full"
        style={{
          height: OVERVIEW_HEADER,
          backgroundColor: '#292524',
          borderBottom: '1px solid #44403c',
        }}
      >
        {ticks.map(tick => (
          <div
            key={tick.key}
            className="absolute top-0 bottom-0 flex flex-col justify-end pb-0.5 px-1"
            style={{
              left: tick.offset * dayPx,
              borderLeft: tick.major ? '2px solid #57534e' : '1px solid #44403c',
            }}
          >
            <span className="text-[9px] font-mono whitespace-nowrap" style={{ color: tick.major ? '#fb923c' : '#78716c' }}>
              {tick.label}
            </span>
          </div>
        ))}
      </div>

      {/* Body — bars + frame + drag preview */}
      <div
        ref={bgRef}
        className="relative w-full overflow-y-auto"
        style={{
          height: OVERVIEW_HEIGHT - OVERVIEW_HEADER,
          cursor: 'crosshair',
        }}
        onMouseDown={handleBackgroundMouseDown}
        onClick={handleBackgroundClick}
      >
        <div className="relative" style={{ height: Math.max(innerH, OVERVIEW_HEIGHT - OVERVIEW_HEADER) }}>
          {/* Today line */}
          {todayLeft >= 0 && todayLeft <= innerH + dayPx && (
            <div
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{ left: todayLeft, width: 1, backgroundColor: '#fca5a5', zIndex: 4 }}
            />
          )}

          {/* Containment rails — draw a tree branch from each phase
              row down to its child task rows so tasks visually attach
              to their parent phase. Dependencies are intentionally
              NOT drawn here. */}
          <OverviewContainmentOverlay
            rows={overviewRows}
            rowLayouts={rowLayouts}
            span={span}
            dayPx={dayPx}
          />

          {/* Rows */}
          {overviewRows.map((r, i) => {
            const layout = rowLayouts.items[i]
            return (
              <div
                key={r.key}
                className="absolute left-0 right-0"
                style={{
                  top: layout.top,
                  height: layout.height,
                  borderBottom: '1px solid #292524',
                }}
              >
                {r.start && r.end && (
                  <OverviewBar
                    row={r}
                    span={span}
                    dayPx={dayPx}
                    rowH={layout.height}
                    critical={r.kind === 'task' && criticalSet.has(r.task?.id)}
                    onUpdateTask={onUpdateTask}
                    onUpdatePhase={onUpdatePhase}
                    onEditTask={onEditTask}
                    onEditPhase={onEditPhase}
                  />
                )}
              </div>
            )
          })}

          {/* Drag preview */}
          {dragPreview && (
            <div
              className="absolute pointer-events-none rounded-sm"
              style={{
                left: dragPreview.leftPx,
                width: dragPreview.widthPx,
                top: 4,
                bottom: 4,
                backgroundColor: 'rgba(234, 88, 12, 0.25)',
                border: '1px dashed #fb923c',
                zIndex: 6,
              }}
            />
          )}

          {/* Visible-window frame */}
          <div
            className="absolute top-0 bottom-0 cursor-grab active:cursor-grabbing"
            style={{
              left: frameLeft,
              width: Math.max(8, frameWidth),
              border: '2px solid #fb923c',
              backgroundColor: 'rgba(251, 146, 60, 0.10)',
              boxShadow: '0 0 0 1px rgba(28,25,23,0.6) inset',
              zIndex: 5,
            }}
            onMouseDown={handleFrameMouseDown}
            title="Drag to scroll the detail pane"
          />
        </div>
      </div>
    </div>
  )
})

// ============================================================
// OverviewContainmentOverlay — draws phase→task tree rails on
// the minimap so the user can see at a glance which tasks belong
// to which phase. NOT a dependency renderer — these are pure
// containment branches. Tasks that have no parent phase get no
// rail.
// ============================================================

function OverviewContainmentOverlay({ rows, rowLayouts, span, dayPx }) {
  // Group child task row indices by their parent phase id, and
  // remember each phase row's own index.
  const { phaseIndex, childrenByPhase } = useMemo(() => {
    const phaseIndex = {}      // phaseId → row index
    const childrenByPhase = {} // phaseId → array of row indices
    rows.forEach((r, i) => {
      if (r.kind === 'phase' && r.phaseId) {
        phaseIndex[r.phaseId] = i
      }
    })
    rows.forEach((r, i) => {
      if (r.kind === 'task' && r.parentPhaseId && phaseIndex[r.parentPhaseId] !== undefined) {
        if (!childrenByPhase[r.parentPhaseId]) childrenByPhase[r.parentPhaseId] = []
        childrenByPhase[r.parentPhaseId].push(i)
      }
    })
    return { phaseIndex, childrenByPhase }
  }, [rows])

  if (!rows.length) return null

  // Use variable row heights if the parent supplied a layout map;
  // otherwise fall back to the legacy fixed row height.
  function rowTop(i) {
    if (rowLayouts?.items?.[i]) return rowLayouts.items[i].top
    return i * OVERVIEW_ROW_PX
  }
  function rowHeight(i) {
    if (rowLayouts?.items?.[i]) return rowLayouts.items[i].height
    return OVERVIEW_ROW_PX
  }
  function rowCenterY(i) {
    return rowTop(i) + rowHeight(i) / 2
  }
  const totalH = rowLayouts?.totalHeight ?? rows.length * OVERVIEW_ROW_PX
  // The SVG covers the entire body area; child x positions come
  // from row.start dates × dayPx.
  const RAIL_COLOR = '#a8a29e'
  const RAIL_WIDTH = 1

  // Helper: compute the X pixel of a row's bar left edge.
  function rowLeftX(r) {
    if (!r?.start) return null
    const offsetDays = daysBetween(span.start, r.start)
    return offsetDays * dayPx
  }

  const segments = []
  for (const phaseId of Object.keys(childrenByPhase)) {
    const phaseRowIdx = phaseIndex[phaseId]
    const phaseRow = rows[phaseRowIdx]
    if (!phaseRow) continue
    const childIdxs = childrenByPhase[phaseId]
    if (!childIdxs.length) continue

    // Origin: vertical center of the phase row, just under its bar
    // — we anchor on the LEFT edge of the phase bar so the rail
    // hangs cleanly below it.
    const phaseBarLeft = rowLeftX(phaseRow)
    if (phaseBarLeft == null) continue
    const phaseRowCenterY = rowCenterY(phaseRowIdx)
    // Indent the rail 4px right of the phase bar's left edge so it
    // visually emerges from inside the phase.
    const railX = phaseBarLeft + 4

    // Find the deepest child row so the rail terminates at the
    // last task center, not below it.
    const lastChildIdx = childIdxs[childIdxs.length - 1]
    const lastChildCenterY = rowCenterY(lastChildIdx)

    // Vertical rail.
    segments.push(
      <line
        key={`rail-v-${phaseId}`}
        x1={railX}
        y1={phaseRowCenterY + 1}
        x2={railX}
        y2={lastChildCenterY}
        stroke={RAIL_COLOR}
        strokeWidth={RAIL_WIDTH}
        strokeLinecap="round"
        opacity={0.55}
      />
    )

    // One horizontal connector per child.
    for (const ci of childIdxs) {
      const childRow = rows[ci]
      const childLeft = rowLeftX(childRow)
      if (childLeft == null) continue
      const childCenterY = rowCenterY(ci)
      // Connector goes from rail X horizontally over to the child
      // task bar's left edge. If the child starts to the LEFT of
      // the rail (rare but possible when a task starts before its
      // phase), draw the connector toward it anyway — a leftward
      // line still reads as containment.
      segments.push(
        <line
          key={`rail-h-${phaseId}-${childRow.task?.id || ci}`}
          x1={railX}
          y1={childCenterY}
          x2={childLeft}
          y2={childCenterY}
          stroke={RAIL_COLOR}
          strokeWidth={RAIL_WIDTH}
          strokeLinecap="round"
          opacity={0.55}
        />
      )
    }
  }

  if (!segments.length) return null

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      width="100%"
      height={totalH}
      style={{ zIndex: 2, overflow: 'visible' }}
    >
      {segments}
    </svg>
  )
}

// ============================================================
// OverviewBar — compressed bar with squash/stretch + click
// ============================================================

function OverviewBar({ row, span, dayPx, rowH, critical, onUpdateTask, onUpdatePhase, onEditTask, onEditPhase }) {
  const offsetDays = daysBetween(span.start, row.start)
  const lengthDays = Math.max(0.5, daysBetween(row.start, row.end))
  const left  = offsetDays * dayPx
  const width = Math.max(2, lengthDays * dayPx)
  // Fall back to legacy constant if the parent didn't pass a row
  // height (e.g. during the first paint or from legacy callers).
  const effectiveRowH = rowH || OVERVIEW_ROW_PX
  // Inside-row padding so the bar sits comfortably, leaving a tiny
  // 2px gutter top and bottom.
  const barH = Math.max(4, effectiveRowH - 4)

  // Lifecycle palette — picks active / upcoming / completed based
  // on the row's dates + status. Phase bars use the phaseStyle
  // variant which is slightly more prominent.
  const tone = barTone(row, critical, row.kind === 'phase')

  function onMouseDown(e) {
    if (e.button !== 0) return
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const isLeftEdge  = offsetX < EDGE_GRAB_PX
    const isRightEdge = offsetX > rect.width - EDGE_GRAB_PX
    const mode = isLeftEdge ? 'resize-start' : isRightEdge ? 'resize-end' : 'move'

    const origStart = row.start
    const origEnd   = row.end
    const startMouseX = e.clientX
    let moved = false

    function onMove(ev) {
      const dx = ev.clientX - startMouseX
      if (Math.abs(dx) > MIN_DRAG_PX) moved = true
      const ddays = Math.round(dx / dayPx)
      let newStart = origStart
      let newEnd   = origEnd
      if (mode === 'move') {
        newStart = addDays(origStart, ddays)
        newEnd   = addDays(origEnd, ddays)
      } else if (mode === 'resize-start') {
        newStart = addDays(origStart, ddays)
        if (newStart >= newEnd) newStart = addDays(newEnd, -1)
      } else if (mode === 'resize-end') {
        newEnd = addDays(origEnd, ddays)
        if (newEnd <= newStart) newEnd = addDays(newStart, 1)
      }
      // No live preview here — keeping the overview cheap. The
      // detail pane has the live preview.
      e.currentTarget._draftStart = newStart
      e.currentTarget._draftEnd   = newEnd
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (!moved) {
        // Treat as click → open editor.
        if (row.kind === 'phase') onEditPhase(row.phase)
        else if (row.kind === 'task') onEditTask(row.task)
        return
      }
      const ds = e.currentTarget?._draftStart || origStart
      const de = e.currentTarget?._draftEnd   || origEnd
      const patch = { start_date: toIsoDate(ds), end_date: toIsoDate(de) }
      if (row.kind === 'phase') onUpdatePhase(row.phase.id, patch)
      else if (row.kind === 'task') onUpdateTask(row.task.id, patch)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const isPhase = row.kind === 'phase'
  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute rounded-sm"
      style={{
        left, width,
        top: 2,
        height: barH,
        backgroundColor: tone.bg,
        border: isPhase
          ? `2px solid ${tone.border}`
          : `1px solid ${tone.border}`,
        boxShadow: isPhase
          ? '0 1px 3px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)'
          : undefined,
        cursor: 'grab',
      }}
      title={`${row.label} · drag to move · drag edges to resize`}
    />
  )
}

// ============================================================
// DetailPane — zoomed gantt with drag affordances
// ============================================================

function DetailPane({
  scrollRef, rows, span, totalDays, chartW, dayPx, rowPx, zoom, zoomId,
  hideWeekends,
  criticalSet, todayDays,
  dependencies, phases,
  onCreateTaskFromDates,
  onUpdateTask, onUpdatePhase,
  onToggleCollapse,
  onLinkTasks, onLinkPhases, onUnlinkDependency,
  onMoveTaskToPhase,
  onEditTask, onEditPhase,
  onNewTaskInPhase,
}) {
  // When weekends are hidden in day view we mask out Sat/Sun day
  // columns by collapsing their day-pixel width to 0. We build a
  // little prefix-sum so X positions still come out right and bars
  // get cleanly squashed where weekends used to be.
  const dayMask = useMemo(() => {
    if (!hideWeekends) return null
    const mask = new Array(totalDays + 1)
    let cumulative = 0
    for (let i = 0; i <= totalDays; i++) {
      const d = addDays(span.start, i)
      const dow = d.getDay()
      const isWeekend = dow === 0 || dow === 6
      mask[i] = { offsetPx: cumulative, hidden: isWeekend }
      if (!isWeekend) cumulative += dayPx
    }
    return { mask, totalPx: cumulative }
  }, [hideWeekends, totalDays, span.start, dayPx])

  // Helper: convert a day-offset to its visible X coordinate honoring
  // the weekend mask. Used everywhere a bar would otherwise just
  // multiply by dayPx.
  function dayToX(dayOffset) {
    if (!dayMask) return dayOffset * dayPx
    const idx = Math.max(0, Math.min(dayMask.mask.length - 1, Math.round(dayOffset)))
    return dayMask.mask[idx]?.offsetPx ?? dayOffset * dayPx
  }
  const effectiveChartW = dayMask ? dayMask.totalPx : chartW

  const phasesById = useMemo(() => Object.fromEntries((phases || []).map(p => [p.id, p])), [phases])

  const ticks = useMemo(() => buildAxisTicks(span.start, totalDays, zoom), [span.start, totalDays, zoom])

  // Row index lookup for dependency arrow positioning.
  // For each visible row, we know its y-center and bar x-range.
  const rowIndexByTaskId  = useMemo(() => {
    const m = {}
    rows.forEach((r, i) => { if (r.kind === 'task'  && r.task)  m[r.task.id]  = i })
    return m
  }, [rows])
  const rowIndexByPhaseId = useMemo(() => {
    const m = {}
    rows.forEach((r, i) => { if (r.kind === 'phase' && r.phase) m[r.phase.id] = i })
    return m
  }, [rows])

  // Live dependency-drag state — a rubber-band line following the
  // cursor while the user drags from one bar's right-edge handle.
  // Shape: { fromKind, fromId, startX, startY, curX, curY }
  const [depDrag, setDepDrag] = useState(null)

  // Dependency-drag handler — called by DetailBar's handle mousedown.
  // We resolve the target bar on mouseup via elementFromPoint and
  // walk up to find a data-row-key that matches the source kind.
  function beginDependencyDrag({ fromKind, fromId, startX, startY }) {
    setDepDrag({ fromKind, fromId, startX, startY, curX: startX, curY: startY })
    function onMove(ev) {
      // Translate viewport coords → scroll-container coords.
      const containerEl = scrollRef.current
      if (!containerEl) return
      const rect = containerEl.getBoundingClientRect()
      const x = ev.clientX - rect.left + containerEl.scrollLeft - LABEL_W
      const y = ev.clientY - rect.top  + containerEl.scrollTop  - HEADER_PX
      setDepDrag(d => d ? { ...d, curX: x, curY: y } : d)
    }
    function onUp(ev) {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // Resolve drop target.
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      let node = el
      let targetKey = null
      while (node && node !== document.body) {
        if (node.dataset && node.dataset.rowBar) { targetKey = node.dataset.rowBar; break }
        node = node.parentNode
      }
      if (targetKey) {
        const [kind, id] = targetKey.split(':')
        if (kind === fromKind && id && id !== fromId) {
          if (kind === 'task')  onLinkTasks?.(fromId, id)
          if (kind === 'phase') onLinkPhases?.(fromId, id)
        }
      }
      setDepDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Split dependencies into task-kind and phase-kind, and filter
  // to only those whose endpoints are currently visible rows
  // (collapsed phases hide their descendants, so deps that would
  // vanish behind a collapsed phase are skipped).
  const visibleDeps = useMemo(() => {
    const out = []
    for (const d of dependencies || []) {
      const kind = d.kind || 'task'
      const predIdx = kind === 'task'
        ? rowIndexByTaskId[d.predecessor_id]
        : rowIndexByPhaseId[d.predecessor_id]
      const succIdx = kind === 'task'
        ? rowIndexByTaskId[d.successor_id]
        : rowIndexByPhaseId[d.successor_id]
      if (predIdx == null || succIdx == null) continue
      out.push({ dep: d, kind, predIdx, succIdx })
    }
    return out
  }, [dependencies, rowIndexByTaskId, rowIndexByPhaseId])

  // Drag-to-create on the chart background of any row that
  // exposes a phase/asset hint. Bar-level drags handle their
  // own mousedown and stopPropagation so they don't reach here.
  function makeBackgroundMouseDown(row) {
    return function (e) {
      if (e.button !== 0) return
      const containerEl = e.currentTarget
      const rect = containerEl.getBoundingClientRect()
      const startX = e.clientX - rect.left
      let endX = startX
      let preview = null
      const previewEl = document.createElement('div')
      previewEl.style.position = 'absolute'
      previewEl.style.top = '4px'
      previewEl.style.bottom = '4px'
      previewEl.style.borderRadius = '2px'
      previewEl.style.backgroundColor = 'rgba(234, 88, 12, 0.25)'
      previewEl.style.border = '1px dashed #fb923c'
      previewEl.style.pointerEvents = 'none'
      previewEl.style.zIndex = '6'
      containerEl.appendChild(previewEl)
      function applyPreview() {
        const lo = Math.min(startX, endX)
        const hi = Math.max(startX, endX)
        previewEl.style.left = `${lo}px`
        previewEl.style.width = `${hi - lo}px`
        preview = { lo, hi }
      }
      applyPreview()
      function onMove(ev) {
        endX = ev.clientX - rect.left
        applyPreview()
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        previewEl.remove()
        if (!preview || preview.hi - preview.lo < MIN_DRAG_PX) return
        const startDays = preview.lo / dayPx
        const endDays   = Math.max(startDays + 1, preview.hi / dayPx)
        const startDate = addDays(span.start, Math.round(startDays))
        const endDate   = addDays(span.start, Math.round(endDays))
        onCreateTaskFromDates(startDate, endDate, row.phaseHint || null, row.assetHint || null)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
  }

  // ─── Task reparent drag (direct grip handler) ────────────
  //
  // After exhausting HTML5 DnD, React pointer events, and
  // window-level mousedown delegation — none of which worked
  // reliably in Electron on Windows — we use a dedicated grip
  // icon on each task row with a DIRECT onMouseDown handler.
  // This is unambiguous: the user clicks the grip, we start the
  // drag, no click/drag disambiguation, no event delegation,
  // no competing interactions.
  const [reparentHoverPhaseId, setReparentHoverPhaseId] = useState(null)
  const [reparentGhost, setReparentGhost] = useState(null)  // { x, y, label }
  const [dropZoneHover, setDropZoneHover] = useState(null)  // { phaseId, mouseX }
  const suppressNextClickRef = useRef(false)

  function findPhaseIdAtPoint(x, y) {
    if (typeof document === 'undefined') return null
    const el = document.elementFromPoint(x, y)
    if (!el) return null
    let node = el
    while (node && node !== document.body) {
      if (node.dataset && node.dataset.phaseDropTarget) {
        return node.dataset.phaseDropTarget
      }
      node = node.parentElement
    }
    return null
  }

  function startTaskDrag(e, task) {
    if (e.button !== 0) return
    // preventDefault here is CRITICAL: it blocks the browser's
    // default text-selection drag behavior so our mousemove
    // handlers get clean events.
    e.preventDefault()
    e.stopPropagation()
    const taskId = task.id
    const taskLabel = task.title || 'Untitled task'
    const startX = e.clientX
    const startY = e.clientY
    let active = false

    setReparentGhost({ x: e.clientX, y: e.clientY, label: taskLabel })

    function onMove(ev) {
      if (!active) {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (Math.hypot(dx, dy) < 3) {
          setReparentGhost({ x: ev.clientX, y: ev.clientY, label: taskLabel })
          return
        }
        active = true
      }
      setReparentGhost({ x: ev.clientX, y: ev.clientY, label: taskLabel })
      const phaseId = findPhaseIdAtPoint(ev.clientX, ev.clientY)
      setReparentHoverPhaseId(phaseId)
    }

    function onUp(ev) {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('mouseup',   onUp,   true)
      setReparentGhost(null)
      setReparentHoverPhaseId(null)
      // Even without drag movement (i.e. just a click on the grip)
      // we still treat this as a reparent attempt if the cursor
      // happens to be over a different phase. Typically grip click
      // without moving doesn't make sense, so we just bail.
      if (!active) return
      suppressNextClickRef.current = true
      setTimeout(() => { suppressNextClickRef.current = false }, 250)
      const phaseId = findPhaseIdAtPoint(ev.clientX, ev.clientY)
      if (phaseId) {
        const targetPhaseId = phaseId === '__unphased__' ? null : phaseId
        onMoveTaskToPhase?.(taskId, targetPhaseId)
      }
    }

    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('mouseup',   onUp,   true)
  }

  function handleRowClick(row) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }
    if (row.kind === 'phase' && row.phase) onEditPhase(row.phase)
    if (row.kind === 'task'  && row.task)  onEditTask(row.task)
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto relative"
      style={{ backgroundColor: '#1c1917' }}
    >
      <div className="flex" style={{ minWidth: LABEL_W + effectiveChartW }}>
        {/* Sticky label column */}
        <div
          className="flex-shrink-0 sticky left-0 z-20"
          style={{
            width: LABEL_W,
            backgroundColor: '#292524',
            borderRight: '1px solid #44403c',
          }}
        >
          <div
            className="flex items-end px-3 pb-2 sticky top-0 z-10"
            style={{
              height: HEADER_PX,
              borderBottom: '1px solid #57534e',
              backgroundColor: '#44403c',
            }}
          >
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>
              Phase / Task
            </span>
          </div>
          {rows.length === 0 ? (
            <div
              className="flex items-center justify-center text-center px-4"
              style={{
                height: 80,
                color: '#78716c',
                fontSize: 11,
                fontFamily: 'monospace',
              }}
            >
              No phases yet — click + Phase
            </div>
          ) : rows.map((r) => {
            const depth = r.depth || 0
            const INDENT_UNIT = 14

            // ─── Drop-zone row (bottom of expanded phase) ───
            if (r.kind === 'drop-zone') {
              const dzPhaseId = r.phase?.id || null
              const isDzHover = dropZoneHover?.phaseId === dzPhaseId
              const isReparentHoverDz = reparentHoverPhaseId === dzPhaseId
              return (
                <div
                  key={r.key}
                  data-phase-drop-target={dzPhaseId || undefined}
                  onMouseEnter={() => setDropZoneHover({ phaseId: dzPhaseId, mouseX: null })}
                  onMouseLeave={() => setDropZoneHover(prev =>
                    prev?.phaseId === dzPhaseId ? null : prev
                  )}
                  onClick={() => {
                    if (suppressNextClickRef.current) return
                    // Label-gutter click: no cursor X, so open
                    // the editor with no preset dates.
                    onNewTaskInPhase?.(dzPhaseId, null, null)
                  }}
                  className="relative flex items-center cursor-pointer transition-colors"
                  style={{
                    height: rowPx,
                    borderBottom: '1px dashed #44403c',
                    backgroundColor: isReparentHoverDz
                      ? '#7c2d12'
                      : (isDzHover ? 'rgba(234, 88, 12, 0.08)' : 'transparent'),
                    paddingLeft: 8 + depth * INDENT_UNIT + 20,
                    paddingRight: 8,
                    outline: isReparentHoverDz ? '2px dashed #fb923c' : undefined,
                    opacity: isDzHover || isReparentHoverDz ? 1 : 0.5,
                  }}
                  title="Click to add a new task to this phase"
                >
                  <Plus
                    className="w-3 h-3 mr-1.5"
                    style={{ color: isDzHover ? '#fb923c' : '#78716c' }}
                  />
                  <span
                    className="text-[11px] font-mono italic"
                    style={{ color: isDzHover ? '#fdba74' : '#78716c' }}
                  >
                    New task…
                  </span>
                </div>
              )
            }

            // Phase-row drop target id. Real phases use their uuid;
            // the synthetic "Unphased" row gets __unphased__; any
            // task or unknown row is not a drop target at all.
            const dropTargetId =
              r.kind === 'phase'
                ? (r.phase?.id || (r.key === 'ph-unphased' ? '__unphased__' : null))
                : null
            const isHoverTarget =
              dropTargetId != null && reparentHoverPhaseId === dropTargetId
            const isTaskRow = r.kind === 'task' && !!r.task
            return (
              <div
                key={r.key}
                data-phase-drop-target={dropTargetId || undefined}
                draggable={false}
                className={`relative flex items-center hover:bg-stone-700 transition-colors ${isTaskRow ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
                style={{
                  height: rowPx,
                  borderBottom: '1px solid #1c1917',
                  backgroundColor: isHoverTarget
                    ? '#7c2d12'
                    : (r.kind === 'phase' ? '#44403c' : '#292524'),
                  paddingLeft: 8 + depth * INDENT_UNIT + 20,
                  paddingRight: 8,
                  outline: isHoverTarget ? '2px dashed #fb923c' : undefined,
                  userSelect: 'none',
                }}
                onMouseDown={isTaskRow ? (e) => startTaskDrag(e, r.task) : undefined}
                onClick={() => handleRowClick(r)}
                title={isTaskRow ? 'Click to edit · drag to move to another phase' : undefined}
              >
                {/* Collapse chevron (phases with children only). */}
                {r.kind === 'phase' && r.hasChildren && r.phase && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleCollapse?.(r.phase)
                    }}
                    className="absolute flex items-center justify-center rounded-sm hover:bg-stone-600"
                    style={{
                      left: 6 + depth * INDENT_UNIT,
                      top: (rowPx - 16) / 2,
                      width: 16,
                      height: 16,
                      color: '#fb923c',
                      zIndex: 2,
                    }}
                    title={r.collapsed ? 'Expand' : 'Collapse'}
                  >
                    {r.collapsed
                      ? <ChevronRight className="w-3 h-3" />
                      : <ChevronDown  className="w-3 h-3" />}
                  </button>
                )}
                <span
                  className={`text-[11px] font-mono truncate ${r.kind === 'phase' ? 'font-bold uppercase tracking-wider' : ''}`}
                  style={{ color: r.kind === 'phase' ? '#fb923c' : '#d6d3d1' }}
                >
                  {r.label}
                </span>
              </div>
            )
          })}
        </div>

        {/* Chart area */}
        <div className="relative" style={{ width: effectiveChartW }}>
          {/* Time axis */}
          <div
            className="relative sticky top-0 z-10"
            style={{
              height: HEADER_PX,
              borderBottom: '1px solid #57534e',
              backgroundColor: '#44403c',
            }}
          >
            {ticks.map(tick => {
              if (dayMask && dayMask.mask[tick.offset]?.hidden) return null
              return (
                <div
                  key={tick.key}
                  className="absolute top-0 bottom-0 flex flex-col justify-end pb-1 px-1"
                  style={{
                    left: dayToX(tick.offset),
                    borderLeft: tick.major ? '2px solid #57534e' : '1px solid #57534e',
                  }}
                >
                  <span className="text-[9px] font-mono whitespace-nowrap" style={{ color: '#fb923c' }}>
                    {tick.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Body — grid + bars */}
          <div
            data-chart-body
            className="relative"
            style={{ height: Math.max(80, rows.length * rowPx) }}
          >
            {/* Grid + weekend tint (day view only) */}
            {dayPx >= 4 && Array.from({ length: totalDays + 1 }, (_, i) => {
              const d = addDays(span.start, i)
              const dow = d.getDay()
              const isWeek = dow === 1
              const isWeekend = dow === 0 || dow === 6
              // In day view we paint a soft tint on the entire weekend
              // column so the user can spot Sat/Sun at a glance.
              if (zoomId === 'day' && !hideWeekends && isWeekend) {
                return (
                  <div
                    key={`wk-${i}`}
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{
                      left: dayToX(i),
                      width: dayPx,
                      backgroundColor: dow === 0 ? 'rgba(120, 113, 108, 0.18)' : 'rgba(120, 113, 108, 0.13)',
                    }}
                  />
                )
              }
              if (dayMask && dayMask.mask[i]?.hidden) return null
              if (dayPx < 8 && !isWeek) return null
              return (
                <div
                  key={`g-${i}`}
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{
                    left: dayToX(i),
                    width: 1,
                    backgroundColor: isWeek ? '#57534e' : '#44403c',
                    opacity: 0.6,
                  }}
                />
              )
            })}

            {/* Today line */}
            {todayDays >= 0 && todayDays <= totalDays && (!dayMask || !dayMask.mask[todayDays]?.hidden) && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  left: dayToX(todayDays),
                  width: Math.max(2, dayPx > 8 ? 2 : 1),
                  backgroundColor: '#fca5a5',
                  zIndex: 5,
                }}
                title="Today"
              />
            )}

            {/* Empty hint */}
            {rows.length === 0 && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ color: '#57534e', fontSize: 11, fontFamily: 'monospace', fontStyle: 'italic' }}
              >
                Click + Phase or drag on the overview above to draw a task
              </div>
            )}

            {/* Row backgrounds + bars */}
            {rows.map((r, i) => {
              // Drop-zone rows: hoverable empty space at the bottom
              // of an expanded phase. Shows a ghost task bar + "+"
              // hint on hover. Clicking creates a new task in the
              // phase. Dragging a task onto it also reparents.
              if (r.kind === 'drop-zone') {
                const dzPhaseId = r.phase?.id || null
                const isDzHover = dropZoneHover?.phaseId === dzPhaseId
                const isReparentHoverDz = reparentHoverPhaseId === dzPhaseId
                // Ghost width is a fixed 7-day default; X position
                // follows the mouse cursor so the user can pick
                // where in the timeline the task should start.
                const ghostWidth = Math.max(60, 7 * dayPx)
                const mouseXInChart = isDzHover && dropZoneHover?.mouseX != null
                  ? dropZoneHover.mouseX
                  : null
                return (
                  <div
                    key={r.key}
                    data-phase-drop-target={dzPhaseId || undefined}
                    onMouseMove={(e) => {
                      // Track cursor X within the chart area so the
                      // ghost bar can follow it.
                      const rect = e.currentTarget.getBoundingClientRect()
                      const x = e.clientX - rect.left
                      setDropZoneHover({ phaseId: dzPhaseId, mouseX: x })
                    }}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const x = e.clientX - rect.left
                      setDropZoneHover({ phaseId: dzPhaseId, mouseX: x })
                    }}
                    onMouseLeave={() => setDropZoneHover(prev =>
                      prev?.phaseId === dzPhaseId ? null : prev
                    )}
                    onClick={(e) => {
                      if (suppressNextClickRef.current) return
                      // Derive start date from the click X and
                      // propose a 7-day duration. The editor opens
                      // with these dates prefilled so the user can
                      // tweak.
                      const rect = e.currentTarget.getBoundingClientRect()
                      const clickX = e.clientX - rect.left
                      const clickDays = Math.max(0, Math.round(clickX / dayPx))
                      const startDate = addDays(span.start, clickDays)
                      const endDate   = addDays(startDate, 7)
                      onNewTaskInPhase?.(dzPhaseId, startDate, endDate)
                    }}
                    className="absolute left-0 right-0 cursor-pointer"
                    style={{
                      top: i * rowPx,
                      height: rowPx,
                      borderBottom: '1px dashed #44403c',
                      backgroundColor: isReparentHoverDz
                        ? 'rgba(124, 45, 18, 0.35)'
                        : (isDzHover ? 'rgba(234, 88, 12, 0.05)' : 'transparent'),
                    }}
                  >
                    {(isDzHover || isReparentHoverDz) && (
                      <div
                        className="absolute rounded-sm flex items-center justify-center pointer-events-none"
                        style={{
                          left: mouseXInChart != null
                            ? Math.max(0, mouseXInChart - ghostWidth / 2)
                            : (isReparentHoverDz
                                ? Math.max(0, todayDays * dayPx - ghostWidth / 2)
                                : 0),
                          width: ghostWidth,
                          top: 4,
                          height: rowPx - 8,
                          backgroundColor: 'rgba(234, 88, 12, 0.22)',
                          border: '1.5px dashed #fb923c',
                        }}
                      >
                        <span
                          className="text-[10px] font-mono italic truncate px-2"
                          style={{ color: '#fdba74' }}
                        >
                          + New task
                        </span>
                      </div>
                    )}
                  </div>
                )
              }

              // Chart-area drop target id — mirrors the left-pane
              // logic so a bar dragged over a chart row registers as
              // hovering that phase. Phase rows use their own id;
              // task rows use their parent phase id (so dragging onto
              // a sibling task lands in the same phase). The synthetic
              // "Unphased" row maps to __unphased__.
              const chartDropTargetId =
                r.kind === 'phase'
                  ? (r.phase?.id || (r.key === 'ph-unphased' ? '__unphased__' : null))
                  : r.kind === 'task'
                    ? (r.phaseHint || (r.task?.phase_id) || '__unphased__')
                    : null
              const isChartHoverTarget =
                chartDropTargetId != null && reparentHoverPhaseId === chartDropTargetId
              return (
                <div
                  key={r.key}
                  data-phase-drop-target={chartDropTargetId || undefined}
                  className="absolute left-0 right-0"
                  style={{
                    top: i * rowPx,
                    height: rowPx,
                    borderBottom: '1px solid #1c1917',
                    backgroundColor: isChartHoverTarget
                      ? 'rgba(124, 45, 18, 0.45)'
                      : (r.kind === 'phase' ? 'rgba(68, 64, 60, 0.55)' : 'transparent'),
                    outline: isChartHoverTarget ? '2px dashed #fb923c' : undefined,
                    cursor: r.kind === 'asset' ? 'default' : 'crosshair',
                  }}
                  onMouseDown={r.kind === 'asset' ? undefined : makeBackgroundMouseDown(r)}
                >
                  {r.kind === 'phase' && r.start && r.end && (
                    <DetailBar
                      row={r}
                      span={span}
                      dayPx={dayPx}
                      rowPx={rowPx}
                      dayToX={dayToX}
                      label={r.label}
                      phaseStyle
                      onUpdatePhase={onUpdatePhase}
                      onEditPhase={onEditPhase}
                      onBeginDependencyDrag={beginDependencyDrag}
                    />
                  )}
                  {r.kind === 'task' && r.start && r.end && (
                    <DetailBar
                      row={r}
                      span={span}
                      dayPx={dayPx}
                      rowPx={rowPx}
                      dayToX={dayToX}
                      label={r.label}
                      critical={criticalSet.has(r.task?.id)}
                      onUpdateTask={onUpdateTask}
                      onUpdatePhase={onUpdatePhase}
                      onEditTask={onEditTask}
                      onBeginDependencyDrag={beginDependencyDrag}
                      parentPhase={r.task?.phase_id ? phasesById[r.task.phase_id] : null}
                      currentPhaseId={chartDropTargetId}
                      onReparentHoverChange={setReparentHoverPhaseId}
                      findPhaseIdAtPoint={findPhaseIdAtPoint}
                      onMoveTaskToPhase={onMoveTaskToPhase}
                    />
                  )}
                </div>
              )
            })}

            {/* Containment tree lines — subtle connectors drawn
                from each phase bar down into each of its direct
                child task / sub-phase bars, so the user can see
                at a glance which tasks belong to which phase. */}
            <ContainmentOverlay
              rows={rows}
              span={span}
              dayPx={dayPx}
              rowPx={rowPx}
              dayToX={dayToX}
              chartW={effectiveChartW}
              chartH={Math.max(80, rows.length * rowPx)}
            />

            {/* Dependency overlay — SVG layer on top of the bars,
                showing curved arrows + an animated light pulse. */}
            <DependencyOverlay
              visibleDeps={visibleDeps}
              rows={rows}
              span={span}
              dayPx={dayPx}
              rowPx={rowPx}
              dayToX={dayToX}
              chartW={effectiveChartW}
              chartH={Math.max(80, rows.length * rowPx)}
              depDrag={depDrag}
              onUnlinkDependency={onUnlinkDependency}
            />
          </div>
        </div>
      </div>

      {/* Floating reparent drag ghost — follows the pointer while
          the user is dragging a task onto another phase row. */}
      {reparentGhost && (
        <div
          className="fixed pointer-events-none rounded-sm shadow-lg"
          style={{
            left: reparentGhost.x + 12,
            top:  reparentGhost.y + 12,
            backgroundColor: '#7c2d12',
            border: '1px dashed #fb923c',
            color: '#fff7ed',
            padding: '4px 10px',
            fontSize: 11,
            fontFamily: 'monospace',
            zIndex: 9999,
            maxWidth: 280,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {reparentGhost.label}
        </div>
      )}
    </div>
  )
}

// ============================================================
// ContainmentOverlay — tree lines drawn INSIDE the chart area
// ============================================================
//
// For each phase row we draw:
//
//     ╔══════ PHASE BAR ══════╗
//     ║                        ║
//     ╚═══╦════════════════════╝
//         ║
//         ╠══▶ [ child task 1 ]
//         ║
//         ╠══▶ [ child task 2 ]
//         ║
//         ╚══▶ [ child sub-phase ]
//
// A solid rail drops from inside the phase bar down through all
// of its *contained* bars, with an L-elbow and a real triangle
// arrowhead into each child's left edge.
//
// "Contained" means: any row whose depth is strictly > the
// phase's depth AND not inside a sub-phase of this phase. Asset
// rows are pass-through — their tasks still count as children
// of the phase. Sub-phases are themselves children (their own
// subtree is drawn by their own rail when the outer loop gets
// to them).
function ContainmentOverlay({ rows, span, dayPx, rowPx, dayToX, chartW, chartH }) {
  if (!dayToX) dayToX = (d) => d * dayPx
  const LINE_COLOR = '#d6d3d1'     // stone-300 — high contrast on dark
  const LINE_WIDTH = 1.6
  const SHADOW_COLOR = '#1c1917'
  const RAIL_INSET = 22            // how far inside the phase bar the rail starts
  const ARROW_GAP  = 4             // gap between elbow tip and child bar

  // Find all contained bars for the phase at phaseIdx.
  function findContainedBars(phaseIdx) {
    const phaseRow = rows[phaseIdx]
    const phaseDepth = phaseRow.depth || 0
    const out = []
    let j = phaseIdx + 1
    while (j < rows.length) {
      const r = rows[j]
      const d = r.depth || 0
      if (d <= phaseDepth) break
      if (r.kind === 'phase') {
        // Sub-phase: direct child. Record it, then SKIP its
        // subtree — the sub-phase's own rail will handle its
        // descendants.
        if (r.start && r.end) out.push(j)
        const subDepth = d
        j++
        while (j < rows.length && (rows[j].depth || 0) > subDepth) j++
        continue
      }
      if (r.kind === 'task' && r.start && r.end) {
        // Task: direct child whether at depth+1 or at depth+2
        // through an asset (asset rows have no bar so we visually
        // drill through them).
        out.push(j)
      }
      j++
    }
    return out
  }

  const rails = []
  for (let i = 0; i < rows.length; i++) {
    const phaseRow = rows[i]
    if (phaseRow.kind !== 'phase') continue
    if (!phaseRow.start || !phaseRow.end) continue
    if (phaseRow.collapsed) continue  // collapsed phase hides its subtree

    const containedIdxs = findContainedBars(i)
    if (containedIdxs.length === 0) continue

    // Rail origin X: start a bit inside the phase bar so the
    // line reads as "coming out of the phase" (matches the
    // user's mockup). Clamp so it never exits the phase span.
    const phaseLeftX  = dayToX(daysBetween(span.start, phaseRow.start))
    const phaseRightX = dayToX(daysBetween(span.start, phaseRow.end))
    const railX = Math.min(phaseLeftX + RAIL_INSET, phaseRightX - 4)

    // Rail Y: starts at the bottom of the phase bar, ends at
    // the row-center of the last contained bar.
    const phaseBarBottom = i * rowPx + (rowPx - 3)
    const lastIdx = containedIdxs[containedIdxs.length - 1]
    const railBot = lastIdx * rowPx + rowPx / 2

    const elbows = []
    for (const childIdx of containedIdxs) {
      const child = rows[childIdx]
      const childLeft = dayToX(daysBetween(span.start, child.start))
      const childY = childIdx * rowPx + rowPx / 2
      // Tip of the elbow sits just before the child's left edge.
      const tipX = Math.max(railX + 10, childLeft - ARROW_GAP)
      elbows.push({ childKey: child.key, x1: railX, y1: childY, x2: tipX, y2: childY })
    }

    rails.push({
      key: `contain-${phaseRow.key}`,
      railX,
      railTop: phaseBarBottom,
      railBot,
      elbows,
    })
  }

  if (rails.length === 0) {
    return (
      <svg
        className="absolute top-0 left-0 pointer-events-none"
        width={chartW}
        height={chartH}
        style={{ zIndex: 3, overflow: 'visible' }}
      />
    )
  }

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      width={chartW}
      height={chartH}
      style={{ zIndex: 3, overflow: 'visible' }}
    >
      <defs>
        {/* Triangle arrowhead for containment elbows — neutral
            stone so it doesn't compete with orange/cyan
            dependency arrows. */}
        <marker
          id="rabbit-contain-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={LINE_COLOR} />
        </marker>
      </defs>

      {rails.map(rail => (
        <g key={rail.key}>
          {/* Dark shadow underlay so the rail reads on any bg */}
          <path
            d={
              `M ${rail.railX} ${rail.railTop} L ${rail.railX} ${rail.railBot} ` +
              rail.elbows.map(e => `M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}`).join(' ')
            }
            fill="none"
            stroke={SHADOW_COLOR}
            strokeWidth={LINE_WIDTH + 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />

          {/* The vertical rail itself */}
          <line
            x1={rail.railX}
            y1={rail.railTop}
            x2={rail.railX}
            y2={rail.railBot}
            stroke={LINE_COLOR}
            strokeWidth={LINE_WIDTH}
            strokeLinecap="round"
          />

          {/* A small anchor dot where the rail exits the phase bar */}
          <circle
            cx={rail.railX}
            cy={rail.railTop}
            r={2.4}
            fill={LINE_COLOR}
          />

          {/* Elbows — one horizontal line into each child with
              a real triangle arrowhead at the tip */}
          {rail.elbows.map((e, idx) => (
            <line
              key={`${rail.key}-e-${idx}`}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke={LINE_COLOR}
              strokeWidth={LINE_WIDTH}
              strokeLinecap="round"
              markerEnd="url(#rabbit-contain-arrow)"
            />
          ))}
        </g>
      ))}
    </svg>
  )
}

// ============================================================
// DependencyOverlay — SVG arrows + animated "light pulse"
// ============================================================
//
// Renders one <path> per visible dependency as an L-shaped
// elbow from the source bar's right edge to the target bar's
// left edge, plus a small glowing dot that travels the path via
// <animateMotion> to give the user a sense of flow direction.
// The rubber-band preview (while dragging a new dep) is a
// dashed line following the cursor.
//
// Colors:
//   task → task  : orange (#fb923c)    — RABBIT's primary accent
//   phase → phase: cyan   (#22d3ee)    — high contrast vs orange
function DependencyOverlay({
  visibleDeps, rows, span, dayPx, rowPx, dayToX, chartW, chartH, depDrag, onUnlinkDependency,
}) {
  if (!dayToX) dayToX = (d) => d * dayPx
  const TASK_COLOR  = '#fb923c'
  const PHASE_COLOR = '#22d3ee'

  const edges = []
  for (const { dep, kind, predIdx, succIdx } of visibleDeps) {
    const predRow = rows[predIdx]
    const succRow = rows[succIdx]
    if (!predRow?.start || !predRow?.end) continue
    if (!succRow?.start || !succRow?.end) continue
    const x1 = dayToX(daysBetween(span.start, predRow.end))
    const y1 = predIdx * rowPx + rowPx / 2
    const x2 = dayToX(daysBetween(span.start, succRow.start))
    const y2 = succIdx * rowPx + rowPx / 2
    edges.push({ id: dep.id, kind, x1, y1, x2, y2 })
  }

  function buildPath(x1, y1, x2, y2) {
    const STUB = 10
    if (x2 >= x1 + STUB * 2) {
      const mx = (x1 + x2) / 2
      return `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`
    }
    const outR = x1 + STUB
    const outL = x2 - STUB
    const midY = y1 + rowPx / 2 + 2
    return `M ${x1} ${y1} L ${outR} ${y1} L ${outR} ${midY} L ${outL} ${midY} L ${outL} ${y2} L ${x2} ${y2}`
  }

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      width={chartW}
      height={chartH}
      style={{ zIndex: 4, overflow: 'visible' }}
    >
      <defs>
        {/* Arrowheads — one per kind */}
        <marker
          id="rabbit-dep-arrow-task"
          viewBox="0 0 10 10"
          refX="9" refY="5"
          markerWidth="6" markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={TASK_COLOR} />
        </marker>
        <marker
          id="rabbit-dep-arrow-phase"
          viewBox="0 0 10 10"
          refX="9" refY="5"
          markerWidth="6" markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={PHASE_COLOR} />
        </marker>

        {/* Radial gradients for the glowing pulse dot — center
            is near-white, fading through the kind's accent
            color, fading to fully transparent at the edge. */}
        <radialGradient id="rabbit-pulse-glow-task" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="1" />
          <stop offset="25%"  stopColor="#fff7ed" stopOpacity="0.95" />
          <stop offset="55%"  stopColor={TASK_COLOR} stopOpacity="0.75" />
          <stop offset="100%" stopColor={TASK_COLOR} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="rabbit-pulse-glow-phase" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="1" />
          <stop offset="25%"  stopColor="#ecfeff" stopOpacity="0.95" />
          <stop offset="55%"  stopColor={PHASE_COLOR} stopOpacity="0.75" />
          <stop offset="100%" stopColor={PHASE_COLOR} stopOpacity="0" />
        </radialGradient>

        {/* Soft Gaussian blur for an extra bloom behind the dot. */}
        <filter id="rabbit-pulse-blur" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>

      {edges.map(e => {
        const d = buildPath(e.x1, e.y1, e.x2, e.y2)
        const stroke = e.kind === 'phase' ? PHASE_COLOR : TASK_COLOR
        const marker = e.kind === 'phase'
          ? 'url(#rabbit-dep-arrow-phase)'
          : 'url(#rabbit-dep-arrow-task)'
        const glowId = e.kind === 'phase'
          ? 'url(#rabbit-pulse-glow-phase)'
          : 'url(#rabbit-pulse-glow-task)'
        return (
          <g key={e.id}>
            {/* Shadow underlay so the arrow reads against busy bars */}
            <path
              d={d}
              fill="none"
              stroke="#1c1917"
              strokeWidth={3.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.9}
            />
            {/* Main arrow — click-to-delete */}
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd={marker}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onClick={(ev) => {
                ev.stopPropagation()
                if (confirm('Remove this dependency?')) onUnlinkDependency?.(e.id)
              }}
            >
              <title>Click to remove dependency</title>
            </path>

            {/* Outer blurred bloom — big and soft, trails behind */}
            <circle r={7} fill={glowId} filter="url(#rabbit-pulse-blur)">
              <animateMotion dur="2.2s" repeatCount="indefinite" path={d} />
              <animate
                attributeName="opacity"
                values="0;0.9;0.9;0"
                keyTimes="0;0.12;0.88;1"
                dur="2.2s"
                repeatCount="indefinite"
              />
            </circle>
            {/* Inner gradient-filled dot — crisp center of light */}
            <circle r={4} fill={glowId}>
              <animateMotion dur="2.2s" repeatCount="indefinite" path={d} />
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.1;0.9;1"
                dur="2.2s"
                repeatCount="indefinite"
              />
            </circle>
            {/* Tiny solid white core so the head reads sharp */}
            <circle r={1.3} fill="#ffffff">
              <animateMotion dur="2.2s" repeatCount="indefinite" path={d} />
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.1;0.9;1"
                dur="2.2s"
                repeatCount="indefinite"
              />
            </circle>
          </g>
        )
      })}

      {/* Rubber-band preview while dragging to create a new dep */}
      {depDrag && (
        <line
          x1={depDrag.startX}
          y1={depDrag.startY}
          x2={depDrag.curX}
          y2={depDrag.curY}
          stroke={depDrag.fromKind === 'phase' ? PHASE_COLOR : TASK_COLOR}
          strokeWidth={1.8}
          strokeDasharray="4 4"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

// ============================================================
// DetailBar — bar with live drag preview, edge resize handles
// ============================================================

function DetailBar({
  row, span, dayPx, rowPx, dayToX, label,
  critical, phaseStyle,
  onUpdateTask, onUpdatePhase,
  onEditTask, onEditPhase,
  onBeginDependencyDrag,
  parentPhase,
  // Reparent hooks — only passed for task bars. When present, the
  // drag handler tracks which phase row the cursor is currently
  // over and, on release, moves the task to that phase (in addition
  // to committing any horizontal date shift).
  currentPhaseId,
  onReparentHoverChange,
  findPhaseIdAtPoint,
  onMoveTaskToPhase,
}) {
  if (!dayToX) dayToX = (d) => d * dayPx
  // Live drag state — kept local so parent doesn't re-render
  // every mousemove during a drag.
  const [drag, setDrag] = useState(null) // null | {start, end, mode}
  const [hover, setHover] = useState(false)
  const [pendingExtend, setPendingExtend] = useState(null) // {patch, phaseId, newPhaseStart, newPhaseEnd}

  // Dep-handle mousedown: delegates to the pane's begin handler,
  // passing the source id + origin point in chart-container coords.
  function onDepHandleDown(e) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    if (!onBeginDependencyDrag) return
    const srcId = phaseStyle ? row.phase?.id : row.task?.id
    if (!srcId) return
    const kind = phaseStyle ? 'phase' : 'task'
    // Origin point for the rubber-band line: right edge of the
    // current bar, vertically centered on the row. We compute it
    // from the bar's own rect to stay zoom-accurate.
    const barEl = e.currentTarget.parentNode
    const chartArea = barEl.closest('[data-chart-body]')
    if (!chartArea) return
    const barRect = barEl.getBoundingClientRect()
    const areaRect = chartArea.getBoundingClientRect()
    const startX = barRect.right - areaRect.left
    const startY = barRect.top + barRect.height / 2 - areaRect.top
    onBeginDependencyDrag({ fromKind: kind, fromId: srcId, startX, startY })
  }

  const start = drag?.start || row.start
  const end   = drag?.end   || row.end

  const offsetDays = daysBetween(span.start, start)
  const lengthDays = Math.max(0.5, daysBetween(start, end))
  const left  = dayToX(offsetDays)
  const right = dayToX(offsetDays + lengthDays)
  const width = Math.max(6, right - left)

  // Lifecycle palette — picks active / upcoming / completed based
  // on the row's (live, drag-aware) dates + status. Phases use the
  // phaseStyle variant which carries a touch more visual weight.
  const tone = barTone({ ...row, start, end }, critical, phaseStyle)

  function onMouseDown(e) {
    if (e.button !== 0) return
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    const isLeftEdge  = offsetX < EDGE_GRAB_PX
    const isRightEdge = offsetX > rect.width - EDGE_GRAB_PX
    const mode = isLeftEdge ? 'resize-start' : isRightEdge ? 'resize-end' : 'move'

    const origStart = row.start
    const origEnd   = row.end
    const startMouseX = e.clientX
    let moved = false
    let liveStart = origStart
    let liveEnd   = origEnd
    // Track which phase row the cursor is currently over so we can
    // reparent the task on release if it ended up over a different
    // phase. Only relevant for task bars in move mode.
    const canReparent =
      !phaseStyle && row.task && mode === 'move' &&
      typeof findPhaseIdAtPoint === 'function' &&
      typeof onMoveTaskToPhase === 'function'
    let lastHoverPhaseId = null

    function onMove(ev) {
      const dx = ev.clientX - startMouseX
      if (Math.abs(dx) > MIN_DRAG_PX) moved = true
      const ddays = Math.round(dx / dayPx)
      let newStart = origStart
      let newEnd   = origEnd
      if (mode === 'move') {
        newStart = addDays(origStart, ddays)
        newEnd   = addDays(origEnd, ddays)
      } else if (mode === 'resize-start') {
        newStart = addDays(origStart, ddays)
        if (newStart >= newEnd) newStart = addDays(newEnd, -1)
      } else if (mode === 'resize-end') {
        newEnd = addDays(origEnd, ddays)
        if (newEnd <= newStart) newEnd = addDays(newStart, 1)
      }
      liveStart = newStart
      liveEnd   = newEnd
      setDrag({ start: newStart, end: newEnd, mode })

      // Reparent-hover tracking. We walk the DOM under the cursor to
      // find the nearest data-phase-drop-target ancestor. If it's a
      // different phase from the task's current parent, we light it
      // up via the parent pane's hover state.
      if (canReparent) {
        const hit = findPhaseIdAtPoint(ev.clientX, ev.clientY)
        lastHoverPhaseId = hit
        // Only highlight when the hovered phase differs from the
        // task's current parent — same-phase hover is a no-op visually.
        if (hit && hit !== currentPhaseId) {
          onReparentHoverChange?.(hit)
        } else {
          onReparentHoverChange?.(null)
        }
      }
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDrag(null)
      if (canReparent) onReparentHoverChange?.(null)
      if (!moved) {
        if (phaseStyle && row.phase) onEditPhase?.(row.phase)
        else if (!phaseStyle && row.task) onEditTask?.(row.task)
        return
      }
      const patch = { start_date: toIsoDate(liveStart), end_date: toIsoDate(liveEnd) }

      // Phase bars: just commit. No clamping — phases ARE the
      // container, so they can move freely.
      if (phaseStyle && row.phase) {
        onUpdatePhase?.(row.phase.id, patch)
        return
      }

      // Task bars: if the cursor ended over a different phase row,
      // reparent the task FIRST. We pass a null phase id for the
      // "Unphased" sentinel so the adapter clears the field.
      if (!phaseStyle && row.task) {
        if (canReparent && lastHoverPhaseId && lastHoverPhaseId !== currentPhaseId) {
          const targetPhaseId = lastHoverPhaseId === '__unphased__' ? null : lastHoverPhaseId
          onMoveTaskToPhase?.(row.task.id, targetPhaseId)
          // Skip the date-update / phase-extend flow when the user
          // reparented — they intended to move to a different phase,
          // not nudge dates within the original one.
          return
        }
      }

      // Task bars: enforce containment. If the task got pushed
      // outside its parent phase's window we surface a confirmation
      // modal asking the user whether to widen the phase.
      if (!phaseStyle && row.task) {
        const ph = parentPhase
        const phStart = parseDate(ph?.start_date)
        const phEnd   = parseDate(ph?.end_date)
        if (ph && phStart && phEnd) {
          const outsideStart = liveStart < phStart
          const outsideEnd   = liveEnd   > phEnd
          if (outsideStart || outsideEnd) {
            // Stash both options on the modal so the user can pick.
            setPendingExtend({
              taskPatch:     patch,
              phaseId:       ph.id,
              newPhaseStart: outsideStart ? toIsoDate(liveStart) : ph.start_date,
              newPhaseEnd:   outsideEnd   ? toIsoDate(liveEnd)   : ph.end_date,
              taskTitle:     row.task.title || 'Untitled task',
              phaseName:     ph.name || 'Untitled phase',
              clampedPatch: {
                start_date: toIsoDate(outsideStart ? phStart : liveStart),
                end_date:   toIsoDate(outsideEnd   ? phEnd   : liveEnd),
              },
            })
            return
          }
        }
        onUpdateTask?.(row.task.id, patch)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const dataRowBar = phaseStyle
    ? (row.phase ? `phase:${row.phase.id}` : undefined)
    : (row.task  ? `task:${row.task.id}`   : undefined)

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-row-bar={dataRowBar}
      className="absolute flex items-center px-2 rounded-sm cursor-grab active:cursor-grabbing"
      style={{
        left, width,
        top: phaseStyle ? 3 : 5,
        height: phaseStyle ? rowPx - 6 : rowPx - 10,
        backgroundColor: tone.bg,
        border: `${phaseStyle ? 2 : 1}px solid ${tone.border}`,
        boxShadow: phaseStyle ? '0 0 0 1px rgba(0,0,0,0.4)' : undefined,
      }}
      title={`${label} · ${lengthDays.toFixed(1)}d · drag to move · drag edges to resize · click to edit · drag the right-edge dot to link a dependency`}
    >
      {/* Edge resize cursor hints */}
      <div className="absolute left-0 top-0 bottom-0" style={{ width: EDGE_GRAB_PX, cursor: 'ew-resize' }} />
      <div className="absolute right-0 top-0 bottom-0" style={{ width: EDGE_GRAB_PX, cursor: 'ew-resize' }} />
      {width > 32 && (
        <span
          className={`text-[10px] font-mono truncate pointer-events-none overflow-hidden ${phaseStyle ? 'font-bold uppercase tracking-wider' : ''}`}
          style={{ color: tone.fg }}
        >
          {label}
        </span>
      )}
      {/* Dependency-drag handle — right-edge dot, appears on hover.
          Color matches the kind of dependency it will create:
          orange for task→task, cyan for phase→phase. */}
      {hover && (
        <div
          onMouseDown={onDepHandleDown}
          className="absolute rounded-full"
          style={{
            right: -6,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 10,
            height: 10,
            backgroundColor: phaseStyle ? '#22d3ee' : '#fb923c',
            border: '2px solid #1c1917',
            cursor: 'crosshair',
            zIndex: 6,
          }}
          title="Drag to link a dependency"
        />
      )}

      {/* Phase-extend confirmation modal — fired when the user
          drags a task outside its parent phase's window. */}
      {pendingExtend && (
        <PhaseExtendModal
          pendingExtend={pendingExtend}
          onCancel={() => setPendingExtend(null)}
          onClampTask={() => {
            onUpdateTask?.(row.task.id, pendingExtend.clampedPatch)
            setPendingExtend(null)
          }}
          onExtendPhase={() => {
            onUpdatePhase?.(pendingExtend.phaseId, {
              start_date: pendingExtend.newPhaseStart,
              end_date:   pendingExtend.newPhaseEnd,
            })
            onUpdateTask?.(row.task.id, pendingExtend.taskPatch)
            setPendingExtend(null)
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// PhaseExtendModal — confirms what to do when a task gets dragged
// outside its parent phase's window. Two outcomes:
//   • Clamp task back to the phase boundary (default), or
//   • Extend the parent phase to cover the new task dates.
// ============================================================
function PhaseExtendModal({ pendingExtend, onCancel, onClampTask, onExtendPhase }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(28, 25, 23, 0.78)' }}
      onClick={onCancel}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-sm flex flex-col w-full max-w-md"
        style={{ backgroundColor: '#292524', border: '1px solid #fb923c' }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: '1px solid #fb923c', backgroundColor: '#7c2d12' }}
        >
          <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#fed7aa' }} />
          <span className="text-[10px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fed7aa' }}>
            Task outside phase window
          </span>
        </div>
        <div className="px-4 py-4 flex flex-col gap-3 text-[11px] font-mono" style={{ color: '#d6d3d1' }}>
          <p>
            <span style={{ color: '#fb923c' }}>{pendingExtend.taskTitle}</span> sits outside
            the dates of its phase <span style={{ color: '#fb923c' }}>{pendingExtend.phaseName}</span>.
            Tasks must stay inside the phase window.
          </p>
          <p style={{ color: '#a8a29e' }}>
            New phase dates if extended: {pendingExtend.newPhaseStart} → {pendingExtend.newPhaseEnd}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3" style={{ borderTop: '1px solid #44403c', backgroundColor: '#1c1917' }}>
          <button
            type="button"
            onClick={onClampTask}
            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors"
            style={{ color: '#a8a29e', backgroundColor: 'transparent', border: '1px solid #44403c' }}
          >
            Clamp task
          </button>
          <button
            type="button"
            onClick={onExtendPhase}
            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
          >
            Extend phase
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// TaskEditor modal — phase form now has dates; task form now
// has a phase selector
// ============================================================

function TaskEditor({ editor, assets, phases, ctx, onClose }) {
  const [draft, setDraft] = useState(editor.draft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const isTask = editor.mode === 'task'
  const isEditingExisting = isTask ? !!editor.taskId : !!editor.phaseId

  function patch(field, value) {
    setDraft(d => ({ ...d, [field]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      if (editor.mode === 'phase') {
        if (!draft.name?.trim()) throw new Error('Phase name is required.')
        if (!draft.start_date)   throw new Error('Phase start date is required.')
        if (!draft.end_date)     throw new Error('Phase end date is required.')
        if (draft.end_date < draft.start_date) {
          throw new Error('Phase end date must be on or after the start date.')
        }
        const payload = {
          name:            draft.name.trim(),
          description:     draft.description?.trim() || '',
          parent_phase_id: draft.parent_phase_id || null,
          start_date:      draft.start_date,
          end_date:        draft.end_date,
        }
        if (editor.phaseId) {
          await ctx.updatePhase(editor.phaseId, payload)
        } else {
          await ctx.addPhase(payload)
        }
      } else {
        if (!draft.title?.trim()) throw new Error('Task title is required.')
        // Resolve phase from asset if asset is set and phase isn't.
        const asset = assets.find(a => a.id === draft.asset_id)
        const phaseId = draft.phase_id || asset?.phase_id || null
        const payload = {
          title:              draft.title.trim(),
          asset_id:           draft.asset_id || null,
          phase_id:           phaseId,
          start_date:         draft.start_date || null,
          end_date:           draft.end_date || null,
          bid_days:           draft.bid_days === '' || draft.bid_days == null ? null : Number(draft.bid_days),
          assigned_position:  draft.role?.trim() || null,
          assigned_role_slug: draft.role?.trim()
            ? draft.role.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
            : null,
          priority:           draft.priority || 'medium',
          status:             draft.status || 'waiting_to_start',
        }
        if (editor.taskId) {
          await ctx.updateTask(editor.taskId, payload)
        } else {
          await ctx.addTask(payload)
        }
      }
      onClose()
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    setError(null)
    try {
      if (editor.mode === 'phase' && editor.phaseId) {
        if (!confirm('Delete this phase? Tasks linked to it will become orphans.')) {
          setSaving(false)
          return
        }
        await ctx.deletePhase(editor.phaseId)
      } else if (editor.mode === 'task' && editor.taskId) {
        if (!confirm('Delete this task?')) {
          setSaving(false)
          return
        }
        await ctx.deleteTask(editor.taskId)
      }
      onClose()
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(28, 25, 23, 0.75)' }}
      onClick={() => !saving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-sm flex flex-col w-full max-w-md"
        style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: '1px solid #44403c', backgroundColor: '#44403c' }}
        >
          <CalendarDays className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
          <span className="text-[10px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>
            {editor.mode === 'phase'
              ? (isEditingExisting ? 'Edit phase' : 'New phase')
              : (isEditingExisting ? 'Edit task'  : 'New task')}
          </span>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="ml-auto p-0.5 rounded-sm hover:bg-stone-700"
            style={{ color: '#a8a29e' }}
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        <div className="px-4 py-4 flex flex-col gap-3">
          {editor.mode === 'phase' ? (
            <>
              <Field label="Phase name">
                <input
                  type="text"
                  autoFocus
                  value={draft.name}
                  onChange={(e) => patch('name', e.target.value)}
                  placeholder="e.g. Pre-production"
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                />
              </Field>
              <Field label="Parent phase (optional — leave blank for a top-level phase)">
                <select
                  value={draft.parent_phase_id || ''}
                  onChange={(e) => patch('parent_phase_id', e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                >
                  <option value="">(top-level)</option>
                  {phaseChoicesForParent(phases, editor.phaseId).map(({ id, label }) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start date (required)">
                  <input
                    type="date"
                    required
                    value={draft.start_date || ''}
                    onChange={(e) => patch('start_date', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  />
                </Field>
                <Field label="End date (required)">
                  <input
                    type="date"
                    required
                    value={draft.end_date || ''}
                    onChange={(e) => patch('end_date', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  />
                </Field>
              </div>
              <div
                className="text-[10px] font-mono"
                style={{ color: '#78716c' }}
              >
                Phases always have a start and end date — the bar you see
                on the timeline is drawn from these.
              </div>
              <Field label="Description">
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(e) => patch('description', e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Title">
                <input
                  type="text"
                  autoFocus
                  value={draft.title}
                  onChange={(e) => patch('title', e.target.value)}
                  placeholder="e.g. Storyboard pass 1"
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                />
              </Field>
              <Field label="Phase">
                <select
                  value={draft.phase_id || ''}
                  onChange={(e) => patch('phase_id', e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                >
                  <option value="">(no phase)</option>
                  {phaseChoicesHierarchical(phases).map(({ id, label }) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Asset (optional — narrows the task to one deliverable)">
                <select
                  value={draft.asset_id || ''}
                  onChange={(e) => patch('asset_id', e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                >
                  <option value="">(no asset — task lives directly under the phase)</option>
                  {assets.map(a => {
                    const phase = phases.find(p => p.id === a.phase_id)
                    return (
                      <option key={a.id} value={a.id}>
                        {phase ? `${phase.name} › ${a.name}` : a.name}
                      </option>
                    )
                  })}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start date">
                  <input
                    type="date"
                    value={draft.start_date || ''}
                    onChange={(e) => patch('start_date', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  />
                </Field>
                <Field label="End date">
                  <input
                    type="date"
                    value={draft.end_date || ''}
                    onChange={(e) => patch('end_date', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Bid days">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={draft.bid_days}
                    onChange={(e) => patch('bid_days', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  />
                </Field>
                <Field label="Role">
                  <input
                    type="text"
                    value={draft.role}
                    onChange={(e) => patch('role', e.target.value)}
                    placeholder="e.g. Animator"
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Priority">
                  <select
                    value={draft.priority}
                    onChange={(e) => patch('priority', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="crit">Critical</option>
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    value={draft.status}
                    onChange={(e) => patch('status', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  >
                    <option value="waiting_to_start">Waiting</option>
                    <option value="in_progress">In progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="on_hold">On hold</option>
                    <option value="final">Final</option>
                    <option value="approved">Approved</option>
                  </select>
                </Field>
              </div>
            </>
          )}

          {error && (
            <div
              className="text-[11px] font-mono p-2 rounded-sm"
              style={{ backgroundColor: '#1c1917', color: '#fca5a5', border: '1px solid #7f1d1d' }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderTop: '1px solid #44403c', backgroundColor: '#1c1917' }}
        >
          {isEditingExisting && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
              style={{ color: '#fca5a5', backgroundColor: '#1c1917', border: '1px solid #7f1d1d' }}
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => !saving && onClose()}
              disabled={saving}
              className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
              style={{ color: '#a8a29e', backgroundColor: 'transparent', border: '1px solid #44403c' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
              style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
            >
              <Save className="w-3 h-3" />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-widest mb-1" style={{ color: '#a8a29e' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

// ============================================================
// Empty draft helpers
// ============================================================

function emptyTaskDraft({ assetId = '', phaseId = '', start_date, end_date } = {}) {
  const today  = new Date()
  const inWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
  return {
    title:      '',
    asset_id:   assetId || '',
    phase_id:   phaseId || '',
    start_date: start_date ?? toDateInputValue(today),
    end_date:   end_date   ?? toDateInputValue(inWeek),
    bid_days:   '',
    role:       '',
    priority:   'medium',
    status:     'waiting_to_start',
  }
}

function emptyPhaseDraft({ start_date, end_date, parent_phase_id } = {}) {
  const today  = new Date()
  const inMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
  return {
    name:            '',
    description:     '',
    parent_phase_id: parent_phase_id || '',
    start_date:      start_date ?? toDateInputValue(today),
    end_date:        end_date   ?? toDateInputValue(inMonth),
  }
}

// ─── Phase tree helpers ───
//
// Walk the parent_phase_id chain to flatten the phase list into a
// hierarchical option list. Used by the editor's selectors.
function phaseChoicesHierarchical(phases) {
  const childrenByParent = groupPhasesByParent(phases)
  const out = []
  function walk(parentKey, depth) {
    for (const p of childrenByParent[parentKey] || []) {
      const indent = '— '.repeat(depth)
      out.push({ id: p.id, label: `${indent}${p.name || 'Untitled'}` })
      walk(p.id, depth + 1)
    }
  }
  walk('__root__', 0)
  return out
}

// Same as phaseChoicesHierarchical but excludes the phase being
// edited and any of its descendants — you can't make a phase be
// its own ancestor.
function phaseChoicesForParent(phases, editingPhaseId) {
  const childrenByParent = groupPhasesByParent(phases)
  const blocked = new Set()
  if (editingPhaseId) {
    const stack = [editingPhaseId]
    while (stack.length) {
      const id = stack.pop()
      blocked.add(id)
      for (const c of childrenByParent[id] || []) stack.push(c.id)
    }
  }
  const out = []
  function walk(parentKey, depth) {
    for (const p of childrenByParent[parentKey] || []) {
      if (!blocked.has(p.id)) {
        const indent = '— '.repeat(depth)
        out.push({ id: p.id, label: `${indent}${p.name || 'Untitled'}` })
      }
      walk(p.id, depth + 1)
    }
  }
  walk('__root__', 0)
  return out
}

function groupPhasesByParent(phases) {
  // Defensive: a parent_phase_id that points to a phase that no
  // longer exists falls back to root, so the phase still renders
  // somewhere instead of vanishing.
  const ids = new Set(phases.map(p => p.id))
  const out = {}
  for (const p of phases) {
    const key = (p.parent_phase_id && ids.has(p.parent_phase_id)) ? p.parent_phase_id : '__root__'
    if (!out[key]) out[key] = []
    out[key].push(p)
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }
  return out
}

function toDateInputValue(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toIsoDate(d) {
  if (!d) return null
  const x = d instanceof Date ? d : new Date(d)
  if (isNaN(x.getTime())) return null
  return toDateInputValue(x)
}

// ============================================================
// DetailZoomToolbar — sits between the minimap and the detail
// gantt. Controls the bottom pane's zoom only; the minimap is
// always locked to the OVERVIEW_ZOOM (week+).
// ============================================================
function DetailZoomToolbar({ zoomId, onChange, onCenterToday }) {
  return (
    <div
      className="flex items-center gap-2 px-6 py-2 flex-shrink-0"
      style={{ borderBottom: '1px solid #44403c', backgroundColor: '#292524' }}
    >
      <span
        className="text-[10px] font-mono uppercase tracking-wider"
        style={{ color: '#a8a29e' }}
      >
        Detail zoom
      </span>
      <div className="flex rounded-sm overflow-hidden" style={{ border: '1px solid #44403c' }}>
        {ZOOM_LEVELS.map(z => (
          <button
            key={z.id}
            type="button"
            onClick={() => onChange(z.id)}
            className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider"
            style={{
              color: zoomId === z.id ? '#fff7ed' : '#a8a29e',
              backgroundColor: zoomId === z.id ? '#ea580c' : '#1c1917',
              borderRight: '1px solid #44403c',
            }}
            title={`Switch the detail gantt to ${z.label} zoom`}
          >
            {z.label}
          </button>
        ))}
      </div>
      {/* Center-on-today button — snaps the detail viewport so today
          sits in the middle of the visible window. Useful after the
          user has panned far away or zoomed out / in. */}
      <button
        type="button"
        onClick={onCenterToday}
        className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-stone-700 transition-colors"
        style={{
          border: '1px solid #44403c',
          color: '#a8a29e',
          backgroundColor: '#1c1917',
        }}
        title="Center the detail timeline on today"
      >
        <Crosshair className="w-3 h-3" />
        <span className="text-[10px] font-mono uppercase tracking-wider">Today</span>
      </button>
      <span
        className="text-[10px] font-mono"
        style={{ color: '#78716c' }}
      >
        · minimap above is locked to weeks
      </span>
    </div>
  )
}

// ============================================================
// SettingsPanel — slide-out from the right with two tabs:
// Settings + System Prompts (matches DOG/OTTER pattern).
// ============================================================
function SettingsPanel({ settings, patchSettings, settingsTab, setSettingsTab, onClose, onOpenHelp }) {
  const [promptsLocked, setPromptsLocked] = useState(true)
  const [toolsLocked, setToolsLocked]     = useState(true)
  const isLocked = settingsTab === 'prompts' ? promptsLocked : toolsLocked

  // Editable prompt drafts — keyed by section. Persisted to localStorage
  // alongside settings so edits survive a reload.
  const PROMPT_KEY = 'rabbit-prompts-v1'
  const [editingPrompts, setEditingPrompts] = useState(() => {
    try {
      const raw = localStorage.getItem(PROMPT_KEY)
      if (raw) return JSON.parse(raw)
    } catch {}
    return {
      scheduler:        RABBIT_SCHEDULER_PROMPT,
      taskRecommender:  RABBIT_TASK_RECOMMENDER_PROMPT,
      phaseGenerator:   RABBIT_PHASE_GENERATOR_PROMPT,
    }
  })
  const [openSection, setOpenSection] = useState('scheduler')
  function savePrompts() {
    try { localStorage.setItem(PROMPT_KEY, JSON.stringify(editingPrompts)) } catch {}
  }

  const promptSections = [
    { key: 'scheduler',       title: 'Scheduler',        desc: 'Schedules tasks under dependency + phase constraints',       defaultVal: RABBIT_SCHEDULER_PROMPT },
    { key: 'taskRecommender', title: 'Task Recommender', desc: 'Suggests missing tasks per asset',                            defaultVal: RABBIT_TASK_RECOMMENDER_PROMPT },
    { key: 'phaseGenerator',  title: 'Phase Generator',  desc: 'Proposes high-level phases from a project description',      defaultVal: RABBIT_PHASE_GENERATOR_PROMPT },
  ]

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 transition-opacity" onClick={onClose} />
      <div
        className="absolute top-0 right-0 h-full bg-stone-800 border-l-2 border-stone-600 shadow-2xl flex flex-col"
        style={{
          width: '40%',
          minWidth: '420px',
          paddingTop: typeof window !== 'undefined' && window.electronAPI ? '32px' : '0px',
          animation: 'slideInRight 0.3s ease-out',
        }}
      >
        {/* Header */}
        <div className="bg-stone-700 px-4 py-3 flex items-center justify-between border-b-2 border-stone-600 shrink-0">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-orange-400" />
            <span className="font-bold text-orange-400 uppercase tracking-wide">RABBIT Settings</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-600 rounded transition-colors">
            <X className="w-5 h-5 text-stone-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0">
          <button
            onClick={() => setSettingsTab('settings')}
            className={`flex-1 px-4 py-2 text-sm font-bold transition-colors border-b-2 ${
              settingsTab === 'settings'
                ? 'text-orange-400 border-orange-500 bg-stone-900'
                : 'text-stone-400 border-transparent bg-stone-700'
            }`}
          >
            Settings
          </button>
          <button
            onClick={() => setSettingsTab('prompts')}
            className={`flex-1 px-4 py-2 text-sm font-bold transition-colors border-b-2 ${
              settingsTab === 'prompts'
                ? 'text-orange-400 border-orange-500 bg-stone-900'
                : 'text-stone-400 border-transparent bg-stone-700'
            }`}
          >
            System Prompts
          </button>
        </div>

        {/* Lock bar */}
        <div className="bg-stone-900 px-4 py-2 border-b-2 border-stone-600 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            {isLocked
              ? <Lock className="w-4 h-4 text-stone-500" />
              : <Unlock className="w-4 h-4 text-orange-400" />}
            <span className={`text-xs font-bold uppercase tracking-wide ${isLocked ? 'text-stone-500' : 'text-orange-400'}`}>
              {isLocked ? 'Locked' : 'Unlocked'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] uppercase tracking-wide ${isLocked ? 'text-stone-500' : 'text-stone-400'}`}>
              {isLocked ? 'Read Only' : 'Editable'}
            </span>
            <button
              onClick={() => {
                if (settingsTab === 'prompts') setPromptsLocked(!promptsLocked)
                else setToolsLocked(!toolsLocked)
              }}
              className={`relative w-11 h-6 rounded-full transition-colors ${isLocked ? 'bg-stone-600' : 'bg-orange-500'}`}
            >
              <span
                className={`absolute top-1 w-4 h-4 bg-stone-500 rounded-full transition-transform ${isLocked ? 'left-1' : 'left-6'}`}
              />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {settingsTab === 'settings' && (
            <div className={toolsLocked ? 'opacity-60 pointer-events-none' : ''}>
              <div className="bg-stone-900 border-2 border-stone-600 rounded-sm p-4 mb-4">
                <label className="block text-sm font-bold mb-2 text-orange-400">Timeline Display</label>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-stone-300">Show weekends</div>
                    <p className="text-[10px] text-stone-500 mt-1">
                      When OFF, Saturday + Sunday columns are hidden from the day-view gantt entirely.
                      When ON, weekends get a soft tint so they read as non-work days.
                    </p>
                  </div>
                  <button
                    onClick={() => patchSettings({ showWeekends: !settings.showWeekends })}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-3 ${settings.showWeekends ? 'bg-orange-500' : 'bg-stone-600'}`}
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 bg-stone-200 rounded-full transition-transform ${settings.showWeekends ? 'left-6' : 'left-1'}`}
                    />
                  </button>
                </div>
              </div>
              <div className="bg-stone-900 border-2 border-stone-600 rounded-sm p-4 mb-4">
                <label className="block text-sm font-bold mb-2 text-orange-400">About</label>
                <p className="text-[10px] text-stone-500">
                  RABBIT is WILSON's resource allocation tool. Settings are scoped to the
                  current browser profile and persist via localStorage.
                </p>
              </div>
            </div>
          )}

          {settingsTab === 'prompts' && (
            <div className={promptsLocked ? 'opacity-60' : ''}>
              {promptSections.map(s => (
                <div key={s.key} className="border-b border-stone-700 overflow-hidden">
                  <button
                    onClick={() => setOpenSection(openSection === s.key ? null : s.key)}
                    className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors"
                  >
                    <div className="text-left">
                      <span className={`text-xs font-bold uppercase tracking-wide ${promptsLocked ? 'text-stone-500' : 'text-orange-400'}`}>
                        {s.title}
                      </span>
                      <p className="text-[10px] text-stone-500">{s.desc}</p>
                    </div>
                    <ChevronRight
                      className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${openSection === s.key ? 'rotate-90' : ''}`}
                    />
                  </button>
                  {openSection === s.key && (
                    <div className="px-3 pb-3 pt-2">
                      <textarea
                        value={editingPrompts[s.key] || ''}
                        onChange={(e) =>
                          setEditingPrompts(prev => ({ ...prev, [s.key]: e.target.value }))
                        }
                        disabled={promptsLocked}
                        className={`w-full h-48 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none ${promptsLocked ? 'cursor-not-allowed' : ''}`}
                      />
                      <div className="flex gap-3 mt-1">
                        <button
                          onClick={() =>
                            setEditingPrompts(prev => ({ ...prev, [s.key]: s.defaultVal }))
                          }
                          disabled={promptsLocked}
                          className={`text-[10px] ${promptsLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}
                        >
                          Reset to default
                        </button>
                        <button
                          onClick={savePrompts}
                          disabled={promptsLocked}
                          className={`text-[10px] ${promptsLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t-2 border-stone-600 flex-shrink-0 flex items-center justify-between gap-3">
          <p className="text-[10px] text-stone-500 flex-1">
            Changes are applied immediately. Use &quot;Reset to default&quot; to restore
            original settings.
          </p>
          {onOpenHelp && (
            <button
              type="button"
              onClick={onOpenHelp}
              title="Open RABBIT help & documentation"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wide transition-colors text-orange-400 border border-orange-500/40 bg-stone-900 hover:bg-stone-700 hover:text-orange-300 flex-shrink-0"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              Help
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// HelpModal — 850×82vh modal with sidebar + content (DOG/OTTER pattern)
// ============================================================
function HelpModal({ helpPage, setHelpPage, onClose }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className="relative bg-stone-800 border-2 border-stone-600 rounded-sm shadow-2xl flex flex-col"
        style={{ width: '850px', height: '82vh' }}
      >
        <div className="bg-stone-700 px-4 py-3 flex items-center justify-between border-b-2 border-stone-600 flex-shrink-0">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-orange-400" />
            <span className="font-bold text-orange-400 uppercase tracking-wide">
              Help & Documentation
            </span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-600 rounded transition-colors">
            <X className="w-5 h-5 text-stone-400" />
          </button>
        </div>
        <div className="flex-1 flex overflow-hidden">
          <nav className="w-52 flex-shrink-0 bg-stone-900 border-r border-stone-700 overflow-y-auto py-2 flex flex-col">
            <div className="flex-1">
              {RABBIT_HELP_SIDEBAR_ITEMS.map(item => (
                <button
                  key={item.id}
                  onClick={() => setHelpPage(item.id)}
                  className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                    helpPage === item.id
                      ? 'bg-stone-800 text-orange-400 font-bold border-l-2 border-orange-500'
                      : 'text-stone-400 hover:bg-stone-800 hover:text-stone-300 border-l-2 border-transparent'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="px-3 py-2 border-t border-stone-800">
              <span className="text-xs text-stone-500 font-mono">RABBIT v0.1.0</span>
            </div>
          </nav>
          <div className="flex-1 overflow-y-auto p-5">
            <RabbitHelpContent helpPage={helpPage} theme="dark" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// ZoomControls (legacy — kept for compatibility, no longer
// rendered. The new DetailZoomToolbar replaced it.)
// ============================================================

function ZoomControls({ zoomId, onChange }) {
  const idx = ZOOM_LEVELS.findIndex(z => z.id === zoomId)
  const canZoomIn  = idx > 0
  const canZoomOut = idx < ZOOM_LEVELS.length - 1
  return (
    <div className="ml-auto flex items-center gap-1">
      <button
        type="button"
        onClick={() => canZoomIn && onChange(ZOOM_LEVELS[idx - 1].id)}
        disabled={!canZoomIn}
        className="p-1 rounded-sm hover:bg-stone-700 disabled:opacity-30"
        title="Zoom in"
        style={{ color: '#a8a29e', border: '1px solid #44403c' }}
      >
        <ZoomIn className="w-3 h-3" />
      </button>
      <div className="flex rounded-sm overflow-hidden" style={{ border: '1px solid #44403c' }}>
        {ZOOM_LEVELS.map(z => (
          <button
            key={z.id}
            type="button"
            onClick={() => onChange(z.id)}
            className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider"
            style={{
              color: zoomId === z.id ? '#fff7ed' : '#a8a29e',
              backgroundColor: zoomId === z.id ? '#ea580c' : '#1c1917',
              borderRight: '1px solid #44403c',
            }}
          >
            {z.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => canZoomOut && onChange(ZOOM_LEVELS[idx + 1].id)}
        disabled={!canZoomOut}
        className="p-1 rounded-sm hover:bg-stone-700 disabled:opacity-30"
        title="Zoom out"
        style={{ color: '#a8a29e', border: '1px solid #44403c' }}
      >
        <ZoomOut className="w-3 h-3" />
      </button>
    </div>
  )
}

// ============================================================
// SummaryBand
// ============================================================

function SummaryBand({ summary }) {
  return (
    <div
      className="flex items-center gap-2 px-6 py-2 flex-wrap flex-shrink-0"
      style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}
    >
      <SummaryTile icon={Layers}        label="Phases"        value={summary.phases} />
      <SummaryTile icon={Boxes}         label="Assets"        value={summary.assets} />
      <SummaryTile icon={ListChecks}    label="Tasks"         value={summary.tasks} />
      <SummaryTile icon={GitBranch}     label="Critical"      value={summary.critical} />
      <SummaryTile icon={AlertTriangle} label="Blocked"       value={summary.blocked} tone={summary.blocked > 0 ? 'danger' : undefined} />
      <SummaryTile icon={CalendarDays}  label="Span"          value={`${summary.spanDays} d`} />
      <SummaryTile icon={CalendarDays}  label="Critical days" value={`${summary.criticalDays.toFixed(1)} d`} />
    </div>
  )
}

function SummaryTile({ icon: Icon, label, value, tone }) {
  const colors = tone === 'danger'
    ? { bg: '#1c1917', border: '#7f1d1d', text: '#fca5a5' }
    : { bg: '#292524', border: '#44403c', text: '#d6d3d1' }
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-sm"
      style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}
    >
      <Icon className="w-3 h-3" style={{ color: '#fb923c' }} />
      <span className="text-[11px] font-mono font-bold" style={{ color: colors.text }}>{value}</span>
      <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>{label}</span>
    </div>
  )
}

// ─── Lifecycle state classification ───────────────────────────
//
// Three states the user reads at a glance:
//   • completed — done, faded out
//   • active    — happening right now, gently emphasized
//   • upcoming  — not started yet, outlined / muted
//
// UX principles in play here (Hick's Law + Von Restorff effect):
// keep the palette CALM so the eye isn't fighting noise. Only the
// active state carries warm color; everything else recedes. This
// way the user's attention naturally goes to what's happening
// "now" without screaming for it.
function lifecycleState(start, end, status) {
  // Status field overrides date-based detection. final/approved
  // means the user has explicitly closed it.
  if (status === 'final' || status === 'approved') return 'completed'
  const today = TODAY
  if (end && end < today) return 'completed'
  if (start && start > today) return 'upcoming'
  return 'active'
}

// barTone — pick a palette for a phase or task bar.
// Args:
//   row        — { start, end, task?, phase? } so we can read dates + status
//   critical   — true if this task is on the critical path
//   phaseStyle — true for phase bars (slightly bolder palette so phases still read as containers)
function barTone(row, critical, phaseStyle) {
  const status = phaseStyle ? null : row?.task?.status

  // Problem-state overrides — these stay distinctive because the
  // user NEEDS to notice them. They're rare so they don't compete
  // with the main lifecycle palette.
  if (!phaseStyle) {
    if (status === 'blocked') return { bg: '#1c1917', border: '#7f1d1d', fg: '#fca5a5' }
    if (status === 'on_hold') return { bg: '#1c1917', border: '#78350f', fg: '#fcd34d' }
  }

  const state = lifecycleState(row?.start, row?.end, status)

  if (phaseStyle) {
    // Phase palette — same lifecycle, slightly more presence so a
    // phase bar still reads as a container above its tasks.
    if (state === 'completed') return { bg: '#27272a', border: '#52525b', fg: '#a1a1aa' }
    if (state === 'upcoming')  return { bg: '#1c1917', border: '#78716c', fg: '#d6d3d1' }
    // active phase — soft warm orange (same family as task active,
    // a touch deeper so phases still anchor the row visually)
    return { bg: '#7c2d12', border: '#fb923c', fg: '#fff7ed' }
  }

  // Task palette — identical lifecycle, calmer than the phase tier.
  if (state === 'completed') return { bg: '#27272a', border: '#3f3f46', fg: '#71717a' }
  if (state === 'upcoming')  return { bg: '#1c1917', border: '#57534e', fg: '#a8a29e' }
  // active task — critical-path gets a slightly hotter border so it
  // pops out of the active set without being a different category
  if (critical) return { bg: '#9a3412', border: '#fb923c', fg: '#fff7ed' }
  return { bg: '#7c2d12', border: '#c2410c', fg: '#fed7aa' }
}

// ============================================================
// Schedule + row builders
// ============================================================

// buildSchedule returns { tasks: { id → { start, end } }, phases: { id → { start, end } } }.
// Tasks: explicit start/end if set, otherwise lay out from the
// dependency DAG with bid_days. Phases: explicit start/end if
// set, otherwise derived from earliest child start to latest
// child end.
function buildSchedule({ phases, assets, tasks, dependencies }) {
  const taskMap = {}
  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]))
  const successors = {}
  const predecessors = {}
  for (const t of tasks) { successors[t.id] = []; predecessors[t.id] = [] }
  for (const dep of dependencies || []) {
    if (!taskById[dep.predecessor_id] || !taskById[dep.successor_id]) continue
    successors[dep.predecessor_id].push({ id: dep.successor_id, lag: dep.lag_days || 0 })
    predecessors[dep.successor_id].push({ id: dep.predecessor_id, lag: dep.lag_days || 0 })
  }

  const inDeg = Object.fromEntries(tasks.map(t => [t.id, predecessors[t.id].length]))
  const queue = tasks.filter(t => inDeg[t.id] === 0).map(t => t.id)
  const topo = []
  while (queue.length) {
    const id = queue.shift()
    topo.push(id)
    for (const { id: succ } of successors[id]) {
      inDeg[succ] -= 1
      if (inDeg[succ] === 0) queue.push(succ)
    }
  }
  if (topo.length !== tasks.length) {
    for (const t of tasks) if (!topo.includes(t.id)) topo.push(t.id)
  }

  for (const id of topo) {
    const t = taskById[id]
    const explicitStart = parseDate(t.start_date)
    const explicitEnd   = parseDate(t.end_date)
    let start
    let end
    if (explicitStart && explicitEnd) {
      start = explicitStart
      end   = explicitEnd
    } else {
      let earliest = TODAY
      for (const { id: predId, lag } of predecessors[id]) {
        const predEntry = taskMap[predId]
        if (predEntry?.end) {
          const candidate = addDays(predEntry.end, lag || 0)
          if (candidate > earliest) earliest = candidate
        }
      }
      start = explicitStart || earliest
      const dur = Math.max(1, Number(t.bid_days || 1))
      end = addDays(start, dur)
    }
    taskMap[id] = { start, end }
  }

  // Phase schedule. Phases form a tree via parent_phase_id; a
  // parent's derived span covers every descendant phase's tasks
  // too, so the bar at the top of a Pre-production group always
  // hugs whatever its sub-phases / assets actually contain.
  const phaseMap = {}
  const assetById = Object.fromEntries(assets.map(a => [a.id, a]))
  const childrenByParent = groupPhasesByParent(phases)

  function descendantPhaseIds(rootId) {
    const out = new Set([rootId])
    const stack = [rootId]
    while (stack.length) {
      const id = stack.pop()
      for (const child of childrenByParent[id] || []) {
        if (!out.has(child.id)) {
          out.add(child.id)
          stack.push(child.id)
        }
      }
    }
    return out
  }

  // Every phase ALWAYS gets a bar. Priority:
  //   1. Explicit start_date + end_date on the phase row.
  //   2. Derived span from descendant tasks (this phase + subphases).
  //   3. Partial explicit date → pad out 14d on the missing side.
  //   4. Fallback: today → today + 14d so the user can still see /
  //      drag the phase bar. A phase without any of these is the
  //      thread-like, begin-less / end-less row the user reported.
  for (const p of phases) {
    const explicitStart = parseDate(p.start_date)
    const explicitEnd   = parseDate(p.end_date)
    if (explicitStart && explicitEnd) {
      phaseMap[p.id] = { start: explicitStart, end: explicitEnd }
      continue
    }
    // Derive from any task whose phase_id (direct or via asset) is
    // this phase OR any of its descendants.
    const includedPhases = descendantPhaseIds(p.id)
    let min = null
    let max = null
    for (const t of tasks) {
      const tPhaseId = t.phase_id || (t.asset_id && assetById[t.asset_id]?.phase_id) || null
      if (!tPhaseId || !includedPhases.has(tPhaseId)) continue
      const sched = taskMap[t.id]
      if (!sched) continue
      if (!min || sched.start < min) min = sched.start
      if (!max || sched.end   > max) max = sched.end
    }
    if (min && max) {
      phaseMap[p.id] = { start: explicitStart || min, end: explicitEnd || max }
    } else if (explicitStart || explicitEnd) {
      const s = explicitStart || addDays(explicitEnd, -14)
      const e = explicitEnd   || addDays(explicitStart, 14)
      phaseMap[p.id] = { start: s, end: e }
    } else {
      // Fallback — no dates, no descendant tasks. Still render a
      // bar so the user can drag / edit it into place.
      phaseMap[p.id] = { start: TODAY, end: addDays(TODAY, 14), fallback: true }
    }
  }

  // Second pass: a parent phase whose own dates came from a fallback
  // should expand to cover its now-known sub-phase bars too.
  let changed = true
  let guard = 0
  while (changed && guard++ < 8) {
    changed = false
    for (const p of phases) {
      const kids = childrenByParent[p.id] || []
      if (kids.length === 0) continue
      const me = phaseMap[p.id]
      if (!me) continue
      let min = me.start
      let max = me.end
      for (const k of kids) {
        const ks = phaseMap[k.id]
        if (!ks) continue
        if (ks.start < min) min = ks.start
        if (ks.end   > max) max = ks.end
      }
      if (min !== me.start || max !== me.end) {
        phaseMap[p.id] = { ...me, start: min, end: max }
        changed = true
      }
    }
  }

  return { tasks: taskMap, phases: phaseMap }
}

// buildRows builds the detail-pane row list as a depth-first
// walk of the phase tree. The timeline is a two-level structure —
// phases (and sub-phases) with tasks directly inside. Assets are a
// categorization concept that lives off-timeline; they don't get
// their own rows here.
//
//   Phase A                          (depth 0)
//     Task X                         (depth 1)
//     Task Y                         (depth 1)
//     Sub-phase A1                   (depth 1)
//       Task Z                       (depth 2)
//   Phase B                          (depth 0)
//   Unphased                         (depth 0, only if any tasks)
//
// A task's effective phase is:
//     task.phase_id                   (if set), else
//     asset.phase_id via task.asset_id (if that asset has one), else
//     null (lives under the Unphased bucket).
//
// Empty phases still render so the user can see the structure they
// built and drag bars into them.
function buildRows({ phases, assets, tasks, schedule }) {
  const childrenByParent = groupPhasesByParent(phases)
  const assetById = Object.fromEntries(assets.map(a => [a.id, a]))
  const phaseById = Object.fromEntries(phases.map(p => [p.id, p]))

  // Compute a task's effective phase_id.
  function effectivePhaseOf(task) {
    if (task.phase_id && phaseById[task.phase_id]) return task.phase_id
    if (task.asset_id && assetById[task.asset_id]?.phase_id) {
      const apid = assetById[task.asset_id].phase_id
      if (phaseById[apid]) return apid
    }
    return null
  }

  // Bucket tasks flat-by-phase. No asset nesting.
  const tasksByPhase = {}   // { [phaseId]: Task[] }
  const unphasedTasks = []
  for (const t of tasks) {
    const epid = effectivePhaseOf(t)
    if (!epid) { unphasedTasks.push(t); continue }
    if (!tasksByPhase[epid]) tasksByPhase[epid] = []
    tasksByPhase[epid].push(t)
  }

  // Task ordering inside a phase: sort by start date (scheduled or
  // explicit), then by title as a stable tiebreaker.
  function sortTasks(list) {
    return list.slice().sort((a, b) => {
      const as = schedule.tasks[a.id]?.start
      const bs = schedule.tasks[b.id]?.start
      if (as && bs && as.getTime() !== bs.getTime()) return as - bs
      if (as && !bs) return -1
      if (!as && bs) return 1
      return String(a.title || '').localeCompare(String(b.title || ''))
    })
  }

  const rows = []

  // hasChildren: anything inside the phase — direct tasks or
  // sub-phases. Drives the collapse chevron's visibility.
  function phaseHasChildren(phase) {
    if ((tasksByPhase[phase.id] || []).length > 0) return true
    if ((childrenByParent[phase.id] || []).length > 0) return true
    return false
  }

  function pushPhase(phase, depth) {
    const phaseSched = schedule.phases[phase.id]
    const collapsed = !!phase.collapsed
    const hasChildren = phaseHasChildren(phase)
    rows.push({
      key:   `ph-${phase.id}`,
      kind:  'phase',
      label: phase.name || 'Untitled phase',
      phase,
      phaseHint: phase.id,
      depth,
      collapsed,
      hasChildren,
      start: phaseSched?.start,
      end:   phaseSched?.end,
    })
    // A collapsed phase hides its entire subtree.
    if (collapsed) return

    // 1) Tasks directly inside this phase.
    for (const t of sortTasks(tasksByPhase[phase.id] || [])) {
      const sched = schedule.tasks[t.id]
      rows.push({
        key:   `tk-${t.id}`,
        kind:  'task',
        label: t.title || 'Untitled task',
        task:  t,
        phaseHint: phase.id,
        assetHint: t.asset_id || null,
        depth: depth + 1,
        start: sched?.start,
        end:   sched?.end,
      })
    }

    // 2) Sub-phases (recursive).
    for (const child of childrenByParent[phase.id] || []) {
      pushPhase(child, depth + 1)
    }

    // 3) Drop zone — trailing "empty space" row that accepts drops
    //    of reparented tasks AND lets the user click to add a new
    //    task directly to this phase.
    rows.push({
      key:   `dz-${phase.id}`,
      kind:  'drop-zone',
      label: '+ New task',
      phase,
      phaseHint:  phase.id,
      depth:      depth + 1,
      phaseStart: phaseSched?.start,
      phaseEnd:   phaseSched?.end,
    })
  }

  for (const ph of childrenByParent['__root__'] || []) pushPhase(ph, 0)

  // Unphased section — a synthetic phase row that holds every task
  // whose effective phase is null.
  if (unphasedTasks.length > 0) {
    rows.push({
      key: 'ph-unphased',
      kind: 'phase',
      label: 'Unphased',
      depth: 0,
      hasChildren: true,
    })
    for (const t of sortTasks(unphasedTasks)) {
      const sched = schedule.tasks[t.id]
      rows.push({
        key:   `tk-${t.id}`,
        kind:  'task',
        label: t.title || 'Untitled task',
        task:  t,
        assetHint: t.asset_id || null,
        depth: 1,
        start: sched?.start,
        end:   sched?.end,
      })
    }
  }

  return rows
}

// buildOverviewRows: a flatter, less-indented list for the
// minimap. Walks the same phase tree the detail pane uses, but
// only emits rows that have a schedule (so the minimap stays
// dense).
function buildOverviewRows({ phases, assets, tasks, schedule }) {
  const out = []
  const childrenByParent = groupPhasesByParent(phases)
  const assetById = Object.fromEntries(assets.map(a => [a.id, a]))

  function walk(phase) {
    const ps = schedule.phases[phase.id]
    out.push({
      key:    `ovr-ph-${phase.id}`,
      kind:   'phase',
      label:  phase.name,
      phase,
      phaseId: phase.id,
      start:  ps?.start,
      end:    ps?.end,
    })
    // Tasks attached directly to this phase or to one of its
    // assets, but NOT to any sub-phase (sub-phases get their own
    // rows below).
    for (const t of tasks) {
      const tPhaseId = t.phase_id || (t.asset_id && assetById[t.asset_id]?.phase_id) || null
      if (tPhaseId !== phase.id) continue
      const ts = schedule.tasks[t.id]
      if (!ts) continue
      out.push({
        key:           `ovr-tk-${t.id}`,
        kind:          'task',
        label:         t.title,
        task:          t,
        parentPhaseId: phase.id,
        start:         ts.start,
        end:           ts.end,
      })
    }
    for (const child of childrenByParent[phase.id] || []) walk(child)
  }
  for (const p of childrenByParent['__root__'] || []) walk(p)

  // Orphan tasks.
  for (const t of tasks) {
    const tPhaseId = t.phase_id || (t.asset_id && assetById[t.asset_id]?.phase_id) || null
    if (tPhaseId) continue
    const ts = schedule.tasks[t.id]
    if (!ts) continue
    out.push({
      key:   `ovr-tk-${t.id}`,
      kind:  'task',
      label: t.title,
      task:  t,
      start: ts.start,
      end:   ts.end,
    })
  }
  return out
}

function totalSpan(schedule) {
  const dates = []
  for (const v of Object.values(schedule.tasks  || {})) { if (v?.start) dates.push(v.start); if (v?.end) dates.push(v.end) }
  for (const v of Object.values(schedule.phases || {})) { if (v?.start) dates.push(v.start); if (v?.end) dates.push(v.end) }
  if (dates.length === 0) {
    return { start: addDays(TODAY, -7), end: addDays(TODAY, 60), days: 67 }
  }
  let min = dates[0]
  let max = dates[0]
  for (const d of dates) {
    if (d < min) min = d
    if (d > max) max = d
  }
  return { start: min, end: max, days: daysBetween(min, max) }
}

// Overview spans the project ± buffer so the user has plenty of
// room to drag forward into the future.
function computeOverviewSpan(schedule) {
  const inner = totalSpan(schedule)
  const start = addDays(inner.start, -180)        // ~6 months back
  const end   = addDays(inner.end,    540)        // ~18 months forward
  return { start, end, days: daysBetween(start, end) }
}

// ============================================================
// Date utils
// ============================================================

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return startOfDay(x)
}
function daysBetween(a, b) {
  if (!a || !b) return 0
  const ms = b.getTime() - a.getTime()
  return Math.round(ms / (24 * 60 * 60 * 1000))
}
function parseDate(value) {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return startOfDay(d)
}
function formatDayLabel(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`
}
function formatMonth(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[d.getMonth()]} ${d.getFullYear()}`
}
function formatQuarter(d) {
  const q = Math.floor(d.getMonth() / 3) + 1
  return `Q${q} ${d.getFullYear()}`
}

// Detail axis ticks honoring the current zoom level.
function buildAxisTicks(start, totalDays, zoom) {
  const out = []
  for (let i = 0; i <= totalDays; i++) {
    const d = addDays(start, i)
    let include = false
    let label = ''
    let major = false
    switch (zoom.axisFormat) {
      case 'day':
        include = true
        label = formatDayLabel(d)
        major = d.getDate() === 1
        break
      case 'week':
        include = d.getDay() === 1 || i === 0 || d.getDate() === 1
        label = formatDayLabel(d)
        major = d.getDate() === 1
        break
      case 'month':
        include = d.getDate() === 1 || i === 0
        label = formatMonth(d)
        major = d.getMonth() === 0
        break
      case 'quarter':
        include = (d.getDate() === 1 && [0, 3, 6, 9].includes(d.getMonth())) || i === 0
        label = formatQuarter(d)
        major = d.getMonth() === 0
        break
      default:
        include = false
    }
    if (include) out.push({ key: i, offset: i, label, major })
  }
  return out
}

// Overview ticks: month boundaries with year labels.
function buildOverviewTicks(start, totalDays) {
  const out = []
  for (let i = 0; i <= totalDays; i++) {
    const d = addDays(start, i)
    if (d.getDate() !== 1 && i !== 0) continue
    out.push({
      key: i,
      offset: i,
      label: formatMonth(d),
      major: d.getMonth() === 0,
    })
  }
  return out
}

// Aggregates for the SummaryBand.
function buildSummary({ phases, assets, tasks, schedule, criticalSet }) {
  const blocked = tasks.filter(t => t.status === 'blocked').length
  const span = totalSpan(schedule)
  let criticalDays = 0
  for (const t of tasks) {
    if (criticalSet.has(t.id)) criticalDays += Number(t.bid_days || 0)
  }
  return {
    phases: phases.length,
    assets: assets.length,
    tasks:  tasks.length,
    critical: criticalSet.size,
    blocked,
    spanDays: span.days,
    criticalDays,
  }
}
