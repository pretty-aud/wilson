/** @vitest-environment jsdom */
// =============================================================================
// tasksViews.test.jsx — VW1d (2026-10-25): the custom views on the Tasks
// table, mounted inside the REAL provider over the dev fixtures (the cloud's
// twin in memory; VW1c's tableViewsProvider.test.jsx harness), as a person
// uses them. docs/design/CUSTOM_VIEWS_DESIGN.md §4.1 to §4.5, §4.8, §4.9 and
// §4.11, as VW1d's step 0 review corrected them; her answers by number.
// Each rule has a CONTROL the rule's absence fails.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, act, waitFor, fireEvent, within } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../../ui/overlay'
import { ToastProvider } from '../../../../ui/Toast'

const holder = vi.hoisted(() => ({ adapter: null, projectId: null }))
const seat = vi.hoisted(() => ({ canWrite: true }))
// Each test mounts the real provider and the whole Tasks table and works it
// as a person does: alone the slowest take about 2s here, and CI's runner
// passed the 5s default on three of them (f0065300, 49086256, 362a001a;
// VW1d, 2026-10-25). The waits inside each test bound it.
vi.setConfig({ testTimeout: 20_000 })

vi.mock('../../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('../../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
  hydrateSupabase: async () => {},
}))
vi.mock('../../../../lib/localData', () => ({
  hasLocalServer: () => false,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'supabase', activeProjectId: holder.projectId } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../../dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))
vi.mock('../../intake/pipeline', () => ({ runIngestion: vi.fn() }))
vi.mock('../../../../permissions/usePermissions', () => ({ usePermissions: () => ({ can: () => true, role: 'admin', ready: true }) }))
// The seat: may this person write the project (Q2, Q-F)?
vi.mock('../../../../permissions/projectRoleMatrix', async (importOriginal) => ({
  ...(await importOriginal()),
  canOnProject: () => seat.canWrite,
  projectActionDeniedReason: () => (seat.canWrite ? null : 'Only the project\'s editors can change this.'),
}))
vi.mock('../../../../components/TeamMembers/useRosterMembers', () => ({
  useRosterMembers: () => ({ members: [{ id: 'teammate-mara', name: 'Mara Okonkwo' }], mode: 'supabase' }),
}))
vi.mock('../../components/TaskDetailPopup', () => ({ default: () => null }))
vi.mock('../../components/EditHistoryDrawer', () => ({ default: () => null }))

const { buildDevFixtures } = await import('../../../../dev/fixtures/install')
const { PROJECT_ID } = await import('../../../../dev/fixtures/data/project')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('../../state/RabbitProvider')
const { TABLE_VIEW_LAST_WAIT_MS } = await import('../../state/tableViewsState')
const { default: ProjectTasksView } = await import('../ProjectTasksView')

let ctx = null
function Probe() { ctx = useRabbit(); return null }
let fx = null
let showTab = null
function Tab() {
  const [on, setOn] = useState(true)
  showTab = setOn
  return on ? <ProjectTasksView /> : null
}

const run = (fn) => act(async () => { await fn() })
// FX14 (OUTSTANDING FX13-03, the cause established before the fix): the
// fixtures load the project in microtasks, so ONE commit brings the adapter
// and the whole project, while the provider's last used status still reads
// 'unavailable' from its first effect (no adapter yet), and its effects for
// the adapter (the read that makes it 'loading', the drafts reset) run in a
// later task. In between, the table is drawn as All with the Views button, so
// the two waits below could both pass there: CI's push run 40345201708 found
// exactly that page (no Loading line, the rows, "Views: All"), and a run with
// the mount forced into that gap finds it every time. So the render runs
// inside act (React flushes those effects before act returns), and the mount
// waits for their evidence where the adapter reads a map: a status past
// 'unavailable', which it holds before the provider has an adapter.
async function mount(adapter = fx.rabbitAdapter()) {
  holder.adapter = adapter
  await act(async () => { render(<ToastProvider><RabbitProvider><Probe /><Tab /></RabbitProvider></ToastProvider>) })
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
  await waitFor(() => expect(screen.getByRole('button', { name: /^Views: / })).toBeTruthy())
  if (typeof adapter.getTableViewLast === 'function') await waitFor(() => expect(ctx.tableViewLast.status).not.toBe('unavailable'))
}
const viewsButton = () => screen.getByRole('button', { name: /^Views: / })
const openViews = () => fireEvent.click(viewsButton())
const dropdown = () => screen.queryByRole('dialog', { name: /^Views/ })
const bar = () => document.querySelector('.rb-tv-bar')
const rowCount = () => document.querySelectorAll('tr.rb-task-row').length
const storedTasks = () => fx.store.tasks.filter(t => t.project_id === PROJECT_ID && !t.deleted_at)
async function newView(name) {
  openViews()
  fireEvent.click(within(dropdown()).getByRole('button', { name: 'New view' }))
  fireEvent.change(within(dropdown()).getByRole('textbox', { name: 'View name' }), { target: { value: name } })
  await run(async () => { fireEvent.keyDown(within(dropdown()).getByRole('textbox', { name: 'View name' }), { key: 'Enter' }) })
}
// A filter through the toolbar's strip (the shared row): Status is <labels>.
async function filterStatus(...labels) {
  fireEvent.click(screen.getByRole('button', { name: /^Filter/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
  const rows = document.querySelectorAll('.rb-task-filters .rb-tv-filter-row')
  const row = rows[rows.length - 1]
  fireEvent.change(within(row).getByRole('combobox', { name: 'Field' }), { target: { value: 'status' } })
  fireEvent.click(within(row).getByRole('button', { name: /^Value:/ }))
  const picker = screen.getByRole('dialog', { name: 'Status: values' })
  for (const l of labels) fireEvent.click(within(picker).getByRole('checkbox', { name: new RegExp(`^${l}`) }))
  fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
}
// A teammate's save in the fake cloud, then the load that brings it (the
// live merge's effect on the screen: the row's revision moves).
async function teammateSaves(viewId, config) {
  const row = fx.store.tableViews.find(v => v.id === viewId)
  fx.store.tableViewRevision += 1
  row.revision = fx.store.tableViewRevision
  row.revised_by = 'teammate-mara'
  row.config = config
  await run(() => ctx.reloadActiveProject())
}

beforeEach(() => { fx = buildDevFixtures(); seat.canWrite = true })
afterEach(() => { cleanup(); _resetOverlaysForTests(); ctx = null; fx = null; localStorage.clear(); vi.restoreAllMocks() })

describe('the toolbar at rest (§4.1, Q-A1, Q-A2)', () => {
  it('the Views button names the view on screen; one New menu holds Task, Phase and Key date; no bar', async () => {
    await mount()
    expect(viewsButton().getAttribute('aria-haspopup')).toBe('dialog')
    expect(viewsButton().textContent).toBe('All')
    // No *edited* word and no dot (Q-A2); the bar is absent at rest (Q-A3).
    expect(bar()).toBeNull()
    // CONTROL: the three old buttons are gone from the toolbar.
    const toolbar = document.querySelector('.rb-task-toolbar')
    for (const name of ['Phase', 'Key date', 'New task']) expect(within(toolbar).queryByRole('button', { name })).toBeNull()
    fireEvent.click(within(toolbar).getByRole('button', { name: /^New/ }))
    expect([...document.querySelectorAll('.ui-menu .ui-menu-item')].map(b => b.textContent)).toEqual(['Task', 'Phase', 'Key date'])
  })
  it('Q17: the browser\'s old Tasks views are removed on the first load; CONTROL: another table\'s key stays (VW1e\'s)', async () => {
    localStorage.setItem('rabbit_task_saved_views', '[{"id":"1","name":"Old"}]')
    localStorage.setItem('rabbit_asset_saved_views', '[]')
    await mount()
    expect(localStorage.getItem('rabbit_task_saved_views')).toBeNull()
    expect(localStorage.getItem('rabbit_asset_saved_views')).toBe('[]')
  })
})

describe('New view (Q-G1), choosing a view (Q4, Q-H)', () => {
  it('a New view is saved for everyone at once, starting as All, applied, and made the last used view', async () => {
    await mount()
    await newView('Shoot week')
    const stored = fx.store.tableViews.find(v => v.name === 'Shoot week')
    expect(stored).toMatchObject({ table_key: 'tasks', project_id: PROJECT_ID })
    expect(stored.config).toEqual({ version: 1 })
    expect(viewsButton().textContent).toBe('Shoot week')
    expect(ctx.lastViewOf('tasks')).toBe(stored.id)
    expect(ctx.undoToast?.message).toBe('Shoot week saved for everyone')
    // The dropdown stays open on the list, the new row ticked.
    const row = within(dropdown()).getByRole('row', { current: true })
    expect(row.textContent).toContain('Shoot week')
  })
  it('choosing a view drops a change for now without asking (Q-H), and closes the dropdown', async () => {
    await mount()
    await newView('Shoot week')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    await filterStatus('In progress')
    expect(bar()).not.toBeNull()
    openViews()
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'All' }))
    expect(dropdown()).toBeNull()
    expect(viewsButton().textContent).toBe('All')
    expect(bar()).toBeNull()
    expect(rowCount()).toBe(storedTasks().length)
    // CONTROL: nothing asked.
    expect(screen.queryByRole('dialog', { name: /Save over/ })).toBeNull()
  })
})

