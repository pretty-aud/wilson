/** @vitest-environment jsdom */
// =============================================================================
// VW1b (2026-10-17), the Tasks table's item columns, mounted. Her bug: "the
// interface in the table doesnt allow for multiple assets to be connected to
// it. please make sure it either shows all or none. additionally, i can see
// the levels or scenes or shots related"; Q9 "All of them", Q10 "Pick several
// there", Q11 "Yes, a column for each", Q-G2, Q6a. The design's §4.6, as VW1b's
// step 0 review corrected it (docs/design/CUSTOM_VIEWS_DESIGN.md, §11 round 3).
//
//   1. the columns: an item column per kind the project uses (the window's
//      picker rule over every task), after Priority, keyed by kind; Scene,
//      Shot, Level and Experience join the Group menu with them; the kit
//      Table keeps the checkbox and Title in place; the widths from the
//      columns on screen;
//   2. the cell: every LIVE item by name, in the task window's Sort (her
//      Q-N1a and Q-N1b answers), the list its title and accessible name, "+N"
//      past what fits; a seat that may not write reads text, no Tab stop;
//   3. the picker: one kind, ticks a DRAFT, commits ONCE on close through
//      ctx.setTaskItemsOfKind inside ctx.runWithUndoToast, applied to the
//      task's items as they are then; nothing changed, nothing written; the
//      task's last live item asks first; its keyboard and its Tab order;
//      scenes and shots from the active list with "Show all lists"; same-named
//      rows told apart;
//   4. the combination groups for the new kinds, and a drop on one.
// Every CONTROL is the reading or the write the old code made.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { useRef } from 'react'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'
import { _resetTaskItemSortForTests } from '../components/RelationsPanel'
import { tasksTableColumns, tasksTableWidths } from './tasksTableColumns'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => perms.current }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [], mode: 'supabase' }) }))
vi.mock('../components/TaskDetailPopup', () => ({
  default: ({ taskId }) => <div role="dialog" aria-label={`task window ${taskId}`} />,
}))
vi.mock('../components/EditHistoryDrawer', () => ({ default: () => null }))
const rabbit = vi.hoisted(() => ({ current: null }))
const perms = vi.hoisted(() => ({ current: null }))

const { default: ProjectTasksView } = await import('./ProjectTasksView')
const { useItemPicker } = await import('./TaskItemCells')
const { buildItemLookup } = await import('../state/taskItemsModel')

const SORT_KEY = 'rabbit_task_items_sort'
afterEach(() => { cleanup(); _resetOverlaysForTests(); _resetTaskItemSortForTests(); localStorage.clear(); vi.restoreAllMocks() })

// Each asset's own type and creation date (her Q-N1a, Q-N1b). Two assets are
// named "Mara" (her Q10: same-named rows say their type and phase).
const ASSETS = () => [
  { id: 'a1', name: 'Lighthouse Interior', type: 'environment', phase_id: 'ph1', created_at: '2026-09-02T00:00:00Z', sort_order: 0 },
  { id: 'a2', name: 'Storm Lantern', type: 'prop', phase_id: 'ph1', created_at: '2026-09-01T00:00:00Z', sort_order: 1 },
  { id: 'a3', name: 'Harbour Wall', type: 'environment', phase_id: 'ph2', created_at: '2026-09-03T00:00:00Z', sort_order: 2 },
  { id: 'a4', name: 'Mara', type: 'character', phase_id: 'ph1', created_at: '2026-09-04T00:00:00Z', sort_order: 3 },
  { id: 'a5', name: 'Mara', type: 'character', phase_id: 'ph2', created_at: '2026-09-05T00:00:00Z', sort_order: 4 },
]
const PHASES = () => [{ id: 'ph1', name: 'Pre-production' }, { id: 'ph2', name: 'Production' }]
// The active shot list holds s1, s2 and h1; s9 lives in another list only.
const SCENES = () => [{ id: 's1', name: 'The storm', scene_number: 1 }, { id: 's2', name: 'Harbour', scene_number: 2 }]
const ALL_SCENES = () => [...SCENES(), { id: 's9', name: 'Cut scene', scene_number: 9 }]
const SHOTS = () => [{ id: 'h1', scene_id: 's1', name: 'Rain on the glass', shot_number: 1 }]
// `asset_id` etc. are the older apps' copy: CONTROLS the screen must not read.
const TASKS = () => [
  { id: 't1', title: 'Glass and rain rig test', status: 'in_progress', priority: 'high', asset_id: 'a2' },
  { id: 't2', title: 'Wall texture pass', status: 'waiting_to_start', priority: 'medium', asset_id: 'a3' },
  { id: 't3', title: 'Edit review', status: 'final', priority: 'low', asset_id: 'a1' },
  { id: 't4', title: 'Lantern flicker', status: 'in_progress', priority: 'low' },
]
const item = (id, task, kind, entity, position) => ({ id, task_id: task, entity_type: kind, entity_id: entity, position, created_at: '2026-10-16T09:00:00.000Z' })
// t1: Storm Lantern then Lighthouse Interior (stored order), The storm, its
// shot; t2: Harbour Wall; t3: none; t4: Storm Lantern and an asset in the
// trash (a9, not in ctx.assets).
const ITEMS = () => [
  item('i1', 't1', 'asset', 'a2', 0), item('i2', 't1', 'asset', 'a1', 1),
  item('i3', 't1', 'scene', 's1', 0), item('i4', 't1', 'shot', 'h1', 0),
  item('i5', 't2', 'asset', 'a3', 0),
  item('i6', 't4', 'asset', 'a2', 0), item('i7', 't4', 'asset', 'a9', 1),
]

