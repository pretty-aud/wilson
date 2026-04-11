// ============================================================
// RABBIT — IngestionToast
// ============================================================
//
// Bottom-left status popup for the background intake pipeline.
// Always rendered at the Rabbit shell level; reads its state
// from `useRabbit().ingestionRun`. The toast persists across
// view switches so the user can navigate while the breakdown
// is running and still see what's happening.
//
// Inspired by Otter's queue window — small, dismissible, with
// a progress bar and a "Jump to review" CTA when the run finishes.

import { Sparkles, Loader2, X, Check, AlertCircle, ArrowRight } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'

export default function IngestionToast({ onJumpToReview }) {
  const ctx = useRabbit()
  const run = ctx?.ingestionRun
  if (!run) return null

  const { phase, chunksDone, chunksTotal, lastLabel, fileCount, error } = run
  const pct = chunksTotal > 0 ? Math.round((chunksDone / chunksTotal) * 100) : 0

  const headline =
    phase === 'running' ? 'Breaking down…' :
    phase === 'done'    ? 'Breakdown ready' :
    phase === 'error'   ? 'Breakdown failed' : 'Intake'

  const Icon =
    phase === 'done'  ? Check :
    phase === 'error' ? AlertCircle : Sparkles

  const accent =
    phase === 'done'  ? '#15803d' :
    phase === 'error' ? '#7f1d1d' : '#ea580c'

  function handleClose() {
    if (phase === 'running') {
      ctx?.cancelBackgroundIngestion?.()
    } else {
      ctx?.dismissBackgroundIngestion?.()
    }
  }

  return (
    <div
      className="fixed bottom-4 left-4 z-50 flex flex-col rounded-sm shadow-2xl"
      style={{
        backgroundColor: '#292524',
        border: `1px solid ${accent}`,
        minWidth: 300,
        maxWidth: 360,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accent === '#ea580c' ? '#fb923c' : accent === '#15803d' ? '#86efac' : '#fca5a5' }} />
        <span
          className="flex-1 text-[10px] font-mono uppercase tracking-widest font-bold truncate"
          style={{ color: '#fb923c' }}
        >
          {headline}
        </span>
        {phase === 'running' && (
          <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: '#fb923c' }} />
        )}
        <button
          type="button"
          onClick={handleClose}
          className="p-0.5 rounded-sm hover:bg-stone-700"
          title={phase === 'running' ? 'Cancel' : 'Dismiss'}
          style={{ color: '#a8a29e' }}
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-2 flex flex-col gap-2">
        {/* Progress bar */}
        {phase !== 'error' && (
          <div
            className="h-2 w-full rounded-sm overflow-hidden"
            style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}
          >
            <div
              className="h-full transition-all duration-200"
              style={{
                width: `${phase === 'done' ? 100 : pct}%`,
                backgroundColor: accent,
              }}
            />
          </div>
        )}

        {/* Status line */}
        <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: '#a8a29e' }}>
          <span className="truncate">
            {phase === 'running' && (chunksTotal > 0
              ? `${chunksDone}/${chunksTotal} chunks · ${pct}%`
              : `Extracting ${fileCount} file${fileCount === 1 ? '' : 's'}…`)}
            {phase === 'done'  && `${chunksDone}/${chunksTotal} chunks · complete`}
            {phase === 'error' && (error || 'Unknown error')}
          </span>
        </div>

        {/* Last chunk label */}
        {phase === 'running' && lastLabel && (
          <div className="text-[9px] font-mono italic truncate" style={{ color: '#78716c' }}>
            {lastLabel}
          </div>
        )}

        {/* Done CTA */}
        {phase === 'done' && (
          <button
            type="button"
            onClick={() => {
              onJumpToReview?.()
            }}
            className="mt-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors"
            style={{
              color: '#fff7ed',
              backgroundColor: '#ea580c',
              border: '1px solid #c2410c',
            }}
          >
            Review breakdown
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
}
