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

import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Boxes, Plus, Search, Filter, Trash2, AlertTriangle,
  X, FileText, ImagePlus, ImageOff, History,
  ArrowUpDown, ChevronDown, ChevronRight,
  CheckSquare, Square, MinusSquare, Group,
  Film, Clapperboard, Gamepad2, Sparkles, ListChecks,
} from 'lucide-react'
import {
  Toolbar, Button, IconButton, Tabs, Table, Th, Td, Row, Dialog, Field,
  Card, RowTitle, EmptyState, StatusDot, StatusBadge, StatusBanner, Badge, CellSelect, statusMeta,
  Banner, Loading, HoverActions, MenuButton, useToast,
} from '../../../ui'
import './rabbitFiles.css'
// VW1e (2026-10-25): the custom views on the Assets table (the design's §7
// step 5): the shared piece (views/tableViews/) given this table's
// description; combination groups by scene, shot, level and experience with
// Create grouping (her Q-M3); the old saved views removed (Q17).
import { useRosterMembers } from '../../../components/TeamMembers/useRosterMembers'
import { buildItemLookup, KIND_LABEL, KIND_LABEL_PLURAL } from '../state/taskItemsModel'
import { isGroupingLive } from '../state/tableViewsModel'
import { GROUPINGS_GATE_WORDS } from '../state/tableViewsState'
import { useTableView } from './tableViews/useTableView'
import { TableViewsMenu } from './tableViews/TableViewsMenu'
import { ViewBar } from './tableViews/ViewBar'
import { ViewFilterRow } from './tableViews/ViewFilterRow'
import { CreateGroupingDialog } from './tableViews/CreateGroupingDialog'
import { useAsk } from './tableViews/useAsk'
import { combinationGroupsOf } from './tableViews/combinationGroups'
import {
  ASSETS_TABLE, ASSET_STATUSES, ASSET_KIND_FIELD, assetsDescription, assetKindsOf, assetsTableWidths,
  ASSET_LINKS_ABSENT_REASON, linksKept,
} from './tableViews/assetsTableView'
import {
  applyViewFilters, applyViewSorts, effectiveFields, effectiveLeading, filterCount, withFirstSort, withFirstSortReversed,
} from './tableViews/viewScreenModel'
import { useRabbit } from '../state/RabbitProvider'
// FX2 (0096): an asset's task count and its window's tasks count every task
// ABOUT it (any of its items).
import { taskCountsByEntity, tasksAbout } from '../state/taskItemsModel'
import { ASSET_TYPES, assetTypeLabel } from '../state/assetTypes'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import { useTaskTemplates } from '../../../components/TaskTemplates/useTaskTemplates'
import { usePermissions } from '../../../permissions/usePermissions'
import { canOnProject, projectActionDeniedReason } from '../../../permissions/projectRoleMatrix'
import GatedAction, { WriteReasonProvider } from '../../../permissions/GatedAction'
import AssetStatusWarningModal from '../components/AssetStatusWarningModal'
// Phase 7 (Track A A2, 2026-09-06): the task rows inside an asset's detail
// popup write task statuses, so they warn about unfinished predecessors like
// every other task-status surface. Asset statuses themselves are not guarded:
// assets are not endpoints of either dependency table, so an asset has no
// predecessors — AssetStatusWarningModal (child tasks) is the asset warning.
import { useDependencyStatusGuard } from '../components/DependencyStatusGuard'
import EditHistoryDrawer from '../components/EditHistoryDrawer'
import { RelationPickerPopup, RelationBadge, AssetRelationsSidebar } from '../components/RelationsPanel'
// Post-overhaul S3c, step 1: the relation pickers' active-list default and
// each row's shot list (S3b-09).
import { useHomeIndex } from './scenes/LinkHome'
import { pickerRows, otherListRows } from './scenes/linkHomes'
import FileManager from '../components/FileManager'

// ── Thumbnail sizing ──
// 1x, 2x and 3x the 36px row. The sizes themselves live in rabbitFiles.css,
// keyed on the table's `data-thumb`: ONE thumbnail column width for the
// whole table (R4-04), where each row used to take its own.
const THUMB_SIZES = ['sm', 'md', 'lg']

// The body the Table / Gallery tabs switch (the kit's Tabs wants its panel).
const BODY_ID = 'rb-asset-body'

// VW1b (2026-10-17): an asset's types and their words live in
// state/assetTypes.js since the model sorts a task's items by them (her Q-N1b);
// re-exported here for the callers that read them from this file.
export { ASSET_TYPES, assetTypeLabel } from '../state/assetTypes'

// VW1e: the statuses live with the table's description (assetsTableView.js),
// re-exported here for the callers that read them from this file.
export { ASSET_STATUSES }

export const TASK_STATUSES = [
  'waiting_to_start','in_progress','pending_review','needs_revisions',
  'approved','final','blocked','on_hold','omitted',
]

