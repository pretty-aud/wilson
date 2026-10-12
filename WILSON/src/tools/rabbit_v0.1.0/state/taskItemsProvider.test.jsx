/** @vitest-environment jsdom */
// =============================================================================
// taskItemsProvider.test.jsx — FX2 (migration 0096): the provider keeps a
// task's items, on the fixtures (the fake cloud, which runs 0096's rules).
//   * ctx.tasks reads each task's five single fields from its items;
//   * addTaskItem / removeTaskItem / reorderTaskItems, each one undo step;
//   * a single link written through updateTask is 0096 §7b's rule as item
//     writes (move, replace, clear), one undo step that puts the items back
//     exactly; a re-send of the same values writes no item;
//   * addTask's links become its first items (a level's too);
//   * a scene's delete takes its items off every task and its undo puts them
//     back;
//   * a backend without items (a cloud before 0096) keeps the old way.
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
const { PROJECT_ID, TASK_ID, ASSET_ID } = await import('../../../dev/fixtures/data/project')
const { fid } = await import('../../../dev/fixtures/ids')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('./RabbitProvider')
const { itemsOfTask } = await import('./taskItemsModel')

let ctx = null
function Probe() { ctx = useRabbit(); return null }
let fx = null

const A = (n) => fid('asset', n)
const SC = (n) => fid('scene', n)
const SH = (n) => fid('shot', n)
const T18 = TASK_ID(18) // Glass and rain rig test: Lighthouse Interior (7), then Sea Spray Comp (12); sc 04; sh 010
const T21 = TASK_ID(21) // Weather cover plan: Cliff Path (8); sc 02, then sc 06
const T5 = TASK_ID(5)

async function mount(adapter) {
  holder.adapter = adapter
  render(<RabbitProvider><Probe /></RabbitProvider>)
  await waitFor(() => expect(ctx?.project?.id).toBe(PROJECT_ID))
}
const task = (id) => ctx.tasks.find(t => t.id === id)
const kinds = (id, kind) => itemsOfTask(ctx.taskItems, id, kind).map(i => i.entity_id)
const run = (fn) => act(async () => { await fn() })
const storeKinds = (id, kind) => itemsOfTask(fx.store.taskItems, id, kind).map(i => i.entity_id)

beforeEach(() => { fx = buildDevFixtures() })
afterEach(() => { cleanup(); ctx = null; fx = null })

describe('ctx.tasks reads its single links from the items', () => {
  it('the backend keeps items, and a task with two assets reads its first as asset_id', async () => {
    await mount(fx.rabbitAdapter())
    expect(ctx.taskItemsAvailable).toBe(true)
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
    expect(task(T18)).toMatchObject({ asset_id: A(7), scene_id: SC(4), shot_id: SH(10) })
    expect(kinds(T21, 'scene')).toEqual([SC(2), SC(6)])
    expect(task(T21).scene_id).toBe(SC(2))
  })

  it('a level\'s and an experience\'s item reach ctx.tasks (the cloud has no column for either)', async () => {
    fx = buildDevFixtures({ variant: 'game' })
    await mount(fx.rabbitAdapter())
    const t17 = task(TASK_ID(17))
    expect(t17.level_id).toBe(fid('level', 2))
    expect(t17.experience_id).toBe(fid('experience', 1))
    // The fake cloud's own row has no such column written.
    expect(fx.store.tasks.find(t => t.id === TASK_ID(17)).level_id ?? null).toBeNull()
  })
})

describe('the three item verbs, each one undo step', () => {
  it('addTaskItem adds a second asset; undo takes it back; redo puts the same row back', async () => {
    await mount(fx.rabbitAdapter())
    let row
    await run(async () => { row = await ctx.addTaskItem({ task_id: T5, entity_type: 'asset', entity_id: A(12) }) })
    expect(kinds(T5, 'asset')).toEqual([ASSET_ID ? task(T5).asset_id : null, A(12)].filter(Boolean))
    expect(storeKinds(T5, 'asset')).toContain(A(12))
    await run(() => ctx.undo())
    expect(kinds(T5, 'asset')).not.toContain(A(12))
    expect(storeKinds(T5, 'asset')).not.toContain(A(12))
    await run(() => ctx.redo())
    expect(ctx.taskItems.find(i => i.id === row.id)).toBeTruthy()
  })

  it('removeTaskItem on the main asset hands "main" to the next; undo puts it back first', async () => {
    await mount(fx.rabbitAdapter())
    const main = itemsOfTask(ctx.taskItems, T18, 'asset')[0]
    await run(() => ctx.removeTaskItem(main.id))
    expect(task(T18).asset_id).toBe(A(12))
    expect(fx.store.tasks.find(t => t.id === T18).asset_id).toBe(A(12))
    await run(() => ctx.undo())
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
    expect(task(T18).asset_id).toBe(A(7))
  })

  it('reorderTaskItems makes the second scene main; undo restores the order', async () => {
    await mount(fx.rabbitAdapter())
    const ids = itemsOfTask(ctx.taskItems, T21, 'scene').map(i => i.id)
    await run(() => ctx.reorderTaskItems(T21, 'scene', [ids[1], ids[0]]))
    expect(kinds(T21, 'scene')).toEqual([SC(6), SC(2)])
    expect(task(T21).scene_id).toBe(SC(6))
    expect(storeKinds(T21, 'scene')).toEqual([SC(6), SC(2)])
    await run(() => ctx.undo())
    expect(kinds(T21, 'scene')).toEqual([SC(2), SC(6)])
  })

  it('refuses an unknown kind in words', async () => {
    await mount(fx.rabbitAdapter())
    await expect(ctx.addTaskItem({ task_id: T5, entity_type: 'phase', entity_id: 'x' })).rejects.toThrow(/not a kind of item/)
  })
})

