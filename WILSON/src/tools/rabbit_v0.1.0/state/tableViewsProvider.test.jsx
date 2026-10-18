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
//     the grouping as it was;
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

async function mount(adapter) {
  holder.adapter = adapter
  render(<RabbitProvider><Probe /></RabbitProvider>)
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
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
    await waitFor(() => expect(fx.store.itemGroupings.find(x => x.id === g.id)?.entity_ids).toEqual([SC(5), SC(6)].sort()))
    expect(ctx.groupingsOf('tasks', 'scene').find(x => x.id === g.id)?.entity_ids).toEqual([SC(5), SC(6)].sort())
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
