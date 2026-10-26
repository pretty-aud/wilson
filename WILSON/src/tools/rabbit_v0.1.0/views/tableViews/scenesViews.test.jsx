/** @vitest-environment jsdom */
// =============================================================================
// scenesViews.test.jsx — VW1e step 2 (2026-10-25): the custom views on the
// Scenes and Shots tables, mounted inside the REAL provider over the dev
// fixtures (the cloud's twin in memory; assetsViews.test.jsx's harness), as a
// person uses them. docs/design/CUSTOM_VIEWS_DESIGN.md §4.1, §4.3, §4.8 and
// §6 (the Scenes step), as VW1e's step 0 review corrected them (§11 round 6);
// her answers by number: Q5 (the bookmark becomes the Views button), Q16 (two
// lists, one per table), Q17 (the old saved views are not carried over),
// Q-J (the columns in front of the name), defect 3 (each table keeps its own
// filters, sorts and grouping). Each rule has a CONTROL its absence fails.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act, waitFor, fireEvent, within } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../../ui/overlay'
import { ToastProvider } from '../../../../ui/Toast'

const holder = vi.hoisted(() => ({ adapter: null, projectId: null }))
const seat = vi.hoisted(() => ({ canWrite: true }))
// The real provider and the whole Scenes page: the Tasks harness's 20 s.
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
vi.mock('../../../../permissions/projectRoleMatrix', async (importOriginal) => ({
  ...(await importOriginal()),
  canOnProject: () => seat.canWrite,
  projectActionDeniedReason: () => (seat.canWrite ? null : 'Only the project\'s editors can change this.'),
}))
vi.mock('../../../../components/TeamMembers/useRosterMembers', () => ({
  useRosterMembers: () => ({ members: [{ id: 'teammate-mara', name: 'Mara Okonkwo' }], mode: 'supabase' }),
}))
vi.mock('../../components/EditHistoryDrawer', () => ({ default: () => null }))

const { buildDevFixtures } = await import('../../../../dev/fixtures/install')
const { PROJECT_ID } = await import('../../../../dev/fixtures/data/project')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('../../state/RabbitProvider')
const { default: ScenesView } = await import('../ScenesView')

let ctx = null
function Probe() { ctx = useRabbit(); return null }
let fx = null

