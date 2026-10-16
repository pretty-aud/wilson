/** @vitest-environment jsdom */
// =============================================================================
// VW1m (2026-10-16), the Tasks table and its Board with no main item, mounted.
// Audrey: "lets not have main asset be a thing. thats not needed and i dont
// like. instead lets do the same as the grouping option." Her Q-D: "make a
// group for the assets grouped together ... there should be a group called
// Asset A, Asset B, Asset C"; Q-D1: a drop makes the group's items the task's;
// Q-I: the Board shows every column; Q-N4: an item in the trash is hidden;
// Q-N5's interim: the Asset cell names every asset and opens the window.
//
// What each part DOES, against the contract (item 2 of
// docs/sessions/handoffs/po-vw1m-2026-10-16.md):
//   1. grouped by asset, one group per COMBINATION of a task's live assets:
//      singles in the project's order, combinations by name, "No asset" last;
//      a task in exactly one group; the Board keeps a column per single asset
//      and its "No asset" column even when empty;
//   2. a drop sets exactly the group's items (ctx.setTaskItemsOfKind), "No
//      asset" none, through the shell's undo toast (ctx.runWithUndoToast);
//      a drop on its own group writes nothing; where the backend keeps no
//      items the drop writes the one field as before;
//   3. a new task made in a group carries the group's items (NewTaskPopup
//      shows them read-only and passes `items`); one asset stays the popup's
//      own choice;
//   4. the Asset cell: every live asset's name, the list its title and its
//      accessible name, a button that opens the task's window; a Board card
//      the same names;
//   5. *Asset is X* = the task has X; *is not X* = none is X; empty by live
//      assets;
//   6. the other kinds group the same way, offered where the project has them.
// Every CONTROL is a stale single field (the older apps' copy) that the old
// reading would have used: the screen must not read it.
// =============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'

vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => rabbit.current }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => perms.current }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [], mode: 'supabase' }) }))
// The window a row opens, as a marker: which task it was opened for.
vi.mock('../components/TaskDetailPopup', () => ({
  default: ({ taskId }) => <div role="dialog" aria-label={`task window ${taskId}`} />,
}))
vi.mock('../components/EditHistoryDrawer', () => ({
  default: ({ entityId }) => <div role="dialog" aria-label={`history ${entityId}`} />,
}))
const rabbit = vi.hoisted(() => ({ current: null }))
const perms = vi.hoisted(() => ({ current: null }))

const { default: ProjectTasksView } = await import('./ProjectTasksView')

afterEach(() => { cleanup(); _resetOverlaysForTests(); localStorage.clear() })

const ASSETS = () => [
  { id: 'a1', name: 'Lighthouse Interior', sort_order: 0 },
  { id: 'a2', name: 'Storm Lantern', sort_order: 1 },
  { id: 'a3', name: 'Harbour Wall', sort_order: 2 },
]
// `asset_id` is the older apps' copy (the first item in the stored order);
// every one here is a CONTROL the screen must not read.
const TASKS = () => [
  { id: 't1', title: 'Glass and rain rig test', status: 'in_progress', priority: 'high', asset_id: 'a2' },
  { id: 't2', title: 'Wall texture pass', status: 'waiting_to_start', priority: 'medium', asset_id: 'a3' },
  { id: 't3', title: 'Edit review', status: 'final', priority: 'low', asset_id: 'a1' },
  { id: 't4', title: 'Lantern flicker', status: 'in_progress', priority: 'low', asset_id: 'a9' },
]
const item = (id, task, kind, entity, position) => ({ id, task_id: task, entity_type: kind, entity_id: entity, position, created_at: '2026-10-16T09:00:00.000Z' })
// t1: Storm Lantern then Lighthouse Interior (stored order); t2: Harbour
// Wall; t3: none (its stale copy says a1); t4: the same two as t1 in the other
// order, with an asset in the trash (a9, not in ctx.assets) between them.
const ITEMS = () => [
  item('i1', 't1', 'asset', 'a2', 0), item('i2', 't1', 'asset', 'a1', 1),
  item('i3', 't2', 'asset', 'a3', 0),
  item('i4', 't4', 'asset', 'a9', 0), item('i5', 't4', 'asset', 'a1', 1), item('i6', 't4', 'asset', 'a2', 2),
]

