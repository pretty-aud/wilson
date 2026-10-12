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

// Review round 1, R1-1: the desktop's adapter has no patchTask, so a task
// edit re-sends the whole row. Before the fix it carried the row's single
// links as they were when the bundle loaded, and the Local Server ran 0096
// §7b's rule on them: an edit after an item change put back a removed item,
// undid a reorder, or removed an item the task had gained. The fixtures run
// the same rule, so the fixtures adapter without patchTask stands in for it.
describe('R1-1: a backend that takes the whole task row (the desktop: no patchTask)', () => {
  const wholeRow = () => {
    const a = fx.rabbitAdapter()
    delete a.patchTask
    expect(a.patchTask).toBeUndefined()
    return a
  }

  it('removing the main asset, then a title edit: the item stays removed, on the screen and in the store', async () => {
    await mount(wholeRow())
    const main = itemsOfTask(ctx.taskItems, T18, 'asset')[0]
    await run(() => ctx.removeTaskItem(main.id))
    await run(() => ctx.updateTask(T18, { title: 'Renamed' }))
    expect(storeKinds(T18, 'asset')).toEqual([A(12)])
    expect(kinds(T18, 'asset')).toEqual([A(12)])
    expect(fx.store.tasks.find(t => t.id === T18)).toMatchObject({ title: 'Renamed', asset_id: A(12) })
  })

  it('reordering, then a status edit: the new order holds', async () => {
    await mount(wholeRow())
    const ids = itemsOfTask(ctx.taskItems, T18, 'asset').map(i => i.id)
    await run(() => ctx.reorderTaskItems(T18, 'asset', [ids[1], ids[0]]))
    await run(() => ctx.updateTask(T18, { status: 'in_progress' }))
    expect(storeKinds(T18, 'asset')).toEqual([A(12), A(7)])
    expect(fx.store.tasks.find(t => t.id === T18).asset_id).toBe(A(12))
  })

  it('a task made without an asset keeps the one added after it, through a date edit', async () => {
    await mount(wholeRow())
    await run(() => ctx.addTask({ id: 'fx2-bare', title: 'Bare' }))
    await run(() => ctx.addTaskItem({ task_id: 'fx2-bare', entity_type: 'asset', entity_id: A(3) }))
    await run(() => ctx.updateTask('fx2-bare', { start_date: '2026-10-20' }))
    expect(storeKinds('fx2-bare', 'asset')).toEqual([A(3)])
    expect(task('fx2-bare').asset_id).toBe(A(3))
  })

  it('the whole row it receives carries no single link while items are on', async () => {
    const a = wholeRow()
    await mount(a)
    const spy = vi.spyOn(a, 'upsertTask')
    await run(() => ctx.updateTask(T18, { title: 'x' }))
    expect(spy).toHaveBeenCalled()
    for (const [row] of spy.mock.calls) {
      for (const f of ['asset_id', 'scene_id', 'shot_id', 'level_id', 'experience_id']) expect(row, f).not.toHaveProperty(f)
    }
  })
})

// R1-1, the second half: the rows behind ctx.tasks keep their single links
// equal to the items, so a reader of the raw rows (deleteAsset's capture of
// the tasks it takes with an asset) sees the task's main asset.
describe('R1-1: the rows behind ctx.tasks keep their links in step with the items', () => {
  it('after a reorder makes the second asset main, deleting the first asset leaves the task on the screen', async () => {
    await mount(fx.rabbitAdapter())
    const ids = itemsOfTask(ctx.taskItems, T18, 'asset').map(i => i.id)
    await run(() => ctx.reorderTaskItems(T18, 'asset', [ids[1], ids[0]]))
    await run(() => ctx.deleteAsset(A(7)))
    expect(task(T18)).toBeTruthy()
    expect(task(T18).asset_id).toBe(A(12))
  })
})