function page({ writer = true, items = true, project = {}, ...extra } = {}) {
  perms.current = { role: writer ? 'admin' : 'user', ready: true, can: () => writer }
  const ctx = {
    project: { id: 'p1', name: 'Salt Hours', ...project },
    tasks: TASKS(), assets: ASSETS(), phases: PHASES(),
    scenes: SCENES(), allScenes: ALL_SCENES(), shots: SHOTS(), allShots: SHOTS(),
    levels: [], experiences: [],
    teamAssignments: [], milestones: [],
    taskItems: items ? ITEMS() : [],
    taskItemsAvailable: items,
    myProjectRole: writer ? 'manager' : 'reviewer',
    projectIsStaffed: !writer,
    updateTask: vi.fn(), deleteTask: vi.fn(),
    addTask: vi.fn(async () => ({ id: 'new' })),
    setTaskItemsOfKind: vi.fn(async () => ({ added: 1, removed: 0 })),
    runWithUndoToast: vi.fn(async (run) => run()),
    ...extra,
  }
  rabbit.current = ctx
  const r = render(<ProjectTasksView />)
  return { ctx, rerender: (next) => { rabbit.current = next; r.rerender(<ProjectTasksView />) } }
}
const heads = () => [...document.querySelectorAll('table.rb-task-table > thead > tr > th')].map((th) => th.textContent.trim())
const rowOf = (title) => screen.getByRole('button', { name: `Select "${title}"` }).closest('tr')
const LABEL = { asset: 'Asset', scene: 'Scene', shot: 'Shot', level: 'Level', experience: 'Experience' }
const cellOf = (title, kind) => rowOf(title).children[heads().indexOf(LABEL[kind])].firstElementChild
const picker = () => document.querySelector('.ui-popover')
const rows = () => [...picker().querySelectorAll('[role="checkbox"]')].map((r) => [r.querySelector('.rb-task-pick-name').textContent, r.getAttribute('aria-checked')])
const tick = (name) => fireEvent.click([...picker().querySelectorAll('[role="checkbox"]')].find((r) => r.querySelector('.rb-task-pick-name').textContent === name))
const sortTo = (sort) => act(() => {
  localStorage.setItem(SORT_KEY, sort)
  window.dispatchEvent(new StorageEvent('storage', { key: SORT_KEY }))
})

describe('VW1b: the columns — an item column per kind the project uses, after Priority (her Q11, Q-G2)', () => {
  it('a film project (scenes on): Asset, Scene, Shot after Priority, before Phase; the title first', () => {
    page({ project: { scenes_enabled: true } })
    expect(heads()).toEqual(['', 'Title', 'Status', 'Priority', 'Asset', 'Scene', 'Shot', 'Phase', 'Assignee', 'Start', 'End', 'Bid'])
  })
  it('every kind on: Asset, Scene, Shot, Level, Experience', () => {
    page({ project: { scenes_enabled: true, levels_enabled: true, experiences_enabled: true } })
    expect(heads().slice(4, 9)).toEqual(['Asset', 'Scene', 'Shot', 'Level', 'Experience'])
  })
  it('a kind turned off shows its column while a task names one of its live items (the window\'s picker rule over every task)', () => {
    page()
    // Scenes are off, but t1 names a live scene and shot.
    expect(heads().slice(4, 7)).toEqual(['Asset', 'Scene', 'Shot'])
    cleanup(); _resetOverlaysForTests()
    // CONTROL: no task names one, nothing turned on: Asset alone.
    page({ taskItems: ITEMS().filter((i) => i.entity_type === 'asset') })
    expect(heads().slice(4, 6)).toEqual(['Asset', 'Phase'])
  })
  it('the kit Table keeps the checkbox and the Title in place while it scrolls sideways (stickyColumns, her Q6a)', () => {
    page()
    const t = document.querySelector('table.rb-task-table')
    expect(t.getAttribute('data-sticky')).toBe('true')
    expect(t.getAttribute('data-sticky-columns')).toBe('2')
  })
  it('the widths come from the columns on screen: the fixed sum and the growable count, inline on the wrapper', () => {
    page({ project: { scenes_enabled: true } })
    const wrap = document.querySelector('.rb-task-table-wrap')
    const want = tasksTableWidths(tasksTableColumns(['asset', 'scene', 'shot']))
    expect(wrap.style.getPropertyValue('--rb-task-fixed')).toBe(want.fixed)
    expect(wrap.style.getPropertyValue('--rb-task-grow-n')).toBe('5')
    expect(wrap.getAttribute('data-grow')).toBeNull()
    expect(want.fixed).toBe('calc(var(--rb-task-col-check) + var(--rb-task-col-status) + var(--rb-task-col-priority) + var(--rb-task-item-min) + var(--rb-task-item-min) + var(--rb-task-item-min) + var(--rb-task-phase-min) + var(--rb-task-assignee-min) + var(--rb-task-col-date) + var(--rb-task-col-date) + var(--rb-task-col-bid))')
  })
  it('Bid is keyed on its column (data-col), on the head and on every row', () => {
    page()
    expect(document.querySelector('th[data-col="bid"]').textContent).toBe('Bid')
    expect(rowOf('Edit review').querySelector('td[data-col="bid"]')).not.toBeNull()
  })
  it('tasksTableWidths: nothing growing says so (grow 0) and still divides by 1', () => {
    const w = tasksTableWidths(tasksTableColumns([]).filter((c) => !c.grow))
    expect([w.grow, w.growN]).toEqual([0, '1'])
    expect(tasksTableWidths(null)).toEqual({ fixed: 'calc(var(--rb-task-col-check))', growN: '1', grow: 0 })
  })
})

