// =============================================================================
// VersionPanel — Session 9: Settings > General version + update surface.
//
// Doherty: every updater interaction answers within a frame (spinner or
// state swap); long downloads show live percent. Outside a packaged NSIS
// build the panel degrades to a plain version line ("updates ship with the
// installer build") instead of dead buttons.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Download, RotateCw } from 'lucide-react'
import {
  updatesSupported, getUpdateState, checkForUpdates, downloadUpdate,
  installUpdate, onUpdateStatus,
} from '../../cloud/updates'
import { LIGHT_INK } from '../lightSurface'
import './settings.css'

const wilsonVersion = typeof __WILSON_VERSION__ !== 'undefined' ? __WILSON_VERSION__ : 'v?'

export default function VersionPanel() {
  const [status, setStatus] = useState({ state: 'disabled' })
  const [busy, setBusy] = useState(false)
  const [lastChecked, setLastChecked] = useState(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let unsub = () => {}
    getUpdateState().then(s => { if (mountedRef.current && s) setStatus(s) })
    unsub = onUpdateStatus((s) => {
      if (!mountedRef.current) return
      setStatus(s)
      if (s.state === 'available' || s.state === 'not-available') {
        setLastChecked(new Date())
        setBusy(false)
      }
      if (s.state === 'error' || s.state === 'unsupported' || s.state === 'downloaded') setBusy(false)
    })
    return () => unsub()
  }, [])

  const check = useCallback(async () => {
    setBusy(true)
    const res = await checkForUpdates()
    if (!res.ok && mountedRef.current) setBusy(false)
  }, [])

  const supported = updatesSupported() &&
    status.state !== 'disabled' && status.state !== 'unsupported'

  const line = (() => {
    switch (status.state) {
      case 'checking': return 'Checking…'
      case 'available': return `Version ${status.info?.version ?? '?'} available.`
      case 'not-available': return `Up to date${lastChecked ? ` (checked ${lastChecked.toLocaleTimeString()})` : ''}.`
      case 'downloading': return `Downloading… ${status.progress?.percent ?? 0}%`
      case 'downloaded': return `Version ${status.info?.version ?? ''} ready — restart to install.`
      case 'error': return `Update check failed: ${status.error ?? 'unknown error'}`
      default: return null
    }
  })()

  return (
    <div>
      <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">Version &amp; Updates</h2>
      <p className="text-xs text-stone-950 mb-4 leading-relaxed">
        {supported
          ? 'WILSON checks for updates at sign-in; you can also check manually.'
          : 'Updates ship with the installer build — this environment updates manually.'}
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-mono px-2 py-1 rounded-sm" style={{ backgroundColor: 'rgba(120,70,30,0.12)', color: '#1c1917' }}>
          WILSON {wilsonVersion}
        </span>

        {supported && status.state === 'available' && (
          <button
            type="button"
            onClick={() => { setBusy(true); downloadUpdate() }}
            disabled={busy && status.state !== 'available'}
            className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-sm"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
          >
            <Download className="w-3.5 h-3.5" /> Download update
          </button>
        )}

        {supported && status.state === 'downloaded' && (
          <button
            type="button"
            onClick={() => installUpdate()}
            className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-sm"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
          >
            <RotateCw className="w-3.5 h-3.5" /> Restart &amp; install
          </button>
        )}

        {supported && status.state !== 'available' && status.state !== 'downloaded' && status.state !== 'downloading' && (
          <button
            type="button"
            onClick={check}
            disabled={busy || status.state === 'checking'}
            className="s-version-btn flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-sm"
            data-busy={busy || status.state === 'checking'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${(busy || status.state === 'checking') ? 'animate-spin' : ''}`} />
            Check for updates
          </button>
        )}
      </div>

      {line && (
        <div className="mt-2 text-[11px] font-mono" style={{ color: status.state === 'error' ? '#dc2626' : LIGHT_INK }}>
          {line}
        </div>
      )}
    </div>
  )
}
