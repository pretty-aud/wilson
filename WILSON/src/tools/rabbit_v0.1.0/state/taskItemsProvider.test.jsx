/** @vitest-environment jsdom */
// =============================================================================
// taskItemsProvider.test.jsx — FX2 (migration 0096): the provider keeps a
// task's items, on the fixtures (the fake cloud, which runs 0096 and 0097's
// rules). VW1m (2026-10-16), her batch 12 ruling: "lets not have main asset
// be a thing". No item of a kind counts for more than another; the contract
// is item 2 of docs/sessions/handoffs/po-vw1m-2026-10-16.md. Pinned here:
//   * ctx.tasks carries no single link field where items are kept (the
//     stored fields where they are not);
//   * addTaskItem / removeTaskItem / setTaskItemsOfKind, each one undo step
//     that puts the exact rows back; reorderTaskItems is gone;
//   * addTask takes `items` lists as well as the single fields (add-only);
//   * updateTask never sends a link field; one in a patch is an older app's
//     write, ADD-ONLY;
//   * deleting an asset never removes a task, even its only asset;
//   * a bid version keeps every item of every kind; its open makes each task's
//     items exactly the version's (an older version adds and removes nothing),
//     the links it left out are said; a re-made task's items are written as
//     items;
//   * history's recreate writes a task's links as items;
//   * a backend without items (a cloud before 0096) keeps the old way.
// =============================================================================

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import React from 'react'
import { cleanup, act, waitFor } from '@testing-library/react'
import { mountRabbit } from './mountRabbit'

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
const { PROJECT_ID, TASK_ID } = await import('../../../dev/fixtures/data/project')
const { fid } = await import('../../../dev/fixtures/ids')
holder.projectId = PROJECT_ID
const { RabbitProvider, useRabbit } = await import('./RabbitProvider')
const { itemsOfTask, LINK_FIELDS } = await import('./taskItemsModel')

let ctx = null
function Probe() { ctx = useRabbit(); return null }
let fx = null

const A = (n) => fid('asset', n)
const SC = (n) => fid('scene', n)
const SH = (n) => fid('shot', n)
const T18 = TASK_ID(18) // Glass and rain rig test: Lighthouse Interior (7), then Sea Spray Comp (12); sc 04; sh 010
const T21 = TASK_ID(21) // Weather cover plan: Cliff Path (8), its only asset; sc 02, then sc 06
const T5 = TASK_ID(5)

async function mount(adapter) {
  holder.adapter = adapter
  await mountRabbit(<RabbitProvider><Probe /></RabbitProvider>, { adapter: holder.adapter, ctx: () => ctx, until: () => expect(ctx?.project?.id).toBe(PROJECT_ID) })
}
const task = (id) => ctx.tasks.find(t => t.id === id)
const kinds = (id, kind) => itemsOfTask(ctx.taskItems, id, kind).map(i => i.entity_id)
const rowsOf = (id, kind) => itemsOfTask(ctx.taskItems, id, kind).map(i => `${i.id}:${i.entity_id}:${i.position}`)
const run = (fn) => act(async () => { await fn() })
const storeKinds = (id, kind) => itemsOfTask(fx.store.taskItems, id, kind).map(i => i.entity_id)
const sorted = (list) => list.slice().sort()

beforeEach(() => { fx = buildDevFixtures() })
afterEach(() => { cleanup(); ctx = null; fx = null })

describe('ctx.tasks carries no single link field where items are kept', () => {
  it('a task with two assets, a scene and a shot carries none of the five; its items say them', async () => {
    await mount(fx.rabbitAdapter())
    expect(ctx.taskItemsAvailable).toBe(true)
    for (const f of LINK_FIELDS) expect(task(T18), f).not.toHaveProperty(f)
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
    expect(kinds(T18, 'scene')).toEqual([SC(4)])
    expect(kinds(T21, 'scene')).toEqual([SC(2), SC(6)])
    // The backend's own row keeps the older apps' copy; ctx.tasks never reads it.
    expect(fx.store.tasks.find(t => t.id === T18).asset_id).toBe(A(7))
  })

  it('a row that did not change keeps its identity across another task\'s write (memoised per row)', async () => {
    await mount(fx.rabbitAdapter())
    const before = task(T18)
    await run(() => ctx.updateTask(T5, { title: 'Renamed elsewhere' }))
    expect(task(T5).title).toBe('Renamed elsewhere')
    expect(task(T18)).toBe(before)
  })

  it('a level\'s and an experience\'s item are items, never fields (the cloud has no column for either)', async () => {
    fx = buildDevFixtures({ variant: 'game' })
    await mount(fx.rabbitAdapter())
    expect(task(TASK_ID(17))).not.toHaveProperty('level_id')
    expect(kinds(TASK_ID(17), 'level')).toEqual([fid('level', 2)])
    expect(kinds(TASK_ID(17), 'experience')).toEqual([fid('experience', 1)])
  })

  it('CONTROL: a backend without items hands the stored rows, each field the task\'s one item of its kind', async () => {
    const adapter = fx.rabbitAdapter()
    adapter.taskItemsAvailable = () => false
    await mount(adapter)
    expect(ctx.taskItemsAvailable).toBe(false)
    expect(task(T18).asset_id).toBe(A(7))
  })
})

