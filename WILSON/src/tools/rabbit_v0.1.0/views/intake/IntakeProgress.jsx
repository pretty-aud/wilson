// ============================================================
// IntakeProgress — step 4 of the intake wizard
// ============================================================
//
// As of WILSON v0.6.x the actual pipeline runs at the provider
// level via `startBackgroundIngestion`, so a global toast can
// keep showing progress even when the user navigates away from
// the wizard. This component just kicks off the run on mount,
// reads the live state from the provider, and forwards the
// result to `onComplete` when the run finishes.

import { useEffect, useRef } from 'react'
import { Sparkles, Loader2, AlertCircle, X } from 'lucide-react'
import { useRabbit } from '../../state/RabbitProvider'

export default function IntakeProgress({
  projectId,
  files,
  personas,
  onComplete,
  onBack,
}) {
  const ctx = useRabbit()
  const run = ctx?.ingestionRun
  const startBackgroundIngestion = ctx?.startBackgroundIngestion
  const cancelBackgroundIngestion = ctx?.cancelBackgroundIngestion
  const dismissBackgroundIngestion = ctx?.dismissBackgroundIngestion

  const startedRef = useRef(false)
  const completedRef = useRef(false)

  // Kick off the pipeline once on mount.
  useEffect(() => {
    if (startedRef.current) return
    if (!startBackgroundIngestion) return
    startedRef.current = true
    startBackgroundIngestion({ files, personas }).catch(() => {
      // The provider records the error on `ingestionRun.error`.
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hand the result back to the wizard once.
  useEffect(() => {
    if (completedRef.current) return
    if (run?.phase === 'done' && run.result) {
      completedRef.current = true
      onComplete?.(run.result)
      // Leave the toast around — it auto-dismisses on review save.
    }
  }, [run, onComplete])

  function handleAbort() {
    cancelBackgroundIngestion?.()
  }

  const phase = run?.phase || 'starting'
  const chunksDone = run?.chunksDone || 0
  const chunksTotal = run?.chunksTotal || 0
  const lastLabel = run?.lastLabel || ''
  const errorMsg = run?.error || null
  const pct = chunksTotal > 0 ? Math.round((chunksDone / chunksTotal) * 100) : 0

  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 p-8" style={{ backgroundColor: 'var(--color-paper)' }}>
      {/* Headline */}
      <div className="flex items-center gap-2">
        {phase === 'error' ? (
          <AlertCircle className="w-6 h-6" style={{ color: 'var(--color-danger)' }} />
        ) : (
          <Sparkles className="w-6 h-6" style={{ color: 'var(--color-ink)' }} />
        )}
        <h2 className="text-h3 font-semibold" style={{ color: 'var(--color-ink)' }}>
          {phase === 'starting' && 'Preparing intake…'}
          {phase === 'running'  && 'Running intake'}
          {phase === 'done'     && 'Intake complete'}
          {phase === 'error'    && 'Intake failed'}
        </h2>
      </div>

      <p className="text-dense italic max-w-md text-center" style={{ color: 'var(--color-ink-3)' }}>
        You can leave this view — the breakdown keeps running in the background.
        Watch the toast in the bottom-left corner.
      </p>

      {/* Progress bar */}
      {phase !== 'error' && (
        <div className="w-full max-w-md flex flex-col gap-2">
          <div
            className="h-3 w-full rounded-control overflow-hidden"
            style={{ backgroundColor: 'var(--color-paper-raised)', border: '1px solid var(--color-rule)' }}
          >
            <div
              className="h-full transition-[width] duration-200"
              style={{
                width: `${pct}%`,
                backgroundColor: 'var(--color-signal-fill)',
              }}
            />
          </div>
          <div className="flex items-center justify-between text-label font-mono tabular-nums uppercase" style={{ color: 'var(--color-ink-2)' }}>
            <span>
              {chunksTotal === 0
                ? 'Extracting & chunking source documents…'
                : `${chunksDone} / ${chunksTotal} chunks · ${pct}%`}
            </span>
            <span className="flex items-center gap-1">
              {phase === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
              {phase === 'done'    && 'done'}
            </span>
          </div>
          {lastLabel && (
            <div className="text-dense truncate" style={{ color: 'var(--color-ink-3)' }}>
              last: {lastLabel}
            </div>
          )}
        </div>
      )}

      {/* Error block */}
      {phase === 'error' && errorMsg && (
        <div
          className="max-w-md text-dense leading-relaxed p-3 rounded-control text-center"
          style={{ backgroundColor: 'var(--color-paper)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }}
        >
          {errorMsg}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        {phase === 'running' && (
          <button
            type="button"
            onClick={handleAbort}
            className="flex items-center gap-1 px-3 py-1.5 text-dense rounded-control"
            style={{ color: 'var(--color-ink-2)', border: '1px solid var(--color-rule)', backgroundColor: 'transparent' }}
          >
            <X className="w-3 h-3" />
            Cancel
          </button>
        )}
        {phase === 'error' && (
          <button
            type="button"
            onClick={() => {
              dismissBackgroundIngestion?.()
              startedRef.current = false
              onBack?.()
            }}
            className="px-3 py-1.5 text-dense rounded-control"
            style={{ color: 'var(--color-ink-2)', border: '1px solid var(--color-rule)', backgroundColor: 'transparent' }}
          >
            ← Back to settings
          </button>
        )}
      </div>
    </div>
  )
}
