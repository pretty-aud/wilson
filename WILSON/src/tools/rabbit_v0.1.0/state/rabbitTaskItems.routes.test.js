// =============================================================================
// rabbitTaskItems.routes.test.js — FX2 (0096's twin on the Local Server):
// bundle.taskItems, the four routes, the read reconcile, and the hooks main.cjs
// hands its generic task / scene / shot / level / experience routes, replayed
// over an in-memory bundle with the REAL functions (the module, and
// rabbitSubentityRoutes lifted out of main.cjs as desktopDeleteSweep.test.js
// lifts it).
//
// VW1m (2026-10-16), Audrey's batch 12 to 14 rulings: no item of a kind counts
// for more than another. The five single fields are only the older builds'
// copy (each kind's first item in the stored order); an older build's write
// of one field ADDS and never moves (0097 §7b); a read never reorders; a
// deleted asset, scene, shot, level or experience leaves its tasks (her Q-M2,
// "The tasks stay"); the readable timeline.json lists every asset of a task.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const items = require('../../../../electron/rabbitTaskItems.cjs')
const { cascadeSceneOrShotDelete } = require('../../../../electron/rabbitShotLists.cjs')
const MAIN_CJS = readFileSync(new URL('../../../../electron/main.cjs', import.meta.url), 'utf-8').replace(/\r\n/g, '\n')

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`main.cjs no longer defines ${name}()`)
  let pd = 0
  let i = source.indexOf('(', start)
  for (; i < source.length; i++) {
    if (source[i] === '(') pd++
    else if (source[i] === ')') { pd--; if (pd === 0) break }
  }
  const open = source.indexOf('{', i)
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1) }
  }
  throw new Error(`unbalanced braces extracting ${name}()`)
}

const PID = 'proj-1'
function bundleOf(extra = {}) {
  return {
    project: { id: PID, title: 'P' },
    assets: [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }],
    scenes: [{ id: 'S1' }, { id: 'S2' }],
    shots: [{ id: 'H1', scene_id: 'S1' }],
    levels: [{ id: 'L1' }],
    experiences: [{ id: 'X1' }],
    tasks: [],
    shotListItems: [], shotLists: [], dependencies: [],
    ...extra,
  }
}

