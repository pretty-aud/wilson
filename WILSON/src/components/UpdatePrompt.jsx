// =============================================================================
// UpdatePrompt — Session 9: the login-time "update or skip" surface.
//
// Shown once per sign-in when the updater reports a newer version (and the
// user hasn't skipped that exact version). Update → download with live
// percent → restart+install. Skip remembers the version and stays quiet
// until the next release. Von Restorff: single orange modal, two choices.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, RotateCw } from 'lucide-react'
import {
  downloadUpdate, installUpdate, onUpdateStatus, skipVersion,
} from '../cloud/updates'

const wilsonVersion = typeof __WILSON_VERSION__ !== 'undefined' ? __WILSON_VERSION__ : 'v?'

export default function UpdatePrompt({ version, onDismiss }) {
  const [phase, setPhase] = useState('offer') // offer | downloading | ready | error
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const unsub = onUpdateStatus((s) => {
      if (!mountedRef.current) return
      if (s.state === 'downloading') { setPhase('downloading'); setPercent(s.progress?.percent ?? 0) }
      else if (s.state === 'downloaded') setPhase('ready')
      else if (s.state === 'error') { setPhase('error'); setError(s.error ?? 'Download failed.') }
    })
    return () => unsub()
  }, [])

  const start = useCallback(async () => {
    setPhase('downloading')
    setPercent(0)
    const res = await downloadUpdate()
    if (!res.ok && mountedRef.current) {
      setPhase('error')
      setError(res.error ?? 'Download failed.')
    }
  }, [])

  const skip = useCallback(() => {
    skipVersion(version)
    onDismiss?.()
  }, [version, onDismiss])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 55,
        backgroundColor: 'rgba(28, 25, 23, 0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        className="flex flex-col gap-4 p-6"
        style={{
          backgroundColor: '#1c1917', border: '2px solid #ea580c',
          borderRadius: '6px', width: 380, maxWidth: '90vw',
        }}
      >
        <div className="text-sm font-bold uppercase tracking-widest" style={{ color: '#f4a261' }}>
          Update available
        </div>
        <div className="text-xs font-mono leading-relaxed" style={{ color: '#e7e5e4' }}>
          WILSON {version} is ready to install (you're on {wilsonVersion}).
        </div>

        {phase === 'downloading' && (
          <div>
            <div className="w-full h-2 rounded-sm overflow-hidden" style={{ backgroundColor: '#44403c' }}>
              <div style={{ width: `${percent}%`, height: '100%', backgroundColor: '#f97316', transition: 'width 200ms ease-out' }} />
            </div>
            <div className="mt-1 text-[11px] font-mono" style={{ color: '#a8a29e' }}>{percent}%</div>
          </div>
        )}

        {phase === 'error' && (
          <div className="text-[11px] font-mono px-3 py-2 rounded-sm" style={{ backgroundColor: 'rgba(220,38,38,0.15)', color: '#fca5a5' }}>
            {error} — you can retry from Settings later.
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {phase === 'offer' && (
            <>
              <button
                type="button"
                onClick={skip}
                className="text-xs font-mono px-3 py-2 rounded-sm"
                style={{ color: '#a8a29e', backgroundColor: 'transparent', border: '1px solid #44403c' }}
              >
                Skip this version
              </button>
              <button
                type="button"
                onClick={start}
                className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-sm"
                style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
              >
                <Download className="w-3.5 h-3.5" /> Update now
              </button>
            </>
          )}
          {phase === 'downloading' && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs font-mono px-3 py-2 rounded-sm"
              style={{ color: '#a8a29e', backgroundColor: 'transparent', border: '1px solid #44403c' }}
              title="Keeps downloading — install from Settings when ready"
            >
              Continue in background
            </button>
          )}
          {phase === 'ready' && (
            <button
              type="button"
              onClick={() => installUpdate()}
              className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-sm"
              style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
            >
              <RotateCw className="w-3.5 h-3.5" /> Restart &amp; install
            </button>
          )}
          {phase === 'error' && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs font-mono px-3 py-2 rounded-sm"
              style={{ color: '#a8a29e', backgroundColor: 'transparent', border: '1px solid #44403c' }}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
