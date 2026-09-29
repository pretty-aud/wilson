// ============================================================
// AssetStatusWarningModal
// ============================================================
//
// Modal that explains why a given asset is currently flagged
// with a status mismatch — i.e. the user marked it
// approved/final but at least one child task is still in
// flight. Lists every offending task and lets the user either:
//
//   • Bump the asset back to a "safer" status (in_progress).
//   • Force-confirm by clicking through (no-op — the asset
//     stays as-is, the modal just closes).
//
// Pure presentation + a couple of provider hooks. Owned by
// ProjectAssetsView, which decides when to mount it.
//
// UI overhaul B4c, surface 7 (2026-09-25): the kit Dialog (R4-12) at the
// confirm width — 400, the token nearest the 448px panel it was — on lane
// B4's sheet, rabbitFiles.css (`rb-warn-`), portalled into <body> as the
// lane's other dialogs are (the kit Dialog does not portal, B4-KR-2). The kit
// brings the one backdrop, surface, radius and shadow, the title at the H2
// step in sentence case (it was capitals), a named Close (the old ✕ had no
// name) and Escape and the focus trap on the modal stack (Q17); a press on
// the backdrop still closes it, as a click there did. R4-30: the asset's
// status was a green chip whatever the status was — it is the kit StatusBadge
// on the asset's own status now, and each pending task's chip is the same
// badge on that task's own status. "Bump to in-progress" is the kit primary
// (it was white on the signal, 3.35:1) and "Keep as-is" the kit secondary.
// Every word of the message and what each button does are unchanged (C1): the
// walk proves the dialog open by "still in flight". No window.confirm here.

import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowDownCircle, Check } from 'lucide-react'
import { Dialog, Button, StatusBadge } from '../../../ui'
import '../views/rabbitFiles.css'
import { useRabbit } from '../state/RabbitProvider'

export default function AssetStatusWarningModal({ asset, onClose }) {
  const ctx = useRabbit()
  const tasks = ctx?.tasks || []
  if (!asset) return null

  const childTasks = tasks.filter(t => t.asset_id === asset.id)
  const pending = childTasks.filter(t => !isDone(t))

  async function handleBumpBack() {
    try {
      await ctx.updateAsset(asset.id, { status: 'in_progress' })
    } catch (err) {
      console.warn('[RABBIT] failed to bump asset status:', err)
    } finally {
      onClose?.()
    }
  }

  return createPortal(
    <Dialog
      width="confirm"
      // A title that is a node names nothing: the dialog carries its title
      // as its name.
      aria-label="Status mismatch"
      // The warning glyph in the danger ink, as the table's "Tasks not yet
      // done" control that opens this dialog draws it.
      title={(
        <span className="rb-warn-title">
          <AlertTriangle className="rb-warn-icon" aria-hidden="true" />
          Status mismatch
        </span>
      )}
      // The backdrop closed it before, and still does.
      dismissOnBackdrop
      onClose={onClose}
      footer={(
        <>
          <Button Icon={Check} onClick={onClose}>
            Keep as-is
          </Button>
          <Button variant="primary" Icon={ArrowDownCircle} onClick={handleBumpBack}>
            Bump to in-progress
          </Button>
        </>
      )}
    >
      <div className="rb-warn-body">
        <p className="rb-warn-msg">
          <span className="rb-warn-name">{asset.name}</span> is marked{' '}
          <StatusBadge status={asset.status || 'not_started'} />{' '}
          but {pending.length} of its {childTasks.length} task{childTasks.length === 1 ? '' : 's'}
          {pending.length === 1 ? ' is' : ' are'} still in flight.
        </p>

        {pending.length > 0 && (
          <div className="rb-warn-tasks">
            <div className="rb-warn-tasks-head">
              Pending tasks
            </div>
            <div className="rb-warn-list">
              {pending.map(t => (
                <div key={t.id} className="rb-warn-task">
                  <span className="rb-warn-task-title">
                    {t.title}
                  </span>
                  {/* A task with no status keeps its dash. */}
                  <StatusBadge status={t.status} label={t.status ? undefined : '—'} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>,
    document.body,
  )
}

function isDone(task) {
  return task && (task.status === 'approved' || task.status === 'final' || task.status === 'omitted')
}
