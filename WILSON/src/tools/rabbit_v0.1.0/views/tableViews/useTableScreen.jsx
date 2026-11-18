// ============================================================
// RABBIT — one table's screen around its views (post-overhaul F10, rabbit A3)
// ============================================================
//
// What the four table views (Tasks, Assets, Levels/Experiences, Scenes and
// Shots) wrote again around `useTableView`, once: who changed a view (the
// roster), the passing message (the kit toast), the views' questions (useAsk),
// the table's one polite live region, a drop's refusal said in a Banner; then,
// per table, the view on screen's layout, filters, sorts and grouping with
// their setters, the search-then-filter-then-sort of the rows, the columns and
// the cards' lines the view shows, the project's groupings and Remove
// grouping, the keyboard back to the Views button or the Group menu, and the
// old saved views' removal (her Q17, "Start fresh").
//
// Two hooks, because the Scenes tab holds TWO tables (her Q16, "Two lists"):
// `useTableTab()` once per tab — one roster, one toast, one question, one live
// region — and `useTableScreen({ tab, … })` once per table. Each table keeps
// its own view: its filters, sorts and grouping never reach the other's.
//
// What stays in each view, because it differs for real: the table's
// description and its inputs, the groups the rows make, a drop onto a group,
// whether a kind's links are kept (and its announcement), the collapsed
// groups, the search box's state, the seat, and the Tasks Board's own grouping.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Banner, IconButton, useOptionalToast } from '../../../../ui'
import { useRosterMembers } from '../../../../components/TeamMembers/useRosterMembers'
import { isGroupingLive } from '../../state/tableViewsModel'
import { GROUPINGS_GATE_WORDS } from '../../state/tableViewsState'
import { useTableView } from './useTableView'
import { useAsk } from './useAsk'
import {
  applyViewFilters, applyViewSorts, effectiveFields, effectiveLeading, filterCount, withFirstSort, withFirstSortReversed,
} from './viewScreenModel'

/** What a tab's tables share: the roster's names, the toast, the views' question, the live region, a refusal's Banner. */
export function useTableTab() {
  // Who changed a view, by the workspace roster (design §5.5): "Someone" when
  // they are not there; its own entries only (VW1d R2-7: a stored
  // "constructor" is nobody).
  const { members } = useRosterMembers()
  const byId = useMemo(() => { const m = {}; for (const mb of members || []) m[mb.id] = mb; return m }, [members])
  const nameOf = useCallback((id) => {
    const m = Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : null
    return m ? (m.name || m.display_name || m.username || null) : null
  }, [byId])
  // The kit toast stack, or none where no provider is mounted (a test that
  // mounts the tab alone): a passing message, never a failure.
  const toast = useOptionalToast()
  const notify = useCallback((words) => { toast?.push({ tone: 'info', title: words }) }, [toast])
  const { ask, dialog: askDialog } = useAsk()
  // The table's one polite live region (VW1e, design §4.9): the bar's state
  // and every reorder, always mounted; keyed so the same words said twice are
  // said twice.
  const [announcement, setAnnouncement] = useState({ words: '', n: 0 })
  const announce = useCallback((words) => setAnnouncement(a => ({ words, n: a.n + 1 })), [])
  const liveRegion = (
    <p className="sr-only" role="status" aria-live="polite">
      <span key={announcement.n}>{announcement.words}</span>
    </p>
  )
  // A drop or a grouping's removal that did not land, said above the table
  // until dismissed (VW1m review round 2, R2-2).
  const [dropFailure, setDropFailure] = useState(null)
  const failureBanner = dropFailure ? (
    <Banner
      tone="danger"
      action={<IconButton size="sm" Icon={X} title="Dismiss" onClick={() => setDropFailure(null)} />}
    >
      {dropFailure}
    </Banner>
  ) : null
  return { nameOf, notify, ask, askDialog, announce, liveRegion, dropFailure, setDropFailure, failureBanner }
}

const byName = (row) => row?.name || ''

