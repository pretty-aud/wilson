// ============================================================
// RABBIT — ProjectTasksView
// ============================================================
//
// Full-featured task management view with two modes:
//
//   1. TABLE — spreadsheet-style rows with complex filtering,
//      sorting, grouping, inline-add blank rows per group,
//      and phase creation.
//
//   2. KANBAN — column-based card board grouped by a user-
//      chosen property (status default, or assignee/asset/
//      phase/type/priority). Shares the same filter & sort
//      engine as the table.
//
// Saved view profiles let users name and recall filter/sort/
// group/kanban configurations.
//
// ── UX Laws applied ──
// • Aesthetic-Usability Effect — polished surfaces, spacing, color harmony
// • Law of Common Region — cards & columns as clearly bounded groups
// • Law of Proximity — tight internal spacing, generous external gaps
// • Von Restorff Effect — status accent bars for instant recognition
// • Doherty Threshold — 150-200ms transitions on all interactive elements
// • Fitts's Law — larger touch targets, prominent primary actions
// • Law of Prägnanz — clean shapes, minimal decoration
// • Law of Similarity — consistent card/row treatment across views
//
// VW1m (2026-10-16, Audrey: "lets not have main asset be a thing. thats not
// needed and i dont like"): a task's items are its items. Grouped by asset,
// scene, shot, level or experience, a task sits in the group of its
// COMBINATION (her Q-D: "there should be a group called Asset A, Asset B,
// Asset C"), the Law of Common Region: a group is the region of the tasks
// that share exactly those items. A drop makes the group's items the task's
// (Q-D1), with the shell's undo toast (Ctrl+Z is not bound on this tab).
// *Asset is X* means the task has X. Every reading goes through the model's
// one path, buildItemLookup.
//
// VW1b (2026-10-17, her Q9 "All of them", Q10 "Pick several there", Q11 "Yes,
// a column for each", Q-G2, Q6a; the design's §4.6 as its step 0 review
// corrected it): a column per item kind the project uses — Asset, Scene, Shot,
// Level, Experience, after Priority — each cell every live item by name in the
// task window's Sort, "+N" past what fits, a click opening a picker that ticks
// several (TaskItemCells.jsx: a draft, committed once on close, one undo
// step). Scene, Shot, Level and Experience join the Group menu with their
// columns. The table scrolls sideways with the checkbox and Title kept in
// place (the kit Table's stickyColumns), its widths from the columns on
// screen (tasksTableColumns.js). Working memory: the task's name stays in
// view while the table scrolls; Fitts: the edit is in the cell the eye is on.
//
// VW1d (2026-10-25), the custom views on this table (docs/design/
// CUSTOM_VIEWS_DESIGN.md §4.1 to §4.5, §4.11, as VW1d's step 0 review
// corrected them): the table shows a VIEW (views/tableViews/: the view on
// screen, or its change for now, useTableView). Filter, Sort, Group, the
// Table / Board tabs and the cards change it for the moment (her Q3); the
// bar under the toolbar saves it (Q3c, Q-A3). The toolbar's Phase, Key date
// and New task are one *New* menu (Q-A1); *Create grouping* sits beside the
// Group menu while the table is grouped by a linked kind (Q-D3), and the
// project's groupings show as groups even while empty (Q-D2), removed from a
// group's *…* (Q-D5). The browser's old saved views are removed (Q17).
// Hick: nothing new on the toolbar at rest — the Views button replaces the
// old one, the bar exists only while there is something to save.

import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import {
  ListChecks, Plus, Search, Filter, Trash2, X, FileText,
  ArrowUpDown, Diamond, Group,
  ChevronDown, ChevronRight,
  CheckSquare, Square, MinusSquare,
  History, Download,
} from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useRosterMembers } from '../../../components/TeamMembers/useRosterMembers'
import { usePermissions } from '../../../permissions/usePermissions'
import { canOnProject, projectActionDeniedReason } from '../../../permissions/projectRoleMatrix'
import GatedAction, { WriteReasonProvider, useWriteReason } from '../../../permissions/GatedAction'
import TaskDetailPopup from '../components/TaskDetailPopup'
// Post-overhaul S5b (constraint 9): Remove from this version, or Delete.
import { useRemovalAsk } from '../components/RemovalQuestion'
import { removalQuestion } from '../state/versionWords'
import NewTaskPopup from '../components/NewTaskPopup'
// Phase 7 (Track A A2, 2026-09-06): every task-status write on this tab —
// the inline dropdown, the bulk select, and both drop targets — warns about
// unfinished predecessors and then continues if asked. Never blocks.
import { useDependencyStatusGuard } from '../components/DependencyStatusGuard'
import EditHistoryDrawer from '../components/EditHistoryDrawer'
import MilestoneTrashModal from '../components/MilestoneTrashModal'
import { downloadCsv, exportDateStamp } from '../../../lib/csvExport'
import { projectDayCounts, toIsoDate, showDate } from '../dates.js'
import {
  Stat, Toolbar, Button, IconButton, Tabs, Table, Th, Td, Row, Dialog,
  HoverActions, RowTitle, EmptyState, Badge, StatusDot, humanizeStatus, Banner,
  MenuButton, Loading, useToast,
} from '../../../ui'
// Priority as a status TONE, from the one place that decides it: the
// Dashboard's task table shows the same tasks and must not say otherwise.
import { priorityTone } from '../../../components/Dashboard/dashboardTaskModel'
import { ITEM_KINDS, KIND_FIELD, KIND_LABEL, KIND_LABEL_PLURAL, buildItemLookup, isItemKind, sortIdsForDisplay } from '../state/taskItemsModel'
import { pickerKinds, useTaskItemSort } from '../components/RelationsPanel'
import { TaskItemCell, useItemPicker } from './TaskItemCells'
import { tasksTableColumns, tasksTableWidths } from './tasksTableColumns'
import { isGroupingLive } from '../state/tableViewsModel'
import { combinationGroupsOf } from './tableViews/combinationGroups'
import { GROUPINGS_GATE_WORDS } from '../state/tableViewsState'
import { useTableView } from './tableViews/useTableView'
import { TableViewsMenu } from './tableViews/TableViewsMenu'
import { ViewBar } from './tableViews/ViewBar'
import { ViewFilterRow } from './tableViews/ViewFilterRow'
import { CreateGroupingDialog } from './tableViews/CreateGroupingDialog'
import { useAsk } from './tableViews/useAsk'
import {
  TASKS_TABLE, TASK_STATUSES, PRIORITIES, STATUS_LABELS, PRIORITY_LABELS, CARD_FIELDS,
  tasksDescription, groupToTab, groupFromTab,
} from './tableViews/tasksTableView'
import {
  applyViewFilters, applyViewSorts, effectiveFields, filterCount, withFirstSort, withFirstSortReversed,
} from './tableViews/viewScreenModel'
import './rabbitTasks.css'

// Q17 (her "Start fresh"): the views this browser kept for the Tasks table
// before VW1d, removed on the first load after the new views ship. The other
// tables' keys are VW1e's; Expenses' and Team's stay (Q19).
const OLD_SAVED_VIEWS_KEY = 'rabbit_task_saved_views'

// The kit toast stack, or nothing where no ToastProvider is mounted (a test
// that mounts the tab alone): a passing message, never a failure.
function useOptionalToast() {
  try { return useToast() } catch { return null }
}

// VW1m (2026-10-16): grouping by an item kind makes one group per
// combination of a task's items (her Q-D). VW1b (her Q11): Scene, Shot,
// Level and Experience join Asset here exactly where their columns show
// (`kinds`, the task window's picker rule over every task), in the kinds'
// order, where Asset always sat.
function groupableFields(kinds = ['asset']) {
  return [
    { value: '',        label: 'No grouping' },
    { value: 'status',  label: 'Status' },
    ...kinds.map(kind => ({ value: kind, label: KIND_LABEL[kind] })),
    { value: 'phase',   label: 'Phase' },
    { value: 'priority',label: 'Priority' },
    { value: 'assignee',label: 'Assignee' },
  ]
}

/**
 * VW1m (2026-10-16), her Q-D: the groups of the tasks grouped by an item
 * kind, one per COMBINATION (the set of a task's live items of that kind), so
 * a task is in exactly one group and the groups' counts add up to the tasks.
 * Ordered as today: the single items in the project's own order (`rows`),
 * then the combinations (and a single item `rows` does not hold, a scene
 * outside the active shot list) by name A to Z, then "No asset" (or "No
 * scene", …) last. `everySingle` is the Board's (her Q-I: "the Board shows
 * every column"): a column for every single item even when empty, and its
 * "No …" column always, as it had before. Each group carries its `ids`: a
 * drop or a new task there takes exactly those.
 * VW1d (2026-10-25): `everySingle` is also a table view's *Hide empty
 * groups* off (§4.3); `hideEmpty` drops the empty groups. `saved` are the
 * project's groupings of this kind (Q-D2), each `{ id, ids }` with every
 * item live (isGroupingLive): a grouping whose set rows already have IS that
 * group (`groupingId` on it: its *…* removes the grouping, Q-D5); one no row
 * has shows empty, in the place its kind of group takes, and never hides
 * (VW1d step 0, finding 1).
 * VW1e (2026-10-25): the rule lives once, in tableViews/combinationGroups.js,
 * for the four tables her Q-M3 gives it; this is the Tasks table's call.
 */
function itemGroupsOf(kind, tasks, lookup, rows, everySingle = false, saved = [], hideEmpty = false) {
  return combinationGroupsOf({
    kind, rows: tasks, combinationOf: (t) => lookup.combinationOf(t, kind), lookup,
    singles: rows, everySingle, saved, hideEmpty, as: 'tasks',
  })
}

/**
 * A task's live items of a kind by name, joined with ', ' ('' for none): a
 * Board card's words. VW1b: in the task window's Sort, as the table's cell
 * lists them (the design's §4.6: "a card names all its assets, as the cell
 * does").
 */
function itemNamesOf(lookup, task, kind, sort) {
  return sortIdsForDisplay(kind, lookup.idsOf(task, kind), sort, lookup).map(id => lookup.nameOf(kind, id)).join(', ')
}

/**
 * VW1m (2026-10-16), her Q-D1: a task dropped on a combination group takes
 * exactly that group's items of the kind ("No …": none), one undoable write
 * (ctx.setTaskItemsOfKind). Ctrl+Z is not bound on this tab, so the step
 * goes through the shell's undo toast (ctx.runWithUndoToast), whose words
 * are also the polite live region's sentence (the kit toast stack). A drop
 * on the group the task is already in writes nothing.
 * VW1m review round 2 (R2-2): a drop refused or failed is said (`onFail`,
 * the tab's Banner). It was swallowed: the provider's ctx.error is shown on
 * the Scenes tab only, so a refusal left the card where it was, unexplained.
 */
function dropOnItemGroup(ctx, taskId, kind, group, onFail) {
  if (!ctx?.setTaskItemsOfKind || group.tasks.some(t => t.id === taskId)) return
  const task = (ctx.tasks || []).find(t => t.id === taskId)
  const title = task?.title || 'Untitled task'
  const step = ctx.runWithUndoToast || ((run) => run())
  // The toast is the way back from what landed; the refusal is said here.
  Promise.resolve(step(
    () => ctx.setTaskItemsOfKind(taskId, kind, group.ids),
    `Moved "${title}" to ${group.label}`,
  )).catch((err) => onFail?.(`Could not move “${title}”: ${err?.message || err}`))
}

/**
 * The seed a new task made from a group takes. Grouped by an item kind, the
 * group's items: one asset as the popup's own Asset choice (as today), any
 * other group's items carried as they are (NewTaskPopup shows them read-only
 * and passes them as `items`).
 */
function itemGroupDefaults(kind, group) {
  const ids = group.ids || []
  if (ids.length === 0) return {}
  if (kind === 'asset' && ids.length === 1) return { asset_id: ids[0] }
  return { items: { [kind]: ids } }
}

// VW1d: the sorts, filters and their conditions are the table's description
// (views/tableViews/tasksTableView.js), keyed by the columns' keys.

// The body the Table / Board tabs switch (the kit's Tabs wants its panel).
const BODY_ID = 'rb-task-body'

