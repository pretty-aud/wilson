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
//
// ── Post-overhaul S4c (2026-10-05): the Table is an explorer ─────────────────
//
// Audrey, after testing the beta: "in the files table view. everything seems
// to be in the same level. similar to windows explorer. i should be able to
// press into a folder and the table should show the files/folders in that
// folder. … at the top i should see the breadcrumb path of where the folder
// is in etc. think how the table view works in windows explorer". Her word
// supersedes the overhaul review's flat list (F-R12, kept under C1 as E7): the
// Table shows ONE folder at a time — its folders, then its files, each group
// sorted by the chosen column (fileTree.folderRows) — with a crumb bar above
// it (Project › SCENES › Proj-Sc01), each crumb a button, an Up button at its
// start, Backspace or Alt+← to go up, Enter on a folder's name to open it,
// ↑ ↓ Home End between the rows. The Columns view keeps the SAME place
// (`selected` is the one "where you are" for both views, as fileTree.js
// explains), so switching views never loses the folder, and the file window's
// Location crumb agrees with the bar.
//
// The search box keeps today's reach: while a query is typed the Table shows
// the matches from the WHOLE tree with their folder in the Location column
// (filterFlat over flattenTree, sorted as before); clearing it returns to the
// folder you were in. The Location column exists only there — in a folder the
// crumb says where every row is, so the column would say it a second time.
// The indent-by-depth code and the three-attempt note above TableView are
// gone with the flat list: there is no indent, and the parent is the crumb.
//
// Keys: the handler sits on the table area itself (React's onKeyDown), so it
// can only fire with focus inside this explorer — never from another page
// (every page stays mounted, but a hidden page cannot hold focus), never from
// the search box (it is in the toolbar, outside the table area), never from a
// text field at all (checked), never under a kit dialog or menu (overlayOpen),
// and only while this host's page is on screen (`pageActive`, from Rabbit.jsx
// as the Bins keys take it). A bare Shift is left alone: it is the pet's.
// =============================================================================

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Folder, File as FileIcon, FolderOpen, Info, RefreshCw, Search, Upload, FileClock, FolderSearch, Download, ExternalLink, X, Eye, Lock, ArrowUp, FolderInput } from 'lucide-react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { useNavigateTarget } from '../../tools/rabbit_v0.1.0/state/rabbitNavigate'
import { useProjectAccess } from '../../tools/rabbit_v0.1.0/state/useProjectAccess'
import { adapterSupportsWrites } from '../../tools/rabbit_v0.1.0/adapters'
import { usePermissions } from '../../permissions/usePermissions'
import { canSeeProjectMoney, canSeeProjectLegal } from '../../permissions/projectRoleMatrix'
import GatedAction from '../../permissions/GatedAction'
import RelinkDialog from '../../tools/rabbit_v0.1.0/components/RelinkDialog'
import FileAuditDrawer from '../../tools/rabbit_v0.1.0/components/FileAuditDrawer'
import FileEditor from './FileEditor'
import { LEGAL_ADD_HINT, LEGAL_AT_ADD_REASON, LEGAL_LOCAL_NOTE, LEGAL_UNAVAILABLE } from '../../tools/rabbit_v0.1.0/fileTags'

// While the database is asked whether Legal files exist here (0088).
const LEGAL_CHECKING = 'Checking whether this workspace can keep Legal files…'
import FilePreviewDialog from './FilePreviewDialog'
import { desktopBridge, diskSourceFor, downloadCloudFile, downloadName } from './fileActions'
import {
  Banner, Button, Card, Dialog, EmptyState, IconButton, Input, Loading, Row, Select, Table,
  Tabs, Td, Th, Toolbar,
} from '../../ui'
// `type="search"` is deliberate: the field was a `<input type="search">` and
// the browser's own clear affordance came with it. Replacing that with a
// hand-rolled clear button would be swapping one control for another under a
// constraint that says not to (C1), so the native one stays.
import { formatBytes } from '../../cloud/workspaceStorage'
import { formatDuration } from '../../tools/rabbit_v0.1.0/storage/mediaMetadata'
import { buildFileTree, flattenTree, filterFlat, columnsFor, breadcrumb, sortRows, crumbsFor, folderPathIds, folderRows } from './fileTree'
import { overlayOpen } from '../../ui/overlay'
import { pendingShotRefiling, refilingSentence } from '../../tools/rabbit_v0.1.0/shotRefiling'
import './resources.css'

