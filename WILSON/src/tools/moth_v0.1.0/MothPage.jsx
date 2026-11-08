// MothPage.jsx — M.O.T.H.'s page. A lazy chunk: App.jsx reaches it only through lazy(import()), and nothing outside
// this folder imports from it (MothPage.test.jsx scans that).
//
// Session 1 (MOTH_DESIGN §1.10) gave it its reads and its doing: the islands, a project's files, Move to, Delete
// with Undo, the trash, the personal space. Session 2 (PLAN_MOTH §5 Session 2) puts them in a world: the graph of
// everything the person can see, the light at its centre, and a heads-up display around it (the view widget top
// left, the list right, the folder cards bottom left, Help and Settings at the toolbar's right end).
//
// It reads only through the adapter's Moth methods, which have already removed money and Legal on the server, and
// each file row passes mothFileHidden as a second look (state/mothCatalogue.js). So the graph, the list, the
// search, a selection and the trash cannot show them. Every control is gated by the same question as the server's,
// and the server asks again.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { HelpCircle, Settings as SettingsIcon, Tags as TagsIcon } from 'lucide-react'
import { Banner, Button, Dialog, Drawer, IconButton } from '../../ui'
import { usePermissions } from '../../permissions/usePermissions'
import { canOnProject, projectActionDeniedReason } from '../../permissions/projectRoleMatrix'
import { useRabbit } from '../rabbit_v0.1.0/state/RabbitProvider'
import { desktopFileOps } from '../rabbit_v0.1.0/storage/desktopFileOps.js'
import { createNetworkShareCatalogue } from '../rabbit_v0.1.0/state/networkShareCatalogue.js'
import { classifyUpload } from '../rabbit_v0.1.0/storage/uploadNotices.js'
import NetworkShareBanner from '../../components/Resources/NetworkShareBanner'
import { visibleDialogCount } from '../rabbit_v0.1.0/views/bins/binUi'
import { fetchWorkspaceStorage, fetchStorageUsage } from '../../cloud/workspaceStorage'
import { buildGraph, indexCatalogue, nodeId, catalogueSize } from './engine/model.js'
import { fixtureForTarget, generateCatalogue } from './engine/fixtures.js'
import { createFrameRecorder, TARGETS } from './engine/benchmark.js'
import { createMothHistory } from './state/mothHistory.js'
import { createMothFileOps } from './state/mothFileOps.js'
import { createMothCatalogue } from './state/mothCatalogue.js'
import { createInputMode, prefersReducedMotion } from './state/mothInputMode.js'
import { QUICK_VIEWS, normalizeConfig, engineView, filterByTags, containersOf } from './state/mothViewState.js'
import { createMothViews } from './state/mothViews.js'
import { colourFor, radiusFor, normalizeAppearance } from './state/mothAppearance.js'
import { rewind, recordedSince, s3Floors, s3RecordedSince, readHistory, RECENT_DAYS } from './state/mothHistoryScrub.js'
import { mothJump, JUMP_WORDS } from './state/mothJumps.js'
import MothWorldView from './components/MothWorldView.jsx'
import MothViewWidget from './components/MothViewWidget.jsx'
import MothListWidget from './components/MothListWidget.jsx'
import MothCards from './components/MothCards.jsx'
import { islandLabel } from './components/MothIslands.jsx'
import MothSettings, { MothHelp } from './components/MothSettings.jsx'
import MothFirstVisit from './components/MothFirstVisit.jsx'
import MothBloom from './components/MothBloom.jsx'
import MothMoveTo from './components/MothMoveTo.jsx'
import MothTrashView from './components/MothTrashView.jsx'
import MothTagPanel from './components/MothTagPanel.jsx'
import './moth.css'

// An asset's own file on this computer: its asset deletes it, and Moth's batches do not take it.
export const MANAGED_ROW_SENTENCE = 'This file belongs to an asset. Change it from the asset.'
// MO3 (0127): a link joins these kinds, from a thing the person may change to one they see.
const LINK_KINDS = new Set(['project', 'folder', 'file', 'phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience', 'note'])
const LINKS_ABSENT = 'Links are not on this database yet. Nothing was linked, and the dot is back where it was.'
function linkWords(err) {
  if (err?.code === '23505') return 'They are linked already.'
  if (err?.code === 'moth_absent') return LINKS_ABSENT
  if (err?.code === '42501') return 'You may not change where this link starts, so nothing was linked.'
  if (err?.code === '23503') return 'That is not something you can link to.'
  return err?.message || 'The link could not be saved.'
}
const SAVE_PLACES_MS = 1500