// Sentence-case labels (Q2). A status's words come from the kit's one status
// source (src/ui/StatusDot), so this table, the Dashboard and the popup say
// the same thing; the old `fmt()` lower-cased every one of them. VW1d: the
// lists and their words live with the table's description.
function optionLabel(field, value) {
  if (field === 'status') return STATUS_LABELS[value] || humanizeStatus(value)
  if (field === 'priority') return PRIORITY_LABELS[value] || humanizeStatus(value)
  return fmt(value)
}

// ── Colour ──
// Status and priority colours live in rabbitTasks.css (`.rb-task-status`,
// `.rb-task-priority`): an element carries `data-status` / `data-priority`
// and reads the colour from the sheet, never from an inline style.

function fmt(s) { return (s || '').replace(/_/g, ' ') }

// A stored date (YYYY-MM-DD) as the date inputs beside it show one — the
// system's short date — is `showDate` from dates.js since post-overhaul S1
// (ruling B5: one shared date helper). This file's own copy was the pattern
// that helper took: it read the day the string names. A key date used to
// print its raw ISO string in the mono next to task dates reading 08/03/2026
// (review round one).

// ─────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────
export default function ProjectTasksView() {
  const ctx = useRabbit()
  // Assignee resolution goes through the unified roster (Session 6) —
  // auth users in cloud mode, legacy team members locally. Mirrors
  // TaskDetailPopup so the ids shown here match what it writes to
  // task.assignee_id.
  const { members: rosterMembers, mode: rosterMode } = useRosterMembers()
  const tasks   = ctx?.tasks   || []
  const assets  = ctx?.assets  || []
  const phases  = ctx?.phases  || []
  const project = ctx?.project
  const milestones = ctx?.milestones || []
  const teamAssignments = ctx?.teamAssignments || []

  // Lookups
  // VW1m (2026-10-16): a task's items, read one way (the model's
  // buildItemLookup): its LIVE items only (a row in the trash, or not
  // loaded, is hidden, her Q-N4), each kind in the display order. Where the
  // backend keeps no items the task's own field is its one item.
  const itemLookup = useMemo(() => buildItemLookup({
    items: ctx?.taskItems,
    available: ctx?.taskItemsAvailable === true,
    assets,
    scenes: ctx?.allScenes || ctx?.scenes,
    shots: ctx?.allShots || ctx?.shots,
    levels: ctx?.levels,
    experiences: ctx?.experiences,
  }), [ctx?.taskItems, ctx?.taskItemsAvailable, assets, ctx?.allScenes, ctx?.scenes, ctx?.allShots, ctx?.shots, ctx?.levels, ctx?.experiences])
  // The single items of each kind in the project's own order: a grouping's
  // first groups (the active shot list's scenes and shots, as every tab but
  // Scenes shows them).
  const kindRows = useMemo(() => ({
    asset: assets, scene: ctx?.scenes, shot: ctx?.shots, level: ctx?.levels, experience: ctx?.experiences,
  }), [assets, ctx?.scenes, ctx?.shots, ctx?.levels, ctx?.experiences])
  // VW1b (her Q11): the item columns, and the Group menu's item kinds, are the
  // kinds the project uses — the task window's picker rule (pickerKinds) read
  // over EVERY task's live items, so a column is there exactly when the
  // window would offer its kind. Assets always.
  const itemKinds = useMemo(() => pickerKinds({ project }, ITEM_KINDS
    .filter(kind => tasks.some(t => itemLookup.idsOf(t, kind).length > 0))
    .map(kind => ({ entity_type: kind }))), [project, tasks, itemLookup])
  // The task window's Sort, one store for every reader (her Q10: the cells
  // list a task's items "as the task's window sets them").
  const [itemSort] = useTaskItemSort()

  const phaseById = useMemo(() => {
    const m = {}; for (const p of phases) m[p.id] = p; return m
  }, [phases])

  const memberById = useMemo(() => {
    const m = {}; for (const mb of rosterMembers) m[mb.id] = mb; return m
  }, [rosterMembers])

  const projectMembers = useMemo(() => {
    if (rosterMode === 'supabase') {
      // Cloud — project staffing lives in project_members (auth user_ids).
      // Unstaffed projects fall back to the whole workspace roster.
      if (!ctx?.projectIsStaffed) return rosterMembers
      const staffedIds = new Set((ctx?.projectMembers || []).map(pm => pm.user_id))
      return rosterMembers.filter(m => staffedIds.has(m.id))
    }
    // Local / drive — legacy RABBIT team assignments.
    return teamAssignments.map(a => memberById[a.member_id]).filter(Boolean)
  }, [rosterMode, rosterMembers, ctx?.projectIsStaffed, ctx?.projectMembers, teamAssignments, memberById])

  // ── The view (VW1d): what Filter, Sort, Group, the layout tabs and the
  // Views dropdown's cards change, for the moment (her Q3), until the bar
  // saves it (Q3a). The search is never part of a view (Q8).
  const [search, setSearch]     = useState('')
  const description = useMemo(() => tasksDescription({
    itemKinds, phases, members: projectMembers, lookup: itemLookup, kindRows, itemSort,
  }), [itemKinds, phases, projectMembers, itemLookup, kindRows, itemSort])
  // Who changed a view, by the workspace roster (design §5.5): "Someone"
  // when they are not there.
  const nameOf = useCallback((id) => {
    // Its own entries only: a stored "constructor" is nobody (review round 2, R2-7).
    const m = Object.prototype.hasOwnProperty.call(memberById, id) ? memberById[id] : null
    return m ? (m.name || m.display_name || m.username || null) : null
  }, [memberById])
  const toast = useOptionalToast()
  const notify = useCallback((words) => { toast?.push({ tone: 'info', title: words }) }, [toast])
  const { ask, dialog: askDialog } = useAsk()
  // The table's one polite live region (§4.9): the bar's state, every
  // reorder. Keyed so the same words said twice are said twice.
  const [announcement, setAnnouncement] = useState({ words: '', n: 0 })
  const announce = useCallback((words) => setAnnouncement(a => ({ words, n: a.n + 1 })), [])

  const [showFilterPanel, setShowFilterPanel] = useState(false)
  // VW1m review round 2 (R2-2): a refused or failed drop's sentence, said in
  // the kit Banner above the table or the Board until dismissed (or the next
  // failure replaces it).
  const [dropFailure, setDropFailure] = useState(null)
  // Create grouping's dialog: the kind it makes a grouping of, or null.
  const [groupingKind, setGroupingKind] = useState(null)
  // After Remove grouping: the keyboard to the Group menu (R1-6).
  const [focusGroupMenu, setFocusGroupMenu] = useState(false)
  useEffect(() => {
    if (!focusGroupMenu) return
    document.querySelector('.rb-task-toolbar select[aria-label="Group"]')?.focus({ preventScroll: true })
    setFocusGroupMenu(false)
  }, [focusGroupMenu])
  const focusViews = useCallback(() => {
    document.querySelector('.rb-task-toolbar .rb-tv-button')?.focus({ preventScroll: true })
  }, [])

  // Q17: the old saved views go, once, on the first load after these ship.
  useEffect(() => {
    try { localStorage.removeItem(OLD_SAVED_VIEWS_KEY) } catch { /* storage unavailable: nothing kept to remove */ }
  }, [])

  // Phase creation
  const [showPhaseCreate, setShowPhaseCreate] = useState(false)
  const [newPhaseName, setNewPhaseName] = useState('')

  // Task detail popup
  const [detailTaskId, setDetailTaskId] = useState(null)
  // Session 23: null = closed. An object = the popup is open, seeded with the
  // defaults its trigger passed (group add-rows supply phase_id, the group's
  // items, etc.).
  // Nothing is written until Confirm & Create.
  const [newTaskDraft, setNewTaskDraft] = useState(null)

  // Edit history (Session 5) — DB-side RLS is the real gate; this only
  // hides the affordance below manager.
  const { can, role, ready: permsReady } = usePermissions()
  const canViewHistory = can('rabbit.history.view')
  const [historyTaskId, setHistoryTaskId] = useState(null)

  // Ruling 38's "Recently deleted" panel for key dates, SECOND mount.
  // Audrey, 2026-09-07: "the Recently Deleted panel for key dates appears on
  // the Tasks tab as well as the Timeline". A2 session 2 put it only on the
  // Timeline and its walkthrough asked her whether she wanted it here too.
  // She does.
  //
  // A second mount rather than a lift into the shell: the two views are
  // siblings under the same RabbitProvider, the panel owns all of its own
  // state (it re-lists on every open, with a sequence guard), and hoisting it
  // would mean threading `open` through the project shell for one button. The
  // component is the shared thing; the mount is per surface, the same shape
  // TaskDetailPopup already has here and in TimelineView.
  const [trashOpen, setTrashOpen] = useState(false)

  // Entity writes (Session 6) — DB-side RLS is the real gate; this only
  // hides write affordances for staffed-project reviewers.
  // `ready` matters: without it, a session read still in flight leaves `role`
  // null and every New task affordance in this view — toolbar, add-rows,
  // per-group rows, row menu, both kanban adds — silently disappears.
  //
  // Session 29 — these controls used to VANISH when canWrite was false. They
  // now stay visible, greyed, and say why (Audrey, 2026-08-04: "keep button
  // gray and explain why"), so this screen and the Timeline behave the same
  // way. `writeReason` reaches the leaves through WriteReasonProvider below
  // rather than eight more prop signatures.
  const writeGateCtx = {
    appRole: role,
    projectRole: ctx?.myProjectRole,
    isStaffed: ctx?.projectIsStaffed,
    ready: permsReady,
  }
  const canWrite = canOnProject(writeGateCtx, 'project.entity.write')
  const writeReason = projectActionDeniedReason(writeGateCtx, 'project.entity.write')

  // VW1d: the Views dropdown's seat rule is the table's (Q2: anyone who can
  // edit the project saves views; Q-F: a seat that cannot write sees no
  // editing control).
  const tv = useTableView({ ctx, tableKey: TASKS_TABLE, description, canWrite, nameOf, notify })
  const config = tv.config
  const viewMode = config.layout === 'board' ? 'kanban' : 'table'
  const filters = config.filters || []
  const sorts = config.sorts || []
  // The FIRST sort does what the one sort did besides ordering the rows: it
  // orders the Phase groups and places the key dates (finding 5). The first
  // the table can sort by: one on a field it lacks (a view sorted by Scene
  // on a project without scenes) sorts nothing, and the toolbar does not
  // show it as a sort (code review round 2, R2-4).
  const firstSort = sorts.find(s => s && description.field(s.field)?.sortable) || null
  const sortField = firstSort?.field || ''
  const sortDir = firstSort?.dir === 'desc' ? 'desc' : 'asc'
  const groupBy = groupToTab(config.group?.field)
  const kanbanGroup = groupToTab(config.board?.field) || 'status'
  const tableHideEmpty = config.group ? config.group.hideEmpty !== false : true
  const boardHideEmpty = config.board?.hideEmpty === true
  const setViewMode = (mode) => tv.update(c => ({ ...c, layout: mode === 'kanban' ? 'board' : 'table' }))
  const setGroupBy = (value) => tv.update(c => {
    const field = groupFromTab(value)
    return { ...c, group: field ? { field, hideEmpty: description.hideEmptyDefault('table', field) } : null }
  })
  const setKanbanGroup = (value) => tv.update(c => {
    const field = groupFromTab(value) || 'status'
    return { ...c, board: { field, hideEmpty: description.hideEmptyDefault('board', field) } }
  })
  const setSortField = (field) => tv.update(c => ({ ...c, sorts: withFirstSort(c.sorts, field) }))
  const reverseSort = () => tv.update(c => ({ ...c, sorts: withFirstSortReversed(c.sorts, s => !!description.field(s.field)?.sortable) }))
  // VW1b: the Group menu offers the item kinds the project uses; a grouping
  // whose kind it no longer offers (its column gone) reads as the default.
  // VW1d: read, not written back — a view keeps its grouping (VW1b R1-10's
  // write-back would make opening a view on such a project a change).
  const groupFields = useMemo(() => groupableFields(itemKinds), [itemKinds])
  const boardFields = useMemo(() => groupFields.filter(f => f.value !== ''), [groupFields])
  const tableGroup = groupFields.some(f => f.value === groupBy) ? groupBy : ''
  const boardGroup = boardFields.some(f => f.value === kanbanGroup) ? kanbanGroup : 'status'
  // VW1b review round 1 (R1-10), as VW1d keeps it: in a CHANGE FOR NOW such
  // a grouping is forgotten, not kept aside (kept, the table regrouped by
  // itself the moment a task named that kind again, and a Save stored a
  // grouping the screen did not show). A saved view keeps its own: it reads
  // as none until the column is back, and opening it is never a change.
  const fromDraft = tv.fromDraft
  const update = tv.update
  useEffect(() => {
    if (!fromDraft) return
    if (groupBy && groupBy !== tableGroup) update(c => ({ ...c, group: null }))
    if (kanbanGroup !== boardGroup) update(c => ({ ...c, board: { field: 'status', hideEmpty: description.hideEmptyDefault('board', 'status') } }))
  }, [fromDraft, groupBy, tableGroup, kanbanGroup, boardGroup, update, description])

  // Collapsed groups
  const [collapsedGroups, setCollapsedGroups] = useState(new Set())
  function toggleGroup(key) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── Filtering ── (VW1d: the view's filters, every one that is complete
  // must match, a condition matching any of its values — her Q13; a row with
  // no value yet filters nothing, defect 1. The search is the tab's own.)
  const applyFilters = useCallback((taskList) => {
    let result = taskList
    const s = search.trim().toLowerCase()
    if (s) result = result.filter(t => (t.title || '').toLowerCase().includes(s))
    return applyViewFilters(result, filters, description)
  }, [search, filters, description])

  // ── Sorting ── (VW1d: several, in order, Q14)
  const applySort = useCallback((taskList) => applyViewSorts(taskList, sorts, description), [sorts, description])

  const processed = useMemo(() => applySort(applyFilters(tasks)), [tasks, applyFilters, applySort])

  // (The CSV export, handleExportCsv, is below the view's columns, which it
  // writes since R1: a dependency list is read during render.)

  // ── All milestones (user + project bounds) ──
  const allMilestones = useMemo(() => {
    const list = [...milestones]
    if (project?.start_date) {
      list.push({ id: '__project_start__', title: 'Project start', date: project.start_date, color: 'var(--color-success)', isProjectBound: true })
    }
    if (project?.end_date) {
      list.push({ id: '__project_end__', title: 'Project end', date: project.end_date, color: 'var(--color-danger)', isProjectBound: true })
    }
    return list
  }, [milestones, project?.start_date, project?.end_date])

  // The project's groupings of a kind (her Q-D2), each with every item
  // live: one hides while an item is in the trash (her Q-N4, isGroupingLive).
  const savedOf = useCallback((kind) => {
    const list = typeof ctx?.groupingsOf === 'function' ? ctx.groupingsOf(TASKS_TABLE, kind) : []
    return list.filter(g => isGroupingLive(g, itemLookup.isLive)).map(g => ({ id: g.id, ids: g.entity_ids }))
  }, [ctx, itemLookup])

  // ── Grouping (table) ──
  // VW1d: the view's *Hide empty groups* (her Q15; Q-I's default per field:
  // off for Status, on for the rest — finding 12). Off, every group the
  // field can have shows (every status, priority, phase, member the Assignee
  // cell offers, single live item, and "No …"/Unassigned); on, only those
  // that hold a task — never a project grouping (finding 1).
  const groups = useMemo(() => {
    const g = tableGroup
    if (!g) return null
    // VW1m: an item kind groups by combination (itemGroupsOf), never by a
    // task's first item.
    if (isItemKind(g)) return itemGroupsOf(g, processed, itemLookup, kindRows[g], !tableHideEmpty, savedOf(g), tableHideEmpty)
    const map = {}
    for (const t of processed) {
      let key
      if (g === 'status')   key = t.status || 'waiting_to_start'
      else if (g === 'phase')    key = t.phase_id || '__none__'
      else if (g === 'priority') key = t.priority || 'medium'
      else if (g === 'assignee') key = t.assignee_id || '__none__'
      else key = '__all__'
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    const keep = (k) => !tableHideEmpty || !!map[k]
    // Ordered keys
    let orderedKeys
    if (g === 'status')   orderedKeys = TASK_STATUSES.filter(s => map[s])
    else if (g === 'priority') orderedKeys = PRIORITIES.filter(keep)
    else if (g === 'phase') {
      // When sorting is active, sort phases by the sort field too
      let phaseOrder = phases.map(p => p.id).filter(keep)
      if (sortField && (sortField === 'start_date' || sortField === 'end_date' || sortField === 'title' || sortField === 'created_at')) {
        const dir = sortDir === 'desc' ? -1 : 1
        phaseOrder.sort((a, b) => {
          const pa = phaseById[a], pb = phaseById[b]
          if (!pa || !pb) return 0
          let va, vb
          if (sortField === 'start_date') { va = pa.start_date || ''; vb = pb.start_date || '' }
          else if (sortField === 'end_date') { va = pa.end_date || ''; vb = pb.end_date || '' }
          else if (sortField === 'title') { va = (pa.name || '').toLowerCase(); vb = (pb.name || '').toLowerCase() }
          else { va = pa.created_at || ''; vb = pb.created_at || '' }
          if (va < vb) return -1 * dir
          if (va > vb) return 1 * dir
          return 0
        })
      }
      orderedKeys = phaseOrder
      if (keep('__none__')) orderedKeys.push('__none__')
    } else if (g === 'assignee') {
      orderedKeys = projectMembers.map(m => m.id).filter(keep)
      if (keep('__none__')) orderedKeys.push('__none__')
    } else {
      orderedKeys = Object.keys(map)
    }
    // The Status grouping's empty groups after the full ones, as it always
    // showed them (the switch off, its default); on, none.
    if (g === 'status' && !tableHideEmpty) TASK_STATUSES.forEach(s => { if (!orderedKeys.includes(s)) orderedKeys.push(s) })
    return orderedKeys.map(key => ({
      key,
      label: resolveGroupLabel(g, key),
      tasks: map[key] || [],
    }))
  }, [processed, tableGroup, tableHideEmpty, phases, projectMembers, phaseById, memberById, sortField, sortDir, itemLookup, kindRows, savedOf])

  // Kanban groups. VW1d: the Board's *Hide empty groups* (off by default:
  // her Q-I, "the Board shows every column").
  const kanbanGroups = useMemo(() => {
    const g = boardGroup
    // VW1m: a column per single item even when empty (her Q-I), a column per
    // combination that holds tasks, and "No …".
    if (isItemKind(g)) return itemGroupsOf(g, processed, itemLookup, kindRows[g], !boardHideEmpty, savedOf(g), boardHideEmpty)
    const map = {}
    for (const t of processed) {
      let key
      if (g === 'status')   key = t.status || 'waiting_to_start'
      else if (g === 'phase')    key = t.phase_id || '__none__'
      else if (g === 'priority') key = t.priority || 'medium'
      else if (g === 'assignee') key = t.assignee_id || '__none__'
      else key = '__all__'
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    let orderedKeys
    if (g === 'status')   orderedKeys = [...TASK_STATUSES]
    else if (g === 'priority') orderedKeys = [...PRIORITIES]
    else if (g === 'phase') {
      orderedKeys = phases.map(p => p.id)
      orderedKeys.push('__none__')
    } else if (g === 'assignee') {
      orderedKeys = projectMembers.map(m => m.id)
      orderedKeys.push('__none__')
    } else {
      orderedKeys = Object.keys(map)
    }
    if (boardHideEmpty) orderedKeys = orderedKeys.filter(k => map[k])
    return orderedKeys.map(key => ({
      key,
      label: resolveGroupLabel(g, key),
      tasks: map[key] || [],
    }))
  }, [processed, boardGroup, boardHideEmpty, phases, projectMembers, phaseById, memberById, itemLookup, kindRows, savedOf])


  function resolveGroupLabel(field, key) {
    if (key === '__none__') return 'Unassigned'
    if (field === 'phase')    return phaseById[key]?.name || key
    if (field === 'assignee') return memberById[key]?.name || key
    return optionLabel(field, key)
  }

  // ── Task creation ──
  // Session 23: open a draft popup; write nothing until the user confirms.
  // Audrey asked for this shape explicitly, matching New Asset — "nothing is
  // saved until you confirm". The first cut created the row and then opened
  // the detail popup on it, which left an untitled task behind whenever the
  // popup was dismissed.
  //
  // Every add affordance routes through here — the toolbar, the table
  // add-rows, the per-group rows and both kanban adds — so the group defaults
  // those triggers pass (phase_id when grouped by phase, the group's items
  // when grouped by an item kind, and so on) become the popup's seed values
  // rather than being written blind.
  function handleAddTask(defaults = {}) {
    if (!ctx?.addTask) return
    setNewTaskDraft(defaults || {})
  }

  // ── Phase creation ──
  async function handleCreatePhase() {
    if (!newPhaseName.trim() || !ctx?.addPhase) return
    await ctx.addPhase({ name: newPhaseName.trim() })
    setNewPhaseName('')
    setShowPhaseCreate(false)
  }

  // ── The Filter strip (VW1d): the view's filters in the shared row
  // (views/tableViews/ViewFilterRow.jsx), the Filters card's own. A new row
  // is the first field's first condition and no value: it filters nothing
  // and is not counted until it has one (defect 1).
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

  // ── The project's groupings (VW1d; her Q-D2, Q-D3, Q-D5) ──
  // Create grouping: beside the Group menu while the layout on screen is
  // grouped by a linked kind, for a seat that may save views (Q-F).
  const groupedKind = viewMode === 'kanban' ? (isItemKind(boardGroup) ? boardGroup : null) : (isItemKind(tableGroup) ? tableGroup : null)
  async function createGrouping(kind, ids) {
    await ctx.addItemGrouping({ tableKey: TASKS_TABLE, kind, entityIds: ids })
  }
  // A group's … → Remove grouping, asked first; rows keep their items, and a
  // group that holds rows stays, as any combination with rows does. A
  // removal the cloud's policies dropped is said (GROUPINGS_GATE_WORDS).
  async function removeGrouping(group) {
    const yes = await ask({
      title: `Remove the grouping ${group.label}?`,
      body: 'Its tasks keep their items. The group stays while tasks are in it.',
      confirm: 'Remove grouping',
      danger: true,
    })
    if (!yes) return
    try {
      const res = await ctx.removeItemGrouping(group.groupingId)
      if (res && res.removed === false && res.status === 'filtered') setDropFailure(GROUPINGS_GATE_WORDS)
      // The group's … is gone with the grouping (and, empty, the group):
      // the keyboard goes to the Group menu, after the question has closed
      // (code review round 1, R1-6: it fell to <body>).
      else setFocusGroupMenu(true)
    } catch (err) {
      setDropFailure(`Could not remove the grouping ${group.label}: ${err?.message || err}`)
    }
  }

  // ── What the view shows (VW1d) ──
  // *Filter (n)* counts only the rows that filter (defect 1).
  const activeFilters = filterCount(filters, description)
  // The columns: the view's fields over the columns the project uses, in its
  // order, the hidden ones out (her Q6, Q7); the Title first, always shown.
  const fieldList = useMemo(() => effectiveFields(config.fields, description.fieldKeys, { fixed: description.fixed }), [config.fields, description])
  const columns = useMemo(() => fieldList.filter(f => f.visible).map(f => description.columns.find(c => c.key === f.key)).filter(Boolean), [fieldList, description])
  // The Board's card: its own fields the view does not hide (her Q-E; finding 6).
  const cardShows = useMemo(() => new Set(fieldList.filter(f => f.visible && CARD_FIELDS.includes(f.key)).map(f => f.key)), [fieldList])

  // ── CSV export (Session 14, Block B) — exports the CURRENT view
  // (filters + sort applied): what you see is what you get. Tasks carry
  // no rate/budget data, so every project reader may export them; the
  // rows themselves arrived through RLS-scoped reads.
  // R1 (2026-10-27; OUTSTANDING's "The Tasks CSV export leaves out the asset
  // and the bid, and writes statuses as stored"): the file's columns are the
  // table's — the view's visible fields in its order, named as the table names
  // them, an item column per kind the project uses and the Bid among them —
  // then Notes and Created, which the file has always carried. Status and
  // Priority in the table's words (In progress, not in_progress); an item
  // cell names its items as the cell does, in the task window's Sort.
  const handleExportCsv = useCallback(() => {
    const memberName = (id) => {
      const m = memberById[id]
      return m ? (m.display_name || m.name || m.username || '') : ''
    }
    const shown = (col, t) => {
      if (col.kind) return itemNamesOf(itemLookup, t, col.kind, itemSort)
      switch (col.key) {
        case 'status':      return t.status ? optionLabel('status', t.status) : ''
        case 'priority':    return t.priority ? optionLabel('priority', t.priority) : ''
        case 'phase_id':    return phaseById[t.phase_id]?.name || ''
        case 'assignee_id': return memberName(t.assignee_id)
        default:            return t[col.key] ?? ''
      }
    }
    const stem = (project?.title || 'project').replace(/[^\w.-]+/g, '_')
    downloadCsv(`${stem}-tasks-${exportDateStamp()}.csv`, processed, [
      ...columns.map(col => ({ key: col.key, header: col.label, map: t => shown(col, t) })),
      { key: 'notes',      header: 'Notes' },
      { key: 'created_at', header: 'Created' },
    ])
  }, [processed, columns, memberById, phaseById, itemLookup, itemSort, project?.title])

  // The count's least width in characters ("12/240" at the total's digits).
  const countChars = String(tasks.length).length * 2 + 1


  // ── Summary computations ──
  const taskSummary = useMemo(() => {
    const completed = tasks.filter(t => t.status === 'approved' || t.status === 'final').length
    const omitted = tasks.filter(t => t.status === 'omitted').length
    const remaining = tasks.length - completed - omitted

    // Post-overhaul S1 (rulings B3, B5): the two day tiles are dates.js's
    // projectDayCounts — the project's dates read as the local days they
    // name (`new Date('2026-12-01')` is the 30th here), counted on the local
    // calendar (`Math.ceil` made the hour a daylight-saving change adds a
    // day; for a December end seen in September the two errors cancelled).
    const { daysRemaining, daysPassed } = projectDayCounts(project, new Date())

    return { remaining, completed, daysRemaining, daysPassed }
  }, [tasks, project?.start_date, project?.end_date])

  // ── Render ──
  // P1-74: the kit EmptyState in sentence case, as every R.A.B.B.I.T. view
  // draws it; it was a capitalised Label-step span.
  if (!project) {
    return (
      <div className="rb-task-view h-full flex items-center justify-center">
        <EmptyState Icon={ListChecks} title="No project loaded" />
      </div>
    )
  }

  return (
    <WriteReasonProvider reason={writeReason}>
    <div className="rb-task-view h-full flex flex-col">

      {/* ── The table's one polite live region (VW1d, design §4.9): the
          bar's state and every reorder, always mounted. ── */}
      <p className="sr-only" role="status" aria-live="polite">
        <span key={announcement.n}>{announcement.words}</span>
      </p>

      {/* ── Summary tiles (always visible): the kit's Stat, value under its
          label, the same tile Summary's band uses (review R19, R43). ── */}
      <div className="rb-task-stats">
        <Stat className="rb-task-stat" label="Tasks remaining" value={taskSummary.remaining} />
        <Stat className="rb-task-stat" label="Days remaining" value={taskSummary.daysRemaining} />
        <Stat className="rb-task-stat" label="Tasks completed" value={taskSummary.completed} valueTone="success" />
        <Stat className="rb-task-stat" label="Days passed" value={taskSummary.daysPassed} />
      </div>

      {/* ── Toolbar: every control the 28px sm height, one baseline (R14).
          It wraps rather than clipping below about 1300px: thirteen controls
          do not fit one row at Electron's 1024px floor. ── */}
      <Toolbar
        wrap
        className="rb-task-toolbar"
        right={(
          <>
            {/* VW1d (design §4.1): a minimum width from the total's digits,
                so filtering never re-wraps the toolbar. */}
            <span className="rb-task-count" style={{ '--rb-task-count-ch': countChars }}>
              {processed.length}/{tasks.length}
            </span>

            {/* Export the current view (Session 14) — one button beside the
                existing toolbar, no new nav (session UI-restraint rule). */}
            <Button
              size="sm"
              variant="ghost"
              Icon={Download}
              onClick={handleExportCsv}
              disabled={processed.length === 0}
              title={processed.length === 0 ? 'Nothing to export in the current view' : 'Export the current view as CSV'}
            >
              Export
            </Button>

            {/* Ruling 38 on the Tasks tab (Audrey, 2026-09-07).

                🚨 THE LABEL IS NOT THE TIMELINE'S. There the toolbar is all key
                dates and phases, so `Deleted` can only mean one thing; here the
                screen is TASKS, and a bare `Deleted` would read as "deleted
                tasks" — which this panel does not show and nothing else does
                either. Tasks have their own undo toast and no trash panel, so
                the ambiguity would be a promise the product cannot keep.

                Not gated, exactly as on the Timeline: reading the trash is a
                read, and the Restore button inside carries its own gate. */}
            <Button size="sm" variant="ghost" Icon={Trash2} onClick={() => setTrashOpen(true)} title="Recently deleted key dates">
              Deleted key dates
            </Button>

            {/* VW1d, her Q-A1 ("One 'New' button with a menu"): Phase, Key
                date and New task are one primary *New* whose menu holds Task,
                Phase and Key date (the kit MenuButton, VW1-KR-3). The three
                share one gate and its reason (Session 29: greyed, never
                gone). The room it frees goes to the Views button's name and
                to *Create grouping*. */}
            <GatedAction allowed={canWrite}>
              <MenuButton
                label="New"
                variant="primary"
                ButtonIcon={Plus}
                minWidth={160}
                items={[
                  { label: 'Task', Icon: Plus, onClick: () => handleAddTask() },
                  { label: 'Phase', Icon: Plus, onClick: () => setShowPhaseCreate(true) },
                  // S1 (B3): today's LOCAL date; `toISOString()` is UTC, so an
                  // Eastern evening made the key date on tomorrow.
                  { label: 'Key date', Icon: Diamond, onClick: () => ctx?.addMilestone?.({ title: '', date: toIsoDate(new Date()) }) },
                ]}
              />
            </GatedAction>
          </>
        )}
      >
        {/* Filter: counts only the rows that filter (defect 1). */}
        <Button
          size="sm"
          Icon={Filter}
          className="rb-task-tool"
          data-active={activeFilters > 0 ? 'true' : 'false'}
          aria-expanded={showFilterPanel}
          onClick={() => setShowFilterPanel(!showFilterPanel)}
        >
          Filter{activeFilters > 0 ? ` (${activeFilters})` : ''}
        </Button>

        {/* Sort: sets the view's FIRST sort (her Q14); the Sort card holds the rest. */}
        <span className="rb-task-sort">
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            aria-label="Sort"
            className="ui-input rb-task-tool"
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

        <span className="rb-task-divider" aria-hidden="true" />

        {/* Group: the table's grouping or the Board's columns (her Q-C). */}
        <select value={viewMode === 'kanban' ? boardGroup : tableGroup}
          onChange={e => viewMode === 'kanban' ? setKanbanGroup(e.target.value) : setGroupBy(e.target.value)}
          aria-label="Group"
          className="ui-input rb-task-tool"
          data-size="sm"
          data-active={(viewMode === 'kanban' ? boardGroup !== 'status' : !!tableGroup) ? 'true' : 'false'}>
          {(viewMode === 'kanban' ? boardFields : groupFields).map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        {/* VW1d, her Q-D3 ("In the toolbar"): Create grouping, beside the
            Group menu, only while the layout on screen is grouped by a
            linked kind, and only for a seat that may save views (Q-F). */}
        {groupedKind && tv.canEdit && (
          <Button size="sm" Icon={Group} onClick={() => setGroupingKind(groupedKind)}>
            Create grouping
          </Button>
        )}

        <span className="rb-task-divider" aria-hidden="true" />

        {/* Table / Board — the kit's Tabs: one underline, no orange fill
            under 13px text (C6; review R14). The layout is part of a view
            (her Q8): switching it is a change for now (finding 13). */}
        <Tabs
          label="Layout"
          panelId={BODY_ID}
          items={[{ id: 'table', label: 'Table' }, { id: 'kanban', label: 'Board' }]}
          value={viewMode}
          onChange={setViewMode}
        />

        {/* VW1d: the Views button and its dropdown (design §4.1, §4.2). */}
        <TableViewsMenu tv={tv} description={description} ask={ask} announce={announce}
          onRetry={typeof ctx?.reloadActiveProject === 'function' ? () => ctx.reloadActiveProject() : null} />

        <span className="rb-task-divider" aria-hidden="true" />

        {/* Search: the tab's own, never part of a view (her Q8). */}
        <span className="rb-task-search">
          <Search className="rb-task-search-icon" aria-hidden="true" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="ui-input rb-task-search-input"
            data-size="sm" />
          {search && (
            <IconButton size="sm" Icon={X} title="Clear search" className="rb-task-search-clear" onClick={() => setSearch('')} />
          )}
        </span>
      </Toolbar>

      {/* ── The Filter strip: the view's filters in the shared row (VW1d;
          the Filters card draws the same row, design §4.3). ── */}
      {showFilterPanel && (
        <div className="rb-task-filters">
          {filters.map((f, i) => (
            <ViewFilterRow key={i} row={f} index={i} description={description}
              onChange={(row) => updateFilter(i, row)} onRemove={() => removeFilter(i)} />
          ))}
          <div className="rb-task-filter-actions">
            <Button size="sm" Icon={Plus} onClick={addFilter}>Add filter</Button>
            {filters.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setShowFilterPanel(false)}>Done</Button>
            )}
          </div>
        </div>
      )}

      {/* ── A drop that did not land, said (review round 2, R2-2) ── */}
      {dropFailure && (
        <Banner
          tone="danger"
          action={<IconButton size="sm" Icon={X} title="Dismiss" onClick={() => setDropFailure(null)} />}
        >
          {dropFailure}
        </Banner>
      )}

      {/* ── The *changed for now* bar (VW1d, design §4.4): only while the
          view on screen has a change of one's own, directly above the
          table. ── */}
      <ViewBar tv={tv} ask={ask} announce={announce} focusViews={focusViews} />

      {/* ── Body ── */}
      <div className="rb-task-body" id={BODY_ID} role="tabpanel" aria-label={viewMode === 'table' ? 'Table' : 'Board'}>
        {tv.waiting ? (
          // The last used view not known yet (its 2s wait, design §4.5):
          // the kit Loading line, the toolbar working.
          <div className="rb-task-waiting"><Loading label="Loading views" /></div>
        ) : viewMode === 'table' ? (
          <TaskTable
            tasks={processed}
            hasAnyTask={tasks.length > 0}
            groups={groups}
            groupBy={tableGroup}
            columns={columns}
            itemSort={itemSort}
            itemLookup={itemLookup}
            phases={phases}
            members={projectMembers}
            phaseById={phaseById}
            collapsedGroups={collapsedGroups}
            toggleGroup={toggleGroup}
            ctx={ctx}
            canWrite={canWrite}
            canEditViews={tv.canEdit}
            onAddTask={handleAddTask}
            onDetailClick={(id) => setDetailTaskId(id)}
            onHistoryClick={canViewHistory ? (id) => setHistoryTaskId(id) : null}
            milestones={config.keyDates === false ? [] : allMilestones}
            sortField={sortField}
            sortDir={sortDir}
            onDropFail={setDropFailure}
            onRemoveGrouping={removeGrouping}
          />
        ) : (
          <KanbanBoard
            groups={kanbanGroups}
            kanbanGroup={boardGroup}
            itemSort={itemSort}
            itemLookup={itemLookup}
            memberById={memberById}
            cardShows={cardShows}
            ctx={ctx}
            canWrite={canWrite}
            canEditViews={tv.canEdit}
            onAddTask={handleAddTask}
            onDetailClick={(id) => setDetailTaskId(id)}
            onDropFail={setDropFailure}
            onRemoveGrouping={removeGrouping}
          />
        )}
      </div>

      {/* ── The views' questions (Delete a view, Save over a teammate's,
          Remove grouping), at the view's root (design §4.2, finding 18). ── */}
      {askDialog}

      {/* ── Create grouping (VW1d, design §4.11): its kit Dialog. ── */}
      {groupingKind && (
        <CreateGroupingDialog
          tableKey={TASKS_TABLE}
          kind={groupingKind}
          singular={KIND_LABEL[groupingKind]}
          plural={KIND_LABEL_PLURAL[groupingKind]}
          options={description.options(groupingKind)}
          orderOf={itemLookup.orderOf}
          nameOf={itemLookup.nameOf}
          groupings={typeof ctx?.groupingsOf === 'function' ? ctx.groupingsOf(TASKS_TABLE, groupingKind) : []}
          onCreate={(ids) => createGrouping(groupingKind, ids)}
          onClose={() => setGroupingKind(null)}
        />
      )}

      {/* ── Phase create dialog ── */}
      {showPhaseCreate && (
        <Dialog
          width="confirm"
          title="Create phase"
          dismissOnBackdrop
          onClose={() => setShowPhaseCreate(false)}
          footer={(
            <>
              <Button onClick={() => setShowPhaseCreate(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleCreatePhase}>Create</Button>
            </>
          )}
        >
          <input autoFocus type="text" value={newPhaseName} onChange={e => setNewPhaseName(e.target.value)}
            placeholder="Phase name…"
            aria-label="Phase name"
            onKeyDown={e => { if (e.key === 'Enter') handleCreatePhase() }}
            className="ui-input" />
        </Dialog>
      )}

      {/* ── New task popup (Session 23) — drafts locally, commits on confirm ── */}
      {newTaskDraft && (
        <NewTaskPopup
          ctx={ctx}
          defaults={newTaskDraft}
          phases={phases}
          assets={assets}
          itemLookup={itemLookup}
          members={projectMembers}
          onCreated={() => setNewTaskDraft(null)}
          onClose={() => setNewTaskDraft(null)}
        />
      )}

      {/* ── Task detail popup ── */}
      {detailTaskId && (
        <TaskDetailPopup
          taskId={detailTaskId}
          ctx={ctx}
          onClose={() => setDetailTaskId(null)}
        />
      )}

      {/* ── Edit history drawer ── */}
      {historyTaskId && (
        <EditHistoryDrawer
          entityType="tasks"
          entityId={historyTaskId}
          entityLabel={tasks.find(t => t.id === historyTaskId)?.title}
          onClose={() => setHistoryTaskId(null)}
        />
      )}

      {/* ── Recently deleted key dates (ruling 38; Audrey, 2026-09-07) ──
          Every prop is the Timeline's, deliberately: the two mounts must
          answer identically or the same key date would restore from one
          screen and not the other. `purgeScheduled` is a CLOUD fact —
          purge_soft_deleted runs on pg_cron there (0014 §4) and nothing
          purges on Local Server, so the panel must not promise a deadline
          the desktop will never meet. */}
      <MilestoneTrashModal
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        onList={ctx?.listTrashedMilestones}
        onRestore={ctx?.restoreMilestone}
        canWrite={canWrite}
        writeReason={writeReason}
        purgeScheduled={ctx?.adapterMode !== 'local_server'}
        adapterMode={ctx?.adapterMode}
      />
    </div>
    </WriteReasonProvider>
  )
}


// ═════════════════════════════════════════════════════
// TABLE VIEW — the kit's Table (a real <table>, fixed layout, dense rows)
// ═════════════════════════════════════════════════════
// The header and the cells share one grid, so the header labels sit over
// their columns again: the flex version put rows 12px (24px when grouped)
// right of their own headers (review R05). Widths are the sheet's
// (`.rb-task-table-wrap`): px for the columns whose content has a known
// width (982px with the checkbox), and the title takes the rest up to its
// maximum (360px), never less than 256px; past the maximum Asset, Phase and
// Assignee share what is left (FX8: "the cell/section for the title is sooo
// wide"). Below 1238px of table the view scrolls sideways (only at
// Electron's 1024px floor, a scrollbar of up to 18px allowed for at 1280)
// rather than wrapping a date mid-token (V1-06) or starving the title. A row's buttons sit in the title cell, right after its
// words (FX8, the kit's RowTitle): there is no actions column.
// VW1b (2026-10-17): the columns are tasksTableColumns' (an item column per
// kind the project uses, after Priority), the fixed sum and the growable count
// from the columns on screen (widthStyle, the design's §4.10); with every
// column on, the table scrolls sideways with the checkbox and Title kept in
// place (stickyColumns, her Q6a), and an item cell's picker is the table's
// (useItemPicker: a cell's row moves group after its commit).
// VW1d (2026-10-25): the columns are the view's (its fields' order and
// visibility over tasksTableColumns, her Q6 and Q7), the Title always first
// for the sticky columns; with no growable one shown, `data-grow="none"`.
function TaskTable({ tasks, hasAnyTask = false, groups, groupBy, itemLookup, columns: shown = null, itemSort = 'type', phases, members, phaseById, collapsedGroups, toggleGroup, ctx, canWrite, canEditViews = false, onAddTask, onDetailClick, onHistoryClick, milestones = [], sortField, sortDir, onDropFail, onRemoveGrouping }) {
  const columns = useMemo(() => shown || tasksTableColumns(['asset']), [shown])
  const widths = useMemo(() => tasksTableWidths(columns), [columns])
  // The checkbox column plus the columns above: what a spanning cell spans.
  const span = columns.length + 1
  const wrapRef = useRef(null)
  const picker = useItemPicker({ ctx, lookup: itemLookup, tableRef: wrapRef, onFail: onDropFail })

  // ── Multi-select state ──
  const [selected, setSelected] = useState(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const guard = useDependencyStatusGuard(ctx)
  const allTaskIds = useMemo(() => {
    if (groups) return groups.flatMap(g => g.tasks.map(t => t.id))
    return tasks.map(t => t.id)
  }, [groups, tasks])
  const allSelected = allTaskIds.length > 0 && allTaskIds.every(id => selected.has(id))
  const someSelected = selected.size > 0

  function toggleOne(id) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(allTaskIds))
  }
  function clearSelection() { setSelected(new Set()) }
  // A bulk status change gets ONE warning naming every selected task with an
  // unfinished predecessor, then continues if asked. The selection is cleared
  // only when the write goes ahead, so "Go back" leaves the person exactly
  // where they were.
  function bulkUpdate(patch) {
    const ids = [...selected]
    guard.update({
      ids, patch,
      write: () => {
        for (const id of ids) ctx?.updateTask?.(id, patch)
        clearSelection()
      },
    })
  }
  // Bulk keeps its confirm (large blast radius); single rows rely on undo.
  // W9: the confirm is the kit's Dialog now, not window.confirm.
  function bulkDelete() {
    setConfirmBulkDelete(true)
  }
  function confirmedBulkDelete() {
    setConfirmBulkDelete(false)
    // Batch deletes reject on partial failure — the provider already
    // records the error in its state, so just swallow the rejection.
    ctx?.deleteTasks?.([...selected])?.catch(() => {})
    clearSelection()
  }

  if (tasks.length === 0 && (!groups || groups.length === 0)) {
    return (
      hasAnyTask ? (
        <EmptyState
          Icon={ListChecks}
          title="No tasks match these filters"
          body="Clear the search or a filter to see them again"
        />
      ) : (
        <EmptyState
          Icon={ListChecks}
          title="No tasks yet"
          body="Create a task to get started"
        />
      )
    )
  }

  const rowProps = {
    columns, itemLookup, itemSort, phases, members, ctx, canWrite,
    picking: picker.picking, onOpenItems: picker.open, draftStore: picker.store,
  }
  const taskRow = (t, drop) => (
    <TaskRow key={t.id} task={t} {...rowProps} drop={drop}
      onDetailClick={() => onDetailClick?.(t.id)}
      onHistoryClick={onHistoryClick ? () => onHistoryClick(t.id) : null}
      isSelected={selected.has(t.id)} onToggleSelect={() => toggleOne(t.id)} />
  )
  const milestoneRow = (ms) => (
    <MilestoneRow key={`ms-${ms.id}`} milestone={ms} columns={columns} canWrite={canWrite}
      ctx={ctx} />
  )

  // Milestone rows + task rows. When sorting by a date field, milestones are
  // interleaved at their correct chronological position. Otherwise they
  // render as a block above the tasks.
  let body
  if (groups) {
    body = (
      <>
        {milestones.map(ms => milestoneRow(ms))}
        {groups.map(g => (
          <TaskGroup key={g.key} group={g} groupBy={groupBy} span={span}
            phaseById={phaseById}
            collapsed={collapsedGroups.has(g.key)} onToggle={() => toggleGroup(g.key)}
            ctx={ctx} canWrite={canWrite} canEditViews={canEditViews} onAddTask={onAddTask}
            renderTask={taskRow} onDropFail={onDropFail} onRemoveGrouping={onRemoveGrouping} />
        ))}
      </>
    )
  } else {
    // When sorted by date, interleave milestones chronologically
    const dateSort = sortField === 'start_date' || sortField === 'end_date'
    let rows
    if (dateSort && milestones.length > 0) {
      const dir = sortDir === 'desc' ? -1 : 1
      // Build a merged array of { type: 'task'|'milestone', item }
      const merged = [
        ...tasks.map(t => ({ type: 'task', item: t, date: t[sortField] || '' })),
        ...milestones.map(ms => ({ type: 'milestone', item: ms, date: ms.date || '' })),
      ]
      merged.sort((a, b) => {
        if (a.date < b.date) return -1 * dir
        if (a.date > b.date) return 1 * dir
        // milestones sort before tasks at same date
        if (a.type === 'milestone' && b.type !== 'milestone') return -1
        if (a.type !== 'milestone' && b.type === 'milestone') return 1
        return 0
      })
      rows = merged.map(entry => entry.type === 'milestone' ? milestoneRow(entry.item) : taskRow(entry.item))
    } else {
      // No date sort — milestones first, then tasks
      rows = [...milestones.map(ms => milestoneRow(ms)), ...tasks.map(t => taskRow(t))]
    }
    body = (
      <>
        {rows}
        <AddRow span={span} canWrite={canWrite} onAdd={() => onAddTask()} />
      </>
    )
  }

  return (
    <div className="rb-task-table-wrap" ref={wrapRef}
      style={{ '--rb-task-fixed': widths.fixed, '--rb-task-grow-n': widths.growN }}
      data-grow={widths.grow === 0 ? 'none' : undefined}>
      {guard.modal}
      {picker.layer}
      {/* ── Bulk-action bar (overlays the header, right of the checkbox
          column: the controls appear where the selection was made). ── */}
      {someSelected && (
        <div className="rb-task-bulk">
          <span className="rb-task-bulk-count">
            {selected.size} selected
          </span>
          {/* One wrapper for the whole bulk group rather than six. It must
              generate a BOX (inline-flex, not `contents`) or the wrapper
              carries neither the dimming nor the hover that shows the
              reason. The parent row is `gap-3`, so the wrapper repeats that
              gap internally to keep the spacing identical. */}
          <GatedAction allowed={canWrite} style={{ gap: 12, alignItems: 'center' }}>
            <span className="rb-task-divider" aria-hidden="true" />
            <BulkSelect label="Status" options={TASK_STATUSES} labels={STATUS_LABELS} onPick={v => bulkUpdate({ status: v })} />
            <BulkSelect label="Priority" options={PRIORITIES} labels={PRIORITY_LABELS} onPick={v => bulkUpdate({ priority: v })} />
            <BulkSelect label="Phase" options={phases.map(p => p.id)} labels={phases.reduce((m, p) => { m[p.id] = p.name; return m }, {})} onPick={v => bulkUpdate({ phase_id: v || null })} allowEmpty />
            <BulkSelect label="Assignee" options={members.map(m => m.id)} labels={members.reduce((m, p) => { m[p.id] = p.name; return m }, {})} onPick={v => bulkUpdate({ assignee_id: v || null })} allowEmpty />
            <span className="rb-task-divider" aria-hidden="true" />
            <Button size="sm" variant="danger" Icon={Trash2} onClick={bulkDelete}>
              Delete
            </Button>
          </GatedAction>
          <IconButton size="sm" Icon={X} title="Clear the selection" onClick={clearSelection} />
        </div>
      )}

      <Table
        dense
        stickyColumns={2}
        className="rb-task-table"
        head={(
          <Row>
            {/* Checkbox column */}
            <Th width="var(--rb-task-col-check)" className="rb-task-check-cell">
              <button type="button" onClick={toggleAll}
                className="rb-task-check"
                data-checked={allSelected ? 'all' : someSelected ? 'some' : 'none'}
                aria-label={allSelected ? 'Clear the selection' : 'Select every task'}
                title={allSelected ? 'Clear the selection' : 'Select every task'}>
                {allSelected
                  ? <CheckSquare aria-hidden="true" />
                  : someSelected
                    ? <MinusSquare aria-hidden="true" />
                    : <Square aria-hidden="true" />}
              </button>
            </Th>
            {columns.map(c => (
              <Th key={c.key} width={c.width} numeric={c.numeric} data-col={c.key === 'bid_days' ? 'bid' : undefined}>{c.label}</Th>
            ))}
          </Row>
        )}
      >
        {body}
      </Table>

      {confirmBulkDelete && (() => {
        // Post-overhaul S5b (constraint 9): with a bid version open, the
        // ticked tasks another version holds are set aside, not deleted, and
        // the question says which; otherwise it is the question it always was.
        const removalQ = removalQuestion(ctx?.removalPlanFor?.({ tasks: [...selected] }), 'task')
        return (
          <Dialog
            width="confirm"
            title={removalQ ? removalQ.title : `Delete ${selected.size} task${selected.size === 1 ? '' : 's'}?`}
            onClose={() => setConfirmBulkDelete(false)}
            footer={(
              <>
                <Button autoFocus onClick={() => setConfirmBulkDelete(false)}>Cancel</Button>
                <Button variant={removalQ && !removalQ.danger ? 'primary' : 'danger'} onClick={confirmedBulkDelete}>{removalQ ? removalQ.confirm : 'Delete'}</Button>
              </>
            )}
          >
            {removalQ
              ? removalQ.sentences.map((line, i) => <p key={i} className="rb-removal-line">{line}</p>)
              : 'Every ticked task is deleted, including any in a collapsed group.'}
          </Dialog>
        )
      })()}

      {/* The milestone delete confirm that W9 had put on the kit Dialog is
          GONE (Track A A2 session 2, ruling 38): 0067 made milestones the
          eighth soft-delete table, the shell-level undo toast covers the
          moment after a delete, and "Recently deleted key dates" (the
          toolbar button above) covers everything after that. A modal AND a
          toast for one gesture would have been the contradiction R1 found. */}
    </div>
  )
}

// ── Bulk-action dropdown for floating bar ──
function BulkSelect({ label, options, labels, onPick, allowEmpty }) {
  return (
    <select
      defaultValue=""
      aria-label={label}
      onChange={e => { if (e.target.value !== '') { onPick(e.target.value); e.target.value = '' } }}
      className="ui-input rb-task-tool"
      data-size="sm"
    >
      <option value="" disabled>{label}</option>
      {allowEmpty && <option value="">None</option>}
      {options.map(o => <option key={o} value={o}>{(labels?.[o] || o).replace(/_/g, ' ')}</option>)}
    </select>
  )
}

// ── Drag helpers ──
// VW1m (2026-10-16): grouped by an item kind, a drop where the backend keeps
// items is dropOnItemGroup's; where it keeps none (a cloud before 0096) a
// task has at most one item of a kind, its own field, and a group is one item
// or none, so the drop writes that field as it always did.
function buildGroupPatch(groupBy, targetKey) {
  const val = targetKey === '__none__' ? null : targetKey
  if (groupBy === 'status')   return { status: val || 'waiting_to_start' }
  if (isItemKind(groupBy))    return { [KIND_FIELD[groupBy]]: val }
  if (groupBy === 'phase')    return { phase_id: val }
  if (groupBy === 'priority') return { priority: val || 'medium' }
  if (groupBy === 'assignee') return { assignee_id: val }
  return {}
}

// ── Task group: header row + task rows + add row, one drop target ──
// A <tbody> cannot nest in the kit Table's own, so the group is a run of
// rows that share one set of drag handlers: entering any row of the group
// counts, leaving the last one un-counts (the same counter as before, over
// several elements instead of one wrapper).
function TaskGroup({ group, groupBy, span, phaseById, collapsed, onToggle, ctx, canWrite, canEditViews = false, onAddTask, renderTask, onDropFail, onRemoveGrouping }) {
  const [dragOver, setDragOver] = useState(false)
  const guard = useDependencyStatusGuard(ctx)
  const dragCountRef = useRef(0)

  function groupDefaults() {
    if (isItemKind(groupBy)) return itemGroupDefaults(groupBy, group)
    const d = {}
    if (groupBy === 'status')   d.status      = group.key
    if (groupBy === 'phase')    d.phase_id    = group.key === '__none__' ? undefined : group.key
    if (groupBy === 'priority') d.priority    = group.key
    if (groupBy === 'assignee') d.assignee_id = group.key === '__none__' ? undefined : group.key
    return d
  }

  function handleDragEnter(e) { e.preventDefault(); dragCountRef.current++; if (dragCountRef.current === 1) setDragOver(true) }
  function handleDragOver(e) { e.preventDefault() }
  function handleDragLeave() { dragCountRef.current--; if (dragCountRef.current <= 0) { dragCountRef.current = 0; setDragOver(false) } }
  function handleDrop(e) {
    e.preventDefault()
    dragCountRef.current = 0
    setDragOver(false)
    const taskId = e.dataTransfer.getData('text/plain')
    // Session 29 — dropping a task on another group commits a real update.
    // The card's own draggable is gated below; this catches the drop itself.
    if (!canWrite) return
    // VW1m: the group's items become the task's (her Q-D1).
    if (taskId && isItemKind(groupBy) && ctx?.taskItemsAvailable === true) {
      dropOnItemGroup(ctx, taskId, groupBy, group, onDropFail)
      return
    }
    if (!taskId || !ctx?.updateTask) return
    const patch = buildGroupPatch(groupBy, group.key)
    // Phase 7: a drop into a done-status group warns first, then lands.
    guard.update({ ids: taskId, patch, write: () => ctx.updateTask(taskId, patch) })
  }
  // Every row of the group carries the handlers and the one flag.
  const drop = {
    handlers: { onDragEnter: handleDragEnter, onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop },
    over: dragOver,
  }

  // Phase data for editable header
  const isPhaseGroup = groupBy === 'phase' && group.key !== '__none__'
  const phase = isPhaseGroup ? phaseById[group.key] : null

  return (
    <>
      {guard.modal}
      <Row className="rb-task-group-row" {...drop.handlers}
        data-drag-over={dragOver ? 'true' : 'false'}>
        <Td colSpan={span} className="rb-task-group-cell">
          <div className="rb-task-group-head">
            <IconButton size="sm" Icon={collapsed ? ChevronRight : ChevronDown}
              title={collapsed ? `Show ${group.label}` : `Hide ${group.label}`}
              aria-expanded={!collapsed}
              onClick={onToggle} />

            {isPhaseGroup && phase ? (
              /* ── Editable phase header ── */
              <div className="rb-task-group-body">
                {/* Session 29 — the phase header's name and both dates write
                    straight to ctx.updatePhase with no gate, same as the task row
                    cells did. */}
                <PhaseInlineEdit
                  value={phase.name || ''}
                  onCommit={(name) => { if (canWrite) ctx?.updatePhase?.(phase.id, { name }) }}
                  readOnly={!canWrite}
                />
                <span className="rb-task-phase-date">
                  <span className="text-label uppercase">Start</span>
                  <input
                    type="date"
                    value={phase.start_date || ''}
                    onChange={e => ctx?.updatePhase?.(phase.id, { start_date: e.target.value || null })}
                    onClick={e => e.stopPropagation()}
                    readOnly={!canWrite} disabled={!canWrite}
                    className="ui-input rb-task-date-input"
                    data-size="sm"
                    data-empty={phase.start_date ? 'false' : 'true'}
                  />
                </span>
                <span className="rb-task-phase-date">
                  <span className="text-label uppercase">End</span>
                  <input
                    type="date"
                    value={phase.end_date || ''}
                    onChange={e => ctx?.updatePhase?.(phase.id, { end_date: e.target.value || null })}
                    readOnly={!canWrite} disabled={!canWrite}
                    onClick={e => e.stopPropagation()}
                    className="ui-input rb-task-date-input"
                    data-size="sm"
                    data-empty={phase.end_date ? 'false' : 'true'}
                  />
                </span>
                <span className="rb-task-group-count">{group.tasks.length}</span>
              </div>
            ) : (
              /* ── Standard group header ── */
              <button type="button" onClick={onToggle} className="rb-task-group-toggle">
                {groupBy === 'status' && <StatusDot status={group.key} aria-hidden="true" role={undefined} aria-label={undefined} title="" />}
                <span className="rb-task-group-label">{group.label}</span>
                <span className="rb-task-group-count">{group.tasks.length}</span>
              </button>
            )}
            {/* VW1d, her Q-D5: a project grouping's *…* holds Remove
                grouping, for a seat that may save views (Q-F). */}
            {group.groupingId && canEditViews && onRemoveGrouping && (
              <HoverActions>
                <MenuButton title={`More for ${group.label}`} minWidth={180}
                  items={[{ label: 'Remove grouping', danger: true, onClick: () => onRemoveGrouping(group) }]} />
              </HoverActions>
            )}
          </div>
        </Td>
      </Row>
      {!collapsed && (
        <>
          {group.tasks.map(t => renderTask(t, drop))}
          <AddRow span={span} canWrite={canWrite} onAdd={() => onAddTask(groupDefaults())} drop={drop} />
        </>
      )}
    </>
  )
}

// ── Inline phase name editor (for group headers) ──
function PhaseInlineEdit({ value, onCommit, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }
  if (readOnly) {
    return (
      <span className="rb-task-group-label truncate">
        {value || 'Untitled phase'}
      </span>
    )
  }
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        aria-label="Phase name"
        className="ui-input rb-task-phase-input"
        data-size="sm"
      />
    )
  }
  return (
    <button type="button"
      onClick={e => { e.stopPropagation(); setDraft(value); setEditing(true) }}
      className="rb-task-cell-text rb-task-group-label"
      title="Click to rename phase">
      {value || 'Untitled'}
    </button>
  )
}