// S4c: a row clicked within this many ms of entering a folder is ignored. A
// folder opens on ONE click (Audrey: "press into a folder"), so the second
// click of a habitual double-click would land on whatever row the new folder
// put under the pointer — opening a sub-folder or selecting a file nobody
// chose. Keys are never held back; only pointer clicks on rows are.
// The second click of a double-click, and the dblclick itself, are held for
// this long after a folder opens on the first click — longer than any OS
// double-click time (Windows defaults to 500 ms; round 2, item 5: a window
// shorter than that let a slow double-click's second half through). A FRESH
// click (detail 1) is never held: it is a new gesture.
const DOUBLE_CLICK_WINDOW_MS = 1000

function isTextField(t) {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

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

// `pageActive` (S4c): whether this host's page is the one on screen. R.A.B.B.I.T.
// passes `currentPage === 'rabbit'` (its page stays mounted while hidden); the
// Resources page mounts the explorer only while it is shown, so its default
// is true. The table's keys stand down while it is false.
export default function ProjectFilesExplorer({ projectId: hostProjectId = null, showPicker = true, pageActive = true } = {}) {
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

  // The rows on screen: the adapter's, the open project's provider rows over
  // them, this page's edits over those (S4c: kept apart from the tree so the
  // re-filing offer can read the folder rows as the tree does).
  const rowsOnScreen = useMemo(() => {
    if (!loaded || loaded.projectId !== projectId) return null
    let { folders, files, managedFiles } = loaded
    if (isOpenProject) {
      folders = mergeById(folders, ctx?.folders)
      files = mergeById(files, ctx?.files)
      managedFiles = mergeById(managedFiles, ctx?.managedFiles)
    }
    files = applyOverlay(files, overlay)
    managedFiles = applyOverlay(managedFiles, overlay)
    return { folders, files, managedFiles }
  }, [loaded, projectId, isOpenProject, ctx?.folders, ctx?.files, ctx?.managedFiles, overlay])
  const tree = useMemo(() => (rowsOnScreen ? buildFileTree(rowsOnScreen) : null), [rowsOnScreen])

  const selectedFile = (selectedFileId && tree?.byId.get(selectedFileId)) || null

  const flat = useMemo(() => (tree ? flattenTree(tree.root) : []), [tree])
  const cols = useMemo(() => (tree ? columnsFor(tree.root, selected) : []), [tree, selected])
  // ── S4c: where you are, for BOTH views ──────────────────────────────────
  // `selected` is the walk from the root; columnsFor stops it at the first id
  // that is no longer a folder in the tree (a folder removed under you, say),
  // so the current folder is always one that exists, and the crumb names it.
  const currentFolder = cols.length ? cols[cols.length - 1].folder : null
  const searching = query.trim() !== ''
  // In a folder: that folder's rows, folders first. While a query is typed:
  // the matches from the whole tree, sorted as the flat list always was.
  const tableRows = useMemo(() => (searching
    ? sortRows(filterFlat(flat, query), sortKey, sortDir)
    : folderRows(currentFolder, sortKey, sortDir)),
  [searching, flat, query, currentFolder, sortKey, sortDir])

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

  // ── S4c: entering, going up, the crumb ──────────────────────────────────
  // Every move sets the WHOLE walk from the root (folderPathIds), never pushes
  // onto `selected`: a folder reached through a search is deeper than the
  // folder you were in, and a walk that stopped early (see currentFolder) has
  // ids past its end that a push would sit behind. Focus follows the move
  // (`focusAfterRef`, below): the first row of a folder entered, the folder
  // you left when going up — Explorer's own hand-back.
  const focusAfterRef = useRef(null)
  const navigatedAtRef = useRef(0)
  const enterFolder = useCallback((node) => {
    if (!node || node.kind !== 'folder') return
    setSelected(folderPathIds(node))
    setSelectedFileId(null)
    setQuery('')
    navigatedAtRef.current = Date.now()
    focusAfterRef.current = { first: true }
  }, [])
  const goUp = useCallback(() => {
    const from = currentFolder
    if (!from || from.isRoot || !from.parent) return
    setSelected(folderPathIds(from.parent))
    setSelectedFileId(null)
    navigatedAtRef.current = Date.now()
    focusAfterRef.current = { id: from.id }
  }, [currentFolder])
  const goToCrumb = useCallback((folder) => {
    if (!folder) return
    setSelected(folderPathIds(folder))
    setSelectedFileId(null)
    navigatedAtRef.current = Date.now()
    focusAfterRef.current = { first: true }
  }, [])
  // The settle guard (DOUBLE_CLICK_WINDOW_MS): a second click on a row right after a
  // move is the second half of a double-click, and is dropped.
  const rowClickSettled = useCallback(() => Date.now() - navigatedAtRef.current >= DOUBLE_CLICK_WINDOW_MS, [])

  // "Show in Files" from another tab (state/rabbitNavigate.js): the target is
  // wired here, on the R.A.B.B.I.T. host; nothing calls it yet. A payload for
  // a file the tree has not loaded yet is declined and stays pending. S4c: it
  // lands in the file's FOLDER with the file selected, in either view.
  const showFileTarget = useCallback((p) => {
    if (!p?.fileId) return true
    if (!tree) return false
    const id = tree.byId.has(`f:${p.fileId}`) ? `f:${p.fileId}` : (tree.byId.has(`m:${p.fileId}`) ? `m:${p.fileId}` : null)
    if (!id) return true
    const node = tree.byId.get(id)
    setSelected(folderPathIds(node?.parent))
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
  // Post-overhaul S4d (0092): the Legal gate is the money gate OR a workspace
  // manager (canSeeProjectLegal), so with no seat in hand a workspace manager
  // still qualifies — the one row where the two gates differ.
  const canSeeLegal = noRoles || (isOpenProject
    ? canSeeProjectLegal({ appRole, projectRole: ctx?.myProjectRole })
    : (appRole === 'admin' || appRole === 'manager'))
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

  // ── Post-overhaul S4b: Add as Legal (Audrey, 2026-10-01) ─────────────────
  // "its just the folder that is locked": a Legal file goes into the
  // project's LEGAL folder WHEN IT IS ADDED, and only the people who see
  // Legal files see it. Until S4d that was the money audience (0088); since
  // 0092 (S4d, Audrey 2026-10-08: "Also workspace managers, without taking a
  // seat") it is the Legal gate, can_access_project_legal — the money
  // audience plus workspace managers. So the control is drawn only for them
  // (canSeeLegal, never canSeeMoney: projectLegal.test.js pins the line) —
  // a member or reviewer is not shown a door they cannot use — and nowhere
  // else: not a tag chip (fileTags.tagSettable), not a menu, not a mode on
  // Add files.
  //
  // The picker opens first; the confirmation comes AFTER it, naming the
  // picked files and who will see them, at the one moment that cannot be
  // taken back short of adding the file again (Cognitive Bias, Working
  // Memory). Cancelling the picker shows nothing. Once confirmed it uploads
  // exactly as Add files does — same refusal banner (Law of Similarity) —
  // with `legal: true`, which the adapter files under LEGAL.
  //
  // Where the database lacks 0088 the control stays, greyed, with the reason
  // (LEGAL_UNAVAILABLE): a manager learns why, instead of finding nothing.
  // While the database is being asked it says so, rather than claiming a
  // missing migration for the moment the question takes (review round 1,
  // R1-BEH-09): `null` is "asking", and only `true` opens the control.
  //
  // On the Local Server (no roles) the control says what that backend can
  // and cannot do — LEGAL_LOCAL_NOTE — and never that only managers will see
  // the files, which there is not true (R1-BEH-02).
  const legalOffered = onTab && canSeeLegal
  const [legalSupported, setLegalSupported] = useState(null)
  useEffect(() => {
    if (!legalOffered) { setLegalSupported(false); return undefined }
    let off = false
    const a = getAdapter?.()
    if (typeof a?.supportsLegalFiles !== 'function') { setLegalSupported(false); return undefined }
    setLegalSupported(null)
    Promise.resolve(a.supportsLegalFiles())
      .then((v) => { if (!off) setLegalSupported(v === true) })
      .catch(() => { if (!off) setLegalSupported(false) })
    return () => { off = true }
  }, [legalOffered, getAdapter, ctx?.adapterMode])
  const legalAllowed = canWrite && legalSupported === true
  const legalReason = !canWrite
    ? writeReason
    : (legalSupported === null ? LEGAL_CHECKING : LEGAL_UNAVAILABLE)
  const legalWho = noRoles ? LEGAL_LOCAL_NOTE : LEGAL_ADD_HINT
  const legalInputRef = useRef(null)
  const [legalPicked, setLegalPicked] = useState(null) // { projectId, files } awaiting the confirm
  const [legalUploading, setLegalUploading] = useState(false)
  // Another project: a pick made for the last one is not offered for this one.
  useEffect(() => { setLegalPicked(null) }, [projectId])
  // Nor one made while the control was open to this person and no longer is
  // (a seat changed, the backend went read-only): the confirm closes rather
  // than waiting to drop the files silently (review round 1, R1-BEH-15).
  useEffect(() => { if (!legalAllowed) setLegalPicked(null) }, [legalAllowed])
  const clearLegalInput = useCallback(() => { if (legalInputRef.current) legalInputRef.current.value = '' }, [])
  const handleLegalPick = useCallback((e) => {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    setLegalPicked({ projectId, files: picked })
  }, [projectId])
  const cancelLegal = useCallback(() => {
    setLegalPicked(null)
    clearLegalInput()
  }, [clearLegalInput])
  const confirmLegal = useCallback(async () => {
    const pick = legalPicked
    setLegalPicked(null)
    if (!pick || pick.projectId !== projectId || !legalAllowed) { clearLegalInput(); return }
    const forProject = pick.projectId
    setLegalUploading(true)
    setUploadError('')
    try {
      for (const file of pick.files) await uploadFile?.(file, { type: 'project', legal: true })
    } catch (err) {
      if (projectNowRef.current === forProject) setUploadError(err?.message || 'Upload failed.')
    } finally {
      setLegalUploading(false)
      clearLegalInput()
    }
  }, [legalPicked, projectId, legalAllowed, uploadFile, clearLegalInput])
  const legalCount = legalPicked?.files.length ?? 0

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

  // ── Post-overhaul S4c: the one-time re-filing of shot folders ────────────
  // Audrey: "shot folders should be in the scene folders". A project from
  // before S4c still has them under SHOTS; this OFFERS the move — never runs
  // it unasked (these are real folders and real objects) — to someone who
  // can write the open project, on the tab (the Resources page shows a
  // project without opening it, and the move is the open project's). What is
  // pending is read from the rows on screen (shotRefiling.pendingShotRefiling),
  // so the offer disappears by itself once the rows say the folders have
  // moved. The question names every folder and where it goes; the run shows
  // which shot it is on; the result says what moved and what was left, with
  // the reason each was left — a stop part way is a state the rows describe,
  // and the offer comes back for what is still pending.
  const refileFn = ctx?.refileShotFolders
  // EVERY shot and scene of the project (`allShots` / `allScenes`), not the
  // active shot list's (`ctx.shots`, D10): the run moves every shot's
  // folder, so the count, the names and the question must name every one
  // (review round 1, item 3).
  const allShots = ctx?.allShots
  const allScenes = ctx?.allScenes
  const pendingRefile = useMemo(() => (
    onTab && isOpenProject && rowsOnScreen && typeof refileFn === 'function'
      ? pendingShotRefiling({ folders: rowsOnScreen.folders, shots: allShots || [], scenes: allScenes || [] })
      : []
  ), [onTab, isOpenProject, rowsOnScreen, refileFn, allShots, allScenes])
  const [refileAsk, setRefileAsk] = useState(false)
  const [refiling, setRefiling] = useState(null) // { name, done, total } while it runs
  const [refileResult, setRefileResult] = useState(null) // { moved, left, removedShotsCategory }
  const [refileError, setRefileError] = useState('')
  // Another project: none of the move's state is its (the progress line
  // too — round 2, item 10: a run still going for the last project showed
  // frozen on the next one and hid its offer).
  useEffect(() => { setRefileAsk(false); setRefileResult(null); setRefileError(''); setRefiling(null) }, [projectId])
  const runRefile = useCallback(async () => {
    const forProject = projectId
    const total = pendingRefile.length
    setRefileAsk(false)
    setRefileResult(null)
    setRefileError('')
    setRefiling({ name: '', done: 0, total })
    try {
      const res = await refileFn({ onProgress: (p) => { if (projectNowRef.current === forProject) setRefiling({ name: p?.name || '', done: p?.done || 0, total: p?.total || total }) } })
      if (projectNowRef.current === forProject) {
        setRefileResult(res || { moved: [], left: [], removedShotsCategory: false })
        setReloads(n => n + 1)
      }
    } catch (err) {
      if (projectNowRef.current === forProject) setRefileError(err?.message || 'The move did not run.')
    } finally {
      if (projectNowRef.current === forProject) setRefiling(null)
    }
  }, [refileFn, projectId, pendingRefile.length])
  const refileWords = useMemo(() => {
    if (!refileResult) return ''
    const moved = refileResult.moved?.length || 0
    const left = refileResult.left || []
    const total = moved + left.length
    const gone = refileResult.removedShotsCategory ? ' The empty SHOTS folder is gone.' : ''
    // The Local Server counts a record whose file was not on disk before
    // the move (`missing`): its record moved with the folder, and the
    // relink census is where the file is found again. Said, not hidden
    // (round 2, item 1).
    const missing = (refileResult.moved || []).reduce((n, m) => n + (Number(m?.missing) || 0), 0)
    const notFound = missing > 0
      ? ` ${missing} file${missing === 1 ? ' was' : 's were'} not found on this computer; ${missing === 1 ? 'its record' : 'their records'} moved with the folder, and the relink census finds ${missing === 1 ? 'it' : 'them'}.`
      : ''
    if (left.length === 0) return `Moved ${moved} shot folder${moved === 1 ? '' : 's'} into ${moved === 1 ? 'its scene' : 'their scenes'}.${gone}${notFound}`
    const names = left.map((l) => `${l.name} (${l.reason})`).join('; ')
    return `Moved ${moved} of ${total}. Left where ${left.length === 1 ? 'it was' : 'they were'}: ${names}.${notFound}`
  }, [refileResult])

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

  // ── S4c: the table's keys, and focus after a move ───────────────────────
  // The name buttons in the Table (`[data-node-id]`, both kinds now) carry a
  // roving tab stop: one of them is in the tab order (the selected file's,
  // else the first row's) and the arrows walk the rest. The handler is on
  // the table area, so see the header: only with focus in here, never in a
  // text field, never under a dialog or menu, only while the page is shown.
  const tableButtons = useCallback(() => [...(rootRef.current?.querySelectorAll('[data-files-table] [data-node-id]') || [])], [])
  const onTableKeyDown = useCallback((e) => {
    if (!pageActive || overlayOpen()) return
    if (isTextField(e.target) || e.ctrlKey || e.metaKey) return
    const current = typeof e.target?.closest === 'function' ? e.target.closest('[data-node-id]') : null
    const stepTo = (pick) => {
      const list = tableButtons()
      if (list.length === 0) return
      const i = current ? list.indexOf(current) : -1
      const el = list[Math.max(0, Math.min(list.length - 1, pick(i, list.length)))]
      if (el) { e.preventDefault(); el.focus() }
    }
    switch (e.key) {
      case 'ArrowDown': return stepTo((i) => i + 1)
      case 'ArrowUp': return stepTo((i) => (i < 0 ? 0 : i - 1))
      case 'Home': return stepTo(() => 0)
      case 'End': return stepTo((_i, n) => n - 1)
      case 'Backspace':
        if (e.altKey || e.shiftKey || searching) return
        if (currentFolder && !currentFolder.isRoot) { e.preventDefault(); goUp() }
        return
      case 'ArrowLeft':
        if (!e.altKey) return
        // Alt+← is the browser's Back in the web build (App.jsx's pushState
        // history): taken here whatever the state — at the project folder
        // and during a search it does nothing, rather than leaving the page
        // (review round 1, item 9).
        e.preventDefault()
        if (searching) return
        if (currentFolder && !currentFolder.isRoot) goUp()
        return
      default:
    }
  }, [pageActive, searching, currentFolder, goUp, tableButtons])
  // After a move the table re-renders with the new folder's rows; focus goes
  // to the first row (entering) or to the folder just left (going up). Only
  // in the Table — the Columns view keeps its own buttons' focus.
  useEffect(() => {
    const want = focusAfterRef.current
    if (!want || view !== 'table') return
    focusAfterRef.current = null
    const list = tableButtons()
    const el = want.id ? list.find((b) => b.getAttribute('data-node-id') === want.id) : list[0]
    const fallback = rootRef.current?.querySelector('[data-folder-up]')
    ;(el || fallback)?.focus?.()
  }, [tableRows, view, tableButtons])
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
            {/* S4b: Add as Legal — only for the people who will see the
                files; secondary, so Add files stays the one primary at the
                right end (Von Restorff). Its hidden input sits AFTER Add
                files' in the DOM. */}
            {legalOffered && (
              <GatedAction allowed={legalAllowed} reason={legalReason}>
                <Button
                  size="sm"
                  Icon={Lock}
                  onClick={() => { if (legalAllowed) legalInputRef.current?.click() }}
                  loading={legalUploading}
                  loadingLabel="Adding…"
                  title={legalAllowed ? legalWho : undefined}
                  data-add-legal
                >
                  Add as Legal
                </Button>
              </GatedAction>
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
            {legalOffered && legalAllowed && (
              <input ref={legalInputRef} type="file" multiple onChange={handleLegalPick} className="fx-file-input" tabIndex={-1} aria-hidden="true" data-legal-input />
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
        {/* S4c: the offer, the run, the result (the note above pendingRefile).
            The offer is for people who can write the project: a reader is
            not shown a door they cannot open. */}
        {pendingRefile.length > 0 && canWrite && !refiling && (
          <Banner
            tone="info"
            Icon={FolderInput}
            data-shot-refile-offer
            action={(
              <Button size="sm" variant="primary" Icon={FolderInput} onClick={() => setRefileAsk(true)} data-shot-refile-open>
                Move shot folders into their scenes…
              </Button>
            )}
          >
            {refilingSentence(pendingRefile)} From now on a shot&rsquo;s folder lives inside its scene&rsquo;s.
          </Banner>
        )}
        {refiling && (
          <Banner tone="info" Icon={FolderInput} data-shot-refile-progress>
            Moving {refiling.name ? `${refiling.name} ` : 'shot folders '}({Math.min(refiling.done + 1, Math.max(refiling.total, 1))} of {Math.max(refiling.total, 1)})&hellip; no file is deleted; a stop part way can be run again.
          </Banner>
        )}
        {refileResult && !refiling && (
          <Banner
            tone={(refileResult.left || []).length ? 'warning' : 'success'}
            Icon={FolderInput}
            data-shot-refile-result
            action={<IconButton size="sm" icon={X} title="Dismiss" onClick={() => setRefileResult(null)} />}
          >
            {refileWords}
          </Banner>
        )}
        {refileError && !refiling && <Banner tone="danger" data-shot-refile-error>{refileError}</Banner>}

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
              {/* S4c: the table area owns the keys (the header says why it is
                  here and nowhere wider); the crumb bar sits above the rows,
                  at the table head's height, so "where am I" and "what is
                  here" are one column of reading (Proximity). */}
              <div className="fx-main" onKeyDown={view === 'table' ? onTableKeyDown : undefined} data-files-main={view}>
                {view === 'table' ? (
                  <>
                    <CrumbBar
                      folder={currentFolder}
                      searching={searching}
                      query={query}
                      matches={tableRows.length}
                      onUp={goUp}
                      onCrumb={goToCrumb}
                      onClear={() => setQuery('')}
                    />
                    {tableRows.length === 0 ? (
                      searching ? (
                        <EmptyState compact Icon={Search} title={`No files match “${query.trim()}” in this project`} body="Nothing here has that in its name, its path or its tags." data-files-empty="search" />
                      ) : (
                        <EmptyState compact Icon={Folder} title="Empty folder" body="Nothing is filed in here." data-files-empty="folder" />
                      )
                    ) : (
                      <TableView
                        rows={tableRows}
                        mode={searching ? 'search' : 'folder'}
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={onSort}
                        onPick={(node) => setSelectedFileId(node.id)}
                        onOpen={openPreview}
                        onEnterFolder={enterFolder}
                        settled={rowClickSettled}
                        selectedId={selectedFile?.id || null}
                      />
                    )}
                  </>
                ) : (
                  <ColumnsView cols={cols} selected={selected} selectedFile={selectedFile} onOpenFolder={openFolder} onPickFile={pickFile} onOpenFile={openPreview} />
                )}
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
      {legalPicked && legalPicked.projectId === projectId && (
        <Dialog
          title={legalCount === 1 ? 'Add this file as Legal?' : `Add these ${legalCount} files as Legal?`}
          width="confirm"
          dismissOnBackdrop
          onClose={cancelLegal}
          data-legal-confirm
          footer={(
            <>
              <Button onClick={cancelLegal}>Cancel</Button>
              <Button variant="primary" Icon={Lock} onClick={confirmLegal} data-legal-confirm-button>
                {legalCount === 1 ? 'Add as Legal' : `Add ${legalCount} as Legal`}
              </Button>
            </>
          )}
        >
          <ul className="fx-legal-names" data-legal-names>
            {legalPicked.files.slice(0, 5).map((f, i) => <li key={`${i}:${f.name}`} title={f.name}>{f.name}</li>)}
            {legalCount > 5 && <li className="fx-legal-more">and {legalCount - 5} more</li>}
          </ul>
          <p className="fx-legal-who" data-legal-who data-legal-local={noRoles || undefined}>{legalWho}</p>
          <p className="fx-legal-fixed">{LEGAL_AT_ADD_REASON} To change it later, add the file again.</p>
        </Dialog>
      )}
      {/* S4c: the question before the move. Every folder and where it goes
          (the first eight, then how many more), and the facts a person
          needs before saying yes: no file is deleted (the empty SHOTS folder
          is), a trashed file keeps its place, and a stop part way can be
          run again (Cognitive Bias: the one moment that cannot be taken
          back is named, with what it does). */}
      {refileAsk && pendingRefile.length > 0 && (
        <Dialog
          title={`Move ${pendingRefile.length} shot folder${pendingRefile.length === 1 ? '' : 's'} into ${pendingRefile.length === 1 ? 'its scene' : 'their scenes'}?`}
          width="confirm"
          dismissOnBackdrop
          onClose={() => setRefileAsk(false)}
          data-shot-refile-confirm
          footer={(
            <>
              <Button onClick={() => setRefileAsk(false)}>Cancel</Button>
              <Button variant="primary" Icon={FolderInput} onClick={runRefile} data-shot-refile-go>
                Move shot folders
              </Button>
            </>
          )}
        >
          <ul className="fx-refile-list" data-shot-refile-list>
            {pendingRefile.slice(0, 8).map((p) => (
              <li key={p.folder.id} title={`${p.folder.path} → ${p.toPath}`}>
                <span className="fx-refile-from">{p.folder.path}</span>
                <span className="fx-refile-arrow" aria-hidden="true">→</span>
                <span className="fx-refile-to">{p.toPath}</span>
              </li>
            ))}
            {pendingRefile.length > 8 && <li className="fx-refile-more">and {pendingRefile.length - 8} more</li>}
          </ul>
          <p className="fx-refile-note">
            Each folder moves with every file in it; no file is deleted, and only an empty SHOTS folder is removed at the end.
            {/* The two stores differ here (round 2, item 12): the cloud cannot
                see a trashed row, so its body keeps the old key and still
                restores; the Local Server's records move with their folder,
                trashed or not, since the file is in the directory. */}
            {ctx?.supportsManagedFiles ? ' A file in Recently deleted moves with its folder.' : ' A file in Recently deleted keeps its place and still restores.'}
            {' '}If it stops part way, what has moved stays moved, and you can run it again for the rest.
          </p>
        </Dialog>
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

// The columns, their widths, their alignment and their type, declared once.
// `table-layout: fixed` reads the header row, so these ARE the grid rather
// than an emergent property of whichever cell happened to be longest.
//
// 🚨 Each list sums to exactly 100. A percentage table that over-sums is not
// a declared table at all: the browser reconciles the excess and every column
// lands somewhere other than where it was written (F2 hit this twice building
// Team Members). In a folder: 42 + 10 + 10 + 14 + 14 + 10 = 100. In a search:
// 26 + 10 + 10 + 14 + 14 + 10 + 16 = 100.
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
// S4c: in a FOLDER there is no Location column — the crumb above the table
// names the parent of every row — and Name takes its sixteen points, which
// is where a long shot name was being cut. In a SEARCH the matches come from
// the whole tree, so Location comes back with its sixteen points (truncated
// from the left, F-R32) and Name gives them up again, as before.
const FOLDER_HEADERS = [
  ['name', 'Name', { width: '42%' }],
  ['type', 'Type', { width: '10%' }],
  ['size', 'Size', { width: '10%', numeric: true }],
  ['created', 'Created', { width: '14%', numeric: true }],
  ['modified', 'Modified', { width: '14%', numeric: true }],
  ['duration', 'Duration', { width: '10%', numeric: true }],
]
const SEARCH_HEADERS = [
  ['name', 'Name', { width: '26%' }],
  ['type', 'Type', { width: '10%' }],
  ['size', 'Size', { width: '10%', numeric: true }],
  ['created', 'Created', { width: '14%', numeric: true }],
  ['modified', 'Modified', { width: '14%', numeric: true }],
  ['duration', 'Duration', { width: '10%', numeric: true }],
  ['path', 'Location', { width: '16%' }],
]

// ── S4c: the crumb bar ───────────────────────────────────────────────────────
// Explorer's address bar, read left to right: Up, then Project › SCENES ›
// Proj-Sc01. Every crumb but the last is a button (Jakob: that is what a
// crumb does everywhere); the last is where you are, in the full ink, marked
// aria-current. The Up button is the one pointer target for "back out", at
// the start where the eye begins the line and at the row's own height
// (Fitts); its title says what Backspace does, so the key is discoverable
// without reading Help (Paradox of the Active User). While a query is typed
// the bar says what the rows are — matches across the project — with the one
// action that fits that state, Clear (Von Restorff).
function CrumbBar({ folder, searching, query, matches, onUp, onCrumb, onClear }) {
  const crumbs = crumbsFor(folder)
  const atRoot = !folder || folder.isRoot || !folder.parent
  const parentName = atRoot ? '' : (folder.parent.isRoot ? 'Project' : folder.parent.name)
  return (
    <div className="fx-crumbs" data-files-crumbs={searching ? 'search' : 'folder'}>
      {searching ? (
        <>
          <Search className="fx-crumb-glyph" aria-hidden="true" />
          <span className="fx-crumb-note" data-search-note>
            {matches} match{matches === 1 ? '' : 'es'} for “{query.trim()}” across the project
          </span>
          <Button size="sm" variant="ghost" onClick={onClear} data-search-clear>Clear</Button>
        </>
      ) : (
        <>
          <IconButton
            size="sm"
            icon={ArrowUp}
            title={atRoot ? 'This is the project folder' : `Up to ${parentName} (Backspace)`}
            disabled={atRoot}
            onClick={onUp}
            data-folder-up
          />
          <nav aria-label="Folder path" className="fx-crumb-nav">
            <ol className="fx-crumb-list">
              {crumbs.map((c, i) => (
                <li key={c.id} className="fx-crumb">
                  {i > 0 && <span className="fx-crumb-sep" aria-hidden="true">›</span>}
                  {i < crumbs.length - 1 ? (
                    <button type="button" className="fx-crumb-btn" onClick={() => onCrumb(c)} title={`Open ${c.isRoot ? 'the project folder' : c.name}`} data-crumb={c.id}>
                      {c.isRoot ? 'Project' : c.name}
                    </button>
                  ) : (
                    <span className="fx-crumb-here" aria-current="location" data-crumb={c.id}>{c.isRoot ? 'Project' : c.name}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        </>
      )}
    </div>
  )
}

// ── The Table (S4c: one folder at a time; a search across the tree) ─────────
// Both kinds of row are interactive now: a folder row OPENS on a click (or
// Enter on its name), a file row selects (a double-click or Enter previews,
// E10). The name cell is a <button> for both kinds — the keyboard reaches a
// folder the same way it reaches a file, and the explorer's hand-back after a
// move or a closed window finds either by `data-node-id` — and the row stays
// a plain <tr>. The buttons carry the roving tab stop: `focusId` names the
// one in the tab order (the selected file's row, else the first row); the
// arrows, handled by the table area, walk the rest.
function TableView({ rows, mode, sortKey, sortDir, onSort, onPick, onOpen, onEnterFolder, settled, selectedId }) {
  const headers = mode === 'search' ? SEARCH_HEADERS : FOLDER_HEADERS
  const focusId = rows.some(r => r.node.id === selectedId) ? selectedId : rows[0]?.node.id
  return (
    <Table
        aria-label="Project folders and files"
        dense
        data-files-table
        data-mode={mode}
        head={(
          <Row>
            {headers.map(([key, label, opts]) => (
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
            // A second-or-later click (detail 2+) on a row within the window
            // after a move is the second half of a double-click
            // (DOUBLE_CLICK_WINDOW_MS); a fresh click is never held. `detail`
            // is the click count: 0 for a synthetic or keyboard click, which
            // is never held back.
            const onRowClick = (e) => {
              if (e.detail >= 2 && !settled()) return
              if (isFolder) onEnterFolder(node)
              else onPick(node)
            }
            return (
              <Row
                key={node.id}
                className="fx-row"
                onClick={onRowClick}
                // E10: a double-click previews a file (single click selects).
                // Held back within the settle window too: a double-click on a
                // FOLDER enters it on the first click, and the dblclick then
                // fires on whichever row of the new folder is under the
                // pointer — a file nobody chose, which would open and log a
                // read (review round 1, item 5).
                onDoubleClick={() => { if (!isFolder && settled()) onOpen?.(node) }}
                data-node-kind={node.kind}
                interactive
                selected={node.id === selectedId}
              >
                <Td>
                  {/* The icon slot is a declared width, so the name text has
                      one x origin for both kinds (F11): `.fx-name` is on the
                      button, which sheds every UA button style. */}
                  <button
                    type="button"
                    className="fx-name fx-name-btn"
                    onClick={(e) => {
                      // The button's own click already bubbles to the row's
                      // handler; a keyboard "click" (Enter, Space) has no
                      // pointer and is never held back.
                      e.stopPropagation()
                      if (e.detail >= 2 && !settled()) return
                      if (isFolder) onEnterFolder(node)
                      else onPick(node)
                    }}
                    // E10: Enter on a FILE previews; Space still selects (the
                    // button's own click). Enter on a folder is the button's
                    // click, which opens it. Enter presses the focused control
                    // app-wide since S2a, so this is the button's own key, not
                    // a global hook.
                    onKeyDown={(e) => { if (!isFolder && e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); onOpen?.(node) } }}
                    title={isFolder ? `Open ${node.name}` : node.name}
                    tabIndex={node.id === focusId ? 0 : -1}
                    data-file-name={isFolder ? undefined : ''}
                    data-folder-name={isFolder ? '' : undefined}
                    data-node-id={node.id}
                  >
                    {isFolder
                      ? <Folder className="fx-name-icon" aria-hidden="true" />
                      : <FileIcon className="fx-name-icon" aria-hidden="true" />}
                    <span className="fx-name-text">{node.name}</span>
                  </button>
                </Td>
                <Td>{isFolder ? 'Folder' : m.type}</Td>
                <Td numeric>{isFolder ? '' : formatBytes(m.sizeBytes)}</Td>
                <Td numeric title={isFolder ? undefined : dateTitle(m.createdAt)}>{isFolder ? '' : fmtDay(m.createdAt)}</Td>
                <Td numeric title={isFolder ? undefined : dateTitle(m.modifiedAt)}>{isFolder ? '' : fmtDay(m.modifiedAt)}</Td>
                <Td numeric>{isFolder ? '' : formatDuration(m.durationSec)}</Td>
                {mode === 'search' && (
                  <Td>
                    {/* Truncated from the LEFT, which is what Finder does: the
                        leaf folder is the part that identifies a path, and an
                        end-ellipsis eats exactly that part (F-R32). */}
                    <span className="fx-path"><bdi>{isFolder ? node.path : (node.parent && !node.parent.isRoot ? node.parent.path : '')}</bdi></span>
                  </Td>
                )}
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