describe('the item verbs, each one undo step that puts the exact rows back', () => {
  it('addTaskItem adds a second asset; undo takes it back; redo puts the same row back', async () => {
    await mount(fx.rabbitAdapter())
    const had = kinds(T5, 'asset')
    let row
    await run(async () => { row = await ctx.addTaskItem({ task_id: T5, entity_type: 'asset', entity_id: A(12) }) })
    expect(kinds(T5, 'asset')).toEqual([...had, A(12)])
    expect(storeKinds(T5, 'asset')).toContain(A(12))
    await run(() => ctx.undo())
    expect(kinds(T5, 'asset')).toEqual(had)
    expect(storeKinds(T5, 'asset')).not.toContain(A(12))
    await run(() => ctx.redo())
    expect(ctx.taskItems.find(i => i.id === row.id)).toBeTruthy()
  })

  it('removeTaskItem on the first asset hands nothing on: the other stays as it was; undo puts the same row back', async () => {
    await mount(fx.rabbitAdapter())
    const before = rowsOf(T18, 'asset')
    const first = itemsOfTask(ctx.taskItems, T18, 'asset')[0]
    await run(() => ctx.removeTaskItem(first.id))
    expect(rowsOf(T18, 'asset')).toEqual([before[1]])
    // The older apps' copy reads the next one, on the backend's row only.
    expect(fx.store.tasks.find(t => t.id === T18).asset_id).toBe(A(12))
    await run(() => ctx.undo())
    expect(rowsOf(T18, 'asset')).toEqual(before)
  })

  it('refuses an unknown kind in words', async () => {
    await mount(fx.rabbitAdapter())
    await expect(ctx.addTaskItem({ task_id: T5, entity_type: 'phase', entity_id: 'x' })).rejects.toThrow(/not a kind of item/)
    await expect(ctx.setTaskItemsOfKind(T5, 'phase', ['x'])).rejects.toThrow(/not a kind of item/)
  })

  it('reorderTaskItems is gone (her Q-N1: no Move buttons; nothing else ordered a task\'s items)', async () => {
    await mount(fx.rabbitAdapter())
    expect(ctx.reorderTaskItems).toBeUndefined()
    expect(typeof ctx.setTaskItemsOfKind).toBe('function')
  })
})

