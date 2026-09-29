// =============================================================================
// DependencyStatusGuard.jsx — Phase 7, Track A bundle A2 (2026-09-06).
//
// The warn-don't-block gate every task and phase status write goes through.
//
//   const guard = useDependencyStatusGuard(ctx)
//   guard.update({ ids: task.id, patch, write: () => ctx.updateTask(task.id, patch) })
//   …
//   {guard.modal}
//
// `update` runs `write()` at once when the patch does not move anything INTO
// a completion status (approved / final / completed) over an unfinished
// predecessor. Otherwise it parks the write, shows the modal, and runs it when
// the person chooses "Continue anyway".
//
// 🚨 EVERY OTHER WAY OUT CANCELS: "Go back", the X, a click outside the
// card and the Escape key all drop the parked write, and nothing is saved.
// (R1 checked that list against the code and Escape was NOT on it — it did
// nothing at all, which under this ruling is the one gesture most likely to be
// tried and the one whose silence would read as a frozen modal. It cancels
// now.) **Audrey ruled this on
// 2026-09-07 and it REVERSES what A2 session 1 shipped.** That session read the
// Phase 7 brief's "dismissible" as "dismissing still lands the change", said so
// here at length, and named the two handlers marked DISMISS below as the whole
// change if she read it the other way. She read it the other way. This is that
// change; the reading it replaces is gone rather than argued with, because a
// header that still argued for it would be the next session's trap.
//
// Why this is also the safer shape, independent of the ruling: this is the only
// modal in the product whose CLOSE performs a write that has not happened yet.
// AssetStatusWarningModal warns AFTER its write, so closing that one keeps a
// change already saved — it was never a precedent. Closing something that has
// not saved yet reads as "never mind" everywhere else in this app. The warning
// is still not a block: "Continue anyway" is one deliberate click away, and it
// is now the ONLY control that writes.
//
// Nothing is lost by cancelling, because no surface holds the status in local
// state: the inline dropdowns bind `value={task.status}`, both drop targets
// read the row, and the timeline editor stays open with its draft intact. The
// control snaps back to the stored value on its own. This is not a new code
// path either — it is the path "Go back" has always taken.
// Bulk writes pass every id and get one summary ("3 of 12 have unfinished
// dependencies"), never one modal per row. Audrey, 2026-08-12: "warn dont
// block. do both phases and tasks".
//
// Why a hook per surface and not one provider: the surfaces are table rows,
// kanban columns, popups and an editor that already stacks over the timeline.
// A hook owns its own pending state and renders the modal through a portal
// into document.body, so it works from inside a <tr> and above any modal
// without threading props through five components. The cost is one idle hook
// per row, which is nothing.
//
// The decision itself is pure (state/dependencyStatus.js) and unit-tested;
// this file is the React around it. Nothing here blocks: the write the person
// asked for always goes through if they say so, and no constraint exists in
// the database (the Phase 7 brief forbids one — it would make the warning
// blocking through the back door and reject the desktop path).
//
// Desktop and cloud: the check reads ctx.dependencies / ctx.tasks /
// ctx.phases, which BOTH adapters load into the provider bundle
// (localServerAdapter.loadProject and supabaseAdapter.loadProject each return
// `dependencies`), so it behaves the same on Local Server and Supabase. Where
// a surface has NO dependency data (the Dashboard's cross-project task model,
// useMyTasks) the pure check returns null and the write proceeds — that
// surface is listed as unwired in dependencyStatusSurfaces.test.js, not
// silently covered.
//
// ── Merged over the UI overhaul (2026-09-29) ─────────────────────────────────
// The modal is drawn with the kit's dialog classes (`ui-dialog-backdrop`,
// `ui-dialog`, its head / body / foot, `ui-iconbtn`, `ui-btn`) and lane B4's
// warning-list classes (`rb-warn-`, rabbitFiles.css — the same anatomy as
// AssetStatusWarningModal, its sibling warning), with the kit StatusBadge for
// every status word. It is NOT the kit <Dialog> component, on purpose: that
// component owns Escape, the backdrop and the X, and this modal's rulings on
// all three are pinned by dependencyStatusSurfaces.test.js in their own words
// (the capture-phase Escape, both ends of a backdrop click, an X that says
// "Close without saving"). So the chrome is the kit's and the behaviour stays
// exactly what Audrey ruled.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X, ArrowLeft, Check } from 'lucide-react'
import { StatusBadge, DIALOG_WIDTHS, INK_3 } from '../../../ui'
import '../views/rabbitFiles.css'
import { statusWarning, itemLabel, humanStatus } from '../state/dependencyStatus'

