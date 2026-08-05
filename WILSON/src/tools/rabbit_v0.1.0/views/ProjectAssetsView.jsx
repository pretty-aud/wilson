// ============================================================
// RABBIT — ProjectAssetsView
// ============================================================
//
// Full-featured asset management view with two modes:
//
//   1. TABLE — flex-based rows matching the Tasks tab styling,
//      with complex filtering, sorting, grouping, thumbnails,
//      inline editing, and hover-reveal action buttons.
//
//   2. GALLERY — card-based grid with thumbnail previews,
//      status badges, and inline editing.
//
// Saved view profiles let users name and recall filter/sort/
// group/view-mode configurations.
//
// ── UX Laws applied ──
// • Aesthetic-Usability Effect — polished surfaces, spacing, color harmony
// • Law of Common Region — rows & cards as clearly bounded groups
// • Law of Proximity — tight internal spacing, generous external gaps
// • Von Restorff Effect — status accent bars for instant recognition
// • Doherty Threshold — 150-200ms transitions on all interactive elements
// • Fitts's Law — larger touch targets, prominent primary actions
// • Law of Prägnanz — clean shapes, minimal decoration
// • Law of Similarity — consistent treatment matching Tasks tab

import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  Boxes, Plus, Search, Filter, Trash2, AlertTriangle,
  Table as TableIcon, LayoutGrid, X, FileText, ImagePlus, ImageOff, History,
  Layers, ArrowUpDown, ChevronDown, ChevronRight,
  Save, BookmarkPlus, CheckSquare, Square, MinusSquare,
  Film, Clapperboard, Gamepad2, Sparkles,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import { useTaskTemplates } from '../../../components/TaskTemplates/useTaskTemplates'
import { usePermissions } from '../../../permissions/usePermissions'
import { canOnProject } from '../../../permissions/projectRoleMatrix'
import AssetStatusWarningModal from '../components/AssetStatusWarningModal'
import EditHistoryDrawer from '../components/EditHistoryDrawer'
import { RelationPickerPopup, RelationBadge, AssetRelationsSidebar } from '../components/RelationsPanel'
import FileManager from '../components/FileManager'

// ── Thumbnail sizing ──
const BASE_ROW_H = 36
const THUMB_SIZES = {
  sm: { label: '1\u00D7', h: BASE_ROW_H },
  md: { label: '2\u00D7', h: BASE_ROW_H * 2 },
  lg: { label: '3\u00D7', h: BASE_ROW_H * 3 },
}

export const ASSET_TYPES = [
  'character','environment','prop','vehicle','vfx','animation','rig','model',
  'texture','audio','vo','music','cinematic','ui','level','script','treatment',
  'concept','storyboard','illustration','document','deliverable','other',
]

export const ASSET_STATUSES = [
  'not_started','in_progress','pending_review','needs_revisions',
  'approved','final','blocked','on_hold','omitted',
]

export const TASK_STATUSES = [
  'waiting_to_start','in_progress','pending_review','needs_revisions',
  'approved','final','blocked','on_hold','omitted',
]