/**
 * One table's screen.
 * @param {object} p
 * @param {object} p.tab              useTableTab()'s result
 * @param {object} p.ctx              useRabbit()
 * @param {string} p.tableKey         the table's key (tasks, assets, levels, experiences, scenes, shots)
 * @param {object} p.description      the table's description (tableViews/*TableView.js)
 * @param {Array}  p.rows             the table's rows, before the search
 * @param {boolean} p.canWrite        the seat may save views (Q2, Q-F)
 * @param {string} p.toolbarSelector  the toolbar the keyboard goes back to ('.rb-ent-toolbar')
 * @param {string} [p.search]         the tab's search text (its state stays the tab's)
 * @param {Function} [p.searchText]   what the search reads of a row (its name)
 * @param {boolean} [p.searchTrim]    the search is trimmed (Scenes matches it as typed)
 * @param {string|null} [p.baseOrder] a field the rows are put in before the view's sorts, on a copy ('sort_order')
 * @param {object} [p.layouts]        a view's stored layout → the tab's word ({ gallery: 'gallery' }); otherwise 'table'
 * @param {object} [p.group]          the Tasks table's group words: { keyOf, fieldOf, keys, layout }
 * @param {object} [p.lookup]         buildItemLookup's (isLive), for the project's groupings
 * @param {object} [p.groupingWords]  { rows, kept }: "Its {rows} keep their {kept}. The group stays while {rows} are in it."
 * @param {boolean} [p.notifyOn]      this table says a teammate's delete of its view (only the one on screen, Scenes)
 * @param {string} [p.viewsButton]    the Views button the bar's keyboard goes back to
 * @param {string} [p.oldViewsKey]    the views this browser kept before VW1d/VW1e, removed once (Q17)
 */