describe('setTaskItemsOfKind — a drop on a group or a row, a version\'s open', () => {
  it('makes the kind exactly the ids: the others go, the missing are added at the end, the kept never move', async () => {
    await mount(fx.rabbitAdapter())
    const kept = rowsOf(T18, 'asset')[1] // Sea Spray Comp's row
    await run(() => ctx.setTaskItemsOfKind(T18, 'asset', [A(12), A(3)]))
    expect(kinds(T18, 'asset')).toEqual([A(12), A(3)])
    expect(rowsOf(T18, 'asset')[0]).toBe(kept)
    expect(storeKinds(T18, 'asset')).toEqual([A(12), A(3)])
    // Another kind is untouched.
    expect(kinds(T18, 'scene')).toEqual([SC(4)])
  })

  it('is ONE undo step that puts back the exact rows (same ids and positions); redo makes it again', async () => {
    await mount(fx.rabbitAdapter())
    const before = rowsOf(T18, 'asset')
    await run(() => ctx.setTaskItemsOfKind(T18, 'asset', [A(3)]))
    expect(kinds(T18, 'asset')).toEqual([A(3)])
    await run(() => ctx.undo())
    expect(rowsOf(T18, 'asset')).toEqual(before)
    expect(storeKinds(T18, 'asset')).toEqual([A(7), A(12)])
    await run(() => ctx.redo())
    expect(kinds(T18, 'asset')).toEqual([A(3)])
    expect(storeKinds(T18, 'asset')).toEqual([A(3)])
  })

  it('an empty list takes every item of the kind off ("No asset"), and its undo puts them back', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.setTaskItemsOfKind(T18, 'asset', []))
    expect(kinds(T18, 'asset')).toEqual([])
    await run(() => ctx.undo())
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
  })

  it('the same set in another order writes nothing and records no step', async () => {
    await mount(fx.rabbitAdapter())
    const add = vi.spyOn(holder.adapter, 'addTaskItem')
    const del = vi.spyOn(holder.adapter, 'deleteTaskItem')
    const could = ctx.canUndo
    await run(() => ctx.setTaskItemsOfKind(T18, 'asset', [A(12), A(7)]))
    expect(add).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    expect(ctx.canUndo).toBe(could)
  })

  // VW1m review round 1 (R1-1): a drop on the Tasks table or the Board passes
  // the group's LIVE ids only; an item whose row is in the trash is hidden
  // from every screen (her Q-N4: back on restore), so no caller can name it
  // and the set must never take it off.
  it('R1-1: an item whose row is in the trash is kept: a drop on another asset leaves it, and it shows again on restore', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.deleteAsset(A(12)))
    expect(ctx.assets.some(a => a.id === A(12))).toBe(false)
    // What a drop on Harbour Wall's group passes: its one live id.
    await run(() => ctx.setTaskItemsOfKind(T18, 'asset', [A(3)]))
    expect(sorted(kinds(T18, 'asset'))).toEqual(sorted([A(3), A(12)]))
    expect(sorted(storeKinds(T18, 'asset'))).toEqual(sorted([A(3), A(12)]))
    await run(() => holder.adapter.restoreAsset(A(12)))
    await run(() => ctx.reloadActiveProject())
    expect(ctx.assets.some(a => a.id === A(12))).toBe(true)
    expect(sorted(kinds(T18, 'asset'))).toEqual(sorted([A(3), A(12)]))
  })
  it('R1-1 CONTROL: a live item the ids leave out still goes', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.setTaskItemsOfKind(T18, 'asset', [A(3)]))
    expect(kinds(T18, 'asset')).toEqual([A(3)])
  })

  // VW1m review round 1 (R1-5): runWithUndoToast asks its step to queue in
  // the undo queue before its first await, as the version steps do. A drop
  // made while an undo still ran wrote beside it: the replay (history
  // `suspended`) recorded none of its step, and no toast was offered.
  it('R1-5: a drop made while an undo is running waits its turn: its step is recorded, its toast offered, and its Undo takes it back', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.addTaskItem({ task_id: T5, entity_type: 'asset', entity_id: A(12) }))
    let release
    const gate = new Promise((r) => { release = r })
    const del = holder.adapter.deleteTaskItem.bind(holder.adapter)
    vi.spyOn(holder.adapter, 'deleteTaskItem').mockImplementationOnce(async (...args) => { await gate; return del(...args) })
    let undoing = null
    let dropping = null
    // The undo of the add is held open: its delete waits on the gate.
    await act(async () => { undoing = ctx.undo() })
    await act(async () => {
      dropping = ctx.runWithUndoToast(() => ctx.setTaskItemsOfKind(T18, 'asset', [A(3)]), 'Moved "Glass and rain rig test" to Harbour Wall')
    })
    await act(async () => { release(); await undoing; await dropping })
    expect(kinds(T5, 'asset')).not.toContain(A(12))
    expect(kinds(T18, 'asset')).toEqual([A(3)])
    expect(ctx.undoToast?.message).toBe('Moved "Glass and rain rig test" to Harbour Wall')
    await run(() => ctx.undo())
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
  })
})

