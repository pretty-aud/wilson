// =============================================================================
// assetWarnings.test.js — every entity's tasks in ONE pass, and the answer the
// old scan gave for each (F4, 2026-11-13; the review's rabbit C5).
//
// The Assets tab asks, for each row, "is this asset marked approved while a
// task about it is not done?" (ctx.selectAssetStatusWarning). Each answer was
// one `tasksAbout`: a walk of every task item and a filter of every task. A
// render of the tab made one per row (views/assetWarningRender.test.jsx
// counts them: 15 on the fixture project), so the cost was assets times
// (items plus tasks), at every render.
//
// `tasksAboutByEntity` (taskItemsModel.js) builds the same lists for every
// entity of a kind in one walk of the items and one of the tasks. This file
// holds that it is THE SAME ANSWER: for every asset of the dev fixtures, and
// for a generated project made to hold every case the walk has to get right
// (an asset with no task, with one, with many; a task named twice by an
// asset's items; an item whose task is not in the list, as a trashed or
// set-aside task's is not; a backend that keeps no items, where the task's
// single field decides; ids as numbers on one side and strings on the other;
// holes in both lists). Same tasks, same order, the same objects.
//
// THE COST, measured here on a generated project of 400 assets, 2,000 tasks
// and 2,600 items (node, 2026-11-13, three runs, the best of five passes in
// each): the old way, one scan per asset, 18.2 to 18.5 ms for the 400
// warnings; the index, built once and read 400 times, 0.43 to 0.44 ms. The old
// way's work grows with assets times (items plus tasks); the index's with
// items plus tasks plus assets.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { tasksAbout, tasksAboutByEntity, ITEM_KINDS, KIND_FIELD } from './taskItemsModel'
import { assetWarningOfTasks } from './selectors'
import { buildDevFixtures } from '../../../dev/fixtures/install'
import { PROJECT_ID } from '../../../dev/fixtures/data/project'

/** The old answer for one entity, and the index's: the same tasks, in the same order, the same objects. */
function sameAsTheScan(tasks, items, kind, ids, available) {
  const index = tasksAboutByEntity(tasks, items, kind, available)
  for (const id of ids) {
    const old = tasksAbout(tasks, items, kind, id, available)
    const now = id == null ? [] : (index.get(String(id)) || [])
    expect(now.length, `${kind} ${String(id)}: how many`).toBe(old.length)
    for (let i = 0; i < old.length; i++) expect(now[i], `${kind} ${String(id)}: task ${i}`).toBe(old[i])
  }
  return index
}

// A small generator with a seed, so a failure names a project that can be made again.
function seeded(seed) {
  let s = seed >>> 0
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  return { next, int: (n) => Math.floor(next() * n), pick: (list) => list[Math.floor(next() * list.length)] }
}
const STATUSES = ['not_started', 'in_progress', 'pending_review', 'needs_revisions', 'approved', 'final', 'blocked', 'on_hold', 'omitted']

function generate({ seed, assets: nAssets, tasks: nTasks, items: nItems, odd = true }) {
  const r = seeded(seed)
  // Asset ids: numbers for some, strings for the rest (the scan compares them as strings).
  const assets = Array.from({ length: nAssets }, (_, i) => ({ id: odd && i % 5 === 0 ? i : `a-${i}`, status: r.pick(STATUSES) }))
  const tasks = Array.from({ length: nTasks }, (_, i) => ({
    id: odd && i % 7 === 0 ? 1000 + i : `t-${i}`,
    status: r.pick(STATUSES),
    // The older apps' single field, which decides where no items are kept.
    asset_id: r.next() < 0.7 ? r.pick(assets).id : null,
    scene_id: r.next() < 0.2 ? `s-${r.int(5)}` : null,
  }))
  const items = []
  for (let i = 0; i < nItems; i++) {
    const kind = r.next() < 0.75 ? 'asset' : r.pick(ITEM_KINDS)
    const task = r.pick(tasks)
    // The ids cross types: a number on the task or the asset, its string on the item, and the other way.
    const flip = (v) => (odd && r.next() < 0.3 ? (typeof v === 'number' ? String(v) : v) : v)
    items.push({
      id: `i-${i}`, task_id: flip(task.id), entity_type: kind,
      entity_id: kind === 'asset' ? flip(r.pick(assets).id) : `${kind[0]}-${r.int(5)}`,
      position: r.int(4), created_at: '2026-11-13T10:00:00Z',
    })
  }
  if (odd) {
    // The cases by name. An asset no task is about; one with exactly one task; one with ten;
    // one whose only item names a task that is not in the list (in the trash, or set aside).
    assets.push({ id: 'a-none', status: 'approved' }, { id: 'a-one', status: 'approved' }, { id: 'a-many', status: 'final' }, { id: 'a-gone', status: 'approved' })
    tasks.push({ id: 't-only', status: 'in_progress', asset_id: 'a-one', scene_id: null })
    items.push({ id: 'i-one', task_id: 't-only', entity_type: 'asset', entity_id: 'a-one', position: 0 })
    for (let k = 0; k < 10; k++) {
      tasks.push({ id: `t-many-${k}`, status: k === 9 ? 'blocked' : 'approved', asset_id: 'a-many', scene_id: null })
      items.push({ id: `i-many-${k}`, task_id: `t-many-${k}`, entity_type: 'asset', entity_id: 'a-many', position: k })
    }
    items.push({ id: 'i-gone', task_id: 't-in-the-trash', entity_type: 'asset', entity_id: 'a-gone', position: 0 })
    // A task named twice by one asset's items; holes in both lists; the same task object twice in the list
    // (the scan returns it twice, in place).
    items.push({ ...items[0], id: 'i-twice' })
    items.push(null, undefined)
    tasks.splice(3, 0, null)
    tasks.push(undefined)
    tasks.push(tasks[0])
  }
  return { assets, tasks, items }
}

