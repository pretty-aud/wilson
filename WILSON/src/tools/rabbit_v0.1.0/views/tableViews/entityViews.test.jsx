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
// FX15 (OUTSTANDING FX14-01; tasksViews.test.jsx's mount, FX14): the fixtures
// load the project in microtasks, so ONE commit brings the adapter and the
// whole project, while the provider's effects for them (the last used views
// read, which ends the status 'unavailable'; the views' drafts reset; the
// project's visit count) run in a later task. In that gap the Levels table is drawn with its four
// rows while the status still reads 'unavailable',
// so the waits below could all pass there, and a change for now made then is
// wiped by the pending drafts reset: with this mount forced into the gap, 9 of this
// file's 11 tests failed, every run, each at a grouping or a tick
// (FX15's hand-off, §2). So the render runs inside act (React flushes those
// effects before act returns), and the mount waits for their evidence where
// the adapter reads a map: a status past 'unavailable', which it holds from
// the provider's first effect (no adapter yet) until then.
// `mountWith` below is the same mount for an adapter of a test's own.
async function mount(adapter = fx.rabbitAdapter()) {
  holder.adapter = adapter
  await act(async () => { render(<ToastProvider><RabbitProvider><Probe /><LevelsView /></RabbitProvider></ToastProvider>) })
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
  await waitFor(() => expect(document.querySelectorAll('tr.rb-ent-row').length).toBe(4))
  if (typeof adapter.getTableViewLast === 'function') await waitFor(() => expect(ctx.tableViewLast.status).not.toBe('unavailable'))
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
  const mountWith = (adapter) => mount(adapter)
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

describe('code review round 2', () => {
  const REASON = 'The cloud does not keep an asset\'s levels and experiences yet: it needs migration 0099.'
  const withoutLinks = (base) => new Proxy(base, { get: (t, k) => (k === 'assetLevelLinksAvailable' ? () => false : Reflect.get(t, k)) })
  const live = () => document.querySelector('p.sr-only[role="status"]')?.textContent || ''
  const mountWith = (adapter) => mount(adapter)
  it('R2-2, R2-5: on a cloud without 0099 a level\'s window cannot add or remove its assets, saying why, and the table says it when grouped by asset; CONTROL: kept, live', async () => {
    await mountWith(withoutLinks(fx.rabbitAdapter()))
    groupBy('asset')
    expect(live()).toBe(REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Open Lamp Room' }))
    const dialog = screen.getByRole('dialog', { name: 'Lamp Room' })
    const add = within(dialog).getByRole('button', { name: 'Add asset relation', hidden: true })
    expect(add.closest('[aria-disabled="true"]')?.getAttribute('title')).toBe(REASON)
    const removes = within(dialog).getAllByRole('button', { name: 'Remove relation', hidden: true })
    expect(removes.length).toBeGreaterThan(0)
    for (const r of removes) expect(r.closest('[aria-disabled="true"]')?.getAttribute('title')).toBe(REASON)
    cleanup()
    fx = buildDevFixtures({ variant: 'game' })
    await mountWith(fx.rabbitAdapter())
    groupBy('asset')
    expect(live()).not.toBe(REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Open Lamp Room' }))
    const kept = screen.getByRole('dialog', { name: 'Lamp Room' })
    expect(within(kept).getByRole('button', { name: 'Add asset relation' }).closest('[aria-disabled="true"]')).toBeNull()
  })
})

// FX15: the gap `mount` waits out, held open on purpose. A MutationObserver
// resolves in the microtasks of the commit that draws the project, before
// that commit's effects run. Its premise, as FX15's review round 1 (R1-2)
// corrected it: React asks the Scheduler for a paint in every commit
// (`requestPaint`), and the Scheduler then yields however short the commit
// was, so the commit's passive effects are always a later task (not, as
// FX14's review round 2 had it, because the commit overran its 5 ms slice;
// tableViewsProvider.test.jsx's premise test holds it). The fixed `mount`
// does not depend on it.
describe('CONTROL (FX15): the gap `mount` waits out', () => {
  it('a grouping made between the project\'s commit and its effects is wiped by the drafts reset: no groups; after the effects it holds', async () => {
    holder.adapter = fx.rabbitAdapter()
    const committed = new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        if (document.querySelectorAll('tr.rb-ent-row').length === 4 && ctx?.project?.id === PROJECT_ID) { mo.disconnect(); resolve() }
      })
      mo.observe(document.body, { subtree: true, childList: true })
    })
    render(<ToastProvider><RabbitProvider><Probe /><LevelsView /></RabbitProvider></ToastProvider>)
    await committed
    expect(ctx.tableViewLast.status).toBe('unavailable')   // the provider's effects for the adapter not run yet
    groupBy('asset')
    expect(bands()).toEqual([])
    expect(screen.getByRole('combobox', { name: 'Group' }).value).toBe('')
    // CONTROL: after the effects, the same grouping holds (what `mount` gives every test).
    await waitFor(() => expect(ctx.tableViewLast.status).not.toBe('unavailable'))
    groupBy('asset')
    expect(bands()).toEqual(['Storyboards', 'Brass Compass', 'Cliff Path, Storm Lantern', 'Lighthouse Interior, Storm Lantern, Storyboards'])
  })
})
