// ============================================================
// RABBIT — TimelineView
// ============================================================
//
// Read-only Gantt view for the active project. v0.1 ships with
// a hand-rolled SVG renderer instead of a third-party library
// because:
//
//   1. Every React Gantt with a permissive license still pegs
//      its peer-dep at React 18 (gantt-task-react etc.) and
//      WILSON is on React 19.
//   2. The data is small (≤ a few hundred tasks per project)
//      and the visual language is opinionated, so a 200-line
//      hand-rolled renderer beats wrapping a vanilla JS lib.
//   3. v0.1 is read-only — drag-to-reschedule is v0.2 — so we
//      do not need the heavyweight interaction layer.
//
// What it draws:
//
//   • A horizontal time axis with day grid lines (zoom controls
//     come in Commit 14).
//   • One row per task, grouped by phase → asset.
//   • Bar = synthetic schedule computed from the dependency DAG
//     and bid_days. Real `start_date` / `end_date` from the
//     adapter override the synthetic schedule when present.
//   • Critical-path tasks highlighted in `#ea580c`; other bars
//     in `#fed7aa`.
//   • Today line.
//
// Zoom controls + summary band move into Commit 14. The Commit
// 13 renderer is fixed at 1 day = 24px.

import { useMemo } from 'react'
import { CalendarDays, GitBranch } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'

const DAY_PX = 24
const ROW_PX = 28
const HEADER_PX = 40
const LABEL_W = 220
const TODAY = startOfDay(new Date())

