/** @vitest-environment jsdom */
// =============================================================================
// tableViewsProvider.test.jsx — VW1c (0098): custom table views through the
// real provider over the dev fixtures (the cloud's twin in memory):
//   · the load gives both collections empty (her Q20: only All), available;
//   · a view's add lands in the store and on the context, offers its undo in
//     the toast, and is NOT a keyboard-history step (design §4.4: view changes
//     never enter Ctrl+Z);
//   · a teammate's save meanwhile: the conditional save answers `changed` and
//     the stored row comes onto the context;
//   · a scene deleted for good leaves the grouping that names it (the sweep,
//     on screen and in the store), and Ctrl+Z puts the scene back and then
//     the grouping as it was, again after a redo (review round 2, R2-2);
//   · a bulk delete for good on the desktop sends its requests in the order
//     the screen mirrors (R2-1);
//   · the last used view, written and read back through the context.
// =============================================================================
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { render, cleanup, act, waitFor } from '@testing-library/react'

const holder = vi.hoisted(() => ({ adapter: null, projectId: null }))

vi.mock('../adapters', () => ({
  selectAdapter: () => holder.adapter,
  ADAPTER_MODES: ['supabase', 'local_server', 'google_drive'],
  adapterSupportsWrites: () => true,
}))
vi.mock('../adapters/supabaseAdapter', () => ({ resetSupabaseAdapter: () => {} }))
vi.mock('../../../cloud/auth/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}))
vi.mock('../../../lib/localData', () => ({
  hasLocalServer: () => false,
  loadOtterSettings: async () => ({ rabbit: { adapterMode: 'supabase', activeProjectId: holder.projectId } }),
  saveOtterSettings: async () => {},
}))
vi.mock('../../../dev/devFixtures', async (importOriginal) => ({ ...(await importOriginal()), devFixtures: () => null }))
vi.mock('../intake/pipeline', () => ({ runIngestion: vi.fn() }))

const { buildDevFixtures } = await import('../../../dev/fixtures/install')
const { PROJECT_ID } = await import('../../../dev/fixtures/data/project')
const { fid } = await import('../../../dev/fixtures/ids')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('./RabbitProvider')

let ctx = null
function Probe() { ctx = useRabbit(); return null }
let fx = null

const SC = (n) => fid('scene', n)
const run = (fn) => act(async () => { await fn() })

// FX15 (OUTSTANDING FX14-01; tasksViews.test.jsx's mount, FX14): the fixtures
// load the project in microtasks, so ONE commit brings the adapter and the
// whole project, while the provider's effects for them (the last used views
// read, which ends the status 'unavailable'; the views' drafts reset; the
// project's visit count) run in a later task. In that gap the context already has the
// project while the status still reads 'unavailable',
// so the waits below could all pass there, and a change for now made then is
// wiped by the pending drafts reset: with this mount forced into the gap, 1 of this
// file's 10 tests failed, every run: a view added there offered an Undo that
// did nothing (the add had taken the visit before the project's, which its
// effect counts after; read from the code)
// (FX15's hand-off, §2). So the render runs inside act (React flushes those
// effects before act returns), and the mount waits for their evidence where
// the adapter reads a map: a status past 'unavailable', which it holds from
// the provider's first effect (no adapter yet) until then.
async function mount(adapter) {
  holder.adapter = adapter
  await act(async () => { render(<RabbitProvider><Probe /></RabbitProvider>) })
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
  if (typeof adapter.getTableViewLast === 'function') await waitFor(() => expect(ctx.tableViewLast.status).not.toBe('unavailable'))
}

beforeEach(() => { fx = buildDevFixtures() })
afterEach(() => { cleanup(); ctx = null; fx = null })

describe('custom table views through the provider (the dev fixtures)', () => {
  it('the load: no views and no groupings (only All, Q20), available, no error', async () => {
    await mount(fx.rabbitAdapter())
    expect(ctx.tableViews).toEqual([])
    expect(ctx.itemGroupings).toEqual([])
    expect(ctx.tableViewsAvailable).toBe(true)
    expect(ctx.tableViewsError).toBe(null)
    expect(ctx.viewsOf('tasks')).toEqual([])
    expect(ctx.allViewOf('tasks')).toMatchObject({ id: 'all', name: 'All', builtIn: true })
  })

  it('a new view is saved for everyone, offers its undo in the toast, and is not a Ctrl+Z step', async () => {
    await mount(fx.rabbitAdapter())
    const undoBefore = ctx.canUndo
    let stored
    await run(async () => { stored = await ctx.addTableView({ tableKey: 'tasks', name: 'Shoot week' }) })
    expect(fx.store.tableViews.map(v => v.id)).toEqual([stored.id])
    expect(ctx.viewsOf('tasks').map(v => v.name)).toEqual(['Shoot week'])
    expect(ctx.undoToast?.message).toBe('Shoot week saved for everyone')
    // Not a keyboard-history step: Ctrl+Z has nothing new to take back.
    expect(ctx.canUndo).toBe(undoBefore)
    await run(() => ctx.undo())
    expect(fx.store.tableViews).toHaveLength(1)
    // The toast's Undo takes it back.
    await run(() => ctx.undoToast.onUndo())
    expect(fx.store.tableViews).toEqual([])
    expect(ctx.viewsOf('tasks')).toEqual([])
  })

  it('a save after a teammate\'s: changed — the stored row comes onto the context, nothing written', async () => {
    await mount(fx.rabbitAdapter())
    let stored
    await run(async () => { stored = await ctx.addTableView({ tableKey: 'assets', name: 'Props' }) })
    // A teammate saves the view (in the fake cloud): a new revision.
    const theirs = fx.store.tableViews.find(v => v.id === stored.id)
    theirs.config = { version: 1, sorts: [{ field: 'name', dir: 'desc' }] }
    theirs.revision = stored.revision + 50
    let res
    await run(async () => { res = await ctx.updateTableView(stored.id, { sorts: [{ field: 'name', dir: 'asc' }] }, { expectRevision: stored.revision }) })
    expect(res.status).toBe('changed')
    expect(ctx.viewsOf('assets')[0]).toMatchObject({ revision: stored.revision + 50, config: theirs.config })
    expect(fx.store.tableViews.find(v => v.id === stored.id).config).toEqual(theirs.config)
  })

  it('a scene deleted for good leaves its grouping, and Ctrl+Z puts the scene back, then the grouping as it was', async () => {
    await mount(fx.rabbitAdapter())
    let g
    await run(async () => { g = await ctx.addItemGrouping({ tableKey: 'tasks', kind: 'scene', entityIds: [SC(5), SC(6)] }) })
    expect(ctx.groupingsOf('tasks', 'scene').map(x => x.entity_ids)).toEqual([[SC(5), SC(6)].sort()])
    await run(() => ctx.deleteScene(SC(6)))
    // The sweep: on screen and in the store.
    expect(ctx.groupingsOf('tasks', 'scene').map(x => x.entity_ids)).toEqual([[SC(5)]])
    expect(fx.store.itemGroupings.find(x => x.id === g.id).entity_ids).toEqual([SC(5)])
    await run(() => ctx.undo())
    await waitFor(() => expect(ctx.scenes.some(s => s.id === SC(6))).toBe(true))
    // As it was: the set (a shrunk grouping is made again first, under a new
    // id, and the shrunk row removed after: review round 1, R1-1).
    const sets = (rows) => rows.filter(x => x.table_key === 'tasks' && x.kind === 'scene').map(x => x.entity_ids.join(','))
    await waitFor(() => expect(sets(fx.store.itemGroupings)).toEqual([[SC(5), SC(6)].sort().join(',')]))
    expect(sets(ctx.itemGroupings)).toEqual([[SC(5), SC(6)].sort().join(',')])
    expect(fx.store.itemGroupings.some(x => x.id === g.id)).toBe(false)
  })

  it('🚨 R1-1: Ctrl+Z whose scene does not come back leaves the shrunk grouping as it was, and says so', async () => {
    await mount(fx.rabbitAdapter())
    await run(async () => { await ctx.addItemGrouping({ tableKey: 'tasks', kind: 'scene', entityIds: [SC(5), SC(6)] }) })
    await run(() => ctx.deleteScene(SC(6)))
    // The scene's restore fails (offline, a refusal): the history runner
    // goes on to the groupings' restore.
    vi.spyOn(holder.adapter, 'upsertScene').mockRejectedValue(new Error('offline'))
    await run(() => ctx.undo())
    const sets = (rows) => rows.filter(x => x.table_key === 'tasks' && x.kind === 'scene').map(x => x.entity_ids.join(','))
    expect(sets(fx.store.itemGroupings)).toEqual([SC(5)])
    expect(sets(ctx.itemGroupings)).toEqual([SC(5)])
    await waitFor(() => expect(ctx.error).toMatch(/grouping was not put back/))
  })

  it('R2-5: a grouping refused for another reason than a missing item is said in the refusal\'s words', async () => {
    await mount(fx.rabbitAdapter())
    await run(async () => { await ctx.addItemGrouping({ tableKey: 'tasks', kind: 'scene', entityIds: [SC(5), SC(6)] }) })
    await run(() => ctx.deleteScene(SC(6)))
    vi.spyOn(holder.adapter, 'addItemGrouping')
      .mockRejectedValue(Object.assign(new Error('You can no longer change groupings on this project.'), { code: '42501' }))
    await run(() => ctx.undo())
    await waitFor(() => expect(ctx.error).toBe('A grouping was not put back as it was. You can no longer change groupings on this project.'))
  })

  it('CONTROL: a grouping that does not name the deleted scene is untouched, and nothing is restored for it', async () => {
    await mount(fx.rabbitAdapter())
    let g
    await run(async () => { g = await ctx.addItemGrouping({ tableKey: 'tasks', kind: 'scene', entityIds: [SC(1), SC(2)] }) })
    const calls = vi.spyOn(holder.adapter, 'addItemGrouping')
    await run(() => ctx.deleteScene(SC(6)))
    await run(() => ctx.undo())
    await waitFor(() => expect(ctx.scenes.some(s => s.id === SC(6))).toBe(true))
    expect(fx.store.itemGroupings.find(x => x.id === g.id).entity_ids).toEqual([SC(1), SC(2)].sort())
    expect(calls).not.toHaveBeenCalled()
  })

  it('🚨 R2-1: a bulk delete for good (the desktop) sends its requests in the ids\' code-unit order, so the grouping left on screen is the one the backend kept; Ctrl+Z puts both back', async () => {
    const { createRequire } = await import('node:module')
    const twin = createRequire(import.meta.url)('../../../../electron/rabbitTableViews.cjs')
    const base = fx.rabbitAdapter()
    const sent = []
    // The desktop's shape: no trash (no restoreAsset), and each delete removes
    // the row and sweeps its groupings and task items in the same write.
    const desktop = {
      ...base,
      restoreAsset: undefined,
      async deleteAsset(id) {
        sent.push(id)
        fx.store.assets = fx.store.assets.filter(a => a.id !== id)
        fx.store.taskItems = (fx.store.taskItems || []).filter(i => !(i.entity_type === 'asset' && i.entity_id === id))
        const rows = {
          assets: fx.store.assets, scenes: fx.store.scenes || [], shots: fx.store.shots || [],
          levels: fx.store.levels || [], experiences: fx.store.experiences || [], itemGroupings: fx.store.itemGroupings,
        }
        twin.forgetGoneItems(rows)
        fx.store.itemGroupings = rows.itemGroupings
      },
    }
    await mount(desktop)
    const [lo, hi, x] = ctx.assets.map(a => a.id).sort()
    await run(async () => { await ctx.addItemGrouping({ tableKey: 'tasks', kind: 'asset', entityIds: [lo, x] }) })
    await run(async () => { await ctx.addItemGrouping({ tableKey: 'tasks', kind: 'asset', entityIds: [hi, x] }) })
    const mine = (rows) => rows.filter(g => g.table_key === 'tasks' && g.kind === 'asset').map(g => `${g.id}:${g.entity_ids.join(',')}`).sort()
    const sets = (rows) => rows.filter(g => g.table_key === 'tasks' && g.kind === 'asset').map(g => g.entity_ids.join(',')).sort()
    // Handed in the other order, as a view's selection may hand them.
    await run(() => ctx.deleteAssets([hi, lo]))
    expect(sent).toEqual([lo, hi])
    expect(mine(fx.store.itemGroupings)).toHaveLength(1)
    expect(mine(ctx.itemGroupings)).toEqual(mine(fx.store.itemGroupings))
    await run(() => ctx.undo())
    await waitFor(() => expect([lo, hi].every(id => ctx.assets.some(a => a.id === id))).toBe(true))
    await waitFor(() => expect(sets(fx.store.itemGroupings)).toEqual([[lo, x].sort().join(','), [hi, x].sort().join(',')].sort()))
    expect(mine(ctx.itemGroupings)).toEqual(mine(fx.store.itemGroupings))
  })

  it('🚨 R2-2: Ctrl+Z, Ctrl+Y, Ctrl+Z of a scene deleted for good leaves one grouping, as it was', async () => {
    await mount(fx.rabbitAdapter())
    await run(async () => { await ctx.addItemGrouping({ tableKey: 'tasks', kind: 'scene', entityIds: [SC(5), SC(6)] }) })
    const pair = [SC(5), SC(6)].sort().join(',')
    const sets = (rows) => rows.filter(x => x.table_key === 'tasks' && x.kind === 'scene').map(x => x.entity_ids.join(','))
    await run(() => ctx.deleteScene(SC(6)))
    await run(() => ctx.undo())
    await waitFor(() => expect(sets(fx.store.itemGroupings)).toEqual([pair]))
    await run(() => ctx.redo())
    expect(ctx.scenes.some(s => s.id === SC(6))).toBe(false)
    expect(sets(fx.store.itemGroupings)).toEqual([SC(5)])
    await run(() => ctx.undo())
    await waitFor(() => expect(ctx.scenes.some(s => s.id === SC(6))).toBe(true))
    await waitFor(() => expect(sets(fx.store.itemGroupings)).toEqual([pair]))
    expect(sets(ctx.itemGroupings)).toEqual([pair])
  })

  it('the last used view is read once and written through the context', async () => {
    await mount(fx.rabbitAdapter())
    await waitFor(() => expect(ctx.tableViewLast.status).toBe('ready'))
    expect(ctx.lastViewOf('tasks')).toBe(null)
    await run(() => ctx.setTableViewLast('tasks', 'all'))
    expect(ctx.lastViewOf('tasks')).toBe('all')
    // The fake cloud holds it too (another computer would read it).
    const res = await holder.adapter.getTableViewLast()
    expect(res.map[`${PROJECT_ID}:tasks`]).toMatchObject({ view: 'all' })
  })
})

// FX15: the gap `mount` waits out, held open on purpose. A MutationObserver
// resolves in the microtasks of the commit that draws the project, before
// that commit's effects run. Its premise (FX14's review round 2, finding 5):
// React's scheduler runs those effects in a later task because the commit
// overran its 5 ms slice, which the provider over the whole dataset always
// does here; the fixed `mount` does not depend on it.
// No view is drawn here, so a marker carries the project's id into the DOM
// for the observer to see.
function Marker() { const c = useRabbit(); return <i data-project={c?.project?.id || ''} /> }
describe('CONTROL (FX15): the gap `mount` waits out', () => {
  it('a view added between the project\'s commit and its effects offers an Undo that does nothing; after the effects the Undo takes it back', async () => {
    holder.adapter = fx.rabbitAdapter()
    const committed = new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        if (ctx?.project?.id === PROJECT_ID) { mo.disconnect(); resolve() }
      })
      mo.observe(document.body, { subtree: true, childList: true, attributes: true })
    })
    render(<RabbitProvider><Probe /><Marker /></RabbitProvider>)
    await committed
    expect(ctx.tableViewLast.status).toBe('unavailable')   // the provider's effects for the adapter not run yet
    await run(async () => { await ctx.addTableView({ tableKey: 'tasks', name: 'In the gap' }) })
    expect(ctx.undoToast?.message).toBe('In the gap saved for everyone')
    await run(() => ctx.undoToast.onUndo())
    expect(fx.store.tableViews.map(v => v.name)).toEqual(['In the gap'])
    // CONTROL: after the effects, the same add's Undo takes it back (what `mount` gives every test).
    await waitFor(() => expect(ctx.tableViewLast.status).not.toBe('unavailable'))
    await run(async () => { await ctx.addTableView({ tableKey: 'tasks', name: 'After' }) })
    await run(() => ctx.undoToast.onUndo())
    expect(fx.store.tableViews.map(v => v.name)).toEqual(['In the gap'])
  })
})
