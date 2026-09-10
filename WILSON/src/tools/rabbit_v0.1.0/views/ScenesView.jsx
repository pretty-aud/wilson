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

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  Film, Plus, Search, X, LayoutGrid, Filter,
  Layers, ChevronDown, ChevronRight, Trash2, Edit3, Eye,
  Table as TableIcon, ArrowUpDown, AlertTriangle, Save,
  Maximize2, Minimize2, Clapperboard,
  BookmarkPlus, CheckSquare, Square, MinusSquare,
  Clock, Hash, Sun, FolderOpen, ImagePlus, ImageOff,
} from 'lucide-react'
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

const FRAMING_OPTIONS = [
  { abbr: 'EWS',     label: 'Extreme Wide Shot' },
  { abbr: 'WS',      label: 'Wide Shot' },
  { abbr: 'FS',      label: 'Full Shot' },
  { abbr: 'LS',      label: 'Long Shot' },
  { abbr: 'MLS',     label: 'Medium Long Shot' },
  { abbr: 'MS',      label: 'Medium Shot' },
  { abbr: 'MCU',     label: 'Medium Close-Up' },
  { abbr: 'CU',      label: 'Close-Up' },
  { abbr: 'ECU',     label: 'Extreme Close-Up' },
  { abbr: '2S',      label: 'Two-Shot' },
  { abbr: '3S',      label: 'Three-Shot' },
  { abbr: 'OTS',     label: 'Over-the-Shoulder' },
  { abbr: 'POV',     label: 'Point of View' },
  { abbr: 'INS',     label: 'Insert Shot' },
  { abbr: 'CA',      label: 'Cutaway' },
  { abbr: 'AER',     label: 'Aerial / Bird\'s Eye' },
]

const CAMERA_MOVEMENT_OPTIONS = [
  { abbr: 'PAN',        label: 'Pan' },
  { abbr: 'TILT',       label: 'Tilt' },
  { abbr: 'DUTCH',      label: 'Dutch Tilt' },
  { abbr: 'ROLL',       label: 'Roll' },
  { abbr: 'DOLLY IN',   label: 'Dolly In' },
  { abbr: 'DOLLY OUT',  label: 'Dolly Out' },
  { abbr: 'TRUCK L',    label: 'Truck Left' },
  { abbr: 'TRUCK R',    label: 'Truck Right' },
  { abbr: 'PED UP',     label: 'Pedestal Up' },
  { abbr: 'PED DOWN',   label: 'Pedestal Down' },
  { abbr: 'CRANE UP',   label: 'Crane Up' },
  { abbr: 'CRANE DOWN', label: 'Crane Down' },
  { abbr: 'ZOOM IN',    label: 'Zoom In' },
  { abbr: 'ZOOM OUT',   label: 'Zoom Out' },
  { abbr: 'DOLLY ZOOM', label: 'Dolly Zoom / Vertigo' },
  { abbr: 'HANDHELD',   label: 'Handheld' },
  { abbr: 'STEADICAM',  label: 'Steadicam' },
  { abbr: 'ARC',        label: 'Arc' },
  { abbr: 'PUSH IN',    label: 'Push In' },
  { abbr: 'PULL OUT',   label: 'Pull Out' },
  { abbr: 'WHIP PAN',   label: 'Whip Pan' },
  { abbr: 'RACK FOCUS', label: 'Rack Focus' },
]

// ── Thumbnail row heights (16:9 aspect) ──
const BASE_ROW_H = 36
const THUMB_SIZES = {
  sm: { h: BASE_ROW_H },
  md: { h: Math.round(BASE_ROW_H * 1.5) },
  lg: { h: BASE_ROW_H * 2 },
}
function thumbW(h) { return Math.round(h * 16 / 9) }

// ── Sort config ──
const SORTABLE_FIELDS = [
  { value: 'name',         label: 'Name' },
  { value: 'scene_number', label: 'Scene Number' },
  { value: 'type',         label: 'Type' },
  { value: 'status',       label: 'Status' },
  { value: 'time_of_day',  label: 'Time of Day' },
  { value: 'created_at',   label: 'Created' },
]

const SHOT_SORTABLE_FIELDS = [
  { value: 'name',             label: 'Name' },
  { value: 'shot_number',      label: 'Shot Number' },
  { value: 'type',             label: 'Type' },
  { value: 'status',           label: 'Status' },
  { value: 'time_of_day',      label: 'Time of Day' },
  { value: 'framing',          label: 'Framing' },
  { value: 'camera_movement',  label: 'Camera Movement' },
  { value: 'frame_count',      label: 'Frame Count' },
  { value: 'created_at',       label: 'Created' },
]

const SHOT_FILTER_FIELDS = [
  { value: 'status',          label: 'Status',          type: 'select', options: SCENE_STATUSES },
  { value: 'type',            label: 'Type',            type: 'select', options: SCENE_TYPES },
  { value: 'time_of_day',     label: 'Time of Day',     type: 'select', options: TIME_OF_DAY_OPTIONS },
  { value: 'framing',         label: 'Framing',         type: 'select', options: FRAMING_OPTIONS.map(f => f.abbr) },
  { value: 'camera_movement', label: 'Camera Movement', type: 'select', options: CAMERA_MOVEMENT_OPTIONS.map(c => c.abbr) },
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
  { value: 'time_of_day',    label: 'Time of Day' },
  { value: 'framing',        label: 'Framing' },
  { value: 'camera_movement', label: 'Camera Movement' },
]