// ── Milestone (key date) row: its diamond carries the key date's colour ──
function MilestoneRow({ milestone, columns, ctx, canWrite }) {
  const [editTitle, setEditTitle] = useState(false)
  const [localTitle, setLocalTitle] = useState(milestone.title)
  const [editDate, setEditDate] = useState(false)
  const [localDate, setLocalDate] = useState(milestone.date || '')
  const isProjectBound = milestone.isProjectBound

  // 🚨 RE-SEED FROM PROPS, AND 0077 IS WHY IT IS NOW LOAD-BEARING.
  //
  // These two held their first value for the life of the row: useState's
  // argument is an INITIAL value, the row is keyed `ms-<id>` so its instance
  // survives every bundle update, and nothing re-seeded them. CellInlineText,
  // twenty lines below, has had `useEffect(() => setDraft(value), [value])`
  // since it was written; this row was simply missing it.
  //
  // Before key dates were broadcast the stale value could only be reached
  // through undo/redo, which is rare. Live sync makes it routine and turns it
  // into a WRITE: window A renames "Alpha" to "Beta"; the broadcast lands in
  // window B and the row now displays "Beta"; someone in B clicks the title
  // and clicks away; commitTitle compares its stale 'Alpha' with 'Beta',
  // finds them different, and SAVES 'Alpha' over A's rename — no typing, no
  // Save, no warning, and then re-broadcast to everyone. R1 found it.
  //
  // Guarded on the edit flags so an incoming event cannot yank text out from
  // under someone who is actually typing: while a field is open its draft is
  // theirs, and the merge layer's own pending-field protection covers the
  // in-flight write (see updateMilestone in RabbitProvider).
  useEffect(() => { if (!editTitle) setLocalTitle(milestone.title) }, [milestone.title, editTitle])
  useEffect(() => { if (!editDate) setLocalDate(milestone.date || '') }, [milestone.date, editDate])

  // 🚨 ...AND THE RE-SEED ALONE ONLY NARROWS THE WINDOW; THESE CLOSE IT (R2).
  //
  // The effects above are guarded on the edit flags so an incoming event
  // cannot yank text out from under a live typist — which means that while a
  // field IS open the draft still goes stale, and the original defect walks
  // straight back in: click the title, a collaborator's rename lands, click
  // away, and commit compares its stale draft with the new prop, finds them
  // different, and writes the stale one over the rename. Narrower than
  // "forever", but the same bug.
  //
  // So commit on what the PERSON did, not on what happens to differ from the
  // current prop: the baseline is captured when the field opens, and a draft
  // the person never touched writes nothing no matter what arrived meanwhile.
  // A draft they DID touch still wins, which is correct — they typed it.
  const titleBaseRef = useRef(milestone.title)
  const dateBaseRef  = useRef(milestone.date || '')

  function openTitleEditor() {
    if (isProjectBound) return
    titleBaseRef.current = milestone.title
    setLocalTitle(milestone.title)
    setEditTitle(true)
  }
  function openDateEditor() {
    if (isProjectBound) return
    dateBaseRef.current = milestone.date || ''
    setLocalDate(milestone.date || '')
    setEditDate(true)
  }

  // Against the BASELINE (what the field held when it opened), not against the
  // live prop — see the refs above. Untouched draft, no write.
  function commitTitle() {
    if (localTitle !== titleBaseRef.current && !isProjectBound) {
      ctx?.updateMilestone?.(milestone.id, { title: localTitle })
    }
    setEditTitle(false)
  }
  function commitDate() {
    if (localDate !== dateBaseRef.current && !isProjectBound) {
      ctx?.updateMilestone?.(milestone.id, { date: localDate })
    }
    setEditDate(false)
  }
  // Soft delete — no confirm; the shell-level undo toast covers it.
  //
  // 🚨 THE CONFIRM IS GONE, AND ITS REMOVAL IS THE POINT. This function used to
  // carry a `window.confirm` under a comment reading "milestones are
  // hard-deleted with no undo path (local entity, not one of the 7 soft-delete
  // tables) — the confirm stays until they get one". Both halves stopped being
  // true in A2 session 2: 0067 made milestones the EIGHTH soft-delete table and
  // put them on 0014's trash RPCs, and ruling 38 gave them an undo toast and a
  // "Recently deleted key dates" panel. Leaving the confirm would have meant a
  // modal AND a toast for one gesture on this tab while the Timeline had only
  // the toast, and MASTER_PLAN §6 #10 — struck as CLOSED partly on this
  // function's account — still naming a dialog that was in the tree. R1 of this
  // session found the contradiction.
  //
  // The "Recently deleted key dates" panel is reachable from THIS toolbar too,
  // as `Deleted Key Dates` (Audrey, 2026-09-07). It used to be on the Timeline
  // only and this comment used to say so; R1 caught it still saying so, 743
  // lines below the button the same commit added to this file.
  function handleDelete() {
    if (isProjectBound) return
    ctx?.deleteMilestone?.(milestone.id)
  }

  return (
    <Row className="rb-task-ms" style={{ '--rb-ms': milestone.color }}>
      {/* Checkbox spacer */}
      <Td className="rb-task-check-cell">
        <Diamond className="rb-task-ms-icon" aria-hidden="true" />
      </Td>
      {columns.map(c => {
        if (c.key === 'title') {
          // FX8: its one button, Delete, right after its words (a key date
          // has no window to open), as every row's buttons are.
          return (
            <Td key={c.key} className="rb-task-cell" data-col="title">
              <RowTitle actions={canWrite && !isProjectBound ? (
                <IconButton size="sm" Icon={Trash2} danger title={`Delete ${milestone.title || 'Untitled key date'}`} onClick={handleDelete} />
              ) : null}>
                <span className="rb-task-ms-title">
                  <Diamond className="rb-task-ms-icon" data-filled="true" aria-hidden="true" />
                  {editTitle && !isProjectBound ? (
                    <input type="text" value={localTitle} autoFocus
                      onChange={e => setLocalTitle(e.target.value)}
                      onBlur={commitTitle}
                      onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setLocalTitle(milestone.title); setEditTitle(false) } }}
                      aria-label="Key date name"
                      className="ui-input rb-task-cell-input"
                      data-size="sm"
                    />
                  ) : (
                    isProjectBound ? (
                      <span className="rb-task-ms-name" data-empty="false"
                        title={milestone.description || milestone.title}>
                        {milestone.title}
                      </span>
                    ) : (
                      <button type="button"
                        className="rb-task-ms-name"
                        data-empty={milestone.title ? 'false' : 'true'}
                        onClick={openTitleEditor}
                        title={milestone.description || milestone.title}
                      >
                        {milestone.title || 'Untitled key date'}
                      </button>
                    )
                  )}
                  {isProjectBound && <Badge>Bound</Badge>}
                </span>
              </RowTitle>
            </Td>
          )
        }
        if (c.key === 'start_date' || c.key === 'end_date') {
          return (
            <Td key={c.key} className="rb-task-cell">
              {c.key === 'start_date' ? (
                editDate && !isProjectBound ? (
                  <input type="date" value={localDate} autoFocus
                    onChange={e => setLocalDate(e.target.value)}
                    onBlur={commitDate}
                    onKeyDown={e => { if (e.key === 'Enter') commitDate(); if (e.key === 'Escape') { setLocalDate(milestone.date); setEditDate(false) } }}
                    aria-label="Key date"
                    className="ui-input rb-task-date-input"
                    data-size="sm"
                  />
                ) : (
                  isProjectBound ? (
                    <span className="rb-task-ms-date">{showDate(milestone.date)}</span>
                  ) : (
                    <button type="button" className="rb-task-ms-date" onClick={openDateEditor}>
                      {showDate(milestone.date)}
                    </button>
                  )
                )
              ) : (
                <span className="rb-task-none">—</span>
              )}
            </Td>
          )
        }
        // Empty cell for other columns (Bid keyed on its column, VW1b)
        return (
          <Td key={c.key} numeric={c.numeric} data-col={c.key === 'bid_days' ? 'bid' : undefined}>
            <span className="rb-task-none">—</span>
          </Td>
        )
      })}
    </Row>
  )
}

