// =============================================================================
// rabbitTaskItems.routes.test.js — FX2 (0096's twin on the Local Server):
// bundle.taskItems, the four routes, the read reconcile, and the hooks main.cjs
// hands its generic task / scene / shot / level / experience routes, replayed
// over an in-memory bundle with the REAL functions (the module, and
// rabbitSubentityRoutes lifted out of main.cjs as desktopDeleteSweep.test.js
// lifts it).
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

  it('a field a build wrote over the items wins as the MAIN item, and removes nothing', () => {
    const b = bundleOf({
      tasks: [{ id: 'T1', project_id: PID, asset_id: 'A2' }],
      taskItems: [
        { id: 'k1', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A1', position: 0 },
        { id: 'k2', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A2', position: 1 },
      ],
    })
    items.reconcileTaskItemsOnRead(b, { projectId: PID })
    expect(order(b, 'T1', 'asset')).toEqual(['A2:0', 'A1:1'])
    expect(b.tasks[0].asset_id).toBe('A2')
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

  it('POST adds an item, writes once, and keeps the task\'s fields its main items', () => {
    const b = seeded()
    const { routes, writes } = mounted(b)
    const r = call(routes, 'POST', P, {}, { task_id: 'T1', entity_type: 'level', entity_id: 'L1' })
    expect(r.code).toBe(200)
    expect(r.body).toMatchObject({ task_id: 'T1', project_id: PID, entity_type: 'level', entity_id: 'L1', position: 0 })
    expect(writes).toHaveLength(1)
    expect(fields(b, 'T1')).toBe('A1 - - L1 -')
    // A second asset leaves the main one.
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

  it('reorder puts the named ids first and the rest after, dense, and the first becomes the main', () => {
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

  it('DELETE removes an item and the next becomes main; an unknown id is not an error', () => {
    const b = seeded()
    const { routes } = mounted(b)
    call(routes, 'POST', P, {}, { id: 'i2', task_id: 'T1', entity_type: 'asset', entity_id: 'A2', position: 1 })
    const first = items.mainItemOf(b.taskItems, 'T1', 'asset')
    expect(call(routes, 'DELETE', `${P}/:itemId`, { itemId: first.id }).body).toEqual({ ok: true, removed: true })
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

  it('PATCH of a field: a new id replaces the main item; an existing one moves first; a clear hands main to the next', () => {
    const b = bundleOf({ taskItems: [] })
    const { routes } = generic(b)
    call(routes, 'POST', TASKS, {}, { id: 'T1', title: 'x', asset_id: 'A1' })
    call(routes, 'PATCH', `${TASKS}/:id`, { id: 'T1' }, { asset_id: 'A2' })
    expect(order(b, 'T1', 'asset')).toEqual(['A2:0'])
    // A second asset (an item), then the field written to it: moved, nothing removed.
    b.taskItems.push({ id: 'k3', task_id: 'T1', project_id: PID, entity_type: 'asset', entity_id: 'A3', position: 1, created_at: '2026-10-11T00:00:00Z' })
    const moved = call(routes, 'PATCH', `${TASKS}/:id`, { id: 'T1' }, { asset_id: 'A3' })
    expect(order(b, 'T1', 'asset')).toEqual(['A3:0', 'A2:1'])
    expect(moved.body.asset_id).toBe('A3')
    const cleared = call(routes, 'PATCH', `${TASKS}/:id`, { id: 'T1' }, { asset_id: null })
    expect(order(b, 'T1', 'asset')).toEqual(['A2:1'])
    expect(cleared.body.asset_id).toBe('A2')
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

  it('deleting a task\'s main scene hands "main" to its next scene, in the same write', () => {
    const b = bundleOf({ taskItems: [] })
    const { routes, writes } = generic(b)
    call(routes, 'POST', TASKS, {}, { id: 'T1', title: 'x', scene_id: 'S1' })
    b.taskItems.push({ id: 'k2', task_id: 'T1', project_id: PID, entity_type: 'scene', entity_id: 'S2', position: 1, created_at: '2026-10-11T00:00:00Z' })
    const n = writes.length
    call(routes, 'DELETE', '/api/rabbit/projects/:projectId/scenes/:id', { id: 'S1' })
    expect(order(b, 'T1', 'scene')).toEqual(['S2:1'])
    expect(b.tasks.find(t => t.id === 'T1').scene_id).toBe('S2')
    expect(writes.length).toBe(n + 1)
    // The scene's shot went with it (0040's CASCADE), and nothing names either.
    expect(b.taskItems.some(i => i.entity_id === 'S1' || i.entity_id === 'H1')).toBe(false)
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
  })
  it('every read reconciles, the empty bundle has the key, the readable mirror carries the live items, the routes are mounted', () => {
    expect(extractFunction(MAIN_CJS, 'readRabbitBundle')).toMatch(/rabbitTaskItems\.reconcileTaskItemsOnRead\(bundle, \{ projectId \}\)/)
    expect(extractFunction(MAIN_CJS, 'emptyBundle')).toMatch(/taskItems:\s*\[\]/)
    expect(MAIN_CJS).toMatch(/taskItems:\s*liveItems/)
    expect(MAIN_CJS).toMatch(/rabbitTaskItems\.mountRabbitTaskItems\(expressApp,/)
  })
})
