// ============================================================
// RABBIT — ProjectAssetsView
// ============================================================
//
// Full-featured asset management view with two modes:
//
//   1. TABLE — the kit's Table (a real <table>, 36px rows),
//      with complex filtering, sorting, grouping, thumbnails,
//      inline editing, and hover-reveal action buttons.
//
//   2. GALLERY — card-based grid with thumbnail previews,
//      status badges, and inline editing.
//
// Saved view profiles let users name and recall filter/sort/
// group/view-mode configurations.
//
// UI overhaul B4b (2026-09-25): the page is on the shared kit
// (src/ui) and lane B4's sheet, rabbitFiles.css (`rb-asset-`):
// the toolbar, filter strip, saved views and bulk bar are B2's
// Tasks page re-made in this lane's classes. Every state is a
// `data-*` attribute or a real :hover resolved in the sheet. The two popups
// (New asset, the asset's detail) are the kit's Dialog, portalled into
// <body>; the detail popup's property grid and task table use the table's
// own editors (the kit's CellSelect, the lane's date field).
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

import { Fragment, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import {
  Boxes, Plus, Search, Filter, Trash2, AlertTriangle,
  X, FileText, ImagePlus, ImageOff, History,
  Layers, ArrowUpDown, ChevronDown, ChevronRight,
  Save, BookmarkPlus, CheckSquare, Square, MinusSquare,
  Film, Clapperboard, Gamepad2, Sparkles, ListChecks,
} from 'lucide-react'
import {
  Toolbar, Button, IconButton, Tabs, Table, Th, Td, Row, Dialog, Field,
  Card, HoverActions, EmptyState, StatusDot, StatusBadge, Badge, CellSelect, statusMeta,
} from '../../../ui'
import './rabbitFiles.css'
import { useRabbit } from '../state/RabbitProvider'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import { useTaskTemplates } from '../../../components/TaskTemplates/useTaskTemplates'
import { usePermissions } from '../../../permissions/usePermissions'
import { canOnProject, projectActionDeniedReason } from '../../../permissions/projectRoleMatrix'
import GatedAction, { WriteReasonProvider } from '../../../permissions/GatedAction'
import AssetStatusWarningModal from '../components/AssetStatusWarningModal'
import EditHistoryDrawer from '../components/EditHistoryDrawer'
import { RelationPickerPopup, RelationBadge, AssetRelationsSidebar } from '../components/RelationsPanel'
import FileManager from '../components/FileManager'

// ── Thumbnail sizing ──
// 1x, 2x and 3x the 36px row. The sizes themselves live in rabbitFiles.css,
// keyed on the table's `data-thumb`: ONE thumbnail column width for the
// whole table (R4-04), where each row used to take its own.
const THUMB_SIZES = ['sm', 'md', 'lg']

// The body the Table / Gallery tabs switch (the kit's Tabs wants its panel).
const BODY_ID = 'rb-asset-body'

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

// ── Status words and options ──
// A status's words come from the kit's one status source (src/ui/StatusDot),
// so this page, the Tasks page and the Dashboard say the same thing, in
// sentence case (Q2); `fmt()` lower-cased every one of them. Its colour is
// the kit's too: a StatusDot beside the words, never the words' own ink
// (R4-05).
const STATUS_LABELS = Object.fromEntries(ASSET_STATUSES.map(s => [s, statusMeta(s).label]))
const STATUS_OPTIONS = ASSET_STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s] }))
const TYPE_OPTIONS = ASSET_TYPES.map(t => ({ value: t, label: fmt(t) }))

