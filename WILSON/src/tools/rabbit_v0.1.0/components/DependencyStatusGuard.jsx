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
// a done status over an unfinished predecessor. Otherwise it parks the write,
// shows the modal, and runs it when the person chooses "Continue anyway" —
// "Go back" drops it and nothing is written. Closing the modal any other way
// — its X, a click outside it — also CONTINUES: the Phase 7 brief says every
// warning is dismissible AND the change still lands, so a dismissal is never a
// silent cancel; "Go back" is the one explicit way to keep the change unsaved
// (R1 of Track A A2). Bulk writes pass every id and get one summary ("3 of 12
// have unfinished dependencies"), never one modal per row. Audrey, 2026-08-12:
// "warn dont block. do both phases and tasks".
//
// Why a hook per surface and not one provider: the surfaces are table rows,
// kanban columns, popups and an editor that already stacks over the timeline.
// A hook owns its own pending state and renders the modal through a portal
// into document.body, so it works from inside a <tr> and above any z-50
// modal without threading props through five components. The cost is one
// idle hook per row, which is nothing.
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
// =============================================================================

import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X, ArrowLeft, Check } from 'lucide-react'
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

function StatusChip({ status }) {
  return (
    <span
      className="mx-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded-sm"
      style={{ backgroundColor: '#1c1917', color: '#86efac', border: '1px solid #15803d' }}
    >
      {humanStatus(status)}
    </span>
  )
}

export function DependencyStatusWarningModal({ warning, onContinue, onCancel }) {
  if (!warning) return null
  const { kind, toStatus, total, offenders } = warning
  const noun = kind === 'phase' ? 'phase' : 'task'
  const single = total === 1 && offenders.length === 1
  const first = offenders[0]

  const node = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(28, 25, 23, 0.6)' }}
      // Portal events still bubble through the React tree: without these
      // stops a click here would reach the TaskEditor's backdrop (which
      // closes the editor) and the timeline's mousedown drag handlers.
      // A click outside the card dismisses the warning, and a dismissed warning
      // lands the change (see the header). Only "Go back" cancels.
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onContinue?.() }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-md rounded-sm overflow-hidden flex flex-col"
        style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ backgroundColor: '#1c1917', borderBottom: '1px solid #7f1d1d' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" style={{ color: '#fca5a5' }} />
            <span className="text-[11px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fca5a5' }}>
              Unfinished dependencies
            </span>
          </div>
          <button
            type="button"
            onClick={onContinue}
            className="p-1 rounded-sm hover:bg-stone-700"
            style={{ color: '#fca5a5' }}
            aria-label="Close and continue"
            title="Close — the change is saved as asked"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-3">
          <p className="text-[12px] font-mono leading-relaxed" style={{ color: '#d6d3d1' }}>
            {single ? (
              <>
                <span className="font-bold">{itemLabel(first.item, kind)}</span> is being marked
                <StatusChip status={toStatus} />
                but {first.unfinished.length === 1
                  ? `a ${noun} it depends on is`
                  : `${first.unfinished.length} ${noun}s it depends on are`} not done.
              </>
            ) : (
              <>
                <span className="font-bold">{offenders.length} of {total}</span> {noun}s being marked
                <StatusChip status={toStatus} />
                {offenders.length === 1 ? 'has' : 'have'} unfinished dependencies.
              </>
            )}
          </p>

          <div
            className="rounded-sm overflow-hidden"
            style={{ border: '1px solid #44403c', backgroundColor: '#1c1917' }}
          >
            <div
              className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest"
              style={{ color: '#fb923c', borderBottom: '1px solid #44403c', backgroundColor: '#44403c' }}
            >
              Not done yet
            </div>
            <div className="max-h-56 overflow-auto">
              {offenders.map(({ item, unfinished }) => (
                <div key={item.id} style={{ borderBottom: '1px solid #292524' }}>
                  {!single && (
                    <div
                      className="px-3 pt-1.5 text-[10px] font-mono uppercase tracking-wider truncate"
                      style={{ color: '#a8a29e' }}
                    >
                      {itemLabel(item, kind)} depends on
                    </div>
                  )}
                  {unfinished.map(pred => (
                    <div key={pred.id} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="flex-1 text-[11px] font-mono truncate" style={{ color: '#d6d3d1' }}>
                        {itemLabel(pred, kind)}
                      </span>
                      <span
                        className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm"
                        style={{ backgroundColor: '#292524', color: '#fb923c', border: '1px solid #57534e' }}
                      >
                        {humanStatus(pred.status)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10.5px] font-mono" style={{ color: '#78716c' }}>
            A warning, not a block: closing this saves the change as asked. Only Go back leaves it unsaved.
          </p>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid #44403c' }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm"
            style={{ color: '#a8a29e', border: '1px solid #44403c', backgroundColor: 'transparent' }}
          >
            <ArrowLeft className="w-3 h-3" />
            Go back
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
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
