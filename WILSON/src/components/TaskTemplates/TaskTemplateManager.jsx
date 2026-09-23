// ============================================================
// TaskTemplateManager — popup for managing task templates
// ============================================================
//
// Opened from Settings > Storage (the old RABBIT tab) and from the Timeline's
// settings panel. All three of its overlays are the kit's Dialog (B2), the
// editor stacked over the manager and the confirm over both. Shows all workspace
// task templates in a table, with CRUD operations. Each template
// can be expanded to edit its tasks (name, role, days, deps).
//
// UX Laws applied:
// - Aesthetic-Usability — polished surfaces matching WILSON palette
// - Law of Common Region — clear grouping with borders/backgrounds
// - Fitts's Law — generous click targets on actions
// - Law of Proximity — tight internal spacing
// - Doherty Threshold — smooth 200ms transitions

import { useState, useMemo, useCallback, useEffect } from 'react'
import { menuOpened } from '../../ui/overlay'
import { v4 as uuidv4 } from 'uuid'
import {
  Plus, Trash2, ChevronDown, Check,
  Copy, AlertCircle, Link2,
} from 'lucide-react'
import { useTaskTemplates } from './useTaskTemplates'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { usePermissions } from '../../permissions/usePermissions'
import { canWriteTaskTemplate } from '../../permissions/projectRoleMatrix'
import {
  Dialog, Button, IconButton, Table, Th, Td, Row, Banner, Loading, EmptyState, HoverActions,
} from '../../ui'
import '../../tools/rabbit_v0.1.0/views/rabbitTasks.css'

const DEFAULT_ROLES = [
  'modeler', 'rigger', 'animator', 'texture_artist', 'lighter',
  'compositor', 'fx_artist', 'concept_artist', 'storyboard_artist',
  'art_director', 'producer', 'coordinator', 'qa_tester',
  'audio_designer', 'editor', 'developer', 'writer',
]

function fmt(s) { return (s || '').replace(/_/g, ' ') }