export function useTableScreen({
  tab, ctx, tableKey, description, rows, canWrite, toolbarSelector,
  search = '', searchText = byName, searchTrim = true, baseOrder = null,
  layouts = { gallery: 'gallery' }, group = null, lookup = null, groupingWords = null,
  notifyOn = true, viewsButton = null, oldViewsKey = null,
}) {
  const { nameOf, notify, ask, setDropFailure } = tab
  const tv = useTableView({ ctx, tableKey, description, canWrite, nameOf, notify: notifyOn ? notify : null })
  const config = tv.config

  // Q17 (her "Start fresh"): this browser's old saved views go, once.
  useEffect(() => {
    if (!oldViewsKey) return
    try { localStorage.removeItem(oldViewsKey) } catch { /* storage unavailable: nothing kept to remove */ }
  }, [oldViewsKey])

  // ── The layout, the view's (her Q8) ──
  const viewMode = layouts[config.layout] || 'table'
  const setViewMode = (mode) => {
    const stored = Object.keys(layouts).find(k => layouts[k] === mode) || 'table'
    tv.update(c => ({ ...c, layout: stored }))
  }

  // ── Sorts: the FIRST sort the table can sort by is the toolbar's (VW1d R2-4) ──
  const filters = config.filters || []
  const sorts = config.sorts || []
  const firstSort = sorts.find(s => s && description.field(s.field)?.sortable) || null
  const sortField = firstSort?.field || ''
  const sortDir = firstSort?.dir === 'desc' ? 'desc' : 'asc'
  const setSortField = (field) => tv.update(c => ({ ...c, sorts: withFirstSort(c.sorts, field) }))
  const reverseSort = () => tv.update(c => ({ ...c, sorts: withFirstSortReversed(c.sorts, s => !!description.field(s.field)?.sortable) }))

  // ── Grouping: one the table no longer offers reads as none (VW1b R1-10).
  // A saved view keeps its own; in a change for now it is forgotten, so the
  // table never regroups by itself the moment the field comes back, and a Save
  // never stores a grouping the screen did not show.
  const storedField = config.group?.field || ''
  const storedGroup = group?.keyOf ? group.keyOf(storedField) : storedField
  const offered = group?.keys ? group.keys.includes(storedGroup) : description.groupFields.some(f => f.key === storedGroup)
  const groupBy = storedGroup && offered ? storedGroup : ''
  const hideEmpty = config.group ? config.group.hideEmpty !== false : true
  const fromDraft = tv.fromDraft
  const update = tv.update
  useEffect(() => {
    if (fromDraft && storedGroup && !groupBy) update(c => ({ ...c, group: null }))
  }, [fromDraft, storedGroup, groupBy, update])
  const setGroupBy = (value) => tv.update(c => {
    const field = group?.fieldOf ? group.fieldOf(value) : value
    return { ...c, group: field ? { field, hideEmpty: description.hideEmptyDefault(group?.layout ?? viewMode, field) } : null }
  })

  // ── The Filter strip: the view's filters in the shared row; a new row
  // filters nothing until it has a value (defect 1).
  function addFilter() {
    const first = description.filterFields[0]
    tv.update(c => ({ ...c, filters: [...(c.filters || []), { field: first.key, op: description.filterOps(first)[0].value, values: [] }] }))
  }
  function updateFilter(idx, row) { tv.update(c => ({ ...c, filters: (c.filters || []).map((f, i) => (i === idx ? row : f)) })) }
  function removeFilter(idx) { tv.update(c => ({ ...c, filters: (c.filters || []).filter((_, i) => i !== idx) })) }
  const activeFilters = filterCount(filters, description)

  // ── The rows: the tab's search, then the view's filters (every complete one
  // must match, Q13), then its sorts in order (Q14). No sort: the table's own
  // order — `baseOrder` on a COPY (the old sorts reordered the provider's
  // array in place, VW1e step 0 finding 16), or the rows as they come (a
  // list's own order, Scenes; the Tasks table's).
  const processed = useMemo(() => {
    const q = (searchTrim ? search.trim() : search).toLowerCase()
    const base = baseOrder ? [...(rows || [])].sort((a, b) => (a[baseOrder] ?? 0) - (b[baseOrder] ?? 0)) : (rows || [])
    const searched = search.trim() ? base.filter(r => searchText(r).toLowerCase().includes(q)) : base
    return applyViewSorts(applyViewFilters(searched, filters, description), sorts, description)
  }, [rows, search, searchTrim, searchText, baseOrder, filters, sorts, description])

  // ── What the view shows: the columns (its fields over the table's, the
  // name first, Q6, Q7), the leading columns (her Q-J), the cards' lines
  // (her Q-E, Q-P2).
  const fieldList = useMemo(() => effectiveFields(config.fields, description.fieldKeys, { fixed: description.fixed }), [config.fields, description])
  const columns = useMemo(() => fieldList.filter(f => f.visible).map(f => description.columns.find(c => c.key === f.key)).filter(Boolean), [fieldList, description])
  const leading = useMemo(() => new Set(effectiveLeading(config.leading, description.leadingKeys || []).filter(f => f.visible).map(f => f.key)), [config.leading, description])
  const cardShows = useMemo(() => new Set([
    ...fieldList.filter(f => f.visible && (description.cardFields || []).includes(f.key)).map(f => f.key),
    ...[...leading].filter(k => (description.cardLeading || []).includes(k)),
  ]), [fieldList, leading, description])

  // ── The project's groupings (her Q-D2, Q-D3, Q-D5) ──
  const savedOf = useCallback((kind) => {
    const list = typeof ctx?.groupingsOf === 'function' ? ctx.groupingsOf(tableKey, kind) : []
    return list.filter(g => isGroupingLive(g, lookup?.isLive)).map(g => ({ id: g.id, ids: g.entity_ids }))
  }, [ctx, tableKey, lookup])
  const [groupingKind, setGroupingKind] = useState(null)
  async function createGrouping(kind, ids) {
    await ctx.addItemGrouping({ tableKey, kind, entityIds: ids })
  }
  // After Remove grouping the keyboard goes to the Group menu, once the
  // question has closed (code review round 1, R1-6: it fell to <body>).
  const [focusGroupMenu, setFocusGroupMenu] = useState(false)
  useEffect(() => {
    if (!focusGroupMenu) return
    document.querySelector(`${toolbarSelector} select[aria-label="Group"]`)?.focus({ preventScroll: true })
    setFocusGroupMenu(false)
  }, [focusGroupMenu, toolbarSelector])
  // A group's … → Remove grouping, asked first; rows keep their items, and a
  // group that holds rows stays, as any combination with rows does. A removal
  // the cloud's policies dropped is said (GROUPINGS_GATE_WORDS).
  async function removeGrouping(g) {
    const words = groupingWords || { rows: 'rows', kept: 'items' }
    const yes = await ask({
      title: `Remove the grouping ${g.label}?`,
      body: `Its ${words.rows} keep their ${words.kept}. The group stays while ${words.rows} are in it.`,
      confirm: 'Remove grouping',
      danger: true,
    })
    if (!yes) return
    try {
      const res = await ctx.removeItemGrouping(g.groupingId)
      if (res && res.removed === false && res.status === 'filtered') setDropFailure(GROUPINGS_GATE_WORDS)
      else setFocusGroupMenu(true)
    } catch (err) {
      setDropFailure(`Could not remove the grouping ${g.label}: ${err?.message || err}`)
    }
  }

  // The keyboard back to this table's Views button: never another table's,
  // when the tab's content changed while a save was on its way (Scenes,
  // code review round 2, R2-3).
  const viewsSelector = viewsButton || `${toolbarSelector} .rb-tv-button`
  const focusViews = useCallback(() => {
    document.querySelector(viewsSelector)?.focus({ preventScroll: true })
  }, [viewsSelector])

  return {
    tv, config, viewMode, setViewMode,
    filters, addFilter, updateFilter, removeFilter, activeFilters,
    sorts, firstSort, sortField, sortDir, setSortField, reverseSort,
    storedGroup, groupBy, hideEmpty, setGroupBy,
    processed, fieldList, columns, leading, cardShows,
    savedOf, groupingKind, setGroupingKind, createGrouping, removeGrouping,
    focusViews,
  }
}
