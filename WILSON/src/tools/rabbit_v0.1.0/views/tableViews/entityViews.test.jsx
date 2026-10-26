/** @vitest-environment jsdom */
// =============================================================================
// entityViews.test.jsx — VW1e (2026-10-25): the custom views on the Levels
// table (and through it Experiences: EntityListView renders both), mounted
// inside the REAL provider over the dev fixtures' game variant (levels and
// experiences on, five assets linked to them). docs/design/
// CUSTOM_VIEWS_DESIGN.md §4.3, §4.8, §4.11 as VW1e's step 0 review corrected
// them; her answers by number. Each rule with a CONTROL its absence fails.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act, waitFor, fireEvent, within } from '@testing-library/react'
import { _resetOverlaysForTests } from '../../../../ui/overlay'
import { ToastProvider } from '../../../../ui/Toast'

const holder = vi.hoisted(() => ({ adapter: null, projectId: null }))
const seat = vi.hoisted(() => ({ canWrite: true }))
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
  useRosterMembers: () => ({ members: [], mode: 'supabase' }),
}))

const { buildDevFixtures } = await import('../../../../dev/fixtures/install')
const { PROJECT_ID } = await import('../../../../dev/fixtures/data/project')
const { fid } = await import('../../../../dev/fixtures/ids')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('../../state/RabbitProvider')
const { default: LevelsView } = await import('../LevelsView')

let ctx = null
function Probe() { ctx = useRabbit(); return null }
let fx = null
const run = (fn) => act(async () => { await fn() })
async function mount() {
  holder.adapter = fx.rabbitAdapter()
  render(<ToastProvider><RabbitProvider><Probe /><LevelsView /></RabbitProvider></ToastProvider>)
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
  await waitFor(() => expect(document.querySelectorAll('tr.rb-ent-row').length).toBe(4))
}
const groupBy = (value) => fireEvent.change(screen.getByRole('combobox', { name: 'Group' }), { target: { value } })
const bands = () => [...document.querySelectorAll('.rb-ent-group-label')].map(n => n.textContent)
const levelsOf = (n) => fx.store.assets.find(a => a.id === fid('asset', n)).level_ids || []
const groupEl = (label) => [...document.querySelectorAll('.rb-ent-group')].find(g => g.querySelector('.rb-ent-group-label')?.textContent === label)

beforeEach(() => { fx = buildDevFixtures({ variant: 'game' }); seat.canWrite = true })
afterEach(() => { cleanup(); _resetOverlaysForTests(); ctx = null; fx = null; localStorage.clear(); vi.restoreAllMocks() })

describe('Levels grouped by asset (her Q-M3; §4.11)', () => {
  it('one group per combination of the assets that name a level, named in the display order', async () => {
    await mount()
    groupBy('asset')
    expect(bands()).toEqual(['Storyboards', 'Brass Compass', 'Cliff Path, Storm Lantern', 'Lighthouse Interior, Storm Lantern, Storyboards'])
    // Each level sits once: the groups' counts add up to the rows.
    expect(document.querySelectorAll('tr.rb-ent-row').length).toBe(4)
  })
  it('a level dropped on a group goes into those assets and out of every other: one batch, one Undo (step 0, finding 3)', async () => {
    await mount()
    groupBy('asset')
    const level1 = fid('level', 1)
    expect(levelsOf(4)).toContain(level1)
    await run(async () => { fireEvent.drop(groupEl('Cliff Path, Storm Lantern'), { dataTransfer: { getData: () => level1, setData() {} } }) })
    await waitFor(() => expect(levelsOf(8)).toContain(level1))
    expect(levelsOf(11)).toContain(level1)
    expect(levelsOf(4)).not.toContain(level1)
    expect(bands()).toContain('Cliff Path, Storm Lantern')
    // One toast takes the whole move back.
    await waitFor(() => expect(ctx.undoToast?.message).toBe('Moved "Harbour Approach" to Cliff Path, Storm Lantern'))
    await run(async () => { await ctx.undoToast.onUndo() })
    await waitFor(() => expect(levelsOf(4)).toContain(level1))
    expect(levelsOf(8)).not.toContain(level1)
    expect(levelsOf(11)).not.toContain(level1)
  })
  it('CONTROL: a drop on the level\'s own group writes nothing', async () => {
    await mount()
    groupBy('asset')
    const before = JSON.stringify(fx.store.assets.map(a => a.level_ids || []))
    const update = vi.spyOn(ctx, 'updateAsset')
    await run(async () => { fireEvent.drop(groupEl('Storyboards'), { dataTransfer: { getData: () => fid('level', 1), setData() {} } }) })
    expect(update).not.toHaveBeenCalled()
    expect(JSON.stringify(fx.store.assets.map(a => a.level_ids || []))).toBe(before)
  })
  it('Create grouping makes an empty asset group on the Levels table at once, in its words', async () => {
    await mount()
    groupBy('asset')
    fireEvent.click(screen.getByRole('button', { name: 'Create grouping' }))
    const dialog = screen.getByRole('dialog', { name: 'Create grouping' })
    expect(dialog.textContent).toContain('levels dragged into it take these assets')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /^Lookbook/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /^Treatment/ }))
    await run(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Create' })) })
    expect(fx.store.itemGroupings.find(g => g.table_key === 'levels' && g.kind === 'asset')).toBeTruthy()
    expect(bands()).toContain('Lookbook, Treatment')
  })
  it('CONTROL (step 0, finding 4; Q-F): a seat that cannot write sees no Create grouping and drags nothing', async () => {
    seat.canWrite = false
    await mount()
    groupBy('asset')
    expect(screen.queryByRole('button', { name: 'Create grouping' })).toBeNull()
    expect([...document.querySelectorAll('tr.rb-ent-row')].every(r => r.getAttribute('draggable') !== 'true')).toBe(true)
  })
})