function page({ writer = true, items = true, project = {}, ...extra } = {}) {
  perms.current = { role: writer ? 'admin' : 'user', ready: true, can: () => writer }
  const ctx = {
    project: { id: 'p1', name: 'Salt Hours', ...project },
    tasks: TASKS(),
    assets: ASSETS(),
    phases: [], teamAssignments: [], milestones: [],
    taskItems: items ? ITEMS() : [],
    taskItemsAvailable: items,
    myProjectRole: writer ? 'manager' : 'reviewer',
    projectIsStaffed: !writer,
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    addTask: vi.fn(async () => ({ id: 'new' })),
    setTaskItemsOfKind: vi.fn(async () => {}),
    runWithUndoToast: vi.fn(async (run) => run()),
    ...extra,
  }
  rabbit.current = ctx
  render(<ProjectTasksView />)
  return ctx
}
const groupBy = (value) => fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value } })
const board = () => fireEvent.click(screen.getByRole('tab', { name: 'Board' }))
/** The table's group bands, in order: [label, count]. */
const bands = () => [...document.querySelectorAll('tr.rb-task-group-row')]
  .map((r) => [r.querySelector('.rb-task-group-label').textContent, r.querySelector('.rb-task-group-count').textContent])
/** The Board's columns, in order: [label, count]. */
const columns = () => [...document.querySelectorAll('.rb-task-col')]
  .map((c) => [c.querySelector('.rb-task-group-label').textContent, c.querySelector('.rb-task-group-count').textContent])
const band = (label) => [...document.querySelectorAll('tr.rb-task-group-row')].find((r) => r.querySelector('.rb-task-group-label').textContent === label)
const column = (label) => [...document.querySelectorAll('.rb-task-col')].find((c) => c.querySelector('.rb-task-group-label').textContent === label)
const dt = (id) => ({ dataTransfer: { getData: () => id, setData: () => {}, effectAllowed: '' } })
const rowOf = (title) => screen.getByRole('button', { name: `Select "${title}"` }).closest('tr')
const shownTitles = () => [...document.querySelectorAll('tr.rb-task-row')]
  .map((r) => r.querySelector('.rb-task-cell-text').textContent)

describe('VW1m: grouped by asset, one group per combination of a task\'s live assets', () => {
  it('the table: singles in the project\'s order, then combinations by name, then No asset; each task once, the counts adding up', () => {
    page()
    groupBy('asset')
    // t1 and t4 share one combination (t4's trashed asset hidden, the order
    // ignored); Lighthouse Interior and Storm Lantern hold no task alone, so
    // the table shows no band for them (as before: a band holds tasks).
    expect(bands()).toEqual([
      ['Harbour Wall', '1'],
      ['Lighthouse Interior, Storm Lantern', '2'],
      ['No asset', '1'],
    ])
    expect(bands().reduce((n, [, c]) => n + Number(c), 0)).toBe(4)
    // CONTROL: the old reading (the copy) put t1 under Storm Lantern and t3
    // under Lighthouse Interior, and t4 under an asset in the trash.
    expect(band('Storm Lantern')).toBeUndefined()
    expect(document.body.textContent).not.toContain('Unassigned')
  })

  it('the Board: a column per single asset even when empty, the combination that holds tasks, and No asset', () => {
    page()
    board()
    groupBy('asset')
    expect(columns()).toEqual([
      ['Lighthouse Interior', '0'],
      ['Storm Lantern', '0'],
      ['Harbour Wall', '1'],
      ['Lighthouse Interior, Storm Lantern', '2'],
      ['No asset', '1'],
    ])
    // No asset stays when it is empty, as Unassigned did.
    cleanup(); _resetOverlaysForTests()
    page({ tasks: TASKS().filter((t) => t.id !== 't3') })
    board()
    groupBy('asset')
    expect(columns().at(-1)).toEqual(['No asset', '0'])
  })

  it('combinations order by their names A to Z, numbers as numbers', () => {
    const assets = [
      { id: 'b1', name: 'Shot 2' }, { id: 'b2', name: 'Shot 10' }, { id: 'b3', name: 'alpha' }, { id: 'b4', name: 'Beta' },
    ]
    const tasks = [
      { id: 'x1', title: 'One', status: 'in_progress' }, { id: 'x2', title: 'Two', status: 'in_progress' },
      { id: 'x3', title: 'Three', status: 'in_progress' },
    ]
    const taskItems = [
      item('j1', 'x1', 'asset', 'b2', 0), item('j2', 'x1', 'asset', 'b4', 1),
      item('j3', 'x2', 'asset', 'b1', 0), item('j4', 'x2', 'asset', 'b4', 1),
      item('j5', 'x3', 'asset', 'b3', 0), item('j6', 'x3', 'asset', 'b4', 1),
    ]
    page({ assets, tasks, taskItems })
    groupBy('asset')
    expect(bands().map(([l]) => l)).toEqual(['alpha, Beta', 'Beta, Shot 2', 'Beta, Shot 10'])
  })
})

