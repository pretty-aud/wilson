// ============================================================
// RABBIT — BinsView (the bin system, demo 2026-09-11)
// ============================================================
//
// Audrey: "if a project has scenes and shots set to true, we are going to
// create a new system for a new file type … raw footage from shoots,
// animations, stills, anything that is used in the assembly of an edit …
// i should be able to add files to the bins, review the footage and what is
// in each bin. this should be a new tab in the rabbit tool next to the
// scenes table tab."
//
// docs/BINS_DESIGN.md is the argument; this file is the tab. Three panes:
// the bin tree, the files of the current bin (frame view or list view, with
// search, filters and sort), and the inspector. Files are REFERENCES to
// where they live; nothing here copies, renames or moves media.
//
// Keyboard, on the files pane: arrows move, shift extends, ctrl toggles,
// ctrl+A selects all, S / R / U flag, C circles, 1–8 colour, 0 clears the
// colour, Enter or F2 renames, Delete removes (undo in the toast), Escape
// clears the selection, Space plays the preview. Only while R.A.B.B.I.T. is
// the page on screen and nothing is over the view (S2a-01, below).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, FolderPlus, FilePlus, LayoutGrid, List as ListIcon, Search, X, Filter, ChevronDown,
  Unplug, Link2, Check, Ban, Circle, Trash2, FolderInput, Copy, ExternalLink, FolderOpen, RefreshCw,
  Edit3, ArrowUp, ArrowDown, CornerLeftUp, Layers, Clapperboard, AlertTriangle, Film, UploadCloud, Monitor,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { needsCloudPoster } from '../bins/cloudPosters'
import { addedByName, ADD_NEEDS_DESKTOP, notConnectedSentence, CONNECT_LABEL, CONNECT_TITLE, CATALOGUE_SENTENCE, CATALOGUE_EMPTY_BINS_SENTENCE } from '../bins/binLocations'
// BC3: what this backend can do with a FILE, read from the capability object.
import { binsModeOf } from '../bins/browserCatalogue'
import PosterLarge from './bins/PosterLarge'
import { useProjectAccess } from '../state/useProjectAccess'
import { C, Btn, IconBtn, Chip, Menu, Modal, EmptyState, Kbd, Loading, MediaTag, ColorDot, Select, Banner, visibleOverlayOpen, OVER_THE_VIEW, drawerOnScreen } from './bins/binUi'
import BinTree from './bins/BinTree'
import BinFileTable from './bins/BinFileTable'
import BinFileGrid from './bins/BinFileGrid'
import BinInspector from './bins/BinInspector'
import AddFilesDialog from './bins/AddFilesDialog'
import DeleteBinDialog from './bins/DeleteBinDialog'
import RelinkBinsDialog from './bins/RelinkBinsDialog'
import RelinkLocationsDialog from './bins/RelinkLocationsDialog'
import { matchMissingFiles } from '../components/relinkMatcher'
import {
  descendantIds, countsByBin, binPathLabel, filterBinFiles, sortBinFiles, SORT_FIELDS, EMPTY_FILTERS,
  activeFilterCount, binStats, distinctValues, stepId, rangeIds,
} from '../bins/binSelectors'
import { MEDIA_TYPES, MEDIA_TYPE_META, COLORS, BIN_KINDS, BIN_KIND_META, formatDuration, formatBytes } from '../bins/binMedia'
// Shot takes (milestone 2): "Assign to shot…" from a file's menu, the selection
// bar and the inspector; "used in" on the inspector; a badge on tiles and rows.
import AssignToShotDialog from './bins/AssignToShotDialog'
import { usageByFile, usageCounts } from '../bins/shotTakeSelectors'
// Post-overhaul S3c, step 1: which shot list holds a shot a file is used in.
import { useHomeIndex } from './scenes/LinkHome'
import { useNavigateTarget } from '../state/rabbitNavigate'

// A filter chip whose label is the user's own data (a camera, a day, a scene,
// a tag) keeps its case: the kit Chip sets its label in capitals (the Label
// step), which turned "camera-original" into "#CAMERA-ORIGINAL" (review round
// 1). The words are the Caption step, sentence as written.
const DATA_CHIP = 'text-caption font-normal normal-case tracking-normal'

