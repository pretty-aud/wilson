// =============================================================================
// taskItemColumns.test.js — the fake cloud keeps a task's items and columns as
// the database does.
//
// FX2 review round 2 (R2-7): an item write recomputes the column of ITS kind
// (0096 §7a) and no other: a column of another kind with no item behind it (a
// row written before 0096, like suite 99's cross-project asset) is the
// database's to keep, not the write's to clear.
//
// VW1m (2026-10-16, Audrey: "lets not have main asset be a thing"), migration
// 0097: a task's items are its items. The three columns are only the older
// apps' copy (each kind's first item in the stored order, §4); an older app's
// write of one column ADDS that item and never moves or replaces one (§3); a
// new task's columns still become its items (§5); a load prunes and seeds and
// never reorders; there is no reorder verb; a task whose asset is in the
// trash stays, its item hidden by the screens until the asset comes back.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { buildDevFixtures } from './install'
import { PROJECT_ID, TASK_ID } from './data/project'
import { fid } from './ids'

const ASSET = (n) => fid('asset', n)
// A task's items of a kind in the stored order (position, then created_at,
// then id), as entity ids.
const stored = (store, taskId, kind) => store.taskItems
  .filter(i => i.task_id === taskId && i.entity_type === kind)
  .sort((a, b) => (a.position - b.position) || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) || (a.id < b.id ? -1 : 1))
  .map(i => i.entity_id)
const rowOf = (store, taskId) => store.tasks.find(t => t.id === taskId)

describe('an item write touches only its own kind\'s column', () => {
  it('adding and removing an asset item leave a scene column with no item as it is', async () => {
    const fx = buildDevFixtures()
    const a = fx.rabbitAdapter()
    const T5 = TASK_ID(5)
    const row = rowOf(fx.store, T5)
    // A scene written straight onto the row, with no item behind it.
    row.scene_id = fid('scene', 1)
    expect(fx.store.taskItems.some(i => i.task_id === T5 && i.entity_type === 'scene')).toBe(false)
    const added = await a.addTaskItem({ task_id: T5, project_id: PROJECT_ID, entity_type: 'asset', entity_id: ASSET(12), position: 1 })
    expect(row.scene_id).toBe(fid('scene', 1))
    await a.deleteTaskItem(added.id)
    expect(row.scene_id).toBe(fid('scene', 1))
  })
})

describe('an older app\'s write of one column ADDS (0097 §3)', () => {
  // Task 18 holds Lighthouse Interior (7) then Sea Spray Comp (12).
  const T18 = TASK_ID(18)

  it('a new value is added at the end of its kind; nothing moves, and the column reads the copy back', async () => {
    const fx = buildDevFixtures()
    const a = fx.rabbitAdapter()
    expect(stored(fx.store, T18, 'asset')).toEqual([ASSET(7), ASSET(12)])
    const back = await a.patchTask(T18, { asset_id: ASSET(11) })
    expect(stored(fx.store, T18, 'asset')).toEqual([ASSET(7), ASSET(12), ASSET(11)])
    // The copy is the first item in the stored order, as 0097 §3 sets NEW.
    expect(back.asset_id).toBe(ASSET(7))
    expect(rowOf(fx.store, T18).asset_id).toBe(ASSET(7))
  })

  it('a value the task already has changes nothing (what opening an older bid version sends)', async () => {
    const fx = buildDevFixtures()
    const a = fx.rabbitAdapter()
    const before = fx.store.taskItems.filter(i => i.task_id === T18).map(i => ({ ...i }))
    const back = await a.patchTask(T18, { asset_id: ASSET(12) })
    expect(fx.store.taskItems.filter(i => i.task_id === T18)).toEqual(before)
    expect(back.asset_id).toBe(ASSET(7))
  })

  it('a cleared column removes only the item it named; the copy reads the next', async () => {
    const fx = buildDevFixtures()
    const a = fx.rabbitAdapter()
    const back = await a.patchTask(T18, { asset_id: null })
    expect(stored(fx.store, T18, 'asset')).toEqual([ASSET(12)])
    expect(back.asset_id).toBe(ASSET(12))
  })

  it('a new task\'s columns become its items (§5, a template or an older app)', async () => {
    const fx = buildDevFixtures()
    const a = fx.rabbitAdapter()
    const id = 'f1c7aa00-0000-4000-8000-00000000vw1m'
    await a.upsertTask({ id, project_id: PROJECT_ID, title: 'From a template', asset_id: ASSET(3), scene_id: fid('scene', 2) })
    expect(stored(fx.store, id, 'asset')).toEqual([ASSET(3)])
    expect(stored(fx.store, id, 'scene')).toEqual([fid('scene', 2)])
    expect(stored(fx.store, id, 'shot')).toEqual([])
  })

  it('another project\'s row is refused whole: no column moves and no item is added', async () => {
    const fx = buildDevFixtures()
    const a = fx.rabbitAdapter()
    const before = fx.store.taskItems.map(i => i.id)
    const foreign = 'f1c7aa00-0000-4000-8000-0000000f0e1n'
    fx.store.scenes.push({ id: foreign, project_id: 'another-project', name: 'Elsewhere' })
    // The asset is this project's and comes first: it must not land either.
    await expect(a.patchTask(T18, { asset_id: ASSET(11), scene_id: foreign })).rejects.toMatchObject({ code: '23503' })
    expect(fx.store.taskItems.map(i => i.id)).toEqual(before)
    expect(rowOf(fx.store, T18).asset_id).toBe(ASSET(7))
    expect(rowOf(fx.store, T18).scene_id).toBe(fid('scene', 4))
  })

  it('there is no reorder verb (her Q-N1: the window sorts)', () => {
    const a = buildDevFixtures().rabbitAdapter()
    expect(a.reorderTaskItems).toBeUndefined()
  })
})

