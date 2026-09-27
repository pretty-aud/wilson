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
} from 'lucide-react'
// Lane B5b (surface 6a, 2026-09-27): the page's tiles, toolbar and two tables
// on the kit and rabbitScenes.css; surface 6b the two galleries, the filter
// panel and the saved-views menu. The two detail popups are 6c's.
import {
  Table, Th, Td, Row, Toolbar, Tabs, Button, IconButton, CellSelect, Stat, Card,
  StatusDot, StatusBadge, statusMeta, humanizeStatus, EmptyState, HoverActions, Dialog, Badge, Banner,
} from '../../../ui'
import './rabbitScenes.css'
import { useRabbit } from '../state/RabbitProvider'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import { useRateCard } from '../../../components/RateCard/useRateCard'
import FileManager from '../components/FileManager'
import TaskDetailPopup from '../components/TaskDetailPopup'
import RelationsPanel, { NewTaskSidePopup } from '../components/RelationsPanel'
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

// ── Color system ──
function statusColor(status) {
  switch (status) {
    case 'in_progress':    return '#fb923c'
    case 'pending_review': return '#fbbf24'
    case 'needs_revisions': return '#e879f9'
    case 'approved':       return '#4ade80'
    case 'final':          return '#22c55e'
    case 'blocked':        return '#ef4444'
    case 'on_hold':        return '#fcd34d'
    case 'omitted':        return '#57534e'
    default:               return '#a8a29e'  // not_started
  }
}

function fmt(s) { return (s || '').replace(/_/g, ' ') }