const run = (fn) => act(async () => { await fn() })
const sceneRows = () => [...document.querySelectorAll('table.rb-scene-table-scenes > tbody > tr .rb-scene-check')]
// FX15 (OUTSTANDING FX14-01; tasksViews.test.jsx's mount, FX14): the fixtures
// load the project in microtasks, so ONE commit brings the adapter and the
// whole project, while the provider's effects for them (the last used views
// read, which ends the status 'unavailable'; the views' drafts reset; the
// project's visit count) run in a later task. In that gap the Scenes table is drawn with its
// Views button and rows while the status still reads 'unavailable',
// so the waits below could all pass there, and a change for now made then is
// wiped by the pending drafts reset: with this mount forced into the gap, 5 of this
// file's 13 tests failed, every run, each at a grouping, a sort or a nest
// (FX15's hand-off, §2). So the render runs inside act (React flushes those
// effects before act returns), and the mount waits for their evidence where
// the adapter reads a map: a status past 'unavailable', which it holds from
// the provider's first effect (no adapter yet) until then.
async function mount(adapter = fx.rabbitAdapter()) {
  holder.adapter = adapter
  await act(async () => { render(<ToastProvider><RabbitProvider><Probe /><ScenesView pageActive /></RabbitProvider></ToastProvider>) })
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
  await waitFor(() => expect(screen.getByRole('button', { name: /^Views: / })).toBeTruthy())
  await waitFor(() => expect(sceneRows().length).toBeGreaterThan(0))
  if (typeof adapter.getTableViewLast === 'function') await waitFor(() => expect(ctx.tableViewLast.status).not.toBe('unavailable'))
}
const viewsButton = () => screen.getByRole('button', { name: /^Views: / })
const openViews = () => fireEvent.click(viewsButton())
const dropdown = () => screen.queryByRole('dialog', { name: /^Views/ })
const bar = () => document.querySelector('.rb-tv-bar')
const count = () => document.querySelector('.rb-scene-count').textContent
const toShots = () => fireEvent.click(screen.getByRole('tab', { name: 'Shots' }))
const toScenes = () => fireEvent.click(screen.getByRole('tab', { name: 'Scenes' }))
const groupBy = (value) => fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value } })
const sortBy = (value) => fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value } })
const escape = () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
const liveScenes = () => fx.store.scenes.filter(s => s.project_id === PROJECT_ID && !s.deleted_at)
const liveShots = () => fx.store.shots.filter(s => s.project_id === PROJECT_ID && !s.deleted_at)
const firstSceneName = () => sceneRows()[0].getAttribute('aria-label').replace(/^Select /, '')
const menuItems = () => [...document.querySelectorAll('.ui-menu .ui-menu-item')].map(b => b.textContent)
function openCard(name) {
  openViews()
  fireEvent.click(within(dropdown()).getByRole('button', { name: new RegExp(`^${name}:`) }))
}
async function saveAsNew(name) {
  fireEvent.click(within(bar()).getByRole('button', { name: 'Save as new view' }))
  const field = within(bar()).getByRole('textbox', { name: 'View name' })
  fireEvent.change(field, { target: { value: name } })
  await run(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
}

beforeEach(() => { fx = buildDevFixtures(); seat.canWrite = true })
afterEach(() => { cleanup(); _resetOverlaysForTests(); ctx = null; fx = null; localStorage.clear(); vi.restoreAllMocks() })

describe('two lists, one per table (Q5, Q16, Q17)', () => {
  it('the Views button is the list of the table on screen; a view saved on Scenes is on the Scenes list only', async () => {
    await mount()
    expect([viewsButton().textContent, viewsButton().getAttribute('data-table')]).toEqual(['All', 'scenes'])
    groupBy('status')
    expect(bar().textContent).toContain('All: changed for now')
    await saveAsNew('By status')
    const stored = fx.store.tableViews.find(v => v.name === 'By status')
    expect(stored).toMatchObject({ table_key: 'scenes', project_id: PROJECT_ID })
    expect(stored.config.group).toMatchObject({ field: 'status' })
    expect(viewsButton().textContent).toBe('By status')
    // The Shots table: its own list, its own view on screen, no change of its own.
    toShots()
    expect([viewsButton().textContent, viewsButton().getAttribute('data-table')]).toEqual(['All', 'shots'])
    expect(bar()).toBeNull()
    openViews()
    expect(within(dropdown()).getByRole('grid').textContent).not.toContain('By status')
    escape()
    // CONTROL: back on Scenes, its view is still the one on screen.
    toScenes()
    expect(viewsButton().textContent).toBe('By status')
  })
  it('Q17: the browser\'s old Scenes views are removed on the first load; CONTROL: the Assets table\'s key stays until its table loads', async () => {
    localStorage.setItem('rabbit_scene_saved_views', '[{"id":"1","name":"Old"}]')
    localStorage.setItem('rabbit_asset_saved_views', '[]')
    await mount()
    expect(localStorage.getItem('rabbit_scene_saved_views')).toBeNull()
    expect(localStorage.getItem('rabbit_asset_saved_views')).toBe('[]')
    openViews()
    expect(within(dropdown()).getByRole('grid').textContent).not.toContain('Old')
  })
})

describe('each table keeps its own (defect 3)', () => {
  it('a filter on Shots leaves the Scenes table whole; the change for now is the Shots view\'s alone', async () => {
    await mount()
    const scenesAll = `${liveScenes().length}/${liveScenes().length}`
    expect(count()).toBe(scenesAll)
    toShots()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    const row = document.querySelector('.rb-scene-filters .rb-tv-filter-row')
    fireEvent.change(within(row).getByRole('combobox', { name: 'Field' }), { target: { value: 'name' } })
    fireEvent.change(within(row).getByRole('textbox', { name: 'Value' }), { target: { value: 'no such shot anywhere' } })
    expect(count()).toBe(`0/${liveShots().length}`)
    expect(ctx.viewDraftOf('shots').config.filters).toEqual([{ field: 'name', op: 'contains', values: ['no such shot anywhere'] }])
    // CONTROL: the Scenes table shows every scene; its view has no change.
    toScenes()
    expect(count()).toBe(scenesAll)
    expect(ctx.viewDraftOf('scenes')).toBeFalsy()
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy()
  })
})

describe('List order and the view\'s sort (S3b; step 0 finding 2)', () => {
  it('with a list on screen the empty sort reads List order; a sort takes Move up and Move down out of the row\'s shot-list menu; CONTROL: Reset brings them back', async () => {
    await mount()
    const sort = screen.getByRole('combobox', { name: 'Sort' })
    expect([sort.value, sort.options[0].textContent]).toEqual(['', 'List order'])
    const name = firstSceneName()
    fireEvent.click(screen.getByRole('button', { name: `Shot list actions for ${name}` }))
    expect(menuItems()).toEqual(expect.arrayContaining(['Move up', 'Move down', 'Remove from this list']))
    escape()
    // The Sort card says what the empty sort is on this page.
    openCard('Sort')
    expect(dropdown().textContent).toContain('List order.')
    escape()
    escape()
    sortBy('name')
    expect(bar()).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `Shot list actions for ${firstSceneName()}` }))
    expect(menuItems()).toContain('Remove from this list')
    expect(menuItems()).not.toContain('Move up')
    escape()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Reset' }))
    expect(bar()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `Shot list actions for ${name}` }))
    expect(menuItems()).toContain('Move up')
  })
})

