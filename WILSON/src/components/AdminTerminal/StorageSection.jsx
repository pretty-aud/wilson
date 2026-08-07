// =============================================================================
// StorageSection — Session 34: the workspace storage root.
//
// Audrey, 2026-08-05: "admins can set server/drive... the admins can set the
// drive in the admin terminal. the managers set the project folder in the
// drive in the project control panel." This is the admin half; the manager
// half (projects.folder_root containment) is Session 35.
//
// What an admin does here:
//   * Pick the storage MODE — 'central' (Petal cloud) or 'byos' (the
//     company's own server/NAS). §5b: the vocabulary 0001 declared and never
//     built, now on a table whose rows only validated code has written.
//   * In byos mode, set the ROOT — the one path every computer in the office
//     resolves media under (\\nas\projects\wilson). Saved through RLS that
//     enforces admin-only (0048, suite 58); this screen is the courtesy.
//
// The save pipeline refuses what cannot travel (NETWORK_STORAGE_DESIGN §5a2):
//   mapped drive  → refused; Z: names a different folder on every machine.
//                   Detected via the Electron probe (net use) — a string
//                   cannot tell Z:\ from a real disk, so the web form warns
//                   instead.
//   bare root     → refused; \\srv\share or C:\ hands WILSON the whole
//                   share/disk. Ask for a subfolder.
//   local folder  → TWO-STEP confirm: step 1 explains (this computer only,
//                   the team will not see these files), step 2 asks. Split
//                   on purpose — a single "Are you sure?" gets clicked
//                   through; being told what will happen and then asked
//                   separately does not.
//   network path  → reachability probe (exists/read/write/round-trip) at
//                   CONFIGURATION time, not at the first download six
//                   screens away. Probe is Electron-only; the browser says
//                   so instead of pretending.
//
// Section contract: mountedRef / loadedRef gated on isActive / seqRef
// (CompanySection's shape). Saves PATCH only the columns they change — two
// admins changing two different settings must not clobber each other (§5b).
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { Cloud, Server, FolderOpen, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { fetchWorkspaceStorage, saveWorkspaceStorage } from '../../cloud/workspaceStorage'
import { canonicalizeRoot, classifyRoot } from '../../lib/storageRoot'
// Session 36: the provider axis (migration 0050). Imported rather than spelled
// as a literal so this section and the registry cannot drift apart — the
// vocabulary has exactly one definition on the client.
import { WORKSPACE_PROVIDERS } from '../../tools/rabbit_v0.1.0/storage'

const cardStyle = {
  backgroundColor: 'rgba(120, 70, 30, 0.12)',
  border: '1px solid rgba(120, 70, 30, 0.3)',
}
const lightInputStyle = {
  backgroundColor: 'rgba(120, 70, 30, 0.55)',
  color: '#fde8d0',
  border: 'none',
}
const darkBtnClass = 'px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40'
const darkBtnStyle = { backgroundColor: '#1c1917', color: '#f4a261' }

const MODES = [
  {
    key: 'central',
    label: 'Petal cloud',
    icon: Cloud,
    blurb: 'Files live in WILSON\u2019s cloud storage. Works everywhere, no setup — best for small files and distributed teams.',
  },
  {
    key: 'byos',
    label: 'Your server / NAS',
    icon: Server,
    blurb: 'Files live on a network share you own (\\\\server\\share\\...). Every computer in the office resolves the same folder; remote access is your VPN or your NAS\u2019s own.',
  },
]

export default function StorageSection({ isActive, workspaceId }) {
  const bridge = typeof window !== 'undefined' ? window.electronAPI?.rabbit : null

  const [row, setRow] = useState(null)        // workspace_storage row, null = unconfigured
  const [loaded, setLoaded] = useState(false) // false until the first fetch settles
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [notice, setNotice] = useState(null)

  const [rootDraft, setRootDraft] = useState('')
  const [refusal, setRefusal] = useState(null)
  const [probe, setProbe] = useState(null)
  const [probing, setProbing] = useState(false)
  // 0 = idle · 1 = local-path explanation · 2 = local-path confirmation.
  const [confirmStep, setConfirmStep] = useState(0)
  const [pendingLocal, setPendingLocal] = useState(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const loadedRef = useRef(false)
  const seqRef = useRef(0)
  function load() {
    const seq = ++seqRef.current
    setLoadError(null)
    fetchWorkspaceStorage()
      .then(data => {
        if (!mountedRef.current || seq !== seqRef.current) return
        setRow(data)
        setRootDraft(data?.root_path || '')
        setLoaded(true)
      })
      .catch(err => {
        if (!mountedRef.current || seq !== seqRef.current) return
        // A broken read must not present as "unconfigured" — an admin who
        // saves over it would clobber a root they never saw.
        setLoadError(err?.message || String(err))
        setLoaded(true)
      })
  }
  useEffect(() => {
    if (!isActive || loadedRef.current || !workspaceId) return
    loadedRef.current = true
    load()
  }, [isActive, workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const mode = row?.mode || 'central'

  async function applyPatch(patch) {
    if (saving) return null
    setSaving(true)
    setSaveError(null)
    setNotice(null)
    try {
      const next = await saveWorkspaceStorage({ workspaceId, exists: !!row, patch })
      if (!mountedRef.current) return next
      setRow(next)
      // This machine resolves the change immediately; other machines pick it
      // up on their next launch / sign-in (stated limit, S34). rootKind rides
      // along: main applies a 'local' root only where the folder actually
      // exists (§3.1 — the same string names a different folder per machine).
      if (bridge?.setWorkspaceRoot) {
        await bridge.setWorkspaceRoot({
          rootPath: next.mode === 'byos' ? (next.root_path || null) : null,
          rootKind: next.mode === 'byos' ? (next.root_kind || null) : null,
        }).catch(() => {})
      }
      return next
    } catch (err) {
      if (mountedRef.current) setSaveError(err?.message || String(err))
      return null
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  async function selectMode(nextKey) {
    if (nextKey === mode || saving || loadError) return
    resetRootFlow()
    // Session 36: switching to "your server / NAS" must NAME the provider —
    // 0050's workspace_storage_mode_provider_chk refuses byos with no real
    // provider, so patching mode alone would fail the save. 'network' is the
    // only byos provider today; S37 turns this into a picker.
    //
    // Switching back to Petal cloud deliberately leaves `provider` alone, so
    // the choice is RETAINED exactly as root_path is (0048's retyping rule).
    // The retained provider is inert: this component and App.jsx both push the
    // root only when mode is 'byos'.
    const next = await applyPatch(nextKey === 'byos'
      ? { mode: 'byos', provider: WORKSPACE_PROVIDERS.NETWORK }
      : { mode: 'central' })
    if (next) {
      setNotice(nextKey === 'byos'
        ? 'Storage mode saved. Set the storage root below.'
        : 'Storage mode saved — files ride Petal cloud storage.')
    }
  }

  function resetRootFlow() {
    setRefusal(null)
    setProbe(null)
    setConfirmStep(0)
    setPendingLocal(null)
    setNotice(null)
    setSaveError(null)
  }

  async function browseForRoot() {
    if (!bridge?.pickDirectory || probing || saving) return
    try {
      const dir = await bridge.pickDirectory()
      if (dir && mountedRef.current) {
        resetRootFlow()
        setRootDraft(dir)
      }
    } catch { /* dialog cancelled */ }
  }

  async function beginSaveRoot() {
    resetRootFlow()
    const canonical = canonicalizeRoot(rootDraft)
    const cls = classifyRoot(canonical)
    if (cls.kind === 'invalid' || cls.bareRoot) {
      setRefusal(cls.reason)
      return
    }
    let probeResult = null
    if (bridge?.probeStorageRoot) {
      setProbing(true)
      probeResult = await bridge.probeStorageRoot({ path: canonical }).catch(() => null)
      if (!mountedRef.current) return
      setProbing(false)
      setProbe(probeResult)
      if (cls.kind === 'local' && probeResult?.driveKind === 'network') {
        setRefusal(`${cls.driveLetter}: is a network drive mapped on this computer only — the same letter means something different on every machine. Enter the \\\\server\\share\\... path shown in File Explorer\u2019s address bar instead.`)
        return
      }
      if (!probeResult?.ok) {
        setRefusal(probeResult?.error
          ? `This folder did not pass the reachability check: ${probeResult.error}`
          : 'This folder is not reachable from this computer.')
        return
      }
    }
    if (cls.kind === 'local') {
      // Step 1 is an explanation, not a question — the question is step 2.
      setPendingLocal(canonical)
      setConfirmStep(1)
      return
    }
    // provider rides with the path: setting a filesystem root IS choosing the
    // network provider, and 0050's root_provider_path_chk refuses a root_path
    // under any other one.
    const next = await applyPatch({
      provider: WORKSPACE_PROVIDERS.NETWORK, root_path: canonical, root_kind: 'unc',
    })
    if (next) {
      setRootDraft(next.root_path || '')
      setNotice('Storage root saved. Each computer picks it up at its next launch or sign-in; this one resolves it now.')
    }
  }

  async function commitLocalRoot() {
    const canonical = pendingLocal
    setConfirmStep(0)
    setPendingLocal(null)
    if (!canonical) return
    const next = await applyPatch({
      provider: WORKSPACE_PROVIDERS.NETWORK, root_path: canonical, root_kind: 'local',
    })
    if (next) {
      setRootDraft(next.root_path || '')
      setNotice('Folder saved for this computer.')
    }
  }

  const probeSummary = probe?.ok
    ? `Reachable \u00b7 read \u2713 \u00b7 write \u2713 \u00b7 ${probe.roundTripMs} ms`
    : null

  return (
    <div style={{ maxWidth: '720px' }}>
      <h2 className="text-sm font-bold uppercase tracking-widest mb-1" style={{ color: '#1c1917' }}>
        Storage
      </h2>
      <p className="text-xs leading-relaxed mb-4" style={{ color: '#57534e' }}>
        Where this company&rsquo;s media lives. Only workspace admins can
        change these settings.
      </p>

      {loadError && (
        <div className="p-3 rounded-sm mb-3"
             style={{ backgroundColor: 'rgba(220,38,38,0.10)' }}>
          <p className="text-[11px] font-mono mb-2" style={{ color: '#991b1b' }}>
            Storage settings could not be loaded: {loadError}. Changes are
            disabled so a root you cannot see is not overwritten.
          </p>
          <button type="button" onClick={load} className={darkBtnClass} style={darkBtnStyle}>
            Retry
          </button>
        </div>
      )}

      {/* ── Mode ─────────────────────────────────────────────────────── */}
      <div className="p-4 rounded-sm mb-3" style={cardStyle}>
        <h3 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#57534e' }}>
          Storage mode
        </h3>
        <div className="flex flex-col gap-2">
          {MODES.map(m => {
            const Icon = m.icon
            const active = mode === m.key
            return (
              <button
                key={m.key}
                type="button"
                disabled={!loaded || saving || probing || confirmStep !== 0 || !!loadError}
                onClick={() => selectMode(m.key)}
                className="flex items-start gap-3 p-3 rounded-sm text-left transition-colors disabled:opacity-50"
                style={active
                  ? { backgroundColor: 'rgba(234, 88, 12, 0.10)', border: '1px solid #ea580c' }
                  : { backgroundColor: 'transparent', border: '1px solid rgba(120, 70, 30, 0.3)' }}
              >
                <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: active ? '#ea580c' : '#78716c' }} />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#1c1917' }}>
                    {m.label}
                  </span>
                  <span className="text-[11px] leading-relaxed" style={{ color: '#57534e' }}>
                    {m.blurb}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Root (byos only) ─────────────────────────────────────────── */}
      {mode === 'byos' && (
        <div className="p-4 rounded-sm mb-3" style={cardStyle}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: '#57534e' }}>
            Storage root
          </h3>
          <p className="text-[11px] leading-relaxed mb-2" style={{ color: '#57534e' }}>
            The folder everything lives under, as every computer sees it —
            <span className="font-mono"> \\server\share\Projects</span>. Current:{' '}
            <span className="font-mono" style={{ color: '#1c1917' }}>
              {row?.root_path || 'not set'}
            </span>
          </p>

          <div className="flex items-center gap-2 flex-wrap mb-2">
            <input
              type="text"
              value={rootDraft}
              onChange={e => { setRootDraft(e.target.value); if (refusal || notice) resetRootFlow() }}
              placeholder="\\server\share\Projects"
              disabled={saving || probing || !!loadError}
              className="flex-1 min-w-[260px] px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={lightInputStyle}
            />
            {bridge?.pickDirectory && (
              <button type="button" onClick={browseForRoot} disabled={saving || probing || !!loadError}
                      className={`${darkBtnClass} flex items-center gap-1`} style={darkBtnStyle}>
                <FolderOpen className="w-3 h-3" /> Browse
              </button>
            )}
            <button type="button" onClick={beginSaveRoot}
                    disabled={saving || probing || !loaded || !!loadError || !rootDraft.trim() || confirmStep !== 0}
                    className={darkBtnClass} style={darkBtnStyle}>
              {probing ? 'Checking\u2026' : saving ? 'Saving\u2026' : 'Save root'}
            </button>
          </div>

          {!bridge && (
            <p className="text-[11px] leading-relaxed mb-2" style={{ color: '#78716c' }}>
              Reachability can&rsquo;t be checked from a browser — the path is
              verified on each desktop when it connects. If the path is a
              mapped drive letter (<span className="font-mono">Z:\...</span>),
              enter the <span className="font-mono">\\server\share\...</span>{' '}
              form instead: a drive letter means something different on every
              computer.
            </p>
          )}

          {probeSummary && !refusal && confirmStep === 0 && (
            <div className="flex items-center gap-1.5 text-[11px] font-mono mb-1" style={{ color: '#166534' }}>
              <CheckCircle2 className="w-3.5 h-3.5" /> {probeSummary}
            </div>
          )}

          {refusal && (
            <div className="flex items-start gap-1.5 p-2 rounded-sm text-[11px] leading-relaxed mb-1"
                 style={{ backgroundColor: 'rgba(220,38,38,0.10)', color: '#991b1b' }}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{refusal}</span>
            </div>
          )}

          {/* Two-step local-folder confirmation. Step 1 states what will
              happen; only step 2 asks a question. */}
          {confirmStep === 1 && (
            <div className="p-3 rounded-sm mb-1"
                 style={{ backgroundColor: 'rgba(234, 88, 12, 0.10)', border: '1px solid rgba(234, 88, 12, 0.4)' }}>
              <p className="text-[11px] leading-relaxed mb-2" style={{ color: '#1c1917' }}>
                <span className="font-mono">{pendingLocal}</span> is a folder on{' '}
                <strong>this computer only</strong>. Nobody else on the team
                will be able to open these files, and you will not see them
                from another machine. If you work with a team, use a network
                path (<span className="font-mono">\\server\share\...</span>)
                instead.
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setConfirmStep(2)} className={darkBtnClass} style={darkBtnStyle}>
                  Continue
                </button>
                <button type="button" onClick={resetRootFlow}
                        className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm"
                        style={{ color: '#57534e' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {confirmStep === 2 && (
            <div className="p-3 rounded-sm mb-1"
                 style={{ backgroundColor: 'rgba(234, 88, 12, 0.10)', border: '1px solid rgba(234, 88, 12, 0.4)' }}>
              <p className="text-[11px] font-bold mb-2" style={{ color: '#1c1917' }}>
                Set this computer&rsquo;s folder anyway?
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={commitLocalRoot} disabled={saving} className={darkBtnClass} style={darkBtnStyle}>
                  Set folder
                </button>
                <button type="button" onClick={resetRootFlow}
                        className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm"
                        style={{ color: '#57534e' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {saveError && (
        <div className="p-2 rounded-sm text-[11px] font-mono mb-2"
             style={{ backgroundColor: 'rgba(220,38,38,0.10)', color: '#991b1b' }}>
          {saveError}
        </div>
      )}
      {notice && !saveError && (
        <div className="flex items-center gap-1.5 text-[11px] font-mono mb-2" style={{ color: '#166534' }}>
          <CheckCircle2 className="w-3.5 h-3.5" /> {notice}
        </div>
      )}
    </div>
  )
}
