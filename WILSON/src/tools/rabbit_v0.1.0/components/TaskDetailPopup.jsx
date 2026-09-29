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
  Trash2, DollarSign,
  ChevronDown, ChevronRight, Film, Clapperboard,
  Gamepad2, Sparkles, Boxes, FolderOpen,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useRosterMembers } from '../../../components/TeamMembers/useRosterMembers'
import { useRateCard } from '../../../components/RateCard/useRateCard'
import { usePermissions } from '../../../permissions/usePermissions'
import { canOnProject, projectActionDeniedReason } from '../../../permissions/projectRoleMatrix'
import GatedAction from '../../../permissions/GatedAction'
import FileManager from './FileManager'
import { Dialog, Button, Field, EmptyState, StatusBadge, StatusDot, statusMeta } from '../../../ui'
// Priority as a status TONE, from the one place that decides it: the
// Dashboard renders this popup over its own task table, and the two must
// not disagree about which priorities are marked.
import { priorityTone } from '../../../components/Dashboard/dashboardTaskModel'
import '../views/rabbitTasks.css'

// ── Constants ──
const TASK_STATUSES = [
  'waiting_to_start','in_progress','pending_review','needs_revisions',
  'approved','final','blocked','on_hold','omitted',
]
const PRIORITIES = ['low','medium','high','urgent']

// Status: the kit's one source (StatusBadge / StatusDot / statusMeta), so the
// words and the dot match the Tasks table and the Dashboard. Priority: its
// tone from priorityTone(), its word sentence case (Q2).
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' }
function fmt(s) { return (s || '').replace(/_/g, ' ') }