// A key pressed in a box that has its own undo. A ticked row's checkbox has none.
const typingIn = (target) => {
  if (target?.isContentEditable) return true
  if (/^(TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return true
  return target?.tagName === 'INPUT' && !/^(checkbox|radio|button)$/.test(target.type ?? '')
}
const kindOf = (id) => String(id).slice(0, String(id).indexOf(':'))
const rowOf = (id) => String(id).slice(String(id).indexOf(':') + 1)

export default function MothPage({ isActive = true, worldFactory }) {
  const rabbit = useRabbit()
  const perms = usePermissions()
  const adapter = rabbit?.getAdapter?.() ?? null
  const localOnly = rabbit?.adapterMode === 'local_server'
  const onDesktop = desktopFileOps.available()

  const [islandsAsked, setIslandsAsked] = useState(0)
  const [picked, setPicked] = useState(() => new Set())
  const [selected, setSelected] = useState([])
  const [inside, setInsideState] = useState(null)
  const [listSearch, setListSearch] = useState('')
  const [moving, setMoving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [storage, setStorage] = useState(null)
  const [changeKey, setChangeKey] = useState(0)
  const [unfinishedMoves, setUnfinishedMoves] = useState(0)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  // MO3: a live admin decides what is put forward and links from any shared note; the server asks the
  // membership row, this only offers the controls.
  const isAdminHere = perms?.role === 'admin'
  const [bloom, setBloom] = useState(null)
  const [drag, setDrag] = useState(null)
  const [flyTo, setFlyTo] = useState(null)
  const [jump, setJump] = useState(null)
  const [inputMode, setInputMode] = useState('mouse')
  const [calm, setCalm] = useState(() => prefersReducedMotion())
  const [frameLine, setFrameLine] = useState('')
  const [openFolder, setOpenFolder] = useState(null)
  const [scrubAt, setScrubAt] = useState(null)
  const [scrubDraft, setScrubDraft] = useState(undefined)
  const draftTimer = useRef(null)
  const [scrub, setScrub] = useState({ available: null, floor: null, rows: null, since: null, loading: false, error: '', incomplete: false })
  const worldRef = useRef(null)

  // One stack per account, workspace and adapter, and it survives everything else.
  const scope = `${perms?.userId ?? ''}|${perms?.workspaceId ?? ''}|${rabbit?.adapterMode ?? ''}`
  const historyRef = useRef(null)
  const scopeRef = useRef(null)
  if (!historyRef.current) historyRef.current = createMothHistory()
  if (scopeRef.current !== scope) {
    if (scopeRef.current !== null) historyRef.current.clear()
    scopeRef.current = scope
  }
  const history = historyRef.current
  const canUndo = useSyncExternalStore(history.subscribe, history.canUndo)
  const canRedo = useSyncExternalStore(history.subscribe, history.canRedo)

  // ── What there is: one read of everything the person can see ─────────────────────────────────────────────────
  const store = useMemo(() => (adapter ? createMothCatalogue({ adapter }) : null), [adapter])
  const noStore = useCallback(() => () => {}, [])
  const emptySnap = useMemo(() => ({ version: 0, islands: null, islandsFailed: false, complete: false, ready: 0, failed: 0, total: 0, project: () => null }), [])
  const snap = useSyncExternalStore(store ? store.subscribe : noStore, store ? store.getSnapshot : () => emptySnap)
  const islands = snap.islands

  const netCatalogue = useMemo(() => (adapter ? createNetworkShareCatalogue({ adapter }) : null), [adapter])
  // Read when it is called: a history step outlives the project open in R.A.B.B.I.T. when it was made.
  const notifyRef = useRef(null)
  notifyRef.current = rabbit?.noteFilesChangedElsewhere
  const notify = useCallback((projects) => notifyRef.current?.(projects), [])
  const fileOps = useMemo(() => (adapter && netCatalogue ? createMothFileOps({
    adapter,
    catalogue: netCatalogue,
    ops: desktopFileOps,
    history,
    onChanged: (projects) => {
      setChangeKey((k) => k + 1)
      notify?.(projects)
      store?.refresh(projects || [])
    },
    onNote: setNote,
  }) : null), [adapter, netCatalogue, history, notify, store])

  // First entry: this person's space exists from here on (Session 1's acceptance 1: exactly one, the same on a
  // second entry), and a database or a build without it still shows the projects. Coming back reads again, so a
  // project made elsewhere appears and a changed seat counts; a space that could not be made is asked for again.
  const spaceAsked = useRef(false)
  useEffect(() => { spaceAsked.current = false }, [adapter, scope])
  useEffect(() => {
    if (!adapter || !store || !isActive) return undefined
    let live = true
    ;(async () => {
      if (!spaceAsked.current) {
        await Promise.resolve().then(() => adapter.ensurePersonalSpace?.()).then(() => { spaceAsked.current = true }).catch(() => {})
      }
      if (live) await store.loadAll()
    })().catch(() => {})
    return () => { live = false }
  }, [adapter, store, isActive, islandsAsked])

  useEffect(() => {
    if (localOnly) return undefined
    let live = true
    Promise.resolve().then(() => fetchWorkspaceStorage())
      .then((row) => { if (live) setStorage(row) })
      .catch(() => {})
    return () => { live = false }
  }, [localOnly])
  const onNetworkStorage = storage?.mode === 'byos' && storage?.provider === 'network'
  const officeRoot = onNetworkStorage && storage?.root_kind === 'unc' ? storage.root_path : null

  // What was left unfinished: an office-server operation, or a move on this computer.
  useEffect(() => {
    if (!isActive || !adapter) return undefined
    let live = true
    if (typeof adapter.networkSharePending === 'function' && desktopFileOps.available()) {
      Promise.resolve().then(() => netCatalogue.settlePending())
        .then((out) => { if (live && (out?.done?.length || out?.notMoved?.length)) setChangeKey((k) => k + 1) })
        .catch(() => {})
    }
    if (typeof adapter.listPendingMoves === 'function') {
      Promise.resolve().then(() => adapter.listPendingMoves())
        .then((moves) => { if (live) setUnfinishedMoves(moves?.length ?? 0) })
        .catch(() => {})
    }
    return () => { live = false }
  }, [isActive, adapter, netCatalogue])

  const access = useCallback((row) => {
    if (!row) return { allowed: false, reason: null }
    const ctx = {
      appRole: perms?.role,
      projectRole: row.my_project_role,
      isStaffed: row.is_staffed,
      ready: perms?.ready !== false,
      noRoles: localOnly,
      isPersonal: row.is_personal,
      isPersonalOwner: row.is_mine,
    }
    return { allowed: canOnProject(ctx, 'project.entity.write'), reason: projectActionDeniedReason(ctx, 'project.entity.write') }
  }, [perms?.role, perms?.ready, localOnly])
  const islandOf = useCallback((pid) => islands?.find((row) => row.id === pid) ?? null, [islands])

  // ── Views, places and this person's settings ─────────────────────────────────────────────────────────────────
  const views = useMemo(() => (adapter ? createMothViews({ adapter }) : null), [adapter])
  const viewSnap = useSyncExternalStore(views ? views.subscribe : noStore, views ? views.getSnapshot : () => null)
  useEffect(() => { if (views && isActive) views.start().catch(() => {}) }, [views, isActive])
  useEffect(() => { views?.setGate((pid) => { const row = islandOf(pid); return !!row?.can_write && access(row).allowed }) }, [views, islandOf, access])
  const current = viewSnap?.current ?? { key: 'q:folders', config: QUICK_VIEWS['q:folders'].config, row: null }
  const config = useMemo(() => normalizeConfig(current.config), [current.config])
  const appearance = useMemo(() => normalizeAppearance(viewSnap?.prefs?.appearance), [viewSnap?.prefs?.appearance])
  const firstVisit = viewSnap?.firstVisit === true
  const [newView, setNewView] = useState(false)
  const [viewUndo, setViewUndo] = useState(null)

  // ── The graph ────────────────────────────────────────────────────────────────────────────────────────────────
  // The measured replays' stress set (PLAN_MOTH §5 Session 2, "Required dataset choice": a documented expanded
  // replay of non-sensitive test data): in a development build only, ?mothReplay=N maps a generated catalogue of N
  // dots and 2N lines instead of what the person can see. Never in a production build.
  const replay = useMemo(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return null
    const m = /[?&]mothReplay=(\d+)/.exec(window.location?.search ?? '')
    if (!m) return null
    const n = Math.max(10, Math.min(20000, Number(m[1])))
    try { return fixtureForTarget({ nodes: n, edges: 2 * n }).catalogue } catch { return generateCatalogue({ projects: 2, filesPerProject: Math.round(n / 2) }) }
  }, [])
  const catalogue = useMemo(() => replay ?? (store ? store.catalogue() : { islands: [], folders: {}, files: {}, items: {}, relations: [] }),
    // The store's own version says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replay, store, snap.version])
  // Looking back: the record from the slider's time to now, read once per time, the live catalogue rewound.
  const scrubbed = useMemo(() => (scrubAt != null && scrub.rows ? rewind(catalogue, scrub.rows, scrubAt, { s3Floors: scrub.s3Floors }) : null), [scrubAt, scrub.rows, scrub.s3Floors, catalogue])
  const base = scrubbed ? scrubbed.catalogue : catalogue
  // The person's own space is "My personal space" on the graph and in a search, as it is in the list.
  const shown = useMemo(() => {
    const c = filterByTags(base, config.tags)
    return { ...c, islands: (c.islands || []).map((r) => (r?.is_mine ? { ...r, title: islandLabel(r) } : r)) }
  }, [base, config.tags])
  const index = useMemo(() => indexCatalogue(shown), [shown])
  // The live catalogue's own index (no tag filter, never looked back, never a replay): what a view may keep a
  // place for. A made-up replay keeps none.
  const liveIndex = useMemo(() => (replay ? null : indexCatalogue(catalogue)), [replay, catalogue])
  const open = viewSnap?.open ?? null
  const openSet = useMemo(() => {
    if (open) return open
    // No saved places yet: every project open, every folder closed (one dot with its count).
    return new Set((catalogue.islands || []).map((row) => nodeId('project', row.id)))
  }, [open, catalogue.islands])
  const focusId = viewSnap?.focusId ?? null
  const openSetRef = useRef(openSet)
  openSetRef.current = openSet
  useEffect(() => {
    views?.setLookup({ projectOf: (id) => liveIndex?.rows.get(id)?.projectId ?? null, openNow: () => openSetRef.current })
  }, [views, liveIndex])
  const graph = useMemo(() => buildGraph(shown, engineView(config, { open: openSet, focusId }), index), [shown, config, openSet, focusId, index])
  const glowSize = useMemo(() => (replay ? catalogueSize(replay) : store ? store.glowSize() : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replay, store, snap.version])
  const colourOf = useMemo(() => {
    const by = colourFor(appearance.colour_by, { editorOf: (n) => store?.editorOf(n.projectId, n.rowId) ?? null })
    // Looking back, what changed in the week before glows softly, whatever colours the rest.
    if (!scrubbed) return by
    return (n) => (scrubbed.changed.has(n.rowId) ? '#fff4c2' : by ? by(n) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearance.colour_by, store, snap.version, scrubbed])
  const radiusOf = useMemo(() => radiusFor(appearance.size_by), [appearance.size_by])
  const worldAppearance = useMemo(() => ({ glowColor: appearance.glow, glowSize, colourOf, light: appearance.light, radiusOf }),
    [appearance.glow, glowSize, colourOf, appearance.light, radiusOf])

  // The list's own rows: a file by its id, to act on.
  const fileRow = useCallback((fid) => {
    for (const rows of Object.values(catalogue.files || {})) {
      const f = rows.find((r) => r.id === fid)
      if (f) return f
    }
    return null
  }, [catalogue.files])
  const pickedFiles = useMemo(() => [...picked].map(fileRow).filter(Boolean), [picked, fileRow])
  // A ticked file the list does not show now (another container, or the search): said, in the list and in Delete's
  // question, as Session 1's list said it.
  const shownInList = useMemo(() => {
    const words = listSearch.trim().toLowerCase()
    const out = new Set()
    if (!inside) return out
    for (const [id, p] of index.parent) {
      if (p !== inside || kindOf(id) !== 'file') continue
      if (!words || String(index.rows.get(id)?.label ?? '').toLowerCase().includes(words)) out.add(rowOf(id))
    }
    return out
  }, [index, inside, listSearch])
  const pickedHidden = pickedFiles.filter((f) => !shownInList.has(f.id)).length
  const pickedProject = pickedFiles.length ? pickedFiles[0].project_id : null
  const samePickedProject = pickedFiles.every((f) => f.project_id === pickedProject)
  const insideProject = inside ? index.rows.get(inside)?.projectId ?? null : null
  const liveGate = access(islandOf(pickedProject ?? insideProject))
  const listGate = scrubAt != null ? { allowed: false, reason: 'Looking back changes nothing. Come back to now to change things.' }
    : access(islandOf(insideProject))
  const gate = scrubAt != null ? { allowed: false, reason: 'Looking back changes nothing. Come back to now to change things.' }
    : !samePickedProject ? { allowed: false, reason: 'The ticked files are in different projects. Tick the files of one project at a time to move or delete them.' }
    : liveGate

  // ── Selecting, opening, flying ───────────────────────────────────────────────────────────────────────────────
  // Going into another project says nothing of what happened in the last one, and starts its search afresh.
  const setInside = useCallback((id) => {
    setInsideState((was) => {
      const project = (x) => (x ? index.rows.get(x)?.projectId ?? null : null)
      if (project(was) !== project(id)) { setError(''); setListSearch('') }
      return id
    })
  }, [index])
  const select = useCallback((id, { additive = false, fly = false } = {}) => {
    if (id == null) { if (!additive) { setSelected([]); setPicked(new Set()) } return }
    const kind = kindOf(id)
    setSelected((was) => (additive ? (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]) : [id]))
    if (!additive) {
      // The list follows: inside a container selected, or inside the container of anything else.
      const container = ['project', 'folder', 'phase', 'scene'].includes(kind) ? id : index.parent.get(id) ?? null
      if (container) setInside(container)
    }
    if (kind === 'file' && !fileRow(rowOf(id))?.managed) {
      const fid = rowOf(id)
      setPicked((was) => {
        const next = new Set(additive ? was : [])
        if (additive && was.has(fid)) next.delete(fid); else next.add(fid)
        return next
      })
    } else if (!additive) setPicked(new Set())
    if (fly) {
      // Every container on the way is opened, so the dot is drawn, then the camera goes to it.
      const ways = containersOf(shown, id, index)
      if (ways.length && views) views.openAll(ways, openSetRef.current)
      setFlyTo({ id, at: Date.now() })
    }
  }, [shown, index, views, fileRow])
  const openContainer = useCallback((id) => { views?.toggleOpen(id, openSetRef.current) }, [views])

  // ── Doing things (Session 1's, kept whole) ───────────────────────────────────────────────────────────────────
  const act = useCallback(async (fn) => {
    setError('')
    setNote('')
    try {
      await fn()
    } catch (err) {
      setError(err?.message || String(err))
    }
  }, [])

  // A toast's Undo is for its own step, and asks nothing once something else has been done since. One that fails
  // says so to the toast as well, which stays up with Undo to try again: this page may not be the one on screen.
  const toastUndo = () => {
    const own = history.top()
    return async () => {
      setError('')
      setNote('')
      try {
        await history.undoStep(own)
      } catch (err) {
        setError(err?.message || String(err))
        throw err
      }
    }
  }

  const remove = async () => {
    if (deleting) return
    setDeleting(true)
    const list = pickedFiles
    await act(async () => {
      await fileOps.trashFiles(list, pickedProject)
      setPicked(new Set())
      setSelected([])
      rabbit?.showUndoToast?.(list.length === 1 ? `Deleted "${list[0].name}"` : `Deleted ${list.length} files`, toastUndo())
    })
    setDeleting(false)
    setConfirming(false)
  }

  const move = async (list, from, dest, folder) => {
    setNote('')
    const moved = await fileOps.moveFiles(list, from, dest, folder)
    setPicked(new Set())
    // Nothing moved, so no step was pushed, and a toast's Undo would undo something else.
    if (moved?.moved === 0) {
      setNote('These files are already there, so nothing moved.')
      return
    }
    rabbit?.showUndoToast?.(list.length === 1 ? `Moved "${list[0].name}"` : `Moved ${list.length} files`, toastUndo())
  }

  // The copy goes first and the record after, because the record names what arrived. One the server then refuses
  // comes back out through the bin, or it would sit on the server with no row, and a retry would make a second.
  const addOneToServer = async (island, file, folder, accessToken) => {
    const put = await desktopFileOps.addToPersonalSpace({ root: officeRoot, folder, file, accessToken })
    try {
      await adapter.networkShareRecordAdded({
        projectId: island.id,
        root: officeRoot,
        entries: [{ n: put.name, s: String(put.sizeBytes), m: put.modifiedAt, t: file.type || undefined }],
      })
    } catch (err) {
      // No answer is no refusal: the record may be on the server, and this copy is what it names.
      if (!err?.code) throw new Error(`WILSON could not tell whether "${put.name}" was added. Look in the list before adding it again.`)
      const bin = `${folder}/.wilson-bin/${crypto.randomUUID()}`
      await desktopFileOps.rename([{ from: put.locator, to: `${bin}/${put.name}` }])
        .then(() => desktopFileOps.purgeBin([bin]))
        .catch(() => {})
      throw err
    }
  }

  // Weighed as Files weighs one, for what is plainly too big. What this cannot see the server still refuses.
  const refusedHere = async (list) => {
    if (localOnly || onNetworkStorage || storage?.mode === 'byos') return null
    const storagePlan = await fetchStorageUsage().catch(() => null)
    for (const file of list) {
      const verdict = classifyUpload(file, { storagePlan })
      if (verdict.blocked) return verdict.message
    }
    return null
  }

  // One at a time. One that fails stops the rest, and what went before it is on the list and is said, or a
  // person picks all of them again and has two of each.
  const addFiles = async (island, list) => {
    const refused = await refusedHere(list)
    if (refused) throw new Error(refused)
    let added = 0
    try {
      if (officeRoot) {
        const accessToken = await adapter.getAccessToken()
        const folder = `_WILSON_PERSONAL/${perms.userId}`
        for (const file of list) {
          await addOneToServer(island, file, folder, accessToken)
          added += 1
        }
      } else {
        for (const file of list) {
          await adapter.uploadFile(island.id, {}, file, {})
          added += 1
        }
      }
    } catch (err) {
      throw added > 0 ? new Error(`Added ${added} of ${list.length}. ${err?.message || String(err)}`) : err
    } finally {
      setChangeKey((k) => k + 1)
      notify([island.id])
      store?.refresh([island.id])
    }
  }

  // MO3 (0127): whether the person may change a thing, as the server's moth_can_write_target asks it: their own
  // note, or any shared note for a live admin; else its project's, where they may write. Where a link starts and the
  // typed-tag drawer's take-off cross on a company tag both ask this one question.
  const mayChange = useCallback((node) => {
    if (!node) return { allowed: false, reason: null }
    if (node.kind === 'note') {
      const row = index.rows.get(node.id)
      const may = (row?.mine && row?.tier !== 'company_standard') || (isAdminHere && row?.tier !== 'personal')
      return may ? { allowed: true } : { allowed: false, reason: 'Only its owner and the company’s admins link from this note.' }
    }
    const src = access(islandOf(node.projectId))
    if (!src.allowed || !islandOf(node.projectId)?.can_write) return { allowed: false, reason: src.reason || 'You may not change where this link starts.' }
    return { allowed: true }
  }, [index, isAdminHere, access, islandOf])

  // ── The world's gestures ─────────────────────────────────────────────────────────────────────────────────────
  // A file moves into a folder or a project the person may write to, from a project they may write to. A link is
  // shown as one would be, and is saved from the next update (Session 3 stores relationships).
  const rules = useMemo(() => ({
    canDrag: () => scrubAt == null && !(current.row && !views?.writable()),
    canMove: (from, to) => {
      if (from.kind !== 'file' || !['folder', 'project'].includes(to.kind)) return { allowed: false }
      const src = access(islandOf(from.projectId))
      if (!src.allowed) return { allowed: false, reason: src.reason }
      const dst = access(islandOf(to.projectId))
      if (!dst.allowed || !islandOf(to.projectId)?.can_write) return { allowed: false, reason: dst.reason }
      const row = fileRow(from.rowId)
      if (row?.managed) return { allowed: false, reason: MANAGED_ROW_SENTENCE }
      const into = to.kind === 'folder' ? to.rowId : null
      if (row && row.project_id === to.projectId && (row.folder_id ?? null) === into) return { allowed: false, reason: 'It is already there.' }
      return { allowed: true }
    },
    // MO3 (0127): from a thing the person may change (its project's, or their own note, or any shared note for a
    // live admin) to a thing on show, of the kinds a link joins. The server asks the same, and says no in words.
    canLink: (from, to) => {
      if (from.id === to.id || !LINK_KINDS.has(from.kind) || !LINK_KINDS.has(to.kind)) return { allowed: false }
      return mayChange(from)
    },
  }), [access, islandOf, fileRow, scrubAt, current.row, views, mayChange])

  const onDrop = useCallback(({ dragId, targetId, mode }) => {
    if (mode === 'link') {
      const from = index.rows.get(dragId)
      const to = index.rows.get(targetId)
      if (!from || !to) return
      ;(async () => {
        try {
          if (typeof adapter?.createMothRelationship !== 'function') throw Object.assign(new Error(LINKS_ABSENT), { code: 'moth_absent' })
          await adapter.createMothRelationship({ sourceKind: from.kind, sourceId: from.rowId, targetKind: to.kind, targetId: to.rowId })
          setNote(`Linked “${from.label || 'it'}” to “${to.label || 'it'}”.`)
          await store?.readWorkspace?.()
        } catch (err) {
          setNote(linkWords(err))
        }
      })()
      return
    }
    const row = fileRow(rowOf(dragId))
    const to = index.rows.get(targetId)
    if (!row || !to) return
    act(() => move([row], row.project_id, to.projectId, to.kind === 'folder' ? to.rowId : null))
    // The move function is Session 1's; its dependencies change with every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileRow, index, act, adapter, store])

  const dropFile = useCallback((fid, targetId) => {
    const row = fileRow(fid)
    const to = index.rows.get(targetId)
    if (!row || !to || scrubAt != null) return
    const verdict = rules.canMove({ kind: 'file', rowId: fid, projectId: row.project_id }, to)
    if (!verdict.allowed) { setNote(verdict.reason || 'It cannot move there.'); return }
    act(() => move([row], row.project_id, to.projectId, to.kind === 'folder' ? to.rowId : null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileRow, index, rules, act, scrubAt])

  // Where the dots are goes with the view (MO2 review round 1): a dot moved by hand, a folder opened or closed, the
  // focus moved, each noted under the view it happened in and written a moment later to that view, only what
  // changed, by the person who may write it; never while looking back. Leaving the page writes what is waiting.
  const saveTimer = useRef(null)
  const flushPlaces = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    views?.flush().catch((err) => setError(err?.message || String(err)))
  }, [views])
  const queueFlush = useCallback(() => {
    if (!views) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushPlaces, SAVE_PLACES_MS)
  }, [views, flushPlaces])
  const onArranged = useCallback(({ id, x, y }) => {
    if (!views || scrubAt != null) return
    views.notePlace(id, { x, y, pinned: true })
    queueFlush()
  }, [views, scrubAt, queueFlush])
  const onSettled = useCallback((how) => {
    if (!views || scrubAt != null || !viewSnap?.needsPlaces || how?.failed) return
    const w = worldRef.current
    if (w) views.savePlaces(w.positions()).catch((err) => setError(err?.message || String(err)))
  }, [views, scrubAt, viewSnap?.needsPlaces])
  const marksSeen = useRef({ key: null, open: null, focusId: null })
  useEffect(() => {
    const was = marksSeen.current
    const now = { key: viewSnap?.placesKey ?? null, open: openSet, focusId }
    marksSeen.current = now
    // A view's own load is not a change.
    if (!views || scrubAt != null || was.key !== now.key || !was.open) return
    const changed = new Set()
    for (const id of now.open) if (!was.open.has(id)) changed.add(id)
    for (const id of was.open) if (!now.open.has(id)) changed.add(id)
    if (was.focusId !== now.focusId) { if (was.focusId) changed.add(was.focusId); if (now.focusId) changed.add(now.focusId) }
    if (!changed.size) return
    const all = worldRef.current?.positions() ?? {}
    const places = {}
    for (const id of changed) if (all[id]) places[id] = all[id]
    views.noteMarks(places)
    queueFlush()
  }, [views, openSet, focusId, viewSnap?.placesKey, scrubAt, queueFlush])
  useEffect(() => { if (!isActive) flushPlaces() }, [isActive, flushPlaces])
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const away = () => { if (typeof document === 'undefined' || document.visibilityState === 'hidden') flushPlaces() }
    window.addEventListener('pagehide', flushPlaces)
    document.addEventListener?.('visibilitychange', away)
    return () => { window.removeEventListener('pagehide', flushPlaces); document.removeEventListener?.('visibilitychange', away) }
  }, [flushPlaces])
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); views?.flush().catch(() => {}) }, [views])

  const inputModeRef = useRef(inputMode)
  inputModeRef.current = inputMode
  // ── Settings, the input mode, the frame readout ──────────────────────────────────────────────────────────────
  const setAppearance = useCallback((patch) => { views?.setAppearance(patch) }, [views])
  useEffect(() => {
    if (!isActive) return undefined
    const mode = createInputMode({ onChange: setInputMode, initial: inputModeRef.current })
    mode.attach(typeof window !== 'undefined' ? window : null)
    let mq = null
    const onMotion = () => setCalm(prefersReducedMotion())
    try {
      mq = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
      mq?.addEventListener?.('change', onMotion)
    } catch { mq = null }
    return () => { mode.detach(); mq?.removeEventListener?.('change', onMotion) }
  }, [isActive])
  // The frame readout, for the measured replays (her Q6): in a development build, only when asked for in the address.
  const recorder = useMemo(() => {
    const asked = import.meta.env.DEV && typeof window !== 'undefined' && /[?&]mothFrames=1\b/.test(window.location?.search ?? '')
    return asked ? createFrameRecorder() : null
  }, [])
  const onFrame = useCallback((f) => {
    if (!recorder) return
    recorder.onFrame(f)
    // The recorder answers its own summaries: a frame as seen (the longest of drawing, lateness and the gap in motion) and the drawing alone.
    const gap = recorder.sample()
    const draw = recorder.work()
    const ms = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-')
    if (draw.count > 0 && draw.count % 30 === 0) setFrameLine(`${f.dots} dots${f.clusters ? `, ${f.clusters} clusters` : ''}, ${f.edges} lines${f.light ? ', lighter' : ''} · ${draw.count} frames · frame time p50 ${ms(gap.p50)} p95 ${ms(gap.p95)} max ${ms(gap.max)} ms · drawing p95 ${ms(draw.p95)} ms (target ${TARGETS.normal.p95Ms} ms)`)
  }, [recorder])

  const scrubbing = useRef(false)
  scrubbing.current = scrubAt != null
  // ── The keyboard ─────────────────────────────────────────────────────────────────────────────────────────────
  // Ctrl+Z and Ctrl+Y, only while on this page. Taken before any other listener: every page stays mounted, and a
  // hidden page's own undo on the document must not also run. A box with its own undo keeps it; nothing happens
  // behind a dialog; and a held key is one press.
  useEffect(() => {
    if (!isActive) return undefined
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      const undoing = key === 'z' && !event.shiftKey
      const redoing = key === 'y' || (key === 'z' && event.shiftKey)
      if (!undoing && !redoing) return
      event.stopPropagation()
      if (typingIn(event.target)) return
      event.preventDefault()
      if (event.repeat || visibleDialogCount() > 0) return
      if (scrubbing.current) { setNote('Looking back changes nothing. Come back to now to undo or redo.'); return }
      act(() => (undoing ? history.undo() : history.redo()))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isActive, act, history])

  // Where the project the list is inside is on the office server, for its banner.
  useEffect(() => {
    setOpenFolder(null)
    if (!officeRoot || !insideProject || !adapter?.mothIslandFolder) return undefined
    let live = true
    Promise.resolve().then(() => adapter.mothIslandFolder(insideProject))
      .then((row) => { if (live) setOpenFolder(row) })
      .catch(() => {})
    return () => { live = false }
  }, [adapter, officeRoot, insideProject])

  // Looking back: when the record begins, read on the way in; then the rows from a week before the chosen time (so
  // what changed that week shows), kept only while the catalogue they were read against is the one on screen.
  useEffect(() => {
    if (!isActive || !adapter || localOnly || scrub.floor != null || scrub.available === false) return undefined
    let live = true
    Promise.resolve().then(() => adapter.fetchMothHistoryWindow(null))
      .then((rows) => { if (live) setScrub((s) => ({ ...s, available: true, floor: recordedSince(rows), s3Floor: s3RecordedSince(rows), s3Floors: s3Floors(rows) })) })
      .catch((err) => { if (live && err?.code === 'moth_absent') setScrub((s) => ({ ...s, available: false })) })
    return () => { live = false }
  }, [isActive, adapter, localOnly, scrub.floor, scrub.available])
  useEffect(() => {
    if (scrubAt == null || !adapter || localOnly) return undefined
    let live = true
    setScrub((s) => ({ ...s, loading: true, error: '' }))
    ;(async () => {
      let floor = scrub.floor
      let s3Floor = scrub.s3Floor
      let s3Each = scrub.s3Floors
      if (floor == null) {
        const windowRows = await adapter.fetchMothHistoryWindow(null)
        floor = recordedSince(windowRows)
        s3Floor = s3RecordedSince(windowRows)
        s3Each = s3Floors(windowRows)
      }
      const since = Math.max(scrubAt - RECENT_DAYS * 86400000, floor)
      const kept = scrub.rows && scrub.since != null && scrub.since <= since && scrub.version === snap.version
      const read = kept ? { rows: scrub.rows, complete: !scrub.incomplete } : await readHistory(adapter, since)
      if (live) setScrub({ available: true, floor, s3Floor, s3Floors: s3Each, rows: read.rows, since: kept ? scrub.since : since, version: snap.version, loading: false, error: '', incomplete: !read.complete })
    })().catch((err) => {
      if (!live) return
      if (err?.code === 'moth_absent') setScrub((s) => ({ ...s, available: false, loading: false }))
      else setScrub((s) => ({ ...s, loading: false, error: 'The record could not be read just now.' }))
    })
    return () => { live = false }
    // The kept rows and floor are read, not followed; a new catalogue reads the record again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubAt, adapter, localOnly, snap.version])
  const lookBack = useMemo(() => ({
    available: localOnly ? false : scrub.available,
    localOnly,
    floor: scrub.floor,
    s3Floor: scrub.s3Floor,
    at: scrubDraft !== undefined ? scrubDraft : scrubAt,
    setAt: (t) => {
      const v = t == null ? null : Math.max(t, scrub.floor ?? t)
      setScrubDraft(v)
      if (draftTimer.current) clearTimeout(draftTimer.current)
      draftTimer.current = setTimeout(() => { draftTimer.current = null; setScrubAt(v); setScrubDraft(undefined) }, v == null ? 0 : 250)
    },
    loading: scrub.loading,
    error: scrub.error,
    incomplete: scrub.incomplete,
  }), [localOnly, scrub, scrubAt, scrubDraft])

  // A page that has been left says nothing of what happened before it was left.
  useEffect(() => { if (isActive) setError('') }, [isActive])

  if (!adapter || !fileOps || !store) return <p className="moth-quiet moth-page">Opening M.O.T.H.…</p>

  const onServerNow = pickedFiles.some((f) => f.storage_provider === 'network_share')
  const oneFile = pickedFiles.length === 1
  const whatDeleting = oneFile ? `"${pickedFiles[0].name}"` : `${pickedFiles.length} files`
  const selectedNode = selected.length === 1 ? graph.nodes.find((n) => n.id === selected[0]) ?? index.rows.get(selected[0]) ?? null : null
  // A person's own space never becomes another tool's open project (her PS-8, PSA-08): nothing in it jumps.
  const jumpIsland = selectedNode ? islandOf(selectedNode.projectId) : null
  const jumpFor = selectedNode?.kind === 'note' ? mothJump(selectedNode)
    : jumpIsland && !jumpIsland.is_personal ? mothJump(selectedNode) : null

  return (
    <div className="moth-page" data-moth-page data-input={inputMode} data-calm={calm ? 'true' : undefined}>
      <div className="moth-strip">
        <span className="moth-strip-title">{current.row?.name ?? QUICK_VIEWS[current.key]?.name ?? 'M.O.T.H.'}</span>
        <div className="moth-strip-right">
          <IconButton size="sm" Icon={HelpCircle} title="Help & documentation" onClick={() => setShowHelpModal(true)} />
          <IconButton size="sm" Icon={TagsIcon} title="Typed tags" onClick={() => setTagsOpen(true)} />
          <IconButton size="sm" Icon={SettingsIcon} title="M.O.T.H. settings" onClick={() => setSettingsOpen(true)} />
        </div>
      </div>
      <div className="moth-stage">
        <MothWorldView
          graph={graph}
          layout={config.layout}
          saved={viewSnap?.places ?? null}
          savedKey={viewSnap?.placesKey ?? null}
          active={isActive}
          appearance={worldAppearance}
          reducedMotion={calm}
          selection={selected}
          rules={rules}
          flyTo={flyTo}
          worldRef={worldRef}
          createWorld={worldFactory}
          onPick={(id, how) => { setBloom(null); select(id, how) }}
          onOpen={openContainer}
          onBloom={setBloom}
          onDrag={setDrag}
          onDrop={onDrop}
          onArranged={onArranged}
          onSettled={onSettled}
          onFrame={recorder ? onFrame : undefined}
          onDropFile={dropFile}
        />
        <div className="moth-hud" data-moth-hud>
          <div className="moth-hud-banners">
            {snap.islandsFailed && (
              <Banner tone="danger">
                Could not read your projects just now.{' '}
                <Button variant="ghost" size="sm" onClick={() => setIslandsAsked((n) => n + 1)}>Try again</Button>
              </Banner>
            )}
            {error && <Banner tone="danger" data-moth-error>{error}</Banner>}
            {note && <Banner tone="info" data-moth-note>{note}</Banner>}
            {viewUndo && (
              <Banner tone="info" data-moth-view-undo>
                The view "{viewUndo.name}" was deleted.{' '}
                <Button variant="ghost" size="sm" onClick={() => { const u = viewUndo; setViewUndo(null); u.undo().catch((err) => setError(err?.message || String(err))) }}>Undo</Button>
              </Banner>
            )}
            {unfinishedMoves > 0 && (
              <Banner tone="info" data-moth-unfinished>
                {unfinishedMoves === 1 ? 'A move on this computer did not finish.' : `${unfinishedMoves} moves on this computer did not finish.`}
                {' '}WILSON tries again each time it starts. If a project's folder is on a drive, connect it.
              </Banner>
            )}
            {/* MO3: a failed read of the notes, typed tags or links keeps what was drawn, and says so; never an empty graph that looks true. */}
            {snap.workspaceError && (
              <p className="moth-quiet" data-moth-workspace-failed>
                Could not read every note, typed tag and link just now: what was drawn before is kept.{' '}
                <Button variant="ghost" size="sm" onClick={() => { store.readWorkspace() }}>Try again</Button>
              </p>
            )}
            {snap.workspace?.truncated && <p className="moth-quiet" data-moth-links-truncated>There are more links than M.O.T.H. draws at once: some are not shown.</p>}
            {snap.workspace?.cut && <p className="moth-quiet" data-moth-lists-cut>There are more notes or typed tags than M.O.T.H. reads at once: some are not shown.</p>}
            {frameLine && <p className="moth-quiet moth-frames" data-moth-frames>{frameLine}</p>}
          </div>
          <MothViewWidget
            views={views}
            viewSnap={viewSnap}
            config={config}
            catalogue={shown}
            index={index}
            selectedNode={selectedNode}
            pickedCount={pickedFiles.length}
            gate={gate}
            canUndo={canUndo && scrubAt == null}
            canRedo={canRedo && scrubAt == null}
            jump={jumpFor}
            localOnly={localOnly}
            history={lookBack}
            livePositions={() => worldRef.current?.positions() ?? {}}
            onUndo={() => act(() => history.undo())}
            onRedo={() => act(() => history.redo())}
            onMove={() => setMoving(true)}
            onDelete={() => setConfirming(true)}
            onJump={() => setJump(jumpFor)}
            onFind={(id) => select(id, { fly: true })}
            onNewView={() => setNewView(true)}
            onRelayout={() => worldRef.current?.relayout()}
            onError={setError}
            onViewDeleted={(undo, name) => setViewUndo({ undo, name })}
          />
          <MothListWidget
            adapter={adapter}
            snap={snap}
            catalogue={catalogue}
            index={index}
            inside={inside}
            picked={picked}
            gate={listGate}
            localOnly={localOnly}
            onDesktop={onDesktop}
            officeRoot={officeRoot}
            onNetworkStorage={onNetworkStorage}
            onInside={(id) => { setInside(id); if (id) select(id, { fly: true }) }}
            search={listSearch}
            onSearch={setListSearch}
            onPickFile={(fid) => select(nodeId('file', fid), { additive: true })}
            onSelect={(id) => select(id, { fly: true })}
            onRetry={(pid) => store.retryProject(pid)}
            onAdd={addFiles}
            onTrash={() => setTrashOpen(true)}
            onMove={() => setMoving(true)}
            onDelete={() => setConfirming(true)}
            pickedCount={pickedFiles.length}
            samePickedProject={samePickedProject}
            onChanged={() => setChangeKey((k) => k + 1)}
            NetworkShareBanner={NetworkShareBanner}
            openFolder={openFolder}
            filesById={fileRow}
            tagsView={config.nodeKinds.includes('tag') && !config.nodeKinds.includes('folder')}
          />
          <MothCards
            selectedId={selected.length === 1 ? selected[0] : null}
            index={index}
            recent={viewSnap?.prefs?.recent}
            onSelect={(id) => select(id, { fly: true })}
            onOpenCard={(id) => views?.noteOpened(id)}
            onDropFile={dropFile}
            onNote={setNote}
          />
          {drag?.target && (
            <span className="moth-cursor-word" style={{ left: drag.x + 14, top: drag.y + 14 }} data-moth-cursor-word>
              {drag.target.allowed ? (drag.target.mode === 'move' ? 'move into' : 'link') : (drag.target.reason || (drag.target.mode === 'move' ? 'cannot move here' : 'cannot link'))}
            </span>
          )}
          <MothBloom at={bloom} node={bloom ? index.rows.get(bloom.id) : null} adapter={adapter} file={bloom && kindOf(bloom.id) === 'file' ? fileRow(rowOf(bloom.id)) : null} onDesktop={onDesktop} />
        </div>
      </div>

      {showHelpModal && (
        <Dialog title="Help & documentation" dismissOnBackdrop width="reading" onClose={() => setShowHelpModal(false)}>
          <MothHelp />
        </Dialog>
      )}
      <Drawer open={tagsOpen} backdrop side="right" width="lg" label="Typed tags" title="Typed tags" onClose={() => setTagsOpen(false)} className="moth-settings-drawer">
        {tagsOpen && (
          <MothTagPanel
            adapter={adapter}
            store={store}
            workspace={snap.workspace}
            absent={snap.workspaceAbsent?.tags === true}
            readFailed={!!snap.workspaceError}
            readOnly={scrubAt != null ? 'Looking back changes nothing. Come back to now to change things.' : null}
            isAdmin={isAdminHere}
            userId={perms?.userId ?? null}
            selectedNode={selectedNode}
            canChange={mayChange(selectedNode).allowed}
          />
        )}
      </Drawer>
      <Drawer open={settingsOpen} backdrop side="right" width="lg" label="Settings" title="M.O.T.H. settings" onClose={() => setSettingsOpen(false)} className="moth-settings-drawer">
        <MothSettings appearance={appearance} onChange={setAppearance} calm={calm} available={viewSnap?.prefsAvailable !== false} />
      </Drawer>
      {(firstVisit || newView) && (
        <MothFirstVisit
          first={firstVisit}
          onChoose={(key, configChoice) => { setNewView(false); views?.chooseStart(key, configChoice) }}
          onClose={() => { setNewView(false); views?.dismissFirstVisit() }}
        />
      )}
      {trashOpen && islands && (
        <Dialog title="Trash" width="reading" onClose={() => setTrashOpen(false)}>
          <MothTrashView adapter={adapter} fileOps={fileOps} islands={islands} access={access} refreshKey={changeKey} />
        </Dialog>
      )}
      {moving && (
        <MothMoveTo adapter={adapter} islands={islands || []} files={pickedFiles} fromProject={pickedProject} onMove={move} onClose={() => setMoving(false)} />
      )}
      {jump && (
        <Dialog
          width="confirm"
          title={`Leave M.O.T.H.?`}
          onClose={() => setJump(null)}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setJump(null)} data-moth-jump-stay>Stay here</Button>
              <Button onClick={() => { const j = jump; setJump(null); j.go() }} data-moth-jump-go>Open {JUMP_WORDS[jump.tool]}</Button>
            </>
          )}
        >
          <p data-moth-jump-question>You're about to leave M.O.T.H. and open {JUMP_WORDS[jump.tool]}.</p>
        </Dialog>
      )}
      {confirming && (
        <Dialog
          width="confirm"
          title={`Delete ${whatDeleting}?`}
          onClose={() => setConfirming(false)}
          busy={deleting}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" onClick={remove} loading={deleting} loadingLabel="Deleting…">Delete</Button>
            </>
          )}
        >
          <p data-moth-delete-question>
            {pickedHidden > 0 ? (oneFile ? 'It is not shown by your search. ' : `${pickedHidden} of them ${pickedHidden === 1 ? 'is' : 'are'} not shown by your search. `) : ''}
            {onServerNow
              ? (oneFile
                ? 'It moves to the company server\'s bin on the office server, so it leaves its folder. It stays there for 30 days.'
                : 'They move to the company server\'s bin on the office server, so they leave their folders. They stay there for 30 days.')
              : localOnly
                ? `${oneFile ? 'It stays' : 'They stay'} in this project's trash on this computer for 30 days.`
                : `${oneFile ? 'It stays' : 'They stay'} in the trash for 30 days.`}
          </p>
        </Dialog>
      )}
    </div>
  )
}

