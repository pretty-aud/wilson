/** @vitest-environment jsdom */
// =============================================================================
// taskItemsTable.test.jsx — FX2 (0096): the task window's Items table, on its
// left, as the scene window's Assets table (RelationsPanel.jsx's parts), and
// VW1m (2026-10-16): no main item. Her rulings (CUSTOM_VIEWS_QUESTIONS.md,
// batches 12 and 14): "lets not have main asset be a thing"; Q-N1 "allow user
// to sort select order by date of creation/upload, alphabetical, type"; Q-N2
// a Files section per item; Q-N3 filed in its section's item's folder; Q-N4
// an item in the trash hidden, back on restore.
//   · no Main, no Move up / Move down: every row's hover slot holds Remove;
//   · ONE Sort menu in the Items head beside the +: Type (the default, a run
//     per kind), A to Z and Date added (one list, each row its kind's glyph);
//     remembered on that computer (one key, a throwing store survived);
//     reached and left by keyboard;
//   · an item whose row the project does not show is HIDDEN: not listed, not
//     counted, never the "last item";
//   · ONE add control opens ONE picker over every kind; a pick adds it;
//   · remove at one click — the task's LAST live item asks first;
//   · a seat that may not write sees the + and every Remove greyed (Sort is
//     not a write);
//   · a Files section per live item, in the table's Sort, the first open,
//     each its own item's FileManager (a shot's passes shotId);
//   · without items (a cloud before 0096; the Dashboard) the Placement
//     pickers stay, the Files sections read the task's own fields, and the
//     Dashboard's window reads out every item by kind ("A, B" for assets).
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
// FileManager is lane B4's: here it only says which entity it was handed.
vi.mock('./FileManager', async () => {
  const { createElement } = await import('react')
  const PROPS = ['assetId', 'assetName', 'sceneId', 'sceneName', 'shotId', 'shotName', 'levelId', 'levelName', 'experienceId', 'experienceName', 'taskId', 'mode']
  return {
    default: (p) => createElement('div', {
      className: 'files-under-test',
      'data-props': JSON.stringify(Object.fromEntries(PROPS.filter(k => p[k] !== undefined).map(k => [k, p[k]]))),
    }),
  }
})

const { default: TaskDetailPopup } = await import('./TaskDetailPopup')

const SORT_KEY = 'rabbit_task_items_sort'
const item = (id, kind, entity, position, created_at = '2026-10-11T00:00:00Z') => ({ id, task_id: 't1', project_id: 'p1', entity_type: kind, entity_id: entity, position, created_at })

// Where items are kept the provider's tasks carry no link field (item 2 of
// the VW1m hand-off): this one carries none, so nothing here can read one.
function ctxOf(over = {}) {
  const ctx = {
    tasks: [{ id: 't1', title: 'Spray comp', status: 'in_progress', priority: 'high' }],
    assets: [{ id: 'a1', name: 'Sea Spray Comp', status: 'in_progress' }, { id: 'a2', name: 'Lighthouse Interior', status: 'approved' }, { id: 'a3', name: 'Storm Lantern', status: 'final' }],
    phases: [{ id: 'ph1', name: 'Post' }],
    project: { id: 'p1', scenes_enabled: true, levels_enabled: false, experiences_enabled: false },
    scenes: [{ id: 's4', name: 'The storm', status: 'in_progress' }, { id: 's5', name: "Father's boat", status: 'pending_review' }],
    shots: [{ id: 'h10', scene_id: 's4', name: 'Rain on the glass', status: 'in_progress' }, { id: 'h11', scene_id: 's4', name: 'The log book', status: 'in_progress' }],
    levels: [], experiences: [],
    taskItems: [item('i1', 'asset', 'a1', 0), item('i2', 'asset', 'a2', 1), item('i3', 'scene', 's4', 0), item('i4', 'shot', 'h10', 0)],
    taskItemsAvailable: true,
    addTaskItem: vi.fn(async () => ({})), removeTaskItem: vi.fn(async () => {}),
    teamAssignments: [], updateTask: vi.fn(), deleteTask: vi.fn(), managedFiles: [],
    myProjectRole: 'manager', projectIsStaffed: false, activeProjectId: 'p1',
    ...over,
  }
  holder.ctx = ctx
  return ctx
}
const open = (ctx, onClose = vi.fn()) => render(<TaskDetailPopup taskId="t1" ctx={ctx} onClose={onClose} />)
const table = () => document.querySelector('.rb-rel-items')
const rowNames = () => [...table().querySelectorAll('.rb-rel-row .rb-rel-name')].map(n => n.textContent)
const kindGroups = () => [...table().querySelectorAll('.rb-rel-kind')].map(g => g.getAttribute('aria-label'))
const sortButton = () => within(table()).getByRole('button', { name: /^Sort items: / })
const menuItems = () => [...document.querySelectorAll('.ui-menu .ui-menu-item')]
function chooseSort(label) {
  fireEvent.click(sortButton())
  fireEvent.click(menuItems().find(b => b.textContent === label))
}
const sectionLabels = () => [...document.querySelectorAll('.rb-task-detail-files .rb-task-section-label')].map(l => l.textContent)
const sectionOpen = () => [...document.querySelectorAll('.rb-task-detail-files .rb-task-section-head')].map(h => h.getAttribute('aria-expanded'))
const filesHandedTo = () => [...document.querySelectorAll('.files-under-test')].map(f => JSON.parse(f.dataset.props))

