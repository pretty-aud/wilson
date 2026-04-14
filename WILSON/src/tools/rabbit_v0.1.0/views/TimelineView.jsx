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

import { useEffect, useMemo, useRef, useState, useCallback, forwardRef } from 'react'
import {
  CalendarDays, GitBranch, ZoomIn, ZoomOut, Layers, Boxes, ListChecks,
  AlertTriangle, Plus, X, Trash2, Save, ChevronRight, ChevronDown,
  Settings as SettingsIcon, HelpCircle, Lock, Unlock, Crosshair,
  Undo2, Redo2, Maximize2, Briefcase, Upload, Download, Check,
  Users, Film, Gamepad2, Sparkles, Diamond,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import FileManager from '../components/FileManager'
import TaskDetailPopup from '../components/TaskDetailPopup'
import { RABBIT_HELP_SIDEBAR_ITEMS, RabbitHelpContent } from '../rabbitHelpContent.jsx'
import TaskTemplateManager from '../../../components/TaskTemplates/TaskTemplateManager'
import {
  RABBIT_SCHEDULER_PROMPT,
  RABBIT_TASK_RECOMMENDER_PROMPT,
  RABBIT_PHASE_GENERATOR_PROMPT,
} from '../prompts.js'
import {
  loadHolidays, saveHolidays,
  parseHolidayCSV, exportHolidayCSV,
  countWorkingDays,
} from '../holidays.js'

// ─── Constants ──────────────────────────────────────────────

// Detail-pane zoom levels. Day view is the most zoomed-in: cells
// are large enough to read individual day numbers and weekends.
const ZOOM_LEVELS = [
  { id: 'day',     label: 'Day',     dayPx: 56,  axisFormat: 'day'     },
  { id: 'week',    label: 'Week',    dayPx: 22,  axisFormat: 'week'    },
  { id: 'month',   label: 'Month',   dayPx: 8,   axisFormat: 'month'   },
  { id: 'quarter', label: 'Quarter', dayPx: 4,   axisFormat: 'quarter' },
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
const OVERVIEW_SCROLLBAR_H = 10                   // infinite-wrap horizontal scrollbar
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

// ── Project type template defaults ──
// Each project type maps to which database modules should be
// toggled on by default when creating a new project of that type.
// Users can edit these defaults in the RABBIT system settings panel.
export const PROJECT_TYPE_LIST = [
  'commercial', 'film', 'series', 'music_video', 'branded_content',
  'social', 'animation', 'documentary', 'video_game', 'interactive_experience', 'experiential_activation', 'other',
]

export const DEFAULT_PROJECT_TYPE_TEMPLATES = {
  commercial:               { scenes_enabled: true,  levels_enabled: false, experiences_enabled: false, uses_realtime_engine: false },
  film:                     { scenes_enabled: true,  levels_enabled: false, experiences_enabled: false, uses_realtime_engine: false },
  series:                   { scenes_enabled: true,  levels_enabled: false, experiences_enabled: false, uses_realtime_engine: false },
  music_video:              { scenes_enabled: true,  levels_enabled: false, experiences_enabled: false, uses_realtime_engine: false },
  branded_content:          { scenes_enabled: false, levels_enabled: false, experiences_enabled: true,  uses_realtime_engine: false },
  social:                   { scenes_enabled: false, levels_enabled: false, experiences_enabled: false, uses_realtime_engine: false },
  animation:                { scenes_enabled: true,  levels_enabled: false, experiences_enabled: false, uses_realtime_engine: false },
  documentary:              { scenes_enabled: true,  levels_enabled: false, experiences_enabled: false, uses_realtime_engine: false },
  video_game:               { scenes_enabled: false, levels_enabled: true,  experiences_enabled: false, uses_realtime_engine: true  },
  interactive_experience:   { scenes_enabled: false, levels_enabled: true,  experiences_enabled: true,  uses_realtime_engine: true  },
  experiential_activation:  { scenes_enabled: false, levels_enabled: false, experiences_enabled: true,  uses_realtime_engine: false },
  other:                    { scenes_enabled: false, levels_enabled: false, experiences_enabled: false, uses_realtime_engine: false },
}

const DEFAULT_SETTINGS = {
  showWeekends: true,
  sortOrder:    'asc',  // 'asc' = earliest first (default), 'desc' = latest first
  groupBy:      'phase',
  projectTypeTemplates: DEFAULT_PROJECT_TYPE_TEMPLATES,
}

export function loadRabbitSettings() {
  try {
    const raw = localStorage.getItem(RABBIT_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}
export function saveRabbitSettings(s) {
  try { localStorage.setItem(RABBIT_SETTINGS_KEY, JSON.stringify(s)) } catch {}
}

// ============================================================
// TimelineView
// ============================================================

export default function TimelineView({ settings, patchSettings, holidays }) {
  const ctx = useRabbit()
  const project = ctx?.project
  const phases = ctx?.phases || []
  const assets = ctx?.assets || []
  const tasks  = ctx?.tasks  || []
  const dependencies = ctx?.dependencies || []
  const scenes      = ctx?.scenes || []
  const shots       = ctx?.shots || []
  const levels      = ctx?.levels || []
  const experiences = ctx?.experiences || []
  const milestones  = ctx?.milestones || []
  const teamAssignments = ctx?.teamAssignments || []

  const tm = useTeamMembers()

  const [zoomId, setZoomId] = useState('week')
  const zoom = ZOOM_LEVELS.find(z => z.id === zoomId) || ZOOM_LEVELS[1]
  const DAY_PX = zoom.dayPx
  const ROW_PX = ROW_PX_BY_ZOOM[zoomId] || DEFAULT_ROW_PX

  // ── collapsed phases (persisted) ─────────────────────────
  // Stored as a localStorage-backed Set of phase ids. This is
  // kept independent from the phase record so it doesn't depend
  // on the backend persisting a `collapsed` field — click the
  // chevron and the next render sees the collapse immediately.
  const COLLAPSE_KEY = 'rabbit-collapsed-phases-v1'
  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY)
      if (raw) return new Set(JSON.parse(raw))
    } catch {}
    return new Set()
  })
  const toggleCollapsed = useCallback((phaseId) => {
    if (!phaseId) return
    setCollapsedPhaseIds(prev => {
      const next = new Set(prev)
      if (next.has(phaseId)) next.delete(phaseId)
      else next.add(phaseId)
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])) } catch {}
      return next
    })
  }, [])

  // ── group-by mode ─────────────────────────────────────────
  const [groupBy, setGroupBy] = useState(settings.groupBy || 'phase')
  const handleGroupByChange = useCallback((mode) => {
    setGroupBy(mode)
    // Don't persist into settings — it's a per-session view toggle
  }, [])

  // ── Undo / redo keyboard shortcuts ──────────────────────
  // Ctrl+Z (Cmd+Z on mac) → undo, Ctrl+Shift+Z / Ctrl+Y → redo.
  // Skipped while the user is typing inside an input / textarea /
  // contenteditable so the editor modal still gets normal text undo.
  useEffect(() => {
    function onKey(e) {
      const t = e.target
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = (e.key || '').toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        ctx?.undo?.()
      } else if ((k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey)) {
        e.preventDefault()
        ctx?.redo?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctx])

  // Day-grain showWeekends switch only matters at day zoom — at
  // larger zooms the visible cells are weeks/months and weekends
  // can't be skipped meaningfully.
  const hideWeekends = !settings.showWeekends && zoomId === 'day'

  // ── editor ───────────────────────────────────────────────
  const [editor, setEditor] = useState(null)
  const closeEditor = () => setEditor(null)

  // Shared task-detail popup (same component used in Tasks tab)
  const [detailTaskId, setDetailTaskId] = useState(null)

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
  const openNewMilestone = (prefill = {}) => setEditor({
    mode:        'milestone',
    milestoneId: null,
    draft:       emptyMilestoneDraft(prefill),
  })
  const openEditMilestone = (ms) => setEditor({
    mode:        'milestone',
    milestoneId: ms.id,
    draft: {
      title:       ms.title || '',
      date:        toDateInputValue(ms.date),
      color:       ms.color || '#f59e0b',
      description: ms.description || '',
      phase_id:    ms.phase_id || '',
    },
  })
  // Existing tasks open the shared detail popup instead of the editor
  const openEditTask = (task) => setDetailTaskId(task.id)
  const openEditPhase = (phase) => setEditor({
    mode:    'phase',
    phaseId: phase.id,
    draft: {
      name:            phase.name || '',
      description:     phase.description || '',
      parent_phase_id: phase.parent_phase_id || '',
      start_date:      toDateInputValue(phase.start_date),
      end_date:        toDateInputValue(phase.end_date),
      status:          phase.status || 'not_started',
    },
  })
  const openEditAsset = (asset) => setEditor({
    mode:    'asset',
    assetId: asset.id,
    draft: {
      name:        asset.name || '',
      description: asset.description || '',
      phase_id:    asset.phase_id || '',
      start_date:  toDateInputValue(asset.start_date),
      due_date:    toDateInputValue(asset.due_date),
      status:      asset.status || 'not_started',
      type:        asset.type || '',
    },
  })

  // ── all milestones (user-created + synthetic project bounds) ──
  const allMilestones = useMemo(() => {
    const list = [...milestones]
    // Project start/end dates are always shown as milestones
    if (project?.start_date) {
      list.push({
        id: '__project_start__',
        title: 'Project Start',
        date: project.start_date,
        color: '#22c55e',
        isProjectBound: true,
      })
    }
    if (project?.end_date) {
      list.push({
        id: '__project_end__',
        title: 'Project End',
        date: project.end_date,
        color: '#ef4444',
        isProjectBound: true,
      })
    }
    return list
  }, [milestones, project?.start_date, project?.end_date])

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
    () => buildRowsByGrouping({
      groupBy, phases, assets, tasks, schedule,
      sortOrder: settings.sortOrder, collapsedSet: collapsedPhaseIds,
      teamAssignments, teamMembers: tm?.members || [],
      scenes, shots, levels, experiences,
    }),
    [groupBy, phases, assets, tasks, schedule, settings.sortOrder, collapsedPhaseIds,
     teamAssignments, tm?.members, scenes, shots, levels, experiences]
  )

  const summary = useMemo(
    () => buildSummary({ phases, assets, tasks, schedule, criticalSet, holidays }),
    [phases, assets, tasks, schedule, criticalSet, holidays]
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
  // ── minimap window state (zoom + pan independent of detail) ──
  // The minimap is now a free-floating window over an infinite
  // calendar. Zoom is measured in days (half a year to ten years,
  // with snap points at 1/2/5 years). Center is a calendar date —
  // null means "auto-fit to project + detail scroll".
  const MINIMAP_ZOOM_MIN_DAYS = 183          // ~6 months
  const MINIMAP_ZOOM_MAX_DAYS = 1825         // ~5 years (hard cap)
  const MINIMAP_SNAP_DAYS     = [365, 730, 1825] // 1y, 2y, 5y
  const MINIMAP_SNAP_PX       = 10           // snap tolerance in slider px

  const [minimapZoomDays, setMinimapZoomDays]   = useState(null)
  const [minimapCenterDate, setMinimapCenterDate] = useState(null)

  // Derived minimap span. Falls back to the full overviewSpan when
  // the user hasn't overridden either value yet — so the minimap
  // behaves like it did before until the user touches a control.
  const minimapSpan = useMemo(() => {
    const defaultDays = Math.max(
      MINIMAP_ZOOM_MIN_DAYS,
      Math.min(MINIMAP_ZOOM_MAX_DAYS, overviewSpan.days || 365)
    )
    const days = minimapZoomDays ?? defaultDays
    const defaultCenter = addDays(overviewSpan.start, Math.floor((overviewSpan.days || 0) / 2))
    const center = minimapCenterDate ?? defaultCenter
    const start = addDays(center, -Math.floor(days / 2))
    const end   = addDays(start, days)
    return { start, end, days, center }
  }, [minimapZoomDays, minimapCenterDate, overviewSpan.start, overviewSpan.days])

  const MINIMAP_DAY_PX = overviewWidth / Math.max(1, minimapSpan.days)

  // Calendar-date window the detail pane is showing. Used by the
  // minimap to position its frame rectangle in date space rather
  // than overview-buffer space.
  const visibleStartDate = addDays(overviewSpan.start, Math.max(0, Math.round(visibleStartDays)))
  const visibleEndDate   = addDays(overviewSpan.start, Math.max(0, Math.round(visibleEndDays)))

  // Translate a calendar date click on the minimap back into the
  // detail pane's day-offset coordinate system.
  const scrollDetailToDate = useCallback((date) => {
    if (!date) return
    const days = daysBetween(overviewSpan.start, date)
    scrollDetailToDay(days)
  }, [overviewSpan.start])

  // Pan the minimap by a number of days (positive = move forward
  // in time). Initializes the center-date state from the current
  // derived center on first touch so the initial drag doesn't jump.
  const panMinimap = useCallback((deltaDays) => {
    setMinimapCenterDate(prev => {
      const base = prev ?? addDays(overviewSpan.start, Math.floor((overviewSpan.days || 0) / 2))
      return addDays(base, Math.round(deltaDays))
    })
  }, [overviewSpan.start, overviewSpan.days])

  // Zoom the minimap, optionally pivoting on a specific date so
  // the date under the cursor stays put while the span changes
  // around it.
  const zoomMinimap = useCallback((nextDays, pivotDate) => {
    const clamped = Math.max(MINIMAP_ZOOM_MIN_DAYS, Math.min(MINIMAP_ZOOM_MAX_DAYS, Math.round(nextDays)))
    setMinimapZoomDays(clamped)
    if (pivotDate) {
      const prevDays  = minimapSpan.days
      const prevStart = minimapSpan.start
      const pivotOffsetDays = daysBetween(prevStart, pivotDate)
      const pivotFrac = pivotOffsetDays / Math.max(1, prevDays)
      const newStart  = addDays(pivotDate, -Math.round(pivotFrac * clamped))
      const newCenter = addDays(newStart, Math.floor(clamped / 2))
      setMinimapCenterDate(newCenter)
    }
  }, [minimapSpan.days, minimapSpan.start])

  // "Fit to project" — snap the minimap window to exactly the
  // project's first task/phase → last task/phase range, ignoring
  // the ±6mo/18mo padding the detail buffer uses.
  const fitMinimapToProject = useCallback(() => {
    const inner = totalSpan(schedule)
    const innerDays = Math.max(1, daysBetween(inner.start, inner.end))
    setMinimapZoomDays(innerDays)
    setMinimapCenterDate(addDays(inner.start, Math.floor(innerDays / 2)))
  }, [schedule])

  // "Center on today" — move the minimap window so today sits in
  // the middle. Preserves the current zoom level.
  const centerMinimapOnToday = useCallback(() => {
    setMinimapCenterDate(TODAY)
  }, [])

  // ── early return: no project ─────────────────────────────
  if (!project) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: '#1c1917' }}>
        <span className="text-[11.5px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>
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
      {/* ── Summary + minimap controls (single consolidated row) ── */}
      <SummaryBand
        summary={summary}
        minimapZoomDays={minimapSpan.days}
        minimapMinDays={MINIMAP_ZOOM_MIN_DAYS}
        minimapMaxDays={MINIMAP_ZOOM_MAX_DAYS}
        minimapSnapDays={MINIMAP_SNAP_DAYS}
        onMinimapZoomChange={(days) => zoomMinimap(days)}
        onMinimapFitProject={fitMinimapToProject}
        onMinimapCenterToday={centerMinimapOnToday}
      />

      {/* ── Overview pane (top half) ── */}
      <OverviewPane
        ref={overviewRef}
        groupBy={groupBy}
        phases={phases}
        assets={assets}
        tasks={tasks}
        schedule={schedule}
        criticalSet={criticalSet}
        span={minimapSpan}
        dayPx={MINIMAP_DAY_PX}
        sortOrder={settings.sortOrder}
        visibleStartDate={visibleStartDate}
        visibleEndDate={visibleEndDate}
        zoomMinDays={MINIMAP_ZOOM_MIN_DAYS}
        zoomMaxDays={MINIMAP_ZOOM_MAX_DAYS}
        scenes={scenes}
        shots={shots}
        levels={levels}
        experiences={experiences}
        teamAssignments={teamAssignments}
        teamMembers={tm?.members || []}
        onScrollDetailToDate={scrollDetailToDate}
        onPanMinimap={panMinimap}
        onZoomMinimap={zoomMinimap}
        onUpdateTask={(taskId, patch) => ctx.updateTask(taskId, patch).catch(() => {})}
        onUpdatePhase={(phaseId, patch) => ctx.updatePhase(phaseId, patch).catch(() => {})}
        onEditTask={openEditTask}
        onEditPhase={openEditPhase}
        milestones={allMilestones}
      />

      {/* ── Detail-pane zoom toolbar (sits between minimap + gantt) ── */}
      <DetailZoomToolbar
        zoomId={zoomId}
        onChange={setZoomId}
        onCenterToday={centerDetailOnToday}
        sortOrder={settings.sortOrder}
        onSortOrderChange={(o) => patchSettings({ sortOrder: o })}
        canUndo={!!ctx?.canUndo}
        canRedo={!!ctx?.canRedo}
        onUndo={() => ctx?.undo?.()}
        onRedo={() => ctx?.redo?.()}
        onNewPhase={() => openNewPhase()}
        onNewTask={() => openNewTask()}
        onNewMilestone={() => openNewMilestone()}
        groupBy={groupBy}
        onGroupByChange={handleGroupByChange}
        project={project}
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
        onMovePhaseAndChildren={(phaseId, deltaDays, phasePatch) => {
          // Move a phase bar AND every task that lives inside it (or
          // any of its sub-phases) by the same number of days, so the
          // user's drag preserves each task's offset within the phase.
          // The whole composite is wrapped in ctx.runBatch so it
          // commits as a SINGLE undo step (one Ctrl+Z reverts the
          // entire drag, not one task at a time).
          if (!deltaDays) {
            return ctx.updatePhase(phaseId, phasePatch).catch(() => {})
          }
          return ctx.runBatch(async () => {
            // BFS: collect this phase + every descendant sub-phase id.
            const affectedPhaseIds = new Set([phaseId])
            const stack = [phaseId]
            while (stack.length) {
              const currentId = stack.pop()
              for (const p of phases) {
                if (p.parent_phase_id === currentId && !affectedPhaseIds.has(p.id)) {
                  affectedPhaseIds.add(p.id)
                  stack.push(p.id)
                }
              }
            }
            // Build an asset → phase lookup so we catch tasks attached
            // via asset_id rather than phase_id directly.
            const assetPhaseById = {}
            for (const a of assets) assetPhaseById[a.id] = a.phase_id || null
            // Find every task whose effective phase id is inside the
            // affected set, and that has at least one explicit date to
            // shift. Tasks with no explicit dates derive from the DAG
            // and will follow naturally on the next render.
            const taskUpdates = []
            for (const t of tasks) {
              const effectivePhaseId =
                t.phase_id ||
                (t.asset_id ? assetPhaseById[t.asset_id] : null) ||
                null
              if (!effectivePhaseId || !affectedPhaseIds.has(effectivePhaseId)) continue
              const tStart = parseDate(t.start_date)
              const tEnd   = parseDate(t.end_date)
              if (!tStart && !tEnd) continue
              const patch = {}
              if (tStart) patch.start_date = toIsoDate(addDays(tStart, deltaDays))
              if (tEnd)   patch.end_date   = toIsoDate(addDays(tEnd,   deltaDays))
              taskUpdates.push(ctx.updateTask(t.id, patch).catch(() => {}))
            }
            const phaseUpdate = ctx.updatePhase(phaseId, phasePatch).catch(() => {})
            return Promise.all([phaseUpdate, ...taskUpdates])
          })
        }}
        onToggleCollapse={(phase) => toggleCollapsed(phase.id)}
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
        onEditAsset={openEditAsset}
        onUpdateAsset={(assetId, patch) => ctx.updateAsset(assetId, patch).catch(() => {})}
        milestones={allMilestones}
        onEditMilestone={openEditMilestone}
      />

      {/* ── Editor — new task / new phase / edit phase only ── */}
      {editor && (
        <TaskEditor
          editor={editor}
          assets={assets}
          phases={phases}
          ctx={ctx}
          onClose={closeEditor}
        />
      )}

      {/* ── Shared task detail popup (same component as Tasks tab) ── */}
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