describe('the change for now and the bar (Q3, Q3a, Q3c, Q-A3; defects 1 and 2)', () => {
  it('on All a change shows "All: changed for now" with Reset and Save as new view, no Save; Reset takes it away', async () => {
    await mount()
    await filterStatus('In progress', 'Pending review')
    const want = storedTasks().filter(t => ['in_progress', 'pending_review'].includes(t.status)).length
    expect(rowCount()).toBe(want)
    expect(bar().textContent).toContain('All: changed for now')
    expect(within(bar()).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(bar()).getByRole('button', { name: 'Save as new view' })).toBeTruthy()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Reset' }))
    expect(bar()).toBeNull()
    expect(rowCount()).toBe(storedTasks().length)
  })
  it('a new filter row with no value filters nothing, is not counted, and raises no bar (defect 1)', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /^Filter/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    expect(rowCount()).toBe(storedTasks().length)
    expect(screen.getByRole('button', { name: /^Filter/ }).textContent).toBe('Filter')
    expect(bar()).toBeNull()
  })
  it('changing a row\'s field resets its condition and value (defect 2)', async () => {
    await mount()
    await filterStatus('Final')
    const row = document.querySelector('.rb-task-filters .rb-tv-filter-row')
    fireEvent.change(within(row).getByRole('combobox', { name: 'Condition' }), { target: { value: 'is_not' } })
    fireEvent.change(within(row).getByRole('combobox', { name: 'Field' }), { target: { value: 'title' } })
    expect(within(row).getByRole('combobox', { name: 'Condition' }).value).toBe('contains')
    expect(within(row).getByRole('textbox', { name: 'Value' }).value).toBe('')
    expect(rowCount()).toBe(storedTasks().length)
  })
  it('Save writes the change into the view for everyone, conditional on its revision; the bar goes; the keyboard goes to the Views button', async () => {
    await mount()
    await newView('Shoot week')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    await filterStatus('In progress')
    expect(bar().textContent).toContain('Shoot week: changed for now')
    const before = fx.store.tableViews.find(v => v.name === 'Shoot week').revision
    await run(async () => { fireEvent.click(within(bar()).getByRole('button', { name: 'Save' })) })
    const stored = fx.store.tableViews.find(v => v.name === 'Shoot week')
    expect(stored.config.filters).toEqual([{ field: 'status', op: 'is', values: ['in_progress'] }])
    expect(stored.revision).toBeGreaterThan(before)
    expect(bar()).toBeNull()
    expect(document.activeElement).toBe(viewsButton())
    expect(ctx.undoToast?.message).toBe('Shoot week saved')
  })
  it('Save as new view names a new view, keeps the change in it, applies it, and makes it the last used one', async () => {
    await mount()
    await filterStatus('Final')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save as new view' }))
    const field = within(bar()).getByRole('textbox', { name: 'View name' })
    expect(field.value).toBe('All copy')
    fireEvent.change(field, { target: { value: 'Done work' } })
    await run(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
    const stored = fx.store.tableViews.find(v => v.name === 'Done work')
    expect(stored.config.filters).toEqual([{ field: 'status', op: 'is', values: ['final'] }])
    expect(viewsButton().textContent).toBe('Done work')
    expect(ctx.lastViewOf('tasks')).toBe(stored.id)
    expect(bar()).toBeNull()
  })
  it('the change lasts across tabs (Q3b): the Tasks tab away and back finds it', async () => {
    await mount()
    await filterStatus('Final')
    act(() => showTab(false))
    act(() => showTab(true))
    await waitFor(() => expect(bar()?.textContent).toContain('All: changed for now'))
  })
})

