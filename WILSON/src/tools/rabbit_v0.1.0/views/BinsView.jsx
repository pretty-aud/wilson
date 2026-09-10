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
// clears the selection, Space plays the preview.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, FolderPlus, FilePlus, LayoutGrid, List as ListIcon, Search, X, Filter, ChevronDown,
  Unplug, Link2, Check, Ban, Circle, Trash2, FolderInput, Copy, ExternalLink, FolderOpen, RefreshCw,
  Edit3, ArrowUp, ArrowDown, CornerLeftUp, Layers, Clapperboard, AlertTriangle, Film,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useProjectAccess } from '../state/useProjectAccess'
import { C, Btn, IconBtn, Chip, Menu, EmptyState, Kbd, Spinner, MediaTag, ColorDot } from './bins/binUi'
import BinTree from './bins/BinTree'
import BinFileTable from './bins/BinFileTable'
import BinFileGrid from './bins/BinFileGrid'
import BinInspector from './bins/BinInspector'
import AddFilesDialog from './bins/AddFilesDialog'
import DeleteBinDialog from './bins/DeleteBinDialog'
import RelinkBinsDialog from './bins/RelinkBinsDialog'
import { matchMissingFiles } from '../components/relinkMatcher'
import {
  descendantIds, countsByBin, binPathLabel, filterBinFiles, sortBinFiles, SORT_FIELDS, EMPTY_FILTERS,
  activeFilterCount, binStats, distinctValues, stepId, rangeIds,
} from '../bins/binSelectors'
import { MEDIA_TYPES, MEDIA_TYPE_META, COLORS, BIN_KINDS, BIN_KIND_META, formatDuration, formatBytes } from '../bins/binMedia'

const TYPE_STARTER = [
  { name: 'Footage', kind: 'footage', color: 'orange' },
  { name: 'Audio', kind: 'audio', color: 'green' },
  { name: 'Stills', kind: 'stills', color: 'cyan' },
  { name: 'Graphics', kind: 'graphics', color: 'pink' },
  { name: 'VFX', kind: 'vfx', color: 'purple' },
  { name: 'Selects', kind: 'selects', color: 'yellow' },
]

