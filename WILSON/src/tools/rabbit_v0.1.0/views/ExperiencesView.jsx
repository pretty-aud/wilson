// ============================================================
// RABBIT — ExperiencesView (Phase 4 — full implementation)
// ============================================================
//
// Experience management view with table and gallery modes,
// inline editing, detail popup, create/delete workflows.
//
// Same structure as LevelsView — flat list, no nested children.
// Each experience has a name, status, description, and linked
// assets / tasks counts.
//
// ── UX Laws applied ──
// • Aesthetic-Usability Effect — polished dark stone surface
// • Law of Common Region — rows as clearly bounded groups
// • Law of Proximity — tight internal spacing, generous external gaps
// • Von Restorff Effect — status accent bars for instant recognition

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  Sparkles, Plus, Search, X, LayoutGrid, Filter,
  Layers, ChevronDown, ChevronRight, Trash2, Eye,
  Table as TableIcon, ArrowUpDown, AlertTriangle, Save,
  BookmarkPlus, CheckSquare, Square, MinusSquare, Upload,
  ImagePlus, ImageOff,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import { useRateCard } from '../../../components/RateCard/useRateCard'
import TaskDetailPopup from '../components/TaskDetailPopup'
import RelationsPanel, { NewTaskSidePopup } from '../components/RelationsPanel'

// ── Status config ──
const EXPERIENCE_STATUSES = [
  'not_started', 'in_progress', 'pending_review', 'needs_revisions',
  'approved', 'final', 'blocked', 'on_hold', 'omitted',
]

// ── Sort config ──
const SORTABLE_FIELDS = [
  { value: 'name',       label: 'Name' },
  { value: 'status',     label: 'Status' },
  { value: 'created_at', label: 'Created' },
]

// ── Group config ──
const GROUPABLE_FIELDS = [
  { value: '',       label: 'No grouping' },
  { value: 'status', label: 'Status' },
]