describe('addTask — a new task\'s links become its items', () => {
  it('an `items` list per kind (a task made from a combination row): every id an item, in the order given; one undo for all of it', async () => {
    await mount(fx.rabbitAdapter())
    let created
    await run(async () => { created = await ctx.addTask({ id: 'vw-new', title: 'From a row', items: { asset: [A(7), A(12)], scene: [SC(1)] } }) })
    for (const f of LINK_FIELDS) expect(created, f).not.toHaveProperty(f)
    expect(kinds('vw-new', 'asset')).toEqual([A(7), A(12)])
    expect(kinds('vw-new', 'scene')).toEqual([SC(1)])
    expect(storeKinds('vw-new', 'asset')).toEqual([A(7), A(12)])
    for (const f of LINK_FIELDS) expect(task('vw-new'), f).not.toHaveProperty(f)
    await run(() => ctx.undo())
    expect(task('vw-new')).toBeUndefined()
    expect(kinds('vw-new', 'asset')).toEqual([])
  })

  it('the single fields are still taken (a template, intake, the New task forms), each made an item, add-only beside a list', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.addTask({ id: 'vw-one', title: 'One of each', asset_id: A(3), scene_id: SC(1) }))
    expect(kinds('vw-one', 'asset')).toEqual([A(3)])
    expect(kinds('vw-one', 'scene')).toEqual([SC(1)])
    await run(() => ctx.addTask({ id: 'vw-both', title: 'Both', asset_id: A(3), items: { asset: [A(3), A(7)] } }))
    expect(kinds('vw-both', 'asset')).toEqual([A(3), A(7)])
  })

  it('a level link becomes an item on the fake cloud, which has no level column', async () => {
    fx = buildDevFixtures({ variant: 'game' })
    await mount(fx.rabbitAdapter())
    await run(() => ctx.addTask({ id: 'fx2-lv', title: 'A level task', items: { level: [fid('level', 1), fid('level', 2)] } }))
    expect(kinds('fx2-lv', 'level')).toEqual([fid('level', 1), fid('level', 2)])
  })

  // FX2 review round 2 (R2-4): a refused item takes the new task back out.
  it('R2-4: an item the backend refuses takes the new task back out, and the refusal is said', async () => {
    await mount(fx.rabbitAdapter())
    let err = null
    await act(async () => { try { await ctx.addTask({ id: 'r2-bare', title: 'Agent task', items: { asset: [A(3), 'f1c70000-0005-4000-8000-0000000009ff'] } }) } catch (e) { err = e } })
    expect(err).not.toBeNull()
    expect(task('r2-bare')).toBeUndefined()
    const stored = fx.store.tasks.find(t => t.id === 'r2-bare')
    expect(!stored || !!stored.deleted_at).toBe(true)
  })

  it('CONTROL: a backend without items stores one link per kind, the field or else the first of the list', async () => {
    const adapter = fx.rabbitAdapter()
    adapter.taskItemsAvailable = () => false
    await mount(adapter)
    const spy = vi.spyOn(adapter, 'upsertTask')
    await run(() => ctx.addTask({ id: 'vw-old', title: 'Old cloud', items: { asset: [A(12), A(7)] }, scene_id: SC(1) }))
    const [row] = spy.mock.calls[0]
    expect(row).toMatchObject({ asset_id: A(12), scene_id: SC(1) })
    expect(row).not.toHaveProperty('items')
  })
})

describe('updateTask never sends a link field; one in a patch is an older app\'s write, ADD-ONLY', () => {
  it('a new asset is ADDED at the end; nothing is removed or moved; ONE undo puts the items back exactly', async () => {
    await mount(fx.rabbitAdapter())
    const before = rowsOf(T18, 'asset')
    await run(() => ctx.updateTask(T18, { asset_id: A(10) }))
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12), A(10)])
    await run(() => ctx.undo())
    expect(rowsOf(T18, 'asset')).toEqual(before)
  })

  it('an asset the task already has writes nothing (it never moves first)', async () => {
    await mount(fx.rabbitAdapter())
    const spy = vi.spyOn(holder.adapter, 'addTaskItem')
    await run(() => ctx.updateTask(T18, { asset_id: A(12) }))
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
    expect(spy).not.toHaveBeenCalled()
  })

  it('a cleared field removes only the item it named for an older app (the first added); the other stays', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.updateTask(T18, { asset_id: null }))
    expect(kinds(T18, 'asset')).toEqual([A(12)])
  })

  it('the backend never receives a link field from this client: it gets the other fields and item writes', async () => {
    await mount(fx.rabbitAdapter())
    const spy = vi.spyOn(holder.adapter, 'patchTask')
    await run(() => ctx.updateTask(T18, { asset_id: A(10), title: 'x' }))
    expect(spy).toHaveBeenCalled()
    for (const [, patch] of spy.mock.calls) for (const f of LINK_FIELDS) expect(Object.keys(patch)).not.toContain(f)
    expect(task(T18).title).toBe('x')
  })

  it('FX2\'s R2-3 refusal is gone: clearing the first asset while the other is in the trash writes, and the task stays', async () => {
    await mount(fx.rabbitAdapter())
    const i = fx.store.assets.findIndex(x => x.id === A(12))
    fx.store.assets[i] = { ...fx.store.assets[i], deleted_at: new Date().toISOString() }
    await run(() => ctx.reloadActiveProject())
    await run(() => ctx.updateTask(T18, { title: 'Saved whole', asset_id: null }))
    expect(task(T18).title).toBe('Saved whole')
    expect(kinds(T18, 'asset')).toEqual([A(12)])
  })
})

