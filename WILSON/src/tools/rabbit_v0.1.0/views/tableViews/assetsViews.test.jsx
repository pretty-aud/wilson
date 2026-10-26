/** @vitest-environment jsdom */
// =============================================================================
// assetsViews.test.jsx — VW1e (2026-10-25): the custom views on the Assets
// table, mounted inside the REAL provider over the dev fixtures (the cloud's
// twin in memory; VW1d's tasksViews.test.jsx harness), as a person uses them.
// docs/design/CUSTOM_VIEWS_DESIGN.md §4.1, §4.3, §4.8, §4.10 and §4.11, as
// VW1e's step 0 review corrected them (§11 round 6); her answers by number.
// Each rule has a CONTROL the rule's absence fails.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act, waitFor, fireEvent, within } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../../ui/overlay'
import { ToastProvider } from '../../../../ui/Toast'

const holder = vi.hoisted(() => ({ adapter: null, projectId: null }))
const seat = vi.hoisted(() => ({ canWrite: true }))
// The real provider and the whole Assets table: the Tasks harness's 20 s
// (CI's runner is about 2.5 times slower than this machine, VW1d).
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
const { fid } = await import('../../../../dev/fixtures/ids')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('../../state/RabbitProvider')
const { default: ProjectAssetsView } = await import('../ProjectAssetsView')

let ctx = null
function Probe() { ctx = useRabbit(); return null }
let fx = null

const run = (fn) => act(async () => { await fn() })
async function mount(adapter = fx.rabbitAdapter()) {
  holder.adapter = adapter
  render(<ToastProvider><RabbitProvider><Probe /><ProjectAssetsView /></RabbitProvider></ToastProvider>)
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
  await waitFor(() => expect(screen.getByRole('button', { name: /^Views: / })).toBeTruthy())
  await waitFor(() => expect(document.querySelectorAll('tr.rb-asset-row').length).toBeGreaterThan(0))
}
const viewsButton = () => screen.getByRole('button', { name: /^Views: / })
const openViews = () => fireEvent.click(viewsButton())
const dropdown = () => screen.queryByRole('dialog', { name: /^Views/ })
const bar = () => document.querySelector('.rb-tv-bar')
const rows = () => [...document.querySelectorAll('tr.rb-asset-row')]
const bands = () => [...document.querySelectorAll('tr.rb-asset-group-row')].map(r => r.querySelector('.rb-asset-group-label')?.textContent)
const groupBy = (value) => fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value } })
const assetId = (n) => fid('asset', n)
const sceneId = (n) => fid('scene', n)
const sceneName = (n) => fx.store.scenes.find(s => s.id === sceneId(n)).name
function openCard(name) {
  openViews()
  fireEvent.click(within(dropdown()).getByRole('button', { name: new RegExp(`^${name}:`) }))
}

beforeEach(() => { fx = buildDevFixtures(); seat.canWrite = true })
afterEach(() => { cleanup(); _resetOverlaysForTests(); ctx = null; fx = null; localStorage.clear(); vi.restoreAllMocks() })

describe('the toolbar (§4.1, Q-P1, Q17)', () => {
  it('the Views button names the view on screen and names its table; no bar at rest', async () => {
    await mount()
    expect(viewsButton().textContent).toBe('All')
    expect(viewsButton().getAttribute('data-table')).toBe('assets')
    expect(bar()).toBeNull()
  })
  it('Q17: the browser\'s old Assets views are removed on the first load; CONTROL: the Scenes table\'s key stays until its table loads', async () => {
    localStorage.setItem('rabbit_asset_saved_views', '[{"id":"1","name":"Old"}]')
    localStorage.setItem('rabbit_scene_saved_views', '[]')
    await mount()
    expect(localStorage.getItem('rabbit_asset_saved_views')).toBeNull()
    expect(localStorage.getItem('rabbit_scene_saved_views')).toBe('[]')
  })
})