describe('VW1m: a drop makes the group\'s items the task\'s (her Q-D1), with the undo toast', () => {
  it('a table drop on a combination sets exactly its items, through ctx.runWithUndoToast, and writes no field', async () => {
    const ctx = page()
    groupBy('asset')
    fireEvent.drop(band('Lighthouse Interior, Storm Lantern'), dt('t2'))
    await waitFor(() => expect(ctx.setTaskItemsOfKind).toHaveBeenCalledTimes(1))
    expect(ctx.setTaskItemsOfKind).toHaveBeenCalledWith('t2', 'asset', ['a1', 'a2'])
    expect(ctx.runWithUndoToast).toHaveBeenCalledTimes(1)
    expect(ctx.runWithUndoToast.mock.calls[0][1]).toBe('Moved "Wall texture pass" to Lighthouse Interior, Storm Lantern')
    expect(ctx.updateTask).not.toHaveBeenCalled()
  })

  it('a drop on No asset takes them all off; a drop on its own group writes nothing', async () => {
    const ctx = page()
    groupBy('asset')
    fireEvent.drop(band('No asset'), dt('t1'))
    await waitFor(() => expect(ctx.setTaskItemsOfKind).toHaveBeenCalledWith('t1', 'asset', []))
    expect(ctx.runWithUndoToast.mock.calls[0][1]).toBe('Moved "Glass and rain rig test" to No asset')
    fireEvent.drop(band('Lighthouse Interior, Storm Lantern'), dt('t4'))
    fireEvent.drop(band('Harbour Wall'), dt('t2'))
    await Promise.resolve()
    expect(ctx.setTaskItemsOfKind).toHaveBeenCalledTimes(1)
    expect(ctx.updateTask).not.toHaveBeenCalled()
  })

  it('a Board drop on a single asset\'s empty column gives the card that one asset', async () => {
    const ctx = page()
    board()
    groupBy('asset')
    fireEvent.drop(column('Storm Lantern'), dt('t1'))
    await waitFor(() => expect(ctx.setTaskItemsOfKind).toHaveBeenCalledWith('t1', 'asset', ['a2']))
    expect(ctx.runWithUndoToast.mock.calls[0][1]).toBe('Moved "Glass and rain rig test" to Storm Lantern')
  })

  it('without the toast route the write still lands; a seat that may not write drops nothing', async () => {
    const ctx = page({ runWithUndoToast: undefined })
    groupBy('asset')
    fireEvent.drop(band('Harbour Wall'), dt('t3'))
    await waitFor(() => expect(ctx.setTaskItemsOfKind).toHaveBeenCalledWith('t3', 'asset', ['a3']))
    cleanup(); _resetOverlaysForTests()
    const ro = page({ writer: false })
    groupBy('asset')
    fireEvent.drop(band('Harbour Wall'), dt('t3'))
    await Promise.resolve()
    expect(ro.setTaskItemsOfKind).not.toHaveBeenCalled()
  })

  it('where the backend keeps no items (a cloud before 0096), a task\'s one field is its item, and a drop writes it as before', () => {
    const ctx = page({ items: false })
    groupBy('asset')
    // Each task's own field is its one item; t4's names an asset the project
    // does not show (in the trash), so t4 is under No asset.
    expect(bands()).toEqual([['Lighthouse Interior', '1'], ['Storm Lantern', '1'], ['Harbour Wall', '1'], ['No asset', '1']])
    fireEvent.drop(band('Harbour Wall'), dt('t1'))
    expect(ctx.updateTask).toHaveBeenCalledWith('t1', { asset_id: 'a3' })
    fireEvent.drop(band('No asset'), dt('t1'))
    expect(ctx.updateTask).toHaveBeenLastCalledWith('t1', { asset_id: null })
    expect(ctx.setTaskItemsOfKind).not.toHaveBeenCalled()
  })
})