describe('the columns in front of the name (Q-J; step 0 findings 1 and 7)', () => {
  it('hiding the Number on Scenes is a change kept in leading; the list drag\'s grip moves into the name cell', async () => {
    await mount()
    const body = 'table.rb-scene-table-scenes > tbody'
    expect(document.querySelector(`${body} td.rb-scene-num-cell[data-grip="true"]`)).not.toBeNull()
    expect(document.querySelector(`${body} td.rb-scene-name-cell[data-grip="true"]`)).toBeNull()
    openCard('Fields')
    const grid = within(dropdown()).getByRole('grid', { name: 'Fields' })
    fireEvent.click(within(grid).getByRole('switch', { name: 'Show Number' }))
    // The leading list in its one order (the arrow, the picture, the number).
    expect(ctx.viewDraftOf('scenes').config.leading).toEqual([
      { key: 'expand', visible: true }, { key: 'thumbnail', visible: true }, { key: 'scene_number', visible: false },
    ])
    expect(bar()).not.toBeNull()
    expect(document.querySelector(`${body} td.rb-scene-num-cell`)).toBeNull()
    // CONTROL: the grip is still there to drag, before the name's words.
    expect(document.querySelector(`${body} td.rb-scene-name-cell[data-grip="true"]`)).not.toBeNull()
  })
  it('on the Shots gallery the card\'s number is one of the card\'s lines (her Q-P2: one field list): the Card fields list it at its place on the card, and hiding it takes it off every card', async () => {
    await mount()
    toShots()
    fireEvent.click(screen.getByRole('tab', { name: 'Gallery' }))
    const nums = () => document.querySelectorAll('.rb-scene-gallery .rb-scene-card-num').length
    expect(nums()).toBeGreaterThan(0)
    openCard('Fields')
    const grid = within(dropdown()).getByRole('grid', { name: 'Card fields' })
    // The card's own order (code review round 1, R1-7): the number after the description.
    const names = within(grid).getAllByRole('row').map(r => r.querySelector('.rb-tv-field-name').textContent)
    expect(names.slice(0, 3)).toEqual(['Description', 'Number', 'Status'])
    const numberRow = within(grid).getAllByRole('row')[1]
    // A leading column keeps its place: no handle to move it.
    expect(numberRow.querySelector('.rb-tv-handle')).toBeNull()
    fireEvent.click(within(numberRow).getByRole('switch', { name: 'Show Number' }))
    expect(nums()).toBe(0)
    expect(ctx.viewDraftOf('shots').config.leading).toEqual(expect.arrayContaining([{ key: 'shot_number', visible: false }]))
    // CONTROL: the Scenes table's leading list is its own, untouched.
    expect(ctx.viewDraftOf('scenes')).toBeFalsy()
    // Show all and Hide all reach the card's number too (R1-7).
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'Show all' }))
    expect(nums()).toBeGreaterThan(0)
    fireEvent.click(within(dropdown()).getByRole('button', { name: 'Hide all' }))
    expect(nums()).toBe(0)
  })
})

