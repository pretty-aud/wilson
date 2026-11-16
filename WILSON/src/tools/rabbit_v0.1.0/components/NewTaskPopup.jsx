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
//
// VW1m (2026-10-16): a task made from a group of the Tasks table or a column
// of its Board carries that group's items (`defaults.items`, `{ asset: [ids],
// scene: [...], … }`): shown read-only here, by name in the display order,
// and passed to ctx.addTask as `items`. Q-N5's interim keeps one of each
// kind on this form: the one-asset choice stays for a task with one asset or
// none, and more are added in the task's window.
// =============================================================================

import { useState } from 'react'
import { Dialog, Button, Field, StatusDot, statusMeta } from '../../../ui'
import { ITEM_KINDS, KIND_LABEL, KIND_LABEL_PLURAL } from '../state/taskItemsModel'
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
  itemLookup = null,
  members = [],
  onCreated,
  onClose,
}) {
  // The items the group carried, each kind's ids in the display order (a
  // kind with none is left out). Fixed for the draft: they are the group's.
  const [carried] = useState(() => {
    const out = []
    for (const kind of ITEM_KINDS) {
      const ids = Array.isArray(defaults.items?.[kind]) ? defaults.items[kind].filter(id => id != null && id !== '') : []
      if (ids.length === 0) continue
      const sorted = itemLookup ? ids.slice().sort(itemLookup.orderOf(kind)) : ids
      const names = sorted.map(id => itemLookup?.nameOf(kind, id) || 'Untitled').join(', ')
      out.push({ kind, ids: sorted, names })
    }
    return out
  })
  const carriesAsset = carried.some(c => c.kind === 'asset')
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
      const row = {
        title:       draft.title.trim(),
        phase_id:    draft.phase_id    || null,
        start_date:  draft.start_date  || null,
        end_date:    draft.end_date    || null,
        bid_days:    draft.bid_days === '' || draft.bid_days == null ? null : Number(draft.bid_days),
        assignee_id: draft.assignee_id || null,
        priority:    draft.priority,
        status:      draft.status,
      }
      // The one-asset choice, as before; carried items go as `items` (the
      // provider writes them as the task's items), never as a single field.
      if (!carriesAsset) row.asset_id = draft.asset_id || null
      if (carried.length) row.items = Object.fromEntries(carried.map(c => [c.kind, c.ids]))
      await ctx.addTask(row)
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
            loadingLabel="Creating…">
            Confirm & create
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

        {!carriesAsset && (
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
        )}

        {/* VW1m: the group's items, read-only (more are added in the task's
            window once it exists). */}
        {carried.map(c => (
          <Field key={c.kind} label={c.ids.length === 1 ? KIND_LABEL[c.kind] : KIND_LABEL_PLURAL[c.kind]}
            hint="From the group it is made in. Add more in the task's window.">
            <div className="rb-task-readout" title={c.names}>{c.names}</div>
          </Field>
        ))}

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
          <Field label="Assignee">
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