export function useDependencyStatusGuard(ctx) {
  const [pending, setPending] = useState(null) // { warning, proceed }
  const dependencies = ctx?.dependencies
  const tasks = ctx?.tasks
  const phases = ctx?.phases

  // Low level: the caller already has the item rows.
  const check = useCallback(({ kind = 'task', items, toStatus, proceed }) => {
    const warning = statusWarning({ items, kind, toStatus, dependencies, tasks, phases })
    if (!warning) return proceed()
    setPending({ warning, proceed })
    return undefined
  }, [dependencies, tasks, phases])

  // High level: ids + the patch about to be written. A patch without a
  // status never warns and is written straight away.
  const update = useCallback(({ kind = 'task', ids, patch, write }) => {
    const toStatus = patch?.status
    if (toStatus === undefined) return write()
    const pool = kind === 'phase' ? phases : tasks
    const wanted = new Set(Array.isArray(ids) ? ids : [ids])
    const items = (pool || []).filter(row => row && wanted.has(row.id))
    return check({ kind, items, toStatus, proceed: write })
  }, [check, tasks, phases])

  const modal = pending
    ? (
      <DependencyStatusWarningModal
        warning={pending.warning}
        onCancel={() => setPending(null)}
        onContinue={() => {
          const run = pending.proceed
          setPending(null)
          run()
        }}
      />
    )
    : null

  return { check, update, modal, pending: !!pending }
}

