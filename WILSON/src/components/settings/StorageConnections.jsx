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
//
// Demo sprint (2026-09-10): the local card is now the LOCAL DEMO FOLDER —
// one user-chosen folder that holds the whole demo (projects, files,
// thumbnails; electron/localDemoRoot.cjs). It shows the open folder in full
// with Change / Open in Explorer / Close, the recent folders to switch
// between, and the per-machine files root that still applies when no folder
// is open. Opening or closing a folder reloads the window — see
// localDemoClient.js for why.
//
// 🚨 THIS CARD IS THE ONLY WAY IN. Audrey, 2026-09-10: "user still needs to
// login no matter what" — the folder is chosen here, after sign-in; there is
// no entry on the sign-in screen.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Cloud, HardDrive, Unplug, ExternalLink, X, Sparkles, RotateCcw } from 'lucide-react'
import { usePermissions } from '../../permissions'
import GatedAction from '../../permissions/GatedAction'
import { LIGHT_INK } from '../lightSurface'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
// 🚨 `pickLocalFolder` is imported under a DIFFERENT name on purpose. This
// component already had a `pickLocalFolder` callback (the per-machine files
// root's "Change folder"), and the first cut imported the client function
// under the same name — the local const shadowed it, so "Choose a demo
// folder…" ran the files-root picker and repointed defaultRootDir instead
// (review round 1, H1). localDemoWiring.test.js pins the alias.
import {
  localDemoBridge, describeLocalState, folderLeaf,
  pickLocalFolder as pickDemoFolder, reopenLocalFolder, reloadApp,
  resetConfirmText, seedDemoProject,
} from '../local/localDemoClient'

const SUPABASE_HOST = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL).host } catch { return null }
})()

function Dot({ on }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: on ? '#22c55e' : 'rgba(28, 25, 23, 0.45)' }}
    />
  )
}