// ── Filter config ──
const ASSET_FILTER_FIELDS = [
  { value: 'status',   label: 'Status',  type: 'select', options: ASSET_STATUSES },
  { value: 'type',     label: 'Type',    type: 'select', options: ASSET_TYPES },
  { value: 'phase_id', label: 'Phase',   type: 'select', dynamic: 'phases' },
  { value: 'name',     label: 'Name',    type: 'text' },
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

// ── Sort config ──
const ASSET_SORTABLE_FIELDS = [
  { value: 'name',       label: 'Name' },
  { value: 'type',       label: 'Type' },
  { value: 'status',     label: 'Status' },
  { value: 'start_date', label: 'Start date' },
  { value: 'due_date',   label: 'Due date' },
  { value: 'created_at', label: 'Created' },
]

// ── Group config ──
const ASSET_GROUPABLE_FIELDS = [
  { value: '',       label: 'No grouping' },
  { value: 'type',   label: 'Type' },
  { value: 'phase',  label: 'Phase' },
  { value: 'status', label: 'Status' },
]

const SAVED_VIEWS_KEY = 'rabbit_asset_saved_views'

// ── Topological sort for dependency-ordered task creation ──
function topoSort(tasks) {
  const visited = new Set()
  const result = []
  const byId = {}
  for (const t of tasks) byId[t.id] = t

  function visit(id) {
    if (visited.has(id)) return
    visited.add(id)
    const t = byId[id]
    if (!t) return
    for (const depId of (t.depends_on || [])) visit(depId)
    result.push(t)
  }

  for (const t of tasks) visit(t.id)
  return result
}

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
export default function ProjectAssetsView() {
  const ctx = useRabbit()
  const assets  = ctx?.assets  || []
  const phases  = ctx?.phases  || []
  const tasks   = ctx?.tasks   || []
  const project = ctx?.project

  // ── View state ──
  const [viewMode, setViewMode]   = useState('table')   // table | gallery
  const [search, setSearch]       = useState('')
  const [filters, setFilters]     = useState([])         // [{ field, op, value }]
  const [sortField, setSortField] = useState('')
  const [sortDir, setSortDir]     = useState('asc')
  const [groupBy, setGroupBy]     = useState('')          // '' | 'type' | 'phase' | 'status'
  const [thumbSize, setThumbSize] = useState('sm')
  const [showFilterPanel, setShowFilterPanel] = useState(false)

  // Saved views
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || '[]') } catch { return [] }
  })
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')

  // Detail / warning
  const [warningAssetId, setWarningAssetId] = useState(null)
  const [detailAssetId, setDetailAssetId]   = useState(null)
  const [thumbRevision, setThumbRevision]   = useState(0)

  // Edit history (Session 5) — DB-side RLS is the real gate; this only
  // hides the affordance below manager.
  const { can, role, ready: permsReady } = usePermissions()
  const canViewHistory = can('rabbit.history.view')
  const [historyAssetId, setHistoryAssetId] = useState(null)

  // Entity writes (Session 6) — DB-side RLS is the real gate; this only
  // hides write affordances for staffed-project reviewers.
  // See ProjectTasksView — the New asset button is behind this same flag, so
  // a session read still in flight would take it away too.
  const canWrite = canOnProject(
    {
      appRole: role,
      projectRole: ctx?.myProjectRole,
      isStaffed: ctx?.projectIsStaffed,
      ready: permsReady,
    },
    'project.entity.write'
  )

  // Collapsed groups
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  function toggleGroup(key) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── Lookups ──
  const phaseById = useMemo(() => {
    const map = {}
    for (const p of phases) map[p.id] = p
    return map
  }, [phases])

  const taskCountByAsset = useMemo(() => {
    const map = {}
    for (const t of tasks) {
      if (!t.asset_id) continue
      map[t.asset_id] = (map[t.asset_id] || 0) + 1
    }
    return map
  }, [tasks])

  // ── Filtering ──
  const applyFilters = useCallback((assetList) => {
    let result = assetList
    // Text search
    const s = search.trim().toLowerCase()
    if (s) result = result.filter(a => (a.name || '').toLowerCase().includes(s))
    // Complex filters
    for (const f of filters) {
      if (!f.field) continue
      result = result.filter(a => {
        const val = a[f.field]
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
  }, [search, filters])

  // ── Sorting ──
  const applySort = useCallback((assetList) => {
    if (!sortField) return assetList.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const sorted = [...assetList]
    const dir = sortDir === 'desc' ? -1 : 1
    sorted.sort((a, b) => {
      let va = a[sortField] ?? ''
      let vb = b[sortField] ?? ''
      if (sortField === 'status') {
        va = ASSET_STATUSES.indexOf(va); vb = ASSET_STATUSES.indexOf(vb)
      } else if (sortField === 'type') {
        va = ASSET_TYPES.indexOf(va); vb = ASSET_TYPES.indexOf(vb)
      } else if (typeof va === 'string') {
        va = va.toLowerCase(); vb = (vb || '').toLowerCase()
      }
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
    return sorted
  }, [sortField, sortDir])

  const processed = useMemo(() => applySort(applyFilters(assets)), [assets, applyFilters, applySort])

  // ── Grouping ──
  const groups = useMemo(() => {
    if (!groupBy) return null
    const map = {}
    for (const a of processed) {
      let key
      if (groupBy === 'type')   key = a.type || 'other'
      else if (groupBy === 'phase')  key = a.phase_id || '__none__'
      else if (groupBy === 'status') key = a.status || 'not_started'
      else key = '__all__'
      if (!map[key]) map[key] = []
      map[key].push(a)
    }
    let sortedKeys
    if (groupBy === 'type')   sortedKeys = ASSET_TYPES.filter(t => map[t])
    else if (groupBy === 'status') sortedKeys = ASSET_STATUSES.filter(s => map[s])
    else if (groupBy === 'phase') {
      sortedKeys = phases.map(p => p.id).filter(id => map[id])
      if (map.__none__) sortedKeys.push('__none__')
    } else {
      sortedKeys = Object.keys(map)
    }
    return sortedKeys.map(key => ({
      key,
      label: resolveGroupLabel(groupBy, key),
      assets: map[key] || [],
    }))
  }, [processed, groupBy, phases, phaseById])

  function resolveGroupLabel(field, key) {
    if (key === '__none__') return 'No phase'
    if (field === 'phase') return phaseById[key]?.name || key
    return fmt(key)
  }

  function groupAccent(field, key) {
    if (field === 'status') return statusColor(key)
    return '#fb923c'
  }

  // ── New-asset creation popup (deferred until confirm) ──
  const [showNewAssetPopup, setShowNewAssetPopup] = useState(false)

  // ── Handlers ──
  function handleAddAsset() {
    setShowNewAssetPopup(true)
  }

  // ── Saved views ──
  function saveCurrentView() {
    if (!saveName.trim()) return
    const view = {
      id: Date.now().toString(),
      name: saveName.trim(),
      filters, sortField, sortDir, groupBy, viewMode, thumbSize,
    }
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
    if (view.thumbSize) setThumbSize(view.thumbSize)
  }

  function deleteSavedView(id) {
    const next = savedViews.filter(v => v.id !== id)
    setSavedViews(next)
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next))
  }

  // ── Filter CRUD ──
  function addFilter() {
    setFilters(prev => [...prev, { field: 'status', op: 'is', value: '' }])
  }
  function updateFilter(idx, patch) {
    setFilters(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }
  function removeFilter(idx) {
    setFilters(prev => prev.filter((_, i) => i !== idx))
  }

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
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-2 flex-wrap flex-shrink-0" style={{ borderBottom: '1px solid #44403c' }}>

        {/* Filter */}
        <button type="button" onClick={() => setShowFilterPanel(!showFilterPanel)}
          className="flex items-center gap-1.5 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm hover:bg-stone-700 transition-colors"
          style={{ color: filters.length > 0 ? '#fb923c' : '#78716c', border: '1px solid #44403c' }}>
          <Filter className="w-3 h-3" />
          Filter{filters.length > 0 ? ` (${filters.length})` : ''}
        </button>

        {/* Sort */}
        <div className="flex items-center gap-1">
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            className="px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm focus:outline-none cursor-pointer"
            style={{ backgroundColor: '#292524', color: sortField ? '#fb923c' : '#78716c', border: '1px solid #44403c' }}>
            <option value="">Sort…</option>
            {ASSET_SORTABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          {sortField && (
            <button type="button" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              className="p-1.5 rounded-sm hover:bg-stone-700 transition-colors"
              style={{ color: sortField ? '#fb923c' : '#57534e' }}>
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* Group */}
        <select value={groupBy}
          onChange={e => setGroupBy(e.target.value)}
          className="px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm focus:outline-none cursor-pointer"
          style={{ backgroundColor: '#292524', color: groupBy ? '#fb923c' : '#78716c', border: '1px solid #44403c' }}>
          {ASSET_GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* View mode toggle — segmented control */}
        <div className="flex rounded-sm overflow-hidden" style={{ border: '1px solid #44403c' }}>
          <button type="button" onClick={() => setViewMode('table')}
            className="flex items-center gap-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: viewMode === 'table' ? '#ea580c' : 'transparent',
              color: viewMode === 'table' ? '#fff7ed' : '#78716c',
            }}>
            <TableIcon className="w-3 h-3" /> Table
          </button>
          <button type="button" onClick={() => setViewMode('gallery')}
            className="flex items-center gap-1 px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: viewMode === 'gallery' ? '#ea580c' : 'transparent',
              color: viewMode === 'gallery' ? '#fff7ed' : '#78716c',
            }}>
            <LayoutGrid className="w-3 h-3" /> Gallery
          </button>
        </div>

        {/* Thumbnail size selector (table mode) */}
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

        {/* Saved views dropdown */}
        <AssetSavedViewsDropdown
          views={savedViews}
          onLoad={loadView}
          onDelete={deleteSavedView}
          onSave={() => setShowSaveDialog(true)}
        />

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* Search */}
        <div className="flex items-center flex-1 min-w-[120px] max-w-[240px] rounded-sm" style={{ border: '1px solid #44403c', backgroundColor: '#292524' }}>
          <Search className="w-3 h-3 ml-2 flex-shrink-0" style={{ color: '#57534e' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search assets…"
            className="flex-1 px-2 py-1.5 text-[10.5px] font-mono bg-transparent focus:outline-none"
            style={{ color: '#d6d3d1' }} />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="p-1 mr-0.5 hover:bg-stone-700 rounded transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Right: count + add asset */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10.5px] font-mono uppercase tracking-wider px-1" style={{ color: '#78716c' }}>
            {processed.length}/{assets.length}
          </span>

          {canWrite && (
            <button type="button" onClick={handleAddAsset}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm transition-colors"
              style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
              <Plus className="w-3.5 h-3.5" /> New asset
            </button>
          )}
        </div>
      </div>

      {/* ── Filter panel ── */}
      {showFilterPanel && (
        <AssetFilterPanel
          filters={filters}
          phases={phases}
          onAdd={addFilter}
          onUpdate={updateFilter}
          onRemove={removeFilter}
          onClose={() => setShowFilterPanel(false)}
        />
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'table' ? (
          <AssetTable
            assets={processed}
            groups={groups}
            groupBy={groupBy}
            phases={phases}
            phaseById={phaseById}
            taskCountByAsset={taskCountByAsset}
            ctx={ctx}
            canWrite={canWrite}
            thumbSize={thumbSize}
            thumbRevision={thumbRevision}
            collapsedGroups={collapsedGroups}
            toggleGroup={toggleGroup}
            groupAccent={groupAccent}
            onThumbChanged={() => setThumbRevision(r => r + 1)}
            onWarningClick={(id) => setWarningAssetId(id)}
            onDetailClick={(id) => setDetailAssetId(id)}
            onHistoryClick={canViewHistory ? (id) => setHistoryAssetId(id) : null}
          />
        ) : groups ? (
          // Gallery — grouped
          groups.map(g => (
            <div key={g.key}>
              <div className="flex items-center gap-2 px-5 py-2.5 cursor-pointer hover:bg-stone-800/30 transition-colors"
                style={{ borderBottom: '1px solid #44403c', borderLeft: `3px solid ${groupAccent(groupBy, g.key)}` }}
                onClick={() => toggleGroup(g.key)}>
                {collapsedGroups.has(g.key)
                  ? <ChevronRight className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
                  : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#78716c' }} />}
                <span className="text-[12.5px] font-mono uppercase tracking-wider font-bold" style={{ color: groupAccent(groupBy, g.key) }}>
                  {g.label}
                </span>
                <span className="text-[10.5px] font-mono" style={{ color: '#78716c' }}>
                  ({g.assets.length})
                </span>
              </div>
              {!collapsedGroups.has(g.key) && (
                <AssetGallery
                  assets={g.assets}
                  phaseById={phaseById}
                  taskCountByAsset={taskCountByAsset}
                  ctx={ctx}
                  canWrite={canWrite}
                  thumbRevision={thumbRevision}
                  onThumbChanged={() => setThumbRevision(r => r + 1)}
                  onWarningClick={(id) => setWarningAssetId(id)}
                  onDetailClick={(id) => setDetailAssetId(id)}
                />
              )}
            </div>
          ))
        ) : (
          // Gallery — ungrouped
          <AssetGallery
            assets={processed}
            phaseById={phaseById}
            taskCountByAsset={taskCountByAsset}
            ctx={ctx}
            canWrite={canWrite}
            thumbRevision={thumbRevision}
            onThumbChanged={() => setThumbRevision(r => r + 1)}
            onWarningClick={(id) => setWarningAssetId(id)}
            onDetailClick={(id) => setDetailAssetId(id)}
          />
        )}
      </div>

      {/* ── Save view dialog ── */}
      {showSaveDialog && (
        <>
          <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={() => setShowSaveDialog(false)} />
          <div className="fixed z-50 top-1/2 left-1/2 w-80 rounded p-5 flex flex-col gap-4"
            style={{ backgroundColor: '#292524', border: '2px solid #f97316', transform: 'translate(-50%,-50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <span className="text-[13.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>Save current view</span>
            <input autoFocus type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
              placeholder="View name..."
              onKeyDown={e => { if (e.key === 'Enter') saveCurrentView() }}
              className="px-3 py-2 text-xs font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowSaveDialog(false)}
                className="px-4 py-1.5 text-[11.5px] font-mono rounded hover:bg-stone-700 transition-colors"
                style={{ color: '#a8a29e', border: '1px solid #44403c' }}>Cancel</button>
              <button type="button" onClick={saveCurrentView}
                className="px-4 py-1.5 text-[11.5px] font-mono rounded transition-colors"
                style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>Save</button>
            </div>
          </div>
        </>
      )}

      {warningAssetId && (
        <AssetStatusWarningModal
          asset={assets.find(a => a.id === warningAssetId)}
          onClose={() => setWarningAssetId(null)}
        />
      )}

      {detailAssetId && (
        <AssetDetailPopup
          asset={assets.find(a => a.id === detailAssetId)}
          tasks={tasks.filter(t => t.asset_id === detailAssetId)}
          phase={phaseById[assets.find(a => a.id === detailAssetId)?.phase_id]}
          ctx={ctx}
          thumbRevision={thumbRevision}
          onThumbChanged={() => setThumbRevision(r => r + 1)}
          onClose={() => setDetailAssetId(null)}
        />
      )}

      {showNewAssetPopup && (
        <NewAssetPopup
          ctx={ctx}
          phases={phases}
          onCreated={(assetId) => {
            setShowNewAssetPopup(false)
            if (assetId) setDetailAssetId(assetId)
          }}
          onClose={() => setShowNewAssetPopup(false)}
        />
      )}

      {historyAssetId && (
        <EditHistoryDrawer
          entityType="assets"
          entityId={historyAssetId}
          entityLabel={assets.find(a => a.id === historyAssetId)?.name}
          onClose={() => setHistoryAssetId(null)}
        />
      )}

    </div>
  )
}


// ═════════════════════════════════════════════════════
// FILTER PANEL
// ═════════════════════════════════════════════════════
function AssetFilterPanel({ filters, phases, onAdd, onUpdate, onRemove, onClose }) {
  function getOptions(f) {
    const def = ASSET_FILTER_FIELDS.find(ff => ff.value === f.field)
    if (!def) return []
    if (def.dynamic === 'phases') return phases.map(p => ({ value: p.id, label: p.name || 'Untitled' }))
    return (def.options || []).map(o => ({ value: o, label: fmt(o) }))
  }
  function getType(f) {
    return ASSET_FILTER_FIELDS.find(ff => ff.value === f.field)?.type || 'text'
  }
  return (
    <div className="px-4 py-3 flex flex-col gap-2" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}>
      {filters.map((f, i) => {
        const type = getType(f)
        const ops = FILTER_OPS[type] || FILTER_OPS.text
        const needsValue = !['is_empty','is_not_empty'].includes(f.op)
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10.5px] font-mono uppercase font-semibold" style={{ color: '#78716c', width: 40 }}>
              {i === 0 ? 'Where' : 'And'}
            </span>
            <select value={f.field} onChange={e => onUpdate(i, { field: e.target.value, value: '' })}
              className="px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}>
              {ASSET_FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select value={f.op} onChange={e => onUpdate(i, { op: e.target.value })}
              className="px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}>
              {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
              type === 'select' ? (
                <select value={f.value} onChange={e => onUpdate(i, { value: e.target.value })}
                  className="px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}>
                  <option value="">-- select --</option>
                  {getOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" value={f.value || ''} onChange={e => onUpdate(i, { value: e.target.value })}
                  placeholder="value..."
                  className="px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 w-36"
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
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded hover:bg-stone-800 transition-colors"
          style={{ color: '#fb923c', border: '1px solid #44403c' }}>
          <Plus className="w-3.5 h-3.5" /> Add filter
        </button>
        {filters.length > 0 && (
          <button type="button" onClick={onClose}
            className="px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded hover:bg-stone-800 transition-colors"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            Done
          </button>
        )}
      </div>
    </div>
  )
}


// ═════════════════════════════════════════════════════
// SAVED VIEWS DROPDOWN
// ═════════════════════════════════════════════════════
function AssetSavedViewsDropdown({ views, onLoad, onDelete, onSave }) {
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
        className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
        style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
        <BookmarkPlus className="w-3.5 h-3.5" /> Views
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded overflow-hidden z-30"
          style={{ backgroundColor: '#292524', border: '1px solid #44403c', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {views.length === 0 && (
            <div className="px-3 py-2.5 text-[11.5px] font-mono italic" style={{ color: '#78716c' }}>No saved views</div>
          )}
          {views.map(v => (
            <div key={v.id} className="flex items-center justify-between px-3 py-2 hover:bg-stone-700 cursor-pointer transition-colors"
              onClick={() => { onLoad(v); setOpen(false) }}>
              <span className="text-[11.5px] font-mono truncate" style={{ color: '#d6d3d1' }}>{v.name}</span>
              <button type="button" onClick={e => { e.stopPropagation(); onDelete(v.id) }}
                className="p-0.5 hover:bg-stone-600 rounded transition-colors" style={{ color: '#fca5a5' }}>
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #44403c' }}>
            <button type="button" onClick={() => { onSave(); setOpen(false) }}
              className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-stone-700 text-[11.5px] font-mono transition-colors"
              style={{ color: '#fb923c' }}>
              <Save className="w-3 h-3" /> Save current view
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ═════════════════════════════════════════════════════
// TABLE VIEW (flex-based, matching Tasks tab)
// ═════════════════════════════════════════════════════
function AssetTable({ assets, groups, groupBy, phases, phaseById, taskCountByAsset, ctx, canWrite, thumbSize, thumbRevision, collapsedGroups, toggleGroup, groupAccent, onThumbChanged, onWarningClick, onDetailClick, onHistoryClick }) {
  const rowH = THUMB_SIZES[thumbSize]?.h || BASE_ROW_H

  // ── Multi-select state ──
  const [selected, setSelected] = useState(new Set())
  const allAssetIds = useMemo(() => {
    if (groups) return groups.flatMap(g => g.assets.map(a => a.id))
    return assets.map(a => a.id)
  }, [groups, assets])
  const allSelected = allAssetIds.length > 0 && allAssetIds.every(id => selected.has(id))
  const someSelected = selected.size > 0

  function toggleOne(id) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(allAssetIds))
  }
  function clearSelection() { setSelected(new Set()) }
  function bulkUpdate(patch) {
    for (const id of selected) ctx?.updateAsset?.(id, patch)
    clearSelection()
  }
  // Bulk keeps its confirm (large blast radius); single rows rely on undo.
  function bulkDelete() {
    if (!window.confirm(`Delete ${selected.size} asset${selected.size === 1 ? '' : 's'}?`)) return
    // Batch deletes reject on partial failure — the provider already
    // records the error in its state, so just swallow the rejection.
    ctx?.deleteAssets?.([...selected])?.catch(() => {})
    clearSelection()
  }

  const columns = [
    { key: 'name',        label: 'Name',        flex: 3 },
    { key: 'type',        label: 'Type',        flex: 1.2 },
    { key: 'phase_id',    label: 'Phase',       flex: 1.2 },
    { key: 'status',      label: 'Status',      flex: 1.5 },
    { key: 'start_date',  label: 'Start',       flex: 1 },
    { key: 'due_date',    label: 'Due',         flex: 1 },
    { key: 'description', label: 'Description', flex: 1.5 },
    { key: 'tasks',       label: 'Tasks',       flex: 0.6 },
    { key: '_actions',    label: '',            flex: onHistoryClick ? 0.7 : 0.4 },
  ]

  if (assets.length === 0 && (!groups || groups.length === 0)) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <Boxes className="w-12 h-12" style={{ color: '#44403c' }} />
        <span className="text-[13.5px] font-mono" style={{ color: '#78716c' }}>No assets yet</span>
        <span className="text-[11.5px] font-mono" style={{ color: '#57534e' }}>Click "New asset" to get started</span>
      </div>
    )
  }

  return (
    <div className="min-w-full relative flex flex-col gap-1 p-3">
      {/* Header */}
      <div className="relative flex sticky top-0 z-10" style={{ borderBottom: '1px solid #44403c' }}>
        {/* ── Bulk-action bar (overlays header) ── */}
        {someSelected && (
          <div className="absolute top-0 z-20 flex items-center gap-3 h-full px-3 rounded-sm"
            style={{ left: 36, backgroundColor: '#292524', border: '1px solid #ea580c', width: 'fit-content' }}>
            <span className="text-[11.5px] font-mono font-bold flex-shrink-0" style={{ color: '#fb923c' }}>
              {selected.size} selected
            </span>
            {canWrite && (
              <>
                <div style={{ width: 1, height: 18, backgroundColor: '#44403c' }} />
                <AssetBulkSelect label="Status" options={ASSET_STATUSES} onPick={v => bulkUpdate({ status: v })} />
                <AssetBulkSelect label="Type" options={ASSET_TYPES} onPick={v => bulkUpdate({ type: v })} />
                <AssetBulkSelect label="Phase" options={phases.map(p => p.id)} labels={phases.reduce((m, p) => { m[p.id] = p.name; return m }, {})} onPick={v => bulkUpdate({ phase_id: v || null })} allowEmpty />
                <div style={{ width: 1, height: 18, backgroundColor: '#44403c' }} />
                <button type="button" onClick={bulkDelete}
                  className="flex items-center gap-1 px-2 py-1 rounded hover:bg-red-900/40 transition-colors"
                  style={{ color: '#fca5a5' }}>
                  <Trash2 className="w-3 h-3" /> <span className="text-[10.5px] font-mono uppercase">Delete</span>
                </button>
              </>
            )}
            <button type="button" onClick={clearSelection}
              className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {/* Checkbox column */}
        <div className="flex items-center justify-center px-2" style={{ width: 36, flexShrink: 0 }}>
          <button type="button" onClick={toggleAll} className="p-0.5 rounded hover:bg-stone-700 transition-colors">
            {allSelected
              ? <CheckSquare className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
              : someSelected
                ? <MinusSquare className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
                : <Square className="w-3.5 h-3.5" style={{ color: '#57534e' }} />}
          </button>
        </div>
        {/* Thumbnail spacer */}
        <div style={{ width: rowH, flexShrink: 0 }} />
        {columns.map(c => (
          <div key={c.key} className="px-3.5 py-2.5 text-[10.5px] font-mono uppercase tracking-wider font-semibold text-left"
            style={{ color: '#a8a29e', flex: c.flex, minWidth: 0 }}>
            {c.label}
          </div>
        ))}
      </div>

      {/* Rows */}
      {groups ? (
        groups.map(g => {
          const accent = groupAccent(groupBy, g.key)
          const collapsed = collapsedGroups.has(g.key)
          return (
            <div key={g.key}>
              {/* Group header */}
              <div className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer hover:bg-stone-800/30 transition-colors"
                style={{ borderBottom: '1px solid #44403c', borderLeft: `3px solid ${accent}` }}
                onClick={() => toggleGroup(g.key)}>
                {collapsed
                  ? <ChevronRight className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
                  : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#78716c' }} />}
                <span className="text-[12.5px] font-mono uppercase tracking-wider font-bold" style={{ color: accent }}>
                  {g.label}
                </span>
                <span className="text-[10.5px] font-mono" style={{ color: '#78716c' }}>
                  ({g.assets.length})
                </span>
              </div>
              {/* Group rows */}
              {!collapsed && g.assets.map(a => (
                <AssetRow
                  key={a.id}
                  asset={a}
                  columns={columns}
                  phases={phases}
                  phaseLabel={phaseById[a.phase_id]?.name || ''}
                  taskCount={taskCountByAsset[a.id] || 0}
                  warning={ctx?.selectAssetStatusWarning?.(a)}
                  rowH={rowH}
                  thumbSize={thumbSize}
                  thumbRevision={thumbRevision}
                  onUpdate={(patch) => ctx.updateAsset(a.id, patch)}
                  onDelete={canWrite ? () => ctx.deleteAsset(a.id) : null}
                  onWarningClick={() => onWarningClick?.(a.id)}
                  onDetailClick={() => onDetailClick?.(a.id)}
                  onHistoryClick={onHistoryClick ? () => onHistoryClick(a.id) : null}
                  onThumbChanged={onThumbChanged}
                  isSelected={selected.has(a.id)} onToggleSelect={() => toggleOne(a.id)}
                />
              ))}
            </div>
          )
        })
      ) : (
        assets.map(a => (
          <AssetRow
            key={a.id}
            asset={a}
            columns={columns}
            phases={phases}
            phaseLabel={phaseById[a.phase_id]?.name || ''}
            taskCount={taskCountByAsset[a.id] || 0}
            warning={ctx?.selectAssetStatusWarning?.(a)}
            rowH={rowH}
            thumbSize={thumbSize}
            thumbRevision={thumbRevision}
            onUpdate={(patch) => ctx.updateAsset(a.id, patch)}
            onDelete={canWrite ? () => ctx.deleteAsset(a.id) : null}
            onWarningClick={() => onWarningClick?.(a.id)}
            onDetailClick={() => onDetailClick?.(a.id)}
            onHistoryClick={onHistoryClick ? () => onHistoryClick(a.id) : null}
            onThumbChanged={onThumbChanged}
            isSelected={selected.has(a.id)} onToggleSelect={() => toggleOne(a.id)}
          />
        ))
      )}

    </div>
  )
}

function AssetBulkSelect({ label, options, labels, onPick, allowEmpty }) {
  return (
    <select
      defaultValue=""
      onChange={e => { if (e.target.value !== '') { onPick(e.target.value); e.target.value = '' } }}
      className="px-2 py-1 text-[10.5px] font-mono uppercase rounded focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
      style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#a8a29e' }}
    >
      <option value="" disabled>{label}</option>
      {allowEmpty && <option value="">None</option>}
      {options.map(o => <option key={o} value={o}>{(labels?.[o] || o).replace(/_/g, ' ')}</option>)}
    </select>
  )
}


// ── Single asset row (flex-based, matching task rows) ──
function AssetRow({ asset, columns, phases, phaseLabel, taskCount, warning, rowH, thumbSize, thumbRevision, onUpdate, onDelete, onWarningClick, onDetailClick, onHistoryClick, onThumbChanged, isSelected, onToggleSelect }) {
  const [hovered, setHovered] = useState(false)
  const hasThumbnail = !!asset.thumbnail_image
  const effectiveH = hasThumbnail ? rowH : BASE_ROW_H

  const handleSetThumbnail = useCallback(async () => {
    if (!window.electronAPI?.rabbit?.pickImage) return
    const imagePath = await window.electronAPI.rabbit.pickImage()
    if (!imagePath) return
    await onUpdate({ thumbnail_image: imagePath })
    try {
      await window.electronAPI.rabbit.generateAssetThumbnail({ assetId: asset.id, sourcePath: imagePath })
    } catch (e) { console.error('thumbnail gen failed:', e) }
    onThumbChanged?.()
  }, [asset.id, onUpdate, onThumbChanged])

  const handleClearThumbnail = useCallback(async () => {
    await onUpdate({ thumbnail_image: null })
    try {
      await window.electronAPI.rabbit.clearAssetThumbnail({ assetId: asset.id })
    } catch {}
    onThumbChanged?.()
  }, [asset.id, onUpdate, onThumbChanged])

  // Borderless select — transparent until hover/focus
  const flatSelect = {
    backgroundColor: 'transparent', border: '1px solid transparent',
    outline: 'none', cursor: 'pointer',
  }

  function renderCell(col) {
    switch (col.key) {
      case 'name':
        return (
          <div className="flex items-center gap-1 w-full min-w-0">
            <div className="flex-1 min-w-0">
              <CellInlineText value={asset.name || ''} placeholder="Untitled" onCommit={v => onUpdate({ name: v })} />
            </div>
            <button type="button" onClick={onDetailClick}
              className="p-1 rounded hover:bg-stone-700 transition-colors flex-shrink-0"
              title="View asset details"
              style={{ color: '#fb923c', opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity 150ms ease' }}>
              <FileText className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      case 'type': {
        const sc = statusColor(asset.type === 'other' ? '' : asset.status)
        return (
          <select value={asset.type || 'other'} onChange={e => onUpdate({ type: e.target.value })}
            className="px-1.5 py-1 text-[11.5px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full hover:bg-stone-700/40 transition-colors"
            style={{ ...flatSelect, color: '#d6d3d1' }}>
            {ASSET_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
          </select>
        )
      }
      case 'phase_id':
        return (
          <select value={asset.phase_id || ''} onChange={e => onUpdate({ phase_id: e.target.value || null })}
            className="px-1.5 py-1 text-[11.5px] font-mono rounded focus:ring-2 focus:ring-orange-500 w-full truncate hover:bg-stone-700/40 transition-colors"
            style={{ ...flatSelect, color: asset.phase_id ? '#d6d3d1' : '#57534e' }}>
            <option value="">--</option>
            {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
          </select>
        )
      case 'status': {
        const sc = statusColor(asset.status)
        return (
          <div className="flex items-center gap-1 w-full min-w-0">
            <select value={asset.status || 'not_started'} onChange={e => onUpdate({ status: e.target.value })}
              className="px-1.5 py-1 text-[11.5px] font-mono rounded focus:ring-2 focus:ring-orange-500 flex-1 hover:bg-stone-700/40 transition-colors"
              style={{ ...flatSelect, color: sc }}>
              {ASSET_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
            </select>
            {warning && (
              <button type="button" onClick={onWarningClick}
                title="Tasks not yet done — click for details"
                className="p-0.5 rounded hover:bg-stone-700 flex-shrink-0">
                <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#fca5a5' }} />
              </button>
            )}
          </div>
        )
      }
      case 'start_date':
        return (
          <input
            type="date"
            value={asset.start_date || ''}
            onChange={e => onUpdate({ start_date: e.target.value || null })}
            className="px-1 py-0.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 w-full hover:bg-stone-700/40 transition-colors"
            style={{ backgroundColor: 'transparent', color: asset.start_date ? '#d6d3d1' : '#57534e', border: '1px solid transparent' }}
          />
        )
      case 'due_date':
        return (
          <input
            type="date"
            value={asset.due_date || ''}
            onChange={e => onUpdate({ due_date: e.target.value || null })}
            className="px-1 py-0.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 w-full hover:bg-stone-700/40 transition-colors"
            style={{ backgroundColor: 'transparent', color: asset.due_date ? '#d6d3d1' : '#57534e', border: '1px solid transparent' }}
          />
        )
      case 'description':
        return (
          <span className="text-[11.5px] font-mono truncate block" style={{ color: '#a8a29e' }}
            title={asset.description || ''}>
            {asset.description || '\u2014'}
          </span>
        )
      case 'tasks':
        return <span className="text-[11.5px] font-mono" style={{ color: '#a8a29e' }}>{taskCount}</span>
      case '_actions':
        return (
          <div className="flex items-center"
            style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity 150ms ease' }}>
            {onHistoryClick && (
              <button type="button" onClick={onHistoryClick}
                className="p-1 rounded hover:bg-stone-700 transition-colors"
                title="View edit history"
                style={{ color: '#a8a29e' }}>
                <History className="w-3.5 h-3.5" />
              </button>
            )}
            {onDelete && (
              // Soft delete — no confirm; the shell-level undo toast covers it.
              <button type="button" onClick={onDelete}
                className="p-1 rounded hover:bg-stone-700 transition-colors"
                style={{ color: '#fca5a5' }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )
      default:
        return <span className="text-[11.5px] font-mono" style={{ color: '#a8a29e' }}>{asset[col.key] ?? '--'}</span>
    }
  }

  return (
    <div className="flex"
      style={{
        border: isSelected ? '1px solid #ea580c' : '1px solid #44403c',
        borderRadius: 4,
        backgroundColor: isSelected ? 'rgba(234, 88, 12, 0.1)' : hovered ? '#292524' : '#1c1917',
        transition: 'background-color 150ms ease',
        minHeight: effectiveH,
      }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>

      {/* Checkbox */}
      <div className="flex items-center justify-center px-2" style={{ width: 36, flexShrink: 0 }}>
        <button type="button" onClick={e => { e.stopPropagation(); onToggleSelect?.() }}
          className="p-0.5 rounded hover:bg-stone-700 transition-colors"
          style={{ opacity: isSelected || hovered ? 1 : 0, transition: 'opacity 150ms ease' }}>
          {isSelected
            ? <CheckSquare className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
            : <Square className="w-3.5 h-3.5" style={{ color: '#57534e' }} />}
        </button>
      </div>

      {/* Thumbnail cell — fixed width 1:1 square */}
      <div style={{ width: effectiveH, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {hasThumbnail ? (
          <div
            className="relative group cursor-pointer"
            style={{ width: effectiveH, height: effectiveH }}
            onClick={handleSetThumbnail}
            title="Change thumbnail"
          >
            <img
              src={`/api/rabbit/projects/${asset.project_id}/assets/${asset.id}/thumbnail?r=${thumbRevision}`}
              alt=""
              style={{ width: effectiveH, height: effectiveH, objectFit: 'cover', display: 'block' }}
            />
            {hovered && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleClearThumbnail() }}
                className="absolute top-0.5 right-0.5 p-0.5 rounded"
                style={{ backgroundColor: 'rgba(0,0,0,0.7)', color: '#fca5a5' }}
                title="Remove thumbnail"
              >
                <ImageOff className="w-3 h-3" />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSetThumbnail}
            className="w-full h-full flex items-center justify-center hover:bg-stone-700 transition-colors"
            style={{ color: '#57534e' }}
            title="Set thumbnail"
          >
            {hovered ? <ImagePlus className="w-4 h-4" /> : null}
          </button>
        )}
      </div>

      {/* Data columns */}
      {columns.map(c => (
        <div key={c.key} className="px-3.5 py-2 flex items-center" style={{ flex: c.flex, minWidth: 0, overflow: 'hidden' }}>
          {renderCell(c)}
        </div>
      ))}
    </div>
  )
}


// ═════════════════════════════════════════════════════
// GALLERY VIEW
// ═════════════════════════════════════════════════════
function AssetGallery({ assets, phaseById, taskCountByAsset, ctx, canWrite, thumbRevision, onThumbChanged, onWarningClick, onDetailClick }) {
  if (assets.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <Boxes className="w-12 h-12" style={{ color: '#44403c' }} />
        <span className="text-[13.5px] font-mono" style={{ color: '#78716c' }}>No assets</span>
      </div>
    )
  }
  return (
    <div className="p-6 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {assets.map(a => (
        <AssetCard
          key={a.id}
          asset={a}
          phaseLabel={phaseById[a.phase_id]?.name || ''}
          taskCount={taskCountByAsset[a.id] || 0}
          warning={ctx?.selectAssetStatusWarning?.(a)}
          thumbRevision={thumbRevision}
          onUpdate={(patch) => ctx.updateAsset(a.id, patch)}
          onDelete={canWrite ? () => ctx.deleteAsset(a.id) : null}
          onWarningClick={() => onWarningClick?.(a.id)}
          onDetailClick={() => onDetailClick?.(a.id)}
          onThumbChanged={onThumbChanged}
        />
      ))}
    </div>
  )
}

function AssetCard({ asset, phaseLabel, taskCount, warning, thumbRevision, onUpdate, onDelete, onWarningClick, onDetailClick, onThumbChanged }) {
  const [hovered, setHovered] = useState(false)
  const sc = statusColor(asset.status)
  const hasThumbnail = !!asset.thumbnail_image
  const initials = (asset.name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('')

  const handleSetThumbnail = useCallback(async () => {
    if (!window.electronAPI?.rabbit?.pickImage) return
    const imagePath = await window.electronAPI.rabbit.pickImage()
    if (!imagePath) return
    await onUpdate({ thumbnail_image: imagePath })
    try {
      await window.electronAPI.rabbit.generateAssetThumbnail({ assetId: asset.id, sourcePath: imagePath })
    } catch (e) { console.error('thumbnail gen failed:', e) }
    onThumbChanged?.()
  }, [asset.id, onUpdate, onThumbChanged])

  return (
    <div
      className="rounded-sm overflow-hidden flex flex-col"
      style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Thumbnail / initials block */}
      <div
        className="h-36 flex items-center justify-center relative overflow-hidden"
        style={{ backgroundColor: '#1c1917', borderBottom: '1px solid #44403c' }}
      >
        {hasThumbnail ? (
          <img
            src={`/api/rabbit/projects/${asset.project_id}/assets/${asset.id}/thumbnail?r=${thumbRevision}`}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span className="text-2xl font-mono font-bold" style={{ color: '#57534e' }}>
            {initials}
          </span>
        )}
        {warning && (
          <button type="button" onClick={onWarningClick}
            className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-stone-700"
            style={{ backgroundColor: '#1c1917', border: '1px solid #7f1d1d', color: '#fca5a5' }}
            title="Status mismatch — click for details">
            <AlertTriangle className="w-3 h-3" />
          </button>
        )}
        {hovered && (
          <>
            <button type="button" onClick={onDetailClick}
              className="absolute bottom-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-stone-700 transition-colors"
              style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#fb923c' }}
              title="View asset details">
              <FileText className="w-3 h-3" />
            </button>
            <button type="button" onClick={handleSetThumbnail}
              className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-stone-700 transition-colors"
              style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#a8a29e' }}
              title={hasThumbnail ? 'Change thumbnail' : 'Set thumbnail'}>
              <ImagePlus className="w-3 h-3" />
            </button>
          </>
        )}
        <div
          className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[9.5px] font-mono uppercase tracking-wider rounded"
          style={{ color: sc, backgroundColor: '#1c1917', border: `1px solid ${sc}33` }}>
          {fmt(asset.status || 'not_started')}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: sc }} />
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col gap-1 p-2">
        <InlineText
          value={asset.name || ''}
          onCommit={(name) => onUpdate({ name })}
          placeholder="Untitled"
        />
        <div className="flex items-center justify-between text-[10.5px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>
          <span>{fmt(asset.type || 'other')}</span>
          {phaseLabel && <span className="truncate max-w-[100px]">{'\u00B7'} {phaseLabel}</span>}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-2 py-1" style={{ borderTop: '1px solid #44403c', backgroundColor: '#1c1917' }}>
        <span className="text-[10.5px] font-mono" style={{ color: '#a8a29e' }}>
          {taskCount} task{taskCount === 1 ? '' : 's'}
        </span>
        {onDelete && (
          // Soft delete — no confirm; the shell-level undo toast covers it.
          <button type="button" onClick={onDelete}
            className="p-0.5 rounded hover:bg-stone-700 transition-colors"
            title="Delete asset"
            style={{ color: '#fca5a5' }}>
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
}


// ═════════════════════════════════════════════════════
// NEW ASSET POPUP — draft locally, only commit on confirm
// ═════════════════════════════════════════════════════
function NewAssetPopup({ ctx, phases, onCreated, onClose }) {
  const tt = useTaskTemplates()

  // Draft state — nothing touches the DB until confirm
  const [draft, setDraft] = useState({
    name: '',
    type: 'other',
    status: 'not_started',
    phase_id: '',
    description: '',
    start_date: '',
    due_date: '',
  })
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [creating, setCreating] = useState(false)
  // Session 23: handleConfirm had try/finally with NO catch, so a rejected
  // write left the button flashing "Creating…" and changed nothing on screen.
  // That is the whole reason a total failure read as "nothing populated".
  const [error, setError] = useState(null)

  // Load templates available to this project
  const [projectTemplates, setProjectTemplates] = useState([])
  useEffect(() => {
    const pid = ctx?.project?.id
    if (!pid) return
    tt.loadProjectTemplates(pid).then(list => setProjectTemplates(list || []))
  }, [ctx?.project?.id, tt.loadProjectTemplates])

  const selectedTemplate = selectedTemplateId
    ? projectTemplates.find(t => t.id === selectedTemplateId)
    : null
  const previewTasks = selectedTemplate?.tasks || []

  function patch(p) { setDraft(prev => ({ ...prev, ...p })) }

  // ── Confirm & Create ──
  async function handleConfirm() {
    if (!ctx?.addAsset || !draft.name.trim()) return
    setCreating(true)
    setError(null)
    try {
      // 1. Create the asset
      const created = await ctx.addAsset({
        name: draft.name.trim(),
        type: draft.type,
        status: draft.status,
        phase_id: draft.phase_id || null,
        description: draft.description,
        start_date: draft.start_date || null,
        due_date: draft.due_date || null,
        // Session 23: only send this when a template was actually picked.
        // It is not a column on public.assets (the adapter allowlist drops
        // it), and sending `null` unconditionally meant a warning on every
        // single create for a dropdown that is permanently empty in cloud —
        // listProjectTaskTemplates exists only on localServerAdapter.
        ...(selectedTemplateId ? { task_template_id: selectedTemplateId } : {}),
      })
      if (!created?.id) return

      // 2. Apply template tasks if one was selected
      if (selectedTemplate?.tasks?.length && ctx?.addTask) {
        const assetStart = draft.start_date || new Date().toISOString().split('T')[0]
        const sorted = topoSort(selectedTemplate.tasks)
        const idMap = {}
        const createdEndDates = {}

        for (const tmplTask of sorted) {
          let taskStart = assetStart
          if (tmplTask.depends_on?.length) {
            let latestEnd = assetStart
            for (const depId of tmplTask.depends_on) {
              const mappedId = idMap[depId]
              if (mappedId && createdEndDates[mappedId]) {
                if (createdEndDates[mappedId] > latestEnd) latestEnd = createdEndDates[mappedId]
              }
            }
            const d = new Date(latestEnd)
            d.setDate(d.getDate() + 1)
            taskStart = d.toISOString().split('T')[0]
          }
          const days = tmplTask.bid_days || 1
          const endD = new Date(taskStart)
          endD.setDate(endD.getDate() + days - 1)
          const taskEnd = endD.toISOString().split('T')[0]

          const taskCreated = await ctx.addTask({
            title: tmplTask.name || 'Untitled',
            asset_id: created.id,
            phase_id: draft.phase_id || null,
            status: 'waiting_to_start',
            priority: 'medium',
            bid_days: tmplTask.bid_days || 0,
            // 🚨 Session 28: this said `role_slug`, which is NOT a column on
            // `tasks` — the column is `assigned_role_slug`. Because `tasks`
            // HAS a COLUMN_ALLOWLIST entry, toColumns dropped the key with a
            // console warning instead of rejecting the request, so every task
            // a template created arrived with no role on it and every bid
            // built from those tasks priced at nothing. Quieter than the S23
            // failure and, until 0044, unreachable: this branch only runs when
            // a template exists, and none could.
            assigned_role_slug: tmplTask.role_slug || null,
            start_date: taskStart,
            end_date: taskEnd,
          })
          if (taskCreated?.id) {
            idMap[tmplTask.id] = taskCreated.id
            createdEndDates[taskCreated.id] = taskEnd
          }
        }
      }

      onCreated(created.id)
    } catch (err) {
      // Say what went wrong instead of silently doing nothing. The dialog
      // stays open with the user's input intact so they can retry.
      setError(err?.message || String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      {/* Modal */}
      <div
        className="fixed z-50 top-1/2 left-1/2 w-full max-w-lg rounded overflow-hidden flex flex-col"
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
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '2px solid #44403c' }}>
          <div className="flex items-center gap-2">
            <Boxes className="w-4 h-4" style={{ color: '#fb923c' }} />
            <span className="text-[13.5px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
              Create New Asset
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="space-y-4">

            {/* Name */}
            <div>
              <label className="text-[9.5px] font-mono uppercase tracking-wider mb-1 block" style={{ color: '#78716c' }}>Name *</label>
              <input
                autoFocus
                type="text"
                value={draft.name}
                onChange={e => patch({ name: e.target.value })}
                placeholder="Asset name..."
                className="w-full px-3 py-2 text-[12.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
              />
            </div>

            {/* Type + Status row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[9.5px] font-mono uppercase tracking-wider mb-1 block" style={{ color: '#78716c' }}>Type</label>
                <select value={draft.type} onChange={e => patch({ type: e.target.value })}
                  className="w-full px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}>
                  {ASSET_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9.5px] font-mono uppercase tracking-wider mb-1 block" style={{ color: '#78716c' }}>Status</label>
                <select value={draft.status} onChange={e => patch({ status: e.target.value })}
                  className="w-full px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: statusColor(draft.status), border: '1px solid #44403c' }}>
                  {ASSET_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
                </select>
              </div>
            </div>

            {/* Phase */}
            <div>
              <label className="text-[9.5px] font-mono uppercase tracking-wider mb-1 block" style={{ color: '#78716c' }}>Phase</label>
              <select value={draft.phase_id} onChange={e => patch({ phase_id: e.target.value })}
                className="w-full px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: draft.phase_id ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
                <option value="">-- No phase --</option>
                {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
              </select>
            </div>

            {/* Dates row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[9.5px] font-mono uppercase tracking-wider mb-1 block" style={{ color: '#78716c' }}>Start Date</label>
                <input type="date" value={draft.start_date} onChange={e => patch({ start_date: e.target.value })}
                  className="w-full px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: draft.start_date ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}
                />
              </div>
              <div>
                <label className="text-[9.5px] font-mono uppercase tracking-wider mb-1 block" style={{ color: '#78716c' }}>Due Date</label>
                <input type="date" value={draft.due_date} onChange={e => patch({ due_date: e.target.value })}
                  className="w-full px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: draft.due_date ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="text-[9.5px] font-mono uppercase tracking-wider mb-1 block" style={{ color: '#78716c' }}>Description</label>
              <textarea
                value={draft.description}
                onChange={e => patch({ description: e.target.value })}
                rows={2}
                placeholder="Optional description..."
                className="w-full px-3 py-2 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
                style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}
              />
            </div>

            {/* Task template selector */}
            <div>
              <label className="text-[9.5px] font-mono uppercase tracking-wider mb-1 block" style={{ color: '#78716c' }}>Task Template</label>
              <select
                value={selectedTemplateId}
                onChange={e => setSelectedTemplateId(e.target.value)}
                className="w-full px-2 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: selectedTemplateId ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                <option value="">-- No template --</option>
                {projectTemplates.map(tmpl => {
                  const count = (tmpl.tasks || []).length
                  const days = (tmpl.tasks || []).reduce((s, t) => s + (t.bid_days || 0), 0)
                  return <option key={tmpl.id} value={tmpl.id}>{tmpl.name} ({count} tasks, {days}d)</option>
                })}
              </select>
            </div>

            {/* Template task preview */}
            {previewTasks.length > 0 && (
              <div className="rounded overflow-hidden" style={{ border: '1px solid #44403c' }}>
                <div className="px-3 py-1.5" style={{ backgroundColor: '#1c1917', borderBottom: '1px solid #44403c' }}>
                  <span className="text-[9.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#fb923c' }}>
                    Tasks to be created ({previewTasks.length})
                  </span>
                </div>
                <div style={{ maxHeight: 140, overflow: 'auto' }}>
                  {previewTasks.map((t, i) => (
                    <div key={t.id || i} className="flex items-center px-3 py-1.5"
                      style={{ borderBottom: i < previewTasks.length - 1 ? '1px solid #292524' : 'none' }}>
                      <span className="text-[11.5px] font-mono flex-1 truncate" style={{ color: '#d6d3d1' }}>
                        {t.name || 'Untitled'}
                      </span>
                      {t.role_slug && (
                        <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded mr-2" style={{ color: '#78716c', backgroundColor: '#292524' }}>
                          {fmt(t.role_slug)}
                        </span>
                      )}
                      <span className="text-[10.5px] font-mono font-bold flex-shrink-0" style={{ color: '#f4a261' }}>
                        {t.bid_days || 0}d
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Session 23: a failed create must say so. Matches the Timeline task
            dialog's error box — the only reason that surface's failures were
            ever visible, while this one's were not. */}
        {error && (
          <div
            className="mx-5 mb-3 px-3 py-2 text-[11.5px] font-mono rounded"
            style={{ color: '#fecaca', backgroundColor: 'rgba(153,27,27,0.25)', border: '1px solid #991b1b' }}
          >
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid #44403c' }}>
          <span className="text-[10.5px] font-mono" style={{ color: '#57534e' }}>
            Nothing is saved until you confirm.
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-1.5 text-[11.5px] font-mono rounded transition-colors"
              style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
              Cancel
            </button>
            <button type="button" onClick={handleConfirm}
              disabled={!draft.name.trim() || creating}
              className="px-4 py-1.5 text-[11.5px] font-mono font-bold uppercase tracking-wider rounded transition-colors disabled:opacity-40"
              style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
              {creating ? 'Creating...' : 'Confirm & Create'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}


// ═════════════════════════════════════════════════════
// ASSET DETAIL POPUP
// ═════════════════════════════════════════════════════
function AssetDetailPopup({ asset, tasks, phase, ctx, thumbRevision, onThumbChanged, onClose }) {
  const tm = useTeamMembers()
  const tt = useTaskTemplates()
  const teamAssignments = ctx?.teamAssignments || []
  const phases = ctx?.phases || []

  const memberById = useMemo(() => {
    const map = {}
    for (const m of tm.members) map[m.id] = m
    return map
  }, [tm.members])

  const projectMembers = useMemo(() => {
    return teamAssignments.map(a => memberById[a.member_id]).filter(Boolean)
  }, [teamAssignments, memberById])

  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState(asset?.description || '')
  const [applyingTemplate, setApplyingTemplate] = useState(false)

  // Relation picker state
  const [showScenePicker, setShowScenePicker] = useState(false)
  const [showShotPicker, setShowShotPicker] = useState(false)
  const [showLevelPicker, setShowLevelPicker] = useState(false)
  const [showExperiencePicker, setShowExperiencePicker] = useState(false)

  const project = ctx?.project

  // Load project-specific templates
  const [projectTemplates, setProjectTemplates] = useState([])
  useEffect(() => {
    if (!asset?.project_id) return
    tt.loadProjectTemplates(asset.project_id).then(list => {
      setProjectTemplates(list || [])
    })
  }, [asset?.project_id, tt.loadProjectTemplates])

  // Apply template — create tasks from template definition
  async function handleApplyTemplate(templateId) {
    if (!templateId || !ctx?.addTask || !asset) return
    const template = projectTemplates.find(t => t.id === templateId)
    if (!template?.tasks?.length) return

    setApplyingTemplate(true)
    try {
      const assetStart = asset.start_date || new Date().toISOString().split('T')[0]

      // Sort tasks by dependency order (topological sort)
      const sorted = topoSort(template.tasks)

      // Map template task IDs to created task IDs for dependency linking
      const idMap = {}
      const createdEndDates = {}

      for (const tmplTask of sorted) {
        // Calculate start date based on dependencies
        let taskStart = assetStart
        if (tmplTask.depends_on?.length) {
          // Start after the latest predecessor ends
          let latestEnd = assetStart
          for (const depId of tmplTask.depends_on) {
            const mappedId = idMap[depId]
            if (mappedId && createdEndDates[mappedId]) {
              if (createdEndDates[mappedId] > latestEnd) latestEnd = createdEndDates[mappedId]
            }
          }
          // Start the day after the predecessor ends
          const d = new Date(latestEnd)
          d.setDate(d.getDate() + 1)
          taskStart = d.toISOString().split('T')[0]
        }

        // Calculate end date
        const days = tmplTask.bid_days || 1
        const endD = new Date(taskStart)
        endD.setDate(endD.getDate() + days - 1)
        const taskEnd = endD.toISOString().split('T')[0]

        const created = await ctx.addTask({
          title: tmplTask.name || 'Untitled',
          asset_id: asset.id,
          phase_id: asset.phase_id || null,
          status: 'waiting_to_start',
          priority: 'medium',
          bid_days: tmplTask.bid_days || 0,
          // Session 28 — the same wrong key as the create-with-template path
          // above. The template's own field really is called `role_slug`
          // (it is a key inside the jsonb array, not a column); the TASK
          // column it maps onto is `assigned_role_slug`.
          assigned_role_slug: tmplTask.role_slug || null,
          start_date: taskStart,
          end_date: taskEnd,
        })

        if (created?.id) {
          idMap[tmplTask.id] = created.id
          createdEndDates[created.id] = taskEnd
        }
      }

      // Record which template was used on this asset
      ctx?.updateAsset?.(asset.id, { task_template_id: templateId })
    } finally {
      setApplyingTemplate(false)
    }
  }

  if (!asset) return null

  const sc = statusColor(asset.status)
  const hasThumbnail = !!asset.thumbnail_image

  function handleUpdateAsset(patch) {
    ctx?.updateAsset?.(asset.id, patch)
  }

  async function handleSetThumbnail() {
    if (!window.electronAPI?.rabbit?.pickImage) return
    const imagePath = await window.electronAPI.rabbit.pickImage()
    if (!imagePath) return
    handleUpdateAsset({ thumbnail_image: imagePath })
    try {
      await window.electronAPI.rabbit.generateAssetThumbnail({ assetId: asset.id, sourcePath: imagePath })
    } catch (e) { console.error('thumbnail gen failed:', e) }
    onThumbChanged?.()
  }

  async function handleClearThumbnail() {
    handleUpdateAsset({ thumbnail_image: null })
    try {
      await window.electronAPI.rabbit.clearAssetThumbnail({ assetId: asset.id })
    } catch {}
    onThumbChanged?.()
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      {/* Modal */}
      <div
        className="fixed z-50 top-1/2 left-1/2 w-full max-w-6xl rounded overflow-hidden flex flex-col"
        style={{ backgroundColor: '#292524', border: '2px solid #f97316', maxHeight: '85vh', transform: 'translate(-50%, -50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `3px solid ${sc}` }}>
          <div className="flex items-center gap-2.5">
            <Boxes className="w-4 h-4" style={{ color: '#fb923c' }} />
            <InlineText
              value={asset.name || ''}
              onCommit={(name) => handleUpdateAsset({ name })}
              placeholder="Untitled Asset"
            />
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-column body */}
        <div className="flex-1 overflow-auto flex">
          {/* LEFT COLUMN — Relations sidebar */}
          <AssetRelationsSidebar asset={asset} ctx={ctx} />

          {/* RIGHT COLUMN — Properties */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 min-w-0">

          {/* Thumbnail section */}
          <div className="flex items-start gap-5 mb-6">
            <div
              className="relative flex-shrink-0 rounded overflow-hidden flex items-center justify-center"
              style={{ width: 120, height: 120, backgroundColor: '#1c1917', border: '1px solid #44403c' }}
            >
              {hasThumbnail ? (
                <img
                  src={`/api/rabbit/projects/${asset.project_id}/assets/${asset.id}/thumbnail?r=${thumbRevision}`}
                  alt=""
                  style={{ width: 120, height: 120, objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <span className="text-3xl font-mono font-bold" style={{ color: '#57534e' }}>
                  {(asset.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('')}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>
                Thumbnail
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleSetThumbnail}
                  className="flex items-center gap-1 px-2 py-1 text-[11.5px] font-mono rounded hover:bg-stone-700 transition-colors"
                  style={{ color: '#d6d3d1', border: '1px solid #44403c' }}>
                  <ImagePlus className="w-3 h-3" />
                  {hasThumbnail ? 'Change' : 'Set thumbnail'}
                </button>
                {hasThumbnail && (
                  <button type="button" onClick={handleClearThumbnail}
                    className="flex items-center gap-1 px-2 py-1 text-[11.5px] font-mono rounded hover:bg-stone-700 transition-colors"
                    style={{ color: '#fca5a5', border: '1px solid #44403c' }}>
                    <ImageOff className="w-3 h-3" />
                    Remove
                  </button>
                )}
              </div>
              {hasThumbnail && (
                <span className="text-[10.5px] font-mono truncate max-w-[280px]" style={{ color: '#78716c' }}
                  title={asset.thumbnail_image}>
                  {asset.thumbnail_image.split(/[/\\]/).pop()}
                </span>
              )}
            </div>
          </div>

          {/* Properties grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-6">
            <PropField label="Type">
              <InlineSelect
                value={asset.type || 'other'}
                options={ASSET_TYPES}
                onCommit={(type) => handleUpdateAsset({ type })}
              />
            </PropField>
            <PropField label="Status">
              <InlineSelect
                value={asset.status || 'not_started'}
                options={ASSET_STATUSES}
                onCommit={(status) => handleUpdateAsset({ status })}
                tone={statusTone(asset.status)}
              />
            </PropField>
            <PropField label="Phase">
              <InlineSelect
                value={asset.phase_id || ''}
                options={[
                  { value: '', label: '\u2014' },
                  ...phases.map(p => ({ value: p.id, label: p.name })),
                ]}
                onCommit={(phase_id) => handleUpdateAsset({ phase_id: phase_id || null })}
              />
            </PropField>
            <PropField label="Tasks" value={String(tasks.length)} />
            <PropField label="Task Template">
              <div className="flex items-center gap-1.5">
                <select
                  value=""
                  onChange={e => handleApplyTemplate(e.target.value)}
                  disabled={applyingTemplate}
                  className="px-1.5 py-0.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}>
                  <option value="">{applyingTemplate ? 'Applying...' : '\u2014 Apply template'}</option>
                  {projectTemplates.map(tmpl => (
                    <option key={tmpl.id} value={tmpl.id}>{tmpl.name}</option>
                  ))}
                </select>
              </div>
            </PropField>
            <PropField label="Start Date">
              <input
                type="date"
                value={asset.start_date || ''}
                onChange={e => handleUpdateAsset({ start_date: e.target.value || null })}
                className="px-1.5 py-0.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: asset.start_date ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}
              />
            </PropField>
            <PropField label="Due Date">
              <input
                type="date"
                value={asset.due_date || ''}
                onChange={e => handleUpdateAsset({ due_date: e.target.value || null })}
                className="px-1.5 py-0.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: asset.due_date ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}
              />
            </PropField>
            <div className="col-span-2">
              <PropField label="Description">
                {editingDesc ? (
                  <textarea
                    autoFocus
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    onBlur={() => {
                      setEditingDesc(false)
                      if (descDraft !== (asset.description || '')) {
                        handleUpdateAsset({ description: descDraft })
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') { setDescDraft(asset.description || ''); setEditingDesc(false) }
                    }}
                    rows={3}
                    className="w-full px-2 py-1 text-xs font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { setDescDraft(asset.description || ''); setEditingDesc(true) }}
                    className="text-xs font-mono text-left w-full hover:bg-stone-700 px-2 py-1 rounded min-h-[28px]"
                    style={{ color: asset.description ? '#d6d3d1' : '#78716c' }}
                  >
                    {asset.description || 'Click to add description...'}
                  </button>
                )}
              </PropField>
            </div>
            {asset.created_at && <PropField label="Created" value={new Date(asset.created_at).toLocaleDateString()} />}
            {asset.updated_at && <PropField label="Updated" value={new Date(asset.updated_at).toLocaleDateString()} />}

            {/* ── Relation fields ── */}
            {project?.scenes_enabled && (
              <PropField label="Scenes">
                <button onClick={() => setShowScenePicker(true)}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none text-left"
                  style={{ backgroundColor: '#1c1917', color: (asset.scene_ids?.length || 0) > 0 ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                  {(asset.scene_ids?.length || 0) > 0 ? `${asset.scene_ids.length} scene(s)` : '--'}
                </button>
              </PropField>
            )}
            {project?.scenes_enabled && (
              <PropField label="Shots">
                <button onClick={() => setShowShotPicker(true)}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none text-left"
                  style={{ backgroundColor: '#1c1917', color: (asset.shot_ids?.length || 0) > 0 ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                  {(asset.shot_ids?.length || 0) > 0 ? `${asset.shot_ids.length} shot(s)` : '--'}
                </button>
              </PropField>
            )}
            {project?.levels_enabled && (
              <PropField label="Levels">
                <button onClick={() => setShowLevelPicker(true)}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none text-left"
                  style={{ backgroundColor: '#1c1917', color: (asset.level_ids?.length || 0) > 0 ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                  {(asset.level_ids?.length || 0) > 0 ? `${asset.level_ids.length} level(s)` : '--'}
                </button>
              </PropField>
            )}
            {project?.experiences_enabled && (
              <PropField label="Experiences">
                <button onClick={() => setShowExperiencePicker(true)}
                  className="w-full px-2.5 py-1.5 text-[12px] font-mono rounded focus:outline-none text-left"
                  style={{ backgroundColor: '#1c1917', color: (asset.experience_ids?.length || 0) > 0 ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                  {(asset.experience_ids?.length || 0) > 0 ? `${asset.experience_ids.length} experience(s)` : '--'}
                </button>
              </PropField>
            )}
          </div>

          {/* ── Relation picker popups ── */}
          {showScenePicker && (
            <RelationPickerPopup
              title="Link Scenes"
              icon={Film}
              items={ctx?.scenes || []}
              selectedIds={asset.scene_ids || []}
              onToggle={id => {
                const current = asset.scene_ids || []
                const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
                ctx?.updateAsset?.(asset.id, { scene_ids: next })
              }}
              onClose={() => setShowScenePicker(false)}
            />
          )}
          {showShotPicker && (
            <RelationPickerPopup
              title="Link Shots"
              icon={Clapperboard}
              items={ctx?.shots || []}
              selectedIds={asset.shot_ids || []}
              onToggle={id => {
                const current = asset.shot_ids || []
                const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
                ctx?.updateAsset?.(asset.id, { shot_ids: next })
              }}
              onClose={() => setShowShotPicker(false)}
            />
          )}
          {showLevelPicker && (
            <RelationPickerPopup
              title="Link Levels"
              icon={Gamepad2}
              items={ctx?.levels || []}
              selectedIds={asset.level_ids || []}
              onToggle={id => {
                const current = asset.level_ids || []
                const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
                ctx?.updateAsset?.(asset.id, { level_ids: next })
              }}
              onClose={() => setShowLevelPicker(false)}
            />
          )}
          {showExperiencePicker && (
            <RelationPickerPopup
              title="Link Experiences"
              icon={Sparkles}
              items={ctx?.experiences || []}
              selectedIds={asset.experience_ids || []}
              onToggle={id => {
                const current = asset.experience_ids || []
                const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
                ctx?.updateAsset?.(asset.id, { experience_ids: next })
              }}
              onClose={() => setShowExperiencePicker(false)}
            />
          )}

          {/* Tasks section */}
          <div className="mb-2">
            <span className="text-[10.5px] font-mono uppercase tracking-wider" style={{ color: '#fb923c' }}>
              Tasks ({tasks.length})
            </span>
          </div>

          {tasks.length === 0 ? (
            <div className="text-[11.5px] font-mono italic py-4 text-center" style={{ color: '#78716c' }}>
              No tasks on this asset.
            </div>
          ) : (
            <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr style={{ backgroundColor: '#292524', borderBottom: '2px solid #44403c' }}>
                  <Th>Title</Th>
                  <Th>Status</Th>
                  <Th>Bid</Th>
                  <Th>Assignee</Th>
                  <Th>Reviewer</Th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(t => (
                  <TaskRowInPopup
                    key={t.id}
                    task={t}
                    projectMembers={projectMembers}
                    memberById={memberById}
                    onUpdateTask={(patch) => ctx?.updateTask?.(t.id, patch)}
                  />
                ))}
              </tbody>
            </table>
          )}

          {/* Files section */}
          <div className="mt-6 pt-4" style={{ borderTop: '1px solid #44403c' }}>
            <FileManager
              files={ctx?.managedFiles || []}
              assetId={asset.id}
              assetName={asset.name}
              projectId={asset.project_id}
              project={ctx?.project}
              mode="full"
              onFileAdded={() => ctx?.refreshManagedFiles?.()}
              onFileDeleted={() => ctx?.refreshManagedFiles?.()}
              onFileUpdated={() => ctx?.refreshManagedFiles?.()}
            />
          </div>
        </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-[11.5px] font-mono rounded transition-colors"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
            Done
          </button>
        </div>
      </div>
    </>
  )
}

function TaskRowInPopup({ task, projectMembers, memberById, onUpdateTask }) {
  const sc = statusColor(task.status)

  return (
    <tr style={{ borderBottom: '1px solid #292524', backgroundColor: 'transparent' }}>
      <Td>
        <span className="text-[11.5px] font-mono" style={{ color: '#d6d3d1' }}>
          {task.title || task.assigned_position || 'Untitled'}
        </span>
      </Td>
      <Td>
        <select
          value={task.status || 'waiting_to_start'}
          onChange={(e) => onUpdateTask({ status: e.target.value })}
          className="px-1.5 py-0.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer"
          style={{ backgroundColor: 'transparent', color: sc, border: '1px solid transparent' }}
        >
          {TASK_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
        </select>
      </Td>
      <Td>
        <span className="text-[11.5px] font-mono" style={{ color: '#a8a29e' }}>
          {task.bid_days ? `${task.bid_days}d` : '--'}
        </span>
      </Td>
      <Td>
        <select
          value={task.assignee_id || ''}
          onChange={(e) => onUpdateTask({ assignee_id: e.target.value || null })}
          className="px-1.5 py-0.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer"
          style={{ backgroundColor: 'transparent', color: '#d6d3d1', border: '1px solid transparent', maxWidth: '120px' }}
        >
          <option value="">--</option>
          {projectMembers.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </Td>
      <Td>
        <select
          value={task.reviewer_id || ''}
          onChange={(e) => onUpdateTask({ reviewer_id: e.target.value || null })}
          className="px-1.5 py-0.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer"
          style={{ backgroundColor: 'transparent', color: '#a78bfa', border: '1px solid transparent', maxWidth: '120px' }}
        >
          <option value="">--</option>
          {projectMembers.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </Td>
    </tr>
  )
}


// ═════════════════════════════════════════════════════
// SHARED ATOMS
// ═════════════════════════════════════════════════════

function PropField({ label, value, children }) {
  return (
    <div>
      <div className="text-[9.5px] font-mono uppercase tracking-wider mb-0.5" style={{ color: '#78716c' }}>
        {label}
      </div>
      {children || (
        <div className="text-xs font-mono" style={{ color: '#d6d3d1' }}>
          {value || '--'}
        </div>
      )}
    </div>
  )
}

// Table atoms — used by the detail popup's internal task table
function Th({ children, style: extraStyle }) {
  return (
    <th
      className="px-3 py-2.5 text-[11.5px] font-mono uppercase tracking-wider font-semibold text-left"
      style={{ color: '#a8a29e', ...extraStyle }}
    >
      {children}
    </th>
  )
}
function Td({ children }) {
  return <td className="px-3.5 py-2 align-middle">{children}</td>
}

// ── Inline editors ──
function InlineText({ value, onCommit, placeholder }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className="w-full px-1 py-0.5 text-xs font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => { setDraft(value); setEditing(true) }}
      className="text-xs font-mono text-left w-full truncate hover:bg-stone-700 px-1 py-0.5 rounded"
      style={{ color: value ? '#d6d3d1' : '#78716c' }}
    >
      {value || placeholder || '\u2014'}
    </button>
  )
}

// Cell-level inline text — used by the flex table rows (matches Tasks tab)
function CellInlineText({ value, placeholder, onCommit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  if (editing) {
    return (
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        className="w-full px-1.5 py-1 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
    )
  }
  return (
    <button type="button" onClick={() => { setDraft(value); setEditing(true) }}
      className="text-[11.5px] font-mono text-left w-full truncate hover:bg-stone-700/40 px-1.5 py-1 rounded transition-colors"
      style={{ color: value ? '#e7e5e4' : '#57534e' }}>
      {value || placeholder || '\u2014'}
    </button>
  )
}

function InlineSelect({ value, options, onCommit, tone }) {
  const opts = options.map(o => typeof o === 'string' ? { value: o, label: o } : o)
  const colors = toneColors(tone)
  return (
    <select
      value={value}
      onChange={(e) => onCommit(e.target.value)}
      className="px-1.5 py-0.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
      style={{
        backgroundColor: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
      }}
    >
      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function statusTone(status) {
  if (status === 'final' || status === 'approved') return 'good'
  if (status === 'blocked') return 'danger'
  if (status === 'on_hold' || status === 'omitted') return 'warn'
  if (status === 'in_progress' || status === 'pending_review' || status === 'needs_revisions') return 'active'
  return 'neutral'
}

function toneColors(tone) {
  switch (tone) {
    case 'good':   return { bg: '#1c1917', fg: '#86efac', border: '#15803d' }
    case 'danger': return { bg: '#1c1917', fg: '#fca5a5', border: '#7f1d1d' }
    case 'warn':   return { bg: '#1c1917', fg: '#fcd34d', border: '#78350f' }
    case 'active': return { bg: '#1c1917', fg: '#fb923c', border: '#c2410c' }
    default:       return { bg: '#1c1917', fg: '#d6d3d1', border: '#44403c' }
  }
}
