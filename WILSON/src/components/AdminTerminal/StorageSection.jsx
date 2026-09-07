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
import { Cloud, Server, HardDrive, FolderOpen, AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  fetchWorkspaceStorage, saveWorkspaceStorage, countFilesAtProvider,
  fetchStorageUsage, formatBytes,
} from '../../cloud/workspaceStorage'
// Session 37: the S3-compatible provider's admin surface — secret store and
// the two-half probe (server round trip + this app's own CORS-checking half).
import {
  storageSecretSet, storageSecretClear, storageSecretStatus, storageProbe,
  runS3ClientProbe,
} from '../../cloud/storageApi'
import { canonicalizeRoot, classifyRoot } from '../../lib/storageRoot'
// Session 36: the provider axis (migration 0050). Imported rather than spelled
// as a literal so this section and the registry cannot drift apart — the
// vocabulary has exactly one definition on the client.
import { WORKSPACE_PROVIDERS } from '../../tools/rabbit_v0.1.0/storage'
import { LIGHT_INK, LIGHT_RULE, LIGHT_WELL } from '../lightSurface' // §B — light page

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
    label: 'Your own storage',
    icon: Server,
    blurb: 'Files live on storage you own \u2014 a network share in the office (\\\\server\\share\\...), or your own S3-compatible cloud bucket (AWS, Backblaze B2, Wasabi, Hetzner, Cloudflare R2, MinIO).',
  },
]