// FX2 review round 1 (R1-1): the desktop's adapter has no patchTask, so a
// task edit re-sends the whole row; with items on it carries no link field.
describe('R1-1: a backend that takes the whole task row (the desktop: no patchTask)', () => {
  const wholeRow = () => {
    const a = fx.rabbitAdapter()
    delete a.patchTask
    expect(a.patchTask).toBeUndefined()
    return a
  }

  it('removing the first asset, then a title edit: the item stays removed, on the screen and in the store', async () => {
    await mount(wholeRow())
    const first = itemsOfTask(ctx.taskItems, T18, 'asset')[0]
    await run(() => ctx.removeTaskItem(first.id))
    await run(() => ctx.updateTask(T18, { title: 'Renamed' }))
    expect(storeKinds(T18, 'asset')).toEqual([A(12)])
    expect(kinds(T18, 'asset')).toEqual([A(12)])
    expect(fx.store.tasks.find(t => t.id === T18)).toMatchObject({ title: 'Renamed', asset_id: A(12) })
  })

  it('a task made without an asset keeps the one added after it, through a date edit', async () => {
    await mount(wholeRow())
    await run(() => ctx.addTask({ id: 'fx2-bare', title: 'Bare' }))
    await run(() => ctx.addTaskItem({ task_id: 'fx2-bare', entity_type: 'asset', entity_id: A(3) }))
    await run(() => ctx.updateTask('fx2-bare', { start_date: '2026-10-20' }))
    expect(storeKinds('fx2-bare', 'asset')).toEqual([A(3)])
  })

  it('the whole row it receives carries no single link while items are on', async () => {
    const a = wholeRow()
    await mount(a)
    const spy = vi.spyOn(a, 'upsertTask')
    await run(() => ctx.updateTask(T18, { title: 'x' }))
    expect(spy).toHaveBeenCalled()
    for (const [row] of spy.mock.calls) for (const f of LINK_FIELDS) expect(row, f).not.toHaveProperty(f)
  })
})

// VW1m (2026-10-16), her Q-M2: "The tasks stay (Recommended)". Deleting an
// asset took the tasks whose MAIN asset it was off the screen, on every
// backend; the desktop brought them back at the next read.
describe('deleting an asset never removes a task', () => {
  it('a soft delete (the cloud, the fixtures): the task stays, its item kept (hidden while the asset is in the trash); undo restores the asset', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.deleteAsset(A(7)))
    expect(ctx.assets.some(a => a.id === A(7))).toBe(false)
    expect(task(T18)).toBeTruthy()
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
    expect(fx.store.tasks.find(t => t.id === T18).deleted_at ?? null).toBeNull()
    expect(ctx.undoToast?.message).toBe('Deleted asset "Lighthouse Interior". Its tasks stay.')
    await run(() => ctx.undo())
    expect(ctx.assets.some(a => a.id === A(7))).toBe(true)
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
  })

  it('even when it is the task\'s only asset (task 21, Cliff Path)', async () => {
    await mount(fx.rabbitAdapter())
    expect(kinds(T21, 'asset')).toEqual([A(8)])
    await run(() => ctx.deleteAsset(A(8)))
    expect(task(T21)).toBeTruthy()
    await run(() => ctx.reloadActiveProject())
    expect(task(T21)).toBeTruthy()
  })

  it('a bulk delete the same, and its toast says their tasks stay', async () => {
    await mount(fx.rabbitAdapter())
    const n = ctx.tasks.length
    await run(() => ctx.deleteAssets([A(7), A(8)]))
    expect(ctx.tasks).toHaveLength(n)
    expect(ctx.undoToast?.message).toBe('Deleted 2 assets. Their tasks stay.')
  })

  // FX2 review round 2 (R2-6): where the delete removes the row (the Local
  // Server), the asset's items leave every task at once; Undo puts them back.
  it('where the delete removes the row: the task stays, the asset\'s items leave it, and Undo puts back the exact rows', async () => {
    const a = fx.rabbitAdapter()
    delete a.restoreAsset
    await mount(a)
    const before = rowsOf(T18, 'asset')
    await run(() => ctx.deleteAsset(A(12)))
    expect(task(T18)).toBeTruthy()
    expect(kinds(T18, 'asset')).toEqual([A(7)])
    await run(() => ctx.undo())
    await waitFor(() => expect(rowsOf(T18, 'asset')).toEqual(before))
  })

  it('and a bulk delete the same', async () => {
    const a = fx.rabbitAdapter()
    delete a.restoreAsset
    await mount(a)
    await run(() => ctx.deleteAssets([A(12)]))
    expect(task(T18)).toBeTruthy()
    expect(kinds(T18, 'asset')).toEqual([A(7)])
  })
})

