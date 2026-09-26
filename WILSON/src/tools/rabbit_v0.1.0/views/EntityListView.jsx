// ============================================================
// RABBIT — EntityListView (Levels and Experiences)
// ============================================================
//
// The one list view LevelsView and ExperiencesView render: table and
// gallery modes, inline editing, detail popup, create/delete workflows,
// filters, saved views and bulk select. A flat list, no nested children:
// each row has a name, status, description, and linked assets / tasks
// counts.
//
// B4c folded the two views into this one (review R4-11). They were a
// verbatim twin that differed only in the entity's words, icon, storage
// key, ctx collection and methods; every such difference is now a field
// of the `entity` config each thin view file defines, and the DOM each
// view renders is unchanged.
//
// UI overhaul B4c, surface 6 (2026-09-25): the page is on the shared kit
// (src/ui) and lane B4's sheet, rabbitFiles.css (`rb-ent-`), restyled once
// for both views as the Assets page's twin (ProjectAssetsView): the kit
// Toolbar, the kit Tabs over a named tabpanel, the kit Table at its 36px
// row, a status the kit's StatusDot / StatusBadge / CellSelect on the one
// STATUS map (R4-05), the kit's Card and EmptyState, and every question —
// the row's delete, the bulk delete, New level — the kit Dialog, portalled
// into <body>. Every state is a `data-*` attribute or a real :hover resolved
// in the sheet. Step C put the detail popup on the kit as well: the kit
// Dialog, portalled, the Assets page's AssetDetailPopup re-made, with the
// task form inside it as its first column (EntityDetailPopup).
//
// ── The `entity` config ──
//   type           entityType for RelationsPanel, NewTaskSidePopup and the
//                  thumbnail IPC ('level' | 'experience')
//   noun, nouns, Noun
//                  the words: "New level", "No levels yet", "Level name",
//                  the default name "Level 3"
//   Icon           the lucide glyph (Gamepad2 | Sparkles)
//   collection     the ctx list, and the thumbnail route's segment
//                  ('levels': ctx.levels, /projects/:id/levels/:id/thumbnail)
//   linkKey        an asset's / task's link to a row ('level_id'): the two
//                  counts, and the key ctx.addTask links a new task by
//   addMethod, updateMethod, deleteMethod
//                  the ctx writers ('addLevel', 'updateLevel', 'deleteLevel')
//   savedViewsKey  the saved views' localStorage key
// Words and wiring only: R4-11's one drift — the detail popup's date fields'
// focus ring, ring-2 in Levels and ring-1 in Experiences — was a config field
// until step C, and both fields take the kit's one focus treatment now.
//
// ── UX Laws applied ──
// • Aesthetic-Usability Effect — polished dark stone surface
// • Law of Common Region — rows as clearly bounded groups
// • Law of Proximity — tight internal spacing, generous external gaps
// • Von Restorff Effect — a status dot, the one colour a row carries

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, Search, X, Filter,
  ChevronDown, ChevronRight, Trash2, Eye,
  ArrowUpDown, Save,
  BookmarkPlus, CheckSquare, Square, MinusSquare, Upload,
  ImagePlus, ImageOff,
} from 'lucide-react'
import {
  Toolbar, Button, IconButton, Tabs, Table, Th, Td, Row, Dialog, Field,
  Card, HoverActions, EmptyState, StatusDot, StatusBadge, CellSelect, statusMeta,
} from '../../../ui'
import './rabbitFiles.css'
import { useRabbit } from '../state/RabbitProvider'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import { useRateCard } from '../../../components/RateCard/useRateCard'
import TaskDetailPopup from '../components/TaskDetailPopup'
import RelationsPanel, { NewTaskSidePopup } from '../components/RelationsPanel'

// ── Status config ──
const STATUSES = [
  'not_started', 'in_progress', 'pending_review', 'needs_revisions',
  'approved', 'final', 'blocked', 'on_hold', 'omitted',
]

