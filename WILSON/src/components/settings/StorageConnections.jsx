// =============================================================================
// StorageConnections — Session 9: per-provider connection details under the
// Storage Backend switch (locked #14: v1.0 = local / local server, Supabase
// Storage, Google Drive; S3/Hetzner post-1.0).
//
// The switch above chooses the ACTIVE adapter; these cards show whether each
// provider is actually connected on this machine and let the user fix that
// (local folder pick, Drive disconnect). Everything is feature-detected off
// the preload bridge — in the vite dev server the cards degrade to
// informational rows. Chunking/Common Region: one bordered card per provider.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Cloud, HardDrive, Unplug } from 'lucide-react'
import { usePermissions } from '../../permissions'

const SUPABASE_HOST = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL).host } catch { return null }
})()

function Dot({ on }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: on ? '#22c55e' : '#a8a29e' }}
    />
  )
}

function Card({ icon: Icon, title, connected, children }) {
  return (
    <div className="p-3 rounded-sm" style={{ backgroundColor: 'rgba(120,70,30,0.12)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-4 h-4" style={{ color: '#57534e' }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#57534e' }}>
          {title}
        </span>
        <Dot on={connected} />
      </div>
      {children}
    </div>
  )
}

export default function StorageConnections() {
  const perms = usePermissions()
  const bridge = typeof window !== 'undefined' ? window.electronAPI?.rabbit : null
  const [localPath, setLocalPath] = useState(null)
  const [driveConnected, setDriveConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const refresh = useCallback(async () => {
    if (!bridge) return
    try {
      // Schema is { defaultRootDir } (electron/main.cjs readFilesConfig).
      const cfg = await bridge.readFilesConfig?.()
      if (mountedRef.current) setLocalPath(cfg?.defaultRootDir || null)
    } catch { /* config absent */ }
    try {
      const tokens = await bridge.readGdriveTokens?.()
      if (mountedRef.current) setDriveConnected(!!(tokens && Object.keys(tokens).length))
    } catch { /* not connected */ }
  }, [bridge])
  useEffect(() => { refresh() }, [refresh])

  const pickLocalFolder = useCallback(async () => {
    if (!bridge?.pickDirectory || busy) return
    setBusy(true)
    try {
      const dir = await bridge.pickDirectory()
      if (dir && bridge.writeFilesConfig) {
        const cfg = (await bridge.readFilesConfig?.()) || {}
        await bridge.writeFilesConfig({ ...cfg, defaultRootDir: dir })
      }
      await refresh()
    } catch { /* dialog cancelled */ }
    if (mountedRef.current) setBusy(false)
  }, [bridge, busy, refresh])

  const disconnectDrive = useCallback(async () => {
    if (!bridge?.clearGdrive || busy) return
    if (!window.confirm('Disconnect Google Drive? Cached tokens are removed from this machine.')) return
    setBusy(true)
    try { await bridge.clearGdrive(); await refresh() } catch { /* already gone */ }
    if (mountedRef.current) setBusy(false)
  }, [bridge, busy, refresh])

  return (
    <div>
      <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
        Storage Connections
      </h2>
      <p className="text-xs text-stone-950 mb-4 leading-relaxed">
        Connection details for each backend on this machine. AWS S3 and
        Hetzner arrive after v1.0 through one S3-compatible adapter.
      </p>

      <div className="flex flex-col gap-2">
        <Card icon={Cloud} title="Supabase (company cloud)" connected={!!perms.workspaceId}>
          <div className="text-[11px] font-mono" style={{ color: '#1c1917' }}>
            {perms.workspaceId
              ? <>Signed in · {SUPABASE_HOST ?? 'host unknown'}</>
              : 'Not signed in on this machine.'}
          </div>
        </Card>

        <Card icon={HardDrive} title="Local / local server" connected={!!localPath || !bridge}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono truncate" style={{ color: '#1c1917', maxWidth: 320 }} title={localPath ?? undefined}>
              {bridge
                ? (localPath || 'Default app-data folder')
                : 'Managed by the desktop app (unavailable in the browser dev server).'}
            </span>
            {bridge?.pickDirectory && (
              <button
                type="button"
                onClick={pickLocalFolder}
                disabled={busy}
                className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-sm"
                style={{ backgroundColor: '#1c1917', color: '#f4a261', opacity: busy ? 0.6 : 1 }}
              >
                <FolderOpen className="w-3 h-3" /> Change folder
              </button>
            )}
          </div>
        </Card>

        <Card icon={Cloud} title="Google Drive" connected={driveConnected}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono" style={{ color: '#1c1917' }}>
              {bridge
                ? (driveConnected ? 'Connected on this machine.' : 'Not connected — configure from the RABBIT Drive setup.')
                : 'Managed by the desktop app.'}
            </span>
            {driveConnected && bridge?.clearGdrive && (
              <button
                type="button"
                onClick={disconnectDrive}
                disabled={busy}
                className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-sm"
                style={{ color: '#dc2626', backgroundColor: 'rgba(220,38,38,0.08)', opacity: busy ? 0.6 : 1 }}
              >
                <Unplug className="w-3 h-3" /> Disconnect
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
