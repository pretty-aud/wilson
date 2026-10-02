// ============================================================
// RABBIT — ScenesView (v2 — restyled + timing properties)
// ============================================================
//
// Scene & Shot management with table/gallery views, auto-naming,
// detail popups, create/edit/delete workflows.
//
// v2 additions:
//   • Scene: description column, time_of_day dropdown
//   • Shot:  description column, frame_count, derived duration
//   • Scene totals: frame_count + runtime derived from child shots
//   • Project FPS setting drives timecode ↔ frame calculations
//   • Summary cards (total runtime/frames/scenes/shots)
//   • Expenses-table minimal aesthetic
//
// ── UX Laws applied ──
// • Aesthetic-Usability Effect — polished dark stone surface
// • Law of Common Region — rows as clearly bounded groups
// • Law of Proximity — tight internal spacing, generous external gaps
// • Von Restorff Effect — status accent bars for instant recognition
// • Cognitive Load — summary cards reduce need to calculate

import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from 'react'
import { createPortal } from 'react-dom'
import {
  Film, Plus, Search, X, LayoutGrid, Filter,
  Layers, ChevronDown, ChevronRight, Trash2, Edit3, Eye,
  Table as TableIcon, ArrowUpDown, Save,
  Maximize2, Minimize2, Clapperboard,
  BookmarkPlus, CheckSquare, Square, MinusSquare,
  Sun, FolderOpen, ImagePlus, ImageOff,
  ArrowUp, ArrowDown, ListMinus, ListPlus, Copy,
} from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
// Lane B5b (surface 6a, 2026-09-27): the page's tiles, toolbar and two tables
// on the kit and rabbitScenes.css; surface 6b the two galleries, the filter
// panel and the saved-views menu; surface 6c the two detail popups, each the
// kit Dialog in <body>.
import {
  Table, Th, Td, Row, Toolbar, Tabs, Button, IconButton, CellSelect, Stat, Card,
  StatusDot, StatusBadge, statusMeta, humanizeStatus, EmptyState, HoverActions, Dialog, Badge, Banner,
  SectionTitle,
} from '../../../ui'
import './rabbitScenes.css'
import { useRabbit } from '../state/RabbitProvider'
// Post-overhaul S3b: the list the tab is viewing (D2), and who is viewing it.
import { usePermissions } from '../../../permissions/usePermissions'
import GatedAction, { WriteReasonProvider } from '../../../permissions/GatedAction'
import { useViewedShotList } from './scenes/useViewedShotList'
import ShotLists from './scenes/ShotLists'
import MenuButton from './scenes/MenuButton'
import ListConfirm from './scenes/ListConfirm'
import { deleteQuestion, ARCHIVED_ADD_REASON } from './scenes/membershipCopy'
import { sortShotLists } from '../state/shotListModel'
// Post-overhaul S3c: an edit on screen — its cut, its bands, its tiles.
import { useEditSession } from './scenes/useEditSession'
import EditTable from './scenes/EditTable'
import { framesToTimecode } from './scenes/timecode'
// …and (step 4) the cut's own verbs, the first-change question (D13).
import { useEditChanges } from './scenes/useEditChanges'
import AddShotsDialog from './scenes/AddShotsDialog'
import {
  stepItem, stepBand, duplicateItem, removeItem, duplicateBand, removeBand, insertAfter, itemsForShots,
  dropOnCut, dropOnList,
} from './scenes/editModel'
import {
  firstChangeQuestion, moveWords, duplicateWords, removeWords, addWords, newShotWords,
  moveBlockWords, duplicateBlockWords, removeBlockWords, dropWords, NEW_SHOT_WRITES,
} from './scenes/editCopy'
// …and (step 6) the drag.
import { useCutDrag, blockLine } from './scenes/useCutDrag'
import { Grip } from './scenes/EditTable'
// …and (step 7) the leave guard: a popup's typed text, a jump between rows.
import { useLeaveGuard } from './scenes/useLeaveGuard'
import { confirmLeave, hasUnsavedWork } from '../state/leaveGuard'
// The three-answer questions (leave, recover) are at the form width: they count themselves.
import { answersOpen } from './scenes/AnswerDialog'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import { useRateCard } from '../../../components/RateCard/useRateCard'
import FileManager from '../components/FileManager'
import TaskDetailPopup from '../components/TaskDetailPopup'
import RelationsPanel, { NewTaskSidePopup } from '../components/RelationsPanel'
// P1-23 (S3b step 7): a related asset opens in the Assets tab's own popup.
import { AssetDetailPopup } from './ProjectAssetsView'
// Session 25: naming moved out of this file. It had five copies here and in
// ProjectSummaryView, and S26 needs the same strings to name folders.
import {
  formatSceneCode as sceneCodeFor,
  formatShotCode as shotCodeFor,
  nextSceneNumber as nextSceneNumberFor,
  nextShotNumber as nextShotNumberFor,
  fileSlugify,
} from '../entityNaming'
// Shot takes (milestone 2, DEMO_BINS_BRIEF §5): bin files assigned to shots.
// Everything below is ADDED to the existing rows and popups — a chip strip
// per shot row in both content modes, the primary take's poster standing in
// for an EMPTY shot thumbnail (never over one Audrey set), and the ordered
// takes list in the shot detail popup. Local Server only (ctx.supportsBins).
import { useProjectAccess } from '../state/useProjectAccess'
import { useNavigateTarget } from '../state/rabbitNavigate'
import { takesByShot, primaryOf } from '../bins/shotTakeSelectors'
import { binPathLabel } from '../bins/binSelectors'
import ShotTakeChips from './bins/ShotTakeChips'
import ShotTakesPanel, { ShotTakesDialog } from './bins/ShotTakesPanel'
import TakePickerDialog from './bins/TakePickerDialog'
import BinPoster from './bins/BinPoster'
// S4a-07 (S3b step 7): the Bins keys' own "is something in front of me?".
import { visibleOverlayOpen, drawerOnScreen } from './bins/binUi'

// ── Status config ──
const SCENE_STATUSES = [
  'not_started', 'in_progress', 'pending_review', 'needs_revisions',
  'approved', 'final', 'blocked', 'on_hold', 'omitted',
]

const SCENE_TYPES = ['interior', 'exterior', 'int_ext', 'other']

const TIME_OF_DAY_OPTIONS = [
  'day', 'night', 'dawn', 'morning', 'afternoon', 'dusk',
  'evening', 'later', 'moments_later', 'continuous', 'same_time',
]

// Sentence case (Q2): every label below is a word the user reads in a select
// or a menu. The abbreviations stay capitals — they are codes, not words.
const FRAMING_OPTIONS = [
  { abbr: 'EWS',     label: 'Extreme wide shot' },
  { abbr: 'WS',      label: 'Wide shot' },
  { abbr: 'FS',      label: 'Full shot' },
  { abbr: 'LS',      label: 'Long shot' },
  { abbr: 'MLS',     label: 'Medium long shot' },
  { abbr: 'MS',      label: 'Medium shot' },
  { abbr: 'MCU',     label: 'Medium close-up' },
  { abbr: 'CU',      label: 'Close-up' },
  { abbr: 'ECU',     label: 'Extreme close-up' },
  { abbr: '2S',      label: 'Two-shot' },
  { abbr: '3S',      label: 'Three-shot' },
  { abbr: 'OTS',     label: 'Over-the-shoulder' },
  { abbr: 'POV',     label: 'Point of view' },
  { abbr: 'INS',     label: 'Insert shot' },
  { abbr: 'CA',      label: 'Cutaway' },
  { abbr: 'AER',     label: 'Aerial / bird\'s eye' },
]

const CAMERA_MOVEMENT_OPTIONS = [
  { abbr: 'PAN',        label: 'Pan' },
  { abbr: 'TILT',       label: 'Tilt' },
  { abbr: 'DUTCH',      label: 'Dutch tilt' },
  { abbr: 'ROLL',       label: 'Roll' },
  { abbr: 'DOLLY IN',   label: 'Dolly in' },
  { abbr: 'DOLLY OUT',  label: 'Dolly out' },
  { abbr: 'TRUCK L',    label: 'Truck left' },
  { abbr: 'TRUCK R',    label: 'Truck right' },
  { abbr: 'PED UP',     label: 'Pedestal up' },
  { abbr: 'PED DOWN',   label: 'Pedestal down' },
  { abbr: 'CRANE UP',   label: 'Crane up' },
  { abbr: 'CRANE DOWN', label: 'Crane down' },
  { abbr: 'ZOOM IN',    label: 'Zoom in' },
  { abbr: 'ZOOM OUT',   label: 'Zoom out' },
  { abbr: 'DOLLY ZOOM', label: 'Dolly zoom / vertigo' },
  { abbr: 'HANDHELD',   label: 'Handheld' },
  { abbr: 'STEADICAM',  label: 'Steadicam' },
  { abbr: 'ARC',        label: 'Arc' },
  { abbr: 'PUSH IN',    label: 'Push in' },
  { abbr: 'PULL OUT',   label: 'Pull out' },
  { abbr: 'WHIP PAN',   label: 'Whip pan' },
  { abbr: 'RACK FOCUS', label: 'Rack focus' },
]

// ── Thumbnail row heights (16:9 aspect) ──
// rabbitScenes.css keeps the same three heights for the tables' own boxes
// (`.rb-scene-table-wrap[data-thumb]`); these numbers are what the Bins
// components (ShotTakeChips, BinPoster) are handed, as before.
const BASE_ROW_H = 36
const THUMB_SIZES = {
  sm: { h: BASE_ROW_H },
  md: { h: Math.round(BASE_ROW_H * 1.5) },
  lg: { h: BASE_ROW_H * 2 },
}
function thumbW(h) { return Math.round(h * 16 / 9) }
// The toolbar's two size triples, in their order: the thumbnails' (table)
// and the cards' (gallery). One list, so the sheet can key each glyph.
const SIZE_KEYS = ['sm', 'md', 'lg']

// ── Sort config ──
const SORTABLE_FIELDS = [
  { value: 'name',         label: 'Name' },
  { value: 'scene_number', label: 'Scene number' },
  { value: 'type',         label: 'Type' },
  { value: 'status',       label: 'Status' },
  { value: 'time_of_day',  label: 'Time of day' },
  { value: 'created_at',   label: 'Created' },
]

const SHOT_SORTABLE_FIELDS = [
  { value: 'name',             label: 'Name' },
  { value: 'shot_number',      label: 'Shot number' },
  { value: 'type',             label: 'Type' },
  { value: 'status',           label: 'Status' },
  { value: 'time_of_day',      label: 'Time of day' },
  { value: 'framing',          label: 'Framing' },
  { value: 'camera_movement',  label: 'Camera movement' },
  { value: 'frame_count',      label: 'Frame count' },
  { value: 'created_at',       label: 'Created' },
]

const SHOT_FILTER_FIELDS = [
  { value: 'status',          label: 'Status',          type: 'select', options: SCENE_STATUSES },
  { value: 'type',            label: 'Type',            type: 'select', options: SCENE_TYPES },
  { value: 'time_of_day',     label: 'Time of day',     type: 'select', options: TIME_OF_DAY_OPTIONS },
  { value: 'framing',         label: 'Framing',         type: 'select', options: FRAMING_OPTIONS.map(f => f.abbr) },
  { value: 'camera_movement', label: 'Camera movement', type: 'select', options: CAMERA_MOVEMENT_OPTIONS.map(c => c.abbr) },
  { value: 'name',            label: 'Name',            type: 'text' },
]

// ── Group config ──
const GROUPABLE_FIELDS = [
  { value: '',       label: 'No grouping' },
  { value: 'type',   label: 'Type' },
  { value: 'status', label: 'Status' },
]
const SHOT_GROUPABLE_FIELDS = [
  { value: '',                label: 'No grouping' },
  { value: 'scene',          label: 'Scene' },
  { value: 'status',         label: 'Status' },
  { value: 'type',           label: 'Type' },
  { value: 'time_of_day',    label: 'Time of day' },
  { value: 'framing',        label: 'Framing' },
  { value: 'camera_movement', label: 'Camera movement' },
]

// ── Filter config ──
const SCENE_FILTER_FIELDS = [
  { value: 'status',      label: 'Status',      type: 'select', options: SCENE_STATUSES },
  { value: 'type',        label: 'Type',        type: 'select', options: SCENE_TYPES },
  { value: 'time_of_day', label: 'Time of day', type: 'select', options: TIME_OF_DAY_OPTIONS },
  { value: 'name',        label: 'Name',        type: 'text' },
]