function Card({ icon: Icon, title, connected, children }) {
  return (
    <div className="p-3 rounded-sm" style={{ backgroundColor: 'rgba(120,70,30,0.12)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-4 h-4" style={{ color: LIGHT_INK }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: LIGHT_INK }}>
          {title}
        </span>
        <Dot on={connected} />
      </div>
      {children}
    </div>
  )
}

const DARK_BTN = { backgroundColor: '#1c1917', color: '#f4a261' }
const QUIET_BTN = { backgroundColor: 'rgba(28,25,23,0.08)', color: '#1c1917', border: '1px solid rgba(28,25,23,0.35)' }
const DANGER_BTN = { color: '#dc2626', backgroundColor: 'rgba(220,38,38,0.08)' }

function SmallButton({ icon: Icon, children, style, ...rest }) {
  return (
    <button
      type="button"
      className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-sm disabled:cursor-default"
      style={style}
      {...rest}
    >
      {Icon && <Icon className="w-3 h-3" />} {children}
    </button>
  )
}

// A path is a fact: monospace, full, wraps anywhere, never truncated.
function PathLine({ children, title }) {
  return (
    <div className="text-[11px] font-mono break-all leading-snug" style={{ color: '#1c1917' }} title={title}>
      {children}
    </div>
  )
}

export default function StorageConnections() {
  const perms = usePermissions()
  // S34 (TPN-AUTH-009): this card writes defaultRootDir — the fallback the
  // whole resolution chain lands on once the workspace root exists — and it
  // gated on NOTHING (perms was read twice, both times for a display label).
  // Same rule as SettingsPage's root controls: admins only while signed in
  // to a workspace; a solo user with no workspace keeps full control. Fails
  // CLOSED while loading, with the reason saying so. The demo folder is the
  // same kind of machine-wide repoint, so it rides the same gate.
  const canEditMachineRoot = perms.ready && (!perms.workspaceId || perms.role === 'admin')
  const machineRootReason = !perms.ready
    ? 'Checking permissions…'
    : 'Only a workspace admin can change this computer’s storage folder while signed in to a company workspace.'
  const bridge = typeof window !== 'undefined' ? window.electronAPI?.rabbit : null
  const demo = localDemoBridge()
  // The seeded demo project writes through R.A.B.B.I.T.'s own provider and
  // adapter (brief §3.4); null outside the provider, and only the Local
  // Server adapter can seed.
  const rabbit = useRabbit()
  const canSeed = !!rabbit?.createProject && rabbit?.adapterMode === 'local_server'
  const [seedStatus, setSeedStatus] = useState('')
  const [localPath, setLocalPath] = useState(null)
  const [driveConnected, setDriveConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [demoState, setDemoState] = useState(null)
  const [demoError, setDemoError] = useState('')
  const [confirm, setConfirm] = useState(null) // { folder, count, entries, kind, resolve }
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
    if (demo?.getState) {
      try {
        const s = await demo.getState()
        if (mountedRef.current) setDemoState(s)
      } catch { /* bridge absent */ }
    }
  }, [bridge, demo])
  useEffect(() => { refresh() }, [refresh])

  const pickLocalFolder = useCallback(async () => {
    if (!canEditMachineRoot) return
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
  }, [bridge, busy, refresh, canEditMachineRoot])

  const disconnectDrive = useCallback(async () => {
    if (!bridge?.clearGdrive || busy) return
    if (!window.confirm('Disconnect Google Drive? Cached tokens are removed from this machine.')) return
    setBusy(true)
    try { await bridge.clearGdrive(); await refresh() } catch { /* already gone */ }
    if (mountedRef.current) setBusy(false)
  }, [bridge, busy, refresh])

  // ── the local demo folder ────────────────────────────────────────────
  const confirmForeign = useCallback((r) => new Promise((resolve) => {
    setConfirm({ folder: r.folder, count: r.count, entries: r.entries || [], kind: r.kind, resolve })
  }), [])
  const answerConfirm = useCallback((yes) => {
    const c = confirm
    setConfirm(null)
    c?.resolve(yes)
  }, [confirm])

  const finishDemo = useCallback((outcome) => {
    if (!mountedRef.current) return
    if (outcome.done) { reloadApp(); return }
    if (outcome.error) setDemoError(outcome.error)
    setBusy(false)
  }, [])

  const chooseDemoFolder = useCallback(async () => {
    if (!canEditMachineRoot) return
    if (!demo?.pick || busy) return
    setBusy(true)
    setDemoError('')
    try { finishDemo(await pickDemoFolder(demo, { confirmForeign })) }
    catch (err) { finishDemo({ done: false, error: err?.message || 'the folder could not be opened' }) }
  }, [demo, busy, canEditMachineRoot, confirmForeign, finishDemo])

  const reopenDemoFolder = useCallback(async (folder) => {
    if (!canEditMachineRoot) return
    if (!demo?.open || busy) return
    setBusy(true)
    setDemoError('')
    try { finishDemo(await reopenLocalFolder(demo, folder, { confirmForeign })) }
    catch (err) { finishDemo({ done: false, error: err?.message || 'the folder could not be opened' }) }
  }, [demo, busy, canEditMachineRoot, confirmForeign, finishDemo])

  const closeDemoFolder = useCallback(async () => {
    if (!canEditMachineRoot) return
    if (!demo?.close || busy) return
    const name = folderLeaf(demoState?.active)
    if (!window.confirm(`Close the demo folder "${name}"?\n\nNothing is deleted. WILSON goes back to the projects in this computer's app data until you open a folder again.`)) return
    setBusy(true)
    setDemoError('')
    try { await demo.close(); reloadApp() }
    catch (err) { finishDemo({ done: false, error: err?.message || 'the folder could not be closed' }) }
  }, [demo, busy, canEditMachineRoot, demoState, finishDemo])

  const forgetDemoFolder = useCallback(async (folder) => {
    if (!demo?.forget || busy) return
    try {
      const r = await demo.forget({ folder })
      if (mountedRef.current && r?.state) setDemoState(r.state)
      if (r && !r.ok && r.error) setDemoError(r.error)
    } catch { /* leave it listed */ }
  }, [demo, busy])

  const openDemoInExplorer = useCallback(async () => {
    if (!demo?.openInExplorer) return
    try {
      const r = await demo.openInExplorer()
      if (r && !r.ok && r.error) setDemoError(r.error)
    } catch { /* nothing to show */ }
  }, [demo])

  // ── demo comfort (brief §3.4) ────────────────────────────────────────
  const resetDemoFolder = useCallback(async () => {
    if (!canEditMachineRoot) return
    if (!demo?.reset || busy || !demoState?.active) return
    if (!window.confirm(resetConfirmText(demoState.active))) return
    setBusy(true)
    setDemoError('')
    try {
      const r = await demo.reset()
      if (!r?.ok) { setDemoError(r?.error || 'the folder could not be reset'); setBusy(false); return }
      reloadApp()
    } catch (err) {
      finishDemo({ done: false, error: err?.message || 'the folder could not be reset' })
    }
  }, [demo, busy, canEditMachineRoot, demoState, finishDemo])

  const createDemoProject = useCallback(async () => {
    if (!canSeed || busy) return
    setBusy(true)
    setDemoError('')
    setSeedStatus('')
    try {
      const r = await seedDemoProject({ createProject: rabbit.createProject, adapter: rabbit.getAdapter?.() })
      await rabbit.refreshProjectsIndex?.()
      await rabbit.setActiveProject?.(r.id)
      if (mountedRef.current) setSeedStatus(`Created "${r.title}" with ${r.scenes} scenes and ${r.shots} shots. Open it from PROJECTS.`)
    } catch (err) {
      if (mountedRef.current) setDemoError(err?.message || 'the demo project could not be created')
    }
    if (mountedRef.current) setBusy(false)
  }, [canSeed, busy, rabbit])

  const view = describeLocalState(demoState)
  const others = view.recent.filter(r => r.path !== view.folder)
  const appDataRabbit = demoState?.appDataDir ? `${demoState.appDataDir}\\rabbit-data` : 'this computer’s app data'

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

        {/* Session 12: in a browser there is no local storage bridge, so the
            dot must be off — the previous `|| !bridge` showed a green dot on
            exactly the host where the provider can never work. Electron keeps
            its original meaning: green only once a folder is open. */}
        <Card icon={HardDrive} title="Local demo folder" connected={!!demo && view.mode === 'active'}>
          {!demo && (
            <div className="text-[11px] font-mono" style={{ color: '#1c1917' }}>
              Managed by the desktop app — unavailable in the browser.
            </div>
          )}

          {/* Audrey, 2026-09-11: "in settings just clarify that it is only
              working for demos as local projects cant be shared with
              other[s]" — and the rule behind it: databases stay in Supabase,
              only media goes local. Every state of the card carries it. */}
          {demo && (
            <div className="text-[11px]" style={{ color: '#7c2d12' }} data-local-card="demo-only">
              <b>For demos only.</b> Nothing stored on this computer can be shared with anyone. Databases stay in Supabase; local storage is for media. In Supabase mode a <b>private project</b> keeps its media here{demoState?.mediaRoot ? ':' : '.'}
            </div>
          )}
          {demo && demoState?.mediaRoot && (
            <PathLine title={demoState.mediaRoot}>{demoState.mediaRoot}</PathLine>
          )}

          {demo && confirm && (
            <div className="flex flex-col gap-2" data-local-card="confirm">
              <div className="text-[11px]" style={{ color: '#1c1917' }}>
                {confirm.kind === 'corrupt'
                  ? 'This folder has a demo file that cannot be read.'
                  : `This folder already holds ${confirm.count} item${confirm.count === 1 ? '' : 's'}.`}
                {' '}Nothing in it is touched. Use it for the demo anyway?
              </div>
              <PathLine>{confirm.folder}</PathLine>
              {confirm.entries.length > 0 && (
                <PathLine>{confirm.entries.slice(0, 6).join(', ')}{confirm.count > 6 ? ', …' : ''}</PathLine>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <SmallButton style={DARK_BTN} onClick={() => answerConfirm(true)}>Use this folder</SmallButton>
                <SmallButton style={QUIET_BTN} onClick={() => answerConfirm(false)}>Choose another</SmallButton>
              </div>
            </div>
          )}

          {demo && !confirm && view.mode === 'active' && (
            <div className="flex flex-col gap-2" data-local-card="active">
              <PathLine title={view.folder}>{view.folder}</PathLine>
              <div className="text-[11px]" style={{ color: '#1c1917' }}>
                In Local Server mode, projects, files and thumbnails live in this folder; in Supabase mode, private projects’ media does. Copy the whole folder to carry the demo to another computer.
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                  <SmallButton icon={FolderOpen} style={{ ...DARK_BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={chooseDemoFolder}>
                    Change folder…
                  </SmallButton>
                </GatedAction>
                <SmallButton icon={ExternalLink} style={QUIET_BTN} disabled={busy} onClick={openDemoInExplorer}>
                  Open in Explorer
                </SmallButton>
                <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                  <SmallButton icon={X} style={{ ...QUIET_BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={closeDemoFolder}>
                    Close folder
                  </SmallButton>
                </GatedAction>
              </div>
              {/* Demo comfort (brief §3.4): a seeded project to land on, and
                  a reset that names the folder and what it deletes. */}
              <div className="flex items-center gap-2 flex-wrap" data-local-card="comfort">
                <GatedAction allowed={canSeed} reason={rabbit ? 'Switch the Storage Backend to Local Server to seed a demo project.' : 'R.A.B.B.I.T. is not ready.'}>
                  <SmallButton icon={Sparkles} style={{ ...QUIET_BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={createDemoProject}>
                    Create demo project
                  </SmallButton>
                </GatedAction>
                <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                  <SmallButton icon={RotateCcw} style={{ ...DANGER_BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={resetDemoFolder}>
                    Reset demo folder…
                  </SmallButton>
                </GatedAction>
              </div>
              {seedStatus && (
                <div className="text-[11px] font-bold" style={{ color: '#166534' }}>{seedStatus}</div>
              )}
            </div>
          )}

          {demo && !confirm && view.mode === 'missing' && (
            <div className="flex flex-col gap-2" data-local-card="missing">
              <div className="text-[11px] font-bold" style={{ color: '#991b1b' }}>
                Your demo folder is not available. Plug the drive in, or point WILSON at it again.
              </div>
              <PathLine title={view.folder}>{view.folder}</PathLine>
              <div className="flex items-center gap-2 flex-wrap">
                <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                  <SmallButton icon={FolderOpen} style={{ ...DARK_BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={chooseDemoFolder}>
                    Locate it…
                  </SmallButton>
                </GatedAction>
                <SmallButton icon={X} style={QUIET_BTN} disabled={busy} onClick={() => forgetDemoFolder(view.folder)}>
                  Forget it
                </SmallButton>
              </div>
            </div>
          )}

          {demo && !confirm && view.mode === 'none' && (
            <div className="flex flex-col gap-2" data-local-card="none">
              <div className="text-[11px]" style={{ color: '#1c1917' }}>
                No demo folder is open. Projects live in this computer’s app data:
              </div>
              <PathLine>{appDataRabbit}</PathLine>
              <div className="flex items-center gap-2 flex-wrap">
                <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                  <SmallButton icon={FolderOpen} style={{ ...DARK_BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={chooseDemoFolder}>
                    Choose a demo folder…
                  </SmallButton>
                </GatedAction>
              </div>
            </div>
          )}

          {demo && !confirm && others.length > 0 && (
            <div className="mt-2 flex flex-col gap-1" data-local-card="recent">
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: LIGHT_INK }}>Recent folders</div>
              {others.map((r) => (
                <div key={r.path} className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-mono break-all" style={{ color: '#1c1917' }} title={r.path}>
                    <b>{folderLeaf(r.path)}</b> · {r.path}
                  </span>
                  <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                    <SmallButton style={{ ...QUIET_BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => reopenDemoFolder(r.path)}>Open</SmallButton>
                  </GatedAction>
                  <SmallButton style={QUIET_BTN} disabled={busy} onClick={() => forgetDemoFolder(r.path)}>Forget</SmallButton>
                </div>
              ))}
            </div>
          )}

          {demo && demoError && (
            <div className="mt-2 text-[11px] font-bold" style={{ color: '#991b1b' }}>{demoError}</div>
          )}

          {/* The per-machine files root — the fallback the resolution chain lands
              on when NO demo folder is open (project folder_root → workspace
              root → this). Hidden while a folder is open: its projects/
              subfolder is the root then, computed rather than stored. */}
          {bridge && view.mode !== 'active' && (
            <div className="mt-3 pt-2 flex items-center gap-2 flex-wrap" style={{ borderTop: '1px solid rgba(28,25,23,0.15)' }}>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: LIGHT_INK }}>Project files root</span>
              <span className="text-[11px] font-mono truncate" style={{ color: '#1c1917', maxWidth: 320 }} title={localPath ?? undefined}>
                {localPath || 'Default app-data folder'}
              </span>
              {bridge?.pickDirectory && (
                <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                  <button
                    type="button"
                    onClick={pickLocalFolder}
                    disabled={busy}
                    className="flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-sm"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', opacity: busy ? 0.6 : 1 }}
                  >
                    <FolderOpen className="w-3 h-3" /> Change folder
                  </button>
                </GatedAction>
              )}
            </div>
          )}
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
                style={{ ...DANGER_BTN, opacity: busy ? 0.6 : 1 }}
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
