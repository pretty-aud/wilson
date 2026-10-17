// ============================================================
// RABBIT — the Tasks table's item cells and their picker
// (post-overhaul VW1b, 2026-10-17)
// ============================================================
//
// Audrey, 2026-10-13 (docs/design/CUSTOM_VIEWS_QUESTIONS.md): her bug, "the
// interface in the table doesnt allow for multiple assets to be connected to
// it. please make sure it either shows all or none. additionally, i can see
// the levels or scenes or shots related"; Q9 "All of them", Q10 "Pick several
// there", Q11 "Yes, a column for each". The design's §4.6, as VW1b's step 0
// review corrected it (§11 round 3).
//
// THE CELL: the task's LIVE items of one kind (her Q-N4) by name, in the task
// window's Sort (her Q10: "the order ... stay as the task's window sets them";
// her Q-N1a and Q-N1b say what the Sort means), as many as fit, then "+N"
// (the kit Badge); the whole list is its tooltip and its accessible name;
// "—" when there are none. A seat that may write gets a button that opens the
// picker; one that may not, text that is not a Tab stop (the visible part
// hidden from a screen reader, the whole list said once). Where the backend
// keeps no items, VW1m's cell: the one item, a button to the task's window.
//
// THE PICKER: the kit Popover, portalled out of the table's scroller, over one
// kind: a search, "Show all lists" for scenes and shots, then every live row
// of the kind, each a checkbox row (ticked = the task has it; a same-named row
// says what tells it apart). Ticks change a DRAFT; closing commits ONCE —
// what was added and removed, applied to the task's items as they are then —
// through the provider's queued `setTaskItemsOfKind` (one undo step, its items
// in the trash kept) inside `runWithUndoToast` (step 0 review, finding 3: a
// write at each tick moved the row, and unmounted the cell the Popover hangs
// from, whenever the table was grouped by that kind). Unticking the task's
// last live item asks first, with the task window's question.
//
// Laws of UX: Fitts (the edit is where the eye already is); Jakob (a Notion
// relation cell's picker); Miller and chunking (as many names as fit, then a
// count); working memory (the cell shows the draft while it is being made);
// forgiveness (one undo step, the toast; the last item asks).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Search, Square, CheckSquare } from 'lucide-react'
import { Popover, Badge, Switch, Dialog, Button } from '../../../ui'
import { ITEM_KINDS, KIND_LABEL_PLURAL, NO_KIND_LABEL, sortIdsForDisplay } from '../state/taskItemsModel'
import { itemPickerOffers, itemPickerScopeOn } from '../components/RelationsPanel'
import './rabbitTasks.css'

// What a "+N" badge and its 6px gap take, kept for it whenever a name is left
// out. VW1b review round 1 (R1-8): the badge's own width, by its digits — the
// kit Badge at the label size measured 26.3px for "+1" and 28.6px for "+2" in
// Chromium 152: 19px of edges and about 7.5px a digit. A fixed 42px (room for
// "+99") hid a name that fitted beside "+1".
const moreRoom = (n) => 6 + 19 + 7.5 * String(n).length

/**
 * The names in a cell, as many as fit on its one line, then "+N" for the
 * rest. Measured after layout: each name's width once (with its comma), the
 * CELL's room at every width change (VW1b review round 1, R1-4: the cell,
 * never the names' own box, which shrink-wraps them in a seat that may not
 * write and collapsed lists that fitted). Until then, and where nothing is
 * laid out (the test runner), every name is on the line and the sheet cuts it
 * with "…", so nothing jumps; a cell with one name is never measured. Keyed
 * by its names, so a new list is measured afresh.
 */
function ItemNames({ names }) {
  const listRef = useRef(null)
  const widthsRef = useRef(null)
  const [shown, setShown] = useState(names.length)
  useLayoutEffect(() => {
    const list = listRef.current
    const box = list?.closest('.rb-task-items')
    if (!list || !box || names.length < 2) return undefined
    const fit = () => {
      if (!widthsRef.current) {
        const spans = [...list.querySelectorAll('[data-name]')]
        if (spans.length !== names.length) return
        const w = spans.map(s => s.getBoundingClientRect().width)
        if (w.every(x => !x)) return
        widthsRef.current = w
      }
      const css = getComputedStyle(box)
      const room = box.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0)
      if (!(room > 0)) return
      const w = widthsRef.current
      let sum = 0
      const upTo = w.map(x => (sum += x))
      let k = w.length
      if (upTo[w.length - 1] > room) {
        k = 1
        for (let c = w.length - 1; c >= 1; c--) {
          if (upTo[c - 1] + moreRoom(w.length - c) <= room) { k = c; break }
        }
      }
      setShown(prev => (prev === k ? prev : k))
    }
    fit()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  }, [names.length])
  const more = names.length - shown
  return (
    <>
      <span ref={listRef} className="rb-task-items-names">
        {names.slice(0, shown).map((name, i) => (
          <span key={i} data-name="">{i < shown - 1 ? `${name}, ` : name}</span>
        ))}
      </span>
      {more > 0 && <Badge className="rb-task-items-more">{`+${more}`}</Badge>}
    </>
  )
}