describe('a teammate meanwhile (Q3d, Q-G3)', () => {
  it('no change of one\'s own: the table follows the teammate\'s save, no bar', async () => {
    await mount()
    await newView('Shoot week')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    const id = fx.store.tableViews.find(v => v.name === 'Shoot week').id
    await teammateSaves(id, { version: 1, filters: [{ field: 'status', op: 'is', values: ['final'] }] })
    expect(rowCount()).toBe(storedTasks().filter(t => t.status === 'final').length)
    expect(bar()).toBeNull()
  })
  it('with a change of one\'s own: it stays on screen and the bar names the teammate; Save asks first, Cancel keeps theirs, then Save my changes writes mine', async () => {
    await mount()
    await newView('Shoot week')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    const id = fx.store.tableViews.find(v => v.name === 'Shoot week').id
    await filterStatus('In progress')
    const mine = rowCount()
    await teammateSaves(id, { version: 1, filters: [{ field: 'status', op: 'is', values: ['final'] }] })
    expect(rowCount()).toBe(mine)
    expect(bar().textContent).toContain('Mara Okonkwo changed Shoot week. Your changes are still on screen.')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save' }))
    const ask = await screen.findByRole('dialog', { name: 'Save over the newer Shoot week?' })
    expect(ask.textContent).toContain('Mara Okonkwo saved Shoot week after you began these changes.')
    await run(async () => { fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' })) })
    expect(fx.store.tableViews.find(v => v.id === id).config.filters[0].values).toEqual(['final'])
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save' }))
    await run(async () => { fireEvent.click(within(await screen.findByRole('dialog', { name: /Save over/ })).getByRole('button', { name: 'Save my changes' })) })
    expect(fx.store.tableViews.find(v => v.id === id).config.filters[0].values).toEqual(['in_progress'])
    expect(bar()).toBeNull()
  })
  it('Reset takes theirs', async () => {
    await mount()
    await newView('Shoot week')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    const id = fx.store.tableViews.find(v => v.name === 'Shoot week').id
    await filterStatus('In progress')
    await teammateSaves(id, { version: 1, filters: [{ field: 'status', op: 'is', values: ['final'] }] })
    fireEvent.click(within(bar()).getByRole('button', { name: 'Reset' }))
    expect(rowCount()).toBe(storedTasks().filter(t => t.status === 'final').length)
    expect(bar()).toBeNull()
  })
  it('deleted by a teammate with no change of one\'s own: the table goes to All and a toast says so', async () => {
    await mount()
    await newView('Shoot week')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    const id = fx.store.tableViews.find(v => v.name === 'Shoot week').id
    fx.store.tableViews = fx.store.tableViews.filter(v => v.id !== id)
    await run(() => ctx.reloadActiveProject())
    await waitFor(() => expect(viewsButton().textContent).toBe('All'))
    expect(await screen.findByText('Shoot week was deleted. Showing All.')).toBeTruthy()
  })
  it('deleted by a teammate with a change of one\'s own: the change stays and the bar says so; Reset is back to All', async () => {
    await mount()
    await newView('Shoot week')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    const id = fx.store.tableViews.find(v => v.name === 'Shoot week').id
    await filterStatus('In progress')
    fx.store.tableViews = fx.store.tableViews.filter(v => v.id !== id)
    await run(() => ctx.reloadActiveProject())
    expect(bar().textContent).toContain('Shoot week was deleted. Your changes are still on screen.')
    expect(within(bar()).queryByRole('button', { name: 'Save' })).toBeNull()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Reset' }))
    expect(viewsButton().textContent).toBe('All')
    expect(bar()).toBeNull()
  })
})

describe('the dropdown (§4.2, §4.9; defect 5)', () => {
  it('opens on the ticked view, is a non-modal dialog in place after its button, and its list is a grid', async () => {
    await mount()
    await newView('Shoot week')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(dropdown()).toBeNull()
    openViews()
    const d = dropdown()
    expect(d.getAttribute('aria-modal')).toBeNull()
    expect(d.previousElementSibling).toBe(viewsButton())
    expect(within(d).getByRole('grid')).toBeTruthy()
    expect(document.activeElement.textContent).toContain('Shoot week')
    // ↑ moves to All; only the active row is in the Tab order.
    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    expect(document.activeElement.textContent).toBe('All')
  })
  it('Escape: a card goes back to the list (the part\'s row has the keyboard), the list closes and the keyboard goes back to the button', async () => {
    await mount()
    openViews()
    fireEvent.click(within(dropdown()).getByRole('button', { name: /^Sort:/ }))
    expect(within(dropdown()).getByRole('button', { name: 'Back to views' })).toBe(document.activeElement)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(dropdown()).not.toBeNull()
    expect(document.activeElement.getAttribute('aria-label')).toMatch(/^Sort:/)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(dropdown()).toBeNull()
    expect(document.activeElement).toBe(viewsButton())
  })
  it('the … menu: Rename keeps on Enter; Duplicate makes "copy" at the end; Delete asks first, for everyone', async () => {
    await mount()
    await newView('Shoot week')
    const more = within(dropdown()).getByRole('button', { name: 'More for Shoot week' })
    fireEvent.click(more)
    fireEvent.click([...document.querySelectorAll('.ui-menu-item')].find(b => b.textContent === 'Rename'))
    const field = within(dropdown()).getByRole('textbox', { name: 'Rename Shoot week' })
    fireEvent.change(field, { target: { value: 'Shoot days' } })
    await run(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
    expect(fx.store.tableViews.map(v => v.name)).toEqual(['Shoot days'])
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'More for Shoot days' }))
    await run(async () => { fireEvent.click([...document.querySelectorAll('.ui-menu-item')].find(b => b.textContent === 'Duplicate')) })
    expect(fx.store.tableViews.map(v => v.name)).toEqual(['Shoot days', 'Shoot days copy'])
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'More for Shoot days copy' }))
    fireEvent.click([...document.querySelectorAll('.ui-menu-item')].find(b => b.textContent === 'Delete'))
    const ask = await screen.findByRole('dialog', { name: 'Delete Shoot days copy for everyone on this project?' })
    // Cancel has the keyboard (the safe answer first).
    expect(within(ask).getByRole('button', { name: 'Cancel' })).toBe(document.activeElement)
    await run(async () => { fireEvent.click(within(ask).getByRole('button', { name: 'Delete' })) })
    expect(fx.store.tableViews.map(v => v.name)).toEqual(['Shoot days'])
    // CONTROL: the dropdown stayed open behind the question.
    expect(dropdown()).not.toBeNull()
  })
  it('Move down and Alt+↓ on the handle reorder the views for everyone, and the move is announced', async () => {
    await mount()
    await newView('One')
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'New view' }))
    const f = within(dropdown()).getByRole('textbox', { name: 'View name' })
    fireEvent.change(f, { target: { value: 'Two' } })
    await run(async () => { fireEvent.keyDown(f, { key: 'Enter' }) })
    await run(async () => { fireEvent.click(within(dropdown()).getByRole('button', { name: 'Move One down' })) })
    expect(ctx.viewsOf('tasks').map(v => v.name)).toEqual(['Two', 'One'])
    expect(document.querySelector('.rb-task-view [aria-live="polite"]').textContent).toBe('One moved to 2 of 2')
    const handle = within(dropdown()).getByRole('button', { name: 'Move Two, 1 of 2' })
    await run(async () => { fireEvent.keyDown(handle, { key: 'ArrowDown', altKey: true }) })
    expect(ctx.viewsOf('tasks').map(v => v.name)).toEqual(['One', 'Two'])
  })
})

