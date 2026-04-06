// ============================================================
// IntakeProgress — step 4 of the intake wizard
// ============================================================
//
// Drives `runIngestion()` from intake/pipeline.js. Owns the
// abort controller, the live progress counter, and the parsed
// breakdown handed back to the parent on success.
//
// Lifecycle:
//   mount    → kick off runIngestion(...)
//   running  → updates {chunksDone, chunksTotal, lastLabel}
//   complete → calls onComplete(breakdown) once
//   error    → renders the message + a retry button
//   abort    → user cancels via the abort controller
//
// The wizard is responsible for what happens after — this
// component never writes to the project bundle itself.

import { useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, AlertCircle, X } from 'lucide-react'
import { runIngestion } from '../../intake/pipeline'

export default function IntakeProgress({
  projectId,
  files,
  personas,
  apiKey,
  onComplete,
  onBack,
}) {
  const [phase, setPhase] = useState('starting')      // starting | running | done | error
  const [progress, setProgress] = useState({ chunksDone: 0, chunksTotal: 0, lastLabel: '' })
  const [errorMsg, setErrorMsg] = useState(null)
  const abortRef = useRef(null)
  const completedRef = useRef(false)

  // Kick off the pipeline once. The pipeline is the long-running
  // network step; we never want StrictMode's double-invoke to fire
  // it twice, so we guard with completedRef.
  useEffect(() => {
    if (completedRef.current) return
    let cancelled = false
    const controller = new AbortController()
    abortRef.current = controller

    ;(async () => {
      setPhase('running')
      setErrorMsg(null)
      try {
        const result = await runIngestion({
          projectId,
          files,
          personas,
          apiKey,
          signal: controller.signal,
          onProgress: (p) => {
            if (cancelled) return
            setProgress(p)
          },
        })
        if (cancelled) return
        completedRef.current = true
        setPhase('done')
        onComplete?.(result)
      } catch (err) {
        if (cancelled) return
        const msg = err?.message || String(err)
        if (msg === 'aborted') {
          setPhase('error')
          setErrorMsg('Cancelled.')
        } else {
          setPhase('error')
          setErrorMsg(msg)
        }
      }
    })()

    return () => {
      cancelled = true
      try { controller.abort() } catch { /* noop */ }
    }
    // Run once on mount. Files / personas are wizard-local and
    // are frozen the moment the user clicks "Run intake".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleAbort() {
    try { abortRef.current?.abort() } catch { /* noop */ }
  }

  const pct = progress.chunksTotal > 0
    ? Math.round((progress.chunksDone / progress.chunksTotal) * 100)
    : 0

  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 p-8">
      {/* Headline */}
      <div className="flex items-center gap-2">
        {phase === 'error' ? (
          <AlertCircle className="w-6 h-6" style={{ color: '#991b1b' }} />
        ) : (
          <Sparkles className="w-6 h-6" style={{ color: '#ea580c' }} />
        )}
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest" style={{ color: '#1c1917' }}>
          {phase === 'starting' && 'Preparing intake…'}
          {phase === 'running'  && 'Running intake'}
          {phase === 'done'     && 'Intake complete'}
          {phase === 'error'    && 'Intake failed'}
        </h2>
      </div>

      {/* Progress bar */}
      {phase !== 'error' && (
        <div className="w-full max-w-md flex flex-col gap-2">
          <div
            className="h-3 w-full rounded-sm overflow-hidden"
            style={{ backgroundColor: '#fed7aa', border: '2px solid #7c2d12' }}
          >
            <div
              className="h-full transition-all duration-200"
              style={{
                width: `${pct}%`,
                backgroundColor: '#ea580c',
              }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider" style={{ color: '#7c2d12' }}>
            <span>
              {progress.chunksTotal === 0
                ? 'Extracting & chunking source documents…'
                : `${progress.chunksDone} / ${progress.chunksTotal} chunks · ${pct}%`}
            </span>
            <span className="flex items-center gap-1">
              {phase === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
              {phase === 'done'    && 'done'}
            </span>
          </div>
          {progress.lastLabel && (
            <div className="text-[10px] font-mono truncate" style={{ color: '#7c2d12' }}>
              last: {progress.lastLabel}
            </div>
          )}
        </div>
      )}

      {/* Error block */}
      {phase === 'error' && errorMsg && (
        <div
          className="max-w-md text-[11px] font-mono leading-relaxed p-3 rounded-sm text-center"
          style={{ backgroundColor: '#fee2e2', color: '#991b1b', border: '2px solid #991b1b' }}
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
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm"
            style={{ color: '#7c2d12', border: '1px solid #7c2d12', backgroundColor: 'transparent' }}
          >
            <X className="w-3 h-3" />
            Cancel
          </button>
        )}
        {phase === 'error' && (
          <>
            <button
              type="button"
              onClick={onBack}
              className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm"
              style={{ color: '#7c2d12', border: '1px solid #7c2d12', backgroundColor: 'transparent' }}
            >
              ← Back to settings
            </button>
          </>
        )}
      </div>
    </div>
  )
}