// ═════════════════════════════════════════════════════
// MAIN EXPORT
// ═════════════════════════════════════════════════════
export default function TaskDetailPopup({ taskId, ctx, onClose }) {
  const task = (ctx?.tasks || []).find(t => t.id === taskId)
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

  // The files column holds FileManager (lane B4's), read-only here. The one
  // layer it opens, its VideoPreview, is the kit Dialog on the modal stack
  // since B4c, so an Escape there is the player's alone and this popup needs
  // no guard (B2 §4: `filesLayerOpen` is gone). Its notes editor marks its
  // own Escape (K4's mark, B4).
  function toggleCollapse(key) {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (!task) return null

  const linkedAsset = task.asset_id ? assets.find(a => a.id === task.asset_id) : null
  const linkedScene = task.scene_id ? scenes.find(s => s.id === task.scene_id) : null
  const linkedShot = task.shot_id ? shots.find(s => s.id === task.shot_id) : null

  // Shots filtered by selected scene (for cascading dropdown)
  const shotsForScene = task.scene_id
    ? shots.filter(s => s.scene_id === task.scene_id)
    : shots

  function handleUpdate(patch) { ctx?.updateTask?.(task.id, patch) }

  // Check which databases are enabled
  const scenesOn = project?.scenes_enabled
  const levelsOn = project?.levels_enabled
  const experiencesOn = project?.experiences_enabled
  const hasLeftColumn = linkedAsset || linkedShot || scenesOn || levelsOn || experiencesOn

  return (
    <Dialog
      // The header is the dialog's H2, read-only; the Title FIELD below is
      // where the title is edited, at the field's own 14px / 400. The two
      // stop being the same typographic object (review R17, as the critic
      // reframed it: both stay).
      title={task.title || 'Untitled task'}
      // The status, where the 3px status-coloured rule under the header used
      // to say it (one border weight, and never colour alone).
      subtitle={<StatusBadge status={task.status || 'waiting_to_start'} />}
      // Wider when the files column is shown.
      width={hasLeftColumn ? 'workbench' : 'reading'}
      // The backdrop closed it before, and still does. Escape now closes it
      // too (Q17), after an open editor's own Escape has reverted (W2).
      dismissOnBackdrop
      onClose={onClose}
      className="rb-task-detail"
      footer={(
        <>
          {/* Session 29 — was `canWrite ? <button/> : <span/>`, i.e. the
              control vanished with no explanation. Audrey: "keep button
              gray and explain why." */}
          <GatedAction allowed={canWrite} reason={writeReason}>
            {/* Soft delete — no confirm in RABBIT; the shell-level undo toast
                covers it. A ctx.deleteTask returning false means the caller
                vetoed the delete (Dashboard's confirm) — keep the popup open. */}
            <Button variant="danger" Icon={Trash2}
              onClick={() => { if (ctx?.deleteTask?.(task.id) !== false) onClose() }}>
              Delete task
            </Button>
          </GatedAction>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      )}
    >
      <div className="rb-task-detail-body">

        {/* ── LEFT COLUMN — files & relations ── */}
        {hasLeftColumn && (
          <div className="rb-task-detail-files">
            {/* Asset files */}
            {linkedAsset && (
              <CollapsibleSection
                icon={Boxes}
                label={`Asset: ${linkedAsset.name || 'Untitled'}`}
                collapsed={collapsed.asset}
                onToggle={() => toggleCollapse('asset')}
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
              <EmptyState
                compact
                Icon={FolderOpen}
                title="Link an asset, scene, or shot to see files here"
              />
            )}
          </div>
        )}

        {/* ── RIGHT COLUMN — task properties ── */}
        <div className="rb-task-detail-props">

          {/* Title (editable) */}
          <TextField label="Title">
            <PopupInlineText
              value={task.title || ''}
              placeholder="Untitled task"
              onCommit={v => handleUpdate({ title: v })}
            />
          </TextField>

          {/* Properties: every field in its order, chunked into four groups
              under a hairline and a Label-step heading (review R18). */}
          <PropertyGroup title="Workflow">
            <Field label="Status">
              <span className="rb-task-status-select">
                <StatusDot status={task.status || 'waiting_to_start'} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
                <select value={task.status || 'waiting_to_start'} onChange={e => handleUpdate({ status: e.target.value })}
                  className="ui-input rb-task-status-input">
                  {TASK_STATUSES.map(s => <option key={s} value={s}>{statusMeta(s).label}</option>)}
                </select>
              </span>
            </Field>
            <Field label="Priority">
              <select value={task.priority || 'medium'} onChange={e => handleUpdate({ priority: e.target.value })}
                className="ui-input rb-task-prop"
                data-tone={priorityTone(task.priority || 'medium')}>
                {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
              </select>
            </Field>
          </PropertyGroup>

          <PropertyGroup title="Placement">
            <Field label="Asset">
              {task.asset_id && !assets.some(a => a.id === task.asset_id) ? (
                // Current asset not in ctx.assets (the Dashboard's
                // cross-project reuse keeps the list empty so the
                // FileManager column can't mount): show the embedded name
                // read-only. A select here would render blank and its
                // only option would write asset_id = NULL into a
                // NOT NULL column (Session 8 review finding).
                <div className="rb-task-readout"
                  title="Open the project in R.A.B.B.I.T. to re-link this task">
                  {task.asset?.name || 'Linked asset'}
                </div>
              ) : (
                <select value={task.asset_id || ''} onChange={e => handleUpdate({ asset_id: e.target.value || null })}
                  className="ui-input rb-task-prop"
                  data-empty={task.asset_id ? 'false' : 'true'}>
                  <option value="">—</option>
                  {assets.map(a => <option key={a.id} value={a.id}>{a.name || 'Untitled'}</option>)}
                </select>
              )}
            </Field>
            <Field label="Phase">
              <select value={task.phase_id || ''} onChange={e => handleUpdate({ phase_id: e.target.value || null })}
                className="ui-input rb-task-prop"
                data-empty={task.phase_id ? 'false' : 'true'}>
                <option value="">—</option>
                {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
              </select>
            </Field>

            {/* ── Conditional relation fields ── */}
            {scenesOn && (
              <Field label="Scene">
                <select value={task.scene_id || ''} onChange={e => {
                  const v = e.target.value || null
                  // Clear shot if scene changed
                  handleUpdate({ scene_id: v, shot_id: null })
                }}
                  className="ui-input rb-task-prop"
                  data-empty={task.scene_id ? 'false' : 'true'}>
                  <option value="">—</option>
                  {scenes.map(s => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
                </select>
              </Field>
            )}
            {scenesOn && (
              <Field label="Shot">
                <select value={task.shot_id || ''} onChange={e => handleUpdate({ shot_id: e.target.value || null })}
                  className="ui-input rb-task-prop"
                  data-empty={task.shot_id ? 'false' : 'true'}>
                  <option value="">—</option>
                  {shotsForScene.map(s => <option key={s.id} value={s.id}>{s.name || 'Untitled'}</option>)}
                </select>
              </Field>
            )}
            {levelsOn && (
              <Field label="Level">
                <select value={task.level_id || ''} onChange={e => handleUpdate({ level_id: e.target.value || null })}
                  className="ui-input rb-task-prop"
                  data-empty={task.level_id ? 'false' : 'true'}>
                  <option value="">—</option>
                  {levels.map(l => <option key={l.id} value={l.id}>{l.name || 'Untitled'}</option>)}
                </select>
              </Field>
            )}
            {experiencesOn && (
              <Field label="Experience">
                <select value={task.experience_id || ''} onChange={e => handleUpdate({ experience_id: e.target.value || null })}
                  className="ui-input rb-task-prop"
                  data-empty={task.experience_id ? 'false' : 'true'}>
                  <option value="">—</option>
                  {experiences.map(ex => <option key={ex.id} value={ex.id}>{ex.name || 'Untitled'}</option>)}
                </select>
              </Field>
            )}
          </PropertyGroup>

          <PropertyGroup title="People">
            <Field label="Assignee">
              <select value={task.assignee_id || ''} onChange={e => handleUpdate({ assignee_id: e.target.value || null })}
                className="ui-input rb-task-prop"
                data-empty={task.assignee_id ? 'false' : 'true'}>
                <option value="">—</option>
                {assignableMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Reviewer">
              <select value={task.reviewer_id || ''} onChange={e => handleUpdate({ reviewer_id: e.target.value || null })}
                className="ui-input rb-task-prop"
                data-empty={task.reviewer_id ? 'false' : 'true'}>
                <option value="">—</option>
                {assignableMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field
              label="Role"
              hint={task.assigned_role_slug && !currentRoleEntry
                ? <span className="rb-task-hint-danger">Role "{fmt(task.assigned_role_slug)}" not found in rate card</span>
                : null}
            >
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
                className="ui-input rb-task-prop"
                data-empty={task.assigned_role_slug ? 'false' : 'true'}>
                <option value="">—</option>
                {roleEntries.map(r => (
                  <option key={r.role_slug} value={r.role_slug}>
                    {r.role_label}{r.day_rate != null ? ` ($${Number(r.day_rate).toLocaleString()}/day)` : ''}
                  </option>
                ))}
              </select>
            </Field>
          </PropertyGroup>

          <PropertyGroup title="Schedule and cost">
            <Field label="Bid days">
              <input type="number" value={task.bid_days ?? ''} min={0} step={0.5}
                onChange={e => { const n = parseFloat(e.target.value); handleUpdate({ bid_days: isNaN(n) ? null : n }) }}
                className="ui-input rb-task-prop rb-task-prop-number"
                data-empty={task.bid_days != null ? 'false' : 'true'}
                placeholder="—" />
            </Field>
            <Field
              label="Bid total"
              hint={dayRate != null
                ? <span className="rb-task-hint-figure">{fmt(task.assigned_role_slug || '')} @ ${Number(dayRate).toLocaleString()}/day</span>
                : null}
            >
              <div className="rb-task-readout rb-task-readout-figure" data-empty={bidTotal != null ? 'false' : 'true'}>
                <DollarSign className="rb-task-readout-icon" aria-hidden="true" />
                {bidTotal != null
                  ? `${bidTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : dayRate != null ? `${Number(dayRate).toLocaleString()}/day × —`
                  : '—'}
              </div>
            </Field>
            <Field label="Start date">
              <input type="date" value={task.start_date || ''} onChange={e => handleUpdate({ start_date: e.target.value || null })}
                className="ui-input rb-task-prop rb-task-prop-date"
                data-empty={task.start_date ? 'false' : 'true'} />
            </Field>
            <Field label="End date">
              <input type="date" value={task.end_date || ''} onChange={e => handleUpdate({ end_date: e.target.value || null })}
                className="ui-input rb-task-prop rb-task-prop-date"
                data-empty={task.end_date ? 'false' : 'true'} />
            </Field>
          </PropertyGroup>

          {/* Description */}
          <TextField label="Description">
            {editingDesc ? (
              <textarea
                autoFocus
                value={descDraft}
                aria-label="Description"
                onChange={e => setDescDraft(e.target.value)}
                onBlur={() => {
                  setEditingDesc(false)
                  if (descDraft !== (task.description || '')) handleUpdate({ description: descDraft })
                }}
                // W2: Escape reverts the edit first and closes on the second
                // press, so it must not reach the Dialog on the first one.
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setDescDraft(task.description || ''); setEditingDesc(false) } }}
                rows={4}
                className="ui-input rb-task-textarea"
              />
            ) : (
              <button type="button" onClick={() => { setDescDraft(task.description || ''); setEditingDesc(true) }}
                className="rb-task-textblock"
                data-size="lg"
                data-empty={task.description ? 'false' : 'true'}>
                {task.description || 'Click to add a description…'}
              </button>
            )}
          </TextField>

          {/* Notes */}
          <TextField label="Notes">
            {editingNotes ? (
              <textarea
                autoFocus
                value={notesDraft}
                aria-label="Notes"
                onChange={e => setNotesDraft(e.target.value)}
                onBlur={() => {
                  setEditingNotes(false)
                  if (notesDraft !== (task.notes || '')) handleUpdate({ notes: notesDraft })
                }}
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setNotesDraft(task.notes || ''); setEditingNotes(false) } }}
                rows={3}
                className="ui-input rb-task-textarea"
              />
            ) : (
              <button type="button" onClick={() => { setNotesDraft(task.notes || ''); setEditingNotes(true) }}
                className="rb-task-textblock"
                data-size="md"
                data-empty={task.notes ? 'false' : 'true'}>
                {task.notes || 'Click to add notes…'}
              </button>
            )}
          </TextField>
        </div>
      </div>
    </Dialog>
  )
}


// ─── A group of properties: a hairline, a Label-step heading, a grid ───
function PropertyGroup({ title, children }) {
  return (
    <section className="rb-task-prop-group" aria-label={title}>
      <h3 className="rb-task-prop-group-title">{title}</h3>
      <div className="rb-task-prop-grid">{children}</div>
    </section>
  )
}

// ─── A field whose control is a BUTTON (an inline editor at rest) ───
// The kit's Field is a <label>, and a <label> around a button forwards a
// click on its caption to the button: clicking "Title" would start an edit
// that clicking it never did (C1). Same anatomy and metrics, a <div>. Kit
// request K3 in the B2 hand-off.
function TextField({ label, className = '', children }) {
  return (
    <div className={`rb-task-textfield ${className}`.trim()}>
      <span className="rb-task-textfield-label text-label uppercase">{label}</span>
      {children}
    </div>
  )
}


// ─── Collapsible section for left column ───
function CollapsibleSection({ icon: Icon, label, collapsed, onToggle, children }) {
  return (
    <div className="rb-task-section">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="rb-task-section-head"
      >
        {collapsed
          ? <ChevronRight className="rb-task-section-chevron" aria-hidden="true" />
          : <ChevronDown className="rb-task-section-chevron" aria-hidden="true" />}
        {Icon && <Icon className="rb-task-section-icon" aria-hidden="true" />}
        <span className="rb-task-section-label">
          {label}
        </span>
      </button>
      {!collapsed && (
        <div className="rb-task-section-body">
          {children}
        </div>
      )}
    </div>
  )
}


// ─── File name editor (reused per section) ───
function FileNameEditor({ fileNameOverride, editingFileName, fileNameDraft, setEditingFileName, setFileNameDraft, setFileNameOverride }) {
  return (
    <TextField label="Upload file name">
      {editingFileName ? (
        <input autoFocus
          value={fileNameDraft}
          aria-label="Upload file name"
          onChange={e => setFileNameDraft(e.target.value)}
          onBlur={() => { setEditingFileName(false); setFileNameOverride(fileNameDraft) }}
          onKeyDown={e => {
            if (e.key === 'Enter') { setEditingFileName(false); setFileNameOverride(fileNameDraft) }
            if (e.key === 'Escape') { e.stopPropagation(); setEditingFileName(false); setFileNameDraft(fileNameOverride) }
          }}
          className="ui-input"
          data-size="sm"
        />
      ) : (
        <button type="button"
          onClick={() => { setFileNameDraft(fileNameOverride); setEditingFileName(true) }}
          className="rb-task-textblock"
          data-size="sm"
          data-empty={fileNameOverride ? 'false' : 'true'}>
          {fileNameOverride || 'Uses original file name'}
        </button>
      )}
    </TextField>
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
        aria-label="Title"
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { e.stopPropagation(); setDraft(value); setEditing(false) } }}
        className="ui-input rb-task-title-input" />
    )
  }
  return (
    <button type="button" onClick={() => { setDraft(value); setEditing(true) }}
      className="rb-task-textblock"
      data-size="line"
      data-empty={value ? 'false' : 'true'}>
      {value || placeholder || '—'}
    </button>
  )
}