describe('VW1b: the cell — every live item by name, in the task window\'s Sort (her Q9, Q10, Q-N1a, Q-N1b)', () => {
  it('Type (the default): the assets by their own type — Lighthouse Interior (environment) before Storm Lantern (prop); the list is the title and the accessible name', () => {
    page()
    const c = cellOf('Glass and rain rig test', 'asset')
    expect(c.tagName).toBe('BUTTON')
    expect(c.textContent).toBe('Lighthouse Interior, Storm Lantern')
    expect(c.getAttribute('aria-label')).toBe('Lighthouse Interior, Storm Lantern')
    expect(c.getAttribute('title')).toBe('Lighthouse Interior, Storm Lantern')
    expect(c.getAttribute('aria-haspopup')).toBe('dialog')
    expect(c.getAttribute('aria-expanded')).toBe('false')
  })
  it('the window\'s Sort reorders the cells at once: Date created puts Storm Lantern (made first) first', () => {
    page()
    sortTo('date')
    expect(cellOf('Glass and rain rig test', 'asset').getAttribute('aria-label')).toBe('Storm Lantern, Lighthouse Interior')
    sortTo('name')
    expect(cellOf('Glass and rain rig test', 'asset').getAttribute('aria-label')).toBe('Lighthouse Interior, Storm Lantern')
  })
  it('a scene by its name, a shot as "Scene › Shot"; none reads the dash and is named No scene', () => {
    page()
    expect(cellOf('Glass and rain rig test', 'scene').getAttribute('aria-label')).toBe('The storm')
    expect(cellOf('Glass and rain rig test', 'shot').getAttribute('aria-label')).toBe('The storm › Rain on the glass')
    const none = cellOf('Wall texture pass', 'scene')
    expect(none.textContent).toBe('—')
    expect(none.getAttribute('aria-label')).toBe('No scene')
    expect(none.getAttribute('data-empty')).toBe('true')
  })
  it('an item in the trash is not shown and not counted (her Q-N4); CONTROL: the stale copy is not read', () => {
    page()
    expect(cellOf('Lantern flicker', 'asset').getAttribute('aria-label')).toBe('Storm Lantern')
    expect(cellOf('Edit review', 'asset').getAttribute('aria-label')).toBe('No asset')
    expect(document.body.textContent).not.toMatch(/No longer in the project|Not loaded yet/)
  })
  it('a seat that may not write: text at full ink, no Tab stop, the names hidden from a screen reader and the whole list said once', () => {
    page({ writer: false })
    const c = cellOf('Glass and rain rig test', 'asset')
    expect(c.tagName).toBe('SPAN')
    expect(c.getAttribute('tabindex')).toBeNull()
    expect(c.querySelector('[aria-hidden="true"]').textContent).toBe('Lighthouse Interior, Storm Lantern')
    expect(c.querySelector('.sr-only').textContent).toBe('Lighthouse Interior, Storm Lantern')
    fireEvent.click(c)
    expect(picker()).toBeNull()
  })
  it('as many names as fit, then "+N": measured after layout (three names of 80px in a 150px cell show one and "+2")', () => {
    const many = [...ITEMS(), item('i9', 't1', 'asset', 'a3', 2)]
    const proto = Element.prototype
    vi.spyOn(proto, 'getBoundingClientRect').mockImplementation(function () {
      const width = this.hasAttribute && this.hasAttribute('data-name') ? 80
        : this.classList && this.classList.contains('rb-task-items') ? 150 : 0
      return { width, height: 20, left: 0, top: 0, right: width, bottom: 20 }
    })
    page({ taskItems: many })
    const c = cellOf('Glass and rain rig test', 'asset')
    expect(c.querySelectorAll('[data-name]')).toHaveLength(1)
    expect(c.querySelector('.rb-task-items-more').textContent).toBe('+2')
    // The accessible name is still the whole list.
    expect(c.getAttribute('aria-label')).toBe('Harbour Wall, Lighthouse Interior, Storm Lantern')
  })
  it('CONTROL: where nothing is laid out (no widths) every name stays on the line and the sheet cuts it', () => {
    page({ taskItems: [...ITEMS(), item('i9', 't1', 'asset', 'a3', 2)] })
    const c = cellOf('Glass and rain rig test', 'asset')
    expect(c.querySelectorAll('[data-name]')).toHaveLength(3)
    expect(c.querySelector('.rb-task-items-more')).toBeNull()
  })
  it('where the backend keeps no items: VW1m\'s cell, the one item, a button to the task\'s window', () => {
    page({ items: false })
    const c = cellOf('Glass and rain rig test', 'asset')
    expect(c.getAttribute('aria-label')).toBe('Storm Lantern')
    fireEvent.click(c)
    expect(screen.getByRole('dialog', { name: 'task window t1' })).toBeTruthy()
    expect(picker()).toBeNull()
  })
  it('a Board card names its assets in the same Sort as the cell', () => {
    page()
    sortTo('date')
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }))
    const card = screen.getByText('Glass and rain rig test').closest('.rb-task-card')
    expect(card.querySelector('.rb-task-card-asset').textContent).toBe('Storm Lantern, Lighthouse Interior')
  })
})