// ============================================================
// OverviewPane — minimap + frame
// ============================================================

const OverviewPane = forwardRef(function OverviewPane({
  groupBy, phases, assets, tasks, schedule, criticalSet,
  span, dayPx, sortOrder,
  visibleStartDate, visibleEndDate,
  zoomMinDays = 183, zoomMaxDays = 3650,
  scenes, shots, levels, experiences, teamAssignments, teamMembers,
  onScrollDetailToDate,
  onPanMinimap, onZoomMinimap,
  onUpdateTask, onUpdatePhase,
  onEditTask, onEditPhase,
  milestones = [],
}, forwardedRef) {
  // The minimap ALWAYS shows phases regardless of the active
  // group-by mode. Phases are the project's backbone and the
  // minimap should always reflect them so the user can orient
  // within the timeline at a glance.
  const overviewRows = useMemo(
    () => buildOverviewRows({ phases, assets, tasks, schedule, sortOrder }),
    [phases, assets, tasks, schedule, sortOrder]
  )

  // Hover popup state. When the mouse enters a phase bar we
  // record the hovered row + the mouse viewport coordinates so a
  // fixed-position tooltip can render name / task count / dates.
  const [hoverPopup, setHoverPopup] = useState(null) // { row, x, y }

  // The minimap is now a panning viewport — BG drag pans the
  // minimap window, frame drag scrolls the detail pane, click
  // jumps the detail pane to that date. Task creation moves to
  // the header + Task button.
  const bgRef = useRef(null)
  const [isPanning, setIsPanning] = useState(false)
  // Suppress the click-to-jump handler when the user has just
  // finished a pan drag — otherwise mouseup at the end of a drag
  // fires a click and snaps the detail pane to whatever day the
  // cursor happened to land on.
  const suppressNextClickRef = useRef(false)

  function handleBackgroundMouseDown(e) {
    // React to any mousedown that wasn't already consumed by a bar
    // or the frame (both of which call stopPropagation). This lets
    // the user grab-and-pan from anywhere in the minimap body —
    // including the empty space between bars and even directly on
    // the row wrapper divs, which used to reject the pan because
    // their target wasn't bgRef.current.
    if (e.button !== 0) return
    e.preventDefault()
    let startX = e.clientX
    let moved = false
    setIsPanning(true)
    function onMove(ev) {
      const dx = ev.clientX - startX
      if (Math.abs(dx) > 1) {
        // Pan by full-pixel increments; reset anchor after each
        // handled chunk so we don't accumulate rounding error.
        const ddays = -dx / dayPx
        onPanMinimap?.(ddays)
        startX = ev.clientX
        if (Math.abs(dx) > MIN_DRAG_PX) moved = true
      }
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setIsPanning(false)
      if (moved) suppressNextClickRef.current = true
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function handleFrameMouseDown(e) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startVisibleDate = visibleStartDate
    const containerRect = bgRef.current?.getBoundingClientRect()
    // Auto-pan: when the frame is dragged near the edge of the
    // minimap viewport, start scrolling the minimap in that
    // direction so the frame can travel infinitely.
    const EDGE_ZONE = 24 // px from container edge to trigger pan
    const PAN_SPEED = 3  // days per animation frame
    let panDir = 0       // -1 left, 0 stop, +1 right
    let rafId = null
    function autoPan() {
      if (panDir !== 0) {
        onPanMinimap?.(panDir * PAN_SPEED)
      }
      rafId = requestAnimationFrame(autoPan)
    }
    rafId = requestAnimationFrame(autoPan)
    function onMove(ev) {
      const dx = ev.clientX - startX
      const ddays = dx / dayPx
      const newStart = addDays(startVisibleDate, Math.round(ddays))
      onScrollDetailToDate?.(newStart)
      // Check if cursor is near the edge of the container
      if (containerRect) {
        const relX = ev.clientX - containerRect.left
        if (relX < EDGE_ZONE) {
          panDir = -1
        } else if (relX > containerRect.width - EDGE_ZONE) {
          panDir = 1
        } else {
          panDir = 0
        }
      }
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (rafId) cancelAnimationFrame(rafId)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Click-to-jump on the background (without drag): scroll the
  // detail pane so the clicked date sits at the center of the
  // visible window. Skip if the click originated on a bar or the
  // frame (detected by walking up the DOM looking for a marker)
  // or if the previous mouseup finished a pan-drag.
  function handleBackgroundClick(e) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }
    // Walk up from the click target — if it (or any ancestor up to
    // bgRef) is marked as non-jumpable, bail out. Bars and the
    // frame both set data-minimap-nojump="1" so clicking them
    // doesn't also scroll the detail pane.
    let node = e.target
    while (node && node !== bgRef.current) {
      if (node.dataset && node.dataset.minimapNojump) return
      node = node.parentNode
    }
    const rect = bgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const clickedDate = addDays(span.start, Math.round(x / dayPx))
    const visibleDays = Math.max(1, daysBetween(visibleStartDate, visibleEndDate))
    const targetStart = addDays(clickedDate, -Math.floor(visibleDays / 2))
    onScrollDetailToDate?.(targetStart)
  }

  // Wheel handler: horizontal wheel pans (including Shift+vertical);
  // Ctrl/Cmd + wheel zooms pivoted on the cursor's date.
  function handleWheel(e) {
    // Ignore wheel events on the frame/bars so their own handling
    // (scroll detail pane) doesn't fight this.
    const delta = e.deltaX !== 0 ? e.deltaX : (e.shiftKey ? e.deltaY : 0)
    const ctrlZoom = e.ctrlKey || e.metaKey
    if (ctrlZoom && e.deltaY !== 0) {
      e.preventDefault()
      const rect = bgRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.clientX - rect.left
      const pivotDate = addDays(span.start, Math.round(x / dayPx))
      // Zoom factor 1.15× per wheel notch.
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15
      onZoomMinimap?.(span.days * factor, pivotDate)
      return
    }
    if (delta !== 0) {
      e.preventDefault()
      const ddays = delta / dayPx
      onPanMinimap?.(ddays)
    }
  }

  // Frame placement in minimap pixel space, derived from calendar
  // dates so the frame stays on the correct dates when the user
  // zooms or pans the minimap independently.
  const frameLeftDays  = daysBetween(span.start, visibleStartDate)
  const frameRightDays = daysBetween(span.start, visibleEndDate)
  const frameLeft      = frameLeftDays  * dayPx
  const frameWidth     = Math.max(8, (frameRightDays - frameLeftDays) * dayPx)
  const todayLeft      = daysBetween(span.start, TODAY) * dayPx
  // Off-screen flags for the arrow indicator — true when the
  // detail pane's visible window has panned entirely past the
  // minimap's current view.
  const frameOffLeft  = frameRightDays < 0
  const frameOffRight = frameLeftDays  > span.days

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
        borderBottom: '1px solid #292524',
        overflow: 'hidden',
      }}
    >
      {/* Axis header */}
      <div
        className="relative w-full"
        style={{
          height: OVERVIEW_HEADER,
          backgroundColor: '#1c1917',
          borderBottom: '1px solid #292524',
        }}
      >
        {ticks.map(tick => (
          <div
            key={tick.key}
            className="absolute top-0 bottom-0 flex flex-col justify-end pb-0.5 px-1"
            style={{
              left: tick.offset * dayPx,
              borderLeft: tick.major ? '1px solid #44403c' : '1px solid #292524',
            }}
          >
            <span className="text-[9.5px] font-mono whitespace-nowrap" style={{ color: tick.major ? '#a8a29e' : '#57534e' }}>
              {tick.label}
            </span>
          </div>
        ))}
      </div>

      {/* Body — bars + frame + pan cursor.
          Height = OVERVIEW_HEIGHT − header − scrollbar − 2 (pane
          border-bottom), so the frame's orange border and the row
          bars are never clipped by the bottom pane border. */}
      <div
        ref={bgRef}
        className="relative w-full"
        style={{
          height: OVERVIEW_HEIGHT - OVERVIEW_HEADER - OVERVIEW_SCROLLBAR_H - 2,
          cursor: isPanning ? 'grabbing' : 'grab',
          overflow: 'hidden',
        }}
        onMouseDown={handleBackgroundMouseDown}
        onClick={handleBackgroundClick}
        onWheel={handleWheel}
      >
        <div className="relative h-full" style={{ minHeight: innerH }}>
          {/* Month boundary divider lines — extend through the full
              minimap body so months are clearly separated. */}
          {ticks.map(tick => (
            <div
              key={`mb-${tick.key}`}
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{
                left: tick.offset * dayPx,
                width: 1,
                backgroundColor: tick.major ? '#44403c' : '#292524',
                opacity: tick.major ? 0.7 : 0.5,
              }}
            />
          ))}

          {/* Today line — only drawn when today lies inside the
              minimap's current visible span. */}
          {todayLeft >= 0 && todayLeft <= span.days * dayPx && (
            <div
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{ left: todayLeft, width: 1, backgroundColor: '#fca5a5', zIndex: 4 }}
            />
          )}

          {/* Milestone lines in minimap */}
          {milestones.map(ms => {
            const msDate = parseDate(ms.date)
            if (!msDate) return null
            const msDays = daysBetween(span.start, msDate)
            if (msDays < 0 || msDays > span.days) return null
            const msX = msDays * dayPx
            const msColor = ms.color || '#f59e0b'
            return (
              <div key={`ovr-ms-${ms.id}`} className="absolute top-0 bottom-0" style={{ left: msX, width: 1, zIndex: 7 }}>
                <div className="absolute top-0 bottom-0 pointer-events-none" style={{ width: 1, backgroundColor: msColor, opacity: 0.5 }} />
                <div
                  data-minimap-nojump="1"
                  className="pointer-events-auto cursor-pointer"
                  onMouseEnter={(e) => setHoverPopup({ row: { kind: 'milestone', label: ms.title, milestone: ms, start: msDate }, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setHoverPopup(prev => prev?.row?.kind === 'milestone' && prev.row.milestone?.id === ms.id ? { ...prev, x: e.clientX, y: e.clientY } : prev)}
                  onMouseLeave={() => setHoverPopup(prev => prev?.row?.milestone?.id === ms.id ? null : prev)}
                  style={{
                    position: 'absolute', top: -2, left: -5, width: 11, height: 11,
                    backgroundColor: msColor,
                    transform: 'rotate(45deg)',
                    border: '1.5px solid rgba(0,0,0,0.4)',
                    boxShadow: `0 0 3px ${msColor}66`,
                  }}
                />
              </div>
            )
          })}

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
                    onHoverEnter={(e) => {
                      if (r.kind === 'phase') {
                        setHoverPopup({ row: r, x: e.clientX, y: e.clientY })
                      }
                    }}
                    onHoverMove={(e) => {
                      if (r.kind === 'phase') {
                        setHoverPopup({ row: r, x: e.clientX, y: e.clientY })
                      }
                    }}
                    onHoverLeave={() => {
                      setHoverPopup(prev => (prev && prev.row.key === r.key) ? null : prev)
                    }}
                  />
                )}
              </div>
            )
          })}

          {/* Visible-window frame — only drawn when at least part
              of the detail pane's visible window intersects the
              current minimap span. When it's off-screen we hide
              the frame entirely and show an edge arrow instead. */}
          {!frameOffLeft && !frameOffRight && (
            <div
              data-minimap-nojump="1"
              className="absolute cursor-grab active:cursor-grabbing"
              style={{
                left: frameLeft,
                width: Math.max(8, frameWidth),
                // Leave a 1px gutter top and bottom so the 2px
                // orange border is fully visible (the old top:0 /
                // bottom:0 layout let the bottom border get clipped
                // under the OverviewPane's own border-bottom).
                top: 1,
                bottom: 1,
                border: '1px solid rgba(251, 146, 60, 0.5)',
                backgroundColor: 'rgba(251, 146, 60, 0.06)',
                borderRadius: 2,
                zIndex: 5,
              }}
              onMouseDown={handleFrameMouseDown}
              title="Drag to scroll the detail pane"
            />
          )}
        </div>
      </div>

      {/* ── Infinite horizontal scrollbar ──
          Below the body, a thin bar with a fixed-width thumb that
          the user can grab to pan the minimap. When the thumb is
          dragged past either edge of the track, it snaps back to
          the center visually — but the timeline keeps scrolling in
          the same direction, giving an "infinite" feel. This is
          what Notion's timeline scrollbar does. The bar sits at
          exactly OVERVIEW_SCROLLBAR_H pixels tall so the sibling
          body + scrollbar + 2px pane border add up to OVERVIEW_HEIGHT. */}
      <MinimapScrollbar
        dayPx={dayPx}
        height={OVERVIEW_SCROLLBAR_H}
        onPan={onPanMinimap}
      />

      {/* Off-frame indicator — when the detail pane's visible
          window is completely outside the minimap's current view,
          show a small arrow at the corresponding edge so the user
          knows which way to pan/zoom to find it. Clicking the
          arrow centers the minimap on the detail window. */}
      {frameOffLeft && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onPanMinimap?.(daysBetween(addDays(span.start, Math.floor(span.days / 2)), visibleStartDate))
          }}
          title="Detail view is off-screen (left) — click to pan"
          className="absolute flex items-center justify-center rounded-sm"
          style={{
            left: 4,
            top: OVERVIEW_HEADER + 4,
            width: 22,
            height: 22,
            color: '#fff7ed',
            backgroundColor: '#ea580c',
            border: '1px solid #c2410c',
            zIndex: 7,
          }}
        >
          <ChevronRight className="w-3.5 h-3.5" style={{ transform: 'rotate(180deg)' }} />
        </button>
      )}
      {frameOffRight && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onPanMinimap?.(daysBetween(addDays(span.start, Math.floor(span.days / 2)), visibleStartDate))
          }}
          title="Detail view is off-screen (right) — click to pan"
          className="absolute flex items-center justify-center rounded-sm"
          style={{
            right: 4,
            top: OVERVIEW_HEADER + 4,
            width: 22,
            height: 22,
            color: '#fff7ed',
            backgroundColor: '#ea580c',
            border: '1px solid #c2410c',
            zIndex: 7,
          }}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Phase hover tooltip — fixed-position popup anchored to
          the cursor. Shows the phase name, task count, and date
          range. Only renders when the user is hovering a phase
          row in this minimap. */}
      {hoverPopup && (hoverPopup.row?.kind === 'phase' || hoverPopup.row?.kind === 'milestone') && (
        <div
          className="fixed pointer-events-none rounded-sm shadow-lg"
          style={{
            left: hoverPopup.x + 14,
            top:  hoverPopup.y + 14,
            backgroundColor: '#1c1917',
            border: `1px solid ${hoverPopup.row.kind === 'milestone' ? (hoverPopup.row.milestone?.color || '#f59e0b') : '#fb923c'}`,
            padding: '6px 10px',
            zIndex: 9999,
            maxWidth: 320,
            fontFamily: 'monospace',
          }}
        >
          {hoverPopup.row.kind === 'milestone' ? (
            <>
              <div className="flex items-center gap-1.5">
                <Diamond className="w-3 h-3 flex-shrink-0" style={{ color: hoverPopup.row.milestone?.color || '#f59e0b' }} />
                <div className="text-[11.5px] font-bold truncate" style={{ color: hoverPopup.row.milestone?.color || '#f59e0b' }}>
                  {hoverPopup.row.label || 'Untitled milestone'}
                </div>
              </div>
              {hoverPopup.row.milestone?.description && (
                <div className="text-[10.5px] mt-1 truncate" style={{ color: '#d6d3d1' }}>{hoverPopup.row.milestone.description}</div>
              )}
              <div className="text-[10.5px] mt-0.5" style={{ color: '#a8a29e' }}>
                {hoverPopup.row.start ? formatTooltipDate(hoverPopup.row.start) : '— no date —'}
              </div>
              {hoverPopup.row.milestone?.isProjectBound && (
                <div className="text-[9.5px] mt-0.5 uppercase" style={{ color: '#78716c' }}>project bound</div>
              )}
            </>
          ) : (
            <>
              <div className="text-[11.5px] font-bold uppercase tracking-wider truncate" style={{ color: '#fb923c' }}>
                {hoverPopup.row.label || 'Untitled phase'}
              </div>
              <div className="text-[10.5px] mt-1" style={{ color: '#d6d3d1' }}>
                {hoverPopup.row.taskCount ?? 0} task{(hoverPopup.row.taskCount ?? 0) === 1 ? '' : 's'}
              </div>
              <div className="text-[10.5px]" style={{ color: '#a8a29e' }}>
                {hoverPopup.row.start && hoverPopup.row.end
                  ? `${formatTooltipDate(hoverPopup.row.start)} → ${formatTooltipDate(hoverPopup.row.end)}`
                  : '— no dates —'}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
})

// Short human date for hover popups: "Apr 8, 2026"
function formatTooltipDate(d) {
  if (!d) return ''
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

// ============================================================
// MinimapScrollbar — infinite-wrap horizontal scrollbar
// ============================================================
//
// A thin horizontal bar with a fixed-width thumb that pans the
// minimap via `onPan(deltaDays)`. The trick that makes it feel
// infinite: the thumb starts centered, and every time the drag
// would carry the thumb past either edge of the track, the thumb
// position snaps back to the center of the track WITHOUT moving
// the timeline — so the user can keep dragging indefinitely.
//
// Conversion: 1px of mouse movement = 1 / dayPx days of pan,
// matching the scale of the minimap's own pixel space so the
// bar's visual motion and the timeline motion feel 1:1.
function MinimapScrollbar({ dayPx, height, onPan }) {
  const trackRef = useRef(null)
  const [trackW, setTrackW] = useState(0)
  const [thumbOffset, setThumbOffset] = useState(0)  // px from center
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => setTrackW(el.clientWidth || 0)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Thumb geometry: fixed 35% of the track with sensible min/max.
  const THUMB_W = Math.max(48, Math.min(220, trackW * 0.35))
  const maxOffset = Math.max(0, (trackW - THUMB_W) / 2)

  function onThumbMouseDown(e) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    let prevX = e.clientX
    function onMove(ev) {
      const dx = ev.clientX - prevX
      if (dx === 0) return
      prevX = ev.clientX
      // Convert pixel drag to a day pan — same scale as the
      // minimap's own day-pixel so the visible window moves at
      // 1:1 speed with the cursor.
      if (dayPx > 0) onPan?.(dx / dayPx)
      setThumbOffset(prev => {
        const next = prev + dx
        // Wrap back to center when the thumb would leave the
        // track. This does NOT rewind the timeline — the pan
        // we just applied stands.
        if (Math.abs(next) >= maxOffset) return 0
        return next
      })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDragging(false)
      // On release, ease the thumb back to the center so the
      // next interaction always starts from a known position.
      setThumbOffset(0)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Clicking the track outside the thumb pans by one thumb width
  // in the clicked direction — classic scrollbar page-scroll.
  function onTrackMouseDown(e) {
    if (e.button !== 0) return
    if (e.target !== trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const thumbCenter = trackW / 2 + thumbOffset
    const dir = clickX < thumbCenter ? -1 : 1
    if (dayPx > 0) onPan?.(dir * THUMB_W / dayPx)
  }

  return (
    <div
      ref={trackRef}
      onMouseDown={onTrackMouseDown}
      data-minimap-nojump="1"
      className="relative w-full"
      style={{
        height,
        backgroundColor: '#0c0a09',
        borderTop: '1px solid #292524',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      <div
        onMouseDown={onThumbMouseDown}
        className="absolute rounded-full"
        style={{
          top: 2,
          bottom: 2,
          left: `calc(50% + ${thumbOffset}px - ${THUMB_W / 2}px)`,
          width: THUMB_W,
          backgroundColor: dragging ? '#fb923c' : '#57534e',
          border: '1px solid #44403c',
          cursor: dragging ? 'grabbing' : 'grab',
          transition: dragging ? 'none' : 'background-color 0.15s ease',
        }}
        title="Drag to pan the timeline — keeps scrolling past the edges"
      />
    </div>
  )
}

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

function OverviewBar({ row, span, dayPx, rowH, critical, onUpdateTask, onUpdatePhase, onEditTask, onEditPhase, onHoverEnter, onHoverMove, onHoverLeave }) {
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
      onMouseEnter={onHoverEnter}
      onMouseMove={onHoverMove}
      onMouseLeave={onHoverLeave}
      data-minimap-nojump="1"
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
        // Lift bars above the visible-window frame (zIndex 5) so
        // hover/click still hit the bar even when it sits inside
        // the orange frame rectangle. The frame's empty whitespace
        // remains draggable because it still occupies the gaps.
        zIndex: 6,
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
  onUpdateTask, onUpdatePhase, onMovePhaseAndChildren,
  onToggleCollapse,
  onLinkTasks, onLinkPhases, onUnlinkDependency,
  onMoveTaskToPhase,
  onEditTask, onEditPhase,
  onEditAsset, onUpdateAsset,
  onNewTaskInPhase,
  milestones = [],
  onEditMilestone,
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

  // Dependency-rewire drag — user grabs the arrow head of an
  // existing dependency and drags it. While active, the overlay
  // renders that dep's line from the predecessor to the cursor.
  // On release:
  //   - dropped on a same-kind bar other than the original
  //     successor → unlink old, link new (rewire)
  //   - dropped on the same bar                          → no-op
  //   - dropped anywhere else (empty space, wrong kind)  → unlink (disconnect)
  const [depRewire, setDepRewire] = useState(null)
  // { depId, kind, predId, origSuccId, curX, curY }

  function beginDependencyRewire({ dep, kind, predId, origSuccId }) {
    const containerEl = scrollRef.current
    if (!containerEl) return
    setDepRewire({
      depId: dep.id, kind, predId, origSuccId,
      curX: 0, curY: 0,
    })
    function onMove(ev) {
      const el = scrollRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = ev.clientX - rect.left + el.scrollLeft - LABEL_W
      const y = ev.clientY - rect.top  + el.scrollTop  - HEADER_PX
      setDepRewire(d => d ? { ...d, curX: x, curY: y } : d)
    }
    function onUp(ev) {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // Resolve drop target by walking up from the DOM element
      // under the cursor, same as beginDependencyDrag.
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)
      let node = hit
      let targetKey = null
      while (node && node !== document.body) {
        if (node.dataset && node.dataset.rowBar) {
          targetKey = node.dataset.rowBar
          break
        }
        node = node.parentNode
      }
      let rewired = false
      if (targetKey) {
        const [tKind, tId] = targetKey.split(':')
        if (tKind === kind && tId) {
          if (tId === origSuccId) {
            // Dropped back on original successor — treat as cancel.
            rewired = true
          } else if (tId !== predId) {
            // Valid rewire — unlink the old dep, create a new one.
            onUnlinkDependency?.(dep.id)
            if (kind === 'task')  onLinkTasks?.(predId, tId)
            if (kind === 'phase') onLinkPhases?.(predId, tId)
            rewired = true
          }
        }
      }
      if (!rewired) {
        // Dropped on empty space / self / wrong kind → disconnect.
        onUnlinkDependency?.(dep.id)
      }
      setDepRewire(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

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
        // Asset row without a bar: set the asset's dates instead of creating a task
        if (row.assetRef && (!row.start || !row.end)) {
          onUpdateAsset?.(row.assetRef.id, {
            start_date: toIsoDate(startDate),
            due_date:   toIsoDate(endDate),
          })
          return
        }
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

  // ─── Drag preview state for ghost overlays ───────────────
  // phaseDragPreview: while a phase bar is being moved, this records
  //   the dragged phase id + the live deltaDays. We use it to render
  //   translucent ghost copies of every contained task / sub-phase
  //   bar at their shifted positions, so the user sees exactly where
  //   the whole subtree will land.
  const [phaseDragPreview, setPhaseDragPreview] = useState(null) // { phaseId, deltaDays }
  // reparentTaskPreview: while a task is being dragged (either by
  //   the grip handle or by the bar body), this records the task's
  //   id + its current dates + its current phase id. When combined
  //   with reparentHoverPhaseId, we render a task-shaped ghost in
  //   the target phase's row so the user knows where it would fall.
  const [reparentTaskPreview, setReparentTaskPreview] = useState(null) // { taskId, start, end, currentPhaseId }

  // BFS the phase tree to find every descendant of the dragged
  // phase. The dragged phase itself is included so callers can
  // check membership uniformly; the renderer skips it explicitly
  // because its own DetailBar already moves with the cursor.
  const phaseDragAffectedIds = useMemo(() => {
    if (!phaseDragPreview) return null
    const set = new Set([phaseDragPreview.phaseId])
    const stack = [phaseDragPreview.phaseId]
    while (stack.length) {
      const cur = stack.pop()
      for (const p of phases || []) {
        if (p.parent_phase_id === cur && !set.has(p.id)) {
          set.add(p.id)
          stack.push(p.id)
        }
      }
    }
    return set
  }, [phaseDragPreview, phases])

  // Find the best row index to anchor a reparent ghost in. We
  // prefer the drop-zone row of the target phase (it sits right
  // under the phase's children, which is where a reparented task
  // visually lands), then fall back to the phase row itself, then
  // the synthetic Unphased row for the __unphased__ sentinel.
  function findGhostRowForPhase(phaseId) {
    if (!phaseId) return -1
    if (phaseId === '__unphased__') {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].key === 'ph-unphased') return i
      }
      return -1
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.kind === 'drop-zone' && r.phase?.id === phaseId) return i
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.kind === 'phase' && r.phase?.id === phaseId) return i
    }
    return -1
  }

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

    // Seed the in-row ghost preview with the task's current dates.
    // The ghost only renders when reparentHoverPhaseId is set, so
    // it costs nothing if the user never crosses a different phase.
    const taskRowIdx = rowIndexByTaskId[taskId]
    const taskRow = taskRowIdx != null ? rows[taskRowIdx] : null
    if (taskRow && taskRow.start && taskRow.end) {
      setReparentTaskPreview({
        taskId,
        start: taskRow.start,
        end:   taskRow.end,
        currentPhaseId: task.phase_id || taskRow.phaseHint || null,
      })
    }

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
      setReparentTaskPreview(null)
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
    if (row.kind === 'phase' && row.assetRef) onEditAsset?.(row.assetRef)
    else if (row.kind === 'phase' && row.phase) onEditPhase(row.phase)
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
            backgroundColor: '#1c1917',
            borderRight: '1px solid #292524',
          }}
        >
          <div
            className="flex items-end px-3 pb-2 sticky top-0 z-10"
            style={{
              height: HEADER_PX,
              borderBottom: '1px solid #292524',
              backgroundColor: '#1c1917',
            }}
          >
            <span className="text-[9.5px] font-mono uppercase tracking-widest" style={{ color: '#57534e' }}>
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
                    borderBottom: '1px solid transparent',
                    backgroundColor: isReparentHoverDz
                      ? '#7c2d12'
                      : (isDzHover ? 'rgba(234, 88, 12, 0.06)' : 'transparent'),
                    paddingLeft: 8 + depth * INDENT_UNIT + 20,
                    paddingRight: 8,
                    outline: isReparentHoverDz ? '2px dashed #fb923c' : undefined,
                    opacity: isDzHover || isReparentHoverDz ? 1 : 0.4,
                  }}
                  title="Click to add a new task to this phase"
                >
                  <Plus
                    className="w-3 h-3 mr-1.5"
                    style={{ color: isDzHover ? '#fb923c' : '#78716c' }}
                  />
                  <span
                    className="text-[11.5px] font-mono italic"
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
                className={`relative flex items-center hover:bg-stone-800/50 transition-colors ${isTaskRow ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
                style={{
                  height: rowPx,
                  borderBottom: r.kind === 'phase' ? '1px solid #292524' : '1px solid #1c1917',
                  backgroundColor: isHoverTarget
                    ? '#7c2d12'
                    : 'transparent',
                  borderLeft: r.kind === 'phase'
                    ? (r.isSubgroup ? '2px solid #78716c' : '2px solid #fb923c')
                    : '2px solid transparent',
                  paddingLeft: (6 + depth * INDENT_UNIT + 20),
                  paddingRight: 8,
                  outline: isHoverTarget ? '2px dashed #fb923c' : undefined,
                  userSelect: 'none',
                }}
                onMouseDown={isTaskRow ? (e) => startTaskDrag(e, r.task) : undefined}
                onClick={() => handleRowClick(r)}
                title={isTaskRow ? 'Click to edit · drag to move to another phase' : undefined}
              >
                {/* Collapse chevron — always visible on phase rows
                    so the user can hide the "+ New task" drop-zone
                    of an empty phase too. */}
                {r.kind === 'phase' && r.phase && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleCollapse?.(r.phase)
                    }}
                    className="absolute flex items-center justify-center rounded-sm hover:bg-stone-800"
                    style={{
                      left: 4 + depth * INDENT_UNIT,
                      top: (rowPx - 16) / 2,
                      width: 16,
                      height: 16,
                      color: r.isSubgroup ? '#78716c' : '#fb923c',
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
                  className={`text-[11.5px] font-mono truncate ${
                    r.kind === 'phase'
                      ? (r.isSubgroup ? 'font-medium' : 'font-semibold')
                      : ''
                  }`}
                  style={{ color: r.kind === 'phase' ? '#fb923c' : '#78716c' }}
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
              borderBottom: '1px solid #292524',
              backgroundColor: '#1c1917',
            }}
          >
            {ticks.map(tick => {
              if (dayMask && dayMask.mask[tick.offset]?.hidden) return null
              return (
                <div
                  key={tick.key}
                  className="absolute top-0 bottom-0 px-1"
                  style={{
                    left: dayToX(tick.offset),
                    display: 'flex',
                    flexDirection: 'column',
                    borderLeft: tick.major
                      ? '1px solid #44403c'
                      : '1px solid #292524',
                  }}
                >
                  {tick.topLabel && (
                    <span
                      className="text-[9.5px] font-mono font-medium whitespace-nowrap"
                      style={{ color: '#fb923c', marginTop: 4, lineHeight: 1 }}
                    >
                      {tick.topLabel}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <span
                    className="text-[9.5px] font-mono whitespace-nowrap"
                    style={{ color: tick.major ? '#78716c' : '#57534e', marginBottom: 4 }}
                  >
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
            {/* Grid + weekend tint + month / quarter boundaries */}
            {dayPx >= 4 && Array.from({ length: totalDays + 1 }, (_, i) => {
              const d = addDays(span.start, i)
              const dow = d.getDay()
              const isWeek = dow === 1
              const isWeekend = dow === 0 || dow === 6
              const isMonthStart = d.getDate() === 1
              const isQuarterStart = isMonthStart && [0, 3, 6, 9].includes(d.getMonth())
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
                      backgroundColor: dow === 0 ? 'rgba(120, 113, 108, 0.10)' : 'rgba(120, 113, 108, 0.06)',
                    }}
                  />
                )
              }
              if (dayMask && dayMask.mask[i]?.hidden) return null
              // Month-1st boundaries are always drawn as bold lines in
              // week + day views so months are clearly divided.
              // Quarter-1st boundaries are bold in quarter + month views.
              const isMajorBoundary =
                (isMonthStart && (zoomId === 'week' || zoomId === 'day')) ||
                (isQuarterStart && (zoomId === 'quarter' || zoomId === 'month'))
              if (isMajorBoundary) {
                return (
                  <div
                    key={`g-${i}`}
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{
                      left: dayToX(i),
                      width: 1,
                      backgroundColor: '#57534e',
                      opacity: 0.5,
                    }}
                  />
                )
              }
              // In quarter view, also draw lighter month-1st lines so
              // months within each quarter are visibly separated.
              if (isMonthStart && zoomId === 'quarter') {
                return (
                  <div
                    key={`g-${i}`}
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{
                      left: dayToX(i),
                      width: 1,
                      backgroundColor: '#44403c',
                      opacity: 0.4,
                    }}
                  />
                )
              }
              if (dayPx < 8 && !isWeek) return null
              return (
                <div
                  key={`g-${i}`}
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{
                    left: dayToX(i),
                    width: 1,
                    backgroundColor: isWeek ? '#44403c' : '#292524',
                    opacity: 0.4,
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

            {/* Milestone vertical lines + diamonds */}
            {milestones.map(ms => {
              const msDate = parseDate(ms.date)
              if (!msDate) return null
              const msDays = daysBetween(span.start, msDate)
              if (msDays < 0 || msDays > totalDays) return null
              if (dayMask && dayMask.mask[msDays]?.hidden) return null
              const msX = dayToX(msDays)
              const msColor = ms.color || '#f59e0b'
              return (
                <div key={`ms-${ms.id}`} className="absolute top-0 pointer-events-none" style={{ left: msX, zIndex: 8 }}>
                  {/* Vertical dashed line */}
                  <div
                    className="absolute"
                    style={{
                      top: 0,
                      bottom: 0,
                      left: 0,
                      width: 1.5,
                      height: rows.length * rowPx,
                      backgroundImage: `repeating-linear-gradient(to bottom, ${msColor} 0, ${msColor} 4px, transparent 4px, transparent 8px)`,
                      opacity: 0.5,
                    }}
                  />
                  {/* Diamond marker at top */}
                  <div
                    className="pointer-events-auto cursor-pointer"
                    onClick={() => !ms.isProjectBound && onEditMilestone?.(ms)}
                    title={`${ms.title}${ms.description ? ' — ' + ms.description : ''}${ms.isProjectBound ? ' (project bound)' : ''}`}
                    style={{
                      position: 'absolute',
                      top: -1,
                      left: -6,
                      width: 13,
                      height: 13,
                      backgroundColor: msColor,
                      border: '1.5px solid rgba(0,0,0,0.5)',
                      transform: 'rotate(45deg)',
                      boxShadow: `0 0 4px ${msColor}66`,
                      zIndex: 9,
                    }}
                  />
                </div>
              )
            })}

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
                          className="text-[10.5px] font-mono italic truncate px-2"
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
                      : (r.kind === 'phase'
                          ? (r.isSubgroup ? 'rgba(51, 48, 45, 0.45)' : 'rgba(68, 64, 60, 0.55)')
                          : 'transparent'),
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
                      subgroupStyle={!!r.isSubgroup}
                      assetRef={r.assetRef || null}
                      onUpdatePhase={onUpdatePhase}
                      onUpdateAsset={onUpdateAsset}
                      onMovePhaseAndChildren={onMovePhaseAndChildren}
                      onEditPhase={onEditPhase}
                      onEditAsset={onEditAsset}
                      onBeginDependencyDrag={r.isSubgroup ? null : beginDependencyDrag}
                      onPhaseDragChange={setPhaseDragPreview}
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
                      onTaskBarDragChange={setReparentTaskPreview}
                    />
                  )}
                </div>
              )
            })}

            {/* Phase-drag ghost overlay — when the user is moving a
                phase bar, every task and sub-phase inside it gets a
                translucent ghost copy at the live shifted position so
                the user knows exactly where the whole subtree will
                land before releasing. The dragged phase row itself is
                skipped because its own DetailBar already moves under
                the cursor. */}
            {phaseDragPreview && phaseDragAffectedIds && (
              <div
                className="absolute left-0 right-0 top-0 pointer-events-none"
                style={{ height: Math.max(80, rows.length * rowPx), zIndex: 8 }}
              >
                {rows.map((r, i) => {
                  if (r.kind === 'phase' && r.phase?.id === phaseDragPreview.phaseId) return null
                  let belongs = false
                  if (r.kind === 'phase' && r.phase && phaseDragAffectedIds.has(r.phase.id)) belongs = true
                  if (r.kind === 'task'  && r.phaseHint && phaseDragAffectedIds.has(r.phaseHint)) belongs = true
                  if (!belongs) return null
                  if (!r.start || !r.end) return null
                  const offsetDays = daysBetween(span.start, r.start) + phaseDragPreview.deltaDays
                  const lengthDays = Math.max(0.5, daysBetween(r.start, r.end))
                  const left  = dayToX(offsetDays)
                  const right = dayToX(offsetDays + lengthDays)
                  const width = Math.max(6, right - left)
                  const isPhase = r.kind === 'phase'
                  return (
                    <div
                      key={`pdg-${r.key}`}
                      className="absolute rounded-sm"
                      style={{
                        top:  i * rowPx + (isPhase ? 3 : 5),
                        height: isPhase ? rowPx - 6 : rowPx - 10,
                        left,
                        width,
                        backgroundColor: 'rgba(234, 88, 12, 0.18)',
                        border: `${isPhase ? 2 : 1}px dashed #fb923c`,
                      }}
                    />
                  )
                })}
              </div>
            )}

            {/* Task reparent ghost — when the user is dragging a task
                (via grip OR bar) and hovering over a different phase
                row, draw a task-shaped ghost in the target phase's
                drop-zone (or phase row if no drop-zone exists) at the
                task's current dates, so the user can see where it
                would slot in. */}
            {reparentTaskPreview && reparentHoverPhaseId &&
              reparentHoverPhaseId !== reparentTaskPreview.currentPhaseId &&
              (() => {
                const targetIdx = findGhostRowForPhase(reparentHoverPhaseId)
                if (targetIdx < 0) return null
                if (!reparentTaskPreview.start || !reparentTaskPreview.end) return null
                const offsetDays = daysBetween(span.start, reparentTaskPreview.start)
                const lengthDays = Math.max(0.5, daysBetween(reparentTaskPreview.start, reparentTaskPreview.end))
                const left  = dayToX(offsetDays)
                const right = dayToX(offsetDays + lengthDays)
                const width = Math.max(6, right - left)
                return (
                  <div
                    className="absolute rounded-sm pointer-events-none"
                    style={{
                      top: targetIdx * rowPx + 5,
                      height: rowPx - 10,
                      left,
                      width,
                      backgroundColor: 'rgba(234, 88, 12, 0.32)',
                      border: '1.5px dashed #fb923c',
                      zIndex: 9,
                    }}
                  />
                )
              })()}

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
                showing curved arrows + an animated light pulse.
                Drag previews are passed in so dep endpoints can
                follow the ghost of a moving task / phase. */}
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
              depRewire={depRewire}
              onUnlinkDependency={onUnlinkDependency}
              onBeginDepRewire={beginDependencyRewire}
              taskDragPreview={reparentTaskPreview}
              phaseDragPreview={phaseDragPreview}
              phaseDragAffectedIds={phaseDragAffectedIds}
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
  visibleDeps, rows, span, dayPx, rowPx, dayToX, chartW, chartH,
  depDrag, depRewire,
  onUnlinkDependency, onBeginDepRewire,
  taskDragPreview, phaseDragPreview, phaseDragAffectedIds,
}) {
  if (!dayToX) dayToX = (d) => d * dayPx
  const TASK_COLOR  = '#fb923c'
  const PHASE_COLOR = '#22d3ee'

  // Live drag delta (days) to apply to a row's endpoints so the
  // dependency line follows the ghost of a moving task / phase.
  // Returns 0 for rows not touched by an active drag.
  function rowDeltaDays(row) {
    if (!row) return 0
    if (taskDragPreview && row.kind === 'task' && row.task?.id === taskDragPreview.taskId) {
      return taskDragPreview.deltaDays || 0
    }
    if (phaseDragPreview && phaseDragAffectedIds) {
      if (row.kind === 'phase' && row.phase && phaseDragAffectedIds.has(row.phase.id)) {
        return phaseDragPreview.deltaDays || 0
      }
      if (row.kind === 'task' && row.phaseHint && phaseDragAffectedIds.has(row.phaseHint)) {
        return phaseDragPreview.deltaDays || 0
      }
    }
    return 0
  }

  const edges = []
  for (const { dep, kind, predIdx, succIdx } of visibleDeps) {
    const predRow = rows[predIdx]
    const succRow = rows[succIdx]
    if (!predRow?.start || !predRow?.end) continue
    if (!succRow?.start || !succRow?.end) continue
    const predDelta = rowDeltaDays(predRow)
    const succDelta = rowDeltaDays(succRow)
    const x1 = dayToX(daysBetween(span.start, predRow.end)   + predDelta)
    const y1 = predIdx * rowPx + rowPx / 2
    // If this dep is the one currently being rewired, make its
    // head follow the cursor instead of its original successor.
    const rewiring = depRewire && depRewire.depId === dep.id
    const x2 = rewiring
      ? depRewire.curX
      : dayToX(daysBetween(span.start, succRow.start) + succDelta)
    const y2 = rewiring
      ? depRewire.curY
      : succIdx * rowPx + rowPx / 2
    edges.push({
      id: dep.id, dep, kind,
      x1, y1, x2, y2,
      predId: kind === 'task' ? dep.predecessor_id : dep.predecessor_id,
      succId: kind === 'task' ? dep.successor_id   : dep.successor_id,
      rewiring: !!rewiring,
    })
  }

  // Curved arrow path — a cubic Bezier that leaves the predecessor
  // going right, sweeps through the vertical gap, and lands on the
  // successor going right again. The control-point offset scales
  // with both horizontal AND vertical distance so short/near
  // connections stay tight and long/distant ones flow gracefully.
  //
  // When the successor is LEFT of the predecessor (a backflow
  // dependency — rare but legal) we bow the curve OUT horizontally
  // so it doesn't crash through the bars: both control points get
  // pushed to the right of x1 by a generous margin, creating a
  // lazy loop.
  function buildPath(x1, y1, x2, y2) {
    const dx = x2 - x1
    const dy = y2 - y1
    if (dx >= 0) {
      // Forward flow: S-curve. Control-point horizontal offset is
      // half the horizontal gap, with a floor of 24px so even near-
      // coincident endpoints get a visible arc.
      const cxOffset = Math.max(24, Math.abs(dx) * 0.5)
      const cx1 = x1 + cxOffset
      const cx2 = x2 - cxOffset
      return `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`
    }
    // Backflow: bow the curve to the right of both endpoints.
    const loopOut = Math.max(40, Math.abs(dy) * 0.6 + 20)
    const cx1 = x1 + loopOut
    const cx2 = x2 + loopOut
    return `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`
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

            {/* Grab handle at the arrow head — draggable to rewire
                or disconnect. The visible target is the arrow head
                marker itself (a colored triangle); this circle is
                an invisible hit zone sitting on top so the user can
                grab the colored arrow tip without us drawing an
                extra ring around it. */}
            <circle
              cx={e.x2}
              cy={e.y2}
              r={7}
              fill="transparent"
              stroke="none"
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onMouseDown={(ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                onBeginDepRewire?.({
                  dep: e.dep,
                  kind: e.kind,
                  predId: e.predId,
                  origSuccId: e.succId,
                })
              }}
            >
              <title>Drag to rewire — drop on empty space to disconnect</title>
            </circle>

            {/* Animated pulse — skipped while this dep is being
                rewired so the flowing dot doesn't chase the cursor
                unpleasantly. */}
            {!e.rewiring && (
              <>
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
              </>
            )}
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
  critical, phaseStyle, subgroupStyle,
  assetRef,
  onUpdateTask, onUpdatePhase, onUpdateAsset, onMovePhaseAndChildren,
  onEditTask, onEditPhase, onEditAsset,
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
  // Drag-preview callbacks — fire { ... } during a live drag and
  // null on release. DetailPane reads these to render translucent
  // ghost overlays for child tasks (phase drag) or for the target
  // phase row (task reparent drag).
  onPhaseDragChange,
  onTaskBarDragChange,
}) {
  if (!dayToX) dayToX = (d) => d * dayPx
  // Live drag state — kept local so parent doesn't re-render
  // every mousemove during a drag.
  const [drag, setDrag] = useState(null) // null | {start, end, mode}
  const [hover, setHover] = useState(false)
  const [pendingExtend, setPendingExtend] = useState(null) // {patch, phaseId, newPhaseStart, newPhaseEnd}

  // The dependency-drag dot sits OUTSIDE the bar's bounding box
  // (right of the resize grab), so moving the mouse from the bar
  // toward the dot triggers onMouseLeave on the bar before the
  // cursor reaches the dot. To keep the dot reachable we delay
  // the hover-off by ~180ms, and the dot itself maintains hover
  // state while the cursor is over it.
  const hoverLeaveTimerRef = useRef(null)
  function scheduleHoverOff() {
    if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current)
    hoverLeaveTimerRef.current = setTimeout(() => {
      setHover(false)
      hoverLeaveTimerRef.current = null
    }, 180)
  }
  function cancelHoverOff() {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current)
      hoverLeaveTimerRef.current = null
    }
  }
  useEffect(() => () => {
    if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current)
  }, [])

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
  // Subgroups get a distinct cool-toned palette to separate them
  // visually from real phases.
  const tone = barTone({ ...row, start, end }, critical, phaseStyle, subgroupStyle)

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

    // Seed the in-row reparent ghost preview at drag start so the
    // moment the user crosses into another phase row, the ghost
    // is ready to render. Also seeded for non-reparent task drags
    // so the DependencyOverlay can follow the task's live offset
    // with dep lines even when reparenting isn't in play.
    const isTaskMoveDrag =
      !phaseStyle && row.task && mode === 'move' && typeof onTaskBarDragChange === 'function'
    if (isTaskMoveDrag) {
      onTaskBarDragChange({
        taskId: row.task.id,
        start:  origStart,
        end:    origEnd,
        currentPhaseId,
        deltaDays: 0,
      })
    }

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

      // Phase drag preview: only fires for phase bars in MOVE mode.
      // Carries the live deltaDays so DetailPane can render ghost
      // copies of every contained task / sub-phase at the shifted
      // offset.
      if (phaseStyle && row.phase && mode === 'move' && typeof onPhaseDragChange === 'function') {
        onPhaseDragChange({ phaseId: row.phase.id, deltaDays: ddays })
      }

      // Task drag preview: fires for task bars in MOVE mode. Carries
      // the live deltaDays so the DependencyOverlay can shift any
      // dep endpoints touching this task with the ghost. Reparent
      // info stays on the payload for the reparent ghost renderer.
      if (isTaskMoveDrag) {
        onTaskBarDragChange({
          taskId: row.task.id,
          start:  origStart,
          end:    origEnd,
          currentPhaseId,
          deltaDays: ddays,
        })
      }

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
      // Clear preview overlays regardless of which path commits
      // below — the drag is over.
      if (phaseStyle && row.phase && mode === 'move' && typeof onPhaseDragChange === 'function') {
        onPhaseDragChange(null)
      }
      if (isTaskMoveDrag) {
        onTaskBarDragChange(null)
      }
      if (!moved) {
        if (phaseStyle && assetRef) onEditAsset?.(assetRef)
        else if (phaseStyle && row.phase) onEditPhase?.(row.phase)
        else if (!phaseStyle && row.task) onEditTask?.(row.task)
        return
      }
      const patch = { start_date: toIsoDate(liveStart), end_date: toIsoDate(liveEnd) }

      // Asset bars: commit date updates via the asset adapter.
      if (phaseStyle && assetRef) {
        const assetPatch = { start_date: toIsoDate(liveStart), due_date: toIsoDate(liveEnd) }
        onUpdateAsset?.(assetRef.id, assetPatch)
        return
      }

      // Phase bars: just commit. No clamping — phases ARE the
      // container, so they can move freely.
      //
      // MOVE mode also drags every task inside the phase (and inside
      // its sub-phases) by the same delta, so each task keeps its
      // offset within the phase. RESIZE modes only change the phase
      // boundary — children stay put — so they keep using the plain
      // onUpdatePhase path.
      if (phaseStyle && row.phase) {
        if (mode === 'move' && typeof onMovePhaseAndChildren === 'function') {
          const deltaDays = daysBetween(origStart, liveStart)
          onMovePhaseAndChildren(row.phase.id, deltaDays, patch)
        } else {
          onUpdatePhase?.(row.phase.id, patch)
        }
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
      onMouseEnter={() => { cancelHoverOff(); setHover(true) }}
      onMouseLeave={scheduleHoverOff}
      data-row-bar={dataRowBar}
      className="absolute flex items-center px-2 rounded-sm cursor-grab active:cursor-grabbing"
      style={{
        left, width,
        top: subgroupStyle ? 4 : (phaseStyle ? 3 : 5),
        height: subgroupStyle ? rowPx - 8 : (phaseStyle ? rowPx - 6 : rowPx - 10),
        backgroundColor: tone.bg,
        border: `${subgroupStyle ? 1.5 : (phaseStyle ? 2 : 1)}px solid ${tone.border}`,
        boxShadow: subgroupStyle ? undefined : (phaseStyle ? '0 0 0 1px rgba(0,0,0,0.4)' : undefined),
        borderStyle: subgroupStyle ? 'dashed' : 'solid',
      }}
      title={`${label} · ${lengthDays.toFixed(1)}d · drag to move · drag edges to resize · click to edit · drag the right-edge dot to link a dependency`}
    >
      {/* Edge resize cursor hints */}
      <div className="absolute left-0 top-0 bottom-0" style={{ width: EDGE_GRAB_PX, cursor: 'ew-resize' }} />
      <div className="absolute right-0 top-0 bottom-0" style={{ width: EDGE_GRAB_PX, cursor: 'ew-resize' }} />
      {width > 32 && (
        <span
          className={`text-[10.5px] font-mono truncate pointer-events-none overflow-hidden ${
            subgroupStyle ? 'font-semibold' : (phaseStyle ? 'font-bold uppercase tracking-wider' : '')
          }`}
          style={{ color: tone.fg }}
        >
          {label}
        </span>
      )}
      {/* Dependency-drag handle — sits OUTSIDE the bar, just past
          its right edge, so it no longer overlaps the 6px resize
          grab zone at the bar's right edge. Color matches the kind
          of dependency it will create: orange for task→task, cyan
          for phase→phase. */}
      {hover && (
        <div
          onMouseDown={onDepHandleDown}
          onMouseEnter={() => { cancelHoverOff(); setHover(true) }}
          onMouseLeave={scheduleHoverOff}
          className="absolute rounded-full"
          style={{
            right: -22,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 14,
            height: 14,
            backgroundColor: phaseStyle ? '#22d3ee' : '#fb923c',
            border: '2px solid #1c1917',
            cursor: 'crosshair',
            zIndex: 6,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
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
          <span className="text-[10.5px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fed7aa' }}>
            Task outside phase window
          </span>
        </div>
        <div className="px-4 py-4 flex flex-col gap-3 text-[11.5px] font-mono" style={{ color: '#d6d3d1' }}>
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
            className="px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"
            style={{ color: '#a8a29e', backgroundColor: 'transparent', border: '1px solid #44403c' }}
          >
            Clamp task
          </button>
          <button
            type="button"
            onClick={onExtendPhase}
            className="px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"
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

  // Pull toggleable databases from ctx
  const project = ctx?.project
  const scenes = ctx?.scenes || []
  const shots = ctx?.shots || []
  const levels = ctx?.levels || []
  const experiences = ctx?.experiences || []

  // Team members for the "Assigned To" dropdown
  const tm = useTeamMembers()
  const teamAssignments = ctx?.teamAssignments || []
  const memberById = useMemo(() => {
    const map = {}
    for (const m of tm.members) map[m.id] = m
    return map
  }, [tm.members])
  const projectMembers = useMemo(() => {
    return teamAssignments
      .map(a => memberById[a.member_id])
      .filter(Boolean)
  }, [teamAssignments, memberById])

  const isTask = editor.mode === 'task'
  const isMilestone = editor.mode === 'milestone'
  const isAsset = editor.mode === 'asset'
  const isEditingExisting = isMilestone ? !!editor.milestoneId : isAsset ? !!editor.assetId : (isTask ? !!editor.taskId : !!editor.phaseId)

  function patch(field, value) {
    setDraft(d => ({ ...d, [field]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      if (editor.mode === 'milestone') {
        if (!draft.title?.trim()) throw new Error('Milestone title is required.')
        if (!draft.date) throw new Error('Milestone date is required.')
        const payload = {
          title:       draft.title.trim(),
          date:        draft.date,
          color:       draft.color || '#f59e0b',
          description: draft.description?.trim() || '',
          phase_id:    draft.phase_id || null,
        }
        if (editor.milestoneId) {
          await ctx.updateMilestone(editor.milestoneId, payload)
        } else {
          await ctx.addMilestone(payload)
        }
      } else if (editor.mode === 'asset') {
        if (!draft.name?.trim()) throw new Error('Asset name is required.')
        const payload = {
          name:        draft.name.trim(),
          description: draft.description?.trim() || '',
          phase_id:    draft.phase_id || null,
          start_date:  draft.start_date || null,
          due_date:    draft.due_date || null,
          status:      draft.status || 'not_started',
          type:        draft.type?.trim() || null,
        }
        if (editor.assetId) {
          await ctx.updateAsset(editor.assetId, payload)
        }
      } else if (editor.mode === 'phase') {
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
          status:          draft.status || 'not_started',
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
          assignee_id:        draft.assignee_id || null,
          priority:           draft.priority || 'medium',
          status:             draft.status || 'waiting_to_start',
          scene_id:           draft.scene_id || null,
          shot_id:            draft.shot_id || null,
          level_id:           draft.level_id || null,
          experience_id:      draft.experience_id || null,
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
      if (editor.mode === 'milestone' && editor.milestoneId) {
        if (!confirm('Delete this milestone?')) {
          setSaving(false)
          return
        }
        await ctx.deleteMilestone(editor.milestoneId)
      } else if (editor.mode === 'asset' && editor.assetId) {
        if (!confirm('Delete this asset? Tasks linked to it will lose their asset reference.')) {
          setSaving(false)
          return
        }
        await ctx.deleteAsset(editor.assetId)
      } else if (editor.mode === 'phase' && editor.phaseId) {
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
          {isMilestone
            ? <Diamond className="w-3.5 h-3.5" style={{ color: '#f59e0b' }} />
            : isAsset
              ? <Boxes className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
              : <CalendarDays className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
          }
          <span className="text-[10.5px] font-mono uppercase tracking-widest font-bold" style={{ color: isMilestone ? '#f59e0b' : '#fb923c' }}>
            {isMilestone
              ? (isEditingExisting ? 'Edit key date' : 'New key date')
              : isAsset
                ? 'Edit asset'
                : editor.mode === 'phase'
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
          {isMilestone ? (
            <>
              <Field label="Title">
                <input
                  type="text"
                  autoFocus
                  value={draft.title}
                  onChange={(e) => patch('title', e.target.value)}
                  placeholder="e.g. Alpha Delivery"
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  style={{ backgroundColor: '#1c1917', color: '#f59e0b', border: '1px solid #44403c' }}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Date (required)">
                  <input
                    type="date"
                    value={draft.date}
                    onChange={(e) => patch('date', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    style={{ backgroundColor: '#1c1917', color: '#f59e0b', border: '1px solid #44403c' }}
                  />
                </Field>
                <Field label="Color">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={draft.color || '#f59e0b'}
                      onChange={(e) => patch('color', e.target.value)}
                      className="w-8 h-8 rounded-sm border-0 cursor-pointer"
                      style={{ backgroundColor: '#1c1917' }}
                    />
                    <span className="text-[10.5px] font-mono" style={{ color: '#78716c' }}>{draft.color || '#f59e0b'}</span>
                  </div>
                </Field>
              </div>
              <Field label="Phase (optional)">
                <select
                  value={draft.phase_id || ''}
                  onChange={(e) => patch('phase_id', e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  style={{ backgroundColor: '#1c1917', color: '#f59e0b', border: '1px solid #44403c' }}
                >
                  <option value="">(no phase — project-level)</option>
                  {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Description (optional)">
                <input
                  type="text"
                  value={draft.description}
                  onChange={(e) => patch('description', e.target.value)}
                  placeholder="What does this milestone mark?"
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  style={{ backgroundColor: '#1c1917', color: '#a8a29e', border: '1px solid #44403c' }}
                />
              </Field>
            </>
          ) : isAsset ? (
            <>
              <Field label="Asset name">
                <input
                  type="text"
                  autoFocus
                  value={draft.name}
                  onChange={(e) => patch('name', e.target.value)}
                  placeholder="e.g. Hero Character Model"
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                />
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
                <Field label="Due date">
                  <input
                    type="date"
                    value={draft.due_date || ''}
                    onChange={(e) => patch('due_date', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Status">
                  <select
                    value={draft.status || 'not_started'}
                    onChange={(e) => patch('status', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  >
                    <option value="not_started" style={{ color: '#a8a29e' }}>Not started</option>
                    <option value="in_progress" style={{ color: '#fb923c' }}>In progress</option>
                    <option value="pending_review" style={{ color: '#fbbf24' }}>Pending review</option>
                    <option value="needs_revisions" style={{ color: '#e879f9' }}>Needs revisions</option>
                    <option value="approved" style={{ color: '#4ade80' }}>Approved</option>
                    <option value="final" style={{ color: '#22c55e' }}>Final</option>
                    <option value="blocked" style={{ color: '#ef4444' }}>Blocked</option>
                    <option value="on_hold" style={{ color: '#fcd34d' }}>On hold</option>
                    <option value="omitted" style={{ color: '#57534e' }}>Omitted</option>
                  </select>
                </Field>
                <Field label="Type">
                  <input
                    type="text"
                    value={draft.type || ''}
                    onChange={(e) => patch('type', e.target.value)}
                    placeholder="e.g. 3D Model, Texture"
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  />
                </Field>
              </div>
              <Field label="Phase (optional)">
                <select
                  value={draft.phase_id || ''}
                  onChange={(e) => patch('phase_id', e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                >
                  <option value="">(no phase)</option>
                  {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Description">
                <input
                  type="text"
                  value={draft.description || ''}
                  onChange={(e) => patch('description', e.target.value)}
                  placeholder="Asset description"
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#a8a29e', border: '1px solid #44403c' }}
                />
              </Field>
            </>
          ) : editor.mode === 'phase' ? (
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
                className="text-[10.5px] font-mono"
                style={{ color: '#78716c' }}
              >
                Phases always have a start and end date — the bar you see
                on the timeline is drawn from these.
              </div>
              <Field label="Status">
                <select
                  value={draft.status || 'not_started'}
                  onChange={(e) => patch('status', e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                >
                  <option value="not_started" style={{ color: '#a8a29e' }}>Not started</option>
                  <option value="active" style={{ color: '#fb923c' }}>Active</option>
                  <option value="completed" style={{ color: '#4ade80' }}>Completed</option>
                  <option value="delayed" style={{ color: '#ef4444' }}>Delayed</option>
                </select>
              </Field>
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
              {/* ── Conditional relation fields ── */}
              {project?.scenes_enabled && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Scene">
                    <select
                      value={draft.scene_id || ''}
                      onChange={(e) => { patch('scene_id', e.target.value); patch('shot_id', '') }}
                      className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                    >
                      <option value="">(no scene)</option>
                      {scenes.map(s => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
                    </select>
                  </Field>
                  <Field label="Shot">
                    <select
                      value={draft.shot_id || ''}
                      onChange={(e) => patch('shot_id', e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                    >
                      <option value="">(no shot)</option>
                      {(draft.scene_id ? shots.filter(s => s.scene_id === draft.scene_id) : shots)
                        .map(s => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
                    </select>
                  </Field>
                </div>
              )}
              {project?.levels_enabled && (
                <Field label="Level">
                  <select
                    value={draft.level_id || ''}
                    onChange={(e) => patch('level_id', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  >
                    <option value="">(no level)</option>
                    {levels.map(l => <option key={l.id} value={l.id}>{l.name || 'Untitled'}</option>)}
                  </select>
                </Field>
              )}
              {project?.experiences_enabled && (
                <Field label="Experience">
                  <select
                    value={draft.experience_id || ''}
                    onChange={(e) => patch('experience_id', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  >
                    <option value="">(no experience)</option>
                    {experiences.map(ex => <option key={ex.id} value={ex.id}>{ex.name || 'Untitled'}</option>)}
                  </select>
                </Field>
              )}
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
                <Field label="Assigned To">
                  <select
                    value={draft.assignee_id || ''}
                    onChange={(e) => patch('assignee_id', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  >
                    <option value="">-- unassigned --</option>
                    {projectMembers.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
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
                    <option value="low" style={{ color: '#a8a29e' }}>Low</option>
                    <option value="medium" style={{ color: '#fbbf24' }}>Medium</option>
                    <option value="high" style={{ color: '#fb923c' }}>High</option>
                    <option value="crit" style={{ color: '#ef4444' }}>Critical</option>
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    value={draft.status}
                    onChange={(e) => patch('status', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  >
                    <option value="waiting_to_start" style={{ color: '#a8a29e' }}>Waiting to start</option>
                    <option value="in_progress" style={{ color: '#fb923c' }}>In progress</option>
                    <option value="pending_review" style={{ color: '#fbbf24' }}>Pending review</option>
                    <option value="needs_revisions" style={{ color: '#e879f9' }}>Needs revisions</option>
                    <option value="approved" style={{ color: '#4ade80' }}>Approved</option>
                    <option value="final" style={{ color: '#22c55e' }}>Final</option>
                    <option value="blocked" style={{ color: '#ef4444' }}>Blocked</option>
                    <option value="on_hold" style={{ color: '#fcd34d' }}>On hold</option>
                    <option value="omitted" style={{ color: '#57534e' }}>Omitted</option>
                  </select>
                </Field>
              </div>

              {/* Asset files section — only shown for tasks with an asset */}
              {draft.asset_id && (() => {
                const parentAsset = assets.find(a => a.id === draft.asset_id)
                if (!parentAsset) return null
                return (
                  <div className="mt-3 pt-3" style={{ borderTop: '1px solid #44403c' }}>
                    <div className="text-[9.5px] font-mono uppercase tracking-wider mb-1" style={{ color: '#78716c' }}>
                      Asset: {parentAsset.name || 'Untitled'}
                    </div>
                    <FileManager
                      files={ctx?.managedFiles || []}
                      assetId={parentAsset.id}
                      assetName={parentAsset.name}
                      projectId={ctx?.activeProjectId}
                      project={ctx?.project}
                      mode="readonly"
                      taskTitle={draft.title || null}
                      taskId={editor.taskId || null}
                      onFileAdded={() => ctx?.refreshManagedFiles?.()}
                    />
                  </div>
                )
              })()}
            </>
          )}

          {error && (
            <div
              className="text-[11.5px] font-mono p-2 rounded-sm"
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
              className="flex items-center gap-1 px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
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
              className="px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
              style={{ color: '#a8a29e', backgroundColor: 'transparent', border: '1px solid #44403c' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
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

function emptyMilestoneDraft({ date, phase_id } = {}) {
  return {
    title:       '',
    date:        date ?? toDateInputValue(new Date()),
    color:       '#f59e0b',
    description: '',
    phase_id:    phase_id || '',
  }
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10.5px] font-mono uppercase tracking-widest mb-1" style={{ color: '#a8a29e' }}>
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
    bid_days:    '',
    role:        '',
    assignee_id: '',
    priority:    'medium',
    status:      'waiting_to_start',
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
    status:          'not_started',
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
function DetailZoomToolbar({
  zoomId, onChange, onCenterToday,
  sortOrder = 'asc', onSortOrderChange,
  canUndo = false, canRedo = false, onUndo, onRedo,
  onNewPhase, onNewTask, onNewMilestone,
  groupBy, onGroupByChange, project,
}) {
  return (
    <div
      className="flex items-center gap-2 px-6 py-2 flex-shrink-0"
      style={{ borderBottom: '1px solid #292524', backgroundColor: '#1c1917' }}
    >
      {/* Undo / redo */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="p-1.5 rounded-sm transition-colors hover:bg-stone-800"
          style={{
            color: canUndo ? '#d6d3d1' : '#44403c',
            cursor: canUndo ? 'pointer' : 'not-allowed',
          }}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="p-1.5 rounded-sm transition-colors hover:bg-stone-800"
          style={{
            color: canRedo ? '#d6d3d1' : '#44403c',
            cursor: canRedo ? 'pointer' : 'not-allowed',
          }}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

      <div className="flex items-center gap-1">
        {ZOOM_LEVELS.map(z => (
          <button
            key={z.id}
            type="button"
            onClick={() => onChange(z.id)}
            className="px-2.5 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"
            style={{
              color: zoomId === z.id ? '#fff7ed' : '#78716c',
              backgroundColor: zoomId === z.id ? '#ea580c' : 'transparent',
            }}
            title={`Switch the detail gantt to ${z.label} zoom`}
          >
            {z.label}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

      <button
        type="button"
        onClick={onCenterToday}
        className="flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-stone-800 transition-colors"
        style={{ color: '#78716c' }}
        title="Center the detail timeline on today"
      >
        <Crosshair className="w-3 h-3" />
        <span className="text-[10.5px] font-mono uppercase tracking-wider">Today</span>
      </button>

      <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

      {/* Group-by selector */}
      {onGroupByChange && (
        <div className="flex items-center gap-0.5">
          {[
            { id: 'phase',      icon: Layers,   title: 'Group by phase' },
            { id: 'team',       icon: Users,    title: 'Group by team member' },
            { id: 'asset',      icon: Boxes,    title: 'Group by asset' },
            ...(project?.scenes_enabled ? [{ id: 'scene', icon: Film, title: 'Group by scene' }] : []),
            ...(project?.levels_enabled ? [{ id: 'level', icon: Gamepad2, title: 'Group by level' }] : []),
            ...(project?.experiences_enabled ? [{ id: 'experience', icon: Sparkles, title: 'Group by experience' }] : []),
          ].map((g) => {
            const Icon = g.icon
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onGroupByChange(g.id)}
                className="p-1.5 rounded-sm transition-colors hover:bg-stone-800"
                style={{
                  color: groupBy === g.id ? '#fb923c' : '#57534e',
                }}
                title={g.title}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            )
          })}
        </div>
      )}

      <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

      {/* Sort */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => onSortOrderChange?.('asc')}
          className="px-2 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-800"
          style={{
            color: sortOrder === 'asc' ? '#fb923c' : '#57534e',
          }}
          title="Sort phases and tasks by start date, earliest first"
        >
          ↑ Date
        </button>
        <button
          type="button"
          onClick={() => onSortOrderChange?.('desc')}
          className="px-2 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-800"
          style={{
            color: sortOrder === 'desc' ? '#fb923c' : '#57534e',
          }}
          title="Sort phases and tasks by start date, latest first"
        >
          ↓ Date
        </button>
      </div>

      {/* + Phase / + Task */}
      <div className="ml-auto flex items-center gap-1.5">
        {groupBy === 'phase' && (
        <button
          type="button"
          onClick={onNewPhase}
          className="flex items-center gap-1 px-2.5 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-800"
          style={{ color: '#78716c' }}
        >
          <Plus className="w-3 h-3" />
          Phase
        </button>
        )}
        <button
          type="button"
          onClick={onNewMilestone}
          className="flex items-center gap-1 px-2.5 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-800"
          style={{ color: '#f59e0b' }}
        >
          <Diamond className="w-3 h-3" />
          Key Date
        </button>
        <button
          type="button"
          onClick={onNewTask}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"
          style={{ color: '#fff7ed', backgroundColor: '#ea580c' }}
        >
          <Plus className="w-3 h-3" />
          Task
        </button>
      </div>
    </div>
  )
}

// ============================================================
// HolidaysEditor — inline editor inside SettingsPanel for
// managing blocked / holiday dates. Supports:
//   • Adding individual dates via a date input
//   • Importing a CSV (one YYYY-MM-DD per line)
//   • Exporting the current list as CSV
//   • Removing individual dates
// ============================================================
function HolidaysEditor({ holidays, onChange }) {
  // holidays is a Map<date, title>
  const [newDate, setNewDate] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const fileRef = useRef(null)
  const sorted = useMemo(() => {
    if (!holidays || !(holidays instanceof Map)) return []
    return [...holidays.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [holidays])

  function addDate(iso, title) {
    if (!iso || !holidays) return
    const next = new Map(holidays)
    next.set(iso, title || '')
    onChange(next)
  }
  function removeDate(iso) {
    if (!holidays) return
    const next = new Map(holidays)
    next.delete(iso)
    onChange(next)
  }
  function handleImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const entries = parseHolidayCSV(ev.target.result)
      if (entries.length === 0) return
      const next = new Map(holidays)
      for (const { date, title } of entries) next.set(date, title)
      onChange(next)
    }
    reader.readAsText(file)
    e.target.value = ''
  }
  function handleExport() {
    const csv = exportHolidayCSV(holidays)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'rabbit-holidays.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-stone-900 border-2 border-stone-600 rounded-sm p-4 mb-4">
      <label className="block text-sm font-bold mb-1 text-orange-400">
        Holidays / Blocked Days
      </label>
      <p className="text-[10.5px] text-stone-500 mb-3">
        Dates listed here are excluded from the working-day count.
        Import a CSV (YYYY-MM-DD,Title per line) or add individual dates.
      </p>

      {/* Add individual date + title */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          className="px-2 py-1 bg-stone-950 border border-stone-600 rounded-sm text-[11.5px] font-mono text-stone-300 focus:outline-none focus:border-orange-500"
        />
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Holiday name"
          className="px-2 py-1 bg-stone-950 border border-stone-600 rounded-sm text-[11.5px] font-mono text-stone-300 focus:outline-none focus:border-orange-500 flex-1 min-w-0"
        />
        <button
          type="button"
          onClick={() => { if (newDate) { addDate(newDate, newTitle); setNewDate(''); setNewTitle('') } }}
          className="flex items-center gap-1 px-2 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm flex-shrink-0"
          style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      </div>

      {/* Import / Export */}
      <div className="flex items-center gap-2 mb-3">
        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleImport} className="hidden" />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm"
          style={{ color: '#a8a29e', backgroundColor: '#1c1917', border: '1px solid #44403c' }}
        >
          <Upload className="w-3 h-3" />
          Import CSV
        </button>
        <button
          type="button"
          onClick={handleExport}
          className="flex items-center gap-1 px-2 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm"
          style={{ color: '#a8a29e', backgroundColor: '#1c1917', border: '1px solid #44403c' }}
        >
          <Download className="w-3 h-3" />
          Export CSV
        </button>
        <span className="text-[10.5px] font-mono text-stone-500 ml-auto">
          {sorted.length} date{sorted.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Date list */}
      <div
        className="overflow-y-auto border border-stone-700 rounded-sm"
        style={{ maxHeight: 200, backgroundColor: '#0c0a09' }}
      >
        {sorted.length === 0 ? (
          <div className="px-3 py-4 text-[10.5px] text-stone-600 text-center font-mono">
            No holidays configured
          </div>
        ) : (
          sorted.map(([iso, title]) => (
            <div
              key={iso}
              className="flex items-center gap-2 px-3 py-1 border-b border-stone-800 last:border-b-0 hover:bg-stone-900"
            >
              <span className="text-[11.5px] font-mono text-stone-400 flex-shrink-0" style={{ width: 90 }}>
                {iso}
              </span>
              <span className="text-[11.5px] font-mono text-stone-300 truncate flex-1 min-w-0">
                {title || ''}
              </span>
              <button
                type="button"
                onClick={() => removeDate(iso)}
                className="p-0.5 hover:bg-stone-700 rounded-sm transition-colors flex-shrink-0"
                title="Remove this date"
              >
                <X className="w-3 h-3 text-stone-500 hover:text-red-400" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ============================================================
// SettingsPanel — slide-out from the right with two tabs:
// Settings + System Prompts (matches DOG/OTTER pattern).
// ============================================================
export function SettingsPanel({ settings, patchSettings, settingsTab, setSettingsTab, holidays, onHolidaysChange, onClose, onOpenHelp }) {
  const [promptsLocked, setPromptsLocked] = useState(true)
  const [toolsLocked, setToolsLocked]     = useState(true)
  const [showTemplateManager, setShowTemplateManager] = useState(false)
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
            <span className={`text-[10.5px] uppercase tracking-wide ${isLocked ? 'text-stone-500' : 'text-stone-400'}`}>
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
                    <p className="text-[10.5px] text-stone-500 mt-1">
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
                <p className="text-[10.5px] text-stone-500">
                  RABBIT is WILSON's resource allocation tool. Settings are scoped to the
                  current browser profile and persist via localStorage.
                </p>
              </div>

              {/* ── Task Templates ── */}
              <div className="bg-stone-900 border-2 border-stone-600 rounded-sm p-4 mb-4">
                <label className="block text-sm font-bold mb-2 text-orange-400">Task Templates</label>
                <p className="text-[10.5px] text-stone-500 mb-3">
                  Create and manage reusable task templates that can be applied when creating new assets.
                </p>
                <button
                  type="button"
                  onClick={() => setShowTemplateManager(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
                  style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  Manage Task Templates
                </button>
              </div>

              {/* ── Project Type Defaults ── */}
              <div className="bg-stone-900 border-2 border-stone-600 rounded-sm p-4 mb-4">
                <label className="block text-sm font-bold mb-2 text-orange-400">Project Type Defaults</label>
                <p className="text-[10.5px] text-stone-500 mb-3">
                  When creating a new project, these databases will be toggled on by default based on the project type.
                  You can override these per-project in the Project Control Panel.
                </p>
                <div className="rounded-sm overflow-hidden" style={{ border: '1px solid #44403c' }}>
                  {/* Header row */}
                  <div className="flex items-center px-3 py-2" style={{ backgroundColor: '#1c1917', borderBottom: '1px solid #44403c' }}>
                    <span className="flex-1 text-[10.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#78716c' }}>Type</span>
                    <span className="w-16 text-[10.5px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Scenes</span>
                    <span className="w-16 text-[10.5px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Levels</span>
                    <span className="w-16 text-[10.5px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Exp.</span>
                  </div>
                  {/* Rows — one per project type */}
                  {PROJECT_TYPE_LIST.map(type => {
                    const tpl = settings.projectTypeTemplates?.[type] || DEFAULT_PROJECT_TYPE_TEMPLATES[type] || {}
                    return (
                      <div key={type} className="flex items-center px-3 py-1.5 hover:bg-stone-800/40 transition-colors"
                        style={{ borderBottom: '1px solid #292524' }}>
                        <span className="flex-1 text-[11.5px] font-mono capitalize" style={{ color: '#d6d3d1' }}>
                          {type.replace(/_/g, ' ')}
                        </span>
                        {['scenes_enabled', 'levels_enabled', 'experiences_enabled'].map(field => (
                          <span key={field} className="w-16 flex justify-center">
                            <button
                              type="button"
                              onClick={() => {
                                const templates = { ...(settings.projectTypeTemplates || DEFAULT_PROJECT_TYPE_TEMPLATES) }
                                templates[type] = { ...(templates[type] || {}), [field]: !tpl[field] }
                                patchSettings({ projectTypeTemplates: templates })
                              }}
                              className="w-4 h-4 rounded-sm flex items-center justify-center transition-colors"
                              style={{
                                backgroundColor: tpl[field] ? '#ea580c' : 'transparent',
                                border: `1px solid ${tpl[field] ? '#ea580c' : '#57534e'}`,
                              }}
                            >
                              {tpl[field] && <Check className="w-2.5 h-2.5 text-white" />}
                            </button>
                          </span>
                        ))}
                      </div>
                    )
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => patchSettings({ projectTypeTemplates: { ...DEFAULT_PROJECT_TYPE_TEMPLATES } })}
                  className="text-[10.5px] text-orange-400 hover:text-orange-300 transition-colors mt-2"
                >
                  Reset to defaults
                </button>
              </div>

              {/* ── Holidays / blocked days ── */}
              <HolidaysEditor
                holidays={holidays}
                onChange={onHolidaysChange}
              />
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
                      <p className="text-[10.5px] text-stone-500">{s.desc}</p>
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
                          className={`text-[10.5px] ${promptsLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}
                        >
                          Reset to default
                        </button>
                        <button
                          onClick={savePrompts}
                          disabled={promptsLocked}
                          className={`text-[10.5px] ${promptsLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}
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
          <p className="text-[10.5px] text-stone-500 flex-1">
            Changes are applied immediately. Use &quot;Reset to default&quot; to restore
            original settings.
          </p>
          {onOpenHelp && (
            <button
              type="button"
              onClick={onOpenHelp}
              title="Open RABBIT help & documentation"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[10.5px] font-bold uppercase tracking-wide transition-colors text-orange-400 border border-orange-500/40 bg-stone-900 hover:bg-stone-700 hover:text-orange-300 flex-shrink-0"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              Help
            </button>
          )}
        </div>
      </div>

      {/* ── Task Template Manager popup ── */}
      {showTemplateManager && (
        <TaskTemplateManager onClose={() => setShowTemplateManager(false)} />
      )}
    </div>
  )
}

// ============================================================
// HelpModal — 850×82vh modal with sidebar + content (DOG/OTTER pattern)
// Exported so Rabbit.jsx can render it outside TimelineView.
// ============================================================
export function HelpModal({ helpPage, setHelpPage, onClose }) {
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
                  className={`w-full text-left px-3 py-1.5 text-[11.5px] transition-colors ${
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
            className="px-2 py-0.5 text-[10.5px] font-mono uppercase tracking-wider"
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

function SummaryBand({
  summary,
  minimapZoomDays, minimapMinDays, minimapMaxDays, minimapSnapDays,
  onMinimapZoomChange, onMinimapFitProject, onMinimapCenterToday,
}) {
  // Snap-tolerant slider input: if the user lands within the
  // snap tolerance of a configured snap point, pull the value
  // hard to that point so 1y/2y/5y feel magnetic. Tolerance is a
  // generous % of the full range so the snap zone is visible at
  // typical slider widths (~14 px on a 260 px slider).
  const SNAP_TOLERANCE_FRAC = 0.045
  const snapTolerance = Math.max(20, Math.round((minimapMaxDays - minimapMinDays) * SNAP_TOLERANCE_FRAC))
  function handleSliderInput(e) {
    const raw = Number(e.target.value)
    if (!Number.isFinite(raw)) return
    let snapped = raw
    let bestDist = Infinity
    for (const s of minimapSnapDays || []) {
      const d = Math.abs(raw - s)
      if (d <= snapTolerance && d < bestDist) {
        bestDist = d
        snapped = s
      }
    }
    onMinimapZoomChange?.(snapped)
  }

  // Friendly label for the current zoom level.
  let zoomLabel = ''
  if (minimapZoomDays != null) {
    if (minimapZoomDays <= 200)       zoomLabel = `${Math.round(minimapZoomDays / 30)} mo`
    else if (minimapZoomDays <= 800)  zoomLabel = `${(minimapZoomDays / 365).toFixed(1)} yr`
    else                               zoomLabel = `${Math.round(minimapZoomDays / 365)} yr`
  }

  return (
    <div
      className="flex items-center gap-2 px-6 py-2 flex-shrink-0"
      style={{ borderBottom: '1px solid #292524', backgroundColor: '#1c1917' }}
    >
      {/* Title */}
      <CalendarDays className="w-4 h-4 flex-shrink-0" style={{ color: '#57534e' }} />
      <span className="text-[11.5px] font-mono uppercase tracking-widest font-medium flex-shrink-0" style={{ color: '#78716c' }}>
        Timeline
      </span>

      <div className="flex items-center gap-2 flex-wrap min-w-0 ml-4">
        <SummaryTile icon={Layers}        label="Phases"        value={summary.phases} />
        <SummaryTile icon={Boxes}         label="Assets"        value={summary.assets} />
        <SummaryTile icon={ListChecks}    label="Tasks"         value={summary.tasks} />
        <SummaryTile icon={GitBranch}     label="Critical"      value={summary.critical} />
        <SummaryTile icon={AlertTriangle} label="Blocked"       value={summary.blocked} tone={summary.blocked > 0 ? 'danger' : undefined} />
        <SummaryTile icon={CalendarDays}  label="Span"          value={`${summary.spanDays} d`} />
        <SummaryTile icon={Briefcase}     label="Working"       value={`${summary.workingDays} d`} />
        <SummaryTile icon={CalendarDays}  label="Critical days" value={`${summary.criticalDays.toFixed(1)} d`} />
      </div>

      {/* Minimap controls — right-aligned. Fit + Today buttons sit
          on the LEFT of the slider so the mouse travels the same
          distance from the summary tiles to reach them. Slider is
          ~half the previous width (120px) with snap tick marks
          rendered above the track at 1y/2y/5y. */}
      {onMinimapZoomChange && (
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onMinimapFitProject}
            title="Fit minimap to project start/end"
            className="flex items-center gap-1 px-2 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"
            style={{ color: '#a8a29e', backgroundColor: '#292524', border: '1px solid #44403c' }}
          >
            <Maximize2 className="w-3 h-3" />
            Fit
          </button>
          <button
            type="button"
            onClick={onMinimapCenterToday}
            title="Center minimap on today"
            className="flex items-center gap-1 px-2 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"
            style={{ color: '#a8a29e', backgroundColor: '#292524', border: '1px solid #44403c' }}
          >
            <Crosshair className="w-3 h-3" />
            Today
          </button>
          <span className="text-[9.5px] font-mono uppercase tracking-wider ml-1" style={{ color: '#78716c' }}>
            Zoom
          </span>
          <span className="text-[10.5px] font-mono" style={{ color: '#78716c' }}>6mo</span>
          <div className="relative" style={{ width: 195, height: 22 }}>
            <input
              type="range"
              min={minimapMinDays}
              max={minimapMaxDays}
              step={1}
              value={minimapZoomDays ?? minimapMinDays}
              onInput={handleSliderInput}
              onChange={handleSliderInput}
              className="absolute inset-x-0 inset-y-0 w-full h-full"
              style={{ accentColor: '#fb923c' }}
              title={`Minimap span: ${zoomLabel}`}
            />
            {/* Snap stop lines — short vertical marks contained
                inside the slider track. Drawn on top of the input
                with pointer-events:none so the slider stays fully
                interactive. The thumb visibly "absorbs" each line
                when the value lands on a snap point. Padding on
                the sides matches the typical thumb half-width so
                the lines align with the track, not the container
                edges. */}
            {/* Snap stop lines — thin orange vertical lines
                fully contained within the track height. No fill,
                no glow — just a 1px orange stroke. */}
            <div
              className="absolute pointer-events-none"
              style={{
                left: 8,
                right: 8,
                top: '50%',
                height: 8,
                transform: 'translateY(-50%)',
              }}
            >
              {(minimapSnapDays || []).map(s => {
                const range = Math.max(1, minimapMaxDays - minimapMinDays)
                const pct = ((s - minimapMinDays) / range) * 100
                return (
                  <div
                    key={`line-${s}`}
                    className="absolute"
                    style={{
                      left: `${pct}%`,
                      top: 0,
                      bottom: 0,
                      width: 1,
                      transform: 'translateX(-50%)',
                      backgroundColor: '#fb923c',
                      opacity: 0.7,
                    }}
                  />
                )
              })}
            </div>
          </div>
          <span className="text-[10.5px] font-mono" style={{ color: '#78716c' }}>5yr</span>
          <span
            className="text-[11.5px] font-mono tabular-nums"
            style={{ color: '#fb923c', minWidth: 48, textAlign: 'right' }}
          >
            {zoomLabel}
          </span>
        </div>
      )}
    </div>
  )
}

function SummaryTile({ icon: Icon, label, value, tone }) {
  const colors = tone === 'danger'
    ? { value: '#fca5a5', icon: '#ef4444', label: '#fca5a5' }
    : { value: '#fb923c', icon: '#57534e', label: '#d6d3d1' }
  return (
    <div className="flex items-center gap-1.5 px-1.5 py-1">
      <Icon className="w-3 h-3" style={{ color: colors.icon }} />
      <span className="text-[11.5px] font-mono font-medium" style={{ color: colors.value }}>{value}</span>
      <span className="text-[11.5px] font-mono uppercase tracking-wider" style={{ color: colors.label }}>{label}</span>
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
//   row           — { start, end, task?, phase?, assetRef? }
//   critical      — true if this task is on the critical path
//   phaseStyle    — true for phase bars (phases + subgroups)
//   subgroupStyle — true for subgroup bars (assets, team, scenes, etc.)
//
// Color mapping aligns with statusColor() in ProjectTasksView so the
// timeline and task table speak the same visual language.
function barTone(row, critical, phaseStyle, subgroupStyle) {
  // ── Subgroup bars (assets, team members, scenes, etc.) ────────
  // Status-driven when an explicit status is available (assets carry
  // status via assetRef). Falls back to date-based lifecycle for
  // subgroups without an explicit status field.
  if (subgroupStyle) {
    const status = row?.assetRef?.status || row?.phase?.status || null
    if (status) {
      if (status === 'in_progress')  return { bg: '#451a03', border: '#fb923c', fg: '#fff7ed' }
      if (status === 'completed')    return { bg: '#052e16', border: '#22c55e', fg: '#dcfce7' }
      if (status === 'on_hold')      return { bg: '#1c1917', border: '#d97706', fg: '#fcd34d' }
      // not_started or unrecognized
      return { bg: '#1c1917', border: '#78716c', fg: '#d6d3d1' }
    }
    // No explicit status — fall back to date-based lifecycle
    const state = lifecycleState(row?.start, row?.end)
    if (state === 'completed') return { bg: '#292524', border: '#57534e', fg: '#78716c' }
    if (state === 'upcoming')  return { bg: '#1c1917', border: '#78716c', fg: '#a8a29e' }
    return { bg: '#451a03', border: '#f59e0b', fg: '#fef3c7' }
  }

  // ── Phase bars ────────────────────────────────────────────────
  if (phaseStyle) {
    const phaseStatus = row?.phase?.status || 'not_started'
    if (phaseStatus === 'completed') return { bg: '#27272a', border: '#52525b', fg: '#a1a1aa' }
    if (phaseStatus === 'delayed')   return { bg: '#1c1917', border: '#b45309', fg: '#fcd34d' }
    if (phaseStatus === 'active')    return { bg: '#7c2d12', border: '#fb923c', fg: '#fff7ed' }
    return { bg: '#1c1917', border: '#78716c', fg: '#d6d3d1' }
  }

  // ── Task bars — status-driven ─────────────────────────────────
  const status = row?.task?.status

  switch (status) {
    case 'in_progress':
      if (critical) return { bg: '#9a3412', border: '#fb923c', fg: '#fff7ed' }
      return { bg: '#7c2d12', border: '#fb923c', fg: '#fed7aa' }
    case 'pending_review':
      return { bg: '#451a03', border: '#fbbf24', fg: '#fef3c7' }
    case 'needs_revisions':
      return { bg: '#4a1942', border: '#e879f9', fg: '#fae8ff' }
    case 'approved':
      return { bg: '#052e16', border: '#4ade80', fg: '#dcfce7' }
    case 'final':
      return { bg: '#14532d', border: '#22c55e', fg: '#bbf7d0' }
    case 'blocked':
      return { bg: '#1c1917', border: '#ef4444', fg: '#fca5a5' }
    case 'on_hold':
      return { bg: '#1c1917', border: '#d97706', fg: '#fcd34d' }
    case 'omitted':
      return { bg: '#1c1917', border: '#292524', fg: '#57534e' }
    case 'waiting_to_start':
      return { bg: '#1c1917', border: '#57534e', fg: '#a8a29e' }
    default: {
      // Unknown or unset status — stone neutral
      return { bg: '#1c1917', border: '#57534e', fg: '#a8a29e' }
    }
  }
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

// ============================================================
// buildRowsByGrouping — dispatches to the right row builder
// ============================================================

function buildRowsByGrouping({
  groupBy, phases, assets, tasks, schedule, sortOrder = 'asc', collapsedSet = null,
  teamAssignments = [], teamMembers = [],
  scenes = [], shots = [], levels = [], experiences = [],
}) {
  switch (groupBy) {
    case 'team':
      return buildRowsByTeam({ phases, assets, tasks, schedule, sortOrder, collapsedSet, teamAssignments, teamMembers })
    case 'asset':
      return buildRowsByAsset({ phases, assets, tasks, schedule, sortOrder, collapsedSet })
    case 'scene':
      return buildRowsByScene({ phases, assets, tasks, scenes, shots, schedule, sortOrder, collapsedSet })
    case 'level':
      return buildRowsByLevel({ tasks, levels, schedule, sortOrder, collapsedSet })
    case 'experience':
      return buildRowsByExperience({ tasks, experiences, schedule, sortOrder, collapsedSet })
    case 'phase':
    default:
      return buildRows({ phases, assets, tasks, schedule, sortOrder, collapsedSet })
  }
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
function buildRows({ phases, assets, tasks, schedule, sortOrder = 'asc', collapsedSet = null }) {
  const childrenByParent = groupPhasesByParent(phases)
  const assetById = Object.fromEntries(assets.map(a => [a.id, a]))
  const phaseById = Object.fromEntries(phases.map(p => [p.id, p]))
  const sign = sortOrder === 'desc' ? -1 : 1

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
  // explicit), then by title as a stable tiebreaker. Honors the
  // sortOrder argument so the user can flip ascending / descending
  // from the toolbar toggle.
  function sortTasks(list) {
    return list.slice().sort((a, b) => {
      const as = schedule.tasks[a.id]?.start
      const bs = schedule.tasks[b.id]?.start
      if (as && bs && as.getTime() !== bs.getTime()) return sign * (as - bs)
      if (as && !bs) return -1
      if (!as && bs) return 1
      return sign * String(a.title || '').localeCompare(String(b.title || ''))
    })
  }

  // Phase ordering at each tree level — same date-then-name rule.
  function sortPhases(list) {
    return list.slice().sort((a, b) => {
      const as = schedule.phases[a.id]?.start
      const bs = schedule.phases[b.id]?.start
      if (as && bs && as.getTime() !== bs.getTime()) return sign * (as - bs)
      if (as && !bs) return -1
      if (!as && bs) return 1
      return sign * String(a.name || '').localeCompare(String(b.name || ''))
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
    const collapsed = (collapsedSet && collapsedSet.has(phase.id)) || !!phase.collapsed
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
    for (const child of sortPhases(childrenByParent[phase.id] || [])) {
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

  for (const ph of sortPhases(childrenByParent['__root__'] || [])) pushPhase(ph, 0)

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

// ── buildRowsByTeam ─────────────────────────────────────────
// Team Member → Tasks (flat — no phase wrappers)
function buildRowsByTeam({ phases, assets, tasks, schedule, sortOrder = 'asc', collapsedSet, teamAssignments, teamMembers }) {
  const sign = sortOrder === 'desc' ? -1 : 1
  const rows = []
  const memberById = Object.fromEntries(teamMembers.map(m => [m.id, m]))
  const assignmentByMember = Object.fromEntries(teamAssignments.map(a => [a.member_id, a]))

  function sortTasks(list) {
    return list.slice().sort((a, b) => {
      const as = schedule.tasks[a.id]?.start
      const bs = schedule.tasks[b.id]?.start
      if (as && bs && as.getTime() !== bs.getTime()) return sign * (as - bs)
      if (as && !bs) return -1
      if (!as && bs) return 1
      return sign * String(a.title || '').localeCompare(String(b.title || ''))
    })
  }

  // Bucket tasks by assignee
  const tasksByMember = {}   // { memberId: Task[] }
  const unassignedTasks = []
  for (const t of tasks) {
    const mid = t.assignee_id && memberById[t.assignee_id] ? t.assignee_id : null
    if (mid) {
      if (!tasksByMember[mid]) tasksByMember[mid] = []
      tasksByMember[mid].push(t)
    } else {
      unassignedTasks.push(t)
    }
  }

  // Sort members by name
  const sortedMembers = teamAssignments
    .map(a => memberById[a.member_id])
    .filter(Boolean)
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))

  for (const member of sortedMembers) {
    const memberTasks = tasksByMember[member.id] || []
    const assignment = assignmentByMember[member.id]
    const collapsed = collapsedSet?.has(member.id)
    const mStart = parseDate(assignment?.start_date)
    const mEnd = parseDate(assignment?.end_date)
    rows.push({
      key: `grp-tm-${member.id}`,
      kind: 'phase',
      isSubgroup: true,
      label: member.name || 'Unnamed',
      phase: { id: member.id, name: member.name || 'Unnamed', start_date: assignment?.start_date, end_date: assignment?.end_date },
      phaseHint: member.id,
      depth: 0,
      collapsed,
      hasChildren: true,
      start: mStart, end: mEnd,
    })
    if (collapsed) continue
    for (const t of sortTasks(memberTasks)) {
      const sched = schedule.tasks[t.id]
      rows.push({
        key: `tk-${t.id}`, kind: 'task',
        label: t.title || 'Untitled task', task: t,
        phaseHint: member.id, depth: 1,
        start: sched?.start, end: sched?.end,
      })
    }
    rows.push({
      key: `dz-${member.id}`,
      kind: 'drop-zone',
      label: '+ New task',
      phase: { id: member.id, name: member.name || 'Unnamed' },
      phaseHint: member.id,
      depth: 1,
      phaseStart: mStart, phaseEnd: mEnd,
    })
  }

  // Unassigned tasks
  if (unassignedTasks.length > 0) {
    const unassignedCollapsed = collapsedSet?.has('__unassigned__')
    rows.push({
      key: 'grp-tm-unassigned',
      kind: 'phase',
      isSubgroup: true,
      label: 'Unassigned',
      phase: { id: '__unassigned__', name: 'Unassigned' },
      phaseHint: '__unassigned__',
      depth: 0,
      collapsed: unassignedCollapsed,
      hasChildren: true,
    })
    if (!unassignedCollapsed) {
      for (const t of sortTasks(unassignedTasks)) {
        const sched = schedule.tasks[t.id]
        rows.push({
          key: `tk-${t.id}`, kind: 'task',
          label: t.title || 'Untitled task', task: t,
          phaseHint: '__unassigned__', depth: 1,
          start: sched?.start, end: sched?.end,
        })
      }
      rows.push({
        key: 'dz-__unassigned__',
        kind: 'drop-zone',
        label: '+ New task',
        phase: { id: '__unassigned__', name: 'Unassigned' },
        phaseHint: '__unassigned__',
        depth: 1,
      })
    }
  }
  return rows
}

// ── buildRowsByAsset ────────────────────────────────────────
// Asset → Tasks (flat — no phase wrappers)
function buildRowsByAsset({ phases, assets, tasks, schedule, sortOrder = 'asc', collapsedSet }) {
  const sign = sortOrder === 'desc' ? -1 : 1
  const rows = []
  const assetById = Object.fromEntries(assets.map(a => [a.id, a]))

  function sortTasks(list) {
    return list.slice().sort((a, b) => {
      const as = schedule.tasks[a.id]?.start
      const bs = schedule.tasks[b.id]?.start
      if (as && bs && as.getTime() !== bs.getTime()) return sign * (as - bs)
      if (as && !bs) return -1
      if (!as && bs) return 1
      return sign * String(a.title || '').localeCompare(String(b.title || ''))
    })
  }

  // Bucket tasks by asset id
  const tasksByAsset = {}     // { assetId: Task[] }
  const noAssetTasks = []
  for (const t of tasks) {
    const aid = t.asset_id && assetById[t.asset_id] ? t.asset_id : null
    if (aid) {
      if (!tasksByAsset[aid]) tasksByAsset[aid] = []
      tasksByAsset[aid].push(t)
    } else {
      noAssetTasks.push(t)
    }
  }

  // Sort assets by start_date then name
  const sortedAssets = assets.slice().sort((a, b) => {
    const as = parseDate(a.start_date)
    const bs = parseDate(b.start_date)
    if (as && bs && as.getTime() !== bs.getTime()) return sign * (as - bs)
    if (as && !bs) return -1
    if (!as && bs) return 1
    return sign * String(a.name || '').localeCompare(String(b.name || ''))
  })

  // Push each asset as a top-level group header with its tasks
  for (const asset of sortedAssets) {
    const assetTasks = tasksByAsset[asset.id] || []
    const collapsed = collapsedSet?.has(asset.id)
    const aStart = parseDate(asset.start_date)
    const aEnd = parseDate(asset.due_date)
    rows.push({
      key: `grp-as-${asset.id}`,
      kind: 'phase',
      isSubgroup: true,
      assetRef: asset,
      label: asset.name || 'Untitled asset',
      phase: { id: asset.id, name: asset.name || 'Untitled asset', start_date: asset.start_date, end_date: asset.due_date, status: asset.status },
      phaseHint: asset.id,
      depth: 0,
      collapsed,
      hasChildren: true,
      start: aStart, end: aEnd,
    })
    if (collapsed) continue
    for (const t of sortTasks(assetTasks)) {
      const sched = schedule.tasks[t.id]
      rows.push({
        key: `tk-${t.id}`, kind: 'task',
        label: t.title || 'Untitled task', task: t,
        phaseHint: asset.id, assetHint: asset.id, depth: 1,
        start: sched?.start, end: sched?.end,
      })
    }
    // Drop zone — same pattern as phases
    rows.push({
      key: `dz-${asset.id}`,
      kind: 'drop-zone',
      label: '+ New task',
      phase: { id: asset.id, name: asset.name },
      phaseHint: asset.id,
      depth: 1,
      phaseStart: aStart, phaseEnd: aEnd,
    })
  }

  // Tasks with no asset
  if (noAssetTasks.length > 0) {
    const noAssetCollapsed = collapsedSet?.has('__noasset__')
    rows.push({
      key: 'grp-as-noasset',
      kind: 'phase',
      isSubgroup: true,
      label: 'No Asset',
      phase: { id: '__noasset__', name: 'No Asset' },
      phaseHint: '__noasset__',
      depth: 0,
      collapsed: noAssetCollapsed,
      hasChildren: true,
    })
    if (!noAssetCollapsed) {
      for (const t of sortTasks(noAssetTasks)) {
        const sched = schedule.tasks[t.id]
        rows.push({
          key: `tk-${t.id}`, kind: 'task',
          label: t.title || 'Untitled task', task: t,
          phaseHint: '__noasset__', depth: 1,
          start: sched?.start, end: sched?.end,
        })
      }
      rows.push({
        key: 'dz-__noasset__',
        kind: 'drop-zone',
        label: '+ New task',
        phase: { id: '__noasset__', name: 'No Asset' },
        phaseHint: '__noasset__',
        depth: 1,
      })
    }
  }

  return rows
}

// ── buildRowsByScene ────────────────────────────────────────
// Flat Scene → Shot → Tasks (no phase wrappers)
function buildRowsByScene({ phases, assets, tasks, scenes, shots, schedule, sortOrder = 'asc', collapsedSet }) {
  const sign = sortOrder === 'desc' ? -1 : 1
  const rows = []

  // Group shots by scene
  const shotsByScene = {}
  for (const sh of shots) {
    if (!sh.scene_id) continue
    if (!shotsByScene[sh.scene_id]) shotsByScene[sh.scene_id] = []
    shotsByScene[sh.scene_id].push(sh)
  }

  function sortTasks(list) {
    return list.slice().sort((a, b) => {
      const as = schedule.tasks[a.id]?.start
      const bs = schedule.tasks[b.id]?.start
      if (as && bs && as.getTime() !== bs.getTime()) return sign * (as - bs)
      if (as && !bs) return -1
      if (!as && bs) return 1
      return sign * String(a.title || '').localeCompare(String(b.title || ''))
    })
  }

  // Bucket tasks by scene and shot (flat — ignore phases)
  const tasksByScene = {}   // { sceneId: Task[] }
  const tasksByShot = {}    // { shotId: Task[] }
  const noSceneTasks = []
  for (const t of tasks) {
    if (t.shot_id) {
      if (!tasksByShot[t.shot_id]) tasksByShot[t.shot_id] = []
      tasksByShot[t.shot_id].push(t)
    } else if (t.scene_id) {
      if (!tasksByScene[t.scene_id]) tasksByScene[t.scene_id] = []
      tasksByScene[t.scene_id].push(t)
    } else {
      noSceneTasks.push(t)
    }
  }

  // Sort scenes by scene_number then name
  const sortedScenes = scenes.slice().sort((a, b) => {
    const an = a.scene_number || 0, bn = b.scene_number || 0
    if (an !== bn) return sign * (an - bn)
    return sign * String(a.name || '').localeCompare(String(b.name || ''))
  })

  for (const scene of sortedScenes) {
    const directTasks = tasksByScene[scene.id] || []
    const sceneShots = (shotsByScene[scene.id] || []).slice()
      .sort((a, b) => (a.shot_number || 0) - (b.shot_number || 0))
    const shotTaskCount = sceneShots.reduce((n, sh) => n + (tasksByShot[sh.id] || []).length, 0)
    const collapsed = collapsedSet?.has(scene.id)
    const sStart = parseDate(scene.start_date)
    const sEnd = parseDate(scene.end_date)
    rows.push({
      key: `grp-sc-${scene.id}`, kind: 'phase',
      isSubgroup: true,
      label: scene.name || 'Untitled scene',
      phase: { id: scene.id, name: scene.name, start_date: scene.start_date, end_date: scene.end_date, status: scene.status },
      phaseHint: scene.id, depth: 0,
      collapsed, hasChildren: true, start: sStart, end: sEnd,
    })
    if (collapsed) continue
    for (const t of sortTasks(directTasks)) {
      const sched = schedule.tasks[t.id]
      rows.push({ key: `tk-${t.id}`, kind: 'task', label: t.title || 'Untitled task', task: t,
        phaseHint: scene.id, depth: 1, start: sched?.start, end: sched?.end })
    }
    for (const shot of sceneShots) {
      const shotTasks = tasksByShot[shot.id] || []
      const shotCollapsed = collapsedSet?.has(shot.id)
      rows.push({
        key: `grp-sh-${shot.id}`, kind: 'phase',
        isSubgroup: true,
        label: shot.name || 'Untitled shot',
        phase: { id: shot.id, name: shot.name, start_date: shot.start_date, end_date: shot.end_date, status: shot.status },
        phaseHint: shot.id, depth: 1,
        collapsed: shotCollapsed, hasChildren: true,
        start: parseDate(shot.start_date), end: parseDate(shot.end_date),
      })
      if (shotCollapsed) continue
      for (const t of sortTasks(shotTasks)) {
        const sched = schedule.tasks[t.id]
        rows.push({ key: `tk-${t.id}`, kind: 'task', label: t.title || 'Untitled task', task: t,
          phaseHint: shot.id, depth: 2, start: sched?.start, end: sched?.end })
      }
      rows.push({
        key: `dz-${shot.id}`,
        kind: 'drop-zone',
        label: '+ New task',
        phase: { id: shot.id, name: shot.name },
        phaseHint: shot.id,
        depth: 2,
        phaseStart: parseDate(shot.start_date), phaseEnd: parseDate(shot.end_date),
      })
    }
    // Scene-level drop zone (after shots)
    rows.push({
      key: `dz-${scene.id}`,
      kind: 'drop-zone',
      label: '+ New task',
      phase: { id: scene.id, name: scene.name },
      phaseHint: scene.id,
      depth: 1,
      phaseStart: sStart, phaseEnd: sEnd,
    })
  }

  // Tasks with no scene
  if (noSceneTasks.length > 0) {
    const noSceneCollapsed = collapsedSet?.has('__noscene__')
    rows.push({
      key: 'grp-noscene', kind: 'phase', isSubgroup: true, label: 'No Scene',
      phase: { id: '__noscene__', name: 'No Scene' },
      phaseHint: '__noscene__',
      depth: 0, collapsed: noSceneCollapsed, hasChildren: true,
    })
    if (!noSceneCollapsed) {
      for (const t of sortTasks(noSceneTasks)) {
        const sched = schedule.tasks[t.id]
        rows.push({ key: `tk-${t.id}`, kind: 'task', label: t.title || 'Untitled task', task: t,
          phaseHint: '__noscene__', depth: 1, start: sched?.start, end: sched?.end })
      }
      rows.push({
        key: 'dz-__noscene__',
        kind: 'drop-zone',
        label: '+ New task',
        phase: { id: '__noscene__', name: 'No Scene' },
        phaseHint: '__noscene__',
        depth: 1,
      })
    }
  }
  return rows
}

// ── buildRowsByLevel ────────────────────────────────────────
function buildRowsByLevel({ tasks, levels, schedule, sortOrder = 'asc', collapsedSet }) {
  const sign = sortOrder === 'desc' ? -1 : 1
  const rows = []
  const levelById = Object.fromEntries(levels.map(l => [l.id, l]))

  const tasksByLevel = {}
  const noLevel = []
  for (const t of tasks) {
    if (t.level_id && levelById[t.level_id]) {
      if (!tasksByLevel[t.level_id]) tasksByLevel[t.level_id] = []
      tasksByLevel[t.level_id].push(t)
    } else {
      noLevel.push(t)
    }
  }

  function sortTasks(list) {
    return list.slice().sort((a, b) => {
      const as = schedule.tasks[a.id]?.start
      const bs = schedule.tasks[b.id]?.start
      if (as && bs && as.getTime() !== bs.getTime()) return sign * (as - bs)
      if (as && !bs) return -1
      if (!as && bs) return 1
      return sign * String(a.title || '').localeCompare(String(b.title || ''))
    })
  }

  const sortedLevels = levels.slice().sort((a, b) => {
    const as = parseDate(a.start_date)
    const bs = parseDate(b.start_date)
    if (as && bs && as.getTime() !== bs.getTime()) return sign * (as - bs)
    if (as && !bs) return -1
    if (!as && bs) return 1
    return sign * String(a.name || '').localeCompare(String(b.name || ''))
  })

  for (const level of sortedLevels) {
    const levelTasks = tasksByLevel[level.id] || []
    const collapsed = collapsedSet?.has(level.id)
    const start = parseDate(level.start_date)
    const end = parseDate(level.end_date)
    rows.push({
      key: `grp-lv-${level.id}`,
      kind: 'phase',
      isSubgroup: true,
      label: level.name || 'Untitled level',
      phase: { id: level.id, name: level.name, start_date: level.start_date, end_date: level.end_date },
      phaseHint: level.id,
      depth: 0,
      collapsed,
      hasChildren: true,
      start, end,
    })
    if (collapsed) continue
    for (const t of sortTasks(levelTasks)) {
      const sched = schedule.tasks[t.id]
      rows.push({
        key: `tk-${t.id}`, kind: 'task',
        label: t.title || 'Untitled task', task: t,
        phaseHint: level.id, depth: 1,
        start: sched?.start, end: sched?.end,
      })
    }
    rows.push({
      key: `dz-${level.id}`,
      kind: 'drop-zone',
      label: '+ New task',
      phase: { id: level.id, name: level.name },
      phaseHint: level.id,
      depth: 1,
      phaseStart: start, phaseEnd: end,
    })
  }

  if (noLevel.length > 0) {
    const noLevelCollapsed = collapsedSet?.has('__nolevel__')
    rows.push({
      key: 'grp-nolevel', kind: 'phase', isSubgroup: true, label: 'No Level',
      phase: { id: '__nolevel__', name: 'No Level' },
      phaseHint: '__nolevel__',
      depth: 0, collapsed: noLevelCollapsed, hasChildren: true,
    })
    if (!noLevelCollapsed) {
      for (const t of sortTasks(noLevel)) {
        const sched = schedule.tasks[t.id]
        rows.push({
          key: `tk-${t.id}`, kind: 'task',
          label: t.title || 'Untitled task', task: t,
          phaseHint: '__nolevel__', depth: 1,
          start: sched?.start, end: sched?.end,
        })
      }
      rows.push({
        key: 'dz-__nolevel__',
        kind: 'drop-zone',
        label: '+ New task',
        phase: { id: '__nolevel__', name: 'No Level' },
        phaseHint: '__nolevel__',
        depth: 1,
      })
    }
  }
  return rows
}

// ── buildRowsByExperience ───────────────────────────────────
function buildRowsByExperience({ tasks, experiences, schedule, sortOrder = 'asc', collapsedSet }) {
  const sign = sortOrder === 'desc' ? -1 : 1
  const rows = []
  const expById = Object.fromEntries(experiences.map(e => [e.id, e]))

  const tasksByExp = {}
  const noExp = []
  for (const t of tasks) {
    if (t.experience_id && expById[t.experience_id]) {
      if (!tasksByExp[t.experience_id]) tasksByExp[t.experience_id] = []
      tasksByExp[t.experience_id].push(t)
    } else {
      noExp.push(t)
    }
  }

  function sortTasks(list) {
    return list.slice().sort((a, b) => {
      const as = schedule.tasks[a.id]?.start
      const bs = schedule.tasks[b.id]?.start
      if (as && bs && as.getTime() !== bs.getTime()) return sign * (as - bs)
      if (as && !bs) return -1
      if (!as && bs) return 1
      return sign * String(a.title || '').localeCompare(String(b.title || ''))
    })
  }

  const sorted = experiences.slice().sort((a, b) => {
    const as = parseDate(a.start_date)
    const bs = parseDate(b.start_date)
    if (as && bs && as.getTime() !== bs.getTime()) return sign * (as - bs)
    if (as && !bs) return -1
    if (!as && bs) return 1
    return sign * String(a.name || '').localeCompare(String(b.name || ''))
  })

  for (const exp of sorted) {
    const expTasks = tasksByExp[exp.id] || []
    const collapsed = collapsedSet?.has(exp.id)
    const start = parseDate(exp.start_date)
    const end = parseDate(exp.end_date)
    rows.push({
      key: `grp-xp-${exp.id}`,
      kind: 'phase',
      isSubgroup: true,
      label: exp.name || 'Untitled experience',
      phase: { id: exp.id, name: exp.name, start_date: exp.start_date, end_date: exp.end_date },
      phaseHint: exp.id,
      depth: 0,
      collapsed,
      hasChildren: true,
      start, end,
    })
    if (collapsed) continue
    for (const t of sortTasks(expTasks)) {
      const sched = schedule.tasks[t.id]
      rows.push({
        key: `tk-${t.id}`, kind: 'task',
        label: t.title || 'Untitled task', task: t,
        phaseHint: exp.id, depth: 1,
        start: sched?.start, end: sched?.end,
      })
    }
    rows.push({
      key: `dz-${exp.id}`,
      kind: 'drop-zone',
      label: '+ New task',
      phase: { id: exp.id, name: exp.name },
      phaseHint: exp.id,
      depth: 1,
      phaseStart: start, phaseEnd: end,
    })
  }

  if (noExp.length > 0) {
    const noExpCollapsed = collapsedSet?.has('__noexp__')
    rows.push({
      key: 'grp-noexp', kind: 'phase', isSubgroup: true, label: 'No Experience',
      phase: { id: '__noexp__', name: 'No Experience' },
      phaseHint: '__noexp__',
      depth: 0, collapsed: noExpCollapsed, hasChildren: true,
    })
    if (!noExpCollapsed) {
      for (const t of sortTasks(noExp)) {
        const sched = schedule.tasks[t.id]
        rows.push({
          key: `tk-${t.id}`, kind: 'task',
          label: t.title || 'Untitled task', task: t,
          phaseHint: '__noexp__', depth: 1,
          start: sched?.start, end: sched?.end,
        })
      }
      rows.push({
        key: 'dz-__noexp__',
        kind: 'drop-zone',
        label: '+ New task',
        phase: { id: '__noexp__', name: 'No Experience' },
        phaseHint: '__noexp__',
        depth: 1,
      })
    }
  }
  return rows
}

// buildOverviewRowsByGrouping — dispatches overview rows by groupBy
function buildOverviewRowsByGrouping({
  groupBy, phases, assets, tasks, schedule, sortOrder = 'asc',
  scenes = [], shots = [], levels = [], experiences = [],
  teamAssignments = [], teamMembers = [],
}) {
  if (groupBy === 'phase' || !groupBy) {
    return buildOverviewRows({ phases, assets, tasks, schedule, sortOrder })
  }

  // Generic overview builder for non-phase groupings
  const sign = sortOrder === 'desc' ? -1 : 1
  const out = []

  function sortByDate(list, dateFn) {
    return list.slice().sort((a, b) => {
      const as = dateFn(a)
      const bs = dateFn(b)
      if (as && bs && as.getTime() !== bs.getTime()) return sign * (as - bs)
      if (as && !bs) return -1
      if (!as && bs) return 1
      return sign * String(a.name || '').localeCompare(String(b.name || ''))
    })
  }

  function countTasksFor(field, id) {
    let n = 0
    for (const t of tasks) { if (t[field] === id && schedule.tasks[t.id]) n++ }
    return n
  }

  if (groupBy === 'team') {
    const memberById = Object.fromEntries(teamMembers.map(m => [m.id, m]))
    const assignmentByMember = Object.fromEntries(teamAssignments.map(a => [a.member_id, a]))
    const ids = [...new Set([...teamAssignments.map(a => a.member_id)])]
    for (const id of ids) {
      const m = memberById[id]
      if (!m) continue
      const a = assignmentByMember[id]
      out.push({
        key: `ovr-tm-${id}`, kind: 'phase',
        label: m.name, phase: { id, name: m.name },
        phaseId: id,
        taskCount: countTasksFor('assignee_id', id),
        start: parseDate(a?.start_date), end: parseDate(a?.end_date),
      })
    }
  } else if (groupBy === 'asset') {
    for (const a of sortByDate(assets, x => parseDate(x.start_date))) {
      out.push({
        key: `ovr-as-${a.id}`, kind: 'phase',
        label: a.name, phase: { id: a.id, name: a.name },
        phaseId: a.id,
        taskCount: countTasksFor('asset_id', a.id),
        start: parseDate(a.start_date), end: parseDate(a.due_date),
      })
    }
  } else if (groupBy === 'scene') {
    for (const s of sortByDate(scenes, x => parseDate(x.start_date))) {
      out.push({
        key: `ovr-sc-${s.id}`, kind: 'phase',
        label: s.name, phase: { id: s.id, name: s.name },
        phaseId: s.id,
        taskCount: countTasksFor('scene_id', s.id),
        start: parseDate(s.start_date), end: parseDate(s.end_date),
      })
    }
  } else if (groupBy === 'level') {
    for (const l of sortByDate(levels, x => parseDate(x.start_date))) {
      out.push({
        key: `ovr-lv-${l.id}`, kind: 'phase',
        label: l.name, phase: { id: l.id, name: l.name },
        phaseId: l.id,
        taskCount: countTasksFor('level_id', l.id),
        start: parseDate(l.start_date), end: parseDate(l.end_date),
      })
    }
  } else if (groupBy === 'experience') {
    for (const e of sortByDate(experiences, x => parseDate(x.start_date))) {
      out.push({
        key: `ovr-xp-${e.id}`, kind: 'phase',
        label: e.name, phase: { id: e.id, name: e.name },
        phaseId: e.id,
        taskCount: countTasksFor('experience_id', e.id),
        start: parseDate(e.start_date), end: parseDate(e.end_date),
      })
    }
  }
  return out
}

// buildOverviewRows: a flatter, less-indented list for the
// minimap. The minimap shows PHASES ONLY — tasks are a detail-
// pane concern, and cluttering the minimap with individual task
// pills makes the project shape hard to read at a glance. Each
// phase row carries a pre-computed taskCount so the hover popup
// can show "N tasks" without reshipping the task list.
function buildOverviewRows({ phases, assets, tasks, schedule, sortOrder = 'asc' }) {
  const out = []
  const childrenByParent = groupPhasesByParent(phases)
  const assetById = Object.fromEntries(assets.map(a => [a.id, a]))
  const sign = sortOrder === 'desc' ? -1 : 1

  // Count tasks that belong to each phase — directly via phase_id
  // or indirectly through an asset that lives in that phase.
  // Only tasks the scheduler has actually placed count, so the
  // number matches what the user sees in the detail pane.
  const taskCountByPhase = {}
  for (const t of tasks) {
    if (!schedule.tasks[t.id]) continue
    const pid = t.phase_id || (t.asset_id && assetById[t.asset_id]?.phase_id) || null
    if (!pid) continue
    taskCountByPhase[pid] = (taskCountByPhase[pid] || 0) + 1
  }

  function sortPhases(list) {
    return list.slice().sort((a, b) => {
      const as = schedule.phases[a.id]?.start
      const bs = schedule.phases[b.id]?.start
      if (as && bs && as.getTime() !== bs.getTime()) return sign * (as - bs)
      if (as && !bs) return -1
      if (!as && bs) return 1
      return sign * String(a.name || '').localeCompare(String(b.name || ''))
    })
  }

  function walk(phase) {
    const ps = schedule.phases[phase.id]
    out.push({
      key:    `ovr-ph-${phase.id}`,
      kind:   'phase',
      label:  phase.name,
      phase,
      phaseId: phase.id,
      taskCount: taskCountByPhase[phase.id] || 0,
      start:  ps?.start,
      end:    ps?.end,
    })
    for (const child of sortPhases(childrenByParent[phase.id] || [])) walk(child)
  }
  for (const p of sortPhases(childrenByParent['__root__'] || [])) walk(p)

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
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatDayLabel(d) {
  // "Apr 9" — compact and readable at tiny font sizes.
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`
}
function formatMonth(d) {
  return `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`
}
function formatQuarter(d) {
  const q = Math.floor(d.getMonth() / 3) + 1
  return `Q${q} ${d.getFullYear()}`
}

// Detail axis ticks honoring the current zoom level.
//
// Rules to prevent stray single-day fragments in the header:
//   • Week: emit only Mondays and month-1st boundaries. The span
//     start (i === 0) is NOT force-emitted because it usually
//     falls mid-week and creates a tiny stub label.
//   • Month: emit only month-1st boundaries.
//   • Quarter: emit only quarter-1st boundaries.
//   • Day: every single day is a tick — no stub possible.
//
// The very first tick in the output ALWAYS gets a full "Mon YYYY"
// label instead of the short day format so the user immediately
// knows the date context when scrolling to the start of the span.
function buildAxisTicks(start, totalDays, zoom) {
  const out = []
  // Track the last emitted major tick offset so we can suppress
  // regular ticks that would overlap (e.g. a Monday 1 day after
  // a month-1st boundary at week zoom).
  let lastMajorOffset = -Infinity
  const MIN_GAP = Math.max(3, Math.ceil(60 / zoom.dayPx)) // ≥60px between ticks
  for (let i = 0; i <= totalDays; i++) {
    const d = addDays(start, i)
    let include = false
    let label = ''
    let topLabel = null   // optional upper-tier label (month header above day)
    let major = false
    switch (zoom.axisFormat) {
      case 'day':
        include = true
        label = formatDayLabel(d)
        major = d.getDate() === 1
        if (major) topLabel = formatMonth(d)
        break
      case 'week': {
        const isMonday = d.getDay() === 1
        const isMonth1 = d.getDate() === 1
        if (isMonth1) {
          include = true
          major = true
          topLabel = formatMonth(d)
          label = formatDayLabel(d)
          lastMajorOffset = i
        } else if (isMonday) {
          // Suppress Mondays too close to a month boundary
          if (i - lastMajorOffset >= MIN_GAP) {
            include = true
            label = formatDayLabel(d)
          }
        }
        break
      }
      case 'month':
        include = d.getDate() === 1
        label = formatMonth(d)
        major = d.getMonth() === 0
        break
      case 'quarter':
        // Emit every month-1st as a tick. Quarter starts (Jan/Apr/Jul/Oct)
        // are major — they get bold lines + a "Q1 2026" label on top.
        // Non-quarter months are minor with just the month abbreviation.
        include = d.getDate() === 1
        if ([0, 3, 6, 9].includes(d.getMonth())) {
          major = true
          topLabel = formatQuarter(d)
          label = formatMonth(d)
        } else {
          label = MONTH_ABBR[d.getMonth()]
        }
        break
      default:
        include = false
    }
    if (include) out.push({ key: i, offset: i, label, topLabel, major })
  }
  return out
}

// Overview ticks: month boundaries with year labels.
// Does NOT force-emit a tick at i === 0 — that created ugly stub
// labels when the minimap span started mid-month.
function buildOverviewTicks(start, totalDays) {
  const out = []
  for (let i = 0; i <= totalDays; i++) {
    const d = addDays(start, i)
    if (d.getDate() !== 1) continue
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
function buildSummary({ phases, assets, tasks, schedule, criticalSet, holidays }) {
  const blocked = tasks.filter(t => t.status === 'blocked').length
  const span = totalSpan(schedule)
  let criticalDays = 0
  for (const t of tasks) {
    if (criticalSet.has(t.id)) criticalDays += Number(t.bid_days || 0)
  }
  const workingDays = countWorkingDays(span.start, span.end, holidays)
  return {
    phases: phases.length,
    assets: assets.length,
    tasks:  tasks.length,
    critical: criticalSet.size,
    blocked,
    spanDays: span.days,
    workingDays,
    criticalDays,
  }
}