describe('tasksAboutByEntity: every entity\'s tasks in one pass', () => {
  it('on the dev fixtures: for every asset, and for every kind, the scan\'s answer', async () => {
    const bundle = await buildDevFixtures().rabbitAdapter().loadProject(PROJECT_ID)
    expect({ assets: bundle.assets.length, tasks: bundle.tasks.length, items: bundle.taskItems.length }).toEqual({ assets: 15, tasks: 42, items: 54 })
    const assetIds = bundle.assets.map((a) => a.id)
    const index = sameAsTheScan(bundle.tasks, bundle.taskItems, 'asset', assetIds, true)
    expect(index.size).toBeGreaterThan(0)
    sameAsTheScan(bundle.tasks, bundle.taskItems, 'asset', assetIds, false)
    for (const kind of ITEM_KINDS) {
      const ids = [...new Set(bundle.taskItems.filter((i) => i.entity_type === kind).map((i) => i.entity_id))]
      sameAsTheScan(bundle.tasks, bundle.taskItems, kind, ids, true)
      sameAsTheScan(bundle.tasks, bundle.taskItems, kind, ids, false)
    }
  })

  it('on the dev fixtures: the warning each asset is given is the one the scan gave', async () => {
    const bundle = await buildDevFixtures().rabbitAdapter().loadProject(PROJECT_ID)
    const index = tasksAboutByEntity(bundle.tasks, bundle.taskItems, 'asset', true)
    const old = bundle.assets.map((a) => assetWarningOfTasks(a, tasksAbout(bundle.tasks, bundle.taskItems, 'asset', a.id, true)))
    const now = bundle.assets.map((a) => assetWarningOfTasks(a, index.get(String(a.id)) || []))
    expect(now).toEqual(old)
    expect(old.some(Boolean) && old.some((w) => !w)).toBe(true)        // both answers are in the fixture
  })

  it('on a generated project: assets with no task, one, many; a task named twice; a task not in the list; ids of both types; holes', () => {
    for (const seed of [1, 2, 3, 20261113]) {
      const g = generate({ seed, assets: 60, tasks: 140, items: 260 })
      const ids = [...g.assets.map((a) => a.id), 'a-nobody', 999999, null, undefined]
      const index = sameAsTheScan(g.tasks, g.items, 'asset', ids, true)
      // The cases by name: none, one, many, and the one whose only task is not in the list.
      const count = (id) => (index.get(id) || []).length
      expect({ none: count('a-none'), one: count('a-one'), many: count('a-many'), gone: count('a-gone') }, `seed ${seed}`).toEqual({ none: 0, one: 1, many: 10, gone: 0 })
      expect(index.has('a-none') || index.has('a-gone')).toBe(false)      // an entity with no task has no entry
      // And their warnings: approved with a task in progress warns; final with one of ten blocked warns; no task, no warning.
      const warns = (id) => assetWarningOfTasks(g.assets.find((a) => a.id === id), index.get(id) || [])
      expect({ none: warns('a-none'), one: warns('a-one'), many: warns('a-many'), gone: warns('a-gone') }).toEqual({ none: false, one: true, many: true, gone: false })
      for (const kind of ITEM_KINDS) sameAsTheScan(g.tasks, g.items, kind, ['s-0', 's-1', 'l-2', 'e-3', 's-4', ...ids], true)
    }
  })

  it('on a generated project where NO items are kept: the task\'s single field decides, as the scan has it', () => {
    for (const seed of [1, 2, 3, 20261113]) {
      const g = generate({ seed, assets: 60, tasks: 140, items: 260 })
      const ids = [...g.assets.map((a) => a.id), 'a-nobody', null, undefined]
      const index = sameAsTheScan(g.tasks, g.items, 'asset', ids, false)
      // Not the items' answer: a task is about the asset its field names, whatever the items say.
      for (const [id, list] of index) for (const t of list) expect(String(t[KIND_FIELD.asset])).toBe(id)
      sameAsTheScan(g.tasks, g.items, 'scene', ['s-0', 's-1', 's-2', 's-3', 's-4', 's-nobody'], false)
    }
  })

  it('the warning, for every generated asset and both kinds of backend', () => {
    for (const available of [true, false]) {
      const g = generate({ seed: 7, assets: 80, tasks: 200, items: 400 })
      const index = tasksAboutByEntity(g.tasks, g.items, 'asset', available)
      const old = g.assets.map((a) => assetWarningOfTasks(a, tasksAbout(g.tasks, g.items, 'asset', a.id, available)))
      const now = g.assets.map((a) => assetWarningOfTasks(a, index.get(String(a.id)) || []))
      expect(now).toEqual(old)
      expect(old.some(Boolean) && old.some((w) => !w)).toBe(true)
    }
  })

  it('what is not a list of tasks, or not a kind, is an empty index: as the scan answers []', () => {
    expect(tasksAboutByEntity(null, [], 'asset').size).toBe(0)
    expect(tasksAboutByEntity(undefined, [], 'asset', false).size).toBe(0)
    expect(tasksAboutByEntity([{ id: 't' }], [{ task_id: 't', entity_type: 'phase', entity_id: 'p' }], 'phase').size).toBe(0)
    expect(tasksAboutByEntity([{ id: 't' }], null, 'asset').size).toBe(0)
    expect(tasksAbout([{ id: 't' }], [{ task_id: 't', entity_type: 'phase', entity_id: 'p' }], 'phase', 'p')).toEqual([])
  })

  it('an answer is a list of its own: changing one does not change the next', () => {
    const tasks = [{ id: 't-1' }, { id: 't-2' }]
    const items = [{ task_id: 't-1', entity_type: 'asset', entity_id: 'a' }, { task_id: 't-2', entity_type: 'asset', entity_id: 'a' }, { task_id: 't-2', entity_type: 'asset', entity_id: 'b' }]
    const index = tasksAboutByEntity(tasks, items, 'asset')
    expect(index.get('a')).toEqual(tasks)
    expect(index.get('b')).toEqual([tasks[1]])
    expect(index.get('a')).not.toBe(index.get('b'))
    expect(index.has('nobody')).toBe(false)
  })
})