describe('a change for now and the bar (§4.4, Q3)', () => {
  it('grouping by status is a change for now; Save as new view keeps it for everyone on the Assets table', async () => {
    await mount()
    groupBy('status')
    expect(bar()).not.toBeNull()
    expect(bar().textContent).toContain('All: changed for now')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Save as new view' }))
    const field = within(bar()).getByRole('textbox', { name: 'View name' })
    fireEvent.change(field, { target: { value: 'By status' } })
    await run(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
    const stored = fx.store.tableViews.find(v => v.name === 'By status')
    expect(stored).toMatchObject({ table_key: 'assets', project_id: PROJECT_ID })
    expect(stored.config.group).toEqual({ field: 'status', hideEmpty: true })
    expect(viewsButton().textContent).toBe('By status')
    expect(bar()).toBeNull()
  })
  it('the layout is the view\'s (Q8): the Gallery tab is a change for now; the picture size is not', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'md thumbnails' }))
    expect(bar()).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Gallery' }))
    expect(bar()).not.toBeNull()
    expect(document.querySelector('table')).toBeNull()
  })
})

describe('the columns in front of the name (Q-J; step 0 finding 1)', () => {
  it('the Fields card lists the Picture above the name, a switch and no handle; hiding it drops the column and raises the bar', async () => {
    await mount()
    expect(document.querySelectorAll('td.rb-asset-thumb-cell').length).toBe(rows().length)
    openCard('Fields')
    const grid = within(dropdown()).getByRole('grid', { name: 'Fields' })
    const gridRows = within(grid).getAllByRole('row')
    expect(gridRows[0].textContent).toContain('Picture')
    expect(gridRows[1].textContent).toContain('Name')
    expect(gridRows[0].querySelector('.rb-tv-handle')).toBeNull()
    fireEvent.click(within(gridRows[0]).getByRole('switch', { name: 'Show Picture' }))
    expect(document.querySelectorAll('td.rb-asset-thumb-cell').length).toBe(0)
    expect(document.querySelector('th.rb-asset-thumb-cell')).toBeNull()
    // CONTROL of the finding: the hidden picture is a change of one's own,
    // so the bar is there to save it.
    expect(bar()).not.toBeNull()
    expect(ctx.viewDraftOf('assets').config.leading).toEqual([{ key: 'thumbnail', visible: false }])
  })
})

describe('combination groups by scene (Q-M3, Q-D), Create grouping (Q-D3), the drag (Q-D1)', () => {
  beforeEach(() => {
    // Two assets in two scenes each, one in one: the project has scenes on.
    fx.store.assets.find(a => a.id === assetId(7)).scene_ids = [sceneId(2), sceneId(1)]
    fx.store.assets.find(a => a.id === assetId(11)).scene_ids = [sceneId(1), sceneId(2)]
    fx.store.assets.find(a => a.id === assetId(8)).scene_ids = [sceneId(3)]
  })
  it('one group per combination, named in the display order (scenes by number), "No scene" last', async () => {
    await mount()
    groupBy('scene')
    const names = bands()
    expect(names).toContain(`${sceneName(1)}, ${sceneName(2)}`)
    expect(names).toContain(sceneName(3))
    expect(names[names.length - 1]).toBe('No scene')
    // Each asset sits in exactly one group: the counts add up to the rows.
    expect(rows().length).toBe(fx.store.assets.filter(a => a.project_id === PROJECT_ID && !a.deleted_at).length)
  })
  it('Create grouping shows beside the Group menu while grouped by a kind, for a writer; it makes an empty group at once', async () => {
    await mount()
    expect(screen.queryByRole('button', { name: 'Create grouping' })).toBeNull()
    groupBy('scene')
    fireEvent.click(screen.getByRole('button', { name: 'Create grouping' }))
    const dialog = screen.getByRole('dialog', { name: 'Create grouping' })
    expect(dialog.textContent).toContain('assets dragged into it take these scenes')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: new RegExp(`^${sceneName(4)}`) }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: new RegExp(`^${sceneName(5)}`) }))
    await run(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Create' })) })
    expect(fx.store.itemGroupings.some(g => g.table_key === 'assets' && g.kind === 'scene')).toBe(true)
    expect(bands()).toContain(`${sceneName(4)}, ${sceneName(5)}`)
  })
  it('CONTROL (Q-F): a seat that cannot write sees no Create grouping, and its rows do not drag', async () => {
    seat.canWrite = false
    await mount()
    groupBy('scene')
    expect(screen.queryByRole('button', { name: 'Create grouping' })).toBeNull()
    expect(rows().every(r => r.getAttribute('draggable') !== 'true')).toBe(true)
  })
  it('dropping an asset on a group gives it that group\'s scenes, one undo; a drop on its own group writes nothing', async () => {
    await mount()
    groupBy('scene')
    const target = [...document.querySelectorAll('tr.rb-asset-group-row')].find(r => r.textContent.includes(`${sceneName(1)}, ${sceneName(2)}`))
    const data = { getData: () => assetId(5), setData() {} }
    const update = vi.spyOn(ctx, 'updateAsset')
    await run(async () => { fireEvent.drop(target, { dataTransfer: data }) })
    await waitFor(() => expect(fx.store.assets.find(a => a.id === assetId(5)).scene_ids).toEqual([sceneId(1), sceneId(2)]))
    // CONTROL: the asset already in "SC1, SC2" dropped there again writes nothing.
    const writes = update.mock.calls.length
    const again = [...document.querySelectorAll('tr.rb-asset-group-row')].find(r => r.textContent.includes(`${sceneName(1)}, ${sceneName(2)}`))
    await run(async () => { fireEvent.drop(again, { dataTransfer: { getData: () => assetId(7), setData() {} } }) })
    expect(update.mock.calls.length).toBe(writes)
  })
})

