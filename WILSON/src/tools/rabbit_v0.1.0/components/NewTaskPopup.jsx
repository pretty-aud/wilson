// =============================================================================
// NewTaskPopup (Session 23) — draft locally, commit on confirm.
//
// Audrey: "when i press new task the task pop up window should come up for the
// user to add the details of the task", then "switch it" to the New Asset
// shape — nothing saved until you confirm. The first cut created the row and
// then opened the detail popup on it, which left an untitled task behind
// whenever the popup was dismissed.
//
// Deliberately mirrors NewAssetPopup in ProjectAssetsView: same modal frame,
// same "Nothing is saved until you confirm" footer, same error box. Two
// creation dialogs in one tool that behave differently is its own defect.
//
// Every field here is a REAL column on public.tasks:
//   * asset_id is OPTIONAL — 0034 dropped its NOT NULL (Audrey: "not all tasks
//     need assets"), which is what made task creation fail entirely before.
//   * phase_id is the column 0034 added, so a task with no asset still has a
//     home in the hierarchy.
// Anything not on that column list would be stripped by supabaseAdapter's
// COLUMN_ALLOWLIST with a console warning rather than reaching PostgREST —
// which is the mechanism that made every earlier create fail silently.
//
// Constants are local rather than imported from the view, matching
// TaskDetailPopup, which defines its own TASK_STATUSES for the same reason.
// =============================================================================

import { useState } from 'react'

const TASK_STATUSES = [
  'waiting_to_start', 'in_progress', 'pending_review', 'needs_revisions',
  'approved', 'final', 'blocked', 'on_hold', 'omitted',
]

const PRIORITIES = ['low', 'medium', 'high', 'urgent']