describe('VW1b: the picker — one kind, ticks a draft, commits once on close (her Q10; step 0 review, finding 3)', () => {
  it('opens on the cell, labelled for its task, the search holding the keyboard; every live asset a checkbox row, the task\'s ticked; an asset in the trash is not offered', () => {
    page()
    const c = cellOf('Glass and rain rig test', 'asset')
    fireEvent.click(c)
    expect(picker().getAttribute('role')).toBe('dialog')
    expect(picker().getAttribute('aria-label')).toBe('Assets of Glass and rain rig test')
    expect(c.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(within(picker()).getByRole('textbox', { name: 'Search assets' }))
    expect(rows()).toEqual([
      ['Lighthouse Interior', 'true'], ['Storm Lantern', 'true'], ['Harbour Wall', 'false'], ['Mara', 'false'], ['Mara', 'false'],
    ])
  })
  it('same-named rows say what tells them apart — the asset\'s type and phase; a name of its own says nothing', () => {
    page()
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    const marks = [...picker().querySelectorAll('[role="checkbox"]')].map((r) => r.querySelector('.rb-task-pick-apart')?.textContent ?? null)
    expect(marks).toEqual([null, null, null, 'Character · Pre-production', 'Character · Production'])
  })
  it('the search narrows the rows, any case', () => {
    page()
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    fireEvent.change(within(picker()).getByRole('textbox'), { target: { value: 'MARA' } })
    expect(rows().map(([n]) => n)).toEqual(['Mara', 'Mara'])
    fireEvent.change(within(picker()).getByRole('textbox'), { target: { value: 'zzz' } })
    expect(picker().textContent).toContain('No matches')
  })
  it('a tick changes the DRAFT (the cell shows it) and writes nothing; closing commits ONCE, through the undo toast, with the words of what changed', async () => {
    const { ctx } = page()
    const c = cellOf('Glass and rain rig test', 'asset')
    fireEvent.click(c)
    tick('Harbour Wall')
    expect(rows()[2]).toEqual(['Harbour Wall', 'true'])
    expect(cellOf('Glass and rain rig test', 'asset').getAttribute('aria-label')).toBe('Harbour Wall, Lighthouse Interior, Storm Lantern')
    expect(ctx.setTaskItemsOfKind).not.toHaveBeenCalled()
    await act(async () => { fireEvent.keyDown(document.activeElement, { key: 'Escape' }) })
    expect(picker()).toBeNull()
    expect(ctx.runWithUndoToast).toHaveBeenCalledTimes(1)
    expect(ctx.runWithUndoToast.mock.calls[0][1]).toBe('Added "Harbour Wall" to "Glass and rain rig test"')
    expect(ctx.setTaskItemsOfKind).toHaveBeenCalledTimes(1)
    expect(ctx.setTaskItemsOfKind).toHaveBeenCalledWith('t1', 'asset', ['a1', 'a2', 'a3'])
  })
  it('an untick, a removal; two changes say "Changed the assets of …"', async () => {
    const { ctx } = page()
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    tick('Storm Lantern')
    await act(async () => { fireEvent.keyDown(document.activeElement, { key: 'Escape' }) })
    expect(ctx.runWithUndoToast.mock.calls[0][1]).toBe('Removed "Storm Lantern" from "Glass and rain rig test"')
    expect(ctx.setTaskItemsOfKind).toHaveBeenLastCalledWith('t1', 'asset', ['a1'])
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    tick('Storm Lantern'); tick('Harbour Wall')
    await act(async () => { fireEvent.keyDown(document.activeElement, { key: 'Escape' }) })
    expect(ctx.runWithUndoToast.mock.calls[1][1]).toBe('Changed the assets of "Glass and rain rig test"')
  })
  it('nothing changed (a tick taken back): nothing written, no toast', async () => {
    const { ctx } = page()
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    tick('Harbour Wall'); tick('Harbour Wall')
    await act(async () => { fireEvent.keyDown(document.activeElement, { key: 'Escape' }) })
    expect(ctx.setTaskItemsOfKind).not.toHaveBeenCalled()
    expect(ctx.runWithUndoToast).not.toHaveBeenCalled()
  })
  it('the commit applies to the task\'s items as they are THEN: a teammate\'s asset added meanwhile stays', async () => {
    const { ctx, rerender } = page()
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    tick('Harbour Wall')
    // Meanwhile a teammate adds Mara (a4) to t1: the live merge brings it.
    rerender({ ...ctx, taskItems: [...ctx.taskItems, item('ix', 't1', 'asset', 'a4', 2)] })
    await act(async () => { fireEvent.keyDown(document.activeElement, { key: 'Escape' }) })
    expect(ctx.setTaskItemsOfKind).toHaveBeenCalledWith('t1', 'asset', ['a1', 'a4', 'a2', 'a3'])
  })
  it('a press outside closes and commits; so does pressing the cell again', async () => {
    const { ctx } = page()
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    tick('Harbour Wall')
    await act(async () => { fireEvent.mouseDown(document.body) })
    expect(picker()).toBeNull()
    expect(ctx.setTaskItemsOfKind).toHaveBeenCalledTimes(1)
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    tick('Mara')
    const again = cellOf('Glass and rain rig test', 'asset')
    fireEvent.mouseDown(again)
    await act(async () => { fireEvent.click(again) })
    expect(picker()).toBeNull()
    expect(ctx.setTaskItemsOfKind).toHaveBeenCalledTimes(2)
  })
  it('a refused write is said in the tab\'s Banner', async () => {
    page({ setTaskItemsOfKind: vi.fn(async () => { throw new Error('This project is read-only for you') }) })
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    tick('Harbour Wall')
    await act(async () => { fireEvent.keyDown(document.activeElement, { key: 'Escape' }) })
    expect(document.querySelector('.ui-banner').textContent).toContain('Could not change the assets of “Glass and rain rig test”: This project is read-only for you')
  })
  it('the task\'s LAST live item asks first, over the picker: Cancel keeps it ticked; Remove unticks it (written at the close)', async () => {
    const { ctx } = page()
    fireEvent.click(cellOf('Wall texture pass', 'asset'))
    tick('Harbour Wall')
    const ask = screen.getByRole('dialog', { name: 'Remove the last item' })
    expect(ask.textContent).toContain('Remove “Harbour Wall”? It is this task\'s only item')
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(rows().find(([n]) => n === 'Harbour Wall')[1]).toBe('true')
    tick('Harbour Wall')
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove the last item' })).getByRole('button', { name: 'Remove' }))
    expect(rows().find(([n]) => n === 'Harbour Wall')[1]).toBe('false')
    expect(ctx.setTaskItemsOfKind).not.toHaveBeenCalled()
    await act(async () => { fireEvent.keyDown(within(picker()).getByRole('textbox'), { key: 'Escape' }) })
    expect(ctx.setTaskItemsOfKind).toHaveBeenCalledWith('t2', 'asset', [])
  })
  it('CONTROL: a task with items of another kind does not ask (its last asset is not its last item)', () => {
    page()
    fireEvent.click(cellOf('Glass and rain rig test', 'scene'))
    tick('The storm')
    expect(screen.queryByRole('dialog', { name: 'Remove the last item' })).toBeNull()
  })
  it('the keyboard: ↓ from the search into the list (one Tab stop), ↑ ↓ Home End move, Space ticks', () => {
    page()
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    const search = within(picker()).getByRole('textbox')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    const list = () => [...picker().querySelectorAll('[role="checkbox"]')]
    expect(document.activeElement).toBe(list()[0])
    expect(list().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1, -1])
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(list()[1])
    fireEvent.keyDown(document.activeElement, { key: 'End' })
    expect(document.activeElement).toBe(list()[4])
    fireEvent.keyDown(document.activeElement, { key: ' ' })
    expect(list()[4].getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(document.activeElement, { key: 'Home' })
    expect(document.activeElement).toBe(list()[0])
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(search)
  })
  it('Tab from the list closes it and goes on to the control after the cell; Shift+Tab from the search returns to the cell', async () => {
    page()
    const c = cellOf('Glass and rain rig test', 'asset')
    fireEvent.click(c)
    fireEvent.keyDown(within(picker()).getByRole('textbox'), { key: 'ArrowDown' })
    await act(async () => { fireEvent.keyDown(document.activeElement, { key: 'Tab' }) })
    expect(picker()).toBeNull()
    expect(document.activeElement).toBe(cellOf('Glass and rain rig test', 'scene'))
    fireEvent.click(c)
    await act(async () => { fireEvent.keyDown(within(picker()).getByRole('textbox'), { key: 'Tab', shiftKey: true }) })
    expect(picker()).toBeNull()
    expect(document.activeElement).toBe(c)
  })
  it('scenes: the active shot list\'s by default, "Show all lists" for the rest, a ticked scene from another list kept in view', () => {
    page({ taskItems: [...ITEMS(), item('i8', 't2', 'scene', 's9', 0)], scenes: SCENES(), allScenes: ALL_SCENES() })
    fireEvent.click(cellOf('Wall texture pass', 'scene'))
    // s9 is not in the active list, but the task has it: listed and ticked.
    expect(rows()).toEqual([['The storm', 'false'], ['Harbour', 'false'], ['Cut scene', 'true']])
    cleanup(); _resetOverlaysForTests()
    page()
    fireEvent.click(cellOf('Wall texture pass', 'scene'))
    expect(rows().map(([n]) => n)).toEqual(['The storm', 'Harbour'])
    fireEvent.click(within(picker()).getByRole('switch', { name: 'Show all lists' }))
    expect(rows().map(([n]) => n)).toEqual(['The storm', 'Harbour', 'Cut scene'])
  })
})

describe('VW1b: grouped by the new kinds — one group per combination; a drop takes the group\'s items (her Q-D, Q-D1)', () => {
  const groupBy = (value) => fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value } })
  const bands = () => [...document.querySelectorAll('tr.rb-task-group-row')].map((r) => [r.querySelector('.rb-task-group-label').textContent, r.querySelector('.rb-task-group-count').textContent])
  it('by scene: the scene a task has, then No scene; the counts add up to the tasks', () => {
    page({ project: { scenes_enabled: true } })
    groupBy('scene')
    expect(bands()).toEqual([['The storm', '1'], ['No scene', '3']])
  })
  it('by shot, on the Board: a column per shot of the active list and No shot', () => {
    page({ project: { scenes_enabled: true } })
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }))
    groupBy('shot')
    const cols = [...document.querySelectorAll('.rb-task-col')].map((c) => c.querySelector('.rb-task-group-label').textContent)
    expect(cols).toEqual(['The storm › Rain on the glass', 'No shot'])
  })
  it('a drop on a scene group gives the task exactly that group\'s scenes, through the undo toast', async () => {
    const { ctx } = page({ project: { scenes_enabled: true } })
    groupBy('scene')
    const band = [...document.querySelectorAll('tr.rb-task-group-row')].find((r) => r.textContent.includes('The storm'))
    await act(async () => { fireEvent.drop(band, { dataTransfer: { getData: () => 't2', setData: () => {}, effectAllowed: '' } }) })
    expect(ctx.setTaskItemsOfKind).toHaveBeenCalledWith('t2', 'scene', ['s1'])
    expect(ctx.runWithUndoToast.mock.calls[0][1]).toBe('Moved "Wall texture pass" to The storm')
  })
  it('a grouping whose kind the project no longer offers reads as no grouping', () => {
    const { ctx, rerender } = page({ project: { scenes_enabled: true } })
    groupBy('scene')
    expect(bands().length).toBeGreaterThan(0)
    rerender({ ...ctx, project: { ...ctx.project, scenes_enabled: false }, taskItems: ITEMS().filter((i) => i.entity_type === 'asset') })
    expect(bands()).toEqual([])
    expect(screen.getByRole('combobox', { name: 'Group' }).value).toBe('')
  })
})