// ── The draft, outside the table's state ────────────────────────────────────
// VW1b review round 1 (R1-5): a tick changed the TABLE's state, so every row
// of the table re-rendered at every tick (a long table lagged per tick). The
// draft lives in a store of its own: the open cell and the picker subscribe,
// and a tick re-renders those two only. Any other cell reads null from it and
// never re-renders for it.
function createDraftStore() {
  let value = null
  const heard = new Set()
  return {
    get: () => value,
    set: (next) => { value = next; for (const h of [...heard]) h() },
    subscribe: (h) => { heard.add(h); return () => { heard.delete(h) } },
  }
}
const NO_STORE = { get: () => null, subscribe: () => () => {} }
function useDraft(store, mine) {
  const s = store || NO_STORE
  return useSyncExternalStore(s.subscribe, () => (mine ? s.get() : null), () => null)
}

/**
 * One item cell of the Tasks table: a task's live items of `kind`.
 *   draftStore  the picker's draft (useItemPicker's `store`): read while
 *               this cell's picker is open
 *   open        whether this cell's picker is open
 *   onOpen      (task, kind, element) — a seat that may write, items kept
 *   onOpenWindow  the task's window (where the backend keeps no items)
 */
export function TaskItemCell({ task, kind, lookup, sort, canWrite = true, available = true, draftStore = null, open = false, onOpen, onOpenWindow }) {
  const draft = useDraft(draftStore, open)
  const live = draft ?? lookup.idsOf(task, kind)
  const ids = useMemo(() => sortIdsForDisplay(kind, live, sort, lookup), [kind, live, sort, lookup])
  const names = ids.map(id => lookup.nameOf(kind, id) || `Untitled ${kind}`)
  const said = names.length ? names.join(', ') : NO_KIND_LABEL[kind]
  const empty = names.length ? 'false' : 'true'
  const body = names.length
    ? <ItemNames key={names.join('\u0001')} names={names} />
    : <span className="rb-task-items-names">—</span>
  // Where the backend keeps no items: VW1m's cell (step 0 review, finding 19).
  if (!available) {
    return (
      <button type="button" onClick={onOpenWindow} className="rb-task-cell-text rb-task-items"
        data-empty={empty} title={said} aria-label={said}>
        {body}
      </button>
    )
  }
  if (!canWrite) {
    return (
      <span className="rb-task-cell-text rb-task-items" data-empty={empty} data-static="true" title={said}>
        <span aria-hidden="true" className="rb-task-items-shown">{body}</span>
        <span className="sr-only">{said}</span>
      </span>
    )
  }
  return (
    <button type="button" className="rb-task-cell-text rb-task-items"
      data-item-cell={`${task.id}:${kind}`}
      data-empty={empty}
      aria-haspopup="dialog"
      aria-expanded={open ? 'true' : 'false'}
      aria-label={said}
      title={said}
      onClick={(e) => onOpen?.(task, kind, e.currentTarget)}>
      {body}
    </button>
  )
}

/**
 * The picker's body for one kind: the search, "Show all lists" for scenes and
 * shots, then the rows, each a checkbox (ticked = in the draft). The list is
 * ONE Tab stop (roving focus: ↑ ↓ Home End move, Space or Enter ticks); ↓
 * from the search moves into it, ↑ from its first row back to the search.
 */