// Review round 2. R2-1 (high): round 1's bundle wrapper re-read EVERY task
// row's links from the items, so a task the backend brought back while its
// items were not in the bundle (a bid version's open reviving it; Ctrl+Z of
// a trashed task after a refetch) read no links; Save recorded none and the
// next open removed its items. Now only tasks whose items changed are
// re-read, and a task the backend brings back has its items read.
const freeBudget = () => {
  const proj = fx.store.projects.find(p => p.id === PROJECT_ID)
  proj.budget_active = false; proj.budget_active_version_id = null; proj.budget_finalized = false; proj.open_budget_version_id = null
}
const linksOf = (t) => [t?.asset_id ?? null, t?.scene_id ?? null, t?.shot_id ?? null]
const snapLinks = (v, id) => linksOf((fx.store.budgetVersions.find(x => x.id === v.id).snapshot.tasks || []).find(t => t.id === id))
const MAINS = () => [A(7), SC(4), SH(10)]

describe('R2-1: a task the backend brings back keeps its links, and the bid snapshot records them', () => {
  it('Edit this version revives a trashed task: its items are read, Save records its links, the next open keeps its items', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-before', roleRates: {} }) })
    expect(snapLinks(v, T18)).toEqual(MAINS())
    // Another window put T18 in the trash; a later read does not see its items.
    { const i = fx.store.tasks.findIndex(x => x.id === T18); fx.store.tasks[i] = { ...fx.store.tasks[i], deleted_at: new Date().toISOString() } }
    await run(() => ctx.reloadActiveProject())
    expect(task(T18)).toBeUndefined()
    await run(() => ctx.openBudgetVersion(v.id, { roleRates: {} }))
    expect(linksOf(task(T18))).toEqual(MAINS())
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
    await run(() => ctx.saveBudgetVersion(v.id, { roleRates: {} }))
    expect(snapLinks(v, T18)).toEqual(MAINS())
    await run(() => ctx.reloadActiveProject())
    await run(() => ctx.openBudgetVersion(v.id, { roleRates: {} }))
    expect(storeKinds(T18, 'asset')).toEqual([A(7), A(12)])
    expect(storeKinds(T18, 'scene')).toEqual([SC(4)])
    expect(storeKinds(T18, 'shot')).toEqual([SH(10)])
  })

  it('Ctrl+Z of a trashed task after a refetch: its items are read, and Save as new version records its links', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    await run(() => ctx.deleteTask(T18))
    await run(() => ctx.reloadActiveProject())
    await run(() => ctx.undo())
    expect(linksOf(task(T18))).toEqual(MAINS())
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-after-undo', roleRates: {} }) })
    expect(snapLinks(v, T18)).toEqual(MAINS())
  })

  it('a desktop-shaped backend (no restoreTask, no patchTask): the revived task keeps its main items through Save and the next open', async () => {
    freeBudget()
    const a = fx.rabbitAdapter()
    delete a.restoreTask; delete a.patchTask
    await mount(a)
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-desk', roleRates: {} }) })
    // An earlier session deleted T18 on the desktop: the row and its items went.
    fx.store.tasks = fx.store.tasks.filter(x => x.id !== T18)
    fx.store.taskItems = fx.store.taskItems.filter(i => i.task_id !== T18)
    await run(() => ctx.reloadActiveProject())
    await run(() => ctx.openBudgetVersion(v.id, { roleRates: {} }))
    expect(linksOf(task(T18))).toEqual(MAINS())
    await run(() => ctx.saveBudgetVersion(v.id, { roleRates: {} }))
    expect(snapLinks(v, T18)).toEqual(MAINS())
    await run(() => ctx.reloadActiveProject())
    await run(() => ctx.openBudgetVersion(v.id, { roleRates: {} }))
    expect(storeKinds(T18, 'asset')[0]).toBe(A(7))
    expect(storeKinds(T18, 'scene')).toEqual([SC(4)])
    expect(storeKinds(T18, 'shot')).toEqual([SH(10)])
  })
})