// ── VW1b code review round 1 (2026-10-17) ───────────────────────────────────
describe('VW1b review round 1: the cell\'s measuring, the picker\'s place, a tick\'s cost, a grouping that outlives its column', () => {
  // Each name's width by its words (its comma included), as Chromium measured
  // them; each box's by its class (its own fractional width, round 2's R2-4,
  // and the whole number a browser gives as clientWidth).
  const stubWidths = (widths, boxes) => {
    const boxOf = (el) => {
      for (const [cls, w] of Object.entries(boxes)) if (el.classList && el.classList.contains(cls)) return w
      return 0
    }
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const w = this.hasAttribute && this.hasAttribute('data-name') ? (widths[this.textContent] ?? 0) : boxOf(this)
      return { width: w, height: 20, left: 0, top: 0, right: w, bottom: 20 }
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () { return Math.round(boxOf(this)) })
  }
  const three = [...ITEMS(), item('i9', 't1', 'asset', 'a3', 2)]

  it('R1-4: a seat that may not write measures the CELL, not the names\' own shrink-wrapped box: three names that fit stay three', () => {
    // Harbour Wall, Lighthouse Interior, Storm Lantern = 181.1px in a 260px cell.
    stubWidths({ 'Harbour Wall, ': 60.4, 'Lighthouse Interior, ': 60.4, 'Storm Lantern': 60.3 },
      { 'rb-task-items': 260, 'rb-task-items-shown': 181 })
    page({ writer: false, taskItems: three })
    const c = cellOf('Glass and rain rig test', 'asset')
    expect(c.querySelectorAll('[data-name]')).toHaveLength(3)
    expect(c.querySelector('.rb-task-items-more')).toBeNull()
  })

  it('R1-8: the room kept for "+N" is the badge\'s own (about 26px for "+1"), not 42px: two names and "+1" where they fit', () => {
    // 50 + 76.9 = 126.9px of names, "+1" and its gap 32.5px: 159.4px in 166.
    stubWidths({ 'Harbour Wall, ': 50, 'Lighthouse Interior, ': 76.9, 'Storm Lantern': 60 }, { 'rb-task-items': 166 })
    page({ taskItems: three })
    const c = cellOf('Glass and rain rig test', 'asset')
    expect(c.querySelectorAll('[data-name]')).toHaveLength(2)
    expect(c.querySelector('.rb-task-items-more').textContent).toBe('+1')
  })

  it('R1-6: the picker opens no further left than the sticky Title\'s right edge, where the cell is partly under it', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const box = (left, width) => ({ left, right: left + width, width, top: 300, bottom: 328, height: 28 })
      if (this.tagName === 'TH' && this.textContent === 'Title') return box(48, 216)
      if (this.classList && this.classList.contains('rb-task-items')) return box(214, 138)
      return box(0, 0)
    })
    page()
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    expect(picker().style.left).toBe('264px')
  })

  it('R1-5: a tick re-renders the open cell and the picker, not the table that owns them', () => {
    const ctx = page().ctx
    cleanup(); _resetOverlaysForTests()
    const lookup = buildItemLookup({ items: ctx.taskItems, available: true, assets: ctx.assets, scenes: ctx.scenes, shots: ctx.shots, levels: [], experiences: [] })
    const renders = { n: 0 }
    function Owner() {
      renders.n += 1
      const tableRef = useRef(null)
      const p = useItemPicker({ ctx, lookup, tableRef, onFail: () => {} })
      return (
        <div ref={tableRef}>
          <button type="button" data-item-cell="t1:asset" onClick={(e) => p.open(ctx.tasks[0], 'asset', e.currentTarget)}>cell</button>
          {p.layer}
        </div>
      )
    }
    rabbit.current = ctx
    render(<Owner />)
    fireEvent.click(screen.getByRole('button', { name: 'cell' }))
    const before = renders.n
    tick('Harbour Wall')
    expect(rows().find(([n]) => n === 'Harbour Wall')[1]).toBe('true')
    tick('Mara')
    expect(renders.n).toBe(before)
  })

  it('R1-10: a grouping whose column went is forgotten, so the table does not regroup by itself when the column comes back', () => {
    const { ctx, rerender } = page({ project: { scenes_enabled: true } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'scene' } })
    expect(document.querySelectorAll('tr.rb-task-group-row').length).toBeGreaterThan(0)
    const without = { ...ctx, project: { ...ctx.project, scenes_enabled: false }, taskItems: ITEMS().filter((i) => i.entity_type === 'asset') }
    rerender(without)
    expect(document.querySelectorAll('tr.rb-task-group-row')).toHaveLength(0)
    rerender({ ...without, project: { ...without.project, scenes_enabled: true }, taskItems: ITEMS() })
    expect(document.querySelectorAll('tr.rb-task-group-row')).toHaveLength(0)
    expect(screen.getByRole('combobox', { name: 'Group' }).value).toBe('')
  })
})