describe('defect 4: ticked rows a filter or the search hides are unticked (§4.8)', () => {
  it('a ticked asset the search hides leaves the selection; CONTROL: one it keeps stays ticked', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Select Cliff Path' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Lookbook' }))
    expect(document.querySelector('.rb-asset-bulk-count').textContent).toBe('2 selected')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search assets' }), { target: { value: 'cliff' } })
    expect(document.querySelector('.rb-asset-bulk-count').textContent).toBe('1 selected')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search assets' }), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Select Cliff Path' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Select Lookbook' }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('the Gallery\'s cards (Q-E, Q-P2; step 0 finding 6)', () => {
  it('the Fields card in the Gallery lists the card\'s own lines; hiding Tasks takes the count off every card and the column off the table', async () => {
    await mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Gallery' }))
    expect(document.querySelectorAll('.rb-asset-card-count').length).toBeGreaterThan(0)
    openCard('Fields')
    const grid = within(dropdown()).getByRole('grid', { name: 'Card fields' })
    expect(within(grid).getAllByRole('row').map(r => r.textContent)).toEqual(['Status', 'Type', 'Phase', 'Tasks'])
    fireEvent.click(within(grid).getByRole('switch', { name: 'Show Tasks' }))
    expect(document.querySelectorAll('.rb-asset-card-count').length).toBe(0)
    // One list for both (Q-P2): back in the table the Tasks column is gone too.
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    fireEvent.click(screen.getByRole('tab', { name: 'Table' }))
    expect([...document.querySelectorAll('thead th')].map(th => th.textContent)).not.toContain('Tasks')
  })
})

describe('the widths from the columns on screen (§4.10; step 0 finding 8)', () => {
  it('the wrap carries the fixed sum of the columns on screen; Description hidden, no column grows', async () => {
    await mount()
    const wrap = () => document.querySelector('.rb-asset-table-wrap')
    expect(wrap().style.getPropertyValue('--rb-asset-fixed')).toContain('var(--rb-asset-desc)')
    expect(wrap().getAttribute('data-grow')).toBe('some')
    openCard('Fields')
    fireEvent.click(within(dropdown()).getByRole('switch', { name: 'Show Description' }))
    expect(wrap().style.getPropertyValue('--rb-asset-fixed')).not.toContain('var(--rb-asset-desc)')
    expect(wrap().getAttribute('data-grow')).toBe('none')
    // CONTROL: the picture's width leaves the sum with the picture.
    expect(wrap().style.getPropertyValue('--rb-asset-fixed')).toContain('var(--rb-asset-thumb)')
    fireEvent.click(within(dropdown()).getByRole('switch', { name: 'Show Picture' }))
    expect(wrap().style.getPropertyValue('--rb-asset-fixed')).not.toContain('var(--rb-asset-thumb)')
  })
})
