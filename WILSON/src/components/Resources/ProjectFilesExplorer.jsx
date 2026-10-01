// =============================================================================
// Resources/ProjectFilesExplorer.jsx — FILES, under RESOURCES (demo
// 2026-09-11).
//
// Audrey, 2026-09-11, verbatim: "in the resource section of the app please
// add a way for me to view all the files in a project. allow me to choose a
// project and have a way to view folders and files. it should look
// something like window explorer. have a way to view all files and folder
// in one table, and also have a view that works like the column system in
// finder for mac os. so idea is one column is one level of folders, then
// the next column is one folder layer in and so on. … make sure to show all
// details for a file like listed before."
//
// Choose a project → its folders (0041's tree, both backends) and files
// (public.files / the local bundle, plus the Local Server's managed files)
// come straight from the adapter — no switch of the active project — and
// fileTree.js turns them into one tree. Two views over that tree: TABLE
// (every folder and file, indented, sortable by any column) and COLUMNS
// (Finder-style: each selected folder opens the next column). A selected
// file shows every detail the row carries: name, type, size, created,
// modified, duration, location, where it is stored.
//
// Read-only on purpose tonight: opening, moving and deleting stay where
// they are (the project's own Files panel and FileManager).
//
// ── UI overhaul C1 ───────────────────────────────────────────────────────────
//
// "files database for example looks atrocious" — Audrey, and the review
// agreed: 37 findings on this surface and the loudest of them are all here.
//
// Nothing about what this page DOES changed. Both views are here, every
// control is here, every column is here, nothing moved behind a disclosure,
// and no click does anything new (C1).
//
// What changed, and why each one:
//
//  · THE PAGE IS DARK (Q1, option A). It was one of six data pages on the
//    light orange, where `#f4a261` allows exactly one ink — and this page
//    needed three, so it invented a second (`MUTED #7c4f1f`, measured 3.40:1,
//    carrying six of the seven columns) and a third (a `#f5efe6` cream header
//    band: the only use of that value in the app, a near-white sheet on the
//    orange page, and the exact shape `lightSurface.test.js` already had a
//    rule against — it simply never imported the token that test guards).
//    Both are gone with the ground they were workarounds for, and so are the
//    two black input wells that sat on the orange page: a dark field on a
//    light page was the third workaround for the same problem.
//
//  · THE NAME COLUMN CAN LEFT-ALIGN NOW. It could not before: a folder drew
//    `▸` and a file drew `·`, two glyphs with different advance widths in any
//    proportional face, so inside one folder listing the names started at
//    different x positions. They are lucide icons in a slot of DECLARED width
//    now, so the text has one origin at every depth and for both kinds. This
//    is F11, and it is the most visible single line in the review.
//
//  · SIX TYPE SIZES BECAME THREE SCALE STEPS. 18 / 14 / 13 / 12 / 11 / 10
//    became Dense 13 for cells, Caption 12 for the path, Label 11 for headers.
//    The Location column no longer steps itself 2px below its own neighbours,
//    which read as a rendering fault rather than a rank (F-R32).
//
//  · THE TITLE IS PRINTED ONCE. The orange bar's PageHeader already says
//    "Files"; this page said it again 150px below in a smaller, lower-contrast
//    face, so the chrome title read as a subtitle of itself (F-R06).
//
//  · THE TWO PRIMARIES ARE REBALANCED, NOT REDUCED. One `btnStyle` helper drew
//    the Table/Columns radio pair AND the Refresh command, so the row offered
//    three identical pills for two different kinds of decision and a user
//    scanning for the view switch found one that was not a view (F-R16). Both
//    still exist and both still do exactly what they did. The view switch is a
//    Tabs — two mutually exclusive views of one dataset is what a tab bar IS,
//    and it is the component Team Members already uses for its saved views —
//    in the toolbar's left slot beside the project picker, which is this
//    page's actual primary control. Refresh is a ghost icon button in the
//    right slot beside the filter and the count. Separated by SLOT, never by
//    removal (F-R37).
//
//  · NUMERICS RIGHT-ALIGN. Size and Duration were set in monospace and then
//    left-aligned, which throws away the entire reason to use monospace: you
//    could not tell 9.8 MB from 98 MB without reading both (F-R10). Alignment
//    lives on the HEADERS array, so a header and its cells cannot disagree.
//
//  · THE INDENT STOPS LYING, BY GOING. `sortRows` reorders the flattened list
//    globally FOR EVERY KEY, name-ascending included, so a file three levels
//    deep sat 54px in beneath an unrelated root folder asserting a parentage
//    it did not have — on arrival, not only after a sort (F-R12). The row
//    order is untouched, every sort state is still reachable and every arrow
//    still honest; the indent is what goes, and the Location column carries
//    the parentage instead. The long note above `TableView` has the two wrong
//    answers that came first.
//
//  · LOADING AND EMPTY ARE DIFFERENT PICTURES. One `Empty` component served
//    "choose a project", "Loading…" and "no files", so the reader could not
//    tell a slow adapter from an empty project — which on this page is the
//    whole question (F-R13).
//
//  · THE ROWS ANSWER THE POINTER. The one table in the app whose whole job is
//    pointing at rows had no hover state and no transition at all (F-R11). The
//    rows stay plain `<tr>` elements with the onClick they already had: adding
//    `role` and `tabIndex` would be an interaction change under C1, and the
//    shared Row gives the hover fill and the pointer without one.
//
// The two views now share one set of tokens — the same 32px row, the same
// 8px/12px inset, the same hover and selected treatments, the same hairline —
// so switching between them is a change of arrangement rather than a change of
// application. The exact values are listed in this session's hand-off, because
// lane B converges FileManager, BinFileTable and ProjectFilesTable on them.
// =============================================================================

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Folder, File as FileIcon, FolderOpen, Info, RefreshCw, Search, Upload, FileClock, FolderSearch, Download, ExternalLink, X, Eye } from 'lucide-react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { useNavigateTarget } from '../../tools/rabbit_v0.1.0/state/rabbitNavigate'
import { useProjectAccess } from '../../tools/rabbit_v0.1.0/state/useProjectAccess'
import { adapterSupportsWrites } from '../../tools/rabbit_v0.1.0/adapters'
import { usePermissions } from '../../permissions/usePermissions'
import { canSeeProjectMoney } from '../../permissions/projectRoleMatrix'
import GatedAction from '../../permissions/GatedAction'
import RelinkDialog from '../../tools/rabbit_v0.1.0/components/RelinkDialog'
import FileAuditDrawer from '../../tools/rabbit_v0.1.0/components/FileAuditDrawer'
import FileEditor from './FileEditor'
import FilePreviewDialog from './FilePreviewDialog'
import { desktopBridge, diskSourceFor, downloadCloudFile, downloadName } from './fileActions'
import {
  Banner, Button, Card, EmptyState, IconButton, Input, Loading, Row, Select, Table,
  Tabs, Td, Th, Toolbar,
} from '../../ui'
// `type="search"` is deliberate: the field was a `<input type="search">` and
// the browser's own clear affordance came with it. Replacing that with a
// hand-rolled clear button would be swapping one control for another under a
// constraint that says not to (C1), so the native one stays.
import { formatBytes } from '../../cloud/workspaceStorage'
import { formatDuration } from '../../tools/rabbit_v0.1.0/storage/mediaMetadata'
import { buildFileTree, flattenTree, filterFlat, columnsFor, breadcrumb, sortRows } from './fileTree'
import './resources.css'