describe('deletes of a scene take its items off every task, and their undo puts them back', () => {
  it('deleting scene 06 takes it off task 21 (its second scene); undo puts it back', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.deleteScene(SC(6)))
    expect(kinds(T21, 'scene')).toEqual([SC(2)])
    expect(storeKinds(T21, 'scene')).toEqual([SC(2)])
    await run(() => ctx.undo())
    await waitFor(() => expect(kinds(T21, 'scene')).toEqual([SC(2), SC(6)]))
    expect(storeKinds(T21, 'scene')).toEqual([SC(2), SC(6)])
  })

  it('deleting a task\'s first scene hands nothing on: its other scene stays its item, and ctx.tasks carries no scene_id', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.deleteScene(SC(2)))
    expect(kinds(T21, 'scene')).toEqual([SC(6)])
    expect(task(T21)).not.toHaveProperty('scene_id')
  })
})

// Q-N7 (batch 16, not yet asked; interim: a version keeps every item of
// every kind). FX2's R2-1 (a task brought back keeps its links through Save
// and the next open) holds for every item now.
const freeBudget = () => {
  const proj = fx.store.projects.find(p => p.id === PROJECT_ID)
  proj.budget_active = false; proj.budget_active_version_id = null; proj.budget_finalized = false; proj.open_budget_version_id = null
}
const snapTask = (v, id) => (fx.store.budgetVersions.find(x => x.id === v.id).snapshot.tasks || []).find(t => t.id === id)
const T18_ITEMS = () => ({ asset: sorted([A(7), A(12)]), scene: [SC(4)], shot: [SH(10)], level: [], experience: [] })