describe('the cards (§4.3)', () => {
  it('Sort: the toolbar sets the first sort, the card adds a second; the summary reads them in order', async () => {
    await mount()
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'phase_id' } })
    openViews()
    expect(within(dropdown()).getByRole('button', { name: /^Sort:/ }).getAttribute('aria-label')).toBe('Sort: Phase')
    fireEvent.click(within(dropdown()).getByRole('button', { name: /^Sort:/ }))
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'Add sort' }))
    const fields = within(dropdown()).getAllByRole('combobox', { name: 'Sort by' })
    fireEvent.change(fields[1], { target: { value: 'start_date' } })
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'Back to views' }))
    expect(within(dropdown()).getByRole('button', { name: /^Sort:/ }).getAttribute('aria-label')).toBe('Sort: Phase, then Start')
  })
  it('Fields: a hidden field leaves the table; Show key dates off takes the key dates\' rows away; the name is always shown', async () => {
    await mount()
    const keyDates = () => document.querySelectorAll('tr.rb-task-ms').length
    expect(keyDates()).toBeGreaterThan(0)
    openViews()
    fireEvent.click(within(dropdown()).getByRole('button', { name: /^Fields:/ }))
    const title = within(dropdown()).getByRole('switch', { name: 'Title: always shown' })
    expect(title.disabled).toBe(true)
    fireEvent.click(within(dropdown()).getByRole('switch', { name: 'Show Priority' }))
    expect([...document.querySelectorAll('.rb-task-table thead th')].map(th => th.textContent)).not.toContain('Priority')
    fireEvent.click(within(dropdown()).getByRole('switch', { name: 'Show key dates' }))
    expect(keyDates()).toBe(0)
    expect(bar().textContent).toContain('All: changed for now')
  })
  it('Group: Hide empty groups starts as today per field (Status shows its empty groups), and the switch hides them', async () => {
    await mount()
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'status' } })
    const groups = () => document.querySelectorAll('tr.rb-task-group-row').length
    expect(groups()).toBe(9)
    openViews()
    fireEvent.click(within(dropdown()).getByRole('button', { name: /^Group:/ }))
    const sw = within(dropdown()).getByRole('switch', { name: 'Hide empty groups' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    const present = new Set(storedTasks().map(t => t.status || 'waiting_to_start')).size
    expect(groups()).toBe(present)
  })
  it('the Board: its Fields card lists the card\'s own fields; a hidden one leaves the cards (Q-E)', async () => {
    await mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }))
    openViews()
    fireEvent.click(within(dropdown()).getByRole('button', { name: /^Fields:/ }))
    const names = [...dropdown().querySelectorAll('.rb-tv-field-name')].map(e => e.textContent)
    expect(names).toEqual(['Status', 'Priority', 'Asset', 'Assignee', 'Start', 'Bid'])
    expect(document.querySelectorAll('.rb-task-card-priority').length).toBeGreaterThan(0)
    fireEvent.click(within(dropdown()).getByRole('switch', { name: 'Show Priority' }))
    expect(document.querySelectorAll('.rb-task-card-priority').length).toBe(0)
    // CONTROL: the status stays on the cards.
    expect(document.querySelectorAll('.rb-task-card-meta').length).toBeGreaterThan(0)
  })
})