beforeEach(() => { holder.role = 'admin'; localStorage.clear() })
afterEach(() => { cleanup(); _resetOverlaysForTests(); vi.restoreAllMocks(); localStorage.clear() })

describe('the Items table', () => {
  it('sits at the top of the left column, rows grouped by kind (Type), names A to Z inside a kind, a shot as "Scene › Shot"', () => {
    open(ctxOf())
    const t = table()
    expect(t.closest('.rb-task-detail-files')).not.toBeNull()
    expect(within(t).getByText('Items (4)')).toBeTruthy()
    expect(kindGroups()).toEqual(['Assets', 'Scenes', 'Shots'])
    // The display order, not the stored one: Lighthouse Interior was added
    // second and reads first.
    expect(rowNames()).toEqual(['Lighthouse Interior', 'Sea Spray Comp', 'The storm', 'The storm › Rain on the glass'])
    // Status words, the kit's.
    expect(within(t).getAllByText('In progress').length).toBeGreaterThan(0)
  })

  it('no Main: no badge, no word, nothing marks one item of a kind', () => {
    open(ctxOf())
    expect(table().querySelector('.ui-badge')).toBeNull()
    expect(within(table()).queryByText('Main')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\bmain\b/i)
  })

  it('no Move up / Move down: every row\'s hover slot holds Remove alone', () => {
    open(ctxOf())
    expect(within(table()).queryByRole('button', { name: /^Move / })).toBeNull()
    const rows = [...table().querySelectorAll('.rb-rel-row')]
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      const slot = row.querySelector('.ui-hover-actions')
      expect([...slot.querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual([`Remove ${row.querySelector('.rb-rel-name').textContent}`])
    }
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
})

// Her Q-N4: "Hidden, back on restore".
describe('an item whose row the project does not show is hidden', () => {
  it('a trashed asset and a scene not loaded are not listed and not counted; the live ones are', () => {
    open(ctxOf({ taskItems: [item('i1', 'asset', 'a1', 0), item('i9', 'asset', 'trashed', 1), item('i8', 'scene', 'gone-scene', 0)] }))
    expect(within(table()).getByText('Items (1)')).toBeTruthy()
    expect(rowNames()).toEqual(['Sea Spray Comp'])
    expect(table().textContent).not.toMatch(/No longer in the project|Untitled/)
    expect(kindGroups()).toEqual(['Assets'])
  })

  it('the last LIVE item is the last item: its remove asks first', () => {
    const ctx = ctxOf({ taskItems: [item('i1', 'asset', 'a1', 0), item('i9', 'asset', 'trashed', 1)] })
    open(ctx)
    fireEvent.click(within(table()).getByRole('button', { name: 'Remove Sea Spray Comp' }))
    expect(ctx.removeTaskItem).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Remove the last item' })).toBeTruthy()
  })

  it('back on restore: the row comes back when the project shows it again', () => {
    const ctx = ctxOf({ taskItems: [item('i1', 'asset', 'a1', 0), item('i9', 'asset', 'a9', 1)] })
    const { rerender } = open(ctx)
    expect(rowNames()).toEqual(['Sea Spray Comp'])
    const restored = { ...ctx, assets: [...ctx.assets, { id: 'a9', name: 'Bell Rope', status: 'in_progress' }] }
    holder.ctx = restored
    rerender(<TaskDetailPopup taskId="t1" ctx={restored} onClose={vi.fn()} />)
    expect(rowNames()).toEqual(['Bell Rope', 'Sea Spray Comp'])
    expect(within(table()).getByText('Items (2)')).toBeTruthy()
  })
})

// Her Q-N1, Hick: one Sort where two buttons sat on every row.
describe('the Sort menu', () => {
  it('sits in the Items head beside the +, names its choice, and offers three: Type, A to Z, Date added (Type checked)', () => {
    open(ctxOf())
    const sort = sortButton()
    expect(sort.getAttribute('aria-label')).toBe('Sort items: Type')
    expect(sort.nextElementSibling.contains(within(table()).getByRole('button', { name: 'Add an item' }))).toBe(true)
    fireEvent.click(sort)
    expect(document.querySelector('.ui-menu .ui-menu-header').textContent).toBe('Sort items by')
    expect(menuItems().map(b => b.textContent)).toEqual(['Type', 'A to Z', 'Date added'])
    // The check marks the choice; the others hold its room (one edge).
    expect(menuItems().map(b => !!b.querySelector('svg.lucide'))).toEqual([true, false, false])
    expect(menuItems().every(b => b.querySelector('svg'))).toBe(true)
  })

  it('by keyboard: opening puts focus on the first choice; Escape closes the menu, focus back on Sort, the window stays', () => {
    const onClose = vi.fn()
    open(ctxOf(), onClose)
    const sort = sortButton()
    sort.focus()
    fireEvent.click(sort)
    expect(document.activeElement).toBe(menuItems()[0])
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(document.querySelector('.ui-menu')).toBeNull()
    expect(document.activeElement).toBe(sort)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('A to Z: one list by name, no kind names, each row naming its kind by its glyph', () => {
    open(ctxOf())
    chooseSort('A to Z')
    expect(sortButton().getAttribute('aria-label')).toBe('Sort items: A to Z')
    expect(table().querySelector('.rb-rel-kind')).toBeNull()
    expect(rowNames()).toEqual(['Lighthouse Interior', 'Sea Spray Comp', 'The storm', 'The storm › Rain on the glass'])
    expect([...table().querySelectorAll('.rb-rel-row svg[role="img"]')].map(g => g.getAttribute('aria-label'))).toEqual(['Asset', 'Asset', 'Scene', 'Shot'])
  })

  it('Date added: one list in the order the items were added, across kinds', () => {
    open(ctxOf({ taskItems: [
      item('i1', 'asset', 'a1', 0, '2026-10-12T00:00:00Z'), item('i2', 'asset', 'a2', 1, '2026-10-13T00:00:00Z'),
      item('i3', 'scene', 's4', 0, '2026-10-11T00:00:00Z'), item('i4', 'shot', 'h10', 0, '2026-10-09T00:00:00Z'),
    ] }))
    chooseSort('Date added')
    expect(table().querySelector('.rb-rel-kind')).toBeNull()
    expect(rowNames()).toEqual(['The storm › Rain on the glass', 'The storm', 'Sea Spray Comp', 'Lighthouse Interior'])
    chooseSort('Type')
    expect(kindGroups()).toEqual(['Assets', 'Scenes', 'Shots'])
  })

  it('is remembered on that computer: one key, and the next window opens at it', () => {
    open(ctxOf())
    chooseSort('A to Z')
    expect(localStorage.getItem(SORT_KEY)).toBe('name')
    cleanup(); _resetOverlaysForTests()
    open(ctxOf())
    expect(sortButton().getAttribute('aria-label')).toBe('Sort items: A to Z')
    expect(table().querySelector('.rb-rel-kind')).toBeNull()
  })

  it('a kept value it does not know reads as Type', () => {
    localStorage.setItem(SORT_KEY, 'main')
    open(ctxOf())
    expect(sortButton().getAttribute('aria-label')).toBe('Sort items: Type')
  })

  it('a store that throws (a private window, blocked site data): the window opens at Type and the choice still works in it', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    open(ctxOf())
    expect(sortButton().getAttribute('aria-label')).toBe('Sort items: Type')
    chooseSort('A to Z')
    expect(sortButton().getAttribute('aria-label')).toBe('Sort items: A to Z')
  })

  it('shows once there are two live items to order', () => {
    open(ctxOf({ taskItems: [item('i1', 'asset', 'a1', 0), item('i9', 'asset', 'trashed', 1)] }))
    expect(within(table()).queryByRole('button', { name: /^Sort items/ })).toBeNull()
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

  it('removes an item at one click, whichever it is; the task\'s LAST item asks first, Cancel focused', () => {
    const ctx = ctxOf()
    const { unmount } = open(ctx)
    // Lighthouse Interior reads first of the assets now; removing either
    // asset, first or not, is the same one click.
    fireEvent.click(within(table()).getByRole('button', { name: 'Remove Lighthouse Interior' }))
    expect(ctx.removeTaskItem).toHaveBeenCalledWith('i2')
    fireEvent.click(within(table()).getByRole('button', { name: 'Remove Sea Spray Comp' }))
    expect(ctx.removeTaskItem).toHaveBeenCalledWith('i1')
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
})

describe('a seat that may not write', () => {
  it('a reviewer sees the add and every remove greyed, and nothing is written; Sort is not a write and stays open', () => {
    holder.role = 'user'
    const ctx = ctxOf({ myProjectRole: 'reviewer', projectIsStaffed: true })
    open(ctx)
    const add = within(table()).getByRole('button', { name: 'Add an item' })
    fireEvent.click(add)
    expect(document.querySelector('.rb-rel-items-pick')).toBeNull()
    fireEvent.click(within(table()).getByRole('button', { name: 'Remove Lighthouse Interior' }))
    expect(ctx.removeTaskItem).not.toHaveBeenCalled()
    expect(within(table()).getByRole('button', { name: 'Remove Lighthouse Interior' }).closest('[aria-disabled="true"]')).not.toBeNull()
    expect(sortButton().closest('[aria-disabled="true"]')).toBeNull()
    chooseSort('A to Z')
    expect(table().querySelector('.rb-rel-kind')).toBeNull()
  })
})

// Her Q-N2 ("A section per item") and Q-N3 ("Folder of its section").
describe('the Files sections under the table', () => {
  it('one per live item, "<Kind>: <name>", in the table\'s Sort; the first open, the others closed', () => {
    open(ctxOf({ taskItems: [...ctxOf().taskItems, item('i9', 'asset', 'trashed', 2)] }))
    expect(sectionLabels()).toEqual(['Asset: Lighthouse Interior', 'Asset: Sea Spray Comp', 'Scene: The storm', 'Shot: The storm › Rain on the glass'])
    expect(sectionOpen()).toEqual(['true', 'false', 'false', 'false'])
    // The upload's name is asked once, over every section.
    expect(screen.getAllByText('Upload file name')).toHaveLength(1)
  })

  it('each is its own item\'s FileManager: an asset by assetId, a scene by sceneId, a shot by shotId (never as an asset)', () => {
    open(ctxOf())
    expect(filesHandedTo()).toEqual([{ assetId: 'a2', assetName: 'Lighthouse Interior', taskId: 't1', mode: 'readonly' }])
    const heads = [...document.querySelectorAll('.rb-task-detail-files .rb-task-section-head')]
    fireEvent.click(heads[2])
    fireEvent.click(heads[3])
    expect(filesHandedTo()).toEqual([
      { assetId: 'a2', assetName: 'Lighthouse Interior', taskId: 't1', mode: 'readonly' },
      { sceneId: 's4', sceneName: 'The storm', taskId: 't1', mode: 'readonly' },
      { shotId: 'h10', shotName: 'Rain on the glass', taskId: 't1', mode: 'readonly' },
    ])
    // A press folds the open one.
    fireEvent.click(heads[0])
    expect(sectionOpen()).toEqual(['false', 'false', 'true', 'true'])
  })

  it('a level\'s and an experience\'s by levelId and experienceId', () => {
    open(ctxOf({
      project: { id: 'p1', scenes_enabled: false, levels_enabled: true, experiences_enabled: true },
      levels: [{ id: 'l1', name: 'Lamp Room', status: 'in_progress' }], experiences: [{ id: 'e1', name: 'First Light', status: 'in_progress' }],
      taskItems: [item('i5', 'level', 'l1', 0), item('i6', 'experience', 'e1', 0)],
    }))
    expect(sectionLabels()).toEqual(['Level: Lamp Room', 'Experience: First Light'])
    fireEvent.click(document.querySelectorAll('.rb-task-detail-files .rb-task-section-head')[1])
    expect(filesHandedTo()).toEqual([
      { levelId: 'l1', levelName: 'Lamp Room', taskId: 't1', mode: 'readonly' },
      { experienceId: 'e1', experienceName: 'First Light', taskId: 't1', mode: 'readonly' },
    ])
  })

  it('follow the Sort: Date added reorders them, and the first is the one open', () => {
    open(ctxOf({ taskItems: [
      item('i1', 'asset', 'a1', 0, '2026-10-12T00:00:00Z'), item('i2', 'asset', 'a2', 1, '2026-10-13T00:00:00Z'),
      item('i3', 'scene', 's4', 0, '2026-10-11T00:00:00Z'), item('i4', 'shot', 'h10', 0, '2026-10-09T00:00:00Z'),
    ] }))
    chooseSort('Date added')
    expect(sectionLabels()).toEqual(['Shot: The storm › Rain on the glass', 'Scene: The storm', 'Asset: Sea Spray Comp', 'Asset: Lighthouse Interior'])
    expect(sectionOpen()).toEqual(['true', 'false', 'false', 'false'])
    expect(filesHandedTo()).toEqual([{ shotId: 'h10', shotName: 'Rain on the glass', taskId: 't1', mode: 'readonly' }])
  })

  // VW1m review round 2 (R2-8): the open section was "the first", whatever
  // the first was at each render, so an item added that sorts first closed
  // the section the person was looking at and opened the new one. The one
  // open by default is the one that was first when the window opened (and
  // again when the person picks another Sort, as above).
  it('R2-8: an item added that sorts first leaves the open section open, and the new one closed', () => {
    const two = [item('i1', 'asset', 'a1', 0), item('i3', 'scene', 's4', 0)]
    const r = open(ctxOf({ taskItems: two }))
    expect(sectionLabels()).toEqual(['Asset: Sea Spray Comp', 'Scene: The storm'])
    expect(sectionOpen()).toEqual(['true', 'false'])
    // Lighthouse Interior is added: A to Z it sorts before Sea Spray Comp.
    const ctx = ctxOf({ taskItems: [...two, item('i2', 'asset', 'a2', 1)] })
    r.rerender(<TaskDetailPopup taskId="t1" ctx={ctx} onClose={vi.fn()} />)
    expect(sectionLabels()).toEqual(['Asset: Lighthouse Interior', 'Asset: Sea Spray Comp', 'Scene: The storm'])
    expect(sectionOpen()).toEqual(['false', 'true', 'false'])
  })

  it('no live item: no section, and the hint says what to add', () => {
    open(ctxOf({ taskItems: [item('i9', 'asset', 'trashed', 0)] }))
    expect(sectionLabels()).toEqual([])
    expect(screen.getByText('Add an asset, scene or shot to see its files here')).toBeTruthy()
    expect(screen.queryByText('Upload file name')).toBeNull()
  })
})

describe('without items (a cloud before 0096; the Dashboard)', () => {
  const withFields = { id: 't1', title: 'Spray comp', status: 'in_progress', priority: 'high', asset_id: 'a1', scene_id: 's4', shot_id: 'h10' }

  it('no Items table; the Placement pickers as they were; a Files section per field, each its own entity\'s', () => {
    open(ctxOf({ taskItemsAvailable: false, tasks: [withFields] }))
    expect(table()).toBeNull()
    expect(screen.getByText('Asset')).toBeTruthy()
    expect(screen.getByText('Scene')).toBeTruthy()
    expect(sectionLabels()).toEqual(['Asset: Sea Spray Comp', 'Scene: The storm', 'Shot: The storm › Rain on the glass'])
    fireEvent.click(document.querySelectorAll('.rb-task-detail-files .rb-task-section-head')[2])
    expect(filesHandedTo()[1]).toEqual({ shotId: 'h10', shotName: 'Rain on the glass', taskId: 't1', mode: 'readonly' })
  })

  // The Dashboard hands the window no assets (so no Files column mounts) and
  // tasks whose rows carry their items (listMyTasks, her Q-N6 interim).
  const dashboard = (task) => ctxOf({
    taskItemsAvailable: undefined, taskItems: undefined, tasks: [task], assets: [], phases: [],
    project: { id: 'p1' }, scenes: [], shots: [],
  })

  const readouts = () => [...document.querySelectorAll('.rb-task-readout:not(.rb-task-readout-figure)')]
    .map(r => [r.closest('.ui-field').querySelector('.ui-field-label').textContent, r.textContent])

  it('the Dashboard\'s window names EVERY asset the task is about (A to Z), never one of them, and reads out its other items by kind', () => {
    open(dashboard({ ...withFields, items: [
      { kind: 'asset', id: 'a1', name: 'Sea Spray Comp' }, { kind: 'scene', id: 's4', name: 'The storm' }, { kind: 'asset', id: 'a2', name: 'Lighthouse Interior' },
      { kind: 'shot', id: 'h10', name: 'The storm › Rain on the glass' },
    ] }))
    expect(readouts()).toEqual([['Assets', 'Lighthouse Interior, Sea Spray Comp'], ['Scene', 'The storm'], ['Shot', 'The storm › Rain on the glass']])
    expect(document.querySelector('.rb-task-readout:not(.rb-task-readout-figure)').getAttribute('title'))
      .toBe('Lighthouse Interior, Sea Spray Comp. Open the project in R.A.B.B.I.T. to re-link this task')
    // Read out, not picked; and no files column (it would write to the
    // provider's active project).
    expect(screen.queryByRole('combobox', { name: /^Assets?$/ })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Scene' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Phase' })).toBeTruthy()
    expect(document.querySelector('.rb-task-detail-files')).toBeNull()
  })

  it('a Dashboard row with no item reads "—" for its asset (nothing there to choose from)', () => {
    open(dashboard({ ...withFields, asset_id: null, items: [] }))
    expect(readouts()).toEqual([['Asset', '—']])
  })

  it('a row from before the items names its one embedded asset, as it did', () => {
    open(dashboard({ ...withFields, asset: { name: 'Sea Spray Comp' } }))
    expect(readouts()).toEqual([['Asset', 'Sea Spray Comp']])
    expect(document.querySelector('.rb-task-readout:not(.rb-task-readout-figure)').getAttribute('title'))
      .toBe('Open the project in R.A.B.B.I.T. to re-link this task')
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
  it('a related task\'s line names EVERY live asset, A to Z, the whole list on hover (it named the first only)', () => {
    const ctx = ctxOf({ taskItems: [item('i1', 'asset', 'a1', 0), item('i2', 'asset', 'a2', 1), item('i9', 'asset', 'trashed', 2), item('i3', 'scene', 's4', 0)] })
    render(<RelationsPanel entityType="scene" entityId="s4" assets={ctx.assets} tasks={ctx.tasks} ctx={ctx} />)
    const line = screen.getByText('Spray comp').closest('.rb-rel-row').querySelector('.rb-rel-sub')
    expect(line.textContent).toBe('Lighthouse Interior, Sea Spray Comp')
    expect(line.getAttribute('title')).toBe('Lighthouse Interior, Sea Spray Comp')
  })
  it('a related task with no live asset has no line', () => {
    const ctx = ctxOf({ taskItems: [item('i9', 'asset', 'trashed', 0), item('i3', 'scene', 's4', 0)] })
    render(<RelationsPanel entityType="scene" entityId="s4" assets={ctx.assets} tasks={ctx.tasks} ctx={ctx} />)
    expect(screen.getByText('Spray comp').closest('.rb-rel-row').querySelector('.rb-rel-sub')).toBeNull()
  })
})