describe('a bid version keeps every item of every kind', () => {
  it('a snapshot keeps each task\'s items (ids sorted) beside the older apps\' copy', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-items', roleRates: {} }) })
    expect(snapTask(v, T18).items).toEqual(T18_ITEMS())
    expect(snapTask(v, T18)).toMatchObject({ asset_id: A(7), scene_id: SC(4), shot_id: SH(10) })
  })

  it('opening a version makes each task\'s items exactly the version\'s; ONE undo takes the open back', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-exact', roleRates: {} }) })
    await run(() => ctx.setTaskItemsOfKind(T18, 'asset', [A(7), A(3)]))
    await run(() => ctx.openBudgetVersion(v.id, { roleRates: {} }))
    expect(sorted(kinds(T18, 'asset'))).toEqual(sorted([A(7), A(12)]))
    expect(sorted(storeKinds(T18, 'asset'))).toEqual(sorted([A(7), A(12)]))
    await run(() => ctx.undo())
    expect(sorted(kinds(T18, 'asset'))).toEqual(sorted([A(7), A(3)]))
  })

  it('a version saved before (no items) puts its saved item back where the task lost it, and removes nothing', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-older', roleRates: {} }) })
    // Saved before VW1m: no `items`, the single fields only.
    const stored = fx.store.budgetVersions.find(x => x.id === v.id)
    stored.snapshot = { ...stored.snapshot, tasks: stored.snapshot.tasks.map(({ items, ...t }) => (t.id === T18 ? { ...t, asset_id: A(3) } : t)) }
    await run(() => ctx.reloadActiveProject())
    await run(() => ctx.setTaskItemsOfKind(T18, 'scene', []))
    await run(() => ctx.openBudgetVersion(v.id, { roleRates: {} }))
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12), A(3)])
    expect(kinds(T18, 'scene')).toEqual([SC(4)])
  })

  it('the links an open leaves out are counted and said in its message', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-gone', roleRates: {} }) })
    // Since the save, Sea Spray Comp came off task 18 and was deleted.
    await run(() => ctx.setTaskItemsOfKind(T18, 'asset', [A(7)]))
    await run(() => ctx.deleteAsset(A(12)))
    let out
    await run(async () => { out = await ctx.runWithUndoToast(() => ctx.openBudgetVersion(v.id, { roleRates: {} }), 'Editing “V-gone”') })
    expect(out.plan.droppedLinks).toBe(1)
    expect(kinds(T18, 'asset')).toEqual([A(7)])
    expect(ctx.undoToast?.message).toMatch(/^Editing “V-gone”\. 1 link was left out: what it names is no longer in the project\.$/)
  })

  it('an asset in the trash the task still has is kept by an open, never counted as left out', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-trash', roleRates: {} }) })
    await run(() => ctx.deleteAsset(A(12)))
    let out
    await run(async () => { out = await ctx.openBudgetVersion(v.id, { roleRates: {} }) })
    expect(out.plan.droppedLinks).toBe(0)
    expect(out.note).toBe('')
    expect(storeKinds(T18, 'asset')).toEqual([A(7), A(12)])
  })

  // VW1m review round 1 (R1-1): the provider keeps a hidden item on every
  // set, so an open keeps one the version never held too.
  it('R1-1: an asset in the trash the version never held is kept by an open (hidden, back on restore)', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-hidden', roleRates: {} }) })
    await run(() => ctx.addTaskItem({ task_id: T18, entity_type: 'asset', entity_id: A(3) }))
    await run(() => ctx.deleteAsset(A(3)))
    let out
    await run(async () => { out = await ctx.openBudgetVersion(v.id, { roleRates: {} }) })
    expect(storeKinds(T18, 'asset')).toEqual([A(7), A(12), A(3)])
    expect(out.plan.droppedLinks).toBe(0)
  })

  // VW1m review round 2 (R2-1): the compare read every item a task has, a
  // hidden one too, so an asset added and then deleted left the open version
  // "unsaved" though nothing on screen differed, and no open could clear it
  // (an open keeps a hidden item, R1-1). A snapshot and every compare read
  // the task's LIVE items only, on both sides.
  const unsavedNow = (v) => ctx.previewOpenBudgetVersion(v.id, { roleRates: {} }).unsaved
  it('R2-1: an asset added and then deleted is no unsaved change: the version reads saved, and still after its open', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-r2-1', roleRates: {} }) })
    expect(unsavedNow(v)).toBeNull()
    await run(() => ctx.addTaskItem({ task_id: T18, entity_type: 'asset', entity_id: A(3) }))
    expect(unsavedNow(v)?.kind).toBe('open')
    await run(() => ctx.deleteAsset(A(3)))
    expect(unsavedNow(v)).toBeNull()
    await run(() => ctx.openBudgetVersion(v.id, { roleRates: {} }))
    expect(unsavedNow(v)).toBeNull()
    // The open still keeps the hidden item (R1-1).
    expect(storeKinds(T18, 'asset')).toEqual([A(7), A(12), A(3)])
  })
  it('R2-1 CONTROL: restoring that asset is a change the person can see: the version reads unsaved', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-r2-1c', roleRates: {} }) })
    await run(() => ctx.addTaskItem({ task_id: T18, entity_type: 'asset', entity_id: A(3) }))
    await run(() => ctx.deleteAsset(A(3)))
    await run(() => holder.adapter.restoreAsset(A(3)))
    await run(() => ctx.reloadActiveProject())
    expect(ctx.assets.some(a => a.id === A(3))).toBe(true)
    expect(unsavedNow(v)?.kind).toBe('open')
  })
  it('R2-1: a version saved with an asset now in the trash reads saved (no open could show it), and unsaved once it is back off the task', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-r2-1s', roleRates: {} }) })
    await run(() => ctx.deleteAsset(A(12)))
    expect(unsavedNow(v)).toBeNull()
    let out
    await run(async () => { out = await ctx.openBudgetVersion(v.id, { roleRates: {} }) })
    expect(out.plan.droppedLinks).toBe(0)
    expect(unsavedNow(v)).toBeNull()
    expect(storeKinds(T18, 'asset')).toEqual([A(7), A(12)])
    // A live change still counts.
    await run(() => ctx.setTaskItemsOfKind(T18, 'asset', []))
    expect(unsavedNow(v)?.kind).toBe('open')
  })

  it('Edit this version revives a trashed task: its items are read, Save records them, the next open keeps them', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-before', roleRates: {} }) })
    { const i = fx.store.tasks.findIndex(x => x.id === T18); fx.store.tasks[i] = { ...fx.store.tasks[i], deleted_at: new Date().toISOString() } }
    await run(() => ctx.reloadActiveProject())
    expect(task(T18)).toBeUndefined()
    await run(() => ctx.openBudgetVersion(v.id, { roleRates: {} }))
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
    await run(() => ctx.saveBudgetVersion(v.id, { roleRates: {} }))
    expect(snapTask(v, T18).items).toEqual(T18_ITEMS())
    await run(() => ctx.reloadActiveProject())
    await run(() => ctx.openBudgetVersion(v.id, { roleRates: {} }))
    expect(storeKinds(T18, 'asset')).toEqual([A(7), A(12)])
    expect(storeKinds(T18, 'scene')).toEqual([SC(4)])
    expect(storeKinds(T18, 'shot')).toEqual([SH(10)])
  })

  it('a re-made task (the desktop: its row and items gone) gets every item written as items, the row none of its links', async () => {
    fx = buildDevFixtures({ variant: 'game' })
    freeBudget()
    const a = fx.rabbitAdapter()
    delete a.restoreTask; delete a.patchTask
    await mount(a)
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-desk', roleRates: {} }) })
    expect(snapTask(v, T18).items.level).toEqual(sorted([fid('level', 2), fid('level', 3)]))
    fx.store.tasks = fx.store.tasks.filter(x => x.id !== T18)
    fx.store.taskItems = fx.store.taskItems.filter(i => i.task_id !== T18)
    await run(() => ctx.reloadActiveProject())
    const spy = vi.spyOn(a, 'upsertTask')
    await run(() => ctx.openBudgetVersion(v.id, { roleRates: {} }))
    const remade = spy.mock.calls.map(([row]) => row).find(row => row.id === T18)
    for (const f of LINK_FIELDS) expect(remade, f).not.toHaveProperty(f)
    expect(sorted(storeKinds(T18, 'asset'))).toEqual(sorted([A(7), A(12)]))
    expect(storeKinds(T18, 'scene')).toEqual([SC(4)])
    expect(storeKinds(T18, 'shot')).toEqual([SH(10)])
    expect(sorted(storeKinds(T18, 'level'))).toEqual(sorted([fid('level', 2), fid('level', 3)]))
    expect(storeKinds(T18, 'experience')).toEqual([fid('experience', 2)])
  })

  // FX2's R2-1, the narrowing alone: when the items of a task brought back
  // cannot be read (offline), the snapshot keeps its row's own links (the
  // older shape), which an open only adds from.
  it('R2-1: Ctrl+Z after a refetch with the items read failing: Save as new version keeps the row\'s links, without `items`', async () => {
    freeBudget()
    const a = fx.rabbitAdapter()
    await mount(a)
    await run(() => ctx.deleteTask(T18))
    await run(() => ctx.reloadActiveProject())
    a.listTaskItems = async () => { throw new Error('offline') }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await run(() => ctx.undo())
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-offline', roleRates: {} }) })
    expect(snapTask(v, T18)).not.toHaveProperty('items')
    expect(snapTask(v, T18)).toMatchObject({ asset_id: A(7), scene_id: SC(4), shot_id: SH(10) })
  })
})