describe('the views on the Levels table (Q17, Q3, defect 4)', () => {
  it('Q17: the old Levels views go on the first load; CONTROL: the Experiences key stays', async () => {
    localStorage.setItem('rabbit_level_saved_views', '[]')
    localStorage.setItem('rabbit_experience_saved_views', '[]')
    await mount()
    expect(localStorage.getItem('rabbit_level_saved_views')).toBeNull()
    expect(localStorage.getItem('rabbit_experience_saved_views')).toBe('[]')
  })
  it('a grouping is a change for now on the levels table; Save as new view keeps it there', async () => {
    await mount()
    groupBy('status')
    const bar = document.querySelector('.rb-tv-bar')
    expect(bar.textContent).toContain('All: changed for now')
    fireEvent.click(within(bar).getByRole('button', { name: 'Save as new view' }))
    const field = within(bar).getByRole('textbox', { name: 'View name' })
    fireEvent.change(field, { target: { value: 'Levels by status' } })
    await run(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
    expect(fx.store.tableViews.find(v => v.name === 'Levels by status')).toMatchObject({ table_key: 'levels' })
  })
  it('defect 4: a ticked level the search hides leaves the selection', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Select Lamp Room' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select Cliff Path' }))
    expect(document.querySelector('.rb-ent-bulk-count').textContent).toBe('2 selected')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search levels' }), { target: { value: 'lamp' } })
    expect(document.querySelector('.rb-ent-bulk-count').textContent).toBe('1 selected')
  })
})

describe('code review round 1', () => {
  // A backend that keeps no asset levels (a cloud without 0099), the rest the fixtures'.
  const withoutLinks = (base) => new Proxy(base, { get: (t, k) => (k === 'assetLevelLinksAvailable' ? () => false : Reflect.get(t, k)) })
  async function mountWith(adapter) {
    holder.adapter = adapter
    render(<ToastProvider><RabbitProvider><Probe /><LevelsView /></RabbitProvider></ToastProvider>)
    await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
    await waitFor(() => expect(document.querySelectorAll('tr.rb-ent-row').length).toBe(4))
  }
  const draggable = () => [...document.querySelectorAll('tr.rb-ent-row')].map(r => r.getAttribute('data-draggable'))
  const createButton = () => screen.getByRole('button', { name: 'Create grouping' })

  it('R1-9: on a cloud without 0099 the drag and Create grouping are greyed with the reason; CONTROL: kept, both live', async () => {
    await mountWith(withoutLinks(fx.rabbitAdapter()))
    expect(ctx.assetLevelLinksAvailable).toBe(false)
    groupBy('asset')
    expect(draggable().every(d => d === 'false')).toBe(true)
    const gate = createButton().closest('[aria-disabled="true"]')
    expect(gate?.getAttribute('title')).toBe('The cloud does not keep an asset\'s levels and experiences yet: it needs migration 0099.')
    fireEvent.click(createButton())
    expect(screen.queryByRole('dialog', { name: 'Create grouping' })).toBeNull()
    cleanup()
    fx = buildDevFixtures({ variant: 'game' })
    await mountWith(fx.rabbitAdapter())
    expect(ctx.assetLevelLinksAvailable).toBe(true)
    groupBy('asset')
    expect(draggable().every(d => d === 'true')).toBe(true)
    expect(createButton().closest('[aria-disabled="true"]')).toBeNull()
  })

  it('R1-6: with Hide empty groups off, every asset\'s own group comes in the Assets table\'s order (its sort_order), not the list\'s', async () => {
    await mount()
    groupBy('asset')
    fireEvent.click(screen.getByRole('button', { name: /^Views: / }))
    fireEvent.click(within(screen.getByRole('dialog', { name: /^Views/ })).getByRole('button', { name: /^Group:/ }))
    fireEvent.click(screen.getByRole('switch', { name: 'Hide empty groups' }))
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    const last = ctx.assets[ctx.assets.length - 1]
    expect(bands()[0]).not.toBe(last.name)
    // A change of order that leaves the list as it was (a teammate's, say):
    // the last asset of the list is now the first of the table.
    await run(() => ctx.updateAsset(last.id, { sort_order: -1 }))
    expect(ctx.assets[ctx.assets.length - 1].id).toBe(last.id)
    expect(bands()[0]).toBe(last.name)
  })
})