// VW1e (2026-10-25): the filters, sorts and groupings are the view's, read
// through the table's description (views/tableViews/assetsTableView.js); the
// old Filter, Sort and Group lists here are gone with the old saved views.
// Q17 (her "Start fresh"): the views this browser kept for the Assets table
// before VW1e, removed on the first load; Expenses' and Team's stay (Q19).
const OLD_SAVED_VIEWS_KEY = 'rabbit_asset_saved_views'
/** Rows in their own table's order (sort_order), on a copy. */
const inOwnOrder = (rows) => (Array.isArray(rows) ? [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : rows)

// The kit toast stack, or nothing where no ToastProvider is mounted (a test
// that mounts the tab alone): a passing message, never a failure.
function useOptionalToast() {
  try { return useToast() } catch { return null }
}

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

// ── Type words ──
// assetTypeLabel (state/assetTypes.js): a type in sentence case, its three
// acronyms in capitals (V2, B4c §4.2 item 8).
const TYPE_LABELS = Object.fromEntries(ASSET_TYPES.map(t => [t, assetTypeLabel(t)]))
const TYPE_OPTIONS = ASSET_TYPES.map(t => ({ value: t, label: TYPE_LABELS[t] }))

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

  // ── The tab's own (VW1e): the search and the picture size are never part
  // of a view (her Q8: "layout if anything"; a view does not remember the
  // picture or card size). The layout, filters, sorts, grouping and fields
  // are the view's (useTableView, below).
  const [search, setSearch]       = useState('')
  const [thumbSize, setThumbSize] = useState('sm')
  const [showFilterPanel, setShowFilterPanel] = useState(false)

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

  // FX2 (0096): every task ABOUT the asset counts (a per-row count, never
  // added into a total); without items, the task's single asset, as before.
  const taskCountByAsset = useMemo(
    () => taskCountsByEntity(tasks, ctx?.taskItems, 'asset', ctx?.taskItemsAvailable === true),
    [tasks, ctx?.taskItems, ctx?.taskItemsAvailable],
  )

  // ── The view (VW1e, 2026-10-25): what Filter, Sort, Group, the layout
  // tabs and the Views dropdown's cards change, for the moment (her Q3),
  // until the bar saves it (Q3a). The shared piece (views/tableViews/) reads
  // the table through its description (assetsTableView.js).
  // The kinds' rows: what is live (buildItemLookup's isLive, nameOf,
  // orderOf: the display order, her Q-P3), and each kind's single items in
  // the project's own order (the active shot list's scenes and shots).
  const lookup = useMemo(() => buildItemLookup({
    items: [], available: false, assets,
    scenes: ctx?.allScenes || ctx?.scenes, shots: ctx?.allShots || ctx?.shots,
    levels: ctx?.levels, experiences: ctx?.experiences,
  }), [assets, ctx?.allScenes, ctx?.scenes, ctx?.allShots, ctx?.shots, ctx?.levels, ctx?.experiences])
  // Levels and experiences in their own tables' order (sort_order, on a
  // copy: code review round 2, R2-4, the twin of R1-6).
  const kindRows = useMemo(() => ({
    scene: ctx?.scenes, shot: ctx?.shots, level: inOwnOrder(ctx?.levels), experience: inOwnOrder(ctx?.experiences),
  }), [ctx?.scenes, ctx?.shots, ctx?.levels, ctx?.experiences])
  const kinds = useMemo(() => assetKindsOf(project, assets), [project, assets])
  const taskCountOf = useCallback((a) => taskCountByAsset[a.id] || 0, [taskCountByAsset])
  const description = useMemo(() => assetsDescription({ kinds, phases, lookup, kindRows, taskCountOf }),
    [kinds, phases, lookup, kindRows, taskCountOf])
  // Who changed a view, by the workspace roster (design §5.5): "Someone"
  // when they are not there; its own entries only (VW1d R2-7).
  const { members: rosterMembers } = useRosterMembers()
  const rosterById = useMemo(() => { const m = {}; for (const mb of rosterMembers || []) m[mb.id] = mb; return m }, [rosterMembers])
  const nameOf = useCallback((id) => {
    const m = Object.prototype.hasOwnProperty.call(rosterById, id) ? rosterById[id] : null
    return m ? (m.name || m.display_name || m.username || null) : null
  }, [rosterById])
  const toast = useOptionalToast()
  const notify = useCallback((words) => { toast?.push({ tone: 'info', title: words }) }, [toast])
  const { ask, dialog: askDialog } = useAsk()
  // The table's one polite live region (§4.9).
  const [announcement, setAnnouncement] = useState({ words: '', n: 0 })
  const announce = useCallback((words) => setAnnouncement(a => ({ words, n: a.n + 1 })), [])
  // A drop or a grouping's removal that did not land, said above the table.
  const [dropFailure, setDropFailure] = useState(null)
  const [groupingKind, setGroupingKind] = useState(null)
  const [focusGroupMenu, setFocusGroupMenu] = useState(false)
  useEffect(() => {
    if (!focusGroupMenu) return
    document.querySelector('.rb-asset-toolbar select[aria-label="Group"]')?.focus({ preventScroll: true })
    setFocusGroupMenu(false)
  }, [focusGroupMenu])
  const focusViews = useCallback(() => {
    document.querySelector('.rb-asset-toolbar .rb-tv-button')?.focus({ preventScroll: true })
  }, [])

  // Q17 (her "Start fresh"): this browser's old saved views go, once.
  useEffect(() => {
    try { localStorage.removeItem(OLD_SAVED_VIEWS_KEY) } catch { /* storage unavailable: nothing kept to remove */ }
  }, [])

  const tv = useTableView({ ctx, tableKey: ASSETS_TABLE, description, canWrite, nameOf, notify })
  const config = tv.config
  const viewMode = config.layout === 'gallery' ? 'gallery' : 'table'
  const filters = config.filters || []
  const sorts = config.sorts || []
  // The FIRST sort the table can sort by is the toolbar's (VW1d R2-4).
  const firstSort = sorts.find(s => s && description.field(s.field)?.sortable) || null
  const sortField = firstSort?.field || ''
  const sortDir = firstSort?.dir === 'desc' ? 'desc' : 'asc'
  // A grouping the table no longer offers (a kind the project stopped using)
  // reads as none: a saved view keeps it, a change for now forgets it (VW1b
  // R1-10, as the Tasks table keeps it).
  const storedGroup = config.group?.field || ''
  const groupBy = description.groupFields.some(f => f.key === storedGroup) ? storedGroup : ''
  const hideEmpty = config.group ? config.group.hideEmpty !== false : true
  const groupedKind = groupBy ? (description.field(groupBy)?.kind || null) : null
  const fromDraft = tv.fromDraft
  const update = tv.update
  useEffect(() => {
    if (fromDraft && storedGroup && !groupBy) update(c => ({ ...c, group: null }))
  }, [fromDraft, storedGroup, groupBy, update])
  const setViewMode = (mode) => tv.update(c => ({ ...c, layout: mode === 'gallery' ? 'gallery' : 'table' }))
  const setGroupBy = (value) => tv.update(c => ({ ...c, group: value ? { field: value, hideEmpty: description.hideEmptyDefault(viewMode, value) } : null }))
  const setSortField = (field) => tv.update(c => ({ ...c, sorts: withFirstSort(c.sorts, field) }))
  const reverseSort = () => tv.update(c => ({ ...c, sorts: withFirstSortReversed(c.sorts, s => !!description.field(s.field)?.sortable) }))

  // ── Filtering, then the view's sorts (VW1e) ──
  // The search is the tab's own; every complete filter must match (Q13); the
  // sorts in order (Q14). No sort: the table's own order (sort_order), on a
  // COPY — the old sort reordered the provider's array in place (VW1e step 0,
  // finding 16).
  const processed = useMemo(() => {
    const s = search.trim().toLowerCase()
    const base = [...assets].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const searched = s ? base.filter(a => (a.name || '').toLowerCase().includes(s)) : base
    return applyViewSorts(applyViewFilters(searched, filters, description), sorts, description)
  }, [assets, search, filters, sorts, description])

  // ── Grouping ──
  // By a linked kind (her Q-M3): one group per combination of the scenes,
  // shots, levels or experiences an asset is in (combinationGroups.js), the
  // project's groupings among them (Q-D2). By type, phase or status as
  // before; with *Hide empty groups* off every option shows (§4.3).
  const savedOf = useCallback((kind) => {
    const list = typeof ctx?.groupingsOf === 'function' ? ctx.groupingsOf(ASSETS_TABLE, kind) : []
    return list.filter(g => isGroupingLive(g, lookup.isLive)).map(g => ({ id: g.id, ids: g.entity_ids }))
  }, [ctx, lookup])
  const groups = useMemo(() => {
    if (!groupBy) return null
    if (groupedKind) {
      return combinationGroupsOf({
        kind: groupedKind, rows: processed, combinationOf: (a) => description.combinationOf(a, groupedKind), lookup,
        singles: kindRows[groupedKind], everySingle: !hideEmpty, saved: savedOf(groupedKind), hideEmpty, as: 'assets',
      })
    }
    const map = {}
    for (const a of processed) {
      let key
      if (groupBy === 'type') key = a.type || 'other'
      else if (groupBy === 'phase_id') key = a.phase_id || '__none__'
      else key = a.status || 'not_started'
      if (!map[key]) map[key] = []
      map[key].push(a)
    }
    const every = groupBy === 'type' ? ASSET_TYPES
      : groupBy === 'status' ? ASSET_STATUSES
        : [...phases.map(p => p.id), '__none__']
    const keys = hideEmpty ? every.filter(k => map[k]) : every
    return keys.map(key => ({ key, label: resolveGroupLabel(groupBy, key), assets: map[key] || [] }))
  }, [processed, groupBy, groupedKind, hideEmpty, phases, phaseById, description, lookup, kindRows, savedOf])

  function resolveGroupLabel(field, key) {
    if (key === '__none__') return 'No phase'
    if (field === 'phase_id') return phaseById[key]?.name || key
    if (field === 'status') return STATUS_LABELS[key] || fmt(key)
    if (field === 'type') return assetTypeLabel(key)
    return fmt(key)
  }
  // (The group's accent colour, computed here per status, is gone: a status
  // group carries the kit's StatusDot, and every other group none — R4-33.)

  // ── Dragging an asset into a combination group (her Q-D1; VW1e step 0,
  // finding 3): the group's items become the asset's items of that kind
  // ("No …": none), one undoable write inside the shell's undo toast (Ctrl+Z
  // is not bound on this tab). Its items of the kind that are not live (not
  // loaded) are kept, as a task's hidden items are (Q-N4). A drop on the
  // group the asset is in writes nothing.
  function dropOnGroup(assetId, group) {
    if (!canWrite || !groupedKind || typeof ctx?.updateAsset !== 'function') return
    const asset = assets.find(a => String(a.id) === String(assetId))
    if (!asset || group.assets.some(a => a.id === asset.id)) return
    const field = ASSET_KIND_FIELD[groupedKind]
    const hidden = (Array.isArray(asset[field]) ? asset[field] : []).filter(id => !lookup.isLive(groupedKind, id))
    const next = [...new Set([...hidden.map(String), ...group.ids.map(String)])]
    const name = asset.name || 'Untitled'
    const step = ctx.runWithUndoToast || ((run) => run())
    Promise.resolve(step(() => ctx.updateAsset(asset.id, { [field]: next }), `Moved "${name}" to ${group.label}`))
      .catch((err) => setDropFailure(`Could not move “${name}”: ${err?.message || err}`))
  }

  // ── The project's groupings (her Q-D2, Q-D3, Q-D5) ──
  async function createGrouping(kind, ids) {
    await ctx.addItemGrouping({ tableKey: ASSETS_TABLE, kind, entityIds: ids })
  }
  async function removeGrouping(group) {
    const yes = await ask({
      title: `Remove the grouping ${group.label}?`,
      body: 'Its assets keep their items. The group stays while assets are in it.',
      confirm: 'Remove grouping',
      danger: true,
    })
    if (!yes) return
    try {
      const res = await ctx.removeItemGrouping(group.groupingId)
      if (res && res.removed === false && res.status === 'filtered') setDropFailure(GROUPINGS_GATE_WORDS)
      else setFocusGroupMenu(true)
    } catch (err) {
      setDropFailure(`Could not remove the grouping ${group.label}: ${err?.message || err}`)
    }
  }

  // ── The Filter strip: the view's filters in the shared row (the Filters
  // card's own); a new row filters nothing until it has a value (defect 1).
  function addFilter() {
    const first = description.filterFields[0]
    tv.update(c => ({ ...c, filters: [...(c.filters || []), { field: first.key, op: description.filterOps(first)[0].value, values: [] }] }))
  }
  function updateFilter(idx, row) {
    tv.update(c => ({ ...c, filters: (c.filters || []).map((f, i) => (i === idx ? row : f)) }))
  }
  function removeFilter(idx) {
    tv.update(c => ({ ...c, filters: (c.filters || []).filter((_, i) => i !== idx) }))
  }

  // ── What the view shows ──
  const activeFilters = filterCount(filters, description)
  // The columns: the view's fields over the table's, in its order, the
  // hidden ones out (Q6, Q7); the name first, always shown; the picture in
  // front of it unless the view hides it (Q-J).
  const fieldList = useMemo(() => effectiveFields(config.fields, description.fieldKeys, { fixed: description.fixed }), [config.fields, description])
  const columns = useMemo(() => fieldList.filter(f => f.visible).map(f => description.columns.find(c => c.key === f.key)).filter(Boolean), [fieldList, description])
  const showThumb = effectiveLeading(config.leading, description.leadingKeys).some(f => f.key === 'thumbnail' && f.visible)
  // The Gallery card's own fields the view shows (her Q-E, Q-P2).
  const cardShows = useMemo(() => new Set(fieldList.filter(f => f.visible && description.cardFields.includes(f.key)).map(f => f.key)), [fieldList, description])
  // A level or experience group on a cloud without 0099 takes no drop (R1-9).
  const kindKept = linksKept(ctx, groupedKind)
  const canDrag = canWrite && !!groupedKind && kindKept
  // Said as well as greyed (code review round 2, R2-5): a greyed control's
  // reason reaches no screen reader, so the live region says it once.
  useEffect(() => { if (groupedKind && !kindKept) announce(ASSET_LINKS_ABSENT_REASON) }, [groupedKind, kindKept, announce])

  // ── New-asset creation popup (deferred until confirm) ──
  const [showNewAssetPopup, setShowNewAssetPopup] = useState(false)

  // ── Handlers ──
  function handleAddAsset() {
    setShowNewAssetPopup(true)
  }

  // ── Render ──
  // P1-74: the kit EmptyState in sentence case, as every R.A.B.B.I.T. view
  // draws it; it was a capitalised Label-step span.
  if (!project) {
    return (
      <div className="rb-asset-view h-full flex items-center justify-center">
        <EmptyState Icon={Boxes} title="No project loaded" />
      </div>
    )
  }

  return (
    <WriteReasonProvider reason={writeReason}>
    <div className="rb-asset-view h-full flex flex-col">
      {/* ── The table's one polite live region (VW1e, design §4.9): the
          bar's state and every reorder, always mounted. ── */}
      <p className="sr-only" role="status" aria-live="polite">
        <span key={announcement.n}>{announcement.words}</span>
      </p>

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
        {/* Filter: counts only the rows that filter (defect 1). */}
        <Button
          size="sm"
          Icon={Filter}
          className="rb-asset-tool"
          data-active={activeFilters > 0 ? 'true' : 'false'}
          aria-expanded={showFilterPanel}
          onClick={() => setShowFilterPanel(!showFilterPanel)}
        >
          Filter{activeFilters > 0 ? ` (${activeFilters})` : ''}
        </Button>

        {/* Sort: sets the view's FIRST sort (her Q14); the Sort card holds the rest. */}
        <span className="rb-asset-sort">
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            aria-label="Sort"
            className="ui-input rb-asset-tool"
            data-size="sm"
            data-active={sortField ? 'true' : 'false'}>
            <option value="">Sort…</option>
            {description.sortFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          {sortField && (
            <IconButton
              size="sm"
              Icon={ArrowUpDown}
              title={sortDir === 'asc' ? 'Sorted ascending — reverse' : 'Sorted descending — reverse'}
              onClick={reverseSort}
            />
          )}
        </span>

        <span className="rb-asset-divider" aria-hidden="true" />

        {/* Group: type, phase, status, and (her Q-M3) the scenes, shots,
            levels and experiences an asset is in, where the project uses
            them. */}
        <select value={groupBy}
          onChange={e => setGroupBy(e.target.value)}
          aria-label="Group"
          className="ui-input rb-asset-tool"
          data-size="sm"
          data-active={groupBy ? 'true' : 'false'}>
          <option value="">No grouping</option>
          {description.groupFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>

        {/* Her Q-D3: Create grouping, beside the Group menu, only while the
            table is grouped by a linked kind, for a seat that may save views (Q-F). */}
        {groupedKind && tv.canEdit && (
          <GatedAction allowed={kindKept} reason={ASSET_LINKS_ABSENT_REASON}>
            <Button size="sm" Icon={Group} onClick={() => { if (kindKept) setGroupingKind(groupedKind) }}>
              Create grouping
            </Button>
          </GatedAction>
        )}

        <span className="rb-asset-divider" aria-hidden="true" />

        {/* Table / Gallery — the kit's Tabs: one underline, no orange fill
            under small text (C6; R4-07, the same switch FileManager draws).
            VW1e: the layout is part of a view (her Q8), so a switch is a
            change for now; the group is "Layout" (§4.9). */}
        <Tabs
          label="Layout"
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

        {/* VW1e: the Views button and its dropdown (design §4.1, §4.2), in
            the old Views button's place; 136px, as on every table (Q-P1). */}
        <TableViewsMenu tv={tv} description={description} ask={ask} announce={announce}
          onRetry={typeof ctx?.reloadActiveProject === 'function' ? () => ctx.reloadActiveProject() : null} />

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

      {/* ── The Filter strip: the view's filters in the shared row (VW1e;
          the Filters card draws the same row, design §4.3). ── */}
      {showFilterPanel && (
        <div className="rb-asset-filters">
          {filters.map((f, i) => (
            <ViewFilterRow key={i} row={f} index={i} description={description}
              onChange={(row) => updateFilter(i, row)} onRemove={() => removeFilter(i)} />
          ))}
          <div className="rb-asset-filter-actions">
            <Button size="sm" Icon={Plus} onClick={addFilter}>Add filter</Button>
            {filters.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setShowFilterPanel(false)}>Done</Button>
            )}
          </div>
        </div>
      )}

      {/* ── A drop or a grouping's removal that did not land, said ── */}
      {dropFailure && (
        <Banner
          tone="danger"
          action={<IconButton size="sm" Icon={X} title="Dismiss" onClick={() => setDropFailure(null)} />}
        >
          {dropFailure}
        </Banner>
      )}

      {/* ── The *changed for now* bar (design §4.4): only while the view on
          screen has a change of one's own, directly above the table. ── */}
      <ViewBar tv={tv} ask={ask} announce={announce} focusViews={focusViews} />

      {/* ── Body: the one region the layout Tabs switch ── */}
      <div className="rb-asset-body" id={BODY_ID} role="tabpanel" aria-label={viewMode === 'table' ? 'Table' : 'Gallery'}>
        {tv.waiting ? (
          // The last used view not known yet (its 2s wait, design §4.5).
          <div className="rb-asset-waiting"><Loading label="Loading views" /></div>
        ) : viewMode === 'table' ? (
          <AssetTable
            assets={processed}
            groups={groups}
            groupBy={groupBy}
            columns={columns}
            showThumb={showThumb}
            phases={phases}
            taskCountByAsset={taskCountByAsset}
            ctx={ctx}
            canWrite={canWrite}
            canEditViews={tv.canEdit}
            canDrag={canDrag}
            thumbSize={thumbSize}
            thumbRevision={thumbRevision}
            collapsedGroups={collapsedGroups}
            toggleGroup={toggleGroup}
            onThumbChanged={() => setThumbRevision(r => r + 1)}
            onWarningClick={(id) => setWarningAssetId(id)}
            onDetailClick={(id) => setDetailAssetId(id)}
            onHistoryClick={canViewHistory ? (id) => setHistoryAssetId(id) : null}
            onDropOnGroup={dropOnGroup}
            onRemoveGrouping={removeGrouping}
          />
        ) : groups ? (
          // Gallery — grouped: each group opens with the table's group band.
          groups.map(g => (
            <div key={g.key}>
              <div className="rb-asset-group-head ui-hover-host">
                <AssetGroupToggle group={g} groupBy={groupBy}
                  collapsed={collapsedGroups.has(g.key)} onToggle={() => toggleGroup(g.key)} />
                <GroupingMore group={g} canEditViews={tv.canEdit} onRemoveGrouping={removeGrouping} />
              </div>
              {!collapsedGroups.has(g.key) && (
                <AssetGallery
                  assets={g.assets}
                  phaseById={phaseById}
                  taskCountByAsset={taskCountByAsset}
                  cardShows={cardShows}
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
            cardShows={cardShows}
            ctx={ctx}
            canWrite={canWrite}
            thumbRevision={thumbRevision}
            onThumbChanged={() => setThumbRevision(r => r + 1)}
            onWarningClick={(id) => setWarningAssetId(id)}
            onDetailClick={(id) => setDetailAssetId(id)}
          />
        )}
      </div>

      {/* ── The views' questions (Delete a view, Save over a teammate's,
          Remove grouping), at the view's root (design §4.2, finding 18). ── */}
      {askDialog}

      {/* ── Create grouping (design §4.11): its kit Dialog. ── */}
      {groupingKind && (
        <CreateGroupingDialog
          tableKey={ASSETS_TABLE}
          kind={groupingKind}
          singular={KIND_LABEL[groupingKind]}
          plural={KIND_LABEL_PLURAL[groupingKind]}
          rowsNoun="assets"
          options={description.options(groupingKind)}
          orderOf={lookup.orderOf}
          nameOf={lookup.nameOf}
          groupings={typeof ctx?.groupingsOf === 'function' ? ctx.groupingsOf(ASSETS_TABLE, groupingKind) : []}
          onCreate={(ids) => createGrouping(groupingKind, ids)}
          onClose={() => setGroupingKind(null)}
        />
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
          tasks={tasksAbout(tasks, ctx?.taskItems, 'asset', detailAssetId, ctx?.taskItemsAvailable === true)}
          phase={phaseById[assets.find(a => a.id === detailAssetId)?.phase_id]}
          ctx={ctx}
          thumbRevision={thumbRevision}
          onThumbChanged={() => setThumbRevision(r => r + 1)}
          onClose={() => setDetailAssetId(null)}
          canWrite={canWrite}
          writeReason={writeReason}
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
// A GROUP'S … MENU (VW1e)
// ═════════════════════════════════════════════════════
// Her Q-D5: a project grouping's *…* holds Remove grouping, for a seat that
// may save views (Q-F) — the Tasks table's group head's own menu. (The old
// filter panel and saved-views menu are gone: the shared filter row and the
// Views dropdown replace them, VW1e.)
function GroupingMore({ group, canEditViews, onRemoveGrouping }) {
  if (!group?.groupingId || !canEditViews || !onRemoveGrouping) return null
  return (
    <HoverActions>
      <MenuButton title={`More for ${group.label}`} minWidth={180}
        items={[{ label: 'Remove grouping', danger: true, onClick: () => onRemoveGrouping(group) }]} />
    </HoverActions>
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
// VW1e (2026-10-25): the columns are the view's (`columns`, the visible
// fields in its order) and the picture shows unless the view hides it
// (`showThumb`, her Q-J); the fixed sum is the columns on screen's (§4.10);
// a selection holds only the rows the table shows (defect 4); grouped by a
// linked kind, a row drags into a group (`canDrag`, `onDropOnGroup`, her
// Q-D1), and a project grouping's band has its *…* (Q-D5).
function AssetTable({ assets, groups, groupBy, columns, showThumb = true, phases, taskCountByAsset, ctx, canWrite, canEditViews = false, canDrag = false, thumbSize, thumbRevision, collapsedGroups, toggleGroup, onThumbChanged, onWarningClick, onDetailClick, onHistoryClick, onDropOnGroup, onRemoveGrouping }) {
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
  // Defect 4 (Q21; VW1e step 0, finding 9): a row a filter or the search
  // hides leaves the selection, so no bulk verb acts on a row nobody sees
  // (the Scenes tables' R1-05 rule).
  useEffect(() => {
    const shown = new Set(allAssetIds)
    setSelected(prev => {
      const keep = new Set([...prev].filter(id => shown.has(id)))
      return keep.size === prev.size ? prev : keep
    })
  }, [allAssetIds])

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

  // What a group row spans: the checkbox, the picture while it shows and
  // the columns on screen (VW1e: a view hides columns).
  const span = columns.length + 1 + (showThumb ? 1 : 0)
  // The fixed sum from the columns on screen (§4.10; VW1e step 0, finding 8).
  const widths = assetsTableWidths(columns, showThumb)

  if (assets.length === 0 && (!groups || groups.length === 0)) {
    return (
      <EmptyState Icon={Boxes} title="No assets yet" body="Click “New asset” to get started" />
    )
  }

  const row = (a, drop = null) => (
    <AssetRow
      key={a.id}
      asset={a}
      columns={columns}
      showThumb={showThumb}
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
      draggable={canDrag}
      drop={drop}
    />
  )

  return (
    <div className="rb-asset-table-wrap" data-thumb={thumbSize} data-history={onHistoryClick ? 'true' : 'false'}
      data-grow={widths.grow > 0 ? 'some' : 'none'}
      style={{ '--rb-asset-fixed': widths.fixed }}>
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
            <AssetBulkSelect label="Type" options={ASSET_TYPES} labels={TYPE_LABELS} onPick={v => bulkUpdate({ type: v })} />
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
            {/* Thumbnail column: the chosen size, for every row, unless the
                view hides it (her Q-J: hideable, never moved). */}
            {showThumb && (
              <Th width="var(--rb-asset-thumb)" className="rb-asset-thumb-cell">
                <span className="sr-only">Thumbnail</span>
              </Th>
            )}
            {columns.map(c => (
              <Th key={c.key} width={c.width} numeric={c.numeric}>{c.label}</Th>
            ))}
          </Row>
        )}
      >
        {groups ? (
          groups.map(g => (
            <AssetGroupRows key={g.key} group={g} groupBy={groupBy} span={span}
              collapsed={collapsedGroups.has(g.key)} onToggle={() => toggleGroup(g.key)}
              canDrop={canDrag} onDropOnGroup={onDropOnGroup}
              canEditViews={canEditViews} onRemoveGrouping={onRemoveGrouping}
              renderRow={row} />
          ))
        ) : (
          assets.map(a => row(a))
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
            {`Delete ${selected.size} asset${selected.size === 1 ? '' : 's'}?${tasksStayWords(selected, taskCountByAsset)}`}
          </p>
        </Dialog>
      )}
    </div>
  )
}

// VW1m (2026-10-16), her Q-M2 ("The tasks stay"): deleting an asset never
// deletes a task, it only comes off them, and the question says so when any
// asset asked about has a task ("Its tasks stay." for one asset, "Their
// tasks stay." for several). An asset with no task has nothing to say.
function tasksStayWords(ids, taskCountByAsset) {
  const list = [...ids]
  if (!list.some(id => (taskCountByAsset?.[id] || 0) > 0)) return ''
  return list.length === 1 ? ' Its tasks stay.' : ' Their tasks stay.'
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

// ── A group's band and its rows (VW1e): one drop target ──
// The Tasks table's TaskGroup shape (VW1e step 0, finding 3): a <tbody>
// cannot nest in the kit Table's own, so the band and the group's rows share
// one set of drag handlers — entering any of them counts, leaving the last
// un-counts — and a drop carries the dragged asset's id (text/plain). Only
// while the table is grouped by a linked kind and the seat may write
// (`canDrop`); a drop on the group the asset is in writes nothing (the
// view's dropOnGroup).
function AssetGroupRows({ group, groupBy, span, collapsed, onToggle, canDrop = false, onDropOnGroup, canEditViews = false, onRemoveGrouping, renderRow }) {
  const [dragOver, setDragOver] = useState(false)
  const countRef = useRef(0)
  const drop = canDrop ? {
    onDragEnter: (e) => { e.preventDefault(); countRef.current++; if (countRef.current === 1) setDragOver(true) },
    onDragOver: (e) => { e.preventDefault() },
    onDragLeave: () => { countRef.current--; if (countRef.current <= 0) { countRef.current = 0; setDragOver(false) } },
    onDrop: (e) => {
      e.preventDefault()
      countRef.current = 0
      setDragOver(false)
      let id = null
      try { id = e.dataTransfer?.getData?.('text/plain') || null } catch { id = null }
      if (id) onDropOnGroup?.(id, group)
    },
  } : null
  return (
    <>
      {/* Group header: one band across the table, as B2's */}
      <Row className="rb-asset-group-row"
        onDragEnter={drop?.onDragEnter} onDragOver={drop?.onDragOver} onDragLeave={drop?.onDragLeave} onDrop={drop?.onDrop}
        data-drag-over={dragOver ? 'true' : 'false'}>
        <Td colSpan={span} className="rb-asset-group-cell">
          <span className="rb-asset-group-band">
            <AssetGroupToggle group={group} groupBy={groupBy} collapsed={collapsed} onToggle={onToggle} />
            <GroupingMore group={group} canEditViews={canEditViews} onRemoveGrouping={onRemoveGrouping} />
          </span>
        </Td>
      </Row>
      {/* Group rows */}
      {!collapsed && group.assets.map(a => renderRow(a, drop))}
    </>
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
// VW1e: `showThumb` (the view may hide the picture, her Q-J); `draggable`
// (grouped by a linked kind, for a seat that may write, her Q-D1) and `drop`
// (its group's handlers, AssetGroupRows).
function AssetRow({ asset, columns, showThumb = true, phaseOptions, taskCount, warning, thumbRevision, onUpdate, onDelete, onWarningClick, onDetailClick, onHistoryClick, onThumbChanged, isSelected, onToggleSelect, readOnly = false, draggable = false, drop = null }) {
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
        // FX8: the row's buttons right after its words, in the one order —
        // Open (the page icon), its edit history, Delete last — shown on the
        // row's hover and on focus (the kit's RowTitle).
        return (
          <Td key={col.key} className="rb-asset-ctl-cell">
            <RowTitle className="rb-asset-name" actions={<>
              <IconButton size="sm" Icon={FileText} title={`Open ${name}`} onClick={onDetailClick} />
              {onHistoryClick && (
                <IconButton size="sm" Icon={History} title={`View edit history for ${name}`} onClick={onHistoryClick} />
              )}
              {onDelete && (
                // Soft delete — no confirm; the shell-level undo toast covers it.
                <IconButton size="sm" Icon={Trash2} danger title={`Delete ${name}`} onClick={onDelete} />
              )}
            </>}>
              <CellInlineText value={asset.name || ''} placeholder="Untitled" onCommit={v => onUpdate({ name: v })} readOnly={readOnly} />
            </RowTitle>
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
      default:
        return <Td key={col.key} className="rb-asset-desc">{asset[col.key] ?? '—'}</Td>
    }
  }

  return (
    <Row
      className="rb-asset-row"
      selected={isSelected}
      data-ticked={isSelected ? 'true' : 'false'}
      data-draggable={draggable ? 'true' : 'false'}
      draggable={draggable}
      onDragStart={draggable ? (e) => { e.dataTransfer.setData('text/plain', String(asset.id)); e.dataTransfer.effectAllowed = 'move' } : undefined}
      onDragEnter={drop?.onDragEnter} onDragOver={drop?.onDragOver} onDragLeave={drop?.onDragLeave} onDrop={drop?.onDrop}
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
          letterboxes its 36px placeholder in it, centred (R4-04). VW1e: a
          view may hide the column (her Q-J). */}
      {showThumb && (
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
      )}

      {/* Data columns */}
      {columns.map(renderCell)}
    </Row>
  )
}


// ═════════════════════════════════════════════════════
// GALLERY VIEW
// ═════════════════════════════════════════════════════
// VW1e: `cardShows`, the card's own lines the view shows (her Q-E; Q-P2, one
// field list for the table and the cards: status, type, phase, tasks). Null
// shows every line.
function AssetGallery({ assets, phaseById, taskCountByAsset, cardShows = null, ctx, canWrite, thumbRevision, onThumbChanged, onWarningClick, onDetailClick }) {
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
          shows={cardShows}
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
function AssetCard({ asset, phaseLabel, taskCount, shows = null, warning, thumbRevision, onUpdate, onDelete, onWarningClick, onDetailClick, onThumbChanged, readOnly = false }) {
  // VW1e: which of the card's own lines the view shows (finding 6's rule,
  // built for the Gallery); the picture block is the card and always stays.
  const show = (key) => !shows || shows.has(key)
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
              title={`Open ${name}`}
              onClick={onDetailClick} />
            <IconButton size="sm" Icon={ImagePlus}
              className="rb-asset-card-tool rb-asset-card-thumb"
              title={hasThumbnail ? `Change thumbnail for ${name}` : `Set thumbnail for ${name}`}
              onClick={handleSetThumbnail} />
          </>
        )}
        {/* On the paper, so the badge's tint reads the same over a picture. */}
        {show('status') && (
          <span className="rb-asset-card-status">
            <StatusBadge status={asset.status || 'not_started'} />
          </span>
        )}
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
        {(show('type') || (show('phase_id') && phaseLabel)) && (
          <div className="rb-asset-card-meta text-label uppercase">
            {show('type') && <span>{assetTypeLabel(asset.type)}</span>}
            {show('phase_id') && phaseLabel && <span className="rb-asset-card-phase">{show('type') ? '· ' : ''}{phaseLabel}</span>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="rb-asset-card-foot">
        {show('tasks') && (
          <span className="rb-asset-card-count">
            {taskCount} task{taskCount === 1 ? '' : 's'}
          </span>
        )}
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
              {ASSET_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
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
// Exported (post-overhaul S3b, P1-23): the Scenes popups open a related
// asset in it, over themselves, as a task opens in TaskDetailPopup.
// `canWrite` (post-overhaul S3c, S3b-01 / S3b-09's relation pickers): whether
// this seat may change the asset's relations. A reviewer sees the relation
// fields and the sidebar's links greyed with the reason, and the pickers'
// funnels refuse. Open by default for a caller that does not say. The rest
// of the popup's gate is the Assets lane's (OUTSTANDING S3b-09).
export function AssetDetailPopup({ asset, tasks, phase, ctx, thumbRevision, onThumbChanged, onClose, canWrite = true, writeReason = null }) {
  const tm = useTeamMembers()
  const guard = useDependencyStatusGuard(ctx)
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
  // R2-2: whether this backend keeps an asset's levels and experiences.
  const levelsKept = linksKept(ctx, 'level')
  const experiencesKept = linksKept(ctx, 'experience')
  const [showExperiencePicker, setShowExperiencePicker] = useState(false)
  // Post-overhaul S3c, step 1 (S3b-09): the scene and shot pickers offer the
  // ACTIVE shot list's rows (D10), with "Show all lists" for the rest, and
  // each row names its list; what the asset already links stays offered.
  const [showAllLists, setShowAllLists] = useState(false)
  const homeOf = useHomeIndex(ctx)

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

  // Escape closes the popup (Q17). Every layer it can open is the kit Dialog,
  // portalled into <body> and on the modal stack — the relation pickers (the
  // sidebar's and the four fields', B4b), FileManager's delete question (B4)
  // and its VideoPreview (B4c) — so an Escape with one open is that layer's
  // alone. The `layerOpen` guard that walked the two columns for a fixed
  // hand-rolled layer had nothing left to find, and is gone (B4c).

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
      // The status banner across the popup under the title (FX3; every item
      // popup draws the same one). It reads the live asset.
      band={<StatusBanner status={asset.status || 'not_started'} />}
      // The backdrop closed it before, and still does.
      dismissOnBackdrop
      onClose={onClose}
      footer={(
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      )}
    >
      <div className="rb-asset-detail-body">
        {/* LEFT COLUMN — Relations sidebar (RelationsPanel's) */}
        <div className="rb-asset-detail-side">
          <AssetRelationsSidebar asset={asset} ctx={ctx} canWrite={canWrite} writeReason={writeReason} />
        </div>

        {/* RIGHT COLUMN — Properties */}
        <div className="rb-asset-detail-main">

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
            {/* Post-overhaul S3c (S3b-09's relation pickers): each badge
                greyed with the reason for a seat that may not change the
                asset, as the sidebar's links are. */}
            {project?.scenes_enabled && (
              <PropField label="Scenes">
                <GatedAction allowed={canWrite} reason={writeReason}>
                  <RelationBadge icon={Film} count={linked.scenes} label="Scenes"
                    onClick={() => { if (canWrite) setShowScenePicker(true) }} />
                </GatedAction>
              </PropField>
            )}
            {project?.scenes_enabled && (
              <PropField label="Shots">
                <GatedAction allowed={canWrite} reason={writeReason}>
                  <RelationBadge icon={Clapperboard} count={linked.shots} label="Shots"
                    onClick={() => { if (canWrite) setShowShotPicker(true) }} />
                </GatedAction>
              </PropField>
            )}
            {/* VW1e code review round 2 (R2-2): a cloud without 0099 keeps no
                asset levels or experiences: greyed, saying why. */}
            {project?.levels_enabled && (
              <PropField label="Levels">
                <GatedAction allowed={canWrite && levelsKept} reason={canWrite ? ASSET_LINKS_ABSENT_REASON : writeReason}>
                  <RelationBadge icon={Gamepad2} count={linked.levels} label="Levels"
                    onClick={() => { if (canWrite && levelsKept) setShowLevelPicker(true) }} />
                </GatedAction>
              </PropField>
            )}
            {project?.experiences_enabled && (
              <PropField label="Experiences">
                <GatedAction allowed={canWrite && experiencesKept} reason={canWrite ? ASSET_LINKS_ABSENT_REASON : writeReason}>
                  <RelationBadge icon={Sparkles} count={linked.experiences} label="Experiences"
                    onClick={() => { if (canWrite && experiencesKept) setShowExperiencePicker(true) }} />
                </GatedAction>
              </PropField>
            )}
          </div>

          {/* ── Relation picker popups ── */}
          {showScenePicker && (
            <RelationPickerPopup
              title="Link scenes"
              icon={Film}
              items={pickerRows({ active: ctx?.scenes || [], all: ctx?.allScenes || ctx?.scenes || [], showAll: showAllLists, keep: asset.scene_ids })}
              scope={otherListRows({ active: ctx?.scenes || [], all: ctx?.allScenes || [] }) ? { on: showAllLists, onChange: setShowAllLists } : null}
              homeOf={Array.isArray(ctx?.shotLists) ? homeOf : null}
              selectedIds={asset.scene_ids || []}
              onToggle={id => {
                if (!canWrite) return
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
              items={pickerRows({ active: ctx?.shots || [], all: ctx?.allShots || ctx?.shots || [], showAll: showAllLists, keep: asset.shot_ids })}
              scope={otherListRows({ active: ctx?.shots || [], all: ctx?.allShots || [] }) ? { on: showAllLists, onChange: setShowAllLists } : null}
              homeOf={Array.isArray(ctx?.shotLists) ? homeOf : null}
              selectedIds={asset.shot_ids || []}
              onToggle={id => {
                if (!canWrite) return
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
                if (!canWrite || !levelsKept) return
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
                if (!canWrite || !experiencesKept) return
                const current = asset.experience_ids || []
                const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
                ctx?.updateAsset?.(asset.id, { experience_ids: next })
              }}
              onClose={() => setShowExperiencePicker(false)}
            />
          )}

          {/* Tasks section: a Label-step heading, as FileManager's "Files (N)"
              is, over the kit's Table (R4-06) at its 36px row, as FileManager's
              below it (Q11: one row app-wide; `dense` is the media tables'),
              on the paper in a hairline frame, as FileManager's is here — the
              two tables in this popup are one language now. */}
          <div className="rb-asset-detail-heading text-label uppercase">
            Tasks ({tasks.length})
          </div>

          {tasks.length === 0 ? (
            <EmptyState compact Icon={ListChecks} title="No tasks on this asset" />
          ) : (
            <Table
              className="rb-asset-task-table"
              scrollClassName="rb-asset-task-scroll"
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
                  onUpdateTask={(patch) => guard.update({ ids: t.id, patch, write: () => ctx?.updateTask?.(t.id, patch) })}
                />
              ))}
            </Table>
          )}

          {guard.modal}
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

// ── A task in the popup's table: the kit's Row at its 36px (R4-06, Q11) ──
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
