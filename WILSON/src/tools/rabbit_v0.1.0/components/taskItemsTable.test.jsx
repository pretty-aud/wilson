/** @vitest-environment jsdom */
// =============================================================================
// taskItemsTable.test.jsx — FX2 (0096): the task window's Items table, on its
// left, as the scene window's Assets table (RelationsPanel.jsx's parts).
//   · the rows group by kind; a shot reads "Scene › Shot"; the MAIN badge
//     marks the first of a kind only where the kind holds more than one;
//   · ONE add control opens ONE picker over every kind, grouped, searchable,
//     never offering what the task already names; a pick adds the item;
//   · remove at the row's end, one click — except the task's LAST item,
//     which asks first (Cancel focused);
//   · Move up / Move down reorder within a kind;
//   · a seat that may not write (a reviewer) sees every verb greyed;
//   · an item whose row the project no longer shows reads so, and can go;
//   · with items, the window's five Placement pickers go (Phase stays);
//     without them (a cloud before 0096, the Dashboard) the window is as it was.
// =============================================================================

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../ui/overlay'

const holder = vi.hoisted(() => ({ role: 'admin', ctx: null }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({ supabase: {}, hydrateSupabase: async () => {} }))
vi.mock('../state/RabbitProvider', () => ({ useRabbit: () => holder.ctx }))
vi.mock('../../../components/TeamMembers/useRosterMembers', () => ({ useRosterMembers: () => ({ members: [], mode: 'supabase' }) }))
vi.mock('../../../components/RateCard/useRateCard', () => ({ useRateCard: () => ({ entries: [] }) }))
vi.mock('../../../permissions/usePermissions', () => ({ usePermissions: () => ({ role: holder.role, ready: true }) }))
vi.mock('./FileManager', () => ({ default: () => null }))

const { default: TaskDetailPopup } = await import('./TaskDetailPopup')

const item = (id, kind, entity, position) => ({ id, task_id: 't1', project_id: 'p1', entity_type: kind, entity_id: entity, position, created_at: '2026-10-11T00:00:00Z' })

function ctxOf(over = {}) {
  const ctx = {
    tasks: [{ id: 't1', title: 'Spray comp', status: 'in_progress', priority: 'high', asset_id: 'a1', scene_id: 's4', shot_id: 'h10' }],
    assets: [{ id: 'a1', name: 'Sea Spray Comp', status: 'in_progress' }, { id: 'a2', name: 'Lighthouse Interior', status: 'approved' }, { id: 'a3', name: 'Storm Lantern', status: 'final' }],
    phases: [{ id: 'ph1', name: 'Post' }],
    project: { id: 'p1', scenes_enabled: true, levels_enabled: false, experiences_enabled: false },
    scenes: [{ id: 's4', name: 'The storm', status: 'in_progress' }, { id: 's5', name: "Father's boat", status: 'pending_review' }],
    shots: [{ id: 'h10', scene_id: 's4', name: 'Rain on the glass', status: 'in_progress' }, { id: 'h11', scene_id: 's4', name: 'The log book', status: 'in_progress' }],
    levels: [], experiences: [],
    taskItems: [item('i1', 'asset', 'a1', 0), item('i2', 'asset', 'a2', 1), item('i3', 'scene', 's4', 0), item('i4', 'shot', 'h10', 0)],
    taskItemsAvailable: true,
    addTaskItem: vi.fn(async () => ({})), removeTaskItem: vi.fn(async () => {}), reorderTaskItems: vi.fn(async () => []),
    teamAssignments: [], updateTask: vi.fn(), deleteTask: vi.fn(), managedFiles: [],
    myProjectRole: 'manager', projectIsStaffed: false, activeProjectId: 'p1',
    ...over,
  }
  holder.ctx = ctx
  return ctx
}
const open = (ctx) => render(<TaskDetailPopup taskId="t1" ctx={ctx} onClose={vi.fn()} />)
const table = () => document.querySelector('.rb-rel-items')

beforeEach(() => { holder.role = 'admin' })
afterEach(() => { cleanup(); _resetOverlaysForTests() })

describe('the Items table', () => {
  it('sits at the top of the left column, rows grouped by kind, a shot as "Scene › Shot"', () => {
    open(ctxOf())
    const t = table()
    expect(t.closest('.rb-task-detail-files')).not.toBeNull()
    expect(within(t).getByText('Items (4)')).toBeTruthy()
    const groups = [...t.querySelectorAll('.rb-rel-kind')].map(g => g.getAttribute('aria-label'))
    expect(groups).toEqual(['Assets', 'Scenes', 'Shots'])
    expect(within(t).getByText('The storm › Rain on the glass')).toBeTruthy()
    // Status words, the kit's.
    expect(within(t).getAllByText('In progress').length).toBeGreaterThan(0)
  })

  it('marks the first of a kind as Main only where the kind holds more than one', () => {
    open(ctxOf())
    const mains = [...table().querySelectorAll('.rb-rel-main')]
    expect(mains).toHaveLength(1)
    expect(mains[0].closest('.rb-rel-item').textContent).toContain('Sea Spray Comp')
    expect(mains[0].getAttribute('title')).toMatch(/Timeline and the Budget/)
  })

  it('the window\'s Placement keeps Phase and drops the five pickers', () => {
    open(ctxOf())
    expect(screen.getByText('Phase')).toBeTruthy()
    for (const label of ['Asset', 'Scene', 'Shot']) expect(screen.queryByText(label, { selector: 'label, span.ui-field-label' })).toBeNull()
  })

  it('an empty table says what to add, naming only the kinds the project offers', () => {
    open(ctxOf({ taskItems: [] }))
    expect(table().querySelector('.rb-rel-empty').textContent).toBe('No items yet. Add the assets, scenes or shots this task is about.')
    cleanup(); _resetOverlaysForTests()
    open(ctxOf({ taskItems: [], project: { id: 'p1', scenes_enabled: false, levels_enabled: true, experiences_enabled: true } }))
    expect(table().querySelector('.rb-rel-empty').textContent).toBe('No items yet. Add the assets, levels or experiences this task is about.')
    cleanup(); _resetOverlaysForTests()
    open(ctxOf({ taskItems: [], project: { id: 'p1', scenes_enabled: false, levels_enabled: false, experiences_enabled: false } }))
    expect(table().querySelector('.rb-rel-empty').textContent).toBe('No items yet. Add the assets this task is about.')
  })

  it('without items (a cloud before 0096; the Dashboard) the window is as it was', () => {
    open(ctxOf({ taskItemsAvailable: false }))
    expect(table()).toBeNull()
    expect(screen.getByText('Asset')).toBeTruthy()
    expect(screen.getByText('Scene')).toBeTruthy()
  })
})

describe('the verbs', () => {
  it('ONE add control opens ONE picker over every kind, grouped, never offering what the task names; a pick adds it', () => {
    const ctx = ctxOf()
    open(ctx)
    fireEvent.click(within(table()).getByRole('button', { name: 'Add an item' }))
    const pick = document.querySelector('.rb-rel-items-pick')
    expect(pick).not.toBeNull()
    const groups = [...pick.querySelectorAll('.rb-rel-kind')].map(g => g.getAttribute('aria-label'))
    expect(groups).toEqual(['Assets', 'Scenes', 'Shots'])
    expect(within(pick).queryByRole('button', { name: 'Add Sea Spray Comp' })).toBeNull()
    expect(within(pick).getByRole('button', { name: 'Add The storm › The log book' })).toBeTruthy()
    fireEvent.click(within(pick).getByRole('button', { name: 'Add Storm Lantern' }))
    expect(ctx.addTaskItem).toHaveBeenCalledWith({ task_id: 't1', entity_type: 'asset', entity_id: 'a3' })
  })

  it('the picker\'s search narrows every kind at once', () => {
    open(ctxOf())
    fireEvent.click(within(table()).getByRole('button', { name: 'Add an item' }))
    const pick = document.querySelector('.rb-rel-items-pick')
    fireEvent.change(within(pick).getByLabelText("Search the project's items"), { target: { value: 'boat' } })
    expect([...pick.querySelectorAll('.rb-rel-pick-row')].map(b => b.textContent)).toEqual(["Father's boat"])
  })

  it('the search names the kinds the picker offers (in a game project, its levels and experiences too)', () => {
    open(ctxOf())
    fireEvent.click(within(table()).getByRole('button', { name: 'Add an item' }))
    expect(within(document.querySelector('.rb-rel-items-pick')).getByLabelText("Search the project's items").getAttribute('placeholder'))
      .toBe('Search assets, scenes, shots…')
    cleanup(); _resetOverlaysForTests()
    open(ctxOf({
      project: { id: 'p1', scenes_enabled: true, levels_enabled: true, experiences_enabled: true },
      levels: [{ id: 'l1', name: 'Lamp Room', status: 'in_progress' }], experiences: [{ id: 'e1', name: 'First Light', status: 'in_progress' }],
    }))
    fireEvent.click(within(table()).getByRole('button', { name: 'Add an item' }))
    const pick = document.querySelector('.rb-rel-items-pick')
    expect(within(pick).getByLabelText("Search the project's items").getAttribute('placeholder'))
      .toBe('Search assets, scenes, shots, levels, experiences…')
    expect([...pick.querySelectorAll('.rb-rel-kind')].map(g => g.getAttribute('aria-label'))).toEqual(['Assets', 'Scenes', 'Shots', 'Levels', 'Experiences'])
  })

  it('Escape in the picker closes the picker, not the window', () => {
    const onClose = vi.fn()
    render(<TaskDetailPopup taskId="t1" ctx={ctxOf()} onClose={onClose} />)
    fireEvent.click(within(table()).getByRole('button', { name: 'Add an item' }))
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('removes an item at one click; the task\'s LAST item asks first, Cancel focused', () => {
    const ctx = ctxOf()
    const { unmount } = open(ctx)
    fireEvent.click(within(table()).getByRole('button', { name: 'Remove Lighthouse Interior' }))
    expect(ctx.removeTaskItem).toHaveBeenCalledWith('i2')
    unmount()
    const lone = ctxOf({ taskItems: [item('i1', 'asset', 'a1', 0)] })
    open(lone)
    fireEvent.click(within(table()).getByRole('button', { name: 'Remove Sea Spray Comp' }))
    expect(lone.removeTaskItem).not.toHaveBeenCalled()
    const question = screen.getByRole('dialog', { name: 'Remove the last item' })
    expect(document.activeElement).toBe(within(question).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(question).getByRole('button', { name: 'Remove' }))
    expect(lone.removeTaskItem).toHaveBeenCalledWith('i1')
  })

  it('Move down makes the second asset main; Move up is greyed on the first row', () => {
    const ctx = ctxOf()
    open(ctx)
    const up = within(table()).getByRole('button', { name: 'Move Sea Spray Comp up' })
    expect(up.disabled).toBe(true)
    fireEvent.click(within(table()).getByRole('button', { name: 'Move Sea Spray Comp down' }))
    expect(ctx.reorderTaskItems).toHaveBeenCalledWith('t1', 'asset', ['i2', 'i1'])
    // A kind with one item has no move at all.
    expect(within(table()).queryByRole('button', { name: /^Move The storm/ })).toBeNull()
  })

  it('an item whose row the project no longer shows reads so, and can be removed', () => {
    const ctx = ctxOf({ taskItems: [item('i1', 'asset', 'a1', 0), item('i9', 'asset', 'trashed', 1)] })
    open(ctx)
    const gone = table().querySelector('.rb-rel-item[data-gone="true"]')
    expect(gone.textContent).toContain('No longer in the project')
    fireEvent.click(within(gone).getByRole('button', { name: 'Remove No longer in the project' }))
    expect(ctx.removeTaskItem).toHaveBeenCalledWith('i9')
  })
})

describe('a seat that may not write', () => {
  it('a reviewer sees the add and every remove greyed, and nothing is written', () => {
    holder.role = 'user'
    const ctx = ctxOf({ myProjectRole: 'reviewer', projectIsStaffed: true })
    open(ctx)
    const add = within(table()).getByRole('button', { name: 'Add an item' })
    fireEvent.click(add)
    expect(document.querySelector('.rb-rel-items-pick')).toBeNull()
    fireEvent.click(within(table()).getByRole('button', { name: 'Remove Lighthouse Interior' }))
    expect(ctx.removeTaskItem).not.toHaveBeenCalled()
    expect(ctx.reorderTaskItems).not.toHaveBeenCalled()
  })
})

// The other side of the same relation: a thing's window lists every task
// about it (FX2's pick for relation lists), from the items.
const { default: RelationsPanel } = await import('./RelationsPanel')
describe('a scene\'s, shot\'s, level\'s or experience\'s window lists every task about it', () => {
  it('a level\'s window lists a task whose level is an item (a level never matched a task on the cloud before)', () => {
    const ctx = ctxOf({ taskItems: [item('i1', 'asset', 'a1', 0), item('l1', 'level', 'L1', 0)], levels: [{ id: 'L1', name: 'Lamp Room' }] })
    render(<RelationsPanel entityType="level" entityId="L1" assets={ctx.assets} tasks={ctx.tasks} ctx={ctx} />)
    expect(screen.getByText('Tasks (1)')).toBeTruthy()
    expect(screen.getByText('Spray comp')).toBeTruthy()
  })
  it('a scene\'s window lists a task whose SECOND scene it is', () => {
    const ctx = ctxOf({ taskItems: [item('i1', 'scene', 's4', 0), item('i2', 'scene', 's5', 1)] })
    render(<RelationsPanel entityType="scene" entityId="s5" assets={ctx.assets} tasks={ctx.tasks} ctx={ctx} />)
    expect(screen.getByText('Tasks (1)')).toBeTruthy()
  })
  it('without items, the task\'s single link decides, as before', () => {
    const ctx = ctxOf({ taskItemsAvailable: false, taskItems: [item('i2', 'scene', 's5', 1)] })
    render(<RelationsPanel entityType="scene" entityId="s5" assets={ctx.assets} tasks={ctx.tasks} ctx={ctx} />)
    expect(screen.getByText('Tasks (0)')).toBeTruthy()
  })
})
