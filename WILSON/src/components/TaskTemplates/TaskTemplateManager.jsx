// ============================================================
// TaskTemplateManager — popup for managing task templates
// ============================================================
//
// Opened from the Settings > RABBIT tab. Shows all workspace
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
import { v4 as uuidv4 } from 'uuid'
import {
  X, Plus, Trash2, ChevronDown, ChevronRight, GripVertical,
  Copy, AlertCircle, Link2,
} from 'lucide-react'
import { useTaskTemplates } from './useTaskTemplates'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'

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

  const [editingId, setEditingId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  // ── Create new template ──
  async function handleCreate() {
    const created = await tt.addTemplate({
      name: 'New Template',
      description: '',
      project_id: null,
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
      project_id: template.project_id || null,
      tasks: newTasks,
    })
  }

  const editingTemplate = editingId ? tt.templates.find(t => t.id === editingId) : null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60]" style={{ backgroundColor: 'rgba(0,0,0,0.65)' }} onClick={onClose} />
      {/* Modal */}
      <div
        className="fixed z-[60] top-1/2 left-1/2 w-full max-w-5xl rounded overflow-hidden flex flex-col"
        style={{
          backgroundColor: '#292524',
          border: '2px solid #f97316',
          maxHeight: '85vh',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '2px solid #44403c' }}>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
              Task Templates
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: '#a8a29e', backgroundColor: '#1c1917' }}>
              {tt.templates.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded transition-colors"
              style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
              <Plus className="w-3.5 h-3.5" /> New Template
            </button>
            <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {tt.loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-[11px] font-mono" style={{ color: '#78716c' }}>Loading...</span>
            </div>
          ) : tt.templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <span className="text-[13px] font-mono" style={{ color: '#78716c' }}>No templates yet</span>
              <span className="text-[11px] font-mono" style={{ color: '#57534e' }}>
                Create a template to define reusable task sets for assets
              </span>
            </div>
          ) : (
            <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr style={{ backgroundColor: '#1c1917' }}>
                  <Th style={{ width: '30%' }}>Name</Th>
                  <Th style={{ width: '15%' }}>Scope</Th>
                  <Th style={{ width: '10%', textAlign: 'center' }}>Tasks</Th>
                  <Th style={{ width: '12%', textAlign: 'center' }}>Total Days</Th>
                  <Th style={{ width: '18%' }}>Description</Th>
                  <Th style={{ width: '15%', textAlign: 'right' }}>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {tt.templates.map(tmpl => {
                  const stats = tt.getTemplateStats(tmpl)
                  const isEditing = editingId === tmpl.id
                  return (
                    <tr key={tmpl.id}
                      style={{
                        borderBottom: '1px solid #292524',
                        backgroundColor: isEditing ? 'rgba(234, 88, 12, 0.08)' : 'transparent',
                      }}
                      className="hover:bg-stone-800/40 transition-colors">
                      <Td>
                        <TemplateName template={tmpl} onUpdate={(name) => tt.updateTemplate(tmpl.id, { name })} />
                      </Td>
                      <Td>
                        <TemplateScope
                          template={tmpl}
                          projects={projects}
                          onUpdate={(patch) => tt.updateTemplate(tmpl.id, patch)}
                        />
                      </Td>
                      <Td style={{ textAlign: 'center' }}>
                        <span className="text-[11px] font-mono" style={{ color: '#d6d3d1' }}>
                          {stats.taskCount}
                        </span>
                      </Td>
                      <Td style={{ textAlign: 'center' }}>
                        <span className="text-[11px] font-mono font-bold" style={{ color: '#f4a261' }}>
                          {stats.totalDays}d
                        </span>
                      </Td>
                      <Td>
                        <span className="text-[11px] font-mono truncate block" style={{ color: '#a8a29e', maxWidth: 180 }}
                          title={tmpl.description || ''}>
                          {tmpl.description || '\u2014'}
                        </span>
                      </Td>
                      <Td style={{ textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => setEditingId(isEditing ? null : tmpl.id)}
                            className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded transition-colors"
                            style={{
                              color: isEditing ? '#fff7ed' : '#fb923c',
                              backgroundColor: isEditing ? '#ea580c' : 'transparent',
                              border: '1px solid #44403c',
                            }}>
                            {isEditing ? 'Close' : 'Edit'}
                          </button>
                          <button type="button" onClick={() => handleDuplicate(tmpl)}
                            className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e' }}
                            title="Duplicate template">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(tmpl.id)}
                            className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#fca5a5' }}
                            title="Delete template">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-[11px] font-mono rounded transition-colors"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
            Done
          </button>
        </div>
      </div>

      {/* Template editor overlay */}
      {editingTemplate && (
        <TemplateEditor
          template={editingTemplate}
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


// ────────────────────���─────────────────���──────────────
// TEMPLATE EDITOR (slide-in panel)
// ─────────────────────────────────────────────────────
function TemplateEditor({ template, onUpdate, onClose }) {
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
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[70]" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      {/* Panel */}
      <div
        className="fixed z-[70] top-1/2 left-1/2 w-full max-w-3xl rounded overflow-hidden flex flex-col"
        style={{
          backgroundColor: '#1c1917',
          border: '2px solid #fb923c',
          maxHeight: '80vh',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '2px solid #44403c' }}>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
              Edit Template
            </span>
            <span className="text-[11px] font-mono" style={{ color: '#a8a29e' }}>
              {template.name}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Description */}
        <div className="px-5 py-3" style={{ borderBottom: '1px solid #292524' }}>
          <div className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: '#78716c' }}>Description</div>
          {editingDesc ? (
            <textarea
              autoFocus
              value={descDraft}
              onChange={e => setDescDraft(e.target.value)}
              onBlur={() => {
                setEditingDesc(false)
                if (descDraft !== (template.description || '')) onUpdate({ description: descDraft })
              }}
              onKeyDown={e => { if (e.key === 'Escape') { setDescDraft(template.description || ''); setEditingDesc(false) } }}
              rows={2}
              className="w-full px-2 py-1 text-xs font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
              style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}
            />
          ) : (
            <button type="button"
              onClick={() => { setDescDraft(template.description || ''); setEditingDesc(true) }}
              className="text-xs font-mono text-left w-full hover:bg-stone-800 px-2 py-1 rounded min-h-[28px]"
              style={{ color: template.description ? '#d6d3d1' : '#78716c' }}>
              {template.description || 'Click to add description...'}
            </button>
          )}
        </div>

        {/* Tasks table */}
        <div className="flex-1 overflow-auto px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: '#fb923c' }}>
              Tasks ({localTasks.length})
            </span>
            <button type="button" onClick={handleAddTask}
              className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded transition-colors"
              style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
              <Plus className="w-3 h-3" /> Add Task
            </button>
          </div>

          {localTasks.length === 0 ? (
            <div className="text-[11px] font-mono italic py-6 text-center" style={{ color: '#78716c' }}>
              No tasks in this template. Add one to get started.
            </div>
          ) : (
            <div>
              {/* Header */}
              <div className="flex gap-1 px-1 py-1.5" style={{ borderBottom: '2px solid #44403c' }}>
                <div className="text-[10px] font-mono uppercase tracking-wider font-semibold" style={{ color: '#a8a29e', flex: 3 }}>Task Name</div>
                <div className="text-[10px] font-mono uppercase tracking-wider font-semibold" style={{ color: '#a8a29e', flex: 1.5 }}>Role</div>
                <div className="text-[10px] font-mono uppercase tracking-wider font-semibold text-center" style={{ color: '#a8a29e', flex: 0.8 }}>Days</div>
                <div className="text-[10px] font-mono uppercase tracking-wider font-semibold" style={{ color: '#a8a29e', flex: 2 }}>Depends On</div>
                <div style={{ width: 28 }} />
              </div>

              {/* Rows */}
              {localTasks.map((task, idx) => (
                <TemplateTaskRow
                  key={task.id}
                  task={task}
                  allTasks={localTasks}
                  taskById={taskById}
                  onUpdate={(patch) => handleUpdateTask(task.id, patch)}
                  onDelete={() => handleDeleteTask(task.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid #44403c' }}>
          <span className="text-[10px] font-mono" style={{ color: '#78716c' }}>
            Total: <span style={{ color: '#f4a261', fontWeight: 'bold' }}>
              {localTasks.reduce((sum, t) => sum + (t.bid_days || 0), 0)}d
            </span>
          </span>
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


// ───────────────��───────────────────────────��─────────
// TEMPLATE TASK ROW
// ─────────────────────────────────────────────────────
function TemplateTaskRow({ task, allTasks, taskById, onUpdate, onDelete }) {
  const [hovered, setHovered] = useState(false)

  // Dependency selector
  const availableDeps = allTasks.filter(t => t.id !== task.id)
  const currentDeps = task.depends_on || []

  function toggleDep(depId) {
    const next = currentDeps.includes(depId)
      ? currentDeps.filter(d => d !== depId)
      : [...currentDeps, depId]
    onUpdate({ depends_on: next })
  }

  return (
    <div className="flex gap-1 px-1 items-center"
      style={{
        borderBottom: '1px solid #292524',
        backgroundColor: hovered ? 'rgba(41, 37, 36, 0.5)' : 'transparent',
        transition: 'background-color 150ms ease',
        minHeight: 36,
      }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>

      {/* Name */}
      <div style={{ flex: 3 }}>
        <EditableText
          value={task.name || ''}
          placeholder="Task name..."
          onCommit={(name) => onUpdate({ name })}
        />
      </div>

      {/* Role */}
      <div style={{ flex: 1.5 }}>
        <select
          value={task.role_slug || ''}
          onChange={e => onUpdate({ role_slug: e.target.value || '' })}
          className="w-full px-1 py-0.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 hover:bg-stone-700/40 transition-colors"
          style={{ backgroundColor: 'transparent', color: task.role_slug ? '#d6d3d1' : '#57534e', border: '1px solid transparent' }}>
          <option value="">--</option>
          {DEFAULT_ROLES.map(r => <option key={r} value={r}>{fmt(r)}</option>)}
        </select>
      </div>

      {/* Days */}
      <div style={{ flex: 0.8, textAlign: 'center' }}>
        <input
          type="number"
          min={0}
          step={0.5}
          value={task.bid_days ?? ''}
          onChange={e => onUpdate({ bid_days: parseFloat(e.target.value) || 0 })}
          className="w-full px-1 py-0.5 text-[11px] font-mono text-center rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
          style={{ backgroundColor: 'transparent', color: '#f4a261', border: '1px solid transparent' }}
        />
      </div>

      {/* Dependencies */}
      <div style={{ flex: 2 }}>
        <DependencyPicker
          currentDeps={currentDeps}
          availableDeps={availableDeps}
          taskById={taskById}
          onToggle={toggleDep}
        />
      </div>

      {/* Delete */}
      <div style={{ width: 28 }}>
        <button type="button" onClick={onDelete}
          className="p-1 rounded hover:bg-stone-700 transition-colors"
          style={{ color: '#fca5a5', opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity 150ms ease' }}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}


// ────────────────��────────────────────────────────────
// DEPENDENCY PICKER — multi-select dropdown
// ─────────────────────────────────────────────────────
function DependencyPicker({ currentDeps, availableDeps, taskById, onToggle }) {
  const [open, setOpen] = useState(false)

  if (availableDeps.length === 0) {
    return <span className="text-[10px] font-mono italic" style={{ color: '#57534e' }}>--</span>
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full px-1 py-0.5 text-[11px] font-mono rounded hover:bg-stone-700/40 transition-colors text-left"
        style={{ color: currentDeps.length ? '#d6d3d1' : '#57534e', border: '1px solid transparent' }}>
        {currentDeps.length === 0 ? (
          <span className="flex items-center gap-1">
            <Link2 className="w-3 h-3" style={{ color: '#57534e' }} />
            None
          </span>
        ) : (
          <span className="truncate">
            {currentDeps.map(id => taskById[id]?.name || 'Unknown').join(', ')}
          </span>
        )}
        <ChevronDown className="w-3 h-3 ml-auto flex-shrink-0" style={{ color: '#78716c' }} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-full left-0 mt-1 py-1 rounded shadow-lg min-w-[200px] max-h-[180px] overflow-auto"
            style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}>
            {availableDeps.map(dep => {
              const checked = currentDeps.includes(dep.id)
              return (
                <button key={dep.id} type="button"
                  onClick={() => onToggle(dep.id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-stone-700/50 transition-colors"
                  style={{ color: checked ? '#fb923c' : '#d6d3d1' }}>
                  <span className="w-3 h-3 rounded-sm flex items-center justify-center flex-shrink-0"
                    style={{
                      backgroundColor: checked ? '#ea580c' : 'transparent',
                      border: `1px solid ${checked ? '#ea580c' : '#44403c'}`,
                    }}>
                    {checked && <span className="text-[8px] text-white font-bold">{'\u2713'}</span>}
                  </span>
                  <span className="text-[11px] font-mono truncate">
                    {dep.name || 'Untitled'}
                  </span>
                  {dep.bid_days > 0 && (
                    <span className="text-[9px] font-mono ml-auto flex-shrink-0" style={{ color: '#78716c' }}>
                      {dep.bid_days}d
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────
// TEMPLATE SCOPE (global vs project-specific)
// ─────────────────────────────────────────────────────
function TemplateScope({ template, projects, onUpdate }) {
  const isProjectSpecific = !!template.project_id

  return (
    <div className="flex items-center gap-1.5">
      <button type="button"
        onClick={() => onUpdate({ project_id: isProjectSpecific ? null : (projects[0]?.id || null) })}
        className="w-3 h-3 rounded-sm flex items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: isProjectSpecific ? '#ea580c' : 'transparent',
          border: `1px solid ${isProjectSpecific ? '#ea580c' : '#44403c'}`,
        }}
        title={isProjectSpecific ? 'Project-specific' : 'Global (all projects)'}>
        {isProjectSpecific && <span className="text-[7px] text-white font-bold">{'\u2713'}</span>}
      </button>
      {isProjectSpecific ? (
        <select
          value={template.project_id || ''}
          onChange={e => onUpdate({ project_id: e.target.value || null })}
          className="px-1 py-0.5 text-[10px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
          style={{ backgroundColor: 'transparent', color: '#d6d3d1', border: '1px solid transparent', maxWidth: 120 }}>
          <option value="">--</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.title || 'Untitled'}</option>)}
        </select>
      ) : (
        <span className="text-[10px] font-mono" style={{ color: '#78716c' }}>Global</span>
      )}
    </div>
  )
}


// ──────────────��───────────────────────────────��──────
// TEMPLATE NAME (inline edit)
// ─────────────────────────────────────────────────────
function TemplateName({ template, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(template.name || '')

  useEffect(() => { setDraft(template.name || '') }, [template.name])

  function commit() {
    setEditing(false)
    if (draft !== template.name) onUpdate(draft)
  }

  if (editing) {
    return (
      <input autoFocus value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(template.name); setEditing(false) } }}
        className="w-full px-1.5 py-0.5 text-[11px] font-mono font-bold rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}
      />
    )
  }
  return (
    <button type="button" onClick={() => { setDraft(template.name || ''); setEditing(true) }}
      className="text-[11px] font-mono font-bold text-left w-full truncate hover:bg-stone-700/40 px-1.5 py-0.5 rounded transition-colors"
      style={{ color: '#e7e5e4' }}>
      {template.name || 'Untitled'}
    </button>
  )
}


// ───────────────────────────────────────────────���─────
// EDITABLE TEXT (generic inline editor)
// ─────────────────────────────────────────────────────
function EditableText({ value, placeholder, onCommit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  if (editing) {
    return (
      <input autoFocus value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        className="w-full px-1.5 py-0.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}
      />
    )
  }
  return (
    <button type="button" onClick={() => { setDraft(value); setEditing(true) }}
      className="text-[11px] font-mono text-left w-full truncate hover:bg-stone-700/40 px-1.5 py-0.5 rounded transition-colors"
      style={{ color: value ? '#e7e5e4' : '#57534e' }}>
      {value || placeholder || '\u2014'}
    </button>
  )
}


// ─────────────────────────────────────────────────────
// CONFIRM DELETE DIALOG
// ─────────────────────────────────────────────────────
function ConfirmDeleteDialog({ onConfirm, onCancel }) {
  return (
    <>
      <div className="fixed inset-0 z-[80]" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onCancel} />
      <div className="fixed z-[80] top-1/2 left-1/2 w-full max-w-sm rounded overflow-hidden"
        style={{
          backgroundColor: '#292524',
          border: '2px solid #ef4444',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4" style={{ color: '#fca5a5' }} />
            <span className="text-[13px] font-mono font-bold" style={{ color: '#fca5a5' }}>Delete Template?</span>
          </div>
          <p className="text-[11px] font-mono" style={{ color: '#a8a29e' }}>
            This action cannot be undone. The template and all its tasks will be permanently removed.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button" onClick={onCancel}
            className="px-3 py-1.5 text-[11px] font-mono rounded transition-colors"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            className="px-3 py-1.5 text-[11px] font-mono rounded transition-colors"
            style={{ color: '#fff', backgroundColor: '#dc2626', border: '1px solid #b91c1c' }}>
            Delete
          </button>
        </div>
      </div>
    </>
  )
}


// ─────────────────────────────────────────────────────
// TABLE ATOMS
// ───────────────────────────────────────────────���─────
function Th({ children, style: extra }) {
  return (
    <th className="px-3 py-2.5 text-[10px] font-mono uppercase tracking-wider font-semibold text-left"
      style={{ color: '#a8a29e', borderBottom: '2px solid #44403c', ...extra }}>
      {children}
    </th>
  )
}
function Td({ children, style: extra }) {
  return (
    <td className="px-3 py-2 align-middle" style={extra}>
      {children}
    </td>
  )
}
