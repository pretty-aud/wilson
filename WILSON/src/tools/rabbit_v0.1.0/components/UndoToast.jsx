// ============================================================
// RABBIT — UndoToast
// ============================================================
//
// Bottom-center "Deleted X — Undo" toast for the soft-delete flow
// (Gmail convention). Rendered once, by App, as the kit toast stack's
// PINNED row (ToastProvider `pinned`; the note above the markup says
// why); reads its state from `useRabbit().undoToast`. Undo replaces the
// confirm dialog: the delete applies instantly (Doherty) and this
// toast is the forgiveness window. The Undo button is the single
// standout element (Von Restorff) with a generous hit area near
// bottom-center where attention lands after a row action (Fitts).
//
// Auto-dismisses after 8s. Hovering pauses BOTH the timer and the
// countdown bar so the deadline never sneaks past a reading user;
// the thin bar along the bottom edge makes the deadline visible.
// A new toast (key change) replaces the previous and restarts the
// countdown.
//
// A HELD toast (`hold`) has no deadline and no bar: it stays until its
// Undo, its dismiss, or the next toast. It is the way back from a step that
// stopped part way, whose question goes on saying "Undo takes back what
// changed" — the sentence must not outlive its Undo (post-overhaul S5c,
// review round 2, R2-09).

import { useEffect, useRef, useState } from 'react'
import { Undo2, X } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'

const AUTO_DISMISS_MS = 8000
// Tests shorten the wait through this global (the provider's history queue
// does the same, __WILSON_TEST_HISTORY_STEP_WAIT_MS).
const dismissAfterMs = () => globalThis.__WILSON_TEST_UNDO_TOAST_MS ?? AUTO_DISMISS_MS

export default function UndoToast() {
  const ctx = useRabbit()
  const toast = ctx?.undoToast
  const dismiss = ctx?.dismissUndoToast

  const [hovered, setHovered] = useState(false)
  const [busy, setBusy] = useState(false)
  // Banked countdown: the timer effect below subtracts elapsed time on
  // every pause (hover) so resuming picks up where it left off — in
  // lockstep with the CSS animation's paused play state.
  const remainingRef = useRef(dismissAfterMs())
  const startedAtRef = useRef(0)
  const timerRef = useRef(null)

  // New toast → full countdown, fresh interaction state.
  useEffect(() => {
    remainingRef.current = dismissAfterMs()
    setHovered(false)
    setBusy(false)
  }, [toast?.key])

  // Auto-dismiss timer. Paused while hovered (or mid-undo): cleanup
  // banks the remaining time, the next run resumes from it. None for a
  // held toast.
  useEffect(() => {
    if (!toast || toast.hold || hovered || busy) return undefined
    startedAtRef.current = Date.now()
    timerRef.current = setTimeout(() => dismiss?.(), remainingRef.current)
    return () => {
      clearTimeout(timerRef.current)
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (Date.now() - startedAtRef.current),
      )
    }
  }, [toast, toast?.key, hovered, busy, dismiss])

  if (!toast) return null

  async function handleUndo() {
    if (busy) return
    setBusy(true)
    try {
      await toast.onUndo?.()
      dismiss?.()
    } catch {
      // Failed restore: keep the toast up with Undo re-enabled so the
      // user can retry — clearing busy also resumes the countdown.
      setBusy(false)
    }
  }

  const paused = hovered || busy

  // The kit toast stack's PINNED row (ToastProvider `pinned`, App.jsx): the
  // anchor (24px above the page's bottom bar) and the layer (index.css
  // `.ui-toast-stack`, 90) are the stack's, so this carries neither a `fixed`
  // anchor nor a z utility of its own. That layer is over the kit Dialog's
  // backdrop (70): a delete made inside a popup — a take unassigned from a
  // shot, a task deleted from its stacked popup — shows its Undo over that
  // popup, and a click on it is the Undo's, not the backdrop's (B5b review
  // round one, R1-01: at z-50 it sat under the backdrop and the click closed
  // the popup instead). It is the stack's LAST item, nearest the bar, below
  // anything push() has put up — a pet notice sits above it, never over its
  // Undo button (the Track A merge, review round 2, A-R2-02: as a second
  // fixed surface at bottom-centre it shared the stack's anchor, and a sticky
  // notice took the button's clicks). `relative` keeps the countdown bar's
  // positioning context.
  return (
    <div
      key={toast.key}
      className="relative flex items-center gap-3 rounded-float shadow-float overflow-hidden pl-4 pr-2 py-2"
      style={{
        backgroundColor: '#292524',
        border: '1px solid #ea580c',
        minWidth: 320,
        maxWidth: 480,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Message */}
      <span className="flex-1 text-dense truncate" style={{ color: '#e7e5e4' }}>
        {toast.message}
      </span>

      {/* Undo — the standout element */}
      <button
        type="button"
        onClick={handleUndo}
        disabled={busy}
        className="flex items-center gap-1.5 px-4 rounded-control text-dense font-semibold transition-colors"
        style={{
          minHeight: 32,
          color: '#fff7ed',
          backgroundColor: busy ? '#9a3412' : '#ea580c',
          border: '1px solid #c2410c',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        <Undo2 className="w-3.5 h-3.5" />
        {busy ? 'Undoing…' : 'Undo'}
      </button>

      {/* Subdued dismiss */}
      <button
        type="button"
        onClick={() => dismiss?.()}
        className="p-1 rounded-control hover:bg-stone-700"
        title="Dismiss"
        style={{ color: '#a8a29e' }}
      >
        <X className="w-3 h-3" />
      </button>

      {/* Countdown bar along the bottom edge (none for a held toast) */}
      {!toast.hold && (
        <div
          className="absolute bottom-0 left-0 right-0"
          style={{ height: 2, backgroundColor: '#44403c' }}
        >
          <div
            className="h-full"
            style={{
              backgroundColor: '#fb923c',
              transformOrigin: 'left',
              animation: `rabbit-undo-countdown ${dismissAfterMs()}ms linear forwards`,
              animationPlayState: paused ? 'paused' : 'running',
            }}
          />
        </div>
      )}
      <style>{'@keyframes rabbit-undo-countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }'}</style>
    </div>
  )
}