function TaskItemPicker({ ctx, kind, lookup, draft, onToggle }) {
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [active, setActive] = useState(0)
  const searchRef = useRef(null)
  const listRef = useRef(null)
  const plural = KIND_LABEL_PLURAL[kind]
  const words = plural.toLowerCase()
  const scopeOn = (kind === 'scene' || kind === 'shot') && itemPickerScopeOn(ctx)
  const offers = itemPickerOffers(ctx, kind, { lookup, showAll, keep: draft, query: search })
  const ticked = new Set((draft || []).map(String))
  const at = Math.min(active, Math.max(0, offers.length - 1))

  const rowAt = (i) => listRef.current?.querySelectorAll('[role="checkbox"]')[i] || null
  const moveTo = (i) => {
    const n = Math.max(0, Math.min(offers.length - 1, i))
    setActive(n)
    rowAt(n)?.focus()
  }
  function onSearchKey(e) {
    if (e.key === 'ArrowDown' && offers.length) { e.preventDefault(); moveTo(at) }
  }
  function onRowKey(e, i, id) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(i + 1) } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (i === 0) searchRef.current?.focus()
      else moveTo(i - 1)
    } else if (e.key === 'Home') { e.preventDefault(); moveTo(0) } else if (e.key === 'End') {
      e.preventDefault(); moveTo(offers.length - 1)
    } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(id) }
  }

  return (
    <div className="rb-task-pick">
      <div className="rb-task-pick-search">
        <Search aria-hidden="true" className="rb-task-pick-search-icon" />
        <input ref={searchRef} type="text" value={search}
          onChange={e => { setSearch(e.target.value); setActive(0) }}
          onKeyDown={onSearchKey}
          placeholder={`Search ${words}…`}
          aria-label={`Search ${words}`}
          className="ui-input rb-task-pick-input" data-size="sm" />
      </div>
      {scopeOn && (
        <div className="rb-task-pick-scope">
          <Switch checked={showAll} onChange={setShowAll} label="Show all lists" />
        </div>
      )}
      <div ref={listRef} className="rb-task-pick-list" role="group" aria-label={plural}>
        {offers.length === 0 ? (
          <p className="rb-task-pick-empty">{search.trim() ? 'No matches' : `No ${words} in this project yet`}</p>
        ) : offers.map((o, i) => {
          const on = ticked.has(String(o.row.id))
          return (
            <div key={o.row.id} role="checkbox" aria-checked={on ? 'true' : 'false'}
              tabIndex={i === at ? 0 : -1}
              className="rb-task-pick-row"
              data-ticked={on ? 'true' : 'false'}
              onClick={() => { setActive(i); onToggle(o.row.id) }}
              onKeyDown={(e) => onRowKey(e, i, o.row.id)}>
              <span className="rb-task-pick-tick" aria-hidden="true">{on ? <CheckSquare /> : <Square />}</span>
              <span className="rb-task-pick-name">{o.name}</span>
              {o.apart && <span className="rb-task-pick-apart">{o.apart}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The open picker, in the kit Popover: its own subscription to the draft, so
 * a tick re-renders it and the open cell only (R1-5).
 */
function PickerLayer({ store, picking, ctx, lookup, title, onToggle, onClose, returnFocus }) {
  const draft = useSyncExternalStore(store.subscribe, store.get, () => null) || picking.original
  return (
    <Popover
      anchor={picking.anchor}
      minLeft={picking.minLeft}
      label={`${KIND_LABEL_PLURAL[picking.kind]} of ${title}`}
      width={280}
      returnFocus={returnFocus}
      onClose={onClose}
    >
      <TaskItemPicker ctx={ctx} kind={picking.kind} lookup={lookup} draft={draft} onToggle={onToggle} />
    </Popover>
  )
}

/** A selector for an attribute's value, whatever an id holds. */
function cssString(v) {
  return String(v).replace(/["\\]/g, '\\$&')
}

/**
 * VW1b review round 1 (R1-6): where a sticky column's cover ends on screen —
 * the table's last sticky head cell's right edge — for a cell that is not
 * itself sticky; null where nothing covers it. A cell scrolled partly under
 * the sticky Title opened its picker under the Title.
 */
function coverEndOf(anchor) {
  const table = anchor?.closest?.('table')
  const n = Number(table?.getAttribute('data-sticky-columns')) || 0
  const last = n ? table.tHead?.rows?.[0]?.cells?.[n - 1] : null
  if (!last) return null
  const cell = anchor.closest('td, th')
  if (cell && cell.cellIndex < n) return null
  return last.getBoundingClientRect().right
}

/**
 * The picking itself, owned by the TABLE (not the cell: grouped by the kind
 * being edited, the row moves group after the commit, and its cell with it).
 * Returns `{ picking, open, layer, store }`: which cell is open, the cells'
 * open handler, the Popover (and the last item's question) to render once in
 * the table, and the draft's store the open cell reads (R1-5).
 *   tableRef  the element the cells are in (a cell is found again by its
 *             `data-item-cell` there, after its row re-rendered or moved)
 *   onFail    (sentence) — a refused or failed write, said in the tab's
 *             Banner (VW1m R2-2's route)
 */
export function useItemPicker({ ctx, lookup, tableRef, onFail }) {
  const storeRef = useRef(null)
  if (!storeRef.current) storeRef.current = createDraftStore()
  const store = storeRef.current
  const [picking, setPicking] = useState(null) // { taskId, kind, anchor, original, minLeft }
  const [asking, setAsking] = useState(null)   // the id whose untick asks
  const now = useRef({ ctx, lookup, picking, onFail })
  now.current = { ctx, lookup, picking, onFail }

  const cellOf = useCallback((taskId, kind) => {
    const root = tableRef.current
    return root ? root.querySelector(`[data-item-cell="${cssString(`${taskId}:${kind}`)}"]`) : null
  }, [tableRef])

  // Close, and commit what changed (once).
  const close = useCallback(() => {
    const p = now.current.picking
    if (!p) return
    const draft = store.get() || p.original
    setPicking(null)
    setAsking(null)
    store.set(null)
    const { ctx: c, lookup: l, onFail: fail } = now.current
    const task = (c?.tasks || []).find(t => t.id === p.taskId)
    if (!task || !c?.setTaskItemsOfKind) return
    const had = new Set(p.original.map(String))
    const has = new Set(draft.map(String))
    const added = draft.filter(id => !had.has(String(id)))
    const removed = p.original.filter(id => !has.has(String(id)))
    if (!added.length && !removed.length) return
    // Applied to the task's items as they are NOW: a teammate's change made
    // while the picker was open stays.
    const gone = new Set(removed.map(String))
    const live = l.idsOf(task, p.kind)
    const want = [...live.filter(id => !gone.has(String(id))), ...added.filter(id => !live.some(x => String(x) === String(id)))]
    const title = task.title || 'Untitled task'
    const name = (id) => l.nameOf(p.kind, id) || `Untitled ${p.kind}`
    const words = (added.length === 1 && !removed.length) ? `Added "${name(added[0])}" to "${title}"`
      : (removed.length === 1 && !added.length) ? `Removed "${name(removed[0])}" from "${title}"`
        : `Changed the ${KIND_LABEL_PLURAL[p.kind].toLowerCase()} of "${title}"`
    const step = c.runWithUndoToast || ((run) => run())
    Promise.resolve(step(() => c.setTaskItemsOfKind(p.taskId, p.kind, want), words))
      .catch(err => fail?.(`Could not change the ${KIND_LABEL_PLURAL[p.kind].toLowerCase()} of “${title}”: ${err?.message || err}`))
      .finally(() => {
        // Grouped by this kind the row has moved: its cell in its new place
        // takes the keyboard back, unless the person has gone elsewhere.
        const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16)
        later(() => {
          const a = document.activeElement
          if (a && a !== document.body) return
          cellOf(p.taskId, p.kind)?.focus()
        })
      })
  }, [cellOf, store])

  const open = useCallback((task, kind, anchor) => {
    const p = now.current.picking
    if (p) {
      const same = p.taskId === task.id && p.kind === kind
      close()
      if (same) return
    }
    const original = now.current.lookup.idsOf(task, kind)
    store.set(original.slice())
    setPicking({ taskId: task.id, kind, anchor, original, minLeft: coverEndOf(anchor) })
  }, [close, store])

  const toggle = useCallback((id) => {
    const p = now.current.picking
    if (!p) return
    const draft = store.get() || p.original
    const on = draft.some(x => String(x) === String(id))
    if (on) {
      // The task's last live item, of any kind, asks first (the window's rule).
      const task = (now.current.ctx?.tasks || []).find(t => t.id === p.taskId)
      const others = task ? ITEM_KINDS.filter(k => k !== p.kind).reduce((n, k) => n + now.current.lookup.idsOf(task, k).length, 0) : 1
      if (others === 0 && draft.length === 1) { setAsking(id); return }
      store.set(draft.filter(x => String(x) !== String(id)))
    } else {
      store.set([...draft, id])
    }
  }, [store])

  // The task gone (deleted here or by a teammate): nothing left to edit.
  const taskThere = !picking || (ctx?.tasks || []).some(t => t.id === picking.taskId)
  useEffect(() => { if (!taskThere) { setPicking(null); setAsking(null); store.set(null) } }, [taskThere, store])

  let layer = null
  if (picking && taskThere) {
    const task = (ctx?.tasks || []).find(t => t.id === picking.taskId)
    const title = task?.title || 'Untitled task'
    const askName = asking != null ? (lookup.nameOf(picking.kind, asking) || `Untitled ${picking.kind}`) : null
    layer = (
      <>
        <PickerLayer
          key={`${picking.taskId}:${picking.kind}`}
          store={store}
          picking={picking}
          ctx={ctx}
          lookup={lookup}
          title={title}
          onToggle={toggle}
          onClose={close}
          returnFocus={() => cellOf(picking.taskId, picking.kind)}
        />
        {askName != null && createPortal(
          <Dialog
            width="confirm"
            title="Remove the last item"
            onClose={() => setAsking(null)}
            footer={(
              <>
                <Button autoFocus onClick={() => setAsking(null)}>Cancel</Button>
                <Button variant="danger" onClick={() => {
                  const id = asking
                  setAsking(null)
                  const draft = store.get()
                  if (draft) store.set(draft.filter(x => String(x) !== String(id)))
                }}>
                  Remove
                </Button>
              </>
            )}
          >
            {`Remove “${askName}”? It is this task's only item: the Timeline and the Budget will show the task under no asset, scene or shot until you add one.`}
          </Dialog>,
          document.body,
        )}
      </>
    )
  }
  return { picking, open, layer, store }
}
