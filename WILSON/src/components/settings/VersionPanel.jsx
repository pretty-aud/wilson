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
import './settings.css'
import { Section, Group, Row } from './SettingsChrome'
import { Button } from '../../ui'

const wilsonVersion = typeof __WILSON_VERSION__ !== 'undefined' ? __WILSON_VERSION__ : 'v?'

export default function VersionPanel({ first = false }) {
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
    <Section
      first={first}
      title="Version and updates"
      description={supported
        ? 'WILSON checks for updates at sign-in; you can also check manually.'
        : 'Updates ship with the installer build — this environment updates manually.'}
    >
      <Group>
        <Row label="Installed">
          {/* A version IS data, so it keeps the mono and gains tabular
              figures — one of the seven mono uses S43 leaves standing. */}
          <span className="s-data s-row-desc">WILSON {wilsonVersion}</span>
        </Row>

        {/* The error variant is rendered once, by the feedback block below;
            showing it here as well printed it twice. */}
        {supported && (
          <Row label="Updates" description={status.state === 'error' ? undefined : (line || undefined)}>
            {status.state === 'available' && (
              <Button surface="light" size="sm" variant="primary"
                onClick={() => { setBusy(true); downloadUpdate() }}
                disabled={busy && status.state !== 'available'}>
                <Download aria-hidden="true" />Download update
              </Button>
            )}
            {status.state === 'downloaded' && (
              <Button surface="light" size="sm" variant="primary" onClick={() => installUpdate()}>
                <RotateCw aria-hidden="true" />Restart and install
              </Button>
            )}
            {status.state !== 'available' && status.state !== 'downloaded' && status.state !== 'downloading' && (
              <Button surface="light" size="sm" onClick={check} disabled={busy || status.state === 'checking'}>
                <RefreshCw
                  className={`w-3.5 h-3.5 ${(busy || status.state === 'checking') ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                Check for updates
              </Button>
            )}
          </Row>
        )}

        {/* The update line used #dc2626 on #f4a261 for an error — 2.51:1
            (S10). It is the page's ink inside the row description now, and
            when it is an error it also gets the feedback treatment below. */}
        {!supported && line && status.state !== 'error' && (
          <Row label="Status" description={line} />
        )}
      </Group>

      {line && status.state === 'error' && (
        <p className="s-feedback mt-4" data-tone="error" role="alert">{line}</p>
      )}
    </Section>
  )
}