// ─────────────────────────────────────────────────────
// MAIN POPUP
// ─────────────────────────────────────────────────────
export default function TaskTemplateManager({ onClose }) {
  const tt = useTaskTemplates()
  const rabbit = useRabbit()
  const projects = rabbit?.projects || []
  const { role: appRole } = usePermissions()

  // ── Session 28: who may write (Audrey, 2026-08-04) ──
  //
  // Before 0044 this whole surface was ungated, which was harmless only
  // because Local Server has no roles. Against a real database an ordinary
  // member pressing New Template gets an RLS refusal, and useTaskTemplates
  // rolls the optimistic row back — so without this the control invites a
  // failure that reaches the screen as a row appearing and vanishing.
  //
  // `myProjectRole` is the caller's seat on the project currently OPEN, which
  // is why the per-row helper only credits it to templates pinned to that same
  // project. See canWriteTaskTemplate's note on the deliberate fail-closed
  // mismatch this leaves.
  const openProjectId = rabbit?.project?.id || null
  const myProjectRole = rabbit?.myProjectRole || null
  const isWorkspaceWriter = appRole === 'admin' || appRole === 'manager'

  // A project manager may create — but only a template PINNED to their own
  // project, because can_write_task_template(NULL) admits nobody below
  // workspace manager. Creating a global one and watching it bounce off RLS
  // would be the same silent failure in a new costume.
  const newTemplateProjectId = isWorkspaceWriter ? null : openProjectId
  const canCreate = isWorkspaceWriter || (myProjectRole === 'manager' && !!openProjectId)

  const canWriteRow = useCallback((tmpl) => canWriteTaskTemplate({
    appRole,
    projectRole: tmpl?.project_id && tmpl.project_id === openProjectId
      ? myProjectRole
      : null,
  }), [appRole, openProjectId, myProjectRole])

  const [editingId, setEditingId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  // ── Create new template ──
  async function handleCreate() {
    const created = await tt.addTemplate({
      name: 'New template',
      description: '',
      project_id: newTemplateProjectId,
      tasks: [],
    })
    if (created?.id) setEditingId(created.id)
  }

  // ── Delete template ──
  async function handleDelete(id) {
    await tt.deleteTemplate(id)
    setConfirmDelete(null)
    if (editingId === id) setEditingId(null)
  }

  // ── Duplicate template ──
  async function handleDuplicate(template) {
    const newTasks = (template.tasks || []).map(t => ({
      ...t,
      id: uuidv4(),
    }))
    // Remap depends_on references
    const idMap = {}
    ;(template.tasks || []).forEach((t, i) => { idMap[t.id] = newTasks[i].id })
    for (const t of newTasks) {
      if (Array.isArray(t.depends_on)) {
        t.depends_on = t.depends_on.map(depId => idMap[depId] || depId)
      }
    }
    await tt.addTemplate({
      name: `${template.name} (copy)`,
      description: template.description || '',
      // A project manager duplicating a GLOBAL template cannot produce another
      // global one — the copy lands pinned to their project, which is the only
      // thing they are allowed to create.
      project_id: isWorkspaceWriter ? (template.project_id || null) : newTemplateProjectId,
      tasks: newTasks,
    })
  }

  const editingTemplate = editingId ? tt.templates.find(t => t.id === editingId) : null

  return (
    <>
      <Dialog
        width="workbench"
        title="Task templates"
        subtitle={`${tt.templates.length} template${tt.templates.length === 1 ? '' : 's'}`}
        // The backdrop closed it before, and still does; Escape too (Q17).
        dismissOnBackdrop
        onClose={onClose}
        footer={(
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        )}
      >
        <div className="rb-tpl-body">
          {canCreate && (
            <div className="rb-tpl-actions">
              <Button size="sm" Icon={Plus} onClick={handleCreate}
                title={newTemplateProjectId
                  ? 'Creates a template pinned to the project you have open'
                  : 'Creates a template available to every project'}>
                {newTemplateProjectId ? 'New project template' : 'New template'}
              </Button>
            </div>
          )}

          {/* Session 28: say why, rather than nothing. An RLS refusal used to
              reach the screen as a row appearing and disappearing — the hook has
              always set `error` and nothing has ever rendered it. */}
          {tt.error && (
            <Banner tone="danger" Icon={AlertCircle}>{tt.error}</Banner>
          )}
          {!canCreate && (
            <Banner tone="info">
              Read-only. Task templates are managed by workspace admins and managers,
              or by a project manager for their own project&rsquo;s templates.
            </Banner>
          )}

          {tt.loading ? (
            <Loading label="Loading templates" />
          ) : tt.templates.length === 0 ? (
            <EmptyState
              title="No templates yet"
              body="Create a template to define reusable task sets for assets"
            />
          ) : (
            <Table
              className="rb-tpl-table"
              head={(
                <Row>
                  <Th width="30%">Name</Th>
                  <Th width="15%">Scope</Th>
                  <Th width="10%" numeric>Tasks</Th>
                  <Th width="12%" numeric>Total days</Th>
                  <Th width="18%">Description</Th>
                  <Th width="15%" align="right">Actions</Th>
                </Row>
              )}
            >
              {tt.templates.map(tmpl => {
                const stats = tt.getTemplateStats(tmpl)
                const isEditing = editingId === tmpl.id
                const rowWritable = canWriteRow(tmpl)
                return (
                  // The template being edited is the table's one selection
                  // (the kit's tint and signal edge; it was a tint alone).
                  <Row key={tmpl.id} selected={isEditing}>
                    <Td className="rb-tpl-cell">
                      <TemplateName template={tmpl} readOnly={!rowWritable}
                        onUpdate={(name) => tt.updateTemplate(tmpl.id, { name })} />
                    </Td>
                    <Td className="rb-tpl-cell">
                      <TemplateScope
                        template={tmpl}
                        projects={projects}
                        readOnly={!rowWritable}
                        onUpdate={(patch) => tt.updateTemplate(tmpl.id, patch)}
                      />
                    </Td>
                    <Td numeric>{stats.taskCount}</Td>
                    <Td numeric>{stats.totalDays}d</Td>
                    <Td>
                      <span className="rb-tpl-desc-cell" data-empty={tmpl.description ? 'false' : 'true'}
                        title={tmpl.description || ''}>
                        {tmpl.description || '—'}
                      </span>
                    </Td>
                    <Td align="right">
                      <span className="rb-tpl-row-actions">
                        <Button size="sm" onClick={() => setEditingId(isEditing ? null : tmpl.id)}>
                          {isEditing ? 'Close' : (rowWritable ? 'Edit' : 'View')}
                        </Button>
                        {/* Duplicate WRITES a new template, so it needs the
                            create right, not the row's — a member could
                            otherwise duplicate a template they may not
                            create. */}
                        {canCreate && (
                          <IconButton size="sm" Icon={Copy} title="Duplicate template" onClick={() => handleDuplicate(tmpl)} />
                        )}
                        {rowWritable && (
                          <IconButton size="sm" Icon={Trash2} danger title="Delete template" onClick={() => setConfirmDelete(tmpl.id)} />
                        )}
                      </span>
                    </Td>
                  </Row>
                )
              })}
            </Table>
          )}
        </div>
      </Dialog>

      {/* Template editor overlay */}
      {editingTemplate && (
        <TemplateEditor
          template={editingTemplate}
          readOnly={!canWriteRow(editingTemplate)}
          onUpdate={(patch) => tt.updateTemplate(editingTemplate.id, patch)}
          onClose={() => setEditingId(null)}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <ConfirmDeleteDialog
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}


// ─────────────────────────────────────────────────────
// TEMPLATE EDITOR
// ─────────────────────────────────────────────────────
function TemplateEditor({ template, onUpdate, onClose, readOnly = false }) {
  const [descDraft, setDescDraft] = useState(template.description || '')
  const [editingDesc, setEditingDesc] = useState(false)

  // Local tasks state for smooth editing
  const [localTasks, setLocalTasks] = useState(template.tasks || [])
  useEffect(() => { setLocalTasks(template.tasks || []) }, [template.id])

  // Persist tasks to backend
  const saveTasks = useCallback((newTasks) => {
    setLocalTasks(newTasks)
    onUpdate({ tasks: newTasks })
  }, [onUpdate])

  function handleAddTask() {
    const newTask = {
      id: uuidv4(),
      name: '',
      role_slug: '',
      bid_days: 1,
      sort_order: localTasks.length,
      depends_on: [],
    }
    saveTasks([...localTasks, newTask])
  }

  function handleUpdateTask(taskId, patch) {
    saveTasks(localTasks.map(t => t.id === taskId ? { ...t, ...patch } : t))
  }

  function handleDeleteTask(taskId) {
    // Also remove from depends_on of other tasks
    const filtered = localTasks.filter(t => t.id !== taskId)
      .map(t => ({
        ...t,
        depends_on: (t.depends_on || []).filter(d => d !== taskId),
      }))
    saveTasks(filtered)
  }

  // Build a lookup for quick name resolution
  const taskById = useMemo(() => {
    const m = {}
    for (const t of localTasks) m[t.id] = t
    return m
  }, [localTasks])

  return (
    <Dialog
      width="reading"
      title={readOnly ? 'View template' : 'Edit template'}
      subtitle={template.name}
      // It sat over the manager on its own backdrop, which closed it; the
      // kit's stack does the same, and Escape closes this one first (Q17).
      dismissOnBackdrop
      onClose={onClose}
      footer={(
        <>
          <span className="rb-tpl-total">
            {/* 600, not `bold`: the faces are declared 400 600, so `bold`
                clamped to 600 anyway. */}
            Total: <span className="rb-tpl-total-figure">
              {localTasks.reduce((sum, t) => sum + (t.bid_days || 0), 0)}d
            </span>
          </span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      )}
    >
      <div className="rb-tpl-body">
        {/* Description */}
        <div className="rb-task-textfield">
          <span className="rb-task-textfield-label text-label uppercase">Description</span>
          {editingDesc && !readOnly ? (
            <textarea
              autoFocus
              value={descDraft}
              aria-label="Description"
              onChange={e => setDescDraft(e.target.value)}
              onBlur={() => {
                setEditingDesc(false)
                if (descDraft !== (template.description || '')) onUpdate({ description: descDraft })
              }}
              // W2: Escape reverts the edit first; the dialog closes on the
              // second press, so the first must not reach it.
              onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setDescDraft(template.description || ''); setEditingDesc(false) } }}
              rows={2}
              className="ui-input rb-task-textarea"
            />
          ) : (
            <button type="button" disabled={readOnly}
              onClick={() => { setDescDraft(template.description || ''); setEditingDesc(true) }}
              className="rb-task-textblock"
              data-size="sm"
              data-empty={template.description ? 'false' : 'true'}>
              {template.description || (readOnly ? '—' : 'Click to add description…')}
            </button>
          )}
        </div>

        {/* Tasks table */}
        <div className="rb-tpl-tasks-head">
          <span className="rb-tpl-tasks-title text-label uppercase">
            Tasks ({localTasks.length})
          </span>
          {!readOnly && (
            <Button size="sm" Icon={Plus} onClick={handleAddTask}>
              Add task
            </Button>
          )}
        </div>

        {localTasks.length === 0 ? (
          <EmptyState
            compact
            title={readOnly
              ? 'This template has no tasks.'
              : 'No tasks in this template. Add one to get started.'}
          />
        ) : (
          <Table
            dense
            className="rb-tpl-task-table"
            head={(
              <Row>
                <Th width="36%">Task name</Th>
                <Th width="22%">Role</Th>
                <Th width="12%" numeric>Days</Th>
                <Th width="24%">Depends on</Th>
                <Th width="6%"><span className="sr-only">Delete</span></Th>
              </Row>
            )}
          >
            {localTasks.map((task) => (
              <TemplateTaskRow
                key={task.id}
                task={task}
                allTasks={localTasks}
                taskById={taskById}
                readOnly={readOnly}
                onUpdate={(patch) => handleUpdateTask(task.id, patch)}
                onDelete={() => handleDeleteTask(task.id)}
              />
            ))}
          </Table>
        )}
      </div>
    </Dialog>
  )
}


// ─────────────────────────────────────────────────────
// TEMPLATE TASK ROW
// ─────────────────────────────────────────────────────
function TemplateTaskRow({ task, allTasks, taskById, onUpdate, onDelete, readOnly = false }) {
  // Dependency selector
  const availableDeps = allTasks.filter(t => t.id !== task.id)
  const currentDeps = task.depends_on || []

  function toggleDep(depId) {
    const next = currentDeps.includes(depId)
      ? currentDeps.filter(d => d !== depId)
      : [...currentDeps, depId]
    onUpdate({ depends_on: next })
  }

  // The Tasks table's row class: its hover fill and its hover-only carets.
  return (
    <Row className="rb-task-row">
      {/* Name */}
      <Td className="rb-tpl-cell">
        <EditableText
          value={task.name || ''}
          placeholder="Task name…"
          readOnly={readOnly}
          onCommit={(name) => onUpdate({ name })}
        />
      </Td>

      {/* Role */}
      <Td className="rb-tpl-cell">
        <span className="rb-task-cell-editor">
          <select
            value={task.role_slug || ''}
            disabled={readOnly}
            aria-label="Role"
            onChange={e => onUpdate({ role_slug: e.target.value || '' })}
            className="rb-task-cell-select"
            data-empty={task.role_slug ? 'false' : 'true'}>
            <option value="">--</option>
            {DEFAULT_ROLES.map(r => <option key={r} value={r}>{fmt(r)}</option>)}
          </select>
        </span>
      </Td>

      {/* Days */}
      <Td numeric className="rb-tpl-cell">
        <input
          type="number"
          min={0}
          step={0.5}
          value={task.bid_days ?? ''}
          disabled={readOnly}
          aria-label="Days"
          onChange={e => onUpdate({ bid_days: parseFloat(e.target.value) || 0 })}
          className="rb-task-cell-select rb-task-cell-number"
        />
      </Td>

      {/* Dependencies */}
      <Td className="rb-tpl-cell">
        <DependencyPicker
          currentDeps={currentDeps}
          availableDeps={availableDeps}
          taskById={taskById}
          readOnly={readOnly}
          onToggle={toggleDep}
        />
      </Td>

      {/* Delete */}
      <Td align="right" className="rb-tpl-cell">
        {!readOnly && (
          <HoverActions>
            <IconButton size="sm" Icon={Trash2} danger title="Delete this task" onClick={onDelete} />
          </HoverActions>
        )}
      </Td>
    </Row>
  )
}


// ─────────────────────────────────────────────────────
// DEPENDENCY PICKER — multi-select popover
// ─────────────────────────────────────────────────────
// Fixed to its trigger (a table cell would clip an absolute list), over a
// transparent scrim that takes the click which dismisses it — as the old
// list's overlay did, so nothing under the pointer is activated by that
// click, and a second click on the trigger closes it. Each option stays
// open for the next tick, as before. Escape closes the list and only the
// list: it is marked handled, which is what the kit Dialog stands down on
// (K4). Registered with overlay.js while open, as the kit Menu is.
function DependencyPicker({ currentDeps, availableDeps, taskById, onToggle, readOnly = false }) {
  const [at, setAt] = useState(null)

  useEffect(() => {
    if (!at) return undefined
    const unregister = menuOpened()
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); setAt(null) } }
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('keydown', key, true); unregister() }
  }, [at])

  if (availableDeps.length === 0) {
    return <span className="rb-task-none rb-tpl-deps-none">--</span>
  }

  return (
    <>
      <button type="button" disabled={readOnly}
        aria-expanded={!!at}
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect()
          setAt(at ? null : { x: r.left, y: r.bottom + 4 })
        }}
        className="rb-task-cell-text rb-tpl-deps"
        data-empty={currentDeps.length ? 'false' : 'true'}>
        {currentDeps.length === 0 ? (
          <span className="rb-tpl-deps-label">
            <Link2 className="rb-tpl-deps-icon" aria-hidden="true" />
            None
          </span>
        ) : (
          <span className="rb-tpl-deps-label">
            {currentDeps.map(id => taskById[id]?.name || 'Unknown').join(', ')}
          </span>
        )}
        <ChevronDown className="rb-tpl-deps-icon" aria-hidden="true" />
      </button>

      {at && (
        <>
          <div className="rb-tpl-scrim" aria-hidden="true" onClick={() => setAt(null)} />
          <div className="rb-task-menu rb-tpl-deps-menu" role="group" aria-label="Depends on"
            style={{ left: at.x, top: at.y }}>
            {availableDeps.map(dep => {
              const checked = currentDeps.includes(dep.id)
              return (
                <button key={dep.id} type="button" className="rb-task-menu-item" aria-pressed={checked}
                  onClick={() => onToggle(dep.id)}>
                  <span className="rb-tpl-check" data-checked={checked ? 'true' : 'false'} aria-hidden="true">
                    {checked && <Check />}
                  </span>
                  <span className="rb-task-menu-label">{dep.name || 'Untitled'}</span>
                  {dep.bid_days > 0 && (
                    <span className="rb-tpl-deps-days">{dep.bid_days}d</span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}


// ─────────────────────────────────────────────────────
// TEMPLATE SCOPE (global vs project-specific)
// ─────────────────────────────────────────────────────
function TemplateScope({ template, projects, onUpdate, readOnly = false }) {
  const isProjectSpecific = !!template.project_id

  return (
    <div className="rb-tpl-scope">
      <button type="button" disabled={readOnly}
        onClick={() => onUpdate({ project_id: isProjectSpecific ? null : (projects[0]?.id || null) })}
        className="rb-tpl-check"
        data-checked={isProjectSpecific ? 'true' : 'false'}
        aria-pressed={isProjectSpecific}
        title={isProjectSpecific ? 'Project-specific' : 'Global (all projects)'}>
        {isProjectSpecific && <Check aria-hidden="true" />}
      </button>
      {isProjectSpecific ? (
        <span className="rb-task-cell-editor">
          <select
            value={template.project_id || ''}
            disabled={readOnly}
            aria-label="Project"
            onChange={e => onUpdate({ project_id: e.target.value || null })}
            className="rb-task-cell-select">
            <option value="">--</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title || 'Untitled'}</option>)}
          </select>
        </span>
      ) : (
        <span className="rb-task-none">Global</span>
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────
// TEMPLATE NAME (inline edit)
// ─────────────────────────────────────────────────────
function TemplateName({ template, onUpdate, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(template.name || '')

  useEffect(() => { setDraft(template.name || '') }, [template.name])

  function commit() {
    setEditing(false)
    if (draft !== template.name) onUpdate(draft)
  }

  if (editing && !readOnly) {
    return (
      <input autoFocus value={draft}
        aria-label="Template name"
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { e.stopPropagation(); setDraft(template.name); setEditing(false) } }}
        className="ui-input rb-task-cell-input rb-tpl-name"
        data-size="sm"
      />
    )
  }
  return (
    <button type="button" disabled={readOnly}
      onClick={() => { setDraft(template.name || ''); setEditing(true) }}
      className="rb-task-cell-text rb-tpl-name"
      data-empty="false">
      {template.name || 'Untitled'}
    </button>
  )
}


// ─────────────────────────────────────────────────────
// EDITABLE TEXT (generic inline editor)
// ─────────────────────────────────────────────────────
function EditableText({ value, placeholder, onCommit, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  if (editing && !readOnly) {
    return (
      <input autoFocus value={draft}
        aria-label={placeholder || 'Name'}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { e.stopPropagation(); setDraft(value); setEditing(false) } }}
        className="ui-input rb-task-cell-input"
        data-size="sm"
      />
    )
  }
  return (
    <button type="button" disabled={readOnly}
      onClick={() => { setDraft(value); setEditing(true) }}
      className="rb-task-cell-text"
      data-empty={value ? 'false' : 'true'}>
      {value || (readOnly ? '—' : placeholder || '—')}
    </button>
  )
}


// ─────────────────────────────────────────────────────
// CONFIRM DELETE DIALOG — the kit's Dialog (W9)
// ─────────────────────────────────────────────────────
function ConfirmDeleteDialog({ onConfirm, onCancel }) {
  return (
    <Dialog
      width="confirm"
      title="Delete template?"
      // Its backdrop cancelled it before, and still does.
      dismissOnBackdrop
      onClose={onCancel}
      footer={(
        <>
          <Button autoFocus onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </>
      )}
    >
      This action cannot be undone. The template and all its tasks will be permanently removed.
    </Dialog>
  )
}