// (The file's second status-colour language — `statusColor`, and the popup's
// `statusTone` / `toneColors` that drew the same approved in another green —
// is gone with its last callers, the two popups: R4-05.)

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
  //
  // Session 29 — visible-and-greyed instead of hidden, matching the Timeline
  // and the Tasks tab. See GatedAction.
  const writeGateCtx = {
    appRole: role,
    projectRole: ctx?.myProjectRole,
    isStaffed: ctx?.projectIsStaffed,
    ready: permsReady,
  }
  const canWrite = canOnProject(writeGateCtx, 'project.entity.write')
  const writeReason = projectActionDeniedReason(writeGateCtx, 'project.entity.write')

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
    if (field === 'status') return STATUS_LABELS[key] || fmt(key)
    return fmt(key)
  }
  // (The group's accent colour, computed here per status, is gone: a status
  // group carries the kit's StatusDot, and every other group none — R4-33.)

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
      <div className="rb-asset-view h-full flex items-center justify-center">
        <span className="rb-asset-unloaded text-label uppercase">No project loaded</span>
      </div>
    )
  }

  return (
    <WriteReasonProvider reason={writeReason}>
    <div className="rb-asset-view h-full flex flex-col">
      {/* ── Toolbar: the kit's, composed as B2's Tasks toolbar is — every
          control the 28px sm height on one baseline (R4-16), the same
          controls in the same order (R4-37's regrouping is recorded, not
          made: C1). It wraps rather than clipping at Electron's 1024px. ── */}
      <Toolbar
        wrap
        className="rb-asset-toolbar"
        right={(
          <>
            <span className="rb-asset-count">
              {processed.length}/{assets.length}
            </span>

            <GatedAction allowed={canWrite}>
              <Button size="sm" variant="primary" Icon={Plus} onClick={handleAddAsset}>
                New asset
              </Button>
            </GatedAction>
          </>
        )}
      >
        {/* Filter */}
        <Button
          size="sm"
          Icon={Filter}
          className="rb-asset-tool"
          data-active={filters.length > 0 ? 'true' : 'false'}
          aria-expanded={showFilterPanel}
          onClick={() => setShowFilterPanel(!showFilterPanel)}
        >
          Filter{filters.length > 0 ? ` (${filters.length})` : ''}
        </Button>

        {/* Sort */}
        <span className="rb-asset-sort">
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            aria-label="Sort"
            className="ui-input rb-asset-tool"
            data-size="sm"
            data-active={sortField ? 'true' : 'false'}>
            <option value="">Sort…</option>
            {ASSET_SORTABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          {sortField && (
            <IconButton
              size="sm"
              Icon={ArrowUpDown}
              title={sortDir === 'asc' ? 'Sorted ascending — reverse' : 'Sorted descending — reverse'}
              onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            />
          )}
        </span>

        <span className="rb-asset-divider" aria-hidden="true" />

        {/* Group */}
        <select value={groupBy}
          onChange={e => setGroupBy(e.target.value)}
          aria-label="Group"
          className="ui-input rb-asset-tool"
          data-size="sm"
          data-active={groupBy ? 'true' : 'false'}>
          {ASSET_GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        <span className="rb-asset-divider" aria-hidden="true" />

        {/* Table / Gallery — the kit's Tabs: one underline, no orange fill
            under small text (C6; R4-07, the same switch FileManager draws). */}
        <Tabs
          label="View"
          panelId={BODY_ID}
          items={[{ id: 'table', label: 'Table' }, { id: 'gallery', label: 'Gallery' }]}
          value={viewMode}
          onChange={setViewMode}
        />

        {/* Thumbnail size (table mode): three kit ghost buttons, their square
            growing with the size as before; the chosen one carries the
            signal edge, the one active treatment. */}
        {viewMode === 'table' && (
          <span className="rb-asset-sizes">
            {THUMB_SIZES.map(key => (
              <Button key={key} size="sm" variant="ghost"
                className="rb-asset-size"
                title={`${key} thumbnails`}
                aria-pressed={thumbSize === key}
                data-active={thumbSize === key ? 'true' : 'false'}
                onClick={() => setThumbSize(key)}>
                <Square aria-hidden="true" className="rb-asset-size-glyph" data-thumb={key} />
              </Button>
            ))}
          </span>
        )}

        {/* Saved views dropdown */}
        <AssetSavedViewsDropdown
          views={savedViews}
          onLoad={loadView}
          onDelete={deleteSavedView}
          onSave={() => setShowSaveDialog(true)}
        />

        <span className="rb-asset-divider" aria-hidden="true" />

        {/* Search */}
        <span className="rb-asset-search">
          <Search className="rb-asset-search-icon" aria-hidden="true" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search assets…"
            aria-label="Search assets"
            className="ui-input rb-asset-search-input"
            data-size="sm" />
          {search && (
            <IconButton size="sm" Icon={X} title="Clear search" className="rb-asset-search-clear" onClick={() => setSearch('')} />
          )}
        </span>
      </Toolbar>

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

      {/* ── Body: the one region the view Tabs switch ── */}
      <div className="rb-asset-body" id={BODY_ID} role="tabpanel" aria-label={viewMode === 'table' ? 'Table' : 'Gallery'}>
        {viewMode === 'table' ? (
          <AssetTable
            assets={processed}
            groups={groups}
            groupBy={groupBy}
            phases={phases}
            taskCountByAsset={taskCountByAsset}
            ctx={ctx}
            canWrite={canWrite}
            thumbSize={thumbSize}
            thumbRevision={thumbRevision}
            collapsedGroups={collapsedGroups}
            toggleGroup={toggleGroup}
            onThumbChanged={() => setThumbRevision(r => r + 1)}
            onWarningClick={(id) => setWarningAssetId(id)}
            onDetailClick={(id) => setDetailAssetId(id)}
            onHistoryClick={canViewHistory ? (id) => setHistoryAssetId(id) : null}
          />
        ) : groups ? (
          // Gallery — grouped: each group opens with the table's group band.
          groups.map(g => (
            <div key={g.key}>
              <div className="rb-asset-group-head">
                <AssetGroupToggle group={g} groupBy={groupBy}
                  collapsed={collapsedGroups.has(g.key)} onToggle={() => toggleGroup(g.key)} />
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

      {/* ── Save view dialog — the kit's Dialog, as B2's (Q17: Escape, the
          stack, the busy lock). The backdrop still closes it, as it always
          did. ── */}
      {showSaveDialog && (
        <Dialog
          width="confirm"
          title="Save current view"
          dismissOnBackdrop
          onClose={() => setShowSaveDialog(false)}
          footer={(
            <>
              <Button onClick={() => setShowSaveDialog(false)}>Cancel</Button>
              <Button variant="primary" onClick={saveCurrentView}>Save</Button>
            </>
          )}
        >
          <input autoFocus type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
            placeholder="View name…"
            aria-label="View name"
            onKeyDown={e => { if (e.key === 'Enter') saveCurrentView() }}
            className="ui-input" />
        </Dialog>
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
    </WriteReasonProvider>
  )
}


// ═════════════════════════════════════════════════════
// FILTER PANEL
// ═════════════════════════════════════════════════════
// B2's filter strip (ProjectTasksView's FilterPanel), in this lane's classes:
// native selects in the kit's small well, a named remove button per row.
function AssetFilterPanel({ filters, phases, onAdd, onUpdate, onRemove, onClose }) {
  function getOptions(f) {
    const def = ASSET_FILTER_FIELDS.find(ff => ff.value === f.field)
    if (!def) return []
    if (def.dynamic === 'phases') return phases.map(p => ({ value: p.id, label: p.name || 'Untitled' }))
    return (def.options || []).map(o => ({ value: o, label: def.value === 'status' ? STATUS_LABELS[o] : fmt(o) }))
  }
  function getType(f) {
    return ASSET_FILTER_FIELDS.find(ff => ff.value === f.field)?.type || 'text'
  }
  return (
    <div className="rb-asset-filters">
      {filters.map((f, i) => {
        const type = getType(f)
        const ops = FILTER_OPS[type] || FILTER_OPS.text
        const needsValue = !['is_empty','is_not_empty'].includes(f.op)
        return (
          <div key={i} className="rb-asset-filter-row">
            <span className="rb-asset-filter-where text-label uppercase">
              {i === 0 ? 'Where' : 'And'}
            </span>
            <select value={f.field} onChange={e => onUpdate(i, { field: e.target.value, value: '' })}
              aria-label="Field" className="ui-input rb-asset-filter-field" data-size="sm">
              {ASSET_FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select value={f.op} onChange={e => onUpdate(i, { op: e.target.value })}
              aria-label="Condition" className="ui-input rb-asset-filter-op" data-size="sm">
              {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
              type === 'select' ? (
                <select value={f.value} onChange={e => onUpdate(i, { value: e.target.value })}
                  aria-label="Value" className="ui-input rb-asset-tool" data-size="sm">
                  <option value="">— select —</option>
                  {getOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" value={f.value || ''} onChange={e => onUpdate(i, { value: e.target.value })}
                  placeholder="value…"
                  aria-label="Value"
                  className="ui-input rb-asset-filter-text" data-size="sm" />
              )
            )}
            <IconButton size="sm" Icon={X} danger title="Remove this filter" onClick={() => onRemove(i)} />
          </div>
        )
      })}
      <div className="rb-asset-filter-actions">
        <Button size="sm" Icon={Plus} onClick={onAdd}>Add filter</Button>
        {filters.length > 0 && (
          <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
        )}
      </div>
    </div>
  )
}


// ═════════════════════════════════════════════════════
// SAVED VIEWS DROPDOWN
// ═════════════════════════════════════════════════════
// B2's SavedViewsDropdown, in this lane's classes: hand-drawn on the kit's
// floating tokens, because the kit Menu has no item with a trailing action
// (load a view AND delete it, from one row; B2's kit request K2).
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
      <Button size="sm" Icon={BookmarkPlus} aria-expanded={open} onClick={() => setOpen(!open)}>
        Views
      </Button>
      {open && (
        <div className="rb-asset-menu">
          {views.length === 0 && (
            <div className="rb-asset-menu-empty">No saved views</div>
          )}
          {views.map(v => (
            <div key={v.id} className="rb-asset-menu-item"
              onClick={() => { onLoad(v); setOpen(false) }}>
              <span className="rb-asset-menu-label">{v.name}</span>
              <IconButton size="sm" Icon={X} danger title={`Delete the saved view "${v.name}"`}
                onClick={e => { e.stopPropagation(); onDelete(v.id) }} />
            </div>
          ))}
          <div className="rb-asset-menu-foot">
            <button type="button" onClick={() => { onSave(); setOpen(false) }}
              className="rb-asset-menu-item">
              <Save className="rb-asset-menu-icon" aria-hidden="true" />
              <span className="rb-asset-menu-label">Save current view</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ═════════════════════════════════════════════════════
// TABLE VIEW — the kit's Table, as the Tasks tab's
// ═════════════════════════════════════════════════════
// The kit's Table: a real <table> with a fixed layout and 36px rows, so the
// header and the cells share one grid — every column sits under its own
// label (R4-42, and R4-01's one table) and the thumbnail column is ONE width
// for the whole table (R4-04). The fixed widths are rabbitFiles.css's
// custom properties, read by the header cells; Name, the row's anchor,
// takes the rest.
function AssetTable({ assets, groups, groupBy, phases, taskCountByAsset, ctx, canWrite, thumbSize, thumbRevision, collapsedGroups, toggleGroup, onThumbChanged, onWarningClick, onDetailClick, onHistoryClick }) {
  // ── Multi-select state ──
  const [selected, setSelected] = useState(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const allAssetIds = useMemo(() => {
    if (groups) return groups.flatMap(g => g.assets.map(a => a.id))
    return assets.map(a => a.id)
  }, [groups, assets])
  const allSelected = allAssetIds.length > 0 && allAssetIds.every(id => selected.has(id))
  const someSelected = selected.size > 0
  const phaseOptions = useMemo(() => phases.map(p => ({ value: p.id, label: p.name || 'Untitled' })), [phases])

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
  // W9: the confirm is the kit's Dialog now, not window.confirm — the same
  // question, and its Delete does exactly what OK did.
  function bulkDelete() {
    setConfirmBulkDelete(true)
  }
  function confirmedBulkDelete() {
    setConfirmBulkDelete(false)
    // Batch deletes reject on partial failure — the provider already
    // records the error in its state, so just swallow the rejection.
    ctx?.deleteAssets?.([...selected])?.catch(() => {})
    clearSelection()
  }

  const columns = [
    { key: 'name',        label: 'Name' },
    { key: 'type',        label: 'Type',        width: 'var(--rb-asset-type)' },
    { key: 'phase_id',    label: 'Phase',       width: 'var(--rb-asset-phase)' },
    { key: 'status',      label: 'Status',      width: 'var(--rb-asset-status)' },
    { key: 'start_date',  label: 'Start',       width: 'var(--rb-asset-date)' },
    { key: 'due_date',    label: 'Due',         width: 'var(--rb-asset-date)' },
    { key: 'description', label: 'Description', width: 'var(--rb-asset-desc)' },
    { key: 'tasks',       label: 'Tasks',       width: 'var(--rb-asset-tasks)', numeric: true },
    { key: '_actions',    label: 'Actions',     width: 'var(--rb-asset-acts)', unseen: true },
  ]
  // What a group row spans: the checkbox and thumbnail columns and the nine.
  const span = columns.length + 2

  if (assets.length === 0 && (!groups || groups.length === 0)) {
    return (
      <EmptyState Icon={Boxes} title="No assets yet" body="Click “New asset” to get started" />
    )
  }

  const row = (a) => (
    <AssetRow
      key={a.id}
      asset={a}
      columns={columns}
      phaseOptions={phaseOptions}
      taskCount={taskCountByAsset[a.id] || 0}
      warning={ctx?.selectAssetStatusWarning?.(a)}
      thumbRevision={thumbRevision}
      onUpdate={(patch) => ctx.updateAsset(a.id, patch)}
      readOnly={!canWrite}
      onDelete={canWrite ? () => ctx.deleteAsset(a.id) : null}
      onWarningClick={() => onWarningClick?.(a.id)}
      onDetailClick={() => onDetailClick?.(a.id)}
      onHistoryClick={onHistoryClick ? () => onHistoryClick(a.id) : null}
      onThumbChanged={onThumbChanged}
      isSelected={selected.has(a.id)} onToggleSelect={() => toggleOne(a.id)}
    />
  )

  return (
    <div className="rb-asset-table-wrap" data-thumb={thumbSize} data-history={onHistoryClick ? 'true' : 'false'}>
      {/* ── Bulk-action bar: over the head, right of the checkbox column (the
          controls appear where the selection was made), as B2's. ── */}
      {someSelected && (
        <div className="rb-asset-bulk">
          <span className="rb-asset-bulk-count">
            {selected.size} selected
          </span>
          {/* See ProjectTasksView's equivalent: one wrapper for the whole bulk
              group, so it dims and explains itself without six separate
              tooltips; the sheet gives it the bar's own gap. */}
          <GatedAction allowed={canWrite} className="rb-asset-bulk-gate">
            <span className="rb-asset-divider" aria-hidden="true" />
            <AssetBulkSelect label="Status" options={ASSET_STATUSES} labels={STATUS_LABELS} onPick={v => bulkUpdate({ status: v })} />
            <AssetBulkSelect label="Type" options={ASSET_TYPES} onPick={v => bulkUpdate({ type: v })} />
            <AssetBulkSelect label="Phase" options={phases.map(p => p.id)} labels={phases.reduce((m, p) => { m[p.id] = p.name; return m }, {})} onPick={v => bulkUpdate({ phase_id: v || null })} allowEmpty />
            <span className="rb-asset-divider" aria-hidden="true" />
            <Button size="sm" variant="danger" Icon={Trash2} onClick={bulkDelete}>
              Delete
            </Button>
          </GatedAction>
          <IconButton size="sm" Icon={X} title="Clear the selection" onClick={clearSelection} />
        </div>
      )}

      <Table
        className="rb-asset-table"
        head={(
          <Row>
            {/* Checkbox column */}
            <Th width="var(--rb-asset-check)" className="rb-asset-check-cell">
              <button type="button" onClick={toggleAll}
                className="rb-asset-check"
                data-checked={allSelected ? 'all' : someSelected ? 'some' : 'none'}
                aria-label={allSelected ? 'Clear the selection' : 'Select every asset'}
                title={allSelected ? 'Clear the selection' : 'Select every asset'}>
                {allSelected
                  ? <CheckSquare aria-hidden="true" />
                  : someSelected
                    ? <MinusSquare aria-hidden="true" />
                    : <Square aria-hidden="true" />}
              </button>
            </Th>
            {/* Thumbnail column: the chosen size, for every row */}
            <Th width="var(--rb-asset-thumb)" className="rb-asset-thumb-cell">
              <span className="sr-only">Thumbnail</span>
            </Th>
            {columns.map(c => (
              <Th key={c.key} width={c.width} numeric={c.numeric}>
                {c.unseen ? <span className="sr-only">{c.label}</span> : c.label}
              </Th>
            ))}
          </Row>
        )}
      >
        {groups ? (
          groups.map(g => {
            const collapsed = collapsedGroups.has(g.key)
            return (
              <Fragment key={g.key}>
                {/* Group header: one band across the table, as B2's */}
                <Row className="rb-asset-group-row">
                  <Td colSpan={span} className="rb-asset-group-cell">
                    <AssetGroupToggle group={g} groupBy={groupBy}
                      collapsed={collapsed} onToggle={() => toggleGroup(g.key)} />
                  </Td>
                </Row>
                {/* Group rows */}
                {!collapsed && g.assets.map(row)}
              </Fragment>
            )
          })
        ) : (
          assets.map(row)
        )}
      </Table>

      {/* W9: the bulk question on the kit Dialog — the same words, Cancel
          leaves every asset where it was, Delete deletes exactly as OK did.
          Raised here, outside the table, so no cell's nowrap reaches it. */}
      {confirmBulkDelete && (
        <Dialog
          width="confirm"
          title="Delete assets"
          onClose={() => setConfirmBulkDelete(false)}
          footer={(
            <>
              <Button autoFocus onClick={() => setConfirmBulkDelete(false)}>Cancel</Button>
              <Button variant="danger" onClick={confirmedBulkDelete}>Delete</Button>
            </>
          )}
        >
          <p className="rb-asset-confirm">
            {`Delete ${selected.size} asset${selected.size === 1 ? '' : 's'}?`}
          </p>
        </Dialog>
      )}
    </div>
  )
}

// ── A group's header, in the table and the gallery alike ──
// One button, the whole band: it was a clickable row with no keyboard way
// in. A status group carries the kit's StatusDot; the per-status accent
// colours computed here are gone, and every group reads in the one ink (R4-33).
function AssetGroupToggle({ group, groupBy, collapsed, onToggle }) {
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <button type="button" onClick={onToggle} aria-expanded={!collapsed}
      className="rb-asset-group-toggle">
      <Chevron aria-hidden="true" className="rb-asset-group-chevron" />
      {groupBy === 'status' && <StatusDot status={group.key} aria-hidden="true" role={undefined} aria-label={undefined} title="" />}
      <span className="rb-asset-group-label">{group.label}</span>
      <span className="rb-asset-group-count">{group.assets.length}</span>
    </button>
  )
}

// ── Bulk-action dropdown for the floating bar (B2's BulkSelect) ──
function AssetBulkSelect({ label, options, labels, onPick, allowEmpty }) {
  return (
    <select
      defaultValue=""
      aria-label={label}
      onChange={e => { if (e.target.value !== '') { onPick(e.target.value); e.target.value = '' } }}
      className="ui-input rb-asset-tool"
      data-size="sm"
    >
      <option value="" disabled>{label}</option>
      {allowEmpty && <option value="">None</option>}
      {options.map(o => <option key={o} value={o}>{(labels?.[o] || o).replace(/_/g, ' ')}</option>)}
    </select>
  )
}


// ── Single asset row: the kit's Row, the one hairline row language (R4-22):
// no card border, radius or gap; the selection is the Row's own ──
// Session 29 — `readOnly` closes the same hole found in TaskRow: every inline
// cell here commits through `onUpdate` → ctx.updateAsset, and none of it was
// gated. The New asset button being gated while the ROW was not is why this
// file read as "already gated".
function AssetRow({ asset, columns, phaseOptions, taskCount, warning, thumbRevision, onUpdate, onDelete, onWarningClick, onDetailClick, onHistoryClick, onThumbChanged, isSelected, onToggleSelect, readOnly = false }) {
  // Only the remove-thumbnail button still mounts on hover, as it always did;
  // every other hover state is the sheet's (`.rb-asset-row:hover`, the kit's
  // HoverActions), so none of them is decided in a style any more.
  const [hovered, setHovered] = useState(false)
  const hasThumbnail = !!asset.thumbnail_image
  // What every icon-only control on the row is named for.
  const name = asset.name || 'Untitled'

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

  // The cell selects are the kit's CellSelect: borderless, the cell's own
  // text until the row is hovered or focused. Every one is disabled for a
  // read-only viewer, and the kit keys the cursor and the third ink on that.
  // The name is the row's anchor (Dense 600 in the full ink); type, phase,
  // the dates and the description take the second ink (R4-03).
  function dateCell(key, label) {
    return (
      <Td key={key} className="rb-asset-ctl-cell">
        <input
          type="date"
          value={asset[key] || ''}
          onChange={e => onUpdate({ [key]: e.target.value || null })}
          readOnly={readOnly} disabled={readOnly}
          aria-label={`${label} for ${name}`}
          className="rb-asset-date"
          data-empty={asset[key] ? 'false' : 'true'}
        />
      </Td>
    )
  }

  function renderCell(col) {
    switch (col.key) {
      case 'name':
        return (
          <Td key={col.key} className="rb-asset-ctl-cell">
            <span className="rb-asset-name">
              <CellInlineText value={asset.name || ''} placeholder="Untitled" onCommit={v => onUpdate({ name: v })} readOnly={readOnly} />
              <HoverActions>
                <IconButton size="sm" Icon={FileText} title="View asset details" onClick={onDetailClick} />
              </HoverActions>
            </span>
          </Td>
        )
      case 'type':
        return (
          <Td key={col.key}>
            <CellSelect
              className="rb-asset-quiet-select"
              value={asset.type || 'other'}
              onChange={v => onUpdate({ type: v })}
              options={TYPE_OPTIONS}
              disabled={readOnly}
              aria-label={`Type for ${name}`}
            />
          </Td>
        )
      case 'phase_id':
        return (
          <Td key={col.key}>
            <CellSelect
              className="rb-asset-quiet-select"
              value={asset.phase_id || null}
              onChange={v => onUpdate({ phase_id: v })}
              placeholder="—"
              options={phaseOptions}
              disabled={readOnly}
              aria-label={`Phase for ${name}`}
            />
          </Td>
        )
      case 'status':
        // The kit's StatusDot beside the words, and the words in the one ink:
        // no status colour on the text (R4-05).
        return (
          <Td key={col.key} className="rb-asset-ctl-cell">
            <span className="rb-asset-status">
              <StatusDot status={asset.status || 'not_started'} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
              <CellSelect
                className="rb-asset-status-select"
                value={asset.status || 'not_started'}
                onChange={v => onUpdate({ status: v })}
                options={STATUS_OPTIONS}
                disabled={readOnly}
                aria-label={`Status for ${name}`}
              />
              {warning && (
                <IconButton size="sm" Icon={AlertTriangle} danger
                  title="Tasks not yet done — click for details"
                  onClick={onWarningClick} />
              )}
            </span>
          </Td>
        )
      case 'start_date':
        return dateCell('start_date', 'Start date')
      case 'due_date':
        return dateCell('due_date', 'Due date')
      case 'description':
        // Read-only here (it is edited in the detail popup): the second ink,
        // no hover fill, no pointer (R4-44).
        return (
          <Td key={col.key} className="rb-asset-desc"
            data-empty={asset.description ? 'false' : 'true'}
            title={asset.description || undefined}>
            {asset.description || '—'}
          </Td>
        )
      case 'tasks':
        // A count: right-aligned, tabular, in the mono (R4-17).
        return <Td key={col.key} numeric className="rb-asset-tasks">{taskCount}</Td>
      case '_actions':
        return (
          <Td key={col.key} align="right" className="rb-asset-acts-cell">
            <HoverActions className="rb-asset-acts">
              {onHistoryClick && (
                <IconButton size="sm" Icon={History} title={`View edit history for ${name}`} onClick={onHistoryClick} />
              )}
              {onDelete && (
                // Soft delete — no confirm; the shell-level undo toast covers it.
                <IconButton size="sm" Icon={Trash2} danger title={`Delete ${name}`} onClick={onDelete} />
              )}
            </HoverActions>
          </Td>
        )
      default:
        return <Td key={col.key} className="rb-asset-desc">{asset[col.key] ?? '—'}</Td>
    }
  }

  return (
    <Row
      className="rb-asset-row"
      selected={isSelected}
      data-ticked={isSelected ? 'true' : 'false'}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    >
      {/* Checkbox: shown on hover, on focus and while ticked, as B2's */}
      <Td className="rb-asset-check-cell">
        <button type="button" onClick={e => { e.stopPropagation(); onToggleSelect?.() }}
          className="rb-asset-check"
          data-checked={isSelected ? 'all' : 'none'}
          aria-pressed={isSelected}
          aria-label={`Select ${name}`}
          title={`Select ${name}`}>
          {isSelected
            ? <CheckSquare aria-hidden="true" />
            : <Square aria-hidden="true" />}
        </button>
      </Td>

      {/* Thumbnail: the column's one width; a row with no thumbnail
          letterboxes its 36px placeholder in it, centred (R4-04). */}
      <Td className="rb-asset-thumb-cell">
        {hasThumbnail ? (
          <div
            className="rb-asset-thumb"
            onClick={handleSetThumbnail}
            title={`Change thumbnail for ${name}`}
          >
            <img
              className="rb-asset-thumb-img"
              src={`/api/rabbit/projects/${asset.project_id}/assets/${asset.id}/thumbnail?r=${thumbRevision}`}
              alt=""
            />
            {hovered && (
              <IconButton size="sm" Icon={ImageOff} danger
                className="rb-asset-thumb-remove"
                title={`Remove thumbnail for ${name}`}
                onClick={(e) => { e.stopPropagation(); handleClearThumbnail() }} />
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSetThumbnail}
            className="rb-asset-thumb-set"
            title={`Set thumbnail for ${name}`}
          >
            <ImagePlus aria-hidden="true" />
          </button>
        )}
      </Td>

      {/* Data columns */}
      {columns.map(renderCell)}
    </Row>
  )
}


// ═════════════════════════════════════════════════════
// GALLERY VIEW
// ═════════════════════════════════════════════════════
function AssetGallery({ assets, phaseById, taskCountByAsset, ctx, canWrite, thumbRevision, onThumbChanged, onWarningClick, onDetailClick }) {
  if (assets.length === 0) {
    // The kit's empty state (R4-13), in sentence case.
    return <EmptyState Icon={Boxes} title="No assets" />
  }
  return (
    <div className="rb-asset-gallery">
      {assets.map(a => (
        <AssetCard
          key={a.id}
          asset={a}
          phaseLabel={phaseById[a.phase_id]?.name || ''}
          taskCount={taskCountByAsset[a.id] || 0}
          warning={ctx?.selectAssetStatusWarning?.(a)}
          thumbRevision={thumbRevision}
          onUpdate={(patch) => ctx.updateAsset(a.id, patch)}
          readOnly={!canWrite}
          onDelete={canWrite ? () => ctx.deleteAsset(a.id) : null}
          onWarningClick={() => onWarningClick?.(a.id)}
          onDetailClick={() => onDetailClick?.(a.id)}
          onThumbChanged={onThumbChanged}
        />
      ))}
    </div>
  )
}

// The kit's Card (raised paper, one hairline, 3px): the picture or the
// initials in the paper well, the status the kit's StatusBadge over it (its
// words and tone from the one STATUS map; the 2px status-colour bar under
// the picture said the same thing again and is gone), the name at 600 and
// the task count in the mono.
function AssetCard({ asset, phaseLabel, taskCount, warning, thumbRevision, onUpdate, onDelete, onWarningClick, onDetailClick, onThumbChanged, readOnly = false }) {
  // The detail and thumbnail buttons still mount on hover, as they did.
  const [hovered, setHovered] = useState(false)
  const hasThumbnail = !!asset.thumbnail_image
  const name = asset.name || 'Untitled'
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
    <Card
      pad={false}
      className="rb-asset-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Thumbnail / initials block */}
      <div className="rb-asset-card-media">
        {hasThumbnail ? (
          <img
            className="rb-asset-card-img"
            src={`/api/rabbit/projects/${asset.project_id}/assets/${asset.id}/thumbnail?r=${thumbRevision}`}
            alt=""
          />
        ) : (
          <span className="rb-asset-card-initials">
            {initials}
          </span>
        )}
        {warning && (
          <IconButton size="sm" Icon={AlertTriangle} danger
            className="rb-asset-card-tool rb-asset-card-warn"
            title="Status mismatch — click for details"
            onClick={onWarningClick} />
        )}
        {hovered && (
          <>
            <IconButton size="sm" Icon={FileText}
              className="rb-asset-card-tool rb-asset-card-detail"
              title="View asset details"
              onClick={onDetailClick} />
            <IconButton size="sm" Icon={ImagePlus}
              className="rb-asset-card-tool rb-asset-card-thumb"
              title={hasThumbnail ? `Change thumbnail for ${name}` : `Set thumbnail for ${name}`}
              onClick={handleSetThumbnail} />
          </>
        )}
        {/* On the paper, so the badge's tint reads the same over a picture. */}
        <span className="rb-asset-card-status">
          <StatusBadge status={asset.status || 'not_started'} />
        </span>
      </div>

      {/* Body */}
      <div className="rb-asset-card-body">
        <div className="rb-asset-card-name">
          <InlineText
            value={asset.name || ''}
            onCommit={(name) => onUpdate({ name })}
            placeholder="Untitled"
            readOnly={readOnly}
          />
        </div>
        <div className="rb-asset-card-meta text-label uppercase">
          <span>{fmt(asset.type || 'other')}</span>
          {phaseLabel && <span className="rb-asset-card-phase">{'·'} {phaseLabel}</span>}
        </div>
      </div>

      {/* Footer */}
      <div className="rb-asset-card-foot">
        <span className="rb-asset-card-count">
          {taskCount} task{taskCount === 1 ? '' : 's'}
        </span>
        {onDelete && (
          // Soft delete — no confirm; the shell-level undo toast covers it.
          <IconButton size="sm" Icon={Trash2} danger title={`Delete ${name}`} onClick={onDelete} />
        )}
      </div>
    </Card>
  )
}


// ═════════════════════════════════════════════════════
// NEW ASSET POPUP — draft locally, only commit on confirm
// ═════════════════════════════════════════════════════
// The kit's Dialog at the form width (560), its fields laid out as B2's
// NewTaskPopup lays out its own: the kit Field (the Label step over a native
// `ui-input`), two-up where they were two-up, Cancel and Confirm & create the
// kit's Buttons in its footer. 🚨 PORTALLED into <body>, as FileManager's
// delete question is: the kit Dialog does not portal (B4-KR-2), and a fixed
// layer inside a transformed host lays out inside that host's box. React
// events still bubble through the tree it was written in.
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

  return createPortal(
    <Dialog
      width="form"
      title="Create new asset"
      // The backdrop closed it before and still does; Escape closes it too
      // (Q17), and the busy lock holds it open while the create is in flight.
      dismissOnBackdrop
      busy={creating}
      // Session 23: a failed create must say so. The kit Dialog reports it
      // INSIDE the footer, beside the button that failed, where the red box
      // above the footer used to (B2's NewTaskPopup does the same).
      error={error}
      onClose={onClose}
      footer={(
        <>
          <span className="rb-asset-new-note">
            Nothing is saved until you confirm.
          </span>
          <Button onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm}
            disabled={!draft.name.trim()}
            loading={creating}
            loadingLabel="Creating…">
            Confirm & create
          </Button>
        </>
      )}
    >
      <div className="ui-field-stack">
        <Field label="Name *">
          <input
            autoFocus
            type="text"
            value={draft.name}
            onChange={e => patch({ name: e.target.value })}
            placeholder="Asset name…"
            className="ui-input"
          />
        </Field>

        {/* Type + Status row */}
        <div className="rb-asset-form-grid">
          <Field label="Type">
            <select value={draft.type} onChange={e => patch({ type: e.target.value })}
              className="ui-input">
              {ASSET_TYPES.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
            </select>
          </Field>
          <Field label="Status">
            {/* The kit's dot inside the field and the words in the one ink,
                where the words and every option were the status colour (R4-05). */}
            <span className="rb-asset-form-status">
              <StatusDot status={draft.status} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
              <select value={draft.status} onChange={e => patch({ status: e.target.value })}
                className="ui-input rb-asset-form-status-input">
                {ASSET_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </span>
          </Field>
        </div>

        {/* Phase */}
        <Field label="Phase">
          <select value={draft.phase_id} onChange={e => patch({ phase_id: e.target.value })}
            className="ui-input rb-asset-form-field"
            data-empty={draft.phase_id ? 'false' : 'true'}>
            <option value="">No phase</option>
            {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
          </select>
        </Field>

        {/* Dates row: the native picker dark (R4-28) */}
        <div className="rb-asset-form-grid">
          <Field label="Start date">
            <input type="date" value={draft.start_date} onChange={e => patch({ start_date: e.target.value })}
              className="ui-input rb-asset-form-field rb-asset-form-date"
              data-empty={draft.start_date ? 'false' : 'true'} />
          </Field>
          <Field label="Due date">
            <input type="date" value={draft.due_date} onChange={e => patch({ due_date: e.target.value })}
              className="ui-input rb-asset-form-field rb-asset-form-date"
              data-empty={draft.due_date ? 'false' : 'true'} />
          </Field>
        </div>

        {/* Description */}
        <Field label="Description">
          <textarea
            value={draft.description}
            onChange={e => patch({ description: e.target.value })}
            rows={2}
            placeholder="Optional description…"
            className="ui-input"
          />
        </Field>

        {/* Task template selector */}
        <Field label="Task template">
          <select
            value={selectedTemplateId}
            onChange={e => setSelectedTemplateId(e.target.value)}
            className="ui-input rb-asset-form-field"
            data-empty={selectedTemplateId ? 'false' : 'true'}>
            <option value="">No template</option>
            {projectTemplates.map(tmpl => {
              const count = (tmpl.tasks || []).length
              const days = (tmpl.tasks || []).reduce((s, t) => s + (t.bid_days || 0), 0)
              return <option key={tmpl.id} value={tmpl.id}>{tmpl.name} ({count} tasks, {days}d)</option>
            })}
          </select>
        </Field>

        {/* Template task preview: a hairline list, its head in the Label step
            (the kit Th's), each task's role the kit's Badge. */}
        {previewTasks.length > 0 && (
          <div className="rb-asset-preview">
            <div className="rb-asset-preview-head text-label uppercase">
              Tasks to be created ({previewTasks.length})
            </div>
            <div className="rb-asset-preview-list">
              {previewTasks.map((t, i) => (
                <div key={t.id || i} className="rb-asset-preview-row">
                  <span className="rb-asset-preview-name">
                    {t.name || 'Untitled'}
                  </span>
                  {t.role_slug && <Badge>{fmt(t.role_slug)}</Badge>}
                  <span className="rb-asset-preview-days">
                    {t.bid_days || 0}d
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>,
    document.body,
  )
}


// ═════════════════════════════════════════════════════
// ASSET DETAIL POPUP
// ═════════════════════════════════════════════════════
// The kit's Dialog at its old width, 1152px (max-w-6xl; the kit caps it at
// 94vw), 🚨 PORTALLED into <body> as NewAssetPopup is. Its title is the
// asset's name, still edited in place; "Done" is the kit's primary (it was
// white on orange at 13px, C6). R4-10 — four co-equal jobs in one modal
// (relations, properties, tasks, files) — is RECORDED, not restructured
// (C1): the four sections keep their order and their behaviour, and only
// their chrome is the kit's.
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

  // Escape closes the popup (Q17) — except while a hand-rolled fixed layer is
  // open inside it: the relation pickers (the sidebar's, and the four fields'
  // below) and FileManager's VideoPreview are not on the kit's modal stack,
  // so one Escape would close the layer AND the popup. The two columns are
  // walked for any descendant whose computed position is fixed (the pattern
  // and the reason: TaskDetailPopup's `filesLayerOpen`). The main column
  // hosts the four pickers and FileManager; the kit's own backdrop sits
  // outside both, so it never counts.
  const sideRef = useRef(null)
  const mainRef = useRef(null)
  function layerOpen() {
    for (const col of [sideRef.current, mainRef.current]) {
      if (!col) continue
      for (const el of col.querySelectorAll('*')) {
        if (getComputedStyle(el).position === 'fixed') return true
      }
    }
    return false
  }

  if (!asset) return null

  const hasThumbnail = !!asset.thumbnail_image
  // A title that is a node (the editable name) names nothing, so the dialog
  // carries the name as its aria-label.
  const name = asset.name || 'Untitled asset'
  const initials = (asset.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('')
  // What each relation field's RelationBadge counts.
  const linked = {
    scenes: asset.scene_ids?.length || 0,
    shots: asset.shot_ids?.length || 0,
    levels: asset.level_ids?.length || 0,
    experiences: asset.experience_ids?.length || 0,
  }

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

  return createPortal(
    <Dialog
      width={1152}
      className="rb-asset-detail"
      aria-label={name}
      // The editable name, with the entity icon, at the H2 step (R4-09): it
      // edits exactly as it did.
      title={(
        <span className="rb-asset-detail-title">
          <Boxes className="rb-asset-detail-icon" aria-hidden="true" />
          <InlineText
            value={asset.name || ''}
            onCommit={(name) => handleUpdateAsset({ name })}
            placeholder="Untitled asset"
          />
        </span>
      )}
      // The status, where the 3px status-coloured rule under the header used
      // to say it (R4-05; B2's TaskDetailPopup does the same).
      subtitle={<StatusBadge status={asset.status || 'not_started'} />}
      // The backdrop closed it before, and still does.
      dismissOnBackdrop
      onBeforeClose={() => !layerOpen()}
      onClose={onClose}
      footer={(
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      )}
    >
      <div className="rb-asset-detail-body">
        {/* LEFT COLUMN — Relations sidebar (RelationsPanel's) */}
        <div className="rb-asset-detail-side" ref={sideRef}>
          <AssetRelationsSidebar asset={asset} ctx={ctx} />
        </div>

        {/* RIGHT COLUMN — Properties */}
        <div className="rb-asset-detail-main" ref={mainRef}>

          {/* Thumbnail section */}
          <div className="rb-asset-detail-thumbrow">
            <div className="rb-asset-detail-thumb">
              {hasThumbnail ? (
                <img
                  className="rb-asset-card-img"
                  src={`/api/rabbit/projects/${asset.project_id}/assets/${asset.id}/thumbnail?r=${thumbRevision}`}
                  alt=""
                />
              ) : (
                <span className="rb-asset-card-initials">
                  {initials}
                </span>
              )}
            </div>
            <div className="rb-asset-detail-thumbmeta">
              <span className="rb-asset-prop-label text-label uppercase">
                Thumbnail
              </span>
              <div className="rb-asset-detail-thumbacts">
                <Button size="sm" Icon={ImagePlus} onClick={handleSetThumbnail}>
                  {hasThumbnail ? 'Change' : 'Set thumbnail'}
                </Button>
                {hasThumbnail && (
                  <Button size="sm" variant="danger" Icon={ImageOff} onClick={handleClearThumbnail}>
                    Remove
                  </Button>
                )}
              </div>
              {hasThumbnail && (
                <span className="rb-asset-detail-thumbfile" title={asset.thumbnail_image}>
                  {asset.thumbnail_image.split(/[/\\]/).pop()}
                </span>
              )}
            </div>
          </div>

          {/* Properties grid: the Label step over each value, and every editor
              the table's own — the kit's CellSelect, the lane's date field, a
              quiet button — so the popup and the row it was opened from speak
              one language. Each control carries its own name. */}
          <div className="rb-asset-prop-grid">
            <PropField label="Type">
              <CellSelect
                value={asset.type || 'other'}
                onChange={(type) => handleUpdateAsset({ type })}
                options={TYPE_OPTIONS}
                aria-label="Type"
              />
            </PropField>
            <PropField label="Status">
              {/* The kit's StatusDot beside the words in the one ink: no
                  status colour on the text (R4-05). */}
              <span className="rb-asset-status">
                <StatusDot status={asset.status || 'not_started'} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
                <CellSelect
                  className="rb-asset-status-select"
                  value={asset.status || 'not_started'}
                  onChange={(status) => handleUpdateAsset({ status })}
                  options={STATUS_OPTIONS}
                  aria-label="Status"
                />
              </span>
            </PropField>
            <PropField label="Phase">
              <CellSelect
                value={asset.phase_id || null}
                onChange={(phase_id) => handleUpdateAsset({ phase_id: phase_id || null })}
                placeholder={'—'}
                options={phases.map(p => ({ value: p.id, label: p.name || 'Untitled' }))}
                aria-label="Phase"
              />
            </PropField>
            <PropField label="Tasks" value={String(tasks.length)} numeric />
            <PropField label="Task template">
              <CellSelect
                value=""
                onChange={(templateId) => handleApplyTemplate(templateId)}
                placeholder={applyingTemplate ? 'Applying…' : '— Apply template'}
                options={projectTemplates.map(tmpl => ({ value: tmpl.id, label: tmpl.name || '' }))}
                disabled={applyingTemplate}
                aria-label="Task template"
              />
            </PropField>
            <PropField label="Start date">
              <input
                type="date"
                value={asset.start_date || ''}
                onChange={e => handleUpdateAsset({ start_date: e.target.value || null })}
                aria-label="Start date"
                className="rb-asset-date"
                data-empty={asset.start_date ? 'false' : 'true'}
              />
            </PropField>
            <PropField label="Due date">
              <input
                type="date"
                value={asset.due_date || ''}
                onChange={e => handleUpdateAsset({ due_date: e.target.value || null })}
                aria-label="Due date"
                className="rb-asset-date"
                data-empty={asset.due_date ? 'false' : 'true'}
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
                      // W2: the edit's Escape reverts it and is MARKED handled
                      // (K4's mark), so the popup stays; the next one closes it.
                      if (e.key === 'Escape') { e.preventDefault(); setDescDraft(asset.description || ''); setEditingDesc(false) }
                    }}
                    rows={3}
                    aria-label="Description"
                    className="ui-input rb-asset-prop-textarea"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { setDescDraft(asset.description || ''); setEditingDesc(true) }}
                    className="rb-asset-prop-text"
                    data-empty={asset.description ? 'false' : 'true'}
                  >
                    {asset.description || 'Click to add description…'}
                  </button>
                )}
              </PropField>
            </div>
            {asset.created_at && <PropField label="Created" value={new Date(asset.created_at).toLocaleDateString()} />}
            {asset.updated_at && <PropField label="Updated" value={new Date(asset.updated_at).toLocaleDateString()} />}

            {/* ── Relation fields ── RelationsPanel's RelationBadge (R4-27):
                the kind's glyph and the count, the one active treatment when
                anything is linked, named "Scenes: N linked"; the "(s)" words
                and the em dash went with it. Each keeps its place and its
                click: it opens that field's picker. */}
            {project?.scenes_enabled && (
              <PropField label="Scenes">
                <RelationBadge icon={Film} count={linked.scenes} label="Scenes"
                  onClick={() => setShowScenePicker(true)} />
              </PropField>
            )}
            {project?.scenes_enabled && (
              <PropField label="Shots">
                <RelationBadge icon={Clapperboard} count={linked.shots} label="Shots"
                  onClick={() => setShowShotPicker(true)} />
              </PropField>
            )}
            {project?.levels_enabled && (
              <PropField label="Levels">
                <RelationBadge icon={Gamepad2} count={linked.levels} label="Levels"
                  onClick={() => setShowLevelPicker(true)} />
              </PropField>
            )}
            {project?.experiences_enabled && (
              <PropField label="Experiences">
                <RelationBadge icon={Sparkles} count={linked.experiences} label="Experiences"
                  onClick={() => setShowExperiencePicker(true)} />
              </PropField>
            )}
          </div>

          {/* ── Relation picker popups ── */}
          {showScenePicker && (
            <RelationPickerPopup
              title="Link scenes"
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
              title="Link shots"
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
              title="Link levels"
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
              title="Link experiences"
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

          {/* Tasks section: a Label-step heading, as FileManager's "Files (N)"
              is, over the kit's Table, dense (R4-06) — the two tables in this
              popup are one language now. */}
          <div className="rb-asset-detail-heading text-label uppercase">
            Tasks ({tasks.length})
          </div>

          {tasks.length === 0 ? (
            <EmptyState compact Icon={ListChecks} title="No tasks on this asset" />
          ) : (
            <Table
              dense
              className="rb-asset-task-table"
              head={(
                <Row>
                  <Th>Title</Th>
                  <Th width="var(--rb-asset-task-status)">Status</Th>
                  <Th width="var(--rb-asset-task-bid)" numeric>Bid</Th>
                  <Th width="var(--rb-asset-task-person)">Assignee</Th>
                  <Th width="var(--rb-asset-task-person)">Reviewer</Th>
                </Row>
              )}
            >
              {tasks.map(t => (
                <TaskRowInPopup
                  key={t.id}
                  task={t}
                  projectMembers={projectMembers}
                  memberById={memberById}
                  onUpdateTask={(patch) => ctx?.updateTask?.(t.id, patch)}
                />
              ))}
            </Table>
          )}

          {/* Files section */}
          <div className="rb-asset-detail-files">
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
    </Dialog>,
    document.body,
  )
}

// A task's status words, from the kit's one source (as STATUS_OPTIONS above).
const TASK_STATUS_OPTIONS = TASK_STATUSES.map(s => ({ value: s, label: statusMeta(s).label }))

// ── A task in the popup's table: the kit's Row in a dense Table (R4-06) ──
// Its three editors are the kit's CellSelect. The status is the kit's
// StatusDot beside the words in the one ink (R4-05), where the words were the
// status colour; the bid is a numeric cell (R4-17); an empty value is an em
// dash (R4-19). The reviewer's violet went with the cool hues.
function TaskRowInPopup({ task, projectMembers, memberById, onUpdateTask }) {
  const title = task.title || task.assigned_position || 'Untitled'
  const people = projectMembers.map(m => ({ value: m.id, label: m.name || '' }))
  return (
    <Row>
      <Td title={title}>{title}</Td>
      <Td className="rb-asset-task-ctl">
        <span className="rb-asset-status">
          <StatusDot status={task.status || 'waiting_to_start'} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
          <CellSelect
            className="rb-asset-status-select"
            value={task.status || 'waiting_to_start'}
            onChange={(status) => onUpdateTask({ status })}
            options={TASK_STATUS_OPTIONS}
            aria-label={`Status for ${title}`}
          />
        </span>
      </Td>
      <Td numeric className="rb-asset-task-bid" data-empty={task.bid_days ? 'false' : 'true'}>
        {task.bid_days ? `${task.bid_days}d` : '—'}
      </Td>
      <Td>
        <CellSelect
          value={task.assignee_id || null}
          onChange={(v) => onUpdateTask({ assignee_id: v || null })}
          placeholder="—"
          options={people}
          aria-label={`Assignee for ${title}`}
        />
      </Td>
      <Td>
        <CellSelect
          value={task.reviewer_id || null}
          onChange={(v) => onUpdateTask({ reviewer_id: v || null })}
          placeholder="—"
          options={people}
          aria-label={`Reviewer for ${title}`}
        />
      </Td>
    </Row>
  )
}


// ═════════════════════════════════════════════════════
// SHARED ATOMS
// ═════════════════════════════════════════════════════

// ── A property in the detail popup: the Label step over its value ──
// A <div>, not the kit Field: a Field is a <label>, and a <label> forwards a
// click on its caption to a button inside it (B2's K3) — the description and
// the four relation fields are buttons, and a click on their caption never
// started anything. The controls carry their own names instead.
function PropField({ label, value, numeric = false, children }) {
  return (
    <div className="rb-asset-prop">
      <span className="rb-asset-prop-label text-label uppercase">{label}</span>
      {children || (
        <span className="rb-asset-prop-value" data-numeric={numeric ? 'true' : undefined}>
          {value || '—'}
        </span>
      )}
    </div>
  )
}

// ── Inline editors ──
// The asset's name, edited in place: the gallery card's (Dense, at the card's
// 600) and the detail popup's title (the H2 step, R4-09 — rabbitFiles.css
// sizes it by where it sits). Enter and blur commit and Escape reverts, as
// they did. The Escape is MARKED handled (K4's mark), so the kit Dialog around
// the title stands down on it: the first press reverts the edit, the next one
// closes the popup (W2).
function InlineText({ value, onCommit, placeholder, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  // Session 29 — see CellInlineText. Gallery cards edit the asset name too.
  if (readOnly) {
    return (
      <span className="rb-asset-inline" data-empty={value ? 'false' : 'true'}>
        {value || placeholder || '—'}
      </span>
    )
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
          if (e.key === 'Escape') { e.preventDefault(); setDraft(value); setEditing(false) }
        }}
        aria-label="Name"
        className="ui-input rb-asset-inline-input"
        data-size="sm"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => { setDraft(value); setEditing(true) }}
      className="rb-asset-inline"
      data-empty={value ? 'false' : 'true'}
    >
      {value || placeholder || '—'}
    </button>
  )
}

// The table's name editor (B2's CellInlineText, in this lane's classes)
function CellInlineText({ value, placeholder, onCommit, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  // Session 29 — plain text, no button, no hover. See the Tasks tab twin.
  if (readOnly) {
    return (
      <span className="rb-asset-cell-text" data-empty={value ? 'false' : 'true'} data-static="true"
        title={value || undefined}>
        {value || placeholder || '—'}
      </span>
    )
  }
  // Enter and blur commit, Escape reverts — unchanged. A native field in the
  // kit's small well, not the kit Input (whose own Enter blurs; B3d-KR-2).
  if (editing) {
    return (
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        aria-label="Name"
        className="ui-input rb-asset-cell-input"
        data-size="sm" />
    )
  }
  return (
    <button type="button" onClick={() => { setDraft(value); setEditing(true) }}
      className="rb-asset-cell-text"
      title={value || undefined}
      data-empty={value ? 'false' : 'true'}>
      {value || placeholder || '—'}
    </button>
  )
}