// Session 37: the byos PROVIDER picker (S36's comment promised it). Which
// kind of storage the workspace owns \u2014 a filesystem root (S34) or a bucket.
// Mirrors migration 0051's workspace_storage_provider_chk vocabulary minus
// 'petal', which means "none configured".
const BYOS_PROVIDERS = [
  {
    key: WORKSPACE_PROVIDERS.NETWORK,
    label: 'Server / NAS',
    icon: Server,
    blurb: 'A network share every computer in the office resolves. Desktop app territory; remote access is your VPN or your NAS\u2019s own.',
  },
  {
    key: WORKSPACE_PROVIDERS.S3,
    label: 'S3-compatible bucket',
    icon: HardDrive,
    blurb: 'Your own bucket at AWS S3, Backblaze B2, Wasabi, Hetzner, Cloudflare R2 or MinIO. Works from the browser and the desktop; transfers go direct to your bucket.',
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

  // ── Session 37: the S3 card's state ───────────────────────────────────────
  // providerView is a LOCAL draft of which byos card is showing; the DB
  // provider changes only when a card's own Save lands (the bucket save is
  // atomic with its config — 0051's s3_config_chk refuses provider='s3'
  // alone, so there is no "picked s3, configured nothing" state to save).
  const [providerView, setProviderView] = useState(null)
  const [s3Draft, setS3Draft] = useState({
    endpoint: '', region: '', bucket: '', prefix: '', accessKeyId: '', forcePathStyle: false,
  })
  const [s3Refusal, setS3Refusal] = useState(null)
  const [secretDraft, setSecretDraft] = useState('')
  const [secretHint, setSecretHint] = useState(null)
  const [secretStatusError, setSecretStatusError] = useState(false)
  const [cryptoMissing, setCryptoMissing] = useState(false)
  const [savingSecret, setSavingSecret] = useState(false)
  const [clearingSecret, setClearingSecret] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  // Bodies still at the bucket, for the switch warning. null = not counted.
  const [s3FileCount, setS3FileCount] = useState(null)

  // ── Session 41: the Petal-cloud plan card's state ─────────────────────────
  // THREE states, never two, and they are held in a phase string rather than
  // inferred from `usage === null` — because "not read yet" and "could not be
  // read" are the same null and must not render the same way. A reading that
  // fell back to zeros would paint an empty bar and tell a company sitting at
  // its ceiling that it has all its room left; that is the house's named
  // defect ("'0 files affected' on the strength of a failed query"), with
  // money attached. Same rule as secretStatusError and s3FileCount above.
  const [usage, setUsage] = useState(null)              // reading, or null
  const [usagePhase, setUsagePhase] = useState('loading') // loading|error|ready

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
  // Which byos card is showing: the admin's local pick, else what the row
  // says, else the NAS (today's only pre-S37 byos provider).
  const byosProvider = providerView
    ?? (row?.provider === WORKSPACE_PROVIDERS.S3 ? WORKSPACE_PROVIDERS.S3 : WORKSPACE_PROVIDERS.NETWORK)

  // Seed the S3 form from the saved config whenever the row changes (load or
  // save — the only two writers of `row`).
  useEffect(() => {
    const cfg = row?.provider_config
    setS3Draft({
      endpoint: cfg?.endpoint || '',
      region: cfg?.region || '',
      bucket: cfg?.bucket || '',
      prefix: cfg?.prefix || '',
      accessKeyId: cfg?.accessKeyId || '',
      // The resolver's own default rule (s3Presign.s3HostAndPath): a custom
      // endpoint defaults to path-style. Shown, not hidden, so what will
      // happen is what the checkbox says.
      forcePathStyle: typeof cfg?.forcePathStyle === 'boolean' ? cfg.forcePathStyle : !!cfg?.endpoint,
    })
  }, [row])

  // Has the admin edited any field that decides WHERE a file is addressed?
  // accessKeyId and forcePathStyle are excluded deliberately: they change how
  // a request is authorised or shaped, not which object it names.
  const savedCfg = row?.provider === WORKSPACE_PROVIDERS.S3 ? row?.provider_config : null
  const connectionEdited = !!savedCfg && (
    s3Draft.bucket.trim() !== (savedCfg.bucket || '')
    || s3Draft.prefix.trim() !== (savedCfg.prefix || '')
    || s3Draft.endpoint.trim() !== (savedCfg.endpoint || '')
  )

  // The secret hint — fetched once the S3 card shows, and RETRIED after a
  // failure. Latching the ref before the response meant one tripped rate
  // limit or transient 401 left the card asserting "Not stored yet." for the
  // whole visit, over a secret that was in fact stored (S37 review). The
  // three states are distinct: stored / not stored / could not check.
  const secretLoadedRef = useRef(false)
  useEffect(() => {
    if (!isActive || secretLoadedRef.current) return
    if (mode !== 'byos' || byosProvider !== WORKSPACE_PROVIDERS.S3) return
    let cancelled = false
    storageSecretStatus().then(res => {
      if (cancelled || !mountedRef.current) return
      if (!res.ok) { setSecretStatusError(true); return }
      secretLoadedRef.current = true
      setSecretStatusError(false)
      setSecretHint(res.data?.configured ? res.data.keyHint : null)
      setCryptoMissing(res.data?.cryptoConfigured === false)
    })
    return () => { cancelled = true }
  }, [isActive, mode, byosProvider])

  // How much is in the bucket right now — so the switch warning can say what
  // is at stake instead of gesturing at it. null = could not count, which is
  // rendered as unknown, never as zero.
  useEffect(() => {
    if (!isActive || mode !== 'byos') return
    if (row?.provider !== WORKSPACE_PROVIDERS.S3) return
    let cancelled = false
    countFilesAtProvider('s3').then(n => {
      if (!cancelled && mountedRef.current) setS3FileCount(n)
    })
    return () => { cancelled = true }
  }, [isActive, mode, row?.provider])

  // ── Session 41: how much of the Petal-cloud allowance is used ─────────────
  // Its OWN sequence counter, not seqRef: the plan reading and the storage row
  // are two independent fetches, and sharing one counter would let a Retry of
  // the row silently discard an in-flight usage response (and the reverse).
  // mountedRef IS shared, deliberately — there is exactly one mount to track,
  // and a second flag tracking the same thing is a second thing to get wrong.
  const usageSeqRef = useRef(0)

  function loadUsage() {
    const seq = ++usageSeqRef.current
    setUsagePhase('loading')
    // 🚨 fetchStorageUsage, and NEVER the cached workspace-storage reader that
    // sits beside it in the same module. That cache is ONE module-level slot
    // with no TTL, cleared only on sign-out or a workspace switch — correct
    // for a storage CHOICE, wrong for a figure that moves on every upload.
    // Through it the bar would freeze at its first reading for the whole
    // session and look entirely healthy doing it.
    //
    // 🚨 The rule is PINNED by a source-text assertion in
    // src/lib/workspaceRootWiring.test.js that greps this file for the cached
    // getter's BARE NAME — so naming it here, even to forbid it, fails the
    // suite. That is the house's own 0038 trap (a not.toContain matching the
    // comment that explains why the form is wrong); the fix is to describe it,
    // not to relax the assertion.
    fetchStorageUsage()
      .then(data => {
        if (!mountedRef.current || seq !== usageSeqRef.current) return
        // fetchStorageUsage RESOLVES null for a refused or broken read rather
        // than throwing, so null is the error branch — not an empty workspace.
        if (!data) { setUsage(null); setUsagePhase('error'); return }
        setUsage(data)
        setUsagePhase('ready')
      })
      .catch(() => {
        if (!mountedRef.current || seq !== usageSeqRef.current) return
        setUsage(null)
        setUsagePhase('error')
      })
  }

  // Gated on mode as well as isActive so a byos workspace does not pay for a
  // reading nothing renders. `mode` is 'central' before the row settles, which
  // is what we want: the card is on screen from the first paint, so it fetches
  // from the first paint too.
  useEffect(() => {
    if (!isActive || mode !== 'central') return
    loadUsage()
  }, [isActive, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // A quota of zero cannot happen through 0055 (the CHECK is quota_bytes > 0
  // and the free tier resolves server-side), so if one ever arrives it means
  // the reading is wrong — treat it as unknown rather than dividing by it.
  const quotaKnown = usagePhase === 'ready' && usage && usage.quotaBytes > 0
  const usagePct = quotaKnown
    ? Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100)
    : null
  // `>=`, matching rabbit_petal_storage_ok's strict `<`: AT the ceiling the
  // next upload is already refused, so the warning has to appear there too.
  const atCeiling = quotaKnown && usage.usedBytes >= usage.quotaBytes
  const suspended = usagePhase === 'ready' && usage?.status === 'suspended'

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
    // Session 36: switching to byos must NAME a provider — 0050's
    // workspace_storage_mode_provider_chk refuses byos with no real one.
    // Session 37: if a real provider is RETAINED (network or s3, 0048's
    // retyping rule one column over), mode alone is patched and the retained
    // choice — config included — comes back exactly as saved. Only a
    // never-configured workspace gets the 'network' default.
    //
    // Switching back to Petal cloud deliberately leaves `provider` alone, so
    // the choice is RETAINED exactly as root_path is. The retained provider
    // is inert: this component, App.jsx and activeWorkspaceProvider all key
    // on mode.
    const hasRealProvider = row?.provider && row.provider !== WORKSPACE_PROVIDERS.PETAL
    const next = await applyPatch(nextKey === 'byos'
      ? (hasRealProvider ? { mode: 'byos' } : { mode: 'byos', provider: WORKSPACE_PROVIDERS.NETWORK })
      : { mode: 'central' })
    if (next) {
      setNotice(nextKey === 'byos'
        ? 'Storage mode saved. Configure your server or bucket below.'
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
    setS3Refusal(null)
    setTestResult(null)
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
    // under any other one. provider_config is nulled in the SAME patch —
    // 0050's provider_config_chk refuses a config on 'network', so a
    // workspace coming FROM s3 must shed its bucket config here (S37; the
    // card warns before this lands).
    const next = await applyPatch({
      provider: WORKSPACE_PROVIDERS.NETWORK, root_path: canonical, root_kind: 'unc',
      provider_config: null,
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
      provider_config: null,
    })
    if (next) {
      setRootDraft(next.root_path || '')
      setNotice('Folder saved for this computer.')
    }
  }

  // ── Session 37: the S3 card's handlers ────────────────────────────────────
  // Client-side sentences for what 0051's workspace_storage_s3_config_chk
  // will refuse anyway — the DB is the authority; these exist so the refusal
  // arrives beside the field instead of as a constraint name.
  function validateS3Draft(d) {
    if (!d.bucket.trim()) return 'the bucket name is required'
    if (/[\\/\s]/.test(d.bucket.trim())) return 'the bucket name cannot contain slashes or spaces'
    if (!d.region.trim()) return 'the region is required — B2 puts it in the endpoint host (e.g. us-west-004); Cloudflare R2 uses "auto"'
    if (/[\\/\s]/.test(d.region.trim())) return 'the region cannot contain slashes or spaces'
    if (!d.accessKeyId.trim()) return 'the access key id is required (the secret is saved separately below)'
    const ep = d.endpoint.trim()
    if (ep && !/^https:\/\/\S+$/.test(ep)) return 'the endpoint must be an https:// URL — media does not cross the wire in the clear'
    if (ep.endsWith('/')) return 'the endpoint must not end with a slash'
    // Host only. The signer builds the URL path itself, so a path in the
    // endpoint (a reverse-proxied MinIO at https://host/minio) would be
    // silently dropped and every request would hit the wrong origin path —
    // surfacing as "bucket does not exist", which points at the one field
    // that was correct. Refused here, in the CHECK, and in the signer (S37
    // review).
    if (ep && /^https:\/\/[^/?#]+[/?#]/.test(ep)) {
      return 'the endpoint must be a host only (https://host or https://host:port) — drop everything after it'
    }
    const p = d.prefix.trim()
    if (p) {
      if (p.startsWith('/') || p.endsWith('/')) return 'the prefix must not start or end with a slash'
      if (p.includes('//') || p.includes('\\')) return 'the prefix cannot contain doubled slashes or backslashes'
      if (/(^|\/)\.\.?(\/|$)/.test(p)) return 'the prefix cannot contain . or .. segments'
    }
    return null
  }

  async function saveBucket() {
    if (saving) return
    setS3Refusal(null)
    setTestResult(null)
    const d = s3Draft
    const invalid = validateS3Draft(d)
    if (invalid) { setS3Refusal(invalid); return }
    const cfg = {
      region: d.region.trim(),
      bucket: d.bucket.trim(),
      accessKeyId: d.accessKeyId.trim(),
      forcePathStyle: !!d.forcePathStyle,
      ...(d.endpoint.trim() ? { endpoint: d.endpoint.trim() } : {}),
      ...(d.prefix.trim() ? { prefix: d.prefix.trim() } : {}),
    }
    // Atomic on purpose: provider + config land together (0051's
    // required-direction arm), and root_path/root_kind are shed in the same
    // patch (a bucket row cannot carry a filesystem root — the converse arm).
    const next = await applyPatch({
      provider: WORKSPACE_PROVIDERS.S3,
      root_path: null,
      root_kind: null,
      provider_config: cfg,
    })
    if (next) {
      setNotice(secretHint
        ? 'Bucket saved. Test the connection below.'
        : 'Bucket saved. Save the access key secret, then test the connection.')
    }
  }

  async function saveSecret() {
    if (savingSecret || !secretDraft.trim()) return
    setSavingSecret(true)
    setS3Refusal(null)
    setNotice(null)
    const res = await storageSecretSet(secretDraft.trim())
    if (!mountedRef.current) return
    setSavingSecret(false)
    if (res.ok) {
      setSecretHint(res.data?.keyHint || null)
      setSecretDraft('')
      setNotice('Secret stored, encrypted. Only its last characters are ever shown again.')
    } else {
      setS3Refusal(res.data?.detail || res.data?.error || 'the secret could not be saved')
    }
  }

  // 🚨 The 8th no-caller feature, caught before it shipped. `storageSecretClear`
  // existed, the Edge `clear` branch existed, WIL-3006 existed — and nothing
  // called any of it, so a tenant's bucket credential could be stored and
  // never removed except by a service-role query. Enumerate the exports and
  // grep each for callers; this one had none.
  async function clearSecret() {
    if (clearingSecret || !secretHint) return
    setClearingSecret(true)
    setS3Refusal(null)
    setNotice(null)
    const res = await storageSecretClear()
    if (!mountedRef.current) return
    setClearingSecret(false)
    if (res.ok) {
      setSecretHint(null)
      setSecretDraft('')
      setTestResult(null)
      setNotice('Secret removed. Uploads and downloads for this bucket stop working until a new one is saved.')
    } else {
      setS3Refusal(res.data?.detail || res.data?.error || 'the secret could not be removed')
    }
  }

  async function testConnection() {
    if (testing) return
    setTesting(true)
    setS3Refusal(null)
    setTestResult(null)
    setNotice(null)
    // Server half: a real PUT→GET→DELETE from the Edge Function — proves
    // endpoint, addressing style, credentials and bucket, with the failing
    // stage named.
    const res = await storageProbe()
    if (!mountedRef.current) return
    if (!res.ok || !res.data?.clientProbe) {
      setTesting(false)
      setS3Refusal(res.data?.detail || res.data?.error || `the probe failed (${res.status})`)
      return
    }
    // Client half: the same round trip from THIS app — the only place CORS
    // can be tested, because CORS only exists in the caller's context.
    const client = await runS3ClientProbe(res.data.clientProbe)
    if (!mountedRef.current) return
    setTesting(false)
    if (client.ok) {
      setTestResult(`Bucket reachable · server ✓ · this app ✓ · ${client.roundTripMs} ms`)
    } else {
      setS3Refusal(client.detail)
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
      <p className="text-xs leading-relaxed mb-4" style={{ color: LIGHT_INK }}>
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
        <h3 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: LIGHT_INK }}>
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
                <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: active ? '#ea580c' : LIGHT_INK }} />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#1c1917' }}>
                    {m.label}
                  </span>
                  <span className="text-[11px] leading-relaxed" style={{ color: LIGHT_INK }}>
                    {m.blurb}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Petal-cloud plan (central only, S41) ─────────────────────────
          The company-facing half of the plan: what the allowance is, how much
          of it is gone, and — when the plan is not active — what to do about
          it. Audrey, 2026-08-07: Petal cloud is "visible but inert" for a
          company that has not paid, so every word here is an INVITATION, never
          an error. Nothing on this card writes; the operator's half lives in
          the operator terminal.

          🚨 SUPPRESSED UNDER loadError. `mode` falls back to 'central' when
          the row could not be read (row === null), so without this arm a
          company on its own NAS would be shown a Petal-cloud plan and a Petal
          usage figure that says nothing about its storage. An unreadable row
          means the mode is UNKNOWN, and the red banner above already says so. */}
      {mode === 'central' && !loadError && (
        <div className="p-4 rounded-sm mb-3" style={cardStyle}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: LIGHT_INK }}>
            Petal cloud plan
          </h3>

          {usagePhase === 'loading' && (
            <p className="text-[11px] leading-relaxed" style={{ color: LIGHT_INK }}>
              Reading how much storage this company is using&hellip;
            </p>
          )}

          {/* The failed read. It says the figure is UNKNOWN and draws no bar at
              all — an empty bar here would be a confident false statement. It
              is not styled as a refusal (red is this file's colour for "a save
              was refused" / "writes are disabled"): nothing is broken and
              nothing is blocked, the number just could not be taken. Same
              treatment as the secret-status check above, for the same reason. */}
          {usagePhase === 'error' && (
            <div>
              <p className="text-[11px] leading-relaxed mb-2" style={{ color: '#9a3412' }}>
                This company&rsquo;s storage usage could not be read just now,
                so the figure is unknown. Nothing about the plan has changed —
                try again in a moment.
              </p>
              <button type="button" onClick={loadUsage} className={darkBtnClass} style={darkBtnStyle}>
                Retry
              </button>
            </div>
          )}

          {usagePhase === 'ready' && usage && (
            <>
              <p className="text-[11px] leading-relaxed mb-2" style={{ color: LIGHT_INK }}>
                <span className="font-mono" style={{ color: '#1c1917' }}>
                  {formatBytes(usage.usedBytes)}
                </span>
                {' '}of{' '}
                <span className="font-mono" style={{ color: '#1c1917' }}>
                  {quotaKnown ? formatBytes(usage.quotaBytes) : '—'}
                </span>
                {' '}used
                {/* Counts media AND the previews generated from it (0055 sums
                    rabbit-files + rabbit-thumbnails), so saying "files" alone
                    would leave an admin unable to reconcile the number with
                    what the file manager shows. */}
                <span style={{ color: LIGHT_INK }}> — files and their previews.</span>
              </p>

              {/* The bar renders ONLY on a known quota. quotaKnown is false for
                  a zero or missing ceiling, and a bar drawn against one would
                  be either a divide-by-zero or a 0% reassurance. */}
              {quotaKnown && (
                <div
                  className="h-1.5 rounded-sm overflow-hidden mb-2"
                  style={{ backgroundColor: 'rgba(120, 70, 30, 0.3)' }}
                  role="progressbar"
                  aria-valuenow={Math.round(usagePct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full"
                    style={{
                      width: `${usagePct}%`,
                      // The file's own two tokens: the active accent normally,
                      // and the warning brown once uploads are being refused.
                      backgroundColor: (atCeiling || suspended) ? '#9a3412' : '#ea580c',
                    }}
                  />
                </div>
              )}

              {/* No plan row = the free tier (0055: ABSENCE of a row is the
                  1 GiB allowance, which is why this reads off has_plan and not
                  off a quota comparison). Deliberately plain text in the body
                  colour, not a warning: a company on the free tier has done
                  nothing wrong. */}
              {!usage.hasPlan && !suspended && (
                <p className="text-[11px] leading-relaxed" style={{ color: LIGHT_INK }}>
                  Free allowance — contact Petal to activate a larger plan.
                </p>
              )}
              {usage.hasPlan && !suspended && (
                <p className="text-[11px] leading-relaxed" style={{ color: LIGHT_INK }}>
                  Plan active — Petal manages this allowance. Contact Petal to
                  change it.
                </p>
              )}

              {/* Suspended: 0055's gate is `status = 'active' AND under quota`,
                  so a suspended plan refuses new uploads whatever the bar says.
                  Shown INSTEAD of the ceiling warning below, because they are
                  one refusal with two causes and two boxes saying "uploads are
                  refused" reads as two separate faults. */}
              {suspended && (
                <div className="flex items-start gap-1.5 p-2 rounded-sm text-[11px] leading-relaxed"
                     style={{ backgroundColor: 'rgba(234, 88, 12, 0.10)', color: '#9a3412' }}>
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    This company&rsquo;s Petal storage is not active yet, so new
                    files are not being accepted. Everything already stored still
                    opens and downloads, and invoices, other finance files and
                    the project manifest still save. Contact Petal to activate it.
                  </span>
                </div>
              )}

              {/* 🚨 WORDED TO BE TRUE, NOT TO BE ALARMING. 0055's restrictive
                  policy is FOR INSERT on `rabbit-files` ONLY, and it exempts
                  rabbit_quota_exempt_path — INVOICES/, FINANCE/ and
                  projects/<id>/PROJECT.json. So reads, downloads and deletes
                  are untouched, and the paperwork a company bills Petal with
                  keeps saving. Promising a total lockout would send an admin
                  hunting for a fault that is not there — and would be the
                  reason they never send the invoice that pays for the bigger
                  plan. */}
              {atCeiling && !suspended && (
                <div className="flex items-start gap-1.5 p-2 rounded-sm text-[11px] leading-relaxed"
                     style={{ backgroundColor: 'rgba(234, 88, 12, 0.10)', color: '#9a3412' }}>
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  {/* 🚨 "until some are removed" WAS HERE AND WAS A NO-OP, found
                      by this session's own review. A cloud delete is SOFT
                      (0014): the files row is trashed, the OBJECT stays in the
                      bucket, and storage-gc refuses to drain a trashed row for
                      30 days. The meter reads storage.objects, so an admin who
                      followed that advice would delete real work and watch the
                      number not move. Offering a remedy that cannot work is
                      worse than offering none. */}
                  <span>
                    This company has used all of its Petal storage, so new files
                    are not being accepted until the plan is raised. Everything
                    already stored still opens and downloads, and invoices, other
                    finance files and the project manifest still save. Deleting
                    files does not free space straight away — deleted files stay
                    recoverable for 30 days.
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Provider picker (byos only, S37) ─────────────────────────── */}
      {mode === 'byos' && (
        <div className="p-4 rounded-sm mb-3" style={cardStyle}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: LIGHT_INK }}>
            What you own
          </h3>
          <div className="flex flex-col gap-2">
            {BYOS_PROVIDERS.map(p => {
              const Icon = p.icon
              const active = byosProvider === p.key
              const saved = row?.provider === p.key
              return (
                <button
                  key={p.key}
                  type="button"
                  disabled={!loaded || saving || probing || testing || confirmStep !== 0 || !!loadError}
                  onClick={() => { if (byosProvider !== p.key) { resetRootFlow(); setProviderView(p.key) } }}
                  className="flex items-start gap-3 p-3 rounded-sm text-left transition-colors disabled:opacity-50"
                  style={active
                    ? { backgroundColor: 'rgba(234, 88, 12, 0.10)', border: '1px solid #ea580c' }
                    : { backgroundColor: 'transparent', border: '1px solid rgba(120, 70, 30, 0.3)' }}
                >
                  <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: active ? '#ea580c' : LIGHT_INK }} />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#1c1917' }}>
                      {p.label}{saved ? ' · saved' : ''}
                    </span>
                    <span className="text-[11px] leading-relaxed" style={{ color: LIGHT_INK }}>
                      {p.blurb}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Root (byos + server/NAS only) ────────────────────────────── */}
      {mode === 'byos' && byosProvider === WORKSPACE_PROVIDERS.NETWORK && (
        <div className="p-4 rounded-sm mb-3" style={cardStyle}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: LIGHT_INK }}>
            Storage root
          </h3>
          <p className="text-[11px] leading-relaxed mb-2" style={{ color: LIGHT_INK }}>
            The folder everything lives under, as every computer sees it —
            <span className="font-mono"> \\server\share\Projects</span>. Current:{' '}
            <span className="font-mono" style={{ color: '#1c1917' }}>
              {row?.root_path || 'not set'}
            </span>
          </p>

          {/* 🚨 THIS WARNING USED TO SAY BUCKET FILES "STAY READABLE". THAT
              WAS FALSE, and the review caught it. Each file DOES remember its
              provider (files.storage_provider), but reaching an S3 body needs
              the workspace's bucket CONFIG, and 0050's provider_config_chk
              forbids a 'network' row from carrying one — so the switch erases
              the only copy of the endpoint, bucket and prefix, and every
              pre-switch body becomes unreachable until they are retyped
              EXACTLY. A warning that promises the opposite of what happens is
              worse than no warning. */}
          {row?.provider === WORKSPACE_PROVIDERS.S3 && (
            <div className="flex items-start gap-1.5 p-2 rounded-sm text-[11px] leading-relaxed mb-2"
                 style={{ backgroundColor: 'rgba(234, 88, 12, 0.10)', color: '#9a3412' }}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                This workspace stores files in an S3 bucket
                (<span className="font-mono">{row.provider_config?.bucket}</span>)
                {s3FileCount === null
                  ? ''
                  : s3FileCount === 0
                    ? ', and nothing is in it yet'
                    : `, holding ${s3FileCount} file${s3FileCount === 1 ? '' : 's'}`}.
                Saving a server root <strong>clears that configuration</strong>,
                and anything already in the bucket stops opening until it is
                re-entered exactly — WILSON keeps no second copy of the
                endpoint, bucket or prefix. Write them down first, and move the
                files to the new location yourself: switching where WILSON
                looks does not move anything.
              </span>
            </div>
          )}

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
            <p className="text-[11px] leading-relaxed mb-2" style={{ color: LIGHT_INK }}>
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
                        style={{ color: LIGHT_INK }}>
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
                        style={{ color: LIGHT_INK }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Bucket (byos + S3 only, S37) ──────────────────────────────── */}
      {mode === 'byos' && byosProvider === WORKSPACE_PROVIDERS.S3 && (
        <div className="p-4 rounded-sm mb-3" style={cardStyle}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: LIGHT_INK }}>
            Bucket
          </h3>
          <p className="text-[11px] leading-relaxed mb-2" style={{ color: LIGHT_INK }}>
            Your S3-compatible bucket. Works from the browser and the desktop
            alike — both need the bucket&rsquo;s one-time CORS rule (the Test
            below checks it, and the setup guide has the JSON to paste).
            Current:{' '}
            <span className="font-mono" style={{ color: '#1c1917' }}>
              {row?.provider === WORKSPACE_PROVIDERS.S3 && row?.provider_config
                ? `${row.provider_config.bucket}${row.provider_config.prefix ? ` / ${row.provider_config.prefix}` : ''}`
                : 'not set'}
            </span>
          </p>

          {row?.root_path && (
            <div className="flex items-start gap-1.5 p-2 rounded-sm text-[11px] leading-relaxed mb-2"
                 style={{ backgroundColor: 'rgba(234, 88, 12, 0.10)', color: '#9a3412' }}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                This workspace currently has a server root saved
                (<span className="font-mono">{row.root_path}</span>). Saving
                the bucket clears it, and switching back means re-entering it.
              </span>
            </div>
          )}

          {/* 🚨 The connection IS the address. bucket / endpoint / prefix are
              not metadata — a saved file's key is resolved by prepending the
              CURRENT prefix to a row-shaped path, so editing any of the three
              re-points every existing file. Same semantics as changing the NAS
              root (S34), same blast radius, and previously nothing said so.
              Shown only when a real config is already saved AND the draft
              differs, so it warns about a change rather than nagging. */}
          {row?.provider === WORKSPACE_PROVIDERS.S3 && row?.provider_config && connectionEdited && (
            <div className="flex items-start gap-1.5 p-2 rounded-sm text-[11px] leading-relaxed mb-2"
                 style={{ backgroundColor: 'rgba(234, 88, 12, 0.10)', color: '#9a3412' }}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                You are changing where this workspace&rsquo;s files are
                addressed — the bucket, endpoint or prefix. Files already
                uploaded stay in the old location and WILSON will look for
                them in the new one, so they stop opening until you point it
                back. Change these only when the files have moved with them.
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2 mb-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: LIGHT_INK }}>
                Endpoint <span className="font-normal normal-case">(empty = AWS S3)</span>
              </span>
              <input type="text" value={s3Draft.endpoint}
                     onChange={e => setS3Draft(d => ({ ...d, endpoint: e.target.value }))}
                     placeholder="https://s3.us-west-004.backblazeb2.com"
                     disabled={saving || testing || !!loadError}
                     className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                     style={lightInputStyle} />
            </label>
            <div className="flex gap-2 flex-wrap">
              <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: LIGHT_INK }}>Region</span>
                <input type="text" value={s3Draft.region}
                       onChange={e => setS3Draft(d => ({ ...d, region: e.target.value }))}
                       placeholder="us-east-1 · us-west-004 · auto"
                       disabled={saving || testing || !!loadError}
                       className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                       style={lightInputStyle} />
              </label>
              <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: LIGHT_INK }}>Bucket</span>
                <input type="text" value={s3Draft.bucket}
                       onChange={e => setS3Draft(d => ({ ...d, bucket: e.target.value }))}
                       placeholder="studio-media"
                       disabled={saving || testing || !!loadError}
                       className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                       style={lightInputStyle} />
              </label>
              <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: LIGHT_INK }}>
                  Prefix <span className="font-normal normal-case">(optional folder inside the bucket)</span>
                </span>
                <input type="text" value={s3Draft.prefix}
                       onChange={e => setS3Draft(d => ({ ...d, prefix: e.target.value }))}
                       placeholder="wilson"
                       disabled={saving || testing || !!loadError}
                       className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                       style={lightInputStyle} />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: LIGHT_INK }}>Access key ID</span>
              <input type="text" value={s3Draft.accessKeyId}
                     onChange={e => setS3Draft(d => ({ ...d, accessKeyId: e.target.value }))}
                     placeholder="AKIA…"
                     disabled={saving || testing || !!loadError}
                     className="px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                     style={lightInputStyle} />
            </label>
            <label className="flex items-center gap-2 text-[11px]" style={{ color: LIGHT_INK }}>
              <input type="checkbox" checked={s3Draft.forcePathStyle}
                     onChange={e => setS3Draft(d => ({ ...d, forcePathStyle: e.target.checked }))}
                     disabled={saving || testing || !!loadError} />
              <span>
                Path-style addressing — needed by MinIO and some self-hosted
                gateways. If the Test says the endpoint is unreachable, try
                flipping this: the wrong style presents as a DNS failure.
              </span>
            </label>
            <div>
              <button type="button" onClick={saveBucket}
                      disabled={saving || testing || !loaded || !!loadError}
                      className={darkBtnClass} style={darkBtnStyle}>
                {saving ? 'Saving…' : 'Save bucket'}
              </button>
            </div>
          </div>

          <div className="pt-2 mb-2" style={{ borderTop: '1px solid rgba(120, 70, 30, 0.3)' }}>
            <p className="text-[11px] leading-relaxed mb-1" style={{ color: LIGHT_INK }}>
              Access key secret — stored encrypted; WILSON only ever shows its
              last characters.{' '}
              {/* Three states, never two: a failed check must not assert
                  "not stored" over a secret that is stored (S37 review). */}
              {secretStatusError
                ? <span style={{ color: '#9a3412' }}>Could not check whether a secret is stored — reopen this section to retry.</span>
                : secretHint
                  ? <span className="font-mono" style={{ color: '#1c1917' }}>Stored · ends …{secretHint}</span>
                  : <span style={{ color: '#9a3412' }}>Not stored yet.</span>}
            </p>
            {cryptoMissing && (
              <p className="text-[11px] leading-relaxed mb-1" style={{ color: '#991b1b' }}>
                This environment has no storage encryption key configured, so a
                secret cannot be saved here yet. It is set once per environment
                by an operator.
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <input type="password" value={secretDraft}
                     onChange={e => setSecretDraft(e.target.value)}
                     placeholder={secretHint ? 'enter a new secret to replace it' : 'the secret half of the key pair'}
                     autoComplete="off"
                     disabled={savingSecret || clearingSecret || testing || !!loadError}
                     className="flex-1 min-w-[260px] px-2 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                     style={lightInputStyle} />
              <button type="button" onClick={saveSecret}
                      disabled={savingSecret || clearingSecret || testing || !secretDraft.trim() || !!loadError}
                      className={darkBtnClass} style={darkBtnStyle}>
                {savingSecret ? 'Saving…' : 'Save secret'}
              </button>
              {secretHint && (
                <button type="button" onClick={clearSecret}
                        disabled={savingSecret || clearingSecret || testing || !!loadError}
                        className={darkBtnClass} style={darkBtnStyle}>
                  {clearingSecret ? 'Removing…' : 'Remove secret'}
                </button>
              )}
            </div>
          </div>

          <div className="pt-2" style={{ borderTop: '1px solid rgba(120, 70, 30, 0.3)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={testConnection}
                      disabled={testing || saving || !loaded || !!loadError || row?.provider !== WORKSPACE_PROVIDERS.S3}
                      className={darkBtnClass} style={darkBtnStyle}>
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              <span className="text-[11px]" style={{ color: LIGHT_INK }}>
                A real round trip: the server writes, reads and deletes a probe
                object, then this app repeats it — the second half is what
                catches a missing CORS rule.
              </span>
            </div>
            {testResult && !s3Refusal && (
              <div className="flex items-center gap-1.5 text-[11px] font-mono mt-2" style={{ color: '#166534' }}>
                <CheckCircle2 className="w-3.5 h-3.5" /> {testResult}
              </div>
            )}
          </div>

          {s3Refusal && (
            <div className="flex items-start gap-1.5 p-2 rounded-sm text-[11px] leading-relaxed mt-2"
                 style={{ backgroundColor: 'rgba(220,38,38,0.10)', color: '#991b1b' }}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{s3Refusal}</span>
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