// ── Filter config ──
const SCENE_FILTER_FIELDS = [
  { value: 'status',      label: 'Status',      type: 'select', options: SCENE_STATUSES },
  { value: 'type',        label: 'Type',        type: 'select', options: SCENE_TYPES },
  { value: 'time_of_day', label: 'Time of Day', type: 'select', options: TIME_OF_DAY_OPTIONS },
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
  const takeThumbUrlFor = useCallback((id) => ctx?.binFileThumbnailUrl?.(id) || null, [ctx])
  const binPathFor = useCallback((id) => binPathLabel(bins, id), [bins])
  // Posters and the `online` flag come from the bins list route; load it once
  // per project so the chips are right even if the Bins tab was never opened.
  // 🚨 ctx through a ref: its identity changes on every provider update.
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  useEffect(() => {
    const c = ctxRef.current
    if (!supportsBins || !project?.id || c?.binsInfo?.loadedFor === project.id) return
    c?.refreshBins?.().catch(() => {})
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
    open: setTakesShotId, openPicker: setPickerShotId, binPathFor,
    onUpdate: handleUpdateTake, onRemove: handleRemoveTakes, onReorder: handleReorderTakes, onUseLength: handleUseTakeLength,
    notice: takesNotice, clearNotice: () => setTakesNotice(null),
  }), [supportsBins, takesByShotMap, takeThumbUrlFor, canWriteProject, binPathFor, handleUpdateTake, handleRemoveTakes, handleReorderTakes, handleUseTakeLength, takesNotice])
  // "Open in Scenes" from the bin inspector lands on the shot's detail popup.
  const onNavigate = useCallback((p) => { if (p?.shotId) { setDetailShotId(p.shotId); setDetailSceneId(null) } else if (p?.sceneId) setDetailSceneId(p.sceneId) }, [])
  useNavigateTarget('scenes', onNavigate)
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
  const groupAccent = useCallback((key) => {
    if (groupBy === 'status') return statusColor(key)
    return '#fb923c'
  }, [groupBy])

  const groups = useMemo(() => {
    if (!groupBy) return null
    const map = {}
    for (const s of sorted) {
      const key = s[groupBy] || '__empty__'
      if (!map[key]) map[key] = { key, label: fmt(key === '__empty__' ? 'none' : key), scenes: [] }
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
    return keys.map(key => ({
      key,
      label: key === '__none__' ? 'Unset' : (field === 'framing' ? key : fmt(key)),
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
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: '#1c1917' }}>
        <span className="text-[13.5px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>
          No project loaded
        </span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>

      {/* ── Summary cards (always visible) ── */}
      <div className="flex gap-3 px-4 pt-4 pb-2 flex-wrap flex-shrink-0">
        <BigTile icon={Clock} label="Total Runtime" value={grandTotals.runtime} />
        <BigTile icon={Hash} label="Total Frames" value={fmtNumber(grandTotals.frames)} />
        <BigTile icon={Film} label="Scenes" value={grandTotals.scenes} />
        <BigTile icon={Clapperboard} label="Shots" value={grandTotals.shots} />
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-2 flex-wrap flex-shrink-0" style={{ borderBottom: '1px solid #44403c' }}>

        {/* Content mode toggle */}
        <div className="flex items-center rounded-sm overflow-hidden" style={{ border: '1px solid #44403c' }}>
          {['scenes', 'shots'].map(m => (
            <button key={m} type="button" onClick={() => setContentMode(m)}
              className="px-2.5 py-1.5 text-[10.5px] font-mono uppercase tracking-wider transition-colors"
              style={{
                color: contentMode === m ? '#fff7ed' : '#78716c',
                backgroundColor: contentMode === m ? '#ea580c' : 'transparent',
              }}>
              {m === 'scenes' ? 'Scenes' : 'Shots'}
            </button>
          ))}
        </div>

        {/* Filter */}
        <button type="button" onClick={() => setShowFilterPanel(!showFilterPanel)}
          className="flex items-center gap-1.5 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
          style={{ color: filters.length > 0 ? '#fb923c' : '#78716c', border: '1px solid #44403c' }}>
          <Filter className="w-3 h-3" />
          Filter{filters.length > 0 ? ` (${filters.length})` : ''}
        </button>

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* Sort */}
        <div className="flex items-center gap-1">
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            className="px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm focus:outline-none cursor-pointer"
            style={{ backgroundColor: '#292524', color: sortField ? '#fb923c' : '#78716c', border: '1px solid #44403c', width: 150 }}>
            <option value="">Sort…</option>
            {(contentMode === 'shots' ? SHOT_SORTABLE_FIELDS : SORTABLE_FIELDS).map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <button type="button" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            className="p-1.5 rounded-sm hover:bg-stone-700 transition-colors"
            style={{ color: sortField ? '#fb923c' : '#57534e' }}>
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Group */}
        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />
        {contentMode === 'scenes' ? (
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)}
            className="px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm focus:outline-none cursor-pointer"
            style={{ backgroundColor: '#292524', color: groupBy ? '#fb923c' : '#78716c', border: '1px solid #44403c', width: 170 }}>
            {GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        ) : (
          <select value={shotGroupBy} onChange={e => setShotGroupBy(e.target.value)}
            className="px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm focus:outline-none cursor-pointer"
            style={{ backgroundColor: '#292524', color: shotGroupBy ? '#fb923c' : '#78716c', border: '1px solid #44403c', width: 170 }}>
            {SHOT_GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        )}

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* View mode toggle */}
        <div className="flex items-center rounded-sm overflow-hidden" style={{ border: '1px solid #44403c' }}>
          <button type="button" onClick={() => setViewMode('table')}
            className="flex items-center gap-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider transition-colors"
            style={{ color: viewMode === 'table' ? '#fff7ed' : '#78716c', backgroundColor: viewMode === 'table' ? '#ea580c' : 'transparent' }}>
            <TableIcon className="w-3 h-3" /> Table
          </button>
          <button type="button" onClick={() => setViewMode('gallery')}
            className="flex items-center gap-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider transition-colors"
            style={{ color: viewMode === 'gallery' ? '#fff7ed' : '#78716c', backgroundColor: viewMode === 'gallery' ? '#ea580c' : 'transparent' }}>
            <LayoutGrid className="w-3 h-3" /> Gallery
          </button>
        </div>

        {/* Thumbnail size (table mode) */}
        {viewMode === 'table' && (
          <div className="flex rounded-sm overflow-hidden" style={{ border: '1px solid #44403c' }}>
            {[{ key: 'sm', size: 10 }, { key: 'md', size: 13 }, { key: 'lg', size: 16 }].map(({ key, size }) => (
              <button key={key} type="button" onClick={() => setThumbSize(key)}
                className="flex items-center justify-center w-7 h-7 transition-colors"
                title={`${key} thumbnails`}
                style={{
                  backgroundColor: thumbSize === key ? '#ea580c' : 'transparent',
                  color: thumbSize === key ? '#fff7ed' : '#78716c',
                  borderLeft: key !== 'sm' ? '1px solid #44403c' : 'none',
                }}>
                <Square style={{ width: size, height: size }} />
              </button>
            ))}
          </div>
        )}

        {/* Gallery size (gallery mode only) */}
        {viewMode === 'gallery' && (
          <div className="flex rounded-sm overflow-hidden" style={{ border: '1px solid #44403c' }}>
            {[{ key: 'sm', size: 10 }, { key: 'md', size: 13 }, { key: 'lg', size: 16 }].map(({ key, size }) => (
              <button key={key} type="button" onClick={() => setGallerySize(key)}
                className="flex items-center justify-center w-7 h-7 transition-colors"
                title={`${key} cards`}
                style={{
                  backgroundColor: gallerySize === key ? '#ea580c' : 'transparent',
                  color: gallerySize === key ? '#fff7ed' : '#78716c',
                  borderLeft: key !== 'sm' ? '1px solid #44403c' : 'none',
                }}>
                <Square style={{ width: size, height: size }} />
              </button>
            ))}
          </div>
        )}

        {/* FPS badge */}
        <span className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm flex-shrink-0"
          style={{ color: '#fb923c', backgroundColor: '#292524', border: '1px solid #44403c' }}>
          {fps} fps
        </span>

        {/* Saved views */}
        <SceneSavedViewsDropdown
          views={savedViews}
          onLoad={loadView}
          onDelete={deleteView}
          onSaveRequest={() => setShowSaveDialog(true)}
        />

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* Search */}
        <div className="flex items-center flex-1 min-w-[120px] max-w-[240px] rounded-sm" style={{ border: '1px solid #44403c', backgroundColor: '#292524' }}>
          <Search className="w-3 h-3 ml-2 flex-shrink-0" style={{ color: '#57534e' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="flex-1 px-2 py-1.5 text-[10.5px] font-mono bg-transparent focus:outline-none"
            style={{ color: '#d6d3d1' }} />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="p-1 mr-0.5 hover:bg-stone-700 rounded transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Count */}
        <span className="text-[10.5px] font-mono tabular-nums flex-shrink-0" style={{ color: '#57534e' }}>
          {contentMode === 'scenes'
            ? `${filtered.length}/${scenes.length}`
            : `${totalFilteredShots}/${shots.length}`}
        </span>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={handleNewScene}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:brightness-110"
            style={{
              color: contentMode === 'scenes' ? '#fff7ed' : '#78716c',
              backgroundColor: contentMode === 'scenes' ? '#ea580c' : 'transparent',
              border: contentMode === 'scenes' ? '1px solid #c2410c' : '1px solid #44403c',
            }}>
            <Plus className="w-3 h-3" /> Scene
          </button>

          {/* Shot button with scene picker */}
          <div ref={shotPickerRef} className="relative">
            <button type="button"
              onClick={() => {
                if (scenes.length === 1) { handleNewShot(scenes[0].id); return }
                if (scenes.length > 1) setShotPickerOpen(o => !o)
              }}
              disabled={scenes.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                color: contentMode === 'shots' ? '#fff7ed' : '#78716c',
                backgroundColor: contentMode === 'shots' ? '#ea580c' : 'transparent',
                border: contentMode === 'shots' ? '1px solid #c2410c' : '1px solid #44403c',
              }}>
              <Plus className="w-3 h-3" /> Shot
              {scenes.length > 1 && <ChevronDown className="w-3 h-3 ml-0.5" />}
            </button>
            {shotPickerOpen && scenes.length > 1 && (
              <div className="absolute right-0 mt-1 z-40 rounded-sm shadow-2xl overflow-hidden"
                style={{ backgroundColor: '#292524', border: '1px solid #44403c', minWidth: 200, maxHeight: 260 }}>
                <div className="px-3 py-1.5 text-[9.5px] font-mono uppercase tracking-wider" style={{ color: '#78716c', borderBottom: '1px solid #44403c' }}>
                  Add shot to scene:
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                  {scenes
                    .slice()
                    .sort((a, b) => (a.scene_number ?? 0) - (b.scene_number ?? 0))
                    .map(sc => (
                      <button key={sc.id} type="button"
                        onClick={() => { handleNewShot(sc.id); setShotPickerOpen(false) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11.5px] font-mono hover:bg-stone-700 transition-colors"
                        style={{ borderBottom: '1px solid #1c1917', color: '#d6d3d1' }}>
                        <Film className="w-3 h-3 flex-shrink-0" style={{ color: '#fb923c' }} />
                        <span className="flex-1 truncate">{sc.name || 'Untitled'}</span>
                        <span className="text-[9.5px] font-mono ml-auto flex-shrink-0" style={{ color: '#57534e' }}>
                          {(shotsByScene[sc.id] || []).length} shots
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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

      {/* ── Save view dialog ── */}
      {showSaveDialog && (
        <div className="px-4 py-2.5 flex items-center gap-2 flex-shrink-0" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}>
          <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="View name..."
            className="px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500 w-48"
            style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}
            onKeyDown={e => { if (e.key === 'Enter') saveCurrentView(); if (e.key === 'Escape') setShowSaveDialog(false) }}
            autoFocus />
          <button type="button" onClick={saveCurrentView}
            className="px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>Save</button>
          <button type="button" onClick={() => setShowSaveDialog(false)}
            className="p-1 hover:bg-stone-700 rounded-sm transition-colors" style={{ color: '#a8a29e' }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto">
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
              groups.map(g => (
                <div key={g.key}>
                  <div className="flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-stone-800/30 transition-colors"
                    style={{ borderBottom: '1px solid #292524', borderLeft: `3px solid ${groupAccent(g.key)}`, backgroundColor: '#292524' }}
                    onClick={() => toggleGroup(g.key)}>
                    {collapsedGroups.has(g.key)
                      ? <ChevronRight className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
                      : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#78716c' }} />}
                    <span className="text-[11.5px] font-mono uppercase tracking-wider font-bold" style={{ color: groupAccent(g.key) }}>
                      {g.label}
                    </span>
                    <span className="text-[10.5px] font-mono" style={{ color: '#78716c' }}>
                      ({g.scenes.length})
                    </span>
                  </div>
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
              ))
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
            entries={takesByShotMap.get(shot.id) || []} fps={fps} canWrite={takesApi.canWrite} thumbUrlFor={takeThumbUrlFor} binPathFor={binPathFor}
            onUpdate={handleUpdateTake} onRemove={handleRemoveTakes} onReorder={handleReorderTakes} onUseLength={handleUseTakeLength}
            onOpenPicker={() => setPickerShotId(shot.id)}>
            {takesNotice && <div className="mt-2 text-[10.5px] font-mono" style={{ color: '#f59e0b' }}>{takesNotice}</div>}
          </ShotTakesDialog>
        )
      })()}
      {pickerShotId && (() => {
        const shot = shots.find(s => s.id === pickerShotId)
        if (!shot) return null
        const entries = takesByShotMap.get(shot.id) || []
        return (
          <TakePickerDialog shot={shot} scene={sceneMap[shot.scene_id] || null} files={binFiles} bins={bins}
            assignedFileIds={entries.map(e => e.file.id)} hasPrimary={entries.length > 0} thumbUrlFor={takeThumbUrlFor} busy={takesBusy}
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
function BigTile({ icon: Icon, label, value, tone = 'neutral' }) {
  const colors = {
    good:    { bg: '#1c1917', border: '#15803d', text: '#86efac', label: '#86efac', icon: '#15803d' },
    danger:  { bg: '#1c1917', border: '#7f1d1d', text: '#fca5a5', label: '#fca5a5', icon: '#7f1d1d' },
    neutral: { bg: '#1c1917', border: '#44403c', text: '#d6d3d1', label: '#a8a29e', icon: '#57534e' },
  }[tone]
  return (
    <div className="flex-1 min-w-[120px] flex items-center gap-3 rounded-sm px-4 py-3"
      style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}>
      <Icon className="w-4 h-4 flex-shrink-0" style={{ color: colors.icon }} />
      <div className="flex flex-col min-w-0">
        <span className="text-[11.5px] font-mono uppercase tracking-widest" style={{ color: colors.label }}>{label}</span>
        <span className="text-lg font-mono font-bold" style={{ color: colors.text }}>{value}</span>
      </div>
    </div>
  )
}


// ─── Scene table ───
function SceneTable({ scenes, shotsByScene, sceneTotals, assetCountByScene, taskCountByScene, fps, thumbSize, thumbRevision = 0, onThumbChanged, ctx, takes, onOpenDetail, onOpenShotDetail, onNewShot, onRequestDelete }) {
  const rowH = THUMB_SIZES[thumbSize]?.h || BASE_ROW_H
  const tw = thumbW(rowH)
  const [expandedScenes, setExpandedScenes] = useState(new Set())

  // ── Nested-shot multi-select ──
  const [selectedNestedShots, setSelectedNestedShots] = useState(new Set())
  function toggleNestedShot(id) { setSelectedNestedShots(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  function clearNestedSelection() { setSelectedNestedShots(new Set()) }
  function bulkUpdateNestedShots(patch) { for (const id of selectedNestedShots) ctx?.updateShot?.(id, patch); clearNestedSelection() }
  function bulkDeleteNestedShots() {
    if (!window.confirm(`Delete ${selectedNestedShots.size} shot${selectedNestedShots.size === 1 ? '' : 's'}?`)) return
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
    if (!window.confirm(`Delete ${selected.size} scene${selected.size === 1 ? '' : 's'} and their shots?`)) return
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

  if (scenes.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-[12.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
          No scenes yet
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      {/* Header */}
      <div className="relative flex items-center gap-3 px-3 py-1.5" style={{ borderBottom: '1px solid #44403c' }}>
        <span className="w-7 flex items-center justify-center cursor-pointer" onClick={toggleAll}>
          {allSelected ? <CheckSquare className="w-3 h-3" style={{ color: '#fb923c' }} />
           : someSelected ? <MinusSquare className="w-3 h-3" style={{ color: '#fb923c' }} />
           : <Square className="w-3 h-3" style={{ color: '#57534e' }} />}
        </span>
        <span className="w-7" />
        <span style={{ width: tw }} className="text-[10.5px] font-mono uppercase tracking-widest text-center flex-shrink-0" />
        <span className="w-14 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>#</span>
        <span className="w-48 text-[10.5px] font-mono uppercase tracking-widest flex-shrink-0" style={{ color: '#78716c' }}>Name</span>
        <span className="w-36 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Status</span>
        <span className="w-28 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Time of Day</span>
        <span className="w-20 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Type</span>
        <span className="flex-1 text-[10.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Description</span>
        <span className="w-28 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Runtime</span>
        <span className="w-20 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Frames</span>
        <span className="w-14" />

        {/* Bulk action bar */}
        {someSelected && (
          <div className="absolute top-0 z-20 flex items-center gap-3 h-full px-3 rounded-sm"
            style={{ left: 28, backgroundColor: '#292524', border: '1px solid #ea580c', width: 'fit-content' }}>
            <span className="text-[10.5px] font-mono font-bold flex-shrink-0" style={{ color: '#fb923c' }}>{selected.size} selected</span>
            <div style={{ width: 1, height: 14, backgroundColor: '#44403c' }} />
            <SceneBulkSelect label="Status" options={SCENE_STATUSES} onPick={v => bulkUpdate({ status: v })} />
            <SceneBulkSelect label="Type" options={SCENE_TYPES} onPick={v => bulkUpdate({ type: v })} />
            <div style={{ width: 1, height: 14, backgroundColor: '#44403c' }} />
            <button type="button" onClick={bulkDelete} className="flex items-center gap-1 px-2 py-0.5 rounded-sm hover:bg-red-900/40 transition-colors" style={{ color: '#fca5a5' }}>
              <Trash2 className="w-3 h-3" /> <span className="text-[9.5px] font-mono uppercase">Delete</span>
            </button>
            <button type="button" onClick={clearSelection} className="p-0.5 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Rows */}
      {scenes.map(sc => {
        const sceneShots = shotsByScene[sc.id] || []
        const expanded = expandedScenes.has(sc.id)
        const totals = sceneTotals[sc.id] || { totalFrames: 0, runtime: '00:00:00:00' }
        const isChecked = selected.has(sc.id)
        return (
          <div key={sc.id}>
            <div
              className="flex items-center gap-3 px-3 rounded-sm transition-colors hover:bg-stone-800 cursor-pointer group"
              style={{
                backgroundColor: isChecked ? 'rgba(234, 88, 12, 0.1)' : '#1c1917',
                border: `1px solid ${isChecked ? '#ea580c' : '#44403c'}`,
                minHeight: rowH + 8,
              }}
            >
              {/* Checkbox */}
              <span className="w-7 flex items-center justify-center cursor-pointer flex-shrink-0"
                onClick={e => { e.stopPropagation(); toggleOne(sc.id) }}>
                {isChecked
                  ? <CheckSquare className="w-3 h-3" style={{ color: '#fb923c' }} />
                  : <Square className="w-3 h-3" style={{ color: '#57534e' }} />}
              </span>

              {/* Expand toggle */}
              <button type="button" onClick={e => { e.stopPropagation(); toggleExpand(sc.id) }}
                className="w-7 flex items-center justify-center flex-shrink-0 p-1 -m-1 rounded hover:bg-stone-700/50 transition-colors"
                style={{ color: '#78716c' }}>
                {sceneShots.length > 0 ? (
                  expanded
                    ? <ChevronDown className="w-4 h-4" />
                    : <ChevronRight className="w-4 h-4" />
                ) : (
                  <span className="w-4 h-4" />
                )}
              </button>

              {/* Thumbnail */}
              <div className="flex items-center justify-center rounded-sm overflow-hidden flex-shrink-0 relative group/scthumb cursor-pointer"
                style={{ width: tw, height: rowH, backgroundColor: '#0c0a09', border: '1px solid #292524' }}
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
                    <img src={`/api/rabbit/projects/${ctx?.project?.id}/scenes/${sc.id}/thumbnail?r=${thumbRevision}`}
                      alt="" style={{ width: tw, height: rowH, objectFit: 'cover', display: 'block' }} />
                    <div className="absolute inset-0 opacity-0 group-hover/scthumb:opacity-100 transition-opacity flex items-center justify-center"
                      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                      <ImagePlus className="w-3.5 h-3.5" style={{ color: '#d6d3d1' }} />
                    </div>
                  </>
                ) : (
                  <>
                    <Film className="w-4 h-4 group-hover/scthumb:opacity-0 transition-opacity" style={{ color: '#292524' }} />
                    <ImagePlus className="w-3.5 h-3.5 absolute opacity-0 group-hover/scthumb:opacity-100 transition-opacity" style={{ color: '#57534e' }} />
                  </>
                )}
              </div>

              {/* Scene # */}
              <span className="w-14 text-[11.5px] font-mono text-center flex-shrink-0" style={{ color: '#78716c' }}>
                {sc.scene_number ?? '—'}
              </span>

              {/* Name */}
              <div className="w-48 min-w-0 flex-shrink-0" onClick={() => onOpenDetail(sc.id)}>
                <InlineText
                  value={sc.name || ''}
                  placeholder="Untitled scene"
                  color="#fb923c"
                  onCommit={v => ctx?.updateScene?.(sc.id, { name: v })}
                />
              </div>

              {/* Status */}
              <span className="w-36 flex justify-center flex-shrink-0" onClick={e => e.stopPropagation()}>
                <select
                  value={sc.status || 'not_started'}
                  onChange={e => ctx?.updateScene?.(sc.id, { status: e.target.value })}
                  className="w-full px-1 py-0.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                  style={{
                    color: statusColor(sc.status),
                    backgroundColor: 'rgba(0,0,0,0.3)',
                    border: `1px solid ${statusColor(sc.status)}30`,
                  }}
                >
                  {SCENE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
                </select>
              </span>

              {/* Time of Day */}
              <span className="w-28 flex justify-center flex-shrink-0" onClick={e => e.stopPropagation()}>
                <select
                  value={sc.time_of_day || ''}
                  onChange={e => ctx?.updateScene?.(sc.id, { time_of_day: e.target.value || null })}
                  className="w-full px-1 py-0.5 text-[10.5px] font-mono uppercase rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                  style={{ color: sc.time_of_day ? '#a8a29e' : '#44403c', border: '1px solid transparent' }}
                  onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                  onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}
                >
                  <option value="">—</option>
                  {TIME_OF_DAY_OPTIONS.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                </select>
              </span>

              {/* Type */}
              <span className="w-20 flex justify-center flex-shrink-0" onClick={e => e.stopPropagation()}>
                <select
                  value={sc.type || 'interior'}
                  onChange={e => ctx?.updateScene?.(sc.id, { type: e.target.value })}
                  className="w-full px-1 py-0.5 text-[10.5px] font-mono uppercase rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                  style={{ color: '#a8a29e', border: '1px solid transparent' }}
                  onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                  onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}
                >
                  {SCENE_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                </select>
              </span>

              {/* Description */}
              <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                <InlineText
                  value={sc.description || ''}
                  placeholder="Add description…"
                  size="sm"
                  onCommit={v => ctx?.updateScene?.(sc.id, { description: v })}
                />
              </div>

              {/* Runtime */}
              <span className="w-28 text-[12.5px] font-mono text-center tabular-nums flex-shrink-0" style={{ color: totals.totalFrames > 0 ? '#d6d3d1' : '#44403c' }}>
                {totals.runtime}
              </span>

              {/* Frame count */}
              <span className="w-20 text-[12.5px] font-mono text-center tabular-nums flex-shrink-0" style={{ color: totals.totalFrames > 0 ? '#d6d3d1' : '#44403c' }}>
                {fmtNumber(totals.totalFrames)}
              </span>

              {/* Actions */}
              <span className="w-14 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button type="button" onClick={e => { e.stopPropagation(); onOpenDetail(sc.id) }}
                  className="p-1 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e' }} title="View details">
                  <Eye className="w-3 h-3" />
                </button>
                <button type="button" onClick={e => { e.stopPropagation(); onRequestDelete({ type: 'scene', id: sc.id, name: sc.name || 'Untitled' }) }}
                  className="p-1 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#ef4444' }} title="Delete scene">
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            </div>

            {/* Nested shots */}
            {expanded && (
              <div className="ml-7 flex flex-col gap-0.5 mt-0.5 mb-1 relative">
                {/* Nested-shot bulk action bar */}
                {(() => {
                  const sceneShotIds = sceneShots.map(s => s.id)
                  const selInScene = sceneShotIds.filter(id => selectedNestedShots.has(id))
                  if (selInScene.length === 0) return null
                  return (
                    <div className="sticky top-0 z-20 flex items-center gap-3 px-3 py-1.5 rounded-sm mb-0.5"
                      style={{ backgroundColor: '#292524', border: '1px solid #fb923c' }}>
                      <span className="text-[10.5px] font-mono font-bold" style={{ color: '#fb923c' }}>
                        {selInScene.length} selected
                      </span>
                      <SceneBulkSelect label="Status" options={SCENE_STATUSES} onPick={v => bulkUpdateNestedShots({ status: v })} />
                      <SceneBulkSelect label="Type" options={SCENE_TYPES} onPick={v => bulkUpdateNestedShots({ type: v })} />
                      <SceneBulkSelect label="Time of Day" options={TIME_OF_DAY_OPTIONS} onPick={v => bulkUpdateNestedShots({ time_of_day: v })} />
                      <button type="button" onClick={bulkDeleteNestedShots}
                        className="ml-auto px-2 py-0.5 text-[9.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-red-900/30 transition-colors"
                        style={{ color: '#ef4444', border: '1px solid #ef444440' }}>
                        <Trash2 className="w-3 h-3 inline-block mr-1" /> Delete
                      </button>
                      <button type="button" onClick={clearNestedSelection}
                        className="p-0.5 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e' }}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )
                })()}
                {sceneShots.map(shot => {
                  const isNested = selectedNestedShots.has(shot.id)
                  const shotTakeEntries = takes?.map?.get(shot.id) || []
                  const takeFallback = takes?.supports && !shot.thumbnail_image ? primaryOf(shotTakeEntries)?.file : null
                  const nestedThumbH = Math.max(rowH - 8, 28)
                  return (
                  <div key={shot.id}
                    className="flex items-center gap-3 px-3 py-1.5 rounded-sm hover:bg-stone-800/60 transition-colors group/shot"
                    style={{
                      backgroundColor: isNested ? 'rgba(234, 88, 12, 0.08)' : '#0c0a09',
                      border: `1px solid ${isNested ? '#ea580c' : '#292524'}`,
                    }}>
                    {/* Checkbox */}
                    <span className="flex items-center justify-center cursor-pointer flex-shrink-0"
                      onClick={() => toggleNestedShot(shot.id)}>
                      {isNested
                        ? <CheckSquare className="w-3 h-3" style={{ color: '#fb923c' }} />
                        : <Square className="w-3 h-3" style={{ color: '#57534e' }} />}
                    </span>
                    <Clapperboard className="w-3 h-3 flex-shrink-0" style={{ color: '#57534e' }} />
                    {/* Thumbnail */}
                    <div className="flex items-center justify-center rounded-sm overflow-hidden flex-shrink-0 relative group/shthumb cursor-pointer"
                      style={{ width: thumbW(Math.max(rowH - 8, 28)), height: Math.max(rowH - 8, 28), backgroundColor: '#0c0a09', border: '1px solid #292524' }}
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
                          <img src={`/api/rabbit/projects/${ctx?.project?.id}/shots/${shot.id}/thumbnail?r=${thumbRevision}`}
                            alt="" style={{ width: thumbW(Math.max(rowH - 8, 28)), height: Math.max(rowH - 8, 28), objectFit: 'cover', display: 'block' }} />
                          <div className="absolute inset-0 opacity-0 group-hover/shthumb:opacity-100 transition-opacity flex items-center justify-center"
                            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                            <ImagePlus className="w-3 h-3" style={{ color: '#d6d3d1' }} />
                          </div>
                        </>
                      ) : takeFallback ? (
                        <>
                          {/* The primary take's poster stands in for an empty thumbnail (Q6); clicking still picks an image of her own. */}
                          <BinPoster row={takeFallback} src={takes.thumbUrlFor?.(takeFallback.id)} width={thumbW(nestedThumbH)} height={nestedThumbH} radius={0} style={{ border: 'none' }} />
                          <div className="absolute inset-0 opacity-0 group-hover/shthumb:opacity-100 transition-opacity flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} title="From the primary take. Click to set a thumbnail of your own.">
                            <ImagePlus className="w-3 h-3" style={{ color: '#d6d3d1' }} />
                          </div>
                        </>
                      ) : (
                        <>
                          <Clapperboard className="w-3 h-3 group-hover/shthumb:opacity-0 transition-opacity" style={{ color: '#292524' }} />
                          <ImagePlus className="w-3 h-3 absolute opacity-0 group-hover/shthumb:opacity-100 transition-opacity" style={{ color: '#57534e' }} />
                        </>
                      )}
                    </div>
                    {/* Shot # */}
                    <span className="w-10 text-[11.5px] font-mono text-center flex-shrink-0" style={{ color: '#57534e' }}>
                      {shot.shot_number ?? '—'}
                    </span>
                    {/* Name */}
                    <div className="w-40 min-w-0 flex-shrink-0">
                      <InlineText value={shot.name || ''} placeholder="Untitled shot" size="sm"
                        onCommit={v => ctx?.updateShot?.(shot.id, { name: v })} />
                    </div>
                    {/* Takes (milestone 2) */}
                    {takes?.supports && (
                      <span className="w-40 flex items-center flex-shrink-0 overflow-hidden" onClick={e => e.stopPropagation()}>
                        <ShotTakeChips entries={shotTakeEntries} thumbUrlFor={takes.thumbUrlFor} height={Math.min(nestedThumbH, 22)} max={3}
                          canWrite={takes.canWrite} onOpen={() => takes.open(shot.id)} />
                      </span>
                    )}
                    {/* Status */}
                    <span className="w-36 flex justify-center flex-shrink-0">
                      <select value={shot.status || 'not_started'} onChange={e => ctx?.updateShot?.(shot.id, { status: e.target.value })}
                        className="w-full px-1 py-0.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                        style={{ color: statusColor(shot.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(shot.status)}30` }}>
                        {SCENE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
                      </select>
                    </span>
                    {/* Time of Day */}
                    <span className="w-28 flex justify-center flex-shrink-0">
                      <select value={shot.time_of_day || ''} onChange={e => ctx?.updateShot?.(shot.id, { time_of_day: e.target.value || null })}
                        className="w-full px-1 py-0.5 text-[10.5px] font-mono uppercase rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                        style={{ color: shot.time_of_day ? '#a8a29e' : '#44403c', border: '1px solid transparent' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}>
                        <option value="">—</option>
                        {TIME_OF_DAY_OPTIONS.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                      </select>
                    </span>
                    {/* Type */}
                    <span className="w-20 flex justify-center flex-shrink-0">
                      <select value={shot.type || 'other'} onChange={e => ctx?.updateShot?.(shot.id, { type: e.target.value })}
                        className="w-full px-1 py-0.5 text-[10.5px] font-mono uppercase rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                        style={{ color: '#78716c', border: '1px solid transparent' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}>
                        {SCENE_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                      </select>
                    </span>
                    {/* Framing */}
                    <span className="w-20 flex justify-center flex-shrink-0 relative">
                      <span className="absolute inset-0 flex items-center px-1.5 text-[10.5px] font-mono uppercase pointer-events-none z-[1]"
                        style={{ color: shot.framing ? '#a8a29e' : '#44403c' }}>
                        <span className="flex-1 text-center">{shot.framing || '—'}</span>
                        <ChevronDown className="w-3 h-3 flex-shrink-0 ml-0.5" style={{ color: '#57534e' }} />
                      </span>
                      <select value={shot.framing || ''} onChange={e => ctx?.updateShot?.(shot.id, { framing: e.target.value || null })}
                        className="w-full px-1 py-0.5 text-[10.5px] font-mono rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer appearance-none"
                        style={{ color: 'transparent', border: '1px solid transparent' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}>
                        <option value="">—</option>
                        {FRAMING_OPTIONS.map(f => <option key={f.abbr} value={f.abbr}>{f.label}</option>)}
                      </select>
                    </span>
                    {/* Camera Movement */}
                    <span className="w-28 flex justify-center flex-shrink-0">
                      <select value={shot.camera_movement || ''} onChange={e => ctx?.updateShot?.(shot.id, { camera_movement: e.target.value || null })}
                        className="w-full px-1 py-0.5 text-[10.5px] font-mono uppercase rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                        style={{ color: shot.camera_movement ? '#a8a29e' : '#44403c', border: '1px solid transparent' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}>
                        <option value="">—</option>
                        {CAMERA_MOVEMENT_OPTIONS.map(c => <option key={c.abbr} value={c.abbr}>{c.abbr}</option>)}
                      </select>
                    </span>
                    {/* Description */}
                    <div className="flex-1 min-w-0">
                      <InlineText value={shot.description || ''} placeholder="Add description…" size="sm"
                        onCommit={v => ctx?.updateShot?.(shot.id, { description: v })} />
                    </div>
                    {/* Duration */}
                    <span className="w-28 text-[12.5px] font-mono text-center tabular-nums flex-shrink-0" style={{ color: (shot.frame_count || 0) > 0 ? '#a8a29e' : '#44403c' }}>
                      {framesToTimecode(shot.frame_count || 0, fps)}
                    </span>
                    {/* Frames */}
                    <span className="w-20 flex justify-center flex-shrink-0">
                      <input type="number" min={0} value={shot.frame_count ?? ''}
                        onChange={e => { const n = parseInt(e.target.value, 10); ctx?.updateShot?.(shot.id, { frame_count: Number.isFinite(n) && n >= 0 ? n : 0 }) }}
                        className="w-16 px-1 py-0.5 text-[12.5px] font-mono text-center rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 tabular-nums"
                        style={{ color: '#a8a29e', border: '1px solid transparent' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { if (document.activeElement !== e.target) e.target.style.borderColor = 'transparent' }}
                        onFocus={e => { e.target.style.borderColor = '#44403c' }}
                        onBlur={e => { e.target.style.borderColor = 'transparent' }}
                        placeholder="0" />
                    </span>
                    <span className="w-14 flex items-center justify-end gap-1 opacity-0 group-hover/shot:opacity-100 transition-opacity flex-shrink-0">
                      <button type="button" onClick={() => onOpenShotDetail(shot.id)}
                        className="p-1 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e' }} title="View details">
                        <Eye className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' })}
                        className="p-1 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#ef4444' }} title="Delete shot">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  </div>
                  )
                })}
                {/* Add shot row */}
                <button type="button" onClick={() => onNewShot(sc.id)}
                  className="flex items-center gap-2 px-3 py-1.5 text-[9.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-800/40 transition-colors"
                  style={{ color: '#57534e', border: '1px dashed #292524' }}>
                  <Plus className="w-3 h-3" /> Add shot
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}


// ─── Scene gallery ───
function SceneGallery({ scenes, shotsByScene, sceneTotals, gallerySize, fps, onOpenDetail, onRequestDelete }) {
  const sizeMap = { sm: 160, md: 220, lg: 300 }
  const cardW = sizeMap[gallerySize] || sizeMap.md

  if (scenes.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-[12.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
          No scenes yet
        </span>
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-wrap gap-3">
      {scenes.map(sc => {
        const sceneShots = shotsByScene[sc.id] || []
        const totals = sceneTotals[sc.id] || { totalFrames: 0, runtime: '00:00:00:00' }
        return (
          <div key={sc.id}
            onClick={() => onOpenDetail(sc.id)}
            className="rounded-sm overflow-hidden hover:ring-1 hover:ring-orange-500/40 transition-all cursor-pointer group relative"
            style={{ width: cardW, backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
            {/* Thumbnail placeholder */}
            <div className="flex items-center justify-center relative"
              style={{ height: cardW * 0.5, backgroundColor: '#0c0a09', borderBottom: '1px solid #292524' }}>
              <Film className="w-7 h-7" style={{ color: '#292524' }} />
              {/* Delete button */}
              <button type="button"
                onClick={e => { e.stopPropagation(); onRequestDelete({ type: 'scene', id: sc.id, name: sc.name || 'Untitled' }) }}
                className="absolute top-2 right-2 p-1 rounded-sm opacity-0 group-hover:opacity-100 transition-all hover:bg-red-900/50"
                style={{ color: '#ef4444' }}>
                <Trash2 className="w-3 h-3" />
              </button>
              {/* Status accent bar */}
              <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: statusColor(sc.status) }} />
            </div>
            {/* Info */}
            <div className="px-3 py-2.5 flex flex-col gap-1.5">
              <span className="text-[11.5px] font-mono truncate font-bold" style={{ color: '#d6d3d1' }}>
                {sc.name || 'Untitled scene'}
              </span>
              {sc.description && (
                <span className="text-[9.5px] font-mono truncate" style={{ color: '#57534e' }}>
                  {sc.description}
                </span>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9.5px] font-mono uppercase" style={{ color: '#78716c' }}>
                  {fmt(sc.type || '')}
                </span>
                {sc.time_of_day && (
                  <span className="text-[9.5px] font-mono uppercase" style={{ color: '#78716c' }}>
                    {fmt(sc.time_of_day)}
                  </span>
                )}
                <span className="px-1.5 py-0.5 text-[8.5px] font-mono uppercase tracking-wider rounded-sm"
                  style={{ color: statusColor(sc.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(sc.status)}30` }}>
                  {fmt(sc.status || 'not_started')}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                {sceneShots.length > 0 && (
                  <span className="text-[9.5px] font-mono" style={{ color: '#57534e' }}>
                    {sceneShots.length} shot{sceneShots.length !== 1 ? 's' : ''}
                  </span>
                )}
                {totals.totalFrames > 0 && (
                  <span className="text-[9.5px] font-mono tabular-nums" style={{ color: '#57534e' }}>
                    {totals.runtime}
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}


// ─── Shot table (shots grouped by scene) ───
function ShotTable({ shotGroups, ctx, takes, fps, thumbSize, thumbRevision = 0, onThumbChanged, onOpenSceneDetail, onOpenShotDetail, onNewShot, onRequestDelete }) {
  const rowH = THUMB_SIZES[thumbSize]?.h || BASE_ROW_H
  const tw = thumbW(rowH)
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())

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
    if (!window.confirm(`Delete ${selected.size} shot${selected.size === 1 ? '' : 's'}?`)) return
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

  if (shotGroups.length === 0 || shotGroups.every(g => g.shots.length === 0)) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-[12.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
          No shots yet — create a scene first, then add shots
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      {/* Column header */}
      <div className="relative flex items-center gap-3 px-3 py-1.5" style={{ borderBottom: '1px solid #44403c' }}>
        <span className="w-7 flex items-center justify-center cursor-pointer" onClick={toggleAll}>
          {allSelected ? <CheckSquare className="w-3 h-3" style={{ color: '#fb923c' }} />
           : someSelected ? <MinusSquare className="w-3 h-3" style={{ color: '#fb923c' }} />
           : <Square className="w-3 h-3" style={{ color: '#57534e' }} />}
        </span>
        <span style={{ width: tw }} className="flex-shrink-0" />
        <span className="w-14 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>#</span>
        <span className="w-48 text-[10.5px] font-mono uppercase tracking-widest flex-shrink-0" style={{ color: '#78716c' }}>Shot name</span>
        {takes?.supports && <span className="w-44 text-[10.5px] font-mono uppercase tracking-widest flex-shrink-0" style={{ color: '#78716c' }} title="Bin files assigned to the shot; the starred one is the primary take">Takes</span>}
        <span className="w-36 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Status</span>
        <span className="w-28 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Time of Day</span>
        <span className="w-20 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Type</span>
        <span className="w-20 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Framing</span>
        <span className="w-28 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Cam Move</span>
        <span className="flex-1 text-[10.5px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>Description</span>
        <span className="w-28 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Duration</span>
        <span className="w-20 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Frames</span>
        <span className="w-24 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>Start</span>
        <span className="w-24 text-[10.5px] font-mono uppercase tracking-widest text-center" style={{ color: '#78716c' }}>End</span>
        <span className="w-14" />

        {/* Bulk action bar */}
        {someSelected && (
          <div className="absolute top-0 z-20 flex items-center gap-3 h-full px-3 rounded-sm"
            style={{ left: 28, backgroundColor: '#292524', border: '1px solid #ea580c', width: 'fit-content' }}>
            <span className="text-[10.5px] font-mono font-bold flex-shrink-0" style={{ color: '#fb923c' }}>{selected.size} selected</span>
            <div style={{ width: 1, height: 14, backgroundColor: '#44403c' }} />
            <SceneBulkSelect label="Status" options={SCENE_STATUSES} onPick={v => bulkUpdate({ status: v })} />
            <SceneBulkSelect label="Type" options={SCENE_TYPES} onPick={v => bulkUpdate({ type: v })} />
            <SceneBulkSelect label="Time of Day" options={TIME_OF_DAY_OPTIONS} onPick={v => bulkUpdate({ time_of_day: v })} />
            <div style={{ width: 1, height: 14, backgroundColor: '#44403c' }} />
            <button type="button" onClick={bulkDelete} className="flex items-center gap-1 px-2 py-0.5 rounded-sm hover:bg-red-900/40 transition-colors" style={{ color: '#fca5a5' }}>
              <Trash2 className="w-3 h-3" /> <span className="text-[9.5px] font-mono uppercase">Delete</span>
            </button>
            <button type="button" onClick={clearSelection} className="p-0.5 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {shotGroups.map(g => {
        const isGrouped = g.groupType !== 'none'
        const collapsed = isGrouped && collapsedGroups.has(g.key)
        const groupFrames = g.shots.reduce((s, sh) => s + (Number(sh.frame_count) || 0), 0)
        return (
          <div key={g.key}>
            {/* Group header (skip for ungrouped) */}
            {g.groupType === 'scene' && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-sm cursor-pointer hover:bg-stone-800/30 transition-colors"
                style={{ backgroundColor: '#292524', borderLeft: `3px solid ${g.scene ? statusColor(g.scene.status) : '#57534e'}` }}
                onClick={() => toggleGroup(g.key)}
              >
                {collapsed
                  ? <ChevronRight className="w-4 h-4" style={{ color: '#78716c' }} />
                  : <ChevronDown className="w-4 h-4" style={{ color: '#78716c' }} />}
                <Film className="w-3 h-3" style={{ color: '#fb923c' }} />
                <span className="text-[10.5px] font-mono font-bold truncate" style={{ color: '#fb923c' }}>
                  {g.label}
                </span>
                <span className="text-[9.5px] font-mono" style={{ color: '#78716c' }}>
                  ({g.shots.length} shot{g.shots.length !== 1 ? 's' : ''})
                </span>
                {groupFrames > 0 && (
                  <span className="text-[9.5px] font-mono tabular-nums ml-auto mr-2" style={{ color: '#57534e' }}>
                    {framesToTimecode(groupFrames, fps)} · {fmtNumber(groupFrames)} frames
                  </span>
                )}
                {g.scene && (
                  <button type="button"
                    onClick={e => { e.stopPropagation(); onOpenSceneDetail(g.sceneId) }}
                    className="p-1 rounded-sm hover:bg-stone-700 transition-colors flex-shrink-0" style={{ color: '#a8a29e' }} title="Scene details">
                    <Eye className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
            {g.groupType === 'field' && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-sm cursor-pointer hover:bg-stone-800/30 transition-colors"
                style={{ backgroundColor: '#292524', borderLeft: '3px solid #78716c' }}
                onClick={() => toggleGroup(g.key)}
              >
                {collapsed
                  ? <ChevronRight className="w-4 h-4" style={{ color: '#78716c' }} />
                  : <ChevronDown className="w-4 h-4" style={{ color: '#78716c' }} />}
                <Layers className="w-3 h-3" style={{ color: '#a8a29e' }} />
                <span className="text-[10.5px] font-mono font-bold truncate" style={{ color: '#a8a29e' }}>
                  {g.label}
                </span>
                <span className="text-[9.5px] font-mono" style={{ color: '#78716c' }}>
                  ({g.shots.length} shot{g.shots.length !== 1 ? 's' : ''})
                </span>
                {groupFrames > 0 && (
                  <span className="text-[9.5px] font-mono tabular-nums ml-auto mr-2" style={{ color: '#57534e' }}>
                    {framesToTimecode(groupFrames, fps)} · {fmtNumber(groupFrames)} frames
                  </span>
                )}
              </div>
            )}

            {/* Shot rows */}
            {!collapsed && (
              <div className="flex flex-col gap-0.5 mt-0.5">
                {g.shots.map(shot => {
                  const isChecked = selected.has(shot.id)
                  const shotTakeEntries = takes?.map?.get(shot.id) || []
                  const takeFallback = takes?.supports && !shot.thumbnail_image ? primaryOf(shotTakeEntries)?.file : null
                  return (
                  <div key={shot.id}
                    className="flex items-center gap-3 px-3 rounded-sm hover:bg-stone-800 transition-colors group"
                    style={{
                      backgroundColor: isChecked ? 'rgba(234, 88, 12, 0.1)' : '#1c1917',
                      border: `1px solid ${isChecked ? '#ea580c' : '#44403c'}`,
                      minHeight: rowH + 8,
                    }}>
                    {/* Checkbox */}
                    <span className="w-7 flex items-center justify-center cursor-pointer flex-shrink-0"
                      onClick={() => toggleOne(shot.id)}>
                      {isChecked
                        ? <CheckSquare className="w-3 h-3" style={{ color: '#fb923c' }} />
                        : <Square className="w-3 h-3" style={{ color: '#57534e' }} />}
                    </span>

                    {/* Thumbnail */}
                    <div className="flex items-center justify-center rounded-sm overflow-hidden flex-shrink-0 relative group/stthumb cursor-pointer"
                      style={{ width: tw, height: rowH, backgroundColor: '#0c0a09', border: '1px solid #292524' }}
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
                          <img src={`/api/rabbit/projects/${ctx?.project?.id}/shots/${shot.id}/thumbnail?r=${thumbRevision}`}
                            alt="" style={{ width: tw, height: rowH, objectFit: 'cover', display: 'block' }} />
                          <div className="absolute inset-0 opacity-0 group-hover/stthumb:opacity-100 transition-opacity flex items-center justify-center"
                            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                            <ImagePlus className="w-3.5 h-3.5" style={{ color: '#d6d3d1' }} />
                          </div>
                        </>
                      ) : takeFallback ? (
                        <>
                          {/* The primary take's poster stands in for an empty thumbnail (Q6); clicking still picks an image of her own. */}
                          <BinPoster row={takeFallback} src={takes.thumbUrlFor?.(takeFallback.id)} width={tw} height={rowH} radius={0} style={{ border: 'none' }} />
                          <div className="absolute inset-0 opacity-0 group-hover/stthumb:opacity-100 transition-opacity flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} title="From the primary take. Click to set a thumbnail of your own.">
                            <ImagePlus className="w-3.5 h-3.5" style={{ color: '#d6d3d1' }} />
                          </div>
                        </>
                      ) : (
                        <>
                          <Clapperboard className="w-4 h-4 group-hover/stthumb:opacity-0 transition-opacity" style={{ color: '#292524' }} />
                          <ImagePlus className="w-3.5 h-3.5 absolute opacity-0 group-hover/stthumb:opacity-100 transition-opacity" style={{ color: '#57534e' }} />
                        </>
                      )}
                    </div>

                    {/* Shot # */}
                    <span className="w-14 text-[11.5px] font-mono text-center flex-shrink-0" style={{ color: '#78716c' }}>
                      {shot.shot_number ?? '—'}
                    </span>

                    {/* Name */}
                    <div className="w-48 min-w-0 flex-shrink-0">
                      <InlineText
                        value={shot.name || ''}
                        placeholder="Untitled shot"
                        onCommit={v => ctx?.updateShot?.(shot.id, { name: v })}
                      />
                    </div>

                    {/* Takes (milestone 2) */}
                    {takes?.supports && (
                      <span className="w-44 flex items-center flex-shrink-0 overflow-hidden" onClick={e => e.stopPropagation()}>
                        <ShotTakeChips entries={shotTakeEntries} thumbUrlFor={takes.thumbUrlFor} height={Math.min(rowH, 26)} max={3}
                          canWrite={takes.canWrite} onOpen={() => takes.open(shot.id)} />
                      </span>
                    )}

                    {/* Status */}
                    <span className="w-36 flex justify-center flex-shrink-0">
                      <select
                        value={shot.status || 'not_started'}
                        onChange={e => ctx?.updateShot?.(shot.id, { status: e.target.value })}
                        className="w-full px-1 py-0.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                        style={{
                          color: statusColor(shot.status),
                          backgroundColor: 'rgba(0,0,0,0.3)',
                          border: `1px solid ${statusColor(shot.status)}30`,
                        }}>
                        {SCENE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
                      </select>
                    </span>

                    {/* Time of Day */}
                    <span className="w-28 flex justify-center flex-shrink-0">
                      <select
                        value={shot.time_of_day || ''}
                        onChange={e => ctx?.updateShot?.(shot.id, { time_of_day: e.target.value || null })}
                        className="w-full px-1 py-0.5 text-[10.5px] font-mono uppercase rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                        style={{ color: shot.time_of_day ? '#a8a29e' : '#44403c', border: '1px solid transparent' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}>
                        <option value="">—</option>
                        {TIME_OF_DAY_OPTIONS.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                      </select>
                    </span>

                    {/* Type */}
                    <span className="w-20 flex justify-center flex-shrink-0">
                      <select
                        value={shot.type || 'other'}
                        onChange={e => ctx?.updateShot?.(shot.id, { type: e.target.value })}
                        className="w-full px-1 py-0.5 text-[10.5px] font-mono uppercase rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                        style={{ color: '#a8a29e', border: '1px solid transparent' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}>
                        {SCENE_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                      </select>
                    </span>

                    {/* Framing */}
                    <span className="w-20 flex justify-center flex-shrink-0 relative">
                      <span className="absolute inset-0 flex items-center px-1.5 text-[10.5px] font-mono uppercase pointer-events-none z-[1]"
                        style={{ color: shot.framing ? '#a8a29e' : '#44403c' }}>
                        <span className="flex-1 text-center">{shot.framing || '—'}</span>
                        <ChevronDown className="w-3 h-3 flex-shrink-0 ml-0.5" style={{ color: '#57534e' }} />
                      </span>
                      <select
                        value={shot.framing || ''}
                        onChange={e => ctx?.updateShot?.(shot.id, { framing: e.target.value || null })}
                        className="w-full px-1 py-0.5 text-[10.5px] font-mono rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer appearance-none"
                        style={{ color: 'transparent', border: '1px solid transparent' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}>
                        <option value="">—</option>
                        {FRAMING_OPTIONS.map(f => <option key={f.abbr} value={f.abbr}>{f.label}</option>)}
                      </select>
                    </span>

                    {/* Camera Movement */}
                    <span className="w-28 flex justify-center flex-shrink-0">
                      <select
                        value={shot.camera_movement || ''}
                        onChange={e => ctx?.updateShot?.(shot.id, { camera_movement: e.target.value || null })}
                        className="w-full px-1 py-0.5 text-[10.5px] font-mono uppercase rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                        style={{ color: shot.camera_movement ? '#a8a29e' : '#44403c', border: '1px solid transparent' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}>
                        <option value="">—</option>
                        {CAMERA_MOVEMENT_OPTIONS.map(c => <option key={c.abbr} value={c.abbr}>{c.abbr}</option>)}
                      </select>
                    </span>

                    {/* Description */}
                    <div className="flex-1 min-w-0">
                      <InlineText
                        value={shot.description || ''}
                        placeholder="Add description…"
                        size="sm"
                        onCommit={v => ctx?.updateShot?.(shot.id, { description: v })}
                      />
                    </div>

                    {/* Duration (derived) */}
                    <span className="w-28 text-[12.5px] font-mono text-center tabular-nums flex-shrink-0" style={{ color: (shot.frame_count || 0) > 0 ? '#d6d3d1' : '#44403c' }}>
                      {framesToTimecode(shot.frame_count || 0, fps)}
                    </span>

                    {/* Frame count (editable) */}
                    <span className="w-20 flex justify-center flex-shrink-0">
                      <input
                        type="number"
                        min={0}
                        value={shot.frame_count ?? ''}
                        onChange={e => {
                          const n = parseInt(e.target.value, 10)
                          ctx?.updateShot?.(shot.id, { frame_count: Number.isFinite(n) && n >= 0 ? n : 0 })
                        }}
                        className="w-16 px-1 py-0.5 text-[12.5px] font-mono text-center rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 tabular-nums"
                        style={{ color: '#a8a29e', border: '1px solid transparent' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { if (document.activeElement !== e.target) e.target.style.borderColor = 'transparent' }}
                        onFocus={e => { e.target.style.borderColor = '#44403c' }}
                        onBlur={e => { e.target.style.borderColor = 'transparent' }}
                        placeholder="0"
                      />
                    </span>

                    {/* Start date */}
                    <span className="w-24 flex justify-center flex-shrink-0">
                      <input
                        type="date"
                        value={shot.start_date || ''}
                        onChange={e => ctx?.updateShot?.(shot.id, { start_date: e.target.value || null })}
                        className="px-1 py-0.5 text-[10.5px] font-mono rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500"
                        style={{ color: '#a8a29e', border: '1px solid transparent', colorScheme: 'dark' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}
                      />
                    </span>

                    {/* End date */}
                    <span className="w-24 flex justify-center flex-shrink-0">
                      <input
                        type="date"
                        value={shot.end_date || ''}
                        onChange={e => ctx?.updateShot?.(shot.id, { end_date: e.target.value || null })}
                        className="px-1 py-0.5 text-[10.5px] font-mono rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500"
                        style={{ color: '#a8a29e', border: '1px solid transparent', colorScheme: 'dark' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}
                      />
                    </span>

                    {/* Actions */}
                    <span className="w-14 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button type="button" onClick={() => onOpenShotDetail(shot.id)}
                        className="p-1 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e' }} title="View details">
                        <Eye className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' })}
                        className="p-1 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#ef4444' }} title="Delete shot">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  </div>
                  )
                })}

                {/* Add shot row */}
                {g.scene && (
                  <button type="button" onClick={() => onNewShot(g.sceneId)}
                    className="flex items-center gap-2 px-3 py-1.5 text-[9.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-800/40 transition-colors"
                    style={{ color: '#57534e', border: '1px dashed #292524' }}>
                    <Plus className="w-3 h-3" /> Add shot
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}


// ─── Shot gallery (shot cards grouped by scene) ───
function ShotGallery({ shotGroups, gallerySize, fps, ctx, takes, thumbRevision = 0, onOpenSceneDetail, onOpenShotDetail, onRequestDelete }) {
  const sizeMap = { sm: 160, md: 220, lg: 300 }
  const cardW = sizeMap[gallerySize] || sizeMap.md

  if (shotGroups.length === 0 || shotGroups.every(g => g.shots.length === 0)) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-[12.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
          No shots yet
        </span>
      </div>
    )
  }

  return (
    <div className="p-4">
      {shotGroups.map(g => {
        const groupFrames = g.shots.reduce((s, sh) => s + (Number(sh.frame_count) || 0), 0)
        return (
          <div key={g.sceneId} className="mb-5 last:mb-0">
            {/* Scene group header */}
            <div className="flex items-center gap-2 mb-3">
              <Film className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
              <span className="text-[10.5px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
                {g.label}
              </span>
              <span className="text-[9.5px] font-mono" style={{ color: '#57534e' }}>
                {g.shots.length} shot{g.shots.length !== 1 ? 's' : ''}
              </span>
              {groupFrames > 0 && (
                <span className="text-[9.5px] font-mono tabular-nums" style={{ color: '#57534e' }}>
                  · {framesToTimecode(groupFrames, fps)}
                </span>
              )}
              {g.scene && (
                <button type="button"
                  onClick={() => onOpenSceneDetail(g.sceneId)}
                  className="p-1 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#78716c' }} title="Scene details">
                  <Eye className="w-3 h-3" />
                </button>
              )}
              <div className="flex-1 h-px ml-2" style={{ backgroundColor: '#292524' }} />
            </div>

            {/* Shot cards */}
            <div className="flex flex-wrap gap-3">
              {g.shots.map(shot => {
                const shotTakeEntries = takes?.map?.get(shot.id) || []
                const takeFallback = takes?.supports && !shot.thumbnail_image ? primaryOf(shotTakeEntries)?.file : null
                const cardH = Math.round(cardW * 9 / 16)
                return (
                <div key={shot.id}
                  className="rounded-sm overflow-hidden hover:ring-1 hover:ring-orange-500/40 transition-all cursor-pointer group relative"
                  style={{ width: cardW, backgroundColor: '#1c1917', border: '1px solid #44403c' }}
                  onClick={() => onOpenShotDetail?.(shot.id)}
                >
                  {/* Thumbnail (16:9): her own, else the primary take's poster (milestone 2, Q6), else the placeholder */}
                  <div className="flex items-center justify-center relative"
                    style={{ height: cardH, backgroundColor: '#0c0a09', borderBottom: '1px solid #292524' }}>
                    {shot.thumbnail_image ? (
                      <img src={`/api/rabbit/projects/${ctx?.project?.id}/shots/${shot.id}/thumbnail?r=${thumbRevision}`}
                        alt="" style={{ width: cardW, height: cardH, objectFit: 'cover', display: 'block' }} />
                    ) : takeFallback ? (
                      <BinPoster row={takeFallback} src={takes.thumbUrlFor?.(takeFallback.id)} width={cardW} height={cardH} radius={0} style={{ border: 'none' }} iconSize={28} />
                    ) : (
                      <Clapperboard className="w-6 h-6" style={{ color: '#292524' }} />
                    )}
                    <button type="button"
                      onClick={e => { e.stopPropagation(); onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' }) }}
                      className="absolute top-2 right-2 p-1 rounded-sm opacity-0 group-hover:opacity-100 transition-all hover:bg-red-900/50"
                      style={{ color: '#ef4444' }}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: statusColor(shot.status) }} />
                  </div>
                  {/* Info */}
                  <div className="px-3 py-2.5 flex flex-col gap-1">
                    <span className="text-[11.5px] font-mono truncate font-bold" style={{ color: '#d6d3d1' }}>
                      {shot.name || 'Untitled shot'}
                    </span>
                    {shot.description && (
                      <span className="text-[9.5px] font-mono truncate" style={{ color: '#57534e' }}>
                        {shot.description}
                      </span>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9.5px] font-mono" style={{ color: '#78716c' }}>
                        #{shot.shot_number ?? '—'}
                      </span>
                      <span className="px-1.5 py-0.5 text-[8.5px] font-mono uppercase tracking-wider rounded-sm"
                        style={{ color: statusColor(shot.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(shot.status)}30` }}>
                        {fmt(shot.status || 'not_started')}
                      </span>
                    </div>
                    {(shot.frame_count || 0) > 0 && (
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9.5px] font-mono tabular-nums" style={{ color: '#57534e' }}>
                          {framesToTimecode(shot.frame_count, fps)}
                        </span>
                        <span className="text-[9.5px] font-mono tabular-nums" style={{ color: '#44403c' }}>
                          {fmtNumber(shot.frame_count)} fr
                        </span>
                      </div>
                    )}
                    {takes?.supports && (
                      <div className="mt-1" onClick={e => e.stopPropagation()}>
                        <ShotTakeChips entries={shotTakeEntries} thumbUrlFor={takes.thumbUrlFor} height={20} max={4}
                          canWrite={takes.canWrite} onOpen={() => takes.open(shot.id)} />
                      </div>
                    )}
                  </div>
                </div>
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
          className="pointer-events-auto w-full max-w-4xl rounded-sm overflow-hidden flex flex-col"
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
            <span className="text-[14px] font-mono font-bold" style={{ color: '#fb923c' }}>
              {scene.name || 'Untitled scene'}
            </span>
            <span className="text-[10.5px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
              style={{ color: '#78716c', backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              {sceneCode}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded-sm transition-colors" style={{ color: '#a8a29e' }}>
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
            <div className="relative flex-shrink-0 rounded-sm overflow-hidden flex items-center justify-center group/thumb"
              style={{ width: 142, height: 80, backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              {hasThumbnail ? (
                <>
                  <img
                    src={`/api/rabbit/projects/${project?.id}/scenes/${scene.id}/thumbnail?r=${thumbRevision}`}
                    alt="" style={{ width: 142, height: 80, objectFit: 'cover', display: 'block' }} />
                  <div className="absolute inset-0 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center gap-1"
                    style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
                    <button type="button" onClick={handleSetThumbnail}
                      className="p-1.5 rounded hover:bg-stone-700 transition-colors" style={{ color: '#d6d3d1' }}
                      title="Change thumbnail"><ImagePlus className="w-4 h-4" /></button>
                    <button type="button" onClick={handleClearThumbnail}
                      className="p-1.5 rounded hover:bg-stone-700 transition-colors" style={{ color: '#fca5a5' }}
                      title="Remove thumbnail"><ImageOff className="w-4 h-4" /></button>
                  </div>
                </>
              ) : (
                <button type="button" onClick={handleSetThumbnail}
                  className="w-full h-full flex items-center justify-center hover:bg-stone-800 transition-colors"
                  style={{ color: '#57534e' }} title="Set thumbnail">
                  <div className="flex flex-col items-center gap-1 opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                    <ImagePlus className="w-4 h-4" />
                    <span className="text-[8px] font-mono uppercase">Set thumbnail</span>
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
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: sc, border: '1px solid #44403c' }}>
                {SCENE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Type</FieldLabel>
              <select value={scene.type || 'interior'} onChange={e => handleUpdate({ type: e.target.value })}
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}>
                {SCENE_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Time of Day</FieldLabel>
              <select value={scene.time_of_day || ''} onChange={e => handleUpdate({ time_of_day: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
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
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }} />
            </div>
            <div>
              <FieldLabel>Runtime</FieldLabel>
              <div className="px-2.5 py-1.5 text-[11.5px] font-mono tabular-nums rounded-sm"
                style={{ backgroundColor: '#1c1917', color: totals.totalFrames > 0 ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
                {totals.runtime}
              </div>
            </div>
            <div>
              <FieldLabel>Total Frames</FieldLabel>
              <div className="px-2.5 py-1.5 text-[11.5px] font-mono tabular-nums rounded-sm"
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
                <span className="text-[12.5px] font-mono font-bold" style={{ color: '#d6d3d1' }}>
                  {sceneShots.length}
                </span>
                <span className="text-[10.5px] font-mono" style={{ color: '#78716c' }}>
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
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', colorScheme: 'dark' }}
              />
            </div>
            <div>
              <FieldLabel>End Date</FieldLabel>
              <input
                type="date"
                value={scene.end_date || ''}
                onChange={e => handleUpdate({ end_date: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
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
                  className="w-full px-3 py-2 text-[11.5px] font-mono rounded-sm resize-none focus:outline-none focus:ring-1 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', minHeight: 80 }}
                  autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => { handleUpdate({ description: descDraft }); setEditingDesc(false) }}
                    className="text-[10.5px] font-mono uppercase text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button type="button" onClick={() => { setDescDraft(scene.description || ''); setEditingDesc(false) }}
                    className="text-[10.5px] font-mono uppercase text-stone-500 hover:text-stone-400">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingDesc(true)}
                className="px-3 py-2 text-[11.5px] font-mono rounded-sm cursor-pointer hover:bg-stone-800 transition-colors"
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
                  className="w-full px-3 py-2 text-[11.5px] font-mono rounded-sm resize-none focus:outline-none focus:ring-1 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', minHeight: 60 }}
                  autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => { handleUpdate({ notes: notesDraft }); setEditingNotes(false) }}
                    className="text-[10.5px] font-mono uppercase text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button type="button" onClick={() => { setNotesDraft(scene.notes || ''); setEditingNotes(false) }}
                    className="text-[10.5px] font-mono uppercase text-stone-500 hover:text-stone-400">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingNotes(true)}
                className="px-3 py-2 text-[11.5px] font-mono rounded-sm cursor-pointer hover:bg-stone-800 transition-colors"
                style={{ backgroundColor: '#1c1917', color: scene.notes ? '#a8a29e' : '#57534e', border: '1px solid #44403c', minHeight: 40 }}>
                {scene.notes || 'Click to add notes...'}
              </div>
            )}
          </div>

          {/* Folder path */}
          <div className="mb-4">
            <FieldLabel>Folder</FieldLabel>
            <div className="flex items-center gap-2 px-3 py-2 rounded-sm"
              style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#57534e' }} />
              <span className="text-[11.5px] font-mono truncate" style={{ color: '#a8a29e' }}>
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
                className="flex items-center gap-1 px-2.5 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
                style={{ color: '#fb923c', border: '1px solid #44403c' }}>
                <Plus className="w-3 h-3" /> Add shot
              </button>
            </div>
            {sceneShots.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11.5px] font-mono uppercase tracking-wider rounded-sm"
                style={{ color: '#57534e', backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
                No shots yet
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {sceneShots.map(shot => (
                  <div key={shot.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-sm hover:bg-stone-800 transition-colors group/shot cursor-pointer"
                    style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}
                    onClick={() => onOpenShot?.(shot.id)}>
                    <Clapperboard className="w-3 h-3 flex-shrink-0" style={{ color: '#57534e' }} />
                    <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                      <span className="text-[11.5px] font-mono truncate block cursor-pointer" style={{ color: '#d6d3d1' }}
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
                    <span className="text-[9.5px] font-mono flex-shrink-0" style={{ color: '#78716c' }}>
                      #{shot.shot_number ?? '—'}
                    </span>
                    {(shot.frame_count || 0) > 0 && (
                      <span className="text-[9.5px] font-mono tabular-nums flex-shrink-0" style={{ color: '#57534e' }}>
                        {framesToTimecode(shot.frame_count, fps)} · {fmtNumber(shot.frame_count)} fr
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 text-[8.5px] font-mono uppercase tracking-wider rounded-sm flex-shrink-0"
                      style={{ color: statusColor(shot.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(shot.status)}30` }}>
                      {fmt(shot.status || 'not_started')}
                    </span>
                    <button type="button"
                      onClick={() => onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' })}
                      className="p-0.5 rounded-sm hover:bg-stone-700 transition-colors opacity-0 group-hover/shot:opacity-100"
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-red-900/30"
            style={{ color: '#ef4444', border: '1px solid #ef444440' }}>
            <Trash2 className="w-3 h-3" /> Delete scene
          </button>
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
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
          className="pointer-events-auto w-full max-w-4xl rounded-sm overflow-hidden flex flex-col"
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
            <span className="text-[14px] font-mono font-bold" style={{ color: '#fb923c' }}>
              {shot.name || 'Untitled shot'}
            </span>
            <span className="text-[10.5px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
              style={{ color: '#78716c', backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              {shotCode}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded-sm transition-colors" style={{ color: '#a8a29e' }}>
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
            <div className="relative flex-shrink-0 rounded-sm overflow-hidden flex items-center justify-center group/thumb"
              style={{ width: 142, height: 80, backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              {hasThumbnail ? (
                <>
                  <img
                    src={`/api/rabbit/projects/${project?.id}/shots/${shot.id}/thumbnail?r=${thumbRevision}`}
                    alt="" style={{ width: 142, height: 80, objectFit: 'cover', display: 'block' }} />
                  <div className="absolute inset-0 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center gap-1"
                    style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
                    <button type="button" onClick={handleSetThumbnail}
                      className="p-1.5 rounded hover:bg-stone-700 transition-colors" style={{ color: '#d6d3d1' }}
                      title="Change thumbnail"><ImagePlus className="w-4 h-4" /></button>
                    <button type="button" onClick={handleClearThumbnail}
                      className="p-1.5 rounded hover:bg-stone-700 transition-colors" style={{ color: '#fca5a5' }}
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
                    <span className="text-[8px] font-mono uppercase" style={{ color: takeFallback ? '#d6d3d1' : undefined }}>Set thumbnail</span>
                  </div>
                  {!takeFallback && <Clapperboard className="w-5 h-5 group-hover/thumb:opacity-0 transition-opacity absolute" style={{ color: '#292524' }} />}
                  {takeFallback && <span className="absolute bottom-0 left-0 right-0 text-[7.5px] font-mono uppercase tracking-wider text-center py-px group-hover/thumb:opacity-0 transition-opacity" style={{ color: '#fb923c', backgroundColor: 'rgba(12,10,9,0.75)' }}>from primary take</span>}
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
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: sc, border: '1px solid #44403c' }}>
                {SCENE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Type</FieldLabel>
              <select value={shot.type || 'other'} onChange={e => handleUpdate({ type: e.target.value })}
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}>
                {SCENE_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Time of Day</FieldLabel>
              <select value={shot.time_of_day || ''} onChange={e => handleUpdate({ time_of_day: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
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
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }} />
            </div>
            <div>
              <FieldLabel>Frame count</FieldLabel>
              <input type="number" min={0} value={shot.frame_count ?? ''} onChange={e => {
                const n = parseInt(e.target.value, 10)
                handleUpdate({ frame_count: Number.isFinite(n) && n >= 0 ? n : 0 })
              }}
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}
                placeholder="0" />
            </div>
            <div>
              <FieldLabel>Duration</FieldLabel>
              <div className="px-2.5 py-1.5 text-[11.5px] font-mono tabular-nums rounded-sm"
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
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: shot.framing ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
                <option value="">—</option>
                {FRAMING_OPTIONS.map(f => <option key={f.abbr} value={f.abbr}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Camera Movement</FieldLabel>
              <select value={shot.camera_movement || ''} onChange={e => handleUpdate({ camera_movement: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
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
              <div className="px-2.5 py-1.5 text-[11.5px] font-mono truncate rounded-sm"
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
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', colorScheme: 'dark' }}
              />
            </div>
            <div>
              <FieldLabel>End Date</FieldLabel>
              <input
                type="date"
                value={shot.end_date || ''}
                onChange={e => handleUpdate({ end_date: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
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
                  className="w-full px-3 py-2 text-[11.5px] font-mono rounded-sm resize-none focus:outline-none focus:ring-1 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', minHeight: 80 }}
                  autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => { handleUpdate({ description: descDraft }); setEditingDesc(false) }}
                    className="text-[10.5px] font-mono uppercase text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button type="button" onClick={() => { setDescDraft(shot.description || ''); setEditingDesc(false) }}
                    className="text-[10.5px] font-mono uppercase text-stone-500 hover:text-stone-400">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingDesc(true)}
                className="px-3 py-2 text-[11.5px] font-mono rounded-sm cursor-pointer hover:bg-stone-800 transition-colors"
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
                  className="w-full px-3 py-2 text-[11.5px] font-mono rounded-sm resize-none focus:outline-none focus:ring-1 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', minHeight: 60 }}
                  autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => { handleUpdate({ notes: notesDraft }); setEditingNotes(false) }}
                    className="text-[10.5px] font-mono uppercase text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button type="button" onClick={() => { setNotesDraft(shot.notes || ''); setEditingNotes(false) }}
                    className="text-[10.5px] font-mono uppercase text-stone-500 hover:text-stone-400">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingNotes(true)}
                className="px-3 py-2 text-[11.5px] font-mono rounded-sm cursor-pointer hover:bg-stone-800 transition-colors"
                style={{ backgroundColor: '#1c1917', color: shot.notes ? '#a8a29e' : '#57534e', border: '1px solid #44403c', minHeight: 40 }}>
                {shot.notes || 'Click to add notes...'}
              </div>
            )}
          </div>

          {/* Folder path */}
          <div className="mb-4">
            <FieldLabel>Folder</FieldLabel>
            <div className="flex items-center gap-2 px-3 py-2 rounded-sm"
              style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#57534e' }} />
              <span className="text-[11.5px] font-mono truncate" style={{ color: '#a8a29e' }}>
                {shotFolderPath}
              </span>
            </div>
          </div>

          {/* Takes (milestone 2): the bin files this shot is cut from, in order */}
          {takes?.supports && (
            <div className="mb-4">
              <FieldLabel>Takes ({shotTakeEntries.length})</FieldLabel>
              {takes.notice && (
                <div className="flex items-center gap-2 mb-2 text-[10.5px] font-mono" style={{ color: '#f59e0b' }}>
                  <span className="flex-1">{takes.notice}</span>
                  <button type="button" onClick={takes.clearNotice} className="p-0.5 rounded-sm hover:bg-stone-700" style={{ color: '#78716c' }}><X className="w-3 h-3" /></button>
                </div>
              )}
              <ShotTakesPanel shot={shot} entries={shotTakeEntries} fps={fps} canWrite={takes.canWrite} thumbUrlFor={takes.thumbUrlFor} binPathFor={takes.binPathFor}
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-red-900/30"
            style={{ color: '#ef4444', border: '1px solid #ef444440' }}>
            <Trash2 className="w-3 h-3" /> Delete shot
          </button>
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
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
function ConfirmDialog({ title, message, onConfirm, onCancel }) {
  return (
    <>
      <div className="fixed inset-0 z-[60]" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onCancel} />
      <div className="fixed z-[60] top-1/2 left-1/2 w-full max-w-sm rounded-sm overflow-hidden"
        style={{ backgroundColor: '#292524', border: '2px solid #ef4444', transform: 'translate(-50%, -50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3" style={{ borderBottom: '1px solid #44403c' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" style={{ color: '#ef4444' }} />
            <span className="text-[13.5px] font-mono font-bold" style={{ color: '#ef4444' }}>{title}</span>
          </div>
        </div>
        <div className="px-5 py-4">
          <p className="text-[11.5px] font-mono leading-relaxed" style={{ color: '#a8a29e' }}>
            {message}
          </p>
        </div>
        <div className="px-5 py-3 flex items-center justify-end gap-3" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button" onClick={onCancel}
            className="px-4 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            className="px-4 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-red-800"
            style={{ color: '#fff7ed', backgroundColor: '#ef4444', border: '1px solid #dc2626' }}>
            Delete
          </button>
        </div>
      </div>
    </>
  )
}


// ─── Filter panel ───
function SceneFilterPanel({ filters, filterFields, onAdd, onUpdate, onRemove, onClose }) {
  const fields = filterFields || SCENE_FILTER_FIELDS
  function getOptions(f) {
    const def = fields.find(ff => ff.value === f.field)
    if (!def) return []
    return (def.options || []).map(o => ({ value: o, label: fmt(o) }))
  }
  function getType(f) {
    return fields.find(ff => ff.value === f.field)?.type || 'text'
  }
  return (
    <div className="px-4 py-2.5 flex flex-col gap-2 flex-shrink-0" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}>
      {filters.map((f, i) => {
        const type = getType(f)
        const ops = FILTER_OPS[type] || FILTER_OPS.text
        const needsValue = !['is_empty','is_not_empty'].includes(f.op)
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[9.5px] font-mono uppercase font-semibold" style={{ color: '#78716c', width: 40 }}>
              {i === 0 ? 'Where' : 'And'}
            </span>
            <select value={f.field} onChange={e => onUpdate(i, { field: e.target.value, value: '' })}
              className="px-2 py-1.5 text-[10.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}>
              {fields.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select value={f.op} onChange={e => onUpdate(i, { op: e.target.value })}
              className="px-2 py-1.5 text-[10.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}>
              {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
              type === 'select' ? (
                <select value={f.value} onChange={e => onUpdate(i, { value: e.target.value })}
                  className="px-2 py-1.5 text-[10.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                  style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}>
                  <option value="">Select…</option>
                  {getOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" value={f.value || ''} onChange={e => onUpdate(i, { value: e.target.value })}
                  className="px-2 py-1.5 text-[10.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500 w-32"
                  style={{ backgroundColor: '#292524', color: '#d6d3d1', border: '1px solid #44403c' }}
                  placeholder="value…" />
              )
            )}
            <button type="button" onClick={() => onRemove(i)}
              className="p-1 rounded-sm hover:bg-stone-700 transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}
      <div className="flex items-center gap-2">
        <button type="button" onClick={onAdd}
          className="flex items-center gap-1 px-2.5 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
          style={{ color: '#fb923c', border: '1px solid #44403c' }}>
          <Plus className="w-3 h-3" /> Add filter
        </button>
        <button type="button" onClick={onClose}
          className="px-2.5 py-1 text-[10.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
          style={{ color: '#78716c', border: '1px solid #44403c' }}>
          Done
        </button>
      </div>
    </div>
  )
}


// ─── Saved views dropdown ───
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
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="p-1.5 rounded-sm hover:bg-stone-700 transition-colors"
        style={{ color: views.length > 0 ? '#fb923c' : '#57534e' }}
        title="Saved views">
        <BookmarkPlus className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-40 rounded-sm shadow-2xl overflow-hidden"
          style={{ backgroundColor: '#292524', border: '1px solid #44403c', minWidth: 180, maxHeight: 240 }}>
          <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
            {views.length === 0 ? (
              <div className="px-3 py-2 text-[10.5px] font-mono italic" style={{ color: '#57534e' }}>
                No saved views yet
              </div>
            ) : (
              views.map(v => (
                <div key={v.id}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-stone-700 transition-colors cursor-pointer"
                  style={{ borderBottom: '1px solid #1c1917' }}>
                  <span className="flex-1 text-[11.5px] font-mono truncate" style={{ color: '#d6d3d1' }}
                    onClick={() => { onLoad(v); setOpen(false) }}>
                    {v.name}
                  </span>
                  <button type="button" onClick={() => onDelete(v.id)}
                    className="p-0.5 rounded-sm hover:bg-stone-600 transition-colors" style={{ color: '#78716c' }}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
          <button type="button" onClick={() => { onSaveRequest(); setOpen(false) }}
            className="w-full px-3 py-2 text-[10.5px] font-mono uppercase tracking-wider hover:bg-stone-700 transition-colors text-left"
            style={{ color: '#fb923c', borderTop: '1px solid #44403c' }}>
            <Save className="w-3 h-3 inline-block mr-1.5" /> Save current view
          </button>
        </div>
      )}
    </div>
  )
}


// ─── Bulk select ───
function SceneBulkSelect({ label, options, onPick }) {
  return (
    <select defaultValue="" onChange={e => { if (e.target.value) { onPick(e.target.value); e.target.value = '' } }}
      className="px-2 py-0.5 text-[9.5px] font-mono uppercase tracking-wider rounded-sm bg-transparent focus:outline-none cursor-pointer"
      style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
      <option value="" disabled>{label}</option>
      {options.map(o => <option key={o} value={o}>{fmt(o)}</option>)}
    </select>
  )
}


// ─── InlineText ───
function InlineText({ value, placeholder, onCommit, size = 'md', color }) {
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
        className={`w-full bg-transparent focus:outline-none font-mono ${size === 'xs' ? 'text-[9.5px]' : size === 'sm' ? 'text-[11.5px]' : 'text-[12.5px]'}`}
        style={{ color: '#f4a261', borderBottom: '1px solid #fb923c' }}
        onClick={e => e.stopPropagation()}
      />
    )
  }
  return (
    <span
      className={`font-mono truncate cursor-text block ${size === 'xs' ? 'text-[9.5px]' : size === 'sm' ? 'text-[11.5px]' : 'text-[12.5px]'}`}
      style={{ color: value ? (color || (size === 'xs' ? '#78716c' : '#d6d3d1')) : '#57534e' }}
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
        className="w-full bg-transparent focus:outline-none text-[13.5px] font-mono"
        style={{ color: '#f4a261', borderBottom: '1px solid #fb923c' }}
      />
    )
  }
  return (
    <span
      className="text-[13.5px] font-mono truncate cursor-text block"
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
    <span className="block text-[10.5px] font-mono uppercase tracking-widest font-medium mb-1" style={{ color: '#78716c' }}>
      {children}
    </span>
  )
}