describe('the project\'s groupings (§4.11; Q-D2, Q-D3, Q-D5)', () => {
  it('Create grouping shows only while grouped by a linked kind; a new grouping shows at once, empty, whatever Hide empty groups says', async () => {
    await mount()
    expect(screen.queryByRole('button', { name: 'Create grouping' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'asset' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create grouping' }))
    const dialog = screen.getByRole('dialog', { name: 'Create grouping' })
    const ticks = within(dialog).getAllByRole('checkbox')
    fireEvent.click(ticks[0]); fireEvent.click(ticks[1])
    const names = [ticks[0], ticks[1]].map(t => t.querySelector('.rb-tv-values-name').textContent)
    await run(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Create' })) })
    expect(fx.store.itemGroupings).toHaveLength(1)
    const label = [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).join(', ')
    const head = [...document.querySelectorAll('tr.rb-task-group-row')].find(r => r.querySelector('.rb-task-group-label')?.textContent === label)
    expect(head, label).toBeTruthy()
    expect(head.querySelector('.rb-task-group-count').textContent).toBe('0')
  })
  it('a set stored already is said before any request; Remove grouping asks first and takes it away', async () => {
    await mount()
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'asset' } })
    const pick = async (create) => {
      fireEvent.click(screen.getByRole('button', { name: 'Create grouping' }))
      const dialog = screen.getByRole('dialog', { name: 'Create grouping' })
      const ticks = within(dialog).getAllByRole('checkbox')
      fireEvent.click(ticks[0]); fireEvent.click(ticks[1])
      if (create) await run(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Create' })) })
      return dialog
    }
    await pick(true)
    const again = await pick(false)
    expect(within(again).getByText('That grouping already exists.')).toBeTruthy()
    expect(within(again).getByRole('button', { name: 'Create' }).disabled).toBe(true)
    fireEvent.click(within(again).getByRole('button', { name: 'Cancel' }))
    const more = screen.getAllByRole('button', { name: /^More for / }).find(b => b.closest('tr.rb-task-group-row'))
    fireEvent.click(more)
    fireEvent.click([...document.querySelectorAll('.ui-menu-item')].find(b => b.textContent === 'Remove grouping'))
    const ask = await screen.findByRole('dialog', { name: /^Remove the grouping / })
    await run(async () => { fireEvent.click(within(ask).getByRole('button', { name: 'Remove grouping' })) })
    expect(fx.store.itemGroupings).toHaveLength(0)
  })
})

describe('a seat that cannot write (Q-F, Q3a)', () => {
  it('sees no New view, no moves, no … and no Create grouping; its bar offers Reset only, in words', async () => {
    await mount()
    await run(() => ctx.addTableView({ tableKey: 'tasks', name: 'Shoot week' }))
    cleanup(); _resetOverlaysForTests()
    seat.canWrite = false
    await mount(fx.rabbitAdapter())
    openViews()
    expect(within(dropdown()).queryByRole('button', { name: 'New view' })).toBeNull()
    expect(within(dropdown()).queryByRole('button', { name: /^More for / })).toBeNull()
    expect(within(dropdown()).queryByRole('button', { name: /^Move / })).toBeNull()
    // CONTROL: the parts are there (its changes are for the moment).
    expect(within(dropdown()).getByRole('button', { name: /^Filters:/ })).toBeTruthy()
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'Shoot week' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'asset' } })
    expect(screen.queryByRole('button', { name: 'Create grouping' })).toBeNull()
    expect(bar().textContent).toContain('Shoot week: changed for now. Only the project\'s editors can save views.')
    expect([...bar().querySelectorAll('button')].map(b => b.textContent)).toEqual(['Reset'])
  })
})

describe('a backend without views (Drive, a cloud before 0098)', () => {
  it('the dropdown says "Saved views are not on this server yet." in place of New view; a change says so in the bar', async () => {
    const a = fx.rabbitAdapter()
    a.tableViewsAvailable = () => false
    await mount(a)
    openViews()
    expect(within(dropdown()).getByText('Saved views are not on this server yet.')).toBeTruthy()
    expect(within(dropdown()).queryByRole('button', { name: 'New view' })).toBeNull()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    await filterStatus('Final')
    expect(bar().textContent).toBe('Changed for now. Saved views are not on this server yet.Reset')
  })
})

describe('the last used view (Q4, §4.5)', () => {
  it('the table opens on the view last used there; one deleted since opens on All, without a word', async () => {
    await mount()
    let v
    await run(async () => { v = await ctx.addTableView({ tableKey: 'tasks', name: 'Shoot week', config: { filters: [{ field: 'status', op: 'is', values: ['final'] }] } }) })
    await run(() => ctx.setTableViewLast('tasks', v.id))
    act(() => showTab(false))
    act(() => ctx.clearViewDraft('tasks'))
    act(() => showTab(true))
    await waitFor(() => expect(viewsButton().textContent).toBe('Shoot week'))
    expect(rowCount()).toBe(storedTasks().filter(t => t.status === 'final').length)
    act(() => showTab(false))
    act(() => ctx.clearViewDraft('tasks'))
    fx.store.tableViews = []
    await run(() => ctx.reloadActiveProject())
    act(() => showTab(true))
    await waitFor(() => expect(viewsButton().textContent).toBe('All'))
    expect(screen.queryByText(/was deleted/)).toBeNull()
  })
  it('until the map answers, the body shows the kit Loading line and the toolbar works', async () => {
    const a = fx.rabbitAdapter()
    a.getTableViewLast = () => new Promise(() => {})
    // The provider stops waiting for the map after TABLE_VIEW_LAST_WAIT_MS
    // (2 s). Mounting the real provider and the Tasks table took longer than
    // that on CI's runner (2026-10-26, VW1e: "Unable to find … Loading
    // views"), so the wait is held here: this test is about the loading
    // state, not about the clock. The give-up has its own test.
    // FX14: the hold is what keeps the clock out of it; `mount` now returns
    // only after the provider's own effects (see there), which is what
    // VW1e's hold could not reach: the page CI found had passed through
    // 'unavailable', not the give-up.
    const realSetTimeout = globalThis.setTimeout
    const held = []
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...rest) => {
      if (ms === TABLE_VIEW_LAST_WAIT_MS) { held.push(ms); return 0 }
      return realSetTimeout(fn, ms, ...rest)
    })
    await mount(a)
    expect(held.length).toBeGreaterThan(0)              // the give-up was armed, and held
    expect(ctx.tableViewLast.status).toBe('loading')
    expect(screen.getByRole('status', { name: 'Loading views' })).toBeTruthy()
    expect(document.querySelector('.rb-task-table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Filter/ }))
    expect(screen.getByRole('button', { name: 'Add filter' })).toBeTruthy()
    // …and it stays: the map never answers and nothing else ends the wait.
    await act(async () => { await new Promise((r) => realSetTimeout(r, 50)) })
    expect(screen.getByRole('status', { name: 'Loading views' })).toBeTruthy()
    expect(ctx.tableViewLast.status).toBe('loading')
  })

  // FX14: the gap the mount now waits out, held open on purpose. The commit
  // that brings the project draws the table while the status still reads
  // 'unavailable'; the provider's effects end it. A MutationObserver resolves
  // in that commit's microtasks, before those effects' task.
  it('CONTROL (FX14): in the gap between the project\'s commit and its effects, the body is past Loading views; the effects bring it back', async () => {
    const a = fx.rabbitAdapter()
    a.getTableViewLast = () => new Promise(() => {})
    const realSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...rest) => (ms === TABLE_VIEW_LAST_WAIT_MS ? 0 : realSetTimeout(fn, ms, ...rest)))
    holder.adapter = a
    const committed = new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        if (document.querySelector('.rb-tv-button') && ctx?.project?.id === PROJECT_ID) { mo.disconnect(); resolve() }
      })
      mo.observe(document.body, { subtree: true, childList: true })
    })
    render(<ToastProvider><RabbitProvider><Probe /><Tab /></RabbitProvider></ToastProvider>)
    await committed
    expect(ctx.tableViewLast.status).toBe('unavailable')
    expect(screen.queryByRole('status', { name: 'Loading views' })).toBeNull()
    expect(document.querySelector('.rb-task-table')).not.toBeNull()
    expect(viewsButton().textContent).toBe('All')
    await waitFor(() => expect(screen.getByRole('status', { name: 'Loading views' })).toBeTruthy())
    expect(ctx.tableViewLast.status).toBe('loading')
  })
})