const FILTER_OPS = {
  select: [
    { value: 'is',           label: 'is' },
    { value: 'is_not',       label: 'is not' },
    { value: 'is_empty',     label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  text: [
    { value: 'contains',     label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'is',           label: 'is' },
    { value: 'is_not',       label: 'is not' },
    { value: 'is_empty',     label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
}

const SAVED_VIEWS_KEY = 'rabbit_scene_saved_views'

// Post-overhaul S3c, step 3: while an edit is on screen its cut order IS the
// view — the toolbar's sort, group, filter and view controls stand aside
// (greyed, saying why), and New scene / New shot give way to the cut's own
// verbs. Search still finds a shot in the cut.
const EDIT_ORDER_REASON = 'An edit shows its cut order. Choose List order on the shot-list bar to sort, group, filter or change the view.'
// Post-overhaul S3c, step 7: the exits that would take a scene or shot popup
// (and its typed text) away — leaving the tab, switching project, a jump
// opening another row's popup. Leaving the page does not: the tab stays
// mounted, the popup with it.
const POPUP_EXITS = ['tab', 'project', 'popup']
const EDIT_ADD_REASON = "An edit is on screen. Add shots to it from a row's or a scene's edit actions, or choose List order to add to the list."

// ── Timecode helpers ──
// framesToTimecode lives in ./scenes/timecode.js since post-overhaul S3c (the
// edit table needs the same digits); imported above.

function fmtNumber(n) {
  if (n == null || isNaN(n)) return '0'
  return n.toLocaleString()
}

// Shots keyed by their scene (unlinked ones under '__unlinked__'), each
// scene's in shot-number order — for the list on screen and, since S3b, for
// every shot of the project. `keepOrder` keeps the order they came in: a
// list's own, in List order (S3b step 2).
function groupShotsByScene(shots, { keepOrder = false } = {}) {
  const map = {}
  for (const s of shots) {
    const key = s.scene_id || '__unlinked__'
    if (!map[key]) map[key] = []
    map[key].push(s)
  }
  if (keepOrder) return map
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => (a.shot_number ?? 0) - (b.shot_number ?? 0))
  }
  return map
}

// ── The tables' cell selects (surface 6a) ──
// The words in sentence case: a status's from the kit's one STATUS map
// (R3-11), the rest humanised from their value. Framing keeps its long
// label in the list (its cell shows the code); a movement is its code.
const STATUS_OPTIONS = SCENE_STATUSES.map(s => ({ value: s, label: statusMeta(s).label }))
const TYPE_OPTIONS = SCENE_TYPES.map(t => ({ value: t, label: humanizeStatus(t) }))
const TIME_OPTIONS = TIME_OF_DAY_OPTIONS.map(t => ({ value: t, label: humanizeStatus(t) }))
const FRAMING_CHOICES = FRAMING_OPTIONS.map(f => ({ value: f.abbr, label: f.label }))
const MOVE_CHOICES = CAMERA_MOVEMENT_OPTIONS.map(c => ({ value: c.abbr, label: c.abbr }))
// The ids the toolbar's two tab pairs point at (the kit Tabs' `panelId`):
// the body the content mode switches, and inside it the region the view
// mode switches.
const CONTENT_PANEL_ID = 'rb-scene-content'
const VIEW_PANEL_ID = 'rb-scene-view'

// ── The detail popups' width (surface 6c) ──
// Their old max-w-4xl, 896px: a real geometry, which the kit Dialog takes as
// a number (B4c's EntityDetailPopup's). While the task form is open it is
// the Dialog's first column, and the Dialog is wider by the form's 400px
// (rabbitFiles.css, `.rb-rel-task`) and the hairline after it
// (`.rb-scene-detail-task`).
const DETAIL_WIDTH = 896
const DETAIL_TASK_WIDTH = 400 + 1



// ─────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────
export default function ScenesView({ pageActive = false } = {}) {
  const ctx = useRabbit()
  const project = ctx?.project
  // Post-overhaul S3b, step 2 (D2): the tab shows the list THIS PERSON is
  // viewing — remembered per person and project, the active list by default
  // — and every table, gallery, group, tile and count reads its rows (D20).
  // The other tabs keep reading the active list (D10).
  const { userId } = usePermissions()
  const viewed = useViewedShotList({ ctx, personKey: userId })
  const scenes = viewed.scenes
  const shots = viewed.shots
  // A list on screen (live, or archived and opened on purpose): its order is
  // its own, and its rows can move.
  const viewingList = viewed.mode === 'list' || viewed.mode === 'archived'
  // Post-overhaul S3c, step 3: an EDIT of that list on screen (a saved one,
  // or the provider's draft): the body shows its cut and the tiles total it
  // (D20); the toolbar's sort, group, filter and view stand aside — an edit
  // is its cut order.
  const editSession = useEditSession({ ctx, viewed })
  const editOnScreen = editSession.onScreen
  // Post-overhaul S3b, step 1: `scenes` / `shots` are one LIST's rows (S3a,
  // D10), so a fact about the whole PROJECT — the next scene or shot number,
  // every shot the Delete question counts for a scene — reads every row. A
  // scene held only by another list would otherwise get its number reused.
  // (S3a's deleteScene takes every shot of the scene, in every list, in one
  // undo step: review round 1, R1-01.)
  const allScenes = ctx?.allScenes || []
  const allShots = ctx?.allShots || []
  const assets = ctx?.assets || []
  const tasks = ctx?.tasks || []
  const phases = ctx?.phases || []
  const fps = project?.fps || 24

  // ── Team members + rate card (for task creation popup) ──
  const tm = useTeamMembers()
  const rc = useRateCard()
  const teamAssignments = ctx?.teamAssignments || []
  const memberById = useMemo(() => { const m = {}; for (const mb of tm.members) m[mb.id] = mb; return m }, [tm.members])
  const projectMembers = useMemo(() => teamAssignments.map(a => memberById[a.member_id]).filter(Boolean), [teamAssignments, memberById])
  const roleEntries = useMemo(() => { const seen = new Set(); return (rc.entries || []).filter(e => { if (!e.role_slug || seen.has(e.role_slug)) return false; seen.add(e.role_slug); return true }) }, [rc.entries])

  // ── View / content state ──
  const [viewMode, setViewMode] = useState('table')          // 'table' | 'gallery'
  const [contentMode, setContentMode] = useState('scenes')    // 'scenes' | 'shots'
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState([])
  const [sortField, setSortField] = useState('')
  const [sortDir, setSortDir] = useState('asc')
  const [groupBy, setGroupBy] = useState('')
  const [shotGroupBy, setShotGroupBy] = useState('scene')
  const [gallerySize, setGallerySize] = useState('md')
  const [thumbSize, setThumbSize] = useState('sm')
  const [thumbRevision, setThumbRevision] = useState(0)
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  // S3b step 2: "List order" — the list's own positions — is the default
  // sort while a list is on screen. It is the sort select's empty value, so
  // a saved view that never chose a sort opens in it; the other sorts are
  // as they were. Move up / Move down are offered only in it.
  const listOrder = viewingList && !sortField

  // ── Saved views ──
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || '[]') } catch { return [] }
  })
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')

  // ── Popups ──
  const [detailSceneId, setDetailSceneId] = useState(null)
  const [detailShotId, setDetailShotId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [shotPickerOpen, setShotPickerOpen] = useState(false)
  const shotPickerRef = useRef(null)

  // ── Shot takes (milestone 2) ──
  // …and, since S3b, the shot-list seats (D8): managers, members AND
  // reviewers write lists; set active and archive are a project manager's
  // or a workspace admin's; on the Local Server (no roles) both are open.
  const { canWrite: canWriteProject, writeReason, can: canOn, reasonFor } = useProjectAccess()
  const canListWrite = canOn('project.shotlist.write')
  const canListActivate = canOn('project.shotlist.activate')
  const supportsBins = !!ctx?.supportsBins
  const shotTakes = ctx?.shotTakes || []
  const binFiles = ctx?.binFiles || []
  const bins = ctx?.bins || []
  const takesByShotMap = useMemo(() => takesByShot(shotTakes, binFiles), [shotTakes, binFiles])
  const [takesShotId, setTakesShotId] = useState(null)     // the takes dialog, from a row
  const [pickerShotId, setPickerShotId] = useState(null)   // the picker, from the dialog or the popup
  const [takesBusy, setTakesBusy] = useState(false)
  const [takesNotice, setTakesNotice] = useState(null)
  // posterRev: a poster the provider's browser probe posted after the chip
  // first asked (no ffmpeg) changes the URL, so the icon becomes the frame.
  const takeThumbUrlFor = useCallback((id) => ctx?.binFileThumbnailUrl?.(id, ctx?.binsInfo?.posterRev || 0) || null, [ctx])
  const binPathFor = useCallback((id) => binPathLabel(bins, id), [bins])
  // Posters and the `online` flag come from the bins list route; load it once
  // per project so the chips are right even if the Bins tab was never opened.
  // 🚨 ctx through a ref: its identity changes on every provider update.
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  // S3a's "Recently removed" mark lasts while the person stays here (Audrey,
  // 2026-09-30, confirmed 2026-10-01): it ends when the tab mounts (a Ctrl+Z
  // on another tab is not "right after"), when it unmounts, and when
  // R.A.B.B.I.T. stops being the page shown (pageActive, Rabbit.jsx's
  // `currentPage === 'rabbit'`; every page stays mounted).
  useEffect(() => {
    ctxRef.current?.clearRecentlyWithdrawn?.()
    return () => ctxRef.current?.clearRecentlyWithdrawn?.()
  }, [])
  useEffect(() => {
    if (!pageActive) ctxRef.current?.clearRecentlyWithdrawn?.()
  }, [pageActive])
  // The shot lists' one place to say what was refused (ShotLists' Banner):
  // the bar's verbs, a row's list verbs, and ctx.error.
  const [listError, setListError] = useState(null)
  useEffect(() => {
    const c = ctxRef.current
    if (!supportsBins || !project?.id || c?.binsInfo?.loadedFor === project.id) return
    // Named, not swallowed: without the list the chips show whatever
    // loadProject left in state, with no posters and no online flags.
    c?.refreshBins?.().catch(e => setTakesNotice(`Could not load the bins: ${e?.message || e}`))
  }, [supportsBins, project?.id])
  const takeFail = (err, what) => { console.error(`Failed to ${what}:`, err); setTakesNotice(`Could not ${what}: ${err?.message || err}`) }
  const handleAssignTakes = useCallback(async (shotId, fileIds, role) => {
    if (!fileIds?.length) return
    setTakesBusy(true); setTakesNotice(null)
    try {
      const res = await ctx?.assignShotTakes?.(fileIds.map(id => ({ shot_id: shotId, bin_file_id: id, ...(role ? { role } : {}) })))
      setPickerShotId(null)
      const n = res?.created?.length || 0; const k = res?.skipped?.length || 0
      if (k) setTakesNotice(`${n} assigned · ${k} already on this shot`)
    } catch (err) { takeFail(err, 'assign takes') }
    finally { setTakesBusy(false) }
  }, [ctx])
  const handleUpdateTake = useCallback(async (id, patch) => {
    try { await ctx?.updateShotTake?.(id, patch) } catch (err) { takeFail(err, 'update the take') }
  }, [ctx])
  const handleRemoveTakes = useCallback(async (ids) => {
    try { await ctx?.removeShotTakes?.(ids) } catch (err) { takeFail(err, 'unassign the take') }
  }, [ctx])
  const handleReorderTakes = useCallback(async (shotId, ids) => {
    try { await ctx?.reorderShotTakes?.(shotId, ids) } catch (err) { takeFail(err, 'reorder the takes') }
  }, [ctx])
  // Q6: frame_count is never overwritten by an assignment; this is the one click.
  const handleUseTakeLength = useCallback(async (shotId, frames) => {
    try { await ctx?.updateShot?.(shotId, { frame_count: frames }) } catch (err) { takeFail(err, 'set the frame count') }
  }, [ctx])
  const takesApi = useMemo(() => ({
    supports: supportsBins, map: takesByShotMap, thumbUrlFor: takeThumbUrlFor, canWrite: canWriteProject && supportsBins,
    open: setTakesShotId, openPicker: setPickerShotId, binPathFor, projectId: project?.id || null,
    onUpdate: handleUpdateTake, onRemove: handleRemoveTakes, onReorder: handleReorderTakes, onUseLength: handleUseTakeLength,
    notice: takesNotice, clearNotice: () => setTakesNotice(null),
  }), [supportsBins, takesByShotMap, takeThumbUrlFor, canWriteProject, binPathFor, project?.id, handleUpdateTake, handleRemoveTakes, handleReorderTakes, handleUseTakeLength, takesNotice])
  // "Open in Scenes" from the bin inspector lands on the shot's detail popup.
  // Declined (false) until the shot is in state, so the request is retried
  // rather than lost; a payload for another project is dropped by the hook.
  // S3b: found among EVERY row (ctx.shotById), as the popup finds it — a
  // shot another list holds still opens.
  const shotById = ctx?.shotById
  const sceneById = ctx?.sceneById
  // Post-overhaul S3c, step 7 (S3b-08): another row's popup opened over one
  // with typed text in it would drop the text (each popup is its row's own):
  // the popup's D21 question asks first, and Cancel keeps it. The same row's
  // popup is no change.
  const detailRef = useRef({ shot: null, scene: null })
  detailRef.current = { shot: detailShotId, scene: detailSceneId }
  const onNavigate = useCallback((p) => {
    if (p?.shotId) {
      if (!shotById?.(p.shotId)) return false
    } else if (p?.sceneId) {
      if (!sceneById?.(p.sceneId)) return false
    }
    const open = () => {
      if (p?.shotId) { setDetailShotId(p.shotId); setDetailSceneId(null) }
      else if (p?.sceneId) setDetailSceneId(p.sceneId)
    }
    const now = detailRef.current
    const same = p?.shotId ? (now.shot === p.shotId && !now.scene) : (p?.sceneId && now.scene === p.sceneId)
    if (!same && hasUnsavedWork('popup')) {
      confirmLeave('popup').then((go) => { if (go) open() })
      return true
    }
    open()
    return true
  }, [shotById, sceneById])
  useNavigateTarget('scenes', onNavigate, project?.id || null)
  // Ctrl+Z / Ctrl+Y on this tab, the way the Bins tab and the timeline bind
  // them: the provider's history holds every takes mutation (and every
  // scene and shot edit). Never while typing in a field, and never behind a
  // question (review round one, R1-08: window.confirm, which three of the
  // four questions were, blocked every key; the kit Dialog does not, and an
  // edit reverted behind a bulk delete's question) — this page's own, or
  // any other the kit puts on screen over it (round two, R2-01: a popup's
  // FileManager "Delete file" or RelationsPanel "Create task";
  // `questionOnScreen`, at ConfirmDialog). With a popup open the keys undo
  // as they always did (C1).
  //
  // 🚨 S4a-07 (S3b step 7): every page stays mounted and this listens on the
  // DOCUMENT, so from another page Ctrl+Z undid R.A.B.B.I.T.'s last edit —
  // S4a's finding for the Bins keys (S2a-01), here too. It acts only while
  // R.A.B.B.I.T. is the page on screen (`pageActive`, Rabbit.jsx's), and
  // stands down under what this tab did not open over itself, as the Bins
  // keys do: a kit menu on screen (a row's or the bar's), the settings
  // drawer (not on the kit's overlay stack) or focus inside one, and any kit
  // dialog while none of this tab's own surfaces is open — the shot lists'
  // picker, form and Add from another list among them. The tab's own — its
  // two popups and the takes dialogs — keep the keys (C1: R1-08 and R2-01
  // undo with a popup open); a question over them still stops them.
  // BudgetView and TimelineView bind the same keys with the same defect;
  // they stay with their owners (the hand-off says so).
  // Review round 1 (R1-07): the tab's own surfaces are the ones that RENDER.
  // A popup whose row is gone (Ctrl+Z took the scene it showed) draws
  // nothing, and its id must not keep every other dialog's keys live — nor
  // re-open the popup by itself when Ctrl+Y brings the row back: such an id
  // is cleared (below).
  const ownSurfaceRef = useRef(false)
  // Review round 2 (R2-01): how many bulk deletes are running. Each is ONE
  // undo step (deleteAsOneStep), and its step joins the history only when
  // its last delete has answered — until then a Ctrl+Z took back the step
  // BEFORE it (and a delete that landed during that undo was dropped from
  // the history: the provider's batch is one global slot, and a replay
  // records nothing). So the keys stand down while one runs.
  const bulkPendingRef = useRef(0)
  ownSurfaceRef.current = !!((detailSceneId && sceneById?.(detailSceneId)) || (detailShotId && shotById?.(detailShotId))
    || (takesShotId && shotById?.(takesShotId)) || (pickerShotId && shotById?.(pickerShotId)))
  useEffect(() => {
    if (detailSceneId && !sceneById?.(detailSceneId)) setDetailSceneId(null)
    if (detailShotId && !shotById?.(detailShotId)) setDetailShotId(null)
    if (takesShotId && !shotById?.(takesShotId)) setTakesShotId(null)
    if (pickerShotId && !shotById?.(pickerShotId)) setPickerShotId(null)
  }, [detailSceneId, detailShotId, takesShotId, pickerShotId, sceneById, shotById])
  // Post-overhaul S3c, step 4 (D13): with a DRAFT on screen the keys are the
  // draft's — its own undo, a change at a time — and the provider's stand
  // down (RabbitProvider's editDraftHeldRef) while it is unsaved. Bound
  // wherever the page is on screen; without a draft, only where the bins
  // are, as before (S3b trap 14).
  const draftListRef = useRef(null)
  draftListRef.current = editSession.mode === 'draft' ? editSession.list?.id || null : null
  useEffect(() => {
    if (!pageActive) return
    const h = (e) => {
      const draftList = draftListRef.current
      if (!draftList && !supportsBins) return
      if (questionOnScreen()) return
      if (!(e.ctrlKey || e.metaKey)) return
      if (bulkPendingRef.current > 0) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (menuOnScreen() || drawerOnScreen() || (t && typeof t.closest === 'function' && t.closest('.ui-drawer'))) return
      if (!ownSurfaceRef.current && visibleOverlayOpen({ dialogsOnly: true })) return
      const isZ = e.key === 'z' || e.key === 'Z'
      const isY = e.key === 'y' || e.key === 'Y'
      if (!isZ && !isY) return
      e.preventDefault()
      const again = isY || e.shiftKey
      if (draftList) {
        if (again) ctxRef.current?.redoEditDraft?.(draftList)
        else ctxRef.current?.undoEditDraft?.(draftList)
        return
      }
      if (again) ctxRef.current?.redo?.()
      else ctxRef.current?.undo?.()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [supportsBins, pageActive])

  function toggleGroup(key) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── Lookups ──
  const assetCountByScene = useMemo(() => {
    const map = {}
    for (const a of assets) {
      if (!a.scene_id) continue
      map[a.scene_id] = (map[a.scene_id] || 0) + 1
    }
    return map
  }, [assets])

  const taskCountByScene = useMemo(() => {
    const map = {}
    for (const t of tasks) {
      if (!t.scene_id) continue
      map[t.scene_id] = (map[t.scene_id] || 0) + 1
    }
    return map
  }, [tasks])

  // In List order a scene's shots keep the list's order (S3b step 2); in any
  // other sort, shot-number order as before.
  const shotsByScene = useMemo(() => groupShotsByScene(shots, { keepOrder: listOrder }), [shots, listOrder])
  // Every shot of each scene, in every list (S3b step 1): what a scene's
  // Delete question counts (deleteScene takes them all, R1-01), and what its
  // next shot number counts past.
  const allShotsByScene = useMemo(() => groupShotsByScene(allShots), [allShots])

  // ── Frame / runtime totals per scene ──
  const sceneTotals = useMemo(() => {
    const result = {}
    for (const sc of scenes) {
      const sceneShots = shotsByScene[sc.id] || []
      const totalFrames = sceneShots.reduce((sum, sh) => sum + (Number(sh.frame_count) || 0), 0)
      result[sc.id] = { totalFrames, runtime: framesToTimecode(totalFrames, fps) }
    }
    return result
  }, [scenes, shotsByScene, fps])

  // ── Grand totals ──
  const grandTotals = useMemo(() => {
    const totalFrames = scenes.reduce((sum, sc) => sum + (sceneTotals[sc.id]?.totalFrames || 0), 0)
    return {
      runtime: framesToTimecode(totalFrames, fps),
      frames: totalFrames,
      scenes: scenes.length,
      shots: shots.length,
    }
  }, [scenes, shots.length, sceneTotals, fps])

  // ── Auto-naming helpers ──
  // Thin wrappers over ../entityNaming so this view, the settings preview and
  // S26's folder tree all produce the same strings. See that module's header.
  // Numbers count past EVERY scene and shot of the project (S3b step 1), not
  // only the rows of the list on screen.
  const nextSceneNumber = useMemo(
    () => nextSceneNumberFor(allScenes, project),
    [allScenes, project?.scene_start_number],
  )

  const formatSceneCode = useCallback(
    (num) => sceneCodeFor(project, num),
    [project?.project_code, project?.scene_separator, project?.scene_digits],
  )

  const nextShotNumberForScene = useCallback(
    (sceneId) => nextShotNumberFor(allShotsByScene[sceneId] || [], project),
    [allShotsByScene, project?.scene_start_number],
  )

  const formatShotCode = useCallback(
    (sceneNum, shotNum) => shotCodeFor(project, sceneNum, shotNum),
    [project?.project_code, project?.scene_separator, project?.scene_digits, project?.shot_digits],
  )

  // ── CRUD handlers ──
  // S3b step 2: a new scene or shot joins the list on SCREEN (S3a's
  // `{ listId }`), not the active one, so it appears where it was made. With
  // no list on screen the provider's own rule stands (the active list, if
  // the project has one: 'pending' is that list before it has loaded).
  // Review round 1 (R1-02): "Not in any list" makes its rows in NO list, so
  // they appear where they were made (`{ listId: null }`); an archived list
  // is read-only, so nothing is made "in" it — New scene, New shot and Add
  // shot are greyed there, saying why. Without either, the provider put the
  // row in the ACTIVE list: on every other tab, and nowhere on this screen.
  const newRowOpts = useMemo(() => (viewed.mode === 'list' ? { listId: viewed.id }
    : viewed.mode === 'unlisted' ? { listId: null } : undefined), [viewed.mode, viewed.id])
  // Post-overhaul S3c, step 3: nor while an EDIT is on screen — a new row
  // would land in the list, out of sight of the cut; the cut has its own
  // verbs for that (a row's or a scene's edit actions).
  const canAddRows = canWriteProject && viewed.mode !== 'archived' && !editOnScreen
  const addReason = !canWriteProject ? undefined
    : editOnScreen ? EDIT_ADD_REASON
    : viewed.mode === 'archived' ? ARCHIVED_ADD_REASON : undefined
  // S3b step 7: every funnel checks the entity gate too (the Tasks tab's
  // Session 29 rule) — a greyed control is not the only way in (a key, a
  // stale closure, a later caller).
  const handleNewScene = useCallback(async () => {
    if (!canAddRows) return
    const num = nextSceneNumber
    const name = formatSceneCode(num)
    try {
      await ctx?.addScene({
        name,
        scene_number: num,
        status: 'not_started',
        type: 'interior',
      }, newRowOpts)
    } catch (err) {
      // Said, not only logged (review round 2, R1-22): the provider's
      // addScene throws without setting ctx.error ("the person sees the
      // error and nothing half-made"), so the tab's Banner says it.
      console.error('Failed to create scene:', err)
      setListError(err?.message || String(err))
    }
  }, [ctx, nextSceneNumber, formatSceneCode, newRowOpts, canAddRows])

  const handleNewShot = useCallback(async (sceneId) => {
    if (!canAddRows) return
    const scene = sceneById?.(sceneId)
    const nextNum = nextShotNumberForScene(sceneId)
    const name = formatShotCode(scene?.scene_number ?? 0, nextNum)
    try {
      await ctx?.addShot({
        scene_id: sceneId,
        name,
        shot_number: nextNum,
        status: 'not_started',
        type: 'other',
        frame_count: 0,
      }, newRowOpts)
    } catch (err) {
      console.error('Failed to create shot:', err)
      setListError(err?.message || String(err))
    }
  }, [ctx, sceneById, nextShotNumberForScene, formatShotCode, newRowOpts, canAddRows])

  // ── The cut's own verbs (post-overhaul S3c, step 4; D13, D16) ──
  // A row's or a scene block's edit actions, while an edit or a draft is on
  // screen. Each goes through useEditChanges: on a draft it changes the draft
  // at once; otherwise the first-change question opens, and nothing changes
  // until Yes. Only the ORDER is the edit's: Move, Duplicate, Remove and Add
  // change the draft; New shot also makes a real shot ON THE LIST (D6:
  // "entirely new shots" are real shot rows), so it needs the seat that
  // writes scenes and shots, and a scene that exists. Reviewers write edits
  // (project.shotlist.write) like lists. Items are found by id inside each
  // change, so a change computed from what is on screen lands on the draft
  // as it is when it runs.
  const canEditCut = canListWrite && !!editSession.list && !editSession.readOnly
  const reportCutError = useCallback((err) => setListError(err?.message || String(err)), [])
  const editChanges = useEditChanges({ ctx, session: editSession, canEdit: canEditCut, onError: reportCutError })
  const requestCut = editChanges.request
  // "Add shot…": where the picked shots go — after an item (null: at the end
  // of the cut), into a scene block (undefined: each into its own scene's).
  const [addShotsAt, setAddShotsAt] = useState(null)   // { afterId, sceneId, where, preferSceneId }
  // About the cut it opened on: it closes when another list or edit comes on
  // screen, or the cut stops being changeable here (archived meanwhile).
  useEffect(() => { setAddShotsAt(null) }, [viewed.id, editSession.mode, editSession.row?.id, canEditCut])
  const cutSearching = !!search.trim()
  const makeShotIn = useCallback(async (sceneId) => {
    if (!canWriteProject || !canEditCut) throw new Error('This seat cannot add a shot to the list.')
    const scene = sceneById?.(sceneId)
    if (!scene) throw new Error('That scene is no longer in this project.')
    const nextNum = nextShotNumberForScene(sceneId)
    return ctx.addShot({
      scene_id: sceneId,
      name: formatShotCode(scene.scene_number ?? 0, nextNum),
      shot_number: nextNum,
      status: 'not_started',
      type: 'other',
      frame_count: 0,
    }, { listId: editSession.list.id })
  }, [ctx, canWriteProject, canEditCut, sceneById, nextShotNumberForScene, formatShotCode, editSession.list?.id])
  const newShotItem = useCallback((afterId, sceneId) => (its, shot) => (
    shot ? insertAfter(its, afterId, itemsForShots([shot], uuidv4, { sceneId })) : null
  ), [])
  // The shot New shot wrote, kept on the draft: Discard changes says it stays (R1-04).
  const madeShot = useCallback((shot) => (shot?.id ? [shot.id] : []), [])
  const cutRowMenu = useCallback((r) => {
    if (!canEditCut) return []
    const last = (editSession.items?.length || 0) - 1
    const id = r.item.id
    const sceneId = r.item.scene_id || null
    const scene = sceneId ? sceneById?.(sceneId) : null
    const moveHint = cutSearching ? 'clear the search' : undefined
    return [
      { label: 'Move up', Icon: ArrowUp, disabled: cutSearching || r.index === 0, hint: moveHint, onClick: () => requestCut({ what: moveWords(r.name, -1), apply: (its) => stepItem(its, id, -1) }) },
      { label: 'Move down', Icon: ArrowDown, disabled: cutSearching || r.index >= last, hint: moveHint, onClick: () => requestCut({ what: moveWords(r.name, 1), apply: (its) => stepItem(its, id, 1) }) },
      { divider: true },
      { label: 'Duplicate in edit', Icon: Copy, onClick: () => requestCut({ what: duplicateWords(r.name), apply: (its) => duplicateItem(its, id, uuidv4) }) },
      { label: 'Add shot…', Icon: ListPlus, onClick: () => setAddShotsAt({ afterId: id, sceneId, preferSceneId: sceneId, where: `after “${r.name}” (cut ${r.index + 1})` }) },
      {
        label: 'New shot',
        Icon: Plus,
        disabled: !canWriteProject || !scene,
        hint: !canWriteProject ? 'members only' : !scene ? 'no scene' : undefined,
        onClick: () => requestCut({ what: newShotWords(scene.name || 'Untitled scene'), writes: NEW_SHOT_WRITES, prepare: () => makeShotIn(sceneId), apply: newShotItem(id, sceneId), made: madeShot }),
      },
      { divider: true },
      { label: 'Remove from edit', Icon: ListMinus, danger: true, onClick: () => requestCut({ what: removeWords(r.name), apply: (its) => removeItem(its, id) }) },
    ]
  }, [canEditCut, editSession.items, sceneById, cutSearching, requestCut, canWriteProject, makeShotIn, newShotItem, madeShot])
  const cutBandMenu = useCallback((band) => {
    if (!canEditCut) return []
    const all = editSession.items || []
    const firstId = all[band.start]?.id
    const lastId = all[band.end]?.id
    if (!firstId || !lastId) return []
    // The band again in the items the change runs on (by its first and last ids).
    const span = (its) => {
      const s = its.findIndex(i => i.id === firstId)
      const e = its.findIndex(i => i.id === lastId)
      return s < 0 || e < s ? null : [s, e]
    }
    const onSpan = (fn) => (its) => { const at = span(its); return at ? fn(its, at[0], at[1]) : null }
    const scene = band.sceneId ? sceneById?.(band.sceneId) : null
    const moveHint = cutSearching ? 'clear the search' : undefined
    return [
      { label: 'Move scene up', Icon: ArrowUp, disabled: cutSearching || band.start === 0, hint: moveHint, onClick: () => requestCut({ what: moveBlockWords(band.label, -1), apply: onSpan((its, s, e) => stepBand(its, s, e, -1)) }) },
      { label: 'Move scene down', Icon: ArrowDown, disabled: cutSearching || band.end >= all.length - 1, hint: moveHint, onClick: () => requestCut({ what: moveBlockWords(band.label, 1), apply: onSpan((its, s, e) => stepBand(its, s, e, 1)) }) },
      { divider: true },
      { label: 'Duplicate scene in edit', Icon: Copy, onClick: () => requestCut({ what: duplicateBlockWords(band.label), apply: onSpan((its, s, e) => duplicateBand(its, s, e, uuidv4)) }) },
      { label: 'Add shot…', Icon: ListPlus, onClick: () => setAddShotsAt({ afterId: lastId, sceneId: band.sceneId, preferSceneId: band.sceneId, where: `at the end of “${band.label}”` }) },
      {
        label: 'New shot',
        Icon: Plus,
        disabled: !canWriteProject || !scene,
        hint: !canWriteProject ? 'members only' : !scene ? 'no scene' : undefined,
        onClick: () => requestCut({ what: newShotWords(band.label), writes: NEW_SHOT_WRITES, prepare: () => makeShotIn(band.sceneId), apply: newShotItem(lastId, band.sceneId), made: madeShot }),
      },
      { divider: true },
      { label: 'Remove scene from edit', Icon: ListMinus, danger: true, onClick: () => requestCut({ what: removeBlockWords(band.label), apply: onSpan((its, s, e) => removeBand(its, s, e)) }) },
    ]
  }, [canEditCut, editSession.items, sceneById, cutSearching, requestCut, canWriteProject, makeShotIn, newShotItem, madeShot])
  // How many times each shot plays in the cut (the Add shots picker says so).
  const inCut = useMemo(() => {
    const m = new Map()
    for (const it of editSession.items || []) if (it.shot_id) m.set(it.shot_id, (m.get(it.shot_id) || 0) + 1)
    return m
  }, [editSession.items])
  const addShotsToCut = useCallback(async (shotIds) => {
    const at = addShotsAt
    if (!at) return
    const picked = shotIds.map(id => shotById?.(id)).filter(Boolean)
    await requestCut({
      what: addWords(picked.length),
      apply: (its) => insertAfter(its, at.afterId, itemsForShots(picked, uuidv4, at.sceneId === undefined ? {} : { sceneId: at.sceneId })),
    })
    setAddShotsAt(null)
  }, [addShotsAt, shotById, requestCut])

  // ── Drag-and-drop (post-overhaul S3c, step 6; D16) ──
  // On an edit or a draft a drop changes the cut — asking first on a saved
  // edit (D13). On the LIST, in its own order, a drop is Audrey's way to an
  // edit ("before applying the changes please ask the user to confirm if they
  // would like to make a new edit"): it asks D13's question, and Yes puts the
  // draft on screen; the list itself never moves by a drag (its Move up /
  // Move down still reorder it, S3b). Only a list in List order can be
  // dragged (another sort's rows are not in the list's order), and the shot
  // table only while it groups by scene. No drop writes anything: the change
  // is the draft's, and the provider's one batch slot is never held (S3b-10).
  const listDragOn = canEditCut && viewed.mode === 'list' && editSession.mode === 'none' && listOrder
  const cutDragOn = canEditCut && editSession.mode !== 'none'
  const onCutDrop = useCallback((d, t, where) => {
    const onList = d.kind === 'scene' || d.kind === 'shot'
    const sceneName = (id) => sceneById?.(id)?.name || 'Untitled scene'
    const shotName = (id) => shotById?.(id)?.name || 'Untitled shot'
    const rowName = (id) => editSession.rows?.find(r => r.item.id === id)?.name || ''
    const bandName = (id) => {
      const at = (editSession.items || []).findIndex(it => it.id === id)
      return editSession.bands?.find(b => b.start === at)?.label || ''
    }
    const what = onList
      ? dropWords({ dragName: d.kind === 'scene' ? sceneName(d.id) : shotName(d.id), dragIsScene: d.kind === 'scene', targetName: t.kind === 'scene' ? sceneName(t.id) : shotName(t.id), targetIsScene: t.kind === 'scene', where })
      : dropWords({ dragName: d.kind === 'band' ? bandName(d.id) : rowName(d.id), dragIsScene: d.kind === 'band', targetName: t.kind === 'band' ? bandName(t.id) : rowName(t.id), targetIsScene: t.kind === 'band', where })
    requestCut({ what, apply: (its) => (onList ? dropOnList(its, d, t, where) : dropOnCut(its, d, t, where)) })
  }, [sceneById, shotById, editSession.rows, editSession.items, editSession.bands, requestCut])
  const cutDrag = useCutDrag({ onDrop: onCutDrop })

  // Review round 1 (R1-01): S3a's deleteScene takes EVERY shot of the scene,
  // in every list, and its ONE undo step puts the scene, each shot, every
  // membership and every task link back. Deleting each shot first (as this
  // did since before S3b, and step 1 widened to every list) split that into
  // one undo step per shot — past the history's ten, shots no undo could
  // bring back.
  const handleDeleteScene = useCallback(async (id) => {
    if (!canWriteProject) { setConfirmDelete(null); return }
    try {
      await ctx?.deleteScene?.(id)
    } catch (err) { console.error('Failed to delete scene:', err) }
    setConfirmDelete(null)
    if (detailSceneId === id) setDetailSceneId(null)
  }, [ctx, detailSceneId, canWriteProject])

  const handleDeleteShot = useCallback(async (id) => {
    if (!canWriteProject) { setConfirmDelete(null); return }
    try {
      await ctx?.deleteShot?.(id)
    } catch (err) { console.error('Failed to delete shot:', err) }
    setConfirmDelete(null)
  }, [ctx, canWriteProject])

  // ── The list's own order (S3b step 2) ──
  // Move up / Move down in List order, the takes panel's pattern (drag
  // handles are S3c's). A scene moves among the list's scenes; a shot among
  // its own scene's shots (positions restart per scene, S3a). Each moves past
  // the neighbour the person SEES — under a search or a filter, the next row
  // on screen, not a hidden one — and the whole group's order is written
  // (S3a's reorderShotListItems writes only the rows whose position changed).
  // A scene shown only because one of its shots is in the list has no
  // position of its own: it does not move, and is never a neighbour.
  const shotListItems = ctx?.shotListItems
  const ownSceneIds = useMemo(() => {
    if (!viewingList) return new Set()
    return new Set((shotListItems || []).filter(i => i.shot_list_id === viewed.id && i.scene_id).map(i => i.scene_id))
  }, [shotListItems, viewingList, viewed.id])
  const moveGroup = useCallback((kind, id, visibleIds) => {
    if (kind === 'scene') {
      const own = (x) => ownSceneIds.has(x)
      return { full: scenes.map(s => s.id).filter(own), visible: visibleIds.filter(own) }
    }
    const sceneOf = (x) => shotById?.(x)?.scene_id || null
    const same = (x) => sceneOf(x) === sceneOf(id)
    return { full: shots.map(s => s.id).filter(same), visible: visibleIds.filter(same) }
  }, [ownSceneIds, scenes, shots, shotById])
  const moveTarget = useCallback((kind, id, dir, visibleIds) => {
    const { full, visible } = moveGroup(kind, id, visibleIds)
    const at = visible.indexOf(id)
    const neighbour = at < 0 ? undefined : visible[at + dir]
    if (!neighbour) return null
    const next = full.filter(x => x !== id)
    const n = next.indexOf(neighbour)
    next.splice(dir < 0 ? n : n + 1, 0, id)
    return next
  }, [moveGroup])
  const moveInList = useCallback(async (kind, id, dir, visibleIds) => {
    const next = moveTarget(kind, id, dir, visibleIds)
    if (!next) return
    try { await ctx?.reorderShotListItems?.(viewed.id, next) } catch (err) { setListError(err?.message || String(err)) }
  }, [ctx, moveTarget, viewed.id])

  // A row's shot-list verbs, for its More menu (RowMore): null when none
  // applies (no list on screen, or an archived one — read-only).
  // S3b step 6: in a list, Remove from this list (it asks first, naming the
  // lists that keep the row — a removal is not a Delete, D1 + D3; ShotLists
  // asks it, with the other list questions); in the "Not in any list" view,
  // Add to list — each live list, one click.
  // removeAsk: { kind, ids, done } — `done` clears a bulk selection.
  const [removeAsk, setRemoveAsk] = useState(null)
  const closeRemoveAsk = useCallback(() => setRemoveAsk(null), [])
  // A question about the list on screen does not outlive it.
  useEffect(() => { setRemoveAsk(null) }, [viewed.id, viewed.mode])
  // In the lists' one order (S3a's sortShotLists), as the names' titles are.
  const liveLists = useMemo(() => sortShotLists((ctx?.shotLists || []).filter(l => !l.archived_at)), [ctx?.shotLists])
  const listLabel = useCallback((row) => ctx?.formatShotListLabel?.(row) || '', [ctx])
  const addRowToList = useCallback(async (kind, row, listId) => {
    try {
      await ctx?.addToShotList?.(listId, kind === 'scene' ? { sceneId: row.id } : { shotId: row.id })
    } catch (err) { setListError(err?.message || String(err)) }
  }, [ctx])
  const rowListMenu = useCallback((kind, row, visibleIds) => {
    if (viewed.mode === 'unlisted' && canListWrite && liveLists.length) {
      return [
        { header: 'Add to list' },
        ...liveLists.map(l => ({ label: listLabel(l), onClick: () => addRowToList(kind, row, l.id) })),
      ]
    }
    if (viewed.mode !== 'list' || !canListWrite) return null
    const items = []
    if (listOrder && (kind !== 'scene' || ownSceneIds.has(row.id))) {
      items.push(
        { label: 'Move up', Icon: ArrowUp, disabled: !moveTarget(kind, row.id, -1, visibleIds), onClick: () => moveInList(kind, row.id, -1, visibleIds) },
        { label: 'Move down', Icon: ArrowDown, disabled: !moveTarget(kind, row.id, 1, visibleIds), onClick: () => moveInList(kind, row.id, 1, visibleIds) },
        { divider: true },
      )
    }
    items.push({ label: 'Remove from this list', Icon: ListMinus, onClick: () => setRemoveAsk({ kind, ids: [row.id] }) })
    return items
  }, [viewed.mode, canListWrite, liveLists, listLabel, addRowToList, listOrder, ownSceneIds, moveTarget, moveInList])
  // The bulk bars' Remove from list: the same question, for the selection
  // (`done` clears it once the rows are out).
  const bulkRemove = useMemo(() => (viewed.mode === 'list' && canListWrite
    ? (kind, ids, done) => setRemoveAsk({ kind, ids, done })
    : undefined), [viewed.mode, canListWrite])

  // D10: a scene's or shot's name carries the lists it belongs to in its
  // title — "In: Shoot · v1, Pickups · v2" — LIVE lists only (S3a's
  // listsContaining counts archived and withdrawn ones; to the people who
  // set those aside they are gone, and "Not in any list" agrees). Built once
  // per change of the lists, not per row: a scene is in a list that names it
  // or one of its shots (S3a's rule, through scenesOf / shotsOf).
  const scenesOf = ctx?.scenesOf
  const shotsOf = ctx?.shotsOf
  const inListsTitle = useMemo(() => {
    if (!(ctx?.shotLists || []).length) return () => undefined
    const byId = new Map()
    const add = (id, l) => { if (!byId.has(id)) byId.set(id, []); byId.get(id).push(l) }
    for (const l of liveLists) {
      for (const s of scenesOf?.(l.id) || []) add(s.id, l)
      for (const sh of shotsOf?.(l.id) || []) add(sh.id, l)
    }
    return (id) => {
      const ls = byId.get(id)
      return ls ? `In: ${sortShotLists(ls).map(listLabel).join(', ')}` : 'In no shot list'
    }
  }, [ctx?.shotLists, liveLists, scenesOf, shotsOf, listLabel])

  // Delete's words (S3b step 6, membershipCopy): from the project, and so
  // from every list that holds the rows — archived ones too, which lose them
  // as well — and, while the live list on screen holds them and this person
  // may write lists, the verb that takes them out of it alone. `where` is
  // where that verb is: a row's (or card's) menu, or the selection bar.
  const describeDelete = useCallback((kind, ids, where = 'row') => {
    const rowOf = kind === 'scene' ? sceneById : shotById
    const holding = new Map()
    let allOnScreen = ids.length > 0
    for (const id of ids) {
      const ls = ctx?.listsContaining?.(id) || []
      for (const l of ls) holding.set(l.id, l)
      if (!ls.some(l => l.id === viewed.id)) allOnScreen = false
    }
    return deleteQuestion({
      kind,
      names: ids.map(id => rowOf?.(id)?.name || 'Untitled'),
      shotCount: kind === 'scene' ? ids.reduce((n, id) => n + (allShotsByScene[id] || []).length, 0) : 0,
      lists: sortShotLists([...holding.values()]).map(l => ({ label: listLabel(l), archived: !!l.archived_at })),
      onScreen: viewed.mode === 'list' && canListWrite && viewed.list && allOnScreen ? listLabel(viewed.list) : null,
      removeWhere: where,
    }).join(' ')
  }, [ctx, sceneById, shotById, allShotsByScene, viewed.mode, viewed.id, viewed.list, canListWrite, listLabel])

  // ── Saved views ──
  function saveCurrentView() {
    if (!saveName.trim()) return
    const view = { id: Date.now().toString(), name: saveName.trim(), filters, sortField, sortDir, groupBy, viewMode, gallerySize, thumbSize, contentMode }
    const next = [...savedViews, view]
    setSavedViews(next)
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next))
    setSaveName('')
    setShowSaveDialog(false)
  }
  function loadView(view) {
    setFilters(view.filters || [])
    setSortField(view.sortField || '')
    setSortDir(view.sortDir || 'asc')
    setGroupBy(view.groupBy || '')
    setViewMode(view.viewMode || 'table')
    setGallerySize(view.gallerySize || 'md')
    if (view.thumbSize) setThumbSize(view.thumbSize)
    if (view.contentMode) setContentMode(view.contentMode)
  }
  function deleteView(id) {
    const next = savedViews.filter(v => v.id !== id)
    setSavedViews(next)
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next))
  }

  // ── Filter helpers ──
  function addFilter() { setFilters(prev => [...prev, { field: 'status', op: 'is', value: '' }]) }
  function updateFilter(index, patch) { setFilters(prev => prev.map((f, i) => i === index ? { ...f, ...patch } : f)) }
  function removeFilter(index) { setFilters(prev => prev.filter((_, i) => i !== index)) }

  function matchesFilter(row, f) {
    const val = (row[f.field] || '').toString().toLowerCase()
    const fv = (f.value || '').toString().toLowerCase()
    switch (f.op) {
      case 'is':           return val === fv
      case 'is_not':       return val !== fv
      case 'contains':     return val.includes(fv)
      case 'not_contains': return !val.includes(fv)
      case 'is_empty':     return !val
      case 'is_not_empty': return !!val
      default:             return true
    }
  }

  // ── Scene filtering + sorting ──
  const filtered = useMemo(() => {
    let list = scenes
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(s => (s.name || '').toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q))
    }
    for (const f of filters) {
      if (!f.value && !['is_empty', 'is_not_empty'].includes(f.op)) continue
      list = list.filter(s => matchesFilter(s, f))
    }
    return list
  }, [scenes, search, filters])

  const sorted = useMemo(() => {
    if (!sortField) return filtered
    return [...filtered].sort((a, b) => {
      let av = a[sortField] ?? '', bv = b[sortField] ?? ''
      if (sortField === 'status') {
        av = SCENE_STATUSES.indexOf(av); bv = SCENE_STATUSES.indexOf(bv)
      } else if (sortField === 'type') {
        av = SCENE_TYPES.indexOf(av); bv = SCENE_TYPES.indexOf(bv)
      } else if (sortField === 'time_of_day') {
        av = TIME_OF_DAY_OPTIONS.indexOf(av); bv = TIME_OF_DAY_OPTIONS.indexOf(bv)
      } else if (typeof av === 'string') {
        av = av.toLowerCase(); bv = (bv || '').toLowerCase()
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortField, sortDir])

  // ── Groups ──
  // A group's words in sentence case (a status's are the kit's STATUS
  // labels, which humanizeStatus spells the same). Its colour accent is gone:
  // a status group carries the kit's StatusDot instead (R3-11).
  const groups = useMemo(() => {
    if (!groupBy) return null
    const map = {}
    for (const s of sorted) {
      const key = s[groupBy] || '__empty__'
      if (!map[key]) map[key] = { key, label: key === '__empty__' ? 'None' : humanizeStatus(key), scenes: [] }
      map[key].scenes.push(s)
    }
    return Object.values(map)
  }, [sorted, groupBy])

  // ── Shot mode filtering + sorting ──
  const sceneMap = useMemo(() => {
    const m = {}
    for (const s of scenes) m[s.id] = s
    return m
  }, [scenes])

  const filteredShots = useMemo(() => {
    let list = shots
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(s => (s.name || '').toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q))
    }
    if (contentMode === 'shots') {
      for (const f of filters) {
        if (!f.value && !['is_empty', 'is_not_empty'].includes(f.op)) continue
        list = list.filter(s => matchesFilter(s, f))
      }
    }
    return list
  }, [shots, search, filters, contentMode])

  const sortedShots = useMemo(() => {
    if (contentMode !== 'shots' || !sortField) return filteredShots
    return [...filteredShots].sort((a, b) => {
      let av = a[sortField] ?? '', bv = b[sortField] ?? ''
      if (sortField === 'status') {
        av = SCENE_STATUSES.indexOf(av); bv = SCENE_STATUSES.indexOf(bv)
      } else if (sortField === 'type') {
        av = SCENE_TYPES.indexOf(av); bv = SCENE_TYPES.indexOf(bv)
      } else if (sortField === 'time_of_day') {
        av = TIME_OF_DAY_OPTIONS.indexOf(av); bv = TIME_OF_DAY_OPTIONS.indexOf(bv)
      } else if (sortField === 'frame_count' || sortField === 'shot_number') {
        av = Number(av) || 0; bv = Number(bv) || 0
      } else if (typeof av === 'string') {
        av = av.toLowerCase(); bv = (bv || '').toLowerCase()
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredShots, sortField, sortDir, contentMode])

  const shotGroups = useMemo(() => {
    // No grouping — flat list in one group
    if (!shotGroupBy) {
      return [{ key: '__all__', label: null, groupType: 'none', shots: sortedShots }]
    }

    // Group by scene (original behavior). In List order (S3b step 2) the
    // groups follow the list's scene order and each keeps the list's shot
    // order; unlinked shots stay last.
    if (shotGroupBy === 'scene') {
      const buckets = {}
      for (const sh of sortedShots) {
        const key = sh.scene_id || '__unlinked__'
        if (!buckets[key]) buckets[key] = []
        buckets[key].push(sh)
      }
      let keys
      if (listOrder) {
        const rank = new Map(scenes.map((s, i) => [s.id, i]))
        keys = Object.keys(buckets).sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity))
      } else {
        for (const key of Object.keys(buckets)) {
          buckets[key].sort((a, b) => (a.shot_number ?? 0) - (b.shot_number ?? 0))
        }
        keys = Object.keys(buckets).sort((a, b) => {
          const scA = sceneMap[a]; const scB = sceneMap[b]
          return (scA?.scene_number ?? 9999) - (scB?.scene_number ?? 9999)
        })
      }
      return keys.map(key => ({
        key,
        sceneId: key,
        scene: sceneMap[key] || null,
        label: sceneMap[key]?.name || 'Unlinked shots',
        groupType: 'scene',
        shots: buckets[key],
      }))
    }

    // Group by field (status, type, time_of_day, framing, camera_movement)
    const field = shotGroupBy
    const buckets = {}
    for (const sh of sortedShots) {
      const val = sh[field] || '__none__'
      if (!buckets[val]) buckets[val] = []
      buckets[val].push(sh)
    }
    const keys = Object.keys(buckets).sort((a, b) => {
      if (a === '__none__') return 1
      if (b === '__none__') return -1
      return a.localeCompare(b)
    })
    // Sentence case; a framing or movement code keeps its capitals.
    return keys.map(key => ({
      key,
      label: key === '__none__' ? 'Unset' : humanizeStatus(key),
      groupType: 'field',
      shots: buckets[key],
    }))
  }, [sortedShots, sceneMap, shotGroupBy, listOrder, scenes])

  const totalFilteredShots = useMemo(() => shotGroups.reduce((n, g) => n + g.shots.length, 0), [shotGroups])
  // S3c step 3: how many of the cut's rows the search finds.
  const cutMatchCount = useMemo(() => {
    if (!editSession.rows) return 0
    const q = search.trim().toLowerCase()
    return q ? editSession.rows.filter(r => r.name.toLowerCase().includes(q)).length : editSession.rows.length
  }, [editSession.rows, search])

  // ── Close shot-picker on outside click ──
  useEffect(() => {
    if (!shotPickerOpen) return
    function handleClick(e) {
      if (shotPickerRef.current && !shotPickerRef.current.contains(e.target)) setShotPickerOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [shotPickerOpen])

  // ── Render ──
  if (!project) {
    return (
      <div className="rb-scene-center">
        <EmptyState Icon={Film} title="No project loaded" />
      </div>
    )
  }

  // One of the toolbar's two size triples (the thumbnails' in the table, the
  // cards' in the gallery — two triples still, as before; R3-25's single
  // triple is recorded for Audrey). Three kit IconButtons in one bordered
  // group; the chosen one is the kit's selected treatment, the signal tint
  // and edge, never the orange fill (R3-18). Each square keeps its size.
  const sizeGroup = (label, value, setValue, noun) => (
    <span className="rb-scene-sizes" role="group" aria-label={label}>
      {SIZE_KEYS.map(key => (
        <IconButton key={key} size="sm" className="rb-scene-size" title={`${key} ${noun}`} active={value === key} onClick={() => setValue(key)}>
          <Square className="rb-scene-size-glyph" data-thumb={key} aria-hidden="true" />
        </IconButton>
      ))}
    </span>
  )

  // S3b step 7: the scene and shot verbs are a project's ENTITY writes
  // (project.entity.write) — a reviewer now writes shot lists but still not
  // the scenes and shots themselves, which the database refuses. The house
  // treatment (Session 29, the Tasks and Assets tabs): a button greyed in
  // GatedAction with the reason on hover (from this provider); a cell plain
  // words, not a control; a select or field disabled; and every funnel
  // checks the gate too.
  return (
    <WriteReasonProvider reason={writeReason}>
    <div className="rb-scene-page">

      {/* ── Summary tiles (always visible): one kit Stat each (R3-10), as
          the Budget's. Stat has no icon slot, so the four icons are gone. ── */}
      <div className="rb-scene-stats">
        {/* Post-overhaul S3c (D20): with an edit on screen the tiles total
            its items in order — a repeated shot counts each time, a missing
            shot not at all — and the runtime says it is the edit's. */}
        {editSession.totals ? (
          <>
            <BigTile label="Edit runtime" value={framesToTimecode(editSession.totals.frames, fps)} />
            <BigTile label="Total frames" value={fmtNumber(editSession.totals.frames)} />
            <BigTile label="Scenes" value={editSession.totals.scenes} />
            <BigTile label="Shots" value={editSession.totals.shots} />
          </>
        ) : (
          <>
            <BigTile label="Total runtime" value={grandTotals.runtime} />
            <BigTile label="Total frames" value={fmtNumber(grandTotals.frames)} />
            <BigTile label="Scenes" value={grandTotals.scenes} />
            <BigTile label="Shots" value={grandTotals.shots} />
          </>
        )}
      </div>

      {/* ── The shot-list bar (post-overhaul S3b, D7): a new row between the
          tiles and the toolbar — what you are viewing, and its verbs; the
          toolbar below is unchanged. ── */}
      <ShotLists
        ctx={ctx}
        viewed={viewed}
        gate={{
          write: canListWrite,
          writeReason: reasonFor('project.shotlist.write'),
          activate: canListActivate,
          activateReason: reasonFor('project.shotlist.activate'),
        }}
        userId={userId}
        error={listError}
        onError={setListError}
        remove={{ ask: removeAsk, close: closeRemoveAsk }}
        // S3c step 4: an edit of the list on screen, in its order (asked first).
        startEdit={viewed.mode === 'list' && editSession.mode === 'none' ? () => requestCut({}) : null}
        pageActive={pageActive}
      />

      {/* ── Toolbar: the kit's, the same sixteen controls in the same order
          at the 28px height (C1). One row at 1440, as it was; narrower, its
          left slot wraps inside itself (each control to the next line, as
          the old row did) and the create buttons keep the first line's end.
          R3-25's regrouping (one size triple, the FPS readout in the header,
          a row that never wraps) is recorded for Audrey, not made. ── */}
      <Toolbar
        className="rb-scene-toolbar"
        right={(
          <>
            {/* The create button for the content mode on show is the one
                primary, as its orange fill was; the other is secondary.
                S3b step 7: each greyed, with the reason, for a seat that
                may not write scenes and shots (a reviewer). */}
            <GatedAction allowed={canAddRows} reason={addReason}>
              <Button size="sm" variant={contentMode === 'scenes' ? 'primary' : 'secondary'} Icon={Plus} onClick={handleNewScene}>
                New scene
              </Button>
            </GatedAction>

            {/* New shot, with its scene picker */}
            <GatedAction allowed={canAddRows} reason={addReason}>
            <span ref={shotPickerRef} className="rb-scene-picker-anchor">
              <Button
                size="sm"
                variant={contentMode === 'shots' ? 'primary' : 'secondary'}
                Icon={Plus}
                disabled={scenes.length === 0}
                aria-expanded={scenes.length > 1 ? shotPickerOpen : undefined}
                onClick={() => {
                  if (scenes.length === 1) { handleNewShot(scenes[0].id); return }
                  if (scenes.length > 1) setShotPickerOpen(o => !o)
                }}
              >
                New shot
                {scenes.length > 1 && <ChevronDown aria-hidden="true" />}
              </Button>
              {shotPickerOpen && scenes.length > 1 && (
                <div className="rb-scene-picker">
                  <div className="rb-scene-picker-head">Add shot to scene:</div>
                  <div className="rb-scene-picker-list">
                    {scenes
                      .slice()
                      .sort((a, b) => (a.scene_number ?? 0) - (b.scene_number ?? 0))
                      .map(sc => (
                        <button key={sc.id} type="button"
                          onClick={() => { handleNewShot(sc.id); setShotPickerOpen(false) }}
                          className="rb-scene-picker-item">
                          <Film className="rb-scene-picker-icon" aria-hidden="true" />
                          <span className="rb-scene-picker-label">{sc.name || 'Untitled'}</span>
                          <span className="rb-scene-picker-count">
                            {(shotsByScene[sc.id] || []).length} shots
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </span>
            </GatedAction>
          </>
        )}
      >
        {/* Content mode: the kit Tabs, the one active treatment (R3-18). */}
        <Tabs
          label="Content"
          panelId={CONTENT_PANEL_ID}
          items={[
            { id: 'scenes', label: 'Scenes', disabled: editOnScreen, title: editOnScreen ? EDIT_ORDER_REASON : undefined },
            { id: 'shots', label: 'Shots', disabled: editOnScreen, title: editOnScreen ? EDIT_ORDER_REASON : undefined },
          ]}
          value={contentMode}
          onChange={setContentMode}
        />

        {/* Filter: the signal edge while filters apply (it was orange words).
            S3c: greyed with the reason while an edit is on screen. */}
        <GatedAction allowed={!editOnScreen} reason={EDIT_ORDER_REASON}>
          <Button
            size="sm"
            Icon={Filter}
            className="rb-scene-tool"
            data-active={filters.length > 0 ? 'true' : 'false'}
            aria-expanded={showFilterPanel}
            onClick={() => { if (!editOnScreen) setShowFilterPanel(!showFilterPanel) }}
          >
            Filter{filters.length > 0 ? ` (${filters.length})` : ''}
          </Button>
        </GatedAction>

        <span className="rb-scene-divider" aria-hidden="true" />

        {/* Sort, and its direction */}
        <span className="rb-scene-tool-group">
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            aria-label="Sort"
            className="ui-input rb-scene-tool"
            data-size="sm"
            disabled={editOnScreen}
            title={editOnScreen ? EDIT_ORDER_REASON : undefined}
            data-active={sortField ? 'true' : 'false'}>
            {/* S3b step 2: with a list on screen the empty choice is the
                list's own order, the default; with none it is "Sort…" as before. */}
            <option value="">{viewingList ? 'List order' : 'Sort…'}</option>
            {(contentMode === 'shots' ? SHOT_SORTABLE_FIELDS : SORTABLE_FIELDS).map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <GatedAction allowed={!editOnScreen} reason={EDIT_ORDER_REASON}>
            <IconButton
              size="sm"
              Icon={ArrowUpDown}
              title={sortDir === 'asc' ? 'Sorted ascending — reverse' : 'Sorted descending — reverse'}
              onClick={() => { if (!editOnScreen) setSortDir(d => d === 'asc' ? 'desc' : 'asc') }}
            />
          </GatedAction>
        </span>

        <span className="rb-scene-divider" aria-hidden="true" />

        {/* Group */}
        {contentMode === 'scenes' ? (
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)}
            aria-label="Group"
            className="ui-input rb-scene-tool"
            data-size="sm"
            disabled={editOnScreen}
            title={editOnScreen ? EDIT_ORDER_REASON : undefined}
            data-active={groupBy ? 'true' : 'false'}>
            {GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        ) : (
          <select value={shotGroupBy} onChange={e => setShotGroupBy(e.target.value)}
            aria-label="Group"
            className="ui-input rb-scene-tool"
            data-size="sm"
            disabled={editOnScreen}
            title={editOnScreen ? EDIT_ORDER_REASON : undefined}
            data-active={shotGroupBy ? 'true' : 'false'}>
            {SHOT_GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        )}

        <span className="rb-scene-divider" aria-hidden="true" />

        {/* View mode: the kit Tabs; each icon rides in its label. */}
        <Tabs
          label="View"
          panelId={VIEW_PANEL_ID}
          items={[
            { id: 'table', label: <><TableIcon className="rb-scene-tab-icon" aria-hidden="true" />Table</>, disabled: editOnScreen, title: editOnScreen ? EDIT_ORDER_REASON : undefined },
            { id: 'gallery', label: <><LayoutGrid className="rb-scene-tab-icon" aria-hidden="true" />Gallery</>, disabled: editOnScreen, title: editOnScreen ? EDIT_ORDER_REASON : undefined },
          ]}
          value={viewMode}
          onChange={setViewMode}
        />

        {/* Thumbnail size (table mode) */}
        {viewMode === 'table' && sizeGroup('Thumbnail size', thumbSize, setThumbSize, 'thumbnails')}

        {/* Card size (gallery mode only) */}
        {viewMode === 'gallery' && sizeGroup('Card size', gallerySize, setGallerySize, 'cards')}

        {/* The FPS readout, where it always was (R3-25 would move it to the
            header: recorded) — the kit Badge, in the second ink. */}
        <Badge className="rb-scene-fps">{fps} fps</Badge>

        {/* Saved views */}
        <SceneSavedViewsDropdown
          views={savedViews}
          onLoad={loadView}
          onDelete={deleteView}
          onSaveRequest={() => setShowSaveDialog(true)}
        />

        <span className="rb-scene-divider" aria-hidden="true" />

        {/* Search: the glyph inside the field, the clear button at its end */}
        <span className="rb-scene-search">
          <Search className="rb-scene-search-icon" aria-hidden="true" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            aria-label="Search"
            className="ui-input rb-scene-search-input"
            data-size="sm" />
          {search && (
            <IconButton size="sm" Icon={X} title="Clear search" className="rb-scene-search-clear" onClick={() => setSearch('')} />
          )}
        </span>

        {/* Count: a figure in the third ink (it was #57534e, 2.3:1). With an
            edit on screen, the cut's rows the search finds of all of them. */}
        <span className="rb-scene-count">
          {editOnScreen
            ? `${cutMatchCount}/${editSession.rows.length}`
            : contentMode === 'scenes'
              ? `${filtered.length}/${scenes.length}`
              : `${totalFilteredShots}/${shots.length}`}
        </span>
      </Toolbar>

      {/* ── Filter panel ── */}
      {showFilterPanel && (
        <SceneFilterPanel
          filters={filters}
          filterFields={contentMode === 'shots' ? SHOT_FILTER_FIELDS : SCENE_FILTER_FIELDS}
          onAdd={addFilter}
          onUpdate={updateFilter}
          onRemove={removeFilter}
          onClose={() => setShowFilterPanel(false)}
        />
      )}

      {/* ── Save view: the same inline row (the saved-views menu and this
          row are 6b's), on the kit's field and buttons ── */}
      {showSaveDialog && (
        <div className="rb-scene-save">
          <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="View name..."
            aria-label="View name"
            className="ui-input rb-scene-save-input"
            data-size="sm"
            onKeyDown={e => { if (e.key === 'Enter') saveCurrentView(); if (e.key === 'Escape') setShowSaveDialog(false) }}
            autoFocus />
          <Button size="sm" variant="primary" onClick={saveCurrentView}>Save</Button>
          <IconButton size="sm" Icon={X} title="Cancel" onClick={() => setShowSaveDialog(false)} />
        </div>
      )}

      {/* Bins could not be loaded for the take chips (milestone 2): said here
          on the page with a retry, not only inside a takes dialog she may
          never open (review round 2). The kit Banner, in the warning tone. */}
      {supportsBins && takesNotice && !takesShotId && !pickerShotId && (
        <Banner
          tone="warning"
          action={(
            <span className="rb-scene-notice-actions">
              <Button size="sm" onClick={() => { setTakesNotice(null); ctxRef.current?.refreshBins?.().catch(e => setTakesNotice(`Could not load the bins: ${e?.message || e}`)) }}>
                Retry
              </Button>
              <IconButton size="sm" Icon={X} title="Dismiss" onClick={() => setTakesNotice(null)} />
            </span>
          )}
        >
          <span className="rb-scene-notice-text">{takesNotice}</span>
        </Banner>
      )}

      {/* ── Body: the region the content tabs switch, and inside it the one
          the view tabs switch (each tab bar points at its own panel) ── */}
      <div className="rb-scene-body" id={CONTENT_PANEL_ID} role="tabpanel" aria-label={contentMode === 'shots' ? 'Shots' : 'Scenes'}>
       <div className="rb-scene-view" id={VIEW_PANEL_ID} role="tabpanel" aria-label={viewMode === 'table' ? 'Table' : 'Gallery'}>
        {/* Post-overhaul S3c, step 3: an edit on screen is its cut — the
            shots-by-scene table's form, the bands following the cut. */}
        {editOnScreen ? (
          <EditTable
            rows={editSession.rows}
            bands={editSession.bands}
            fps={fps}
            ctx={ctx}
            canWrite={canWriteProject}
            statusOptions={STATUS_OPTIONS}
            search={search}
            menuFor={cutRowMenu}
            bandMenuFor={cutBandMenu}
            onOpenShot={setDetailShotId}
            drag={cutDragOn ? cutDrag : null}
            empty={{
              body: 'Every shot was taken out of this cut.',
              action: canEditCut
                ? <Button size="sm" Icon={ListPlus} onClick={() => setAddShotsAt({ afterId: null, sceneId: undefined, preferSceneId: null, where: 'at the end of the cut' })}>Add shots…</Button>
                : null,
            }}
          />
        ) : contentMode === 'shots' ? (
          viewMode === 'table' ? (
            <ShotTable
              shotGroups={shotGroups}
              ctx={ctx}
              takes={takesApi}
              fps={fps}
              thumbSize={thumbSize}
              thumbRevision={thumbRevision}
              onThumbChanged={() => setThumbRevision(r => r + 1)}
              rowMenu={rowListMenu}
              canWrite={canWriteProject}
              canAdd={canAddRows}
              addReason={addReason}
              nameTitle={inListsTitle}
              onBulkRemove={bulkRemove}
              describeDelete={describeDelete}
              onOpenSceneDetail={setDetailSceneId}
              onOpenShotDetail={setDetailShotId}
              onNewShot={handleNewShot}
              onRequestDelete={setConfirmDelete}
              bulkPending={bulkPendingRef}
              drag={listDragOn && shotGroupBy === 'scene' ? cutDrag : null}
            />
          ) : (
            <ShotGallery
              shotGroups={shotGroups}
              gallerySize={gallerySize}
              fps={fps}
              ctx={ctx}
              takes={takesApi}
              thumbRevision={thumbRevision}
              rowMenu={rowListMenu}
              canWrite={canWriteProject}
              nameTitle={inListsTitle}
              onOpenSceneDetail={setDetailSceneId}
              onOpenShotDetail={setDetailShotId}
              onRequestDelete={setConfirmDelete}
            />
          )
        ) : (
          viewMode === 'table' ? (
            groups ? (
              <div className="rb-scene-groups">
              {groups.map(g => (
                <div key={g.key}>
                  {/* A group's band: one button, the whole band (it was a
                      clickable div with no keyboard way in), on the raised
                      paper. A status group carries the kit's StatusDot; the
                      3px accent and its colour are gone (R3-11). */}
                  <button type="button" onClick={() => toggleGroup(g.key)}
                    aria-expanded={!collapsedGroups.has(g.key)}
                    className="rb-scene-group-toggle rb-scene-band">
                    {collapsedGroups.has(g.key)
                      ? <ChevronRight className="rb-scene-group-chevron" aria-hidden="true" />
                      : <ChevronDown className="rb-scene-group-chevron" aria-hidden="true" />}
                    {groupBy === 'status' && <StatusDot status={g.key} aria-hidden="true" role={undefined} aria-label={undefined} title="" />}
                    <span className="rb-scene-group-label">{g.label}</span>
                    <span className="rb-scene-group-count">({g.scenes.length})</span>
                  </button>
                  {!collapsedGroups.has(g.key) && (
                    <SceneTable
                      scenes={g.scenes}
                      takes={takesApi}
                      shotsByScene={shotsByScene}
                      sceneTotals={sceneTotals}
                      assetCountByScene={assetCountByScene}
                      taskCountByScene={taskCountByScene}
                      fps={fps}
                      thumbSize={thumbSize}
                      thumbRevision={thumbRevision}
                      onThumbChanged={() => setThumbRevision(r => r + 1)}
                      ctx={ctx}
                      rowMenu={rowListMenu}
                      canWrite={canWriteProject}
                      canAdd={canAddRows}
                      addReason={addReason}
                      nameTitle={inListsTitle}
                      onBulkRemove={bulkRemove}
                      describeDelete={describeDelete}
                      onOpenDetail={setDetailSceneId}
                      onOpenShotDetail={setDetailShotId}
                      onNewShot={handleNewShot}
                      onRequestDelete={setConfirmDelete}
                      bulkPending={bulkPendingRef}
                    />
                  )}
                </div>
              ))}
              </div>
            ) : (
              <SceneTable
                scenes={sorted}
                takes={takesApi}
                shotsByScene={shotsByScene}
                sceneTotals={sceneTotals}
                assetCountByScene={assetCountByScene}
                taskCountByScene={taskCountByScene}
                fps={fps}
                thumbSize={thumbSize}
                // P1-21 (S3b step 7): the grouped table always had these;
                // without them a thumbnail set here showed late, on the next
                // change of anything else.
                thumbRevision={thumbRevision}
                onThumbChanged={() => setThumbRevision(r => r + 1)}
                ctx={ctx}
                rowMenu={rowListMenu}
                canWrite={canWriteProject}
                canAdd={canAddRows}
                addReason={addReason}
                nameTitle={inListsTitle}
                onBulkRemove={bulkRemove}
                describeDelete={describeDelete}
                onOpenDetail={setDetailSceneId}
                onOpenShotDetail={setDetailShotId}
                onNewShot={handleNewShot}
                onRequestDelete={setConfirmDelete}
                bulkPending={bulkPendingRef}
                drag={listDragOn ? cutDrag : null}
              />
            )
          ) : (
            <SceneGallery
              scenes={groups ? groups.flatMap(g => g.scenes) : sorted}
              shotsByScene={shotsByScene}
              sceneTotals={sceneTotals}
              gallerySize={gallerySize}
              fps={fps}
              rowMenu={rowListMenu}
              canWrite={canWriteProject}
              nameTitle={inListsTitle}
              onOpenDetail={setDetailSceneId}
              onRequestDelete={setConfirmDelete}
            />
          )
        )}
       </div>
      </div>

      {/* ── Scene detail popup ── */}
      {detailSceneId && (
        <SceneDetailPopup
          key={detailSceneId}
          sceneId={detailSceneId}
          ctx={ctx}
          canWrite={canWriteProject}
          canAdd={canAddRows}
          addReason={addReason}
          fps={fps}
          // The shots its row shows; for a scene the list on screen does not
          // hold (opened from another tab), every shot it has (S3b step 1).
          sceneShots={(sceneMap[detailSceneId] ? shotsByScene[detailSceneId] : allShotsByScene[detailSceneId]) || []}
          assetCountByScene={assetCountByScene}
          taskCountByScene={taskCountByScene}
          projectMembers={projectMembers}
          roleEntries={roleEntries}
          thumbRevision={thumbRevision}
          onThumbChanged={() => setThumbRevision(r => r + 1)}
          onNewShot={handleNewShot}
          onClose={() => setDetailSceneId(null)}
          onRequestDelete={setConfirmDelete}
          onOpenShot={setDetailShotId}
        />
      )}

      {/* ── Shot detail popup ── */}
      {detailShotId && (
        <ShotDetailPopup
          key={detailShotId}
          shotId={detailShotId}
          ctx={ctx}
          canWrite={canWriteProject}
          takes={takesApi}
          fps={fps}
          projectMembers={projectMembers}
          roleEntries={roleEntries}
          thumbRevision={thumbRevision}
          onThumbChanged={() => setThumbRevision(r => r + 1)}
          onClose={() => setDetailShotId(null)}
          onRequestDelete={setConfirmDelete}
        />
      )}

      {/* ── Shot takes: the dialog from a row, and the picker (milestone 2) ──
          Each its own kit Dialog (B6's Modal), 🚨 PORTALLED into <body>
          (surface 6c): the detail popups are there now, and the picker opens
          from the shot popup's takes — rendered here in the page it would sit
          UNDER the popup (both at the kit's z-index, the later in <body>
          painting over) while it held the top of the modal stack. In <body>
          it comes after the popup, as it comes after it on the stack.
          In <body> it is also outside the app's `wilson-dark-scroll` root,
          and B6's dialogs take no className: the portal's one wrapper
          carries the class, so the picker's list scrolls on the app's dark
          bar as it did in the page (review round one, R1-12). */}
      {takesShotId && (() => {
        // S3b: every row, as the shot popup finds its shot (the picker opens
        // from it, and the popup can show a shot another list holds).
        const shot = shotById?.(takesShotId)
        if (!shot) return null
        return createPortal(
          <div className="wilson-dark-scroll">
            <ShotTakesDialog shot={shot} scene={sceneById?.(shot.scene_id) || null} onClose={() => { setTakesShotId(null); setTakesNotice(null) }}
              entries={takesByShotMap.get(shot.id) || []} fps={fps} canWrite={takesApi.canWrite} thumbUrlFor={takeThumbUrlFor} binPathFor={binPathFor} projectId={project?.id || null}
              onUpdate={handleUpdateTake} onRemove={handleRemoveTakes} onReorder={handleReorderTakes} onUseLength={handleUseTakeLength}
              onOpenPicker={() => setPickerShotId(shot.id)}>
              {takesNotice && <div className="rb-scene-takes-notice">{takesNotice}</div>}
            </ShotTakesDialog>
          </div>,
          document.body,
        )
      })()}
      {pickerShotId && (() => {
        const shot = shotById?.(pickerShotId)
        if (!shot) return null
        const entries = takesByShotMap.get(shot.id) || []
        return createPortal(
          <div className="wilson-dark-scroll">
            <TakePickerDialog shot={shot} scene={sceneById?.(shot.scene_id) || null} files={binFiles} bins={bins}
              assignedFileIds={entries.map(e => e.file.id)} hasPrimary={entries.some(e => e.take.role === 'primary')} thumbUrlFor={takeThumbUrlFor} busy={takesBusy}
              onConfirm={(fileIds, role) => handleAssignTakes(shot.id, fileIds, role)} onCancel={() => !takesBusy && setPickerShotId(null)} />
          </div>,
          document.body,
        )
      })()}

      {/* ── Post-overhaul S3c, step 4: the first change's ONE question (D13):
          what Yes makes, from what, with which change, and what stays.
          Cancel first and focused (ListConfirm); Yes starts the draft. ── */}
      {editChanges.asking && (() => {
        // R1-03: an unsaved edit of this list kept from before, put off —
        // the question says a new edit replaces it, and the way back to it.
        const replaces = (ctx?.recoverableEditDrafts || []).find(c => c.listId === editChanges.asking.listId) || null
        const qn = firstChangeQuestion({ ...editChanges.asking, replaces })
        return (
          <ListConfirm
            title={qn.title}
            confirmLabel={qn.confirmLabel}
            variant="primary"
            onConfirm={editChanges.answer}
            onCancel={editChanges.cancel}
          >
            {qn.lines.join(' ')}
          </ListConfirm>
        )
      })()}

      {/* …and "Add shot…" from a row's or a scene's edit actions. */}
      {addShotsAt && editSession.list && canEditCut && (
        <AddShotsDialog
          intoWords={editSession.mode === 'draft'
            ? `“${listLabel({ title: editSession.draft.title, version: editSession.draft.version })}”`
            : `a new version of “${listLabel(editSession.row)}”`}
          whereWords={addShotsAt.where}
          scenes={scenes}
          shots={shots}
          preferSceneId={addShotsAt.preferSceneId}
          inCut={inCut}
          onAdd={addShotsToCut}
          onClose={() => setAddShotsAt(null)}
        />
      )}

      {/* ── Delete confirmation ── */}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.type}?`}
          // From the project and every list that holds it (S3b step 6).
          message={describeDelete(confirmDelete.type, [confirmDelete.id])}
          onConfirm={() => {
            if (confirmDelete.type === 'scene') handleDeleteScene(confirmDelete.id)
            else handleDeleteShot(confirmDelete.id)
          }}
          onCancel={() => setConfirmDelete(null)}
          // From a detail popup's Delete: what opened the popup (surface 6c).
          returnTo={confirmDelete.returnTo || null}
        />
      )}
    </div>
    </WriteReasonProvider>
  )
}


// ─── BigTile — summary card ───
// The kit Stat (R3-10), on the Budget's tile look: the Label-step name over
// the tabular value, on the raised paper with one hairline. No caller ever
// passed a tone, and Stat has no icon slot, so both are gone.
function BigTile({ label, value }) {
  return <Stat className="rb-scene-stat" label={label} value={value} />
}


// ─── A row's shot-list menu (post-overhaul S3b) ───
// One named button between View details and Delete that holds the row's
// shot-list verbs as WORDS — Move up / Move down in List order, Remove from
// this list, Add to list… in the "Not in any list" view — so the trash keeps
// its place and a removal is never a second lookalike icon beside a delete.
// The kit Menu through MenuButton (portalled: inside the row's HoverActions
// it would fade out with the slot's opacity the moment the pointer left the
// row). Nothing to offer, no button: the slot keeps its width.
function RowMore({ name, items }) {
  return <MenuButton title={`Shot list actions for ${name}`} items={items} />
}


/**
 * Deletes `ids` as ONE undo step — the provider's runBatch (review round 1,
 * R1-01: a bulk delete was one step a row, past the history's ten).
 *  · One after another, each awaited: a refused delete's rollback restores
 *    the provider's state from before IT began, so it must not run beside
 *    the others (it would put back rows they had just deleted).
 *  · A refusal does not stop the rest (review round 2, R2-01): each is said
 *    in the console, and the provider's optimistic() puts it in ctx.error,
 *    which the tab's Banner shows.
 *  · `pending` counts the run, and the tab's Ctrl+Z / Ctrl+Y stand down
 *    while it is above nought (R2-01, the key handler).
 */
function deleteAsOneStep(ctx, ids, remove, what, pending) {
  if (pending) pending.current += 1
  const run = async () => {
    for (const id of ids) {
      try { await remove(id) } catch (err) { console.error(`Failed to delete ${what}:`, err) }
    }
  }
  const out = ctx?.runBatch ? ctx.runBatch(run) : run()
  return Promise.resolve(out)
    .catch(err => console.error(`Failed to delete ${what}:`, err))
    .finally(() => { if (pending) pending.current -= 1 })
}

// ─── Scene table ───
// The kit Table (R3-20): a real <table>, the same columns in the same order,
// the header one row of the kit's Th. A scene's shots stay nested under it —
// one row that spans the table and holds a table of the shots, indented as
// before, opened and closed by the same toggle. Widths are the sheet's
// (`.rb-scene-table-wrap`), each column's thumbnail box its size's.
// S3b: `rowMenu` (a row's shot-list menu), `nameTitle` (a name's lists, D10)
// and `onBulkRemove` (the bulk bars' Remove from list, while a list is on
// screen and this person writes lists) come from ScenesView.
// Post-overhaul S3c, step 6: `drag` (useCutDrag's, or null) — in the list's
// own order a scene row and a nested shot row are dragged by their number
// cell; a drop asks D13's question (ScenesView's onCutDrop).
function SceneTable({ scenes, shotsByScene, sceneTotals, assetCountByScene, taskCountByScene, fps, thumbSize, thumbRevision = 0, onThumbChanged, ctx, takes, canWrite = false, canAdd = false, addReason, rowMenu, nameTitle, onBulkRemove, describeDelete, onOpenDetail, onOpenShotDetail, onNewShot, onRequestDelete, bulkPending, drag = null }) {
  const rowH = THUMB_SIZES[thumbSize]?.h || BASE_ROW_H
  const [expandedScenes, setExpandedScenes] = useState(new Set())
  // W9: the two bulk deletes ask on the kit Dialog ('scenes', or
  // { shots: ids } — one nest's ticked shots); each was a window.confirm, and
  // each question keeps its words.
  const [confirmBulk, setConfirmBulk] = useState(null)

  // ── Nested-shot multi-select ──
  // One set over every nest, but each nest's bar counts AND acts on its own
  // scene's ticks only (review round 2, R2-04: a bar said "1 selected" and
  // deleted or removed every nest's ticks, a closed scene's among them).
  const [selectedNestedShots, setSelectedNestedShots] = useState(new Set())
  function toggleNestedShot(id) { setSelectedNestedShots(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  function clearNestedSelection(ids) {
    setSelectedNestedShots(prev => {
      const s = new Set(prev)
      for (const id of ids) s.delete(id)
      return s
    })
  }
  function bulkUpdateNestedShots(ids, patch) { if (!canWrite) return; for (const id of ids) ctx?.updateShot?.(id, patch); clearNestedSelection(ids) }
  // Review round 1 (R1-01): a bulk delete is ONE undo step, not one per row:
  // the history keeps ten, and a selection can be larger.
  function bulkDeleteNestedShots(ids) {
    if (!canWrite) return
    deleteAsOneStep(ctx, ids, (id) => ctx?.deleteShot?.(id), 'shots', bulkPending)
    clearNestedSelection(ids)
  }

  // ── Scene multi-select ──
  const [selected, setSelected] = useState(new Set())
  const allIds = useMemo(() => scenes.map(s => s.id), [scenes])
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id))
  const someSelected = selected.size > 0

  function toggleOne(id) { setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  function toggleAll() { allSelected ? setSelected(new Set()) : setSelected(new Set(allIds)) }
  function clearSelection() { setSelected(new Set()) }
  function bulkUpdate(patch) { if (!canWrite) return; for (const id of selected) ctx?.updateScene?.(id, patch); clearSelection() }
  // Each scene by S3a's deleteScene, which takes its every shot in every
  // list (R1-01) — the whole selection in ONE undo step.
  function bulkDelete() {
    if (!canWrite) return
    const ids = [...selected]
    deleteAsOneStep(ctx, ids, (id) => ctx?.deleteScene?.(id), 'scenes', bulkPending)
    clearSelection()
  }

  // Review round 1 (R1-05): a selection holds only rows this table shows. A
  // change of the list on screen (or a search or filter) that takes a row
  // away takes it out of the selection, so no bulk verb — Remove, Delete —
  // acts on a row nobody can see.
  useEffect(() => {
    setSelected(prev => {
      const keep = new Set([...prev].filter(id => allIds.includes(id)))
      return keep.size === prev.size ? prev : keep
    })
  }, [allIds])
  // The nested ticks: the shots of the scenes OPEN here (review round 2,
  // R2-04: a closed scene's ticks stayed, unseen, in the selection).
  const tableShotIds = useMemo(() => new Set(scenes.filter(sc => expandedScenes.has(sc.id)).flatMap(sc => (shotsByScene[sc.id] || []).map(s => s.id))), [scenes, shotsByScene, expandedScenes])
  useEffect(() => {
    setSelectedNestedShots(prev => {
      const keep = new Set([...prev].filter(id => tableShotIds.has(id)))
      return keep.size === prev.size ? prev : keep
    })
  }, [tableShotIds])

  function toggleExpand(id) {
    setExpandedScenes(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Nothing to list: the kit EmptyState (R3-19), the same words.
  if (scenes.length === 0) {
    return <EmptyState Icon={Film} title="No scenes yet" />
  }

  return (
    <div className="rb-scene-table-wrap" data-thumb={thumbSize}>
      {/* The bulk-action bar overlays the header right of the checkbox
          column, where it always did: the raised paper, the signal edge, the
          count at Dense 600 in the ink (it was orange mono), the kit's
          fields and buttons. */}
      {someSelected && (
        <div className="rb-scene-bulk">
          <span className="rb-scene-bulk-count">{selected.size} selected</span>
          <span className="rb-scene-divider" aria-hidden="true" />
          <GatedAction allowed={canWrite} className="rb-scene-bulk-gate">
            <SceneBulkSelect label="Status" options={SCENE_STATUSES} onPick={v => bulkUpdate({ status: v })} />
            <SceneBulkSelect label="Type" options={SCENE_TYPES} onPick={v => bulkUpdate({ type: v })} />
          </GatedAction>
          <span className="rb-scene-divider" aria-hidden="true" />
          {onBulkRemove && (
            <Button size="sm" Icon={ListMinus} onClick={() => onBulkRemove('scene', [...selected], clearSelection)}>
              Remove from list
            </Button>
          )}
          <GatedAction allowed={canWrite}>
            <Button size="sm" variant="danger" Icon={Trash2} onClick={() => setConfirmBulk('scenes')}>
              Delete
            </Button>
          </GatedAction>
          <IconButton size="sm" Icon={X} title="Clear the selection" onClick={clearSelection} />
        </div>
      )}

      <Table
        className="rb-scene-table rb-scene-table-scenes"
        head={(
          <Row>
            <Th width="var(--rb-scene-col-check)" className="rb-scene-check-cell">
              <button type="button" onClick={toggleAll}
                className="rb-scene-check"
                data-checked={allSelected ? 'all' : someSelected ? 'some' : 'none'}
                aria-label={allSelected ? 'Clear the selection' : 'Select every scene'}
                title={allSelected ? 'Clear the selection' : 'Select every scene'}>
                {allSelected
                  ? <CheckSquare aria-hidden="true" />
                  : someSelected
                    ? <MinusSquare aria-hidden="true" />
                    : <Square aria-hidden="true" />}
              </button>
            </Th>
            <Th width="var(--rb-scene-col-expand)" className="rb-scene-expand-cell"><span className="sr-only">Shots</span></Th>
            <Th width="var(--rb-scene-col-thumb)" className="rb-scene-thumb-cell"><span className="sr-only">Thumbnail</span></Th>
            <Th width="var(--rb-scene-col-num)" numeric>#</Th>
            <Th width="var(--rb-scene-col-name)">Name</Th>
            <Th width="var(--rb-scene-col-status)">Status</Th>
            <Th width="var(--rb-scene-col-time)">Time of day</Th>
            <Th width="var(--rb-scene-col-type)">Type</Th>
            <Th>Description</Th>
            <Th width="var(--rb-scene-col-runtime)" numeric>Runtime</Th>
            <Th width="var(--rb-scene-col-frames)" numeric>Frames</Th>
            <Th width="var(--rb-scene-col-acts)" align="right"><span className="sr-only">Actions</span></Th>
          </Row>
        )}
      >

        {scenes.map(sc => {
          const sceneShots = shotsByScene[sc.id] || []
          const expanded = expandedScenes.has(sc.id)
          const totals = sceneTotals[sc.id] || { totalFrames: 0, runtime: '00:00:00:00' }
          const isChecked = selected.has(sc.id)
          // What each unnamed control on the row is named for.
          const name = sc.name || 'Untitled'
          // A scene dropped after an OPEN scene lands after its shots: the
          // line is under them, on the nest (review round 1, R1-07).
          const { head: dropAt, lastRow: nestDrop } = blockLine(drag?.lineOf?.('scene', sc.id), 'scene', expanded)
          return (
            <Fragment key={sc.id}>
              {/* The kit Row: its one selected treatment (R3-38 — it was an
                  orange tint AND a full orange border), the lane's hover. */}
              <Row
                className="rb-scene-row"
                selected={isChecked}
                data-ticked={isChecked ? 'true' : 'false'}
                data-drop={dropAt === 'before' ? 'before' : dropAt === 'after' ? 'after' : undefined}
                onDragOver={drag ? drag.over('scene', sc.id) : undefined}
                onDragLeave={drag ? drag.leave('scene', sc.id) : undefined}
                onDrop={drag ? drag.drop('scene', sc.id) : undefined}
              >
                {/* Checkbox: one 28px square (R3-40) */}
                <Td className="rb-scene-check-cell">
                  <button type="button" onClick={e => { e.stopPropagation(); toggleOne(sc.id) }}
                    className="rb-scene-check"
                    data-checked={isChecked ? 'all' : 'none'}
                    aria-pressed={isChecked}
                    aria-label={`Select ${name}`}
                    title={`Select ${name}`}>
                    {isChecked ? <CheckSquare aria-hidden="true" /> : <Square aria-hidden="true" />}
                  </button>
                </Td>

                {/* Expand toggle: a scene with no shots shows no chevron, and
                    still opens onto its Add shot, as before */}
                <Td className="rb-scene-expand-cell">
                  <IconButton
                    size="sm"
                    Icon={sceneShots.length > 0 ? (expanded ? ChevronDown : ChevronRight) : undefined}
                    title={expanded ? 'Hide shots' : 'Show shots'}
                    aria-expanded={expanded}
                    onClick={e => { e.stopPropagation(); toggleExpand(sc.id) }}
                  />
                </Td>

                {/* Thumbnail */}
                <Td className="rb-scene-thumb-cell">
                  {/* S3b step 7: a picture, not a button, for a seat that may not write scenes. */}
                  <div className="rb-scene-thumb" data-static={canWrite ? undefined : 'true'}
                    onClick={canWrite ? async e => {
                      e.stopPropagation()
                      if (!window.electronAPI?.rabbit?.pickImage) return
                      const imagePath = await window.electronAPI.rabbit.pickImage()
                      if (!imagePath) return
                      ctx?.updateScene?.(sc.id, { thumbnail_image: imagePath })
                      try { await window.electronAPI.rabbit.generateEntityThumbnail({ entityType: 'scene', entityId: sc.id, sourcePath: imagePath }) } catch {}
                      onThumbChanged?.()
                    } : undefined}>
                    {sc.thumbnail_image ? (
                      <>
                        <img className="rb-scene-thumb-img" src={`/api/rabbit/projects/${ctx?.project?.id}/scenes/${sc.id}/thumbnail?r=${thumbRevision}`} alt="" />
                        {canWrite && <span className="rb-scene-thumb-over"><ImagePlus aria-hidden="true" /></span>}
                      </>
                    ) : (
                      <>
                        <Film className="rb-scene-thumb-mark" aria-hidden="true" />
                        {canWrite && <ImagePlus className="rb-scene-thumb-add" aria-hidden="true" />}
                      </>
                    )}
                  </div>
                </Td>

                {/* Scene # — and, in the list's own order, its grip (S3c step 6) */}
                <Td numeric className="rb-scene-num-cell" data-empty={sc.scene_number == null ? 'true' : undefined} data-grip={drag ? 'true' : undefined}>
                  {drag && <Grip drag={drag} kind="scene" id={sc.id} name={name} />}
                  {sc.scene_number ?? '—'}
                </Td>

                {/* Name: the row's anchor, 600 in the ink (it was orange) */}
                <Td className="rb-scene-name-cell">
                  <span className="rb-scene-name" onClick={() => onOpenDetail(sc.id)}>
                    <InlineText
                      value={sc.name || ''}
                      placeholder="Untitled scene"
                      strong
                      label={`Name for ${name}`}
                      title={nameTitle?.(sc.id)}
                      readOnly={!canWrite}
                      onCommit={v => ctx?.updateScene?.(sc.id, { name: v })}
                    />
                  </span>
                </Td>

                {/* Status: the kit's StatusDot beside a CellSelect, the words
                    in the ink, the tone from the one STATUS map (R3-11) */}
                <Td className="rb-scene-status-cell" onClick={e => e.stopPropagation()}>
                  <span className="rb-scene-status">
                    <StatusDot status={sc.status || 'not_started'} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
                    <CellSelect
                      className="rb-scene-status-select"
                      value={sc.status || 'not_started'}
                      onChange={v => ctx?.updateScene?.(sc.id, { status: v })}
                      options={STATUS_OPTIONS}
                      disabled={!canWrite}
                      aria-label={`Status for ${name}`}
                    />
                  </span>
                </Td>

                {/* Time of day */}
                <Td className="rb-scene-time-cell" onClick={e => e.stopPropagation()}>
                  <CellSelect
                    value={sc.time_of_day || null}
                    onChange={v => ctx?.updateScene?.(sc.id, { time_of_day: v })}
                    placeholder="—"
                    options={TIME_OPTIONS}
                    disabled={!canWrite}
                    aria-label={`Time of day for ${name}`}
                  />
                </Td>

                {/* Type */}
                <Td className="rb-scene-type-cell" onClick={e => e.stopPropagation()}>
                  <CellSelect
                    value={sc.type || 'interior'}
                    onChange={v => ctx?.updateScene?.(sc.id, { type: v })}
                    options={TYPE_OPTIONS}
                    disabled={!canWrite}
                    aria-label={`Type for ${name}`}
                  />
                </Td>

                {/* Description */}
                <Td className="rb-scene-desc-cell" onClick={e => e.stopPropagation()}>
                  <InlineText
                    value={sc.description || ''}
                    placeholder="Add description…"
                    size="sm"
                    label={`Description for ${name}`}
                    readOnly={!canWrite}
                    onCommit={v => ctx?.updateScene?.(sc.id, { description: v })}
                  />
                </Td>

                {/* Runtime: a zero at the third ink, never #44403c (R3-13) */}
                <Td numeric className="rb-scene-dur-cell" data-empty={totals.totalFrames > 0 ? undefined : 'true'}>
                  {totals.runtime}
                </Td>

                {/* Frame count */}
                <Td numeric className="rb-scene-count-cell" data-empty={totals.totalFrames > 0 ? undefined : 'true'}>
                  {fmtNumber(totals.totalFrames)}
                </Td>

                {/* Actions: the kit HoverActions — on hover AND on focus
                    (Q17(b)), one reserved slot the same width in every row
                    of all three tables (R3-24) */}
                <Td align="right" className="rb-scene-acts-cell">
                  <HoverActions className="rb-scene-acts">
                    <IconButton size="sm" Icon={Eye} title="View details"
                      onClick={e => { e.stopPropagation(); onOpenDetail(sc.id) }} />
                    <RowMore name={name} items={rowMenu?.('scene', sc, scenes.map(s => s.id))} />
                    <GatedAction allowed={canWrite}>
                      <IconButton size="sm" Icon={Trash2} danger title="Delete scene"
                        onClick={e => { e.stopPropagation(); onRequestDelete({ type: 'scene', id: sc.id, name: sc.name || 'Untitled' }) }} />
                    </GatedAction>
                  </HoverActions>
                </Td>
              </Row>

              {/* Nested shots: one row across the table, indented as before,
                  holding the scene's shots as a table of their own (no
                  header, as before) on the recessed paper they sat on. */}
              {expanded && (
                <Row className="rb-scene-nest-row" data-drop={nestDrop === 'after' ? 'after' : undefined}>
                  <Td colSpan={12} className="rb-scene-nest-cell">
                    <div className="rb-scene-nest">
                      {/* Nested-shot bulk action bar */}
                      {(() => {
                        const selInScene = sceneShots.filter(s => selectedNestedShots.has(s.id))
                        if (selInScene.length === 0) return null
                        const selIds = selInScene.map(s => s.id)
                        return (
                          <div className="rb-scene-nest-bulk">
                            <span className="rb-scene-bulk-count">{selInScene.length} selected</span>
                            <GatedAction allowed={canWrite} className="rb-scene-bulk-gate">
                              <SceneBulkSelect label="Status" options={SCENE_STATUSES} onPick={v => bulkUpdateNestedShots(selIds, { status: v })} />
                              <SceneBulkSelect label="Type" options={SCENE_TYPES} onPick={v => bulkUpdateNestedShots(selIds, { type: v })} />
                              <SceneBulkSelect label="Time of day" options={TIME_OF_DAY_OPTIONS} onPick={v => bulkUpdateNestedShots(selIds, { time_of_day: v })} />
                            </GatedAction>
                            {onBulkRemove && (
                              <Button size="sm" Icon={ListMinus} onClick={() => onBulkRemove('shot', selIds, () => clearNestedSelection(selIds))}>
                                Remove from list
                              </Button>
                            )}
                            {/* Its wrapper, drawn only while it greys, keeps the Delete's place at the end. */}
                            <GatedAction allowed={canWrite} className="rb-scene-nest-delete-gate">
                              <Button size="sm" variant="danger" Icon={Trash2} className="rb-scene-nest-delete" onClick={() => setConfirmBulk({ shots: selIds })}>
                                Delete
                              </Button>
                            </GatedAction>
                            <IconButton size="sm" Icon={X} title="Clear the selection" onClick={() => clearNestedSelection(selIds)} />
                          </div>
                        )
                      })()}
                      {sceneShots.length > 0 && (
                        <Table className="rb-scene-table rb-scene-nest-table" scrollClassName="rb-scene-nest-scroll" data-takes={takes?.supports ? 'true' : 'false'}>
                          {sceneShots.map(shot => {
                            const isNested = selectedNestedShots.has(shot.id)
                            const shotTakeEntries = takes?.map?.get(shot.id) || []
                            const takeFallback = takes?.supports && !shot.thumbnail_image ? primaryOf(shotTakeEntries)?.file : null
                            const nestedThumbH = Math.max(rowH - 8, 28)
                            const shotName = shot.name || 'Untitled'
                            const shotDropAt = drag?.at('shot', shot.id)
                            return (
                              <Row
                                key={shot.id}
                                className="rb-scene-row"
                                selected={isNested}
                                data-ticked={isNested ? 'true' : 'false'}
                                data-drop={shotDropAt === 'before' ? 'before' : shotDropAt === 'after' ? 'after' : undefined}
                                onDragOver={drag ? drag.over('shot', shot.id) : undefined}
                                onDragLeave={drag ? drag.leave('shot', shot.id) : undefined}
                                onDrop={drag ? drag.drop('shot', shot.id) : undefined}
                              >
                                {/* Checkbox: the 28px square (R3-40; it was the 12px glyph alone) */}
                                <Td className="rb-scene-check-cell">
                                  <button type="button" onClick={() => toggleNestedShot(shot.id)}
                                    className="rb-scene-check"
                                    data-checked={isNested ? 'all' : 'none'}
                                    aria-pressed={isNested}
                                    aria-label={`Select ${shotName}`}
                                    title={`Select ${shotName}`}>
                                    {isNested ? <CheckSquare aria-hidden="true" /> : <Square aria-hidden="true" />}
                                  </button>
                                </Td>
                                <Td className="rb-scene-mark-cell">
                                  <Clapperboard className="rb-scene-mark" aria-hidden="true" />
                                </Td>
                                {/* Thumbnail */}
                                <Td className="rb-scene-thumb-cell">
                                  <div className="rb-scene-thumb" data-nested="true" data-static={canWrite ? undefined : 'true'}
                                    onClick={canWrite ? async e => {
                                      e.stopPropagation()
                                      if (!window.electronAPI?.rabbit?.pickImage) return
                                      const imagePath = await window.electronAPI.rabbit.pickImage()
                                      if (!imagePath) return
                                      ctx?.updateShot?.(shot.id, { thumbnail_image: imagePath })
                                      try { await window.electronAPI.rabbit.generateEntityThumbnail({ entityType: 'shot', entityId: shot.id, sourcePath: imagePath }) } catch {}
                                      onThumbChanged?.()
                                    } : undefined}>
                                    {shot.thumbnail_image ? (
                                      <>
                                        <img className="rb-scene-thumb-img" src={`/api/rabbit/projects/${ctx?.project?.id}/shots/${shot.id}/thumbnail?r=${thumbRevision}`} alt="" />
                                        {canWrite && <span className="rb-scene-thumb-over"><ImagePlus aria-hidden="true" /></span>}
                                      </>
                                    ) : takeFallback ? (
                                      <>
                                        {/* The primary take's poster stands in for an empty thumbnail (Q6); clicking still picks an image of her own. */}
                                        <BinPoster row={takeFallback} src={takes.thumbUrlFor?.(takeFallback.id)} width={thumbW(nestedThumbH)} height={nestedThumbH} radius={0} className="rb-scene-poster" />
                                        {canWrite && <span className="rb-scene-thumb-over" title="From the primary take. Click to set a thumbnail of your own."><ImagePlus aria-hidden="true" /></span>}
                                      </>
                                    ) : (
                                      <>
                                        <Clapperboard className="rb-scene-thumb-mark" aria-hidden="true" />
                                        {canWrite && <ImagePlus className="rb-scene-thumb-add" aria-hidden="true" />}
                                      </>
                                    )}
                                  </div>
                                </Td>
                                {/* Shot # — and its grip (S3c step 6) */}
                                <Td numeric className="rb-scene-num-cell" data-empty={shot.shot_number == null ? 'true' : undefined} data-grip={drag ? 'true' : undefined}>
                                  {drag && <Grip drag={drag} kind="shot" id={shot.id} name={shotName} />}
                                  {shot.shot_number ?? '—'}
                                </Td>
                                {/* Name */}
                                <Td className="rb-scene-name-cell">
                                  <InlineText value={shot.name || ''} placeholder="Untitled shot" size="sm" strong
                                    label={`Name for ${shotName}`}
                                    title={nameTitle?.(shot.id)}
                                    readOnly={!canWrite}
                                    onCommit={v => ctx?.updateShot?.(shot.id, { name: v })} />
                                </Td>
                                {/* Takes (milestone 2) */}
                                {takes?.supports && (
                                  <Td className="rb-scene-takes-cell" onClick={e => e.stopPropagation()}>
                                    <ShotTakeChips entries={shotTakeEntries} thumbUrlFor={takes.thumbUrlFor} height={Math.min(nestedThumbH, 22)} max={3}
                                      canWrite={takes.canWrite} onOpen={() => takes.open(shot.id)} />
                                  </Td>
                                )}
                                {/* Status */}
                                <Td className="rb-scene-status-cell">
                                  <span className="rb-scene-status">
                                    <StatusDot status={shot.status || 'not_started'} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
                                    <CellSelect
                                      className="rb-scene-status-select"
                                      value={shot.status || 'not_started'}
                                      onChange={v => ctx?.updateShot?.(shot.id, { status: v })}
                                      options={STATUS_OPTIONS}
                                      disabled={!canWrite}
                                      aria-label={`Status for ${shotName}`}
                                    />
                                  </span>
                                </Td>
                                {/* Time of day */}
                                <Td className="rb-scene-time-cell">
                                  <CellSelect value={shot.time_of_day || null} onChange={v => ctx?.updateShot?.(shot.id, { time_of_day: v })}
                                    placeholder="—" options={TIME_OPTIONS} disabled={!canWrite} aria-label={`Time of day for ${shotName}`} />
                                </Td>
                                {/* Type */}
                                <Td className="rb-scene-type-cell">
                                  <CellSelect value={shot.type || 'other'} onChange={v => ctx?.updateShot?.(shot.id, { type: v })}
                                    options={TYPE_OPTIONS} disabled={!canWrite} aria-label={`Type for ${shotName}`} />
                                </Td>
                                {/* Framing: the code in the cell, the long names in the list */}
                                <Td className="rb-scene-framing-cell">
                                  <span className="rb-scene-framing">
                                    <span className="rb-scene-framing-code" data-empty={shot.framing ? undefined : 'true'} aria-hidden="true">{shot.framing || '—'}</span>
                                    <CellSelect className="rb-scene-framing-select" value={shot.framing || null} onChange={v => ctx?.updateShot?.(shot.id, { framing: v })}
                                      placeholder="—" options={FRAMING_CHOICES} disabled={!canWrite} aria-label={`Framing for ${shotName}`} />
                                  </span>
                                </Td>
                                {/* Camera movement */}
                                <Td className="rb-scene-move-cell">
                                  <CellSelect value={shot.camera_movement || null} onChange={v => ctx?.updateShot?.(shot.id, { camera_movement: v })}
                                    placeholder="—" options={MOVE_CHOICES} disabled={!canWrite} aria-label={`Camera movement for ${shotName}`} />
                                </Td>
                                {/* Description */}
                                <Td className="rb-scene-desc-cell">
                                  <InlineText value={shot.description || ''} placeholder="Add description…" size="sm"
                                    label={`Description for ${shotName}`}
                                    readOnly={!canWrite}
                                    onCommit={v => ctx?.updateShot?.(shot.id, { description: v })} />
                                </Td>
                                {/* Duration */}
                                <Td numeric className="rb-scene-dur-cell" data-empty={(shot.frame_count || 0) > 0 ? undefined : 'true'}>
                                  {framesToTimecode(shot.frame_count || 0, fps)}
                                </Td>
                                {/* Frames: the kit's small field, its rest, hover and focus the sheet's (R3-26) */}
                                <Td numeric className="rb-scene-frames-cell">
                                  <input type="number" min={0} value={shot.frame_count ?? ''}
                                    onChange={e => { const n = parseInt(e.target.value, 10); ctx?.updateShot?.(shot.id, { frame_count: Number.isFinite(n) && n >= 0 ? n : 0 }) }}
                                    disabled={!canWrite}
                                    aria-label={`Frames for ${shotName}`}
                                    className="ui-input rb-scene-frames"
                                    data-size="sm"
                                    placeholder="0" />
                                </Td>
                                <Td align="right" className="rb-scene-acts-cell">
                                  <HoverActions className="rb-scene-acts">
                                    <IconButton size="sm" Icon={Eye} title="View details" onClick={() => onOpenShotDetail(shot.id)} />
                                    <RowMore name={shotName} items={rowMenu?.('shot', shot, sceneShots.map(s => s.id))} />
                                    <GatedAction allowed={canWrite}>
                                      <IconButton size="sm" Icon={Trash2} danger title="Delete shot"
                                        onClick={() => onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' })} />
                                    </GatedAction>
                                  </HoverActions>
                                </Td>
                              </Row>
                            )
                          })}
                        </Table>
                      )}
                      {/* Add shot row */}
                      <GatedAction allowed={canAdd} reason={addReason} display="flex">
                        <button type="button" onClick={() => onNewShot(sc.id)} className="rb-scene-add">
                          <Plus aria-hidden="true" /> Add shot
                        </button>
                      </GatedAction>
                    </div>
                  </Td>
                </Row>
              )}
            </Fragment>
          )
        })}
      </Table>

      {/* W9: the two bulk questions, word for word, on the kit Dialog in
          <body>. Neither ever closed on a click outside (window.confirm). */}
      {confirmBulk === 'scenes' && (
        <ConfirmDialog
          title="Delete scenes"
          message={describeDelete('scene', [...selected], 'bar')}
          dismissOnBackdrop={false}
          onCancel={() => setConfirmBulk(null)}
          onConfirm={() => { setConfirmBulk(null); bulkDelete() }}
        />
      )}
      {confirmBulk?.shots && (
        <ConfirmDialog
          title="Delete shots"
          message={describeDelete('shot', confirmBulk.shots, 'bar')}
          dismissOnBackdrop={false}
          onCancel={() => setConfirmBulk(null)}
          onConfirm={() => { const ids = confirmBulk.shots; setConfirmBulk(null); bulkDeleteNestedShots(ids) }}
        />
      )}
    </div>
  )
}


// ─── Scene gallery ───
// The kit's Card, as the Levels and Experiences pages' (B4c's EntityCard) and
// the Assets page's (B4b): the raised paper with one hairline, at the width
// its size gives it — 160, 220 or 300px as before, keyed on the gallery's
// `data-card`, not a style — and a hairline that lifts on hover (the orange
// ring is gone; no filter on anything inside, R3-23). The well on the paper,
// half the card's width tall as before, the scene's glyph at 24px in the
// third ink (R3-29: 28px at 1.2:1). The delete sits in the kit's
// HoverActions, shown on hover AND on focus (R3-24, Q17(b)), and is named
// for its scene now (it had no name). Then the name at 600 in the ink, the
// description in the second ink, the type and time of day at the Label step
// beside the kit's StatusBadge — its words and tone from the one STATUS map
// (R3-11: a status-coloured chip AND a 2px status-coloured bar under the
// well said it twice in statusColor's hues; the bar goes, as the Assets
// cards' did) — and the shot count and runtime in the mono, in the third
// ink (R3-13: #57534e, 2.3:1). The whole card opens the scene, as it did.
function SceneGallery({ scenes, shotsByScene, sceneTotals, gallerySize, fps, canWrite = false, rowMenu, nameTitle, onOpenDetail, onRequestDelete }) {
  if (scenes.length === 0) {
    // The kit's empty state (R3-19), in the same words.
    return <EmptyState Icon={Film} title="No scenes yet" />
  }

  return (
    <div className="rb-scene-gallery" data-card={gallerySize}>
      <div className="rb-scene-cards">
        {scenes.map(sc => {
          const sceneShots = shotsByScene[sc.id] || []
          const totals = sceneTotals[sc.id] || { totalFrames: 0, runtime: '00:00:00:00' }
          // What the card's delete is named for — the name its question says.
          const name = sc.name || 'Untitled'
          return (
            <Card key={sc.id} pad={false} className="rb-scene-card ui-hover-host" onClick={() => onOpenDetail(sc.id)}>
              <div className="rb-scene-card-media">
                <Film className="rb-scene-card-glyph" aria-hidden="true" />
                <HoverActions className="rb-scene-card-acts">
                  <RowMore name={name} items={rowMenu?.('scene', sc, scenes.map(s => s.id))} />
                  <GatedAction allowed={canWrite}>
                    <IconButton size="sm" Icon={Trash2} danger title={`Delete ${name}`} className="rb-scene-card-delete"
                      onClick={e => { e.stopPropagation(); onRequestDelete({ type: 'scene', id: sc.id, name }) }} />
                  </GatedAction>
                </HoverActions>
              </div>
              <div className="rb-scene-card-body">
                <span className="rb-scene-card-name" title={nameTitle?.(sc.id)}>
                  {sc.name || 'Untitled scene'}
                </span>
                {sc.description && (
                  <span className="rb-scene-card-desc">
                    {sc.description}
                  </span>
                )}
                <div className="rb-scene-card-meta">
                  <span className="rb-scene-card-tag">
                    {humanizeStatus(sc.type || '')}
                  </span>
                  {sc.time_of_day && (
                    <span className="rb-scene-card-tag">
                      {humanizeStatus(sc.time_of_day)}
                    </span>
                  )}
                  <StatusBadge status={sc.status || 'not_started'} />
                </div>
                <div className="rb-scene-card-figures">
                  {sceneShots.length > 0 && (
                    <span className="rb-scene-card-figure">
                      {sceneShots.length} shot{sceneShots.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {totals.totalFrames > 0 && (
                    <span className="rb-scene-card-figure">
                      {totals.runtime}
                    </span>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}


// ─── Shot table (shots grouped by scene) ───
// The kit Table (R3-20), the same columns in the same order; a group's
// header is a row of the table (the Tasks and Expenses tables' bands), its
// Add shot the row after its shots.
// Post-overhaul S3c, step 6: `drag` (useCutDrag's, or null) — grouped by
// scene in the list's own order, a shot row is dragged by its number cell and
// a scene's band by the grip before its name; a drop asks D13's question.
function ShotTable({ shotGroups, ctx, takes, fps, thumbSize, thumbRevision = 0, onThumbChanged, canWrite = false, canAdd = false, addReason, rowMenu, nameTitle, onBulkRemove, describeDelete, onOpenSceneDetail, onOpenShotDetail, onNewShot, onRequestDelete, bulkPending, drag = null }) {
  const rowH = THUMB_SIZES[thumbSize]?.h || BASE_ROW_H
  const tw = thumbW(rowH)
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  // W9: the bulk delete asks on the kit Dialog (it was window.confirm).
  const [confirmBulk, setConfirmBulk] = useState(false)

  // ── Multi-select ──
  const [selected, setSelected] = useState(new Set())
  const allShotIds = useMemo(() => shotGroups.flatMap(g => g.shots.map(s => s.id)), [shotGroups])
  const allSelected = allShotIds.length > 0 && allShotIds.every(id => selected.has(id))
  const someSelected = selected.size > 0

  function toggleOne(id) { setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  function toggleAll() { allSelected ? setSelected(new Set()) : setSelected(new Set(allShotIds)) }
  function clearSelection() { setSelected(new Set()) }
  function bulkUpdate(patch) { if (!canWrite) return; for (const id of selected) ctx?.updateShot?.(id, patch); clearSelection() }
  // One undo step for the selection (R1-01).
  function bulkDelete() {
    if (!canWrite) return
    const ids = [...selected]
    deleteAsOneStep(ctx, ids, (id) => ctx?.deleteShot?.(id), 'shots', bulkPending)
    clearSelection()
  }
  // Only rows this table shows stay selected (R1-05).
  useEffect(() => {
    setSelected(prev => {
      const keep = new Set([...prev].filter(id => allShotIds.includes(id)))
      return keep.size === prev.size ? prev : keep
    })
  }, [allShotIds])

  function toggleGroup(key) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // Nothing to list: the kit EmptyState (R3-19), the same words — the
  // instruction is its body now.
  if (shotGroups.length === 0 || shotGroups.every(g => g.shots.length === 0)) {
    return <EmptyState Icon={Clapperboard} title="No shots yet" body="Create a scene first, then add shots." />
  }

  // What a group's band and an Add shot row span: every column.
  const span = takes?.supports ? 16 : 15

  return (
    <div className="rb-scene-table-wrap" data-thumb={thumbSize}>
      {/* Bulk action bar: over the header, right of the checkbox column */}
      {someSelected && (
        <div className="rb-scene-bulk">
          <span className="rb-scene-bulk-count">{selected.size} selected</span>
          <span className="rb-scene-divider" aria-hidden="true" />
          <GatedAction allowed={canWrite} className="rb-scene-bulk-gate">
            <SceneBulkSelect label="Status" options={SCENE_STATUSES} onPick={v => bulkUpdate({ status: v })} />
            <SceneBulkSelect label="Type" options={SCENE_TYPES} onPick={v => bulkUpdate({ type: v })} />
            <SceneBulkSelect label="Time of day" options={TIME_OF_DAY_OPTIONS} onPick={v => bulkUpdate({ time_of_day: v })} />
          </GatedAction>
          <span className="rb-scene-divider" aria-hidden="true" />
          {onBulkRemove && (
            <Button size="sm" Icon={ListMinus} onClick={() => onBulkRemove('shot', [...selected], clearSelection)}>
              Remove from list
            </Button>
          )}
          <GatedAction allowed={canWrite}>
            <Button size="sm" variant="danger" Icon={Trash2} onClick={() => setConfirmBulk(true)}>
              Delete
            </Button>
          </GatedAction>
          <IconButton size="sm" Icon={X} title="Clear the selection" onClick={clearSelection} />
        </div>
      )}

      <Table
        className="rb-scene-table rb-scene-table-shots"
        data-takes={takes?.supports ? 'true' : 'false'}
        head={(
          <Row>
            <Th width="var(--rb-scene-col-check)" className="rb-scene-check-cell">
              <button type="button" onClick={toggleAll}
                className="rb-scene-check"
                data-checked={allSelected ? 'all' : someSelected ? 'some' : 'none'}
                aria-label={allSelected ? 'Clear the selection' : 'Select every shot'}
                title={allSelected ? 'Clear the selection' : 'Select every shot'}>
                {allSelected
                  ? <CheckSquare aria-hidden="true" />
                  : someSelected
                    ? <MinusSquare aria-hidden="true" />
                    : <Square aria-hidden="true" />}
              </button>
            </Th>
            <Th width="var(--rb-scene-col-thumb)" className="rb-scene-thumb-cell"><span className="sr-only">Thumbnail</span></Th>
            <Th width="var(--rb-scene-col-num)" numeric>#</Th>
            <Th width="var(--rb-scene-col-name)">Shot name</Th>
            {takes?.supports && <Th width="var(--rb-scene-col-takes)" title="Bin files assigned to the shot; the starred one is the primary take">Takes</Th>}
            <Th width="var(--rb-scene-col-status)">Status</Th>
            <Th width="var(--rb-scene-col-time)">Time of day</Th>
            <Th width="var(--rb-scene-col-type)">Type</Th>
            <Th width="var(--rb-scene-col-framing)">Framing</Th>
            <Th width="var(--rb-scene-col-move)">Cam move</Th>
            <Th>Description</Th>
            <Th width="var(--rb-scene-col-runtime)" numeric>Duration</Th>
            <Th width="var(--rb-scene-col-frames)" numeric>Frames</Th>
            <Th width="var(--rb-scene-col-date)">Start</Th>
            <Th width="var(--rb-scene-col-date)">End</Th>
            <Th width="var(--rb-scene-col-acts)" align="right"><span className="sr-only">Actions</span></Th>
          </Row>
        )}
      >

        {shotGroups.map(g => {
          const isGrouped = g.groupType !== 'none'
          const collapsed = isGrouped && collapsedGroups.has(g.key)
          const groupFrames = g.shots.reduce((s, sh) => s + (Number(sh.frame_count) || 0), 0)
          // S3c step 6: a scene's band takes a drag (and can be dragged) only
          // as a scene's — a band of no scene is no block.
          const bandDrag = drag && g.groupType === 'scene' && g.sceneId ? drag : null
          // A scene dropped after this band lands after its shots: the line
          // is its last shot's while they show (review round 1, R1-07).
          const { head: bandAt, lastRow: bandAfterLast } = blockLine(bandDrag?.lineOf?.('scene', g.sceneId), 'scene', !collapsed && g.shots.length > 0)
          const lastShotId = g.shots[g.shots.length - 1]?.id
          return (
            <Fragment key={g.key}>
              {/* A group's band (none for ungrouped): one row across the
                  table on the raised paper. Its toggle is a button now (it
                  was a clickable div), and Scene details sits BESIDE it, not
                  inside it. A scene's status is the kit's StatusDot (the 3px
                  accent in its colour is gone, R3-11); names in the ink. */}
              {isGrouped && (
                <Row
                  className="rb-scene-group-row"
                  data-drop={bandAt === 'before' ? 'before' : bandAt === 'after' ? 'after' : undefined}
                  onDragOver={bandDrag ? bandDrag.over('scene', g.sceneId) : undefined}
                  onDragLeave={bandDrag ? bandDrag.leave('scene', g.sceneId) : undefined}
                  onDrop={bandDrag ? bandDrag.drop('scene', g.sceneId) : undefined}
                >
                  <Td colSpan={span} className="rb-scene-group-cell">
                    <span className="rb-scene-group-head">
                      {bandDrag && <Grip drag={bandDrag} kind="scene" id={g.sceneId} name={g.label} />}
                      <button type="button" onClick={() => toggleGroup(g.key)}
                        aria-expanded={!collapsed}
                        className="rb-scene-group-toggle">
                        {collapsed
                          ? <ChevronRight className="rb-scene-group-chevron" aria-hidden="true" />
                          : <ChevronDown className="rb-scene-group-chevron" aria-hidden="true" />}
                        {g.scene && <StatusDot status={g.scene.status || 'not_started'} aria-hidden="true" role={undefined} aria-label={undefined} />}
                        {g.groupType === 'scene'
                          ? <Film className="rb-scene-group-icon" aria-hidden="true" />
                          : <Layers className="rb-scene-group-icon" aria-hidden="true" />}
                        <span className="rb-scene-group-label">{g.label}</span>
                        <span className="rb-scene-group-count">
                          ({g.shots.length} shot{g.shots.length !== 1 ? 's' : ''})
                        </span>
                        {groupFrames > 0 && (
                          <span className="rb-scene-group-frames">
                            {framesToTimecode(groupFrames, fps)} · {fmtNumber(groupFrames)} frames
                          </span>
                        )}
                      </button>
                      {g.scene && (
                        <IconButton size="sm" Icon={Eye} title="Scene details"
                          onClick={e => { e.stopPropagation(); onOpenSceneDetail(g.sceneId) }} />
                      )}
                    </span>
                  </Td>
                </Row>
              )}

              {/* Shot rows */}
              {!collapsed && g.shots.map(shot => {
                const isChecked = selected.has(shot.id)
                const shotTakeEntries = takes?.map?.get(shot.id) || []
                const takeFallback = takes?.supports && !shot.thumbnail_image ? primaryOf(shotTakeEntries)?.file : null
                const shotName = shot.name || 'Untitled'
                const shotDropAt = drag?.at('shot', shot.id) || (shot.id === lastShotId ? bandAfterLast : undefined)
                return (
                  <Row
                    key={shot.id}
                    className="rb-scene-row"
                    selected={isChecked}
                    data-ticked={isChecked ? 'true' : 'false'}
                    data-drop={shotDropAt === 'before' ? 'before' : shotDropAt === 'after' ? 'after' : undefined}
                    onDragOver={drag ? drag.over('shot', shot.id) : undefined}
                    onDragLeave={drag ? drag.leave('shot', shot.id) : undefined}
                    onDrop={drag ? drag.drop('shot', shot.id) : undefined}
                  >
                    {/* Checkbox: one 28px square (R3-40) */}
                    <Td className="rb-scene-check-cell">
                      <button type="button" onClick={() => toggleOne(shot.id)}
                        className="rb-scene-check"
                        data-checked={isChecked ? 'all' : 'none'}
                        aria-pressed={isChecked}
                        aria-label={`Select ${shotName}`}
                        title={`Select ${shotName}`}>
                        {isChecked ? <CheckSquare aria-hidden="true" /> : <Square aria-hidden="true" />}
                      </button>
                    </Td>

                    {/* Thumbnail */}
                    <Td className="rb-scene-thumb-cell">
                      <div className="rb-scene-thumb" data-static={canWrite ? undefined : 'true'}
                        onClick={canWrite ? async e => {
                          e.stopPropagation()
                          if (!window.electronAPI?.rabbit?.pickImage) return
                          const imagePath = await window.electronAPI.rabbit.pickImage()
                          if (!imagePath) return
                          ctx?.updateShot?.(shot.id, { thumbnail_image: imagePath })
                          try { await window.electronAPI.rabbit.generateEntityThumbnail({ entityType: 'shot', entityId: shot.id, sourcePath: imagePath }) } catch {}
                          onThumbChanged?.()
                        } : undefined}>
                        {shot.thumbnail_image ? (
                          <>
                            <img className="rb-scene-thumb-img" src={`/api/rabbit/projects/${ctx?.project?.id}/shots/${shot.id}/thumbnail?r=${thumbRevision}`} alt="" />
                            {canWrite && <span className="rb-scene-thumb-over"><ImagePlus aria-hidden="true" /></span>}
                          </>
                        ) : takeFallback ? (
                          <>
                            {/* The primary take's poster stands in for an empty thumbnail (Q6); clicking still picks an image of her own. */}
                            <BinPoster row={takeFallback} src={takes.thumbUrlFor?.(takeFallback.id)} width={tw} height={rowH} radius={0} className="rb-scene-poster" />
                            {canWrite && <span className="rb-scene-thumb-over" title="From the primary take. Click to set a thumbnail of your own."><ImagePlus aria-hidden="true" /></span>}
                          </>
                        ) : (
                          <>
                            <Clapperboard className="rb-scene-thumb-mark" aria-hidden="true" />
                            {canWrite && <ImagePlus className="rb-scene-thumb-add" aria-hidden="true" />}
                          </>
                        )}
                      </div>
                    </Td>

                    {/* Shot # — and, grouped by scene in the list's own order, its grip (S3c step 6) */}
                    <Td numeric className="rb-scene-num-cell" data-empty={shot.shot_number == null ? 'true' : undefined} data-grip={drag ? 'true' : undefined}>
                      {drag && <Grip drag={drag} kind="shot" id={shot.id} name={shotName} />}
                      {shot.shot_number ?? '—'}
                    </Td>

                    {/* Name: the row's anchor, 600 in the ink */}
                    <Td className="rb-scene-name-cell">
                      <InlineText
                        value={shot.name || ''}
                        placeholder="Untitled shot"
                        strong
                        label={`Name for ${shotName}`}
                        title={nameTitle?.(shot.id)}
                        readOnly={!canWrite}
                        onCommit={v => ctx?.updateShot?.(shot.id, { name: v })}
                      />
                    </Td>

                    {/* Takes (milestone 2) */}
                    {takes?.supports && (
                      <Td className="rb-scene-takes-cell" onClick={e => e.stopPropagation()}>
                        <ShotTakeChips entries={shotTakeEntries} thumbUrlFor={takes.thumbUrlFor} height={Math.min(rowH, 26)} max={3}
                          canWrite={takes.canWrite} onOpen={() => takes.open(shot.id)} />
                      </Td>
                    )}

                    {/* Status: the kit's StatusDot beside a CellSelect (R3-11) */}
                    <Td className="rb-scene-status-cell">
                      <span className="rb-scene-status">
                        <StatusDot status={shot.status || 'not_started'} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
                        <CellSelect
                          className="rb-scene-status-select"
                          value={shot.status || 'not_started'}
                          onChange={v => ctx?.updateShot?.(shot.id, { status: v })}
                          options={STATUS_OPTIONS}
                          disabled={!canWrite}
                          aria-label={`Status for ${shotName}`}
                        />
                      </span>
                    </Td>

                    {/* Time of day */}
                    <Td className="rb-scene-time-cell">
                      <CellSelect
                        value={shot.time_of_day || null}
                        onChange={v => ctx?.updateShot?.(shot.id, { time_of_day: v })}
                        placeholder="—"
                        options={TIME_OPTIONS}
                        disabled={!canWrite}
                        aria-label={`Time of day for ${shotName}`}
                      />
                    </Td>

                    {/* Type */}
                    <Td className="rb-scene-type-cell">
                      <CellSelect
                        value={shot.type || 'other'}
                        onChange={v => ctx?.updateShot?.(shot.id, { type: v })}
                        options={TYPE_OPTIONS}
                        disabled={!canWrite}
                        aria-label={`Type for ${shotName}`}
                      />
                    </Td>

                    {/* Framing: the code in the cell, the long names in the list */}
                    <Td className="rb-scene-framing-cell">
                      <span className="rb-scene-framing">
                        <span className="rb-scene-framing-code" data-empty={shot.framing ? undefined : 'true'} aria-hidden="true">{shot.framing || '—'}</span>
                        <CellSelect
                          className="rb-scene-framing-select"
                          value={shot.framing || null}
                          onChange={v => ctx?.updateShot?.(shot.id, { framing: v })}
                          placeholder="—"
                          options={FRAMING_CHOICES}
                          disabled={!canWrite}
                          aria-label={`Framing for ${shotName}`}
                        />
                      </span>
                    </Td>

                    {/* Camera movement */}
                    <Td className="rb-scene-move-cell">
                      <CellSelect
                        value={shot.camera_movement || null}
                        onChange={v => ctx?.updateShot?.(shot.id, { camera_movement: v })}
                        placeholder="—"
                        options={MOVE_CHOICES}
                        disabled={!canWrite}
                        aria-label={`Camera movement for ${shotName}`}
                      />
                    </Td>

                    {/* Description */}
                    <Td className="rb-scene-desc-cell">
                      <InlineText
                        value={shot.description || ''}
                        placeholder="Add description…"
                        size="sm"
                        label={`Description for ${shotName}`}
                        readOnly={!canWrite}
                        onCommit={v => ctx?.updateShot?.(shot.id, { description: v })}
                      />
                    </Td>

                    {/* Duration (derived): a zero at the third ink (R3-13) */}
                    <Td numeric className="rb-scene-dur-cell" data-empty={(shot.frame_count || 0) > 0 ? undefined : 'true'}>
                      {framesToTimecode(shot.frame_count || 0, fps)}
                    </Td>

                    {/* Frame count (editable): the kit's small field */}
                    <Td numeric className="rb-scene-frames-cell">
                      <input
                        type="number"
                        min={0}
                        value={shot.frame_count ?? ''}
                        onChange={e => {
                          const n = parseInt(e.target.value, 10)
                          ctx?.updateShot?.(shot.id, { frame_count: Number.isFinite(n) && n >= 0 ? n : 0 })
                        }}
                        disabled={!canWrite}
                        aria-label={`Frames for ${shotName}`}
                        className="ui-input rb-scene-frames"
                        data-size="sm"
                        placeholder="0"
                      />
                    </Td>

                    {/* Start date */}
                    <Td className="rb-scene-date-cell">
                      <input
                        type="date"
                        value={shot.start_date || ''}
                        onChange={e => ctx?.updateShot?.(shot.id, { start_date: e.target.value || null })}
                        disabled={!canWrite}
                        aria-label={`Start date for ${shotName}`}
                        className="ui-input rb-scene-date"
                        data-size="sm"
                        data-empty={shot.start_date ? undefined : 'true'}
                      />
                    </Td>

                    {/* End date */}
                    <Td className="rb-scene-date-cell">
                      <input
                        type="date"
                        value={shot.end_date || ''}
                        onChange={e => ctx?.updateShot?.(shot.id, { end_date: e.target.value || null })}
                        disabled={!canWrite}
                        aria-label={`End date for ${shotName}`}
                        className="ui-input rb-scene-date"
                        data-size="sm"
                        data-empty={shot.end_date ? undefined : 'true'}
                      />
                    </Td>

                    {/* Actions: the kit HoverActions, the one slot width (R3-24) */}
                    <Td align="right" className="rb-scene-acts-cell">
                      <HoverActions className="rb-scene-acts">
                        <IconButton size="sm" Icon={Eye} title="View details" onClick={() => onOpenShotDetail(shot.id)} />
                        <RowMore name={shotName} items={rowMenu?.('shot', shot, g.shots.map(s => s.id))} />
                        <GatedAction allowed={canWrite}>
                          <IconButton size="sm" Icon={Trash2} danger title="Delete shot"
                            onClick={() => onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' })} />
                        </GatedAction>
                      </HoverActions>
                    </Td>
                  </Row>
                )
              })}

              {/* Add shot row */}
              {!collapsed && g.scene && (
                <Row>
                  <Td colSpan={span} className="rb-scene-add-cell">
                    <GatedAction allowed={canAdd} reason={addReason} display="flex">
                      <button type="button" onClick={() => onNewShot(g.sceneId)} className="rb-scene-add">
                        <Plus aria-hidden="true" /> Add shot
                      </button>
                    </GatedAction>
                  </Td>
                </Row>
              )}
            </Fragment>
          )
        })}
      </Table>

      {/* W9: the bulk question, word for word, on the kit Dialog in <body>.
          It never closed on a click outside (window.confirm). */}
      {confirmBulk && (
        <ConfirmDialog
          title="Delete shots"
          message={describeDelete('shot', [...selected], 'bar')}
          dismissOnBackdrop={false}
          onCancel={() => setConfirmBulk(false)}
          onConfirm={() => { setConfirmBulk(false); bulkDelete() }}
        />
      )}
    </div>
  )
}


// ─── Shot gallery (shot cards grouped by scene) ───
// The scene gallery's card (above), its well the 16:9 frame it always was:
// her own thumbnail, else the primary take's poster (milestone 2, Q6), else
// the clapperboard. A frame can hold a picture, so its delete sits on the
// paper, as the Assets cards' media buttons do (B4b), and reads over one.
// The shot number in the second ink beside the kit's StatusBadge (the 2px
// status-coloured bar goes, R3-11); the runtime and the frame count in the
// mono, both in the third ink — the count was #44403c, 1.7:1 (R3-13). The
// take chips keep the 20px height ScenesView always handed them (B6 §4).
// A group's head is the shot table's band in the gallery's shape: the glyph
// and the count in the third ink, the name at 600 in the ink (they were
// orange), the named kit IconButton for Scene details, then a hairline.
function ShotGallery({ shotGroups, gallerySize, fps, ctx, takes, thumbRevision = 0, canWrite = false, rowMenu, nameTitle, onOpenSceneDetail, onOpenShotDetail, onRequestDelete }) {
  // The sheet sizes the cards (`.rb-scene-gallery[data-card]`, the same three
  // widths and their 16:9 heights); these are what BinPoster is handed.
  const sizeMap = { sm: 160, md: 220, lg: 300 }
  const cardW = sizeMap[gallerySize] || sizeMap.md
  const cardH = Math.round(cardW * 9 / 16)

  if (shotGroups.length === 0 || shotGroups.every(g => g.shots.length === 0)) {
    // The kit's empty state (R3-19), in the same words (the gallery's had no
    // instruction line; the table's still does).
    return <EmptyState Icon={Clapperboard} title="No shots yet" />
  }

  return (
    <div className="rb-scene-gallery" data-card={gallerySize}>
      {shotGroups.map(g => {
        const groupFrames = g.shots.reduce((s, sh) => s + (Number(sh.frame_count) || 0), 0)
        // Keyed on the group's own key: only a scene group has a sceneId, so
        // grouped by a field every group was keyed `undefined`.
        return (
          <div key={g.key} className="rb-scene-gallery-group">
            {/* Scene group header */}
            <div className="rb-scene-gallery-head">
              <Film className="rb-scene-group-icon" aria-hidden="true" />
              <span className="rb-scene-group-label">
                {g.label}
              </span>
              <span className="rb-scene-group-count">
                {g.shots.length} shot{g.shots.length !== 1 ? 's' : ''}
              </span>
              {groupFrames > 0 && (
                <span className="rb-scene-group-count">
                  · {framesToTimecode(groupFrames, fps)}
                </span>
              )}
              {g.scene && (
                <IconButton size="sm" Icon={Eye} title="Scene details" onClick={() => onOpenSceneDetail(g.sceneId)} />
              )}
              <span className="rb-scene-gallery-rule" aria-hidden="true" />
            </div>

            {/* Shot cards */}
            <div className="rb-scene-cards">
              {g.shots.map(shot => {
                const shotTakeEntries = takes?.map?.get(shot.id) || []
                const takeFallback = takes?.supports && !shot.thumbnail_image ? primaryOf(shotTakeEntries)?.file : null
                const name = shot.name || 'Untitled'
                return (
                <Card key={shot.id} pad={false} className="rb-scene-card ui-hover-host" onClick={() => onOpenShotDetail?.(shot.id)}>
                  {/* Thumbnail (16:9): her own, else the primary take's poster (milestone 2, Q6), else the placeholder */}
                  <div className="rb-scene-card-media rb-scene-card-frame">
                    {shot.thumbnail_image ? (
                      <img className="rb-scene-card-img" src={`/api/rabbit/projects/${ctx?.project?.id}/shots/${shot.id}/thumbnail?r=${thumbRevision}`}
                        alt="" />
                    ) : takeFallback ? (
                      <BinPoster row={takeFallback} src={takes.thumbUrlFor?.(takeFallback.id)} width={cardW} height={cardH} radius={0} className="rb-scene-poster" iconSize={28} />
                    ) : (
                      <Clapperboard className="rb-scene-card-glyph" aria-hidden="true" />
                    )}
                    <HoverActions className="rb-scene-card-acts">
                      <RowMore name={name} items={rowMenu?.('shot', shot, g.shots.map(s => s.id))} />
                      <GatedAction allowed={canWrite}>
                        <IconButton size="sm" Icon={Trash2} danger title={`Delete ${name}`} className="rb-scene-card-delete"
                          onClick={e => { e.stopPropagation(); onRequestDelete({ type: 'shot', id: shot.id, name }) }} />
                      </GatedAction>
                    </HoverActions>
                  </div>
                  {/* Info */}
                  <div className="rb-scene-card-body">
                    <span className="rb-scene-card-name" title={nameTitle?.(shot.id)}>
                      {shot.name || 'Untitled shot'}
                    </span>
                    {shot.description && (
                      <span className="rb-scene-card-desc">
                        {shot.description}
                      </span>
                    )}
                    <div className="rb-scene-card-meta">
                      <span className="rb-scene-card-num">
                        #{shot.shot_number ?? '—'}
                      </span>
                      <StatusBadge status={shot.status || 'not_started'} />
                    </div>
                    {(shot.frame_count || 0) > 0 && (
                      <div className="rb-scene-card-meta">
                        <span className="rb-scene-card-figure">
                          {framesToTimecode(shot.frame_count, fps)}
                        </span>
                        <span className="rb-scene-card-figure">
                          {fmtNumber(shot.frame_count)} fr
                        </span>
                      </div>
                    )}
                    {takes?.supports && (
                      <div className="rb-scene-card-takes" onClick={e => e.stopPropagation()}>
                        <ShotTakeChips entries={shotTakeEntries} thumbUrlFor={takes.thumbUrlFor} height={20} max={4}
                          canWrite={takes.canWrite} onOpen={() => takes.open(shot.id)} />
                      </div>
                    )}
                  </div>
                </Card>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}


// ─── Scene detail popup ───
// Lane B5b, surface 6c (2026-09-27): the kit Dialog at the popup's old width,
// 896px (its max-w-4xl: a real geometry, so a number), 🚨 PORTALLED into
// <body> — the kit Dialog does not portal (B4-KR-2) — on the Dialog's raised
// paper, where it was the legacy #292524 (the third ink fails there, 4.37:1,
// and passes on the raised paper, 4.66). B4c's EntityDetailPopup
// (EntityListView.jsx) is its pattern, re-made in this lane's classes. The
// kit's backdrop centres it with flex, as the old layer did, never a
// transform, so a fixed-position layer inside it still places against the
// window. The header keeps the scene's glyph, its name and its code: the name
// is the H2 title, read-only — the "Scene name" field below is still where it
// is edited (C1: the two stay two) — and names the Dialog. The status is the
// kit's StatusBadge, where the 3px status-coloured rule under the header said
// it (R3-11). The kit brings the named ✕ (the old one had no name), Escape
// (Q17) and the backdrop, which closed it before and still does. The body
// keeps its two columns — RelationsPanel's sidebar, then the properties — and
// every section, field and button in its old order.
//
// R3-36: the same fields in the same order in the same two grids, each grid
// under the kit's SectionTitle, its hairline above and its heading at the
// Label step — Identity, and Schedule (the counts and the two dates, as the
// shot popup's Schedule holds its parent scene and its dates). Each field is
// the kit's small well (legible as editable at rest, R3-26's lesson in the
// tables); a value nobody types — Runtime, Total frames, the counts, the
// folder — is inert: no well, no edge, the second ink, never a tab stop.
//
// 🚨 THE TASK FORM. "Add new task" opens NewTaskSidePopup to the popup's
// LEFT, as it always did — INSIDE the Dialog now, as its first column: the
// Dialog is one surface, and its focus trap would strand a panel drawn beside
// it (the kit has no side-panel slot, B4c-KR-1). The Dialog grows by the
// form's width and the hairline after it; at 94vw the properties column
// gives, as the old popup shrank beside the form. A task opened from the
// sidebar is TaskDetailPopup, itself a kit Dialog: it opens as this Dialog's
// SIBLING, portalled, over it on the modal stack, so one Escape closes it and
// this popup stays.
//
// R4-26's twin (P1-23) — a related asset's click set `nestedAssetId`, which
// nothing rendered — is closed on this side (S3b step 7): the asset opens in
// the Assets tab's own AssetDetailPopup, over this popup on the modal stack,
// as a task opens in TaskDetailPopup; one Escape closes it and this stays.
//
// S3b step 7: `canWrite` (project.entity.write) — for a seat that may not
// write scenes (a reviewer) every field is read-only and every verb greyed
// with the reason (GatedAction); and D21 — a description or notes draft is
// never dropped without a word (PopupDraftText; the question, ListConfirm,
// over this popup, Cancel focused).
function SceneDetailPopup({ sceneId, ctx, fps, sceneShots, assetCountByScene, taskCountByScene, projectMembers, roleEntries, thumbRevision, onThumbChanged, onNewShot, onClose, onRequestDelete, onOpenShot, canWrite = false, canAdd = false, addReason }) {
  // S3b step 1: found among EVERY scene (ctx.sceneById, S3a), so a scene of
  // a list that is not the active one opens; ctx.scenes is the active list's.
  const scene = ctx?.sceneById?.(sceneId) || null
  const totalFrames = sceneShots.reduce((sum, sh) => sum + (Number(sh.frame_count) || 0), 0)
  const totals = { totalFrames, runtime: framesToTimecode(totalFrames, fps) }
  const project = ctx?.project
  const managedFiles = ctx?.managedFiles || []

  const [editingDesc, setEditingDesc] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  // Review round 1 (R1-06, D21): each draft follows the saved words while
  // its editor is closed, or open and untouched — never once typed in.
  const [descDraft, setDescDraft] = useSavedDraft(scene?.description || '', editingDesc)
  const [notesDraft, setNotesDraft] = useSavedDraft(scene?.notes || '', editingNotes)
  // Focus back to each one's words when its edit closes (R2-05, useFocusBack).
  const descWordsRef = useFocusBack(editingDesc)
  const notesWordsRef = useFocusBack(editingNotes)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [nestedTaskId, setNestedTaskId] = useState(null)
  const [nestedAssetId, setNestedAssetId] = useState(null)
  // D21: the draft a question is about — 'close' (the popup), 'description'
  // or 'notes' (Escape in its box) — while it asks.
  const [askDiscard, setAskDiscard] = useState(null)
  // Post-overhaul S3c, step 7 (S3b-05, S3b-08): the task form's typed work
  // counts as the popup's, and an EXIT that would take the popup away — the
  // tab strip, "Show in Bins", a project switch, a jump opening another
  // row's popup — asks D21's question first (state/leaveGuard.js).
  const [taskDirty, setTaskDirty] = useState(false)
  const [leaveAsk, setLeaveAsk] = useState(null)
  const dirtyRef = useRef(false)
  useLeaveGuard({ order: 1, reasons: POPUP_EXITS, dirty: () => dirtyRef.current, ask: () => new Promise(resolve => setLeaveAsk({ resolve })) })
  // Review round 1 (R1-10): the scene gone under an open question (deleted
  // elsewhere) — it can never be answered here: the exit stays, the question
  // goes, and the leave guard's lock is let go.
  useEffect(() => {
    if (!scene && leaveAsk) { leaveAsk.resolve(false); setLeaveAsk(null) }
  }, [scene, leaveAsk])
  // What opened this popup — a row's "View details" — captured in render, as
  // the kit Dialog captures it (an effect would read the popup's own focus).
  // The delete question asked from here is handed it (ConfirmDialog).
  const openerRef = useRef(null)
  if (openerRef.current === null && typeof document !== 'undefined') openerRef.current = document.activeElement

  if (!scene) { dirtyRef.current = false; return null }

  // What the Dialog is named for: the name its title shows.
  const name = scene.name || 'Untitled scene'
  const status = scene.status || 'not_started'
  const hasThumbnail = !!scene.thumbnail_image

  function handleUpdate(patch) { if (canWrite) ctx?.updateScene?.(scene.id, patch) }
  // D21: a draft that differs from what is saved, in an open editor — and
  // (S3b-05) a task form with anything typed or chosen in it.
  const dirty = {
    description: editingDesc && descDraft !== (scene.description || ''),
    notes: editingNotes && notesDraft !== (scene.notes || ''),
    task: showCreateTask && taskDirty,
  }
  dirtyRef.current = dirty.description || dirty.notes || dirty.task
  /** The kit Dialog's onBeforeClose (Escape, ✕, the backdrop) and Close: ask first when a draft would go. */
  const requestClose = () => {
    if (!dirty.description && !dirty.notes && !dirty.task) return true
    setAskDiscard('close')
    return false
  }
  const discard = (what) => {
    setAskDiscard(null)
    if (what === 'close') { onClose(); return }
    if (what === 'description') { setDescDraft(scene.description || ''); setEditingDesc(false) }
    else { setNotesDraft(scene.notes || ''); setEditingNotes(false) }
  }

  async function handleSetThumbnail() {
    if (!canWrite || !window.electronAPI?.rabbit?.pickImage) return
    const imagePath = await window.electronAPI.rabbit.pickImage()
    if (!imagePath) return
    handleUpdate({ thumbnail_image: imagePath })
    try {
      await window.electronAPI.rabbit.generateEntityThumbnail({ entityType: 'scene', entityId: scene.id, sourcePath: imagePath })
    } catch (e) { console.error('scene thumbnail gen failed:', e) }
    onThumbChanged?.()
  }

  async function handleClearThumbnail() {
    if (!canWrite) return
    handleUpdate({ thumbnail_image: null })
    try { await window.electronAPI.rabbit.clearEntityThumbnail({ entityType: 'scene', entityId: scene.id }) } catch {}
    onThumbChanged?.()
  }

  async function handleCreateTask(draft) {
    if (!canWrite) return
    try {
      await ctx?.addTask?.({ ...draft, scene_id: scene.id })
      setShowCreateTask(false)
    } catch (err) { console.error('Failed to create task:', err) }
  }

  const sceneCode = sceneCodeFor(project, scene.scene_number ?? 0)
  const sceneSlug = fileSlugify(scene.name || 'Untitled-Scene')
  const sceneFolderPath = `SCENES/${sceneSlug}/`

  return (
    <>
      {createPortal(
        <Dialog
          // Wider by the task form's column while it is open.
          width={showCreateTask ? DETAIL_WIDTH + DETAIL_TASK_WIDTH : DETAIL_WIDTH}
          // In <body> it is outside the app's `wilson-dark-scroll` root, so
          // it carries the class itself, as A4's Help does: its columns
          // scroll on the app's dark bar (review round one, R1-12).
          className="rb-scene-detail wilson-dark-scroll"
          // A title that is a node names nothing, so the Dialog carries the
          // scene's name as its aria-label, as B4c's popup does.
          aria-label={name}
          title={(
            <span className="rb-scene-detail-title">
              <Film aria-hidden="true" className="rb-scene-detail-icon" />
              <span className="rb-scene-detail-name">{name}</span>
              <Badge className="rb-scene-detail-code">{sceneCode}</Badge>
            </span>
          )}
          subtitle={<StatusBadge status={status} />}
          dismissOnBackdrop
          onBeforeClose={requestClose}
          onClose={onClose}
          footer={(
            <>
              {/* At the footer's left, where it was; Close at its right. The
                  class on both: GatedAction draws its wrapper only when it greys. */}
              <GatedAction allowed={canWrite} className="rb-scene-detail-delete">
                <Button variant="danger" Icon={Trash2} className="rb-scene-detail-delete"
                  onClick={() => { onClose(); onRequestDelete({ type: 'scene', id: scene.id, name: scene.name || 'Untitled', returnTo: openerRef.current }) }}>
                  Delete scene
                </Button>
              </GatedAction>
              <Button onClick={() => { if (requestClose()) onClose() }}>
                Close
              </Button>
            </>
          )}
        >
          <div className="rb-scene-detail-body">

            {/* The task form: the first column, while it is open */}
            {showCreateTask && (
              <div className="rb-scene-detail-task">
                <NewTaskSidePopup
                  entityType="scene"
                  entityId={scene.id}
                  assets={ctx?.assets || []}
                  phases={ctx?.phases || []}
                  // Every scene and shot (S3b step 1): a task may link to a
                  // row another list holds, this scene among them.
                  scenes={ctx?.allScenes || []}
                  shots={ctx?.allShots || []}
                  levels={ctx?.levels || []}
                  experiences={ctx?.experiences || []}
                  projectMembers={projectMembers || []}
                  roleEntries={roleEntries || []}
                  project={project}
                  onConfirm={handleCreateTask}
                  onClose={() => setShowCreateTask(false)}
                  onDirtyChange={setTaskDirty}
                />
              </div>
            )}

            {/* Relations: RelationsPanel's sidebar, the kit Panel */}
            <div className="rb-scene-detail-side">
              <RelationsPanel
                entityType="scene"
                entityId={scene.id}
                assets={ctx?.assets || []}
                tasks={ctx?.tasks || []}
                ctx={ctx}
                onOpenAsset={id => setNestedAssetId(id)}
                onOpenTask={id => setNestedTaskId(id)}
                // Review round 1 (R1-04): a task is an entity write — no "Add
                // new task" for a seat that may not make one (RelationsPanel
                // draws it only when it is handed this; greying it is S3c's,
                // in that file).
                onCreateTask={canWrite ? () => setShowCreateTask(true) : undefined}
                // Post-overhaul S3c (S3b-01): the asset relations' add and
                // removes, greyed with the reason for the same seat.
                canWrite={canWrite}
              />
            </div>

            {/* Properties */}
            <div className="rb-scene-detail-main">

              {/* The thumbnail, then the name */}
              <div className="rb-scene-detail-top">
                <div className="rb-scene-detail-thumb ui-hover-host">
                  {hasThumbnail ? (
                    <>
                      <img
                        className="rb-scene-detail-thumb-img"
                        src={`/api/rabbit/projects/${project?.id}/scenes/${scene.id}/thumbnail?r=${thumbRevision}`}
                        alt="" />
                      {/* Change and remove over the picture: the kit's
                          HoverActions, shown on hover as they were, and on
                          keyboard focus now. Not for a seat that may not
                          write scenes: the picture alone. */}
                      {canWrite && (
                        <HoverActions className="rb-scene-detail-thumb-acts">
                          <IconButton size="sm" Icon={ImagePlus} className="rb-scene-detail-thumb-act" title="Change thumbnail" onClick={handleSetThumbnail} />
                          <IconButton size="sm" Icon={ImageOff} danger className="rb-scene-detail-thumb-act" title="Remove thumbnail" onClick={handleClearThumbnail} />
                        </HoverActions>
                      )}
                    </>
                  ) : !canWrite ? (
                    <Film aria-hidden="true" className="rb-scene-detail-thumb-glyph" />
                  ) : (
                    <button type="button" onClick={handleSetThumbnail}
                      className="rb-scene-detail-thumb-set"
                      title="Set thumbnail">
                      <span className="rb-scene-detail-thumb-hint">
                        <ImagePlus aria-hidden="true" className="rb-scene-detail-thumb-hint-icon" />
                        Set thumbnail
                      </span>
                      <Film aria-hidden="true" className="rb-scene-detail-thumb-glyph" />
                    </button>
                  )}
                </div>
                <div className="rb-scene-detail-field">
                  <FieldLabel>Scene name</FieldLabel>
                  <PopupInlineText
                    value={scene.name || ''}
                    placeholder="Untitled scene"
                    label="Scene name"
                    readOnly={!canWrite}
                    onCommit={v => handleUpdate({ name: v })}
                  />
                </div>
              </div>

              {/* Identity: the status, type, time of day and number, and the
                  runtime and frames its shots add up to (R3-36). Each control
                  is named for its label, which labels nothing by itself. */}
              <div className="rb-scene-group">
                <SectionTitle as="h3" className="rb-scene-section">Identity</SectionTitle>
                <div className="rb-scene-prop-grid">
                  <div className="rb-scene-prop">
                    <FieldLabel>Status</FieldLabel>
                    {/* The kit's dot inside the well, the kit's words in the
                        select: the status colour on the text and on every
                        option is gone (R3-11). */}
                    <span className="rb-scene-prop-status">
                      <StatusDot status={status} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
                      <select value={status} onChange={e => handleUpdate({ status: e.target.value })}
                        disabled={!canWrite}
                        aria-label="Status"
                        className="ui-input rb-scene-prop-status-input"
                        data-size="sm">
                        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </span>
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>Type</FieldLabel>
                    <select value={scene.type || 'interior'} onChange={e => handleUpdate({ type: e.target.value })}
                      disabled={!canWrite}
                      aria-label="Type"
                      className="ui-input rb-scene-prop-select"
                      data-size="sm">
                      {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>Time of day</FieldLabel>
                    <select value={scene.time_of_day || ''} onChange={e => handleUpdate({ time_of_day: e.target.value || null })}
                      disabled={!canWrite}
                      aria-label="Time of day"
                      className="ui-input rb-scene-prop-select"
                      data-size="sm"
                      data-empty={scene.time_of_day ? undefined : 'true'}>
                      <option value="">—</option>
                      {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>Scene number</FieldLabel>
                    <input type="number" value={scene.scene_number ?? ''} onChange={e => {
                      const n = parseInt(e.target.value, 10)
                      if (Number.isFinite(n) && n >= 0) handleUpdate({ scene_number: n })
                    }}
                      disabled={!canWrite}
                      aria-label="Scene number"
                      className="ui-input rb-scene-prop-number"
                      data-size="sm" />
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>Runtime</FieldLabel>
                    <span className="rb-scene-prop-inert rb-scene-prop-figure" data-empty={totals.totalFrames > 0 ? undefined : 'true'}>
                      {totals.runtime}
                    </span>
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>Total frames</FieldLabel>
                    <span className="rb-scene-prop-inert rb-scene-prop-figure" data-empty={totals.totalFrames > 0 ? undefined : 'true'}>
                      {fmtNumber(totals.totalFrames)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Schedule: the counts, then the two dates (R3-36) */}
              <div className="rb-scene-group">
                <SectionTitle as="h3" className="rb-scene-section">Schedule</SectionTitle>
                <div className="rb-scene-prop-grid">
                  <div className="rb-scene-prop">
                    <FieldLabel>Shots / assets / tasks</FieldLabel>
                    <span className="rb-scene-prop-inert rb-scene-prop-figure">
                      <span className="rb-scene-prop-strong">{sceneShots.length}</span>
                      {` / ${assetCountByScene[sceneId] || 0} / ${taskCountByScene[sceneId] || 0}`}
                    </span>
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>Start date</FieldLabel>
                    <input
                      type="date"
                      value={scene.start_date || ''}
                      onChange={e => handleUpdate({ start_date: e.target.value || null })}
                      disabled={!canWrite}
                      aria-label="Start date"
                      className="ui-input rb-scene-date"
                      data-size="sm"
                      data-empty={scene.start_date ? undefined : 'true'}
                    />
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>End date</FieldLabel>
                    <input
                      type="date"
                      value={scene.end_date || ''}
                      onChange={e => handleUpdate({ end_date: e.target.value || null })}
                      disabled={!canWrite}
                      aria-label="End date"
                      className="ui-input rb-scene-date"
                      data-size="sm"
                      data-empty={scene.end_date ? undefined : 'true'}
                    />
                  </div>
                </div>
              </div>

              {/* Description: the words in the kit's well open its textarea;
                  Save and Cancel are the kit's Buttons (W2). A changed draft
                  asks before Escape drops it (D21, PopupDraftText). */}
              <div className="rb-scene-detail-text">
                <FieldLabel>Description</FieldLabel>
                <PopupDraftText label="Description" field="description" value={scene.description} emptyWords="Click to add a description..."
                  editing={editingDesc} setEditing={setEditingDesc} draft={descDraft} setDraft={setDescDraft} wordsRef={descWordsRef}
                  onSave={v => handleUpdate({ description: v })} onAskDiscard={() => setAskDiscard('description')} readOnly={!canWrite} />
              </div>

              {/* Notes: the same editor */}
              <div className="rb-scene-detail-text">
                <FieldLabel>Notes</FieldLabel>
                <PopupDraftText label="Notes" field="notes" value={scene.notes} emptyWords="Click to add notes..."
                  editing={editingNotes} setEditing={setEditingNotes} draft={notesDraft} setDraft={setNotesDraft} wordsRef={notesWordsRef}
                  onSave={v => handleUpdate({ notes: v })} onAskDiscard={() => setAskDiscard('notes')} readOnly={!canWrite} />
              </div>

              {/* The folder: a value nobody types, so inert (R3-36) */}
              <div className="rb-scene-detail-text">
                <FieldLabel>Folder</FieldLabel>
                <span className="rb-scene-prop-inert">
                  <FolderOpen aria-hidden="true" className="rb-scene-prop-glyph" />
                  <span className="rb-scene-prop-words rb-scene-prop-figure">{sceneFolderPath}</span>
                </span>
              </div>

              {/* Files: FileManager's own head says "Files (N)" (P1-24: the
                  popup's label said it again above it). */}
              <div className="rb-scene-detail-text">
                <FileManager
                  files={managedFiles}
                  sceneId={scene.id}
                  sceneName={scene.name || 'Untitled-Scene'}
                  projectId={project?.id}
                  project={project}
                  mode="full"
                  onFileAdded={() => ctx?.refreshManagedFiles?.()}
                  onFileDeleted={() => ctx?.refreshManagedFiles?.()}
                  onFileUpdated={() => ctx?.refreshManagedFiles?.()}
                />
              </div>

              {/* Shots: the list, each row opening its shot as before. A row
                  is on the paper with one hairline; its status the kit's
                  StatusBadge (R3-11); its delete the kit's IconButton, named
                  for its shot, in the kit's HoverActions — on hover as it
                  was, and on keyboard focus now (R3-24). Its click no longer
                  reaches the row (P1-22, S3b step 7: it opened the shot it
                  was asked to delete). */}
              <div className="rb-scene-detail-text">
                <div className="rb-scene-detail-list-head">
                  <FieldLabel>{`Shots (${sceneShots.length})`}</FieldLabel>
                  <GatedAction allowed={canAdd} reason={addReason}>
                    <Button size="sm" Icon={Plus} onClick={() => onNewShot(sceneId)}>
                      Add shot
                    </Button>
                  </GatedAction>
                </div>
                {sceneShots.length === 0 ? (
                  <EmptyState title="No shots yet" className="rb-scene-detail-empty" />
                ) : (
                  <ul className="rb-scene-shot-list">
                    {sceneShots.map(shot => (
                      <li key={shot.id} className="rb-scene-shot" onClick={() => onOpenShot?.(shot.id)}>
                        <Clapperboard aria-hidden="true" className="rb-scene-shot-glyph" />
                        <div className="rb-scene-shot-words" onClick={e => e.stopPropagation()}>
                          <button type="button" className="rb-scene-shot-name" onClick={() => onOpenShot?.(shot.id)}>
                            {shot.name || 'Untitled shot'}
                          </button>
                          <InlineText
                            value={shot.description || ''}
                            placeholder="Add description…"
                            size="xs"
                            label={`Description for ${shot.name || 'Untitled shot'}`}
                            readOnly={!canWrite}
                            onCommit={v => ctx?.updateShot?.(shot.id, { description: v })}
                          />
                        </div>
                        <span className="rb-scene-shot-num">#{shot.shot_number ?? '—'}</span>
                        {(shot.frame_count || 0) > 0 && (
                          <span className="rb-scene-shot-time">
                            {framesToTimecode(shot.frame_count, fps)} · {fmtNumber(shot.frame_count)} fr
                          </span>
                        )}
                        <StatusBadge status={shot.status || 'not_started'} />
                        <HoverActions className="rb-scene-shot-acts">
                          <GatedAction allowed={canWrite}>
                            <IconButton size="sm" Icon={Trash2} danger title={`Delete ${shot.name || 'Untitled shot'}`}
                              onClick={e => { e.stopPropagation(); onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' }) }} />
                          </GatedAction>
                        </HoverActions>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </Dialog>,
        document.body,
      )}

      {/* A task opened from the sidebar: its own kit Dialog, portalled beside
          this one and over it on the modal stack. Not while the task form is
          open, as before. B2's popup takes no className: the portal's
          wrapper gives it the app's dark bar (R1-12, as the takes dialogs'). */}
      {nestedTaskId && !showCreateTask && createPortal(
        <div className="wilson-dark-scroll">
          <TaskDetailPopup taskId={nestedTaskId} ctx={ctx} onClose={() => setNestedTaskId(null)} />
        </div>,
        document.body,
      )}
      {/* P1-23: a related asset, in the Assets tab's own popup (it portals itself). */}
      <NestedAsset ctx={ctx} assetId={nestedAssetId} thumbRevision={thumbRevision} onThumbChanged={onThumbChanged} onClose={() => setNestedAssetId(null)} canWrite={canWrite} />
      {/* D21: the draft question, over this popup. */}
      {askDiscard && (
        <ListConfirm
          title="Discard your changes?"
          confirmLabel="Discard"
          onCancel={() => setAskDiscard(null)}
          onConfirm={async () => discard(askDiscard)}
        >
          {discardWords(askDiscard, dirty)}
        </ListConfirm>
      )}
      {/* S3c step 7: the same question when an exit would take this popup
          away (S3b-08); Cancel stays, Discard lets the exit go on. */}
      {leaveAsk && (
        <ListConfirm
          title="Discard your changes?"
          confirmLabel="Discard"
          onCancel={() => { setLeaveAsk(null); leaveAsk.resolve(false) }}
          onConfirm={async () => { setLeaveAsk(null); leaveAsk.resolve(true) }}
        >
          {discardWords('close', dirty)}
        </ListConfirm>
      )}
    </>
  )
}


// ─── Shot detail popup ───
// Lane B5b, surface 6c (2026-09-27): the scene popup's twin (above) — the kit
// Dialog at 896px, portalled into <body>, on the raised paper; the shot's
// glyph, name and code in its title and its status the kit's StatusBadge;
// the task form as the Dialog's first column; a task opened from the sidebar
// its own kit Dialog over it. R3-36: the same fields in the same order in the
// same three grids — Identity, Camera, Schedule — each under the kit's
// SectionTitle at the Label step with a hairline above. The empty cell that
// held the Camera grid open is gone: Camera movement spans the two columns it
// left (its "DOLLY ZOOM — Dolly zoom / vertigo" cut at one). Duration and
// Parent scene, and the folder, are inert: no well, no edge, the second ink,
// never a tab stop. The primary take stands in for an empty thumbnail as
// before, BinPoster at the 142 × 80 it is handed; its "From primary take"
// caption at the Label step (it was 7.5px, R3-07's floor is 11).
// S3b step 7: as the scene popup — `canWrite` read-only fields and greyed
// verbs for a seat that may not write shots; D21's draft question; a
// related asset opens (P1-23); "Files (N)" once (P1-24).
function ShotDetailPopup({ shotId, ctx, takes, fps, projectMembers, roleEntries, thumbRevision, onThumbChanged, onClose, onRequestDelete, canWrite = false }) {
  // S3b step 1: the shot and its scene found among EVERY row (S3a's
  // ctx.shotById / ctx.sceneById), as the scene popup finds its scene.
  const shot = ctx?.shotById?.(shotId) || null
  const scene = shot ? ctx?.sceneById?.(shot.scene_id) || null : null
  const project = ctx?.project
  const managedFiles = ctx?.managedFiles || []

  const [editingDesc, setEditingDesc] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  // R1-06: as the scene popup's (useSavedDraft).
  const [descDraft, setDescDraft] = useSavedDraft(shot?.description || '', editingDesc)
  const [notesDraft, setNotesDraft] = useSavedDraft(shot?.notes || '', editingNotes)
  // Focus back to each one's words when its edit closes (R2-05, as the scene popup's).
  const descWordsRef = useFocusBack(editingDesc)
  const notesWordsRef = useFocusBack(editingNotes)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [nestedTaskId, setNestedTaskId] = useState(null)
  const [nestedAssetId, setNestedAssetId] = useState(null)
  // D21: the draft a question is about, while it asks (the scene popup's).
  const [askDiscard, setAskDiscard] = useState(null)
  // S3c step 7 (S3b-05, S3b-08): the task form's typed work, and the exits
  // that would take this popup away, as the scene popup's.
  const [taskDirty, setTaskDirty] = useState(false)
  const [leaveAsk, setLeaveAsk] = useState(null)
  const dirtyRef = useRef(false)
  useLeaveGuard({ order: 1, reasons: POPUP_EXITS, dirty: () => dirtyRef.current, ask: () => new Promise(resolve => setLeaveAsk({ resolve })) })
  // R1-10, as the scene popup's: the shot gone under an open question.
  useEffect(() => {
    if (!shot && leaveAsk) { leaveAsk.resolve(false); setLeaveAsk(null) }
  }, [shot, leaveAsk])
  // What opened this popup, handed to the delete question (the scene popup's).
  const openerRef = useRef(null)
  if (openerRef.current === null && typeof document !== 'undefined') openerRef.current = document.activeElement

  if (!shot) { dirtyRef.current = false; return null }

  const name = shot.name || 'Untitled shot'
  const status = shot.status || 'not_started'
  const hasThumbnail = !!shot.thumbnail_image

  function handleUpdate(patch) { if (canWrite) ctx?.updateShot?.(shot.id, patch) }
  const dirty = {
    description: editingDesc && descDraft !== (shot.description || ''),
    notes: editingNotes && notesDraft !== (shot.notes || ''),
    task: showCreateTask && taskDirty,
  }
  dirtyRef.current = dirty.description || dirty.notes || dirty.task
  const requestClose = () => {
    if (!dirty.description && !dirty.notes && !dirty.task) return true
    setAskDiscard('close')
    return false
  }
  const discard = (what) => {
    setAskDiscard(null)
    if (what === 'close') { onClose(); return }
    if (what === 'description') { setDescDraft(shot.description || ''); setEditingDesc(false) }
    else { setNotesDraft(shot.notes || ''); setEditingNotes(false) }
  }

  async function handleSetThumbnail() {
    if (!canWrite || !window.electronAPI?.rabbit?.pickImage) return
    const imagePath = await window.electronAPI.rabbit.pickImage()
    if (!imagePath) return
    handleUpdate({ thumbnail_image: imagePath })
    try {
      await window.electronAPI.rabbit.generateEntityThumbnail({ entityType: 'shot', entityId: shot.id, sourcePath: imagePath })
    } catch (e) { console.error('shot thumbnail gen failed:', e) }
    onThumbChanged?.()
  }

  async function handleClearThumbnail() {
    if (!canWrite) return
    handleUpdate({ thumbnail_image: null })
    try { await window.electronAPI.rabbit.clearEntityThumbnail({ entityType: 'shot', entityId: shot.id }) } catch {}
    onThumbChanged?.()
  }

  async function handleCreateTask(draft) {
    if (!canWrite) return
    try {
      await ctx?.addTask?.({ ...draft, shot_id: shot.id, scene_id: shot.scene_id || null })
      setShowCreateTask(false)
    } catch (err) { console.error('Failed to create task:', err) }
  }

  // Build shot code
  const shotCode = shotCodeFor(project, scene?.scene_number ?? 0, shot.shot_number ?? 0)
  const shotSlug = fileSlugify(shot.name || 'Untitled-Shot')
  const shotFolderPath = `SHOTS/${shotSlug}/`
  // Shot takes (milestone 2): the ordered list, and the primary take's poster
  // standing in while the shot has no thumbnail of its own (Q6).
  const shotTakeEntries = takes?.map?.get(shot.id) || []
  const takeFallback = takes?.supports && !hasThumbnail ? primaryOf(shotTakeEntries)?.file : null

  return (
    <>
      {createPortal(
        <Dialog
          width={showCreateTask ? DETAIL_WIDTH + DETAIL_TASK_WIDTH : DETAIL_WIDTH}
          // The app's dark bar, as the scene popup's (R1-12).
          className="rb-scene-detail wilson-dark-scroll"
          aria-label={name}
          title={(
            <span className="rb-scene-detail-title">
              <Clapperboard aria-hidden="true" className="rb-scene-detail-icon" />
              <span className="rb-scene-detail-name">{name}</span>
              <Badge className="rb-scene-detail-code">{shotCode}</Badge>
            </span>
          )}
          subtitle={<StatusBadge status={status} />}
          dismissOnBackdrop
          onBeforeClose={requestClose}
          onClose={onClose}
          footer={(
            <>
              <GatedAction allowed={canWrite} className="rb-scene-detail-delete">
                <Button variant="danger" Icon={Trash2} className="rb-scene-detail-delete"
                  onClick={() => { onClose(); onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled', returnTo: openerRef.current }) }}>
                  Delete shot
                </Button>
              </GatedAction>
              <Button onClick={() => { if (requestClose()) onClose() }}>
                Close
              </Button>
            </>
          )}
        >
          <div className="rb-scene-detail-body">

            {/* The task form: the first column, while it is open */}
            {showCreateTask && (
              <div className="rb-scene-detail-task">
                <NewTaskSidePopup
                  entityType="shot"
                  entityId={shot.id}
                  assets={ctx?.assets || []}
                  phases={ctx?.phases || []}
                  // Every scene and shot, as the scene popup's form (S3b step 1).
                  scenes={ctx?.allScenes || []}
                  shots={ctx?.allShots || []}
                  levels={ctx?.levels || []}
                  experiences={ctx?.experiences || []}
                  projectMembers={projectMembers || []}
                  roleEntries={roleEntries || []}
                  project={project}
                  onConfirm={handleCreateTask}
                  onClose={() => setShowCreateTask(false)}
                  onDirtyChange={setTaskDirty}
                />
              </div>
            )}

            {/* Relations: RelationsPanel's sidebar, the kit Panel */}
            <div className="rb-scene-detail-side">
              <RelationsPanel
                entityType="shot"
                entityId={shot.id}
                assets={ctx?.assets || []}
                tasks={ctx?.tasks || []}
                ctx={ctx}
                onOpenAsset={id => setNestedAssetId(id)}
                onOpenTask={id => setNestedTaskId(id)}
                onCreateTask={canWrite ? () => setShowCreateTask(true) : undefined}
                canWrite={canWrite}
              />
            </div>

            {/* Properties */}
            <div className="rb-scene-detail-main">

              {/* The thumbnail, then the name */}
              <div className="rb-scene-detail-top">
                <div className="rb-scene-detail-thumb ui-hover-host">
                  {hasThumbnail ? (
                    <>
                      <img
                        className="rb-scene-detail-thumb-img"
                        src={`/api/rabbit/projects/${project?.id}/shots/${shot.id}/thumbnail?r=${thumbRevision}`}
                        alt="" />
                      {canWrite && (
                        <HoverActions className="rb-scene-detail-thumb-acts">
                          <IconButton size="sm" Icon={ImagePlus} className="rb-scene-detail-thumb-act" title="Change thumbnail" onClick={handleSetThumbnail} />
                          <IconButton size="sm" Icon={ImageOff} danger className="rb-scene-detail-thumb-act" title="Remove thumbnail" onClick={handleClearThumbnail} />
                        </HoverActions>
                      )}
                    </>
                  ) : !canWrite ? (
                    // A seat that may not write shots: the well's picture
                    // alone — the primary take's poster, or the glyph.
                    takeFallback ? (
                      <>
                        <span className="rb-scene-detail-poster">
                          <BinPoster row={takeFallback} src={takes.thumbUrlFor?.(takeFallback.id)} width={142} height={80} radius={0}
                            className="rb-scene-poster" iconSize={24} />
                        </span>
                        <span className="rb-scene-detail-thumb-take">From primary take</span>
                      </>
                    ) : <Clapperboard aria-hidden="true" className="rb-scene-detail-thumb-glyph" />
                  ) : (
                    <button type="button" onClick={handleSetThumbnail}
                      className="rb-scene-detail-thumb-set"
                      data-take={takeFallback ? 'true' : undefined}
                      title={takeFallback ? 'Showing the primary take. Click to set a thumbnail of your own.' : 'Set thumbnail'}>
                      {/* The primary take's poster fills the well, dimmed on
                          hover under the words (BinPoster at the size it is
                          handed; the well draws the edge, where it was
                          handed `style={{ border: 'none' }}`). */}
                      {takeFallback && (
                        <span className="rb-scene-detail-poster">
                          <BinPoster row={takeFallback} src={takes.thumbUrlFor?.(takeFallback.id)} width={142} height={80} radius={0}
                            className="rb-scene-poster" iconSize={24} />
                        </span>
                      )}
                      <span className="rb-scene-detail-thumb-hint">
                        <ImagePlus aria-hidden="true" className="rb-scene-detail-thumb-hint-icon" />
                        Set thumbnail
                      </span>
                      {!takeFallback && <Clapperboard aria-hidden="true" className="rb-scene-detail-thumb-glyph" />}
                      {takeFallback && <span className="rb-scene-detail-thumb-take">From primary take</span>}
                    </button>
                  )}
                </div>
                <div className="rb-scene-detail-field">
                  <FieldLabel>Shot name</FieldLabel>
                  <PopupInlineText
                    value={shot.name || ''}
                    placeholder="Untitled shot"
                    label="Shot name"
                    readOnly={!canWrite}
                    onCommit={v => handleUpdate({ name: v })}
                  />
                </div>
              </div>

              {/* Identity (R3-36) */}
              <div className="rb-scene-group">
                <SectionTitle as="h3" className="rb-scene-section">Identity</SectionTitle>
                <div className="rb-scene-prop-grid">
                  <div className="rb-scene-prop">
                    <FieldLabel>Status</FieldLabel>
                    <span className="rb-scene-prop-status">
                      <StatusDot status={status} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
                      <select value={status} onChange={e => handleUpdate({ status: e.target.value })}
                        disabled={!canWrite}
                        aria-label="Status"
                        className="ui-input rb-scene-prop-status-input"
                        data-size="sm">
                        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </span>
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>Type</FieldLabel>
                    <select value={shot.type || 'other'} onChange={e => handleUpdate({ type: e.target.value })}
                      disabled={!canWrite}
                      aria-label="Type"
                      className="ui-input rb-scene-prop-select"
                      data-size="sm">
                      {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>Time of day</FieldLabel>
                    <select value={shot.time_of_day || ''} onChange={e => handleUpdate({ time_of_day: e.target.value || null })}
                      disabled={!canWrite}
                      aria-label="Time of day"
                      className="ui-input rb-scene-prop-select"
                      data-size="sm"
                      data-empty={shot.time_of_day ? undefined : 'true'}>
                      <option value="">—</option>
                      {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>Shot number</FieldLabel>
                    <input type="number" value={shot.shot_number ?? ''} onChange={e => {
                      const n = parseInt(e.target.value, 10)
                      if (Number.isFinite(n) && n >= 0) handleUpdate({ shot_number: n })
                    }}
                      disabled={!canWrite}
                      aria-label="Shot number"
                      className="ui-input rb-scene-prop-number"
                      data-size="sm" />
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>Frame count</FieldLabel>
                    <input type="number" min={0} value={shot.frame_count ?? ''} onChange={e => {
                      const n = parseInt(e.target.value, 10)
                      handleUpdate({ frame_count: Number.isFinite(n) && n >= 0 ? n : 0 })
                    }}
                      disabled={!canWrite}
                      aria-label="Frame count"
                      className="ui-input rb-scene-prop-number"
                      data-size="sm"
                      placeholder="0" />
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>Duration</FieldLabel>
                    <span className="rb-scene-prop-inert rb-scene-prop-figure" data-empty={(shot.frame_count || 0) > 0 ? undefined : 'true'}>
                      {framesToTimecode(shot.frame_count || 0, fps)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Camera: framing, then the movement across the two columns
                  the empty placeholder held (R3-36) */}
              <div className="rb-scene-group">
                <SectionTitle as="h3" className="rb-scene-section">Camera</SectionTitle>
                <div className="rb-scene-prop-grid">
                  <div className="rb-scene-prop">
                    <FieldLabel>Framing</FieldLabel>
                    <select value={shot.framing || ''} onChange={e => handleUpdate({ framing: e.target.value || null })}
                      disabled={!canWrite}
                      aria-label="Framing"
                      className="ui-input rb-scene-prop-select"
                      data-size="sm"
                      data-empty={shot.framing ? undefined : 'true'}>
                      <option value="">—</option>
                      {FRAMING_CHOICES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="rb-scene-prop rb-scene-prop-wide">
                    <FieldLabel>Camera movement</FieldLabel>
                    <select value={shot.camera_movement || ''} onChange={e => handleUpdate({ camera_movement: e.target.value || null })}
                      disabled={!canWrite}
                      aria-label="Camera movement"
                      className="ui-input rb-scene-prop-select"
                      data-size="sm"
                      data-empty={shot.camera_movement ? undefined : 'true'}>
                      <option value="">—</option>
                      {CAMERA_MOVEMENT_OPTIONS.map(c => <option key={c.abbr} value={c.abbr}>{c.abbr} — {c.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Schedule: the parent scene, then the two dates (R3-36) */}
              <div className="rb-scene-group">
                <SectionTitle as="h3" className="rb-scene-section">Schedule</SectionTitle>
                <div className="rb-scene-prop-grid">
                  <div className="rb-scene-prop">
                    <FieldLabel>Parent scene</FieldLabel>
                    <span className="rb-scene-prop-inert" data-empty={scene ? undefined : 'true'}>
                      <span className="rb-scene-prop-words">{scene?.name || '—'}</span>
                    </span>
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>Start date</FieldLabel>
                    <input
                      type="date"
                      value={shot.start_date || ''}
                      onChange={e => handleUpdate({ start_date: e.target.value || null })}
                      disabled={!canWrite}
                      aria-label="Start date"
                      className="ui-input rb-scene-date"
                      data-size="sm"
                      data-empty={shot.start_date ? undefined : 'true'}
                    />
                  </div>
                  <div className="rb-scene-prop">
                    <FieldLabel>End date</FieldLabel>
                    <input
                      type="date"
                      value={shot.end_date || ''}
                      onChange={e => handleUpdate({ end_date: e.target.value || null })}
                      disabled={!canWrite}
                      aria-label="End date"
                      className="ui-input rb-scene-date"
                      data-size="sm"
                      data-empty={shot.end_date ? undefined : 'true'}
                    />
                  </div>
                </div>
              </div>

              {/* Description (W2, as the scene popup's; D21) */}
              <div className="rb-scene-detail-text">
                <FieldLabel>Description</FieldLabel>
                <PopupDraftText label="Description" field="description" value={shot.description} emptyWords="Click to add a description..."
                  editing={editingDesc} setEditing={setEditingDesc} draft={descDraft} setDraft={setDescDraft} wordsRef={descWordsRef}
                  onSave={v => handleUpdate({ description: v })} onAskDiscard={() => setAskDiscard('description')} readOnly={!canWrite} />
              </div>

              {/* Notes */}
              <div className="rb-scene-detail-text">
                <FieldLabel>Notes</FieldLabel>
                <PopupDraftText label="Notes" field="notes" value={shot.notes} emptyWords="Click to add notes..."
                  editing={editingNotes} setEditing={setEditingNotes} draft={notesDraft} setDraft={setNotesDraft} wordsRef={notesWordsRef}
                  onSave={v => handleUpdate({ notes: v })} onAskDiscard={() => setAskDiscard('notes')} readOnly={!canWrite} />
              </div>

              {/* The folder: inert (R3-36) */}
              <div className="rb-scene-detail-text">
                <FieldLabel>Folder</FieldLabel>
                <span className="rb-scene-prop-inert">
                  <FolderOpen aria-hidden="true" className="rb-scene-prop-glyph" />
                  <span className="rb-scene-prop-words rb-scene-prop-figure">{shotFolderPath}</span>
                </span>
              </div>

              {/* Takes (milestone 2): the bin files this shot is cut from, in
                  order — ShotTakesPanel, B6's, as it was. A failed load says
                  so on the kit Banner, its dismiss named (it had no name). */}
              {takes?.supports && (
                <div className="rb-scene-detail-text rb-scene-detail-takes">
                  <FieldLabel>{`Takes (${shotTakeEntries.length})`}</FieldLabel>
                  {takes.notice && (
                    <Banner
                      tone="warning"
                      className="rb-scene-detail-notice"
                      action={<IconButton size="sm" Icon={X} title="Dismiss" onClick={takes.clearNotice} />}
                    >
                      {takes.notice}
                    </Banner>
                  )}
                  <ShotTakesPanel shot={shot} entries={shotTakeEntries} fps={fps} canWrite={takes.canWrite} thumbUrlFor={takes.thumbUrlFor} binPathFor={takes.binPathFor} projectId={takes.projectId}
                    onUpdate={takes.onUpdate} onRemove={takes.onRemove} onReorder={takes.onReorder} onUseLength={takes.onUseLength}
                    onOpenPicker={() => takes.openPicker(shot.id)} />
                </div>
              )}

              {/* Files: FileManager's own head says "Files (N)" (P1-24). */}
              <div className="rb-scene-detail-text">
                <FileManager
                  files={managedFiles}
                  shotId={shot.id}
                  shotName={shot.name || 'Untitled-Shot'}
                  projectId={project?.id}
                  project={project}
                  mode="full"
                  onFileAdded={() => ctx?.refreshManagedFiles?.()}
                  onFileDeleted={() => ctx?.refreshManagedFiles?.()}
                  onFileUpdated={() => ctx?.refreshManagedFiles?.()}
                />
              </div>
            </div>
          </div>
        </Dialog>,
        document.body,
      )}

      {/* A task opened from the sidebar: its own kit Dialog, over this one,
          in the wrapper that gives it the app's dark bar (R1-12) */}
      {nestedTaskId && !showCreateTask && createPortal(
        <div className="wilson-dark-scroll">
          <TaskDetailPopup taskId={nestedTaskId} ctx={ctx} onClose={() => setNestedTaskId(null)} />
        </div>,
        document.body,
      )}
      {/* P1-23: a related asset, in the Assets tab's own popup. */}
      <NestedAsset ctx={ctx} assetId={nestedAssetId} thumbRevision={thumbRevision} onThumbChanged={onThumbChanged} onClose={() => setNestedAssetId(null)} canWrite={canWrite} />
      {/* D21: the draft question, over this popup. */}
      {askDiscard && (
        <ListConfirm
          title="Discard your changes?"
          confirmLabel="Discard"
          onCancel={() => setAskDiscard(null)}
          onConfirm={async () => discard(askDiscard)}
        >
          {discardWords(askDiscard, dirty)}
        </ListConfirm>
      )}
      {/* S3c step 7: the same question when an exit would take this popup
          away (S3b-08); Cancel stays, Discard lets the exit go on. */}
      {leaveAsk && (
        <ListConfirm
          title="Discard your changes?"
          confirmLabel="Discard"
          onCancel={() => { setLeaveAsk(null); leaveAsk.resolve(false) }}
          onConfirm={async () => { setLeaveAsk(null); leaveAsk.resolve(true) }}
        >
          {discardWords('close', dirty)}
        </ListConfirm>
      )}
    </>
  )
}


// ─── Confirmation dialog ───
// The kit Dialog at the confirm width (W9), portalled into <body> so no
// container on the page can hold it (the kit Dialog does not portal): the
// same words, Cancel first and focused, Delete the kit's danger button, and
// Escape and the focus trap the kit adds (Q17). A row's delete keeps its
// backdrop click, as the hand-rolled one had; the three bulk deletes that
// were window.confirm pass `dismissOnBackdrop={false}`.
//
// 🚨 Cancel takes focus in an EFFECT, not only by `autoFocus` (surface 6c,
// B4c's lesson). From a detail popup's Delete the popup closes in the same
// commit this opens: `autoFocus` puts focus on Cancel during the commit, the
// popup's unmount hands focus back to what opened IT, and the kit Dialog's
// own effect, finding focus outside, lands it on ✕. This effect runs after
// both — a child's effects run before its parent's — so the question opens on
// Cancel from every path, as it does from a row.
//
// 🚨 …and on close, focus goes back to `returnTo` when a popup asked: what
// opened the popup, the row's "View details". The kit Dialog hands focus to
// what had it when the question opened — the popup's own Delete, gone with
// the popup — so every close from that path dropped focus to <body>. Only
// when focus has fallen there, and only while the opener is in the page (a
// delete takes the row, and its button, with it; StrictMode's rehearsal of an
// unmount leaves focus on Cancel, so that does nothing).
//
// 🚨 …and while one is up, the page's Ctrl+Z / Ctrl+Y stand down (R1-08,
// above). This page's question counts itself in `openQuestions` while it is
// mounted: the tables' bulk questions are their own state, which the page's
// key handler cannot read. Module state, as the kit's modal stack is
// (overlay.js): there is one page and one keyboard.
//
// 🚨 This component is NOT every question on the page (review round two,
// R2-01). The popups host FileManager's "Delete file" and RelationsPanel's
// "Create task", each the kit Dialog at the confirm width in <body>, and
// Ctrl+Z behind them reverted an edit (a status set in the table) while the
// question was up. So the handler also stands down while ANY kit Dialog at
// the confirm width is on screen, whoever opened it: the kit writes the
// width token on its surface (`data-width="confirm"`, Dialog.jsx). A popup
// is the kit Dialog at another width, so the keys still undo there (C1).
const openQuestions = { count: 0 }
function questionOnScreen() {
  return openQuestions.count > 0 || answersOpen.count > 0 || document.querySelector('.ui-dialog[data-width="confirm"]') !== null
}
/** A kit menu ON SCREEN (a row's shot-list menu, the bar's More): a key
    pressed with one open is not an undo (S4a-07; visibleOverlayOpen's
    reasoning — one left open on a hidden page does not count). */
function menuOnScreen() {
  for (const n of document.querySelectorAll('.ui-menu')) {
    if (typeof n.checkVisibility !== 'function' || n.checkVisibility()) return true
  }
  return false
}
function ConfirmDialog({ title, message, onConfirm, onCancel, dismissOnBackdrop = true, returnTo = null }) {
  const cancelRef = useRef(null)
  useEffect(() => {
    openQuestions.count += 1
    cancelRef.current?.focus()
    return () => {
      openQuestions.count -= 1
      const active = document.activeElement
      if (returnTo && returnTo !== document.body && returnTo.isConnected && (!active || active === document.body)) returnTo.focus()
    }
  }, [])
  return createPortal(
    <Dialog
      width="confirm"
      title={title}
      dismissOnBackdrop={dismissOnBackdrop}
      onClose={onCancel}
      footer={(
        <>
          <Button ref={cancelRef} autoFocus onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>Delete</Button>
        </>
      )}
    >
      {message}
    </Dialog>,
    document.body,
  )
}


// ─── Filter panel ───
// The Tasks, Assets, Levels and Budget pages' filter strip (B2, B4b, B4c,
// B5), in this lane's classes, at the page's 24px gutter (R3-31): each field
// a native select or text field in the kit's small well (`ui-input`, not the
// kit Input, whose own Escape and Enter would break a draft), named for what
// it is; each row's remove the kit's danger IconButton, named (it had no
// name); Add filter and Done the kit's Buttons. The same rows, fields,
// operators and order. Done stays on show with no filter, as it always was
// here (C1; the other strips never showed it then). The words in sentence
// case (Q2): a choice humanised from its value (a framing or movement code
// keeps its capitals), and the value field's hint.
function SceneFilterPanel({ filters, filterFields, onAdd, onUpdate, onRemove, onClose }) {
  const fields = filterFields || SCENE_FILTER_FIELDS
  function getOptions(f) {
    const def = fields.find(ff => ff.value === f.field)
    if (!def) return []
    return (def.options || []).map(o => ({ value: o, label: humanizeStatus(o) }))
  }
  function getType(f) {
    return fields.find(ff => ff.value === f.field)?.type || 'text'
  }
  return (
    <div className="rb-scene-filters">
      {filters.map((f, i) => {
        const type = getType(f)
        const ops = FILTER_OPS[type] || FILTER_OPS.text
        const needsValue = !['is_empty','is_not_empty'].includes(f.op)
        return (
          <div key={i} className="rb-scene-filter-row">
            <span className="rb-scene-filter-where text-label uppercase">
              {i === 0 ? 'Where' : 'And'}
            </span>
            <select value={f.field} onChange={e => onUpdate(i, { field: e.target.value, value: '' })}
              aria-label="Field" className="ui-input rb-scene-filter-field" data-size="sm">
              {fields.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select value={f.op} onChange={e => onUpdate(i, { op: e.target.value })}
              aria-label="Condition" className="ui-input rb-scene-filter-op" data-size="sm">
              {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
              type === 'select' ? (
                <select value={f.value} onChange={e => onUpdate(i, { value: e.target.value })}
                  aria-label="Value" className="ui-input rb-scene-tool" data-size="sm">
                  <option value="">Select…</option>
                  {getOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" value={f.value || ''} onChange={e => onUpdate(i, { value: e.target.value })}
                  placeholder="Value…"
                  aria-label="Value"
                  className="ui-input rb-scene-filter-text" data-size="sm" />
              )
            )}
            <IconButton size="sm" Icon={X} danger title="Remove this filter" onClick={() => onRemove(i)} />
          </div>
        )
      })}
      <div className="rb-scene-filter-actions">
        <Button size="sm" Icon={Plus} onClick={onAdd}>Add filter</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
      </div>
    </div>
  )
}


// ─── Saved views dropdown ───
// The Tasks, Assets, Levels and Budget pages' menu (B2's, restyled in place
// on the kit's floating tokens: the kit Menu has no item with a trailing
// action — load a view AND delete it from one row, B2's kit request K2), in
// this lane's classes: a view's row loads it, its delete the kit's danger
// IconButton named for the view (it had no name), Save current view at the
// foot; still 180px at least, the list scrolling past 200px, as it did. The
// same three clicks and no new keys: it still closes on a press outside.
// Its button stays the icon it was, now the kit's IconButton under the name
// it always had, "Saved views": the others' "Views" word would take the
// toolbar to two lines at 1440 in the shots mode (C1). Its glyph takes the
// signal while views are saved, as it took orange (grey when none, #57534e
// at 2.3:1; the kit's second ink now).
function SceneSavedViewsDropdown({ views, onLoad, onDelete, onSaveRequest }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="rb-scene-views">
      <IconButton size="sm" Icon={BookmarkPlus} title="Saved views" aria-expanded={open}
        className="rb-scene-views-button" data-saved={views.length > 0 ? 'true' : 'false'}
        onClick={() => setOpen(o => !o)} />
      {open && (
        <div className="rb-scene-menu">
          <div className="rb-scene-menu-list">
            {views.length === 0 ? (
              <div className="rb-scene-menu-empty">
                No saved views yet
              </div>
            ) : (
              views.map(v => (
                <div key={v.id} className="rb-scene-menu-item"
                  onClick={() => { onLoad(v); setOpen(false) }}>
                  <span className="rb-scene-menu-label">{v.name}</span>
                  <IconButton size="sm" Icon={X} danger title={`Delete the saved view "${v.name}"`}
                    onClick={e => { e.stopPropagation(); onDelete(v.id) }} />
                </div>
              ))
            )}
          </div>
          <div className="rb-scene-menu-foot">
            <button type="button" onClick={() => { onSaveRequest(); setOpen(false) }}
              className="rb-scene-menu-item">
              <Save className="rb-scene-menu-icon" aria-hidden="true" />
              <span className="rb-scene-menu-label">Save current view</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Bulk select ───
// A bulk bar's picker: the kit's small field (B4b's AssetBulkSelect), its
// first option the label it always showed, its choices in sentence case.
function SceneBulkSelect({ label, options, onPick }) {
  return (
    <select defaultValue="" aria-label={label}
      onChange={e => { if (e.target.value) { onPick(e.target.value); e.target.value = '' } }}
      className="ui-input rb-scene-bulk-select"
      data-size="sm">
      <option value="" disabled>{label}</option>
      {options.map(o => <option key={o} value={o}>{humanizeStatus(o)}</option>)}
    </select>
  )
}


// ─── InlineText ───
// A cell's words that become a field on a click, exactly as before. At rest
// the words — `strong` (a row's name) at 600 in the ink, the rest in the
// second ink, `size="xs"` (the scene popup's shot line) in the third, an
// empty one its placeholder in the third (R3-13: it was #57534e, 2.3:1) —
// with the kit's hover fill; editing, the kit's small field, a native
// `ui-input` (the kit Input's own Escape and Enter would break the draft,
// B3d trap 3). `label` names the field for a screen reader. Escape reverts
// the draft and is MARKED handled, as PopupInlineText's is (K4's mark): a
// shot's description in the scene popup is inside the kit Dialog, which
// stands down on a handled Escape, so the first press only reverts (review
// round one, R1-02: it reverted AND closed the popup).
// `title` (S3b, D10): the words' tooltip — a name's lists ("In: …").
// `readOnly` (S3b step 7): a seat that may not write scenes and shots gets
// the words alone — no click, no hover fill, no field (`data-static`); an
// empty one a dash, not an "Add …" it could not do.
function InlineText({ value, placeholder, onCommit, size = 'md', strong = false, label, title, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus() }, [editing])

  if (readOnly) {
    return (
      <span
        className="rb-scene-inline"
        data-static="true"
        data-tone={strong ? 'strong' : size === 'xs' ? 'quiet' : undefined}
        data-empty={value ? undefined : 'true'}
        title={title}
      >
        {value || (strong ? placeholder : '—')}
      </span>
    )
  }
  if (editing) {
    return (
      <input ref={inputRef} type="text" value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onCommit(draft); setEditing(false) }}
        onKeyDown={e => {
          if (e.key === 'Enter') { if (draft !== value) onCommit(draft); setEditing(false) }
          if (e.key === 'Escape') { e.preventDefault(); setDraft(value); setEditing(false) }
        }}
        aria-label={label}
        className="ui-input rb-scene-inline-input"
        data-size="sm"
        onClick={e => e.stopPropagation()}
      />
    )
  }
  return (
    <span
      className="rb-scene-inline"
      data-tone={strong ? 'strong' : size === 'xs' ? 'quiet' : undefined}
      data-empty={value ? undefined : 'true'}
      title={title}
      onClick={e => { e.stopPropagation(); setEditing(true) }}
    >
      {value || placeholder}
    </span>
  )
}


// ─── PopupInlineText ───
// The popups' name field (surface 6c). At rest its words in the kit's small
// well, a button — legible as a field, and a tab stop where it was a span
// only a pointer could open — an empty one's placeholder in the third ink
// (it was #57534e, 2.3:1). On a click the kit's small field takes its place,
// the same size (a native `ui-input`: the kit Input's own Escape and Enter
// would break the draft, B3d trap 3), in the ink where it was orange with an
// orange underline. Enter and blur commit the draft as they did. Escape
// reverts it and is MARKED handled (K4's mark), so the kit Dialog around it
// stands down: the first press reverts the edit, the next closes the popup
// (W2). Closed, it gives focus back to its words (R2-05, useFocusBack).
// `label` names the field. `readOnly` (S3b step 7): the words inert, as a
// value nobody can type is (R3-36) — no well, no tab stop.
function PopupInlineText({ value, placeholder, label, onCommit, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef(null)
  const wordsRef = useFocusBack(editing)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus() }, [editing])

  if (readOnly) {
    return (
      <span className="rb-scene-prop-inert" data-empty={value ? undefined : 'true'}>
        <span className="rb-scene-prop-words">{value || placeholder}</span>
      </span>
    )
  }
  if (editing) {
    return (
      <input ref={inputRef} type="text" value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onCommit(draft); setEditing(false) }}
        onKeyDown={e => {
          if (e.key === 'Enter') { if (draft !== value) onCommit(draft); setEditing(false) }
          if (e.key === 'Escape') { e.preventDefault(); setDraft(value); setEditing(false) }
        }}
        aria-label={label}
        className="ui-input"
        data-size="sm"
      />
    )
  }
  return (
    <button ref={wordsRef} type="button" onClick={() => setEditing(true)}
      className="ui-input rb-scene-name-text"
      data-size="sm"
      data-empty={value ? undefined : 'true'}>
      {value || placeholder}
    </button>
  )
}


// ─── PopupDraftText (S3b step 7) ───
// A popup's description or notes, one editor for the four (it was written
// out four times): the words in the kit's well open its textarea; Save and
// Cancel are the kit's Buttons (W2); focus goes back to the words when it
// closes (R2-05, the popup's useFocusBack ref). The draft is the POPUP's,
// so the popup knows when closing would drop it (D21). Escape in the box:
// unchanged, it closes the editor as before; changed, it asks first
// (`onAskDiscard`; the first press is MARKED handled either way, so the
// Dialog stays — W2). Cancel is the person's own "drop it", and does.
// Read-only (a seat that may not write scenes and shots): the words alone,
// inert, a dash for none.
function PopupDraftText({ label, field, value, emptyWords, editing, setEditing, draft, setDraft, wordsRef, onSave, onAskDiscard, readOnly = false }) {
  const saved = value || ''
  if (readOnly) {
    return (
      <span className="rb-scene-prop-inert" data-empty={value ? undefined : 'true'}>
        {value || '—'}
      </span>
    )
  }
  if (editing) {
    return (
      <>
        <textarea value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            if (draft !== saved) onAskDiscard()
            else setEditing(false)
          }}
          aria-label={label}
          className="ui-input rb-scene-textarea"
          data-field={field === 'notes' ? 'notes' : 'description'}
          autoFocus />
        <div className="rb-scene-edit-acts">
          <Button size="sm" variant="primary" Icon={Save}
            onClick={() => { onSave(draft); setEditing(false) }}>
            Save
          </Button>
          <Button size="sm" variant="ghost"
            onClick={() => { setDraft(saved); setEditing(false) }}>
            Cancel
          </Button>
        </div>
      </>
    )
  }
  return (
    <button ref={wordsRef} type="button" onClick={() => setEditing(true)}
      className="ui-input rb-scene-prop-text"
      data-empty={value ? undefined : 'true'}>
      {value || emptyWords}
    </button>
  )
}

/** D21's words: which draft would go. `what` is 'close', 'description' or 'notes'. */
function discardWords(what, dirty) {
  const parts = what === 'close'
    ? [dirty.description && 'the description', dirty.notes && 'the notes', dirty.task && 'the new task'].filter(Boolean)
    : [what === 'notes' ? 'the notes' : 'the description']
  const list = parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join(' and ')
  // S3c (S3b-05): a task is created, not saved — the way back is to it.
  const back = what === 'close' && dirty.task ? 'go back to it' : 'go back and Save it'
  return `What you typed in ${list} is not saved. Discard it, or ${back}.`
}

// ─── NestedAsset (S3b step 7, P1-23) ───
// A related asset clicked in a popup's sidebar opens the Assets tab's own
// AssetDetailPopup (it portals itself into <body>) over the popup, as a task
// opens TaskDetailPopup — the asset's tasks and phase as the Assets tab
// hands them. Nothing for an id the project no longer holds.
// Post-overhaul S3c (S3b-09's relation pickers): the popup's seat rides
// along, so a reviewer cannot change the asset's relations from here.
function NestedAsset({ ctx, assetId, thumbRevision, onThumbChanged, onClose, canWrite = false }) {
  const asset = assetId ? (ctx?.assets || []).find(a => a.id === assetId) : null
  if (!asset) return null
  return (
    <AssetDetailPopup
      asset={asset}
      tasks={(ctx?.tasks || []).filter(t => t.asset_id === asset.id)}
      phase={(ctx?.phases || []).find(p => p.id === asset.phase_id)}
      ctx={ctx}
      thumbRevision={thumbRevision}
      onThumbChanged={onThumbChanged}
      onClose={onClose}
      canWrite={canWrite}
    />
  )
}


// ─── useFocusBack ───
// An editor in a popup whose words at rest are a control — the name field
// (PopupInlineText) and each popup's description and notes — gives focus
// back to them when its edit closes (review round two, R2-05). The field
// that had focus goes with the edit, and focus fell to <body>: the next Tab
// started again from the popup's first control (Escape in the description,
// then Tab, landed on the popup's Close). Whenever focus has fallen there —
// always after Escape, Enter, Save or Cancel, whose control is the one that
// went; after a blur that commits only then, so a Tab or a click elsewhere
// keeps where it went. Returns the ref for the words' button.
// InlineText (the tables' editor, also in the scene popup's shot list) is
// NOT on it: its words are a span, not a control, and making them one would
// add a Tab stop to every row (C1; recorded for Audrey), so its close there
// still leaves focus on <body>.
/**
 * A popup's draft of one saved text (D21; review round 1, R1-06). The saved
 * words replace the draft while its editor is closed — and while it is open
 * but still holds the words it opened on, so a change from elsewhere (a
 * teammate, a re-read, Ctrl+Z) shows in an editor nobody has typed in,
 * which neither reads as changed nor writes the old words back on Save. A
 * draft someone HAS typed in stays put, and closing the popup still asks.
 * The basis is read before the update is queued: React may run the updater
 * after this effect has moved the ref on.
 */
function useSavedDraft(saved, editing) {
  const [draft, setDraft] = useState(saved)
  const basisRef = useRef(saved)
  useEffect(() => {
    const basis = basisRef.current
    basisRef.current = saved
    setDraft(d => (!editing || d === basis ? saved : d))
  }, [saved, editing])
  return [draft, setDraft]
}

function useFocusBack(editing) {
  const wordsRef = useRef(null)
  const wasEditing = useRef(editing)
  useEffect(() => {
    const closed = wasEditing.current && !editing
    wasEditing.current = editing
    if (!closed) return
    const active = document.activeElement
    if (!active || active === document.body) wordsRef.current?.focus()
  }, [editing])
  return wordsRef
}


// ─── FieldLabel ───
// A property's label: the kit Field's own label class — 11px, 600, capitals
// at the kit's tracking, the second ink (7.85:1 on the Dialog's raised paper,
// where #78716c measured 3.16 on #292524) — a block over its value, as B4c's
// FieldLabel. As before it labels no control by itself: each control carries
// its own name.
function FieldLabel({ children }) {
  return (
    <label className="ui-field-label rb-scene-label">
      {children}
    </label>
  )
}