// ── Timecode helpers ──
function framesToTimecode(totalFrames, fps) {
  if (!totalFrames || !fps || fps <= 0) return '00:00:00:00'
  const fpsCeil = Math.ceil(fps)
  const f = Math.round(totalFrames)
  const secs = Math.floor(f / fpsCeil)
  const rem = f % fpsCeil
  const hh = Math.floor(secs / 3600)
  const mm = Math.floor((secs % 3600) / 60)
  const ss = secs % 60
  const fDigits = fpsCeil >= 100 ? 3 : 2
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(rem).padStart(fDigits, '0')}`
}

function fmtNumber(n) {
  if (n == null || isNaN(n)) return '0'
  return n.toLocaleString()
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



// ─────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────
export default function ScenesView() {
  const ctx = useRabbit()
  const project = ctx?.project
  const scenes = ctx?.scenes || []
  const shots = ctx?.shots || []
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
  const { canWrite: canWriteProject } = useProjectAccess()
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
  const onNavigate = useCallback((p) => {
    if (p?.shotId) {
      if (!shots.some(s => s.id === p.shotId)) return false
      setDetailShotId(p.shotId); setDetailSceneId(null)
    } else if (p?.sceneId) {
      if (!scenes.some(s => s.id === p.sceneId)) return false
      setDetailSceneId(p.sceneId)
    }
    return true
  }, [shots, scenes])
  useNavigateTarget('scenes', onNavigate, project?.id || null)
  // Ctrl+Z / Ctrl+Y on this tab, the way the Bins tab and the timeline bind
  // them: the provider's history holds every takes mutation (and every
  // scene and shot edit). Never while typing in a field.
  useEffect(() => {
    if (!supportsBins) return
    const h = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); if (e.shiftKey) ctxRef.current?.redo?.(); else ctxRef.current?.undo?.() }
      else if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); ctxRef.current?.redo?.() }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [supportsBins])

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

  const shotsByScene = useMemo(() => {
    const map = {}
    for (const s of shots) {
      const key = s.scene_id || '__unlinked__'
      if (!map[key]) map[key] = []
      map[key].push(s)
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (a.shot_number ?? 0) - (b.shot_number ?? 0))
    }
    return map
  }, [shots])

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
  const nextSceneNumber = useMemo(
    () => nextSceneNumberFor(scenes, project),
    [scenes, project?.scene_start_number],
  )

  const formatSceneCode = useCallback(
    (num) => sceneCodeFor(project, num),
    [project?.project_code, project?.scene_separator, project?.scene_digits],
  )

  const nextShotNumberForScene = useCallback(
    (sceneId) => nextShotNumberFor(shotsByScene[sceneId] || [], project),
    [shotsByScene, project?.scene_start_number],
  )

  const formatShotCode = useCallback(
    (sceneNum, shotNum) => shotCodeFor(project, sceneNum, shotNum),
    [project?.project_code, project?.scene_separator, project?.scene_digits, project?.shot_digits],
  )

  // ── CRUD handlers ──
  const handleNewScene = useCallback(async () => {
    const num = nextSceneNumber
    const name = formatSceneCode(num)
    try {
      await ctx?.addScene({
        name,
        scene_number: num,
        status: 'not_started',
        type: 'interior',
      })
    } catch (err) { console.error('Failed to create scene:', err) }
  }, [ctx, nextSceneNumber, formatSceneCode])

  const handleNewShot = useCallback(async (sceneId) => {
    const scene = scenes.find(s => s.id === sceneId)
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
      })
    } catch (err) { console.error('Failed to create shot:', err) }
  }, [ctx, scenes, nextShotNumberForScene, formatShotCode])

  const handleDeleteScene = useCallback(async (id) => {
    try {
      const childShots = shotsByScene[id] || []
      for (const shot of childShots) {
        await ctx?.deleteShot?.(shot.id)
      }
      await ctx?.deleteScene?.(id)
    } catch (err) { console.error('Failed to delete scene:', err) }
    setConfirmDelete(null)
    if (detailSceneId === id) setDetailSceneId(null)
  }, [ctx, shotsByScene, detailSceneId])

  const handleDeleteShot = useCallback(async (id) => {
    try {
      await ctx?.deleteShot?.(id)
    } catch (err) { console.error('Failed to delete shot:', err) }
    setConfirmDelete(null)
  }, [ctx])

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

    // Group by scene (original behavior)
    if (shotGroupBy === 'scene') {
      const buckets = {}
      for (const sh of sortedShots) {
        const key = sh.scene_id || '__unlinked__'
        if (!buckets[key]) buckets[key] = []
        buckets[key].push(sh)
      }
      for (const key of Object.keys(buckets)) {
        buckets[key].sort((a, b) => (a.shot_number ?? 0) - (b.shot_number ?? 0))
      }
      const keys = Object.keys(buckets).sort((a, b) => {
        const scA = sceneMap[a]; const scB = sceneMap[b]
        return (scA?.scene_number ?? 9999) - (scB?.scene_number ?? 9999)
      })
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
  }, [sortedShots, sceneMap, shotGroupBy])

  const totalFilteredShots = useMemo(() => shotGroups.reduce((n, g) => n + g.shots.length, 0), [shotGroups])

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

  return (
    <div className="rb-scene-page">

      {/* ── Summary tiles (always visible): one kit Stat each (R3-10), as
          the Budget's. Stat has no icon slot, so the four icons are gone. ── */}
      <div className="rb-scene-stats">
        <BigTile label="Total runtime" value={grandTotals.runtime} />
        <BigTile label="Total frames" value={fmtNumber(grandTotals.frames)} />
        <BigTile label="Scenes" value={grandTotals.scenes} />
        <BigTile label="Shots" value={grandTotals.shots} />
      </div>

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
                primary, as its orange fill was; the other is secondary. */}
            <Button size="sm" variant={contentMode === 'scenes' ? 'primary' : 'secondary'} Icon={Plus} onClick={handleNewScene}>
              New scene
            </Button>

            {/* New shot, with its scene picker */}
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
          </>
        )}
      >
        {/* Content mode: the kit Tabs, the one active treatment (R3-18). */}
        <Tabs
          label="Content"
          panelId={CONTENT_PANEL_ID}
          items={[{ id: 'scenes', label: 'Scenes' }, { id: 'shots', label: 'Shots' }]}
          value={contentMode}
          onChange={setContentMode}
        />

        {/* Filter: the signal edge while filters apply (it was orange words) */}
        <Button
          size="sm"
          Icon={Filter}
          className="rb-scene-tool"
          data-active={filters.length > 0 ? 'true' : 'false'}
          aria-expanded={showFilterPanel}
          onClick={() => setShowFilterPanel(!showFilterPanel)}
        >
          Filter{filters.length > 0 ? ` (${filters.length})` : ''}
        </Button>

        <span className="rb-scene-divider" aria-hidden="true" />

        {/* Sort, and its direction */}
        <span className="rb-scene-tool-group">
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            aria-label="Sort"
            className="ui-input rb-scene-tool"
            data-size="sm"
            data-active={sortField ? 'true' : 'false'}>
            <option value="">Sort…</option>
            {(contentMode === 'shots' ? SHOT_SORTABLE_FIELDS : SORTABLE_FIELDS).map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <IconButton
            size="sm"
            Icon={ArrowUpDown}
            title={sortDir === 'asc' ? 'Sorted ascending — reverse' : 'Sorted descending — reverse'}
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          />
        </span>

        <span className="rb-scene-divider" aria-hidden="true" />

        {/* Group */}
        {contentMode === 'scenes' ? (
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)}
            aria-label="Group"
            className="ui-input rb-scene-tool"
            data-size="sm"
            data-active={groupBy ? 'true' : 'false'}>
            {GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        ) : (
          <select value={shotGroupBy} onChange={e => setShotGroupBy(e.target.value)}
            aria-label="Group"
            className="ui-input rb-scene-tool"
            data-size="sm"
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
            { id: 'table', label: <><TableIcon className="rb-scene-tab-icon" aria-hidden="true" />Table</> },
            { id: 'gallery', label: <><LayoutGrid className="rb-scene-tab-icon" aria-hidden="true" />Gallery</> },
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

        {/* Count: a figure in the third ink (it was #57534e, 2.3:1) */}
        <span className="rb-scene-count">
          {contentMode === 'scenes'
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
        {contentMode === 'shots' ? (
          viewMode === 'table' ? (
            <ShotTable
              shotGroups={shotGroups}
              ctx={ctx}
              takes={takesApi}
              fps={fps}
              thumbSize={thumbSize}
              thumbRevision={thumbRevision}
              onThumbChanged={() => setThumbRevision(r => r + 1)}
              onOpenSceneDetail={setDetailSceneId}
              onOpenShotDetail={setDetailShotId}
              onNewShot={handleNewShot}
              onRequestDelete={setConfirmDelete}
            />
          ) : (
            <ShotGallery
              shotGroups={shotGroups}
              gallerySize={gallerySize}
              fps={fps}
              ctx={ctx}
              takes={takesApi}
              thumbRevision={thumbRevision}
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
                      onOpenDetail={setDetailSceneId}
                      onOpenShotDetail={setDetailShotId}
                      onNewShot={handleNewShot}
                      onRequestDelete={setConfirmDelete}
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
                ctx={ctx}
                onOpenDetail={setDetailSceneId}
                onOpenShotDetail={setDetailShotId}
                onNewShot={handleNewShot}
                onRequestDelete={setConfirmDelete}
              />
            )
          ) : (
            <SceneGallery
              scenes={groups ? groups.flatMap(g => g.scenes) : sorted}
              shotsByScene={shotsByScene}
              sceneTotals={sceneTotals}
              gallerySize={gallerySize}
              fps={fps}
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
          sceneId={detailSceneId}
          ctx={ctx}
          fps={fps}
          shotsByScene={shotsByScene}
          sceneTotals={sceneTotals}
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
          shotId={detailShotId}
          ctx={ctx}
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

      {/* ── Shot takes: the dialog from a row, and the picker (milestone 2) ── */}
      {takesShotId && (() => {
        const shot = shots.find(s => s.id === takesShotId)
        if (!shot) return null
        return (
          <ShotTakesDialog shot={shot} scene={sceneMap[shot.scene_id] || null} onClose={() => { setTakesShotId(null); setTakesNotice(null) }}
            entries={takesByShotMap.get(shot.id) || []} fps={fps} canWrite={takesApi.canWrite} thumbUrlFor={takeThumbUrlFor} binPathFor={binPathFor} projectId={project?.id || null}
            onUpdate={handleUpdateTake} onRemove={handleRemoveTakes} onReorder={handleReorderTakes} onUseLength={handleUseTakeLength}
            onOpenPicker={() => setPickerShotId(shot.id)}>
            {takesNotice && <div className="rb-scene-takes-notice">{takesNotice}</div>}
          </ShotTakesDialog>
        )
      })()}
      {pickerShotId && (() => {
        const shot = shots.find(s => s.id === pickerShotId)
        if (!shot) return null
        const entries = takesByShotMap.get(shot.id) || []
        return (
          <TakePickerDialog shot={shot} scene={sceneMap[shot.scene_id] || null} files={binFiles} bins={bins}
            assignedFileIds={entries.map(e => e.file.id)} hasPrimary={entries.some(e => e.take.role === 'primary')} thumbUrlFor={takeThumbUrlFor} busy={takesBusy}
            onConfirm={(fileIds, role) => handleAssignTakes(shot.id, fileIds, role)} onCancel={() => !takesBusy && setPickerShotId(null)} />
        )
      })()}

      {/* ── Delete confirmation ── */}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.type}?`}
          message={
            confirmDelete.type === 'scene'
              ? `This will permanently delete "${confirmDelete.name}" and all its shots.`
              : `This will permanently delete shot "${confirmDelete.name}".`
          }
          onConfirm={() => {
            if (confirmDelete.type === 'scene') handleDeleteScene(confirmDelete.id)
            else handleDeleteShot(confirmDelete.id)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}


// ─── BigTile — summary card ───
// The kit Stat (R3-10), on the Budget's tile look: the Label-step name over
// the tabular value, on the raised paper with one hairline. No caller ever
// passed a tone, and Stat has no icon slot, so both are gone.
function BigTile({ label, value }) {
  return <Stat className="rb-scene-stat" label={label} value={value} />
}


// ─── Scene table ───
// The kit Table (R3-20): a real <table>, the same columns in the same order,
// the header one row of the kit's Th. A scene's shots stay nested under it —
// one row that spans the table and holds a table of the shots, indented as
// before, opened and closed by the same toggle. Widths are the sheet's
// (`.rb-scene-table-wrap`), each column's thumbnail box its size's.
function SceneTable({ scenes, shotsByScene, sceneTotals, assetCountByScene, taskCountByScene, fps, thumbSize, thumbRevision = 0, onThumbChanged, ctx, takes, onOpenDetail, onOpenShotDetail, onNewShot, onRequestDelete }) {
  const rowH = THUMB_SIZES[thumbSize]?.h || BASE_ROW_H
  const [expandedScenes, setExpandedScenes] = useState(new Set())
  // W9: the two bulk deletes ask on the kit Dialog ('scenes' | 'shots'); each
  // was a window.confirm, and each question keeps its words.
  const [confirmBulk, setConfirmBulk] = useState(null)

  // ── Nested-shot multi-select ──
  const [selectedNestedShots, setSelectedNestedShots] = useState(new Set())
  function toggleNestedShot(id) { setSelectedNestedShots(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  function clearNestedSelection() { setSelectedNestedShots(new Set()) }
  function bulkUpdateNestedShots(patch) { for (const id of selectedNestedShots) ctx?.updateShot?.(id, patch); clearNestedSelection() }
  function bulkDeleteNestedShots() {
    for (const id of selectedNestedShots) ctx?.deleteShot?.(id)
    clearNestedSelection()
  }

  // ── Scene multi-select ──
  const [selected, setSelected] = useState(new Set())
  const allIds = useMemo(() => scenes.map(s => s.id), [scenes])
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id))
  const someSelected = selected.size > 0

  function toggleOne(id) { setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  function toggleAll() { allSelected ? setSelected(new Set()) : setSelected(new Set(allIds)) }
  function clearSelection() { setSelected(new Set()) }
  function bulkUpdate(patch) { for (const id of selected) ctx?.updateScene?.(id, patch); clearSelection() }
  function bulkDelete() {
    for (const id of selected) {
      const childShots = shotsByScene[id] || []
      for (const shot of childShots) ctx?.deleteShot?.(shot.id)
      ctx?.deleteScene?.(id)
    }
    clearSelection()
  }

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
          <SceneBulkSelect label="Status" options={SCENE_STATUSES} onPick={v => bulkUpdate({ status: v })} />
          <SceneBulkSelect label="Type" options={SCENE_TYPES} onPick={v => bulkUpdate({ type: v })} />
          <span className="rb-scene-divider" aria-hidden="true" />
          <Button size="sm" variant="danger" Icon={Trash2} onClick={() => setConfirmBulk('scenes')}>
            Delete
          </Button>
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
          return (
            <Fragment key={sc.id}>
              {/* The kit Row: its one selected treatment (R3-38 — it was an
                  orange tint AND a full orange border), the lane's hover. */}
              <Row className="rb-scene-row" selected={isChecked} data-ticked={isChecked ? 'true' : 'false'}>
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
                  <div className="rb-scene-thumb"
                    onClick={async e => {
                      e.stopPropagation()
                      if (!window.electronAPI?.rabbit?.pickImage) return
                      const imagePath = await window.electronAPI.rabbit.pickImage()
                      if (!imagePath) return
                      ctx?.updateScene?.(sc.id, { thumbnail_image: imagePath })
                      try { await window.electronAPI.rabbit.generateEntityThumbnail({ entityType: 'scene', entityId: sc.id, sourcePath: imagePath }) } catch {}
                      onThumbChanged?.()
                    }}>
                    {sc.thumbnail_image ? (
                      <>
                        <img className="rb-scene-thumb-img" src={`/api/rabbit/projects/${ctx?.project?.id}/scenes/${sc.id}/thumbnail?r=${thumbRevision}`} alt="" />
                        <span className="rb-scene-thumb-over"><ImagePlus aria-hidden="true" /></span>
                      </>
                    ) : (
                      <>
                        <Film className="rb-scene-thumb-mark" aria-hidden="true" />
                        <ImagePlus className="rb-scene-thumb-add" aria-hidden="true" />
                      </>
                    )}
                  </div>
                </Td>

                {/* Scene # */}
                <Td numeric className="rb-scene-num-cell" data-empty={sc.scene_number == null ? 'true' : undefined}>
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
                    aria-label={`Time of day for ${name}`}
                  />
                </Td>

                {/* Type */}
                <Td className="rb-scene-type-cell" onClick={e => e.stopPropagation()}>
                  <CellSelect
                    value={sc.type || 'interior'}
                    onChange={v => ctx?.updateScene?.(sc.id, { type: v })}
                    options={TYPE_OPTIONS}
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
                    <IconButton size="sm" Icon={Trash2} danger title="Delete scene"
                      onClick={e => { e.stopPropagation(); onRequestDelete({ type: 'scene', id: sc.id, name: sc.name || 'Untitled' }) }} />
                  </HoverActions>
                </Td>
              </Row>

              {/* Nested shots: one row across the table, indented as before,
                  holding the scene's shots as a table of their own (no
                  header, as before) on the recessed paper they sat on. */}
              {expanded && (
                <Row className="rb-scene-nest-row">
                  <Td colSpan={12} className="rb-scene-nest-cell">
                    <div className="rb-scene-nest">
                      {/* Nested-shot bulk action bar */}
                      {(() => {
                        const selInScene = sceneShots.filter(s => selectedNestedShots.has(s.id))
                        if (selInScene.length === 0) return null
                        return (
                          <div className="rb-scene-nest-bulk">
                            <span className="rb-scene-bulk-count">{selInScene.length} selected</span>
                            <SceneBulkSelect label="Status" options={SCENE_STATUSES} onPick={v => bulkUpdateNestedShots({ status: v })} />
                            <SceneBulkSelect label="Type" options={SCENE_TYPES} onPick={v => bulkUpdateNestedShots({ type: v })} />
                            <SceneBulkSelect label="Time of day" options={TIME_OF_DAY_OPTIONS} onPick={v => bulkUpdateNestedShots({ time_of_day: v })} />
                            <Button size="sm" variant="danger" Icon={Trash2} className="rb-scene-nest-delete" onClick={() => setConfirmBulk('shots')}>
                              Delete
                            </Button>
                            <IconButton size="sm" Icon={X} title="Clear the selection" onClick={clearNestedSelection} />
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
                            return (
                              <Row key={shot.id} className="rb-scene-row" selected={isNested} data-ticked={isNested ? 'true' : 'false'}>
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
                                  <div className="rb-scene-thumb" data-nested="true"
                                    onClick={async e => {
                                      e.stopPropagation()
                                      if (!window.electronAPI?.rabbit?.pickImage) return
                                      const imagePath = await window.electronAPI.rabbit.pickImage()
                                      if (!imagePath) return
                                      ctx?.updateShot?.(shot.id, { thumbnail_image: imagePath })
                                      try { await window.electronAPI.rabbit.generateEntityThumbnail({ entityType: 'shot', entityId: shot.id, sourcePath: imagePath }) } catch {}
                                      onThumbChanged?.()
                                    }}>
                                    {shot.thumbnail_image ? (
                                      <>
                                        <img className="rb-scene-thumb-img" src={`/api/rabbit/projects/${ctx?.project?.id}/shots/${shot.id}/thumbnail?r=${thumbRevision}`} alt="" />
                                        <span className="rb-scene-thumb-over"><ImagePlus aria-hidden="true" /></span>
                                      </>
                                    ) : takeFallback ? (
                                      <>
                                        {/* The primary take's poster stands in for an empty thumbnail (Q6); clicking still picks an image of her own. */}
                                        <BinPoster row={takeFallback} src={takes.thumbUrlFor?.(takeFallback.id)} width={thumbW(nestedThumbH)} height={nestedThumbH} radius={0} className="rb-scene-poster" />
                                        <span className="rb-scene-thumb-over" title="From the primary take. Click to set a thumbnail of your own."><ImagePlus aria-hidden="true" /></span>
                                      </>
                                    ) : (
                                      <>
                                        <Clapperboard className="rb-scene-thumb-mark" aria-hidden="true" />
                                        <ImagePlus className="rb-scene-thumb-add" aria-hidden="true" />
                                      </>
                                    )}
                                  </div>
                                </Td>
                                {/* Shot # */}
                                <Td numeric className="rb-scene-num-cell" data-empty={shot.shot_number == null ? 'true' : undefined}>
                                  {shot.shot_number ?? '—'}
                                </Td>
                                {/* Name */}
                                <Td className="rb-scene-name-cell">
                                  <InlineText value={shot.name || ''} placeholder="Untitled shot" size="sm" strong
                                    label={`Name for ${shotName}`}
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
                                      aria-label={`Status for ${shotName}`}
                                    />
                                  </span>
                                </Td>
                                {/* Time of day */}
                                <Td className="rb-scene-time-cell">
                                  <CellSelect value={shot.time_of_day || null} onChange={v => ctx?.updateShot?.(shot.id, { time_of_day: v })}
                                    placeholder="—" options={TIME_OPTIONS} aria-label={`Time of day for ${shotName}`} />
                                </Td>
                                {/* Type */}
                                <Td className="rb-scene-type-cell">
                                  <CellSelect value={shot.type || 'other'} onChange={v => ctx?.updateShot?.(shot.id, { type: v })}
                                    options={TYPE_OPTIONS} aria-label={`Type for ${shotName}`} />
                                </Td>
                                {/* Framing: the code in the cell, the long names in the list */}
                                <Td className="rb-scene-framing-cell">
                                  <span className="rb-scene-framing">
                                    <span className="rb-scene-framing-code" data-empty={shot.framing ? undefined : 'true'} aria-hidden="true">{shot.framing || '—'}</span>
                                    <CellSelect className="rb-scene-framing-select" value={shot.framing || null} onChange={v => ctx?.updateShot?.(shot.id, { framing: v })}
                                      placeholder="—" options={FRAMING_CHOICES} aria-label={`Framing for ${shotName}`} />
                                  </span>
                                </Td>
                                {/* Camera movement */}
                                <Td className="rb-scene-move-cell">
                                  <CellSelect value={shot.camera_movement || null} onChange={v => ctx?.updateShot?.(shot.id, { camera_movement: v })}
                                    placeholder="—" options={MOVE_CHOICES} aria-label={`Camera movement for ${shotName}`} />
                                </Td>
                                {/* Description */}
                                <Td className="rb-scene-desc-cell">
                                  <InlineText value={shot.description || ''} placeholder="Add description…" size="sm"
                                    label={`Description for ${shotName}`}
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
                                    aria-label={`Frames for ${shotName}`}
                                    className="ui-input rb-scene-frames"
                                    data-size="sm"
                                    placeholder="0" />
                                </Td>
                                <Td align="right" className="rb-scene-acts-cell">
                                  <HoverActions className="rb-scene-acts">
                                    <IconButton size="sm" Icon={Eye} title="View details" onClick={() => onOpenShotDetail(shot.id)} />
                                    <IconButton size="sm" Icon={Trash2} danger title="Delete shot"
                                      onClick={() => onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' })} />
                                  </HoverActions>
                                </Td>
                              </Row>
                            )
                          })}
                        </Table>
                      )}
                      {/* Add shot row */}
                      <button type="button" onClick={() => onNewShot(sc.id)} className="rb-scene-add">
                        <Plus aria-hidden="true" /> Add shot
                      </button>
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
          message={`Delete ${selected.size} scene${selected.size === 1 ? '' : 's'} and their shots?`}
          dismissOnBackdrop={false}
          onCancel={() => setConfirmBulk(null)}
          onConfirm={() => { setConfirmBulk(null); bulkDelete() }}
        />
      )}
      {confirmBulk === 'shots' && (
        <ConfirmDialog
          title="Delete shots"
          message={`Delete ${selectedNestedShots.size} shot${selectedNestedShots.size === 1 ? '' : 's'}?`}
          dismissOnBackdrop={false}
          onCancel={() => setConfirmBulk(null)}
          onConfirm={() => { setConfirmBulk(null); bulkDeleteNestedShots() }}
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
function SceneGallery({ scenes, shotsByScene, sceneTotals, gallerySize, fps, onOpenDetail, onRequestDelete }) {
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
                  <IconButton size="sm" Icon={Trash2} danger title={`Delete ${name}`} className="rb-scene-card-delete"
                    onClick={e => { e.stopPropagation(); onRequestDelete({ type: 'scene', id: sc.id, name }) }} />
                </HoverActions>
              </div>
              <div className="rb-scene-card-body">
                <span className="rb-scene-card-name">
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
function ShotTable({ shotGroups, ctx, takes, fps, thumbSize, thumbRevision = 0, onThumbChanged, onOpenSceneDetail, onOpenShotDetail, onNewShot, onRequestDelete }) {
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
  function bulkUpdate(patch) { for (const id of selected) ctx?.updateShot?.(id, patch); clearSelection() }
  function bulkDelete() {
    for (const id of selected) ctx?.deleteShot?.(id)
    clearSelection()
  }

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
          <SceneBulkSelect label="Status" options={SCENE_STATUSES} onPick={v => bulkUpdate({ status: v })} />
          <SceneBulkSelect label="Type" options={SCENE_TYPES} onPick={v => bulkUpdate({ type: v })} />
          <SceneBulkSelect label="Time of day" options={TIME_OF_DAY_OPTIONS} onPick={v => bulkUpdate({ time_of_day: v })} />
          <span className="rb-scene-divider" aria-hidden="true" />
          <Button size="sm" variant="danger" Icon={Trash2} onClick={() => setConfirmBulk(true)}>
            Delete
          </Button>
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
          return (
            <Fragment key={g.key}>
              {/* A group's band (none for ungrouped): one row across the
                  table on the raised paper. Its toggle is a button now (it
                  was a clickable div), and Scene details sits BESIDE it, not
                  inside it. A scene's status is the kit's StatusDot (the 3px
                  accent in its colour is gone, R3-11); names in the ink. */}
              {isGrouped && (
                <Row className="rb-scene-group-row">
                  <Td colSpan={span} className="rb-scene-group-cell">
                    <span className="rb-scene-group-head">
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
                return (
                  <Row key={shot.id} className="rb-scene-row" selected={isChecked} data-ticked={isChecked ? 'true' : 'false'}>
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
                      <div className="rb-scene-thumb"
                        onClick={async e => {
                          e.stopPropagation()
                          if (!window.electronAPI?.rabbit?.pickImage) return
                          const imagePath = await window.electronAPI.rabbit.pickImage()
                          if (!imagePath) return
                          ctx?.updateShot?.(shot.id, { thumbnail_image: imagePath })
                          try { await window.electronAPI.rabbit.generateEntityThumbnail({ entityType: 'shot', entityId: shot.id, sourcePath: imagePath }) } catch {}
                          onThumbChanged?.()
                        }}>
                        {shot.thumbnail_image ? (
                          <>
                            <img className="rb-scene-thumb-img" src={`/api/rabbit/projects/${ctx?.project?.id}/shots/${shot.id}/thumbnail?r=${thumbRevision}`} alt="" />
                            <span className="rb-scene-thumb-over"><ImagePlus aria-hidden="true" /></span>
                          </>
                        ) : takeFallback ? (
                          <>
                            {/* The primary take's poster stands in for an empty thumbnail (Q6); clicking still picks an image of her own. */}
                            <BinPoster row={takeFallback} src={takes.thumbUrlFor?.(takeFallback.id)} width={tw} height={rowH} radius={0} className="rb-scene-poster" />
                            <span className="rb-scene-thumb-over" title="From the primary take. Click to set a thumbnail of your own."><ImagePlus aria-hidden="true" /></span>
                          </>
                        ) : (
                          <>
                            <Clapperboard className="rb-scene-thumb-mark" aria-hidden="true" />
                            <ImagePlus className="rb-scene-thumb-add" aria-hidden="true" />
                          </>
                        )}
                      </div>
                    </Td>

                    {/* Shot # */}
                    <Td numeric className="rb-scene-num-cell" data-empty={shot.shot_number == null ? 'true' : undefined}>
                      {shot.shot_number ?? '—'}
                    </Td>

                    {/* Name: the row's anchor, 600 in the ink */}
                    <Td className="rb-scene-name-cell">
                      <InlineText
                        value={shot.name || ''}
                        placeholder="Untitled shot"
                        strong
                        label={`Name for ${shotName}`}
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
                        aria-label={`Time of day for ${shotName}`}
                      />
                    </Td>

                    {/* Type */}
                    <Td className="rb-scene-type-cell">
                      <CellSelect
                        value={shot.type || 'other'}
                        onChange={v => ctx?.updateShot?.(shot.id, { type: v })}
                        options={TYPE_OPTIONS}
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
                        <IconButton size="sm" Icon={Trash2} danger title="Delete shot"
                          onClick={() => onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' })} />
                      </HoverActions>
                    </Td>
                  </Row>
                )
              })}

              {/* Add shot row */}
              {!collapsed && g.scene && (
                <Row>
                  <Td colSpan={span} className="rb-scene-add-cell">
                    <button type="button" onClick={() => onNewShot(g.sceneId)} className="rb-scene-add">
                      <Plus aria-hidden="true" /> Add shot
                    </button>
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
          message={`Delete ${selected.size} shot${selected.size === 1 ? '' : 's'}?`}
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
function ShotGallery({ shotGroups, gallerySize, fps, ctx, takes, thumbRevision = 0, onOpenSceneDetail, onOpenShotDetail, onRequestDelete }) {
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
                      <IconButton size="sm" Icon={Trash2} danger title={`Delete ${name}`} className="rb-scene-card-delete"
                        onClick={e => { e.stopPropagation(); onRequestDelete({ type: 'shot', id: shot.id, name }) }} />
                    </HoverActions>
                  </div>
                  {/* Info */}
                  <div className="rb-scene-card-body">
                    <span className="rb-scene-card-name">
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
function SceneDetailPopup({ sceneId, ctx, fps, shotsByScene, sceneTotals, assetCountByScene, taskCountByScene, projectMembers, roleEntries, thumbRevision, onThumbChanged, onNewShot, onClose, onRequestDelete, onOpenShot }) {
  const scene = (ctx?.scenes || []).find(s => s.id === sceneId)
  const sceneShots = shotsByScene[sceneId] || []
  const totals = sceneTotals[sceneId] || { totalFrames: 0, runtime: '00:00:00:00' }
  const project = ctx?.project
  const managedFiles = ctx?.managedFiles || []

  const [descDraft, setDescDraft] = useState(scene?.description || '')
  const [notesDraft, setNotesDraft] = useState(scene?.notes || '')
  const [editingDesc, setEditingDesc] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [nestedTaskId, setNestedTaskId] = useState(null)
  const [nestedAssetId, setNestedAssetId] = useState(null)

  useEffect(() => { setDescDraft(scene?.description || '') }, [scene?.description])
  useEffect(() => { setNotesDraft(scene?.notes || '') }, [scene?.notes])

  if (!scene) return null

  const sc = statusColor(scene.status)
  const hasThumbnail = !!scene.thumbnail_image

  function handleUpdate(patch) { ctx?.updateScene?.(scene.id, patch) }

  async function handleSetThumbnail() {
    if (!window.electronAPI?.rabbit?.pickImage) return
    const imagePath = await window.electronAPI.rabbit.pickImage()
    if (!imagePath) return
    handleUpdate({ thumbnail_image: imagePath })
    try {
      await window.electronAPI.rabbit.generateEntityThumbnail({ entityType: 'scene', entityId: scene.id, sourcePath: imagePath })
    } catch (e) { console.error('scene thumbnail gen failed:', e) }
    onThumbChanged?.()
  }

  async function handleClearThumbnail() {
    handleUpdate({ thumbnail_image: null })
    try { await window.electronAPI.rabbit.clearEntityThumbnail({ entityType: 'scene', entityId: scene.id }) } catch {}
    onThumbChanged?.()
  }

  async function handleCreateTask(draft) {
    try {
      await ctx?.addTask?.({ ...draft, scene_id: scene.id })
      setShowCreateTask(false)
    } catch (err) { console.error('Failed to create task:', err) }
  }

  const sceneCode = sceneCodeFor(project, scene.scene_number ?? 0)
  const sceneSlug = fileSlugify(scene.name || 'Untitled-Scene')
  const sceneFolderPath = `SCENES/${sceneSlug}/`
  const fileCount = managedFiles.filter(f => f.scene_id === scene.id && !f.deleted_at).length

  // Show side panel?
  const hasLeftSide = showCreateTask || nestedTaskId || nestedAssetId

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      <div className="fixed z-50 inset-0 flex items-center justify-center gap-3 pointer-events-none">

        {/* ── LEFT SIDE POPUP (task creation / nested detail) ── */}
        {showCreateTask && (
          <div className="pointer-events-auto flex-shrink-0 max-h-[85vh]">
            <NewTaskSidePopup
              entityType="scene"
              entityId={scene.id}
              assets={ctx?.assets || []}
              phases={ctx?.phases || []}
              scenes={ctx?.scenes || []}
              shots={ctx?.shots || []}
              levels={ctx?.levels || []}
              experiences={ctx?.experiences || []}
              projectMembers={projectMembers || []}
              roleEntries={roleEntries || []}
              project={project}
              onConfirm={handleCreateTask}
              onClose={() => setShowCreateTask(false)}
            />
          </div>
        )}

        {nestedTaskId && !showCreateTask && (
          <div className="pointer-events-auto flex-shrink-0 max-h-[85vh] overflow-auto">
            <TaskDetailPopup taskId={nestedTaskId} ctx={ctx} onClose={() => setNestedTaskId(null)} />
          </div>
        )}

        {/* ── MAIN POPUP ── */}
        <div
          className="pointer-events-auto w-full max-w-4xl rounded-control overflow-hidden flex flex-col"
          style={{
            backgroundColor: '#292524',
            border: '2px solid #f97316',
            maxHeight: '85vh',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}
          onClick={e => e.stopPropagation()}
        >
        {/* Header — spans full width */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `3px solid ${sc}` }}>
          <div className="flex items-center gap-2.5">
            <Film className="w-4 h-4" style={{ color: '#fb923c' }} />
            <span className="text-h3 font-semibold" style={{ color: '#fb923c' }}>
              {scene.name || 'Untitled scene'}
            </span>
            <span className="text-label font-mono uppercase px-1.5 py-0.5 rounded-control"
              style={{ color: '#78716c', backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              {sceneCode}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded-control transition-colors" style={{ color: '#a8a29e' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-column body */}
        <div className="flex-1 overflow-auto flex">

          {/* LEFT COLUMN — Relations */}
          <RelationsPanel
            entityType="scene"
            entityId={scene.id}
            assets={ctx?.assets || []}
            tasks={ctx?.tasks || []}
            ctx={ctx}
            onOpenAsset={id => setNestedAssetId(id)}
            onOpenTask={id => setNestedTaskId(id)}
            onCreateTask={() => setShowCreateTask(true)}
          />

          {/* RIGHT COLUMN — Properties */}
          <div className="flex-1 overflow-auto px-5 py-4 min-w-0">

          {/* Thumbnail + Title */}
          <div className="flex items-start gap-4 mb-5">
            <div className="relative flex-shrink-0 rounded-control overflow-hidden flex items-center justify-center group/thumb"
              style={{ width: 142, height: 80, backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              {hasThumbnail ? (
                <>
                  <img
                    src={`/api/rabbit/projects/${project?.id}/scenes/${scene.id}/thumbnail?r=${thumbRevision}`}
                    alt="" style={{ width: 142, height: 80, objectFit: 'cover', display: 'block' }} />
                  <div className="absolute inset-0 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center gap-1"
                    style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
                    <button type="button" onClick={handleSetThumbnail}
                      className="p-1.5 rounded-control hover:bg-stone-700 transition-colors" style={{ color: '#d6d3d1' }}
                      title="Change thumbnail"><ImagePlus className="w-4 h-4" /></button>
                    <button type="button" onClick={handleClearThumbnail}
                      className="p-1.5 rounded-control hover:bg-stone-700 transition-colors" style={{ color: '#fca5a5' }}
                      title="Remove thumbnail"><ImageOff className="w-4 h-4" /></button>
                  </div>
                </>
              ) : (
                <button type="button" onClick={handleSetThumbnail}
                  className="w-full h-full flex items-center justify-center hover:bg-stone-800 transition-colors"
                  style={{ color: '#57534e' }} title="Set thumbnail">
                  <div className="flex flex-col items-center gap-1 opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                    <ImagePlus className="w-4 h-4" />
                    <span className="text-label uppercase">Set thumbnail</span>
                  </div>
                  <Film className="w-5 h-5 group-hover/thumb:opacity-0 transition-opacity absolute" style={{ color: '#292524' }} />
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <FieldLabel>Scene name</FieldLabel>
              <PopupInlineText
                value={scene.name || ''}
                placeholder="Untitled scene"
                onCommit={v => handleUpdate({ name: v })}
              />
            </div>
          </div>

          {/* Properties grid */}
          <div className="grid grid-cols-3 gap-x-4 gap-y-4 mb-5">
            <div>
              <FieldLabel>Status</FieldLabel>
              <select value={scene.status || 'not_started'} onChange={e => handleUpdate({ status: e.target.value })}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: sc, border: '1px solid #44403c' }}>
                {SCENE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Type</FieldLabel>
              <select value={scene.type || 'interior'} onChange={e => handleUpdate({ type: e.target.value })}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}>
                {SCENE_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Time of Day</FieldLabel>
              <select value={scene.time_of_day || ''} onChange={e => handleUpdate({ time_of_day: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: scene.time_of_day ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
                <option value="">—</option>
                {TIME_OF_DAY_OPTIONS.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Scene number</FieldLabel>
              <input type="number" value={scene.scene_number ?? ''} onChange={e => {
                const n = parseInt(e.target.value, 10)
                if (Number.isFinite(n) && n >= 0) handleUpdate({ scene_number: n })
              }}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }} />
            </div>
            <div>
              <FieldLabel>Runtime</FieldLabel>
              <div className="px-2.5 py-1.5 text-dense font-mono tabular-nums rounded-control"
                style={{ backgroundColor: '#1c1917', color: totals.totalFrames > 0 ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
                {totals.runtime}
              </div>
            </div>
            <div>
              <FieldLabel>Total Frames</FieldLabel>
              <div className="px-2.5 py-1.5 text-dense font-mono tabular-nums rounded-control"
                style={{ backgroundColor: '#1c1917', color: totals.totalFrames > 0 ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
                {fmtNumber(totals.totalFrames)}
              </div>
            </div>
          </div>

          {/* Counts + dates */}
          <div className="grid grid-cols-3 gap-x-4 gap-y-4 mb-5">
            <div>
              <FieldLabel>Shots / Assets / Tasks</FieldLabel>
              <div className="flex items-center gap-2">
                <span className="text-dense font-mono font-semibold" style={{ color: '#d6d3d1' }}>
                  {sceneShots.length}
                </span>
                <span className="text-dense font-mono tabular-nums" style={{ color: '#78716c' }}>
                  / {assetCountByScene[sceneId] || 0} / {taskCountByScene[sceneId] || 0}
                </span>
              </div>
            </div>
            <div>
              <FieldLabel>Start Date</FieldLabel>
              <input
                type="date"
                value={scene.start_date || ''}
                onChange={e => handleUpdate({ start_date: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', colorScheme: 'dark' }}
              />
            </div>
            <div>
              <FieldLabel>End Date</FieldLabel>
              <input
                type="date"
                value={scene.end_date || ''}
                onChange={e => handleUpdate({ end_date: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', colorScheme: 'dark' }}
              />
            </div>
          </div>

          {/* Description */}
          <div className="mb-4">
            <FieldLabel>Description</FieldLabel>
            {editingDesc ? (
              <div>
                <textarea value={descDraft} onChange={e => setDescDraft(e.target.value)}
                  className="w-full px-3 py-2 text-dense rounded-control resize-none focus:ring-1 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', minHeight: 80 }}
                  autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => { handleUpdate({ description: descDraft }); setEditingDesc(false) }}
                    className="text-dense text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button type="button" onClick={() => { setDescDraft(scene.description || ''); setEditingDesc(false) }}
                    className="text-dense text-stone-500 hover:text-stone-400">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingDesc(true)}
                className="px-3 py-2 text-dense rounded-control cursor-pointer hover:bg-stone-800 transition-colors"
                style={{ backgroundColor: '#1c1917', color: scene.description ? '#a8a29e' : '#57534e', border: '1px solid #44403c', minHeight: 40 }}>
                {scene.description || 'Click to add a description...'}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="mb-4">
            <FieldLabel>Notes</FieldLabel>
            {editingNotes ? (
              <div>
                <textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)}
                  className="w-full px-3 py-2 text-dense rounded-control resize-none focus:ring-1 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', minHeight: 60 }}
                  autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => { handleUpdate({ notes: notesDraft }); setEditingNotes(false) }}
                    className="text-dense text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button type="button" onClick={() => { setNotesDraft(scene.notes || ''); setEditingNotes(false) }}
                    className="text-dense text-stone-500 hover:text-stone-400">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingNotes(true)}
                className="px-3 py-2 text-dense rounded-control cursor-pointer hover:bg-stone-800 transition-colors"
                style={{ backgroundColor: '#1c1917', color: scene.notes ? '#a8a29e' : '#57534e', border: '1px solid #44403c', minHeight: 40 }}>
                {scene.notes || 'Click to add notes...'}
              </div>
            )}
          </div>

          {/* Folder path */}
          <div className="mb-4">
            <FieldLabel>Folder</FieldLabel>
            <div className="flex items-center gap-2 px-3 py-2 rounded-control"
              style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#57534e' }} />
              <span className="text-dense font-mono truncate" style={{ color: '#a8a29e' }}>
                {sceneFolderPath}
              </span>
            </div>
          </div>

          {/* Files */}
          <div className="mb-4">
            <FieldLabel>Files ({fileCount})</FieldLabel>
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

          {/* Shots list */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <FieldLabel>Shots ({sceneShots.length})</FieldLabel>
              <button type="button" onClick={() => onNewShot(sceneId)}
                className="flex items-center gap-1 px-2.5 py-1 text-dense rounded-control transition-colors hover:bg-stone-700"
                style={{ color: '#fb923c', border: '1px solid #44403c' }}>
                <Plus className="w-3 h-3" /> Add shot
              </button>
            </div>
            {sceneShots.length === 0 ? (
              <div className="px-3 py-4 text-center text-label uppercase rounded-control"
                style={{ color: '#57534e', backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
                No shots yet
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {sceneShots.map(shot => (
                  <div key={shot.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-control hover:bg-stone-800 transition-colors group/shot cursor-pointer"
                    style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}
                    onClick={() => onOpenShot?.(shot.id)}>
                    <Clapperboard className="w-3 h-3 flex-shrink-0" style={{ color: '#57534e' }} />
                    <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                      <span className="text-dense truncate block cursor-pointer" style={{ color: '#d6d3d1' }}
                        onClick={() => onOpenShot?.(shot.id)}>
                        {shot.name || 'Untitled shot'}
                      </span>
                      <InlineText
                        value={shot.description || ''}
                        placeholder="Add description…"
                        size="xs"
                        onCommit={v => ctx?.updateShot?.(shot.id, { description: v })}
                      />
                    </div>
                    <span className="text-dense font-mono flex-shrink-0" style={{ color: '#78716c' }}>
                      #{shot.shot_number ?? '—'}
                    </span>
                    {(shot.frame_count || 0) > 0 && (
                      <span className="text-dense font-mono tabular-nums flex-shrink-0" style={{ color: '#57534e' }}>
                        {framesToTimecode(shot.frame_count, fps)} · {fmtNumber(shot.frame_count)} fr
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 text-label font-mono uppercase rounded-control flex-shrink-0"
                      style={{ color: statusColor(shot.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(shot.status)}30` }}>
                      {fmt(shot.status || 'not_started')}
                    </span>
                    <button type="button"
                      onClick={() => onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' })}
                      className="p-0.5 rounded-control hover:bg-stone-700 transition-colors opacity-0 group-hover/shot:opacity-100"
                      style={{ color: '#ef4444' }}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>{/* close RIGHT COLUMN */}
        </div>{/* close two-column flex */}

        {/* Footer */}
        <div className="px-5 py-3 flex items-center justify-between flex-shrink-0" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button"
            onClick={() => { onClose(); onRequestDelete({ type: 'scene', id: scene.id, name: scene.name || 'Untitled' }) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-dense rounded-control transition-colors hover:bg-red-900/30"
            style={{ color: '#ef4444', border: '1px solid #ef444440' }}>
            <Trash2 className="w-3 h-3" /> Delete scene
          </button>
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-dense rounded-control transition-colors hover:bg-stone-700"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            Close
          </button>
        </div>
      </div>{/* close MAIN POPUP */}
      </div>{/* close flex container */}
    </>
  )
}


// ─── Shot detail popup ───
function ShotDetailPopup({ shotId, ctx, takes, fps, projectMembers, roleEntries, thumbRevision, onThumbChanged, onClose, onRequestDelete }) {
  const shot = (ctx?.shots || []).find(s => s.id === shotId)
  const scene = shot ? (ctx?.scenes || []).find(s => s.id === shot.scene_id) : null
  const project = ctx?.project
  const managedFiles = ctx?.managedFiles || []

  const [descDraft, setDescDraft] = useState(shot?.description || '')
  const [notesDraft, setNotesDraft] = useState(shot?.notes || '')
  const [editingDesc, setEditingDesc] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [nestedTaskId, setNestedTaskId] = useState(null)
  const [nestedAssetId, setNestedAssetId] = useState(null)

  useEffect(() => { setDescDraft(shot?.description || '') }, [shot?.description])
  useEffect(() => { setNotesDraft(shot?.notes || '') }, [shot?.notes])

  if (!shot) return null

  const sc = statusColor(shot.status)
  const hasThumbnail = !!shot.thumbnail_image

  function handleUpdate(patch) { ctx?.updateShot?.(shot.id, patch) }

  async function handleSetThumbnail() {
    if (!window.electronAPI?.rabbit?.pickImage) return
    const imagePath = await window.electronAPI.rabbit.pickImage()
    if (!imagePath) return
    handleUpdate({ thumbnail_image: imagePath })
    try {
      await window.electronAPI.rabbit.generateEntityThumbnail({ entityType: 'shot', entityId: shot.id, sourcePath: imagePath })
    } catch (e) { console.error('shot thumbnail gen failed:', e) }
    onThumbChanged?.()
  }

  async function handleClearThumbnail() {
    handleUpdate({ thumbnail_image: null })
    try { await window.electronAPI.rabbit.clearEntityThumbnail({ entityType: 'shot', entityId: shot.id }) } catch {}
    onThumbChanged?.()
  }

  async function handleCreateTask(draft) {
    try {
      await ctx?.addTask?.({ ...draft, shot_id: shot.id, scene_id: shot.scene_id || null })
      setShowCreateTask(false)
    } catch (err) { console.error('Failed to create task:', err) }
  }

  // Build shot code
  const shotCode = shotCodeFor(project, scene?.scene_number ?? 0, shot.shot_number ?? 0)
  const shotSlug = fileSlugify(shot.name || 'Untitled-Shot')
  const shotFolderPath = `SHOTS/${shotSlug}/`

  const fileCount = managedFiles.filter(f => f.shot_id === shot.id && !f.deleted_at).length
  // Shot takes (milestone 2): the ordered list, and the primary take's poster
  // standing in while the shot has no thumbnail of its own (Q6).
  const shotTakeEntries = takes?.map?.get(shot.id) || []
  const takeFallback = takes?.supports && !hasThumbnail ? primaryOf(shotTakeEntries)?.file : null

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      <div className="fixed z-50 inset-0 flex items-center justify-center gap-3 pointer-events-none">

        {/* ── LEFT SIDE POPUP ── */}
        {showCreateTask && (
          <div className="pointer-events-auto flex-shrink-0 max-h-[85vh]">
            <NewTaskSidePopup
              entityType="shot"
              entityId={shot.id}
              assets={ctx?.assets || []}
              phases={ctx?.phases || []}
              scenes={ctx?.scenes || []}
              shots={ctx?.shots || []}
              levels={ctx?.levels || []}
              experiences={ctx?.experiences || []}
              projectMembers={projectMembers || []}
              roleEntries={roleEntries || []}
              project={project}
              onConfirm={handleCreateTask}
              onClose={() => setShowCreateTask(false)}
            />
          </div>
        )}

        {nestedTaskId && !showCreateTask && (
          <div className="pointer-events-auto flex-shrink-0 max-h-[85vh] overflow-auto">
            <TaskDetailPopup taskId={nestedTaskId} ctx={ctx} onClose={() => setNestedTaskId(null)} />
          </div>
        )}

        {/* ── MAIN POPUP ── */}
        <div
          className="pointer-events-auto w-full max-w-4xl rounded-control overflow-hidden flex flex-col"
          style={{
            backgroundColor: '#292524',
            border: '2px solid #f97316',
            maxHeight: '85vh',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}
          onClick={e => e.stopPropagation()}
        >
        {/* Header — spans full width */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `3px solid ${sc}` }}>
          <div className="flex items-center gap-2.5">
            <Clapperboard className="w-4 h-4" style={{ color: '#fb923c' }} />
            <span className="text-h3 font-semibold" style={{ color: '#fb923c' }}>
              {shot.name || 'Untitled shot'}
            </span>
            <span className="text-label font-mono uppercase px-1.5 py-0.5 rounded-control"
              style={{ color: '#78716c', backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              {shotCode}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded-control transition-colors" style={{ color: '#a8a29e' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-column body */}
        <div className="flex-1 overflow-auto flex">

          {/* LEFT COLUMN — Relations */}
          <RelationsPanel
            entityType="shot"
            entityId={shot.id}
            assets={ctx?.assets || []}
            tasks={ctx?.tasks || []}
            ctx={ctx}
            onOpenAsset={id => setNestedAssetId(id)}
            onOpenTask={id => setNestedTaskId(id)}
            onCreateTask={() => setShowCreateTask(true)}
          />

          {/* RIGHT COLUMN — Properties */}
          <div className="flex-1 overflow-auto px-5 py-4 min-w-0">

          {/* Thumbnail + Title */}
          <div className="flex items-start gap-4 mb-5">
            <div className="relative flex-shrink-0 rounded-control overflow-hidden flex items-center justify-center group/thumb"
              style={{ width: 142, height: 80, backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              {hasThumbnail ? (
                <>
                  <img
                    src={`/api/rabbit/projects/${project?.id}/shots/${shot.id}/thumbnail?r=${thumbRevision}`}
                    alt="" style={{ width: 142, height: 80, objectFit: 'cover', display: 'block' }} />
                  <div className="absolute inset-0 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center gap-1"
                    style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
                    <button type="button" onClick={handleSetThumbnail}
                      className="p-1.5 rounded-control hover:bg-stone-700 transition-colors" style={{ color: '#d6d3d1' }}
                      title="Change thumbnail"><ImagePlus className="w-4 h-4" /></button>
                    <button type="button" onClick={handleClearThumbnail}
                      className="p-1.5 rounded-control hover:bg-stone-700 transition-colors" style={{ color: '#fca5a5' }}
                      title="Remove thumbnail"><ImageOff className="w-4 h-4" /></button>
                  </div>
                </>
              ) : (
                <button type="button" onClick={handleSetThumbnail}
                  className="w-full h-full flex items-center justify-center hover:bg-stone-800 transition-colors relative"
                  style={{ color: '#57534e' }} title={takeFallback ? 'Showing the primary take. Click to set a thumbnail of your own.' : 'Set thumbnail'}>
                  {takeFallback && (
                    <BinPoster row={takeFallback} src={takes.thumbUrlFor?.(takeFallback.id)} width={142} height={80} radius={0}
                      className="absolute inset-0 group-hover/thumb:opacity-40 transition-opacity" style={{ border: 'none' }} iconSize={24} />
                  )}
                  <div className="flex flex-col items-center gap-1 opacity-0 group-hover/thumb:opacity-100 transition-opacity relative">
                    <ImagePlus className="w-4 h-4" style={{ color: takeFallback ? '#d6d3d1' : undefined }} />
                    <span className="text-label uppercase" style={{ color: takeFallback ? '#d6d3d1' : undefined }}>Set thumbnail</span>
                  </div>
                  {!takeFallback && <Clapperboard className="w-5 h-5 group-hover/thumb:opacity-0 transition-opacity absolute" style={{ color: '#292524' }} />}
                  {takeFallback && <span className="absolute bottom-0 left-0 right-0 text-label uppercase text-center py-px group-hover/thumb:opacity-0 transition-opacity" style={{ color: '#fb923c', backgroundColor: 'rgba(12,10,9,0.75)' }}>from primary take</span>}
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <FieldLabel>Shot name</FieldLabel>
              <PopupInlineText
                value={shot.name || ''}
                placeholder="Untitled shot"
                onCommit={v => handleUpdate({ name: v })}
              />
            </div>
          </div>

          {/* Properties grid */}
          <div className="grid grid-cols-3 gap-x-4 gap-y-4 mb-5">
            <div>
              <FieldLabel>Status</FieldLabel>
              <select value={shot.status || 'not_started'} onChange={e => handleUpdate({ status: e.target.value })}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: sc, border: '1px solid #44403c' }}>
                {SCENE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Type</FieldLabel>
              <select value={shot.type || 'other'} onChange={e => handleUpdate({ type: e.target.value })}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}>
                {SCENE_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Time of Day</FieldLabel>
              <select value={shot.time_of_day || ''} onChange={e => handleUpdate({ time_of_day: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: shot.time_of_day ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
                <option value="">—</option>
                {TIME_OF_DAY_OPTIONS.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Shot number</FieldLabel>
              <input type="number" value={shot.shot_number ?? ''} onChange={e => {
                const n = parseInt(e.target.value, 10)
                if (Number.isFinite(n) && n >= 0) handleUpdate({ shot_number: n })
              }}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }} />
            </div>
            <div>
              <FieldLabel>Frame count</FieldLabel>
              <input type="number" min={0} value={shot.frame_count ?? ''} onChange={e => {
                const n = parseInt(e.target.value, 10)
                handleUpdate({ frame_count: Number.isFinite(n) && n >= 0 ? n : 0 })
              }}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}
                placeholder="0" />
            </div>
            <div>
              <FieldLabel>Duration</FieldLabel>
              <div className="px-2.5 py-1.5 text-dense font-mono tabular-nums rounded-control"
                style={{ backgroundColor: '#1c1917', color: (shot.frame_count || 0) > 0 ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
                {framesToTimecode(shot.frame_count || 0, fps)}
              </div>
            </div>
          </div>

          {/* Framing + Camera Movement */}
          <div className="grid grid-cols-3 gap-x-4 gap-y-4 mb-5">
            <div>
              <FieldLabel>Framing</FieldLabel>
              <select value={shot.framing || ''} onChange={e => handleUpdate({ framing: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: shot.framing ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
                <option value="">—</option>
                {FRAMING_OPTIONS.map(f => <option key={f.abbr} value={f.abbr}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Camera Movement</FieldLabel>
              <select value={shot.camera_movement || ''} onChange={e => handleUpdate({ camera_movement: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: shot.camera_movement ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
                <option value="">—</option>
                {CAMERA_MOVEMENT_OPTIONS.map(c => <option key={c.abbr} value={c.abbr}>{c.abbr} — {c.label}</option>)}
              </select>
            </div>
            <div />
          </div>

          {/* Parent scene + dates */}
          <div className="grid grid-cols-3 gap-x-4 gap-y-4 mb-5">
            <div>
              <FieldLabel>Parent scene</FieldLabel>
              <div className="px-2.5 py-1.5 text-dense truncate rounded-control"
                style={{ backgroundColor: '#1c1917', color: scene ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
                {scene?.name || '—'}
              </div>
            </div>
            <div>
              <FieldLabel>Start Date</FieldLabel>
              <input
                type="date"
                value={shot.start_date || ''}
                onChange={e => handleUpdate({ start_date: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', colorScheme: 'dark' }}
              />
            </div>
            <div>
              <FieldLabel>End Date</FieldLabel>
              <input
                type="date"
                value={shot.end_date || ''}
                onChange={e => handleUpdate({ end_date: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-dense rounded-control focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', colorScheme: 'dark' }}
              />
            </div>
          </div>

          {/* Description */}
          <div className="mb-4">
            <FieldLabel>Description</FieldLabel>
            {editingDesc ? (
              <div>
                <textarea value={descDraft} onChange={e => setDescDraft(e.target.value)}
                  className="w-full px-3 py-2 text-dense rounded-control resize-none focus:ring-1 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', minHeight: 80 }}
                  autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => { handleUpdate({ description: descDraft }); setEditingDesc(false) }}
                    className="text-dense text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button type="button" onClick={() => { setDescDraft(shot.description || ''); setEditingDesc(false) }}
                    className="text-dense text-stone-500 hover:text-stone-400">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingDesc(true)}
                className="px-3 py-2 text-dense rounded-control cursor-pointer hover:bg-stone-800 transition-colors"
                style={{ backgroundColor: '#1c1917', color: shot.description ? '#a8a29e' : '#57534e', border: '1px solid #44403c', minHeight: 40 }}>
                {shot.description || 'Click to add a description...'}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="mb-4">
            <FieldLabel>Notes</FieldLabel>
            {editingNotes ? (
              <div>
                <textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)}
                  className="w-full px-3 py-2 text-dense rounded-control resize-none focus:ring-1 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', minHeight: 60 }}
                  autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => { handleUpdate({ notes: notesDraft }); setEditingNotes(false) }}
                    className="text-dense text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button type="button" onClick={() => { setNotesDraft(shot.notes || ''); setEditingNotes(false) }}
                    className="text-dense text-stone-500 hover:text-stone-400">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingNotes(true)}
                className="px-3 py-2 text-dense rounded-control cursor-pointer hover:bg-stone-800 transition-colors"
                style={{ backgroundColor: '#1c1917', color: shot.notes ? '#a8a29e' : '#57534e', border: '1px solid #44403c', minHeight: 40 }}>
                {shot.notes || 'Click to add notes...'}
              </div>
            )}
          </div>

          {/* Folder path */}
          <div className="mb-4">
            <FieldLabel>Folder</FieldLabel>
            <div className="flex items-center gap-2 px-3 py-2 rounded-control"
              style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#57534e' }} />
              <span className="text-dense font-mono truncate" style={{ color: '#a8a29e' }}>
                {shotFolderPath}
              </span>
            </div>
          </div>

          {/* Takes (milestone 2): the bin files this shot is cut from, in order */}
          {takes?.supports && (
            <div className="mb-4">
              <FieldLabel>Takes ({shotTakeEntries.length})</FieldLabel>
              {takes.notice && (
                <div className="flex items-center gap-2 mb-2 text-dense" style={{ color: '#f59e0b' }}>
                  <span className="flex-1">{takes.notice}</span>
                  <button type="button" onClick={takes.clearNotice} className="p-0.5 rounded-control hover:bg-stone-700" style={{ color: '#78716c' }}><X className="w-3 h-3" /></button>
                </div>
              )}
              <ShotTakesPanel shot={shot} entries={shotTakeEntries} fps={fps} canWrite={takes.canWrite} thumbUrlFor={takes.thumbUrlFor} binPathFor={takes.binPathFor} projectId={takes.projectId}
                onUpdate={takes.onUpdate} onRemove={takes.onRemove} onReorder={takes.onReorder} onUseLength={takes.onUseLength}
                onOpenPicker={() => takes.openPicker(shot.id)} />
            </div>
          )}

          {/* Files */}
          <div className="mb-4">
            <FieldLabel>Files ({fileCount})</FieldLabel>
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
          </div>{/* close RIGHT COLUMN */}
        </div>{/* close two-column flex */}

        {/* Footer */}
        <div className="px-5 py-3 flex items-center justify-between flex-shrink-0" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button"
            onClick={() => { onClose(); onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' }) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-dense rounded-control transition-colors hover:bg-red-900/30"
            style={{ color: '#ef4444', border: '1px solid #ef444440' }}>
            <Trash2 className="w-3 h-3" /> Delete shot
          </button>
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-dense rounded-control transition-colors hover:bg-stone-700"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            Close
          </button>
        </div>
      </div>{/* close MAIN POPUP */}
      </div>{/* close flex container */}
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
function ConfirmDialog({ title, message, onConfirm, onCancel, dismissOnBackdrop = true }) {
  return createPortal(
    <Dialog
      width="confirm"
      title={title}
      dismissOnBackdrop={dismissOnBackdrop}
      onClose={onCancel}
      footer={(
        <>
          <Button autoFocus onClick={onCancel}>Cancel</Button>
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
// B3d trap 3). `label` names the field for a screen reader.
function InlineText({ value, placeholder, onCommit, size = 'md', strong = false, label }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus() }, [editing])

  if (editing) {
    return (
      <input ref={inputRef} type="text" value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onCommit(draft); setEditing(false) }}
        onKeyDown={e => {
          if (e.key === 'Enter') { if (draft !== value) onCommit(draft); setEditing(false) }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
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
      onClick={e => { e.stopPropagation(); setEditing(true) }}
    >
      {value || placeholder}
    </span>
  )
}


// ─── PopupInlineText ───
function PopupInlineText({ value, placeholder, onCommit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus() }, [editing])

  if (editing) {
    return (
      <input ref={inputRef} type="text" value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onCommit(draft); setEditing(false) }}
        onKeyDown={e => {
          if (e.key === 'Enter') { if (draft !== value) onCommit(draft); setEditing(false) }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className="w-full bg-transparent text-body"
        style={{ color: '#f4a261', borderBottom: '1px solid #fb923c' }}
      />
    )
  }
  return (
    <span
      className="text-dense truncate cursor-text block"
      style={{ color: value ? '#d6d3d1' : '#57534e' }}
      onClick={() => setEditing(true)}
    >
      {value || placeholder}
    </span>
  )
}


// ─── FieldLabel ───
function FieldLabel({ children }) {
  return (
    <span className="block text-label uppercase font-semibold mb-1" style={{ color: '#78716c' }}>
      {children}
    </span>
  )
}