describe('code review round 1', () => {
  const labels = () => [...document.querySelectorAll('.rb-scene-group-label')].map(n => n.textContent.trim())
  it('R1-1: a name being typed for the Scenes view stays with Scenes: the Shots bar opens without it', async () => {
    await mount()
    toShots()
    groupBy('status')
    expect(bar()).not.toBeNull()
    toScenes()
    groupBy('status')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save as new view' }))
    fireEvent.change(within(bar()).getByRole('textbox', { name: 'View name' }), { target: { value: 'Scenes by status' } })
    toShots()
    expect(bar()).not.toBeNull()
    expect(within(bar()).queryByRole('textbox', { name: 'View name' })).toBeNull()
    expect(within(bar()).getByRole('button', { name: 'Save as new view' })).toBeTruthy()
    expect(fx.store.tableViews.filter(v => v.name === 'Scenes by status')).toHaveLength(0)
  })
  it('R1-3: the Scenes table\'s nested-only columns keep the nest\'s order: a switch, no handle, no Move buttons; CONTROL: a column that moves has them, the last one stopping short of them', async () => {
    await mount()
    openCard('Fields')
    const grid = within(dropdown()).getByRole('grid', { name: 'Fields' })
    const rowOf = (label) => within(grid).getAllByRole('row').find(r => r.querySelector('.rb-tv-field-name')?.textContent === label)
    for (const label of ['Framing (shots)', 'Camera movement (shots)']) {
      const r = rowOf(label)
      expect(r, label).toBeTruthy()
      expect(r.querySelector('.rb-tv-handle'), label).toBeNull()
      expect(within(r).queryByRole('button', { name: /^Move / }), label).toBeNull()
      expect(within(r).getByRole('switch', { name: 'Show ' + label })).toBeTruthy()
    }
    const frames = rowOf('Frames')
    expect(frames.querySelector('.rb-tv-handle')).not.toBeNull()
    expect(within(frames).getByRole('button', { name: 'Move Frames down' }).disabled).toBe(true)
    expect(within(frames).getByRole('button', { name: 'Move Frames up' }).disabled).toBe(false)
  })
  it('R1-4: a scene and a shot with no status are grouped under Not started, as their dot reads them; no None or Unset group', async () => {
    fx.store.scenes.find(s => s.project_id === PROJECT_ID && !s.deleted_at).status = null
    fx.store.shots.find(s => s.project_id === PROJECT_ID && !s.deleted_at).status = null
    await mount()
    groupBy('status')
    expect(labels().some(l => l.startsWith('Not started'))).toBe(true)
    expect(labels().some(l => l.startsWith('None'))).toBe(false)
    toShots()
    groupBy('status')
    expect(labels().some(l => l.startsWith('Not started'))).toBe(true)
    expect(labels().some(l => l.startsWith('Unset'))).toBe(false)
  })
  it('R1-5: the Shots table sorts by Duration (its frames) and by Takes (how many), as numbers', async () => {
    await mount()
    toShots()
    groupBy('')
    const sort = screen.getByRole('combobox', { name: 'Sort' })
    const values = [...sort.options].map(o => o.value)
    expect(values).toContain('duration')
    const names = () => [...document.querySelectorAll('table.rb-scene-table-shots > tbody > tr .rb-scene-check')].map(b => b.getAttribute('aria-label').replace(/^Select /, ''))
    const shotNamed = (n) => ctx.shots.find(s => (s.name || '') === n)
    sortBy('duration')
    const frames = names().map(n => Number(shotNamed(n)?.frame_count) || 0)
    expect(new Set(frames).size).toBeGreaterThan(1)
    expect(frames).toEqual([...frames].sort((a, b) => a - b))
    // Takes, unconditionally where the backend keeps takes (code review
    // round 2, R2-1: the fixtures do), with its own control.
    expect(ctx.supportsBins).toBe(true)
    expect(values).toContain('takes')
    sortBy('takes')
    const takes = names().map(n => (ctx.shotTakes || []).filter(t => t.shot_id === shotNamed(n)?.id).length)
    expect(new Set(takes).size).toBeGreaterThan(1)
    expect(takes).toEqual([...takes].sort((a, b) => a - b))
  })
  it('R1-8: hiding the Shots arrow takes the nested ticks with the nests; showing it again brings no tick back', async () => {
    await mount()
    const name = firstSceneName()
    const scene = ctx.scenes.find(s => s.name === name)
    const shot = ctx.shots.find(s => s.scene_id === scene.id)
    const row = sceneRows()[0].closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: 'Show shots' }))
    const tick = () => document.querySelector('table.rb-scene-table-scenes .rb-scene-nest-table [aria-label="Select ' + (shot.name || 'Untitled') + '"]')
    fireEvent.click(tick())
    expect(tick().getAttribute('aria-pressed')).toBe('true')
    openCard('Fields')
    fireEvent.click(screen.getByRole('switch', { name: 'Show Shots arrow' }))
    expect(tick()).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Show Shots arrow' }))
    expect(tick().getAttribute('aria-pressed')).toBe('false')
  })
})