// ── Status words and options ──
// A status's words come from the kit's one status source (src/ui/StatusDot),
// so these pages, Assets, Tasks and the Dashboard say the same thing, in
// sentence case (Q2); `fmt()` lower-cased every one of them. Its colour is
// the kit's too: a StatusDot beside the words, never the words' own ink
// (R4-05).
const STATUS_LABELS = Object.fromEntries(STATUSES.map(s => [s, statusMeta(s).label]))
const STATUS_OPTIONS = STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s] }))

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
const FILTER_FIELDS = [
  { value: 'status', label: 'Status', type: 'select', options: STATUSES },
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

// ── Gallery card sizes ──
// The three card widths — 160, 220 and 300px, the picture 0.6 of each, as
// they were — live in rabbitFiles.css, keyed on the gallery's `data-card`.
// R4-35's one preview geometry is recorded, not applied (C1).
const CARD_SIZES = ['sm', 'md', 'lg']

// The body the Table / Gallery tabs switch (the kit's Tabs wants its panel).
const BODY_ID = 'rb-ent-body'

// ── The detail popup's width ──
// Its old max-w-4xl, 896px: a real geometry, which the kit Dialog takes as a
// number. While the task form is open it is the Dialog's first column, and
// the Dialog is wider by the form's 400px and the hairline after it
// (rabbitFiles.css, `.rb-rel-task` and `.rb-ent-detail-task`).
const DETAIL_WIDTH = 896
const DETAIL_TASK_WIDTH = 400 + 1

function fmt(s) { return (s || '').replace(/_/g, ' ') }


// ─────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────
export default function EntityListView({ entity }) {
  const ctx = useRabbit()
  const project = ctx?.project
  const items = ctx?.[entity.collection] || []
  const assets = ctx?.assets || []
  const tasks = ctx?.tasks || []

  const tm = useTeamMembers()
  const rc = useRateCard()
  const teamAssignments = ctx?.teamAssignments || []
  const memberById = useMemo(() => { const m = {}; for (const mb of tm.members) m[mb.id] = mb; return m }, [tm.members])
  const projectMembers = useMemo(() => teamAssignments.map(a => memberById[a.member_id]).filter(Boolean), [teamAssignments, memberById])
  const roleEntries = useMemo(() => { const seen = new Set(); return (rc.entries || []).filter(e => { if (!e.role_slug || seen.has(e.role_slug)) return false; seen.add(e.role_slug); return true }) }, [rc.entries])
  const [thumbRevision, setThumbRevision] = useState(0)

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
    try { return JSON.parse(localStorage.getItem(entity.savedViewsKey) || '[]') } catch { return [] }
  })
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')

  // ── Popup state ──
  const [detailId, setDetailId] = useState(null)
  const [confirmDelete, setConfirmDelete]   = useState(null) // { id, name }
  const [showCreatePopup, setShowCreatePopup] = useState(false)

  function toggleGroup(key) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── Lookups ──
  const assetCountById = useMemo(() => {
    const map = {}
    for (const a of assets) {
      const id = a[entity.linkKey]
      if (!id) continue
      map[id] = (map[id] || 0) + 1
    }
    return map
  }, [assets, entity.linkKey])

  const taskCountById = useMemo(() => {
    const map = {}
    for (const t of tasks) {
      const id = t[entity.linkKey]
      if (!id) continue
      map[id] = (map[id] || 0) + 1
    }
    return map
  }, [tasks, entity.linkKey])

  // ── CRUD handlers ──
  const handleDelete = useCallback(async (id) => {
    try {
      await ctx?.[entity.deleteMethod]?.(id)
    } catch (err) { console.error(`Failed to delete ${entity.noun}:`, err) }
    setConfirmDelete(null)
    if (detailId === id) setDetailId(null)
  }, [ctx, detailId, entity])

  // ── Saved views ──
  function saveCurrentView() {
    if (!saveName.trim()) return
    const view = { id: Date.now().toString(), name: saveName.trim(), filters, sortField, sortDir, groupBy, viewMode, gallerySize }
    const next = [...savedViews, view]
    setSavedViews(next)
    localStorage.setItem(entity.savedViewsKey, JSON.stringify(next))
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
    localStorage.setItem(entity.savedViewsKey, JSON.stringify(next))
  }

  // ── Filter CRUD ──
  function addFilter() { setFilters(prev => [...prev, { field: 'status', op: 'is', value: '' }]) }
  function updateFilter(idx, patch) { setFilters(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f)) }
  function removeFilter(idx) { setFilters(prev => prev.filter((_, i) => i !== idx)) }

  // ── Filtering (search + complex filters) ──
  const filtered = useMemo(() => {
    let result = items
    const s = search.trim().toLowerCase()
    if (s) result = result.filter(item => (item.name || '').toLowerCase().includes(s))
    for (const f of filters) {
      if (!f.field) continue
      result = result.filter(item => {
        const val = item[f.field]
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
  }, [items, search, filters])

  // ── Sorting ──
  const sorted = useMemo(() => {
    if (!sortField) return [...filtered].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const dir = sortDir === 'desc' ? -1 : 1
    return [...filtered].sort((a, b) => {
      let va = a[sortField] ?? ''
      let vb = b[sortField] ?? ''
      if (sortField === 'status') {
        va = STATUSES.indexOf(va); vb = STATUSES.indexOf(vb)
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
    for (const item of sorted) {
      const key = groupBy === 'status' ? (item.status || 'not_started') : '__all__'
      if (!map[key]) map[key] = []
      map[key].push(item)
    }
    let sortedKeys
    if (groupBy === 'status') sortedKeys = STATUSES.filter(s => map[s])
    else sortedKeys = Object.keys(map)
    return sortedKeys.map(key => ({
      key,
      // A status group says its status in the kit's words (Q2).
      label: groupBy === 'status' ? (STATUS_LABELS[key] || fmt(key)) : fmt(key),
      items: map[key] || [],
    }))
  }, [sorted, groupBy])
  // (The group's accent colour, computed here per status, is gone: a status
  // group carries the kit's StatusDot — R4-33, as the Assets page's.)

  // ── Render ──
  if (!project) {
    return (
      <div className="rb-ent-view h-full flex items-center justify-center">
        <span className="rb-ent-unloaded text-label uppercase">No project loaded</span>
      </div>
    )
  }

  return (
    <div className="rb-ent-view h-full flex flex-col">
      {/* ── Toolbar: the kit's, composed as the Assets toolbar is — every
          control the 28px sm height on one baseline (R4-16), the same
          controls in the same order (R4-37's regrouping is recorded, not
          made: C1). It wraps rather than clipping at Electron's 1024px. ── */}
      <Toolbar
        wrap
        className="rb-ent-toolbar"
        right={(
          <>
            <span className="rb-ent-count">
              {sorted.length}/{items.length}
            </span>

            {/* The one filled button: the kit primary, white on the signal
                fill (#c2410c, 5.17:1) — the kit's own. */}
            <Button size="sm" variant="primary" Icon={Plus} onClick={() => setShowCreatePopup(true)}>
              {`New ${entity.noun}`}
            </Button>
          </>
        )}
      >
        {/* Filter */}
        <Button
          size="sm"
          Icon={Filter}
          className="rb-ent-tool"
          data-active={filters.length > 0 ? 'true' : 'false'}
          aria-expanded={showFilterPanel}
          onClick={() => setShowFilterPanel(!showFilterPanel)}
        >
          Filter{filters.length > 0 ? ` (${filters.length})` : ''}
        </Button>

        {/* Sort: the field, then its direction. The direction button is
            always there, as it always was, and says what a click does. */}
        <span className="rb-ent-sort">
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            aria-label="Sort"
            className="ui-input rb-ent-tool"
            data-size="sm"
            data-active={sortField ? 'true' : 'false'}>
            <option value="">Sort…</option>
            {SORTABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <IconButton
            size="sm"
            Icon={ArrowUpDown}
            title={sortDir === 'asc' ? 'Sorted ascending — reverse' : 'Sorted descending — reverse'}
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          />
        </span>

        <span className="rb-ent-divider" aria-hidden="true" />

        {/* Group */}
        <select value={groupBy}
          onChange={e => setGroupBy(e.target.value)}
          aria-label="Group"
          className="ui-input rb-ent-tool"
          data-size="sm"
          data-active={groupBy ? 'true' : 'false'}>
          {GROUPABLE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        <span className="rb-ent-divider" aria-hidden="true" />

        {/* Table / Gallery — the kit's Tabs: one underline, no orange fill
            under small text (C6; R4-07, the same switch the Assets page
            and FileManager draw). */}
        <Tabs
          label="View"
          panelId={BODY_ID}
          items={[{ id: 'table', label: 'Table' }, { id: 'gallery', label: 'Gallery' }]}
          value={viewMode}
          onChange={setViewMode}
        />

        {/* Card size (gallery mode): three kit ghost buttons, their square
            growing with the size as before; the chosen one carries the
            signal edge, the one active treatment. */}
        {viewMode === 'gallery' && (
          <span className="rb-ent-sizes">
            {CARD_SIZES.map(key => (
              <Button key={key} size="sm" variant="ghost"
                className="rb-ent-size"
                title={`${key} cards`}
                aria-pressed={gallerySize === key}
                data-active={gallerySize === key ? 'true' : 'false'}
                onClick={() => setGallerySize(key)}>
                <Square aria-hidden="true" className="rb-ent-size-glyph" data-card={key} />
              </Button>
            ))}
          </span>
        )}

        {/* Saved views */}
        <SavedViewsDropdown views={savedViews} onLoad={loadView} onDelete={deleteSavedView} onSave={() => setShowSaveDialog(true)} />

        <span className="rb-ent-divider" aria-hidden="true" />

        {/* Search */}
        <span className="rb-ent-search">
          <Search className="rb-ent-search-icon" aria-hidden="true" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            aria-label={`Search ${entity.nouns}`}
            className="ui-input rb-ent-search-input"
            data-size="sm" />
          {search && (
            <IconButton size="sm" Icon={X} title="Clear search" className="rb-ent-search-clear" onClick={() => setSearch('')} />
          )}
        </span>
      </Toolbar>

      {/* ── Filter panel ── */}
      {showFilterPanel && (
        <EntityFilterPanel filters={filters} onAdd={addFilter} onUpdate={updateFilter} onRemove={removeFilter} onClose={() => setShowFilterPanel(false)} />
      )}

      {/* ── Save current view: the inline strip it always was on these pages
          (R4-46 names it the better answer than Assets' modal), on the
          Toolbar spec — 44px, the gutter, a hairline under it, the field and
          its two buttons at the small size. Enter saves and Escape closes,
          as they did. ── */}
      {showSaveDialog && (
        <Toolbar>
          <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="View name..."
            aria-label="View name"
            className="ui-input rb-ent-save-input"
            data-size="sm"
            onKeyDown={e => { if (e.key === 'Enter') saveCurrentView(); if (e.key === 'Escape') setShowSaveDialog(false) }}
            autoFocus />
          <Button size="sm" variant="primary" onClick={saveCurrentView}>Save</Button>
          <IconButton size="sm" Icon={X} title="Cancel" onClick={() => setShowSaveDialog(false)} />
        </Toolbar>
      )}

      {/* ── Body: the one region the view Tabs switch ── */}
      <div className="rb-ent-body" id={BODY_ID} role="tabpanel" aria-label={viewMode === 'table' ? 'Table' : 'Gallery'}>
        {viewMode === 'table' ? (
          groups ? (
            // Grouped: each group's band, then its own table — its own head
            // and its own selection, as it always was.
            groups.map(g => (
              <div key={g.key} className="rb-ent-group">
                <div className="rb-ent-group-head">
                  <EntityGroupToggle group={g} groupBy={groupBy}
                    collapsed={collapsedGroups.has(g.key)} onToggle={() => toggleGroup(g.key)} />
                </div>
                {!collapsedGroups.has(g.key) && (
                  <EntityTable entity={entity} items={g.items} assetCountById={assetCountById} taskCountById={taskCountById}
                    ctx={ctx} onOpenDetail={setDetailId} onRequestDelete={setConfirmDelete} />
                )}
              </div>
            ))
          ) : (
            <EntityTable entity={entity} items={sorted} assetCountById={assetCountById} taskCountById={taskCountById}
              ctx={ctx} onOpenDetail={setDetailId} onRequestDelete={setConfirmDelete} />
          )
        ) : (
          <EntityGallery entity={entity} items={groups ? groups.flatMap(g => g.items) : sorted} gallerySize={gallerySize}
            onOpenDetail={setDetailId} onRequestDelete={setConfirmDelete} />
        )}
      </div>

      {/* ── Detail popup ── */}
      {detailId && (
        <EntityDetailPopup
          entity={entity}
          itemId={detailId}
          ctx={ctx}
          assetCountById={assetCountById}
          taskCountById={taskCountById}
          projectMembers={projectMembers}
          roleEntries={roleEntries}
          thumbRevision={thumbRevision}
          onThumbChanged={() => setThumbRevision(r => r + 1)}
          onClose={() => setDetailId(null)}
          onRequestDelete={setConfirmDelete}
        />
      )}

      {/* ── Create popup ── */}
      {showCreatePopup && (
        <CreateEntityPopup entity={entity} ctx={ctx} count={items.length} onClose={() => setShowCreatePopup(false)} />
      )}

      {/* ── Delete confirmation ── */}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${entity.noun}?`}
          message={`This will permanently delete "${confirmDelete.name}".`}
          onConfirm={() => handleDelete(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}


// ─── Table ───
// The kit's Table: a real <table> with a fixed layout and 36px rows, so the
// header and the cells share one grid (R4-01, R4-42). Its columns are the
// ones it always had, in the same order: the checkbox, Name (the row's
// anchor), Status, the two counts (numeric cells, R4-17), Description and
// the actions. The fixed widths are rabbitFiles.css's custom properties,
// read by the header cells; Name and Description share what is left, as
// their two flex-[2] columns did.
function EntityTable({ entity, items, assetCountById, taskCountById, ctx, onOpenDetail, onRequestDelete }) {
  const [selected, setSelected] = useState(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const allIds = useMemo(() => items.map(item => item.id), [items])
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id))
  const someSelected = selected.size > 0

  function toggleOne(id) { setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  function toggleAll() { allSelected ? setSelected(new Set()) : setSelected(new Set(allIds)) }
  function clearSelection() { setSelected(new Set()) }
  function bulkUpdate(patch) { for (const id of selected) ctx?.[entity.updateMethod]?.(id, patch); clearSelection() }
  // W9: the bulk question is the kit's Dialog, not window.confirm — the same
  // words, Cancel leaves every row where it was, and Delete does exactly
  // what OK did.
  function bulkDelete() { setConfirmBulkDelete(true) }
  function confirmedBulkDelete() {
    setConfirmBulkDelete(false)
    for (const id of selected) ctx?.[entity.deleteMethod]?.(id)
    clearSelection()
  }

  if (items.length === 0) {
    // The kit's empty state (R4-13), in sentence case.
    return <EmptyState Icon={entity.Icon} title={`No ${entity.nouns} yet`} />
  }

  return (
    <div className="rb-ent-table-wrap">
      {/* ── Bulk-action bar: over the head, right of the checkbox column (the
          controls appear where the selection was made), as the Assets
          page's. ── */}
      {someSelected && (
        <div className="rb-ent-bulk">
          <span className="rb-ent-bulk-count">{selected.size} selected</span>
          <span className="rb-ent-divider" aria-hidden="true" />
          <BulkSelect label="Status" options={STATUSES} labels={STATUS_LABELS} onPick={v => bulkUpdate({ status: v })} />
          <span className="rb-ent-divider" aria-hidden="true" />
          <Button size="sm" variant="danger" Icon={Trash2} onClick={bulkDelete}>
            Delete
          </Button>
          <IconButton size="sm" Icon={X} title="Clear the selection" onClick={clearSelection} />
        </div>
      )}

      <Table
        className="rb-ent-table"
        head={(
          <Row>
            {/* Checkbox column */}
            <Th width="var(--rb-ent-check)" className="rb-ent-check-cell">
              <button type="button" onClick={toggleAll}
                className="rb-ent-check"
                data-checked={allSelected ? 'all' : someSelected ? 'some' : 'none'}
                aria-label={allSelected ? 'Clear the selection' : `Select every ${entity.noun}`}
                title={allSelected ? 'Clear the selection' : `Select every ${entity.noun}`}>
                {allSelected
                  ? <CheckSquare aria-hidden="true" />
                  : someSelected
                    ? <MinusSquare aria-hidden="true" />
                    : <Square aria-hidden="true" />}
              </button>
            </Th>
            <Th>Name</Th>
            <Th width="var(--rb-ent-status)">Status</Th>
            <Th width="var(--rb-ent-assets)" numeric>Assets</Th>
            <Th width="var(--rb-ent-tasks)" numeric>Tasks</Th>
            <Th>Description</Th>
            <Th width="var(--rb-ent-acts)"><span className="sr-only">Actions</span></Th>
          </Row>
        )}
      >
        {items.map(item => (
          <EntityRow
            key={item.id}
            entity={entity}
            item={item}
            assetCount={assetCountById[item.id] || 0}
            taskCount={taskCountById[item.id] || 0}
            onUpdate={patch => ctx?.[entity.updateMethod]?.(item.id, patch)}
            onOpenDetail={() => onOpenDetail(item.id)}
            onRequestDelete={() => onRequestDelete({ id: item.id, name: item.name || 'Untitled' })}
            isSelected={selected.has(item.id)}
            onToggleSelect={() => toggleOne(item.id)}
          />
        ))}
      </Table>

      {/* W9: the bulk question on the kit Dialog, 🚨 PORTALLED into <body> as
          FileManager's delete question is (the kit Dialog does not portal,
          B4-KR-2). React events still bubble through this tree. */}
      {confirmBulkDelete && createPortal(
        <Dialog
          width="confirm"
          title={`Delete ${entity.nouns}`}
          onClose={() => setConfirmBulkDelete(false)}
          footer={(
            <>
              <Button autoFocus onClick={() => setConfirmBulkDelete(false)}>Cancel</Button>
              <Button variant="danger" onClick={confirmedBulkDelete}>Delete</Button>
            </>
          )}
        >
          <p className="rb-ent-confirm">
            {`Delete ${selected.size} ${entity.noun}${selected.size === 1 ? '' : 's'}?`}
          </p>
        </Dialog>,
        document.body,
      )}
    </div>
  )
}

// ── One row: the kit's Row, the one hairline row language (R4-22). The 3px
// status-colour spine on its left edge is gone with the colours (R4-05):
// the status is the kit's StatusDot beside the kit's CellSelect, its words
// in the one ink. A ticked row is the Row's own selection.
function EntityRow({ entity, item, assetCount, taskCount, onUpdate, onOpenDetail, onRequestDelete, isSelected, onToggleSelect }) {
  // What the row's own controls are named for.
  const name = item.name || `Untitled ${entity.noun}`
  const status = item.status || 'not_started'
  return (
    <Row className="rb-ent-row" selected={isSelected} data-ticked={isSelected ? 'true' : 'false'}>
      {/* Checkbox: shown on hover, on focus and while ticked, as the Assets
          page's (R4-34); the column keeps its width at rest. */}
      <Td className="rb-ent-check-cell">
        <button type="button" onClick={onToggleSelect}
          className="rb-ent-check"
          data-checked={isSelected ? 'all' : 'none'}
          aria-pressed={isSelected}
          aria-label={`Select ${name}`}
          title={`Select ${name}`}>
          {isSelected
            ? <CheckSquare aria-hidden="true" />
            : <Square aria-hidden="true" />}
        </button>
      </Td>

      {/* Name — inline editable, the row's anchor (R4-03) */}
      <Td className="rb-ent-ctl-cell">
        <InlineText
          value={item.name || ''}
          placeholder={`Untitled ${entity.noun}`}
          label="Name"
          onCommit={v => onUpdate({ name: v })}
        />
      </Td>

      {/* Status — the kit's StatusDot beside the kit's CellSelect (R4-05) */}
      <Td className="rb-ent-ctl-cell">
        <span className="rb-ent-status">
          <StatusDot status={status} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
          <CellSelect
            className="rb-ent-status-select"
            value={status}
            onChange={v => onUpdate({ status: v })}
            options={STATUS_OPTIONS}
            aria-label={`Status for ${name}`}
          />
        </span>
      </Td>

      {/* The two counts: right-aligned, tabular, in the mono (R4-17) */}
      <Td numeric className="rb-ent-num">{assetCount}</Td>
      <Td numeric className="rb-ent-num">{taskCount}</Td>

      {/* Description — inline editable, in the second ink */}
      <Td className="rb-ent-ctl-cell">
        <InlineText
          value={item.description || ''}
          placeholder="No description"
          label="Description"
          quiet
          onCommit={v => onUpdate({ description: v })}
        />
      </Td>

      {/* Actions: the kit's HoverActions, on hover and on focus as before */}
      <Td align="right" className="rb-ent-acts-cell">
        <HoverActions className="rb-ent-acts">
          <IconButton size="sm" Icon={Eye} title="View details" onClick={onOpenDetail} />
          <IconButton size="sm" Icon={Trash2} danger title={`Delete ${entity.noun}`} onClick={onRequestDelete} />
        </HoverActions>
      </Td>
    </Row>
  )
}

// ── A group's band ──
// One button, the whole band: it was a clickable row with no keyboard way
// in. A status group carries the kit's StatusDot; the per-status accent
// colours are gone, and every group reads in the one ink (R4-33).
function EntityGroupToggle({ group, groupBy, collapsed, onToggle }) {
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <button type="button" onClick={onToggle} aria-expanded={!collapsed}
      className="rb-ent-group-toggle">
      <Chevron aria-hidden="true" className="rb-ent-group-chevron" />
      {groupBy === 'status' && <StatusDot status={group.key} aria-hidden="true" role={undefined} aria-label={undefined} title="" />}
      <span className="rb-ent-group-label">{group.label}</span>
      <span className="rb-ent-group-count">{group.items.length}</span>
    </button>
  )
}


// ─── Gallery ───
function EntityGallery({ entity, items, gallerySize, onOpenDetail, onRequestDelete }) {
  if (items.length === 0) {
    // The kit's empty state (R4-13), in sentence case.
    return <EmptyState Icon={entity.Icon} title={`No ${entity.nouns} yet`} />
  }

  return (
    <div className="rb-ent-gallery" data-entity-view="gallery" data-card={gallerySize}>
      {items.map(item => (
        <EntityCard
          key={item.id}
          entity={entity}
          item={item}
          onOpenDetail={() => onOpenDetail(item.id)}
          onRequestDelete={() => onRequestDelete({ id: item.id, name: item.name || 'Untitled' })}
        />
      ))}
    </div>
  )
}

// The kit's Card (raised paper, one hairline, 3px), at the width its size
// gives it: the entity's glyph in the paper well, the delete on hover (the
// kit's HoverActions — and named now), then the name at 600, the status the
// kit's StatusBadge (its words and tone from the one STATUS map; the badge's
// status-colour border and ink are gone) and the description in the second
// ink. The whole card opens the detail popup, as it did.
function EntityCard({ entity, item, onOpenDetail, onRequestDelete }) {
  const { Icon } = entity
  // What the card's delete is named for — the name its question will say.
  const name = item.name || 'Untitled'
  return (
    <Card pad={false} className="rb-ent-card ui-hover-host" onClick={onOpenDetail}>
      <div className="rb-ent-card-media">
        <Icon aria-hidden="true" className="rb-ent-card-icon" />
        <HoverActions className="rb-ent-card-acts">
          <IconButton size="sm" Icon={Trash2} danger
            title={`Delete ${name}`}
            onClick={e => { e.stopPropagation(); onRequestDelete() }} />
        </HoverActions>
      </div>
      <div className="rb-ent-card-body">
        <span className="rb-ent-card-name">
          {item.name || `Untitled ${entity.noun}`}
        </span>
        <div className="rb-ent-card-status">
          <StatusBadge status={item.status || 'not_started'} />
        </div>
        {item.description && (
          <span className="rb-ent-card-desc">
            {item.description}
          </span>
        )}
      </div>
    </Card>
  )
}


// ─── Detail popup ───
// The kit's Dialog at the popup's old width, 896px (its max-w-4xl: a real
// geometry, so a number), 🚨 PORTALLED into <body> as the Assets page's
// AssetDetailPopup is — the kit Dialog does not portal (B4-KR-2). It is
// that popup re-made in this lane's classes. The header keeps the entity's
// glyph and name: the name is the H2 title, read-only, and the "<Noun> name"
// field below is still where it is edited (C1: the two stay two). The status
// is the kit's StatusBadge, where the 3px status-coloured rule under the
// header said it (R4-05). The kit brings the named ✕ (the old one had no
// name), Escape (Q17) and the backdrop, which closed it before and still
// does. The body keeps its two columns — RelationsPanel's sidebar, then the
// properties — and every section, field and button in its old order: each
// property the Assets popup's borderless in-place editor under the Label
// step, each text edit's Escape reverting it first (W2), the footer the
// kit's Buttons.
//
// 🚨 THE TASK FORM. "Add new task" in the sidebar opens NewTaskSidePopup to
// the popup's LEFT, as it always did — now INSIDE the Dialog, as its first
// column: the Dialog is one surface, and its focus trap would strand a panel
// drawn beside it. The Dialog grows by the form's width and the hairline
// after it (DETAIL_TASK_WIDTH); the kit caps a dialog at 94vw, and there the
// properties column gives, as the old pair shrank the popup. A task opened
// from the sidebar is TaskDetailPopup, itself a kit Dialog: it opens as this
// Dialog's SIBLING, portalled, over it on the modal stack, so an Escape
// there is its own and this popup stays.
//
// R4-26 — a related asset's click sets `nestedAssetId`, which nothing
// renders — is RECORDED, not changed: the handler stays as it was.
function EntityDetailPopup({ entity, itemId, ctx, assetCountById, taskCountById, projectMembers, roleEntries, thumbRevision, onThumbChanged, onClose, onRequestDelete }) {
  const { Icon } = entity
  const item = (ctx?.[entity.collection] || []).find(x => x.id === itemId)
  const project = ctx?.project

  const [descDraft, setDescDraft] = useState(item?.description || '')
  const [notesDraft, setNotesDraft] = useState(item?.notes || '')
  const [editingDesc, setEditingDesc] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [nestedTaskId, setNestedTaskId] = useState(null)
  const [nestedAssetId, setNestedAssetId] = useState(null)

  useEffect(() => { setDescDraft(item?.description || '') }, [item?.description])
  useEffect(() => { setNotesDraft(item?.notes || '') }, [item?.notes])

  if (!item) return null

  // What the Dialog is named for: the name its title shows.
  const name = item.name || `Untitled ${entity.noun}`
  const status = item.status || 'not_started'
  const hasThumbnail = !!item.thumbnail_image

  function handleUpdate(patch) { ctx?.[entity.updateMethod]?.(item.id, patch) }

  async function handleSetThumbnail() {
    if (!window.electronAPI?.rabbit?.pickImage) return
    const imagePath = await window.electronAPI.rabbit.pickImage()
    if (!imagePath) return
    handleUpdate({ thumbnail_image: imagePath })
    try {
      await window.electronAPI.rabbit.generateEntityThumbnail({ entityType: entity.type, entityId: item.id, sourcePath: imagePath })
    } catch (e) { console.error(`${entity.noun} thumbnail gen failed:`, e) }
    onThumbChanged?.()
  }

  async function handleClearThumbnail() {
    handleUpdate({ thumbnail_image: null })
    try { await window.electronAPI.rabbit.clearEntityThumbnail({ entityType: entity.type, entityId: item.id }) } catch {}
    onThumbChanged?.()
  }

  async function handleCreateTask(draft) {
    try {
      await ctx?.addTask?.({ ...draft, [entity.linkKey]: item.id })
      setShowCreateTask(false)
    } catch (err) { console.error('Failed to create task:', err) }
  }

  return (
    <>
      {createPortal(
        <Dialog
          // Wider by the task form's column while it is open.
          width={showCreateTask ? DETAIL_WIDTH + DETAIL_TASK_WIDTH : DETAIL_WIDTH}
          className="rb-ent-detail"
          // A title that is a node names nothing, so the Dialog carries the
          // entity's name as its aria-label, as the Assets popup does.
          aria-label={name}
          title={(
            <span className="rb-ent-detail-title">
              <Icon aria-hidden="true" className="rb-ent-detail-icon" />
              <span className="rb-ent-detail-name">{name}</span>
            </span>
          )}
          subtitle={<StatusBadge status={status} />}
          dismissOnBackdrop
          onClose={onClose}
          footer={(
            <>
              {/* At the footer's left, where it was; Close at its right. */}
              <Button variant="danger" Icon={Trash2} className="rb-ent-detail-delete"
                onClick={() => { onClose(); onRequestDelete({ id: item.id, name: item.name || 'Untitled' }) }}>
                {`Delete ${entity.noun}`}
              </Button>
              <Button onClick={onClose}>
                Close
              </Button>
            </>
          )}
        >
          <div className="rb-ent-detail-body">

            {/* The task form: the first column, while it is open */}
            {showCreateTask && (
              <div className="rb-ent-detail-task">
                <NewTaskSidePopup
                  entityType={entity.type}
                  entityId={item.id}
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

            {/* Relations: RelationsPanel's sidebar, the kit Panel */}
            <div className="rb-ent-detail-side">
              <RelationsPanel
                entityType={entity.type}
                entityId={item.id}
                assets={ctx?.assets || []}
                tasks={ctx?.tasks || []}
                ctx={ctx}
                onOpenAsset={id => setNestedAssetId(id)}
                onOpenTask={id => setNestedTaskId(id)}
                onCreateTask={() => setShowCreateTask(true)}
              />
            </div>

            {/* Properties */}
            <div className="rb-ent-detail-main">

              {/* The thumbnail, then the name */}
              <div className="rb-ent-detail-top">
                <div className="rb-ent-thumb ui-hover-host">
                  {hasThumbnail ? (
                    <>
                      <img
                        className="rb-ent-thumb-img"
                        src={`/api/rabbit/projects/${project?.id}/${entity.collection}/${item.id}/thumbnail?r=${thumbRevision}`}
                        alt="" />
                      {/* Change and remove over the picture: the kit's
                          HoverActions, shown on hover as they were, and on
                          keyboard focus now. */}
                      <HoverActions className="rb-ent-thumb-acts">
                        <IconButton size="sm" Icon={ImagePlus} className="rb-ent-thumb-act" title="Change thumbnail" onClick={handleSetThumbnail} />
                        <IconButton size="sm" Icon={ImageOff} danger className="rb-ent-thumb-act" title="Remove thumbnail" onClick={handleClearThumbnail} />
                      </HoverActions>
                    </>
                  ) : (
                    <button type="button" onClick={handleSetThumbnail}
                      className="rb-ent-thumb-set"
                      title="Set thumbnail">
                      <span className="rb-ent-thumb-hint">
                        <ImagePlus aria-hidden="true" className="rb-ent-thumb-hint-icon" />
                        Set thumbnail
                      </span>
                      <Icon aria-hidden="true" className="rb-ent-thumb-glyph" />
                    </button>
                  )}
                </div>
                <div className="rb-ent-detail-field">
                  <FieldLabel>{`${entity.Noun} name`}</FieldLabel>
                  <PopupInlineText
                    value={item.name || ''}
                    placeholder={`Untitled ${entity.noun}`}
                    label={`${entity.Noun} name`}
                    onCommit={v => handleUpdate({ name: v })}
                  />
                </div>
              </div>

              {/* The properties, two to a row: each control named for its
                  label, which labels nothing by itself. */}
              <div className="rb-ent-prop-grid">
                <div className="rb-ent-prop">
                  <FieldLabel>Status</FieldLabel>
                  {/* The kit's StatusDot beside the kit's CellSelect, the
                      words in the one ink (R4-05): the status colour on the
                      select and on each option is gone. */}
                  <span className="rb-ent-status">
                    <StatusDot status={status} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
                    <CellSelect
                      className="rb-ent-status-select"
                      value={status}
                      onChange={v => handleUpdate({ status: v })}
                      options={STATUS_OPTIONS}
                      aria-label="Status"
                    />
                  </span>
                </div>
                <div className="rb-ent-prop">
                  <FieldLabel>Linked counts</FieldLabel>
                  <span className="rb-ent-prop-value">
                    {assetCountById[itemId] || 0} assets / {taskCountById[itemId] || 0} tasks
                  </span>
                </div>
                <div className="rb-ent-prop">
                  <FieldLabel>Start date</FieldLabel>
                  <input
                    type="date"
                    value={item.start_date || ''}
                    onChange={(e) => handleUpdate({ start_date: e.target.value || null })}
                    aria-label="Start date"
                    className="rb-ent-date"
                    data-empty={item.start_date ? 'false' : 'true'}
                  />
                </div>
                <div className="rb-ent-prop">
                  <FieldLabel>Due date</FieldLabel>
                  <input
                    type="date"
                    value={item.end_date || ''}
                    onChange={(e) => handleUpdate({ end_date: e.target.value || null })}
                    aria-label="Due date"
                    className="rb-ent-date"
                    data-empty={item.end_date ? 'false' : 'true'}
                  />
                </div>
              </div>

              {/* Description: the words open the kit's well; Save and Cancel
                  are the kit's Buttons. Escape cancels, and is MARKED handled
                  so the Dialog stays (W2). */}
              <div className="rb-ent-detail-text">
                <FieldLabel>Description</FieldLabel>
                {editingDesc ? (
                  <>
                    <textarea value={descDraft} onChange={e => setDescDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setDescDraft(item.description || ''); setEditingDesc(false) } }}
                      aria-label="Description"
                      className="ui-input rb-ent-textarea"
                      data-field="description"
                      autoFocus />
                    <div className="rb-ent-edit-acts">
                      <Button size="sm" variant="primary" Icon={Save}
                        onClick={() => { handleUpdate({ description: descDraft }); setEditingDesc(false) }}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost"
                        onClick={() => { setDescDraft(item.description || ''); setEditingDesc(false) }}>
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <button type="button" onClick={() => setEditingDesc(true)}
                    className="rb-ent-prop-text"
                    data-empty={item.description ? 'false' : 'true'}>
                    {item.description || 'Click to add a description...'}
                  </button>
                )}
              </div>

              {/* Notes: the same editor */}
              <div className="rb-ent-detail-text">
                <FieldLabel>Notes</FieldLabel>
                {editingNotes ? (
                  <>
                    <textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setNotesDraft(item.notes || ''); setEditingNotes(false) } }}
                      aria-label="Notes"
                      className="ui-input rb-ent-textarea"
                      data-field="notes"
                      autoFocus />
                    <div className="rb-ent-edit-acts">
                      <Button size="sm" variant="primary" Icon={Save}
                        onClick={() => { handleUpdate({ notes: notesDraft }); setEditingNotes(false) }}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost"
                        onClick={() => { setNotesDraft(item.notes || ''); setEditingNotes(false) }}>
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <button type="button" onClick={() => setEditingNotes(true)}
                    className="rb-ent-prop-text"
                    data-empty={item.notes ? 'false' : 'true'}>
                    {item.notes || 'Click to add notes...'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </Dialog>,
        document.body,
      )}

      {/* A task opened from the sidebar: its own kit Dialog, portalled beside
          this one and over it on the modal stack. Not while the task form is
          open, as before. */}
      {nestedTaskId && !showCreateTask && createPortal(
        <TaskDetailPopup taskId={nestedTaskId} ctx={ctx} onClose={() => setNestedTaskId(null)} />,
        document.body,
      )}
    </>
  )
}


// ─── Shared sub-components ───

// ─── The delete question: the kit's Dialog (W9's shape) ───
// The row's delete, the card's and the detail popup's all ask here, in the
// same words. Cancel and the backdrop keep the row, as they did; Escape does
// too now (Q17). 🚨 PORTALLED into <body>, as FileManager's question is.
//
// 🚨 Cancel takes focus in an EFFECT, not only by `autoFocus`. From the
// detail popup's Delete the popup closes in the same commit this opens:
// `autoFocus` puts focus on Cancel during the commit, then the popup's
// unmount hands focus back to what opened IT, and the kit Dialog's own
// effect, finding focus outside, lands it on ✕ (B4c review round one). This
// effect runs after both — a child's effects run before its parent's — so
// the question opens on Cancel from every path, as it does from a row.
function ConfirmDialog({ title, message, onConfirm, onCancel }) {
  const cancelRef = useRef(null)
  useEffect(() => { cancelRef.current?.focus() }, [])
  return createPortal(
    <Dialog
      width="confirm"
      title={title}
      dismissOnBackdrop
      onClose={onCancel}
      footer={(
        <>
          <Button ref={cancelRef} autoFocus onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>Delete</Button>
        </>
      )}
    >
      <p className="rb-ent-confirm">{message}</p>
    </Dialog>,
    document.body,
  )
}

// ─── Create popup ───
// The kit's Dialog at the form width (560), laid out as the Assets page's
// New asset: the kit Field (the Label step over a native `ui-input`), the
// status the kit's dot inside its field, Cancel and Confirm & create the
// kit's Buttons in its footer. The default name, every field and the files
// picker are as they were. 🚨 PORTALLED into <body>, as NewAssetPopup is.
function CreateEntityPopup({ entity, ctx, count, onClose }) {
  const [name, setName] = useState(`${entity.Noun} ${count + 1}`)
  const [status, setStatus] = useState('not_started')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState([]) // [{ name, path }]
  const fileInputRef = useRef(null)

  async function handleConfirm() {
    try {
      await ctx?.[entity.addMethod]({ name: name.trim() || `${entity.Noun} ${count + 1}`, status, description, files })
    } catch (err) { console.error(`Failed to create ${entity.noun}:`, err) }
    onClose()
  }

  function handleFileSelect(e) {
    const newFiles = Array.from(e.target.files || []).map(f => ({ name: f.name, path: f.path || f.name }))
    setFiles(prev => [...prev, ...newFiles])
    e.target.value = ''
  }

  return createPortal(
    <Dialog
      width="form"
      title={`New ${entity.noun}`}
      // The backdrop closed it before and still does; Escape closes it too
      // (Q17).
      dismissOnBackdrop
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleConfirm} disabled={!name.trim()}>
            Confirm & create
          </Button>
        </>
      )}
    >
      <div className="ui-field-stack">
        <Field label="Name *">
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            className="ui-input" autoFocus />
        </Field>
        <Field label="Status">
          {/* The kit's dot inside the field and the words in the one ink,
              where the words and every option were the status colour (R4-05). */}
          <span className="rb-ent-form-status">
            <StatusDot status={status} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="ui-input rb-ent-form-status-input">
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </span>
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            className="ui-input rb-ent-form-text"
            placeholder="Description..." />
        </Field>
        {/* Files: a group, not a <label> — a label around the picker would
            open it from a click anywhere in the list. */}
        <div className="ui-field">
          <span className="ui-field-label">Files</span>
          <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
          <Button size="sm" Icon={Upload} className="rb-ent-files-add" onClick={() => fileInputRef.current?.click()}>
            Add files
          </Button>
          {files.length > 0 && (
            <div className="rb-ent-files">
              {files.map((f, i) => (
                <div key={i} className="rb-ent-file">
                  <span className="rb-ent-file-name">{f.name}</span>
                  <IconButton size="sm" Icon={X} danger title={`Remove ${f.name}`}
                    onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>,
    document.body,
  )
}


// ─── Filter panel ───
// The Assets page's filter strip, in this lane's classes: native selects in
// the kit's small well, a named remove button per row.
function EntityFilterPanel({ filters, onAdd, onUpdate, onRemove, onClose }) {
  function getOptions(f) {
    const def = FILTER_FIELDS.find(ff => ff.value === f.field)
    if (!def) return []
    return (def.options || []).map(o => ({ value: o, label: def.value === 'status' ? STATUS_LABELS[o] : fmt(o) }))
  }
  function getType(f) {
    return FILTER_FIELDS.find(ff => ff.value === f.field)?.type || 'text'
  }
  return (
    <div className="rb-ent-filters">
      {filters.map((f, i) => {
        const type = getType(f)
        const ops = FILTER_OPS[type] || FILTER_OPS.text
        const needsValue = !['is_empty','is_not_empty'].includes(f.op)
        return (
          <div key={i} className="rb-ent-filter-row">
            <span className="rb-ent-filter-where text-label uppercase">
              {i === 0 ? 'Where' : 'And'}
            </span>
            <select value={f.field} onChange={e => onUpdate(i, { field: e.target.value, value: '' })}
              aria-label="Field" className="ui-input rb-ent-filter-field" data-size="sm">
              {FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select value={f.op} onChange={e => onUpdate(i, { op: e.target.value })}
              aria-label="Condition" className="ui-input rb-ent-filter-op" data-size="sm">
              {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
              type === 'select' ? (
                <select value={f.value} onChange={e => onUpdate(i, { value: e.target.value })}
                  aria-label="Value" className="ui-input rb-ent-tool" data-size="sm">
                  <option value="">— select —</option>
                  {getOptions(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" value={f.value || ''} onChange={e => onUpdate(i, { value: e.target.value })}
                  placeholder="value…"
                  aria-label="Value"
                  className="ui-input rb-ent-filter-text" data-size="sm" />
              )
            )}
            <IconButton size="sm" Icon={X} danger title="Remove this filter" onClick={() => onRemove(i)} />
          </div>
        )
      })}
      <div className="rb-ent-filter-actions">
        <Button size="sm" Icon={Plus} onClick={onAdd}>Add filter</Button>
        {filters.length > 0 && (
          <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
        )}
      </div>
    </div>
  )
}


// ─── Saved views dropdown ───
// The Assets page's, in this lane's classes: hand-drawn on the kit's floating
// tokens, because the kit Menu has no item with a trailing action (load a
// view AND delete it, from one row; B2's kit request K2).
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
      <Button size="sm" Icon={BookmarkPlus} aria-expanded={open} onClick={() => setOpen(!open)}>
        Views
      </Button>
      {open && (
        <div className="rb-ent-menu">
          {views.length === 0 && (
            <div className="rb-ent-menu-empty">No saved views</div>
          )}
          {views.map(v => (
            <div key={v.id} className="rb-ent-menu-item"
              onClick={() => { onLoad(v); setOpen(false) }}>
              <span className="rb-ent-menu-label">{v.name}</span>
              <IconButton size="sm" Icon={X} danger title={`Delete the saved view "${v.name}"`}
                onClick={e => { e.stopPropagation(); onDelete(v.id) }} />
            </div>
          ))}
          <div className="rb-ent-menu-foot">
            <button type="button" onClick={() => { onSave(); setOpen(false) }}
              className="rb-ent-menu-item">
              <Save className="rb-ent-menu-icon" aria-hidden="true" />
              <span className="rb-ent-menu-label">Save current view</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Bulk select dropdown ───
// The floating bar's select, in the kit's small well (B2's BulkSelect).
function BulkSelect({ label, options, labels, onPick }) {
  return (
    <select
      defaultValue=""
      aria-label={label}
      onChange={e => { if (e.target.value !== '') { onPick(e.target.value); e.target.value = '' } }}
      className="ui-input rb-ent-tool"
      data-size="sm"
    >
      <option value="" disabled>{label}</option>
      {options.map(o => <option key={o} value={o}>{(labels?.[o] || o).replace(/_/g, ' ')}</option>)}
    </select>
  )
}


// ─── The table's inline editor ───
// A cell's own text until it is clicked, then a native field in the kit's
// small well (not the kit Input, whose own Enter blurs; B3d-KR-2). Enter and
// blur commit the trimmed draft and Escape reverts — unchanged. The name is
// the row's anchor, Dense 600 in the full ink; a `quiet` cell (the
// description) reads at 400 in the second ink (R4-03); an empty one shows
// its placeholder in the third.
function InlineText({ value, placeholder, label, onCommit, quiet = false }) {
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
        aria-label={label}
        className="ui-input rb-ent-cell-input"
        data-size="sm"
        data-quiet={quiet ? 'true' : 'false'} />
    )
  }
  return (
    <button type="button" onClick={() => setEditing(true)}
      className="rb-ent-cell-text"
      title={value || undefined}
      data-quiet={quiet ? 'true' : 'false'}
      data-empty={value ? 'false' : 'true'}>
      {value || placeholder}
    </button>
  )
}

// ─── The popup's name field ───
// Its words as a quiet button until clicked, the Assets popup's in-place
// editor: no box, the kit's hover fill, an empty one's placeholder in the
// third ink (it was #57534e, 2.29:1). Then a native field in the kit's small
// well where the words were (not the kit Input, whose own Enter blurs;
// B3d-KR-2), in the ink where it was orange. Enter and blur commit the
// trimmed draft, as they did. Escape reverts it and is MARKED handled (K4's
// mark), so the kit Dialog around it stands down: the first press reverts
// the edit, the next one closes the popup (W2).
function PopupInlineText({ value, placeholder, label, onCommit }) {
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
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { e.preventDefault(); setDraft(value); setEditing(false) } }}
        aria-label={label}
        className="ui-input rb-ent-name-input"
        data-size="sm" />
    )
  }
  return (
    <button type="button" onClick={() => setEditing(true)}
      className="rb-ent-prop-text"
      data-empty={value ? 'false' : 'true'}>
      {value || placeholder}
    </button>
  )
}

// ─── A property's label: the Label step ───
// The kit Field's own label class — 11px, 600, capitals at the kit's
// tracking, the second ink (7.85:1 on the Dialog's raised paper, where
// #78716c measured 3.16 on the old ground) — a block over its value. As
// before it labels no control by itself: each control carries its own name.
function FieldLabel({ children }) {
  return (
    <label className="ui-field-label rb-ent-label">
      {children}
    </label>
  )
}