// R2-3: a link write from another editor (the Tasks table's Asset cell, the
// Timeline's editor, the agent, a version's open) that would make a row the
// project no longer shows the task's main one. The cloud refuses it; before
// it was refused part way, after the editor's other fields were written.
const trashAsset = async (n) => {
  const i = fx.store.assets.findIndex(x => x.id === A(n))
  fx.store.assets[i] = { ...fx.store.assets[i], deleted_at: new Date().toISOString() }
  await run(() => ctx.reloadActiveProject())
}
describe('R2-3: a link write never makes a gone row the main one', () => {
  it('clearing the main asset while the next is in the trash refuses in words naming the task, and writes nothing', async () => {
    await mount(fx.rabbitAdapter())
    await trashAsset(12)
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
    let err = null
    await act(async () => { try { await ctx.updateTask(T18, { title: 'Half saved?', asset_id: null }) } catch (e) { err = e } })
    expect(err?.message).toMatch(/Glass and rain rig test/)
    expect(err?.message).toMatch(/no longer in the project/)
    expect(fx.store.tasks.find(t => t.id === T18).title).toBe('Glass and rain rig test')
    expect(storeKinds(T18, 'asset')).toEqual([A(7), A(12)])
  })

  it('a version whose task had no asset, opened over [A7, A12 in the trash], opens whole and leaves the clear out', async () => {
    freeBudget()
    await mount(fx.rabbitAdapter())
    for (const it of itemsOfTask(ctx.taskItems, T18, 'asset')) await run(() => ctx.removeTaskItem(it.id))
    let v
    await run(async () => { v = await ctx.createBudgetVersion({ name: 'V-no-asset', roleRates: {} }) })
    await run(() => ctx.addTaskItem({ task_id: T18, entity_type: 'asset', entity_id: A(7) }))
    await run(() => ctx.addTaskItem({ task_id: T18, entity_type: 'asset', entity_id: A(12) }))
    await trashAsset(12)
    let err = null
    await act(async () => { try { await ctx.openBudgetVersion(v.id, { roleRates: {} }) } catch (e) { err = e } })
    expect(err).toBeNull()
    expect(storeKinds(T18, 'asset')).toEqual([A(7), A(12)])
    expect(fx.store.projects.find(p => p.id === PROJECT_ID).open_budget_version_id).toBe(v.id)
  })
})

// R2-4: addTask writes the row, then each link as an item; a refused link
// left a bare task behind while the caller (the agent) heard "failed".
describe('R2-4: addTask is whole', () => {
  it('a link the backend refuses takes the new task back out, and the refusal is said', async () => {
    await mount(fx.rabbitAdapter())
    let err = null
    await act(async () => { try { await ctx.addTask({ id: 'r2-bare', title: 'Agent task', asset_id: 'f1c70000-0005-4000-8000-0000000009ff' }) } catch (e) { err = e } })
    expect(err).not.toBeNull()
    expect(task('r2-bare')).toBeUndefined()
    const stored = fx.store.tasks.find(t => t.id === 'r2-bare')
    expect(!stored || !!stored.deleted_at).toBe(true)
  })
})

// R2-6: on a backend whose delete removes the row (the Local Server), the
// asset's items leave every task there at once; the screen kept them as
// "No longer in the project" rows the backend no longer had.
describe('R2-6: deleting an asset where the backend removes rows', () => {
  it('takes its items off the screen at once', async () => {
    const a = fx.rabbitAdapter()
    delete a.restoreAsset
    await mount(a)
    expect(kinds(T18, 'asset')).toEqual([A(7), A(12)])
    await run(() => ctx.deleteAsset(A(12)))
    expect(kinds(T18, 'asset')).toEqual([A(7)])
  })

  it('and a bulk delete the same', async () => {
    const a = fx.rabbitAdapter()
    delete a.restoreAsset
    await mount(a)
    await run(() => ctx.deleteAssets([A(12)]))
    expect(kinds(T18, 'asset')).toEqual([A(7)])
  })
})

// R2-1, the narrowing alone: when the items of a task brought back cannot be
// read (offline), its row keeps the backend's links, so a Save records them.
describe('R2-1: a task whose items could not be read keeps its row\'s links for the bid snapshot', () => {
  it('Ctrl+Z after a refetch with the items read failing: Save as new version records the links', async () => {
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
    expect(snapLinks(v, T18)).toEqual(MAINS())
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