describe('code review round 2', () => {
  it('R2-3: a save that lands after the content tab changed gives the keyboard to no other table\'s Views button; CONTROL: on its own table, to its Views button', async () => {
    await mount()
    groupBy('status')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save as new view' }))
    const field = within(bar()).getByRole('textbox', { name: 'View name' })
    fireEvent.change(field, { target: { value: 'Scenes by status' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    toShots()
    await run(async () => {})
    await waitFor(() => expect(fx.store.tableViews.find(v => v.name === 'Scenes by status')).toBeTruthy())
    await run(async () => {})
    expect(fx.store.tableViews.find(v => v.name === 'Scenes by status').table_key).toBe('scenes')
    expect(viewsButton().getAttribute('data-table')).toBe('shots')
    expect(document.activeElement).not.toBe(viewsButton())
    // CONTROL: the same on Scenes, staying there.
    toScenes()
    groupBy('type')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save as new view' }))
    const again = within(bar()).getByRole('textbox', { name: 'View name' })
    fireEvent.change(again, { target: { value: 'Scenes by type' } })
    await run(async () => { fireEvent.keyDown(again, { key: 'Enter' }) })
    await waitFor(() => expect(document.activeElement).toBe(viewsButton()))
    expect(viewsButton().getAttribute('data-table')).toBe('scenes')
  })
  it('R2-6: the Shots table\'s status groups come in the status list\'s order, Not started first, as on Scenes', async () => {
    await mount()
    toShots()
    groupBy('status')
    openCard('Group')
    fireEvent.click(screen.getByRole('switch', { name: 'Hide empty groups' }))
    escape()
    escape()
    const labels = [...document.querySelectorAll('.rb-scene-group-label')].map(n => n.textContent.trim())
    const order = ['Not started', 'In progress', 'Pending review', 'Needs revisions', 'Approved', 'Final', 'Blocked', 'On hold', 'Omitted']
    expect(labels.map(l => order.find(o => l.startsWith(o)))).toEqual(order)
  })
})

// FX15: the gap `mount` waits out, held open on purpose. A MutationObserver
// resolves in the microtasks of the commit that draws the project, before
// that commit's effects run. Its premise (FX14's review round 2, finding 5):
// React's scheduler runs those effects in a later task because the commit
// overran its 5 ms slice, which the provider over the whole dataset always
// does here; the fixed `mount` does not depend on it.
describe('CONTROL (FX15): the gap `mount` waits out', () => {
  it('a grouping made between the project\'s commit and its effects is wiped by the drafts reset: no bar, the Group menu back to none; after the effects it holds', async () => {
    holder.adapter = fx.rabbitAdapter()
    const committed = new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        if (document.querySelector('.rb-tv-button') && sceneRows().length > 0 && ctx?.project?.id === PROJECT_ID) { mo.disconnect(); resolve() }
      })
      mo.observe(document.body, { subtree: true, childList: true })
    })
    render(<ToastProvider><RabbitProvider><Probe /><ScenesView pageActive /></RabbitProvider></ToastProvider>)
    await committed
    expect(ctx.tableViewLast.status).toBe('unavailable')   // the provider's effects for the adapter not run yet
    groupBy('status')
    expect(bar()).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Group' }).value).toBe('')
    // CONTROL: after the effects, the same grouping holds (what `mount` gives every test).
    await waitFor(() => expect(ctx.tableViewLast.status).not.toBe('unavailable'))
    groupBy('status')
    expect(bar()).not.toBeNull()
    expect(screen.getByRole('combobox', { name: 'Group' }).value).toBe('status')
  })
})