describe('the cost, on a project of 400 assets, 2,000 tasks and 2,600 items', () => {
  const g = generate({ seed: 11, assets: 400, tasks: 2000, items: 2600, odd: false })
  const best = (run) => { let ms = Infinity; for (let i = 0; i < 5; i++) { const t0 = performance.now(); run(); ms = Math.min(ms, performance.now() - t0) } return ms }

  it('one pass and 400 reads answer what 400 scans answered', () => {
    const index = tasksAboutByEntity(g.tasks, g.items, 'asset', true)
    for (const a of g.assets) expect(index.get(String(a.id)) || []).toEqual(tasksAbout(g.tasks, g.items, 'asset', a.id, true))
  })

  it('and cost a small part of them', () => {
    const scans = best(() => { for (const a of g.assets) assetWarningOfTasks(a, tasksAbout(g.tasks, g.items, 'asset', a.id, true)) })
    const indexed = best(() => {
      const index = tasksAboutByEntity(g.tasks, g.items, 'asset', true)
      for (const a of g.assets) assetWarningOfTasks(a, index.get(String(a.id)) || [])
    })
    // Measured 41 to 43 times cheaper (the header). Held to five, so that a busy machine does not turn it red.
    expect(indexed).toBeLessThan(scans / 5)
  })
})
