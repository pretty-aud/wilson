// ============================================================
// RABBIT — the Views button and its dropdown (VW1d, 2026-10-25)
// ============================================================
//
// docs/design/CUSTOM_VIEWS_DESIGN.md §4.1 to §4.3 and §4.9, as VW1d's step 0
// review corrected them (§11 round 5). The shared piece (§6): a table gives
// it its description and its useTableView; VW1e gives it the other tables.
//
// Her answers: Q5 (the dropdown lists the project's views, the one on
// screen ticked, and holds Filters, Sort, Group and Fields, each opening a
// card of its own; *New view* and a *…* per view — Edit, Rename, Duplicate,
// Delete, which asks first — for people who may save; the button shows the
// view's name), Q5a (the Filters card: the filters set now, then a button to
// add one, in today's filter row), Q5b (a card opens in place of the list,
// with a ←), Q5c (views in the order made, *All* first; people who may save
// drag them into another order), Q-A2 (no *edited* word, no dot: the bar is
// the sign), Q-F (a seat that cannot write sees no handles, moves, *…* or
// *New view*), Q-G1 (a New view is saved at once, starting as All), Q-H
// (choosing a view drops a change for now without asking), Q14, Q15, Q-I,
// Q6, Q7, Q-E, Q-J.
//
// ── The laws that shape it (laws-of-ux, design-direction) ───────────────────
//  · Jakob's law — Notion's own pattern, as she asked: a list of views, then
//    the view's four parts, each opening its card in place, and changes that
//    stay "for the moment" until the bar's Save.
//  · Working memory — a card replaces the list in place (Q5b) and the card
//    never grows past the room under the button, so the rows stay in view and
//    change as the filter is set; the button always names the view on screen.
//  · Hick's law / choice overload — the list is the views and four parts; the
//    editing controls (handle, Move up, Move down, *…*) show on the row's
//    hover or focus only, and only for people who may save.
//  · Law of common region — two sections under their Label-step labels
//    (*Views*, *This view*) with a hairline between, not two boxes.
//  · Fitts's law — the row's name is the target (the whole row's width); the
//    moves sit at the row's end, beside the *…* they belong with.
// Inks: 0 new. Families: 0 new. Weights 400 and 600 only.
//
// ── Keyboard (§4.9; defect 5) ───────────────────────────────────────────────
// The dropdown is a non-modal dialog (the kit Popover, in place): Tab moves
// through it in the document's order and Tab past its end closes it. The
// views list and the Fields list are GRIDS: ↑ / ↓ between rows, ← / →
// between a row's controls, only the active row's controls in the Tab order;
// Alt+↑ / Alt+↓ on a row's handle moves the row. Enter or Space chooses. One
// Escape path (finding 3): the Popover hears Escape first and asks here — a
// name field open is cancelled, a card goes back to the list, the list
// closes and the keyboard goes back to the button.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  BookmarkPlus, ChevronDown, ChevronLeft, ChevronRight, Check, GripVertical, ArrowUp, ArrowDown, Plus, X,
} from 'lucide-react'
import { Button, IconButton, Popover, HoverActions, MenuButton, Switch } from '../../../../ui'
import {
  effectiveFields, fieldsToStore, moveField, moveItem, filtersSummary, sortSummary, groupSummary, fieldsSummary,
} from './viewScreenModel'
import { ViewFilterRow } from './ViewFilterRow'
import './tableViews.css'

const LIST_WIDTH = 300
// Today's filter row is about 532px before the card's padding (finding 7).
const WIDE_WIDTH = 560
const CARD_TITLES = { filters: 'Filters', sort: 'Sort', group: 'Group', fields: 'Fields' }

/** A grid cell's control: the `[data-col]` element, or the button inside it. */
function controlOf(el) {
  if (!el) return null
  return el.matches('button, input, select') ? el : el.querySelector('button')
}

