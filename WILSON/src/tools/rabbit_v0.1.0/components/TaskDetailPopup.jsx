// ============================================================
// RABBIT — TaskDetailPopup (shared)
// ============================================================
//
// Two-column layout:
//   LEFT  — collapsible file/relation panels (assets, shots,
//           scenes, levels, experiences)
//   RIGHT — task properties, description, notes
//
// The header + status accent bar spans the full width of both
// columns. Relation dropdowns for scene/shot/level/experience
// only appear when the corresponding database is toggled on.

import { useState, useEffect, useMemo } from 'react'
import {
  ListChecks, X, Trash2, DollarSign,
  ChevronDown, ChevronRight, Film, Clapperboard,
  Gamepad2, Sparkles, Boxes, FolderOpen,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
// Phase 7 (Track A A2, 2026-09-06): the status dropdown warns about
// unfinished predecessors, then continues if asked. This popup is rendered by
// the Tasks tab, the Timeline, Scenes, Levels, Experiences and the Dashboard,
// so wiring it here covers all six; the Dashboard passes a ctx with no
// dependency rows, where the check has nothing to read (stated limit,
// docs/OUTSTANDING.md).
import { useDependencyStatusGuard } from '../components/DependencyStatusGuard'
import { useRosterMembers } from '../../../components/TeamMembers/useRosterMembers'
import { useRateCard } from '../../../components/RateCard/useRateCard'
import { usePermissions } from '../../../permissions/usePermissions'
import { canOnProject, projectActionDeniedReason } from '../../../permissions/projectRoleMatrix'
import GatedAction from '../../../permissions/GatedAction'
import FileManager from './FileManager'

// ── Constants ──
const TASK_STATUSES = [
  'waiting_to_start','in_progress','pending_review','needs_revisions',
  'approved','final','blocked','on_hold','omitted',
]
const PRIORITIES = ['low','medium','high','urgent']

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
    default:               return '#a8a29e'
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

// ═════════════════════════════════════════════════════
// MAIN EXPORT
// ═════════════════════════════════════════════════════
export default function TaskDetailPopup({ taskId, ctx, onClose }) {
  const task = (ctx?.tasks || []).find(t => t.id === taskId)
  const guard = useDependencyStatusGuard(ctx)
  const assets = ctx?.assets || []
  const phases = ctx?.phases || []
  const project = ctx?.project
  const scenes = ctx?.scenes || []
  const shots = ctx?.shots || []
  const levels = ctx?.levels || []
  const experiences = ctx?.experiences || []

  // Assignee/reviewer options come from the unified roster (Session 6) —
  // auth users in cloud mode, team members locally. Selections write the
  // canonical task.assignee_id / task.reviewer_id columns.
  const { members: rosterMembers, mode: rosterMode } = useRosterMembers()

  // In local_server mode the selects honor the documented TeamView
  // contract — only PROJECT-ASSIGNED members are offered, not the whole
  // workspace. Cloud mode stays on the full roster.
  const assignableMembers = useMemo(() => {
    if (rosterMode !== 'local_server') return rosterMembers
    const assignedIds = new Set((ctx?.teamAssignments || []).map(a => a.member_id))
    return rosterMembers.filter(m => assignedIds.has(m.id))
  }, [rosterMode, rosterMembers, ctx?.teamAssignments])

  // Entity writes (Session 6) — DB-side RLS is the real gate; this only
  // governs the write affordances for staffed-project reviewers.
  //
  // 🚨 Session 29 fixed a real omission here: this call passed appRole,
  // projectRole and isStaffed but NOT `ready`, and `ready` defaults to true
  // inside canOnProject. So while the first getSession() was still in flight,
  // `role` was null, a staffed project fell through to the seat check with no
  // seat known, and the answer was FALSE — "still loading" silently rendering
  // as "denied". That is the exact defect S23 fixed in ProjectTasksView and
  // ProjectAssetsView (both of which do pass it); this file was missed, and it
  // is why the flag is assembled in one place now.
  const { role, ready: permsReady } = usePermissions()
  const gateCtx = {
    appRole: role,
    projectRole: ctx?.myProjectRole,
    isStaffed: ctx?.projectIsStaffed,
    ready: permsReady,
  }
  const canWrite = canOnProject(gateCtx, 'project.entity.write')
  const writeReason = projectActionDeniedReason(gateCtx, 'project.entity.write')

  const rc = useRateCard()
  const roleEntries = useMemo(() => {
    const seen = new Set()
    return (rc.entries || []).filter(e => {
      if (!e.role_slug || seen.has(e.role_slug)) return false
      seen.add(e.role_slug)
      return true
    })
  }, [rc.entries])

  const currentRoleEntry = useMemo(() => {
    if (!task?.assigned_role_slug) return null
    return (rc.entries || []).find(e => e.role_slug === task.assigned_role_slug) || null
  }, [rc.entries, task?.assigned_role_slug])

  const dayRate = currentRoleEntry?.day_rate ?? null
  const bidTotal = (dayRate != null && task?.bid_days != null)
    ? dayRate * task.bid_days
    : null

  // Editing states
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState(task?.description || '')
  useEffect(() => { setDescDraft(task?.description || '') }, [task?.description])

  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState(task?.notes || '')
  useEffect(() => { setNotesDraft(task?.notes || '') }, [task?.notes])

  const [fileNameOverride, setFileNameOverride] = useState(task?.title || '')
  const [editingFileName, setEditingFileName] = useState(false)
  const [fileNameDraft, setFileNameDraft] = useState(task?.title || '')
  useEffect(() => {
    if (!editingFileName) setFileNameOverride(task?.title || '')
  }, [task?.title])

  // Collapsible left-column sections
  const [collapsed, setCollapsed] = useState({})
  function toggleCollapse(key) {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (!task) return null

  const sc = statusColor(task.status)
  const pc = priorityColor(task.priority)
  const linkedAsset = task.asset_id ? assets.find(a => a.id === task.asset_id) : null
  const linkedScene = task.scene_id ? scenes.find(s => s.id === task.scene_id) : null
  const linkedShot = task.shot_id ? shots.find(s => s.id === task.shot_id) : null

  // Shots filtered by selected scene (for cascading dropdown)
  const shotsForScene = task.scene_id
    ? shots.filter(s => s.scene_id === task.scene_id)
    : shots

  function handleUpdate(patch) {
    guard.update({ ids: task.id, patch, write: () => ctx?.updateTask?.(task.id, patch) })
  }

  // Check which databases are enabled
  const scenesOn = project?.scenes_enabled
  const levelsOn = project?.levels_enabled
  const experiencesOn = project?.experiences_enabled
  const hasLeftColumn = linkedAsset || linkedShot || scenesOn || levelsOn || experiencesOn

  return (
    <>
      {guard.modal}
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      {/* Modal — wider when left column is shown */}
      <div
        className={`fixed z-50 top-1/2 left-1/2 w-full rounded overflow-hidden flex flex-col ${hasLeftColumn ? 'max-w-4xl' : 'max-w-2xl'}`}
        style={{ backgroundColor: '#292524', border: '2px solid #f97316', maxHeight: '85vh', transform: 'translate(-50%, -50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header — spans full width over both columns ── */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `3px solid ${sc}` }}>
          <div className="flex items-center gap-2.5">
            <ListChecks className="w-4 h-4" style={{ color: '#fb923c' }} />
            <span className="text-[14px] font-mono font-bold" style={{ color: '#fb923c' }}>
              {task.title || 'Untitled task'}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Two-column body ── */}
        <div className="flex-1 overflow-auto flex">

          {/* ── LEFT COLUMN — files & relations ── */}
          {hasLeftColumn && (
            <div className="flex-shrink-0 overflow-auto" style={{ width: 400, borderRight: '1px solid #44403c', backgroundColor: '#1c1917' }}>
              <div className="p-3 flex flex-col gap-1">

                {/* Asset files */}
                {linkedAsset && (
                  <CollapsibleSection
                    icon={Boxes}
                    label={`Asset: ${linkedAsset.name || 'Untitled'}`}
                    collapsed={collapsed.asset}
                    onToggle={() => toggleCollapse('asset')}
                    accentColor="#fb923c"
                  >
                    <FileNameEditor
                      fileNameOverride={fileNameOverride}
                      editingFileName={editingFileName}
                      fileNameDraft={fileNameDraft}
                      setEditingFileName={setEditingFileName}
                      setFileNameDraft={setFileNameDraft}
                      setFileNameOverride={setFileNameOverride}
                    />
                    <FileManager
                      files={ctx?.managedFiles || []}
                      assetId={linkedAsset.id}
                      assetName={linkedAsset.name}
                      projectId={ctx?.activeProjectId}
                      project={project}
                      mode="readonly"
                      taskTitle={fileNameOverride || null}
                      taskId={task.id}
                      onFileAdded={() => ctx?.refreshManagedFiles?.()}
                    />
                  </CollapsibleSection>
                )}

                {/* Shot files */}
                {linkedShot && (
                  <CollapsibleSection
                    icon={Clapperboard}
                    label={`Shot: ${linkedShot.name || 'Untitled'}`}
                    collapsed={collapsed.shot}
                    onToggle={() => toggleCollapse('shot')}
                    accentColor="#f97316"
                  >
                    <FileNameEditor
                      fileNameOverride={fileNameOverride}
                      editingFileName={editingFileName}
                      fileNameDraft={fileNameDraft}
                      setEditingFileName={setEditingFileName}
                      setFileNameDraft={setFileNameDraft}
                      setFileNameOverride={setFileNameOverride}
                    />
                    <FileManager
                      files={ctx?.managedFiles || []}
                      assetId={linkedShot.id}
                      assetName={linkedShot.name}
                      projectId={ctx?.activeProjectId}
                      project={project}
                      mode="readonly"
                      taskTitle={fileNameOverride || null}
                      taskId={task.id}
                      onFileAdded={() => ctx?.refreshManagedFiles?.()}
                    />
                  </CollapsibleSection>
                )}

                {/* Scene relation */}
                {scenesOn && linkedScene && !linkedShot && (
                  <CollapsibleSection
                    icon={Film}
                    label={`Scene: ${linkedScene.name || 'Untitled'}`}
                    collapsed={collapsed.scene_files}
                    onToggle={() => toggleCollapse('scene_files')}
                    accentColor="#ea580c"
                  >
                    <FileNameEditor
                      fileNameOverride={fileNameOverride}
                      editingFileName={editingFileName}
                      fileNameDraft={fileNameDraft}
                      setEditingFileName={setEditingFileName}
                      setFileNameDraft={setFileNameDraft}
                      setFileNameOverride={setFileNameOverride}
                    />
                    <FileManager
                      files={ctx?.managedFiles || []}
                      assetId={linkedScene.id}
                      assetName={linkedScene.name}
                      projectId={ctx?.activeProjectId}
                      project={project}
                      mode="readonly"
                      taskTitle={fileNameOverride || null}
                      taskId={task.id}
                      onFileAdded={() => ctx?.refreshManagedFiles?.()}
                    />
                  </CollapsibleSection>
                )}

                {/* No relations hint */}
                {!linkedAsset && !linkedShot && !(scenesOn && linkedScene) && (
                  <div className="px-3 py-6 text-center">
                    <FolderOpen className="w-5 h-5 mx-auto mb-2" style={{ color: '#44403c' }} />
                    <p className="text-[10px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
                      Link an asset, scene, or shot to see files here
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── RIGHT COLUMN — task properties ── */}
          <div className="flex-1 overflow-auto px-5 py-4 min-w-0">

            {/* Title (editable) */}
            <div className="mb-5">
              <FieldLabel>Title</FieldLabel>
              <PopupInlineText
                value={task.title || ''}
                placeholder="Untitled task"
                onCommit={v => handleUpdate({ title: v })}
              />
            </div>

            {/* Properties grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-5">
              <div>
                <FieldLabel>Status</FieldLabel>
                <select value={task.status || 'waiting_to_start'} onChange={e => handleUpdate({ status: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: sc, border: '1px solid #44403c' }}>
                  {TASK_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Priority</FieldLabel>
                <select value={task.priority || 'medium'} onChange={e => handleUpdate({ priority: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: pc, border: '1px solid #44403c' }}>
                  {PRIORITIES.map(p => <option key={p} value={p} style={{ color: priorityColor(p) }}>{fmt(p)}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Asset</FieldLabel>
                {task.asset_id && !assets.some(a => a.id === task.asset_id) ? (
                  // Current asset not in ctx.assets (the Dashboard's
                  // cross-project reuse keeps the list empty so the
                  // FileManager column can't mount): show the embedded name
                  // read-only. A select here would render blank and its
                  // only option would write asset_id = NULL into a
                  // NOT NULL column (Session 8 review finding).
                  <div className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c', opacity: 0.85 }}
                    title="Open the project in R.A.B.B.I.T. to re-link this task">
                    {task.asset?.name || 'Linked asset'}
                  </div>
                ) : (
                  <select value={task.asset_id || ''} onChange={e => handleUpdate({ asset_id: e.target.value || null })}
                    className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: task.asset_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                    <option value="">--</option>
                    {assets.map(a => <option key={a.id} value={a.id}>{a.name || 'Untitled'}</option>)}
                  </select>
                )}
              </div>
              <div>
                <FieldLabel>Phase</FieldLabel>
                <select value={task.phase_id || ''} onChange={e => handleUpdate({ phase_id: e.target.value || null })}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: task.phase_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                  <option value="">--</option>
                  {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
                </select>
              </div>

              {/* ── Conditional relation fields ── */}
              {scenesOn && (
                <div>
                  <FieldLabel>Scene</FieldLabel>
                  <select value={task.scene_id || ''} onChange={e => {
                    const v = e.target.value || null
                    // Clear shot if scene changed
                    handleUpdate({ scene_id: v, shot_id: null })
                  }}
                    className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: task.scene_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                    <option value="">--</option>
                    {scenes.map(s => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
                  </select>
                </div>
              )}
              {scenesOn && (
                <div>
                  <FieldLabel>Shot</FieldLabel>
                  <select value={task.shot_id || ''} onChange={e => handleUpdate({ shot_id: e.target.value || null })}
                    className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: task.shot_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                    <option value="">--</option>
                    {shotsForScene.map(s => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
                  </select>
                </div>
              )}
              {levelsOn && (
                <div>
                  <FieldLabel>Level</FieldLabel>
                  <select value={task.level_id || ''} onChange={e => handleUpdate({ level_id: e.target.value || null })}
                    className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: task.level_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                    <option value="">--</option>
                    {levels.map(l => <option key={l.id} value={l.id}>{l.name || 'Untitled'}</option>)}
                  </select>
                </div>
              )}
              {experiencesOn && (
                <div>
                  <FieldLabel>Experience</FieldLabel>
                  <select value={task.experience_id || ''} onChange={e => handleUpdate({ experience_id: e.target.value || null })}
                    className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: task.experience_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                    <option value="">--</option>
                    {experiences.map(ex => <option key={ex.id} value={ex.id}>{ex.name || 'Untitled'}</option>)}
                  </select>
                </div>
              )}

              <div>
                <FieldLabel>Assignee</FieldLabel>
                <select value={task.assignee_id || ''} onChange={e => handleUpdate({ assignee_id: e.target.value || null })}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: task.assignee_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                  <option value="">--</option>
                  {assignableMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Reviewer</FieldLabel>
                <select value={task.reviewer_id || ''} onChange={e => handleUpdate({ reviewer_id: e.target.value || null })}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: task.reviewer_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                  <option value="">--</option>
                  {assignableMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Role</FieldLabel>
                <select
                  value={task.assigned_role_slug || ''}
                  onChange={e => {
                    const slug = e.target.value || null
                    const entry = roleEntries.find(r => r.role_slug === slug)
                    handleUpdate({
                      assigned_role_slug: slug,
                      assigned_position: entry ? entry.role_label : null,
                    })
                  }}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: task.assigned_role_slug ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                  <option value="">--</option>
                  {roleEntries.map(r => (
                    <option key={r.role_slug} value={r.role_slug}>
                      {r.role_label}{r.day_rate != null ? ` ($${Number(r.day_rate).toLocaleString()}/day)` : ''}
                    </option>
                  ))}
                </select>
                {task.assigned_role_slug && !currentRoleEntry && (
                  <div className="text-[9px] font-mono mt-0.5" style={{ color: '#fca5a5' }}>
                    Role "{fmt(task.assigned_role_slug)}" not found in rate card
                  </div>
                )}
              </div>
              <div>
                <FieldLabel>Bid days</FieldLabel>
                <input type="number" value={task.bid_days ?? ''} min={0} step={0.5}
                  onChange={e => { const n = parseFloat(e.target.value); handleUpdate({ bid_days: isNaN(n) ? null : n }) }}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: task.bid_days != null ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}
                  placeholder="--" />
              </div>
              <div>
                <FieldLabel>Bid total</FieldLabel>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-mono rounded"
                  style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: bidTotal != null ? '#4ade80' : '#57534e', minHeight: 34 }}>
                  <DollarSign className="w-3 h-3 flex-shrink-0" style={{ opacity: 0.6 }} />
                  {bidTotal != null
                    ? `${bidTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : dayRate != null ? `${Number(dayRate).toLocaleString()}/day \u00D7 --`
                    : '--'}
                </div>
                {dayRate != null && (
                  <div className="text-[9px] font-mono mt-0.5" style={{ color: '#57534e' }}>
                    {fmt(task.assigned_role_slug || '')} @ ${Number(dayRate).toLocaleString()}/day
                  </div>
                )}
              </div>
              <div>
                <FieldLabel>Start date</FieldLabel>
                <input type="date" value={task.start_date || ''} onChange={e => handleUpdate({ start_date: e.target.value || null })}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: task.start_date ? '#f4a261' : '#57534e', border: '1px solid #44403c', colorScheme: 'dark' }} />
              </div>
              <div>
                <FieldLabel>End date</FieldLabel>
                <input type="date" value={task.end_date || ''} onChange={e => handleUpdate({ end_date: e.target.value || null })}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: task.end_date ? '#f4a261' : '#57534e', border: '1px solid #44403c', colorScheme: 'dark' }} />
              </div>
            </div>

            {/* Description */}
            <div className="mb-5">
              <FieldLabel>Description</FieldLabel>
              {editingDesc ? (
                <textarea
                  autoFocus
                  value={descDraft}
                  onChange={e => setDescDraft(e.target.value)}
                  onBlur={() => {
                    setEditingDesc(false)
                    if (descDraft !== (task.description || '')) handleUpdate({ description: descDraft })
                  }}
                  onKeyDown={e => { if (e.key === 'Escape') { setDescDraft(task.description || ''); setEditingDesc(false) } }}
                  rows={4}
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                />
              ) : (
                <button type="button" onClick={() => { setDescDraft(task.description || ''); setEditingDesc(true) }}
                  className="w-full text-left px-3 py-2 text-[12px] font-mono rounded hover:bg-stone-700/40 transition-colors min-h-[60px]"
                  style={{ color: task.description ? '#f4a261' : '#57534e', border: '1px solid #44403c', backgroundColor: '#1c1917' }}>
                  {task.description || 'Click to add a description...'}
                </button>
              )}
            </div>

            {/* Notes */}
            <div className="mb-5">
              <FieldLabel>Notes</FieldLabel>
              {editingNotes ? (
                <textarea
                  autoFocus
                  value={notesDraft}
                  onChange={e => setNotesDraft(e.target.value)}
                  onBlur={() => {
                    setEditingNotes(false)
                    if (notesDraft !== (task.notes || '')) handleUpdate({ notes: notesDraft })
                  }}
                  onKeyDown={e => { if (e.key === 'Escape') { setNotesDraft(task.notes || ''); setEditingNotes(false) } }}
                  rows={3}
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                />
              ) : (
                <button type="button" onClick={() => { setNotesDraft(task.notes || ''); setEditingNotes(true) }}
                  className="w-full text-left px-3 py-2 text-[12px] font-mono rounded hover:bg-stone-700/40 transition-colors min-h-[48px]"
                  style={{ color: task.notes ? '#f4a261' : '#57534e', border: '1px solid #44403c', backgroundColor: '#1c1917' }}>
                  {task.notes || 'Click to add notes...'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid #44403c' }}>
          {/* Session 29 — was `canWrite ? <button/> : <span/>`, i.e. the
              control vanished with no explanation. Audrey: "keep button gray
              and explain why." */}
          <GatedAction allowed={canWrite} reason={writeReason}>
            {/* Soft delete — no confirm in RABBIT; the shell-level undo toast
                covers it. A ctx.deleteTask returning false means the caller
                vetoed the delete (Dashboard's confirm) — keep the popup open. */}
            <button type="button"
              onClick={() => { if (ctx?.deleteTask?.(task.id) !== false) onClose() }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono rounded hover:bg-stone-700 transition-colors"
              style={{ color: '#fca5a5', border: '1px solid #44403c' }}>
              <Trash2 className="w-3.5 h-3.5" /> Delete task
            </button>
          </GatedAction>
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-[11px] font-mono rounded transition-colors"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
            Done
          </button>
        </div>
      </div>
    </>
  )
}


// ─── Collapsible section for left column ───
function CollapsibleSection({ icon: Icon, label, collapsed, onToggle, accentColor, children }) {
  return (
    <div className="rounded overflow-hidden mb-1" style={{ border: '1px solid #292524' }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-800/50 transition-colors"
        style={{ backgroundColor: '#292524' }}
      >
        {collapsed
          ? <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: '#78716c' }} />
          : <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: '#78716c' }} />}
        {Icon && <Icon className="w-3 h-3 flex-shrink-0" style={{ color: accentColor || '#fb923c' }} />}
        <span className="text-[10px] font-mono uppercase tracking-wider truncate" style={{ color: accentColor || '#fb923c' }}>
          {label}
        </span>
      </button>
      {!collapsed && (
        <div className="px-3 py-2" style={{ backgroundColor: '#1c1917' }}>
          {children}
        </div>
      )}
    </div>
  )
}


// ─── File name editor (reused per section) ───
function FileNameEditor({ fileNameOverride, editingFileName, fileNameDraft, setEditingFileName, setFileNameDraft, setFileNameOverride }) {
  return (
    <div className="mb-2">
      <div className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: '#57534e' }}>
        Upload file name
      </div>
      {editingFileName ? (
        <input autoFocus
          value={fileNameDraft}
          onChange={e => setFileNameDraft(e.target.value)}
          onBlur={() => { setEditingFileName(false); setFileNameOverride(fileNameDraft) }}
          onKeyDown={e => {
            if (e.key === 'Enter') { setEditingFileName(false); setFileNameOverride(fileNameDraft) }
            if (e.key === 'Escape') { setEditingFileName(false); setFileNameDraft(fileNameOverride) }
          }}
          className="w-full px-2 py-1 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
          style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}
        />
      ) : (
        <button type="button"
          onClick={() => { setFileNameDraft(fileNameOverride); setEditingFileName(true) }}
          className="w-full text-left px-2 py-1 text-[11px] font-mono rounded hover:bg-stone-700/40 transition-colors truncate"
          style={{ color: fileNameOverride ? '#f4a261' : '#57534e', border: '1px dashed #44403c' }}>
          {fileNameOverride || 'Uses original file name'}
        </button>
      )}
    </div>
  )
}


// ── Field label ──
function FieldLabel({ children }) {
  return (
    <div className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: '#78716c' }}>
      {children}
    </div>
  )
}

// ── Inline text editor ──
function PopupInlineText({ value, placeholder, onCommit }) {
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
        className="w-full px-2.5 py-1.5 text-[14px] font-mono font-bold rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
    )
  }
  return (
    <button type="button" onClick={() => { setDraft(value); setEditing(true) }}
      className="text-[14px] font-mono font-bold text-left w-full hover:bg-stone-700/40 px-2.5 py-1.5 rounded transition-colors"
      style={{ color: value ? '#fb923c' : '#57534e' }}>
      {value || placeholder || '\u2014'}
    </button>
  )
}