describe('VW1m: a new task made in a group carries the group\'s items', () => {
  const titleIt = (name) => fireEvent.change(screen.getByPlaceholderText('What needs doing?'), { target: { value: name } })
  const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Confirm & create' }))

  it('from a combination: the assets shown read-only (no one-asset choice), and passed as items', async () => {
    const ctx = page()
    groupBy('asset')
    // In a grouped table every group ends in its own New task row, in the bands' order.
    fireEvent.click(document.querySelectorAll('.rb-task-add')[1])
    const dialog = screen.getByRole('dialog', { name: 'New task' })
    expect(within(dialog).getByText('Assets')).toBeTruthy()
    const readout = dialog.querySelector('.rb-task-readout')
    expect(readout.textContent).toBe('Lighthouse Interior, Storm Lantern')
    expect(readout.getAttribute('title')).toBe('Lighthouse Interior, Storm Lantern')
    expect(within(dialog).queryByText(/no asset .* task lives directly under the phase/)).toBeNull()
    titleIt('Rain pass')
    confirm()
    await waitFor(() => expect(ctx.addTask).toHaveBeenCalledTimes(1))
    const row = ctx.addTask.mock.calls[0][0]
    expect(row.items).toEqual({ asset: ['a1', 'a2'] })
    expect('asset_id' in row).toBe(false)
    expect(row.title).toBe('Rain pass')
  })

  it('from one asset: the popup\'s own Asset choice, set to it, and no items', async () => {
    const ctx = page()
    groupBy('asset')
    fireEvent.click(document.querySelectorAll('.rb-task-add')[0])
    const dialog = screen.getByRole('dialog', { name: 'New task' })
    expect(dialog.querySelector('.rb-task-readout')).toBeNull()
    expect(within(dialog).getByDisplayValue('Harbour Wall')).toBeTruthy()
    titleIt('Moss pass')
    confirm()
    await waitFor(() => expect(ctx.addTask).toHaveBeenCalledTimes(1))
    expect(ctx.addTask.mock.calls[0][0].asset_id).toBe('a3')
    expect(ctx.addTask.mock.calls[0][0].items).toBeUndefined()
  })

  it('from No asset, and from the toolbar: no asset, no items (as before)', async () => {
    const ctx = page()
    groupBy('asset')
    fireEvent.click(document.querySelectorAll('.rb-task-add')[2])
    titleIt('Sound pass')
    confirm()
    await waitFor(() => expect(ctx.addTask).toHaveBeenCalledTimes(1))
    expect(ctx.addTask.mock.calls[0][0]).toMatchObject({ asset_id: null })
    expect(ctx.addTask.mock.calls[0][0].items).toBeUndefined()
  })

  it('the Board\'s column + carries the same', async () => {
    const ctx = page()
    board()
    groupBy('asset')
    fireEvent.click(screen.getByRole('button', { name: 'New task in Lighthouse Interior, Storm Lantern' }))
    titleIt('Glass pass')
    confirm()
    await waitFor(() => expect(ctx.addTask).toHaveBeenCalledTimes(1))
    expect(ctx.addTask.mock.calls[0][0].items).toEqual({ asset: ['a1', 'a2'] })
  })
})