function fmt(s) {
  if (!s) return ''
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function NewTaskPopup({
  ctx,
  defaults = {},
  phases = [],
  assets = [],
  members = [],
  onCreated,
  onClose,
}) {
  const [draft, setDraft] = useState({
    // Seeded, NOT blank: the Board's inline column input passes the title the
    // user already typed (ProjectTasksView commitAdd). Hardcoding '' here
    // would silently discard it the moment they pressed Enter — the same
    // "I typed it and it vanished" failure this session set out to fix.
    title:       defaults.title       || '',
    phase_id:    defaults.phase_id    || '',
    asset_id:    defaults.asset_id    || '',
    start_date:  defaults.start_date  || '',
    end_date:    defaults.end_date    || '',
    bid_days:    defaults.bid_days ?? '',
    assignee_id: defaults.assignee_id || '',
    priority:    defaults.priority    || 'medium',
    status:      defaults.status      || 'waiting_to_start',
  })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  function patch(p) { setDraft(prev => ({ ...prev, ...p })) }

  async function handleConfirm() {
    if (!ctx?.addTask || !draft.title.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      await ctx.addTask({
        title:       draft.title.trim(),
        phase_id:    draft.phase_id    || null,
        asset_id:    draft.asset_id    || null,
        start_date:  draft.start_date  || null,
        end_date:    draft.end_date    || null,
        bid_days:    draft.bid_days === '' || draft.bid_days == null ? null : Number(draft.bid_days),
        assignee_id: draft.assignee_id || null,
        priority:    draft.priority,
        status:      draft.status,
      })
      onCreated?.()
    } catch (err) {
      // Keep the dialog open with the user's input so they can retry.
      setError(err?.message || String(err))
    } finally {
      setCreating(false)
    }
  }

  const labelCls = 'text-[9.5px] font-mono uppercase tracking-wider mb-1 block'
  const fieldCls = 'w-full px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500'
  const fieldStyle = { backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      <div
        className="fixed z-50 top-1/2 left-1/2 w-full max-w-lg rounded overflow-hidden flex flex-col"
        style={{
          backgroundColor: '#292524',
          border: '2px solid #f97316',
          maxHeight: '85vh',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #44403c' }}>
          <span className="text-[12px] font-mono font-bold uppercase tracking-wider" style={{ color: '#f97316' }}>
            New Task
          </span>
          <button type="button" onClick={onClose} className="text-[13px] font-mono" style={{ color: '#78716c' }}>
            &#10005;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4 flex flex-col gap-4">
          <div>
            <label className={labelCls} style={{ color: '#78716c' }}>Title</label>
            <input
              autoFocus
              value={draft.title}
              onChange={e => patch({ title: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirm() }}
              placeholder="What needs doing?"
              className={fieldCls}
              style={fieldStyle}
            />
          </div>

          <div>
            <label className={labelCls} style={{ color: '#78716c' }}>Phase</label>
            <select
              value={draft.phase_id}
              onChange={e => patch({ phase_id: e.target.value })}
              className={fieldCls}
              style={{ ...fieldStyle, color: draft.phase_id ? '#d6d3d1' : '#57534e' }}
            >
              <option value="">(no phase)</option>
              {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls} style={{ color: '#78716c' }}>
              Asset (optional &mdash; narrows the task to one deliverable)
            </label>
            <select
              value={draft.asset_id}
              onChange={e => patch({ asset_id: e.target.value })}
              className={fieldCls}
              style={{ ...fieldStyle, color: draft.asset_id ? '#d6d3d1' : '#57534e' }}
            >
              <option value="">(no asset &mdash; task lives directly under the phase)</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.name || 'Untitled'}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} style={{ color: '#78716c' }}>Start Date</label>
              <input type="date" value={draft.start_date}
                onChange={e => patch({ start_date: e.target.value })}
                className={fieldCls} style={fieldStyle} />
            </div>
            <div>
              <label className={labelCls} style={{ color: '#78716c' }}>End Date</label>
              <input type="date" value={draft.end_date}
                onChange={e => patch({ end_date: e.target.value })}
                className={fieldCls} style={fieldStyle} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} style={{ color: '#78716c' }}>Bid Days</label>
              <input type="number" min="0" step="0.25" value={draft.bid_days}
                onChange={e => patch({ bid_days: e.target.value })}
                className={fieldCls} style={fieldStyle} />
            </div>
            <div>
              <label className={labelCls} style={{ color: '#78716c' }}>Assigned To</label>
              <select
                value={draft.assignee_id}
                onChange={e => patch({ assignee_id: e.target.value })}
                className={fieldCls}
                style={{ ...fieldStyle, color: draft.assignee_id ? '#f4a261' : '#57534e' }}
              >
                <option value="">-- unassigned --</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} style={{ color: '#78716c' }}>Priority</label>
              <select value={draft.priority} onChange={e => patch({ priority: e.target.value })}
                className={fieldCls} style={fieldStyle}>
                {PRIORITIES.map(p => <option key={p} value={p}>{fmt(p)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={{ color: '#78716c' }}>Status</label>
              <select value={draft.status} onChange={e => patch({ status: e.target.value })}
                className={fieldCls} style={fieldStyle}>
                {TASK_STATUSES.map(s => <option key={s} value={s}>{fmt(s)}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* A failed create must say so — the swallowed rejection is what made
            every earlier failure look like an inert button. */}
        {error && (
          <div
            className="mx-5 mb-3 px-3 py-2 text-[11.5px] font-mono rounded"
            style={{ color: '#fecaca', backgroundColor: 'rgba(153,27,27,0.25)', border: '1px solid #991b1b' }}
          >
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid #44403c' }}>
          <span className="text-[10.5px] font-mono" style={{ color: '#57534e' }}>
            Nothing is saved until you confirm.
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-1.5 text-[11.5px] font-mono rounded transition-colors"
              style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
              Cancel
            </button>
            <button type="button" onClick={handleConfirm}
              disabled={!draft.title.trim() || creating}
              className="px-4 py-1.5 text-[11.5px] font-mono font-bold uppercase tracking-wider rounded transition-colors disabled:opacity-40"
              style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
              {creating ? 'Creating...' : 'Confirm & Create'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