// ── Code review round 1 (Fable; UX with an accessibility check): each
// correction asserted, each fails without it. ────────────────────────────
const live = () => document.querySelector('.rb-task-view [aria-live="polite"]').textContent
async function twoViews() {
  await newView('One')
  fireEvent.click(within(dropdown()).getByRole('button', { name: 'New view' }))
  const f = within(dropdown()).getByRole('textbox', { name: 'View name' })
  fireEvent.change(f, { target: { value: 'Two' } })
  await run(async () => { fireEvent.keyDown(f, { key: 'Enter' }) })
}
const openCard = (name) => { openViews(); fireEvent.click(within(dropdown()).getByRole('button', { name: new RegExp(`^${name}:`) })) }
const escape = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })

describe('code review round 1 (UX, accessibility)', () => {
  it('R1-1: the Fields grid has a Tab stop, on the first row with a control (not the name\'s); ↑ from it stays there', async () => {
    await mount()
    openCard('Fields')
    const grid = within(dropdown()).getByRole('grid', { name: 'Fields' })
    const stops = [...grid.querySelectorAll('[tabindex="0"]')].filter(el => !el.disabled)
    expect(stops.length).toBeGreaterThan(0)
    expect(stops[0].closest('[data-row]').getAttribute('data-row')).toBe('1')
    const sw = within(grid).getByRole('switch', { name: 'Show Status' })
    sw.focus()
    fireEvent.keyDown(sw, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(sw)
  })
  it('R1-16: the Fields grid\'s Home and End go to its ends (the name\'s row passed over)', async () => {
    await mount()
    openCard('Fields')
    const grid = within(dropdown()).getByRole('grid', { name: 'Fields' })
    within(grid).getByRole('switch', { name: 'Show Status' }).focus()
    fireEvent.keyDown(document.activeElement, { key: 'End' })
    expect(document.activeElement).toBe(within(grid).getByRole('switch', { name: 'Show Bid' }))
    fireEvent.keyDown(document.activeElement, { key: 'Home' })
    expect(document.activeElement).toBe(within(grid).getByRole('switch', { name: 'Show Status' }))
  })
  it('R1-2: Escape on Rename gives the keyboard back to the row; on New view, to New view; on the bar\'s name, to Save as new view', async () => {
    await mount()
    await newView('Shoot week')
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'More for Shoot week' }))
    fireEvent.click([...document.querySelectorAll('.ui-menu-item')].find(b => b.textContent === 'Rename'))
    await run(async () => { escape() })
    expect(document.activeElement.textContent).toBe('Shoot week')
    expect(dropdown()).not.toBeNull()
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'New view' }))
    await run(async () => { escape() })
    expect(document.activeElement).toBe(within(dropdown()).getByRole('button', { name: 'New view' }))
    escape()
    await filterStatus('Final')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save as new view' }))
    await run(async () => { fireEvent.keyDown(within(bar()).getByRole('textbox', { name: 'View name' }), { key: 'Escape' }) })
    expect(document.activeElement).toBe(within(bar()).getByRole('button', { name: 'Save as new view' }))
  })
  it('R1-3: a move keeps the keyboard on the moved view (its handle, when the button it pressed is now greyed), and the Tab stop with it', async () => {
    await mount()
    await twoViews()
    await run(async () => { fireEvent.click(within(dropdown()).getByRole('button', { name: 'Move One down' })) })
    expect(ctx.viewsOf('tasks').map(v => v.name)).toEqual(['Two', 'One'])
    expect(document.activeElement.getAttribute('aria-label') || document.activeElement.getAttribute('title')).toBe('Move One, 2 of 2')
    expect(document.activeElement.getAttribute('tabindex')).toBe('0')
  })
  it('R1-3: the Sort card\'s rows keep the keyboard on the moved sort (Alt+↓ on its handle)', async () => {
    await mount()
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'phase_id' } })
    openCard('Sort')
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'Add sort' }))
    const handle = within(dropdown()).getByRole('button', { name: 'Move Phase, 1 of 2' })
    handle.focus()
    await run(async () => { fireEvent.keyDown(handle, { key: 'ArrowDown', altKey: true }) })
    expect(document.activeElement.getAttribute('title')).toBe('Move Phase, 2 of 2')
  })
  it('R1-3: the Fields card keeps the keyboard on the moved field\'s control, and its row has the Tab stop', async () => {
    await mount()
    openCard('Fields')
    await run(async () => { fireEvent.click(within(dropdown()).getByRole('button', { name: 'Move Status down' })) })
    const after = within(dropdown()).getByRole('button', { name: 'Move Status down' })
    expect(document.activeElement).toBe(after)
    expect(after.getAttribute('tabindex')).toBe('0')
    expect([...document.querySelectorAll('.rb-task-table thead th')].map(th => th.textContent).slice(1, 4)).toEqual(['Title', 'Priority', 'Status'])
  })
  it('R1-4: the Fields card\'s handle drags a field to another\'s place, and the Sort card\'s a sort', async () => {
    await mount()
    openCard('Fields')
    const rowOf = (name) => within(dropdown()).getByRole('button', { name: new RegExp(`^Move ${name},`) }).closest('[role="row"]')
    fireEvent.pointerDown(within(dropdown()).getByRole('button', { name: /^Move Priority,/ }))
    // The drag carries its row's id, as the browser's does (review round 2, R2-5).
    const carriedData = {}
    const dt = { setData: (k, v) => { carriedData[k] = v }, getData: (k) => carriedData[k], effectAllowed: '' }
    fireEvent.dragStart(rowOf('Priority'), { dataTransfer: dt })
    fireEvent.dragOver(rowOf('Status'), { dataTransfer: dt })
    fireEvent.drop(rowOf('Status'), { dataTransfer: dt })
    expect([...document.querySelectorAll('.rb-task-table thead th')].map(th => th.textContent).slice(1, 4)).toEqual(['Title', 'Priority', 'Status'])
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'Back to views' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'phase_id' } })
    fireEvent.click(within(dropdown()).getByRole('button', { name: /^Sort:/ }))
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'Add sort' }))
    const sortRow = (name) => within(dropdown()).getByRole('button', { name: new RegExp(`^Move ${name},`) }).closest('.rb-tv-sort-row')
    const second = within(dropdown()).getAllByRole('combobox', { name: 'Sort by' })[1].value
    const label = (k) => ({ title: 'Title', status: 'Status' }[k] || k)
    fireEvent.pointerDown(within(dropdown()).getByRole('button', { name: new RegExp(`^Move ${label(second)},`) }))
    fireEvent.dragStart(sortRow(label(second)), { dataTransfer: dt })
    fireEvent.dragOver(sortRow('Phase'), { dataTransfer: dt })
    fireEvent.drop(sortRow('Phase'), { dataTransfer: dt })
    expect(within(dropdown()).getAllByRole('combobox', { name: 'Sort by' }).map(s => s.value)).toEqual([second, 'phase_id'])
  })
  it('R1-5: Edit on the view already on screen keeps the change for now; CONTROL: choosing another view drops it', async () => {
    await mount()
    await newView('Shoot week')
    escape()
    await filterStatus('Final')
    openViews()
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'More for Shoot week' }))
    fireEvent.click([...document.querySelectorAll('.ui-menu-item')].find(b => b.textContent === 'Edit'))
    expect(bar()?.textContent).toContain('Shoot week: changed for now')
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'All' }))
    expect(bar()).toBeNull()
  })
  it('R1-6: after Remove grouping the keyboard is on the Group menu', async () => {
    await mount()
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'asset' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create grouping' }))
    const dialog = screen.getByRole('dialog', { name: 'Create grouping' })
    const ticks = within(dialog).getAllByRole('checkbox')
    fireEvent.click(ticks[0]); fireEvent.click(ticks[1])
    await run(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Create' })) })
    const more = screen.getAllByRole('button', { name: /^More for / }).find(b => b.closest('tr.rb-task-group-row'))
    fireEvent.click(more)
    fireEvent.click([...document.querySelectorAll('.ui-menu-item')].find(b => b.textContent === 'Remove grouping'))
    await run(async () => { fireEvent.click(within(await screen.findByRole('dialog', { name: /^Remove the grouping / })).getByRole('button', { name: 'Remove grouping' })) })
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Group' }))
  })
  it('R1-8: a save is said once, by its undo toast — not again in the table\'s region', async () => {
    await mount()
    await newView('Shoot week')
    escape()
    await filterStatus('Final')
    await run(async () => { fireEvent.click(within(bar()).getByRole('button', { name: 'Save' })) })
    expect(ctx.undoToast?.message).toBe('Shoot week saved')
    expect(live()).not.toContain('saved')
  })
  it('R1-9 and R1-10: Create grouping opens on its search; only the name is live, and the "exists" line\'s region is there before its words', async () => {
    await mount()
    fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value: 'asset' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create grouping' }))
    const dialog = screen.getByRole('dialog', { name: 'Create grouping' })
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Search assets' }))
    expect(dialog.querySelector('.rb-tv-group-name').hasAttribute('aria-live')).toBe(false)
    expect(dialog.querySelector('.rb-tv-group-name-text').getAttribute('aria-live')).toBe('polite')
    const status = within(dialog).getByRole('status')
    expect(status.textContent).toBe('')
  })
  it('R1-12: ↓ onto a row whose same control is greyed lands on its name, never on nothing', async () => {
    await mount()
    await twoViews()
    const down = within(dropdown()).getByRole('button', { name: 'Move One down' })
    down.focus()
    fireEvent.keyDown(down, { key: 'ArrowDown' })
    expect(document.activeElement.textContent).toBe('Two')
  })
  it('R1-13: Delete → Cancel gives the keyboard back to the … it came from', async () => {
    await mount()
    await newView('Shoot week')
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'More for Shoot week' }))
    fireEvent.click([...document.querySelectorAll('.ui-menu-item')].find(b => b.textContent === 'Delete'))
    const ask = await screen.findByRole('dialog', { name: /^Delete Shoot week/ })
    await run(async () => { fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' })) })
    expect(document.activeElement).toBe(within(dropdown()).getByRole('button', { name: 'More for Shoot week' }))
  })
  it('R1-16: the in-place card sits in a block wrapper, not a span', async () => {
    await mount()
    openViews()
    expect(dropdown().parentElement.tagName).toBe('DIV')
  })
})