// BC2: "Footage NAS is", "Footage NAS and VFX are", "A, B and C are".
function unreachableWords(names) {
  const q = names.map(n => `"${n}"`)
  if (q.length === 1) return `${q[0]} is`
  return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]} are`
}

const TYPE_STARTER = [
  { name: 'Footage', kind: 'footage', color: 'orange' },
  { name: 'Audio', kind: 'audio', color: 'green' },
  { name: 'Stills', kind: 'stills', color: 'cyan' },
  { name: 'Graphics', kind: 'graphics', color: 'pink' },
  { name: 'VFX', kind: 'vfx', color: 'purple' },
  { name: 'Selects', kind: 'selects', color: 'yellow' },
]

/**
 * `pageActive`: R.A.B.B.I.T. is the page on screen (Rabbit.jsx passes
 * `currentPage === 'rabbit'`). It defaults CLOSED: a host that forgets it
 * gets keys that do nothing, which a test sees, rather than keys that act
 * from every page, which nobody does (S2a-01).
 */
export default function BinsView({ pageActive = false, people = [] } = {}) {
  const ctx = useRabbit()
  // BC2 (B6): bins are gated on `project.bins.write` — the twin of the shot
  // list gate, which admits REVIEWERS (Audrey: "Reviewers same as members").
  // `project.entity.write` refused them. On the signed-out desktop the two
  // read the same (no roles: both open), so B12 holds.
  const { can, reasonFor } = useProjectAccess()
  const canWrite = can('project.bins.write')
  const writeReason = reasonFor('project.bins.write')
  const supports = !!ctx?.supportsBins
  // What this backend can do with a FILE (BC1's capability object). Null
  // before the first list: read as "yes" so the signed-out desktop's tab is
  // unchanged while it loads (B12). BC3: `mode` is the one reading of it —
  // `catalogue` is the browser (B5: no picking, no bytes; one notice, New
  // bin in place of Add, the picture large on Space); the four verbs gate
  // their controls, so nothing is disabled without its reason.
  const caps = ctx?.binsInfo?.capabilities || null
  const mode = binsModeOf(caps)
  const canPick = mode.canPick
  const catalogue = mode.catalogue
  // The desktop app signed in: this computer's own answers about the files.
  const desktopCloud = caps?.backend === 'desktop_cloud'
  const projectId = ctx?.activeProjectId
  const bins = ctx?.bins || []
  const files = ctx?.binFiles || []
  const roots = ctx?.binRoots || []
  const scenes = ctx?.scenes || []
  const shots = ctx?.shots || []
  // Post-overhaul S3c, step 1: `scenes` / `shots` are the ACTIVE shot list's
  // (D10). A take on a shot only ANOTHER list holds dropped out of a file's
  // "Used in shots" and its count, and a file logged to such a scene read no
  // scene: where a file is used, and what it is logged to, read EVERY row;
  // the pickers offer the active list's by default, "Show all lists" for the
  // rest; and each shot names the list that holds it (homeOf).
  const allScenes = ctx?.allScenes || scenes
  const allShots = ctx?.allShots || shots
  const homeOf = useHomeIndex(ctx)
  const shotTakes = ctx?.shotTakes || []
  const fps = Number(ctx?.project?.fps) > 0 ? Number(ctx.project.fps) : 24
  const ffmpeg = ctx?.binsInfo?.ffmpeg ?? null
  const probing = ctx?.binsInfo?.probing || 0

  // ── UI state ──
  const [currentBinId, setCurrentBinId] = useState(null)
  const [includeNested, setIncludeNested] = useState(true)
  const [expanded, setExpanded] = useState(() => new Set())
  const [view, setView] = useState('grid')
  const [tileWidth, setTileWidth] = useState(200)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [sort, setSort] = useState({ field: 'sort_order', dir: 'asc' })
  const [selection, setSelection] = useState(() => new Set())
  const [currentId, setCurrentId] = useState(null)
  const anchorRef = useRef(null)
  const [renamingBinId, setRenamingBinId] = useState(null)
  const [renamingFileId, setRenamingFileId] = useState(null)
  const [menu, setMenu] = useState(null)
  const [addDlg, setAddDlg] = useState(null)
  const [addBusy, setAddBusy] = useState(false)
  const [addProgress, setAddProgress] = useState(null)
  const [deleteDlg, setDeleteDlg] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [relinkOpen, setRelinkOpen] = useState(false)
  const [assignDlg, setAssignDlg] = useState(null)   // the rows being assigned to a shot (milestone 2)
  const [assignBusy, setAssignBusy] = useState(false)
  // A failed confirm is reported INSIDE its dialog (review round 2: the page's
  // notice bar sits under the dialog's backdrop, so the button looked dead).
  const [addError, setAddError] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [assignError, setAssignError] = useState(null)
  const [thumbRev, setThumbRev] = useState(0)
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [removeAsk, setRemoveAsk] = useState(null)   // the ids awaiting "remove more than five?" (W9)
  // BC3: the browser's notice, said once (the page stays mounted, so a
  // dismissal lasts the session); and the picture large (Space where
  // nothing can play), which follows the current row.
  const [noticeDismissed, setNoticeDismissed] = useState(false)
  const [posterLarge, setPosterLarge] = useState(false)
  const paneRef = useRef(null)
  const autoRelinkRef = useRef(null)
  const noticeTimer = useRef(null)

  const say = useCallback((text, kind = 'info', ms = 7000) => {
    clearTimeout(noticeTimer.current)
    setNotice({ text, kind })
    if (ms) noticeTimer.current = setTimeout(() => setNotice(null), ms)
  }, [])
  useEffect(() => () => clearTimeout(noticeTimer.current), [])
  // Background failures the provider reports — an undo that could not put a
  // file back, say — surface here, in this tab's notice bar.
  const providerNotice = ctx?.binsInfo?.notice
  useEffect(() => { if (providerNotice?.text) say(providerNotice.text, providerNotice.kind || 'warn', 12000) }, [providerNotice, say])

  // ── Load: the list route is what carries `online` and the ffmpeg flag ──
  const refreshBins = ctx?.refreshBins
  const load = useCallback(async () => {
    if (!supports || !projectId || !refreshBins) return null
    setLoading(true); setLoadError(null)
    try { return await refreshBins() }
    catch (e) { setLoadError(e?.message || String(e)); return null }
    finally { setLoading(false) }
  }, [supports, projectId, refreshBins])

  // The once-per-project pass after a load — pending rows re-probed, the
  // renderer's own probe for rows the server has no decoder for — lives in
  // the provider's refreshBins (browserProbe there), so it runs whichever tab
  // asked for the list; posters it posts reach this tab through
  // binsInfo.posterRev in thumbUrlFor. 🚨 The load effect must not depend on
  // ctx: its identity changes on every provider state update.
  useEffect(() => { load() }, [load])

  // ── Auto-relink on open (Q12): scan every known root once per project ──
  const binRelinkScan = ctx?.binRelinkScan
  const binRelinkApply = ctx?.binRelinkApply
  useEffect(() => {
    if (!supports || !projectId || !binRelinkScan || !binRelinkApply) return
    if (autoRelinkRef.current === projectId) return
    const offline = files.filter(f => f.online === false)
    if (!offline.length || !roots.length || loading) return
    autoRelinkRef.current = projectId
    let cancelled = false
    ;(async () => {
      const missing = offline.map(r => ({ id: r.id, name: r.original_name, storage_path: r.source_path, size_bytes: r.is_sequence ? null : (r.size_bytes ?? null), is_sequence: !!r.is_sequence }))
      const mappings = []
      const claimed = new Set()
      for (const root of roots) {
        let res
        try { res = await binRelinkScan(root.path) } catch { continue }
        if (cancelled || !res?.candidates) continue
        const still = missing.filter(m => !claimed.has(m.id))
        const m = matchMissingFiles(still.filter(x => !x.is_sequence), res.candidates.filter(c => !c.is_sequence))
        for (const p of m.proposals) {
          const abs = res.candidates.find(c => c.relPath === p.newPath)?.abs
          if (abs) { mappings.push({ id: p.id, newPath: abs }); claimed.add(p.id) }
        }
        for (const s of still.filter(x => x.is_sequence)) {
          const hits = res.candidates.filter(c => c.is_sequence && c.name.toLowerCase() === String(s.name).toLowerCase())
          if (hits.length === 1) { mappings.push({ id: s.id, newPath: hits[0].abs }); claimed.add(s.id) }
        }
      }
      if (cancelled || !mappings.length) return
      try {
        const r = await binRelinkApply(mappings)
        const n = r?.updated?.length || 0
        if (n) { setThumbRev(v => v + 1); say(`Relinked ${n} file${n === 1 ? '' : 's'} from the folders this project knows.`, 'ok') }
      } catch { /* the Relink button remains */ }
    })()
    return () => { cancelled = true }
  }, [supports, projectId, files, roots, loading, binRelinkScan, binRelinkApply, say])

  // ── Derived ──
  const binsById = useMemo(() => new Map(bins.map(b => [b.id, b])), [bins])
  const counts = useMemo(() => countsByBin(bins, files), [bins, files])
  // The rows this computer cannot reach, COUNTED: on the desktop they are
  // the relink's list and the tree's and toolbar's counts. BC3: where the
  // backend cannot say what this computer reaches (a browser), every row is
  // "not on this computer" (B3) and a count of them says nothing — each clip
  // keeps its mark and its sentence, and the notice at the top says it once.
  const offlineAll = useMemo(() => (mode.nothingReachable ? [] : files.filter(f => f.online === false)), [files, mode.nothingReachable])
  const offlineCounts = useMemo(() => countsByBin(bins, offlineAll), [bins, offlineAll])
  const currentBin = currentBinId ? binsById.get(currentBinId) : null
  useEffect(() => { if (currentBinId && !binsById.has(currentBinId)) setCurrentBinId(null) }, [currentBinId, binsById])

  const scopeFiles = useMemo(() => {
    if (!currentBinId) return files
    const ids = includeNested ? descendantIds(bins, currentBinId) : new Set([currentBinId])
    return files.filter(f => ids.has(f.bin_id))
  }, [files, bins, currentBinId, includeNested])
  const rows = useMemo(() => sortBinFiles(filterBinFiles(scopeFiles, filters, search), sort), [scopeFiles, filters, search, sort])
  const orderedIds = useMemo(() => rows.map(r => r.id), [rows])
  const stats = useMemo(() => binStats(scopeFiles), [scopeFiles])
  const shownStats = useMemo(() => binStats(rows), [rows])
  const selectedRows = useMemo(() => rows.filter(r => selection.has(r.id)), [rows, selection])
  // BC3: the row the picture-large view shows (the current one); the view
  // closes when there is none.
  const currentRow = useMemo(() => (currentId ? files.find(f => f.id === currentId) || null : null), [files, currentId])
  useEffect(() => { if (!currentRow) setPosterLarge(false) }, [currentRow])
  const scenesById = useMemo(() => new Map(allScenes.map(s => [s.id, s])), [allScenes])
  const filterCount = activeFilterCount(filters)
  // Where each file is used (milestone 2): the inspector's "Used in shots",
  // and the count badge on tiles and rows. Takes of a deleted shot are skipped.
  // Every shot of the project, in whichever list (S3c step 1).
  const usage = useMemo(() => usageByFile(shotTakes, allShots, allScenes, files), [shotTakes, allShots, allScenes, files])
  const usageCount = useMemo(() => usageCounts(shotTakes, allShots), [shotTakes, allShots])

  // Selection survives only for rows that still exist here.
  useEffect(() => {
    setSelection(prev => {
      const next = new Set([...prev].filter(id => orderedIds.includes(id)))
      return next.size === prev.size ? prev : next
    })
    if (currentId && !orderedIds.includes(currentId)) setCurrentId(null)
  }, [orderedIds, currentId])

  // thumbRev: this tab's own bumps (a relink, a re-probe); posterRev: posters
  // the provider's browser probe posted, from any tab.
  const thumbUrlFor = useCallback((id) => ctx?.binFileThumbnailUrl?.(id, thumbRev + (ctx?.binsInfo?.posterRev || 0)), [ctx, thumbRev])
  const streamUrlFor = useCallback((id) => ctx?.binFileStreamUrl?.(id), [ctx])
  const binPathFor = useCallback((id) => binPathLabel(bins, id), [bins])
  // BC2: a company's clip names its footage location and who added it (B11).
  const locationById = useMemo(() => new Map((ctx?.binLocations || []).map(l => [l.id, l])), [ctx?.binLocations])
  // The location, with whether THIS computer has agreed to connect to it
  // (review round 1: the inspector says "not connected" rather than "not
  // reachable" for a location never contacted here).
  const statusByLocation = useMemo(() => new Map((ctx?.binsInfo?.locations || []).map(s => [s.id, s])), [ctx?.binsInfo?.locations])
  const locationOf = useCallback((row) => {
    const loc = row?.location_id ? locationById.get(row.location_id) || null : null
    const st = loc ? statusByLocation.get(loc.id) : null
    return loc && st?.connected === false ? { ...loc, connected: false } : loc
  }, [locationById, statusByLocation])
  const addedByOf = useCallback((row) => (row?.location_id ? addedByName(row.added_by, people) : null), [people])
  // The word for a clip this computer cannot reach: a company's clip is
  // "not on this computer" (B3); the signed-out desktop's says "offline".
  const offlineWord = mode.offlineWord

  // ── Selection ──
  const selectRow = useCallback((id, e) => {
    const shift = e?.shiftKey; const toggle = e?.ctrlKey || e?.metaKey
    setSelection(prev => {
      if (shift && anchorRef.current) return new Set(rangeIds(orderedIds, anchorRef.current, id))
      if (toggle) { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n }
      return new Set([id])
    })
    if (!shift) anchorRef.current = id
    setCurrentId(id)
  }, [orderedIds])
  const clearSelection = useCallback(() => { setSelection(new Set()); setCurrentId(null); anchorRef.current = null }, [])
  const selectAll = useCallback(() => { setSelection(new Set(orderedIds)); if (!currentId && orderedIds[0]) setCurrentId(orderedIds[0]) }, [orderedIds, currentId])
  const dragIdsFor = useCallback((id) => selection.has(id) ? [...selection] : [id], [selection])

  // ── Mutations on the selection ──
  const targetIds = useCallback((id) => (id && !selection.has(id)) ? [id] : (selection.size ? [...selection] : (id ? [id] : [])), [selection])
  const patchIds = useCallback(async (ids, patch) => {
    if (!ids.length || !canWrite) return
    try {
      if (ids.length === 1) await ctx.updateBinFile(ids[0], patch)
      else await ctx.bulkUpdateBinFiles(ids, patch)
    } catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, canWrite, say])
  const patchSelection = useCallback((patch) => patchIds([...selection], patch), [patchIds, selection])

  const doRemoveIds = useCallback(async (ids) => {
    try { await ctx.removeBinFiles(ids); clearSelection() }
    catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, clearSelection, say])
  // W9 (Audrey, "convert"): the kit Dialog in place of window.confirm — the
  // same threshold (more than five), the same words, Cancel as the way out.
  const removeIds = useCallback(async (ids) => {
    if (!ids.length || !canWrite) return
    if (ids.length > 5) { setRemoveAsk(ids); return }
    await doRemoveIds(ids)
  }, [canWrite, doRemoveIds])
  const moveIds = useCallback(async (ids, binId) => {
    if (!ids.length || !canWrite) return
    try { await ctx.moveBinFiles(ids, binId); say(`Moved ${ids.length} file${ids.length === 1 ? '' : 's'} to "${binsById.get(binId)?.name || 'bin'}".`, 'ok', 4000) }
    catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, canWrite, binsById, say])
  const copyIds = useCallback(async (ids, binId) => {
    if (!ids.length || !canWrite) return
    try { await ctx.copyBinFiles(ids, binId); say(`Copied ${ids.length} file${ids.length === 1 ? '' : 's'} to "${binsById.get(binId)?.name || 'bin'}" as instances.`, 'ok', 4000) }
    catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, canWrite, binsById, say])
  const openFile = useCallback(async (id, reveal) => {
    try { await ctx.openBinFile(id, reveal) }
    catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, say])
  const probe = useCallback(async (id) => {
    try { await ctx.probeBinFile(id); setThumbRev(v => v + 1) }
    catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, say])

  // ── Shot takes (milestone 2): "Assign to shot…" from the files ──
  const openAssign = useCallback((ids) => {
    const rows = files.filter(f => ids.includes(f.id))
    if (!rows.length || !canWrite) return
    if (!shots.length) { say('No shots to assign to yet. Add shots on the Scenes tab first.', 'warn'); return }
    setAssignDlg(rows)
  }, [files, shots.length, canWrite, say])
  const confirmAssign = useCallback(async (shotIds, role) => {
    if (!assignDlg || !shotIds?.length) return
    setAssignBusy(true); setAssignError(null)
    try {
      const assignments = []
      for (const shotId of shotIds) for (const f of assignDlg) assignments.push({ shot_id: shotId, bin_file_id: f.id, ...(role ? { role } : {}) })
      const res = await ctx.assignShotTakes(assignments)
      const n = res?.created?.length || 0; const k = res?.skipped?.length || 0
      const where = shotIds.length === 1 ? `"${shots.find(s => s.id === shotIds[0])?.name || 'shot'}"` : `${shotIds.length} shots`
      say(`Assigned ${n} take${n === 1 ? '' : 's'} to ${where}${k ? ` · ${k} already assigned` : ''}${n ? '. Ctrl+Z undoes it.' : '.'}`, n ? 'ok' : 'warn')
      setAssignDlg(null)
    } catch (e) { setAssignError(e?.message || String(e)) }
    finally { setAssignBusy(false) }
  }, [assignDlg, ctx, shots, say])
  const unassign = useCallback(async (takeIds) => {
    try { await ctx.removeShotTakes(takeIds) } catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, say])
  // "Show in Bins" from a shot's takes lands on the file, selected, in its bin.
  // Declined (false) until the file is in state, so a request made before the
  // list landed is retried, not lost.
  const onNavigate = useCallback((p) => {
    if (!p?.fileId) return true
    const f = files.find(x => x.id === p.fileId)
    if (!f) return false
    // The tree opens down to the file's bin (review round 2: a file in a
    // nested bin arrived selected with its bin collapsed and no row lit).
    const ancestors = []
    for (let b = binsById.get(f.bin_id); b?.parent_bin_id && !ancestors.includes(b.parent_bin_id); b = binsById.get(b.parent_bin_id)) ancestors.push(b.parent_bin_id)
    if (ancestors.length) setExpanded(s => new Set([...s, ...ancestors]))
    setCurrentBinId(f.bin_id); setIncludeNested(true); setSearch(''); setFilters(EMPTY_FILTERS)
    setSelection(new Set([f.id])); setCurrentId(f.id); anchorRef.current = f.id
    return true
  }, [files, binsById])
  useNavigateTarget('bins', onNavigate, projectId)

  // ── Adding files ──
  // BC2 (B8): on the cloud the desktop's walk does not know the project's
  // rows; the provider does. A clip already in the project (same location,
  // same file) arrives unticked, "already in …", as the signed-out dialog
  // has always done — Skip, or tick it to add it anyway (an instance).
  const findDuplicateBinFiles = ctx?.findDuplicateBinFiles
  const withDuplicates = useCallback((plan) => {
    if (!plan?.items?.some(it => it.location_id) || typeof findDuplicateBinFiles !== 'function') return plan
    const dupes = findDuplicateBinFiles(plan.items.map(it => (it.location_id ? { location_id: it.location_id, relative_path: it.relative_path } : null)))
    return { ...plan, items: plan.items.map((it, i) => (dupes[i] ? { ...it, duplicate: dupes[i] } : it)) }
  }, [findDuplicateBinFiles])

  const addPathsTo = useCallback(async (binId, paths) => {
    if (!paths?.length || !canWrite) return
    const bin = binsById.get(binId)
    // A dropped folder becomes a nested bin named after itself — unless no bin
    // is selected and the drop IS one folder, in which case that folder's name
    // becomes the new bin and its files go straight in (no "Day01 / Day01").
    // That new bin is only CREATED when the batch is confirmed (review round
    // 2: a cancelled or failed add left an empty bin behind, and took the
    // empty state's starter buttons with it).
    let folderAsBin = true
    let pending = null
    if (!bin) {
      const single = paths.length === 1 ? String(paths[0]) : null
      const leaf = single ? (single.split(/[\\/]/).filter(Boolean).pop() || '') : ''
      const looksLikeFile = /\.[A-Za-z0-9]{1,12}$/.test(leaf)
      const name = single && leaf && !looksLikeFile ? leaf : 'New bin'
      pending = { id: null, name, kind: 'footage' }
      if (single && !looksLikeFile) folderAsBin = false
    }
    try {
      const plan = withDuplicates(await ctx.prepareBinFiles(paths, { folderAsBin }))
      if (!plan?.items?.length) { say('Nothing to add: no files were found at what was dropped.', 'warn'); return }
      setAddError(null)
      // The paths stay with the dialog (BC2): naming the share a file lies on
      // reads the same batch again, now inside a location.
      setAddDlg({ bin: bin || pending, plan, paths, folderAsBin })
    } catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, canWrite, binsById, say, withDuplicates])

  // BC2: "Which location is this? Name it." — a picked file on a share the
  // company has not named: the share becomes a location, and the batch is
  // read again (now inside it). The dialog stays open throughout.
  const nameShareAsLocation = useCallback(async (shareRoot, name) => {
    if (!addDlg) return
    await ctx.addBinLocation({ name, unc_path: shareRoot })
    const plan = withDuplicates(await ctx.prepareBinFiles(addDlg.paths, { folderAsBin: addDlg.folderAsBin }))
    setAddDlg(d => (d ? { ...d, plan, planRev: (d.planRev || 0) + 1 } : d))
  }, [addDlg, ctx, withDuplicates])

  const pickFiles = useCallback(async (binId) => {
    try { const r = await ctx.pickBinFiles(); if (r?.paths?.length) await addPathsTo(binId, r.paths) }
    catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, addPathsTo, say])
  const pickFolder = useCallback(async (binId) => {
    try { const r = await ctx.pickBinFolder('Add a folder to the bin'); if (r?.path) await addPathsTo(binId, [r.path]) }
    catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, addPathsTo, say])

  const confirmAdd = useCallback(async (items, createSubBins) => {
    if (!addDlg) return
    setAddBusy(true); setAddError(null); setAddProgress(`Adding ${items.length} item${items.length === 1 ? '' : 's'}…`)
    try {
      let bin = addDlg.bin
      if (!bin.id) {
        // The bin a drop on the empty page asked for, created now that the
        // batch is confirmed; a retry after a failure reuses it.
        bin = await ctx.addBin({ name: bin.name, kind: bin.kind || 'footage' })
        setAddDlg(d => (d ? { ...d, bin } : d))
      }
      // BC2: on the desktop signed in, each clip's columns are read on the
      // share before the add — said, so the wait has a count.
      const onProgress = ({ done, total }) => setAddProgress(`Reading ${done} of ${total} on the share…`)
      const res = await ctx.addBinFiles(bin.id, items, createSubBins, addDlg.plan?.roots || null, { onProgress })
      const added = (res.results || []).filter(r => r.status === 'added').length
      const missing = (res.results || []).filter(r => r.status === 'missing').length
      const other = (res.results || []).length - added - missing
      const parts = [`Added ${added} item${added === 1 ? '' : 's'} to "${bin.name}"`]
      if (res.bins?.length) parts.push(`${res.bins.length} nested bin${res.bins.length === 1 ? '' : 's'} created`)
      if (missing) parts.push(`${missing} missing on disk`)
      if (other) parts.push(`${other} skipped`)
      say(parts.join(' · ') + '.', missing || other ? 'warn' : 'ok')
      setExpanded(s => new Set([...s, bin.id]))
      setCurrentBinId(bin.id)
      setSelection(new Set((res.created || []).map(r => r.id)))
      setAddDlg(null)
    } catch (e) { setAddError(e?.message || String(e)) }
    finally { setAddBusy(false); setAddProgress(null) }
  }, [addDlg, ctx, say])

  const pathsFromFiles = useCallback((fileList) => {
    const api = window.electronAPI?.rabbit
    const out = []
    for (const f of fileList || []) {
      const p = api?.getPathForFile ? api.getPathForFile(f) : (f.path || '')
      if (p) out.push(p)
    }
    return out
  }, [])

  // ── Bins ──
  const createBin = useCallback(async (parentId, preset = {}) => {
    if (!canWrite) return null
    try {
      const bin = await ctx.addBin({ name: preset.name || 'New bin', kind: preset.kind || 'footage', color: preset.color || null, parent_bin_id: parentId || null, description: preset.description || '' })
      if (parentId) setExpanded(s => new Set([...s, parentId]))
      setCurrentBinId(bin.id)
      if (!preset.name) setRenamingBinId(bin.id)
      return bin
    } catch (e) { say(e?.message || String(e), 'error'); return null }
  }, [ctx, canWrite, say])
  const renameBin = useCallback(async (id, name) => {
    const bin = binsById.get(id)
    if (!bin || !name || name === bin.name) return
    try { await ctx.updateBin(id, { name }) } catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, binsById, say])
  const patchBin = useCallback(async (id, patch) => {
    try { await ctx.updateBin(id, patch) } catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, say])
  const nestBin = useCallback(async (binId, newParentId) => {
    if (!canWrite || binId === newParentId) return
    if (newParentId && descendantIds(bins, binId).has(newParentId)) { say('A bin cannot be moved inside itself.', 'warn'); return }
    const siblings = bins.filter(b => (b.parent_bin_id || null) === (newParentId || null) && b.id !== binId)
    const order = siblings.reduce((m, b) => Math.max(m, Number(b.sort_order) || 0), -1) + 1
    try { await ctx.reorderBins([{ id: binId, parent_bin_id: newParentId || null, sort_order: order }]); if (newParentId) setExpanded(s => new Set([...s, newParentId])) }
    catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, bins, canWrite, say])
  const shiftBin = useCallback(async (bin, dir) => {
    const siblings = bins.filter(b => (b.parent_bin_id || null) === (bin.parent_bin_id || null)).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name)))
    const i = siblings.findIndex(b => b.id === bin.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= siblings.length) return
    const reordered = siblings.slice(); [reordered[i], reordered[j]] = [reordered[j], reordered[i]]
    try { await ctx.reorderBins(reordered.map((b, k) => ({ id: b.id, parent_bin_id: b.parent_bin_id || null, sort_order: k }))) }
    catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, bins, say])
  const confirmDelete = useCallback(async ({ mode, target }) => {
    if (!deleteDlg) return
    setDeleteBusy(true); setDeleteError(null)
    try {
      const sub = descendantIds(bins, deleteDlg.id)
      await ctx.deleteBin(deleteDlg.id, { mode, target })
      if (currentBinId && sub.has(currentBinId)) setCurrentBinId(mode === 'move' ? target : null)
      setDeleteDlg(null)
    } catch (e) { setDeleteError(e?.message || String(e)) }
    finally { setDeleteBusy(false) }
  }, [deleteDlg, ctx, bins, currentBinId])

  const createStarter = useCallback(async (which) => {
    if (!canWrite) return
    const list = which === 'types' ? TYPE_STARTER
      : which === 'scenes' ? scenes.slice().sort((a, b) => (a.scene_number ?? 0) - (b.scene_number ?? 0)).map(s => ({ name: s.name || 'Untitled scene', kind: 'footage', color: null, description: s.description || '' }))
        : [{ name: 'Dailies', kind: 'footage', color: 'orange', description: 'Untouched footage, one nested bin per shoot day' }, { name: 'Selects', kind: 'selects', color: 'yellow' }]
    try {
      await ctx.runBatch(async () => { for (const p of list) await ctx.addBin({ name: p.name, kind: p.kind, color: p.color || null, description: p.description || '' }) })
      say(`Created ${list.length} bin${list.length === 1 ? '' : 's'}.`, 'ok', 4000)
    } catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, canWrite, scenes, say])

  // ── Menus ──
  const binTargets = useCallback((exceptIds = new Set()) => bins.filter(b => !exceptIds.has(b.id)).map(b => ({ id: b.id, label: binPathLabel(bins, b.id), color: b.color })), [bins])

  const fileMenu = useCallback((e, id) => {
    const ids = targetIds(id)
    if (!selection.has(id)) { setSelection(new Set([id])); setCurrentId(id); anchorRef.current = id }
    const row = files.find(f => f.id === id)
    const n = ids.length
    const items = [
      { header: n === 1 ? (row?.display_name || row?.original_name) : `${n} files` },
      canWrite && { label: 'Select', Icon: Check, hint: 'S', onClick: () => patchIds(ids, { review_flag: 'select' }) },
      canWrite && { label: 'Reject', Icon: Ban, hint: 'R', onClick: () => patchIds(ids, { review_flag: 'reject' }) },
      canWrite && { label: 'Unflag', hint: 'U', onClick: () => patchIds(ids, { review_flag: 'unflagged' }) },
      canWrite && { label: row?.circled && n === 1 ? 'Uncircle' : 'Circle (director’s pick)', Icon: Circle, hint: 'C', onClick: () => patchIds(ids, { circled: !(row?.circled && n === 1) }) },
      canWrite && { divider: true },
      canWrite && { label: n === 1 ? 'Assign to shot…' : `Assign ${n} to a shot…`, Icon: Clapperboard, hint: 'A', disabled: !shots.length, onClick: () => openAssign(ids) },
      canWrite && { divider: true },
      canWrite && { header: 'Colour' },
      ...(canWrite ? COLORS.map((c, i) => ({ label: c, ColorDot: c, hint: String(i + 1), onClick: () => patchIds(ids, { color: c }) })) : []),
      canWrite && { label: 'No colour', hint: '0', onClick: () => patchIds(ids, { color: null }) },
      canWrite && { divider: true },
      canWrite && bins.length > 1 && { header: 'Move to' },
      ...(canWrite ? binTargets(new Set([row?.bin_id])).map(t => ({ label: t.label, Icon: FolderInput, ColorDot: t.color || undefined, onClick: () => moveIds(ids, t.id) })) : []),
      canWrite && { header: 'Copy to (as an instance)' },
      ...(canWrite ? binTargets().map(t => ({ label: t.label, Icon: Copy, onClick: () => copyIds(ids, t.id) })) : []),
      canWrite && { divider: true },
      // BC3: the OS and the decoder are offered only where the backend has
      // them (the desktop); a browser's menu says nothing it cannot do.
      n === 1 && mode.canOpen && { label: 'Open in default app', Icon: ExternalLink, disabled: row?.online === false, onClick: () => openFile(id, false) },
      n === 1 && mode.canOpen && { label: 'Reveal in Explorer', Icon: FolderOpen, disabled: row?.online === false, onClick: () => openFile(id, true) },
      n === 1 && canWrite && mode.canProbe && { label: 'Read columns again', Icon: RefreshCw, disabled: row?.online === false, onClick: () => probe(id) },
      n === 1 && canWrite && { label: 'Rename', Icon: Edit3, hint: 'F2', onClick: () => setRenamingFileId(id) },
      canWrite && { divider: true },
      canWrite && { label: n === 1 ? 'Remove from bin' : `Remove ${n} from bin`, Icon: Trash2, danger: true, hint: 'Del', onClick: () => removeIds(ids) },
    ]
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [targetIds, selection, files, canWrite, bins, binTargets, patchIds, moveIds, copyIds, openFile, probe, removeIds, shots.length, openAssign, mode.canOpen, mode.canProbe])

  const binMenu = useCallback((e, bin) => {
    const sub = descendantIds(bins, bin.id)
    const items = [
      { header: binPathLabel(bins, bin.id) },
      // BC3: no picking where no computer can (a browser): the notice says why.
      canWrite && canPick && { label: 'Add files…', Icon: FilePlus, onClick: () => pickFiles(bin.id) },
      canWrite && canPick && { label: 'Add a folder…', Icon: FolderPlus, onClick: () => pickFolder(bin.id) },
      canWrite && { label: 'New bin inside', Icon: Plus, onClick: () => createBin(bin.id) },
      canWrite && { label: 'Rename', Icon: Edit3, hint: 'F2', onClick: () => setRenamingBinId(bin.id) },
      canWrite && { divider: true },
      canWrite && { header: 'Kind' },
      ...(canWrite ? BIN_KINDS.map(k => ({ label: BIN_KIND_META[k].label + (bin.kind === k ? '  ✓' : ''), onClick: () => patchBin(bin.id, { kind: k }) })) : []),
      canWrite && { header: 'Colour' },
      ...(canWrite ? COLORS.map(c => ({ label: c + (bin.color === c ? '  ✓' : ''), ColorDot: c, onClick: () => patchBin(bin.id, { color: c }) })) : []),
      canWrite && { label: 'No colour', onClick: () => patchBin(bin.id, { color: null }) },
      canWrite && { divider: true },
      canWrite && { label: 'Move up', Icon: ArrowUp, onClick: () => shiftBin(bin, -1) },
      canWrite && { label: 'Move down', Icon: ArrowDown, onClick: () => shiftBin(bin, 1) },
      canWrite && bin.parent_bin_id && { label: 'Move to top level', Icon: CornerLeftUp, onClick: () => nestBin(bin.id, null) },
      ...(canWrite ? bins.filter(b => !sub.has(b.id) && b.id !== bin.parent_bin_id).map(b => ({ label: `Move inside ${binPathLabel(bins, b.id)}`, Icon: FolderInput, onClick: () => nestBin(bin.id, b.id) })) : []),
      canWrite && { divider: true },
      canWrite && { label: 'Delete bin…', Icon: Trash2, danger: true, onClick: () => setDeleteDlg(bin) },
    ]
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [bins, canWrite, canPick, pickFiles, pickFolder, createBin, patchBin, shiftBin, nestBin])

  // ── Keyboard ──
  const onKeyDown = useCallback((e) => {
    // 🚨 S2a-01 (post-overhaul S4a): every page stays mounted, and this
    // handler is on the DOCUMENT, so with a file selected here it took Enter,
    // Delete (up to five files, unasked), S / R / U / C, 0–8 and Ctrl+Z on
    // every OTHER page (MEASURED for Enter by S2a's review round 2: D.O.G.'s
    // "Enter generates" died). It acts only while R.A.B.B.I.T. is on screen;
    // Bins is its view whenever this is mounted (Rabbit renders it for the
    // Bins tab only).
    if (!pageActive) return
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    // …and while ANY kit dialog or menu is ON SCREEN, not only the ones this
    // view tracks (review round 1): the shell's dialogs join as they move onto
    // the kit. On screen, not merely open (round 2: one left open on a hidden
    // page held every Bins key dead in the web build).
    if (menu || addDlg || deleteDlg || relinkOpen || assignDlg || removeAsk || visibleOverlayOpen()) return
    // …and a drawer (S4a): R.A.B.B.I.T.'s settings drawer opens over this
    // view, and the kit Drawer is not on the overlay stack. Delete on one of
    // its buttons removed the selected files behind it, and Escape cleared
    // the selection instead of closing it: the Drawer listens on `window`,
    // after this, and leaves a key that was already handled.
    if (drawerOnScreen() || (t && typeof t.closest === 'function' && t.closest(OVER_THE_VIEW))) return
    // The grid's REAL column count, read from its computed tracks (review
    // round 2: a formula guessed it and ↓ walked diagonally at some widths).
    const gridEl = view === 'grid' ? paneRef.current?.querySelector('[data-bin-grid]') : null
    const measured = gridEl ? getComputedStyle(gridEl).gridTemplateColumns.split(' ').filter(Boolean).length : 0
    const cols = view === 'grid' ? Math.max(1, measured || Math.floor(((paneRef.current?.clientWidth || 800) - 24) / (tileWidth + 12))) : 1
    const move = (steps) => {
      const next = stepId(orderedIds, currentId, steps)
      if (!next) return
      e.preventDefault()
      if (e.shiftKey) { if (!anchorRef.current) anchorRef.current = currentId || next; setSelection(new Set(rangeIds(orderedIds, anchorRef.current, next))) }
      else { setSelection(new Set([next])); anchorRef.current = next }
      setCurrentId(next)
    }
    const ids = [...selection]
    // Undo / redo on the pane, the way TimelineView binds them: the provider's
    // history holds every bins mutation.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      if (e.shiftKey) ctx?.redo?.(); else ctx?.undo?.()
      return
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); ctx?.redo?.(); return }
    switch (e.key) {
      case 'ArrowDown': return move(cols)
      case 'ArrowUp': return move(-cols)
      case 'ArrowRight': return view === 'grid' ? move(1) : undefined
      case 'ArrowLeft': return view === 'grid' ? move(-1) : undefined
      case 'Home': return move(-orderedIds.length)
      case 'End': return move(orderedIds.length)
      // BC3: where nothing can play (a browser), Space shows the current
      // clip's picture large, and again puts it away; where a preview plays,
      // Space is the inspector's (BinInspector's own handler) and this does
      // nothing. A held key does not flicker it.
      case ' ': if (!mode.canStream && currentId && !e.repeat) { e.preventDefault(); setPosterLarge(v => !v) } return
      // Escape closes the picture first, keeping the selection; then it
      // clears the selection as it always has.
      case 'Escape': e.preventDefault(); if (posterLarge) return setPosterLarge(false); return clearSelection()
      case 'a': case 'A': if (e.ctrlKey || e.metaKey) { e.preventDefault(); selectAll() } else if (ids.length) { e.preventDefault(); openAssign(ids) } return
      case 's': case 'S': if (!e.ctrlKey && ids.length) { e.preventDefault(); patchIds(ids, { review_flag: 'select' }) } return
      case 'r': case 'R': if (!e.ctrlKey && ids.length) { e.preventDefault(); patchIds(ids, { review_flag: 'reject' }) } return
      case 'u': case 'U': if (!e.ctrlKey && ids.length) { e.preventDefault(); patchIds(ids, { review_flag: 'unflagged' }) } return
      case 'c': case 'C': if (!e.ctrlKey && ids.length) { e.preventDefault(); const cur = files.find(f => f.id === (currentId || ids[0])); patchIds(ids, { circled: !cur?.circled }) } return
      case 'Delete': case 'Backspace': if (ids.length) { e.preventDefault(); removeIds(ids) } return
      // A rename under the picture large would be typed blind (the rename
      // bar sits below it, review round 1): the picture closes first.
      case 'Enter': case 'F2': if (currentId && canWrite) { e.preventDefault(); setPosterLarge(false); setRenamingFileId(currentId) } return
      default:
        if (/^[0-8]$/.test(e.key) && ids.length && !e.ctrlKey) { e.preventDefault(); patchIds(ids, { color: e.key === '0' ? null : COLORS[Number(e.key) - 1] }) }
    }
  }, [pageActive, ctx, menu, addDlg, deleteDlg, relinkOpen, assignDlg, removeAsk, view, tileWidth, orderedIds, currentId, selection, files, canWrite, clearSelection, selectAll, patchIds, removeIds, openAssign, mode.canStream, posterLarge])
  // 🚨 Bound on the DOCUMENT, like the Scenes tab's undo (review round 2,
  // HIGH): a React onKeyDown on the pane only fired while focus sat inside
  // it, and focus falls to <body> whenever the control just clicked unmounts
  // — the starter buttons, a dialog's confirm, a menu item — so the Ctrl+Z
  // the notice had just promised did nothing. The handler still stands down
  // in fields and while a dialog or menu is open; a control's own Enter and
  // Space are left to the control.
  const onKeyDownRef = useRef(onKeyDown); onKeyDownRef.current = onKeyDown
  useEffect(() => {
    const h = (e) => {
      const t = e.target
      if ((e.key === 'Enter' || e.key === ' ') && t && typeof t.closest === 'function' && t.closest('button, a, [role="button"], [role="menuitem"], summary')) return
      onKeyDownRef.current(e)
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  // ── Drag and drop from the OS onto the files pane ──
  // BC3: where no computer can pick a file (a browser), a drop from the OS
  // is answered with the sentence, not with a path error — and the pane does
  // not light up as a target for it.
  const onDragOverPane = (e) => {
    const types = e.dataTransfer?.types || []
    if (types.includes('Files') && canWrite && canPick) { e.preventDefault(); e.dataTransfer.dropEffect = 'link'; setDragOver(true) }
  }
  const onDropPane = async (e) => {
    setDragOver(false)
    const types = e.dataTransfer?.types || []
    if (!types.includes('Files')) return
    e.preventDefault()
    if (!canPick) { say(ADD_NEEDS_DESKTOP, 'info'); return }
    const paths = pathsFromFiles(e.dataTransfer.files)
    if (!paths.length) { say('Could not read the dropped files’ paths. Use Add files instead.', 'warn'); return }
    await addPathsTo(currentBinId, paths)
  }
  const onDropOnBin = useCallback(async (binId, payload) => {
    if (payload.ids) { if (payload.copy) await copyIds(payload.ids, binId); else await moveIds(payload.ids, binId); return }
    if (payload.files) {
      if (!canPick) { say(ADD_NEEDS_DESKTOP, 'info'); return }
      const paths = pathsFromFiles(payload.files); if (paths.length) await addPathsTo(binId, paths); else say('Could not read the dropped files’ paths.', 'warn')
    }
  }, [copyIds, moveIds, pathsFromFiles, addPathsTo, say, canPick])
  // 🚨 Every surface of the tab takes an OS drop while it is mounted (review
  // round 2, HIGH). The pane and the bin rows handle theirs above; a drop on
  // anything else — the rail's empty space, its caption, the inspector, the
  // footer — used to escape to Chromium's default, which navigates the whole
  // window to the file. Dropped anywhere else, the files go to the current
  // bin (or a new one), which is what "drop a folder anywhere on this page"
  // promises.
  const dropAnywhereRef = useRef(null)
  dropAnywhereRef.current = {
    // BC3: a drop is taken only where a computer can pick the file; in a
    // browser it is answered with the sentence (no silent nothing).
    canWrite: canWrite && canPick,
    saysWhy: canWrite && !canPick,
    onPaths: (paths) => addPathsTo(currentBinId, paths),
    fromFiles: pathsFromFiles,
    complain: () => say('Could not read the dropped files’ paths. Use Add files instead.', 'warn'),
    needsDesktop: () => say(ADD_NEEDS_DESKTOP, 'info'),
  }
  useEffect(() => {
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')
    const over = (e) => { if (!hasFiles(e)) return; if (!e.defaultPrevented) e.dataTransfer.dropEffect = dropAnywhereRef.current.canWrite ? 'link' : 'none'; e.preventDefault() }
    const drop = (e) => {
      if (!hasFiles(e)) return
      const handled = e.defaultPrevented
      e.preventDefault()
      if (handled) return
      if (!dropAnywhereRef.current.canWrite) { if (dropAnywhereRef.current.saysWhy) dropAnywhereRef.current.needsDesktop(); return }
      const paths = dropAnywhereRef.current.fromFiles(e.dataTransfer.files)
      if (paths.length) dropAnywhereRef.current.onPaths(paths); else dropAnywhereRef.current.complain()
    }
    document.addEventListener('dragover', over)
    document.addEventListener('drop', drop)
    return () => { document.removeEventListener('dragover', over); document.removeEventListener('drop', drop) }
  }, [])

  // ── BC2 (item 6): a whole location this computer cannot reach ──
  // Named once, with its clip count, from what the desktop answered when
  // the company's locations were registered (binsInfo.locations).
  const unreachable = useMemo(() => {
    if (!desktopCloud) return []
    const counts = new Map()
    for (const f of offlineAll) if (f.location_id) counts.set(f.location_id, (counts.get(f.location_id) || 0) + 1)
    return (ctx?.binsInfo?.locations || [])
      .filter(st => st && st.status !== 'refused' && st.reachable === false && st.connected !== false && counts.get(st.id))
      .map(st => ({ st, loc: locationById.get(st.id) || { id: st.id, name: 'A footage location' }, count: counts.get(st.id) }))
  }, [desktopCloud, offlineAll, ctx?.binsInfo?.locations, locationById])
  // Review round 1: a location this computer's person has not agreed to
  // connect to — never contacted until they do. Its own notice, first.
  const notConnected = useMemo(() => {
    if (!desktopCloud) return []
    const counts = new Map()
    for (const f of offlineAll) if (f.location_id) counts.set(f.location_id, (counts.get(f.location_id) || 0) + 1)
    return (ctx?.binsInfo?.locations || [])
      .filter(st => st && st.status !== 'refused' && st.connected === false && counts.get(st.id))
      .map(st => ({ st, loc: locationById.get(st.id) || { id: st.id, name: 'A footage location', unc_path: st.unc_path }, count: counts.get(st.id) }))
  }, [desktopCloud, offlineAll, ctx?.binsInfo?.locations, locationById])
  const [notConnectedDismissed, setNotConnectedDismissed] = useState(false)
  const [connectBusy, setConnectBusy] = useState(false)
  const connectOne = useCallback(async () => {
    const one = notConnected[0]
    if (!one || typeof ctx?.connectBinLocation !== 'function') return
    setConnectBusy(true)
    try {
      const r = await ctx.connectBinLocation(one.loc.id)
      if (!r?.canceled) say(`"${one.loc.name}" is connected on this computer.`, 'ok', 5000)
    } catch (e) { say(e?.message || String(e), 'error') }
    finally { setConnectBusy(false) }
  }, [notConnected, ctx, say])
  const [unreachableDismissed, setUnreachableDismissed] = useState(false)
  const [reachBusy, setReachBusy] = useState(false)
  const pickOneUnreachable = useCallback(async () => {
    const one = unreachable[0]
    if (!one || typeof ctx?.pickBinLocationLocalPath !== 'function') return
    setReachBusy(true)
    try {
      const r = await ctx.pickBinLocationLocalPath(one.loc.id)
      if (!r?.canceled) say(`"${one.loc.name}" is set for this computer.`, 'ok', 5000)
    } catch (e) { say(e?.message || String(e), 'error') }
    finally { setReachBusy(false) }
  }, [unreachable, ctx, say])

  // ── BC2 (B4): pictures to the cloud, while the company allows it ──
  // The catch-up for clips added while the switch was off: counted from the
  // rows this computer reaches that have no picture in the cloud.
  // Review round 1: a clip whose picture could not be made on this computer
  // (no decoder for it) is not counted again after a catch-up, or the offer
  // would never go.
  const [noPictureHere, setNoPictureHere] = useState(() => new Set())
  const posterCatchUp = useMemo(
    () => (desktopCloud && ctx?.binsInfo?.remoteViewing === true ? files.filter(f => needsCloudPoster(f) && !noPictureHere.has(f.id)).length : 0),
    [desktopCloud, ctx?.binsInfo?.remoteViewing, files, noPictureHere],
  )
  const [catchUpDismissed, setCatchUpDismissed] = useState(false)
  const [catchUpBusy, setCatchUpBusy] = useState(false)
  const uploadBinFilePosters = ctx?.uploadBinFilePosters
  const runCatchUp = useCallback(async () => {
    if (typeof uploadBinFilePosters !== 'function') return
    setCatchUpBusy(true)
    try {
      const r = await uploadBinFilePosters(null)
      if (r?.failedIds?.length) setNoPictureHere(s => new Set([...s, ...r.failedIds]))
      if (r?.refused) return
      const parts = [`Uploaded ${r.uploaded} picture${r.uploaded === 1 ? '' : 's'}`]
      if (r.failed) parts.push(`${r.failed} could not be made on this computer`)
      say(parts.join(' · ') + '.', r.failed ? 'warn' : 'ok')
    } catch (e) { say(e?.message || String(e), 'error') }
    finally { setCatchUpBusy(false) }
  }, [uploadBinFilePosters, say])

  // ── Filters UI data ──
  const filterValues = useMemo(() => ({
    cameras: distinctValues(scopeFiles, 'camera'),
    days: distinctValues(scopeFiles, 'shoot_day'),
    tags: distinctValues(scopeFiles, 'tags'),
    sceneIds: distinctValues(scopeFiles, 'scene_id'),
    types: MEDIA_TYPES.filter(t => scopeFiles.some(f => f.media_type === t)),
  }), [scopeFiles])
  const toggleIn = (key, value) => setFilters(f => { const list = f[key] || []; return { ...f, [key]: list.includes(value) ? list.filter(v => v !== value) : [...list, value] } })
  const countWhere = (pred) => scopeFiles.filter(pred).length

  // ── Render ──
  if (!supports) {
    return (
      <div className="h-full w-full" style={{ backgroundColor: C.bg }}>
        <EmptyState Icon={Clapperboard} title="Bins live on the desktop"
          body="Bins reference footage where it sits on this machine's drives, so they need the desktop app in Local Server mode (Settings → Storage → Storage Backend → Local Server). In cloud mode there is nothing to show here yet." />
      </div>
    )
  }

  const noBins = bins.length === 0
  const inspectorRows = selectedRows
  const showBinColumn = !currentBinId || includeNested

  return (
    <div className="h-full w-full flex flex-col" style={{ backgroundColor: C.bg }}>
      {/* ── Notice ── */}
      {(notice || loadError) && (
        // The in-flow strip is the kit's Banner (C8): one tone each, the icon in
        // the tone, the words in the ink.
        <Banner className="flex-shrink-0"
          tone={(notice?.kind === 'error' || loadError) ? 'danger' : notice?.kind === 'warn' ? 'warning' : notice?.kind === 'ok' ? 'success' : 'info'}
          Icon={(notice?.kind === 'error' || loadError) ? AlertTriangle : notice?.kind === 'ok' ? Check : undefined}
          action={<>
            {loadError && <Btn small onClick={load}>Retry</Btn>}
            <IconBtn Icon={X} title="Dismiss" onClick={() => { setNotice(null); setLoadError(null) }} />
          </>}>
          <span className="block truncate">{loadError ? `Could not load the bins: ${loadError}` : notice?.text}</span>
        </Banner>
      )}

      {/* BC3 (B5): in a browser, ONE notice says what this tab is and what
          needs the desktop app — adding clips and playing them — once, in
          place of a disabled Add, a dead preview and a count of clips "not on
          this computer" that would be all of them. Dismissed, it stays
          dismissed for the session (every page stays mounted).
          Laws of UX: Selective attention and Cognitive load (one sentence at
          the top, not a reason on every control); Paradox of the active user
          (the catalogue is usable at once; the notice names the one thing to
          go elsewhere for). */}
      {catalogue && !noticeDismissed && (
        <Banner className="flex-shrink-0" tone="info" Icon={Monitor} data-testid="catalogue-notice"
          action={<IconBtn Icon={X} title="Got it" onClick={() => setNoticeDismissed(true)} />}>
          <span className="block">{CATALOGUE_SENTENCE}</span>
        </Banner>
      )}

      {/* BC2 (item 6): a whole location out of reach — one notice naming it,
          not one per clip — with the per-computer question beside it. */}
      {notConnected.length > 0 && !notConnectedDismissed && (
        <Banner className="flex-shrink-0" tone="info" Icon={Unplug} data-testid="not-connected"
          action={<>
            {notConnected.length === 1
              ? <Btn small primary disabled={connectBusy} onClick={connectOne} title={CONNECT_TITLE}>{CONNECT_LABEL}</Btn>
              : <Btn small onClick={() => setRelinkOpen(true)}>Choose which to connect…</Btn>}
            <IconBtn Icon={X} title="Not now" onClick={() => setNotConnectedDismissed(true)} />
          </>}>
          <span className="block">
            {notConnectedSentence(notConnected.map(u => u.loc.name), notConnected.length === 1 ? notConnected[0].loc.unc_path : null)}
          </span>
        </Banner>
      )}

      {unreachable.length > 0 && !unreachableDismissed && (
        <Banner className="flex-shrink-0" tone="warning" Icon={Unplug}
          action={<>
            {unreachable.length === 1
              ? <Btn small disabled={reachBusy} onClick={pickOneUnreachable}>{unreachable[0].st?.local_path ? 'Choose another folder…' : 'Where is it on this computer?'}</Btn>
              : <Btn small onClick={() => setRelinkOpen(true)}>Choose where they are…</Btn>}
            <IconBtn Icon={X} title="Not now" onClick={() => setUnreachableDismissed(true)} />
          </>}>
          <span className="block">
            {unreachableWords(unreachable.map(u => u.loc.name))} not reachable from this computer, so {unreachable.reduce((s, u) => s + u.count, 0) === 1 ? 'its clip cannot' : 'their clips cannot'} be played here.
          </span>
        </Banner>
      )}

      {/* BC2 (B4): the switch turned on after clips were added — offer the
          catch-up, the count named. Only on the desktop signed in (it is
          the computer that has the pictures) and only while it is on. */}
      {posterCatchUp > 0 && !catchUpDismissed && (
        <Banner className="flex-shrink-0" tone="info" Icon={UploadCloud}
          action={<>
            <Btn small primary disabled={catchUpBusy} onClick={runCatchUp}>
              {catchUpBusy ? 'Uploading…' : `Upload pictures for ${posterCatchUp} clip${posterCatchUp === 1 ? '' : 's'}`}
            </Btn>
            <IconBtn Icon={X} title="Not now" onClick={() => setCatchUpDismissed(true)} />
          </>}>
          <span className="block">
            {posterCatchUp === 1 ? 'One clip this computer reaches has' : `${posterCatchUp} clips this computer reaches have`} no picture in the cloud yet, so teammates who cannot reach the share see only {posterCatchUp === 1 ? 'its name' : 'their names'}.
          </span>
        </Banner>
      )}

      <div className="flex-1 min-h-0 flex">
        <BinTree
          bins={bins} counts={counts} offlineCounts={offlineCounts} currentBinId={currentBinId}
          onSelect={id => { setCurrentBinId(id); clearSelection() }}
          expanded={expanded} onToggleExpand={id => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })}
          onCreateBin={createBin} onRenameBin={renameBin} onRenameStart={id => canWrite && setRenamingBinId(id)}
          renamingId={renamingBinId} onRenameEnd={() => setRenamingBinId(null)}
          onContextMenu={binMenu} onDropFiles={onDropOnBin} onDropBin={nestBin}
          allCount={files.length} allOffline={offlineAll.length} canWrite={canWrite} offlineWord={offlineWord}
          acceptsOsFiles={canWrite && canPick}
        />

        <div className="bn-pane flex-1 min-w-0 flex flex-col" ref={paneRef} tabIndex={0}
          onDragOver={onDragOverPane} onDragLeave={() => setDragOver(false)} onDrop={onDropPane}>
          {/* ── Toolbar ── */}
          <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0 flex-wrap" style={{ borderBottom: `1px solid ${C.line}` }}>
            <div className="min-w-0 flex items-center gap-2">
              {currentBin ? <ColorDot color={currentBin.color} size={10} /> : <Layers className="w-3.5 h-3.5" style={{ color: C.accentText }} />}
              <div className="min-w-0">
                <div className="text-label uppercase truncate" style={{ color: C.bright }} title={currentBin ? binPathLabel(bins, currentBin.id) : 'All files'}>
                  {currentBin ? currentBin.name : 'All files'}
                  {currentBin && <span className="ml-2 text-caption font-normal normal-case tracking-normal" style={{ color: C.dim }}>{BIN_KIND_META[currentBin.kind]?.label || ''}</span>}
                </div>
                <div className="text-caption tabular-nums flex items-center gap-2 flex-wrap" style={{ color: C.dim }}>
                  <span>{stats.count} file{stats.count === 1 ? '' : 's'}{rows.length !== stats.count ? ` · ${rows.length} shown` : ''}</span>
                  {stats.durationSec > 0 && <span>· {formatDuration(stats.durationSec)}</span>}
                  {stats.sizeBytes > 0 && <span>· {formatBytes(stats.sizeBytes)}</span>}
                  {stats.selects > 0 && <span style={{ color: C.green }}>· {stats.selects} select{stats.selects === 1 ? '' : 's'}</span>}
                  {stats.circled > 0 && <span style={{ color: C.accentText }}>· {stats.circled} circled</span>}
                  {/* BC3: no count where every row is "not on this computer" (a
                      browser): the notice says it once, and the relink is the
                      desktop's. */}
                  {stats.offline > 0 && !mode.nothingReachable && (
                    <button type="button" onClick={() => setRelinkOpen(true)} className="inline-flex items-center gap-1 hover:underline" style={{ color: C.amber }}
                      title={caps?.locations
                        ? `Find the footage locations of the clips not on this computer (${stats.offline} in this bin${offlineAll.length !== stats.offline ? `, ${offlineAll.length} in the project` : ''})`
                        : `Relink the project's offline files (${stats.offline} in this bin${offlineAll.length !== stats.offline ? `, ${offlineAll.length} in the project` : ''})`}>
                      · <Unplug className="w-3 h-3" /> {stats.offline} {offlineWord}
                    </button>
                  )}
                  {probing > 0 && <span className="inline-flex items-center gap-1">· <Loading className="text-caption" label={`reading ${probing}`} /></span>}
                  {/* BC3: the decoder is the desktop's; a browser has none to miss. */}
                  {ffmpeg === false && mode.canProbe && <span title="Drop ffmpeg.exe into resources/ffmpeg to get posters and columns for every format" style={{ color: C.dimmer }}>· no decoder</span>}
                </div>
              </div>
            </div>
            <div className="ml-auto flex items-center justify-end gap-1.5 flex-wrap">
              {currentBin && counts.get(currentBin.id) !== files.filter(f => f.bin_id === currentBin.id).length && (
                <Chip active={includeNested} onClick={() => setIncludeNested(v => !v)} title="Show files of nested bins too">nested</Chip>
              )}
              {/* BC3 (B5): where no computer can pick a file (a browser), the
                  one thing this control can do is the control — New bin —
                  rather than an Add menu of two disabled picks under a
                  reason (Hick's law: one step; no disabled control without
                  its reason, which the notice above carries once). The
                  desktop keeps its menu. */}
              {catalogue ? (
                <Btn primary small disabled={!canWrite} title={canWrite ? 'New bin' : writeReason || 'Read-only'} onClick={() => createBin(currentBinId)}>
                  <Plus className="w-3 h-3" /> New bin
                </Btn>
              ) : (
                <div className="relative">
                  <Btn primary small disabled={!canWrite} title={canWrite ? (canPick ? 'Add files or a folder' : ADD_NEEDS_DESKTOP) : writeReason || 'Read-only'}
                    onClick={e => setMenu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4, items: [
                      // BC2: where no computer can pick a file, the two picks
                      // say why instead of failing.
                      !canPick && { header: ADD_NEEDS_DESKTOP },
                      { label: 'Files…', Icon: FilePlus, disabled: !canPick, onClick: () => pickFiles(currentBinId) },
                      { label: 'Folder… (subfolders become nested bins)', Icon: FolderPlus, disabled: !canPick, onClick: () => pickFolder(currentBinId) },
                      { divider: true },
                      { label: 'New bin', Icon: Plus, onClick: () => createBin(currentBinId) },
                    ] })}>
                    <Plus className="w-3 h-3" /> Add <ChevronDown className="w-3 h-3" />
                  </Btn>
                </div>
              )}
              <div className="flex items-center rounded-control" style={{ border: `1px solid ${C.line}` }}>
                <IconBtn Icon={LayoutGrid} title="Frame view" active={view === 'grid'} onClick={() => setView('grid')} />
                <IconBtn Icon={ListIcon} title="List view" active={view === 'list'} onClick={() => setView('list')} />
              </div>
              {view === 'grid' && (
                <input type="range" min={120} max={360} step={20} value={tileWidth} onChange={e => setTileWidth(Number(e.target.value))} title="Tile size" aria-label="Tile size" className="w-20 accent-signal" />
              )}
              <IconBtn Icon={Filter} title="Filters" active={showFilters || filterCount > 0} onClick={() => setShowFilters(v => !v)} />
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: C.dim }} />
                {/* A native field in the kit's input class, not the kit Input:
                    Escape here CLEARS the search, where the kit Input's Escape
                    reverts to the value at focus (C1: the key keeps its job). */}
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search files…" title="Search name, slate, notes and path"
                  className="ui-input pl-6 pr-6 w-56" data-size="sm" aria-label="Search files"
                  onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur() } e.stopPropagation() }} />
                {search && <button type="button" onClick={() => setSearch('')} title="Clear the search" aria-label="Clear the search" className="absolute right-1.5 top-1/2 -translate-y-1/2" style={{ color: C.dim }}><X className="w-3 h-3" /></button>}
              </div>
              <Select value={sort.field} onChange={v => v && setSort(s => ({ ...s, field: v }))} title="Sort by" aria-label="Sort by" className="!w-auto"
                options={SORT_FIELDS.map(f => ({ value: f.id, label: f.label }))} />
              <IconBtn Icon={sort.dir === 'desc' ? ArrowDown : ArrowUp} title={sort.dir === 'desc' ? 'Descending' : 'Ascending'} onClick={() => setSort(s => ({ ...s, dir: s.dir === 'desc' ? 'asc' : 'desc' }))} />
            </div>
          </div>

          {/* ── Filters ── */}
          {showFilters && (
            <div className="flex items-center gap-1.5 px-3 py-2 flex-wrap flex-shrink-0" style={{ borderBottom: `1px solid ${C.line}`, backgroundColor: C.deep }}>
              {filterValues.types.map(t => <Chip key={t} active={filters.mediaTypes.includes(t)} onClick={() => toggleIn('mediaTypes', t)} color={MEDIA_TYPE_META[t].color + 'cc'} count={countWhere(f => f.media_type === t)}>{MEDIA_TYPE_META[t].label}</Chip>)}
              <span style={{ width: 8 }} />
              <Chip active={filters.flags.includes('select')} onClick={() => toggleIn('flags', 'select')} color={C.green} count={countWhere(f => f.review_flag === 'select')}><Check className="w-3 h-3" /> selects</Chip>
              <Chip active={filters.flags.includes('reject')} onClick={() => toggleIn('flags', 'reject')} color={C.red} count={countWhere(f => f.review_flag === 'reject')}><Ban className="w-3 h-3" /> rejects</Chip>
              <Chip active={filters.flags.includes('unflagged')} onClick={() => toggleIn('flags', 'unflagged')} count={countWhere(f => !f.review_flag || f.review_flag === 'unflagged')}>unflagged</Chip>
              <Chip active={filters.circled === true} onClick={() => setFilters(f => ({ ...f, circled: f.circled === true ? null : true }))} count={countWhere(f => f.circled)}><Circle className="w-3 h-3" /> circled</Chip>
              {/* BC3: no filter by reach where every row is out of it (a browser). */}
              {!mode.nothingReachable && <Chip active={filters.online === false} onClick={() => setFilters(f => ({ ...f, online: f.online === false ? null : false }))} color={C.amber} count={countWhere(f => f.online === false)}><Unplug className="w-3 h-3" /> {offlineWord}</Chip>}
              <span style={{ width: 8 }} />
              {COLORS.filter(c => scopeFiles.some(f => f.color === c)).map(c => <Chip key={c} active={filters.colors.includes(c)} onClick={() => toggleIn('colors', c)} title={`Colour ${c}`} count={countWhere(f => f.color === c)}><ColorDot color={c} size={8} /></Chip>)}
              {filterValues.cameras.map(c => <Chip key={`cam-${c}`} active={filters.cameras.includes(c)} onClick={() => toggleIn('cameras', c)} count={countWhere(f => f.camera === c)} className={DATA_CHIP}>{c} cam</Chip>)}
              {filterValues.days.map(d => <Chip key={`day-${d}`} active={filters.days.includes(d)} onClick={() => toggleIn('days', d)} count={countWhere(f => f.shoot_day === d)} className={DATA_CHIP}>{d}</Chip>)}
              {filterValues.sceneIds.map(s => <Chip key={`sc-${s}`} active={filters.sceneIds.includes(s)} onClick={() => toggleIn('sceneIds', s)} count={countWhere(f => f.scene_id === s)} className={DATA_CHIP}><Film className="w-3 h-3" /> {scenesById.get(s)?.name || 'scene'}</Chip>)}
              {filterValues.tags.map(t => <Chip key={`tag-${t}`} active={filters.tags.includes(t)} onClick={() => toggleIn('tags', t)} count={countWhere(f => (f.tags || []).includes(t))} className={DATA_CHIP}>#{t}</Chip>)}
              {filterCount > 0 && <Btn variant="ghost" small className="ml-2" onClick={() => setFilters(EMPTY_FILTERS)}>Clear {filterCount}</Btn>}
              {filterValues.types.length === 0 && <span className="text-dense" style={{ color: C.dimmer }}>Nothing to filter yet.</span>}
            </div>
          )}

          {/* ── Body ── */}
          <div className="flex-1 min-h-0 flex flex-col relative">
            {dragOver && (
              <div className="bn-drop absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                <div className="px-4 py-2 rounded-control text-label uppercase" style={{ backgroundColor: C.deep, color: C.bright, border: `1px solid ${C.accent}` }}>
                  Drop to add to {currentBin ? `"${currentBin.name}"` : 'a new bin'}
                </div>
              </div>
            )}
            {loading && files.length === 0 && bins.length === 0 ? (
              <div className="flex-1 flex items-center justify-center"><Loading label="Loading bins…" /></div>
            ) : noBins ? (
              <EmptyState Icon={Clapperboard} title="No bins yet"
                body={catalogue
                  ? CATALOGUE_EMPTY_BINS_SENTENCE
                  : 'A bin holds references to footage, stills, audio, graphics, VFX and documents where they sit on your drives. Start from a set, or drop a folder anywhere on this page.'}>
                {canWrite && <>
                  <Btn primary onClick={() => createStarter('types')}><Layers className="w-3 h-3" /> One bin per media type</Btn>
                  {scenes.length > 0 && <Btn onClick={() => createStarter('scenes')}><Film className="w-3 h-3" /> One bin per scene ({scenes.length})</Btn>}
                  <Btn onClick={() => createStarter('days')}><FolderPlus className="w-3 h-3" /> Dailies + Selects</Btn>
                  {canPick && <Btn onClick={() => pickFolder(null)}><FolderOpen className="w-3 h-3" /> Import a folder…</Btn>}
                  <Btn onClick={() => createBin(null)}><Plus className="w-3 h-3" /> Empty bin</Btn>
                </>}
                {!canWrite && <span className="text-dense" style={{ color: C.dim }}>{writeReason || 'Read-only'}</span>}
              </EmptyState>
            ) : scopeFiles.length === 0 ? (
              <EmptyState Icon={FilePlus} title={currentBin ? `"${currentBin.name}" is empty` : 'No files in any bin yet'}
                body={canPick
                  ? (caps?.locations
                    ? 'Add files or a folder from one of the company\'s footage locations, or drop them here from Explorer. Clips stay where they are on the share; the bin keeps a reference, a poster frame and the logging.'
                    : 'Add files or a folder, or drop them here from Explorer. Files stay where they are; the bin keeps a reference, a poster frame and the logging.')
                  : ADD_NEEDS_DESKTOP}>
                {canWrite && canPick && <>
                  <Btn primary onClick={() => pickFiles(currentBinId)}><FilePlus className="w-3 h-3" /> Add files…</Btn>
                  <Btn onClick={() => pickFolder(currentBinId)}><FolderPlus className="w-3 h-3" /> Add a folder…</Btn>
                </>}
              </EmptyState>
            ) : view === 'list' ? (
              <BinFileTable rows={rows} selection={selection} currentId={currentId} onRowClick={selectRow}
                onRowDoubleClick={id => canWrite && setRenamingFileId(id)} onContextMenu={fileMenu}
                thumbUrlFor={thumbUrlFor} binsById={binsById} showBin={showBinColumn} sort={sort}
                onSort={field => setSort(s => s.field === field ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' })}
                onInlinePatch={(id, patch) => patchIds([id], patch)} canWrite={canWrite} scenesById={scenesById}
                renamingId={renamingFileId} onRenameEnd={() => setRenamingFileId(null)} dragIdsFor={dragIdsFor} usageCount={usageCount}
                markOffline={!mode.nothingReachable} />
            ) : (
              // BC3: hover-scrub is off where nothing streams (streamUrlFor
              // answers null there); the dim is off where no row could be
              // reached (BinFileGrid says why).
              <BinFileGrid rows={rows} selection={selection} currentId={currentId} onRowClick={selectRow}
                onRowDoubleClick={id => canWrite && setRenamingFileId(id)} onContextMenu={fileMenu}
                thumbUrlFor={thumbUrlFor} streamUrlFor={mode.canStream ? streamUrlFor : null} tileWidth={tileWidth} canWrite={canWrite}
                dragIdsFor={dragIdsFor} binsById={binsById} showBin={showBinColumn} usageCount={usageCount}
                markOffline={!mode.nothingReachable} />
            )}
            {renamingFileId && view === 'grid' && (
              // Keyed by the file: F2 on another tile gets a fresh draft, not the
              // previous file's name (review round 2).
              <RenameBar key={renamingFileId} row={files.find(f => f.id === renamingFileId)} onCommit={name => { patchIds([renamingFileId], { display_name: name }); setRenamingFileId(null) }} onCancel={() => setRenamingFileId(null)} />
            )}
            {/* BC3: the picture large (Space where nothing can play), over the
                pane like the rename bar — the Bins keys keep working under it. */}
            {posterLarge && currentRow && !mode.canStream && (
              <PosterLarge row={currentRow} location={locationOf(currentRow)} catalogue={catalogue} onClose={() => setPosterLarge(false)} />
            )}

            {/* ── Selection bar ── */}
            {selection.size > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0 flex-wrap" style={{ borderTop: `1px solid ${C.line}`, backgroundColor: C.deep }}>
                <span className="text-dense tabular-nums mr-1" style={{ color: C.bright }}>{selection.size} selected</span>
                {shownStats && selection.size > 1 && <span className="text-dense font-mono tabular-nums" style={{ color: C.dim }}>{formatDuration(binStats(selectedRows).durationSec)} {formatBytes(binStats(selectedRows).sizeBytes)}</span>}
                {canWrite && <>
                  <Btn small onClick={() => patchSelection({ review_flag: 'select' })} title="Select (S)"><Check className="w-3 h-3" style={{ color: C.green }} /> Select</Btn>
                  <Btn small onClick={() => patchSelection({ review_flag: 'reject' })} title="Reject (R)"><Ban className="w-3 h-3" style={{ color: C.red }} /> Reject</Btn>
                  <Btn small onClick={() => patchSelection({ review_flag: 'unflagged' })} title="Unflag (U)">Unflag</Btn>
                  <Btn small onClick={() => patchSelection({ circled: !selectedRows.every(r => r.circled) })} title="Circle (C)"><Circle className="w-3 h-3" style={{ color: C.accentText }} /> Circle</Btn>
                  <Btn small onClick={() => openAssign([...selection])} title={shots.length ? 'Assign the selection to a shot (A)' : 'Add shots on the Scenes tab first'} disabled={!shots.length}><Clapperboard className="w-3 h-3" style={{ color: C.accentText }} /> Assign to shot</Btn>
                  <span className="inline-flex items-center gap-1 px-1">{COLORS.map((c, i) => <ColorDot key={c} color={c} size={10} onClick={() => patchSelection({ color: c })} title={`Colour ${c} (${i + 1})`} />)}<ColorDot color={null} size={10} onClick={() => patchSelection({ color: null })} title="No colour (0)" /></span>
                  <Btn small onClick={e => setMenu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top - 8 - Math.min(320, 28 * bins.length), items: [{ header: 'Move to' }, ...binTargets().map(t => ({ label: t.label, Icon: FolderInput, ColorDot: t.color || undefined, onClick: () => moveIds([...selection], t.id) }))] })} disabled={bins.length < 2}><FolderInput className="w-3 h-3" /> Move to</Btn>
                  <Btn small onClick={e => setMenu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top - 8 - Math.min(320, 28 * bins.length), items: [{ header: 'Copy to (as an instance)' }, ...binTargets().map(t => ({ label: t.label, Icon: Copy, onClick: () => copyIds([...selection], t.id) }))] })}><Copy className="w-3 h-3" /> Copy to</Btn>
                  <Btn small danger onClick={() => removeIds([...selection])} title="Remove from bin (Delete)"><Trash2 className="w-3 h-3" /> Remove</Btn>
                </>}
                <Btn variant="ghost" small className="ml-auto" onClick={clearSelection}>Clear <Kbd>Esc</Kbd></Btn>
              </div>
            )}
          </div>
        </div>

        <BinInspector rows={inspectorRows} scenes={scenes} shots={shots} allScenes={allScenes} allShots={allShots} homeOf={Array.isArray(ctx?.shotLists) ? homeOf : null}
          fps={fps} canWrite={canWrite} ffmpeg={ffmpeg}
          thumbUrlFor={thumbUrlFor} streamUrlFor={streamUrlFor}
          onPatch={patchSelection} onOpen={openFile} onProbe={probe} onRemove={removeIds} binPathFor={binPathFor}
          usage={usage} onAssign={openAssign} onUnassign={unassign} projectId={projectId} pageActive={pageActive}
          locationOf={locationOf} addedByOf={addedByOf}
          canStream={mode.canStream} canOpen={mode.canOpen} canProbe={mode.canProbe} catalogue={catalogue} />
      </div>

      {/* No footer bar (UI overhaul Q10, "no shortcut bar anywhere"). Its keys
          are in Help → Shortcuts & Tips (rabbitHelpContent's BINS_SHORTCUTS)
          and in the titles of the controls that act on a selection; its
          project count is the bin tree's footer; the adapter dot and the
          presence pill it made room for live in ProjectContextBar (B1). */}

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {removeAsk && (
        <Modal title={`Remove ${removeAsk.length} files from the bin?`} width="confirm" onClose={() => setRemoveAsk(null)}
          footer={<>
            {/* Cancel takes the first focus, as every W9 confirm does (DashboardTasksView). */}
            <Btn autoFocus onClick={() => setRemoveAsk(null)}>Cancel</Btn>
            <Btn danger onClick={() => { const ids = removeAsk; setRemoveAsk(null); doRemoveIds(ids) }}><Trash2 className="w-3 h-3" /> Remove {removeAsk.length} files</Btn>
          </>}>
          <p className="text-dense" style={{ color: C.text }}>The files on disk stay where they are. Undo is in the toast.</p>
        </Modal>
      )}
      {addDlg && <AddFilesDialog key={addDlg.planRev || 0} bin={addDlg.bin} plan={addDlg.plan} scenes={scenes} busy={addBusy} progress={addProgress} error={addError} onConfirm={confirmAdd} onCancel={() => { if (!addBusy) { setAddDlg(null); setAddError(null) } }}
        onNameLocation={ctx?.binsInfo?.capabilities?.locations ? nameShareAsLocation : null} />}
      {deleteDlg && <DeleteBinDialog bin={deleteDlg} bins={bins} files={files} busy={deleteBusy} error={deleteError} onConfirm={confirmDelete} onCancel={() => { if (!deleteBusy) { setDeleteDlg(null); setDeleteError(null) } }} />}
      {/* BC2 (item 6): on the cloud a clip is found again by telling THIS
          computer where its location is — never by rewriting its path for
          everyone. The signed-out desktop keeps its dialog (B12). */}
      {relinkOpen && caps?.locations && (
        <RelinkLocationsDialog offlineRows={offlineAll} locations={ctx?.binLocations || []} locationStatus={ctx?.binsInfo?.locations || []}
          onPickLocal={(id) => ctx.pickBinLocationLocalPath(id)} onForgetLocal={(id) => ctx.forgetBinLocationLocalPath(id)}
          onConnect={typeof ctx?.connectBinLocation === 'function' ? (id) => ctx.connectBinLocation(id) : null}
          onClose={() => setRelinkOpen(false)} />
      )}
      {relinkOpen && !caps?.locations && (
        <RelinkBinsDialog offlineRows={offlineAll} roots={roots}
          onPickFolder={async () => { const r = await ctx.pickBinFolder('Choose the folder the files moved to'); return r?.path || null }}
          onScan={(p) => ctx.binRelinkScan(p)}
          onApply={async (m) => { const r = await ctx.binRelinkApply(m); setThumbRev(v => v + 1); return r }}
          onForgetRoot={canWrite ? (id) => ctx.removeBinRoot(id) : null}
          onClose={() => setRelinkOpen(false)} />
      )}
      {assignDlg && (
        <AssignToShotDialog files={assignDlg} binFiles={files} scenes={scenes} shots={shots} allScenes={allScenes} allShots={allShots} homeOf={Array.isArray(ctx?.shotLists) ? homeOf : null}
          shotTakes={shotTakes} thumbUrlFor={thumbUrlFor} busy={assignBusy} error={assignError}
          onConfirm={confirmAssign} onCancel={() => { if (!assignBusy) { setAssignDlg(null); setAssignError(null) } }} />
      )}
    </div>
  )
}

function RenameBar({ row, onCommit, onCancel }) {
  const [v, setV] = useState(row?.display_name || '')
  if (!row) return null
  return (
    <div className="absolute left-3 right-3 bottom-3 z-30 flex items-center gap-2 px-3 py-2 rounded-float shadow-float" style={{ backgroundColor: C.panel, border: `1px solid ${C.accent}` }}>
      <Edit3 className="w-3 h-3" style={{ color: C.accentText }} />
      <span className="text-label uppercase" style={{ color: C.dim }}>Rename</span>
      <input autoFocus value={v} onChange={e => setV(e.target.value)} aria-label="New name"
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { const t = v.trim(); if (t) onCommit(t); else onCancel() } if (e.key === 'Escape') onCancel() }}
        className="ui-input flex-1" data-size="sm" />
      <span className="text-dense font-mono truncate" style={{ color: C.dimmer, maxWidth: 240 }}>{row.original_name}</span>
      <Btn small primary onClick={() => { const t = v.trim(); if (t) onCommit(t); else onCancel() }}>Save</Btn>
      <Btn small onClick={onCancel}>Cancel</Btn>
    </div>
  )
}
