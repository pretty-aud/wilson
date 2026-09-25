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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Clock, DollarSign, Layers, ChevronRight, ChevronDown, FileText, Folder, Check, LayoutGrid, FolderOpen, Settings, LayoutDashboard, Film, Sparkles, Upload, Gamepad2, Plus, FolderSearch,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import '../rabbitShell.css'
import { Switch } from '../../../ui/Switch'
import { StatusDot, statusMeta } from '../../../ui/StatusDot'
import { Button } from '../../../ui/Button'
import { EmptyState } from '../../../ui/EmptyState'
import { Card as KitCard } from '../../../ui/Card'
import { Stat } from '../../../ui/Stat'
import { StatusBadge } from '../../../ui/StatusBadge'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import { usePermissions } from '../../../permissions/usePermissions'
import { canSeeProjectMoney, canOnProject, canSetProjectFolder, projectFolderDeniedReason } from '../../../permissions/projectRoleMatrix'
import GatedAction from '../../../permissions/GatedAction'
import { formatShotCode } from '../entityNaming'
import { loadRabbitSettings, DEFAULT_PROJECT_TYPE_TEMPLATES } from './TimelineView'
import ProjectFilesTable from '../components/ProjectFilesTable'
import RelinkDialog from '../components/RelinkDialog'
import FileAuditDrawer from '../components/FileAuditDrawer'

const PRIORITY_RANK = { crit: 4, critical: 4, high: 3, med: 2, medium: 2, low: 1 }
const RISK_STATES = new Set(['blocked', 'on_hold'])