// ── Filter config ──
const EXP_FILTER_FIELDS = [
  { value: 'status', label: 'Status', type: 'select', options: EXPERIENCE_STATUSES },
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

const SAVED_VIEWS_KEY = 'rabbit_experience_saved_views'

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
export default function ExperiencesView() {
  const ctx = useRabbit()
  const project = ctx?.project
  const experiences = ctx?.experiences || []
  const assets = ctx?.assets || []
  const tasks = ctx?.tasks || []
  const phases = ctx?.phases || []

  // ── Team members + rate card (for task creation popup) ──
  const tm = useTeamMembers()
  const rc = useRateCard()
  const teamAssignments = ctx?.teamAssignments || []
  const memberById = useMemo(() => { const m = {}; for (const mb of tm.members) m[mb.id] = mb; return m }, [tm.members])
  const projectMembers = useMemo(() => teamAssignments.map(a => memberById[a.member_id]).filter(Boolean), [teamAssignments, memberById])
  const roleEntries = useMemo(() => { const seen = new Set(); return (rc.entries || []).filter(e => { if (!e.role_slug || seen.has(e.role_slug)) return false; seen.add(e.role_slug); return true }) }, [rc.entries])

  // ── View state ──
  const [viewMode, setViewMode]     = useState('table')
  const [search, setSearch]         = useState('')
  const [filters, setFilters]       = useState([])
  const [sortField, setSortField]   = useState('')
  const [sortDir, setSortDir]       = useState('asc')
  const [groupBy, setGroupBy]       = useState('')
  const [gallerySize, setGallerySize] = useState('md')
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())

  // ── Saved views ──
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || '[]') } catch { return [] }
  })
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')

  // ── Popup state ──
  const [detailExpId, setDetailExpId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null) // { id, name }
  const [thumbRevision, setThumbRevision] = useState(0)
  const [showCreatePopup, setShowCreatePopup] = useState(false)

  function toggleGroup(key) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── Lookups ──
  const assetCountByExperience = useMemo(() => {
    const map = {}
    for (const a of assets) {
      if (!a.experience_id) continue
      map[a.experience_id] = (map[a.experience_id] || 0) + 1
    }
    return map
  }, [assets])

  const taskCountByExperience = useMemo(() => {
    const map = {}
    for (const t of tasks) {
      if (!t.experience_id) continue
      map[t.experience_id] = (map[t.experience_id] || 0) + 1
    }
    return map
  }, [tasks])

  // ── CRUD handlers ──
  const handleDeleteExperience = useCallback(async (id) => {
    try {
      await ctx?.deleteExperience?.(id)
    } catch (err) { console.error('Failed to delete experience:', err) }
    setConfirmDelete(null)
    if (detailExpId === id) setDetailExpId(null)
  }, [ctx, detailExpId])

  // ── Saved views ──
  function saveCurrentView() {
    if (!saveName.trim()) return
    const view = { id: Date.now().toString(), name: saveName.trim(), filters, sortField, sortDir, groupBy, viewMode, gallerySize }
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
    let result = experiences
    const s = search.trim().toLowerCase()
    if (s) result = result.filter(ex => (ex.name || '').toLowerCase().includes(s))
    for (const f of filters) {
      if (!f.field) continue
      result = result.filter(ex => {
        const val = ex[f.field]
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
  }, [experiences, search, filters])

  // ── Sorting ──
  const sorted = useMemo(() => {
    if (!sortField) return [...filtered].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const dir = sortDir === 'desc' ? -1 : 1
    return [...filtered].sort((a, b) => {
      let va = a[sortField] ?? ''
      let vb = b[sortField] ?? ''
      if (sortField === 'status') {
        va = EXPERIENCE_STATUSES.indexOf(va); vb = EXPERIENCE_STATUSES.indexOf(vb)
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
    for (const ex of sorted) {
      const key = groupBy === 'status' ? (ex.status || 'not_started') : '__all__'
      if (!map[key]) map[key] = []
      map[key].push(ex)
    }
    let sortedKeys
    if (groupBy === 'status') sortedKeys = EXPERIENCE_STATUSES.filter(s => map[s])
    else sortedKeys = Object.keys(map)
    return sortedKeys.map(key => ({
      key,
      label: fmt(key),
      experiences: map[key] || [],
    }))
  }, [sorted, groupBy])

  function groupAccent(key) {
    if (groupBy === 'status') return statusColor(key)
    return '#fb923c'
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
            {SORTABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <button type="button" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            className="p-1.5 rounded-sm hover:bg-stone-700 transition-colors"
            style={{ color: sortField ? '#fb923c' : '#57534e' }}>
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
        </div>

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* Group */}
        <select value={groupBy}
          onChange={e => setGroupBy(e.target.value)}
          className="px-2 py-1.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm focus:outline-none cursor-pointer"
          style={{ backgroundColor: '#292524', color: groupBy ? '#fb923c' : '#78716c', border: '1px solid #44403c' }}>
          {GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* View mode toggle */}
        <div className="flex items-center rounded-sm overflow-hidden" style={{ border: '1px solid #44403c' }}>
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

        {/* Gallery size selector */}
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

        {/* Saved views */}
        <SavedViewsDropdown views={savedViews} onLoad={loadView} onDelete={deleteSavedView} onSave={() => setShowSaveDialog(true)} />

        <div style={{ width: 1, height: 16, backgroundColor: '#292524' }} />

        {/* Search */}
        <div className="flex items-center flex-1 min-w-[120px] max-w-[240px] rounded-sm" style={{ border: '1px solid #44403c', backgroundColor: '#292524' }}>
          <Search className="w-3 h-3 ml-2 flex-shrink-0" style={{ color: '#57534e' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="flex-1 px-2 py-1.5 text-[10.5px] font-mono bg-transparent focus:outline-none"
            style={{ color: '#d6d3d1' }} />
          {search && (
            <button type="button" onClick={() => setSearch('')}
              className="p-1 mr-0.5 hover:bg-stone-700 rounded transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Right: count + add button */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10.5px] font-mono uppercase tracking-wider px-1" style={{ color: '#78716c' }}>
            {sorted.length}/{experiences.length}
          </span>

          <button type="button" onClick={() => setShowCreatePopup(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded transition-colors"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
            <Plus className="w-3.5 h-3.5" /> New experience
          </button>
        </div>
      </div>

      {/* ── Filter panel ── */}
      {showFilterPanel && (
        <ExpFilterPanel filters={filters} onAdd={addFilter} onUpdate={updateFilter} onRemove={removeFilter} onClose={() => setShowFilterPanel(false)} />
      )}

      {/* ── Save view dialog ── */}
      {showSaveDialog && (
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}>
          <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="View name..."
            className="px-2.5 py-1.5 text-[11.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 w-48"
            style={{ backgroundColor: '#292524', color: '#f4a261', border: '1px solid #44403c' }}
            onKeyDown={e => { if (e.key === 'Enter') saveCurrentView(); if (e.key === 'Escape') setShowSaveDialog(false) }}
            autoFocus />
          <button type="button" onClick={saveCurrentView}
            className="px-3 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded transition-colors"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>Save</button>
          <button type="button" onClick={() => setShowSaveDialog(false)}
            className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'table' ? (
          groups ? (
            groups.map(g => (
              <div key={g.key}>
                <div className="flex items-center gap-2 px-5 py-2.5 cursor-pointer hover:bg-stone-800/30 transition-colors"
                  style={{ borderBottom: '1px solid #44403c', borderLeft: `3px solid ${groupAccent(g.key)}` }}
                  onClick={() => toggleGroup(g.key)}>
                  {collapsedGroups.has(g.key)
                    ? <ChevronRight className="w-3.5 h-3.5" style={{ color: '#78716c' }} />
                    : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#78716c' }} />}
                  <span className="text-[12.5px] font-mono uppercase tracking-wider font-bold" style={{ color: groupAccent(g.key) }}>
                    {g.label}
                  </span>
                  <span className="text-[10.5px] font-mono" style={{ color: '#78716c' }}>
                    ({g.experiences.length})
                  </span>
                </div>
                {!collapsedGroups.has(g.key) && (
                  <ExperienceTable experiences={g.experiences} assetCountByExperience={assetCountByExperience}
                    taskCountByExperience={taskCountByExperience} ctx={ctx}
                    onOpenDetail={setDetailExpId} onRequestDelete={setConfirmDelete} />
                )}
              </div>
            ))
          ) : (
            <ExperienceTable experiences={sorted} assetCountByExperience={assetCountByExperience}
              taskCountByExperience={taskCountByExperience} ctx={ctx}
              onOpenDetail={setDetailExpId} onRequestDelete={setConfirmDelete} />
          )
        ) : (
          <ExperienceGallery experiences={groups ? groups.flatMap(g => g.experiences) : sorted} gallerySize={gallerySize}
            onOpenDetail={setDetailExpId} onRequestDelete={setConfirmDelete} />
        )}
      </div>

      {/* ── Experience detail popup ── */}
      {detailExpId && (
        <ExperienceDetailPopup
          experienceId={detailExpId}
          ctx={ctx}
          assetCountByExperience={assetCountByExperience}
          taskCountByExperience={taskCountByExperience}
          projectMembers={projectMembers}
          roleEntries={roleEntries}
          thumbRevision={thumbRevision}
          onThumbChanged={() => setThumbRevision(r => r + 1)}
          onClose={() => setDetailExpId(null)}
          onRequestDelete={setConfirmDelete}
        />
      )}

      {/* ── Create experience popup ── */}
      {showCreatePopup && (
        <CreateExperiencePopup ctx={ctx} expCount={experiences.length} onClose={() => setShowCreatePopup(false)} />
      )}

      {/* ── Delete confirmation ── */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete experience?"
          message={`This will permanently delete "${confirmDelete.name}".`}
          onConfirm={() => handleDeleteExperience(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}


// ─── Experience table ───
function ExperienceTable({ experiences, assetCountByExperience, taskCountByExperience, ctx, onOpenDetail, onRequestDelete }) {
  const [selected, setSelected] = useState(new Set())
  const allIds = useMemo(() => experiences.map(e => e.id), [experiences])
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id))
  const someSelected = selected.size > 0

  function toggleOne(id) { setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  function toggleAll() { allSelected ? setSelected(new Set()) : setSelected(new Set(allIds)) }
  function clearSelection() { setSelected(new Set()) }
  function bulkUpdate(patch) { for (const id of selected) ctx?.updateExperience?.(id, patch); clearSelection() }
  function bulkDelete() {
    if (!window.confirm(`Delete ${selected.size} experience${selected.size === 1 ? '' : 's'}?`)) return
    for (const id of selected) ctx?.deleteExperience?.(id)
    clearSelection()
  }

  if (experiences.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-[12.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
          No experiences yet
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
        <span className="flex-[2] text-[10.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#78716c' }}>Name</span>
        <span className="w-28 text-[10.5px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Status</span>
        <span className="w-16 text-[10.5px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Assets</span>
        <span className="w-16 text-[10.5px] font-mono uppercase tracking-wider font-bold text-center" style={{ color: '#78716c' }}>Tasks</span>
        <span className="flex-[2] text-[10.5px] font-mono uppercase tracking-wider font-bold" style={{ color: '#78716c' }}>Description</span>
        <span className="w-20" />

        {/* Bulk action bar */}
        {someSelected && (
          <div className="absolute top-0 z-20 flex items-center gap-3 h-full px-3 rounded-sm"
            style={{ left: 36, backgroundColor: '#292524', border: '1px solid #ea580c', width: 'fit-content' }}>
            <span className="text-[11.5px] font-mono font-bold flex-shrink-0" style={{ color: '#fb923c' }}>{selected.size} selected</span>
            <div style={{ width: 1, height: 18, backgroundColor: '#44403c' }} />
            <BulkSelect label="Status" options={EXPERIENCE_STATUSES} onPick={v => bulkUpdate({ status: v })} />
            <div style={{ width: 1, height: 18, backgroundColor: '#44403c' }} />
            <button type="button" onClick={bulkDelete} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-red-900/40 transition-colors" style={{ color: '#fca5a5' }}>
              <Trash2 className="w-3 h-3" /> <span className="text-[10.5px] font-mono uppercase">Delete</span>
            </button>
            <button type="button" onClick={clearSelection} className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#78716c' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Rows */}
      {experiences.map(ex => (
        <div key={ex.id}
          className="flex items-center gap-0 px-4 py-2 hover:bg-stone-800/40 transition-colors group"
          style={{ borderBottom: '1px solid #292524', borderLeft: `3px solid ${statusColor(ex.status)}` }}>

          {/* Checkbox */}
          <span className="w-8 flex items-center justify-center cursor-pointer" onClick={() => toggleOne(ex.id)}>
            {selected.has(ex.id)
              ? <CheckSquare className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
              : <Square className="w-3.5 h-3.5" style={{ color: '#57534e' }} />}
          </span>

          {/* Name — inline editable */}
          <span className="flex-[2] min-w-0">
            <InlineText
              value={ex.name || ''}
              placeholder="Untitled experience"
              onCommit={v => ctx?.updateExperience?.(ex.id, { name: v })}
            />
          </span>

          {/* Status — inline dropdown */}
          <span className="w-28 flex justify-center">
            <select
              value={ex.status || 'not_started'}
              onChange={e => ctx?.updateExperience?.(ex.id, { status: e.target.value })}
              className="px-1.5 py-0.5 text-[10.5px] font-mono uppercase tracking-wider rounded-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
              style={{
                color: statusColor(ex.status),
                backgroundColor: 'rgba(0,0,0,0.3)',
                border: `1px solid ${statusColor(ex.status)}30`,
              }}
            >
              {EXPERIENCE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
            </select>
          </span>

          {/* Assets count */}
          <span className="w-16 text-[11.5px] font-mono text-center" style={{ color: '#a8a29e' }}>
            {assetCountByExperience[ex.id] || 0}
          </span>

          {/* Tasks count */}
          <span className="w-16 text-[11.5px] font-mono text-center" style={{ color: '#a8a29e' }}>
            {taskCountByExperience[ex.id] || 0}
          </span>

          {/* Description — inline editable */}
          <span className="flex-[2] min-w-0">
            <InlineText
              value={ex.description || ''}
              placeholder="No description"
              size="sm"
              onCommit={v => ctx?.updateExperience?.(ex.id, { description: v })}
            />
          </span>

          {/* Actions */}
          <span className="w-20 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" onClick={() => onOpenDetail(ex.id)}
              className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#a8a29e' }} title="View details">
              <Eye className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => onRequestDelete({ id: ex.id, name: ex.name || 'Untitled' })}
              className="p-1 rounded hover:bg-stone-700 transition-colors" style={{ color: '#ef4444' }} title="Delete experience">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}


// ─── Experience gallery ───
function ExperienceGallery({ experiences, gallerySize, onOpenDetail, onRequestDelete }) {
  const sizeMap = { sm: 160, md: 220, lg: 300 }
  const cardW = sizeMap[gallerySize] || sizeMap.md

  if (experiences.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-[12.5px] font-mono uppercase tracking-wider" style={{ color: '#57534e' }}>
          No experiences yet
        </span>
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-wrap gap-3">
      {experiences.map(ex => (
        <div key={ex.id}
          onClick={() => onOpenDetail(ex.id)}
          className="rounded overflow-hidden hover:ring-2 hover:ring-orange-500/50 transition-all cursor-pointer group relative"
          style={{ width: cardW, backgroundColor: '#292524', border: '1px solid #44403c' }}>
          {/* Thumbnail placeholder */}
          <div className="flex items-center justify-center relative"
            style={{ height: cardW * 0.6, backgroundColor: '#1c1917', borderBottom: '1px solid #44403c' }}>
            <Sparkles className="w-8 h-8" style={{ color: '#44403c' }} />
            <button type="button"
              onClick={e => { e.stopPropagation(); onRequestDelete({ id: ex.id, name: ex.name || 'Untitled' }) }}
              className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-red-900/50"
              style={{ color: '#ef4444' }}>
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          {/* Info */}
          <div className="px-3 py-2.5 flex flex-col gap-1">
            <span className="text-[12.5px] font-mono truncate font-bold" style={{ color: '#e7e5e4' }}>
              {ex.name || 'Untitled experience'}
            </span>
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 text-[9.5px] font-mono uppercase tracking-wider rounded-sm"
                style={{ color: statusColor(ex.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(ex.status)}30` }}>
                {fmt(ex.status || 'not_started')}
              </span>
            </div>
            {ex.description && (
              <span className="text-[10.5px] font-mono truncate" style={{ color: '#78716c' }}>
                {ex.description}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}


// ─── Experience detail popup ───
function ExperienceDetailPopup({ experienceId, ctx, assetCountByExperience, taskCountByExperience, projectMembers, roleEntries, thumbRevision, onThumbChanged, onClose, onRequestDelete }) {
  const experience = (ctx?.experiences || []).find(e => e.id === experienceId)
  const project = ctx?.project

  const [descDraft, setDescDraft] = useState(experience?.description || '')
  const [notesDraft, setNotesDraft] = useState(experience?.notes || '')
  const [editingDesc, setEditingDesc] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [nestedTaskId, setNestedTaskId] = useState(null)
  const [nestedAssetId, setNestedAssetId] = useState(null)

  useEffect(() => { setDescDraft(experience?.description || '') }, [experience?.description])
  useEffect(() => { setNotesDraft(experience?.notes || '') }, [experience?.notes])

  if (!experience) return null

  const sc = statusColor(experience.status)
  const hasThumbnail = !!experience.thumbnail_image

  function handleUpdate(patch) { ctx?.updateExperience?.(experience.id, patch) }

  async function handleSetThumbnail() {
    if (!window.electronAPI?.rabbit?.pickImage) return
    const imagePath = await window.electronAPI.rabbit.pickImage()
    if (!imagePath) return
    handleUpdate({ thumbnail_image: imagePath })
    try {
      await window.electronAPI.rabbit.generateEntityThumbnail({ entityType: 'experience', entityId: experience.id, sourcePath: imagePath })
    } catch (e) { console.error('experience thumbnail gen failed:', e) }
    onThumbChanged?.()
  }

  async function handleClearThumbnail() {
    handleUpdate({ thumbnail_image: null })
    try { await window.electronAPI.rabbit.clearEntityThumbnail({ entityType: 'experience', entityId: experience.id }) } catch {}
    onThumbChanged?.()
  }

  async function handleCreateTask(draft) {
    try {
      await ctx?.addTask?.({ ...draft, experience_id: experience.id })
      setShowCreateTask(false)
    } catch (err) { console.error('Failed to create task:', err) }
  }

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      <div className="fixed z-50 inset-0 flex items-center justify-center gap-3 pointer-events-none">

        {/* ── LEFT SIDE POPUP (task creation / nested detail) ── */}
        {showCreateTask && (
          <div className="pointer-events-auto flex-shrink-0 max-h-[85vh]">
            <NewTaskSidePopup
              entityType="experience"
              entityId={experience.id}
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
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `3px solid ${sc}` }}>
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4" style={{ color: '#fb923c' }} />
            <span className="text-[14px] font-mono font-bold" style={{ color: '#fb923c' }}>
              {experience.name || 'Untitled experience'}
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
            entityType="experience"
            entityId={experience.id}
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
                    src={`/api/rabbit/projects/${project?.id}/experiences/${experience.id}/thumbnail?r=${thumbRevision}`}
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
                  <Sparkles className="w-5 h-5 group-hover/thumb:opacity-0 transition-opacity absolute" style={{ color: '#292524' }} />
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <FieldLabel>Experience name</FieldLabel>
              <PopupInlineText
                value={experience.name || ''}
                placeholder="Untitled experience"
                onCommit={v => handleUpdate({ name: v })}
              />
            </div>
          </div>

          {/* Properties */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-5">
            <div>
              <FieldLabel>Status</FieldLabel>
              <select value={experience.status || 'not_started'} onChange={e => handleUpdate({ status: e.target.value })}
                className="w-full px-2.5 py-1.5 text-[11.5px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: sc, border: '1px solid #44403c' }}>
                {EXPERIENCE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Linked counts</FieldLabel>
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] font-mono uppercase" style={{ color: '#78716c' }}>
                  {assetCountByExperience[experienceId] || 0} assets / {taskCountByExperience[experienceId] || 0} tasks
                </span>
              </div>
            </div>
            <div>
              <label className="block text-[10.5px] font-mono uppercase tracking-wider mb-1" style={{ color: '#78716c' }}>Start Date</label>
              <input
                type="date"
                value={experience.start_date || ''}
                onChange={(e) => handleUpdate({ start_date: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{
                  backgroundColor: '#1c1917', color: '#d6d3d1',
                  border: '1px solid #44403c', colorScheme: 'dark',
                }}
              />
            </div>
            <div>
              <label className="block text-[10.5px] font-mono uppercase tracking-wider mb-1" style={{ color: '#78716c' }}>Due Date</label>
              <input
                type="date"
                value={experience.end_date || ''}
                onChange={(e) => handleUpdate({ end_date: e.target.value || null })}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                style={{
                  backgroundColor: '#1c1917', color: '#d6d3d1',
                  border: '1px solid #44403c', colorScheme: 'dark',
                }}
              />
            </div>
          </div>

          {/* Description */}
          <div className="mb-4">
            <FieldLabel>Description</FieldLabel>
            {editingDesc ? (
              <div>
                <textarea value={descDraft} onChange={e => setDescDraft(e.target.value)}
                  className="w-full px-3 py-2 text-[12.5px] font-mono rounded resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', minHeight: 80 }}
                  autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => { handleUpdate({ description: descDraft }); setEditingDesc(false) }}
                    className="text-[10.5px] font-mono uppercase text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button type="button" onClick={() => { setDescDraft(experience.description || ''); setEditingDesc(false) }}
                    className="text-[10.5px] font-mono uppercase text-stone-500 hover:text-stone-400">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingDesc(true)}
                className="px-3 py-2 text-[12.5px] font-mono rounded cursor-pointer hover:bg-stone-800 transition-colors"
                style={{ backgroundColor: '#1c1917', color: experience.description ? '#a8a29e' : '#57534e', border: '1px solid #44403c', minHeight: 40 }}>
                {experience.description || 'Click to add a description...'}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="mb-4">
            <FieldLabel>Notes</FieldLabel>
            {editingNotes ? (
              <div>
                <textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)}
                  className="w-full px-3 py-2 text-[12.5px] font-mono rounded resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c', minHeight: 60 }}
                  autoFocus />
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => { handleUpdate({ notes: notesDraft }); setEditingNotes(false) }}
                    className="text-[10.5px] font-mono uppercase text-orange-400 hover:text-orange-300 flex items-center gap-1">
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button type="button" onClick={() => { setNotesDraft(experience.notes || ''); setEditingNotes(false) }}
                    className="text-[10.5px] font-mono uppercase text-stone-500 hover:text-stone-400">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => setEditingNotes(true)}
                className="px-3 py-2 text-[12.5px] font-mono rounded cursor-pointer hover:bg-stone-800 transition-colors"
                style={{ backgroundColor: '#1c1917', color: experience.notes ? '#a8a29e' : '#57534e', border: '1px solid #44403c', minHeight: 40 }}>
                {experience.notes || 'Click to add notes...'}
              </div>
            )}
          </div>
          </div>{/* close RIGHT COLUMN */}
        </div>{/* close two-column flex */}

        {/* Footer */}
        <div className="px-5 py-3 flex items-center justify-between flex-shrink-0" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button"
            onClick={() => { onClose(); onRequestDelete({ id: experience.id, name: experience.name || 'Untitled' }) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-red-900/30"
            style={{ color: '#ef4444', border: '1px solid #ef444440' }}>
            <Trash2 className="w-3.5 h-3.5" /> Delete experience
          </button>
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            Close
          </button>
        </div>
        </div>{/* close MAIN POPUP */}
      </div>{/* close flex container */}
    </>
  )
}


// ─── Shared sub-components ───

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
            <span className="text-[13.5px] font-mono font-bold" style={{ color: '#ef4444' }}>{title}</span>
          </div>
        </div>
        <div className="px-5 py-4">
          <p className="text-[12.5px] font-mono leading-relaxed" style={{ color: '#a8a29e' }}>{message}</p>
        </div>
        <div className="px-5 py-3 flex items-center justify-end gap-3" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button" onClick={onCancel}
            className="px-4 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>Cancel</button>
          <button type="button" onClick={onConfirm}
            className="px-4 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-red-800"
            style={{ color: '#fff7ed', backgroundColor: '#ef4444', border: '1px solid #dc2626' }}>Delete</button>
        </div>
      </div>
    </>
  )
}

// ─── Create experience popup ───
function CreateExperiencePopup({ ctx, expCount, onClose }) {
  const [name, setName] = useState(`Experience ${expCount + 1}`)
  const [status, setStatus] = useState('not_started')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState([])
  const fileInputRef = useRef(null)

  async function handleConfirm() {
    try {
      await ctx?.addExperience({ name: name.trim() || `Experience ${expCount + 1}`, status, description, files })
    } catch (err) { console.error('Failed to create experience:', err) }
    onClose()
  }

  function handleFileSelect(e) {
    const newFiles = Array.from(e.target.files || []).map(f => ({ name: f.name, path: f.path || f.name }))
    setFiles(prev => [...prev, ...newFiles])
    e.target.value = ''
  }

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      <div className="fixed z-50 top-1/2 left-1/2 w-full max-w-md rounded overflow-hidden flex flex-col"
        style={{ backgroundColor: '#292524', border: '2px solid #f97316', maxHeight: '80vh', transform: 'translate(-50%, -50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '3px solid #fb923c' }}>
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4" style={{ color: '#fb923c' }} />
            <span className="text-[14px] font-mono font-bold" style={{ color: '#fb923c' }}>New Experience</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-stone-700 rounded transition-colors" style={{ color: '#a8a29e' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4 flex flex-col gap-4">
          <div>
            <FieldLabel>Name <span style={{ color: '#ef4444' }}>*</span></FieldLabel>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-2.5 py-1.5 text-[12.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} autoFocus />
          </div>
          <div>
            <FieldLabel>Status</FieldLabel>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="w-full px-2.5 py-1.5 text-[12.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: statusColor(status), border: '1px solid #44403c' }}>
              {EXPERIENCE_STATUSES.map(s => <option key={s} value={s} style={{ color: statusColor(s) }}>{fmt(s)}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              className="w-full px-2.5 py-1.5 text-[12.5px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
              style={{ backgroundColor: '#1c1917', color: '#d6d3d1', border: '1px solid #44403c' }}
              placeholder="Description..." />
          </div>
          <div>
            <FieldLabel>Files</FieldLabel>
            <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
              style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
              <Upload className="w-3.5 h-3.5" /> Add files
            </button>
            {files.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 rounded" style={{ backgroundColor: '#1c1917' }}>
                    <span className="text-[10.5px] font-mono truncate flex-1" style={{ color: '#a8a29e' }}>{f.name}</span>
                    <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                      className="p-0.5 hover:bg-stone-700 rounded transition-colors" style={{ color: '#fca5a5' }}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid #44403c' }}>
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded transition-colors hover:bg-stone-700"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>Cancel</button>
          <button type="button" onClick={handleConfirm} disabled={!name.trim()}
            className="px-4 py-1.5 text-[11.5px] font-mono uppercase tracking-wider rounded transition-colors disabled:opacity-40"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>Confirm & Create</button>
        </div>
      </div>
    </>
  )
}


// ─── Filter panel ───
function ExpFilterPanel({ filters, onAdd, onUpdate, onRemove, onClose }) {
  function getOptions(f) {
    const def = EXP_FILTER_FIELDS.find(ff => ff.value === f.field)
    if (!def) return []
    return (def.options || []).map(o => ({ value: o, label: fmt(o) }))
  }
  function getType(f) {
    return EXP_FILTER_FIELDS.find(ff => ff.value === f.field)?.type || 'text'
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
              {EXP_FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
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


// ─── Saved views dropdown ───
function SavedViewsDropdown({ views, onLoad, onDelete, onSave }) {
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


// ─── Bulk select dropdown ───
function BulkSelect({ label, options, labels, onPick, allowEmpty }) {
  return (
    <select defaultValue="" onChange={e => { if (e.target.value !== '') { onPick(e.target.value); e.target.value = '' } }}
      className="px-2 py-1 text-[10.5px] font-mono uppercase rounded focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer"
      style={{ backgroundColor: '#1c1917', border: '1px solid #44403c', color: '#a8a29e' }}>
      <option value="" disabled>{label}</option>
      {allowEmpty && <option value="">None</option>}
      {options.map(o => <option key={o} value={o}>{(labels?.[o] || o).replace(/_/g, ' ')}</option>)}
    </select>
  )
}


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
  const textSize = size === 'sm' ? 'text-[11.5px]' : 'text-[12.5px]'
  const textColor = size === 'sm' ? '#a8a29e' : '#e7e5e4'
  if (editing) {
    return (
      <input ref={inputRef} type="text" value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        className={`w-full ${textSize} font-mono px-1.5 py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-orange-500`}
        style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
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
        className="w-full text-[13.5px] font-mono px-2.5 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
    )
  }
  return (
    <div onClick={() => setEditing(true)}
      className="text-[13.5px] font-mono px-2.5 py-1.5 rounded cursor-pointer hover:bg-stone-800 transition-colors"
      style={{ backgroundColor: '#1c1917', color: value ? '#d6d3d1' : '#57534e', border: '1px solid #44403c' }}>
      {value || placeholder}
    </div>
  )
}

function FieldLabel({ children }) {
  return (
    <label className="block text-[10.5px] font-mono uppercase tracking-wider font-bold mb-1.5" style={{ color: '#78716c' }}>
      {children}
    </label>
  )
}