describe('a single link written through updateTask (the Tasks cell, the Timeline editor, a bid version)', () => {
  it('a new asset REPLACES the main one, and ONE undo puts the items back exactly', async () => {
    await mount(fx.rabbitAdapter())
    const before = itemsOfTask(ctx.taskItems, T18).map(i => `${i.entity_type}:${i.entity_id}:${i.position}`)
    await run(() => ctx.updateTask(T18, { asset_id: A(10) }))
    expect(kinds(T18, 'asset')).toEqual([A(10), A(12)])
    expect(task(T18).asset_id).toBe(A(10))
    await run(() => ctx.undo())
    expect(itemsOfTask(ctx.taskItems, T18).map(i => `${i.entity_type}:${i.entity_id}`).sort())
      .toEqual(before.map(s => s.split(':').slice(0, 2).join(':')).sort())
    expect(task(T18).asset_id).toBe(A(7))
  })

  it('an asset the task already has MOVES first, nothing removed', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.updateTask(T18, { asset_id: A(12) }))
    expect(kinds(T18, 'asset')).toEqual([A(12), A(7)])
  })

  it('a cleared asset removes the main item and the next becomes main', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.updateTask(T18, { asset_id: null }))
    expect(kinds(T18, 'asset')).toEqual([A(12)])
    expect(task(T18).asset_id).toBe(A(12))
  })

  it('a re-send of the same links with another field writes that field and no item', async () => {
    await mount(fx.rabbitAdapter())
    const spy = vi.spyOn(holder.adapter, 'addTaskItem')
    const t = task(T18)
    await run(() => ctx.updateTask(T18, { title: 'Renamed', asset_id: t.asset_id, scene_id: t.scene_id, shot_id: t.shot_id, level_id: null, experience_id: null }))
    expect(task(T18).title).toBe('Renamed')
    expect(spy).not.toHaveBeenCalled()
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
  })

  it('the backend never receives a link field from this client: it gets item writes', async () => {
    await mount(fx.rabbitAdapter())
    const spy = vi.spyOn(holder.adapter, 'patchTask')
    await run(() => ctx.updateTask(T18, { asset_id: A(10), title: 'x' }))
    for (const [, patch] of spy.mock.calls) expect(Object.keys(patch)).not.toContain('asset_id')
  })
})

describe('addTask: a new task\'s links become its first items', () => {
  it('an asset and a scene become items (one undo step for all of it)', async () => {
    await mount(fx.rabbitAdapter())
    let created
    await run(async () => { created = await ctx.addTask({ id: 'fx2-new', title: 'Two things', asset_id: A(3), scene_id: SC(1) }) })
    expect(created).toMatchObject({ id: 'fx2-new', asset_id: A(3), scene_id: SC(1) })
    expect(kinds('fx2-new', 'asset')).toEqual([A(3)])
    expect(kinds('fx2-new', 'scene')).toEqual([SC(1)])
    expect(task('fx2-new')).toMatchObject({ asset_id: A(3), scene_id: SC(1) })
    await run(() => ctx.undo())
    expect(task('fx2-new')).toBeUndefined()
  })

  it('a level link becomes an item on the fake cloud, which has no level column', async () => {
    fx = buildDevFixtures({ variant: 'game' })
    await mount(fx.rabbitAdapter())
    await run(() => ctx.addTask({ id: 'fx2-lv', title: 'A level task', level_id: fid('level', 1) }))
    expect(kinds('fx2-lv', 'level')).toEqual([fid('level', 1)])
    expect(task('fx2-lv').level_id).toBe(fid('level', 1))
  })
})

describe('deletes take items off every task, and their undo puts them back', () => {
  it('deleting scene 06 takes it off task 21 (its second scene); undo puts it back', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.deleteScene(SC(6)))
    expect(kinds(T21, 'scene')).toEqual([SC(2)])
    expect(storeKinds(T21, 'scene')).toEqual([SC(2)])
    await run(() => ctx.undo())
    await waitFor(() => expect(kinds(T21, 'scene')).toEqual([SC(2), SC(6)]))
    expect(storeKinds(T21, 'scene')).toEqual([SC(2), SC(6)])
  })

  it('deleting a task\'s MAIN scene hands main to the next (task 21: sc 02 goes, sc 06 is main)', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.deleteScene(SC(2)))
    expect(task(T21).scene_id).toBe(SC(6))
  })
})

describe('a backend without items (a cloud before 0096) keeps the old way', () => {
  it('updateTask sends the link field to the backend as before, and ctx.tasks is the stored rows', async () => {
    const adapter = fx.rabbitAdapter()
    adapter.taskItemsAvailable = () => false
    await mount(adapter)
    expect(ctx.taskItemsAvailable).toBe(false)
    const spy = vi.spyOn(adapter, 'patchTask')
    await run(() => ctx.updateTask(T5, { asset_id: A(12) }))
    expect(spy.mock.calls.some(([, patch]) => patch.asset_id === A(12))).toBe(true)
    await expect(ctx.addTaskItem({ task_id: T5, entity_type: 'asset', entity_id: A(3) })).rejects.toThrow(/not on this database yet/)
  })
})
