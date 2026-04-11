// ============================================================
// RABBIT — TaskDetailPopup (shared)
// ============================================================
//
// Single source of truth for the task detail/edit popup, used
// by both the Tasks tab and the Timeline tab. Receives a taskId
// and looks up everything it needs from RabbitProvider context.
//
// Features:
//   - Editable title, status, priority, asset, phase, assignee,
//     dates, bid days, description, notes
//   - FileManager section for asset-linked tasks with an editable
//     file-name preview (naming system override)
//   - Live updates — each field change saves immediately via
//     ctx.updateTask
//   - WILSON modal style: 2px solid #f97316 border, orange text

import { useState, useEffect, useMemo } from 'react'
import { ListChecks, X, Trash2, DollarSign } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import { useRateCard } from '../../../components/RateCard/useRateCard'
import FileManager from './FileManager'

// ── Constants ──
const TASK_STATUSES = [
  'waiting_to_start','in_progress','pending_review','revisions',
  'approved','final','blocked','on_hold','omitted',
]
const PRIORITIES = ['low','medium','high','urgent']

function statusColor(status) {
  switch (status) {
    case 'in_progress':    return '#fb923c'
    case 'pending_review': return '#fbbf24'
    case 'revisions':      return '#f97316'
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
  const assets = ctx?.assets || []
  const phases = ctx?.phases || []
  const teamAssignments = ctx?.teamAssignments || []

  const tm = useTeamMembers()
  const memberById = useMemo(() => {
    const m = {}; for (const mb of tm.members) m[mb.id] = mb; return m
  }, [tm.members])
  const projectMembers = useMemo(() => {
    return teamAssignments.map(a => memberById[a.member_id]).filter(Boolean)
  }, [teamAssignments, memberById])

  // Rate card — for role dropdown and bid total calculation
  const rc = useRateCard()
  const roleEntries = useMemo(() => {
    // Deduplicate by role_slug, keeping the first match
    const seen = new Set()
    return (rc.entries || []).filter(e => {
      if (!e.role_slug || seen.has(e.role_slug)) return false
      seen.add(e.role_slug)
      return true
    })
  }, [rc.entries])

  // Look up the rate for the task's current role
  const currentRoleEntry = useMemo(() => {
    if (!task?.assigned_role_slug) return null
    return (rc.entries || []).find(e => e.role_slug === task.assigned_role_slug) || null
  }, [rc.entries, task?.assigned_role_slug])

  const dayRate = currentRoleEntry?.day_rate ?? null
  const bidTotal = (dayRate != null && task?.bid_days != null)
    ? dayRate * task.bid_days
    : null

  // Description editing
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState(task?.description || '')
  useEffect(() => { setDescDraft(task?.description || '') }, [task?.description])

  // Notes editing
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState(task?.notes || '')
  useEffect(() => { setNotesDraft(task?.notes || '') }, [task?.notes])

  // File name override for the naming system
  const [fileNameOverride, setFileNameOverride] = useState(task?.title || '')
  const [editingFileName, setEditingFileName] = useState(false)
  const [fileNameDraft, setFileNameDraft] = useState(task?.title || '')
  useEffect(() => {
    // Auto-sync file name with title unless user has manually overridden
    if (!editingFileName) setFileNameOverride(task?.title || '')
  }, [task?.title])

  if (!task) return null

  const sc = statusColor(task.status)
  const pc = priorityColor(task.priority)
  const linkedAsset = task.asset_id ? assets.find(a => a.id === task.asset_id) : null

  function handleUpdate(patch) { ctx?.updateTask?.(task.id, patch) }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      {/* Modal */}
      <div
        className="fixed z-50 top-1/2 left-1/2 w-full max-w-2xl rounded overflow-hidden flex flex-col"
        style={{ backgroundColor: '#292524', border: '2px solid #f97316', maxHeight: '85vh', transform: 'translate(-50%, -50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
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

        {/* Scrollable body */}
        <div className="flex-1 overflow-auto px-5 py-4">

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
                {TASK_STATUSES.map(s => <option key={s} value={s}>{fmt(s)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Priority</FieldLabel>
              <select value={task.priority || 'medium'} onChange={e => handleUpdate({ priority: e.target.value })}
                className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: pc, border: '1px solid #44403c' }}>
                {PRIORITIES.map(p => <option key={p} value={p}>{fmt(p)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Asset</FieldLabel>
              <select value={task.asset_id || ''} onChange={e => handleUpdate({ asset_id: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: task.asset_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                <option value="">--</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.name || 'Untitled'}</option>)}
              </select>
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
            <div>
              <FieldLabel>Assignee</FieldLabel>
              <select value={task.assignee_id || ''} onChange={e => handleUpdate({ assignee_id: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: task.assignee_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                <option value="">--</option>
                {projectMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
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

          {/* ── Asset files section ── */}
          {linkedAsset && (
            <div className="pt-4" style={{ borderTop: '1px solid #44403c' }}>
              <div className="flex items-center gap-2 mb-3">
                <FieldLabel>Files — {linkedAsset.name || 'Untitled asset'}</FieldLabel>
              </div>

              {/* File name override — shows what uploaded files will be named */}
              <div className="mb-3">
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
                    className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  />
                ) : (
                  <button type="button"
                    onClick={() => { setFileNameDraft(fileNameOverride); setEditingFileName(true) }}
                    className="w-full text-left px-2.5 py-1.5 text-[12px] font-mono rounded hover:bg-stone-700/40 transition-colors"
                    style={{ color: fileNameOverride ? '#f4a261' : '#57534e', border: '1px dashed #44403c' }}>
                    {fileNameOverride || 'Uses original file name'}
                  </button>
                )}
                <div className="text-[9px] font-mono mt-0.5" style={{ color: '#44403c' }}>
                  Click to change the name files will be saved as
                </div>
              </div>

              <FileManager
                files={ctx?.managedFiles || []}
                assetId={linkedAsset.id}
                assetName={linkedAsset.name}
                projectId={ctx?.activeProjectId}
                project={ctx?.project}
                mode="readonly"
                taskTitle={fileNameOverride || null}
                taskId={task.id}
                onFileAdded={() => ctx?.refreshManagedFiles?.()}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button"
            onClick={() => { if (window.confirm(`Delete task "${task.title || 'Untitled'}"?`)) { ctx?.deleteTask?.(task.id); onClose() } }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono rounded hover:bg-stone-700 transition-colors"
            style={{ color: '#fca5a5', border: '1px solid #44403c' }}>
            <Trash2 className="w-3.5 h-3.5" /> Delete task
          </button>
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