export default function BinsView() {
  const ctx = useRabbit()
  const { canWrite, writeReason } = useProjectAccess()
  const supports = !!ctx?.supportsBins
  const projectId = ctx?.activeProjectId
  const bins = ctx?.bins || []
  const files = ctx?.binFiles || []
  const roots = ctx?.binRoots || []
  const scenes = ctx?.scenes || []
  const shots = ctx?.shots || []
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
  const [thumbRev, setThumbRev] = useState(0)
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const paneRef = useRef(null)
  const autoRelinkRef = useRef(null)
  const noticeTimer = useRef(null)

  const say = useCallback((text, kind = 'info', ms = 7000) => {
    clearTimeout(noticeTimer.current)
    setNotice({ text, kind })
    if (ms) noticeTimer.current = setTimeout(() => setNotice(null), ms)
  }, [])
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  // ── Load: the list route is what carries `online` and the ffmpeg flag ──
  const refreshBins = ctx?.refreshBins
  const load = useCallback(async () => {
    if (!supports || !projectId || !refreshBins) return null
    setLoading(true); setLoadError(null)
    try { return await refreshBins() }
    catch (e) { setLoadError(e?.message || String(e)); return null }
    finally { setLoading(false) }
  }, [supports, projectId, refreshBins])

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
  const offlineCounts = useMemo(() => countsByBin(bins, files.filter(f => f.online === false)), [bins, files])
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
  const offlineAll = useMemo(() => files.filter(f => f.online === false), [files])
  const selectedRows = useMemo(() => rows.filter(r => selection.has(r.id)), [rows, selection])
  const scenesById = useMemo(() => new Map(scenes.map(s => [s.id, s])), [scenes])
  const filterCount = activeFilterCount(filters)

  // Selection survives only for rows that still exist here.
  useEffect(() => {
    setSelection(prev => {
      const next = new Set([...prev].filter(id => orderedIds.includes(id)))
      return next.size === prev.size ? prev : next
    })
    if (currentId && !orderedIds.includes(currentId)) setCurrentId(null)
  }, [orderedIds, currentId])

  const thumbUrlFor = useCallback((id) => ctx?.binFileThumbnailUrl?.(id, thumbRev), [ctx, thumbRev])
  const streamUrlFor = useCallback((id) => ctx?.binFileStreamUrl?.(id), [ctx])
  const binPathFor = useCallback((id) => binPathLabel(bins, id), [bins])

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

  const removeIds = useCallback(async (ids) => {
    if (!ids.length || !canWrite) return
    if (ids.length > 5 && !window.confirm(`Remove ${ids.length} files from the bin? The files on disk stay where they are. Undo is in the toast.`)) return
    try { await ctx.removeBinFiles(ids); clearSelection() }
    catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, canWrite, clearSelection, say])
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

  // ── Adding files ──
  const addPathsTo = useCallback(async (binId, paths) => {
    if (!paths?.length || !canWrite) return
    let bin = binsById.get(binId)
    // A dropped folder becomes a nested bin named after itself — unless no bin
    // is selected and the drop IS one folder, in which case that folder's name
    // becomes the new bin and its files go straight in (no "Day01 / Day01").
    let folderAsBin = true
    try {
      if (!bin) {
        const single = paths.length === 1 ? String(paths[0]) : null
        const leaf = single ? (single.split(/[\\/]/).filter(Boolean).pop() || '') : ''
        const looksLikeFile = /\.[A-Za-z0-9]{1,12}$/.test(leaf)
        const name = single && leaf && !looksLikeFile ? leaf : 'New bin'
        bin = await ctx.addBin({ name, kind: 'footage' })
        setCurrentBinId(bin.id)
        if (single && !looksLikeFile) folderAsBin = false
      }
      const plan = await ctx.prepareBinFiles(paths, { folderAsBin })
      if (!plan?.items?.length) { say('Nothing to add: no files were found at what was dropped.', 'warn'); return }
      setAddDlg({ bin, plan })
    } catch (e) { say(e?.message || String(e), 'error') }
  }, [ctx, canWrite, binsById, say])

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
    setAddBusy(true); setAddProgress(`Adding ${items.length} item${items.length === 1 ? '' : 's'}…`)
    try {
      const res = await ctx.addBinFiles(addDlg.bin.id, items, createSubBins)
      const added = (res.results || []).filter(r => r.status === 'added').length
      const missing = (res.results || []).filter(r => r.status === 'missing').length
      const other = (res.results || []).length - added - missing
      const parts = [`Added ${added} item${added === 1 ? '' : 's'} to "${addDlg.bin.name}"`]
      if (res.bins?.length) parts.push(`${res.bins.length} nested bin${res.bins.length === 1 ? '' : 's'} created`)
      if (missing) parts.push(`${missing} missing on disk`)
      if (other) parts.push(`${other} skipped`)
      say(parts.join(' · ') + '.', missing || other ? 'warn' : 'ok')
      setExpanded(s => new Set([...s, addDlg.bin.id]))
      setCurrentBinId(addDlg.bin.id)
      setSelection(new Set((res.created || []).map(r => r.id)))
      setAddDlg(null)
    } catch (e) { say(e?.message || String(e), 'error') }
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
    setDeleteBusy(true)
    try {
      const sub = descendantIds(bins, deleteDlg.id)
      await ctx.deleteBin(deleteDlg.id, { mode, target })
      if (currentBinId && sub.has(currentBinId)) setCurrentBinId(mode === 'move' ? target : null)
      setDeleteDlg(null)
    } catch (e) { say(e?.message || String(e), 'error') }
    finally { setDeleteBusy(false) }
  }, [deleteDlg, ctx, bins, currentBinId, say])

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
      canWrite && { header: 'Colour' },
      ...(canWrite ? COLORS.map((c, i) => ({ label: c, ColorDot: c, hint: String(i + 1), onClick: () => patchIds(ids, { color: c }) })) : []),
      canWrite && { label: 'No colour', hint: '0', onClick: () => patchIds(ids, { color: null }) },
      canWrite && { divider: true },
      canWrite && bins.length > 1 && { header: 'Move to' },
      ...(canWrite ? binTargets(new Set([row?.bin_id])).map(t => ({ label: t.label, Icon: FolderInput, ColorDot: t.color || undefined, onClick: () => moveIds(ids, t.id) })) : []),
      canWrite && { header: 'Copy to (as an instance)' },
      ...(canWrite ? binTargets().map(t => ({ label: t.label, Icon: Copy, onClick: () => copyIds(ids, t.id) })) : []),
      canWrite && { divider: true },
      n === 1 && { label: 'Open in default app', Icon: ExternalLink, disabled: row?.online === false, onClick: () => openFile(id, false) },
      n === 1 && { label: 'Reveal in Explorer', Icon: FolderOpen, disabled: row?.online === false, onClick: () => openFile(id, true) },
      n === 1 && canWrite && { label: 'Read columns again', Icon: RefreshCw, disabled: row?.online === false, onClick: () => probe(id) },
      n === 1 && canWrite && { label: 'Rename', Icon: Edit3, hint: 'F2', onClick: () => setRenamingFileId(id) },
      canWrite && { divider: true },
      canWrite && { label: n === 1 ? 'Remove from bin' : `Remove ${n} from bin`, Icon: Trash2, danger: true, hint: 'Del', onClick: () => removeIds(ids) },
    ]
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [targetIds, selection, files, canWrite, bins, binTargets, patchIds, moveIds, copyIds, openFile, probe, removeIds])

  const binMenu = useCallback((e, bin) => {
    const sub = descendantIds(bins, bin.id)
    const items = [
      { header: binPathLabel(bins, bin.id) },
      canWrite && { label: 'Add files…', Icon: FilePlus, onClick: () => pickFiles(bin.id) },
      canWrite && { label: 'Add a folder…', Icon: FolderPlus, onClick: () => pickFolder(bin.id) },
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
  }, [bins, canWrite, pickFiles, pickFolder, createBin, patchBin, shiftBin, nestBin])

  // ── Keyboard ──
  const onKeyDown = useCallback((e) => {
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    if (menu || addDlg || deleteDlg || relinkOpen) return
    const cols = view === 'grid' ? Math.max(1, Math.floor(((paneRef.current?.clientWidth || 800) - 24) / (tileWidth + 12))) : 1
    const move = (steps) => {
      const next = stepId(orderedIds, currentId, steps)
      if (!next) return
      e.preventDefault()
      if (e.shiftKey) { if (!anchorRef.current) anchorRef.current = currentId || next; setSelection(new Set(rangeIds(orderedIds, anchorRef.current, next))) }
      else { setSelection(new Set([next])); anchorRef.current = next }
      setCurrentId(next)
    }
    const ids = [...selection]
    switch (e.key) {
      case 'ArrowDown': return move(cols)
      case 'ArrowUp': return move(-cols)
      case 'ArrowRight': return view === 'grid' ? move(1) : undefined
      case 'ArrowLeft': return view === 'grid' ? move(-1) : undefined
      case 'Home': return move(-orderedIds.length)
      case 'End': return move(orderedIds.length)
      case 'Escape': e.preventDefault(); return clearSelection()
      case 'a': case 'A': if (e.ctrlKey || e.metaKey) { e.preventDefault(); selectAll() } return
      case 's': case 'S': if (!e.ctrlKey && ids.length) { e.preventDefault(); patchIds(ids, { review_flag: 'select' }) } return
      case 'r': case 'R': if (!e.ctrlKey && ids.length) { e.preventDefault(); patchIds(ids, { review_flag: 'reject' }) } return
      case 'u': case 'U': if (!e.ctrlKey && ids.length) { e.preventDefault(); patchIds(ids, { review_flag: 'unflagged' }) } return
      case 'c': case 'C': if (!e.ctrlKey && ids.length) { e.preventDefault(); const cur = files.find(f => f.id === (currentId || ids[0])); patchIds(ids, { circled: !cur?.circled }) } return
      case 'Delete': case 'Backspace': if (ids.length) { e.preventDefault(); removeIds(ids) } return
      case 'Enter': case 'F2': if (currentId && canWrite) { e.preventDefault(); setRenamingFileId(currentId) } return
      default:
        if (/^[0-8]$/.test(e.key) && ids.length && !e.ctrlKey) { e.preventDefault(); patchIds(ids, { color: e.key === '0' ? null : COLORS[Number(e.key) - 1] }) }
    }
  }, [menu, addDlg, deleteDlg, relinkOpen, view, tileWidth, orderedIds, currentId, selection, files, canWrite, clearSelection, selectAll, patchIds, removeIds])

  // ── Drag and drop from the OS onto the files pane ──
  const onDragOverPane = (e) => {
    const types = e.dataTransfer?.types || []
    if (types.includes('Files') && canWrite) { e.preventDefault(); e.dataTransfer.dropEffect = 'link'; setDragOver(true) }
  }
  const onDropPane = async (e) => {
    setDragOver(false)
    const types = e.dataTransfer?.types || []
    if (!types.includes('Files')) return
    e.preventDefault()
    const paths = pathsFromFiles(e.dataTransfer.files)
    if (!paths.length) { say('Could not read the dropped files’ paths. Use Add files instead.', 'warn'); return }
    await addPathsTo(currentBinId, paths)
  }
  const onDropOnBin = useCallback(async (binId, payload) => {
    if (payload.ids) { if (payload.copy) await copyIds(payload.ids, binId); else await moveIds(payload.ids, binId); return }
    if (payload.files) { const paths = pathsFromFiles(payload.files); if (paths.length) await addPathsTo(binId, paths); else say('Could not read the dropped files’ paths.', 'warn') }
  }, [copyIds, moveIds, pathsFromFiles, addPathsTo, say])

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
    <div className="h-full w-full flex flex-col" style={{ backgroundColor: C.bg }} onKeyDown={onKeyDown}>
      {/* ── Notice ── */}
      {(notice || loadError) && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-[10.5px] font-mono flex-shrink-0"
          style={{
            borderBottom: `1px solid ${C.line}`,
            color: (notice?.kind === 'error' || loadError) ? '#fca5a5' : notice?.kind === 'warn' ? C.amber : notice?.kind === 'ok' ? C.green : C.text,
            backgroundColor: C.deep,
          }}>
          {(notice?.kind === 'error' || loadError) ? <AlertTriangle className="w-3 h-3" /> : notice?.kind === 'ok' ? <Check className="w-3 h-3" /> : null}
          <span className="flex-1 truncate">{loadError ? `Could not load the bins: ${loadError}` : notice?.text}</span>
          {loadError && <Btn small onClick={load}>Retry</Btn>}
          <button type="button" onClick={() => { setNotice(null); setLoadError(null) }} className="p-0.5" style={{ color: C.dim }}><X className="w-3 h-3" /></button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <BinTree
          bins={bins} counts={counts} offlineCounts={offlineCounts} currentBinId={currentBinId}
          onSelect={id => { setCurrentBinId(id); clearSelection() }}
          expanded={expanded} onToggleExpand={id => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })}
          onCreateBin={createBin} onRenameBin={renameBin} onRenameStart={id => canWrite && setRenamingBinId(id)}
          renamingId={renamingBinId} onRenameEnd={() => setRenamingBinId(null)}
          onContextMenu={binMenu} onDropFiles={onDropOnBin} onDropBin={nestBin}
          allCount={files.length} allOffline={offlineAll.length} canWrite={canWrite}
        />

        <div className="flex-1 min-w-0 flex flex-col" ref={paneRef} tabIndex={0} style={{ outline: 'none' }}
          onDragOver={onDragOverPane} onDragLeave={() => setDragOver(false)} onDrop={onDropPane}>
          {/* ── Toolbar ── */}
          <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0 flex-wrap" style={{ borderBottom: `1px solid ${C.line}` }}>
            <div className="min-w-0 flex items-center gap-2">
              {currentBin ? <ColorDot color={currentBin.color} size={10} /> : <Layers className="w-3.5 h-3.5" style={{ color: C.accentText }} />}
              <div className="min-w-0">
                <div className="text-[12px] font-mono uppercase tracking-wider truncate" style={{ color: C.bright }} title={currentBin ? binPathLabel(bins, currentBin.id) : 'All files'}>
                  {currentBin ? currentBin.name : 'All files'}
                  {currentBin && <span className="ml-2 text-[9.5px] normal-case tracking-normal" style={{ color: C.dim }}>{BIN_KIND_META[currentBin.kind]?.label || ''}</span>}
                </div>
                <div className="text-[9.5px] font-mono tabular-nums flex items-center gap-2 flex-wrap" style={{ color: C.dim }}>
                  <span>{stats.count} file{stats.count === 1 ? '' : 's'}{rows.length !== stats.count ? ` · ${rows.length} shown` : ''}</span>
                  {stats.durationSec > 0 && <span>· {formatDuration(stats.durationSec)}</span>}
                  {stats.sizeBytes > 0 && <span>· {formatBytes(stats.sizeBytes)}</span>}
                  {stats.selects > 0 && <span style={{ color: C.green }}>· {stats.selects} select{stats.selects === 1 ? '' : 's'}</span>}
                  {stats.circled > 0 && <span style={{ color: C.accentText }}>· {stats.circled} circled</span>}
                  {stats.offline > 0 && (
                    <button type="button" onClick={() => setRelinkOpen(true)} className="inline-flex items-center gap-1 hover:underline" style={{ color: C.amber }} title="Relink offline files">
                      · <Unplug className="w-3 h-3" /> {stats.offline} offline
                    </button>
                  )}
                  {probing > 0 && <span className="inline-flex items-center gap-1" style={{ color: C.muted }}>· <Spinner size={9} /> reading {probing}</span>}
                  {ffmpeg === false && <span title="Drop ffmpeg.exe into resources/ffmpeg to get posters and columns for every format" style={{ color: C.dimmer }}>· no decoder</span>}
                </div>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1.5 flex-wrap">
              {currentBin && counts.get(currentBin.id) !== files.filter(f => f.bin_id === currentBin.id).length && (
                <Chip active={includeNested} onClick={() => setIncludeNested(v => !v)} title="Show files of nested bins too">nested</Chip>
              )}
              <div className="relative">
                <Btn primary disabled={!canWrite} title={canWrite ? 'Add files or a folder' : writeReason || 'Read-only'}
                  onClick={e => setMenu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4, items: [
                    { label: 'Files…', Icon: FilePlus, onClick: () => pickFiles(currentBinId) },
                    { label: 'Folder… (subfolders become nested bins)', Icon: FolderPlus, onClick: () => pickFolder(currentBinId) },
                    { divider: true },
                    { label: 'New bin', Icon: Plus, onClick: () => createBin(currentBinId) },
                  ] })}>
                  <Plus className="w-3 h-3" /> Add <ChevronDown className="w-3 h-3" />
                </Btn>
              </div>
              <div className="flex items-center rounded-sm" style={{ border: `1px solid ${C.line}` }}>
                <IconBtn Icon={LayoutGrid} title="Frame view" active={view === 'grid'} onClick={() => setView('grid')} style={{ border: 'none' }} />
                <IconBtn Icon={ListIcon} title="List view" active={view === 'list'} onClick={() => setView('list')} style={{ border: 'none' }} />
              </div>
              {view === 'grid' && (
                <input type="range" min={120} max={360} step={20} value={tileWidth} onChange={e => setTileWidth(Number(e.target.value))} title="Tile size" className="w-20 accent-orange-600" />
              )}
              <IconBtn Icon={Filter} title="Filters" active={showFilters || filterCount > 0} onClick={() => setShowFilters(v => !v)} />
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: C.dim }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, slate, notes, path…"
                  className="pl-6 pr-6 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500 w-56"
                  style={{ backgroundColor: C.panel, color: C.text, border: `1px solid ${C.line}` }}
                  onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur() } e.stopPropagation() }} />
                {search && <button type="button" onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2" style={{ color: C.dim }}><X className="w-3 h-3" /></button>}
              </div>
              <select value={sort.field} onChange={e => setSort(s => ({ ...s, field: e.target.value }))} title="Sort by"
                className="py-1.5 px-2 text-[10.5px] font-mono rounded-sm focus:outline-none" style={{ backgroundColor: C.panel, color: C.text, border: `1px solid ${C.line}` }}>
                {SORT_FIELDS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
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
              <Chip active={filters.online === false} onClick={() => setFilters(f => ({ ...f, online: f.online === false ? null : false }))} color={C.amber} count={countWhere(f => f.online === false)}><Unplug className="w-3 h-3" /> offline</Chip>
              <span style={{ width: 8 }} />
              {COLORS.filter(c => scopeFiles.some(f => f.color === c)).map(c => <Chip key={c} active={filters.colors.includes(c)} onClick={() => toggleIn('colors', c)}><ColorDot color={c} size={8} /></Chip>)}
              {filterValues.cameras.map(c => <Chip key={`cam-${c}`} active={filters.cameras.includes(c)} onClick={() => toggleIn('cameras', c)}>{c} cam</Chip>)}
              {filterValues.days.map(d => <Chip key={`day-${d}`} active={filters.days.includes(d)} onClick={() => toggleIn('days', d)}>{d}</Chip>)}
              {filterValues.sceneIds.map(s => <Chip key={`sc-${s}`} active={filters.sceneIds.includes(s)} onClick={() => toggleIn('sceneIds', s)}><Film className="w-3 h-3" /> {scenesById.get(s)?.name || 'scene'}</Chip>)}
              {filterValues.tags.map(t => <Chip key={`tag-${t}`} active={filters.tags.includes(t)} onClick={() => toggleIn('tags', t)}>#{t}</Chip>)}
              {filterCount > 0 && <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="text-[10px] font-mono uppercase tracking-wider ml-2 hover:underline" style={{ color: C.accentText }}>clear {filterCount}</button>}
              {filterValues.types.length === 0 && <span className="text-[10px] font-mono" style={{ color: C.dimmer }}>Nothing to filter yet.</span>}
            </div>
          )}

          {/* ── Body ── */}
          <div className="flex-1 min-h-0 flex flex-col relative">
            {dragOver && (
              <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none" style={{ backgroundColor: 'rgba(234,88,12,0.12)', border: `2px dashed ${C.accent}` }}>
                <div className="px-4 py-2 rounded-sm text-[11px] font-mono uppercase tracking-wider" style={{ backgroundColor: C.deep, color: C.bright, border: `1px solid ${C.accentBorder}` }}>
                  Drop to add to {currentBin ? `"${currentBin.name}"` : 'a new bin'}
                </div>
              </div>
            )}
            {loading && files.length === 0 && bins.length === 0 ? (
              <div className="flex-1 flex items-center justify-center gap-2 text-[11px] font-mono" style={{ color: C.muted }}><Spinner /> Loading bins…</div>
            ) : noBins ? (
              <EmptyState Icon={Clapperboard} title="No bins yet"
                body="A bin holds references to footage, stills, audio, graphics, VFX and documents where they sit on your drives. Start from a set, or drop a folder anywhere on this page.">
                {canWrite && <>
                  <Btn primary onClick={() => createStarter('types')}><Layers className="w-3 h-3" /> One bin per media type</Btn>
                  {scenes.length > 0 && <Btn onClick={() => createStarter('scenes')}><Film className="w-3 h-3" /> One bin per scene ({scenes.length})</Btn>}
                  <Btn onClick={() => createStarter('days')}><FolderPlus className="w-3 h-3" /> Dailies + Selects</Btn>
                  <Btn onClick={() => pickFolder(null)}><FolderOpen className="w-3 h-3" /> Import a folder…</Btn>
                  <Btn onClick={() => createBin(null)}><Plus className="w-3 h-3" /> Empty bin</Btn>
                </>}
                {!canWrite && <span className="text-[10.5px] font-mono" style={{ color: C.dim }}>{writeReason || 'Read-only'}</span>}
              </EmptyState>
            ) : scopeFiles.length === 0 ? (
              <EmptyState Icon={FilePlus} title={currentBin ? `"${currentBin.name}" is empty` : 'No files in any bin yet'}
                body="Add files or a folder, or drop them here from Explorer. Files stay where they are; the bin keeps a reference, a poster frame and the logging.">
                {canWrite && <>
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
                renamingId={renamingFileId} onRenameEnd={() => setRenamingFileId(null)} dragIdsFor={dragIdsFor} />
            ) : (
              <BinFileGrid rows={rows} selection={selection} currentId={currentId} onRowClick={selectRow}
                onRowDoubleClick={id => canWrite && setRenamingFileId(id)} onContextMenu={fileMenu}
                thumbUrlFor={thumbUrlFor} streamUrlFor={streamUrlFor} tileWidth={tileWidth} canWrite={canWrite}
                dragIdsFor={dragIdsFor} binsById={binsById} showBin={showBinColumn} />
            )}
            {renamingFileId && view === 'grid' && (
              <RenameBar row={files.find(f => f.id === renamingFileId)} onCommit={name => { patchIds([renamingFileId], { display_name: name }); setRenamingFileId(null) }} onCancel={() => setRenamingFileId(null)} />
            )}

            {/* ── Selection bar ── */}
            {selection.size > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0 flex-wrap" style={{ borderTop: `1px solid ${C.line}`, backgroundColor: C.deep }}>
                <span className="text-[10.5px] font-mono tabular-nums mr-1" style={{ color: C.bright }}>{selection.size} selected</span>
                {shownStats && selection.size > 1 && <span className="text-[9.5px] font-mono" style={{ color: C.dim }}>{formatDuration(binStats(selectedRows).durationSec)} {formatBytes(binStats(selectedRows).sizeBytes)}</span>}
                {canWrite && <>
                  <Btn small onClick={() => patchSelection({ review_flag: 'select' })} title="Select (S)"><Check className="w-3 h-3" style={{ color: C.green }} /> Select</Btn>
                  <Btn small onClick={() => patchSelection({ review_flag: 'reject' })} title="Reject (R)"><Ban className="w-3 h-3" style={{ color: C.red }} /> Reject</Btn>
                  <Btn small onClick={() => patchSelection({ review_flag: 'unflagged' })} title="Unflag (U)">Unflag</Btn>
                  <Btn small onClick={() => patchSelection({ circled: !selectedRows.every(r => r.circled) })} title="Circle (C)"><Circle className="w-3 h-3" style={{ color: C.accentText }} /> Circle</Btn>
                  <span className="inline-flex items-center gap-1 px-1">{COLORS.map(c => <ColorDot key={c} color={c} size={10} onClick={() => patchSelection({ color: c })} title={`Colour ${c}`} />)}<ColorDot color={null} size={10} onClick={() => patchSelection({ color: null })} title="No colour" /></span>
                  <Btn small onClick={e => setMenu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top - 8 - Math.min(320, 28 * bins.length), items: [{ header: 'Move to' }, ...binTargets().map(t => ({ label: t.label, Icon: FolderInput, ColorDot: t.color || undefined, onClick: () => moveIds([...selection], t.id) }))] })} disabled={bins.length < 2}><FolderInput className="w-3 h-3" /> Move to</Btn>
                  <Btn small onClick={e => setMenu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top - 8 - Math.min(320, 28 * bins.length), items: [{ header: 'Copy to (as an instance)' }, ...binTargets().map(t => ({ label: t.label, Icon: Copy, onClick: () => copyIds([...selection], t.id) }))] })}><Copy className="w-3 h-3" /> Copy to</Btn>
                  <Btn small danger onClick={() => removeIds([...selection])} title="Remove from bin (Delete)"><Trash2 className="w-3 h-3" /> Remove</Btn>
                </>}
                <button type="button" onClick={clearSelection} className="ml-auto text-[10px] font-mono uppercase tracking-wider hover:underline" style={{ color: C.dim }}>clear <Kbd>Esc</Kbd></button>
              </div>
            )}
          </div>
        </div>

        <BinInspector rows={inspectorRows} scenes={scenes} shots={shots} fps={fps} canWrite={canWrite} ffmpeg={ffmpeg}
          thumbUrlFor={thumbUrlFor} streamUrlFor={streamUrlFor}
          onPatch={patchSelection} onOpen={openFile} onProbe={probe} onRemove={removeIds} binPathFor={binPathFor} />
      </div>

      {/* ── Footer hints ── */}
      <div className="flex items-center gap-3 px-3 py-1 text-[9px] font-mono flex-shrink-0 flex-wrap" style={{ borderTop: `1px solid ${C.line}`, color: C.dimmer, backgroundColor: C.deep }}>
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>Shift</Kbd> extend</span><span><Kbd>S</Kbd> select</span><span><Kbd>R</Kbd> reject</span><span><Kbd>U</Kbd> unflag</span><span><Kbd>C</Kbd> circle</span><span><Kbd>1</Kbd>–<Kbd>8</Kbd> colour</span><span><Kbd>Space</Kbd> play</span><span><Kbd>F2</Kbd> rename</span><span><Kbd>Del</Kbd> remove</span><span><Kbd>Ctrl</Kbd><Kbd>Z</Kbd> undo</span>
        <span className="ml-auto">{files.length} file{files.length === 1 ? '' : 's'} in {bins.length} bin{bins.length === 1 ? '' : 's'}{offlineAll.length ? ` · ${offlineAll.length} offline` : ''}</span>
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {addDlg && <AddFilesDialog bin={addDlg.bin} plan={addDlg.plan} scenes={scenes} busy={addBusy} progress={addProgress} onConfirm={confirmAdd} onCancel={() => !addBusy && setAddDlg(null)} />}
      {deleteDlg && <DeleteBinDialog bin={deleteDlg} bins={bins} files={files} busy={deleteBusy} onConfirm={confirmDelete} onCancel={() => !deleteBusy && setDeleteDlg(null)} />}
      {relinkOpen && (
        <RelinkBinsDialog offlineRows={offlineAll} roots={roots}
          onPickFolder={async () => { const r = await ctx.pickBinFolder('Choose the folder the files moved to'); return r?.path || null }}
          onScan={(p) => ctx.binRelinkScan(p)}
          onApply={async (m) => { const r = await ctx.binRelinkApply(m); setThumbRev(v => v + 1); return r }}
          onClose={() => setRelinkOpen(false)} />
      )}
    </div>
  )
}

function RenameBar({ row, onCommit, onCancel }) {
  const [v, setV] = useState(row?.display_name || '')
  if (!row) return null
  return (
    <div className="absolute left-3 right-3 bottom-3 z-30 flex items-center gap-2 px-3 py-2 rounded-sm shadow-2xl" style={{ backgroundColor: C.panel, border: `1px solid ${C.accentBorder}` }}>
      <Edit3 className="w-3 h-3" style={{ color: C.accentText }} />
      <span className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: C.dim }}>Rename</span>
      <input autoFocus value={v} onChange={e => setV(e.target.value)}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { const t = v.trim(); if (t) onCommit(t); else onCancel() } if (e.key === 'Escape') onCancel() }}
        className="flex-1 px-2 py-1 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
        style={{ backgroundColor: C.deep, color: C.bright, border: `1px solid ${C.line}` }} />
      <span className="text-[9.5px] font-mono truncate" style={{ color: C.dimmer, maxWidth: 240 }}>{row.original_name}</span>
      <Btn small primary onClick={() => { const t = v.trim(); if (t) onCommit(t); else onCancel() }}>Save</Btn>
      <Btn small onClick={onCancel}>Cancel</Btn>
    </div>
  )
}