// A route table and a synchronous caller (every handler here is synchronous).
function app() {
  const routes = new Map()
  const reg = (verb) => (pattern, h) => routes.set(`${verb} ${pattern}`, h)
  return { routes, expressApp: { get: reg('GET'), post: reg('POST'), patch: reg('PATCH'), delete: reg('DELETE') } }
}
function call(routes, verb, pattern, params, body = {}, query = {}) {
  const handler = routes.get(`${verb} ${pattern}`)
  if (!handler) throw new Error(`no route for ${verb} ${pattern}`)
  const res = { code: 200, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  handler({ params: { projectId: PID, ...params }, body, query }, res)
  return res
}

let seq = 0
const newId = () => `id-${++seq}`
function mounted(bundle) {
  const { routes, expressApp } = app()
  const writes = []
  items.mountRabbitTaskItems(expressApp, {
    readRabbitBundle: (id) => (id === PID ? bundle : null),
    writeRabbitBundle: (_id, b) => { writes.push(structuredClone(b)) },
    rabbitNotFound: (res, what = 'project') => res.status(404).json({ error: `${what} not found` }),
    uuidv4: newId,
  })
  return { routes, writes }
}
const P = '/api/rabbit/projects/:projectId/task-items'
const order = (b, task, kind) => items.itemsOfTask(b.taskItems, task, kind).map(i => `${i.entity_id}:${i.position}`)
const fields = (b, id) => {
  const t = b.tasks.find(x => x.id === id)
  return [t.asset_id, t.scene_id, t.shot_id, t.level_id, t.experience_id].map(v => v ?? '-').join(' ')
}

describe('the read reconcile — a bundle from before FX2, and every read after', () => {
  it('makes each task\'s single fields its first items, all five kinds, with ids that do not change', () => {
    const b = bundleOf({ tasks: [{ id: 'T1', project_id: PID, asset_id: 'A1', scene_id: 'S1', shot_id: 'H1', level_id: 'L1', experience_id: 'X1' }] })
    expect(items.reconcileTaskItemsOnRead(b, { projectId: PID })).toBe(true)
    expect(items.itemsOfTask(b.taskItems, 'T1').map(i => `${i.entity_type}:${i.entity_id}:${i.position}`))
      .toEqual(['asset:A1:0', 'scene:S1:0', 'shot:H1:0', 'level:L1:0', 'experience:X1:0'])
    expect(b.taskItems[0].id).toBe(items.stableItemId(PID, 'T1', 'asset', 'A1'))
    // Converges: a second read changes nothing.
    const again = structuredClone(b)
    expect(items.reconcileTaskItemsOnRead(again, { projectId: PID })).toBe(false)
    expect(again).toEqual(b)
  })

  it('a failed write-back mints the SAME rows on the next read', () => {
    const raw = { tasks: [{ id: 'T1', project_id: PID, asset_id: 'A2' }] }
    const a = bundleOf(structuredClone(raw)); const b = bundleOf(structuredClone(raw))
    items.reconcileTaskItemsOnRead(a, { projectId: PID, now: '2026-10-11T00:00:00Z' })
    items.reconcileTaskItemsOnRead(b, { projectId: PID, now: '2026-10-11T00:00:00Z' })
    expect(a.taskItems).toEqual(b.taskItems)
  })

  it('a field naming a row the bundle does not have makes no item, and reads as nothing', () => {
    const b = bundleOf({ tasks: [{ id: 'T1', project_id: PID, asset_id: 'GONE' }] })
    items.reconcileTaskItemsOnRead(b, { projectId: PID })
    expect(b.taskItems).toEqual([])
    expect(b.tasks[0].asset_id).toBeNull()
  })

  it('drops an item whose task or entity is gone, or the second copy of one (the cloud\'s CASCADE and unique key)', () => {
    const b = bundleOf({
      tasks: [{ id: 'T1', project_id: PID }],
      taskItems: [
        { id: 'k1', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A1', position: 0, created_at: '2026-10-01T00:00:00Z' },
        { id: 'k2', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A1', position: 1, created_at: '2026-10-02T00:00:00Z' },
        { id: 'k3', task_id: 'NOPE', project_id: PID, entity_type: 'asset', entity_id: 'A2', position: 0 },
        { id: 'k4', task_id: 'T1', project_id: PID, entity_type: 'scene', entity_id: 'S9', position: 0 },
        { id: 'k5', task_id: 'T1', project_id: PID, entity_type: 'phase', entity_id: 'A3', position: 0 },
      ],
    })
    items.reconcileTaskItemsOnRead(b, { projectId: PID })
    expect(b.taskItems.map(i => i.id)).toEqual(['k1'])
    expect(b.tasks[0].asset_id).toBe('A1')
  })

  // VW1m (2026-10-16): FX2's read moved a field that disagreed with the
  // items to the front ("a read writes, and a stale field reorders").
  it('a field naming an item the task already has moves NOTHING; the copy reads the first in the stored order', () => {
    const b = bundleOf({
      tasks: [{ id: 'T1', project_id: PID, asset_id: 'A2' }],
      taskItems: [
        { id: 'k1', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A1', position: 0 },
        { id: 'k2', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A2', position: 1 },
      ],
    })
    const before = structuredClone(b.taskItems)
    expect(items.reconcileTaskItemsOnRead(b, { projectId: PID })).toBe(true)
    expect(b.taskItems).toEqual(before)
    expect(b.tasks[0].asset_id).toBe('A1')
  })

  it('a field an older build set with no item for it gains that item, and removes and moves nothing', () => {
    const b = bundleOf({
      tasks: [{ id: 'T1', project_id: PID, asset_id: 'A3' }],
      taskItems: [
        { id: 'k1', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A1', position: 0, created_at: '2026-10-01T00:00:00Z' },
        { id: 'k2', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A2', position: 1, created_at: '2026-10-02T00:00:00Z' },
      ],
    })
    const before = structuredClone(b.taskItems)
    items.reconcileTaskItemsOnRead(b, { projectId: PID, now: '2026-10-16T00:00:00Z' })
    expect(b.taskItems.slice(0, 2)).toEqual(before)
    expect(items.itemsOfTask(b.taskItems, 'T1', 'asset').map(i => i.entity_id).sort()).toEqual(['A1', 'A2', 'A3'])
    expect(b.taskItems[2].id).toBe(items.stableItemId(PID, 'T1', 'asset', 'A3'))
    expect(b.tasks[0].asset_id).toBe('A1')
    // Converges: the copy now names an item the task has, so the next read is a no-op.
    expect(items.reconcileTaskItemsOnRead(b, { projectId: PID })).toBe(false)
  })
})

// Review round 2, R2-2: the read reconcile runs on every project route, on
// the desktop's main process. It was quadratic (1.36 s at 5,000 tasks and
// 15,000 items with nothing to change); once per collection it is ~30 ms. The
// bound is loose on purpose (a loaded machine); the old code fails it.
describe('the read reconcile scales with the bundle', () => {
  it('5,000 tasks and 15,000 items, already in step, reconcile in well under half a second', () => {
    const T = 5000
    const assets = Array.from({ length: 1500 }, (_, i) => ({ id: `a${i}` }))
    const scenes = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}` }))
    const tasks = []
    const taskItems = []
    for (let t = 0; t < T; t++) {
      const a0 = `a${t % 1500}`, a1 = `a${(t + 1) % 1500}`, s0 = `s${t % 200}`
      tasks.push({ id: `t${t}`, project_id: PID, asset_id: a0, scene_id: s0, shot_id: null, level_id: null, experience_id: null })
      taskItems.push({ id: `i${t}a`, task_id: `t${t}`, entity_type: 'asset', entity_id: a0, position: 0, created_at: '2026-10-01T00:00:00Z' })
      taskItems.push({ id: `i${t}b`, task_id: `t${t}`, entity_type: 'asset', entity_id: a1, position: 1, created_at: '2026-10-01T00:00:00Z' })
      taskItems.push({ id: `i${t}s`, task_id: `t${t}`, entity_type: 'scene', entity_id: s0, position: 0, created_at: '2026-10-01T00:00:00Z' })
    }
    const b = { project: { id: PID }, assets, scenes, shots: [], levels: [], experiences: [], tasks, taskItems }
    const t0 = performance.now()
    const dirty = items.reconcileTaskItemsOnRead(b, { projectId: PID, now: '2026-10-12T00:00:00Z' })
    const ms = performance.now() - t0
    expect(dirty).toBe(false)
    expect(b.taskItems).toHaveLength(15000)
    expect(ms).toBeLessThan(500)
  })
})

describe('the four routes', () => {
  function seeded() {
    const b = bundleOf({ tasks: [{ id: 'T1', project_id: PID, asset_id: 'A1' }] })
    items.reconcileTaskItemsOnRead(b, { projectId: PID })
    return b
  }

  it('GET answers the project\'s items in the cloud\'s order', () => {
    const b = seeded()
    const { routes } = mounted(b)
    expect(call(routes, 'GET', P, {}).body.map(i => i.entity_id)).toEqual(['A1'])
    expect(call(routes, 'GET', P, { projectId: 'nope' }).code).toBe(404)
  })

  it('POST adds an item, writes once, and keeps the older builds\' copy the first items', () => {
    const b = seeded()
    const { routes, writes } = mounted(b)
    const r = call(routes, 'POST', P, {}, { task_id: 'T1', entity_type: 'level', entity_id: 'L1' })
    expect(r.code).toBe(200)
    expect(r.body).toMatchObject({ task_id: 'T1', project_id: PID, entity_type: 'level', entity_id: 'L1', position: 0 })
    expect(writes).toHaveLength(1)
    expect(fields(b, 'T1')).toBe('A1 - - L1 -')
    // A second asset joins; the copy still reads the first added.
    call(routes, 'POST', P, {}, { id: 'mine', task_id: 'T1', entity_type: 'asset', entity_id: 'A2', position: 1 })
    expect(fields(b, 'T1')).toBe('A1 - - L1 -')
  })

  it('POST of an item the task already names answers the stored row and writes nothing (ON CONFLICT DO NOTHING, then a read)', () => {
    const b = seeded()
    const { routes, writes } = mounted(b)
    const stored = b.taskItems[0]
    const r = call(routes, 'POST', P, {}, { id: 'another-id', task_id: 'T1', entity_type: 'asset', entity_id: 'A1' })
    expect(r.body).toEqual(stored)
    expect(writes).toHaveLength(0)
  })

  it('POST refuses a bad shape (400), an unknown task (404), an entity not in the project (404) and an id that names something else (409)', () => {
    const b = seeded()
    const { routes, writes } = mounted(b)
    expect(call(routes, 'POST', P, {}, { task_id: 'T1', entity_type: 'phase', entity_id: 'x' })).toMatchObject({ code: 400, body: { code: 'task_item_invalid' } })
    expect(call(routes, 'POST', P, {}, { task_id: 'NOPE', entity_type: 'asset', entity_id: 'A2' })).toMatchObject({ code: 404, body: { code: 'task_not_found' } })
    expect(call(routes, 'POST', P, {}, { task_id: 'T1', entity_type: 'scene', entity_id: 'S9' })).toMatchObject({ code: 404, body: { code: 'task_item_entity_not_found' } })
    expect(call(routes, 'POST', P, {}, { id: b.taskItems[0].id, task_id: 'T1', entity_type: 'asset', entity_id: 'A3' })).toMatchObject({ code: 409, body: { code: 'task_item_id_taken' } })
    expect(writes).toHaveLength(0)
  })

  // Review round 1, R1-4: an array id, a position past the cloud's INTEGER
  // and an object for created_at passed and were stored as sent (the task's
  // asset_id then read ["A2"]).
  it('POST refuses an id that is not text, a position the cloud cannot hold and a created_at that is not a date', () => {
    const b = seeded()
    const { routes, writes } = mounted(b)
    const base = { task_id: 'T1', entity_type: 'asset', entity_id: 'A2' }
    for (const bad of [{ ...base, entity_id: ['A2'] }, { ...base, position: 1e300 }, { ...base, created_at: { at: 'now' } }, { ...base, id: { x: 1 } }]) {
      expect(call(routes, 'POST', P, {}, bad), JSON.stringify(bad)).toMatchObject({ code: 400, body: { code: 'task_item_invalid' } })
    }
    expect(writes).toHaveLength(0)
    expect(b.taskItems.map(i => i.entity_id)).toEqual(['A1'])
    expect(fields(b, 'T1')).toBe('A1 - - - -')
  })

  // VW1m (2026-10-16): kept for older builds only (this app has no Move
  // buttons); a reorder moves the stored order, so the copy follows it.
  it('reorder (an older build\'s) puts the named ids first and the rest after, dense, and the copy follows', () => {
    const b = seeded()
    const { routes } = mounted(b)
    call(routes, 'POST', P, {}, { id: 'i2', task_id: 'T1', entity_type: 'asset', entity_id: 'A2', position: 1 })
    call(routes, 'POST', P, {}, { id: 'i3', task_id: 'T1', entity_type: 'asset', entity_id: 'A3', position: 2 })
    const r = call(routes, 'POST', `${P}/reorder`, {}, { task_id: 'T1', entity_type: 'asset', ids: ['i3'] })
    expect(r.body.map(x => x.id).sort()).toEqual(['i2', 'i3', items.stableItemId(PID, 'T1', 'asset', 'A1')].sort())
    expect(order(b, 'T1', 'asset')).toEqual(['A3:0', 'A1:1', 'A2:2'])
    expect(b.tasks[0].asset_id).toBe('A3')
  })

  it('reorder refuses an unknown kind and a twice-named id, and answers [] when nothing moves', () => {
    const b = seeded()
    const { routes, writes } = mounted(b)
    expect(call(routes, 'POST', `${P}/reorder`, {}, { task_id: 'T1', entity_type: 'phase', ids: [] }).code).toBe(400)
    expect(call(routes, 'POST', `${P}/reorder`, {}, { task_id: 'T1', entity_type: 'asset', ids: ['a', 'a'] }).code).toBe(400)
    expect(call(routes, 'POST', `${P}/reorder`, {}, { task_id: 'T1', entity_type: 'asset', ids: [] }).body).toEqual([])
    expect(writes).toHaveLength(0)
  })

  it('DELETE removes only that item, and the copy reads the next; an unknown id is not an error', () => {
    const b = seeded()
    const { routes } = mounted(b)
    call(routes, 'POST', P, {}, { id: 'i2', task_id: 'T1', entity_type: 'asset', entity_id: 'A2', position: 1 })
    const first = items.itemsOfTask(b.taskItems, 'T1', 'asset')[0]
    expect(call(routes, 'DELETE', `${P}/:itemId`, { itemId: first.id }).body).toEqual({ ok: true, removed: true })
    expect(order(b, 'T1', 'asset')).toEqual(['A2:1'])
    expect(b.tasks[0].asset_id).toBe('A2')
    expect(call(routes, 'DELETE', `${P}/:itemId`, { itemId: 'nope' }).body).toEqual({ ok: true, removed: false })
  })

  it('the reorder route is registered before the :itemId one, so "reorder" is never read as an id', () => {
    const { routes } = mounted(seeded())
    const keys = [...routes.keys()]
    expect(keys.indexOf(`POST ${P}/reorder`)).toBeGreaterThan(-1)
    expect(keys.indexOf(`POST ${P}/reorder`)).toBeLessThan(keys.indexOf(`DELETE ${P}/:itemId`))
  })
})

// ── The hooks on main.cjs's generic routes ─────────────────────────────────
function generic(bundle) {
  const { routes, expressApp } = app()
  const writes = []
  // eslint-disable-next-line no-new-func
  const register = new Function(
    'expressApp', 'readRabbitBundle', 'writeRabbitBundle', 'rabbitNotFound',
    'ensureEntityFolderRow', 'materializeFolderDirs', 'uuidv4', 'cascadeSceneOrShotDelete',
    `${extractFunction(MAIN_CJS, 'rabbitTouch')}
     ${extractFunction(MAIN_CJS, 'rabbitUpsertInto')}
     ${extractFunction(MAIN_CJS, 'rabbitRemoveFrom')}
     ${extractFunction(MAIN_CJS, 'sweepDependencyEdges')}
     ${extractFunction(MAIN_CJS, 'rabbitSubentityRoutes')}
     return rabbitSubentityRoutes;`,
  )(expressApp, () => bundle, (_id, b) => { writes.push(structuredClone(b)) },
    (res, what = 'project') => res.status(404).json({ error: `${what} not found` }),
    () => {}, () => {}, newId, cascadeSceneOrShotDelete)
  const hooks = items.makeTaskItemHooks({ newId })
  register('tasks', 'tasks', null, { sweepDependencies: true, scheduleRow: true, taskItems: hooks })
  register('scenes', 'scenes', 'scene', { shotListLinks: 'scene', taskItems: hooks })
  register('levels', 'levels', 'level', { taskItems: hooks })
  return { routes, writes }
}
const TASKS = '/api/rabbit/projects/:projectId/tasks'

describe('a task written through the generic routes (0096 §7b / §7c on the desktop)', () => {
  it('a new task\'s single fields become its first items, all five kinds, and the answer is the stored row', () => {
    const b = bundleOf({ taskItems: [] })
    const { routes } = generic(b)
    const r = call(routes, 'POST', TASKS, {}, { id: 'T1', title: 'x', asset_id: 'A1', scene_id: 'S1', level_id: 'L1' })
    expect(items.itemsOfTask(b.taskItems, 'T1').map(i => `${i.entity_type}:${i.entity_id}`)).toEqual(['asset:A1', 'scene:S1', 'level:L1'])
    expect(r.body).toMatchObject({ id: 'T1', asset_id: 'A1', scene_id: 'S1', level_id: 'L1' })
    // A kind the task has no item of reads as nothing (the row carries no key for it).
    expect(r.body.shot_id ?? null).toBeNull()
    expect(r.body.experience_id ?? null).toBeNull()
  })

  // VW1m (2026-10-16), 0097 §7b's twin: this app sends no single field; a
  // PATCH of one is an older build's, and it ADDS. FX2 replaced the first
  // item ("A, then B" lost A) and moved an existing one first.
  it('PATCH of a field (an older build): a new id is ADDED at the end and the old one stays; one the task has moves nothing; a clear takes only what it named', () => {
    const b = bundleOf({ taskItems: [] })
    const { routes } = generic(b)
    call(routes, 'POST', TASKS, {}, { id: 'T1', title: 'x', asset_id: 'A1' })
    const added = call(routes, 'PATCH', `${TASKS}/:id`, { id: 'T1' }, { asset_id: 'A2' })
    expect(order(b, 'T1', 'asset')).toEqual(['A1:0', 'A2:1'])
    // The copy is the first in the stored order, so it reads A1 again.
    expect(added.body.asset_id).toBe('A1')
    // A third asset (an item), then the field written to it: nothing moves.
    b.taskItems.push({ id: 'k3', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A3', position: 2, created_at: '2026-10-11T00:00:00Z' })
    const same = structuredClone(b.taskItems)
    const had = call(routes, 'PATCH', `${TASKS}/:id`, { id: 'T1' }, { asset_id: 'A3' })
    expect(b.taskItems).toEqual(same)
    expect(had.body.asset_id).toBe('A1')
    // Cleared: the field held A1 (the copy), so A1 goes and A2, A3 stay.
    const cleared = call(routes, 'PATCH', `${TASKS}/:id`, { id: 'T1' }, { asset_id: null })
    expect(order(b, 'T1', 'asset')).toEqual(['A2:1', 'A3:2'])
    expect(cleared.body.asset_id).toBe('A2')
  })

  it('a POST re-sending a known task with another value (an older build\'s upsert) adds it too', () => {
    const b = bundleOf({ taskItems: [] })
    const { routes } = generic(b)
    call(routes, 'POST', TASKS, {}, { id: 'T1', title: 'x', scene_id: 'S1' })
    call(routes, 'POST', TASKS, {}, { id: 'T1', title: 'x', scene_id: 'S2' })
    expect(order(b, 'T1', 'scene')).toEqual(['S1:0', 'S2:1'])
    expect(b.tasks.find(t => t.id === 'T1').scene_id).toBe('S1')
  })

  it('a field naming a row the project does not have adds nothing, and the copy reads the items', () => {
    const b = bundleOf({ taskItems: [] })
    const { routes } = generic(b)
    call(routes, 'POST', TASKS, {}, { id: 'T1', title: 'x', asset_id: 'A1' })
    const r = call(routes, 'PATCH', `${TASKS}/:id`, { id: 'T1' }, { asset_id: 'NOPE' })
    expect(order(b, 'T1', 'asset')).toEqual(['A1:0'])
    expect(r.body.asset_id).toBe('A1')
  })

  it('a re-send of the same values changes no item', () => {
    const b = bundleOf({ taskItems: [] })
    const { routes } = generic(b)
    call(routes, 'POST', TASKS, {}, { id: 'T1', title: 'x', asset_id: 'A1', scene_id: 'S1' })
    const before = structuredClone(b.taskItems)
    call(routes, 'PATCH', `${TASKS}/:id`, { id: 'T1' }, { asset_id: 'A1', scene_id: 'S1', title: 'y' })
    expect(b.taskItems).toEqual(before)
  })

  it('deleting a task takes its items', () => {
    const b = bundleOf({ taskItems: [] })
    const { routes } = generic(b)
    call(routes, 'POST', TASKS, {}, { id: 'T1', title: 'x', asset_id: 'A1' })
    call(routes, 'DELETE', `${TASKS}/:id`, { id: 'T1' })
    expect(b.taskItems).toEqual([])
  })

  it('deleting a task\'s first scene takes only it off; the task keeps its other scene, and the copy reads it, in the same write', () => {
    const b = bundleOf({ taskItems: [] })
    const { routes, writes } = generic(b)
    call(routes, 'POST', TASKS, {}, { id: 'T1', title: 'x', scene_id: 'S1', shot_id: 'H1' })
    b.taskItems.push({ id: 'k2', task_id: 'T1', project_id: PID, entity_type: 'scene', entity_id: 'S2', position: 1, created_at: '2026-10-11T00:00:00Z' })
    const n = writes.length
    const r = call(routes, 'DELETE', '/api/rabbit/projects/:projectId/scenes/:id', { id: 'S1' })
    expect(order(b, 'T1', 'scene')).toEqual(['S2:1'])
    expect(b.tasks.find(t => t.id === 'T1')).toMatchObject({ scene_id: 'S2', shot_id: null })
    expect(writes.length).toBe(n + 1)
    // The scene's shot went with it (0040's CASCADE), and nothing names either.
    expect(b.taskItems.some(i => i.entity_id === 'S1' || i.entity_id === 'H1')).toBe(false)
    // One task was about the scene and its shot: counted once.
    expect(r.body.unlinked).toEqual({ items: 0, tasks: 1, shots: 1 })
  })

  it('deleting a level takes it off every task', () => {
    const b = bundleOf({ taskItems: [] })
    const { routes } = generic(b)
    call(routes, 'POST', TASKS, {}, { id: 'T1', title: 'x', level_id: 'L1' })
    call(routes, 'DELETE', '/api/rabbit/projects/:projectId/levels/:id', { id: 'L1' })
    expect(b.taskItems).toEqual([])
    expect(b.tasks[0].level_id).toBeNull()
  })
})

// VW1m (2026-10-16), her Q-M2: "The tasks stay (Recommended)". The asset
// DELETE route in main.cjs runs afterRowRemoved after rabbitRemoveFrom (pinned
// below); this replays that pair.
describe('a deleted row leaves its tasks (her Q-M2)', () => {
  const OLD = '2026-01-01T00:00:00.000Z'
  function withTwo() {
    const b = bundleOf({
      tasks: [
        { id: 'T1', project_id: PID, asset_id: 'A1', updated_at: OLD },
        { id: 'T2', project_id: PID, asset_id: 'A1', updated_at: OLD },
        { id: 'T3', project_id: PID, asset_id: 'A3', updated_at: OLD },
      ],
    })
    items.reconcileTaskItemsOnRead(b, { projectId: PID })
    b.taskItems.push({ id: 'k2', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A2', position: 1, created_at: '2026-10-11T00:00:00Z' })
    return b
  }
  it('an asset deleted: every task stays; the one with another asset keeps it, the one with none has none', () => {
    const b = withTwo()
    b.assets = b.assets.filter(a => a.id !== 'A1')
    items.afterRowRemoved(b)
    expect(b.tasks.map(t => t.id)).toEqual(['T1', 'T2', 'T3'])
    expect(order(b, 'T1', 'asset')).toEqual(['A2:1'])
    expect(order(b, 'T2', 'asset')).toEqual([])
    expect(fields(b, 'T1')).toBe('A2 - - - -')
    expect(fields(b, 'T2')).toBe('- - - - -')
    // The copy moved, as the cloud's FK action is an UPDATE: updated_at moves with it.
    expect(b.tasks[0].updated_at).not.toBe(OLD)
    expect(b.tasks[1].updated_at).not.toBe(OLD)
  })
  it('FAILING CONTROL: a task the deleted asset was never on is left exactly as it was', () => {
    const b = withTwo()
    const before = structuredClone(b.tasks[2])
    b.assets = b.assets.filter(a => a.id !== 'A1')
    items.afterRowRemoved(b)
    expect(b.tasks[2]).toEqual(before)
    expect(order(b, 'T3', 'asset')).toEqual(['A3:0'])
  })
  it('a task whose copy does not move keeps its updated_at (the cloud updates only a changed column)', () => {
    const b = withTwo()
    b.assets = b.assets.filter(a => a.id !== 'A2')
    items.afterRowRemoved(b)
    expect(order(b, 'T1', 'asset')).toEqual(['A1:0'])
    expect(b.tasks[0]).toMatchObject({ asset_id: 'A1', updated_at: OLD })
  })
})

// VW1m (2026-10-16): the readable mirror's timeline.json lists every asset a
// task is about, in the stored order, not the single field. Lifted and run as
// setAsideDesktop.test.js runs it.
describe('timeline.json lists each task\'s asset_ids', () => {
  const mirror = (bundle) => {
    const files = {}
    // eslint-disable-next-line no-new-func
    // F3: the mirror writes through one change-only writer per pass.
    const fn = new Function('resolveProjectFolder', 'fileSlugify', 'path', 'fs', 'databaseMirrors', 'console',
      `${extractFunction(MAIN_CJS, 'mirrorProjectDatabases')}\nreturn mirrorProjectDatabases;`)(
      () => '/root', (s) => s, { join: (...p) => p.join('/') }, { existsSync: () => true, mkdirSync: () => {} },
      { writerFor: () => (file, data) => { files[file.split('/').pop()] = data } }, { error: (...a) => { throw new Error(a.join(' ')) } })
    fn(PID, bundle)
    return files
  }
  it('every asset item, in the order added; a task with none lists none; a set-aside task is not there', () => {
    const b = bundleOf({
      tasks: [
        { id: 'T1', project_id: PID, asset_id: 'A2' }, { id: 'T2', project_id: PID },
        { id: 'T3', project_id: PID, asset_id: 'A1', set_aside_at: '2026-10-01T00:00:00Z' },
      ],
      taskItems: [
        { id: 'k3', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A3', position: 2, created_at: '2026-10-03T00:00:00Z' },
        { id: 'k1', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A2', position: 0, created_at: '2026-10-01T00:00:00Z' },
        { id: 'ks', task_id: 'T1', project_id: PID, entity_type: 'scene', entity_id: 'S1', position: 0, created_at: '2026-10-01T00:00:00Z' },
        { id: 'k2', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A1', position: 1, created_at: '2026-10-02T00:00:00Z' },
        { id: 'k4', task_id: 'T3', project_id: PID, entity_type: 'asset', entity_id: 'A1', position: 0, created_at: '2026-10-02T00:00:00Z' },
      ],
    })
    const files = mirror(b)
    const tasks = files['timeline.json'].tasks
    expect(tasks.map(t => [t.id, t.asset_ids])).toEqual([['T1', ['A2', 'A1', 'A3']], ['T2', []]])
    expect(tasks[0]).not.toHaveProperty('asset_id')
    // tasks.json keeps every item whole, as before.
    expect(files['tasks.json'].taskItems.map(i => i.id).sort()).toEqual(['k1', 'k2', 'k3', 'ks'])
  })
})

describe('main.cjs wires the module in everywhere a task\'s items can change', () => {
  it('every entity a task can be about, and the tasks, register the item hooks', () => {
    expect(MAIN_CJS).toMatch(/rabbitSubentityRoutes\(\s*'tasks',\s*'tasks',\s*null,\s*\{[^}]*taskItems:\s*taskItemHooks\s*\}\)/)
    for (const e of ['scenes', 'shots', 'levels', 'experiences']) {
      expect(MAIN_CJS, e).toMatch(new RegExp(`rabbitSubentityRoutes\\(\\s*'${e}',[^\\n]*taskItems:\\s*taskItemHooks`))
    }
  })
  it('the asset DELETE route takes the asset off every task in its write', () => {
    const start = MAIN_CJS.indexOf("expressApp.delete('/api/rabbit/projects/:projectId/assets/:id'")
    const body = MAIN_CJS.slice(start, MAIN_CJS.indexOf('res.json({ ok: true });', start) + 30)
    expect(body).toMatch(/rabbitTaskItems\.afterRowRemoved\(bundle\);\s*writeRabbitBundle/)
    // VW1m (2026-10-16), her Q-M2: and it never removes a task.
    expect(body).not.toMatch(/bundle\.tasks\s*=|rabbitRemoveFrom\(bundle\.tasks/)
  })
  it('every load and every write reconciles, the empty bundle has the key, the readable mirror carries the live items, the routes are mounted', () => {
    // F3: the reconcile is reconcileRabbitBundle's, run by every disk load and
    // every write (a read that finds the bundle kept was reconciled by them).
    expect(extractFunction(MAIN_CJS, 'reconcileRabbitBundle')).toMatch(/rabbitTaskItems\.reconcileTaskItemsOnRead\(bundle, \{ projectId \}\)/)
    expect(extractFunction(MAIN_CJS, 'readRabbitBundle')).toMatch(/reconcileRabbitBundle\(bundle, projectId\)/)
    expect(extractFunction(MAIN_CJS, 'writeRabbitBundle')).toMatch(/reconcileRabbitBundle\(bundle, projectId\)/)
    expect(extractFunction(MAIN_CJS, 'emptyBundle')).toMatch(/taskItems:\s*\[\]/)
    expect(MAIN_CJS).toMatch(/taskItems:\s*liveItems/)
    expect(MAIN_CJS).toMatch(/rabbitTaskItems\.mountRabbitTaskItems\(expressApp,/)
  })
})