describe('VW1m: the Asset cell names every live asset and opens the task\'s window (Q-N5\'s interim)', () => {
  const cell = (title) => rowOf(title).querySelectorAll(':scope > td')[4].firstElementChild

  it('every live asset by name in the display order, the list its title and its accessible name; no select', () => {
    page()
    const c = cell('Glass and rain rig test')
    expect(c.tagName).toBe('BUTTON')
    expect(c.getAttribute('type')).toBe('button')
    expect(c.textContent).toBe('Lighthouse Interior, Storm Lantern')
    expect(c.getAttribute('title')).toBe('Lighthouse Interior, Storm Lantern')
    expect(screen.getAllByRole('button', { name: 'Lighthouse Interior, Storm Lantern' })).toHaveLength(2)
    // t4's asset in the trash is hidden (her Q-N4).
    expect(cell('Lantern flicker').textContent).toBe('Lighthouse Interior, Storm Lantern')
    expect(document.querySelector('tr.rb-task-row select[aria-label="Asset"]')).toBeNull()
  })

  it('none reads the dash, named No asset; CONTROL: the stale copy (a1) is not read', () => {
    page()
    const c = cell('Edit review')
    expect(c.textContent).toBe('—')
    expect(c.getAttribute('data-empty')).toBe('true')
    expect(c.getAttribute('aria-label')).toBe('No asset')
  })

  it('a click opens that task\'s window, as the row\'s Open does; a seat that may not write keeps it', () => {
    page()
    fireEvent.click(cell('Wall texture pass'))
    expect(screen.getByRole('dialog', { name: 'task window t2' })).toBeTruthy()
    cleanup(); _resetOverlaysForTests()
    page({ writer: false })
    fireEvent.click(cell('Glass and rain rig test'))
    expect(screen.getByRole('dialog', { name: 'task window t1' })).toBeTruthy()
  })

  it('a Board card names every live asset, the whole list on hover', () => {
    page()
    board()
    const card = screen.getByText('Glass and rain rig test').closest('.rb-task-card')
    const names = card.querySelector('.rb-task-card-asset')
    expect(names.textContent).toBe('Lighthouse Interior, Storm Lantern')
    expect(names.getAttribute('title')).toBe('Lighthouse Interior, Storm Lantern')
    // CONTROL: the stale copy alone (t3's a1) names nothing.
    expect(screen.getByText('Edit review').closest('.rb-task-card').querySelector('.rb-task-card-asset')).toBeNull()
  })
})

describe('VW1m: Asset is X means the task has X', () => {
  function filter(op, value) {
    fireEvent.click(screen.getByRole('button', { name: /^Filter/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Field' }), { target: { value: 'asset_id' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Condition' }), { target: { value: op } })
    if (value) fireEvent.change(screen.getByRole('combobox', { name: 'Value' }), { target: { value } })
  }
  it('is Storm Lantern: every task that has it, whichever item it was added as', () => {
    page()
    filter('is', 'a2')
    expect(shownTitles()).toEqual(['Glass and rain rig test', 'Lantern flicker'])
  })
  it('is Lighthouse Interior: CONTROL, the copy says t1 is Storm Lantern\'s and t3 Lighthouse Interior\'s', () => {
    page()
    filter('is', 'a1')
    expect(shownTitles()).toEqual(['Glass and rain rig test', 'Lantern flicker'])
  })
  it('is not Storm Lantern: none of its assets is it', () => {
    page()
    filter('is_not', 'a2')
    expect(shownTitles()).toEqual(['Wall texture pass', 'Edit review'])
  })
  it('is empty and is not empty read the live assets', () => {
    page()
    filter('is_empty')
    expect(shownTitles()).toEqual(['Edit review'])
    cleanup(); _resetOverlaysForTests()
    page()
    filter('is_not_empty')
    expect(shownTitles()).toEqual(['Glass and rain rig test', 'Wall texture pass', 'Lantern flicker'])
  })
})

describe('VW1m: the Group menu keeps today\'s fields; Scene, Shot, Level and Experience come with their columns (VW1b)', () => {
  const options = () => [...screen.getByRole('combobox', { name: 'Group' }).options].map((o) => o.textContent)

  it('every kind turned on still offers Asset alone among the item kinds', () => {
    page({ project: { scenes_enabled: true, levels_enabled: true, experiences_enabled: true } })
    expect(options()).toEqual(['No grouping', 'Status', 'Asset', 'Phase', 'Priority', 'Assignee'])
  })
})
