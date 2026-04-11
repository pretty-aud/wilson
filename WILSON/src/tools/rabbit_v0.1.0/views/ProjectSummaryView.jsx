// ============================================================
// RABBIT — ProjectSummaryView
// ============================================================
//
// Read-only dashboard for the active project. Five cards:
//
//   1. Header     — title, status, description, budget currency
//   2. Phase strip— ordered phases with asset counts
//   3. Next up    — top 5 waiting_to_start tasks by priority
//   4. At risk    — blocked / on_hold / status-warning items
//   5. Budget     — bid vs logged variance + currency total
//
// Everything pulls from `useRabbit()` selectors. The view does
// not mutate the bundle — clicking through to a different tab
// is how the user takes action on what they see here.

import { useMemo } from 'react'
import {
  ListChecks, AlertTriangle, Clock, DollarSign,
  Layers, Boxes, ChevronRight, FileText, Folder, Check, LayoutGrid,
  FolderOpen,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'

const PRIORITY_RANK = { crit: 4, critical: 4, high: 3, med: 2, medium: 2, low: 1 }
const RISK_STATES = new Set(['blocked', 'on_hold'])

export default function ProjectSummaryView() {
  const ctx = useRabbit()
  const project = ctx?.project
  const phases  = ctx?.phases  || []
  const assets  = ctx?.assets  || []
  const tasks   = ctx?.tasks   || []
  const loading = ctx?.loadingProject
  const projectsIndex  = ctx?.projectsIndex || {}
  const activeProjectId = ctx?.activeProjectId
  const setActiveProject = ctx?.setActiveProject

  const allProjects = useMemo(() => {
    return Object.values(projectsIndex).sort((a, b) => {
      const ad = a.updated_at ? new Date(a.updated_at).getTime() : 0
      const bd = b.updated_at ? new Date(b.updated_at).getTime() : 0
      return bd - ad
    })
  }, [projectsIndex])

  const variance = useMemo(
    () => ctx?.selectVarianceForProject?.() || { bid: 0, logged: 0, variance: 0 },
    [ctx]
  )

  const budget = useMemo(
    () => ctx?.selectProjectBudgetRollup?.() || { total: 0, byRole: {}, currency: 'USD' },
    [ctx]
  )

  const nextUp = useMemo(() => {
    return tasks
      .filter(t => t.status === 'waiting_to_start' || t.status === 'queued' || !t.status)
      .sort((a, b) => (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0))
      .slice(0, 5)
  }, [tasks])

  const atRisk = useMemo(() => {
    const blocked = tasks.filter(t => RISK_STATES.has(t.status))
    const warned  = assets
      .filter(a => ctx?.selectAssetStatusWarning?.(a))
      .map(a => ({ kind: 'asset', id: a.id, label: a.name, hint: 'status mismatch' }))
    const blockedMapped = blocked.map(t => ({
      kind: 'task',
      id: t.id,
      label: t.title,
      hint: t.status,
    }))
    return [...blockedMapped, ...warned].slice(0, 8)
  }, [tasks, assets, ctx])

  const phaseAssetCounts = useMemo(() => {
    const map = {}
    for (const a of assets) {
      const key = a.phase_id || '__unphased__'
      map[key] = (map[key] || 0) + 1
    }
    return map
  }, [assets])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: '#1c1917' }}>
        <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>
          Loading project…
        </span>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="h-full overflow-auto" style={{ backgroundColor: '#1c1917' }}>
        <div className="p-6 flex flex-col gap-4">
          <Card title="All projects" icon={LayoutGrid}>
            {allProjects.length === 0 ? (
              <Empty>No projects yet — create one from the Intake tab.</Empty>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {allProjects.map(p => (
                  <ProjectMiniCard
                    key={p.id}
                    project={p}
                    active={p.id === activeProjectId}
                    onClick={() => setActiveProject?.(p.id)}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: '#1c1917' }}>
      <div className="p-6 flex flex-col gap-4">

        {/* ── Header card ── */}
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>
                Project
              </div>
              <h1 className="text-lg font-mono font-bold" style={{ color: '#d6d3d1' }}>
                {project.title}
              </h1>
              {project.description && (
                <p className="text-[11px] font-mono mt-1 leading-relaxed" style={{ color: '#a8a29e' }}>
                  {project.description}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              <StatusPill status={project.status} />
              <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>
                {project.budget_currency || 'USD'}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            <Stat icon={Layers} label="Phases" value={phases.length} />
            <Stat icon={Boxes}  label="Assets" value={assets.length} />
            <Stat icon={ListChecks} label="Tasks" value={tasks.length} />
            <Stat icon={DollarSign} label="Budget" value={fmtMoney(budget.total, budget.currency)} />
          </div>
          {/* Project folder path */}
          <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid #44403c' }}>
            <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#fb923c' }} />
            <span className="text-[10px] font-mono uppercase tracking-wider flex-shrink-0" style={{ color: '#78716c' }}>
              Folder:
            </span>
            {project.folder_root ? (
              <>
                <span className="text-[10px] font-mono truncate" style={{ color: '#a8a29e' }}>
                  {project.folder_root}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    window.electronAPI?.rabbit?.openInExplorer?.({ filePath: project.folder_root })
                  }}
                  className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm hover:bg-stone-700 flex-shrink-0"
                  style={{ color: '#fb923c', border: '1px solid #44403c' }}
                >
                  Open
                </button>
              </>
            ) : (
              <span className="text-[10px] font-mono italic" style={{ color: '#57534e' }}>
                Using default location
              </span>
            )}
            <button
              type="button"
              onClick={async () => {
                const api = window.electronAPI?.rabbit
                if (!api?.pickDirectory) return
                const dir = await api.pickDirectory()
                if (!dir) return
                // Set project-level folder_root
                const projectSlug = project.folder_slug || project.title?.trim().replace(/[^a-zA-Z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('-') || 'Untitled'
                const folderRoot = dir + '\\' + projectSlug
                await api.ensureProjectFolder({ rootDir: dir, projectSlug })
                ctx?.updateProject?.(project.id, { folder_root: folderRoot })
              }}
              className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm hover:bg-stone-700 flex-shrink-0"
              style={{ color: '#a8a29e', border: '1px solid #44403c' }}
            >
              Change
            </button>
          </div>
        </Card>

        {/* ── Phase strip ── */}
        <Card title="Phases" icon={Layers}>
          {phases.length === 0 ? (
            <Empty>No phases yet — run the intake wizard or add one from the Assets tab.</Empty>
          ) : (
            <div className="flex flex-wrap gap-2">
              {phases
                .slice()
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((p, i) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-sm"
                    style={{
                      backgroundColor: '#1c1917',
                      border: '1px solid #44403c',
                    }}
                  >
                    <span className="text-[10px] font-mono font-bold" style={{ color: '#ea580c' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-xs font-mono" style={{ color: '#d6d3d1' }}>{p.name}</span>
                    <span className="text-[10px] font-mono" style={{ color: '#a8a29e' }}>
                      · {phaseAssetCounts[p.id] || 0} asset{phaseAssetCounts[p.id] === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              {phaseAssetCounts['__unphased__'] > 0 && (
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-sm"
                  style={{
                    backgroundColor: '#1c1917',
                    border: '1px dashed #57534e',
                  }}
                >
                  <span className="text-xs font-mono italic" style={{ color: '#a8a29e' }}>
                    Unphased · {phaseAssetCounts['__unphased__']} asset
                    {phaseAssetCounts['__unphased__'] === 1 ? '' : 's'}
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* ── Next up + At risk side by side ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Next up" icon={Clock}>
            {nextUp.length === 0 ? (
              <Empty>Nothing waiting in the queue.</Empty>
            ) : (
              <div className="flex flex-col">
                {nextUp.map(t => (
                  <ListRow
                    key={t.id}
                    title={t.title}
                    tag={t.priority || 'med'}
                    hint={t.assigned_position || t.assigned_role_slug || null}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card title="At risk" icon={AlertTriangle}>
            {atRisk.length === 0 ? (
              <Empty>No blockers — keep it that way.</Empty>
            ) : (
              <div className="flex flex-col">
                {atRisk.map((r, i) => (
                  <ListRow
                    key={`${r.kind}-${r.id}-${i}`}
                    title={r.label}
                    tag={r.kind}
                    hint={r.hint}
                    danger
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── Budget snapshot ── */}
        <Card title="Budget snapshot" icon={DollarSign}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <BudgetTile
              label="Bid days"
              value={variance.bid.toFixed(1)}
              hint={`${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
            />
            <BudgetTile
              label="Logged days"
              value={variance.logged.toFixed(1)}
              hint={`${variance.logged > 0 ? Math.round((variance.logged / Math.max(variance.bid, 1)) * 100) : 0}% of bid`}
            />
            <BudgetTile
              label="Variance"
              value={(variance.variance > 0 ? '+' : '') + variance.variance.toFixed(1)}
              hint={variance.variance > 0 ? 'Over' : variance.variance < 0 ? 'Under' : 'On target'}
              tone={variance.variance > 0 ? 'danger' : variance.variance < 0 ? 'good' : 'neutral'}
            />
          </div>
          {Object.keys(budget.byRole).length > 0 && (
            <div className="mt-4 flex flex-col gap-1">
              <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#fb923c' }}>
                By role
              </div>
              {Object.values(budget.byRole)
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 6)
                .map(row => (
                  <div
                    key={row.role}
                    className="flex items-center justify-between text-[11px] font-mono px-2 py-1 rounded-sm"
                    style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}
                  >
                    <span style={{ color: '#d6d3d1' }}>{row.role}</span>
                    <span style={{ color: '#a8a29e' }}>
                      {row.days} d · {fmtMoney(row.cost, budget.currency)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </Card>

        {/* ── All projects gallery ── */}
        <Card title="All projects" icon={LayoutGrid}>
          {allProjects.length === 0 ? (
            <Empty>No other projects yet.</Empty>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {allProjects.map(p => (
                <ProjectMiniCard
                  key={p.id}
                  project={p}
                  active={p.id === activeProjectId}
                  onClick={() => setActiveProject?.(p.id)}
                />
              ))}
            </div>
          )}
        </Card>

      </div>
    </div>
  )
}

// ─── Project mini card (used by the gallery section) ───
function ProjectMiniCard({ project, active, onClick }) {
  const status = project.status || 'draft'
  const statusColor =
    status === 'active'   ? '#15803d' :
    status === 'archived' ? '#57534e' :
    status === 'wrapped'  ? '#15803d' :
    '#ea580c'
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left flex flex-col gap-2 p-3 rounded-sm transition-all hover:scale-[1.02]"
      style={{
        backgroundColor: '#1c1917',
        border: `1px solid ${active ? '#ea580c' : '#44403c'}`,
        boxShadow: active ? '0 0 0 1px #ea580c' : 'none',
      }}
    >
      <div className="flex items-start gap-2">
        {active
          ? <Check className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: '#fb923c' }} />
          : <Folder className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: '#78716c' }} />}
        <span
          className="flex-1 text-[11px] font-mono font-bold truncate"
          style={{ color: active ? '#fb923c' : '#d6d3d1' }}
        >
          {project.title || 'Untitled'}
        </span>
        <span
          className="px-1 py-0.5 text-[8px] font-mono uppercase tracking-wider rounded-sm flex-shrink-0"
          style={{
            color: '#fff7ed',
            backgroundColor: statusColor,
            border: `1px solid ${statusColor}`,
          }}
        >
          {status}
        </span>
      </div>
      {project.description && (
        <p
          className="text-[9px] font-mono leading-relaxed line-clamp-2"
          style={{ color: '#a8a29e' }}
        >
          {project.description}
        </p>
      )}
    </button>
  )
}

// ─── Sub-components ───
function Card({ title, icon: Icon, children }) {
  return (
    <div className="rounded-sm p-4" style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}>
      {title && (
        <div className="flex items-center gap-2 mb-3">
          {Icon && <Icon className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />}
          <h3 className="text-[11px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>
            {title}
          </h3>
        </div>
      )}
      {children}
    </div>
  )
}

function StatusPill({ status }) {
  const color = status === 'active' ? '#15803d' : status === 'archived' ? '#57534e' : '#ea580c'
  return (
    <span
      className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm"
      style={{ color: '#fff7ed', backgroundColor: color, border: `1px solid ${color}` }}
    >
      {status || 'draft'}
    </span>
  )
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-sm"
      style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#fb923c' }} />
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-[13px] font-mono font-bold truncate" style={{ color: '#d6d3d1' }}>{value}</span>
        <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>{label}</span>
      </div>
    </div>
  )
}

function ListRow({ title, tag, hint, danger }) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5"
      style={{ borderBottom: '1px solid #1c1917' }}
    >
      <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: danger ? '#fca5a5' : '#a8a29e' }} />
      <span className="flex-1 text-xs font-mono truncate" style={{ color: '#d6d3d1' }}>{title}</span>
      {hint && (
        <span className="text-[10px] font-mono italic truncate max-w-[120px]" style={{ color: '#78716c' }}>
          {hint}
        </span>
      )}
      {tag && (
        <span
          className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm"
          style={{
            color: danger ? '#fff7ed' : '#fb923c',
            backgroundColor: danger ? '#7f1d1d' : '#1c1917',
            border: `1px solid ${danger ? '#991b1b' : '#57534e'}`,
          }}
        >
          {tag}
        </span>
      )}
    </div>
  )
}

function BudgetTile({ label, value, hint, tone = 'neutral' }) {
  const colors = {
    good:    { bg: '#1c1917', border: '#15803d', text: '#86efac' },
    danger:  { bg: '#1c1917', border: '#7f1d1d', text: '#fca5a5' },
    neutral: { bg: '#1c1917', border: '#44403c', text: '#d6d3d1' },
  }[tone]
  return (
    <div
      className="flex flex-col px-3 py-2 rounded-sm"
      style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}
    >
      <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#a8a29e' }}>
        {label}
      </span>
      <span className="text-lg font-mono font-bold" style={{ color: colors.text }}>{value}</span>
      {hint && (
        <span className="text-[10px] font-mono" style={{ color: '#78716c' }}>{hint}</span>
      )}
    </div>
  )
}

function Empty({ children }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono italic" style={{ color: '#78716c' }}>
      <FileText className="w-3 h-3" />
      {children}
    </div>
  )
}

function fmtMoney(n, currency) {
  if (n == null || isNaN(n)) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${currency || ''} ${Math.round(n)}`
  }
}