export default function TimelineView() {
  const ctx = useRabbit()
  const project = ctx?.project
  const phases = ctx?.phases || []
  const assets = ctx?.assets || []
  const tasks  = ctx?.tasks  || []
  const dependencies = ctx?.dependencies || []

  const criticalSet = useMemo(() => {
    const path = ctx?.selectCriticalPath?.() || []
    return new Set(path)
  }, [ctx])

  const schedule = useMemo(
    () => buildSchedule({ tasks, dependencies }),
    [tasks, dependencies]
  )

  const rows = useMemo(
    () => buildRows({ phases, assets, tasks, schedule }),
    [phases, assets, tasks, schedule]
  )

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#7c2d12' }}>
          No project loaded
        </span>
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <CalendarDays className="w-8 h-8" style={{ color: '#7c2d12' }} />
        <span className="text-[11px] font-mono italic" style={{ color: '#7c2d12' }}>
          No tasks yet — run the intake wizard or add tasks from the Assets tab.
        </span>
      </div>
    )
  }

  // Span across all rows.
  const span = totalSpan(schedule)
  const totalDays = Math.max(7, span.days + 4)
  const chartW = totalDays * DAY_PX
  const chartH = HEADER_PX + rows.length * ROW_PX

  // Today's offset relative to chart origin (span.start).
  const todayDays = daysBetween(span.start, TODAY)

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#fef3e8' }}>
      {/* Header strip */}
      <div
        className="flex items-center gap-3 px-6 py-3"
        style={{ borderBottom: '1px solid #f4a261', backgroundColor: '#fff7ed' }}
      >
        <CalendarDays className="w-4 h-4" style={{ color: '#ea580c' }} />
        <span className="text-[11px] font-mono uppercase tracking-widest font-bold" style={{ color: '#1c1917' }}>
          Timeline
        </span>
        <span className="text-[10px] font-mono" style={{ color: '#7c2d12' }}>
          · {tasks.length} task{tasks.length === 1 ? '' : 's'} · {totalDays} day window
        </span>
        <span
          className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm"
          style={{ color: '#7c2d12', backgroundColor: '#fed7aa', border: '1px solid #7c2d12' }}
        >
          <GitBranch className="w-3 h-3" />
          synthetic schedule
        </span>
      </div>

      {/* Gantt body */}
      <div className="flex-1 overflow-auto">
        <div className="flex" style={{ minWidth: LABEL_W + chartW }}>
          {/* Sticky label column */}
          <div
            className="flex-shrink-0 sticky left-0 z-10"
            style={{
              width: LABEL_W,
              backgroundColor: '#fff7ed',
              borderRight: '2px solid #7c2d12',
            }}
          >
            <div
              className="flex items-end px-3 pb-2"
              style={{
                height: HEADER_PX,
                borderBottom: '2px solid #7c2d12',
                backgroundColor: '#f4a261',
              }}
            >
              <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#1c1917' }}>
                Phase / Asset / Task
              </span>
            </div>
            {rows.map((r, i) => (
              <div
                key={r.key}
                className="flex items-center px-3"
                style={{
                  height: ROW_PX,
                  borderBottom: '1px solid #fed7aa',
                  backgroundColor: r.kind === 'phase' ? '#fed7aa' : '#fff7ed',
                  paddingLeft: r.kind === 'phase' ? 8 : r.kind === 'asset' ? 18 : 28,
                }}
              >
                <span
                  className={`text-[11px] font-mono truncate ${r.kind === 'phase' ? 'font-bold uppercase tracking-wider' : ''}`}
                  style={{ color: '#1c1917' }}
                >
                  {r.label}
                </span>
              </div>
            ))}
          </div>

          {/* Chart area */}
          <div className="relative" style={{ width: chartW }}>
            {/* Time axis */}
            <div
              className="relative"
              style={{
                height: HEADER_PX,
                borderBottom: '2px solid #7c2d12',
                backgroundColor: '#f4a261',
              }}
            >
              {Array.from({ length: totalDays + 1 }, (_, i) => {
                const d = addDays(span.start, i)
                const isWeekStart = d.getDay() === 1
                const isMonthStart = d.getDate() === 1
                if (!isWeekStart && !isMonthStart && i !== 0) return null
                return (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 flex flex-col justify-end pb-1 px-1"
                    style={{
                      left: i * DAY_PX,
                      borderLeft: isMonthStart ? '2px solid #7c2d12' : '1px solid #ea580c',
                    }}
                  >
                    <span
                      className="text-[9px] font-mono"
                      style={{ color: '#1c1917', whiteSpace: 'nowrap' }}
                    >
                      {isMonthStart ? formatMonth(d) : formatDayLabel(d)}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Row backgrounds + bars */}
            <div className="relative" style={{ height: rows.length * ROW_PX }}>
              {/* Day grid */}
              {Array.from({ length: totalDays + 1 }, (_, i) => (
                <div
                  key={`g-${i}`}
                  className="absolute top-0 bottom-0"
                  style={{
                    left: i * DAY_PX,
                    width: 1,
                    backgroundColor: addDays(span.start, i).getDay() === 1 ? '#f4a261' : '#fed7aa',
                    opacity: 0.6,
                  }}
                />
              ))}

              {/* Today line */}
              {todayDays >= 0 && todayDays <= totalDays && (
                <div
                  className="absolute top-0 bottom-0"
                  style={{
                    left: todayDays * DAY_PX,
                    width: 2,
                    backgroundColor: '#991b1b',
                    zIndex: 5,
                  }}
                  title="Today"
                />
              )}

              {/* Row stripes + bars */}
              {rows.map((r, i) => (
                <div
                  key={r.key}
                  className="absolute left-0 right-0"
                  style={{
                    top: i * ROW_PX,
                    height: ROW_PX,
                    borderBottom: '1px solid #fed7aa',
                    backgroundColor: r.kind === 'phase' ? '#fed7aa' : 'transparent',
                  }}
                >
                  {r.kind === 'task' && r.start && r.end && (
                    <Bar
                      offsetDays={daysBetween(span.start, r.start)}
                      lengthDays={Math.max(0.5, daysBetween(r.start, r.end))}
                      label={r.label}
                      critical={criticalSet.has(r.task.id)}
                      status={r.task.status}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Bar atom ───
function Bar({ offsetDays, lengthDays, label, critical, status }) {
  const tone = barTone(status, critical)
  return (
    <div
      className="absolute flex items-center px-2 rounded-sm overflow-hidden"
      style={{
        left: offsetDays * DAY_PX,
        width: lengthDays * DAY_PX,
        top: 4,
        height: ROW_PX - 8,
        backgroundColor: tone.bg,
        border: `1px solid ${tone.border}`,
      }}
      title={`${label} · ${lengthDays.toFixed(1)} day${lengthDays === 1 ? '' : 's'}`}
    >
      <span
        className="text-[10px] font-mono truncate"
        style={{ color: tone.fg }}
      >
        {label}
      </span>
    </div>
  )
}

function barTone(status, critical) {
  if (critical) return { bg: '#ea580c', border: '#7c2d12', fg: '#fff7ed' }
  if (status === 'blocked')   return { bg: '#fee2e2', border: '#991b1b', fg: '#991b1b' }
  if (status === 'on_hold')   return { bg: '#fef3c7', border: '#92400e', fg: '#92400e' }
  if (status === 'final' || status === 'approved') return { bg: '#dcfce7', border: '#15803d', fg: '#15803d' }
  return { bg: '#fed7aa', border: '#7c2d12', fg: '#1c1917' }
}

// ─── Schedule helpers ───
//
// Builds a synthetic schedule. Tasks with explicit start_date /
// end_date keep them. Otherwise we walk the dependency DAG from
// roots and lay each task out sequentially with bid_days as the
// duration.
function buildSchedule({ tasks, dependencies }) {
  const map = {}
  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]))
  const successors = {}
  const predecessors = {}
  for (const t of tasks) { successors[t.id] = []; predecessors[t.id] = [] }
  for (const dep of dependencies || []) {
    if (!taskById[dep.predecessor_id] || !taskById[dep.successor_id]) continue
    successors[dep.predecessor_id].push({ id: dep.successor_id, lag: dep.lag_days || 0 })
    predecessors[dep.successor_id].push({ id: dep.predecessor_id, lag: dep.lag_days || 0 })
  }

  // Kahn topological sort.
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
  // Cycle? Just lay them out by sort order — synthetic anyway.
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
      // Synthetic — start at max(predecessor end + lag, today).
      let earliest = TODAY
      for (const { id: predId, lag } of predecessors[id]) {
        const predEntry = map[predId]
        if (predEntry?.end) {
          const candidate = addDays(predEntry.end, lag || 0)
          if (candidate > earliest) earliest = candidate
        }
      }
      start = explicitStart || earliest
      const dur = Math.max(1, Number(t.bid_days || 1))
      end = addDays(start, dur)
    }
    map[id] = { start, end }
  }
  return map
}

function buildRows({ phases, assets, tasks, schedule }) {
  // Group: phase → assets in that phase → tasks for each asset.
  // Plus an "Unphased" group for orphan assets and an "Orphan tasks"
  // group for tasks whose asset_id no longer resolves.
  const phaseSorted = phases
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const assetsByPhase = {}
  for (const a of assets) {
    const key = a.phase_id || '__unphased__'
    if (!assetsByPhase[key]) assetsByPhase[key] = []
    assetsByPhase[key].push(a)
  }
  for (const k of Object.keys(assetsByPhase)) {
    assetsByPhase[k].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }

  const tasksByAsset = {}
  for (const t of tasks) {
    const key = t.asset_id || '__orphan__'
    if (!tasksByAsset[key]) tasksByAsset[key] = []
    tasksByAsset[key].push(t)
  }

  const rows = []

  function pushPhaseGroup(phase) {
    const list = assetsByPhase[phase?.id || '__unphased__'] || []
    if (list.length === 0) return
    rows.push({ key: `ph-${phase?.id || 'unphased'}`, kind: 'phase', label: phase?.name || 'Unphased' })
    for (const a of list) {
      rows.push({ key: `as-${a.id}`, kind: 'asset', label: a.name })
      const taskList = tasksByAsset[a.id] || []
      for (const t of taskList) {
        const sched = schedule[t.id]
        rows.push({
          key:   `tk-${t.id}`,
          kind:  'task',
          label: t.title,
          task:  t,
          start: sched?.start,
          end:   sched?.end,
        })
      }
    }
  }

  for (const ph of phaseSorted) pushPhaseGroup(ph)
  pushPhaseGroup({ id: '__unphased__', name: 'Unphased' })

  // Orphan tasks (asset_id missing).
  const orphans = tasksByAsset['__orphan__'] || []
  if (orphans.length > 0) {
    rows.push({ key: 'ph-orphan', kind: 'phase', label: 'Orphan tasks' })
    for (const t of orphans) {
      const sched = schedule[t.id]
      rows.push({
        key:   `tk-${t.id}`,
        kind:  'task',
        label: t.title,
        task:  t,
        start: sched?.start,
        end:   sched?.end,
      })
    }
  }

  return rows
}

function totalSpan(schedule) {
  const dates = Object.values(schedule)
    .flatMap(s => [s?.start, s?.end])
    .filter(Boolean)
  if (dates.length === 0) {
    return { start: addDays(TODAY, -1), end: addDays(TODAY, 14), days: 15 }
  }
  let min = dates[0]
  let max = dates[0]
  for (const d of dates) {
    if (d < min) min = d
    if (d > max) max = d
  }
  // Pad both ends by a couple of days.
  const start = addDays(min, -2)
  const end   = addDays(max,  2)
  return { start, end, days: daysBetween(start, end) }
}

// ─── Date utils ───
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