// ── Single task row ──
function TaskRow({ task, columns, itemLookup, itemSort = 'type', picking = null, onOpenItems, draftStore = null, phases, members, ctx, canWrite, onDetailClick, onHistoryClick, isSelected, onToggleSelect, drop }) {
  const guard = useDependencyStatusGuard(ctx)
  const removal = useRemovalAsk(ctx)
  const writeReason = useWriteReason()

  // 🚨 Session 29 — this funnel was UNGATED, and it is not a create affordance
  // so neither the S23 nor the S29 brief covered it. Every inline cell on this
  // row (title, five dropdowns, both dates, bid days) commits through here, so
  // a reviewer could retype a task title or change its status and receive the
  // same raw `new row violates row-level security policy` string the Timeline
  // was fixed for. The create button being gated while the ROW was not is why
  // this screen read as "already gated".
  //
  // The controls below are individually disabled too — gating only this funnel
  // would leave nine editable-looking cells that silently discard input.
  function handleUpdate(patch) {
    if (!canWrite) return
    // Phase 7: a status move into done over an unfinished predecessor warns
    // first; any other cell commits straight through.
    guard.update({ ids: task.id, patch, write: () => ctx?.updateTask?.(task.id, patch) })
  }
  // Soft delete — no confirm; the shell-level undo toast covers it. S5b:
  // with a bid version open, a task another version holds is set aside
  // instead, and when it has work on it that is asked first.
  function handleDelete() {
    if (!canWrite) return
    removal.ask({ tasks: [task.id] }, () => ctx?.deleteTask?.(task.id))
  }

  // Borderless select — transparent until hover: `.rb-task-cell-select`.
  // Its cursor used to be set INLINE from canWrite, which beat the
  // `disabled:cursor-not-allowed` class beside it; every one of these selects
  // is `disabled={!canWrite}`, so the stylesheet keys the cursor on :disabled.

  // What the row's buttons are named for (FX8: "Open <name>", "Delete <name>").
  const name = task.title || 'Untitled task'

  function renderCell(col) {
    switch (col.key) {
      case 'title':
        // FX8: the row's buttons right after its words, in the one order —
        // Open (the page icon), its edit history, Delete last — shown on the
        // row's hover and on focus (the kit's RowTitle).
        return (
          <RowTitle actions={<>
            <IconButton size="sm" Icon={FileText} title={`Open ${name}`} onClick={onDetailClick} />
            {onHistoryClick && (
              <IconButton size="sm" Icon={History} title={`View edit history for ${name}`} onClick={onHistoryClick} />
            )}
            {canWrite && (
              <IconButton size="sm" Icon={Trash2} danger title={`Delete ${name}`} onClick={handleDelete} />
            )}
          </>}>
            <CellInlineText value={task.title || ''} placeholder="Untitled task" onCommit={v => handleUpdate({ title: v })} readOnly={!canWrite} />
          </RowTitle>
        )
      case 'status':
        return (
          <span className="rb-task-status-cell">
            <StatusDot status={task.status || 'waiting_to_start'} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
            <span className="rb-task-cell-editor">
              <select value={task.status || 'waiting_to_start'} onChange={e => handleUpdate({ status: e.target.value })}
                disabled={!canWrite}
                aria-label="Status"
                className="rb-task-cell-select">
                {TASK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </span>
          </span>
        )
      case 'priority':
        return (
          <span className="rb-task-cell-editor">
            <select value={task.priority || 'medium'} onChange={e => handleUpdate({ priority: e.target.value })}
              disabled={!canWrite}
              aria-label="Priority"
              className="rb-task-cell-select"
              data-tone={priorityTone(task.priority || 'medium')}>
              {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
          </span>
        )
      case 'phase_id':
        return (
          <span className="rb-task-cell-editor">
            <select value={task.phase_id || ''} onChange={e => handleUpdate({ phase_id: e.target.value || null })}
              disabled={!canWrite}
              aria-label="Phase"
              className="rb-task-cell-select"
              data-empty={task.phase_id ? 'false' : 'true'}>
              <option value="">—</option>
              {phases.map(p => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
            </select>
          </span>
        )
      case 'assignee_id':
        return (
          <span className="rb-task-cell-editor">
            <select value={task.assignee_id || ''} onChange={e => handleUpdate({ assignee_id: e.target.value || null })}
              disabled={!canWrite}
              aria-label="Assignee"
              className="rb-task-cell-select"
              data-empty={task.assignee_id ? 'false' : 'true'}>
              <option value="">—</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </span>
        )
      case 'start_date':
        return <CellDateInput value={task.start_date || ''} label="Start date" onCommit={v => handleUpdate({ start_date: v || null })} readOnly={!canWrite} />
      case 'end_date':
        return <CellDateInput value={task.end_date || ''} label="End date" onCommit={v => handleUpdate({ end_date: v || null })} readOnly={!canWrite} />
      case 'bid_days':
        return <CellNumberInput value={task.bid_days} label="Bid days" onCommit={v => handleUpdate({ bid_days: v })} readOnly={!canWrite} />
      default:
        // VW1b (her Q9, Q10, Q11): an item column — every live item of its
        // kind by name, a click opening the picker (TaskItemCells.jsx).
        if (col.kind) {
          const mine = picking && picking.taskId === task.id && picking.kind === col.kind
          return (
            <TaskItemCell task={task} kind={col.kind} lookup={itemLookup} sort={itemSort}
              canWrite={canWrite} available={ctx?.taskItemsAvailable === true}
              draftStore={draftStore} open={!!mine}
              onOpen={onOpenItems} onOpenWindow={onDetailClick} />
          )
        }
        return <span className="rb-task-none">{task[col.key] ?? '—'}</span>
    }
  }

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <Row
      className="rb-task-row"
      selected={isSelected}
      data-ticked={isSelected ? 'true' : 'false'}
      data-draggable={canWrite ? 'true' : 'false'}
      draggable={canWrite}
      onDragStart={handleDragStart}
      title={canWrite ? undefined : (writeReason || undefined)}
      {...(drop?.handlers || {})}
    >
      {guard.modal}
      {removal.dialog}
      {/* Checkbox */}
      <Td className="rb-task-check-cell">
        <button type="button" onClick={e => { e.stopPropagation(); onToggleSelect?.() }}
          className="rb-task-check"
          data-checked={isSelected ? 'all' : 'none'}
          aria-pressed={isSelected}
          aria-label={`Select "${task.title || 'Untitled task'}"`}>
          {isSelected
            ? <CheckSquare aria-hidden="true" />
            : <Square aria-hidden="true" />}
        </button>
      </Td>
      {columns.map(c => (
        <Td key={c.key} numeric={c.numeric} className="rb-task-cell" data-col={c.key === 'title' ? 'title' : c.key === 'bid_days' ? 'bid' : undefined}>
          {renderCell(c)}
        </Td>
      ))}
    </Row>
  )
}

// ── Add row: "New task" at the foot of the table and of every group ──
function AddRow({ span, canWrite, onAdd, drop }) {
  return (
    <Row {...(drop?.handlers || {})}>
      <Td colSpan={span} className="rb-task-add-cell">
        <GatedAction allowed={canWrite} display="block">
          <button type="button" onClick={onAdd} className="rb-task-add">
            <Plus aria-hidden="true" />
            <span>New task</span>
          </button>
        </GatedAction>
      </Td>
    </Row>
  )
}


// ═════════════════════════════════════════════════════
// KANBAN BOARD
// ═════════════════════════════════════════════════════
//
// Redesigned with UX Laws in mind:
// • Common Region — each column is a distinct bounded container
// • Proximity — cards have internal padding, columns have external gaps
// • Von Restorff — the status dot makes columns instantly scannable
// • Doherty — the state changes are the kit's 120ms (§3.4)
// • Prägnanz — clean cards, no excess decoration
// • Fitts's Law — generous add-task targets, large enough card touch areas
//
function KanbanBoard({ groups, kanbanGroup, itemLookup, itemSort = 'type', memberById, cardShows = null, ctx, canWrite, canEditViews = false, onAddTask, onDetailClick, onDropFail, onRemoveGrouping }) {
  return (
    <div className="rb-task-board">
      {groups.map(g => (
        <KanbanColumn key={g.key} group={g} kanbanGroup={kanbanGroup}
          itemLookup={itemLookup} itemSort={itemSort} memberById={memberById} cardShows={cardShows}
          ctx={ctx} canWrite={canWrite} canEditViews={canEditViews} onAddTask={onAddTask} onDetailClick={onDetailClick} onDropFail={onDropFail}
          onRemoveGrouping={onRemoveGrouping} />
      ))}
    </div>
  )
}

function KanbanColumn({ group, kanbanGroup, itemLookup, itemSort, memberById, cardShows = null, ctx, canWrite, canEditViews = false, onAddTask, onDetailClick, onDropFail, onRemoveGrouping }) {
  const [addTitle, setAddTitle] = useState('')
  const guard = useDependencyStatusGuard(ctx)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)
  const dragCountRef = useRef(0)

  function groupDefaults() {
    if (isItemKind(kanbanGroup)) return itemGroupDefaults(kanbanGroup, group)
    const d = {}
    if (kanbanGroup === 'status')   d.status      = group.key
    if (kanbanGroup === 'phase')    d.phase_id    = group.key === '__none__' ? undefined : group.key
    if (kanbanGroup === 'priority') d.priority    = group.key
    if (kanbanGroup === 'assignee') d.assignee_id = group.key === '__none__' ? undefined : group.key
    return d
  }

  function commitAdd() {
    if (!addTitle.trim()) return
    onAddTask({ ...groupDefaults(), title: addTitle.trim() })
    setAddTitle('')
  }

  // Counter-based drag tracking prevents flicker from child elements
  function handleDragEnter(e) { e.preventDefault(); dragCountRef.current++; if (dragCountRef.current === 1) setDragOver(true) }
  function handleDragOver(e) { e.preventDefault() }
  function handleDragLeave() { dragCountRef.current--; if (dragCountRef.current <= 0) { dragCountRef.current = 0; setDragOver(false) } }
  function handleDrop(e) {
    e.preventDefault()
    dragCountRef.current = 0
    setDragOver(false)
    const taskId = e.dataTransfer.getData('text/plain')
    // Session 29 — dropping a task on another group commits a real update.
    // The card's own draggable is gated below; this catches the drop itself.
    if (!canWrite) return
    // VW1m: the column's items become the card's (her Q-D1).
    if (taskId && isItemKind(kanbanGroup) && ctx?.taskItemsAvailable === true) {
      dropOnItemGroup(ctx, taskId, kanbanGroup, group, onDropFail)
      return
    }
    if (!taskId || !ctx?.updateTask) return
    const patch = buildGroupPatch(kanbanGroup, group.key)
    // Phase 7: a card dropped into a done-status column warns first, then lands.
    guard.update({ ids: taskId, patch, write: () => ctx.updateTask(taskId, patch) })
  }

  return (
    <div className="rb-task-col"
      data-drag-over={dragOver ? 'true' : 'false'}
      onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {guard.modal}

      {/* ── Column header ──
          VW1m review round 1 (P-1): a combination's name is cut short in
          the head ("Lighthouse Interior, Sea Spray C…"); its title names it
          whole on hover, as the Timeline's row and the cards do (the text
          itself is the head's name, whole, for a screen reader). */}
      <div className="rb-task-col-head">
        <div className="rb-task-col-title">
          {kanbanGroup === 'status' && <StatusDot status={group.key} aria-hidden="true" role={undefined} aria-label={undefined} title="" />}
          <span className="rb-task-group-label" title={group.label}>{group.label}</span>
          <span className="rb-task-group-count">{group.tasks.length}</span>
        </div>
        {/* VW1d, her Q-D5: a project grouping's column has its *…*. */}
        {group.groupingId && canEditViews && onRemoveGrouping && (
          <MenuButton title={`More for ${group.label}`} minWidth={180}
            items={[{ label: 'Remove grouping', danger: true, onClick: () => onRemoveGrouping(group) }]} />
        )}
        <GatedAction allowed={canWrite}>
          <IconButton size="sm" Icon={Plus} title={`New task in ${group.label}`} onClick={() => onAddTask(groupDefaults())} />
        </GatedAction>
      </div>

      {/* ── Card list ── */}
      <div className="rb-task-col-list">
        {group.tasks.map(t => (
          <KanbanCard key={t.id} task={t}
            itemLookup={itemLookup} itemSort={itemSort} memberById={memberById} cardShows={cardShows}
            ctx={ctx} canWrite={canWrite} onDetailClick={() => onDetailClick?.(t.id)} />
        ))}

        {/* Inline add.
            🚨 This is the control from the S23 report: typing a task here and
            pressing Enter made the text vanish, because commitAdd clears the
            input unconditionally before the write resolves. Greyed, it cannot
            be typed into at all, which is the honest version of the same
            state. */}
        <GatedAction allowed={canWrite} display="block">
          <input ref={inputRef} type="text" value={addTitle} onChange={e => setAddTitle(e.target.value)}
            placeholder="+ Add task…"
            aria-label={`Add a task to ${group.label}`}
            onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') { setAddTitle(''); inputRef.current?.blur() } }}
            onBlur={commitAdd}
            className="ui-input rb-task-col-add"
            data-size="sm" />
        </GatedAction>
      </div>
    </div>
  )
}

function KanbanCard({ task, itemLookup, itemSort, memberById, cardShows = null, ctx, canWrite, onDetailClick }) {
  const removal = useRemovalAsk(ctx)
  // VW1d, her Q-E ("allow the user to select what shows in the cards"): a
  // field the view hides leaves its part of the card; the card keeps its own
  // order (finding 6). No view: every part, as before.
  const shows = (key) => !cardShows || cardShows.has(key)
  const assignee = shows('assignee_id') && task.assignee_id ? memberById[task.assignee_id] : null
  // VW1m (2026-10-16): every live asset by name, cut short by the card, the
  // whole list on hover (it was the first asset only).
  const assetNames = shows('asset') ? itemNamesOf(itemLookup, task, 'asset', itemSort) : ''
  const status   = task.status   || 'waiting_to_start'
  const priority = task.priority || 'medium'

  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="rb-task-card ui-hover-host"
      data-draggable={canWrite ? 'true' : 'false'}
      draggable={canWrite} onDragStart={handleDragStart}>
      {removal.dialog}

      {/* Title + actions */}
      <div className="rb-task-card-top">
        <span className="rb-task-card-title">
          {task.title || 'Untitled task'}
        </span>
        {/* FX8: named as the table row's are — "Open <name>", "Delete <name>". */}
        <HoverActions>
          <IconButton size="sm" Icon={FileText} title={`Open ${task.title || 'Untitled task'}`} onClick={onDetailClick} />
          {canWrite && (
            // Soft delete — no confirm; the shell-level undo toast covers it.
            <IconButton size="sm" Icon={Trash2} danger title={`Delete ${task.title || 'Untitled task'}`} onClick={() => removal.ask({ tasks: [task.id] }, () => ctx?.deleteTask?.(task.id))} />
          )}
        </HoverActions>
      </div>

      {/* Status + Priority */}
      {(shows('status') || shows('priority')) && (
        <div className="rb-task-card-meta">
          {shows('status') && <StatusDot status={status} aria-hidden="true" role={undefined} aria-label={undefined} title="" />}
          {shows('status') && <span>{STATUS_LABELS[status] || humanizeStatus(status)}</span>}
          {shows('status') && shows('priority') && <span aria-hidden="true">&middot;</span>}
          {shows('priority') && (
            <span className="rb-task-card-priority" data-tone={priorityTone(priority)}>
              {PRIORITY_LABELS[priority] || priority}
            </span>
          )}
        </div>
      )}

      {/* Asset + Assignee */}
      {(assetNames || assignee) && (
        <div className="rb-task-card-people">
          {assetNames ? (
            <span className="rb-task-card-asset" title={assetNames}>{assetNames}</span>
          ) : <span />}
          {assignee ? (
            <span className="rb-task-card-assignee">{assignee.name}</span>
          ) : null}
        </div>
      )}

      {/* Date + bid */}
      {((shows('start_date') && task.start_date) || (shows('bid_days') && task.bid_days != null)) && (
        <div className="rb-task-card-figures">
          {shows('start_date') && task.start_date && <span>{showDate(task.start_date)}</span>}
          {shows('bid_days') && task.bid_days != null && <span>{task.bid_days}d</span>}
        </div>
      )}
    </div>
  )
}


// ═════════════════════════════════════════════════════
// CELL EDITORS
// ═════════════════════════════════════════════════════
// Session 29 — `readOnly` renders the value as plain text with no button, no
// hover highlight and no way in. The alternative (leave the button, drop the
// write) is the S23 defect: a control that looks live, accepts a click, and
// discards what you typed.
function CellInlineText({ value, placeholder, onCommit, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => { setDraft(value) }, [value])

  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }

  if (readOnly) {
    return (
      <span className="rb-task-cell-text" data-empty={value ? 'false' : 'true'} data-static="true"
        title={value || undefined}>
        {value || placeholder || '—'}
      </span>
    )
  }

  if (editing) {
    return (
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        aria-label="Title"
        className="ui-input rb-task-cell-input"
        data-size="sm" />
    )
  }
  return (
    <button type="button" onClick={() => { setDraft(value); setEditing(true) }}
      className="rb-task-cell-text"
      title={value || undefined}
      data-empty={value ? 'false' : 'true'}>
      {value || placeholder || '—'}
    </button>
  )
}

function CellDateInput({ value, label, onCommit, readOnly = false }) {
  return (
    <input type="date" value={value || ''} onChange={e => onCommit(e.target.value)}
      readOnly={readOnly} disabled={readOnly}
      aria-label={label}
      className="rb-task-cell-select rb-task-cell-date"
      data-empty={value ? 'false' : 'true'} />
  )
}

function CellNumberInput({ value, label, onCommit, readOnly = false }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  return (
    <input type="number" value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={() => { const n = parseFloat(draft); onCommit(isNaN(n) ? null : n) }}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      readOnly={readOnly} disabled={readOnly}
      aria-label={label}
      className="rb-task-cell-select rb-task-cell-number"
      data-empty={(value != null && value !== '') ? 'false' : 'true'}
      min={0} step={0.5} />
  )
}
