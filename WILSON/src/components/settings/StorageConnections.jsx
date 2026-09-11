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
import './settings.css'
import { Section, Group, Row } from './SettingsChrome'
import { Button, Dialog } from '../../ui'

const SUPABASE_HOST = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL).host } catch { return null }
})()

function Dot({ on }) {
  return <span className="s-conn-dot inline-block w-2 h-2 rounded-full flex-shrink-0" data-on={!!on} />
}

// One card per provider (Law of Common Region). The title is the 14px card
// step, not the 16px section step: a card sits INSIDE a section, and when the
// two shared a size the card title collided with the section title above it.
function Card({ icon: Icon, title, connected, children }) {
  return (
    <div className="s-well">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" aria-hidden="true" />
        <span className="s-card-title">{title}</span>
        <Dot on={connected} />
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

// UI overhaul D1 (2026-09-11): DARK_BTN / QUIET_BTN / DANGER_BTN used to be
// three private style objects spread into `style` at fourteen call sites,
// seven of them as `{ ...X, opacity: busy ? 0.6 : 1 }`. Two problems came
// with that shape and both are fixed here rather than restyled around:
//
//   1. An inline background beats any `hover:` class, so these buttons could
//      never have a hover state at all.
//   2. Three of the fourteen (Open in Explorer, Forget it, Forget) passed the
//      bare object with `disabled={busy}` and NO opacity, so three buttons
//      stayed at full strength while seven dimmed — the same disabled state
//      drawn two ways in one card.
//
// Now the kit Button, so this card stops being its own button language (C8).
// `variant` maps onto the kit's: primary is the one filled action per region,
// quiet is secondary, danger is danger. The `busy` prop is gone with the
// opacity spelling of "disabled" that plan §3.1 bans — `disabled` alone now
// carries it, through the kit's one disabled token, which also fixes the
// three buttons that used to stay at full strength while seven dimmed.
//
// 🚨 THE GLYPH IS A CHILD, NOT A PROP. `Button` takes no `Icon`: it
// destructures variant/size/surface/primary/danger/small/type/className/
// children and spreads everything else onto the DOM <button>, so `Icon={X}`
// rendered NOTHING and handed React a function-valued attribute. It is
// `IconButton` that takes `Icon`. The kit sizes an icon child through
// `.ui-btn > svg`, which is why this shape works and the prop did not.
const VARIANTS = { primary: 'primary', quiet: 'secondary', danger: 'danger' }

function SmallButton({ icon: Icon, children, variant = 'quiet', ...rest }) {
  return (
    <Button surface="light" size="sm" variant={VARIANTS[variant]} {...rest}>
      {Icon && <Icon aria-hidden="true" />}{children}
    </Button>
  )
}

// A path is a fact: monospace, full, wraps anywhere, never truncated. One of
// the seven mono uses S43 leaves standing on this surface.
function PathLine({ children, title }) {
  return (
    <div className="s-data s-row-desc break-all" title={title}>
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
  // W9 (ruled 2026-09-11, "convert"): which of the card's three confirm
  // Dialogs is open — 'drive' | 'close' | 'reset' — and the failure of ITS
  // attempt, shown in its footer. `demoError` keeps its old job on the card
  // unchanged; this one is cleared when a dialog opens so a stale card error
  // never appears inside a fresh dialog.
  const [pending, setPending] = useState(null)
  const [pendingError, setPendingError] = useState('')
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

  // W9 (ruled 2026-09-11, "convert"): the three native confirms on this card
  // are the kit Dialog. Each is split into the ASK — opens the dialog, and
  // keeps the S34 gate and the bridge check exactly where the confirm used to
  // sit — and the DO, which runs from the dialog's own button under its busy
  // lock. The wording is the old confirm text verbatim; the outcome is the
  // old outcome. Where an attempt fails, the message goes to the dialog's
  // footer (so the button never looks dead under a backdrop) AND to the card
  // as before, so the card still says what went wrong once the dialog closes.
  const failPending = useCallback((message) => {
    if (!mountedRef.current) return
    setDemoError(message)
    setPendingError(message)
    setBusy(false)
  }, [])
  const closePending = useCallback(() => { setPending(null); setPendingError('') }, [])

  const disconnectDrive = useCallback(() => {
    if (!bridge?.clearGdrive || busy) return
    setPendingError('')
    setPending('drive')
  }, [bridge, busy])
  // A failure here was always swallowed ("already gone") and still is: the
  // card refreshes on the next look. The dialog closes either way.
  const doDisconnectDrive = useCallback(async () => {
    if (!bridge?.clearGdrive || busy) return
    setBusy(true)
    try { await bridge.clearGdrive(); await refresh() } catch { /* already gone */ }
    if (mountedRef.current) { setBusy(false); closePending() }
  }, [bridge, busy, refresh, closePending])

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

  const closeDemoFolder = useCallback(() => {
    if (!canEditMachineRoot) return
    if (!demo?.close || busy) return
    setPendingError('')
    setPending('close')
  }, [demo, busy, canEditMachineRoot])
  const doCloseDemoFolder = useCallback(async () => {
    if (!canEditMachineRoot) return
    if (!demo?.close || busy) return
    setBusy(true)
    setDemoError('')
    try { await demo.close(); reloadApp() }
    catch (err) { failPending(err?.message || 'the folder could not be closed') }
  }, [demo, busy, canEditMachineRoot, failPending])

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
  const resetDemoFolder = useCallback(() => {
    if (!canEditMachineRoot) return
    if (!demo?.reset || busy || !demoState?.active) return
    setPendingError('')
    setPending('reset')
  }, [demo, busy, canEditMachineRoot, demoState])
  const doResetDemoFolder = useCallback(async () => {
    if (!canEditMachineRoot) return
    if (!demo?.reset || busy || !demoState?.active) return
    setBusy(true)
    setDemoError('')
    try {
      const r = await demo.reset()
      if (!r?.ok) { failPending(r?.error || 'the folder could not be reset'); return }
      reloadApp()
    } catch (err) {
      failPending(err?.message || 'the folder could not be reset')
    }
  }, [demo, busy, canEditMachineRoot, demoState, failPending])

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
    <Section
      title="Storage connections"
      description="Connection details for each backend on this machine. AWS S3 and Hetzner arrive after v1.0 through one S3-compatible adapter."
    >
      <div className="flex flex-col gap-3">
        <Card icon={Cloud} title="Supabase (company cloud)" connected={!!perms.workspaceId}>
          <div className="s-row-desc">
            {perms.workspaceId
              ? <>Signed in · <span className="s-data">{SUPABASE_HOST ?? 'host unknown'}</span></>
              : 'Not signed in on this machine.'}
          </div>
        </Card>

        {/* Session 12: in a browser there is no local storage bridge, so the
            dot must be off — the previous `|| !bridge` showed a green dot on
            exactly the host where the provider can never work. Electron keeps
            its original meaning: green only once a folder is open. */}
        <Card icon={HardDrive} title="Local demo folder" connected={!!demo && view.mode === 'active'}>
          {!demo && (
            <p className="s-row-desc">Managed by the desktop app — unavailable in the browser.</p>
          )}

          {/* Audrey, 2026-09-11: "in settings just clarify that it is only
              working for demos as local projects cant be shared with
              other[s]" — and the rule behind it: databases stay in Supabase,
              only media goes local. Every state of the card carries it. */}
          {demo && (
            <div className="s-row-desc" data-local-card="demo-only">
              <b>For demos only.</b> Nothing stored on this computer can be shared with anyone. Databases stay in Supabase; local storage is for media. In Supabase mode a <b>private project</b> keeps its media here{demoState?.mediaRoot ? ':' : '.'}
            </div>
          )}
          {demo && demoState?.mediaRoot && (
            <PathLine title={demoState.mediaRoot}>{demoState.mediaRoot}</PathLine>
          )}

          {demo && confirm && (
            <div className="flex flex-col gap-2" data-local-card="confirm">
              <div className="s-row-desc">
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
                <SmallButton variant="primary" onClick={() => answerConfirm(true)}>Use this folder</SmallButton>
                <SmallButton variant="quiet" onClick={() => answerConfirm(false)}>Choose another</SmallButton>
              </div>
            </div>
          )}

          {demo && !confirm && view.mode === 'active' && (
            <div className="flex flex-col gap-2" data-local-card="active">
              <PathLine title={view.folder}>{view.folder}</PathLine>
              <p className="s-row-desc">
                In Local Server mode, projects, files and thumbnails live in this folder; in Supabase mode, private projects’ media does. Copy the whole folder to carry the demo to another computer.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                  <SmallButton icon={FolderOpen} variant="primary" disabled={busy} onClick={chooseDemoFolder}>
                    Change folder…
                  </SmallButton>
                </GatedAction>
                <SmallButton icon={ExternalLink} variant="quiet" disabled={busy} onClick={openDemoInExplorer}>
                  Open in Explorer
                </SmallButton>
                <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                  <SmallButton icon={X} variant="quiet" disabled={busy} onClick={closeDemoFolder}>
                    Close folder
                  </SmallButton>
                </GatedAction>
              </div>
              {/* Demo comfort (brief §3.4): a seeded project to land on, and
                  a reset that names the folder and what it deletes. */}
              <div className="flex items-center gap-2 flex-wrap" data-local-card="comfort">
                <GatedAction allowed={canSeed} reason={rabbit ? 'Switch the Storage Backend to Local Server to seed a demo project.' : 'R.A.B.B.I.T. is not ready.'}>
                  <SmallButton icon={Sparkles} variant="quiet" disabled={busy} onClick={createDemoProject}>
                    Create demo project
                  </SmallButton>
                </GatedAction>
                <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                  <SmallButton icon={RotateCcw} variant="danger" disabled={busy} onClick={resetDemoFolder}>
                    Reset demo folder…
                  </SmallButton>
                </GatedAction>
              </div>
              {/* S10: this measured 3.70:1 on the ground. */}
              {seedStatus && (
                <p className="s-feedback" data-tone="ok" role="status">{seedStatus}</p>
              )}
            </div>
          )}

          {demo && !confirm && view.mode === 'missing' && (
            <div className="flex flex-col gap-2" data-local-card="missing">
              <p className="s-feedback" data-tone="error" role="alert">
                Your demo folder is not available. Plug the drive in, or point WILSON at it again.
              </p>
              <PathLine title={view.folder}>{view.folder}</PathLine>
              <div className="flex items-center gap-2 flex-wrap">
                <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                  <SmallButton icon={FolderOpen} variant="primary" disabled={busy} onClick={chooseDemoFolder}>
                    Locate it…
                  </SmallButton>
                </GatedAction>
                <SmallButton icon={X} variant="quiet" disabled={busy} onClick={() => forgetDemoFolder(view.folder)}>
                  Forget it
                </SmallButton>
              </div>
            </div>
          )}

          {demo && !confirm && view.mode === 'none' && (
            <div className="flex flex-col gap-2" data-local-card="none">
              <p className="s-row-desc">
                No demo folder is open. Projects live in this computer’s app data:
              </p>
              <PathLine>{appDataRabbit}</PathLine>
              <div className="flex items-center gap-2 flex-wrap">
                <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                  <SmallButton icon={FolderOpen} variant="primary" disabled={busy} onClick={chooseDemoFolder}>
                    Choose a demo folder…
                  </SmallButton>
                </GatedAction>
              </div>
            </div>
          )}

          {demo && !confirm && others.length > 0 && (
            <div className="mt-2 flex flex-col gap-1" data-local-card="recent">
              <span className="s-eyebrow">Recent folders</span>
              {others.map((r) => (
                <div key={r.path} className="flex items-center gap-2 flex-wrap">
                  <span className="s-data s-row-desc break-all" title={r.path}>
                    <b>{folderLeaf(r.path)}</b> · {r.path}
                  </span>
                  <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                    <SmallButton variant="quiet" disabled={busy} onClick={() => reopenDemoFolder(r.path)}>Open</SmallButton>
                  </GatedAction>
                  <SmallButton variant="quiet" disabled={busy} onClick={() => forgetDemoFolder(r.path)}>Forget</SmallButton>
                </div>
              ))}
            </div>
          )}

          {demo && demoError && (
            <p className="s-feedback" data-tone="error" role="alert">{demoError}</p>
          )}

          {/* The per-machine files root — the fallback the resolution chain lands
              on when NO demo folder is open (project folder_root → workspace
              root → this). Hidden while a folder is open: its projects/
              subfolder is the root then, computed rather than stored. */}
          {/* S15: this control and the one on the General tab write the same
              `defaultRootDir`, and used to do it in two visual languages — a
              bordered panel with a mono block and three chunky uppercase
              buttons there, a hairline row with an 11px truncated path and one
              button here. Same row contract now, so they read as one setting
              shown twice rather than two settings that happen to agree.
              Neither is deleted: a source-text count in workspaceRootWiring
              holds the General one in place. */}
          {bridge && view.mode !== 'active' && (
            <div className="s-row" style={{ marginTop: '8px' }}>
              <div className="s-row-label">
                <span className="s-label">Project files root</span>
                <div className="s-data s-row-desc break-all" title={localPath ?? undefined}>
                  {localPath || 'Default app-data folder'}
                </div>
              </div>
              <div className="s-row-control">
              {bridge?.pickDirectory && (
                <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                  {/* Was a hand-rolled copy of SmallButton's exact markup and
                      DARK_BTN's exact values, written out again. Same
                      component now, so the files root and the demo folder
                      stop being two buttons that only look alike. */}
                  <SmallButton icon={FolderOpen} variant="primary" disabled={busy} onClick={pickLocalFolder}>
                    Change folder
                  </SmallButton>
                </GatedAction>
              )}
              </div>
            </div>
          )}
        </Card>

        <Card icon={Cloud} title="Google Drive" connected={driveConnected}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="s-row-desc flex-1">
              {bridge
                ? (driveConnected ? 'Connected on this machine.' : 'Not connected — configure from the R.A.B.B.I.T. Drive setup.')
                : 'Managed by the desktop app.'}
            </span>
            {driveConnected && bridge?.clearGdrive && (
              <SmallButton icon={Unplug} variant="danger" disabled={busy} onClick={disconnectDrive}>
                Disconnect
              </SmallButton>
            )}
          </div>
        </Card>
      </div>

      {/* W9: the card's three confirms, one kit Dialog each at the 400px
          'confirm' width — dark by design over the light page, as the pet
          dialogs in SettingsPage are. Escape, the X and Cancel dismiss; the
          one filled button runs the action under the busy lock; a failed
          attempt reports in the footer. Reset is the destructive one (it
          deletes two subtrees) and takes the danger variant; closing deletes
          nothing and disconnecting is undone by reconnecting, so both take
          the filled primary. The body copy is the old confirm text, verbatim. */}
      {pending === 'drive' && (
        <Dialog
          title="Disconnect Google Drive"
          width="confirm"
          busy={busy}
          onClose={closePending}
          footer={
            <>
              <Button disabled={busy} onClick={closePending}>Cancel</Button>
              <Button variant="primary" disabled={busy} onClick={doDisconnectDrive}>
                Disconnect
              </Button>
            </>
          }
        >
          Disconnect Google Drive? Cached tokens are removed from this machine.
        </Dialog>
      )}

      {pending === 'close' && (
        <Dialog
          title="Close demo folder"
          width="confirm"
          busy={busy}
          error={pendingError || null}
          onClose={closePending}
          footer={
            <>
              <Button disabled={busy} onClick={closePending}>Cancel</Button>
              <Button variant="primary" disabled={busy} onClick={doCloseDemoFolder}>
                Close folder
              </Button>
            </>
          }
        >
          <p>Close the demo folder "{folderLeaf(demoState?.active)}"?</p>
          <p className="mt-3">Nothing is deleted. WILSON goes back to the projects in this computer's app data until you open a folder again.</p>
        </Dialog>
      )}

      {pending === 'reset' && demoState?.active && (
        <Dialog
          title="Reset demo folder"
          width="confirm"
          busy={busy}
          error={pendingError || null}
          onClose={closePending}
          footer={
            <>
              <Button disabled={busy} onClick={closePending}>Cancel</Button>
              <Button variant="danger" disabled={busy} onClick={doResetDemoFolder}>
                Reset folder
              </Button>
            </>
          }
        >
          {/* The helper's text carries its own line breaks and two indented
              paths; pre-wrap keeps both, break-words lets a long path wrap
              inside the 400px surface without breaking the prose mid-word.
              Not PathLine: `.s-data` is the light ink and this surface is
              dark (D1 hand-off §3, the currency-menu blocker). */}
          <div className="whitespace-pre-wrap break-words">{resetConfirmText(demoState.active)}</div>
        </Dialog>
      )}
    </Section>
  )
}