describe('a load prunes and seeds, and never reorders', () => {
  const T18 = TASK_ID(18)

  it('a column naming an item that is not first moves nothing; the column reads the copy', async () => {
    const fx = buildDevFixtures()
    const a = fx.rabbitAdapter()
    rowOf(fx.store, T18).asset_id = ASSET(12)
    const bundle = await a.loadProject(PROJECT_ID)
    expect(stored(fx.store, T18, 'asset')).toEqual([ASSET(7), ASSET(12)])
    expect(bundle.tasks.find(t => t.id === T18).asset_id).toBe(ASSET(7))
  })

  it('a column naming a row the task has no item for is seeded as an item; nothing it had is removed', async () => {
    const fx = buildDevFixtures()
    const a = fx.rabbitAdapter()
    const positions = () => Object.fromEntries(fx.store.taskItems
      .filter(i => i.task_id === T18 && i.entity_type === 'asset').map(i => [i.entity_id, i.position]))
    expect(positions()).toEqual({ [ASSET(7)]: 0, [ASSET(12)]: 1 })
    rowOf(fx.store, T18).asset_id = ASSET(11)
    const bundle = await a.loadProject(PROJECT_ID)
    const assets = bundle.taskItems.filter(i => i.task_id === T18 && i.entity_type === 'asset').map(i => i.entity_id)
    expect(assets.sort()).toEqual([ASSET(7), ASSET(11), ASSET(12)].sort())
    // Seeded as 0096's backfill seeds (position 0); the two it had keep
    // their places (FX2 moved the column's item first and renumbered).
    expect(positions()).toEqual({ [ASSET(7)]: 0, [ASSET(11)]: 0, [ASSET(12)]: 1 })
  })

  it('an item whose row is gone from the store, or a second copy of one, is pruned', async () => {
    const fx = buildDevFixtures()
    const a = fx.rabbitAdapter()
    const twin = { ...fx.store.taskItems.find(i => i.task_id === T18 && i.entity_id === ASSET(12)), id: 'f1c7aa00-0000-4000-8000-0000000twin1', created_at: '2099-01-01T00:00:00.000Z' }
    fx.store.taskItems.push(twin)
    fx.store.taskItems.push({ ...twin, id: 'f1c7aa00-0000-4000-8000-0000000gone1', entity_id: 'f1c7aa00-0000-4000-8000-00000000none' })
    const bundle = await a.loadProject(PROJECT_ID)
    const mine = bundle.taskItems.filter(i => i.task_id === T18 && i.entity_type === 'asset')
    expect(mine.map(i => i.entity_id).sort()).toEqual([ASSET(7), ASSET(12)].sort())
    expect(mine.some(i => i.id === twin.id)).toBe(false)
  })
})

describe('a task whose asset is in the trash stays (0097 §2, her Q-M2 and Q-N4)', () => {
  it('the task and its item stay through the trash, and the restore needs nothing put back', async () => {
    const fx = buildDevFixtures()
    const a = fx.rabbitAdapter()
    const T18 = TASK_ID(18)
    await a.deleteAsset(ASSET(7))
    const trashed = await a.loadProject(PROJECT_ID)
    expect(trashed.tasks.some(t => t.id === T18)).toBe(true)
    expect(trashed.assets.some(x => x.id === ASSET(7))).toBe(false)
    // The item stays; the screens hide it while its asset is in the trash.
    expect(trashed.taskItems.filter(i => i.task_id === T18 && i.entity_type === 'asset').map(i => i.entity_id).sort())
      .toEqual([ASSET(7), ASSET(12)].sort())
    expect(await a.restoreAsset(ASSET(7))).toBe(true)
    expect(stored(fx.store, T18, 'asset')).toEqual([ASSET(7), ASSET(12)])
  })
})
