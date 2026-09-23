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
import { Dialog, Button, Field, StatusDot, statusMeta } from '../../../ui'
// Priority as a status tone, from the one place that decides it (the
// Dashboard's task table, and the popup, say the same thing).
import { priorityTone } from '../../../components/Dashboard/dashboardTaskModel'
import '../views/rabbitTasks.css'

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

  return (
    <Dialog
      width="form"
      title="New task"
      // The backdrop closed it before and still does; Escape closes it too
      // (Q17), and the busy lock keeps it open while the create is in flight.
      dismissOnBackdrop
      busy={creating}
      // A failed create must say so — the swallowed rejection is what made
      // every earlier failure look like an inert button. The kit's Dialog
      // reports it INSIDE the footer, beside the button that failed.
      error={error}
      onClose={onClose}
      footer={(
        <>
          <span className="rb-task-new-note">
            Nothing is saved until you confirm.
          </span>
          <Button onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm}
            disabled={!draft.title.trim()}
            loading={creating}
            loadingLabel="Creating...">
            Confirm & Create
          </Button>
        </>
      )}
    >
      <div className="ui-field-stack">
        <Field label="Title">
          <input
            autoFocus
            value={draft.title}
            onChange={e => patch({ title: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm() }}
            placeholder="What needs doing?"
            className="ui-input"
          />
        </Field>

        <Field label="Phase">
          <select
            value={draft.phase_id}
            onChange={e => patch({ phase_id: e.target.value })}
            className="ui-input rb-task-prop"
            data-empty={draft.phase_id ? 'false' : 'true'}
          >
            <option value="">(no phase)</option>
            {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
          </select>
        </Field>

        <Field label="Asset" hint="Optional — narrows the task to one deliverable">
          <select
            value={draft.asset_id}
            onChange={e => patch({ asset_id: e.target.value })}
            className="ui-input rb-task-prop"
            data-empty={draft.asset_id ? 'false' : 'true'}
          >
            <option value="">(no asset &mdash; task lives directly under the phase)</option>
            {assets.map(a => <option key={a.id} value={a.id}>{a.name || 'Untitled'}</option>)}
          </select>
        </Field>

        <div className="rb-task-prop-grid">
          <Field label="Start date">
            <input type="date" value={draft.start_date}
              onChange={e => patch({ start_date: e.target.value })}
              className="ui-input rb-task-prop rb-task-prop-date"
              data-empty={draft.start_date ? 'false' : 'true'} />
          </Field>
          <Field label="End date">
            <input type="date" value={draft.end_date}
              onChange={e => patch({ end_date: e.target.value })}
              className="ui-input rb-task-prop rb-task-prop-date"
              data-empty={draft.end_date ? 'false' : 'true'} />
          </Field>
        </div>

        <div className="rb-task-prop-grid">
          <Field label="Bid days">
            <input type="number" min="0" step="0.25" value={draft.bid_days}
              onChange={e => patch({ bid_days: e.target.value })}
              className="ui-input rb-task-prop-number" />
          </Field>
          <Field label="Assigned to">
            <select
              value={draft.assignee_id}
              onChange={e => patch({ assignee_id: e.target.value })}
              className="ui-input rb-task-prop"
              data-empty={draft.assignee_id ? 'false' : 'true'}
            >
              <option value="">-- unassigned --</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="rb-task-prop-grid">
          <Field label="Priority">
            <select value={draft.priority} onChange={e => patch({ priority: e.target.value })}
              className="ui-input rb-task-prop"
              data-tone={priorityTone(draft.priority)}>
              {PRIORITIES.map(p => <option key={p} value={p}>{fmt(p)}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <span className="rb-task-status-select">
              <StatusDot status={draft.status} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
              <select value={draft.status} onChange={e => patch({ status: e.target.value })}
                className="ui-input rb-task-status-input">
                {TASK_STATUSES.map(s => <option key={s} value={s}>{statusMeta(s).label}</option>)}
              </select>
            </span>
          </Field>
        </div>
      </div>
    </Dialog>
  )
}