describe('edit history\'s recreate writes a task\'s links as items', () => {
  it('a hard-deleted task recreated from its snapshot gets its asset and scene as items, its row none', async () => {
    await mount(fx.rabbitAdapter())
    await run(() => ctx.revertHistoryEntry({
      entity_type: 'tasks', entity_id: 'hx-1', action: 'delete',
      diff: { old: { id: 'hx-1', project_id: PROJECT_ID, title: 'From history', asset_id: A(3), scene_id: SC(1) } },
    }))
    expect(task('hx-1')).toBeTruthy()
    for (const f of LINK_FIELDS) expect(task('hx-1'), f).not.toHaveProperty(f)
    expect(kinds('hx-1', 'asset')).toEqual([A(3)])
    expect(kinds('hx-1', 'scene')).toEqual([SC(1)])
  })
})

describe('a backend without items (a cloud before 0096) keeps the old way', () => {
  it('updateTask sends the link field to the backend as before, and the item verbs refuse in words', async () => {
    const adapter = fx.rabbitAdapter()
    adapter.taskItemsAvailable = () => false
    await mount(adapter)
    expect(ctx.taskItemsAvailable).toBe(false)
    const spy = vi.spyOn(adapter, 'patchTask')
    await run(() => ctx.updateTask(T5, { asset_id: A(12) }))
    expect(spy.mock.calls.some(([, patch]) => patch.asset_id === A(12))).toBe(true)
    await expect(ctx.addTaskItem({ task_id: T5, entity_type: 'asset', entity_id: A(3) })).rejects.toThrow(/cannot keep several assets, scenes or shots on a task yet/)
    await expect(ctx.setTaskItemsOfKind(T5, 'asset', [A(3)])).rejects.toThrow(/migration 0096 is not on it/)
  })
})
