// ============================================================
// RABBIT — ScenesView (Phase 4 — full implementation)
// ============================================================
//
// Scene & Shot management with table/gallery views, auto-naming,
// detail popups, create/edit/delete workflows.
//
// Scenes contain shots — the table shows shots nested under their
// parent scene with an expand/collapse toggle. Gallery lays out
// cards in a configurable grid (sm / md / lg).
//
// ── Auto-naming ──
// When creating a new scene/shot the view auto-generates a name
// using the project's naming conventions:
//   {project_code}{separator}SC{padded_scene#}{separator}SH{padded_shot#}
// All naming parameters are configurable in the Project Control Panel.
//
// ── UX Laws applied ──
// • Aesthetic-Usability Effect — polished dark stone surface
// • Law of Common Region — rows as clearly bounded groups
// • Law of Proximity — tight internal spacing, generous external gaps
// • Von Restorff Effect — status accent bars for instant recognition

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  Film, Plus, Search, X, LayoutGrid, Filter,
  Layers, ChevronDown, ChevronRight, Trash2, Edit3, Eye,
  Table as TableIcon, ArrowUpDown, AlertTriangle, Save,
  Maximize2, Minimize2, Clapperboard,
  BookmarkPlus, CheckSquare, Square, MinusSquare,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'

// ── Status config ──
const SCENE_STATUSES = [
  'not_started', 'in_progress', 'pending_review', 'needs_revisions',
  'approved', 'final', 'blocked', 'on_hold', 'omitted',
]

const SCENE_TYPES = ['interior', 'exterior', 'int_ext', 'other']

// ── Sort config ──
const SORTABLE_FIELDS = [
  { value: 'name',         label: 'Name' },
  { value: 'scene_number', label: 'Scene Number' },
  { value: 'type',         label: 'Type' },
  { value: 'status',       label: 'Status' },
  { value: 'created_at',   label: 'Created' },
]

// ── Group config ──
const GROUPABLE_FIELDS = [
  { value: '',       label: 'No grouping' },
  { value: 'type',   label: 'Type' },
  { value: 'status', label: 'Status' },
]