// ── VW1b code review round 2 (2026-10-17), attacking round 1's corrections ──
describe('VW1b review round 2: the badge measured, the cell\'s fractional room, a closed picker\'s list until its write lands', () => {
  // Chromium's own widths (round 2's probe): the kit Badge holding "+N".
  const BADGES = { '+1': 26.25, '+2': 28.61, '+3': 28.56, '+4': 28.63, '+5': 28.77, '+6': 28.31, '+7': 27.25, '+8': 28.64, '+9': 28.36 }
  const stub = (widths, box) => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      let w = 0
      if (this.hasAttribute && this.hasAttribute('data-name')) w = widths[this.textContent] ?? 0
      else if (this.classList && this.classList.contains('rb-task-items-ruler')) w = BADGES[this.textContent] ?? 0
      else if (this.classList && this.classList.contains('rb-task-items')) w = box
      return { width: w, height: 20, left: 0, top: 0, right: w, bottom: 20 }
    })
    // As a browser gives it: a whole number.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
      return this.classList && this.classList.contains('rb-task-items') ? Math.round(box) : 0
    })
  }
  const three = [...ITEMS(), item('i9', 't1', 'asset', 'a3', 2)]
  const four = [...three, item('i10', 't1', 'asset', 'a4', 3)]
  const label = () => cellOf('Glass and rain rig test', 'asset').getAttribute('aria-label')
  const escape = () => act(async () => { fireEvent.keyDown(document.activeElement, { key: 'Escape' }) })

  it('R2-1: the room kept for "+N" is that badge\'s own measured width: "+2" is 28.6px, not round 1\'s 26.5, so two names do not fit beside it in 160.5px (one name and "+3")', () => {
    // Mara, Harbour Wall: 126.9px; with the gap and "+2", 161.5 > 160.5.
    stub({ 'Mara, ': 50, 'Harbour Wall, ': 76.9, 'Lighthouse Interior, ': 60, 'Storm Lantern': 60 }, 160.5)
    page({ taskItems: four })
    const c = cellOf('Glass and rain rig test', 'asset')
    expect(c.querySelectorAll('[data-name]')).toHaveLength(1)
    expect(c.querySelector('.rb-task-items-more').textContent).toBe('+3')
    // The ruler holds no text and is hidden from a screen reader.
    const ruler = c.querySelector('.rb-task-items-ruler')
    expect(ruler.textContent).toBe('')
    expect(ruler.getAttribute('aria-hidden')).toBe('true')
  })

  it('R2-4: the room is the cell\'s fractional width: three names of 284.22px fit a 284.42px cell, where the whole-number clientWidth (284) dropped one', () => {
    stub({ 'Harbour Wall, ': 100.1, 'Lighthouse Interior, ': 100.1, 'Storm Lantern': 84.02 }, 284.42)
    page({ taskItems: three })
    const c = cellOf('Glass and rain rig test', 'asset')
    expect(c.querySelectorAll('[data-name]')).toHaveLength(3)
    expect(c.querySelector('.rb-task-items-more')).toBeNull()
  })

  it('R2-2: a closed picker\'s list stays in its cell until the write lands (it showed the old items, then jumped); then the cell reads the task\'s items again', async () => {
    let land
    const { ctx, rerender } = page({ setTaskItemsOfKind: vi.fn(() => new Promise((resolve) => { land = resolve })) })
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    tick('Harbour Wall')
    await escape()
    expect(picker()).toBeNull()
    expect(label()).toBe('Harbour Wall, Lighthouse Interior, Storm Lantern')
    // It lands: the task's items say the same.
    const landed = [...ctx.taskItems, item('ix', 't1', 'asset', 'a3', 2)]
    rerender({ ...ctx, taskItems: landed })
    await act(async () => { land({ added: 1, removed: 0 }) })
    expect(label()).toBe('Harbour Wall, Lighthouse Interior, Storm Lantern')
    // And from then on the cell reads them: a teammate's later change shows.
    rerender({ ...ctx, taskItems: landed.filter((i) => i.id !== 'i1') })
    expect(label()).toBe('Harbour Wall, Lighthouse Interior')
  })

  it('R2-2: a refused write: the cell goes back to what the task really has, and the Banner says why', async () => {
    let refuse
    page({ setTaskItemsOfKind: vi.fn(() => new Promise((_, reject) => { refuse = reject })) })
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    tick('Harbour Wall')
    await escape()
    expect(label()).toBe('Harbour Wall, Lighthouse Interior, Storm Lantern')
    await act(async () => { refuse(new Error('This project is read-only for you')) })
    expect(label()).toBe('Lighthouse Interior, Storm Lantern')
    expect(document.querySelector('.ui-banner').textContent).toContain('Could not change the assets of “Glass and rain rig test”: This project is read-only for you')
  })

  it('R2-2: opened again before the write lands, the picker starts from the list being written, and the second close builds on it (built on the old items, it took the first change back)', async () => {
    const { ctx } = page({ setTaskItemsOfKind: vi.fn(() => new Promise(() => {})) })
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    tick('Harbour Wall')
    await escape()
    expect(ctx.setTaskItemsOfKind).toHaveBeenLastCalledWith('t1', 'asset', ['a1', 'a2', 'a3'])
    fireEvent.click(cellOf('Glass and rain rig test', 'asset'))
    expect(rows().find(([n]) => n === 'Harbour Wall')[1]).toBe('true')
    tick('Storm Lantern')
    await escape()
    expect(ctx.setTaskItemsOfKind).toHaveBeenCalledTimes(2)
    expect(ctx.setTaskItemsOfKind).toHaveBeenLastCalledWith('t1', 'asset', ['a1', 'a3'])
    expect(ctx.runWithUndoToast.mock.calls[1][1]).toBe('Removed "Storm Lantern" from "Glass and rain rig test"')
    expect(label()).toBe('Harbour Wall, Lighthouse Interior')
  })
})