const VIEW_PANEL_ID = 'fx-view-panel'

const PROVIDER_LABEL = {
  supabase: 'Petal cloud',
  s3: 'Your own bucket',
  local_server: 'This computer',
  local_managed: 'The project folder on this computer',
  google_drive: 'Google Drive',
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

// V2 (2026-09-27), B4c §4.2 item 1: the table printed fmtDate's date AND time
// ("9/10/2026, 7:35:00 PM", about 170px of the mono) in a column that gives
// it about 106 at 1280, so every date ended in "…" with no way to read it.
// A cell prints the short date the other file tables print ("Sep 10, 2026",
// about 94px) and carries fmtDate's whole date and time as its tooltip; the
// details panel keeps the long form.
function fmtDay(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
// The cell's tooltip: the whole date and time, or none for a missing date.
function dateTitle(iso) {
  const full = fmtDate(iso)
  return full === '—' ? undefined : full
}

function safeList(fn, id) {
  if (typeof fn !== 'function') return Promise.resolve([])
  try { return Promise.resolve(fn(id)).then(v => (Array.isArray(v) ? v : [])).catch(() => []) } catch { return Promise.resolve([]) }
}

// ── Post-overhaul S4a: one explorer, two hosts (Audrey's E8) ──────────────────
//
// RESOURCES → FILES passes nothing: the picker, the adapter reads and Refresh,
// exactly as before (any project, without opening it). R.A.B.B.I.T.'s Files
// tab passes the open project and `showPicker={false}` — the picker is hidden
// there because the tab IS the open project.
//
// The adapter reads stay (localMediaWiring.test.js pins them). Two things lie
// on top of what they return, in this order:
//   1. when the project shown is the OPEN one, the provider's rows for it,
//      by id — the freshest copy the client has (realtime, another surface's
//      edit, an optimistic write in flight). A refetch issued while a save is
//      in flight can answer with the row as it was; this is what keeps that
//      answer from un-doing the save on screen.
//   2. this page's own edits still in flight, by id (the Resources host can
//      edit a project that is not open, which has no provider rows at all).
// And when the open project's files, folders or managed files change, the
// page reads them again — an upload from the toolbar, a teammate's rename.
//
// The provider's copy wins UNLESS the adapter's is strictly newer by
// `updated_at` (review round 1, R1-UI-09, measured): Refresh could not show a
// change the provider had missed (realtime down, another writer), and the
// window stitched a row from two versions. A stale answer to a refetch is
// older than the provider's saved row — the provider lands the server's row,
// stamp included, when its write does (round 2, R2-UI-01) — so it still
// loses, and so does one of the same age. Only the cloud stamps `updated_at`:
// a Local Server row carries none, so there the provider's copy always wins
// (round 2, R2-TST-13).
function strictlyNewer(a, b) {
  const ta = Date.parse(a?.updated_at || '')
  const tb = Date.parse(b?.updated_at || '')
  return Number.isFinite(ta) && Number.isFinite(tb) && ta > tb
}
function mergeById(base, fresh) {
  if (!Array.isArray(fresh) || fresh.length === 0) return base
  const byId = new Map(fresh.filter(Boolean).map(r => [r.id, r]))
  const seen = new Set()
  const out = base.map((r) => {
    const f = byId.get(r.id)
    if (!f) return r
    seen.add(r.id)
    return strictlyNewer(r, f) ? { ...f, ...r } : { ...r, ...f }
  })
  for (const f of byId.values()) if (!seen.has(f.id)) out.push(f)
  return out
}

function applyOverlay(rows, overlay) {
  if (!overlay || overlay.size === 0) return rows
  return rows.map(r => (overlay.has(r.id) ? { ...r, ...overlay.get(r.id) } : r))
}

export default function ProjectFilesExplorer({ projectId: hostProjectId = null, showPicker = true } = {}) {
  const ctx = useRabbit()
  const projects = useMemo(
    () => Object.values(ctx?.projectsIndex || {}).sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' })),
    [ctx?.projectsIndex],
  )
  const [pickedId, setPickedId] = useState('')
  const activeProjectId = ctx?.activeProjectId
  useEffect(() => {
    // Land on the project that is already open, once, so the page is never blank on arrival.
    if (showPicker && !pickedId && activeProjectId) setPickedId(activeProjectId)
  }, [showPicker, activeProjectId, pickedId])
  // The R.A.B.B.I.T. host shows the open project and nothing else.
  const projectId = showPicker ? pickedId : (hostProjectId || '')
  const isOpenProject = !!projectId && projectId === activeProjectId

  const [view, setView] = useState('columns')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [reloads, setReloads] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // What the adapter returned, and for which project.
  const [loaded, setLoaded] = useState(null) // { projectId, folders, files, managedFiles }
  // This page's edits still in flight, by row id (files and managed files
  // share no ids: both are UUIDs from different stores).
  const [overlay, setOverlay] = useState(() => new Map())
  const [selected, setSelected] = useState([])
  const [selectedFileId, setSelectedFileId] = useState(null)
  const getAdapter = ctx?.getAdapter

  // The open project's rows change → read them again. Identity, not content:
  // the provider replaces the array on every write it makes.
  const watchedFiles = isOpenProject ? ctx?.files : null
  const watchedFolders = isOpenProject ? ctx?.folders : null
  const watchedManaged = isOpenProject ? ctx?.managedFiles : null
  const seqRef = useRef(0)

  useEffect(() => {
    if (!projectId) { setLoaded(null); setError(''); return }
    const adapter = getAdapter?.()
    if (!adapter) return
    let cancelled = false
    const seq = ++seqRef.current
    // A refetch of the project already on screen keeps it on screen; only a
    // first load (or another project) draws the skeleton.
    const fresh = loaded?.projectId !== projectId
    if (fresh) setLoading(true)
    setError('')
    Promise.all([
      safeList(adapter.listFolders?.bind(adapter), projectId),
      safeList(adapter.listFiles?.bind(adapter), projectId),
      safeList(adapter.listManagedFiles?.bind(adapter), projectId),
    ]).then(([folders, files, managedFiles]) => {
      // Out-of-order answers are dropped: only the newest read may land.
      if (cancelled || seq !== seqRef.current) return
      setLoaded({ projectId, folders, files, managedFiles })
      setLoading(false)
    }).catch((err) => {
      if (cancelled || seq !== seqRef.current) return
      setError(err?.message || 'the project files could not be loaded')
      setLoading(false)
    })
    return () => { cancelled = true }
    // `loaded` is read for its project id only; adding it would refetch on
    // every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, getAdapter, reloads, watchedFiles, watchedFolders, watchedManaged])

  // Another project: nothing selected, no edit carried over.
  useEffect(() => {
    setSelected([])
    setSelectedFileId(null)
    setOverlay(new Map())
  }, [projectId])

  const tree = useMemo(() => {
    if (!loaded || loaded.projectId !== projectId) return null
    let { folders, files, managedFiles } = loaded
    if (isOpenProject) {
      folders = mergeById(folders, ctx?.folders)
      files = mergeById(files, ctx?.files)
      managedFiles = mergeById(managedFiles, ctx?.managedFiles)
    }
    files = applyOverlay(files, overlay)
    managedFiles = applyOverlay(managedFiles, overlay)
    return buildFileTree({ folders, files, managedFiles })
  }, [loaded, projectId, isOpenProject, ctx?.folders, ctx?.files, ctx?.managedFiles, overlay])

  const selectedFile = (selectedFileId && tree?.byId.get(selectedFileId)) || null

  const flat = useMemo(() => (tree ? flattenTree(tree.root) : []), [tree])
  const tableRows = useMemo(() => sortRows(filterFlat(flat, query), sortKey, sortDir), [flat, query, sortKey, sortDir])
  const cols = useMemo(() => (tree ? columnsFor(tree.root, selected) : []), [tree, selected])

  const onSort = useCallback((key) => {
    setSortDir(d => (sortKey === key ? (d === 'asc' ? 'desc' : 'asc') : 'asc'))
    setSortKey(key)
  }, [sortKey])

  const openFolder = useCallback((depth, id) => {
    setSelected(prev => [...prev.slice(0, depth), id])
    setSelectedFileId(null)
  }, [])
  const pickFile = useCallback((depth, node) => {
    setSelected(prev => prev.slice(0, depth))
    setSelectedFileId(node.id)
  }, [])

  // "Show in Files" from another tab (state/rabbitNavigate.js): the target is
  // wired here, on the R.A.B.B.I.T. host; nothing calls it yet. A payload for
  // a file the tree has not loaded yet is declined and stays pending.
  const showFileTarget = useCallback((p) => {
    if (!p?.fileId) return true
    if (!tree) return false
    const id = tree.byId.has(`f:${p.fileId}`) ? `f:${p.fileId}` : (tree.byId.has(`m:${p.fileId}`) ? `m:${p.fileId}` : null)
    if (!id) return true
    setSelectedFileId(id)
    return true
  }, [tree])
  // The Resources host declines every request, so one that arrives while it
  // happens to be mounted stays pending for the tab (and is not discarded
  // for naming a project other than the one picked here).
  const declineNavigate = useCallback(() => false, [])
  useNavigateTarget('files', showPicker ? declineNavigate : showFileTarget, showPicker ? null : (projectId || null))

  const project = projects.find(p => p.id === projectId) || null

  // ── Who may change what, for the project on screen ──────────────────────
  // The open project's seat is known (useProjectAccess, canSeeProjectMoney).
  // A project the Resources page shows WITHOUT opening it has no seat in
  // hand, so it fails closed for anyone below a workspace admin / manager —
  // the task-template precedent (projectRoleMatrix.js): "hide the control and
  // let them edit it with that project open". The Local Server has no roles
  // at all (noRoles), so there everything is a label and allowed; a backend
  // that cannot write (Google Drive) allows nothing. The DATABASE is the gate.
  const perms = usePermissions()
  const access = useProjectAccess()
  const noRoles = ctx?.adapterMode === 'local_server'
  const backendWrites = adapterSupportsWrites(ctx?.adapterMode)
  const appRole = perms?.role ?? null
  const canWrite = backendWrites && (noRoles || (isOpenProject
    ? access.canWrite
    : (appRole === 'admin' || appRole === 'manager')))
  const canSeeMoney = noRoles || (isOpenProject
    ? canSeeProjectMoney({ appRole, projectRole: ctx?.myProjectRole })
    : appRole === 'admin')
  const writeReason = !backendWrites
    ? 'This backend is read-only.'
    : (isOpenProject
      ? access.writeReason
      : 'Open this project in R.A.B.B.I.T. to change its files; your seat on it is read when it is open.')

  // ── E1: the three controls that left the Summary's Control Panel ──────────
  // They act on the OPEN project (uploadFile files into it, the census and
  // the dialog name it), so they live on the tab, which is always that one.
  const onTab = !showPicker
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  // Another project: its own uploads, its own refusals (round 1, R1-UI-11) —
  // and a refusal that ARRIVES after the switch is not shown on the next
  // project either (round 2, R2-TST-12).
  useEffect(() => { setUploadError('') }, [projectId])
  const projectNowRef = useRef(projectId)
  projectNowRef.current = projectId
  const uploadFile = ctx?.uploadFile
  const handleUpload = useCallback(async (e) => {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    const forProject = projectId
    setUploading(true)
    setUploadError('')
    try {
      // Uploads still file to the project root, exactly as the Control
      // Panel's did (E1): `{ type: 'project' }`, no folder, no entity.
      for (const file of picked) await uploadFile?.(file, { type: 'project' })
    } catch (err) {
      // A refusal is READ, not logged (the S37 rule the Control Panel's
      // handler carried): storage refusals arrive as thrown sentences.
      if (projectNowRef.current === forProject) setUploadError(err?.message || 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [uploadFile, projectId])

  // The missing-files census (Session 14), moved with its banner. Local
  // Server only — where folders actually move; a bucket path does not drift,
  // so the cloud gets no false affordance. getAdapter is the provider's
  // STABLE callback; the sequence drops an out-of-order scan.
  const relinkSupported = onTab && !!projectId && typeof getAdapter?.()?.relinkScan === 'function'
  const [missingCount, setMissingCount] = useState(0)
  const [relinkOpen, setRelinkOpen] = useState(false)
  const censusSeqRef = useRef(0)
  const refreshMissing = useCallback(async () => {
    if (!relinkSupported) { setMissingCount(0); return }
    const seq = ++censusSeqRef.current
    try {
      const res = await getAdapter().relinkScan(projectId)
      if (seq === censusSeqRef.current) setMissingCount(res?.missing?.length ?? 0)
    } catch { /* census only — the dialog surfaces real errors */ }
  }, [relinkSupported, getAdapter, projectId])
  useEffect(() => { refreshMissing() }, [refreshMissing])

  // File activity follows the selection: the drawer reads one file's events.
  const [auditOpen, setAuditOpen] = useState(false)
  useEffect(() => { if (!selectedFile) setAuditOpen(false) }, [selectedFile])

  // ── E10: the file window — the Details panel is the editor now ───────────
  //
  // Tags exist where the database has 0085 (the cloud probes it once per
  // session; the Local Server and the fixtures always have them).
  const [tagsSupported, setTagsSupported] = useState(false)
  useEffect(() => {
    let off = false
    const a = getAdapter?.()
    if (typeof a?.supportsFileTags !== 'function') { setTagsSupported(false); return undefined }
    Promise.resolve(a.supportsFileTags())
      .then((v) => { if (!off) setTagsSupported(!!v) })
      .catch(() => { if (!off) setTagsSupported(false) })
    return () => { off = true }
  }, [getAdapter, ctx?.adapterMode])

  // Every write goes through the provider's file verbs, with THIS page's
  // project (patchFile's rule: another project's write is that project's).
  // The change shows at once (the overlay, Doherty); the stored row lands in
  // the page's copy when the write returns; a refusal drops the overlay, so
  // the value goes back to what is stored, and says why. A version per row
  // keeps an older answer from clearing a newer edit still in flight.
  const [saveError, setSaveError] = useState('')
  useEffect(() => { setSaveError('') }, [selectedFileId])
  // A refusal that ARRIVES after another file was selected is that file's,
  // not this one's (round 2, R2-TST-12: a slow PATCH's refusal landed on the
  // next file's window).
  const selectedNowRef = useRef(selectedFileId)
  selectedNowRef.current = selectedFileId
  const overlayVersions = useRef(new Map())
  useEffect(() => { overlayVersions.current = new Map() }, [projectId])
  const patchFile = ctx?.patchFile
  const markCore = ctx?.markFileCoreDefiner
  const updateManaged = ctx?.updateManagedFile
  // Answers true when the change was stored, false when it was not (the
  // editor puts the note back on false — round 1, R1-UI-02).
  const saveFile = useCallback(async (node, patch) => {
    const row = node?.row
    if (!row || !patch) return false
    // The greyed controls are not the only gate (round 1, R1-TST-06): the
    // Resources page fails closed for a project it shows without opening,
    // and a row-level policy may still accept the write it promised to
    // refuse. Nothing is sent without the seat.
    if (!canWrite) { setSaveError(writeReason || 'You cannot change this file.'); return false }
    const id = row.id
    const managed = node.meta?.source === 'managed'
    const v = (overlayVersions.current.get(id) || 0) + 1
    overlayVersions.current.set(id, v)
    setOverlay((prev) => { const next = new Map(prev); next.set(id, { ...(prev.get(id) || {}), ...patch }); return next })
    setSaveError('')
    try {
      let saved
      if (managed) saved = await updateManaged?.(id, patch, projectId)
      else if (Object.keys(patch).length === 1 && 'is_core_definer' in patch) saved = await markCore?.(id, patch.is_core_definer, projectId)
      else saved = await patchFile?.(id, patch, projectId)
      const key = managed ? 'managedFiles' : 'files'
      const landed = saved && typeof saved === 'object' && saved.id === id ? saved : null
      setLoaded((prev) => (prev && prev.projectId === projectId
        ? { ...prev, [key]: prev[key].map((r) => (r.id === id ? { ...r, ...patch, ...(landed || {}) } : r)) }
        : prev))
      return true
    } catch (err) {
      if (selectedNowRef.current === node.id) setSaveError(err?.message || 'the change was refused')
      return false
    } finally {
      if (overlayVersions.current.get(id) === v) {
        overlayVersions.current.delete(id)
        setOverlay((prev) => { if (!prev.has(id)) return prev; const next = new Map(prev); next.delete(id); return next })
      }
    }
  }, [patchFile, markCore, updateManaged, projectId, canWrite, writeReason])

  // E9: Download, Show in folder, Open in default app. A row whose bytes are
  // on THIS computer reveals or opens through rabbit:open-path (main resolves
  // the path); a cloud body downloads by the signed URL, the Blob where
  // nothing can sign.
  const bridge = desktopBridge()
  const [actionError, setActionError] = useState('')
  useEffect(() => { setActionError('') }, [selectedFileId])
  const adapterMode = ctx?.adapterMode
  const onDiskOf = useCallback((node) => (bridge ? diskSourceFor(node, { adapterMode, projectId }) : null), [bridge, adapterMode, projectId])
  // A refusal is the file's it was asked for: one that ARRIVES after ← → in
  // the preview or a click in the list selected another file is not shown on
  // that one (round 2, R2-UI-03, the save refusal's rule above).
  const refuseFor = useCallback((node, sentence) => {
    if (selectedNowRef.current === node?.id) setActionError(sentence)
  }, [])
  const revealOrOpen = useCallback(async (node, reveal) => {
    const src = onDiskOf(node)
    if (!src) return
    setActionError('')
    try {
      const res = await bridge.openPath({ ...src, reveal })
      if (res && res.ok === false) refuseFor(node, res.error || 'That did not work.')
    } catch (err) {
      refuseFor(node, err?.message || 'That did not work.')
    }
  }, [onDiskOf, bridge, refuseFor])
  const downloadUrlFn = ctx?.downloadUrl
  const downloadFileFn = ctx?.downloadFile
  const download = useCallback(async (node) => {
    if (onDiskOf(node)) return revealOrOpen(node, true)
    setActionError('')
    try {
      await downloadCloudFile({ downloadUrl: downloadUrlFn, downloadFile: downloadFileFn }, node.row, downloadName(node))
    } catch (err) {
      refuseFor(node, err?.message || 'The download did not start.')
    }
    return undefined
  }, [onDiskOf, revealOrOpen, downloadUrlFn, downloadFileFn, refuseFor])

  // ── E9: the preview ───────────────────────────────────────────────────────
  // Opened by Preview, by Enter on a file's name, by a double-click. Its
  // previous / next walk the list the person is LOOKING at (E14, Drive's
  // arrows): the table's rows as filtered and sorted, or the files of the
  // selected file's folder in the Columns view — read live, so a refetch
  // under an open preview keeps it on the same file.
  const [previewId, setPreviewId] = useState(null)
  useEffect(() => { setPreviewId(null) }, [projectId])
  const previewItems = useMemo(() => {
    if (!previewId || !tree) return []
    if (view === 'table') return tableRows.map(r => r.node).filter(n => n.kind === 'file')
    const open = tree.byId.get(previewId)
    return (open?.parent?.children || []).filter(n => n.kind === 'file')
  }, [previewId, tree, view, tableRows])
  const previewIndex = previewItems.findIndex(n => n.id === previewId)
  const openPreview = useCallback((node) => {
    if (!node || node.kind !== 'file') return
    setSelectedFileId(node.id)
    setPreviewId(node.id)
  }, [])
  const stepPreview = useCallback((i) => {
    const next = previewItems[i]
    if (!next) return
    setSelectedFileId(next.id)
    setPreviewId(next.id)
  }, [previewItems])
  // E13: one 'downloaded' per file per session through the cloud's RPC
  // (best-effort, the module-level set below). The Local Server's stream
  // route records the read itself, throttled — so nothing is sent from here.
  // Keyed by WHO read it too (round 1, R1-TST-04): signing out does not
  // reload the window, and the next person's first read of a file the last
  // one had previewed must still be recorded.
  const readerId = perms?.userId || ''
  const logPreviewRead = useCallback((row) => {
    if (!row?.id || adapterMode === 'local_server') return
    const a = getAdapter?.()
    if (typeof a?.logFileDownloaded !== 'function') return
    const key = `${readerId}:${row.id}`
    if (PREVIEW_READS_LOGGED.has(key)) return
    PREVIEW_READS_LOGGED.add(key)
    // A read that was NOT recorded is forgotten, so the next one tries again
    // (round 2, R2-SEC-06: one failed RPC silenced the file for the session).
    Promise.resolve(a.logFileDownloaded(row))
      .then((logged) => { if (logged === false) PREVIEW_READS_LOGGED.delete(key) })
      .catch(() => { PREVIEW_READS_LOGGED.delete(key) })
  }, [adapterMode, getAdapter, readerId])
  // The preview's "no preview" sentence names the dev fixtures by the
  // adapter's own mode: the provider reports the fixtures as 'supabase'
  // (round 1, R1-TST-05 / R1-UI-12, measured).
  const previewMode = getAdapter?.()?.mode === 'fixtures' ? 'fixtures' : adapterMode
  // Focus goes back to a file's own name (Table) or item (Columns) when the
  // window or the preview over it closes — not to <body>, and not to the file
  // the preview was OPENED on after ← → walked away from it (round 1,
  // R1-UI-06 / R1-UI-07, measured). After the kit Dialog's own restore.
  // THIS explorer's name: both hosts stay mounted, so a search of the
  // document found the hidden one's first and focus went nowhere visible
  // (round 2, R2-UI-05, measured with R.A.B.B.I.T. left on Files).
  const rootRef = useRef(null)
  const focusFileName = useCallback((id) => {
    if (!id) return
    setTimeout(() => {
      const el = [...(rootRef.current?.querySelectorAll('[data-node-id]') || [])].find((e) => e.getAttribute('data-node-id') === id)
      el?.focus?.()
    }, 0)
  }, [])
  // The file's actions, in the file window's footer and the preview's bar.
  // The on-disk pair is ONE unit: the footer is too narrow for Preview and
  // both, so the pair wraps whole instead of stranding the icon on a line
  // of its own (measured in Electron, 271px wanted of 268).
  const fileActions = useCallback((node) => (onDiskOf(node) ? (
    <span className="fx-actions-pair">
      <Button size="sm" Icon={FolderOpen} onClick={() => revealOrOpen(node, true)} data-file-reveal>
        Show in folder
      </Button>
      <IconButton size="sm" icon={ExternalLink} title="Open in default app" onClick={() => revealOrOpen(node, false)} data-file-open />
    </span>
  ) : (
    <Button size="sm" Icon={Download} onClick={() => download(node)} data-file-download>
      Download
    </Button>
  )), [onDiskOf, revealOrOpen, download])

  return (
    <div ref={rootRef} className="rs-page" data-files-explorer data-view={view} data-host={showPicker ? 'resources' : 'rabbit'}>
      {/* One 44px toolbar, every child 28px, left and right slots. It replaced
          a wrapping flex row holding an 18px heading, two 38px fields, three
          27px buttons and a 12px string, in which nothing sat on a baseline
          and the view switch was the control that wrapped away (F-R16,
          F-R37). `wrap` is opt-in and taken here: six heterogeneous controls
          genuinely do not fit at the 1280px minimum width, and a toolbar that
          wraps by default hides the fact that it is over-full. */}
      <Toolbar
        wrap
        right={(
          <>
            <span className="rs-search">
              <Search className="rs-toolbar-glyph" aria-hidden="true" />
              <Input
                size="sm"
                type="search"
                value={query}
                onChange={setQuery}
                placeholder="Filter by name, path or tag"
                aria-label="Filter"
              />
            </span>
            <IconButton
              icon={RefreshCw}
              size="sm"
              title="Reload this project's folders and files"
              onClick={() => setReloads(n => n + 1)}
              disabled={!projectId || loading}
            />
            {tree && (
              <span className="rs-count">
                {tree.folderCount} folder{tree.folderCount === 1 ? '' : 's'} · {tree.fileCount} file{tree.fileCount === 1 ? '' : 's'}
                {project ? ` · ${project.title}` : ''}
              </span>
            )}
            {/* E1: File activity and Add files, moved from the Control Panel.
                The tab only: both act on the open project. The primary sits
                at the right end, as New asset does on Assets (Jakob). */}
            {onTab && (
              <Button
                size="sm"
                Icon={FileClock}
                onClick={() => setAuditOpen(true)}
                disabled={!selectedFile}
                title={selectedFile ? `See who touched ${selectedFile.name}, and when` : 'Select a file to see its activity'}
                data-file-activity
              >
                File activity
              </Button>
            )}
            {onTab && (
              <GatedAction allowed={canWrite} reason={writeReason}>
                <input ref={fileInputRef} type="file" multiple onChange={handleUpload} className="fx-file-input" tabIndex={-1} aria-hidden="true" />
                <Button
                  size="sm"
                  variant="primary"
                  Icon={Upload}
                  onClick={() => { if (canWrite) fileInputRef.current?.click() }}
                  loading={uploading}
                  loadingLabel="Uploading…"
                  data-add-files
                >
                  Add files
                </Button>
              </GatedAction>
            )}
          </>
        )}
      >
        {/* E8: hidden on R.A.B.B.I.T.'s Files tab, which IS the open project. */}
        {showPicker && (
          <Select
            size="sm"
            value={projectId}
            onChange={(v) => setPickedId(v ?? '')}
            placeholder="Choose a project…"
            options={projects.map(p => ({
              value: p.id,
              label: `${p.title || 'Untitled'}${p.is_private ? ' · private' : ''}`,
            }))}
            aria-label="Project"
          />
        )}
        <Tabs
          label="View"
          panelId={VIEW_PANEL_ID}
          items={[{ id: 'table', label: 'Table' }, { id: 'columns', label: 'Columns' }]}
          value={view}
          onChange={setView}
        />
      </Toolbar>

      <div
        className="rs-body"
        data-fill
        id={VIEW_PANEL_ID}
        role="tabpanel"
        aria-label={view === 'table' ? 'Table view' : 'Columns view'}
        // A tabpanel with no focusable descendant needs its own tab stop, or a
        // keyboard user moves from the last tab straight past it. The three
        // states below are exactly that; both views bring their own.
        tabIndex={!projectId || loading || flat.length === 0 ? 0 : undefined}
      >
        {error && <Banner tone="danger">{error}</Banner>}
        {uploadError && <Banner tone="danger" data-upload-error>{uploadError}</Banner>}
        {/* E1: the missing-files notice and its Relink, moved with the census
            from the Control Panel — on the kit Banner now (it was a hand-drawn
            strip, OUTSTANDING's note). The action sits inside the notice
            (Fitts); a broken state is impossible to miss above the files
            (Selective Attention). */}
        {relinkSupported && missingCount > 0 && (
          <Banner
            tone="warning"
            Icon={FolderSearch}
            data-missing-files
            action={(
              <Button size="sm" variant="primary" Icon={FolderSearch} onClick={() => setRelinkOpen(true)}>
                Relink…
              </Button>
            )}
          >
            {missingCount} file{missingCount === 1 ? '' : 's'} can&rsquo;t be found on disk — the folder may have moved.
          </Banner>
        )}

        {/* Three states that used to be one component with three strings, so a
            slow adapter and an empty project drew the same picture (F-R13). */}
        {!projectId && (
          <EmptyState
            Icon={FolderOpen}
            title="No project chosen"
            body="Choose a project above to see its folders and files."
          />
        )}
        {projectId && loading && <Loading rows={10} columns={7} label="Loading this project's files" />}
        {projectId && !loading && tree && flat.length === 0 && !error && (
          <EmptyState
            Icon={Folder}
            title="Nothing filed yet"
            body="This project has no folders or files. They appear here as R.A.B.B.I.T. files things into it."
          />
        )}

        {projectId && !loading && tree && flat.length > 0 && (
          // One hairline region around BOTH views and the details panel. The
          // two views were two different objects — a bordered table beside an
          // unbordered column strip — and they are one file browser seen two
          // ways, so they get one frame, one gutter and one set of tokens.
          <Card pad={false} className="fx-card">
            <div className="fx-split">
              <div className="fx-main">
                {view === 'table'
                  ? <TableView rows={tableRows} sortKey={sortKey} sortDir={sortDir} onSort={onSort} onPick={(node) => setSelectedFileId(node.id)} onOpen={openPreview} selectedId={selectedFile?.id || null} />
                  : <ColumnsView cols={cols} selected={selected} selectedFile={selectedFile} onOpenFolder={openFolder} onPickFile={pickFile} onOpenFile={openPreview} />}
              </div>
              <DetailsPanel
                node={selectedFile}
                onClose={() => { const id = selectedFile?.id; setSelectedFileId(null); focusFileName(id) }}
                editor={selectedFile && (
                  <FileEditor
                    key={selectedFile.id}
                    node={selectedFile}
                    canWrite={canWrite}
                    writeReason={writeReason}
                    canSeeMoney={canSeeMoney}
                    tagsSupported={tagsSupported}
                    noRoles={noRoles}
                    saveError={saveError}
                    onSave={(patch) => saveFile(selectedFile, patch)}
                  />
                )}
                actionError={actionError}
                actions={selectedFile && (
                  // E9, one slot per job: Preview first (the primary), then a
                  // cloud file's Download — or, for a file already on this
                  // computer, Show in folder (E9: Download REVEALS it, so the
                  // slot says what it does) and Open in default app.
                  <>
                    <Button size="sm" variant="primary" Icon={Eye} onClick={() => openPreview(selectedFile)} data-file-preview-open>
                      Preview
                    </Button>
                    {fileActions(selectedFile)}
                  </>
                )}
              />
            </div>
          </Card>
        )}
      </div>

      {/* After an apply, in-memory rows keep a stale storage_path until the
          next load — harmless: local download/delete resolve by row id on the
          server. The census re-scan is what drives the notice. */}
      {relinkOpen && (
        <RelinkDialog
          projectId={projectId}
          onClose={() => setRelinkOpen(false)}
          onApplied={() => { refreshMissing(); setReloads(n => n + 1) }}
        />
      )}
      {auditOpen && selectedFile && (
        <FileAuditDrawer
          fileId={selectedFile.row?.id}
          projectId={projectId}
          fileName={selectedFile.name}
          onClose={() => setAuditOpen(false)}
        />
      )}
      {previewId && previewIndex >= 0 && (
        <FilePreviewDialog
          items={previewItems}
          index={previewIndex}
          onIndex={stepPreview}
          onClose={() => { const id = previewId; setPreviewId(null); focusFileName(id) }}
          projectId={projectId}
          adapterMode={previewMode}
          actionsFor={fileActions}
          actionError={actionError}
          onRead={logPreviewRead}
          onReveal={(node) => revealOrOpen(node, true)}
        />
      )}
    </div>
  )
}

// E13: the files whose preview has been logged this session (the cloud's
// log_file_downloaded, once per file). Module-level on purpose: a session is
// the app's life, not one mount of this page.
const PREVIEW_READS_LOGGED = new Set()

/** Tests only (overlay.js's `_resetOverlaysForTests` pattern): one session per test. */
export function _resetPreviewReadsForTests() { PREVIEW_READS_LOGGED.clear() }

// The seven columns, their widths, their alignment and their type, declared
// once. `table-layout: fixed` reads the header row, so these ARE the grid
// rather than an emergent property of whichever cell happened to be longest.
//
// 🚨 They sum to exactly 100. A percentage table that over-sums is not a
// declared table at all: the browser reconciles the excess and every column
// lands somewhere other than where it was written (F2 hit this twice building
// Team Members). 30 + 10 + 8 + 14 + 14 + 8 + 16 = 100.
//
// `numeric` is the kit's one switch for "this is a figure": right alignment,
// the mono, and tabular figures, together. Declaring it here rather than per
// cell is F-R10's real fix — a header and its cells cannot disagree about
// alignment when only one of them says anything about it.
// 🚨 MEASURED AT 1280, NOT CHOSEN. Size and Duration were 8 percent, which at
// Electron's minimum window is a 50px content box — and "12.4 GB" needs 55px
// and "1:02:33" needs 55px, so both ellipsised away the part that carries the
// meaning: the unit, and the seconds. A file size rendered "12.4 …" is worse
// than no file size at all. The Duration HEADER did not fit its own label
// either, at 1280 or at 1440.
//
// Name gives up the four points, because it is the column with slack: it
// ellipsises a NAME, whose tail the Location column and the details panel both
// still carry.
const HEADERS = [
  ['name', 'Name', { width: '26%' }],
  ['type', 'Type', { width: '10%' }],
  ['size', 'Size', { width: '10%', numeric: true }],
  ['created', 'Created', { width: '14%', numeric: true }],
  ['modified', 'Modified', { width: '14%', numeric: true }],
  ['duration', 'Duration', { width: '10%', numeric: true }],
  ['path', 'Location', { width: '16%' }],
]

// 🚨 THE TABLE VIEW DOES NOT INDENT, AND THIS TOOK THREE GOES TO GET RIGHT.
//
// F-R12: `sortRows` re-sorts the FLATTENED list globally, so a file three
// levels deep lands wherever its name or its size puts it while keeping the
// indent it had in the tree — claiming a parent it does not have. What the
// review did not say, and what turned out to matter, is that `sortRows` runs
// for EVERY key INCLUDING name-ascending, which is the default. So the page
// opened in a lying state and there was never an arrangement where the indent
// was true.
//
// The second attempt made the default case skip `sortRows`, so tree order WAS
// the default. That fixed the indent and broke two other things: the Name
// header still rendered `aria-sort="ascending"` and an up arrow over rows that
// were not in name order, and a flat A-to-Z listing stopped being reachable at
// all, because clicking Name then cycled tree-order against flat-Z-to-A. It
// traded a lying indent for a lying header, and lost a state the user had.
//
// So the ordering is exactly what it always was — every sort state reachable,
// every arrow honest, nothing about the view changed — and the INDENT is what
// goes, because the indent is the part that was never true.
//
// Parentage is not lost with it. The Location column carries the full path on
// every row, which is what the review itself prescribes for the flattened case
// ("show the path in the Location column rather than silently removing
// indentation"), and the Columns view beside it is the actual tree.
function TableView({ rows, sortKey, sortDir, onSort, onPick, onOpen, selectedId }) {
  return (
    <Table
        aria-label="Project folders and files"
        dense
        data-files-table
        head={(
          <Row>
            {HEADERS.map(([key, label, opts]) => (
              <Th
                key={key}
                width={opts.width}
                numeric={opts.numeric}
                sort={sortKey === key ? sortDir : null}
                onSort={() => onSort(key)}
              >
                {label}
              </Th>
            ))}
          </Row>
        )}
      >
        {rows.map(({ node }) => {
            const isFolder = node.kind === 'folder'
            const m = node.meta || {}
            return (
              <Row
                key={node.id}
                className="fx-row"
                onClick={() => { if (!isFolder) onPick(node) }}
                // E10: a double-click previews (single click selects).
                onDoubleClick={() => { if (!isFolder) onOpen?.(node) }}
                data-node-kind={node.kind}
                interactive={!isFolder}
                selected={node.id === selectedId}
              >
                <Td>
                  {/* The icon slot is a declared width, so the name text has
                      one x origin at every depth and for both kinds. The
                      indent is on the SLOT, not on the text, so the two move
                      together and the column keeps one inset per depth (F11).
                      Post-overhaul S4a (E10): a FILE's name is a <button> —
                      the row stays a plain <tr> (no role, no tab stop), and
                      the keyboard reaches the file through its name. Same
                      slot, same origin: `.fx-name` is on the button. */}
                  {isFolder ? (
                    <span className="fx-name">
                      <Folder className="fx-name-icon" aria-hidden="true" />
                      <span className="fx-name-text">{node.name}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="fx-name fx-name-btn"
                      onClick={() => onPick(node)}
                      // E10: Enter previews; Space still selects (the
                      // button's own click). Enter presses the focused
                      // control app-wide since S2a, so this is the button's
                      // own key, not a global hook.
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); onOpen?.(node) } }}
                      title={node.name}
                      data-file-name
                      data-node-id={node.id}
                    >
                      <FileIcon className="fx-name-icon" aria-hidden="true" />
                      <span className="fx-name-text">{node.name}</span>
                    </button>
                  )}
                </Td>
                <Td>{isFolder ? 'Folder' : m.type}</Td>
                <Td numeric>{isFolder ? '' : formatBytes(m.sizeBytes)}</Td>
                <Td numeric title={isFolder ? undefined : dateTitle(m.createdAt)}>{isFolder ? '' : fmtDay(m.createdAt)}</Td>
                <Td numeric title={isFolder ? undefined : dateTitle(m.modifiedAt)}>{isFolder ? '' : fmtDay(m.modifiedAt)}</Td>
                <Td numeric>{isFolder ? '' : formatDuration(m.durationSec)}</Td>
                <Td>
                  {/* Truncated from the LEFT, which is what Finder does: the
                      leaf folder is the part that identifies a path, and an
                      end-ellipsis eats exactly that part (F-R32). */}
                  <span className="fx-path"><bdi>{isFolder ? node.path : (node.parent && !node.parent.isRoot ? node.parent.path : '')}</bdi></span>
                </Td>
              </Row>
            )
        })}
    </Table>
  )
}

function ColumnsView({ cols, selected, selectedFile, onOpenFolder, onPickFile, onOpenFile }) {
  return (
    <div className="fx-columns" data-files-columns>
      {cols.map((col, depth) => (
        <div key={col.folder ? col.folder.id : depth} className="fx-column" data-column={depth}>
          <div className="fx-column-head">
            {col.folder && !col.folder.isRoot ? col.folder.name : 'Project'}
          </div>
          {col.items.length === 0 && (
            <EmptyState compact Icon={Folder} title="Empty folder" body="Nothing is filed in here." />
          )}
          {col.items.map((node) => {
            const isFolder = node.kind === 'folder'
            const isSel = isFolder ? selected[depth] === node.id : selectedFile?.id === node.id
            return (
              <button
                key={node.id}
                type="button"
                className="fx-col-item"
                onClick={() => (isFolder ? onOpenFolder(depth, node.id) : onPickFile(depth, node))}
                // E10 in the Columns view too: a file previews on a
                // double-click or Enter (a folder's Enter still opens it).
                onDoubleClick={() => { if (!isFolder) onOpenFile?.(node) }}
                onKeyDown={(e) => {
                  if (isFolder || e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey) return
                  e.preventDefault()
                  onPickFile(depth, node)
                  onOpenFile?.(node)
                }}
                data-node-kind={node.kind}
                data-node-id={node.id}
                data-selected={isSel || undefined}
              >
                {isFolder
                  ? <Folder className="fx-name-icon" aria-hidden="true" />
                  : <FileIcon className="fx-name-icon" aria-hidden="true" />}
                <span className="fx-col-name">{node.name}</span>
                {isFolder
                  ? <span className="fx-col-chevron" aria-hidden="true">›</span>
                  : <span className="fx-col-meta">{formatBytes(node.meta?.sizeBytes)}</span>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── The file window (post-overhaul S4a, E10) ────────────────────────────────
// Collapsed at rest — walkthrough 47 Q60, answered by E10: nothing selected,
// no panel, and the table or the columns take the width back. A selected file
// opens it: the eight facts (unchanged, pinned), then the editor (FileEditor:
// notes, Core, Kind, tags), then the actions in a footer that stays in view
// however far the fields scroll (Fitts: the actions are where the panel
// ends, at one place for every file). Close clears the selection.
function DetailsPanel({ node, onClose, editor, actions, actionError }) {
  if (!node) return null
  const m = node.meta || {}
  const isMedia = m.kind === 'video' || m.kind === 'audio'
  // 🚨 THE SHAPE OF THIS ARRAY IS PINNED. `src/lib/localMediaWiring.test.js`
  // asserts the eight literals `['Name'` … `['Stored'` appear in this file —
  // they are the eight facts Audrey asked to see for a file. Keep the pairs.
  const rows = [
    ['Name', node.name],
    ['Type', m.type || '—'],
    ['Size', formatBytes(m.sizeBytes)],
    ['Created', fmtDate(m.createdAt)],
    ['Modified', fmtDate(m.modifiedAt)],
    ['Duration', isMedia ? (formatDuration(m.durationSec) || 'not read') : '—'],
    ['Location', breadcrumb(node.parent) || 'Project'],
    ['Stored', PROVIDER_LABEL[m.provider] || m.provider || '—'],
  ]
  return (
    <aside className="fx-details" data-file-details={node.id} aria-label={`Details: ${node.name}`}>
      <div className="fx-details-scroll">
        <div className="fx-details-title">
          <Info className="rs-toolbar-glyph" aria-hidden="true" />
          <span className="fx-details-title-text">Details</span>
          <IconButton size="sm" icon={X} title="Close details" onClick={onClose} className="fx-details-close" />
        </div>
        {/* Eight pairs that stacked label-over-value at a 0:10px proximity ratio
            — no gap inside a pair, 10px between pairs — and filled 290px of a
            300px panel. A two-column definition grid reads them in about half
            that, and the pairs are held together by position rather than by a
            type difference the dark ground was about to reduce (F-R33). The
            numeric facts take the mono with tabular figures; the prose ones
            do not. */}
        <dl className="fx-details-grid">
          {rows.map(([k, v]) => (
            <div key={k} className="fx-details-pair">
              <dt>{k}</dt>
              <dd data-numeric={DETAIL_NUMERIC.has(k) || undefined}>{v}</dd>
            </div>
          ))}
        </dl>
        {editor}
      </div>
      {(actions || actionError) && (
        <div className="fx-actions" data-file-actions>
          {actionError && <Banner tone="danger" data-action-error>{actionError}</Banner>}
          {actions && <div className="fx-actions-row">{actions}</div>}
        </div>
      )}
    </aside>
  )
}

const DETAIL_NUMERIC = new Set(['Size', 'Created', 'Modified', 'Duration'])