// ── Filter config ──
const SCENE_FILTER_FIELDS = [
  { value: 'status', label: 'Status', type: 'select', options: SCENE_STATUSES },
  { value: 'type',   label: 'Type',   type: 'select', options: SCENE_TYPES },
  { value: 'name',   label: 'Name',   type: 'text' },
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

  // ── View state ──
  const [viewMode, setViewMode]     = useState('table')   // table | gallery
  const [contentMode, setContentMode] = useState('scenes') // scenes | shots
  const [search, setSearch]         = useState('')
  const [filters, setFilters]       = useState([])
  const [sortField, setSortField]   = useState('')
  const [sortDir, setSortDir]       = useState('asc')
  const [groupBy, setGroupBy]       = useState('')
  const [gallerySize, setGallerySize] = useState('md')     // sm | md | lg
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())

  // ── Saved views ──
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || '[]') } catch { return [] }
  })
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')

  // ── Popup state ──
  const [detailSceneId, setDetailSceneId] = useState(null)
  const [confirmDelete, setConfirmDelete]   = useState(null) // { type:'scene'|'shot', id, name }
  const [shotPickerOpen, setShotPickerOpen] = useState(false)
  const shotPickerRef = useRef(null)

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
    // Sort each bucket by shot_number
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (a.shot_number ?? 0) - (b.shot_number ?? 0))
    }
    return map
  }, [shots])

  // ── Auto-naming helpers ──
  const nextSceneNumber = useMemo(() => {
    const nums = scenes.map(s => s.scene_number).filter(n => typeof n === 'number')
    if (nums.length === 0) return project?.scene_start_number ?? 1
    return Math.max(...nums) + 1
  }, [scenes, project?.scene_start_number])

  const formatSceneCode = useCallback((num) => {
    const code = project?.project_code || 'PROJ'
    const sep = project?.scene_separator || '_'
    const digits = project?.scene_digits ?? 3
    return `${code}${sep}SC${String(num).padStart(digits, '0')}`
  }, [project?.project_code, project?.scene_separator, project?.scene_digits])

  const nextShotNumberForScene = useCallback((sceneId) => {
    const sceneShots = shotsByScene[sceneId] || []
    const nums = sceneShots.map(s => s.shot_number).filter(n => typeof n === 'number')
    if (nums.length === 0) return project?.scene_start_number ?? 1
    return Math.max(...nums) + 1
  }, [shotsByScene, project?.scene_start_number])

  const formatShotCode = useCallback((sceneNum, shotNum) => {
    const code = project?.project_code || 'PROJ'
    const sep = project?.scene_separator || '_'
    const sDigits = project?.scene_digits ?? 3
    const hDigits = project?.shot_digits ?? 4
    return `${code}${sep}SC${String(sceneNum).padStart(sDigits, '0')}${sep}SH${String(shotNum).padStart(hDigits, '0')}`
  }, [project?.project_code, project?.scene_separator, project?.scene_digits, project?.shot_digits])

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
      })
    } catch (err) { console.error('Failed to create shot:', err) }
  }, [ctx, scenes, nextShotNumberForScene, formatShotCode])

  const handleDeleteScene = useCallback(async (id) => {
    try {
      // Delete child shots first
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
    const view = { id: Date.now().toString(), name: saveName.trim(), filters, sortField, sortDir, groupBy, viewMode, gallerySize, contentMode }
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
    if (view.viewMode) setViewMode(view.viewMode)
    if (view.gallerySize) setGallerySize(view.gallerySize)
    if (view.contentMode) setContentMode(view.contentMode)
  }
  function deleteSavedView(id) {
    const next = savedViews.filter(v => v.id !== id)
    setSavedViews(next)
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next))
  }

  // ── Filter CRUD ──
  function addFilter() { setFilters(prev => [...prev, { field: 'status', op: 'is', value: '' }]) }
  function updateFilter(idx, patch) { setFilters(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f)) }
  function removeFilter(idx) { setFilters(prev => prev.filter((_, i) => i !== idx)) }

  // ── Filtering (search + complex filters) ──
  const filtered = useMemo(() => {
    let result = scenes
    const s = search.trim().toLowerCase()
    if (s) result = result.filter(sc => (sc.name || '').toLowerCase().includes(s))
    for (const f of filters) {
      if (!f.field) continue
      result = result.filter(sc => {
        const val = sc[f.field]
        switch (f.op) {
          case 'is':           return val === f.value
          case 'is_not':       return val !== f.value
          case 'is_empty':     return !val
          case 'is_not_empty': return !!val
          case 'contains':     return (val || '').toLowerCase().includes((f.value || '').toLowerCase())
          case 'not_contains': return !(val || '').toLowerCase().includes((f.value || '').toLowerCase())
          default: return true
        }
      })
    }
    return result
  }, [scenes, search, filters])

  // ── Sorting ──
  const sorted = useMemo(() => {
    if (!sortField) return [...filtered].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const dir = sortDir === 'desc' ? -1 : 1
    return [...filtered].sort((a, b) => {
      let va = a[sortField] ?? ''
      let vb = b[sortField] ?? ''
      if (sortField === 'status') {
        va = SCENE_STATUSES.indexOf(va); vb = SCENE_STATUSES.indexOf(vb)
      } else if (sortField === 'type') {
        va = SCENE_TYPES.indexOf(va); vb = SCENE_TYPES.indexOf(vb)
      } else if (typeof va === 'string') {
        va = va.toLowerCase(); vb = (vb || '').toLowerCase()
      }
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
  }, [filtered, sortField, sortDir])

  // ── Grouping ──
  const groups = useMemo(() => {
    if (!groupBy) return null
    const map = {}
    for (const sc of sorted) {
      let key
      if (groupBy === 'type')   key = sc.type || 'other'
      else if (groupBy === 'status') key = sc.status || 'not_started'
      else key = '__all__'
      if (!map[key]) map[key] = []
      map[key].push(sc)
    }
    let sortedKeys
    if (groupBy === 'type')   sortedKeys = SCENE_TYPES.filter(t => map[t])
    else if (groupBy === 'status') sortedKeys = SCENE_STATUSES.filter(s => map[s])
    else sortedKeys = Object.keys(map)
    return sortedKeys.map(key => ({
      key,
      label: fmt(key),
      scenes: map[key] || [],
    }))
  }, [sorted, groupBy])

  function groupAccent(key) {
    if (groupBy === 'status') return statusColor(key)
    return '#fb923c'
  }

  // ── Shot filtering / sorting / grouping ──
  const filteredShots = useMemo(() => {
    let result = shots
    const s = search.trim().toLowerCase()
    if (s) result = result.filter(sh => (sh.name || '').toLowerCase().includes(s))
    return result
  }, [shots, search])

  const sceneMap = useMemo(() => {
    const map = {}
    for (const sc of scenes) map[sc.id] = sc
    return map
  }, [scenes])

  const shotGroups = useMemo(() => {
    // group filtered shots by parent scene, sorted by scene number
    const buckets = {}
    for (const sh of filteredShots) {
      const key = sh.scene_id || '__unlinked__'
      if (!buckets[key]) buckets[key] = []
      buckets[key].push(sh)
    }
    // sort shots within each bucket
    for (const key of Object.keys(buckets)) {
      buckets[key].sort((a, b) => (a.shot_number ?? 0) - (b.shot_number ?? 0))
    }
    // order buckets by scene number
    const keys = Object.keys(buckets).sort((a, b) => {
      const scA = sceneMap[a]; const scB = sceneMap[b]
      return (scA?.scene_number ?? 9999) - (scB?.scene_number ?? 9999)
    })
    return keys.map(key => ({
      sceneId: key,
      scene: sceneMap[key] || null,
      label: sceneMap[key]?.name || 'Unlinked shots',
      shots: buckets[key],
    }))
  }, [filteredShots, sceneMap])

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
        <span className="text-[13px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>
          No project loaded
        </span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 flex-wrap" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#292524' }}>

        {/* Filter (scene mode only) */}
        {contentMode === 'scenes' && (
          <button type="button" onClick={() => setShowFilterPanel(!showFilterPanel)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
            style={{ color: filters.length > 0 ? '#fb923c' : '#a8a29e', border: '1px solid #44403c' }}>
            <Filter className="w-3.5 h-3.5" />
            Filter{filters.length > 0 ? ` (${filters.length})` : ''}
          </button>
        )}

        {/* Content mode toggle: Scenes | Shots */}
        <div className="flex rounded overflow-hidden" style={{ border: '1px solid #44403c' }}>
          <button type="button" onClick={() => setContentMode('scenes')}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: contentMode === 'scenes' ? '#ea580c' : 'transparent',
              color: contentMode === 'scenes' ? '#fff7ed' : '#78716c',
            }}>
            <Film className="w-3 h-3" /> Scenes
          </button>
          <button type="button" onClick={() => setContentMode('shots')}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: contentMode === 'shots' ? '#ea580c' : 'transparent',
              color: contentMode === 'shots' ? '#fff7ed' : '#78716c',
              borderLeft: '1px solid #44403c',
            }}>
            <Clapperboard className="w-3 h-3" /> Shots
          </button>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, backgroundColor: '#44403c' }} />

        {/* Sort (scene mode only) */}
        {contentMode === 'scenes' && (
          <>
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
              <select value={sortField} onChange={e => setSortField(e.target.value)}
                className="px-2 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}>
                <option value="">No sort</option>
                {SORTABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              {sortField && (
                <button type="button" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                  className="px-2 py-1.5 text-[10px] font-mono uppercase rounded hover:bg-stone-700 transition-colors"
                  style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
                  {sortDir === 'asc' ? 'A\u2192Z' : 'Z\u2192A'}
                </button>
              )}
            </div>
            <div style={{ width: 1, height: 20, backgroundColor: '#44403c' }} />
          </>
        )}

        {/* Group (scene mode only) */}
        {contentMode === 'scenes' && (
          <>
            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
              <select value={groupBy}
                onChange={e => setGroupBy(e.target.value)}
                className="px-2 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}>
                {GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div style={{ width: 1, height: 20, backgroundColor: '#44403c' }} />
          </>
        )}

        {/* View mode toggle */}
        <div className="flex rounded overflow-hidden" style={{ border: '1px solid #44403c' }}>
          <button type="button" onClick={() => setViewMode('table')}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: viewMode === 'table' ? '#ea580c' : 'transparent',
              color: viewMode === 'table' ? '#fff7ed' : '#78716c',
            }}>
            <TableIcon className="w-3 h-3" /> Table
          </button>
          <button type="button" onClick={() => setViewMode('gallery')}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: viewMode === 'gallery' ? '#ea580c' : 'transparent',
              color: viewMode === 'gallery' ? '#fff7ed' : '#78716c',
              borderLeft: '1px solid #44403c',
            }}>
            <LayoutGrid className="w-3 h-3" /> Gallery
          </button>
        </div>

        {/* Gallery size selector (only in gallery mode) */}
        {viewMode === 'gallery' && (
          <>
            <div style={{ width: 1, height: 20, backgroundColor: '#44403c' }} />
            <div className="flex rounded overflow-hidden" style={{ border: '1px solid #44403c' }}>
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
          </>
        )}

        {/* Saved views */}
        <SceneSavedViewsDropdown views={savedViews} onLoad={loadView} onDelete={deleteSavedView} onSave={() => setShowSaveDialog(true)} />

        {/* Divider */}
        <div style={{ width: 1, height: 20, backgroundColor: '#44403c' }} />

        {/* Search */}
        <div className="flex items-center gap-1.5 flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#78716c' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={contentMode === 'shots' ? 'Search shots...' : 'Search scenes...'}
            className="flex-1 px-2.5 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
          {search && (
            <button type="button" onClick={() => setSearch('')}
              className="p-0.5 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right: count + add buttons */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] font-mono uppercase tracking-wider px-1" style={{ color: '#78716c' }}>
            {contentMode === 'shots'
              ? `${totalFilteredShots}/${shots.length} shots`
              : `${sorted.length}/${scenes.length}`
            }
          </span>

          {/* New scene button */}
          <button type="button" onClick={handleNewScene}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded transition-colors"
            style={{
              color: contentMode === 'scenes' ? '#fff7ed' : '#a8a29e',
              backgroundColor: contentMode === 'scenes' ? '#ea580c' : 'transparent',
              border: contentMode === 'scenes' ? '1px solid #c2410c' : '1px solid #44403c',
            }}>
            <Plus className="w-3.5 h-3.5" /> Scene
          </button>

          {/* New shot button with scene picker */}
          <div className="relative" ref={shotPickerRef}>
            <button type="button"
              onClick={() => {
                if (scenes.length === 0) return
                if (scenes.length === 1) { handleNewShot(scenes[0].id); return }
                setShotPickerOpen(o => !o)
              }}
              disabled={scenes.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded transition-colors disabled:opacity-40"
              style={{
                color: contentMode === 'shots' ? '#fff7ed' : '#a8a29e',
                backgroundColor: contentMode === 'shots' ? '#ea580c' : 'transparent',
                border: contentMode === 'shots' ? '1px solid #c2410c' : '1px solid #44403c',
              }}
              title={scenes.length === 0 ? 'Create a scene first' : 'Add a new shot'}>
              <Plus className="w-3.5 h-3.5" /> Shot
              {scenes.length > 1 && <ChevronDown className="w-3 h-3 ml-0.5" />}
            </button>

            {/* Scene picker dropdown */}
            {shotPickerOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 rounded overflow-hidden z-50"
                style={{ backgroundColor: '#292524', border: '1px solid #44403c', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                <div className="px-3 py-2" style={{ borderBottom: '1px solid #44403c' }}>
                  <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>
                    Add shot to scene
                  </span>
                </div>
                <div className="max-h-48 overflow-auto">
                  {scenes.map(sc => (
                    <button key={sc.id} type="button"
                      onClick={() => { handleNewShot(sc.id); setShotPickerOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-700/50 transition-colors"
                      style={{ borderBottom: '1px solid #1c1917' }}>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor(sc.status) }} />
                      <span className="text-[11px] font-mono truncate" style={{ color: '#d6d3d1' }}>
                        {sc.name || 'Untitled scene'}
                      </span>
                      <span className="text-[9px] font-mono ml-auto flex-shrink-0" style={{ color: '#57534e' }}>
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
      {showFilterPanel && contentMode === 'scenes' && (
        <SceneFilterPanel filters={filters} onAdd={addFilter} onUpdate={updateFilter} onRemove={removeFilter} onClose={() => setShowFilterPanel(false)} />
      )}

      {/* ── Save view dialog ── */}
      {showSaveDialog && (
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}>
          <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="View name..."
            className="px-2.5 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 w-48"
            style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}
            onKeyDown={e => { if (e.key === 'Enter') saveCurrentView(); if (e.key === 'Escape') setShowSaveDialog(false) }}
            autoFocus />
          <button type="button" onClick={saveCurrentView}
            className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded transition-colors"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>Save</button>
          <button type="button" onClick={() => setShowSaveDialog(false)}
            className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto">
        {contentMode === 'shots' ? (
          /* ── SHOT MODE ── */
          viewMode === 'table' ? (
            <ShotTable
              shotGroups={shotGroups}
              ctx={ctx}
              onOpenSceneDetail={setDetailSceneId}
              onNewShot={handleNewShot}
              onRequestDelete={setConfirmDelete}
            />
          ) : (
            <ShotGallery
              shotGroups={shotGroups}
              gallerySize={gallerySize}
              ctx={ctx}
              onOpenSceneDetail={setDetailSceneId}
              onRequestDelete={setConfirmDelete}
            />
          )
        ) : (
          /* ── SCENE MODE ── */
          viewMode === 'table' ? (
            groups ? (
              // Table — grouped
              groups.map(g => (
                <div key={g.key}>
                  <div className="flex items-center gap-2 px-5 py-2.5 cursor-pointer hover:bg-stone-800/30 transition-colors"
                    style={{ borderBottom: '1px solid #44403c', borderLeft: `3px solid ${groupAccent(g.key)}` }}
                    onClick={() => toggleGroup(g.key)}>
                    {collapsedGroups.has(g.key)
                      ? <ChevronRight className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
                      : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#78716c' }} />}
                    <span className="text-[12px] font-mono uppercase tracking-wider font-bold" style={{ color: groupAccent(g.key) }}>
                      {g.label}
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: '#78716c' }}>
                      ({g.scenes.length})
                    </span>
                  </div>
                  {!collapsedGroups.has(g.key) && (
                    <SceneTable
                      scenes={g.scenes}
                      shotsByScene={shotsByScene}
                      assetCountByScene={assetCountByScene}
                      taskCountByScene={taskCountByScene}
                      ctx={ctx}
                      onOpenDetail={setDetailSceneId}
                      onNewShot={handleNewShot}
                      onRequestDelete={setConfirmDelete}
                    />
                  )}
                </div>
              ))
            ) : (
              // Table — ungrouped
              <SceneTable
                scenes={sorted}
                shotsByScene={shotsByScene}
                assetCountByScene={assetCountByScene}
                taskCountByScene={taskCountByScene}
                ctx={ctx}
                onOpenDetail={setDetailSceneId}
                onNewShot={handleNewShot}
                onRequestDelete={setConfirmDelete}
              />
            )
          ) : (
            // Gallery
            <SceneGallery
              scenes={groups ? groups.flatMap(g => g.scenes) : sorted}
              shotsByScene={shotsByScene}
              gallerySize={gallerySize}
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
          shotsByScene={shotsByScene}
          assetCountByScene={assetCountByScene}
          taskCountByScene={taskCountByScene}
          onNewShot={handleNewShot}
          onClose={() => setDetailSceneId(null)}
          onRequestDelete={setConfirmDelete}
        />
      )}

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


// ─── Scene table ───
function SceneTable({ scenes, shotsByScene, assetCountByScene, taskCountByScene, ctx, onOpenDetail, onNewShot, onRequestDelete }) {
  const [expandedScenes, setExpandedScenes] = useState(new Set())

  // ── Multi-select ──
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
        <span className="text-[12px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
          No scenes yet
        </span>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="relative flex items-center gap-0 px-4 py-2" style={{ borderBottom: '1px solid #44403c' }}>
        <span className="w-8 flex items-center justify-center cursor-pointer" onClick={toggleAll}>
          {allSelected ? <CheckSquare className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
           : someSelected ? <MinusSquare className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
           : <Square className="w-3.5 h-3.5" style={{ color: '#57534e' }} />}
        </span>
        <span className="w-8" />
        <span className="flex-1 text-[10px] font-mono uppercase tracking-wider font-bold" style={{ color: '#78716c' }}>Name</span>
        <span className="w-24 text-[10px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Type</span>
        <span className="w-20 text-[10px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Scene #</span>
        <span className="w-28 text-[10px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Status</span>
        <span className="w-16 text-[10px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Assets</span>
        <span className="w-16 text-[10px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Tasks</span>
        <span className="w-20" />

        {/* Bulk action bar */}
        {someSelected && (
          <div className="absolute top-0 z-20 flex items-center gap-3 h-full px-3 rounded-sm"
            style={{ left: 36, backgroundColor: '#292524', border: '1px solid #ea580c', width: 'fit-content' }}>
            <span className="text-[11px] font-mono font-bold flex-shrink-0" style={{ color: '#fb923c' }}>{selected.size} selected</span>
            <div style={{ width: 1, height: 18, backgroundColor: '#44403c' }} />
            <SceneBulkSelect label="Status" options={SCENE_STATUSES} onPick={v => bulkUpdate({ status: v })} />
            <SceneBulkSelect label="Type" options={SCENE_TYPES} onPick={v => bulkUpdate({ type: v })} />
            <div style={{ width: 1, height: 18, backgroundColor: '#44403c' }} />
            <button type="button" onClick={bulkDelete} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-red-900/40 transition-colors" style={{ color: '#fca5a5' }}>
              <Trash2 className="w-3 h-3" /> <span className="text-[10px] font-mono uppercase">Delete</span>
            </button>
            <button type="button" onClick={clearSelection} className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Rows */}
      {scenes.map(sc => {
        const sceneShots = shotsByScene[sc.id] || []
        const expanded = expandedScenes.has(sc.id)
        return (
          <div key={sc.id}>
            <div
              className="flex items-center gap-0 px-4 py-2 hover:bg-stone-800/40 transition-colors group"
              style={{ borderBottom: '1px solid #292524', borderLeft: `3px solid ${statusColor(sc.status)}` }}
            >
              {/* Checkbox */}
              <span className="w-8 flex items-center justify-center cursor-pointer" onClick={() => toggleOne(sc.id)}>
                {selected.has(sc.id)
                  ? <CheckSquare className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
                  : <Square className="w-3.5 h-3.5" style={{ color: '#57534e' }} />}
              </span>

              {/* Expand toggle */}
              <button type="button" onClick={() => toggleExpand(sc.id)}
                className="w-8 flex items-center justify-center"
                style={{ color: '#78716c' }}>
                {sceneShots.length > 0 ? (
                  expanded
                    ? <ChevronDown className="w-3.5 h-3.5" />
                    : <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <span className="w-3.5 h-3.5" />
                )}
              </button>

              {/* Name — inline editable */}
              <span className="flex-1 min-w-0">
                <InlineText
                  value={sc.name || ''}
                  placeholder="Untitled scene"
                  onCommit={v => ctx?.updateScene?.(sc.id, { name: v })}
                />
              </span>

              {/* Type */}
              <span className="w-24 flex justify-center">
                <select
                  value={sc.type || 'interior'}
                  onChange={e => ctx?.updateScene?.(sc.id, { type: e.target.value })}
                  className="px-1 py-0.5 text-[10px] font-mono uppercase rounded bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                  style={{ color: '#a8a29e', border: '1px solid transparent' }}
                  onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                  onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}
                >
                  {SCENE_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                </select>
              </span>

              {/* Scene number */}
              <span className="w-20 text-[11px] font-mono text-center" style={{ color: '#a8a29e' }}>
                {sc.scene_number ?? '—'}
              </span>

              {/* Status */}
              <span className="w-28 flex justify-center">
                <select
                  value={sc.status || 'not_started'}
                  onChange={e => ctx?.updateScene?.(sc.id, { status: e.target.value })}
                  className="px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                  style={{
                    color: statusColor(sc.status),
                    backgroundColor: 'rgba(0,0,0,0.3)',
                    border: `1px solid ${statusColor(sc.status)}30`,
                  }}
                >
                  {SCENE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
                </select>
              </span>

              {/* Assets count */}
              <span className="w-16 text-[11px] font-mono text-center" style={{ color: '#a8a29e' }}>
                {assetCountByScene[sc.id] || 0}
              </span>

              {/* Tasks count */}
              <span className="w-16 text-[11px] font-mono text-center" style={{ color: '#a8a29e' }}>
                {taskCountByScene[sc.id] || 0}
              </span>

              {/* Actions */}
              <span className="w-20 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" onClick={() => onOpenDetail(sc.id)}
                  className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e' }} title="View details">
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => onRequestDelete({ type: 'scene', id: sc.id, name: sc.name || 'Untitled' })}
                  className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#ef4444' }} title="Delete scene">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </span>
            </div>

            {/* Nested shots */}
            {expanded && (
              <div style={{ backgroundColor: '#1a1816' }}>
                {sceneShots.map(shot => (
                  <div key={shot.id}
                    className="flex items-center gap-0 px-4 py-1.5 hover:bg-stone-800/30 transition-colors group/shot"
                    style={{ borderBottom: '1px solid #1c1917', paddingLeft: 48, borderLeft: '3px solid #44403c' }}>
                    <Film className="w-3 h-3 mr-2 flex-shrink-0" style={{ color: '#57534e' }} />
                    <span className="flex-1 min-w-0">
                      <InlineText
                        value={shot.name || ''}
                        placeholder="Untitled shot"
                        size="sm"
                        onCommit={v => ctx?.updateShot?.(shot.id, { name: v })}
                      />
                    </span>
                    <span className="w-24 flex justify-center">
                      <select
                        value={shot.type || 'other'}
                        onChange={e => ctx?.updateShot?.(shot.id, { type: e.target.value })}
                        className="px-1 py-0.5 text-[9px] font-mono uppercase rounded bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                        style={{ color: '#78716c', border: '1px solid transparent' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}
                      >
                        {SCENE_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                      </select>
                    </span>
                    <span className="w-20 text-[10px] font-mono text-center" style={{ color: '#78716c' }}>
                      {shot.shot_number ?? '—'}
                    </span>
                    <span className="w-28 flex justify-center">
                      <select
                        value={shot.status || 'not_started'}
                        onChange={e => ctx?.updateShot?.(shot.id, { status: e.target.value })}
                        className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                        style={{
                          color: statusColor(shot.status),
                          backgroundColor: 'rgba(0,0,0,0.3)',
                          border: `1px solid ${statusColor(shot.status)}30`,
                        }}
                      >
                        {SCENE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
                      </select>
                    </span>
                    <span className="w-16" />
                    <span className="w-16" />
                    <span className="w-20 flex items-center justify-end gap-1 opacity-0 group-hover/shot:opacity-100 transition-opacity">
                      <button type="button" onClick={() => onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' })}
                        className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#ef4444' }} title="Delete shot">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  </div>
                ))}
                {/* Add shot row */}
                <button type="button" onClick={() => onNewShot(sc.id)}
                  className="flex items-center gap-2 w-full px-4 py-2 text-[10px] font-mono uppercase tracking-wider hover:bg-stone-800/40 transition-colors"
                  style={{ paddingLeft: 48, color: '#57534e', borderBottom: '1px solid #1c1917', borderLeft: '3px solid #44403c' }}>
                  <Plus className="w-3 h-3" />
                  Add shot
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
function SceneGallery({ scenes, shotsByScene, gallerySize, onOpenDetail, onRequestDelete }) {
  const sizeMap = { sm: 160, md: 220, lg: 300 }
  const cardW = sizeMap[gallerySize] || sizeMap.md

  if (scenes.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-[12px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
          No scenes yet
        </span>
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-wrap gap-3">
      {scenes.map(sc => {
        const sceneShots = shotsByScene[sc.id] || []
        return (
          <div key={sc.id}
            onClick={() => onOpenDetail(sc.id)}
            className="rounded overflow-hidden hover:ring-2 hover:ring-orange-500/50 transition-all cursor-pointer group relative"
            style={{ width: cardW, backgroundColor: '#292524', border: '1px solid #44403c' }}>
            {/* Thumbnail placeholder */}
            <div className="flex items-center justify-center relative"
              style={{ height: cardW * 0.6, backgroundColor: '#1c1917', borderBottom: '1px solid #44403c' }}>
              <Film className="w-8 h-8" style={{ color: '#44403c' }} />
              {/* Delete button (top-right on hover) */}
              <button type="button"
                onClick={e => { e.stopPropagation(); onRequestDelete({ type: 'scene', id: sc.id, name: sc.name || 'Untitled' }) }}
                className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-red-900/50"
                style={{ color: '#ef4444' }}>
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            {/* Info */}
            <div className="px-3 py-2.5 flex flex-col gap-1">
              <span className="text-[12px] font-mono truncate font-bold" style={{ color: '#e7e5e4' }}>
                {sc.name || 'Untitled scene'}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono uppercase" style={{ color: '#78716c' }}>
                  {fmt(sc.type || '')}
                </span>
                <span className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm"
                  style={{ color: statusColor(sc.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(sc.status)}30` }}>
                  {fmt(sc.status || 'not_started')}
                </span>
              </div>
              {sceneShots.length > 0 && (
                <span className="text-[10px] font-mono" style={{ color: '#57534e' }}>
                  {sceneShots.length} shot{sceneShots.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}


// ─── Shot table (shots grouped by scene) ───
function ShotTable({ shotGroups, ctx, onOpenSceneDetail, onNewShot, onRequestDelete }) {
  const [collapsedScenes, setCollapsedScenes] = useState(new Set())

  function toggleScene(id) {
    setCollapsedScenes(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (shotGroups.length === 0 || shotGroups.every(g => g.shots.length === 0)) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-[12px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
          No shots yet — create a scene first, then add shots
        </span>
      </div>
    )
  }

  return (
    <div>
      {/* Column header */}
      <div className="flex items-center gap-0 px-4 py-2" style={{ borderBottom: '1px solid #44403c' }}>
        <span className="w-8" />
        <span className="flex-1 text-[10px] font-mono uppercase tracking-wider font-bold" style={{ color: '#78716c' }}>Shot name</span>
        <span className="w-24 text-[10px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Type</span>
        <span className="w-20 text-[10px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Shot #</span>
        <span className="w-28 text-[10px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Status</span>
        <span className="w-28 text-[10px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Start</span>
        <span className="w-28 text-[10px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>End</span>
        <span className="w-20" />
      </div>

      {shotGroups.map(g => {
        const collapsed = collapsedScenes.has(g.sceneId)
        return (
          <div key={g.sceneId}>
            {/* Scene group header */}
            <div
              className="flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-stone-800/30 transition-colors"
              style={{ borderBottom: '1px solid #44403c', borderLeft: `3px solid ${g.scene ? statusColor(g.scene.status) : '#57534e'}`, backgroundColor: '#292524' }}
              onClick={() => toggleScene(g.sceneId)}
            >
              {collapsed
                ? <ChevronRight className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
                : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#78716c' }} />}
              <Film className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
              <span className="text-[11px] font-mono font-bold truncate" style={{ color: '#fb923c' }}>
                {g.label}
              </span>
              <span className="text-[10px] font-mono" style={{ color: '#78716c' }}>
                ({g.shots.length} shot{g.shots.length !== 1 ? 's' : ''})
              </span>
              {g.scene && (
                <button type="button"
                  onClick={e => { e.stopPropagation(); onOpenSceneDetail(g.sceneId) }}
                  className="ml-auto p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e' }} title="Scene details">
                  <Eye className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Shot rows */}
            {!collapsed && (
              <div>
                {g.shots.map(shot => (
                  <div key={shot.id}
                    className="flex items-center gap-0 px-4 py-2 hover:bg-stone-800/40 transition-colors group"
                    style={{ borderBottom: '1px solid #292524', borderLeft: '3px solid #44403c' }}>
                    <span className="w-8 flex items-center justify-center">
                      <Clapperboard className="w-3 h-3" style={{ color: '#57534e' }} />
                    </span>

                    {/* Name — inline editable */}
                    <span className="flex-1 min-w-0">
                      <InlineText
                        value={shot.name || ''}
                        placeholder="Untitled shot"
                        onCommit={v => ctx?.updateShot?.(shot.id, { name: v })}
                      />
                    </span>

                    {/* Type */}
                    <span className="w-24 flex justify-center">
                      <select
                        value={shot.type || 'other'}
                        onChange={e => ctx?.updateShot?.(shot.id, { type: e.target.value })}
                        className="px-1 py-0.5 text-[10px] font-mono uppercase rounded bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                        style={{ color: '#a8a29e', border: '1px solid transparent' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}>
                        {SCENE_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                      </select>
                    </span>

                    {/* Shot number */}
                    <span className="w-20 text-[11px] font-mono text-center" style={{ color: '#a8a29e' }}>
                      {shot.shot_number ?? '—'}
                    </span>

                    {/* Status */}
                    <span className="w-28 flex justify-center">
                      <select
                        value={shot.status || 'not_started'}
                        onChange={e => ctx?.updateShot?.(shot.id, { status: e.target.value })}
                        className="px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
                        style={{
                          color: statusColor(shot.status),
                          backgroundColor: 'rgba(0,0,0,0.3)',
                          border: `1px solid ${statusColor(shot.status)}30`,
                        }}>
                        {SCENE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
                      </select>
                    </span>

                    {/* Start date */}
                    <span className="w-28 flex justify-center">
                      <input
                        type="date"
                        value={shot.start_date || ''}
                        onChange={e => ctx?.updateShot?.(shot.id, { start_date: e.target.value || null })}
                        className="px-1 py-0.5 text-[10px] font-mono rounded bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500"
                        style={{ color: '#a8a29e', border: '1px solid transparent', colorScheme: 'dark' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}
                      />
                    </span>

                    {/* End date */}
                    <span className="w-28 flex justify-center">
                      <input
                        type="date"
                        value={shot.end_date || ''}
                        onChange={e => ctx?.updateShot?.(shot.id, { end_date: e.target.value || null })}
                        className="px-1 py-0.5 text-[10px] font-mono rounded bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500"
                        style={{ color: '#a8a29e', border: '1px solid transparent', colorScheme: 'dark' }}
                        onMouseEnter={e => { e.target.style.borderColor = '#44403c' }}
                        onMouseLeave={e => { e.target.style.borderColor = 'transparent' }}
                      />
                    </span>

                    {/* Actions */}
                    <span className="w-20 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={() => onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' })}
                        className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#ef4444' }} title="Delete shot">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </div>
                ))}

                {/* Add shot row */}
                {g.scene && (
                  <button type="button" onClick={() => onNewShot(g.sceneId)}
                    className="flex items-center gap-2 w-full px-4 py-2 text-[10px] font-mono uppercase tracking-wider hover:bg-stone-800/40 transition-colors"
                    style={{ paddingLeft: 48, color: '#57534e', borderBottom: '1px solid #292524', borderLeft: '3px solid #44403c' }}>
                    <Plus className="w-3 h-3" />
                    Add shot
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
function ShotGallery({ shotGroups, gallerySize, ctx, onOpenSceneDetail, onRequestDelete }) {
  const sizeMap = { sm: 160, md: 220, lg: 300 }
  const cardW = sizeMap[gallerySize] || sizeMap.md

  if (shotGroups.length === 0 || shotGroups.every(g => g.shots.length === 0)) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-[12px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
          No shots yet
        </span>
      </div>
    )
  }

  return (
    <div className="p-4">
      {shotGroups.map(g => (
        <div key={g.sceneId} className="mb-5 last:mb-0">
          {/* Scene group header */}
          <div className="flex items-center gap-2 mb-3">
            <Film className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
              {g.label}
            </span>
            <span className="text-[10px] font-mono" style={{ color: '#57534e' }}>
              {g.shots.length} shot{g.shots.length !== 1 ? 's' : ''}
            </span>
            {g.scene && (
              <button type="button"
                onClick={() => onOpenSceneDetail(g.sceneId)}
                className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#78716c' }} title="Scene details">
                <Eye className="w-3 h-3" />
              </button>
            )}
            <div className="flex-1 h-px ml-2" style={{ backgroundColor: '#44403c' }} />
          </div>

          {/* Shot cards */}
          <div className="flex flex-wrap gap-3">
            {g.shots.map(shot => (
              <div key={shot.id}
                className="rounded overflow-hidden hover:ring-2 hover:ring-orange-500/50 transition-all cursor-pointer group relative"
                style={{ width: cardW, backgroundColor: '#292524', border: '1px solid #44403c' }}
                onClick={() => g.scene && onOpenSceneDetail(g.sceneId)}
              >
                {/* Thumbnail placeholder */}
                <div className="flex items-center justify-center relative"
                  style={{ height: cardW * 0.5, backgroundColor: '#1c1917', borderBottom: '1px solid #44403c' }}>
                  <Clapperboard className="w-6 h-6" style={{ color: '#44403c' }} />
                  {/* Delete button (top-right on hover) */}
                  <button type="button"
                    onClick={e => { e.stopPropagation(); onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' }) }}
                    className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-red-900/50"
                    style={{ color: '#ef4444' }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                {/* Info */}
                <div className="px-3 py-2.5 flex flex-col gap-1">
                  <span className="text-[12px] font-mono truncate font-bold" style={{ color: '#e7e5e4' }}>
                    {shot.name || 'Untitled shot'}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono uppercase" style={{ color: '#78716c' }}>
                      #{shot.shot_number ?? '—'}
                    </span>
                    <span className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm"
                      style={{ color: statusColor(shot.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(shot.status)}30` }}>
                      {fmt(shot.status || 'not_started')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}


// ─── Scene detail popup ───
function SceneDetailPopup({ sceneId, ctx, shotsByScene, assetCountByScene, taskCountByScene, onNewShot, onClose, onRequestDelete }) {
  const scene = (ctx?.scenes || []).find(s => s.id === sceneId)
  const sceneShots = shotsByScene[sceneId] || []
  const project = ctx?.project

  const [descDraft, setDescDraft] = useState(scene?.description || '')
  const [notesDraft, setNotesDraft] = useState(scene?.notes || '')
  const [editingDesc, setEditingDesc] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)

  useEffect(() => { setDescDraft(scene?.description || '') }, [scene?.description])
  useEffect(() => { setNotesDraft(scene?.notes || '') }, [scene?.notes])

  if (!scene) return null

  const sc = statusColor(scene.status)

  function handleUpdate(patch) { ctx?.updateScene?.(scene.id, patch) }

  // Format the full scene code for display
  const code = project?.project_code || 'PROJ'
  const sep = project?.scene_separator || '_'
  const digits = project?.scene_digits ?? 3
  const sceneCode = `${code}${sep}SC${String(scene.scene_number ?? 0).padStart(digits, '0')}`

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      {/* Modal */}
      <div
        className="fixed z-50 top-1/2 left-1/2 w-full max-w-2xl rounded overflow-hidden flex flex-col"
        style={{
          backgroundColor: '#292524',
          border: '2px solid #f97316',
          maxHeight: '85vh',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `3px solid ${sc}` }}>
          <div className="flex items-center gap-2.5">
            <Film className="w-4 h-4" style={{ color: '#fb923c' }} />
            <span className="text-[14px] font-mono font-bold" style={{ color: '#fb923c' }}>
              {scene.name || 'Untitled scene'}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
              style={{ color: '#78716c', backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
              {sceneCode}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-auto px-5 py-4">

          {/* Title (editable) */}
          <div className="mb-5">
            <FieldLabel>Scene name</FieldLabel>
            <PopupInlineText
              value={scene.name || ''}
              placeholder="Untitled scene"
              onCommit={v => handleUpdate({ name: v })}
            />
          </div>

          {/* Properties grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-5">
            <div>
              <FieldLabel>Status</FieldLabel>
              <select value={scene.status || 'not_started'} onChange={e => handleUpdate({ status: e.target.value })}
                className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: sc, border: '1px solid #44403c' }}>
                {SCENE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Type</FieldLabel>
              <select value={scene.type || 'interior'} onChange={e => handleUpdate({ type: e.target.value })}
                className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}>
                {SCENE_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Scene number</FieldLabel>
              <input type="number" value={scene.scene_number ?? ''} onChange={e => {
                const n = parseInt(e.target.value, 10)
                if (Number.isFinite(n) && n >= 0) handleUpdate({ scene_number: n })
              }}
                className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
            </div>
            <div>
              <FieldLabel>Shots</FieldLabel>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-mono font-bold" style={{ color: '#d6d3d1' }}>
                  {sceneShots.length}
                </span>
                <span className="text-[10px] font-mono uppercase" style={{ color: '#78716c' }}>
                  / {assetCountByScene[sceneId] || 0} assets / {taskCountByScene[sceneId] || 0} tasks
                </span>
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-5">
            <div>
              <FieldLabel>Start Date</FieldLabel>
              <input
                type="date"
                value={scene.start_date || ''}
                onChange={e => handleUpdate({ start_date: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', colorScheme: 'dark' }}
              />
            </div>
            <div>
              <FieldLabel>End Date</FieldLabel>
              <input
                type="date"
                value={scene.end_date || ''}
                onChange={e => handleUpdate({ end_date: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
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
                  className="w-full px-3 py-2 text-[12px] font-mono rounded resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', minHeight: 80 }}
                  autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => { handleUpdate({ description: descDraft }); setEditingDesc(false) }}
                    className="text-[10px] font-mono uppercase text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button type="button" onClick={() => { setDescDraft(scene.description || ''); setEditingDesc(false) }}
                    className="text-[10px] font-mono uppercase text-stone-500 hover:text-stone-400">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingDesc(true)}
                className="px-3 py-2 text-[12px] font-mono rounded cursor-pointer hover:bg-stone-800 transition-colors"
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
                  className="w-full px-3 py-2 text-[12px] font-mono rounded resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', minHeight: 60 }}
                  autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => { handleUpdate({ notes: notesDraft }); setEditingNotes(false) }}
                    className="text-[10px] font-mono uppercase text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button type="button" onClick={() => { setNotesDraft(scene.notes || ''); setEditingNotes(false) }}
                    className="text-[10px] font-mono uppercase text-stone-500 hover:text-stone-400">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingNotes(true)}
                className="px-3 py-2 text-[12px] font-mono rounded cursor-pointer hover:bg-stone-800 transition-colors"
                style={{ backgroundColor: '#1c1917', color: scene.notes ? '#a8a29e' : '#57534e', border: '1px solid #44403c', minHeight: 40 }}>
                {scene.notes || 'Click to add notes...'}
              </div>
            )}
          </div>

          {/* Shots list */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <FieldLabel>Shots ({sceneShots.length})</FieldLabel>
              <button type="button" onClick={() => onNewShot(sceneId)}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
                style={{ color: '#fb923c', border: '1px solid #44403c' }}>
                <Plus className="w-3 h-3" /> Add shot
              </button>
            </div>
            {sceneShots.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] font-mono uppercase tracking-wider rounded"
                style={{ color: '#57534e', backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
                No shots yet
              </div>
            ) : (
              <div className="rounded overflow-hidden" style={{ border: '1px solid #44403c' }}>
                {sceneShots.map(shot => (
                  <div key={shot.id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-stone-800/40 transition-colors group/shot"
                    style={{ borderBottom: '1px solid #292524' }}>
                    <Film className="w-3 h-3 flex-shrink-0" style={{ color: '#57534e' }} />
                    <span className="flex-1 text-[11px] font-mono truncate" style={{ color: '#d6d3d1' }}>
                      {shot.name || 'Untitled shot'}
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: '#78716c' }}>
                      #{shot.shot_number ?? '—'}
                    </span>
                    <span className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm"
                      style={{ color: statusColor(shot.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(shot.status)}30` }}>
                      {fmt(shot.status || 'not_started')}
                    </span>
                    <button type="button"
                      onClick={() => onRequestDelete({ type: 'shot', id: shot.id, name: shot.name || 'Untitled' })}
                      className="p-0.5 rounded hover:bg-stone-700 transition-colors opacity-0 group-hover/shot:opacity-100"
                      style={{ color: '#ef4444' }}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex items-center justify-between flex-shrink-0" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button"
            onClick={() => { onClose(); onRequestDelete({ type: 'scene', id: scene.id, name: scene.name || 'Untitled' }) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-red-900/30"
            style={{ color: '#ef4444', border: '1px solid #ef444440' }}>
            <Trash2 className="w-3.5 h-3.5" /> Delete scene
          </button>
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            Close
          </button>
        </div>
      </div>
    </>
  )
}


// ─── Confirmation dialog ───
function ConfirmDialog({ title, message, onConfirm, onCancel }) {
  return (
    <>
      <div className="fixed inset-0 z-[60]" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onCancel} />
      <div className="fixed z-[60] top-1/2 left-1/2 w-full max-w-sm rounded overflow-hidden"
        style={{ backgroundColor: '#292524', border: '2px solid #ef4444', transform: 'translate(-50%, -50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3" style={{ borderBottom: '1px solid #44403c' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" style={{ color: '#ef4444' }} />
            <span className="text-[13px] font-mono font-bold" style={{ color: '#ef4444' }}>{title}</span>
          </div>
        </div>
        <div className="px-5 py-4">
          <p className="text-[12px] font-mono leading-relaxed" style={{ color: '#a8a29e' }}>
            {message}
          </p>
        </div>
        <div className="px-5 py-3 flex items-center justify-end gap-3" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button" onClick={onCancel}
            className="px-4 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            className="px-4 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-red-800"
            style={{ color: '#fff7ed', backgroundColor: '#ef4444', border: '1px solid #dc2626' }}>
            Delete
          </button>
        </div>
      </div>
    </>
  )
}


// ─── Filter panel ───
function SceneFilterPanel({ filters, onAdd, onUpdate, onRemove, onClose }) {
  function getOptions(f) {
    const def = SCENE_FILTER_FIELDS.find(ff => ff.value === f.field)
    if (!def) return []
    return (def.options || []).map(o => ({ value: o, label: fmt(o) }))
  }
  function getType(f) {
    return SCENE_FILTER_FIELDS.find(ff => ff.value === f.field)?.type || 'text'
  }
  return (
    <div className="px-4 py-3 flex flex-col gap-2" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}>
      {filters.map((f, i) => {
        const type = getType(f)
        const ops = FILTER_OPS[type] || FILTER_OPS.text
        const needsValue = !['is_empty','is_not_empty'].includes(f.op)
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase font-semibold" style={{ color: '#78716c', width: 40 }}>
              {i === 0 ? 'Where' : 'And'}
            </span>
            <select value={f.field} onChange={e => onUpdate(i, { field: e.target.value, value: '' })}
              className="px-2 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}>
              {SCENE_FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select value={f.op} onChange={e => onUpdate(i, { op: e.target.value })}
              className="px-2 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}>
              {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
              type === 'select' ? (
                <select value={f.value} onChange={e => onUpdate(i, { value: e.target.value })}
                  className="px-2 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}>
                  <option value="">-- select --</option>
                  {getOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" value={f.value || ''} onChange={e => onUpdate(i, { value: e.target.value })}
                  placeholder="value..."
                  className="px-2 py-1.5 text-[11px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 w-36"
                  style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }} />
              )
            )}
            <button type="button" onClick={() => onRemove(i)} className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#fca5a5' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}
      <div className="flex items-center gap-2 mt-1">
        <button type="button" onClick={onAdd}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded hover:bg-stone-800 transition-colors"
          style={{ color: '#fb923c', border: '1px solid #44403c' }}>
          <Plus className="w-3.5 h-3.5" /> Add filter
        </button>
        {filters.length > 0 && (
          <button type="button" onClick={onClose}
            className="px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded hover:bg-stone-800 transition-colors"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            Done
          </button>
        )}
      </div>
    </div>
  )
}


// ─── Saved views dropdown ───
function SceneSavedViewsDropdown({ views, onLoad, onDelete, onSave }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
        style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
        <BookmarkPlus className="w-3.5 h-3.5" /> Views
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded overflow-hidden z-30"
          style={{ backgroundColor: '#292524', border: '1px solid #44403c', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {views.length === 0 && (
            <div className="px-3 py-2.5 text-[11px] font-mono italic" style={{ color: '#78716c' }}>No saved views</div>
          )}
          {views.map(v => (
            <div key={v.id} className="flex items-center justify-between px-3 py-2 hover:bg-stone-700 cursor-pointer transition-colors"
              onClick={() => { onLoad(v); setOpen(false) }}>
              <span className="text-[11px] font-mono truncate" style={{ color: '#d6d3d1' }}>{v.name}</span>
              <button type="button" onClick={e => { e.stopPropagation(); onDelete(v.id) }}
                className="p-0.5 hover:bg-stone-600 rounded transition-colors" style={{ color: '#fca5a5' }}>
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #44403c' }}>
            <button type="button" onClick={() => { onSave(); setOpen(false) }}
              className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-stone-700 text-[11px] font-mono transition-colors"
              style={{ color: '#fb923c' }}>
              <Save className="w-3 h-3" /> Save current view
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Bulk select dropdown ───
function SceneBulkSelect({ label, options, onPick }) {
  return (
    <select defaultValue="" onChange={e => { if (e.target.value !== '') { onPick(e.target.value); e.target.value = '' } }}
      className="px-2 py-1 text-[10px] font-mono uppercase rounded focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
      style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#a8a29e' }}>
      <option value="" disabled>{label}</option>
      {options.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
    </select>
  )
}


// ─── Inline text editor (table rows) ───
function InlineText({ value, placeholder, onCommit, size = 'md' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus() }, [editing])

  function commit() {
    const trimmed = draft.trim()
    if (trimmed !== value) onCommit(trimmed)
    setEditing(false)
  }

  const textSize = size === 'sm' ? 'text-[11px]' : 'text-[12px]'
  const textColor = size === 'sm' ? '#a8a29e' : '#e7e5e4'

  if (editing) {
    return (
      <input ref={inputRef} type="text" value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        className={`w-full ${textSize} font-mono px-1.5 py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-orange-500`}
        style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
      />
    )
  }

  return (
    <span onClick={() => setEditing(true)}
      className={`${textSize} font-mono truncate cursor-pointer hover:text-orange-400 transition-colors block`}
      style={{ color: value ? textColor : '#57534e' }}>
      {value || placeholder}
    </span>
  )
}


// ─── Popup inline text (larger, for detail popup titles) ───
function PopupInlineText({ value, placeholder, onCommit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus() }, [editing])

  function commit() {
    const trimmed = draft.trim()
    if (trimmed !== value) onCommit(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input ref={inputRef} type="text" value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        className="w-full text-[13px] font-mono px-2.5 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
      />
    )
  }

  return (
    <div onClick={() => setEditing(true)}
      className="text-[13px] font-mono px-2.5 py-1.5 rounded cursor-pointer hover:bg-stone-800 transition-colors"
      style={{ backgroundColor: '#1c1917', color: value ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
      {value || placeholder}
    </div>
  )
}


// ─── Field label (reused in detail popup) ───
function FieldLabel({ children }) {
  return (
    <label className="block text-[10px] font-mono uppercase tracking-wider font-bold mb-1.5" style={{ color: '#78716c' }}>
      {children}
    </label>
  )
}