/**
 * The Views button and its dropdown. `tv` is the table's useTableView;
 * `ask` the root's question (useAsk); `announce` the table's polite live
 * region; `onRetry` reloads the project (the error state's *Try again*).
 */
export function TableViewsMenu({ tv, description, ask, announce = () => {}, onRetry = null }) {
  const [open, setOpen] = useState(false)
  const [card, setCard] = useState(null)
  const buttonRef = useRef(null)
  const [renaming, setRenaming] = useState(null)   // { id, text, error }
  const [creating, setCreating] = useState(null)   // { text, error }
  const [backTo, setBackTo] = useState(null)       // the part row to focus after a card
  const listInitialRef = useRef(null)

  const config = tv.config
  const board = config.layout === 'board'
  const width = card === 'filters' || card === 'sort' ? WIDE_WIDTH : LIST_WIDTH

  function close() {
    setOpen(false)
    setCard(null)
    setRenaming(null)
    setCreating(null)
  }
  // The one Escape path (finding 3); the rest close.
  function onPopoverClose(why) {
    if (why === 'escape') {
      if (renaming) { setRenaming(null); return }
      if (creating) { setCreating(null); return }
      if (card) { setBackTo(card); setCard(null); return }
    }
    close()
  }

  return (
    <span className="rb-tv-anchor">
      <Button
        ref={buttonRef}
        size="sm"
        Icon={BookmarkPlus}
        className="rb-tv-button"
        data-table={description.tableKey}
        aria-label={`Views: ${tv.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={tv.name}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="rb-tv-button-name">{tv.name}</span>
        <ChevronDown aria-hidden="true" className="rb-tv-button-chevron" />
      </Button>
      {open && buttonRef.current && (
        <Popover
          inPlace
          anchor={buttonRef.current}
          label={card ? `Views: ${CARD_TITLES[card]}` : 'Views'}
          width={width}
          initialFocus={listInitialRef}
          onClose={onPopoverClose}
          className="rb-tv-pop"
        >
          {card ? (
            <ViewCard card={card} tv={tv} description={description} announce={announce}
              onBack={() => { setBackTo(card); setCard(null) }} />
          ) : (
            <ViewsList
              tv={tv} description={description} ask={ask} announce={announce} onRetry={onRetry}
              board={board} initialRef={listInitialRef}
              renaming={renaming} setRenaming={setRenaming}
              creating={creating} setCreating={setCreating}
              backTo={backTo} clearBackTo={() => setBackTo(null)}
              onChosen={close}
              onOpenCard={(name) => setCard(name)}
            />
          )}
        </Popover>
      )}
    </span>
  )
}

// ── The list: Views, This view, New view ────────────────────────────────

function ViewsList({
  tv, description, ask, announce, onRetry, board, initialRef,
  renaming, setRenaming, creating, setCreating, backTo, clearBackTo, onChosen, onOpenCard,
}) {
  const rows = [tv.allView, ...tv.views]
  const canEdit = tv.canEdit
  const stored = tv.views
  const currentIndex = Math.max(0, rows.findIndex(v => !tv.deleted && String(v.id) === String(tv.viewId)))
  const [activeRow, setActiveRow] = useState(currentIndex)
  const at = Math.min(activeRow, rows.length - 1)
  const gridRef = useRef(null)
  const partsRef = useRef(null)
  const [pendingFocus, setPendingFocus] = useState(null) // { id } | { index } | { button: true } | { part }
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  // Focus after the list changed (a delete, a duplicate, a new view) or a card closed.
  useLayoutEffect(() => {
    if (backTo) {
      partsRef.current?.querySelector(`[data-part="${backTo}"]`)?.focus()
      clearBackTo()
    }
  }, [backTo, clearBackTo])
  useEffect(() => {
    if (!pendingFocus) return
    const grid = gridRef.current
    let el = null
    if (pendingFocus.id != null) {
      const i = rows.findIndex(v => String(v.id) === String(pendingFocus.id))
      if (i >= 0) { setActiveRow(i); el = grid?.querySelector(`[data-row="${i}"] [data-col="name"]`) }
    } else if (pendingFocus.index != null) {
      const i = Math.min(pendingFocus.index, rows.length - 1)
      setActiveRow(i)
      el = grid?.querySelector(`[data-row="${i}"] [data-col="name"]`)
    } else if (pendingFocus.part) {
      el = partsRef.current?.querySelector(`[data-part="${pendingFocus.part}"]`)
    }
    if (el) el.focus()
    else if (pendingFocus.index != null || pendingFocus.id != null) document.querySelector('.rb-tv-button')?.focus()
    setPendingFocus(null)
  }) // after every render until it lands

  const tabOf = (i) => (i === at ? 0 : -1)
  const positionWords = (v) => `${stored.findIndex(x => x.id === v.id) + 1} of ${stored.length}`

  async function moveTo(v, by) {
    const ids = stored.map(x => x.id)
    const i = ids.indexOf(v.id)
    const next = moveItem(ids, i, by)
    if (next.join('|') === ids.join('|')) return
    try {
      await tv.reorder(next)
      announce(`${v.name} moved to ${next.indexOf(v.id) + 1} of ${next.length}`)
    } catch (err) {
      announce(`${v.name} could not be moved: ${err?.message || err}`)
    }
  }
  async function dropOn(target) {
    const from = dragId
    setDragId(null); setOverId(null)
    if (!from || String(from) === String(target.id)) return
    const ids = stored.map(x => x.id).filter(id => String(id) !== String(from))
    const to = target.builtIn ? 0 : ids.findIndex(id => String(id) === String(target.id))
    const moved = stored.find(x => String(x.id) === String(from))
    ids.splice(target.builtIn ? 0 : to, 0, moved.id)
    try {
      await tv.reorder(ids)
      announce(`${moved.name} moved to ${ids.indexOf(moved.id) + 1} of ${ids.length}`)
    } catch (err) {
      announce(`${moved.name} could not be moved: ${err?.message || err}`)
    }
  }

  // The grid's keyboard (§4.9). A cell's control is the `[data-col]` element
  // itself, or the button inside it (the *…*, which is a MenuButton).
  function onGridKey(e) {
    const t = e.target
    if (!(t instanceof Element) || t.tagName === 'INPUT') return
    const rowEl = t.closest('[data-row]')
    if (!rowEl) return
    const i = Number(rowEl.getAttribute('data-row'))
    const controls = [...rowEl.querySelectorAll('[data-col]')].filter(el => !controlOf(el)?.disabled)
    const c = controls.indexOf(t.closest('[data-col]'))
    const col = t.closest('[data-col]')?.getAttribute('data-col')
    const focusRow = (n) => {
      const k = Math.max(0, Math.min(rows.length - 1, n))
      setActiveRow(k)
      const target = gridRef.current?.querySelector(`[data-row="${k}"] [data-col="${col}"]`)
        || gridRef.current?.querySelector(`[data-row="${k}"] [data-col="name"]`)
      // The row's controls take the Tab stop in the next render; focus now.
      controlOf(target)?.focus()
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && col === 'handle') {
      e.preventDefault()
      const v = rows[i]
      if (v && !v.builtIn) moveTo(v, e.key === 'ArrowUp' ? -1 : 1)
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(i + 1) } else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(i - 1) } else if (e.key === 'Home') { e.preventDefault(); focusRow(0) } else if (e.key === 'End') { e.preventDefault(); focusRow(rows.length - 1) } else if (e.key === 'ArrowRight' && c >= 0 && c < controls.length - 1) { e.preventDefault(); controlOf(controls[c + 1])?.focus() } else if (e.key === 'ArrowLeft' && c > 0) { e.preventDefault(); controlOf(controls[c - 1])?.focus() }
  }

  async function commitRename() {
    if (!renaming) return
    const v = stored.find(x => String(x.id) === String(renaming.id))
    if (!v) { setRenaming(null); return }
    try {
      await tv.rename(v, renaming.text)
      setRenaming(null)
      setPendingFocus({ id: v.id })
    } catch (err) {
      setRenaming(r => (r ? { ...r, error: err?.message || String(err) } : r))
    }
  }
  async function commitCreate() {
    if (!creating) return
    try {
      const made = await tv.create(creating.text)
      setCreating(null)
      setPendingFocus({ id: made.id })
    } catch (err) {
      setCreating(c => (c ? { ...c, error: err?.message || String(err) } : c))
    }
  }
  async function duplicate(v) {
    try {
      const made = await tv.duplicate(v)
      setPendingFocus({ id: made.id })
    } catch (err) {
      announce(`${v.name} could not be duplicated: ${err?.message || err}`)
    }
  }
  async function remove(v) {
    const index = rows.findIndex(x => x.id === v.id)
    const yes = await ask({ title: `Delete ${v.name} for everyone on this project?`, confirm: 'Delete', danger: true })
    if (!yes) { setPendingFocus({ id: v.id }); return }
    try {
      await tv.remove(v)
      // The kit Dialog gave focus back to the deleted row's …, gone (finding
      // 14): the next row, or the Views button.
      setPendingFocus({ index: index < rows.length - 1 ? index : index - 1 })
    } catch (err) {
      announce(`${v.name} could not be deleted: ${err?.message || err}`)
    }
  }

  const fieldsNow = effectiveFields(tv.config.fields, description.fieldKeys, { fixed: description.fixed })
  const shownFields = board ? fieldsNow.filter(f => description.cardFields.includes(f.key)) : fieldsNow
  const parts = [
    { part: 'filters', label: 'Filters', summary: filtersSummary(tv.config) },
    { part: 'sort', label: 'Sort', summary: sortSummary(tv.config, description) },
    { part: 'group', label: 'Group', summary: groupSummary(tv.config, description) },
    { part: 'fields', label: 'Fields', summary: fieldsSummary(shownFields) },
  ]

  return (
    <div className="rb-tv-body">
      <div className="rb-tv-section-label text-label uppercase" id="rb-tv-views-label">Views</div>
      <div ref={gridRef} role="grid" aria-labelledby="rb-tv-views-label" className="rb-tv-list" onKeyDown={onGridKey}>
        {rows.map((v, i) => {
          const current = !tv.deleted && String(v.id) === String(tv.viewId)
          const movable = canEdit && !v.builtIn
          const tab = tabOf(i)
          const isRenaming = renaming && String(renaming.id) === String(v.id)
          return (
            <div
              key={v.id}
              role="row"
              data-row={i}
              aria-current={current ? 'true' : undefined}
              className="rb-tv-row ui-hover-host"
              data-current={current ? 'true' : 'false'}
              data-over={overId != null && String(overId) === String(v.id) ? 'true' : 'false'}
              draggable={movable && dragId != null && String(dragId) === String(v.id)}
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(v.id)); e.dataTransfer.effectAllowed = 'move' }}
              onDragEnd={() => { setDragId(null); setOverId(null) }}
              onDragOver={(e) => { if (dragId != null && canEdit) { e.preventDefault(); setOverId(v.id) } }}
              onDrop={(e) => { e.preventDefault(); dropOn(v) }}
              onFocus={() => setActiveRow(i)}
            >
              {canEdit && (
                <div role="gridcell" className="rb-tv-cell rb-tv-cell-handle">
                  {movable && (
                    <HoverActions>
                      <IconButton size="sm" Icon={GripVertical} data-col="handle" tabIndex={tab}
                        title={`Move ${v.name}, ${positionWords(v)}`}
                        className="rb-tv-handle"
                        onPointerDown={() => setDragId(v.id)}
                        onPointerUp={() => { if (dragId != null) setDragId(null) }} />
                    </HoverActions>
                  )}
                </div>
              )}
              <div role="gridcell" className="rb-tv-cell rb-tv-cell-name">
                {isRenaming ? (
                  <span className="rb-tv-field">
                    <input autoFocus type="text" value={renaming.text} aria-label={`Rename ${v.name}`}
                      className="ui-input rb-tv-input" data-size="sm"
                      aria-invalid={renaming.error ? 'true' : undefined}
                      onChange={e => setRenaming({ ...renaming, text: e.target.value, error: null })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitRename() } }} />
                    {renaming.error && <span className="rb-tv-field-error" role="alert">{renaming.error}</span>}
                  </span>
                ) : (
                  <button type="button" className="rb-tv-name" data-col="name" tabIndex={tab}
                    ref={current || (i === 0 && tv.deleted) ? initialRef : undefined}
                    title={v.name}
                    onClick={() => { tv.choose(v.id); onChosen() }}>
                    <span className="rb-tv-tick" aria-hidden="true">{current ? <Check /> : null}</span>
                    <span className="rb-tv-name-text">{v.name}</span>
                  </button>
                )}
              </div>
              {canEdit && (
                <div role="gridcell" className="rb-tv-cell rb-tv-cell-end">
                  {movable && !isRenaming && (
                    <HoverActions>
                      <IconButton size="sm" Icon={ArrowUp} data-col="up" tabIndex={tab} title={`Move ${v.name} up`}
                        disabled={stored[0]?.id === v.id} onClick={() => moveTo(v, -1)} />
                      <IconButton size="sm" Icon={ArrowDown} data-col="down" tabIndex={tab} title={`Move ${v.name} down`}
                        disabled={stored[stored.length - 1]?.id === v.id} onClick={() => moveTo(v, 1)} />
                      <span data-col="more" className="rb-tv-more">
                        <MenuButton title={`More for ${v.name}`} tabIndex={tab} minWidth={160} items={[
                          { label: 'Edit', onClick: () => { tv.choose(v.id); setPendingFocus({ part: 'filters' }) } },
                          { label: 'Rename', onClick: () => setRenaming({ id: v.id, text: v.name, error: null }) },
                          { label: 'Duplicate', onClick: () => duplicate(v) },
                          { divider: true },
                          { label: 'Delete', danger: true, onClick: () => remove(v) },
                        ]} />
                      </span>
                    </HoverActions>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {tv.error && (
        <div className="rb-tv-state" role="status">
          <span>Views could not be loaded.</span>
          {onRetry && <Button size="sm" variant="ghost" onClick={onRetry}>Try again</Button>}
        </div>
      )}
      {!tv.error && tv.api && !tv.available && (
        <p className="rb-tv-state">Saved views are not on this server yet.</p>
      )}
      {!tv.error && canEdit && stored.length === 0 && (
        <p className="rb-tv-hint">Change the table, then <em>Save as new view</em>, or start a <em>New view</em>.</p>
      )}

      <div className="rb-tv-rule" aria-hidden="true" />
      <div className="rb-tv-section-label text-label uppercase">This view</div>
      <div ref={partsRef} className="rb-tv-parts">
        {parts.map(p => (
          <button key={p.part} type="button" className="rb-tv-part" data-part={p.part}
            aria-label={`${p.label}: ${p.summary}`}
            onClick={() => onOpenCard(p.part)}>
            <span className="rb-tv-part-name">{p.label}</span>
            <span className="rb-tv-part-summary">{p.summary}</span>
            <ChevronRight aria-hidden="true" className="rb-tv-part-chevron" />
          </button>
        ))}
      </div>

      {canEdit && (
        <>
          <div className="rb-tv-rule" aria-hidden="true" />
          {creating ? (
            <span className="rb-tv-field rb-tv-new-field">
              <input autoFocus type="text" value={creating.text} aria-label="View name" placeholder="View name"
                className="ui-input rb-tv-input" data-size="sm"
                aria-invalid={creating.error ? 'true' : undefined}
                onChange={e => setCreating({ text: e.target.value, error: null })}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitCreate() } }} />
              {creating.error && <span className="rb-tv-field-error" role="alert">{creating.error}</span>}
            </span>
          ) : (
            <button type="button" className="rb-tv-new" onClick={() => setCreating({ text: '', error: null })}>
              <Plus aria-hidden="true" />
              <span>New view</span>
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ── The four cards (§4.3) ───────────────────────────────────────────────

function ViewCard({ card, tv, description, announce, onBack }) {
  // The part's row that opened the card is gone: the keyboard goes to the
  // card's first control, its ←.
  const backRef = useRef(null)
  useLayoutEffect(() => { backRef.current?.focus() }, [])
  return (
    <div className="rb-tv-body">
      <div className="rb-tv-card-head">
        <IconButton ref={backRef} size="sm" Icon={ChevronLeft} title="Back to views" onClick={onBack} />
        <span className="rb-tv-card-title">{CARD_TITLES[card]}</span>
      </div>
      {card === 'filters' && <FiltersCard tv={tv} description={description} />}
      {card === 'sort' && <SortCard tv={tv} description={description} announce={announce} />}
      {card === 'group' && <GroupCard tv={tv} description={description} />}
      {card === 'fields' && <FieldsCard tv={tv} description={description} announce={announce} />}
    </div>
  )
}

function FiltersCard({ tv, description }) {
  const filters = tv.config.filters || []
  const first = description.filterFields[0]
  return (
    <div className="rb-tv-card">
      {filters.length === 0 && <p className="rb-tv-hint">No filters: every row shows.</p>}
      {filters.map((f, i) => (
        <ViewFilterRow key={i} row={f} index={i} description={description}
          onChange={(row) => tv.update(c => ({ ...c, filters: (c.filters || []).map((x, j) => (j === i ? row : x)) }))}
          onRemove={() => tv.update(c => ({ ...c, filters: (c.filters || []).filter((_, j) => j !== i) }))} />
      ))}
      <div className="rb-tv-card-foot">
        <Button size="sm" variant="ghost" Icon={Plus}
          onClick={() => tv.update(c => ({ ...c, filters: [...(c.filters || []), { field: first.key, op: description.filterOps(first)[0].value, values: [] }] }))}>
          Add filter
        </Button>
      </div>
    </div>
  )
}

function SortCard({ tv, description, announce }) {
  const sorts = tv.config.sorts || []
  const labelOf = (k) => description.field(k)?.label || k
  const set = (next) => tv.update(c => ({ ...c, sorts: next }))
  const unused = description.sortFields.filter(f => !sorts.some(s => s.field === f.key))
  function move(i, by) {
    const next = moveItem(sorts, i, by)
    if (next === sorts || JSON.stringify(next) === JSON.stringify(sorts)) return
    set(next)
    announce(`${labelOf(sorts[i].field)} moved to ${i + by + 1} of ${sorts.length}`)
  }
  return (
    <div className="rb-tv-card">
      {sorts.length === 0 && <p className="rb-tv-hint">Default order.</p>}
      {sorts.map((s, i) => (
        <div key={`${s.field}-${i}`} className="rb-tv-sort-row ui-hover-host">
          <IconButton size="sm" Icon={GripVertical} className="rb-tv-handle"
            title={`Move ${labelOf(s.field)}, ${i + 1} of ${sorts.length}`}
            onKeyDown={(e) => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(i, e.key === 'ArrowUp' ? -1 : 1) } }} />
          <select value={s.field} aria-label="Sort by" className="ui-input rb-tv-sort-field" data-size="sm"
            onChange={e => set(sorts.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
            {description.sortFields.filter(f => f.key === s.field || !sorts.some(x => x.field === f.key)).map(f => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <select value={s.dir} aria-label="Direction" className="ui-input rb-tv-sort-dir" data-size="sm"
            onChange={e => set(sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value } : x)))}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <HoverActions>
            <IconButton size="sm" Icon={ArrowUp} title={`Move ${labelOf(s.field)} up`} disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton size="sm" Icon={ArrowDown} title={`Move ${labelOf(s.field)} down`} disabled={i === sorts.length - 1} onClick={() => move(i, 1)} />
          </HoverActions>
          <IconButton size="sm" Icon={X} danger title={`Remove the sort by ${labelOf(s.field)}`} onClick={() => set(sorts.filter((_, j) => j !== i))} />
        </div>
      ))}
      {unused.length > 0 && (
        <div className="rb-tv-card-foot">
          <Button size="sm" variant="ghost" Icon={Plus} onClick={() => set([...sorts, { field: unused[0].key, dir: 'asc' }])}>Add sort</Button>
        </div>
      )}
    </div>
  )
}

function GroupCard({ tv, description }) {
  const board = tv.config.layout === 'board'
  const g = board ? tv.config.board : tv.config.group
  const field = g?.field || ''
  const setField = (value) => tv.update(c => {
    const layout = board ? 'board' : 'table'
    const next = value ? { field: value, hideEmpty: description.hideEmptyDefault(layout, value) } : null
    return board ? { ...c, board: next || c.board } : { ...c, group: next }
  })
  const setHide = (on) => tv.update(c => (board
    ? { ...c, board: { ...(c.board || {}), hideEmpty: on } }
    : { ...c, group: c.group ? { ...c.group, hideEmpty: on } : c.group }))
  return (
    <div className="rb-tv-card">
      <label className="rb-tv-row-field">
        <span className="rb-tv-row-label">{board ? 'Columns by' : 'Group by'}</span>
        <select value={field} aria-label={board ? 'Columns by' : 'Group by'} className="ui-input rb-tv-group-field" data-size="sm"
          onChange={e => setField(e.target.value)}>
          {!board && <option value="">None</option>}
          {description.groupFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </label>
      <div className="rb-tv-switch-row">
        <Switch checked={!!g?.hideEmpty} disabled={!field} onChange={setHide} label="Hide empty groups" />
      </div>
      {board && <p className="rb-tv-hint">The table&apos;s grouping is set in the Table layout.</p>}
    </div>
  )
}

function FieldsCard({ tv, description, announce }) {
  const board = tv.config.layout === 'board'
  const list = effectiveFields(tv.config.fields, description.fieldKeys, { fixed: description.fixed })
  const labelOf = (k) => description.columns.find(c => c.key === k)?.label || description.field(k)?.label || k
  const store = (next) => tv.update(c => ({ ...c, fields: fieldsToStore(next, c.fields, description.fieldKeys) }))
  const setShown = (key, on) => store(list.map(f => (f.key === key ? { ...f, visible: on } : f)))
  const [active, setActive] = useState(0)
  const gridRef = useRef(null)
  // On the Board the card's own fields, in the card's order (finding 6).
  const rows = board ? description.cardFields.map(k => list.find(f => f.key === k)).filter(Boolean) : list
  const at = Math.min(active, rows.length - 1)
  function move(key, by) {
    const next = moveField(list, key, by)
    if (JSON.stringify(next) === JSON.stringify(list)) return
    store(next)
    const pos = next.filter(f => !f.fixed).findIndex(f => f.key === key)
    announce(`${labelOf(key)} moved to ${pos + 1} of ${next.filter(f => !f.fixed).length}`)
  }
  function onGridKey(e) {
    const t = e.target
    if (!(t instanceof Element)) return
    const rowEl = t.closest('[data-row]')
    if (!rowEl) return
    const i = Number(rowEl.getAttribute('data-row'))
    const controls = [...rowEl.querySelectorAll('[data-col]')]
    const c = controls.indexOf(t.closest('[data-col]'))
    const col = t.closest('[data-col]')?.getAttribute('data-col')
    const focusRow = (n) => {
      const k = Math.max(0, Math.min(rows.length - 1, n))
      setActive(k)
      const target = gridRef.current?.querySelector(`[data-row="${k}"] [data-col="${col}"]:not(:disabled)`)
        || gridRef.current?.querySelector(`[data-row="${k}"] [data-col]:not(:disabled)`)
      target?.focus()
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && col === 'handle') {
      e.preventDefault()
      move(rows[i].key, e.key === 'ArrowUp' ? -1 : 1)
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(i + 1) } else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(i - 1) } else if (e.key === 'ArrowRight' && c >= 0 && c < controls.length - 1) { e.preventDefault(); controls[c + 1].focus() } else if (e.key === 'ArrowLeft' && c > 0) { e.preventDefault(); controls[c - 1].focus() }
  }
  const movable = list.filter(f => !f.fixed)
  // Show all / Hide all: every field but the name (on the Board, the card's own).
  function showAll(on) {
    const touches = (f) => !f.fixed && (!board || description.cardFields.includes(f.key))
    store(list.map(f => (touches(f) ? { ...f, visible: on } : f)))
  }
  return (
    <div className="rb-tv-card">
      {board && <p className="rb-tv-hint">What a card shows. The card keeps its own order.</p>}
      <div ref={gridRef} role="grid" aria-label={board ? 'Card fields' : 'Fields'} className="rb-tv-list" onKeyDown={onGridKey}>
        {rows.map((f, i) => {
          const tab = i === at ? 0 : -1
          const label = labelOf(f.key)
          const canMove = !board && !f.fixed
          const mi = movable.findIndex(x => x.key === f.key)
          return (
            <div key={f.key} role="row" data-row={i} className="rb-tv-row ui-hover-host" onFocus={() => setActive(i)}>
              <div role="gridcell" className="rb-tv-cell rb-tv-cell-handle">
                {canMove && (
                  <HoverActions>
                    <IconButton size="sm" Icon={GripVertical} data-col="handle" tabIndex={tab} className="rb-tv-handle"
                      title={`Move ${label}, ${mi + 1} of ${movable.length}`} />
                  </HoverActions>
                )}
              </div>
              <div role="gridcell" className="rb-tv-cell rb-tv-cell-name">
                <span className="rb-tv-field-name">{label}</span>
              </div>
              <div role="gridcell" className="rb-tv-cell rb-tv-cell-end">
                {canMove && (
                  <HoverActions>
                    <IconButton size="sm" Icon={ArrowUp} data-col="up" tabIndex={tab} title={`Move ${label} up`}
                      disabled={mi <= 0} onClick={() => move(f.key, -1)} />
                    <IconButton size="sm" Icon={ArrowDown} data-col="down" tabIndex={tab} title={`Move ${label} down`}
                      disabled={mi >= movable.length - 1} onClick={() => move(f.key, 1)} />
                  </HoverActions>
                )}
                <Switch data-col="show" tabIndex={tab} checked={f.visible} disabled={f.fixed}
                  title={f.fixed ? 'Always shown' : undefined}
                  aria-label={f.fixed ? `${label}: always shown` : `Show ${label}`}
                  onChange={(on) => setShown(f.key, on)} />
              </div>
            </div>
          )
        })}
      </div>
      {!board && description.tableKey === 'tasks' && (
        <div className="rb-tv-switch-row">
          <Switch checked={tv.config.keyDates !== false} onChange={(on) => tv.update(c => ({ ...c, keyDates: on }))} label="Show key dates" />
        </div>
      )}
      <div className="rb-tv-card-foot">
        <Button size="sm" variant="ghost" onClick={() => showAll(true)}>Show all</Button>
        <Button size="sm" variant="ghost" onClick={() => showAll(false)}>Hide all</Button>
      </div>
    </div>
  )
}