// Session 35: the ONE pick-and-set flow behind both "Change" folder buttons
// (the summary header's and the Control Panel's Files & Storage field —
// they diverged only by accident before). Desktop-only: it needs the OS
// directory picker, which is why both call sites render the button only when
// the bridge is present (design §5f — folder management is a desktop feature).
//
// 🚨 WRITE FIRST, then create the directory (S35 review). The authoritative
// refusal is the write itself — folderRootRefusal on the local Express route,
// or fn_project_folder_root_guard (0049) in cloud, which can refuse on the
// SEAT or on "no byos drive" for reasons the local IPC preflight cannot see.
// Creating the folder before the write left a stray empty directory whenever
// the local rule and the cloud rule diverged. So: write, and only on success
// materialise the directory (ensureProjectFolder re-runs the containment in
// depth and is idempotent). Returns { ok, cancelled?, error? }.
async function pickAndSetProjectFolder(ctx, project) {
  const api = window.electronAPI?.rabbit
  if (!api?.pickDirectory) return { ok: true, cancelled: true }
  const dir = await api.pickDirectory()
  if (!dir) return { ok: true, cancelled: true }
  const projectSlug = project?.folder_slug
    || project?.title?.trim().replace(/[^a-zA-Z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('-')
    || 'Untitled'
  // Strip any trailing separator on the picked dir before joining — a drive
  // root ('E:\') would otherwise produce 'E:\\Slug', a doubled separator the
  // 0049 canonical-form check refuses.
  const folderRoot = String(dir).replace(/[\\/]+$/, '') + '\\' + projectSlug
  try {
    // Authoritative write. The local route re-canonicalises and stores; the
    // cloud guard refuses on seat / containment / no-drive. A refusal rejects
    // here and NOTHING is created on disk.
    await ctx?.updateProject?.(project.id, { folder_root: folderRoot })
    // The write landed → create the directory. Same refusal again (depth),
    // idempotent, and its non-throwing { ok:false } is surfaced too.
    const ensured = await api.ensureProjectFolder?.({ rootDir: dir, projectSlug })
    if (ensured && ensured.ok === false) return { ok: false, error: ensured.error }
    return { ok: true }
  } catch (err) {
    // The refusal sentence from the Express 400 (local) or the 0049 guard
    // (cloud) arrives here — surfacing it is the point. A swallowed refusal
    // is the S30 green-tick-over-a-write-that-never-happened shape.
    return { ok: false, error: err?.message || String(err) }
  }
}

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
  const createProject    = ctx?.createProject
  const tm = useTeamMembers()
  const perms = usePermissions()
  const [showSettings, setShowSettings] = useState(false)
  const [creating, setCreating] = useState(false)

  // Session 25. Audrey, 2026-08-04: "the producer manager should be the only
  // one to see the budget section. the rest is fine." So the Project Control
  // Panel stays reachable by everyone who can open the project, and only the
  // Budget Variables block inside it is gated.
  //
  // Same predicate as the Budget TAB (Rabbit.jsx:78) and the same one that
  // mirrors can_access_project_money() in SQL, so the client and the database
  // agree about who money belongs to. It fails CLOSED: the block appears a
  // beat late for a manager rather than being shown to a member and snatched
  // back. RLS is still the authority — this only stops showing a control that
  // would write a value the database will refuse.
  const canSeeMoney = canSeeProjectMoney({
    appRole: perms?.role,
    projectRole: ctx?.myProjectRole,
  })

  // Session 25. Audrey, 2026-08-04: "managers and reviewers should be able to
  // see and press the button and open the control panel … basic team members
  // do not need access to the panel at all."
  //
  // Gated in TWO places below, not one: the button that opens it AND the
  // branch that renders it. She asked for no ACCESS, not a missing link — and
  // `setShowSettings(true)` has a second caller (handleNewProject, :124), so
  // gating only the button would still let the panel open by another route.
  //
  // `ready` is passed so a session still resolving reads as "not yet known"
  // rather than "denied" — otherwise a manager whose getSession() hangs loses
  // the control panel permanently, which is the exact failure shape behind the
  // vanishing-create-button investigation.
  const canOpenControlPanel = canOnProject({
    appRole: perms?.role,
    projectRole: ctx?.myProjectRole,
    isStaffed: ctx?.projectIsStaffed,
    ready: perms?.ready,
  }, 'project.settings.open')

  // A panel that is open when access is lost must not stay open — the same
  // rule Rabbit.jsx:96-98 applies to hidden tabs. Without this, someone
  // already inside the panel when their seat resolves keeps the whole screen
  // mounted with only the button gone.
  useEffect(() => {
    if (!canOpenControlPanel && showSettings) setShowSettings(false)
  }, [canOpenControlPanel, showSettings])

  // Session 35 — Audrey's folder half: "managers can set folders within set
  // drive." In CLOUD mode, workspace admin/manager only (the 0049 seat); in
  // local/solo mode (no workspaceId) the route contains and the seat does not
  // apply. Greyed-with-reason, never hidden (S29 rule), and the handler
  // refuses independently of the rendering. The Change button itself renders
  // only on desktop (the OS picker is desktop-only, §5f).
  const folderGateCtx = { appRole: perms?.role, workspaceId: perms?.workspaceId, ready: perms?.ready }
  const canSetFolder = canSetProjectFolder(folderGateCtx)
  const folderReason = projectFolderDeniedReason(folderGateCtx)
  const canPickFolder = !!(typeof window !== 'undefined' && window.electronAPI?.rabbit?.pickDirectory)
  const [folderMsg, setFolderMsg] = useState(null)
  // A refusal names the project whose pick was rejected — clear it on switch,
  // or it renders under a different project's folder row (S35 review).
  useEffect(() => { setFolderMsg(null) }, [project?.id])

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

  async function handleNewProject() {
    if (creating) return
    setCreating(true)
    try {
      const created = await createProject?.({ title: 'Untitled Project' })
      if (created?.id) {
        setActiveProject?.(created.id)
        setShowSettings(true) // Open control panel so user can set title/type
      }
    } catch (err) { console.error('Failed to create project:', err) }
    finally { setCreating(false) }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-paper)' }}>
        <span className="text-label uppercase" style={{ color: 'var(--color-ink-2)' }}>
          Loading project…
        </span>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="h-full overflow-auto" style={{ backgroundColor: 'var(--color-paper)' }}>
        <div className="p-6 flex flex-col gap-4">
          <Card title="All projects" icon={LayoutGrid}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-label font-mono uppercase" style={{ color: 'var(--color-ink-3)' }}>
                {allProjects.length} project{allProjects.length !== 1 ? 's' : ''}
              </span>
              <button type="button" onClick={handleNewProject} disabled={creating}
                className="ui-btn" data-variant="primary" data-size="sm" data-surface="dark">
                <Plus aria-hidden="true" />
                {creating ? 'Creating…' : 'New project'}
              </button>
            </div>
            {allProjects.length === 0 ? (
              <Empty>No projects yet — click New project above or use the Intake tab.</Empty>
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
    <div className="h-full overflow-auto" style={{ backgroundColor: 'var(--color-paper)' }}>
      <div className="p-6 flex flex-col gap-4">

        {showSettings && canOpenControlPanel ? (<>
          {/* ── Back to dashboard bar ── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4" style={{ color: 'var(--color-ink)' }} />
              <span className="text-label uppercase font-semibold" style={{ color: 'var(--color-ink)' }}>
                Project Control Panel
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-control text-dense transition-colors hover:brightness-110"
              style={{ backgroundColor: 'var(--color-paper-raised)', color: 'var(--color-ink-2)', border: '1px solid var(--color-rule)' }}
            >
              <LayoutDashboard className="w-3 h-3" /> Dashboard
            </button>
          </div>
          <ProjectSettingsPanel project={project} ctx={ctx} teamMembers={tm.members || []} canSeeMoney={canSeeMoney} />
        </>) : (<>

        {/* ── All projects gallery strip ── */}
        {/* UX: Hick's Law (scannable cards, minimal choices), Fitts's Law (large click targets), */}
        {/* Miller's Law (key info only — title, client, status, budget), Jakob's Law (familiar card grid) */}
        <div className="rounded-control px-5 py-3.5" style={{ backgroundColor: 'var(--color-paper-recessed)', border: '1px solid var(--color-rule)' }}>
          <div className="flex items-center gap-2.5 mb-3">
            <LayoutGrid className="w-4 h-4" style={{ color: 'var(--color-ink-2)' }} />
            <span className="text-label uppercase font-semibold" style={{ color: 'var(--color-ink-2)' }}>
              Projects
            </span>
            <span className="text-dense font-mono" style={{ color: 'var(--color-ink-3)' }}>
              {allProjects.length}
            </span>
          </div>
          {allProjects.length === 0 ? (
            <span className="text-dense italic" style={{ color: 'var(--color-ink-3)' }}>No projects yet.</span>
          ) : (
            <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--color-scroll-thumb) transparent' }}>
              {allProjects.map(p => {
                const isActive = p.id === activeProjectId
                const st = p.status || 'draft'
                const pType = p.type ? p.type.replace(/_/g, ' ') : null
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActiveProject?.(p.id)}
                    className="rb-gallery-card flex-shrink-0 flex flex-col gap-1.5 px-3.5 py-2.5 rounded-control transition-[filter] hover:brightness-110"
                    data-active={isActive ? 'true' : undefined}
                    style={{ width: 180 }}
                  >
                    {/* Title */}
                    <div className="flex items-center gap-2 w-full">
                      <span className="rb-gallery-title flex-1 text-dense font-semibold truncate text-left">
                        {p.title || 'Untitled'}
                      </span>
                      <StatusDot status={st} />
                    </div>
                    {/* Client + type */}
                    <div className="flex items-center justify-between w-full">
                      <span className="text-dense truncate" style={{ color: 'var(--color-ink-3)' }}>
                        {p.client_name || '—'}
                      </span>
                      {pType && (
                        <span className="text-label uppercase flex-shrink-0" style={{ color: 'var(--color-ink-3)' }}>
                          {pType}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Header card ── */}
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-label uppercase" style={{ color: 'var(--color-ink)' }}>
                Project
              </div>
              <h1 className="text-h1 font-semibold" style={{ color: 'var(--color-ink)' }}>
                {project.title}
              </h1>
              {project.description && (
                <p className="text-dense mt-1.5" style={{ color: 'var(--color-ink-2)' }}>
                  {project.description}
                </p>
              )}
              {/* Status + dates row */}
              <div className="flex items-center gap-3 mt-2.5">
                <StatusDropdown status={project.status} onChange={v => ctx?.updateProject?.(project.id, { status: v })} />
                {project.start_date && (
                  <span className="text-caption font-mono" style={{ color: 'var(--color-ink-3)' }}>
                    {new Date(project.start_date + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
                {project.start_date && project.end_date && (
                  <span className="text-caption" style={{ color: 'var(--color-ink-3)' }}>—</span>
                )}
                {project.end_date && (
                  <span className="text-caption font-mono" style={{ color: 'var(--color-ink-3)' }}>
                    {new Date(project.end_date + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
              </div>
              {/* Director / Producer */}
              {(project.director_id || project.producer_id) && (
                <div className="flex items-center gap-4 mt-2">
                  {project.director_id && (() => {
                    const d = (tm.members || []).find(m => m.id === project.director_id)
                    return (
                      <div className="flex items-center gap-1.5">
                        <Film className="w-3 h-3" style={{ color: 'var(--color-ink)' }} />
                        <span className="text-label uppercase" style={{ color: 'var(--color-ink-3)' }}>Director</span>
                        <span className="text-dense" style={{ color: 'var(--color-ink)' }}>{d?.name || '—'}</span>
                      </div>
                    )
                  })()}
                  {project.producer_id && (() => {
                    const p = (tm.members || []).find(m => m.id === project.producer_id)
                    return (
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3" style={{ color: 'var(--color-ink)' }} />
                        <span className="text-label uppercase" style={{ color: 'var(--color-ink-3)' }}>Producer</span>
                        <span className="text-dense" style={{ color: 'var(--color-ink)' }}>{p?.name || '—'}</span>
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
            {canOpenControlPanel && (
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-control text-dense transition-colors hover:brightness-110 flex-shrink-0"
                style={{ backgroundColor: 'var(--color-paper-raised)', color: 'var(--color-ink-2)', border: '1px solid var(--color-rule)' }}
              >
                <Settings className="w-3 h-3" /> Control Panel
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            <Stat className="rb-stat-tile" label="Phases" value={phases.length} />
            <Stat className="rb-stat-tile" label="Assets" value={assets.length} />
            <Stat className="rb-stat-tile" label="Tasks" value={tasks.length} />
            <Stat className="rb-stat-tile" label="Budget" value={fmtMoney(budget.total, budget.currency)} />
          </div>
          {/* Project folder path */}
          <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--color-rule)' }}>
            <FolderOpen className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-ink)' }} />
            <span className="text-label uppercase flex-shrink-0" style={{ color: 'var(--color-ink-3)' }}>
              Folder:
            </span>
            {project.folder_root ? (
              <>
                <span className="text-dense font-mono truncate" style={{ color: 'var(--color-ink-2)' }}>
                  {project.folder_root}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    window.electronAPI?.rabbit?.openInExplorer?.({ filePath: project.folder_root })
                  }}
                  className="text-dense px-2 py-0.5 rounded-control hover:bg-hover flex-shrink-0"
                  style={{ color: 'var(--color-ink)', border: '1px solid var(--color-rule)' }}
                >
                  Open
                </button>
              </>
            ) : (
              <span className="text-dense italic" style={{ color: 'var(--color-ink-3)' }}>
                Using default location
              </span>
            )}
            {canPickFolder && (
              <GatedAction allowed={canSetFolder} reason={folderReason}>
                <button
                  type="button"
                  onClick={async () => {
                    if (!canSetFolder) return
                    setFolderMsg(null)
                    const res = await pickAndSetProjectFolder(ctx, project)
                    if (!res.ok && res.error) setFolderMsg(res.error)
                  }}
                  className="text-dense px-2 py-0.5 rounded-control hover:bg-hover flex-shrink-0"
                  style={{ color: 'var(--color-ink-2)', border: '1px solid var(--color-rule)' }}
                >
                  Change
                </button>
              </GatedAction>
            )}
          </div>
          {folderMsg && (
            <p className="text-dense mt-1.5" style={{ color: 'var(--color-danger)' }}>
              {folderMsg}
            </p>
          )}
        </Card>

        {/* ── Project files ── */}
        {(() => {
          const allProjFiles = [...(ctx?.files || []), ...(ctx?.managedFiles || [])]
          if (allProjFiles.length === 0) return null
          return (
            <Card title="Project files" icon={FileText}>
              <ProjectFilesTable files={allProjFiles} readOnly maxHeight={220} />
            </Card>
          )
        })()}

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
                    className="flex items-center gap-2 px-3 py-1.5 rounded-control"
                    style={{
                      backgroundColor: 'var(--color-paper)',
                      border: '1px solid var(--color-rule)',
                    }}
                  >
                    <span className="text-dense font-mono font-semibold" style={{ color: 'var(--color-ink)' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-dense" style={{ color: 'var(--color-ink)' }}>{p.name}</span>
                    <span className="text-dense font-mono" style={{ color: 'var(--color-ink-2)' }}>
                      · {phaseAssetCounts[p.id] || 0} asset{phaseAssetCounts[p.id] === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              {phaseAssetCounts['__unphased__'] > 0 && (
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-control"
                  style={{
                    backgroundColor: 'var(--color-paper)',
                    border: '1px dashed var(--color-rule)',
                  }}
                >
                  <span className="text-dense italic" style={{ color: 'var(--color-ink-2)' }}>
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
              <div className="text-label uppercase" style={{ color: 'var(--color-ink)' }}>
                By role
              </div>
              {Object.values(budget.byRole)
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 6)
                .map(row => (
                  <div
                    key={row.role}
                    className="flex items-center justify-between text-dense font-mono tabular-nums px-2.5 py-1.5 rounded-control"
                    style={{ backgroundColor: 'var(--color-paper)', border: '1px solid var(--color-rule)' }}
                  >
                    <span style={{ color: 'var(--color-ink)' }}>{row.role}</span>
                    <span style={{ color: 'var(--color-ink-2)' }}>
                      {row.days} d · {fmtMoney(row.cost, budget.currency)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </Card>


        </>)}
      </div>
    </div>
  )
}

// ─── Project Settings Panel ───────────────────────────────
// UX Laws applied:
//   Jakob's Law     — form layout matches familiar settings pages
//   Hick's Law      — constrained dropdown choices, no open text for enums
//   Fitts's Law     — large touch targets, full-width inputs
//   Proximity       — related fields grouped in labeled sections
//   Progressive Disclosure — sections are visually separated, not overwhelming

const STATUS_OPTIONS  = ['draft', 'active', 'on_hold', 'wrapped', 'archived']
const TYPE_OPTIONS    = ['commercial', 'film', 'series', 'music_video', 'branded_content', 'social', 'animation', 'documentary', 'video_game', 'interactive_experience', 'experiential_activation', 'other']
const TIER_OPTIONS    = ['micro', 'small', 'mid', 'large', 'enterprise']
const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'NZD']
const ACTUALS_MODE_OPTIONS = ['fortnightly', 'weekly', 'count']


function ProjectSettingsPanel({ project, ctx, teamMembers = [], canSeeMoney = false }) {
  const update = useCallback((field, value) => {
    ctx?.updateProject?.(project.id, { [field]: value })
  }, [ctx, project?.id])

  // When the project type changes, auto-apply database toggle
  // defaults from the system settings templates.
  const handleTypeChange = useCallback((newType) => {
    const settings = loadRabbitSettings()
    const tpl = settings.projectTypeTemplates?.[newType] || DEFAULT_PROJECT_TYPE_TEMPLATES[newType]
    const patch = { project_type: newType }
    if (tpl) {
      if (tpl.scenes_enabled !== undefined) patch.scenes_enabled = tpl.scenes_enabled
      if (tpl.levels_enabled !== undefined) patch.levels_enabled = tpl.levels_enabled
      if (tpl.experiences_enabled !== undefined) patch.experiences_enabled = tpl.experiences_enabled
      if (tpl.uses_realtime_engine !== undefined) patch.uses_realtime_engine = tpl.uses_realtime_engine
    }
    ctx?.updateProject?.(project.id, patch)
  }, [ctx, project?.id])

  const files = ctx?.files || []
  const managedFiles = ctx?.managedFiles || []

  return (
    <div className="flex flex-col gap-6">

      {/* ── Project header + classification + dates ── */}
      <div className="rounded-control overflow-hidden" style={{ border: '1px solid var(--color-rule)' }}>
        <div className="px-6 py-5" style={{ backgroundColor: 'var(--color-paper-raised)', borderBottom: '1px solid var(--color-rule)' }}>
          <div className="flex items-center gap-3 mb-1">
            <StatusDot status={project.status || 'draft'} />
            <span className="text-label uppercase" style={{ color: 'var(--color-ink-3)' }}>
              {project.status || 'draft'} / {project.project_type?.replace(/_/g, ' ') || 'untyped'} / {project.project_tier || 'untiered'}
            </span>
          </div>
          <h2 className="text-h1 font-semibold mt-3" style={{ color: 'var(--color-ink)' }}>
            {project.title || 'Untitled Project'}
          </h2>
          {project.description && (
            <p className="text-dense mt-1.5" style={{ color: 'var(--color-ink-2)' }}>
              {project.description}
            </p>
          )}
        </div>
        <div className="px-6 py-4 flex flex-col gap-4" style={{ backgroundColor: 'var(--color-paper)' }}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SettingsField label="Project name">
              <SettingsInput value={project.title || ''} onChange={v => update('title', v)} placeholder="Project title" size="lg" />
            </SettingsField>
            <SettingsField label="Client / Studio">
              <SettingsInput value={project.client_name || ''} onChange={v => update('client_name', v)} placeholder="Client or studio name" size="lg" />
            </SettingsField>
          </div>
          <SettingsField label="Description">
            <SettingsTextarea value={project.description || ''} onChange={v => update('description', v)} placeholder="Brief project description" />
          </SettingsField>
          <SettingsField label="Status tag" hint="Custom label shown on project cards">
            <SettingsInput value={project.status_tag || ''} onChange={v => update('status_tag', v)} placeholder="e.g. Awaiting client approval" />
          </SettingsField>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SettingsField label="Director">
              <SettingsSelect
                value={project.director_id || ''}
                options={teamMembers.map(m => m.id)}
                labels={teamMembers.map(m => m.name + (m.title ? ` — ${m.title}` : ''))}
                onChange={v => update('director_id', v)}
                allowEmpty="Select director..."
              />
            </SettingsField>
            <SettingsField label="Producer">
              <SettingsSelect
                value={project.producer_id || ''}
                options={teamMembers.map(m => m.id)}
                labels={teamMembers.map(m => m.name + (m.title ? ` — ${m.title}` : ''))}
                onChange={v => update('producer_id', v)}
                allowEmpty="Select producer..."
              />
            </SettingsField>
          </div>
          <div className="pt-3 mt-1" style={{ borderTop: '1px solid var(--color-rule)' }}>
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
              <SettingsField label="Project code">
                <SettingsInput value={project.project_code || ''} onChange={v => update('project_code', v)} placeholder="PROJ" />
              </SettingsField>
              <SettingsField label="Status">
                <SettingsSelect value={project.status || 'draft'} options={STATUS_OPTIONS} onChange={v => update('status', v)} />
              </SettingsField>
              <SettingsField label="Type">
                <SettingsSelect value={project.project_type || ''} options={TYPE_OPTIONS} onChange={handleTypeChange} allowEmpty="Select" />
              </SettingsField>
              <SettingsField label="Tier">
                <SettingsSelect value={project.project_tier || ''} options={TIER_OPTIONS} onChange={v => update('project_tier', v)} allowEmpty="Select" />
              </SettingsField>
              <SettingsField label="Start date">
                <SettingsDateInput value={project.start_date || ''} onChange={v => update('start_date', v)} />
              </SettingsField>
              <SettingsField label="End date">
                <SettingsDateInput value={project.end_date || ''} onChange={v => update('end_date', v)} />
              </SettingsField>
            </div>
            {/* ── Real-time engine toggle (linked with Levels) ── */}
            <div className="flex items-center justify-between px-3 py-2.5 mt-3 rounded-control" style={{ backgroundColor: 'var(--color-paper)', border: '1px solid var(--color-rule)' }}>
              <span className="text-dense" style={{ color: 'var(--color-ink-2)' }}>Uses real-time engine</span>
              <SettingsToggle label="Realtime engine" checked={project.uses_realtime_engine} onChange={v => {
                update('uses_realtime_engine', v)
                // Sync: realtime engine on → levels on, realtime engine off → levels off
                update('levels_enabled', v)
              }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Budget + Files & Storage ──
          Session 25: the Budget block is manager/admin only. When it is
          hidden the grid collapses to one column rather than leaving a blank
          half — an empty column reads as a broken layout, which is how a
          permission boundary gets reported as a bug. */}
      <div className={canSeeMoney ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : 'grid grid-cols-1 gap-6'}>

        {/* LEFT: Budget — money is manager-only (Audrey, 2026-08-04) */}
        {canSeeMoney && (
        <SettingsSection title="Budget variables" icon={DollarSign}>
          <div className="grid grid-cols-2 gap-3">
            <SettingsField label="Currency">
              <SettingsSelect value={project.budget_currency || 'USD'} options={CURRENCY_OPTIONS} onChange={v => update('budget_currency', v)} />
            </SettingsField>
            <SettingsField label="Targeted budget total">
              <SettingsNumberInput value={project.budget_total ?? ''} onChange={v => update('budget_total', v === '' ? null : Number(v))} placeholder="0" />
            </SettingsField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <SettingsField label="Margin %">
              <SettingsNumberInput value={project.budget_margin_pct ?? ''} onChange={v => update('budget_margin_pct', v === '' ? 0 : Number(v))} placeholder="0" />
            </SettingsField>
            <SettingsField label="Contingency %">
              <SettingsNumberInput value={project.budget_contingency_pct ?? ''} onChange={v => update('budget_contingency_pct', v === '' ? 0 : Number(v))} placeholder="0" />
            </SettingsField>
            <SettingsField label="Agency %">
              <SettingsNumberInput value={project.budget_agency_pct ?? ''} onChange={v => update('budget_agency_pct', v === '' ? 0 : Number(v))} placeholder="20" />
            </SettingsField>
          </div>
          <div className="flex items-center justify-between px-3 py-2.5 rounded-control" style={{ backgroundColor: 'var(--color-paper)', border: '1px solid var(--color-rule)' }}>
            <span className="text-dense" style={{ color: 'var(--color-ink-2)' }}>Agency fee</span>
            <SettingsToggle label="Agency fees" checked={project.budget_agency_enabled} onChange={v => update('budget_agency_enabled', v)} />
          </div>
          {/* ── Actuals columns ── */}
          <div style={{ borderTop: '1px solid var(--color-rule)' }} />
          <div className="grid grid-cols-2 gap-3">
            <SettingsField label="Actuals column mode">
              <SettingsSelect
                value={project.budget_actual_column_mode || 'fortnightly'}
                options={ACTUALS_MODE_OPTIONS}
                onChange={v => update('budget_actual_column_mode', v)}
              />
            </SettingsField>
            <SettingsField label="Number of columns">
              <SettingsNumberInput
                value={project.budget_actual_column_count ?? 20}
                onChange={v => {
                  const n = parseInt(v, 10)
                  if (Number.isFinite(n) && n > 0 && n <= 100) update('budget_actual_column_count', n)
                }}
                placeholder="20"
              />
            </SettingsField>
          </div>
        </SettingsSection>
        )}

        {/* RIGHT: Files & Storage */}
        <ProjectFilesSection files={files} managedFiles={managedFiles} ctx={ctx} project={project} update={update} />
      </div>

      {/* ── Toggleable database modules (row of 3) ── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Scenes & Shots */}
        <div className="rb-module rounded-control overflow-hidden flex flex-col" data-enabled={project.scenes_enabled ? 'true' : undefined} style={{
          transition: 'opacity 150ms ease, border-color 150ms ease',
        }}>
          <div className="rb-module-head flex items-center gap-2 px-4 py-3">
            <Film className="rb-module-accent w-3.5 h-3.5" />
            <span className="rb-module-accent text-label uppercase font-semibold flex-1">
              Scenes & Shots
            </span>
            <SettingsToggle label="Scenes and shots" checked={project.scenes_enabled} onChange={v => update('scenes_enabled', v)} />
          </div>
          {project.scenes_enabled && (
            <div className="flex flex-col gap-3 p-4">
              <span className="text-label uppercase font-semibold" style={{ color: 'var(--color-ink-3)' }}>Naming conventions</span>
              <div className="grid grid-cols-2 gap-3">
                <SettingsField label="Scene digits">
                  <SettingsNumberInput value={project.scene_digits ?? 3} onChange={v => { const n = parseInt(v, 10); if (Number.isFinite(n) && n >= 1 && n <= 5) update('scene_digits', n) }} placeholder="3" min={1} max={5} />
                </SettingsField>
                <SettingsField label="Shot digits">
                  <SettingsNumberInput value={project.shot_digits ?? 4} onChange={v => { const n = parseInt(v, 10); if (Number.isFinite(n) && n >= 1 && n <= 5) update('shot_digits', n) }} placeholder="4" min={1} max={5} />
                </SettingsField>
                <SettingsField label="Separator">
                  <SettingsSelect value={project.scene_separator || '_'} options={['_', '-', '.']} onChange={v => update('scene_separator', v)} />
                </SettingsField>
                <SettingsField label="Numbering start">
                  <SettingsNumberInput value={project.scene_start_number ?? 1} onChange={v => { const n = parseInt(v, 10); if (Number.isFinite(n) && n >= 0) update('scene_start_number', n) }} placeholder="1" />
                </SettingsField>
              </div>
              {/* Naming preview */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-control" style={{ backgroundColor: 'var(--color-paper-recessed)', border: '1px solid var(--color-rule)' }}>
                <span className="text-label uppercase" style={{ color: 'var(--color-ink-3)' }}>Preview:</span>
                <span className="text-dense font-mono font-semibold" style={{ color: 'var(--color-ink)' }}>
                  {/* Session 25: built by the SAME function the Scenes view
                      names with (../entityNaming), so the preview cannot
                      drift from what the New Shot button actually produces.
                      It previews the first shot of the first scene, hence
                      the start number in both positions. */}
                  {formatShotCode(
                    project,
                    project.scene_start_number ?? 1,
                    project.scene_start_number ?? 1,
                  )}
                </span>
              </div>

              <div style={{ height: 1, backgroundColor: 'var(--color-rule)', margin: '4px 0' }} />

              <span className="text-label uppercase font-semibold" style={{ color: 'var(--color-ink-3)' }}>Timing</span>
              <div className="grid grid-cols-2 gap-3">
                <SettingsField label="Frames per second">
                  <SettingsSelect
                    value={String(project.fps || 24)}
                    options={['24', '25', '29.97', '30', '48', '59.94', '60', '120', '240']}
                    labels={['24 fps', '25 fps', '29.97 fps', '30 fps', '48 fps', '59.94 fps', '60 fps', '120 fps', '240 fps']}
                    onChange={v => update('fps', parseFloat(v))}
                  />
                </SettingsField>
              </div>
            </div>
          )}
        </div>

        {/* Levels */}
        <div className="rb-module rounded-control overflow-hidden flex flex-col" data-enabled={project.levels_enabled ? 'true' : undefined} style={{
          transition: 'opacity 150ms ease, border-color 150ms ease',
        }}>
          <div className="rb-module-head flex items-center gap-2 px-4 py-3">
            <Gamepad2 className="rb-module-accent w-3.5 h-3.5" />
            <span className="rb-module-accent text-label uppercase font-semibold flex-1">
              Levels
            </span>
            <SettingsToggle label="Levels" checked={project.levels_enabled} onChange={v => {
              update('levels_enabled', v)
              // Sync: levels on → realtime engine on, levels off → realtime engine off
              update('uses_realtime_engine', v)
            }} />
          </div>
          {project.levels_enabled && (
            <div className="flex flex-col gap-3 p-4">
              <SettingsField label="Engine">
                <SettingsSelect
                  value={project.engine_type || ''}
                  options={['', 'unreal_engine', 'unity', 'godot', 'proprietary']}
                  labels={['--', 'Unreal Engine', 'Unity', 'Godot', 'Proprietary Engine']}
                  onChange={v => update('engine_type', v || null)}
                />
              </SettingsField>
              {project.engine_type === 'proprietary' && (
                <SettingsField label="Proprietary engine name">
                  <SettingsInput
                    value={project.engine_proprietary_name || ''}
                    placeholder="Engine name"
                    onChange={v => update('engine_proprietary_name', v)}
                  />
                </SettingsField>
              )}
              <SettingsField label="Engine version">
                <SettingsInput
                  value={project.engine_version || ''}
                  placeholder="e.g. 5.67"
                  onChange={v => update('engine_version', v)}
                />
              </SettingsField>
              <SettingsField label="File project name">
                <SettingsInput
                  value={project.engine_project_name || ''}
                  placeholder="MyProject"
                  onChange={v => update('engine_project_name', v)}
                />
              </SettingsField>
              <SettingsField label="Repo clone link">
                <SettingsInput
                  value={project.engine_repo_url || ''}
                  placeholder="https://github.com/..."
                  onChange={v => update('engine_repo_url', v)}
                />
              </SettingsField>
            </div>
          )}
        </div>

        {/* Experiences */}
        <div className="rb-module rounded-control overflow-hidden flex flex-col" data-enabled={project.experiences_enabled ? 'true' : undefined} style={{
          transition: 'opacity 150ms ease, border-color 150ms ease',
        }}>
          <div className="rb-module-head flex items-center gap-2 px-4 py-3">
            <Sparkles className="rb-module-accent w-3.5 h-3.5" />
            <span className="rb-module-accent text-label uppercase font-semibold flex-1">
              Experiences
            </span>
            <SettingsToggle label="Experiences" checked={project.experiences_enabled} onChange={v => update('experiences_enabled', v)} />
          </div>
          {project.experiences_enabled && (
            <div className="p-4">
              <p className="text-dense" style={{ color: 'var(--color-ink-2)' }}>
                For physical activations, events, immersive experiences, etc.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function ProjectFilesSection({ files, managedFiles, ctx, project, update }) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const fileInputRef = useRef(null)

  // Session 35: same seat as the summary header's Change button — the two
  // writers must not diverge (they are one column, one flow).
  const perms = usePermissions()
  const folderGateCtx = { appRole: perms?.role, workspaceId: perms?.workspaceId, ready: perms?.ready }
  const canSetFolder = canSetProjectFolder(folderGateCtx)
  const folderReason = projectFolderDeniedReason(folderGateCtx)
  const canPickFolder = !!(typeof window !== 'undefined' && window.electronAPI?.rabbit?.pickDirectory)
  const [folderMsg, setFolderMsg] = useState(null)
  useEffect(() => { setFolderMsg(null) }, [project?.id])

  // ── Session 14: storage relink + per-file activity ──
  // Relink is local_server-only — the provider where folders actually move
  // (supabase bucket paths don't drift, so no false affordance there).
  // getAdapter is the provider's STABLE useCallback — depending on the
  // whole ctx object would re-fire this census on every provider render
  // (each scan is a full server-side existsSync sweep; adversarial
  // review, S14). The seq ref drops out-of-order responses so a slow scan
  // can never overwrite a fresh post-apply count.
  const getAdapter = ctx?.getAdapter
  const relinkSupported = typeof getAdapter?.()?.relinkScan === 'function'
  const [missingCount, setMissingCount] = useState(0)
  const [relinkOpen, setRelinkOpen] = useState(false)
  const [auditFile, setAuditFile] = useState(null)
  const censusSeqRef = useRef(0)

  const refreshMissing = useCallback(async () => {
    if (!relinkSupported || !project?.id) return
    const seq = ++censusSeqRef.current
    try {
      const res = await getAdapter().relinkScan(project.id)
      if (seq === censusSeqRef.current) setMissingCount(res?.missing?.length ?? 0)
    } catch { /* census only — the dialog surfaces real errors */ }
  }, [relinkSupported, getAdapter, project?.id])

  useEffect(() => { refreshMissing() }, [refreshMissing])

  async function handleUpload(e) {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      for (const file of picked) {
        await ctx?.uploadFile?.(file, { type: 'project' })
      }
    } catch (err) {
      // 🚨 A REFUSAL MUST BE READ, NOT LOGGED — see the same fix in
      // BudgetView. Session 37's storage refusals (a workspace on its own
      // server has no cloud upload route; an unreadable storage choice; a
      // bucket the browser was blocked from reaching) each arrive here as a
      // thrown sentence, and this catch used to end their journey in the
      // devtools console where nobody was looking.
      console.error('Upload failed', err)
      setUploadError(err?.message || 'Upload failed.')
    }
    finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDelete(f) {
    try {
      await ctx?.deleteFile?.(f.id)
    } catch (err) { console.error('Delete failed', err) }
  }

  const allFiles = [...(files || []), ...(managedFiles || [])]

  return (
    <SettingsSection title="Files & storage" icon={FolderOpen}>
      {/* ── Folder ── */}
      <SettingsField label="Project folder">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-control min-w-0"
            style={{ backgroundColor: 'var(--color-paper)', border: '1px solid var(--color-rule)' }}>
            <Folder className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-ink-3)' }} />
            <span className="rb-folder-path text-dense font-mono truncate" data-empty={project?.folder_root ? undefined : 'true'}>
              {project?.folder_root || 'Using default location'}
            </span>
          </div>
          {project?.folder_root && (
            <Button size="sm" onClick={() => window.electronAPI?.rabbit?.openInExplorer?.({ filePath: project.folder_root })}>
              Open
            </Button>
          )}
          {canPickFolder && (
            <GatedAction allowed={canSetFolder} reason={folderReason}>
              <button type="button"
                onClick={async () => {
                  if (!canSetFolder) return
                  setFolderMsg(null)
                  const res = await pickAndSetProjectFolder(ctx, project)
                  if (!res.ok && res.error) setFolderMsg(res.error)
                }}
                className="text-dense px-2.5 py-2 rounded-control hover:brightness-125 flex-shrink-0 transition-[filter]"
                style={{ color: 'var(--color-ink-2)', backgroundColor: 'var(--color-paper)', border: '1px solid var(--color-rule)' }}>
                Change
              </button>
            </GatedAction>
          )}
        </div>
        {folderMsg && (
          <p className="text-dense mt-1.5" style={{ color: 'var(--color-danger)' }}>
            {folderMsg}
          </p>
        )}
      </SettingsField>

      {/* Session 14: a relink can move the files home off folder_root —
          surface it (nothing else shows files_dir) with a reset control,
          so a mis-picked folder is recoverable from the app. */}
      {project?.files_dir && (
        <SettingsField label="Files folder (set by relink)">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-control min-w-0"
              style={{ backgroundColor: 'var(--color-paper)', border: '1px solid var(--color-rule)' }}>
              <FolderSearch className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-ink-3)' }} />
              <span className="text-dense font-mono truncate" style={{ color: 'var(--color-ink-2)' }} title={project.files_dir}>
                {project.files_dir}
              </span>
            </div>
            <button type="button"
              onClick={() => { update?.('files_dir', null); refreshMissing() }}
              title="Files resolve from the project folder again; relink afterwards if they moved"
              className="text-dense px-2.5 py-2 rounded-control hover:brightness-125 flex-shrink-0 transition-[filter]"
              style={{ color: 'var(--color-ink-2)', backgroundColor: 'var(--color-paper)', border: '1px solid var(--color-rule)' }}>
              Reset
            </button>
          </div>
        </SettingsField>
      )}

      {/* ── Divider ── */}
      <div style={{ borderTop: '1px solid var(--color-rule)' }} />

      {/* ── Files ── */}
      <div className="flex items-center justify-between">
        <span className="text-label uppercase font-semibold" style={{ color: 'var(--color-ink-3)' }}>Project files</span>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" multiple onChange={handleUpload} className="hidden" />
          {/* R33: the only inverted primary in R.A.B.B.I.T. — and adding
              files is not this panel's primary action — so a secondary. */}
          <Button size="sm" Icon={Upload} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Add files'}
          </Button>
        </div>
      </div>

      {uploadError && (
        <p className="text-dense" style={{ color: 'var(--color-danger)' }}>
          {uploadError}
        </p>
      )}

      {/* Session 14: missing-files banner → the relink flow. Rendered above
          the table so a broken state is impossible to miss (Selective
          Attention); the action sits inside the banner (Fitts's Law). */}
      {relinkSupported && missingCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-control"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 14%, transparent)', border: '1px solid var(--color-rule)' }}>
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-warning)' }} />
          <span className="flex-1 text-dense font-mono tabular-nums" style={{ color: 'var(--color-warning)' }}>
            {missingCount} file{missingCount === 1 ? '' : 's'} can't be found on disk — the folder may have moved.
          </span>
          <button type="button" onClick={() => setRelinkOpen(true)}
            className="ui-btn" data-variant="primary" data-size="sm" data-surface="dark">
            <FolderSearch aria-hidden="true" /> Relink…
          </button>
        </div>
      )}

      {allFiles.length === 0 ? (
        <EmptyState compact Icon={FileText} title="No files attached" />
      ) : (
        <ProjectFilesTable
          files={allFiles}
          onUpdate={(id, patch) => ctx?.patchFile?.(id, patch)}
          onDelete={(id) => handleDelete(allFiles.find(f => f.id === id))}
          onAudit={(f) => setAuditFile(f)}
          maxHeight={300}
        />
      )}

      {/* After an apply, in-memory rows keep a stale storage_path until the
          next project load — harmless: local download/delete resolve by row
          id on the server. The census re-scan is what drives the banner. */}
      {relinkOpen && (
        <RelinkDialog
          projectId={project.id}
          onClose={() => setRelinkOpen(false)}
          onApplied={() => refreshMissing()}
        />
      )}
      {auditFile && (
        <FileAuditDrawer
          fileId={auditFile.id}
          projectId={project.id}
          fileName={auditFile.name}
          onClose={() => setAuditFile(null)}
        />
      )}
    </SettingsSection>
  )
}

// ─── Settings sub-components ───
// The kit's Card (B1): one surface, one hairline, the title at H3 in ink.
// The orange title and the 3px orange left accent go (review R22).
function SettingsSection({ title, icon: Icon, children }) {
  return (
    <KitCard title={<span className="rb-card-title">{Icon && <Icon className="rb-card-icon" aria-hidden="true" />}{title}</span>}>
      <div className="flex flex-col gap-3">{children}</div>
    </KitCard>
  )
}

function SettingsField({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label uppercase font-semibold" style={{ color: 'var(--color-ink-3)' }}>{label}</span>
      {children}
      {hint && <span className="text-caption" style={{ color: 'var(--color-ink-3)' }}>{hint}</span>}
    </div>
  )
}

// The kit's Switch (plan §4; review R34 keeps the pill as the one switch
// shape). Same click, same onChange(!checked); it now has a name, which the
// hand-rolled one never did (V1-05 counted it among the unnamed controls).
function SettingsToggle({ checked, onChange, label }) {
  return <Switch checked={checked} onChange={onChange} aria-label={label} title={label} />
}

/* One size (B1 restyle). The `lg` variant set the project title at Body 600
   inside the input, and the Control Panel's three field heights read
   43 / 37 / 37 (V1-17): an input is Dense 400 at the kit's md height.
   `size` is still accepted so no caller changes. */
// eslint-disable-next-line no-unused-vars
function SettingsInput({ value, onChange, placeholder, size }) {
  return (
    <input
      type="text" value={value} onChange={e => onChange(e.target.value)}
      onBlur={e => onChange(e.target.value.trim())}
      placeholder={placeholder}
      className="ui-input" data-size="md" data-surface="dark"
    />
  )
}

function SettingsTextarea({ value, onChange, placeholder }) {
  return (
    <textarea
      value={value} onChange={e => onChange(e.target.value)}
      onBlur={e => onChange(e.target.value.trim())}
      placeholder={placeholder}
      rows={2}
      className="ui-input resize-y" data-size="md" data-surface="dark"
    />
  )
}

function SettingsSelect({ value, options, labels, onChange, allowEmpty }) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)}
      className="ui-input" data-size="md" data-surface="dark"
    >
      {allowEmpty && <option value="">{allowEmpty}</option>}
      {options.map((o, i) => <option key={o} value={o}>{labels?.[i] ?? o.replace(/_/g, ' ')}</option>)}
    </select>
  )
}

function SettingsDateInput({ value, onChange }) {
  const display = value ? value.slice(0, 10) : ''
  return (
    <input
      type="date" value={display} onChange={e => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
      className="ui-input" data-size="md" data-surface="dark" style={{ colorScheme: 'dark' }}
    />
  )
}

function SettingsNumberInput({ value, onChange, placeholder, min, max }) {
  return (
    <input
      type="number" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} min={min} max={max}
      className="ui-input" data-size="md" data-surface="dark"
    />
  )
}

// ─── Project mini card (used by the gallery section) ───
function ProjectMiniCard({ project, active, onClick }) {
  const status = project.status || 'draft'
  return (
    <button
      type="button"
      onClick={onClick}
      className="rb-minicard text-left flex flex-col gap-2 p-3 rounded-control transition-transform hover:scale-[1.02]"
      data-active={active ? 'true' : undefined}
    >
      <div className="flex items-start gap-2">
        {active
          ? <Check className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-ink)' }} />
          : <Folder className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-ink-3)' }} />}
        <span className="rb-minicard-title flex-1 text-dense font-semibold truncate">
          {project.title || 'Untitled'}
        </span>
        <StatusBadge status={status} />
      </div>
      {project.description && (
        <p
          className="text-dense line-clamp-2"
          style={{ color: 'var(--color-ink-2)' }}
        >
          {project.description}
        </p>
      )}
    </button>
  )
}

// ─── Sub-components ───
// ─── Card ───
// A thin adapter over the kit's Card (imported as KitCard): the seven callers
// keep their { title, icon } call, and the surface, hairline, radius and H3
// title all come from the kit (R22: one card treatment on this surface).
function Card({ title, icon: Icon, children }) {
  return (
    <KitCard title={title ? <span className="rb-card-title">{Icon && <Icon className="rb-card-icon" aria-hidden="true" />}{title}</span> : null}>
      {children}
    </KitCard>
  )
}

// StatusPill was deleted here in B1's state extraction: it had no caller (review R36).

function StatusDropdown({ status, onChange }) {
  const current = status || 'draft'
  return (
    <div className="rb-status-select-wrap">
      <StatusDot status={current} />
      <select
        value={current}
        onChange={e => onChange(e.target.value)}
        className="ui-input rb-status-select appearance-none cursor-pointer" data-size="sm" data-surface="dark"
        data-status={current}
      >
        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{statusMeta(s).label}</option>)}
      </select>
      <ChevronDown className="absolute right-2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--color-ink-2)' }} />
    </div>
  )
}

// The local Stat that lived here was deleted when the Summary band moved to
// the kit's Stat (B1) — the kit's first caller, F2 §8.

function ListRow({ title, tag, hint, danger }) {
  return (
    <div
      className="rb-listrow flex items-center gap-2.5 px-2.5 py-2"
      data-danger={danger ? 'true' : undefined}
    >
      <ChevronRight className="rb-listrow-chevron w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex-1 text-dense truncate" style={{ color: 'var(--color-ink)' }}>{title}</span>
      {hint && (
        <span className="text-dense italic truncate max-w-[140px]" style={{ color: 'var(--color-ink-3)' }}>
          {hint}
        </span>
      )}
      {tag && <StatusBadge tone={danger ? 'danger' : 'neutral'} label={tag} />}
    </div>
  )
}

// The kit's Stat (R19: one metric tile, one orientation). Its hint is the
// Stat's delta line, and the good / danger tone rides on that line — the one
// place the kit lets a tone speak — instead of on the tile's border.
const BUDGET_TONE = { good: 'success', danger: 'danger', neutral: 'neutral' }
function BudgetTile({ label, value, hint, tone = 'neutral' }) {
  return <Stat className="rb-stat-tile" label={label} value={value} delta={hint} deltaTone={BUDGET_TONE[tone] || 'neutral'} />
}

// The kit's EmptyState (R21: one empty state on this surface).
function Empty({ children }) {
  return <EmptyState compact Icon={FileText} title={children} />
}

// (B4, 2026-09-25) `withDisplaySize` is gone: ProjectFilesTable reads
// `size_bytes`, the `files` column these rows already carry, so the mapper
// B1 wrote at the two call sites above has nothing left to do. KIND stays "—"
// for cloud rows on purpose — a data gap, recorded in ProjectFilesTable.

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
