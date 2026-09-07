// ============================================================
// RABBIT — UndoToast
// ============================================================
//
// Bottom-center "Deleted X — Undo" toast for the soft-delete flow
// (Gmail convention). Always rendered at the Rabbit shell level;
// reads its state from `useRabbit().undoToast`. Undo replaces the
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

import { useEffect, useRef, useState } from 'react'
import { Undo2, X } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'

const AUTO_DISMISS_MS = 8000

export default function UndoToast() {
  const ctx = useRabbit()
  const toast = ctx?.undoToast
  const dismiss = ctx?.dismissUndoToast

  const [hovered, setHovered] = useState(false)
  const [busy, setBusy] = useState(false)
  // Banked countdown: the timer effect below subtracts elapsed time on
  // every pause (hover) so resuming picks up where it left off — in
  // lockstep with the CSS animation's paused play state.
  const remainingRef = useRef(AUTO_DISMISS_MS)
  const startedAtRef = useRef(0)
  const timerRef = useRef(null)

  // New toast → full countdown, fresh interaction state.
  useEffect(() => {
    remainingRef.current = AUTO_DISMISS_MS
    setHovered(false)
    setBusy(false)
  }, [toast?.key])

  // Auto-dismiss timer. Paused while hovered (or mid-undo): cleanup
  // banks the remaining time, the next run resumes from it.
  useEffect(() => {
    if (!toast || hovered || busy) return undefined
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

  return (
    <div
      key={toast.key}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-sm shadow-2xl overflow-hidden pl-4 pr-2 py-2"
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
      <span className="flex-1 text-[11px] font-mono truncate" style={{ color: '#e7e5e4' }}>
        {toast.message}
      </span>

      {/* Undo — the standout element */}
      <button
        type="button"
        onClick={handleUndo}
        disabled={busy}
        className="flex items-center gap-1.5 px-4 rounded-sm text-[11px] font-mono uppercase tracking-wider font-bold transition-colors"
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
        className="p-1 rounded-sm hover:bg-stone-700"
        title="Dismiss"
        style={{ color: '#a8a29e' }}
      >
        <X className="w-3 h-3" />
      </button>

      {/* Countdown bar along the bottom edge */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: 2, backgroundColor: '#44403c' }}
      >
        <div
          className="h-full"
          style={{
            backgroundColor: '#fb923c',
            transformOrigin: 'left',
            animation: `rabbit-undo-countdown ${AUTO_DISMISS_MS}ms linear forwards`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      </div>
      <style>{'@keyframes rabbit-undo-countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }'}</style>
    </div>
  )
}