// ── Code review round 2 (Fable; security on the view's filters, and an
// attack on round 1's corrections): each correction asserted, each fails
// without it. ────────────────────────────────────────────────────────────
async function storedView(name, config) {
  let v
  await run(async () => { v = await ctx.addTableView({ tableKey: 'tasks', name }) })
  const row = fx.store.tableViews.find(x => x.id === v.id)
  row.config = config
  await run(() => ctx.reloadActiveProject())
  return v
}
async function chooseView(name) {
  openViews()
  fireEvent.click(within(dropdown()).getByRole('button', { name }))
}

describe('code review round 2 (security on the view\'s filters; round 1\'s corrections)', () => {
  it('R2-1: a failed save then a teammate\'s save: the bar names the teammate and Save asks first (the old failure is stale)', async () => {
    const a = fx.rabbitAdapter()
    const real = a.updateTableView.bind(a)
    let fail = true
    a.updateTableView = async (...args) => { if (fail) { fail = false; throw new Error('offline') } return real(...args) }
    await mount(a)
    await newView('Shoot week')
    escape()
    const id = fx.store.tableViews.find(v => v.name === 'Shoot week').id
    await filterStatus('In progress')
    await run(async () => { fireEvent.click(within(bar()).getByRole('button', { name: 'Save' })) })
    expect(bar().textContent).toContain('Shoot week could not be saved: offline.')
    await teammateSaves(id, { version: 1, filters: [{ field: 'status', op: 'is', values: ['final'] }] })
    expect(bar().textContent).toContain('Mara Okonkwo changed Shoot week.')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('dialog', { name: 'Save over the newer Shoot week?' })).toBeTruthy()
  })
  it('R2-2: a view filled by another WILSON\'s settings says so on Save, and Save as new view still holds the change', async () => {
    await mount()
    await storedView('Full', { version: 1, junk: 'x'.repeat(32600) })
    await chooseView('Full')
    await filterStatus('Final')
    await run(async () => { fireEvent.click(within(bar()).getByRole('button', { name: 'Save' })) })
    expect(bar().textContent).toContain('Full could not be saved: settings from another WILSON fill this view; save your change as a new view.')
    // CONTROL: the plain cap's words are not what it says.
    expect(bar().textContent).not.toContain('at most 32 KB')
  })
  it('R2-3: a stored row with an unknown condition, or on a field this table cannot filter, is not counted and reads as what it is', async () => {
    await mount()
    await storedView('Odd', { version: 1, filters: [{ field: 'status', op: 'bogus', values: ['final'] }, { field: 'created_at', op: 'is', values: ['x'] }] })
    await chooseView('Odd')
    expect(screen.getByRole('button', { name: /^Filter/ }).textContent).toBe('Filter')
    expect(rowCount()).toBe(storedTasks().length)
    fireEvent.click(screen.getByRole('button', { name: /^Filter/ }))
    const rows = document.querySelectorAll('.rb-task-filters .rb-tv-filter-row')
    const chosen = (sel) => sel.options[sel.selectedIndex].textContent
    expect(chosen(within(rows[0]).getByRole('combobox', { name: 'Condition' }))).toBe('bogus (unknown)')
    expect(chosen(within(rows[1]).getByRole('combobox', { name: 'Field' }))).toBe('Created (cannot filter)')
  })
  it('R2-4: a sort on a field the table lacks shows in the card as what it is, and the toolbar shows no sort for it', async () => {
    await mount()
    await storedView('By level', { version: 1, sorts: [{ field: 'level', dir: 'desc' }] })
    await chooseView('By level')
    const sort = screen.getByRole('combobox', { name: 'Sort' })
    expect(sort.value).toBe('')
    expect(sort.getAttribute('data-active')).toBe('false')
    expect(screen.queryByTitle(/^Sorted /)).toBeNull()
    openCard('Sort')
    const sel = within(dropdown()).getByRole('combobox', { name: 'Sort by' })
    expect(sel.options[sel.selectedIndex].textContent).toBe('level (not in this table)')
  })
  it('R2-5: a press released without a drag disarms the row; a drop that carries no row of the list moves nothing', async () => {
    await mount()
    openCard('Fields')
    const heads = () => [...document.querySelectorAll('.rb-task-table thead th')].map(th => th.textContent).slice(1, 4)
    const rowOf = (name) => within(dropdown()).getByRole('button', { name: new RegExp(`^Move ${name},`) }).closest('[role="row"]')
    const foreign = { setData: () => {}, getData: () => 'some text', effectAllowed: '' }
    fireEvent.pointerDown(within(dropdown()).getByRole('button', { name: /^Move Priority,/ }))
    fireEvent.drop(rowOf('Status'), { dataTransfer: foreign })
    expect(heads()).toEqual(['Title', 'Status', 'Priority'])
    fireEvent.pointerDown(within(dropdown()).getByRole('button', { name: /^Move Priority,/ }))
    fireEvent.pointerUp(document.body)
    expect(rowOf('Priority').getAttribute('draggable')).toBe('false')
  })
  it('R2-6: a newer WILSON\'s view cannot be duplicated (its copy would lose that build\'s settings); CONTROL: this build\'s can', async () => {
    await mount()
    await storedView('Newer', { version: 2, layout: 'table' })
    openViews()
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'More for Newer' }))
    const dup = [...document.querySelectorAll('.ui-menu-item')].find(b => b.textContent.startsWith('Duplicate'))
    expect(dup.disabled).toBe(true)
    expect(dup.textContent).toContain('Newer WILSON')
  })
  it('R2-7: prototype-shaped keys are no grouping and no person', async () => {
    const { groupToTab, groupFromTab } = await import('./tasksTableView')
    expect(groupToTab('constructor')).toBe('constructor')
    expect(groupToTab('__proto__')).toBe('__proto__')
    expect(groupFromTab('toString')).toBe('toString')
    await mount()
    await newView('Shoot week')
    escape()
    const id = fx.store.tableViews.find(v => v.name === 'Shoot week').id
    await filterStatus('In progress')
    await teammateSaves(id, { version: 1, filters: [{ field: 'status', op: 'is', values: ['final'] }] })
    fx.store.tableViews.find(v => v.id === id).revised_by = 'constructor'
    fx.store.tableViewRevision += 1
    fx.store.tableViews.find(v => v.id === id).revision = fx.store.tableViewRevision
    await run(() => ctx.reloadActiveProject())
    expect(bar().textContent).toContain('Someone changed Shoot week.')
  })
  it('R2-9: the bar gone while its name is typed (a teammate saved the same change): the keyboard goes to the Views button', async () => {
    await mount()
    await newView('Shoot week')
    escape()
    const id = fx.store.tableViews.find(v => v.name === 'Shoot week').id
    await filterStatus('Final')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save as new view' }))
    expect(document.activeElement).toBe(within(bar()).getByRole('textbox', { name: 'View name' }))
    await teammateSaves(id, { version: 1, filters: [{ field: 'status', op: 'is', values: ['final'] }] })
    expect(bar()).toBeNull()
    expect(document.activeElement).toBe(viewsButton())
  })
  it('R2-12: the dropdown\'s fallback focus is its own button, not the first in the document', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src/tools/rabbit_v0.1.0/views/tableViews/TableViewsMenu.jsx'), 'utf8')
    expect(src).not.toContain("document.querySelector('.rb-tv-button')")
    expect(src).toContain('focusButton={() => buttonRef.current?.focus()}')
  })
})