export function DependencyStatusWarningModal({ warning, onContinue, onCancel }) {
  // Where the last mousedown landed — read by the backdrop's onClick below.
  const downOnBackdrop = useRef(false)

  // Escape cancels, with the X and the backdrop (R1).
  //
  // 🚨 DECLARED ABOVE THE `if (!warning) return null` BELOW, and that is not
  // style: a hook after an early return is a rules-of-hooks violation, and
  // this component genuinely renders both ways. The effect does its own
  // `if (!warning)` instead.
  //
  // CAPTURE PHASE, deliberately. The surfaces underneath this modal have their
  // own Escape handlers (every inline cell editor in ProjectTasksView, the
  // description and notes fields in TaskDetailPopup, and — since the overhaul
  // — the kit Dialog's own document listener, which would otherwise close the
  // popup this warning sits over). While a modal warning is up, Escape belongs
  // to the warning and to nothing else, so it is taken on the way down and
  // stopped there.
  //
  // stopIMMEDIATEPropagation, not stopPropagation (R2): the plain form leaves
  // other listeners ON THE SAME NODE running, and two guards can be pending at
  // once — there is no focus trap, so the control behind the backdrop stays
  // operable and can raise a second warning. Both listeners sit on `document`,
  // and one Escape must not silently drop two parked writes.
  useEffect(() => {
    if (!warning) return undefined
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onCancel?.()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [warning, onCancel])

  if (!warning) return null
  const { kind, toStatus, total, offenders } = warning
  const noun = kind === 'phase' ? 'phase' : 'task'
  const single = total === 1 && offenders.length === 1
  const first = offenders[0]

  const node = (
    <div
      className="ui-dialog-backdrop"
      // z 75, above the kit's own backdrop (70, src/index.css): since the
      // overhaul the surfaces that raise this warning are kit Dialogs
      // (TaskDetailPopup, the asset popup), so at the 60 it shipped at the
      // warning painted BEHIND them and the parked write had no visible way
      // out. Below the kit Menu (80) and Toast (90).
      style={{ zIndex: 75 }}
      // Portal events still bubble through the React tree: without these
      // stops a click here would reach the TaskEditor's backdrop (which
      // closes the editor) and the timeline's mousedown drag handlers.
      // DISMISS. A click outside the card CANCELS the parked write — Audrey,
      // 2026-09-07; see the header for what this reverses.
      // A2's R2 finding survives the reversal with its meaning inverted: a
      // click's target is the common ancestor of its mousedown and its mouseup,
      // so a press that starts inside the card and slips out onto the backdrop
      // (selecting a name in the list, sliding off a button) reads as a
      // backdrop click. It used to land the write by accident; it would now
      // discard it by accident. Both ends must be on the backdrop either way.
      onMouseDown={(e) => { e.stopPropagation(); downOnBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => {
        e.stopPropagation()
        const wholeClickOnBackdrop = downOnBackdrop.current && e.target === e.currentTarget
        downOnBackdrop.current = false
        if (wholeClickOnBackdrop) onCancel?.()
      }}
    >
      <div
        className="ui-dialog"
        data-width="confirm"
        data-surface="dark"
        style={{ width: DIALOG_WIDTHS.confirm }}
        // Announced as a dialog so a screen reader says what has appeared.
        // ⚠️ STATED LIMIT: there is no focus trap and focus is not moved here,
        // so the control that raised this warning keeps focus and can still be
        // operated behind the backdrop — press Save again and a SECOND warning
        // replaces the first, dropping the first parked write with no message.
        // That is pre-existing (the hook has always held one `pending`), it is
        // not what this ruling was about, and a real trap is a bigger change
        // than it deserves — so it is written down rather than half-built.
        role="dialog"
        aria-modal="true"
        aria-label="Unfinished dependencies"
      >
        {/* Header — the kit's, with the warning glyph in the danger ink as
            AssetStatusWarningModal draws it. */}
        <div className="ui-dialog-head">
          <div>
            <div className="ui-dialog-title">
              <span className="rb-warn-title">
                <AlertTriangle className="rb-warn-icon" aria-hidden="true" />
                Unfinished dependencies
              </span>
            </div>
          </div>
          {/* DISMISS: closing CANCELS the change (see the header). */}
          <button
            type="button"
            onClick={onCancel}
            className="ui-iconbtn"
            data-size="sm"
            aria-label="Close without saving"
            title="Close — the change is not saved"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="ui-dialog-body">
          <div className="rb-warn-body">
            <p className="rb-warn-msg">
              {single ? (
                <>
                  <span className="rb-warn-name">{itemLabel(first.item, kind)}</span> is being marked{' '}
                  <StatusBadge status={toStatus} label={humanStatus(toStatus)} />{' '}
                  but {first.unfinished.length === 1
                    ? `a ${noun} it depends on is`
                    : `${first.unfinished.length} ${noun}s it depends on are`} not done.
                </>
              ) : (
                <>
                  <span className="rb-warn-name">{offenders.length} of {total}</span> {noun}s being marked{' '}
                  <StatusBadge status={toStatus} label={humanStatus(toStatus)} />{' '}
                  {offenders.length === 1 ? 'has' : 'have'} unfinished dependencies.
                </>
              )}
            </p>

            <div className="rb-warn-tasks">
              <div className="rb-warn-tasks-head">
                Not done yet
              </div>
              <div className="rb-warn-list">
                {offenders.map(({ item, unfinished }) => (
                  <div key={item.id}>
                    {!single && (
                      <div className="rb-warn-tasks-head">
                        {itemLabel(item, kind)} depends on
                      </div>
                    )}
                    {unfinished.map(pred => (
                      <div key={pred.id} className="rb-warn-task">
                        <span className="rb-warn-task-title">
                          {itemLabel(pred, kind)}
                        </span>
                        <StatusBadge status={pred.status} label={humanStatus(pred.status)} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <p className="text-caption" style={{ color: INK_3 }}>
              A warning, not a block — but only Continue anyway saves it. Closing this leaves the change unsaved.
            </p>
          </div>
        </div>

        {/* Footer — the kit's two buttons: Go back as the secondary, Continue
            anyway as the one primary. */}
        <div className="ui-dialog-foot">
          <button
            type="button"
            onClick={onCancel}
            className="ui-btn"
            data-variant="secondary"
            data-size="md"
            data-surface="dark"
          >
            <ArrowLeft className="w-3 h-3" />
            Go back
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="ui-btn"
            data-variant="primary"
            data-size="md"
            data-surface="dark"
          >
            <Check className="w-3 h-3" />
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? node : createPortal(node, document.body)
}
